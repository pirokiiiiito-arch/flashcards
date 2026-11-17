#!/usr/bin/env node
'use strict';
// Optional PRIVATE artifact integrity preflight. Never changes the 60-rule canonical gate.
// Never includes scans/OCR in output. It cannot certify proofreading, Drive readback,
// public HTTP availability, Chrome import or a real iPhone.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const isHash = s => typeof s === 'string' && /^[a-f0-9]{64}$/.test(s);

function validateDateTime(name) {
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})_/.exec(name);
  if (!m) return false;
  const [, y, mo, d, h, mi] = m.map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === mo &&
    dt.getUTCDate() === d && dt.getUTCHours() === h && dt.getUTCMinutes() === mi;
}
function extract(html) {
  const m = html.match(/<script\b(?=[^>]*\bid=["']embedded-data["'])[^>]*>([\s\S]*?)<\/script\s*>/i);
  if (!m) throw Error('EMBEDDED_DATA_MISSING');
  try { return JSON.parse(m[1]); } catch (_) { throw Error('EMBEDDED_DATA_INVALID_JSON'); }
}
function getMeta(html,name){
  const tags=html.match(/<meta\s+[^>]*>/gi)||[];
  const tag=tags.find(t=>(t.match(/\bname=["']([^"']+)["']/i)||[])[1]===name);
  return tag?.match(/\bcontent=["']([^"']*)["']/i)?.[1]||null;
}
function safePublicEntry(entry){
  return typeof entry==='string'&&/^reader\/[A-Za-z0-9_./-]+\/index\.html$/.test(entry)&&
    !entry.split('/').includes('..')&&!entry.split('/').includes('.');
}
function urlMatchesEntry(raw,entry){
  if(!safePublicEntry(entry))return false;
  try{
    const u=new URL(raw),full='/flashcards/'+entry,dir=full.slice(0,-'index.html'.length);
    return u.origin==='https://pirokiiiiito-arch.github.io'&&
      (u.pathname===full||u.pathname===dir)&&u.searchParams.get('import')==='1'&&
      !u.username&&!u.password&&!u.hash;
  }catch(_){return false;}
}
function sourceHashes(manifest,bookId,start,end,fail){
  if(!manifest)return null;
  fail(manifest.schema==='reader-source-hashes-v1'&&manifest.bookId===bookId&&
    Array.isArray(manifest.range)&&manifest.range[0]===start&&manifest.range[1]===end,
    'SOURCE_MANIFEST_IDENTITY_MISMATCH');
  const images=manifest.images;
  fail(images&&typeof images==='object'&&!Array.isArray(images)&&
    Object.keys(images).length===end-start+1&&
    Array.from({length:end-start+1},(_,i)=>isHash(images[String(start+i)])).every(Boolean),
    'SOURCE_MANIFEST_INCOMPLETE');
  return images||{};
}
function inspect(file, options = {}) {
  const errors = [], warnings = [];
  const fail = (condition, msg) => { if (!condition) errors.push(msg); };
  const filename = path.basename(file), mode = options.mode || 'preview';
  const start = Number(options.start), end = Number(options.end);
  fail(validateDateTime(filename), 'FILENAME_MISSING_VALID_YYYYMMDD_HHMM');
  fail(/^\d{8}_\d{4}_/.test(filename) &&
    filename.includes(String(start).padStart(3,'0')+'-'+String(end).padStart(3,'0')), 'FILENAME_RANGE_MISMATCH');
  fail(Number.isSafeInteger(start) && Number.isSafeInteger(end) && start > 0 &&
    end >= start && end - start < 200, 'INVALID_EXPECTED_RANGE');
  fail(typeof options.bookId === 'string' && options.bookId.length > 2, 'EXPECTED_BOOK_ID_REQUIRED');
  fail(['preview','production'].includes(mode), 'INVALID_MODE');
  if(options.profile)fail(['novel','world_history_1','generic'].includes(options.profile),'INVALID_PROFILE');
  let bytes, html, d;
  try { bytes=fs.readFileSync(file); html=bytes.toString('utf8'); }
  catch(e) { errors.push('FILE_UNREADABLE_'+e.code); }
  const artifactSha256 = bytes ? hash(bytes) : null;
  if (options.expectedSha) fail(isHash(options.expectedSha) &&
    artifactSha256===options.expectedSha, 'ARTIFACT_SHA256_MISMATCH');
  else warnings.push('ARTIFACT_HASH_NOT_INDEPENDENTLY_PINNED');
  if (html) {
    try { d=extract(html); } catch(e) { errors.push(e.message); }
    fail(/<meta\s+name=["']viewport["']/i.test(html), 'VIEWPORT_META_MISSING');
    if(options.profile){
      fail(getMeta(html,'template-profile')===options.profile,'TEMPLATE_PROFILE_MISMATCH');
      if(options.profile==='novel')fail(/\bnovel-reading\b/.test(html),'NOVEL_READER_STYLE_MISSING');
    }
    fail(/reader-ready-v8/.test(html)&&/reader-position-v1/.test(html),'CHROME_HOST_PROTOCOL_MISSING');
    const builtAt=getMeta(html,'built-at');
    if(builtAt){
      const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(builtAt);
      fail(!!m&&filename.startsWith(m.slice(1,4).join('')+'_'+m[4]+m[5]+'_'),
        'FILENAME_AND_BUILT_AT_MISMATCH');
    }else warnings.push('BUILD_TIMESTAMP_NOT_EMBEDDED');
  }
  let sourceImageBytes=0,sourceManifest=null;
  if(options.sourceManifest){
    try{sourceManifest=typeof options.sourceManifest==='string'?
      JSON.parse(fs.readFileSync(options.sourceManifest,'utf8')):options.sourceManifest;}
    catch(_){errors.push('SOURCE_MANIFEST_UNREADABLE');}
  }else warnings.push('ORIGINAL_SOURCE_INDEPENDENT_HASH_MANIFEST_NOT_PROVIDED');
  const originals=sourceHashes(sourceManifest,options.bookId,start,end,fail);
  if (d) {
    fail(d.bookId===options.bookId, 'BOOK_ID_MISMATCH');
    fail(d.title===options.title || !options.title, 'BOOK_TITLE_MISMATCH');
    fail(Array.isArray(d.range) && d.range[0]===start && d.range[1]===end, 'EMBEDDED_RANGE_MISMATCH');
    fail(d.imageCount===end-start+1, 'IMAGE_COUNT_MISMATCH');
    fail(Array.isArray(d.pages) && d.pages.length===end-start+1, 'PAGE_COUNT_MISMATCH');
    const seen=new Set(), pages=Array.isArray(d.pages) ? d.pages : [];
    pages.forEach((page,i)=>{
      const idx = start+i;
      fail(page && page.scan===idx, 'SCAN_SEQUENCE_MISMATCH_'+idx);
      if(!page || typeof page.dataUrl!=='string') {
        errors.push('ORIGINAL_IMAGE_MISSING_'+idx);return;
      }
      const m=/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(page.dataUrl);
      if(!m) { errors.push('ORIGINAL_IMAGE_DATA_INVALID_'+idx);return; }
      const raw=Buffer.from(m[2], 'base64');sourceImageBytes+=raw.length;
      fail(raw.toString('base64')===m[2], 'ORIGINAL_IMAGE_BAD_BASE64_'+idx);
      fail(page.mimeType===m[1], 'ORIGINAL_IMAGE_MIME_MISMATCH_'+idx);
      const digest=hash(raw);
      fail(isHash(page.sha256)&&page.sha256===digest,'EMBEDDED_IMAGE_HASH_MISMATCH_'+idx);
      if(originals)fail(digest===originals[String(idx)],'SOURCE_IMAGE_HASH_MISMATCH_'+idx);
      fail(Number.isInteger(page.width)&&page.width>0&&Number.isInteger(page.height)&&page.height>0,
        'ORIGINAL_IMAGE_DIMENSIONS_MISSING_'+idx);
      if(seen.has(digest))errors.push('DUPLICATE_IMAGE_NEEDS_SOURCE_REVIEW_'+idx);
      seen.add(digest);
    });
    // A self-declared pass inside private HTML is never accepted as independent 60-rule evidence.
    if(mode==='preview'&&/完成版|全文字照合済/.test(d.state||''))
      errors.push('UNSUPPORTED_PREVIEW_COMPLETION_CLAIM');
  }
  const chromeUrl=options.chromeUrl||null;
  if(chromeUrl){
    fail(safePublicEntry(options.loaderEntry),'EXPECTED_LOADER_ENTRY_REQUIRED');
    if(options.loaderEntry)fail(urlMatchesEntry(chromeUrl,options.loaderEntry),'CHROME_URL_NOT_LOADER_ENTRY');
  }
  warnings.push('CANONICAL_60_RULE_EVIDENCE_NOT_VERIFIED');
  warnings.push('CHROME_FILE_IMPORT_NOT_RUN');
  warnings.push('IPHONE_REAL_DEVICE_NOT_VERIFIED');
  const status=errors.length?'blocked':'structural_pass_only';
  return {schema:'reader-handoff-check-v2', status, bookId:d?.bookId||null, range:d?.range||null,
    artifactFile:filename, artifactBytes:bytes?.length||null, artifactSha256,
    originalImageCount:d?.pages?.length||0, originalImageBytes:sourceImageBytes,
    embeddedOriginalHashesSelfConsistent:!!d&&!errors.some(e=>e.startsWith('EMBEDDED_IMAGE_HASH_')),
    externalSourceHashesChecked:!!originals&&!errors.some(e=>e.startsWith('SOURCE_')),
    expectedShaMatched:!!options.expectedSha&&artifactSha256===options.expectedSha,
    profile:options.profile||null,mode,chromeUrl,loaderEntry:options.loaderEntry||null,
    publicHTTP:'not_run',chromeImport:'not_run',independentProofreading:'not_verified',
    iphoneDevice:'not_verified',deliveredAndVerified:false,contentCertified:false,releaseEligible:false,
    errors,warnings};
}
function main(args){
  const opts={};let file=null;
  for(let i=0;i<args.length;i++) {
    const a=args[i]; if(a==='--file')file=args[++i];
    else if(a==='--book')opts.bookId=args[++i];
    else if(a==='--title')opts.title=args[++i];
    else if(a==='--range'){
      let m=/^(\d+)-(\d+)$/.exec(args[++i]||'');
      if(!m)throw Error('INVALID_RANGE');
      opts.start=Number(m[1]);opts.end=Number(m[2]);
    }
    else if(a==='--mode')opts.mode=args[++i];
    else if(a==='--profile')opts.profile=args[++i];
    else if(a==='--expected-sha')opts.expectedSha=args[++i];
    else if(a==='--source-manifest')opts.sourceManifest=args[++i];
    else if(a==='--loader-entry')opts.loaderEntry=args[++i];
    else if(a==='--chrome-url')opts.chromeUrl=args[++i];
    else if(a==='--report')opts.report=args[++i];
    else throw Error('UNKNOWN_OPTION '+a);
  }
  if(!file)throw Error('Usage: reader-handoff-check.cjs --file PRIVATE.html --book ID --range 21-40 [--profile novel|world_history_1] [--mode preview|production] [--expected-sha SHA] [--source-manifest PRIVATE.json] [--chrome-url URL --loader-entry reader/BOOK/RANGE/index.html] [--report PRIVATE.json]');
  const result=inspect(file,opts);const body=JSON.stringify(result,null,2)+'\n';
  if(opts.report) {
    fs.mkdirSync(path.dirname(path.resolve(opts.report)),{recursive:true});
    fs.writeFileSync(opts.report,body);
  }
  process.stdout.write(body);if(result.errors.length)process.exitCode=1;
}
if(require.main===module){
  try{main(process.argv.slice(2));}
  catch(e){console.error('HANDOFF_BLOCKED '+e.message);process.exitCode=2;}
}
module.exports={inspect,extract,validateDateTime,urlMatchesEntry,safePublicEntry};
