'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const code = fs.readFileSync(path.join(__dirname, '../reader/wh1/all/wh1-display-check-v9.js'), 'utf8');
const REVISION = 'figure-viewport-v9-20261110';
const source = '<html><head></head><body><main id="reader-page"><p>合成テキスト</p><img src="fixture.svg"></main></body></html>';
const plain = value => JSON.parse(JSON.stringify(value));
const stripProbe = html => html.replace(/<script id="wh1-display-check-probe9-1">[\s\S]*?<\/script>/g, '');
const scriptOf = html => html.match(/<script id="wh1-display-check-probe9-1">([\s\S]*?)<\/script>/)[1];
const tokenOf = html => scriptOf(html).match(/\)\("([^"]+)"\);$/)[1];

function harness({parentRevision = REVISION, module = true} = {}) {
  const nodes = new Map(), handlers = new Map();
  class Element {
    constructor(tag) {this.tagName = tag; this.children = []; this.attributes = {}; this.events = {}; this.hidden = false; this.textContent = ''; this.style = {};}
    set id(value) {this._id = value; nodes.set(value, this);}
    get id() {return this._id;}
    append(...children) {this.children.push(...children);}
    setAttribute(name, value) {this.attributes[name] = value;}
    addEventListener(name, fn) {this.events[name] = fn;}
    focus() {}
  }
  const frame = new Element('iframe'); frame.id = 'reader';
  frame.style = Object.freeze({width: '100%', height: '100svh'});
  frame.attributes = Object.freeze({sandbox: 'allow-scripts'});
  frame.setAttribute = () => {throw Error('Existing iframe markup must not change');};
  const messages = [];
  frame.contentWindow = {postMessage: data => messages.push(plain(data))};
  const document = {body: new Element('body'), head: new Element('head'),
    createElement: tag => new Element(tag), getElementById: id => nodes.get(id) || null,
    addEventListener() {}};
  const fallback = new Element('aside'); fallback.id = 'wh1-display-check-fallback';
  fallback.textContent = '確認9.1 · 確認待ち';
  document.body.append(frame, fallback);
  const create = () => 'original-create';
  const decorate = html => html.replace('</head>', '<!-- existing decorator --></head>');
  const window = {WH1FigureViewportRevision: parentRevision,
    addEventListener: (name, fn) => handlers.set(name, fn)};
  if (module) window.WH1ExactPager = {create, decorate};
  const context = {window, document, Date, console};
  for (const name of ['localStorage', 'sessionStorage', 'indexedDB', 'caches', 'fetch']) {
    Object.defineProperty(window, name, {get() {throw Error('Forbidden access: ' + name);}});
    Object.defineProperty(context, name, {get() {throw Error('Forbidden access: ' + name);}});
  }
  vm.createContext(context); vm.runInContext(code, context);
  return {window, context, document, frame, messages, nodes, create, decorate,
    state: () => plain(window.WH1DisplayCheck.getState()),
    send: (data, sender = frame.contentWindow) => handlers.get('message')({source: sender, data})};
}

function probe(html, {first = 11, last = 30, badge = true, installed = true, statusScan = 22, pageType = 'illustration'} = {}) {
  const data = Array.from({length: 99}, () => ({scan: 22}));
  data[0].scan = first; data[98].scan = last;
  for (const item of data) {
    Object.defineProperty(item, 'text', {get() {throw Error('Book prose must not be read');}});
    Object.defineProperty(item, 'image', {get() {throw Error('Book pictures must not be read');}});
    Object.freeze(item);
  }
  Object.freeze(data);
  const reports = [], listeners = new Map();
  const parent = {postMessage: report => reports.push(plain(report))};
  const child = {parent, addEventListener: (name, fn) => listeners.set(name, fn),
    __WH1_VIEWPORT9_STATUS__: {revision: REVISION, scan: statusScan, boundsCheck: 'inside'}};
  if (installed) child.__WH1_FIGURE_VIEWPORT_V9__ = REVISION;
  const document = {getElementById: id => id === 'reader-page' || (id === 'wh1-display-revision9' && badge) ? {} : null,
    createElement() {throw Error('Child DOM must not be changed');}};
  vm.runInNewContext(scriptOf(html), {window: child, document, blocks: data,
    pages: [{type: pageType, scan: 22}], currentPage: 0, makeIllustration() {}, showPage() {}});
  return {reports, parent, child, listeners};
}

