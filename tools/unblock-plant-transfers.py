"""Run last after repair-plant-source.py. Plant-editor queue repair only.
An unavailable photograph stays pending locally; independent edits may publish.
Never publish idb/data/blob device-only references; http/https may fall back to the original URL when private copying is blocked.
The working word/color core, auth, data keys, viewer and source permissions stay unchanged.
"""
from pathlib import Path
import hashlib,json,re
R=Path(__file__).resolve().parents[1]
def read(p):return (R/p).read_text(encoding='utf-8')
def write(p,s):(R/p).write_text(s,encoding='utf-8')
def one(s,a,b):
    if s.count(a)!=1:raise RuntimeError('Plant queue anchor changed: '+a[:100])
    return s.replace(a,b,1)
def sha(p):return hashlib.sha256((R/p).read_bytes()).hexdigest()
protected=['drive-core.js','drive-config.js','drive-sync.js','index.html','word-sync-v2.html','auth-only-ui.js','drive-local-view.js','drive-view-cache.js','plants/local-adapter.js','plants/photo-view.html','plants/normal-order.js','plants/pc-order-source.js']+[str(p.relative_to(R)) for p in (R/'colors').rglob('*') if p.is_file()]+[str(p.relative_to(R)) for p in (R/'plants').glob('data*.json')]
before={p:sha(p) for p in protected}
# Separate derived core: no change to word/color behavior or persisted schema.
s=read('drive-core.js')
s=one(s,'    let localSnapshot = {};',"    let localSnapshot = {};\n    const deferredPhotoKeys = new Set();\n    const deferPhoto = e => e?.plantPhotoDeferred === true && !e.auth;")
s=one(s,'        if (!deleted) value = await cfg.toCloudValue(key, value, api);',"""        if (!deleted) {
          try { value = await cfg.toCloudValue(key, value, api); }
          catch (e) { if (!deferPhoto(e)) throw e; deferredPhotoKeys.add(key); }
        }
        // A deferred value is a private local pending event, never a Drive journal.
""")
a=s.index('    async function push() {');b=s.index('    async function recoverDeletedPrefix',a)
s=s[:a]+"""    async function push() {
      // Snapshot IDs, not mutable values. New saves during upload remain pending.
      const pending = [...state.pending];
      for (let offset = 0; offset < pending.length; offset += 250) {
        const events = [];
        for (const id of pending.slice(offset, offset + 250)) {
          if (!state.events[id]) throw new Error('送信待ち履歴を確認できません。保存データは保持しています。');
          const e = clone(state.events[id]);
          try { if (!e.deleted) e.value = await cfg.toCloudValue(e.key, e.value, api); }
          catch (failure) {
            if (!deferPhoto(failure)) throw failure;
            deferredPhotoKeys.add(e.key); continue;
          }
          events.push(e);
        }
        if (!events.length) continue;
        const doc = { schema: SCHEMA, namespace: cfg.namespace, saved_at: new Date().toISOString(), device_id: device,
          data: materialize(Object.fromEntries(events.map(e => [e.id, e]))).data,
          deleted: events.filter(e => e.deleted), events };
        const result = await create(cfg.namespace + '-journal-' + uuid() + '.json', new Blob([JSON.stringify(doc)], { type: 'application/json' }), { kind: 'journal' });
        // Only acknowledged events leave the queue. Failed originals and parents
        // remain intact. Existing CRDT parent IDs also prevent their later retry
        // from resurrecting a newer replacement or explicit removal.
        const sent = new Set(events.map(e => e.id));
        for (const e of events) state.events[e.id] = e;
        state.seen[result.id] = result.md5Checksum || '';
        state.pending = state.pending.filter(id => !sent.has(id)); await persist();
      }
    }
"""+s[b:]
s=one(s,'      setStatus(\'同期中\');',"      deferredPhotoKeys.clear();\n      setStatus('同期中');")
s=one(s,"      if (state.pending.length) { timer = setTimeout(() => sync().catch(error), 1500); setStatus('接続済み', '新しい変更を同期待ちです。'); }", """      if (state.pending.length) {
        const remaining = new Set(state.pending.map(id => state.events[id]?.key).filter(key => deferredPhotoKeys.has(key))).size;
        timer = setTimeout(() => sync().catch(error), remaining ? 60000 : 1500);
        setStatus(remaining ? '画像送信待ち' : '接続済み', remaining ? '取得できない写真 '+remaining+'枠を端末に保持しています。他の追加・編集は送信しました。認証と通信が戻ると自動再試行します。' : '新しい変更を同期待ちです。');
      }""")
