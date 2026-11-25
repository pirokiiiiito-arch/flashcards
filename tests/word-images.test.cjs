'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const source = fs.readFileSync(path.join(__dirname, '../word-images.js'), 'utf8');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));

// A small, valid PNG generator keeps fixtures synthetic and covers base64 chunks.
function png(width = 1, height = 1, seed = 1) {
  const crc = bytes => {
    let value = -1;
    for (const byte of bytes) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    }
    return (value ^ -1) >>> 0;
  };
  const chunk = (name, bytes) => {
    const body = Buffer.concat([Buffer.from(name), bytes]), header = Buffer.alloc(4), footer = Buffer.alloc(4);
    header.writeUInt32BE(bytes.length); footer.writeUInt32BE(crc(body));
    return Buffer.concat([header, body, footer]);
  };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.alloc(height * (width * 3 + 1));
  for (let y = 0; y < height; y++) for (let x = 1; x <= width * 3; x++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    rows[y * (width * 3 + 1) + x] = seed & 255;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
function imageFile(bytes = png(), name = '元の画像.png', type = 'image/png') { return new File([bytes], name, { type }); }
function embedded(bytes = png(), type = 'image/png') { return { name: '画像.png', type, data: 'data:' + type + ';base64,' + bytes.toString('base64') }; }

// Emulates transaction commit/abort, including all-or-nothing quota failure.
function memoryIDB({ quota = Infinity, unavailable = false } = {}) {
  const stores = new Map();
  let initialized = false, opens = 0;
  const indexedDB = { open(name, version) {
    assert.equal(name, 'flashcards_drive_cache_v3'); assert.equal(version, 1); opens++;
    const request = {};
    queueMicrotask(() => {
      if (unavailable) { request.error = new DOMException('storage disabled', 'SecurityError'); request.onerror?.(); return; }
      const db = {
        objectStoreNames: { contains: name => stores.has(name) },
        createObjectStore(name) { assert.ok(!stores.has(name)); stores.set(name, new Map()); },
        close() {},
        transaction(name, mode) {
          assert.ok(stores.has(name));
          const operations = [], tx = { error: null }, original = stores.get(name);
          let aborted = false;
          tx.abort = () => {
            if (aborted) return;
            aborted = true;
            queueMicrotask(() => tx.onabort?.());
          };
          tx.objectStore = actual => {
            assert.equal(actual, name);
            return {
              get(key) { const req = {}; operations.push({ method: 'get', key, req }); return req; },
              put(value, key) { assert.equal(mode, 'readwrite'); const req = {}; operations.push({ method: 'put', key, value, req }); return req; }
            };
          };
          setImmediate(() => {
            if (aborted) return;
            const pending = new Map(original);
            for (const operation of operations) if (operation.method === 'put') pending.set(operation.key, operation.value);
            const total = [...pending.values()].reduce((sum, value) => sum + (value?.size || 0), 0);
            if (mode === 'readwrite' && total > quota) {
              tx.error = new DOMException('storage quota', 'QuotaExceededError');
              for (const operation of operations) { operation.req.error = tx.error; operation.req.onerror?.(); }
              tx.onerror?.(); tx.abort(); return;
            }
            if (mode === 'readwrite') stores.set(name, pending);
            for (const operation of operations) {
              operation.req.result = operation.method === 'get' ? original.get(operation.key) : operation.key;
              operation.req.onsuccess?.();
            }
            tx.oncomplete?.();
          });
          return tx;
        }
      };
      request.result = db;
      if (!initialized) { initialized = true; request.onupgradeneeded?.(); }
      request.onsuccess?.();
    });
    return request;
  } };
  return { indexedDB, stores, get opens() { return opens; } };
}
function setup(options = {}) {
  const memory = options.memory || memoryIDB(options);
  const root = { Blob, crypto: webcrypto, indexedDB: memory.indexedDB, btoa, atob };
  Object.assign(root, options.runtime || {});
  if (options.api) root.WordDriveSync = options.api;
  vm.runInNewContext(source, { window: root });
  return { images: root.WordImages, memory, root };
}

test('normalization accepts legacy absence and rejects external or malformed references without mutation', () => {
  const { images } = setup(), hash = sha(png());
  assert.deepEqual(plain(images.normalizeImages()), []);
  assert.deepEqual(plain(images.normalizeImages(null)), []);
  const input = [{ ref: 'local:' + hash, name: '図.png', type: 'image/png' }], before = JSON.stringify(input);
  assert.deepEqual(plain(images.normalizeImages(input)), input);
  assert.equal(JSON.stringify(input), before);
  for (const ref of ['https://example.test/image.png', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'local:bad', 'gdrive:../file:' + hash, 'gdrive:file:' + hash.toUpperCase()])
    assert.throws(() => images.normalizeImages([{ ...input[0], ref }]), /保存先情報/);
  assert.throws(() => images.normalizeImages({}), /画像一覧/);
  assert.throws(() => images.normalizeImages([{ ...input[0], type: 'image/svg+xml' }]), /PNG/);
});

test('offline file storage preserves original bytes and uses only dedicated IndexedDB blob keys', async () => {
  const { images, memory } = setup(), bytes = png(3, 2), file = imageFile(bytes);
  const image = await images.storeFile(file);
  assert.equal(image.ref, 'local:' + sha(bytes));
  assert.equal(image.name, file.name);
  assert.deepEqual([...memory.stores.keys()].sort(), ['blobs', 'states']);
  assert.deepEqual([...memory.stores.get('blobs').keys()], ['word-image:' + sha(bytes)]);
  assert.equal(memory.stores.get('states').size, 0);
  assert.deepEqual(Buffer.from(await (await images.getBlob(image)).arrayBuffer()), bytes);
});

test('image JSON export/import restores bytes on a fresh device across base64 chunk boundaries', async () => {
  const a = setup(), bytes = png(120, 100);
  assert.ok(bytes.length > 24576);
  const image = await a.images.storeFile(imageFile(bytes, '写真と説明.png'));
  const cards = [{ id: 'private-id', word: '写真', meaning: '', images: [image] }, { word: 'apple', meaning: 'りんご' }];
  const snapshot = JSON.stringify(cards), backup = await a.images.exportCards(cards);
  assert.equal(JSON.stringify(cards), snapshot);
  assert.equal(backup[0].images[0].data, 'data:image/png;base64,' + bytes.toString('base64'));
  assert.equal(backup[0].id, undefined);
  assert.deepEqual(plain(backup[1]), { word: 'apple', meaning: 'りんご' });
  const b = setup(), restored = await b.images.importCards(JSON.parse(JSON.stringify(backup)));
  assert.equal(restored[0].meaning, '');
  assert.equal(restored[0].images[0].name, '写真と説明.png');
  assert.equal(restored[0].images[0].ref, image.ref);
  assert.deepEqual(Buffer.from(await (await b.images.getBlob(restored[0].images[0])).arrayBuffer()), bytes);
  assert.deepEqual(plain(await b.images.exportCards(restored)), plain(backup));
});

test('old text-only JSON remains compatible without requiring image storage', async () => {
  const { images, memory } = setup({ unavailable: true });
  const old = [{ word: '単語', meaning: '意味\n説明' }];
  assert.deepEqual(plain(await images.importCards(old)), [{ ...old[0], images: [] }]);
  assert.deepEqual(plain(await images.exportCards(old)), old);
  assert.deepEqual(plain(await images.importCards([])), []);
  assert.equal(memory.opens, 0);
});

test('empty, oversized, unsupported and mismatched image files are rejected before saving', async () => {
  const { images, memory } = setup();
  await assert.rejects(images.storeFile(imageFile(Buffer.alloc(0))), /空の画像/);
  await assert.rejects(images.storeFile(imageFile(Buffer.alloc(images.MAX_BYTES + 1))), /20MB/);
  await assert.rejects(images.storeFile(imageFile(png(), 'bad.gif', 'image/gif')), /内容とファイル形式/);
  await assert.rejects(images.storeFile(imageFile(Buffer.from('<svg/>'), 'drawing.svg', 'image/svg+xml')), /PNG/);
  await assert.rejects(images.storeFile(imageFile(Buffer.from('not a png'))), /内容とファイル形式/);
  assert.equal(memory.opens, 0);
});

test('a broken backup fails as a whole before any new image is persisted', async () => {
  const { images, memory } = setup(), valid = embedded();
  for (const invalid of [
    { ...valid, data: 'https://example.test/image.png' },
    { ...valid, data: valid.data.replace(/.$/, '!') },
    { ...valid, data: 'data:image/png;base64,AB==' },
    { ...valid, type: 'image/jpeg' },
    { ...valid, ref: 'javascript:alert(1)' },
    { ...valid, type: 'image/svg+xml' }
  ]) {
    const input = [{ word: 'first', meaning: '', images: [valid] }, { word: 'second', meaning: '', images: [invalid] }];
    const snapshot = JSON.stringify(input);
    await assert.rejects(images.importCards(input), /保存JSON|画像の内容/);
    assert.equal(JSON.stringify(input), snapshot);
  }
  await assert.rejects(images.importCards([{ word: '', meaning: '説明', images: [valid] }]), /カードには単語/);
  await assert.rejects(images.importCards({ cards: [] }), /配列/);
  assert.equal(memory.opens, 0);
});

test('quota failures are explained in Japanese and multi-image imports commit atomically', async () => {
  const bytesA = png(2, 2, 1), bytesB = png(2, 2, 2), one = setup({ quota: 1 });
  await assert.rejects(one.images.storeFile(imageFile(bytesA)), /保存容量が不足/);
  assert.equal(one.memory.stores.get('blobs').size, 0);
  const many = setup({ quota: Math.max(bytesA.length, bytesB.length) + 1 });
  const cards = [{ word: 'pictures', meaning: '', images: [embedded(bytesA), embedded(bytesB)] }];
  await assert.rejects(many.images.importCards(cards), /保存容量が不足/);
  assert.equal(many.memory.stores.get('blobs').size, 0, 'first image must not survive a later quota failure');
  assert.equal(cards[0].images[0].ref, undefined);
});

test('Drive conversion uploads exact local bytes, validates the returned hash and preserves existing references', async () => {
  const { images } = setup(), bytes = png(), image = await images.storeFile(imageFile(bytes));
  const driveRef = 'gdrive:synthetic_file-1:' + sha(bytes), calls = [];
  const api = { async putBlob(blob) { calls.push(Buffer.from(await blob.arrayBuffer())); return driveRef; } };
  const input = [image, { ...image, ref: driveRef }], before = JSON.stringify(input);
  const converted = await images.toCloudImages(input, api);
  assert.equal(calls.length, 1); assert.deepEqual(calls[0], bytes);
  assert.deepEqual(plain(converted), [{ ...plain(image), ref: driveRef }, { ...plain(image), ref: driveRef }]);
  assert.equal(JSON.stringify(input), before);
  await assert.rejects(images.toCloudImages([image]), /Google Driveに接続/);
  await assert.rejects(images.toCloudImages([image], { async putBlob() { return 'gdrive:file:' + '0'.repeat(64); } }), /一致しません/);
  assert.deepEqual(plain(await images.toCloudImages([])), []);
});

test('Drive image downloads are hash-checked and then remain available without a connection', async () => {
  const bytes = png(2, 3), image = { ref: 'gdrive:fixture_remote:' + sha(bytes), name: '遠隔.png', type: 'image/png' };
  let downloads = 0;
  const api = { async getBlob(ref) { assert.equal(ref, image.ref); downloads++; return new Blob([bytes], { type: image.type }); } };
  const a = setup({ api });
  assert.deepEqual(Buffer.from(await (await a.images.getBlob(image)).arrayBuffer()), bytes);
  const b = setup({ memory: a.memory });
  assert.deepEqual(Buffer.from(await (await b.images.getBlob(image)).arrayBuffer()), bytes);
  assert.equal(downloads, 1);
  const backup = await b.images.exportCards([{ word: 'offline', meaning: '', images: [image] }]);
  assert.equal(backup[0].images[0].data, embedded(bytes).data);
});

test('missing or corrupted bytes never silently produce a successful image backup', async () => {
  const bytes = png(), other = png(1, 1, 2), a = setup(), hash = sha(bytes);
  const local = { ref: 'local:' + hash, name: '図.png', type: 'image/png' };
  await assert.rejects(a.images.exportCards([{ word: 'lost', meaning: '', images: [local] }]), /元データが端末にありません/);
  const remote = { ...local, ref: 'gdrive:fixture:' + hash };
  await assert.rejects(a.images.getBlob(remote), /Google Driveへの接続/);
  await assert.rejects(a.images.getBlob(remote, { async getBlob() { return new Blob([other], { type: 'image/png' }); } }), /保存データが一致/);
  assert.equal(a.memory.stores.get('blobs').size, 0);
  a.memory.stores.get('blobs').set('word-image:' + hash, new Blob([other], { type: 'image/png' }));
  await assert.rejects(a.images.getBlob(local), /保存データが一致/);
});

test('a disabled browser store produces a useful error without returning an unsaved image', async () => {
  const { images } = setup({ unavailable: true });
  await assert.rejects(images.storeFile(imageFile()), /ブラウザーに画像を保存・読込できません/);
});

test('browser decoding failure prevents storing a file or importing a backup even when its signature passes', async () => {
  let decodes = 0;
  const a = setup({ runtime: { async createImageBitmap() { decodes++; throw new Error('decoder rejected truncated data'); } } });
  await assert.rejects(a.images.storeFile(imageFile()), /画像ファイルを表示できません/);
  await assert.rejects(a.images.importCards([{ word: 'broken', meaning: '', images: [embedded()] }]), /画像ファイルを表示できません/);
  assert.equal(decodes, 2);
  assert.equal(a.memory.opens, 0);
});

test('a browser-supported image can use the Image fallback, with its original bytes and URL cleanup', async () => {
  let created = 0, revoked = 0, loaded = 0;
  const bytes = png(), runtime = {
    async createImageBitmap() { throw new Error('bitmap decoder does not support this format'); },
    URL: {
      createObjectURL(blob) { assert.equal(blob.size, bytes.length); created++; return 'blob:test-image'; },
      revokeObjectURL(url) { assert.equal(url, 'blob:test-image'); revoked++; }
    },
    Image: class {
      constructor() { this.naturalWidth = 1; this.naturalHeight = 1; }
      set src(url) { assert.equal(url, 'blob:test-image'); loaded++; queueMicrotask(() => this.onload()); }
    }
  };
  const a = setup({ runtime }), image = await a.images.storeFile(imageFile(bytes));
  assert.equal(created, 1); assert.equal(revoked, 1); assert.equal(loaded, 1);
  assert.deepEqual(Buffer.from(await (await a.images.getBlob(image)).arrayBuffer()), bytes);
  assert.equal(loaded, 1, 'normal reads must not run the extra import-time decoder again');
});
