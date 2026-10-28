'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const core=require('../drive-core.js');require('../drive-view-cache.js');require('../drive-local-view.js');
const {createTransport}=require('../drive-cached.js');
const namespace='colors1000-review47',TOKEN='test-access-token-never-persist';
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const image=new Blob(['synthetic picture'],{type:'image/png'}),hash=digest('synthetic picture'),ref='gdrive:photo1:'+hash;
function store(){const data=new Map();let fail=false;return {data,set fail(v){fail=v;},get:async k=>structuredClone(data.get(k)),getMany:async keys=>keys.map(k=>structuredClone(data.get(k))),writeBatch:async entries=>{if(fail)return false;for(const [k,v]of entries)data.set(k,structuredClone(v));return true;},info:()=>({available:!fail,writeFailed:fail}),subscribe(){},retry(){}};}
const event=(id,key,value,parents=[],deleted=false)=>({id,key,value,parents,deleted,clock:Number(id.replace(/\D/g,''))||1});
function server(ns=namespace){
 const calls=[],docs=new Map(),pictures=new Map([['photo1',image]]);let owner='account-one',online=true;
 docs.set('j1',{rev:'one',doc:{schema:core.schema,namespace:ns,events:[event('e1','photo:color-0001:palette',{data_url:ref,sha256:hash})]}});
 const json=x=>new Response(JSON.stringify(x),{headers:{'Content-Type':'application/json'}});
 const fetcher=async(url,options)=>{
  calls.push({url,options});if(!online)throw Error('offline');assert.equal(options.method,'GET');assert.equal(options.headers.Authorization,'Bearer '+TOKEN);
  const u=new URL(url);if(u.pathname.endsWith('/about'))return json({user:{permissionId:owner,email:'test@example.invalid'}});
  if(u.pathname.endsWith('/files'))return json({files:u.searchParams.get('q').includes("value='journal'")?[...docs].map(([id,x])=>({id,md5Checksum:x.rev})):[]});
  const id=u.pathname.split('/').pop();if(docs.has(id))return json(docs.get(id).doc);if(pictures.has(id))return new Response(pictures.get(id));return json({error:{message:'missing'}});
 };
 return {calls,docs,pictures,fetcher,set owner(v){owner=v;},set online(v){online=v;},media:()=>calls.filter(x=>x.url.includes('alt=media')).map(x=>new URL(x.url).pathname.split('/').pop())};
}
function setup(t,cache=store(),s=server(),ns=namespace){const api=createTransport({namespace:ns,core,cache,fetcher:s.fetcher});t.after(()=>api.disconnect());return {api,cache,s};}
async function initial(api){api.authorize(TOKEN,3600);await api.sync();await api.getBlob(ref);}
test('first visit saves verified photo and journal without credentials',async t=>{const {api,cache,s}=setup(t);await initial(api);assert.deepEqual(s.media(),['j1','photo1']);assert.equal(api.cacheInfo().photoSaved,1);assert.ok(!JSON.stringify([...cache.data]).includes(TOKEN));});
test('actual expiry timer retains current photographs and data',async t=>{
 const {api,s}=setup(t);await initial(api);api.authorize(TOKEN,30.01);await new Promise(r=>setTimeout(r,35));assert.equal(api.valid(),false);
 const n=s.calls.length;assert.equal(await (await api.getBlob(ref)).text(),'synthetic picture');assert.equal(s.calls.length,n);assert.ok(api.view().data['photo:color-0001:palette']);
});
test('reopened page restores cards and photos without Google or network',async t=>{
 const cache=store(),s=server(),a=setup(t,cache,s);await initial(a.api);a.api.disconnect();s.online=false;
 const b=setup(t,cache,s),n=s.calls.length;assert.equal((await b.api.hydrate()).fromCache,true);assert.ok(b.api.view().data['photo:color-0001:palette']);assert.equal(await (await b.api.getBlob(ref)).text(),'synthetic picture');assert.equal(s.calls.length,n);assert.equal(b.api.cacheInfo().photoDiskHits,1);
});
test('unchanged journals and photos are not downloaded again',async t=>{const {api,s}=setup(t);await initial(api);s.calls.length=0;assert.deepEqual((await api.sync()).delta,{downloaded:0,reused:1});assert.deepEqual(s.media(),[]);});
test('only new or changed journals download; explicit deletions are retained',async t=>{
 const {api,s}=setup(t);await initial(api);s.calls.length=0;s.docs.set('j2',{rev:'two',doc:{schema:core.schema,namespace,events:[event('e2','photo:color-0001:palette',null,['e1'],true)]}});
 const next=await api.sync();assert.deepEqual(s.media(),['j2']);assert.ok(next.view.deleted['photo:color-0001:palette']);
 s.calls.length=0;s.docs.set('j2',{rev:'three',doc:{schema:core.schema,namespace,events:[event('e2','photo:color-0001:palette',null,['e1'],true),event('e3','study:test','known')]}});await api.sync();assert.deepEqual(s.media(),['j2']);assert.ok(api.view().data['study:test']);
});
test('memory-evicted photo still loads from disk after disconnect',async t=>{
 const {api,s}=setup(t);await initial(api);for(let i=2;i<13;i++){const text='photo-'+i;s.pictures.set('p'+i,new Blob([text],{type:'image/png'}));await api.getBlob('gdrive:p'+i+':'+digest(text));}
 api.disconnect();s.online=false;const n=s.calls.length;assert.equal(await (await api.getBlob(ref)).text(),'synthetic picture');assert.equal(s.calls.length,n);
});
test('storage failure permits live display and reports unpersisted images',async t=>{const cache=store();cache.fail=true;const {api}=setup(t,cache);await initial(api);assert.equal(api.cacheInfo().unsavedPhotos,1);assert.equal(api.cacheInfo().writeFailed,true);api.disconnect();assert.equal(await (await api.getBlob(ref)).text(),'synthetic picture');});
test('failed new snapshot does not replace previous complete disk cache',async t=>{
 const cache=store(),s=server(),a=setup(t,cache,s);await initial(a.api);cache.fail=true;s.docs.set('j2',{rev:'two',doc:{schema:core.schema,namespace,events:[event('e2','study:new','known')]}});await a.api.sync();
 const b=setup(t,cache,s);await b.api.hydrate();assert.ok(!b.api.view().data['study:new']);assert.ok(b.api.view().data['photo:color-0001:palette']);
});
test('corrupt cached photo is checked and replaced only with verified bytes',async t=>{
 const cache=store(),s=server(),a=setup(t,cache,s);await initial(a.api);const k=[...cache.data.keys()].find(x=>x.includes('"blob"'));cache.data.set(k,new Blob(['bad'],{type:'image/png'}));
 const b=setup(t,cache,s);await b.api.hydrate();b.api.authorize(TOKEN,3600);await b.api.sync();s.calls.length=0;assert.equal(await (await b.api.getBlob(ref)).text(),'synthetic picture');assert.deepEqual(s.media(),['photo1']);assert.equal(await cache.data.get(k).text(),'synthetic picture');
});
test('wrong account cannot overwrite or merge saved data',async t=>{const {api,cache,s}=setup(t);await initial(api);s.owner='different-account';await assert.rejects(api.sync(),/アカウント/);assert.equal(api.account,'account-one');assert.ok(![...cache.data.keys()].some(x=>x.includes('different-account')));assert.ok(api.view().data['photo:color-0001:palette']);});
test('network failure leaves last state and photos intact',async t=>{const {api,s}=setup(t);await initial(api);s.online=false;await assert.rejects(api.sync(),/offline/);assert.ok(api.view().data['photo:color-0001:palette']);assert.equal(await (await api.getBlob(ref)).text(),'synthetic picture');});
test('plant and color manifests are isolated',async t=>{const cache=store(),a=setup(t,cache);await initial(a.api);const b=setup(t,cache,server('plant-flashcards'),'plant-flashcards');assert.equal(await b.api.hydrate(),null);assert.deepEqual(b.api.view().data,{});});
test('parallel picture reads deduplicate network and persistence',async t=>{const {api,s}=setup(t);api.authorize(TOKEN,3600);await api.sync();s.calls.length=0;await Promise.all([api.getBlob(ref),api.getBlob(ref),api.getBlob(ref)]);assert.deepEqual(s.media(),['photo1']);});
test('built viewers use cache and preserve palette and offline entries',()=>{
 const r=p=>fs.readFileSync(p,'utf8');assert.ok(r('plants/drive-view.html').includes('drive-cached.js?v=1'));assert.ok(r('colors/data/review47-cached-loader.js').includes('drive-cached.js?v=1'));assert.ok(r('colors/app-view.js').includes('<div class="palette-photo-row">'));
 for(const app of ['plants','colors']){assert.ok(r(app+'/service-worker.js').includes('./drive-view.html'));assert.ok(r(app+'/service-worker.js').includes("ignoreSearch:r.mode==='navigate'"));}
});
test('authorization, editors and protected datasets stay byte-identical',()=>{const report=JSON.parse(fs.readFileSync('cached-view-build.json','utf8'));assert.equal(report.authorization_unchanged,true);for(const [file,h]of Object.entries(report.protected_sha256))assert.equal(digest(fs.readFileSync(file)),h,file);});
