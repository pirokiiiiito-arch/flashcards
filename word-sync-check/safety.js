/* Local preservation only. Source storage is read-only; no authentication or network code. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  root.WordSyncSafety = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';
  const CARDS_KEY = 'simple_vocab_cards_v1';
  const SOURCE_DB = 'flashcards_drive_cache_v3';
  const STATE_KEY = 'word-flashcards';
  const BACKUP_DB = 'word_sync_safety_backups_v1';
  const SCHEMA = 'word-sync-safety-snapshot-v1';
  const SUMMARY_FIELDS = ['rawPresent', 'validCards', 'cardCount', 'duplicateIdCount', 'missingIdCount', 'invalidCardCount', 'imageCount', 'availableImageCount', 'missingImageCount', 'complete', 'cacheStatus', 'cacheLiveCount', 'cacheDeletedCount', 'cachePendingCount', 'overlapDeletedCount', 'localOnlyCandidateCount', 'accountFingerprint', 'loginStored'];
  const IMAGE_FIELDS = ['cardIndex', 'cardId', 'imageIndex', 'ref', 'name', 'type', 'cacheKey', 'expectedHash', 'status', 'blobKey', 'actualHash', 'blobType', 'size'];
  const own = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const copy = value => JSON.parse(JSON.stringify(value));
  const pick = (value, fields) => Object.fromEntries(fields.filter(key => own(value, key)).map(key => [key, value[key]]));
  const canonical = value => JSON.stringify(value, (key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(name => [name, item[name]])) : item);
  function failure(code, message, cause) {
    const error = new Error(message); error.code = code;
    if (cause) error.cause = cause;
    return error;
  }
  function storageFailure(error) {
    if (typeof error?.code === 'string' && error.code.startsWith('SAFETY_')) return error;
    return error?.name === 'QuotaExceededError'
      ? failure('SAFETY_STORAGE_FULL', '保全用の空き容量が足りません。元の単語・画像は変更していません。', error)
      : failure('SAFETY_STORAGE_UNAVAILABLE', 'このブラウザの保全保存を利用できません。元の単語・画像は変更していません。', error);
  }
  function idOf(card) {
    const id = card && typeof card === 'object' ? card.id : null;
    return (typeof id === 'string' && id.length) || (typeof id === 'number' && Number.isFinite(id) && id !== 0) ? String(id) : null;
  }
  function imageEntries(cards) {
    const result = [];
    cards.forEach((card, cardIndex) => {
      if (!card || typeof card !== 'object' || Array.isArray(card) || card.images == null) return;
      const images = Array.isArray(card.images) ? card.images : [null];
      images.forEach((image, imageIndex) => {
        const metadata = image && typeof image === 'object' && !Array.isArray(image) ? image : {};
        const ref = typeof metadata.ref === 'string' ? metadata.ref : null;
        const local = ref?.match(/^local:([a-f0-9]{64})$/), drive = ref?.match(/^gdrive:([A-Za-z0-9_-]{1,256}):([a-f0-9]{64})$/);
        const type = typeof metadata.type === 'string' ? metadata.type : null;
        const invalidName = metadata.name !== undefined && metadata.name !== '' && (typeof metadata.name !== 'string' || /[\u0000-\u001f\u007f]/.test(metadata.name));
        result.push({ cardIndex, cardId: idOf(card), imageIndex, ref, name: typeof metadata.name === 'string' ? metadata.name : null, type,
          cacheKey: local ? 'word-image:' + local[1] : drive ? ref : null,
          expectedHash: local ? local[1] : drive ? drive[2] : null,
          status: !local && !drive ? 'invalid_ref' : invalidName || !/^image\/(png|jpeg|webp|gif)$/.test(type || '') ? 'invalid_metadata' : 'missing',
          blob: null, blobKey: null, actualHash: null, blobType: null, size: null });
      });
    });
    return result;
  }
  function imageKeys(image) {
    if (!image.cacheKey) return [];
    // WordImages may retain a Drive-referenced original in the local hash cache.
    return image.ref.startsWith('gdrive:') ? [image.cacheKey, 'word-image:' + image.expectedHash] : [image.cacheKey];
  }
  function cacheCounts(state, localIds) {
    const result = { cacheLiveCount: null, cacheDeletedCount: null, cachePendingCount: null, overlapDeletedCount: null, localOnlyCandidateCount: null };
    if (!state || !state.events || typeof state.events !== 'object' || Array.isArray(state.events)) return result;
    const groups = new Map(), superseded = new Set();
    for (const event of Object.values(state.events)) {
      if (!event || typeof event.id !== 'string' || typeof event.key !== 'string' || !Array.isArray(event.parents)) return result;
      for (const parent of event.parents) superseded.add(parent);
      if (!groups.has(event.key)) groups.set(event.key, []);
      groups.get(event.key).push(event);
    }
    const live = new Set(), deleted = new Set();
    for (const [key, events] of groups) {
      if (!key.startsWith('card:')) continue;
      const heads = events.filter(event => !superseded.has(event.id)).sort((a, b) => Number(!!(a.deleted || a.value?.deleted)) - Number(!!(b.deleted || b.value?.deleted)) || Number(a.clock) - Number(b.clock) || a.id.localeCompare(b.id));
      const head = heads[heads.length - 1];
      if (head) (head.deleted ? deleted : live).add(key.slice(5));
    }
    const ids = [...new Set(localIds.filter(id => id !== null))];
    return { cacheLiveCount: live.size, cacheDeletedCount: deleted.size,
      cachePendingCount: Array.isArray(state.pending) ? state.pending.length : null,
      overlapDeletedCount: ids.filter(id => deleted.has(id)).length,
      localOnlyCandidateCount: ids.filter(id => !live.has(id) && !deleted.has(id)).length };
  }
  function create(options = {}) {
    const indexedDB = options.indexedDB || root.indexedDB, crypto = options.crypto || root.crypto;
    const BlobType = options.Blob || root.Blob, now = options.now || Date.now;
    const inspections = new WeakMap();
    async function hash(value) {
      if (!crypto?.subtle) throw failure('SAFETY_HASH_UNAVAILABLE', '保全内容の検証を利用できません。HTTPSの同じブラウザで開いてください。');
      const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
      return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
    }
    function openDatabase(name, createBackup = false) {
      return new Promise((resolve, reject) => {
        if (!indexedDB) { reject(storageFailure()); return; }
        let request, absent = false, settled = false;
        const finish = (error, db) => { if (settled) { db?.close(); return; } settled = true; clearTimeout(timer); error ? reject(error) : resolve(db); };
        const timer = setTimeout(() => finish(failure('SAFETY_STORAGE_TIMEOUT', '保存領域の確認が時間内に完了しませんでした。元のデータは変更していません。')), options.timeoutMs || 10000);
        try { request = createBackup ? indexedDB.open(name, 1) : indexedDB.open(name); }
        catch (error) { finish(storageFailure(error)); return; }
        request.onupgradeneeded = event => {
          if (!createBackup || event.oldVersion !== 0) {
            absent = !createBackup;
            // Opening a missing source must not create a database or its schema.
            request.transaction.abort(); return;
          }
          request.result.createObjectStore('snapshots'); request.result.createObjectStore('blobs');
        };
        request.onerror = () => finish(absent ? null : storageFailure(request.error), null);
        request.onblocked = () => finish(failure('SAFETY_STORAGE_BLOCKED', '保存領域が別の処理で使用中です。元のデータは変更していません。'));
        request.onsuccess = () => {
          const db = request.result; db.onversionchange = () => db.close(); finish(null, db);
        };
      });
    }
    function readValues(db, requests) {
      const names = [...new Set(requests.map(request => request.store))];
      if (!names.length) return Promise.resolve([]);
      return new Promise((resolve, reject) => {
        let tx, settled = false; const values = new Array(requests.length);
        const finish = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(values); };
        const timer = setTimeout(() => {
          finish(failure('SAFETY_STORAGE_TIMEOUT', '保存領域の読取りが時間内に完了しませんでした。元のデータは変更していません。'));
          try { tx?.abort(); } catch (_) {}
        }, options.timeoutMs || 10000);
        try {
          tx = db.transaction(names, 'readonly');
          requests.forEach((entry, index) => {
            const request = tx.objectStore(entry.store).get(entry.key);
            request.onsuccess = () => { values[index] = request.result; };
          });
        } catch (error) { finish(storageFailure(error)); try { tx?.abort(); } catch (_) {} return; }
        tx.oncomplete = () => finish();
        tx.onerror = tx.onabort = () => finish(storageFailure(tx.error));
      });
    }
    async function inspect() {
      let originalRaw;
      try { originalRaw = (options.storage || root.localStorage).getItem(CARDS_KEY); }
      catch (error) { throw failure('SAFETY_CARDS_UNAVAILABLE', 'このブラウザの単語データを読み取れません。元のデータは変更していません。', error); }
      let loginStored = null;
      try { loginStored = !!(options.storage || root.localStorage).getItem('flashcards_supabase_session_v1'); } catch (_) { /* Presence only; do not parse or retain authentication values. */ }
      let cards = [], validCards = false;
      try { const parsed = JSON.parse(originalRaw); if (Array.isArray(parsed)) { cards = parsed; validCards = true; } } catch (_) { /* Keep the exact original, including invalid JSON, for diagnosis only. */ }
      const images = imageEntries(cards), keys = [...new Set(images.flatMap(imageKeys))];
      let cacheState = null, cacheStatus = 'missing', stored = new Map();
      try {
        const db = await openDatabase(SOURCE_DB);
        if (db) {
          try {
            const reads = [];
            if (db.objectStoreNames.contains('states')) reads.push({ store: 'states', key: STATE_KEY });
            if (db.objectStoreNames.contains('blobs')) for (const key of keys) reads.push({ store: 'blobs', key });
            const values = await readValues(db, reads);
            reads.forEach((request, index) => { if (request.store === 'states') cacheState = values[index] || null; else stored.set(request.key, values[index]); });
            cacheStatus = cacheState ? 'present' : 'missing';
          } finally { db.close(); }
        }
      } catch (_) { cacheStatus = 'unavailable'; }
      const checked = new Map();
      for (const image of images) {
        if (!image.cacheKey) continue;
        let result = null, sourceKey = image.cacheKey;
        for (const key of imageKeys(image)) {
          if (!checked.has(key)) {
            const blob = stored.get(key); let candidate = null;
            if (blob instanceof BlobType) {
              try {
                const actualHash = await hash(await blob.arrayBuffer());
                candidate = { blob, actualHash, blobType: blob.type, size: blob.size, blobKey: 'sha256:' + actualHash + ':' + blob.type };
              } catch (_) { candidate = { unreadable: true }; }
            }
            checked.set(key, candidate);
          }
          const candidate = checked.get(key);
          if (!result || result.unreadable) { result = candidate; sourceKey = key; }
          if (candidate && !candidate.unreadable && candidate.actualHash === image.expectedHash && candidate.blobType === image.type && candidate.size > 0) { result = candidate; sourceKey = key; break; }
        }
        if (!result || result.unreadable) {
          if (image.status === 'missing') image.status = result?.unreadable || cacheStatus === 'unavailable' ? 'read_failed' : 'missing';
          continue;
        }
        Object.assign(image, result, { cacheKey: sourceKey });
        if (image.status === 'invalid_metadata') continue;
        image.status = image.actualHash !== image.expectedHash ? 'hash_mismatch' : image.blobType !== image.type ? 'type_mismatch' : image.size === 0 ? 'empty_blob' : 'available';
      }
      const ids = cards.map(idOf), presentIds = ids.filter(id => id !== null);
      const counts = cacheCounts(cacheState, ids);
      if (cacheStatus === 'present' && counts.cacheLiveCount === null) cacheStatus = 'invalid';
      let accountFingerprint = null;
      if (typeof cacheState?.account === 'string' && cacheState.account) {
        try { accountFingerprint = (await hash(cacheState.account)).slice(0, 12); } catch (_) { /* No unverified account label. */ }
      }
      const invalidCardCount = cards.filter(card => !card || typeof card !== 'object' || Array.isArray(card)).length;
      const summary = { rawPresent: originalRaw !== null, validCards, cardCount: validCards ? cards.length : null,
        duplicateIdCount: presentIds.length - new Set(presentIds).size, missingIdCount: ids.length - presentIds.length, invalidCardCount,
        imageCount: images.length, availableImageCount: images.filter(image => image.status === 'available').length,
        missingImageCount: images.filter(image => image.status !== 'available').length,
        complete: validCards && cards.length > 0 && invalidCardCount === 0 && images.every(image => image.status === 'available'),
        cacheStatus, ...counts, accountFingerprint, loginStored };
      const captured = { originalRaw, cards, images, summary };
      const result = { originalRaw, cards: copy(cards), cacheState: cacheState ? copy(pick(cacheState, ['events', 'pending', 'account'])) : null,
        images: images.map(image => ({ ...image })), summary: { ...summary } };
      inspections.set(result, captured); return result;
    }
    function manifestOf(snapshot) {
      return { schema: snapshot.schema, originalRaw: snapshot.originalRaw, originalRawHash: snapshot.originalRawHash,
        cardIds: copy(snapshot.cardIds), images: snapshot.images.map(image => pick(image, IMAGE_FIELDS)), summary: pick(snapshot.summary, SUMMARY_FIELDS) };
    }
    function receipt(snapshot, reused = false) {
      const summary = copy(snapshot.summary);
      return { id: snapshot.id, createdAt: snapshot.createdAt, verified: true, complete: summary.complete,
        cardCount: summary.cardCount, imageCount: summary.imageCount, savedImageCount: summary.availableImageCount,
        missingImageCount: summary.missingImageCount, missingImages: snapshot.images.filter(image => image.status !== 'available').map(image => pick(image, ['cardIndex', 'imageIndex', 'ref', 'status'])), summary, reused };
    }
    async function verifyBlob(record, key) {
      if (!record || !(record.blob instanceof BlobType) || record.key !== key || record.type !== record.blob.type || record.size !== record.blob.size
        || record.sha256 !== await hash(await record.blob.arrayBuffer()) || key !== 'sha256:' + record.sha256 + ':' + record.type)
        throw failure('SAFETY_VERIFICATION_FAILED', '保全した画像の読み戻しが一致しません。完全保存とは扱いません。元のデータは変更していません。');
    }
    async function verifiedRead(db, id) {
      const [stored] = await readValues(db, [{ store: 'snapshots', key: id }]);
      if (!stored) throw failure('SAFETY_BACKUP_NOT_FOUND', '指定した保全データが見つかりません。');
      let manifest;
      try { manifest = manifestOf(stored); }
      catch (error) { throw failure('SAFETY_VERIFICATION_FAILED', '保全データの形式を確認できません。', error); }
      if (stored.id !== id || manifest.schema !== SCHEMA || await hash(canonical(manifest)) !== id || await hash(manifest.originalRaw) !== manifest.originalRawHash)
        throw failure('SAFETY_VERIFICATION_FAILED', '保全した単語の読み戻しが一致しません。完全保存とは扱いません。');
      const keys = [...new Set(manifest.images.map(image => image.blobKey).filter(Boolean))];
      const blobs = await readValues(db, keys.map(key => ({ store: 'blobs', key })));
      for (let index = 0; index < keys.length; index++) await verifyBlob(blobs[index], keys[index]);
      for (const image of manifest.images) if (image.blobKey) {
        const blob = blobs[keys.indexOf(image.blobKey)];
        if (blob.sha256 !== image.actualHash || blob.type !== image.blobType || blob.size !== image.size)
          throw failure('SAFETY_VERIFICATION_FAILED', '保全した画像情報の読み戻しが一致しません。');
      }
      const snapshot = { ...manifest, id, createdAt: stored.createdAt };
      return { snapshot, blobs, receipt: receipt(snapshot) };
    }
    function append(db, snapshot, blobs) {
      return new Promise((resolve, reject) => {
        let tx, requestError, settled = false;
        const finish = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(); };
        const timer = setTimeout(() => {
          finish(failure('SAFETY_STORAGE_TIMEOUT', '保全用の保存が時間内に完了しませんでした。元のデータは変更していません。'));
          try { tx?.abort(); } catch (_) {}
        }, options.timeoutMs || 10000);
        try {
          tx = db.transaction(['snapshots', 'blobs'], 'readwrite');
          for (const record of blobs) {
            const request = tx.objectStore('blobs').add(record, record.key); request.onerror = () => { requestError = request.error; };
          }
          const request = tx.objectStore('snapshots').add(snapshot, snapshot.id); request.onerror = () => { requestError = request.error; };
        } catch (error) { finish(error); try { tx?.abort(); } catch (_) {} return; }
        tx.oncomplete = () => finish();
        tx.onerror = tx.onabort = () => finish(requestError || tx.error);
      });
    }
    async function save(inspection) {
      if (!inspection) inspection = await inspect();
      const captured = inspections.get(inspection);
      if (!captured) throw failure('SAFETY_INSPECTION_REQUIRED', 'この画面で読み取った単語データを先に確認してください。');
      if (!captured.summary.validCards || !captured.summary.cardCount)
        throw failure('SAFETY_NO_CARDS', 'このブラウザでは保全する単語を確認できません。単語が表示される同じブラウザで開いてください。');
      const manifest = { schema: SCHEMA, originalRaw: captured.originalRaw, originalRawHash: await hash(captured.originalRaw),
        cardIds: captured.cards.map(card => card && typeof card === 'object' && own(card, 'id') ? copy(card.id) : null),
        images: captured.images.map(image => pick(image, IMAGE_FIELDS)), summary: pick(captured.summary, SUMMARY_FIELDS) };
      const id = await hash(canonical(manifest)), snapshot = { ...manifest, id, createdAt: new Date(now()).toISOString() };
      const unique = new Map();
      for (const image of captured.images) if (image.blobKey && image.blob)
        unique.set(image.blobKey, { key: image.blobKey, sha256: image.actualHash, type: image.blobType, size: image.size, blob: image.blob });
      const db = await openDatabase(BACKUP_DB, true);
      try {
        if (!db.objectStoreNames.contains('snapshots') || !db.objectStoreNames.contains('blobs')) throw failure('SAFETY_BACKUP_SCHEMA', '保全用の保存領域の形式が一致しません。');
        for (let attempt = 0; attempt < 3; attempt++) {
          const keys = [...unique.keys()];
          const [existing, ...stored] = await readValues(db, [{ store: 'snapshots', key: id }, ...keys.map(key => ({ store: 'blobs', key }))]);
          if (existing) { const result = await verifiedRead(db, id); return { ...result.receipt, reused: true }; }
          const fresh = [];
          for (let index = 0; index < keys.length; index++) {
            if (stored[index]) await verifyBlob(stored[index], keys[index]); else fresh.push(unique.get(keys[index]));
          }
          try { await append(db, snapshot, fresh); const result = await verifiedRead(db, id); return result.receipt; }
          catch (error) { if (error?.name === 'ConstraintError' && attempt < 2) continue; throw storageFailure(error); }
        }
      } finally { db.close(); }
    }
    async function read(id) {
      if (!/^[a-f0-9]{64}$/.test(String(id))) throw failure('SAFETY_BACKUP_NOT_FOUND', '保全データの番号を確認できません。');
      const db = await openDatabase(BACKUP_DB);
      if (!db) throw failure('SAFETY_BACKUP_NOT_FOUND', '保全データがまだありません。');
      try { return await verifiedRead(db, id); } finally { db.close(); }
    }
    async function exportJSON(id) {
      const result = await read(id), assets = [];
      const encode = options.btoa || root.btoa;
      for (const record of result.blobs) {
        const bytes = new Uint8Array(await record.blob.arrayBuffer()), parts = [];
        for (let offset = 0; offset < bytes.length; offset += 24576) parts.push(encode(String.fromCharCode(...bytes.subarray(offset, offset + 24576))));
        assets.push({ key: record.key, sha256: record.sha256, type: record.type, size: record.size, data: 'data:' + record.type + ';base64,' + parts.join('') });
      }
      const document = { schema: 'word-sync-safety-export-v1', snapshot: result.snapshot, assets, verified: true, complete: result.receipt.complete };
      const timeParts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(result.snapshot.createdAt));
      const filenameTime = ['year', 'month', 'day', 'hour', 'minute', 'second'].map(type => timeParts.find(part => part.type === type).value).join('');
      return { blob: new BlobType([JSON.stringify(document)], { type: 'application/json' }),
        filename: 'word-sync-safety-' + filenameTime + '-JST-' + result.receipt.cardCount + 'cards.json', receipt: result.receipt };
    }
    return Object.freeze({ inspect, save, read, exportJSON });
  }
  return Object.freeze({ ...create(), create, CARDS_KEY, SOURCE_DB, STATE_KEY, BACKUP_DB, SCHEMA });
});
