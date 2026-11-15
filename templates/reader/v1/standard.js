/* WH1-based standard reader v1 — shared text and original-image engine.
   Public template code only: never embed a user's private original or OCR. */
(()=>{'use strict';
const book=window.READER_BOOK;
if(!book||!['text','image'].includes(book.kind))throw Error('READER_BOOK.kind は text または image が必要です');
const $=id=>document.getElementById(id);
const required=['sheet','measure-sheet','text-flow','measure-text','figure-stage','measure-figure',
'figure-image','figure-placeholder','figure-caption','measure-caption','figure-caption-label',
'measure-caption-label','original','first','all','smaller','larger','current-size',
'prev','next','page-major','page-minor','progress-fill','book-title','shelf-status',
'menu-backdrop','menu-items','menu-close','original-backdrop','original-close','original-image'];
for(const id of required)if(!$(id))throw Error('必要な表示要素がありません: '+id);
const mode=book.kind,bookId=String(book.id||'standard-'+mode),key='standard-reader-v1:'+bookId;
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('ja',{granularity:'grapheme'}):null;
const split=x=>segmenter?Array.from(segmenter.segment(String(x||'')),v=>v.segment):Array.from(String(x||''));
const blocks=(Array.isArray(book.blocks)?book.blocks:[]).filter(b=>b&&typeof b.text==='string'&&b.text.length)
 .map(b=>({type:b.type==='heading'?'heading':'body',text:b.text,scan:Number(b.scan)||1,units:split(b.text)}));
const figures=(Array.isArray(book.figures)?book.figures:[]).map((f,i)=>({
 id:String(f.id||'figure-'+(i+1)),title:String(f.title||'図版 '+(i+1)),
 alt:String(f.alt||f.title||'原本画像'),scan:Number(f.scan)||1,
 source:f.src||null,caption:String(f.caption||''),units:split(f.caption||''),ownedURL:null
}));
const main=$('reader-main'),sheet=$('sheet'),measureSheet=$('measure-sheet');
const textFlow=$('text-flow'),measureText=$('measure-text'),caption=$('figure-caption'),measureCaption=$('measure-caption');
let font=20,pages=[],index=0,activeFigure=-1,activeSrc=null,sourceURL=null,rebuildFrame=0,touch=null,warning='';
try{const saved=JSON.parse(localStorage.getItem(key)||'null');
 if(saved&&Number.isFinite(saved.font))font=Math.max(16,Math.min(30,Math.round(saved.font/2)*2));
}catch(_){}
document.documentElement.style.setProperty('--size',font+'px');
$('current-size').textContent=font+'px';
$('book-title').textContent=String(book.title||'標準読書テンプレート');
$('shelf-status').textContent=String(book.status||'見本・原本未登録');
$('text-flow').hidden=mode!=='text';$('measure-text').hidden=mode!=='text';
$('figure-stage').hidden=mode!=='image';$('measure-figure').hidden=mode!=='image';
function readPoint(){try{const state=JSON.parse(localStorage.getItem(key)||'null');return Math.max(0,Number(state?.point)||0)}catch(_){return 0}}
function persist(){try{localStorage.setItem(key,JSON.stringify({font,point:pages[index]?.start||0}))}catch(_){}}
function syncMeasure(){
 const r=sheet.getBoundingClientRect();
 if(r.width<80||r.height<80)throw Error('表示領域が小さすぎます');
 measureSheet.style.width=r.width+'px';measureSheet.style.height=r.height+'px';
}
function fit(el){return el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1}
function partNode(p){
 const el=document.createElement(p.type==='heading'?'h2':'span');
 el.className=p.type==='heading'?'section-heading':('paragraph'+(p.continued?' continued':''));
 el.textContent=p.text;return el;
}
function fitsParts(existing,additional){
 const fragment=document.createDocumentFragment();
 for(const p of existing)fragment.append(partNode(p));
 if(additional)fragment.append(partNode(additional));
 measureText.replaceChildren(fragment);return fit(measureText);
}
function textPart(b,off,n){return {type:b.type,scan:b.scan,text:b.units.slice(off,off+n).join(''),continued:off>0}}
function paginateText(){
 const out=[];let current=[],at=0,begin=0;
 const flush=()=>{
  if(!current.length)return;
  out.push({kind:'text',parts:current,start:begin,end:at,scan:current[0].scan});
  current=[];begin=at;
 };
 for(const b of blocks){
  let off=0;
  while(off<b.units.length){
   const remaining=b.units.length-off,whole=textPart(b,off,remaining);
   if(fitsParts(current,whole)){current.push(whole);off+=remaining;at+=remaining;continue}
   let lo=0,hi=remaining;
   while(lo<hi){const mid=Math.ceil((lo+hi)/2);
    if(fitsParts(current,textPart(b,off,mid)))lo=mid;else hi=mid-1;
   }
   if(lo===0){
    if(current.length){flush();continue}
    throw Error('文字サイズに対して本文領域が不足しています');
   }
   current.push(textPart(b,off,lo));off+=lo;at+=lo;flush();
  }
 }
 flush();return out;
}
function captionFits(value){measureCaption.textContent=value;return fit(measureCaption)}
function paginateFigures(){
 const out=[];let global=0;
 figures.forEach((f,i)=>{
  $('measure-caption-label').textContent=f.title;
  if(f.units.length===0){out.push({kind:'image',figure:i,caption:'',start:global,end:global,subpage:1});return}
  let off=0,count=0;
  while(off<f.units.length){
   const remain=f.units.length-off;let lo=0,hi=remain;
   while(lo<hi){
    const mid=Math.ceil((lo+hi)/2);
    if(captionFits(f.units.slice(off,off+mid).join('')))lo=mid;else hi=mid-1;
   }
   if(lo===0)throw Error('図版の説明文を表示する領域が不足しています');
   count++;out.push({kind:'image',figure:i,caption:f.units.slice(off,off+lo).join(''),
    start:global,end:global+lo,subpage:count});
   global+=lo;off+=lo;
  }
 });
 return out;
}
function pageAt(point){
 let result=0;
 for(let i=0;i<pages.length;i++)if(pages[i].start<=point)result=i;else break;
 return result;
}
function currentSource(){
 const p=pages[index];if(!p)return null;
 if(mode==='image')return figures[p.figure]?.ownedURL||figures[p.figure]?.source||null;
 const originals=Array.isArray(book.originals)?book.originals:[];
 return sourceURL||originals.find(x=>Number(x.scan)===Number(p.scan))?.src||null;
}
function setFigure(p){
 const f=figures[p.figure],src=f.ownedURL||f.source||null,img=$('figure-image');
 if(p.figure!==activeFigure||activeSrc!==src){
  if(src){img.src=src;img.hidden=false;$('figure-placeholder').hidden=true}
  else{img.removeAttribute('src');img.hidden=true;$('figure-placeholder').hidden=false}
  img.alt=f.alt;activeFigure=p.figure;activeSrc=src;
 }
 $('figure-caption-label').textContent=f.title;
 caption.textContent=p.caption;
 $('figure-stage').classList.toggle('no-caption',!f.caption);
}
function render(){
 const p=pages[index];
 if(!p){
  $('page-major').textContent='0 / 0';$('page-minor').textContent='読書データ未登録';
  $('progress-fill').style.width='0%';$('prev').disabled=true;$('next').disabled=true;
  $('original').disabled=true;return;
 }
 if(mode==='text'){
  const frag=document.createDocumentFragment();
  for(const part of p.parts)frag.append(partNode(part));
  textFlow.replaceChildren(frag);
 }else setFigure(p);
 $('page-major').textContent=(index+1)+' / '+pages.length;
 const total=Number(book.totalScans)||1;
 $('page-minor').textContent=mode==='text'?('原本 '+p.scan+' / '+total):
  ('原本 '+figures[p.figure].scan+' / '+total+' ｜ 図版 '+(p.figure+1)+' / '+figures.length+' ｜ 説明 '+p.subpage);
 $('progress-fill').style.width=(100*(index+1)/pages.length).toFixed(2)+'%';
 $('prev').disabled=index===0;$('next').disabled=index>=pages.length-1;
 $('original').disabled=!currentSource();persist();
}
function gotoPage(n){if(!pages.length)return;const k=Math.max(0,Math.min(n,pages.length-1));if(k!==index){index=k;render()}}
function menuRefresh(){
 const list=$('menu-items');list.replaceChildren();
 if(mode==='text'){
  let offset=0;
  blocks.forEach(b=>{
   if(b.type==='heading'){
    const target=offset,btn=document.createElement('button');btn.type='button';
    btn.className='menu-item';btn.textContent=b.text;
    btn.addEventListener('click',()=>{gotoPage(pageAt(target));closeDialogs()});list.append(btn);
   }offset+=b.units.length;
  });
 }else figures.forEach((f,i)=>{
  const btn=document.createElement('button');btn.type='button';btn.className='menu-item';
  btn.textContent=(i+1)+'．'+f.title;
  btn.addEventListener('click',()=>{gotoPage(pages.findIndex(p=>p.figure===i));closeDialogs()});
  list.append(btn);
 });
}
function rebuild(){
 try{
  const point=pages[index]?.start??readPoint();
  syncMeasure();
  pages=mode==='text'?paginateText():paginateFigures();
  index=pageAt(point);warning='';render();menuRefresh();
 }catch(e){
  warning=String(e?.message||e);$('shelf-status').textContent='組版要確認';
  $('page-minor').textContent=warning;console.error('Reader layout:',e);
 }
}
function zoomed(){return Number(window.visualViewport?.scale||1)>1.04}
function schedule(){
 if(rebuildFrame)cancelAnimationFrame(rebuildFrame);
 rebuildFrame=requestAnimationFrame(()=>{rebuildFrame=0;if(!zoomed())rebuild()});
}
function changeFont(d){
 const n=Math.max(16,Math.min(30,font+d));
 if(n===font)return;font=n;
 document.documentElement.style.setProperty('--size',font+'px');
 $('current-size').textContent=font+'px';
 $('smaller').disabled=font<=16;$('larger').disabled=font>=30;
 schedule();
}
function closeDialogs(){$('menu-backdrop').hidden=true;$('original-backdrop').hidden=true}
$('prev').addEventListener('click',()=>gotoPage(index-1));
$('next').addEventListener('click',()=>gotoPage(index+1));
$('first').addEventListener('click',()=>gotoPage(0));
$('smaller').addEventListener('click',()=>changeFont(-2));
$('larger').addEventListener('click',()=>changeFont(2));
$('all').addEventListener('click',()=>{$('menu-backdrop').hidden=false});
$('menu-close').addEventListener('click',closeDialogs);
$('original-close').addEventListener('click',closeDialogs);
for(const id of ['menu-backdrop','original-backdrop'])$(id).addEventListener('click',e=>{if(e.target===$(id))closeDialogs()});
$('original').addEventListener('click',()=>{
 const src=currentSource();if(!src)return;
 $('original-image').src=src;$('original-backdrop').hidden=false;
});
function fileURL(file){
 if(!file||!['image/jpeg','image/png','image/webp'].includes(file.type))
  throw Error('JPEG・PNG・WebPを選択してください');
 return URL.createObjectURL(file);
}
if($('figure-file'))$('figure-file').addEventListener('change',()=>{
 try{
  const file=$('figure-file').files?.[0];if(!file||!pages[index])return;
  const f=figures[pages[index].figure];
  if(f.ownedURL)URL.revokeObjectURL(f.ownedURL);
  f.ownedURL=fileURL(file);activeSrc=null;render();
 }catch(e){alert(String(e.message||e))}
});
if($('source-file'))$('source-file').addEventListener('change',()=>{
 try{
  const file=$('source-file').files?.[0];if(!file)return;
  if(sourceURL)URL.revokeObjectURL(sourceURL);
  sourceURL=fileURL(file);$('original').disabled=!currentSource();
 }catch(e){alert(String(e.message||e))}
});
function reflectZoom(){document.body.classList.toggle('zoomed',zoomed())}
main.addEventListener('touchstart',e=>{
 if(e.touches.length!==1||zoomed()){touch=null;return}
 const t=e.touches[0];touch={x:t.clientX,y:t.clientY};
},{passive:true});
main.addEventListener('touchend',e=>{
 if(!touch||zoomed()||e.changedTouches.length!==1){touch=null;return}
 const t=e.changedTouches[0],dy=t.clientY-touch.y,dx=t.clientX-touch.x;touch=null;
 if(Math.abs(dy)>45&&Math.abs(dy)>1.3*Math.abs(dx)){
  e.preventDefault();gotoPage(index+(dy<0?1:-1));
 }
},{passive:false});
main.addEventListener('touchcancel',()=>{touch=null},{passive:true});
window.addEventListener('keydown',e=>{
 if(!$('menu-backdrop').hidden||!$('original-backdrop').hidden){
  if(e.key==='Escape')closeDialogs();return;
 }
 if(e.key==='ArrowDown'||e.key==='PageDown'){e.preventDefault();gotoPage(index+1)}
 if(e.key==='ArrowUp'||e.key==='PageUp'){e.preventDefault();gotoPage(index-1)}
});
window.addEventListener('resize',schedule);
if(window.visualViewport){
 window.visualViewport.addEventListener('resize',()=>{reflectZoom();if(!zoomed())schedule()});
 window.visualViewport.addEventListener('scroll',reflectZoom);
}
if(window.ResizeObserver)new ResizeObserver(schedule).observe(sheet);
window.addEventListener('pagehide',()=>{
 persist();if(sourceURL)URL.revokeObjectURL(sourceURL);
 figures.forEach(f=>{if(f.ownedURL)URL.revokeObjectURL(f.ownedURL)});
});
$('smaller').disabled=font<=16;$('larger').disabled=font>=30;
window.StandardReader=Object.freeze({version:'v1',kind:mode,bookId,inspect:()=>({
 pages:pages.length,index,font,warning,originalReady:!!currentSource()
})});
requestAnimationFrame(rebuild);
})();