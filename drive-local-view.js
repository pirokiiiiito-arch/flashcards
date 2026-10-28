/* Local persistence only. Authentication and network requests remain in the
 * existing GET-only viewer. No credential is read or written by this module. */
(function(root){
  'use strict';
  const REF=/^gdrive:([\w-]+):([a-f0-9]{64})$/;
  function createTransport(options){
    const {namespace,core}=options;
    const clientId=options.clientId||root.FLASHCARDS_DRIVE_CONFIG?.clientId||'default';
    const prefix='local-view-v1:'+encodeURIComponent(clientId)+':'+namespace+':';
    const onCache=options.onCache||(()=>{}),notify=options.onStatus||(()=>{});
    let snapshot=null,last={status:'端末保存を確認中',detail:''},running=null,owner='',bytes=0;
    const memory=new Map(),pending=new Map();
    const stats={savedImages:0,reusedImages:0,failedSaves:0};
    const store=options.store||root.DriveViewCache.createStore({onWarning:message=>onCache({durable:false,message})});
    async function get(key){try{return await store.get(prefix+key);}catch{return null;}}
    async function put(key,value){
      let result;try{result=await store.put(prefix+key,value);}catch{result={durable:false};}
      if(!result?.durable){stats.failedSaves++;onCache({durable:false,message:'端末に継続保存できません。一時表示は維持しますが、このページを閉じた後の再表示は保証できません。保存済みデータは削除しません。'});}
      return !!result?.durable;
    }
    function setStatus(status,detail=''){
      if(snapshot&&['未接続','取得エラー','取得未完了','認証準備エラー'].includes(status)){
        status='保存済みで閲覧';
        detail='保存済み写真・文字は再接続なしで表示できます。新しい写真や変更分の取得時だけ接続してください。\n'+detail;
      }
      last={status,detail};notify(status,detail);
    }
    function checkOwner(account){if(owner&&owner!==account)throw Error('保存済みデータとは別のGoogleアカウントです。元のアカウントで接続してください。保存済みの写真は保持しています。');}
    async function hash(value){return core.digest(core.stable(value));}
    const journalCache={
      async get(account,id,version){
        checkOwner(account);const item=await get('journal:'+account+':'+id);
        if(!item||item.version!==version||!item.doc||item.hash!==await hash(item.doc))return null;
        return item.doc;
      },
      async put(account,id,version,doc){checkOwner(account);await put('journal:'+account+':'+id,{version,doc,hash:await hash(doc)});}
    };
    const factory=options.baseFactory||root.DriveReadOnlyBase.createTransport;
    const base=factory({...options,journalCache,onStatus:setStatus});
    const ready=(async()=>{
      const pointer=await get('last-account');if(typeof pointer?.account!=='string'||!pointer.account)return null;
      const stored=await get('snapshot:'+pointer.account),body=stored?.body;
      if(body?.schema!=='flashcards-local-view-v1'||body.namespace!==namespace||body.clientId!==clientId||body.account!==pointer.account||!body.view?.data||!Array.isArray(body.imageFiles)||stored.hash!==await hash(body))return null;
      owner=body.account;snapshot=body;setStatus('保存済みで閲覧','端末の保存済みデータを復元しました。');return {...structuredClone(body),cached:true};
    })();
    function sync(){
      if(running)return running;
      running=(async()=>{
        await ready;const result=await base.sync();checkOwner(result.account);
        if(typeof result.account!=='string'||!result.account||!result.view?.data||!Array.isArray(result.imageFiles))throw Error('表示データの保存形式を確認できません。');
        const body={schema:'flashcards-local-view-v1',namespace,clientId,account:result.account,email:result.email||'',view:result.view,imageFiles:result.imageFiles,journals:result.journals||0,saved_at:new Date().toISOString()};
        const durable=await put('snapshot:'+body.account,{body,hash:await hash(body)});
        if(durable)await put('last-account',{account:body.account});
        owner=body.account;snapshot=structuredClone(body);
        if(durable)onCache({durable:true,message:'文字・写真の登録情報を端末保存しました。次回は接続せずに開きます。'});
        return {...result,cached:false,durable};
      })().catch(e=>{setStatus('取得未完了',e.message||String(e));throw e;}).finally(()=>{running=null;});return running;
    }
    function remember(key,blob){
      if(memory.has(key)){bytes-=memory.get(key).size;memory.delete(key);}
      while(memory.size&&(memory.size>=8||bytes+blob.size>64*1024*1024)){const oldest=memory.keys().next().value;bytes-=memory.get(oldest).size;memory.delete(oldest);}
      memory.set(key,blob);bytes+=blob.size;return blob;
    }
    async function getBlob(ref){
      const match=String(ref).match(REF);if(!match)throw Error('写真の登録情報が不正です。');await ready;
      if(!owner)throw Error('初回だけ接続して写真を取得してください。');
      const key='photo:'+owner+':'+ref;
      if(memory.has(key))return remember(key,memory.get(key));
      if(pending.has(key))return pending.get(key);
      const work=(async()=>{
        const saved=await get(key);
        if(saved instanceof Blob&&await core.digest(await saved.arrayBuffer())===match[2]){
          stats.reusedImages++;onCache({durable:true,message:'保存済み写真を端末から表示しました（Drive再取得なし）。'});return remember(key,saved);
        }
        if(!base.valid()||base.account!==owner)throw Error('この写真はまだ端末に保存されていません。取得するときだけ接続してください。');
        const blob=await base.getBlob(ref);
        if(!(blob instanceof Blob)||await core.digest(await blob.arrayBuffer())!==match[2])throw Error('画像の一致を確認できません。保存済み写真は上書きしません。');
        remember(key,blob);
        if(await put(key,blob)){stats.savedImages++;onCache({durable:true,message:'写真を端末保存しました。認証切れ・ページを開き直した後も再利用します。'});}
        return blob;
      })();
      pending.set(key,work);try{return await work;}finally{if(pending.get(key)===work)pending.delete(key);}
    }
    return Object.freeze({...base,ready,restore:()=>ready,sync,getBlob,setStatus,
      view:()=>snapshot?structuredClone(snapshot.view):base.view(),
      status:()=>({...base.status(),...last,cached:!!snapshot,pending:0,stats:{...stats}}),
      get account(){return owner||base.account;},get imageFiles(){return snapshot?snapshot.imageFiles.slice():base.imageFiles;}});
  }
  const exported=Object.freeze({createTransport});root.DriveLocalView=exported;
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
})(typeof window!=='undefined'?window:globalThis);
