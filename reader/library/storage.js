/* Private Bookshelf: user book bytes are stored only on this device. */
'use strict';
const LibraryDB = (() => {
  const DB = 'private-bookshelf-v1';
  const VERSION = 1;
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
  async function newWriter(book) {
    checkId(book.id);
    const db = await open();
    const generation = `g${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let count = 0, total = 0, active = true;
    return {
      async write(blob) {
        if (!active) throw new Error('保存処理は終了しています');
        if (!(blob instanceof Blob) || blob.size < 1 || blob.size > CHUNK) throw new Error('チャンクのサイズが不正です');
        await storePut(db, 'chunks', chunkKey(book.id, generation, count), blob);
        count++; total += blob.size;
      },
      async commit(expectedSize = null) {
        if (!active) throw new Error('保存処理は終了しています');
        if (!count || (expectedSize != null && total !== expectedSize)) throw new Error('書籍の保存サイズが一致しません');
        const meta = {id:book.id, title:String(book.title||book.id), subtitle:String(book.subtitle||''), scans:Number(book.scans)||null,
          generation, count, size:total, date:Date.now(), format:'unified-zip-v1'};
        await storePut(db, 'books', book.id, meta);
        active = false; db.close(); return meta;
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
      const tx=db.transaction('chunks','readwrite');
      const prefix = `${checkId(id)}|${generation}|`;
      const range = IDBKeyRange.bound(prefix, prefix+'\uffff');
      const req = tx.objectStore('chunks').openKeyCursor(range);
      req.onsuccess=()=>{ const c=req.result; if(c){ c.delete(); c.continue(); } };
      tx.oncomplete=()=>resolve(); tx.onerror=()=>reject(tx.error); tx.onabort=()=>reject(tx.error);
    }); } finally { db.close(); }
  }
  async function removeBook(id) {
    checkId(id);
    const old = await getMeta(id); if (!old) return false;
    const db=await open(); try { await new Promise((resolve,reject) => {
      const tx=db.transaction('books','readwrite'); tx.objectStore('books').delete(id);
      tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    }); } finally { db.close(); }
    await deleteGeneration(id, old.generation); return true;
  }
  async function readBlob(id) {
    const meta = await getMeta(checkId(id)); if (!meta) return null;
    if (!Number.isInteger(meta.count) || meta.count < 1 || meta.count > 100000) throw new Error('書籍の保存情報が不正です');
    const db = await open(); try {
      const pieces = []; let total = 0;
      for (let i=0; i<meta.count; i++) {
        const b = await storeGet(db, 'chunks', chunkKey(id, meta.generation, i));
        if (!(b instanceof Blob)) throw new Error('端末に保存した書籍が一部欠落しています');
        pieces.push(b); total+=b.size;
      }
      if(total!==meta.size)throw new Error('書籍の保存サイズが一致しません');
      return {blob:new Blob(pieces,{type:'application/zip'}),meta};
    } finally { db.close(); }
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
  async function findBlob(id) { const cached=await readBlob(id);return cached || (id==='wh1'?await legacyWh1():null); }
  return {CHUNK,getMeta,listMeta,newWriter,readBlob,findBlob,legacyWh1,hasBook,removeBook,saveBlob};
})();
