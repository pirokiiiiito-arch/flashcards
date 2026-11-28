'use strict';
// Production core + image conversion, synthetic Drive and browser storage only.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');
const {Element, database, driveServer, tick} = require('./mock-runtime.cjs');
const Core = require('../drive-core.js');
const coreSource = fs.readFileSync(require.resolve('../drive-core.js'), 'utf8');
const imageSource = fs.readFileSync(require.resolve('../word-images.js'), 'utf8');
const NAMESPACE = 'word-flashcards', KEY = 'card:synthetic-word';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF9sAAAAASUVORK5CYII=', 'base64');
const hash = crypto.createHash('sha256').update(png).digest('hex');
const image = {ref: 'local:' + hash, name: 'synthetic.png', type: 'image/png'};
const card = (id = 'synthetic-word') => ({id, word: 'Synthetic word', meaning: 'Synthetic meaning', images: [], sort_order: 0, updated_at: null});

function replica(server, initial = {}, options = {}) {
  const db = options.db || database(), storage = options.storage || new Map();
  const body = new Element('body'), toolbar = new Element();
  let local = structuredClone(initial), primary = false, authCallback;
  const document = {body, head: new Element('head'), visibilityState: 'visible', createElement: tag => new Element(tag), querySelector: () => toolbar, addEventListener() {}};
  const context = {console, document, indexedDB: db.indexedDB, crypto: crypto.webcrypto, TextEncoder, TextDecoder, Blob, Headers, Response, URL, URLSearchParams, AbortController, structuredClone, atob, btoa,
    navigator: options.navigator,
    location: {protocol: 'https:', hostname: 'example.invalid'},
    localStorage: {getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key), key: index => [...storage.keys()][index] ?? null, get length() {return storage.size;}},
    fetch: (url, init) => server.fetch(url, init),
    setTimeout: (fn, ms) => {const timer = setTimeout(fn, ms); timer.unref(); return timer;}, clearTimeout,
    addEventListener() {}, FLASHCARDS_DRIVE_CONFIG: {clientId: 'synthetic.apps.googleusercontent.com'},
    google: {accounts: {oauth2: {hasGrantedAllScopes: () => true, initTokenClient: config => {
      authCallback = config.callback;
      return {requestAccessToken: () => authCallback({access_token: 'synthetic-token', expires_in: 3600})};
    }}}}
  };
  context.window = context; vm.createContext(context);
  vm.runInContext(coreSource, context); vm.runInContext(imageSource, context);
  const api = context.FlashcardsDrive.install({namespace: options.namespace || NAMESPACE, toolbar: '.toolbar', ready: Promise.resolve(),
    primary: () => primary, enablePrimary: () => {primary = true;},
    explicitDeletions: true, deletionKeyPrefix: 'card:', verifyUploads: options.verifyUploads !== false,
    read: () => structuredClone(local), legacy: [],
    toCloudValue: async (key, value, sync) => key.startsWith('card:') ? {...value, images: await context.WordImages.toCloudImages(value.images, sync)} : value,
    prepareApply: async view => view.data, apply: data => {local = structuredClone(data);}
  });
  return {api, context, db, storage, get local() {return local;}, set local(value) {local = structuredClone(value); api.changed();},
    async connect() {toolbar.children[0].onclick(); await tick(); await body.children[0].querySelector('[data-connect]').onclick(); await api.sync();}
  };
}
function state(client) {return client.db.dbs.get('flashcards_drive_cache_v3').get('states').get(NAMESPACE);}
const journals = server => [...server.files.values()].filter(file => file.appProperties.kind === 'journal');
const mediaId = url => new URL(url).pathname.split('/').pop();
const journalPost = async (url, init) => String(url).includes('/upload/drive/') && (await init.body.text()).includes('"kind":"journal"');
async function seeded(initial = {[KEY]: card()}) {
  const server = driveServer(), client = replica(server, initial);
  await client.api.ready; await client.connect();
  await client.api.cache.put('blobs', 'word-image:' + hash, new Blob([png], {type: 'image/png'}));
  return {server, client};
}
async function legacyPendingFixture(options = {}) {
  const {server, client} = await seeded();
  const raw = {[KEY]: {...card(), images: [image]}};
  client.local = raw; await client.api.sync();
  const saved = structuredClone(state(client));
  const event = Object.values(saved.events).find(e => e.key === KEY && e.value?.images?.length);
  const remote = structuredClone(event);
  event.value.images[0].ref = image.ref; saved.pending = [event.id]; saved.seen = {}; saved.snapshot = structuredClone(raw);
  client.db.dbs.get('flashcards_drive_cache_v3').get('states').set(NAMESPACE, saved);
  const reopened = replica(server, raw, {...options, db: client.db, storage: client.storage});
  await reopened.api.ready;
  return {server, client: reopened, event, remote, raw};
}

