/* Private Bookshelf: user book bytes are stored only on this device. */
'use strict';
const LibraryDB = (() => {
  const DB = 'private-bookshelf-v1';
  const VERSION = 1;
  const rulesURL = new URL('./shelf-registration.mjs', document.currentScript.src).href;
  const admittedReads = new WeakMap();
  async function authorizeFile(book, blob) {
    const policy = await import(rulesURL);
    return policy.admitBlob(book, blob, await policy.ledger(true));
  }
  async function catalogFilter(entries) {
    const policy = await import(rulesURL), active = await policy.ledger(true), admitted = [];
    for (const book of entries) {
      const record = await policy.admitEntry(book, active);
      if (record) admitted.push({...book, registrationRoot:record.chunkRoot, registrationChannel:record.channel || 'existing',
        sourceProof:record.evidence?.sourceProof || null});
    }
    return admitted;
  }
  async function savedEditionState(meta,requireCurrent=false) {
    if(!meta?.id)return 'unknown';
    try {
      const policy=await import(rulesURL);
      let registry;
      if(requireCurrent){
        // A previously cached ledger can identify an obsolete edition, but cannot confirm freshness.
        if(!navigator.onLine)return 'unknown';
        const url=new URL('../quality/shelf-registration.json?current=1',rulesURL);
        const response=await fetch(url,{cache:'no-store'});
        if(!response.ok)return 'unknown';
        registry=await policy.parseLedger(await response.json());
      }else{registry=await policy.ledger();}
      const records=registry.get(await policy.textHash(meta.id));
      if(!records?.length)return 'unknown';
      if(meta.registrationRoot){
        return records.some(row=>row.chunkRoot===meta.registrationRoot)?'current':'changed';
      }
      // Records saved before admission tracking have sizes but no verified root.
      return records.every(row=>row.bytes!==meta.size)?'changed':'unknown';
    } catch (_) {return 'unknown';}
  }
  const CHUNK = 4 * 1024 * 1024;
  const SAFE_ID = /^[a-zA-Z0-9_-]{1,90}$/;
  function checkId(id) { if (!SAFE_ID.test(id)) throw new Error('書籍IDが不正です'); return id; }
  function open() { return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('books')) db.createObjectStore('books');
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error || new Error('端末の保存領域を開けません'));
    r.onblocked = () => reject(new Error('同じ本棚を開いている別のタブを閉じてください'));
  }); }
  async function storeGet(db, store, key) { return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  }); }
  async function storePut(db, store, key, value) { return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('端末保存に失敗しました'));
  }); }
  function chunkKey(id, generation, index) {
    return `${checkId(id)}|${generation}|${String(index).padStart(6, '0')}`;
  }
  async function getMeta(id) { const db = await open(); try { return await storeGet(db, 'books', checkId(id)); } finally { db.close(); } }
  async function listMeta() { const db = await open(); try { return await new Promise((resolve, reject) => {
    const r = db.transaction('books', 'readonly').objectStore('books').getAll();
    r.onsuccess = () => resolve(r.result || []); r.onerror = () => reject(r.error);
  }); } finally { db.close(); } }
  function generationRange(id, generation) {
    const prefix=checkId(id)+'|'+generation+'|';
    return IDBKeyRange.bound(prefix,prefix+'\uffff');
  }
  function generationBlob(chunks,meta) {
    return new Promise((resolve,reject)=>{
      const req=chunks.getAll(generationRange(meta.id,meta.generation));
      req.onerror=()=>reject(req.error);
      req.onsuccess=()=>{
        if(req.result.length!==meta.count || req.result.some(piece=>!(piece instanceof Blob))){
          reject(new Error('保存中の書籍が一部欠落しています'));return;
        }
        const blob=new Blob(req.result,{type:'application/zip'});
        if(blob.size!==meta.size){reject(new Error('保存中の書籍のサイズが一致しません'));return;}
        resolve(blob);
      };
    });
  }
  async function newWriter(book) {
    checkId(book.id);
    const db = await open();
    const original = await storeGet(db, 'books', book.id);
    const generation = `g${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let count = 0, total = 0, active = true;
    return {
      async write(blob) {
        if (!active) throw new Error('保存処理は終了しています');
        if (!(blob instanceof Blob) || blob.size < 1 || blob.size > CHUNK) throw new Error('チャンクのサイズが不正です');
        await storePut(db, 'chunks', chunkKey(book.id, generation, count), blob);
        count++; total += blob.size;
      },
      async commit(expectedSize = null, validate = null) {
        if (!active) throw new Error('保存処理は終了しています');
        if (!count || (expectedSize != null && total !== expectedSize)) throw new Error('書籍の保存サイズが一致しません');
        const meta = {id:book.id, title:String(book.title||book.id), subtitle:String(book.subtitle||''), scans:Number(book.scans)||null,
          generation, count, size:total, date:Date.now(), format:'unified-zip-v1'};
        const blob=await generationBlob(db.transaction('chunks','readonly').objectStore('chunks'),meta);
        const admission=await authorizeFile(book,blob);
        if(validate)await validate(blob);
        meta.registrationRoot=admission.chunkRoot;
        await new Promise((resolve,reject)=>{
          const tx=db.transaction(['books','chunks'],'readwrite'),books=tx.objectStore('books'),old=books.get(book.id);
          old.onsuccess=()=>{
            if(old.result?.generation!==original?.generation && old.result?.registrationRoot!==meta.registrationRoot) { tx.abort(); return; }
            books.put(meta,book.id);
            if(old.result?.generation && old.result.generation!==generation)
              tx.objectStore('chunks').delete(generationRange(book.id,old.result.generation));
          };
          tx.oncomplete=()=>resolve();
          tx.onabort=tx.onerror=()=>reject(tx.error||new Error('修正版を保存できません'));
        });
        active=false;db.close();
        return meta;
      },
      async abort() {
        if (!active) return;
        active = false; db.close();
        try { await deleteGeneration(book.id, generation); } catch (_) {}
      },
      get size() { return total; }, get chunks() { return count; }
    };
  }
  async function deleteGeneration(id, generation) {
    const db = await open();
    try { await new Promise((resolve,reject) => {
      const tx=db.transaction(['books','chunks'],'readwrite'),current=tx.objectStore('books').get(checkId(id));
      current.onsuccess=()=>{
        if(current.result?.generation!==generation)tx.objectStore('chunks').delete(generationRange(id,generation));
      };
      tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
    }); } finally { db.close(); }
  }
  async function removeBook(id) {
    checkId(id);
    const db=await open();
    try { return await new Promise((resolve,reject) => {
      const tx=db.transaction(['books','chunks'],'readwrite'),books=tx.objectStore('books'),old=books.get(id);
      old.onsuccess=()=>{
        if(!old.result)return;
        books.delete(id);
        tx.objectStore('chunks').delete(generationRange(id,old.result.generation));
      };
      tx.oncomplete=()=>resolve(Boolean(old.result));
      tx.onabort=tx.onerror=()=>reject(tx.error||new Error('書籍を端末から削除できません'));
    }); } finally { db.close(); }
  }
  async function readBlob(id) {
    const db=await open();
    try{
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction(['books','chunks'],'readonly');
        const req=tx.objectStore('books').get(checkId(id));
        req.onerror=()=>reject(req.error);
        req.onsuccess=()=>{
          const meta=req.result;
          if(!meta){resolve(null);return;}
          if(!Number.isInteger(meta.count)||meta.count<1||meta.count>100000){reject(new Error('書籍の保存情報が不正です'));return;}
          generationBlob(tx.objectStore('chunks'),meta).then(blob=>resolve({blob,meta}),reject);
        };
      }).then(saved=>{if(saved?.meta.registrationRoot)admittedReads.set(saved.blob,id);return saved;});
    }finally{db.close();}
  }
  async function saveBlob(book, blob, onProgress) {
    const writer=await newWriter(book);
    try {
      for(let i=0;i<blob.size;i+=CHUNK){await writer.write(blob.slice(i,Math.min(i+CHUNK,blob.size))); onProgress?.(Math.min(i+CHUNK,blob.size),blob.size);}
      return await writer.commit(blob.size);
    }catch(e){await writer.abort();throw e;}
  }
  async function legacyWh1() {
    // Prior 274-scan reader used a different DB name. Preserve any book already saved there.
    const db=await new Promise((resolve,reject)=>{
      const r=indexedDB.open('wh1-unified-book');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    });
    try {
      if(!db.objectStoreNames.contains('archive'))return null;
      const meta=await storeGet(db,'archive','active-v2');
      if(meta?.type==='chunks-v2'){
        if(!db.objectStoreNames.contains('chunks')||!Number.isInteger(meta.count)||meta.count<1||meta.count>400)throw new Error('従来の書籍保存情報が不正です');
        const chunks=[];let total=0;
        for(let i=0;i<meta.count;i++){
          const b=await storeGet(db,'chunks',`${meta.generation||'book'}:${i}`);
          if(!(b instanceof Blob))throw new Error('従来の保存書籍が一部欠落しています');
          chunks.push(b);total+=b.size;
        }
        if(total!==meta.size)throw new Error('従来の保存書籍のサイズが一致しません');
        return {blob:new Blob(chunks,{type:'application/zip'}),meta:{id:'wh1',title:'世界の歴史1',size:total,legacy:true}};
      }
      const old=await storeGet(db,'archive','full');
      return old?.blob instanceof Blob?{blob:old.blob,meta:{id:'wh1',title:'世界の歴史1',size:old.blob.size,legacy:true}}:null;
    } finally { db.close(); }
  }
  async function hasBook(id) {
    try {
      if(await getMeta(id))return true;
      if(id!=='wh1')return false;
      const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('wh1-unified-book');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
      try {if(!db.objectStoreNames.contains('archive'))return false;
        const m=await storeGet(db,'archive','active-v2');
        if(m?.type==='chunks-v2')return true;
        const old=await storeGet(db,'archive','full');return old?.blob instanceof Blob;
      }finally{db.close();}
    }catch(_){return false;}
  }
  async function findBlob(id) {
    const cached=await readBlob(id);if(cached || id!=='wh1')return cached;
    const legacy=await legacyWh1();if(legacy){await authorizeFile({id},legacy.blob);admittedReads.set(legacy.blob,id);}
    return legacy;
  }
  return {CHUNK,authorizeFile,catalogFilter,savedEditionState,isRegisteredRead:(id,blob)=>admittedReads.get(blob)===id,getMeta,listMeta,newWriter,readBlob,findBlob,legacyWh1,hasBook,removeBook,saveBlob};
})();
