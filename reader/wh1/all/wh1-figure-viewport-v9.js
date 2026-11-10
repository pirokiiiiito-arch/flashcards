/* WH1 scans 18/22: give a horizontal figure a fresh rendering stage.
 * This avoids reusing the preceding vertical text's paint state. It is a
 * targeted mitigation for the reported clipping, not proof of a WebKit bug.
 * Book payloads, font sizes, page keys and stored reading positions are unchanged.
 */
'use strict';
(() => {
  const VERSION = 'figure-viewport-v9-20261110';
  const STYLE_ID = 'wh1-figure-viewport-v9-css';
  const original = window.WH1ExactPager;
  if (window.WH1FigureViewportRevision === VERSION) return;
  if (!original?.decorate || !original?.create) throw Error('読書画面の組版機能を読み込めませんでした。');

  // Preserve the published v8 geometry and mode resets for every existing
  // 11–30 figure. Only scans 18/22 additionally receive a fresh DOM stage.
  // The legacy selector names intentionally keep the existing card markup.
  const CSS = `<style id="${STYLE_ID}">
/* A vertical-text clipping layer must never cover horizontal picture pages. */
html.wh1-picture-v8,html.wh1-picture-v8 body,
html.wh1-picture-v8 #reader-main,html.wh1-picture-v8 #sheet,
html.wh1-picture-v8 #reader-page{
 clip:auto!important;clip-path:none!important;-webkit-clip-path:none!important;
 mask-image:none!important;-webkit-mask-image:none!important;
 text-indent:0!important;writing-mode:horizontal-tb!important;direction:ltr!important;
}
html.wh1-picture-v8 #reader-page{
 box-sizing:border-box!important;position:relative!important;left:0!important;right:auto!important;
 top:0!important;width:100%!important;max-width:100%!important;min-width:0!important;
 height:100%!important;margin:0!important;padding:0!important;
 transform:translateZ(0)!important;isolation:isolate!important;
}
html.wh1-picture-v8 #sheet::before,html.wh1-picture-v8 #sheet::after,
html.wh1-picture-v8 #reader-page::before,html.wh1-picture-v8 #reader-page::after,
html.wh1-picture-v8 #reader-main::before,html.wh1-picture-v8 #reader-main::after{
 content:none!important;display:none!important;
}
.figure-bundle[data-wh1-viewport="8"]{
 box-sizing:border-box!important;min-width:0!important;width:100%!important;max-width:100%!important;
 margin-left:0!important;margin-right:0!important;text-indent:0!important;
 clip:auto!important;clip-path:none!important;-webkit-clip-path:none!important;
 mask-image:none!important;-webkit-mask-image:none!important;
 writing-mode:horizontal-tb!important;direction:ltr!important;transform:translateZ(0)!important;
}
.figure-bundle[data-wh1-viewport="8"] .figure-bundle-header,
.figure-bundle[data-wh1-viewport="8"] .figure-bundle-explanation,
.figure-bundle[data-wh1-viewport="8"] .figure-bundle-caption-text,
.figure-bundle[data-wh1-viewport="8"] .figure-bundle-caption-content{
 min-width:0!important;max-width:100%!important;text-indent:0!important;
 clip:auto!important;clip-path:none!important;-webkit-clip-path:none!important;
 mask-image:none!important;-webkit-mask-image:none!important;
 writing-mode:horizontal-tb!important;direction:ltr!important;
}
#wh1-display-revision9{font-size:10px;font-weight:500;letter-spacing:0;margin-left:8px;vertical-align:middle;color:#5c726f}

#reader-page[data-wh1-stage="9"]{transform:translateZ(0)!important;isolation:isolate!important}
</style>`;

  function installChild() {
    'use strict';
    const revision = 'figure-viewport-v9-20261110';
    if (window.__WH1_FIGURE_VIEWPORT_V9__ === revision) return;
    if (typeof blocks === 'undefined' || !Array.isArray(blocks) ||
        Number(blocks[0]?.scan) !== 11 || Number(blocks[blocks.length - 1]?.scan) !== 30 ||
        typeof makeIllustration !== 'function' || typeof showPage !== 'function' ||
        !document.getElementById('reader-page')) return;
    window.__WH1_FIGURE_VIEWPORT_V9__ = revision;

    const inRange = p => p?.type === 'illustration' && Number(p.scan) >= 11 && Number(p.scan) <= 30;
    const target = p => inRange(p) && [18, 22].includes(Number(p.scan));
    const current = () => typeof pages !== 'undefined' ? pages[currentPage] : null;
    const remembered = new Map();
    const resets = {'clip': 'auto', 'clip-path': 'none', '-webkit-clip-path': 'none', 'mask-image': 'none', '-webkit-mask-image': 'none'};
    let lastKey = null;
    let freshStages = 0;
    let checkGeneration = 0;
    let observer = null;

    function restoreElement(element) {
      const properties = remembered.get(element);
      if (!properties) return;
      for (const [name, old] of Object.entries(properties)) {
        if (old.value) element.style.setProperty(name, old.value, old.priority);
        else element.style.removeProperty(name);
      }
      remembered.delete(element);
    }

    function setMode(active) {
      document.documentElement.classList.toggle('wh1-picture-v8', active);
      if (!active) {
        for (const element of Array.from(remembered.keys())) restoreElement(element);
        return;
      }
      // Resolve the current stage each time; a target transition replaces it.
      for (const element of [document.documentElement, document.body,
        document.getElementById('reader-main'), document.getElementById('sheet'), document.getElementById('reader-page')]) {
        if (!element) continue;
        if (!remembered.has(element)) {
          const previous = {};
          for (const name of Object.keys(resets)) previous[name] = {
            value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name)
          };
          remembered.set(element, previous);
        }
        for (const [name, value] of Object.entries(resets)) element.style.setProperty(name, value, 'important');
        if (element.scrollLeft !== 0) element.scrollLeft = 0;
      }
    }

    function label() {
      const brand = document.querySelector('.brand strong');
      if (!brand) return;
      let badge = document.getElementById('wh1-display-revision9');
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'wh1-display-revision9';
        badge.textContent = '表示修正9';
        badge.title = '表示修正9を読み込みました。表示の確認結果とは別です。';
        brand.append(badge);
      }
    }

    const rounded = value => Math.round(value * 100) / 100;
    const rectValue = rect => ({
      left: rounded(rect.left), top: rounded(rect.top),
      right: rounded(rect.right), bottom: rounded(rect.bottom)
    });
    const elementName = el => el.id ? '#' + el.id :
      el.tagName.toLowerCase() + (el.classList.length ? '.' + Array.from(el.classList).join('.') : '');

    // Inspect every real overflow/paint clipping ancestor. A nonrectangular mask
    // or clip cannot be certified from bounding rectangles, so report unverified.
    function clippingChain(element) {
      const chain = [{
        name: 'viewport', x: true, y: true,
        rect: {left: 0, top: 0, right: document.documentElement.clientWidth, bottom: window.innerHeight}
      }];
      const unverified = [];
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const paint = /\b(paint|strict|content)\b/.test(style.contain || '');
        const x = paint || /^(hidden|clip|scroll|auto)$/.test(style.overflowX);
        const y = paint || /^(hidden|clip|scroll|auto)$/.test(style.overflowY);
        const rect = ancestor.getBoundingClientRect();
        if (x || y) chain.push({
          name: elementName(ancestor), x, y,
          rect: {
            left: rect.left + ancestor.clientLeft,
            top: rect.top + ancestor.clientTop,
            right: rect.left + ancestor.clientLeft + ancestor.clientWidth,
            bottom: rect.top + ancestor.clientTop + ancestor.clientHeight
          }
        });
        const clipPath = style.clipPath || style.webkitClipPath || 'none';
        const mask = style.maskImage || style.webkitMaskImage || 'none';
        if ((style.clip && style.clip !== 'auto') || clipPath !== 'none' || mask !== 'none') {
          unverified.push(elementName(ancestor));
        }
      }
      return {chain, unverified};
    }

    function checkBounds() {
      const p = current();
      if (!target(p)) return;
      const stage = document.getElementById('reader-page');
      const sheet = document.getElementById('sheet');
      const card = stage?.querySelector('.figure-bundle[data-wh1-viewport="8"]');
      if (!stage || !sheet || !card) return;
      const failures = [];
      const uncertain = new Set();
      const ancestors = new Map();
      let rectangles = 0;
      const tolerance = .5;

      function verify(name, element, rect, explicitBounds) {
        if (!rect.width && !rect.height) return;
        rectangles++;
        const {chain, unverified} = clippingChain(element);
        for (const item of unverified) uncertain.add(item);
        // The stage is normally overflow:visible. It is still a required layout
        // boundary for the complete card, including its left and right borders.
        for (const boundary of explicitBounds || []) chain.push(boundary);
        for (const boundary of chain) {
          ancestors.set(boundary.name, {name: boundary.name, x: boundary.x, y: boundary.y, rect: rectValue(boundary.rect)});
          const b = boundary.rect;
          if ((boundary.x && (rect.left < b.left - tolerance || rect.right > b.right + tolerance)) ||
              (boundary.y && (rect.top < b.top - tolerance || rect.bottom > b.bottom + tolerance))) {
            failures.push({element: name, ancestor: boundary.name, rect: rectValue(rect)});
          }
        }
      }

      const stageRect = stage.getBoundingClientRect();
      verify('card', card, card.getBoundingClientRect(), [{name: '#reader-page layout', x: true, y: true, rect: stageRect}]);
      for (const selector of [
        '.figure-bundle-kicker', '.figure-bundle-title', '.figure-bundle-figlabel',
        '.figure-bundle-caption-label', '.figure-bundle-caption-content'
      ]) {
        const element = card.querySelector(selector);
        if (!element) continue;
        verify(selector, element, element.getBoundingClientRect());
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const range = document.createRange();
          range.selectNodeContents(walker.currentNode);
          for (const rect of range.getClientRects()) verify(selector + ' text', element, rect);
        }
      }
      const status = {
        revision, scan: Number(p.scan), freshStages,
        boundsCheck: failures.length ? 'outside' : uncertain.size ? 'unverified' : 'inside',
        rectanglesChecked: rectangles,
        card: rectValue(card.getBoundingClientRect()), stage: rectValue(stageRect),
        clippingAncestors: Array.from(ancestors.values()),
        unverifiedClipping: Array.from(uncertain), failures,
        paintVerified: false
      };
      window.__WH1_VIEWPORT9_STATUS__ = status;
      // Numeric geometry only. A bounds check does not assert iPhone paint success.
      window.parent.postMessage({wh1bridge: 1, type: 'wh1ViewportVersion', ...status}, '*');
    }

    function scheduleCheck() {
      const generation = ++checkGeneration;
      const active = target(current());
      label();
      if (!active) return;
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (generation === checkGeneration) checkBounds();
      }));
    }

    const makeBefore = makeIllustration;
    makeIllustration = function (p, measuring = false) {
      const card = makeBefore.apply(this, arguments);
      if (inRange(p)) card.dataset.wh1Viewport = '8';
      return card;
    };

    const showBefore = showPage;
    showPage = function () {
      const p = current();
      const active = target(p);
      const key = active ? String(p.key || ('ill:' + p.group + ':' + (p.partOffset || 0))) : null;
      let stage = document.getElementById('reader-page');
      if (active && stage && (key !== lastKey || stage.dataset.wh1Stage !== '9' || stage.querySelector('.text-flow'))) {
        // The original renderer queries #reader-page on each call. Gesture
        // handlers belong to #reader-main, so this replacement keeps navigation.
        // Do not copy the temporary v8 mode's inline resets as the fresh
        // element's permanent original style. Reapply the mode after cloning.
        restoreElement(stage);
        const fresh = stage.cloneNode(false);
        fresh.dataset.wh1Stage = '9';
        observer?.disconnect();
        stage.replaceWith(fresh);
        stage = fresh;
        observer?.observe(stage, {childList: true});
        freshStages++;
      } else if (!active && stage) {
        stage.removeAttribute('data-wh1-stage');
      }
      setMode(inRange(p));
      const result = showBefore.apply(this, arguments);
      lastKey = key;
      refresh();
      return result;
    };

    function refresh() {
      const stage = document.getElementById('reader-page');
      const card = stage?.querySelector('.figure-bundle');
      const active = !!card && Number(card.dataset.scan) >= 11 && Number(card.dataset.scan) <= 30;
      setMode(active);
      if (active) {
        card.dataset.wh1Viewport = '8';
        for (const box of card.querySelectorAll('.figure-bundle-caption-text')) if (box.scrollLeft !== 0) box.scrollLeft = 0;
      }
      scheduleCheck();
    }
    observer = new MutationObserver(refresh);
    observer.observe(document.getElementById('reader-page'), {childList: true});
    window.addEventListener('resize', refresh);
    window.addEventListener('pageshow', refresh);
    refresh();
  }

  function repair(html) {
    const isPart = /\bFIRST_SCAN\s*=\s*11\b/.test(html) && /\bLAST_SCAN\s*=\s*30\b/.test(html);
    const isStandalone = /<title>[^<]*世界の歴史[ 　]*[1１][^<]*11[〜～\-–]30[^<]*<\/title>/.test(html);
    if (!isPart && !isStandalone) return html;
    if (html.includes('id="' + STYLE_ID + '"')) return html;
    const script = '<script id="wh1-figure-viewport-v9-script">(' + installChild.toString() + ')();<\/script>';
    return html.replace('</head>', CSS + '</head>').replace('</body>', script + '</body>');
  }

  const instances = new WeakMap();
  window.WH1ExactPager = {
    ...original,
    decorate(html) {
      // Do not reapply the core decorator to an already decorated document.
      return html.includes('id="' + STYLE_ID + '"') ? html : repair(original.decorate(html));
    },
    create(options) {
      if (instances.has(options)) return instances.get(options);
      let previousBook = null;
      let view = null;
      const getBook = () => {
        const book = options.getBook();
        if (!book) return book;
        if (book !== previousBook) {
          previousBook = book;
          view = Object.create(book);
          // Count frames receive the same targeted decorator; its paint-only
          // stage replacement does not alter the shared page geometry.
          view.readText = async path => repair(await book.readText(path));
        }
        return view;
      };
      const getManifest = () => {
        const value = options.getManifest();
        return value ? {...value, created: String(value.created || '') + ':' + VERSION} : value;
      };
      const instance = original.create({...options, getBook, getManifest});
      instances.set(options, instance);
      return instance;
    }
  };
  window.WH1FigureViewportRevision = VERSION;
})();
