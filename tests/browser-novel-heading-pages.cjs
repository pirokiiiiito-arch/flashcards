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
  {type:'heading',scan:21,text:'朝の駅?'},{type:'body',scan:21,text:'何の声?!！※（鳥）…ー'},
  {type:'heading',scan:22,text:'夕方の駅'},{type:'body',scan:22,text:'A1→＋＝￥　どこ？、。'}]};
 const fixtureUpright=/[?？!！※→＋＝￥]/gu;
 const html=fs.readFileSync(path.join(template,'novel.html'),'utf8');
 const file=path.join(root,'sample.html'),profile=path.join(root,'profile');
 const insertBook=html=>html.replace(/window\.READER_BOOK\s*=\s*\{[\s\S]*?\};<\/script>/,()=> 'window.READER_BOOK='+JSON.stringify(book)+';</script>');
 const sample=insertBook(html);assert.notEqual(sample,html);
 const standardTemplate=fs.readFileSync(path.join(template,'text.html'),'utf8'),standardFile=path.join(root,'standard.html');
 const standard=insertBook(standardTemplate);assert.notEqual(standard,standardTemplate);fs.writeFileSync(standardFile,standard);
 fs.writeFileSync(file,sample);
 for(const asset of ['standard.css','standard.js','novel.css','novel-dialogue.js','novel.js'])fs.copyFileSync(path.join(template,asset),path.join(root,asset));
 const binary=process.env.CHROME_BIN||process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/chromium'].find(fs.existsSync);
 assert.ok(binary,'Chrome or Chromium is required');
 const browser=spawn(binary,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-background-networking',
  '--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+profile,'about:blank'],{stdio:['ignore','ignore','pipe']});
 let browserDiagnostics='';
 browser.stderr.on('data',chunk=>{browserDiagnostics=(browserDiagnostics+chunk).slice(-1800);});
 const ended=once(browser,'exit');
 let ws;
 try{
  const portFile=path.join(profile,'DevToolsActivePort');
  let port=0;
  const startDeadline=Date.now()+45000;
  while(Date.now()<startDeadline&&!port){
   assert.equal(browser.exitCode,null,'Chrome exited during startup: '+browserDiagnostics);
   if(fs.existsSync(portFile))port=Number(fs.readFileSync(portFile,'utf8').split('\n')[0]);
   if(!port)await sleep(100);
  }
  assert.ok(port,'Chrome did not expose its debugging port: '+browserDiagnostics);
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
    for(const [index,expected] of [[0,['前の話がここで終わる。']],[1,['朝の駅？','何の声？\u0021！※（鳥）…ー']],[2,['夕方の駅','A1→＋＝￥　どこ？、。']]]){
     const dom=await evaluate(`(()=>{NovelReader.gotoPage(${index});return [...document.querySelector('#text-flow').children].map(n=>({tag:n.tagName,text:n.textContent,visible:n.getBoundingClientRect().width>0,orientation:getComputedStyle(n).textOrientation,
      upright:[...n.querySelectorAll('span')].filter(s=>getComputedStyle(s).textOrientation==='upright'&&s.getBoundingClientRect().width>0).map(s=>s.textContent)}));})()`);
     const actual=await evaluate(`(()=>{
      const flow=document.getElementById('text-flow');
      const check=ReaderVerticalSymbols.inspect(flow);
      const measured=ReaderVerticalSymbols.inspect(document.getElementById('measure-text'));
      return {check,measured,writing:getComputedStyle(flow).writingMode};
     })()`);
     assert.equal(actual.writing,'vertical-rl');assert.equal(actual.check.mismatches,0,JSON.stringify(actual.check));
     assert.equal(actual.measured.mismatches,0,JSON.stringify(actual.measured));
     assert.equal(actual.check.halfwidthQuestions+actual.measured.halfwidthQuestions,0);
     assert.equal(actual.check.fullwidthQuestions,expected.join('').split('？').length-1);
     assert.equal(actual.check.upright,expected.join('').match(fixtureUpright)?.length||0);
     assert.deepEqual(dom.map(n=>n.text),expected);assert.ok(dom.every(n=>n.visible));if(index)assert.equal(dom[0].tag,'H2');
     for(const n of dom){
      assert.equal(n.orientation,'mixed');
      assert.deepEqual(n.upright,n.text.match(fixtureUpright)||[]);
     }
    }
   }
  }
  const fault=await evaluate(`(()=>{
   const flow=document.getElementById('text-flow'),mark=flow.querySelector('span[style*="upright"]');
   const correct=mark.style.textOrientation;mark.style.textOrientation='sideways';
   const wrong=ReaderVerticalSymbols.inspect(flow);
   mark.style.textOrientation=correct;return [wrong.mismatches,ReaderVerticalSymbols.inspect(flow).mismatches];
  })()`);
  assert.deepEqual(fault,[1,0],'a sideways symbol must be detected');
  const wrongWidth=await evaluate(`(()=>{
   const flow=document.getElementById('text-flow');
   const mark=[...flow.querySelectorAll('span')].find(n=>n.textContent==='？');
   mark.textContent='?';const wrong=ReaderVerticalSymbols.inspect(flow);
   mark.textContent='？';return [wrong.mismatches,wrong.halfwidthQuestions,ReaderVerticalSymbols.inspect(flow).mismatches];
  })()`);
  assert.deepEqual(wrongWidth,[1,1,0],'even an upright halfwidth question mark must be detected');
  await send('Page.navigate',{url:pathToFileURL(standardFile).href});
  let standardReady=false;
  for(let i=0;i<100&&!standardReady;i++){
   standardReady=await evaluate('!!(window.StandardReader && StandardReader.inspect().pages)');
   if(!standardReady)await sleep(50);
  }
  assert.ok(standardReady,'Standard template must finish initial pagination');
  const standardMarks=await evaluate(`(()=>{
   const flow=document.querySelector('#text-flow'),observed=[],state=StandardReader.inspect();let mismatches=0;
   for(let n=0;n<state.pages;n++){
    StandardReader.gotoPage(n);mismatches+=ReaderVerticalSymbols.inspect(flow).mismatches;
    for(const mark of flow.querySelectorAll('span[style]')){
     if(getComputedStyle(mark).textOrientation==='upright'&&mark.getBoundingClientRect().width>0)observed.push(mark.textContent);
    }
   }
   return {observed,ok:state.textIntegrity&&!state.warning&&!mismatches};
  })()`);
  assert.ok(standardMarks.ok);
  assert.deepEqual(standardMarks.observed,book.blocks.flatMap(b=>b.text.replaceAll('?','？').match(fixtureUpright)||[]));
  console.log('Standard template verified native and upright symbols and text integrity');
  console.log('24 Chromium viewport/font combinations passed; 48 section starts, fullwidth questions, layout measurement, injected wrong width and rotation verified');
 }finally{if(ws)ws.close();browser.kill();await ended;fs.rmSync(root,{recursive:true,force:true,maxRetries:6,retryDelay:150});}
}
test().catch(error=>{console.error(error);process.exitCode=1;});
