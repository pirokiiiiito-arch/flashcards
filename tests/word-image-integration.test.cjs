'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto, createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const quiet = require('../word-quiet-sync.js');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const sha = value => createHash('sha256').update(value).digest('hex');

// A generated one-pixel PNG: no personal pictures or external requests.
function png(red = 40) {
  const chunk = (name, data) => {
    const body = Buffer.concat([Buffer.from(name), data]);
    let crc = -1;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const header = Buffer.alloc(4), footer = Buffer.alloc(4);
    header.writeUInt32BE(data.length); footer.writeUInt32BE((crc ^ -1) >>> 0);
    return Buffer.concat([header, body, footer]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.from([0, red, 80, 120]))), chunk('IEND', Buffer.alloc(0))]);
}

// Exercise the real image module's transaction-completion path without a browser.
function memoryIDB() {
  const stores = new Map();
  let initialized = false;
  return { open(name, version) {
    assert.equal(name, 'flashcards_drive_cache_v3'); assert.equal(version, 1);
    const request = {};
    queueMicrotask(() => {
      const db = {
        objectStoreNames: { contains: name => stores.has(name) },
        createObjectStore(name) { stores.set(name, new Map()); },
        close() {},
        transaction(name, mode) {
          assert.ok(stores.has(name));
          const operations = [], tx = {};
          let aborted = false;
          tx.abort = () => { aborted = true; queueMicrotask(() => tx.onabort?.()); };
          tx.objectStore = actual => {
            assert.equal(actual, name);
            return {
              get(key) { const req = {}; operations.push({ key, req, method: 'get' }); return req; },
              put(value, key) { assert.equal(mode, 'readwrite'); const req = {}; operations.push({ key, req, value, method: 'put' }); return req; }
            };
          };
          setImmediate(() => {
            if (aborted) return;
            const original = stores.get(name), next = new Map(original);
            for (const op of operations) if (op.method === 'put') next.set(op.key, op.value);
            if (mode === 'readwrite') stores.set(name, next);
            for (const op of operations) {
              op.req.result = op.method === 'get' ? original.get(op.key) : op.key;
              op.req.onsuccess?.();
            }
            tx.oncomplete?.();
          });
          return tx;
        }
      };
      request.result = db;
      if (!initialized) { initialized = true; request.onupgradeneeded?.(); }
      request.onsuccess?.();
    });
    return request;
  } };
}

function setup(initial = []) {
  let cfg, localWrites = 0, changes = 0, renders = 0;
  const saved = new Map();
  const element = () => ({ style: {}, classList: { add() {}, toggle() {} }, appendChild() {}, setAttribute() {}, addEventListener() {}, querySelector() { return null; } });
  const toolbar = element();
  const api = { applying: false, valid: () => false, changed() { changes++; }, async sync() {}, open() {}, view: () => ({ data: {}, deleted: {} }) };
  const context = {
    Blob, File, crypto: webcrypto, indexedDB: memoryIDB(), btoa, atob, structuredClone, queueMicrotask,
    setInterval() {}, addEventListener() {}, console,
    KEY: 'simple_vocab_cards_v1', cards: structuredClone(initial), order: initial.map((_, i) => i), pos: 0, editing: false, isShuffled: false,
    legacyRequests: new Set(),
    localStorage: { getItem: key => saved.get(key) ?? null, setItem(key, value) { localWrites++; saved.set(key, value); } },
    document: { visibilityState: 'visible', body: toolbar, head: element(), createElement: element, getElementById() { return null; }, querySelector() { return toolbar; }, addEventListener() {} },
    stage: { querySelector() { return null; } },
    wordDrivePrimary: () => true, stopSyncLoop() {}, updateSyncUI() {}, updateNav() {}, updateMode() {},
    currentIndex() { return context.order[context.pos] ?? -1; },
    loadCards() { return context.cards; },
    saveCards() { context.localStorage.setItem(context.KEY, JSON.stringify(context.cards)); },
    rebuildOrder() { context.order = context.cards.map((_, i) => i); context.pos = Math.min(context.pos, Math.max(0, context.order.length - 1)); },
    render() { renders++; },
    WordQuietSync: { ...quiet, attach() {}, refresh() {}, capture: () => ({}), restore() {} },
    FlashcardsDrive: { digest: async value => sha(value), install(config) { cfg = config; return api; } }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('word-images.js'), context);
  vm.runInContext(read('drive-sync.js'), context);
  return { context, cfg, api, saved, images: context.WordImages,
    counts: () => ({ localWrites, changes, renders }) };
}
const card = (id, images, sort = 1) => ({ id, word: '検証単語 ' + id, meaning: '検証用の意味', ...(images === undefined ? {} : { images }), sort_order: sort, updated_at: null });

