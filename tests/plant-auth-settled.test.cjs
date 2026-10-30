'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const UI=require('../plants/source-auth-ui.js');
const ref='gdrive:test-picture:'+('a'.repeat(64)),pending={authRequired:true};
const card=(images=['','',''])=>({id:'one',name:'植物',images});
const imgs=c=>c.images;
test('a successful source login never keeps the auth prompt visible',()=>{
 for(const c of [card(),card(['idb:missing','','']),card([ref,ref,ref])])assert.equal(UI.required({authRequired:false},[c],imgs),false);
});
test('all photos on Drive need no legacy login after that old session expires',()=>{
 assert.equal(UI.required(pending,[card([ref,ref,ref])],imgs),false);
 assert.equal(UI.required(pending,[card()],imgs,{data:{'image:one:0':ref}}),false);
});
test('a missing device reference still offers old-source authentication',()=>{
 assert.equal(UI.required(pending,[card([ref,'idb:missing',''])],imgs),true);
 assert.equal(UI.required(pending,[card(['idb:new','',''])],imgs,{data:{'image:one:0':ref}}),true);
});
test('direct local or external sources do not need old-storage credentials',()=>{
 for(const src of ['data:image/png;base64,eA==','blob:local-photo','https://example.invalid/image.jpg'])assert.equal(UI.required(pending,[card([src,'',''])],imgs),false);
});
test('initial recovery remains available when no photo assignments have arrived',()=>{
 assert.equal(UI.required(pending,[card()],imgs,{data:{},deleted:{}}),true);
});
test('explicit deletion does not ask to resurrect old photos',()=>{
 assert.equal(UI.required(pending,[card(['idb:deleted','',''])],imgs,{deleted:{'image:one:0':{}}}),false);
 assert.equal(UI.required(pending,[card(['idb:deleted','',''])],imgs,{deleted:{'card:one':{}}}),false);
});
test('display decisions leave all data untouched',()=>{
 const c=[card([ref,'idb:missing',''])],v={data:{'image:one:0':ref},deleted:{}},state={...pending};
 const before=JSON.stringify([c,v,state]);UI.required(state,c,imgs,v);assert.equal(JSON.stringify([c,v,state]),before);
});
test('built editor refreshes the prompt on login status, image copy, and completion',()=>{
 const s=fs.readFileSync('plants/drive-sync.js','utf8');assert.ok(s.includes('onAuthRequired:refreshSourceAuth'));
 assert.ok((s.match(/refreshSourceAuth\(\);/g)||[]).length>=3);
 for(const p of ['plants/index.html','plants/plant-sync-v2.html','plants/service-worker.js']){
  const t=fs.readFileSync(p,'utf8');assert.ok(t.includes('source-auth-ui.js?v=1'),p);assert.ok(t.includes('drive-sync.js?v=authsettled7'),p);
 }
});
test('photos, names, order, Google auth, old-source reader, transfer and viewers unchanged',()=>{
 const report=JSON.parse(fs.readFileSync('plants/auth-settled-build.json','utf8'));
 for(const [p,expected] of Object.entries(report.protected_sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),expected,p);
});
