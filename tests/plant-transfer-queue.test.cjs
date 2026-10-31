'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const core=require('../drive-core.js'),source=fs.readFileSync('plants/drive-transfer-core.js','utf8');
const ref='gdrive:test-image:'+'a'.repeat(64);
function event(id,key,value,parents=[],deleted=false){return {id,key,value,parents,deleted,clock:Number(id.replace(/\D/g,''))||1};}
function harness(events,convert){
 const writes=[],state={events:Object.fromEntries(events.map(e=>[e.id,structuredClone(e)])),pending:events.map(e=>e.id),seen:{}};
 const c={state,cfg:{namespace:'plant-flashcards',toCloudValue:convert||((k,v)=>{if(v==='idb:missing'){const e=Error('missing');e.plantPhotoDeferred=true;throw e;}return v;})},api:{},clone:structuredClone,materialize:core.materialize,SCHEMA:core.schema,device:'test-device',uuid:()=>String(writes.length),Blob,Set,Date,Error,deferredPhotoKeys:new Set(),deferPhoto:e=>e?.plantPhotoDeferred===true&&!e.auth,persist:async()=>{},create:async(name,blob)=>{writes.push(JSON.parse(await blob.text()));return {id:'journal-'+writes.length};}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('    async function push() {'),source.indexOf('    async function recoverDeletedPrefix')),c);return {c,state,writes};
}
test('unavailable image cannot block another photo or card; original remains pending',async()=>{
 const e=[event('e1','image:a:0','idb:missing'),event('e2','image:b:0',ref),event('e3','card:b',{id:'b',name:'new',description:''})],h=harness(e);await h.c.push();
 assert.deepEqual(h.state.pending,['e1']);assert.equal(h.state.events.e1.value,'idb:missing');assert.equal(h.writes.length,1);assert.deepEqual(h.writes[0].events.map(x=>x.id),['e2','e3']);assert.ok(!JSON.stringify(h.writes).includes('idb:missing'));
});
test('newer replacement can publish without erasing its unavailable parent; late parent never wins',async()=>{
 const e=[event('e1','image:a:0','idb:missing'),event('e2','image:a:0',ref,['e1'])],h=harness(e);await h.c.push();assert.equal(h.writes[0].events[0].parents[0],'e1');
 h.c.cfg.toCloudValue=()=>ref;await h.c.push();assert.equal(h.state.pending.length,0);const remote=Object.fromEntries(h.writes.flatMap(d=>d.events).map(x=>[x.id,x]));assert.equal(core.heads(remote).get('image:a:0')[0].id,'e2');
});
test('new image registration can supersede a pulled tombstone when it names the tombstone as parent',()=>{
 const tomb=event('e1','image:a:0',null,[],true),fresh=event('e2','image:a:0',ref,['e1']);
 const view=core.materialize({e1:tomb,e2:fresh});
 assert.equal(view.data['image:a:0'],ref);
 assert.equal(view.deleted['image:a:0'],undefined);
});
test('explicit removal publishes and cannot be resurrected when its old photo is retried',async()=>{
 const h=harness([event('e1','image:a:0','idb:missing'),event('e2','image:a:0',null,['e1'],true)]);await h.c.push();assert.equal(h.writes[0].events[0].deleted,true);h.c.cfg.toCloudValue=()=>ref;await h.c.push();assert.ok(core.materialize(h.state.events).deleted['image:a:0']);
});
test('Drive/auth failures are not treated as unavailable source photos',async()=>{
 const e=Error('authentication required');e.auth=true;e.plantPhotoDeferred=true;const h=harness([event('e1','image:a:0','data:image/png;base64,x')],()=>{throw e;});await assert.rejects(h.c.push());assert.equal(h.writes.length,0);assert.equal(h.state.pending.length,1);
});
test('failed journal acknowledgement does not mutate event values or remove pending IDs',async()=>{
 const h=harness([event('e1','image:a:0','data:image/png;base64,original')],()=>ref);h.c.create=async()=>{throw Error('network');};await assert.rejects(h.c.push());assert.equal(h.state.events.e1.value,'data:image/png;base64,original');assert.deepEqual(h.state.pending,['e1']);
});
test('only successful IDs are acknowledged when more than one 250-event batch is needed',async()=>{
 const events=Array.from({length:520},(_,i)=>event('e'+(i+1),'image:card'+i+':0',i%100===0?'idb:missing':ref));const h=harness(events);await h.c.push();assert.equal(h.state.pending.length,6);assert.equal(h.writes.length,3);assert.equal(h.writes.flatMap(x=>x.events).length,514);
});
test('changes added during an upload are still pending afterwards',async()=>{
 const h=harness([event('e1','image:a:0',ref)]),create=h.c.create;h.c.create=async(...args)=>{h.state.events.e2=event('e2','card:new',{id:'new'});h.state.pending.push('e2');return create(...args);};await h.c.push();assert.deepEqual(h.state.pending,['e2']);
});
test('fallback is available when the local IndexedDB reader rejects, not only when it returns empty',async()=>{
 const S=require('../plants/legacy-photo-source.js'),blob=new Blob(['verified synthetic bytes']);let sourceReads=0;
 const reader=S.create({url:'https://example.invalid',publicKey:'public-test',getSession:async()=>({access_token:'test',user:{id:'owner'}}),getCards:()=>[{id:'plant',images:['idb:missing']}],getImages:c=>c.images,resolveLocal:async()=>{throw Error('IndexedDB unavailable');},getApi:()=>({request:async()=>({json:async()=>({user:{emailAddress:'owner@example.invalid'}})})}),fetch:async url=>{if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:'owner',email:'owner@example.invalid'}));sourceReads++;return new Response(blob);},toDataURL:async()=> 'data:image/png;base64,test'});
 assert.equal(await reader.resolve('idb:missing'),'data:image/png;base64,test');assert.equal(sourceReads,1);
});
test('external http image URL can publish as a phone fallback while device-only refs stay deferred',()=>{
 const built=fs.readFileSync('plants/drive-sync.js','utf8');
 assert.ok(built.includes("/^(idb:|data:image\\/|blob:)/.test(String(v))"));
 assert.ok(built.includes("!/^https?:\\/\\//i.test(String(ref))"));
});
test('focused card image references can be requeued without bulk-resending the whole deck',()=>{
 const coreText=fs.readFileSync('plants/drive-transfer-core.js','utf8');
 const syncText=fs.readFileSync('plants/drive-sync.js','utf8');
 assert.ok(coreText.includes('async function republish(keys)'));
 assert.ok(!coreText.includes('pendingKeys.has(key)'));
 assert.ok(coreText.includes('pendingKeys: () => state ? [...new Set(state.pending.map(id => state.events[id]?.key).filter(Boolean))] : []'));
 assert.ok(coreText.includes('await pull();'));
 assert.ok(coreText.includes('const current = await cfg.read(), currentHeads = heads(state.events);'));
 assert.ok(coreText.includes("const parents = currentHeads.get(key)?.map(e => e.id) || basis[key] || [];"));
 assert.ok(!syncText.includes('await sync.sync();\n      copier.retry();'));
 assert.ok(syncText.includes('sync.republish?.(keys)'));
 assert.ok(syncText.includes('republishedCards'));
 assert.ok(syncText.includes('publishVisibleCardImages'));
 assert.ok(syncText.includes('originalRenderForImageShare'));
 assert.ok(syncText.includes('queueMicrotask(() => publishVisibleCardImages()'));
 assert.ok(syncText.includes('setTimeout(() => publishVisibleCardImages().catch(() => {}), 0)'));
 assert.ok(syncText.includes('keys.some(key => stillPending.has(key))'));
 assert.ok(syncText.includes('setTimeout(() => publishVisibleCardImages().catch(() => {}), 60000)'));
});
test('only the plant editor selects the specialized queue core',()=>{
 for(const p of ['plants/index.html','plants/plant-sync-v2.html']){const s=fs.readFileSync(p,'utf8');assert.ok(s.includes('./drive-transfer-core.js?v=queue2'));assert.ok(s.includes('./drive-sync.js?v=queue1')||s.includes('./drive-sync.js?v=authsettled13'));}
 const report=JSON.parse(fs.readFileSync('plants/transfer-queue-build.json','utf8'));for(const [p,hash] of Object.entries(report.protected_sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),hash,p);
});

