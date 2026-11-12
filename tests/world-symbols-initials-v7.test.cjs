'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const patch=require('../reader/world-symbols/001-020/reader-repair-v1.js');
const gest=require('../reader/world-symbols/001-020/reader-gesture-v5.js');
const layout=require('../reader/world-symbols/001-020/reader-layout-v6.js');
const init=require('../reader/world-symbols/001-020/reader-initials-v7.js');
const raw=fs.readFileSync(path.join(__dirname,'fixtures/world-symbols-synthetic.html'),'utf8');
const tag='<script id="embedded-data" type="application/json">';
const dataOf=html=>html.split(tag)[1].split('</script>')[0];
test('v7 preserves raw private source, and reimport remains idempotent',()=>{
 const html=init.wrapHtml(layout.wrapHtml(gest.wrapHtml(patch.repair(raw).html)));
 assert.ok(html.includes('ws-initials-v7-css'));
 assert.equal(dataOf(html),dataOf(raw));
 assert.equal(init.wrapHtml(html),html);
 assert.doesNotThrow(()=>new vm.Script(init.source));
});
test('loader applies v7 after v6 to a newly selected private HTML',()=>{
 const shell=fs.readFileSync(path.join(__dirname,'../reader/world-symbols/001-020/index.html'),'utf8');
 assert.match(shell,/reader-initials-v7\.js\?v=20261112-v7-cg-jung/);
 assert.match(shell,/WorldSymbolsInitialsV7\.wrapHtml\(layoutFixed\)/);
 assert.match(shell,/原本表記修正v7/);
 assert.doesNotMatch(shell,/data:image\/(?:jpeg|png);base64,[A-Za-z0-9+/]{64,}/);
});
function run(text,cut){
 let result='';
 const body={replaceChildren(){result='';},appendChild(child){result+=child.textContent||'';}};
 const page={blocks:[{kind:'body',text}]};
 const doc={
   createElement:()=>({className:'',style:{},textContent:'',append(...nodes){this.textContent+=nodes.map(n=>n.textContent||'').join('');}}),
   createDocumentFragment:()=>({textContent:'',replaceChildren(){this.textContent='';},appendChild(x){this.textContent+=x.textContent||'';}}),
   createTextNode:t=>({textContent:t}),
   head:{appendChild(){}},getElementById:()=>null
 };
 const book={pages:[page]};
 const ctx={window:{},document:doc,book,
   wsBodyPunctuation:s=>String(s).replaceAll('.', '。').replaceAll(',', '、'),
   wsSafeCut:(text,k)=>k,
   wsWriteVertical:(el,s)=>{el.replaceChildren();el.textContent=String(s);},
   wsNormalizeBodyPunctuation:b=>{for(const p of b.pages)for(const bl of p.blocks)bl.text=ctx.wsBodyPunctuation(bl.text);},
   refresh(){},console};
 vm.createContext(ctx);vm.runInContext(init.source,ctx);
 const proof=ctx.wsSafeCut(text,cut);
 return {ctx,book,text:ctx.wsBodyPunctuation(text),proof};
}
test('scan011 C.G.ユング remains Latin initials, not C。G。 or C. G.',()=>{
 for(const input of ['C.G.ユング','C. G.ユング','C。G。ユング','C.G. ユング']){
  const {text,book}=run('現代の深層心理学では、'+input+'の考え方に沿って。',32);
  assert.match(text,/C\.G\.ユング/);
  assert.doesNotMatch(text,/C。G。|C\. G\./);
  assert.match(book.pages[0].blocks[0].text,/C\.G\.ユング/);
  if(input!=='C.G.ユング')assert.equal(typeof book.pages[0].blocks[0].originalOCRText,'string');
 }
});
test('pagination will not split the protected proper name',()=>{
 const s='前段の文章です。C.G.ユングの考え方に沿って。';
 const a=s.indexOf('C.G.'),b=a+'C.G.ユング'.length;
 for(let k=a+1;k<b;k++){
  const {proof}=run(s,k);
  assert.equal(proof,a,'protect cut inside name at character '+k);
 }
});
