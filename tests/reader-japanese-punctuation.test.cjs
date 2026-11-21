'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {japanesePunctuation,displayText,setVerticalText}=require('../templates/reader/v2/vertical-symbols.js');

test('Japanese clause breaks use native comma and full stop at either source width',()=>{
 for(const [source,expected] of [
  ['若葉は，薄く．秋には,厚くなる.','若葉は、薄く。秋には、厚くなる。'],
  ['木は，DNAを調べる．高さ30 m，幹は40cm.樹皮は白い.','木は、DNAを調べる。高さ30 m、幹は40cm。樹皮は白い。'],
  ['5月に採集し,6月に戻る．「青い」.別名（blue）．','5月に採集し、6月に戻る。「青い」。別名（blue）。'],
  ['調査対象はABC.面積は4.3㎡.重さは32 mg.','調査対象はABC。面積は4.3㎡。重さは32 mg。'],
  ['第2群, A：初期，B：後期.','第2群、 A：初期、B：後期。'],
  ['長さが異なる.5mmの差があった.','長さが異なる。5mmの差があった。'],
  ['既に、正しい。記号は…．．．','既に、正しい。記号は…．．．']
 ]){
  assert.equal(japanesePunctuation(source),expected);
  assert.equal(japanesePunctuation(expected),expected);
  assert.equal(source.length,expected.length);
 }
});

test('scientific notation, page references, English fields and identifying separators survive',()=>{
 for(const [source,expected] of [
  ['数値は1,234.56と２，３４５．６７．差は .5%．','数値は1,234.56と２，３４５．６７。差は .5%。'],
  ['数値は.5%と記す.','数値は.5%と記す。'],
  ['索引［11, 45, 188］.本文（p. 23、pp. 27–30）．','索引［11, 45, 188］。本文（p. 23、pp. 27–30）。'],
  ['1．分類の基礎\n2. 観察.記録．','1．分類の基礎\n2. 観察。記録。'],
  ['標本のQ. albaと、var. rubra、L.による記載.','標本のQ. albaと、var. rubra、L.による記載。'],
  ['著者C.P. Smith（R. Br.）とD.C.の記録．','著者C.P. Smith（R. Br.）とD.C.の記録。'],
  ['英名　red maple, swamp maple.','英名　red maple, swamp maple.'],
  ['学名 Acer spp.','学名 Acer spp.'],
  ['小数は０．５.途中の…と...は残す.','小数は０．５。途中の…と...は残す。'],
  ['資料.csv，https://botany.example/a,b?x=1.25.次はtaro@example.org，の順．','資料.csv、https://botany.example/a,b?x=1.25。次はtaro@example.org、の順。'],
  ['English only, in two clauses. And a third.','English only, in two clauses. And a third.']
 ])assert.equal(japanesePunctuation(source),expected);
});

test('display decisions come from the entire paragraph even when a page or emphasis span contains just a mark',()=>{
 const source='説明.A. albaを調べた. 終了?';
 const whole=displayText(source);
 assert.equal(whole,'説明。A. albaを調べた。 終了？');
 for(const mark of source.matchAll(/[.]/g)){
  const element={};
  setVerticalText(element,mark[0],{displayText:whole.slice(mark.index,mark.index+1)});
  assert.equal(element.textContent,whole[mark.index]);
 }
 assert.equal(japanesePunctuation('見える?'), '見える?');
});
