'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const window={};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../templates/reader/v2/poetry.js'),'utf8'),{window});
const layout=window.PoetryLayout.create({kind:'text',blocks:[]});
test('page turns use only whole words, including continued lines',()=>{
 const ends=[3,7,12,17];
 assert.equal(layout.bestPageEnd(ends,0,n=>n<=10),7);
 assert.equal(layout.bestPageEnd(ends,7,n=>n<=5),5);
 assert.equal(layout.bestPageEnd(ends,7,n=>n<5),0);
});
test('neither a grapheme cluster nor ruby base is split at a supplied word edge',()=>{
 const block={units:['か\u3099','橋','守','り'],verse:{ends:[1,2,3,4,5]},ruby:[{start:1,end:3}]};
 assert.deepEqual(Array.from(layout.boundaries(block)),[1,3,4]);
});
test('prose retained in a poetry volume uses the baseline paragraph layout',()=>{
 const blocks=[{id:'verse',type:'body',text:'空',poetryWordEnds:[1]},{id:'prose',type:'body',text:'注',lineRole:'prose'}];
 const poetry=window.PoetryLayout.create({kind:'text',blocks});
 assert.ok(poetry.lines.has('verse'));
 assert.ok(!poetry.lines.has('prose'));
});
