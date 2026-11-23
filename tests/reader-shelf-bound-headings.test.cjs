'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = process.env.READER_AUDIT_ROOT || path.join(__dirname, '..');
const host = fs.readFileSync(path.join(root, 'reader/library/read.html'), 'utf8');
const pager = fs.readFileSync(path.join(root, 'reader/wh1/all/wh1-exact-pagination.js'), 'utf8');

function sourceBetween(start, end) {
  const a = host.indexOf(start), b = host.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, start);
  return host.slice(a, b);
}

// Short, synthetic blocks all fit on one sheet before the heading rule is applied.
const css = '<style>.heading { font-weight: bold }</style>';
const part = `<html><head>${css}</head><body><script id="fixture">
const blocks=['body','heading','heading','body','heading','body'].map((type,block)=>({type,text:'abc',block}));
const pages=[];
let parts=[];
function flush(){
 if(parts.length)pages.push({parts,key:'text:'+parts[0].block+':0'});
 parts=[];
}
for(const b of blocks){
  let remain=b.text,offset=0;
  while(remain.length){
   parts.push({type:b.type,block:b.block,offset,text:remain});
   remain='';
  }
}
flush();
function jump(dest){
    let idx=-1;
    if(dest?.key) idx=pages.findIndex(p=>p.key===dest.key);
    return idx;
}
</script></body></html>`;

function inspect(html) {
  const code = html.match(/<script id="fixture">([\s\S]*?)<\/script>/)[1];
  return JSON.parse(vm.runInNewContext(code + '\nJSON.stringify({pages:pages.map(p=>p.parts.map(x=>x.block)),restored:jump({key:"text:3:1"})})'));
}

async function reader(format) {
  const segments = [{part:'stored.html', display:{path:'display.html'}}];
  const manifest = {bookId:'fixture',created:'original',readingFlow:{format},canonicalTemplate:'wh1-0011-0030',
    template_profile:'world_history_1',segments};
  const cacheKeys = [], view = {contentWindow:{postMessage(){}},getBoundingClientRect:()=>({width:390,height:800})};
  let measurement;
  const background = new Promise(resolve => {measurement = resolve;});
  const context = vm.createContext({TextDecoder, m:manifest, manifest, SEGMENTS:segments, shouldSave:true,
    window:{addEventListener(){}}, localStorage:{getItem(key){cacheKeys.push(key);return null;}},
    document:{querySelector:()=>null, createElement:()=>({style:{},setAttribute(){},set srcdoc(html){measurement(html);}}),
      body:{append(){}}}, $:()=>view, usesPresidentsTemplate:()=>true,
    currentState:{scan:1},activeSegment:0,setTimeout:()=>1,clearTimeout(){}});
  vm.runInContext(pager, context);
  const ZipBook = vm.runInContext(sourceBetween('class ZipBook {', 'const POSITION_KEY=') + '\nZipBook', context);
  const book = context.bookZip = context.book = new ZipBook({size:200});
  book.readBytes = async name => {
    assert.ok(['display.html','stored.html'].includes(name));
    return new TextEncoder().encode(part);
  };
  vm.runInContext(sourceBetween('function startWh1HeadingPages(', 'async function loadBook('), context);
  const binding = sourceBetween("if(m.readingFlow?.format==='wh1-bound-source-v1')", "if(m.bookId==='us-presidents-south'");
  await vm.runInContext('(async()=>{'+binding+'})()', context);
  vm.runInContext(sourceBetween('const wh1ExactPager=window.WH1ExactPager?.create(', 'function handleChildState(')
    + '\nwh1ExactPager.onState({size:20,scan:1,pageIndex:0,totalPages:3})', context);
  const reading = context.window.WH1ExactPager.decorate(await book.readText(segments[0].part));
  return {reading,background:await background,cacheKey:cacheKeys[0],manifest};
}

test('a bound section starts its heading and its body together in the visible and measured pages', async () => {
  const fixed = await reader('wh1-bound-source-v1');
  for (const html of [fixed.reading,fixed.background]) {
    assert.ok(html.includes(css));
    assert.deepEqual(inspect(html), {pages:[[0],[1,2,3],[4,5]],restored:1});
  }
  assert.equal(fixed.manifest.created,'original');
  const legacy = await reader('unbound');
  assert.deepEqual(inspect(legacy.reading), {pages:[[0,1,2,3,4,5]],restored:-1});
  assert.deepEqual(inspect(legacy.background),inspect(legacy.reading));
  assert.ok(fixed.cacheKey && legacy.cacheKey);
  assert.notEqual(fixed.cacheKey,legacy.cacheKey);
});
