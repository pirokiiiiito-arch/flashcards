#!/usr/bin/env node
'use strict';
// Verify the public synthetic novel demo and shared WH1 standard.js bytes, never private book data.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const origin='https://pirokiiiiito-arch.github.io/flashcards/';
const files=['templates/reader/v2/novel.html','templates/reader/v2/novel.css',
 'templates/reader/v2/novel-dialogue.js','templates/reader/v2/novel.js',
 'templates/reader/v2/standard.css','templates/reader/v2/standard.js'];
const sha256=x=>crypto.createHash('sha256').update(x).digest('hex');
async function checkPublicNovel(root,fetcher=fetch,options={}){
 const attempts=options.attempts||5;
 const wait=options.wait||((ms)=>new Promise(r=>setTimeout(r,ms)));
 const checks=await Promise.all(files.map(async entry=>{
  const expectedSha256=sha256(fs.readFileSync(path.join(root,entry)));
  const url=origin+entry,fullURL=url+'?sha='+expectedSha256.slice(0,16);
  let error='NOT_TESTED',httpStatus=null,observedSha256=null;
  for(let attempt=1;attempt<=attempts;attempt++){
   try{
    const response=await fetcher(fullURL,{cache:'no-store',signal:AbortSignal.timeout(15000)});
    httpStatus=response.status;
    if(httpStatus===200){
     const body=Buffer.from(await response.arrayBuffer());
     observedSha256=sha256(body);
     if(observedSha256===expectedSha256)
      return {entry,url,expectedSha256,observedSha256,httpStatus,status:'verified',attemptsUsed:attempt};
     error='DEPLOYED_BYTES_DIFFER';
    }else error='HTTP_'+httpStatus;
   }catch(e){error='NETWORK_OR_FETCH_'+(e?.name||'UnknownError');}
   if(attempt<attempts)await wait(attempt*1000);
  }
  return {entry,url,expectedSha256,observedSha256,httpStatus,status:'blocked',error,attemptsUsed:attempts};
 }));
 return {schema:'novel-demo-public-evidence-v1',checkedAt:new Date().toISOString(),
  sourceCommitSha:process.env.GITHUB_SHA||null,
  eligible:checks.every(x=>x.status==='verified'),
  checks,contentCertified:false,iphoneVerified:false};
}
if(require.main===module){
 (async()=>{
  const output=process.argv[2],root=path.resolve(__dirname,'..');
  const report=await checkPublicNovel(root);
  const content=JSON.stringify(report,null,2)+'\n';
  if(output){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,content);}
  process.stdout.write(content);
  if(!report.eligible)process.exitCode=1;
 })().catch(e=>{process.stderr.write('BLOCK: '+e.message+'\n');process.exitCode=1;});
}
module.exports={checkPublicNovel,files};
