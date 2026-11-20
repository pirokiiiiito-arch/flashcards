'use strict';
/*
 * Metadata-only staged proofreading states. The 60-rule release verifier is
 * NOT modified. These states describe progress and never authorize delivery.
 */
const SHA=/^[0-9a-f]{64}$/;
const hash=x=>typeof x==='string'&&SHA.test(x);
const STAGES=Object.freeze([
 'visual_first_pass_only',
 'second_pass_in_progress',
 'second_pass_completed',
 'source_resolved',
 'awaiting_canonical_60'
]);
function validatePendingDraft(book){
 const p=book.pendingDraft||book.currentWork;if(!p)return[];
 const current=!!book.currentWork;
 const errors=[],id=String(book.bookId||'');
 const fail=(ok,reason)=>{if(!ok)errors.push(reason+' '+id);};
 fail(!(book.pendingDraft&&book.currentWork),'MULTIPLE_CURRENT_REPAIR_ROLES');
 const index=current&&p.reviewStatus==='retained_scoped_review'?0:STAGES.indexOf(p.reviewStatus);
 fail(index>=0,'UNKNOWN_DRAFT_REVIEW_STATE');
 if(current){
  fail(p.schema==='reader-current-canonical-work-v1'&&p.role==='retained_reviewed_canonical'&&
   hash(p.adoptedManifestSha256)&&hash(p.retainedScopedReviewSha256)&&hash(p.retainedScopedAssessmentSha256),
   'INVALID_CURRENT_CANONICAL_WORK_ROLE');
  if(p.evidenceMode!==undefined)fail(p.evidenceMode==='formal_canonical'&&
   p.reviewStatus==='awaiting_canonical_60'&&hash(p.formalPreparationManifestSha256),'INVALID_FORMAL_CANONICAL_BINDING');
  fail(hash(p.artifactSha256)&&p.artifactSha256===book.artifactSha256,'CURRENT_CANONICAL_ARTIFACT_MISMATCH');
  fail(p.reviewStatus!=='visual_first_pass_only','CURRENT_CANONICAL_CANNOT_REVERT_TO_FIRST_PASS');
 }else fail(hash(p.artifactSha256)&&p.artifactSha256!==book.artifactSha256,
  'PENDING_DRAFT_ARTIFACT_COLLIDES_OR_MISSING');
 fail(hash(p.privateProgressReportSha256),'PENDING_DRAFT_BASE_EVIDENCE_MISSING');
 fail(p.deliveryStatus==='private_staging_blocked','PENDING_DRAFT_CANNOT_BE_DELIVERY');
 fail(p.realIPhone==='not_run','PENDING_DRAFT_DEVICE_NOT_VERIFIED');
 // A reviewed old release may stay available while an isolated NEW revision
 // is under construction. Only the draft is blocked; never downgrade old QA.
 const stablePrevious=book.releaseStatus==='candidate'&&book.qualityState==='reviewed'&&
  (book.knownDefects||[]).every(x=>x.status==='resolved');
 const unverifiedPrevious=book.releaseStatus==='blocked'&&book.qualityState==='unverified';
 fail(unverifiedPrevious||(!current&&stablePrevious),
   'PENDING_DRAFT_INVALID_PRIOR_RELEASE_STATE');
 fail(Number.isSafeInteger(p.sourceJPEGSHAverified)&&p.sourceJPEGSHAverified>=0,
   'PENDING_DRAFT_SOURCE_COUNT_INVALID');
 fail(Number.isSafeInteger(p.chromiumLayoutChecksPassed)&&p.chromiumLayoutChecksPassed>=0,
   'PENDING_DRAFT_LAYOUT_COUNT_INVALID');
 if(index===0)fail(p.independentSecondPass==='not_run','VISUAL_FIRST_PASS_STATE_INCONSISTENT');
 if(index===1)fail(p.independentSecondPass==='in_progress','SECOND_PASS_PROGRESS_STATE_INCONSISTENT');
 if(index>=2)fail(p.independentSecondPass==='complete'||
   p.independentSecondPass==='not_applicable_source_verified',
   'INDEPENDENT_SECOND_PASS_COMPLETION_UNSUPPORTED');
 if(index>=1)fail(hash(p.latestPrivateRepairProgressSha256),'PROGRESS_EVIDENCE_MISSING');
 if(index>=2)fail(hash(p.secondPassEvidenceSha256),'SECOND_PASS_COMPLETION_EVIDENCE_MISSING');
 if(index>=3)fail(hash(p.sourceResolutionEvidenceSha256),'SOURCE_RESOLUTION_EVIDENCE_MISSING');
 if(index>=4)fail(hash(p.canonicalPreparationEvidenceSha256),'CANONICAL_PREPARATION_EVIDENCE_MISSING');
 if(p.progressSummary!==undefined){
  const s=p.progressSummary;
  fail(s&&typeof s==='object'&&!Array.isArray(s)&&
    ['pageInventories','independentChecks','comparisons','imageChecks','boundaries','profileChecks']
      .every(k=>Number.isSafeInteger(s[k])&&s[k]>=0),'INVALID_PROGRESS_SUMMARY');
 }
 return errors;
}
function nextStage(stage){
 if(stage==='retained_scoped_review')return 'second_pass_in_progress';
 const i=STAGES.indexOf(stage);return i>=0&&i<STAGES.length-1?STAGES[i+1]:null;
}
// Independent second reading may finish before differences are reconciled.
// Requiring the comparison here deadlocks the second_pass_completed state.
function completionReady(result){
 const c=result.counts||{};
 if(['reader-repair-plan-v2','reader-repair-plan-v3'].includes(result.schema)){
  return c.inventoriesComplete===true&&c.pageInventoriesRecorded===c.scans&&
   c.independentTextRegionsRecorded===c.textRegionsDiscovered&&
   c.verifiedImageRegionsRecorded===c.nonTextRegionsDiscovered;
 }
 if(result.schema==='reader-repair-plan-v1'){
  return c.independentPagePassesRecorded===c.scans;
 }
 return false;
}
function resolutionReady(result){
 const c=result.counts||{};
 if(!completionReady(result))return false;
 if(['reader-repair-plan-v2','reader-repair-plan-v3'].includes(result.schema))
  return c.comparedTextRegionsRecorded===c.textRegionsDiscovered&&
   c.profileChecksRecorded===c.profileChecksRequired;
 if(result.schema==='reader-repair-plan-v1')
  return c.comparedPagesRecorded===c.scans;
 return false;
}
function boundaryReady(result){
 const c=result.counts||{};
 return c.boundariesRecorded===c.scans+1&&
   (!['reader-repair-plan-v2','reader-repair-plan-v3'].includes(result.schema)||c.bridgesRecorded===c.bridgesRequired)&&
   (c.unresolvedSourceDefects??c.unresolvedLedgerDefects)===0;
}
function counterSummary(result){
 const c=result.counts||{};
 return{pageInventories:c.pageInventoriesRecorded||0,
  independentChecks:c.independentTextRegionsRecorded??c.independentPagePassesRecorded??0,
  comparisons:c.comparedTextRegionsRecorded??c.comparedPagesRecorded??0,
  imageChecks:c.verifiedImageRegionsRecorded||0,
    boundaries:c.boundariesRecorded||0,profileChecks:c.profileChecksRecorded||0,
    blankChecks:c.blankPagesRecorded||0};
}
function advance(ledger,bookId,result,progressSha,target,at){
 const errors=[],clone=structuredClone(ledger);
 if(clone.schema!=='reader-work-ledger-v1'||!Array.isArray(clone.books))
  errors.push('INVALID_LEDGER_SCHEMA');
 if(!Number.isSafeInteger(clone.version)||clone.version<1)errors.push('INVALID_LEDGER_REVISION');
 const books=clone.books||[],matches=books.filter(b=>b.bookId===bookId);
 if(matches.length!==1)errors.push('BOOK_NOT_UNIQUELY_REGISTERED');
 const b=matches[0],p=b?.pendingDraft||b?.currentWork;
 if(!p)errors.push('NO_PRIVATE_WORKING_DRAFT');
 if(errors.length)return {ok:false,errors,ledger:null};
 if(result?.status!=='work_ready'||result.bookId!==bookId||
  result.workingDraftSha256!==p.artifactSha256||
  result.profile!==b.profile||JSON.stringify(result.range)!==JSON.stringify(b.range)||
  !['reader-repair-plan-v1','reader-repair-plan-v2','reader-repair-plan-v3'].includes(result.schema))
  errors.push('STALE_OR_INCOMPATIBLE_REPAIR_PLAN');
 if(b.currentWork&&(result.schema!=='reader-repair-plan-v3'||result.workingArtifactOrigin!=='currentWork'||
  !hash(result.manifestSha256)))errors.push('CURRENT_CANONICAL_MANIFEST_PLAN_REQUIRED');
 if(!hash(progressSha))errors.push('PRIVATE_PROGRESS_SHA_REQUIRED');
 if(!Number.isFinite(Date.parse(at||'')))errors.push('INVALID_TRANSITION_TIME');
 if(target!==nextStage(p.reviewStatus))errors.push('ILLEGAL_OR_SKIPPED_REPAIR_TRANSITION');
 if(errors.length)return{ok:false,errors,ledger:null};
 const c=result.counts||{},summary=counterSummary(result);
 const previous=p.progressSummary;
 if(previous&&Object.keys(previous).some(k=>summary[k]<previous[k]))
  errors.push('PROGRESS_COUNTS_CANNOT_REGRESS_FOR_SAME_SHA');
 if(target==='second_pass_in_progress'){
  const any=summary.independentChecks+summary.imageChecks+summary.blankChecks>0;
  if(!any)errors.push('NO_INDEPENDENT_CHECKS_RECORDED');
 }
 if(target==='second_pass_completed'&&!completionReady(result))
  errors.push('SECOND_PASS_REGIONS_INCOMPLETE');
 if((target==='source_resolved'||target==='awaiting_canonical_60')&&
   !(resolutionReady(result)&&boundaryReady(result)))
  errors.push('SOURCE_DIFFS_BOUNDARIES_OR_DEFECTS_UNRESOLVED');
 if(target==='awaiting_canonical_60'&&!(result.schema==='reader-repair-plan-v3'?
   result.canonicalPreparationReady===true:
   result.tasks.length===1&&result.tasks[0].type==='run_canonical_60_and_handoff_gate'))
  errors.push('CANONICAL_GATE_NOT_NEXT');
 if(errors.length)return{ok:false,errors,ledger:null};
 const previousStage=p.reviewStatus;
 p.reviewStatus=target;
 p.independentSecondPass=target==='second_pass_in_progress'?'in_progress':
   (['reader-repair-plan-v2','reader-repair-plan-v3'].includes(result.schema)&&c.textRegionsDiscovered===0)?
    'not_applicable_source_verified':'complete';
 p.latestPrivateRepairProgressSha256=progressSha;
 p.progressSummary=summary;
 if(target==='second_pass_completed')p.secondPassEvidenceSha256=progressSha;
 if(target==='source_resolved')p.sourceResolutionEvidenceSha256=progressSha;
 if(target==='awaiting_canonical_60')p.canonicalPreparationEvidenceSha256=progressSha;
 // No changes to published artifact, defects, official quality status or release.
 clone.version++;
 clone.history=Array.isArray(clone.history)?clone.history:[];
 clone.history.push({bookId,action:'repair_stage_advanced',from:previousStage,to:target,
   ...(b.currentWork?{currentCanonicalArtifactSha256:p.artifactSha256}:{pendingArtifactSha256:p.artifactSha256}),privateProgressSha256:progressSha,
  updatedLedgerVersion:clone.version,at,official60Passed:false,deliveryAllowed:false});
 return{ok:true,errors:[],ledger:clone,stage:target,version:clone.version,summary};
}
/*
 * A corrected canonical text creates new HTML bytes. Do not carry former
 * "completed" evidence to a new SHA. Preserve old draft in history and
 * require fresh per-region evidence, while never changing original scan ZIP.
 */
