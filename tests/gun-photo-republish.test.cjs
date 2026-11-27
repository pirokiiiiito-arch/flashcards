'use strict';

// Run the generated production gun core against in-memory Drive and browser
// boundaries. Synthetic refs carry no actual image bytes or user information.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {Element, database, driveServer, tick} = require('./mock-runtime.cjs');

const source = fs.readFileSync(path.join(__dirname, '../guns/drive-transfer-core.js'), 'utf8');
const NAMESPACE = 'gun-flashcards-v1';
const KEY = 'image:gun-0003:0';
const ref = name => 'gdrive:synthetic-' + name + ':' + 'a'.repeat(64);
const plain = value => JSON.parse(JSON.stringify(value));

function replica(server, initial = {}, options = {}) {
  const db = database(), storage = new Map(), body = new Element('body'), toolbar = new Element();
  let local = structuredClone(initial), editing = false, authCallback, authWork, timerId = 0;
  if (options.missingJournal) {
    // Model the reported repair case: saved references and their snapshot
    // survived, but no corresponding immutable journal event was registered.
    db.dbs.set('flashcards_drive_cache_v3', new Map([
      ['states', new Map([[NAMESPACE, {
        events: {}, pending: [], seen: {}, imports: {}, account: 'account1',
        clock: 0, initialized: true, basis: {}, snapshot: structuredClone(initial)
      }]])],
      ['blobs', new Map()]
    ]));
  }
  const document = {
    body, head: new Element('head'), visibilityState: 'visible',
    createElement: tag => new Element(tag), querySelector: () => toolbar,
    addEventListener() {}
  };
  const context = {
    console, document, indexedDB: db.indexedDB, crypto: crypto.webcrypto,
    TextEncoder, TextDecoder, Blob, Headers, Response, URL, URLSearchParams,
    structuredClone, location: {protocol: 'https:', hostname: 'example.github.io'},
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    fetch: (url, opts) => server.fetch(url, opts),
    // Tests explicitly run sync; background timers must not mask a race.
    setTimeout: () => ++timerId, clearTimeout() {}, addEventListener() {},
    FLASHCARDS_DRIVE_CONFIG: {clientId: 'synthetic.apps.googleusercontent.com'},
    google: {accounts: {oauth2: {
      hasGrantedAllScopes: () => true,
      initTokenClient(value) {
        authCallback = value.callback;
        return {requestAccessToken() {
          authWork = authCallback({access_token: 'synthetic-token', expires_in: 3600});
          return authWork;
        }};
      }
    }}}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, {filename: 'guns/drive-transfer-core.js'});
  const api = context.FlashcardsDrive.install({
    namespace: NAMESPACE, toolbar: '.toolbar', ready: Promise.resolve(),
    primary: () => true, enablePrimary: async () => {},
    read: () => structuredClone(local), toCloudValue: async (_key, value) => value,
    isEditing: () => editing, prepareApply: view => view,
    apply(view) {
      // Match the adapter's distinction between missing data and tombstones.
      local = {...local, ...structuredClone(view.data)};
      for (const key of Object.keys(view.deleted)) delete local[key];
    }
  });
  return {
    api,
    get local() {return structuredClone(local);},
    set local(value) {local = structuredClone(value); api.changed();},
    setEditing(value) {editing = value;},
    async connect() {
      toolbar.children[0].onclick(); await tick();
      body.children[0].querySelector('[data-connect]').onclick();
      await authWork;
      assert.equal(api.valid(), true);
      assert.equal(typeof api.republishSaved, 'function');
    }
  };
}

function journals(server) {
  return [...server.files.values()].filter(file => file.appProperties.kind === 'journal');
}

async function connectedPair() {
  const server = driveServer(), a = replica(server, {[KEY]: ref('old')}), b = replica(server);
  await a.connect(); await b.connect();
  return {server, a, b};
}

