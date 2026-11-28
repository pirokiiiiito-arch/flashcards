'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const Auth = require('../persistent-drive-auth.js');
const { Element, database, driveServer, replica, tick } = require('./mock-runtime.cjs');
const source = fs.readFileSync(__dirname + '/../drive-core.js', 'utf8');
const NAMESPACE = 'word-auth-integration';
const FIRST = 'synthetic-drive-first', RENEWED = 'synthetic-drive-renewed';
const cards = count => Object.fromEntries(Array.from({ length: count }, (_, i) => ['card:' + (i + 1), { id: 'card-' + (i + 1), word: 'synthetic word ' + (i + 1), meaning: 'synthetic meaning ' + (i + 1) }]));
const provider = token => Response.json({ access_token: token, expires_in: 3600, account: 'account1' });
const rejected = () => Response.json({ error: { message: 'expired synthetic token' } }, { status: 401 });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

function memory(seed = {}) {
  const map = new Map(Object.entries(seed));
  return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key), key: index => [...map.keys()][index] ?? null, get length() { return map.size; }, dump: () => Object.fromEntries(map) };
}
async function until(condition, message) {
  const end = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > end) assert.fail(message);
    await new Promise(resolve => setTimeout(resolve, 1));
  }
}
async function seededServer() {
  const server = driveServer(), remote = replica(server, cards(93), { namespace: NAMESPACE });
  await remote.connect();
  assert.equal(Object.keys(remote.local).length, 93);
  return server;
}
function client(server, options = {}) {
  const db = database(), body = new Element('body'), toolbar = new Element(), events = new Map(), statuses = [], deliveries = [], tokenCalls = [], timers = new Map();
  let time = Date.now(), local = cards(75), primary = false, opens = 0;
  const savedSession = JSON.stringify({ access_token: 'synthetic-app-session', refresh_token: 'synthetic-refresh', expires_at: time + 3600000, user: { id: 'synthetic-owner', email: 'owner@example.invalid' } });
  const storage = memory({ [Auth.SESSION_KEY]: savedSession, synthetic_cards: JSON.stringify(local) }), tabStorage = memory();
  const controller = Auth.createController({
    storage, tabStorage, now: () => time,
    locks: { request: (name, mode, fn) => Promise.resolve().then(fn) },
    onOpen: () => { opens++; },
    fetcher: async (url, init) => {
      assert.equal(String(url), Auth.ENDPOINT + '/token');
      const payload = JSON.parse(init.body); tokenCalls.push(payload);
      return options.tokenResponder ? options.tokenResponder(tokenCalls.length, payload) : provider(tokenCalls.length === 1 ? FIRST : RENEWED);
    }
  });
  const document = { body, head: new Element('head'), visibilityState: 'visible', createElement: tag => new Element(tag), querySelector: () => toolbar, addEventListener: (name, fn) => events.set(name, fn) };
  const context = {
    document, indexedDB: db.indexedDB, localStorage: storage, crypto: crypto.webcrypto,
    TextEncoder, TextDecoder, Blob, Headers, Response, URL, URLSearchParams, AbortController, structuredClone,
    location: { protocol: 'https:', hostname: 'example.invalid' },
    FLASHCARDS_DRIVE_CONFIG: { clientId: 'synthetic.apps.googleusercontent.com' },
    PersistentDriveAuth: { ...controller, open: () => { opens++; }, initTokenClient(config) { return controller.initTokenClient({ ...config, callback: response => { deliveries.push(response.access_token); return config.callback(response); } }); } },
    addEventListener: (name, fn) => events.set(name, fn),
    fetch: (url, init) => options.fetch ? options.fetch(url, init, server) : server.fetch(url, init),
    setTimeout: (fn, ms) => { const timer = setTimeout(() => { timers.delete(timer); fn(); }, ms); timers.set(timer, ms); if (ms > 1000) timer.unref(); return timer; },
    clearTimeout: timer => { timers.delete(timer); clearTimeout(timer); }
  };
  context.window = context; vm.createContext(context); vm.runInContext(source, context);
  const api = context.FlashcardsDrive.install({
    namespace: NAMESPACE, toolbar: '.toolbar', ready: Promise.resolve(),
    requestTimeoutMs: options.requestTimeoutMs,
    primary: () => primary, enablePrimary: () => { primary = true; },
    read: () => structuredClone(local), toCloudValue: async (key, value) => value,
    prepareApply: async view => view.data, apply: data => { local = structuredClone(data); },
    onStatus: (status, detail) => statuses.push({ status, detail })
  });
  return {
    api, controller, storage, savedSession, statuses, deliveries, tokenCalls, events, timers,
    get local() { return local; }, get opens() { return opens; },
    advance: duration => { time += duration; },
    dispose: () => { for (const timer of timers.keys()) clearTimeout(timer); timers.clear(); },
    assertPreserved() {
      assert.equal(storage.getItem(Auth.SESSION_KEY), savedSession);
      assert.equal(storage.getItem('synthetic_cards'), JSON.stringify(cards(75)));
      assert.equal(opens, 0);
      assert.ok(!JSON.stringify(storage.dump()).includes(FIRST));
      assert.ok(!JSON.stringify(storage.dump()).includes(RENEWED));
    }
  };
}

