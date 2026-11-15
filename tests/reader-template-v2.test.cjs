'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const root=path.resolve(__dirname,'..'),folder='templates/reader/';
const get=name=>fs.readFileSync(path.join(root,folder+name),'utf8');
const shaBlob=buf=>crypto.createHash('sha1').update(Buffer.from('blob '+buf.length+'\0')).update(buf).digest('hex');
const V1={
 'standard.js':'0df55eba25f332eafd82417c1e051affdcd3f786',
 'standard.css':'ce478640fc477b233ede0c2913ffdb09efd003cd',
 'text.html':'40e74d98b0f8efa535f43e2bd60a5c48d7686b80',
 'image.html':'ba55fa79fb6c1ddd62f86540b6f489e98f19676f'
};
test('v1 remains byte exact for existing reader links',()=>{
 for(const [name,expected] of Object.entries(V1)){
  const bytes=fs.readFileSync(path.join(root,folder+'v1/'+name));
  assert.equal(shaBlob(bytes),expected,name+' changed');
 }
});
test('v2 standalone engine parses and supports text, image and mixed in one stream',()=>{
 const js=get('v2/standard.js');new vm.Script(js,{filename:'standard.js'});
 assert.match(js,/\['text','image','mixed'\]/);
 assert.match(js,/function paginateAll\(/);
 assert.match(js,/function paginateBlocks\(/);
 assert.match(js,/function paginateOneFigure\(/);
 assert.match(js,/flow\.push\(\{kind:'text'/);
 assert.match(js,/flow\.push\(\{kind:'image'/);
 assert.match(js,/p\.kind==='text'/);
 assert.match(js,/p\.kind==='image'/);
 assert.match(js,/standard-reader-v2:/);
});
test('v2 uses actual rendered vertical glyph ranges as well as scroll metrics',()=>{
 const css=get('v2/standard.css'),js=get('v2/standard.js');
 assert.match(js,/createTreeWalker\(el,NodeFilter\.SHOW_TEXT\)/);
 assert.match(js,/range\.getClientRects\(\)/);
 assert.match(js,/r\.bottom>bottom\+\.5/);
 assert.match(js,/scrollHeight>el\.clientHeight\+1/);
 assert.match(css,/--bottom-safe:max\(16px, calc\(var\(--size\) \* 1\.2\)\)/);
 assert.match(css,/padding:10px 12px var\(--bottom-safe\)/);
 assert.match(css,/@media\(max-height:620px\)\{\.sheet\{padding:6px 9px var\(--bottom-safe\)/);
 assert.match(css,/padding-bottom:var\(--caption-bottom-safe\)/);
 assert.match(css,/\.measure-sheet\{/);
 assert.doesNotMatch(css,/body \*\{touch-action:.*!important/);
});
test('v2 authenticates parent viewport scale and never pretends iframe local scale is host scale',()=>{
 const js=get('v2/standard.js'),css=get('v2/standard.css');
 assert.match(js,/e\.source!==parent\|\|e\.origin!==host\.origin/);
 assert.match(js,/m\.session!==host\.session/);
 assert.match(js,/m\.seq<=hostSeq/);
 assert.match(js,/reader-viewport-v8/);
 assert.match(js,/reader-ready-v8/);
 assert.match(js,/!hostKnown/);
 assert.match(js,/reader-position-v1/);
 assert.match(js,/reader-back-to-shelf-v1/);
 assert.match(js,/main\.addEventListener\('touchmove'/);
 assert.match(js,/touchcancel/);
 assert.match(css,/body\.zoomed \.reader-main\{touch-action:pan-x pan-y pinch-zoom\}/);
 assert.match(css,/\.reader-main\{[^\n]*touch-action:pan-x pinch-zoom\}/);
 assert.doesNotMatch(js,/transform\s*=\s*['"]scale\(/);
});
test('both v2 demos and mixed sample use the same exact UI and no private book material',()=>{
 const expected=['shelf-return','original','first','all','smaller','larger','prev','next','progress-fill'];
 for(const file of ['text.html','image.html','mixed.html']){
  const html=get('v2/'+file);
  assert.match(html,/<link rel="stylesheet" href="\.\/standard\.css">/);
  assert.match(html,/<script src="\.\/standard\.js"><\/script>/);
  for(const id of ['sheet','measure-sheet','text-flow','figure-stage','figure-image','menu-items','page-major','page-minor'])
   assert.ok(html.includes('id="'+id+'"'),file+' missing '+id);
  assert.doesNotMatch(html,/data:image\/(?:png|jpeg|webp);base64,[a-zA-Z0-9+/]{40}/);
  assert.ok(html.includes('user-scalable=yes'),file+' must allow native pinch');
  const raw=html.match(/<script>window\.READER_BOOK=(\{[\s\S]*?\});<\/script>/);
  assert.ok(raw,file+' must expose only demonstrative book data');
  const book=JSON.parse(raw[1]);
  assert.ok(book.id.includes('demo'));
  if(file==='mixed.html'){
   assert.equal(book.kind,'mixed');assert.ok(book.entries.some(e=>e.kind==='text'));
   assert.ok(book.entries.some(e=>e.kind==='image'));
   assert.ok(book.entries.every(e=>e.kind!=='image'||e.src===null));
  }
 }
 const index=get('v2/index.html');
 for(const href of ['text.html','image.html','mixed.html'])assert.ok(index.includes('href="./'+href+'"'));
});
