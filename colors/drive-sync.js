/* review47 data stays intact. Static photographs are private, authenticated Drive blobs. */
(function () {
  'use strict';
  const F = window.FlashcardsDrive, E = window.ColorOriginEditor;
  let assetRefs = {}, cataloguePromise, migrationBusy = false, migrationRunner, imageUrls = new Map();
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
    // Static review47 asset refs are local cache only. They are rebuilt from Drive SHA metadata.
    for (const k of settings) data['setting:' + k] = structuredClone(state[k]);
    return data;
  }
  async function toCloudValue(k, v, api) {
    if (!k.startsWith('photo:') || !v || v.deleted || !String(v.data_url || '').startsWith('data:image/')) return v;
    const blob = await (await fetch(v.data_url)).blob();
    return { ...v, data_url: await api.putBlob(blob), sha256: await api.digest(await blob.arrayBuffer()), mime_type: blob.type, size: blob.size };
  }
  const cfg = {
    namespace: 'colors1000-review47', toolbar: '.toolbar .controls', ready,
    primary: () => localStorage.getItem('colors1000_drive_primary_v3') === '1',
    enablePrimary: () => localStorage.setItem('colors1000_drive_primary_v3', '1'),
    read, toCloudValue, isEditing: () => migrationBusy || !!document.getElementById('originEditorDialog')?.open,
    // In this app an origin key is never intentionally deleted: "元の調査文に戻す"
    // is stored as mode:"original". Therefore a tombstoned origin key is an old sync bug
    // and can be safely restored from its latest non-deleted journal revision.
    repair: async api => { await api.recoverDeletedPrefix('origin:'); },
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
      const photos = {}, origins = {}, study = {}, assets = {}, prefs = {}, photoDeleted = [];
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
      for (const k of Object.keys(view.deleted || {})) if (k.startsWith('photo:')) photoDeleted.push(k.slice(6));
      return { photos: normalizeEdits(photos), photoDeleted, origins: E.validateRecords(origins), study: validateStudyProgress(study), assets, prefs };
    },
    apply: prepared => {
      const x = window.scrollX, y = window.scrollY, flipped = state.flipped;
      // Missing cloud keys are not deletions. Merge remote edits into local state and
      // remove only keys with an explicit Drive tombstone.
      const mergedPhotos = { ...manualEdits, ...prepared.photos };
      for (const id of prepared.photoDeleted || []) delete mergedPhotos[id];
      manualEdits = mergedPhotos;
      progress = { ...progress, ...prepared.study };
      assetRefs = { ...assetRefs, ...prepared.assets };
      for (const k of settings) if (k in prepared.prefs) state[k] = prepared.prefs[k];
      state.flipped = flipped;
      localStorage.setItem('colors1000_verified_progress', JSON.stringify(progress));
      localStorage.setItem(settingsKey, JSON.stringify(Object.fromEntries(settings.map(k => [k, state[k]]))));
      const writes = [persistEdits(), E.applyCloudRecords(prepared.origins), sync.cache.put('states', localAssetKey, assetRefs)];
      render(); window.scrollTo(x, y); return Promise.all(writes);
    },
    afterSync: async (view, api) => {
      const catalogue = await loadCatalogue();
      // Static review47 assets are immutable. Rebuild their refs from Drive by SHA-256
      // instead of trusting one device's journal/cache. This makes a new phone, a cleared
      // cache, or a stale journal self-healing after Google Drive reconnect.
      const files = await api.list(api.queryKind('image'));
      const byHash = new Map();
      for (const file of files) {
        const hash = file.appProperties?.sha256;
        if (hash && /^[a-f0-9]{64}$/.test(hash) && (!file.sha256Checksum || file.sha256Checksum === hash)) {
          const prev = byHash.get(hash);
          if (!prev || file.id.localeCompare(prev.id) < 0) byHash.set(hash, file);
        }
      }
      let recovered = 0;
      for (const [path, spec] of Object.entries(catalogue.files)) {
        const remote = byHash.get(spec.sha256);
        if (!remote) continue;
        const ref = 'gdrive:' + remote.id + ':' + spec.sha256;
        if (assetRefs[path] !== ref) assetRefs[path] = ref;
        recovered++;
      }
      if (recovered === catalogue.counts.unique_images) {
        await api.cache.put('states', localAssetKey, assetRefs);
      }
      const refs = {};
      for (const [path, ref] of Object.entries(assetRefs)) refs[path] = ref;
      await ColorAssetMigration.publish(catalogue, refs, view, api);
      showPrivateImages();
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
  function loadCatalogue() {
    if (!cataloguePromise) cataloguePromise = (async () => {
      const r = await fetch('./private-assets-manifest.json?v=2', {cache:'no-cache'});
      if (!r.ok) throw new Error('既存画像の一覧を読み込めません。');
      const catalogue = await r.json(); ColorAssetMigration.validate(catalogue);
      if (catalogue.counts.unique_images !== 940 || catalogue.counts.registrations !== 1047 || catalogue.counts.suppressed_duplicates !== 107) throw new Error('review47の写真件数が一致しません。');
      return catalogue;
    })().catch(e => {cataloguePromise=null;throw e;});
    return cataloguePromise;
  }
  const upload = document.createElement('button'); upload.className = 'btn'; upload.type = 'button'; upload.textContent = '既存940写真を非公開Driveへ登録';
  const verify = document.createElement('button'); verify.className = 'btn'; verify.type = 'button'; verify.textContent = '940写真をDriveから全件検証';
  const recoverManual = document.createElement('button'); recoverManual.className = 'btn'; recoverManual.type = 'button'; recoverManual.textContent = '以前追加した写真を復元';
  const report = document.createElement('button'); report.className = 'btn'; report.type = 'button'; report.textContent = '写真移行の結果を保存';
  const indicator = document.createElement('p'); indicator.id='colorImageMigrationStatus';indicator.setAttribute('role','status');indicator.style.cssText='font-size:12px;line-height:1.6;margin:8px 0';indicator.textContent='既存940写真：Driveへの全件転送・検証は未実施です。';
  const picker = document.createElement('input'); picker.type = 'file'; picker.multiple = true; picker.setAttribute('webkitdirectory', ''); picker.hidden = true;
  (document.querySelector('.toolbar .controls') || document.body).append(upload, verify, recoverManual, report, picker, indicator);
  upload.onclick = () => { if (!sync.valid()) { sync.open(); return; } picker.click(); };
  function progressText(p) {
    const c=p.counts;indicator.textContent=`既存写真 ${c.total}：転送 ${c.uploaded}／既存利用 ${c.skipped_existing}／Drive再取得・SHA一致 ${c.verified}／失敗 ${c.failed}／未検証 ${c.pending}`+(p.complete?'（全件検証成功）':p.blocker?' — '+p.blocker:'');
  }
  async function runMigration(files, verifyOnly) {
    if (!sync.valid()) {sync.open();return;}
    upload.disabled=verify.disabled=true;
    try {
      await sync.ready;await sync.sync();migrationBusy=true;
      migrationRunner=ColorAssetMigration.session({
        api:sync,catalogue:await loadCatalogue(),getRefs:()=>assetRefs,
        setRef:async(path,ref)=>{if(assetRefs[path]!==ref){assetRefs[path]=ref;await sync.cache.put('states',localAssetKey,assetRefs);sync.changed();}},
        flush:async()=>{sync.changed();await sync.sync();},onProgress:progressText
      });
      const result=await migrationRunner.run(files,verifyOnly);
      if(!result.complete)throw new Error('全件検証は未完了です。失敗欄を確認し、再実行すると保存済み画像を再利用して続行します。');
      upload.textContent='既存940写真：Drive検証済み';
    } catch(e) {toast(e.message);indicator.textContent+=' — '+e.message;}
    finally {migrationBusy=false;upload.disabled=verify.disabled=false;picker.value='';if(sync.valid())await sync.sync().catch(e=>toast(e.message));render();}
  }
  picker.onchange=()=>runMigration(picker.files,false);
  verify.onclick=()=>runMigration([],true);
  recoverManual.onclick = async () => {
    if (!sync.valid()) { sync.open(); return; }
    if (!window.confirm('Driveの履歴から、現在空欄になっている手動写真だけを復元します。現在表示中の手動写真は上書きしません。続けますか？')) return;
    recoverManual.disabled = true;
    try {
      await sync.ready;
      const result = await sync.recoverDeletedPrefix('photo:', { onlyIfAbsent: true });
      await sync.sync();
      toast(result ? result + '件の手動写真履歴を復元しました。' : '復元できる手動写真履歴は見つかりませんでした。');
    } catch (e) { toast(e.message || '手動写真を復元できませんでした。'); }
    finally { recoverManual.disabled = false; }
  };
  report.onclick=async()=>{
    await sync.ready;const catalogue=await loadCatalogue(),state=migrationRunner?.status()||await sync.cache.get('states','colors1000-migration:'+sync.account);
    const body={schema:'colors1000-migration-result-v2',saved_at:new Date().toISOString(),migration:state||{complete:false,phase:'not_started',counts:{total:940,uploaded:0,verified:0,failed:0,skipped_existing:0,pending:940}},manifest:ColorAssetMigration.manifest(catalogue,assetRefs,sync.view())};
    const a=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify(body,null,2)],{type:'application/json'}));a.href=url;a.download='colors1000-private-image-migration.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
})();
