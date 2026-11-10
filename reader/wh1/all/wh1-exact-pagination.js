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
const decorate=html=>inject(auditPart(html).replace('</head>',CHILD_CSS+TOP_START_STYLE+'</head>'),CHILD_BRIDGE);
function create({getReader,getBook,getSegments,getManifest,getActiveSegment,getScan}) {
 let cached=null,active=null,lastState=null,errorKey='';
 const getBookKey=()=>{
  const book=getBook(),manifest=getManifest(),segments=getSegments();
  const revision=segments.map(s=>(s.source_sha256||s.part||'').slice(0,16)).join('-');
  return `${REVISION}:${book?.blob?.size||0}:${manifest?.created||''}:${revision}`;
 };
 const isWh1=()=>getManifest()?.range?.[0]===1&&getManifest()?.range?.[1]===274&&getSegments()?.length===14;
 function geometry(state){
  const reader=getReader(),rect=reader.getBoundingClientRect();
  const width=Math.round(rect.width),height=Math.round(rect.height),font=Number(state.size)||20;
  return {width,height,font,key:`${getBookKey()}:${width}x${height}:${font}`};
 }
 function send(label,ratio=0){
  const scan=Math.max(1,Math.min(getManifest()?.range?.[1]||274,Number(lastState?.scan||getScan())||1));
  getReader()?.contentWindow?.postMessage({wh1bridge:1,action:'globalProgress',label,ratio,scan,maxScans:getManifest()?.range?.[1]||274},'*');
 }
 function verifiedCounts(value){return Array.isArray(value)&&value.length===14&&value.every(n=>Number.isInteger(n)&&n>0&&n<3000);}
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
  frame.srcdoc=inject(auditPart(html).replace('</head>',TOP_START_STYLE+'</head>'),MEASURE_BRIDGE);
 });}
 function start(config){
  if(!isWh1()||!getBook())return;cancel();errorKey='';send('全巻ページ数を計測中…');
  const run={frame:null,config,serial:Date.now(),step:null,cancelled:false};active=run;
  (async()=>{try{
   const counts=[];for(let i=0;i<getSegments().length;i++){
    if(active!==run||run.cancelled)return;
    const html=await getBook().readText(getSegments()[i].part),count=await measurePart(run,i,html);
    counts.push(count);run.completedCounts=counts.length;await new Promise(resolve=>setTimeout(resolve,40));
   }
   if(active!==run||run.cancelled||!verifiedCounts(counts))return;
   cached={key:config.key,counts};saveCached(config.key,counts);active=null;run.frame?.remove();if(lastState)showExact(lastState);
  }catch(err){if(active===run){active=null;run.frame?.remove();errorKey=config.key;send('全巻の計測に失敗しました');console.warn('Whole-book pagination:',err?.message||err);}}})();
 }
 function onState(state){
  lastState={...state};if(!getBook()||!getManifest())return;
  if(!isWh1()){const total=getManifest()?.range?.[1]||274,scan=Math.max(1,Math.min(total,Number(state.scan)||1));send(scan+' / '+total,scan/total);return;}
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

window.WH1ExactPager={decorate,create};
})();
