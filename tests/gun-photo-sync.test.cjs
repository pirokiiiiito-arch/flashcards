'use strict';

// Exercise the real gun sync adapter with a synthetic deck and Drive boundary.
// No credentials, actual pictures, provider requests, or persistent storage.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../guns/drive-sync.js'), 'utf8');
const drive = suffix => 'gdrive:synthetic-' + suffix + ':' + 'a'.repeat(64);
const key = (id, slot) => 'image:' + id + ':' + slot;
const plain = value => JSON.parse(JSON.stringify(value));
const card = (id, images = ['', '', '']) => ({
  id, name: '合成カード', name_en: 'Synthetic card', category: 'shotgun',
  description: 'テスト専用の説明', maker: 'Synthetic maker', country: 'US',
  search: 'synthetic reference', source: 'user', images: [...images]
});

async function harness(initialCards, options = {}) {
  let cards = structuredClone(initialCards), config, timerId = 0, syncCalls = 0, subscriber;
  const buttons = [], downloads = [], objectUrls = new Map(), timeouts = new Map();
  const intervals = [], windowEvents = new Map(), documentEvents = new Map();
  const republished = [], repaired = [], errors = [], statuses = [], remote = {};
  const addListener = (map, type, fn) => {
    if (!map.has(type)) map.set(type, []);
    map.get(type).push(fn);
  };
  const controls = {insertBefore(node) {buttons.push(node);}};
  const cloudStatus = {textContent: ''};
  function publishRemote(keys) {
    for (const current of cards) current.images.forEach((ref, index) => {
      if (keys.includes(key(current.id, index))) remote[key(current.id, index)] = ref;
    });
  }
  const deck = {
    ready: Promise.resolve(),
    getCards: () => structuredClone(cards),
    getImages: value => Array.from({length: 3}, (_, i) => value.images?.[i] || ''),
    isEditing: () => false,
    resolveSource: async () => '',
    replaceIfCurrent: () => false,
    restoreCloud: () => true,
    subscribe(fn) {subscriber = fn;},
    notifySyncStatus(message) {statuses.push(message);},
    notifyPhotoStatus() {}
  };
  const api = {
    account: 'synthetic-account',
    valid: () => true,
    pendingKeys: () => options.pendingKeys || [],
    status: () => ({pending: 0}),
    changed() {},
    open() {},
    async request(url) {
      assert.equal(url, 'https://www.googleapis.com/drive/v3/about?fields=user(permissionId)');
      return {json: async () => ({user: {permissionId: 'synthetic-account'}})};
    },
    async republish(keys, publishOptions) {
      republished.push({keys: [...keys], options: plain(publishOptions || {})});
      publishRemote(keys);
    },
    async republishSaved(keys) {repaired.push([...keys]); publishRemote(keys);},
    async sync() {syncCalls++;},
    view: () => ({data: {...remote}, deleted: {}})
  };
  if (options.missingRepair === false) delete api.republishSaved;
  const copier = {
    busy: false, attach() {}, retry() {}, report: () => ({}),
    convert: async (_key, value) => value,
    async sweep() {
      for (const current of cards) current.images = current.images.map(ref => options.copyResults?.[ref] || ref);
    }
  };
  const document = {
    visibilityState: 'visible', body: controls,
    querySelector: () => controls,
    getElementById: id => id === 'cloudStatus' ? cloudStatus : null,
    addEventListener: (type, fn) => addListener(documentEvents, type, fn),
    createElement(tag) {
      return {tagName: tag, click() {
        if (tag === 'a') downloads.push(objectUrls.get(this.href));
      }};
    }
  };
  const root = {
    GunDeck: deck,
    FlashcardsDrive: {install(value) {config = value; return api;}},
    GunDriveImageCopy: {
      isDrive: value => /^gdrive:[\w-]+:[a-f0-9]{64}$/.test(String(value || '')),
      create: () => copier
    },
    addEventListener: (type, fn) => addListener(windowEvents, type, fn)
  };
  const context = {
    window: root, document, navigator: {onLine: true}, Blob, Map, Set, Date,
    Promise, Error, Object, String, Array, Math, JSON, structuredClone,
    localStorage: {getItem: () => '1', setItem() {}},
    URL: {
      createObjectURL(blob) {
        const url = 'blob:synthetic-report-' + objectUrls.size;
        objectUrls.set(url, blob); return url;
      },
      revokeObjectURL: url => objectUrls.delete(url)
    },
    console: {error: (...args) => errors.push(args), warn() {}},
    queueMicrotask,
    setTimeout(fn, delay) {const id = ++timerId; timeouts.set(id, {fn, delay}); return id;},
    clearTimeout: id => timeouts.delete(id),
    setInterval(fn, delay) {intervals.push({fn, delay}); return intervals.length;}
  };
  vm.createContext(context);
  await vm.runInContext(source, context, {filename: 'guns/drive-sync.js'});
  assert.equal(errors.length, 0, 'The production adapter must initialize successfully');
  assert.ok(config, 'The production adapter must install its actual configuration');
  const retry = buttons.find(button => button.textContent === '写真コピー再試行');
  const report = buttons.find(button => button.textContent === '写真コピー結果を保存');
  assert.ok(retry && report, 'Both actual photo controls must be installed');
  return {
    config, api, deck, retry, republished, repaired, intervals, statuses,
    get syncCalls() {return syncCalls;},
    addPhoto(id, slot, ref) {
      const current = cards.find(value => value.id === id);
      assert.ok(current, 'The synthetic card must already exist');
      current.images[slot] = ref;
      assert.ok(subscriber, 'The production adapter must listen for local photo saves');
      subscriber({keys: [key(id, slot)], action: 'photo'});
    },
    async queuedKeys() {
      report.onclick();
      const blob = downloads.at(-1);
      assert.ok(blob instanceof Blob, 'The actual report control must create its report');
      return JSON.parse(await blob.text()).queued_photo_keys;
    },
    async runCopyTimer() {
      const entry = [...timeouts].find(([, timer]) => timer.delay < 3000);
      assert.ok(entry, 'Photo retry must schedule a transfer');
      timeouts.delete(entry[0]);
      await entry[1].fn();
    },
    async emit(type) {
      for (const fn of [...(windowEvents.get(type) || []), ...(documentEvents.get(type) || [])]) await fn();
    }
  };
}