test('image integration: legacy text cards normalize to no images and migration records stay untouched', async () => {
  const state = setup([card('plain')]);
  const values = await state.cfg.read();
  assert.deepEqual(plain(values['card:plain'].images), []);
  const marker = { schema: 'word-network-migration-v2', covered_keys: ['card:plain'] };
  assert.equal(await state.cfg.toCloudValue('migration:word-network-recovery:v1', marker, state.api), marker);
  const list = await state.cfg.prepareApply({ data: { ...values, 'migration:word-network-recovery:v1': marker } });
  assert.equal(list.length, 1); assert.equal(list[0].word, '検証単語 plain');
  assert.deepEqual(state.counts(), { localWrites: 0, changes: 0, renders: 0 });
});

test('image integration: original local bytes survive read, Drive conversion, receive preparation and application', async () => {
  const state = setup(), bytes = png();
  const image = await state.images.storeFile(new File([bytes], '図版.png', { type: 'image/png' }));
  state.context.cards = [card('image', [image], 2), card('plain', undefined, 1)];
  state.context.order = [0, 1];
  const before = JSON.stringify(state.context.cards), values = await state.cfg.read(), uploads = [];
  const cloudAPI = { async putBlob(blob) {
    uploads.push(Buffer.from(await blob.arrayBuffer()));
    return 'gdrive:synthetic-file:' + sha(bytes);
  } };
  const cloud = await state.cfg.toCloudValue('card:image', values['card:image'], cloudAPI);
  assert.deepEqual(uploads, [bytes]);
  assert.equal(cloud.images[0].ref, 'gdrive:synthetic-file:' + sha(bytes));
  assert.equal(cloud.images[0].name, '図版.png'); assert.equal(cloud.meaning, '検証用の意味');
  assert.equal(JSON.stringify(state.context.cards), before, 'upload preparation does not replace the local card');
  const incoming = await state.cfg.prepareApply({ data: { 'card:image': cloud, 'card:plain': values['card:plain'] } });
  assert.deepEqual(plain(incoming.map(c => c.id)), ['plain', 'image']);
  assert.deepEqual(plain(incoming[1].images), plain(cloud.images));
  state.api.applying = true;
  state.cfg.apply(incoming);
  assert.deepEqual(plain(state.context.cards[1].images), plain(cloud.images));
  assert.deepEqual(JSON.parse(state.saved.get(state.context.KEY))[1].images, plain(cloud.images));
});

test('image integration: received Drive references retain metadata without reuploading or rewriting source records', async () => {
  const image = { ref: 'gdrive:existing-image:' + sha(png()), name: '参考.png', type: 'image/png' };
  const initial = [card('remote', [image])], state = setup(initial), before = JSON.stringify(initial);
  const api = { async putBlob() { throw Error('must not reupload an existing Drive reference'); }, async getBlob() { throw Error('metadata preparation must not fetch a picture'); } };
  const uploaded = await state.cfg.toCloudValue('card:remote', initial[0], api);
  const prepared = await state.cfg.prepareApply({ data: { 'card:remote': uploaded } }, api);
  assert.deepEqual(plain(prepared), initial); assert.equal(JSON.stringify(initial), before);
  assert.notEqual(prepared[0].images, initial[0].images);
  assert.notEqual(prepared[0].images[0], initial[0].images[0]);
});

test('image integration: invalid local images reject before ID normalization or local persistence', async () => {
  const invalid = [{ word: '保持する単語', meaning: '保持する意味', images: [{ ref: 'https://example.test/unsafe.png', name: '画像.png', type: 'image/png' }] }];
  const state = setup(invalid), before = JSON.stringify(state.context.cards);
  await assert.rejects(state.cfg.read(), /保存先情報/);
  assert.equal(JSON.stringify(state.context.cards), before);
  assert.deepEqual(state.counts(), { localWrites: 0, changes: 0, renders: 0 });
});

