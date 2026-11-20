#!/usr/bin/env node
'use strict';
// Fail-closed post-deploy issuance. No source text or scans are published here.
// Requires fresh, same-run public GET evidence; never claims iPhone accessibility.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const MAX_AGE_MS=10*60*1000;
const ORIGIN='https://pirokiiiiito-arch.github.io';

function blocked(message){throw Error('LINK_ISSUANCE_BLOCKED: '+message);}
function digest(buf){return crypto.createHash('sha256').update(buf).digest('hex');}
function validate(evidence, targets, options={}){
 const now=options.now??Date.now();
 const commit=options.commit??process.env.GITHUB_SHA;
 const runId=options.runId??process.env.GITHUB_RUN_ID;
 const root=options.root;
 if(!commit||!runId)blocked('CURRENT_GITHUB_RUN_IDENTITY_MISSING');
 if(!evidence||evidence.schema!=='reader-public-delivery-evidence-v1'||evidence.eligible!==true||
    evidence.contentCertified!==false||evidence.iphoneVerified!==false)blocked('PUBLIC_DELIVERY_EVIDENCE_NOT_APPROVED');
 if(evidence.sourceCommitSha!==commit||evidence.workflowRunId!==runId)blocked('EVIDENCE_FROM_OTHER_RUN');
 const checked=Date.parse(evidence.checkedAt);
 if(!Number.isFinite(checked)||checked>now+30_000||now-checked>MAX_AGE_MS)blocked('EVIDENCE_MISSING_OR_STALE');
 if(!Array.isArray(targets)||!targets.length||!Array.isArray(evidence.checks)||evidence.checks.length!==targets.length)
   blocked('MISSING_OR_EXTRA_BOOK_CHECKS');
 const checks=new Map();
 for(const item of evidence.checks){
  if(!item||typeof item.entry!=='string'||checks.has(item.entry))blocked('MALFORMED_OR_DUPLICATE_CHECK');
  checks.set(item.entry,item);
 }
 const links=[];
 for(const target of targets){
  if(!target||!/^reader\/[a-zA-Z0-9_./-]+\/index\.html$/.test(target.entry)||target.entry.includes('..')||
     !/^[0-9a-f]{64}$/.test(target.expectedSha256))blocked('INVALID_RELEASE_TARGET');
  let parsed;
  try{parsed=new URL(target.url);}catch(_){blocked('INVALID_TARGET_URL');}
  if(parsed.origin!==ORIGIN||parsed.pathname!=='/flashcards/'+target.entry||parsed.username||parsed.password||parsed.hash||
     parsed.toString()!==target.url||
     !['','?import=1'].includes(parsed.search))blocked('TARGET_URL_NOT_CANONICAL');
  if(root){
   const base=fs.realpathSync(root), local=path.resolve(base,target.entry);
   if(!local.startsWith(base+path.sep)||!fs.existsSync(local)||fs.lstatSync(local).isSymbolicLink()||
      !fs.statSync(local).isFile()||digest(fs.readFileSync(local))!==target.expectedSha256)
      blocked('LOCAL_ADMITTED_BYTES_MISMATCH');
  }
  const got=checks.get(target.entry);
  if(!got||got.bookId!==target.bookId||got.entry!==target.entry||got.url!==target.url||
     got.requestMethod!=='GET'||got.requestedUrl!==target.url||got.finalUrl!==target.url||
     got.redirectPolicy!=='manual'||got.redirected!==false||
     got.expectedSha256!==target.expectedSha256||got.observedSha256!==target.expectedSha256||
     got.status!=='verified'||got.httpStatus!==200||
     !Number.isSafeInteger(got.attemptsUsed)||got.attemptsUsed<1||got.attemptsUsed>4)
    blocked('GET_NOT_VERIFIED_FOR_EXACT_ENTRY');
  links.push({bookId:target.bookId,url:target.url,entry:target.entry,
    sha256:target.expectedSha256,remoteGet:'verified',deviceAccess:'not_run'});
 }
 if(checks.size!==links.length)blocked('EXTRA_DELIVERY_EVIDENCE');
 return {schema:'reader-verified-link-catalog-v1',approvedAt:new Date(now).toISOString(),
   sourceCommitSha:commit,workflowRunId:runId,evidenceCheckedAt:evidence.checkedAt,
   verifiedPublicLinks:links,contentCertified:false,iphoneVerified:false};
}
function issue(root,evidencePath,outputPath,options={}){
 outputPath=path.resolve(outputPath);
 const textPath=outputPath.replace(/\.json$/,'')+'.txt';
 // On any retry, never leave previously approved links behind.
 for(const p of [outputPath,textPath])if(fs.existsSync(p))fs.unlinkSync(p);
 const evidence=JSON.parse(fs.readFileSync(evidencePath,'utf8'));
 // Import lazily so this policy module's negative tests don't require a whole repo fixture.
 const {selectTargets}=options.selectTargets?{selectTargets:options.selectTargets}:require('./reader-verify-pages.cjs');
 const targets=selectTargets(root);
 const result=validate(evidence,targets,{...options,root});
 fs.mkdirSync(path.dirname(outputPath),{recursive:true});
 // A temporary file is renamed only after validation completes.
 const temp=outputPath+'.tmp-'+process.pid;
 try{
  fs.writeFileSync(temp,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  fs.renameSync(temp,outputPath);
  fs.writeFileSync(textPath,result.verifiedPublicLinks.map(x=>x.url).join('\n')+'\n',{flag:'wx'});
 }catch(e){
  if(fs.existsSync(temp))fs.unlinkSync(temp);
  for(const p of [outputPath,textPath])if(fs.existsSync(p))fs.unlinkSync(p);
  throw e;
 }
 return result;
}
if(require.main===module){
 const [root,evidencePath,outputPath]=process.argv.slice(2);
 try{
  if(!root||!evidencePath||!outputPath)blocked('Usage: issuer SOURCE_ROOT SAME_RUN_EVIDENCE OUTPUT_JSON');
  const receipt=issue(root,evidencePath,outputPath);
  console.log(JSON.stringify({approved:true,links:receipt.verifiedPublicLinks.length,output:outputPath}));
 }catch(e){console.error(e.message);process.exitCode=2;}
}
module.exports={validate,issue};
