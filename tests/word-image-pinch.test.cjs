'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ui = fs.readFileSync(path.join(__dirname, '..', 'word-images-ui.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'word-images.css'), 'utf8');

function pinchFixture() {
  const start = ui.indexOf('  function enablePinchZoom(viewport, picture) {');
  const end = ui.indexOf('\n  function render(container, images) {', start);
  assert.ok(start > 0 && end > start, 'extract the real inline pinch implementation');
  const { enablePinchZoom } = vm.runInNewContext(
    ui.slice(start, end) + '\n({ enablePinchZoom })'
  );
  const listeners = new Map(), options = new Map();
  const flags = new Set();
  const viewport = {
    classList: { toggle(name, enabled) {
      if (enabled) flags.add(name); else flags.delete(name);
    } },
    addEventListener(name, callback, opts) {
      listeners.set(name, callback); options.set(name, opts);
    },
    removeEventListener(name) { listeners.delete(name); }
  };
  const picture = {
    offsetWidth: 320, offsetHeight: 240, style: {},
    getBoundingClientRect() { return { left: 0, right: 320, top: 0, bottom: 240 }; }
  };
  const zoom = enablePinchZoom(viewport, picture);
  const fire = (eventName, touches, extras = {}) => {
    let cancelled = false, stopped = false;
    const event = {
      touches, cancelable: true, scale: extras.scale,
      preventDefault() { cancelled = true; },
      stopPropagation() { stopped = true; }
    };
    const handler = listeners.get(eventName);
    assert.ok(handler, eventName + ' handler remains installed');
    handler(event);
    return { cancelled, stopped };
  };
  const hands = gap => [
    { clientX: 160 - gap / 2, clientY: 120 },
    { clientX: 160 + gap / 2, clientY: 120 }
  ];
  return { viewport, picture, zoom, fire, hands, listeners, options, flags };
}

test('single tap does not open an image viewer; pinch hint replaces tap-to-enlarge', () => {
  assert.doesNotMatch(ui, /function showImage\s*\(/);
  assert.doesNotMatch(ui, /open\.onclick\s*=/);
  assert.match(ui, /const open = make\('div', 'word-image-open'\)/);
  assert.match(ui, /'ピンチで拡大・縮小'/);
  assert.doesNotMatch(ui, /'タップで拡大'/);
  assert.doesNotMatch(css, /\.word-image-dialog\{/);
  assert.match(css, /\.word-image-open\[hidden\]\{display:none!important\}/);
});

test('two-finger pinch magnifies in place and pinching in resets to original scale', () => {
  const f = pinchFixture();
  assert.equal(f.zoom.getScale(), 1);
  assert.equal(f.options.get('touchmove').passive, false, 'pinch cancellation must work on iOS');
  f.fire('touchstart', f.hands(100));
  const result = f.fire('touchmove', f.hands(190));
  assert.equal(result.cancelled, true);
  assert.equal(result.stopped, true);
  assert.ok(f.zoom.getScale() > 1.8 && f.zoom.getScale() < 2.0);
  assert.match(f.picture.style.transform, /scale\(1\.9\)/);
  assert.equal(f.flags.has('word-image-is-zoomed'), true);

  f.fire('touchend', []);
  f.fire('touchstart', f.hands(190));
  f.fire('touchmove', f.hands(80));
  assert.equal(f.zoom.getScale(), 1);
  assert.equal(f.picture.style.transform, '');
  assert.equal(f.flags.has('word-image-is-zoomed'), false);
  f.zoom.destroy();
  assert.equal(f.listeners.size, 0);
});

test('one-finger drag is never prevented and can scroll the card even while magnified', () => {
  const f = pinchFixture();
  f.fire('touchstart', f.hands(100));
  f.fire('touchmove', f.hands(200));
  assert.equal(f.zoom.getScale(), 2);
  f.fire('touchend', []);
  const oneFinger = f.fire('touchmove', [{ clientX: 160, clientY: 80 }]);
  assert.equal(oneFinger.cancelled, false);
  assert.equal(oneFinger.stopped, false);
  assert.equal(f.zoom.getScale(), 2);
  assert.match(css, /\.word-image-open\{[^}]*touch-action:pan-y/);
  assert.match(css, /\.word-image-picture\{[^}]*touch-action:pan-y/);
  f.zoom.destroy();
});

test('large gestures clamp image magnification without escaping the picture frame', () => {
  const f = pinchFixture();
  f.fire('touchstart', f.hands(30));
  f.fire('touchmove', f.hands(300));
  assert.equal(f.zoom.getScale(), 4);
  assert.equal(f.flags.has('word-image-is-zoomed'), true);
  f.zoom.destroy();
});

test('iOS GestureEvents prevent browser-page zoom and can zoom the image when touch data is absent', () => {
  const f = pinchFixture();
  const start = f.fire('gesturestart', [], { scale: 1 });
  assert.equal(start.cancelled, true);
  const changed = f.fire('gesturechange', [], { scale: 1.65 });
  assert.equal(changed.cancelled, true);
  assert.ok(Math.abs(f.zoom.getScale() - 1.65) < 0.01);
  f.fire('gestureend', [], { scale: 1.65 });
  f.zoom.reset();
  assert.equal(f.zoom.getScale(), 1);
  f.zoom.destroy();
});
