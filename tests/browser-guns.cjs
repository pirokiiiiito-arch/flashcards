/* Browser smoke test for the independent gun-card application.
 * Local synthetic image only; Google/Drive requests are blocked.
 */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http');
const cp=require('node:child_process'),assert=require('node:assert/strict');
const ROOT=process.cwd();
const png='iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGOUSzFiYGBgYmBgYGBgAAAIhgC45g2MEQAAAABJRU5ErkJggg==';
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){for(let i=0;i<140;i++){const ok=await fn();if(ok)return ok;await sleep(100);}throw Error('Timed out: '+label);}
async function run(){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'firearms-browser-'));
 const errors=[],external=[];
 const server=http.createServer((req,res)=>{
   const pathname=new URL(req.url,'http://localhost').pathname;
   const local=decodeURIComponent(pathname.replace(/^\/flashcards\//,''));
   const file=path.resolve(ROOT,local);
   if(!pathname.startsWith('/flashcards/')||!file.startsWith(ROOT+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){
     res.writeHead(404);res.end('not found');return;
   }
   const types={'.js':'text/javascript;charset=utf-8','.css':'text/css','.html':'text/html;charset=utf-8',
     '.json':'application/json','.webmanifest':'application/manifest+json'};
   res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream'});
   fs.createReadStream(file).pipe(res);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin='http://127.0.0.1:'+server.address().port;
 const chrome=cp.spawn(process.env.CHROME_PATH||'google-chrome',[
  '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',
  '--no-first-run','--no-default-browser-check','--remote-debugging-port=0',
  '--user-data-dir='+profile,'about:blank'
 ],{stdio:'ignore'});
 let ws,evaluate;
 try{
   chrome.on('error',e=>errors.push(e.message));
   await until(()=>fs.existsSync(path.join(profile,'DevToolsActivePort')),'Chrome debug port');
   const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
   const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
   const target=targets.find(item=>item.type==='page');
   ws=new WebSocket(target.webSocketDebuggerUrl);
   await new Promise((resolve,reject)=>{
     ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true});
   });
   let id=0,loaded=0;const responses=new Map();
   const send=(method,params={})=>new Promise((resolve,reject)=>{
     const next=++id;responses.set(next,{resolve,reject});
     ws.send(JSON.stringify({id:next,method,params}));
   });
   ws.addEventListener('message',event=>{
     const info=JSON.parse(event.data);
     if(info.id){const p=responses.get(info.id);responses.delete(info.id);
       if(info.error)p?.reject(Error(info.error.message));else p?.resolve(info.result);return;
     }
     if(info.method==='Page.loadEventFired')loaded++;
     if(info.method==='Runtime.exceptionThrown')
       errors.push(info.params.exceptionDetails.exception?.description||info.params.exceptionDetails.text);
     if(info.method==='Fetch.requestPaused'){
       const {requestId,request}=info.params;
       if(request.url.startsWith(origin+'/'))send('Fetch.continueRequest',{requestId}).catch(()=>{});
       else{external.push(request.url);send('Fetch.failRequest',{requestId,errorReason:'Aborted'}).catch(()=>{});}
     }
   });
   evaluate=async expression=>{
     const response=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
     if(response.exceptionDetails)throw Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
     return response.result?.value;
   };
   const navigate=async(method,params)=>{
     const previous=loaded;await send(method,params);await until(()=>loaded>previous,'page load');
   };
   await send('Runtime.enable');
   await send('Page.enable');
   await send('Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'}]});
   await navigate('Page.navigate',{url:origin+'/flashcards/guns/index.html'});
   await until(()=>evaluate("document.querySelectorAll('.category-tile').length===9"),'nine gun categories');
   assert.equal(await evaluate('GunDeck.getCards().length'),35);
   assert.equal(await evaluate("document.querySelector('[data-group=shotgun]').textContent.includes('ショットガン')"),true);
   await evaluate("document.querySelector('[data-group=shotgun]').click()");
   assert.equal(await evaluate("document.querySelector('#frontName').textContent"),'Remington Model 870');
   assert.equal(await evaluate("document.querySelector('#cardBack').hidden"),true);
   await evaluate("document.querySelector('#flipBtn').click()");
   assert.equal(await evaluate("document.querySelector('#cardBack').hidden"),false);
   assert.equal(await evaluate("document.querySelectorAll('#photoGrid .photo-slot').length"),3);
   assert.ok((await evaluate("document.querySelector('#backDescription').textContent")).includes('ショットガン'));
   await evaluate("document.querySelector('#editCardBtn').click()");
   assert.equal(await evaluate("document.querySelector('#editorDialog').open"),true);
   assert.equal(await evaluate("document.querySelector('#editSearch').value.includes('Remington')"),true);
   await evaluate("(()=>{const input=document.querySelector('#editorPhotos input[type=file]'),bytes=Uint8Array.from(atob('"+png+"'),x=>x.charCodeAt(0)),file=new File([bytes],'demo.png',{type:'image/png'}),dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
   await until(()=>evaluate("document.querySelector('#editorMessage').textContent.includes('この端末に保存')"),'image saved in IndexedDB');
   await evaluate("document.querySelector('#saveEditBtn').click()");
   await until(()=>evaluate("!document.querySelector('#editorDialog').open"),'photo edit saved');
   await until(()=>evaluate("document.querySelector('#photoGrid img')?.naturalWidth>0"),'registered picture displayed');
   const photo=await evaluate("GunDeck.getCards().find(c=>c.name==='Remington Model 870').images[0]");
   assert.match(photo,/^idb:gunimg:/);
   await evaluate("window.open=(url)=>{window.__englishSearch=url;return {opener:null}};document.querySelector('#googleSearchBtn').click()");
   const search=await evaluate('window.__englishSearch');
   assert.ok(search.startsWith('https://www.google.com/search?tbm=isch&q='));
   assert.ok(decodeURIComponent(search).includes('Remington'));
   await navigate('Page.reload',{ignoreCache:false});
   await until(()=>evaluate("document.querySelectorAll('.category-tile').length===9"),'cards after browser restart');
   await evaluate("document.querySelector('[data-group=shotgun]').click();document.querySelector('#flipBtn').click()");
   await until(()=>evaluate("document.querySelector('#photoGrid img')?.naturalWidth>0"),'registered picture restored after restart');
   await evaluate("document.querySelector('#addBtn').click();document.querySelector('#editCategory').value='revolver';document.querySelector('#editName').value='Local Test Model';document.querySelector('#editSearch').value='historical revolver photo';document.querySelector('#editDescription').value='A saved catalog entry.';document.querySelector('#saveEditBtn').click();");
   await until(()=>evaluate("GunDeck.getCards().some(c=>c.name==='Local Test Model')"),'new editable gun saved');
   await navigate('Page.reload',{ignoreCache:false});
   await until(()=>evaluate("GunDeck.getCards().some(c=>c.name==='Local Test Model')"),'user added card retained after restart');
   const custom=await evaluate("GunDeck.getCards().find(c=>c.name==='Local Test Model')?.category");
   assert.equal(custom,'revolver');
   assert.deepEqual(errors,[],'No uncaught gun card UI errors');
   assert.ok(!external.some(url=>url.startsWith('https://www.googleapis.com')),'No private Drive requests without user authentication');
   console.log('PASS browser guns: categories, front/back, English image search, image file/IndexedDB, reload, adding custom cards');
 }finally{
   try{ws?.close()}catch{}
   chrome.kill('SIGTERM');
   server.closeAllConnections();
   await new Promise(resolve=>server.close(resolve));
   await sleep(220);
   try{fs.rmSync(profile,{force:true,recursive:true,maxRetries:10,retryDelay:150})}catch(e){console.warn('Temporary Chrome profile cleanup:',e.message);}
 }
}
run().catch(error=>{console.error(error);process.exitCode=1});
