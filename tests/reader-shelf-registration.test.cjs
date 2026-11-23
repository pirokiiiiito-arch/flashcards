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
  rec.evidence.pageTurns={version:1,report:dig,boundaries:[],sectionCount:1,sections:[]};
  r.validateEvidence(rec);
  await assert.rejects(r.parseLedger({...db,pending:[rec]}));
  await assert.rejects(r.parseLedger({...db,pending:[{...rec,signature:Buffer.alloc(64).toString('base64')}]}));
  for(const change of [a=>a.evidence.last++,a=>a.evidence.toc.rows++,a=>a.evidence.batches[0][2][0][3]=1,a=>a.evidence.batches[0][2][0][8]=2,a=>a.evidence.archive='b'.repeat(64)]){
    const invalid=structuredClone(rec);change(invalid);assert.throws(()=>r.validateEvidence(invalid));
  }
  for(const signed of db.editions){const altered=structuredClone(signed);altered.bytes++;await assert.rejects(r.parseLedger({...db,editions:[altered]}));}
});

test('registration needs measured turns for every source boundary and every displayed section', async () => {
  const r = await registration;
  const old = baseline().editions.find(record => !record.evidence.pageTurns);
  if (old) r.validateEvidence(old);
  const dig = '3'.repeat(64);
  const batch = (lo,hi) => [lo,hi,[['text',lo,1,2,8,-10,1,0,1,-1]]];
  const record = {key:dig,entry:dig,bytes:256,chunkRoot:dig,sha256:dig,channel:'preview',evidence:{
    version:1,archive:dig,source:dig,host:dig,report:dig,first:1,last:21,modes:['text'],
    batches:[batch(1,20),batch(21,21)],toc:{kind:'source-absent',rows:0,landed:0,reference:dig,results:dig}
  }};
  assert.throws(() => r.validateEvidence(record));
  record.evidence.pageTurns={version:1,report:dig,boundaries:[[20,21,'shared-page']],sectionCount:2,sections:[[0,1]]};
  r.validateEvidence(record);
  for(const edit of [
    t => {t.boundaries=[];}, t => {t.boundaries[0][0]=19;}, t => {t.sections=[];},
    t => {t.sections=[[1,2]];}, t => {t.report='unchecked';}
  ]) {
    const invalid=structuredClone(record);edit(invalid.evidence.pageTurns);
    assert.throws(() => r.validateEvidence(invalid));
  }
});


test('source proofreading totals correspond to the 20-scan intervals on the signed edition', async () => {
  const r=await registration;
  const record=structuredClone(baseline().editions.at(-1)), {first,last}=record.evidence;
  const keys=['body','heading','caption','note','ruby','figure','toc','other'];
  const batches=[];
  for(let i=first;i<=last;i+=20)batches.push([i,Math.min(i+19,last),1]);
  record.evidence.sourceProof={version:1,report:'d'.repeat(64),status:'partial',pendingScans:batches.length,batches,
    scopeBatches:batches.map(()=>({pending:Object.fromEntries(keys.map(k=>[k,1])),matchedRegions:0}))};
  r.validateEvidence(record);
  const alternate=structuredClone(record);alternate.evidence.sourceProof.report='c'.repeat(64);
  assert.notEqual(r.signingText(alternate),r.signingText(record));
  for(const change of [x=>x.channel='release',x=>x.evidence.sourceProof.pendingScans++,
    x=>x.evidence.sourceProof.batches[0][0]++,x=>delete x.evidence.sourceProof.scopeBatches[0].pending.ruby,
    x=>x.evidence.sourceProof.scopeBatches[0].pending.caption=2]){
    const altered=structuredClone(record);change(altered);assert.throws(()=>r.validateEvidence(altered));
  }
});
