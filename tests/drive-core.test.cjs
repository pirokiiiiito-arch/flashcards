const {driveServer,replica,tick}=require('./mock-runtime.cjs');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const crypto=require('node:crypto');
test('two devices add, edit, delete and stale cache cannot resurrect', async () => {
  const s = driveServer(), a = replica(s), b = replica(s); await a.connect(); await b.connect();
  a.local = { one: { word: 'test', meaning: 'first' } }; await a.api.sync(); await b.api.sync(); assert.deepEqual(b.local, a.local);
  b.local = { one: { word: 'test', meaning: 'phone-edit' } }; await b.api.sync(); await a.api.sync(); assert.equal(a.local.one.meaning, 'phone-edit');
  b.local = {}; await b.api.sync(); a.local = { ...a.local, another: 'new' }; await a.api.sync(); await b.api.sync(); assert.equal(a.local.one, undefined); assert.equal(b.local.one, undefined); assert.equal(a.local.another, 'new');
  assert.ok(s.requests.filter(x => x.method !== 'GET').every(x => x.method === 'POST'));
});
test('concurrent modifications retain both versions and converge; deletion wins concurrency', async () => {
  const s = driveServer(), a = replica(s, { x: 'base' }), b = replica(s); await a.connect(); await b.connect();
  a.local = { x: 'pc' }; b.local = { x: 'phone' }; await Promise.all([a.api.sync(), b.api.sync()]); await a.api.sync(); await b.api.sync();
  assert.equal(a.local.x, b.local.x); assert.equal(a.api.status().conflicts, 1);
  a.local = {}; b.local = { x: 'stale-edit' }; await Promise.all([a.api.sync(), b.api.sync()]); await a.api.sync(); await b.api.sync(); assert.equal(a.local.x, undefined); assert.equal(b.local.x, undefined);
});
test('three namespaces and account boundaries do not leak cached data', async () => {
  const s = driveServer(), a = replica(s, { x: 1 }, { namespace: 'word' }), b = replica(s, { x: 2 }, { namespace: 'plant' }), c = replica(s, { x: 3 }, { namespace: 'color' });
  await a.connect(); await b.connect(); await c.connect(); await a.api.sync(); assert.equal(a.local.x, 1); assert.equal(b.local.x, 2); assert.equal(c.local.x, 3);
});
test('401 never opens an automatic popup; changes survive and reconnect retries', async () => {
  const s = driveServer(), a = replica(s, { x: 'first' }); await a.connect(); const count = a.tokenRequests;
  a.local = { x: 'offline' }; s.fail = true; await assert.rejects(a.api.sync()); assert.equal(a.tokenRequests, count); assert.equal(a.local.x, 'offline');
  s.fail = false; await a.connect(); assert.equal(a.local.x, 'offline'); assert.equal(a.tokenRequests, count + 1);
});
test('image blob is private, deduplicated and restored after IndexedDB blob eviction', async () => {
  const s = driveServer(), a = replica(s), b = replica(s); await a.connect(); await b.connect();
  const image = new Blob([new Uint8Array([0, 255, 2, 127, 80])], { type: 'image/png' });
  const ref = await a.api.putBlob(image), same = await a.api.putBlob(image); assert.equal(ref, same);
  a.local = { image: ref }; await a.api.sync(); await b.api.sync(); const restored = await b.api.getBlob(b.local.image); assert.deepEqual(Buffer.from(await restored.arrayBuffer()), Buffer.from(await image.arrayBuffer()));
  b.db.dbs.get('flashcards_drive_cache_v3').get('blobs').clear(); const again = await b.api.getBlob(ref); assert.deepEqual(Buffer.from(await again.arrayBuffer()), Buffer.from(await image.arrayBuffer()));
  assert.equal([...s.files.values()].filter(x => x.appProperties.kind === 'image').length, 1);
});
test('save during slow remote preparation is preserved', async () => {
  const s = driveServer(), a = replica(s, { x: 'base' }), b = replica(s); await a.connect(); await b.connect(); b.local = { x: 'remote' }; await b.api.sync();
  let release; a.setGate(new Promise(r => release = r)); const syncing = a.api.sync(); await tick(); await tick(); a.local = { x: 'saved-during-sync' }; release(); await syncing;
  assert.ok(a.local.x === 'saved-during-sync' || a.api.status().conflicts > 0);
  const all = [...s.files.values()].filter(f => f.appProperties.kind === 'journal').flatMap(f => JSON.parse(f.content).events); assert.ok(all.some(e => e.value === 'saved-during-sync'));
});
test('legacy files with the same filename are all reconciled, with tombstones', async () => {
  const s = driveServer();
  for (const [id, data] of [['old1', { data: { a: 'one', gone: 'old' }, deleted: {} }], ['old2', { data: { b: 'two' }, deleted: { gone: '2026-10-26T00:00:00Z' } }]]) {
    const content = Buffer.from(JSON.stringify(data)); s.files.set(id, { id, name: 'old.json', appProperties: {}, mimeType: 'application/json', content, md5Checksum: crypto.createHash('md5').update(content).digest('hex') });
  }
  const options = { legacy: [{ file: 'old.json', convert: async x => x }] };
  const a = replica(s, { local: 'kept' }, options), b = replica(s, {}, options); await a.connect(); await b.connect(); await a.api.sync();
  assert.equal(a.local.a, 'one'); assert.equal(a.local.b, 'two'); assert.equal(a.local.local, 'kept'); assert.equal(a.local.gone, undefined); assert.deepEqual(a.local, b.local);
});
test('a different Google account cannot receive the previous account cache', async () => {
  const s = driveServer(), a = replica(s, { private: 'account-one' }); await a.connect(); const before = s.files.size;
  s.account = 'account2'; a.local = { private: 'changed' }; await assert.rejects(a.api.sync(), /別のGoogleアカウント/); assert.equal(s.files.size, before);
});
test('no-change sync does not upload another journal', async () => {
  const s = driveServer(), a = replica(s, { x: 'same' }); await a.connect(); const before = s.files.size; await a.api.sync(); await a.api.sync(); assert.equal(s.files.size, before);
});
test('offline pending edits survive reload of the app', async () => {
  const s = driveServer(), a = replica(s, { x: 'base' }); await a.connect(); await a.off(); a.local = { x: 'offline-after-reload' };
  await assert.rejects(a.api.sync()); const b = replica(s, a.local, { db: a.db, storage: a.storage }); await b.connect();
  assert.equal(b.local.x, 'offline-after-reload');
});