s=one(s,'    async function importValues(values, source, timestamps = {}, tombstones = {}) {',"""    async function republish(keys) {
      await ready; await captureQueue; await capture();
      if (!valid()) { const e = new Error('Google Driveへ再接続してください。'); e.auth = true; throw e; }
      // Refresh immutable journals without applying the remote view to local cards.
      // This preserves the PC photo while letting a new registration descend from
      // any remote tombstone/current head instead of remaining concurrent with it.
      await pull();
      const current = await cfg.read(), currentHeads = heads(state.events);
      const basis = state.basis || {}; let added = 0;
      for (const key of new Set(keys || [])) {
        if (!(key in current)) continue;
        const parents = currentHeads.get(key)?.map(e => e.id) || basis[key] || [];
        const e = newEvent(key, current[key], false, parents);
        append(e); basis[key] = [e.id]; added++;
      }
      state.basis = basis;
      if (added) { await persist(); clearTimeout(timer); if (valid()) timer = setTimeout(() => sync().catch(error), 0); }
      return added;
    }
    async function importValues(values, source, timestamps = {}, tombstones = {}) {""")
s=one(s,'const api = { ready, changed, sync, open, putBlob, getBlob, digest, cache, valid, request, list, create, queryKind, setStatus, recoverDeletedPrefix, view: () => state ? clone(materialize(state.events)) : {data:{},deleted:{},conflicts:[]}, get account() { return state?.account; }, get applying() { return applying; }, status: () => ({ status, detail, pending: state?.pending?.length || 0, conflicts: state ? materialize(state.events).conflicts.length : 0 }) };',
        'const api = { ready, changed, sync, republish, pendingKeys: () => state ? [...new Set(state.pending.map(id => state.events[id]?.key).filter(Boolean))] : [], open, putBlob, getBlob, digest, cache, valid, request, list, create, queryKind, setStatus, recoverDeletedPrefix, view: () => state ? clone(materialize(state.events)) : {data:{},deleted:{},conflicts:[]}, get account() { return state?.account; }, get applying() { return applying; }, status: () => ({ status, detail, pending: state?.pending?.length || 0, conflicts: state ? materialize(state.events).conflicts.length : 0 }) };')
write('plants/drive-transfer-core.js',s)
s=read('plants/drive-sync.js')
s=one(s,"    if (ref === v && /^(idb:|data:image\\/|blob:)/.test(v)) throw Error('端末の画像をDriveへ保存できません。元のPCの画像を保持しています。「画像コピー結果を保存」で確認してください。');", """    if (v && !P.isDrive(ref) && /^(idb:|data:image\/|blob:)/.test(String(v))) {
      const e = Error('この写真はまだDriveへ転送できません。元画像は端末に保持し、他の追加画像は送信します。');
      e.plantPhotoDeferred = true; throw e;
    }
    if (v && !P.isDrive(ref) && !/^https?:\/\//i.test(String(ref))) {
      const e = Error('この写真参照はスマホへ共有できません。元画像は端末に保持しています。');
      e.plantPhotoDeferred = true; throw e;
    }""")
write('plants/drive-sync.js',s)
# A failed IndexedDB read is not proof that the old authenticated source is absent.
s=read('plants/legacy-photo-source.js')
s=one(s,"   const local=await o.resolveLocal(value);if(local||!String(value).startsWith('idb:'))return local;", """   let local;
   try{local=await o.resolveLocal(value);}catch(e){if(!String(value).startsWith('idb:'))throw e;}
   if(local||!String(value).startsWith('idb:'))return local||'';""")
write('plants/legacy-photo-source.js',s)
for path in ['plants/index.html','plants/plant-sync-v2.html']:
    s=read(path)
    s,n=re.subn(r'<script src="\.\./drive-core.js\?v=[^"]+"></script>', '<script src="./drive-transfer-core.js?v=queue1"></script>',s)
    if n!=1:raise RuntimeError('Plant core entry changed: '+path)
    s=one(s,'./drive-sync.js?v=plantsource1','./drive-sync.js?v=queue1')
    s=one(s,'./legacy-photo-source.js?v=1','./legacy-photo-source.js?v=queue1')
    write(path,s)
s=read('plants/service-worker.js')
s=one(s,'plant-flashcards-v34-source1','plant-flashcards-v35-queue1')
s=one(s,'../drive-core.js?v=plant-network2','./drive-transfer-core.js?v=queue1')
s=one(s,'./drive-sync.js?v=plantsource1','./drive-sync.js?v=queue1')
s=one(s,'./legacy-photo-source.js?v=1','./legacy-photo-source.js?v=queue1')
write('plants/service-worker.js',s)
if before!={p:sha(p) for p in protected}:raise RuntimeError('Protected data/auth/viewer/word/color changed')
write('plants/transfer-queue-build.json',json.dumps({'schema':'plant-transfer-queue-v1','protected_sha256':before,'pending_originals_retained':True,'authentication_changed':False,'storage_keys_changed':False},ensure_ascii=False,indent=2)+'\n')
print('Plant photo failures remain queued while other additions publish; no data or authentication migration.')
