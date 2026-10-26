/* 1000色カード：由来の手動編集。研究本文・確認状態・写真は変更しません。 */
(function () {
  'use strict';
  if (window.ColorOriginEditor) return;
  const STORE_KEY = 'manual_origin_edits_v1';
  const SCHEMA = 'colors1000-origin-edits-v1';
  const MAX_TEXT = 20000, MAX_HISTORY = 30;
  const nativeRenderBack = renderBack;
  const nativeExport = makeProgressExport;
  const nativeImport = importData;
  const cardsById = new Map(CARD_IDS.map((id, i) => [id, { ...CARDS[i], index: i }]));
  const signature = sha256Fallback(new TextEncoder().encode(JSON.stringify(CARD_IDS.map((id, i) => [id, CARDS[i].name, CARDS[i].hex]))));
  let records = {}, loaded = false, memoryOnly = false, unsavedMemory = false;
  let activeId = null, initialText = '', busy = false, dialog = null, opener = null;
  const clone = x => JSON.parse(JSON.stringify(x));
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const isObject = x => x && typeof x === 'object' && !Array.isArray(x);
  const uuid = () => window.crypto?.randomUUID?.() || ('oe-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2));
  const originalText = id => String(RESEARCH_DATA[cardsById.get(id).name]?.origin_display_text || '');
  const valueText = id => records[id]?.mode === 'manual' ? records[id].text : originalText(id);
  const notify = message => { toast(message); };

  function snapshot(r) {
    return { text: r.text, mode: r.mode, revision_id: r.revision_id, updated_at: r.updated_at,
      base_text_snapshot: r.base_text_snapshot || '' };
  }
  function validateSnapshot(v) {
    if (!isObject(v) || !['manual', 'original'].includes(v.mode) || typeof v.text !== 'string' || v.text.length > MAX_TEXT)
      throw new Error('由来編集のデータ形式が正しくありません。');
    if (typeof v.base_text_snapshot !== 'string' && v.base_text_snapshot != null)
      throw new Error('元の由来の記録が正しくありません。');
    if (String(v.base_text_snapshot || '').length > MAX_TEXT)
      throw new Error('由来の記録が長すぎます。');
    return { mode: v.mode, text: v.text.replace(/\r\n?/g, '\n'),
      revision_id: String(v.revision_id || '').slice(0, 180), updated_at: String(v.updated_at || '').slice(0, 80),
      base_text_snapshot: String(v.base_text_snapshot || '') };
  }
  function validateRecords(input) {
    if (!isObject(input) || Object.keys(input).length > CARDS.length)
      throw new Error('由来編集のデータ形式が正しくありません。');
    const out = {};
    for (const [id, v] of Object.entries(input)) {
      const c = cardsById.get(id);
      if (!c || !isObject(v) || v.card_id !== id || v.name !== c.name || String(v.hex).toUpperCase() !== c.hex)
        throw new Error('由来編集の色ID・色名・HEXが、このカードと一致しません。');
      const s = validateSnapshot(v);
      if (!Array.isArray(v.history || [])) throw new Error('由来の編集履歴が正しくありません。');
      out[id] = { card_id: id, name: c.name, hex: c.hex, ...s,
        source: 'user_edit', verification_status: 'not_independently_verified',
        history: (v.history || []).slice(-MAX_HISTORY).map(validateSnapshot) };
    }
    return out;
  }
  function sameValue(a, b) { return a.mode === b.mode && (a.mode === 'original' || a.text === b.text); }
  function mergeRecords(current, incoming, preferIncoming) {
    const out = clone(current);
    for (const [id, value] of Object.entries(incoming)) {
      const previous = out[id];
      if (!previous) { out[id] = clone(value); continue; }
      if (previous.revision_id && previous.revision_id === value.revision_id && sameValue(previous, value)) continue;
      const takeIncoming = preferIncoming;
      const chosen = clone(takeIncoming ? value : previous);
      const other = takeIncoming ? previous : value;
      const history = [...(other.history || []), ...(chosen.history || []), snapshot(other)];
      const unique = new Map();
      for (const item of history) {
        const key = item.revision_id || JSON.stringify([item.mode, item.text, item.updated_at]);
        if (key !== chosen.revision_id) unique.set(key, item);
      }
      chosen.history = [...unique.values()].slice(-MAX_HISTORY);
      out[id] = chosen;
    }
    return out;
  }
  function readStore() {
    return new Promise((resolve, reject) => {
      if (!imageDb) { resolve(null); return; }
      const tx = imageDb.transaction('state', 'readonly'), request = tx.objectStore('state').get(STORE_KEY);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  function storeEnvelope() {
    return { schema: SCHEMA, dataset_signature: signature, updated_at: new Date().toISOString(), manual_origin_edits: clone(records) };
  }
  function updateStorageMessage() {
    const el = document.getElementById('originEditorStorageNotice');
    if (el) { el.hidden = !memoryOnly; el.textContent = '由来の端末保存を利用できません。「由来だけを保存」または「進捗JSONを保存」で保管してください。'; }
  }
  async function persist() {
    if (!imageDb) { memoryOnly = true; unsavedMemory = true; updateStorageMessage(); return false; }
    try {
      await new Promise((resolve, reject) => {
        const tx = imageDb.transaction('state', 'readwrite');
        tx.objectStore('state').put(storeEnvelope(), STORE_KEY);
        tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
      });
      memoryOnly = false; unsavedMemory = false; updateStorageMessage(); document.dispatchEvent(new CustomEvent("colors-origin-changed")); return true;
    } catch (_) { memoryOnly = true; unsavedMemory = true; updateStorageMessage(); return false; }
  }
  function originMarkup(index) {
    const id = CARD_IDS[index], text = valueText(id);
    return '<div class="oe-heading"><h3>名前の由来</h3><button type="button" class="oe-edit" data-origin-edit="' + id + '"' + (loaded ? '' : ' disabled') + '>由来を編集</button></div>' +
      (text ? '<p class="oe-body">' + escapeHtml(text) + '</p>' : '');
  }
  renderBack = function (c, index) {
    nativeRenderBack(c, index);
    if (!state.flipped) return;
    const section = document.querySelector('#back .origin-copy');
    if (!section) return;
    section.innerHTML = originMarkup(index);
    section.addEventListener('click', event => event.stopPropagation());
    section.querySelector('[data-origin-edit]')?.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation(); openEditor(CARD_IDS[index]);
    });
  };
  makeProgressExport = function (includeEdits = true) {
    const out = nativeExport(includeEdits);
    if (includeEdits) {
      out.manual_origin_edits = clone(records);
      out.origin_editor = { schema: SCHEMA, dataset_signature: signature,
        display_rule: 'manual_origin_edits[id].mode===manual の場合のみ手動本文を表示。それ以外はresearch.origin_display_text。',
        research_records_unchanged: true, edited_card_count: Object.values(records).filter(r => r.mode === 'manual').length,
        note: '手動編集は調査確認済みではない。研究本文・根拠・確認状態・調査キューは別に保持。' };
    }
    return out;
  };
  function validateImportEnvelope(data) {
    if (!isObject(data)) throw new Error('JSONの形式が正しくありません。');
    if (data.schema === SCHEMA) {
      if (data.dataset_signature !== signature) throw new Error('別の色データ用の由来編集JSONです。');
    } else {
      if (!Array.isArray(data.cards) || data.cards.length !== CARDS.length) throw new Error('対応する進捗JSONまたは由来編集JSONを選んでください。');
      const seen = new Set();
      for (const card of data.cards) {
        const c = cardsById.get(card.id);
        if (!c || seen.has(card.id) || card.name !== c.name || String(card.hex).toUpperCase() !== c.hex || !isObject(card.research))
          throw new Error('進捗JSONの色データが一致しません。');
        seen.add(card.id);
      }
      if (data.origin_editor?.dataset_signature && data.origin_editor.dataset_signature !== signature)
        throw new Error('由来編集の色データが一致しません。');
    }
    return has(data, 'manual_origin_edits') ? validateRecords(data.manual_origin_edits) : {};
  }
  importData = async function (data) {
    await ready;
    const incoming = validateImportEnvelope(data);
    const conflicts = Object.keys(incoming).filter(id => records[id] && !sameValue(records[id], incoming[id]));
    if (conflicts.length && !window.confirm(conflicts.length + '色の由来が、現在の手動編集と異なります。読み込む文章に切り替えますか？\n現在の文章も「1つ前に戻す」の履歴に残します。取消なら何も読み込みません。'))
      throw new Error('読み込みを取り消しました。現在の編集はそのままです。');
    const merged = mergeRecords(records, incoming, true);
    if (data.schema !== SCHEMA) await nativeImport(data);
    records = merged;
    const ok = await persist(); render();
    notify(ok ? '由来の編集を読み込みました。元の調査記録も保持しています。' : '読み込みましたが端末保存できません。JSONを保存して保管してください。');
  };
  function downloadJson(data, name) {
    const a = document.createElement('a'), url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const dateTag = () => new Date().toISOString().replace(/[:.]/g, '-');
  async function exportOrigins() {
    await ready;
    downloadJson(storeEnvelope(), 'colors1000_origin_edits_' + dateTag() + '.json');
  }
  async function exportAll() {
    await ready; await readyImages;
    downloadJson(makeProgressExport(true), 'colors1000_review45_with_edits_' + dateTag() + '.json');
  }
  function dirty() { return activeId && document.getElementById('originEditorText').value !== initialText; }
  function closeEditor(force = false) {
    if (busy) return;
    if (!force && dirty() && !window.confirm('保存していない変更を取り消しますか？')) return;
    if (dialog?.open && typeof dialog.close === 'function') dialog.close();
    else if (dialog) { dialog.removeAttribute('open'); dialog.hidden = true; }
    activeId = null;
    if (opener?.isConnected) opener.focus();
  }
  function fillEditor() {
    const c = cardsById.get(activeId), r = records[activeId];
    document.getElementById('originEditorTitle').textContent = c.name + ' — 名前の由来を編集';
    const field = document.getElementById('originEditorText');
    field.value = valueText(activeId); initialText = field.value;
    document.getElementById('originEditorOriginal').textContent = originalText(activeId) || 'このカードの元の由来文は空欄です。';
    document.getElementById('originEditorUndo').disabled = !r?.history?.length;
    document.getElementById('originEditorRestore').disabled = !r || r.mode !== 'manual';
    document.getElementById('originEditorCount').textContent = field.value.length + ' / ' + MAX_TEXT + '文字';
  }
  async function openEditor(id) {
    await ready;
    if (!cardsById.has(id)) return;
    activeId = id; opener = document.activeElement; fillEditor();
    dialog.hidden = false;
    if (typeof dialog.showModal === 'function') { if (!dialog.open) dialog.showModal(); }
    else dialog.setAttribute('open', '');
    document.getElementById('originEditorText').focus();
  }
  function setBusy(value) {
    busy = value;
    document.querySelectorAll('#originEditorDialog button').forEach(b => b.disabled = value);
    document.getElementById('originEditorText').readOnly = value;
    if (!value && activeId) {
      document.getElementById('originEditorUndo').disabled = !records[activeId]?.history?.length;
      document.getElementById('originEditorRestore').disabled = records[activeId]?.mode !== 'manual';
    }
  }
  async function commit(id, text, mode, historyOverride) {
    await ready;
    if (!cardsById.has(id) || typeof text !== 'string' || text.length > MAX_TEXT || !['manual', 'original'].includes(mode)) throw new Error('由来の入力内容が正しくありません。');
    const c = cardsById.get(id), previous = records[id];
    const history = historyOverride || [...(previous?.history || []), ...(previous ? [snapshot(previous)] : [])];
    records[id] = { card_id: id, name: c.name, hex: c.hex, text: text.replace(/\r\n?/g, '\n'), mode,
      revision_id: uuid(), updated_at: new Date().toISOString(), base_text_snapshot: originalText(id),
      source: 'user_edit', verification_status: 'not_independently_verified', history: history.slice(-MAX_HISTORY) };
    const ok = await persist(); render(); return ok;
  }
  async function saveCurrent() {
    if (!activeId || busy) return;
    const text = document.getElementById('originEditorText').value.replace(/\r\n?/g, '\n');
    if (text.length > MAX_TEXT) { notify('由来は' + MAX_TEXT + '文字以内にしてください。'); return; }
    if (!text.trim() && !window.confirm('由来を空欄として保存しますか？元の調査文は残り、後で戻せます。')) return;
    setBusy(true);
    try {
      const ok = await commit(activeId, text, 'manual'); initialText = text;
      setBusy(false); closeEditor(true);
      notify(ok ? '由来を保存しました。引き継ぎには進捗JSONも保存してください。' : '表示は変更しましたが端末保存できません。閉じる前にJSONを保存してください。');
    } catch (e) { setBusy(false); notify(e.message || '保存できませんでした。'); }
  }
  async function restoreCurrent() {
    if (!activeId || busy || !window.confirm('この色の表示を元の調査文に戻しますか？現在の編集は履歴に残します。')) return;
    setBusy(true);
    try {
      const ok = await commit(activeId, '', 'original'); fillEditor(); setBusy(false); closeEditor(true);
      notify(ok ? '元の調査文に戻しました。' : '元に戻しました。端末保存できないためJSONを保存してください。');
    } catch (e) { setBusy(false); notify(e.message); }
  }
  async function undoCurrent() {
    if (!activeId || busy) return;
    const history = records[activeId]?.history || [];
    if (!history.length) return;
    if (dirty() && !window.confirm('入力中の変更を取り消して、1つ前の保存内容に戻しますか？')) return;
    const prev = history[history.length - 1]; setBusy(true);
    try {
      const ok = await commit(activeId, prev.text, prev.mode, history.slice(0, -1));
      fillEditor(); setBusy(false);
      notify(ok ? '1つ前の保存内容に戻しました。' : '戻しました。端末保存できないためJSONを保存してください。');
    } catch (e) { setBusy(false); notify(e.message); }
  }
  function installUI() {
    const style = document.createElement('style');
    style.textContent = '.oe-heading{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.oe-heading h3{margin:0}.oe-edit{font:inherit;font-size:12px;border:1px solid #d4d8df;border-radius:7px;padding:6px 10px;background:#fff;color:#445368;cursor:pointer;white-space:nowrap}.oe-edit:hover{background:#f2f5f9}.oe-body{white-space:pre-wrap;overflow-wrap:anywhere}.oe-dialog{box-sizing:border-box;border:1px solid #d5dbe3;border-radius:16px;padding:22px;width:min(720px,94vw);max-height:90vh;overflow:auto;color:#1f2023;background:#fff;box-shadow:0 18px 70px #0004}.oe-dialog::backdrop{background:#18233388}.oe-dialog:not([open]){display:none}.oe-dialog h2{font-size:20px;line-height:1.5;margin:0 0 8px}.oe-dialog label{display:block;font-size:14px;font-weight:700;margin:14px 0 8px}.oe-dialog textarea{font:inherit;font-size:15px;line-height:1.8;width:100%;min-height:220px;resize:vertical;padding:12px;border:1px solid #bfc9d8;border-radius:9px;box-sizing:border-box}.oe-dialog textarea:focus{outline:2px solid #607ea4;outline-offset:1px}.oe-dialog .oe-help{font-size:12px;line-height:1.75;color:#666;margin:0 0 10px}.oe-dialog .oe-count{font-size:11px;text-align:right;margin:4px 0 10px;color:#777}.oe-dialog details{font-size:12px;background:#f7f8fa;padding:10px;border-radius:8px;margin-bottom:16px}.oe-dialog summary{cursor:pointer}.oe-original{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}.oe-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.oe-actions .oe-save{margin-left:auto}.oe-storage{display:block;color:#9a3e15;font-size:12px;line-height:1.7;padding:8px 0}.oe-storage[hidden]{display:none}@media(max-width:650px){.oe-dialog{padding:16px}.oe-dialog h2{font-size:17px}.oe-dialog textarea{min-height:190px}.oe-actions .btn{font-size:12px}.oe-edit{font-size:11px}}';
    document.head.appendChild(style);
    dialog = document.createElement('dialog'); dialog.id = 'originEditorDialog'; dialog.className = 'oe-dialog';
    dialog.setAttribute('aria-labelledby', 'originEditorTitle');
    dialog.innerHTML = '<h2 id="originEditorTitle">名前の由来を編集</h2><p class="oe-help">入力した文章をカードに表示します。元の調査文・根拠は変更せず残します。手動編集によって調査の確認状態が変わることはありません。</p><label for="originEditorText">由来の本文</label><textarea id="originEditorText" maxlength="20000" placeholder="ここに由来の説明を入力できます。"></textarea><p id="originEditorCount" class="oe-count"></p><details><summary>元の調査文を見る</summary><p id="originEditorOriginal" class="oe-original"></p></details><div class="oe-actions"><button type="button" class="btn" id="originEditorRestore">元の調査文に戻す</button><button type="button" class="btn" id="originEditorUndo">1つ前に戻す</button></div><div class="oe-actions"><button type="button" class="btn" id="originEditorCancel">取消</button><button type="button" class="btn primary oe-save" id="originEditorSave">保存</button></div><p class="oe-help" style="margin-top:14px">保存先はこのブラウザです。別のWork・端末へ渡す際は、画面上部の「進捗JSONを保存」で写真と由来の編集をまとめて持ち出してください。Ctrl／⌘＋Enterでも保存できます。</p>';
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', e => { e.preventDefault(); closeEditor(); });
    dialog.addEventListener('keydown', e => {
      e.stopPropagation();
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); saveCurrent(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeEditor(); }
    });
    document.getElementById('originEditorSave').onclick = saveCurrent;
    document.getElementById('originEditorCancel').onclick = () => closeEditor();
    document.getElementById('originEditorRestore').onclick = restoreCurrent;
    document.getElementById('originEditorUndo').onclick = undoCurrent;
    document.getElementById('originEditorText').oninput = e => { document.getElementById('originEditorCount').textContent = e.target.value.length + ' / ' + MAX_TEXT + '文字'; };
    const toolbar = document.querySelector('.toolbar .controls');
    const exportButton = document.createElement('button'); exportButton.type = 'button'; exportButton.className = 'btn'; exportButton.id = 'exportOriginEdits'; exportButton.textContent = '由来だけを保存'; exportButton.disabled = true;
    exportButton.onclick = () => exportOrigins().catch(e => notify(e.message)); toolbar.appendChild(exportButton);
    const importButton = document.createElement('button'); importButton.type = 'button'; importButton.className = 'btn'; importButton.id = 'importOriginEdits'; importButton.textContent = '由来だけを読込'; importButton.disabled = true;
    importButton.onclick = () => document.getElementById('originEditsFile').click(); toolbar.appendChild(importButton);
    const input = document.createElement('input'); input.id = 'originEditsFile'; input.type = 'file'; input.accept = '.json,application/json'; input.hidden = true;
    input.onchange = async () => {
      const file = input.files[0]; input.value = ''; if (!file) return;
      try {
        if (file.size > 100 * 1024 * 1024) throw new Error('由来専用JSONが大きすぎます。写真入りの進捗JSONは「進捗JSONを読込」を使ってください。');
        const data = JSON.parse(await file.text());
        if (data.schema !== SCHEMA) throw new Error('「由来だけを保存」で書き出したJSONを選んでください。');
        await importData(data);
      } catch (e) { notify(e.message || '由来JSONを読み込めません。'); }
    };
    document.body.appendChild(input);
    const notice = document.createElement('p'); notice.id = 'originEditorStorageNotice'; notice.className = 'oe-storage'; notice.hidden = true; notice.setAttribute('role', 'status');
    document.querySelector('.toolbar').appendChild(notice);
    document.getElementById('exportResearch').onclick = () => exportAll().catch(e => notify(e.message));
    const hint = document.querySelector('p.notice');
    if (hint) hint.textContent = '写真と由来を編集できます。編集後は「進捗JSONを保存」で、写真・由来の編集・学習記録をまとめて持ち出せます。由来の文章だけなら「由来だけを保存」も使えます。元のZIPは自動では書き換わりません。';
    window.addEventListener('beforeunload', e => { if (dirty() || unsavedMemory) { e.preventDefault(); e.returnValue = ''; } });
  }
  installUI();
  const ready = (async () => {
    try {
      await readyImages;
      const embedded = nativeExport(false);
      if (has(embedded, 'manual_origin_edits')) records = validateRecords(embedded.manual_origin_edits);
      const stored = await readStore();
      if (stored) {
        if (stored.schema !== SCHEMA || stored.dataset_signature !== signature) throw new Error('保存済みの由来編集を確認できません。JSONバックアップから読み込んでください。');
        // 同じブラウザでの編集を表示優先。埋め込み側の異なる文章も履歴に保管する。
        records = mergeRecords(records, validateRecords(stored.manual_origin_edits), true);
      }
      memoryOnly = !imageDb;
    } catch (e) { memoryOnly = true; notify(e.message || '由来編集の端末保存を確認できません。'); }
    loaded = true;
    document.getElementById('exportOriginEdits').disabled = false;
    document.getElementById('importOriginEdits').disabled = false;
    updateStorageMessage(); render();
  })();
  async function mergeCloudRecords(input) {
    await ready;
    const incoming = validateRecords(input || {}), next = clone(records);
    for (const [id, value] of Object.entries(incoming)) {
      const current = next[id];
      if (!current) { next[id] = clone(value); continue; }
      const preferIncoming = String(value.updated_at || '') > String(current.updated_at || '');
      const merged = mergeRecords({ [id]: current }, { [id]: value }, preferIncoming);
      next[id] = merged[id];
    }
    records = next;
    const ok = await persist(); render();
    return { ok, manual_origin_edits: clone(records) };
  }
  function applyCloudRecords(input) {
    const incoming = validateRecords(input || {}), merged = mergeRecords(records, incoming, true);
    records = Object.fromEntries(Object.keys(incoming).map(id => [id, merged[id]]));
    render(); return persist().then(ok => {if(!ok)throw new Error('由来編集の端末保存に失敗しました。');});
  }
  window.ColorOriginEditor = Object.freeze({ applyCloudRecords, ready, open: openEditor, text: valueText,
    exportData: () => storeEnvelope(), renderMarkup: originMarkup, getRecords: () => clone(records),
    validateRecords, mergeRecords, commit, restore: async id => commit(id, '', 'original'),
    importData: data => importData(data), mergeCloudRecords, exportOrigins, schema: SCHEMA, datasetSignature: signature });
})();
