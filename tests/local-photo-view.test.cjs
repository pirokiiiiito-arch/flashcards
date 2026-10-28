'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const core=require('../drive-core.js'),Local=require('../drive-local-view.js'),Cache=require('../drive-view-cache.js'),Base=require('../drive-local-base.js');
const pause=()=>new Promise(r=>setImmediate(r));
const clone=x=>structuredClone(x);
function memoryStore(){const data=new Map();return {data,fail:false,async get(k){return data.has(k)?clone(data.get(k)):null;},async put(k,v){if(this.fail)return {durable:false};data.set(k,clone(v));return {durable:true};}};}
function fakeIDB(){
 const data=new Map(),control={data,failWrites:false,failReads:false};
 const db={objectStoreNames:{contains:()=>true},close(){},transaction(store,mode){
   const tx={error:null,abort(){this.error=Error('aborted');this.onabort?.();},objectStore(){return {
    get(key){const req={};queueMicrotask(()=>{if(control.failReads){tx.error=Error('read failure');tx.onabort?.();}else{req.result=data.has(key)?clone(data.get(key)):undefined;tx.oncomplete?.();}});return req;},
    put(value,key){const req={};queueMicrotask(()=>{if(control.failWrites){tx.error=Object.assign(Error('full'),{name:'QuotaExceededError'});tx.onabort?.();}else{data.set(key,clone(value));req.result=key;tx.oncomplete?.();}});return req;}
   };}};return tx;}};
 control.open=()=>{const req={};queueMicrotask(()=>{req.result=db;req.onsuccess?.();});return req;};return control;
}
function fakeCaches(){
 const stores=new Map(),control={failWrites:false,stores};
 control.open=async name=>{if(!stores.has(name))stores.set(name,new Map());const data=stores.get(name);return {
  match:async key=>data.get(String(key))?.clone(),
  put:async(key,response)=>{if(control.failWrites)throw Error('cache full');data.set(String(key),response.clone());},
  addAll:async requests=>{for(const r of requests)data.set(r.url,new Response('cached:'+r.url));}
 };};return control;
}
const png=new Uint8Array([137,80,78,71,13,10,26,10,1,2,3]);
async function fixture(namespace='colors1000-review47'){
 const hash=await core.digest(png),ref='gdrive:picture_1:'+hash;
 const event={id:'event-1',key:namespace==='plant-flashcards'?'image:p1:0':'photo:color-0001:palette',parents:[],clock:1,value:namespace==='plant-flashcards'?ref:{data_url:ref,sha256:hash},deleted:false};
 const state={namespace,account:'account-one',offline:false,unauthorized:false,requests:[],media:{},journals:[{id:'journal_1',md5Checksum:'first',events:[event]}],imageFiles:[{id:'picture_1',appProperties:{sha256:hash},sha256Checksum:hash,mimeType:'image/png'}]};
 const fetcher=async(url,options)=>{
  assert.equal(options.method,'GET');state.requests.push(url);
  if(state.offline)throw TypeError('offline');
  if(state.unauthorized)return new Response('{}',{status:401});
  const u=new URL(url);
  if(u.pathname.endsWith('/about'))return Response.json({user:{permissionId:state.account,email:'test@example.invalid'}});
  if(u.pathname.endsWith('/files')){
   const journal=u.searchParams.get('q').includes("value='journal'");
   return Response.json({files:journal?state.journals.map(({events,...f})=>f):state.imageFiles});
  }
  const id=u.pathname.split('/').pop();state.media[id]=(state.media[id]||0)+1;
  if(id==='picture_1')return new Response(png,{headers:{'content-type':'image/png'}});
  const journal=state.journals.find(j=>j.id===id);
  if(journal)return Response.json({schema:core.schema,namespace,events:journal.events});
  return new Response('{}',{status:404});
 };
 return {state,ref,hash,event,fetcher};
}
function transport(f,store,onCache=()=>{}){return Local.createTransport({namespace:f.state.namespace,clientId:'test-client',core,store,onCache,fetcher:f.fetcher,baseFactory:Base.createTransport});}

