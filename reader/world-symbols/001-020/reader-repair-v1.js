'use strict';
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.WorldSymbolsReaderRepair=api;})(typeof window!=='undefined'?window:null,function(){
function one(s,a,b){const p=s.indexOf(a);if(p<0||s.indexOf(a,p+1)>=0)throw Error("REPAIR_ANCHOR:"+a.slice(0,60));return s.slice(0,p)+b+s.slice(p+a.length);}

function span(s,a,b,repl){const i=s.indexOf(a),j=i<0?-1:s.indexOf(b,i+a.length);if(i<0||j<0||s.indexOf(a,i+1)>=0)throw Error("REPAIR_SECTION:"+a.slice(0,60));return s.slice(0,i)+repl+s.slice(j);}

function inspect(html){
 const m=html.match(/<script\b[^>]*id=["']embedded-data["'][^>]*>([\s\S]*?)<\/script>/i);
 if(!m)throw Error("原本データを持たないHTMLです");
 let book;try{book=JSON.parse(m[1]);}catch(e){throw Error("読書データが壊れています");}
 if(book.bookId!=="sekai-symbol-jiten"||!Array.isArray(book.pages)||book.pages.length!==20||book.pages.some((p,i)=>p.scan!==i+1))
  throw Error("『世界シンボル事典』001〜020のスキャン順が一致しません");
 const originals=book.pages.filter(p=>/^data:image\/(?:jpeg|png);base64,/i.test(p.dataUrl||"")).length;
 const textPages=book.pages.filter(p=>(p.blocks||[]).some(b=>String(b.text||"").trim().length)).length;
 const figures=book.pages.reduce((n,p)=>n+(p.figures?.length||0),0);
 if(originals!==20||textPages===0)throw Error("空の読書HTMLです（原本"+originals+"/20・文字"+textPages+"/20）。2010版を選択してください");
 return {originals,textPages,figures,proofed:book.pages.filter(p=>p.proofStatus==="passed").length,data:m[1]};
}

function wsSwipeDecision(dx,dy,ms,zoom){
 if(zoom||ms<0||ms>1600||!Number.isFinite(dx)||!Number.isFinite(dy))return 0;
 if(Math.abs(dy)>45&&Math.abs(dy)>Math.abs(dx)*1.15)return dy<0?1:-1;
 if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.35)return dx<0?1:-1;
 return 0;
}

function wsBodyPunctuation(text){return String(text??'').split(',').join('、').split('.').join('。');}
function wsNormalizeBodyPunctuation(book){
 let replacements=0;
 for(const page of book?.pages||[]){
  for(const block of page.blocks||[]){
   if(block.kind!=='body'||typeof block.text!=='string')continue;
   const next=wsBodyPunctuation(block.text);
   if(next!==block.text){
    if(typeof block.originalOCRText!=='string')block.originalOCRText=block.text;
    replacements+=(block.text.match(/[,\.]/g)||[]).length;
    block.text=next;
   }
  }
 }
 return replacements;
}

function wsSeedRegions(book){
 if(!book||!Array.isArray(book.pages)||book.pages.length!==20)throw Error('REGION_BOOK_INVALID');
 const fixed={
  1:[['title',[.50,.105,.555,.350]],['figure',[.650,.705,.975,.970]]],
  2:[['figure',[.065,.065,.610,.380]],['title',[.025,.845,.990,.940]]],
  3:[['title',[.025,.070,.980,.280]],['figure',[.120,.290,.925,.890]],['imprint',[.030,.870,.980,.975]]],
  4:[['frontmatter',[.175,.410,.830,.565]],['imprint',[.220,.650,.840,.835]],['imprint',[.175,.835,.845,.975]]],
  9:[['heading',[.385,.110,.675,.180]],['body',[.045,.210,.965,.980]]],
  15:[['heading',[.390,.110,.690,.175]],['body',[.045,.215,.965,.975]]],
  20:[['running_header',[.035,.040,.965,.085]],['body',[.045,.210,.965,.795]],['signature',[.070,.790,.940,.890]]]
 };
 const result={generated:[],totalBlocks:0,mappedBlocks:0};
 for(const p of book.pages){
  if(!Number.isInteger(p.scan)||!Number.isInteger(p.width)||!Number.isInteger(p.height))throw Error('REGION_DIMENSIONS_INVALID');
  result.totalBlocks+=(p.blocks||[]).length;
  if(Array.isArray(p.regions)&&p.regions.length){
   result.mappedBlocks+=(p.blocks||[]).filter(b=>b.sourceRegionIds?.length).length;continue;
  }
  let boxes=fixed[p.scan]||[];
  if(!boxes.length)boxes=p.pageType==='figures'
   ?[['figure_numbers',[.445,.435,.605,.482]],['figure_numbers',[.445,.888,.605,.926]]]
   :[['running_header',[.035,.035,.965,.086]],['body',[.045,.205,.965,p.scan===17?.981:.975]]];
  const make=(kind,coords,tag,figId)=>({
   regionId:'WS-'+String(p.scan).padStart(3,'0')+'-'+tag,kind,sourceScan:p.scan,
   bboxNorm:coords,bboxPx:[Math.round(coords[0]*p.width),Math.round(coords[1]*p.height),Math.round(coords[2]*p.width),Math.round(coords[3]*p.height)],
   relatedFigureId:figId||null,linkedBlockIds:[],coordinateStatus:'candidate_needs_source_review',
   source:'visual candidate + original cropNorm; not verified exact pixel text boundary'
  });
  p.regions=boxes.map(([kind,coords],i)=>make(kind,coords,kind.toUpperCase()+'-'+(i+1)));
  if(p.pageType==='figures'&&Array.isArray(p.figures))
   for(let i=0;i<p.figures.length;i++){
    const f=p.figures[i],number=String(f.figureId||'FIG-'+(i+1)).replace(/[^A-Z0-9-]/gi,'');
    if(!Array.isArray(f.cropNorm)||f.cropNorm.length!==4)throw Error('REGION_FIGURE_CROP_MISSING');
    p.regions.push(make('figure',f.cropNorm,'FIG-'+number,f.figureId));
    const y=.906+i*.019;
    p.regions.push(make('caption',[.035,y,.970,Math.min(.987,y+.022)],'CAP-'+number,f.figureId));
   }
  for(const b of p.blocks||[]){
   let linked=[];
   if(b.kind==='caption'){
    const n=Number(String(b.id||'').match(/\d+$/)?.[0]);
    const figure=p.figures?.find(f=>Number(String(f.figureId||'').match(/\d+$/)?.[0])===n);
    if(figure)linked=p.regions.filter(r=>r.relatedFigureId===figure.figureId);
   }else if(b.kind==='heading')linked=p.regions.filter(r=>r.kind==='heading');
   else if(b.kind==='body')linked=p.regions.filter(r=>r.kind==='body');
   else if(b.kind==='frontmatter')linked=p.regions.filter(r=>r.kind==='frontmatter'||r.kind==='imprint');
   if(!linked.length)linked=p.regions.filter(r=>['body','frontmatter','title','caption'].includes(r.kind));
   b.sourceRegionIds=linked.map(r=>r.regionId);
   b.sourceRegionId=b.sourceRegionIds[0]||'';
   for(const r of linked)if(!r.linkedBlockIds.includes(b.id))r.linkedBlockIds.push(b.id);
   if(linked.length)result.mappedBlocks++;
  }
  p.regionInventoryStatus='candidate_needs_source_review';
  result.generated.push({scan:p.scan,regions:p.regions.length});
 }
 return result;
}

function extractSwipeV3(){
 const marker='/* world-symbols-wh1-fix-v3 */';
 const src=String(repair).match(/const swipe=\x60([\s\S]*?)\x60;/);
 if(!src)throw Error('SWIPE_V3_SOURCE_MISSING');
 return marker+src[1].slice(src[1].indexOf('\n')).replace('${wsSwipeDecision.toString()}',wsSwipeDecision.toString()).replace(/\\n/g,'\n');
}

function repair(html){
 const before=inspect(html);
 if(html.includes("world-symbols-wh1-fix-v3"))return {html,version:"world-symbols-wh1-fix-v3",summary:before};
 if(html.includes("world-symbols-wh1-fix-v2")){
  const gesture=extractSwipeV3();
  const updated=span(html,"/* world-symbols-wh1-fix-v2 */","document.addEventListener('keydown',",gesture);
  if(inspect(updated).data!==before.data)throw Error("PRIVATE_BOOK_CONTENT_CHANGED");
  return {html:updated,version:"world-symbols-wh1-fix-v3",summary:before};
 }
 if(html.includes("world-symbols-wh1-fix-v1"))throw Error("以前に保存した旧パッチ版です。原本の2010版HTMLを選び直してください");
 const pagesFn=`function wsFigurePages(source){
 const box=byId('readingContent'),w=Math.max(140,box.clientWidth-12),maxH=Math.max(56,Math.min(220,box.clientHeight*.32));
 const probe=makeElement('div','figure-caption');
 probe.style.cssText='position:fixed;left:-99999px;top:0;visibility:hidden;width:'+w+'px;height:auto;max-height:none;overflow:visible;pointer-events:none';
 document.body.appendChild(probe);const all=[];
 try{for(const fig of source.figures){
  const raw=String(fig.caption||''),prefix='［'+String(fig.figureId||'').replace('FIG-','')+'］'+String(fig.label||'')+'　',parts=[];let at=0,guard=0;
  function fits(s){probe.textContent=prefix+s;return probe.getBoundingClientRect().height<=maxH+1;}
  if(!raw)parts.push('');
  while(at<raw.length&&guard++<10000){const rem=raw.slice(at);if(fits(rem)){parts.push(rem);break;}
   let lo=1,hi=rem.length,n=1;while(lo<=hi){const mid=(lo+hi)>>1;if(fits(rem.slice(0,mid))){n=mid;lo=mid+1;}else hi=mid-1;}
   if(n>8&&n<rem.length){for(let k=n;k>=Math.max(1,n-14);k--){if(/[。！？、，）｣」』]/.test(rem[k-1])){n=k;break;}}}
   parts.push(rem.slice(0,n));at+=n;
  }
  if(guard>=10000)throw Error('図説明の改ページを完了できません');
  parts.forEach((part,i)=>all.push({kind:'figure',figure:fig,text:part,figurePart:i+1,figureParts:parts.length}));
 }}finally{probe.remove();}return all;
}\n`;
 html=one(html,"const source=pg();if(source.pageType==='figures'&&Array.isArray(source.figures)&&source.figures.length)return source.figures.map(fig=>({kind:'figure',figure:fig,text:fig.caption}));","const source=pg();if(source.pageType==='figures'&&Array.isArray(source.figures)&&source.figures.length)return wsFigurePages(source);");
  const uprightFn=`${wsBodyPunctuation.toString()}\n${wsNormalizeBodyPunctuation.toString()}\nfunction wsWriteVertical(el,s){
  const text=String(s||'');el.replaceChildren();let at=0;
  for(let i=0;i<text.length;i++){
   const ch=text[i],left=text[i-1]||'',right=text[i+1]||'';
   if(/[0-9]/.test(ch)&&!/[0-9A-Za-z.,]/.test(left)&&!/[0-9A-Za-z.,]/.test(right)){
    if(i>at)el.appendChild(document.createTextNode(text.slice(at,i)));
    const span=document.createElement('span');span.className='ws-one-digit';span.textContent=ch;el.appendChild(span);at=i+1;
   }
  }
  if(at<text.length)el.appendChild(document.createTextNode(text.slice(at)));
 }
 function wsSafeCut(text,k){
  if(k>=text.length)return k;
  let best=k;
  try{if(typeof Intl.Segmenter==='function'){
   const lower=Math.max(1,Math.floor(k*.72));
   for(const part of new Intl.Segmenter('ja',{granularity:'word'}).segment(text)){
    const end=part.index+part.segment.length;
    if(end>=lower&&end<=k&&end>best*.72)best=end;
   }
  }}catch(e){}
  if(/[0-9０-９〇一二三四五六七八九十百千万]$/.test(text.slice(0,best))
   &&/^[0-9０-９〇一二三四五六七八九十百千万年月日％%㎝kmｍcmメートル]/.test(text.slice(best))){
    const m=text.slice(0,best).match(/[0-9０-９〇一二三四五六七八九十百千万]+$/);
    if(m&&best>m[0].length)best-=m[0].length;
  }
  if(/^[、。！？）｣」』]/.test(text.slice(best))&&best>1)best--;
  return Math.max(1,best);
 }
 function wsPrepareText(raw,kind){
  let s=String(raw||'').replace(/[ \t　]{3,}/g,' ');
  s=s.replace(/[ \\t　]*\\r?\\n[ \\t　]*/g,(whole,offset,full)=>{
    const left=(full.slice(0,offset).match(/[^\\s]$/)||[])[0]||'';
    const right=(full.slice(offset+whole.length).match(/^[^\\s]/)||[])[0]||'';
    return /[A-Za-z0-9]$/.test(left)&&/^[A-Za-z0-9]/.test(right)?' ':'';
  });
  return kind==='body'?wsBodyPunctuation(s):s;
 }`;
html=one(html,"function pagesForCurrent(){",uprightFn+pagesFn+"function pagesForCurrent(){");
 html=one(html,"let blocks=pg().blocks.filter(b=>b.text&&b.text.length);",
 "const sourceBlocks=pg().blocks.filter(b=>b.text&&b.text.length);let blocks=[];for(const b of sourceBlocks){const normalized=wsPrepareText(b.text,b.kind);const last=blocks[blocks.length-1];if(b.kind==='body'&&last&&last.kind==='body'){last.text+=normalized;}else{blocks.push({...b,text:normalized,sourceIndex:pg().blocks.indexOf(b)});}}");
 html=one(html,"function refresh(){","function refresh(){wsNormalizeBodyPunctuation(book);");
 html=one(html,"all[i].blockIdx=book.pages[index].blocks.indexOf(b);","all[i].blockIdx=(b.sourceIndex ?? book.pages[index].blocks.indexOf(b));");
 html=one(html,"probe.textContent=s;return probe.getBoundingClientRect().width <= width+1;","wsWriteVertical(probe,s);return probe.getBoundingClientRect().width <= width+1;");
 html=one(html,"if(k<rem.length){const trail=","k=wsSafeCut(rem,k);if(k<rem.length){const trail=");
 html=one(html,"}else{stage.textContent=x.text;}","}else{wsWriteVertical(stage,x.text);}");
 html=span(html,"function activateFigurePinch(frame,inner){","\nfunction renderReader(){","function activateFigurePinch(frame,inner){/* browser-native pinch */}\n");
 html=one(html,"const stage=byId('readingStage');stage.replaceChildren();stage.className=",
 "const stage=byId('readingStage');const figureKey=x.kind==='figure'?(String(p.scan)+':'+x.figure.figureId):'';const keepFigure=!!figureKey&&stage.dataset.figureKey===figureKey&&!!stage.querySelector('.figure-frame');if(!keepFigure)stage.replaceChildren();stage.dataset.figureKey=figureKey;stage.className=");
 const branch=` if(x.kind==='figure'){
 const capText='［'+x.figure.figureId.replace('FIG-','')+'］'+x.figure.label+'　'+x.text;
 if(keepFigure){
  const cap=stage.querySelector('.figure-caption');if(cap){cap.textContent=capText;const capH=Math.max(56,Math.min(220,byId('readingContent').clientHeight*.32));cap.style.height=capH+'px';cap.style.flex='0 0 '+capH+'px';cap.style.overflow='hidden';}
  const frame=stage.querySelector('.figure-frame'),inner=stage.querySelector('.figure-inner'),img=frame?.querySelector('img');
  if(frame&&inner&&img)placeFigureOriginal(frame,inner,img,p,x.figure);
 }else{
  const frame=makeElement('div','figure-frame'),inner=makeElement('div','figure-inner'),img=document.createElement('img');
  img.src=p.dataUrl;img.alt='原本'+pad(p.scan)+'の図版'+x.figure.figureId;
  inner.appendChild(img);frame.appendChild(inner);
  const cap=makeElement('div','figure-caption',capText);const capH=Math.max(56,Math.min(220,byId('readingContent').clientHeight*.32));cap.style.height=capH+'px';cap.style.flex='0 0 '+capH+'px';cap.style.overflow='hidden';
  stage.append(frame,cap);placeFigureOriginal(frame,inner,img,p,x.figure);activateFigurePinch(frame,inner);
 }
`;
 html=span(html," if(x.kind==='figure'){\n  const frame=makeElement('div','figure-frame');"," }else if(x.kind==='empty'){",branch);
 html=span(html,"const sourcePane=byId('sourceBody');let srcGesture=null;","let touchY=0,touchX=0;","const sourcePane=byId('sourceBody');\n");
 const swipe=`/* world-symbols-wh1-fix-v3 */
${wsSwipeDecision.toString()}
let gX=0,gY=0,gAt=0,gTracking=false,gMulti=false,gWheel=0,gLastCommitAt=0,gLastMove=0;\nfunction gCommit(move){const now=Date.now();if(!move||(move===gLastMove&&now-gLastCommitAt<140))return false;gLastCommitAt=now;gLastMove=move;go(move);return true;}
const gStage=byId('readView'),gZoom=()=>!!(window.visualViewport&&window.visualViewport.scale>1.01);
gStage.addEventListener('touchstart',e=>{if(e.touches.length!==1||gZoom()){gTracking=false;gMulti=true;return;}if(gMulti)return;gTracking=true;gX=e.touches[0].clientX;gY=e.touches[0].clientY;gAt=Date.now();},{passive:true});
gStage.addEventListener('touchmove',e=>{if(e.touches.length>1){gTracking=false;gMulti=true;return;}if(!gTracking||gZoom())return;const dx=e.touches[0].clientX-gX,dy=e.touches[0].clientY-gY;if(Math.abs(dy)>14&&Math.abs(dy)>Math.abs(dx)*1.15&&e.cancelable)e.preventDefault();},{passive:false});
gStage.addEventListener('touchend',e=>{if(gMulti){if(!e.touches.length){gMulti=false;gTracking=false;}return;}if(!gTracking||!e.changedTouches.length)return;gTracking=false;const dx=e.changedTouches[0].clientX-gX,dy=e.changedTouches[0].clientY-gY,move=wsSwipeDecision(dx,dy,Date.now()-gAt,gZoom());if(move){if(e.cancelable)e.preventDefault();gCommit(move);}},{passive:false});
gStage.addEventListener('touchcancel',()=>{gTracking=false;gMulti=false;},{passive:true});\nlet pointerGesture=null;\ngStage.addEventListener('pointerdown',e=>{\n if(e.pointerType!=='touch'||!e.isPrimary||gZoom()){pointerGesture=null;return;}\n pointerGesture={x:e.clientX,y:e.clientY,at:Date.now()};\n},{passive:true});\ngStage.addEventListener('pointermove',e=>{\n if(!pointerGesture||e.pointerType!=='touch'||gZoom())return;\n const dx=e.clientX-pointerGesture.x,dy=e.clientY-pointerGesture.y;\n if(Math.abs(dy)>14&&Math.abs(dy)>Math.abs(dx)*1.15&&e.cancelable)e.preventDefault();\n},{passive:false});\ngStage.addEventListener('pointerup',e=>{\n if(!pointerGesture||e.pointerType!=='touch'){pointerGesture=null;return;}\n const p=pointerGesture;pointerGesture=null;\n const move=wsSwipeDecision(e.clientX-p.x,e.clientY-p.y,Date.now()-p.at,gZoom()||gMulti);\n if(move){if(e.cancelable)e.preventDefault();gCommit(move);}\n},{passive:false});\ngStage.addEventListener('pointercancel',()=>{pointerGesture=null;},{passive:true});
gStage.addEventListener('wheel',e=>{if(e.ctrlKey||gZoom()||Math.abs(e.deltaY)<16||Math.abs(e.deltaY)<Math.abs(e.deltaX))return;if(e.cancelable)e.preventDefault();const t=Date.now();if(t-gWheel<560)return;gWheel=t;go(e.deltaY>0?1:-1);},{passive:false});
`;
 html=span(html,"let touchY=0,touchX=0;","document.addEventListener('keydown',",swipe);
 html=one(html,"document.addEventListener('keydown',e=>{if(e.target.matches('textarea,input,select'))return;if(e.key==='ArrowDown'||e.key==='PageDown'){go(1);}if(e.key==='ArrowUp'||e.key==='PageUp'){go(-1);}});",
 "document.addEventListener('keydown',e=>{if(e.target.matches('textarea,input,select'))return;if(['ArrowLeft','ArrowDown','PageDown',' '].includes(e.key)){e.preventDefault();go(1);}if(['ArrowRight','ArrowUp','PageUp'].includes(e.key)){e.preventDefault();go(-1);}});");
 html=one(html,"</style></head><body>","</style><style id=\"ws-native-whole-screen-pinch\">html,body,body *{touch-action:pan-x pan-y pinch-zoom!important}#readView,#readingStage,.figure-frame,.figure-inner{touch-action:pan-x pinch-zoom!important}#sourceBody,#sourceBody img{touch-action:pan-x pan-y pinch-zoom!important}.ws-one-digit{text-orientation:upright!important;text-combine-upright:none!important}#readingStage.vertical-text{white-space:normal;word-break:normal}.figure-caption{font-size:var(--caption-size)!important;line-height:1.48!important}</style></head><body>");
 html=one(html,"// The original bytes remain in dataUrl. Display layers never resave or redraw original scans.\nrefresh();",
  "// The original bytes remain in dataUrl. Display layers never resave or redraw original scans.\n"+wsSeedRegions.toString()+"\nwindow.wsRegionInventory=wsSeedRegions(book);\nrefresh();");
 const after=inspect(html);
 if(after.data!==before.data)throw Error("PRIVATE_BOOK_CONTENT_CHANGED");
 return {html,version:"world-symbols-wh1-fix-v3",summary:after};
}
return {one,span,inspect,repair,wsSwipeDecision,wsSeedRegions,wsBodyPunctuation,wsNormalizeBodyPunctuation};
});
