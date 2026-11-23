'use strict';
// SYNTHETIC contract fixtures only. These records are not observations, source
// reviews, user consent, real device checks, or evidence about an actual book.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const v=require('../tools/reader-release-control.cjs'),pipe=require('../tools/reader-private-pipeline.cjs');
const scoped=require('../tools/reader-scoped-review.cjs'),{RULES}=require('../tools/reader-quality-gate.cjs');
const {plan}=require('../tools/reader-repair-plan.cjs');
const state=require('../tools/reader-repair-state.cjs'),{transition}=require('../tools/reader-repair-transition.cjs');
const {finalize}=require('../tools/reader-repair-finalize.cjs');
const {validate}=require('../tools/reader-work-ledger-validate.cjs');
const AT='2026-01-01T00:00:00Z';
function fixture(t,{blank=false,revision=''}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-repair-context-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bundle=path.join(root,'bundle');
 const put=(rel,value)=>{const f=path.join(root,rel);fs.mkdirSync(path.dirname(f),{recursive:true});
  fs.writeFileSync(f,Buffer.isBuffer(value)?value:typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');return f;};
 const ref=(rel,value)=>{const f=put('bundle/'+rel,value);return{path:rel,sha256:v.hash(fs.readFileSync(f))};};
 const captured=require('./fixtures/reader-repair-page.json')[blank?'blank':'text'];
 const image=Buffer.from(captured.originalPng,'base64'),sourceSha=v.hash(image),text=blank?'':'合成本文。';
 const book={bookId:'synthetic-shared-work',range:[1,1],pages:[{scan:1,sha256:sourceSha,width:112,height:34,
  dataUrl:'data:image/png;base64,'+image.toString('base64'),blocks:blank?[]:[{id:'body-1',kind:'body',text}],figures:[]}]};
 const model={model_schema:'reader-logical-stream-v1',book_id:book.bookId,body_char_count:Array.from(text).length,
  segments:blank?[]:[{id:'body-1',text}],heading_inventory_binding:{inventory_sha256:'a'.repeat(64),approval_sha256:'b'.repeat(64)}};
 const html=put('input.html','<!doctype html><script id="bookdata" type="application/json">'+JSON.stringify(book)+'</script>'+
  '<p id="proof-text" style="margin:4px;font:20px sans-serif"></p><script>document.getElementById("proof-text").textContent=JSON.parse(document.getElementById("bookdata").textContent).pages[0].blocks.map(b=>b.text).join("")</script>'+
  '<script id="reader-verified-structure">window.readerVerifiedStructure='+JSON.stringify({model})+';</script>'+revision);
 const m=pipe.init(html,bundle,book.bookId,put('loader.html','synthetic generic loader'),put('index.json',{'1':sourceSha}));
 const manifest=path.join(bundle,'manifest.json'),save=()=>put('bundle/manifest.json',m);
 m.rubyCoverageInventory=ref('ruby-inventory.json',{schema:'reader-ruby-inventory-v1',bookId:book.bookId,range:book.range,pages:[{
  scan:1,candidateSource:'visual-only',baseline:ref('ruby-before.json',book.pages[0]),
  review:ref('ruby-review.json',{scan:1,sourceSha256:sourceSha,visualReview:'complete',method:'Synthetic whole-original inspection',
   annotations:[],corrections:[],candidates:[],unresolved:[]})}]});
 m.genuineRawArchive=ref('genuine-raw.json',{synthetic:'separate original OCR fixture'});
 m.sourceDiscovery=ref('source-proof.json',{schema:'reader-source-preflight-v1',status:'source_ready_for_ocr',bookId:book.bookId,range:book.range,
  sourceArchiveSha256:v.hash('synthetic source archive'),sourceArchiveSha256MatchesPinned:true,folderListingComplete:true,
  canonical60Certified:false,releaseEligible:false,errors:[],rangeImages:[{scan:1,sha256:sourceSha}]});
 const review=ref('comparison.json',{reviewer:'synthetic-reviewer',scan:1,sha:sourceSha,status:'source_verified',blocks:book.pages[0].blocks,
  blank,observed:true});
 m.scopedReview=ref('scoped-review.json',{schema:'reader-scoped-source-review-v1',bookId:book.bookId,range:book.range,
  artifactSha256:m.artifact.sha256,canonicalSha256:m.canonical.sha256,state:'reviewed_partial_canonical',
  fullIndependentSecondTranscription:false,sourceQAComplete:false,sourceReviewTruthAuthenticated:false,
  replaySeedMeaning:'reviewed_canonical_snapshot',rawArchive:m.genuineRawArchive,comparedScans:[1],uncomparedScans:[],additionalEvidence:[],
  comparisons:[{id:'synthetic-comparison',kind:blank?'source_blank_comparison':'source_text_comparison',scan:1,sourceImageSha256:sourceSha,
   independentFullTranscription:false,evidence:review,scanPointer:'/scan',sourceShaPointer:'/sha',reviewerPointer:'/reviewer',statusPointer:'/status',
   blankPagePointer:'/blank',sourceObservedPointer:'/observed',bindings:[{evidencePointer:'/blocks',canonicalPointer:'/pages/0/blocks'}]}]});
 m.previewDisplay=ref('preview-display.json',{schema:'reader-preview-display-v1',artifactSha256:m.artifact.sha256,status:'not_run',history:[]});
 function assess({subchecks=false}={}){
  const checks=Object.fromEntries(RULES.map(id=>[id,{status:['G1-01','G1-02'].includes(id)?'passed':'not_run'}]));m.checks=ref('checks.json',checks);
  const a={schema:'private-quality-assessment-60-v1',scope:{bookId:book.bookId,sourceRange:book.range},artifact:{sha256:m.artifact.sha256},
   conclusion:{sourceQAComplete:false,all60Passed:false,readerComplete:false,iphoneConfirmed:false,releaseApproved:false},
   checks:RULES.map(id=>({id,status:checks[id].status,remainingRequirements:checks[id].status==='passed'?[]:['Synthetic remaining requirement '+id]})),
   statusCounts:{passed:2,not_run:58},sourceReviewSummary:scoped.validateSource(bundle,m,book.pages,{'1':sourceSha}),
   display24:scoped.validateDisplay(bundle,m),notPerformed:{iphoneChrome:'not_run',browser24Conditions:'not_run'}};
  if(a.display24.status!=='not_run')a.notPerformed.browser24Conditions='performed_all_24_conditions';
  if(subchecks){const c=a.checks.find(x=>x.id==='G7-01');c.completedSubchecks=[{id:'fixed-viewport',status:'passed',scope:'Synthetic all-page fixed-viewport observation',evidence:[v.json(bundle,m.previewDisplay).report]}];
   c.remainingRequirements=['Synthetic rotation requirement','Synthetic zoom and pan requirement'];}
  m.assessment=ref('assessment.json',a);save();return a;
 }
 assess();
 const ledger={schema:'reader-work-ledger-v1',ruleset:'20261116_0654_60-items',version:1,books:[{bookId:book.bookId,range:book.range,
  profile:'text',sourceArchiveSha256:v.json(bundle,m.sourceDiscovery).sourceArchiveSha256,artifactSha256:m.artifact.sha256,
  qualityState:'unverified',releaseStatus:'blocked',retainedReviewState:'reviewed_canonical_with_scoped_source_reviews',knownDefects:[]}],history:[]};
 function progress(){return {schema:'reader-repair-progress-v2',bookId:book.bookId,range:book.range,profile:'text',artifactSha256:m.artifact.sha256,
  pages:blank?[]:[{scan:1,sourceImageSha256:sourceSha,inventory:{status:'source_verified',sourceImageSha256:sourceSha,
   evidenceSha256:review.sha256,reviewedBy:'synthetic-reviewer',width:112,height:34,hasReadableText:true,allRegionsInventoried:true},
   regions:[{id:'body-1',kind:'body',box:[0,0,112,34],sourceImageSha256:sourceSha,
    transcription:{firstRunId:'synthetic-first',secondRunId:'synthetic-second',secondSawFirstPass:false,
     firstTextSha256:v.hash(text),secondTextSha256:v.hash(text),sourceImageSha256:sourceSha},
    comparison:{status:'resolved_against_source',evidenceSha256:review.sha256,sourceImageSha256:sourceSha,reviewedBy:'synthetic-reviewer'}}]}],
  boundaries:[0,1].map(left=>({left,right:left+1,status:'source_verified',evidenceSha256:review.sha256,reviewedBy:'synthetic-reviewer',
   leftSourceSha256:sourceSha,rightSourceSha256:sourceSha})),bridges:[]};}
 function observe(){
  const conditions=scoped.conditionPlan().map(p=>({...p,page_count:1,visited_pages:[0],completed:true,issues:[],image_pages:[],
   body_expected_char_count:model.body_char_count,body_observed_char_count:model.body_char_count,
   body_fragments:blank?[]:[{page_index:0,body_id:'body-1',start:0,end:model.body_char_count,text}]}));
  const binding={html_sha256:m.artifact.sha256,model_sha256:v.objHash(model),...model.heading_inventory_binding};
  const obs={schema:'reader-heading-dom-observations-v1',collector:'heading-dom-probe-v1',...binding,conditions:conditions.map(c=>({
   id:c.id,viewport_width:c.viewport_width,viewport_height:c.viewport_height,body_font_px:c.body_font_px,page_count:1,visited_pages:[0],completed:true,errors:[]}))};
  const modelRef=ref('observations/model.json',model),obsRef=ref('observations/headings.json',obs);
  const report=ref('observations/report.json',{schema:'reader-browser-qa-v1',user_agent:'SYNTHETIC FIXTURE NO ACTUAL BROWSER',started_at:AT,finished_at:AT,
   files:{html:{sha256:m.artifact.sha256},model:{sha256:modelRef.sha256,canonical_sha256:v.objHash(model)}},binding,condition_plan:scoped.conditionPlan(),
   completed_conditions:24,issue_count:0,fatal_error:null,conditions,heading_observations:obs});
  const d={schema:'reader-preview-display-v1',artifactSha256:m.artifact.sha256,status:'completed_passed',history:[],report,observations:obsRef,model:modelRef,
   canonicalBookdata:ref('observations/canonical.json',{synthetic:true}),inventory:ref('observations/inventory.json',{synthetic:true}),approval:ref('observations/approval.json',{synthetic:true})};
  d.headingAudit=ref('observations/audit.json',{schema:'heading-release-audit-v1',status:'heading_release_evidence_consistent',eligible_on_heading_evidence:true,
   errors:[],source_bytes_matched:true,required_conditions:scoped.conditionPlan(),book_id:book.bookId,source_scan_numbers:[1],model_sha256:v.objHash(model),
   artifact_sha256:{html:m.artifact.sha256,observations:obsRef.sha256,canonical_bookdata:d.canonicalBookdata.sha256,inventory:d.inventory.sha256,approval:d.approval.sha256}});
  m.previewDisplay=ref('preview-display-complete.json',d);assess({subchecks:true});
 }
 function formalize(){
  m.retainedScopedManifest=ref('history/scoped-manifest.json',fs.readFileSync(manifest));
  m.retainedScopedReview=m.scopedReview;m.retainedScopedAssessment=m.assessment;delete m.scopedReview;
  const fields=v.textFields(book.pages),subject={bookId:m.bookId,range:m.range,artifactSha256:m.artifact.sha256,canonicalSha256:m.canonical.sha256,
   rawSha256:m.raw.sha256,originalIndexSha256:m.originalIndex.sha256,templateSha256:m.template.sha256,profileSha256:m.profile.sha256,loaderSha256:m.loaderSha256};
  m.inventory=ref('formal/inventory.json',{pages:[{scan:1,sourceSha256:sourceSha,reviewedBy:'synthetic-first',secondReviewer:'synthetic-second',
   firstPassId:'one',secondPassId:'two',edgesChecked:true,secondViewedFirst:false,width:112,height:34,
   regions:blank?[]:[{id:'body',kind:'body',box:[0,0,112,34],fields:Object.keys(fields)}]}]});
  const scopes=require('../tools/reader-proof-batches.cjs').scopes;
  const source={scan:1,sourceSha256:sourceSha,completeScopes:scopes};
  const imageRef=ref('formal/source.png',image);
  const census=ref('formal/proof-census.json',{...source,reviewedBy:'synthetic source census',edgesChecked:true,
   regions:blank?[]:[{id:'body-1',scope:'body',box:[3,3,104,29]}]});
  const reading=ref('formal/proof-reading.json',{...source,reviewedBy:'synthetic independent reading',blindToOutput:true,
   regions:blank?[]:[{id:'body-1',state:'matched',value:{text:'合成本文。'}}]});
  assert.equal(captured.artifactSha256,m.artifact.sha256,'the stored Chromium readback is for these exact fixture bytes');
  const capture=ref('formal/browser.png',Buffer.from(captured.capturePng,'base64'));
  const readback=ref('formal/proof-readback.json',{schema:'reader-proof-readback-v1',bookId:book.bookId,range:book.range,
   artifactSha256:captured.artifactSha256,pages:[{...source,capture:{path:'browser.png',sha256:capture.sha256},regions:captured.regions}]});
  m.proofInventory=ref('proof-inventory.json',{schema:'reader-proof-inventory-v1',bookId:book.bookId,range:book.range,readback,
   pages:[{scan:1,image:imageRef,census,review:reading}]});
  require('./fixtures/reader-caption-production.cjs').addCaptionProof(bundle,m,{image:imageRef,width:112,height:34});
  m.second=ref('formal/second.json',{runId:'synthetic-blind-second',viewedFirst:false,sourceIndexSha256:m.originalIndex.sha256,
   method:'synthetic independent source fixture',reviewedBy:'synthetic-second',fields});
  m.resolutions=ref('formal/resolutions.json',{openIssues:[],differences:[],alerts:[],numbers:[]});
  m.boundaries=ref('formal/boundaries.json',{items:[{id:'0>1',kind:'book_start',leftSourceSha256:null,rightSourceSha256:sourceSha},
   {id:'1>2',kind:'book_end',leftSourceSha256:sourceSha,rightSourceSha256:null}].map(x=>({...x,reviewedBy:'synthetic-reviewer',reason:'synthetic book edge fixture',resolved:true,leftTail:'',rightHead:''}))});
  m.display=ref('formal/display.json',{artifactSha256:m.artifact.sha256,actualPixels:true,fields,
   conditions:[320,390,430].flatMap(width=>[16,18,20,22,24,26,28,30].map(fontPx=>({width,fontPx,passed:true,
    artifactSha256:m.artifact.sha256,actualPixels:true,scans:[1],overflowCount:0,roundTripSha256:v.objHash(fields)})))});
  const checks={};
  function evidence(id,extra={}){checks[id]={status:'passed',evidence:ref('formal/evidence/'+id+'.json',{checkId:id,
   artifactSha256:m.artifact.sha256,subjectSha256:v.objHash(subject),reviewedBy:'synthetic-only',result:'passed',
   method:'synthetic contract fixture; no actual review',at:AT,scans:[1],...extra})};m.checks=ref('formal/checks.json',checks);save();}
  for(const id of RULES)if(['G8-03','G8-04','G8-08'].includes(id))checks[id]={status:'not_run'};else evidence(id);
  m.checks=ref('formal/checks.json',checks);save();return {evidence,checks};
 }
 return {root,bundle,manifest,m,book,sourceSha,ledger,put,ref,save,progress,observe,formalize,
  run:(l=ledger,p=null)=>plan(l,book.bookId,p,{manifestFile:manifest})};
}
function adoptAndAdvance(f){
 let r=state.adoptCurrent(f.ledger,f.book.bookId,f.manifest,AT);assert.equal(r.ok,true,r.errors.join(','));
 for(const stage of ['second_pass_in_progress','second_pass_completed','source_resolved','awaiting_canonical_60']){
  r=state.advance(r.ledger,f.book.bookId,f.run(r.ledger,f.progress()),v.hash('synthetic repair progress '+stage),stage,AT);
  assert.equal(r.ok,true,r.errors.join(','));
 }
 return r.ledger;
}
test('scoped canonical resumes without preview consent, preserves passed scope, and never requests first pass',t=>{
 const f=fixture(t);f.observe();const before=fs.readFileSync(f.manifest),ledgerBefore=JSON.stringify(f.ledger),r=f.run();
 assert.equal(r.status,'work_ready');assert.equal(r.workingArtifactOrigin,'retained_reviewed_canonical');assert.equal(r.adoptionRequired,true);
 assert.equal(r.nextAction.type,'inventory_source_page_regions');assert.equal(r.counts.layoutConditionsPreviouslyReported,24);
 assert.equal(r.retainedEvidence.completedSubchecks.length,1);
 assert.deepEqual(r.tasks.filter(x=>x.checkId==='G7-01').map(x=>x.requirement).sort(),['Synthetic rotation requirement','Synthetic zoom and pan requirement'].sort());
 assert.ok(!r.tasks.some(x=>x.type==='produce_new_private_first_pass'));
 assert.equal(r.releaseEligible,false);assert.equal(f.m.previewAuthorization,undefined);
 assert.deepEqual(fs.readFileSync(f.manifest),before);assert.equal(JSON.stringify(f.ledger),ledgerBefore);
});
test('scoped metadata without exact manifest blocks context rather than restarting first pass',t=>{
 const f=fixture(t),r=plan(f.ledger,f.book.bookId);
 assert.equal(r.status,'blocked');assert.ok(r.errors.includes('SCOPED_REPAIR_MANIFEST_REQUIRED'));assert.equal(r.nextAction,null);
 f.ledger.books[0].artifactSha256='0'.repeat(64);assert.match(f.run().errors.join('|'),/MANIFEST_IDENTITY_MISMATCH/);
});
test('legacy independent-review canonical requires context migration, never another first pass',t=>{
 const f=fixture(t),book=f.ledger.books[0];delete book.retainedReviewState;delete f.m.scopedReview;f.save();
 book.sourceReviewStatus='two_independent_transcriptions_reconciled_against_source';
 const missing=plan(f.ledger,book.bookId);assert.equal(missing.status,'blocked');assert.ok(missing.errors.includes('EXISTING_CANONICAL_MANIFEST_REQUIRED'));
 const r=f.run();assert.equal(r.status,'blocked');assert.equal(r.nextAction.type,'connect_existing_canonical_context');
 assert.equal(r.retainedEvidence.retainedLedgerReviewStatus,book.sourceReviewStatus);
 assert.equal(r.tasks.some(t=>t.type==='produce_new_private_first_pass'),false);
 assert.equal(state.adoptCurrent(f.ledger,book.bookId,f.manifest,AT).ok,false,'legacy review is not relabeled as scoped partial');
});
test('direct start cannot bypass retained private canonical context; reviewed edition revision stays allowed',t=>{
 const f=fixture(t),book=f.ledger.books[0],before=JSON.stringify(f.ledger);
 let r=state.startDraft(f.ledger,book.bookId,'f'.repeat(64),'e'.repeat(64),1,AT);
 assert.equal(r.ok,false);assert.ok(r.errors.includes('RETAINED_CANONICAL_REQUIRES_CONTEXT_ADOPTION'));
 assert.equal(JSON.stringify(f.ledger),before);
 delete book.retainedReviewState;book.sourceReviewStatus='two_independent_transcriptions_reconciled_against_source';
 r=state.startDraft(f.ledger,book.bookId,'f'.repeat(64),'e'.repeat(64),1,AT);
 assert.equal(r.ok,false);assert.ok(r.errors.includes('RETAINED_CANONICAL_REQUIRES_CONTEXT_ADOPTION'));
 book.qualityState='reviewed';book.releaseStatus='candidate';
 r=state.startDraft(f.ledger,book.bookId,'f'.repeat(64),'e'.repeat(64),1,AT);
 assert.equal(r.ok,true,r.errors.join(','));assert.equal(r.ledger.books[0].artifactSha256,book.artifactSha256);
});
test('source identity, altered canonical and retained subcheck bytes fail closed',t=>{
 const f=fixture(t);f.ledger.books[0].sourceArchiveSha256='0'.repeat(64);assert.match(f.run().errors.join('|'),/SOURCE_ARCHIVE_MISMATCH/);
 const g=fixture(t);g.observe();const d=v.json(g.bundle,g.m.previewDisplay);fs.appendFileSync(path.join(g.bundle,d.report.path),' ');
 assert.equal(g.run().status,'blocked');
 const h=fixture(t);const p=h.progress();p.pages[0].sourceImageSha256='0'.repeat(64);assert.match(h.run(h.ledger,p).errors.join('|'),/PROGRESS_SOURCE_MISMATCH/);
 const k=fixture(t),changed=v.json(k.bundle,k.m.canonical);changed.pages[0].blocks[0].text+='改変';
 k.m.canonical=k.ref('changed-canonical.json',changed);k.save();assert.match(k.run().errors.join('|'),/CANONICAL_CHANGED/);
});
test('independent transcript is a typed prerequisite rather than full G3-06 verdict dependency',t=>{
 const f=fixture(t),before=f.run(),after=f.run(f.ledger,f.progress());
 assert.ok(before.deferredTasks.some(x=>x.checkId==='G3-07'&&x.blockedBy.includes('independent_second_transcription')));
 assert.ok(after.readyTasks.some(x=>x.checkId==='G3-07'));assert.equal(after.retainedEvidence.assessment.statusCounts.not_run,58);
});
test('adopt-current then advance then re-plan retains immutable scoped pin and actual current role',t=>{
 const f=fixture(t),ledgerFile=f.put('ledger.json',f.ledger),before=fs.readFileSync(ledgerFile);
 let a=transition({ledger:ledgerFile,book:f.book.bookId,action:'adopt-current',manifest:f.manifest,expectedRevision:1,at:AT});
 assert.equal(a.ok,true,a.errors.join(','));assert.equal(a.ledger.books[0].artifactSha256,f.m.artifact.sha256);
 assert.equal(a.ledger.books[0].currentWork.reviewStatus,'retained_scoped_review');assert.equal(a.ledger.books[0].pendingDraft,undefined);
 assert.deepEqual(fs.readFileSync(ledgerFile),before);assert.deepEqual(validate(a.ledger).errors,[]);
 const adopted=f.put('adopted-ledger.json',a.ledger),progressFile=f.put('progress.json',f.progress());
 a=transition({ledger:adopted,book:f.book.bookId,action:'advance',manifest:f.manifest,progress:progressFile,
  expectedRevision:a.ledger.version,to:'second_pass_in_progress',at:AT});
 assert.equal(a.ok,true,a.errors.join(','));
 assert.equal(a.ledger.books[0].currentWork.retainedScopedReviewSha256,f.m.scopedReview.sha256);
 assert.notEqual(a.ledger.books[0].currentWork.latestPrivateRepairProgressSha256,f.m.scopedReview.sha256);
 assert.equal(f.run(a.ledger,f.progress()).status,'work_ready');
 assert.equal(state.startDraft(a.ledger,f.book.bookId,'f'.repeat(64),'e'.repeat(64),1,AT).ok,false);
});
test('delivery/device waits do not stop source resolution; unknown defects still do',t=>{
 const f=fixture(t);f.ledger.books[0].knownDefects=[{id:'artifact-specific-preview-consent-missing',status:'open'},
  {id:'iphone-device-confirmation-pending',status:'open'}];
 const l=adoptAndAdvance(f),r=f.run(l,f.progress());assert.equal(r.counts.unresolvedSourceDefects,0);
 assert.equal(r.counts.externalWaitingDefects,2);assert.ok(r.waitingTasks.length>=2);assert.equal(l.books[0].releaseStatus,'blocked');
 const g=fixture(t);g.ledger.books[0].knownDefects=[{id:'unknown-important-issue',status:'open',lane:'delivery'}];
 assert.equal(g.run(g.ledger,g.progress()).counts.unresolvedSourceDefects,1);
 let a=state.adoptCurrent(g.ledger,g.book.bookId,g.manifest,AT);
 for(const target of ['second_pass_in_progress','second_pass_completed']){
  a=state.advance(a.ledger,g.book.bookId,g.run(a.ledger,g.progress()),v.hash(target),target,AT);assert.equal(a.ok,true);
 }
 const stopped=state.advance(a.ledger,g.book.bookId,g.run(a.ledger,g.progress()),v.hash('synthetic'), 'source_resolved',AT);
 assert.equal(stopped.ok,false);assert.ok(stopped.errors.includes('SOURCE_DIFFS_BOUNDARIES_OR_DEFECTS_UNRESOLVED'));
});
test('retained blank source is real work without fabricated regions; unproved empty regions remain pending',t=>{
 const f=fixture(t,{blank:true}),r=f.run();assert.equal(r.counts.blankPagesRecorded,1);
 assert.ok(!r.tasks.some(x=>x.type==='inventory_source_page_regions'));
 const l=adoptAndAdvance(f);assert.equal(l.books[0].currentWork.independentSecondPass,'not_applicable_source_verified');
 const p=f.progress();p.pages=[{scan:1,sourceImageSha256:f.sourceSha,regions:[],inventory:{status:'source_verified',
  sourceImageSha256:f.sourceSha,evidenceSha256:'e'.repeat(64),reviewedBy:'synthetic',width:112,height:34,hasReadableText:false,allRegionsInventoried:true,blankPage:true}}];
 const bad=f.run(f.ledger,p);assert.equal(bad.counts.blankPagesRecorded,0);assert.ok(bad.tasks.some(x=>x.type==='inventory_source_page_regions'));
});
test('formal evidence transition requires real unchanged preparation gate and archived scoped evidence',t=>{
 const f=fixture(t),l=adoptAndAdvance(f);
 assert.equal(state.bindFormal(l,f.book.bookId,f.manifest,AT).ok,false,'active partial scoped evidence is not formal proof');
 f.formalize();
 const proof=f.m.proofInventory;
 delete f.m.proofInventory;f.save();
 const missing=v.validateBundle(f.manifest,{phase:'prepare'});assert.equal(missing.eligible,false);assert.match(missing.errors.join('|'),/BATCH_PROOF_PENDING/);
 f.m.proofInventory=proof;f.save();
 const prepared=v.validateBundle(f.manifest,{phase:'prepare'});assert.equal(prepared.eligible,true,prepared.errors.join(','));
 const b=state.bindFormal(l,f.book.bookId,f.manifest,AT);assert.equal(b.ok,true,b.errors.join(','));
 const r=f.run(b.ledger);assert.equal(r.evidenceMode,'formal_canonical');assert.equal(r.status,'waiting');
 assert.equal(r.counts.completedCanonicalChecks,57);assert.equal(r.waitingTasks.length,3);assert.equal(r.releaseEligible,false);
 f.m.retainedScopedReview.sha256='0'.repeat(64);f.save();assert.equal(f.run(b.ledger).status,'blocked');
});
test('current canonical revision preserves history without public fiction or old display reuse',t=>{
 const f=fixture(t);f.observe();const adopted=state.adoptCurrent(f.ledger,f.book.bookId,f.manifest,AT);
 const before=JSON.stringify(adopted.ledger),g=fixture(t,{revision:'<!-- synthetic new revision -->'});
 assert.equal(state.reviseCurrent(adopted.ledger,f.book.bookId,'0'.repeat(64),g.manifest,AT).ok,false);
 const changed=state.reviseCurrent(adopted.ledger,f.book.bookId,f.m.artifact.sha256,g.manifest,AT);
 assert.equal(changed.ok,true,changed.errors.join(','));assert.equal(JSON.stringify(adopted.ledger),before);
 const b=changed.ledger.books[0];assert.equal(b.artifactSha256,g.m.artifact.sha256);
 assert.equal(b.currentWork.reviewStatus,'retained_scoped_review');assert.equal(b.currentWork.chromiumLayoutChecksPassed,0);
 assert.equal(changed.ledger.history.at(-1).priorCanonicalWork.chromiumLayoutChecksPassed,24);
 assert.equal(changed.ledger.history.at(-1).priorPublicationAsserted,false);
 assert.equal(g.run(changed.ledger).nextAction.type,'inventory_source_page_regions');
 assert.deepEqual(validate(changed.ledger).errors,[]);
});
test('currentWork reaches unchanged final normal gate only with all device/storage/public evidence',t=>{
 const f=fixture(t),l=adoptAndAdvance(f),formal=f.formalize();
 let b=state.bindFormal(l,f.book.bookId,f.manifest,AT);assert.equal(b.ok,true,b.errors.join(','));
 const pub=f.put('synthetic-http.json',{schema:'reader-public-delivery-evidence-v1',eligible:true,checkedAt:AT,checks:[{
  bookId:f.book.bookId,status:'verified',httpStatus:200,expectedSha256:f.m.loaderSha256,observedSha256:f.m.loaderSha256,
  entry:'reader/synthetic-shared-work/index.html',url:'https://synthetic.invalid/reader/'}]});
 const options={expectedRevision:b.ledger.version,at:AT,artifact:path.join(f.bundle,f.m.artifact.path),manifest:f.manifest,
  sourceProof:path.join(f.bundle,f.m.sourceDiscovery.path),publicEvidence:pub};
 assert.equal(finalize(b.ledger,f.book.bookId,options).ok,false);
 formal.evidence('G8-08',{provider:'google-drive',fileId:'synthetic-file',readback:f.m.artifact});
 formal.evidence('G8-03',{deployedLoaderSha256:f.m.loaderSha256,deploymentSucceeded:true});
 formal.evidence('G8-04',{environment:{realDevice:true,device:'iPhone',browser:'Chrome',osVersion:'synthetic fixture'}});
 const out=finalize(b.ledger,f.book.bookId,options);assert.equal(out.ok,true,out.errors.join(','));
 assert.equal(out.completedDelivery,false);assert.equal(out.ledger.books[0].currentWork,undefined);
 assert.equal(out.ledger.history.at(-1).priorPublicationAsserted,false);
});
