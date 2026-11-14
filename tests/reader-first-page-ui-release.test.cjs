'use strict';
// Public UI-only release regression. This is not source/scan OCR or iPhone proof.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const v=require('../tools/reader-release-control.cjs');
const root=path.resolve(__dirname,'..');
const policy=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/release-policy.json')));
function tmpReader(){
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'reader-firstpage-ui-'));
 fs.cpSync(path.join(root,'reader'),path.join(tmp,'reader'),{recursive:true});
 return tmp;
}
const tmp=[];
test.after(()=>tmp.forEach(d=>fs.rmSync(d,{recursive:true,force:true})));
test('the four exact UI changes are atomic, and the frozen OCR baseline is unchanged',()=>{
 const accepted=v.admittedFirstPageUI(root,policy);
 assert.deepEqual(Object.keys(accepted).sort(),[
  'reader/british-interiors/full/index.html',
  'reader/library/read.html',
  'reader/library/read-wh1-v9.html',
  'reader/library/wh1-library-v9-build.json'
 ].sort());
 assert.ok(Object.values(accepted).every(x=>/^[a-f0-9]{64}$/.test(x)));
 assert.equal(Object.keys(policy.baseline.files).length,80);
 assert.equal(Object.keys(policy.baseline.books).length,11);
});
test('one byte of unexpected UI markup fails closed instead of silently updating the baseline',()=>{
 const d=tmpReader();tmp.push(d);
 const f=path.join(d,'reader/british-interiors/full/index.html');
 fs.appendFileSync(f,'\n<!-- unexpected not-admitted mutation -->\n');
 assert.throws(()=>v.admittedFirstPageUI(d,policy),/FIRST_PAGE_UI_BYTES_NOT_REVIEWED/);
});
test('partial first-page release fails rather than serving a stale WH1 generated entry',()=>{
 const q=structuredClone(policy);
 q.baseline.files['reader/library/wh1-library-v9-build.json']=v.hash(fs.readFileSync(path.join(root,'reader/library/wh1-library-v9-build.json')));
 assert.throws(()=>v.admittedFirstPageUI(root,q),/FIRST_PAGE_UI_PARTIAL_RELEASE/);
});
test('unrelated reader changes are still prohibited',()=>{
 const d=tmpReader();tmp.push(d);
 fs.appendFileSync(path.join(d,'reader/wh2/161-180/index.html'),'\n<!-- unreviewed text -->');
 assert.match(v.validateRepository(d).errors.join('|'),/UNAUTHORIZED_READER_CHANGE/);
});
test('existing private book engine remains hash-pinned and no original source is added',()=>{
 const uk=fs.readFileSync(path.join(root,'reader/british-interiors/full/index.html'),'utf8');
 const generic=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 assert.match(uk,/TRUSTED_ENGINE_SHA256='580e233afe48319518b02c1a0c57446f68e339b4fb9c5db43c7a06c909b271ca'/);
 assert.match(generic,/\$\('firstPageButton'\)\.hidden=BOOK_ID==='wh1'/);
 assert.doesNotMatch(uk,/<script id="(?:bookdata|embedded-data)"/);
});

test('generic future books and the existing WH1 both navigate to their first page',()=>{
 const generic=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 const match=generic.match(/function goToBeginning\(\)\{[\s\S]*?\n\}\nwindow\.addEventListener\('message'/);
 assert.ok(match,'shared reader exposes an executable beginning action');
 const body=match[0].replace(/\nwindow\.addEventListener\('message'$/,'');
 for(const activeSegment of [0,2]){
  let calls=[],closed=0;
  const fn=new Function('bookZip','SEGMENTS','activeSegment','closeMenu','closeOriginal','issueChild','openSegment','setHint','console',body+';return goToBeginning;');
  const go=fn({},[{}, {}, {}],activeSegment,()=>closed++,()=>closed++,
   (action,data)=>calls.push({kind:'bridge',action,data}),
   (index,destination)=>{calls.push({kind:'segment',index,destination});return Promise.resolve();},
   ()=>{throw Error('Unexpected error')},console);
  go();
  assert.equal(closed,2);
  assert.equal(calls.length,1);
  if(activeSegment===0){assert.equal(calls[0].action,'goto');assert.equal(calls[0].data.destination.mode,'first');}
  else{assert.equal(calls[0].index,0);assert.equal(calls[0].destination.mode,'first');}
 }
});
