'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const patch=require('../reader/world-symbols/001-020/reader-repair-v1.js');
const html=fs.readFileSync(require('node:path').join(__dirname,'../reader/world-symbols/001-020/index.html'),'utf8');
test('mobile loader uses the in-memory repair without publishing private book bytes',()=>{
 assert.match(html,/reader-repair-v1\.js/);
 assert.match(html,/WorldSymbolsReaderRepair\.repair\(await blob\.text\(\)\)/);
 assert.doesNotMatch(html,/data:image\/(?:jpeg|png);base64,/);
});
test('blank or wrong source book is refused',()=>{
 assert.throws(()=>patch.inspect('<html></html>'),/原本データ/);
 const fake=Array.from({length:20},(_,i)=>({scan:i+1,dataUrl:'data:image/jpeg;base64,YQ==',blocks:i>2?[{kind:'body',text:'x'}]:[]}));
 const doc='<script id="embedded-data" type="application/json">'+JSON.stringify({bookId:'wrong',pages:fake})+'</script>';
 assert.throws(()=>patch.inspect(doc),/書籍ID|スキャン順/);
 fake.forEach(p=>p.dataUrl='');
 const emptyDoc='<script id="embedded-data" type="application/json">'+JSON.stringify({bookId:'sekai-symbol-jiten',pages:fake})+'</script>';assert.throws(()=>patch.inspect(emptyDoc),/空の読書HTML/);
});
test('the patch includes WH1 swipe thresholds, native zoom and fixed figure DOM',()=>{
 const code=patch.repair.toString();
 for(const word of ['Math.abs(dy)>45','Math.abs(dy)>14','Math.abs(dx)>65','wheel','touchcancel','keepFigure','wsFigurePages','browser-native pinch','ws-native-whole-screen-pinch'])
  assert.ok(code.includes(word),word);
});

test('single-digit orientation and Japanese word-boundary protection stay in reader patch',()=>{
 const s=patch.repair.toString();
 for(const item of ['wsWriteVertical','ws-one-digit','wsSafeCut','Intl.Segmenter','white-space:normal'])assert.ok(s.includes(item),item);
});

const vm=require('node:vm');
const sourceFixture=fs.readFileSync(require('node:path').join(__dirname,'fixtures/world-symbols-synthetic.html'),'utf8');
test('synthetic non-copyright fixture repairs to a syntax-valid reader without rewriting book bytes',()=>{
 const result=patch.repair(sourceFixture);
 const tag='<script id="embedded-data" type="application/json">';
 const dataOf=doc=>doc.split(tag)[1].split('</script>')[0];
 assert.equal(dataOf(sourceFixture),dataOf(result.html));
 const main=result.html.slice(result.html.lastIndexOf('<script>')+8,result.html.lastIndexOf('</script>'));
 assert.doesNotThrow(()=>new vm.Script(main));
 for(const marker of ['wsWriteVertical','wsSafeCut','Math.abs(dy)>45'])assert.ok(main.includes(marker));
 const again=patch.repair(result.html);assert.equal(result.html,again.html);
});

test('figure frame keeps a fixed caption region on multi-screen descriptions',()=>{
 const s=patch.repair.toString();
 assert.ok(s.includes("cap.style.flex='0 0 '"));
 assert.ok(s.includes('sameFigure')||s.includes('keepFigure'));
});