function startDraft(ledger,bookId,newSha,firstPassReportSha,sourceImageCount,at){
 const errors=[],clone=structuredClone(ledger);
 const matches=clone.books?.filter(x=>x.bookId===bookId);
 if(!Array.isArray(matches)||matches.length!==1)errors.push('BOOK_NOT_UNIQUELY_REGISTERED');
 const b=matches?.[0];
 if(b?.pendingDraft)errors.push('PENDING_DRAFT_ALREADY_EXISTS');
 if(b?.currentWork)errors.push('CURRENT_CANONICAL_WORK_ALREADY_EXISTS');
 if(b?.qualityState==='unverified'&&b.releaseStatus==='blocked'&&
  require('./reader-repair-context.cjs').hasRetainedCanonicalState(b))
  errors.push('RETAINED_CANONICAL_REQUIRES_CONTEXT_ADOPTION');
 if(!Number.isSafeInteger(clone.version)||clone.version<1)errors.push('INVALID_LEDGER_REVISION');
 if(b&&!(
    (b.qualityState==='unverified'&&b.releaseStatus==='blocked')||
    (b.qualityState==='reviewed'&&b.releaseStatus==='candidate'&&
     (b.knownDefects||[]).every(x=>x.status==='resolved'))))
  errors.push('NORMAL_RELEASE_CANNOT_START_UNVERIFIED_DRAFT');
 if(!hash(newSha)||newSha===b?.artifactSha256)errors.push('NEW_WORKING_DRAFT_SHA_REQUIRED');
 if(!hash(firstPassReportSha))errors.push('SOURCE_FIRST_PASS_REPORT_REQUIRED');
 if(!Number.isSafeInteger(sourceImageCount)||sourceImageCount<0)errors.push('INVALID_SOURCE_IMAGE_COUNT');
 if(!Number.isFinite(Date.parse(at||'')))errors.push('INVALID_TRANSITION_TIME');
 if(errors.length)return{ok:false,errors,ledger:null};
 b.pendingDraft={artifactSha256:newSha,reviewStatus:'visual_first_pass_only',
   deliveryStatus:'private_staging_blocked',independentSecondPass:'not_run',
   realIPhone:'not_run',privateProgressReportSha256:firstPassReportSha,
   sourceJPEGSHAverified:sourceImageCount,chromiumLayoutChecksPassed:0};
 clone.version++;
 clone.history=Array.isArray(clone.history)?clone.history:[];
 clone.history.push({bookId,action:'private_draft_started',
  publishedArtifactSha256:b.artifactSha256,pendingArtifactSha256:newSha,
  privateFirstPassReportSha256:firstPassReportSha,at,
  official60Passed:false,deliveryAllowed:false});
 return{ok:true,errors:[],ledger:clone,stage:'visual_first_pass_only',version:clone.version};
}
function reviseDraft(ledger,bookId,priorSha,newSha,firstPassReportSha,at){
 const errors=[],clone=structuredClone(ledger);
 const book=clone.books?.filter(x=>x.bookId===bookId);
 if(!Array.isArray(book)||book.length!==1)errors.push('BOOK_NOT_UNIQUELY_REGISTERED');
 const b=book?.[0],old=b?.pendingDraft;
 if(!old)errors.push('NO_PRIVATE_DRAFT_TO_REVISE');
 if(!Number.isSafeInteger(clone.version)||clone.version<1)errors.push('INVALID_LEDGER_REVISION');
 if(!hash(priorSha)||!old||priorSha!==old.artifactSha256)
  errors.push('STALE_DRAFT_REVISION');
 if(!hash(newSha)||newSha===priorSha||newSha===b?.artifactSha256)
  errors.push('REVISED_DRAFT_NOT_NEW_BYTES');
 if(!hash(firstPassReportSha))errors.push('NEW_SOURCE_REVIEW_REPORT_REQUIRED');
 if(!Number.isFinite(Date.parse(at||'')))errors.push('INVALID_REVISION_TIME');
 if(errors.length)return {ok:false,errors,ledger:null};
 const copy=structuredClone(old);
 clone.history=Array.isArray(clone.history)?clone.history:[];
 clone.history.push({bookId,action:'private_draft_revised',
   priorDraftArtifactSha256:priorSha,priorStage:old.reviewStatus,
   nextDraftArtifactSha256:newSha,reviewReportSha256:firstPassReportSha,
   at,official60Passed:false,deliveryAllowed:false});
 b.pendingDraft={artifactSha256:newSha,reviewStatus:'visual_first_pass_only',
  deliveryStatus:'private_staging_blocked',independentSecondPass:'not_run',
  realIPhone:'not_run',privateProgressReportSha256:firstPassReportSha,
  sourceJPEGSHAverified:copy.sourceJPEGSHAverified||0,
  chromiumLayoutChecksPassed:0,priorPrivateDraftArtifactSha256:priorSha,
  note:'The source-image bytes can be reused only if separately verified. OCR, presentation and independent proof are invalidated for this new artifact SHA.'};
 clone.version++;
 return{ok:true,errors:[],ledger:clone,stage:'visual_first_pass_only',version:clone.version};
}

