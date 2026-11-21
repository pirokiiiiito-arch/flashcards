#!/usr/bin/env node
'use strict';
// After GitHub Pages deploy, verify HTTP 200 AND the bytes of each evidence-admitted reader entry.
// This is public-only and does not verify private OCR, Drive readback, or real iPhone gestures.
const fs=require('node:fs'),path=require('node:path');
const v=require('./reader-release-control.cjs');
const ORIGIN='https://pirokiiiiito-arch.github.io';
const shelfFiles=[
 ['reader/library/index.html','html'],['reader/library/read.html','html'],
 ['reader/library/app.js','script'],['reader/library/storage.js','script'],
 ['reader/library/sw.js','script'],['reader/library/shelf-registration.mjs','script'],
 ['reader/quality/shelf-registration.json','json']
];
function shelfTargets(root){
 return shelfFiles.map(([entry,kind])=>({
  entry,kind,url:ORIGIN+'/flashcards/'+entry,
  expectedSha256:v.hash(fs.readFileSync(path.join(root,entry)))
 }));
}
function selectTargets(root,admission=v.receipts){
 const policy=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/release-policy.json'),'utf8'));
 const registry=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/registry.json'),'utf8'));
 const {authorizedFiles}=admission(root,policy);
 const targets=[],seen=new Set();
 for(const book of registry.books||[]){
  if(!Object.hasOwn(authorizedFiles,book.entry))continue; // Do not infer approval from a source file.
  if(seen.has(book.entry))throw Error('DUPLICATE_ADMITTED_ENTRY '+book.entry);
  seen.add(book.entry);
  const expectedSha256=authorizedFiles[book.entry];
  if(!/^[a-f0-9]{64}$/.test(expectedSha256))throw Error('BAD_ADMITTED_DIGEST '+book.entry);
  let url;
  try{url=new URL(book.url);}catch(_){throw Error('UNVERIFIED_BOOK_URL '+book.id);}
  if(url.origin!==ORIGIN||url.pathname!=='/flashcards/'+book.entry||url.username||url.password||url.hash||
     !['','?import=1'].includes(url.search)||url.toString()!==book.url||
     !/^reader\/[a-zA-Z0-9_./-]+\/index\.html$/.test(book.entry)||book.entry.includes('..'))
   throw Error('BOOK_PUBLIC_URL_DOES_NOT_MATCH_ENTRY '+book.id);
  targets.push({bookId:book.id,entry:book.entry,url:url.toString(),expectedSha256});
 }
 if(!targets.length)throw Error('NO_ADMITTED_BOOK_URLS_TO_VERIFY');
 return targets;
}
async function verifyOne(target,fetcher=fetch,{attempts=4,wait=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 let error='NOT_ATTEMPTED',httpStatus=null,observedSha256=null;
 // Query changes test a different resource. Fetch exactly the URL that will be issued.
 // Manual redirect handling preserves the 3xx response for a fail-closed audit.
 const requestedUrl=target.url,requestMethod='GET',redirectPolicy='manual';
 let finalUrl=null,redirected=null;
 for(let i=0;i<attempts;i++){
  httpStatus=null;observedSha256=null;finalUrl=null;redirected=null;
  try{
   const response=await fetcher(requestedUrl,{method:requestMethod,redirect:redirectPolicy,
    cache:'no-store',signal:AbortSignal.timeout(15000)});
   httpStatus=response.status;
   finalUrl=response.url||null;redirected=response.redirected;
   if((response.status>=300&&response.status<400)||response.redirected===true){error='REDIRECT_NOT_ALLOWED';}
   else if(finalUrl!==requestedUrl||redirected!==false){error='RESPONSE_URL_NOT_EXACT';}
   else if(response.status!==200){error='HTTP_'+response.status;}
   else{
    const type=response.headers.get('content-type')||'';
    const size=Number(response.headers.get('content-length')||0);
    const expectedType=target.kind==='script' ? /^(application|text)\/(x-)?(java|ecma)script\b/i :
     target.kind==='json' ? /^application\/json\b/i : /^text\/html\b/i;
    if(!expectedType.test(type))error=target.kind ? 'UNEXPECTED_SHELF_CONTENT_TYPE' : 'NOT_HTML_RESPONSE';
    else if(size>1024*1024)error='UNEXPECTED_PUBLIC_ENTRY_SIZE';
    else{
     const buffer=Buffer.from(await response.arrayBuffer());
     if(buffer.length>1024*1024)error='UNEXPECTED_PUBLIC_ENTRY_SIZE';
     else{
      observedSha256=v.hash(buffer);
      if(observedSha256===target.expectedSha256)return {...target,status:'verified',httpStatus,observedSha256,
       requestMethod,requestedUrl,finalUrl,redirectPolicy,redirected,attemptsUsed:i+1};
      error='PUBLISHED_BYTES_DIFFER_FROM_ADMITTED_FILE';
     }
    }
   }
  }catch(e){error='FETCH_FAILED_'+(e?.name||'UnknownError');}
  if(i+1<attempts)await wait(1250*(i+1));
 }
 return {...target,status:'blocked',httpStatus,observedSha256,requestMethod,requestedUrl,finalUrl,
  redirectPolicy,redirected,error,attemptsUsed:attempts};
}
async function verifyAll(targets,fetcher=fetch,options={}){
 const records=new Array(targets.length);let cursor=0;
 const concurrency=Math.max(1,Math.min(4,targets.length));
 await Promise.all(Array.from({length:concurrency},async()=>{
  while(cursor<targets.length){
   const index=cursor++;
   records[index]=await verifyOne(targets[index],fetcher,options);
  }
 }));
 return {schema:'reader-public-delivery-evidence-v1',checkedAt:new Date().toISOString(),
  sourceCommitSha:process.env.GITHUB_SHA||null,workflowRunId:process.env.GITHUB_RUN_ID||null,
  eligible:records.length===targets.length&&records.every(x=>x.status==='verified'),
  // A successful deploy/check is not a source-text review or an iPhone operation test.
  checks:records,contentCertified:false,iphoneVerified:false};
}
if(require.main===module){
 (async()=>{
  const root=path.resolve(process.argv[2]||path.join(__dirname,'..'));
  const output=process.argv[3];
  let report;
  try{
   const [books,shelf]=await Promise.all([verifyAll(selectTargets(root)),verifyAll(shelfTargets(root))]);
   report={...books,eligible:books.eligible&&shelf.eligible,shelfChecks:shelf.checks};
  }
  catch(e){report={schema:'reader-public-delivery-evidence-v1',eligible:false,checks:[],errors:[e.message],checkedAt:new Date().toISOString()};}
  const json=JSON.stringify(report,null,2)+'\n';
  if(output){fs.mkdirSync(path.dirname(path.resolve(output)),{recursive:true});fs.writeFileSync(output,json);}
  process.stdout.write(json);
  if(!report.eligible)process.exitCode=1;
 })().catch(e=>{process.stderr.write('BLOCK: '+e.message+'\n');process.exitCode=1;});
}
module.exports={selectTargets,verifyOne,verifyAll};
