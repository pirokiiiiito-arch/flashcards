'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../plants/index.html'), 'utf8');

// Execute the production handlers, isolated from account, storage and photo I/O.
function gestureSource() {
  const start = html.indexOf('function plantPageIsZoomed()');
  const end = html.indexOf('function renderCard(', start);
  assert.ok(start >= 0 && end > start, 'extract the plant card gesture functions');
  return html.slice(start, end);
}

function fixture({ zoom = 1, editing = false } = {}) {
  const handlers = new Map(), viewportHandlers = new Map();
  const cardClasses = new Set(['card', 'show-back']), pageClasses = new Set();
  const captures = new Set();
  let now = 10000, flips = 0, renders = 0;
  function classes(values, onToggle = () => {}) {
    return {
      contains: name => values.has(name),
      add: (...names) => names.forEach(name => values.add(name)),
      remove: (...names) => names.forEach(name => values.delete(name)),
      toggle(name, force) {
        const enabled = force === undefined ? !values.has(name) : !!force;
        if (enabled) values.add(name); else values.delete(name);
        onToggle(name);
        return enabled;
      }
    };
  }
  const ordinaryTarget = { closest() { return null; } };
  const editableTarget = { closest(selector) {
    return selector.includes('contenteditable') ? this : null;
  } };
  const buttonTarget = { closest(selector) {
    return selector.split(',').includes('button') ? this : null;
  } };
  const card = {
    style: { transform: '' },
    classList: classes(cardClasses, name => { if (name === 'show-back') flips++; }),
    addEventListener(type, handler, options) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push({ handler, options });
    },
    setPointerCapture: id => captures.add(id),
    hasPointerCapture: id => captures.has(id),
    releasePointerCapture: id => captures.delete(id),
    contains: target => [ordinaryTarget, editableTarget, buttonTarget].includes(target)
  };
  const viewport = {
    scale: zoom,
    addEventListener(type, handler) { viewportHandlers.set(type, handler); }
  };
  const context = {
    window: { visualViewport: viewport },
    document: { documentElement: { classList: classes(pageClasses) } },
    editing, pos: 1, order: [0, 1, 2],
    render() { renders++; },
    Date: { now: () => now },
    setTimeout, clearTimeout,
    console
  };
  const sandbox = vm.createContext(context);
  vm.runInContext(gestureSource(), sandbox, { filename: 'plants/index.html gestures' });
  context.bindPlantCardGestures(card);

  function fire(type, extras = {}) {
    const event = {
      type, target: ordinaryTarget, pointerType: 'touch', pointerId: 1,
      clientX: 180, clientY: 250, isPrimary: true,
      cancelable: true, defaultPrevented: false,
      touches: [], changedTouches: [],
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() {},
      ...extras
    };
    const callbacks = handlers.get(type) || [];
    for (const { handler, options } of callbacks) {
      handler(event);
      if (options?.passive) assert.equal(event.defaultPrevented, false, type + ' remains passive');
    }
    return event;
  }
  function pointer(type, id, x, y, extras = {}) {
    return fire(type, { pointerId: id, clientX: x, clientY: y, isPrimary: id === 1, ...extras });
  }
  function touch(type, points, changed = points) {
    const toTouch = ([identifier, clientX, clientY]) => ({ identifier, clientX, clientY });
    return fire(type, { touches: points.map(toTouch), changedTouches: changed.map(toTouch) });
  }
  function swipe(from, to, extras = {}) {
    pointer('pointerdown', 1, from, 250, extras);
    pointer('pointermove', 1, to, 252, extras);
    return pointer('pointerup', 1, to, 252, extras);
  }
  function tap(extras = {}) {
    pointer('pointerdown', 1, 180, 250, extras);
    return pointer('pointerup', 1, 181, 251, extras);
  }
  return {
    context, card, handlers, viewport, viewportHandlers, pageClasses,
    ordinaryTarget, editableTarget, buttonTarget, fire, pointer, touch, swipe, tap,
    advance(ms = 1000) { now += ms; },
    get flips() { return flips; },
    get renders() { return renders; },
    get isBack() { return cardClasses.has('show-back'); }
  };
}

