"""Build an isolated firearm flashcard sync core from the verified plant queue.

Only guns/drive-transfer-core.js is generated. This script must not modify
the word/plant/color applications, research, source photos or private data.
"""
from pathlib import Path
import hashlib,json

R=Path(__file__).resolve().parents[1]
def read(name):return (R/name).read_text(encoding='utf-8')
def write(name,body):(R/name).write_text(body,encoding='utf-8')
def checksum(name):return hashlib.sha256((R/name).read_bytes()).hexdigest()

protected=['drive-core.js','persistent-drive-auth.js','drive-config.js','index.html','drive-sync.js',
  'plants/index.html','plants/drive-sync.js','plants/drive-image-copy.js',
  'colors/index.html','colors/drive-sync.js','colors/app-main.js',
  'colors/data/review47-progress.b64','colors/private-assets-manifest.json']
before={x:checksum(x) for x in protected}
src=read('plants/drive-transfer-core.js')
for marker in ['plantPhotoDeferred','async function republish(keys)','pendingKeys: () =>',
               'pendingValues: prefix =>','root.FlashcardsDrive']:
    if marker not in src:raise RuntimeError('The verified plant transfer core changed: '+marker)
guns=src.replace('plantPhotoDeferred','gunPhotoDeferred')
def replace_once(body,old,new):
    if body.count(old)!=1:raise RuntimeError('The verified gun core marker changed: '+old)
    return body.replace(old,new,1)

# Repairing an existing Drive reference must never undo a change or deletion
# learned during republish's own pull. Equal values can be re-registered when
# the sending device retained an event whose Drive journal is missing.
guns=replace_once(guns,'async function republish(keys) {',
    'async function republish(keys, options = {}) {')
guns=replace_once(guns,
    '        if (!(key in current)) continue;\n        const parents = currentHeads.get(key)?.map(e => e.id) || basis[key] || [];',
    '        if (!(key in current)) continue;\n'
    '        // Repair may resend the same value, but never undo remote changes.\n'
    '        if (options.preserveRemote === true && (currentHeads.get(key) || []).some(e =>\n'
    '          e.deleted || stable(e.value) !== stable(current[key]))) continue;\n'
    '        const parents = currentHeads.get(key)?.map(e => e.id) || basis[key] || [];')
guns=replace_once(guns,'ready, changed, sync, republish, pendingKeys:',
    'ready, changed, sync, republish, republishSaved: keys => republish(keys, {preserveRemote:true}), pendingKeys:')
# Bound each actual I/O operation, not the entire sync. An expired request is
# aborted before its late result can reach the journal or acknowledge a write.
a=guns.index('  function openDB() {')
b=guns.index('  const cache = ',a)
guns=guns[:a]+"""  function openDB() {
    return root.GunSyncIO.openDB('flashcards_drive_cache_v3', 1, db => {
      db.createObjectStore('states'); db.createObjectStore('blobs');
    });
  }
  async function dbAction(store, mode, fn) {
    const db = await openDB();
    try { return await root.GunSyncIO.transaction(db, store, mode, fn); }
    finally { db.close(); }
  }
"""+guns[b:]
guns=replace_once(guns,
    "      const response = await fetchResponse(url, { ...options, headers, cache: 'no-store' });",
    "      const response = await root.GunSyncIO.fetchResponse(url, { ...options, headers, cache: 'no-store' });")
# A failed first cache read must not poison every later retry in this page.
# Only one initialization may run at a time, and successful initialization is
# never repeated over an already-active journal.
a=guns.index('    const ready = (async () => {')
b=guns.index('    function persist() {',a)
guns=guns[:a]+"""    let initializedSession = false, readinessFlight = null;
    function ensureReady() {
      if (initializedSession) return Promise.resolve();
      if (readinessFlight) return readinessFlight;
      readinessFlight = (async () => {
        await cfg.ready;
        state = await cache.get('states', stateKey) || { events: {}, pending: [], seen: {}, imports: {}, account: '', clock: 0, initialized: false };
        localSnapshot = await cfg.read();
        if (state.initialized) localSnapshot = state.snapshot || localSnapshot;
        await capture();
        initializedSession = true;
      })().finally(() => { readinessFlight = null; });
      return readinessFlight;
    }
    const ready = ensureReady();
"""+guns[b:]

# Expose only progress and counts. Account IDs, URLs, tokens, journal bodies,
# card text and photo bytes must never enter the diagnostic snapshot.
guns=replace_once(guns,"    const stateKey = cfg.namespace;","""    const diagnostic = { version: '20261128-sync4', phase: 'idle', stage: '',
      startedAt: 0, finishedAt: 0, lastSuccessAt: 0, lastError: null,
      downloadedJournals: 0, totalJournals: 0, journalFilesSeen: 0 };
    const stateKey = cfg.namespace;""")
guns=replace_once(guns,
    "    function error(e) {",
    """    function progress(stage, counts = {}) {
      Object.assign(diagnostic, counts, {stage, phase: 'running'});
      setStatus('同期中', stage);
    }
    function diagnostics() {
      return {...clone(diagnostic), elapsedMs: diagnostic.startedAt ?
        Math.max(0, (diagnostic.finishedAt || Date.now()) - diagnostic.startedAt) : 0};
    }
    function error(e) {""")
# Keep the shared core's stale-authentication guard before recording an error.
guns=replace_once(guns,
    "      setStatus(e.auth ? '未接続' : '同期エラー', e.message || String(e));",
    """
      const message = String(e.message || e).slice(0, 320);
      diagnostic.lastError = {code: e.code || (e.auth ? 'authentication_required' : 'sync_error'),
        stage: diagnostic.stage, message, at: Date.now()};
      diagnostic.phase = 'error'; diagnostic.finishedAt = Date.now();
      setStatus(e.auth ? '未接続' : '同期エラー',
        (diagnostic.stage ? diagnostic.stage + '：' : '') + message);""")

