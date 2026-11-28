'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { webcrypto, createHash } = require('node:crypto');
const Safety = require('../word-sync-check/safety.js');
const sha = value => createHash('sha256').update(value).digest('hex');
const SESSION_KEY = 'flashcards_supabase_session_v1';
const SECRET = 'synthetic-session-value-must-never-be-exported';

// Transactional fixture: source mutations are forbidden, backup add() commits
// atomically, and a failed upgrade leaves an absent source database absent.
function memoryIDB({ source = true } = {}) {
  const dbs = new Map(), calls = [], faults = { quota: false, corruptBlobRead: false, stallSourceRead: false, stallBackupWrite: false };
  if (source) dbs.set(Safety.SOURCE_DB, new Map([['states', new Map()], ['blobs', new Map()]]));
  function connection(name, stores, upgrade = false) {
    return {
      objectStoreNames: { contains: store => stores.has(store) }, close() { calls.push({ method: 'close', name }); },
      createObjectStore(store) {
        calls.push({ method: 'createObjectStore', name, store });
        assert.equal(name, Safety.BACKUP_DB); assert.equal(upgrade, true);
        stores.set(store, new Map());
      },
      transaction(names, mode) {
        names = Array.isArray(names) ? names : [names]; calls.push({ method: 'transaction', name, stores: names, mode });
        if (name === Safety.SOURCE_DB) assert.equal(mode, 'readonly', 'source database must never be writable');
        for (const store of names) assert.ok(stores.has(store));
        const operations = []; let aborted = false;
        const tx = { error: null, abort() { if (aborted) return; aborted = true; calls.push({ method: 'abortTransaction', name, mode }); setImmediate(() => tx.onabort?.()); },
          objectStore(store) {
            assert.ok(names.includes(store));
            const operation = (method, key, value) => {
              calls.push({ method, name, store, key });
              if (method !== 'get') { assert.equal(name, Safety.BACKUP_DB); assert.equal(mode, 'readwrite'); }
              const request = {}; operations.push({ method, store, key, value, request }); return request;
            };
            return {
              get: key => operation('get', key), add: (value, key) => operation('add', key, value),
              put() { assert.fail('put is forbidden'); }, delete() { assert.fail('delete is forbidden'); }, clear() { assert.fail('clear is forbidden'); }
            };
          }
        };
        setImmediate(() => {
          if (aborted) return;
          if ((name === Safety.SOURCE_DB && faults.stallSourceRead) || (name === Safety.BACKUP_DB && mode === 'readwrite' && faults.stallBackupWrite)) return;
          const pending = new Map([...stores].map(([store, values]) => [store, new Map(values)]));
          let failed;
          for (const operation of operations) {
            if (operation.method === 'get') continue;
            if (faults.quota) { failed = new DOMException('synthetic quota', 'QuotaExceededError'); break; }
            const values = pending.get(operation.store);
            if (values.has(operation.key)) { failed = new DOMException('existing key', 'ConstraintError'); break; }
            values.set(operation.key, structuredClone(operation.value));
          }
          if (failed) {
            tx.error = failed;
            for (const operation of operations) { operation.request.error = failed; operation.request.onerror?.(); }
            tx.onerror?.(); tx.abort(); return;
          }
          if (mode === 'readwrite') for (const [store, values] of pending) stores.set(store, values);
          for (const operation of operations) {
            let value = operation.method === 'get' ? structuredClone(stores.get(operation.store).get(operation.key)) : operation.key;
            if (operation.method === 'get' && faults.corruptBlobRead && name === Safety.BACKUP_DB && operation.store === 'blobs' && value)
              value.blob = new Blob(['tampered'], { type: value.type });
            operation.request.result = value; operation.request.onsuccess?.();
          }
          tx.oncomplete?.();
        });
        return tx;
      }
    };
  }
  const indexedDB = {
    open(name, version) {
      calls.push({ method: 'open', name, version }); const request = {};
      setImmediate(() => {
        const existing = dbs.get(name), stores = existing || new Map();
        request.result = connection(name, stores, !existing);
        let aborted = false;
        request.transaction = { abort() { aborted = true; calls.push({ method: 'abortUpgrade', name }); } };
        if (!existing) request.onupgradeneeded?.({ oldVersion: 0 });
        if (aborted) { request.error = new DOMException('upgrade aborted', 'AbortError'); request.onerror?.(); return; }
        if (!existing) dbs.set(name, stores);
        request.onsuccess?.();
      });
      return request;
    },
    deleteDatabase() { assert.fail('deleteDatabase is forbidden'); }
  };
  return { indexedDB, dbs, calls, faults };
}
function cards(count = 105) { return Array.from({ length: count }, (_, index) => ({ id: 'id-' + index, word: 'synthetic word ' + index, meaning: 'synthetic meaning ' + index, images: [] })); }
function state() {
  const events = {};
  for (let index = 0; index < 78; index++) events['event-' + index] = { id: 'event-' + index, key: 'card:id-' + index, parents: [], clock: index + 1, deleted: index >= 75, value: index < 75 ? { id: 'id-' + index } : null };
  return { events, pending: [], account: 'synthetic-private-drive-account', refresh_token: SECRET };
}
function setup({ data = cards(), raw, source = true, images = [], session = SECRET, sessionThrows = false, timeoutMs = 2000 } = {}) {
  const memory = memoryIDB({ source }), values = new Map([[Safety.CARDS_KEY, raw === undefined ? JSON.stringify(data, null, 2) + '\n' : raw], [SESSION_KEY, session], ['unrelated-private-key', SECRET]]), reads = [];
  const storage = { getItem(key) { reads.push(key); if (key === SESSION_KEY && sessionThrows) throw Error('synthetic blocked session'); return values.get(key) ?? null; }, setItem() { assert.fail('source localStorage write forbidden'); }, removeItem() { assert.fail('source localStorage remove forbidden'); }, clear() { assert.fail('source localStorage clear forbidden'); } };
  if (source) {
    memory.dbs.get(Safety.SOURCE_DB).get('states').set(Safety.STATE_KEY, state());
    for (const [key, blob] of images) memory.dbs.get(Safety.SOURCE_DB).get('blobs').set(key, blob);
    memory.dbs.get(Safety.SOURCE_DB).get('blobs').set('unrelated-plant-image', new Blob(['unrelated']));
  }
  let time = Date.UTC(2026, 10, 28, 12);
  const api = Safety.create({ indexedDB: memory.indexedDB, storage, crypto: webcrypto, Blob, btoa, now: () => time, timeoutMs });
  return { api, memory, values, reads, advance: () => { time += 60000; } };
}
async function originalFingerprint(f) {
  const stores = f.memory.dbs.get(Safety.SOURCE_DB), objects = [];
  if (stores) for (const [name, values] of stores) for (const [key, value] of values)
    objects.push([name, key, value instanceof Blob ? [value.type, Buffer.from(await value.arrayBuffer()).toString('base64')] : value]);
  return JSON.stringify({ localStorage: [...f.values], objects });
}
function localImage(bytes = Buffer.from('synthetic original bytes'), name = '原本.png') {
  const hash = sha(bytes), image = { ref: 'local:' + hash, type: 'image/png', name };
  return { bytes, image, key: 'word-image:' + hash, blob: new Blob([bytes], { type: image.type }) };
}

