'use strict';
// Synthetic only: verify public paragraph-flow behavior without private book text.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const html=fs.readFileSync(path.join(__dirname,'../reader/british-interiors/full/index.html'),'utf8');
function node(tag){
 return {tagName:tag.toUpperCase(),children:[],dataset:{},className:'',
   appendChild(child){if(child.owner){const a=child.owner.children;const i=a.indexOf(child);if(i>=0)a.splice(i,1)}
     child.owner=this;this.children.push(child);return child},
   get firstChild(){return this.children[0]||null}
 };
}
test('exact private engine remains unchanged and rejected word guard is absent',()=>{
 assert.match(html,/TRUSTED_ENGINE_SHA256='580e233afe48319518b02c1a0c57446f68e339b4fb9c5db43c7a06c909b271ca'/);
 assert.match(html,/uk-continuous-paragraph-flow-v1/);
 assert.match(html,/installUKContinuousParagraphFlow\(\);/);
 assert.doesNotMatch(html,/installUKColumnWordGuard|uk-atomic-word/);
});
test('source paragraphs flow as inline spans while content and headings are preserved',()=>{
 const fn=html.match(/ function installUKContinuousParagraphFlow\(\)\{[\s\S]*?\n \}/)?.[0];
 assert.ok(fn,'public paragraph adapter not found');
 const inserted=[];
 const document={head:{appendChild:n=>inserted.push(n)},createElement:node};
 const original=part=>{const e=node(part.type==='heading'?'h2':'p');
   e.appendChild({textContent:part.text});return e};
 const window={makePart:original};
 vm.runInNewContext(fn+'\ninstallUKContinuousParagraphFlow();',{window,document,Error,String});
 const input=[
  {type:'body',text:'第一段落。',paraIndex:0,continued:false},
  {type:'body',text:'第二段落。',paraIndex:1,continued:false},
  {type:'body',text:'本文の続き。',paraIndex:1,continued:true},
  {type:'heading',text:'第1章',paraIndex:-1,continued:false}
 ];
 const out=input.map(p=>window.makePart(p));
 assert.deepEqual(out.map(e=>e.tagName),['SPAN','SPAN','SPAN','H2']);
 assert.deepEqual(out.map(e=>e.children.map(c=>c.textContent).join('')),input.map(p=>p.text));
 assert.ok(out.slice(0,3).every(e=>e.className.includes('uk-inline-paragraph')));
 assert.ok(out[2].className.includes('continued'));
 assert.equal(out[1].dataset.sourceParagraph,'1');
 assert.equal(inserted.length,1);
 assert.equal(inserted[0].id,'uk-continuous-paragraph-flow-v1');
 assert.match(inserted[0].textContent,/\.text-flow>\.uk-inline-paragraph/);
 assert.match(inserted[0].textContent,/::before/);
 vm.runInNewContext(fn+'\ninstallUKContinuousParagraphFlow();',{window,document,Error,String});
 assert.equal(inserted.length,1,'must never install duplicate adapters');
});
