// Keep only measurements from the signed novel, never a second copy of its text.
(() => {
  'use strict';

  const editions = new Set([
    '1518dcd1772ff65620265a2597d9db3782e2e667d3110d7419c26018e14e0ee8',
    '7bec7d5ef409cc65ff30bc5b33f6618c2d1c2e42743c841966d2815f55a9f385'
  ]);

  // This function is installed inside the private reader's script. The reader
  // keeps its original page builder, including ruby, word breaks and bookmarks.
  function createMeasurementCache(edition) {
    const key = 'novel-layout-measurements-v1:' + edition;
    let recorded = [], replay = null, cursor = 0;

    function geometry(sheet, flow, font) {
      const box = sheet.getBoundingClientRect();
      const paper = getComputedStyle(sheet), text = getComputedStyle(flow);
      const canvas = document.createElement('canvas').getContext('2d');
      if (!canvas || document.fonts?.status === 'loading') return null;
      const samples = [];
      for (const weight of ['normal', 'bold']) {
        canvas.font = weight + ' ' + text.fontSize + ' ' + text.fontFamily;
        for (const sample of ['あ漢、。「」', 'Ａ12mw']) {
          const metrics = canvas.measureText(sample);
          samples.push(metrics.width, metrics.actualBoundingBoxAscent,
            metrics.actualBoundingBoxDescent, metrics.actualBoundingBoxRight);
        }
      }
      const styleKeys = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing',
        'writingMode', 'textOrientation', 'textSizeAdjust', 'paddingTop', 'paddingRight',
        'paddingBottom', 'paddingLeft'];
      return JSON.stringify([box.width, box.height, font, devicePixelRatio, navigator.userAgent,
        ...styleKeys.map(k => paper[k]), ...styleKeys.map(k => text[k]), ...samples]);
    }

    function checksum(values) {
      let hash = 2166136261;
      for (let i = 0; i < values.length; i++) hash = Math.imul(hash ^ values.charCodeAt(i), 16777619);
      return hash >>> 0;
    }

    function measure(original, existing, additional) {
      if (replay !== null) {
        if (cursor === replay.length) throw Error('Cached measurements exhausted');
        return replay[cursor++] === '1';
      }
      const fits = original(existing, additional);
      recorded.push(fits ? '1' : '0');
      return fits;
    }

    function paginate(build, sheet, flow, font) {
      let fingerprint, cache;
      try {
        fingerprint = geometry(sheet, flow, font);
        if (fingerprint) cache = JSON.parse(localStorage.getItem(key));
      } catch (_) { /* The reader also works with storage disabled. */ }
      if (fingerprint && cache?.geometry === fingerprint && typeof cache.bits === 'string' &&
          cache.bits.length > 0 && cache.bits.length <= 1000000 &&
          /^[01]+$/.test(cache.bits) && checksum(cache.bits) === cache.checksum) {
        replay = cache.bits;
        cursor = 0;
        try {
          const pages = build();
          if (cursor === replay.length && pages.length === cache.pages) return pages;
        } catch (_) { /* A changed measurement sequence must be measured afresh. */ }
        finally { replay = null; }
      }
      recorded = [];
      try {
        const pages = build();
        if (fingerprint && recorded.length && recorded.length <= 1000000) {
          const bits = recorded.join('');
          try {
            localStorage.setItem(key, JSON.stringify({geometry: fingerprint, bits,
              checksum: checksum(bits), pages: pages.length}));
          } catch (_) { /* Full storage only disables reuse. */ }
        }
        return pages;
      } finally { recorded = []; }
    }

    return {measure, paginate};
  }

  function prepareColdLayout(engine) {
    const emphasis = 'function printedEmphasis(block,segment){\n';
    const search = '   let lo=0,hi=remaining;\n';
    const whole = '   if(current.length&&fitsParts([],whole)){\n    flush();continue;\n   }\n';
    const blockStart = engine.indexOf('function paginateBlocks(group,start){');
    const blockEnd = engine.indexOf('function captionFits(', blockStart);
    if (blockStart < 0 || blockEnd < 0 || !engine.includes(emphasis)) return engine;
    const block = engine.slice(blockStart, blockEnd);
    if (!block.includes(search) || !block.includes(whole)) return engine;

    // A complete paragraph that fits a fresh page always moves there. Check this
    // before measuring shorter prefixes that would subsequently be discarded.
    const oldComment = '   // The new short paragraph may fit by itself. Do not manufacture a final\n' +
      '   // five-character page merely because it cannot fit beside prior blocks.\n';
    const reordered = block.replace(oldComment, '').replace(whole, '').replace(search, whole + search);
    return (engine.slice(0, blockStart) + reordered + engine.slice(blockEnd))
      .replace(emphasis, emphasis + ' if(!block.emphasis?.length)return [];\n');
  }

  // These editions place every original JPEG in a separate string in bookdata.
  // Keep that data out of the HTML parser and create each original's Blob only
  // when the private reader first asks for its source.
  function compactOriginals(bytes, edition) {
    if (!editions.has(edition)) return null;
    const decoder = new TextDecoder('utf-8', {fatal: true}), encoder = new TextEncoder();
    const marker = encoder.encode(',"originals":[');
    let start = bytes.indexOf(marker[0]);
    while (start >= 0 && !marker.every((b, i) => bytes[start + i] === b)) {
      start = bytes.indexOf(marker[0], start + 1);
    }
    if (start < 0) return null;

    const end = bytes.indexOf(93, start + marker.length);
    if (end < 0) return null;
    const sources = [], metadata = [];
    let at = start + marker.length;
    while (at < end) {
      // scan and sha256 precede the unescaped base64 JPEG payload in both editions.
      const header = decoder.decode(bytes.subarray(at, Math.min(end, at + 160)));
      const match = /^\{"scan":(\d+),"sha256":"([a-f0-9]{64})","src":"data:image\/jpeg;base64,/.exec(header);
      if (!match || Number(match[1]) !== sources.length + 1) return null;
      const begin = at + match[0].length, close = bytes.indexOf(34, begin);
      if (close < begin || close + 1 >= end || bytes[close + 1] !== 125) return null;
      sources.push(decoder.decode(bytes.subarray(begin, close)));
      metadata.push({scan: Number(match[1]), sha256: match[2]});
      at = close + 2;
      if (at < end && bytes[at++] !== 44) return null;
    }
    if (sources.length !== 534) return null;
    const bootstrap = 'window.READER_BOOK=JSON.parse(document.getElementById("bookdata").textContent);';
    const tail = decoder.decode(bytes.subarray(end + 1));
    if (!tail.includes(bootstrap)) return null;
    window.__attachNovelOriginals = originals => {
      delete window.__attachNovelOriginals;
      originals.forEach((item, index) => {
        Object.defineProperty(item, 'src', {configurable: true, enumerable: true, get() {
          const encoded = sources[index];
          let raw;
          if (typeof Uint8Array.fromBase64 === 'function') {
            raw = Uint8Array.fromBase64(encoded);
          } else {
            const binary = atob(encoded);
            raw = new Uint8Array(binary.length);
            for (let i = 0; i < raw.length; i++) raw[i] = binary.charCodeAt(i);
          }
          const url = URL.createObjectURL(new Blob([raw], {type: 'image/jpeg'}));
          Object.defineProperty(item, 'src', {value: url, writable: true, configurable: true, enumerable: true});
          sources[index] = null;
          return url;
        }});
      });
    };
    return decoder.decode(bytes.subarray(0, start)) + ',"originals":' + JSON.stringify(metadata) +
      tail.replace(bootstrap, bootstrap + 'window.__attachNovelOriginals(window.READER_BOOK.originals);');
  }

  function prepare(markup, edition) {
    if (!editions.has(edition)) return markup;
    // Work on the small engine tail even when the original JPEGs are inline.
    const cut = Math.max(0, markup.length - 128 * 1024);
    const tail = prepareColdLayout(markup.slice(cut));
    const declaration = 'function fitsParts(existing,additional){';
    const build = 'pages=paginateAll();';
    if (tail.indexOf(declaration) < 0 || tail.indexOf(build) < 0) return markup;
    const wrapper = 'const resumeMeasurements=(' + createMeasurementCache.toString() +
      ')(' + JSON.stringify(edition) + ');\n' +
      declaration + 'return resumeMeasurements.measure(measureParts,existing,additional);}\n' +
      'function measureParts(existing,additional){';
    const prepared = markup.slice(0, cut) + tail.replace(declaration, () => wrapper)
      .replace(build, 'pages=resumeMeasurements.paginate(paginateAll,sheet,measureText,font);');
    // Isolate the changing vertical text to mitigate the reported iPhone
    // partial-paint symptom. A zero-distance transform changes no glyph positions,
    // pagination measurements, source characters, or original image bytes.
    // Install it before the first page is painted; the hidden measuring frame
    // keeps its existing layout and does not need a compositing layer.
    const headEnd = prepared.indexOf('</head>');
    if (headEnd < 0) return prepared;
    const paintStyle = '<style id="novel-text-paint-layer">#text-flow{transform:translateZ(0)}</style>';
    return prepared.slice(0, headEnd) + paintStyle + prepared.slice(headEnd);
  }

  window.NovelResumeLayout = Object.freeze({prepare, compactOriginals});
})();
