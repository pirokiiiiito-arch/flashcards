/* Network-free tests of the deployment adapter. All credentials are fixtures. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {ORIGIN} from './broker.mjs';
let sequence=0;
const BASE='https://project.example.invalid';
const fixtureKey='fixture-backend-key', fixtureSecret='fixture-vault-secret';
const user={id:'fixture-owner',email:'owner@example.invalid',email_confirmed_at:'2020-01-01'};
const jwt=claims=>'fixture.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.signature';
const good=jwt({sub:user.id,session_id:'fixture-session'});
async function fixture(options={}){
 const originalFetch=globalThis.fetch,originalDeno=globalThis.Deno;
 const calls=[];let handler;
 const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
 const env={SUPABASE_URL:BASE,...(options.legacy?{SUPABASE_SERVICE_ROLE_KEY:fixtureKey}:{SUPABASE_SECRET_KEYS:JSON.stringify({default:fixtureKey})})};
 globalThis.Deno={env:{get:name=>env[name]},serve:fn=>{handler=fn;}};
 globalThis.fetch=async(url,init={})=>{
  assert.equal(typeof url,'string');assert.ok(url.startsWith(BASE+'/'),'no external network is allowed');
  calls.push({url,init});
  if(options.failure)throw Error('must-not-leak-fixture-secret');
  if(url===BASE+'/auth/v1/user')return json(options.user||user,options.authStatus||200);
  assert.equal(url,BASE+'/rest/v1/rpc/flashcards_drive_auth_store');
  const payload=JSON.parse(init.body);
  if(payload.operation==='config')return json({client_secret:fixtureSecret});
  assert.equal(payload.owner_id,user.id,'owner is derived from verified user, not request input');
  if(payload.operation==='session')return json({active:options.sessionActive!==false});
  if(payload.operation==='read')return json(null);
  throw Error('unexpected privileged operation');
 };
 await import('./index.ts?runtime-test='+ ++sequence);
 async function request(action='token',requestOptions={}){
  const method=requestOptions.method||'POST';
  const headers={Origin:ORIGIN,Authorization:'Bearer '+good,'Content-Type':'application/json',...requestOptions.headers};
  const r=await handler(new Request(BASE+'/functions/v1/drive-auth/'+action,{method,headers,...(method==='POST'?{body:JSON.stringify({owner_id:'attacker-selected-owner'})}:{})}));
  const data=r.status===204?null:await r.json();
  assert.ok(!JSON.stringify(data).includes(fixtureSecret),'Vault secret is never returned');
  assert.ok(!JSON.stringify(data).includes(fixtureKey),'server credential is never returned');
  return {status:r.status,data,headers:r.headers};
 }
 const restore=()=>{globalThis.fetch=originalFetch;if(originalDeno===undefined)delete globalThis.Deno;else globalThis.Deno=originalDeno;};
 return {calls,request,restore};
}
test('public status checks configuration without exposing secrets',async()=>{
 const f=await fixture();try{
  const r=await f.request('status',{method:'GET',headers:{Authorization:''}});
  assert.equal(r.status,200);assert.equal(r.data.configured,true);assert.equal(r.headers.get('Cache-Control'),'no-store');
  assert.equal(f.calls.length,1);assert.equal(JSON.parse(f.calls[0].init.body).operation,'config');
 }finally{f.restore();}
});
test('untrusted origins and missing bearer are rejected before storage access',async()=>{
 for(const headers of [{Origin:'https://other.example.invalid'},{Origin:'null'},{Authorization:''}]){
  const f=await fixture();try{const r=await f.request('token',{headers});assert.ok([401,403].includes(r.status));assert.equal(f.calls.length,0);}finally{f.restore();}
 }
});
test('invalid or expired app JWT cannot read the credential store',async()=>{
 const f=await fixture({authStatus:401});try{
  const r=await f.request();assert.equal(r.status,401);assert.equal(r.data.error,'app_login_required');assert.equal(f.calls.length,1);
 }finally{f.restore();}
});
test('validated user must match JWT subject and contain a session ID',async()=>{
 for(const claims of [{sub:'different-owner',session_id:'fixture-session'},{sub:user.id}]){
  const f=await fixture();try{const r=await f.request('token',{headers:{Authorization:'Bearer '+jwt(claims)}});assert.equal(r.status,401);assert.equal(f.calls.length,1);}finally{f.restore();}
 }
});
test('signed-out app session cannot reuse an otherwise valid JWT',async()=>{
 const f=await fixture({sessionActive:false});try{
  const r=await f.request();assert.equal(r.status,401);assert.equal(r.data.error,'app_login_required');
  const ops=f.calls.filter(c=>c.url.includes('/rpc/')).map(c=>JSON.parse(c.init.body).operation);assert.deepEqual(ops,['session']);
 }finally{f.restore();}
});
test('active app session without a Drive link asks for initial consent',async()=>{
 const f=await fixture();try{
  const r=await f.request();assert.equal(r.status,401);assert.equal(r.data.error,'google_auth_required');
  assert.deepEqual(f.calls.filter(c=>c.url.includes('/rpc/')).map(c=>JSON.parse(c.init.body).operation),['session','read']);
 }finally{f.restore();}
});
test('backend key headers support modern and legacy runtimes without exposing either key',async()=>{
 for(const legacy of [false,true]){
  const f=await fixture({legacy});try{
   await f.request('status',{method:'GET'});const h=f.calls[0].init.headers;
   assert.equal(h.apikey,fixtureKey);assert.equal(h.Authorization,legacy?'Bearer '+fixtureKey:undefined);
  }finally{f.restore();}
 }
});
test('a temporary Auth failure is not represented as revoked Google consent',async()=>{
 const f=await fixture({failure:true});try{
  const r=await f.request();assert.equal(r.status,503);assert.equal(r.data.error,'service_temporarily_unavailable');
  assert.ok(!JSON.stringify(r.data).includes('must-not-leak'));assert.equal(f.calls.length,1);
 }finally{f.restore();}
});