test('strict word event equivalence permits only local-to-Drive refs with identical hashes and every other field unchanged', () => {
  const old = {id: 'synthetic-event', key: KEY, value: {...card(), images: [image], extra: {preserved: true}}, deleted: false, parents: ['parent'], clock: 10, updated_at: 'synthetic', device_id: 'synthetic-device'};
  const remote = structuredClone(old); remote.value.images[0].ref = 'gdrive:synthetic-image:' + hash;
  assert.equal(Core.wordImageEventEquivalent(old, remote), true);
  assert.equal(Core.wordImageEventEquivalent(old, structuredClone(old)), true);
  for (const mutate of [e => e.value.meaning += 'changed', e => e.value.images[0].name = 'changed.png', e => e.value.images[0].type = 'image/jpeg',
    e => e.value.extra.preserved = false, e => e.parents.push('other'), e => e.clock++, e => e.deleted = true,
    e => e.value.images[0].ref = 'gdrive:synthetic-image:' + 'b'.repeat(64)]) {
    const changed = structuredClone(remote); mutate(changed); assert.equal(Core.wordImageEventEquivalent(old, changed), false);
  }
  assert.equal(Core.wordImageEventEquivalent(remote, old), false, 'the reverse conversion is never accepted');
  const otherFile = structuredClone(remote); otherFile.value.images[0].ref = 'gdrive:different-file:' + hash;
  assert.equal(Core.wordImageEventEquivalent(remote, otherFile), false, 'Drive-to-Drive replacement is not normalization');
});

test('converted events are durable before POST; a lost successful-upload response recovers after reload without duplicate journals', async () => {
  const {server, client} = await seeded();
  const raw = {[KEY]: {...card(), images: [image]}}; client.local = raw;
  const normal = server.fetch.bind(server); let dropped = false, sentId;
  server.fetch = async (url, init, account) => {
    const isJournal = await journalPost(url, init);
    if (isJournal && !dropped) {
      const saved = state(client); assert.equal(saved.pending.length, 1);
      sentId = saved.pending[0]; assert.match(saved.events[sentId].value.images[0].ref, /^gdrive:/);
    }
    const response = await normal(url, init, account);
    if (isJournal && !dropped) {dropped = true; throw Error('synthetic response lost after upload');}
    return response;
  };
  await assert.rejects(client.api.sync(), /response lost/);
  assert.equal(client.api.status().pending, 1); assert.deepEqual(client.local, raw);
  assert.equal(state(client).pending[0], sentId);
  const count = journals(server).length;
  const reopened = replica(server, raw, {db: client.db, storage: client.storage});
  await reopened.api.ready; await reopened.connect();
  assert.equal(reopened.api.status().pending, 0); assert.equal(state(reopened).pending.length, 0);
  assert.equal(journals(server).length, count, 'read-back reconciliation acknowledges the existing journal');
  assert.equal(reopened.local[KEY].meaning, raw[KEY].meaning);
  assert.match(reopened.local[KEY].images[0].ref, /^gdrive:/);
});

test('old local-reference pending events recover only after reading the real remote journal and fresh image bytes', async () => {
  const {server, client, event, remote} = await legacyPendingFixture();
  const before = journals(server).length, imageId = remote.value.images[0].ref.split(':')[1];
  server.requests.length = 0; await client.connect();
  assert.equal(client.api.status().pending, 0); assert.equal(journals(server).length, before);
  assert.deepEqual(state(client).events[event.id], remote);
  assert.ok(server.requests.some(request => request.method === 'GET' && new URL(request.url).pathname.endsWith('/' + imageId)), 'the local cached blob cannot substitute for a fresh remote check');
});

test('a mismatched journal read-back retains the pending canonical payload and local cards until a later verified pull', async () => {
  const {server, client} = await seeded();
  const raw = {[KEY]: {...card(), meaning: 'synthetic edited text', images: [image]}}; client.local = raw;
  const normal = server.fetch.bind(server); let uploaded, corrupt = true;
  server.fetch = async (url, init, account) => {
    const response = await normal(url, init, account);
    if (await journalPost(url, init)) uploaded = (await response.clone().json()).id;
    if (corrupt && uploaded && mediaId(url) === uploaded) {
      const doc = await response.json(); doc.events[0].value.meaning = 'synthetic corrupt readback';
      return Response.json(doc);
    }
    return response;
  };
  await assert.rejects(client.api.sync(), /読み戻しが一致しません/);
  assert.equal(client.api.status().pending, 1); assert.equal(state(client).pending.length, 1);
  assert.equal(state(client).seen[uploaded], undefined); assert.deepEqual(client.local, raw);
  assert.equal(state(client).events[state(client).pending[0]].value.meaning, raw[KEY].meaning);
  const count = journals(server).length; corrupt = false; await client.api.sync();
  assert.equal(client.api.status().pending, 0); assert.equal(journals(server).length, count);
});

