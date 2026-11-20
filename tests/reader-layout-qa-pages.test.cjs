'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {checkPublicLayoutQA,entry}=require('../tools/verify-layout-qa-pages.cjs');
const root=process.env.READER_AUDIT_ROOT||path.resolve(__dirname,'..');
const bytes=fs.readFileSync(path.join(root,entry));
const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
const response=(status,body=bytes)=>({status,arrayBuffer:async()=>body});
test('QA publication evidence requires fresh HTTP 200 and exact program bytes',async()=>{
 let calls=0;
 const report=await checkPublicLayoutQA(root,async(url,options)=>{
  calls++;assert.equal(url,'https://pirokiiiiito-arch.github.io/flashcards/'+entry+'?sha='+digest(bytes));
  assert.equal(options.cache,'no-store');assert.equal(options.redirect,'error');
  assert.equal(options.headers['Cache-Control'],'no-cache');assert.ok(options.signal);
  return response(200);
 });
 assert.equal(calls,1);assert.equal(report.eligible,true);assert.equal(report.checks[0].status,'verified');
 assert.equal(report.checks[0].observedSha256,digest(bytes));
 assert.equal(report.contentCertified,false);assert.equal(report.bookReleaseEligible,false);assert.equal(report.iphoneVerified,false);
 assert.equal(report.purpose,'generic-qa-tool-publication-only');
});
test('HTTP 200 with stale bytes is blocked and preserves the actual mismatched hash',async()=>{
 const stale=Buffer.from('synthetic stale public program');
 const report=await checkPublicLayoutQA(root,async()=>response(200,stale),{attempts:1});
 assert.equal(report.eligible,false);assert.equal(report.checks[0].error,'DEPLOYED_BYTES_DIFFER');
 assert.equal(report.checks[0].observedSha256,digest(stale));assert.equal(report.checks[0].httpStatus,200);
});
test('a missing or redirected URL cannot verify publication',async()=>{
 for(const status of [301,302,404,503]){
  const report=await checkPublicLayoutQA(root,async()=>response(status),{attempts:1});
  assert.equal(report.eligible,false);assert.equal(report.checks[0].error,'HTTP_'+status);assert.equal(report.checks[0].observedSha256,null);
 }
});
test('network failure cannot inherit a previously observed stale response',async()=>{
 let count=0;
 const report=await checkPublicLayoutQA(root,async()=>{
  if(++count===1)return response(200,Buffer.from('synthetic stale bytes'));
  throw new TypeError('synthetic request failure');
 },{attempts:2,wait:async()=>{}});
 assert.equal(report.eligible,false);assert.equal(report.checks[0].httpStatus,null);assert.equal(report.checks[0].observedSha256,null);
 assert.equal(report.checks[0].error,'NETWORK_OR_FETCH_TypeError');assert.equal(report.checks[0].attemptsUsed,2);
});
test('bounded retries verify only when a later response matches the exact bytes',async()=>{
 let count=0;const waits=[];
 const report=await checkPublicLayoutQA(root,async()=>++count===3?response(200):response(404),{wait:async ms=>waits.push(ms)});
 assert.equal(report.eligible,true);assert.equal(count,3);assert.deepEqual(waits,[1000,2000]);assert.equal(report.checks[0].attemptsUsed,3);
});
test('invalid retry counts are rejected before network access',async()=>{
 for(const attempts of [0,-1,6,1.5])await assert.rejects(checkPublicLayoutQA(root,async()=>assert.fail('unexpected fetch'),{attempts}),/INVALID_ATTEMPTS/);
});
