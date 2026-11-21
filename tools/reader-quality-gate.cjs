#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const priorShelfShell=require('./reader-shelf-prior.cjs');
const ROOT=path.resolve(__dirname,'..');
const ID='1CngvhZvJPQsGizwmaVKC_old4Vlvxzn2';
const RULES=["G1-01","G1-02","G1-03","G1-04","G1-05","G1-07","G1-08","G1-10","G1-12","G2-01","G2-02","G2-03","G2-04","G2-05","G2-07","G2-11","G3-01","G3-02","G3-03","G3-04","G3-05","G3-06","G3-07","G4-01","G4-02","G4-03","G4-04","G4-05","G4-09","G5-01","G5-02","G5-03","G5-04","G5-05","G5-10","P20","G6-01","G6-02","G6-03","G6-05","G6-09","G6-11","G6-12","P22","P23","G7-01","G7-02","G7-03","G7-04","G7-05","G7-10","G7-12","G8-01","G8-02","G8-03","G8-04","G8-05","G8-07","G8-08","G8-11"];
const FROZEN_LEGACY={"reader/british-interior/01-20/index.html":"e7621aed807da408becae93a2074a53ad6d072fc","reader/british-interiors/01-20/index.html":"7e137385b8be4802d66a9fccfa9a993382357e30","reader/british-interiors/21-40/index.html":"0c56a5f2e9f54c3d1d6129f1d18f6f4af082f167","reader/british-interiors/41-60/index.html":"304891c66911bc9f36c49d17b7d52a1e60a5a004","reader/british-interiors/61-80/index.html":"4d93c9745c4c8376e44bd65c3616f6a9a08d9c36","reader/british-interiors/81-82/index.html":"c2708303e3a2ed90bf84c3477c437a0f8eb5b9ca","reader/british-interiors/check/index.html":"cbeb9006e21b202591ead85c1425a7381e8e9ac9","reader/british-interiors/full/index.html":"d45b42aa6c9f85cd6052f6497f4d0fc4989fed5d","reader/british-interiors/open-01-20/index.html":"93fecbb692da98e4b6f701184cbd2b581a8ce3cd","reader/castle/001-020/index.html":"91ac1a7f3d63b95db02df183e7e94faa052dfd3e","reader/furniture/01-20/index.html":"3e666987f7bb7cf0a323201bf0ae447e2357f3f3","reader/furniture/101-120/index.html":"ab9239d3afa1ea12778aa01ad4fdb0974df6ed20","reader/furniture/21-40/index.html":"56d07a2fac428607a2c7ed0d5ce3c8d596757cd1","reader/furniture/41-60-recovery/index.html":"db0dd58082b789a960aa940728862aa222ac9cad","reader/furniture/41-60/index.html":"66dfc15a58bd517ad413f6782a601dfc44c0d4fa","reader/furniture/61-80/index.html":"da30423bf0dcee8a72b3f43211b777273edcb436","reader/furniture/81-100/index.html":"aa7bb78ef0dc3961144caf201a50c82e56a77be3","reader/library/index.html":"9a3f887ab6a988fd98c3a20c6182790ee7c2cfd5","reader/library/read.html":"b21d574f6f55134736bb3d699043e98899e17c2a","reader/wh1/11-30/index.html":"7abc623e8403feadf5a12197497779dd31fd6f35","reader/wh1/111-130/index.html":"521a99d8f4d516e36408bda9549826362d2b2305","reader/wh1/131-150/index.html":"e21cb2ffc1eb4c406723f435a3287d7d163dca51","reader/wh1/151-170/index.html":"09aeb2c99101126f332b8e6f68c5c4fd6247cf4e","reader/wh1/171-190/index.html":"18a26d0c1a87ce31f1f1d1a4facb924ba9a13a20","reader/wh1/191-210/index.html":"2b55044a2eb5de56cac0863d45384ac7edc77010","reader/wh1/211-230/index.html":"a7c2debb50c61f43987ee14ce77119fd84461f18","reader/wh1/231-250/index.html":"0107685f3d4bf97edec81b3b94905695d23668b6","reader/wh1/251-274/index.html":"db1a06fa3aa2362fc3ee163750e9dd0fbd55e4cd","reader/wh1/31-50/index.html":"aaab0de73bc390fbd5dffb3c4d113b407a480163","reader/wh1/51-70/index.html":"75ab086dcf307e45988450e8edd2270512ed93b2","reader/wh1/71-90/index.html":"0f38e78cddf56b338cc817824022dfd16574442c","reader/wh1/91-110/index.html":"e6792311fc29a9a51e9e6a27dd6896a93d62ef26","reader/wh1/all/index.html":"6771e675621bf549d6e66cdd7f75d53d02f5adcb","reader/wh1/full/index.html":"9274b6a98bd4280c2bcec8968d87bd538a7b7309","reader/wh1/index.html":"c39404505d4af5d0ec08f3314729ac0dde271b7c","reader/wh2/001-020/index.html":"b9e43941d59e7117f2c3a4322551744358de6eb3","reader/wh2/021-040/index.html":"be5746f2b0e82461bc7a46a7f607a257ab9e7d59","reader/wh2/041-060/index.html":"727fad8c58a37641d68948c4be0a5285164b6a06","reader/wh2/061-080/index.html":"0e55bc5163aab1f33be4add4ed156961e30e8710","reader/wh2/081-100/index.html":"bb017d016128fb16350f605d539e975cc0d53fb3","reader/wh2/101-120/index.html":"e5aa981cd04a6d8f1a3d846c7dc68b97d70edd57","reader/wh2/121-140/index.html":"db61c8974a9de46b2f7f44458899d042e6543c75","reader/wh2/141-160/index.html":"776f188e9a4b21d844b51ddd2a4ec40e3f2e3ebb"};
// Only these independently pinned public loader bytes may add a bookshelf link.
// Existing OCR and original-image quality claims are NOT changed.
const BOOKSHELF_NAV_UI_BLOBS=Object.freeze({
 'reader/furniture/01-20/index.html':'8e3b3fea0cd67d64f8153f163628a0898186d86b',
 'reader/furniture/21-40/index.html':'04ab41fe54d2a7b0363ea2248a07e2f72cfe23f5',
 'reader/furniture/41-60/index.html':'2b1de6206aa96955878fe325d1ffbd889c965157',
 'reader/furniture/61-80/index.html':'66d992182b0b0c8adcf25004acb70e3ea01b17d4',
 'reader/furniture/81-100/index.html':'de367028d3280ea5df0ed0b27a8870ecc023e3c1',
 'reader/furniture/101-120/index.html':'ba2a8368c92648188cad613a958aae282af2335b',
 'reader/wh1/all/index.html':'4ef3d87b7ff68e1241cc233c49c56d305026cc3a',
 'reader/library/read.html':'88b1139241b1131a9cdc1fc1af0b181454ac26a3'
});
// Narrow, byte-exact admission for the independently reviewed bookshelf title-order UI.
const BOOKSHELF_TITLE_ORDER_INDEX_BLOBS=Object.freeze(['0b0362b78bd36762b725dcca458cf714af57653b','927aaa137c9c12c555c98a191413528984077a30','299fa919db5a07ad65be0de2f5464168691b5f90','7518756ad3378fdad4aad26e02a26ede1a05a1b0','6f8333db3e42489f1a89bb031bebed42001d8976','ef6bedffc87bfe7038121a19e43fb496c65837b8','206460fae3840f4aec53707ad6ef2afc9903d304','6a8ab86575d7a6b77eecd1450043d9e0b49daa00','5b19a109330eaf43f8cf0ea469297ae716618094','53a8097dff6490590949dee8d6fa33942443e6d9','5278def2a0ef742bfc416e6461fef5476ee4754c']);
const STAGES=new Set(['draft','ready_for_publication','completed','iphone_verified']);
const STATES=new Set(['not_run','passed','failed','needs_source_review','not_applicable']);
const NON_NA=new Set(['G1-01','G1-02','G2-05','G3-01','G4-03','G7-01','G7-02','G7-03','G7-04','G8-01','G8-02','G8-03','G8-04','G8-05','G8-07','G8-08']);
function allowed(p){return typeof p==='string'&&/^reader\/[A-Za-z0-9_./-]+$/.test(p)&&!p.includes('..');}
// Restore only the exact opted-in public input shell before validating the frozen legacy engine.
function priorNativeInputReader(data){
  if(blobSHA(data)==='86af1c58518dfcd31c8200f3829c750d78efc23d'){
    const previous=data.toString('utf8')
      .replace(/\/\/ BEGIN Presidents retained turn\n[\s\S]*?\/\/ END Presidents retained turn\n/,'')
      .replace(" if(show)showReaderNotice(message,warn,message.includes('保存が完了')||message.includes('保存済み')?9000:0);\n}\nfunction showReaderNotice(message,warn,duration){\n $('storageMessage').textContent=message;$('storageBanner').classList.toggle('warning',warn);$('storageBanner').hidden=false;\n clearTimeout(storageNoticeTimer);\n if(duration)storageNoticeTimer=setTimeout(()=>{$('storageBanner').hidden=true;},duration);\n"," if(show){$('storageMessage').textContent=message;$('storageBanner').classList.toggle('warning',warn);$('storageBanner').hidden=false;\n  if(storageNoticeTimer)clearTimeout(storageNoticeTimer);\n  if(message.includes('保存が完了')||message.includes('保存済み'))storageNoticeTimer=setTimeout(()=>{$('storageBanner').hidden=true;},9000);}\n")
      .replace("function showMenu(){if(!bookZip)return;cancelPresidentsTurn();$('menuOverlay').hidden=false;$('menuSummary').textContent=positionText();$('partChoice').value=String(bookZip.wh3Flow?manifest.segments.findIndex(x=>currentState.scan>=x.start&&currentState.scan<=x.end):Math.max(0,activeSegment));$('scanNumber').value=String(currentState.scan);}\n","function showMenu(){if(!bookZip)return;$('menuOverlay').hidden=false;$('menuSummary').textContent=positionText();$('partChoice').value=String(bookZip.wh3Flow?manifest.segments.findIndex(x=>currentState.scan>=x.start&&currentState.scan<=x.end):Math.max(0,activeSegment));$('scanNumber').value=String(currentState.scan);}\n")
      .replace(" if(!bookZip||index<0||index>=SEGMENTS.length)return;\n cancelPresidentsTurn();\n"," if(!bookZip||index<0||index>=SEGMENTS.length)return;\n")
      .replace("   if(manifest?.bookId==='us-presidents-south'&&usesPresidentsTemplate())rendered=presidentsPaneDocument(rendered,index,inputSession);\n","")
      .replace(" const token=loadToken;if(index!==activeSegment||!bookZip)return;\n"," const token=loadToken;if(index!==activeSegment||!bookZip)return;\n const s=SEGMENTS[index],assets=[];\n")
      .replace("  const assets=await segmentAssets(bookZip,SEGMENTS[index],()=>token===loadToken);\n  if(!assets)return;\n","  for(const [name,meta] of Object.entries(s.assets)) {\n   if(token!==loadToken)return;\n   const bytes=await bookZip.readBytes(meta.path);assets.push({name,mime:meta.mime,data:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)});\n  }\n  if(token!==loadToken)return;\n")
      .replace(" if(presidentsTurn&&(d.key!==presidentsTurn.oldKey||d.size!==presidentsTurn.size))cancelPresidentsTurn();\n","")
      .replace(" if(d.type==='presidentsTurn'&&d.session===inputSession&&usesPresidentsTemplate())turnPresidentsSection(d.direction,d.repeat);\n else if(d.type==='prepare')handlePrepare(d.segment);\n"," if(d.type==='prepare')handlePrepare(d.segment);\n")
      .replace("function issueChild(action,extra={}){if(action==='goto')cancelPresidentsTurn();if($('reader').contentWindow)$('reader').contentWindow.postMessage({wh1bridge:1,action,...extra},'*');}\n","function issueChild(action,extra={}){if($('reader').contentWindow)$('reader').contentWindow.postMessage({wh1bridge:1,action,...extra},'*');}\n")
      .replace("async function openOriginal(scan){\n cancelPresidentsTurn();\n","async function openOriginal(scan){\n");
    if(blobSHA(previous)!=='bf7d17add718dfb56f5968cf1985de7b23cd45fa')throw Error('PRESIDENTS_RETAINED_TURN_REVERSE_CHECK_FAILED');
    data=Buffer.from(previous);
  }
  if(blobSHA(data)==='bf7d17add718dfb56f5968cf1985de7b23cd45fa'){
    const previous=data.toString('utf8')
      .replace(/\/\/ BEGIN WH3 continuous scan layout[\s\S]*?\/\/ END WH3 continuous scan layout\n/,'')
      .replace("const i=Number($('partChoice').value),scan=manifest.segments[i].start;closeMenu();openSegment(bookZip.wh3Flow?segmentForScan(scan):i,{scan});","const i=Number($('partChoice').value);closeMenu();openSegment(i,{scan:SEGMENTS[i].start});")
      .replace("key:(bookZip?.wh3Flow?bookZip.wh3Flow.bookmark(activeSegment,d.key):d.key)||'',scan:resolveStateScan(d)","key:d.key||'',scan:resolveStateScan(d)")
      .replace("wh3FrameDocument(layout,text,{origin:location.origin,session:inputSession,segment:index,font:","wh3FrameDocument(layout,text,{origin:location.origin,session:inputSession,font:")
      .replace("const text=bookZip.wh3Flow?await bookZip.wh3Flow.archive(index,false):await bookZip.readText(s.part);if(token","const text=await bookZip.readText(s.part);if(token")
      .replace("String(bookZip.wh3Flow?manifest.segments.findIndex(x=>currentState.scan>=x.start&&currentState.scan<=x.end):Math.max(0,activeSegment));$('scanNumber')","String(Math.max(0,activeSegment));$('scanNumber')")
      .replace("function positionText(){const s=bookZip?.wh3Flow?manifest.segments.find(x=>currentState.scan>=x.start&&currentState.scan<=x.end):SEGMENTS[currentState.segment];","function positionText(){const s=SEGMENTS[currentState.segment];")
      .replace("  currentState=restorePosition();if(book.wh3Flow)currentState=book.wh3Flow.restore(currentState);","  currentState=restorePosition();")
      .replace("  if(m.bookId==='wh3'&&m.template_profile==='world_history_1')book.wh3Flow=await wh3ReadingFlow(book,m);\n  fillManifest(m,book.wh3Flow);bookZip=book;","  fillManifest(m);bookZip=book;")
      .replace("(p.segment<SEGMENTS.length||typeof manifest!=='undefined'&&manifest?.bookId==='wh3'&&p.segment<manifest.segments.length))return p","p.segment<SEGMENTS.length)return p")
      .replace("openSegment(flow?segmentForScan(heading.scan):i,flow?{scan:heading.scan,view:'text',heading:heading.text}:usesPresidentsTemplate()?{scan:heading.scan,heading:heading.text}:{scan:heading.scan});","openSegment(i,usesPresidentsTemplate()?{scan:heading.scan,heading:heading.text}:{scan:heading.scan});")
      .replace("for(let i=0;i<m.segments.length;i++){\n  const seg=m.segments[i],o=new Option","for(let i=0;i<SEGMENTS.length;i++){\n  const seg=SEGMENTS[i],o=new Option")
      .replace("...(flow?.sections||m.segments));","...m.segments);")
      .replace("function fillManifest(m,flow){","function fillManifest(m){")
      .replace("wh3FrameDocument(layout,archive,{origin:location.origin,session,segment:index,font:","wh3FrameDocument(layout,archive,{origin:location.origin,session,font:")
      .replace("  const [layout,archive]=await Promise.all([wh3Layout(),book.wh3Flow.archive(index,false)]);","  const segment=SEGMENTS[index];\n  const [layout,archive]=await Promise.all([wh3Layout(),book.readText(segment.part)]);")
      .replace("await job.book.wh3Flow.archive(i,true)","await job.book.readText(SEGMENTS[i].part)")
      .replace("font:job.font,origin:location.origin,session,segment:index,measureOnly:true","font:job.font,origin:location.origin,session,measureOnly:true")
      .replace("manifest.segments.map(s=>s.sha256||s.part).join('.')","SEGMENTS.map(s=>s.sha256||s.part).join('.')")
      .replace("wh1-continuous-20261122-6","wh1-heading-start-20261122-5");
    if(blobSHA(previous)!=='eeae4d967c814e87fe40a82551e6c74f397f9bae')throw Error('WH3_CONTINUOUS_REVERSE_CHECK_FAILED');
    data=Buffer.from(previous);
  }
  if(blobSHA(data)==='eeae4d967c814e87fe40a82551e6c74f397f9bae'){
    const previous=data.toString('utf8')
      .replace("wh1-heading-start-20261122-5","wh1-figure-paint-20261122-4")
      .replace("   if(url.searchParams.get('view')==='figure')destination.view='figure';\n   const heading=url.searchParams.get('heading');\n   if(url.searchParams.get('view')==='text'&&heading){destination.view='text';destination.heading=heading.slice(0,240);}","   if(url.searchParams.get('view')==='figure')destination.view='figure';")
      .replace("url.searchParams.delete('scan');url.searchParams.delete('view');url.searchParams.delete('heading');","url.searchParams.delete('scan');url.searchParams.delete('view');");
    if(blobSHA(previous)!=='dc74f97fd4f0df6a75ca81da352551f317fe84c7')throw Error('WH3_HEADING_PAGE_REVERSE_CHECK_FAILED');
    data=Buffer.from(previous);
  }
  if(blobSHA(data)==='dc74f97fd4f0df6a75ca81da352551f317fe84c7'){
    const previous=data.toString('utf8')
      .replace(" async readText(path){return this.readingFlow?.byPath.get(path)??new TextDecoder().decode(await this.readBytes(path));}\n"," async readText(path){return new TextDecoder().decode(await this.readBytes(path));}\n")
      .replace("  if(m.bookId==='us-presidents-south'&&window.WH1ExactPager?.continuousReading){\n   book.readingFlow=await window.WH1ExactPager.continuousReading(book,m);\n  }\n","")
      .replace(" if(bookZip.readingFlow)({index,destination}=bookZip.readingFlow.locate(index,destination));\n","")
      .replace("  if(target===activeSegment&&!bookZip.readingFlow)issueChild('goto',{destination});\n","  if(target===activeSegment)issueChild('goto',{destination});\n");
    if(blobSHA(previous)!=='847f84ef2b71c1d05656dd27c90a0fcd6b1bae1a')throw Error('PRESIDENTS_WORD_FLOW_REVERSE_CHECK_FAILED');
    data=Buffer.from(previous);
  }
  if(blobSHA(data)==='847f84ef2b71c1d05656dd27c90a0fcd6b1bae1a'){
    const previous=data.toString('utf8')
      .replace("const wh3LayoutVersion='wh1-figure-paint-20261122-4';","const wh3LayoutVersion='wh1-aside-20261122-3';")
      .replace(/\/\/ BEGIN WH3 retained turn[\s\S]*?\/\/ END WH3 retained turn\n/,'')
      .replace(" else if(d.type==='boundary'){\n  const next=activeSegment+d.direction;\n  if(next>=0&&next<SEGMENTS.length){\n   const s=SEGMENTS[next];\n   if(usesWh3StandardInput()&&!Object.keys(s.assets).length)turnWh3Section(next,d.direction);\n   else openSegment(next,d.direction<0?{mode:'last'}:{mode:'first',scan:s.start});\n  }\n }"," else if(d.type==='boundary'){const next=activeSegment+d.direction;if(next>=0&&next<SEGMENTS.length){const s=SEGMENTS[next];openSegment(next,d.direction<0?{mode:'last'}:{mode:'first',scan:s.start});}}");
    if(blobSHA(previous)!=='651d9926850a7ad7508c376f1e42651aa2b5c33f')throw Error('WH3_FIGURE_PAINT_REVERSE_CHECK_FAILED');
    data=Buffer.from(previous);
  }
  // Restore the exact shared host before resource- and title-specific routing was added.
  if(blobSHA(data)==="651d9926850a7ad7508c376f1e42651aa2b5c33f"){
    const prior=data.toString('utf8')
      .replace("function usesPresidentsTemplate(){\n return BOOK_ID==='us-presidents-south'&&manifest?.bookId===BOOK_ID&&manifest.template_profile==='world_history_1'&&manifest.canonicalTemplate==='wh1-0011-0030';\n}\n","")
      .replace(" if(usesPresidentsTemplate()){\n  $('reader').title=bookTitle+'｜全'+totalScans+'枚読書';\n  $('originalOverlay').style.paddingTop=$('bookshelfNav').getBoundingClientRect().height+'px';\n }\n","")
      .replace("   btn.onclick=()=>{closeMenu();openSegment(i,usesPresidentsTemplate()?{scan:heading.scan,heading:heading.text}:{scan:heading.scan});};toc.append(btn);\n","   btn.onclick=()=>{closeMenu();openSegment(i,{scan:heading.scan});};toc.append(btn);\n")
      .replace(" if(BOOK_ID==='wh1'||usesPresidentsTemplate()||/wh2-parent-viewport-receiver-v6|wh2-wh1-parity-ui/.test(html))return html;\n"," if(BOOK_ID==='wh1'||/wh2-parent-viewport-receiver-v6|wh2-wh1-parity-ui/.test(html))return html;\n")
      .replace(" getManifest:()=>manifest,getActiveSegment:()=>activeSegment,getScan:()=>currentState.scan,\n useExactPagination:usesPresidentsTemplate\n"," getManifest:()=>manifest,getActiveSegment:()=>activeSegment,getScan:()=>currentState.scan\n")
      .replace("  if((usesWh3StandardInput()||usesPresidentsTemplate())&&typeof d.heading==='string')destination.heading=d.heading.slice(0,240);\n","  if(usesWh3StandardInput()&&typeof d.heading==='string')destination.heading=d.heading.slice(0,240);\n")
      .replace(" if(BOOK_ID==='us-presidents-south'&&location.pathname.endsWith('/read.html')){\n  const route=new URL('read-wh1-v9.html',location.href);\n  route.search=location.search;route.hash=location.hash;\n  location.replace(route);return;\n }\n","");
    if(blobSHA(prior)!=="b68d4c34ddf0d3dbaf1e6645336fba3983301a17")throw Error('WH1_BOOK_ROUTE_REVERSE_CHECK_FAILED');
    data=Buffer.from(prior);
  }
  data=priorShelfShell(data);
  let blob=blobSHA(data);
  if(['159505170aa3e8be559267505866a87fd79f543a','22069835a57b00724a0a481a734275ae0bf2cd38','b68d4c34ddf0d3dbaf1e6645336fba3983301a17'].includes(blob)){
    const prior=data.toString('utf8')
      .replace(/\/\/ BEGIN WH3 reference presentation[\s\S]*?\/\/ END WH3 reference presentation\n/,'')
      .replace(/  let rendered;\n  if\(usesWh3StandardInput\(\)&&text\.includes\([\s\S]*?  const content=new Blob\(\[rendered\],\{type:'text\/html'\}\);/,
        "  const decorated=window.WH1ExactPager?.decorate ? window.WH1ExactPager.decorate(text) : text;\n  const content=new Blob([attachStandardHost(decorateOtherBookReading(decorated))],{type:'text/html'});")
      .replace("  if(usesWh3StandardInput()&&typeof d.heading==='string')destination.heading=d.heading.slice(0,240);\n",'')
      .replace(" wh3UpdateState(d);\n",'')
      .replace(/  currentState=restorePosition\(\);\n  const requested=[\s\S]*?  \}else await openSegment\(currentState\.segment,\{key:currentState\.key,scan:currentState\.scan\}\);/,
        '  currentState=restorePosition();await openSegment(currentState.segment,{key:currentState.key,scan:currentState.scan});');
    data=Buffer.from(prior);blob=blobSHA(data);
    if(blob!=='f6ffac1ed438959e7a5c55d9916432e3f213a0e2')throw Error('WH3_LAYOUT_REVERSE_CHECK_FAILED');
    data=priorShelfShell(data);blob=blobSHA(data);
  }
  if(blob!=='f5551144e7f37d6f6587d71bd81694db75328cec'&&blob!=='c42490874b5e54dea08a524655d4f5632005e71d')return data;
    const prior=data.toString('utf8')
      .replace('attachStandardHost(decorateOtherBookReading(decorated))','decorateOtherBookReading(decorated)')
      .replace('html:not(.native-book-input),html:not(.native-book-input) body,html:not(.native-book-input) body *{touch-action:', 'html,body,body *{touch-action:')
      .replace(/let inputSession='',viewportSerial=0;[\s\S]*?(?=function fillManifest\(m\)\{)/,'')
      .replace(" document.documentElement.classList.toggle('native-book-input',nativeBookInput());\n",'')
      .replace("  inputSession=nativeBookInput()?crypto.randomUUID():'';\n  viewportSerial=0;\n",'')
      .replace('assets,size:currentState.size,session:inputSession','assets,size:currentState.size')
      .replace(/ if\(e\.source!==\$\('reader'\)\.contentWindow\|\|!e\.data\)return;\n if\(nativeBookInput\(\)[\s\S]*? if\(e\.data\.wh1bridge!==1\)return;/,
        " if(e.source!==$('reader').contentWindow||!e.data||e.data.wh1bridge!==1)return;")
      .replace(/ else if\(d\.type==='navigateScan'&&nativeBookInput\(\)[\s\S]*?\n \}\n(?= else if\(d\.type==='menu')/,'');
  if(blobSHA(prior)!=='b5a1ef12c9d19518212e5d14fceb43c1409d9a1a')throw Error('READER_INPUT_REVERSE_CHECK_FAILED');
  return Buffer.from(prior);
}
function blobSHA(bytes){const b=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);return crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');}

/* Exact public-only UI approval; already byte-pinned by release-control.
   Keep draft report, historical route identity and original scans unchanged.
   Any different byte, different book, modified engine or banned word guard fails. */
function approvedUKWh1GeometryUI(book,bytes){
 if(book?.entry!=='reader/british-interiors/full/index.html'||!Buffer.isBuffer(bytes))return false;
 bytes=priorShelfShell(bytes);
 if(blobSHA(bytes)!=='c6ece4949b885c81bfa4374e19f049b23825e6e0')return false;
 const html=bytes.toString('utf8');
 return html.includes('id="firstPageButton"')&&
  html.includes("sendWindow(1,{navigate:true,itemIndex:0,size:current.size})")&&
  html.includes("const TRUSTED_ENGINE_SHA256='580e233afe48319518b02c1a0c57446f68e339b4fb9c5db43c7a06c909b271ca'")&&
  html.includes('uk-wh1-text-geometry-20261115')&&
  html.includes('#reader-main .sheet,#measure-sheet{padding:10px 12px!important}')&&
  html.includes('#reader-main .segment,#measure-sheet .segment{padding:0!important}')&&
  html.includes('#reader-main .text-flow,#measure-sheet .text-flow{width:calc(100% - 30px)!important;padding:0!important}')&&
  html.includes('installUKContinuousParagraphFlow();')&&
  html.includes('installUKNearFullTextBoundary();')&&
  !html.includes('installUKColumnWordGuard()')&&!html.includes('uk-atomic-word');
}
function read(root,p,errors){if(!allowed(p)){errors.push('INVALID_PATH '+p);return null;}try{return JSON.parse(fs.readFileSync(path.join(root,p),'utf8'));}catch(e){errors.push('MISSING_OR_INVALID_JSON '+p+' '+e.message);return null;}}
function entryPaths(root){
 const out=[],start=path.join(root,'reader');if(!fs.existsSync(start))return out;
 function walk(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,d.name);
  if(d.isDirectory()){if(!d.name.startsWith('.'))walk(file);continue;}
  if(!d.isFile())continue;
  const rel=path.relative(root,file).split(path.sep).join('/');
  if(/^reader\/.*\/index\.html$/.test(rel)||rel==='reader/library/read.html')out.push(rel);
 }}walk(start);return out.sort();
}
function standardCheck(s,errors){
 if(!s||s.schema!=='reader-minimum-standard-v1'||s.canonicalGoogleDriveFileId!==ID){errors.push('WRONG_STANDARD');return;}
 const a=s.checkIds;
 if(!Array.isArray(a)||a.length!==60||new Set(a).size!==60||a.some((x,i)=>x!==RULES[i]))errors.push('CANONICAL_60_MISMATCH');
}
function reportCheck(book,rep,errors){
 const prefix='REPORT '+book.id+' ';
 if(!rep||rep.schema!=='reader-quality-report-v1'){errors.push(prefix+'missing');return;}
 if(rep.standardFileId!==ID||rep.bookId!==book.id||rep.entry!==book.entry||rep.stage!==book.stage)errors.push(prefix+'identity mismatch');
 if(book.stage!=='draft'){
  const a=rep.artifactAudit;
  if(!a||a.schema!=='reader-artifact-audit-v1'||a.structuralStatus!=='passed'||
     !/^[0-9a-f]{64}$/.test(a.sourceSha256||'')||a.originals!==rep.scanRange[1]-rep.scanRange[0]+1||
     (!Number.isInteger(a.OCRTextPages)||a.OCRTextPages<0||(a.OCRTextPages===0&&a.allConfirmedNoText!==true))||a.errors?.length)
   errors.push(prefix+'private HTML source audit missing/failed - run tools/reader-artifact-audit.cjs');
 }
 const checks=rep.checks;
 if(!checks||typeof checks!=='object'||Array.isArray(checks)){errors.push(prefix+'check map missing');return;}
 const real=Object.keys(checks).sort(),expected=RULES.slice().sort();
 if(real.length!==60||real.some((x,i)=>x!==expected[i])){errors.push(prefix+'requires all 60 distinct check IDs');return;}
 for(const id of RULES){
  const item=checks[id];if(!item||!STATES.has(item.status)){errors.push(prefix+id+' invalid status');continue;}
  if(item.status==='passed'){
   const p=item.proof;
   if(!p||typeof p.method!=='string'||p.method.trim().length<8||
      typeof p.evidenceRef!=='string'||p.evidenceRef.trim().length<8||
      !/^[0-9a-f]{64}$/.test(p.artifactSha256||'')||
      typeof p.verifiedBy!=='string'||p.verifiedBy.trim().length<2)
     errors.push(prefix+id+' passed without method/evidence/hash/reviewer');
  }
  if(item.status==='not_applicable'&&(NON_NA.has(id)||typeof item.reason!=='string'||
     item.reason.trim().length<12||typeof item.evidenceRef!=='string'||item.evidenceRef.trim().length<8))
    errors.push(prefix+id+' unsupported not_applicable');
  const required=book.stage!=='draft'&&!(book.stage==='ready_for_publication'&&['G8-03','G8-04'].includes(id))&&
    !(book.stage==='completed'&&id==='G8-04');
  if(required&&!['passed','not_applicable'].includes(item.status))
    errors.push(prefix+id+' not passed; cannot be '+book.stage);
 }
 if(book.stage==='draft'&&(rep.claimsCompleted===true||rep.deviceVerification==='passed'))
  errors.push(prefix+'draft cannot claim completion');
 if(book.stage==='iphone_verified'&&rep.deviceVerification!=='passed')
  errors.push(prefix+'real iPhone evidence missing');
 if(book.stage==='completed'&&rep.deviceVerification==='passed')
  errors.push(prefix+'device verification is a separate stage');
 if(!Array.isArray(rep.scanRange)||rep.scanRange.length!==2||!rep.scanRange.every(Number.isInteger)||rep.scanRange[0]<1||rep.scanRange[1]<rep.scanRange[0])
  errors.push(prefix+'invalid scan range');
}
function validate(root=ROOT){
 const errors=[],warnings=[],s=read(root,'reader/quality/standard.json',errors),r=read(root,'reader/quality/registry.json',errors);
 if(!s||!r)return {errors,warnings};
 standardCheck(s,errors);
 if(r.schema!=='reader-release-registry-v1'||r.canonicalGoogleDriveFileId!==ID)errors.push('INVALID_REGISTRY');
 const paths=entryPaths(root),seen=new Set(),legacy=r.legacyFrozenEntries||{},books=r.books||[];
 const liveKeys=Object.keys(legacy).sort(),frozenKeys=Object.keys(FROZEN_LEGACY).sort();
 if(liveKeys.length!==frozenKeys.length||liveKeys.some((p,i)=>p!==frozenKeys[i]||legacy[p]!==FROZEN_LEGACY[p]))
  errors.push('LEGACY_EXCEPTION_LIST_CHANGED: new historical exemptions cannot be invented; migrate book to a checked report');

 // Migrate a frozen route only with explicit verified original hash and complete
 // 60-item quality report; other frozen routes remain bitwise protected.
 for(const [p,sha] of Object.entries(legacy)){
  if(!allowed(p)||!/^[0-9a-f]{40}$/.test(sha)){errors.push('INVALID_LEGACY '+p);continue;}
  const migrated=Array.isArray(books)?books.find(b=>b?.entry===p):null;
  if(migrated){
    if(migrated.migratedFromFrozenBlobSha!==sha||typeof migrated.migrationReason!=='string'||migrated.migrationReason.trim().length<12)
      errors.push('UNVERIFIED_MIGRATION '+p+' - original blob SHA and reason required');
    // Managed route below must match its new blob SHA and provide all 60 statuses.
    continue;
  }
  if(seen.has(p))errors.push('DUPLICATE_ROUTE '+p);seen.add(p);
  if(!paths.includes(p)){errors.push('MISSING_LEGACY '+p);continue;}
  let data=priorShelfShell(fs.readFileSync(path.join(root,p)));
  if(p==='reader/library/read.html')data=priorNativeInputReader(data);
  const actual=blobSHA(data),expectedHref=p==='reader/library/read.html'?'./':'../../library/';
  const uiPinned=BOOKSHELF_NAV_UI_BLOBS[p]===actual&&
    data.includes(Buffer.from('id="bookshelfNav"'))&&
    data.includes(Buffer.from('id="backToBookshelf" href="'+expectedHref+'"'))&&
    data.includes(Buffer.from('id="bookshelf-nav-ui-v1"'));
  const titleSortPinned=p==='reader/library/index.html'&&
    BOOKSHELF_TITLE_ORDER_INDEX_BLOBS.includes(actual)&&
    (data.includes(Buffer.from('app.js?v=bookshelf-title-order-v2-20261114'))||
     data.includes(Buffer.from('app.js?v=bookshelf-uk-row22-20261115'))||
     data.includes(Buffer.from('app.js?v=bookshelf-uk-safe-bottom-v2-20261115'))||
     data.includes(Buffer.from('app.js?v=bookshelf-uk-column-fit24-20261115'))||
     data.includes(Buffer.from('app.js?v=bookshelf-uk-wordguard-20261115'))||
     data.includes(Buffer.from('app.js?v=bookshelf-uk-near-full-text-cut-v1-20261115'))||
     data.includes(Buffer.from('app.js?v=bookshelf-uk-wh1-text-geometry-v1-20261115'))||
     data.includes(Buffer.from('app.js?v=bookshelf-nine-stories-286-20261121'))||
     data.includes(Buffer.from('app.js?v=bookshelf-reader-input-20261121'))||
     data.includes(Buffer.from('app.js?v=bookshelf-device-save-20261121'))||
     data.includes(Buffer.from('app.js?v=bookshelf-registration-20261122')));
  // Admit only the exact 2026-11-15 public presentation layer for the shared shelf.
  // Inverse-transform its layout-only additions and verify the untouched
  // historical engine's original frozen Git blob byte-for-byte.
  let parityPinned=false;
  if(p==='reader/library/read.html'&&['f681ad2b69a35be8854cb905c0cee212c7e6be64','48efbe38606ec1591290264b7d81ca9704d296b4','b5a1ef12c9d19518212e5d14fceb43c1409d9a1a'].includes(actual)){
    const beforeSymbol=data.toString('utf8').replace(/\n \/\/ BEGIN symbol dictionary bookshelf layout[\s\S]*?\n \/\/ END symbol dictionary bookshelf layout/,'');
    if(actual==='b5a1ef12c9d19518212e5d14fceb43c1409d9a1a'&&blobSHA(Buffer.from(beforeSymbol))!=='48efbe38606ec1591290264b7d81ca9704d296b4')errors.push('SYMBOL_LAYOUT_REVERSE_CHECK_FAILED '+p);
    const prior=beforeSymbol.replace(/\n  \/\/ BEGIN verified standalone bookshelf edition[\s\S]*?\n  \/\/ END verified standalone bookshelf edition/,'');
    if(blobSHA(Buffer.from(prior))!=='f681ad2b69a35be8854cb905c0cee212c7e6be64')errors.push('STANDALONE_SHELF_REVERSE_CHECK_FAILED '+p);
    const original=prior
      .replace("\n // Furniture's imported reader has its own toolbar; keep this control on the public bookshelf host.\n $('goToBookStart').hidden=!/洋家具の歴史と様式/.test(bookTitle);",'')
      .replace(/\nfunction goToBookStart\(\)\{[\s\S]*?\n\}(?=\nwindow\.addEventListener\('message',e=>\{)/,'')
      .replace(" if(d.type==='bookStart'){goToBookStart();return;}",
        " if(d.type==='bookStart'){\n  closeMenu();\n  if(activeSegment===0)issueChild('goto',{destination:{mode:'first'}});\n  else openSegment(0,{mode:'first'}).catch(err=>console.warn('先頭への移動に失敗しました',err));\n  return;\n }")
      .replace("\n$('goToBookStart').addEventListener('click',goToBookStart);",'')
      .replace(/\n<style id="bookshelf-nav-ui-v1">[\s\S]*?<\/style>\n(?=<\/head>)/,'')
      .replace(/\n<nav id="bookshelfNav"[^>]*>[\s\S]*?<\/nav>(?=\n<iframe)/,'')
      .replace(/\n\/\/ non-wh-reading-parity-20261115:[\s\S]*?(?=async function openSegment\(index)/,'')
      .replace("  const decorated=window.WH1ExactPager?.decorate ? window.WH1ExactPager.decorate(text) : text;\n  const content=new Blob([decorateOtherBookReading(decorated)],{type:'text/html'});",
               "  const content=new Blob([window.WH1ExactPager?.decorate ? window.WH1ExactPager.decorate(text) : text],{type:'text/html'});")
      .replace(/\n<script id="wh2-unified-swipe-host-v1">[\s\S]*?<\/script>(?=\n<script>\n'use strict';)/,'');
    parityPinned=blobSHA(original)===sha;
    if(!parityPinned)errors.push('FURNITURE_START_REVERSE_CHECK_FAILED '+p);
  }
  if(actual!==sha&&!uiPinned&&!titleSortPinned&&!parityPinned)errors.push('LEGACY_CHANGED '+p+' - migrate to a checked report');
 }
 if(!Array.isArray(books))errors.push('INVALID_BOOKS');
 else for(const b of books){
  if(!b||!allowed(b.entry)||!STAGES.has(b.stage)||!/^[a-z0-9][a-z0-9-]{2,100}$/.test(b.id||'')){
   errors.push('INVALID_BOOK '+JSON.stringify(b||{}).slice(0,150));continue;
  }
  if(seen.has(b.entry))errors.push('DUPLICATE_ROUTE '+b.entry);seen.add(b.entry);
  if(!paths.includes(b.entry)){errors.push('MISSING_ENTRY '+b.entry);continue;}
  const bytes=fs.readFileSync(path.join(root,b.entry));
  // A separately reviewed UI-only change can retain the draft book's original
  // artifact/report identity. Pin the complete loader bytes; NEVER infer OCR
  // completion, admit any other edited book, or rewrite a source evidence record.
  // Admit only the two exact inspected public UK control revisions. Neither
  // receipt nor this UI-only exception asserts any OCR or device certification.
  const ukPublicBlob=blobSHA(bytes);
  const firstPageOnly=b.entry==='reader/british-interiors/full/index.html'&&
   ['eee384c86016ba0ce565ee473b7b8e25f2a6cc04','cb0f42dda95346f322e0dc9265ac5240e9a750c6','3f9ab866e5019df91e3cc4ac7132e8c1722465b5','04a86ee531bbcfbe13b10a3abb5263266fdafba9','357e144d616e1a0566028b74c6d6c19d79868c22'].includes(ukPublicBlob)&&
   bytes.includes(Buffer.from('id="firstPageButton"'))&&
   bytes.includes(Buffer.from('sendWindow(1,{navigate:true,itemIndex:0,size:current.size})'))&&
   bytes.includes(Buffer.from("const TRUSTED_ENGINE_SHA256='580e233afe48319518b02c1a0c57446f68e339b4fb9c5db43c7a06c909b271ca'"))&&
   (ukPublicBlob==='eee384c86016ba0ce565ee473b7b8e25f2a6cc04'||
    (bytes.includes(Buffer.from('id="uk-wh1-parity-20261115-v2"'))&&
     (ukPublicBlob==='cb0f42dda95346f322e0dc9265ac5240e9a750c6'
       ? bytes.includes(Buffer.from('uk-row22-20261115'))
       : (ukPublicBlob==='04a86ee531bbcfbe13b10a3abb5263266fdafba9'
          ? bytes.includes(Buffer.from('uk-column-fit24-20261115'))
          : (ukPublicBlob==='357e144d616e1a0566028b74c6d6c19d79868c22'
             ? (bytes.includes(Buffer.from('uk-column-fit24-20261115'))&&
                bytes.includes(Buffer.from('uk-column-word-guard-20261115')))
             : bytes.includes(Buffer.from('uk-vertical-safe-fit-20261115')))))));
  // This exact near-full UK UI is independently byte-pinned by release-control.
  // Legacy admission still keeps its original private engine and draft status.
  const nearFullTextPinned=b.entry==='reader/british-interiors/full/index.html'&&
   ukPublicBlob==='d70ff4ee3552dacb369a39d2eb7f444aa4d09079'&&
   bytes.includes(Buffer.from('id="firstPageButton"'))&&
   bytes.includes(Buffer.from("const TRUSTED_ENGINE_SHA256='580e233afe48319518b02c1a0c57446f68e339b4fb9c5db43c7a06c909b271ca'"))&&
   bytes.includes(Buffer.from('uk-column-fit24-20261115'))&&
   bytes.includes(Buffer.from('uk-continuous-paragraph-flow-v1'))&&
   bytes.includes(Buffer.from('installUKNearFullTextBoundary()'));
  const reviewedWH1Geometry=approvedUKWh1GeometryUI(b,bytes);
  if(blobSHA(bytes)!==b.entryBlobSha&&!firstPageOnly&&!nearFullTextPinned&&!reviewedWH1Geometry)
   errors.push('MANAGED_ENTRY_CHANGED '+b.entry+' - update report and route identity');
  if(b.url!=='https://pirokiiiiito-arch.github.io/flashcards/'+b.entry+'?import=1')
   errors.push('WRONG_IPHONE_WEB_URL '+b.id);
  const html=bytes.toString('utf8');
  const fileImport=/<input\b[^>]*type=["']file["']/i.test(html);
  const classicFrame=/<iframe\b/i.test(html);
  const trustedTopLevel=!classicFrame&&/\binstallTopLevelEngine\s*\(/.test(html)&&
    /TRUSTED_ENGINE_SHA256='[0-9a-f]{64}'/.test(html)&&/user-scalable=yes/.test(html);
  if(!fileImport||!(classicFrame||trustedTopLevel))errors.push('BAD_FILE_IMPORT_ENTRY '+b.entry);
  // Reject actual embedded private image payloads, not a harmless string literal
  // checking a data URL prefix. A real JPEG/PNG/WebP has far more than 64 base64 chars.
  if(/data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]{64,}/i.test(html))
   errors.push('PRIVATE_SOURCE_IN_PUBLIC_WEB '+b.entry);
  if(b.stage==='draft'&&!/制作中|校正中|校正継続|未校正|未完了|未確認/.test(html))
   errors.push('UNLABELLED_DRAFT '+b.entry);
  reportCheck(b,read(root,b.report,errors),errors);
 }
 for(const p of paths)if(!seen.has(p))errors.push('UNREGISTERED_READER '+p);
 const start=path.join(root,'reader');
 function privateScan(dir){for(const d of fs.readdirSync(dir,{withFileTypes:true})){const p=path.join(dir,d.name);
  if(d.isDirectory())privateScan(p);
  else if(d.isFile()&&/\.(?:zip|pdf|epub|jpe?g|webp|tiff?)$/i.test(d.name))
   errors.push('PRIVATE_BOOK_BINARY '+path.relative(root,p));
 }}if(fs.existsSync(start))privateScan(start);
 warnings.push('Frozen historical reader routes are NOT certified by this new quality system: '+Object.keys(legacy).length);
 warnings.push('GitHub CI cannot verify private OCR source or an actual iPhone; human/source evidence remains mandatory.');
 return {errors,warnings,legacy:Object.keys(legacy).length,managed:Array.isArray(books)?books.length:0,paths:paths.length};
}
if(require.main===module){
 const r=validate(ROOT);
 for(const x of r.warnings||[])console.log('NOTICE:',x);
 for(const x of r.errors||[])console.error('BLOCK:',x);
 if(r.errors&&r.errors.length)process.exitCode=1;
 else console.log('SCHEMA PASS ONLY (not OCR certification): '+r.paths+' routes, '+r.managed+' managed, '+r.legacy+' frozen legacy');
}
module.exports={priorNativeInputReader,validate,standardCheck,reportCheck,blobSHA,approvedUKWh1GeometryUI,entryPaths,RULES,ID};
