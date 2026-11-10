'use strict';
/* Synthetic layout regression only. No private book content or photos. */
const fs=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');
const {chromium,webkit}=require('playwright');
const path=require('node:path');const root=path.resolve(__dirname,'..');
const base=fs.readFileSync(root+'/reader/wh1/all/wh1-exact-pagination.js','utf8');
const fix=fs.readFileSync(root+'/reader/wh1/all/wh1-figure-viewport-v8.js','utf8');
const c={window:{},console};vm.createContext(c);vm.runInContext(base,c);
const oldDecorate=c.window.WH1ExactPager.decorate;vm.runInContext(fix,c);
const text='検証用の説明です。行の左端から最後の文字まで表示します。本文と画像のデータは変更しません。';
const picture='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="480" height="160"><rect x="2" y="2" width="476" height="156" fill="white" stroke="black"/><text x="12" y="85" font-size="24">LAYOUT TEST</text></svg>');
const source=`<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>世界の歴史1｜表示検証（11〜30枚目）</title><style>
*{box-sizing:border-box}:root{--size:20px;--ink:#273034}html,body{margin:0;height:100%;width:100%}body{display:flex;flex-direction:column;background:white}.toolbar{flex:0 0 70px}.toolbar-line{display:flex;padding:5px 11px}.brand strong{font-size:15px}.head-actions{display:flex}.reader-main{flex:1;min-height:0;width:100%;display:flex;justify-content:center;overflow:hidden}.sheet{position:relative;width:100%;max-width:520px;height:100%;padding:10px 12px;overflow:hidden}.reading-stage{width:100%;height:100%;position:relative}.reader-footer{height:52px;flex:0 0 52px}.measuring-sheet{position:fixed;left:-20000px;top:-20000px;visibility:hidden}
#reader-page{clip-path:inset(0 0 0 30px)}#sheet::before{content:'';position:absolute;left:0;top:0;bottom:0;width:42px;background:white;z-index:100}
.figure-bundle{display:flex;flex-direction:column;width:100%;height:100%;border:1px solid;padding:9px 10px;gap:6px;overflow:hidden}.figure-bundle-header{display:flex;flex-direction:column;gap:3px;flex:0 0 auto}.figure-bundle-kicker{font-size:11px}.figure-bundle-title{font-size:15px}.figure-bundle-art{height:41%;flex:0 0 41%;min-height:0;overflow:hidden}.figure-bundle-art img{width:100%;height:100%;object-fit:contain}.figure-bundle-figlabel{font-size:11px;flex:0 0 auto}.figure-bundle-explanation{border-top:1px solid;padding-top:7px;display:flex;flex-direction:column;gap:4px;flex:1 1 auto;min-height:0;overflow:hidden}.figure-bundle-caption-label{display:flex;justify-content:space-between;font-size:11px;flex:0 0 auto}.figure-bundle-caption-text{font-size:clamp(15px,calc(var(--size)*.84),25px);line-height:1.48;white-space:pre-wrap;overflow-wrap:anywhere;flex:1 1 auto;min-height:0;overflow:hidden}.figure-bundle-caption-content{display:block}.text-flow{writing-mode:vertical-rl}
</style></head><body><header class="toolbar"><div class="toolbar-line"><div class="brand"><strong>世界の歴史1</strong></div><div class="head-actions"><button id="open-menu">全巻</button></div></div></header><main id="reader-main" class="reader-main"><article id="sheet" class="sheet"><div id="reader-page" class="reading-stage"></div></article></main><footer class="reader-footer"><div id="location"></div><div id="position"></div><div id="progress-fill"></div></footer><div id="measuring-sheet" class="sheet measuring-sheet"><div class="reading-stage"><div id="measure-flow"></div></div></div><script>
const FIRST_SCAN=11; const LAST_SCAN=30;
const blocks=Array.from({length:99},()=>({type:'body',scan:22,text:''}));blocks[0].scan=11;blocks[98].scan=30;
blocks[55]={type:'figure',scan:22,image:'fixture.svg'};blocks[57].text=${JSON.stringify(text)};
const ILLUSTRATION_GROUPS=[{at:55,scan:22,figs:[55],desc:[57],title:'表示検証'}];
const ILLUSTRATION_BY_START=new Map([[55,ILLUSTRATION_GROUPS[0]]]);const ILLUSTRATION_CONSUMED=new Set();
const picture=${JSON.stringify(picture)};
let pages=[],currentPage=0,fontPx=20;
const PAGE_INITIAL_FORBIDDEN=/^[、。]/;
function keepNumericGroup(t,k){return k}function keepPunctuationWithPrevious(t,k,max){return Math.min(k,max)}
function node(tag,cls,str){const e=document.createElement(tag);if(cls)e.className=cls;if(str!==undefined)e.textContent=str;return e;}
function bundleData(g){return {type:'illustration',group:g.at,scan:g.scan,heading:g.title,label:g.title,descriptionFull:blocks[57].text,figures:[{image:'fixture.svg',caption:'テスト図'}]};}
function makeIllustration(p,measuring=false){const r=node('section','figure-bundle');r.dataset.scan=p.scan;r.dataset.figureGroup=p.group;const h=node('div','figure-bundle-header');h.append(node('div','figure-bundle-kicker','図版 ｜ 原本22枚目'),node('div','figure-bundle-title','表示検証'));const a=node('div','figure-bundle-art');const im=node('img');if(!measuring)im.src=picture;a.append(im);const e=node('div','figure-bundle-explanation'),l=node('div','figure-bundle-caption-label');l.append(node('span','','この図の説明'));const b=node('div','figure-bundle-caption-text');b.append(node('span','figure-bundle-caption-content',p.description));e.append(l,b);r.append(h,a,node('div','figure-bundle-figlabel','テスト図'),e);return r;}
function appendIllustrationPages(g,out){out.push({...bundleData(g),description:blocks[57].text});}
function showPage(){const p=pages[currentPage],a=document.getElementById('reader-page');a.replaceChildren(p.type==='illustration'?makeIllustration(p):node('div','text-flow','検証本文'));document.getElementById('location').textContent=String(currentPage+1);}
function buildPages(){const s=document.getElementById('sheet').getBoundingClientRect(),m=document.getElementById('measuring-sheet');m.style.width=s.width+'px';m.style.height=s.height+'px';const out=[];appendIllustrationPages(ILLUSTRATION_GROUPS[0],out);pages=[...out,{type:'text',scan:22}];currentPage=0;showPage();}
document.getElementById('reader-page').style.setProperty('clip-path','inset(0px 0px 0px 30px)','important');
document.addEventListener('DOMContentLoaded',buildPages);
</script></body></html>`;
(async()=>{
 fs.mkdirSync(root+'/wh1-v8-test-results',{recursive:true});const results=[];
 for(const [engine,launcher] of [['chromium',chromium],['webkit',webkit]]){
  const browser=await launcher.launch({headless:true});
  const baseline=await browser.newPage({viewport:{width:390,height:666}});
  await baseline.setContent(oldDecorate(source));
  const legacyClip=await baseline.locator('#reader-page').evaluate(e=>getComputedStyle(e).clipPath);
  assert.notEqual(legacyClip,'none');await baseline.close();
  for(const [width,height] of [[320,568],[375,640],[390,666],[430,740]]){
   const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.setContent(c.window.WH1ExactPager.decorate(source));
   await page.waitForFunction(()=>window.__WH1_VIEWPORT8_STATUS__?.horizontalBounds===true);
   for(const size of [16,18,20,22,24,26,28,30]){
    await page.evaluate(size=>{fontPx=size;document.documentElement.style.setProperty('--size',size+'px');buildPages();},size);
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const actual=await page.evaluate(()=>{
     const a=document.getElementById('reader-page'),r=a.querySelector('.figure-bundle'),s=document.getElementById('sheet');
     const t=r.querySelector('.figure-bundle-caption-content');const range=document.createRange();range.setStart(t.firstChild,0);range.setEnd(t.firstChild,1);
     const first=range.getBoundingClientRect(),sr=s.getBoundingClientRect(),ar=a.getBoundingClientRect();
     return {clip:getComputedStyle(a).clipPath,pseudo:getComputedStyle(s,'::before').display,left:first.left,right:first.right,sheetLeft:sr.left,sheetRight:sr.right,areaLeft:ar.left,hasVersion:!!document.getElementById('wh1-display-revision8'),image:r.querySelector('img').src,full:pages.filter(p=>p.type==='illustration').map(p=>p.description).join(''),font:getComputedStyle(document.documentElement).getPropertyValue('--size')};
    });
    assert.equal(actual.clip,'none');assert.equal(actual.pseudo,'none');assert.ok(actual.hasVersion);
    assert.ok(actual.left>=actual.sheetLeft+12&&actual.right<=actual.sheetRight);assert.equal(actual.full,text);assert.equal(actual.image,picture);assert.equal(actual.font,size+'px');
    // Leaving a figure must restore the original vertical-text behavior.
    await page.evaluate(()=>{currentPage=pages.length-1;showPage();});
    assert.equal(await page.locator('html').evaluate(e=>e.classList.contains('wh1-picture-v8')),false);
    assert.notEqual(await page.locator('#reader-page').evaluate(e=>getComputedStyle(e).clipPath),'none');
    await page.evaluate(()=>{currentPage=0;showPage();});
    assert.equal(await page.locator('#reader-page').evaluate(e=>getComputedStyle(e).clipPath),'none');
    if(width===390&&size===20)await page.screenshot({path:root+'/wh1-v8-test-results/'+engine+'-390x666-20px.png'});
    results.push({engine,width,height,size,pass:true});
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  await browser.close();
 }
 fs.writeFileSync(root+'/wh1-v8-test-results/results.json',JSON.stringify({scope:'Synthetic regression, not private-book or physical-iPhone testing',conditions:results.length,results},null,2));
 console.log('WH1_V8_BROWSER_PASS '+results.length+' conditions, Chromium and WebKit. Synthetic fixture only.');
})().catch(e=>{console.error(e);process.exit(1)});
