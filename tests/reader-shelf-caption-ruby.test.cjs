'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { prepare, captionRubyRanges, captionRubyBoundary } = require('../reader/library/wh1-caption-ruby.js');

const notes = [
  {text:'序𠮷'},
  {text:'𠮷見本誌',ruby:[{start:1,end:3,base:'見本',reading:'みほん'}]},
  {text:'文'},
];
const style='<style>body { color: black }</style>';
function html(rows) {
  return style + '\nconst blocks='+JSON.stringify(rows)+';\nconst ILLUSTRATION_GROUPS=[{"desc":[0,1,2]}];\n'+
    "function bundleData(g){ const desc=g.desc.map(i=>blocks[i].text).join('\\n'); return {descriptionFull:desc,scan:1}; }\n"+
    "function appendIllustrationPages(base,all,output){let offset=0;while(offset<all.length){const remaining=all.slice(offset);let n=4;output.push({...base,description:remaining.slice(0,n),partOffset:offset,continuation:offset>0});offset+=n;}}\n"+
    "function makeIllustration(p){return node('span','figure-bundle-caption-content',p.description);}";
}
class Element {
  constructor(tag){ this.tag=tag;this.children=[]; }
  append(...nodes){this.children.push(...nodes);}
}
test('caption notes use source code points, join newline and keep a full ruby across a page boundary',()=>{
  const ranges=captionRubyRanges(notes);
  assert.deepEqual(ranges,[{start:6,end:8,reading:'みほん'}]);
  assert.equal(captionRubyBoundary(ranges,4,3),2);
  assert.equal(captionRubyBoundary(ranges,6,1),2);
  const context={document:{createElement:tag=>new Element(tag)}};
  const source=html(notes);const changed=prepare(source);
  assert.equal(prepare(changed),changed);
  assert.equal(changed.slice(0,style.length),style);
  vm.runInNewContext(changed.slice(style.length),context);
  // Slice the joined description between the supplementary character and 見.
  const view=vm.runInNewContext("makeIllustration({...bundleData(ILLUSTRATION_GROUPS[0]),description:'見本誌',partOffset:6})",context);
  const ruby=view.children.find(n=>n.tag==='ruby');
  assert.equal(ruby.children[0],'見本');assert.equal(ruby.children[1].tag,'rt');assert.equal(ruby.children[1].textContent,'みほん');
  assert.equal(view.children.at(-1),'誌');
});
test('only referenced figure notes opt in and unverifiable base offsets fail',()=>{
  const noRuby=html(notes.map(({text})=>({text})));assert.equal(prepare(noRuby),noRuby);
  const elsewhere=html([...notes.map(({text})=>({text})),notes[1]]);
  assert.equal(prepare(elsewhere),elsewhere);
  assert.throws(()=>captionRubyRanges([{text:'同文',ruby:[{start:0,end:1,base:'別',reading:'べつ'}]}]),/親文字/);
});
