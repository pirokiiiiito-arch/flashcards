#!/usr/bin/env node
'use strict';
// Private, read-only proof of the chosen source and the observed reader output.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {isDeepStrictEqual: equal} = require('node:util');

const scopes = ['body', 'heading', 'figure', 'caption', 'note', 'ruby', 'toc', 'other'];
const states = ['matched', 'corrected', 'illegible'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const hex = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const named = value => typeof value === 'string' && value.trim().length > 0;
const number = Number.isSafeInteger;
const within = (n, range) => number(n) && range[0] <= n && n <= range[1];
const validRange = r => Array.isArray(r) && r.length === 2 && r.every(number) && r[0] >= 1 && r[0] <= r[1];
const requireValue = (condition, message) => { if (!condition) throw Error(message); };
const json = bytes => JSON.parse(bytes.toString('utf8'));

function privateFile(root, ref) {
  requireValue(ref && named(ref.path) && hex(ref.sha256) && !path.isAbsolute(ref.path) &&
    ref.path.split(/[\\/]/).every(p => p && p !== '.' && p !== '..'), 'INVALID_EVIDENCE_REFERENCE');
  const safeRoot = fs.realpathSync(root), file = fs.realpathSync(path.resolve(safeRoot, ref.path));
  requireValue(file.startsWith(safeRoot + path.sep) && fs.statSync(file).isFile(), 'EVIDENCE_PATH_OUTSIDE_BUNDLE');
  const bytes = fs.readFileSync(file);
  requireValue(hash(bytes) === ref.sha256, 'EVIDENCE_FILE_CHANGED');
  return {file, bytes};
}

function imageSize(bytes) {
  if (bytes.length >= 45 && bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')) &&
      bytes.toString('ascii',12,16)==='IHDR' && bytes.toString('ascii',bytes.length-8,bytes.length-4)==='IEND')
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let p = 2; p + 9 < bytes.length && bytes[p] === 0xff;) {
      while (bytes[p] === 0xff) p++;
      const mark = bytes[p++];
      if (mark === 0xda || mark === 0xd9 || p + 2 > bytes.length) break;
      const size = bytes.readUInt16BE(p);
      if (size < 2 || p + size > bytes.length) break;
      if ([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(mark) && size >= 8)
        return [bytes.readUInt16BE(p+5), bytes.readUInt16BE(p+3)];
      p += size;
    }
  }
  throw Error('SOURCE_OR_CAPTURE_IMAGE_REQUIRED');
}

function rows(items, key) {
  const grouped = new Map();
  for (const item of items) {
    const id = item?.[key];
    if (!grouped.has(id)) grouped.set(id,[]);
    grouped.get(id).push(item);
  }
  return grouped;
}

function scopeList(values) {
  return Array.isArray(values) && values.every(s => scopes.includes(s)) && new Set(values).size === values.length;
}
function rect(box, dims) {
  return Array.isArray(box) && box.length === 4 && box.every(number) &&
    0 <= box[0] && box[0] < box[2] && box[2] <= dims[0] && 0 <= box[1] && box[1] < box[3] && box[3] <= dims[1];
}
function sameSource(record, scan, digest) {
  return record?.scan === scan && record.sourceSha256 === digest;
}
function regionValue(source, v, rendered) {
  const scope=source.scope;
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (v.disposition === 'source-only')
    return scope === 'other' && named(v.before) && named(v.after) && rendered.observedWindow === v.before + v.after;
  if (scope === 'figure') return hex(v.sha256);
  if (scope === 'ruby') return named(v.base) && named(v.reading) && named(v.parent) &&
    number(v.start) && number(v.end) && v.start >= 0 && v.end - v.start === Array.from(v.base).length;
  if (scope === 'heading') {
    const inline=source.placement==='inline' && named(source.placementReason);
    return named(v.text) && typeof v.startsPage==='boolean' && (v.startsPage || inline);
  }
  return named(v.text);
}

function matchesIllegible(ctx,scan,digest,dims,source,review,actual) {
  const value=review.value;
  if (source.illegible!==true || !named(review.reason) || !named(value?.note) ||
      value.originalSha256!==digest || !equal(value.box,source.box) || Object.keys(value).length!==3) return false;
  // Inline original crop and notice, when the selected format renders them.
  if (!actual.originalObservation) return equal(actual.value,value);
  // The published reader may instead provide the complete original through its
  // original-mode control. Keep the locator and the reviewer’s note privately.
  const ob=actual.originalObservation, display=actual.legibilityDisplay;
  if (!equal(actual.value,{originalSha256:digest,box:source.box}) || ob.mode!=='reader-original' ||
      ob.scan!==scan || ob.imageSha256!==digest || !equal(ob.dimensions,dims) ||
      !equal(ob.box,source.box) || !ob.capture) return false;
  const [width,height]=imageSize(privateFile(ctx.readbackRoot,ob.capture).bytes);
  const screen=ob.screenBox;
  if (!Array.isArray(screen) || screen.length!==4 || !screen.every(Number.isFinite) ||
      Math.min(width,screen[2])<=Math.max(0,screen[0]) || Math.min(height,screen[3])<=Math.max(0,screen[1])) return false;
  if (display?.kind==='note') return display.text===value.note;
  const recorded=review.legibilityDisplay;
  return display?.kind==='source-only' && recorded?.kind==='source-only' &&
    named(recorded.before) && named(recorded.after) && display.before===recorded.before &&
    display.after===recorded.after && display.observedWindow===recorded.before+recorded.after;
}

