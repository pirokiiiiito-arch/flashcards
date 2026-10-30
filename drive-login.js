/* Initial Google Drive consent callback. Refresh credentials stay on the server.
 * This page keeps only a one-use PKCE verifier/state in sessionStorage. */
(function(root){
  'use strict';
  const auth=root.PersistentDriveAuth;
  const factory=root.PersistentDriveAuthFactory;
  const doc=root.document;
  if(!doc||!auth||!factory)return;
  const status=doc.getElementById('loginStatus');
  const retry=doc.getElementById('retryLogin');
  const back=doc.getElementById('returnToCards');
  const PENDING_KEY='flashcards_drive_login_pending_v1';
  const CONTEXT_KEY='flashcards_drive_login_context_v1';
  const CALLBACK_PATH='/flashcards/drive-login.html';

  function setStatus(message,error=false){
    if(status){status.textContent=message;status.style.color=error?'#a52c2c':'';}
    if(retry)retry.hidden=!error;
  }
  function base64url(bytes){
    let raw='';for(const n of new Uint8Array(bytes))raw+=String.fromCharCode(n);
    return btoa(raw).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  }
  function randomVerifier(){
    return base64url(root.crypto.getRandomValues(new Uint8Array(64)));
  }
  async function challenge(verifier){
    return base64url(await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier)));
  }
  function safeReturn(value){
    const v=String(value||'');
    return /^\/flashcards\/(?:[^?#]*)?(?:\?[^#]*)?$/.test(v)?v:'/flashcards/';
  }
  function readContext(){
    let raw='';
    try{raw=root.opener?.sessionStorage?.getItem(CONTEXT_KEY)||root.sessionStorage.getItem(CONTEXT_KEY)||'';}catch{}
    try{
      const x=JSON.parse(raw||'{}');
      return {expected_account:/^[\w-]{1,200}$/.test(String(x.expected_account||''))?String(x.expected_account):'',returnTo:safeReturn(x.returnTo)};
    }catch{return {expected_account:'',returnTo:'/flashcards/'};}
  }
  function readPending(){
    try{
      const x=JSON.parse(root.sessionStorage.getItem(PENDING_KEY)||'null');
      if(!x||!/^[\w-]{43}$/.test(x.state||'')||!/^[A-Za-z0-9._~-]{43,128}$/.test(x.verifier||''))return null;
      return {state:x.state,verifier:x.verifier,returnTo:safeReturn(x.returnTo)};
    }catch{return null;}
  }
  function clearQuery(){
    try{root.history.replaceState(null,'',CALLBACK_PATH);}catch{}
  }
  async function begin(){
    setStatus('Google Driveの初回接続を準備しています。');
    const context=readContext(),verifier=randomVerifier();
    const data=await auth.call('start',{code_challenge:await challenge(verifier),expected_account:context.expected_account});
    const target=new URL(String(data.authorization_url||''));
    if(target.origin!=='https://accounts.google.com'||!/^[\w-]{43}$/.test(data.state||''))throw Object.assign(Error('invalid_authorization_response'),{code:'invalid_authorization_response'});
    root.sessionStorage.setItem(PENDING_KEY,JSON.stringify({state:data.state,verifier,returnTo:context.returnTo}));
    root.location.replace(target.href);
  }
  async function finish(params){
    const pending=readPending();
    const state=params.get('state')||'',code=params.get('code')||'';
    clearQuery();
    if(!pending||state!==pending.state||code.length<5)throw Object.assign(Error('expired_or_invalid_state'),{code:'expired_or_invalid_state'});
    setStatus('Google Driveの接続を確認しています。');
    await auth.call('exchange',{code,state,code_verifier:pending.verifier});
    root.sessionStorage.removeItem(PENDING_KEY);
    try{root.localStorage.setItem(factory.SIGNAL_KEY,String(Date.now()));}catch{}
    if(back)back.href=pending.returnTo;
    try{root.opener?.postMessage({type:'flashcards-drive-connected'},root.location.origin);}catch{}
    setStatus('接続できました。以後は認証を自動更新します。');
    try{root.opener?.focus();}catch{}
    root.setTimeout(()=>{try{root.close();}catch{}},450);
  }
  async function run(){
    try{
      const params=new URLSearchParams(root.location.search);
      if(params.get('error')){
        clearQuery();
        throw Object.assign(Error(params.get('error_description')||params.get('error')),{code:params.get('error')||'google_auth_required'});
      }
      if(params.has('code')||params.has('state'))return await finish(params);
      if(params.get('start')==='1')return await begin();
      setStatus('元のカード画面から「Googleで接続する」を押してください。');
    }catch(error){
      const code=error?.code||error?.message||'service_temporarily_unavailable';
      setStatus(auth.message?.(code)||'接続を完了できませんでした。元のカードと写真は保持しています。',true);
    }
  }
  if(retry)retry.onclick=()=>{try{root.sessionStorage.removeItem(PENDING_KEY);}catch{}begin().catch(error=>setStatus(auth.message?.(error?.code)||'接続を開始できませんでした。',true));};
  run();
  root.DriveLoginFlow=Object.freeze({begin});
})(typeof window!=='undefined'?window:globalThis);
