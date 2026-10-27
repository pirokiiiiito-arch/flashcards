/* Metadata and resumable migration only. No image bytes or OAuth credentials are bundled. */
(function (root) {
  'use strict';
  const parseRef = value => {
    const m = /^gdrive:([\w-]+):([a-f0-9]{64})$/.exec(String(value || ''));
    return m ? { id: m[1], sha256: m[2] } : null;
  };
  function validate(catalogue) {
    if (catalogue?.schema !== 'colors1000-private-assets-v2' || !catalogue.files || !Array.isArray(catalogue.registrations)) throw new Error('既存写真manifestの形式が一致しません。');
    const files = Object.entries(catalogue.files), rows = catalogue.registrations, counts = catalogue.counts;
    if (files.length !== counts.unique_images || rows.length !== counts.registrations) throw new Error('既存写真の件数が一致しません。');
    const ids = new Set(), hashes = new Set(files.map(([, v]) => v.sha256));
    if (hashes.size !== files.length) throw new Error('画像manifest内に同じSHA-256が重複しています。');
    for (const [path, f] of files) if (!/^[a-f0-9]{64}$/.test(f.sha256) || f.bytes < 1 || !path.startsWith('assets/')) throw new Error('画像manifestが不正です。');
    for (const row of rows) {
      const file = catalogue.files[row.original_asset_path];
      if (!row.photo_id || !/^color-\d{4}$/.test(row.color_id) || !['origin', 'interior', 'fashion', 'product', 'palette'].includes(row.role) || ids.has(row.registration_id) || !file || file.sha256 !== row.sha256 || file.bytes !== row.size) throw new Error('写真登録を元の画像へ解決できません。');
      ids.add(row.registration_id);
    }
    if (rows.filter(r => r.suppressed_duplicate).length !== counts.suppressed_duplicates || new Set(rows.map(r => r.sha256)).size !== files.length) throw new Error('写真割当・重複抑止の対応が一致しません。');
    return true;
  }
  function manifest(catalogue, refs, view = { data: {}, deleted: {}, conflicts: [] }) {
    validate(catalogue);
    const assets = Object.entries(catalogue.files).map(([path, f]) => {
      const ref = refs[path] || null, parsed = parseRef(ref);
      if (ref && (!parsed || parsed.sha256 !== f.sha256)) throw new Error('元画像とDrive参照のSHA-256が一致しません：' + path);
      return { asset_id: f.sha256, original_asset_path: path, drive_ref: ref, drive_file_id: parsed?.id || null, mime_type: f.mime_type, size: f.bytes, sha256: f.sha256, width: f.width, height: f.height, exif_orientation: f.exif_orientation };
    });
    const byPath = new Map(assets.map(a => [a.original_asset_path, a]));
    const registrations = catalogue.registrations.map(row => ({ ...row, drive_ref: byPath.get(row.original_asset_path).drive_ref, drive_file_id: byPath.get(row.original_asset_path).drive_file_id }));
    const manual = [], tombstones = [];
    for (const [key, v] of Object.entries(view.data)) if (key.startsWith('photo:')) {
      const slot = key.slice(6), at = slot.indexOf(':'), parsed = parseRef(v?.data_url);
      manual.push({ photo_id: slot, color_id: slot.slice(0, at), role: slot.slice(at + 1), drive_ref: parsed ? v.data_url : null, drive_file_id: parsed?.id || null, mime_type: v.mime_type || null, size: v.size ?? null, sha256: parsed?.sha256 || v.sha256 || null, deleted: !!v.deleted, updated_at: v.updated_at || '' });
    }
    for (const [key, v] of Object.entries(view.deleted)) if (key.startsWith('photo:')) tombstones.push({ photo_id: key.slice(6), restored_original: true, revision: v.id, updated_at: v.updated_at });
    return { schema: 'colors1000-drive-photo-manifest-v2', counts: { ...catalogue.counts, assets_with_drive_ref: assets.filter(a => a.drive_file_id).length, registrations_with_drive_ref: registrations.filter(r => r.drive_file_id).length }, assets, registrations, manual, tombstones, conflicts: view.conflicts.filter(c => c.key.startsWith('photo:')) };
  }
  async function publish(catalogue, refs, view, api) {
    const body = manifest(catalogue, refs, view), hash = await api.digest(JSON.stringify(body));
    const key = 'colors1000-photo-manifest:' + api.account;
    const previous = await api.cache.get('states', key);
    if (previous?.sha256 === hash) return previous;
    const found = await api.list(api.queryKind('photo-manifest') + " and appProperties has { key='sha256' and value='" + hash + "' }");
    const result = found[0] || await api.create('colors1000-photo-manifest-' + hash + '.json', new Blob([JSON.stringify({ ...body, saved_at: new Date().toISOString(), content_sha256: hash })], { type: 'application/json' }), { kind: 'photo-manifest', sha256: hash });
    const record = { file_id: result.id, sha256: hash }; await api.cache.put('states', key, record); return record;
  }
  function session(options) {
    const { api, catalogue } = options;
    validate(catalogue);
    let active = false, progress;
    const key = () => 'colors1000-migration:' + api.account;
    function summarize() {
      const rows = Object.values(progress.files);
      return { total: Object.keys(catalogue.files).length, uploaded: rows.filter(f => f.uploaded).length, verified: rows.filter(f => f.verified).length, failed: rows.filter(f => f.status === 'failed').length, skipped_existing: rows.filter(f => f.skipped_existing).length, pending: rows.filter(f => !f.verified && f.status !== 'failed').length };
    }
    async function checkpoint(remote = false) {
      progress.counts = summarize(); progress.updated_at = new Date().toISOString();
      await api.cache.put('states', key(), progress);
      options.onProgress?.(structuredClone(progress));
      if (remote && api.valid()) {
        await options.flush();
        const doc = { ...progress, manifest: manifest(catalogue, options.getRefs(), api.view()) };
        await api.create('colors1000-migration-' + progress.run_id + '-' + progress.counts.verified + '.json', new Blob([JSON.stringify(doc)], { type: 'application/json' }), { kind: 'migration-checkpoint' });
      }
    }
    async function run(providedFiles, verifyOnly = false) {
      if (active) throw new Error('既存写真の移行・検証を実行中です。');
      active = true;
      progress = { schema: 'colors1000-image-migration-v2', run_id: Date.now().toString(36), account: api.account || null, phase: 'preflight', complete: false, files: {} };
      for (const [path, spec] of Object.entries(catalogue.files)) progress.files[path] = { sha256: spec.sha256, size: spec.bytes, status: 'pending', uploaded: false, verified: false, skipped_existing: false, drive_file_id: null, error: null };
      try {
        await api.ready;
        if (!api.valid() || !api.account) { const e = new Error('Google Driveへの接続が必要です。'); e.auth = true; throw e; }
        const provided = new Map([...providedFiles || []].map(f => [f.name, f]));
        if (!verifyOnly) for (const [path, spec] of Object.entries(catalogue.files)) {
          const file = provided.get(path.split('/').pop());
          if (!file || file.size !== spec.bytes || await api.digest(await file.arrayBuffer()) !== spec.sha256) throw new Error('元の940写真と一致しません：' + path);
        }
        await checkpoint();
        const index = new Map();
        for (const file of await api.list(api.queryKind('image'))) {
          const hash = file.appProperties?.sha256;
          if (hash && (!file.sha256Checksum || file.sha256Checksum === hash)) {
            const current = index.get(hash); if (!current || file.id.localeCompare(current.id) < 0) index.set(hash, file);
          }
        }
        progress.phase = verifyOnly ? 'verifying' : 'uploading-and-verifying';
        let done = 0;
        for (const [path, spec] of Object.entries(catalogue.files)) {
          const record = progress.files[path];
          try {
            let remote = index.get(spec.sha256), ref;
            if (remote) { ref = 'gdrive:' + remote.id + ':' + spec.sha256; record.skipped_existing = true; }
            else if (verifyOnly) throw new Error('この画像のDrive保存を確認できません。');
            else {
              const file = provided.get(path.split('/').pop()); ref = await api.putBlob(file.slice(0, file.size, spec.mime_type), { fresh: true }); record.uploaded = true;
              remote = { id: parseRef(ref).id }; index.set(spec.sha256, remote);
            }
            record.drive_file_id = parseRef(ref)?.id || null;
            // This MUST bypass both IndexedDB and object URLs. Read all bytes from Drive.
            const blob = await api.getBlob(ref, { fresh: true });
            if (blob.size !== spec.bytes || await api.digest(await blob.arrayBuffer()) !== spec.sha256 || blob.type.split(';')[0] !== spec.mime_type) throw new Error('Driveから取得した画像のサイズ・MIME・SHA-256が一致しません。');
            await options.setRef(path, ref);
            record.verified = true; record.status = 'verified'; record.verified_at = new Date().toISOString();
          } catch (e) {
            if (e.auth) throw e;
            record.status = 'failed'; record.error = e.message || String(e);
          }
          done++; await checkpoint(done % 25 === 0);
        }
        await options.flush();
        const resolved = manifest(catalogue, options.getRefs(), api.view());
        progress.registrations_verified = resolved.registrations.filter(r => progress.files[r.original_asset_path]?.verified && r.drive_file_id).length;
        progress.suppressed_duplicates = resolved.registrations.filter(r => r.suppressed_duplicate).length;
        const count = summarize();
        progress.complete = count.verified === count.total && count.failed === 0 && progress.registrations_verified === catalogue.counts.registrations && progress.suppressed_duplicates === catalogue.counts.suppressed_duplicates;
        progress.phase = progress.complete ? 'complete' : 'partial';
        await publish(catalogue, options.getRefs(), api.view(), api);
        await checkpoint(true);
        return structuredClone(progress);
      } catch (e) {
        progress.phase = e.auth ? 'authorization_required' : 'blocked'; progress.blocker = e.message || String(e); await checkpoint(); throw e;
      } finally { active = false; }
    }
    return Object.freeze({ run, status: () => progress ? structuredClone(progress) : null, get active() { return active; } });
  }
  const exported = Object.freeze({ parseRef, validate, manifest, publish, session });
  root.ColorAssetMigration = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
