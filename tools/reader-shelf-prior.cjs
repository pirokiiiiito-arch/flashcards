'use strict';
// Reverse precisely the approved registration edits before all earlier historical layout checks.
const crypto=require('node:crypto');
const changes={
  "f6ffac1ed438959e7a5c55d9916432e3f213a0e2": [
    "c42490874b5e54dea08a524655d4f5632005e71d",
    [
      [
        " const present=await LibraryDB.getMeta(BOOK_ID);\n const admission=await LibraryDB.authorizeFile({id:BOOK_ID},blob);\n if(!force&&present?.registrationRoot===admission.chunkRoot)return {already:true};\n await LibraryDB.saveBlob({id:BOOK_ID,title:bookTitle,scans:totalScans},blob,(saved,total)=>{\n",
        " const present=await LibraryDB.getMeta(BOOK_ID);\n if(!force&&present?.size===blob.size)return {already:true};\n await LibraryDB.saveBlob({id:BOOK_ID,title:bookTitle,scans:totalScans},blob,(saved,total)=>{\n"
      ],
      [
        "   const trustedSha='f018635c4ad2c624c99250b66e19b84e597da1c48e5659f60f6ac9abc5bb34e3';\n   const inherited=m.bookId==='nine-stories'&&m.sha256===trustedSha;\n   if(m.schema!==1||!/^[A-Za-z0-9_-]{1,90}$/.test(m.bookId)||m.entry!=='reader.html'||!/^[a-f0-9]{64}$/.test(m.sha256)||(!shouldSave&&BOOK_ID!==m.bookId))\n    throw Error('本棚に登録した統合確認版と一致しません');\n   if(shouldSave || (!inherited && !LibraryDB.isRegisteredRead(m.bookId,file)))await LibraryDB.authorizeFile({id:m.bookId},file);\n   const bytes=await book.readBytes(m.entry);\n   const hash=await crypto.subtle.digest('SHA-256',bytes);\n   if(Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('')!==m.sha256)\n    throw Error('統合確認版の本文ファイルが一致しません');\n   if(shouldSave){\n    await LibraryDB.saveBlob({id:m.bookId,title:m.title||m.bookId,subtitle:m.edition||'',scans:m.range?.[1]||m.totalScans||null},file);\n    location.replace('./read.html?id='+encodeURIComponent(m.bookId));\n",
        "   const trustedSha='f018635c4ad2c624c99250b66e19b84e597da1c48e5659f60f6ac9abc5bb34e3';\n   if(m.schema!==1||m.bookId!=='nine-stories'||m.entry!=='reader.html'||m.sha256!==trustedSha||(!shouldSave&&BOOK_ID!==m.bookId))\n    throw Error('本棚に登録した統合確認版と一致しません');\n   const bytes=await book.readBytes(m.entry);\n   const hash=await crypto.subtle.digest('SHA-256',bytes);\n   if(Array.from(new Uint8Array(hash),v=>v.toString(16).padStart(2,'0')).join('')!==trustedSha)\n    throw Error('統合確認版の本文ファイルが一致しません');\n   if(shouldSave){\n    await LibraryDB.saveBlob({id:m.bookId,title:'ナイン・ストーリーズ',subtitle:'全286枚・統合確認版',scans:286},file);\n    location.replace('./read.html?id='+encodeURIComponent(m.bookId));\n"
      ],
      [
        "  if(replacement){location.replace(replacement);return;}\n  if(shouldSave)await LibraryDB.authorizeFile({id:BOOK_ID},file);\n  fillManifest(m);bookZip=book;\n",
        "  if(replacement){location.replace(replacement);return;}\n  fillManifest(m);bookZip=book;\n"
      ]
    ]
  ],
  "1e931004f0a0619cc2940287181fceb8daf5d054": [
    "4ef3d87b7ff68e1241cc233c49c56d305026cc3a",
    [
      [
        "}\nasync function approveBookshelfArchive(blob){\n const rules=await import('../../library/shelf-registration.mjs');\n return rules.admitBlob({id:'wh1'},blob,await rules.ledger());\n}\nasync function dbSave(blob,{force=false}={}){\n const admission=await approveBookshelfArchive(blob);\n const db=await dbOpen();try{\n  const oldMeta=await idbGet(db,'archive','active-v2');\n  if(!force && oldMeta?.registrationRoot===admission.chunkRoot)\n   return {already:true};\n",
        "}\nasync function dbSave(blob,{force=false}={}){\n const db=await dbOpen();try{\n  const oldMeta=await idbGet(db,'archive','active-v2');\n  const oldLegacy=oldMeta?null:await idbGet(db,'archive','full');\n  if(!force && ((oldMeta?.size===blob.size)||(oldLegacy?.blob?.size===blob.size)))\n   return {already:true};\n"
      ],
      [
        "  }\n  const meta={type:'chunks-v2',registrationRoot:admission.chunkRoot,size:blob.size,count:chunks,generation,name:blob.name||'世界の歴史1.zip',saved:Date.now()};\n  await idbPut(db,'archive','active-v2',meta);\n",
        "  }\n  const meta={type:'chunks-v2',size:blob.size,count:chunks,generation,name:blob.name||'世界の歴史1.zip',saved:Date.now()};\n  await idbPut(db,'archive','active-v2',meta);\n"
      ],
      [
        " try{\n  if(shouldSave)await approveBookshelfArchive(file);\n  const book=await new ZipBook(file).index();const m=JSON.parse(await book.readText('manifest.json'));\n",
        " try{\n  const book=await new ZipBook(file).index();const m=JSON.parse(await book.readText('manifest.json'));\n"
      ]
    ]
  ],
  "c31e371e6e0bc1f40c455912d48724b6d2068089": [
    "9274b6a98bd4280c2bcec8968d87bd538a7b7309",
    [
      [
        "async function dbRead(){const db=await dbOpen();try{return await new Promise((resolve,reject)=>{const r=db.transaction('archive','readonly').objectStore('archive').get('full');r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}finally{db.close();}}\nasync function approveBookshelfArchive(blob){\n const rules=await import('../../library/shelf-registration.mjs');\n return rules.admitBlob({id:'wh1'},blob,await rules.ledger());\n}\nasync function dbSave(blob){await approveBookshelfArchive(blob);const db=await dbOpen();try{return await new Promise((resolve,reject)=>{const tr=db.transaction('archive','readwrite');tr.objectStore('archive').put({blob,name:blob.name||'世界の歴史1.zip',saved:Date.now()},'full');tr.oncomplete=resolve;tr.onerror=()=>reject(tr.error);tr.onabort=()=>reject(tr.error);});}finally{db.close();}}\nasync function loadBook(file,shouldSave=true){\n",
        "async function dbRead(){const db=await dbOpen();try{return await new Promise((resolve,reject)=>{const r=db.transaction('archive','readonly').objectStore('archive').get('full');r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}finally{db.close();}}\nasync function dbSave(blob){const db=await dbOpen();try{return await new Promise((resolve,reject)=>{const tr=db.transaction('archive','readwrite');tr.objectStore('archive').put({blob,name:blob.name||'世界の歴史1.zip',saved:Date.now()},'full');tr.oncomplete=resolve;tr.onerror=()=>reject(tr.error);tr.onabort=()=>reject(tr.error);});}finally{db.close();}}\nasync function loadBook(file,shouldSave=true){\n"
      ],
      [
        " try{\n  if(shouldSave)await approveBookshelfArchive(file);\n  const book=await new ZipBook(file).index();const m=JSON.parse(await book.readText('manifest.json'));\n",
        " try{\n  const book=await new ZipBook(file).index();const m=JSON.parse(await book.readText('manifest.json'));\n"
      ]
    ]
  ],
  "4e83af9c9caf975ceb28a18f5201bd26ef500ada": [
    "c6ece4949b885c81bfa4374e19f049b23825e6e0",
    [
      [
        "  try{\n   if(shouldSave)await LibraryDB.authorizeFile({id:BOOK_ID},blob);\n   const candidate=await new ZipReader(blob).init(),m=JSON.parse(await candidate.readText('manifest.json'));\n",
        "  try{\n   const candidate=await new ZipReader(blob).init(),m=JSON.parse(await candidate.readText('manifest.json'));\n"
      ]
    ]
  ]
};
const gitBlob=b=>crypto.createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
module.exports=function priorShelfShell(bytes){
 const delta=changes[gitBlob(bytes)];if(!delta)return bytes;
 let s=bytes.toString('utf8');for(const [from,to] of delta[1]){if(s.split(from).length!==2)throw Error('SHELF_REVISION_ANCHOR');s=s.replace(from,()=>to);}
 const previous=Buffer.from(s);if(gitBlob(previous)!==delta[0])throw Error('SHELF_REVISION_MISMATCH');return previous;
};
