/* Read previously saved app data only. Never creates, upgrades, deletes, or
 * writes an old database; never reads login/session/token storage. */
(function(root){
  'use strict';
  function createReader(idb=root.indexedDB,timeout=2000){
    async function read(store,key){
      if(!idb)return null;
      try{
        if(typeof idb.databases==='function'){
          const list=await Promise.race([idb.databases(),new Promise(r=>setTimeout(()=>r(null),timeout))]);
          if(list&&!list.some(x=>x.name==='flashcards_drive_cache_v3'))return null;
        }
        return await new Promise(resolve=>{
          let db,done=false;
          const finish=value=>{if(done)return;done=true;clearTimeout(timer);try{db?.close();}catch{}resolve(value??null);};
          const timer=setTimeout(()=>finish(null),timeout);
          let req;try{req=idb.open('flashcards_drive_cache_v3');}catch{return finish(null);}
          req.onupgradeneeded=()=>{try{req.transaction.abort();}catch{}finish(null);};
          req.onerror=req.onblocked=()=>finish(null);
          req.onsuccess=()=>{
            db=req.result;if(done){db.close();return;}
            if(!db.objectStoreNames.contains(store))return finish(null);
            try{const tx=db.transaction(store,'readonly'),r=tx.objectStore(store).get(key);
              r.onsuccess=()=>finish(r.result);r.onerror=()=>finish(null);tx.onabort=()=>finish(null);
            }catch{finish(null);}
          };
        });
      }catch{return null;}
    }
    async function snapshot(namespace,core){
      if(!['plant-flashcards','colors1000-review47'].includes(namespace))return null;
      const state=await read('states',namespace);
      if(!state||typeof state.account!=='string'||!state.account||!state.events||typeof state.events!=='object')return null;
      let view;try{view=core.materialize(state.events);}catch{return null;}
      // Missing journal keys are not deletions. Keep saved local keys only
      // where neither a live event nor an explicit tombstone exists.
      for(const [key,value] of Object.entries(state.snapshot||{})){
        if(!(key in view.data)&&!(key in view.deleted))view.data[key]=structuredClone(value);
      }
      if(!Object.keys(view.data).length)return null;
      const refs=namespace==='colors1000-review47'?await read('states','colors1000_private_asset_refs_v3'):null;
      const images=new Map();
      for(const value of Object.values(refs||{})){
        const m=String(value).match(/^gdrive:([\w-]+):([a-f0-9]{64})$/);
        if(m)images.set(m[1],{id:m[1],appProperties:{sha256:m[2]},sha256Checksum:m[2]});
      }
      return {account:state.account,view,imageFiles:[...images.values()],source:'existing-device-sync-cache'};
    }
    return Object.freeze({snapshot,photo:ref=>read('blobs',ref)});
  }
  const exported=Object.freeze({createReader});root.DriveLegacyView=exported;
  if(typeof module!=='undefined'&&module.exports)module.exports=exported;
})(typeof window!=='undefined'?window:globalThis);
