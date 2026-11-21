'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');

const host = readFileSync(path.join(__dirname, '../reader/library/read.html'), 'utf8');
const begin = host.indexOf('// BEGIN WH3 continuous scan layout');
const end = host.indexOf('// END WH3 continuous scan layout');
const plan = new Function(host.slice(begin, end) + '\nreturn wh3ReadingFlow;')();

function makeBook({declared = true, range = [1, 43], firstEnd = 20} = {}) {
  const [first, last] = range;
  const cut = firstEnd + 1;
  const parts = [[first, firstEnd], [cut, last]].map(([start,end],i) => ({start, end, part:`part-${i}.html`}));
  const manifest = {bookId:'new-test-title', title:'Weather journal', template_profile:'world_history_1', status:'確認版', range, segments:parts};
  const join = {from:[firstEnd,0],to:[cut,0]};
  if (declared) manifest.readingFlow = {format:'structured-scan-flow-v1',continuations:[join]};
  const sources = parts.map(({start,end}) => {
    const pages = Array.from({length:end-start+1}, (_,i) => {
      const scan = start+i;
      return {scan, width:100, height:160, pageType:'text', figures:[], toc_entries:[], blocks:[{type:'body',text:`観察結果${scan}。`}]};
    });
    return {bookId:manifest.bookId, title:manifest.title, range:[start,end],pages, toc:[{sourceScan:start,text:`Section ${start}`,targetScan:start}], continuations:declared?[]:[join]};
  });
  const field = (id,v) => `<script id='${id}' type='application/json'>${JSON.stringify(v)}</script>`;
  const book = {async readText(id) {
    const source = sources[parts.findIndex(p=>p.part===id)];
    if (typeof source === 'string') return source;
    return field('reader-verified-structure',{model:{source_scan_numbers:source.pages.map(p=>p.scan)}})+field('bookdata',source);
  }};
  return {manifest,sources,book,join};
}
async function readSections(flow) {
  return Promise.all(flow.sections.map(async (_,i) => {
    const html = await flow.archive(i,true);
    return JSON.parse(/id="bookdata">([\s\S]*?)<\/script>/.exec(html)[1]);
  }));
}
for (const declared of [true,false]) {
  test(`an unrelated new title uses verified cross-volume text, TOCs and roles (${declared?'declared':'detected'})`,async () => {
    const {book,manifest,sources,join} = makeBook({declared});
    const withoutHeading = sources[0].pages;
    withoutHeading[4].pageType = 'portrait';
    withoutHeading[4].blocks = [];
    sources[1].pages[1].blocks.unshift({type:'heading',text:'次の章'});
    const flow = await plan(book,manifest), sections = await readSections(flow);
    assert.deepEqual(sections.flatMap(s=>s.pages.map(p=>p.scan)),Array.from({length:43},(_,i)=>i+1));
    assert.deepEqual(sections.flatMap(s=>s.continuations),[join]);
    assert.ok(sections.some(s=>s.range[0]<=20&&s.range[1]>=21));
    for (const s of sections) {
      assert.equal(s.title,manifest.title);
      assert.equal(s.presentation.totalScans,43);
      assert.deepEqual(s.presentation.portraitScans,[5]);
      assert.deepEqual(s.toc,sources.flatMap(p=>p.toc));
    }
  });
}
test('another title has its own scan order, including historic reverse-index scan numbers',async () => {
  const {book,manifest} = makeBook({range:[251,258],firstEnd:254});
  const frames = async () => (await readSections(await plan(book,manifest))).flatMap(s=>s.pages.map(p=>p.scan));
  assert.deepEqual(await frames(),[251,252,253,254,255,256,257,258]);
  manifest.readingFlow.scanOrder=[252,251,253,254,255,257,256,258];
  assert.deepEqual(await frames(),manifest.readingFlow.scanOrder);
  manifest.readingFlow.scanOrder[0]=258;
  await assert.rejects(plan(book,manifest),/表示順/);
});
test('unsupported legacy pages keep their own renderer, while a broken recognized edition reports its error',async()=>{
  const {book,sources,manifest} = makeBook({declared:false});
  const html='<h1>別形式の読書画面</h1>';
  sources[1]=html;
  await assert.rejects(plan(book,manifest),/分冊/);
  sources[0]=html;
  assert.equal(await plan(book,manifest),null);
  manifest.readingFlow={format:'structured-scan-flow-v1'};
  await assert.rejects(plan(book,manifest),/分冊/);
});
test('a reviewed cross-file join cannot target a heading or refer to a different book',async()=>{
  const {book,sources,manifest} = makeBook();
  sources[1].pages[0].blocks[0].type='heading';
  await assert.rejects(plan(book,manifest),/本文接続/);
  sources[1].bookId='some-other-title';
  await assert.rejects(plan(book,manifest),/分冊/);
});