test('plant broker auto-binds an already connected token on startup without opening legacy OAuth dialog',async()=>{
 const start=source.indexOf('    async function prepareAuth() {'),end=source.indexOf('    function open() {',start);
 assert.ok(start>=0&&end>start,'derived plant token initialization must be present');
 const scope='https://www.googleapis.com/auth/drive.appdata',publicId='test-public.apps.googleusercontent.com';
 let registered=0,applied=0,synced=0;const statuses=[];
 const c={root:{FLASHCARDS_DRIVE_CONFIG:{clientId:publicId},PersistentDriveAuth:{
   initTokenClient(options){registered++;queueMicrotask(()=>options.callback({access_token:'synthetic-token',expires_in:3600,scope}));return {requestAccessToken(){}};},
   hasGrantedAllScopes:(response,wanted)=>response.scope===wanted}},
  connect:{disabled:true},input:{value:''},CLIENT_KEY:'test-client-key',configured:()=>publicId,loadGIS:async()=>{},
  localStorage:{getItem:()=>'',setItem:(key,value)=>{assert.equal(value,publicId)}},
  SCOPE:scope,token:'',expires:0,expiryTimer:0,expire:()=>{},clearTimeout:()=>{},setTimeout:()=>1,Date,
  cfg:{enablePrimary:async()=>{applied++}},setStatus:(value)=>statuses.push(value),
  sync:async()=>{synced++},error:e=>{throw e},Promise};
 vm.createContext(c);vm.runInContext(source.slice(start,end),c);
 await vm.runInContext('prepareAuth()',c);
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(registered,1);
 assert.equal(c.connect.disabled,false);
 assert.equal(c.token,'synthetic-token');
 assert.equal(applied,1);
 assert.equal(synced,1);
 assert.ok(statuses.includes('接続済み'));
});