test('image integration: invalid incoming metadata cannot replace valid local words or images', async () => {
  const image = { ref: 'gdrive:existing-image:' + sha(png()), name: '保持.png', type: 'image/png' };
  const state = setup([card('keep', [image])]), before = JSON.stringify(state.context.cards);
  const incoming = { data: { 'card:new': card('new'), 'card:bad': card('bad', [{ ...image, ref: 'javascript:alert(1)' }]) } };
  const remoteBefore = JSON.stringify(incoming);
  await assert.rejects(state.cfg.prepareApply(incoming), /保存先情報/);
  assert.equal(JSON.stringify(state.context.cards), before); assert.equal(JSON.stringify(incoming), remoteBefore);
  assert.deepEqual(state.counts(), { localWrites: 0, changes: 0, renders: 0 });
});

test('image integration: a failed image upload does not return a completed cloud card or discard the local image', async () => {
  const state = setup(), bytes = png(90);
  const image = await state.images.storeFile(new File([bytes], '未送信.png', { type: 'image/png' }));
  state.context.cards = [card('pending', [image])];
  const values = await state.cfg.read(), before = JSON.stringify(values);
  let uploads = 0;
  await assert.rejects(state.cfg.toCloudValue('card:pending', values['card:pending'], {
    async putBlob() { uploads++; throw Error('合成したアップロード失敗'); }
  }), /アップロード失敗/);
  assert.equal(uploads, 1); assert.equal(JSON.stringify(values), before);
  assert.ok(state.context.cards[0].images[0].ref.startsWith('local:'));
  const recovered = await state.images.getBlob(image);
  assert.deepEqual(Buffer.from(await recovered.arrayBuffer()), bytes);
  const retried = await state.cfg.toCloudValue('card:pending', values['card:pending'], {
    async putBlob() { return 'gdrive:retry-success:' + sha(bytes); }
  });
  assert.equal(retried.images[0].ref, 'gdrive:retry-success:' + sha(bytes));
  assert.deepEqual(state.counts(), { localWrites: 0, changes: 0, renders: 0 });
});

test('image integration: an explicit image removal crosses the sync pipeline and redraws the existing card', async () => {
  const image = { ref: 'gdrive:existing-image:' + sha(png()), name: '削除前.png', type: 'image/png' };
  const before = [card('same', [image])], state = setup([card('same', [])]);
  const values = await state.cfg.read();
  const cloud = await state.cfg.toCloudValue('card:same', values['card:same'], {
    async putBlob() { throw Error('removed images must not be uploaded'); }
  });
  const next = await state.cfg.prepareApply({ data: { 'card:same': cloud } });
  assert.deepEqual(plain(next[0].images), []);
  const plan = quiet.plan(before, next, { order: [0], pos: 0 });
  assert.equal(plan.redraw, true); assert.equal(plan.sameCard, true);
});

test('image integration: a malformed saved image does not turn every locally stored card into an empty deck', () => {
  const state = setup(), hash = sha(png());
  const stored = [card('good', [{ ref: 'local:' + hash, name: '保持.png', type: 'image/png' }]), card('bad', [{ ref: 'broken', name: '要確認.png', type: 'image/png' }])];
  state.saved.set(state.context.KEY, JSON.stringify(stored));
  const html = read('index.html'), start = html.indexOf('function loadCards(){'), end = html.indexOf('\nfunction saveCards()', start);
  assert.ok(start >= 0 && end > start, 'load the real HTML storage reader');
  vm.runInContext(html.slice(start, end), state.context);
  const loaded = state.context.loadCards();
  assert.equal(loaded.length, 2); assert.equal(loaded[0].word, stored[0].word); assert.equal(loaded[1].word, stored[1].word);
  assert.deepEqual(plain(loaded[0].images), stored[0].images); assert.deepEqual(plain(loaded[1].images), stored[1].images);
  assert.equal(state.saved.get(state.context.KEY), JSON.stringify(stored));
});