test('the entire conversion batch stays off-state if a later pending image is unavailable', async () => {
  const SECOND = 'card:synthetic-second', {server, client} = await seeded({[KEY]: card(), [SECOND]: card('synthetic-second')});
  client.local = {[KEY]: {...card(), images: [image]}, [SECOND]: {...card('synthetic-second'), images: [{...image, ref: 'local:' + 'b'.repeat(64)}]}};
  const before = journals(server).length;
  await assert.rejects(client.api.sync(), /元データが端末にありません/);
  assert.equal(client.api.status().pending, 2); assert.equal(journals(server).length, before);
  for (const id of state(client).pending) assert.match(state(client).events[id].value.images[0].ref, /^local:/);
  assert.match(client.api.view().data[KEY].images[0].ref, /^local:/, 'even in-memory events remain unconverted');
});

test('changed text on the same image event ID remains a hard conflict and cannot clear the queue', async () => {
  const {server, client, event, raw} = await legacyPendingFixture();
  for (const file of journals(server)) {
    const doc = JSON.parse(file.content), target = doc.events.find(e => e.id === event.id);
    if (!target) continue;
    target.value.meaning = 'different remote text'; file.content = Buffer.from(JSON.stringify(doc));
    file.md5Checksum = crypto.createHash('md5').update(file.content).digest('hex');
  }
  await assert.rejects(client.connect(), /同期履歴が競合/);
  assert.equal(client.api.status().pending, 1); assert.equal(state(client).pending.length, 1);
  assert.deepEqual(client.local, raw); assert.match(state(client).events[event.id].value.images[0].ref, /^local:/);
});

test('a same-hash reference whose real remote bytes differ cannot repair or acknowledge the old queue', async () => {
  const {server, client, event, remote, raw} = await legacyPendingFixture();
  const imageId = remote.value.images[0].ref.split(':')[1], file = server.files.get(imageId);
  file.content = Buffer.from('synthetic wrong image bytes');
  await assert.rejects(client.connect(), /画像の検証に失敗/);
  assert.equal(client.api.status().pending, 1); assert.equal(state(client).pending.length, 1);
  assert.deepEqual(client.local, raw); assert.match(state(client).events[event.id].value.images[0].ref, /^local:/);
});

test('upload verification is opt-in and does not relax legacy conflict handling without the word flag', async () => {
  const {client} = await legacyPendingFixture({verifyUploads: false});
  await assert.rejects(client.connect(), /同期履歴が競合/);
  assert.equal(client.api.status().pending, 1);
});

test('word sync uses the shared exclusive Web Lock and stale tabs adopt one image upload after waiting', async () => {
  const {server, client} = await seeded();
  const raw = {[KEY]: {...card(), images: [image]}};
  client.local = raw;
  for (let turn = 0; turn < 20 && state(client).pending.length !== 1; turn++) await tick();
  assert.equal(state(client).pending.length, 1);
  let tail = Promise.resolve(), active = 0, requested = 0, release;
  const hold = new Promise(resolve => {release = resolve;});
  const locks = {request(name, options, callback) {
    assert.equal(name, Core.wordSyncLock); assert.equal(options.mode, 'exclusive'); requested++;
    const work = tail.then(async () => {
      assert.equal(active, 0); active++;
      try {return await callback({name, mode: 'exclusive'});} finally {active--;}
    });
    tail = work.catch(() => {}); return work;
  }};
  // Model a safe-transfer tab already holding the same origin-wide lock.
  const transfer = locks.request(Core.wordSyncLock, {mode: 'exclusive'}, () => hold);
  const a = replica(server, raw, {db: client.db, storage: client.storage, navigator: {locks}});
  const b = replica(server, raw, {db: client.db, storage: client.storage, navigator: {locks}});
  await Promise.all([a.api.ready, b.api.ready]); server.requests.length = 0;
  const connected = Promise.all([a.connect(), b.connect()]); await tick(); await tick();
  assert.equal(server.requests.length, 0, 'no Drive request starts while the transfer owns the lock');
  assert.ok(requested >= 3, 'both app tabs wait for the same lock');
  release(); await transfer; await connected;
  assert.equal(active, 0); assert.equal(a.api.status().pending, 0); assert.equal(b.api.status().pending, 0);
  assert.equal([...server.files.values()].filter(file => file.appProperties.kind === 'image').length, 1);
  assert.equal(a.local[KEY].images[0].ref, b.local[KEY].images[0].ref);
});
