'use strict';
// Private inputs only. This verifies the review trail and its correspondence
// with the delivered bytes. The visual judgements belong to the reviewer.
const fs = require('node:fs');
const path = require('node:path');
const {createHash} = require('node:crypto');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const int = Number.isSafeInteger;
function check(ok, message) { if (!ok) throw Error(message); }
function privateBytes(root, ref) {
  check(ref && typeof ref.path === 'string' && !path.isAbsolute(ref.path) &&
    ref.path.split(/[\\/]/).every(s => s && s !== '.' && s !== '..') && isHash(ref.sha256), 'invalid evidence reference');
  const file = fs.realpathSync(path.resolve(root, ref.path));
  check(file.startsWith(fs.realpathSync(root) + path.sep), 'evidence outside the inventory folder');
  const bytes = fs.readFileSync(file);
  check(sha(bytes) === ref.sha256, 'changed evidence: ' + ref.path);
  return bytes;
}
function rect(box, width, height) {
  return Array.isArray(box) && box.length === 4 && box.every(int) && 0 <= box[0] &&
    box[0] < box[2] && box[2] <= width && 0 <= box[1] && box[1] < box[3] && box[3] <= height;
}
function overlap(a,b) {
  return a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
}
function array(value, label) {check(Array.isArray(value),label+' must be an array');return value;}
function blockMap(page) {
  const result = new Map();
  array(page.blocks,'blocks').forEach((b,i) => {
    const key = b.id ?? '#'+i;
    check(typeof key === 'string' && key.length && !result.has(key), 'missing or duplicate block identity');
    result.set(key,b);
  });
  return result;
}
function portion(text,start,end) { return text.slice(start,end).join(''); }
function spanKey(id, s, text, dims) {
  check(int(s.start) && int(s.end) && 0 <= s.start && s.start < s.end && s.end <= text.length &&
    typeof s.base === 'string' && s.base.trim() && portion(text,s.start,s.end) === s.base &&
    typeof s.reading === 'string' && s.reading.trim() && rect(s.sourceBox,...dims), 'invalid printed reading: '+id);
  check(['right','left'].includes(s.side??'right'),'invalid printed side: '+id);
  return JSON.stringify([id,s.start,s.end,s.base,s.reading,s.side??'right']);
}
function textRevision(block, changes, dims) {
  const src = Array.from(block.text ?? '');
  let pos=0, value='';
  for (const c of changes) {
    check(int(c.start) && int(c.end) && pos <= c.start && c.start <= c.end && c.end <= src.length &&
      typeof c.old === 'string' && c.old === portion(src,c.start,c.end) && typeof c.new === 'string' &&
      c.old !== c.new && rect(c.sourceBox,...dims), 'invalid or overlapping parent-text correction');
    value += portion(src,pos,c.start) + c.new;
    pos=c.end;
  }
  value+=portion(src,pos,src.length);
  function shift(at) {
    let offset=0;
    for (const c of changes) {
      if (c.end <= at) offset+=Array.from(c.new).length-(c.end-c.start);
      else if (c.start < at && Array.from(c.new).length !== c.end-c.start)
        throw Error('annotation ends inside a length-changing replacement; record finalStart/finalEnd');
    }
    return at+offset;
  }
  return {text:value,shift};
}
function matchEdition(page,baseline,review,dims) {
  const baselineBlocks=baseline.blocks.slice();
  const insertions=review.insertBlocks??[];
  for(const row of array(insertions,'source block insertions')){
    const block=row.block, anchor=row.beforeId??row.afterId;
    check((row.beforeId!=null)!==(row.afterId!=null) && block && typeof block.id==='string' &&
      typeof block.text==='string' && block.text.length && rect(row.sourceBox,...dims) && !(block.ruby?.length),
      'new text block needs an original location and one adjacent block');
    const pos=baselineBlocks.findIndex(b=>b.id===anchor);
    check(pos>=0 && !baselineBlocks.some(b=>b.id===block.id),'ambiguous inserted block');
    baselineBlocks.splice(pos+(row.afterId!=null?1:0),0,block);
  }
  const before=blockMap({...baseline,blocks:baselineBlocks}), after=blockMap(page), boxes=[], expected=new Map(), observed=new Map();
  check(JSON.stringify([...before.keys()])===JSON.stringify([...after.keys()]),'unexplained change in source block identity/order');
  const annotations=array(review.annotations,'annotations'), changes=array(review.corrections,'corrections');
  for (const item of [...annotations,...changes]) check(before.has(item.blockId),'reviewed block missing: '+item.blockId);
  for (const [id,b] of before) {
    const actual=after.get(id);
    check(actual,'source block missing: '+id);
    const edits=changes.filter(c=>c.blockId===id).sort((a,b)=>a.start-b.start);
    const revision=textRevision(b,edits,dims), text=Array.from(actual.text??'');
    check(revision.text === text.join(''),'unexplained text change: '+id);
    for (const s of actual.ruby??[]) {
      check(s.reviewStatus==='verified' && s.sourceScan===page.scan && s.sourceImageSha256===page.sha256,
        'reading belongs to another original');
      const key=spanKey(id,s,text,dims);
      check(!observed.has(key),'duplicate reading in edition');
      observed.set(key,s.sourceBox);boxes.push(s.sourceBox);
    }
    for (const s of [...(b.ruby??[]), ...annotations.filter(a=>a.blockId===id)]) {
      const explicit=s.finalStart !== undefined || s.finalEnd !== undefined;
      const local=s.correctedStartInReplacement!==undefined || s.correctedEndInReplacement!==undefined;
      let start=explicit?s.finalStart:revision.shift(s.start),end=explicit?s.finalEnd:revision.shift(s.end);
      if(local){
        const edit=edits.find(e=>e.start===s.start&&e.end===s.end);
        check(!explicit&&edit&&int(s.correctedStartInReplacement)&&int(s.correctedEndInReplacement) &&
          0<=s.correctedStartInReplacement && s.correctedStartInReplacement<s.correctedEndInReplacement &&
          s.correctedEndInReplacement<=Array.from(edit.new).length,'invalid relative correction anchor');
        end=start+s.correctedEndInReplacement;start+=s.correctedStartInReplacement;
      }
      const key=spanKey(id,{...s,start,end},text,dims);
      if(!expected.has(key))expected.set(key,[]);
      expected.get(key).push(s.sourceBox);
    }
  }
  // Independent reviewers may crop the same printed characters a few pixels differently.
  // Keep an actual reviewed box and require the corresponding other observations to overlap.
  check(expected.size===observed.size && [...expected].every(([k,alternatives])=>{
    const used=observed.get(k);
    return used && alternatives.some(b=>b.every((n,i)=>n===used[i])) && alternatives.every(b=>overlap(b,used));
  }),
    'originally recorded and rendered readings differ');
  return boxes;
}
function inspectPage(root, row, page) {
  const load=ref=>JSON.parse(privateBytes(root,ref));
  const base=load(row.baseline);
  const ocr=row.ocr?load(row.ocr):null;
  check(ocr || row.candidateSource==='visual-only', 'supply raw OCR or declare original-only inspection');
  const dims=ocr?[ocr.width,ocr.height]:[page.width??base.width,page.height??base.height];
  check(isHash(page.sha256) && (!ocr||ocr.scan===page.scan && ocr.source_sha256===page.sha256) && base.scan===page.scan && base.sha256===page.sha256 && dims.every(n=>int(n)&&n>0) &&
    (page.width==null||page.width===dims[0]) && (page.height==null||page.height===dims[1]), 'source page/hash/dimensions changed');
  if (typeof page.dataUrl==='string') {
    const split=page.dataUrl.indexOf(',');
    check(split>=0 && /;base64$/i.test(page.dataUrl.slice(0,split)) &&
      sha(Buffer.from(page.dataUrl.slice(split+1),'base64'))===page.sha256, 'original in edition changed');
  } else {
    check(sha(privateBytes(root,row.image))===page.sha256,'original image bytes required');
  }
  const raw=array(ocr?ocr.rows:[],'raw OCR rows').filter(r=>r.kind==='block_rubi');
  check(raw.every(r=>rect(r.box,...dims)),'invalid original candidate coordinates');
  if (!row.review) return {visual:false,pending:raw.length,issues:[],readings:0,imageReadings:0,candidates:raw.length};
  const review=load(row.review);
  check(review.scan===page.scan && review.sourceSha256===page.sha256 &&
    ['partial','complete'].includes(review.visualReview),'review does not match source');
  const visual=review.visualReview==='complete';
  check(!visual || typeof review.method==='string' && review.method.trim(), 'whole-page visual inspection method missing');
  const boxes=matchEdition(page,base,review,dims);
  const retainedCount=boxes.length, imageReadings=review.imageOnlyReadings??[];
  if(imageReadings.length){
    check(review.imageOnly===true && page.pageType==='image' && page.blocks.length===0 &&
      typeof page.dataUrl==='string', 'image-only reading must be displayed by its checked original image');
    const seen=new Set();
    for(const s of imageReadings){
      check(typeof s.base==='string'&&s.base.trim()&&typeof s.reading==='string'&&s.reading.trim() &&
        rect(s.sourceBox,...dims) && ['right','left','above','below'].includes(s.side??'right'),
        'invalid printed reading on facsimile');
      const key=JSON.stringify([s.sourceBox,s.side??'right']);
      check(!seen.has(key),'duplicate facsimile reading');seen.add(key);boxes.push(s.sourceBox);
    }
  }
  const covered=new Set(), rows=array(review.candidates,'candidate decisions');
  for(const d of rows) {
    check(int(d.index)&&0<=d.index&&d.index<raw.length&&!covered.has(d.index),'invalid or duplicate candidate decision');
    check(['ruby','non-ruby','duplicate','unresolved'].includes(d.status)&&typeof d.reason==='string'&&d.reason.trim(),
      'candidate disposition or original evidence missing');
    covered.add(d.index);
    if (d.status==='ruby' || d.status==='duplicate') {
      const links=d.rubyBoxes;
      if(links!==undefined){
        check(Array.isArray(links)&&links.length>0&&links.every(b=>boxes.some(x=>JSON.stringify(b)===JSON.stringify(x))),
          'candidate references an absent printed reading');
      }else check(boxes.some(b=>overlap(b,raw[d.index].box)),'no retained reading corresponds to candidate '+d.index);
    } else if(d.status==='non-ruby') {
      check(!boxes.some(b=>JSON.stringify(b)===JSON.stringify(raw[d.index].box)),'same box marked both non-ruby and printed reading');
    }
  }
  const pending=raw.length-covered.size+rows.filter(d=>d.status==='unresolved').length;
  return {visual,pending,issues:array(review.unresolved,'unresolved issues'),readings:retainedCount,imageReadings:imageReadings.length,candidates:raw.length};
}
function audit(book, artifactSha256, inventoryFile, expectedInventoryHash) {
  const bytes=fs.readFileSync(inventoryFile), inv=JSON.parse(bytes), root=path.dirname(inventoryFile);
  if(expectedInventoryHash)check(sha(bytes)===expectedInventoryHash,'inventory hash changed');
  check(inv.schema==='reader-ruby-inventory-v1' && inv.bookId===book.bookId &&
    JSON.stringify(inv.range)===JSON.stringify(book.range),'inventory identity/range mismatch');
  const [lo,hi]=book.range;
  check(int(lo)&&int(hi)&&lo>0&&hi>=lo&&book.pages.length===hi-lo+1 &&
    book.pages.every((p,i)=>p.scan===lo+i),'missing or duplicate original scan');
  const rows=new Map();
  for(const r of array(inv.pages,'source pages')){
    check(int(r.scan)&&r.scan>=lo&&r.scan<=hi&&!rows.has(r.scan),'duplicate/out-of-range review page');
    rows.set(r.scan,r);
  }
  const report={schema:'reader-ruby-coverage-v1',bookId:book.bookId,range:book.range,artifactSha256,
    inventorySha256:sha(bytes),status:'complete',totalPages:book.pages.length,visuallyReviewedPages:0,
    candidates:0,unresolvedCandidates:0,renderedReadings:0,facsimileReadings:0,unvalidatedPages:[],incomplete:[],errors:[]};
  for(const page of book.pages){
    const row=rows.get(page.scan);
    if(!row){report.unvalidatedPages.push(page.scan);report.incomplete.push({scan:page.scan,reason:'missing source inventory'});continue;}
    try{
      const s=inspectPage(root,row,page);
      report.visuallyReviewedPages+=Number(s.visual);report.candidates+=s.candidates;
      report.unresolvedCandidates+=s.pending;report.renderedReadings+=s.readings;report.facsimileReadings+=s.imageReadings;
      if(!s.visual||s.pending||s.issues.length)report.incomplete.push({scan:page.scan,
        visualReview:s.visual?'complete':'partial',unresolvedCandidates:s.pending,unresolvedIssues:s.issues.length});
    }catch(error){report.unvalidatedPages.push(page.scan);report.errors.push({scan:page.scan,reason:error.message});}
  }
  if(report.errors.length || report.incomplete.length)report.status='partial';
  return report;
}
function main(args){
  const opts={};
  for(let i=0;i<args.length;i+=2){check(['--artifact','--inventory','--out'].includes(args[i])&&args[i+1],'expected file option');opts[args[i]]=args[i+1];}
  const raw=fs.readFileSync(opts['--artifact']);
  const matches=[...raw.toString('utf8').matchAll(/<script\b(?=[^>]*\bid=["'](?:bookdata|embedded-data)["'])[^>]*>([\s\S]*?)<\/script\s*>/gi)];
  check(matches.length===1,'exactly one embedded book record is required');
  let book=JSON.parse(matches[0][1]);
  if(Array.isArray(book)){const inv=JSON.parse(fs.readFileSync(opts['--inventory']));book={bookId:inv.bookId,range:inv.range,pages:book};}
  const report=audit(book,sha(raw),opts['--inventory']);
  const output=opts['--out'];
  check(typeof output==='string' && ![opts['--inventory'],opts['--artifact']].some(f=>path.resolve(output)===path.resolve(f)),
    'output must differ from inputs');
  check(!fs.existsSync(output)||!fs.lstatSync(output).isSymbolicLink(),'output may not be a symlink');
  fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(report.status+' '+report.visuallyReviewedPages+'/'+report.totalPages+' pages; '+report.unresolvedCandidates+' pending in checked inputs; '+report.unvalidatedPages.length+' unvalidated pages');
  if(report.status!=='complete')process.exitCode=2;
}
module.exports={audit};
if(require.main===module)try{main(process.argv.slice(2));}catch(e){console.error(e.message);process.exitCode=1;}
