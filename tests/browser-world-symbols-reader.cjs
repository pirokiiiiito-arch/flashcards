'use strict';
/* Synthetic-only visual regression. No proprietary book text or images. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const repair=require('../reader/world-symbols/001-020/reader-repair-v1.js');
const source=fs.readFileSync(path.join(__dirname,'fixtures/world-symbols-synthetic.html'),'utf8');
const fixed=repair.repair(source).html;
async function moveTouch(page,down){
 return page.evaluate(down=>{
  const element=document.getElementById('readView');
  const oldY=down?285:455,newY=down?410:330;
  // Construct the event envelope directly: WebKit's Touch constructor can be
  // unavailable in headless regression even when its touch event handlers work.
  // This tests the reader's real listeners in both engines without a fake iPhone pass.
  const make=(y)=>({identifier:1,target:element,clientX:190,clientY:y,screenX:190,screenY:y,pageX:190,pageY:y});
  const dispatch=(name,touches,changedTouches)=>{
    const event=new Event(name,{bubbles:true,cancelable:true});
    Object.defineProperties(event,{
      touches:{value:touches},
      targetTouches:{value:touches},
      changedTouches:{value:changedTouches}
    });
    element.dispatchEvent(event);
  };
  const first=make(oldY),last=make(newY);
  dispatch('touchstart',[first],[first]);
  dispatch('touchmove',[last],[last]);
  dispatch('touchend',[],[last]);
 },down);
}
async function gotoScan(page,scan){
 await page.evaluate(scan=>{index=scan-1;subIndex=0;refresh();},scan);
 assert.ok((await page.locator('#where').innerText()).includes(String(scan).padStart(3,'0')));
}
async function testEngine(engine,name){
 const browser=await engine.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,isMobile:true,deviceScaleFactor:1});
  await page.setContent(fixed,{waitUntil:'domcontentloaded'});
  await page.locator('#readingStage').waitFor();
  await gotoScan(page,9);
  const initial=await page.locator('#whereSub').innerText();
  assert.match(initial,/1 \/ [2-9]\d*/,name+' requires multi-screen synthetic page');
  await moveTouch(page,false);
  const forward=await page.locator('#whereSub').innerText();
  assert.notEqual(forward,initial,name+' up-swipe must advance a page');
  await moveTouch(page,true);
  assert.equal(await page.locator('#whereSub').innerText(),initial,name+' down-swipe must return');
  await gotoScan(page,5);
  const figPage=await page.locator('#whereSub').innerText();
  assert.match(figPage,/1 \/ [2-9]\d*/,name+' long caption needs continuation');
  const before=await page.evaluate(()=>{
   const el=document.querySelector('.figure-frame');window.__figureFrameForTest=el;
   const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height];
  });
  await page.locator('#next').click();
  const after=await page.evaluate(()=>{
   const el=document.querySelector('.figure-frame');const r=el.getBoundingClientRect();
   return {same:el===window.__figureFrameForTest,box:[r.x,r.y,r.width,r.height]};
  });
  assert.equal(after.same,true,name+' figure node must persist across caption screens');
  for(let i=0;i<4;i++)assert.ok(Math.abs(after.box[i]-before[i])<1,name+' figure position/size invariant '+i);
  await gotoScan(page,9);
  for(const width of [320,390,430]){
   await page.setViewportSize({width,height:650});
   for(const font of [16,18,20,22,24,26,28,30]){
    await page.evaluate(size=>{font=size;book.fontSize=size;subIndex=0;refresh();},font);
    const x=await page.evaluate(()=>{
     const e=document.getElementById('readingStage');
     return {w:e.clientWidth,sw:e.scrollWidth,h:e.clientHeight,sh:e.scrollHeight,text:e.textContent.length};
    });
    assert.ok(x.text>0,name+' missing text at '+width+'/'+font);
    assert.ok(x.sw<=x.w+4 && x.sh<=x.h+4,name+' clipping '+width+'/'+font+': '+JSON.stringify(x));
   }
  }
  await browser.close();
  process.stdout.write('PASS '+name+' gestures, fixed figure and 24 synthetic screen sizes\n');
 }catch(e){await browser.close();throw e;}
}
(async()=>{
 await testEngine(chromium,'Chromium');
 await testEngine(webkit,'WebKit');
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
