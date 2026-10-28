'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Core=require('../drive-core.js'),Local=require('../drive-local-view.js'),Cache=require('../drive-view-cache.js'),Legacy=require('../drive-legacy-view.js');
const mem=()=>({data:new Map(),async get(k){return this.data.get(k)||null;},async put(k,v){this.data.set(k,structuredClone(v));return {durable:true};}});
const plant={id:'p1',group:'angiosperm',name:'保存済み植物名',description:'編集した説明',sort_order:1};
const empty=()=>({data:{},deleted:{},conflicts:[]});
function stub(result){return {valid:()=>false,view:()=>empty(),status:()=>({}),setStatus(){},disconnect(){},sync:async()=>structuredClone(result),getBlob:async()=>{throw Error('network not allowed');},account:'owner'};}
function api(store,legacy,result={account:'owner',view:empty(),imageFiles:[]}){return Local.createTransport({namespace:'plant-flashcards',clientId:'test',core:Core,store,legacy,baseFactory:()=>stub(result)});}
test('word worker activation preserves both generations of private caches',async()=>{
 const removed=[],handlers={},keys=['flashcards-v13','flashcards-v17-word-network2','flashcards-v18-private-cache-safe','flashcards-view-private-v1','flashcards-private-view-v2','flashcards-local-view-shell-v2-colors'];
 vm.runInNewContext(fs.readFileSync('service-worker.js','utf8'),{self:{addEventListener:(n,f)=>handlers[n]=f,clients:{claim:async()=>{}}},caches:{keys:async()=>keys,delete:async k=>removed.push(k)}});
 let task;handlers.activate({waitUntil:p=>task=p});await task;
 assert.deepEqual(removed,['flashcards-v13','flashcards-v17-word-network2']);
});
test('fallback cache uses a name even the old faulty worker will not remove',async()=>{
 const buckets=new Map(),fake={open:async n=>{if(!buckets.has(n))buckets.set(n,new Map());const b=buckets.get(n);return {put:async(k,r)=>b.set(k,r.clone()),match:async k=>b.get(k)?.clone()};}};
 const a=Cache.createStore({indexedDB:null,cacheStorage:fake});await a.put('names',{name:plant.name});await a.put('photo',new Blob(['saved photo']));
 for(const n of [...buckets.keys()])if(n.startsWith('flashcards-v'))buckets.delete(n);
 const b=Cache.createStore({indexedDB:null,cacheStorage:fake});assert.equal((await b.get('names')).name,plant.name);assert.equal(await (await b.get('photo')).text(),'saved photo');
});
test('legacy saved names appear without login and the old archive is not mutated',async()=>{
 const old={account:'owner',view:{...empty(),data:{'card:p1':plant}},imageFiles:[],source:'existing-device-sync-cache'},before=JSON.stringify(old),store=mem();
 const a=api(store,{snapshot:async()=>old,photo:async()=>null});const r=await a.restore();
 assert.equal(r.view.data['card:p1'].name,plant.name);assert.equal(r.cached,true);assert.equal(JSON.stringify(old),before);
 assert.equal((await api(store,null).restore()).view.data['card:p1'].name,plant.name);
});
test('an empty receive does not replace previously saved names with zero',async()=>{
 const a=api(mem(),{snapshot:async()=>({account:'owner',view:{...empty(),data:{'card:p1':plant}},imageFiles:[]}),photo:async()=>null});await a.ready;
 assert.equal((await a.sync()).view.data['card:p1'].name,plant.name);
});
test('explicit deletion still removes the intended card',async()=>{
 const a=api(mem(),{snapshot:async()=>({account:'owner',view:{...empty(),data:{'card:p1':plant}},imageFiles:[]})},{account:'owner',view:{...empty(),deleted:{'card:p1':{id:'delete-p1',key:'card:p1',deleted:true}}},imageFiles:[]});await a.ready;
 assert.ok(!(await a.sync()).view.data['card:p1']);
});
test('malformed received names do not overwrite a good cached record',async()=>{
 const store=mem(),a=api(store,{snapshot:async()=>({account:'owner',view:{...empty(),data:{'card:p1':plant}},imageFiles:[]})},{account:'owner',view:{...empty(),data:{'card:p1':{id:'p1',name:null}}},imageFiles:[]});await a.ready;
 await assert.rejects(a.sync(),/植物名/);assert.equal(a.view().data['card:p1'].name,plant.name);
 assert.equal((await api(store,null).restore()).view.data['card:p1'].name,plant.name);
});
test('old photo bytes are recovered by exact reference and verified hash without Drive',async()=>{
 const blob=new Blob(['original image bytes'],{type:'image/png'}),hash=await Core.digest(await blob.arrayBuffer()),ref='gdrive:img:'+hash;
 const a=api(mem(),{snapshot:async()=>({account:'owner',view:{...empty(),data:{'card:p1':plant,'image:p1:0':ref}},imageFiles:[]}),photo:async r=>r===ref?blob:null});
 await a.ready;assert.equal(await (await a.getBlob(ref)).text(),'original image bytes');
});
test('missing old database is never created',async()=>{
 let opens=0;const r=Legacy.createReader({databases:async()=>[],open(){opens++;throw Error('must not open');}},10);
 assert.equal(await r.snapshot('plant-flashcards',Core),null);assert.equal(opens,0);
});
test('fresh entry aliases share the existing data keys and retain palette photos',()=>{
 for(const app of ['plants','colors'])assert.equal(fs.readFileSync(app+'/saved-view.html','utf8'),fs.readFileSync(app+'/drive-view.html','utf8'));
 assert.ok(fs.readFileSync('colors/app-view.js','utf8').includes("photoSlot(index,'palette')"));
 assert.ok(fs.readFileSync('colors/data/review47-local-loader-v2.js','utf8').includes('drive-legacy-view.js?v=2'));
 assert.ok(fs.readFileSync('plants/drive-view.html','utf8').includes('drive-legacy-view.js?v=2'));
});
