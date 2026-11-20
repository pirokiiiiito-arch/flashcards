'use strict';
// Read-only planning context. Existing review evidence is reused within its
// recorded scope; this module never authorizes delivery or awards a 60-rule pass.
const fs=require('node:fs'),path=require('node:path');
const LANES=Object.freeze(['source','structure','text','figures','layout','interaction','reporting','delivery','device']);
const SOURCE_LANES=new Set(['source','structure','text','figures']);
const EXTERNAL_LANES=new Set(['delivery','device']);
const SHA=/^[a-f0-9]{64}$/;
const demand=(ok,code)=>{if(!ok)throw Error(code);};
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function api(){return require('./reader-release-control.cjs');}
function hasScopedState(book){
 return book.retainedReviewState==='reviewed_canonical_with_scoped_source_reviews'||
  book.scopedSourceReviewSummary?.state==='reviewed_partial_canonical'||
  book.sourceReviewStatus==='reviewed_partial_canonical'||
  book.currentWork?.role==='retained_reviewed_canonical'||
  book.pendingDraft?.retainedReviewState==='reviewed_canonical_with_scoped_source_reviews';
}
function hasRetainedCanonicalState(book){
 return hasScopedState(book)||book.sourceReviewStatus==='two_independent_transcriptions_reconciled_against_source'||
  SHA.test(book.privateAssessmentSha256||'');
}
function catalog(){
 const c=JSON.parse(fs.readFileSync(path.join(__dirname,'../reader/quality/work-catalog.json'),'utf8'));
 const rules=require('./reader-quality-gate.cjs').RULES;
 demand(c.schema==='reader-quality-work-catalog-v1'&&Array.isArray(c.checks)&&
  same(c.checks.map(x=>x.id).sort(),rules.slice().sort()),'REPAIR_WORK_CATALOG_SIXTY_MISMATCH');
 for(const x of c.checks)demand(LANES.includes(x.lane)&&typeof x.taskType==='string'&&x.taskType.length>2&&
  typeof x.action==='string'&&x.action.trim()&&Array.isArray(x.completionEvidence)&&x.completionEvidence.length&&
  x.completionEvidence.every(e=>typeof e==='string'&&e.trim())&&Array.isArray(x.dependencies)&&
  x.dependencies.every(id=>rules.includes(id)&&id!==x.id),'REPAIR_WORK_CATALOG_INVALID');
 return c;
}
function defectLane(issue,checks=null){
 // Unknown defects stay on the source side. Neither free-form notes nor a
 // caller's arbitrary lane can turn a content defect into an external wait.
 if(['ocr_text_accuracy','independent_proofreading','source_review_coverage','source_ruby'].includes(issue.category))return 'source';
 if(issue.checkId&&checks){const row=checks.find(x=>x.id===issue.checkId);if(row)return row.lane;}
 if(issue.checkId==='G8-04'||issue.id==='iphone-device-confirmation-pending')return 'device';
 if(issue.checkId==='G8-03'||issue.id==='artifact-specific-preview-consent-missing'||
  issue.id==='preview-v3-public-code-deployment-pending'||
  /^v[0-9]+(?:_[0-9]+)?-loader-publication-and-readback-pending$/.test(issue.id||''))return 'delivery';
 return 'source';
}
function classifyDefects(defects,checks=null){
 if(!checks&&(defects||[]).some(x=>x.checkId))try{checks=catalog().checks;}catch(_){/* Unknown check remains a source blocker. */}
 const work=[],waiting=[],source=[];
 for(const issue of defects||[]){
  if(issue.status==='resolved')continue;
  const lane=defectLane(issue,checks),external=EXTERNAL_LANES.has(lane);
  const task={id:(external?'await_known_external_requirement:':'resolve_known_source_defect:')+issue.id,
   type:external?'await_known_external_requirement':'resolve_known_source_defect',edge:issue.id,lane,
   priority:external?200:SOURCE_LANES.has(lane)?50:80,recorded:false,
   reason:external?'Obtain the required external delivery/device evidence; other production work may continue.':
    'Resolve the source-backed known defect against the exact current artifact and preserve its history.'};
  (external?waiting:work).push(task);if(SOURCE_LANES.has(lane))source.push(task);
 }
 return {work,waiting,source};
}
function loadContext(book,manifestFile){
 if(!manifestFile){
  demand(!hasScopedState(book),'SCOPED_REPAIR_MANIFEST_REQUIRED');
  demand(book.pendingDraft||!hasRetainedCanonicalState(book),'EXISTING_CANONICAL_MANIFEST_REQUIRED');return null;
 }
 const manifestPath=path.resolve(manifestFile),root=path.dirname(manifestPath),rawManifest=fs.readFileSync(manifestPath),m=JSON.parse(rawManifest);
 if(book.currentWork?.evidenceMode==='formal_canonical')return inspectFormalContext(book,manifestPath);
 if(!m.scopedReview){
  demand(!hasScopedState(book),'SCOPED_REPAIR_EVIDENCE_MISSING');
  if(book.pendingDraft)return null;
  const v=api();
  demand(m.schema==='reader-private-bundle-v2'&&m.bookId===book.bookId&&same(m.range,book.range)&&
   m.artifact?.sha256===book.artifactSha256,'EXISTING_CANONICAL_MANIFEST_IDENTITY_MISMATCH');
  const parsed=v.extract(v.bytes(root,m.artifact)),canonical=v.json(root,m.canonical);
  demand(v.objHash(parsed.data)===v.objHash(canonical),'EXISTING_CANONICAL_ARTIFACT_MISMATCH');
  return {kind:'existing_canonical_migration',manifestSha256:v.hash(rawManifest),artifactSha256:m.artifact.sha256,
   canonicalSha256:m.canonical.sha256};
 }
 const v=api(),workingSha=book.pendingDraft?.artifactSha256||book.currentWork?.artifactSha256||book.artifactSha256;
 demand(m.schema==='reader-private-bundle-v2'&&m.bookId===book.bookId&&same(m.range,book.range)&&
  m.artifact?.sha256===workingSha,'SCOPED_REPAIR_MANIFEST_IDENTITY_MISMATCH');
 const canonical=v.json(root,m.canonical),pages=Array.isArray(canonical)?canonical:canonical.pages;
 const parsed=v.extract(v.bytes(root,m.artifact)),index=v.json(root,m.originalIndex),raw=v.json(root,m.raw),events=v.json(root,m.corrections);
 const lock=v.json(root,m.lock),template=v.bytes(root,m.template).toString('utf8'),profile=v.json(root,m.profile);
 demand(Array.isArray(pages)&&pages.length===book.range[1]-book.range[0]+1&&
  pages.every((p,i)=>p.scan===book.range[0]+i),'SCOPED_REPAIR_PAGE_COVERAGE');
 demand(v.objHash(parsed.data)===v.objHash(canonical)&&v.objHash(v.replay(raw,events))===v.objHash(canonical),
  'SCOPED_REPAIR_CANONICAL_CHANGED');
 demand(lock.schema==='reader-input-lock-v2'&&['raw','originalIndex','template','profile'].every(k=>lock[k]===m[k]?.sha256)&&
  parsed.shell===template&&profile.templateSha256===m.template.sha256,'SCOPED_REPAIR_IMMUTABLE_INPUT_CHANGED');
 demand(v.objHash(v.originals(pages))===v.objHash(index),'SCOPED_REPAIR_ORIGINAL_BYTES_CHANGED');
 const proof=v.json(root,m.sourceDiscovery);
 demand(proof.sourceArchiveSha256===book.sourceArchiveSha256,'SCOPED_REPAIR_SOURCE_ARCHIVE_MISMATCH');
 if(book.pendingDraft||book.currentWork)demand((book.currentWork?.retainedScopedReviewSha256||book.pendingDraft?.privateProgressReportSha256)===m.scopedReview.sha256,
  'SCOPED_REPAIR_PENDING_DRAFT_EVIDENCE_MISMATCH');
 else if(book.privateAssessmentSha256)demand(book.privateAssessmentSha256===m.assessment.sha256,
  'SCOPED_REPAIR_LEDGER_ASSESSMENT_MISMATCH');
 const verified=require('./reader-scoped-review.cjs').validate(root,m,pages,index,require('./reader-quality-gate.cjs').RULES);
 return {kind:'scoped',root,m,pages,index,proof,verified,assessment:v.json(root,m.assessment),
  scope:v.json(root,m.scopedReview),manifestSha256:v.hash(rawManifest)};
}
function progressWithRetainedBlanks(book,progress,context){
 const p=progress?structuredClone(progress):{schema:'reader-repair-progress-v2',bookId:book.bookId,
  range:book.range,profile:book.profile,artifactSha256:context.m.artifact.sha256,pages:[],boundaries:[],bridges:[]};
 demand(p.schema==='reader-repair-progress-v2'&&p.bookId===book.bookId&&same(p.range,book.range)&&
  p.profile===book.profile&&p.artifactSha256===context.m.artifact.sha256&&Array.isArray(p.pages)&&
  Array.isArray(p.boundaries),'SCOPED_REPAIR_PROGRESS_IDENTITY_MISMATCH');
 for(const page of p.pages)demand(context.index[page.scan]===page.sourceImageSha256,'SCOPED_REPAIR_PROGRESS_SOURCE_MISMATCH');
 const retained=[];
 for(const scan of context.verified.source.blankComparisonScans){
  if(p.pages.some(x=>x.scan===scan))continue;
  const page=context.pages.find(x=>x.scan===scan),record=context.scope.comparisons.find(x=>x.scan===scan&&x.kind==='source_blank_comparison');
  if(!Number.isSafeInteger(page.width)||page.width<=0||!Number.isSafeInteger(page.height)||page.height<=0)continue;
  const reviewer=require('./reader-scoped-review.cjs').pointer(api().json(context.root,record.evidence),record.reviewerPointer);
  const evidence={status:'source_verified',sourceImageSha256:page.sha256,evidenceSha256:record.evidence.sha256,reviewedBy:reviewer};
  p.pages.push({scan,sourceImageSha256:page.sha256,regions:[],
   inventory:{...evidence,width:page.width,height:page.height,hasReadableText:false,allRegionsInventoried:true,blankPage:true},
   blankReview:{...evidence,originalBytesSha256:page.sha256,observedBlank:true,hasReadableText:false,hasNonTextContent:false}});
  retained.push(scan);
 }
 return {progress:p,retained};
}
function assessmentTasks(context,workCatalog){
 const tasks=[],retained=[],v=api();
 const completed=new Set(context.assessment.checks.filter(x=>['passed','not_applicable'].includes(x.status)).map(x=>x.id));
 for(const check of context.assessment.checks){
  const row=workCatalog.checks.find(x=>x.id===check.id),subchecks=check.completedSubchecks||[];
  demand(Array.isArray(subchecks),'SCOPED_REPAIR_COMPLETED_SUBCHECKS_INVALID');
  const seen=new Set();
  for(const sub of subchecks){
   demand(sub&&typeof sub.id==='string'&&sub.id&&!seen.has(sub.id)&&sub.status==='passed'&&
    typeof sub.scope==='string'&&sub.scope&&Array.isArray(sub.evidence)&&sub.evidence.length,
    'SCOPED_REPAIR_COMPLETED_SUBCHECK_INVALID');seen.add(sub.id);
   for(const reference of sub.evidence)v.bytes(context.root,reference);
   retained.push({checkId:check.id,...sub,evidenceBindingsVerified:true,formalRuleCertified:false});
  }
  if(completed.has(check.id))continue;
  const remaining=check.remainingRequirements;
  demand(remaining===undefined||(Array.isArray(remaining)&&remaining.every(x=>typeof x==='string'&&x.trim())),
   'SCOPED_REPAIR_REMAINING_REQUIREMENTS_INVALID');
  const requirements=remaining?.length?remaining:[row.action];
  for(const requirement of [...new Set(requirements)]){
   const blockedBy=row.dependencies.filter(id=>!completed.has(id));
   tasks.push({id:'verify_requirement:'+check.id+':'+v.hash(requirement).slice(0,16),
    type:row.taskType,checkId:check.id,lane:row.lane,priority:100+LANES.indexOf(row.lane)*10,
    reason:requirement,requirement,completionEvidence:row.completionEvidence,
    blockedBy,recorded:false,completedSubcheckIds:subchecks.map(s=>s.id),
    retainedDisplayEvidence:context.verified.display.status==='completed_passed',
    note:'Verify only the remaining requirement; preserved evidence is not a fresh execution or a full-rule pass.'});
  }
 }
 return {tasks,retained,completed:[...completed]};
}
function buildPlan(book,progress,context,planRegions){
 if(context.kind==='formal')return buildFormalPlan(book,context);
 if(context.kind==='existing_canonical_migration'){
  const task={id:'connect_existing_canonical_context',type:'connect_existing_canonical_context',lane:'reporting',priority:0,
   reason:'Bind the existing canonical and retained evidence to a supported current-work context. Do not recreate a first pass or relabel completed independent review as partial.',
   recorded:false,contextSetupOnly:true};
  return {schema:'reader-repair-plan-v3',status:'blocked',bookId:book.bookId,range:book.range,profile:book.profile,
   manifestSha256:context.manifestSha256,workingDraftSha256:context.artifactSha256,workingArtifactOrigin:'existing_canonical_requires_context',
   releaseEligible:false,contextRequired:true,errors:['EXISTING_CANONICAL_REPAIR_CONTEXT_REQUIRED'],warnings:[],
   tasks:[task],readyTasks:[task],deferredTasks:[],waitingTasks:[],queues:{reporting:[task]},remainingWorkItems:1,nextAction:task,
   retainedEvidence:{artifactSha256:context.artifactSha256,canonicalSha256:context.canonicalSha256,
    retainedLedgerReviewStatus:book.sourceReviewStatus||book.retainedReviewState||null,normalReleaseAuthorized:false},
   note:'This legacy evidence format has not been migrated by this planner. The existing reader is retained; no source or quality pass is inferred.'};
 }
 const workCatalog=catalog(),prepared=progressWithRetainedBlanks(book,progress,context);
 const regions=planRegions(book,prepared.progress),defects=classifyDefects(book.knownDefects,workCatalog.checks);
 const assessment=assessmentTasks(context,workCatalog),errors=regions.errors.slice(),warnings=regions.warnings.slice();
 const independentReady=regions.counts.inventoriesComplete===true&&
  regions.counts.independentTextRegionsRecorded===regions.counts.textRegionsDiscovered;
 for(const task of assessment.tasks)if(task.checkId==='G3-07'&&!independentReady)
  task.blockedBy.push('independent_second_transcription');
 const sourceTasks=regions.tasks.map(t=>({...t,lane:t.type.includes('transcrib')||t.type.includes('comparison')?'text':'source',blockedBy:[]}));
 const candidates=[...sourceTasks,...defects.work,...assessment.tasks.filter(t=>!EXTERNAL_LANES.has(t.lane))];
 const sort=(a,b)=>a.priority-b.priority||a.id.localeCompare(b.id);
 const tasks=errors.length?[]:candidates.sort(sort),readyTasks=tasks.filter(t=>!t.blockedBy?.length),deferredTasks=tasks.filter(t=>t.blockedBy?.length);
 const waitingTasks=[...defects.waiting,...assessment.tasks.filter(t=>EXTERNAL_LANES.has(t.lane))].sort(sort);
 const c=regions.counts,sourceReady=c.inventoriesComplete===true&&c.independentTextRegionsRecorded===c.textRegionsDiscovered&&
  c.comparedTextRegionsRecorded===c.textRegionsDiscovered&&c.verifiedImageRegionsRecorded===c.nonTextRegionsDiscovered&&
  c.profileChecksRecorded===c.profileChecksRequired&&c.boundariesRecorded===c.scans+1&&
  c.bridgesRecorded===c.bridgesRequired&&defects.source.length===0;
 const queues=Object.fromEntries(LANES.map(lane=>[lane,[...tasks,...waitingTasks].filter(t=>t.lane===lane)]));
 return {schema:'reader-repair-plan-v3',status:errors.length?'blocked':readyTasks.length?'work_ready':'waiting',
  bookId:book.bookId,range:book.range,profile:book.profile,manifestSha256:context.manifestSha256,
  originalPublishedArtifactSha256:book.pendingDraft?book.artifactSha256:null,
  workingDraftSha256:context.m.artifact.sha256,workingDraftIsDistinctFromPublished:!!book.pendingDraft,
  workingArtifactOrigin:book.pendingDraft?'pendingDraft':book.currentWork?'currentWork':'retained_reviewed_canonical',
  adoptionRequired:!book.pendingDraft&&!book.currentWork,
  originalReaderStillBlocked:book.releaseStatus==='blocked',releaseEligible:false,canonicalPreparationReady:sourceReady,
  counts:{...c,sourceImagesPreviouslyReported:context.pages.length,
   layoutConditionsPreviouslyReported:context.verified.display.completedConditions,
   unresolvedLedgerDefects:(book.knownDefects||[]).filter(x=>x.status!=='resolved').length,
   unresolvedSourceDefects:defects.source.length,externalWaitingDefects:defects.waiting.length,
   retainedBlankPages:prepared.retained.length,completedCanonicalChecks:assessment.completed.length},
  tasks,readyTasks,deferredTasks,waitingTasks,queues,remainingWorkItems:tasks.length,
  nextAction:readyTasks[0]||null,errors,warnings,
  retainedEvidence:{artifactSha256:context.m.artifact.sha256,source:context.verified.source,display:context.verified.display,
   assessment:context.verified.assessment,sourceEvidenceDigests:context.verified.sourceEvidenceIndex,
   completedCanonicalCheckIds:assessment.completed,completedSubchecks:assessment.retained,
   blankComparisonsReused:prepared.retained,normalReleaseAuthorized:false},
  note:'Production work continues independently of preview consent and delivery/device waits. Exact original bytes, actual source evidence and the unchanged sixty-rule release gates remain authoritative.'};
}
function inspectFormalContext(book,manifestFile){
 demand(book.currentWork?.role==='retained_reviewed_canonical','FORMAL_REPAIR_CURRENT_WORK_REQUIRED');
 const manifestPath=path.resolve(manifestFile),root=path.dirname(manifestPath),raw=fs.readFileSync(manifestPath),m=JSON.parse(raw),v=api();
 demand(!m.scopedReview&&m.bookId===book.bookId&&same(m.range,book.range)&&m.artifact?.sha256===book.artifactSha256&&
  m.artifact.sha256===book.currentWork.artifactSha256,'FORMAL_REPAIR_IDENTITY_OR_ACTIVE_SCOPE_MISMATCH');
 for(const [key,sha]of Object.entries({retainedScopedReview:book.currentWork.retainedScopedReviewSha256,
  retainedScopedAssessment:book.currentWork.retainedScopedAssessmentSha256,retainedScopedManifest:book.currentWork.adoptedManifestSha256})){
  demand(SHA.test(sha||'')&&m[key]?.sha256===sha,'FORMAL_REPAIR_SCOPED_HISTORY_REQUIRED');v.bytes(root,m[key]);
 }
 const proof=v.json(root,m.sourceDiscovery),index=v.json(root,m.originalIndex);
 demand(proof.schema==='reader-source-preflight-v1'&&proof.status==='source_ready_for_ocr'&&
  proof.sourceArchiveSha256MatchesPinned===true&&proof.bookId===book.bookId&&same(proof.range,book.range)&&
  proof.sourceArchiveSha256===book.sourceArchiveSha256&&Array.isArray(proof.rangeImages)&&
  proof.rangeImages.length===book.range[1]-book.range[0]+1&&
  proof.rangeImages.every(x=>index[x.scan]===x.sha256),'FORMAL_REPAIR_SOURCE_PROOF_MISMATCH');
 const verdict=v.validateBundle(manifestPath,{phase:'prepare'});
 demand(verdict.eligible,'FORMAL_REPAIR_PREPARE_NOT_PASSED: '+verdict.errors.join('; '));
 return {kind:'formal',root,m,proof,verdict,manifestSha256:v.hash(raw)};
}
function buildFormalPlan(book,context){
 const c=catalog(),defects=classifyDefects(book.knownDefects,c.checks),tasks=defects.work.slice(),waitingTasks=defects.waiting.slice();
 const completed=[];
 for(const row of c.checks){
  const checked=context.verdict.checks[row.id];
  if(['passed','not_applicable'].includes(checked.status)){completed.push(row.id);continue;}
  const task={id:'verify_requirement:'+row.id,type:row.taskType,checkId:row.id,lane:row.lane,priority:100,
   reason:row.action,requirement:row.action,completionEvidence:row.completionEvidence,blockedBy:[],recorded:false};
  (EXTERNAL_LANES.has(row.lane)?waitingTasks:tasks).push(task);
 }
 if(!tasks.length&&!waitingTasks.length)tasks.push({id:'run_canonical_60_and_handoff_gate',type:'run_canonical_60_and_handoff_gate',
  lane:'reporting',priority:500,reason:'Run the unchanged final device, canonical sixty and fresh public-HTTP gate; preparation alone never authorizes delivery.',blockedBy:[],recorded:false});
 tasks.sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id));
 return {schema:'reader-repair-plan-v3',status:tasks.length?'work_ready':'waiting',bookId:book.bookId,range:book.range,profile:book.profile,
  manifestSha256:context.manifestSha256,workingDraftSha256:book.currentWork.artifactSha256,
  originalPublishedArtifactSha256:null,workingDraftIsDistinctFromPublished:false,workingArtifactOrigin:'currentWork',adoptionRequired:false,
  evidenceMode:'formal_canonical',originalReaderStillBlocked:book.releaseStatus==='blocked',releaseEligible:false,
  canonicalPreparationReady:true,counts:{completedCanonicalChecks:completed.length,unresolvedSourceDefects:defects.source.length,
   unresolvedLedgerDefects:(book.knownDefects||[]).filter(x=>x.status!=='resolved').length,externalWaitingDefects:defects.waiting.length},
  tasks,readyTasks:tasks,deferredTasks:[],waitingTasks,
  queues:Object.fromEntries(LANES.map(lane=>[lane,[...tasks,...waitingTasks].filter(t=>t.lane===lane)])),
  remainingWorkItems:tasks.length,nextAction:tasks[0]||null,errors:[],warnings:[],
  retainedEvidence:{artifactSha256:book.artifactSha256,completedCanonicalCheckIds:completed,completedSubchecks:[],
   scopedHistory:{reviewSha256:book.currentWork.retainedScopedReviewSha256,assessmentSha256:book.currentWork.retainedScopedAssessmentSha256,
    manifestSha256:book.currentWork.adoptedManifestSha256},formalPreparation:{eligible:true,phase:'prepare',checks:context.verdict.checks},
   normalReleaseAuthorized:false},
  note:'The existing formal preparation verifier accepted the new evidence. Device, storage and publication gates still determine final delivery.'};
}
module.exports={LANES,SOURCE_LANES,EXTERNAL_LANES,hasScopedState,hasRetainedCanonicalState,catalog,defectLane,classifyDefects,loadContext,buildPlan,inspectFormalContext};
