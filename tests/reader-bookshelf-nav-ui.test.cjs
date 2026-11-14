'use strict';
// Synthetic host-navigation tests only. Do not infer OCR or real-iPhone acceptance.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),os=require('node:os'),vm=require('node:vm');
const gate=require('../tools/reader-release-control.cjs');
const root=process.env.READER_AUDIT_ROOT||path.resolve(__dirname,'..');
const policy=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/release-policy.json')));
const registry=JSON.parse(fs.readFileSync(path.join(root,'reader/quality/registry.json')));
const paths=['01-20','21-40','41-60','61-80','81-100','101-120'].map(dir=>'reader/furniture/'+dir+'/index.html');
const blobSHA=text=>{const data=Buffer.from(text);return crypto.createHash('sha1').update('blob '+data.length+String.fromCharCode(0)).update(data).digest('hex');};
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
  const restored=html.replace(/\n<style id="bookshelf-nav-ui-v1">[\s\S]*?<\/style>\n(?=<\/head>)/,'')
    .replace(/\n<nav id="bookshelfNav"[^>]*>[\s\S]*?<\/nav>(?=\n<iframe)/,'');
  const originalReader=p==='reader/library/read.html'
    ?restored.replace(/\n<script id="wh2-unified-swipe-host-v1">[\s\S]*?<\/script>(?=\n<script>\n'use strict';)/,'')
    :restored;
  assert.equal(blobSHA(originalReader),registry.legacyFrozenEntries[p],'OCR/reader engine remains byte-identical to baseline');
 }
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
  document:{getElementById:id=>id==='reader'?{contentWindow:child}:null},
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
