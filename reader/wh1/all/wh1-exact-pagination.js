/* WH1 exact on-device pagination. Only scans 11-30 receive the audited figure
   layout. Book text and original image bytes remain on the user's device. */
'use strict';
(() => {
const REVISION='exact-wh1-pages-v7-audit11-30-20261110';
const TOP_START_STYLE=`<style id="wh1-top-start-style">
#wh1-start-top{font-size:12px;min-height:40px;padding:6px 8px;white-space:nowrap}
@media(max-width:520px){
.toolbar-line{flex-wrap:wrap!important;column-gap:4px!important;row-gap:4px!important}
.toolbar-line .brand{flex:1 1 100%!important;width:100%!important;min-width:0!important}
.toolbar-line .brand strong{font-size:15px!important}
.toolbar-line .brand small{display:none!important}
.toolbar-line .head-actions{display:flex!important;width:100%!important;min-width:0!important;justify-content:space-between!important;gap:4px!important}
.toolbar-line .head-actions .nav-button{min-height:36px!important;padding:5px 6px!important;font-size:12px!important}
.toolbar-line .head-actions .font-control{padding:0!important;gap:0!important;flex-shrink:0!important}
.toolbar-line .head-actions .size-button{min-height:34px!important;padding:3px 6px!important;font-size:16px!important}
.toolbar-line .head-actions #current-size{min-width:34px!important;font-size:11px!important}}
@media(max-width:350px){
.toolbar-line .head-actions .nav-button{padding:5px 4px!important;font-size:11px!important}
.toolbar-line .head-actions .size-button{padding:3px 5px!important}
.toolbar-line .head-actions #current-size{min-width:30px!important}}
</style>`;
const CHILD_CSS=`<style id="wh1-exact-page-css">
#location{position:relative;color:transparent!important;white-space:nowrap;min-width:14ch;font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
#location::after{content:attr(data-wh1-global);position:absolute;inset:0;color:var(--ink,#263630);text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums}
#progress-fill{width:var(--wh1-global-progress,0%)!important}
</style>`;
const CHILD_BRIDGE=`<script>(function(){
const n=document.getElementById('location');
if(n){n.dataset.wh1Global='全巻を計測中';n.setAttribute('aria-label','全巻ページ数を計測中');}
window.addEventListener('message',function(e){
 if(e.source!==window.parent||!e.data||e.data.wh1bridge!==1||e.data.action!=='globalProgress')return;
 const d=e.data,loc=document.getElementById('location');
 if(loc){loc.dataset.wh1Global=d.label;loc.setAttribute('aria-label',d.label);}
 document.documentElement.style.setProperty('--wh1-global-progress',(Math.max(0,Math.min(1,Number(d.ratio)||0))*100).toFixed(2)+'%');
 const pos=document.getElementById('position');if(pos){const base=pos.textContent.split(' ｜ 原本 ')[0];pos.textContent=base+' ｜ 原本 '+d.scan+' / '+d.maxScans;}
});
const actions=document.querySelector('.head-actions');
if(actions&&!document.getElementById('wh1-start-top')){
 const first=document.createElement('button');first.id='wh1-start-top';first.className='nav-button';first.type='button';first.textContent='最初へ';first.setAttribute('aria-label','本の最初のページ（表紙）に戻る');
 first.addEventListener('click',function(){window.parent.postMessage({wh1bridge:1,type:'bookStart'},'*');});
 const menu=document.getElementById('open-menu');actions.insertBefore(first,menu||actions.firstChild);
}
})();</script>`;
const MEASURE_BRIDGE=`<script>(function(){
window.addEventListener('message',async function(e){
 const d=e.data;if(e.source!==window.parent||!d||d.wh1bridge!==1||d.action!=='wh1ComputePageCount')return;
 try{
  await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  if(!Array.isArray(pages)||!pages.length)throw Error('読書画面のページ組版ができませんでした');
  window.parent.postMessage({wh1bridge:1,type:'wh1Count',segment:d.segment,nonce:d.nonce,count:pages.length,font:fontPx,width:document.documentElement.clientWidth,height:window.innerHeight},'*');
 }catch(err){window.parent.postMessage({wh1bridge:1,type:'wh1CountError',segment:d.segment,nonce:d.nonce,message:String(err?.message||err)},'*');}
});
})();</script>`;
const AUDIT_CSS="<style id=\"wh1-figure-audit-1130\">\n/* Only figure pages in the audited WH1 source-scan range 11-30. */\n.figure-bundle.wh1-audited-figure{box-sizing:border-box!important;display:flex!important;flex-direction:column!important;align-items:stretch!important;writing-mode:horizontal-tb!important;direction:ltr!important;text-indent:0!important;width:100%!important;max-width:100%!important;min-width:0!important;height:100%!important;min-height:0!important;margin:0!important;padding:10px 16px!important;gap:6px!important;transform:none!important;overflow:hidden!important}\n.wh1-audited-figure>*{box-sizing:border-box!important;min-width:0!important;max-width:100%!important;direction:ltr!important;writing-mode:horizontal-tb!important;margin-left:0!important;margin-right:0!important;transform:none!important}\n.wh1-audited-figure .figure-bundle-header{width:100%!important;padding:0!important;flex:0 0 auto!important}\n.wh1-audited-figure .figure-bundle-title{display:block!important;-webkit-line-clamp:unset!important;white-space:normal!important;overflow:visible!important;overflow-wrap:anywhere!important;text-indent:0!important}\n.wh1-audited-figure .figure-bundle-art{width:100%!important;height:36%!important;flex:0 0 36%!important;min-height:0!important;padding:0!important}\n.wh1-audited-figure .figure-bundle-art img{display:block!important;width:100%!important;height:100%!important;max-width:100%!important;max-height:100%!important;object-fit:contain!important;object-position:center!important}\n.wh1-audited-figure .figure-bundle-figlabel{flex:0 0 auto!important;white-space:normal!important;text-overflow:clip!important;overflow:visible!important;overflow-wrap:anywhere!important;line-height:1.3!important}\n.wh1-audited-figure .figure-bundle-explanation{box-sizing:border-box!important;width:100%!important;flex:1 1 0%!important;min-height:0!important;margin:0!important;padding:6px 0 0!important;overflow:hidden!important;gap:4px!important}\n.wh1-audited-figure .figure-bundle-caption-label{min-height:14px!important;flex:0 0 auto!important;width:100%!important;gap:5px!important}\n.wh1-audited-figure .figure-bundle-image-sequence{white-space:nowrap!important}\n.wh1-audited-figure .figure-bundle-caption-text{display:block!important;box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-width:0!important;flex:1 1 0%!important;min-height:0!important;padding:5px 5px 8px!important;margin:0!important;overflow:hidden!important;writing-mode:horizontal-tb!important;direction:ltr!important;white-space:pre-wrap!important;overflow-wrap:anywhere!important;word-break:normal!important;line-break:strict!important;text-indent:0!important}\n.wh1-audited-figure .figure-bundle-caption-content{display:block!important;box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-width:0!important;margin:0!important;padding:0!important;text-indent:0!important;transform:none!important;white-space:inherit!important;writing-mode:horizontal-tb!important;direction:ltr!important}\n.wh1-audited-figure.wh1-compact .figure-bundle-art{height:24%!important;flex-basis:24%!important}\n@media(max-height:560px){.figure-bundle.wh1-audited-figure{padding:6px 12px!important;gap:4px!important}.wh1-audited-figure .figure-bundle-art{height:30%!important;flex-basis:30%!important}.wh1-audited-figure.wh1-compact .figure-bundle-art{height:20%!important;flex-basis:20%!important}}\n</style>";
const AUDIT_SCRIPT="<script>\n(function(){\n'use strict';\nif(window.__WH1_FIGURE_AUDIT_1130__)return;\nif(typeof blocks==='undefined'||typeof ILLUSTRATION_GROUPS==='undefined'||typeof makeIllustration!=='function')return;\n// Do not apply a book-specific repair to an unrelated segment or book.\nif(blocks.length!==99||blocks[0]?.scan!==11||blocks[98]?.scan!==30)return;\nwindow.__WH1_FIGURE_AUDIT_1130__='20261110-r1';\nconst target=p=>Number(p?.scan)>=11&&Number(p?.scan)<=30;\n// These source explanations precede their figures, but were rendered as body text.\n// Re-associate existing blocks only: no text or image payload is rewritten.\nfor(const spec of [{scan:25,at:73,heading:71,body:72},{scan:29,at:90,heading:88,body:89}]){\n const g=ILLUSTRATION_GROUPS.find(x=>x.at===spec.at&&x.scan===spec.scan);\n if(!g||blocks[spec.heading]?.type!=='heading'||blocks[spec.body]?.scan!==spec.scan)continue;\n ILLUSTRATION_BY_START.delete(g.at);g.heading=spec.heading;g.title=blocks[spec.heading].text;\n if(!g.desc.includes(spec.body))g.desc.unshift(spec.body);\n ILLUSTRATION_BY_START.set(spec.heading,g);\n ILLUSTRATION_CONSUMED.add(spec.heading);ILLUSTRATION_CONSUMED.add(spec.body);\n}\nconst oldMake=makeIllustration;\nmakeIllustration=function(p,measuring=false){\n const r=oldMake(p,measuring);if(!target(p))return r;\n r.classList.add('wh1-audited-figure');if(p.compact)r.classList.add('wh1-compact');\n const label=r.querySelector('.figure-bundle-caption-label');\n if(label){\n  if(p.group===73||p.group===90)label.firstElementChild.textContent='図の説明・図中文字';\n  let seq=label.querySelector('.figure-bundle-image-sequence');\n  if(!seq){seq=document.createElement('span');seq.className='figure-bundle-image-sequence';label.append(seq);}\n  seq.textContent=p.captionTotal?String(p.captionIndex)+' / '+p.captionTotal:'1 / 9';\n }\n return r;\n};\nfunction contained(box,inner,pad=0){return inner.left>=box.left+pad-.25&&inner.right<=box.right-pad+.25&&inner.top>=box.top+pad-.25&&inner.bottom<=box.bottom-pad+.25;}\nfunction fits(base,text){\n const stage=document.querySelector('#measuring-sheet .reading-stage');\n if(!stage)return false;\n const saved=Array.from(stage.childNodes);let ok=false;\n try{\n  const root=makeIllustration({...base,description:text},true);stage.replaceChildren(root);\n  const box=root.querySelector('.figure-bundle-caption-text'),content=box?.querySelector('.figure-bundle-caption-content');\n  if(!box||!content||box.clientHeight<25)return false;\n  const br=box.getBoundingClientRect(),cr=content.getBoundingClientRect(),rr=root.getBoundingClientRect();\n  ok=contained(br,cr,3)&&box.scrollWidth<=box.clientWidth+1&&box.scrollHeight<=box.clientHeight+1;\n  for(const el of root.children){if(!contained(rr,el.getBoundingClientRect(),1)){ok=false;break;}}\n  if(ok&&content.firstChild){const range=document.createRange();range.selectNodeContents(content);\n   for(const rect of range.getClientRects())if(!contained(br,rect,2)){ok=false;break;}\n  }\n }finally{stage.replaceChildren(...saved);}\n return ok;\n}\nconst segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('ja',{granularity:'word'}):null;\nfunction safeCut(text,max){\n if(max>=text.length)return text.length;\n let cut=keepPunctuationWithPrevious(text,Math.max(1,max-2),max);\n if(segmenter){\n  const boundaries=new Set([0]);for(const s of segmenter.segment(text))boundaries.add(s.index+s.segment.length);\n  while(cut>0&&(!boundaries.has(cut)||PAGE_INITIAL_FORBIDDEN.test(text[cut]||'')||keepNumericGroup(text,cut)!==cut))cut--;\n }\n return cut||keepPunctuationWithPrevious(text,max,max)||max;\n}\nconst oldAppend=appendIllustrationPages;\nappendIllustrationPages=function(g,output){\n if(!target(g))return oldAppend(g,output);\n const base=bundleData(g),full=base.descriptionFull;\n if(!full){output.push({...base,description:'',partOffset:0,key:'ill:'+g.at});return;}\n const result=[];let offset=0;\n while(offset<full.length){\n  const rest=full.slice(offset);let count=rest.length;\n  if(!fits(base,rest)){\n   if(!fits(base,rest.slice(0,1)))base.compact=true;\n   let lo=0,hi=rest.length;\n   while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(fits(base,rest.slice(0,mid)))lo=mid;else hi=mid-1;}\n   if(lo<1)throw Error('図説明の表示領域が不足しています。画面を縦向きに戻してください。');\n   count=safeCut(rest,lo);\n   while(count>1&&!fits(base,rest.slice(0,count)))count--;\n  }\n  result.push({...base,description:rest.slice(0,count),partOffset:offset,key:'ill:'+g.at+':'+offset,continuation:offset>0});offset+=count;\n }\n for(let i=0;i<result.length;i++){result[i].captionIndex=i+1;result[i].captionTotal=result.length;output.push(result[i]);}\n};\n// A previously retained horizontal scroll position must not hide line starts.\nconst oldShow=showPage;\nshowPage=function(){oldShow.apply(this,arguments);\n if(!target(pages[currentPage])||pages[currentPage]?.type!=='illustration')return;\n for(const id of ['sheet','reader-page','reader-main']){const el=document.getElementById(id);if(el)el.scrollLeft=0;}\n};\n})();\n</script>";
const inject=(html,script)=>html.replace('</body>',script+'</body>');
function auditPart(html){
 if(!/FIRST_SCAN\s*=\s*11\s*;/.test(html)||!/LAST_SCAN\s*=\s*30\s*;/.test(html))return html;
 if(html.includes('id="wh1-figure-audit-1130"'))return html;
 return inject(html.replace('</head>',AUDIT_CSS+'</head>'),AUDIT_SCRIPT);
}
// The released Presidents volume stores its WH1 layout script in each private segment.
// Apply the same page break to those saved segments in the reader and in the background counter.
const presidentsKeyLine=/^ try\{sessionStorage\.setItem\('us-presidents-south-\d+-\d+-page',p\.key\);\}catch\(e\)\{\}$/m;
// The archive keeps source scans in 20-scan files. Join only a paragraph that the
// archive marks as continued. Empty its old slot to preserve image and bookmark IDs.
async function continuousReading(book, manifest){
 if(manifest.bookId!=='us-presidents-south')return null;
 const html=await Promise.all(manifest.segments.map(entry=>book.readText(entry.part)));
 const blockLine=/^const blocks=(\[.*\]);$/m;
 const parts=html.map(source=>{
  const match=presidentsKeyLine.test(source)&&blockLine.exec(source);
  return match?JSON.parse(match[1]):null;
 });
 if(parts.some(blocks=>!blocks))return null;
 const joins=new Map(), changed=new Set();
 const spans=block=>block.sourceSpans||[{scan:block.scan,start:0,end:block.text.length}];
 for(let i=1;i<parts.length;i++){
  const left=parts[i-1].at(-1),right=parts[i][0];
  if(!right?.continuedFromPreviousSegment||right.type!=='body'||left?.type!=='body')continue;
  const length=left.text.length, extra=spans(right);
  joins.set(i,{block:parts[i-1].length-1,length,borrowed:right.text.length,spans:extra});
  left.sourceSpans=[...spans(left),...extra.map(span=>({...span,start:span.start+length,end:span.end+length}))];
  left.text+=right.text;
  right.text='';
  changed.add(i-1);changed.add(i);
 }
 for(const i of changed){
  const json=JSON.stringify(parts[i]).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  html[i]=html[i].replace(blockLine,()=>'const blocks='+json+';');
 }
 function locate(index,destination){
  const join=joins.get(index);
  if(join&&!destination.mode){
   const old=/^text:0:(\d+)$/.exec(destination.key||'');
   const requested=!destination.key&&!destination.heading&&destination.view!=='figure'&&join.spans.find(s=>s.scan===destination.scan);
   const offset=old?Number(old[1]):requested?requested.start:-1;
   if(offset>=0&&offset<join.borrowed)return {index:index-1,destination:{...destination,key:'text:'+join.block+':'+(join.length+offset)}};
  }
  return {index,destination};
 }
 const byPath=new Map(manifest.segments.map((segment,i)=>[segment.part,html[i]]));
 return {byPath,locate};
}

// This function runs in both the visible private segment and its measurement
// frame. Cache word boundaries for full paragraphs, so a suffix keeps its context.
function presidentsWordBreaks(){
 const segmenter=typeof Intl.Segmenter==='function'?new Intl.Segmenter('ja',{granularity:'word'}):null;
 const graphemes=segmenter?new Intl.Segmenter('ja',{granularity:'grapheme'}):null;
 const cache=new Map();
 const punctuation=/[、。，．､｡，！？!?：；」』）〕〉》】〗｝〟’”]/u;
 const open=/[（(「『［【〈《〔“‘]$/u;
 const noStart=/^[々ヽヾゝゞーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎ\p{Mark}\uFE0F\u200D]/u;
 const latin=/[\p{Script=Latin}\p{Number}]/u;
 const kana=/[\p{Script=Katakana}ー]/u;
 function wordEnds(full){
  if(cache.has(full))return cache.get(full);
  const ends=new Set();
  if(segmenter){
   for(const part of segmenter.segment(full))ends.add(part.index+part.segment.length);
  }else{
   const category=c=>kana.test(c)?'kana':latin.test(c)?'latin':/\p{Script=Han}/u.test(c)?'han':/\p{Script=Hiragana}/u.test(c)?'hira':c;
   let last='',i=0;
   for(const c of full){
    if(last&&(category(last)!==category(c)||punctuation.test(last)||/\s/u.test(last)))ends.add(i);
    last=c;i+=c.length;
   }
   ends.add(i);
  }
  cache.set(full,ends);return ends;
 }
 return function(text,preferred,maxFit,full=text,offset=0,emptyPage=false){
  if(maxFit>=text.length)return text.length;
  const max=Math.max(0,Math.min(maxFit,text.length-1)),goal=Math.min(max,Math.max(1,preferred));
  const ends=wordEnds(full);
  function valid(k){
   if(k<=0||!ends.has(offset+k))return false;
   const prev=text[k-1],next=text[k];
   if(PAGE_INITIAL_FORBIDDEN.test(next)||noStart.test(next)||open.test(prev)||keepNumericGroup(text,k)!==k)return false;
   if(kana.test(prev)&&kana.test(next))return false;
   if((prev==='・'&&kana.test(next))||(kana.test(prev)&&next==='・'))return false;
   if(latin.test(prev)&&latin.test(next))return false;
   const joiner=/[-‐‑’']/u;
   if(latin.test(prev)&&joiner.test(next)&&latin.test(text[k+1]||''))return false;
   if(joiner.test(prev)&&latin.test(next)&&latin.test(text[k-2]||''))return false;
   return true;
  }
  for(let k=max;k>=Math.max(1,goal-22);k--)if(punctuation.test(text[k-1])&&valid(k))return k;
  for(let k=goal;k>=1;k--)if(valid(k))return k;
  for(let k=max;k>goal;k--)if(valid(k))return k;
  // A token larger than an otherwise empty screen must span screens. Take the
  // fitting graphemes together, never one UTF-16 code unit per screen.
  if(emptyPage&&max>0){
   let end=0;
   for(const item of (graphemes?graphemes.segment(text):text)){
    const length=(graphemes?item.segment:item).length;
    if(end+length>max)break;
    end+=length;
   }
   if(end)return end;
  }
  return 0;
 };
}

function preparePart(html){
 if(!presidentsKeyLine.test(html))return auditPart(html);
 const loop='  let remain=b.text,offset=0;\n  while(remain.length){';
 const headingBreak="  if(b.type==='heading'&&parts.some(part=>part.type!=='heading'))flush();";
 if(!html.includes(headingBreak))html=html.replace(loop,headingBreak+'\n'+loop);

 // The legacy layout used a character-limit fallback after punctuation.
 const start='function keepPunctuationWithPrevious(text,preferred,maxFit){';
 if(html.includes(start)){
  const from=html.indexOf(start),to=html.indexOf('\n}',from)+2;
  html=html.slice(0,from)+'const keepPunctuationWithPrevious=('+presidentsWordBreaks.toString()+')();'+html.slice(to);
  html=html.replace('keepPunctuationWithPrevious(remain,Math.max(1,lo-allowance),lo)','keepPunctuationWithPrevious(remain,Math.max(1,lo-allowance),lo,b.text,offset,!parts.length)')
   .replace('keepPunctuationWithPrevious(remain,Math.max(1,cut-2),Math.max(1,cut-2))','keepPunctuationWithPrevious(remain,Math.max(1,cut-2),Math.max(1,cut-2),b.text,offset,!parts.length)')
   .replace('keepPunctuationWithPrevious(remaining,desired,n)','keepPunctuationWithPrevious(remaining,desired,n,all,offset,true)');
 }

 // Text page keys store a block and its UTF-16 offset. Repagination can move
 // that exact offset into the middle of a page. Restore the containing page.
 const lookup='    if(dest?.key) idx=pages.findIndex(p=>p.key===dest.key);';
 const fallback=String.raw`
    if(idx<0 && typeof dest?.key==='string'){
      const anchor=/^text:(\d+):(\d+)$/.exec(dest.key);
      if(anchor){
        const block=Number(anchor[1]),offset=Number(anchor[2]);
        idx=pages.findIndex(page=>page.parts?.some(part=>part.block===block&&
          part.offset<=offset&&offset<part.offset+part.text.length));
      }
    }`;
 return html.includes(fallback)?html:html.replace(lookup,()=>lookup+fallback);
}
const decorate=html=>inject(preparePart(html).replace('</head>',CHILD_CSS+TOP_START_STYLE+'</head>'),CHILD_BRIDGE);
function create({getReader,getBook,getSegments,getManifest,getActiveSegment,getScan,useExactPagination=()=>false}) {
 let cached=null,active=null,lastState=null,errorKey='';
 const getBookKey=()=>{
  const book=getBook(),manifest=getManifest(),segments=getSegments();
  const revision=segments.map(s=>(s.source_sha256||s.part||'').slice(0,16)).join('-');
  const layout=manifest?.bookId==='us-presidents-south'?'word-flow-v2:':'';
  return (useExactPagination()?manifest.bookId+':'+layout:'')+`${REVISION}:${book?.blob?.size||0}:${manifest?.created||''}:${revision}`;
 };
 const exact=()=>useExactPagination()||(getManifest()?.range?.[0]===1&&getManifest()?.range?.[1]===274&&getSegments()?.length===14);
 function geometry(state){
  const reader=getReader(),rect=reader.getBoundingClientRect();
  const width=Math.round(rect.width),height=Math.round(rect.height),font=Number(state.size)||20;
  return {width,height,font,key:`${getBookKey()}:${width}x${height}:${font}`};
 }
 function send(label,ratio=0){
  const scan=Math.max(1,Math.min(getManifest()?.range?.[1]||274,Number(lastState?.scan||getScan())||1));
  getReader()?.contentWindow?.postMessage({wh1bridge:1,action:'globalProgress',label,ratio,scan,maxScans:getManifest()?.range?.[1]||274},'*');
 }
 function verifiedCounts(value){return Array.isArray(value)&&value.length===getSegments().length&&value.every(n=>Number.isInteger(n)&&n>0&&n<3000);}
 function storeKey(signature){return 'WH1_EXACT_BOOK_PAGES:'+signature;}
 function loadCached(signature){try{const data=JSON.parse(localStorage.getItem(storeKey(signature)));return verifiedCounts(data?.counts)?data.counts:null;}catch(_){return null;}}
 function saveCached(signature,counts){try{localStorage.setItem(storeKey(signature),JSON.stringify({counts,verifiedAt:Date.now()}));}catch(_){}}
 function showExact(state){
  const a=cached?.counts,index=getActiveSegment();if(!a||index<0||index>=a.length)return;
  if(a[index]!==Number(state.totalPages)){errorKey=cached.key;cached=null;send('組版が一致しません');return;}
  let offset=0;for(let i=0;i<index;i++)offset+=a[i];
  const total=a.reduce((sum,n)=>sum+n,0),current=offset+Math.max(1,Math.min(a[index],Number(state.pageIndex)+1));
  send(current+' / '+total,current/total);
 }
 function cancel(){
  const running=active;active=null;if(!running)return;running.cancelled=true;
  if(running.step){clearTimeout(running.step.timer);running.step.reject(Error('計測条件が変更されました'));running.step=null;}
  running.frame?.remove();
 }
 function addRecountButton(){
  const menu=document.querySelector('#menuOverlay .menuActions');if(!menu||menu.querySelector('#wh1Recount'))return;
  const button=document.createElement('button');button.type='button';button.id='wh1Recount';button.className='button';button.textContent='全巻ページ数を再計測';
  button.onclick=()=>{if(!lastState)return;const key=geometry(lastState).key;try{localStorage.removeItem(storeKey(key));}catch(_){}cached=null;errorKey='';cancel();start(geometry(lastState));document.getElementById('menuClose')?.click();};menu.append(button);
 }
 addRecountButton();
 window.addEventListener('message',event=>{
  const run=active;if(!run||!run.step||event.source!==run.frame?.contentWindow||!event.data?.wh1bridge)return;
  const d=event.data,step=run.step;if(d.segment!==step.index)return;
  if(d.type==='prepare'){
   const assets=Object.entries(getSegments()[step.index].assets).map(([name,meta])=>({name,mime:meta.mime,data:new ArrayBuffer(0)}));
   run.frame.contentWindow?.postMessage({wh1bridge:1,action:'loadAssets',assets,size:run.config.font},'*');
  }else if(d.type==='state'&&!step.requested){step.requested=true;run.frame.contentWindow?.postMessage({wh1bridge:1,action:'wh1ComputePageCount',segment:step.index,nonce:step.nonce},'*');
  }else if(d.type==='wh1Count'&&d.nonce===step.nonce){
   if(!Number.isInteger(d.count)||d.count<1||d.count>2999||d.font!==run.config.font||Math.abs(d.width-run.config.width)>1||Math.abs(d.height-run.config.height)>1)step.reject(Error('組版条件が一致しません'));
   else step.resolve(d.count);
  }else if(d.type==='wh1CountError'&&d.nonce===step.nonce)step.reject(Error(d.message||'全巻組版に失敗しました'));
 });
 function measurePart(run,index,html){return new Promise((resolve,reject)=>{
  run.frame?.remove();const frame=document.createElement('iframe');frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;frame.id='wh1-background-pagination';
  frame.style.cssText='position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-1;border:0;';frame.style.width=run.config.width+'px';frame.style.height=run.config.height+'px';
  document.body.append(frame);run.frame=frame;
  if(active!==run||run.cancelled)return reject(Error('計測が中止されました'));
  const step={index,nonce:`${run.serial}-${index}`,requested:false,resolve:null,reject:null,timer:null};
  const clear=()=>{clearTimeout(step.timer);if(run.step===step)run.step=null;if(run.frame===frame){frame.remove();run.frame=null;}};
  step.resolve=value=>{clear();resolve(value);};step.reject=err=>{clear();reject(err);};run.step=step;
  step.timer=setTimeout(()=>step.reject(Error(`${index+1}区間目の組版が完了しませんでした`)),45000);
  frame.srcdoc=inject(preparePart(html).replace('</head>',TOP_START_STYLE+'</head>'),MEASURE_BRIDGE);
 });}
 function start(config){
  if(!exact()||!getBook())return;cancel();errorKey='';send('全巻ページ数を計測中…');
  const run={frame:null,config,serial:Date.now(),step:null,cancelled:false};active=run;
  (async()=>{try{
   const counts=[];for(let i=0;i<getSegments().length;i++){
    if(active!==run||run.cancelled)return;
    const html=await getBook().readText(getSegments()[i].part);
    const count=await measurePart(run,i,html);
    counts.push(count);run.completedCounts=counts.length;await new Promise(resolve=>setTimeout(resolve,40));
   }
   if(active!==run||run.cancelled||!verifiedCounts(counts))return;
   cached={key:config.key,counts};saveCached(config.key,counts);active=null;run.frame?.remove();if(lastState)showExact(lastState);
  }catch(err){if(active===run){active=null;run.frame?.remove();errorKey=config.key;send('全巻の計測に失敗しました');console.warn('Whole-book pagination:',err?.message||err);}}})();
 }
 function onState(state){
  lastState={...state};if(!getBook()||!getManifest())return;
  if(!exact()){const total=getManifest()?.range?.[1]||274,scan=Math.max(1,Math.min(total,Number(state.scan)||1));send(scan+' / '+total,scan/total);return;}
  const config=geometry(state);
  if(cached?.key===config.key){showExact(state);return;}
  if(active?.config.key===config.key){send('全巻ページ数を計測中…');return;}
  if(errorKey===config.key){send('全巻ページ数が未確定');return;}
  const fromDisk=loadCached(config.key);if(fromDisk){cached={key:config.key,counts:fromDisk};showExact(state);return;}
  cached=null;start(config);
 }
 window.addEventListener('pagehide',cancel);
 return {onState,retry:()=>{if(lastState){cached=null;errorKey='';start(geometry(lastState));}},getStatus:()=>({active:!!active,exact:!!cached,counts:cached?.counts||null,step:active?.step?.index,completed:active?.completedCounts,errorKey})};
}

window.WH1ExactPager={decorate,create,continuousReading};
})();
