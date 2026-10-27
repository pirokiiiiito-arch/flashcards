'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {createHash}=require('node:crypto');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const core=require('../drive-core.js');
const production=require('../word-network-recovery.js');
const cards=Array.from({length:59},(_,i)=>({id:'synthetic-'+i,word:'sample-'+i,meaning:'example\n'+i,sort_order:i+1,updated_at:'2020-01-01T00:00:00.000Z'}));
const sha=s=>createHash('sha256').update(s).digest('hex');
const fixtureSha=sha(production.canonical(cards));
const payload={schema:'word-flashcards-recovery-v1',source_record_count:59,content_sha256:fixtureSha,cards};
// The public tests contain only synthetic data. Substitute its digest in an isolated VM,
// never in the production file, so the real hash verification path is executed.
function setup({failure=null,digestWrong=false,identity='test-account'}={}){
 const source=fs.readFileSync(path.join(__dirname,'../word-network-recovery.js'),'utf8').replace(production.expectedSha,fixtureSha);
 const context={module:{exports:{}},AbortController,setTimeout,clearTimeout,structuredClone};
 vm.runInNewContext(source,context);
 const recovery=context.module.exports, cache=new Map();let requests=0;
 const api={valid:()=>true,account:'test-account',setStatus:()=>{},digest:async s=>digestWrong?'bad':sha(s),cache:{get:async(s,k)=>cache.get(k),put:async(s,k,v)=>cache.set(k,v)},request:async(url,options)=>{
   requests++;assert.equal(url,production.endpoint);assert.equal(options.method,'POST');
   if(failure)throw failure;
   return {json:async()=>({...payload,google_permission_id:identity})};
 }};
 return {recovery,api,cache,requests:()=>requests};
}
const empty=()=>({data:{},deleted:{},conflicts:[]});
function materializePlan(plan){
 let n=0;const events={};
 for(const [key,value] of Object.entries(plan.data)){const id='test:'+n++;events[id]={id,key,value,deleted:false,parents:[],clock:n};}
 return core.materialize(events);
}
test('empty device fetches and hash-verifies 59 synthetic words before materializing the complete view',async()=>{
 const s=setup();const view=empty();const before=JSON.stringify(view);
 const plan=await s.recovery.prepare(s.api,view,{});
 assert.equal(s.requests(),1);assert.equal(Object.keys(plan.data).filter(k=>k.startsWith('card:')).length,59);
 assert.equal(s.cache.size,1);assert.equal(JSON.stringify(view),before);
 const materialized=materializePlan(plan);const counts=s.recovery.verifyApplied(materialized,materialized.data);
 assert.equal(counts.drive,59);assert.equal(counts.local,59);
 assert.equal(s.recovery.diagnostics().received,59);
});
test('old completion marker with zero words cannot skip network recovery',async()=>{
 const s=setup();const view=empty();view.data[s.recovery.marker]={schema:'word-network-migration-v1',source_sha256:fixtureSha,source_count:59};
 await s.recovery.prepare(s.api,view,{});assert.equal(s.requests(),1);
});
test('new marker with missing covered records also retries the network',async()=>{
 const s=setup();const view=empty();view.data[s.recovery.marker]={schema:'word-network-migration-v2',source_sha256:fixtureSha,source_count:59,covered_keys:cards.map(c=>'card:'+c.id)};
 assert.equal(s.recovery.markerCovers(view),false);await s.recovery.prepare(s.api,view,{});assert.equal(s.requests(),1);
});
test('verified complete view is idempotent and does not refetch or duplicate',async()=>{
 const s=setup();const plan=await s.recovery.prepare(s.api,empty(),{});const view=materializePlan(plan);
 assert.equal(await s.recovery.prepare(s.api,view,view.data),null);assert.equal(s.requests(),1);
});
test('wrong Google identity never writes a backup or returns an import plan',async()=>{
 const s=setup({identity:'different-account'});await assert.rejects(s.recovery.prepare(s.api,empty(),{}),/アカウント/);assert.equal(s.cache.size,0);
});
test('hash mismatch is rejected before saving or preparing data',async()=>{
 const s=setup({digestWrong:true});await assert.rejects(s.recovery.prepare(s.api,empty(),{}),/一致/);assert.equal(s.cache.size,0);
});
test('request failure remains visible instead of becoming a success with zero words',async()=>{
 const s=setup({failure:new Error('simulated endpoint failure')});await assert.rejects(s.recovery.prepare(s.api,empty(),{}),/simulated/);
 assert.equal(s.recovery.diagnostics().stage,'取得未完了');assert.match(s.recovery.diagnostics().error,/simulated/);assert.equal(s.cache.size,0);
});
test('intentionally deleted words are not resurrected and a zero-card view is not reported restored',async()=>{
 const s=setup();const view=empty();for(const c of cards)view.deleted['card:'+c.id]={deleted:true};
 const plan=await s.recovery.prepare(s.api,view,{});assert.equal(Object.keys(plan.data).filter(k=>k.startsWith('card:')).length,0);
 const next={...view,data:plan.data};assert.throws(()=>s.recovery.verifyApplied(next,{}),/0件/);
});
test('a downloaded view not applied to the device cannot pass completion',async()=>{
 const s=setup();const plan=await s.recovery.prepare(s.api,empty(),{});assert.throws(()=>s.recovery.verifyApplied(materializePlan(plan),{}),/端末への反映/);
});
test('private server handler returns a synthetic 59-card payload only for its authorized Google identity',async()=>{
 const {createHandler}=await import(pathToFileURL(path.join(__dirname,'../server/word-network-handler.mjs')).href);
 const handle=createHandler({payload,allowedEmail:'owner@example.test',allowedOrigin:'https://example.test',fetcher:async()=>new Response(JSON.stringify({user:{emailAddress:'owner@example.test',permissionId:'test-account'}}),{status:200})});
 const request=new Request('https://service.example.test/',{method:'POST',headers:{Origin:'https://example.test',Authorization:'Bearer '+ 'synthetic-token-'.repeat(4)}});
 const result=await handle(request);assert.equal(result.status,200);assert.equal((await result.json()).cards.length,59);
 const unauth=await handle(new Request('https://service.example.test/',{method:'POST'}));assert.equal(unauth.status,401);
});
test('the private server denies an authenticated but different Google account',async()=>{
 const {createHandler}=await import(pathToFileURL(path.join(__dirname,'../server/word-network-handler.mjs')).href);
 const handle=createHandler({payload,allowedEmail:'owner@example.test',allowedOrigin:'https://example.test',fetcher:async()=>new Response(JSON.stringify({user:{emailAddress:'other@example.test',permissionId:'other-account'}}))});
 const result=await handle(new Request('https://service.example.test/',{method:'POST',headers:{Authorization:'Bearer '+ 'synthetic-token-'.repeat(4)}}));assert.equal(result.status,403);assert.equal((await result.json()).cards,undefined);
});
