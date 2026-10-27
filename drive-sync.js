/* Word-only adapter. Private recovery is fetched with the current Drive identity. */
(function () {
  'use strict';
  if (window.WordDriveSync) return;
  const F = window.FlashcardsDrive;
  const key = c => 'card:' + c.id;
  const clean = c => ({ id: c.id, word: c.word, meaning: c.meaning, sort_order: Number(c.sort_order) || 0, updated_at: c.updated_at || null });
  function values(list) { return Object.fromEntries(list.map(c => [key(c), clean(c)])); }
  function timestamps(list) { return Object.fromEntries(list.filter(c => c.updated_at).map(c => [key(c), c.updated_at])); }
  async function read() {
    for (const c of cards) if (!c.id) c.id = 'legacy-' + await F.digest(c.word + '\u0000' + c.meaning);
    return values(cards);
  }
  function oldMeta() { try { return JSON.parse(localStorage.getItem('word_gdrive_meta_v2') || '{}'); } catch { return {}; } }
  let networkLoader;
  async function networkRecovery() {
    if (window.WordNetworkRecovery?.version === 2) return window.WordNetworkRecovery;
    if (!networkLoader) networkLoader = new Promise((resolve,reject) => {
      const s = document.createElement('script'); s.src = './word-network-recovery.js?v=20261028-network2';
      s.onload = () => window.WordNetworkRecovery?.version === 2 ? resolve(window.WordNetworkRecovery) : reject(Error('ネット同期 v2 を読み込めません。更新用リンクから開いてください。'));
      s.onerror = () => reject(Error('ネット同期機能を読み込めません。保存データは保持しています。'));
      document.head.appendChild(s);
    }).catch(e => { networkLoader = null; throw e; });
    return networkLoader;
  }
  function statusChanged(status, message) {
    window.WordDriveRecovery?.refresh();
    const p = document.getElementById('wordNetworkProgress');
    if (p && status === '同期済み') {
      const view = window.WordDriveSync?.view();
      const n = Object.keys(view?.data || {}).filter(k => k.startsWith('card:')).length;
      p.textContent = n && cards.length ? 'ネット同期 v2：同期完了\n端末 ' + cards.length + '件 ／ Drive ' + n + '件' : 'ネット同期 v2：単語0件・復旧未完了';
    } else if (p && status === '同期エラー') p.textContent = 'ネット同期 v2：未完了\n' + message;
  }
  const cfg = {
    namespace: 'word-flashcards', toolbar: '.topbar', primary: wordDrivePrimary,
    storageKeys: [KEY], reload: () => { if (!editing) { cards = loadCards(); rebuildOrder(); render(); } },
    read, isEditing: () => editing || !!window.__WORD_RECOVERY_ACTIVE,
    onStatus: statusChanged,
    enablePrimary: async () => {
      localStorage.setItem('word_drive_primary_v1', '1'); stopSyncLoop();
      await Promise.allSettled([...legacyRequests]); updateSyncUI();
    },
    timestamps: () => ({ ...Object.fromEntries(Object.entries(oldMeta().updated || {}).map(([k, v]) => ['card:' + k, v])), ...timestamps(cards) }),
    tombstones: () => Object.fromEntries(Object.entries(oldMeta().deleted || {}).map(([k, v]) => ['card:' + k, v])),
    toCloudValue: async (k, v) => v,
    legacy: [{ file: 'word-flashcards-sync-v2.json', convert: async raw => {
      if (raw.schema !== 'word-flashcards-drive-sync-v2' || !Array.isArray(raw.cards)) throw new Error('旧単語同期ファイルの形式を確認できません。');
      const list = raw.cards.map(c => ({ ...c }));
      const known = new Map(cards.map(c => [c.word + '\u0000' + c.meaning, c.id]));
      for (const c of list) if (!c.id) c.id = known.get(c.word + '\u0000' + c.meaning) || 'legacy-' + await F.digest(c.word + '\u0000' + c.meaning);
      return { data: values(list), timestamps: { ...timestamps(list), ...Object.fromEntries(Object.entries(raw.updated || {}).map(([k, v]) => ['card:' + k, v])) }, deleted: Object.fromEntries(Object.entries(raw.deleted || {}).map(([k, v]) => ['card:' + k, v])) };
    } }],
    migrate: async (api, view) => (await networkRecovery()).prepare(api, view, await read()),
    prepareApply: async view => Object.entries(view.data).filter(([k]) => k.startsWith('card:')).map(([, c]) => c).sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)),
    apply: list => {
      const id = cards[currentIndex()]?.id, back = !!stage.querySelector('.show-back'), shuffled = isShuffled, oldOrder = order.map(i => cards[i]?.id);
      cards = list; saveCards();
      if (shuffled) { order = oldOrder.map(k => cards.findIndex(c => c.id === k)).filter(i => i >= 0); for (let i = 0; i < cards.length; i++) if (!order.includes(i)) order.push(i); isShuffled = true; }
      else rebuildOrder();
      const at = order.findIndex(i => cards[i]?.id === id); if (at >= 0) pos = at;
      render(); if (back) stage.querySelector('.card')?.classList.add('show-back'); updateSyncUI();
    },
    afterSync: async view => (await networkRecovery()).verifyApplied(view, await read())
  };
  const sync = F.install(cfg); window.WordDriveSync = sync;
  window.WordNetworkBuild = '20261028-network2';
  const originalSave = saveCards;
  saveCards = function () { for (const c of cards) if (!c.id) c.id = crypto.randomUUID(); const out = originalSave(); sync.changed(); return out; };
  const toolbar = document.querySelector('.topbar') || document.body;
  const build = document.createElement('p'); build.id = 'wordNetworkBuild'; build.textContent = 'ネット同期 修正版2'; build.style.cssText = 'width:100%;margin:4px 0;font-size:13px'; toolbar.appendChild(build);
  const online = document.createElement('button'); online.type = 'button'; online.className = 'btn';
  online.id = 'wordNetworkSync'; online.textContent = 'ネット経由で単語を同期';
  online.onclick = async () => {
    if (!sync.valid()) { sync.open(); return; }
    online.disabled = true;
    try { await sync.sync(); } catch (_) { /* Status retains the actual failure. */ }
    finally { online.disabled = false; window.WordDriveRecovery?.refresh(); }
  };
  toolbar.appendChild(online);
  const recoveryScript = document.createElement('script');
  recoveryScript.src = './word-recovery.js?v=20261028-network2';
  recoveryScript.onerror = () => { const p = document.createElement('p'); p.setAttribute('role','alert'); p.textContent = '件数表示を読み込めません。「Google Drive同期」でエラー内容を確認できます。'; toolbar.appendChild(p); };
  document.head.appendChild(recoveryScript);
})();