test('image entry is in a dedicated footer after the stage and never inside the card border', () => {
  const html = read('index.html');
  assert.match(html, /<div id="stage" class="stage"><\/div>\s*<div class="word-card-footer" data-word-image-footer="outside-v1">/);
  assert.match(html, /<div id="wordImageAction" class="word-image-action"><\/div>/);
  assert.ok(html.includes('.word-image-action{display:none}'));
  assert.ok(html.includes('.stage:has(>.card.show-back:not(.is-editing)):not([inert])+.word-card-footer .word-image-action:has(.word-image-entry){display:block'));
  assert.ok(html.includes('back.append(bl,backContent);card.append(front,back);wordImageAction.replaceChildren(imageEntry);'));
  assert.ok(html.includes('imageView.destroy();imageView=null;imageEntry.remove();'));
  assert.ok(html.includes('disposeCardImages=()=>{imageView?.destroy();imageEditor?.destroy();imageEntry.remove()}'));
  assert.ok(!html.includes('back.append(bl,backContent,imageEntry)'));
  assert.ok(!html.includes('backContent.append(bt,imageArea,imageEntry)'));
});


test('opening image editing never opens the file picker automatically; explicit selection remains available', () => {
  const html = read('index.html');
  assert.ok(html.includes('imageEntry.onclick=e=>{e.stopPropagation();if(editing||!card.isConnected||stage.inert)return;startEdit(true)};'));
  assert.ok(!html.includes('startEdit();imageEditor?.choose()'));
  const ui = read('word-images-ui.js');
  assert.ok(ui.includes('add.onclick = choose;'));
  assert.ok(ui.includes("pasteTarget.addEventListener('paste', pastedImages)"));
});


test('native image paste field is real editable content and retains text paste in the meaning field', () => {
  const html = read('index.html'), ui = read('word-images-ui.js'), css = read('word-images.css');
  assert.ok(html.includes('startEdit(true)'));
  assert.ok(html.includes('if(focusImages)imageEditor.revealPasteZone()'));
  assert.ok(ui.includes("pasteZone.contentEditable = 'true'"));
  assert.ok(ui.includes("pasteZone.addEventListener('input', consumeNativeInsertion)"));
  assert.ok(ui.includes("pasteObserver.observe(pasteZone"));
  assert.ok(ui.includes("if (!inZone) return;"));
  assert.ok(ui.includes("document.createElement('template')"));
  assert.ok(css.includes('-webkit-touch-callout:default'));
  assert.ok(ui.includes("item.kind === 'file'"), 'opaque clipboard image items must get a native paste fallback');
  assert.ok(ui.includes("const sources = extractSources(html, plain)"), 'image URLs from copied HTML/text are handled');
  assert.ok(ui.includes("mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer'"), 'remote image reads omit credentials/referrer');
  assert.ok(ui.includes('await reader.cancel()'), 'oversized streamed images must be aborted');
  assert.ok(ui.includes('normalizeClipboardFile(file)'), 'unknown image MIME is inspected by signature');
  assert.ok(ui.includes('reportUnreadable(reason)'), 'clipboard diagnostics are available without persisting contents');
  assert.ok(ui.includes('recordClipboardItems(items)'), 'rich clipboard read path records only MIME types');
  assert.ok(ui.includes('pickInstead.onclick = () => choose()'), 'image file chooser is accessible after paste failures');
  assert.ok(ui.includes("const PASTE_VERSION = 'paste8'"), 'paste build identifies a fresh script');
  assert.ok(ui.includes("isIOSChrome ? 'ペースト欄へ' : '画像を貼り付け'"), 'iPhone Chrome action reflects native paste requirement');
  assert.ok(ui.includes('function clearPasteDiagnostic()'), 'diagnostic resets only explicitly');
  assert.ok(!/dismiss.hidden = !error;\s*pasteDiagnostic.hidden = true/.test(ui), 'status updates must not hide diagnostics');
  assert.ok(html.includes('word-images-ui.js?v=20261126-normalview2'));
});

