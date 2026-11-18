'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const source=require('../reader/quality/work-ledger.json');
const {plan}=require('../tools/reader-repair-plan.cjs');
const {STAGES,validatePendingDraft,advance,startDraft,reviseDraft}=require('../tools/reader-repair-state.cjs');
const {transition}=require('../tools/reader-repair-transition.cjs');
const {validate}=require('../tools/reader-work-ledger-validate.cjs');
const SH='a'.repeat(64),PUB='b'.repeat(64),NEW='c'.repeat(64),EV='d'.repeat(64);
const REVIEW_AT='2026-11-19T03:30:00+09:00';
function fixture(profile='image'){
 const ledger=structuredClone(source);
 const bookId='synthetic-state-'+profile.replace(/_/g,'-');
 const book={bookId,range:[1,1],profile,sourceArchiveSha256:SH,artifactSha256:PUB,
  qualityState:'unverified',releaseStatus:'blocked',knownDefects:[],
  pendingDraft:{artifactSha256:NEW,reviewStatus:'visual_first_pass_only',
    deliveryStatus:'private_staging_blocked',independentSecondPass:'not_run',
    realIPhone:'not_run',privateProgressReportSha256:EV,
    sourceJPEGSHAverified:1,chromiumLayoutChecksPassed:0}};
 ledger.books.push(book);
 return{ledger,book,bookId};
}
function progress(bookId='synthetic-state-image',{kind='photo',verified=true,compared=true}={}){
 const page={scan:1,sourceImageSha256:SH,
  inventory:{status:'source_verified',sourceImageSha256:SH,evidenceSha256:EV,
   reviewedBy:'synthetic-reviewer',width:100,height:100,hasReadableText:kind!=='photo',
   allRegionsInventoried:true},
  regions:[{id:kind+'-1',kind,box:[0,0,100,100],sourceImageSha256:SH}],
  profileChecks:{}};
 const reg=page.regions[0];
 if(kind==='photo'){
  if(verified)reg.imageReview={status:'source_verified',sourceImageSha256:SH,
   originalBytesSha256:SH,evidenceSha256:EV,reviewedBy:'synthetic-reviewer'};
 }else{
  if(verified)reg.transcription={firstRunId:'one',secondRunId:'two',secondSawFirstPass:false,
   firstTextSha256:EV,secondTextSha256:SH,sourceImageSha256:SH};
  if(compared)reg.comparison={status:'resolved_against_source',
   evidenceSha256:EV,sourceImageSha256:SH,reviewedBy:'synthetic-reviewer'};
 }
 return{schema:'reader-repair-progress-v2',bookId,range:[1,1],
  profile:kind==='photo'?'image':'text',artifactSha256:NEW,pages:[page],
  boundaries:[
    {left:0,right:1,status:'source_verified',evidenceSha256:EV,
     reviewedBy:'synthetic-reviewer',leftSourceSha256:SH,rightSourceSha256:SH},
    {left:1,right:2,status:'source_verified',evidenceSha256:EV,
     reviewedBy:'synthetic-reviewer',leftSourceSha256:SH,rightSourceSha256:SH}
  ],bridges:[]};
}
test('current first-pass metadata remains valid and canonical sixty count is unchanged',()=>{
 const b=source.books.find(x=>x.pendingDraft);
 assert.deepEqual(validatePendingDraft(b),[]);
 assert.equal(validate(source).qualityIDsPreserved,true);
 assert.deepEqual(STAGES,['visual_first_pass_only','second_pass_in_progress','second_pass_completed','source_resolved','awaiting_canonical_60']);
});
test('image-only book progresses through four legal states, never awarding release',()=>{
 let {ledger,bookId}=fixture(),p=progress(bookId);
 for(const to of STAGES.slice(1)){
  const result=plan(ledger,bookId,p);
  const x=advance(ledger,bookId,result,'f'.repeat(64),to,REVIEW_AT);
  assert.equal(x.ok,true,JSON.stringify(x.errors));
  ledger=x.ledger;
  const b=ledger.books.find(y=>y.bookId===bookId);
  assert.equal(b.pendingDraft.reviewStatus,to);
  assert.equal(b.releaseStatus,'blocked');
  assert.equal(b.qualityState,'unverified');
  assert.deepEqual(validatePendingDraft(b),[]);
  assert.deepEqual(validate(ledger).errors,[]);
 }
 const book=ledger.books.find(x=>x.bookId===bookId);
 assert.equal(book.pendingDraft.independentSecondPass,'not_applicable_source_verified');
 assert.equal(book.pendingDraft.realIPhone,'not_run');
 assert.equal(book.artifactSha256,PUB);
 assert.equal(book.pendingDraft.deliveryStatus,'private_staging_blocked');
 assert.equal(ledger.version,source.version+4);
});
test('unreviewed image cannot advance to completed second pass',()=>{
 const {ledger,bookId}=fixture();const p=progress(bookId,{verified:false});
 const result=plan(ledger,bookId,p);
 const r=advance(ledger,bookId,result,EV,'second_pass_in_progress',REVIEW_AT);
 assert.equal(r.ok,false);
 assert.ok(r.errors.includes('NO_INDEPENDENT_CHECKS_RECORDED'));
});
test('independent text pass finishes before source comparison; unresolved differences block source_resolved',()=>{
 const {ledger,bookId}=fixture('text'),p=progress(bookId,{kind:'body',compared:false});
 const result=plan(ledger,bookId,p);
 assert.equal(result.counts.independentTextRegionsRecorded,1);
 assert.equal(result.counts.comparedTextRegionsRecorded,0);
 const one=advance(ledger,bookId,result,EV,'second_pass_in_progress',REVIEW_AT);
 assert.equal(one.ok,true,one.errors.join(','));
 const two=advance(one.ledger,bookId,plan(one.ledger,bookId,p),EV,'second_pass_completed',REVIEW_AT);
 assert.equal(two.ok,true,two.errors.join(','));
 const three=advance(two.ledger,bookId,plan(two.ledger,bookId,p),EV,'source_resolved',REVIEW_AT);
 assert.equal(three.ok,false);
 assert.ok(three.errors.includes('SOURCE_DIFFS_BOUNDARIES_OR_DEFECTS_UNRESOLVED'));
 p.pages[0].regions[0].comparison={status:'resolved_against_source',
  evidenceSha256:EV,sourceImageSha256:SH,reviewedBy:'synthetic-reviewer'};
 const done=advance(two.ledger,bookId,plan(two.ledger,bookId,p),EV,'source_resolved',REVIEW_AT);
 assert.equal(done.ok,true,done.errors.join(','));
});
test('states cannot be skipped, unproven, or regress counts',()=>{
 const {ledger,bookId}=fixture(),p=progress(bookId);
 const r=plan(ledger,bookId,p);
 const skip=advance(ledger,bookId,r,EV,'source_resolved',REVIEW_AT);
 assert.equal(skip.ok,false);assert.ok(skip.errors.includes('ILLEGAL_OR_SKIPPED_REPAIR_TRANSITION'));
 let x=advance(ledger,bookId,r,EV,'second_pass_in_progress',REVIEW_AT);
 assert.equal(x.ok,true);
 const old=x.ledger.books.find(y=>y.bookId===bookId);
 old.pendingDraft.progressSummary.imageChecks=2;
 x=advance(x.ledger,bookId,plan(x.ledger,bookId,p),EV,'second_pass_completed',REVIEW_AT);
 assert.equal(x.ok,false);
 assert.ok(x.errors.includes('PROGRESS_COUNTS_CANNOT_REGRESS_FOR_SAME_SHA'));
});
test('progress for wrong profile/artifact cannot advance any stage',()=>{
 const {ledger,bookId}=fixture();
 let p=progress(bookId);p.profile='novel';
 assert.equal(plan(ledger,bookId,p).status,'blocked');
 assert.equal(advance(ledger,bookId,plan(ledger,bookId,p),EV,'second_pass_in_progress',REVIEW_AT).ok,false);
 p=progress(bookId);p.artifactSha256=PUB;
 assert.equal(plan(ledger,bookId,p).status,'blocked');
});
test('new canonical HTML SHA resets proof safely while retaining previous draft history',()=>{
 let {ledger,bookId}=fixture();
 const older=ledger.books.find(x=>x.bookId===bookId);
 older.pendingDraft.reviewStatus='second_pass_in_progress';
 older.pendingDraft.independentSecondPass='in_progress';
 older.pendingDraft.latestPrivateRepairProgressSha256=EV;
 const changed=reviseDraft(ledger,bookId,NEW,'e'.repeat(64),'f'.repeat(64),REVIEW_AT);
 assert.equal(changed.ok,true,changed.errors.join(','));
 const b=changed.ledger.books.find(x=>x.bookId===bookId);
 assert.equal(b.artifactSha256,PUB);
 assert.equal(b.pendingDraft.reviewStatus,'visual_first_pass_only');
 assert.equal(b.pendingDraft.independentSecondPass,'not_run');
 assert.equal(b.pendingDraft.chromiumLayoutChecksPassed,0);
 assert.equal(b.pendingDraft.sourceJPEGSHAverified,1);
 assert.equal(b.pendingDraft.priorPrivateDraftArtifactSha256,NEW);
 assert.ok(changed.ledger.history.some(x=>x.action==='private_draft_revised'&&x.priorStage==='second_pass_in_progress'));
 assert.deepEqual(validate(changed.ledger).errors,[]);
});
test('reused draft SHA or fabricated reviewed status is rejected',()=>{
 const {ledger,bookId}=fixture();
 assert.equal(reviseDraft(ledger,bookId,NEW,NEW,EV,REVIEW_AT).ok,false);
 const other=structuredClone(ledger);
 other.books.find(x=>x.bookId===bookId).pendingDraft.reviewStatus='awaiting_canonical_60';
 assert.ok(validate(other).errors.some(x=>x.includes('INDEPENDENT_SECOND_PASS_COMPLETION_UNSUPPORTED')));
});
test('private CLI requires exact version and never silently modifies ledger',t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'reader-repair-transition-'));
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const {ledger,bookId}=fixture(),p=progress(bookId);
 const ledgerPath=path.join(dir,'ledger.json'),progressPath=path.join(dir,'progress.json');
 fs.writeFileSync(ledgerPath,JSON.stringify(ledger));
 fs.writeFileSync(progressPath,JSON.stringify(p));
 const snapshot=fs.readFileSync(ledgerPath);
 let out=transition({ledger:ledgerPath,book:bookId,action:'advance',
  expectedRevision:ledger.version+1,progress:progressPath,to:'second_pass_in_progress',at:REVIEW_AT});
 assert.equal(out.ok,false);assert.ok(out.errors.includes('STALE_SHARED_LEDGER_REVISION'));
 out=transition({ledger:ledgerPath,book:bookId,action:'advance',
  expectedRevision:ledger.version,progress:progressPath,to:'second_pass_in_progress',at:REVIEW_AT});
 assert.equal(out.ok,true,out.errors.join(','));
 assert.deepEqual(fs.readFileSync(ledgerPath),snapshot);
});


