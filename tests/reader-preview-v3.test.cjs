'use strict';
// All evidence, images, text, and conversation below are SYNTHETIC fixtures.
// These tests are not source-reading, browser-execution, or user-consent proof.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const v=require('../tools/reader-release-control.cjs'),pipe=require('../tools/reader-private-pipeline.cjs');
const scoped=require('../tools/reader-scoped-review.cjs'),handoff=require('../tools/reader-unified-handoff.cjs');
const {RULES}=require('../tools/reader-quality-gate.cjs');
function fixture(t,{blank=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-scoped-preview-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const bundle=path.join(root,'bundle');
 function put(rel,value){const p=path.join(root,rel);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,Buffer.isBuffer(value)?value:typeof value==='string'?value:JSON.stringify(value,null,2)+'\n');return p;}
 function ref(rel,value){const p=put('bundle/'+rel,value);return {path:rel,sha256:v.hash(fs.readFileSync(p))};}
 const original=Buffer.from('synthetic image bytes, never a real original'),originalSha=v.hash(original);
 const body=blank?'':'非公開の合成本文。';
 const model={model_schema:'reader-logical-stream-v1',book_id:'synthetic-scoped',template_profile:'world_history_1',
  body_char_count:Array.from(body).length,body_text:body,segments:[{id:'body-one',text:body,logical_start_offset:0,logical_end_offset:Array.from(body).length}],
  layout_events:[],heading_inventory_binding:{inventory_sha256:'a'.repeat(64),approval_sha256:'b'.repeat(64)}};
 const book={bookId:'synthetic-scoped',range:[1,1],pages:[{scan:1,sha256:originalSha,width:10,height:10,
  dataUrl:'data:image/png;base64,'+original.toString('base64'),blocks:blank?[]:[{id:'body-one',kind:'body',text:body}],figures:[]}]};
 const input=put('reader.html','<!doctype html><script id="bookdata" type="application/json">'+JSON.stringify(book)+'</script>'+ 
  '<script id="reader-verified-structure">window.readerVerifiedStructure='+JSON.stringify({model})+';</script>');
 const loader=put('loader.html','<!doctype html><title>Synthetic loader only</title>');
 const sourceIndex=put('index.json',{'1':originalSha});
 const m=pipe.init(input,bundle,book.bookId,loader,sourceIndex),manifest=path.join(bundle,'manifest.json');
 m.genuineRawArchive=ref('retained/genuine-raw.json',{syntheticRawOCR:'別の未加工合成資料'});
 const sourceProof={schema:'reader-source-preflight-v1',status:'source_ready_for_ocr',bookId:book.bookId,range:book.range,
  sourceArchiveSha256:v.hash('synthetic archive'),sourceArchiveSha256MatchesPinned:true,folderListingComplete:true,
  canonical60Certified:false,releaseEligible:false,requestReupload:false,errors:[],sourceScope:'synthetic_contract_fixture',
  rangeImages:[{scan:1,sha256:originalSha}],upstreamArchiveBytesVerified:false};
 m.sourceDiscovery=ref('source-proof.json',sourceProof);
 const review=ref('retained/comparison.json',{reviewer:'synthetic-reviewer-private-marker',pages:[{scan:1,
  sourceSha256:originalSha,status:'source_verified',blocks:book.pages[0].blocks,blankPage:blank,sourceObserved:true}]});
 const scope={schema:'reader-scoped-source-review-v1',bookId:book.bookId,range:book.range,artifactSha256:m.artifact.sha256,
  canonicalSha256:m.canonical.sha256,state:'reviewed_partial_canonical',fullIndependentSecondTranscription:false,
  sourceQAComplete:false,replaySeedMeaning:'reviewed_canonical_snapshot',sourceReviewTruthAuthenticated:false,
  rawArchive:m.genuineRawArchive,comparedScans:[1],uncomparedScans:[],additionalEvidence:[],comparisons:[{
   id:'synthetic-comparison-one',kind:blank?'source_blank_comparison':'source_text_comparison',scan:1,sourceImageSha256:originalSha,
   independentFullTranscription:false,evidence:review,scanPointer:'/pages/0/scan',sourceShaPointer:'/pages/0/sourceSha256',
   reviewerPointer:'/reviewer',statusPointer:'/pages/0/status',blankPagePointer:'/pages/0/blankPage',sourceObservedPointer:'/pages/0/sourceObserved',
   bindings:[{evidencePointer:'/pages/0/blocks',canonicalPointer:'/pages/0/blocks'}]}]};
 m.scopedReview=ref('review/scope.json',scope);
 m.previewDisplay=ref('review/display.json',{schema:'reader-preview-display-v1',artifactSha256:m.artifact.sha256,status:'not_run',history:[]});
 function save(){put('bundle/manifest.json',m);}
 function assess(){
  const sourceSummary=scoped.validateSource(bundle,m,book.pages,{'1':originalSha}),display=scoped.validateDisplay(bundle,m);
  const a={schema:'private-quality-assessment-60-v1',scope:{bookId:book.bookId,sourceRange:book.range},artifact:{sha256:m.artifact.sha256},
   conclusion:{sourceQAComplete:false,all60Passed:false,readerComplete:false,iphoneConfirmed:false,releaseApproved:false},
   checks:RULES.map(id=>({id,status:'not_run'})),statusCounts:{not_run:60},sourceReviewSummary:sourceSummary,display24:display,
   notPerformed:{iphoneChrome:'not_run',...(display.status==='not_run'?{browser24Conditions:'not_run'}:{})}};
  m.assessment=ref('review/assessment.json',a);save();return a;
 }
 assess();
 function conversation(){
  const verified=scoped.validate(bundle,m,book.pages,{'1':originalSha},RULES);
  return {schema:'preview-conversation-acceptance-evidence-v2',bookId:book.bookId,range:book.range,
   artifact:{sha256:m.artifact.sha256},loader:{sha256:m.loaderSha256},normalReleaseAuthorizedByThisReply:false,
   userReplyExact:'確認用url',acceptanceBasis:'Synthetic contract fixture only; no actual user acceptance is asserted.',
   recordedAtUTC:'2026-01-01T00:00:00Z',timestampMeaning:'Synthetic record time for this isolated contract fixture only.',
   assistantDisclosure:{exactQuestion:'合成契約試験の未完成確認版を受け取りますか。',visibleIdentity:'1〜1 '+m.artifact.sha256.slice(0,12),
    disclosedRemainingChecks:['独立全文二稿と正式60検査、iPhoneは未確認'],disclosedState:verified.reviewState,
    disclosedSourceScope:verified.source,disclosedDisplayState:verified.display,disclosedAssessmentSha256:m.assessment.sha256,
    disclosedAssessmentCounts:verified.assessment.statusCounts}};
 }
 function authorize(change=x=>x){
  const c=conversation();change(c);const cfile=put('synthetic-conversation.json',c);
  pipe.authorizePreviewV3(manifest,cfile,path.join(bundle,m.assessment.path));Object.assign(m,JSON.parse(fs.readFileSync(manifest)));
  return path.join(bundle,m.previewAuthorization.path);
 }
 function ledger(pending=true){
  const b={bookId:book.bookId,range:book.range,sourceArchiveSha256:sourceProof.sourceArchiveSha256,
   artifactSha256:pending?v.hash('synthetic prior reviewed baseline'):m.artifact.sha256,profile:'world_history_1',qualityState:'unverified',
   releaseStatus:'blocked',knownDefects:[{id:'independent-second-pending',status:'needs_source_review'}]};
  if(pending)b.pendingDraft={artifactSha256:m.artifact.sha256,reviewStatus:'visual_first_pass_only',deliveryStatus:'private_staging_blocked',
   independentSecondPass:'not_run',realIPhone:'not_run',privateProgressReportSha256:m.scopedReview.sha256,
   sourceJPEGSHAverified:1,chromiumLayoutChecksPassed:0};
  return put('ledger.json',{schema:'reader-work-ledger-v1',ruleset:'20261116_0654_60-items',books:[b]});
 }
 function options(){return {mode:'preview',artifact:path.join(bundle,m.artifact.path),manifest,ledger:ledger(),
  sourceProof:path.join(bundle,m.sourceDiscovery.path),previewConsent:path.join(bundle,m.previewAuthorization.path),
  previewTargetArtifactSha256:m.artifact.sha256};}
 function setObserved({count=1,fatal=null,completeAudit=false,mutate=()=>{}}={}){
  const plan=scoped.conditionPlan(),cs=plan.slice(0,count).map(p=>({...p,page_count:1,visited_pages:[0],completed:true,
   body_expected_char_count:model.body_char_count,body_observed_char_count:model.body_char_count,issues:[],image_pages:[],
   body_fragments:[{page_index:0,body_id:'body-one',start:0,end:model.body_char_count,text:body}]}));
  const binding={html_sha256:m.artifact.sha256,model_sha256:v.objHash(model),...model.heading_inventory_binding};
  const obs={schema:'reader-heading-dom-observations-v1',collector:'heading-dom-probe-v1',...binding,
   conditions:cs.map(c=>({id:c.id,viewport_width:c.viewport_width,viewport_height:c.viewport_height,body_font_px:c.body_font_px,
    page_count:1,visited_pages:[0],completed:true,errors:[],fragments:[],body_anchors:[]}))};
  const modelRef=ref('observations/model.json',model);
  const report={schema:'reader-browser-qa-v1',user_agent:'SYNTHETIC CONTRACT FIXTURE NO BROWSER',started_at:'2026-01-01T00:00:00Z',finished_at:'2026-01-01T00:00:01Z',
   files:{html:{sha256:m.artifact.sha256},model:{sha256:modelRef.sha256,canonical_sha256:v.objHash(model)}},binding,
   condition_plan:plan,completed_conditions:count,issue_count:0,fatal_error:fatal,conditions:cs,heading_observations:obs};
  mutate(report,obs);
  const obsRef=ref('observations/headings.json',obs),reportRef=ref('observations/report.json',report);
  const display={schema:'reader-preview-display-v1',artifactSha256:m.artifact.sha256,
   status:fatal?'stopped_on_error':count===24?(completeAudit?'completed_passed':'observed_awaiting_audit'):'in_progress',
   history:[],report:reportRef,observations:obsRef,model:modelRef};
  if(completeAudit){
   display.canonicalBookdata=ref('observations/canonical-structure.json',{synthetic:true});
   display.inventory=ref('observations/inventory.json',{synthetic:true});display.approval=ref('observations/approval.json',{synthetic:true});
   display.headingAudit=ref('observations/audit.json',{schema:'heading-release-audit-v1',status:'heading_release_evidence_consistent',
    artifact_sha256:{html:m.artifact.sha256,observations:obsRef.sha256,canonical_bookdata:display.canonicalBookdata.sha256,
     inventory:display.inventory.sha256,approval:display.approval.sha256},model_sha256:v.objHash(model),
    eligible_on_heading_evidence:true,source_bytes_matched:true,errors:[],required_conditions:plan,book_id:book.bookId,source_scan_numbers:[1]});
  }
  m.previewDisplay=ref('review/display.json',display);save();return {display,report,obs};
 }
 return {root,bundle,m,manifest,book,model,body,scope,put,ref,save,assess,authorize,conversation,ledger,options,setObserved};
}
test('v3 preserves scoped canonical, accepts only exact synthetic consent, and explicitly selects a distinct draft',t=>{
 const f=fixture(t);f.authorize();const before=fs.readFileSync(f.ledger());const r=handoff.inspect(f.options());
 assert.equal(r.handoffAllowed,true);assert.equal(r.selectedLedgerArtifact,'pendingDraft');assert.equal(r.contentCertified,false);assert.equal(r.deviceVerified,false);
 assert.equal(r.reviewScope.fullIndependentSecondTranscription,false);assert.equal(r.displayState.status,'not_run');assert.deepEqual(fs.readFileSync(f.ledger()),before);
 for(const phase of ['prepare','release','deployed','device'])assert.equal(v.validateBundle(f.manifest,{phase}).eligible,false);
 assert.equal(handoff.inspect({...f.options(),mode:'normal'}).handoffAllowed,false);
});
test('v3 rejects invented independence, stale source comparison, and raw archive replacement',t=>{
 const f=fixture(t);const s=structuredClone(f.scope);s.fullIndependentSecondTranscription=true;f.m.scopedReview=f.ref('review/bad-scope.json',s);f.save();
 assert.throws(()=>f.authorize(),/SCOPED_REVIEW_OVERCLAIM/);
 s.fullIndependentSecondTranscription=false;s.comparisons[0].bindings[0].canonicalPointer='/pages/0/figures';f.m.scopedReview=f.ref('review/bad-scope.json',s);f.save();
 assert.throws(()=>f.authorize(),/TEXT_POINTER_OUT_OF_SCOPE/);
 s.comparisons=f.scope.comparisons;s.rawArchive=f.m.canonical;f.m.scopedReview=f.ref('review/bad-scope.json',s);f.save();assert.throws(()=>f.authorize(),/RAW_ARCHIVE_SEPARATE_REQUIRED/);
});
test('v3 rejects a retained review whose text does not match the frozen canonical',t=>{
 const f=fixture(t),s=structuredClone(f.scope),e=v.json(f.bundle,s.comparisons[0].evidence);e.pages[0].blocks[0].text+='欠落検査';
 s.comparisons[0].evidence=f.ref('retained/changed-review.json',e);f.m.scopedReview=f.ref('review/changed-scope.json',s);f.save();assert.throws(()=>f.authorize(),/SCOPED_REVIEW_TEXT_CHANGED/);
});
test('v3 rejects absent, negative, or wrong-target disclosure without creating authorization',t=>{
 for(const change of [c=>{c.userReplyExact='いいえ';},c=>{delete c.assistantDisclosure.exactQuestion;},
  c=>{c.artifact.sha256='0'.repeat(64);},c=>{c.loader.sha256='0'.repeat(64);},c=>{c.assistantDisclosure.visibleIdentity='2〜2 ffffffffffff';}]){
  const f=fixture(t);assert.throws(()=>f.authorize(change),/PREVIEW_CONSENT_V3_|PREVIEW_CONVERSATION_V3_/);
  assert.equal(JSON.parse(fs.readFileSync(f.manifest)).previewAuthorization,undefined);
 }
});
test('v3 rejects stale assessment counts and changed declared source/display scope',t=>{
 const f=fixture(t);assert.throws(()=>f.authorize(c=>{c.assistantDisclosure.disclosedDisplayState.status='completed_passed';}),/STATE_OR_SCOPE_MISMATCH/);
 const a=v.json(f.bundle,f.m.assessment);a.statusCounts={passed:60};f.m.assessment=f.ref('review/bad-assessment.json',a);f.save();assert.throws(()=>f.authorize(),/ASSESSMENT_STATE_MISMATCH/);
});
test('v3 records partial observations and layout failure without converting them to not-run or passed',t=>{
 const f=fixture(t);f.setObserved({count:4,fatal:'synthetic layout failure'});f.assess();f.authorize();
 assert.equal(v.validateBundle(f.manifest,{phase:'preview'}).previewDisplay.status,'stopped_on_error');
 const d=v.json(f.bundle,f.m.previewDisplay);d.status='not_run';f.m.previewDisplay=f.ref('review/downgraded.json',d);f.save();assert.throws(()=>f.authorize(),/OBSERVATIONS_DOWNGRADED/);
});
test('v3 all-24 observation awaits audit; completed-pass requires exact audit and model pins',t=>{
 const f=fixture(t);f.setObserved({count:24});assert.equal(scoped.validateDisplay(f.bundle,f.m).status,'observed_awaiting_audit');
 f.setObserved({count:24,completeAudit:true});assert.equal(scoped.validateDisplay(f.bundle,f.m).status,'completed_passed');
 const d=v.json(f.bundle,f.m.previewDisplay),a=v.json(f.bundle,d.headingAudit);a.artifact_sha256.html='0'.repeat(64);d.headingAudit=f.ref('observations/stale-audit.json',a);
 f.m.previewDisplay=f.ref('review/stale-display.json',d);assert.throws(()=>scoped.validateDisplay(f.bundle,f.m),/AUDIT_STALE/);
});
test('v3 rejects omitted page, wrong condition ID, altered body, and wrong artifact observations',t=>{
 for(const mutate of [r=>{r.conditions[0].visited_pages=[];},r=>{r.conditions[0].id='wrong';},
  r=>{r.binding.html_sha256='0'.repeat(64);},r=>{r.condition_plan.pop();}]){
  const f=fixture(t);f.setObserved({mutate});assert.throws(()=>scoped.validateDisplay(f.bundle,f.m),/PREVIEW_DISPLAY_/);
 }
 const f=fixture(t);const {display}=f.setObserved({count:24,completeAudit:true,mutate:r=>{r.conditions[0].body_fragments[0].text='別';}});
 assert.throws(()=>scoped.validateDisplay(f.bundle,f.m),/STATE_OVERCLAIM/);display.status='completed_failed';f.m.previewDisplay=f.ref('review/failed.json',display);
 assert.equal(scoped.validateDisplay(f.bundle,f.m).status,'completed_failed');
});
test('v3 rejects missing explicit draft SHA, another draft, and mismatched draft evidence',t=>{
 const f=fixture(t);f.authorize();const no=f.options();delete no.previewTargetArtifactSha256;assert.equal(handoff.inspect(no).handoffAllowed,false);
 assert.equal(handoff.inspect({...f.options(),previewTargetArtifactSha256:'0'.repeat(64)}).handoffAllowed,false);
 const opts=f.options(),ledger=JSON.parse(fs.readFileSync(opts.ledger));ledger.books[0].pendingDraft.privateProgressReportSha256='0'.repeat(64);
 f.put('ledger.json',ledger);const r=handoff.inspect(opts);assert.equal(r.handoffAllowed,false);assert.match(r.errors.join(';'),/DRAFT_NOT_BOUND/);
});
test('v3 pages require exact same-ID completion; issuance contains no private review or book text',t=>{
 const f=fixture(t);f.authorize();const o=f.options();const request={operation:'pages',channel:'preview',createOnly:true,
  expectedArtifactSha256:f.m.artifact.sha256,workLedgerFile:o.ledger,sourceProofFile:o.sourceProof,previewConsentFile:o.previewConsent,
  previewTargetArtifactSha256:f.m.artifact.sha256,driveReadbackFile:f.put('readback.html',fs.readFileSync(o.artifact)),driveFileId:'synthetic-file-id'};
 assert.throws(()=>pipe.plan(f.manifest,request),/PREVIEW_V3_DRIVE_COMPLETION_REQUIRED/);
 request.driveCompletionFile=f.put('completion.json',{schema:'reader-delivery-completion-v1',artifactSha256:f.m.artifact.sha256,targetFileId:'wrong-id',planSha256:'a'.repeat(64)});
 assert.throws(()=>pipe.plan(f.manifest,request),/PREVIEW_V3_SAME_ID_COMPLETION_MISMATCH/);
 f.put('completion.json',{schema:'reader-delivery-completion-v1',artifactSha256:f.m.artifact.sha256,targetFileId:'synthetic-file-id',planSha256:'a'.repeat(64)});
 assert.equal(pipe.plan(f.manifest,request).phase,'preview');
 const entry='reader/preview/synthetic-scoped/index.html';
 const receipt=pipe.issue(f.manifest,request,{book:{id:f.m.bookId,entry,stage:'draft'},entry,publicFiles:{[entry]:f.m.loaderSha256},reportSha256:'c'.repeat(64)});
 const text=JSON.stringify(receipt);assert.ok(!text.includes(f.body)&&!text.includes('synthetic-reviewer-private-marker'));assert.equal(receipt.payload.contentCertified,false);
});
test('unknown authorization schemas never fall back to historical v1',t=>{
 const f=fixture(t);f.m.previewAuthorization=f.ref('unknown.json',{schema:'reader-preview-consent-v999',explicit:true,requestedBy:'synthetic fixture',
  requestText:'Please provide this unverified synthetic preview.',at:'2026-01-01',artifactSha256:f.m.artifact.sha256});f.save();
 const r=v.validateBundle(f.manifest,{phase:'preview'});assert.equal(r.eligible,false);assert.match(r.errors.join(';'),/UNKNOWN_PREVIEW_AUTHORIZATION_SCHEMA/);
});
test('an actually recorded blank page is preserved, while empty text is not invented as a comparison',t=>{
 const f=fixture(t,{blank:true});f.authorize();const result=v.validateBundle(f.manifest,{phase:'preview'});
 assert.equal(result.eligible,true);assert.deepEqual(result.reviewScope.blankComparisonScans,[1]);
 const s=structuredClone(f.scope);s.kind='ignored';s.comparisons[0].kind='source_text_comparison';f.m.scopedReview=f.ref('review/not-blank.json',s);f.save();
 assert.throws(()=>f.authorize(),/EMPTY_COMPARISON/);
});