test('actual broker and core automatically recover a rejected token and reconcile 75 local cards with 93 remote cards', { timeout: 5000 }, async t => {
  const server = await seededServer(); let rejectedSignal, errorBody;
  const f = client(server, { requestTimeoutMs: 1000, fetch: (url, init, drive) => {
    if (init.headers.get('Authorization') === 'Bearer ' + FIRST) {
      rejectedSignal = init.signal;
      return new Response(new ReadableStream({ start(controller) { errorBody = controller; } }), { status: 401 });
    }
    return drive.fetch(url, init);
  } });
  t.after(() => { errorBody?.close(); f.dispose(); });
  await until(() => Object.keys(f.local).length === 93, 'automatic renewal must restart reconciliation');
  assert.deepEqual(f.tokenCalls.map(call => call.force), [false, true]);
  assert.deepEqual(f.deliveries, [FIRST, RENEWED]);
  assert.equal(f.api.valid(), true);
  assert.equal(f.controller.required(), false);
  assert.deepEqual(f.local, cards(93));
  assert.equal(Object.keys(f.api.view().deleted).length, 0);
  await until(() => f.api.status().status === '同期済み', 'reconciliation must finish');
  assert.equal(rejectedSignal.aborted, true, 'unused 401 response body must be cancelled');
  assert.equal([...f.timers.values()].filter(ms => ms === 1000).length, 0);
  f.assertPreserved();
});

test('a temporary 503 after a Drive 401 retries forcibly on a later broker tick and completes reconciliation', { timeout: 5000 }, async t => {
  const server = await seededServer();
  const f = client(server, {
    tokenResponder: attempt => attempt === 2 ? Response.json({ error: 'refresh_temporarily_unavailable' }, { status: 503 }) : provider(attempt === 1 ? FIRST : RENEWED),
    fetch: (url, init, drive) => init.headers.get('Authorization') === 'Bearer ' + FIRST ? rejected() : drive.fetch(url, init)
  });
  t.after(f.dispose);
  await until(() => f.controller.state().phase === 'temporary', 'temporary renewal failure must be recorded');
  assert.equal(Object.keys(f.local).length, 75);
  assert.equal(f.api.valid(), false);
  assert.equal(f.controller.required(), false);
  f.controller.tick(); await tick();
  assert.equal(f.tokenCalls.length, 2);
  f.advance(60000); f.controller.tick();
  await until(() => Object.keys(f.local).length === 93, 'a normal tick after backoff must renew and restart sync');
  assert.deepEqual(f.tokenCalls.map(call => call.force), [false, true, true]);
  assert.equal(f.controller.state().phase, 'connected');
  assert.equal(f.api.valid(), true);
  f.assertPreserved();
});

test('a late old-token 401 preserves the new connection and syncs again after the old running promise settles', { timeout: 5000 }, async t => {
  const server = await seededServer(), entered = deferred(), response = deferred();
  const f = client(server, { fetch: (url, init, drive) => {
    if (init.headers.get('Authorization') === 'Bearer ' + FIRST) { entered.resolve(); return response.promise; }
    return drive.fetch(url, init);
  } });
  t.after(f.dispose);
  await entered.promise;
  const oldResult = assert.rejects(f.api.sync(), e => e.auth === true);
  await f.controller.getToken(true);
  await until(() => f.deliveries.length === 2 && f.statuses.filter(s => s.status === '接続済み').length === 2, 'new token must be delivered while the old request is still pending');
  const newerStatuses = f.statuses.length;
  response.resolve(rejected()); await oldResult;
  await until(() => Object.keys(f.local).length === 93, 'new-token callback must start a fresh sync after the old one fails');
  assert.equal(f.api.valid(), true);
  assert.equal(f.controller.state().phase, 'connected');
  assert.equal(f.tokenCalls.length, 2);
  assert.ok(!f.statuses.slice(newerStatuses).some(s => s.status === '未接続'));
  f.assertPreserved();
});