test('saved-reference repair publishes an unregistered reference once', async () => {
  const server = driveServer();
  const a = replica(server, {[KEY]: ref('unregistered')}, {missingJournal: true});
  await a.connect();
  assert.equal(journals(server).length, 0);
  assert.equal(a.local[KEY], ref('unregistered'));
  assert.equal(await a.api.republishSaved([KEY, 'image:unknown:0']), 1);
  await a.api.sync();
  assert.equal(journals(server).length, 1);
  const events = journals(server).flatMap(file => JSON.parse(file.content).events);
  assert.equal(events.length, 1);
  assert.equal(events[0].key, KEY);
  assert.equal(events[0].value, ref('unregistered'));
  const b = replica(server); await b.connect();
  assert.equal(b.local[KEY], ref('unregistered'));
});

test('saved-reference repair can resend an identical registration without changing its value', async () => {
  const {server, a} = await connectedPair();
  const before = journals(server).length;
  const imageCount = [...server.files.values()].filter(file => file.appProperties.kind === 'image').length;
  assert.equal(await a.api.republish([KEY], {preserveRemote: true}), 1);
  await a.api.sync();
  assert.equal(journals(server).length, before + 1);
  assert.equal(a.local[KEY], ref('old'));
  assert.equal([...server.files.values()].filter(file => file.appProperties.kind === 'image').length, imageCount);
  assert.equal(a.api.status().conflicts, 0);
});

test('saved-reference repair restores a missing Drive journal despite the sender retaining its old event', async () => {
  const server = driveServer(), a = replica(server, {[KEY]: ref('old')});
  await a.connect();
  for (const journal of journals(server)) server.files.delete(journal.id);
  assert.equal(journals(server).length, 0);
  await a.api.sync();
  assert.equal(a.api.view().data[KEY], ref('old'), 'pull retains prior local events');
  assert.equal(await a.api.republishSaved([KEY]), 1);
  await a.api.sync();
  assert.equal(journals(server).length, 1);
  const b = replica(server); await b.connect();
  assert.equal(b.local[KEY], ref('old'), 'a fresh receiver can find the repaired registration');
});

test('saved-reference repair preserves a different value changed on another device', async () => {
  const {server, a, b} = await connectedPair();
  b.local = {[KEY]: ref('new')}; await b.api.sync();
  const before = journals(server).length;
  assert.equal(a.local[KEY], ref('old'));
  assert.equal(await a.api.republishSaved([KEY]), 0);
  assert.equal(a.api.view().data[KEY], ref('new'));
  await a.api.sync();
  assert.equal(a.local[KEY], ref('new'));
  assert.equal(journals(server).length, before);
});

test('saved-reference repair cannot revive an already known tombstone from a stale local view', async () => {
  const {server, a, b} = await connectedPair();
  b.local = {}; await b.api.sync();
  // A sync may pull history while an editor delays applying it to the deck.
  a.setEditing(true); await a.api.sync(); a.setEditing(false);
  assert.equal(a.local[KEY], ref('old'));
  assert.ok(a.api.view().deleted[KEY]);
  const before = journals(server).length;
  assert.equal(await a.api.republishSaved([KEY]), 0);
  await a.api.sync();
  assert.equal(a.local[KEY], undefined);
  assert.ok(a.api.view().deleted[KEY]);
  assert.equal(journals(server).length, before);
});

test('saved-reference repair checks deletions first received by its own pull', async () => {
  const {server, a, b} = await connectedPair();
  b.local = {}; await b.api.sync();
  assert.equal(a.local[KEY], ref('old'));
  assert.equal(a.api.view().deleted[KEY], undefined);
  const before = journals(server).length;
  assert.equal(await a.api.republishSaved([KEY]), 0);
  assert.ok(a.api.view().deleted[KEY], 'republish must have pulled the new deletion');
  assert.equal(a.api.view().data[KEY], undefined);
  assert.deepEqual(plain(a.api.pendingKeys()), []);
  await a.api.sync(); await b.api.sync();
  assert.equal(a.local[KEY], undefined);
  assert.equal(b.local[KEY], undefined);
  assert.equal(journals(server).length, before);
});

test('ordinary explicit republish retains its existing replacement semantics', async () => {
  const {a, b} = await connectedPair();
  b.local = {}; await b.api.sync();
  assert.equal(await a.api.republish([KEY]), 1);
  await a.api.sync(); await b.api.sync();
  assert.equal(a.local[KEY], ref('old'));
  assert.equal(b.local[KEY], ref('old'));
  assert.equal(a.api.view().deleted[KEY], undefined);
});
