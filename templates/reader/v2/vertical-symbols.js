// Shared source for the embedded vertical readers. Keep the marked region identical.
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
   const parent=node.parentElement;
   if(parent.closest('rt,rp'))continue;
   const style=view.getComputedStyle(parent);
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
// Registered readings use code-point offsets within one original block. Convert once
// to the same grapheme coordinates as pagination. Dialogue slices use UTF-16 offsets.
function sourceRubyFor(block,startUTF16=0,endUTF16=block.text.length,scan=block.scan){
 const entries=block.ruby;
 if(entries===undefined||Array.isArray(entries)&&!entries.length)return;
 if(!Array.isArray(entries))throw Error('原本ルビは配列で指定してください');
 const units=split(block.text),points=Array.from(block.text);
 const byPoint=new Map([[0,0]]),byUtf16=new Map([[0,0]]);
 let cp=0,utf=0;
 units.forEach((u,i)=>{
  cp+=Array.from(u).length;utf+=u.length;
  byPoint.set(cp,i+1);byUtf16.set(utf,i+1);
 });
 const startUnit=byUtf16.get(startUTF16),endUnit=byUtf16.get(endUTF16);
 if(startUnit===undefined||endUnit===undefined)throw Error('本文の区切りが文字の途中です');
 const spans=[],ends={left:0,right:0};let previousStart=0;
 for(const g of entries){
  const side=g?.side??'right';
  if(!g||!['left','right'].includes(side)||g.reviewStatus!=='verified'||g.sourceScan!==scan||
     typeof g.sourceImageSha256!=='string'||!/^[a-f0-9]{64}$/.test(g.sourceImageSha256)||
     !Array.isArray(g.sourceBox)||g.sourceBox.length!==4||
     !g.sourceBox.every(n=>Number.isSafeInteger(n)&&n>=0)||
     g.sourceBox[0]>=g.sourceBox[2]||g.sourceBox[1]>=g.sourceBox[3]||
     !Number.isSafeInteger(g.start)||!Number.isSafeInteger(g.end)||g.start<previousStart||g.start<ends[side]||
     g.end<=g.start||!byPoint.has(g.start)||!byPoint.has(g.end)||
     points.slice(g.start,g.end).join('')!==g.base||typeof g.reading!=='string'||!g.reading.trim())
   throw Error('原本ルビの位置・親文字・確認記録が不正です。原本 '+scan);
  previousStart=g.start;ends[side]=g.end;
  const a=byPoint.get(g.start),z=byPoint.get(g.end);
  if(z<=startUnit||a>=endUnit)continue;
  if(a<startUnit||z>endUnit)throw Error('ルビの親文字が本文の区切りをまたいでいます。原本 '+scan);
  spans.push({start:a-startUnit,end:z-startUnit,reading:g.reading,...(side==='left'?{side}: {})});
 }
 return spans.length?spans:undefined;
}
function rubyInside(spans,point){
 return spans?.find(s=>s.start<point&&point<s.end);
}
function rubyShift(spans,by){
 return spans.map(s=>({...s,start:s.start+by,end:s.end+by}));
}
function rubySlice(spans,off,n){
 return rubyShift(spans.filter(s=>s.start>=off&&s.end<=off+n),-off);
}
// Keep both sides of printed ruby tied to the same base text. Native ruby handles
// nested groups; non-nesting overlaps share one grid so each base is written once.
function writePrintedRuby(parent,spans,limit,writeBase){
 const ordered=spans.slice().sort((a,b)=>a.start-b.start||b.end-a.end||(a.side==='left')-(b.side==='left'));
 const makeRt=(span,rootStart)=>{
  const rt=document.createElement('rt');
  rt.textContent=span.reading;
  rt.style.fontSize='0.5em';
  rt.dataset.rubySide=span.side||'right';
  rt.dataset.rubyStart=String(span.start-rootStart);rt.dataset.rubyEnd=String(span.end-rootStart);
  return rt;
 };
 function native(target,lo,hi,entries){
  let cursor=lo;
  for(let i=0;i<entries.length;){
   const span=entries[i++],children=[];
   if(cursor<span.start)writeBase(target,cursor,span.start);
   while(i<entries.length&&entries[i].start<span.end)children.push(entries[i++]);
   const ruby=document.createElement('ruby');
   ruby.style.webkitRubyPosition=span.side==='left'?'after':'before';
   ruby.style.rubyPosition=span.side==='left'?'under':'over';
   native(ruby,span.start,span.end,children);
   ruby.append(makeRt(span,span.start));target.append(ruby);cursor=span.end;
  }
  if(cursor<hi)writeBase(target,cursor,hi);
 }
 function crossed(target,lo,hi,entries){
  const cuts=[...new Set(entries.flatMap(r=>[r.start,r.end]))].sort((a,b)=>a-b);
  const grid=document.createElement('ruby');
  Object.assign(grid.style,{display:'inline-grid',verticalAlign:'middle',alignItems:'center',
   gridTemplateColumns:'repeat('+(cuts.length-1)+',max-content)',gridTemplateRows:'0.55em 1em 0.55em'});
  for(let i=0;i+1<cuts.length;i++){
   const base=document.createElement('span');
   base.style.gridArea='2 / '+(i+1);writeBase(base,cuts[i],cuts[i+1]);grid.append(base);
  }
  for(const s of entries){
   const rt=makeRt(s,lo);Object.assign(rt.style,{display:'block',lineHeight:'1',textAlign:'center',
    gridRow:s.side==='left'?'3':'1',gridColumn:(1+cuts.indexOf(s.start))+' / '+(1+cuts.indexOf(s.end))});
   grid.append(rt);
  }
  target.append(grid);
 }
 let cursor=0;
 for(let i=0;i<ordered.length;){
  const lo=ordered[i].start;let hi=ordered[i].end;const group=[ordered[i++]];
  while(i<ordered.length&&ordered[i].start<hi){hi=Math.max(hi,ordered[i].end);group.push(ordered[i++]);}
  if(cursor<lo)writeBase(parent,cursor,lo);
  const crossing=group.some((a,k)=>group.slice(k+1).some(b=>a.start<b.start&&b.start<a.end&&a.end<b.end));
  if(crossing)crossed(parent,lo,hi,group);else native(parent,lo,hi,group);
  cursor=hi;
 }
 if(cursor<limit)writeBase(parent,cursor,limit);
}
function setVerticalText(element,source,part={}){
 const before=part.before||'',after=part.after||'';
 verticalReaderEdges.set(element,{before,after});
 const text=part.displayText??verticalReaderSymbols.displayText(source);
 if(part.ruby?.length){
  const units=split(text),fragment=document.createDocumentFragment();
  function writeBase(parent,start,end){
   if(start===end)return;
   const node=document.createElement('span'),partText=units.slice(start,end).join('');
   setVerticalText(node,partText,{displayText:partText,
    before:(before+units.slice(0,start).join('')).slice(-3),
    after:(units.slice(end).join('')+after).slice(0,3)});
   parent.append(node);
  }
  writePrintedRuby(fragment,part.ruby,units.length,writeBase);element.replaceChildren(fragment);return;
 }
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
if(typeof module==='object'&&module.exports)module.exports={...verticalReaderSymbols,setVerticalText};