function reviewPage(ctx, scan, input, observation) {
  const issues = [], matchedRegions = [], pending = new Set();
  function issue(reason, scope, id) {
    issues.push({reason, ...(scope ? {scope} : {}), ...(id ? {id} : {})});
    if (scope) pending.add(scope);
    else scopes.forEach(s => pending.add(s));
  }
  const page = input[0];
  try {
    requireValue(input.length === 1, input.length ? 'DUPLICATE_SOURCE_PAGE' : 'MISSING_SOURCE_INVENTORY');
    const image = privateFile(ctx.sourceRoot,page.image), digest = page.image.sha256, dims=imageSize(image.bytes);
    requireValue(dims.every(n=>n>0) && (!ctx.sourceIndex || ctx.sourceIndex[scan] === digest), 'SOURCE_IMAGE_MISMATCH');
    const census = json(privateFile(ctx.sourceRoot,page.census).bytes);
    const review = json(privateFile(ctx.sourceRoot,page.review).bytes);
    requireValue(page.census.path !== page.review.path && page.census.sha256 !== page.review.sha256 &&
      sameSource(census,scan,digest) && sameSource(review,scan,digest) && named(census.reviewedBy) &&
      named(review.reviewedBy) && review.blindToOutput === true, 'INDEPENDENT_SOURCE_REVIEW_REQUIRED');
    requireValue(observation.length === 1, observation.length ? 'DUPLICATE_RENDERED_PAGE' : 'MISSING_RENDERED_PAGE');
    const actual = observation[0];
    requireValue(sameSource(actual,scan,digest), 'RENDERED_SOURCE_MISMATCH');
    const captures = actual.captures ?? [actual.capture];
    requireValue(Array.isArray(captures) && captures.length > 0, 'READBACK_CAPTURE_REQUIRED');
    for (const ref of captures) {
      const capture = privateFile(ctx.readbackRoot,ref);
      requireValue(imageSize(capture.bytes).every(n=>n>0), 'READBACK_CAPTURE_REQUIRED');
    }
    const records = [census,review,actual];
    requireValue(records.every(rec=>Array.isArray(rec.regions) && scopeList(rec.completeScopes ?? [])), 'INVALID_SCOPE_RECORD');
    const maps = records.map(rec=>rows(rec.regions,'id'));
    const ids = new Set(maps.flatMap(m=>[...m.keys()]));
    for (const id of ids) {
      const [locations,readings,outputs] = maps.map(m=>m.get(id)??[]);
      const s=locations[0], r=readings[0], o=outputs[0], scope=s?.scope??o?.scope;
      if (!named(id) || !scopes.includes(scope) || [locations,readings,outputs].some(xs=>xs.length!==1)) {
        issue('REGION_MISSING_EXTRA_OR_DUPLICATE', scopes.includes(scope)?scope:undefined, id);
        continue;
      }
      const matched = r.state==='illegible' ? matchesIllegible(ctx,scan,digest,dims,s,r,o) :
        s.illegible!==true && equal(o.value,r.value) && regionValue(s,r.value,o);
      if (!rect(s.box,dims) || !states.includes(r.state) || o.scope !== scope || !matched) {
        issue('ORIGINAL_AND_RENDERED_REGION_DIFFER',scope,id);
        continue;
      }
      if (scope === 'ruby' && r.state !== 'illegible') {
        const parent = maps[2].get(o.value.parent)?.[0]?.value?.text;
        if (typeof parent !== 'string' || Array.from(parent).slice(o.value.start,o.value.end).join('') !== o.value.base) {
          issue('RUBY_PARENT_OR_RANGE_DIFFERS',scope,id);
          continue;
        }
      }
      if (s.partial === true) issue('PARTIAL_SOURCE_REGION',scope,id);
      matchedRegions.push({id,scope,state:r.state});
    }
    // Ensure reading order, including correctly spelt but transposed paragraphs.
    for (const scope of scopes) {
      const expected = census.regions.filter(r=>r?.scope===scope).map(r=>r.id);
      const got=actual.regions.filter(r=>r?.scope===scope).map(r=>r.id);
      if (!equal(expected,got)) issue('SOURCE_RENDER_ORDER_DIFFERS',scope);
      if (census.edgesChecked !== true || !records.every(rec=>(rec.completeScopes??[]).includes(scope)))
        issue('SCOPE_NOT_FULLY_REVIEWED',scope);
    }
    const common=id=>maps[0].get(id)?.length===1 && maps[2].get(id)?.length===1;
    const originalOrder=census.regions.filter(r=>common(r.id)), renderOrder=actual.regions.filter(r=>common(r.id));
    for(let i=0;i<originalOrder.length;i++) {
      if(originalOrder[i].id!==renderOrder[i].id) issue('SOURCE_READING_ORDER_DIFFERS',originalOrder[i].scope,originalOrder[i].id);
    }
  } catch(error) {
    issue(error.message);
  }
  return {scan,status:issues.length?'pending':'complete',matchedRegions,pendingScopes:[...pending],issues};
}

