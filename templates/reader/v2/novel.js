
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
 .map(b=>({type:b.type==='heading'?'heading':b.type==='dialogue'?'dialogue':'body',
   text:b.text,scan:b.scan,units:split(b.text),
   id:sourceBlocks[b.sourceBlockIndex]?.id,sourceHeadingId:sourceBlocks[b.sourceBlockIndex]?.sourceHeadingId||sourceBlocks[b.sourceBlockIndex]?.source_heading_id,
   // Only the first visual segment of an explicitly marked source continuation joins.
   sourceJoined:b.sourceStart===0&&!!sourceBlocks[b.sourceBlockIndex]?.joinPrevious&&b.type!=='dialogue'}));
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
   const segments=group.filter(b=>b&&typeof b.text==='string').flatMap(b=>{
    const scan=Number(b.scan||entry.scan);
    // TOC rows are atomic and must never be merged into narration.
    if(b.type==='toc')return [{...b,type:'toc',scan,sourceJoined:false}];
    return window.NovelDialogue.expandBlocks([{...b,scan}]).map(segment=>({
     ...segment,id:b.id,sourceHeadingId:b.sourceHeadingId||b.source_heading_id,sourceJoined:segment.sourceStart===0&&!!b.joinPrevious&&segment.type!=='dialogue'
    }));
   });
   for(const b of segments){
    if(!b.text.length)continue;
    const scan=Number(b.scan);
    if(!Number.isInteger(scan)||scan<1)throw Error('本文の原本番号が不正です');
    blocks.push({type:b.type==='heading'?'heading':b.type==='dialogue'?'dialogue':b.type==='toc'?'toc':'body',
     text:b.text,scan,units:split(b.text),id:b.id,sourceHeadingId:b.sourceHeadingId||b.source_heading_id,sourceJoined:!!b.sourceJoined});
    flow.push({kind:'text',block:blocks.length-1});
   }
  }else if(entry?.kind==='break'){
   // An explicit narrative break cannot be joined across.
   flow.push({kind:'break'});
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
blocks.forEach((b,i)=>{if(!b.id)b.id='scan-'+b.scan+'-block-'+i;});
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
 if(!shownPage)return;
 const p=shownPage,v={schema:'standard-reader-position-v2',bookId,
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
function standaloneDigitAt(text,index){
 if(!/^[0-9]$/.test(text[index]||''))return false;
 const previous=text[index-1]||'',next=text[index+1]||'';
 const identifier=/[\p{Script=Latin}\p{Nd}_＿]/u;
 if(identifier.test(previous)||identifier.test(next))return false;
 if(previous==='\u200d'||/^[\p{M}\u200c\u200d]/u.test(text.slice(index+1,index+3)))return false;
 // Keep decimals, grouped numbers, ratios, ranges and hyphenated identifiers in their original run.
 const joiner=/[.,:/~‐‑‒–—−－〜～：／，．-]/u;
 if(/[.．]/u.test(previous))return false;
 if(joiner.test(previous)&&identifier.test(text[index-2]||''))return false;
 if(joiner.test(next)&&identifier.test(text[index+2]||''))return false;
 return true;
}
const verticalReaderEdges=new WeakMap();
const verticalReaderSymbols=(()=>{
 // UAX #50 mixed layout supplies native vertical glyphs for the rest of the text.
 const upright=/[0-9!?！？‼⁇⁈⁉‽¡¿#＃%％‰‱&＆@＠*＊※〒§¶†‡©®™℗°℃℉№／/\\＼\u2190-\u21ff\u25a0-\u25ff\u2605\u2606\u27f0-\u27ff\u2900-\u297f\ufe10-\ufe19\ufe30-\ufe48]|\p{Sc}|\p{Sm}/gu;
 const wave=new Set(['~','～','〜','∼']);
 const attaches=/^[\p{M}\u200c\u200d\u{1f3fb}-\u{1f3ff}\u{e0020}-\u{e007f}]/u;
 const isSymbol=/[0-9\p{P}\p{S}ーｰ]/u;
 const japanese=/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆ー]/u;
 const digit=/\p{Nd}/u;
 const latin=/\p{Script=Latin}/u;
 // Protect address components (including separators in query strings) as one token.
 // Japanese prose can follow a URL without a space; its final punctuation is outside the address.
 const address=/(?:https?:\/\/|ftp:\/\/|www\.)[A-Z0-9%._~:/?@!$&'*+,;=#()-]+|[A-Z0-9_%+.-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
 function japanesePunctuation(source){
  if(!/[,，.．]/u.test(source)||!japanese.test(source))return source;
  if(/^[\s　]*(?:学名|英名)[\s　:：]*[\p{Script=Latin}][^\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]*$/u.test(source))return source;
  const addresses=Array.from(source.matchAll(address),m=>[m.index,m.index+m[0].replace(/[.,]+$/u,'').length]);
  let addressIndex=0;
  return source.replace(/[,，.．]/gu,(mark,at)=>{
   while(addressIndex<addresses.length&&addresses[addressIndex][1]<=at)addressIndex++;
   if(addressIndex<addresses.length&&addresses[addressIndex][0]<=at)return mark;
   const period=mark==='.'||mark==='．';
   const left=source.slice(Math.max(0,at-96),at),right=source.slice(at+1,at+97);
   const last=left.slice(-1),next=right[0]||'';
   // Decimal numbers, grouped numbers, numbered page lists and decimal fractions such as ".5".
   if(digit.test(last)&&digit.test(right.trimStart()[0]||''))return mark;
   if(period&&digit.test(next)&&(!last||/[\s(（=＝+＋−-]/u.test(last)))return mark;
   if(period){
    if(/^\p{Nd}+[%％]/u.test(right))return mark;
    if(/^(?:csv|tsv|txt|html?|pdf|epub|json|xml|jpe?g|png|gif|svg|webp|zip|xlsx?|docx?|pptx?)(?![\p{Script=Latin}\p{Nd}_])/iu.test(right))return mark;
    if(/[.．]/u.test(last)||/[.．]/u.test(next))return mark;
    // Printed section numbering, e.g. "2. 観察", keeps its identifying separator.
    if(/(?:^|\n)[\t 　]*\p{Nd}{1,4}$/u.test(source.slice(0,at)))return mark;
    // Page references, taxonomic ranks and author abbreviations, including a final dotted initial.
    if(/(?:^|[^\p{Script=Latin}])(?:pp?|vol|no|fig|etc|cf|ca|spp?|subsp|ssp|var|f|sect|gen|syn|approx|dr|mr|mrs|ms|prof|vs|al|thunb|linn|franch|cav|lam|sieb|zucc|maxim|benth|wall|dc|ait)$/iu.test(left))return mark;
    if(/(?:^|[^\p{Script=Latin}])(?:L|R[.．]\s*Br)$/u.test(left))return mark;
    if(/(?:\p{Script=Latin}[.．])+\p{Script=Latin}$/u.test(left))return mark;
    if(/(?:^|[^\p{Script=Latin}])[A-ZＡ-Ｚ]$/u.test(left)&&latin.test(right.trimStart()[0]||''))return mark;
   }
   const prev=left.replace(/[\s」』）)］\]】〉》”’]+$/u,'').slice(-1);
   const following=right.replace(/^[\s「『（(［\[【〈《“‘]+/u,'')[0]||'';
   if(japanese.test(prev)||japanese.test(following))return period?'。':'、';
   if(addresses[addressIndex]?.[0]===at+1&&japanese.test(left))return period?'。':'、';
   if(latin.test(prev)&&latin.test(following))return mark;
   // A Japanese clause may end with a quoted term, a measurement or a numeral.
   // A nearby Japanese character behind the final token distinguishes this from English prose.
   const tail=left.replace(/[\s」』）)］\]】〉》”’]+$/u,'');
   if(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}々〆ー][\t 　]*[\p{Nd}\p{Script=Latin}%％℃°µμ㎜㎝㎞㎡㎥～〜~./．-]+(?:[\t 　]+(?:mm|cm|km|m|kg|mg|g|ml|l|ha|Hz|°C))?$/iu.test(tail))return period?'。':'、';
   if(japanese.test(left)&&/[」』）)］\]】〉》]$/u.test(left.trimEnd()))return period?'。':'、';
   if(japanese.test(left)&&/\p{Nd}(?:[.,，．][\t 　]*\p{Nd}+)*[\t 　]*(?:mm|cm|km|m|kg|mg|g|ml|ha|%|％|℃)?$/iu.test(left)&&!latin.test(following))return period?'。':'、';
   return mark;
  });
 }
 function displayText(source){
  return japanesePunctuation(source).replaceAll('?','？');
 }
 function* uprightRanges(text,before='',after=''){
  const context=before+text+after;
  for(const match of text.matchAll(upright)){
   const start=match.index, end=start+match[0].length;
   if(/[0-9]/.test(match[0])&&!standaloneDigitAt(context,before.length+start))continue;
   // Keep keycaps, variation sequences, combining marks and ZWJ emoji intact.
   if(wave.has(match[0])||text[start-1]==='\u200d'||attaches.test(text.slice(end,end+2)))continue;
   yield {start,end};
  }
 }
 function count(text){
  const counts={upright:0,native:0};
  // These are source symbol counts. A digit's orientation depends on joined paragraphs.
  for(const ch of text)if(isSymbol.test(ch)&&!/[0-9]/.test(ch))counts.native++;
  for(const range of uprightRanges(text)){
   if(/[0-9]/.test(text[range.start]))continue;
   counts.upright++;counts.native--;
  }
  return counts;
 }
 // Run against a visible vertical text flow or its measurement copy.
 function inspect(flow){
  const doc=flow.ownerDocument, view=doc.defaultView;
  const walker=doc.createTreeWalker(flow,4);
  const result={upright:0,native:0,uprightDigits:0,halfwidthQuestions:0,fullwidthQuestions:0,mismatches:0,examples:[]};
  let node;
  while((node=walker.nextNode())){
   const parent=node.parentElement, style=view.getComputedStyle(parent);
   const combined=style.textCombineUpright==='all'||style.webkitTextCombine==='horizontal';
   if(!isSymbol.test(node.data)||(combined&&!/[0-9]/.test(node.data)))continue;
   if(style.writingMode==='horizontal-tb'&&parent.closest('[data-horizontal],.figure-caption,rt'))continue;
   let scope=parent;
   while(scope!==flow&&!verticalReaderEdges.has(scope))scope=scope.parentElement;
   const edges=verticalReaderEdges.get(scope)||{before:'',after:''};
   const range=doc.createRange();
   range.selectNodeContents(scope);range.setEnd(node,0);
   const point=range.toString().length,content=scope.textContent;
   const before=(edges.before+content.slice(0,point)).slice(-3);
   const after=(content.slice(point+node.length)+edges.after).slice(0,3);
   const starts=new Set(Array.from(uprightRanges(node.data,before,after),r=>r.start));
   let offset=0;
   for(const ch of node.data){
    if(isSymbol.test(ch)){
     const kind=starts.has(offset)?'upright':'native';
     const expected=kind==='upright'?'upright':'mixed';
     if(/[0-9]/.test(ch)){
      if(kind==='upright')result.uprightDigits++;
     }else result[kind]++;
     if(ch==='?')result.halfwidthQuestions++;
     if(ch==='？')result.fullwidthQuestions++;
     const missingDigitCombine=kind==='upright'&&/[0-9]/.test(ch)&&!combined;
     if(ch==='?'||!style.writingMode.startsWith('vertical')||style.textOrientation!==expected||missingDigitCombine){
      result.mismatches++;
      if(result.examples.length<12)result.examples.push({codePoint:ch.codePointAt(0),expectedCharacter:ch==='?'?'？':ch,expected,actual:style.textOrientation,combined,writingMode:style.writingMode});
     }
    }
    offset+=ch.length;
   }
  }
  return result;
 }
 return {japanesePunctuation,displayText,standaloneDigitAt,uprightRanges,count,inspect};
})();
function setVerticalText(element,source,part={}){
 const before=part.before||'',after=part.after||'';
 verticalReaderEdges.set(element,{before,after});
 const text=part.displayText??verticalReaderSymbols.displayText(source);
 let fragment=null,offset=0;
 for(const {start,end} of verticalReaderSymbols.uprightRanges(text,before,after)){
  if(!fragment)fragment=document.createDocumentFragment();
  if(start>offset)fragment.append(document.createTextNode(text.slice(offset,start)));
  const mark=document.createElement('span');
  mark.style.textOrientation='upright';
  if(/[0-9]/.test(text[start])){
   // Give a single halfwidth digit a full vertical character box at a column edge.
   mark.style.textCombineUpright='all';
   mark.style.webkitTextCombine='horizontal';
  }
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
 el.className=p.type==='heading'?'section-heading':
  p.type==='toc'?'paragraph novel-toc-entry':
  ('paragraph novel-paragraph '+(p.type==='dialogue'?'novel-dialogue':'novel-narration')+
   (p.continued?' continued':'')+(p.type!=='dialogue'&&p.text.startsWith('　')?' source-indented':''));
 if(p.type==='heading'){
  el.dataset.headingId=p.id;
  el.dataset.sourceHeadingId=p.sourceHeadingId||p.id;
  el.dataset.headingFrom=String(p.headingFrom);
  el.dataset.headingTo=String(p.headingFrom+Array.from(p.text).length);
 }else el.dataset.bodyId=p.id;
 setVerticalText(el,p.text,p);return el;
}
function fitsParts(existing,additional){
 const fragment=document.createDocumentFragment();
 for(const p of existing)fragment.append(partNode(p));
 if(additional)fragment.append(partNode(additional));
 measureText.replaceChildren(fragment);return fitsInk(measureText);
}
// A scan page is a source location, NOT a forced reader-page or paragraph break.
// Merge only explicitly source-marked continuations; retain grapheme positions
// for every source scan. Called per uninterrupted run of text.
function joinLogicalContinuations(source){
 const logical=[];
 for(const b of source){
  const preceding=logical[logical.length-1];
  if(b.sourceJoined && preceding && preceding.type!=='heading' && preceding.type!=='toc' &&
     b.type!=='heading' && b.type!=='toc' && b.type!=='dialogue'){
   const start=preceding.units.length;
   preceding.text+=b.text;
   preceding.units.push(...b.units);
   preceding.sourceRanges.push({start,end:preceding.units.length,scan:b.scan});
  }else{
   logical.push({...b,units:b.units.slice(),sourceRanges:[{start:0,end:b.units.length,scan:b.scan}]});
  }
 }
 // Normalize each joined paragraph before measuring or slicing a page.
 // All substitutions retain the original source offsets used by bookmarks and ruby.
 for(const block of logical){
  const display=verticalReaderSymbols.displayText(block.text);
  if(display===block.text)continue;
  block.sourceUnits=block.units;
  block.units=split(display);
 }
 return logical;
}
function textPart(b,off,n){
 const span=b.sourceRanges?.find(r=>r.end>off);
 return {type:b.type,id:b.id,sourceHeadingId:b.sourceHeadingId,
  headingFrom:b.type==='heading'?Array.from(b.units.slice(0,off).join('')).length:undefined,
  scan:span?.scan||b.scan,text:(b.sourceUnits||b.units).slice(off,off+n).join(''),displayText:b.units.slice(off,off+n).join(''),
  before:b.units.slice(Math.max(0,off-3),off).join('').slice(-3),after:b.units.slice(off+n,off+n+3).join('').slice(0,3),
  continued:off>0||!!b.sourceJoined,
  sourceSpans:b.sourceRanges?.filter(r=>r.end>off&&r.start<off+n).map(r=>({
   scan:r.scan,sourceStart:Math.max(0,off-r.start),
   sourceEnd:Math.min(r.end,off+n)-r.start
  }))||[]};
}
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
function g404Protected(b,point){
 const units=b.units,a=units[point-1]||'',z=units[point]||'';
 if(!protectedPageBoundary(units,point))return false;
 // e.g. どうしたか|知ってる and 近くへ|来て are natural breaks,
 // but never relax 撃|ち or ベッ|ド. ICU word boundary corroborates.
 if(/[がをにへでとはかもの]$/u.test(a)&&/^[\p{Script=Han}]/u.test(z)&&
    g404WordEnds(b).has(point))return false;
 return true;
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
 const minRead=Math.min(limit,Math.max(9,Math.ceil(limit*.72)));
 let chosen=null;
 // Prefer a natural earlier break over a two-character orphan ending.
 // This adjustment is within the same original text block; no text is changed.
 const minTail=Math.min(18,Math.max(6,Math.ceil(remaining*.32)));
 if(remaining>fitCount&&remaining-fitCount<minTail){
  const top=Math.min(limit,remaining-minTail);
  for(const minimum of [minTail,Math.max(3,Math.floor(minTail*.6))]){
   for(const kind of ['sentence','clause','word']){
    for(let n=top;n>=minimum;n--){
     if(g404Protected(b,off+n)||g404BoundaryKind(b,off+n)!==kind)continue;
     chosen={count:n,reason:'balanced-'+kind,balanced:true,exception:null};break;
    }
    if(chosen)break;
   }
   if(chosen)break;
  }
 }
 for(const [kind,cap] of [['sentence',34],['clause',28],['word',18],['grapheme',15]]){
  if(chosen)break;
  const min=Math.max(minRead,lower,limit-cap);
  for(let n=limit;n>=min;n--){
   const point=off+n;
   if(point>=units.length||g404Protected(b,point))continue;
   if(g404BoundaryKind(b,point)!==kind)continue;
   chosen={count:n,reason:kind,balanced,exception:null};break;
  }
  if(chosen)break;
 }
 if(!chosen){
  for(let n=limit;n>=minRead;n--){
   if(!g404Protected(b,off+n)){
    chosen={count:n,reason:'safe-grapheme-fallback',balanced,exception:null};break;
   }
  }
 }
 if(!chosen){
  // If ICU and the conservative Japanese join guard disagree, a word-like
  // boundary before a new kanji/katakana unit is preferable to a dangling
  // closing quotation mark. We record that this is NOT verified morphology.
  const weak=g404WordEnds(b);
  for(let n=limit;n>=minRead;n--){
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
  for(let n=limit;n>=minRead;n--){
   const point=off+n,a=units[point-1]||'',z=units[point]||'';
   if(!z||'、。，．！？!?」』）)】〕〉》]'.includes(z)||'「『（(【〔〈《'.includes(a))continue;
   chosen={count:n,reason:'forced-grapheme',balanced,
    exception:'NO_SOURCE_VERIFIED_WORD_BOUNDARY_IN_AVAILABLE_SPACE'};break;
  }
 }
 if(!chosen){
  for(let n=Math.min(limit,minRead-1);n>=1;n--){
   if(!g404Protected(b,off+n)){
    chosen={count:n,reason:'short-safe-fallback',balanced,
      exception:'BELOW_MINIMUM_READABILITY_THRESHOLD'};break;
   }
  }
 }
 if(!chosen){
  // No safe breakpoint fits, e.g. a lone opening quotation mark: do not
  // manufacture a misleading reading page that visually loses punctuation.
  throw Error('G404_NO_SAFE_PAGE_BOUNDARY scan='+b.scan+' offset='+off+' capacity='+fitCount);
 }
 return chosen;
}
function g404Record(b,off,chosen){
 const units=b.units;
 g404Audit.push({scan:b.scan,at:off+chosen.count,reason:chosen.reason,
  balanced:chosen.balanced,exception:chosen.exception,
  before:units.slice(Math.max(0,off+chosen.count-20),off+chosen.count).join(''),
  after:units.slice(off+chosen.count,Math.min(units.length,off+chosen.count+20)).join('')});
}

function paginateBlocks(group,start){
 group=joinLogicalContinuations(group);
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
   if(current.length&&fitsParts([],whole)){
    flush();continue;
   }
   // If there is no trustworthy break in the small remaining page area,
   // start a fresh page rather than cutting the next spoken phrase/word.
   let selected;
   try{selected=g404Select(b,off,lo,remaining,terminal)}
   catch(e){if(current.length){flush();continue;}throw e;}
   if(selected.exception&&current.length){flush();continue;}
   const count=selected.count;
   if(!Number.isInteger(count)||count<1||count>lo)throw Error('G404_INVALID_BREAK_COUNT');
   g404Record(b,off,selected);
   current.push(textPart(b,off,count));off+=count;at+=count;flush();
  }
 }
 flush();return out;
}
function captionFits(value){measureCaption.textContent=value;return fitsInk(measureCaption)}
function paginateOneFigure(i,start){
 const f=figures[i],out=[];let at=start;
 const displayUnits=split(verticalReaderSymbols.japanesePunctuation(f.caption));
 $('measure-caption-label').textContent=verticalReaderSymbols.japanesePunctuation(f.title);
 if(!f.units.length)return [{kind:'image',figure:i,caption:'',start,end:start+1,subpage:1,scan:f.scan}];
 let off=0,count=0;
 while(off<f.units.length){
  const remain=f.units.length-off;let lo=0,hi=remain;
  while(lo<hi){const mid=Math.ceil((lo+hi)/2);
   if(captionFits(displayUnits.slice(off,off+mid).join('')))lo=mid;else hi=mid-1;
  }
  if(lo===0)throw Error('図版の説明文を表示する領域が不足しています');
  count++;out.push({kind:'image',figure:i,caption:f.units.slice(off,off+lo).join(''),displayCaption:displayUnits.slice(off,off+lo).join(''),
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
  if(item.kind==='break'){flush();continue}
  if(item.kind==='text'){
   const block=blocks[item.block];
   if(block.type==='heading')flush();
   pending.push(block);
   continue;
  }
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
let shownPage=null,pendingPaint=null;
function currentSource(){
 const p=shownPage;if(!p)return null;
 if(p.kind==='image')return figures[p.figure]?.ownedURL||figures[p.figure]?.source||null;
 const originals=Array.isArray(book.originals)?book.originals:[];
 return sourceURL||originals.find(x=>Number(x.scan)===Number(p.scan))?.src||null;
}
function setFigure(p,image){
 const f=figures[p.figure],src=f.ownedURL||f.source||null;
 if(p.figure!==activeFigure||activeSrc!==src){
  const old=$('figure-image');
  if(image){image.id=old.id;image.alt=f.alt;old.replaceWith(image);}
  else{old.removeAttribute('src');old.alt=f.alt;old.hidden=true;}
  $('figure-placeholder').hidden=!!image;
  activeFigure=p.figure;activeSrc=src;
 }
 $('figure-caption-label').textContent=verticalReaderSymbols.japanesePunctuation(f.title);
 caption.textContent=p.displayCaption||'';
 $('figure-stage').classList.toggle('no-caption',!f.caption);
}
function updatePageButtons(target){
 // The visible page stays usable while a requested image is decoding.
 $('prev').disabled=target===0&&index===0;
 $('next').disabled=target===pages.length-1&&index===pages.length-1;
}
function render(target=index){
 const p=pages[target];
 if(p?.kind==='image'){
  const figure=figures[p.figure],src=figure.ownedURL||figure.source;
  if(src&&(activeFigure!==p.figure||activeSrc!==src)){
   if(pendingPaint?.src===src){
    pendingPaint.target=target;pendingPaint.page=p;updatePageButtons(target);return;
   }
   const image=new Image(),ticket={page:p,target,src};
   pendingPaint=ticket;updatePageButtons(target);
   const active=()=>pendingPaint===ticket&&pages[ticket.target]===ticket.page;
   function failed(){
    if(!active())return;
    pendingPaint=null;updatePageButtons(index);
    $('shelf-status').textContent='図版を読み込めませんでした。もう一度ページを選んでください。';
   }
   image.onload=async()=>{
    if(!active())return;
    try{if(image.decode)await image.decode();}catch{failed();return;}
    if(!active())return;
    if(!image.naturalWidth){failed();return;}
    pendingPaint=null;commitPage(ticket.target,image);
   };
   image.onerror=failed;image.decoding='async';image.src=src;
   return;
  }
 }
 pendingPaint=null;commitPage(target);
}
function commitPage(target,image){
 index=target;
 const p=pages[index];
 shownPage=p;
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
 }else setFigure(p,image);
 $('page-major').textContent=(index+1)+' / '+pages.length;
 const total=Number(book.totalScans)||1;
 $('page-minor').textContent=isText?('原本 '+p.scan+' / '+total):
  ('原本 '+figures[p.figure].scan+' / '+total+' ｜ 図版 '+(p.figure+1)+' / '+figures.length+' ｜ 説明 '+p.subpage);
 $('progress-fill').style.width=(100*(index+1)/pages.length).toFixed(2)+'%';
 updatePageButtons(index);
 $('shelf-status').textContent=warning||String(book.status||'見本・原本未登録');
 $('original').disabled=!currentSource();persist();
}
function cancelPageTurn(){
 if(!pendingPaint)return;
 pendingPaint=null;updatePageButtons(index);
}
function gotoPage(n){
 if(!pages.length||!Number.isInteger(n))return;
 const target=Math.max(0,Math.min(n,pages.length-1));
 if(target===index&&pendingPaint&&pages[index]===shownPage){
  cancelPageTurn();return;
 }
 if(target!==index||pendingPaint||!shownPage)render(target);
}
function stepPage(delta){gotoPage((pendingPaint?.target??index)+delta)}
function menuRefresh(){
 const list=$('menu-items');list.replaceChildren();
 if(mode==='image'){
  figures.forEach((f,i)=>{
   const btn=document.createElement('button');btn.type='button';btn.className='menu-item';
   btn.textContent=(i+1)+'．'+verticalReaderSymbols.japanesePunctuation(f.title);
   btn.addEventListener('click',()=>{gotoPage(pages.findIndex(p=>p.figure===i));closeDialogs()});list.append(btn);
  });
 }else if(mode==='text'){
  let offset=0;
  blocks.forEach(b=>{if(b.type==='heading'){
   const target=offset,btn=document.createElement('button');btn.type='button';
   btn.className='menu-item';btn.textContent=verticalReaderSymbols.japanesePunctuation(b.text);
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
  const unresolved=g404Audit.filter(x=>x.exception);
  warning=unresolved.length?'G4-04要確認：未確定境界 '+unresolved.length+'件':'';
  $('shelf-status').textContent=warning?warning:String(book.status||'見本・原本未登録');
  index=pageAt(point);render();menuRefresh();
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
 if(n===font)return;cancelPageTurn();font=n;
 document.documentElement.style.setProperty('--size',font+'px');
 $('current-size').textContent=font+'px';
 $('smaller').disabled=font<=16;$('larger').disabled=font>=30;
 schedule();
}
function closeDialogs(){$('menu-backdrop').hidden=true;$('original-backdrop').hidden=true}
$('prev').addEventListener('click',()=>stepPage(-1));
$('next').addEventListener('click',()=>stepPage(1));
$('first').addEventListener('click',()=>gotoPage(0));
$('smaller').addEventListener('click',()=>changeFont(-2));
$('larger').addEventListener('click',()=>changeFont(2));
$('all').addEventListener('click',()=>{cancelPageTurn();$('menu-backdrop').hidden=false});
$('menu-close').addEventListener('click',closeDialogs);
$('original-close').addEventListener('click',closeDialogs);
for(const id of ['menu-backdrop','original-backdrop'])$(id).addEventListener('click',e=>{if(e.target===$(id))closeDialogs()});
$('original').addEventListener('click',()=>{
 cancelPageTurn();const src=currentSource();if(!src)return;
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
  e.preventDefault();stepPage(dy<0?1:-1);
 }
},{passive:false});
main.addEventListener('touchcancel',()=>{touch=null},{passive:true});
window.addEventListener('keydown',e=>{
 if(!$('menu-backdrop').hidden||!$('original-backdrop').hidden){
  if(e.key==='Escape')closeDialogs();return;
 }
 if(e.key==='ArrowDown'||e.key==='PageDown'){e.preventDefault();stepPage(1)}
 if(e.key==='ArrowUp'||e.key==='PageUp'){e.preventDefault();stepPage(-1)}
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
window.addEventListener('pageshow',e=>{
 if(e.persisted&&!shownPage&&pages.length)render();
});
window.addEventListener('pagehide',e=>{
 cancelPageTurn();persist();
 if(e.persisted)return;
 if(sourceURL)URL.revokeObjectURL(sourceURL);
 figures.forEach(f=>{if(f.ownedURL)URL.revokeObjectURL(f.ownedURL)});
});
$('smaller').disabled=font<=16;$('larger').disabled=font>=30;
window.NovelReader=Object.freeze({version:'novel-v1',kind:mode,bookId,inspect:()=>({
 pages:pages.length,index,font,warning,paintPending:!!pendingPaint,originalReady:!!currentSource(),
 zoomed:zoomed(),hostKnown,hostScale,
 currentKind:shownPage?.kind,scan:shownPage?.scan,
 g404Exceptions:g404Audit.filter(x=>x.exception).length,
 g404Pass:!g404Audit.some(x=>x.exception)&&!warning,
 textIntegrity:pages.filter(p=>p.kind==='text').flatMap(p=>p.parts.map(x=>x.text)).join('')===
  blocks.map(b=>b.text).join(''),
 dialogueCount:blocks.filter(b=>b.type==='dialogue').length,
 dialogueStartIntegrity:blocks.filter(b=>b.type==='dialogue').every(b=>b.text.startsWith('「')||!b.text.includes('「')),
 novelSourceIntegrity:mode!=='text'||blocks.map(b=>b.text).join('')===sourceBlocks.map(b=>b.text||'').join('')
}),boundaryAudit:()=>g404Audit.slice(),pageManifest:()=>pages.map(p=>({kind:p.kind,scan:p.scan,start:p.start,end:p.end,figure:p.figure,
  // Reverse trace to original scan offsets even if one reading page spans scans.
  sourceSpans:p.kind==='text'?p.parts.flatMap(part=>part.sourceSpans||[]):[]})),
 gotoPage:n=>gotoPage(n)});
reflectZoom();requestAnimationFrame(rebuild);
if(embedded){postHost('reader-ready-v8');window.addEventListener('pageshow',()=>postHost('reader-ready-v8'));}
})();
