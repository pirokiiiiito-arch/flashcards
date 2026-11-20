'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const v=require('../tools/reader-release-control.cjs');
const {selectTargets,verifyOne,verifyAll}=require('../tools/reader-verify-pages.cjs');
const tmp=[];
// Synthetic responses need explicit transport metadata; Response() has no request URL.
function response(body,url,status=200,redirected=false){
 const r=new Response(body,{status,headers:{'content-type':'text/html; charset=utf-8'}});
 Object.defineProperties(r,{url:{value:url},redirected:{value:redirected}});
 return r;
}
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
 const makeFetch=(content,status=200)=>async url=>response(content,url,status);
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
 const fetcher=async url=>{calls++;return response(calls===1?'<html>old</html>':body,url)};
 const result=await verifyOne(target,fetcher,{attempts:2,wait:async()=>{}});
 assert.equal(result.status,'verified');assert.equal(result.attemptsUsed,2);
});
test('the full report is failed if even one admitted reader cannot be fetched',async()=>{
 const body='good';
 const targets=['one','two'].map(id=>({bookId:id,entry:'reader/preview/'+id+'/index.html',
 url:'https://pirokiiiiito-arch.github.io/flashcards/reader/preview/'+id+'/index.html',
 expectedSha256:v.hash(body)}));
 const fetcher=async u=>response(u.includes('/one/')?body:'bad',u);
 const report=await verifyAll(targets,fetcher,{attempts:1,wait:async()=>{}});
 assert.equal(report.eligible,false);
 assert.deepEqual(report.checks.map(x=>x.status),['verified','blocked']);
 assert.equal(report.contentCertified,false);assert.equal(report.iphoneVerified,false);
});
test('the exact issued URL is requested with GET and no query mutation',async()=>{
 const body='<html>exact target</html>',target={bookId:'exact',entry:'reader/preview/exact/index.html',
  url:'https://pirokiiiiito-arch.github.io/flashcards/reader/preview/exact/index.html?import=1',
  expectedSha256:v.hash(body)},calls=[];
 const fetcher=async(url,options)=>{
  calls.push({url,options});
  return response(url===target.url?body:'wrong query resource',url);
 };
 const r=await verifyOne(target,fetcher,{attempts:1,wait:async()=>{}});
 assert.equal(r.status,'verified');assert.equal(calls.length,1);
 assert.equal(calls[0].url,target.url);assert.equal(calls[0].options.method,'GET');
 assert.equal(calls[0].options.redirect,'manual');assert.equal(calls[0].options.cache,'no-store');
 assert.equal(r.requestedUrl,target.url);assert.equal(r.finalUrl,target.url);
 assert.equal(r.requestMethod,'GET');assert.equal(r.redirectPolicy,'manual');assert.equal(r.redirected,false);
});
for(const status of [301,302,303,307,308])test('HTTP '+status+' cannot certify an entry even with matching body bytes',async()=>{
 const body='same bytes',target={url:'https://pirokiiiiito-arch.github.io/flashcards/reader/preview/test/index.html?import=1',expectedSha256:v.hash(body)};
 let calls=0;
 const r=await verifyOne(target,async url=>{calls++;return response(body,url,status);},{attempts:1,wait:async()=>{}});
 assert.equal(calls,1);assert.equal(r.status,'blocked');assert.equal(r.error,'REDIRECT_NOT_ALLOWED');
 assert.equal(r.httpStatus,status);assert.equal(r.observedSha256,null);
});
test('matching final bytes cannot hide a followed redirect or a different response URL',async()=>{
 const body='same bytes',target={url:'https://pirokiiiiito-arch.github.io/flashcards/reader/preview/test/index.html?import=1',expectedSha256:v.hash(body)};
 for(const [url,redirected,error]of [[target.url,true,'REDIRECT_NOT_ALLOWED'],
  [target.url+'&different=1',false,'RESPONSE_URL_NOT_EXACT'],['',false,'RESPONSE_URL_NOT_EXACT']]){
  const r=await verifyOne(target,async()=>response(body,url,200,redirected),{attempts:1,wait:async()=>{}});
  assert.equal(r.status,'blocked');assert.equal(r.error,error);
 }
});
test('a failed retry does not retain earlier HTTP or SHA evidence',async()=>{
 const target={url:'https://pirokiiiiito-arch.github.io/flashcards/reader/preview/test/index.html?import=1',expectedSha256:v.hash('current')};
 let count=0;
 const r=await verifyOne(target,async url=>{if(++count===1)return response('old',url);throw new TypeError('network unavailable');},{attempts:2,wait:async()=>{}});
 assert.equal(r.status,'blocked');assert.equal(r.error,'FETCH_FAILED_TypeError');
 assert.equal(r.httpStatus,null);assert.equal(r.observedSha256,null);assert.equal(r.finalUrl,null);
});
test('cache-busting, fragments, credentials and noncanonical URL forms are rejected before fetch',()=>{
 const {root,entry,url}=fixture(),sha=v.hash('x'),file=path.join(root,'reader/quality/registry.json');
 for(const bad of [url+'&_delivery_sha=old',url+'#fragment',url.replace('https://','https://user@'),url.replace('.github.io/','.github.io:443/')]){
  fs.writeFileSync(file,JSON.stringify({books:[{id:'example',entry,url:bad}]}));
  assert.throws(()=>selectTargets(root,()=>({authorizedFiles:{[entry]:sha}})),/BOOK_PUBLIC_URL/);
 }
});
