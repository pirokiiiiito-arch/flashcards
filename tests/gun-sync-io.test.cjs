'use strict';

// Synthetic network streams and IndexedDB events exercise the production I/O
// boundaries without a browser session, real Drive files, or credentials.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Factory = require('../guns/sync-io.js');
const endpoint = 'https://example.invalid/synthetic-drive';
const short = {networkTimeoutMs: 25, storageTimeoutMs: 25};
const tick = () => new Promise(resolve => setImmediate(resolve));
const checkError = code => error => {
  assert.equal(error.code, code);
  assert.equal(error.retryable, true);
  assert.match(error.message, /[一-龯ぁ-んァ-ヶ]/);
  return true;
};

function openFixture() {
  let result, closes = 0, upgradeAborts = 0;
  const db = {close() {closes++;}};
  const request = {
    get result() {if (!result) throw Error('The open request has not completed'); return result;},
    transaction: {abort() {upgradeAborts++;}}, error: null
  };
  const database = {open(name, version) {
    assert.equal(name, 'synthetic-cache'); assert.equal(version, 1); return request;
  }};
  return {db, request, database, available() {result = db;},
    get closes() {return closes;}, get upgradeAborts() {return upgradeAborts;}};
}

function transactionFixture() {
  let closes = 0, aborts = 0, reads = 0;
  const request = {get result() {reads++; return 'synthetic-value';}};
  const tx = {
    error: null,
    objectStore(name) {assert.equal(name, 'states'); return {get: () => request};},
    abort() {aborts++; this.onabort?.();}
  };
  const db = {
    transaction(store, mode) {assert.equal(store, 'states'); assert.equal(mode, 'readwrite'); return tx;},
    close() {closes++;}
  };
  return {db, tx, request, get closes() {return closes;},
    get aborts() {return aborts;}, get reads() {return reads;}};
}

test('production deadlines are 45 seconds for network and 15 seconds for storage', () => {
  assert.equal(Factory.NETWORK_TIMEOUT_MS, 45000);
  assert.equal(Factory.STORAGE_TIMEOUT_MS, 15000);
});

test('successful response buffers the body and preserves HTTP status, headers, and request options', async () => {
  let received;
  const io = Factory.create({...short, fetcher: async (url, options) => {
    received = {url, options};
    return new Response(JSON.stringify({id: 'synthetic-journal'}), {
      status: 201, statusText: 'Created', headers: {'Content-Type': 'application/json', 'X-Synthetic': 'preserved'}
    });
  }});
  const response = await io.fetchResponse(endpoint, {method: 'POST', body: 'synthetic-body', headers: {'X-Request': 'preserved'}});
  assert.equal(received.url, endpoint);
  assert.equal(received.options.method, 'POST');
  assert.equal(received.options.body, 'synthetic-body');
  assert.equal(received.options.headers['X-Request'], 'preserved');
  assert.ok(received.options.signal instanceof AbortSignal);
  assert.equal(response.status, 201); assert.equal(response.statusText, 'Created');
  assert.equal(response.headers.get('X-Synthetic'), 'preserved');
  assert.deepEqual(await response.json(), {id: 'synthetic-journal'});
});

test('HTTP errors remain responses for core authentication handling, and no-body status stays valid', async () => {
  const io = Factory.create({...short, fetcher: async url => url.endsWith('/empty')
    ? new Response(null, {status: 204})
    : new Response('{"error":"synthetic"}', {status: 401, headers: {'Content-Type': 'application/json'}})});
  const denied = await io.fetchResponse(endpoint);
  assert.equal(denied.status, 401); assert.equal(denied.ok, false);
  assert.deepEqual(await denied.json(), {error: 'synthetic'});
  const empty = await io.fetchResponse(endpoint + '/empty');
  assert.equal(empty.status, 204); assert.equal(await empty.text(), '');
});

test('a fetch that never returns headers times out and aborts its signal', {timeout: 1000}, async () => {
  let signal;
  const io = Factory.create({...short, fetcher: (_url, options) => {
    signal = options.signal; return new Promise(() => {});
  }});
  await assert.rejects(io.fetchResponse(endpoint), checkError('gun_network_timeout'));
  assert.equal(signal.aborted, true);
});

test('the deadline also covers an upload response whose body never finishes', {timeout: 1000}, async () => {
  let signal, accepted = 0;
  const io = Factory.create({...short, fetcher: async (_url, options) => {
    signal = options.signal; accepted++;
    return new Response(new ReadableStream({start(controller) {
      controller.enqueue(new TextEncoder().encode('{"id":'));
    }}), {status: 200, headers: {'Content-Type': 'application/json'}});
  }});
  await assert.rejects(io.fetchResponse(endpoint, {method: 'POST', body: 'synthetic-journal'}), error => {
    checkError('gun_network_timeout')(error);
    assert.match(error.message, /応答の読み込み/); return true;
  });
  assert.equal(accepted, 1, 'A server-accepted upload must still reject if its acknowledgement is incomplete');
  assert.equal(signal.aborted, true);
});

test('a late fetch result is discarded without reading its body after timeout', {timeout: 1000}, async () => {
  let finishFetch, bodyReads = 0, cancellations = 0;
  const io = Factory.create({...short, fetcher: () => new Promise(resolve => {finishFetch = resolve;})});
  await assert.rejects(io.fetchResponse(endpoint), checkError('gun_network_timeout'));
  finishFetch({body: {cancel: async () => {cancellations++;}}, arrayBuffer() {bodyReads++; throw Error('late body must not be read');}});
  await tick();
  assert.equal(bodyReads, 0); assert.equal(cancellations, 1);
});

