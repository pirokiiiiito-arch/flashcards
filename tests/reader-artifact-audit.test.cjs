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
