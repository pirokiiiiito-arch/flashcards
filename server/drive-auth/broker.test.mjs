import test from 'node:test';
import assert from 'node:assert/strict';
import {createBroker,ORIGIN,DRIVE_SCOPE,REDIRECT_URI,CLIENT_ID,base64url,digest,sha,problem} from './broker.mjs';
const verifier='v'.repeat(64),email='owner@example.invalid';
function fixture(){
 let time=Date.now(),config={client_secret:'private-server-secret'},link=null;
 const calls=[],intents=new Map(),oauthCalls=[];
 const deps={now:()=>time,config:async()=>config,verifyUser:async authorization=>authorization==='Bearer app-session'?{id:'owner-one',email,email_confirmed_at:'2020-01-01'}:null,
  store:async(action,owner,p)=>{calls.push([action,owner,structuredClone(p)]);
   if(action==='begin'){intents.set(p.state_hash,{owner,...p,expires:time+600000});return {};}
   if(action==='take'){const i=intents.get(p.state_hash);if(!i||i.owner!==owner||i.challenge!==p.challenge||i.expires<=time)return null;intents.delete(p.state_hash);return i;}
   if(action==='read')return link?structuredClone(link):null;
   if(action==='save'){link={...p,version:'version-one',revoked:false};return {};}
   if(action==='rotate'){if(!link||p.version!==link.version||link.revoked)return null;link.refresh_token=p.refresh_token;link.version+='-rotated';return {version:link.version};}
   if(action==='invalidate'){if(link?.version===p.version)link.revoked=true;return {};}
   if(action==='remove'){link=null;return {};}
   throw Error('Unknown store action');
  },
  oauth:async p=>{oauthCalls.push(p);return {access_token:'short-lived-access',refresh_token:'server-only-refresh-credential',expires_in:3600,scope:DRIVE_SCOPE+' openid email'};},
  identity:async()=>({sub:'google-owner',email,email_verified:true,account:'drive-owner'})};
 const handler=createBroker(deps);
 async function request(action,p={},options={}){
  const method=options.method||'POST';
  const r=await handler(new Request('https://project.invalid/functions/v1/drive-auth/'+action,{method,headers:{Origin:ORIGIN,Authorization:'Bearer app-session','Content-Type':'application/json',...options.headers},...(method==='GET'||method==='OPTIONS'?{}:{body:JSON.stringify(p)})}));
  return {status:r.status,headers:r.headers,body:r.status===204?null:await r.json()};
 }
 async function start(){return request('start',{code_challenge:base64url(await digest(verifier)),expected_account:'drive-owner'});}
 async function login(){const begun=await start();assert.equal(begun.status,200);return request('exchange',{state:begun.body.state,code:'synthetic-code',code_verifier:verifier});}
 return {request,start,login,deps,calls,intents,oauthCalls,get link(){return link;},set link(v){link=v;},set config(v){config=v;},advance:n=>{time+=n;}};
}
test('public readiness discloses only configuration presence, never server credentials',async()=>{
 const f=fixture(),r=await f.request('status',{}, {method:'GET'});assert.equal(r.status,200);assert.equal(r.body.configured,true);assert.equal(r.body.redirect_uri,REDIRECT_URI);assert.ok(!JSON.stringify(r).includes('private-server-secret'));assert.deepEqual(f.calls,[]);
 f.config={};const missing=await f.start();assert.equal(missing.status,503);assert.equal(missing.body.error,'server_not_configured');
});
test('requests from other origins, missing auth and expired sessions cannot read or mutate credentials',async()=>{
 for(const headers of [{Origin:'https://other.invalid'},{Origin:'null'},{Authorization:''},{Authorization:'Bearer expired'}]){
  const f=fixture(),r=await f.request('token',{}, {headers});assert.ok([401,403].includes(r.status));assert.deepEqual(f.calls,[]);assert.deepEqual(f.oauthCalls,[]);
 }
});
test('initial consent uses the existing Drive OAuth client and S256 PKCE',async()=>{
 const f=fixture(),r=await f.start(),u=new URL(r.body.authorization_url);
 assert.equal(u.origin,'https://accounts.google.com');assert.equal(u.searchParams.get('client_id'),CLIENT_ID);
 assert.equal(u.searchParams.get('redirect_uri'),REDIRECT_URI);assert.equal(u.searchParams.get('access_type'),'offline');assert.equal(u.searchParams.get('code_challenge_method'),'S256');assert.equal(u.searchParams.get('scope'),DRIVE_SCOPE+' openid email');
 assert.equal(f.calls[0][1],'owner-one');assert.equal(f.calls[0][2].state_hash,await sha(r.body.state));assert.ok(!JSON.stringify(r.body).includes('client_secret'));
});
test('PKCE mismatch, wrong state, expired state and callback replay cannot obtain credentials',async()=>{
 const f=fixture(),r=await f.start();
 assert.equal((await f.request('exchange',{state:r.body.state,code:'valid-code',code_verifier:'x'.repeat(64)})).status,400);
 assert.equal(f.oauthCalls.length,0);
 const p={state:r.body.state,code:'valid-code',code_verifier:verifier};assert.equal((await f.request('exchange',p)).status,200);assert.equal((await f.request('exchange',p)).status,400);
 const next=await f.start();f.advance(600001);assert.equal((await f.request('exchange',{...p,state:next.body.state})).status,400);
});
test('connecting stores refresh token server-side and never returns it to the browser',async()=>{
 const f=fixture(),r=await f.login();assert.equal(r.status,200);assert.deepEqual(r.body,{connected:true,account:'drive-owner'});assert.equal(f.link.refresh_token,'server-only-refresh-credential');assert.ok(!JSON.stringify(r.body).includes('refresh'));assert.equal(r.headers.get('Cache-Control'),'no-store');
});
test('different Google owner, missing verified email and different Drive account are rejected',async()=>{
 for(const override of [{email:'stranger@example.invalid'},{email_verified:false},{account:'different-drive'}]){
  const f=fixture();f.deps.identity=async()=>({sub:'google-owner',email,email_verified:true,account:'drive-owner',...override});assert.equal((await f.login()).status,403);assert.equal(f.link,null);
 }
});
test('absence of offline permission is not reported as persistent login success',async()=>{
 const f=fixture();f.deps.oauth=async()=>({access_token:'short-lived-only',expires_in:3600,scope:DRIVE_SCOPE});assert.equal((await f.login()).body.error,'offline_permission_required');assert.equal(f.link,null);
});
test('refresh is automatically reused, then renewed when the short-lived token expires',async()=>{
 const f=fixture();await f.login();const baseline=f.oauthCalls.length;
 const first=await f.request('token',{owner_id:'ignored-attacker-controlled-value'});assert.equal(first.status,200);assert.equal(first.body.access_token,'short-lived-access');assert.ok(!JSON.stringify(first.body).includes('refresh'));
 await f.request('token');assert.equal(f.oauthCalls.length,baseline+1);
 f.advance(3600001);assert.equal((await f.request('token')).status,200);assert.equal(f.oauthCalls.length,baseline+2);
 assert.ok(f.calls.every(([,owner])=>owner==='owner-one'));
});
test('concurrent requests share one refresh and a rotated refresh token is saved server-side',async()=>{
 const f=fixture();await f.login();let count=0;
 f.deps.oauth=async()=>{count++;await new Promise(r=>setTimeout(r,10));return {access_token:'renewed',expires_in:3600,refresh_token:'replacement-server-refresh',scope:DRIVE_SCOPE};};
 const r=await Promise.all(Array.from({length:8},()=>f.request('token')));assert.ok(r.every(x=>x.status===200));assert.equal(count,1);assert.equal(f.link.refresh_token,'replacement-server-refresh');assert.ok(r.every(x=>!JSON.stringify(x.body).includes('replacement-server-refresh')));
});
test('transient provider failure does not revoke the link or request new Google consent',async()=>{
 const f=fixture();await f.login();f.deps.oauth=async()=>{throw Error('do not expose secret-token in error');};
 const r=await f.request('token');assert.equal(r.status,503);assert.equal(r.body.error,'refresh_temporarily_unavailable');assert.equal(f.link.revoked,false);assert.ok(!JSON.stringify(r.body).includes('secret-token'));
});
test('revoked Google consent asks for authentication only after refresh is rejected',async()=>{
 const f=fixture();await f.login();f.deps.oauth=async()=>{throw problem('invalid_grant',401);};
 const r=await f.request('token');assert.equal(r.status,401);assert.equal(r.body.error,'google_auth_required');assert.equal(f.link.revoked,true);
});
test('disconnect wins over an in-flight token refresh; no card/photo operation exists',async()=>{
 const f=fixture();await f.login();let release,started;
 const entered=new Promise(r=>started=r);f.deps.oauth=async()=>{started();await new Promise(r=>release=r);return {access_token:'must-not-return',expires_in:3600,scope:DRIVE_SCOPE};};
 const pending=f.request('token');await entered;assert.equal((await f.request('disconnect')).status,200);release();
 const r=await pending;assert.equal(r.status,409);assert.equal(f.link,null);assert.ok(!JSON.stringify(r.body).includes('must-not-return'));
 assert.ok(f.calls.every(([a])=>['begin','take','read','save','remove','invalidate','rotate'].includes(a)));
});
