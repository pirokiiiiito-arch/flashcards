const {test} = require('node:test');
const assert = require('node:assert/strict');
const {createHash} = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const folder = path.join(__dirname, '../reader/library');
const moduleSource = fs.readFileSync(path.join(folder, 'novel-resume-layout.js'), 'utf8');
const host = fs.readFileSync(path.join(folder, 'read.html'), 'utf8');
const edition = '1518dcd1772ff65620265a2597d9db3782e2e667d3110d7419c26018e14e0ee8';
const priorEdition = '7bec7d5ef409cc65ff30bc5b33f6618c2d1c2e42743c841966d2815f55a9f385';

function reader(stubs = {}) {
  const ctx = vm.createContext({TextDecoder, TextEncoder, Blob, ...stubs});
  vm.runInContext('window = globalThis', ctx);
  vm.runInContext(moduleSource, ctx);
  return ctx;
}

// Small deterministic paginator. Its ordered page starts depend on the Boolean
// fit results, just as the private reader's unchanged page builder does.
const sampleEngine = `
function fitsParts(existing,additional){
  calls++;
  return existing + additional <= sheet.width / font;
}
function paginateAll(){
  const starts = [0];
  let occupied = 0;
  words.forEach((length, i) => {
    if (!fitsParts(occupied, length)) { starts.push(i); occupied = 0; }
    occupied += length;
  });
  return starts;
}
function rebuild(){let pages;pages=paginateAll();return pages;}
`;

test('only the two known editions opt in to resume processing', () => {
  const {NovelResumeLayout: api} = reader();
  for (const id of [edition, priorEdition]) assert.notEqual(api.prepare(sampleEngine, id), sampleEngine);
  const unknown = '0'.repeat(64);
  assert.equal(api.prepare(sampleEngine, unknown), sampleEngine);
  assert.equal(api.compactOriginals(new Uint8Array(), unknown), null);
  assert.equal(api.prepare('unrecognized reader', edition), 'unrecognized reader');
});

test('page turns replace the whole text surface while preserving attributes, parts and measurement nodes', () => {
  const binding = "const textFlow=$('text-flow'),measureText=$('measure-text'),caption=$('figure-caption'),measureCaption=$('measure-caption');";
  const paint = '  textFlow.replaceChildren(frag);';
  const engine = binding + '\n' + sampleEngine + '\nfunction paint(frag){\n' + paint + '\n}\nfunction currentSurface(){return textFlow;}';
  for (const id of [edition, priorEdition]) {
    const nodes = new Map(), transitions = [];
    class Surface {
      constructor(attributes) { this.attributes = {...attributes}; this.children = []; this.connected = false; }
      cloneNode(deep) { assert.equal(deep, false); return new Surface(this.attributes); }
      append(fragment) { assert.equal(this.connected, false); this.children.push(...fragment.splice(0)); }
      replaceWith(next) {
        assert.equal(nodes.get('text-flow'), this);
        assert.ok(next.children.length, 'the new page must be complete before attachment');
        this.connected = false; next.connected = true; nodes.set('text-flow', next); transitions.push([this, next]);
      }
      replaceChildren() { assert.fail('a page turn must not reuse the prior text paint surface'); }
    }
    const original = new Surface({id: 'text-flow', class: 'text-flow front-matter', style: 'padding-right:0.55em', hidden: 'false'});
    original.connected = true; nodes.set('text-flow', original);
    for (const name of ['measure-text', 'figure-caption', 'measure-caption']) nodes.set(name, {id: name});
    const measured = nodes.get('measure-text'), ctx = reader({$: name => nodes.get(name)});
    vm.runInContext(ctx.NovelResumeLayout.prepare(engine, id), ctx);
    let clicks = 0;
    for (const text of ['合成の一頁。', '次の文章。']) {
      const previous = ctx.currentSurface(), attributes = {...previous.attributes};
      const part = {textContent: text, onclick() { clicks++; }}, fragment = [part];
      ctx.paint(fragment);
      const current = ctx.currentSurface();
      assert.notEqual(current, previous); assert.equal(current, nodes.get('text-flow'));
      assert.deepEqual(current.attributes, attributes); assert.deepEqual(current.children, [part]);
      assert.equal(fragment.length, 0); assert.equal(nodes.get('measure-text'), measured);
      current.children[0].onclick();
      current.attributes.class = 'text-flow';
    }
    assert.equal(clicks, 2); assert.equal(transitions.length, 2);
    // If either source anchor is absent, leave the original paint operation and
    // binding intact; never install only half of the replacement.
    for (const unmatched of [engine.replace(binding, binding.replace('const ', 'let ')), engine.replace(paint, '  textFlow.replaceChildren(...frag);')]) {
      const output = ctx.NovelResumeLayout.prepare(unmatched, id);
      assert.doesNotMatch(output, /nextTextFlow/);
      assert.ok(output.includes(unmatched.includes(paint) ? paint : '  textFlow.replaceChildren(...frag);'));
    }
    assert.equal(ctx.NovelResumeLayout.prepare(engine, '0'.repeat(64)), engine);
  }
});