test('an image-only journal updates an existing local card without requiring its metadata event', async () => {
  const local = card('gun-0003');
  const h = await harness([local]);
  const result = plain(h.config.prepareApply({data: {[key(local.id, 0)]: drive('new')}, deleted: {}}));
  assert.equal(result.cards.length, 1);
  assert.deepEqual(result.cards[0], {...local, images: [drive('new'), '', '']});
});

test('metadata-only updates retain existing Drive and HTTP photos when image keys are absent', async () => {
  const local = card('gun-0003', [drive('retained'), 'https://example.invalid/synthetic.png', '']);
  const metadata = {...local, description: '同期で届いた説明'};
  delete metadata.images;
  const h = await harness([local]);
  const result = plain(h.config.prepareApply({data: {['card:' + local.id]: metadata}, deleted: {}}));
  assert.equal(result.cards.length, 1);
  assert.equal(result.cards[0].description, metadata.description);
  assert.deepEqual(result.cards[0].images, local.images);
});

for (const includeMetadata of [false, true]) {
  test('an explicit image deletion clears its slot and preserves the others' + (includeMetadata ? ' with metadata' : ' without metadata'), async () => {
    const local = card('gun-0003', [drive('deleted'), drive('retained'), '']);
    const metadata = {...local}; delete metadata.images;
    const h = await harness([local]);
    const data = includeMetadata ? {['card:' + local.id]: metadata} : {};
    const deleted = {[key(local.id, 0)]: {id: 'synthetic-delete', deleted: true}};
    const result = plain(h.config.prepareApply({data, deleted}));
    assert.equal(result.cards.length, 1);
    assert.deepEqual(result.cards[0].images, ['', drive('retained'), '']);
  });
}