test('dedicated UI preserves iframe, existing decoration, count creator and private state', () => {
  const h = harness();
  assert.equal(h.window.WH1ExactPager.create, h.create, 'count-frame creator is not wrapped');
  const decorated = h.window.WH1ExactPager.decorate(source);
  assert.equal(stripProbe(decorated), h.decorate(source), 'only the diagnostic probe is added to visible HTML');
  const again = h.window.WH1ExactPager.decorate(decorated);
  assert.equal((again.match(/id="wh1-display-check-probe9-1"/g) || []).length, 1);
  assert.notEqual(tokenOf(again), tokenOf(decorated), 'each navigation gets a new token');
  assert.equal(h.document.body.children[0], h.frame);
  assert.deepEqual(h.frame.style, {width: '100%', height: '100svh'});
  assert.deepEqual(h.frame.attributes, {sandbox: 'allow-scripts'});
  assert.match(h.nodes.get('wh1-display-check-button').textContent, /^確認9\.1 · 読込9 · 図版未確認$/);
  assert.equal(h.nodes.get('wh1-display-check-fallback').hidden, true, 'real UI replaces the static load-failure marker');
  const previous = h.window.WH1ExactPager;
  vm.runInContext(code, h.context);
  assert.equal(h.window.WH1ExactPager, previous, 'module installation is idempotent');
});

test('current source plus navigation token are required; untokened v9 messages only request a probe', () => {
  const h = harness(), html = h.window.WH1ExactPager.decorate(source);
  const valid = probe(html).reports[0];
  h.send(valid, {});
  h.send({...valid, token: 'old-token'});
  h.send({...valid, guard: 'invented-pass'});
  assert.equal(h.state().childStatus, 'unverified');
  h.send({wh1bridge: 1, type: 'wh1ViewportVersion', revision: REVISION, boundsCheck: 'inside'});
  assert.equal(h.state().childStatus, 'unverified');
  assert.deepEqual(h.messages.at(-1), {wh1DisplayCheck: 1, action: 'probe', token: tokenOf(html)});
  h.send({...valid, bookText: 'MUST NOT APPEAR', image: 'PRIVATE IMAGE', paintVerified: true});
  assert.equal(h.state().childStatus, 'applied');
  assert.equal(h.state().boundsCheck, 'inside');
  assert.equal(h.state().paintVerified, false, 'bounds do not certify appearance');
  assert.equal(JSON.stringify(h.state()).includes('MUST NOT APPEAR'), false);
  const next = h.window.WH1ExactPager.decorate(source);
  h.send(valid);
  assert.equal(h.state().childStatus, 'unverified', 'old current-window messages are rejected after navigation');
  h.send(probe(next).reports[0]);
  assert.equal(h.state().childStatus, 'applied');
});

test('loaded parent v9 can report unapplied or incomplete child without asserting an old parent', () => {
  const h = harness(), html = h.window.WH1ExactPager.decorate(source);
  h.send(probe(html, {first: 10, installed: false}).reports[0]);
  assert.equal(h.state().parentRevision, REVISION);
  assert.equal(h.state().guard, 'outside-range');
  assert.equal(h.state().childStatus, 'not-applied');
  assert.equal(h.state().boundsCheck, 'unverified');
  h.send(probe(html, {installed: false}).reports[0]);
  assert.equal(h.state().guard, 'not-installed');
  h.send(probe(html, {badge: false}).reports[0]);
  assert.equal(h.state().guard, 'installation-incomplete');
  assert.equal(h.state().childStatus, 'unverified');
  h.send({...probe(html).reports[0], childRevision: 'figure-viewport-v8-20261110'});
  assert.equal(h.state().guard, 'different-revision');
  assert.equal(h.state().boundsCheck, 'unverified');
});

test('probe reports only metadata, requires parent/token requests, and does not reuse other-scan bounds', () => {
  const h = harness(), html = h.window.WH1ExactPager.decorate(source);
  const p = probe(html, {statusScan: 18});
  assert.equal(p.reports[0].boundsCheck, 'unverified');
  assert.equal(p.reports[0].scan, 22);
  assert.equal(p.reports[0].blocksCount, 99);
  const sameScanText = probe(html, {pageType: 'text', statusScan: 22});
  assert.equal(sameScanText.reports[0].guard, 'applied', 'installed module is separate from current page geometry');
  assert.equal(sameScanText.reports[0].boundsCheck, 'unverified', 'same-scan text cannot reuse previous figure bounds');
  assert.deepEqual(Object.keys(p.reports[0]).sort(), ['wh1DisplayCheck', 'type', 'token', 'childRevision', 'guard', 'scan', 'firstScan', 'lastScan', 'blocksCount', 'boundsCheck'].sort());
  const request = {wh1DisplayCheck: 1, action: 'probe', token: tokenOf(html)};
  p.listeners.get('message')({source: {}, data: request});
  p.listeners.get('message')({source: p.parent, data: {...request, token: 'old'}});
  assert.equal(p.reports.length, 1);
  p.listeners.get('message')({source: p.parent, data: request});
  assert.equal(p.reports.length, 2);
});

test('missing parent decorator remains unverified and does not create a replacement renderer', () => {
  const h = harness({module: false, parentRevision: null});
  assert.equal(h.window.WH1ExactPager, undefined);
  assert.equal(h.state().parentRevision, null);
  assert.equal(h.state().guard, 'parent-module-unverified');
  assert.equal(h.state().childStatus, 'unverified');
  assert.equal(h.state().paintVerified, false);
});
