'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto, createHash } = require('node:crypto');
const Core = require('../drive-core.js');
const Safety = require('../word-sync-check/safety.js');
const Transfer = require('../word-sync-check/transfer.js');
const { driveServer } = require('./mock-runtime.cjs');
const sha = value => createHash('sha256').update(value).digest('hex');

function database() {
  const dbs = new Map(), calls = [], faults = { checkpointQuota: false, ackQuota: false };
  function connection(name, stores, fresh) {
    return { objectStoreNames: { contains: key => stores.has(key) }, close() {},
      createObjectStore(key) { assert.ok(fresh && name !== Safety.SOURCE_DB); stores.set(key, new Map()); },
      transaction(names, mode) {
        names = Array.isArray(names) ? names : [names];
        calls.push({ method: 'transaction', name, names, mode });
        const operations = []; let working, aborted = false, active = true, started = false;
        const tx = { error: null, abort() { if (aborted || !active) return; aborted = true; active = false; setImmediate(() => tx.onabort?.()); },
          objectStore(store) {
            assert.ok(names.includes(store) && stores.has(store));
            function add(method, key, value) {
              assert.ok(active); calls.push({ method, name, store, key });
              if (method !== 'get') {
                assert.equal(mode, 'readwrite');
                if (name === Safety.SOURCE_DB) { assert.equal(store, 'states'); assert.equal(method, 'put'); assert.equal(key, Safety.STATE_KEY); }
                else assert.equal(method, 'add', 'backup and checkpoint stores must be create-only');
              }
              const request = {}; operations.push({ method, store, key, value, request }); return request;
            }
            return { get: key => add('get', key), add: (value, key) => add('add', key, value), put: (value, key) => add('put', key, value),
              delete() { assert.fail('no deletion is allowed'); }, clear() { assert.fail('no clearing is allowed'); } };
          }
        };
        function step() {
          if (aborted) return;
          if (!started) { started = true; working = new Map([...stores].map(([key, value]) => [key, new Map(value)])); }
          const operation = operations.shift();
          if (!operation) {
            if (mode === 'readwrite') for (const [key, value] of working) stores.set(key, value);
            active = false; tx.oncomplete?.(); return;
          }
          try {
            const values = working.get(operation.store);
            if (operation.method === 'get') operation.request.result = structuredClone(values.get(operation.key));
            else {
              if ((name === Transfer.CHECKPOINT_DB && faults.checkpointQuota) || (name === Safety.SOURCE_DB && faults.ackQuota)) throw new DOMException('synthetic quota', 'QuotaExceededError');
              if (operation.method === 'add' && values.has(operation.key)) throw new DOMException('existing key', 'ConstraintError');
              values.set(operation.key, structuredClone(operation.value)); operation.request.result = operation.key;
            }
            operation.request.onsuccess?.();
          } catch (error) {
            operation.request.error = error; operation.request.onerror?.(); tx.error = error; tx.onerror?.(); tx.abort(); return;
          }
          setImmediate(step);
        }
        setImmediate(step); return tx;
      }
    };
  }
  const indexedDB = { open(name, version) {
    calls.push({ method: 'open', name, version }); const request = {};
    setImmediate(() => {
      const existing = dbs.get(name), stores = existing || new Map(); let aborted = false;
      request.result = connection(name, stores, !existing); request.transaction = { abort() { aborted = true; } };
      if (!existing) request.onupgradeneeded?.({ oldVersion: 0 });
      if (aborted) { request.error = new DOMException('aborted upgrade', 'AbortError'); request.onerror?.(); return; }
      if (!existing) dbs.set(name, stores); request.onsuccess?.();
    });
    return request;
  }, deleteDatabase() { assert.fail('database deletion is forbidden'); } };
  return { indexedDB, dbs, calls, faults };
}
function event(id, card, parents = []) {
  return { id, key: 'card:' + card.id, value: { ...card, images: card.images || [], sort_order: Number(card.sort_order) || 0, updated_at: card.updated_at || null }, parents, clock: id.startsWith('pending-') ? 1000 : 1, updated_at: '2026-11-28T00:00:00Z', device_id: 'synthetic-device', deleted: false };
}
async function fixture({ sharedImage = false } = {}) {
  const memory = database(), cards = [], events = {}, pending = [], remoteEvents = [], blobs = new Map();
  for (let index = 0; index < 105; index++) {
    const card = { id: 'card-' + index, word: 'synthetic word ' + index, meaning: 'synthetic meaning ' + index };
    if (index < 75) { const base = event('base-' + index, card); events[base.id] = base; remoteEvents.push(base); }
    if (index >= 58) {
      const bytes = Buffer.from('synthetic original image ' + (sharedImage ? 1 : index)), hash = sha(bytes);
      card.images = [{ ref: 'local:' + hash, type: 'image/png', name: 'original.png' }];
      blobs.set('word-image:' + hash, new Blob([bytes], { type: 'image/png' }));
      const next = event('pending-' + index, card, index < 75 ? ['base-' + index] : []); events[next.id] = next; pending.push(next.id);
    }
    cards.push(card);
  }
  for (let index = 0; index < 3; index++) {
    const deleted = { id: 'old-delete-' + index, key: 'card:removed-' + index, value: null, parents: [], clock: 3, deleted: true };
    events[deleted.id] = deleted; remoteEvents.push(deleted);
  }
  const state = { events, pending, account: 'account1', initialized: true, clock: 1000, seen: { 'seed-journal': 'seed' }, imports: { old: 'kept' },
    snapshot: Object.fromEntries(cards.map(card => ['card:' + card.id, structuredClone(card)])), basis: Object.fromEntries([...Core.heads(events)].map(([key, heads]) => [key, heads.map(head => head.id)])) };
  const stores = new Map([['states', new Map([[Safety.STATE_KEY, state]])], ['blobs', blobs]]); memory.dbs.set(Safety.SOURCE_DB, stores);
  const raw = JSON.stringify(cards, null, 2) + '\n', values = new Map([[Safety.CARDS_KEY, raw], ['flashcards_supabase_session_v1', 'synthetic-secret-session']]);
  const storage = { getItem: key => values.get(key) ?? null, setItem() { assert.fail('original localStorage writes are forbidden'); }, removeItem() { assert.fail('original localStorage deletion is forbidden'); } };
  const safety = Safety.create({ indexedDB: memory.indexedDB, storage, crypto: webcrypto, Blob, btoa });
  const backup = await safety.save(await safety.inspect());
  const server = driveServer();
  const content = Buffer.from(JSON.stringify({ schema: Core.schema, namespace: 'word-flashcards', events: remoteEvents }));
  server.files.set('seed-journal', { id: 'seed-journal', name: 'seed.json', mimeType: 'application/json', appProperties: { namespace: 'word-flashcards', kind: 'journal' }, content, md5Checksum: 'seed' });
  const faults = { loseJournalResponse: false, corruptJournalRead: false, onStage: null, tokenError: null, requiredPhase: '', rejectFirstToken: false, hang: false, responseError: null };
  const uploads = [], progress = [], credentials = { token: 'synthetic-drive-token', renewals: 0 };
  const auth = { async getToken() { if (faults.tokenError) throw faults.tokenError; return { token: credentials.token, account: 'account1', until: Date.now() + 3600000 }; },
    async invalidateAccess(token) { assert.equal(token, credentials.token); credentials.token = 'synthetic-drive-renewed'; credentials.renewals++; return true; },
    required: () => !!faults.requiredPhase, state: () => ({ phase: faults.requiredPhase || 'connected' }) };
  async function fetcher(url, init) {
    assert.equal(new URL(url).hostname, 'www.googleapis.com');
    if (faults.hang) return new Promise(() => {});
    if (faults.responseError) return Response.json(faults.responseError.body, { status: faults.responseError.status });
    if (faults.rejectFirstToken && init.headers.get('Authorization') === 'Bearer synthetic-drive-token') return Response.json({}, { status: 401 });
    let kind = '';
    if (init.method === 'POST') { const text = await init.body.text(); kind = text.includes('"kind":"journal"') ? 'journal' : 'image'; uploads.push(kind); }
    const response = await server.fetch(url, init);
    if (kind === 'journal' && faults.loseJournalResponse) { faults.loseJournalResponse = false; throw Error('synthetic lost acknowledgement'); }
    const file = server.files.get(new URL(url).pathname.split('/').pop());
    if (faults.corruptJournalRead && file?.appProperties.kind === 'journal' && file.id !== 'seed-journal' && !kind)
      return Response.json({ ...JSON.parse(file.content), tampered: true });
    return response;
  }
  const make = (timeoutMs, locks) => Transfer.create({ core: Core, safety, auth, storage, indexedDB: memory.indexedDB, fetcher, timeoutMs, locks,
    onProgress: info => { progress.push(info); faults.onStage?.(info.stage); } });
  return { memory, cards, values, raw, original: structuredClone(state), safety, backup, server, faults, uploads, progress, credentials, make,
    state: () => memory.dbs.get(Safety.SOURCE_DB).get('states').get(Safety.STATE_KEY),
    replaceState: value => memory.dbs.get(Safety.SOURCE_DB).get('states').set(Safety.STATE_KEY, value),
    async originals() { return JSON.stringify({ raw: values.get(Safety.CARDS_KEY), images: await Promise.all([...blobs].map(async ([key, blob]) => [key, blob.type, Buffer.from(await blob.arrayBuffer()).toString('base64')])) }); }
  };
}

