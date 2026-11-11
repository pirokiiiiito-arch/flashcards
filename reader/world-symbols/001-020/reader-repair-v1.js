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

function repair(html){
 const before=inspect(html);
 if(html.includes("world-symbols-wh1-fix-v1"))return {html,version:"world-symbols-wh1-fix-v1",summary:before};
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
 html=one(html,"function pagesForCurrent(){",pagesFn+"function pagesForCurrent(){");
 html=span(html,"function activateFigurePinch(frame,inner){","\nfunction renderReader(){","function activateFigurePinch(frame,inner){/* browser-native pinch */}\n");
 html=one(html,"const stage=byId('readingStage');stage.replaceChildren();stage.className=",
 "const stage=byId('readingStage');const figureKey=x.kind==='figure'?(String(p.scan)+':'+x.figure.figureId):'';const keepFigure=!!figureKey&&stage.dataset.figureKey===figureKey&&!!stage.querySelector('.figure-frame');if(!keepFigure)stage.replaceChildren();stage.dataset.figureKey=figureKey;stage.className=");
 const branch=` if(x.kind==='figure'){
 const capText='［'+x.figure.figureId.replace('FIG-','')+'］'+x.figure.label+'　'+x.text;
 if(keepFigure){
  const cap=stage.querySelector('.figure-caption');if(cap)cap.textContent=capText;
  const frame=stage.querySelector('.figure-frame'),inner=stage.querySelector('.figure-inner'),img=frame?.querySelector('img');
  if(frame&&inner&&img)placeFigureOriginal(frame,inner,img,p,x.figure);
 }else{
  const frame=makeElement('div','figure-frame'),inner=makeElement('div','figure-inner'),img=document.createElement('img');
  img.src=p.dataUrl;img.alt='原本'+pad(p.scan)+'の図版'+x.figure.figureId;
  inner.appendChild(img);frame.appendChild(inner);
  const cap=makeElement('div','figure-caption',capText);
  stage.append(frame,cap);placeFigureOriginal(frame,inner,img,p,x.figure);activateFigurePinch(frame,inner);
 }
`;
 html=span(html," if(x.kind==='figure'){\n  const frame=makeElement('div','figure-frame');"," }else if(x.kind==='empty'){",branch);
 html=span(html,"const sourcePane=byId('sourceBody');let srcGesture=null;","let touchY=0,touchX=0;","const sourcePane=byId('sourceBody');\n");
 const swipe=`/* world-symbols-wh1-fix-v1 */
let gX=0,gY=0,gAt=0,gTracking=false,gMulti=false,gWheel=0;
const gStage=byId('readView'),gZoom=()=>!!(window.visualViewport&&window.visualViewport.scale>1.01);
gStage.addEventListener('touchstart',e=>{if(e.touches.length!==1||gZoom()){gTracking=false;gMulti=true;return;}if(gMulti)return;gTracking=true;gX=e.touches[0].clientX;gY=e.touches[0].clientY;gAt=Date.now();},{passive:true});
gStage.addEventListener('touchmove',e=>{if(e.touches.length>1){gTracking=false;gMulti=true;return;}if(!gTracking||gZoom())return;const dx=e.touches[0].clientX-gX,dy=e.touches[0].clientY-gY;if(Math.abs(dy)>14&&Math.abs(dy)>Math.abs(dx)*1.15&&e.cancelable)e.preventDefault();},{passive:false});
gStage.addEventListener('touchend',e=>{if(gMulti){if(!e.touches.length){gMulti=false;gTracking=false;}return;}if(!gTracking||gZoom()||!e.changedTouches.length)return;gTracking=false;if(Date.now()-gAt>1600)return;const dx=e.changedTouches[0].clientX-gX,dy=e.changedTouches[0].clientY-gY;if(Math.abs(dy)>45&&Math.abs(dy)>Math.abs(dx)*1.15){if(e.cancelable)e.preventDefault();go(dy<0?1:-1);}else if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.35){if(e.cancelable)e.preventDefault();go(dx<0?1:-1);}},{passive:false});
gStage.addEventListener('touchcancel',()=>{gTracking=false;gMulti=false;},{passive:true});
gStage.addEventListener('wheel',e=>{if(e.ctrlKey||gZoom()||Math.abs(e.deltaY)<16||Math.abs(e.deltaY)<Math.abs(e.deltaX))return;if(e.cancelable)e.preventDefault();const t=Date.now();if(t-gWheel<560)return;gWheel=t;go(e.deltaY>0?1:-1);},{passive:false});
`;
 html=span(html,"let touchY=0,touchX=0;","document.addEventListener('keydown',",swipe);
 html=one(html,"document.addEventListener('keydown',e=>{if(e.target.matches('textarea,input,select'))return;if(e.key==='ArrowDown'||e.key==='PageDown'){go(1);}if(e.key==='ArrowUp'||e.key==='PageUp'){go(-1);}});",
 "document.addEventListener('keydown',e=>{if(e.target.matches('textarea,input,select'))return;if(['ArrowLeft','ArrowDown','PageDown',' '].includes(e.key)){e.preventDefault();go(1);}if(['ArrowRight','ArrowUp','PageUp'].includes(e.key)){e.preventDefault();go(-1);}});");
 html=one(html,"</style></head><body>","</style><style id=\"ws-native-whole-screen-pinch\">html,body,body *{touch-action:pan-x pan-y pinch-zoom!important}#readView{touch-action:pan-x pinch-zoom!important}#sourceBody,#sourceBody img,.figure-frame,.figure-inner{touch-action:pan-x pan-y pinch-zoom!important}</style></head><body>");
 const after=inspect(html);
 if(after.data!==before.data)throw Error("PRIVATE_BOOK_CONTENT_CHANGED");
 return {html,version:"world-symbols-wh1-fix-v1",summary:after};
}
return {one,span,inspect,repair};
});
