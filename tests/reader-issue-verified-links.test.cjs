'use strict';
// Synthetic-only tests: the live URL is NOT contacted by this suite.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const crypto=require('node:crypto');
const {validate,issue}=require('../tools/reader-issue-verified-links.cjs');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const commit='a'.repeat(40),runId='12345678',now=Date.parse('2026-11-19T09:00:00Z');
const data=Buffer.from('<!doctype html><title>Public loader</title>');
const base={bookId:'novel-test',entry:'reader/preview/test/index.html',
 url:'https://pirokiiiiito-arch.github.io/flashcards/reader/preview/test/index.html?import=1',expectedSha256:sha(data)};
const good=()=>({schema:'reader-public-delivery-evidence-v1',eligible:true,contentCertified:false,iphoneVerified:false,
 sourceCommitSha:commit,workflowRunId:runId,checkedAt:new Date(now-500).toISOString(),
 checks:[{...base,status:'verified',httpStatus:200,observedSha256:base.expectedSha256,attemptsUsed:1}]});
const check=(e,t=[base],opts={})=>validate(e,t,{now,commit,runId,...opts});
test('good same-run GET issues only public URL, not iPhone certification',()=>{
 const r=check(good());assert.equal(r.verifiedPublicLinks[0].url,base.url);
 assert.equal(r.iphoneVerified,false);assert.equal(r.contentCertified,false);
});
const bad=(change,label)=>test(label,()=>{const e=good();change(e);assert.throws(()=>check(e),/LINK_ISSUANCE_BLOCKED/);});
bad(e=>e.eligible=false,'ineligible blocked');
bad(e=>e.sourceCommitSha='b'.repeat(40),'other commit blocked');
bad(e=>e.workflowRunId='other','other workflow run blocked');
bad(e=>e.checkedAt='2020-01-01T00:00:00Z','stale evidence blocked');
bad(e=>e.checkedAt='bad','invalid timestamp blocked');
bad(e=>e.checkedAt=new Date(now+50_000).toISOString(),'future evidence blocked');
bad(e=>e.checks=[],'missing checks blocked');
bad(e=>e.checks[0].status='blocked','blocked GET blocked');
bad(e=>e.checks[0].httpStatus=404,'HTTP 404 blocked');
bad(e=>e.checks[0].observedSha256='0'.repeat(64),'200 wrong content blocked');
bad(e=>e.checks[0].url=base.url+'?alter','wrong URL blocked');
bad(e=>e.checks[0].bookId='other','wrong book ID blocked');
bad(e=>e.checks[0].expectedSha256='0'.repeat(64),'wrong expected hash blocked');
bad(e=>e.iphoneVerified=true,'false device-certification claim blocked');
bad(e=>e.contentCertified=true,'false source certification blocked');
bad(e=>e.checks[0].attemptsUsed=0,'missing attempts blocked');
test('missing run ID blocked',()=>assert.throws(()=>validate(good(),[base],{now,commit,runId:''}),/BLOCKED/));
test('URL origin replacement blocked',()=>assert.throws(()=>check(good(),[{...base,url:'https://other.example/flashcards/'+base.entry}]),/BLOCKED/));
test('URL path injection blocked',()=>assert.throws(()=>check(good(),[{...base,entry:'reader/../private/index.html'}]),/BLOCKED/));
test('a tampered local source is blocked',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'issuer-test-'));
 try{const p=path.join(dir,base.entry);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,'wrong bytes');
  assert.throws(()=>check(good(),[base],{root:dir}),/LOCAL_ADMITTED_BYTES_MISMATCH/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('failed retry deletes previously-issued URL and text',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'issuer-issue-'));
 try{
  const p=path.join(dir,base.entry);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,data);
  const evidenceFile=path.join(dir,'evidence.json'),out=path.join(dir,'approved.json');
  fs.writeFileSync(evidenceFile,JSON.stringify(good()));
  const options={now,commit,runId,selectTargets:()=>[base]};
  assert.equal(issue(dir,evidenceFile,out,options).verifiedPublicLinks.length,1);
  assert.equal(fs.existsSync(out),true);
  const e=good();e.checks[0].status='blocked';fs.writeFileSync(evidenceFile,JSON.stringify(e));
  assert.throws(()=>issue(dir,evidenceFile,out,options),/BLOCKED/);
  assert.equal(fs.existsSync(out),false);assert.equal(fs.existsSync(out.replace('.json','.txt')),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});