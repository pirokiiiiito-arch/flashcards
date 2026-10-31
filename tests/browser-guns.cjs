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
   const categoryLayout=await evaluate("(()=>{const items=[...document.querySelectorAll('#groupGrid .category-tile')],bounds=items.map(el=>el.getBoundingClientRect());return {columns:getComputedStyle(document.querySelector('#groupGrid')).gridTemplateColumns,stacked:bounds.slice(1).every((b,i)=>b.top>=bounds[i].bottom-1),widths:bounds.map(b=>b.width)}})()");
   assert.equal(categoryLayout.stacked,true,'Categories must each occupy their own vertical row on desktop');
   assert.equal(categoryLayout.columns.trim().split(/\s+/).length,1,'Categories must use a single grid column');
   assert.ok(categoryLayout.widths.every(width=>width>400),'Vertical categories should be full-width rows');
   await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
   const mobileCategories=await evaluate("(()=>{const group=document.querySelector('#groupGrid'),tiles=[...group.querySelectorAll('.category-tile')].map(el=>el.getBoundingClientRect());return {columns:getComputedStyle(group).gridTemplateColumns,stacked:tiles.slice(1).every((row,i)=>row.top>=tiles[i].bottom-1),fullWidth:tiles.every(row=>row.width>320)}})()");
   assert.equal(mobileCategories.columns.trim().split(/\s+/).length,1,'Mobile categories must also be one column');
   assert.equal(mobileCategories.stacked,true,'Mobile category tiles must appear one below another');
   assert.equal(mobileCategories.fullWidth,true,'Mobile categories must be readable full-width rows');
   await send('Emulation.clearDeviceMetricsOverride');
   await evaluate("document.querySelector('[data-group=shotgun]').click()");
   assert.equal(await evaluate("document.querySelector('#frontName').textContent"),'レミントン・モデル870');
   const desktopFont=await evaluate("parseFloat(getComputedStyle(document.querySelector('#frontName')).fontSize)");
   assert.ok(desktopFont<=34,'Gun name should stay at or below 34px on desktop');
   assert.equal(await evaluate("document.querySelector('#cardBack').hidden"),true);
   await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
   const mobileFont=await evaluate("parseFloat(getComputedStyle(document.querySelector('#frontName')).fontSize)");
   assert.ok(mobileFont<=29,'Gun name must remain compact on mobile');
   await send('Emulation.clearDeviceMetricsOverride');
   await evaluate("document.querySelector('#flipBtn').click()");
   assert.equal(await evaluate("document.querySelector('#cardBack').hidden"),false);
   assert.equal(await evaluate("document.querySelectorAll('#photoGrid .photo-slot').length"),3);
   const photoLayout=await evaluate("(()=>{const photos=[...document.querySelectorAll('#photoGrid .photo-slot')].map(el=>el.getBoundingClientRect()),frames=[...document.querySelectorAll('#photoGrid .photo-frame')].map(el=>el.getBoundingClientRect()),description=document.querySelector('#backDescription').getBoundingClientRect(),back=document.querySelector('#cardBack').getBoundingClientRect();return {count:photos.length,belowDescription:photos[0].top>description.bottom-1,stacked:photos.slice(1).every((rect,i)=>rect.top>=photos[i].bottom-1),fullWidth:frames.every(rect=>rect.width>400),aspect:frames[0].width/frames[0].height,contained:photos[2].bottom<=back.bottom+1};})()");
   assert.equal(photoLayout.belowDescription,true,'All photo slots must appear below the gun description');
   assert.equal(photoLayout.stacked,true,'Three photos must form a vertical stack, not horizontal columns');
   assert.equal(photoLayout.fullWidth,true,'Each photo must span the card width like plant photos');
   assert.ok(photoLayout.aspect>1.7&&photoLayout.aspect<1.9,'Each photo uses a 16:9 frame');
   assert.equal(photoLayout.contained,true,'The back card must expand to contain photo three');
   const searchPosition=await evaluate("(()=>{const button=document.querySelector('#googleSearchBtn'),photos=document.querySelector('#photoGrid'),box=button.getBoundingClientRect();return {visible:!button.hidden&&box.width>80&&box.height>30,abovePhotos:box.bottom<photos.getBoundingClientRect().top};})()");
   assert.equal(searchPosition.visible,true,'English Google search must be visible near the top of the back');
   assert.equal(searchPosition.abovePhotos,true,'Search must be above, not below, three large pictures');
   assert.equal(await evaluate("document.querySelectorAll('#photoGrid .photo-slot-actions').length"),3);
   assert.equal(await evaluate("document.querySelectorAll('#photoGrid [data-paste-slot]').length"),3);
   assert.equal(await evaluate("document.querySelectorAll('#photoGrid .photo-slot-actions button').length"),6);
   assert.equal(await evaluate("document.querySelectorAll('#photoGrid .photo-slot-actions input[type=file]').length"),3);
   assert.ok((await evaluate("document.querySelector('#backDescription').textContent")).includes('ショットガン'));
   await evaluate("document.querySelector('#editCardBtn').click()");
   assert.equal(await evaluate("document.querySelector('#editorDialog').open"),true);
   assert.equal(await evaluate("document.querySelector('#editSearch').value.includes('Remington')"),true);
   await evaluate("(()=>{const input=document.querySelector('#editorPhotos input[type=file]'),bytes=Uint8Array.from(atob('"+png+"'),x=>x.charCodeAt(0)),file=new File([bytes],'demo.png',{type:'image/png'}),dt=new DataTransfer();dt.items.add(file);input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));return true;})()");
   await until(()=>evaluate("document.querySelector('#editorMessage').textContent.includes('この端末に保存')"),'image saved in IndexedDB');
   await evaluate("document.querySelector('#saveEditBtn').click()");
   await until(()=>evaluate("!document.querySelector('#editorDialog').open"),'photo edit saved');
   await until(()=>evaluate("document.querySelector('#photoGrid img')?.naturalWidth>0"),'registered picture displayed');
   const photo=await evaluate("GunDeck.getCards().find(c=>c.id==='gun-0001').images[0]");
   assert.match(photo,/^idb:gunimg:/);
   // Google image copy + Ctrl+V directly into photo 2 without opening the editor.
   const pasteResult=await evaluate("(()=>{const frame=document.querySelector('#photoGrid [data-paste-slot=\"2\"]'),bytes=Uint8Array.from(atob('"+png+"'),x=>x.charCodeAt(0)),file=new File([bytes],'copied-photo.png',{type:'image/png'}),clipboard=new DataTransfer();clipboard.items.add(file);frame.focus();const paste=new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:clipboard});frame.dispatchEvent(paste);return {prevented:paste.defaultPrevented,focused:document.activeElement===frame}})()");
   assert.equal(pasteResult.prevented,true,'Ctrl+V picture paste must suppress inserting a raw HTML image');
   await until(()=>evaluate("GunDeck.getCards().find(c=>c.id==='gun-0001').images[1].startsWith('idb:gunimg:')"),'copy/paste directly to photo 2');
   assert.equal(await evaluate("document.querySelector('#editorDialog').open"),false,'Direct clipboard paste must not require an editor');
   await until(()=>evaluate("document.querySelectorAll('#photoGrid img').length>=2"),'pasted photo appears on back');
   // A photo can also be selected from a file directly on the back.
   await evaluate("(()=>{const input=document.querySelectorAll('#photoGrid .photo-slot-actions input[type=file]')[2],bytes=Uint8Array.from(atob('"+png+"'),x=>x.charCodeAt(0)),file=new File([bytes],'chosen-photo.png',{type:'image/png'}),transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));})()");
   await until(()=>evaluate("GunDeck.getCards().find(c=>c.id==='gun-0001').images[2].startsWith('idb:gunimg:')"),'file directly to photo 3');
   const allPhotos=await evaluate("GunDeck.getCards().find(c=>c.id==='gun-0001').images");
   assert.equal(allPhotos.length,3);
   assert.ok(allPhotos.every(ref=>ref.startsWith('idb:gunimg:')),'All three photo slots use durable local image references');

   await evaluate("window.open=(url)=>{window.__englishSearch=url;return {opener:null}};document.querySelector('#googleSearchBtn').click()");
   const search=await evaluate('window.__englishSearch');
   assert.ok(search.startsWith('https://www.google.com/search?tbm=isch&q='));
   assert.ok(decodeURIComponent(search).includes('Remington Model 870'));
   assert.ok(!decodeURIComponent(search).includes('レミントン'),'Google query must be English, not the Japanese display name');
   // Simulate previously saved English-name seed data; keep the registered
   // IndexedDB photo reference exactly unchanged through migration.
   await evaluate("(()=>{const old=JSON.parse(localStorage.getItem('gun-flashcards-cards-v1'));const c=old.cards.find(c=>c.id==='gun-0001');c.name='Remington Model 870';localStorage.setItem('gun-flashcards-cards-v1',JSON.stringify(old));return true})()");
   await navigate('Page.reload',{ignoreCache:false});
   await until(()=>evaluate("document.querySelectorAll('.category-tile').length===9"),'cards after browser restart');
   assert.equal(await evaluate("GunDeck.getCards().find(c=>c.id==='gun-0001').name"),'レミントン・モデル870');
   assert.equal(await evaluate("GunDeck.getCards().find(c=>c.id==='gun-0001').search.includes('Remington')"),true);
   assert.equal(await evaluate("GunDeck.getCards().find(c=>c.id==='gun-0001').images[0]"),photo,'Migration must preserve the original stored image ref');
   assert.deepEqual(await evaluate("GunDeck.getCards().find(c=>c.id==='gun-0001').images"),allPhotos,
     'All directly pasted/photo-file image slots must survive reload and English-name migration');
   await evaluate("document.querySelector('[data-group=shotgun]').click();document.querySelector('#flipBtn').click()");
   await until(()=>evaluate("document.querySelector('#photoGrid img')?.naturalWidth>0"),'registered picture restored after restart');
   await evaluate("document.querySelector('#addBtn').click();document.querySelector('#editCategory').value='revolver';document.querySelector('#editName').value='テスト・モデル';document.querySelector('#editSearch').value='historical revolver photo';document.querySelector('#editDescription').value='A saved catalog entry.';document.querySelector('#saveEditBtn').click();");
   await until(()=>evaluate("GunDeck.getCards().some(c=>c.name==='テスト・モデル')"),'new editable gun saved');
   await navigate('Page.reload',{ignoreCache:false});
   await until(()=>evaluate("GunDeck.getCards().some(c=>c.name==='テスト・モデル')"),'user added card retained after restart');
   const custom=await evaluate("GunDeck.getCards().find(c=>c.name==='テスト・モデル')?.category");
   assert.equal(custom,'revolver');
   assert.deepEqual(errors,[],'No uncaught gun card UI errors');
   assert.ok(!external.some(url=>url.startsWith('https://www.googleapis.com')),'No private Drive requests without user authentication');
   console.log('PASS browser guns: prominent English search, image-slot Ctrl+V/file paste, all three durable photos and preserved data');
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
