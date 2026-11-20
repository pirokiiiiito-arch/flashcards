'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const v=require('../tools/reader-release-control.cjs'),pipeline=require('../tools/reader-private-pipeline.cjs');
const consent=require('../tools/reader-preview-consent.cjs'),handoff=require('../tools/reader-unified-handoff.cjs');
const {RULES}=require('../tools/reader-quality-gate.cjs');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'preview-v2-synthetic-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const put=(name,data)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});
  const raw=Buffer.isBuffer(data)?data:typeof data==='string'?data:JSON.stringify(data,null,2)+'\n';fs.writeFileSync(file,raw);return file;};
 const imageSha=v.hash(Buffer.from(png,'base64')),bookId='synthetic-consent-v2',range=[1,1];
 const book={bookId,range,pages:[{scan:1,sha256:imageSha,dataUrl:'data:image/png;base64,'+png,blocks:[{id:'p1',text:'合成の本文です。'}]}]};
 const input=put('input.html','<html><script id="embedded-data" type="application/json">'+JSON.stringify(book)+'</script></html>');
 const loader=put('loader.html','synthetic loader only'),index=put('index.json',{'1':imageSha}),bundle=path.join(root,'bundle');
 const m=pipeline.init(input,bundle,bookId,loader,index),manifest=path.join(bundle,'manifest.json');
 function ref(name,data){const file=put('bundle/'+name,data);return {path:name,sha256:v.hash(fs.readFileSync(file))};}
 const fields=v.textFields(book.pages);
 m.inventory=ref('source-inventory.json',{pages:[{scan:1,sourceSha256:imageSha,reviewedBy:'first synthetic',secondReviewer:'second synthetic',firstPassId:'one',secondPassId:'two',edgesChecked:true,secondViewedFirst:false,width:1,height:1,regions:[{id:'p1',kind:'body',box:[0,0,1,1],fields:Object.keys(fields)}]}]});
 m.second=ref('source-second.json',{runId:'independent-test',viewedFirst:false,sourceIndexSha256:m.originalIndex.sha256,method:'synthetic independent evidence',reviewedBy:'test second',fields});
 m.resolutions=ref('source-resolutions.json',{openIssues:[],differences:[],alerts:[],numbers:[]});
 m.boundaries=ref('source-boundaries.json',{items:[
  {id:'0>1',kind:'book_start',leftSourceSha256:null,rightSourceSha256:imageSha,leftTail:'',rightHead:'合成',reviewedBy:'test',reason:'synthetic book start',resolved:true},
  {id:'1>2',kind:'book_end',leftSourceSha256:imageSha,rightSourceSha256:null,leftTail:'です。',rightHead:'',reviewedBy:'test',reason:'synthetic book end',resolved:true}]});
 put('bundle/manifest.json',m);
 const conversation={schema:'preview-conversation-acceptance-evidence-v1',bookId,range,artifact:{sha256:m.artifact.sha256},
  recordedAtUTC:'2026-11-20T00:00:00Z',timestampMeaning:'Recorded evidence time, not an invented message-send time.',
  assistantDisclosure:{exactQuestion:'この版を全検査未完了の確認用として受け取る形でよいですか？',visibleIdentity:'1〜1版 '+m.artifact.sha256.slice(0,12),
   disclosedRemainingChecks:['小字原本QA、表示24条件、Drive、公開とiPhoneは未検証']},userReplyExact:'確認用url',
  acceptanceBasis:'Direct response to the preceding exact-artifact question.',normalReleaseAuthorizedByThisReply:false};
 const assessment={schema:'private-quality-assessment-60-v1',scope:{bookId,sourceRange:range},artifact:{sha256:m.artifact.sha256},
  checks:RULES.map(id=>({id,status:id==='G1-12'?'needs_source_review':'not_run'})),statusCounts:{not_run:59,needs_source_review:1},
  conclusion:{sourceQAComplete:false,all60Passed:false,readerComplete:false,iphoneConfirmed:false,releaseApproved:false},
  notPerformed:{browser24Conditions:'not_run',iphoneChrome:'not_run'}};
 const conversationFile=put('conversation.json',conversation),assessmentFile=put('assessment.json',assessment);
 const ledger=put('ledger.json',{schema:'reader-work-ledger-v1',ruleset:'20261116_0654_60-items',books:[{bookId,range,
  artifactSha256:m.artifact.sha256,sourceArchiveSha256:'f'.repeat(64),profile:'novel',qualityState:'unverified',releaseStatus:'blocked',
  knownDefects:[{id:'small-source-text',status:'needs_source_review'}]}]});
 const sourceProof=put('source-proof.json',{schema:'reader-source-preflight-v1',status:'source_ready_for_ocr',sourceArchiveSha256MatchesPinned:true,
  bookId,range,sourceArchiveSha256:'f'.repeat(64),rangeImages:[{scan:1,sha256:imageSha}]});
 function authorize(){pipeline.authorizePreview(manifest,conversationFile,assessmentFile);Object.assign(m,JSON.parse(fs.readFileSync(manifest)));return path.join(bundle,m.previewAuthorization.path);}
 function changeConsent(fn){const c=v.json(bundle,m.previewAuthorization);fn(c);m.previewAuthorization=ref('modified-consent.json',c);put('bundle/manifest.json',m);return path.join(bundle,m.previewAuthorization.path);}
 function request(operation='stage'){return {operation,channel:'preview',createOnly:true,expectedArtifactSha256:m.artifact.sha256,
  workLedgerFile:ledger,sourceProofFile:sourceProof,previewConsentFile:path.join(bundle,m.previewAuthorization.path)};}
 function readyPages(){const stage=pipeline.plan(manifest,request()),stageFile=put('stage-plan.json',stage),artifact=path.join(bundle,m.artifact.path);
  const completion=pipeline.completePlan(stageFile,artifact,artifact,'synthetic-drive-id');
  return {...request('pages'),driveReadbackFile:artifact,driveFileId:'synthetic-drive-id',driveCompletionFile:put('completion.json',completion)};}
 return {root,bundle,m,manifest,put,ref,input,book,conversation,conversationFile,assessment,assessmentFile,ledger,sourceProof,authorize,changeConsent,request,readyPages};
}
test('short exact reply plus disclosed exact artifact enables only explicit preview staging',t=>{
 const f=fixture(t),before=JSON.parse(fs.readFileSync(f.manifest)),raw=fs.readFileSync(path.join(f.bundle,before.raw.path));
 const authorization=f.authorize(),a=JSON.parse(fs.readFileSync(authorization));assert.equal(a.requestText,'確認用url');assert.equal(a.requestText.length,6);
 for(const key of ['artifact','raw','canonical','inventory','second','resolutions','boundaries','checks','display'])assert.deepEqual(f.m[key],before[key]);
 assert.deepEqual(fs.readFileSync(path.join(f.bundle,before.raw.path)),raw);
 const r=v.validateBundle(f.manifest,{phase:'preview'});assert.equal(r.eligible,true,r.errors.join(';'));
 assert.equal(r.reviewState.fullSourceQA,'pending');assert.deepEqual(r.previewAssessment.unresolvedIds,['G1-12']);
 assert.ok(Object.values(r.checks).every(x=>x.status==='not_run'));assert.equal(r.contentCertified,false);
 const p=pipeline.plan(f.manifest,f.request());assert.equal(p.createOnly,true);assert.equal(p.phase,'preview');assert.equal(p.previewAuthorizationSha256,f.m.previewAuthorization.sha256);
 assert.equal(v.validateBundle(f.manifest,{phase:'prepare'}).eligible,false);
});
for(const reply of ['いいえ','やめて','まだ進めない','URLをくれ','作って'])test('negative or undisclosed-style request is not inferred as v2 approval: '+reply,t=>{
 const f=fixture(t);f.conversation.userReplyExact=reply;f.put('conversation.json',f.conversation);
 assert.throws(()=>f.authorize(),/DISCLOSURE_REPLY_MISMATCH/);assert.equal(JSON.parse(fs.readFileSync(f.manifest)).previewAuthorization,undefined);
});
test('same short reply with missing immediate disclosure is rejected',t=>{
 const f=fixture(t);delete f.conversation.assistantDisclosure.exactQuestion;f.put('conversation.json',f.conversation);assert.throws(()=>f.authorize(),/DISCLOSURE_REPLY_MISMATCH/);
});
test('visible disclosure for an old range and SHA cannot authorize a new outer identity',t=>{
 const f=fixture(t);f.conversation.assistantDisclosure.visibleIdentity='41〜60版 ffffffffffff';f.put('conversation.json',f.conversation);assert.throws(()=>f.authorize(),/VISIBLE_TARGET_MISMATCH/);
});
test('range matching cannot accept a substring of a different numeric range',t=>{
 const f=fixture(t);f.conversation.assistantDisclosure.visibleIdentity='11〜10版 '+f.m.artifact.sha256.slice(0,12);f.put('conversation.json',f.conversation);assert.throws(()=>f.authorize(),/VISIBLE_TARGET_MISMATCH/);
});
for(const key of ['bookId','range','artifact'])test('conversation identity must match exact manifest: '+key,t=>{
 const f=fixture(t);f.conversation[key]=key==='bookId'?'other-book':key==='range'?[2,2]:{sha256:'0'.repeat(64)};f.put('conversation.json',f.conversation);assert.throws(()=>f.authorize(),/CONVERSATION_IDENTITY_MISMATCH/);
});
test('actual reply is retained; expansion into an invented uncorrected-OCR quote is rejected',t=>{
 const f=fixture(t);f.authorize();f.changeConsent(a=>a.requestText='未校正OCR一次稿を受け取ります');assert.match(v.validateBundle(f.manifest,{phase:'preview'}).errors.join(';'),/DISCLOSURE_REPLY_MISMATCH/);
});
test('false confirmation and source/quality completion claims are rejected',t=>{
 const f=fixture(t);f.authorize();f.changeConsent(a=>a.confirmedByUser=false);assert.match(v.validateBundle(f.manifest,{phase:'preview'}).errors.join(';'),/EXPLICIT_ACCEPTANCE_REQUIRED/);
 f.changeConsent(a=>{a.confirmedByUser=true;a.reviewState.fullSourceQA='complete';});assert.match(v.validateBundle(f.manifest,{phase:'preview'}).errors.join(';'),/STATE_UNSUPPORTED/);
});
test('independent-source defects remain blocking under v2, even with an explicit accepted reply',t=>{
 const f=fixture(t);const r=v.json(f.bundle,f.m.resolutions);r.openIssues=['unresolved source difference'];f.m.resolutions=f.ref('source-unresolved.json',r);f.put('bundle/manifest.json',f.m);assert.throws(()=>f.authorize(),/UNRESOLVED_ISSUES/);
});
test('missing independent source coverage or boundaries remains blocking',t=>{
 const f=fixture(t);const b=v.json(f.bundle,f.m.boundaries);b.items.pop();f.m.boundaries=f.ref('source-incomplete-boundaries.json',b);f.put('bundle/manifest.json',f.m);assert.throws(()=>f.authorize(),/BOUNDARY_COVERAGE/);
});
test('unified preview requires the identical consent bytes used by the private validator',t=>{
 const f=fixture(t),authorization=f.authorize(),artifact=path.join(f.bundle,f.m.artifact.path);
 const opts={mode:'preview',artifact,manifest:f.manifest,ledger:f.ledger,sourceProof:f.sourceProof,previewConsent:authorization};
 const r=handoff.inspect(opts);assert.equal(r.handoffAllowed,true,r.errors.join(';'));assert.equal(r.contentCertified,false);assert.equal(r.sourceQAComplete,false);
 assert.equal(r.deviceVerified,false);assert.equal(r.publicHttpVerified,false);assert.ok(r.warnings.includes('PREVIEW_QA_INCOMPLETE_NOT_COMPLETE'));
 const changed=JSON.parse(fs.readFileSync(authorization));changed.recordedAt='2026-11-21T00:00:00Z';opts.previewConsent=f.put('different.json',changed);
 assert.ok(handoff.inspect(opts).errors.includes('PREVIEW_CONSENT_V2_MANIFEST_REFERENCE_MISMATCH'));
});
test('v2 consent never promotes normal delivery or hides source-review pending state',t=>{
 const f=fixture(t),a=f.authorize();const r=handoff.inspect({mode:'normal',artifact:path.join(f.bundle,f.m.artifact.path),manifest:f.manifest,ledger:f.ledger,sourceProof:f.sourceProof,previewConsent:a});
 assert.equal(r.handoffAllowed,false);assert.equal(r.canonical60Valid,false);assert.equal(r.contentCertified,false);assert.ok(r.errors.includes('CANONICAL_STAGE_NOT_PASSED_prepare'));
 assert.throws(()=>pipeline.plan(f.manifest,{...f.request(),operation:'promote'}),/PREVIEW_CANNOT_REPLACE_NORMAL/);
 assert.throws(()=>pipeline.plan(f.manifest,{...f.request(),targetFileId:'existing'}),/STAGING_MUST_BE_CREATE_ONLY/);
});
test('pages cannot bypass unified consent or same-ID Drive readback/completion',t=>{
 const f=fixture(t);f.authorize();assert.throws(()=>pipeline.plan(f.manifest,f.request('pages')),/SAME_ID_DRIVE_READBACK_REQUIRED/);
 const request=f.readyPages();assert.equal(pipeline.plan(f.manifest,request).unifiedGateMode,'preview');
 assert.throws(()=>pipeline.plan(f.manifest,{...request,previewConsentFile:f.put('wrong-consent.json',{})}),/UNIFIED_CROSS_CHAT_HANDOFF_BLOCKED/);
 assert.throws(()=>pipeline.plan(f.manifest,{...request,driveFileId:'another-file'}),/SAME_ID_COMPLETION_MISMATCH/);
 assert.throws(()=>pipeline.plan(f.manifest,{...request,driveReadbackFile:f.put('bad-readback.html','wrong bytes')}),/SAME_ID_DRIVE_READBACK_REQUIRED/);
});
test('proper issuer binds immutable-preview-v3 into digest and exposes only metadata',t=>{
 const f=fixture(t);f.authorize();const request=f.readyPages(),entry='reader/preview/synthetic-consent-v2/index.html';
 const context={entry,book:{id:f.m.bookId,entry,stage:'draft'},reportSha256:v.hash('synthetic report'),publicFiles:{[entry]:f.m.loaderSha256}};
 assert.throws(()=>pipeline.issue(f.manifest,f.request(),context),/PREVIEW_RECEIPT_REQUIRES_PAGES_PLAN/);
 const r=pipeline.issue(f.manifest,request,context);assert.equal(r.payload.previewProtocol,'reader-immutable-preview-v3');assert.equal(r.digest,v.objHash(r.payload));
 assert.equal(r.payload.contentCertified,false);assert.equal(r.payload.previewAssessment.canonicalGateCertified,false);
 assert.ok(!JSON.stringify(r).includes('確認用url'));assert.ok(!JSON.stringify(r).includes('synthetic-drive-id'));
 f.put('receipt.json',r);assert.equal(v.receipts(f.root,{receipts:['receipt.json']}).found.size,1);
 delete r.payload.previewProtocol;assert.throws(()=>v.verifyEnvelope(r),/BAD_RECEIPT_DIGEST/);
});
test('historical v1 wording conditions remain strict and do not accept the short reply alone',t=>{
 const f=fixture(t);f.m.previewAuthorization=f.ref('legacy-request.json',{explicit:true,requestedBy:'fixture user',requestText:'確認用url',at:'2026-11-20',artifactSha256:f.m.artifact.sha256});f.put('bundle/manifest.json',f.m);
 assert.match(v.validateBundle(f.manifest,{phase:'preview'}).errors.join(';'),/EXPLICIT_PREVIEW_REQUEST_REQUIRED/);
});