a=guns.index('    async function pull() {')
b=guns.index('    async function push() {',a)
guns=guns[:a]+"""    async function pull() {
      progress('同期履歴の一覧を取得中');
      const files = await list(queryKind('journal'));
      const remaining = files.filter(file => !(state.seen[file.id] === file.md5Checksum && file.md5Checksum));
      diagnostic.journalFilesSeen = files.length;
      diagnostic.totalJournals += remaining.length;
      for (const [index, file] of remaining.entries()) {
        progress('同期履歴を受信 ' + (index + 1) + ' / ' + remaining.length);
        const journal = await (await request(API + 'files/' + encodeURIComponent(file.id) + '?alt=media')).json();
        if (journal.schema !== SCHEMA || journal.namespace !== cfg.namespace || !Array.isArray(journal.events)) throw new Error('Driveの同期形式が一致しません。');
        for (const e of journal.events) {
          if (state.events[e.id] && stable(state.events[e.id]) !== stable(e)) throw new Error('Drive同期履歴が競合しています。');
          state.events[e.id] = e; state.clock = Math.max(state.clock || 0, Number(e.clock) || 0);
        }
        state.seen[file.id] = file.md5Checksum || '';
        progress('受信した履歴を端末に保存 ' + (index + 1) + ' / ' + remaining.length);
        await persist(); diagnostic.downloadedJournals++;
      }
    }
"""+guns[b:]
guns=replace_once(guns,
    '      for (let offset = 0; offset < pending.length; offset += 250) {',
    """      for (let offset = 0; offset < pending.length; offset += 250) {
        progress('変更を送信 ' + Math.min(offset + 250, pending.length) + ' / ' + pending.length);""")
guns=replace_once(guns,
    "        const page = await (await request(API + 'files?' + p)).json(); files.push(...(page.files || [])); next = page.nextPageToken || '';",
    """        const page = await (await request(API + 'files?' + p)).json(); files.push(...(page.files || [])); next = page.nextPageToken || '';
        if (query === queryKind('journal')) progress('同期履歴の一覧を取得 ' + files.length + '件',
          {journalFilesSeen: files.length});""")
guns=replace_once(guns,
    '      for (const key of new Set([...Object.keys(values), ...Object.keys(tombstones)])) {',
    """      const keys = [...new Set([...Object.keys(values), ...Object.keys(tombstones)])]; let checked = 0;
      for (const key of keys) {
        if (checked++ % 100 === 0) progress('端末のカード・写真を確認 ' + checked + ' / ' + keys.length);""")
guns=replace_once(guns,
    '    async function doSync() {\n      await ready; await captureQueue; await capture();',
    """    async function doSync() {
      Object.assign(diagnostic, {startedAt: Date.now(), finishedAt: 0, downloadedJournals: 0, totalJournals: 0});
      progress('端末の同期履歴を読み込み中');
      await ready;
      progress('端末の変更を確認中');
      await captureQueue; await capture();""")
guns=replace_once(guns,"      setStatus('同期中');","      progress('Googleアカウントを確認中');")
guns=replace_once(guns,
    "        await cache.put('states', cfg.namespace + ':before-drive:' + Date.now(), initial);",
    """        progress('端末のデータを保護して初回同期を準備中');
        await cache.put('states', cfg.namespace + ':before-drive:' + Date.now(), initial);""")
guns=replace_once(guns,
    '      await captureQueue; await capture(); await push(); await pull();',
    """      progress('送信する変更を確認中');
      await captureQueue; await capture(); await push(); await pull();
      progress('受信したカード・写真を画面へ反映中');""")
guns=replace_once(guns,
    '      await cfg.afterSync?.(materialize(state.events), api);',
    """      progress('写真の保存・登録状態を確認中');
      await cfg.afterSync?.(materialize(state.events), api);""")
guns=replace_once(guns,
    '    }\n    function sync() {',
    """      diagnostic.finishedAt = Date.now();
      diagnostic.phase = state.pending.length ? 'waiting' : 'complete';
      diagnostic.stage = state.pending.length ? '送信待ちの変更を保持' : '同期完了';
      if (!state.pending.length) diagnostic.lastSuccessAt = diagnostic.finishedAt;
    }
    function sync() {""")
guns=replace_once(guns,'recoverDeletedPrefix, view:','recoverDeletedPrefix, diagnostics, view:')
guns=guns.replace('await ready;', 'await ensureReady();')
guns=replace_once(guns,'.then(() => ready).then(capture)','.then(ensureReady).then(capture)')
guns=replace_once(guns,'const api = { ready, changed,',
    'const api = { get ready() { return ensureReady(); }, changed,')
guns=read('guns/sync-io.js')+'\n'+guns
write('guns/drive-transfer-core.js',guns)
if before!={x:checksum(x) for x in protected}:
    raise RuntimeError('An existing application or its research was changed')
output={'schema':'gun-flashcards-build-v1','source':'verified-plant-journal-core',
        'namespace':'gun-flashcards-v1','deferred_marker':'gunPhotoDeferred',
        'data_changes':False,'other_apps_modified':False,
        'protected_sha256':before}
write('guns/build-report.json',json.dumps(output,indent=2,ensure_ascii=False)+'\n')
print('Gun cards built: independent Drive journal, images retained on copy failure.')
