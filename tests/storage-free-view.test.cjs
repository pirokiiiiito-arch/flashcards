'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../drive-core.js'),reader=require('../drive-readonly.js');
const ns='colors1000-review47';
const body={id:'c1',name:'Example',group:'angiosperm',description:'text'};
const event={id:'e1',key:'card:c1',value:body,deleted:false,clock:1,parents:[]};
const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
function fixture({events=[event],image=new Blob(['sample image'],{type:'image/png'}),status=200,wrongNamespace=false}={}){
 const calls=[],statuses=[];
 const fetcher=async(url,options)=>{
   calls.push({url,options});assert.equal(options.method,'GET');assert.equal(new URL(url).origin,'https://www.googleapis.com');assert.equal(options.redirect,'error');
   const u=new URL(url);
   if(status!==200)return new Response('',{status});
   if(u.pathname.endsWith('/about'))return json({user:{permissionId:'account1',emailAddress:'user@example.test'}});
   if(u.pathname.endsWith('/files'))return json({files:u.searchParams.get('q').includes("value='journal'")?[{id:'journal1'}]:[{id:'image1',appProperties:{sha256:'a'.repeat(64)}}]});
   if(u.pathname.endsWith('/journal1'))return json({schema:core.schema,namespace:wrongNamespace?'other':ns,events});
   if(u.pathname.endsWith('/image1'))return new Response(image,{headers:{'Content-Type':image.type}});
   throw Error('unexpected URL '+url);
 };
 const api=reader.createTransport({namespace:ns,core,fetcher,onStatus:(s,m)=>statuses.push([s,m])});
 api.authorize('synthetic-test-token-not-a-credential',3600);
 return {api,calls,statuses,image};
}
test('receives journals even when all browser storage access throws',async()=>{
 const old=Object.getOwnPropertyDescriptor(globalThis,'indexedDB'),oldLS=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 Object.defineProperty(globalThis,'indexedDB',{configurable:true,get(){throw Error('simulated storage failure');}});
 Object.defineProperty(globalThis,'localStorage',{configurable:true,get(){throw Error('simulated storage failure');}});
 const f=fixture();
 try{const r=await f.api.sync();assert.equal(r.view.data['card:c1'].name,'Example');assert.equal(r.journals,1);assert.equal(r.imageFiles.length,1);assert.ok(f.calls.every(c=>c.options.method==='GET'));}
 finally{f.api.disconnect();if(old)Object.defineProperty(globalThis,'indexedDB',old);else delete globalThis.indexedDB;if(oldLS)Object.defineProperty(globalThis,'localStorage',oldLS);else delete globalThis.localStorage;}
});
test('fetches and hash verifies a photo without a persistent blob cache',async()=>{
 const f=fixture();
 try{const h=await core.digest(await f.image.arrayBuffer());const b=await f.api.getBlob('gdrive:image1:'+h);assert.equal(await b.text(),'sample image');await f.api.getBlob('gdrive:image1:'+h);assert.equal(f.calls.length,1);}
 finally{f.api.disconnect();}
});
test('hash mismatch is not displayed as a valid image',async()=>{
 const f=fixture();try{await assert.rejects(f.api.getBlob('gdrive:image1:'+'b'.repeat(64)),/SHA-256/);}finally{f.api.disconnect();}
});
test('401 clears authentication and does not leave a receiving status',async()=>{
 const f=fixture({status:401});try{await assert.rejects(f.api.sync());assert.equal(f.api.valid(),false);assert.equal(f.api.status().status,'未接続');}finally{f.api.disconnect();}
});
test('malformed and foreign namespaces do not populate the viewer',async()=>{
 const f=fixture({wrongNamespace:true});try{await assert.rejects(f.api.sync(),/履歴形式/);assert.deepEqual(f.api.view().data,{});}finally{f.api.disconnect();}
});
test('deletion history is materialized without being rewritten',async()=>{
 const deleted={...event,id:'e2',parents:['e1'],deleted:true,clock:2,value:null};const f=fixture({events:[event,deleted]});
 try{const r=await f.api.sync();assert.equal(r.view.data['card:c1'],undefined);assert.equal(r.view.deleted['card:c1'].id,'e2');assert.equal(f.api.putBlob,undefined);assert.equal(f.api.create,undefined);}finally{f.api.disconnect();}
});
test('conflicting immutable IDs fail instead of silently choosing data',async()=>{
 const f=fixture({events:[event,{...event,value:{...body,name:'changed'}}]});try{await assert.rejects(f.api.sync(),/競合/);}finally{f.api.disconnect();}
});
test('unauthenticated receive cannot access Drive or report success',async()=>{
 const f=fixture();f.api.disconnect();await assert.rejects(f.api.sync());assert.equal(f.calls.length,0);assert.equal(f.api.status().status,'未接続');
});
test('bounded response reader rejects oversized data',async()=>{
 await assert.rejects(reader.boundedBlob(new Response('large',{headers:{'content-length':'100'}}),10),/サイズ/);
 await assert.rejects(reader.boundedBlob(new Response('abcdef'),3),/大きすぎ/);
});
test('viewer build keeps Google controls, no old sync adapter or automatic migrations',()=>{
 const p=fs.readFileSync('plants/drive-view.html','utf8'),c=fs.readFileSync('colors/drive-view.html','utf8');
 assert.ok(p.includes('let cards=[];'));assert.ok(p.includes('const plantBootReady=Promise.resolve();'));
 assert.ok(p.includes('readonly-adapter.js?v=1'));assert.ok(!p.includes('src="./drive-sync.js'));
 assert.ok(!p.includes('serviceWorker.register'));assert.ok(!c.includes('serviceWorker.register'));
 assert.ok(c.includes('review47-view-loader.js?v=1'));
 for(const text of [p,c])for(const m of text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(m[1].trim())new vm.Script(m[1]);
});
test('color viewer bypasses IndexedDB initialization and keeps private ref normalization',()=>{
 const a=fs.readFileSync('colors/app-view.js','utf8'),e=fs.readFileSync('colors/origin-editor-view.js','utf8'),l=fs.readFileSync('colors/data/review47-view-loader.js','utf8');
 new vm.Script(a);new vm.Script(e);new vm.Script(l);
 assert.ok(a.includes('const readyImages=Promise.resolve().then('));
 assert.ok(!a.includes('imageDb=await openImageDb()'));
 assert.ok(a.includes('ColorNetworkSupport.normalize'));
 assert.ok(e.includes('function previewRecords(input){records=validateRecords(input||{});render();}'));
 assert.ok(!l.includes('drive-sync.js'));assert.ok(!l.includes('recovery-import.js'));assert.ok(!l.includes('installExport()'));
});
test('storage-free transport never contains mutation methods, storage access or token persistence',()=>{
 const src=fs.readFileSync('drive-readonly.js','utf8');
 assert.ok(!src.includes('indexedDB.'));assert.ok(!src.includes('localStorage.'));assert.ok(!src.includes("method:'POST'"));assert.ok(!src.includes("method:'PATCH'"));assert.ok(!src.includes("method:'DELETE'"));
 const guard=fs.readFileSync('readonly-guard.js','utf8');assert.ok(guard.includes("'swatch'"));assert.ok(guard.includes('p.textContent!==hint'));
});
