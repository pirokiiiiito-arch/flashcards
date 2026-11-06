'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('moving to another color resets the card face and requests top alignment', () => {
  const app = fs.readFileSync('colors/app-main.js', 'utf8');
  const start = app.indexOf('function change(delta){');
  const end = app.indexOf('function flip(){', start);
  assert.ok(start > -1 && end > start);
  const state = { index: 0, flipped: true };
  let renders = 0, alignments = 0;
  const context = {
    state,
    filtered: () => [10, 20, 30],
    render: () => { renders++; },
    window: { ColorCardNavTop: { align: () => { alignments++; } } }
  };
  vm.createContext(context);
  vm.runInContext(app.slice(start, end), context);
  context.change(1);
  assert.equal(state.index, 1);
  assert.equal(state.flipped, false);
  assert.equal(renders, 1);
  assert.equal(alignments, 1);
  state.flipped = true;
  context.change(-1);
  assert.equal(state.index, 0);
  assert.equal(state.flipped, false);
  assert.equal(alignments, 2);
});

test('next/previous fits the whole front color inside a short iPhone viewport', () => {
  const events = {};
  const frames = [], later = [];
  const anchorAt = 500, swatchAt = 610;
  const scroll = { y: 900 };
  const visualViewport = { height: 460, addEventListener() {} };
  let flipped = false;
  const anchor = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: anchorAt - scroll.y })
  };
  const swatch = {
    style: {height: ''},
    getBoundingClientRect: () => ({
      top: swatchAt - scroll.y,
      height: Number.parseFloat(swatch.style.height) || 400
    })
  };
  const cardArea = {classList: {contains: cls => cls === 'flipped' && flipped}};
  const controls = {
    contains: () => true,
    addEventListener: (name, callback) => { events[name] = callback; }
  };
  const study = { classList: { contains: () => false } };
  const tail = {
    style: { height: '' },
    setAttribute() {},
    getBoundingClientRect: () => ({ top: 1050 - scroll.y })
  };
  const window = {
    innerHeight: 500,
    innerWidth: 390,
    visualViewport,
    addEventListener() {},
    get scrollY() { return scroll.y; },
    scrollX: 0,
    scrollTo: (first, second) => {
      scroll.y = typeof first === 'object' ? first.top : second;
    }
  };
  const elements = {cardNavScrollAnchor: anchor, cardNavigation: controls, study, swatch, cardArea};
  const document = {
    getElementById: id => elements[id] || null,
    createElement: () => tail,
    body: { appendChild() {} },
    scrollingElement: { scrollTop: 0 },
    documentElement: { clientHeight: 500, clientWidth: 390 }
  };
  const context = {
    window, document, Object,
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; },
    cancelAnimationFrame() {},
    setTimeout: fn => { later.push(fn); return later.length; },
    clearTimeout() {},
    MutationObserver: class { observe() {} }
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('colors/nav-top.js', 'utf8'), context);
  assert.equal(window.ColorCardNavTop.prevNext, 'fit-and-align-complete-front');
  frames.shift()(); // Initial card fit.
  assert.equal(swatch.style.height, '338px'); // 460px viewport - 110px navigation - 12px margin.
  const click = id => {
    scroll.y = 900;
    events.click({ target: { closest: () => ({ id, disabled: false }) } });
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.equal(scroll.y, anchorAt);
    assert.equal(swatch.getBoundingClientRect().top, 110);
    assert.ok(swatch.getBoundingClientRect().top +
      swatch.getBoundingClientRect().height <= visualViewport.height - 12);
    // Simulate a cached handler undoing the scroll after the new card renders.
    scroll.y = 870;
    assert.equal(later.length, 1);
    later.shift()();
    assert.equal(scroll.y, anchorAt);
  };
  click('next');
  click('prev');
  events.click({ target: { closest: () => ({ id: 'shuffle', disabled: false }) } });
  assert.equal(frames.length, 0);
  // Viewport changes on iPhone due to Safari's address bar.
  visualViewport.height = 380;
  window.ColorCardNavTop.fit();
  assert.equal(swatch.style.height, '258px');
  // Bigger screens use up to the existing desktop 600px rather than 400px.
  window.innerWidth = 900;
  visualViewport.height = 750;
  window.ColorCardNavTop.fit();
  assert.equal(swatch.style.height, '600px');
  // The backside stays naturally scrollable and is never resized.
  flipped = true;
  visualViewport.height = 380;
  window.ColorCardNavTop.fit();
  assert.equal(swatch.style.height, '600px');
});
