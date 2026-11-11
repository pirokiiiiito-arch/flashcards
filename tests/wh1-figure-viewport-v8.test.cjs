'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const test=require('node:test');
const {createHash}=require('node:crypto');
const root=require('node:path').resolve(__dirname,'..');
const read=p=>fs.readFileSync(root+'/'+p,'utf8');
const base=read('reader/wh1/all/wh1-exact-pagination.js');
const fix=read('reader/wh1/all/wh1-figure-viewport-v9.js');
function context(){const c={window:{},console};vm.createContext(c);vm.runInContext(base,c);return c;}
test('new entry loads both current layout scripts before the application and keeps storage keys',()=>{
 const html=read('reader/wh1/all/index.html');
 const scripts=[...html.matchAll(/<script src="([^"]+)"/g)].map(match=>match[1]);
 assert.deepEqual(scripts,[
  './wh1-exact-pagination.js?v=figure-viewport-v9-20261110',
  './wh1-figure-viewport-v9.js?v=figure-viewport-v9-20261110'
 ]);
 assert.ok(html.indexOf('wh1-figure-viewport-v9.js')<html.indexOf('const SEGMENTS='));
 assert.match(html,/wh1-unified-book/);assert.match(html,/WH1_UNIFIED_POSITION/);
 assert.match(html,/updateViaCache:'none'/);
 assert.equal(read('reader/wh1/all/figure-repair-v9.html'),html);
 assert.equal(read('reader/wh1/all/figure-repair-v8.html'),html);
 const report=JSON.parse(read('reader/wh1/all/figure-repair-v9-build.json'));
 assert.equal(report.revision,'figure-viewport-v9-20261110');
 assert.equal(report.entry,'figure-repair-v9.html');
 assert.equal(report.index_sha256,createHash('sha256').update(html).digest('hex'));
 assert.equal(report.private_book_modified,false);
 assert.deepEqual(JSON.parse(read('reader/wh1/all/figure-repair-v8-build.json')),report);
});
test('viewport change is scoped, repeat-safe and syntax-valid',()=>{
 const c=context(),before=c.window.WH1ExactPager.decorate;
 vm.runInContext(fix,c);
 const other='<html><head></head><body><script>const FIRST_SCAN=31; const LAST_SCAN=50;</script></body></html>';
 assert.equal(c.window.WH1ExactPager.decorate(other),before(other));
 const part='<html><head></head><body><script>const FIRST_SCAN=11; const LAST_SCAN=30;</script></body></html>';
 const html=c.window.WH1ExactPager.decorate(part);
 assert.match(html,/wh1-figure-viewport-v9-css/);
 const child=html.match(/<script id="wh1-figure-viewport-v9-script">([\s\S]*?)<\/script>/)[1];
 new vm.Script(child);
 assert.equal(c.window.WH1ExactPager.decorate(html),html);
 assert.doesNotMatch(fix,/indexedDB|fetch\(|localStorage\.removeItem|innerHTML\s*=/);
});
test('diagnostic entry adds a static marker and observer without changing the normal reader',()=>{
 const html=read('reader/wh1/all/index.html');
 const check=read('reader/wh1/all/figure-check-v9-1.html');
 const expected='<script src="./wh1-display-check-v9.js?revision=display-check-v9-1-20261110"></script>';
 // The approved reader now uses native browser viewport zoom of the entire page, not image-only scale.
 assert.match(html,/<style id="browser-page-pinch-v2">/);
 assert.match(html,/user-scalable=yes/);
 assert.doesNotMatch(html,/original-pinch-only-v1|__originalPinchOnly/);
 assert.doesNotMatch(html,/wh1-display-check|確認9\.1/);
 assert.equal(check.split(expected).length-1,1);
 assert.ok(check.indexOf('wh1-figure-viewport-v9.js')<check.indexOf(expected));
 assert.ok(check.indexOf(expected)<check.indexOf('const SEGMENTS='));
 assert.match(check,/<title>確認9\.1｜/);
 const marker=check.match(/\n<aside id="wh1-display-check-fallback"[^>]*>確認9\.1 · 確認待ち<\/aside>/);
 assert.ok(marker,'The static confirmation marker must survive a script-load failure');
 assert.ok(check.indexOf(marker[0])<check.indexOf('<iframe id="reader"'));
 assert.match(marker[0],/position:fixed/);
 assert.equal(check.replace('\n'+expected,'').replace('<title>確認9.1｜','<title>').replace(marker[0],''),html);
 assert.match(check,/indexedDB\.open\('wh1-unified-book',2\)/);
 assert.match(check,/localStorage\.getItem\('WH1_UNIFIED_POSITION'\)/);
});
test('offscreen counter receives the same viewport repair without mutating book or manifest',async()=>{
 const c=context();let options;
 c.window.WH1ExactPager.create=value=>{options=value;return {test:true};};
 vm.runInContext(fix,c);
 const html='<html><head></head><body>const FIRST_SCAN=11; const LAST_SCAN=30;</body></html>';
 const book={blob:{size:123},readText:async()=>html};const manifest={created:'fixture'};
 const saved=book.readText;
 c.window.WH1ExactPager.create({getBook:()=>book,getManifest:()=>manifest});
 assert.match(await options.getBook().readText('part'),/wh1-figure-viewport-v9-css/);
 assert.equal(book.readText,saved);assert.equal(manifest.created,'fixture');
 assert.match(options.getManifest().created,/figure-viewport-v9/);
 assert.equal(options.getBook().blob,book.blob);
});

test('worker installs current entries and offline fallback never selects an older shell',async()=>{
 const source=read('reader/wh1/all/sw.js');
 const scope='https://reader.example/flashcards/reader/wh1/all/';
 const handlers={};let installed=[],claimed=0,waiting=0,deleted=0,globalMatches=0;
 const currentCache={
  async addAll(requests){installed=Array.from(requests,request=>request.url);},
  async match(request){return new Response('current:'+String(request.url||request));},
  async put(){}
 };
 const c={URL,Request,Response,console,
  self:{registration:{scope},location:{origin:'https://reader.example'},
   addEventListener:(name,handler)=>{handlers[name]=handler;},
   skipWaiting:async()=>{waiting++;},clients:{claim:async()=>{claimed++;}}},
  caches:{open:async name=>{
   assert.equal(name,'wh1-unified-reader-shell-v13-display-check91');return currentCache;
  },delete:async()=>{deleted++;},match:async()=>{globalMatches++;return new Response('old shell');}},
  fetch:async()=>{throw Error('Offline fixture');}
 };
 vm.createContext(c);vm.runInContext(source,c);
 let install,activate;
 handlers.install({waitUntil:promise=>{install=promise;}});await install;
 handlers.activate({waitUntil:promise=>{activate=promise;}});await activate;
 assert.equal(waiting,1);assert.equal(claimed,1);assert.equal(deleted,0);
 assert.deepEqual(installed.map(url=>url.slice(scope.length)).sort(),[
  'apple-touch-icon.png','figure-repair-v8.html','figure-repair-v9.html','figure-check-v9-1.html','index.html',
  'manifest.webmanifest','wh1-exact-pagination.js?v=figure-viewport-v9-20261110',
  'wh1-figure-viewport-v9.js?v=figure-viewport-v9-20261110',
  'wh1-display-check-v9.js?revision=display-check-v9-1-20261110'
 ].sort());
 for(const [path,mode,fallback] of [
  ['', 'navigate', 'index.html'],
  ['figure-repair-v8.html', 'navigate', 'figure-repair-v9.html'],
  ['figure-check-v9-1.html?verify=latest', 'navigate', 'figure-check-v9-1.html'],
  ['wh1-exact-pagination.js?v=scan18-entire-caption-v6-20261109', 'cors', 'wh1-exact-pagination.js?v=figure-viewport-v9-20261110'],
  ['wh1-figure-viewport-v9.js?v=figure-viewport-v9-20261110', 'cors', 'wh1-figure-viewport-v9.js?v=figure-viewport-v9-20261110'],
  ['wh1-display-check-v9.js?revision=old-query', 'cors', 'wh1-display-check-v9.js?revision=display-check-v9-1-20261110']
 ]){
  let response;
  handlers.fetch({request:{url:scope+path,method:'GET',mode},respondWith:promise=>{response=promise;},waitUntil(){}});
  assert.equal(await (await response).text(),'current:'+scope+fallback);
 }
 assert.equal(globalMatches,0);
 assert.doesNotMatch(source,/indexedDB\.|localStorage\.(?:clear|removeItem)\(/);
});

