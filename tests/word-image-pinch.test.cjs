'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
  assert.match(ui, /const gallery = make\('div', 'word-image-gallery'\)/);
  assert.doesNotMatch(ui, /const gallery = mark\(make\('div', 'word-image-gallery'\)\)/);
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
  assert.match(render, /const gallery = make\('div', 'word-image-gallery'\)/);
  assert.match(ui, /element\.addEventListener\('click', stop\)/,
    'editing controls continue to stop clicks; study gallery does not');
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


test('photo tap flips its card, while editing controls and multi-touch gestures do not', () => {
  const start = html.indexOf(' card.addEventListener("click",e=>{');
  const end = html.indexOf('\n card.addEventListener("selectstart"', start);
  assert.ok(start >= 0 && end > start, 'use actual study-card click logic');
  let click, flips = 0;
  const context = {
    card: { addEventListener(type, callback) { if (type === 'click') click = callback; } },
    editing: false, suppressClickUntil: 0, touchTapHandled: false, imageTapBlocked: false,
    allowAction() { return true; },
    flipWordCardFace() { flips++; }
  };
  vm.runInNewContext(html.slice(start, end), context);
  assert.equal(typeof click, 'function');

  const imageTarget = {
    closest(selector) {
      if (selector === '.word-image-open') return { className: 'word-image-open' };
      if (selector === 'button,textarea,input,[data-image-ui]') return { dataset: { imageUi: '' } };
      return null;
    }
  };
  click({ target: imageTarget });
  assert.equal(flips, 1, 'a photo tap reaches the card despite the image-area ancestor');

  context.imageTapBlocked = true;
  click({ target: imageTarget });
  assert.equal(flips, 1, 'pinch/vertical swipe must not act like a tap');
  context.imageTapBlocked = false;

  const editingControl = { closest(selector) {
    return selector === '.word-image-open' ? null : {};
  } };
  click({ target: editingControl });
  assert.equal(flips, 1, 'button and editing UI clicks never flip a card');

  context.editing = true;
  click({ target: imageTarget });
  assert.equal(flips, 1, 'image taps in edit mode do not interrupt editing');
});

test('photo tap classification observes movement without cancelling native page pinch', () => {
  const start = html.indexOf(' let imageTapBlocked=false,imageTouchOrigin=null;');
  const end = html.indexOf(' card.addEventListener("pointerdown"', start);
  assert.ok(start >= 0 && end > start, 'actual native gesture observer must exist');
  const handlers = new Map(), passive = new Map();
  const context = {
    card: {
      addEventListener(type, fn, opts) { handlers.set(type, fn); passive.set(type, opts?.passive); }
    },
    touchTapHandled: true,
    suppressClickUntil: 500
  };
  vm.runInNewContext(html.slice(start, end), context);
  assert.equal(passive.get('touchstart'), true);
  assert.equal(passive.get('touchmove'), true);
  const image = { closest(selector) { return selector === '.word-image-open' ? {} : null; } };
  handlers.get('touchstart')({ touches: [{ clientX: 40, clientY: 150 }], target: image });
  assert.equal(vm.runInNewContext('imageTapBlocked', context), false);
  assert.equal(context.touchTapHandled, false);
  assert.equal(context.suppressClickUntil, 0);
  handlers.get('touchmove')({ touches: [{ clientX: 40, clientY: 105 }] });
  assert.equal(vm.runInNewContext('imageTapBlocked', context), true,
    'vertical scrolling does not trigger card flip');
  handlers.get('touchstart')({ touches: [{ clientX: 40, clientY: 150 }], target: image });
  handlers.get('touchstart')({ touches: [
    { clientX: 40, clientY: 150 }, { clientX: 120, clientY: 150 }
  ], target: image });
  assert.equal(vm.runInNewContext('imageTapBlocked', context), true,
    'native whole-page two-finger pinch must never flip the card');
  handlers.get('touchstart')({ touches: [{ clientX: 40, clientY: 150 }], target: image });
  assert.equal(vm.runInNewContext('imageTapBlocked', context), false,
    'a later deliberate one-finger tap works after pinch');
});
