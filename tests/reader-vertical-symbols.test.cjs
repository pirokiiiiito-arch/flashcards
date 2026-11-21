'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {count,uprightRanges,displayText,standaloneDigitAt}=require('../templates/reader/v2/vertical-symbols.js');
const {checkEngine,checkFile,syncEngine}=require('../tools/reader-vertical-symbols.cjs');
const dir=path.join(__dirname,'../templates/reader/v2');
const os=require('node:os');
const marked=text=>Array.from(uprightRanges(text),({start,end})=>text.slice(start,end)).join('');
test('the reading edition widens only ASCII question marks, including adjacent marks',()=>{
 const original='?本当??え？ 1!A…｜（※）#️⃣‼️';
 const expected='？本当？？え？ 1!A…｜（※）#️⃣‼️';
 assert.equal(displayText(original),expected);
 assert.equal(displayText(expected),expected);
 assert.equal(original[0],'?');
});
test('Japanese punctuation, long strokes and leaders use native vertical glyphs',()=>{
 const text='「」『』（）()［］【】。、・：；…‥ーーｰ―—‐-〜～~';
 assert.equal(marked(text),'');assert.deepEqual(count(text),{native:Array.from(text).length,upright:0});
});
test('emphasis, notation and directional signs retain upright meaning at both widths',()=>{
 const text='!?！？⁉⁇⁈‼※±＋+＝=≠×÷％%＆&＃#＠@￥$€℃→↑⇔◆▼／/｜|';
 assert.equal(marked(text),text);assert.equal(count(text).upright,Array.from(text).length);
});
test('variation, combining marks and joined emoji stay in their original runs',()=>{
 const text='A1#️⃣*️⃣‼️⚕️👩‍⚕️→\u0301（株）α\u0301。!?';
 assert.equal(marked(text),'!?');
 const ranges=Array.from(uprightRanges('あ😀！？'),r=>[r.start,r.end]);
 assert.deepEqual(ranges,[[3,4],[4,5]]);
});
test('only a standalone halfwidth digit is marked; source code points stay intact',()=>{
 const text='第2章 1世紀 0 9 ８人 A1 ３5 7４ 12 1660 3.5 ２．6 A-2 F_8 1️⃣ 2:3 4〜5 6/7 .5';
 assert.equal([...text.matchAll(/[0-9]/g)].filter(m=>standaloneDigitAt(text,m.index)).map(m=>m[0]).join(''),'2109');
 assert.equal(displayText(text),text);
 assert.deepEqual([...uprightRanges('第3章 ４')].map(r=>[r.start,r.end]),[[1,2]]);
});
test('a measurement candidate or page slice uses the original left and right context',()=>{
 for(const [text,before,after] of [['1','','2'],['6','16','0'],['1','A',''],['5','3.',''],['3','','.5'],['2','','-3'],['5','１','']]){
  assert.equal([...uprightRanges(text,before,after)].length,0);
 }
 assert.deepEqual([...uprightRanges('2','第','章')],[{start:0,end:1}]);
});
test('engines embed the exact module, both measure and display it, and regenerate idempotently',()=>{
 for(const name of ['novel.js','standard.js']){
  const current=fs.readFileSync(path.join(dir,name),'utf8');
  assert.doesNotThrow(()=>checkEngine(current));assert.equal(syncEngine(current),current);
  const changed=current.replace("mark.style.textOrientation='upright'","mark.style.textOrientation='sideways'");
  assert.throws(()=>checkEngine(changed));assert.equal(syncEngine(changed),current);
  const old=current.replace(/^\/\/ BEGIN reader vertical symbols$[\s\S]*?^\/\/ END reader vertical symbols\n/gm,'').replace('setVerticalText(el,p.text,p);','el.textContent=p.text;')
   .replace(/  before:b\.units\.slice\([^\n]+,\n/,'');
  assert.equal(syncEngine(old),current);
  assert.throws(()=>checkEngine(current.replace('setVerticalText(el,p.text,p);','setVerticalText(el,p.text);')));
  assert.throws(()=>checkEngine(current.replace('fragment.append(partNode(p))','fragment.append(p.text)')));
 }
 for(const name of ['novel.html','text.html','mixed.html','image.html'])assert.doesNotThrow(()=>checkFile(path.join(dir,name)));
 assert.throws(()=>syncEngine('unrelated'),/unrecognized/);
});

test('embedded source counts do not infer orientation at a scan boundary',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'reader-digit-source-'));
 try{
  fs.copyFileSync(path.join(dir,'standard.js'),path.join(tmp,'standard.js'));
  const file=path.join(tmp,'book.html');
  const pages=[{scan:1,blocks:[{type:'body',text:'年は1'}]},{scan:2,blocks:[{type:'body',text:'2年。',joinPrevious:true}]}];
  fs.writeFileSync(file,'<script src="standard.js"></script><script id="embedded-data" type="application/json">'+JSON.stringify({pages})+'</script>');
  const report=checkFile(file);
  assert.equal(report.sourceHalfwidthDigits,2);assert.equal(report.upright,0);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
