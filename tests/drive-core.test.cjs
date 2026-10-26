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
