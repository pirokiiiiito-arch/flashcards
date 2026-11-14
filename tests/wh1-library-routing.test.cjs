'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const routing = require('../reader/library/wh1-reader-routing.js');
const directory = path.join(__dirname, '../reader/library');
const app = fs.readFileSync(path.join(directory, 'app.js'), 'utf8');
const read = fs.readFileSync(path.join(directory, 'read.html'), 'utf8');
const index = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
const between = (text, start, end) => {
  const from = text.indexOf(start), to = text.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, 'expected application function boundaries');
  return text.slice(from, to);
};
const loadCode = between(read, 'async function loadBook(', 'function positionText(');
const recoverCode = between(read, 'async function recoverSavedBook()', "window.addEventListener('pageshow',recoverSavedBook)");
const positionCode = between(read, "const POSITION_KEY='BOOK_POSITION_'+BOOK_ID;", '// Offline book storage:');
const dbReadCode = read.match(/async function dbRead\(\)\{[^\n]+\}/)[0];
const hrefCode = app.match(/function readerHref\(book\)\{[^\n]+\}/)[0];
const primaryCode = between(app, 'async function primaryAction()', 'function readerHref(');
const downloadCode = between(app, 'async function download(book)', 'function registerSW()');
const manifest = title => ({title, range: [1, 274], segments: Array.from({length: 14}, () => ({}))});
const savedPosition = {segment: 1, key: 'ill:55:0', scan: 22, size: 20};

function readerHarness({id, pathname = '/flashcards/reader/library/read.html', title = '世界の歴史1'}) {
  const calls = [], reads = [], writes = [], nodes = new Map();
  const $ = name => {if (!nodes.has(name)) nodes.set(name, {style: {}, hidden: true}); return nodes.get(name);};
  const values = new Map([['BOOK_POSITION_' + id, JSON.stringify(savedPosition)]]);
  const context = {BOOK_ID: id, window: {WH1ReaderRouting: routing}, location: {pathname, replace: href => calls.push(['replace', href])},
    SEGMENTS: Array(14).fill({}), currentState: {segment: 0, key: '', scan: 1, size: 20}, bookZip: null, $,
    localStorage: {getItem: key => {reads.push(key); return values.get(key) || null;},
      setItem: (key, value) => writes.push([key, value]), removeItem() {throw Error('Position deletion is forbidden');}},
    LibraryDB: {findBlob: async key => {calls.push(['findBlob', key]); return {blob: new Blob(['saved']), meta: {id: key}};}},
    setBusy: () => {}, clearBusy: () => {}, setHint: text => calls.push(['hint', text]),
    fillManifest: () => calls.push(['fillManifest']),
    saveCurrentBook: async () => calls.push(['saveCurrentBook']),
    setStorageState: () => calls.push(['storageStatus']),
    openSegment: async (segment, destination) => calls.push(['open', segment, {...destination}]),
    ZipBook: class {
      async index() {calls.push(['indexZip']); return this;}
      async readText(name) {assert.equal(name, 'manifest.json'); calls.push(['readManifest']); return JSON.stringify(manifest(title));}
    }
  };
  for (const key of ['indexedDB', 'caches']) Object.defineProperty(context, key, {get() {throw Error('Unexpected database/cache access: ' + key);}});
  vm.createContext(context);
  vm.runInContext(positionCode + '\n' + dbReadCode + '\n' + loadCode + '\n' + recoverCode, context);
  return {context, calls, reads, writes, values};
}

test('exact normalized WH1 identity routes without substituting opaque book IDs', () => {
  for (const book of [
    {id: 'wh1', title: '登録済みの本'}, {id: 'g_AbC_-123', title: '世界の歴史1'},
    {id: 'g_fullwidth', title: ' 世界の歴史　１ '}, {id: 'g_spaces', title: '世 界 の 歴 史 1'}
  ]) {
    assert.equal(routing.isBook(book), true);
    const url = new URL(routing.href(book), 'https://example.test/flashcards/reader/library/');
    assert.equal(url.pathname, '/flashcards/reader/library/read-wh1-v9.html');
    assert.equal(url.searchParams.get('id'), book.id);
    assert.equal(url.pathname.includes('/all/'), false);
  }
  for (const title of ['世界の歴史2', '世界の歴史10', '世界の歴史１の資料', '世界の歴史Ⅰ', '別の書籍']) {
    const book = {id: 'g_other', title};
    assert.equal(routing.isBook(book), false);
    assert.equal(routing.href(book), './read.html?id=g_other');
  }
});

test('saved manifest and exact legacy path gates prevent broad matches and redirect loops', () => {
  const valid = manifest('世界の歴史１');
  Object.freeze(valid.range); Object.freeze(valid.segments); Object.freeze(valid);
  assert.equal(routing.isManifest(valid), true);
  for (const invalid of [manifest('世界の歴史2'), manifest('世界の歴史10'),
    {...valid, range: [1, 273]}, {...valid, range: [1, '274']}, {...valid, segments: Array(13).fill({})}]) {
    assert.equal(routing.isManifest(invalid), false);
  }
  const args = {id: 'g_existing', manifest: valid, isSaved: true};
  assert.equal(routing.compatibilityHref({...args, pathname: '/flashcards/reader/library/read.html'}), './read-wh1-v9.html?id=g_existing');
  assert.equal(routing.compatibilityHref({...args, pathname: '/flashcards/reader/library/read.html', isSaved: false}), null);
  for (const pathname of ['/flashcards/reader/library/read-wh1-v9.html', '/flashcards/reader/library/index.html', '/flashcards/reader/wh1/all/', '/flashcards/reader/library/read.html.other']) {
    assert.equal(routing.compatibilityHref({...args, id: 'wh1', pathname}), null);
  }
});