const explicitWord = { namespace: 'word-flashcards', explicitDeletions: true, deletionKeyPrefix: 'card:' };
const syntheticWords = count => Object.fromEntries(Array.from({ length: count }, (_, i) => ['card:synthetic-' + i,
  { id: 'synthetic-' + i, word: 'Synthetic ' + i, meaning: 'Example ' + i, sort_order: i + 1,
    images: i === 0 ? [{ ref: 'gdrive:synthetic-image:' + 'a'.repeat(64), name: 'synthetic.png', type: 'image/png' }] : [] }]));
const intentsIn = storage => [...storage.keys()].filter(k => k.startsWith('flashcards_drive_delete_intent_v1:'));
const journalEvents = server => [...server.files.values()].filter(f => f.appProperties.kind === 'journal').flatMap(f => JSON.parse(f.content).events);

test('word stale 75-card local copy does not delete the 93-card journal on restart', async () => {
  const server = driveServer(), full = syntheticWords(93), original = replica(server, full, explicitWord);
  await original.connect(); await original.off();
  const history = JSON.stringify(journalEvents(server));
  const stale = Object.fromEntries(Object.entries(full).slice(0, 75));
  const reopened = replica(server, stale, { ...explicitWord, db: original.db, storage: original.storage });
  await reopened.api.ready;
  assert.equal(Object.keys(reopened.api.view().deleted).length, 0);
  await reopened.connect();
  assert.equal(Object.keys(reopened.local).length, 93);
  assert.deepEqual(reopened.local['card:synthetic-0'].images, full['card:synthetic-0'].images);
  assert.equal(JSON.stringify(journalEvents(server)), history, 'missing local rows must not create new history');
});

test('word devices still receive ordinary additions from 75 to 93 without explicit deletions', async () => {
  const server = driveServer(), pc = replica(server, syntheticWords(75), explicitWord), phone = replica(server, {}, explicitWord);
  await pc.connect(); await phone.connect(); phone.local = syntheticWords(93); await phone.api.sync(); await pc.api.sync();
  assert.equal(Object.keys(pc.local).length, 93); assert.deepEqual(pc.local, phone.local);
  assert.equal(Object.keys(pc.api.view().deleted).length, 0);
});