test('inspection reads exact 105-card raw text and reports cached 75/3/pending0 without writes or credential output', async () => {
  const f = setup(), before = await originalFingerprint(f), result = await f.api.inspect();
  assert.equal(result.originalRaw, f.values.get(Safety.CARDS_KEY));
  assert.equal(result.summary.cardCount, 105); assert.equal(result.summary.cacheLiveCount, 75);
  assert.equal(result.summary.cacheDeletedCount, 3); assert.equal(result.summary.cachePendingCount, 0);
  assert.equal(result.summary.overlapDeletedCount, 3); assert.equal(result.summary.localOnlyCandidateCount, 27);
  assert.equal(result.summary.accountFingerprint, sha('synthetic-private-drive-account').slice(0, 12));
  assert.equal(result.summary.loginStored, true);
  assert.ok(!JSON.stringify(result.summary).includes(SECRET));
  assert.deepEqual(f.reads, [Safety.CARDS_KEY, SESSION_KEY]);
  assert.equal(f.memory.dbs.has(Safety.BACKUP_DB), false);
  assert.equal(await originalFingerprint(f), before);
});

test('save and portable export preserve IDs, raw whitespace and referenced original blobs, and omit session/cache-account values', async () => {
  const a = localImage(), b = localImage(Buffer.from('another original'), '別の原本.png'); b.image.ref = 'gdrive:synthetic-file:' + sha(b.bytes); b.key = b.image.ref;
  const data = cards(); data[0].images = [a.image, b.image, a.image];
  const f = setup({ data, images: [[a.key, a.blob], [b.key, b.blob]] }), before = await originalFingerprint(f);
  const inspected = await f.api.inspect(), receipt = await f.api.save(inspected);
  assert.equal(receipt.verified, true); assert.equal(receipt.complete, true); assert.equal(receipt.savedImageCount, 3);
  const result = await f.api.read(receipt.id);
  assert.equal(result.snapshot.originalRaw, f.values.get(Safety.CARDS_KEY));
  assert.deepEqual(result.snapshot.cardIds, data.map(card => card.id));
  assert.equal(result.blobs.length, 2, 'duplicate references share one exact byte copy');
  const exported = await f.api.exportJSON(receipt.id), text = await exported.blob.text(), doc = JSON.parse(text);
  assert.equal(exported.filename, 'word-sync-safety-20261128210000-JST-105cards.json');
  assert.equal(doc.snapshot.originalRaw, f.values.get(Safety.CARDS_KEY));
  assert.equal(doc.assets.length, 2); assert.ok(doc.assets.some(asset => asset.data.endsWith(a.bytes.toString('base64'))));
  assert.ok(!text.includes(SECRET)); assert.ok(!text.includes('synthetic-private-drive-account'));
  assert.ok(!text.includes('unrelated-plant-image')); assert.ok(!text.includes('refresh_token'));
  assert.equal(await originalFingerprint(f), before);
  const reads = f.memory.calls.filter(call => call.name === Safety.SOURCE_DB && call.store === 'blobs');
  assert.deepEqual(new Set(reads.map(call => call.key)), new Set([a.key, b.key, 'word-image:' + sha(b.bytes)]));
});

