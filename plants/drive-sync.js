/* Plant text and three independent immutable image registers.
 * All image sources, including existing external URLs, are copied privately. */
(async function () {
  'use strict';
  if (window.PlantDriveSync) return;
  if (!window.PlantDriveImageCopy) await new Promise((resolve, reject) => {
    const s = document.createElement('script'); s.src = './drive-image-copy.js?v=1';
    s.onload = resolve; s.onerror = () => reject(Error('画像コピー機能を読み込めません。ページを再読み込みしてください。'));
    document.head.appendChild(s);
  });
  const F = window.FlashcardsDrive, P = window.PlantDriveImageCopy;
  const bodyKey = c => 'card:' + c.id;
  const imageKey = (c, i) => 'image:' + c.id + ':' + i;
  const clean = c => ({ id: c.id, group: c.group, name: c.name, description: c.description, sort_order: Number(c.sort_order) || 0, updated_at: c.updated_at || null });
  const originalSave = saveCards;
  let sync;
  const republishedCards = new Set();
  // Only user-registered photo keys are automatically republished. A received
  // remote tombstone must never become a new local registration.
  const automaticPhotoRegistrations = new Map();
  let savedPhotoValues = new Map(), automaticPhotoTimer = null;
  let automaticPhotoRunning = false, automaticPhotoNextAttempt = 0;
  let automaticPhotoDelay = 30000;
  const controls = document.querySelector('.toolbar') || document.body;
  const copyStatus = document.createElement('p'); copyStatus.id = 'plantDriveImageCopyStatus'; copyStatus.setAttribute('role','status');
  copyStatus.style.cssText = 'width:100%;margin:6px 0;font-size:12px;line-height:1.6;white-space:pre-wrap';
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn'; retry.textContent = '全画像をDriveへコピー／再試行';
  const reportButton = document.createElement('button'); reportButton.type = 'button'; reportButton.className = 'btn'; reportButton.textContent = '画像コピー結果を保存';
  const retryFeedback = document.createElement('div');
  retryFeedback.id = 'plantDriveRetryFeedback';
  retryFeedback.setAttribute('aria-live', 'polite');
  retryFeedback.style.cssText = 'width:100%;white-space:pre-wrap;line-height:1.6;font-size:13px;color:#245a41';
  controls.append(retry, reportButton, copyStatus, retryFeedback);
  let recoveryBusy = false;
  const copier = P.create({
    getCards: () => cards, getImages, resolveImage: v => resolveImageValue(v), isEditing: () => editing,
    replaceIfCurrent: (id, index, source, ref) => {
      if (editing) return false;
      const at = cards.findIndex(c => c.id === id); if (at < 0) return false;
      const imgs = getImages(cards[at]); if (imgs[index] !== source) return false;
      const previous = cards[at]; imgs[index] = ref; cards[at] = withImages(previous, imgs);
      try { originalSave(); } catch (e) { cards[at] = previous; throw e; }
      savedPhotoValues.set(imageKey(cards[at], index), ref);
      return true;
    },
    changed: () => sync.changed(),
    onProgress: s => {
      copyStatus.textContent = '登録画像 ' + s.total + '枠 ／ Drive参照 ' + s.drive + '枠 ／ 未コピー ' + s.pending + '枠 ／ 失敗 ' + s.failed + '枠' + (s.phase ? '\n' + s.phase : '');
      retry.disabled = s.busy;
    }
  });
  function values(list) {
    const result = {};
    for (const c of list) { result[bodyKey(c)] = clean(c); getImages(c).forEach((v, i) => { if (v) result[imageKey(c, i)] = v; }); }
    return result;
  }
  const ready = (async () => { await plantBootReady; for (const c of cards) if (!c.id) c.id = 'legacy-' + await F.digest(c.group + '\u0000' + c.name); })();
  async function toCloudValue(k, v) {
    if (!k.startsWith('image:') || typeof v !== 'string') return v;
    const ref = await copier.convert(k, v);
    // An unresolved device-only ref must not replace a working cloud image.
    if (ref === v && /^(idb:|data:image\/|blob:)/.test(v)) throw Error('端末の画像をDriveへ保存できません。元のPCの画像を保持しています。「画像コピー結果を保存」で確認してください。');
    return ref;
  }
  const cfg = {
    namespace: 'plant-flashcards', toolbar: '.toolbar', primary: plantDrivePrimary, ready,
    storageKeys: [STORAGE_KEY], reload: () => { if (!editing) { cards = loadCards(); updateCounts(); if (currentGroup) { rebuildOrder(); render(); } } },
    read: () => values(cards), isEditing: () => editing || copier.busy,
    enablePrimary: async () => { localStorage.setItem('plant_drive_primary_v1', '1'); await Promise.allSettled([...legacyImageRequests]); updateImageSyncStatus(); },
    timestamps: () => { let m = {}; try { m = JSON.parse(localStorage.getItem('plant_gdrive_meta_v2') || '{}'); } catch {} return Object.fromEntries(Object.entries(m.updated || {}).map(([k, v]) => ['card:' + k, v])); },
    tombstones: () => { let m = {}; try { m = JSON.parse(localStorage.getItem('plant_gdrive_meta_v2') || '{}'); } catch {} return Object.fromEntries(Object.entries(m.deleted || {}).map(([k, v]) => ['card:' + k, v])); },
    toCloudValue,
    legacy: [{ file: 'plant-flashcards-sync-v2.json', convert: async raw => {
      if (raw.schema !== 'plant-flashcards-drive-sync-v2' || !Array.isArray(raw.cards)) throw new Error('旧植物同期ファイルの形式を確認できません。');
      const data = values(raw.cards), times = {};
      for (const c of raw.cards) { times[bodyKey(c)] = raw.updated?.[c.id] || ''; getImages(c).forEach((v, i) => { if (v) times[imageKey(c, i)] = raw.updated?.[c.id] || ''; }); }
      return { data, timestamps: times, deleted: Object.fromEntries(Object.entries(raw.deleted || {}).map(([k, v]) => ['card:' + k, v])) };
    } }],
    migrate: async (api, view) => {
      const session = await ensureCloudSession(); if (!session?.user?.id) return null;
      const marker = 'migration:supabase-images:' + session.user.id; if (view.data[marker]) return null;
      const headers = { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' };
      async function listing(prefix) {
        const rows = []; for (let offset = 0; ; offset += 1000) {
          const r = await fetch(SUPABASE_URL + '/storage/v1/object/list/' + CLOUD_BUCKET, { method: 'POST', headers, body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }) });
          if (!r.ok) throw new Error('旧Supabase画像の一覧を取得できません。旧画像は保持しています。');
          const page = await r.json(); if (!Array.isArray(page)) throw new Error('旧画像一覧の形式を確認できません。'); rows.push(...page); if (page.length < 1000) return rows;
        }
      }
      const data = {}, times = {}, folders = await listing(session.user.id);
      const byId = new Map(cards.map(c => [String(c.id), c]));
      for (const folder of folders) {
        const c = byId.get(folder.name); if (!c || view.deleted[bodyKey(c)]) continue;
        for (const file of await listing(session.user.id + '/' + folder.name)) {
          const match = /^(0|1|2)\.jpg$/.exec(file.name); if (!match) continue;
          const i = Number(match[1]), k = imageKey(c, i);
          if (view.data[k] || view.deleted[k]) continue;
          const url = SUPABASE_URL + '/storage/v1/object/authenticated/' + CLOUD_BUCKET + '/' + encodedStoragePath(session.user.id + '/' + folder.name + '/' + file.name);
          const r = await fetch(url, { headers }); if (!r.ok) throw new Error('旧画像の取得に失敗しました。再接続すると移行を再開できます。');
          data[k] = await api.putBlob(await r.blob()); times[k] = file.updated_at || file.created_at || '';
        }
      }
      data[marker] = { completed_at: new Date().toISOString(), images: Object.keys(data).length, source: 'read-only' }; return { data, timestamps: times };
    },
    prepareApply: async view => {
      const list = Object.entries(view.data).filter(([k]) => k.startsWith('card:')).map(([, c]) => ({ ...c }));
      return list.sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)).map(c => withImages(c, [0, 1, 2].map(i => view.data[imageKey(c, i)] || '')));
    },
    apply: list => {
      const id = cards[currentIndex()]?.id, back = !!stage.querySelector('.show-back'), shuffled = isShuffled, oldOrder = order.map(i => cards[i]?.id);
      cards = list; saveCards(); updateCounts();
      if (currentGroup) {
        if (shuffled) { order = oldOrder.map(k => cards.findIndex(c => c.id === k && c.group === currentGroup)).filter(i => i >= 0); for (let i = 0; i < cards.length; i++) if (cards[i].group === currentGroup && !order.includes(i)) order.push(i); isShuffled = true; }
        else rebuildOrder(id);
        const at = order.findIndex(i => cards[i]?.id === id); if (at >= 0) pos = at; render(back);
      }
    },
    // Older journals may already contain URLs with no pending edit. Upgrade those
    // after reconciliation, then capture ordinary child events for the next push.
    afterSync: async () => {
      await copier.sweep();
      // Revisit only durable unsent image registrations on reconnect.
      enqueueDurablePhotoRegistrations();
      scheduleAutomaticPhotoRegistration(900);
      setTimeout(() => publishVisibleCardImages().catch(() => {}), 0);
      if (currentGroup && !editing) { const back = !!stage.querySelector('.show-back'); render(back); }
    },
    onStatus: (s, message) => {
      const progress = copier.summary();
      if (plantDrivePrimary()) { imageSyncStatus.textContent = '画像Drive同期：' + s + (progress.pending ? '（画像コピー未完了 ' + progress.pending + '枠）' : ''); imageSyncStatus.title = message || s; }
      if (sync && ['同期済み','接続済み','画像送信待ち'].includes(s)) {
        enqueueDurablePhotoRegistrations();
        scheduleAutomaticPhotoRegistration(900);
      }
    }
  };
  sync = F.install(cfg); window.PlantDriveSync = sync; copier.attach(sync);
  window.PlantDriveImageCopyStatus = Object.freeze({summary:copier.summary, report:copier.report});
  const originalRenderForImageShare = render;
  async function publishVisibleCardImages(){
    if (!sync?.valid() || editing || !currentGroup) return;
    const current = cards[currentIndex()];
    if (!current || republishedCards.has(current.id)) return;
    const keys = getImages(current).map((value, i) => value ? imageKey(current, i) : '').filter(Boolean);
    if (!keys.length) return;
    republishedCards.add(current.id);
    try {
      copier.retry();
      await copier.sweep();
      await sync.republish?.(keys);
      await sync.sync();
      if (sync.status().pending && sync.valid()) await sync.sync();
      const stillPending = new Set(sync.pendingKeys?.() || []);
      if (keys.some(key => stillPending.has(key))) {
        republishedCards.delete(current.id);
        setTimeout(() => publishVisibleCardImages().catch(() => {}), 60000);
      }
    } catch (e) {
      republishedCards.delete(current.id);
      throw e;
    }
  }
  render = function(){
    const out = originalRenderForImageShare.apply(this, arguments);
    queueMicrotask(() => publishVisibleCardImages().catch(() => {}));
    return out;
  };
  queueMicrotask(() => publishVisibleCardImages().catch(() => {}));
  function currentPhotoValues() {
    const out = new Map();
    for (const c of cards) getImages(c).forEach((value, index) => {
      if (value) out.set(imageKey(c, index), value);
    });
    return out;
  }
  function enqueueDurablePhotoRegistrations() {
    if (!sync?.pendingKeys) return;
    const local = currentPhotoValues();
    for (const key of sync.pendingKeys()) {
      if (key.startsWith('image:') && local.has(key) && !automaticPhotoRegistrations.has(key))
        automaticPhotoRegistrations.set(key, local.get(key));
    }
  }
  function scheduleAutomaticPhotoRegistration(delay = 650) {
    if (!automaticPhotoRegistrations.size) return;
    clearTimeout(automaticPhotoTimer);
    automaticPhotoTimer = setTimeout(async () => {
      automaticPhotoTimer = null;
      if (automaticPhotoRunning || recoveryBusy || copier.busy || editing ||
          navigator.onLine === false || document.visibilityState === 'hidden') {
        scheduleAutomaticPhotoRegistration(15000); return;
      }
      if (!sync?.valid() && window.PersistentDriveAuth?.state?.().phase !== 'connected') {
        scheduleAutomaticPhotoRegistration(30000); return;
      }
      automaticPhotoRunning = true;
      const batch = new Map(automaticPhotoRegistrations);
      try {
        const completed = await retryPlantPhotos('自動', batch);
        const local = currentPhotoValues(), remaining = new Set(sync.pendingKeys?.() || []);
        if (completed) for (const [key, expected] of batch) {
          const value = local.get(key);
          // An old job must not acknowledge a replacement that was registered
          // while it was running; leave that newer registration in the queue.
          if (!value) automaticPhotoRegistrations.delete(key);
          else if (automaticPhotoRegistrations.get(key) === expected &&
                   P.isDrive(value) && !remaining.has(key))
            automaticPhotoRegistrations.delete(key);
        }
        automaticPhotoDelay = automaticPhotoRegistrations.size ?
          Math.min(300000, Math.max(30000, automaticPhotoDelay * 2)) : 30000;
      } finally {
        automaticPhotoRunning = false;
        automaticPhotoNextAttempt = Date.now() + automaticPhotoDelay;
        if (automaticPhotoRegistrations.size)
          scheduleAutomaticPhotoRegistration(automaticPhotoDelay);
      }
    }, Math.max(delay, automaticPhotoNextAttempt - Date.now(), 0));
  }
  savedPhotoValues = currentPhotoValues();
  saveCards = function () {
    const r = originalSave();
    const current = currentPhotoValues();
    if (!sync.applying) {
      for (const [key, value] of current)
        if (savedPhotoValues.get(key) !== value)
          automaticPhotoRegistrations.set(key, value);
      for (const key of savedPhotoValues.keys())
        if (!current.has(key)) automaticPhotoRegistrations.delete(key);
    }
    savedPhotoValues = current;
    sync.changed(); // Captured in the durable local queue even when offline.
    if (automaticPhotoRegistrations.size && !sync.applying)
      scheduleAutomaticPhotoRegistration(650);
    else if (sync.valid())
      queueMicrotask(() => sync.sync().catch(() => {}));
    return r;
  };
  ready.then(() => {
    // A previous session's unsent image events survive a browser restart.
    enqueueDurablePhotoRegistrations();
    scheduleAutomaticPhotoRegistration(1200);
  }).catch(() => {});
  window.addEventListener('online', () => scheduleAutomaticPhotoRegistration(200));
  window.addEventListener('focus', () => scheduleAutomaticPhotoRegistration(500));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') scheduleAutomaticPhotoRegistration(500);
  });
  const oldResolve = resolveImageValue;
  resolveImageValue = async function (v) {
    if (!String(v || '').startsWith('gdrive:')) return oldResolve(v);
    const local = await getStoredImage('drive:' + v); if (local) return local;
    const data = await blobToDataUrl(await sync.getBlob(v)); await putStoredImage('drive:' + v, data); return data;
  };
  async function retryPlantPhotos(origin = '手動', requestedKeys = new Map()) {
    if (recoveryBusy || copier.busy) {
      retryFeedback.textContent = '画像のコピー処理が進行中です。画面上部の進捗表示を確認してください。';
      return false;
    }
    if (editing) {
      retryFeedback.textContent = 'カードの編集を保存してから画像送信を再試行してください。';
      return false;
    }
    recoveryBusy = true;
    retry.disabled = true;
    try {
      retryFeedback.textContent = origin + '：Google Driveの接続を確認しています…';
      if (!sync.valid() && window.PersistentDriveAuth?.state?.().phase === 'connected') {
        await window.PersistentDriveAuth.getToken();
        await Promise.resolve();
      }
      if (!sync.valid()) {
        retryFeedback.textContent = 'PCの植物カードはまだDrive未接続です。写真を保持したまま「Google Drive再接続」を開いてください。';
        return false;
      }
      const response = await sync.request('https://www.googleapis.com/drive/v3/about?fields=user(permissionId)');
      const account = (await response.json()).user?.permissionId;
      if (!account) throw Error('Googleアカウントを確認できません。');
      if (sync.account && sync.account !== account) throw Error('写真が保存されているPCとは異なるGoogleアカウントです。元のアカウントで接続してください。');
      if (!sync.account) {
        // The normal sync establishes and verifies the Drive account before any image upload.
        await sync.sync();
        if (!sync.account) throw Error('このPCのDrive同期先をまだ確認できません。');
      }
      const before = new Map();
      for (const c of cards) getImages(c).forEach((v,i) => {
        if (v && !P.isDrive(v)) before.set(imageKey(c,i),v);
      });
      copier.retry();
      retryFeedback.textContent = origin + '：未コピー画像 ' + before.size + '枠をDriveへ送信・検証しています。';
      await copier.sweep();
      // A new image registration must descend from the actual remote heads,
      // including tombstones; never apply remote deletion to the PC's local photo.
      const copiedKeys = [];
      for (const c of cards) getImages(c).forEach((v,i) => {
        const key=imageKey(c,i);
        if (before.has(key) && P.isDrive(v)) copiedKeys.push(key);
      });
      // A save may have already converted its source in the normal journal
      // push. Publish its current registered value against the latest remote
      // heads even when this sweep copied no additional bytes.
      const currentRefs = currentPhotoValues();
      const registeredKeys = [...requestedKeys].filter(([key, expected]) => {
        const value = currentRefs.get(key) || '';
        return (value === expected || (before.get(key) === expected && P.isDrive(value))) &&
          (P.isDrive(value) || /^https?:\\/\\//i.test(value));
      }).map(([key]) => key);
      const republishKeys = [...new Set([...copiedKeys, ...registeredKeys])];
      if (republishKeys.length && sync.republish) await sync.republish(republishKeys);
      retryFeedback.textContent = origin + '：写真 ' + republishKeys.length + '枠の登録情報を同期しています。';
      await sync.sync();
      if (sync.status().pending && sync.valid()) await sync.sync();
      const result = copier.summary(), state = sync.status();
      const queuedImages = (sync.pendingKeys?.() || []).filter(k => k.startsWith('image:')).length;
      retryFeedback.textContent = 'コピー再試行結果：Drive参照 ' + result.drive + '枠／未コピー ' + result.pending +
        '枠／失敗 ' + result.failed + '枠／登録情報の送信保留 ' + queuedImages +
        '件。' + ((result.pending || result.failed || queuedImages) ?
        ' 未完了の画像は元のPCに保持しています。「画像コピー結果を保存」から詳細を保存できます。' :
        ' 画像参照の送信が完了しました。スマホで変更分を同期してください。') +
        (state.detail ? '\n同期状況：' + state.detail : '');
      return true;
    } catch (e) {
      retryFeedback.textContent = '画像送信はまだ完了していません：' + (e.message || String(e)) +
        '\nPCの元写真・保留データは削除していません。「画像コピー結果を保存」で詳細を確認してください。';
      return false;
    } finally {
      recoveryBusy = false;
      retry.disabled = copier.busy;
    }
  }
  retry.onclick = () => retryPlantPhotos('手動');
  reportButton.onclick = () => {
    const body = { ...copier.report(), sync:sync.status() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(body,null,2)], {type:'application/json'}));
    const a = document.createElement('a'); a.href = url; a.download = 'plant-drive-image-copy-report.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),3000);
  };
  imageSyncStatus.onclick = () => sync.open();
})().catch(e => {
  const p = document.createElement('p'); p.setAttribute('role','alert'); p.textContent = '植物のDrive同期を開始できません：' + (e.message || String(e)) + '。保存データは削除していません。';
  (document.querySelector('.toolbar') || document.body).appendChild(p);
});