test('factory is inert; explicit transfer publishes 47 pending events, verifies all 105 cards/47 image references, and preserves original raw/images/history', async () => {
  const f = await fixture(), before = await f.originals(), calls = f.memory.calls.length, transfer = f.make();
  assert.equal(f.memory.calls.length, calls); assert.equal(f.server.requests.length, 0); assert.equal(f.uploads.length, 0);
  const result = await transfer.run({ backupId: f.backup.id });
  assert.deepEqual(result, { verified: true, localCount: 105, remoteCount: 105, pendingBefore: 47, pendingAfter: 0, uploadedEvents: 47, verifiedEvents: 47, verifiedImages: 47, accountFingerprint: sha('account1').slice(0, 12) });
  assert.equal(f.uploads.filter(kind => kind === 'journal').length, 1);
  assert.equal(f.uploads.filter(kind => kind === 'image').length, 47);
  assert.equal(await f.originals(), before);
  assert.deepEqual(f.state().basis, f.original.basis); assert.deepEqual(f.state().snapshot, f.original.snapshot); assert.deepEqual(f.state().imports, f.original.imports);
  assert.equal(Object.keys(f.state().events).length, Object.keys(f.original.events).length);
  for (const id of f.original.pending) assert.equal(Core.wordImageEventEquivalent(f.original.events[id], f.state().events[id]), true);
  const checkpoints = [...f.memory.dbs.get(Transfer.CHECKPOINT_DB).get('checkpoints').values()];
  assert.ok(checkpoints.some(checkpoint => checkpoint.kind === 'source' && Core.stable(checkpoint.payload.state) === Core.stable(f.original)));
  assert.ok(checkpoints.some(checkpoint => checkpoint.kind === 'draft'));
  assert.ok(!JSON.stringify(checkpoints).includes('synthetic-secret-session'));
});

