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

test('next/previous buttons align the color top and correct legacy scroll restoration', () => {
  const events = {};
  const frames = [], later = [];
  const anchorAt = 500;
  const scroll = { y: 900 };
  const anchor = {
    isConnected: true,
    getBoundingClientRect: () => ({ top: anchorAt - scroll.y })
  };
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
    innerHeight: 700,
    get scrollY() { return scroll.y; },
    scrollX: 0,
    scrollTo: option => { scroll.y = typeof option === 'object' ? option.top : arguments[1]; }
  };
  const document = {
    getElementById: id => ({ cardNavScrollAnchor: anchor, cardNavigation: controls, study })[id] || null,
    createElement: () => tail,
    body: { appendChild() {} },
    scrollingElement: { scrollTop: 0 },
    documentElement: { clientHeight: 700 }
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
  assert.equal(window.ColorCardNavTop.prevNext, 'align-card-top');
  const click = id => {
    events.click({ target: { closest: () => ({ id, disabled: false }) } });
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.equal(scroll.y, anchorAt);
    // Simulate older cached card handlers restoring the previous offset.
    scroll.y = 870;
    assert.equal(later.length, 1);
    later.shift()();
    assert.equal(scroll.y, anchorAt);
  };
  click('next');
  click('prev');
  events.click({ target: { closest: () => ({ id: 'shuffle', disabled: false }) } });
  assert.equal(frames.length, 0);
});