test('confirmed offline deletion survives a crash before the card save and retains prior image history', async () => {
  const server = driveServer(), full = syntheticWords(3), original = replica(server, full, explicitWord);
  await original.connect(); await original.off();
  const receipt = original.api.recordDeletions(['card:synthetic-0']);
  assert.equal(intentsIn(original.storage).length, 1);
  const reopened = replica(server, full, { ...explicitWord, db: original.db, storage: original.storage });
  await reopened.api.ready;
  assert.equal(intentsIn(original.storage).length, 0, 'the exact receipt is acknowledged after journal persistence');
  await reopened.connect();
  assert.equal(Object.keys(reopened.local).length, 2);
  assert.ok(reopened.api.view().deleted['card:synthetic-0']);
  const events = journalEvents(server);
  assert.ok(events.some(e => e.key === 'card:synthetic-0' && !e.deleted && e.value.images[0].ref === full['card:synthetic-0'].images[0].ref));
  // Replaying an unacknowledged receipt after a crash must reuse the same event.
  original.storage.set(receipt[0].storageKey, receipt[0].raw);
  const replay = replica(server, reopened.local, { ...explicitWord, db: original.db, storage: original.storage });
  await replay.connect();
  assert.equal(journalEvents(server).filter(e => e.id === JSON.parse(receipt[0].raw).event.id).length, 1);
});

test('a deletion recorded before first Drive initialization remains durable until initial import completes', async () => {
  const server = driveServer(), full = syntheticWords(3), original = replica(server, full, explicitWord);
  await original.api.ready; original.api.recordDeletions(['card:synthetic-1']);
  const reopened = replica(server, full, { ...explicitWord, db: original.db, storage: original.storage });
  await reopened.api.ready;
  assert.equal(intentsIn(original.storage).length, 1, 'uninitialized capture must not acknowledge the intent');
  await reopened.connect();
  assert.equal(Object.keys(reopened.local).length, 2);
  assert.ok(reopened.api.view().deleted['card:synthetic-1']);
  assert.equal(intentsIn(original.storage).length, 0);
});

test('an intent is retained if journal persistence fails and only its own receipt can be cancelled', async () => {
  const server = driveServer(), original = replica(server, syntheticWords(2), explicitWord);
  await original.connect(); await original.off();
  const cancelled = original.api.recordDeletions(['card:synthetic-0']);
  const retained = original.api.recordDeletions(['card:synthetic-0']);
  original.api.cancelDeletions(cancelled);
  assert.deepEqual(intentsIn(original.storage), [retained[0].storageKey]);
  const put = original.api.cache.put;
  original.api.cache.put = async () => { throw Error('synthetic persistence failure'); };
  await assert.rejects(original.api.sync(), /synthetic persistence failure/);
  assert.equal(original.storage.get(retained[0].storageKey), retained[0].raw);
  const stored = original.db.dbs.get('flashcards_drive_cache_v3').get('states').get('word-flashcards');
  assert.equal(stored.events[JSON.parse(retained[0].raw).event.id], undefined);
  original.api.cache.put = put;
  const reopened = replica(server, original.local, { ...explicitWord, db: original.db, storage: original.storage });
  await reopened.connect(); assert.equal(Object.keys(reopened.local).length, 1);
  assert.equal(intentsIn(original.storage).length, 0);
});

test('an old local value cannot resurrect a known word tombstone after restart', async () => {
  const server = driveServer(), full = syntheticWords(3), original = replica(server, full, explicitWord);
  await original.connect(); original.api.recordDeletions(['card:synthetic-1']);
  original.local = { 'card:synthetic-0': full['card:synthetic-0'], 'card:synthetic-2': full['card:synthetic-2'] };
  await original.api.sync(); await original.off();
  const history = JSON.stringify(journalEvents(server));
  const reopened = replica(server, full, { ...explicitWord, db: original.db, storage: original.storage });
  await reopened.connect();
  assert.equal(Object.keys(reopened.local).length, 2); assert.ok(reopened.api.view().deleted['card:synthetic-1']);
  assert.equal(JSON.stringify(journalEvents(server)), history);
});

test('explicit word deletion records reject invalid keys before any durable intent is written', async () => {
  const server = driveServer(), local = replica(server, syntheticWords(1), explicitWord); await local.api.ready;
  assert.throws(() => local.api.recordDeletions(['card:synthetic-0', 'migration:unrelated']), /ID/);
  assert.equal(intentsIn(local.storage).length, 0);
});
