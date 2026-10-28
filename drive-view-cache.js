/* Dedicated, optional local viewing cache. Never writes OAuth tokens or edits
 * the existing editors' databases. Failed writes must not stop viewing. */
(function(root){
  'use strict';
  function create({indexedDB:factory=root.indexedDB,timeoutMs=5000}={}){
    let connection=null,opening=null,writeBlocked=false;
    const listeners=new Set();
    const info={available:null,writeFailed:false,lastError:'',writes:0};
    const report=()=>{for(const fn of listeners)try{fn({...info});}catch{}};
    function failure(error,write){
      info.available=false;info.lastError=String(error?.name||error?.message||'StorageError');
      if(write){writeBlocked=true;info.writeFailed=true;}report();
    }
    function open(){
      if(connection)return Promise.resolve(connection);
      if(opening)return opening;
      opening=new Promise((resolve,reject)=>{
        if(!factory){reject(Error('IndexedDBUnavailable'));return;}
        let done=false,request;
        const timer=setTimeout(()=>finish(Error('StorageTimeout')),timeoutMs);
        function finish(error,db){
          if(done){db?.close();return;}done=true;clearTimeout(timer);
          if(error)reject(error);else{connection=db;db.onversionchange=()=>{db.close();connection=null;};resolve(db);}
        }
        try{
          request=factory.open('flashcards_view_cache_v1',1);
          request.onupgradeneeded=()=>{if(!request.result.objectStoreNames.contains('records'))request.result.createObjectStore('records');};
          request.onsuccess=()=>finish(null,request.result);
          request.onerror=()=>finish(request.error||Error('StorageOpenError'));
          request.onblocked=()=>finish(Error('StorageBlocked'));
        }catch(e){finish(e);}
      }).finally(()=>{opening=null;});
      return opening;
    }
    async function transaction(mode,run){
      const db=await open();
      return new Promise((resolve,reject)=>{
        let tx,done=false,result;
        const finish=(error)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(result);};
        const timer=setTimeout(()=>{try{tx?.abort();}catch{}finish(Error('StorageTimeout'));},timeoutMs);
        try{
          tx=db.transaction('records',mode);
          tx.oncomplete=()=>finish();tx.onerror=tx.onabort=()=>finish(tx.error||Error('StorageTransactionError'));
          result=run(tx.objectStore('records'));
        }catch(e){try{tx?.abort();}catch{}finish(e);}
      });
    }
    async function getMany(keys){
      try{
        const values=await transaction('readonly',store=>{
          const out=new Array(keys.length);
          keys.forEach((key,i)=>{const request=store.get(key);request.onsuccess=()=>{out[i]=request.result;};});return out;
        });
        info.available=true;return values;
      }catch(e){failure(e,false);return keys.map(()=>undefined);}
    }
    async function writeBatch(entries){
      if(writeBlocked)return false;
      try{
        await transaction('readwrite',store=>{for(const [key,value] of entries)store.put(value,key);});
        info.available=true;info.writeFailed=false;info.lastError='';info.writes++;report();return true;
      }catch(e){failure(e,true);return false;}
    }
    return Object.freeze({get:async key=>(await getMany([key]))[0],getMany,writeBatch,
      info:()=>({...info}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},
      retry:()=>{writeBlocked=false;},close:()=>{connection?.close();connection=null;}});
  }
  const api=Object.freeze({create});root.DriveViewCache=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
