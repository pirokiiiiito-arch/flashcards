/* Local viewing cache around the existing GET-only transport.
 * Authentication and authorization remain entirely in drive-readonly.js.
 * No remote writes, credential storage, or changes to editor databases. */
(function(root){
  'use strict';
  const copy=x=>structuredClone(x);
  const REF=/^gdrive:([\w-]+):([a-f0-9]{64})$/;
  function wrap(createBase,options){
    const {namespace,core}=options,cache=options.cache||root.DriveViewCache.create();
    const fetcher=options.fetcher||root.fetch.bind(root),notify=options.onStatus||(()=>{});
    const key=(...parts)=>JSON.stringify([namespace,...parts]);
    let owner='',current=null,loading=null,job=null,networkOwner='',last={status:'未接続',detail:''};
    let fresh=0,reused=0,savedPhotos=0,localPhotos=0,photoDownloads=0,bytes=0;
    const docs=new Map(),listed=new Map(),pending=new Map(),memory=new Map(),unsaved=new Set();
    const info=()=>({...cache.info(),photoSaved:savedPhotos,photoDiskHits:localPhotos,photoDownloads,unsavedPhotos:unsaved.size});
    function emit(s,d=''){
      if(current&&['未接続','取得エラー','認証準備エラー'].includes(s))s='保存済みを表示中';
      last={status:s,detail:d};
      const c=info(),warning=c.writeFailed?'\n端末保存に失敗した写真は一時表示です。保存済みのデータは削除していません。':'';
      notify(s,d+'\n写真：今回保存 '+savedPhotos+'枚 ／ 端末から表示 '+localPhotos+'枚 ／ 新規受信 '+photoDownloads+'枚'+warning);
    }
    cache.subscribe?.(()=>emit(last.status,last.detail));
    const revision=f=>f.md5Checksum?'md5:'+f.md5Checksum:f.version?'version:'+f.version:f.modifiedTime?'modified:'+f.modifiedTime+':'+f.size:null;
    function validate(doc){
      if(doc?.schema!==core.schema||doc.namespace!==namespace||!Array.isArray(doc.events))throw Error('保存履歴の形式が一致しません。');
      for(const e of doc.events)if(!e||typeof e.id!=='string'||typeof e.key!=='string'||!Array.isArray(e.parents))throw Error('保存履歴が不正です。');
      return doc;
    }
    async function intact(r){try{return r&&await core.digest(core.stable(validate(r.doc)))===r.sha256;}catch{return false;}}
    function view(records){
      const events=Object.create(null);
      for(const r of records)for(const e of validate(r.doc).events){
        if(events[e.id]&&core.stable(events[e.id])!==core.stable(e))throw Error('保存履歴が競合しています。');events[e.id]=e;
      }
      return core.materialize(events);
    }
    async function restore(){
      const account=await cache.get(key('last-account'));if(typeof account!=='string'||!account)return null;
      const m=await cache.get(key(account,'manifest'));
      if(m?.schema!=='flashcards-view-manifest-v1'||m.namespace!==namespace||m.account!==account||!Array.isArray(m.journals)||!Array.isArray(m.imageFiles))return null;
      const records=await cache.getMany(m.journals.map(x=>key(account,'journal',x.id,x.revision)));
      for(const r of records)if(!await intact(r))return null;
      const state=view(records);owner=account;
      m.journals.forEach((x,i)=>docs.set(x.id,{...records[i],revision:x.revision,persisted:true}));
      current={view:state,imageFiles:m.imageFiles,account,email:m.email||'',journals:m.journals.length,saved_at:m.saved_at,fromCache:true,delta:{downloaded:0,reused:m.journals.length},persistent:true};
      emit('保存済みを表示中','保存済みの写真はGoogleへ接続せずに表示できます。');return current;
    }
    function hydrate(){if(!loading)loading=restore().catch(()=>null);return loading;}
    // This receives only requests already authorized by the original transport.
    // Changed journal metadata is checked online before any body is reused.
    async function incrementalFetch(url,init){
      const u=new URL(url);
      if((init?.method||'GET')!=='GET'||u.origin!=='https://www.googleapis.com'||!u.pathname.startsWith('/drive/v3/'))throw Error('この閲覧画面はDriveの読み取りだけに対応します。');
      const isList=u.pathname.endsWith('/files'),isAbout=u.pathname.endsWith('/about');
      if(isList){
        const fields=u.searchParams.get('fields')||'';
        if(fields.includes('files(')&&!fields.includes('md5Checksum'))u.searchParams.set('fields',fields.replace('size,mimeType','size,mimeType,md5Checksum,modifiedTime,version'));
      }
      const id=u.pathname.split('/').pop(),listedFile=listed.get(id),rev=listedFile&&revision(listedFile);
      if(u.searchParams.get('alt')==='media'&&listedFile&&networkOwner&&rev){
        let r=docs.get(id);
        if(r?.revision!==rev)r=await cache.get(key(networkOwner,'journal',id,rev));
        if(await intact(r)){reused++;docs.set(id,{...r,revision:rev,persisted:r.persisted!==false});return new Response(JSON.stringify(r.doc),{headers:{'Content-Type':'application/json'}});}
      }
      const response=await fetcher(u.href,init);
      if(!response.ok)return response;
      if(isAbout){
        const user=(await response.clone().json()).user;
        if(typeof user?.permissionId!=='string'||!user.permissionId)throw Error('Googleアカウントを確認できません。');
        if(owner&&owner!==user.permissionId)throw Error('保存済み写真と別のGoogleアカウントです。元のアカウントで接続してください。');
        networkOwner=user.permissionId;
      }else if(isList&&u.searchParams.get('q')?.includes("value='journal'")){
        const data=await response.clone().json();for(const f of data.files||[])listed.set(f.id,f);
      }else if(u.searchParams.get('alt')==='media'&&listedFile&&networkOwner){
        const blob=await options.boundedBlob(response.clone());
        const doc=validate(JSON.parse(await blob.text())),sha256=await core.digest(core.stable(doc));
        docs.set(id,{doc,sha256,revision:rev||'sha:'+sha256,persisted:false});fresh++;
      }
      return response;
    }
    const base=createBase({...options,fetcher:incrementalFetch,onStatus:emit});
    async function sync(){
      if(job)return job;
      job=(async()=>{
        await hydrate();listed.clear();networkOwner='';fresh=0;reused=0;
        const result=await base.sync();
        const records=[],entries=[];
        for(const [id] of listed){
          const r=docs.get(id);if(!r)throw Error('更新履歴を保存できません。前回の保存分は保持しています。');
          records.push({id,revision:r.revision});
          if(!r.persisted)entries.push([key(result.account,'journal',id,r.revision),{doc:r.doc,sha256:r.sha256}]);
        }
        const m={schema:'flashcards-view-manifest-v1',namespace,account:result.account,email:result.email||'',journals:records,imageFiles:result.imageFiles,saved_at:new Date().toISOString()};
        entries.push([key(result.account,'manifest'),m],[key('last-account'),result.account]);
        const persistent=await cache.writeBatch(entries);
        if(persistent)for(const {id} of records)docs.get(id).persisted=true;
        owner=result.account;current={...result,saved_at:m.saved_at,fromCache:false,persistent,delta:{downloaded:fresh,reused}};
        return current;
      })().catch(e=>{emit(current?'保存済みを表示中':'取得未完了',e.message||String(e));throw e;}).finally(()=>{job=null;});return job;
    }
    function remember(ref,b){
      if(memory.has(ref)){bytes-=memory.get(ref).size;memory.delete(ref);}
      while(memory.size&&(memory.size>=8||bytes+b.size>48*1024*1024)){const id=memory.keys().next().value;bytes-=memory.get(id).size;memory.delete(id);}
      if(b.size<=48*1024*1024){memory.set(ref,b);bytes+=b.size;}
    }
    async function getBlob(ref){
      const match=String(ref).match(REF);if(!match)throw Error('写真参照が不正です。');
      await hydrate();if(!owner)throw Error('初回はGoogleへ接続して写真の登録情報を取得してください。');
      if(memory.has(ref)){const b=memory.get(ref);remember(ref,b);return b;}
      if(!pending.has(ref)){
        const work=(async()=>{
          const disk=await cache.get(key(owner,'blob',ref));
          if(disk instanceof Blob&&await core.digest(await disk.arrayBuffer())===match[2]){localPhotos++;remember(ref,disk);emit(last.status,last.detail);return disk;}
          const blob=await base.getBlob(ref);
          if(await core.digest(await blob.arrayBuffer())!==match[2])throw Error('写真の検証に失敗しました。保存済み写真は保持しています。');
          photoDownloads++;remember(ref,blob);
          if(await cache.writeBatch([[key(owner,'blob',ref),blob]])){savedPhotos++;unsaved.delete(ref);}else unsaved.add(ref);
          emit(last.status,last.detail);return blob;
        })();pending.set(ref,work);work.finally(()=>{if(pending.get(ref)===work)pending.delete(ref);}).catch(()=>{});
      }return pending.get(ref);
    }
    return Object.freeze({...base,hydrate,sync,getBlob,cacheInfo:info,cachedResult:()=>current,
      setStatus:emit,view:()=>current?copy(current.view):{data:{},deleted:{},conflicts:[]},
      status:()=>({...last,pending:0,readonly:true,cache:info(),delta:{downloaded:fresh,reused}}),
      get account(){return owner;},get imageFiles(){return current?.imageFiles.slice()||[];}});
  }
  root.DriveLocalView=Object.freeze({wrap});
  if(typeof module!=='undefined'&&module.exports)module.exports=root.DriveLocalView;
})(typeof window!=='undefined'?window:globalThis);
