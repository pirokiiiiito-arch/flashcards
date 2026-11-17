'use strict';
/* Browser smoke test: synthetic content only. Does not import copyrighted scans or certify OCR/iPhone. */
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),cp=require('node:child_process');
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const ROOT=path.resolve(__dirname,'..'),ENTRY='reader/preview/nine-stories-021-040-safe-v2/index.html';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){
 for(let i=0;i<120;i++){if(await fn())return;await sleep(100);}
 throw Error('TIMEOUT '+label);
}
(async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nine-safe-loader-browser-'));
 const profile=path.join(dir,'profile'),data=path.join(dir,'20261117_2018_合成_021-040.html');
 fs.mkdirSync(profile);
 const book={
   bookId:'salinger-nine-stories-shibata-021-040',range:[21,40],
   pages:Array.from({length:20},(_,i)=>({scan:21+i})),imageCount:20
 };
 const sample='<!doctype html><html lang="ja"><head><meta name="viewport" content="width=device-width">'+
   '<meta name="built-at" content="2026-11-17T20:18:44+09:00">'+
   '<title>ナイン・ストーリーズ｜021〜040｜合成試験のみ</title>'+
   '<script id="embedded-data" type="application/json">'+JSON.stringify(book)+'</script></head>'+
   '<body><script>if(window.__readerHost)parent.postMessage({type:"reader-ready-v8",session:window.__readerHost.session},window.__readerHost.origin);</scr'+'ipt></body></html>';
 fs.writeFileSync(data,sample);
 const pinned=crypto.createHash('sha256').update(fs.readFileSync(data)).digest('hex');
 const released=fs.readFileSync(path.join(ROOT,ENTRY),'utf8');
 assert.ok(released.includes('55c1f0c18a441937560b6f7eaaa3a469b7885b371bbc319d891281f20b00a609'));
 const synthetic=released.replace(
   '55c1f0c18a441937560b6f7eaaa3a469b7885b371bbc319d891281f20b00a609',pinned);
 assert.notEqual(released,synthetic);
 const server=http.createServer((req,res)=>{
   const u=new URL(req.url,'http://localhost');
   if(u.pathname!=='/flashcards/'+ENTRY){res.writeHead(404);res.end('not found');return;}
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(synthetic);
 });
 let chrome,ws;
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  chrome=cp.spawn(process.env.CHROME_PATH||'google-chrome',[
   '--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',
   '--no-first-run','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'
  ],{stdio:'ignore'});
  await until(()=>fs.existsSync(path.join(profile,'DevToolsActivePort')),'chrome start');
  const port=Number(fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0]);
  const targets=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  const target=targets.find(x=>x.type==='page');assert.ok(target);
  ws=new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res,rej)=>{ws.addEventListener('open',res,{once:true});ws.addEventListener('error',rej,{once:true});});
  let seq=0;const pending=new Map(),errors=[];
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));
  });
  ws.addEventListener('message',e=>{
   const m=JSON.parse(e.data);
   if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(Error(m.error.message));else p?.resolve(m.result);}
   if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
  });
  const evaluate=async expression=>{
   const r=await send('Runtime.evaluate',{expression:'('+expression+')',returnByValue:true,awaitPromise:true});
   if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
   return r.result?.value;
  };
  const choose=async file=>{
    const {root}=await send('DOM.getDocument');
    const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'#file'});
    assert.ok(nodeId);await send('DOM.setFileInputFiles',{nodeId,files:[file]});
  };
  await send('Runtime.enable');await send('Page.enable');await send('DOM.enable');
  await send('Page.navigate',{url:origin+'/flashcards/'+ENTRY+'?import=1'});
  await until(()=>evaluate("document.getElementById('status')?.textContent.includes('保存された確認対象版はありません')"),'fresh picker');
  assert.equal(await evaluate("document.getElementById('setup').hidden"),false);
  const wrong=path.join(dir,'wrong.html');fs.writeFileSync(wrong,sample+'changed');
  await choose(wrong);
  await until(()=>evaluate("document.getElementById('status')?.textContent.includes('今回の確認対象版ではありません')"),'wrong SHA rejected');
  assert.equal(await evaluate("document.getElementById('setup').hidden"),false);
  await choose(data);
  await until(()=>evaluate("document.getElementById('setup').hidden"),'verified synthetic reader handshakes');
  assert.equal(await evaluate("document.getElementById('reader').src.startsWith('blob:')"),true);
  await send('Page.reload',{ignoreCache:true});
  await until(()=>evaluate("document.getElementById('status')?.textContent.includes('SHA-256一致を確認しました')"),'saved SHA readback on reload');
  assert.equal(await evaluate("document.getElementById('setup').hidden"),false,'no implicit autoplay on reload');
  assert.equal(await evaluate("document.getElementById('openSaved').hidden"),false);
  await evaluate("document.getElementById('openSaved').click()");
  await until(()=>evaluate("document.getElementById('setup').hidden"),'explicit saved-reader open');
  assert.deepEqual(errors,[],'no Chrome runtime exceptions');
  console.log('PASS new Chrome importer: wrong SHA rejected, candidate readback, successful synthetic iframe handshake, no autoplay after reload, explicit reopen');
 }finally{
  try{ws?.close();}catch(_){}try{chrome?.kill('SIGKILL');}catch(_){}
  await new Promise(r=>server.close(r));
  fs.rmSync(dir,{recursive:true,force:true});
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