test('same bytes referenced 47 times use one image file while the verified image count remains 47', async () => {
  const f = await fixture({ sharedImage: true }), result = await f.make().run({ backupId: f.backup.id });
  assert.equal(result.verifiedImages, 47); assert.equal(f.uploads.filter(kind => kind === 'image').length, 1);
});

test('an older pending image outside the current-card backup receives its own verified private checkpoint before upload', async () => {
  const f = await fixture(), state = structuredClone(f.state()), bytes = Buffer.from('synthetic older image revision'), hash = sha(bytes), ref = 'local:' + hash;
  const old = structuredClone(state.events['pending-58']); old.id = 'pending-old-image'; old.clock = 500; old.value.images[0].ref = ref;
  state.events[old.id] = old; state.events['pending-58'].parents = [old.id]; state.pending.unshift(old.id); f.replaceState(state);
  f.memory.dbs.get(Safety.SOURCE_DB).get('blobs').set('word-image:' + hash, new Blob([bytes], { type: 'image/png' }));
  const before = await f.originals(), result = await f.make().run({ backupId: f.backup.id });
  assert.equal(result.pendingBefore, 48); assert.equal(result.pendingAfter, 0); assert.equal(result.verifiedImages, 47);
  const checkpoints = [...f.memory.dbs.get(Transfer.CHECKPOINT_DB).get('checkpoints').values()];
  const saved = checkpoints.find(checkpoint => checkpoint.kind === 'image-source' && checkpoint.payload.ref === ref);
  assert.ok(saved); assert.equal(saved.payload.hash, hash);
  assert.deepEqual(Buffer.from(await saved.payload.blob.arrayBuffer()), bytes);
  assert.equal(await f.originals(), before);
});

test('a lost journal POST response leaves all pending events intact and the next run adopts verified remote references without another upload', async () => {
  const f = await fixture(); f.faults.loseJournalResponse = true;
  await assert.rejects(f.make().run({ backupId: f.backup.id }), error => error.code === 'TRANSFER_NETWORK');
  assert.deepEqual(f.state().pending, f.original.pending); assert.deepEqual(f.state().events, f.original.events);
  const beforeRetry = f.uploads.length, result = await f.make().run({ backupId: f.backup.id });
  assert.equal(result.pendingAfter, 0); assert.equal(result.uploadedEvents, 0); assert.equal(result.verifiedEvents, 47);
  assert.equal(f.uploads.length, beforeRetry);
});