test('plant card allows native pinch and releases both pan axes while magnified', () => {
  assert.match(html, /\.card\{[^}]*touch-action:pan-y pinch-zoom/);
  assert.match(html, /\.plant-page-zoomed \.card\{[^}]*touch-action:auto/);
  const viewport = html.match(/<meta\s+name="viewport"[^>]*>/)?.[0] || '';
  assert.ok(viewport);
  assert.doesNotMatch(viewport, /user-scalable=(?:no|0)|maximum-scale=1(?:[,"\s])/);
  assert.match(html, /bindPlantCardGestures\(card\);/, 'rendered plant cards bind the tested handlers');

  const f = fixture();
  f.context.syncPlantZoomedTouchPolicy();
  assert.equal(f.pageClasses.has('plant-page-zoomed'), false);
  f.viewport.scale = 2.25;
  f.context.syncPlantZoomedTouchPolicy();
  assert.equal(f.pageClasses.has('plant-page-zoomed'), true);
  f.viewport.scale = 1;
  f.context.syncPlantZoomedTouchPolicy();
  assert.equal(f.pageClasses.has('plant-page-zoomed'), false);
});

test('one-finger card tap flips once, including its synthesized click', () => {
  const f = fixture();
  f.tap();
  f.fire('click');
  assert.equal(f.flips, 1);
  assert.equal(f.isBack, false);
  assert.equal(f.renders, 0);
  assert.equal(f.context.pos, 1);
});

test('normal one-finger swipes retain next, previous and wraparound navigation', () => {
  const f = fixture();
  f.swipe(260, 120);
  assert.equal(f.context.pos, 2);
  f.fire('click');
  assert.equal(f.flips, 0);
  f.advance();
  f.swipe(260, 120);
  assert.equal(f.context.pos, 0);
  f.advance();
  f.swipe(120, 260);
  assert.equal(f.context.pos, 2);
  assert.equal(f.renders, 3);
  assert.equal(f.card.style.transform, '');
});

test('vertical scroll does not cancel the browser action or flip or navigate', () => {
  const f = fixture();
  assert.equal(f.pointer('pointerdown', 1, 180, 300).defaultPrevented, false);
  assert.equal(f.pointer('pointermove', 1, 182, 180).defaultPrevented, false);
  assert.equal(f.pointer('pointerup', 1, 182, 180).defaultPrevented, false);
  f.fire('click');
  assert.equal(f.renders, 0);
  assert.equal(f.flips, 0);
  assert.equal(f.card.style.transform, '');
});

test('two-finger pinch stays cancelled through either order of finger release', () => {
  for (const firstReleased of [1, 2]) {
    const f = fixture();
    f.pointer('pointerdown', 1, 150, 250);
    f.touch('touchstart', [[1, 150, 250]]);
    f.pointer('pointerdown', 2, 220, 250);
    f.touch('touchstart', [[1, 150, 250], [2, 220, 250]]);
    assert.equal(f.pointer('pointermove', 1, 70, 250).defaultPrevented, false);
    assert.equal(f.pointer('pointermove', 2, 300, 250).defaultPrevented, false);
    const last = firstReleased === 1 ? 2 : 1;
    assert.equal(f.pointer('pointerup', firstReleased, 180, 250).defaultPrevented, false);
    f.touch('touchend', [[last, 180, 250]], [[firstReleased, 180, 250]]);
    f.pointer('pointermove', last, 50, 250);
    assert.equal(f.pointer('pointerup', last, 50, 250).defaultPrevented, false);
    f.touch('touchend', [], [[last, 50, 250]]);
    f.fire('click');
    assert.equal(f.context.pos, 1, 'remaining finger cannot become a swipe');
    assert.equal(f.renders, 0);
    assert.equal(f.flips, 0, 'pinch cannot become a card flip');
    assert.equal(f.card.style.transform, '');
    f.advance();
    f.tap();
    assert.equal(f.flips, 1, 'a fresh single-finger tap works after pinch ends');
  }
});

test('second finger on an editable photo aborts the first finger card swipe', () => {
  const f = fixture();
  f.pointer('pointerdown', 1, 250, 250);
  f.pointer('pointermove', 1, 225, 250);
  f.pointer('pointerdown', 2, 180, 250, { target: f.editableTarget });
  f.pointer('pointermove', 1, 110, 250);
  f.pointer('pointerup', 2, 180, 250, { target: f.editableTarget });
  f.pointer('pointerup', 1, 110, 250);
  f.fire('click');
  assert.equal(f.context.pos, 1);
  assert.equal(f.renders, 0);
  assert.equal(f.flips, 0);
  assert.equal(f.card.style.transform, '');
});

test('touch count cancels pinch even when another finger has no card pointerdown', () => {
  const f = fixture();
  f.pointer('pointerdown', 1, 240, 250);
  const touchStart = f.touch('touchstart', [[1, 240, 250], [2, 300, 250]]);
  assert.equal(touchStart.defaultPrevented, false);
  f.pointer('pointermove', 1, 100, 250);
  f.pointer('pointerup', 1, 100, 250);
  f.touch('touchend', [[2, 300, 250]], [[1, 100, 250]]);
  f.touch('touchend', [], [[2, 300, 250]]);
  f.fire('click');
  assert.equal(f.renders, 0);
  assert.equal(f.flips, 0);
});

for (const cancelType of ['pointercancel', 'lostpointercapture']) {
  test(cancelType + ' clears drag and prevents a late release or click from acting', () => {
    const f = fixture();
    assert.ok(f.handlers.has(cancelType), 'explicit cancellation handler');
    f.pointer('pointerdown', 1, 250, 250);
    f.pointer('pointermove', 1, 190, 250);
    assert.notEqual(f.card.style.transform, '', 'the test begins during a card drag');
    assert.equal(f.pointer(cancelType, 1, 190, 250).defaultPrevented, false);
    assert.equal(f.card.style.transform, '');
    f.pointer('pointerup', 1, 100, 250);
    f.fire('click');
    assert.equal(f.renders, 0);
    assert.equal(f.flips, 0);
    f.advance();
    f.swipe(250, 100);
    assert.equal(f.context.pos, 2, 'a new gesture is usable after cancellation');
  });
}

test('lost capture followed by release outside the card does not retain a stale pen pointer', () => {
  const f = fixture();
  f.pointer('pointerdown', 10, 250, 250, { pointerType: 'pen', isPrimary: true });
  f.pointer('pointermove', 10, 210, 250, { pointerType: 'pen', isPrimary: true });
  f.pointer('lostpointercapture', 10, 210, 250, { pointerType: 'pen', isPrimary: true });
  // The old pointerup is delivered elsewhere; pen input has no touchend cleanup.
  f.advance();
  f.pointer('pointerdown', 11, 250, 250, { pointerType: 'pen', isPrimary: true });
  f.pointer('pointermove', 11, 110, 250, { pointerType: 'pen', isPrimary: true });
  f.pointer('pointerup', 11, 110, 250, { pointerType: 'pen', isPrimary: true });
  assert.equal(f.context.pos, 2, 'new contact must not be mistaken for a second finger');
  assert.equal(f.renders, 1);
});

test('magnified one-finger pan neither navigates nor cancels native viewport movement', () => {
  const f = fixture({ zoom: 2 });
  assert.equal(f.pointer('pointerdown', 1, 260, 250).defaultPrevented, false);
  assert.equal(f.pointer('pointermove', 1, 110, 252).defaultPrevented, false);
  assert.equal(f.pointer('pointerup', 1, 110, 252).defaultPrevented, false);
  f.fire('click');
  assert.equal(f.renders, 0);
  assert.equal(f.flips, 0);
  assert.equal(f.card.style.transform, '');
  f.viewport.scale = 1;
  f.context.syncPlantZoomedTouchPolicy();
  f.advance();
  f.swipe(260, 110);
  assert.equal(f.context.pos, 2, 'normal card navigation resumes at original scale');
});

test('zoom beginning during a single-pointer drag cancels navigation and clears translation', () => {
  const f = fixture();
  f.pointer('pointerdown', 1, 250, 250);
  f.pointer('pointermove', 1, 220, 250);
  f.viewport.scale = 2;
  f.context.syncPlantZoomedTouchPolicy();
  assert.equal(f.pointer('pointermove', 1, 100, 250).defaultPrevented, false);
  assert.equal(f.pointer('pointerup', 1, 100, 250).defaultPrevented, false);
  f.fire('click');
  assert.equal(f.renders, 0);
  assert.equal(f.flips, 0);
  assert.equal(f.card.style.transform, '');
});

test('editable photos, paste buttons and editing mode keep their existing actions', () => {
  for (const name of ['editableTarget', 'buttonTarget']) {
    const f = fixture();
    f.tap({ target: f[name] });
    f.fire('click', { target: f[name] });
    f.advance();
    f.swipe(250, 100, { target: f[name] });
    assert.equal(f.flips, 0, name);
    assert.equal(f.renders, 0, name);
  }
  const f = fixture({ editing: true });
  f.tap();
  f.fire('click');
  f.swipe(250, 100);
  assert.equal(f.flips, 0);
  assert.equal(f.renders, 0);
});

test('desktop click and a pen tap remain available without visualViewport', () => {
  const f = fixture();
  delete f.context.window.visualViewport;
  f.context.syncPlantZoomedTouchPolicy();
  f.tap({ pointerType: 'mouse' });
  assert.equal(f.flips, 0, 'mouse click, rather than pointerup, owns desktop flipping');
  f.fire('click', { pointerType: 'mouse' });
  assert.equal(f.flips, 1);
  f.advance();
  f.tap({ pointerType: 'pen' });
  f.fire('click', { pointerType: 'pen' });
  assert.equal(f.flips, 2, 'pen contact flips once');
});
