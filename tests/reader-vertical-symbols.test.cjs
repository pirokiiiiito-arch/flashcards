'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {count,uprightRanges}=require('../templates/reader/v2/vertical-symbols.js');
const {checkEngine,checkFile,syncEngine}=require('../tools/reader-vertical-symbols.cjs');
const dir=path.join(__dirname,'../templates/reader/v2');
const marked=text=>Array.from(uprightRanges(text),({start,end})=>text.slice(start,end)).join('');
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
test('engines embed the exact module, both measure and display it, and regenerate idempotently',()=>{
 for(const name of ['novel.js','standard.js']){
  const current=fs.readFileSync(path.join(dir,name),'utf8');
  assert.doesNotThrow(()=>checkEngine(current));assert.equal(syncEngine(current),current);
  const changed=current.replace("mark.style.textOrientation='upright'","mark.style.textOrientation='sideways'");
  assert.throws(()=>checkEngine(changed));assert.equal(syncEngine(changed),current);
  const old=current.replace(/^\/\/ BEGIN reader vertical symbols$[\s\S]*?^\/\/ END reader vertical symbols\n/gm,'').replace('setVerticalText(el,p.text);','el.textContent=p.text;');
  assert.equal(syncEngine(old),current);
  assert.throws(()=>checkEngine(current.replace('fragment.append(partNode(p))','fragment.append(p.text)')));
 }
 for(const name of ['novel.html','text.html','mixed.html','image.html'])assert.doesNotThrow(()=>checkFile(path.join(dir,name)));
 assert.throws(()=>syncEngine('unrelated'),/unrecognized/);
});