test('the original paginator gets identical cold and warm page starts; changed geometry and invalid records remeasure', () => {
  const stored = new Map();
  const sheet = {width: 160, getBoundingClientRect() { return {width: this.width, height: 420}; }};
  const styles = {fontFamily: 'serif', fontSize: '20px', writingMode: 'vertical-rl'};
  const metrics = {measureText: () => ({width: 48, actualBoundingBoxAscent: 10, actualBoundingBoxDescent: 4, actualBoundingBoxRight: 47})};
  const ctx = reader({sheet, measureText: {}, font: 20, calls: 0, words: [4, 3, 5, 6, 2],
    devicePixelRatio: 2, navigator: {userAgent: 'test'}, getComputedStyle: () => styles,
    document: {fonts: {status: 'loaded'}, createElement: () => ({getContext: () => metrics})},
    localStorage: {getItem: k => stored.get(k), setItem: (k,v) => stored.set(k,v)}});
  vm.runInContext(ctx.NovelResumeLayout.prepare(sampleEngine, edition), ctx);
  function build(expected, measurements) {
    ctx.calls = 0;
    assert.deepEqual(Array.from(ctx.rebuild()), expected);
    assert.equal(ctx.calls, measurements);
  }
  build([0, 2, 3], 5);
  build([0, 2, 3], 0);
  sheet.width = 200;
  build([0, 2, 3], 5);
  ctx.font = 16;
  build([0, 3], 5);
  const [key] = stored.keys();
  const valid = stored.get(key), record = JSON.parse(valid);
  for (const invalid of ['{', JSON.stringify({...record, checksum: record.checksum + 1}),
                         JSON.stringify({...record, pages: record.pages + 1})]) {
    stored.set(key, invalid);
    build([0, 3], 5);
    build([0, 3], 0);
  }
  // Exhaust a valid but too-short recording. No partial replay may survive.
  ctx.words.push(5);
  build([0, 3, 5], 6);
  build([0, 3, 5], 0);
  ctx.document.fonts.status = 'loading';
  build([0, 3, 5], 6);
});

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AH//Z','base64');
function original(scan) {
  // A 1x1 JPEG with a distinct, valid JPEG comment carrying the scan number.
  return Buffer.concat([jpeg.subarray(0, 2), Buffer.from([255,254,0,4,scan >> 8,scan & 255]), jpeg.subarray(2)]);
}
function originalsFixture(reorder = false) {
  const originals = Array.from({length: 534}, (_,i) => {
    const scan = i+1, bytes = original(scan), sha256 = createHash('sha256').update(bytes).digest('hex');
    const src = 'data:image/jpeg;base64,' + bytes.toString('base64');
    return reorder ? {scan, src, sha256} : {scan, sha256, src};
  });
  const json = JSON.stringify({title: 'fixture', originals});
  return '<script type="application/json" id="bookdata">'+json+'</script><script>' +
    'window.READER_BOOK=JSON.parse(document.getElementById("bookdata").textContent);</script>';
}
function bookData(markup) {
  return markup.split('id="bookdata">')[1].split('</script>')[0];
}

for (const native of [true,false]) {
  test('originals decode once on demand and retain exact JPEG bytes with ' + (native ? 'fromBase64' : 'atob'), async () => {
    const blobs = new Map();
    let decodes = 0;
    const ctx = reader({URL: {createObjectURL(blob) { const url = 'blob:test-'+blobs.size; blobs.set(url, blob); return url; }},
      atob: text => { assert.equal(native, false); decodes++; return atob(text); }});
    ctx.native = text => { decodes++; return Buffer.from(text, 'base64'); };
    vm.runInContext('Uint8Array.fromBase64 = '+(native ? 'native' : 'undefined'),ctx);
    const markup = ctx.NovelResumeLayout.compactOriginals(Buffer.from(originalsFixture()), edition);
    assert.ok(markup && !markup.includes('data:image/'));
    ctx.document = {getElementById: () => ({textContent: bookData(markup)})};
    vm.runInContext(markup.split('</script><script>')[1].split('</script>')[0], ctx);
    assert.equal(decodes, 0);
    assert.equal(blobs.size, 0);
    for (const scan of [262, 534, 1]) {
      const item = ctx.READER_BOOK.originals[scan-1];
      const url = item.src;
      assert.equal(item.src, url);
      const blob = blobs.get(url);
      assert.equal(blob.type, 'image/jpeg');
      assert.deepEqual(Buffer.from(await blob.arrayBuffer()), original(scan));
    }
    assert.equal(decodes, 3);
  });
}

test('unsupported metadata falls back through the bookshelf host to the existing eager parser', async () => {
  const blobs = new Map();
  const ctx = reader({atob, URL: {createObjectURL(blob) { const url='blob:eager-'+blobs.size; blobs.set(url,blob); return url; }}});
  const bytes = Buffer.from(originalsFixture(true) + ' '.repeat(32*1024*1024));
  ctx.bytes = bytes;
  ctx.m = {sha256: edition, originalImageHandling: 'blob-v1'};
  ctx.fastReader = ctx.NovelResumeLayout;
  assert.equal(ctx.fastReader.compactOriginals(bytes, edition), null);
  const eager = host.slice(host.indexOf('function compactStandaloneOriginals(bytes){'), host.indexOf('// A single WH1 document'));
  const select = host.slice(host.indexOf('const compact=(m.originalImageHandling'), host.indexOf("if(m.template_profile==='novel'&&m.template_variant==='poetry')"));
  const markup = vm.runInContext(eager + '\n' + select + '\nmarkup;', ctx);
  const items = JSON.parse(bookData(markup)).originals;
  assert.equal(blobs.size, items.length);
  assert.equal(items.length, 534);
  assert.deepEqual(Buffer.from(await blobs.get(items[533].src).arrayBuffer()), original(534));
});