test('IndexedDB image bytes survive a new cache instance',async()=>{
 const idb=fakeIDB(),opts={indexedDB:idb,cacheStorage:null},a=Cache.createStore(opts);
 assert.equal((await a.put('image',new Blob([png],{type:'image/png'}))).durable,true);
 const b=Cache.createStore(opts);assert.deepEqual(new Uint8Array(await (await b.get('image')).arrayBuffer()),png);
});
test('a quota failure falls back and never disables reads of earlier saved images',async()=>{
 const idb=fakeIDB(),caches=fakeCaches(),opts={indexedDB:idb,cacheStorage:caches},s=Cache.createStore(opts);
 await s.put('earlier',new Blob([png]));await s.put('updated',{v:1});idb.failWrites=true;
 assert.equal((await s.put('updated',{v:2})).backend,'CacheStorage');
 assert.ok(await s.get('earlier') instanceof Blob);assert.deepEqual(await s.get('updated'),{v:2});
 idb.failWrites=false;assert.deepEqual(await Cache.createStore(opts).get('updated'),{v:2});
});
test('CacheStorage alone preserves snapshots and binary photos after reopening',async()=>{
 const c=fakeCaches(),opts={indexedDB:null,cacheStorage:c},s=Cache.createStore(opts);
 await s.put('snapshot',{a:1});await s.put('photo',new Blob([png],{type:'image/png'}));
 const second=Cache.createStore(opts);assert.deepEqual(await second.get('snapshot'),{a:1});assert.deepEqual(new Uint8Array(await (await second.get('photo')).arrayBuffer()),png);
});
test('both unavailable stores report failure without claiming a durable save',async()=>{
 const warnings=[],s=Cache.createStore({indexedDB:null,cacheStorage:null,onWarning:m=>warnings.push(m)});
 assert.equal((await s.put('x',{x:1})).durable,false);assert.equal(await s.get('x'),null);assert.equal(warnings.length,1);
});
for(const namespace of ['plant-flashcards','colors1000-review47']){
 test(namespace+': a new page restores metadata and photos without login or any network request',async t=>{
  const f=await fixture(namespace),store=memoryStore(),a=transport(f,store);t.after(()=>a.disconnect());
  a.authorize('synthetic-test-token',3600);await a.sync();await a.getBlob(f.ref);a.disconnect();
  const before=f.state.requests.length;f.state.offline=true;
  const b=transport(f,store);t.after(()=>b.disconnect());const restored=await b.restore();
  assert.equal(b.valid(),false);assert.equal(restored.cached,true);assert.ok(Object.keys(restored.view.data).length);
  assert.deepEqual(new Uint8Array(await (await b.getBlob(f.ref)).arrayBuffer()),png);assert.equal(f.state.requests.length,before);
 });
}
test('expiry leaves displayed images and cached metadata accessible',async t=>{
 const f=await fixture(),s=memoryStore(),a=transport(f,s);t.after(()=>a.disconnect());a.authorize('synthetic-test-token',3600);await a.sync();const image=await a.getBlob(f.ref);
 a.disconnect('認証期限が切れました。');f.state.offline=true;assert.equal(a.status().status,'保存済みで閲覧');assert.deepEqual(await a.getBlob(f.ref),image);assert.ok(Object.keys(a.view().data).length);
});
test('unchanged journals are not downloaded on the second sync or in a new session',async t=>{
 const f=await fixture(),s=memoryStore(),a=transport(f,s);t.after(()=>a.disconnect());a.authorize('synthetic-test-token',3600);
 const first=await a.sync(),second=await a.sync();assert.equal(first.fetchedJournals,1);assert.equal(second.fetchedJournals,0);assert.equal(second.reusedJournals,1);assert.equal(f.state.media.journal_1,1);
 a.disconnect();const b=transport(f,s);t.after(()=>b.disconnect());b.authorize('synthetic-test-token',3600);await b.sync();assert.equal(f.state.media.journal_1,1);
});
test('only new and changed journal bodies are fetched and explicit deletion remains effective',async t=>{
 const f=await fixture(),s=memoryStore(),a=transport(f,s);t.after(()=>a.disconnect());a.authorize('synthetic-test-token',3600);await a.sync();
 f.state.journals.push({id:'journal_2',md5Checksum:'new',events:[{...f.event,id:'event-2',parents:['event-1'],clock:2,deleted:true,value:null}]});
 const next=await a.sync();assert.equal(next.fetchedJournals,1);assert.equal(f.state.media.journal_1,1);assert.equal(f.state.media.journal_2,1);assert.ok(next.view.deleted[f.event.key]);
 f.state.journals[1].md5Checksum='modified';f.state.journals[1].events[0].clock=3;await a.sync();assert.equal(f.state.media.journal_1,1);assert.equal(f.state.media.journal_2,2);
});
test('failed differential sync preserves the last complete offline snapshot',async t=>{
 const f=await fixture(),s=memoryStore(),a=transport(f,s);t.after(()=>a.disconnect());a.authorize('synthetic-test-token',3600);await a.sync();await a.getBlob(f.ref);
 f.state.offline=true;await assert.rejects(a.sync());const b=transport(f,s);t.after(()=>b.disconnect());const result=await b.restore();assert.ok(result.view.data[f.event.key]);await b.getBlob(f.ref);
});
test('a new Google account cannot overwrite or mix the existing local archive',async t=>{
 const f=await fixture(),s=memoryStore(),a=transport(f,s);t.after(()=>a.disconnect());a.authorize('synthetic-test-token',3600);await a.sync();await a.getBlob(f.ref);
 const before=[...s.data].map(([k,v])=>[k,v instanceof Blob?'blob':JSON.stringify(v)]);f.state.account='different-account';
 a.authorize('synthetic-other-token',3600);await assert.rejects(a.sync(),/別のGoogle/);assert.equal(a.account,'account-one');assert.deepEqual([...s.data].map(([k,v])=>[k,v instanceof Blob?'blob':JSON.stringify(v)]),before);
});
test('corrupt image bytes are never displayed as a verified cached photo',async t=>{
 const f=await fixture(),s=memoryStore(),a=transport(f,s);t.after(()=>a.disconnect());a.authorize('synthetic-test-token',3600);await a.sync();await a.getBlob(f.ref);a.disconnect();
 const key=[...s.data.keys()].find(k=>k.includes(':photo:'));s.data.set(key,new Blob(['corrupt']));const b=transport(f,s);t.after(()=>b.disconnect());await b.restore();await assert.rejects(b.getBlob(f.ref),/まだ端末/);
});
test('a photo save failure is visible and does not erase the image on expiry',async t=>{
 const f=await fixture(),s=memoryStore(),messages=[],a=transport(f,s,info=>messages.push(info));t.after(()=>a.disconnect());a.authorize('synthetic-test-token',3600);await a.sync();s.fail=true;
 const blob=await a.getBlob(f.ref);a.disconnect();f.state.offline=true;assert.deepEqual(await a.getBlob(f.ref),blob);assert.ok(messages.some(x=>x.durable===false));assert.equal(a.status().stats.savedImages,0);
});
test('snapshots, journals and photo cache contain no authentication credential',async t=>{
 const f=await fixture(),s=memoryStore(),a=transport(f,s);t.after(()=>a.disconnect());a.authorize('synthetic-credential-not-to-be-stored',3600);await a.sync();await a.getBlob(f.ref);
 const serialized=JSON.stringify([...s.data].filter(([,v])=>!(v instanceof Blob)));assert.ok(!serialized.includes('synthetic-credential'));assert.ok(!serialized.includes('Authorization'));
});
test('the real installer applies the previous snapshot on startup without connecting',async t=>{
 const f=await fixture(),s=memoryStore(),a=transport(f,s);t.after(()=>a.disconnect());a.authorize('synthetic-test-token',3600);await a.sync();await a.getBlob(f.ref);a.disconnect();f.state.offline=true;
 const before=f.state.requests.length,el=()=>({style:{},dataset:{},append(){},prepend(){},setAttribute(){},textContent:'',disabled:false,scrollIntoView(){}}),toolbar=el();let applied=null;
 const root={FlashcardsDrive:core,navigator:{onLine:false},fetch:f.fetcher,DriveLocalView:{createTransport:opts=>Local.createTransport({...opts,store:s,clientId:'test-client',fetcher:f.fetcher,baseFactory:Base.createTransport})}};
 const context={window:root,document:{querySelector:()=>toolbar,body:toolbar,createElement:el},console,URL,URLSearchParams,Map,Set,Blob,Response,AbortController,setTimeout,clearTimeout,structuredClone};
 vm.createContext(context);vm.runInContext(fs.readFileSync('drive-local-base.js','utf8'),context);
 const b=root.DriveReadOnly.install({namespace:f.state.namespace,ready:Promise.resolve(),apply:async result=>{applied=result;},summary:()=>''});t.after(()=>b.disconnect());
 for(let i=0;i<20&&!applied;i++)await pause();assert.ok(applied?.cached);assert.equal(f.state.requests.length,before);assert.equal(b.valid(),false);await b.getBlob(f.ref);
});
test('offline worker routes viewer files only and never caches Drive or other applications',async()=>{
 const handlers={},caches=fakeCaches();const self={location:{href:'https://example.test/flashcards/colors/drive-view-worker.js'},clients:{claim:async()=>{}},skipWaiting:async()=>{},addEventListener:(name,fn)=>handlers[name]=fn};
 const context={self,caches,URL,Request,Response,Set,fetch:async()=>{throw Error('network must not be needed');}};vm.createContext(context);vm.runInContext(fs.readFileSync('colors/drive-view-worker.js','utf8'),context);
 let installing;handlers.install({waitUntil:p=>installing=p});await installing;
 let response;handlers.fetch({request:{method:'GET',mode:'navigate',url:'https://example.test/flashcards/colors/drive-view.html?local=1'},respondWith:p=>response=p});assert.ok((await (await response).text()).includes('drive-view.html'));
 for(const url of ['https://www.googleapis.com/drive/v3/files/x?alt=media','https://example.test/flashcards/','https://example.test/flashcards/plants/index.html']){let used=false;handlers.fetch({request:{method:'GET',mode:'navigate',url},respondWith(){used=true;}});assert.equal(used,false);}
});
test('built viewers include startup cache, offline shell, five photo roles and unchanged editors',()=>{
 const text=p=>fs.readFileSync(p,'utf8');
 assert.ok(text('plants/drive-view.html').includes('drive-local-view.js?v=1'));assert.ok(text('colors/drive-view.html').includes('review47-local-loader.js?v=1'));
 assert.ok(text('colors/data/review47-local-loader.js').includes('drive-local-view.js?v=1'));assert.ok(text('colors/app-view.js').includes("photoSlot(index,'palette')"));
 assert.ok(text('view-shell.js').includes("scope:'./drive-view.html'"));
 const report=JSON.parse(text('local-view-build.json'));assert.equal(report.authentication_changed,false);assert.equal(report.drive_writes_added,false);
 const crypto=require('node:crypto');for(const [path,sha] of Object.entries(report.protected_sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path)).digest('hex'),sha,path);
});
