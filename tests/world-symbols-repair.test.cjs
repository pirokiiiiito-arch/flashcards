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
 assert.throws(()=>patch.inspect(doc.replace('"bookId":"wrong"','"bookId":"sekai-symbol-jiten"')),/空の読書HTML/);
});
test('the patch includes WH1 swipe thresholds, native zoom and fixed figure DOM',()=>{
 const code=patch.repair.toString();
 for(const word of ['Math.abs(dy)>45','Math.abs(dy)>14','Math.abs(dx)>65','wheel','touchcancel','keepFigure','wsFigurePages','browser-native pinch','ws-native-whole-screen-pinch'])
  assert.ok(code.includes(word),word);
});
