#!/usr/bin/env node
'use strict';
// All source and canonical text stays in the caller's PRIVATE workspace.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const v=require('./reader-release-control.cjs'),{ID,RULES}=require('./reader-quality-gate.cjs');
const fail=(ok,s)=>{if(!ok)throw Error(s);};
function write(root,name,value){const b=typeof value==='string'||Buffer.isBuffer(value)?value:JSON.stringify(value,null,2)+'\n';const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});if(fs.existsSync(file)){fail(v.hash(fs.readFileSync(file))===v.hash(b),'IMMUTABLE_FILE_CONFLICT '+name);}else fs.writeFileSync(file,b,{flag:'wx',mode:0o600});return {path:name,sha256:v.hash(b)};}
function saveManifest(root,m){const b=JSON.stringify(m,null,2)+'\n',tmp=path.join(root,'.manifest-'+crypto.randomUUID());fs.writeFileSync(tmp,b,{flag:'wx',mode:0o600});fs.renameSync(tmp,path.join(root,'manifest.json'));}
function load(file){const root=path.dirname(path.resolve(file)),m=JSON.parse(fs.readFileSync(file));fail(m.schema==='reader-private-bundle-v2','WRONG_MANIFEST');return{root,m};}
function init(htmlFile,root,bookId,loaderFile,sourceIndexFile){
 fail(!fs.existsSync(root),'WORKSPACE_ALREADY_EXISTS');fail(/^[a-z0-9-]{3,100}$/.test(bookId),'BAD_BOOK_ID');
 const input=fs.readFileSync(htmlFile),parsed=v.extract(input),external=JSON.parse(fs.readFileSync(sourceIndexFile));
 const index=Array.isArray(external.pages)?Object.fromEntries(external.pages.filter(x=>parsed.pages.some(p=>p.scan===x.scan)).map(p=>[p.scan,p.sha256])):external;
 fail(v.objHash(v.originals(parsed.pages))===v.objHash(index),'EXTERNAL_ORIGINAL_INDEX_MISMATCH');
 const range=[parsed.pages[0].scan,parsed.pages.at(-1).scan];fail(parsed.pages.every((p,i)=>p.scan===range[0]+i),'BAD_SCAN_ORDER');
 fs.mkdirSync(root,{recursive:true,mode:0o700});
 const m={schema:'reader-private-bundle-v2',bookId,standardFileId:ID,range,firstPassId:'import-'+v.hash(input).slice(0,16),loaderSha256:v.hash(fs.readFileSync(loaderFile)),createdAt:new Date().toISOString()};
 m.raw=write(root,'immutable/raw.json',parsed.data);m.canonical=write(root,'canonical/revision-0000.json',parsed.data);
 m.originalIndex=write(root,'immutable/original-index.json',index);m.template=write(root,'immutable/renderer.html',parsed.shell);
 m.profile=write(root,'immutable/profile.json',{schema:'reader-profile-v2',templateSha256:m.template.sha256,defaultFontPx:20,lineHeight:1.5,digitOrientation:'preserve-approved',gesture:'up-next-down-prev-one-step-native-zoom',note:'Imported engine is preserved, not certified. A profile lock is not a test result.'});
 m.lock=write(root,'immutable/input-lock.json',{schema:'reader-input-lock-v2',raw:m.raw.sha256,originalIndex:m.originalIndex.sha256,template:m.template.sha256,profile:m.profile.sha256});
 m.corrections=write(root,'corrections/revision-0000.json',[]);m.artifact=write(root,'candidates/imported-unverified.html',input);
 m.inventory=write(root,'review/inventory.json',{pages:parsed.pages.map(p=>({scan:p.scan,sourceSha256:p.sha256,reviewedBy:null,secondReviewer:null,edgesChecked:false,regions:[]}))});
 m.second=write(root,'review/second-pass.json',{runId:null,viewedFirst:null,sourceIndexSha256:m.originalIndex.sha256,fields:{}});
 m.resolutions=write(root,'review/resolutions.json',{openIssues:[{kind:'source-review-not-performed',range}],differences:[],numbers:[],alerts:[]});
 m.boundaries=write(root,'review/boundaries.json',{items:[]});m.display=write(root,'review/display.json',{artifactSha256:m.artifact.sha256,actualPixels:false,fields:{},conditions:[]});
 m.checks=write(root,'review/checks.json',Object.fromEntries(RULES.map(id=>[id,{status:'not_run'}])));saveManifest(root,m);return m;
}
// Opt-in, fail-closed source provenance entrypoint for NEW scan batches. Legacy
// init remains compatible; it is not a substitute for this command on new books.
function checkSourcePreflight(proofFile,bookId,pages){
 const proof=JSON.parse(fs.readFileSync(proofFile,'utf8'));
 fail(proof.schema==='reader-source-preflight-v1'&&
      proof.status==='source_ready_for_ocr'&&
      proof.bookId===bookId&&
      proof.sourceArchiveSha256MatchesPinned===true&&
      proof.folderListingComplete===true&&
      proof.canonical60Certified===false&&
      proof.releaseEligible===false&&
      proof.requestReupload===false&&
      Array.isArray(proof.errors)&&proof.errors.length===0,
      'SOURCE_DISCOVERY_OR_ORIGINAL_ZIP_NOT_VERIFIED');
 fail(Array.isArray(pages)&&pages.length>0&&
      Array.isArray(proof.range)&&proof.range[0]===pages[0].scan&&
      proof.range[1]===pages.at(-1).scan,'SOURCE_DISCOVERY_RANGE_MISMATCH');
 const imageMap=new Map((proof.rangeImages||[]).map(x=>[x.scan,x.sha256]));
 fail(imageMap.size===pages.length&&pages.every((p,i)=>p.scan===pages[0].scan+i&&
      /^[a-f0-9]{64}$/.test(p.sha256||'')&&p.sha256===imageMap.get(p.scan)),
      'SOURCE_DISCOVERY_IMAGE_HASH_MISMATCH');
 return proof;
}
function initResolved(htmlFile,root,bookId,loaderFile,sourceIndexFile,sourcePreflightFile){
 fail(typeof sourcePreflightFile==='string'&&sourcePreflightFile.length>0,
      'SOURCE_PREFLIGHT_REPORT_REQUIRED');
 const parsed=v.extract(fs.readFileSync(htmlFile));
 const proof=checkSourcePreflight(sourcePreflightFile,bookId,parsed.pages);
 const m=init(htmlFile,root,bookId,loaderFile,sourceIndexFile);
 m.sourceDiscovery=write(root,'immutable/source-discovery-proof.json',proof);
 saveManifest(root,m);
 return m;
}
function correctUnsafe(file,eventFile){
 const {root,m}=load(file),raw=v.json(root,m.raw),old=v.json(root,m.canonical),events=v.json(root,m.corrections),e=JSON.parse(fs.readFileSync(eventFile));
 fail(v.objHash(v.replay(raw,events))===v.objHash(old),'PRIOR_CANONICAL_DIVERGED');
 fail(e.expectedCanonicalSha256===m.canonical.sha256,'CANONICAL_VERSION_CONFLICT');
 const p=(Array.isArray(old)?old:old.pages).find(p=>p.scan===e.scan);fail(p,'UNKNOWN_SCAN');
 const parts=String(e.pointer).split('/');fail(/^(reading_text|title|figures\/\d+\/(caption|display_title)|boxed_articles\/\d+\/(text|title)|blocks\/\d+\/text)$/.test(e.pointer),'UNSAFE_TEXT_EDIT');
 const clone=structuredClone(old),pp=(Array.isArray(clone)?clone:clone.pages).find(p=>p.scan===e.scan);let dest=pp;for(const key of parts.slice(0,-1))dest=dest[key];
 fail(dest&&(dest[parts.at(-1)]??null)===e.before&&typeof e.after==='string','EDIT_PRECONDITION');dest[parts.at(-1)]=e.after;
 const record={...e,sourceSha256:p.sha256,beforeDataSha256:v.objHash(old),afterDataSha256:v.objHash(clone)};
 const next=[...events,record];v.replay(raw,next);
 const n=String(next.length).padStart(4,'0');m.canonical=write(root,'canonical/revision-'+n+'.json',clone);m.corrections=write(root,'corrections/revision-'+n+'.json',next);
 // Invalidate old passes, but never erase known defects as merely unperformed.
 const oldChecks=v.json(root,m.checks),open=v.json(root,m.resolutions);
 fail(Array.isArray(open.openIssues),'MISSING_ISSUE_LEDGER');
 for(const [id,c]of Object.entries(oldChecks))if(['failed','needs_source_review'].includes(c.status)){
  const issueId='prior-check:'+id+':'+m.checks.sha256;
  if(!open.openIssues.some(x=>x&&x.id===issueId))open.openIssues.push({id:issueId,checkId:id,priorStatus:c.status,priorChecksSha256:m.checks.sha256,reason:'Known defect requires explicit resolution and retest; text correction is not its resolution.'});
 }
 m.resolutions=write(root,'review/resolutions-revision-'+n+'.json',open);
 m.checks=write(root,'review/checks-revision-'+n+'.json',Object.fromEntries(RULES.map(id=>[id,{status:'not_run'}])));
 m.deliveryState='blocked-rebuild-and-review-required';saveManifest(root,m);return m;
}
function buildUnsafe(file){
 const{root,m}=load(file),data=v.json(root,m.canonical),raw=v.json(root,m.raw),events=v.json(root,m.corrections),template=v.bytes(root,m.template).toString();
 fail(v.objHash(v.replay(raw,events))===v.objHash(data),'CANONICAL_NOT_FROM_CORRECTIONS');
 fail(template.split('{{READER_DATA}}').length===2,'ONE_TEMPLATE_SLOT_REQUIRED');
 const html=template.replace('{{READER_DATA}}',JSON.stringify(data).replace(/</g,'\\u003c'));
 fail(v.objHash(v.extract(html).data)===v.objHash(data),'BUILD_ROUNDTRIP_FAILED');
 const stamp=new Date().toISOString().replace(/[^0-9]/g,'');m.artifact=write(root,'candidates/'+stamp+'-'+v.hash(html).slice(0,12)+'-UNVERIFIED.html',html);m.deliveryState='blocked-evidence-required';saveManifest(root,m);return m;
}
function withLock(file,fn){
 const lock=path.join(path.dirname(path.resolve(file)),'.writer.lock');let handle;
 try{handle=fs.openSync(lock,'wx',0o600);}catch(e){if(e.code==='EEXIST')throw Error('WORKSPACE_BUSY_OR_RECOVERY_REQUIRED');throw e;}
 try{fs.writeFileSync(handle,JSON.stringify({pid:process.pid,at:new Date().toISOString()}));return fn();}finally{fs.closeSync(handle);fs.unlinkSync(lock);}
}
function correct(file,eventFile){return withLock(file,()=>correctUnsafe(file,eventFile));}
function build(file){return withLock(file,()=>buildUnsafe(file));}
function authorizePreview(file,conversationFile,assessmentFile){
 return withLock(file,()=>{
  const {root,m}=load(file),before=fs.readFileSync(file),beforeSha=v.hash(before);
  const conversationBytes=fs.readFileSync(conversationFile),assessmentBytes=fs.readFileSync(assessmentFile);
  const conversation=JSON.parse(conversationBytes),assessment=JSON.parse(assessmentBytes);
  // Copy the real evidence verbatim. Its record time is not a fabricated message time.
  const prefix='review/preview-consent/';
  const conversationEvidence=write(root,prefix+'conversation-'+v.hash(conversationBytes)+'.json',conversationBytes);
  const assessmentEvidence=write(root,prefix+'assessment-'+v.hash(assessmentBytes)+'.json',assessmentBytes);
  const c=require('./reader-preview-consent.cjs');
  const consent={schema:'reader-preview-consent-v2',bookId:m.bookId,range:m.range,
   artifactSha256:m.artifact.sha256,loaderSha256:m.loaderSha256,explicit:true,confirmedByUser:true,
   requestedBy:'user',acceptanceKind:'direct_reply_to_artifact_disclosure',previewOnly:true,normalReleaseAuthorized:false,
   requestText:conversation.userReplyExact,recordedAt:conversation.recordedAtUTC,timestampMeaning:conversation.timestampMeaning,
   conversationEvidence,disclosureSha256:c.digest(conversation.assistantDisclosure),assessmentEvidence,
   reviewState:{...c.STATES},sourceEvidenceDigests:Object.fromEntries(c.SOURCE_KEYS.map(k=>[k,m[k]?.sha256]))};
  c.validateV2(consent,{subject:{bookId:m.bookId,range:m.range,artifactSha256:m.artifact.sha256,loaderSha256:m.loaderSha256},
   manifest:m,conversation,assessment,rules:RULES});
  const consentRef=write(root,prefix+'authorization-'+v.objHash(consent)+'.json',consent);
  const candidate={...m,previewAuthorization:consentRef};
  const candidateRef=write(root,'manifest-preview-consent-'+v.objHash(candidate)+'.json',candidate);
  const checked=v.validateBundle(path.join(root,candidateRef.path),{phase:'preview'});
  fail(checked.eligible,'PREVIEW_AUTHORIZATION_BLOCKED: '+checked.errors.join('; '));
  fail(v.hash(fs.readFileSync(file))===beforeSha,'MANIFEST_CHANGED_DURING_AUTHORIZATION');
  const priorManifest=write(root,'history/manifest-before-preview-consent-'+beforeSha+'.json',before);
  saveManifest(root,candidate);
  return {bookId:m.bookId,artifactSha256:m.artifact.sha256,previewAuthorization:consentRef,
   priorManifest,candidateManifest:candidateRef,sourceEvidenceUnchanged:true,formalChecksUnchanged:true,
   contentCertified:false,normalReleaseAuthorized:false};
 });
}
function authorizePreviewV3(file,conversationFile,assessmentFile){
 return withLock(file,()=>{
  const {root,m}=load(file),before=fs.readFileSync(file),beforeSha=v.hash(before);
  const conversationBytes=fs.readFileSync(conversationFile),assessmentBytes=fs.readFileSync(assessmentFile);
  const conversation=JSON.parse(conversationBytes),assessment=JSON.parse(assessmentBytes);
  fail(v.hash(assessmentBytes)===m.assessment?.sha256,'PREVIEW_V3_ASSESSMENT_MUST_BE_FINALIZED_BEFORE_CONSENT');
  const pages=v.extract(v.bytes(root,m.artifact)).pages;
  const scoped=require('./reader-scoped-review.cjs').validate(root,m,pages,v.json(root,m.originalIndex),RULES);
  const prefix='review/preview-consent-v3/';
  const conversationEvidence=write(root,prefix+'conversation-'+v.hash(conversationBytes)+'.json',conversationBytes);
  const assessmentEvidence=write(root,prefix+'assessment-'+v.hash(assessmentBytes)+'.json',assessmentBytes);
  const c=require('./reader-preview-consent.cjs');
  const consent={schema:'reader-preview-consent-v3',bookId:m.bookId,range:m.range,
   artifactSha256:m.artifact.sha256,loaderSha256:m.loaderSha256,explicit:true,confirmedByUser:true,
   requestedBy:'user',acceptanceKind:'direct_reply_to_artifact_disclosure',previewOnly:true,normalReleaseAuthorized:false,
   acknowledgesScopedIncompleteReview:true,requestText:conversation.userReplyExact,
   recordedAt:conversation.recordedAtUTC,timestampMeaning:conversation.timestampMeaning,
   conversationEvidence,disclosureSha256:c.digest(conversation.assistantDisclosure),assessmentEvidence,
   reviewState:scoped.reviewState,sourceEvidenceDigests:scoped.sourceEvidenceIndex};
  c.validateV3(consent,{subject:{bookId:m.bookId,range:m.range,artifactSha256:m.artifact.sha256,loaderSha256:m.loaderSha256},
   manifest:m,conversation,assessment,rules:RULES,scoped});
  const authorization=write(root,prefix+'authorization-'+v.objHash(consent)+'.json',consent);
  const candidate={...m,previewAuthorization:authorization};
  const candidateRef=write(root,'manifest-preview-v3-'+v.objHash(candidate)+'.json',candidate);
  const checked=v.validateBundle(path.join(root,candidateRef.path),{phase:'preview'});
  fail(checked.eligible,'PREVIEW_V3_AUTHORIZATION_BLOCKED: '+checked.errors.join('; '));
  fail(v.hash(fs.readFileSync(file))===beforeSha,'MANIFEST_CHANGED_DURING_AUTHORIZATION');
  const priorManifest=write(root,'history/manifest-before-preview-v3-'+beforeSha+'.json',before);
  saveManifest(root,candidate);
  return {bookId:m.bookId,artifactSha256:m.artifact.sha256,previewAuthorization:authorization,priorManifest,
   candidateManifest:candidateRef,sourceEvidenceUnchanged:true,formalChecksUnchanged:true,
   contentCertified:false,normalReleaseAuthorized:false,reviewState:scoped.reviewState};
 });
}
function plan(file,request){
 fail(['stage','promote','attach','pages'].includes(request?.operation),'UNKNOWN_DELIVERY_OPERATION');
 const channel=request.channel;fail(['preview','production'].includes(channel),'EXPLICIT_CHANNEL_REQUIRED');
 if(request.operation==='stage')fail(request.createOnly===true&&!request.targetFileId&&!request.normalFileId,'STAGING_MUST_BE_CREATE_ONLY');
 const phase=channel==='preview'?'preview':request.operation==='stage'?'prepare':request.operation==='pages'?'release':request.deviceVerified===true?'device':'deployed';
 const result=v.validateBundle(file,{phase});fail(result.eligible,'DELIVERY_BLOCKED: '+result.errors.join('; '));
 fail(request.expectedArtifactSha256===result.subject.artifactSha256,'PLAN_ARTIFACT_CHANGED');
 if(channel==='preview')fail(request.operation!=='promote'&&request.createOnly===true&&!request.normalFileId&&!request.targetFileId,'PREVIEW_CANNOT_REPLACE_NORMAL');
 if(request.operation==='promote')fail(request.targetFileId&&/^[a-f0-9]{64}$/.test(request.expectedCurrentSha256||''),'COMPARE_AND_SWAP_REQUIRED');
 // Managed issue, public Pages and final attachment MUST pass the one central
 // cross-chat ledger and OCR/source gate on the exact original artifact.
 // Only create-only PRIVATE staging is exempt: staging is NOT a delivery.
 let unified=null;
 if(request.operation==='attach'||request.operation==='promote'||(request.operation==='pages'&&channel==='preview')){
  fail(request.workLedgerFile&&request.sourceProofFile,'SHARED_WORK_LEDGER_AND_SOURCE_PROOF_REQUIRED');
  const {root,m}=load(file);
  const artifact=path.join(root,m.artifact.path);
  const mode=channel==='preview'?'preview':request.operation==='pages'?'prepublication':'normal';
  unified=require('./reader-unified-handoff.cjs').inspect({
   mode,artifact,manifest:file,ledger:request.workLedgerFile,
   sourceProof:request.sourceProofFile,ocrReview:request.ocrReviewFile,
   previewConsent:request.previewConsentFile,publicEvidence:request.publicEvidenceFile,
   previewTargetArtifactSha256:request.previewTargetArtifactSha256
  });
  const allowed=mode==='prepublication'?unified.prepublicationAllowed:unified.handoffAllowed;
  fail(allowed,'UNIFIED_CROSS_CHAT_HANDOFF_BLOCKED: '+unified.errors.join('; '));
  if(channel==='preview'){
   fail(request.driveReadbackFile&&request.driveFileId&&
        v.hash(fs.readFileSync(request.driveReadbackFile))===m.artifact.sha256,
        'UNVERIFIED_PREVIEW_SAME_ID_DRIVE_READBACK_REQUIRED');
   if(['reader-preview-consent-v2','reader-preview-consent-v3'].includes(result.authorization?.schema)){
    const version=result.authorization.schema==='reader-preview-consent-v3'?'V3':'V2';
    fail(request.driveCompletionFile,'PREVIEW_'+version+'_DRIVE_COMPLETION_REQUIRED');
    const completion=JSON.parse(fs.readFileSync(request.driveCompletionFile));
    fail(completion.schema==='reader-delivery-completion-v1'&&completion.artifactSha256===m.artifact.sha256&&
     completion.targetFileId===request.driveFileId&&/^[a-f0-9]{64}$/.test(completion.planSha256||''),
     'PREVIEW_'+version+'_SAME_ID_COMPLETION_MISMATCH');
   }
  }
 }
 return {schema:'reader-delivery-plan-v2',
  previewAuthorizationSha256:result.authorization?.sha256||null,
  unifiedGateMode:unified?.mode||null,
  unifiedGateArtifactSha256:unified?.artifactSha256||null,
  unifiedWorkLedgerSha256:request.workLedgerFile?v.hash(fs.readFileSync(request.workLedgerFile)):null,operation:request.operation,channel,artifactSha256:result.subject.artifactSha256,subjectSha256:result.subjectSha256,targetFileId:request.targetFileId||null,expectedCurrentSha256:request.expectedCurrentSha256||null,createOnly:request.createOnly===true,phase,postWriteReadbackRequired:true,expiresAt:new Date(Date.now()+15*60*1000).toISOString(),note:'Plan is not upload completion. Connector adapters must check current bytes before writing, then read back the exact target.'};
}
function exportChecked(file,out,request){
 fail(!fs.existsSync(out),'EXPORT_DESTINATION_EXISTS');const p=plan(file,request),{root,m}=load(file),b=v.bytes(root,m.artifact);
 const jst=new Date(Date.now()+9*60*60*1000).toISOString().replace(/[^0-9]/g,'');
 p.fileName=jst.slice(0,8)+'_'+jst.slice(8,12)+'_'+m.bookId+'_'+(p.channel==='preview'?'PREVIEW-UNVERIFIED':request.operation==='stage'?'STAGING-NOT-RELEASED':'VERIFIED-READING')+'_'+p.artifactSha256.slice(0,12)+'.html';
 fs.mkdirSync(out,{recursive:true,mode:0o700});write(out,p.fileName,b);write(out,'delivery-plan.json',p);return p;
}
function issue(file,request,context){
 if(request?.channel==='preview')fail(request.operation==='pages','PREVIEW_RECEIPT_REQUIRES_PAGES_PLAN');
 const p=plan(file,request),r=v.validateBundle(file,{phase:p.phase});fail(r.eligible,'RECEIPT_BLOCKED');
 fail(context.book?.id===r.subject.bookId&&context.book.entry===context.entry&&context.publicFiles?.[context.entry]===r.subject.loaderSha256&&/^[a-f0-9]{64}$/.test(context.reportSha256||''),'RECEIPT_CONTEXT_MISMATCH');
 if(p.channel==='preview')fail(/^reader\/preview\/[A-Za-z0-9_./-]+\/index\.html$/.test(context.entry)&&!context.entry.includes('..')&&context.book.stage==='draft','PREVIEW_RECEIPT_REQUIRES_DRAFT_ROUTE');
 const payload={...r,...(p.channel==='preview'?{previewProtocol:'reader-immutable-preview-v3'}:{}),channel:p.channel,entry:context.entry,bookRecordSha256:v.objHash(context.book),reportSha256:context.reportSha256,publicFiles:context.publicFiles,issuedAt:new Date().toISOString(),trustBoundary:'Local evidence attestation, not independent reviewer authentication.'};
 return {schema:'reader-local-attestation-v1',payload,digest:v.objHash(payload)};
}
function verifyPlan(planFile,artifactFile,currentFile){
 const p=JSON.parse(fs.readFileSync(planFile)),now=Date.now();
 fail(p.schema==='reader-delivery-plan-v2'&&Number.isFinite(Date.parse(p.expiresAt))&&Date.parse(p.expiresAt)>now,'EXPIRED_OR_INVALID_PLAN');
 fail(v.hash(fs.readFileSync(artifactFile))===p.artifactSha256,'PLAN_ARTIFACT_CHANGED');
 if(p.operation==='promote')fail(currentFile&&v.hash(fs.readFileSync(currentFile))===p.expectedCurrentSha256,'TARGET_VERSION_CONFLICT');
 return p;
}
function completePlan(planFile,artifactFile,readbackFile,observedFileId){
 const p=JSON.parse(fs.readFileSync(planFile));
 fail(p.schema==='reader-delivery-plan-v2'&&v.hash(fs.readFileSync(artifactFile))===p.artifactSha256,'PLAN_ARTIFACT_CHANGED');
 fail(observedFileId&&(!p.targetFileId||p.targetFileId===observedFileId),'WRONG_TARGET_READBACK');
 fail(v.hash(fs.readFileSync(readbackFile))===p.artifactSha256,'POSTWRITE_READBACK_MISMATCH');
 return {schema:'reader-delivery-completion-v1',planSha256:v.hash(fs.readFileSync(planFile)),artifactSha256:p.artifactSha256,targetFileId:observedFileId,completedAt:new Date().toISOString()};
}
if(require.main===module){
 const[c,...a]=process.argv.slice(2);try{let r;if(c==='init')r=init(...a);else if(c==='init-resolved')r=initResolved(...a);else if(c==='authorize-preview')r=authorizePreview(...a);else if(c==='authorize-preview-v3')r=authorizePreviewV3(...a);else if(c==='correct')r=correct(...a);else if(c==='build')r=build(...a);else if(c==='plan')r=plan(a[0],JSON.parse(fs.readFileSync(a[1])));else if(c==='export')r=exportChecked(a[0],a[1],JSON.parse(fs.readFileSync(a[2])));else if(c==='verify-plan')r=verifyPlan(...a);else if(c==='complete-plan')r=completePlan(...a);else if(c==='issue')r=issue(a[0],JSON.parse(fs.readFileSync(a[1])),JSON.parse(fs.readFileSync(a[2])));else throw Error('Commands: init-resolved HTML PRIVATE_DIR BOOK_ID LOADER SOURCE_INDEX SOURCE_PREFLIGHT_REPORT | (legacy) init HTML PRIVATE_DIR BOOK_ID LOADER SOURCE_INDEX | authorize-preview MANIFEST CONVERSATION_EVIDENCE ASSESSMENT | authorize-preview-v3 MANIFEST ACTUAL_CONVERSATION_EVIDENCE FINAL_ASSESSMENT | correct MANIFEST EVENT | build MANIFEST | plan MANIFEST REQUEST | export MANIFEST OUT REQUEST | issue MANIFEST REQUEST CONTEXT | verify-plan PLAN ARTIFACT CURRENT | complete-plan PLAN ARTIFACT READBACK OBSERVED_FILE_ID');console.log(JSON.stringify(c==='init'||c==='init-resolved'||c==='build'||c==='correct'?{bookId:r.bookId,artifact:r.artifact,deliveryState:r.deliveryState||'blocked-unreviewed'}:r,null,2));}catch(e){console.error('BLOCK: '+e.message);process.exitCode=1;}
}
module.exports={init,initResolved,checkSourcePreflight,authorizePreview,authorizePreviewV3,correct,build,plan,exportChecked,issue,verifyPlan,completePlan};
