/* Novel-only engine fork of WH1 standard reader v2. It is intentionally isolated
   so history/figure book rendering is unchanged. Dialogue starts a separate
   vertical column without inserting/deleting any Japanese source characters. */
(()=>{'use strict';
const book=window.READER_BOOK;
if(!book||!['text','image','mixed'].includes(book.kind))throw Error('READER_BOOK.kind は text / image / mixed のいずれかが必要です');
if(!window.NovelDialogue||typeof window.NovelDialogue.expandBlocks!=='function')throw Error('小説用のセリフ改行処理が読み込まれていません');
const $=id=>document.getElementById(id);
const required=['sheet','measure-sheet','text-flow','measure-text','figure-stage','measure-figure',
'figure-image','figure-placeholder','figure-caption','measure-caption','figure-caption-label',
'measure-caption-label','original','first','all','smaller','larger','current-size',
'prev','next','page-major','page-minor','progress-fill','book-title','shelf-status',
'menu-backdrop','menu-items','menu-close','original-backdrop','original-close','original-image'];
for(const id of required)if(!$(id))throw Error('必要な表示要素がありません: '+id);
const mode=book.kind,bookId=String(book.id||'novel-'+mode),key='novel-reader-v1:'+bookId;
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('ja',{granularity:'grapheme'}):null;
const split=x=>segmenter?Array.from(segmenter.segment(String(x||'')),v=>v.segment):Array.from(String(x||''));
const sourceBlocks=Array.isArray(book.blocks)?book.blocks:[];
let blocks=window.NovelDialogue.expandBlocks(sourceBlocks)
 .map(b=>({type:b.type==='heading'?'heading':b.type==='dialogue'?'dialogue':'body',text:b.text,scan:b.scan,units:split(b.text)}));
let figures=(Array.isArray(book.figures)?book.figures:[]).map((f,i)=>({
 id:String(f.id||'figure-'+(i+1)),title:String(f.title||'図版 '+(i+1)),
 alt:String(f.alt||f.title||'原本画像'),scan:Number(f.scan)||1,
 source:f.src||null,caption:String(f.caption||''),units:split(f.caption||''),ownedURL:null
}));
const flow=[];
if(mode==='mixed'){
 blocks=[];figures=[];
 const entries=Array.isArray(book.entries)?book.entries:[];
 if(!entries.length)throw Error('mixedモードには原本順のentriesが必要です');
 for(const entry of entries){
  if(entry?.kind==='text'){
   const group=Array.isArray(entry.blocks)?entry.blocks:[entry];
   const segments=window.NovelDialogue.expandBlocks(group.filter(b=>b&&typeof b.text==='string').map(b=>({...b,scan:Number(b.scan||entry.scan)})));
   for(const b of segments){
    if(!b.text.length)continue;
    const scan=Number(b.scan);
    if(!Number.isInteger(scan)||scan<1)throw Error('本文の原本番号が不正です');
    blocks.push({type:b.type==='heading'?'heading':b.type==='dialogue'?'dialogue':'body',text:b.text,scan,units:split(b.text)});
    flow.push({kind:'text',block:blocks.length-1});
   }
  }else if(entry?.kind==='image'){
   const scan=Number(entry.scan);
   if(!Number.isInteger(scan)||scan<1)throw Error('画像の原本番号が不正です');
   const f={id:String(entry.id||'figure-'+(figures.length+1)),
     title:String(entry.title||'原本 '+scan),alt:String(entry.alt||entry.title||'原本画像'),
     scan,source:entry.src||null,caption:String(entry.caption||''),
     units:split(entry.caption||''),ownedURL:null};
   figures.push(f);flow.push({kind:'image',figure:figures.length-1});
  }else throw Error('mixedモードの項目種別が不正です');
 }
}else if(mode==='text'){
 blocks.forEach((_,i)=>flow.push({kind:'text',block:i}));
}else figures.forEach((_,i)=>flow.push({kind:'image',figure:i}));
const main=$('reader-main'),sheet=$('sheet'),measureSheet=$('measure-sheet');
const textFlow=$('text-flow'),measureText=$('measure-text'),caption=$('figure-caption'),measureCaption=$('measure-caption');
const host=window.__readerHost||null,embedded=window.parent!==window;
let hostScale=1,hostKnown=!embedded,hostSeq=-1;
let font=20,pages=[],index=0,activeFigure=-1,activeSrc=null,sourceURL=null,rebuildFrame=0,touch=null,warning='';
function validHostPosition(v){return v&&v.schema==='standard-reader-position-v2'&&v.bookId===bookId&&
 Number.isSafeInteger(v.point)&&v.point>=0&&v.point<10000000&&
 Number.isInteger(v.font)&&v.font>=16&&v.font<=30&&v.font%2===0;}
function readStored(){try{
 const p=JSON.parse(localStorage.getItem(key)||'null');return validHostPosition(p)?p:null;
}catch(_){return null;}}
const initialPosition=validHostPosition(host?.initialPosition)?host.initialPosition:readStored();
if(initialPosition)font=initialPosition.font;
function postHost(type,body={}){
 if(!embedded||typeof host?.session!=='string'||!host.session||!host.origin)return;
 try{parent.postMessage({type,session:host.session,...body},host.origin)}catch(_){}
}
function receiveHost(e){
 const m=e.data;
 if(!embedded||!host||e.source!==parent||e.origin!==host.origin||
   !m||m.session!==host.session||m.type!=='reader-viewport-v8')return;
 if(!Number.isSafeInteger(m.seq)||m.seq<=hostSeq||typeof m.scale!=='number'||
   !Number.isFinite(m.scale)||m.scale<.5||m.scale>10)return;
 hostSeq=m.seq;hostScale=m.scale;hostKnown=true;reflectZoom();
}
window.addEventListener('message',receiveHost);
document.documentElement.style.setProperty('--size',font+'px');
$('current-size').textContent=font+'px';
$('book-title').textContent=String(book.title||'標準読書テンプレート');
$('shelf-status').textContent=String(book.status||'見本・原本未登録');
$('text-flow').hidden=mode==='image';$('measure-text').hidden=mode==='image';
$('figure-stage').hidden=mode!=='image';$('measure-figure').hidden=mode!=='image';
function readPoint(){const p=readStored()||initialPosition;return Math.max(0,Number(p?.point)||0)}
function persist(){
 const p=pages[index],v={schema:'standard-reader-position-v2',bookId,
   point:p?.start||0,scan:p?.scan||1,font,updatedAt:Date.now()};
 try{localStorage.setItem(key,JSON.stringify(v))}catch(_){}
 postHost('reader-position-v1',{position:v});
}
// Range client rectangles detect visual column ends that scrollHeight misses.
function fitsInk(el){
 if(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+1)return false;
 const bound=el.getBoundingClientRect(),cs=getComputedStyle(el);
 const bottom=bound.bottom-(parseFloat(cs.paddingBottom)||0);
 const top=bound.top+(parseFloat(cs.paddingTop)||0);
 const left=bound.left+(parseFloat(cs.paddingLeft)||0);
 const right=bound.right-(parseFloat(cs.paddingRight)||0);
 const range=document.createRange(),walker=document.createTreeWalker(el,NodeFilter.SHOW_TEXT);
 let node;
 while((node=walker.nextNode())){
  if(!node.nodeValue?.length)continue;
  range.selectNodeContents(node);
  for(const r of range.getClientRects()){
   if(r.width<=0||r.height<=0)continue;
   if(r.left<left-.5||r.right>right+.5||r.top<top-.5||r.bottom>bottom+.5)return false;
  }
 }
 return true;
}
function syncMeasure(){
 const r=sheet.getBoundingClientRect();
 if(r.width<80||r.height<80)throw Error('表示領域が小さすぎます');
 measureSheet.style.width=r.width+'px';measureSheet.style.height=r.height+'px';
}
function fit(el){return el.scrollWidth<=el.clientWidth+1&&el.scrollHeight<=el.clientHeight+1}
function partNode(p){
 const el=document.createElement(p.type==='heading'?'h2':'span');
 el.className=p.type==='heading'?'section-heading':('paragraph novel-paragraph '+(p.type==='dialogue'?'novel-dialogue':'novel-narration')+(p.continued?' continued':'')+(p.type!=='dialogue'&&p.text.startsWith('　')?' source-indented':''));
 el.textContent=p.text;return el;
}
function fitsParts(existing,additional){
 const fragment=document.createDocumentFragment();
 for(const p of existing)fragment.append(partNode(p));
 if(additional)fragment.append(partNode(additional));
 measureText.replaceChildren(fragment);return fitsInk(measureText);
}
function textPart(b,off,n){return {type:b.type,scan:b.scan,text:b.units.slice(off,off+n).join(''),continued:off>0}}
// G4-04: text-only visual page boundaries. The canonical source stream is untouched.
// Prefer end-of-sentence/clause; otherwise a safe word/phrase boundary;
// split a grapheme only as a recorded last resort. Neither source scan edges
// nor punctuation/word tests silently rewrite the underlying OCR text.
const g404WordSegmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('ja',{granularity:'word'}):null;
const g404WordCache=new WeakMap();
let g404Audit=[];
function g404WordEnds(b){
 if(g404WordCache.has(b))return g404WordCache.get(b);
 const result=new Set();
 if(g404WordSegmenter){
  let n=0;
  for(const item of g404WordSegmenter.segment(b.text)){
   n+=split(item.segment).length;
   if(item.isWordLike)result.add(n);
  }
 }
 g404WordCache.set(b,result);return result;
}
function protectedPageBoundary(units,point){
 if(point<=0||point>=units.length)return false;
 const a=units[point-1],z=units[point];
 const left=units.slice(Math.max(0,point-15),point).join('');
 const right=units.slice(point,Math.min(units.length,point+15)).join('');
 if('、。，．！？!?」』）)】〕〉》]'.includes(z))return true;
 if(/[「『（(【〔〈《]$/u.test(left))return true;
 if(/(?:いずれ|それぞれ|どちら)$/u.test(left)&&/^も/u.test(right))return true;
 if(/[0-9０-９]$/u.test(left)&&/^(?:年|月|日|時|分|秒|円|冊|個|頁|ページ|％|%|cm|kg|㎝|㎏|m|km|g|ml|L)/u.test(right))return true;
 if(/[0-9０-９Ａ-Ｚａ-ｚA-Za-z]$/u.test(a)&&/[0-9０-９Ａ-Ｚａ-ｚA-Za-z]/u.test(z))return true;
 // Intl Japanese word segmentation alone may split inflected verbs every
 // character (e.g. 撃|ち|抜|い|た). Treat Japanese-script joins conservatively.
 if(/[\p{Script=Han}]$/u.test(a)&&/^[\p{Script=Hiragana}]/u.test(z))return true;
 if(/[\p{Script=Hiragana}]$/u.test(a)&&/^[\p{Script=Hiragana}]/u.test(z))return true;
 if(/[\p{Script=Hiragana}]$/u.test(a)&&/^[\p{Script=Han}]/u.test(z))return true;
 if(/[\p{Script=Katakana}ーッャュョヮ]$/u.test(a)&&/^[\p{Script=Katakana}ーッャュョヮ]/u.test(z))return true;
 if(/[ぁぃぅぇぉゃゅょっァィゥェォャュョッー]$/u.test(a)&&/^[\p{Script=Hiragana}\p{Script=Katakana}ー]/u.test(z))return true;
 return false;
}
function g404BoundaryKind(b,point){
 const last=b.units[point-1]||'';
 if(/[。！？!?]/u.test(last))return 'sentence';
 if(/[、，；;：:]/u.test(last))return 'clause';
 if(g404WordEnds(b).has(point))return 'word';
 return 'grapheme';
}
function g404Select(b,off,fitCount,remaining,terminal){
 const units=b.units,originalEnd=off+fitCount;
 if(fitCount===remaining)return {count:fitCount,reason:'complete-block',balanced:false,exception:null};
 let limit=fitCount,balanced=false;
 // If the end of a complete scene would be a tiny standalone page, move
 // enough text from the preceding page to create a readable final page.
 // This is only attempted inside the same source block, never across an image
 // or a new chapter. A short standalone heading / story page is untouched.
 const tail=remaining-fitCount;
 const target=Math.max(18,Math.min(38,Math.ceil((measureText.clientHeight||450)/Math.max(16,font)*1.3)));
 if(terminal&&b.type!=='heading'&&b.type!=='toc'&&tail<target&&fitCount>target*1.6){
  const back=target-tail;
  limit=Math.max(1,fitCount-back);balanced=true;
 }
 const lower=Math.max(1,limit-Math.max(26,Math.min(44,Math.floor(limit*.22))));
 // A safe but very early word break must not create a one-column orphan page.
 const minRead=Math.min(limit,Math.max(9,Math.floor(limit*.58)));
 let chosen=null;
 for(const [kind,cap] of [['sentence',34],['clause',28],['word',18],['grapheme',15]]){
  const min=Math.max(lower,limit-cap);
  for(let n=limit;n>=min;n--){
   const point=off+n;
   if(point>=units.length||protectedPageBoundary(units,point))continue;
   if(g404BoundaryKind(b,point)!==kind)continue;
   chosen={count:n,reason:kind,balanced,exception:null};break;
  }
  if(chosen)break;
 }
 if(!chosen){
  for(let n=limit;n>=1;n--){
   if(!protectedPageBoundary(units,off+n)){
    chosen={count:n,reason:'safe-grapheme-fallback',balanced,exception:null};break;
   }
  }
 }
 if(!chosen){
  // If ICU and the conservative Japanese join guard disagree, a word-like
  // boundary before a new kanji/katakana unit is preferable to a dangling
  // closing quotation mark. We record that this is NOT verified morphology.
  const weak=g404WordEnds(b);
  for(let n=limit;n>=1;n--){
   const point=off+n,a=units[point-1]||'',z=units[point]||'';
   if(!z||'、。，．！？!?」』）)】〕〉》]'.includes(z)||'「『（(【〔〈《'.includes(a))continue;
   if(/[0-9０-９]$/u.test(a)&&/^[0-9０-９]/u.test(z))continue;
   if(weak.has(point)&&/^[\p{Script=Han}\p{Script=Katakana}A-Za-z]/u.test(z)){
    chosen={count:n,reason:'icu-word-heuristic',balanced,
     exception:'WORD_SEGMENT_NOT_SOURCE_VERIFIED'};break;
   }
  }
 }
 if(!chosen){
  for(let n=limit;n>=1;n--){
   const point=off+n,a=units[point-1]||'',z=units[point]||'';
   if(!z||'、。，．！？!?」』）)】〕〉》]'.includes(z)||'「『（(【〔〈《'.includes(a))continue;
   chosen={count:n,reason:'forced-grapheme',balanced,
    exception:'NO_SOURCE_VERIFIED_WORD_BOUNDARY_IN_AVAILABLE_SPACE'};break;
  }
 }
 if(!chosen){
  chosen={count:Math.max(1,limit),reason:'forced-unavoidable',balanced,
   exception:'PUNCTUATION_OR_SCRIPT_BOUNDARY_UNAVOIDABLE'};
 }
 g404Audit.push({scan:b.scan,at:off+chosen.count,reason:chosen.reason,
  balanced:chosen.balanced,exception:chosen.exception,
  before:units.slice(Math.max(0,off+chosen.count-20),off+chosen.count).join(''),
  after:units.slice(off+chosen.count,Math.min(units.length,off+chosen.count+20)).join('')});
 return chosen;
}
function paginateBlocks(group,start){
 const out=[];let current=[],at=start,begin=start;
 const flush=()=>{if(!current.length)return;
  out.push({kind:'text',parts:current,start:begin,end:at,scan:current[0].scan});
  current=[];begin=at;
 };
 for(let bi=0;bi<group.length;bi++){
  const b=group[bi],terminal=bi===group.length-1;
  let off=0;
  while(off<b.units.length){
   const remaining=b.units.length-off,whole=textPart(b,off,remaining);
   if(b.type==='toc'&&!fitsParts(current,whole)){
    if(current.length){flush();continue;}
    throw Error('目次項目が一列に収まりません：'+b.text);
   }
   if(fitsParts(current,whole)){current.push(whole);off+=remaining;at+=remaining;continue;}
   let lo=0,hi=remaining;
   while(lo<hi){const mid=Math.ceil((lo+hi)/2);
    if(fitsParts(current,textPart(b,off,mid)))lo=mid;else hi=mid-1;
   }
   if(lo===0){if(current.length){flush();continue;}
    throw Error('文字サイズに対して本文領域が不足しています');
   }
   // The new short paragraph may fit by itself. Do not manufacture a final
   // five-character page merely because it cannot fit beside prior blocks.
   if(off===0&&current.length&&fitsParts([],whole)){
    flush();continue;
   }
   const selected=g404Select(b,off,lo,remaining,terminal);
   const count=selected.count;
   current.push(textPart(b,off,count));off+=count;at+=count;flush();
  }
 }
 flush();return g404RebalanceShort(out);
}
// Rebalance only an accidental orphan reading page inside the SAME flow group.
// Never join across an explicit chapter/figure break or modify source text.
function g404RebalanceShort(out){
 const pageChars=p=>p.parts.reduce((n,x)=>n+split(x.text).length,0);
 const minimum=16;
 for(let i=0;i<out.length;i++){
  const page=out[i];
  if(pageChars(page)>=minimum||page.parts.some(x=>x.type==='heading'||x.type==='toc'))continue;
  const next=out[i+1],prev=out[i-1];
  if(next&&next.parts?.length&&next.parts.every(x=>x.type!=='toc'&&x.type!=='heading')){
   if(fitsParts(page.parts.concat(next.parts),null)){
    page.parts.push(...next.parts);page.end=next.end;
    out.splice(i+1,1);i--;continue;
   }
   const part=next.parts[0],units=split(part.text);
   if(units.length>1){
    let lo=0,hi=next.parts.length>1?units.length:units.length-1;
    while(lo<hi){const mid=Math.ceil((lo+hi)/2);
     if(fitsParts(page.parts,{...part,text:units.slice(0,mid).join('')}))lo=mid;
     else hi=mid-1;
    }
    // Source-safe portion: avoid moving just an opening quote or creating
    // a broken Japanese word at the new boundary.
    let take=Math.min(lo,Math.max(0,Math.min(48,minimum+12-pageChars(page))));
    while(take>0&&protectedPageBoundary(units,take))take--;
    if(take>0&&pageChars(page)+take>=minimum){
     const moved={...part,text:units.slice(0,take).join('')};
     page.parts.push(moved);page.end+=take;
     if(take===units.length)next.parts.shift();
     else next.parts[0]={...part,text:units.slice(take).join(''),continued:true};
     next.start+=take;
     g404Audit.push({scan:page.scan,reason:'short-page-forward-rebalanced',moved:take,exception:null});
     continue;
    }
   }
  }
  // A final few characters may belong to the previous continued paragraph.
  // Rebalance that paragraph without changing the reading order or merging
  // chapter/figure breaks (out contains one contiguous flow group only).
  if(prev&&page.parts.length&&prev.parts.length&&page.parts[0].continued){
   const a=prev.parts.at(-1),b=page.parts[0];
   if(a.type===b.type&&a.scan===b.scan&&a.text.length>minimum*2){
    const units=split(a.text),need=Math.min(44,Math.max(0,minimum+12-pageChars(page)));
    let take=Math.min(need,units.length-1);
    while(take>0&&protectedPageBoundary(units,units.length-take))take--;
    if(take>0){
     const keep={...a,text:units.slice(0,-take).join('')};
     const leading={...b,text:units.slice(-take).join('')+b.text,continued:true};
     if(fitsParts([leading,...page.parts.slice(1)],null)){
      prev.parts[prev.parts.length-1]=keep;prev.end-=take;
      page.parts[0]=leading;page.start-=take;
      g404Audit.push({scan:page.scan,reason:'short-page-backward-rebalanced',moved:take,exception:null});
     }
    }
   }
  }
 }
 return out;
}
function captionFits(value){measureCaption.textContent=value;return fitsInk(measureCaption)}
function paginateOneFigure(i,start){
 const f=figures[i],out=[];let at=start;
 $('measure-caption-label').textContent=f.title;
 if(!f.units.length)return [{kind:'image',figure:i,caption:'',start,end:start+1,subpage:1,scan:f.scan}];
 let off=0,count=0;
 while(off<f.units.length){
  const remain=f.units.length-off;let lo=0,hi=remain;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);
   if(captionFits(f.units.slice(off,off+mid).join('')))lo=mid;else hi=mid-1;
  }
  if(lo===0)throw Error('図版の説明文を表示する領域が不足しています');
  count++;out.push({kind:'image',figure:i,caption:f.units.slice(off,off+lo).join(''),
   start:at,end:at+lo,subpage:count,scan:f.scan});
  at+=lo;off+=lo;
 }
 return out;
}
function paginateAll(){
 g404Audit=[];
 const out=[];let at=0,pending=[];
 const flush=()=>{
  if(!pending.length)return;
  measureText.hidden=false;$('measure-figure').hidden=true;
  const part=paginateBlocks(pending,at);out.push(...part);
  if(part.length)at=part[part.length-1].end;
  pending=[];
 };
 for(const item of flow){
  if(item.kind==='text'){pending.push(blocks[item.block]);continue}
  flush();measureText.hidden=true;$('measure-figure').hidden=false;
  const part=paginateOneFigure(item.figure,at);out.push(...part);
  if(part.length)at=part[part.length-1].end;
 }
 flush();return out;
}
function pageAt(point){
 let result=0;
 for(let i=0;i<pages.length;i++)if(pages[i].start<=point)result=i;else break;
 return result;
}
function currentSource(){
 const p=pages[index];if(!p)return null;
 if(p.kind==='image')return figures[p.figure]?.ownedURL||figures[p.figure]?.source||null;
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
 const isText=p.kind==='text';textFlow.hidden=!isText;$('figure-stage').hidden=isText;
 if(isText){
  const frag=document.createDocumentFragment();
  for(const part of p.parts)frag.append(partNode(part));
  textFlow.replaceChildren(frag);
 }else setFigure(p);
 $('page-major').textContent=(index+1)+' / '+pages.length;
 const total=Number(book.totalScans)||1;
 $('page-minor').textContent=isText?('原本 '+p.scan+' / '+total):
  ('原本 '+figures[p.figure].scan+' / '+total+' ｜ 図版 '+(p.figure+1)+' / '+figures.length+' ｜ 説明 '+p.subpage);
 $('progress-fill').style.width=(100*(index+1)/pages.length).toFixed(2)+'%';
 $('prev').disabled=index===0;$('next').disabled=index>=pages.length-1;
 $('original').disabled=!currentSource();persist();
}
function gotoPage(n){if(!pages.length)return;const k=Math.max(0,Math.min(n,pages.length-1));if(k!==index){index=k;render()}}
function menuRefresh(){
 const list=$('menu-items');list.replaceChildren();
 if(mode==='image'){
  figures.forEach((f,i)=>{
   const btn=document.createElement('button');btn.type='button';btn.className='menu-item';
   btn.textContent=(i+1)+'．'+f.title;
   btn.addEventListener('click',()=>{gotoPage(pages.findIndex(p=>p.figure===i));closeDialogs()});list.append(btn);
  });
 }else if(mode==='text'){
  let offset=0;
  blocks.forEach(b=>{if(b.type==='heading'){
   const target=offset,btn=document.createElement('button');btn.type='button';
   btn.className='menu-item';btn.textContent=b.text;
   btn.addEventListener('click',()=>{gotoPage(pageAt(target));closeDialogs()});list.append(btn);
  }offset+=b.units.length});
 }else{
  const seen=new Set();pages.forEach((p,i)=>{
   if(seen.has(p.scan))return;seen.add(p.scan);
   const btn=document.createElement('button');btn.type='button';btn.className='menu-item';
   btn.textContent='原本 '+p.scan+(p.kind==='image'?'・画像':'・本文');
   btn.addEventListener('click',()=>{gotoPage(i);closeDialogs()});list.append(btn);
  });
 }
}
function rebuild(){
 try{
  const point=pages[index]?.start??readPoint();
  syncMeasure();
  pages=paginateAll();
  index=pageAt(point);warning='';render();menuRefresh();
 }catch(e){
  warning=String(e?.message||e);$('shelf-status').textContent='組版要確認';
  $('page-minor').textContent=warning;console.error('Reader layout:',e);
 }
}
function zoomed(){return (embedded&&!hostKnown)||Math.max(Number(window.visualViewport?.scale||1),hostScale)>1.04}
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
function reflectZoom(){document.body.classList.toggle('zoomed',zoomed());if(zoomed())touch=null;}
main.addEventListener('touchstart',e=>{
 if(e.touches.length!==1||zoomed()){touch=null;return}
 const t=e.touches[0];touch={x:t.clientX,y:t.clientY};
},{passive:true});
main.addEventListener('touchmove',e=>{if(e.touches.length!==1)touch=null},{passive:true});
main.addEventListener('touchend',e=>{
 if(!touch||zoomed()||e.changedTouches.length!==1){touch=null;return}
 const t=e.changedTouches[0],dy=t.clientY-touch.y,dx=t.clientX-touch.x;touch=null;
 if(Math.abs(dy)>45&&Math.abs(dy)>1.3*Math.abs(dx)){
  // Each completed touch sequence advances exactly one reading page.
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
document.querySelector('.shelf-link')?.addEventListener('click',e=>{
 if(embedded&&host?.session){e.preventDefault();postHost('reader-back-to-shelf-v1')}
});
window.addEventListener('pagehide',()=>{
 persist();if(sourceURL)URL.revokeObjectURL(sourceURL);
 figures.forEach(f=>{if(f.ownedURL)URL.revokeObjectURL(f.ownedURL)});
});
$('smaller').disabled=font<=16;$('larger').disabled=font>=30;
window.NovelReader=Object.freeze({version:'novel-v1',kind:mode,bookId,inspect:()=>({
 pages:pages.length,index,font,warning,originalReady:!!currentSource(),
 zoomed:zoomed(),hostKnown,hostScale,
 currentKind:pages[index]?.kind,scan:pages[index]?.scan,
 textIntegrity:pages.filter(p=>p.kind==='text').flatMap(p=>p.parts.map(x=>x.text)).join('')===
  blocks.map(b=>b.text).join(''),
 dialogueCount:blocks.filter(b=>b.type==='dialogue').length,
 dialogueStartIntegrity:blocks.filter(b=>b.type==='dialogue').every(b=>b.text.startsWith('「')||!b.text.includes('「')),
 novelSourceIntegrity:mode!=='text'||blocks.map(b=>b.text).join('')===sourceBlocks.map(b=>b.text||'').join('')
}),boundaryAudit:()=>g404Audit.slice(),pageManifest:()=>pages.map(p=>({kind:p.kind,scan:p.scan,start:p.start,end:p.end,figure:p.figure})),
 gotoPage:n=>gotoPage(n)});
reflectZoom();requestAnimationFrame(rebuild);
if(embedded){postHost('reader-ready-v8');window.addEventListener('pageshow',()=>postHost('reader-ready-v8'));}
})();