test('revoked Google permission after a Drive rejection requests authentication and preserves both local cards and session', { timeout: 5000 }, async t => {
  const server = await seededServer();
  const f = client(server, {
    tokenResponder: attempt => attempt === 1 ? provider(FIRST) : Response.json({ error: 'google_auth_required' }, { status: 401 }),
    fetch: () => rejected()
  });
  t.after(f.dispose);
  await until(() => f.controller.required(), 'revoked permission must become an authentication prompt');
  assert.equal(f.controller.state().phase, 'google_auth_required');
  assert.equal(f.api.valid(), false);
  assert.deepEqual(f.local, cards(75));
  f.advance(60000); f.controller.tick(); await tick();
  assert.equal(f.tokenCalls.length, 2);
  f.assertPreserved();
});

for (const stage of ['fetch', 'response body']) {
  test('opt-in timeout releases a stalled ' + stage + ' so a later sync can run', { timeout: 5000 }, async t => {
    const server = await seededServer(), entered = deferred(); let stalled = false, signal, body;
    const f = client(server, { requestTimeoutMs: 25, fetch: (url, init, drive) => {
      if (!stalled) {
        stalled = true; signal = init.signal; entered.resolve();
        if (stage === 'fetch') return new Promise(() => {});
        return new Response(new ReadableStream({ start(controller) { body = controller; } }), { headers: { 'Content-Type': 'application/json' } });
      }
      return drive.fetch(url, init);
    } });
    t.after(() => { body?.close(); f.dispose(); });
    await entered.promise;
    await assert.rejects(f.api.sync(), e => e.code === 'drive_request_timeout');
    assert.equal(signal.aborted, true);
    assert.equal([...f.timers.values()].filter(ms => ms === 25).length, 0);
    assert.equal(f.api.valid(), true);
    assert.equal(Object.keys(f.local).length, 75);
    await f.api.sync();
    assert.deepEqual(f.local, cards(93));
    assert.equal(f.tokenCalls.length, 1);
    assert.equal([...f.timers.values()].filter(ms => ms === 25).length, 0);
    f.assertPreserved();
  });
}

test('opt-in request timeout honors external cancellation and removes its timer and abort listener', { timeout: 5000 }, async t => {
  const server = await seededServer(), entered = deferred(); let requestSignal;
  const f = client(server, { requestTimeoutMs: 1000, fetch: (url, init, drive) => {
    if (String(url).endsWith('/synthetic-stall')) { requestSignal = init.signal; entered.resolve(); return new Promise(() => {}); }
    return drive.fetch(url, init);
  } });
  t.after(f.dispose);
  await until(() => f.api.status().status === '同期済み', 'initial sync must complete');
  const external = new AbortController(), originalAdd = external.signal.addEventListener.bind(external.signal), originalRemove = external.signal.removeEventListener.bind(external.signal); let listeners = 0;
  external.signal.addEventListener = (...args) => { listeners++; originalAdd(...args); };
  external.signal.removeEventListener = (...args) => { listeners--; originalRemove(...args); };
  const result = assert.rejects(f.api.request('https://www.googleapis.com/drive/v3/synthetic-stall', { signal: external.signal }), e => e === external.signal.reason);
  await entered.promise; external.abort(); await result;
  assert.equal(requestSignal.aborted, true);
  assert.equal(listeners, 0);
  assert.equal([...f.timers.values()].filter(ms => ms === 1000).length, 0);
  f.assertPreserved();
});

test('without the timeout opt-in request returns the original unconsumed Response', { timeout: 5000 }, async t => {
  const server = await seededServer(); let body;
  const original = new Response(new ReadableStream({ start(controller) { body = controller; } }));
  const f = client(server, { fetch: (url, init, drive) => String(url).endsWith('/synthetic-stream') ? original : drive.fetch(url, init) });
  t.after(() => { body.close(); f.dispose(); });
  await until(() => f.api.status().status === '同期済み', 'initial sync must complete');
  const response = await f.api.request('https://www.googleapis.com/drive/v3/synthetic-stream');
  assert.equal(response, original);
  assert.equal(response.bodyUsed, false);
});
