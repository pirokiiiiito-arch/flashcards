'use strict';
// Private evidence validation for a scoped, unfinished canonical preview.
// No OCR, scan bytes, review text, or book-specific identities are published.
// This verifies bindings, not that a person really performed a visual review.
const SHA=/^[a-f0-9]{64}$/;
const STATES=new Set(['not_run','in_progress','observed_awaiting_audit','completed_passed','completed_failed','stopped_on_error']);
const SOURCE_KEYS=Object.freeze(['raw','canonical','originalIndex','corrections','lock','genuineRawArchive','sourceDiscovery','scopedReview','previewDisplay','assessment']);
const demand=(ok,code)=>{if(!ok)throw Error(code);};
function api(){return require('./reader-release-control.cjs');}
const same=(a,b)=>api().objHash(a)===api().objHash(b);
function pointer(value,ptr){
 demand(typeof ptr==='string'&&ptr.startsWith('/')&&ptr.length<=600,'SCOPED_REVIEW_POINTER_REQUIRED');
 for(const raw of ptr.slice(1).split('/')){
  demand(!/~(?![01])/u.test(raw),'SCOPED_REVIEW_POINTER_ESCAPE');
  const key=raw.replace(/~1/g,'/').replace(/~0/g,'~');
  demand(value!==null&&typeof value==='object'&&Object.hasOwn(value,key),'SCOPED_REVIEW_POINTER_MISSING');value=value[key];
 }return value;
}
function conditionPlan(){return [[320,740],[390,844],[430,930]].flatMap(([width,height])=>[16,18,20,22,24,26,28,30].map(font=>({id:width+'x'+height+'-font'+font,viewport_width:width,viewport_height:height,body_font_px:font})));}
function validateSource(root,m,pages,index){
 const v=api(),s=v.json(root,m.scopedReview),proof=v.json(root,m.sourceDiscovery),canonical=v.json(root,m.canonical);
 const document=Array.isArray(canonical)?{pages:canonical}:canonical;
 demand(s.schema==='reader-scoped-source-review-v1'&&s.bookId===m.bookId&&same(s.range,m.range)&&
  s.artifactSha256===m.artifact.sha256&&s.canonicalSha256===m.canonical.sha256,'SCOPED_REVIEW_IDENTITY_MISMATCH');
 demand(s.state==='reviewed_partial_canonical'&&s.fullIndependentSecondTranscription===false&&s.sourceQAComplete===false&&
  s.replaySeedMeaning==='reviewed_canonical_snapshot'&&s.sourceReviewTruthAuthenticated===false,'SCOPED_REVIEW_OVERCLAIM');
 demand(s.rawArchive?.sha256===m.genuineRawArchive?.sha256&&s.rawArchive?.path===m.genuineRawArchive?.path&&
  SHA.test(s.rawArchive?.sha256||'')&&![m.raw.sha256,m.canonical.sha256,m.artifact.sha256].includes(s.rawArchive.sha256),'SCOPED_REVIEW_RAW_ARCHIVE_SEPARATE_REQUIRED');
 v.bytes(root,s.rawArchive);
 demand(proof.schema==='reader-source-preflight-v1'&&proof.status==='source_ready_for_ocr'&&proof.bookId===m.bookId&&
  same(proof.range,m.range)&&proof.sourceArchiveSha256MatchesPinned===true&&proof.folderListingComplete===true&&
  SHA.test(proof.sourceArchiveSha256||'')&&proof.canonical60Certified===false&&proof.releaseEligible===false&&
  Array.isArray(proof.errors)&&!proof.errors.length,'SCOPED_REVIEW_SOURCE_PROOF_REQUIRED');
 const sourceMap=new Map((proof.rangeImages||[]).map(x=>[x.scan,x.sha256]));
 demand(sourceMap.size===pages.length&&pages.every(p=>sourceMap.get(p.scan)===index[p.scan]),'SCOPED_REVIEW_SOURCE_IMAGE_MISMATCH');
 demand(Array.isArray(s.comparisons)&&s.comparisons.length>0,'SCOPED_REVIEW_REAL_COMPARISON_REQUIRED');
 const ids=new Set(),scans=new Set(),blankScans=new Set(),bound=new Set();
 for(const r of s.comparisons){
  demand(typeof r.id==='string'&&r.id.length>=3&&!ids.has(r.id)&&['source_text_comparison','source_blank_comparison'].includes(r.kind),
   'SCOPED_REVIEW_COMPARISON_INVALID');ids.add(r.id);
  const pi=pages.findIndex(p=>p.scan===r.scan),p=pages[pi];
  demand(p&&r.sourceImageSha256===p.sha256&&r.independentFullTranscription===false,'SCOPED_REVIEW_COMPARISON_SCOPE');
  demand(r.evidence&&!['raw','canonical','artifact'].some(k=>r.evidence.sha256===m[k].sha256),'SCOPED_REVIEW_EVIDENCE_NOT_CANONICAL_COPY');
  const e=v.json(root,r.evidence);
  demand(pointer(e,r.scanPointer)===p.scan&&pointer(e,r.sourceShaPointer)===p.sha256,'SCOPED_REVIEW_SOURCE_BINDING');
  const reviewer=pointer(e,r.reviewerPointer),status=pointer(e,r.statusPointer);
  demand(typeof reviewer==='string'&&reviewer.trim().length>=2&&typeof status==='string'&&
   ['verified_source_text_and_structure','verified_direct_source_image_and_generated_text','verified_source_reading_text_and_structure',
    'verified_scoped_source_text_and_metadata','source_verified','reviewed','verified'].includes(status),'SCOPED_REVIEW_REVIEW_RECORD_REQUIRED');
  demand(Array.isArray(r.bindings)&&r.bindings.length>0,'SCOPED_REVIEW_TEXT_BINDING_REQUIRED');
  const blank=r.kind==='source_blank_comparison';
  if(blank){
   demand(pointer(e,r.blankPagePointer)===true&&pointer(e,r.sourceObservedPointer)===true&&
    Array.isArray(p.blocks)&&p.blocks.length===0&&Array.isArray(p.figures)&&p.figures.length===0&&
    !(p.reading_text||p.ocr),'SCOPED_REVIEW_BLANK_PAGE_NOT_PROVED');
   demand(r.bindings.length===1&&r.bindings[0].canonicalPointer==='/pages/'+pi+'/blocks','SCOPED_REVIEW_BLANK_BINDING_REQUIRED');
   blankScans.add(p.scan);
  }
  for(const b of r.bindings){
   const prefix='/pages/'+pi+'/';
   demand(typeof b.canonicalPointer==='string'&&b.canonicalPointer.startsWith(prefix)&&
    /^(?:blocks(?:\/\d+(?:\/(?:text|kind|ruby|id))?)?|figures\/\d+\/(?:caption|display_title|label)|title|reading_text|ocr)$/.test(b.canonicalPointer.slice(prefix.length)),
    'SCOPED_REVIEW_TEXT_POINTER_OUT_OF_SCOPE');
   const expected=pointer(e,b.evidencePointer),actual=pointer(document,b.canonicalPointer);
   demand(same(expected,actual),'SCOPED_REVIEW_TEXT_CHANGED');
   demand((typeof actual==='string'&&actual.length>0)||(Array.isArray(actual)&&(actual.length>0||blank))||
    (actual&&typeof actual==='object'&&!Array.isArray(actual)),'SCOPED_REVIEW_EMPTY_COMPARISON');
   bound.add(b.canonicalPointer);
  }scans.add(p.scan);
 }
 demand(Array.isArray(s.additionalEvidence),'SCOPED_REVIEW_ADDITIONAL_EVIDENCE_REQUIRED');
 for(const e of s.additionalEvidence){demand(typeof e.scope==='string'&&e.scope.length>=8,'SCOPED_REVIEW_EVIDENCE_SCOPE_REQUIRED');v.bytes(root,e.reference);}
 const reviewed=[...scans].sort((a,b)=>a-b),unreviewed=pages.map(p=>p.scan).filter(n=>!scans.has(n));
 demand(same(s.comparedScans,reviewed)&&same(s.uncomparedScans,unreviewed),'SCOPED_REVIEW_COVERAGE_MISMATCH');
 return {state:s.state,comparedScans:reviewed,uncomparedScans:unreviewed,blankComparisonScans:[...blankScans].sort((a,b)=>a-b),comparisonRecords:s.comparisons.length,
  boundCanonicalFields:bound.size,additionalEvidenceCount:s.additionalEvidence.length,
  fullIndependentSecondTranscription:false,sourceQAComplete:false,sourceReviewTruthAuthenticated:false,
  sourceArchiveScope:proof.sourceScope||'as_recorded_in_source_preflight',upstreamArchiveBytesVerified:proof.upstreamArchiveBytesVerified===true};
}
function bodyProblems(c,model){
 const errors=[],segments=new Map(model.segments.map(s=>[s.id,s])),ends=new Map(),order=[];let count=0;
 demand(Array.isArray(c.body_fragments),'PREVIEW_DISPLAY_BODY_FRAGMENTS_REQUIRED');
 for(const f of c.body_fragments){
  const s=segments.get(f.body_id);demand(s&&Number.isSafeInteger(f.page_index)&&c.visited_pages.includes(f.page_index)&&
   Number.isSafeInteger(f.start)&&Number.isSafeInteger(f.end)&&typeof f.text==='string','PREVIEW_DISPLAY_BODY_FRAGMENT_INVALID');
  const chars=Array.from(f.text),target=Array.from(s.text);count+=chars.length;
  if(!ends.has(f.body_id))order.push(f.body_id);
  if(f.start!==(ends.get(f.body_id)||0)||f.end<=f.start||f.end>target.length||f.end-f.start!==chars.length||
   target.slice(f.start,f.end).join('')!==f.text)errors.push('body_range_or_text_mismatch');
  ends.set(f.body_id,f.end);
 }
 if(c.body_observed_char_count!==count||c.body_expected_char_count!==model.body_char_count)errors.push('body_count_mismatch');
 if(c.completed===true&&(count!==model.body_char_count||!same(order,model.segments.map(s=>s.id))||
  model.segments.some(s=>ends.get(s.id)!==Array.from(s.text).length)))errors.push('completed_body_coverage_mismatch');
 return errors;
}
function validateDisplay(root,m){
 const v=api(),d=v.json(root,m.previewDisplay),plan=conditionPlan();
 demand(d.schema==='reader-preview-display-v1'&&d.artifactSha256===m.artifact.sha256&&STATES.has(d.status),
  'PREVIEW_DISPLAY_IDENTITY_OR_STATE');
 demand(Array.isArray(d.history),'PREVIEW_DISPLAY_HISTORY_REQUIRED');
 let priorSame=false;
 for(const ref of d.history){const old=v.json(root,ref);demand(old.schema==='reader-browser-qa-v1'&&SHA.test(old.files?.html?.sha256||''),'PREVIEW_DISPLAY_HISTORY_INVALID');if(old.files.html.sha256===m.artifact.sha256)priorSame=true;}
 if(d.status==='not_run'){
  demand(!d.report&&!d.observations&&!d.headingAudit&&!priorSame,'PREVIEW_DISPLAY_OBSERVATIONS_DOWNGRADED');
  return {status:'not_run',completedConditions:0,observedConditions:0,requiredConditions:24,issueCount:0,derivedIssueCount:0,
   fatalErrorRecorded:false,headingGatePassed:false,browserExecutionAuthenticated:false};
 }
 const report=v.json(root,d.report),observations=v.json(root,d.observations),model=v.json(root,d.model);
 demand(report.schema==='reader-browser-qa-v1'&&report.files?.html?.sha256===m.artifact.sha256&&
  report.binding?.html_sha256===m.artifact.sha256&&observations.schema==='reader-heading-dom-observations-v1'&&
  observations.collector==='heading-dom-probe-v1'&&observations.html_sha256===m.artifact.sha256,'PREVIEW_DISPLAY_WRONG_ARTIFACT_OR_COLLECTOR');
 demand(typeof report.user_agent==='string'&&report.user_agent.length>=10&&Number.isFinite(Date.parse(report.started_at||''))&&
  Number.isFinite(Date.parse(report.finished_at||''))&&Date.parse(report.finished_at)>=Date.parse(report.started_at),'PREVIEW_DISPLAY_EXECUTION_CONTEXT_REQUIRED');
 demand(model.model_schema==='reader-logical-stream-v1'&&Array.isArray(model.segments)&&Number.isSafeInteger(model.body_char_count)&&
  v.objHash(model)===report.binding.model_sha256&&observations.model_sha256===report.binding.model_sha256&&
  report.files.model.sha256===d.model.sha256&&report.files.model.canonical_sha256===v.objHash(model),'PREVIEW_DISPLAY_MODEL_BINDING');
 demand(observations.inventory_sha256===report.binding.inventory_sha256&&observations.approval_sha256===report.binding.approval_sha256&&
  observations.inventory_sha256===model.heading_inventory_binding?.inventory_sha256&&
  observations.approval_sha256===model.heading_inventory_binding?.approval_sha256,'PREVIEW_DISPLAY_HEADING_BINDING');
 const html=v.bytes(root,m.artifact).toString('utf8'),matches=[...html.matchAll(/<script\b(?=[^>]*\bid=["']reader-verified-structure["'])[^>]*>([\s\S]*?)<\/script\s*>/gi)];
 demand(matches.length===1,'PREVIEW_DISPLAY_EMBEDDED_MODEL_CHANGED');
 const script=matches[0][1].trim();
 // The supported reader stores JSON either directly or as exactly this one
 // assignment. Never evaluate arbitrary JavaScript from an imported book.
 let literal=script;
 if(script.startsWith('window.readerVerifiedStructure')){
  const assigned=script.match(/^window\.readerVerifiedStructure\s*=\s*(\{[\s\S]*\})\s*;?$/);
  demand(assigned,'PREVIEW_DISPLAY_UNSUPPORTED_MODEL_SCRIPT');literal=assigned[1];
 }
 demand(same(JSON.parse(literal).model,model),'PREVIEW_DISPLAY_EMBEDDED_MODEL_CHANGED');
 demand(same(report.heading_observations,observations)&&same(report.condition_plan,plan)&&
  Array.isArray(report.conditions)&&report.conditions.length>0&&report.conditions.length<=24&&
  Array.isArray(observations.conditions),'PREVIEW_DISPLAY_CONDITION_PLAN');
 let completed=0,issues=0,derivedIssues=0;const seen=new Set();
 for(let ci=0;ci<report.conditions.length;ci++){
  const c=report.conditions[ci],target=plan[ci];
  demand(Object.keys(target).every(k=>c[k]===target[k])&&!seen.has(c.id),'PREVIEW_DISPLAY_CONDITION_ID');seen.add(c.id);
  demand(Number.isSafeInteger(c.page_count)&&c.page_count>0&&Array.isArray(c.visited_pages)&&c.visited_pages.length<=c.page_count&&
   c.visited_pages.every((n,i)=>n===i)&&Array.isArray(c.issues)&&Array.isArray(c.image_pages),'PREVIEW_DISPLAY_PAGE_COVERAGE');
  demand(c.completed===(c.visited_pages.length===c.page_count),'PREVIEW_DISPLAY_COMPLETION_MISMATCH');
  const observed=observations.conditions.filter(x=>x.id===c.id);
  demand(observed.length===1&&Object.keys(target).every(k=>observed[0][k]===target[k])&&
   observed[0].page_count===c.page_count&&same(observed[0].visited_pages,c.visited_pages)&&
   observed[0].completed===c.completed&&Array.isArray(observed[0].errors),'PREVIEW_DISPLAY_HEADING_PAGE_COVERAGE');
  if(c.completed)completed++;
  issues+=c.issues.length;derivedIssues+=bodyProblems(c,model).length+observed[0].errors.length;
  for(const image of c.image_pages){demand(Number.isSafeInteger(image.page_index)&&c.visited_pages.includes(image.page_index)&&Array.isArray(image.issues),'PREVIEW_DISPLAY_IMAGE_PAGE_INVALID');derivedIssues+=image.issues.length;}
 }
 demand(observations.conditions.length===report.conditions.length&&report.completed_conditions===completed&&report.issue_count===issues,
  'PREVIEW_DISPLAY_COUNTS_MISMATCH');
 const fatal=typeof report.fatal_error==='string'&&report.fatal_error.length>0;
 demand(report.fatal_error===null||fatal,'PREVIEW_DISPLAY_FATAL_STATE_INVALID');
 let headingPassed=false;
 if(d.headingAudit){
  const a=v.json(root,d.headingAudit);demand(a.schema==='heading-release-audit-v1'&&a.artifact_sha256?.html===m.artifact.sha256&&
   a.artifact_sha256?.observations===d.observations.sha256&&a.model_sha256===v.objHash(model),'PREVIEW_DISPLAY_AUDIT_STALE');
  for(const [key,ref]of Object.entries({canonical_bookdata:d.canonicalBookdata,inventory:d.inventory,approval:d.approval})){
   demand(ref&&a.artifact_sha256[key]===ref.sha256,'PREVIEW_DISPLAY_AUDIT_INPUT_MISSING');v.bytes(root,ref);
  }
  headingPassed=a.eligible_on_heading_evidence===true&&a.status==='heading_release_evidence_consistent'&&
   a.source_bytes_matched===true&&Array.isArray(a.errors)&&!a.errors.length&&same(a.required_conditions,plan)&&
   a.book_id===m.bookId&&same(a.source_scan_numbers,Array.from({length:m.range[1]-m.range[0]+1},(_,i)=>m.range[0]+i));
 }
 const all=completed===24&&report.conditions.length===24;
 const status=fatal?'stopped_on_error':all?(issues+derivedIssues?'completed_failed':headingPassed?'completed_passed':'observed_awaiting_audit'):'in_progress';
 demand(d.status===status,'PREVIEW_DISPLAY_STATE_OVERCLAIM');
 return {status,completedConditions:completed,observedConditions:report.conditions.length,requiredConditions:24,
  issueCount:issues,derivedIssueCount:derivedIssues,fatalErrorRecorded:fatal,headingGatePassed:headingPassed,browserExecutionAuthenticated:false};
}
function validateAssessment(root,m,summary,display,rules){
 const a=api().json(root,m.assessment);
 demand(a.schema==='private-quality-assessment-60-v1'&&a.scope?.bookId===m.bookId&&same(a.scope.sourceRange,m.range)&&
  a.artifact?.sha256===m.artifact.sha256,'PREVIEW_V3_ASSESSMENT_IDENTITY');
 demand(['sourceQAComplete','all60Passed','readerComplete','iphoneConfirmed','releaseApproved'].every(k=>a.conclusion?.[k]===false),
  'PREVIEW_V3_ASSESSMENT_COMPLETION_OVERCLAIM');
 demand(Array.isArray(rules)&&rules.length===60&&Array.isArray(a.checks)&&
  same(a.checks.map(x=>x.id).sort(),rules.slice().sort())&&
  a.checks.every(x=>['passed','not_run','failed','needs_source_review','not_applicable'].includes(x.status)),
  'PREVIEW_V3_EXACT_ASSESSMENT_60_REQUIRED');
 const counts={};for(const c of a.checks)counts[c.status]=(counts[c.status]||0)+1;
 const states=Object.fromEntries(a.checks.map(c=>[c.id,c.status]));
 demand(['G3-06','G3-07'].every(id=>['not_run','failed','needs_source_review'].includes(states[id]))&&states['G8-04']==='not_run',
  'PREVIEW_V3_ASSESSMENT_INDEPENDENCE_OR_DEVICE_OVERCLAIM');
 if(['completed_failed','stopped_on_error'].includes(display.status))
  demand(!['passed','not_applicable'].includes(states['G7-01']),'PREVIEW_V3_FAILED_DISPLAY_MARKED_PASSED');
 demand(same(counts,a.statusCounts)&&same(a.sourceReviewSummary,summary)&&same(a.display24,display),'PREVIEW_V3_ASSESSMENT_STATE_MISMATCH');
 demand(a.notPerformed?.iphoneChrome==='not_run'&&
  (display.status==='not_run'?a.notPerformed?.browser24Conditions==='not_run':a.notPerformed?.browser24Conditions!=='not_run'),
  'PREVIEW_V3_PERFORMED_WORK_DOWNGRADED');
 const formal=api().json(root,m.checks);
 demand(same(Object.keys(formal).sort(),rules.slice().sort())&&a.checks.every(c=>formal[c.id]?.status===c.status),
  'PREVIEW_V3_FORMAL_ASSESSMENT_DIVERGENCE');
 return {statusCounts:counts,unresolvedIds:a.checks.filter(c=>['failed','needs_source_review'].includes(c.status)).map(c=>c.id)};
}
function validate(root,m,pages,index,rules){
 const source=validateSource(root,m,pages,index),display=validateDisplay(root,m),assessment=validateAssessment(root,m,source,display,rules);
 demand(SOURCE_KEYS.every(k=>SHA.test(m[k]?.sha256||'')),'PREVIEW_V3_SOURCE_REFERENCE_MISSING');
 return {source,display,assessment,sourceEvidenceIndex:Object.fromEntries(SOURCE_KEYS.map(k=>[k,m[k].sha256])),
  reviewState:{sourceTranscription:'reviewed_partial_canonical',fullSourceQA:'pending',canonical60:'incomplete',display24Conditions:display.status,iphone:'not_run'}};
}
module.exports={SOURCE_KEYS,STATES,conditionPlan,pointer,validateSource,validateDisplay,validateAssessment,validate};
