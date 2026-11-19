'use strict';
// Synthetic public-template regression only. Does not certify private OCR, images or iPhone.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path');
const css=fs.readFileSync(path.resolve(__dirname,'../templates/reader/v2/standard.css'),'utf8');
const image=fs.readFileSync(path.resolve(__dirname,'../templates/reader/v2/image.html'),'utf8');
const mixed=fs.readFileSync(path.resolve(__dirname,'../templates/reader/v2/mixed.html'),'utf8');
const figureTarget=/(?:\.caption-flow\b|\.caption-box\b|\.figure-caption-label\b|\.figure-stage\b)/i;
function declarations(sheet){
 const result=[],re=/([^{}]+)\{([^{}]*)\}/g;let match;
 while((match=re.exec(sheet))){
  const selector=match[1].trim(),body=match[2];
  if(!figureTarget.test(selector))continue;
  const mm=body.match(/writing-mode\s*:\s*([\w-]+)/i);
  if(mm)result.push({selector,value:mm[1]});
 }
 return result;
}
test('standard figure caption, title and measuring area explicitly use horizontal-tb',()=>{
 const rules=declarations(css);
 for(const selector of ['.figure-stage','.caption-box','.figure-caption-label','.caption-flow']){
  assert.ok(rules.some(r=>r.selector===selector&&r.value==='horizontal-tb'),'missing horizontal '+selector);
 }
 assert.ok(image.includes('class="caption-flow" id="figure-caption"'));
 assert.ok(image.includes('class="caption-flow" id="measure-caption"'));
 assert.ok(mixed.includes('class="caption-flow" id="figure-caption"'));
 assert.ok(mixed.includes('class="caption-flow" id="measure-caption"'));
});
test('vertical body remains vertical and external figure caption has no obsolete vertical rule',()=>{
 assert.match(css,/\.text-flow\s*\{\s*writing-mode:vertical-rl/);
 assert.equal(declarations(css).filter(r=>/^(vertical-rl|vertical-lr|sideways-rl|sideways-lr)$/.test(r.value)).length,0);
});
test('a horizontal !important override never excuses an earlier vertical caption rule',()=>{
 const broken='.caption-flow{writing-mode:vertical-rl}.caption-flow{writing-mode:horizontal-tb!important}';
 const rules=declarations(broken);
 assert.equal(rules.filter(r=>r.value==='vertical-rl').length,1);
});