test('a different book without a pending draft can start a versioned private first pass',()=>{
 const {ledger,bookId}=fixture('image');
 const book=ledger.books.find(x=>x.bookId===bookId);
 delete book.pendingDraft;
 const begun=startDraft(ledger,bookId,NEW,EV,1,REVIEW_AT);
 assert.equal(begun.ok,true,begun.errors.join(','));
 const now=begun.ledger.books.find(x=>x.bookId===bookId);
 assert.equal(now.artifactSha256,PUB,'published bytes remain pinned');
 assert.equal(now.pendingDraft.reviewStatus,'visual_first_pass_only');
 assert.equal(now.pendingDraft.realIPhone,'not_run');
 assert.equal(now.releaseStatus,'blocked');
 assert.deepEqual(validate(begun.ledger).errors,[]);
 assert.equal(startDraft(begun.ledger,bookId,'e'.repeat(64),EV,1,REVIEW_AT).ok,false,
  'new draft cannot overwrite an existing draft in place');
});
test('first-pass start rejects reused published SHA and permits isolated revision of reviewed old edition',()=>{
 const {ledger,bookId}=fixture('image');delete ledger.books.at(-1).pendingDraft;
 assert.equal(startDraft(ledger,bookId,PUB,EV,1,REVIEW_AT).ok,false);
 ledger.books.at(-1).releaseStatus='candidate';ledger.books.at(-1).qualityState='reviewed';
 const next=startDraft(ledger,bookId,NEW,EV,1,REVIEW_AT);
 assert.equal(next.ok,true,next.errors.join(','));
 assert.equal(next.ledger.books.at(-1).artifactSha256,PUB);
 assert.equal(next.ledger.books.at(-1).releaseStatus,'candidate');
 assert.equal(next.ledger.books.at(-1).pendingDraft.deliveryStatus,'private_staging_blocked');
 assert.deepEqual(validate(next.ledger).errors,[]);
 const unsafe=structuredClone(ledger);
 unsafe.books.at(-1).knownDefects.push({id:'open-ocr-error',status:'needs_source_review'});
 assert.equal(startDraft(unsafe,bookId,NEW,EV,1,REVIEW_AT).ok,false);
});