test('missing and invalid image metadata never prevent raw card preservation and never claim a complete backup', async () => {
  const a = localImage(), data = cards(); data[0].images = [a.image, { ref: 'malformed', type: 'image/png' }];
  data[1].images = 'invalid image collection';
  const f = setup({ data }), inspection = await f.api.inspect(), receipt = await f.api.save(inspection);
  assert.equal(receipt.verified, true); assert.equal(receipt.complete, false);
  assert.equal(receipt.missingImageCount, 3); assert.equal(receipt.cardCount, 105);
  assert.equal((await f.api.read(receipt.id)).snapshot.originalRaw, f.values.get(Safety.CARDS_KEY));
  const doc = JSON.parse(await (await f.api.exportJSON(receipt.id)).blob.text());
  assert.equal(doc.complete, false); assert.equal(doc.assets.length, 0);
});

test('mismatched referenced bytes are retained as an incomplete candidate instead of silently certified or deleted', async () => {
  const a = localImage(), data = cards(); data[0].images = [a.image];
  const wrong = new Blob(['different cached bytes'], { type: 'image/png' }), f = setup({ data, images: [[a.key, wrong]] });
  const inspected = await f.api.inspect(); assert.equal(inspected.images[0].status, 'hash_mismatch');
  const receipt = await f.api.save(inspected), result = await f.api.read(receipt.id);
  assert.equal(receipt.complete, false); assert.equal(receipt.missingImageCount, 1);
  assert.equal(await result.blobs[0].blob.text(), 'different cached bytes');
});

test('an absent source database is aborted without creating it, while a new separate backup remains possible', async () => {
  const f = setup({ source: false }), inspected = await f.api.inspect();
  assert.equal(inspected.summary.cacheStatus, 'missing'); assert.equal(inspected.summary.cacheLiveCount, null);
  assert.equal(f.memory.dbs.has(Safety.SOURCE_DB), false);
  assert.ok(f.memory.calls.some(call => call.method === 'abortUpgrade' && call.name === Safety.SOURCE_DB));
  const receipt = await f.api.save(inspected); assert.equal(receipt.cardCount, 105); assert.equal(receipt.complete, true);
  assert.equal(f.memory.dbs.has(Safety.SOURCE_DB), false);
});

