'use strict';
// Public-only template checks. This is not a book OCR certification or iPhone test.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..','templates','reader','v1');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const text=read('text.html'),image=read('image.html'),css=read('standard.css'),js=read('standard.js');
const data=html=>JSON.parse(html.match(/window\.READER_BOOK=(\{[\s\S]*?\});<\/script>/)?.[1]||'null');
test('two independent user-facing templates use the exact same shared CSS and script',()=>{
 assert.equal(data(text).kind,'text');assert.equal(data(image).kind,'image');
 for(const html of [text,image]){
  assert.match(html,/href="\.\/standard\.css"/);
  assert.match(html,/src="\.\/standard\.js"/);
  assert.match(html,/href="\.\.\/\.\.\/\.\.\/reader\/library\/"/);
  for(const id of ['sheet','measure-sheet','text-flow','measure-text','figure-stage',
    'measure-figure','figure-image','figure-caption','measure-caption','first','all',
    'original','smaller','larger','prev','next','page-major','page-minor','progress-fill']){
   assert.ok(html.includes('id="'+id+'"'),'missing '+id);
  }
 }
});
test('WH1 screenshot geometry and fixed top/bottom chrome are shared',()=>{
 assert.match(css,/--size:20px;--lh:1\.50;--one-column:30px/);
 assert.match(css,/padding:10px 12px/);
 assert.match(css,/width:calc\(100% - var\(--one-column\)\)/);
 assert.match(css,/writing-mode:vertical-rl/);
 assert.match(css,/\.measure-sheet/);
 assert.match(css,/\.reader-footer/);
 assert.match(css,/\.shelf-strip/);
});
test('image uses the original pixel source without canvas transformation, with fixed figure while captions advance',()=>{
 assert.match(css,/object-fit:contain/);
 assert.match(css,/\.figure-stage\.no-caption \.figure-frame/);
 assert.match(js,/URL\.createObjectURL\(file\)/);
 assert.match(js,/if\(p\.figure!==activeFigure\|\|activeSrc!==src\)/);
 assert.match(js,/caption\.textContent=p\.caption/);
 assert.doesNotMatch(js,/(?:canvas\.toDataURL|canvas\.toBlob|new OffscreenCanvas)/);
 assert.ok(data(image).figures.every(f=>f.src===null),'sample must not expose real books');
});
test('measured reflow and position persistence must not hardcode 22 characters',()=>{
 assert.match(js,/function syncMeasure\(\)/);
 assert.match(js,/function paginateText\(\)/);
 assert.match(js,/function paginateFigures\(\)/);
 assert.match(js,/localStorage\.setItem\(key/);
 assert.match(js,/getBoundingClientRect\(\)/);
 assert.match(js,/visualViewport/);
 assert.doesNotMatch(js,/(?:slice\(0,22\)|substring\(0,22\)|uk-atomic-word|installUKColumnWordGuard)/);
});
test('demo data contains only freshly written instructions, not embedded source scans',()=>{
 assert.ok(data(text).blocks.length>2);
 assert.doesNotMatch(text+image,/data:image\/(?:jpeg|png|webp);base64/);
 assert.doesNotMatch(text+image,/PRIVATE_ACCESS_TOKEN|GOOGLE_CLIENT_SECRET/);
});
test('both template scripts parse as JavaScript',()=>{
 assert.doesNotThrow(()=>new (require('node:vm').Script)(js));
});
