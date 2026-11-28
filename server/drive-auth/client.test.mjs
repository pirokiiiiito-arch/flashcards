import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const F=require('../../persistent-drive-auth.js');
const SESSION_KEY=F.SESSION_KEY;
function memory(seed={}){
  const m=new Map(Object.entries(seed));
  return {getItem:k=>m.has(k)?m.get(k):null,setItem:(k,v)=>m.set(k,String(v)),removeItem:k=>m.delete(k),dump:()=>Object.fromEntries(m)};
}
function json(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});}
function fixture({expired=false,tokenStatus=200,tokenBody,tokenResponder}={}){
  let time=1793376000000;
  const user={id:'owner-1',email:'owner@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'};
  const session={access_token:'app-old',refresh_token:'refresh-old',expires_at:expired?time-1:time+3600000,user};
  const storage=memory({[SESSION_KEY]:JSON.stringify(session),synthetic_cards:'keep'}),tab=memory();
  const calls=[];let tokenCalls=0,opens=0;
  const fetcher=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):{};
    calls.push({url:String(url),method:init.method||'GET',authorization:new Headers(init.headers).get('Authorization')||'',body});
    if(String(url).includes('/auth/v1/token?grant_type=refresh_token'))
      return json({access_token:'app-new',refresh_token:'refresh-new',expires_in:3600,user});
    if(String(url).includes('/functions/v1/drive-auth/token')){
      tokenCalls++;
      return tokenResponder?tokenResponder(tokenCalls,body):json(tokenBody||{access_token:'drive-short',expires_in:3600,account:'drive-owner'},tokenStatus);
    }
    throw Error('unexpected '+url);
  };
  const c=F.createController({fetcher,storage,tabStorage:tab,now:()=>time,locks:null,onOpen:()=>opens++});
  return {c,storage,tab,calls,user,advance:n=>time+=n,get opens(){return opens;},get tokenCalls(){return tokenCalls;}};
}
const flush=()=>new Promise(resolve=>setTimeout(resolve,0));
const provider=token=>json({access_token:token,expires_in:3600,account:'drive-owner'});
test('valid app session obtains a Drive token and delivers it to existing clients',async()=>{
  const f=fixture(),seen=[];
  f.c.initTokenClient({callback:r=>seen.push(r)});
  const result=await f.c.getToken();
  await new Promise(r=>setTimeout(r,0));
  assert.equal(result.token,'drive-short');
  assert.equal(result.account,'drive-owner');
  assert.equal(f.c.state().phase,'connected');
  assert.equal(f.c.required(),false);
  assert.equal(seen.at(-1).access_token,'drive-short');
  assert.equal(seen.at(-1).scope,F.SCOPE);
  assert.ok(f.calls.some(x=>x.authorization==='Bearer app-old'));
});
test('expired app session refreshes automatically before requesting the Drive token',async()=>{
  const f=fixture({expired:true});
  await f.c.getToken();
  const saved=JSON.parse(f.storage.getItem(SESSION_KEY));
  assert.equal(saved.access_token,'app-new');
  assert.equal(saved.refresh_token,'refresh-new');
  assert.ok(f.calls.some(x=>x.url.includes('grant_type=refresh_token')));
  assert.ok(f.calls.some(x=>x.url.includes('/drive-auth/token')&&x.authorization==='Bearer app-new'));
});
test('temporary server failure never becomes an authentication prompt',async()=>{
  const f=fixture({tokenStatus:503,tokenBody:{error:'refresh_temporarily_unavailable'}});
  await assert.rejects(()=>f.c.getToken());
  assert.equal(f.c.state().phase,'temporary');
  assert.equal(f.c.required(),false);
});
test('revoked or missing Google permission becomes an authentication prompt',async()=>{
  const f=fixture({tokenStatus:401,tokenBody:{error:'google_auth_required'}});
  await assert.rejects(()=>f.c.getToken(),e=>e.code==='google_auth_required');
  assert.equal(f.c.required(),true);
  assert.equal(f.c.state().phase,'google_auth_required');
});
test('pause is device-local and resume can restore automatic token use',async()=>{
  const f=fixture();
  await f.c.getToken();
  f.c.pause();
  assert.equal(f.c.required(),true);
  assert.equal(f.c.state().phase,'connection_paused');
  const requests=f.tokenCalls;
  assert.equal(await f.c.invalidateAccess('drive-short'),false);
  f.c.tick();await flush();
  assert.equal(f.tokenCalls,requests);
  await f.c.resume();
  assert.equal(f.c.state().phase,'connected');
  assert.equal(f.c.required(),false);
});
test('a rejected current token is automatically replaced and delivered without changing saved data',async()=>{
  const f=fixture({tokenResponder:n=>provider(n===1?'drive-first':'drive-renewed')}),seen=[];
  const saved=f.storage.getItem(SESSION_KEY);
  f.c.initTokenClient({callback:r=>seen.push(r.access_token)});
  await f.c.getToken();await flush();
  assert.equal(await f.c.invalidateAccess('drive-first'),true);await flush();
  assert.deepEqual(seen,['drive-first','drive-renewed']);
  assert.deepEqual(f.calls.filter(x=>x.url.includes('/drive-auth/token')).map(x=>x.body.force),[false,true]);
  assert.equal(f.c.state().phase,'connected');assert.equal(f.c.required(),false);
  assert.equal(f.storage.getItem(SESSION_KEY),saved);assert.equal(f.storage.getItem('synthetic_cards'),'keep');
  assert.equal(f.opens,0);
});
test('temporary token renewal failure retains forced retry after backoff instead of reusing the rejected token',async()=>{
  const f=fixture({tokenResponder:n=>n===2?json({error:'refresh_temporarily_unavailable'},503):provider(n===1?'drive-first':'drive-renewed')}),seen=[];
  f.c.initTokenClient({callback:r=>seen.push(r.access_token)});
  await f.c.getToken();await flush();
  await assert.rejects(()=>f.c.invalidateAccess('drive-first'),e=>e.code==='refresh_temporarily_unavailable');
  assert.equal(f.c.state().phase,'temporary');assert.equal(f.c.required(),false);
  await assert.rejects(()=>f.c.getToken(),e=>e.code==='retry_pending');
  f.c.tick();await flush();assert.equal(f.tokenCalls,2);
  f.advance(60000);f.c.tick();await f.c.getToken();await flush();
  assert.deepEqual(f.calls.filter(x=>x.url.includes('/drive-auth/token')).map(x=>x.body.force),[false,true,true]);
  assert.deepEqual(seen,['drive-first','drive-renewed']);assert.equal(f.c.state().phase,'connected');
  assert.equal(f.opens,0);assert.equal(f.storage.getItem('synthetic_cards'),'keep');
});
test('a delayed old-token rejection cannot invalidate a newer delivered token',async()=>{
  const f=fixture({tokenResponder:n=>provider(n===1?'drive-first':'drive-renewed')}),seen=[];
  f.c.initTokenClient({callback:r=>seen.push(r.access_token)});
  await f.c.getToken();await flush();
  await f.c.invalidateAccess('drive-first');await flush();
  assert.equal(await f.c.invalidateAccess('drive-first'),false);
  assert.equal((await f.c.getToken()).token,'drive-renewed');assert.equal(f.tokenCalls,2);
  assert.deepEqual(seen,['drive-first','drive-renewed']);assert.equal(f.c.state().phase,'connected');
});
test('rejection during an older refresh discards its result before the forced retry',async()=>{
  let release,entered;
  const started=new Promise(resolve=>entered=resolve);
  const f=fixture({tokenResponder:n=>{
    if(n===2){entered();return new Promise(resolve=>release=()=>resolve(provider('stale-refresh-result')));}
    return provider(n===1?'drive-first':'drive-renewed');
  }}),seen=[];
  f.c.initTokenClient({callback:r=>seen.push(r.access_token)});
  await f.c.getToken();await flush();
  const older=f.c.getToken(true);await started;
  const rejected=f.c.invalidateAccess('drive-first');
  const oldResult=assert.rejects(older,e=>e.code==='connection_changed');
  release();await oldResult;assert.equal(await rejected,true);await flush();
  assert.equal((await f.c.getToken()).token,'drive-renewed');
  assert.deepEqual(seen,['drive-first','drive-renewed']);assert.equal(f.tokenCalls,3);
});
test('revoked permission after an API rejection requests authentication without repeated retries or popup',async()=>{
  const f=fixture({tokenResponder:n=>n===1?provider('drive-first'):json({error:'google_auth_required'},401)});
  await f.c.getToken();
  await assert.rejects(()=>f.c.invalidateAccess('drive-first'),e=>e.code==='google_auth_required'&&e.auth);
  assert.equal(f.c.state().phase,'google_auth_required');assert.equal(f.c.required(),true);
  f.advance(60000);f.c.tick();await flush();
  assert.equal(f.tokenCalls,2);assert.equal(f.opens,0);assert.equal(f.storage.getItem('synthetic_cards'),'keep');
});
test('scope helper accepts only the requested Drive appData scope',()=>{
  assert.equal(fixture().c.hasGrantedAllScopes({scope:F.SCOPE},F.SCOPE),true);
  assert.equal(fixture().c.hasGrantedAllScopes({scope:'openid email'},F.SCOPE),false);
});
