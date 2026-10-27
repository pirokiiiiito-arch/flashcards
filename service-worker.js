const CACHE = 'flashcards-v17-word-network2';
const BUILD = '20261028-network2';
const STATIC = ['./', './index.html', './word-sync-v2.html', './manifest.webmanifest', './icon.svg', './drive-config.js?v=' + BUILD, './drive-core.js?v=' + BUILD, './drive-sync.js?v=' + BUILD, './word-recovery.js?v=' + BUILD, './word-network-recovery.js?v=' + BUILD];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('flashcards-v') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url), scope = new URL(self.registration.scope);
  if (r.method !== 'GET' || u.origin !== scope.origin || !u.pathname.startsWith(scope.pathname)) return;
  // Never substitute the word app for /plants/ or /colors/. IndexedDB/localStorage are untouched.
  if (u.pathname.slice(scope.pathname.length).includes('/')) return;
  e.respondWith(fetch(new Request(r, { cache: 'no-store' })).then(async response => {
    if (response.ok && response.type === 'basic') { const c = await caches.open(CACHE); await c.put(r, response.clone()); }
    return response;
  }).catch(async () => {
    const c = await caches.open(CACHE); return await c.match(r) || (r.mode === 'navigate' ? await c.match('./index.html') : null) || Response.error();
  }));
});