test('canonical legacy recovery forwards before opening any database or reading/writing position', async () => {
  const h = readerHarness({id: 'wh1'});
  await h.context.recoverSavedBook();
  assert.deepEqual(h.calls, [['replace', './read-wh1-v9.html?id=wh1']]);
  assert.deepEqual(h.reads, []); assert.deepEqual(h.writes, []);
  assert.equal(h.context.bookZip, null);
});

test('saved g_* WH1 forwards after manifest verification but before book setup or position mutation', async () => {
  const h = readerHarness({id: 'g_original_ABC'});
  await h.context.recoverSavedBook();
  assert.deepEqual(h.calls, [['findBlob', 'g_original_ABC'], ['indexZip'], ['readManifest'], ['replace', './read-wh1-v9.html?id=g_original_ABC']]);
  assert.deepEqual(h.reads, []); assert.deepEqual(h.writes, []);
  assert.equal(h.context.bookZip, null);
});

test('new entry restores the original ID, stored position and 20px without migration or resaving', async () => {
  for (const id of ['wh1', 'g_original_ABC']) {
    const h = readerHarness({id, pathname: '/flashcards/reader/library/read-wh1-v9.html'});
    await h.context.recoverSavedBook();
    assert.deepEqual(h.calls[0], ['findBlob', id]);
    assert.equal(h.calls.some(([name]) => name === 'replace' || name === 'saveCurrentBook'), false);
    assert.deepEqual(h.reads, ['BOOK_POSITION_' + id]); assert.deepEqual(h.writes, []);
    assert.equal(h.context.currentState.size, 20);
    assert.deepEqual(h.calls.find(([name]) => name === 'open'), ['open', 1, {key: 'ill:55:0', scan: 22}]);
  }
});

test('manual unsaved import and other saved books keep their existing flows', async () => {
  const imported = readerHarness({id: 'g_manual'});
  await imported.context.loadBook(new Blob(['unsaved']), true);
  assert.equal(imported.calls.some(([name]) => name === 'replace'), false);
  assert.equal(imported.calls.filter(([name]) => name === 'saveCurrentBook').length, 1, 'existing manual save flow is retained');
  assert.equal(imported.calls.some(([name]) => name === 'open'), true);
  const other = readerHarness({id: 'g_world2', title: '世界の歴史2'});
  await other.context.recoverSavedBook();
  assert.equal(other.calls.some(([name]) => name === 'replace' || name === 'saveCurrentBook'), false);
  assert.deepEqual(other.reads, ['BOOK_POSITION_g_world2']); assert.deepEqual(other.writes, []);
  assert.equal(other.context.currentState.size, 20);
});

test('both actual bookshelf saved-open and completed-download paths use routing with the same ID', async () => {
  for (const book of [{id: 'wh1', title: '世界の歴史1'}, {id: 'g_existing', title: '世界の歴史１'}, {id: 'g_other', title: '世界の歴史2'}]) {
    const nodes = new Map(), actions = [];
    const $ = id => {if (!nodes.has(id)) nodes.set(id, {style: {}}); return nodes.get(id);};
    const selected = {...book, parts: [{id: 'fixture_file', size: 4}], totalBytes: 4};
    const location = {};
    const c = {window: {WH1ReaderRouting: routing}, selected, savedIds: new Set([book.id]), location,
      $, pendingDownload: null, Blob, Uint8Array, AbortController, DOMException,
      nice: String, renderShelf() {}, say() {}, closeSheet() {}, openSettings() {},
      LibraryDB: {CHUNK: 4, newWriter: async target => {
        assert.equal(target.id, book.id);
        return {write: async () => {}, commit: async () => actions.push('commit'), abort: async () => actions.push('abort')};
      }, readBlob: async id => {assert.equal(id, book.id); return {blob: new Blob([new Uint8Array(4)])};},
      removeBook() {throw Error('Successful routing must not remove a book');}},
      driveRequest: async () => ({arrayBuffer: async () => new Uint8Array(4).buffer}),
      assertZip: async () => actions.push('verified')};
    vm.createContext(c); vm.runInContext(hrefCode + '\n' + primaryCode + '\n' + downloadCode, c);
    await c.primaryAction();
    assert.equal(location.href, routing.href(book));
    location.href = '';
    await c.download(selected);
    assert.equal(location.href, routing.href(book));
    assert.deepEqual(actions, ['commit', 'verified']);
  }
});

test('versioned shelf helper/app and fresh service-worker updates leave generic reader storage contracts intact', () => {
  const helper = './wh1-reader-routing.js?v=wh1-library-v9-20261110';
  assert.ok(index.indexOf(helper) >= 0 && index.indexOf(helper) < index.indexOf('./app.js?v=bookshelf-title-order-v2-20261114'));
  assert.ok(read.includes(helper));
  assert.ok(read.includes('<script src="./wh1-exact-pagination.js"></script>'), 'generic paginator is not replaced for other books');
  for (const code of [app, read]) assert.match(code, /register\('\.\/sw\.js',\{scope:'\.\/',updateViaCache:'none'\}\)/);
  assert.match(read, /const POSITION_KEY='BOOK_POSITION_'\+BOOK_ID/);
  assert.match(read, /LibraryDB\.findBlob\(BOOK_ID\)/);
  assert.match(read, /size:20/);
});
