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
function fixture({expired=false,tokenStatus=200,tokenBody}={}){
  let time=1793376000000;
  const user={id:'owner-1',email:'owner@example.invalid',email_confirmed_at:'2026-01-01T00:00:00Z'};
  const session={access_token:'app-old',refresh_token:'refresh-old',expires_at:expired?time-1:time+3600000,user};
  const storage=memory({[SESSION_KEY]:JSON.stringify(session)}),tab=memory();
  const calls=[];
  const fetcher=async(url,init={})=>{
    calls.push({url:String(url),method:init.method||'GET',authorization:new Headers(init.headers).get('Authorization')||''});
    if(String(url).includes('/auth/v1/token?grant_type=refresh_token'))
      return json({access_token:'app-new',refresh_token:'refresh-new',expires_in:3600,user});
    if(String(url).includes('/functions/v1/drive-auth/token'))
      return json(tokenBody||{access_token:'drive-short',expires_in:3600,account:'drive-owner'},tokenStatus);
    throw Error('unexpected '+url);
  };
  const c=F.createController({fetcher,storage,tabStorage:tab,now:()=>time,locks:null});
  return {c,storage,tab,calls,user,advance:n=>time+=n};
}
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
  await f.c.resume();
  assert.equal(f.c.state().phase,'connected');
  assert.equal(f.c.required(),false);
});
test('scope helper accepts only the requested Drive appData scope',()=>{
  assert.equal(fixture().c.hasGrantedAllScopes({scope:F.SCOPE},F.SCOPE),true);
  assert.equal(fixture().c.hasGrantedAllScopes({scope:'openid email'},F.SCOPE),false);
});