test('actual journal GET mismatch blocks acknowledgement and retains the original queue', async () => {
  const f = await fixture(); f.faults.corruptJournalRead = true;
  await assert.rejects(f.make().run({ backupId: f.backup.id }), error => error.code === 'TRANSFER_READBACK_MISMATCH');
  assert.deepEqual(f.state().pending, f.original.pending); assert.deepEqual(f.state().events, f.original.events);
});

test('Drive about account mismatch stops before any cloud POST or source-state write', async () => {
  const f = await fixture(); f.server.account = 'another-synthetic-account';
  await assert.rejects(f.make().run({ backupId: f.backup.id }), error => error.code === 'TRANSFER_ACCOUNT_MISMATCH');
  assert.equal(f.uploads.length, 0); assert.deepEqual(f.state(), f.original);
});

test('unsent pending tombstones and newly observed remote tombstones stop before any cloud POST', async () => {
  const pending = await fixture(), changed = structuredClone(pending.original);
  changed.events['new-delete'] = { id: 'new-delete', key: 'card:another-removed', deleted: true, value: null, parents: [], clock: 2000 };
  changed.pending.push('new-delete'); pending.replaceState(changed);
  await assert.rejects(pending.make().run({ backupId: pending.backup.id }), error => error.code === 'TRANSFER_PENDING_DELETION');
  assert.equal(pending.uploads.length, 0); assert.deepEqual(pending.state().pending, changed.pending);
  const remote = await fixture(), file = remote.server.files.get('seed-journal'), doc = JSON.parse(file.content);
  doc.events.push({ id: 'remote-delete', key: 'card:card-0', deleted: true, value: null, parents: ['base-0'], clock: 2000 }); file.content = Buffer.from(JSON.stringify(doc));
  await assert.rejects(remote.make().run({ backupId: remote.backup.id }), error => error.code === 'TRANSFER_REMOTE_DELETION');
  assert.equal(remote.uploads.length, 0); assert.deepEqual(remote.state(), remote.original);
});

test('cached live data missing from both remote journals and pending events is not fabricated into new history', async () => {
  const f = await fixture(), changed = structuredClone(f.original); changed.pending = changed.pending.filter(id => id !== 'pending-104'); f.replaceState(changed);
  await assert.rejects(f.make().run({ backupId: f.backup.id }), error => error.code === 'TRANSFER_REMOTE_INCOMPLETE');
  assert.equal(f.uploads.length, 0); assert.deepEqual(f.state(), changed);
});

test('atomic acknowledgement keeps new pending IDs and latest unrelated state fields from another tab', async () => {
  const f = await fixture(); let latest;
  f.faults.onStage = stage => {
    if (stage !== 'ack') return;
    latest = structuredClone(f.state()); latest.events['new-concurrent'] = { id: 'new-concurrent', key: 'metadata:concurrent', value: { preserved: true }, parents: [], clock: 2001, deleted: false };
    latest.pending.push('new-concurrent'); latest.basis.concurrent = ['new-concurrent']; latest.snapshot.concurrent = { preserved: true }; f.replaceState(latest);
  };
  const result = await f.make().run({ backupId: f.backup.id });
  assert.equal(result.pendingAfter, 1); assert.deepEqual(f.state().pending, ['new-concurrent']);
  assert.deepEqual(f.state().events['new-concurrent'], latest.events['new-concurrent']); assert.deepEqual(f.state().basis, latest.basis); assert.deepEqual(f.state().snapshot, latest.snapshot);
});

test('raw card changes or same-ID queue changes before acknowledgement stop cleanly and preserve the newer source', async () => {
  const raw = await fixture(); let newerRaw;
  raw.faults.onStage = stage => { if (stage === 'ack') { newerRaw = JSON.stringify([...raw.cards, { id: 'new-user-card', word: 'new', meaning: 'new' }]); raw.values.set(Safety.CARDS_KEY, newerRaw); } };
  await assert.rejects(raw.make().run({ backupId: raw.backup.id }), error => error.code === 'TRANSFER_SOURCE_CHANGED');
  assert.equal(raw.values.get(Safety.CARDS_KEY), newerRaw); assert.deepEqual(raw.state().pending, raw.original.pending);
  const queue = await fixture(); let newerState;
  queue.faults.onStage = stage => { if (stage === 'ack') { newerState = structuredClone(queue.state()); newerState.events['pending-58'].value.meaning = 'new concurrent edit'; queue.replaceState(newerState); } };
  await assert.rejects(queue.make().run({ backupId: queue.backup.id }), error => error.code === 'TRANSFER_SOURCE_CHANGED');
  assert.deepEqual(queue.state(), newerState);
});

