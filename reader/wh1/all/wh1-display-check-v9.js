/* Diagnostic entry only: observe parent/child loading without changing layout,
 * book payloads, font settings, storage or reading position. */
'use strict';
(() => {
  const BUILD = 'display-check-v9-1-20261110';
  const EXPECTED = 'figure-viewport-v9-20261110';
  const PROBE_ID = 'wh1-display-check-probe9-1';
  if (window.WH1DisplayCheck?.revision === BUILD) return;
  const original = window.WH1ExactPager;
  const revision = value => typeof value === 'string' && /^figure-viewport-v\d+-\d{8}$/.test(value) ? value : null;
  const integer = (value, max = 10000) => Number.isInteger(value) && value >= 0 && value <= max ? value : null;
  const reasons = {
    'awaiting-child': '書籍画面からの応答は未確認',
    'applied': '書籍画面で表示修正9の適用を確認',
    'outside-range': '書籍画面の対象範囲が11〜30枚目と異なります',
    'missing-blocks': '書籍画面の構成を確認できません',
    'missing-renderer': '必要な表示処理を確認できません',
    'missing-stage': '書籍画面の表示領域を確認できません',
    'not-installed': '書籍画面で表示修正9は未適用',
    'installation-incomplete': '書籍画面への適用完了を確認できません',
    'different-revision': '書籍画面の表示修正の版が一致しません',
    'probe-error': '書籍画面の確認処理を完了できません',
    'parent-module-unverified': 'アプリ側の表示修正機能は未確認',
    'parent-decoration-error': 'アプリ側で書籍画面の準備を完了できません'
  };
  let token = '', generation = 0;
  let state = {build: BUILD, parentRevision: revision(window.WH1FigureViewportRevision),
    childRevision: null, childStatus: 'unverified', guard: 'awaiting-child',
    scan: null, firstScan: null, lastScan: null, blocksCount: null,
    boundsCheck: 'unverified', paintVerified: false};
  const ui = {};
  const node = (tag, id, text) => {
    const element = document.createElement(tag);
    if (id) element.id = id;
    if (text) element.textContent = text;
    return element;
  };
  function render() {
    state.parentRevision = revision(window.WH1FigureViewportRevision);
    if (!ui.button) return;
    const parent = state.parentRevision?.match(/-v(\d+)-/)?.[1] || '未確認';
    const child = {applied: '適用', 'not-applied': '未適用', unverified: '未確認'}[state.childStatus];
    ui.button.textContent = '確認9.1 · 読込' + parent + ' · 図版' + child;
    ui.parent.textContent = state.parentRevision || '未確認';
    ui.child.textContent = state.childRevision || '未確認';
    ui.guard.textContent = reasons[state.guard];
    ui.scan.textContent = state.scan ? String(state.scan) + '枚目' : '未確認';
    ui.bounds.textContent = {inside: '計測した枠内', outside: '計測した枠外', unverified: '未確認'}[state.boundsCheck];
  }
  function createUI() {
    if (ui.button || !document.body) return;
    const style = node('style', 'wh1-display-check-style');
    style.textContent = '#wh1-display-check-button{position:fixed;z-index:23;right:7px;top:calc(3px + env(safe-area-inset-top,0px));border:1px solid #a9bcb5;border-radius:6px;background:#fff;color:#24423d;padding:3px 6px;font:10.5px/1.3 -apple-system,BlinkMacSystemFont,sans-serif;white-space:nowrap;cursor:pointer}' +
      '#wh1-display-check-panel{position:fixed;z-index:26;top:calc(34px + env(safe-area-inset-top,0px));right:8px;width:min(390px,calc(100% - 16px));max-height:calc(100dvh - 54px);overflow:auto;box-sizing:border-box;border:1px solid #bac9c1;border-radius:10px;padding:14px;background:#fff;color:#233b36;box-shadow:0 5px 24px #0002;font:13px/1.6 -apple-system,BlinkMacSystemFont,sans-serif}' +
      '#wh1-display-check-panel[hidden]{display:none!important}#wh1-display-check-panel h2{font-size:15px;margin:0 0 10px}#wh1-display-check-panel dl{margin:0}#wh1-display-check-panel dt{font-weight:650;margin-top:9px}#wh1-display-check-panel dd{margin:0;overflow-wrap:anywhere}#wh1-display-check-panel p{font:inherit;color:inherit;margin:12px 0}#wh1-display-check-close{float:right;border:1px solid #bac9c1;border-radius:5px;padding:3px 8px;background:white;color:inherit;font:inherit}';
    document.head.append(style);
    ui.button = node('button', 'wh1-display-check-button');
    ui.button.type = 'button';
    ui.button.setAttribute('aria-expanded', 'false');
    ui.button.setAttribute('aria-controls', 'wh1-display-check-panel');
    ui.panel = node('section', 'wh1-display-check-panel');
    ui.panel.hidden = true;
    ui.panel.setAttribute('role', 'dialog');
    ui.panel.setAttribute('aria-label', '確認9.1 読み込み状態');
    const close = node('button', 'wh1-display-check-close', '閉じる');
    close.type = 'button';
    ui.panel.append(close, node('h2', '', '確認9.1｜読み込み状態'));
    const list = node('dl');
    for (const [key, label, value] of [
      ['build', '確認ページ', BUILD], ['parent', 'アプリ側で読み込んだ修正', '未確認'],
      ['child', '書籍画面に適用された修正', '未確認'], ['guard', '書籍画面への適用', '未確認'],
      ['scan', '現在の原本', '未確認'], ['bounds', '表示枠の座標確認', '未確認']
    ]) {
      ui[key] = node('dd', 'wh1-display-check-' + key, value);
      list.append(node('dt', '', label), ui[key]);
    }
    ui.panel.append(list, node('p', '', '読み込みと座標の確認です。表示の切れが直ったことや、iPhoneでの見た目の合格を示すものではありません。'));
    const toggle = open => {ui.panel.hidden = !open; ui.button.setAttribute('aria-expanded', String(open));};
    ui.button.addEventListener('click', () => toggle(ui.panel.hidden));
    close.addEventListener('click', () => {toggle(false); ui.button.focus();});
    document.body.append(ui.button, ui.panel);
    render();
    // The dedicated HTML supplies a static marker for script-load failures.
    // Hide it only after this module has created and populated the real UI.
    const fallback = document.getElementById('wh1-display-check-fallback');
    if (fallback) fallback.hidden = true;
  }

  // This runs in the visible child only. It reads metadata and numeric bounds,
  // never modifies the child DOM, and never sends book prose or image data.
  function childProbe(currentToken) {
    const expected = 'figure-viewport-v9-20261110';
    const version = value => typeof value === 'string' && /^figure-viewport-v\d+-\d{8}$/.test(value) ? value : null;
    function report() {
      const out = {wh1DisplayCheck: 1, type: 'report', token: currentToken,
        childRevision: null, guard: 'probe-error', scan: null, firstScan: null, lastScan: null,
        blocksCount: null, boundsCheck: 'unverified'};
      try {
        const data = typeof blocks !== 'undefined' && Array.isArray(blocks) ? blocks : null;
        out.blocksCount = data?.length ?? null;
        out.firstScan = data ? Number(data[0]?.scan) : null;
        out.lastScan = data ? Number(data[data.length - 1]?.scan) : null;
        out.childRevision = version(window.__WH1_FIGURE_VIEWPORT_V9__) || version(window.__WH1_FIGURE_VIEWPORT_V8__);
        const hasRenderer = typeof makeIllustration === 'function' && typeof showPage === 'function';
        const hasStage = !!document.getElementById('reader-page');
        const hasBadge = !!document.getElementById('wh1-display-revision9');
        if (out.childRevision === expected) out.guard = hasBadge ? 'applied' : 'installation-incomplete';
        else if (out.childRevision) out.guard = 'different-revision';
        else if (!data) out.guard = 'missing-blocks';
        else if (out.firstScan !== 11 || out.lastScan !== 30) out.guard = 'outside-range';
        else if (!hasRenderer) out.guard = 'missing-renderer';
        else if (!hasStage) out.guard = 'missing-stage';
        else out.guard = 'not-installed';
        const page = typeof pages !== 'undefined' && Array.isArray(pages) && typeof currentPage === 'number' ? pages[currentPage] : null;
        const block = page?.parts?.[0]?.block;
        const scan = Number(page?.scan ?? (Number.isInteger(block) ? data?.[block]?.scan : null));
        if (Number.isInteger(scan) && scan >= 1 && scan <= 274) out.scan = scan;
        const status = window.__WH1_VIEWPORT9_STATUS__;
        if (out.guard === 'applied' && page?.type === 'illustration' && [18, 22].includes(out.scan) &&
            status?.revision === expected && status.scan === out.scan &&
            ['inside', 'outside', 'unverified'].includes(status.boundsCheck)) out.boundsCheck = status.boundsCheck;
      } catch (_) {out.guard = 'probe-error';}
      window.parent.postMessage(out, '*');
    }
    window.addEventListener('message', event => {
      const data = event.data;
      if (event.source === window.parent && data?.wh1DisplayCheck === 1 &&
          data.action === 'probe' && data.token === currentToken) report();
    });
    report();
  }

  function requestProbe() {
    if (token) document.getElementById('reader')?.contentWindow?.postMessage({wh1DisplayCheck: 1, action: 'probe', token}, '*');
  }
  window.addEventListener('message', event => {
    const reader = document.getElementById('reader');
    if (!reader || event.source !== reader.contentWindow) return;
    const data = event.data;
    if (data?.wh1DisplayCheck === 1 && data.type === 'report') {
      if (!token || data.token !== token || !Object.prototype.hasOwnProperty.call(reasons, data.guard)) return;
      const childRevision = revision(data.childRevision);
      const guard = data.guard === 'applied' && childRevision !== EXPECTED ? 'different-revision' : data.guard;
      const applied = guard === 'applied' && childRevision === EXPECTED;
      state = {...state, childRevision, guard,
        childStatus: applied ? 'applied' : ['not-installed', 'outside-range', 'missing-blocks', 'missing-renderer', 'missing-stage'].includes(guard) ? 'not-applied' : 'unverified',
        scan: integer(data.scan, 274), firstScan: integer(data.firstScan), lastScan: integer(data.lastScan), blocksCount: integer(data.blocksCount),
        boundsCheck: applied && ['inside', 'outside', 'unverified'].includes(data.boundsCheck) ? data.boundsCheck : 'unverified',
        paintVerified: false};
      render();
    } else if (data?.wh1bridge === 1 && ['state', 'wh1ViewportVersion'].includes(data.type)) {
      // Existing messages lack our navigation token. Use them only to ask the
      // current child for a fresh tokened report, never as proof of application.
      requestProbe();
    }
  });

  if (original?.decorate) {
    window.WH1ExactPager = {...original, decorate(html) {
      let decorated;
      try {decorated = original.decorate(html);} catch (error) {
        state.guard = 'parent-decoration-error'; state.childStatus = 'unverified'; render(); throw error;
      }
      token = 'check9-1-' + Date.now().toString(36) + '-' + (++generation).toString(36);
      state = {...state, childRevision: null, childStatus: 'unverified', guard: 'awaiting-child',
        scan: null, firstScan: null, lastScan: null, blocksCount: null, boundsCheck: 'unverified'};
      render();
      const probe = '<script id="' + PROBE_ID + '">(' + childProbe.toString() + ')(' + JSON.stringify(token) + ');<\/script>';
      const clean = decorated.replace(/<script id="wh1-display-check-probe9-1">[\s\S]*?<\/script>/g, '');
      return /<\/body\s*>/i.test(clean) ? clean.replace(/<\/body\s*>/i, match => probe + match) : clean + probe;
    }};
  } else state.guard = 'parent-module-unverified';
  window.WH1DisplayCheck = {revision: BUILD, getState: () => JSON.parse(JSON.stringify(state))};
  if (document.body) createUI(); else document.addEventListener('DOMContentLoaded', createUI, {once: true});
})();
