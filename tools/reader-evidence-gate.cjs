#!/usr/bin/env node
'use strict';
// Read-only phase evidence: calls the existing 60-item verifier; never awards a new quality pass.
const fs=require('node:fs'),path=require('node:path');
const verifier=require('./reader-release-control.cjs');
const PHASES=Object.freeze(['prepare','release','deployed','device']);
const ALL_PHASES=Object.freeze(['preview',...PHASES]);
function inspect(manifestFile,phase='prepare',validate=verifier.validateBundle){
 if(!ALL_PHASES.includes(phase))throw Error('INVALID_REQUESTED_PHASE');
 const manifest=path.resolve(manifestFile);
 const manifestSha256=verifier.hash(fs.readFileSync(manifest));
 const order=phase==='preview'?['preview']:PHASES.slice(0,PHASES.indexOf(phase)+1);
 const stages=[];let identity=null,bookId=null,loaderSha256=null,failed=false;
 for(const step of order){
  const result=validate(manifest,{phase:step});
  const errors=Array.isArray(result?.errors)?result.errors.slice():['INVALID_VERIFIER_RESPONSE'];
  if(result?.eligible!==true&&!errors.length)errors.push('VALIDATOR_DID_NOT_APPROVE');
  const id=result?.subjectSha256||null,artifactSha256=result?.subject?.artifactSha256||null;
  const currentBookId=result?.subject?.bookId||null,currentLoader=result?.subject?.loaderSha256||null;
  if(result?.eligible===true&&(!/^[a-f0-9]{64}$/.test(id||'')||!/^[a-f0-9]{64}$/.test(artifactSha256||'')))errors.push('MISSING_VERIFIED_SUBJECT');
  if(result?.eligible===true&&(!currentBookId||!/^[a-f0-9]{64}$/.test(currentLoader||'')))errors.push('MISSING_VERIFIED_LOADER');
  if(bookId&&currentBookId!==bookId)errors.push('BOOK_CHANGED_BETWEEN_PHASES');
  if(loaderSha256&&currentLoader!==loaderSha256)errors.push('LOADER_CHANGED_BETWEEN_PHASES');
  if(identity&&id!==identity)errors.push('SOURCE_VERSION_CHANGED_BETWEEN_PHASES');
  if(!identity&&id)identity=id;
  if(!bookId&&currentBookId)bookId=currentBookId;
  if(!loaderSha256&&currentLoader)loaderSha256=currentLoader;
  const passed=result?.eligible===true&&errors.length===0;
  stages.push({
   phase:step,decision:passed?'passed':'blocked',
   subjectSha256:id,artifactSha256,loaderSha256:currentLoader,
   evidenceIndex:passed?(result.evidenceIndex||null):null,
   errors
  });
  if(!passed){failed=true;break;}
 }
 if(failed)for(const step of order.slice(stages.length))stages.push({phase:step,decision:'not_evaluated',reason:'PRIOR_PHASE_BLOCKED'});
 const eligible=!failed&&stages.length===order.length;
 return {
  schema:'reader-stage-evidence-gate-v1',
  requestedPhase:phase,
  manifestSha256,subjectSha256:identity,bookId,loaderSha256,
  eligible,decision:eligible?'advance_allowed':'advance_blocked',
  stages,
  // Preview is not a successful prepare. A deployment flag alone does not prove HTTP delivery.
  classification:!eligible?'blocked':phase==='preview'?'unverified_preview_only':
   phase==='prepare'?'private_staging_only':phase==='release'?'release_evidence_only':
   phase==='deployed'?'deployment_evidence_only_http_not_checked':'device_evidence_only_http_not_checked',
  publicUrlHttpVerified:false,
  contentCertified:eligible&&phase!=='preview'&&phase!=='prepare',
  completedDelivery:false
 };
}
function attachPublicEvidence(report,publicReport){
 // This cross-check does not replace reading the public URL; verify-pages must produce it.
 const matches=report.eligible&&['deployed','device'].includes(report.requestedPhase)&&
  publicReport?.schema==='reader-public-delivery-evidence-v1'&&
  publicReport.eligible===true&&Array.isArray(publicReport.checks)?
  publicReport.checks.filter(x=>x.bookId===report.bookId&&
   x.status==='verified'&&x.httpStatus===200&&
   x.expectedSha256===report.loaderSha256&&x.observedSha256===report.loaderSha256):[];
 const proof=matches.length===1?matches[0]:null;
 return {...report,publicUrlHttpVerified:!!proof,
  deliveryDecision:!report.eligible?'blocked_private_evidence':
   !proof?'blocked_public_http_evidence':
   report.requestedPhase==='device'?'completed_with_device_evidence':'published_at_checked_time_device_pending',
  completedDelivery:!!proof&&report.requestedPhase==='device',
  publicEvidence:proof?{
   bookId:proof.bookId,entry:proof.entry,url:proof.url,sha256:proof.observedSha256,
   checkedAt:publicReport.checkedAt,sourceCommitSha:publicReport.sourceCommitSha||null,
   workflowRunId:publicReport.workflowRunId||null
  }:null};
}
if(require.main===module){
 try{
  const[file,phase='prepare',output,publicReportFile]=process.argv.slice(2);
  if(!file)throw Error('Usage: node tools/reader-evidence-gate.cjs PRIVATE_MANIFEST [preview|prepare|release|deployed|device] [PRIVATE_REPORT.json] [PAGES_HTTP_EVIDENCE.json]');
  const phaseResult=inspect(file,phase);
  const result=publicReportFile?attachPublicEvidence(phaseResult,JSON.parse(fs.readFileSync(publicReportFile))):phaseResult;
  const json=JSON.stringify(result,null,2)+'\n';
  if(output){
   const dst=path.resolve(output),repo=path.resolve(__dirname,'..');
   if(dst===repo||dst.startsWith(repo+path.sep))throw Error('EVIDENCE_REPORT_MUST_REMAIN_PRIVATE');
   fs.mkdirSync(path.dirname(dst),{recursive:true});
   fs.writeFileSync(dst,json,{mode:0o600});
  }
  process.stdout.write(json);
  if(!result.eligible||(publicReportFile&&!result.publicUrlHttpVerified))process.exitCode=1;
 }catch(e){process.stderr.write('BLOCK: '+e.message+'\n');process.exitCode=1;}
}
module.exports={inspect,attachPublicEvidence,PHASES};
