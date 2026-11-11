'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const layout=require('../reader/world-symbols/001-020/reader-layout-v6.js');
const fixture=fs.readFileSync(path.join(__dirname,'fixtures/world-symbols-synthetic.html'),'utf8');
test('v6 increases text area without changing the private book or font',()=>{
 const out=layout.wrapHtml(fixture);
 const data=s=>s.match(/<script id="embedded-data" type="application\/json">([\s\S]*?)<\/script>/)[1];
 assert.equal(data(out),data(fixture));assert.equal(layout.wrapHtml(out),out);
 assert.match(out,/id="ws-layout-v6"/);assert.match(out,/max-height:100svh/);
 assert.match(out,/line-height:1\.50!important/);assert.match(out,/font-size:var\(--size\)!important/);
 assert.match(out,/readingHint\{display:none/);assert.match(out,/flex-wrap:nowrap/);
 assert.match(out,/height:12px/);
 // Synthetic fixture intentionally contains artificial image data. The layout
 // adapter must not add or alter those embedded bytes; the JSON equality above
 // is the privacy/integrity condition, not absence of images in the fixture.
 assert.doesNotMatch(layout.source,/data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]{64,}/);
 assert.doesNotThrow(()=>new vm.Script(layout.source));
});
test('loader actually loads and applies v6 after v5, with cache-busting',()=>{
 const shell=fs.readFileSync(path.join(__dirname,'../reader/world-symbols/001-020/index.html'),'utf8');
 assert.match(shell,/reader-layout-v6\.js\?v=20261112-v6-compact-height/);
 assert.match(shell,/WorldSymbolsLayoutV6\.wrapHtml\(gestureFixed\)/);
 assert.match(shell,/表示改善v6/);
});
