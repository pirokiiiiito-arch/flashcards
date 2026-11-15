'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const v=require('../tools/reader-release-control.cjs');
const {selectTargets,verifyOne,verifyAll}=require('../tools/reader-verify-pages.cjs');
const tmp=[];
function fixture(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'reader-pages-verifier-'));tmp.push(root);
 fs.mkdirSync(path.join(root,'reader/quality'),{recursive:true});
 fs.writeFileSync(path.join(root,'reader/quality/release-policy.json'),JSON.stringify({receipts:[]}));
 const entry='reader/preview/example/index.html',url='https://pirokiiiiito-arch.github.io/flashcards/'+entry+'?import=1';
 fs.writeFileSync(path.join(root,'reader/quality/registry.json'),JSON.stringify({books:[{id:'example',entry,url}]}));
 return{root,entry,url};
}
test.after(()=>{for(const d of tmp)fs.rmSync(d,{recursive:true,force:true});});
test('only evidence-admitted registered entries become HTTP verification targets',()=>{
 const {root,entry,url}=fixture(),sha=v.hash('<html>example</html>');
 const targets=selectTargets(root,()=>({authorizedFiles:{[entry]:sha}}));
 assert.deepEqual(targets,[{bookId:'example',entry,url,expectedSha256:sha}]);
 assert.throws(()=>selectTargets(root,()=>({authorizedFiles:{}})),/NO_ADMITTED/);
});
test('a wrong hostname or invented reader path is rejected before network access',()=>{
 const {root,entry}=fixture(),s=v.hash('x'),f=path.join(root,'reader/quality/registry.json');
 const reg=JSON.parse(fs.readFileSync(f));reg.books[0].url='https://example.com/flashcards/'+entry;fs.writeFileSync(f,JSON.stringify(reg));
 assert.throws(()=>selectTargets(root,()=>({authorizedFiles:{[entry]:s}})),/BOOK_PUBLIC_URL/);
 reg.books[0].url='https://pirokiiiiito-arch.github.io/flashcards/reader/nine-stories/001-020/index.html?import=1';
 fs.writeFileSync(f,JSON.stringify(reg));
 assert.throws(()=>selectTargets(root,()=>({authorizedFiles:{[entry]:s}})),/BOOK_PUBLIC_URL/);
});
test('HTTP 200 is insufficient without exact served-byte SHA',async()=>{
 const body='<html>OK</html>',target={bookId:'example',entry:'reader/preview/example/index.html',
 url:'https://pirokiiiiito-arch.github.io/flashcards/reader/preview/example/index.html?import=1',
 expectedSha256:v.hash(body)};
 const makeFetch=(content,status=200)=>async()=>new Response(content,{status,headers:{'content-type':'text/html; charset=utf-8'}});
 const okay=await verifyOne(target,makeFetch(body),{attempts:1,wait:async()=>{}});
 assert.equal(okay.status,'verified');assert.equal(okay.httpStatus,200);
 const mismatch=await verifyOne(target,makeFetch('<html>404 substitute</html>'),{attempts:1,wait:async()=>{}});
 assert.equal(mismatch.status,'blocked');assert.equal(mismatch.error,'PUBLISHED_BYTES_DIFFER_FROM_ADMITTED_FILE');
 const missing=await verifyOne(target,makeFetch('missing',404),{attempts:1,wait:async()=>{}});
 assert.equal(missing.status,'blocked');assert.equal(missing.error,'HTTP_404');
});
test('transient publishing cache mismatch is retried, but only final exact bytes pass',async()=>{
 const body='<html>current</html>',target={bookId:'cache',entry:'reader/preview/cache/index.html',
 url:'https://pirokiiiiito-arch.github.io/flashcards/reader/preview/cache/index.html',
 expectedSha256:v.hash(body)};
 let calls=0;
 const fetcher=async()=>{calls++;return new Response(calls===1?'<html>old</html>':body,{headers:{'content-type':'text/html'}})};
 const result=await verifyOne(target,fetcher,{attempts:2,wait:async()=>{}});
 assert.equal(result.status,'verified');assert.equal(result.attemptsUsed,2);
});
test('the full report is failed if even one admitted reader cannot be fetched',async()=>{
 const body='good';
 const targets=['one','two'].map(id=>({bookId:id,entry:'reader/preview/'+id+'/index.html',
 url:'https://pirokiiiiito-arch.github.io/flashcards/reader/preview/'+id+'/index.html',
 expectedSha256:v.hash(body)}));
 const fetcher=async u=>new Response(u.includes('/one/')?body:'bad',{headers:{'content-type':'text/html'}});
 const report=await verifyAll(targets,fetcher,{attempts:1,wait:async()=>{}});
 assert.equal(report.eligible,false);
 assert.deepEqual(report.checks.map(x=>x.status),['verified','blocked']);
 assert.equal(report.contentCertified,false);assert.equal(report.iphoneVerified,false);
});
