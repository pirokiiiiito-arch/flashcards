/* Copy image bytes, not external links. No public proxy, credentials, or photo data
 * are embedded here. Failed sources remain unchanged and explicitly incomplete. */
(function (root) {
  'use strict';
  const VERSION = 1, MAX_BYTES = 25 * 1024 * 1024, TIMEOUT_MS = 30000;
  const isDrive = value => /^gdrive:[\w-]+:[a-f0-9]{64}$/.test(String(value || ''));
  const errorText = e => String(e?.message || e || '画像を取得できません。').slice(0, 500);
  function identify(bytes) {
    const b = bytes, text = (at, n) => String.fromCharCode(...b.slice(at, at + n));
    if (b.length >= 8 && [137,80,78,71,13,10,26,10].every((v,i) => b[i] === v)) return 'image/png';
    if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
    if (['GIF87a','GIF89a'].includes(text(0,6))) return 'image/gif';
    if (text(0,4) === 'RIFF' && text(8,4) === 'WEBP') return 'image/webp';
    if (text(0,2) === 'BM') return 'image/bmp';
    if (b.length >= 4 && ((text(0,2) === 'II' && b[2] === 42 && b[3] === 0) || (text(0,2) === 'MM' && b[2] === 0 && b[3] === 42))) return 'image/tiff';
    if (b.length >= 4 && b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon';
    if (text(4,4) === 'ftyp') {
      const brands = []; for (let i = 8; i + 4 <= Math.min(b.length,64); i += 4) brands.push(text(i,4));
      if (brands.some(x => x === 'avif' || x === 'avis')) return 'image/avif';
    }
    return '';
  }
  async function imageBlob(blob) {
    if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_BYTES) throw Error('画像は空でない25MB以下のファイルにしてください。');
    const mime = identify(new Uint8Array(await blob.slice(0,64).arrayBuffer()));
    if (mime) return blob.type === mime ? blob : new Blob([blob], {type:mime});
    // Static SVG only. Reject active content and external dependencies, rather
    // than silently saving an HTML/error page or an SVG that still hotlinks.
    if (typeof DOMParser === 'function' && blob.size <= 2 * 1024 * 1024) {
      const text = await blob.text();
      if (!/<!DOCTYPE|<!ENTITY|<\?xml-stylesheet|@import|url\s*\(/i.test(text)) {
        const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
        const node = doc.documentElement;
        if (node?.localName === 'svg' && node.namespaceURI === 'http://www.w3.org/2000/svg' && !doc.querySelector('parsererror')) {
          const blocked = new Set(['script','foreignobject','iframe','object','embed','animate','set','animatemotion','animatetransform']);
          for (const el of [node, ...node.querySelectorAll('*')]) {
            if (blocked.has(el.localName.toLowerCase())) throw Error('外部依存または動作を含むSVGはコピーできません。PNG等で登録してください。');
            for (const a of el.attributes) {
              if (/^on/i.test(a.name) || ((a.localName === 'href' || a.localName === 'src') && a.value && !a.value.startsWith('#'))) throw Error('外部依存または動作を含むSVGはコピーできません。PNG等で登録してください。');
            }
          }
          return new Blob([blob], {type:'image/svg+xml'});
        }
      }
    }
    throw Error('画像本体を確認できません。画像ではないページ、非対応形式、または外部依存SVGです。');
  }
  async function readBounded(response) {
    if (!response.ok || response.type === 'opaque') throw Error('画像取得に失敗しました（HTTP ' + response.status + '）。');
    const length = Number(response.headers.get('content-length') || 0);
    if (length > MAX_BYTES) { await response.body?.cancel(); throw Error('画像が25MBを超えています。'); }
    if (!response.body?.getReader) return imageBlob(await response.blob());
    const reader = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        const {value, done} = await reader.read(); if (done) break;
        size += value.byteLength;
        if (size > MAX_BYTES) { await reader.cancel(); throw Error('画像が25MBを超えています。'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return imageBlob(new Blob(chunks, {type:response.headers.get('content-type') || ''}));
  }
  async function fetchImage(value, resolve, fetcher = root.fetch.bind(root)) {
    let src = String(value || '').trim();
    if (src.startsWith('idb:')) {
      src = await resolve(src);
      if (!src) throw Error('元の端末に保存した画像が見つかりません。元のPCでDriveへ接続してください。');
    }
    let url;
    try { url = new URL(src, root.location?.href || 'https://invalid.example/'); } catch { throw Error('画像URLの形式が不正です。'); }
    if (!['https:','http:','blob:','data:'].includes(url.protocol) || (url.protocol === 'data:' && !src.startsWith('data:image/')) || url.username || url.password) throw Error('この画像参照は取得できません。画像ファイルを同じ欄へ登録してください。');
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      // Never use Drive's authenticated request() for an external URL.
      const response = await fetcher(url.href, {mode:'cors', credentials:'omit', referrerPolicy:'no-referrer', cache:'no-store', signal:controller.signal});
      return await readBounded(response);
    } catch (e) {
      if (e.name === 'AbortError') throw Error('画像取得が30秒以内に完了しませんでした。再試行できます。');
      if (e instanceof TypeError) throw Error('通信エラー、HTTP制限、または取得先のCORS制限です。元URLは保持しています。画像をファイル保存して同じ欄へ登録する方法も使えます。');
      throw e;
    } finally { clearTimeout(timer); }
  }
  async function upload(api, blob, hash) {
    if (/^image\/(png|jpeg|webp|gif)$/.test(blob.type)) return api.putBlob(blob, {fresh:true});
    // Preserve AVIF/BMP/TIFF/ICO/static SVG bytes; shared core only accepts four
    // formats in putBlob, but its immutable create/getBlob support these too.
    const matches = await api.list(api.queryKind('image') + " and appProperties has { key='sha256' and value='" + hash + "' }");
    const file = matches[0] || await api.create('image-' + hash, blob, {kind:'image', sha256:hash});
    return 'gdrive:' + file.id + ':' + hash;
  }
  function create(options) {
    const failures = new Map(), recent = new Map(), inflight = new Map();
    let api, busy = false, phase = '', copied = 0, lastResult = null;
    const notify = () => options.onProgress?.(summary());
    function rows() {
      const result = [];
      for (const c of options.getCards()) options.getImages(c).forEach((value,index) => {
        if (value) result.push({key:'image:' + c.id + ':' + index, card_id:c.id, name:c.name, index, value});
      });
      return result;
    }
    function summary() {
      const all = rows(), pending = all.filter(r => !isDrive(r.value));
      return {version:VERSION, total:all.length, drive:all.length - pending.length, pending:pending.length,
        failed:pending.filter(r => failures.get(r.key)?.source === r.value).length, copied_this_session:copied, busy, phase};
    }
    async function copy(source) {
      const sourceKey = 'plant-image-source-v1:' + api.account + ':' + await api.digest(source);
      const saved = await api.cache.get('states', sourceKey);
      if (saved && isDrive(saved.ref)) {
        try { await api.getBlob(saved.ref, {fresh:true}); return saved.ref; }
        catch (e) { if (e.auth) throw e; /* Missing file: try source again, never delete the original. */ }
      }
      const blob = await fetchImage(source, options.resolveImage, options.fetch);
      const hash = await api.digest(await blob.arrayBuffer());
      const ref = await upload(api, blob, hash);
      const remote = await api.getBlob(ref, {fresh:true});
      if (await api.digest(await remote.arrayBuffer()) !== hash) throw Error('Driveから再取得した画像のSHA-256が一致しません。元画像を保持しました。');
      // Save the source and immutable ref privately before any card is switched.
      await api.cache.put('states', sourceKey, {schema:'plant-image-source-v1', source, ref, sha256:hash, size:blob.size, mime_type:blob.type, verified_at:new Date().toISOString()});
      copied++; return ref;
    }
    async function convert(key, value) {
      if (!key.startsWith('image:') || !value || isDrive(value)) return value;
      if (typeof value !== 'string') throw Error('植物画像の保存形式が不正です。');
      const cached = recent.get(value);
      // Retry failures on later reconnects, not repeatedly in the same sync.
      if (cached && Date.now() - cached.at < 60000) {
        if (cached.error) { failures.set(key, {source:value, reason:cached.error, at:cached.at}); return value; }
        return cached.ref;
      }
      if (!api?.valid()) { const e = Error('Google Driveへ再接続してください。画像は保持しています。'); e.auth = true; throw e; }
      phase = '画像を取得・Drive保存・再取得検証中'; notify();
      try {
        if (!inflight.has(value)) inflight.set(value, copy(value));
        const ref = await inflight.get(value);
        recent.set(value, {ref, at:Date.now()}); failures.delete(key); return ref;
      } catch (e) {
        failures.set(key, {source:value, reason:errorText(e), at:Date.now()});
        if (e.auth || !api.valid()) throw e;
        recent.set(value, {error:errorText(e), at:Date.now()});
        return value; // An unavailable photo is not a deletion and must not block other cards.
      } finally { inflight.delete(value); notify(); }
    }
    function report() {
      const detail = rows().map(r => ({card_id:r.card_id, name:r.name, slot:r.index + 1,
        status:isDrive(r.value) ? 'drive_reference' : 'not_copied',
        source:r.value.startsWith('data:') ? '[embedded image]' : r.value,
        reason:failures.get(r.key)?.source === r.value ? failures.get(r.key).reason : ''}));
      return {schema:'plant-drive-image-copy-report-v1', saved_at:new Date().toISOString(), ...summary(),
        note:'drive_reference counts stored references, not an all-Drive-file revalidation on this run.', images:detail};
    }
    async function sweep() {
      if (busy || options.isEditing()) { notify(); return; }
      const initial = rows().filter(r => !isDrive(r.value));
      if (!initial.length) { phase = '全登録画像の参照がDriveになっています'; notify(); return; }
      busy = true;
      try {
        // Preserve the first pre-switch snapshot once per account. Creating one
        // per reconnect would fill IndexedDB when a source remains unavailable.
        const snapshotKey = 'plant-before-image-copy:' + api.account;
        if (!await api.cache.get('states', snapshotKey)) await api.cache.put('states', snapshotKey, structuredClone(options.getCards()));
        let n = 0;
        for (const row of initial) {
          if (!api.valid() || options.isEditing()) break;
          phase = '既存画像のコピー ' + (++n) + ' / ' + initial.length; notify();
          const ref = await convert(row.key, row.value);
          if (ref !== row.value && isDrive(ref)) {
            // Compare-and-swap: deletion/replacement while downloading wins.
            if (options.replaceIfCurrent(row.card_id, row.index, row.value, ref)) options.changed();
          }
        }
      } finally {
        busy = false; phase = summary().pending ? '未コピー画像を保持しています。失敗理由は「画像コピー結果を保存」で確認できます。' : '全登録画像の参照がDriveになりました';
        lastResult = report();
        await api.cache.put('states', 'plant-image-copy-report-v1:' + api.account, lastResult);
        notify();
      }
    }
    return {attach(value) {api = value; notify();}, convert, sweep, summary, report,
      retry() {recent.clear(); notify();}, get busy() {return busy;}, get lastResult() {return lastResult;}};
  }
  const exported = Object.freeze({version:VERSION, create, isDrive, identify, imageBlob, fetchImage, MAX_BYTES});
  root.PlantDriveImageCopy = exported;
  if (typeof module !== 'undefined' && module.exports) module.exports = exported;
})(typeof window !== 'undefined' ? window : globalThis);