test('checkpoint quota failure prevents all network work; acknowledgement quota failure never clears the source queue', async () => {
  const checkpoint = await fixture(); checkpoint.memory.faults.checkpointQuota = true;
  await assert.rejects(checkpoint.make().run({ backupId: checkpoint.backup.id }), error => error.code === 'TRANSFER_STORAGE');
  assert.equal(checkpoint.server.requests.length, 0); assert.deepEqual(checkpoint.state(), checkpoint.original);
  const ack = await fixture(); ack.memory.faults.ackQuota = true;
  await assert.rejects(ack.make().run({ backupId: ack.backup.id }), error => error.code === 'TRANSFER_STORAGE');
  assert.deepEqual(ack.state(), ack.original);
});

test('pre-existing auth-required phase remains actionable even when getToken returns retry_pending', async () => {
  const f = await fixture(); f.faults.requiredPhase = 'google_permission_required'; f.faults.tokenError = Object.assign(Error('untrusted raw secret message'), { code: 'retry_pending' });
  await assert.rejects(f.make().run({ backupId: f.backup.id }), error => error.code === 'TRANSFER_AUTH_REQUIRED' && error.auth && error.reason === 'google_permission_required' && !error.message.includes('secret'));
  assert.equal(f.uploads.length, 0); assert.deepEqual(f.state(), f.original);
});

test('a rejected token renews without a popup and a stalled request is bounded without acknowledgement', async () => {
  const renewed = await fixture({ sharedImage: true }); renewed.faults.rejectFirstToken = true;
  assert.equal((await renewed.make().run({ backupId: renewed.backup.id })).verified, true); assert.equal(renewed.credentials.renewals, 1);
  const stalled = await fixture(); stalled.faults.hang = true;
  await assert.rejects(stalled.make(20).run({ backupId: stalled.backup.id }), error => error.code === 'TRANSFER_TIMEOUT');
  assert.deepEqual(stalled.state(), stalled.original);
});

test('shared word sync lock is acquired only on run, refuses an occupied lock, and covers the whole transfer', async () => {
  const busy = await fixture(), callsBefore = busy.memory.calls.length; let lockCalls = 0;
  const blocked = busy.make(undefined, { request(name, options, callback) {
    lockCalls++; assert.equal(name, Core.wordSyncLock); assert.deepEqual(options, { mode: 'exclusive', ifAvailable: true }); return callback(null);
  } });
  assert.equal(lockCalls, 0);
  await assert.rejects(blocked.run({ backupId: busy.backup.id }), error => error.code === 'TRANSFER_BUSY');
  assert.equal(busy.memory.calls.length, callsBefore); assert.equal(busy.server.requests.length, 0);
  const accepted = await fixture({ sharedImage: true }); let held = false;
  accepted.faults.onStage = () => assert.equal(held, true);
  const result = await accepted.make(undefined, { async request(name, options, callback) {
    assert.equal(name, Core.wordSyncLock); held = true; try { return await callback({ name }); } finally { held = false; }
  } }).run({ backupId: accepted.backup.id });
  assert.equal(result.verified, true); assert.equal(held, false);
});

test('only explicit Drive insufficient-scope reasons request authentication; quota, file permissions and 503 remain ordinary failures', async () => {
  for (const reason of ['ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'insufficientPermissions', 'insufficient_scope']) {
    const f = await fixture(); f.faults.responseError = { status: 403, body: { error: { message: 'untrusted private content', details: [{ reason }] } } };
    await assert.rejects(f.make().run({ backupId: f.backup.id }), error => error.code === 'TRANSFER_AUTH_REQUIRED' && error.auth === true && error.reason === 'google_permission_required' && !error.message.includes('private'));
    assert.equal(f.uploads.length, 0);
  }
  for (const [status, reason] of [[403, 'rateLimitExceeded'], [403, 'storageQuotaExceeded'], [403, 'insufficientFilePermissions'], [503, 'ACCESS_TOKEN_SCOPE_INSUFFICIENT']]) {
    const f = await fixture(); f.faults.responseError = { status, body: { error: { message: 'insufficient scope misleading message', errors: [{ reason }] } } };
    await assert.rejects(f.make().run({ backupId: f.backup.id }), error => error.code === 'TRANSFER_DRIVE_REQUEST_FAILED' && !error.auth && error.httpStatus === status);
    assert.equal(f.uploads.length, 0);
  }
});
