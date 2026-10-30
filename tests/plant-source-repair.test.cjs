'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {create}=require('../plants/legacy-photo-source.js');
const DATA='data:image/jpeg;base64,/9j/4AAB/9k=',blob=new Blob([Buffer.from('/9j/4AAB/9k=','base64')],{type:'image/jpeg'});
const hash=async bytes=>crypto.createHash('sha256').update(Buffer.from(bytes)).digest('hex');
function fixture({session=true,differentAccount=false}={}){
 const cards=[{id:'seed-one',name:'test',description:'test',images:['','','']}],calls=[];let clock=100000,uploaded=0,authPrompt=0;
 const view={data:{'card:seed-one':cards[0],'migration:supabase-images:user-one':{images:0}},deleted:{}};
 const api={request:async()=>({json:async()=>({user:{emailAddress:differentAccount?'other@example.invalid':'owner@example.invalid'}})}),putBlob:async b=>{uploaded++;assert.equal(await hash(await b.arrayBuffer()),await hash(await blob.arrayBuffer()));return 'gdrive:image:'+await hash(await b.arrayBuffer());},getBlob:async()=>blob,digest:hash};
 const source=create({url:'https://example.supabase.co',publicKey:'public-key',getApi:()=>api,now:()=>clock,
  getSession:async()=>session?{access_token:'end-user-token',user:{id:'user-one'}}:null,getCards:()=>cards,getImages:c=>c.images,
  resolveLocal:async()=>'',toDataURL:async()=>DATA,onAuthRequired:()=>{authPrompt++;},
  fetch:async(url,options)=>{
   calls.push({url,options});assert.equal(options.headers.Authorization,'Bearer end-user-token');assert.equal(options.headers.apikey,'public-key');
   if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:'user-one',email:'owner@example.invalid'}));
   if(url.endsWith('/list/plant-images')){const {prefix}=JSON.parse(options.body);return new Response(JSON.stringify(prefix==='user-one'?[{name:'seed-one',id:null}]:[0,1,2].map(i=>({name:i+'.jpg',id:'object-'+i,updated_at:'2026-01-01T00:00:00Z'}))));}
   return new Response(blob);
  }});
 return {source,view,api,cards,calls,advance:()=>{clock+=61000;},uploaded:()=>uploaded,prompt:()=>authPrompt};
}
test('a historical completed/zero marker does not suppress missing photo recovery',async()=>{
 const f=fixture(),out=await f.source.migrate(f.api,f.view);assert.equal(Object.keys(out.data).length,3);assert.equal(f.uploaded(),3);assert.equal(f.source.status().source,3);
 for(const c of f.calls)assert.ok(!['DELETE','PUT','PATCH'].includes(c.options.method));
});
test('new old-source photos are detected again after an earlier successful scan',async()=>{
 const f=fixture();f.view.data['image:seed-one:0']='gdrive:existing';f.view.data['image:seed-one:1']='gdrive:existing';f.view.data['image:seed-one:2']='gdrive:existing';
 assert.equal(await f.source.migrate(f.api,f.view),null);delete f.view.data['image:seed-one:2'];f.advance();assert.deepEqual(Object.keys((await f.source.migrate(f.api,f.view)).data),['image:seed-one:2']);
});
test('existing assignments, explicit removals and local edits are not replaced',async()=>{
 const f=fixture();f.view.data['image:seed-one:0']='keep-current';f.view.deleted['image:seed-one:1']={deleted:true};f.cards[0].images[2]='idb:local-change';assert.equal(await f.source.migrate(f.api,f.view),null);assert.equal(f.uploaded(),0);assert.equal(f.cards[0].images[2],'idb:local-change');
});
test('missing local bytes can be read from the exact original slot with user authentication',async()=>{
 const f=fixture();f.cards[0].images[1]='idb:missing-on-device';assert.equal(await f.source.resolve('idb:missing-on-device'),DATA);assert.ok(f.calls.some(c=>c.url.endsWith('/user-one/seed-one/1.jpg')));
});
test('different owners cannot mix old pictures into a Drive account',async()=>{
 const f=fixture({differentAccount:true});await assert.rejects(f.source.migrate(f.api,f.view),/アカウントが異なります/);f.cards[0].images[1]='idb:missing';await assert.rejects(f.source.resolve('idb:missing'),/アカウントが異なります/);assert.equal(f.uploaded(),0);assert.ok(!f.calls.some(c=>c.url.includes('/storage/')));
});
test('missing authentication prompts for the original login and performs no privileged read',async()=>{
 const f=fixture({session:false});assert.equal(await f.source.migrate(f.api,f.view),null);assert.equal(f.prompt(),1);assert.equal(f.calls.length,0);
});
test('viewer, auth, word app, source datasets, color cards and storage remain identical',()=>{
 const report=JSON.parse(fs.readFileSync('plants/source-repair-build.json','utf8'));assert.equal(report.privileged_server_added,false);assert.equal(report.source_permissions_changed,false);
 for(const [p,h] of Object.entries(report.protected_sha256))assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'),h,p);
});
test('PC entry includes versioned repair and regular save still schedules sync',()=>{
 for(const p of ['plants/index.html','plants/plant-sync-v2.html']){const s=fs.readFileSync(p,'utf8');assert.ok(s.includes('legacy-photo-source.js?v=1'));assert.ok(s.includes('drive-sync.js?v=plantsource1'));}
 const s=fs.readFileSync('plants/drive-sync.js','utf8');assert.ok(s.includes('legacySource.migrate(api,view)'));assert.ok(s.includes('legacySource.resolve(v)'));assert.ok(s.includes('sync.changed(); if (sync.valid()) queueMicrotask(() => sync.sync().catch(() => {})); return r;'));
 assert.ok(!s.includes("if (view.data[marker]) return null"));
});
