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
 const p=book.pendingDraft;if(!p)return[];
 const errors=[],id=String(book.bookId||'');
 const fail=(ok,reason)=>{if(!ok)errors.push(reason+' '+id);};
 const index=STAGES.indexOf(p.reviewStatus);
 fail(index>=0,'UNKNOWN_DRAFT_REVIEW_STATE');
 fail(hash(p.artifactSha256)&&p.artifactSha256!==book.artifactSha256,
   'PENDING_DRAFT_ARTIFACT_COLLIDES_OR_MISSING');
 fail(hash(p.privateProgressReportSha256),'PENDING_DRAFT_BASE_EVIDENCE_MISSING');
 fail(p.deliveryStatus==='private_staging_blocked','PENDING_DRAFT_CANNOT_BE_DELIVERY');
 fail(p.realIPhone==='not_run','PENDING_DRAFT_DEVICE_NOT_VERIFIED');
 fail(book.releaseStatus==='blocked'&&book.qualityState==='unverified',
   'PENDING_DRAFT_CANNOT_BE_PUBLIC_CANDIDATE');
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
 const i=STAGES.indexOf(stage);return i>=0&&i<STAGES.length-1?STAGES[i+1]:null;
}
function completionReady(result){
 const c=result.counts||{};
 if(result.schema==='reader-repair-plan-v2'){
  return c.inventoriesComplete===true&&c.pageInventoriesRecorded===c.scans&&
   c.independentTextRegionsRecorded===c.textRegionsDiscovered&&
   c.comparedTextRegionsRecorded===c.textRegionsDiscovered&&
   c.verifiedImageRegionsRecorded===c.nonTextRegionsDiscovered&&
   c.profileChecksRecorded===c.profileChecksRequired;
 }
 if(result.schema==='reader-repair-plan-v1'){
  return c.independentPagePassesRecorded===c.scans&&c.comparedPagesRecorded===c.scans;
 }
 return false;
}
function boundaryReady(result){
 const c=result.counts||{};
 return c.boundariesRecorded===c.scans+1&&
   (result.schema!=='reader-repair-plan-v2'||c.bridgesRecorded===c.bridgesRequired)&&
   c.unresolvedLedgerDefects===0;
}
function counterSummary(result){
 const c=result.counts||{};
 return{pageInventories:c.pageInventoriesRecorded||0,
  independentChecks:c.independentTextRegionsRecorded??c.independentPagePassesRecorded??0,
  comparisons:c.comparedTextRegionsRecorded??c.comparedPagesRecorded??0,
  imageChecks:c.verifiedImageRegionsRecorded||0,
  boundaries:c.boundariesRecorded||0,profileChecks:c.profileChecksRecorded||0};
}
function advance(ledger,bookId,result,progressSha,target,at){
 const errors=[],clone=structuredClone(ledger);
 if(clone.schema!=='reader-work-ledger-v1'||!Array.isArray(clone.books))
  errors.push('INVALID_LEDGER_SCHEMA');
 if(!Number.isSafeInteger(clone.version)||clone.version<1)errors.push('INVALID_LEDGER_REVISION');
 const books=clone.books||[],matches=books.filter(b=>b.bookId===bookId);
 if(matches.length!==1)errors.push('BOOK_NOT_UNIQUELY_REGISTERED');
 const b=matches[0],p=b?.pendingDraft;
 if(!p)errors.push('NO_PRIVATE_WORKING_DRAFT');
 if(errors.length)return {ok:false,errors,ledger:null};
 if(result?.status!=='work_ready'||result.bookId!==bookId||
  result.workingDraftSha256!==p.artifactSha256||
  result.profile!==b.profile||JSON.stringify(result.range)!==JSON.stringify(b.range)||
  !['reader-repair-plan-v1','reader-repair-plan-v2'].includes(result.schema))
  errors.push('STALE_OR_INCOMPATIBLE_REPAIR_PLAN');
 if(!hash(progressSha))errors.push('PRIVATE_PROGRESS_SHA_REQUIRED');
 if(!Number.isFinite(Date.parse(at||'')))errors.push('INVALID_TRANSITION_TIME');
 if(target!==nextStage(p.reviewStatus))errors.push('ILLEGAL_OR_SKIPPED_REPAIR_TRANSITION');
 if(errors.length)return{ok:false,errors,ledger:null};
 const c=result.counts||{},summary=counterSummary(result);
 const previous=p.progressSummary;
 if(previous&&Object.keys(previous).some(k=>summary[k]<previous[k]))
  errors.push('PROGRESS_COUNTS_CANNOT_REGRESS_FOR_SAME_SHA');
 if(target==='second_pass_in_progress'){
  const any=summary.independentChecks+summary.imageChecks>0;
  if(!any)errors.push('NO_INDEPENDENT_CHECKS_RECORDED');
 }
 if(target==='second_pass_completed'&&!completionReady(result))
  errors.push('SECOND_PASS_REGIONS_INCOMPLETE');
 if((target==='source_resolved'||target==='awaiting_canonical_60')&&
   !(completionReady(result)&&boundaryReady(result)))
  errors.push('SOURCE_DIFFS_BOUNDARIES_OR_DEFECTS_UNRESOLVED');
 if(target==='awaiting_canonical_60'&&
   !(result.tasks.length===1&&result.tasks[0].type==='run_canonical_60_and_handoff_gate'))
  errors.push('CANONICAL_GATE_NOT_NEXT');
 if(errors.length)return{ok:false,errors,ledger:null};
 const previousStage=p.reviewStatus;
 p.reviewStatus=target;
 p.independentSecondPass=target==='second_pass_in_progress'?'in_progress':
  (result.schema==='reader-repair-plan-v2'&&c.textRegionsDiscovered===0)?
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
  pendingArtifactSha256:p.artifactSha256,privateProgressSha256:progressSha,
  updatedLedgerVersion:clone.version,at,official60Passed:false,deliveryAllowed:false});
 return{ok:true,errors:[],ledger:clone,stage:target,version:clone.version,summary};
}
module.exports={STAGES,validatePendingDraft,nextStage,advance,completionReady,boundaryReady,counterSummary};
