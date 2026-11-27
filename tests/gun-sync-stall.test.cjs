'use strict';

// Real generated gun core, synthetic in-memory Drive/browser boundaries only.
// Deliberately unfinished fetches, response bodies and IndexedDB transactions
// exercise deadline handling without touching credentials or private records.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const {Element, database, driveServer, tick} = require('./mock-runtime.cjs');

const source = fs.readFileSync(path.join(__dirname, '../guns/drive-transfer-core.js'), 'utf8');
const KEY = 'card:gun-synthetic-stall';
const PRIVATE_TEXT = 'synthetic-private-card-body-not-for-diagnostics';
const TOKEN = 'synthetic-bearer-token-not-for-diagnostics';

function faultDatabase() {
  const base = database();
  const control = {hangOpen: false, opens: 0, hangWrites: false, stalled: 0, aborted: 0};
  function wrap(handle) {
    return {...handle, transaction(store, mode) {
      if (!control.hangWrites || mode !== 'readwrite') return handle.transaction(store, mode);
      control.stalled++;
      const transaction = {
        objectStore() {return {get() {return {};}, put() {return {};}};},
        abort() {control.aborted++; transaction.onabort?.();}
      };
      return transaction;
    }};
  }
  const indexedDB = {open(name, version) {
    control.opens++;
    if (control.hangOpen) return {};
    const request = {}, original = base.indexedDB.open(name, version);
    original.onupgradeneeded = event => {
      request.result = wrap(original.result);
      request.onupgradeneeded?.(event);
    };
    original.onsuccess = event => {
      request.result = wrap(original.result);
      request.onsuccess?.(event);
    };
    original.onerror = event => {request.error = original.error; request.onerror?.(event);};
    original.onblocked = event => request.onblocked?.(event);
    return request;
  }};
  return {indexedDB, control};
}

function replica(server, initial = {}, options = {}) {
  const db = faultDatabase(), storage = new Map(), body = new Element('body'), toolbar = new Element();
  db.control.hangOpen = options.hangOpen === true;
  const fault = {fetch: false, uploadBody: false, storageAfterJournal: false};
  let local = structuredClone(initial), authCallback, authWork, requests = 0;
  const document = {
    body, head: new Element('head'), visibilityState: 'visible',
    createElement: tag => new Element(tag), querySelector: () => toolbar,
    addEventListener() {}
  };
  async function fetcher(url, options) {
    requests++;
    if (fault.fetch) return new Promise(() => {}); // Ignores abort like a stalled browser API.
    const response = await server.fetch(url, options);
    const parsed = new URL(url), id = parsed.pathname.split('/').pop();
    if (fault.storageAfterJournal && server.files.get(id)?.appProperties.kind === 'journal') {
      db.control.hangWrites = true;
    }
    if (fault.uploadBody && parsed.pathname === '/upload/drive/v3/files') {
      // Drive accepted and stored the journal; the acknowledgement body never
      // completes. The core must not discard its pending event on HTTP 200.
      return new Response(new ReadableStream({start(controller) {
        controller.enqueue(new TextEncoder().encode('{"id":'));
      }}), {status: 200, headers: {'Content-Type': 'application/json'}});
    }
    return response;
  }
  const context = {
    console, document, indexedDB: db.indexedDB, crypto: crypto.webcrypto,
    TextEncoder, TextDecoder, Blob, Headers, Response, URL, URLSearchParams,
    AbortController, AbortSignal, ReadableStream, structuredClone,
    location: {protocol: 'https:', hostname: 'example.github.io'},
    localStorage: {
      getItem: key => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, String(value))
    },
    fetch: fetcher,
    // Keep short real IO deadlines; ordinary background retries and token
    // expiry are driven explicitly, so they cannot mask a stuck sync promise.
    setTimeout: (fn, ms) => ms > 500 ? {deferred: true} : setTimeout(fn, ms),
    clearTimeout: timer => {if (!timer?.deferred) clearTimeout(timer);},
    addEventListener() {},
    FLASHCARDS_DRIVE_CONFIG: {clientId: 'synthetic.apps.googleusercontent.com'},
    google: {accounts: {oauth2: {
      hasGrantedAllScopes: () => true,
      initTokenClient(value) {
        authCallback = value.callback;
        return {requestAccessToken() {
          authWork = authCallback({access_token: TOKEN, expires_in: 3600});
          return authWork;
        }};
      }
    }}}
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context, {filename: 'guns/drive-transfer-core.js'});
  assert.equal(typeof context.GunSyncIOFactory?.create, 'function', 'The generated core must include its production IO helper');
  context.GunSyncIO = context.GunSyncIOFactory.create({
    fetcher, indexedDB: db.indexedDB, networkTimeoutMs: 30, storageTimeoutMs: 30
  });
  const api = context.FlashcardsDrive.install({
    namespace: 'gun-flashcards-stall-test', toolbar: '.toolbar', ready: Promise.resolve(),
    primary: () => true, enablePrimary: async () => {},
    read: () => structuredClone(local), toCloudValue: async (_key, value) => value,
    prepareApply: view => view.data,
    apply(data) {local = structuredClone(data);}
  });
  return {
    api, fault, db,
    get requests() {return requests;},
    get local() {return structuredClone(local);},
    set local(value) {local = structuredClone(value); api.changed();},
    async connect() {
      toolbar.children[0].onclick(); await tick();
      body.children[0].querySelector('[data-connect]').onclick();
      await authWork;
      assert.equal(api.valid(), true);
    }
  };
}

