/* Private cover images for the bookshelf. No book image is served from GitHub.
   Cover files are read from a user's authenticated Drive or stored book ZIP,
   then cached in this browser for offline display. */
'use strict';
const BookCovers = (() => {
  const DB_NAME = 'private-bookshelf-cover-cache-v1';
  const STORE = 'covers';
  const ID_RE = /^[A-Za-z0-9_-]{1,90}$/;
  const readyUrls = new Map();
  const pending = new Map();
  const callbacks = new WeakMap();
  const observer = typeof IntersectionObserver === 'function' ?
    new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const action = callbacks.get(entry.target);
        callbacks.delete(entry.target);
        if (action) action();
      }
    }, {rootMargin: '350px 0px'}) : null;

  async function openDB() {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE);
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || Error('表紙キャッシュを開けません'));
    });
  }
  async function getCached(id) {
    if (!ID_RE.test(id)) return null;
    const db = await openDB();
    try {
      return await new Promise((resolve, reject) => {
        const req = db.transaction(STORE,'readonly').objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result instanceof Blob ? req.result : null);
        req.onerror = () => reject(req.error);
      });
    } finally { db.close(); }
  }
  async function cache(id, imageBlob) {
    if (!ID_RE.test(id)) return;
    const db = await openDB();
    try {
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE,'readwrite');
        tx.objectStore(STORE).put(imageBlob,id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } finally { db.close(); }
  }
  async function validImage(blob) {
    if (!(blob instanceof Blob) || blob.size < 128 || blob.size > 15000000) return false;
    const b = new Uint8Array(await blob.slice(0,16).arrayBuffer());
    return (b[0]===255 && b[1]===216 && b[2]===255) ||
      (b[0]===137 && b[1]===80 && b[2]===78 && b[3]===71) ||
      (b[0]===82 && b[1]===73 && b[2]===70 && b[3]===70 &&
       b[8]===87 && b[9]===69 && b[10]===66 && b[11]===80);
  }
  // Only slices out an existing, uncompressed image. It does not rewrite
  // or recompress any of the original scanned JPEG bytes.
  async function fromZip(blob) {
    if (!(blob instanceof Blob) || blob.size < 40) return null;
    const tailStart = Math.max(0,blob.size-70000);
    const tail = new DataView(await blob.slice(tailStart).arrayBuffer());
    let end = -1;
    for (let i = tail.byteLength-22; i>=0; i--) {
      if (tail.getUint32(i,true)===0x06054b50) {end=i;break;}
    }
    if (end < 0) return null;
    const count = tail.getUint16(end+10,true);
    const centralSize = tail.getUint32(end+12,true);
    const centralAt = tail.getUint32(end+16,true);
    if (count>1500 || centralSize>750000 || centralAt+centralSize>blob.size) return null;
    const dir = new DataView(await blob.slice(centralAt,centralAt+centralSize).arrayBuffer());
    const decoder = new TextDecoder();
    let p=0, candidate=null;
    for (let i=0; i<count; i++) {
      if (p+46>dir.byteLength || dir.getUint32(p,true)!==0x02014b50) break;
      const method=dir.getUint16(p+10,true),size=dir.getUint32(p+20,true);
      const nameBytes=dir.getUint16(p+28,true),extra=dir.getUint16(p+30,true),comment=dir.getUint16(p+32,true);
      const start=dir.getUint32(p+42,true);
      if (p+46+nameBytes+extra+comment>dir.byteLength) break;
      const name=decoder.decode(new Uint8Array(dir.buffer,dir.byteOffset+p+46,nameBytes));
      if (/^(originals\/0001\.(jpg|jpeg|png|webp)|cover\.(jpg|jpeg|png|webp))$/i.test(name) &&
          method===0 && size>128 && size<15000000 && start+30<blob.size) {
        candidate={name,size,start};break;
      }
      p+=46+nameBytes+extra+comment;
    }
    if (!candidate) return null;
    const head=new DataView(await blob.slice(candidate.start,candidate.start+30).arrayBuffer());
    if (head.byteLength<30 || head.getUint32(0,true)!==0x04034b50) return null;
    const dataAt=candidate.start+30+head.getUint16(26,true)+head.getUint16(28,true);
    if (dataAt+candidate.size>blob.size) return null;
    const ext=candidate.name.split('.').pop().toLowerCase();
    const mime=ext==='png'?'image/png':ext==='webp'?'image/webp':'image/jpeg';
    const image=blob.slice(dataAt,dataAt+candidate.size,mime);
    return await validImage(image)?image:null;
  }
  async function fromLocal(book) {
    if (typeof LibraryDB === 'undefined' || typeof LibraryDB.findBlob !== 'function') return null;
    const saved = await LibraryDB.findBlob(book.id);
    return saved?.blob?fromZip(saved.blob):null;
  }
  async function resolve(book, remoteDownload) {
    const id = book.id;
    if (readyUrls.has(id)) return readyUrls.get(id);
    if (pending.has(id)) return pending.get(id);
    const task = (async() => {
      let image = null;
      try {image = await getCached(id);} catch(_) {}
      if (!image && book.coverFileId && remoteDownload) {
        try {
          const b=await remoteDownload(book.coverFileId);
          if (await validImage(b)) image=b;
        } catch(e) { console.warn('表紙のDrive取得に失敗しました',e?.message||e); }
      }
      if (!image) {
        try {image = await fromLocal(book);} catch(e) {console.warn('保存済み表紙を確認できません',e?.message||e);}
      }
      if (!image || !await validImage(image)) return null;
      const url = URL.createObjectURL(image);
      readyUrls.set(id,url);
      if (image) cache(id,image).catch(()=>{});
      return url;
    })();
    pending.set(id,task);
    try {return await task;} finally {pending.delete(id);}
  }
  function attach(imageElement, book, remoteDownload=null) {
    if (!(imageElement instanceof HTMLImageElement) || !ID_RE.test(book?.id||'')) return;
    const run = () => resolve(book,remoteDownload).then(url => {
      if (!url || !imageElement.isConnected) return;
      imageElement.src=url;
      imageElement.hidden=false;
    }).catch(()=>{});
    if (observer) { const surface=imageElement.parentElement||imageElement; callbacks.set(surface,run); observer.observe(surface); }
    else run();
  }
  async function forget(id) {
    const url=readyUrls.get(id);
    if (url) {URL.revokeObjectURL(url);readyUrls.delete(id);}
    if(!ID_RE.test(id))return;
    const db=await openDB();
    try {await new Promise((res,rej)=>{
      const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).delete(id);
      tx.oncomplete=res;tx.onerror=()=>rej(tx.error);tx.onabort=()=>rej(tx.error);
    });}finally{db.close();}
  }
  window.addEventListener('pagehide',()=>{
    for (const url of readyUrls.values()) URL.revokeObjectURL(url);
    readyUrls.clear();
  });
  return {attach,forget,fromZip,getCached,resolve};
})();
window.BookCovers = BookCovers;
