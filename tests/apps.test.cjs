const { Element, database, driveServer, tick } = require('./mock-runtime.cjs');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), { test } = require('node:test'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
function app(relative, initial = {}, sharedServer) {
  const file = path.join(root, relative), html = fs.readFileSync(file, 'utf8'), nodes = new Map(), db = database(), store = new Map(Object.entries(initial)), events = new Map(), network = [], server = sharedServer || driveServer(), captures = [], timers = new Set();
  class Node extends Element {
    constructor(t) { super(t); this.id = ''; this.isConnected = true; this.parentNode = null; }
    set innerHTML(s) { super.innerHTML = s; this._html = s; for (const m of s.matchAll(/id=["']([^"']+)["']/g)) { const e = new Node('div'); e.id = m[1]; nodes.set(e.id, e); } }
    get innerHTML() { return this._html || ''; }
    querySelector(s) { if (s.startsWith('#')) return nodes.get(s.slice(1)) || null; return super.querySelector(s); }
    querySelectorAll() { return []; }
    appendChild(e) { e.parentNode = this; if (e.id) nodes.set(e.id, e); return super.appendChild(e); }
    focus() {} replaceWith() {} contains() { return true; } getBoundingClientRect() { return { top: 0 }; } closest() { return null; }
    replaceChildren(...xs) { this.children = xs; }
  }
  const body = new Node('body'); body.innerHTML = html;
  const toolbar = new Node(), doc = { body, head: new Node('head'), documentElement: new Node(), scrollingElement: { scrollTop: 0 }, visibilityState: 'visible', activeElement: null,
    getElementById: id => nodes.get(id) || null, createElement: t => new Node(t), querySelector: s => s.startsWith('[data-count=') ? new Node() : ['.toolbar', '.topbar', '.toolbar .controls'].includes(s) ? toolbar : s.startsWith('#') && !s.includes(' ') ? nodes.get(s.slice(1)) || null : null,
    querySelectorAll: () => [], addEventListener: (k, fn) => { if (!events.has(k)) events.set(k, []); events.get(k).push(fn); }, dispatchEvent: e => (events.get(e.type) || []).forEach(fn => fn(e)) };
  let config;
  const context = { document: doc, console, TextEncoder, TextDecoder, Buffer, Blob, Headers, Response, URL, URLSearchParams, structuredClone, crypto: crypto.webcrypto, indexedDB: db.indexedDB, performance, navigator: {}, innerHeight: 800, scrollX: 0, scrollY: 0,
    localStorage: { getItem: k => store.get(k) || null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }, location: { protocol: 'https:', hostname: 'example.github.io' },
    alert: m => { throw new Error('alert: ' + m); }, confirm: () => true, CustomEvent: class { constructor(t) { this.type = t; } }, MutationObserver: class { observe() {} },
    FileReader: class { readAsDataURL(blob) { blob.arrayBuffer().then(bytes => { this.result = 'data:' + blob.type + ';base64,' + Buffer.from(bytes).toString('base64'); this.onload?.(); }).catch(e => { this.error = e; this.onerror?.(); }); } },
    scrollTo() {}, addEventListener() {}, requestAnimationFrame: fn => setImmediate(fn), cancelAnimationFrame: clearImmediate,
    setInterval: () => { throw new Error('unexpected legacy polling'); }, clearInterval() {},
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); timers.add(t); return t; }, clearTimeout,
    fetch: async (url, opts = {}) => {
      network.push({ url, method: opts.method || 'GET' });
      if (String(url).startsWith('data:')) return fetch(url, opts);
      if (String(url).includes('supabase.co')) {
        if (String(url).includes('/object/list/')) return Response.json([]);
        if (String(url).includes('/flashcards_sync')) return Response.json([]);
        return new Response('', { status: 404 });
      }
      if (String(url).includes('googleapis.com')) return server.fetch(url, opts);
      const name = String(url).split('?')[0];
      const localFile = path.resolve(path.dirname(file), name);
      if (fs.existsSync(localFile) && fs.statSync(localFile).isFile()) return new Response(fs.readFileSync(localFile), { headers: { 'Content-Type': 'application/json' } });
      if (name.endsWith('.json')) return Response.json({ cards: [] });
      throw new Error('unexpected fetch ' + url);
    },
    google: { accounts: { oauth2: { hasGrantedAllScopes: () => true, initTokenClient: x => ({ requestAccessToken: () => x.callback({ access_token: 'mock', expires_in: 3600 }) }) } } }
  };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'drive-core.js'), 'utf8'), context);
  const actualInstall = context.FlashcardsDrive.install;
  context.FlashcardsDrive = { ...context.FlashcardsDrive, install: cfg => { config = cfg; return actualInstall(cfg); } };
  for (const match of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = match[1].match(/src=["']([^"']+)/)?.[1];
    if (src && src.startsWith('http')) continue;
    if (src && /drive-core\.js/.test(src)) continue;
    const code = src ? fs.readFileSync(path.resolve(path.dirname(file), src.split('?')[0]), 'utf8') : match[2];
    vm.runInContext(code, context, { filename: src || relative + ':inline' });
  }
  const api = context.WordDriveSync || context.PlantDriveSync || context.ColorDriveSync;
  return { context, api, nodes, network, server, db, store, toolbar, get config() { return config; }, evaluate: code => vm.runInContext(code, context), async close() { for (const t of timers) clearTimeout(t); },
    async connect() { context.FLASHCARDS_DRIVE_CONFIG = { clientId: 'test.apps.googleusercontent.com' }; api.open(); await tick(); const d = body.children.find(e => e.querySelector('[data-connect]')); d.querySelector('[data-connect]').onclick(); await api.sync(); }
  };
}
test('word app starts without DOM named globals; Drive primary blocks every legacy write and pull', async () => {
  const a = app('index.html', { word_drive_primary_v1: '1', flashcards_supabase_session_v1: JSON.stringify({ access_token: 'mock', expires_at: Date.now() + 999999, user: { id: 'legacy-user' } }) });
  await a.api.ready;
  await a.evaluate("cloudInsert([{word:'x',meaning:'y'}])"); await a.evaluate("cloudUpdate({id:'x'})"); await a.evaluate("cloudDelete({id:'x'})"); await a.evaluate('syncPull(true)'); await a.evaluate('migrateLocalToCloud()');
  assert.equal(a.network.filter(x => x.url.includes('supabase')).length, 0);
  a.evaluate("cards=[{id:'stable-id',word:'test',meaning:'meaning',sort_order:2}];saveCards()");
  await tick(); const data = await a.config.read(); assert.equal(data['card:stable-id'].word, 'test'); await a.close();
});
test('plant app starts in Drive primary without Supabase uploads and empty image stays empty', async () => {
  const a = app('plants/index.html', { plant_drive_primary_v1: '1', plant_flashcards_seed_loaded_v1: '1', plant_angiosperm_greenlist_v2: '1', plant_nonangio_expand_v1: '1' }); await a.api.ready;
  assert.equal(a.network.filter(x => x.url.includes('supabase')).length, 0);
  assert.equal(await a.evaluate("cloudUploadImage({id:'x'},0,'data:image/png;base64,AA==')"), false);
  assert.equal(await a.evaluate("resolveCardImage({id:'x'},0,'')"), '');
  const first = await a.evaluate("storeImageForCard({id:'x'},0,'data:image/png;base64,AA==')"), second = await a.evaluate("storeImageForCard({id:'x'},0,'data:image/png;base64,AQ==')"); assert.notEqual(first, second);
  assert.equal(await a.evaluate('resolveImageValue(' + JSON.stringify(first) + ')'), 'data:image/png;base64,AA=='); await a.close();
});
test('review47 fixed cards, 940 asset manifest, registered photographs and suppressions are intact', async () => {
  const a = app('colors/index.html'); await a.api.ready;
  const fixed = a.evaluate('JSON.stringify(CARDS)');
  assert.equal(crypto.createHash('sha256').update(fixed).digest('hex'), '713d6e2d1822e926b3946cf173352f32eeabc2a2b6c56b40a115b7ba3791dc93');
  assert.equal(a.evaluate('CARD_IDS.length'), 1000); assert.equal(a.evaluate('CARD_IDS[999]'), 'color-1000');
  const counts = a.evaluate("(()=>{let registered=0,suppressed=0;for(const r of Object.values(RESEARCH_DATA)){for(const p of [r.photo,...Object.values(r.usage_examples||{})]){if(p?.url)registered++;if(p?.display_suppressed_duplicate)suppressed++;}}return {registered,suppressed};})()");
  assert.equal(counts.registered, 1047); assert.equal(counts.suppressed, 107);
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'colors/private-assets-manifest.json'))); assert.equal(Object.keys(manifest.files).length, 940);
  assert.equal(a.evaluate('ROLES.length'), 5); assert.equal(a.evaluate('typeof ColorCardNavTop'), 'object');
  const links = a.evaluate("photoSlot(2,'interior')"); assert.ok(links.includes('Google画像')); assert.ok(links.includes('Pinterest画像')); assert.ok(links.includes(encodeURIComponent('鴇色 インテリア'))); assert.ok(links.includes('target="_blank"'));
  a.evaluate("mark('known')"); const data = await a.config.read(); assert.ok(Object.keys(data).some(k => k.startsWith('study:')));
  assert.equal(a.network.some(x => /\/assets\//.test(x.url)), false); await a.close();
});
test('word adapters exchange additions, edits and deletion in two isolated runtimes', async () => {
  const server = driveServer(), a = app('index.html', {}, server), b = app('index.html', {}, server); await a.api.ready; await b.api.ready; await a.connect(); await b.connect();
  a.evaluate("cards.push({id:'test-card',word:'test',meaning:'PC',sort_order:1});saveCards()"); await a.api.sync(); await b.api.sync(); assert.equal(b.evaluate('cards[0].meaning'), 'PC');
  b.evaluate("cards[0].meaning='phone';saveCards()"); await b.api.sync(); await a.api.sync(); assert.equal(a.evaluate('cards[0].meaning'), 'phone');
  b.evaluate('cards=[];saveCards()'); await b.api.sync(); await a.api.sync(); assert.equal(a.evaluate('cards.length'), 0); await a.close(); await b.close();
});
test('plant adapters exchange images and deletion without resurrecting old images', async () => {
  const server = driveServer(), flags = { plant_flashcards_seed_loaded_v1: '1', plant_angiosperm_greenlist_v2: '1', plant_nonangio_expand_v1: '1' }, a = app('plants/index.html', flags, server), b = app('plants/index.html', flags, server);
  await a.api.ready; await b.api.ready; await a.connect(); await b.connect();
  await a.evaluate("(async()=>{const c={id:'test-plant',name:'テスト',group:'angiosperm',description:'test',sort_order:1};const ref=await storeImageForCard(c,0,'data:image/png;base64,AA==');cards=[withImages(c,[ref,'',''])];saveCards()})()");
  await a.api.sync(); await b.api.sync(); assert.equal(await b.evaluate('resolveImageValue(getImages(cards[0])[0])'), 'data:image/png;base64,AA==');
  await b.evaluate("(async()=>{const ref=await storeImageForCard(cards[0],0,'data:image/png;base64,AQ==');cards[0]=withImages(cards[0],[ref,'','']);saveCards()})()");
  await b.api.sync(); await a.api.sync(); assert.equal(await a.evaluate('resolveImageValue(getImages(cards[0])[0])'), 'data:image/png;base64,AQ==');
  b.evaluate("cards[0]=withImages(cards[0],['','','']);saveCards()"); await b.api.sync(); await a.api.sync(); assert.equal(a.evaluate('getImages(cards[0])[0]'), '');
  assert.equal(await a.evaluate("resolveCardImage(cards[0],0,'')"), ''); await a.close(); await b.close();
});
test('color adapters exchange manual images, origin edits, study progress and restore tombstone', async () => {
  const server = driveServer(), a = app('colors/index.html', {}, server), b = app('colors/index.html', {}, server); await a.api.ready; await b.api.ready; await a.connect(); await b.connect();
  await a.evaluate("(async()=>{manualEdits['color-0001:palette']={data_url:'data:image/png;base64,AA==',label:'test',updated_at:new Date().toISOString()};await persistEdits();await ColorOriginEditor.commit('color-0001','PCの由来編集','manual');mark('known')})()");
  await a.api.sync(); await b.api.sync(); assert.equal(b.evaluate("manualEdits['color-0001:palette'].data_url"), 'data:image/png;base64,AA=='); assert.equal(b.evaluate("ColorOriginEditor.getRecords()['color-0001'].text"), 'PCの由来編集'); assert.ok(b.evaluate("Object.values(progress).includes('known')"));
  await b.evaluate("(async()=>{manualEdits['color-0001:palette']={data_url:'data:image/png;base64,AQ==',label:'replace',updated_at:new Date().toISOString()};await persistEdits();await ColorOriginEditor.commit('color-0001','スマホの由来編集','manual')})()");
  await b.api.sync(); await a.api.sync(); assert.equal(a.evaluate("manualEdits['color-0001:palette'].data_url"), 'data:image/png;base64,AQ=='); assert.equal(a.evaluate("ColorOriginEditor.getRecords()['color-0001'].text"), 'スマホの由来編集');
  await b.evaluate("(async()=>{delete manualEdits['color-0001:palette'];await persistEdits()})()"); await b.api.sync(); await a.api.sync(); assert.equal(a.evaluate("manualEdits['color-0001:palette']"), undefined);
  assert.equal([...server.files.values()].filter(f => f.appProperties.kind === 'image').length, 2); await a.close(); await b.close();
});
module.exports = { app };