function makeReport(bookId,range,artifactSha256,pages,globalIssues=[]) {
  const batches=[];
  for (let i=0;i<pages.length;i+=20) {
    const group=pages.slice(i,i+20), pendingScans=group.filter(p=>p.status!=='complete').length;
    const scopeStatus = Object.fromEntries(scopes.map(scope => {
      const remainingScans = group.filter(p=>p.pendingScopes.includes(scope)).map(p=>p.scan);
      return [scope,{status:remainingScans.length?'partial':'complete',pendingScans:remainingScans.length,remainingScans}];
    }));
    batches.push({range:[group[0].scan,group[group.length-1].scan],status:pendingScans?'partial':'complete',
      pendingScans,scopeStatus,matchedRegions:group.reduce((sum,p)=>sum+p.matchedRegions.length,0)});
  }
  const queue=pages.filter(p=>p.status!=='complete');
  return {schema:'reader-proof-batches-v1',bookId,range,artifactSha256,status:queue.length?'partial':'complete',
    totalScans:pages.length,pendingScans:queue.length,matchedScans:pages.length-queue.length,
    matchedRegions:batches.reduce((sum,b)=>sum+b.matchedRegions,0),batches,globalIssues,queue,pages};
}

function unavailable(bookId,range,artifactSha256,reason) {
  requireValue(validRange(range),'INVALID_REQUEST_RANGE');
  const pages=[];
  for(let scan=range[0];scan<=range[1];scan++) pages.push({scan,status:'pending',matchedRegions:[],
    pendingScopes:scopes.slice(),issues:[{reason}]});
  return makeReport(bookId,range,artifactSha256,pages,[reason]);
}
function audit({bookId,range,artifactSha256,inventoryFile,inventorySha256,readbackFile,sourceIndex}) {
  requireValue(named(bookId) && validRange(range) && hex(artifactSha256),'INVALID_PROOF_SUBJECT');
  try {
    const bytes=fs.readFileSync(inventoryFile);
    requireValue(!inventorySha256 || hash(bytes)===inventorySha256,'PROOF_INVENTORY_CHANGED');
    const inventory=json(bytes), sourceRoot=path.dirname(path.resolve(inventoryFile));
    requireValue(inventory.schema==='reader-proof-inventory-v1' && inventory.bookId===bookId &&
      validRange(inventory.range) && range.every(n=>within(n,inventory.range)) && Array.isArray(inventory.pages),
      'WRONG_SOURCE_INVENTORY');
    const observation=readbackFile ? {file:path.resolve(readbackFile),bytes:fs.readFileSync(readbackFile)} :
      inventory.readback ? privateFile(sourceRoot,inventory.readback) : null;
    requireValue(observation,'MISSING_READER_READBACK');
    const readback=json(observation.bytes);
    requireValue(readback.schema==='reader-proof-readback-v1' && readback.bookId===bookId &&
      equal(readback.range,range) && readback.artifactSha256===artifactSha256 && Array.isArray(readback.pages),'STALE_OR_WRONG_READBACK');
    requireValue(inventory.pages.every(p=>within(p?.scan,inventory.range)) && readback.pages.every(p=>within(p?.scan,range)),
      'UNEXPECTED_SOURCE_OR_OUTPUT_PAGE');
    const sourcePages=rows(inventory.pages,'scan'), renderedPages=rows(readback.pages,'scan'), pages=[];
    for(let scan=range[0];scan<=range[1];scan++) {
      pages.push(reviewPage({sourceRoot,readbackRoot:path.dirname(observation.file),sourceIndex},scan,
        sourcePages.get(scan)??[],renderedPages.get(scan)??[]));
    }
    return makeReport(bookId,range,artifactSha256,pages);
  } catch(error) {
    return unavailable(bookId,range,artifactSha256,error.message);
  }
}

function main(args){
  const options={};let requireComplete=false;
  for(let i=0;i<args.length;i++){
    if(args[i]==='--require-complete'){requireComplete=true;continue;}
    const key=args[i];
    requireValue(['--artifact','--inventory','--book-id','--start','--end','--readback'].includes(key) && !options[key] && args[i+1], 'INVALID_OPTION');
    options[key]=args[++i];
  }
  for(const key of ['--artifact','--inventory','--book-id','--start','--end']) requireValue(named(options[key]),'MISSING_'+key);
  const report=audit({bookId:options['--book-id'],range:[Number(options['--start']),Number(options['--end'])],
    artifactSha256:hash(fs.readFileSync(options['--artifact'])),inventoryFile:options['--inventory'],readbackFile:options['--readback']});
  console.log(JSON.stringify(report));
  if(requireComplete && report.status!=='complete') process.exitCode=2;
}
if(require.main===module)try{main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
module.exports={audit,unavailable,scopes};
