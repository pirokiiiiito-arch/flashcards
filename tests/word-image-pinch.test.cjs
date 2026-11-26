'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = filename => fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
const ui = read('word-images-ui.js');
const css = read('word-images.css');
const html = read('index.html');

test('single-tap image has no modal, zoom action, or instructional text', () => {
  assert.doesNotMatch(ui, /function showImage\s*\(/);
  assert.doesNotMatch(ui, /open\.onclick\s*=/);
  assert.doesNotMatch(ui, /enablePinchZoom/);
  assert.doesNotMatch(ui, /ピンチで拡大・縮小|タップで拡大/);
  assert.doesNotMatch(css, /word-image-zoom-hint|word-image-dialog/);
  assert.match(ui, /const open = make\('div', 'word-image-open'\)/);
  assert.match(ui, /open\.append\(picture\);/);
  assert.match(ui, /open\.setAttribute\('aria-label', image\.name \|\| '画像 ' \+ \(index \+ 1\)\)/);
});

test('picture, frame, card and back scroller allow native whole-page pinch zoom', () => {
  assert.match(css, /\.word-image-open\{[^}]*touch-action:pan-y pinch-zoom/);
  assert.match(css, /\.word-image-picture\{[^}]*touch-action:pan-y pinch-zoom/);
  assert.match(html, /\.card\{[^}]*touch-action:pan-y pinch-zoom/);
  assert.match(html, /\.back-content\{[^}]*touch-action:pan-y pinch-zoom/);
  assert.match(html, /name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"/);
  assert.doesNotMatch(html, /user-scalable=no|maximum-scale=1/);
});

test('the application never intercepts native image pinch gestures', () => {
  assert.doesNotMatch(ui, /touchstart|touchmove|gesturestart|gesturechange|gestureend/);
  assert.doesNotMatch(ui, /preventDefault\(\).*pinch|scale\(/);
  assert.doesNotMatch(css, /transform-origin:center center|will-change:transform/);
  const start = ui.indexOf('  function render(container, images) {');
  const end = ui.indexOf('\n  function edit(container, images, options = {}) {', start);
  assert.ok(start >= 0 && end > start);
  const render = ui.slice(start, end);
  assert.doesNotMatch(render, /touch(start|move)|gesture(start|change)|preventDefault\(\)/);
  assert.match(render, /const gallery = mark\(make\('div', 'word-image-gallery'\)\)/);
  assert.match(ui, /element\.addEventListener\('click', stop\)/,
    'a photo tap must not flip the flashcard');
});

test('photo data, loading and retry remain intact while whole-page zoom is browser owned', () => {
  assert.match(ui, /const blob = await root\.WordImages\.getBlob\(image\)/);
  assert.match(ui, /url = root\.URL\.createObjectURL\(blob\)/);
  assert.match(ui, /picture\.src = url/);
  assert.match(ui, /retry\.onclick = load/);
  assert.match(ui, /for \(const url of urls\) root\.URL\.revokeObjectURL\(url\)/);
  assert.doesNotMatch(ui, /pinchControllers|zoom\.reset\(/);
});

test('native one-finger vertical scroll and back-to-front reset remain available', () => {
  assert.match(html, /if\(card\.classList\.contains\("show-back"\)&&e\.target\.closest\("\.back-content"\)\)/);
  assert.match(html, /function resetWordBackScroll\(card\)\{/);
  assert.match(html, /if\(!openBack\)resetWordBackScroll\(card\)/);
  assert.match(html, /if\(openBack\)resetWordBackScroll\(card\)/);
  assert.match(html, /\.card:not\(\.show-back\) \.back-content\{overflow-y:hidden\}/);
  assert.match(html, /\.back-content\{[^}]*overflow-y:auto/);
});
