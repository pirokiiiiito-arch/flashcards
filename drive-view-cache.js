/* Private on-device cache. No credentials, remote writes, clearing or migration.
 * Commit image bytes independently instead of repeatedly saving a huge JSON. */
(function(root){
  'use strict';
  function createStore(options={}){
    const idb=options.indexedDB===undefined?root.indexedDB:options.indexedDB;
    const caches=options.cacheStorage===undefined?root.caches:options.cacheStorage;
    const origin=options.origin||root.location?.origin||'https://local.invalid';
    const onWarning=options.onWarning||(()=>{}),timeout=options.timeout||5000;
    let opening=null,clock=0,skipIDBWrite=false,skipCacheWrite=false;
    const revision=()=>clock=Math.max(Date.now(),clock+1);
    function open(){
      if(!idb)return Promise.reject(Error('IndexedDB unavailable'));
      if(!opening)opening=new Promise((resolve,reject)=>{
        let settled=false,req;
        const timer=setTimeout(()=>{settled=true;reject(Error('IndexedDB open timeout'));},timeout);
        try{req=idb.open('flashcards_view_cache_v1',1);}catch(e){clearTimeout(timer);reject(e);return;}
        req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains('entries'))req.result.createObjectStore('entries');};
        req.onerror=()=>{clearTimeout(timer);settled=true;reject(req.error||Error('IndexedDB open failed'));};
        req.onblocked=()=>{clearTimeout(timer);settled=true;reject(Error('IndexedDB blocked'));};
        req.onsuccess=()=>{clearTimeout(timer);if(settled){req.result.close();return;}const db=req.result;db.onversionchange=()=>{db.close();opening=null;};resolve(db);};
      }).catch(e=>{opening=null;throw e;});
      return opening;
    }
    async function transaction(mode,fn){
      const db=await open();
      return new Promise((resolve,reject)=>{
        let tx,request,done=false;
        const timer=setTimeout(()=>{if(done)return;done=true;try{tx?.abort();}catch{}reject(Error('IndexedDB transaction timeout'));},timeout);
        try{
          tx=db.transaction('entries',mode);request=fn(tx.objectStore('entries'));
          tx.oncomplete=()=>{if(done)return;done=true;clearTimeout(timer);resolve(request.result);};
          tx.onerror=tx.onabort=()=>{if(done)return;done=true;clearTimeout(timer);reject(tx.error||request.error||Error('IndexedDB transaction failed'));};
        }catch(e){done=true;clearTimeout(timer);reject(e);}
      });
    }
    const address=key=>origin+'/flashcards/__private_view_cache_v1__/'+encodeURIComponent(key);
    async function cacheRead(key){
      if(!caches)return null;
      let latest=null;
      // Read both generations without deleting either. The new name cannot
      // match an older word worker's overbroad "flashcards-v" cleanup prefix.
      for(const name of ['flashcards-private-view-v2','flashcards-view-private-v1']){
        const response=await (await caches.open(name)).match(address(key));
        if(!response)continue;
        const rev=Number(response.headers.get('x-cache-revision'));if(!Number.isFinite(rev))continue;
        if(latest&&latest.revision>=rev)continue;
        const value=response.headers.get('x-cache-kind')==='blob'?await response.blob():await response.json();
        latest={revision:rev,value};
      }
      return latest;
    }
    async function get(key){
      let a=null,b=null;
      try{a=await transaction('readonly',s=>s.get(key));}catch{}
      try{b=await cacheRead(key);}catch{}
      const latest=!a?b:!b?a:a.revision>=b.revision?a:b;
      return latest?.value??null;
    }
    async function put(key,value){
      const entry={revision:revision(),value};
      try{
        if(skipIDBWrite)throw Error('IndexedDB write previously failed');
        await transaction('readwrite',s=>s.put(entry,key));return {durable:true,backend:'IndexedDB'};
      }catch{skipIDBWrite=true;}
      try{
        if(!caches||skipCacheWrite)throw Error('CacheStorage unavailable');
        const blob=value instanceof Blob;
        const response=new Response(blob?value:JSON.stringify(value),{headers:{'Content-Type':blob?(value.type||'application/octet-stream'):'application/json','x-cache-kind':blob?'blob':'json','x-cache-revision':String(entry.revision)}});
        await (await caches.open('flashcards-private-view-v2')).put(address(key),response);
        return {durable:true,backend:'CacheStorage'};
      }catch{skipCacheWrite=true;onWarning('端末への継続保存ができません。このページでは表示を続けますが、閉じた後の再表示は保証できません。保存済みデータは削除していません。');return {durable:false,backend:'memory'};}
    }
    return Object.freeze({get,put});
  }
  const exported=Object.freeze({createStore});root.DriveViewCache=exported;
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
})(typeof window!=='undefined'?window:globalThis);
