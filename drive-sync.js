/* Word-card adapter. Network recovery uses the user's Google Drive identity;
 * the old storage is not changed and no legacy password or file is required. */
(function () {
  'use strict';
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
    if (window.WordNetworkRecovery) return window.WordNetworkRecovery;
    if (!networkLoader) networkLoader = new Promise((resolve,reject) => {
      const s = document.createElement('script'); s.src = './word-network-recovery.js?v=1';
      s.onload = () => window.WordNetworkRecovery ? resolve(window.WordNetworkRecovery) : reject(Error('ネット同期機能を確認できません。'));
      s.onerror = () => { networkLoader = null; reject(Error('ネット同期機能を読み込めません。保存データは保持しています。')); };
      document.head.appendChild(s);
    });
    return networkLoader;
  }
  const cfg = {
    namespace: 'word-flashcards', toolbar: '.topbar', primary: wordDrivePrimary,
    storageKeys: [KEY], reload: () => { if (!editing) { cards = loadCards(); rebuildOrder(); render(); } },
    read, isEditing: () => editing || !!window.__WORD_RECOVERY_ACTIVE,
    onStatus: () => { window.WordDriveRecovery?.refresh(); },
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
    migrate: async (api, view) => {
      const recovery = await networkRecovery();
      return recovery.prepare(api, view, await read());
    },
    prepareApply: async view => Object.entries(view.data).filter(([k]) => k.startsWith('card:')).map(([, c]) => c).sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id)),
    apply: list => {
      const id = cards[currentIndex()]?.id, back = !!stage.querySelector('.show-back'), shuffled = isShuffled, oldOrder = order.map(i => cards[i]?.id);
      cards = list; saveCards();
      if (shuffled) { order = oldOrder.map(k => cards.findIndex(c => c.id === k)).filter(i => i >= 0); for (let i = 0; i < cards.length; i++) if (!order.includes(i)) order.push(i); isShuffled = true; }
      else rebuildOrder();
      const at = order.findIndex(i => cards[i]?.id === id); if (at >= 0) pos = at;
      render(); if (back) stage.querySelector('.card')?.classList.add('show-back'); updateSyncUI();
    }
  };
  const sync = F.install(cfg); window.WordDriveSync = sync;
  const originalSave = saveCards;
  saveCards = function () { for (const c of cards) if (!c.id) c.id = crypto.randomUUID(); const out = originalSave(); sync.changed(); return out; };
  const online = document.createElement('button'); online.type = 'button'; online.className = 'btn';
  online.id = 'wordNetworkSync'; online.textContent = 'ネット経由で単語を同期';
  online.onclick = async () => {
    if (!sync.valid()) { sync.open(); return; }
    online.disabled = true;
    try { await sync.sync(); } catch (_) { /* The Drive dialog/status retains the error. */ }
    finally { online.disabled = false; window.WordDriveRecovery?.refresh(); }
  };
  (document.querySelector('.topbar') || document.body).appendChild(online);
  const recoveryScript = document.createElement('script');
  recoveryScript.src = './word-recovery.js?v=1';
  recoveryScript.onerror = () => {
    const p = document.createElement('p'); p.setAttribute('role','alert');
    p.textContent = '件数表示を読み込めません。「Google Drive同期」からネット経由で単語を同期できます。';
    (document.querySelector('.topbar') || document.body).appendChild(p);
  };
  document.head.appendChild(recoveryScript);
})();
