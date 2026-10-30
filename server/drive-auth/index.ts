// Runtime credentials remain in Supabase. No secrets embedded in source.
import {createBroker, problem} from './broker.mjs';
const url = Deno.env.get('SUPABASE_URL') || '';
function keyConfig() {
 let modern='';try{modern=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||'';}catch{}
 const legacy=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'',key=modern||legacy;
 if(!url||!key)throw Error('Server configuration unavailable');return {key,legacy:!modern};
}
async function jsonRequest(endpoint:string,init:RequestInit={}) {
 const response=await fetch(endpoint,{...init,redirect:'error',cache:'no-store',signal:AbortSignal.timeout(20000)});
 const value=await response.json().catch(()=>null);return {response,value};
}
async function store(operation:string,owner_id:string|null,payload:Record<string,unknown>={}) {
 const config=keyConfig(),headers:Record<string,string>={apikey:config.key,'Content-Type':'application/json'};
 if(config.legacy)headers.Authorization='Bearer '+config.key;
 const {response,value}=await jsonRequest(url+'/rest/v1/rpc/flashcards_drive_auth_store',{method:'POST',headers,body:JSON.stringify({operation,owner_id,payload})});
 if(!response.ok)throw Error('Credential store unavailable');return value;
}
const handler=createBroker({
 config:()=>store('config',null),store,
 verifyUser:async(authorization:string)=>{
  const {response,value}=await jsonRequest(url+'/auth/v1/user',{headers:{apikey:keyConfig().key,Authorization:authorization}});
  if(response.status===401||response.status===403)return null;
  if(!response.ok)throw Error('Application session verification unavailable');
  // Only decode claims AFTER Auth has validated signature and expiry. Session
  // existence is checked too, so a signed-out device cannot reuse a stale JWT.
  let claims;try{const part=authorization.slice(7).split('.')[1].replaceAll('-','+').replaceAll('_','/');claims=JSON.parse(atob(part));}catch{return null;}
  if(claims.sub!==value.id||typeof claims.session_id!=='string')return null;
  const live=await store('session',value.id,{session_id:claims.session_id});
  return live?.active?value:null;
 },
 oauth:async(parameters:Record<string,string>)=>{
  const {response,value}=await jsonRequest('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(parameters)});
  if(!response.ok){if(value?.error==='invalid_grant')throw problem('invalid_grant',401);throw Error('OAuth unavailable');}return value;
 },
 identity:async(token:string)=>{
  const headers={Authorization:'Bearer '+token};
  const [profile,drive]=await Promise.all([jsonRequest('https://openidconnect.googleapis.com/v1/userinfo',{headers}),jsonRequest('https://www.googleapis.com/drive/v3/about?fields=user(permissionId)',{headers})]);
  if(!profile.response.ok||!drive.response.ok)throw Error('Account verification unavailable');return {...profile.value,account:drive.value?.user?.permissionId};
 }
});
// Public status/preflight only; every privileged request verifies an active user.
Deno.serve(handler);
