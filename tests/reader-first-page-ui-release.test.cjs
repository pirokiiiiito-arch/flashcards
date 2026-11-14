'use strict';
// Synthetic-only public UI gate checks; no OCR, private images or claimed iPhone run.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const v=require('../tools/reader-release-control.cjs');
const root=path.resolve(__dirname,'..');
const policy=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/release-policy.json')));
const temp=[];
test.after(()=>temp.forEach(p=>fs.rmSync(p,{recursive:true,force:true})));
function snapshot(){const p=fs.mkdtempSync(path.join(os.tmpdir(),'firstpage-ui-'));temp.push(p);fs.cpSync(path.join(root,'reader'),path.join(p,'reader'),{recursive:true});return p;}
test('only exact UK first-page loader is admitted; frozen baseline remains unchanged',()=>{
 const changed=v.admittedFirstPageUI(root,policy);
 assert.deepEqual(Object.keys(changed),['reader/british-interiors/full/index.html']);
 assert.match(changed['reader/british-interiors/full/index.html'],/^[a-f0-9]{64}$/);
 assert.equal(Object.keys(policy.baseline.files).length,80);
 assert.equal(Object.keys(policy.baseline.books).length,11);
});
test('an unexpected byte in a book loader still blocks publication',()=>{
 const r=snapshot();fs.appendFileSync(path.join(r,'reader/british-interiors/full/index.html'),'\n<!-- unauthorized edit -->');
 assert.throws(()=>v.admittedFirstPageUI(r,policy),/FIRST_PAGE_UI_BYTES_NOT_REVIEWED/);
});
test('unrelated existing books remain protected from unauthorized changes',()=>{
 const r=snapshot();fs.appendFileSync(path.join(r,'reader/wh2/161-180/index.html'),'\n<!-- unauthorized edit -->');
 assert.match(v.validateRepository(r).errors.join('|'),/UNAUTHORIZED_READER_CHANGE/);
});
test('every other saved book uses the existing shared first-page navigation',()=>{
 const shared=fs.readFileSync(path.join(root,'reader/library/wh1-exact-pagination.js'),'utf8');
 const read=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 const routing=fs.readFileSync(path.join(root,'reader/library/wh1-reader-routing.js'),'utf8');
 assert.match(shared,/first\.textContent='最初へ'/);
 assert.match(shared,/type:'bookStart'/);
 assert.match(read,/if\(d\.type==='bookStart'\)/);
 assert.match(routing,/ENTRY = 'read-wh1-v9.html'/);
});
