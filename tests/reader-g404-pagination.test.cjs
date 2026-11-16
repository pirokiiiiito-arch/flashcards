'use strict';
// Synthetic G4-04 regression; never claims actual Japanese source proofreading.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const engine=fs.readFileSync(process.env.G404_ENGINE_PATH||path.resolve(__dirname,'../templates/reader/v2/novel.js'),'utf8');
const base=engine.indexOf('const g404WordSegmenter='),end=engine.indexOf('function paginateBlocks(',base);
const split=s=>Array.from(new Intl.Segmenter('ja',{granularity:'grapheme'}).segment(s),v=>v.segment);
if(base===-1||end<base)throw Error('G4-04 implementation must be present');
const make=new Function('segmenter','split','measureText','font',engine.slice(base,end)+
  '\nreturn {g404Select,g404Record,g404Protected,g404BoundaryKind,getAudit:()=>g404Audit};');
const block=s=>({type:'body',scan:21,text:s,units:split(s)});
const sel=(t,fit,font=20)=>{const b=block(t),a=make(null,split,{clientHeight:650},font);return {b,a,result:a.g404Select(b,0,fit,b.units.length,false)}};
test('the public novel engine parses and does not embed any private scan or OCR source',()=>{
 assert.doesNotThrow(()=>new vm.Script(engine));
 assert.doesNotMatch(engine,/data:image\/(jpeg|png);base64|シーモア|バナナフィッシュ日和/);
 assert.match(engine,/g404Audit\.filter\(x=>x\.exception\)/);
 assert.match(engine,/G4-04要確認/);
});
test('an early sentence delimiter cannot waste most of an otherwise available page',()=>{
 const t='雨がやんだ。'+('空の向こうに大きな星が見えた。').repeat(20);
 const {b,result:r}=sel(t,20);
 assert.ok(r.count>=14,`minRead not enforced: ${r.count}`);
 assert.equal(b.units.join(''),t);
});
test('katakana and ordinary Japanese verb units protect known word-break regressions',()=>{
 const b='ベッドに行って腰を下ろした。'.repeat(5);
 const selected=sel(b,3).result;
 assert.equal(selected.count,3);
 assert.notEqual(selected.reason,'forced-unavoidable');
 const c=sel('撃ち抜いた。'.repeat(10),1).result;
 assert.ok(c.exception,'forced split must be auditable rather than silently passing');
});
test('do not leave an isolated opening quote when capacity is just one character',()=>{
 assert.throws(()=>sel('「こんにちは」'.repeat(4),1),/G404_NO_SAFE_PAGE_BOUNDARY/);
});
test('balanced tail has a useful prefix and no exceptional unverified break',()=>{
 const b='「でも代わりにどうしたか知ってる？」';
 const {result:r}=sel(b,16,24);
 assert.ok(r.count>=6&&r.count<=12,`short orphan: ${r.count}`);
 assert.equal(r.exception,null);
 assert.equal(r.balanced,true);
});
test('two-page complete text is immutable, with audit added only when a break is committed',()=>{
 const t='「そうなの？　もうちょっと近くへ来てみてよ」';
 const {b,a,result:r}=sel(t,16);
 assert.equal(a.getAudit().length,0);
 a.g404Record(b,0,r);
 assert.equal(a.getAudit().length,1);
 assert.equal(a.getAudit()[0].scan,21);
 assert.equal(b.units.join(''),t);
 assert.ok(r.count>0&&r.count<b.units.length);
 assert.equal(b.units.slice(0,r.count).join('')+b.units.slice(r.count).join(''),t);
});
test('failed visual boundary is never presented as a completed independent book review',()=>{
 assert.match(engine,/g404Pass:!g404Audit\.some\(x=>x\.exception\)&&!warning/);
 assert.match(engine,/if\(selected\.exception&&current\.length\)\{flush\(\);continue;\}/);
 assert.match(engine,/throw Error\('G404_NO_SAFE_PAGE_BOUNDARY/);
});
