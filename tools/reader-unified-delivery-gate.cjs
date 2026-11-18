#!/usr/bin/env node
'use strict';
// Unified PRIVATE handoff verdict. Fail closed, never treats preview as normal.
// No book text, source images, Drive credentials or private ledgers in GitHub.
const fs=require('node:fs'),path=require('node:path');
const v=require('./reader-release-control.cjs');
const stages=require('./reader-evidence-gate.cjs');
const RULES=require('./reader-quality-gate.cjs').RULES;
const SHA=/^[a-f0-9]{64}$/;
const POLICY='reader-central-quality-ledger-v1';
function isSha(s){return typeof s==='string'&&SHA.test(s);}
function read(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function sha(file){return v.hash(fs.readFileSync(file));}
function noRepo(file) {
 const repo=path.resolve(__dirname,'..'),f=path.resolve(file);
 if(f===repo||f.startsWith(repo+path.sep))throw Error('PRIVATE_EVIDENCE_CANNOT_LIVE_IN_PUBLIC_REPO');
}
function captureAlerts(fields,profile){
 const issues=[],seen=new Set();
 if(profile!=='novel'&&profile!=='world_history_1')return issues;
 const patterns=[
  ['replacement',/\uFFFD|[\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu],
  ['vertical-pipe',/[|｜]/gu],
  ['latin-japanese-join',/[ぁ-んァ-ン一-龯][A-Za-z]{2,}|[A-Za-z]{2,}[ぁ-んァ-ン一-龯]/gu],
  ['ocr-plus-kana',/[+＋][ぁ-んァ-ン]/gu],
  ['unclosed-ocr-bracket',/[［\[](?=[ぁ-んァ-ン一-龯])/gu]
 ];
 for(const [field,t] of Object.entries(fields)){
  if(typeof t!=='string')continue;
  for(const [kind,re] of patterns)for(const m of t.matchAll(re)){
   const id=v.objHash([field,kind,m.index,m[0]]);
   if(seen.has(id))continue;seen.add(id);
   // Only hashes / positions leave this helper. Do not emit copyrighted text.
   issues.push({id,field,kind,offset:m.index,matchSha256:v.hash(m[0])});
  }
 }
 return issues;
}
function ledgerEntry(ledger,bookId,range,artifactSha){
 if(ledger?.schema!==POLICY||!Array.isArray(ledger.entries)||!Number.isSafeInteger(ledger.revision)||ledger.revision<1)
  throw Error('INVALID_CENTRAL_LEDGER');
 const a=ledger.entries.filter(x=>x&&x.bookId===bookId&&
  Array.isArray(x.range)&&x.range[0]===range[0]&&x.range[1]===range[1]&&
  x.artifactSha256===artifactSha);
 if(a.length!==1)throw Error(a.length?'DUPLICATE_LEDGER_VERSION':'ARTIFACT_NOT_REGISTERED_IN_LEDGER');
 return a[0];
}
function verifyExplicitPreview(consent,bookId,artifactSha){
 if(!consent||consent.schema!=='reader-unverified-preview-consent-v1'||
 consent.bookId!==bookId||consent.artifactSha256!==artifactSha||
 consent.userExplicitlyRequestedUnverifiedPreview!==true||
 consent.confirmedOCRMayContainErrors!==true||
 consent.allowedChannel!=='preview'||consent.scope!=='this-exact-artifact'||
 typeof consent.literalUserRequest!=='string'||consent.literalUserRequest.trim().length<12||
 !/(未校正|OCR一次稿|校正前|確認用プレビュー|未検証|unverified|uncorrected)/i.test(consent.literalUserRequest)||
 !Number.isFinite(Date.parse(consent.at))||
 !Number.isFinite(Date.parse(consent.expiresAt))||Date.parse(consent.expiresAt)<=Date.parse(consent.at))
 return false;
 return true;
}
function validateLedgerReview(rec,alerts){
 const issues=[];
 if(rec.quality?.status!=='independently_verified')issues.push('LEDGER_NOT_INDEPENDENTLY_VERIFIED');
 if(!Array.isArray(rec.quality?.openFindings)||rec.quality.openFindings.length!==0)
  issues.push('LEDGER_UNRESOLVED_SOURCE_DEFECTS');
 if(!isSha(rec.quality?.independentReviewSha256))issues.push('NO_PINNED_INDEPENDENT_REVIEW');
 const reviewed=new Map((rec.quality?.anomalyResolutions||[]).filter(x=>x&&typeof x.id==='string').map(x=>[x.id,x]));
 for(const a of alerts){
  const x=reviewed.get(a.id);
  if(!x||x.decision!=='source_confirmed'||!x.reason||!x.sourceRegionId||
   !x.reviewedBy||!isSha(x.sourceSha256))issues.push('SUSPECT_OCR_NOT_SOURCE_VERIFIED');
 }
 return [...new Set(issues)];
}
function driveProof(opts,manifestSha,artifactSha){
 const errors=[];
 if(!opts.driveReadback||!opts.driveFileId||!opts.driveReceiptFile){
  errors.push('DRIVE_SAME_ID_READBACK_REQUIRED');return errors;
 }
 const record=read(opts.driveReceiptFile);
 if(record.schema!=='reader-drive-same-id-readback-v1'||
    record.fileId!==opts.driveFileId||
    record.manifestSha256!==manifestSha||
    record.artifactSha256!==artifactSha||
    record.readbackSha256!==artifactSha||
    record.sourceProvider!=='google-drive'){
  errors.push('DRIVE_READBACK_RECORD_MISMATCH');
 }
 if(sha(opts.driveReadback)!==artifactSha)errors.push('DRIVE_READBACK_BYTES_DIFFER');
 return errors;
}
function publicProof(opts,entry,loaderSha){
 if(!opts.chromeUrl)return [];
 if(!opts.publicEvidenceFile)return ['PUBLIC_HTTP_EVIDENCE_MISSING'];
 const d=read(opts.publicEvidenceFile),url=new URL(opts.chromeUrl);
 const matching=(d.checks||[]).filter(c=>c.bookId===entry.publicBookId&&
   c.entry===entry.publicEntry&&c.url===opts.chromeUrl&&
   c.status==='verified'&&c.httpStatus===200&&
   c.expectedSha256===loaderSha&&c.observedSha256===loaderSha);
 if(url.protocol!=='https:'||d.schema!=='reader-public-delivery-evidence-v1'||
    d.eligible!==true||matching.length!==1)return ['PUBLIC_HTTP_SHA_OR_ENTRY_MISMATCH'];
 return [];
}
function inspect(opts){
 const errors=[],warnings=[];
 const add=(s)=>{if(!errors.includes(s))errors.push(s);};
 const channel=opts.channel||'production',step=opts.step||'delivery';
 if(!['production','preview'].includes(channel))add('INVALID_CHANNEL');
 if(!['stage','delivery'].includes(step))add('INVALID_STEP');
 try{
  for(const p of ['manifest','artifact','ledger']){
   if(!opts[p])throw Error('REQUIRED_PRIVATE_'+p.toUpperCase());
   noRepo(opts[p]);
  }
  const manifest=read(opts.manifest),ledger=read(opts.ledger);
  const artifactSha=sha(opts.artifact),manifestSha=sha(opts.manifest);
  if(manifest.schema!=='reader-private-bundle-v2')add('INVALID_PRIVATE_MANIFEST');
  if(!manifest.artifact||manifest.artifact.sha256!==artifactSha)add('ACTUAL_ARTIFACT_NOT_IN_MANIFEST');
  if(!Array.isArray(manifest.range)||manifest.range.length!==2)add('BAD_MANIFEST_RANGE');
  const range=manifest.range||[];
  const rec=ledgerEntry(ledger,manifest.bookId,range,artifactSha);
  if(rec.profile!=='novel'&&rec.profile!=='world_history_1')add('UNKNOWN_BOOK_PROFILE');
  if(rec.originalIndexSha256!==manifest.originalIndex?.sha256)add('SOURCE_INDEX_VERSION_MISMATCH');
  if(rec.canonicalSha256!==manifest.canonical?.sha256)add('CORRECTION_REVISION_MISMATCH');
  if(rec.ledgerState==='retired')add('RETIRED_ARTIFACT_CANNOT_BE_DELIVERED');
  let fields={},alerts=[];
  try{
   const data=v.extract(fs.readFileSync(opts.artifact)).pages;
   fields=v.textFields(data);
   alerts=captureAlerts(fields,rec.profile);
  }catch(e){add('UNSUPPORTED_OR_CORRUPT_READER_HTML');}
  const requestedPhase=channel==='preview'?'preview':step==='stage'?'prepare':'device';
  const gate=stages.inspect(opts.manifest,requestedPhase);
  if(!gate.eligible)add('CANONICAL_SIXTY_PHASE_BLOCKED');
  if(gate.bookId!==manifest.bookId)add('CORE_GATE_IDENTITY_MISMATCH');
  if(gate.stages?.[0]?.artifactSha256!==artifactSha)add('CORE_GATE_ARTIFACT_CHANGED');
  if(channel==='preview'){
   if(!opts.consentFile){add('EXPLICIT_UNVERIFIED_PREVIEW_CONSENT_MISSING');}
   else if(!verifyExplicitPreview(read(opts.consentFile),manifest.bookId,artifactSha))
     add('EXPLICIT_UNVERIFIED_PREVIEW_CONSENT_INVALID');
   if(rec.quality?.status==='independently_verified')warnings.push('PREVIEW_FOR_ALREADY_VERIFIED_SOURCE');
   if(alerts.length)warnings.push('PREVIEW_CONTAINS_UNRESOLVED_OCR_ALERTS');
  }else{
   for(const e of validateLedgerReview(rec,alerts))add(e);
  }
  if(step==='delivery'){
   for(const e of driveProof(opts,manifestSha,artifactSha))add(e);
   if(opts.chromeUrl){
    if(rec.publicEntry!==opts.publicEntry||rec.publicBookId!==opts.publicBookId||
      rec.chromeUrl!==opts.chromeUrl)add('LEDGER_PUBLIC_ENTRY_MISMATCH');
    for(const e of publicProof(opts,rec,manifest.loaderSha256))add(e);
   }else if(channel==='production')add('PRODUCTION_PUBLIC_ENTRY_PROOF_REQUIRED');
  }
  const eligible=errors.length===0;
  return {schema:'reader-unified-delivery-verdict-v1',
   eligible,status:!eligible?'blocked':channel==='preview'?'explicit_unverified_preview_only':
     step==='stage'?'private_staging_only':'normal_delivery_verified',
   channel,step,bookId:manifest.bookId,range,artifactSha256:artifactSha,
   manifestSha256:manifestSha,ledgerRevision:ledger.revision,
   ledgerSha256:sha(opts.ledger),independentReviewClaimed:rec.quality?.status||'unknown',
   suspiciousOCRAlerts:alerts.length,
   suspiciousOCRAlertKinds:[...new Set(alerts.map(x=>x.kind))],
   core60RequestedPhase:requestedPhase,core60Eligible:gate.eligible,
   driveReadbackChecked:step==='delivery'&&!!opts.driveReadback&&!errors.some(x=>x.startsWith('DRIVE_')),
   publicHTTPVerified:step==='delivery'&&!!opts.chromeUrl&&!errors.some(x=>x.startsWith('PUBLIC_')||x.startsWith('LEDGER_PUBLIC_')),
   actualIPhoneCertified:channel==='production'&&step==='delivery'&&gate.eligible,
   completedDelivery:eligible&&channel==='production'&&step==='delivery',
   errors,warnings,
   note:'This tool validates reported evidence and exact bytes. It cannot authenticate a human reviewer or intercept arbitrary chat attachments.'};
 }catch(e){
  add(e.message.startsWith('REQUIRED_PRIVATE_')?e.message:
   e.message.startsWith('PRIVATE_EVIDENCE_')?e.message:
   e.message.startsWith('ARTIFACT_NOT_REGISTERED')?e.message:
   e.message.startsWith('DUPLICATE_LEDGER_')?e.message:'INPUT_OR_EVIDENCE_UNAVAILABLE');
  return {schema:'reader-unified-delivery-verdict-v1',eligible:false,status:'blocked',
   channel,step,completedDelivery:false,errors,warnings};
 }
}
function main(argv){
 const args={};
 for(let i=0;i<argv.length;i++){
  const key=argv[i];if(!/^--[a-z-]+$/.test(key)||i+1>=argv.length)throw Error('INVALID_CLI_ARGUMENT');
  const k=key.slice(2).replace(/-([a-z])/g,(_,c)=>c.toUpperCase());
  if(!['manifest','artifact','ledger','channel','step','consentFile','driveReadback','driveFileId','driveReceiptFile',
   'chromeUrl','publicEvidenceFile','publicEntry','publicBookId','report'].includes(k))throw Error('UNKNOWN_ARGUMENT '+key);
  args[k]=argv[++i];
 }
 const report=inspect(args),data=JSON.stringify(report,null,2)+'\n';
 if(args.report){noRepo(args.report);fs.mkdirSync(path.dirname(path.resolve(args.report)),{recursive:true});fs.writeFileSync(args.report,data,{mode:0o600});}
 process.stdout.write(data);
 if(!report.eligible)process.exitCode=1;
}
if(require.main===module){
 try{main(process.argv.slice(2));}catch(e){process.stderr.write('BLOCK: '+e.message+'\n');process.exitCode=2;}
}
module.exports={inspect,captureAlerts,verifyExplicitPreview,validateLedgerReview,ledgerEntry};
