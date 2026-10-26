const vm = require('node:vm');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { test } = require('node:test');
const source = fs.readFileSync(__dirname + '/../drive-core.js', 'utf8');
const tick = () => new Promise(r => setImmediate(r));
class Element {
  constructor(tag = 'div') { this.tagName = tag.toUpperCase(); this.children = []; this.style = {}; this.dataset = {}; this.attributes = {}; this._selectors = new Map(); this.value = ''; this.disabled = false; this.classList = { toggle() {}, add() {}, remove() {}, contains() { return false; } }; }
  set innerHTML(s) { this._html = s; for (const m of s.matchAll(/data-([\w-]+)(?:[\s=>])/g)) this._selectors.set('[data-' + m[1] + ']', new Element()); }
  get innerHTML() { return this._html || ''; }
  appendChild(x) { this.children.push(x); return x; }
  append(...xs) { this.children.push(...xs); }
  querySelector(s) { return this._selectors.get(s) || null; }
  querySelectorAll() { return []; }
  setAttribute(k, v) { this.attributes[k] = v; }
  removeAttribute(k) { delete this.attributes[k]; }
  addEventListener() {}
  showModal() { this.open = true; }
  close() { this.open = false; }
  click() { this.onclick?.(); }
}
function database() {
  const dbs = new Map();
  const indexedDB = { open(name) {
    const req = {};
    setImmediate(() => {
      const fresh = !dbs.has(name); if (fresh) dbs.set(name, new Map());
      const stores = dbs.get(name);
      req.result = {
        objectStoreNames: { contains: n => stores.has(n) }, createObjectStore: n => stores.set(n, new Map()), close() {},
        transaction(n) {
          const tx = { objectStore() { const store = stores.get(n); return {
            get(k) { const r = {}; setImmediate(() => { r.result = structuredClone(store.get(k)); r.onsuccess?.(); tx.oncomplete?.(); }); return r; },
            put(v, k) { const r = {}; setImmediate(() => { store.set(k, structuredClone(v)); r.result = k; tx.oncomplete?.(); }); return r; }
          }; } }; return tx;
        }
      };
      if (fresh) req.onupgradeneeded?.(); req.onsuccess?.();
    }); return req;
  } }; return { indexedDB, dbs };
}
function driveServer() {
  const files = new Map(), requests = []; let n = 0;
  return { files, requests, fail: false,
    async fetch(url, opts = {}, account = 'account1') {
      url = new URL(url); const method = opts.method || 'GET'; requests.push({ url: String(url), method });
      if (this.fail) return Response.json({ error: { message: 'expired' } }, { status: 401 });
      assert.ok(opts.headers.get('Authorization').startsWith('Bearer '));
      if (url.pathname.endsWith('/about')) return Response.json({ user: { permissionId: this.account || account } });
      if (url.hostname === 'www.googleapis.com' && url.pathname === '/upload/drive/v3/files') {
        assert.equal(method, 'POST');
        const boundary = opts.headers.get('Content-Type').split('boundary=')[1]; const bytes = Buffer.from(await opts.body.arrayBuffer());
        const start = bytes.indexOf('\r\n\r\n') + 4, metaEnd = bytes.indexOf('\r\n--' + boundary, start), metadata = JSON.parse(bytes.subarray(start, metaEnd));
        const contentStart = bytes.indexOf('\r\n\r\n', metaEnd + 2) + 4, end = bytes.indexOf('\r\n--' + boundary, contentStart);
        const content = bytes.subarray(contentStart, end), id = 'file' + (++n), md5Checksum = crypto.createHash('md5').update(content).digest('hex');
        files.set(id, { ...metadata, id, md5Checksum, content }); return Response.json({ id, md5Checksum });
      }
      if (url.pathname === '/drive/v3/files') {
        assert.equal(url.searchParams.get('spaces'), 'appDataFolder'); const q = url.searchParams.get('q');
        const predicates = [...q.matchAll(/key='([^']+)' and value='([^']+)'/g)]; const name = q.match(/name='([^']+)'/);
        let rows = [...files.values()].filter(f => (!name || f.name === name[1]) && predicates.every(([, k, v]) => f.appProperties[k] === v));
        const offset = Number(url.searchParams.get('pageToken') || 0), pageSize = 2, page = rows.slice(offset, offset + pageSize).map(({ content, ...f }) => f);
        return Response.json({ files: page, ...(offset + pageSize < rows.length ? { nextPageToken: String(offset + pageSize) } : {}) });
      }
      const id = url.pathname.split('/').pop(); if (files.has(id)) { const f = files.get(id); return new Response(f.content, { headers: { 'Content-Type': f.mimeType } }); }
      throw new Error('Unexpected request ' + method + ' ' + url);
    }
  };
}
function replica(server, initial = {}, options = {}) {
  const db = options.db || database(), storage = options.storage || new Map(), body = new Element('body'), toolbar = new Element(), docEvents = new Map(), winEvents = new Map();
  let authCallback, tokenRequests = 0, primary = false, local = structuredClone(initial), gate;
  const document = { body, head: new Element('head'), visibilityState: 'visible', createElement: t => new Element(t), querySelector: () => toolbar, addEventListener: (k, f) => docEvents.set(k, f) };
  const context = { console, document, indexedDB: db.indexedDB, crypto: crypto.webcrypto, TextEncoder, TextDecoder, Blob, Headers, Response, URL, URLSearchParams, structuredClone, location: { protocol: 'https:', hostname: 'example.github.io' }, localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, String(v)) },
    fetch: (url, opts) => server.fetch(url, opts, options.account || 'account1'),
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); t.unref(); return t; }, clearTimeout,
    addEventListener: (k, f) => winEvents.set(k, f), FLASHCARDS_DRIVE_CONFIG: { clientId: 'test.apps.googleusercontent.com' },
    google: { accounts: { oauth2: { hasGrantedAllScopes: () => true, initTokenClient: x => { authCallback = x.callback; return { requestAccessToken: () => { tokenRequests++; return authCallback({ access_token: 'mock-token', expires_in: 3600 }); } }; } } } }
  };
  context.window = context; vm.createContext(context); vm.runInContext(source, context);
  const api = context.FlashcardsDrive.install({ namespace: options.namespace || 'unit-test', toolbar: '.toolbar', ready: Promise.resolve(), primary: () => primary, enablePrimary: () => { primary = true; },
    read: () => structuredClone(local), timestamps: () => options.timestamps || {}, toCloudValue: options.toCloudValue || (async (k, v) => v), legacy: options.legacy || [],
    prepareApply: async view => { if (gate) { const g = gate; gate = null; await g; } return view.data; },
    apply: data => { local = structuredClone(data); }
  });
  return { api, context, db, storage, docEvents, winEvents, get local() { return local; }, set local(v) { local = structuredClone(v); api.changed(); }, setGate: p => { gate = p; }, get tokenRequests() { return tokenRequests; },
    async connect() { toolbar.children[0].onclick(); await tick(); const dialog = body.children[0]; await dialog.querySelector('[data-connect]').onclick(); await api.sync(); },
    async off() { body.children[0].querySelector('[data-off]').onclick(); }
  };
}

module.exports = { Element, database, driveServer, replica, tick };
