/* WH1 figure viewport repair v8. No book text, pictures or storage are changed.
 * The original pagination and image handlers stay in place. Apply to scans 11-30 only.
 */
'use strict';
(() => {
  const VERSION='figure-viewport-v8-20261110';
  const original=window.WH1ExactPager;
  if(!original?.decorate||!original?.create)throw Error('The WH1 page layout module did not load.');
  if(window.WH1FigureViewportRevision===VERSION)return;
  const CSS=`<style id="wh1-figure-viewport-v8-css">
/* A vertical-text clipping layer must never cover horizontal picture pages. */
html.wh1-picture-v8,html.wh1-picture-v8 body,
html.wh1-picture-v8 #reader-main,html.wh1-picture-v8 #sheet,
html.wh1-picture-v8 #reader-page{
 clip:auto!important;clip-path:none!important;-webkit-clip-path:none!important;
 mask-image:none!important;-webkit-mask-image:none!important;
 text-indent:0!important;writing-mode:horizontal-tb!important;direction:ltr!important;
}
html.wh1-picture-v8 #reader-page{
 box-sizing:border-box!important;position:relative!important;left:0!important;right:auto!important;
 top:0!important;width:100%!important;max-width:100%!important;min-width:0!important;
 height:100%!important;margin:0!important;padding:0!important;
 transform:translateZ(0)!important;isolation:isolate!important;
}
html.wh1-picture-v8 #sheet::before,html.wh1-picture-v8 #sheet::after,
html.wh1-picture-v8 #reader-page::before,html.wh1-picture-v8 #reader-page::after,
html.wh1-picture-v8 #reader-main::before,html.wh1-picture-v8 #reader-main::after{
 content:none!important;display:none!important;
}
.figure-bundle[data-wh1-viewport="8"]{
 box-sizing:border-box!important;min-width:0!important;width:100%!important;max-width:100%!important;
 margin-left:0!important;margin-right:0!important;text-indent:0!important;
 clip:auto!important;clip-path:none!important;-webkit-clip-path:none!important;
 mask-image:none!important;-webkit-mask-image:none!important;
 writing-mode:horizontal-tb!important;direction:ltr!important;transform:translateZ(0)!important;
}
.figure-bundle[data-wh1-viewport="8"] .figure-bundle-header,
.figure-bundle[data-wh1-viewport="8"] .figure-bundle-explanation,
.figure-bundle[data-wh1-viewport="8"] .figure-bundle-caption-text,
.figure-bundle[data-wh1-viewport="8"] .figure-bundle-caption-content{
 min-width:0!important;max-width:100%!important;text-indent:0!important;
 clip:auto!important;clip-path:none!important;-webkit-clip-path:none!important;
 mask-image:none!important;-webkit-mask-image:none!important;
 writing-mode:horizontal-tb!important;direction:ltr!important;
}
#wh1-display-revision8{font-size:10px;font-weight:500;letter-spacing:0;margin-left:8px;vertical-align:middle;color:#5c726f}
</style>`;
  function installChild(){
    'use strict';
    if(window.__WH1_FIGURE_VIEWPORT_V8__)return;
    if(typeof blocks==='undefined'||!Array.isArray(blocks)||typeof makeIllustration!=='function'||typeof showPage!=='function')return;
    if(Number(blocks[0]?.scan)!==11||Number(blocks[blocks.length-1]?.scan)!==30)return;
    window.__WH1_FIGURE_VIEWPORT_V8__='figure-viewport-v8-20261110';
    const area=document.getElementById('reader-page');
    if(!area)return;
    const inRange=p=>p?.type==='illustration'&&Number(p.scan)>=11&&Number(p.scan)<=30;
    const remembered=new Map();
    const resets={'clip':'auto','clip-path':'none','-webkit-clip-path':'none','mask-image':'none','-webkit-mask-image':'none'};
    function restore(){
      for(const [element,properties] of remembered){
        for(const [name,old] of Object.entries(properties)){
          if(old.value)element.style.setProperty(name,old.value,old.priority);
          else element.style.removeProperty(name);
        }
      }
      remembered.clear();
    }
    function setMode(active){
      document.documentElement.classList.toggle('wh1-picture-v8',active);
      if(!active){restore();return;}
      for(const element of [document.documentElement,document.body,document.getElementById('reader-main'),document.getElementById('sheet'),area]){
        if(!element)continue;
        if(!remembered.has(element)){
          const prior={};
          for(const name of Object.keys(resets))prior[name]={value:element.style.getPropertyValue(name),priority:element.style.getPropertyPriority(name)};
          remembered.set(element,prior);
        }
        for(const [name,value] of Object.entries(resets))element.style.setProperty(name,value,'important');
        if(element.scrollLeft!==0)element.scrollLeft=0;
      }
    }
    function badge(){
      const brand=document.querySelector('.brand strong');
      if(!brand||document.getElementById('wh1-display-revision8'))return;
      const label=document.createElement('span');label.id='wh1-display-revision8';
      label.textContent='表示修正8';label.title='原本11〜30枚目の図版表示修正が読み込まれています';brand.append(label);
    }
    const makeBefore=makeIllustration;
    makeIllustration=function(p,measuring=false){
      const root=makeBefore.apply(this,arguments);
      if(inRange(p))root.dataset.wh1Viewport='8';
      return root;
    };
    let scheduled=false;
    function refresh(){
      const root=area.querySelector('.figure-bundle');
      const active=!!root&&Number(root.dataset.scan)>=11&&Number(root.dataset.scan)<=30;
      setMode(active);badge();
      if(!active)return;
      root.dataset.wh1Viewport='8';
      for(const box of root.querySelectorAll('.figure-bundle-caption-text'))if(box.scrollLeft!==0)box.scrollLeft=0;
      if(scheduled)return;scheduled=true;
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        scheduled=false;
        const current=area.querySelector('.figure-bundle[data-wh1-viewport="8"]');if(!current)return;
        const sheet=document.getElementById('sheet'),caption=current.querySelector('.figure-bundle-caption-content');
        const outer=sheet?.getBoundingClientRect(),inner=caption?.getBoundingClientRect();
        const fits=!inner||!outer||(inner.left>=outer.left&&inner.right<=outer.right+.5);
        // Geometry only, never text or image contents. No network requests.
        window.__WH1_VIEWPORT8_STATUS__={revision:window.__WH1_FIGURE_VIEWPORT_V8__,scan:Number(current.dataset.scan),horizontalBounds:fits};
        window.parent.postMessage({wh1bridge:1,type:'wh1ViewportVersion',...window.__WH1_VIEWPORT8_STATUS__},'*');
        if(!fits)console.warn('WH1 picture viewport still extends outside its sheet.');
      }));
    }
    const showBefore=showPage;
    showPage=function(){
      setMode(typeof pages!=='undefined'&&inRange(pages[currentPage]));
      const result=showBefore.apply(this,arguments);refresh();return result;
    };
    new MutationObserver(refresh).observe(area,{childList:true});
    window.addEventListener('resize',refresh);
    window.addEventListener('pageshow',refresh);
    refresh();
  }
  function repair(html){
    const isPart=/\bFIRST_SCAN\s*=\s*11\b/.test(html)&&/\bLAST_SCAN\s*=\s*30\b/.test(html);
    const isStandalone=/<title>[^<]*世界の歴史[ 　]*[1１][^<]*11[〜～\-–]30[^<]*<\/title>/.test(html);
    if(!isPart&&!isStandalone)return html;
    if(html.includes('id="wh1-figure-viewport-v8-css"'))return html;
    const script='<script id="wh1-figure-viewport-v8-script">('+installChild.toString()+')();<\/script>';
    return html.replace('</head>',CSS+'</head>').replace('</body>',script+'</body>');
  }
  window.WH1ExactPager={
    ...original,
    decorate:html=>repair(original.decorate(html)),
    create(options){
      let previousBook=null,view=null;
      const getBook=()=>{
        const book=options.getBook();if(!book)return book;
        if(book!==previousBook){
          previousBook=book;view=Object.create(book);
          view.readText=async path=>repair(await book.readText(path));
        }
        return view;
      };
      const getManifest=()=>{const value=options.getManifest();return value?{...value,created:String(value.created||'')+':'+VERSION}:value;};
      return original.create({...options,getBook,getManifest});
    }
  };
  window.WH1FigureViewportRevision=VERSION;
})();