function setupCardBackFlipTest() {
  const html = read('index.html');
  const begin = html.indexOf('function resetWordBackScroll(card){');
  const end = html.indexOf('\nfunction renderCard(item){', begin);
  assert.ok(begin >= 0 && end > begin, 'the back-scroll helper exists before renderCard');
  const frames = [];
  const context = {
    requestAnimationFrame(callback) { frames.push(callback); },
    editing:false, cards:[],
    window:{visualViewport:{scale:1},location:{reload() { throw Error('normal-scale flips cannot reload'); }}}
  };
  const functions = vm.runInNewContext(html.slice(begin, end) + '\n({resetWordBackScroll,flipWordCardFace})', context);
  const names = new Set(), content = { scrollTop: 0 }, back = { scrollTop: 0 };
  const card = {
    isConnected: true,
    classList: {
      contains: name => names.has(name),
      toggle(name, forced) {
        const enabled = forced === undefined ? !names.has(name) : !!forced;
        if (enabled) names.add(name); else names.delete(name);
        return enabled;
      }
    },
    querySelector(selector) {
      if (selector === '.back-content') return content;
      if (selector === '.back') return back;
      return null;
    }
  };
  return { ...functions, card, content, back, frames };
}

test('word back flip: after scrolling two-plus pictures, flipping back always starts at the top', () => {
  const { flipWordCardFace, card, content, back, frames } = setupCardBackFlipTest();
  content.scrollTop = 970;
  back.scrollTop = 450;
  flipWordCardFace(card);
  assert.equal(card.classList.contains('show-back'), true);
  assert.equal(content.scrollTop, 0);
  assert.equal(back.scrollTop, 0);
  // WebKit can restore a hidden scrolling element's old offset during layout.
  content.scrollTop = 920;
  back.scrollTop = 240;
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(content.scrollTop, 0);
  assert.equal(back.scrollTop, 0);
  content.scrollTop = 850;
  flipWordCardFace(card); // back to front
  assert.equal(content.scrollTop, 0, 'closing the back clears its old position while still visible');
  flipWordCardFace(card); // front to back again
  assert.equal(content.scrollTop, 0, 'every new back reveal resets scroll, not just the first');
});

test('word back flip: delayed reset never affects disconnected cards or already-hidden backs', () => {
  const { flipWordCardFace, card, content, frames } = setupCardBackFlipTest();
  flipWordCardFace(card);
  content.scrollTop = 345;
  flipWordCardFace(card); // show front, clears the old scroll immediately
  assert.equal(content.scrollTop, 0);
  content.scrollTop = 345; // synthetic offset to ensure stale callback cannot reset the hidden face
  frames.shift()();
  assert.equal(content.scrollTop, 345);
  flipWordCardFace(card);
  content.scrollTop = 678;
  card.isConnected = false;
  frames.shift()();
  assert.equal(content.scrollTop, 678);
});

test('word back flip: tapping, editing and both save flows use the shared top-reset path', () => {
  const html = read('index.html');
  assert.equal((html.match(/flipWordCardFace\(card\);/g) || []).length, 4,
    'normal touch, normal click, existing-card editor and new-card editor');
  assert.equal((html.match(/resetWordBackScroll\(shown\)/g) || []).length, 2,
    'both save paths restore the new back at its top');
  assert.ok(!html.includes('card.classList.toggle("show-back");'),
    'no old unguarded face switches should remain');
  assert.match(html, /if\(openBack\)resetWordBackScroll\(card\)/);
  assert.match(html, /if\(!openBack\)resetWordBackScroll\(card\)/, 'reset before hiding back too');
  assert.ok(html.includes('.back{display:flex;visibility:hidden;pointer-events:none;'),
    'back must stay laid out to prevent iPhone WebKit restoring a display:none scroll position');
  assert.ok(html.includes('.card:not(.show-back) .back-content{overflow-y:hidden}'),
    'hidden back must stop kinetic scrolling without affecting visible scrolling');
  assert.ok(html.includes('.card.show-back .back{visibility:visible;pointer-events:auto}'));
});


