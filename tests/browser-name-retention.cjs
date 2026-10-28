/* Full-browser regression using synthetic data and a loopback web server.
 * No Google request leaves the browser. Preinstalled Chrome; no npm deps. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const ROOT=process.cwd(),png='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGOUSzFiYGBgYmBgYGBgAAAIhgC45g2MEQAAAABJRU5ErkJggg==';
const hash=crypto.createHash('sha256').update(Buffer.from(png,'base64')).digest('hex'),ref='gdrive:test-picture:'+hash;
const sleep=n=>new Promise(r=>setTimeout(r,n));
async function until(fn,label){for(let i=0;i<160;i++){const value=await fn();if(value)return value;await sleep(100);}throw Error('Timed out: '+label);}
function bootstrap(app,cacheOnly){
 const events=[];let n=0;const add=(key,value)=>events.push({id:'test-event-'+(++n),key,value,parents:[],clock:n,deleted:false});
 if(app==='plants'){add('card:test-plant',{id:'test-plant',name:'保存確認用の植物名',description:'検証用の説明',group:'angiosperm',sort_order:1});add('image:test-plant:0',ref);}
 else add('photo:color-0001:palette',{data_url:ref,sha256:hash,label:'検証用配色',updated_at:'2026-01-01T00:00:00Z'});
 return `(()=>{
 const events=${JSON.stringify(events)},app=${JSON.stringify(app)},picture=${JSON.stringify(ref)},png=${JSON.stringify(png)},hash=${JSON.stringify(hash)};
 window.__fixture={events,picture,png,hash};window.__driveRequests=[];
 ${cacheOnly?"indexedDB.open=()=>{throw new DOMException('Synthetic storage failure','QuotaExceededError');};":''}
 const original=window.fetch.bind(window);
 window.fetch=async(input,options={})=>{
   const url=new URL(typeof input==='string'?input:input.url,document.baseURI);
   if(url.origin!=='https://www.googleapis.com')return original(input,options);
   __driveRequests.push(url.href);
   if(localStorage.getItem('__test_offline')==='1')throw TypeError('Synthetic offline state');
   if((options.method||'GET')!=='GET')throw Error('Remote writes are forbidden');
   const json=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
   if(url.pathname.endsWith('/about'))return json({user:{permissionId:'synthetic-owner',emailAddress:'example@example.invalid'}});
   if(url.pathname.endsWith('/files'))return json({files:url.searchParams.get('q').includes("value='journal'")?[{id:'test-journal',md5Checksum:'unchanged-test-journal'}]:[{id:'test-picture',appProperties:{sha256:hash},sha256Checksum:hash,mimeType:'image/png'}]});
   if(url.pathname.endsWith('/test-journal'))return json({schema:'flashcards-drive-journal-v3',namespace:app==='plants'?'plant-flashcards':'colors1000-review47',events});
   if(url.pathname.endsWith('/test-picture'))return new Response(Uint8Array.from(atob(png),c=>c.charCodeAt(0)),{headers:{'Content-Type':'image/png'}});
   throw Error('Unexpected fixture request');
 };
 window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:config=>({requestAccessToken:()=>config.callback({access_token:'synthetic-test-only-token',expires_in:3600})})}}};
})();`;
}
async function scenario(app,{legacy=false,cacheOnly=false}={}){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'flashcards-name-test-'));
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/__fixture__'){res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><body>Test fixture only</body>');return;}
  const file=path.resolve(ROOT,decodeURIComponent(pathname.replace(/^\/flashcards\//,'')));
  if(!pathname.startsWith('/flashcards/')||!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end('not found');return;}
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.b64':'text/plain','.svg':'image/svg+xml'};
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const child=cp.spawn(process.env.CHROME_PATH||'google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let ws;const errors=[],external=[];
 try{
  child.on('error',e=>errors.push(e.message));await until(()=>fs.existsSync(path.join(profile,'DevToolsActivePort')),'Chrome debugger');
  const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json(),target=targets.find(x=>x.type==='page');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  let seq=0;const pending=new Map();
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  ws.addEventListener('message',event=>{
   const msg=JSON.parse(event.data);
   if(msg.id){const p=pending.get(msg.id);pending.delete(msg.id);if(msg.error)p?.reject(Error(msg.error.message));else p?.resolve(msg.result);return;}
   if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description||msg.params.exceptionDetails.text);
   if(msg.method==='Fetch.requestPaused'){
    const {requestId,request}=msg.params;
    if(request.url.startsWith(origin+'/'))send('Fetch.continueRequest',{requestId}).catch(()=>{});
    else{external.push(request.url);send('Fetch.failRequest',{requestId,errorReason:'Aborted'}).catch(()=>{});}
   }
  });
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  await send('Runtime.enable');await send('Page.enable');await send('Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'}]});
  await send('Page.addScriptToEvaluateOnNewDocument',{source:bootstrap(app,cacheOnly)});
  if(legacy){
   await send('Page.navigate',{url:origin+'/__fixture__'});await until(()=>evaluate('!!window.__fixture'),'fixture startup');
   await evaluate(`new Promise((resolve,reject)=>{const r=indexedDB.open('flashcards_drive_cache_v3',1);r.onupgradeneeded=()=>{r.result.createObjectStore('states');r.result.createObjectStore('blobs');};r.onerror=()=>reject(r.error);r.onsuccess=()=>{const db=r.result,tx=db.transaction(['states','blobs'],'readwrite');tx.objectStore('states').put({account:'synthetic-owner',events:Object.fromEntries(__fixture.events.map(e=>[e.id,e])),snapshot:{},initialized:true},${JSON.stringify(app==='plants'?'plant-flashcards':'colors1000-review47')});tx.objectStore('blobs').put(new Blob([Uint8Array.from(atob(__fixture.png),c=>c.charCodeAt(0))],{type:'image/png'}),__fixture.picture);tx.oncomplete=()=>{db.close();localStorage.setItem('__test_offline','1');resolve(true);};tx.onerror=()=>reject(tx.error);};})`);
  }
  await send('Page.navigate',{url:origin+'/flashcards/'+app+'/saved-view.html'});
  const api=app==='plants'?'PlantDriveSync':'ColorDriveSync';
  await until(()=>evaluate('typeof window.'+api+"==='object'"),app+' API startup');
  if(!legacy)await evaluate("[...document.querySelectorAll('[data-drive-readonly-controls] button')].find(b=>b.textContent.includes('初回接続')).click()");
  await until(()=>evaluate(`${api}.status().cached`),'saved names loaded');
  const show=app==='plants'?'render(true)':'jump(0);flip()';await evaluate(show);
  const nameExpr=app==='plants'?"document.querySelector('.front-name')?.textContent":"document.querySelector('#back h2')?.textContent";
  const expected=app==='plants'?'保存確認用の植物名':await evaluate('CARDS[0].name');assert.equal(await evaluate(nameExpr),expected);
  const imgExpr=app==='plants'?"document.querySelector('.image-box img')":"document.querySelector('[data-photo-slot=\"color-0001:palette\"] img')";
  await until(()=>evaluate(`!!(${imgExpr}?.naturalWidth>0)`),'saved photograph displayed');
  await evaluate(`localStorage.setItem('__test_offline','1');${api}.disconnect();`);await evaluate(show);assert.equal(await evaluate(nameExpr),expected);
  await send('Page.reload',{ignoreCache:false});
  await until(()=>evaluate(`!!window.${api}&&${api}.status().cached`),'restart without authentication');
  await evaluate(show);assert.equal(await evaluate(nameExpr),expected);await until(()=>evaluate(`!!(${imgExpr}?.naturalWidth>0)`),'photo after restart');
  assert.equal(await evaluate(api+'.valid()'),false);assert.deepEqual(await evaluate('__driveRequests'),[],'cached reload must not access Drive');
  assert.deepEqual(errors,[],'no page runtime errors');assert.ok(!external.some(x=>x.startsWith('https://www.googleapis.com')),'no real Google request');
  console.log('PASS browser:',app,legacy?'legacy archive':'fresh save',cacheOnly?'CacheStorage fallback':'IndexedDB','name + photo + expired token + reload');
 }finally{
  try{ws?.close();}catch{}child.kill('SIGTERM');server.closeAllConnections();await new Promise(r=>server.close(r));await sleep(150);fs.rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});
 }
}
(async()=>{await scenario('plants');await scenario('colors');await scenario('plants',{cacheOnly:true});await scenario('plants',{legacy:true});await scenario('colors',{legacy:true});})().catch(e=>{console.error(e);process.exitCode=1;});