function journalEvents(server) {
  return [...server.files.values()]
    .filter(file => file.appProperties.kind === 'journal')
    .flatMap(file => JSON.parse(file.content).events);
}

test('a timed-out initial database open is retried after storage recovers without reloading', {timeout: 5000}, async () => {
  const server = driveServer();
  const a = replica(server, {[KEY]: {name: PRIVATE_TEXT}}, {hangOpen: true});
  const initialReady = a.api.ready;
  const failed = assert.rejects(initialReady, error => error.code === 'gun_storage_open_timeout');
  const connecting = a.connect();
  await failed; await connecting;
  assert.equal(a.db.control.opens, 1, 'Initial ready and first sync share one initialization attempt');
  assert.equal(a.local[KEY].name, PRIVATE_TEXT);
  assert.equal(journalEvents(server).length, 0);
  a.db.control.hangOpen = false;
  const before = a.db.control.opens;
  await a.api.sync();
  assert.ok(a.db.control.opens > before, 'A fresh sync must reopen storage instead of reusing the rejected ready promise');
  assert.equal(a.api.status().pending, 0);
  assert.equal(a.local[KEY].name, PRIVATE_TEXT);
  const b = replica(server); await b.connect();
  assert.equal(b.local[KEY].name, PRIVATE_TEXT);
});

test('a hung fetch rejects sync and releases running so a later sync succeeds', {timeout: 5000}, async () => {
  const server = driveServer(), a = replica(server, {[KEY]: {name: PRIVATE_TEXT}});
  await a.connect();
  a.fault.fetch = true;
  const failed = a.api.sync();
  await assert.rejects(failed, error => error.code === 'gun_network_timeout');
  assert.equal(a.local[KEY].name, PRIVATE_TEXT);
  const count = a.requests;
  a.fault.fetch = false;
  const retry = a.api.sync();
  assert.notEqual(retry, failed, 'The rejected running promise must be released');
  await retry;
  assert.ok(a.requests > count);
  assert.equal(a.api.status().pending, 0);
  assert.equal(a.local[KEY].name, PRIVATE_TEXT);
});

test('a stalled upload acknowledgement retains pending changes and retry restores them', {timeout: 5000}, async () => {
  const server = driveServer(), a = replica(server);
  await a.connect();
  a.fault.uploadBody = true;
  a.local = {[KEY]: {name: PRIVATE_TEXT}};
  await assert.rejects(a.api.sync(), error => error.code === 'gun_network_timeout');
  assert.ok(a.api.status().pending > 0, 'An incomplete acknowledgement is not a successful upload');
  assert.ok(a.api.pendingKeys().includes(KEY));
  assert.equal(a.local[KEY].name, PRIVATE_TEXT);
  assert.ok(journalEvents(server).some(event => event.key === KEY), 'The mock server did accept the first upload');
  a.fault.uploadBody = false;
  await a.api.sync();
  assert.equal(a.api.status().pending, 0);
  const b = replica(server); await b.connect();
  assert.equal(b.local[KEY].name, PRIVATE_TEXT);
  assert.equal(b.api.status().conflicts, 0);
});

test('a storage transaction stalled after receiving a journal rejects and can be retried', {timeout: 5000}, async () => {
  const server = driveServer(), a = replica(server), b = replica(server);
  await a.connect(); await b.connect();
  a.local = {[KEY]: {name: PRIVATE_TEXT}}; await a.api.sync();
  b.fault.storageAfterJournal = true;
  await assert.rejects(b.api.sync(), error => error.code === 'gun_storage_transaction_timeout');
  assert.ok(b.db.control.stalled > 0);
  assert.ok(b.db.control.aborted > 0, 'A timed-out write must be aborted');
  assert.equal(b.local[KEY], undefined, 'An uncommitted journal must not be presented as applied');
  b.fault.storageAfterJournal = false; b.db.control.hangWrites = false;
  await b.api.sync();
  assert.equal(b.local[KEY].name, PRIVATE_TEXT);
  assert.equal(b.api.status().pending, 0);
});

test('sync diagnostics expose progress and failure without card text or bearer tokens', {timeout: 5000}, async () => {
  const server = driveServer(), a = replica(server, {[KEY]: {name: PRIVATE_TEXT}});
  await a.connect();
  assert.equal(typeof a.api.diagnostics, 'function');
  a.fault.fetch = true;
  const pending = a.api.sync();
  const outcome = assert.rejects(pending, error => error.code === 'gun_network_timeout');
  await tick();
  const during = a.api.diagnostics();
  assert.ok(during.stage);
  assert.ok(during.startedAt);
  await outcome;
  const failed = a.api.diagnostics();
  assert.ok(failed.lastError);
  for (const diagnostics of [during, failed]) {
    const serialized = JSON.stringify(diagnostics);
    assert.ok(!serialized.includes(PRIVATE_TEXT));
    assert.ok(!serialized.includes(TOKEN));
    assert.ok(!serialized.includes(KEY));
    assert.equal(typeof diagnostics.downloadedJournals, 'number');
    assert.equal(typeof diagnostics.totalJournals, 'number');
  }
  a.fault.fetch = false; await a.api.sync();
  const recovered = a.api.diagnostics();
  assert.ok(recovered.lastSuccessAt);
  assert.ok(!JSON.stringify(recovered).includes(PRIVATE_TEXT));
  assert.ok(!JSON.stringify(recovered).includes(TOKEN));
});