test('zero, missing or malformed card data cannot create a successful empty backup', async () => {
  for (const raw of ['[]', null, '{broken', '{}']) {
    const f = setup({ raw }), inspected = await f.api.inspect();
    assert.equal(inspected.summary.complete, false);
    await assert.rejects(f.api.save(inspected), error => error.code === 'SAFETY_NO_CARDS');
    assert.equal(f.memory.dbs.has(Safety.BACKUP_DB), false);
  }
});

test('repeated same-content saves verify and reuse the existing snapshot; a changed raw is appended without overwrite', async () => {
  const a = localImage(), data = cards(); data[0].images = [a.image];
  const f = setup({ data, images: [[a.key, a.blob]] }), first = await f.api.save(await f.api.inspect());
  const initialAddCount = f.memory.calls.filter(call => call.method === 'add').length;
  f.advance(); const second = await f.api.save(await f.api.inspect());
  assert.equal(second.id, first.id); assert.equal(second.createdAt, first.createdAt); assert.equal(second.reused, true);
  assert.equal(f.memory.calls.filter(call => call.method === 'add').length, initialAddCount);
  data.push({ id: 'id-105', word: 'new synthetic', meaning: 'new', images: [] });
  f.values.set(Safety.CARDS_KEY, JSON.stringify(data));
  const third = await f.api.save(await f.api.inspect()); assert.notEqual(third.id, first.id);
  const stores = f.memory.dbs.get(Safety.BACKUP_DB);
  assert.equal(stores.get('snapshots').size, 2); assert.equal(stores.get('blobs').size, 1);
  assert.equal((await f.api.read(first.id)).receipt.cardCount, 105);
});

test('quota failure atomically aborts only the new backup and leaves old source and backup records untouched', async () => {
  const a = localImage(), f = setup(), first = await f.api.save(await f.api.inspect());
  const data = cards(); data[0].images = [a.image]; f.values.set(Safety.CARDS_KEY, JSON.stringify(data));
  f.memory.dbs.get(Safety.SOURCE_DB).get('blobs').set(a.key, a.blob);
  const before = await originalFingerprint(f); f.memory.faults.quota = true;
  await assert.rejects(f.api.save(await f.api.inspect()), error => error.code === 'SAFETY_STORAGE_FULL');
  assert.equal(await originalFingerprint(f), before);
  const stores = f.memory.dbs.get(Safety.BACKUP_DB);
  assert.equal(stores.get('snapshots').size, 1); assert.equal(stores.get('blobs').size, 0);
  f.memory.faults.quota = false;
  assert.equal((await f.api.read(first.id)).receipt.verified, true);
});

test('readback mismatch never returns a verified receipt or overwrites an existing hash', async () => {
  const a = localImage(), data = cards(); data[0].images = [a.image];
  const f = setup({ data, images: [[a.key, a.blob]] }); f.memory.faults.corruptBlobRead = true;
  await assert.rejects(f.api.save(await f.api.inspect()), error => error.code === 'SAFETY_VERIFICATION_FAILED');
  const addCount = f.memory.calls.filter(call => call.method === 'add').length;
  await assert.rejects(f.api.save(await f.api.inspect()), error => error.code === 'SAFETY_VERIFICATION_FAILED');
  assert.equal(f.memory.calls.filter(call => call.method === 'add').length, addCount);
});

test('changing the public inspection object cannot change the privately captured raw, IDs or image bytes', async () => {
  const a = localImage(), data = cards(); data[0].images = [a.image];
  const f = setup({ data, images: [[a.key, a.blob]] }), inspected = await f.api.inspect();
  inspected.originalRaw = '[]'; inspected.cards.length = 0; inspected.summary.cardCount = 0; inspected.images[0].ref = 'changed';
  const receipt = await f.api.save(inspected), result = await f.api.read(receipt.id);
  assert.equal(receipt.cardCount, 105); assert.equal(result.snapshot.originalRaw, f.values.get(Safety.CARDS_KEY));
  assert.equal(result.snapshot.images[0].ref, a.image.ref);
  assert.deepEqual(Buffer.from(await result.blobs[0].blob.arrayBuffer()), a.bytes);
});

