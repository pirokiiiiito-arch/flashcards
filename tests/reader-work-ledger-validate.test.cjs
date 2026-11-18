'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {validate}=require('../tools/reader-work-ledger-validate.cjs');
const ledger=JSON.parse(fs.readFileSync(path.join(__dirname,'../reader/quality/work-ledger.json')));
test('central cross-chat ledger contains current unverified 21–60 versions and no OCR',()=>{
 const r=validate(ledger);assert.deepEqual(r.errors,[]);
 assert.equal(r.qualityIDsPreserved,true);
 assert.equal(r.metadataOnly,true);
 assert.equal(r.entries,2);
});
test('known bad OCR cannot be promoted to completed by status-only ledger edits',()=>{
 const l=structuredClone(ledger),b=l.books.find(x=>x.range[0]===41);
 assert.ok(b);assert.equal(b.qualityState,'unverified');assert.equal(b.releaseStatus,'blocked');
 assert.ok(b.knownDefects.some(x=>x.status==='needs_source_review'));
 b.releaseStatus='candidate';
 const r=validate(l);
 assert.ok(r.errors.some(s=>s.startsWith('UNREVIEWED_RELEASE_CANDIDATE')));
 assert.ok(r.errors.some(s=>s.startsWith('UNRESOLVED_DEFECT_IN_CANDIDATE')));
});
test('new source bytes and OCR may not be inserted into public management ledger',()=>{
 const l=structuredClone(ledger),b=l.books[0];b.reading_text='PRIVATE_SYNTHETIC_BOOK_TEXT';
 assert.ok(validate(l).errors.includes('PRIVATE_BOOK_FIELDS_IN_PUBLIC_LEDGER'));
});
test('duplicate records for same book and range are blocked',()=>{
 const l=structuredClone(ledger);l.books.push({...l.books[0]});
 assert.ok(validate(l).errors.includes('DUPLICATED_BOOK_RANGE'));
});
test('a non-canonical ruleset cannot replace the sixty-rule identity',()=>{
 const l=structuredClone(ledger);l.ruleset='custom-61';
 assert.ok(validate(l).errors.includes('INVALID_CENTRAL_LEDGER_SCHEMA'));
});

test('new first-pass checkpoint is recorded but does not supersede old published preview',()=>{
 const b=ledger.books.find(x=>x.range[0]===41);
 assert.ok(b?.pendingDraft);
 assert.notEqual(b.artifactSha256,b.pendingDraft.artifactSha256);
 assert.equal(b.qualityState,'unverified');
 assert.equal(b.releaseStatus,'blocked');
 assert.equal(b.pendingDraft.deliveryStatus,'private_staging_blocked');
 assert.equal(b.pendingDraft.independentSecondPass,'not_run');
 assert.equal(validate(ledger).errors.length,0);
});
test('a first-pass checkpoint cannot be promoted by changing its status alone',()=>{
 const l=structuredClone(ledger),b=l.books.find(x=>x.range[0]===41);
 b.releaseStatus='candidate';b.qualityState='reviewed';
 const r=validate(l);
 assert.ok(r.errors.some(e=>e.startsWith('PENDING_DRAFT_NOT_QUALIFIED_OR_MISTAKEN_FOR_RELEASE')));
});
test('staged draft cannot reuse the existing published SHA',()=>{
 const l=structuredClone(ledger),b=l.books.find(x=>x.range[0]===41);
 b.pendingDraft.artifactSha256=b.artifactSha256;
 assert.ok(validate(l).errors.some(e=>e.startsWith('PENDING_DRAFT_NOT_QUALIFIED_OR_MISTAKEN_FOR_RELEASE')));
});
