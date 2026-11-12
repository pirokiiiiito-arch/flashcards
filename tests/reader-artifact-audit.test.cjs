'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {audit}=require('../tools/reader-artifact-audit.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const picture=Buffer.from('pretend-test-jpeg-bytes');
function fixture({pages=2,text=true,broken=false,approved=false}={}){
 const rows=Array.from({length:pages},(_,i)=>({
  scan:i+1,pageType:'prose',hasReadableProse:'yes',fileName:'scan'+(i+1)+'.jpg',
  dataUrl:'data:image/jpeg;base64,'+picture.toString('base64'),
  sha256:broken&&i===1?'0'.repeat(64):sha(picture),width:300,height:400,
  blocks:text?[{kind:'body',text:'検査用の文章。'}]:[],
  proofStatus:approved?'passed':'not_run'
 }));
 const doc={bookId:'fixture',range:[1,pages],state:'制作中',pages:rows};
 return '<!doctype html><script id="embedded-data" type="application/json">'+JSON.stringify(doc)+'</script>';
}
test('count, source byte hashes and first-pass text are verified without claiming full OCR proof',()=>{
 const r=audit(fixture());
 assert.equal(r.structuralStatus,'passed');assert.equal(r.originals,2);
 assert.equal(r.OCRTextPages,2);assert.equal(r.wholePageProofed,0);
 assert.equal(r.errors.length,0);
});
test('missing or damaged original JPEG blocks the artifact',()=>{
 const r=audit(fixture({broken:true}));
 assert.match(r.errors.join(' '),/SOURCE_SHA256_MISMATCH/);
});
test('OCR text zero is rejected instead of showing an empty book',()=>{
 const r=audit(fixture({text:false}));
 assert.match(r.errors.join(' '),/READABLE_PROSE_WITHOUT_TEXT/);
 assert.match(r.errors.join(' '),/ZERO_OCR_TEXT/);
});
test('a wrong scan range blocks release',()=>{
 const r=audit(fixture(),11,12);
 assert.match(r.errors.join(' '),/DUPLICATE_OR_OUT_OF_ORDER_SCAN/);
});
test('unknown HTML cannot be silently treated as verified',()=>{
 const r=audit('<html><body>unstructured</body></html>');
 assert.match(r.errors.join(' '),/UNSUPPORTED_FORMAT/);
});
test('an unverified artifact cannot label itself complete',()=>{
 const html=fixture().replace('"state":"制作中"','"state":"読書用完成"');
 const r=audit(html);
 assert.match(r.errors.join(' '),/FALSE_COMPLETION_LABEL/);
});

// Revision safety: a text correction invalidates passes, not known open defects.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const pipeline=require('../tools/reader-private-pipeline.cjs'),validator=require('../tools/reader-release-control.cjs');
function reviseKnownIssue(checkId,status){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reader-known-defect-'));
 try{
  const input=path.join(dir,'input.html'),loader=path.join(dir,'loader.html'),index=path.join(dir,'index.json');
  fs.writeFileSync(input,fixture());fs.writeFileSync(loader,'synthetic loader');fs.writeFileSync(index,JSON.stringify({'1':sha(picture),'2':sha(picture)}));
  const work=path.join(dir,'private'),m=pipeline.init(input,work,'test-known-defect',loader,index),manifest=path.join(work,'manifest.json');
  const checks=validator.json(work,m.checks);checks[checkId]={status};
  const b=JSON.stringify(checks);fs.writeFileSync(path.join(work,m.checks.path),b);m.checks.sha256=sha(b);fs.writeFileSync(manifest,JSON.stringify(m));
  const event=path.join(dir,'edit.json');fs.writeFileSync(event,JSON.stringify({scan:1,pointer:'blocks/0/text',before:'検査用の文章。',after:'訂正文。',actor:'test-only',reason:'synthetic source correction',sourceRegion:'r1',at:'2026-11-12',expectedCanonicalSha256:m.canonical.sha256}));
  const next=pipeline.correct(manifest,event);
  assert.equal(validator.json(work,next.checks)[checkId].status,'not_run');
  assert.ok(validator.json(work,next.resolutions).openIssues.some(i=>i.checkId===checkId&&i.priorStatus===status));
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
}
test('a text edit cannot erase a known device failure during status invalidation',()=>reviseKnownIssue('G8-04','failed'));
test('unresolved source discrepancies remain open across a new text revision',()=>reviseKnownIssue('G3-07','needs_source_review'));