test('duplicate/missing IDs are reported and preserved, never normalized', async () => {
  const data = cards(); data[1].id = data[0].id; delete data[2].id;
  const f = setup({ data }), inspected = await f.api.inspect();
  assert.equal(inspected.summary.duplicateIdCount, 1); assert.equal(inspected.summary.missingIdCount, 1);
  const receipt = await f.api.save(inspected), { snapshot } = await f.api.read(receipt.id);
  assert.equal(snapshot.cardIds[0], snapshot.cardIds[1]); assert.equal(snapshot.cardIds[2], null);
  assert.equal(snapshot.originalRaw, f.values.get(Safety.CARDS_KEY));
});

test('session presence is a boolean only and unreadable session presence remains unknown', async () => {
  const absent = setup({ session: '' }), blocked = setup({ sessionThrows: true });
  assert.equal((await absent.api.inspect()).summary.loginStored, false);
  const inspected = await blocked.api.inspect(); assert.equal(inspected.summary.loginStored, null);
  const receipt = await blocked.api.save(inspected), exported = await blocked.api.exportJSON(receipt.id);
  assert.ok(!(await exported.blob.text()).includes(SECRET));
});

test('reading a missing backup does not create either database', async () => {
  const f = setup({ source: false });
  await assert.rejects(f.api.read('a'.repeat(64)), error => error.code === 'SAFETY_BACKUP_NOT_FOUND');
  assert.equal(f.memory.dbs.size, 0);
});

test('a Drive reference can preserve its verified original from the word-image hash cache without network access', async () => {
  const a = localImage(), data = cards(), driveRef = 'gdrive:synthetic-file:' + sha(a.bytes);
  data[0].images = [{ ...a.image, ref: driveRef }];
  const f = setup({ data, images: [[a.key, a.blob], [driveRef, new Blob(['mismatched cached copy'], { type: 'image/png' })]] });
  const before = await originalFingerprint(f), inspected = await f.api.inspect();
  assert.equal(inspected.images[0].cacheKey, a.key); assert.equal(inspected.images[0].status, 'available');
  const receipt = await f.api.save(inspected), result = await f.api.read(receipt.id);
  assert.equal(receipt.complete, true); assert.equal(result.blobs.length, 1);
  assert.deepEqual(Buffer.from(await result.blobs[0].blob.arrayBuffer()), a.bytes);
  assert.equal(await originalFingerprint(f), before);
});

test('a stalled source readonly transaction is bounded, aborted and closed without changing any original', { timeout: 3000 }, async () => {
  const f = setup({ timeoutMs: 20 }), before = await originalFingerprint(f); f.memory.faults.stallSourceRead = true;
  const inspected = await f.api.inspect();
  assert.equal(inspected.summary.cardCount, 105); assert.equal(inspected.summary.cacheStatus, 'unavailable');
  assert.ok(f.memory.calls.some(call => call.method === 'abortTransaction' && call.name === Safety.SOURCE_DB && call.mode === 'readonly'));
  assert.ok(f.memory.calls.some(call => call.method === 'close' && call.name === Safety.SOURCE_DB));
  assert.equal(await originalFingerprint(f), before);
});

test('a stalled backup add transaction is bounded and atomic, and a later save can succeed', { timeout: 3000 }, async () => {
  const a = localImage(), data = cards(); data[0].images = [a.image];
  const f = setup({ data, images: [[a.key, a.blob]], timeoutMs: 20 }), before = await originalFingerprint(f), inspected = await f.api.inspect();
  f.memory.faults.stallBackupWrite = true;
  await assert.rejects(f.api.save(inspected), error => error.code === 'SAFETY_STORAGE_TIMEOUT');
  const stores = f.memory.dbs.get(Safety.BACKUP_DB);
  assert.equal(stores.get('snapshots').size, 0); assert.equal(stores.get('blobs').size, 0);
  assert.ok(f.memory.calls.some(call => call.method === 'abortTransaction' && call.name === Safety.BACKUP_DB));
  assert.ok(f.memory.calls.some(call => call.method === 'close' && call.name === Safety.BACKUP_DB));
  assert.equal(await originalFingerprint(f), before);
  f.memory.faults.stallBackupWrite = false;
  assert.equal((await f.api.save(inspected)).verified, true);
});
