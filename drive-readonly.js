/* Storage-free viewer. No IndexedDB, localStorage, service worker, uploads,
 * deletions, migration or editing. Existing appData journals are read unchanged.
 * OAuth tokens stay in this page's memory and are sent only to Drive v3 GETs. */
(function(root){
  'use strict';
  const BASE='https://www.googleapis.com/drive/v3/';
  const SCOPE='https://www.googleapis.com/auth/drive.appdata';
  const REF=/^gdrive:([\w-]+):([a-f0-9]{64})$/;
  async function boundedBlob(response,max=50*1024*1024){
    if(Number(response.headers.get('content-length')||0)>max)throw Error('取得データが安全な読込サイズを超えています。元データは保持しています。');
    if(!response.body?.getReader){const b=await response.blob();if(b.size>max)throw Error('取得データが大きすぎます。');return b;}
    const reader=response.body.getReader(),chunks=[];let size=0;
    try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>max){await reader.cancel();throw Error('取得データが大きすぎます。');}chunks.push(value);}}
    finally{reader.releaseLock();}
    return new Blob(chunks,{type:response.headers.get('content-type')||'application/octet-stream'});
  }
  function createTransport({namespace,core,fetcher=root.fetch.bind(root),onStatus=()=>{}}){
    if(!/^[a-z0-9-]+$/.test(namespace))throw Error('表示対象が不正です。');
    let token='',expires=0,epoch=0,expiryTimer,account='',running=null;
    let last={status:'未接続',detail:'Googleに接続すると、保存せずに読み込みます。'};
    let current={data:{},deleted:{},conflicts:[]},files=[];
    const controllers=new Set(),blobs=new Map(),inflight=new Map();
    let bytes=0;
    const status=(s,d='')=>{last={status:s,detail:d};onStatus(s,d);};
    const valid=()=>!!token&&Date.now()<expires-30000;
    function disconnect(message='接続を終了しました。保存データは変更していません。'){
      token='';expires=0;epoch++;clearTimeout(expiryTimer);for(const c of controllers)c.abort();controllers.clear();
      blobs.clear();inflight.clear();bytes=0;status('未接続',message);
    }
    function authorize(value,seconds){
      if(typeof value!=='string'||!value)throw Error('Google認証を確認できません。');
      disconnect('接続を切り替えています。');token=value;expires=Date.now()+Number(seconds||3600)*1000;account='';current={data:{},deleted:{},conflicts:[]};files=[];
      expiryTimer=setTimeout(()=>disconnect('認証期限が切れました。「接続して表示」で再接続してください。'),Math.max(0,expires-Date.now()-30000));
      status('接続済み','Driveからの受信を開始します。');
    }
    async function request(url){
      if(!valid()){const e=Error('「接続して表示」からGoogleに再接続してください。');e.auth=true;throw e;}
      const u=new URL(url);
      if(u.origin!=='https://www.googleapis.com'||!u.pathname.startsWith('/drive/v3/')||u.username||u.password)throw Error('許可されていない取得先です。');
      const stamp=epoch,controller=new AbortController();controllers.add(controller);
      const timeout=setTimeout(()=>controller.abort(),45000);
      try{
        const r=await fetcher(u.href,{method:'GET',headers:{Authorization:'Bearer '+token},cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});
        if(stamp!==epoch)throw Error('接続が切り替わったため古い取得結果を破棄しました。');
        if(r.status===401){disconnect('認証期限が切れました。「接続して表示」で再接続してください。');const e=Error('Googleへの再接続が必要です。');e.auth=true;throw e;}
        if(!r.ok){const body=await r.json().catch(()=>({}));throw Error(body.error?.message||'Driveから取得できません（HTTP '+r.status+'）。');}
        // Consume the response inside the timeout, including a stalled body.
        const blob=await boundedBlob(r);
        if(stamp!==epoch)throw Error('接続が変更されました。');
        return {json:async()=>JSON.parse(await blob.text()),blob:async()=>blob};
      }finally{clearTimeout(timeout);controllers.delete(controller);}
    }
    async function list(kind){
      const result=[];let next='';
      do{
        const q="appProperties has { key='namespace' and value='"+namespace+"' } and appProperties has { key='kind' and value='"+kind+"' } and trashed=false";
        const p=new URLSearchParams({spaces:'appDataFolder',q,pageSize:'1000',fields:'nextPageToken,files(id,name,appProperties,sha256Checksum,size,mimeType)'});
        if(next)p.set('pageToken',next);
        const data=await (await request(BASE+'files?'+p)).json();
        if(!Array.isArray(data.files))throw Error('Driveの一覧形式を確認できません。');
        result.push(...data.files);next=data.nextPageToken||'';
        if(result.length>10000)throw Error('Driveの履歴が多すぎるため、安全のため読み込みを止めました。履歴は削除していません。');
      }while(next);
      return result;
    }
    async function receive(){
      const stamp=epoch;status('受信中','Googleアカウントを確認しています。');
      const user=(await (await request(BASE+'about?fields=user(permissionId,emailAddress)')).json()).user;
      if(!user?.permissionId)throw Error('Googleアカウントを確認できません。');account=user.permissionId;
      const journals=await list('journal'),events=Object.create(null);
      for(let i=0;i<journals.length;i++){
        if(i%5===0)status('受信中','履歴 '+(i+1)+' / '+journals.length+'件を読込中。端末には保存しません。');
        const doc=await (await request(BASE+'files/'+encodeURIComponent(journals[i].id)+'?alt=media')).json();
        if(doc.schema!==core.schema||doc.namespace!==namespace||!Array.isArray(doc.events))throw Error('Driveの履歴形式を確認できません。');
        for(const event of doc.events){
          if(!event||typeof event.id!=='string'||typeof event.key!=='string'||!Array.isArray(event.parents))throw Error('Drive履歴の項目が不正です。');
          if(events[event.id]&&core.stable(events[event.id])!==core.stable(event))throw Error('履歴IDが競合しています。元データは変更していません。');
          events[event.id]=event;
        }
        if(Object.keys(events).length>300000)throw Error('履歴が大きすぎます。元データは変更していません。');
      }
      const view=core.materialize(events),images=await list('image');
      if(stamp!==epoch||!valid())throw Error('接続が切れたため受信を完了できませんでした。');
      current=view;files=images;
      return {view,imageFiles:images,journals:journals.length,email:user.emailAddress||'',account};
    }
    function sync(){
      if(running)return running;
      const stamp=epoch;
      running=receive().catch(e=>{if(stamp===epoch)status(e.auth?'未接続':'取得エラー',e.message||String(e));throw e;}).finally(()=>{running=null;});
      return running;
    }
    async function getBlob(ref){
      const match=String(ref).match(REF);if(!match)throw Error('写真のDrive参照が不正です。');
      if(blobs.has(ref)){const b=blobs.get(ref);blobs.delete(ref);blobs.set(ref,b);return b;}
      if(!inflight.has(ref)){
        const stamp=epoch;
        inflight.set(ref,(async()=>{
          const blob=await (await request(BASE+'files/'+encodeURIComponent(match[1])+'?alt=media')).blob();
          if(await core.digest(await blob.arrayBuffer())!==match[2])throw Error('Drive画像のSHA-256が一致しません。');
          if(stamp!==epoch)throw Error('接続が変更されました。');
          while(blobs.size&&(blobs.size>=4||bytes+blob.size>48*1024*1024)){const first=blobs.keys().next().value;bytes-=blobs.get(first).size;blobs.delete(first);}
          if(blob.size<=48*1024*1024){blobs.set(ref,blob);bytes+=blob.size;}
          return blob;
        })().finally(()=>inflight.delete(ref)));
      }
      return inflight.get(ref);
    }
    return Object.freeze({authorize,disconnect,valid,sync,getBlob,setStatus:status,digest:core.digest,
      view:()=>structuredClone(current),status:()=>({...last,pending:0,readonly:true}),get account(){return account;},get imageFiles(){return files.slice();}});
  }
  function install(cfg){
    const container=document.querySelector(cfg.toolbar)||document.body;
    const box=document.createElement('section');box.className='drive-readonly-controls';box.dataset.driveReadonlyControls='1';
    box.style.cssText='width:100%;padding:14px;border:1px solid #cbd1d9;border-radius:12px;background:white;line-height:1.6';
    const title=document.createElement('strong');title.textContent='保存不要のDrive閲覧モード';
    const description=document.createElement('p');description.textContent='写真・文字をDriveから直接受信します。端末キャッシュを保存せず、PC・Driveのデータも変更しません。この画面では編集できません。';
    const connect=document.createElement('button');connect.className='btn';connect.textContent='接続して表示';connect.disabled=true;
    const refresh=document.createElement('button');refresh.className='btn';refresh.textContent='Driveから再取得';
    const output=document.createElement('p');output.setAttribute('role','status');output.style.whiteSpace='pre-wrap';
    box.append(title,description,connect,refresh,output);container.prepend(box);
    let gisPromise,client,applying=null;
    const transport=createTransport({namespace:cfg.namespace,core:root.FlashcardsDrive,onStatus:(s,m)=>{output.textContent=s+'\n'+m;cfg.onStatus?.(s,m);}});
    async function sync(){
      if(applying)return applying;
      applying=(async()=>{
        await cfg.ready;
        const result=await transport.sync();
        if(!transport.valid())throw Error('Googleへの再接続が必要です。');
        await cfg.apply(result,api);
        if(transport.valid())transport.setStatus('受信済み',cfg.summary?.(result)||'文字・画像の参照を受信しました。写真は表示する欄から取得します。');
        return result;
      })().catch(e=>{transport.setStatus(transport.valid()?'取得未完了':'未接続',e.message||String(e));throw e;}).finally(()=>{applying=null;});return applying;
    }
    async function prepare(){
      connect.disabled=true;
      try{
        if(!root.google?.accounts?.oauth2){
          if(!gisPromise)gisPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.onload=resolve;s.onerror=()=>{gisPromise=null;reject(Error('Google認証を読み込めません。通信状況を確認してください。'));};document.head.appendChild(s);});
          await gisPromise;
        }
        const id=root.FLASHCARDS_DRIVE_CONFIG?.clientId;
        if(!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id||''))throw Error('Google認証の設定を読み込めません。');
        client=root.google.accounts.oauth2.initTokenClient({client_id:id,scope:SCOPE,include_granted_scopes:false,
          callback:async response=>{
            if(response.error||!response.access_token||!root.google.accounts.oauth2.hasGrantedAllScopes(response,SCOPE)){transport.setStatus('認証未完了','Google Driveの許可を確認できません。');return;}
            transport.authorize(response.access_token,response.expires_in);
            try{await sync();}catch(_){/* status already visible */}
          },error_callback:e=>transport.setStatus('未接続',e.type==='popup_closed'?'Google認証画面が閉じられました。':'Googleの認証画面を開けません。ブラウザから接続してください。')});
        connect.disabled=false;
      }catch(e){transport.setStatus('認証準備エラー',e.message||String(e));}
    }
    function open(){box.scrollIntoView?.({block:'start',behavior:'smooth'});if(!client)prepare();}
    connect.onclick=()=>{if(client)client.requestAccessToken({prompt:''});};
    refresh.onclick=()=>{if(!transport.valid()){open();transport.setStatus('未接続','「接続して表示」を押してください。');return;}sync().catch(()=>{});};
    const api=Object.freeze({...transport,open,sync,get account(){return transport.account;},get imageFiles(){return transport.imageFiles;}});
    prepare();return api;
  }
  const exported=Object.freeze({createTransport,install,boundedBlob});root.DriveReadOnly=exported;
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
})(typeof window!=='undefined'?window:globalThis);
