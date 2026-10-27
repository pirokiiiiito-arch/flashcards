/* Private Drive appData sync. Immutable journals avoid cross-device overwrite races. */
(function (root) {
  'use strict';
  const SCHEMA = 'flashcards-drive-journal-v3';
  const CLIENT_KEY = 'flashcards_gdrive_client_id_v1';
  const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  const API = 'https://www.googleapis.com/drive/v3/';
  const clone = x => structuredClone(x);
  const stable = x => x === undefined ? 'null' : JSON.stringify(x, function (k, v) {
    return v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(n => [n, v[n]])) : v;
  });
  const uuid = () => root.crypto.randomUUID ? root.crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2);
  async function digest(value) {
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
  }
  function heads(events) {
    const groups = new Map(), superseded = new Set();
    for (const e of Object.values(events)) {
      if (!e || typeof e.key !== 'string' || typeof e.id !== 'string' || !Array.isArray(e.parents)) throw new Error('同期履歴の形式が不正です。');
      for (const p of e.parents) superseded.add(p);
      if (!groups.has(e.key)) groups.set(e.key, []);
      groups.get(e.key).push(e);
    }
    const result = new Map();
    for (const [key, list] of groups) result.set(key, list.filter(e => !superseded.has(e.id)));
    return result;
  }
  function winner(list) {
    return [...list].sort((a, b) => Number(!!(a.deleted || a.value?.deleted)) - Number(!!(b.deleted || b.value?.deleted)) || (Number(a.clock) - Number(b.clock)) || a.id.localeCompare(b.id)).pop();
  }
  function materialize(events) {
    const data = {}, deleted = {}, conflicts = [];
    for (const [key, list] of heads(events)) {
      const e = winner(list); if (!e) continue;
      if (e.deleted) deleted[key] = e; else data[key] = clone(e.value);
      if (list.length > 1 && new Set(list.map(x => stable([x.deleted, x.value]))).size > 1)
        conflicts.push({ key, chosen: e.id, versions: clone(list) });
    }
    return { data, deleted, conflicts };
  }
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('flashcards_drive_cache_v3', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('states'); req.result.createObjectStore('blobs'); };
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error);
    });
  }
  async function dbAction(store, mode, fn) {
    const db = await openDB();
    try { return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode), req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req?.result); tx.onerror = tx.onabort = () => reject(tx.error || new Error('端末キャッシュを保存できません。'));
    }); } finally { db.close(); }
  }
  const cache = { get: (store, key) => dbAction(store, 'readonly', s => s.get(key)), put: (store, key, val) => dbAction(store, 'readwrite', s => s.put(val, key)) };
  function install(cfg) {
    let token = '', expires = 0, tokenClient, gisPromise, running, timer, expiryTimer, applying = false, generation = 0, lastFocus = 0, state;
    let captureQueue = Promise.resolve(), blobQueue = Promise.resolve();
    let status = '未接続', detail = '', stateWrite = Promise.resolve();
    const stateKey = cfg.namespace;
    const deviceKey = 'flashcards_drive_device_v3';
    let device = localStorage.getItem(deviceKey);
    if (!device) { device = uuid(); localStorage.setItem(deviceKey, device); }
    let localSnapshot = {};
    const ready = (async () => {
      await cfg.ready;
      state = await cache.get('states', stateKey) || { events: {}, pending: [], seen: {}, imports: {}, account: '', clock: 0, initialized: false };
      localSnapshot = await cfg.read();
      // Saved local changes made while offline must be compared to the last applied state.
      if (state.initialized) localSnapshot = state.snapshot || localSnapshot;
      await capture();
    })();
    function persist() {
      const copy = clone(state);
      stateWrite = stateWrite.catch(() => {}).then(() => cache.put('states', stateKey, copy));
      return stateWrite;
    }
    function setStatus(text, message = '') {
      status = text; detail = message; button.textContent = 'Google Drive同期：' + text;
      messageEl.textContent = message || text; messageEl.dataset.state = text;
      cfg.onStatus?.(text, message);
    }
    function error(e) { setStatus(e.auth ? '未接続' : '同期エラー', e.message || String(e)); }
    function valid() { return !!token && Date.now() < expires - 30000; }
    function expire() { token = ''; expires = 0; setStatus('未接続', '認証期限が切れました。「接続して同期」で再接続してください。端末の変更は保持しています。'); }
    async function request(url, options = {}) {
      if (!valid()) { expire(); const e = new Error(detail); e.auth = true; throw e; }
      const headers = new Headers(options.headers); headers.set('Authorization', 'Bearer ' + token);
      const response = await fetch(url, { ...options, headers, cache: 'no-store' });
      if (response.status === 401) { expire(); const e = new Error(detail); e.auth = true; throw e; }
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        const e = new Error(body.error?.message || 'Drive APIエラー ' + response.status); e.status = response.status; throw e;
      }
      return response;
    }
    async function list(query) {
      const files = []; let next = '';
      do {
        const p = new URLSearchParams({ spaces: 'appDataFolder', q: query + ' and trashed=false', pageSize: '1000', fields: 'nextPageToken,files(id,name,md5Checksum,sha256Checksum,size,mimeType,appProperties)' });
        if (next) p.set('pageToken', next);
        const page = await (await request(API + 'files?' + p)).json(); files.push(...(page.files || [])); next = page.nextPageToken || '';
      } while (next);
      return files;
    }
    async function create(name, data, properties) {
      const boundary = 'cards_' + uuid().replaceAll('-', '');
      const metadata = { name, parents: ['appDataFolder'], mimeType: data.type || 'application/json', appProperties: { namespace: cfg.namespace, ...properties } };
      const body = new Blob(['--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n', JSON.stringify(metadata), '\r\n--' + boundary + '\r\nContent-Type: ' + metadata.mimeType + '\r\n\r\n', data, '\r\n--' + boundary + '--\r\n']);
      return (await request('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,md5Checksum', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body })).json();
    }
    const queryKind = kind => "appProperties has { key='namespace' and value='" + cfg.namespace + "' } and appProperties has { key='kind' and value='" + kind + "' }";
    async function putBlobImpl(blob, options = {}) {
      if (!(blob instanceof Blob) || !/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) throw new Error('画像形式を確認できません。');
      const hash = await digest(await blob.arrayBuffer());
      const key = state.account + ':' + hash;
      const known = options.fresh ? null : await cache.get('blobs', 'ref:' + key);
      if (known) return known;
      const matches = await list(queryKind('image') + " and appProperties has { key='sha256' and value='" + hash + "' }");
      const file = matches[0] || await create('image-' + hash, blob, { kind: 'image', sha256: hash });
      const ref = 'gdrive:' + file.id + ':' + hash;
      await cache.put('blobs', 'ref:' + key, ref); await cache.put('blobs', ref, blob);
      return ref;
    }
    function putBlob(blob, options = {}) {
      // Serialize content-address lookups in this tab; no duplicate upload on repeated captures.
      const result = blobQueue.catch(() => {}).then(() => putBlobImpl(blob, options)); blobQueue = result; return result;
    }
    async function getBlob(ref, options = {}) {
      const parts = String(ref).match(/^gdrive:([\w-]+):([a-f0-9]{64})$/);
      if (!parts) throw new Error('Drive画像参照が不正です。');
      const existing = options.fresh ? null : await cache.get('blobs', ref); if (existing) return existing;
      const response = await request(API + 'files/' + encodeURIComponent(parts[1]) + '?alt=media');
      const blob = await response.blob();
      if (await digest(await blob.arrayBuffer()) !== parts[2]) throw new Error('Drive画像の検証に失敗しました。');
      await cache.put('blobs', ref, blob); return blob;
    }
    function newEvent(key, value, deleted, parents, id, updated_at) {
      const clock = Math.max(Date.now(), Number(state.clock || 0) + 1); state.clock = clock;
      return { id: id || device + ':' + uuid(), key, value: clone(value ?? null), deleted: !!deleted, parents, clock, updated_at: updated_at || new Date(clock).toISOString(), device_id: device };
    }
    function append(e) {
      const old = state.events[e.id];
      if (old && stable(old) !== stable(e)) throw new Error('同期履歴IDが競合しています。');
      if (!old) { state.events[e.id] = e; state.pending.push(e.id); }
    }
    async function capture() {
      const current = await cfg.read();
      if (!state.initialized) { state.snapshot = clone(current); return; }
      const basis = state.basis || {};
      for (const key of new Set([...Object.keys(localSnapshot), ...Object.keys(current)])) {
        if (stable(current[key]) === stable(localSnapshot[key])) continue;
        const event = newEvent(key, current[key], !(key in current), basis[key] || []);
        append(event); basis[key] = [event.id];
      }
      state.basis = basis; localSnapshot = clone(current); state.snapshot = clone(current); await persist();
    }
    function changed() {
      if (applying) return;
      generation++;
      captureQueue = captureQueue.catch(() => {}).then(() => ready).then(capture).catch(error);
      clearTimeout(timer);
      if (valid()) timer = setTimeout(() => sync().catch(error), 1500);
      else if (cfg.primary()) setStatus('未接続', '変更を端末に保存しました。Driveへは再接続後に送信します。');
    }
    async function importValues(values, source, timestamps = {}, tombstones = {}) {
      const existing = heads(state.events);
      for (const key of new Set([...Object.keys(values), ...Object.keys(tombstones)])) {
        // Legacy variants remain concurrent history. Tombstones win concurrency;
        // unseen local edits must still be retained for conflict recovery.
        let value = values[key], deleted = key in tombstones;
        if (!deleted) value = await cfg.toCloudValue(key, value, api);
        const time = timestamps[key] || tombstones[key] || '';
        const id = 'legacy:' + await digest(stable([key, value ?? null, deleted, time]));
        if (state.events[id]) continue;
        const e = newEvent(key, value, deleted, [], id, time || '1970-01-01T00:00:00.000Z');
        e.clock = Date.parse(time) || 0; e.device_id = 'legacy'; append(e);
      }
    }
    async function pull() {
      const files = await list(queryKind('journal'));
      for (const file of files) {
        if (state.seen[file.id] === file.md5Checksum && file.md5Checksum) continue;
        const journal = await (await request(API + 'files/' + encodeURIComponent(file.id) + '?alt=media')).json();
        if (journal.schema !== SCHEMA || journal.namespace !== cfg.namespace || !Array.isArray(journal.events)) throw new Error('Driveの同期形式が一致しません。');
        for (const e of journal.events) {
          if (state.events[e.id] && stable(state.events[e.id]) !== stable(e)) throw new Error('Drive同期履歴が競合しています。');
          state.events[e.id] = e; state.clock = Math.max(state.clock || 0, Number(e.clock) || 0);
        }
        state.seen[file.id] = file.md5Checksum || ''; await persist();
      }
    }
    async function push() {
      // Immutable uploads, including tombstones and all conflicting revisions. No PATCH of shared state.
      while (state.pending.length) {
        const ids = state.pending.slice(0, 250), events = [];
        for (const id of ids) {
          const e = clone(state.events[id]);
          if (!e.deleted) e.value = await cfg.toCloudValue(e.key, e.value, api);
          state.events[id] = e; events.push(e);
        }
        const doc = { schema: SCHEMA, namespace: cfg.namespace, saved_at: new Date().toISOString(), device_id: device, data: materialize(Object.fromEntries(events.map(e => [e.id, e]))).data, deleted: events.filter(e => e.deleted), events };
        const result = await create(cfg.namespace + '-journal-' + uuid() + '.json', new Blob([JSON.stringify(doc)], { type: 'application/json' }), { kind: 'journal' });
        state.seen[result.id] = result.md5Checksum || ''; state.pending = state.pending.filter(id => !ids.includes(id)); await persist();
      }
    }
    async function doSync() {
      await ready; await captureQueue; await capture();
      if (!valid()) { const e = new Error('「接続して同期」でGoogleに接続してください。'); e.auth = true; throw e; }
      setStatus('同期中');
      const account = (await (await request(API + 'about?fields=user(permissionId)')).json()).user?.permissionId;
      if (!account) throw new Error('Googleアカウントを確認できません。');
      if (state.account && state.account !== account) throw new Error('この端末のキャッシュと別のGoogleアカウントです。元のアカウントで接続してください。');
      state.account = account;
      await pull();
      if (!state.initialized) {
        await cfg.beforeInitial?.(api);
        const initial = await cfg.read();
        // Keep a complete private backup before first reconciliation.
        await cache.put('states', cfg.namespace + ':before-drive:' + Date.now(), initial);
        await importValues(initial, 'local', cfg.timestamps?.() || {}, cfg.tombstones?.() || {});
        state.initialized = true;
        state.basis = Object.fromEntries([...heads(state.events)].map(([k, v]) => [k, v.map(e => e.id)]));
        localSnapshot = clone(initial); state.snapshot = clone(initial); await persist();
      }
      // Import all duplicate legacy files, with remote checksums as shared migration evidence.
      for (const legacy of cfg.legacy || []) {
        for (const f of await list("name='" + legacy.file + "'")) {
          if (state.imports[f.id] === f.md5Checksum && f.md5Checksum) continue;
          const raw = await (await request(API + 'files/' + encodeURIComponent(f.id) + '?alt=media')).json();
          const imported = await legacy.convert(raw);
          await importValues(imported.data, 'drive-v2:' + f.id, imported.timestamps, imported.deleted);
          state.imports[f.id] = f.md5Checksum || ''; await persist();
        }
      }
      const legacyData = await cfg.migrate?.(api, materialize(state.events));
      if (legacyData) await importValues(legacyData.data, 'supabase', legacyData.timestamps, legacyData.deleted);
      await captureQueue; await capture(); await push(); await pull();
      // A user may save while an image is downloading. Rebuild the apply plan if that occurs.
      for (let attempt = 0; attempt < 4; attempt++) {
        await captureQueue; await capture(); const version = generation, view = materialize(state.events);
        const prepared = await cfg.prepareApply(view, api);
        if (generation !== version || cfg.isEditing?.()) { if (cfg.isEditing?.()) break; continue; }
        applying = true; let write;
        try { write = cfg.apply(prepared); } finally { applying = false; }
        const appliedSnapshot = cfg.read();
        localSnapshot = await appliedSnapshot;
        state.snapshot = clone(localSnapshot);
        state.basis = Object.fromEntries([...heads(state.events)].map(([k, v]) => [k, v.map(e => e.id)]));
        await write; await persist();
        break;
      }
      await cfg.afterSync?.(materialize(state.events), api);
      if (state.pending.length) { timer = setTimeout(() => sync().catch(error), 1500); setStatus('接続済み', '新しい変更を同期待ちです。'); }
      else { const n = materialize(state.events).conflicts.length; setStatus('同期済み', n ? '同期しました。競合' + n + '件の両方の内容を履歴に保持しました。「競合・バックアップ保存」で確認できます。' : '同期しました。'); }
    }
    function sync() {
      if (running) return running;
      running = doSync().catch(e => { error(e); throw e; }).finally(() => { running = null; });
      return running;
    }
    const button = document.createElement('button'); button.className = 'btn'; button.type = 'button';
    (document.querySelector(cfg.toolbar) || document.body).appendChild(button);
    const dialog = document.createElement('dialog'); dialog.style.cssText = 'max-width:620px;width:92vw;box-sizing:border-box;border:1px solid #cbd1d9;border-radius:16px;padding:20px;max-height:90vh;overflow:auto';
    dialog.innerHTML = '<h2>Google Drive同期</h2><p>同じGoogleアカウントでPC・スマホの変更を共有します。変更履歴と削除履歴を保持します。</p><p>専用の非表示アプリデータ領域を使います。既存の「カード共通データ」フォルダは保持します。</p><label>OAuthクライアントID<input data-client style="display:block;width:100%;box-sizing:border-box;padding:10px" autocomplete="off"></label><div style="display:flex;gap:8px;flex-wrap:wrap;margin:12px 0"><button data-connect type="button">接続して同期</button><button data-now type="button">今すぐ同期</button><button data-off type="button">この端末を切断</button><button data-backup type="button">競合・バックアップ保存</button><button data-close type="button">閉じる</button></div><p data-status role="status"></p>';
    document.body.appendChild(dialog);
    const input = dialog.querySelector('[data-client]'), messageEl = dialog.querySelector('[data-status]'), connect = dialog.querySelector('[data-connect]');
    const configured = () => root.FLASHCARDS_DRIVE_CONFIG?.clientId || localStorage.getItem(CLIENT_KEY) || '';
    function loadGIS() {
      if (root.google?.accounts?.oauth2) return Promise.resolve();
      if (!gisPromise) gisPromise = new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client'; s.async = true; s.onload = resolve; s.onerror = () => { gisPromise = null; reject(new Error('Google認証を読み込めません。')); }; document.head.appendChild(s); });
      return gisPromise;
    }
    async function prepareAuth() {
      connect.disabled = true;
      try {
        await loadGIS();
        const id = input.value.trim();
        if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(id)) { setStatus('未接続', 'OAuthクライアントIDが未設定です。Google Cloudで発行後に設定します。'); return; }
        localStorage.setItem(CLIENT_KEY, id);
        tokenClient = root.google.accounts.oauth2.initTokenClient({ client_id: id, scope: SCOPE, include_granted_scopes: false, callback: async response => {
          if (response.error) return error(new Error(response.error_description || response.error));
          if (!response.access_token || !root.google.accounts.oauth2.hasGrantedAllScopes(response, SCOPE)) return error(new Error('Drive専用データ領域への許可を確認できません。'));
          token = response.access_token; expires = Date.now() + Number(response.expires_in || 3600) * 1000;
          clearTimeout(expiryTimer); expiryTimer = setTimeout(expire, Math.max(0, expires - Date.now() - 30000));
          try { await cfg.enablePrimary(); setStatus('接続済み'); await sync(); } catch (e) { error(e); }
        }, error_callback: e => error(new Error(e.type === 'popup_closed' ? 'Googleの認証画面が閉じられました。' : 'ポップアップを許可して再接続してください。')) });
        connect.disabled = false;
      } catch (e) { error(e); }
    }
    function open() { input.value = configured(); input.hidden = !!root.FLASHCARDS_DRIVE_CONFIG?.clientId; if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', ''); setStatus(status, detail); prepareAuth(); }
    button.onclick = open; input.onchange = prepareAuth;
    connect.onclick = () => {
      if (!(location.protocol === 'https:' || (location.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(location.hostname)))) return error(new Error('HTTPSのページから接続してください。'));
      if (!tokenClient) return;
      // Directly inside the click handler: Safari must not lose the user gesture.
      tokenClient.requestAccessToken({ prompt: '' });
    };
    dialog.querySelector('[data-now]').onclick = () => sync().catch(() => {});
    dialog.querySelector('[data-off]').onclick = () => { token = ''; expires = 0; clearTimeout(timer); clearTimeout(expiryTimer); setStatus('未接続', 'この端末を切断しました。Driveデータと端末の変更は保持し、Supabaseは停止したままです。'); };
    dialog.querySelector('[data-close]').onclick = () => dialog.close ? dialog.close() : dialog.removeAttribute('open');
    dialog.querySelector('[data-backup]').onclick = async () => {
      await ready; await captureQueue; const backup = { schema: SCHEMA, namespace: cfg.namespace, saved_at: new Date().toISOString(), device_id: device, ...clone(state), ...materialize(state.events), local: await cfg.read() };
      const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
      a.href = url; a.download = cfg.namespace + '-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    function onReturn() { if (document.visibilityState !== 'visible' || Date.now() - lastFocus < 15000) return; lastFocus = Date.now(); if (valid()) sync().catch(() => {}); else if (cfg.primary()) expire(); }
    window.addEventListener('focus', onReturn); document.addEventListener('visibilitychange', onReturn); window.addEventListener('online', onReturn);
    window.addEventListener('storage', e => { if (cfg.storageKeys?.includes(e.key)) { cfg.reload?.(); changed(); } });
    const api = { ready, changed, sync, open, putBlob, getBlob, digest, cache, valid, request, list, create, queryKind, setStatus, view: () => state ? clone(materialize(state.events)) : {data:{},deleted:{},conflicts:[]}, get account() { return state?.account; }, get applying() { return applying; }, status: () => ({ status, detail, pending: state?.pending?.length || 0, conflicts: state ? materialize(state.events).conflicts.length : 0 }) };
    setStatus('未接続', cfg.primary() ? 'Googleに再接続してください。Supabase同期は停止中です。' : '接続後にDriveへ移行します。');
    ready.catch(error); return Object.freeze(api);
  }
  root.FlashcardsDrive = Object.freeze({ install, stable, digest, heads, materialize, schema: SCHEMA, scope: SCOPE });
  if (typeof module !== 'undefined' && module.exports) module.exports = root.FlashcardsDrive;
})(typeof window !== 'undefined' ? window : globalThis);