function adoptCurrent(ledger,bookId,manifestFile,at){
 const errors=[],clone=structuredClone(ledger),matches=clone.books?.filter(x=>x.bookId===bookId);
 if(!Array.isArray(matches)||matches.length!==1)errors.push('BOOK_NOT_UNIQUELY_REGISTERED');
 if(!Number.isSafeInteger(clone.version)||clone.version<1)errors.push('INVALID_LEDGER_REVISION');
 const book=matches?.[0];
 if(book?.pendingDraft||book?.currentWork)errors.push('CURRENT_REPAIR_WORK_ALREADY_REGISTERED');
 if(book&&(book.qualityState!=='unverified'||book.releaseStatus!=='blocked'))errors.push('CURRENT_CANONICAL_MUST_REMAIN_UNRELEASED');
 if(!Number.isFinite(Date.parse(at||'')))errors.push('INVALID_TRANSITION_TIME');
 if(errors.length)return {ok:false,errors,ledger:null};
 try{
  const existing=require('./reader-work-ledger-validate.cjs').validate(ledger);
  if(existing.errors.length)return {ok:false,errors:['INVALID_SHARED_WORK_LEDGER',...existing.errors],ledger:null};
  const context=require('./reader-repair-context.cjs').loadContext(book,manifestFile);
  if(!context||context.kind!=='scoped')return {ok:false,errors:['SCOPED_REPAIR_ADOPTION_MIGRATION_REQUIRED'],ledger:null};
  book.currentWork={schema:'reader-current-canonical-work-v1',role:'retained_reviewed_canonical',
   artifactSha256:book.artifactSha256,reviewStatus:'retained_scoped_review',
   deliveryStatus:'private_staging_blocked',independentSecondPass:'not_run',realIPhone:'not_run',
   privateProgressReportSha256:context.m.scopedReview.sha256,adoptedManifestSha256:context.manifestSha256,
   retainedScopedReviewSha256:context.m.scopedReview.sha256,retainedScopedAssessmentSha256:context.m.assessment.sha256,
   sourceJPEGSHAverified:context.pages.length,chromiumLayoutChecksPassed:context.verified.display.completedConditions};
  clone.version++;clone.history=Array.isArray(clone.history)?clone.history:[];
  clone.history.push({bookId,action:'retained_current_canonical_adopted_for_repair',
   currentCanonicalArtifactSha256:book.artifactSha256,privateManifestSha256:context.manifestSha256,
   privateScopedReviewSha256:context.m.scopedReview.sha256,at,artifactChanged:false,
   priorPublicationAsserted:false,official60Passed:false,deliveryAllowed:false});
  return {ok:true,errors:[],ledger:clone,stage:'retained_scoped_review',version:clone.version};
 }catch(e){return {ok:false,errors:[e.message],ledger:null};}
}
function bindFormal(ledger,bookId,manifestFile,at){
 const clone=structuredClone(ledger),book=clone.books?.find(x=>x.bookId===bookId);
 if(!book?.currentWork||book.currentWork.reviewStatus!=='awaiting_canonical_60')
  return {ok:false,errors:['CURRENT_WORK_NOT_AWAITING_CANONICAL_60'],ledger:null};
 if(!Number.isFinite(Date.parse(at||'')))return {ok:false,errors:['INVALID_TRANSITION_TIME'],ledger:null};
 try{
  const validation=require('./reader-work-ledger-validate.cjs').validate(ledger);
  if(validation.errors.length)return {ok:false,errors:['INVALID_SHARED_WORK_LEDGER',...validation.errors],ledger:null};
  const context=require('./reader-repair-context.cjs').inspectFormalContext(book,manifestFile);
  book.currentWork.evidenceMode='formal_canonical';
  book.currentWork.formalPreparationManifestSha256=context.manifestSha256;
  clone.version++;clone.history=Array.isArray(clone.history)?clone.history:[];
  clone.history.push({bookId,action:'formal_preparation_evidence_bound',currentCanonicalArtifactSha256:book.artifactSha256,
   formalManifestSha256:context.manifestSha256,retainedScopedReviewSha256:book.currentWork.retainedScopedReviewSha256,
   at,official60Passed:false,deliveryAllowed:false});
  return {ok:true,errors:[],ledger:clone,stage:book.currentWork.reviewStatus,version:clone.version};
 }catch(e){return {ok:false,errors:[e.message],ledger:null};}
}
function reviseCurrent(ledger,bookId,priorSha,manifestFile,at){
 const clone=structuredClone(ledger),book=clone.books?.find(x=>x.bookId===bookId);
 if(!book?.currentWork||book.pendingDraft||priorSha!==book.artifactSha256||priorSha!==book.currentWork.artifactSha256)
  return {ok:false,errors:['STALE_CURRENT_CANONICAL_REVISION'],ledger:null};
 if(!Number.isFinite(Date.parse(at||'')))return {ok:false,errors:['INVALID_REVISION_TIME'],ledger:null};
 try{
  const validation=require('./reader-work-ledger-validate.cjs').validate(ledger);
  if(validation.errors.length)return {ok:false,errors:['INVALID_SHARED_WORK_LEDGER',...validation.errors],ledger:null};
  const fs=require('node:fs'),m=JSON.parse(fs.readFileSync(manifestFile,'utf8'));
  if(!hash(m.artifact?.sha256)||m.artifact.sha256===priorSha)return {ok:false,errors:['REVISED_CURRENT_CANONICAL_NOT_NEW_BYTES'],ledger:null};
  const previous=structuredClone(book.currentWork);delete book.currentWork;
  book.artifactSha256=m.artifact.sha256;
  if(book.privateAssessmentSha256)book.privateAssessmentSha256=m.assessment?.sha256;
  const adopted=adoptCurrent(clone,bookId,manifestFile,at);
  if(!adopted.ok)return adopted;
  const current=adopted.ledger.books.find(x=>x.bookId===bookId);
  for(const defect of current.knownDefects||[])if(defect.status==='resolved'&&defect.artifactSha256&&defect.artifactSha256!==current.artifactSha256){
   defect.priorResolutionArtifactSha256=defect.artifactSha256;defect.status='open';
  }
  adopted.ledger.history.push({bookId,action:'current_canonical_revised',priorCanonicalWork:previous,
   currentCanonicalArtifactSha256:current.artifactSha256,at,priorPublicationAsserted:false,
   oldDisplayEvidenceCarriedForward:false,official60Passed:false,deliveryAllowed:false});
  return adopted;
 }catch(e){return {ok:false,errors:[e.message],ledger:null};}
}
module.exports={STAGES,validatePendingDraft,nextStage,advance,startDraft,reviseDraft,adoptCurrent,bindFormal,reviseCurrent,completionReady,resolutionReady,boundaryReady,counterSummary};
