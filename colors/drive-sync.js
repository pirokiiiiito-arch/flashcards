/* review47 data stays intact. Static photographs are private, authenticated Drive blobs. */
(function () {
  'use strict';
  const F = window.FlashcardsDrive, E = window.ColorOriginEditor;
  let assetRefs = {}, manifest, imageUrls = new Map();
  const localAssetKey = 'colors1000_private_asset_refs_v3';
  const settingsKey = 'colors1000_user_settings_v3';
  const settings = ['origin', 'cat', 'query', 'mode', 'shuffled', 'order', 'index', 'page'];
  const ready = (async () => {
    await readyImages; await E.ready;
    assetRefs = await sync.cache.get('states', localAssetKey) || {};
    try { const saved = JSON.parse(localStorage.getItem(settingsKey) || '{}'); for (const k of settings) if (k in saved) state[k] = saved[k]; } catch {}
    render();
  })();
  function read() {
    const data = {};
    for (const [k, v] of Object.entries(manualEdits)) data['photo:' + k] = structuredClone(v);
    for (const [k, v] of Object.entries(E.getRecords())) data['origin:' + k] = v;
    for (const [k, v] of Object.entries(progress)) data['study:' + k] = v;
    for (const [k, v] of Object.entries(assetRefs)) data['asset:' + k] = v;
    for (const k of settings) data['setting:' + k] = structuredClone(state[k]);
    return data;
  }
  async function toCloudValue(k, v, api) {
    if (!k.startsWith('photo:') || !v || v.deleted || !String(v.data_url || '').startsWith('data:image/')) return v;
    const blob = await (await fetch(v.data_url)).blob();
    return { ...v, data_url: await api.putBlob(blob) };
  }
  const cfg = {
    namespace: 'colors1000-review47', toolbar: '.toolbar .controls', ready,
    primary: () => localStorage.getItem('colors1000_drive_primary_v3') === '1',
    enablePrimary: () => localStorage.setItem('colors1000_drive_primary_v3', '1'),
    read, toCloudValue, isEditing: () => !!document.getElementById('originEditorDialog')?.open,
    timestamps: () => {
      const out = {};
      for (const [k, v] of Object.entries(manualEdits)) out['photo:' + k] = v.updated_at || '';
      for (const [k, v] of Object.entries(E.getRecords())) out['origin:' + k] = v.updated_at || '';
      return out;
    },
    legacy: [{ file: 'colors1000-sync-v1.json', convert: async raw => {
      if (raw.schema !== 'colors1000-drive-sync-v1' || (raw.dataset_signature && raw.dataset_signature !== E.datasetSignature)) throw new Error('旧1000色同期ファイルの版が一致しません。');
      const data = {}, timestamps = {};
      for (const [k, v] of Object.entries(normalizeEdits(raw.manual_photo_edits || {}))) { data['photo:' + k] = v; timestamps['photo:' + k] = v.updated_at || raw.photos_updated_at || ''; }
      for (const [k, v] of Object.entries(E.validateRecords(raw.manual_origin_edits || {}))) { data['origin:' + k] = v; timestamps['origin:' + k] = v.updated_at || ''; }
      for (const [k, v] of Object.entries(validateStudyProgress(raw.study_progress || {}))) { data['study:' + k] = v; timestamps['study:' + k] = raw.study_progress_timestamps?.[k] || raw.study_updated_at || ''; }
      return { data, timestamps };
    } }],
    prepareApply: async (view, api) => {
      const photos = {}, origins = {}, study = {}, assets = {}, prefs = {};
      for (const [k, val] of Object.entries(view.data)) {
        const at = k.indexOf(':'), type = k.slice(0, at), id = k.slice(at + 1), v = structuredClone(val);
        if (type === 'photo') {
          if (String(v.data_url || '').startsWith('gdrive:')) v.data_url = await dataURL(await api.getBlob(v.data_url));
          photos[id] = v;
        } else if (type === 'origin') origins[id] = v;
        else if (type === 'study') study[id] = v;
        else if (type === 'asset') assets[id] = v;
        else if (type === 'setting' && settings.includes(id)) prefs[id] = v;
      }
      return { photos: normalizeEdits(photos), origins: E.validateRecords(origins), study: validateStudyProgress(study), assets, prefs };
    },
    apply: prepared => {
      const x = window.scrollX, y = window.scrollY, flipped = state.flipped;
      manualEdits = prepared.photos; progress = prepared.study; assetRefs = prepared.assets;
      for (const k of settings) if (k in prepared.prefs) state[k] = prepared.prefs[k];
      state.flipped = flipped;
      localStorage.setItem('colors1000_verified_progress', JSON.stringify(progress));
      localStorage.setItem(settingsKey, JSON.stringify(Object.fromEntries(settings.map(k => [k, state[k]]))));
      const writes = [persistEdits(), E.applyCloudRecords(prepared.origins), sync.cache.put('states', localAssetKey, assetRefs)];
      render(); window.scrollTo(x, y); return Promise.all(writes);
    },
    onStatus: status => { if (status === '同期済み') showPrivateImages(); }
  };
  const sync = F.install(cfg); window.ColorDriveSync = sync;
  function dataURL(blob) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(blob); }); }
  const oldPersist = persistEdits;
  persistEdits = async function () { const r = await oldPersist.apply(this, arguments); sync.changed(); return r; };
  const oldMark = mark;
  mark = function () { const r = oldMark.apply(this, arguments); sync.changed(); return r; };
  const oldRender = render;
  render = function () { const r = oldRender.apply(this, arguments); showPrivateImages(); return r; };
  document.addEventListener('colors-origin-changed', () => sync.changed());
  document.addEventListener('change', e => { if (['origin', 'search'].includes(e.target.id)) settingsChanged(); });
  document.addEventListener('click', e => { if (['shuffle', 'reset', 'modeStudy', 'modeList'].includes(e.target.closest('button')?.id)) settingsChanged(); });
  function settingsChanged() { localStorage.setItem(settingsKey, JSON.stringify(Object.fromEntries(settings.map(k => [k, state[k]])))); sync.changed(); }
  async function showPrivateImages() {
    for (const img of document.querySelectorAll('img[data-color-private-src]')) {
      const src = img.dataset.colorPrivateSrc; if (img.dataset.resolving) continue;
      img.dataset.resolving = '1';
      try {
        if (!src.startsWith('assets/')) { img.src = src; continue; }
        const ref = assetRefs[src];
        if (!ref) { img.alt = '既存写真：初回の非公開Drive登録が必要です'; img.dataset.resolving = ''; continue; }
        if (!imageUrls.has(ref)) imageUrls.set(ref, URL.createObjectURL(await sync.getBlob(ref)));
        if (img.isConnected) img.src = imageUrls.get(ref);
      } catch { img.alt = '既存写真：Google Driveへ再接続してください'; img.dataset.resolving = ''; }
    }
  }
  const upload = document.createElement('button'); upload.className = 'btn'; upload.type = 'button'; upload.textContent = '既存940写真を非公開Driveへ登録';
  const picker = document.createElement('input'); picker.type = 'file'; picker.multiple = true; picker.setAttribute('webkitdirectory', ''); picker.hidden = true;
  (document.querySelector('.toolbar .controls') || document.body).append(upload, picker);
  upload.onclick = () => { if (!sync.valid()) { sync.open(); return; } picker.click(); };
  picker.onchange = async () => {
    upload.disabled = true;
    try {
      await sync.ready; await sync.sync();
      if (!manifest) { const r = await fetch('./private-assets-manifest.json'); if (!r.ok) throw new Error('既存画像の一覧を読み込めません。'); manifest = (await r.json()).files; }
      const provided = new Map([...picker.files].map(f => [f.name, f]));
      const expected = Object.entries(manifest);
      if (expected.some(([p]) => !provided.has(p.split('/').pop()))) throw new Error('review47のassetsフォルダーを選択してください。940写真が揃っていません。');
      // Verify every file before uploading any; never substitute a different photograph.
      for (const [path, spec] of expected) { const f = provided.get(path.split('/').pop()); if (f.size !== spec.bytes || await sync.digest(await f.arrayBuffer()) !== spec.sha256) throw new Error('既存写真の内容が一致しません：' + path); }
      let count = 0;
      for (const [path, spec] of expected) {
        if (!assetRefs[path]) { const f = provided.get(path.split('/').pop()); assetRefs[path] = await sync.putBlob(f.slice(0, f.size, spec.mime_type)); await sync.cache.put('states', localAssetKey, assetRefs); }
        count++; upload.textContent = '既存写真の登録：' + count + ' / 940';
        if (count % 25 === 0) { sync.changed(); await sync.sync(); }
      }
      sync.changed(); await sync.sync(); render(); upload.textContent = '既存940写真：Drive登録済み';
    } catch (e) { toast(e.message); upload.textContent = '既存写真の登録を再開'; }
    finally { upload.disabled = false; picker.value = ''; }
  };
})();
