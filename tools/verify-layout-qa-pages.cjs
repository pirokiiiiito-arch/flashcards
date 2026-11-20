#!/usr/bin/env node
'use strict';
// Verify only the public generic QA program. No private book is read or uploaded.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const entry='templates/reader/v2/layout-qa.html';
const origin='https://pirokiiiiito-arch.github.io/flashcards/';
const sha256=value=>crypto.createHash('sha256').update(value).digest('hex');
async function checkPublicLayoutQA(root,fetcher=fetch,options={}){
 const expectedSha256=sha256(fs.readFileSync(path.join(root,entry)));
 const attempts=options.attempts??5;
 if(!Number.isInteger(attempts)||attempts<1||attempts>5)throw Error('INVALID_ATTEMPTS');
 const wait=options.wait||((ms)=>new Promise(resolve=>setTimeout(resolve,ms)));
 const url=origin+entry,requestUrl=url+'?sha='+expectedSha256;
 let check={entry,url,expectedSha256,observedSha256:null,httpStatus:null,status:'blocked',error:'NOT_TESTED',attemptsUsed:0};
 for(let attempt=1;attempt<=attempts;attempt++){
  check.attemptsUsed=attempt;
  try{
   const response=await fetcher(requestUrl,{cache:'no-store',redirect:'error',headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(10000)});
   check.httpStatus=response.status;check.observedSha256=null;
   if(response.status!==200)check.error='HTTP_'+response.status;
   else{
    check.observedSha256=sha256(Buffer.from(await response.arrayBuffer()));
    if(check.observedSha256===expectedSha256){check.status='verified';delete check.error;break;}
    check.error='DEPLOYED_BYTES_DIFFER';
   }
  }catch(error){check.httpStatus=null;check.observedSha256=null;check.error='NETWORK_OR_FETCH_'+(error?.name||'UnknownError');}
  if(attempt<attempts)await wait(attempt*1000);
 }
 return {schema:'reader-layout-qa-public-evidence-v1',checkedAt:new Date().toISOString(),
  sourceCommitSha:process.env.GITHUB_SHA||null,purpose:'generic-qa-tool-publication-only',
  eligible:check.status==='verified',checks:[check],contentCertified:false,
  bookReleaseEligible:false,iphoneVerified:false};
}
if(require.main===module){
 (async()=>{
  const output=process.argv[2],root=process.argv[3]||path.resolve(__dirname,'..');
  const report=await checkPublicLayoutQA(root),content=JSON.stringify(report,null,2)+'\n';
  if(output){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,content);}
  process.stdout.write(content);if(!report.eligible)process.exitCode=1;
 })().catch(error=>{process.stderr.write('BLOCK: '+error.message+'\n');process.exitCode=1;});
}
module.exports={checkPublicLayoutQA,entry};
