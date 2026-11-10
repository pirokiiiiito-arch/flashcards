'use strict';
const fs=require('node:fs');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const test=require('node:test');
const root=require('node:path').resolve(__dirname,'..');
const read=p=>fs.readFileSync(root+'/'+p,'utf8');
const base=read('reader/wh1/all/wh1-exact-pagination.js');
const fix=read('reader/wh1/all/wh1-figure-viewport-v8.js');
function context(){const c={window:{},console};vm.createContext(c);vm.runInContext(base,c);return c;}
test('new entry loads both current layout scripts before the application and keeps storage keys',()=>{
 const html=read('reader/wh1/all/index.html');
 assert.match(html,/wh1-exact-pagination\.js\?v=figure-viewport-v8-20261110/);
 assert.match(html,/wh1-figure-viewport-v8\.js\?v=figure-viewport-v8-20261110/);
 assert.ok(html.indexOf('wh1-figure-viewport-v8.js')<html.indexOf('const SEGMENTS='));
 assert.match(html,/wh1-unified-book/);assert.match(html,/WH1_UNIFIED_POSITION/);
 assert.equal(read('reader/wh1/all/figure-repair-v8.html'),html);
});
test('viewport change is scoped, repeat-safe and syntax-valid',()=>{
 const c=context(),before=c.window.WH1ExactPager.decorate;
 vm.runInContext(fix,c);
 const other='<html><head></head><body><script>const FIRST_SCAN=31; const LAST_SCAN=50;</script></body></html>';
 assert.equal(c.window.WH1ExactPager.decorate(other),before(other));
 const part='<html><head></head><body><script>const FIRST_SCAN=11; const LAST_SCAN=30;</script></body></html>';
 const html=c.window.WH1ExactPager.decorate(part);
 assert.match(html,/wh1-figure-viewport-v8-css/);
 const child=html.match(/<script id="wh1-figure-viewport-v8-script">([\s\S]*?)<\/script>/)[1];
 new vm.Script(child);
 assert.equal((c.window.WH1ExactPager.decorate(html).match(/id="wh1-figure-viewport-v8-css"/g)||[]).length,1);
 assert.doesNotMatch(fix,/indexedDB|fetch\(|localStorage\.removeItem|innerHTML\s*=/);
});
test('offscreen counter receives the same viewport repair without mutating book or manifest',async()=>{
 const c=context();let options;
 c.window.WH1ExactPager.create=value=>{options=value;return {test:true};};
 vm.runInContext(fix,c);
 const html='<html><head></head><body>const FIRST_SCAN=11; const LAST_SCAN=30;</body></html>';
 const book={blob:{size:123},readText:async()=>html};const manifest={created:'fixture'};
 const saved=book.readText;
 c.window.WH1ExactPager.create({getBook:()=>book,getManifest:()=>manifest});
 assert.match(await options.getBook().readText('part'),/wh1-figure-viewport-v8-css/);
 assert.equal(book.readText,saved);assert.equal(manifest.created,'fixture');
 assert.match(options.getManifest().created,/figure-viewport-v8/);
 assert.equal(options.getBook().blob,book.blob);
});
