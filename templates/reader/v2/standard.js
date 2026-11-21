/* WH1-based standard reader v2 — shared text, original-image and mixed-page engine.
   Public template code only: never embed a user's private original or OCR. */
(()=>{'use strict';
const book=window.READER_BOOK;
if(!book||!['text','image','mixed'].includes(book.kind))throw Error('READER_BOOK.kind は text / image / mixed のいずれかが必要です');
const $=id=>document.getElementById(id);
const required=['sheet','measure-sheet','text-flow','measure-text','figure-stage','measure-figure',
'figure-image','figure-placeholder','figure-caption','measure-caption','figure-caption-label',
'measure-caption-label','original','first','all','smaller','larger','current-size',
'prev','next','page-major','page-minor','progress-fill','book-title','shelf-status',
'menu-backdrop','menu-items','menu-close','original-backdrop','original-close','original-image'];
for(const id of required)if(!$(id))throw Error('必要な表示要素がありません: '+id);
const mode=book.kind,bookId=String(book.id||'standard-'+mode),key='standard-reader-v2:'+bookId;
const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('ja',{granularity:'grapheme'}):null;
const split=x=>segmenter?Array.from(segmenter.segment(String(x||'')),v=>v.segment):Array.from(String(x||''));
// Source roles are distinct from the visual type: notes and TOC entries render
// with the old body styling but are NEVER eligible to join narrative prose.
const sourceKind=b=>b.type==='heading'?'heading':
 b.type==='toc'?'toc':
 (b.type==='note'||b.type==='footnote'||b.type==='caption')?'note':'body';
let blocks=(Array.isArray(book.blocks)?book.blocks:[]).filter(b=>b&&typeof b.text==='string'&&b.text.length)
 .map((b,i)=>({type:b.type==='heading'?'heading':'body',semanticType:sourceKind(b),
   text:b.text,scan:Number(b.scan)||1,units:split(b.text),
   sourceBlock:i,sourceJoined:b.joinPrevious===true,continuesHeading:b.continuesHeading===true}));
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
   for(const b of group){
    if(!b||typeof b.text!=='string'||!b.text.length)continue;
    const scan=Number(b.scan||entry.scan);
    if(!Number.isInteger(scan)||scan<1)throw Error('本文の原本番号が不正です');
    blocks.push({type:b.type==='heading'?'heading':'body',semanticType:sourceKind(b),
      text:b.text,scan,units:split(b.text),sourceBlock:blocks.length,
      sourceJoined:b.joinPrevious===true,continuesHeading:b.continuesHeading===true});
    flow.push({kind:'text',block:blocks.length-1});
   }
  }else if(entry?.kind==='image'){
   const scan=Number(entry.scan);
   if(!Number.isInteger(scan)||scan<1)throw Error('画像の原本番号が不正です');
   const f={id:String(entry.id||'figure-'+(figures.length+1)),
     title:String(entry.title||'原本 '+scan),alt:String(entry.alt||entry.title||'原本画像'),
     scan,source:entry.src||null,caption:String(entry.caption||''),
     units:split(entry.caption||''),ownedURL:null};
   figures.push(f);flow.push({kind:'image',figure:figures.length-1,
     // Explicitly source-reviewed figure may follow a continued paragraph.
     deferUntilContinuation:entry.deferUntilContinuation===true});
  }else if(entry?.kind==='break'){
   // A logical paragraph boundary with no printed content.
   flow.push({kind:'break'});
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
// BEGIN reader vertical symbols
const verticalReaderSymbols=(()=>{
 // UAX #50 mixed layout supplies native vertical glyphs for the rest of the text.
 const upright=/[!?！？‼⁇⁈⁉‽¡¿#＃%％‰‱&＆@＠*＊※〒§¶†‡©®™℗°℃℉№／/\\＼\u2190-\u21ff\u25a0-\u25ff\u2605\u2606\u27f0-\u27ff\u2900-\u297f\ufe10-\ufe19\ufe30-\ufe48]|\p{Sc}|\p{Sm}/gu;
 const wave=new Set(['~','～','〜','∼']);
 const attaches=/^[\p{M}\u200c\u200d\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]/u;
 const isSymbol=/[\p{P}\p{S}ーｰ]/u;
 // The reading edition uses one fullwidth upright question mark for each source question.
 function displayText(source){
  return source.replaceAll('?','？');
 }
 function* uprightRanges(text){
  for(const match of text.matchAll(upright)){
   const start=match.index, end=start+match[0].length;
   // Keep keycaps, variation sequences, combining marks and ZWJ emoji intact.
   if(wave.has(match[0])||text[start-1]==='\u200d'||attaches.test(text.slice(end,end+2)))continue;
   yield {start,end};
  }
 }
 function count(text){
  const counts={upright:0,native:0};
  for(const character of text)if(isSymbol.test(character))counts.native++;
  for(const range of uprightRanges(text)){counts.upright++;counts.native--;}
  return counts;
 }
 // Run against a visible vertical text flow or its measurement copy.
 function inspect(flow){
  const doc=flow.ownerDocument, view=doc.defaultView;
  const walker=doc.createTreeWalker(flow,4);
  const result={upright:0,native:0,halfwidthQuestions:0,fullwidthQuestions:0,mismatches:0,examples:[]};
  let node;
  while((node=walker.nextNode())){
   const parent=node.parentElement, style=view.getComputedStyle(parent);
   if(!isSymbol.test(node.data)||style.textCombineUpright==='all')continue;
   if(style.writingMode==='horizontal-tb'&&parent.closest('[data-horizontal],.figure-caption,rt'))continue;
   const starts=new Set(Array.from(uprightRanges(node.data),r=>r.start));
   let offset=0;
   for(const ch of node.data){
    if(isSymbol.test(ch)){
     const kind=starts.has(offset)?'upright':'native';
     const expected=kind==='upright'?'upright':'mixed';
     result[kind]++;
     if(ch==='?')result.halfwidthQuestions++;
     if(ch==='？')result.fullwidthQuestions++;
     if(ch==='?'||!style.writingMode.startsWith('vertical')||style.textOrientation!==expected){
      result.mismatches++;
      if(result.examples.length<12)result.examples.push({codePoint:ch.codePointAt(0),expectedCharacter:ch==='?'?'？':ch,expected,actual:style.textOrientation,writingMode:style.writingMode});
     }
    }
    offset+=ch.length;
   }
  }
  return result;
 }
 return {displayText,uprightRanges,count,inspect};
})();
function setVerticalText(element,source){
 const text=verticalReaderSymbols.displayText(source);
 let fragment=null,offset=0;
 for(const {start,end} of verticalReaderSymbols.uprightRanges(text)){
  if(!fragment)fragment=document.createDocumentFragment();
  if(start>offset)fragment.append(document.createTextNode(text.slice(offset,start)));
  const mark=document.createElement('span');
  mark.style.textOrientation='upright';
  mark.textContent=text.slice(start,end);
  fragment.append(mark);
  offset=end;
 }
 if(!fragment){element.textContent=text;return;}
 if(offset<text.length)fragment.append(document.createTextNode(text.slice(offset)));
 element.replaceChildren(fragment);
}
if(typeof window==='object')window.ReaderVerticalSymbols=verticalReaderSymbols;
// END reader vertical symbols
function partNode(p){
 const el=document.createElement(p.type==='heading'?'h2':'span');
 el.className=p.type==='heading'?'section-heading':('paragraph'+(p.continued?' continued':''));
 setVerticalText(el,p.text);return el;
}
function fitsParts(existing,additional){
 const fragment=document.createDocumentFragment();
 for(const p of existing)fragment.append(partNode(p));
 if(additional)fragment.append(partNode(additional));
 measureText.replaceChildren(fragment);return fitsInk(measureText);
}
// G4-02 / G4-04: source-scan pages are not forced reader-page boundaries.
// Only source-verified joinPrevious:true on a following BODY may join with a
// prior BODY in an uninterrupted logical text run. Never infer this from scan
// numbers, and never silently accept a blocked explicit continuation.
function joinLogicalContinuations(source){
 const logical=[];
 for(const b of source){
  const prior=logical[logical.length-1];
  if(b.sourceJoined){
   if(!prior||b.semanticType!=='body'||prior.semanticType!=='body')
    throw Error('G402_SOURCE_CONTINUATION_BARRIER scan='+b.scan);
   const start=prior.units.length;
   prior.text+=b.text;
   prior.units.push(...b.units);
   prior.sourceRanges.push({start,end:prior.units.length,scan:b.scan,sourceBlock:b.sourceBlock});
  }else{
   logical.push({...b,units:b.units.slice(),
    sourceRanges:[{start:0,end:b.units.length,scan:b.scan,sourceBlock:b.sourceBlock}]});
  }
 }
 return logical;
}
function textPart(b,off,n){
 const first=b.sourceRanges?.find(r=>r.end>off);
 return {type:b.type,scan:first?.scan||b.scan,text:b.units.slice(off,off+n).join(''),
  continued:off>0,
  // Offsets are grapheme indices within the ORIGINAL registered source block.
  sourceSpans:(b.sourceRanges||[]).filter(r=>r.end>off&&r.start<off+n).map(r=>({
   scan:r.scan,sourceBlock:r.sourceBlock,
   sourceStart:Math.max(0,off-r.start),sourceEnd:Math.min(r.end,off+n)-r.start
  }))};
}
function protectedPageBoundary(units,point,checkWord=true){
 if(point<=0||point>=units.length)return false;
 const left=units.slice(Math.max(0,point-14),point).join('');
 const right=units.slice(point,Math.min(units.length,point+14)).join('');
 if(/^(?:、|。|！|？|!|\?|」|』|）|\))/.test(right))return true;
 if(/(?:「|『|（|\()$/.test(left))return true;
 if(/(?:いずれ|それぞれ|どちら)$/.test(left)&&/^も/.test(right))return true;
 if(/[0-9０-９]$/.test(left)&&/^(?:年|月|日|時|分|秒|円|冊|個|頁|ページ|％|%|cm|kg|㎝|㎏)/.test(right))return true;
 return checkWord&&!wordBoundary(units,point);
}
function wordBoundary(units,point){
 // Keep the tokenizer's context across page turns. Its offsets use UTF-16, whereas
 // source spans and page measurements count graphemes.
 const l=units[point-1],r=units[point],katakana=/[\p{Script=Katakana}ー]/u,latin=/[\p{Script=Latin}\p{Number}]/u;
 if(katakana.test(l)&&katakana.test(r)||katakana.test(l)&&r==='・'||l==='・'&&katakana.test(r)||latin.test(l)&&latin.test(r))return false;
 if(/^[-‐‑’']$/u.test(r)&&latin.test(l)&&latin.test(units[point+1]||'')||
    /^[-‐‑’']$/u.test(l)&&latin.test(r)&&latin.test(units[point-2]||''))return false;
 if(typeof Intl.Segmenter!=='function')return true;
 const cache=wordBoundary.cache||(wordBoundary.cache=new WeakMap());
 let ends=cache.get(units);
 if(!ends){
  const tokenizer=wordBoundary.tokenizer||(wordBoundary.tokenizer=new Intl.Segmenter('ja',{granularity:'word'}));
  const offsets=new Set();for(const part of tokenizer.segment(units.join('')))offsets.add(part.index+part.segment.length);
  ends=new Set();let offset=0;
  units.forEach((unit,i)=>{offset+=unit.length;if(offsets.has(offset))ends.add(i+1);});
  cache.set(units,ends);
 }
 return ends.has(point);
}
function paginateBlocks(group,start){
 group=joinLogicalContinuations(group);
 const out=[];let current=[],at=start,begin=start;
 const flush=()=>{if(!current.length)return;
  out.push({kind:'text',parts:current,start:begin,end:at,scan:current[0].scan});
  current=[];begin=at;
 };
 for(const b of group){
  // Only registered lines of the same heading can follow a heading on this page.
  if(b.type==='heading'&&!(b.continuesHeading&&current.at(-1)?.type==='heading'))flush();
  let off=0;
  while(off<b.units.length){
   const remaining=b.units.length-off,whole=textPart(b,off,remaining);
   if(fitsParts(current,whole)){current.push(whole);off+=remaining;at+=remaining;continue}
   let lo=0,hi=remaining;
   while(lo<hi){const mid=Math.ceil((lo+hi)/2);
    if(fitsParts(current,textPart(b,off,mid)))lo=mid;else hi=mid-1;
   }
   if(lo===0){if(current.length){flush();continue}
    throw Error('文字サイズに対して本文領域が不足しています');
   }
   // Do not split a single Japanese grapheme. Prefer an in-range punctuation
   // boundary; this is not a substitute for original-source G4-04 review.
   if(lo<remaining){
    const maximum=lo,min=Math.max(1,lo-8);
    for(let n=lo;n>=min;n--){
     if(/[。！？!?、」』）)]/.test(b.units[off+n-1]||'')&&
        !protectedPageBoundary(b.units,off+n)&&
        fitsParts(current,textPart(b,off,n))){lo=n;break}
    }
    // Preserve known source-side Japanese compounds and number+unit pairs
    // by carrying the entire unit to the next page whenever it still fits.
    while(lo>0&&protectedPageBoundary(b.units,off+lo))lo--;
    if(lo===0&&current.length){flush();continue;}
    // An exceptionally long token may itself exceed an empty screen.
    if(lo===0&&!current.length){
     lo=maximum;while(lo>0&&protectedPageBoundary(b.units,off+lo,false))lo--;
    }
    if(lo===0||protectedPageBoundary(b.units,off+lo,false))
     throw Error('句読点・単位を安全に組版できません。原本と画面寸法を確認してください');
   }
   current.push(textPart(b,off,lo));off+=lo;at+=lo;flush();
  }
 }
 flush();return out;
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
 const out=[];let at=0,pending=[],deferredFigures=[],joinedAfterDeferred=false;
 const flush=()=>{
  if(!pending.length)return;
  measureText.hidden=false;$('measure-figure').hidden=true;
  const part=paginateBlocks(pending,at);out.push(...part);
  if(part.length)at=part[part.length-1].end;
  pending=[];
 };
 const emitFigure=item=>{
  measureText.hidden=true;$('measure-figure').hidden=false;
  const part=paginateOneFigure(item.figure,at);out.push(...part);
  if(part.length)at=part[part.length-1].end;
 };
 // A source-reviewed figure that physically interrupts an unfinished
 // sentence is retained, but displayed AFTER its next logical paragraph.
 // Without an explicit confirmed continuation this is an error, not a
 // silently omitted image or a broken continuation.
 const releaseDeferred=()=>{
  if(!deferredFigures.length)return;
  if(!joinedAfterDeferred)throw Error('G402_DEFERRED_IMAGE_WITHOUT_CONTINUATION');
  flush();
  for(const item of deferredFigures)emitFigure(item);
  deferredFigures=[];joinedAfterDeferred=false;
 };
 for(const item of flow){
  if(item.kind==='text'){
   const b=blocks[item.block];
   if(deferredFigures.length){
    if(b.sourceJoined&&b.semanticType==='body')joinedAfterDeferred=true;
    else releaseDeferred();
   }
   pending.push(b);continue;
  }
  if(item.kind==='image'&&item.deferUntilContinuation){
   if(!pending.length||pending[pending.length-1].semanticType!=='body')
    throw Error('G402_DEFERRED_IMAGE_NO_PRECEDING_PROSE');
   deferredFigures.push(item);continue;
  }
  releaseDeferred();flush();
  if(item.kind==='break')continue;
  emitFigure(item);
 }
 releaseDeferred();flush();return out;
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
window.StandardReader=Object.freeze({version:'v2',kind:mode,bookId,inspect:()=>({
 pages:pages.length,index,font,warning,originalReady:!!currentSource(),
 zoomed:zoomed(),hostKnown,hostScale,
 currentKind:pages[index]?.kind,scan:pages[index]?.scan,
 textIntegrity:pages.filter(p=>p.kind==='text').flatMap(p=>p.parts.map(x=>x.text)).join('')===
  blocks.map(b=>b.text).join('')
}),pageManifest:()=>pages.map(p=>({kind:p.kind,scan:p.scan,start:p.start,end:p.end,figure:p.figure,
  sourceSpans:p.kind==='text'?p.parts.flatMap(x=>x.sourceSpans||[]):[]})),
 gotoPage:n=>gotoPage(n)});
reflectZoom();requestAnimationFrame(rebuild);
if(embedded){postHost('reader-ready-v8');window.addEventListener('pageshow',()=>postHost('reader-ready-v8'));}
})();