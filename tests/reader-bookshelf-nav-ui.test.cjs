'use strict';
// Synthetic host-navigation tests only. Do not infer OCR or real-iPhone acceptance.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os'),vm=require('node:vm');
const gate=require('../tools/reader-release-control.cjs');
const root=process.env.READER_AUDIT_ROOT||path.resolve(__dirname,'..');
const policy=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/release-policy.json')));
const registry=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/registry.json')));
const paths=['01-20','21-40','41-60','61-80','81-100','101-120'].map(dir=>'reader/furniture/'+dir+'/index.html');
const blobSHA=text=>{const data=Buffer.from(text);return crypto.createHash('sha1').update('blob '+data.length+String.fromCharCode(0)).update(data).digest('hex');};
test('a saved standalone book must match both its registered identity and its exact private HTML',async()=>{
 const html=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 const source=html.split('// BEGIN verified standalone bookshelf edition')[1].split('// END verified standalone bookshelf edition')[0];
 const fingerprint='f018635c4ad2c624c99250b66e19b84e597da1c48e5659f60f6ac9abc5bb34e3';
 const manifest={schema:1,format:'standalone-reader-html-v1',bookId:'nine-stories',entry:'reader.html',sha256:fingerprint};
 const check=(m,id='nine-stories')=>vm.runInNewContext('(async()=>{'+source+'})()',{
  m,BOOK_ID:id,file:new Blob(),shouldSave:false,crypto:crypto.webcrypto,
  LibraryDB:{isRegisteredRead:()=>false,authorizeFile:async()=>{throw Error('本棚に登録した版と一致しません')}},
  book:{readBytes:()=>Buffer.from('edited document')}
 });
 await assert.rejects(check(manifest),/本文ファイルが一致しません/);
 await assert.rejects(check({...manifest,entry:'other.html'}),/本棚に登録した/);
 await assert.rejects(check({...manifest,sha256:'0'.repeat(64)}),/本棚に登録した/);
 await assert.rejects(check(manifest,'wh1'),/本棚に登録した/);
});
test('only a verified WH1 editorial standalone book installs the whole-book page counter',async()=>{
 const host=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 const route=host.split('// BEGIN verified standalone bookshelf edition')[1].split('// END verified standalone bookshelf edition')[0];
 const markup='<p>Page fixture</p>',bytes=Buffer.from(markup);
 const base={schema:1,format:'standalone-reader-html-v1',bookId:'fixture',entry:'reader.html',range:[1,2],
  sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
 const editorial={format:'wh1-editorial-source-v1'},history={template_profile:'world_history_1'};
 async function open(overrides){
  const events=[];
  await vm.runInNewContext('(async()=>{'+route+'})()',{m:{...base,...overrides},BOOK_ID:base.bookId,
   file:new Blob([bytes]),shouldSave:false,crypto:crypto.webcrypto,TextDecoder,
   book:{readBytes:async()=>bytes},LibraryDB:{isRegisteredRead:()=>true},
   useEditorialWholeBookCounter:total=>events.push('counter:'+total),
   document:{open:()=>events.push('open'),write:html=>events.push(html),close:()=>events.push('close')}
  });
  return events;
 }
 for(const normal of [{},history,{...history,editorialEdition:editorial},{...history,readingFlow:editorial},
                      {template_profile:'novel',editorialEdition:editorial,readingFlow:editorial}]){
  assert.deepEqual(await open(normal),['open',markup,'close']);
 }
 assert.deepEqual(await open({...history,editorialEdition:editorial,readingFlow:editorial}),['open','counter:2',markup,'close']);
});
test('all six existing furniture host readers expose a persistent native bookshelf link',()=>{
 const approved=gate.admittedBookshelfNavUI(root,policy);
 assert.deepEqual(Object.keys(approved).filter(f=>paths.includes(f)).sort(),paths.slice().sort());
 for(const p of paths){
  const html=fs.readFileSync(path.join(root,p),'utf8');
  assert.match(html,/<nav id="bookshelfNav" aria-label="読書ナビゲーション">/);
  assert.match(html,/<a id="backToBookshelf" href="\.\.\/\.\.\/library\/">◀ 本棚へ<\/a>/);
  assert.match(html,/#reader\{top:calc\(44px \+ env\(safe-area-inset-top\)\);bottom:0;height:auto\}/);
  assert.ok(html.indexOf('id="bookshelfNav"')<html.indexOf('<iframe id="reader"'),'link is outside private reader iframe');
  assert.equal(new URL('../../library/','https://pirokiiiiito-arch.github.io/flashcards/'+p.replace('index.html','')).pathname,'/flashcards/reader/library/');
 }
});
test('the navigation-only edit leaves all original loader bytes intact when removed',()=>{
 for(const p of paths){
  const html=fs.readFileSync(path.join(root,p),'utf8');
  const restored=html.replace(/\n<style id="bookshelf-nav-ui-v1">[\s\S]*?<\/style>\n(?=<\/head>)/,'')
   .replace(/\n<nav id="bookshelfNav"[^>]*>[\s\S]*?<\/nav>(?=\n<iframe)/,'');
  assert.notEqual(restored,html,'UI-only patch is present: '+p);
  assert.equal(blobSHA(restored),registry.legacyFrozenEntries[p],'exact historical loader recovered: '+p);
 }
});
test('unapproved navigation/reader changes fail the byte-level publication admission',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'reader-bookshelf-nav-'));
 try{
  // A complete reader tree is required because byte-pinned shared hosts
  // are validated together with their deterministic Pages build artifacts.
  fs.cpSync(path.join(root,'reader'),path.join(tmp,'reader'),{recursive:true});
  const target=path.join(tmp,paths[0]);
  fs.appendFileSync(target,'\n<!-- unauthorized edit -->');
  assert.throws(()=>gate.admittedBookshelfNavUI(tmp,policy),/BOOKSHELF_NAV_UI_BYTES_NOT_REVIEWED/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('both shared WH1 and library hosts keep only a public return button',()=>{
 const hosts=[
  {path:'reader/wh1/all/index.html',href:'../../library/'},
  {path:'reader/library/read.html',href:'./'}
 ];
 const approved=gate.admittedBookshelfNavUI(root,policy);
 for(const {path:p,href} of hosts){
  const html=fs.readFileSync(path.join(root,p),'utf8');
  assert.match(html,/<nav id="bookshelfNav" aria-label="読書ナビゲーション">/);
  assert.ok(html.includes('id="backToBookshelf" href="'+href+'"'));
  assert.ok(html.indexOf('id="bookshelfNav"')<html.indexOf('<iframe id="reader"'));
  assert.equal(new URL(href,'https://pirokiiiiito-arch.github.io/flashcards/'+p.replace(/(?:index|read)\.html$/,'')).pathname,'/flashcards/reader/library/');
  assert.ok(approved[p]);
  const frozenInput=p==='reader/library/read.html'
    ?require('../tools/reader-quality-gate.cjs').priorNativeInputReader(Buffer.from(html)).toString('utf8'):require('../tools/reader-shelf-prior.cjs')(Buffer.from(html)).toString('utf8');
  if(p==='reader/library/read.html')assert.equal(blobSHA(frozenInput),'b5a1ef12c9d19518212e5d14fceb43c1409d9a1a');
  const restored=frozenInput.replace(/\n<style id="bookshelf-nav-ui-v1">[\s\S]*?<\/style>\n(?=<\/head>)/,'')
    .replace(/\n<nav id="bookshelfNav"[^>]*>[\s\S]*?<\/nav>(?=\n<iframe)/,'');
  // The 2026-11-15 mobile-layout addition is intentionally presentation-only.
  // Reverse it, then require the exact frozen engine bytes to match.
  const stripOtherBooksParity=text=>text
    .replace(/\n\/\/ non-wh-reading-parity-20261115:[\s\S]*?(?=async function openSegment\(index)/,'')
    .replace("  const decorated=window.WH1ExactPager?.decorate ? window.WH1ExactPager.decorate(text) : text;\n  const content=new Blob([decorateOtherBookReading(decorated)],{type:'text/html'});",
             "  const content=new Blob([window.WH1ExactPager?.decorate ? window.WH1ExactPager.decorate(text) : text],{type:'text/html'});");

  // Reverse only the public furniture start UI before checking the frozen reader bytes.
  const stripFurnitureStart=text=>text
    .replace("\n // Furniture's imported reader has its own toolbar; keep this control on the public bookshelf host.\n $('goToBookStart').hidden=!/洋家具の歴史と様式/.test(bookTitle);",'')
    .replace(/\nfunction goToBookStart\(\)\{[\s\S]*?\n\}(?=\nwindow\.addEventListener\('message',e=>\{)/,'')
    .replace(" if(d.type==='bookStart'){goToBookStart();return;}",
      " if(d.type==='bookStart'){\n  closeMenu();\n  if(activeSegment===0)issueChild('goto',{destination:{mode:'first'}});\n  else openSegment(0,{mode:'first'}).catch(err=>console.warn('先頭への移動に失敗しました',err));\n  return;\n }")
    .replace("\n$('goToBookStart').addEventListener('click',goToBookStart);",'');
  const beforeStandalone=restored.replace(/\n  \/\/ BEGIN verified standalone bookshelf edition[\s\S]*?\n  \/\/ END verified standalone bookshelf edition/,'');
  const originalReader=p==='reader/library/read.html'
    ?stripOtherBooksParity(stripFurnitureStart(beforeStandalone)).replace(/\n<script id="wh2-unified-swipe-host-v1">[\s\S]*?<\/script>(?=\n<script>\n'use strict';)/,'')
    :restored;
  assert.equal(blobSHA(originalReader),registry.legacyFrozenEntries[p],'OCR/reader engine remains byte-identical to baseline');
 }
});
test('native input opt-in restores the approved host and rejects changed bridge bytes',()=>{
 const original=fs.readFileSync(path.join(root,'reader/library/read.html'));
 const {priorNativeInputReader}=require('../tools/reader-quality-gate.cjs');
 assert.equal(blobSHA(priorNativeInputReader(original)),'b5a1ef12c9d19518212e5d14fceb43c1409d9a1a');
 const changed=Buffer.from(original.toString('utf8').replace('d.session===inputSession','true'));
 assert.notDeepEqual(changed,original);
 assert.deepEqual(priorNativeInputReader(changed),changed);
});
test('furniture book has a visible first-page control in the full-width bookshelf navigation',()=>{
 const html=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 assert.match(html, /<nav id="bookshelfNav"[^>]*>[\s\S]*?id="goToBookStart"[^>]*>最初へ<\/button>/);
 assert.match(html, /#bookshelfNav\{position:fixed;left:0;right:0;top:0;/);
 assert.match(html, /#goToBookStart\{margin-left:auto\}/);
 assert.match(html, /\$\('goToBookStart'\)\.hidden=!\/洋家具の歴史と様式\/\.test\(bookTitle\)/);
 assert.match(html, /\$\('goToBookStart'\)\.addEventListener\('click',goToBookStart\)/);
 assert.match(html, /if\(activeSegment===0\)issueChild\('goto',\{destination:\{mode:'first'\}\}\)/);
 assert.match(html, /else openSegment\(0,\{mode:'first'\}\)/);
});

test('generated bookshelf and WH1 HTML retain links with exact build reproduction',()=>{
 const approved=gate.admittedBookshelfNavUI(root,policy);
 const derivatives=['reader/wh1/all/figure-repair-v9.html','reader/wh1/all/figure-repair-v8.html',
  'reader/wh1/all/figure-check-v9-1.html','reader/wh1/all/figure-repair-v9-build.json',
  'reader/wh1/all/figure-repair-v8-build.json','reader/library/read-wh1-v9.html',
  'reader/library/wh1-library-v9-build.json'];
 for(const f of derivatives){
  const data=fs.readFileSync(path.join(root,f),'utf8');
  assert.ok(approved[f],'generated artifact hash is explicitly admitted: '+f);
  if(f.endsWith('.html'))assert.match(data,/id="backToBookshelf"/);
 }
});
test('an unreviewed generated WH1 artifact fails even if both source hosts are approved',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'reader-bookshelf-derived-'));
 try{
  fs.cpSync(path.join(root,'reader'),path.join(tmp,'reader'),{recursive:true});
  fs.appendFileSync(path.join(tmp,'reader/wh1/all/figure-check-v9-1.html'),'\n<!-- unsigned derived edit -->');
  assert.throws(()=>gate.admittedBookshelfNavUI(tmp,policy),/SHARED_SHELF_DERIVATIVE_NOT_REPRODUCIBLE/);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});

test('WH2 swipe-only enhancement gates one-finger page turns on authoritative parent zoom',()=>{
 const html=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 const script=html.match(/<script id="wh2-unified-swipe-host-v1">([\s\S]*?)<\/script>/)?.[1];
 assert.ok(script,'one self-contained public gesture bridge must exist');
 const events={},viewportEvents={},sent=[],child={postMessage:d=>sent.push(d)};
 const ctx={URLSearchParams,location:{search:'?id=g_private_drive_file'},
  document:{getElementById:id=>id==='reader'?{contentWindow:child}:null,querySelector:()=>null},
  window:{WH1ExactPager:{decorate:x=>x},
   visualViewport:{scale:1,addEventListener:(type,cb)=>{viewportEvents[type]=cb;}},
   addEventListener:(type,cb)=>{events[type]=cb;}}};
 vm.runInNewContext(script,ctx,{timeout:1000});
 const blocked="main.addEventListener(type,e=>e.stopImmediatePropagation(),{capture:true,passive:true});";
 const source='<script id="wh2-parent-viewport-receiver-v6">'+blocked+
  '<div id="notice">画面説明だけを除去</div><main id="main">本文そのもの</main>';
 const updated=ctx.window.WH1ExactPager.decorate(source);
 assert.ok(updated.includes('!wh2Host.known||wh2IsZoomed()'));
 assert.ok(!updated.includes(blocked));
 assert.doesNotMatch(updated,/<div id="notice">/,'beige notice ribbon disappears from the rendered book');
 const fullSource='<html><head></head><body>'+source+'<div class="original-status">隠す注意表示</div></body></html>';
 const styled=ctx.window.WH1ExactPager.decorate(fullSource);
 assert.match(styled, /id="wh2-wh1-parity-ui"/);
 assert.match(styled, /#notice,.original-status\{display:none!important\}/);
 assert.match(styled, /id="wh2-wh1-parity-bridge"/);
 assert.match(styled, /#wh2-wh1-progress-box/);
 assert.match(styled, /#wh2-wh1-font-control/,'WH1 font capsule is a single toolbar group');
 assert.ok(styled.includes('.controls #read-btn,.controls #compare-btn{display:none!important}'),'advanced views move into the whole-book menu');
 assert.match(styled, /\.reading\{padding:11px 12px 14px 9px!important\}/,'WH2 shares compact WH1-sized page insets');
 const measuredSource=fullSource.replace('</body>',
  "<script>$('measure-wrap').style.height=(Math.max(300,$('main').clientHeight-42))+'px';</script></body>");
 const revisedMeasurement=ctx.window.WH1ExactPager.decorate(measuredSource);
 assert.match(revisedMeasurement, /style.height=Math.max\(300,\$\('main'\).clientHeight\)/,
  'text pagination must use actual available reading height rather than retain 42px double inset');
 assert.ok(styled.includes('本文そのもの'),'reader content must remain untouched');
 assert.ok(updated.includes('<main id="main">本文そのもの</main>'),'reading content remains byte-identical');
 assert.equal(ctx.window.WH1ExactPager.decorate(source+blocked),source+blocked,
  'unexpected source layout must not silently enable gestures');
 events.message({source:child,data:{kind:'wh2-reader-ready-v1'}});
 assert.equal(sent.length,0,'unrecognized source must not get a viewport handshake');
 const otherBook='<div id="notice">他の本の案内</div><main>Unrelated reader with different touch controls</main>';
 assert.equal(ctx.window.WH1ExactPager.decorate(otherBook),otherBook,
  'other books remain unchanged even if the route ID differs');
 events.message({source:child,data:{kind:'wh2-reader-ready-v1'}});
 assert.equal(sent.length,0,'unrelated book must not receive WH2 zoom messages');
 assert.ok(ctx.window.WH1ExactPager.decorate(source).includes('!wh2Host.known||wh2IsZoomed()'),
  'returning to WH2 restores swipe handling based on ZIP contents');
 events.message({source:child,data:{kind:'wh2-reader-ready-v1'}});
 assert.equal(sent[0].kind,'wh2-host-viewport-v1');assert.equal(sent[0].scale,1);
 assert.ok(sent[0].session.length>=12);
 ctx.window.visualViewport.scale=2;
 viewportEvents.resize();
 assert.equal(sent.at(-1).scale,2,'zoomed viewport disables page-swipe capture');
 ctx.window.visualViewport.scale=1;
 viewportEvents.scroll();
 assert.equal(sent.at(-1).scale,1,'zoom reset can restore swiping');
});

test('existing Japanese bookshelf title order uses only three exact public UI files',()=>{
 const approved=gate.admittedBookshelfNavUI(root,policy);
 for(const f of ['reader/library/app.js','reader/library/index.html','reader/library/sw.js']){
  assert.ok(approved[f],'published title-order source must be explicitly admitted: '+f);
 }
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'bookshelf-sort-reject-'));
 try{
  fs.cpSync(path.join(root,'reader'),path.join(temp,'reader'),{recursive:true});
  fs.appendFileSync(path.join(temp,'reader/library/app.js'),'\\n// unauthorized app change');
  assert.throws(()=>gate.admittedBookshelfNavUI(temp,policy),/BOOKSHELF_SORT_UI_BYTES_NOT_REVIEWED/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('WH2 header and unified swipe remain exclusive to recognized private WH2 source',()=>{
 const html=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 assert.match(html, /wh2LayoutMode/,'menu switching keeps comparison and text views accessible');
 assert.match(html, /type:'original'/,'original uses the same source JPEG overlay affordance');
 assert.match(html, /wh2-wh1-font-control/,'top bar groups font controls like WH1');
 assert.match(html, /matchedMeasure/,'reader height is derived from the current page geometry');
});

test('symbol shelf layout is installed inside the hydrated segment before pagination',()=>{
 const host=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 const source=host.match(/function decorateOtherBookReading\(html\)\{[\s\S]*?\n\}(?=\n\nasync function openSegment)/)[0];
 const frame={},nav={append(node){this.output=node;}},events={};
 const document={getElementById:id=>id==='symbolSegmentStatus'?nav.output:null,createElement:()=>({style:{}})};
 const context={manifest:{bookId:'sekai-symbol-jiten-528-review'},loadToken:7,document,
  window:{addEventListener:(name,fn)=>{events[name]=fn;}},$:id=>id==='reader'?{contentWindow:frame}:nav};
 const decorate=vm.runInNewContext('('+source+')',context);
 const page='<html><head></head><body><nav class="shelf-strip"><a class="shelf-link">本棚へ</a></nav><p>テスト</p></body></html>';
 const open='<script type="application/json" id="segment-template">',close='</script>';
 const wrapper='<html><head></head><body>'+open+JSON.stringify(page).replace(/</g,'\\u003c')+close+'</body></html>';
 const result=decorate(wrapper),start=result.indexOf(open)+open.length;
 const rendered=JSON.parse(result.slice(start,result.indexOf(close,start)));
 assert.ok(rendered.includes('<style id="symbol-wh1-column-layout">'));
 assert.ok(rendered.includes('nav.shelf-strip,.toolbar .shelf-row'));
 assert.equal(rendered.slice(rendered.indexOf('</head>')),page.slice(page.indexOf('</head>')));
 assert.ok(!result.slice(0,start).includes('symbol-wh1-column-layout'));
 const status={kind:'symbol-reading-status',ticket:7,text:'確認'};
 events.message({source:{},data:status});events.message({source:frame,data:{...status,ticket:6}});
 assert.equal(nav.output.hidden,true);
 events.message({source:frame,data:status});
 assert.equal(nav.output.textContent,'確認');assert.equal(nav.output.hidden,false);
 context.manifest={bookId:'different'};context.BOOK_ID='wh1';
 assert.equal(decorate(wrapper),wrapper);
 assert.equal(nav.output.hidden,true);
});

test('a saved WH3 segment gets a host before its reader starts and only the current frame can request zoom',async()=>{
 const html=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 const viewport=html.slice(html.indexOf("let inputSession="),html.indexOf('function fillManifest'));
 const open=html.slice(html.indexOf('async function openSegment('),html.indexOf('async function handlePrepare'));
 const listenerStart=html.indexOf(" if(e.source!==$('reader').contentWindow||!e.data)return;");
 const listener=html.slice(listenerStart,html.indexOf(' if(e.data.wh1bridge!==1)return;',listenerStart));
 const messages=[],frame={contentWindow:{postMessage:m=>messages.push(m)}};
 const segment='<html><head></head><body><main id="reader-main"></main></body></html>';
 let blob;
 const origin='https://shelf.example',viewportAPI={scale:1,addEventListener(){}};
 const c=vm.createContext({
  manifest:{bookId:'wh3',template_profile:'world_history_1'},
  window:{visualViewport:viewportAPI,addEventListener(){}},location:{origin},
  $:()=>frame,SEGMENTS:[{start:1,end:20,part:'a'},{start:21,end:40,part:'b'}],
  bookZip:{readText:async()=>segment},loadToken:0,
  destinationForScan:d=>d,setBusy(){},decorateOtherBookReading:x=>x,
  Blob,crypto:crypto.webcrypto,URL:{createObjectURL:b=>{blob=b;return 'blob:test';},revokeObjectURL(){}}
 });
 vm.runInContext("let frameURL='',activeSegment=-1,pendingDest=null,pendingLoaded=false;\n"+
  viewport+open+'\nfunction message(e){'+listener+'}',c);
 async function boot(i){
  await c.openSegment(i);const doc=await blob.text(),script=doc.match(/<script>(window\.__readerHost=[\s\S]*?)<\/script>/);
  assert.ok(script && doc.indexOf(script[0])<doc.indexOf('</head>'),'standard JS reads the identity during startup');
  assert.match(doc,/body\.zoomed #reader-main\{overscroll-behavior:auto\}/);
  const win={};vm.runInNewContext(script[1],{window:win});return win.__readerHost;
 }
 const ready=(session,source=frame.contentWindow)=>c.message({source,data:{type:'reader-ready-v8',session}});
 const first=await boot(0);assert.equal(first.origin,origin);assert.ok(first.session);
 ready(first.session,{});ready('unknown');assert.equal(messages.length,0);
 ready(first.session);assert.equal(messages[0].scale,1);
 const second=await boot(1);assert.notEqual(second.session,first.session);
 ready(first.session);assert.equal(messages.length,1);
 viewportAPI.scale=2;ready(second.session);assert.equal(messages[1].session,second.session);assert.equal(messages[1].scale,2);
 for(const manifest of [{bookId:'other',template_profile:'world_history_1'},{bookId:'wh3',template_profile:'novel'},
                       {bookId:'castle',readerInteractions:'native-pinch-toc-v1'}]){
  c.manifest=manifest;await c.openSegment(0);assert.equal(await blob.text(),segment);
 }
});

// The deployment already exercises this suite for every bookshelf revision.
require('./reader-shelf-registration.test.cjs');

test('WH3 mounts the WH1 layout with the same private source in every section, including saved archives',()=>{
 const host=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 const template=fs.readFileSync(path.join(root,'reader/library/wh3-format.html'),'utf8');
 const mount=host.slice(host.indexOf('function wh3FrameDocument('),host.indexOf('async function wh3Layout('));
 const render=vm.runInNewContext(mount+'\nwh3FrameDocument');
 for(const token of ['<!--WH3_PRIVATE_STRUCTURE-->','<!--WH3_PRIVATE_DATA-->'])assert.equal(template.split(token).length,2);
 assert.doesNotMatch(template,/data:image\/jpeg;base64,/);
 function tag(id,value){return '<script type="application/json" id="'+id+'">'+JSON.stringify(value)+'</script>';}
 const original='data:image/jpeg;base64,AAAA';
 const title='書式を照合 $&';
 const structure=tag('reader-verified-structure',{normalized:'$&'});
 const book=tag('bookdata',{title,pages:[{original}]});
 const saved='<html>'+structure+book+'</html>',options={origin:'https://example.test',session:'rendering',font:22};
 const shown=render(template,saved,options);
 assert.ok(shown.includes(structure)&&shown.includes(book));
 assert.ok(shown.indexOf('window.__readerHost=')<shown.indexOf('const sourceBook=JSON.parse'));
 const measure=render(template,saved,{...options,measureOnly:true});
 assert.ok(measure.includes(tag('bookdata',{title,pages:[{original:''}]})));
 assert.ok(!measure.includes(original));assert.throws(()=>render(template,book,options));
 for(const selector of ['class="toolbar-line"','class="head-actions"','class="portrait-sheet"','class="toc-flow"','class="figure-bundle wh1-audited-figure"','class="text-flow"','class="footer-inner"']){
  assert.ok(shown.includes(selector),selector);
 }
 assert.match(shown,/\.text-flow p\{font-size:1em;[^}]*text-indent:1em/);
 assert.match(shown,/\.text-flow h2\{font-size:1\.12em;[^}]*margin:0 0 \.82em 0/);
 assert.ok(shown.includes("send('original',{scan:position()})"));
 assert.ok(shown.includes("type:'navigateScan'")&&shown.includes('heading:item.text'));
});

function retainedTurnFixture(){
 const html=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 const bridge=html.split('// BEGIN bookshelf retained turn\n')[1].split('// END bookshelf retained turn')[0];
 const listeners=new Map(),revoked=[],states=[],notices=[];
 class Pane{
  constructor(name){
   this.name=name;this.messages=[];this.style={cssText:'visible'};this.contentWindow={postMessage:d=>this.messages.push(d)};
  }
  cloneNode(){const pane=new Pane('candidate');this.candidate=pane;return pane;}
  removeAttribute(){} setAttribute(){} focus(){this.focused=true;}
  getBoundingClientRect(){return {left:0,top:40,width:390,height:630};}
  before(pane){this.behind=pane;}
  remove(){this.removed=true;}
 }
 const first=new Pane('active'),storageMessage={textContent:''},storageBanner={hidden:true};
 const win={
  addEventListener(type,fn){
   if(!listeners.has(type))listeners.set(type,new Set());
   listeners.get(type).add(fn);
  },
  removeEventListener(type,fn){
   const handlers=listeners.get(type);
   if(!handlers)return;
   handlers.delete(fn);
   if(!handlers.size)listeners.delete(type);
  }
 };
 const context=vm.createContext({
  window:win,
  document:{activeElement:first},crypto:crypto.webcrypto,Blob,setTimeout,clearTimeout,
  URL:{createObjectURL:()=>'blob:candidate',revokeObjectURL:id=>revoked.push(id)},
  bookZip:{readText:async()=>`<body><div id="reader-page"></div><strong id="location"></strong><script>function shiftPage(){} function showPage(){} const evt={type:'boundary'};</script></body>`,readBytes:async()=>new Uint8Array([3,5])},
  SEGMENTS:[{part:'a',assets:{}},{part:'b',assets:{image:{path:'p',mime:'image/jpeg'}}}],
  currentState:{size:20,key:'last'},loadToken:0,frameURL:'blob:previous',inputSession:'A',
  activeSegment:0,viewportSerial:0,pendingLoaded:true,pendingDest:null,totalScans:40,
  $:id=>({reader:first,storageMessage,storageBanner})[id],decorateOtherBookReading:x=>x,
  wh1ExactPager:{getStatus:()=>({counts:[72,80]})},syncReaderViewport(){},
  handleChildState:d=>states.push(d),showReaderNotice:text=>notices.push(text)
 });
 vm.runInContext(bridge,context);
 const flush=()=>new Promise(resolve=>setImmediate(resolve));
 async function send(pane,type,extra={}){
  const event={source:pane.contentWindow,data:{wh1bridge:1,segment:1,type,...extra}};
  for(const handler of Array.from(listeners.get('message')||[]))await handler(event);
 }
 return {context,first,send,flush,listeners,revoked,states,notices};
}

test('a Presidents section turn keeps the current page until the destination and global counter have painted',async()=>{
 const {context,first,send,flush,listeners,revoked,states,notices}=retainedTurnFixture();
 context.turnSection(1,false);await flush();
 const cancelled=first.behind;
 assert.equal(first.removed,undefined);
 context.turnSection(-1,true);
 assert.equal(cancelled.removed,true);
 assert.deepEqual(states,[]);
 assert.equal(first.messages.at(-1).action,'sectionResume');
 assert.equal(first.inert,false);

 context.turnSection(1,false);await flush();
 const next=first.behind;
 await send(cancelled,'prepare');
 assert.equal(next.messages.length,0,'discarded iframe cannot start an asset load');
 await send(next,'prepare');
 assert.equal(next.messages[0].action,'loadAssets');
 assert.deepEqual([...new Uint8Array(next.messages[0].assets[0].data)],[3,5]);
 const session=next.messages[0].session;
 await send(next,'state',{totalPages:80,pageIndex:0});
 assert.equal(next.messages.at(-1).action,'sectionTarget');
 await send(next,'sectionTarget',{session,key:'first',pageIndex:0,totalPages:80,size:20,scan:21});
 const [progress,paint]=next.messages.slice(-2);
 assert.equal(progress.label,'73 / 152');
 assert.equal(progress.scan,21);
 assert.equal(paint.action,'sectionPaint');
 assert.deepEqual(states,[]);
 await send(next,'sectionPainted',{session:'stale'});
 assert.equal(first.inert,false);
 context.turnSection(1,true);
 await send(next,'sectionPainted',{session});
 assert.equal(first.inert,false,'an in-flight gesture must keep receiving its native touch events');
 assert.equal(first.removed,undefined);
 assert.equal(first.messages.at(-1).action,'sectionSeal');
 await send(first,'sectionSealed',{segment:0,session:'stale'});
 assert.deepEqual(states,[]);
 await send(first,'sectionSealed',{segment:0,session:'A'});
 assert.equal(states[0].key,'first');
 assert.equal(first.removed,undefined,'an already-targeted touch stays attached until its end');
 await send(first,'sectionRetired',{session:'A',segment:0});
 assert.equal(first.removed,true);
 assert.equal(next.id,'reader');
 assert.equal(next.focused,true);
 assert.equal(next.messages.at(-1).action,'sectionResume');
 assert.deepEqual([...next.messages.at(-1).directions],[1]);
 assert.ok(revoked.includes('blob:previous'));
 assert.deepEqual(notices,[]);
 assert.equal(listeners.size,0);
});

function approachingBoundaryFixture(){
 const fixture=retainedTurnFixture(),{context}=fixture;
 const html=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 const update=vm.runInContext('('+html.slice(html.indexOf('function handleChildState('),html.indexOf('function goToBookStart('))+')',context);
 const reads=[],bookmarks=[];
 const timers=new Map();
 context.setTimeout=(fn,delay)=>{const id=Symbol();timers.set(id,{fn,delay});return id;};
 context.clearTimeout=id=>timers.delete(id);
 const idleCallbacks=new Set();
 context.window.requestIdleCallback=fn=>{idleCallbacks.add(fn);return fn;};
 context.window.cancelIdleCallback=fn=>idleCallbacks.delete(fn);
 async function idle(){
  for(const [id,{fn,delay}] of [...timers]){
   if(delay<=1000&&timers.delete(id))fn();
  }
  for(const fn of [...idleCallbacks])if(idleCallbacks.delete(fn))fn();
  await fixture.flush();
 }
 const lookup=context.$,summary={};
 context.$=id=>id==='menuSummary'?summary:lookup(id);
 context.wh1ExactPager=null;
 context.bookZip.wh3Flow={bookmark:(segment,key)=>key};
 context.wh3Layout=async()=>'layout';
 context.wh3DisplayArchive=async(_book,index)=>{reads.push(index);return 'source';};
 context.wh3FrameDocument=()=>'<body></body>';
 context.location={origin:'https://books.example'};
 context.wh3Counts={book:context.bookZip,key:'counts',width:390,height:630,font:20,counts:[72,80]};
 context.wh3UpdateState=()=>{};
 context.resolveStateScan=d=>d.scan;
 context.savePosition=()=>bookmarks.push({...context.currentState});
 context.clearBusy=()=>{};
 context.positionText=()=>'';
 const state=pageIndex=>({key:'page-'+pageIndex,scan:20,size:20,session:'A',pageIndex,pageCount:72});
 return {...fixture,idle,reads,bookmarks,report:update,show:pageIndex=>update(state(pageIndex))};
}

test('an approaching boundary prepares the next screen before input and turns without a second archive open',async()=>{
 const {context,first,send,flush,idle,states,notices,reads,bookmarks,report,show}=approachingBoundaryFixture();
 try{
  show(35);await idle();
  assert.equal(reads.length,0,'an ordinary mid-section page reserves no other document');
  show(70);await flush();
  assert.deepEqual(reads,[],'the current page has priority until reading is idle');
  await idle();
  assert.deepEqual(reads,[1],'the following section is read while the previous page is still visible');
  const next=first.behind;
  await send(next,'state',{pageCount:80,pageIndex:0});
  const {session}=next.messages.at(-1);
  await send(next,'sectionTarget',{session,key:'wh3v2.0',pageIndex:0,totalPages:80,size:20,scan:21});
  await send(next,'sectionPainted',{session});
  assert.ok(!next.focused && !first.removed);
  assert.ok(!first.messages.some(m=>m.action==='sectionSeal'),'preparation cannot consume an active touch');
  assert.deepEqual(states,[]);
  assert.equal(context.activeSegment,0);
  show(71);await flush();
  assert.equal(bookmarks.at(-1).key,'page-71','opening the hidden page cannot advance a bookmark');
  context.turnSection(1,false);await flush();
  assert.deepEqual(reads,[1],'the input handler reuses the already-painted destination');
  assert.equal(first.messages.at(-1).action,'sectionSeal');
  await send(first,'sectionSealed',{segment:0,session:'A'});
  assert.equal(context.activeSegment,1);
  assert.equal(next.id,'reader');
  assert.equal(states.at(-1).key,'wh3v2.0');
  await send(first,'sectionRetired',{segment:0,session:'A'});
  assert.ok(!first.removed,'the neighbouring page remains available for an immediate reverse');
  const lookup=context.$;
  context.$=id=>id==='reader'?next:lookup(id);
  report({key:'wh3v2.0',scan:21,size:20,session,pageIndex:0,pageCount:80});
  await flush();
  assert.equal(first.messages.at(-1).action,'sectionTarget');
  await send(first,'sectionTarget',{session:'A',segment:0,key:'page-71',pageIndex:71,totalPages:72,size:20,scan:20});
  await send(first,'sectionPainted',{session:'A',segment:0});
  context.turnSection(-1,false);await flush();
  await send(next,'sectionSealed',{segment:1,session});
  assert.equal(context.activeSegment,0);
  assert.equal(first.id,'reader');
  assert.equal(states.at(-1).key,'page-71');
  assert.deepEqual(reads,[1],'reversal does not re-read the section just left');
  await send(next,'sectionRetired',{segment:1,session});
  assert.deepEqual(notices,[]);
 }finally{context.cancelSectionTurn();}
});

test('input during preparation reuses the pending archive, and cannot reveal its unfinished page',async()=>{
 const {context,first,send,flush,idle,states,notices,show}=approachingBoundaryFixture();
 let opens=0,deliver;
 context.wh3DisplayArchive=()=>{opens++;return new Promise(resolve=>{deliver=resolve;});};
 try{
  show(71);await idle();
  assert.equal(opens,1);
  context.turnSection(1,false);await flush();
  assert.equal(opens,1);
  assert.equal(first.behind,undefined);
  assert.deepEqual(states,[]);
  deliver('source');await flush();
  const next=first.behind;
  await send(next,'state',{pageCount:80,pageIndex:0});
  const {session}=next.messages.at(-1);
  await send(next,'sectionTarget',{session,key:'wh3v2.0',pageIndex:0,totalPages:80,size:20,scan:21});
  assert.ok(!first.messages.some(m=>m.action==='sectionSeal'));
  await send(next,'sectionPainted',{session});
  assert.equal(first.messages.at(-1).action,'sectionSeal');
  assert.deepEqual(states,[]);
  assert.deepEqual(notices,[]);
 }finally{context.cancelSectionTurn();}
});

test('background preparation is discarded if the reader moves away, changes layout, or cannot open the section',async()=>{
 for(const leave of ['move','resize','font','error']){
  const {context,first,send,flush,idle,states,notices,listeners,report,show}=approachingBoundaryFixture();
  try{
   show(70);await idle();
   const candidate=first.behind;
   assert.ok(candidate);
   if(leave==='move')show(40);
   else if(leave==='resize'){
    first.getBoundingClientRect=()=>({left:0,top:40,width:390,height:550});
    for(const resize of [...(listeners.get('resize')||[])])resize();
   }else if(leave==='font'){
    report({key:'page-70',scan:20,size:24,session:'A',pageIndex:70,pageCount:72});
   }else{
    await send(candidate,'state',{pageCount:80,pageIndex:0});
    await send(candidate,'sectionError',{session:candidate.messages.at(-1).session});
   }
   await flush();
   assert.equal(candidate.removed,true);
   assert.equal(context.activeSegment,0);
   assert.deepEqual(states,[]);
   assert.deepEqual(notices,[]);
   assert.ok(!first.messages.some(m=>m.action==='sectionSeal'));
  }finally{context.cancelSectionTurn();}
 }
});

test('only the mounted target at the measured viewport can correct a stale structured page count',async()=>{
 for(const measuredHeight of [630,570]){
  const {context,first,send,flush,states,notices}=retainedTurnFixture();
  const stored=new Map();
  context.bookZip.wh3Flow={archive:async()=>''};
  context.wh3Layout=async()=>'';context.wh3DisplayArchive=async()=>'';context.wh3FrameDocument=()=>'<body></body>';
  context.location={origin:'https://books.example'};
  context.localStorage={setItem:(key,value)=>stored.set(key,value)};
  context.wh3Counts={book:context.bookZip,key:'stored-counts',width:390,height:measuredHeight,font:20,counts:[72,78]};
  try{
   context.turnSection(1,false);await flush();
   const next=first.behind;
   await send(next,'state',{pageCount:80,pageIndex:0});
   const {session}=next.messages.at(-1);
   const originals=[];context.sendSectionOriginal=event=>originals.push(event.data.scan);
   await send(first,'sectionOriginal',{session,scan:21});
   await send(next,'sectionOriginal',{session:'previous',scan:21});
   await send(next,'sectionOriginal',{session,segment:0,scan:21});
   assert.deepEqual(originals,[],'ignored messages must not look up an original');
   await send(next,'sectionOriginal',{session,scan:21});assert.deepEqual(originals,[21]);
   await send(next,'sectionTarget',{session,key:'wh3v2.0',pageIndex:0,totalPages:80,size:20,scan:21});
   if(measuredHeight===630){
    assert.equal(next.messages.at(-2).label,'73 / 152');
    assert.equal(next.messages.at(-1).action,'sectionPaint');
    assert.equal(stored.size,0,'the current page keeps its verified total during preparation');
    assert.equal(states.length,0);
    await send(next,'sectionPainted',{session});
    await send(first,'sectionSealed',{segment:0,session:'A'});
    assert.deepEqual(JSON.parse(stored.get('stored-counts')),[72,80]);
    assert.equal(states.length,1);
    assert.equal(notices.length,0);
   }else{
    assert.equal(stored.size,0,'a different viewport must not overwrite the count');
    assert.ok(next.removed);assert.equal(notices.length,1);
    assert.equal(states.length,0,'verification never swaps an unpainted target');
   }
   if(measuredHeight===630)await send(first,'sectionRetired',{segment:0,session:'A'});
  }finally{context.cancelSectionTurn();}
 }
});

test('Presidents controls share one ordered series of button, swipe and keyboard page turns',()=>{
 const html=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 const source=html.slice(html.indexOf('function sectionPaneBridge('),html.indexOf('function sectionPaneDocument('));
 const events=[],steps=[];
 let receive;
 const parent={postMessage:message=>events.push(message)},c=vm.createContext({
  window:{addEventListener:(_,fn)=>{receive=fn;}},parent,pages:[{},{},{}],currentPage:2,fontPx:20,
  shiftPage:direction=>steps.push(direction)
 });
 vm.runInContext(source+"\nsectionPaneBridge(0,'session',2);",c);
 c.shiftPage(1);c.shiftPage(-1);
 assert.deepEqual(events.map(d=>[d.direction,d.repeat]),[[1,false],[-1,true]]);
 assert.deepEqual(steps,[]);
 c.currentPage=1;
 receive({source:parent,data:{wh1bridge:1,action:'sectionResume',session:'wrong'}});
 c.shiftPage(-1);assert.deepEqual(steps,[]);
 receive({source:parent,data:{wh1bridge:1,action:'sectionResume',session:'session',directions:[-1,1]}});
 assert.deepEqual(steps,[-1,1]);
});

test('structured section targets wait for the painted SVG and counter even when decoding the mounted SVG rejects',async()=>{
 const html=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 const source=html.slice(html.indexOf('function sectionPaneBridge('),html.indexOf('function sectionPaneDocument('));
 const sent=[],parent={postMessage:d=>sent.push(d)},counter={dataset:{global:'4 / 6'}};
 let receive,index=0,paintPending=true;
 const box={width:32,height:42};
 const image={src:'blob:cropped-svg',hidden:false,complete:true,naturalWidth:32,naturalHeight:42,
  getBoundingClientRect:()=>box,decode:async()=>{throw Error('SVG loaded but a second decode is unavailable');}};
 const win={
  StandardReader:{inspect:()=>({pages:3,index,font:22,scan:31,originalReady:true,currentKind:'image',paintPending}),
   pageManifest:()=>[{start:0},{start:8},{start:12}],gotoPage:n=>{index=n;}},
  addEventListener:(_,fn)=>{receive=fn;}
 };
 const ctx={window:win,parent,requestAnimationFrame:cb=>setImmediate(cb),
  document:{fonts:{ready:Promise.resolve()},getElementById:id=>id==='figure-image'?image:counter}};
 vm.runInNewContext(source+"\nsectionPaneBridge(1,'S',3,true);",ctx);
 const command=(action,extra={})=>receive({source:parent,data:{wh1bridge:1,session:'S',action,...extra}});
 const wait=()=>new Promise(resolve=>setImmediate(resolve));
 const first=command('sectionTarget',{direction:-1});await wait();
 assert.equal(index,2);assert.deepEqual(sent,[]);
 paintPending=false;await first;
 const target=sent.at(-1);
 assert.equal(target.type,'sectionTarget');assert.equal(target.key,'wh3v2.12');
 assert.equal(target.scan,31);assert.equal(target.size,22);
 await command('sectionPaint',{...target,label:'6 / 6'});
 assert.equal(sent.at(-1).type,'sectionError','a stale counter cannot authorize installation');
 counter.dataset.global='6 / 6';
 await command('sectionPaint',{...target,label:'6 / 6'});
 assert.equal(sent.at(-1).type,'sectionPainted');
 assert.equal(win.shelfSectionBoundary(1),true);
 assert.equal(win.shelfSectionBoundary(-1),true);
 assert.deepEqual(sent.slice(-2).map(m=>[m.type,m.direction,m.repeat]),[['sectionTurn',1,false],['sectionTurn',-1,true]]);
 async function expectBrokenImage(){
  await command('sectionTarget',{direction:-1});assert.equal(sent.at(-1).type,'sectionError');
 }
 image.naturalWidth=0;await expectBrokenImage();image.naturalWidth=32;
 image.complete=false;await expectBrokenImage();image.complete=true;
 box.height=0;await expectBrokenImage();
});

test('unknown legacy archives keep their native loader while known WH1 controls opt in independently of book ID',()=>{
 const html=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 const source=html.slice(html.indexOf('function archiveHasPageControls('),html.indexOf('function sectionPaneBridge('));
 const identifies=vm.runInNewContext(source+'\narchiveHasPageControls');
 assert.equal(identifies('<body><script>parent.postMessage({type:"boundary"})</script></body>'),false);
 const pager='<strong id="location"></strong><div id="reader-page"></div><script>function shiftPage(n){showPage()} function showPage(){} const m={type:"boundary"};</script>';
 assert.equal(identifies(pager),true);
 assert.ok(html.includes('const supportsTurn=!!bookZip.wh3Flow||archiveHasPageControls(text);'));
 assert.ok(html.includes("if(d.type==='sectionTurn'&&inputSession&&d.session===inputSession)turnSection("));
});

test('a touch already down at the section boundary can finish on its original iframe',async()=>{
 const html=fs.readFileSync(path.join(root,'reader/library/read.html'),'utf8');
 const source=html.slice(html.indexOf('function sectionPaneBridge('),html.indexOf('function sectionPaneDocument('));
 const handlers={},events=[],parent={postMessage:event=>events.push(event)},steps=[];
 const win={StandardReader:{inspect:()=>({index:1,pages:2}),gotoPage:n=>steps.push(n)},
  addEventListener:(name,fn)=>{handlers[name]=fn;}};
 vm.runInNewContext(source+"\nsectionPaneBridge(0,'live',2,true);",{window:win,parent,setTimeout});
 const command=action=>handlers.message({source:parent,data:{wh1bridge:1,session:'live',action}});
 assert.equal(win.shelfSectionBoundary(1),true);
 handlers.touchstart({touches:[{}]});command('sectionSeal');
 assert.deepEqual(events.map(e=>e.type),['sectionTurn']);
 assert.equal(win.shelfSectionBoundary(-1),true);
 handlers.touchend({touches:[]});
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.deepEqual(events.map(e=>e.type),['sectionTurn','sectionTurn','sectionSealed']);
 handlers.pointerdown({pointerId:1});command('sectionRetire');
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.notEqual(events.at(-1).type,'sectionRetired');
 assert.equal(win.shelfSectionBoundary(-1),true);
 handlers.pointerup({pointerId:1});
 await new Promise(resolve=>setTimeout(resolve,10));
 assert.deepEqual(events.slice(-2).map(e=>e.type),['sectionLateStep','sectionRetired']);
 assert.deepEqual(steps,[]);
});

test('only the reviewed caption-ruby host and signed proofreading shelf assets are admitted',t=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'reader-source-proof-ui-'));
 t.after(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 fs.cpSync(path.join(root,'reader'),path.join(tmp,'reader'),{recursive:true});
 const accepted=gate.admittedBookshelfNavUI(tmp,policy);
 for(const [name,error] of [
  ['read.html',/SHARED_SHELF_UI_BYTES_NOT_REVIEWED/],
  ['app.js',/BOOKSHELF_SORT_UI_BYTES_NOT_REVIEWED/],
  ['sw.js',/BOOKSHELF_SORT_UI_BYTES_NOT_REVIEWED/],
  ['wh1-caption-ruby.js',/REGISTRATION_FILE_CHANGED/],
  ['storage.js',/REGISTRATION_FILE_CHANGED/],
  ['shelf-registration.mjs',/REGISTRATION_FILE_CHANGED/]
 ]){
  const relative='reader/library/'+name,target=path.join(tmp,relative);
  const original=fs.readFileSync(target);
  assert.ok(accepted[relative],relative);
  fs.appendFileSync(target,'\n/* unrelated change */');
  assert.throws(()=>gate.admittedBookshelfNavUI(tmp,policy),error);
  fs.writeFileSync(target,original);
 }
 const shelf=JSON.parse(fs.readFileSync(path.join(tmp,'reader/quality/shelf-registration.json')));
 shelf.editions[0].evidence.report='d'.repeat(64);
 fs.writeFileSync(path.join(tmp,'reader/quality/shelf-registration.json'),JSON.stringify(shelf));
 assert.throws(()=>gate.admittedBookshelfNavUI(tmp,policy));
});
