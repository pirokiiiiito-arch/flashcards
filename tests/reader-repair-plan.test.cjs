'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const {plan}=require('../tools/reader-repair-plan.cjs');
const root=path.resolve(__dirname,'..');
const ledger=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/work-ledger.json'),'utf8'));
const ID='salinger-nine-stories-shibata-041-060';
function progress(sha,all=false){
 const pages=[];
 const boundaries=[];
 if(all) {
  for(let scan=41;scan<=60;scan++){
   pages.push({
    scan,sourceImageSha256:'a'.repeat(64),firstTextSha256:'b'.repeat(64),
    secondTextSha256:'c'.repeat(64),firstRunId:'run-first-'+scan,
    secondRunId:'run-other-'+scan,secondSawFirstPass:false,
    comparison:{status:'resolved_against_source',evidenceSha256:'d'.repeat(64),
      sourceImageSha256:'a'.repeat(64),reviewedBy:'independent-test'}
   });
  }
  for(let left=40;left<=60;left++)
   boundaries.push({left,right:left+1,status:'source_verified',
    evidenceSha256:'e'.repeat(64),reviewedBy:'independent-test'});
 }
 return {schema:'reader-repair-progress-v1',bookId:ID,range:[41,60],artifactSha256:sha,
  pages,boundaries};
}
test('current 41-60 first-pass yields a finite page-by-page repair queue, not terminal BLOCK',()=>{
 const r=plan(ledger,ID);
 assert.equal(r.status,'work_ready',r.errors.join(','));
 assert.equal(r.workingDraftIsDistinctFromPublished,true);
 assert.equal(r.originalReaderStillBlocked,true);
 assert.equal(r.counts.scans,20);
 assert.equal(r.counts.sourceImagesPreviouslyReported,20);
 assert.equal(r.counts.layoutConditionsPreviouslyReported,29);
 assert.equal(r.remainingWorkItems,43,'20 independent scans + 21 boundaries + 2 known defects');
 assert.equal(r.nextAction.type,'independently_retranscribe_original_scan');
 assert.equal(r.nextAction.scan,41);
 assert.equal(r.releaseEligible,false);
 assert.equal(r.originalPublishedArtifactSha256,ledger.books.find(x=>x.bookId===ID).artifactSha256);
});
test('one independently documented scan reduces pending scans by exactly one',()=>{
 const first=plan(ledger,ID),e=progress(first.workingDraftSha256);
 e.pages=[{scan:41,sourceImageSha256:'a'.repeat(64),firstTextSha256:'b'.repeat(64),
  secondTextSha256:'c'.repeat(64),firstRunId:'a',secondRunId:'b',secondSawFirstPass:false}];
 const r=plan(ledger,ID,e);
 assert.equal(r.counts.independentPagePassesRecorded,1);
 assert.equal(r.counts.comparedPagesRecorded,0);
 assert.equal(r.tasks.filter(x=>x.type==='independently_retranscribe_original_scan').length,19);
 assert.equal(r.tasks.filter(x=>x.type==='compare_and_resolve_text_differences').length,1);
 assert.equal(r.nextAction.scan,42);
});
test('stale progress for old HTML never advances new private draft',()=>{
 const r=plan(ledger,ID,progress('0'.repeat(64),true));
 assert.ok(r.warnings.includes('STALE_OR_INVALID_PRIVATE_REPAIR_PROGRESS_IGNORED'));
 assert.equal(r.counts.independentPagePassesRecorded,0);
 assert.equal(r.nextAction.scan,41);
});
test('self-reused first OCR attempt cannot pretend to be independent second pass',()=>{
 const draft=plan(ledger,ID);const p=progress(draft.workingDraftSha256,true);
 p.pages[0].secondRunId=p.pages[0].firstRunId;
 let r=plan(ledger,ID,p);
 assert.equal(r.counts.independentPagePassesRecorded,19);
 assert.equal(r.nextAction.scan,41);
 p.pages[0].secondRunId='other';
 p.pages[0].secondSawFirstPass=true;
 r=plan(ledger,ID,p);
 assert.equal(r.counts.independentPagePassesRecorded,19);
});
test('completed page evidence does not silently erase original known OCR defects',()=>{
 const p=plan(ledger,ID);
 const r=plan(ledger,ID,progress(p.workingDraftSha256,true));
 assert.equal(r.counts.independentPagePassesRecorded,20);
 assert.equal(r.counts.comparedPagesRecorded,20);
 assert.equal(r.counts.boundariesRecorded,21);
 assert.equal(r.counts.unresolvedLedgerDefects,2);
 assert.equal(r.remainingWorkItems,2);
 assert.equal(r.nextAction.type,'resolve_known_source_defect');
 assert.equal(r.releaseEligible,false);
});
test('after all recorded tasks and actual known-defect resolution, next is existing sixty-rule gate',()=>{
 const other=structuredClone(ledger),b=other.books.find(x=>x.bookId===ID);
 b.knownDefects.forEach(d=>d.status='resolved');
 const sha=b.pendingDraft.artifactSha256;
 const r=plan(other,ID,progress(sha,true));
 assert.equal(r.remainingWorkItems,1);
 assert.equal(r.nextAction.type,'run_canonical_60_and_handoff_gate');
 assert.equal(r.releaseEligible,false,'planner cannot authorize release');
});
test('wrong book and invalid central ledger never create phantom success',()=>{
 const a=plan(ledger,'invented-book');
 assert.equal(a.status,'blocked');assert.equal(a.releaseEligible,false);
 assert.ok(a.errors.includes('BOOK_NOT_REGISTERED'));
 const b=structuredClone(ledger);b.ruleset='invented-61';
 assert.ok(plan(b,ID).errors.includes('INVALID_SHARED_WORK_LEDGER'));
});
test('progress with a wrong profile/record cannot promote old published artifact',()=>{
 const l=structuredClone(ledger);
 const b=l.books.find(x=>x.bookId===ID);b.pendingDraft.artifactSha256=b.artifactSha256;
 const r=plan(l,ID);
 assert.ok(r.errors.includes('INVALID_PENDING_DRAFT_IDENTITY'));
 assert.equal(r.releaseEligible,false);
});