test('word back: native touch pan is not captured by card navigation in scroll content', () => {
  const html = read('index.html');
  assert.ok(html.includes('touch-action:pan-y pinch-zoom;-webkit-overflow-scrolling:touch'));
  assert.ok(html.includes('const photoTap=!!e.target.closest(".word-image-open")'), 'loaded-photo taps are card flips');
  const start = html.indexOf('card.addEventListener("pointerdown",e=>{');
  const end = html.indexOf('\n card.addEventListener("pointermove"', start);
  assert.ok(start > 0 && end > start, 'use the app’s actual card pointer handler');

  let listener, captures = 0;
  const context = {
    editing: false, swipePointerId: null, touchTapHandled: true,
    swipeStartX: 0, swipeStartY: 0, swipeMoved: false,
    card: {
      classList: { contains: name => name === 'show-back' },
      addEventListener(name, fn) { if (name === 'pointerdown') listener = fn; },
      setPointerCapture() { captures++; }
    }
  };
  vm.runInNewContext(html.slice(start, end), context);
  assert.equal(typeof listener, 'function');
  const insideScroll = {
    pointerType: 'touch', pointerId: 1, clientX: 30, clientY: 200,
    target: {
      closest(selector) { return selector === '.back-content' ? {} : null; }
    }
  };
  listener(insideScroll);
  assert.equal(captures, 0, 'native vertical scrolling owns back-content gestures');
  assert.equal(context.swipePointerId, null);
  assert.equal(context.touchTapHandled, false, 'a normal tap still reaches click');
  listener({
    ...insideScroll, pointerId: 2,
    target: { closest() { return null; } }
  });
  assert.equal(captures, 1, 'card navigation outside the scroll region still works');
  assert.equal(context.swipePointerId, 2);
});

test('word back: vertical touch pan is never cancelled as a tap', () => {
  const html = read('index.html');
  assert.ok(html.includes('if(isTouch&&(horizontal||simpleTap))e.preventDefault();'));
  assert.ok(!html.includes('if(isTouch)e.preventDefault();'),
    'unconditional preventDefault on touch pointerup disrupts iPhone scroll');
});


test('normal view: closing a zoomed reverse face temporarily clamps browser viewport and preserves the card', () => {
  const html=read('index.html');
  const start=html.indexOf('function resetWordBackScroll(card){');
  const end=html.indexOf('\nfunction renderCard(item){',start);
  assert.ok(start>=0&&end>start);
  const frames=[],timers=[],meta={content:'width=device-width,initial-scale=1,viewport-fit=cover'};
  const flags=new Set();
  const cards=[
    {id:'syn-a',sort_order:10,images:[{ref:'local:synthetic-a'}]},
    {id:'syn-b',sort_order:20,images:[{ref:'local:synthetic-b'}]},
    {id:'syn-c',sort_order:30,images:[{ref:'local:synthetic-c'}]}
  ];
  const context={
    requestAnimationFrame(fn){frames.push(fn)},
    editing:false,cards,order:[2,0,1],pos:2,isShuffled:true,
    window:{
      visualViewport:{scale:2.2},
      setTimeout(fn,ms){timers.push({fn,ms})}
    },
    document:{
      querySelector(selector){assert.equal(selector,'meta[name="viewport"]');return meta},
      documentElement:{classList:{toggle(name,on){
        assert.equal(name,'word-page-zoomed');if(on)flags.add(name);else flags.delete(name)
      }}}
    }
  };
  vm.runInNewContext(html.slice(start,end),context);
  const names=new Set(['show-back']),content={scrollTop:770},back={scrollTop:100};
  const card={
    isConnected:true,
    classList:{
      contains(name){return names.has(name)},
      toggle(name,on){if(on)names.add(name);else names.delete(name)}
    },
    querySelector(selector){return selector==='.back-content'?content:selector==='.back'?back:null}
  };
  const oldCards=JSON.stringify(cards),oldOrder=[...context.order];
  context.flipWordCardFace(card);
  assert.equal(names.has('show-back'),false);
  assert.equal(content.scrollTop,0);
  assert.equal(back.scrollTop,0);
  assert.match(meta.content,/maximum-scale=1/);
  assert.equal(timers.length,1);
  assert.equal(timers[0].ms,220);
  assert.equal(context.pos,2);
  assert.deepEqual([...context.order],oldOrder);
  assert.equal(context.isShuffled,true);
  assert.equal(JSON.stringify(cards),oldCards);
  // Browser clamp changes visualViewport, not application JavaScript.
  context.window.visualViewport.scale=1;
  timers.shift().fn();
  assert.equal(meta.content,'width=device-width,initial-scale=1,viewport-fit=cover');
  assert.equal(flags.has('word-page-zoomed'),false);
  assert.equal(JSON.stringify(cards),oldCards);
  assert.doesNotMatch(html.slice(start,end),/window\.location\.reload|sessionStorage\./);
});

