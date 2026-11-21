'use strict';
// Exercise the public template with original synthetic prose in actual Chromium.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn}=require('node:child_process'),{once}=require('node:events'),{pathToFileURL}=require('node:url');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function test(){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'novel-heading-'));
 const template=path.join(__dirname,'../templates/reader/v2');
 const book={id:'synthetic-sections',kind:'text',title:'検査用短編',blocks:[
  {type:'body',scan:20,text:'前の話がここで終わる。'},
  {type:'heading',scan:21,text:'朝の駅？'},{type:'body',scan:21,text:'何の声?'},
  {type:'heading',scan:22,text:'夕方の駅'},{type:'body',scan:22,text:'本当に?　A1はどこ？'}]};
 const html=fs.readFileSync(path.join(template,'novel.html'),'utf8');
 const file=path.join(root,'sample.html'),profile=path.join(root,'profile');
 const insertBook=html=>html.replace(/window\.READER_BOOK\s*=\s*\{[\s\S]*?\};<\/script>/,()=> 'window.READER_BOOK='+JSON.stringify(book)+';</script>');
 const sample=insertBook(html);assert.notEqual(sample,html);
 const standardTemplate=fs.readFileSync(path.join(template,'text.html'),'utf8'),standardFile=path.join(root,'standard.html');
 const standard=insertBook(standardTemplate);assert.notEqual(standard,standardTemplate);fs.writeFileSync(standardFile,standard);
 fs.writeFileSync(file,sample);
 for(const asset of ['standard.css','standard.js','novel.css','novel-dialogue.js','novel.js'])fs.copyFileSync(path.join(template,asset),path.join(root,asset));
 const binary=process.env.CHROME_BIN||['/usr/bin/google-chrome','/usr/bin/chromium'].find(fs.existsSync);
 assert.ok(binary,'Chrome or Chromium is required');
 const browser=spawn(binary,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',
  '--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:'ignore'});
 const ended=once(browser,'exit');
 let ws;
 try{
  const portFile=path.join(profile,'DevToolsActivePort');
  for(let i=0;!fs.existsSync(portFile)&&i<120;i++){assert.equal(browser.exitCode,null);await sleep(100);}
  const port=fs.readFileSync(portFile,'utf8').split('\n')[0];
  const targets=await (await fetch('http://127.0.0.1:'+port+'/json/list')).json();
  ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await once(ws,'open');
  const waiting=new Map();let id=0;
  ws.addEventListener('message',event=>{const data=JSON.parse(event.data);const callback=waiting.get(data.id);if(callback){waiting.delete(data.id);callback(data);}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{
   const key=++id,timer=setTimeout(()=>{waiting.delete(key);reject(Error('Chrome timeout: '+method));},15000);
   waiting.set(key,data=>{clearTimeout(timer);data.error?reject(Error(data.error.message)):resolve(data.result);});
   ws.send(JSON.stringify({id:key,method,params}));
  });
  async function evaluate(expression){const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert.ok(!r.exceptionDetails,r.exceptionDetails?.exception?.description);return r.result.value;}
  const frames='new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))';
  for(const [width,height] of [[320,740],[390,844],[430,930]]){
   await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:true});
   await send('Page.navigate',{url:pathToFileURL(file).href});
   let ok=false;for(let i=0;i<100&&!ok;i++){ok=await evaluate('!!(window.NovelReader && NovelReader.inspect().pages)');if(!ok)await sleep(50);}
   assert.ok(ok,'Template must finish initial pagination');
   for(let font=16;font<=30;font+=2){
    await evaluate(`(()=>{const delta=${font}-NovelReader.inspect().font; for(let i=0;i<Math.abs(delta)/2;i++)document.getElementById(delta>0?'larger':'smaller').click();})()`);
    await evaluate(frames);
    const state=await evaluate('NovelReader.inspect()');
    assert.equal(state.font,font);assert.equal(state.pages,3);assert.ok(state.textIntegrity&&!state.warning);
    for(const [index,expected] of [[0,['前の話がここで終わる。']],[1,['朝の駅？','何の声?']],[2,['夕方の駅','本当に?　A1はどこ？']]]){
     const dom=await evaluate(`(()=>{NovelReader.gotoPage(${index});return [...document.querySelector('#text-flow').children].map(n=>({tag:n.tagName,text:n.textContent,visible:n.getBoundingClientRect().width>0,orientation:getComputedStyle(n).textOrientation,
      upright:[...n.querySelectorAll('span')].filter(s=>getComputedStyle(s).textOrientation==='upright'&&s.getBoundingClientRect().width>0).map(s=>s.textContent)}));})()`);
     assert.deepEqual(dom.map(n=>n.text),expected);assert.ok(dom.every(n=>n.visible));if(index)assert.equal(dom[0].tag,'H2');
     for(const n of dom){
      assert.equal(n.orientation,'mixed');
      assert.deepEqual(n.upright,n.text.match(/[?？]/gu)||[]);
     }
    }
   }
  }
  await send('Page.navigate',{url:pathToFileURL(standardFile).href});
  let standardReady=false;
  for(let i=0;i<100&&!standardReady;i++){
   standardReady=await evaluate('!!(window.StandardReader && StandardReader.inspect().pages)');
   if(!standardReady)await sleep(50);
  }
  assert.ok(standardReady,'Standard template must finish initial pagination');
  const standardMarks=await evaluate(`(()=>{
   const flow=document.querySelector('#text-flow'),observed=[],state=StandardReader.inspect();
   for(let n=0;n<state.pages;n++){
    StandardReader.gotoPage(n);
    for(const mark of flow.querySelectorAll('span[style]')){
     if(getComputedStyle(mark).textOrientation==='upright'&&mark.getBoundingClientRect().width>0)observed.push(mark.textContent);
    }
   }
   return {observed,ok:state.textIntegrity&&!state.warning};
  })()`);
  assert.ok(standardMarks.ok);
  assert.deepEqual(standardMarks.observed,book.blocks.flatMap(b=>b.text.match(/[?？]/gu)||[]));
  console.log('Standard template preserved characters and rendered halfwidth/fullwidth questions upright');
  console.log('24 Chromium viewport/font combinations passed; 48 section starts and upright halfwidth/fullwidth questions verified');
 }finally{if(ws)ws.close();browser.kill();await ended;fs.rmSync(root,{recursive:true,force:true});}
}
test().catch(error=>{console.error(error);process.exitCode=1;});
