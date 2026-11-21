'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const dir = path.join(__dirname, '../reader');
const registration = import('../reader/library/shelf-registration.mjs');
const hash = buf => crypto.createHash('sha256').update(buf).digest();
const baseline = () => JSON.parse(fs.readFileSync(path.join(dir,'quality/shelf-registration.json')));

test('new preview, replacement, manual import and discovered files need an independently admitted edition', async () => {
  const r = await registration;
  const bytes = Buffer.alloc(r.BLOCK + 9, 76);
  const book = {id:'fixture',title:'sample',subtitle:'版1',status:'確認版',scans:2,totalBytes:bytes.length,parts:[{id:'testOnlyPrivatePart',size:bytes.length}]};
  const key = await r.textHash(book.id);
  const record = {key,entry:await r.textHash(r.entryIdentity(book)),bytes:bytes.length,chunkRoot:hash(Buffer.concat([hash(bytes.subarray(0,r.BLOCK)),hash(bytes.subarray(r.BLOCK))])).toString('hex')};
  const active = new Map([[key,[record]]]);
  assert.equal(await r.admitEntry(book, active), record);
  assert.equal(await r.admitBlob(book, new Blob([bytes]), active), record);
  assert.equal(await r.admitBlob({id:book.id},new Blob([bytes]),active),record);
  assert.equal(await r.admitEntry({...book,id:'new',passed:true},active),null);
  assert.equal(await r.admitEntry({...book,parts:[{id:'unreviewedOtherPart',size:bytes.length}]},active),null);
  bytes[bytes.length-1] ^= 1;
  await assert.rejects(r.admitBlob(book,new Blob([bytes]),active));
  await assert.rejects(r.admitBlob({id:'new',status:'確認版',verified:true},new Blob([bytes]),active));
});

test('signed output covers the report, the actual archive, all batches and every TOC landing',async()=>{
  const r=await registration, db=baseline();
  await r.parseLedger(db);
  const extra=structuredClone(db);extra.existing.push(extra.existing[0]);await assert.rejects(r.parseLedger(extra));
  const dig='a'.repeat(64),measure=['text',1,1,2,8,-10,1,0,1,-1];
  const rec={key:dig,entry:dig,bytes:256,chunkRoot:dig,sha256:dig,channel:'preview',evidence:{version:1,archive:dig,source:dig,host:dig,report:dig,first:1,last:20,modes:['text'],batches:[[1,20,[measure]]],toc:{kind:'source-absent',rows:0,landed:0,reference:dig,results:dig}}};
  r.validateEvidence(rec);
  await assert.rejects(r.parseLedger({...db,pending:[rec]}));
  await assert.rejects(r.parseLedger({...db,pending:[{...rec,signature:Buffer.alloc(64).toString('base64')}]}));
  for(const change of [a=>a.evidence.last++,a=>a.evidence.toc.rows++,a=>a.evidence.batches[0][2][0][3]=1,a=>a.evidence.batches[0][2][0][8]=2,a=>a.evidence.archive='b'.repeat(64)]){
    const invalid=structuredClone(rec);change(invalid);assert.throws(()=>r.validateEvidence(invalid));
  }
  for(const signed of db.editions){const altered=structuredClone(signed);altered.bytes++;await assert.rejects(r.parseLedger({...db,editions:[altered]}));}
});