test('normal view: regular flips never clamp viewport or interrupt editing', () => {
  const html=read('index.html');
  const start=html.indexOf('function resetWordBackScroll(card){');
  const end=html.indexOf('\nfunction renderCard(item){',start);
  const meta={content:'width=device-width,initial-scale=1,viewport-fit=cover'};
  let timerCount=0;
  const context={
    requestAnimationFrame(){},editing:false,
    window:{visualViewport:{scale:1},setTimeout(){timerCount++}},
    document:{querySelector(){return meta},documentElement:{classList:{toggle(){}}}}
  };
  vm.runInNewContext(html.slice(start,end),context);
  assert.equal(context.returnWordPageToNormalView(),false);
  assert.equal(timerCount,0);
  assert.equal(meta.content,'width=device-width,initial-scale=1,viewport-fit=cover');
  context.window.visualViewport.scale=2;
  context.editing=true;
  assert.equal(context.returnWordPageToNormalView(),false);
  assert.equal(timerCount,0);
});


test('image cards keep the same front height as text-only cards, with tall scrollable backs', () => {
  const html=read('index.html');
  assert.match(html, /\.card\{[^}]*height:360px/, 'desktop normal cards are 360px');
  assert.ok(html.includes('@media(max-width:560px){.wrap{margin-top:16px}.card{height:320px}'), 'phone normal cards are 320px');
  assert.ok(html.includes('.card.with-images.show-back,.card.is-editing{height:clamp(360px,calc(100dvh - 250px),660px)}'),
    'only reverse-side photo cards and active editors receive the taller desktop height');
  assert.ok(html.includes('.card.with-images.show-back,.card.is-editing{height:clamp(340px,calc(100dvh - 245px),600px)}'),
    'only reverse-side photo cards and active editors receive the taller phone height');
  assert.doesNotMatch(html,/\.card\.with-images\{height:/,'a photo must never enlarge the front face');
  assert.ok(html.includes('.card.with-images .back-content,.card.is-editing .back-content{height:100%}'),
    'multiple reverse images retain independent scrolling');
  assert.ok(html.includes('name="word-front-height-build" content="20261126-frontmatch1"'),
    'the deployed build identifies the standard-front-height fix');
});


test('meaning and first photo have two line-heights of breathing room only in study back', () => {
  const html=read('index.html');
  assert.ok(html.includes('.card.with-images.show-back:not(.is-editing) .back-content > .card-text:not(:empty){margin-bottom:2lh}'),
    'space must follow the visible description by exactly two text lines');
  assert.ok(html.includes('backContent.append(backNumber,bt,imageArea)'),
    'description still precedes image data, without changing word content or pictures');
  assert.ok(html.includes('name="word-meaning-photo-gap-build" content="20261126-meaning-gap1"'));
  assert.ok(!html.includes('.word-image-gallery{margin-top:2lh}'),
    'image-only cards must not gain the spacing');
});


test('reverse card count is centered in document flow between action buttons and meaning, not overlaid', () => {
  const html=read('index.html');
  assert.ok(html.includes('const positionText=(pos+1)+" / "+cards.length;'),
    'both counters must show the same position and total');
  assert.ok(html.includes('frontNumber.className="card-number card-number-front"'),
    'front still retains its original discreet counter');
  assert.ok(html.includes('backNumber.className="card-number card-number-back"'),
    'back receives its own centered counter');
  assert.ok(html.includes('backContent.append(backNumber,bt,imageArea)'),
    'reverse number must be in flow before the meaning and all pictures');
  assert.ok(html.includes('front.append(fl,ft,frontNumber)'),
    'front counter must be displayed on the front face only');
  assert.ok(html.includes('.card-number-back{position:static;display:block;width:max-content;max-width:100%;margin:0 auto 12px;text-align:center;flex:none}'),
    'back count must occupy its own line, not overlap long descriptions');
  assert.ok(html.includes('.card-number-front{position:absolute;right:24px;top:76px;z-index:4}'),
    'front appearance remains consistent with older study cards');
  assert.ok(html.includes('.card-number-front{right:18px;top:72px}'),
    'existing iPhone front number placement is retained');
  assert.ok(!html.includes('card.appendChild(num)'),
    'remove old unconditional counter overlay on the back');
  assert.ok(html.includes('name="word-card-number-build" content="20261126-number-center1"'));
});
