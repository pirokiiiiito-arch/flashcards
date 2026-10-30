/* Server-only OAuth broker. Dependency-injected for network-free tests.
 * Google refresh credentials NEVER leave the server. Existing appData is untouched.
 * This module is not enabled by any current application entry point. */
export const ORIGIN = 'https://pirokiiiiito-arch.github.io';
export const CLIENT_ID = '549199582878-b5aflr2vli7lqnfa0nhge6994qfbeh2s.apps.googleusercontent.com';
export const REDIRECT_URI = ORIGIN + '/flashcards/drive-login.html';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const enc = new TextEncoder();
export const base64url = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
export async function digest(value) { return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(value))); }
export async function sha(value) { return [...await digest(value)].map(n=>n.toString(16).padStart(2,'0')).join(''); }
class Problem extends Error { constructor(code,status=400){super(code);this.code=code;this.status=status;} }
export function problem(code,status=400) { return new Problem(code,status); }
const normal = value => String(value || '').trim().toLowerCase();
const scopes = value => new Set(String(value || '').split(/\s+/).filter(Boolean));
async function body(request) {
  if(!String(request.headers.get('content-type')||'').startsWith('application/json'))throw problem('json_required',415);
  if(!request.body)throw problem('invalid_request');
  const reader=request.body.getReader(),chunks=[];let length=0;
  try { for(;;){const r=await reader.read();if(r.done)break;length+=r.value.length;if(length>8192){await reader.cancel();throw problem('request_too_large',413);}chunks.push(r.value);} }
  finally { reader.releaseLock(); }
  const all=new Uint8Array(length);let at=0;for(const c of chunks){all.set(c,at);at+=c.length;}
  try{const result=JSON.parse(new TextDecoder().decode(all));if(!result||Array.isArray(result)||typeof result!=='object')throw Error();return result;}catch{throw problem('invalid_request');}
}
export function createBroker(deps) {
  const now=deps.now||Date.now,access=new Map(),inflight=new Map();
  function response(data,status=200){return new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','Pragma':'no-cache','Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin','X-Content-Type-Options':'nosniff'}});}
  async function issue(owner,force=false) {
    const link=await deps.store('read',owner,{});
    if(!link?.refresh_token||link.revoked)throw problem('google_auth_required',401);
    const cached=access.get(owner);
    if(!force&&cached?.version===link.version&&cached.until>now()+60000)return {access_token:cached.token,expires_in:Math.floor((cached.until-now())/1000),account:link.account};
    if(inflight.has(owner))return inflight.get(owner);
    const work=(async()=>{
      const config=await deps.config();if(!config.client_secret)throw problem('server_not_configured',503);
      let token;
      try { token=await deps.oauth({grant_type:'refresh_token',client_id:CLIENT_ID,client_secret:config.client_secret,refresh_token:link.refresh_token}); }
      catch(error){
        if(error?.code==='invalid_grant'){
          await deps.store('invalidate',owner,{version:link.version});access.delete(owner);
          throw problem('google_auth_required',401);
        }
        throw problem('refresh_temporarily_unavailable',503);
      }
      if(!token?.access_token||!(Number(token.expires_in)>60))throw problem('invalid_provider_response',502);
      if(token.scope&&!scopes(token.scope).has(DRIVE_SCOPE))throw problem('google_permission_required',401);
      // Recheck revocation/account version after network I/O. Disconnect wins.
      let current=await deps.store('read',owner,{});
      if(!current||current.revoked||current.version!==link.version)throw problem('connection_changed',409);
      if(token.refresh_token&&token.refresh_token!==link.refresh_token){
        current=await deps.store('rotate',owner,{version:link.version,refresh_token:token.refresh_token});
        if(!current)throw problem('connection_changed',409);
      }
      const until=now()+Number(token.expires_in)*1000;
      if(access.size>=256&&!access.has(owner))access.delete(access.keys().next().value);
      access.set(owner,{token:token.access_token,until,version:current.version});
      return {access_token:token.access_token,expires_in:Number(token.expires_in),account:link.account};
    })().finally(()=>inflight.delete(owner));
    inflight.set(owner,work);return work;
  }
  return async function handle(request){
    try{
      if(request.headers.get('origin')!==ORIGIN)return response({error:'origin_not_allowed'},403);
      if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'Access-Control-Allow-Origin':ORIGIN,'Vary':'Origin','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Authorization,Content-Type,apikey','Access-Control-Max-Age':'600'}});
      const action=new URL(request.url).pathname.split('/').filter(Boolean).pop();
      if(action==='status'&&request.method==='GET'){
        const c=await deps.config();return response({configured:!!c.client_secret,client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,version:1});
      }
      if(request.method!=='POST')throw problem('method_not_allowed',405);
      const authorization=request.headers.get('authorization')||'';
      if(!/^Bearer [^\s]+$/.test(authorization))throw problem('app_login_required',401);
      const user=await deps.verifyUser(authorization);
      if(!user?.id||!user.email||!user.email_confirmed_at)throw problem('app_login_required',401);
      const owner=user.id,p=await body(request);
      if(action==='start'){
        const c=await deps.config();if(!c.client_secret)throw problem('server_not_configured',503);
        if(!/^[A-Za-z0-9_-]{43}$/.test(p.code_challenge||''))throw problem('invalid_pkce');
        if(p.expected_account&&!/^[\w-]{1,200}$/.test(p.expected_account))throw problem('invalid_account');
        const state=base64url(crypto.getRandomValues(new Uint8Array(32)));
        await deps.store('begin',owner,{state_hash:await sha(state),challenge:p.code_challenge,expected_account:p.expected_account||''});
        const q=new URLSearchParams({client_id:CLIENT_ID,redirect_uri:REDIRECT_URI,response_type:'code',scope:DRIVE_SCOPE+' openid email',access_type:'offline',prompt:'consent',include_granted_scopes:'false',state,code_challenge:p.code_challenge,code_challenge_method:'S256'});
        return response({authorization_url:'https://accounts.google.com/o/oauth2/v2/auth?'+q,state});
      }
      if(action==='exchange'){
        if(typeof p.code!=='string'||p.code.length<5||p.code.length>4096||!/^[\w-]{43}$/.test(p.state||'')||!/^[A-Za-z0-9._~-]{43,128}$/.test(p.code_verifier||''))throw problem('invalid_callback');
        const c=await deps.config();if(!c.client_secret)throw problem('server_not_configured',503);
        const intent=await deps.store('take',owner,{state_hash:await sha(p.state),challenge:base64url(await digest(p.code_verifier))});
        if(!intent)throw problem('expired_or_invalid_state');
        let token;
        try{token=await deps.oauth({grant_type:'authorization_code',code:p.code,code_verifier:p.code_verifier,redirect_uri:REDIRECT_URI,client_id:CLIENT_ID,client_secret:c.client_secret});}
        catch{throw problem('google_auth_required',401);}
        if(!token?.access_token||!scopes(token.scope).has(DRIVE_SCOPE)||!(Number(token.expires_in)>60))throw problem('google_permission_required',401);
        const identity=await deps.identity(token.access_token);
        if(!identity?.sub||identity.email_verified!==true||normal(identity.email)!==normal(user.email)||!identity.account)throw problem('google_account_mismatch',403);
        if(intent.expected_account&&intent.expected_account!==identity.account)throw problem('google_account_mismatch',403);
        const previous=await deps.store('read',owner,{});
        if(previous&&(previous.sub!==identity.sub||previous.account!==identity.account))throw problem('google_account_mismatch',403);
        const refresh=token.refresh_token||(!previous?.revoked?previous?.refresh_token:null);
        if(!refresh)throw problem('offline_permission_required',401);
        await deps.store('save',owner,{sub:identity.sub,account:identity.account,email:identity.email,refresh_token:refresh});
        access.delete(owner);
        return response({connected:true,account:identity.account});
      }
      if(action==='token')return response(await issue(owner,p.force===true));
      if(action==='disconnect'){
        await deps.store('remove',owner,{});access.delete(owner);
        return response({disconnected:true,photos_unchanged:true});
      }
      throw problem('not_found',404);
    }catch(error){
      // Do not return provider payloads, tokens, passwords, SQL or stack traces.
      return response({error:error instanceof Problem?error.code:'service_temporarily_unavailable'},error instanceof Problem?error.status:503);
    }
  };
}
