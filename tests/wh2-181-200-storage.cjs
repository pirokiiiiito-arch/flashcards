'use strict';
// No private book text, image, or original scan is used or uploaded by this test.
const fs=require('node:fs'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const loader=fs.readFileSync('reader/wh2/181-200/index.html','utf8');
const png='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3ioAAAAASUVORK5CYII=';
const sha=crypto.createHash('sha256').update(Buffer.from(png,'base64')).digest('hex');
const pages=Array.from({length:20},(_,i)=>({scan:181+i,original:'data:image/png;base64,'+png,sha256:sha,reading_text:'synthetic fixture only'}));
const fake='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>世界の歴史2｜181〜200 synthetic test only</title></head><body><p>Synthetic fixture, not book content.</p><script id="bookdata" type="application/json">'+JSON.stringify(pages)+'</script><script>window.fixtureReady=true;parent.postMessage({kind:"wh2-reader-ready-v1"},"*");</script><!--'+'x'.repeat(1200000)+'--></body></html>';
const result={schema:'reader-loader-component-test-v1',privateBookUsed:false,loaderSha256:crypto.createHash('sha256').update(loader).digest('hex'),tests:[]};
const add=(name,ok,extra={})=>{result.tests.push({name,passed:!!ok,...extra});assert.ok(ok,name);};
(async()=>{
 const srv=http.createServer((q,s)=>{s.setHeader('Cache-Control','public,max-age=600');if(q.url.startsWith('/file.json')){s.setHeader('Content-Type','application/json');s.end(JSON.stringify({url:'https://drive.google.com/file/d/synthetic-only/view',name:'synthetic-only.html'}));}else{s.setHeader('Content-Type','text/html');s.end(loader);}});await new Promise(r=>srv.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+srv.address().port+'/index.html';let browser;
 try{
  browser=await chromium.launch({headless:true});result.browser=browser.version();const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});const p=await ctx.newPage();await p.goto(url+'?import=1');
  await p.locator('#file').setInputFiles({name:'synthetic181-200.html',mimeType:'text/html',buffer:Buffer.from(fake)});let f=await p.locator('#reader').elementHandle().then(h=>h.contentFrame());await f.waitForFunction('window.fixtureReady===true');add('synthetic-import-executes',true);
  await p.waitForFunction(async()=>!!(await getSaved())?.blob,{},{timeout:15000});const saved=await p.evaluate(async()=>{const x=await getSaved();return {name:x.name,size:x.blob.size,text:await x.blob.text()}});add('indexeddb-byte-identical',saved.text===fake&&saved.size===Buffer.byteLength(fake));
  await p.goto(url+'?import=1');await p.locator('#reopen').waitFor({state:'visible'});await ctx.setOffline(true);await p.locator('#reopen').click();f=await p.locator('#reader').elementHandle().then(h=>h.contentFrame());await f.waitForFunction('window.fixtureReady===true');add('offline-saved-file-reopens',true);await ctx.setOffline(false);
  await p.goto(url);f=await p.locator('#reader').elementHandle().then(h=>h.contentFrame());await f.waitForFunction('window.fixtureReady===true');add('reload-auto-opens-persisted-file',true);await p.close();const p2=await ctx.newPage();await p2.goto(url);f=await p2.locator('#reader').elementHandle().then(h=>h.contentFrame());await f.waitForFunction('window.fixtureReady===true');add('new-tab-restores-saved-file',true);
  for(const [name,transform,accept]of[['compatible-version',s=>s.replace('synthetic test only','older-compatible version'),true],['wrong-book',s=>s.replace('世界の歴史2','別の本'),false],['wrong-range',s=>s.replace('181〜200','161〜180'),false],['missing-scan',s=>s.replace('"scan":181','"scan":999'),false],['corrupt-json',s=>s.replace('id="bookdata" type="application/json">[','id="bookdata" type="application/json">!['),false]]){
   const accepted=await p2.evaluate(async s=>{try{await verify(new Blob([s],{type:'text/html'}));return true;}catch(e){return false;}},transform(fake));add(name,accepted===accept,{accepted});
  }
  const after=await p2.evaluate(async()=>await(await getSaved()).blob.text());add('invalid-imports-do-not-overwrite-saved-file',after===fake);add('separate-volume-storage-key',await p2.evaluate('DB==="wh2-reader-on-device-181-200-v1"&&KEY==="scans181to200"'));
  result.status='passed';result.limitations=['This tests loader/storage behavior with synthetic data only. Actual full-resolution private HTML is checked separately in local browser tests. Not an iPhone hardware test.'];
 }catch(e){result.status='failed';result.error=e.stack;process.exitCode=1;}finally{if(browser)await browser.close();srv.close();fs.mkdirSync('test-results',{recursive:true});fs.writeFileSync('test-results/wh2-181-200-storage.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
})();
