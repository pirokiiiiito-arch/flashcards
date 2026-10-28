/* Loopback-only full Chrome test. All account/data/network replies are synthetic;
 * real external requests are blocked. No personal vocabulary is used. */
'use strict';
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),cp=require('node:child_process'),assert=require('node:assert/strict');
const ROOT=process.cwd(),sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label){for(let i=0;i<240;i++){if(await fn())return;await sleep(100);}throw Error('Timeout: '+label);}
function bootstrap(){return `(()=>{
 const list=Array.from({length:59},(_,i)=>({id:'fixture-word-'+i,word:'検証単語 '+i,meaning:('検証用の長い説明。'+i+'\\n').repeat(50),sort_order:i,updated_at:null}));
 const events=list.map((c,i)=>({id:'fixture-event-'+i,key:'card:'+c.id,value:c,parents:[],clock:i+1,deleted:false}));
 events.push({id:'fixture-marker',key:'migration:word-network-recovery:v1',parents:[],clock:60,deleted:false,value:{schema:'word-network-migration-v2',source_sha256:'e876542cb106f90253cf5b9fed225334646ec5265a2eb808ffdff5e91a69c612',source_count:59,covered_keys:list.map(c=>'card:'+c.id),kept:59}});
 const doc=e=>({schema:'flashcards-drive-journal-v3',namespace:'word-flashcards',events:e});
 window.__fixture={journals:[{id:'fixture-initial',checksum:'unchanged',doc:doc(events)}],uploads:0,fail:false,requests:0};
 localStorage.setItem('word_drive_primary_v1','1');localStorage.setItem('simple_vocab_cards_v1',JSON.stringify(list));
 window.__remote=(key,value,deleted=false)=>{
  const all=Object.fromEntries(__fixture.journals.flatMap(j=>j.doc.events).map(e=>[e.id,e]));
  const id='fixture-remote-'+__fixture.journals.length;
  const e={id,key,value,deleted,clock:Date.now(),parents:(FlashcardsDrive.heads(all).get(key)||[]).map(x=>x.id)};
  __fixture.journals.push({id,checksum:id,doc:doc([e])});
 };
 const original=fetch.bind(window);
 window.fetch=async(input,options={})=>{
  const u=new URL(typeof input==='string'?input:input.url,document.baseURI);
  if(u.origin!=='https://www.googleapis.com')return original(input,options);
  __fixture.requests++;await new Promise(r=>setTimeout(r,35));
  const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{'Content-Type':'application/json'}});
  if(__fixture.fail)return json({error:{message:'Synthetic authentication expiry'}},401);
  if(u.pathname.endsWith('/about'))return json({user:{permissionId:'fixture-owner'}});
  if(u.pathname==='/upload/drive/v3/files'){
   const content=await options.body.text(),boundary=new Headers(options.headers).get('Content-Type').split('boundary=')[1];let payload;
   for(const part of content.split('--'+boundary)){const at=part.indexOf('\\r\\n\\r\\n');if(at<0)continue;try{const x=JSON.parse(part.slice(at+4).trim());if(x.schema==='flashcards-drive-journal-v3')payload=x;}catch{}}
   if(!payload)throw Error('Unexpected multipart fixture');
   const id='fixture-upload-'+(++__fixture.uploads);__fixture.journals.push({id,checksum:id,doc:payload});return json({id,md5Checksum:id});
  }
  if(u.pathname.endsWith('/files'))return json({files:(u.searchParams.get('q')||'').includes("value='journal'")?__fixture.journals.map(j=>({id:j.id,md5Checksum:j.checksum})):[]});
  const found=__fixture.journals.find(j=>u.pathname.endsWith('/'+j.id));if(found)return json(found.doc);
  throw Error('Unexpected synthetic Drive request '+u.pathname);
 };
 window.google={accounts:{oauth2:{hasGrantedAllScopes:()=>true,initTokenClient:c=>({requestAccessToken:()=>c.callback({access_token:'synthetic-fixture-only-token',expires_in:3600})})}}};
})();`;}
async function scenario(width,height){
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'quiet-word-'));
 const server=http.createServer((req,res)=>{
  let pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/flashcards/')pathname+='/index.html';
  const p=path.resolve(ROOT,decodeURIComponent(pathname.replace(/^\/flashcards\//,'')));
  if(!pathname.startsWith('/flashcards/')||!p.startsWith(ROOT+path.sep)||!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404);res.end();return;}
  const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml'};
  res.writeHead(200,{'Content-Type':types[path.extname(p)]||'application/octet-stream'});fs.createReadStream(p).pipe(res);
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 const chrome=cp.spawn(process.env.CHROME_PATH||'google-chrome',['--headless=new','--no-sandbox','--disable-dev-shm-usage','--no-first-run','--disable-background-networking','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 let ws,evaluate;const errors=[];
 try{
  await until(()=>fs.existsSync(path.join(profile,'DevToolsActivePort')),'Chrome startup');
  const port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];
  const target=(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');
  ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
  let seq=0;const pending=new Map();
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  ws.addEventListener('message',event=>{
   const m=JSON.parse(event.data);if(m.id){const p=pending.get(m.id);pending.delete(m.id);if(m.error)p?.reject(Error(m.error.message));else p?.resolve(m.result);return;}
   if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);
   if(m.method==='Fetch.requestPaused'){const {requestId,request}=m.params;send(request.url.startsWith(origin+'/')?'Fetch.continueRequest':'Fetch.failRequest',request.url.startsWith(origin+'/')?{requestId}:{requestId,errorReason:'Aborted'}).catch(()=>{});}
  });
  evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result?.value;};
  await send('Runtime.enable');await send('Page.enable');await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600});
  await send('Fetch.enable',{patterns:[{urlPattern:'http*',requestStage:'Request'}]});await send('Page.addScriptToEvaluateOnNewDocument',{source:bootstrap()});
  await send('Page.navigate',{url:origin+'/flashcards/word-sync-v2.html?quiet=1'});
  await until(()=>evaluate("!!window.WordDriveSync&&!!document.querySelector('#wordQuietStatus')"),'word app and quiet UI');
  await evaluate("document.querySelector('#wordQuietStatus button').click()");
  await until(()=>evaluate("!!document.querySelector('dialog [data-connect]')&&!document.querySelector('dialog [data-connect]').disabled"),'connect enabled');
  await evaluate("document.querySelector('dialog [data-connect]').click()");
  await until(()=>evaluate("WordDriveSync.status().status==='同期済み'&&!!document.querySelector('#wordNetworkProgress')&&!!window.WordDriveRecovery"),'initial sync');
  await evaluate("document.querySelector('dialog [data-close]').click();const tail=document.createElement('div');tail.style.height='700px';document.body.append(tail);order=cards.map((_,i)=>i).reverse();isShuffled=true;pos=5;render();stage.querySelector('.card').classList.add('show-back');stage.querySelector('.back').scrollTop=60;stage.querySelectorAll('.card-actions button')[1].focus({preventScroll:true});window.scrollTo(0,180)");
  await sleep(150);
  const baseline=await evaluate("({y:scrollY,top:stage.getBoundingClientRect().top,bar:document.querySelector('.topbar').getBoundingClientRect().height,face:stage.querySelector('.back').scrollTop,id:cards[currentIndex()].id})");
  await evaluate("window.__card=stage.querySelector('.card');window.__focus=document.activeElement;window.__order=order.map(i=>cards[i].id);window.__frames=[];window.__sampling=true;(function sample(){if(!__sampling)return;__frames.push({y:scrollY,top:stage.getBoundingClientRect().top,bar:document.querySelector('.topbar').getBoundingClientRect().height});requestAnimationFrame(sample)})()");
  await evaluate("(async()=>{for(let i=0;i<4;i++)await WordDriveSync.sync()})()");
  const stable=await evaluate("({same:__card===stage.querySelector('.card'),focus:document.activeElement===__focus,face:stage.querySelector('.back').scrollTop,id:cards[currentIndex()].id,back:!!stage.querySelector('.show-back'),order:order.map(i=>cards[i].id),expected:__order})");
  assert.equal(stable.same,true,'no-op sync preserves DOM');assert.equal(stable.focus,true);assert.equal(stable.face,baseline.face);assert.equal(stable.id,baseline.id);assert.equal(stable.back,true);assert.deepEqual(stable.order,stable.expected);
  await evaluate("const other=cards.find(c=>c.id!==cards[currentIndex()].id);__remote('card:'+other.id,{...other,meaning:'別カードの更新'});WordDriveSync.sync()");
  assert.equal(await evaluate("__card===stage.querySelector('.card')"),true,'other-card edit does not redraw current card');
  await evaluate("const current=cards[currentIndex()];__remote('card:'+current.id,{...current,meaning:current.meaning+'追加の説明'});WordDriveSync.sync()");
  assert.equal(await evaluate("!!stage.querySelector('.show-back')"),true);assert.equal(await evaluate("stage.querySelector('.back').scrollTop"),baseline.face);
  await sleep(100);const frames=await evaluate("__sampling=false;__frames");assert.ok(frames.length>3);
  for(const f of frames){assert.ok(Math.abs(f.y-baseline.y)<=1,'scrollY must remain stable');assert.ok(Math.abs(f.top-baseline.top)<=1,'card viewport position must remain stable');assert.ok(Math.abs(f.bar-baseline.bar)<=1,'toolbar height must remain stable');}
  await evaluate("showDraft();const t=stage.querySelector('textarea');t.value='入力途中';t.focus({preventScroll:true});t.setSelectionRange(2,3);window.__draft=t;WordDriveSync.sync()");
  assert.equal(await evaluate("__draft===document.activeElement&&__draft.value==='入力途中'&&__draft.selectionStart===2&&__draft.selectionEnd===3"),true,'draft and selection survive sync');
  // The real Save handler starts the existing 1.5-second automatic upload.
  await evaluate("const t=stage.querySelectorAll('textarea');t[0].value='自動送信の検証';t[1].value='検証用説明';stage.querySelector('.small.save').click()");
  await until(()=>evaluate("cards.length===60&&!editing"),'local save');
  await evaluate("window.__savedCard=stage.querySelector('.card')");
  await until(()=>evaluate("WordDriveSync.status().status==='同期済み'&&Object.values(WordDriveSync.view().data).some(c=>c?.word==='自動送信の検証')"),'automatic upload without sync button');
  assert.equal(await evaluate("__savedCard===stage.querySelector('.card')"),true,'auto-sync does not rebuild newly saved card');
  const y=await evaluate('scrollY');await evaluate("__fixture.fail=true;WordDriveSync.sync().catch(()=>{})");
  assert.equal(await evaluate("document.querySelector('#wordQuietStatus span').dataset.state"),'未接続');assert.equal(await evaluate('scrollY'),y);
  assert.equal(await evaluate("document.querySelector('#wordNetworkProgress').closest('dialog')?.id"),'wordQuietDetails');
  assert.equal(await evaluate("document.querySelector('#wordQuietDetails').open"),false,'no automatic diagnostic popup');
  assert.deepEqual(errors,[],'no runtime error');console.log('PASS quiet word UI',width+'x'+height,'4 no-op syncs; remote edits; draft focus; automatic save; auth expiry; scroll and card stability');
 }catch(e){if(evaluate)console.error(await evaluate("({sync:window.WordDriveSync?.status(),label:document.querySelector('#wordQuietStatus')?.textContent,body:document.body.innerText.slice(-1600)})").catch(()=>null));console.error(errors);throw e;}
 finally{try{ws?.close()}catch{}chrome.kill('SIGTERM');server.closeAllConnections();await new Promise(r=>server.close(r));await sleep(150);fs.rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
}
(async()=>{await scenario(1200,700);await scenario(390,760)})().catch(e=>{console.error(e);process.exitCode=1});
