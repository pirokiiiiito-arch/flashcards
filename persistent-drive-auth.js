/* Google refresh credentials stay in the server Vault. Only short-lived Drive
 * tokens live in this page. Existing application session key is reused; no card
 * or photograph storage is read, overwritten or cleared by this module. */
(function(root){
 'use strict';
 const URL_BASE='https://himtyybslzzwsfmgdivx.supabase.co';
 const PUBLIC_KEY='sb_publishable_tUa2O6wln22qdUk97worCg_Z3vL5bZO';
 const ENDPOINT=URL_BASE+'/functions/v1/drive-auth';
 const SESSION_KEY='flashcards_supabase_session_v1';
 const SCOPE='https://www.googleapis.com/auth/drive.appdata';
 const SIGNAL_KEY='flashcards_drive_login_changed_v1';
 const PAUSE_KEY='flashcards_drive_paused_v1';
 function failure(code,auth=false){const e=Error(code);e.code=code;e.auth=auth;return e;}
 const authCodes=new Set(['app_login_required','google_auth_required','google_permission_required','offline_permission_required','google_account_mismatch']);
 function createController(options={}){
  const fetcher=options.fetcher||root.fetch.bind(root),storage=options.storage||root.localStorage;
  const tab=options.tabStorage||root.sessionStorage,now=options.now||Date.now,locks=options.locks||root.navigator?.locks;
  let memorySession=null,access=null,inflight=null,sessionFlight=null,phase='starting',reason='',epoch=0,nextRetry=0,failures=0;
  let paused=false;try{paused=tab?.getItem(PAUSE_KEY)==='1';}catch{}
  const clients=new Set();
  function announce(p,r=''){phase=p;reason=r;options.onState?.({phase,reason});}
  function read(){try{return JSON.parse(storage.getItem(SESSION_KEY))||memorySession;}catch{return memorySession;}}
  function expires(s){const x=Number(s?.expires_at||0);return x<1e12?x*1000:x;}
  function save(s){memorySession=s;try{storage.setItem(SESSION_KEY,JSON.stringify(s));}catch{throw failure('device_storage_unavailable');}}
  async function json(url,init={}){
   let response;try{response=await fetcher(url,{...init,cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw failure('network_temporarily_unavailable');}
   const data=await response.json().catch(()=>({}));return {response,data};
  }
  async function authRequest(grant,body){return json(URL_BASE+'/auth/v1/token?grant_type='+grant,{method:'POST',headers:{apikey:PUBLIC_KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});}
  async function refreshSession(force=false){
   const before=read();if(!before?.access_token||!before?.user?.id)throw failure('app_login_required',true);
   if(!force&&expires(before)>now()+90000)return before;
   if(!before.refresh_token)throw failure('app_login_required',true);
   const {response,data}=await authRequest('refresh_token',{refresh_token:before.refresh_token});
   if(!response.ok){
    const newer=read();if(newer?.refresh_token&&newer.refresh_token!==before.refresh_token&&expires(newer)>now()+30000)return newer;
    if([400,401,403].includes(response.status)&&['refresh_token_not_found','refresh_token_already_used','invalid_grant','invalid_refresh_token','session_not_found','session_expired'].includes(data.error_code||data.code||data.error))throw failure('app_login_required',true);
    if(response.status===401||response.status===403)throw failure('app_login_required',true);
    throw failure('app_session_temporarily_unavailable');
   }
   if(!data.access_token||!data.refresh_token||!data.user?.id||data.user.id!==before.user.id)throw failure('invalid_session_response');
   const current=read();if(current?.user?.id!==before.user.id)throw failure('connection_changed');
   const s={access_token:data.access_token,refresh_token:data.refresh_token,expires_at:now()+Number(data.expires_in||3600)*1000,user:data.user};save(s);return s;
  }
  async function underLock(fn){
   if(locks?.request)return locks.request('flashcards-app-refresh-v1',{mode:'exclusive'},fn);
   // Web Locks is preferred. A bounded lease coordinates older browser tabs.
   const key='flashcards_app_refresh_lock_v1',id=root.crypto.randomUUID();
   for(let i=0;i<150;i++){
    let old;try{old=JSON.parse(storage.getItem(key));}catch{}
    if(!old||old.until<now()){
     try{storage.setItem(key,JSON.stringify({id,until:now()+25000}));}catch{return fn();}
     await new Promise(r=>setTimeout(r,40));
     let mine;try{mine=JSON.parse(storage.getItem(key));}catch{}
     if(mine?.id===id){try{return await fn();}finally{try{if(JSON.parse(storage.getItem(key))?.id===id)storage.removeItem(key);}catch{}}}
    }
    await new Promise(r=>setTimeout(r,200));
   }
   throw failure('app_session_temporarily_unavailable');
  }
  function session(force=false){
   if(sessionFlight)return sessionFlight;
   sessionFlight=underLock(()=>refreshSession(force)).finally(()=>{sessionFlight=null;});return sessionFlight;
  }
  async function call(action,payload={},retry=true){
   const s=await session();
   const {response,data}=await json(ENDPOINT+'/'+action,{method:'POST',headers:{apikey:PUBLIC_KEY,Authorization:'Bearer '+s.access_token,'Content-Type':'application/json'},body:JSON.stringify(payload)});
   if(response.status===401&&data.error==='app_login_required'&&retry){await session(true);return call(action,payload,false);}
   if(!response.ok)throw failure(data.error||'service_temporarily_unavailable',authCodes.has(data.error));
   if(read()?.user?.id!==s.user.id)throw failure('connection_changed');
   return data;
  }
  function deliver(client){
   if(!access||access.until<=now()+30000||client.last===access.token)return;
   client.last=access.token;
   Promise.resolve().then(()=>client.callback({access_token:access.token,expires_in:Math.floor((access.until-now())/1000),scope:SCOPE})).catch(()=>{});
  }
  function getToken(force=false){
   if(paused)return Promise.reject(failure('connection_paused',true));
   if(!force&&access&&access.until>now()+120000)return Promise.resolve(access);
   if(inflight)return inflight;
   if(!force&&now()<nextRetry)return Promise.reject(failure('retry_pending'));
   const stamp=epoch;
   inflight=(async()=>{
    const data=await call('token',{force});
    if(stamp!==epoch||paused)throw failure('connection_changed');
    if(typeof data.access_token!=='string'||!data.access_token||!(Number(data.expires_in)>60)||typeof data.account!=='string')throw failure('invalid_provider_response');
    access={token:data.access_token,until:now()+Number(data.expires_in)*1000,account:data.account};failures=0;nextRetry=0;announce('connected');
    for(const c of clients)deliver(c);return access;
   })().catch(e=>{
    if(stamp===epoch&&!paused){
     if(e.auth){access=null;announce(e.code,e.code);nextRetry=now()+60000;}
     else{failures++;nextRetry=now()+Math.min(60000,2000*2**Math.min(failures,5));announce('temporary',e.code||'service_temporarily_unavailable');}
    }
    throw e;
   }).finally(()=>{inflight=null;});return inflight;
  }
  async function login(email,password){
   const {response,data}=await authRequest('password',{email:String(email).trim(),password:String(password)});
   if(!response.ok)throw failure(response.status===429?'login_rate_limited':'app_login_failed',true);
   if(!data.access_token||!data.refresh_token||!data.user?.id)throw failure('invalid_session_response');
   epoch++;access=null;save({access_token:data.access_token,refresh_token:data.refresh_token,expires_at:now()+Number(data.expires_in||3600)*1000,user:data.user});
   paused=false;try{tab?.removeItem(PAUSE_KEY);}catch{}nextRetry=0;announce('starting');return getToken();
  }
  function resume(){paused=false;try{tab?.removeItem(PAUSE_KEY);}catch{}nextRetry=0;return getToken();}
  function pause(){paused=true;epoch++;access=null;try{tab?.setItem(PAUSE_KEY,'1');}catch{}announce('connection_paused');}
  function initTokenClient(config){
   const client={callback:config.callback,last:''};clients.add(client);
   queueMicrotask(()=>{if(access)deliver(client);else getToken().catch(()=>{});});
   return {requestAccessToken:()=>options.onOpen?.()};
  }
  function tick(){if(!paused&&!authCodes.has(phase)&&phase!=='connection_paused')getToken().catch(()=>{});}
  function refreshNow(){if(paused||authCodes.has(phase)||phase==='starting'||now()<nextRetry)return;getToken(true).catch(()=>{});}
  return Object.freeze({session,call,getToken,login,resume,pause,initTokenClient,tick,refreshNow,
   required:()=>authCodes.has(phase)||phase==='connection_paused',state:()=>({phase,reason,account:access?.account||''}),
   hasGrantedAllScopes:(response,...wanted)=>wanted.every(s=>String(response.scope||'').split(/\s+/).includes(s))});
 }
 const messages={app_login_required:'最初に、この単語帳のアカウントでログインしてください。Googleのパスワードではありません。',google_auth_required:'Google Driveの継続利用を初回だけ許可してください。',google_permission_required:'Google Driveの利用許可をもう一度確認してください。',offline_permission_required:'自動更新の許可を確認できませんでした。Googleで接続し直してください。',google_account_mismatch:'保存済みのデータと同じGoogleアカウントを選んでください。',app_login_failed:'メールアドレスまたはアプリのパスワードを確認してください。',login_rate_limited:'ログインの試行が多いため、少し時間を置いてから操作してください。',device_storage_unavailable:'ログイン状態をこの端末に保存できません。保存領域の設定を確認してください。',server_not_configured:'サーバー側の初回設定が未完了です。',expired_or_invalid_state:'接続確認の期限が切れました。元の画面からやり直してください。'};
 let controller,dialog;
 function message(code){return messages[code]||'通信を完了できませんでした。写真と名前は保持しています。通信が戻ると自動で再試行します。';}
 function appChanged(){root.AuthOnlySync?.recheck?.();if(dialog?.open&&controller.state().phase==='connected')dialog.close();}
 function open(){
  if(!root.document)return;
  if(!dialog){
   dialog=document.createElement('dialog');dialog.className='auth-only-dialog';dialog.id='persistentDriveDialog';
   dialog.innerHTML='<h2>同期の初回ログイン</h2><p data-auth-message></p><form data-login-form><label>アプリのメールアドレス<input name="email" type="email" autocomplete="username" required></label><label>アプリのパスワード（Googleのパスワードではありません）<input name="password" type="password" autocomplete="current-password" required></label><button type="submit">ログインして続ける</button></form><button type="button" data-google>Googleで接続する</button><button type="button" data-close>閉じる</button><p data-error role="alert"></p>';
   document.body.append(dialog);
   dialog.querySelector('[data-close]').onclick=()=>dialog.close();
   dialog.querySelector('form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget,pass=form.elements.password,button=form.querySelector('button');button.disabled=true;dialog.querySelector('[data-error]').textContent='';
    try{await controller.login(form.elements.email.value,pass.value);}catch(err){dialog.querySelector('[data-error]').textContent=message(err.code);}finally{pass.value='';button.disabled=false;renderDialog();}
   };
   dialog.querySelector('[data-google]').onclick=()=>{
    let expected='';for(const api of [root.WordDriveSync,root.PlantDriveSync,root.ColorDriveSync]){if(api?.account){expected=api.account;break;}}
    try{root.sessionStorage.setItem('flashcards_drive_login_context_v1',JSON.stringify({expected_account:expected,returnTo:root.location.pathname+root.location.search}));}catch{}
    const popup=root.open('/flashcards/drive-login.html?start=1','flashcardsDriveLogin','popup=yes,width=520,height=720');
    if(!popup)dialog.querySelector('[data-error]').textContent='このサイトのポップアップを許可して、もう一度押してください。編集中の画面はそのまま残します。';
   };
  }
  renderDialog();if(!dialog.open)dialog.showModal();controller.resume().then(appChanged).catch(()=>renderDialog());
 }
 function renderDialog(){
  if(!dialog)return;const {phase}=controller.state();
  const needApp=phase==='app_login_required'||phase==='app_login_failed';
  dialog.querySelector('[data-login-form]').hidden=!needApp;
  dialog.querySelector('[data-google]').hidden=needApp||phase==='connected'||phase==='starting'||phase==='temporary';
  dialog.querySelector('[data-auth-message]').textContent=message(phase);
 }
 function start(){
  if(!root.document||controller)return;
  controller=createController({onState:()=>{appChanged();renderDialog();},onOpen:open});
  root.PersistentDriveAuth=Object.freeze({...controller,open,message});
  if(document.documentElement.dataset.driveLogin==='1')return;
  controller.tick();
  root.setInterval(()=>{if(document.visibilityState!=='hidden')controller.tick();},30000);
  for(const event of ['online','focus','pageshow'])root.addEventListener(event,()=>controller.tick());
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')controller.tick();});
  root.addEventListener('storage',e=>{if(e.key===SIGNAL_KEY||e.key===SESSION_KEY)controller.resume().catch(()=>{});});
  root.addEventListener('message',e=>{if(e.origin===root.location.origin&&e.data?.type==='flashcards-drive-connected')controller.resume().catch(()=>{});});
 }
 root.PersistentDriveAuthFactory=Object.freeze({createController,SESSION_KEY,SCOPE,ENDPOINT,SIGNAL_KEY,message});
 if(typeof module!=='undefined'&&module.exports)module.exports=root.PersistentDriveAuthFactory;
 if(root.document)start();
})(typeof window!=='undefined'?window:globalThis);
