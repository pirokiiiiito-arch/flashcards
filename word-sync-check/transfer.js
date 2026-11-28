/* Explicit, upload-only word transfer. Construction never starts work.
 * Original cards and source image stores are never written or deleted. */
(function (root, factory) {
  'use strict';
  const api = factory(root);
  root.WordSyncTransfer = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis, function (root) {
  'use strict';
  const CARDS_KEY = 'simple_vocab_cards_v1', SOURCE_DB = 'flashcards_drive_cache_v3', STATE_KEY = 'word-flashcards';
  const CHECKPOINT_DB = 'word_sync_transfer_checkpoints_v1', NAMESPACE = 'word-flashcards';
  const API = 'https://www.googleapis.com/drive/v3/', UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,md5Checksum';
  const AUTH_REASONS = new Set(['app_login_required', 'google_auth_required', 'google_permission_required', 'offline_permission_required', 'google_account_mismatch', 'connection_paused']);
  const clone = value => structuredClone(value);
  function fail(code, extra) {
    const error = new Error(code); error.code = code;
    if (extra) Object.assign(error, extra);
    return error;
  }
  function safeError(error) {
    return typeof error?.code === 'string' && error.code.startsWith('TRANSFER_') ? error : fail('TRANSFER_FAILED');
  }
  function imageRef(ref) {
    const local = typeof ref === 'string' && ref.match(/^local:([a-f0-9]{64})$/);
    const drive = typeof ref === 'string' && ref.match(/^gdrive:([A-Za-z0-9_-]{1,256}):([a-f0-9]{64})$/);
    if (local) return { local: true, hash: local[1] };
    if (drive) return { local: false, id: drive[1], hash: drive[2] };
    throw fail('TRANSFER_IMAGE_METADATA');
  }
  function normalizedImages(card) {
    if (card.images == null) return [];
    if (!Array.isArray(card.images)) throw fail('TRANSFER_IMAGE_METADATA');
    return card.images.map(image => {
      if (!image || typeof image !== 'object' || Array.isArray(image) || !/^image\/(png|jpeg|webp|gif)$/.test(image.type || '')) throw fail('TRANSFER_IMAGE_METADATA');
      const parsed = imageRef(image.ref);
      const name = image.name === undefined || image.name === '' ? '画像.' + (image.type === 'image/jpeg' ? 'jpg' : image.type.split('/')[1]) : image.name;
      if (typeof name !== 'string' || /[\u0000-\u001f\u007f]/.test(name)) throw fail('TRANSFER_IMAGE_METADATA');
      return { ...image, name, parsed };
    });
  }
  function create(options = {}) {
    const core = options.core || root.FlashcardsDrive, safety = options.safety || root.WordSyncSafety, auth = options.auth || root.PersistentDriveAuth;
    const indexedDB = options.indexedDB || root.indexedDB;
    const fetcher = options.fetcher || ((...args) => root.fetch(...args));
    const locks = options.locks === undefined ? root.navigator?.locks : options.locks;
    const timeoutMs = options.timeoutMs || 60000, storageTimeout = Math.min(timeoutMs, 10000);
    let running = null;
    const storage = () => options.storage || root.localStorage;
    const progress = (stage, completed, total) => { try { options.onProgress?.({ stage, ...(completed === undefined ? {} : { completed }), ...(total === undefined ? {} : { total }) }); } catch (_) {} };
    const same = (a, b) => core.stable(a) === core.stable(b);
    function openDB(name, createCheckpoint = false) {
      return new Promise((resolve, reject) => {
        let request, settled = false, absent = false;
        const finish = (error, db) => { if (settled) { db?.close(); return; } settled = true; clearTimeout(timer); error ? reject(error) : resolve(db); };
        const timer = setTimeout(() => finish(fail('TRANSFER_STORAGE')), storageTimeout);
        try { request = createCheckpoint ? indexedDB.open(name, 1) : indexedDB.open(name); }
        catch (_) { finish(fail('TRANSFER_STORAGE')); return; }
        request.onupgradeneeded = event => {
          if (!createCheckpoint || event.oldVersion !== 0) { absent = !createCheckpoint; request.transaction.abort(); return; }
          request.result.createObjectStore('checkpoints');
        };
        request.onerror = () => finish(absent ? null : fail('TRANSFER_STORAGE'), null);
        request.onblocked = () => finish(fail('TRANSFER_STORAGE'));
        request.onsuccess = () => { const db = request.result; db.onversionchange = () => db.close(); finish(null, db); };
      });
    }
    function transaction(db, stores, mode, schedule) {
      return new Promise((resolve, reject) => {
        let tx, result, settled = false, requestError;
        const finish = error => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(result); };
        const timer = setTimeout(() => { finish(fail('TRANSFER_STORAGE')); try { tx?.abort(); } catch (_) {} }, storageTimeout);
        try {
          tx = db.transaction(stores, mode);
          schedule(tx, value => { result = value; }, error => { requestError = error; });
        } catch (error) { finish(safeError(error)); try { tx?.abort(); } catch (_) {} return; }
        tx.oncomplete = () => finish();
        tx.onerror = tx.onabort = () => finish(requestError || fail('TRANSFER_STORAGE'));
      });
    }
    async function readRecords(db, store, keys) {
      return transaction(db, [store], 'readonly', (tx, done) => {
        const values = new Array(keys.length); done(values);
        keys.forEach((key, index) => { const request = tx.objectStore(store).get(key); request.onsuccess = () => { values[index] = request.result; }; });
      });
    }
    async function readState() {
      const db = await openDB(SOURCE_DB);
      if (!db) throw fail('TRANSFER_SOURCE_MISSING');
      try {
        if (!db.objectStoreNames.contains('states')) throw fail('TRANSFER_SOURCE_MISSING');
        const [state] = await readRecords(db, 'states', [STATE_KEY]);
        if (!state || !state.events || typeof state.events !== 'object' || !Array.isArray(state.pending) || !state.initialized) throw fail('TRANSFER_SOURCE_MISSING');
        return state;
      } finally { db.close(); }
    }
    async function checkpoint(kind, payload, verify) {
      const hash = await core.digest(core.stable(payload)), id = kind + ':' + hash;
      const db = await openDB(CHECKPOINT_DB, true);
      try {
        const [existing] = await readRecords(db, 'checkpoints', [id]);
        if (!existing) {
          try {
            await transaction(db, ['checkpoints'], 'readwrite', (tx, done, setError) => {
              const request = tx.objectStore('checkpoints').add({ id, kind, hash, createdAt: new Date().toISOString(), payload: clone(payload) }, id);
              request.onerror = () => setError(request.error?.name === 'ConstraintError' ? fail('TRANSFER_CHECKPOINT_EXISTS') : fail('TRANSFER_STORAGE'));
            });
          } catch (error) { if (error.code !== 'TRANSFER_CHECKPOINT_EXISTS') throw error; }
        }
        const [saved] = await readRecords(db, 'checkpoints', [id]);
        if (!saved || saved.id !== id || saved.kind !== kind || saved.hash !== hash || !same(saved.payload, payload) || await core.digest(core.stable(saved.payload)) !== hash) throw fail('TRANSFER_CHECKPOINT_FAILED');
        if (verify && !await verify(saved.payload)) throw fail('TRANSFER_CHECKPOINT_FAILED');
        return id;
      } finally { db.close(); }
    }
    function currentRaw() {
      try { return storage().getItem(CARDS_KEY); } catch (_) { throw fail('TRANSFER_STORAGE'); }
    }
    function assertRaw(raw) { if (currentRaw() !== raw) throw fail('TRANSFER_SOURCE_CHANGED'); }
    async function execute({ backupId } = {}) {
      if (!core?.digest || !core?.stable || !core?.materialize || !core?.wordImageEventEquivalent || !safety?.read || !auth?.getToken || !indexedDB) throw fail('TRANSFER_DEPENDENCY');
      progress('backup');
      let backup;
      try { backup = await safety.read(backupId); } catch (_) { throw fail('TRANSFER_BACKUP_UNVERIFIED'); }
      if (!backup?.receipt?.verified || !backup.receipt.complete || !backup.snapshot?.originalRaw) throw fail('TRANSFER_BACKUP_UNVERIFIED');
      const raw = backup.snapshot.originalRaw;
      if (currentRaw() !== raw) throw fail('TRANSFER_BACKUP_CHANGED');
      let cards;
      try { cards = JSON.parse(raw); } catch (_) { throw fail('TRANSFER_SOURCE_INVALID'); }
      if (!Array.isArray(cards) || !cards.length || cards.some(card => !card || typeof card.id !== 'string' || !card.id || typeof card.word !== 'string' || typeof card.meaning !== 'string')) throw fail('TRANSFER_SOURCE_INVALID');
      const localIds = new Set(cards.map(card => card.id));
      if (localIds.size !== cards.length) throw fail('TRANSFER_SOURCE_INVALID');
      cards.forEach(normalizedImages);
      const original = await readState(), expectedAccount = original.account;
      if (typeof expectedAccount !== 'string' || !expectedAccount) throw fail('TRANSFER_ACCOUNT_UNCONFIRMED');
      const pendingIds = [...new Set(original.pending)], pendingBefore = original.pending.length;
      for (const id of pendingIds) if (typeof id !== 'string' || !original.events[id] || original.events[id].id !== id) throw fail('TRANSFER_SOURCE_INVALID');
      progress('checkpoint');
      const sourceCheckpoint = await checkpoint('source', { schema: 'word-sync-transfer-source-v1', backupId, originalRaw: raw, state: original });
      assertRaw(raw);
      let verifiedToken = '', imageFiles = null, uploadedEvents = 0;
      const verifiedImages = new Map(), canonicalEvents = new Map(), newEvents = [];
      function authFailure(error) {
        let phase = '', required = false;
        try { phase = auth.state?.().phase || ''; required = auth.required?.() === true; } catch (_) {}
        const reason = AUTH_REASONS.has(error?.code) ? error.code : AUTH_REASONS.has(phase) ? phase : '';
        return reason || required || error?.auth === true
          ? fail('TRANSFER_AUTH_REQUIRED', { auth: true, reason: reason || 'google_auth_required' })
          : fail('TRANSFER_AUTH_TEMPORARY');
      }
      async function rawRequest(url, token, init = {}) {
        const controller = new AbortController(); let timer;
        const timeout = new Promise((resolve, reject) => { timer = setTimeout(() => { reject(fail('TRANSFER_TIMEOUT')); controller.abort(); }, timeoutMs); });
        try {
          return await Promise.race([timeout, (async () => {
            let response;
            try {
              const headers = new Headers(init.headers); headers.set('Authorization', 'Bearer ' + token);
              response = await fetcher(url, { ...init, headers, signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
            } catch (_) { throw fail('TRANSFER_NETWORK'); }
            if (response.status === 401) { controller.abort(); return { status: 401, ok: false }; }
            let bytes; try { bytes = await response.arrayBuffer(); } catch (_) { throw fail('TRANSFER_NETWORK'); }
            return { status: response.status, ok: response.ok, bytes, type: (response.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase() };
          })()]);
        } finally { clearTimeout(timer); }
      }
      function json(response) {
        try { return JSON.parse(new TextDecoder().decode(response.bytes)); } catch (_) { throw fail('TRANSFER_REMOTE_INVALID'); }
      }
      function requireOK(response) {
        if (!response.ok) {
          if (response.status === 403) {
            let data; try { data = JSON.parse(new TextDecoder().decode(response.bytes)); } catch (_) {}
            const reason = data?.error, reasons = typeof reason === 'string' ? [reason] : [reason?.reason, ...(Array.isArray(reason?.errors) ? reason.errors.map(item => item?.reason) : []), ...(Array.isArray(reason?.details) ? reason.details.map(item => item?.reason) : [])];
            if (reasons.some(value => ['ACCESS_TOKEN_SCOPE_INSUFFICIENT', 'insufficientPermissions', 'insufficient_scope'].includes(value)))
              throw fail('TRANSFER_AUTH_REQUIRED', { auth: true, reason: 'google_permission_required', httpStatus: 403 });
          }
          throw fail('TRANSFER_DRIVE_REQUEST_FAILED', { httpStatus: response.status });
        }
        return response;
      }
      async function invalidate(token) {
        if (typeof auth.invalidateAccess !== 'function') throw fail('TRANSFER_AUTH_REQUIRED', { auth: true, reason: 'google_auth_required' });
        try { await auth.invalidateAccess(token); } catch (error) { throw authFailure(error); }
        verifiedToken = '';
      }
      async function access() {
        for (let attempt = 0; attempt < 2; attempt++) {
          let current;
          try { current = await auth.getToken(); } catch (error) { throw authFailure(error); }
          if (!current || typeof current.token !== 'string' || !current.token) throw fail('TRANSFER_AUTH_REQUIRED', { auth: true, reason: 'google_auth_required' });
          if (verifiedToken !== current.token) {
            progress('account');
            const response = await rawRequest(API + 'about?fields=user(permissionId)', current.token);
            if (response.status === 401) { await invalidate(current.token); continue; }
            const actual = json(requireOK(response)).user?.permissionId;
            if (!actual || actual !== expectedAccount) throw fail('TRANSFER_ACCOUNT_MISMATCH');
            verifiedToken = current.token;
          }
          return current;
        }
        throw fail('TRANSFER_AUTH_REQUIRED', { auth: true, reason: 'google_auth_required' });
      }
      async function request(url, init = {}) {
        for (let attempt = 0; attempt < 2; attempt++) {
          const current = await access(), response = await rawRequest(url, current.token, init);
          if (response.status !== 401) return requireOK(response);
          await invalidate(current.token);
        }
        throw fail('TRANSFER_AUTH_REQUIRED', { auth: true, reason: 'google_auth_required' });
      }
      const queryKind = kind => "appProperties has { key='namespace' and value='" + NAMESPACE + "' } and appProperties has { key='kind' and value='" + kind + "' }";
      async function list(kind) {
        const result = []; let next = '';
        do {
          const params = new URLSearchParams({ spaces: 'appDataFolder', q: queryKind(kind) + ' and trashed=false', pageSize: '1000', fields: 'nextPageToken,files(id,name,md5Checksum,mimeType,appProperties)' });
          if (next) params.set('pageToken', next);
          const page = json(await request(API + 'files?' + params));
          if (!Array.isArray(page.files)) throw fail('TRANSFER_REMOTE_INVALID');
          result.push(...page.files); next = page.nextPageToken || '';
        } while (next);
        return result;
      }
      async function remote() {
        const events = Object.create(null), files = await list('journal');
        for (let index = 0; index < files.length; index++) {
          const document = json(await request(API + 'files/' + encodeURIComponent(files[index].id) + '?alt=media'));
          if (document.schema !== core.schema || document.namespace !== NAMESPACE || !Array.isArray(document.events)) throw fail('TRANSFER_REMOTE_INVALID');
          for (const event of document.events) {
            if (!event || typeof event.id !== 'string' || typeof event.key !== 'string' || !Array.isArray(event.parents)) throw fail('TRANSFER_REMOTE_INVALID');
            if (events[event.id] && !same(events[event.id], event)) throw fail('TRANSFER_HISTORY_CONFLICT');
            events[event.id] = event;
          }
          progress('remote', index + 1, files.length);
        }
        let view; try { view = core.materialize(events); } catch (_) { throw fail('TRANSFER_REMOTE_INVALID'); }
        if ([...localIds].some(id => Object.prototype.hasOwnProperty.call(view.deleted, 'card:' + id))) throw fail('TRANSFER_REMOTE_DELETION');
        return { events, view };
      }
      async function verifyRemoteImage(image) {
        const parsed = image.parsed || imageRef(image.ref);
        if (parsed.local) throw fail('TRANSFER_IMAGE_MISSING');
        const known = verifiedImages.get(image.ref);
        if (known) { if (known.hash !== parsed.hash || known.type !== image.type) throw fail('TRANSFER_IMAGE_MISMATCH'); return; }
        const response = await request(API + 'files/' + encodeURIComponent(parsed.id) + '?alt=media');
        if (response.type !== image.type || !response.bytes.byteLength || await core.digest(response.bytes) !== parsed.hash) throw fail('TRANSFER_IMAGE_MISMATCH');
        verifiedImages.set(image.ref, { hash: parsed.hash, type: image.type });
        progress('images', verifiedImages.size);
      }
      async function verifyEventImages(event) {
        if (event.deleted || !event.key.startsWith('card:')) return;
        for (const image of normalizedImages(event.value)) await verifyRemoteImage(image);
      }
      async function createFile(name, blob, properties) {
        assertRaw(raw);
        const boundary = 'word_transfer_' + (await core.digest(name + ':' + Date.now() + ':' + Math.random())).slice(0, 24);
        const metadata = { name, parents: ['appDataFolder'], mimeType: blob.type || 'application/json', appProperties: { namespace: NAMESPACE, ...properties } };
        const body = new Blob(['--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n', JSON.stringify(metadata), '\r\n--' + boundary + '\r\nContent-Type: ' + metadata.mimeType + '\r\n\r\n', blob, '\r\n--' + boundary + '--\r\n']);
        const created = json(await request(UPLOAD, { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body }));
        if (typeof created.id !== 'string' || !/^[A-Za-z0-9_-]{1,256}$/.test(created.id)) throw fail('TRANSFER_REMOTE_INVALID');
        return created;
      }
      const localBlobs = new Map();
      for (const record of backup.blobs || []) localBlobs.set(record.sha256 + ':' + record.type, record.blob);
      async function localBlob(image) {
        const parsed = image.parsed || imageRef(image.ref), key = parsed.hash + ':' + image.type;
        let blob = localBlobs.get(key);
        let fromCurrentBackup = !!blob;
        if (!blob) {
          const db = await openDB(SOURCE_DB);
          if (!db) throw fail('TRANSFER_IMAGE_MISSING');
          try {
            if (!db.objectStoreNames.contains('blobs')) throw fail('TRANSFER_IMAGE_MISSING');
            const keys = parsed.local ? ['word-image:' + parsed.hash] : [image.ref, 'word-image:' + parsed.hash];
            const candidates = await readRecords(db, 'blobs', keys);
            for (const candidate of candidates) if (candidate instanceof Blob && candidate.type === image.type && candidate.size && await core.digest(await candidate.arrayBuffer()) === parsed.hash) { blob = candidate; break; }
          } finally { db.close(); }
        }
        if (!(blob instanceof Blob)) throw fail('TRANSFER_IMAGE_MISSING');
        if (blob.type !== image.type || !blob.size || await core.digest(await blob.arrayBuffer()) !== parsed.hash) throw fail('TRANSFER_IMAGE_MISMATCH');
        if (!fromCurrentBackup) await checkpoint('image-source', { sourceCheckpoint, ref: image.ref, hash: parsed.hash, type: image.type, size: blob.size, blob },
          async saved => saved.blob instanceof Blob && saved.blob.type === saved.type && saved.blob.size === saved.size && await core.digest(await saved.blob.arrayBuffer()) === saved.hash);
        localBlobs.set(key, blob); return blob;
      }
      async function convertEvent(event) {
        const converted = clone(event);
        if (event.deleted || event.value?.deleted) throw fail('TRANSFER_PENDING_DELETION');
        if (!event.key.startsWith('card:')) return converted;
        const images = normalizedImages(event.value);
        if (!images.length) return converted;
        for (let index = 0; index < images.length; index++) {
          const image = images[index];
          if (!image.parsed.local) { await verifyRemoteImage(image); continue; }
          const blob = await localBlob(image);
          if (!imageFiles) imageFiles = await list('image');
          let file = imageFiles.find(candidate => candidate.appProperties?.sha256 === image.parsed.hash);
          if (!file) {
            progress('images', index, images.length);
            file = await createFile('image-' + image.parsed.hash, blob, { kind: 'image', sha256: image.parsed.hash });
            file.appProperties = { sha256: image.parsed.hash }; imageFiles.push(file);
          }
          const ref = 'gdrive:' + file.id + ':' + image.parsed.hash;
          await verifyRemoteImage({ ...image, ref, parsed: imageRef(ref) });
          // Preserve every original event and image field except the reference.
          converted.value.images[index].ref = ref;
        }
        if (!core.wordImageEventEquivalent(event, converted)) throw fail('TRANSFER_HISTORY_CONFLICT');
        return converted;
      }
      progress('auth'); await access(); progress('remote');
      const before = await remote();
      // Finish the whole deletion/conflict preflight before any cloud POST.
      for (const id of pendingIds) {
        const originalEvent = original.events[id], existing = before.events[id];
        if (existing) {
          if (!same(originalEvent, existing) && !core.wordImageEventEquivalent(originalEvent, existing)) throw fail('TRANSFER_HISTORY_CONFLICT');
          canonicalEvents.set(id, clone(existing));
        } else if (originalEvent.deleted || originalEvent.value?.deleted) throw fail('TRANSFER_PENDING_DELETION');
      }
      const predictedEvents = { ...before.events };
      for (const id of pendingIds) predictedEvents[id] = canonicalEvents.get(id) || original.events[id];
      let predicted;
      try { predicted = core.materialize(predictedEvents); } catch (_) { throw fail('TRANSFER_SOURCE_INVALID'); }
      for (const card of cards) {
        const candidate = predicted.data['card:' + card.id];
        if (!candidate || !same(semantic(card), semantic(candidate))) throw fail('TRANSFER_REMOTE_INCOMPLETE');
      }
      for (const id of pendingIds) {
        const existing = canonicalEvents.get(id);
        if (existing) { await verifyEventImages(existing); continue; }
        const event = await convertEvent(original.events[id]); canonicalEvents.set(id, event); newEvents.push(event);
      }
      progress('prepare');
      const drafts = [];
      for (let index = 0; index < newEvents.length; index += 250) {
        const events = newEvents.slice(index, index + 250), document = { schema: core.schema, namespace: NAMESPACE, saved_at: new Date().toISOString(), device_id: 'word-sync-preservation', events };
        const text = JSON.stringify(document), hash = await core.digest(text);
        await checkpoint('draft', { schema: 'word-sync-transfer-draft-v1', sourceCheckpoint, backupId, account: expectedAccount, text, hash });
        drafts.push({ document, text, hash });
      }
      for (let index = 0; index < drafts.length; index++) {
        const draft = drafts[index]; progress('upload', index, drafts.length);
        const created = await createFile(NAMESPACE + '-journal-transfer-' + draft.hash + '.json', new Blob([draft.text], { type: 'application/json' }), { kind: 'journal' });
        const received = await request(API + 'files/' + encodeURIComponent(created.id) + '?alt=media');
        if (await core.digest(received.bytes) !== draft.hash || !same(json(received), draft.document)) throw fail('TRANSFER_READBACK_MISMATCH');
        uploadedEvents += draft.document.events.length;
      }
      progress('verify');
      const after = await remote();
      for (const [id, event] of canonicalEvents) if (!after.events[id] || !same(event, after.events[id])) throw fail('TRANSFER_READBACK_MISMATCH');
      function semantic(card) {
        return { id: card.id, word: card.word, meaning: card.meaning, sort_order: Number(card.sort_order) || 0, updated_at: card.updated_at || null,
          images: normalizedImages(card).map(image => ({ hash: image.parsed.hash, type: image.type, name: image.name })) };
      }
      for (const card of cards) {
        const remoteCard = after.view.data['card:' + card.id];
        if (!remoteCard || !same(semantic(card), semantic(remoteCard))) throw fail('TRANSFER_REMOTE_INCOMPLETE');
        for (const image of normalizedImages(remoteCard)) await verifyRemoteImage(image);
      }
      assertRaw(raw);
      progress('ack');
      const db = await openDB(SOURCE_DB);
      if (!db) throw fail('TRANSFER_SOURCE_CHANGED');
      let pendingAfter;
      try {
        pendingAfter = await transaction(db, ['states'], 'readwrite', (tx, done, setError) => {
          const store = tx.objectStore('states'), request = store.get(STATE_KEY);
          request.onsuccess = () => {
            try {
              assertRaw(raw);
              const latest = request.result;
              if (!latest || latest.account !== expectedAccount || !Array.isArray(latest.pending) || !latest.events) throw fail('TRANSFER_SOURCE_CHANGED');
              const acknowledged = new Set();
              for (const [id, event] of canonicalEvents) {
                if (!latest.pending.includes(id)) continue;
                if (!same(latest.events[id], original.events[id]) && !same(latest.events[id], event)) throw fail('TRANSFER_SOURCE_CHANGED');
                latest.events[id] = clone(event); acknowledged.add(id);
              }
              latest.pending = latest.pending.filter(id => !acknowledged.has(id));
              done(latest.pending.length);
              if (acknowledged.size) {
                const written = store.put(latest, STATE_KEY); written.onerror = () => setError(fail('TRANSFER_STORAGE'));
              }
            } catch (error) { setError(safeError(error)); tx.abort(); }
          };
        });
      } finally { db.close(); }
      assertRaw(raw);
      const result = { verified: true, localCount: cards.length, remoteCount: Object.keys(after.view.data).filter(key => key.startsWith('card:')).length,
        pendingBefore, pendingAfter, uploadedEvents, verifiedEvents: canonicalEvents.size, verifiedImages: cards.reduce((count, card) => count + normalizedImages(card).length, 0),
        accountFingerprint: (await core.digest(expectedAccount)).slice(0, 12) };
      progress('done'); return result;
    }
    function run(input) {
      if (running) return Promise.reject(fail('TRANSFER_BUSY'));
      running = Promise.resolve().then(() => {
        if (!locks?.request) return execute(input);
        if (!core?.wordSyncLock) throw fail('TRANSFER_DEPENDENCY');
        return locks.request(core.wordSyncLock, { mode: 'exclusive', ifAvailable: true }, lock => {
          if (!lock) throw fail('TRANSFER_BUSY');
          return execute(input);
        });
      }).catch(error => { throw safeError(error); }).finally(() => { running = null; });
      return running;
    }
    return Object.freeze({ run });
  }
  return Object.freeze({ create, CHECKPOINT_DB });
});
