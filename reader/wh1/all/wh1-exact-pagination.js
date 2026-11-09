/* World History 1: exact whole-book pagination, measured on the current device.
   This script never uploads, edits, or exposes any book contents. */
'use strict';
(() => {
  const REVISION = 'exact-wh1-pages-v6-figure32-entire-caption';

  // Used by both visible readers and invisible page measuring frames, so that
  // the exact total-page measurement accounts for the same toolbar height.
  const TOP_START_STYLE = `<style id="wh1-top-start-style">
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
 .toolbar-line .head-actions #current-size{min-width:34px!important;font-size:11px!important}
}
@media(max-width:350px){
 .toolbar-line .head-actions .nav-button{padding:5px 4px!important;font-size:11px!important}
 .toolbar-line .head-actions .size-button{padding:3px 5px!important}
 .toolbar-line .head-actions #current-size{min-width:30px!important}
}
</style>`;

  const SCAN18_CSS = "<style id=\"wh1-scan18-nocrop\">\n/* 原本18枚目の図説：iOSで各行の左端が欠けないよう余白を確保する。\n   原本画像と本文データ、図説84%の文字サイズは変更しない。 */\n.figure-bundle[data-scan=\"18\"] {\n  box-sizing:border-box!important;\n  width:100%!important;\n  max-width:100%!important;\n  min-width:0!important;\n  padding-left:clamp(24px,calc(var(--size)*1.5),45px)!important;\n  padding-right:12px!important;\n}\n.figure-bundle[data-scan=\"18\"] .figure-bundle-header,\n.figure-bundle[data-scan=\"18\"] .figure-bundle-explanation,\n.figure-bundle[data-scan=\"18\"] .figure-bundle-caption-label,\n.figure-bundle[data-scan=\"18\"] .figure-bundle-caption-text,\n.figure-bundle[data-scan=\"18\"] .figure-bundle-caption-content {\n  box-sizing:border-box!important;\n  min-width:0!important;\n  max-width:100%!important;\n}\n.figure-bundle[data-scan=\"18\"] .figure-bundle-title {\n  display:block!important;\n  white-space:normal!important;\n  -webkit-line-clamp:unset!important;\n  overflow:visible!important;\n}\n.figure-bundle[data-scan=\"18\"] .figure-bundle-caption-text {\n  overflow:visible!important;\n  white-space:pre-wrap!important;\n  overflow-wrap:anywhere!important;\n}\n.figure-bundle[data-scan=\"18\"] .figure-bundle-caption-content {\n  display:block!important;\n  padding:0!important;\n  margin:0!important;\n  white-space:inherit!important;\n}\n</style>";
  // Scan 18: protect the start of each line and make caption overflow readable.
  // The private OCR/scan images remain untouched; this only changes on-device layout.
  const SCAN18_SAFE_CSS = `<style id="wh1-scan18-figure32-left-v5">
/* Only the animal evolution figure on scan 18 (group 32).
   Keep the original illustration, complete caption text and 20px base size;
   allow the existing fitting routine to split the caption across reading pages. */
.figure-bundle[data-scan="18"][data-figure-group="32"]{
  box-sizing:border-box!important;width:100%!important;max-width:100%!important;min-width:0!important;
  padding-left:clamp(42px,calc(var(--size)*2.3),64px)!important;
  padding-right:14px!important;gap:4px!important;overflow:hidden!important;
}
.figure-bundle[data-scan="18"][data-figure-group="32"] .figure-bundle-header,
.figure-bundle[data-scan="18"][data-figure-group="32"] .figure-bundle-explanation{
  box-sizing:border-box!important;min-width:0!important;width:100%!important;max-width:100%!important;
  margin:0!important;padding-left:0!important;padding-right:0!important;align-self:stretch!important;
}
.figure-bundle[data-scan="18"][data-figure-group="32"] .figure-bundle-art{
  height:30%!important;flex:0 0 30%!important;min-height:0!important;
}
.figure-bundle[data-scan="18"][data-figure-group="32"] .figure-bundle-explanation{
  overflow:visible!important;
}
.figure-bundle[data-scan="18"][data-figure-group="32"] .figure-bundle-caption-text{
  display:block!important;box-sizing:border-box!important;min-width:0!important;width:100%!important;max-width:100%!important;
  padding:0 0 0 4px!important;margin:0!important;overflow:visible!important;
  white-space:pre-wrap!important;overflow-wrap:anywhere!important;word-break:normal!important;
  text-indent:0!important;direction:ltr!important;writing-mode:horizontal-tb!important;
}
.figure-bundle[data-scan="18"][data-figure-group="32"] .figure-bundle-caption-content{
  display:block!important;min-width:0!important;max-width:100%!important;
  margin:0!important;padding:0!important;white-space:inherit!important;text-indent:0!important;transform:none!important;
}
</style>`;
  // Extra scan-18 fix: the PDF-derived OCR text remains in the user-selected
  // local ZIP. Only the animal-evolution figure's on-device presentation changes.
  // Its 20px base setting and original scan/figure images are never altered.
  const SCAN18_FULL_CSS = `<style id="wh1-scan18-entire-caption-v6">
.figure-bundle[data-scan="18"][data-figure-group="32"] .figure-bundle-art{
  height:26%!important;flex:0 0 26%!important;min-height:0!important;
}
.figure-bundle[data-scan="18"][data-figure-group="32"] .figure-bundle-explanation{
  display:flex!important;flex-direction:column!important;flex:1 1 0%!important;min-height:0!important;
  overflow:hidden!important;
}
.figure-bundle[data-scan="18"][data-figure-group="32"] .figure-bundle-caption-text{
  display:block!important;box-sizing:border-box!important;flex:1 1 0%!important;
  width:100%!important;max-width:100%!important;min-height:0!important;
  margin:0!important;padding:3px 10px 12px 12px!important;
  overflow-x:hidden!important;overflow-y:auto!important;
  -webkit-overflow-scrolling:touch!important;overscroll-behavior-y:contain!important;touch-action:pan-y!important;
}
.figure-bundle[data-scan="18"][data-figure-group="32"] .figure-bundle-caption-content{
  display:block!important;box-sizing:border-box!important;max-width:100%!important;
  margin:0!important;padding:0 2px!important;text-indent:0!important;transform:none!important;
  white-space:pre-wrap!important;overflow-wrap:anywhere!important;
}
.figure-bundle[data-scan="18"][data-figure-group="32"] .figure-bundle-scrollhint{
  flex:0 0 auto;font-size:10px;line-height:1.35;color:#83513e;text-align:right;
}
</style>`;
  // The local per-segment reader normally splits long figure descriptions over
  // several pages. For this one figure only, keep the full existing description
  // in the scrollable panel. Apply the SAME change to offscreen page measurement.
  function scan18SinglePage(html){
    const from=['function appendIllustrationPages(g,output){',' const base=bundleData(g),all=base.descriptionFull;'].join(String.fromCharCode(10));
    const to=[from,' if(Number(g.scan)===18&&g.title==="動物の発達"){output.push({...base,description:all,partOffset:0,key:"ill:"+g.at+":0"});return;}'].join(String.fromCharCode(10));
    return html.replace(from,to);
  }
  // Native iOS scrolling must be kept away from the reader's outer swipe handler
  // when a finger starts inside the scan-18 description panel.
  const SCAN18_SCROLL_BRIDGE = `<script>(function(){
    const area=document.getElementById('reader-page');
    if(!area)return;
    function bind(){
      const caption=area.querySelector('.figure-bundle[data-scan="18"][data-figure-group="32"] .figure-bundle-caption-text');
      if(!caption||caption.dataset.wh1ScrollBound)return;
      caption.dataset.wh1ScrollBound='1';
      for(const type of ['touchstart','touchmove','touchend','touchcancel']){
        caption.addEventListener(type,event=>event.stopPropagation(),{passive:true});
      }
      caption.addEventListener('wheel',event=>event.stopPropagation(),{passive:true});
      const hint=document.createElement('div');
      hint.className='figure-bundle-scrollhint';
      hint.textContent='↓ 説明欄を上下にスクロールして最後まで読む';
      caption.insertAdjacentElement('beforebegin',hint);
    }
    new MutationObserver(bind).observe(area,{childList:true});
    bind();
  })();</script>`;
  const CHILD_CSS = `<style id="wh1-exact-page-css">
#location{position:relative;color:transparent!important;white-space:nowrap;min-width:14ch;font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
#location::after{content:attr(data-wh1-global);position:absolute;inset:0;color:var(--ink,#263630);text-align:center;white-space:nowrap;font-variant-numeric:tabular-nums}
#progress-fill{width:var(--wh1-global-progress,0%)!important}
</style>`;
  const CHILD_BRIDGE = `<script>(function(){
    const n=document.getElementById('location');
    if(n){n.dataset.wh1Global='全巻を計測中';n.setAttribute('aria-label','全巻ページ数を計測中');}
    window.addEventListener('message',function(e){
      if(e.source!==window.parent||!e.data||e.data.wh1bridge!==1||e.data.action!=='globalProgress')return;
      const d=e.data,loc=document.getElementById('location');
      if(loc){loc.dataset.wh1Global=d.label;loc.setAttribute('aria-label',d.label);}
      document.documentElement.style.setProperty('--wh1-global-progress',(Math.max(0,Math.min(1,Number(d.ratio)||0))*100).toFixed(2)+'%');
      const pos=document.getElementById('position');
      if(pos){const base=pos.textContent.split(' ｜ 原本 ')[0];pos.textContent=base+' ｜ 原本 '+d.scan+' / '+d.maxScans;}
    });
    const actions=document.querySelector('.head-actions');
    if(actions&&!document.getElementById('wh1-start-top')){
      const first=document.createElement('button');first.id='wh1-start-top';
      first.className='nav-button';first.type='button';first.textContent='最初へ';
      first.setAttribute('aria-label','本の最初のページ（表紙）に戻る');
      first.addEventListener('click',function(){
        window.parent.postMessage({wh1bridge:1,type:'bookStart'},'*');
      });
      const menu=document.getElementById('open-menu');
      actions.insertBefore(first,menu||actions.firstChild);
    }
  })();</script>`;
  const MEASURE_BRIDGE = `<script>(function(){
    window.addEventListener('message',async function(e){
      const d=e.data;if(e.source!==window.parent||!d||d.wh1bridge!==1||d.action!=='wh1ComputePageCount')return;
      try{
        await document.fonts.ready;
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        if(!Array.isArray(pages)||!pages.length)throw Error('読書画面のページ組版ができませんでした');
        window.parent.postMessage({wh1bridge:1,type:'wh1Count',segment:d.segment,nonce:d.nonce,
          count:pages.length,font:fontPx,width:document.documentElement.clientWidth,
          height:window.innerHeight},'*');
      }catch(err){window.parent.postMessage({wh1bridge:1,type:'wh1CountError',segment:d.segment,
        nonce:d.nonce,message:String(err?.message||err)},'*');}
    });
  })();</script>`;
  const inject = (html, script) => html.replace('</body>', script + '</body>');
  const decorate = html => inject(scan18SinglePage(html).replace('</head>', CHILD_CSS + TOP_START_STYLE + SCAN18_CSS + SCAN18_SAFE_CSS + SCAN18_FULL_CSS + '</head>'), SCAN18_SCROLL_BRIDGE + CHILD_BRIDGE);

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
      getReader()?.contentWindow?.postMessage({wh1bridge:1,action:'globalProgress',label,ratio,
        scan,maxScans:getManifest()?.range?.[1]||274},'*');
    }
    function verifiedCounts(value){
      return Array.isArray(value)&&value.length===14&&value.every(n=>Number.isInteger(n)&&n>0&&n<3000);
    }
    function storeKey(signature){return 'WH1_EXACT_BOOK_PAGES:'+signature;}
    function loadCached(signature){
      try{const data=JSON.parse(localStorage.getItem(storeKey(signature)));
        return verifiedCounts(data?.counts)?data.counts:null;
      }catch(_){return null;}
    }
    function saveCached(signature,counts){try{localStorage.setItem(storeKey(signature),JSON.stringify({counts,verifiedAt:Date.now()}));}catch(_){}}
    function showExact(state){
      const a=cached?.counts,index=getActiveSegment();
      if(!a||index<0||index>=a.length)return;
      if(a[index]!==Number(state.totalPages)){
        // Never claim an exact total when real active pagination disagrees with
        // the off-screen render. The user can retry after the viewport settles.
        errorKey=cached.key;cached=null;
        send('組版が一致しません');return;
      }
      let offset=0;for(let i=0;i<index;i++)offset+=a[i];
      const total=a.reduce((sum,n)=>sum+n,0);
      const current=offset+Math.max(1,Math.min(a[index],Number(state.pageIndex)+1));
      send(current+' / '+total,current/total);
    }
    function cancel(){
      const running=active;active=null;if(!running)return;
      running.cancelled=true;
      if(running.step){clearTimeout(running.step.timer);running.step.reject(Error('計測条件が変更されました'));running.step=null;}
      running.frame?.remove();
    }
    function addRecountButton(){
      const menu=document.querySelector('#menuOverlay .menuActions');
      if(!menu||menu.querySelector('#wh1Recount'))return;
      const button=document.createElement('button');button.type='button';button.id='wh1Recount';
      button.className='button';button.textContent='全巻ページ数を再計測';
      button.onclick=()=>{if(!lastState)return;const key=geometry(lastState).key;
        try{localStorage.removeItem(storeKey(key));}catch(_){};
        cached=null;errorKey='';cancel();start(geometry(lastState));
        document.getElementById('menuClose')?.click();};
      menu.append(button);
    }
    addRecountButton();
    window.addEventListener('message',event=>{
      const run=active;
      if(!run||!run.step||event.source!==run.frame?.contentWindow||!event.data?.wh1bridge)return;
      const d=event.data,step=run.step;
      if(d.segment!==step.index)return;
      if(d.type==='prepare'){
        const assets=Object.entries(getSegments()[step.index].assets).map(([name,meta])=>
          ({name,mime:meta.mime,data:new ArrayBuffer(0)}));
        run.frame.contentWindow?.postMessage({wh1bridge:1,action:'loadAssets',assets,size:run.config.font},'*');
      }else if(d.type==='state'&&!step.requested){
        step.requested=true;
        run.frame.contentWindow?.postMessage({wh1bridge:1,action:'wh1ComputePageCount',
          segment:step.index,nonce:step.nonce},'*');
      }else if(d.type==='wh1Count'&&d.nonce===step.nonce){
        if(!Number.isInteger(d.count)||d.count<1||d.count>2999||d.font!==run.config.font||
          Math.abs(d.width-run.config.width)>1||Math.abs(d.height-run.config.height)>1){
          step.reject(Error('組版条件が一致しません'));
        }else step.resolve(d.count);
      }else if(d.type==='wh1CountError'&&d.nonce===step.nonce)step.reject(Error(d.message||'全巻組版に失敗しました'));
    });
    function measurePart(run,index,html){
      return new Promise((resolve,reject)=>{
        // A fresh frame per section prevents srcdoc history documents from
        // accumulating during font-size remeasurement on memory-limited iPhones.
        run.frame?.remove();
        const frame=document.createElement('iframe');
        frame.setAttribute('sandbox','allow-scripts');frame.setAttribute('aria-hidden','true');frame.tabIndex=-1;
        frame.id='wh1-background-pagination';
        frame.style.cssText='position:fixed;left:0;top:0;opacity:0;pointer-events:none;z-index:-1;border:0;';
        frame.style.width=run.config.width+'px';frame.style.height=run.config.height+'px';
        document.body.append(frame);run.frame=frame;
        if(active!==run||run.cancelled)return reject(Error('計測が中止されました'));
        const step={index,nonce:`${run.serial}-${index}`,requested:false,resolve:null,reject:null,timer:null};
        const clear=()=>{clearTimeout(step.timer);if(run.step===step)run.step=null;
          if(run.frame===frame){frame.remove();run.frame=null;}
        };
        step.resolve=value=>{clear();resolve(value);};
        step.reject=err=>{clear();reject(err);};
        run.step=step;
        step.timer=setTimeout(()=>step.reject(Error(`${index+1}区間目の組版が完了しませんでした`)),45000);
        frame.srcdoc=inject(scan18SinglePage(html).replace('</head>',TOP_START_STYLE+SCAN18_CSS+SCAN18_SAFE_CSS+SCAN18_FULL_CSS+'</head>'),MEASURE_BRIDGE);
      });
    }
    function start(config){
      if(!isWh1()||!getBook())return;
      cancel();errorKey='';send('全巻ページ数を計測中…');
      const run={frame:null,config,serial:Date.now(),step:null,cancelled:false};active=run;
      (async()=>{
        try{
          const counts=[];
          for(let i=0;i<getSegments().length;i++){
            if(active!==run||run.cancelled)return;
            const html=await getBook().readText(getSegments()[i].part);
            const count=await measurePart(run,i,html);
            counts.push(count);run.completedCounts=counts.length;
            // Yield between sections: the visible book stays usable during counting.
            await new Promise(resolve=>setTimeout(resolve,40));
          }
          if(active!==run||run.cancelled||!verifiedCounts(counts))return;
          cached={key:config.key,counts};saveCached(config.key,counts);
          active=null;run.frame?.remove();if(lastState)showExact(lastState);
        }catch(err){
          if(active===run){active=null;run.frame?.remove();errorKey=config.key;send('全巻の計測に失敗しました');
            console.warn('Whole-book pagination:',err?.message||err);}
        }
      })();
    }
    function onState(state){
      lastState={...state};if(!getBook()||!getManifest())return;
      if(!isWh1()){const total=getManifest()?.range?.[1]||274;
        const scan=Math.max(1,Math.min(total,Number(state.scan)||1));send(scan+' / '+total,scan/total);return;}
      const config=geometry(state);
      if(cached?.key===config.key){showExact(state);return;}
      if(active?.config.key===config.key){send('全巻ページ数を計測中…');return;}
      if(errorKey===config.key){send('全巻ページ数が未確定');return;}
      const fromDisk=loadCached(config.key);
      if(fromDisk){cached={key:config.key,counts:fromDisk};showExact(state);return;}
      cached=null;start(config);
    }
    window.addEventListener('pagehide',cancel);
    return {onState,retry:()=>{if(lastState){cached=null;errorKey='';start(geometry(lastState));}},getStatus:()=>({active:!!active,exact:!!cached,counts:cached?.counts||null, step:active?.step?.index,completed:active?.completedCounts, errorKey})};
  }
  window.WH1ExactPager={decorate,create};
})();