test('an already-aborted external signal prevents the request', async () => {
  const controller = new AbortController(); controller.abort('synthetic cancellation');
  let calls = 0;
  const io = Factory.create({...short, fetcher: async () => {calls++; return new Response('unused');}});
  await assert.rejects(io.fetchResponse(endpoint, {signal: controller.signal}), error => {
    assert.equal(error.name, 'AbortError'); assert.equal(error.code, 'gun_request_aborted');
    assert.equal(error.retryable, false); return true;
  });
  assert.equal(calls, 0);
});

test('external cancellation aborts an in-progress response body and removes its listener', async () => {
  const controller = new AbortController();
  const signal = controller.signal;
  const add = signal.addEventListener.bind(signal), remove = signal.removeEventListener.bind(signal);
  let added = 0, removed = 0, innerSignal;
  signal.addEventListener = (...args) => {added++; return add(...args);};
  signal.removeEventListener = (...args) => {removed++; return remove(...args);};
  const io = Factory.create({...short, fetcher: async (_url, options) => {
    innerSignal = options.signal;
    return new Response(new ReadableStream({start() {}}));
  }});
  const pending = io.fetchResponse(endpoint, {signal});
  await tick(); controller.abort();
  await assert.rejects(pending, error => error.code === 'gun_request_aborted' && error.name === 'AbortError');
  assert.equal(innerSignal.aborted, true); assert.equal(added, 1); assert.equal(removed, 1);
});

test('successful network operations remove their timeout and external listener', async () => {
  const activeTimers = new Set();
  const context = {AbortController, Response, module: {exports: {}},
    setTimeout(fn, ms) {const id = setTimeout(() => {activeTimers.delete(id); fn();}, ms); activeTimers.add(id); return id;},
    clearTimeout(id) {activeTimers.delete(id); clearTimeout(id);}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../guns/sync-io.js'), 'utf8'), context);
  const external = new AbortController().signal;
  const remove = external.removeEventListener.bind(external); let removed = 0;
  external.removeEventListener = (...args) => {removed++; return remove(...args);};
  const io = context.GunSyncIOFactory.create({...short, fetcher: async () => new Response('complete')});
  const response = await io.fetchResponse(endpoint, {signal: external});
  assert.equal(await response.text(), 'complete');
  assert.equal(activeTimers.size, 0); assert.equal(removed, 1);
});

test('successful IndexedDB open applies the upgrade once and closes on version change', async () => {
  const fixture = openFixture(); let upgraded = 0;
  const io = Factory.create({...short, indexedDB: fixture.database});
  const pending = io.openDB('synthetic-cache', 1, db => {assert.equal(db, fixture.db); upgraded++;});
  fixture.available(); fixture.request.onupgradeneeded(); fixture.request.onsuccess();
  assert.equal(await pending, fixture.db); assert.equal(upgraded, 1); assert.equal(fixture.closes, 0);
  fixture.db.onversionchange(); assert.equal(fixture.closes, 1);
});

test('an IndexedDB open that never finishes times out and ignores late upgrades and success', {timeout: 1000}, async () => {
  const fixture = openFixture(); let upgraded = 0;
  const io = Factory.create({...short, indexedDB: fixture.database});
  await assert.rejects(io.openDB('synthetic-cache', 1, () => {upgraded++;}), checkError('gun_storage_open_timeout'));
  fixture.available(); fixture.request.onupgradeneeded(); fixture.request.onsuccess();
  assert.equal(upgraded, 0, 'A timed-out open must not run schema-changing callbacks later');
  assert.ok(fixture.upgradeAborts > 0); assert.ok(fixture.closes > 0);
});

test('a blocked IndexedDB open rejects explicitly and closes a late connection', async () => {
  const fixture = openFixture();
  const io = Factory.create({...short, indexedDB: fixture.database});
  const pending = io.openDB('synthetic-cache', 1, () => {});
  fixture.request.onblocked();
  await assert.rejects(pending, checkError('gun_storage_blocked'));
  fixture.available(); fixture.request.onsuccess();
  assert.ok(fixture.closes > 0);
});

test('IndexedDB transaction success requires complete, not only a successful request result', async () => {
  const fixture = transactionFixture(); let resolved = false;
  const io = Factory.create(short);
  const pending = io.transaction(fixture.db, 'states', 'readwrite', store => store.get('synthetic'));
  pending.then(() => {resolved = true;});
  await tick();
  assert.equal(resolved, false); assert.equal(fixture.reads, 0);
  fixture.tx.oncomplete();
  assert.equal(await pending, 'synthetic-value'); assert.equal(fixture.reads, 1);
  assert.equal(fixture.aborts, 0); assert.equal(fixture.closes, 0);
});

test('a transaction that never completes aborts and closes on timeout, and late completion stays ignored', {timeout: 1000}, async () => {
  const fixture = transactionFixture();
  const io = Factory.create(short);
  await assert.rejects(io.transaction(fixture.db, 'states', 'readwrite', store => store.get('synthetic')),
    checkError('gun_storage_transaction_timeout'));
  assert.equal(fixture.aborts, 1); assert.equal(fixture.closes, 1);
  fixture.tx.oncomplete();
  assert.equal(fixture.reads, 0, 'A late complete event cannot publish a timed-out result');
});

test('transaction callback errors reject, abort the transaction, and close the connection', async () => {
  const fixture = transactionFixture();
  const io = Factory.create(short);
  await assert.rejects(io.transaction(fixture.db, 'states', 'readwrite', () => {throw Error('synthetic failure');}),
    checkError('gun_storage_transaction_error'));
  assert.equal(fixture.aborts, 1); assert.equal(fixture.closes, 1);
});