test('an image-only event cannot recreate an explicitly deleted card', async () => {
  const local = card('gun-0003');
  const h = await harness([local]);
  const result = plain(h.config.prepareApply({
    data: {[key(local.id, 0)]: drive('orphan')},
    deleted: {['card:' + local.id]: {id: 'synthetic-card-delete', deleted: true}}
  }));
  assert.ok(!result.cards.some(value => value.id === local.id));
  assert.deepEqual(result.deleted, [local.id]);
});

test('an orphan image for an unknown card does not invent a card', async () => {
  const h = await harness([card('gun-0003')]);
  const result = plain(h.config.prepareApply({data: {[key('unknown-card', 0)]: drive('orphan')}, deleted: {}}));
  assert.ok(!result.cards.some(value => value.id === 'unknown-card'));
  assert.deepEqual(result.deleted, []);
});

test('manual retry requests the dedicated missing-registration repair for existing Drive references', async () => {
  const first = card('gun-0003', [drive('one'), '', drive('three')]);
  const second = card('gun-custom-example', [drive('custom'), '', '']);
  const expected = [key(first.id, 0), key(first.id, 2), key(second.id, 0)];
  const h = await harness([first, second]);
  assert.deepEqual(await h.queuedKeys(), []);
  h.retry.onclick();
  assert.deepEqual(await h.queuedKeys(), expected);
  await h.runCopyTimer();
  assert.deepEqual(h.repaired, [expected]);
  assert.deepEqual(h.republished, [], 'Saved Drive references must not use unrestricted republish');
  assert.deepEqual(await h.queuedKeys(), []);
});

test('an older cached core without missing-registration repair never falls back to unrestricted republish', async () => {
  const local = card('gun-0003', [drive('retained'), '', '']);
  const h = await harness([local], {missingRepair: false});
  h.retry.onclick();
  await h.runCopyTimer();
  assert.deepEqual(h.republished, []);
  assert.deepEqual(h.repaired, []);
  assert.deepEqual(await h.queuedKeys(), [key(local.id, 0)], 'The repair remains pending until a compatible core is loaded');
  assert.ok(h.statuses.some(message => message.includes('送信保留')));
});

test('a newly saved local photo uses normal publication after its verified Drive copy', async () => {
  const local = card('gun-0003');
  const original = 'idb:gunimg:gun-0003:0:synthetic-new-photo';
  const h = await harness([local], {copyResults: {[original]: drive('new-photo')}});
  h.addPhoto(local.id, 0, original);
  assert.deepEqual(await h.queuedKeys(), [key(local.id, 0)]);
  await h.runCopyTimer();
  assert.deepEqual(h.republished, [{keys: [key(local.id, 0)], options: {}}],
    'An explicit new photo must publish normally rather than be skipped as a missing-only repair');
  assert.deepEqual(h.repaired, []);
  assert.deepEqual(await h.queuedKeys(), []);
});

test('photo retry on an empty receiving device pulls remote changes even with no upload queue', async () => {
  const h = await harness([card('gun-0003')]);
  assert.equal(h.syncCalls, 0);
  h.retry.onclick();
  await Promise.resolve();
  assert.equal(h.syncCalls, 1, 'The receiving phone must synchronize when it has no local photos to resend');
  assert.deepEqual(await h.queuedKeys(), []);
  assert.deepEqual(h.republished, []);
  assert.deepEqual(h.repaired, []);
});

test('startup, successful sync, focus, and polling do not automatically republish every Drive photo', async () => {
  const h = await harness([card('gun-0003', [drive('one'), '', drive('three')])]);
  assert.deepEqual(await h.queuedKeys(), []);
  await h.config.afterSync();
  h.config.onStatus('同期済み', 'synthetic');
  await h.emit('focus');
  await h.emit('online');
  await h.emit('visibilitychange');
  for (const timer of h.intervals) await timer.fn();
  assert.deepEqual(await h.queuedKeys(), []);
  assert.deepEqual(h.republished, []);
  assert.deepEqual(h.repaired, []);
  assert.ok(h.syncCalls > 0, 'Ordinary polling must still receive remote changes');
});
