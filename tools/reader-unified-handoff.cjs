#!/usr/bin/env node
'use strict';
// Private, read-only handoff decision. No raw OCR, scan bytes or reviewer notes
// are printed. The public CI cannot inspect private sources. Do NOT confuse a
// result from this script with authenticated human proofreading.
const fs=require('node:fs'),path=require('node:path');
const v=require('./reader-release-control.cjs');
const phases=require('./reader-evidence-gate.cjs');
const {RULES}=require('./reader-quality-gate.cjs');
const SHA=/^[a-f0-9]{64}$/;
function load(file){return JSON.parse(fs.readFileSync(file,'utf8'));}
function same(a,b){return JSON.stringify(a)===JSON.stringify(b);}
function bytes(file){return fs.readFileSync(file);}
function validRange(r){return Array.isArray(r)&&r.length===2&&Number.isSafeInteger(r[0])&&Number.isSafeInteger(r[1])&&r[0]>0&&r[0]<=r[1];}
function extractBook(input,privateManifest=null){
 const s=input.toString('utf8');
 const m=s.match(/<script\b(?=[^>]*\bid=["'](?:embedded-data|bookdata)["'])[^>]*>([\s\S]*?)<\/script\s*>/i);
 if(!m)throw Error('EMBEDDED_BOOK_DATA_MISSING');
 let data=JSON.parse(m[1]);
 if(Array.isArray(data)){
  if(!privateManifest?.bookId||!validRange(privateManifest.range))throw Error('LEGACY_PRIVATE_BUNDLE_IDENTITY_REQUIRED');
  data={bookId:privateManifest.bookId,range:privateManifest.range,pages:data};
 }
 const pages=data.pages;
 if(!data||typeof data.bookId!=='string'||!validRange(data.range)||!Array.isArray(pages)||pages.length!==data.range[1]-data.range[0]+1||pages.some((p,i)=>p.scan!==data.range[0]+i))
  throw Error('EMBEDDED_BOOK_ID_RANGE_SEQUENCE_INVALID');
 return data;
}
function findAnomalies(data){
 const fields=v.textFields(data.pages||[]),out=[],seen=new Set();
 const patterns=[
  ['bad_unicode',/[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/gu],
  ['ocr_pipe',/[|¦￤]/gu],
  ['latin_fragment',/[A-Za-z]{2,}/g],
  ['ocr_punctuation_run',/[!！?？:：;；]{3,}/gu],
  ['ocr_ascii_plus',/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu]
 ];
 for(const [field,word]of Object.entries(fields)){
  for(const[kind,re]of patterns)for(const m of word.matchAll(re)){
   const id=v.objHash([field,kind,m.index,m[0]]);if(seen.has(id))continue;seen.add(id);
   out.push({id,field,kind,offset:m.index,sourceScan:Number(field.split('/')[0]),spanSha256:v.hash(m[0])});
  }
 }
 return out;
}
function checkSource(proof,artifact,ledgerRecord,errors){
 if(proof?.schema!=='reader-source-preflight-v1'||proof.status!=='source_ready_for_ocr'||
  proof.sourceArchiveSha256MatchesPinned!==true||!Array.isArray(proof.rangeImages)||
  proof.bookId!==ledgerRecord.bookId||!same(proof.range,ledgerRecord.range)||
  proof.sourceArchiveSha256!==ledgerRecord.sourceArchiveSha256){
  errors.push('SOURCE_ZIP_PROVENANCE_EVIDENCE_REQUIRED');return false;
 }
 const indices=new Map(proof.rangeImages.map(x=>[x.scan,x.sha256]));
 if(indices.size!==artifact.pages.length||artifact.pages.some(p=>p.sha256!==indices.get(p.scan))){
  errors.push('SOURCE_IMAGES_DO_NOT_MATCH_PRIOR_ZIP');return false;
 }
 return true;
}
function checkLedger(ledger,book,sha,errors,{allowKnownDefects=false}={}){
 if(ledger?.schema!=='reader-work-ledger-v1'||ledger.ruleset!=='20261116_0654_60-items'||!Array.isArray(ledger.books)){
  errors.push('SHARED_LEDGER_INVALID_OR_MISSING');return null;
 }
 const entries=ledger.books.filter(x=>x?.bookId===book.bookId&&same(x.range,book.range));
 if(entries.length!==1){errors.push('SHARED_LEDGER_IDENTITY_MISSING_OR_AMBIGUOUS');return null;}
 const entry=entries[0];
 if(entry.artifactSha256!==sha||entry.bookId!==book.bookId||!validRange(entry.range)||
   !SHA.test(entry.sourceArchiveSha256||''))errors.push('LEDGER_ARTIFACT_OR_SOURCE_VERSION_MISMATCH');
 if(!allowKnownDefects&&(entry.knownDefects||[]).some(x=>['open','failed','needs_source_review'].includes(x.status)))errors.push('UNRESOLVED_KNOWN_DEFECT_IN_LEDGER');
 return entry;
}
function checkProofreading(anomalies,reviewFile,book,sha,errors){
 if(!reviewFile){if(anomalies.length)errors.push('OCR_ANOMALY_REVIEW_MISSING');return 0;}
 const review=load(reviewFile);
 if(review.schema!=='reader-ocr-anomaly-review-v1'||review.bookId!==book.bookId||
  !same(review.range,book.range)||review.artifactSha256!==sha||!Array.isArray(review.items)){
  errors.push('OCR_REVIEW_VERSION_OR_SCHEMA_MISMATCH');return 0;
 }
 const byId=new Map(review.items.map(x=>[x.id,x]));
 let ok=0;
 for(const a of anomalies){
  const c=byId.get(a.id),page=book.pages.find(p=>p.scan===a.sourceScan);
  if(c?.decision==='source_confirmed'&&c.sourceImageSha256===page?.sha256&&
   c.spanSha256===a.spanSha256&&typeof c.reviewedBy==='string'&&c.reviewedBy.length>=2&&
   typeof c.reason==='string'&&c.reason.length>=12&&c.independentlyChecked===true)ok++;
 }
 if(ok!==anomalies.length)errors.push('UNRESOLVED_OCR_ANOMALIES');
 return ok;
}
function checkExplicitPreview(consent,book,sha,errors){
 if(!consent||consent.schema!=='reader-preview-consent-v1'||consent.bookId!==book.bookId||
  !same(consent.range,book.range)||consent.artifactSha256!==sha||
  consent.confirmedByUser!==true||consent.acknowledgesUncorrectedOCR!==true||
  typeof consent.requestText!=='string'||!/(未校正|一次OCR|OCR一次稿|校正前)/.test(consent.requestText)||
  !Number.isFinite(Date.parse(consent.requestedAt||''))){
  errors.push('USER_EXPLICIT_UNCORRECTED_PREVIEW_CONSENT_REQUIRED');return false;
 }
 // This file is still a human-entered attestation. It is NOT a host-signed token.
 return true;
}
function inspect(opts,inject={}){
 const errors=[],warnings=[];
 let file=null,sha=null,data=null,anomalies=[],resolvedAnomalies=0,entry=null;
 const mode=opts.mode||'normal';
 const report={schema:'reader-unified-handoff-v1',mode,status:'blocked',handoffAllowed:false,prepublicationAllowed:false,
  contentCertified:false,deviceVerified:false,publicHttpVerified:false,
  previewOnly:false,sourceValidated:false,ledgerValidated:false,canonical60Valid:false,
  bookId:null,range:null,artifactSha256:null,ocrAnomalyCount:0,
  ocrAnomalyKinds:{},ocrSourceConfirmed:0,errors,warnings};
 if(!['normal','preview','prepublication','audit'].includes(mode)){errors.push('MODE_NOT_SUPPORTED');return report;}
 try{
  if(!opts.artifact)throw Error('ARTIFACT_REQUIRED');
  file=bytes(opts.artifact);sha=v.hash(file);
  let identity=null;try{if(opts.manifest)identity=load(opts.manifest);}catch(_){}
  data=extractBook(file,identity);
  report.bookId=data.bookId;report.range=data.range;report.artifactSha256=sha;
  anomalies=findAnomalies(data);report.ocrAnomalyCount=anomalies.length;
  for(const a of anomalies)report.ocrAnomalyKinds[a.kind]=(report.ocrAnomalyKinds[a.kind]||0)+1;
 }catch(e){errors.push('PRIVATE_ARTIFACT_INVALID_'+e.message);return report;}
 // In audit mode we inventory unsafe content without authorizing delivery.
 if(mode==='audit'){
  errors.push('AUDIT_ONLY_NEVER_AUTHORISES_DELIVERY');
  if(anomalies.length)errors.push('OCR_SUSPECT_TEXT_REQUIRES_SOURCE_REVIEW');
  return report;
 }
 let ledger;try{ledger=load(opts.ledger);}catch(_){errors.push('SHARED_LEDGER_READBACK_MISSING');}
 if(ledger){
  // Never stop at a bare error: offer the next exact source-review task from
  // the same work ledger. This is advice, not additional release authorization.
  try{
   const repair=require('./reader-repair-plan.cjs').plan(ledger,data.bookId,
    opts.repairProgress?load(opts.repairProgress):null);
   if(repair.status==='work_ready'&&repair.originalReaderStillBlocked){
    report.nextRepairAction=repair.nextAction;
    report.remainingRepairWorkItems=repair.remainingWorkItems;
    report.repairWorkingDraftSha256=repair.workingDraftSha256;
   }
  }catch(_){warnings.push('REPAIR_PROGRESS_UNAVAILABLE');}
  entry=checkLedger(ledger,data,sha,errors,{allowKnownDefects:mode==='preview'});
  if(entry&&!errors.some(x=>x.startsWith('LEDGER_')||x.startsWith('SHARED_LEDGER_'))){
   report.ledgerValidated=true;
  }
 }
 if(!entry)return report;
 let source;
 try{source=load(opts.sourceProof);}catch(_){errors.push('SOURCE_PREFLIGHT_REPORT_UNAVAILABLE');}
 if(source)report.sourceValidated=checkSource(source,data,entry,errors);
 if(mode==='normal'||mode==='prepublication'){
  try{resolvedAnomalies=checkProofreading(anomalies,opts.ocrReview,data,sha,errors);}
  catch(_){errors.push('OCR_REVIEW_UNREADABLE');}
 }else if(anomalies.length){
  warnings.push('PREVIEW_OCR_ANOMALIES_NOT_CERTIFIED');
 }
 report.ocrSourceConfirmed=resolvedAnomalies;
 let privateManifest;
 try{privateManifest=load(opts.manifest);}catch(_){errors.push('PRIVATE_MANIFEST_REQUIRED');}
 if(privateManifest){
  if(privateManifest.bookId!==data.bookId||!same(privateManifest.range,data.range)||
    privateManifest.artifact?.sha256!==sha)errors.push('PRIVATE_MANIFEST_ARTIFACT_OR_RANGE_MISMATCH');
  else{
   try{
    const validate=inject.validate||v.validateBundle;
    const phase=mode==='preview'?'preview':mode==='prepublication'?'release':'device';
    const result=phases.inspect(opts.manifest,phase,(file,{phase})=>validate(file,{phase}));
    if(!result.eligible)errors.push('CANONICAL_STAGE_NOT_PASSED_'+(result.stages.find(s=>s.decision==='blocked')?.phase||'unknown'));
    else if(mode==='preview'){
      report.previewOnly=true;
      warnings.push('PREVIEW_IS_UNCORRECTED_AND_NOT_COMPLETE');
    }else{
      const production=validate(opts.manifest,{phase});
      const all=production.checks||{};
      const exact=Object.keys(all).length===RULES.length&&RULES.every(id=>all[id]&&
       (['passed','not_applicable'].includes(all[id].status)||
        (mode==='prepublication'&&['G8-03','G8-04'].includes(id)&&all[id].status==='not_run')));
      if(!exact)errors.push('ALL_CANONICAL_60_EVIDENCE_NOT_COMPLETE');
      else if(mode==='prepublication')report.canonicalPrepublicationValid=true;
      else report.canonical60Valid=true;
      let publicReport;
      if(mode==='normal')try{publicReport=load(opts.publicEvidence);}catch(_){errors.push('PUBLIC_HTTP_EVIDENCE_REQUIRED');}
      if(mode==='normal'&&publicReport){
       const combined=phases.attachPublicEvidence(result,publicReport);
       report.publicHttpVerified=combined.publicUrlHttpVerified===true;
       report.deviceVerified=result.stages.some(s=>s.phase==='device'&&s.decision==='passed');
       if(!combined.completedDelivery)errors.push('DEVICE_OR_PUBLIC_HTTP_COMPLETION_REQUIRED');
      }
    }
   }catch(e){errors.push('CANONICAL_VERIFIER_ERROR_'+e.message);}
  }
 }
 if(mode==='preview'){
  let consent;try{consent=load(opts.previewConsent);}catch(_){}
  checkExplicitPreview(consent,data,sha,errors);
 }
 if((mode==='normal'||mode==='prepublication')&&(entry.qualityState!=='reviewed'||entry.releaseStatus!=='candidate')){
  errors.push('LEDGER_NOT_APPROVED_FOR_FINAL_READER');
 }
 // A matching public SHA only proves URL bytes, not that the book was proofread.
 report.prepublicationAllowed=errors.length===0&&mode==='prepublication'&&report.sourceValidated&&
  report.ledgerValidated&&report.canonicalPrepublicationValid===true;
 report.handoffAllowed=errors.length===0&&report.sourceValidated&&report.ledgerValidated&&
  (mode==='preview'?report.previewOnly:mode==='normal'&&report.canonical60Valid&&report.deviceVerified&&report.publicHttpVerified);
 report.status=report.prepublicationAllowed?'verified_prepublication_only':report.handoffAllowed?(mode==='preview'?'unverified_preview_only':'verified_release'):'blocked';
 report.contentCertified=report.handoffAllowed&&mode==='normal';
 return report;
}
function main(argv){
 const opts={};
 for(let i=0;i<argv.length;i++){
  const a=argv[i];
  if(!a.startsWith('--'))throw Error('BAD_OPTION '+a);
  const key={'--mode':'mode','--artifact':'artifact','--manifest':'manifest','--ledger':'ledger',
   '--source-proof':'sourceProof','--ocr-review':'ocrReview','--public-evidence':'publicEvidence',
   '--preview-consent':'previewConsent','--repair-progress':'repairProgress','--report':'report'}[a];
  if(!key)throw Error('BAD_OPTION '+a);
  opts[key]=argv[++i];if(!opts[key])throw Error('OPTION_VALUE_MISSING '+a);
 }
 if(!opts.artifact)throw Error('Usage: node tools/reader-unified-handoff.cjs --artifact PRIVATE.html --mode normal|prepublication|preview|audit --ledger PRIVATE/ledger.json --manifest PRIVATE/manifest.json --source-proof PRIVATE/source-preflight.json [--ocr-review PRIVATE/review.json] [--public-evidence PRIVATE/http.json] [--preview-consent PRIVATE/consent.json] [--report PRIVATE/report.json]');
 const out=inspect(opts),data=JSON.stringify(out,null,2)+'\n';
 if(opts.report){
  const dst=path.resolve(opts.report),repo=path.resolve(__dirname,'..');
  if(dst===repo||dst.startsWith(repo+path.sep))throw Error('PRIVATE_QA_REPORT_MUST_NOT_BE_COMMITTED');
  fs.mkdirSync(path.dirname(dst),{recursive:true});fs.writeFileSync(dst,data,{flag:'wx',mode:0o600});
 }
 process.stdout.write(data);
 if(!out.handoffAllowed&&!out.prepublicationAllowed)process.exitCode=1;
}
if(require.main===module){
 try{main(process.argv.slice(2));}catch(e){console.error('HANDOFF_BLOCKED '+e.message);process.exitCode=2;}
}
module.exports={inspect,findAnomalies,extractBook,checkSource,checkLedger,checkProofreading,checkExplicitPreview};
