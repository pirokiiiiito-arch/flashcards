'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = process.env.READER_AUDIT_ROOT || path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'reader/library/wh3-format.html'), 'utf8');
const render = html.slice(html.indexOf('function render(){'), html.indexOf('function gotoPage('));

test('the same hosted viewport paginates once and changes of size or fonts paginate again', () => {
  const beforeRebuild = html.lastIndexOf('\n}', html.indexOf('function rebuild(){')) + 2;
  const rebuild = html.slice(beforeRebuild, html.indexOf('function zoomed(){'));
  const rect = {width: 390, height: 630};
  const pages = [{start: 0}];
  const fonts = {status: 'loaded'};
  let layouts = 0;
  const context = vm.createContext({
    host: {measureOnly: false}, pages, index: 0, font: 20, warning: '',
    innerWidth: 390, innerHeight: 630, document: {fonts},
    syncMeasure: () => rect, paginateAll: () => { layouts++; return pages; },
    pageAt: () => 0, render() {}, menuRefresh() {}
  });
  vm.runInContext(rebuild, context);
  context.rebuild();
  context.rebuild();
  assert.equal(layouts, 1, 'initial paint and ResizeObserver may report identical geometry');
  rect.height -= 1;
  context.rebuild();
  assert.equal(layouts, 2);
  context.font += 2;
  context.rebuild();
  assert.equal(layouts, 3);
  fonts.status = 'loading';
  context.rebuild();
  assert.equal(layouts, 4);
  fonts.status = 'loaded';
  context.rebuild();
  context.rebuild();
  assert.equal(layouts, 5);
});

test('horizontal figure pages own a full-width surface outside the clipped vertical-text stage', () => {
  const display = html.slice(html.indexOf('<main '), html.indexOf('</main>'));
  assert.match(display, /id="text-flow"[\s\S]*?id="contents" hidden><\/div>\s*<\/div>\s*<div class="reading-stage" id="figure-page" hidden>\s*<section[^>]+id="figure-stage"[^>]+data-wh1-viewport="8"/);
  assert.match(html, /html\.wh3-picture #figure-page\{\s*box-sizing:border-box!important;[\s\S]*?width:100%!important;[\s\S]*?isolation:isolate!important;/);
  assert.match(html, /html\.wh3-picture #figure-page\{\s*clip:auto!important;clip-path:none!important;/);
});

test('turning between vertical text and figure explanations swaps surfaces and preserves the active image', () => {
  const ids = new Map();
  function el(id) {
    if (!ids.has(id)) ids.set(id, {hidden: false, scrollLeft: 24, style: {setProperty() {}}, replaceChildren() {}});
    return ids.get(id);
  }
  el('figure-page').hidden = true;
  const classes = new Map();
  const captions = [];
  const env = {
    verticalReaderSymbols: require('../templates/reader/v2/vertical-symbols.js'),
    $: el, main: el('reader-main'), sheet: el('sheet'), textFlow: el('text-flow'),
    document: {
      documentElement: {classList: {toggle: (name, value) => classes.set(name, value)}},
      createDocumentFragment: () => ({append() {}})
    },
    font: 20, innerWidth: 390, innerHeight: 630, paintedLocation: null, paintShelfProgress() {},
    index: 0, pages: [
      {kind: 'text', scan: 11, parts: []}, {kind: 'image', scan: 11, figure: 0, caption: 'a'},
      {kind: 'image', scan: 11, figure: 0, caption: 'b'}
    ],
    selectedOriginal: null, book: {totalScans: 260}, figures: [{title: 'Long figure title'}],
    pageArtwork: () => null, waitingForArtwork: () => false, zoomed: () => false, setFigure: p => captions.push(p.caption),
    sectionOf: () => '', persist() {}, currentSource: () => true
  };
  const context = vm.createContext(env);
  vm.runInContext(render, context);
  const turn = index => { env.index = index; vm.runInContext('render()', context); };
  turn(0);
  assert.equal(el('reader-page').hidden, false);
  assert.equal(el('figure-page').hidden, true);
  turn(1);
  assert.equal(classes.get('wh3-picture'), true);
  assert.equal(el('reader-page').hidden, true);
  assert.equal(el('figure-page').hidden, false);
  assert.equal(el('figure-stage').hidden, false);
  for (const id of ['reader-main', 'sheet', 'figure-page']) assert.equal(el(id).scrollLeft, 0);
  assert.equal(el('page-origin').textContent.trim(), '｜ 原本 11 / 260');
  Object.defineProperty(el('figure-page'), 'hidden', {
    get: () => false, set: hidden => assert.equal(hidden, false, 'continuation must keep the picture surface mounted'),
    configurable: true
  });
  turn(2);
  assert.deepEqual(captions, ['a', 'b']);
  delete el('figure-page').hidden;
  turn(0);
  assert.equal(classes.get('wh3-picture'), false);
  assert.equal(el('reader-page').hidden, false);
  assert.equal(el('figure-page').hidden, true);
});
