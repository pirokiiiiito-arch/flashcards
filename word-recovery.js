/* Private user-selected recovery. No vocabulary data or credentials in this file. */
(function (root) {
  'use strict';
  const SCHEMA = 'word-flashcards-recovery-v1';
  const textKey = c => JSON.stringify([c.word, c.meaning]);
  function validate(raw) {
    if (!raw || raw.schema !== SCHEMA || !Array.isArray(raw.cards) || raw.cards.length > 10000)
      throw Error('単語帳の救出用JSONを選んでください。');
    if (raw.source_record_count !== raw.cards.length) throw Error('救出ファイルの件数が一致しません。');
    const ids = new Set();
    return raw.cards.map(c => {
      if (!c || typeof c.id !== 'string' || !/^[\w-]{1,128}$/.test(c.id) || ids.has(c.id) ||
          typeof c.word !== 'string' || !c.word.trim() || c.word.length > 10000 ||
          typeof c.meaning !== 'string' || c.meaning.length > 100000 ||
          !Number.isSafeInteger(c.sort_order) || (c.updated_at !== null && typeof c.updated_at !== 'string'))
        throw Error('救出ファイルのカード形式またはIDを確認できません。');
      ids.add(c.id);
      return {id:c.id, word:c.word, meaning:c.meaning, sort_order:c.sort_order, updated_at:c.updated_at};
    });
  }
  function canonical(list) {
    return list.map(c => [c.id,c.word,c.meaning,String(c.sort_order)].join('\x1f') + '\x1e').join('');
  }
  function mergeMissing(current, incoming, deleted = {}) {
    const result = current.slice(), ids = new Map(current.map(c => [c.id,c]));
    const texts = new Set(current.map(textKey));
    let added = 0, kept = 0, conflicts = 0, deletedSkipped = 0;
    const additions = [];
    for (const c of incoming) {
      if (ids.has(c.id)) {
        kept++;
        if (textKey(ids.get(c.id)) !== textKey(c)) conflicts++;
      } else if (Object.prototype.hasOwnProperty.call(deleted, 'card:' + c.id)) {
        deletedSkipped++;
      } else if (texts.has(textKey(c))) {
        kept++;
      } else {
        const next = {...c}; result.push(next); additions.push(next);
        ids.set(c.id,next); texts.add(textKey(c)); added++;
      }
    }
    return {cards:result, additions, added, kept, conflicts, deletedSkipped};
  }
  const tools = Object.freeze({validate, canonical, mergeMissing});
  if (typeof module !== 'undefined' && module.exports) module.exports = tools;
  if (!root.document || !root.WordDriveSync || root.WordDriveRecovery) return;
  const sync = root.WordDriveSync, toolbar = document.querySelector('.topbar');
  const notice = document.createElement('p'); notice.id = 'wordDriveDataStatus'; notice.setAttribute('role','status');
  notice.style.cssText = 'width:100%;margin:8px 0;font-size:14px;line-height:1.6;white-space:pre-wrap';
  const button = document.createElement('button'); button.className = 'btn'; button.type = 'button';
  button.id = 'wordRecoverMissing'; button.textContent = '救出データを追加復元';
  const picker = document.createElement('input'); picker.type = 'file'; picker.accept = '.json,application/json'; picker.hidden = true;
  const output = document.createElement('p'); output.setAttribute('role','status');
  output.style.cssText = notice.style.cssText;
  toolbar.append(button,picker,notice,output);
  function refresh() {
    if (!wordDrivePrimary()) { notice.textContent = ''; return; }
    const status = sync.status(), view = sync.view();
    const remote = Object.keys(view.data || {}).filter(k => k.startsWith('card:')).length;
    const settled = status.status === '同期済み';
    countText.textContent = cards.length + '件（Google Drive：' + status.status + '）';
    notice.textContent = settled && !remote && !cards.length
      ? 'Driveとの接続は成功しましたが、同期先の単語は0件です。元のPCから送信するか「救出データを追加復元」で不足分を読み込んでください。'
      : settled ? '単語データ：この端末 ' + cards.length + '件 ／ Drive履歴 ' + remote + '件'
      : 'この端末の単語：' + cards.length + '件。' + (status.detail || status.status);
    if (settled) {
      for (const b of toolbar.querySelectorAll('button')) {
        if (b.textContent.startsWith('Google Drive同期：')) b.textContent = 'Google Drive同期：同期済み（' + remote + '件）';
      }
      const message = document.querySelector('dialog [data-status]');
      if (message) message.textContent = !remote && !cards.length
        ? 'Driveとの接続は成功しましたが、単語は0件です。単語データの復旧はまだ完了していません。'
        : (status.detail || '同期しました。') + '\n端末 ' + cards.length + '件 ／ Drive履歴 ' + remote + '件';
    }
  }
  root.WordDriveRecovery = Object.freeze({refresh, ...tools});
  const oldRender = render, oldUpdate = updateSyncUI;
  render = function () { const result = oldRender.apply(this,arguments); refresh(); return result; };
  updateSyncUI = function () { const result = oldUpdate.apply(this,arguments); refresh(); return result; };
  // Remove a literal escaped newline accidentally left in the toolbar markup.
  for (const node of [...toolbar.childNodes]) if (node.nodeType === 3 && node.textContent.trim() === '\\n') node.remove();
  button.onclick = () => {
    if (editing) { output.textContent = 'カードの編集を保存してから復元してください。'; return; }
    if (!sync.valid()) { output.textContent = '先にGoogle Driveへ接続し、もう一度「救出データを追加復元」を押してください。'; sync.open(); return; }
    picker.click();
  };
  picker.onchange = async () => {
    const file = picker.files?.[0]; picker.value = ''; if (!file) return;
    button.disabled = true; let committed = false;
    try {
      if (file.size > 10 * 1024 * 1024) throw Error('10MB以下の単語帳救出JSONを選んでください。');
      const raw = JSON.parse(await file.text()), incoming = validate(raw);
      if (!/^[a-f0-9]{64}$/.test(raw.content_sha256 || '') || await sync.digest(canonical(incoming)) !== raw.content_sha256)
        throw Error('救出ファイルの内容の一致を確認できません。元ファイルを保持しています。');
      output.textContent = '現在のDriveデータを確認しています…';
      await sync.ready; await sync.sync();
      if (editing) throw Error('カードの編集中です。保存してから復元してください。');
      root.__WORD_RECOVERY_ACTIVE = true;
      const stamp = new Date().toISOString();
      await sync.cache.put('states','word-flashcards:before-recovery:' + stamp,
        {saved_at:stamp,local:structuredClone(cards),incoming:raw,view:sync.view()});
      if (editing) throw Error('カードの編集中です。保存してから復元してください。');
      const plan = mergeMissing(cards,incoming,sync.view().deleted);
      if (!plan.added) {
        output.textContent = '追加対象は0件です。既存 ' + plan.kept + '件・削除履歴 ' + plan.deletedSkipped + '件を保持しました。';
        return;
      }
      if (!root.confirm('不足する単語' + plan.added + '件を追加復元します。既存' + cards.length + '件は削除・上書きしません。削除履歴のある' + plan.deletedSkipped + '件は復元しません。続けますか？')) {
        output.textContent = '復元を取り消しました。'; return;
      }
      const previous = cards;
      cards = plan.cards;
      try { saveCards(); } catch (e) { cards = previous; throw e; }
      committed = true; rebuildOrder(); render();
      root.__WORD_RECOVERY_ACTIVE = false;
      output.textContent = plan.added + '件を端末に保存しました。Driveへ送信しています…';
      sync.changed(); await sync.sync();
      const remote = sync.view().data;
      if (plan.additions.some(c => !remote['card:' + c.id] || textKey(remote['card:' + c.id]) !== textKey(c)) || sync.status().pending)
        throw Error('Drive上の復元内容がまだ一致しません。救出JSONと端末バックアップは保持しています。');
      output.textContent = '不足' + plan.added + '件の追加復元とDrive同期が完了しました。既存' + plan.kept + '件は保持しました。';
    } catch (e) {
      output.textContent = (committed ? '端末への復元後、Drive同期を完了できませんでした：' : '復元を完了できませんでした：') + (e.message || String(e));
    } finally {
      root.__WORD_RECOVERY_ACTIVE = false; button.disabled = false; refresh();
    }
  };
  refresh();
})(typeof window !== 'undefined' ? window : globalThis);
