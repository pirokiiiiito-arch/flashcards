/* Plant text and three independent immutable image registers. */
(function () {
  'use strict';
  const F = window.FlashcardsDrive;
  const bodyKey = c => 'card:' + c.id;
  const imageKey = (c, i) => 'image:' + c.id + ':' + i;
  const clean = c => ({ id: c.id, group: c.group, name: c.name, description: c.description, sort_order: Number(c.sort_order) || 0, updated_at: c.updated_at || null });
  function values(list) {
    const result = {};
    for (const c of list) { result[bodyKey(c)] = clean(c); getImages(c).forEach((v, i) => { if (v) result[imageKey(c, i)] = v; }); }
    return result;
  }
  const ready = (async () => { await plantBootReady; for (const c of cards) if (!c.id) c.id = 'legacy-' + await F.digest(c.group + '\u0000' + c.name); })();
  async function toCloudValue(k, v, api) {
    if (!k.startsWith('image:') || typeof v !== 'string' || !/^(idb:|data:image\/)/.test(v)) return v;
    const data = await resolveImageValue(v);
    if (!data) throw new Error('この端末に画像が見つかりません。元のPCでDriveへ接続してください。画像参照は保持しました。');
    return api.putBlob(await dataUrlToBlob(data));
  }
  const cfg = {
    namespace: 'plant-flashcards', toolbar: '.toolbar', primary: plantDrivePrimary, ready,
    storageKeys: [STORAGE_KEY], reload: () => { if (!editing) { cards = loadCards(); updateCounts(); if (currentGroup) { rebuildOrder(); render(); } } },
    read: () => values(cards), isEditing: () => editing,
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
    onStatus: (s, message) => { if (plantDrivePrimary()) { imageSyncStatus.textContent = '画像Drive同期：' + s; imageSyncStatus.title = message || s; } }
  };
  const sync = F.install(cfg); window.PlantDriveSync = sync;
  const oldSave = saveCards;
  saveCards = function () { const r = oldSave(); sync.changed(); return r; };
  const oldResolve = resolveImageValue;
  resolveImageValue = async function (v) {
    if (!String(v || '').startsWith('gdrive:')) return oldResolve(v);
    const local = await getStoredImage('drive:' + v); if (local) return local;
    const data = await blobToDataUrl(await sync.getBlob(v)); await putStoredImage('drive:' + v, data); return data;
  };
  imageSyncStatus.onclick = () => sync.open();
})();
