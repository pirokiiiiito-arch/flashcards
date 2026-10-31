const CACHE = 'flashcards-v21-word-autoauth';
const BUILD = '20261031-word-auto2';
const STATIC = ['./', './index.html', './manifest.webmanifest', './icon.svg', './drive-config.js?v=3', './persistent-drive-auth.js?v=1', './drive-core.js?v=word-auto2', './drive-sync.js?v=word-auto1', './auth-only-ui.js?v=persist1', './auth-only-ui.css?v=persist1', './drive-login.html', './drive-login.js?v=1', './word-recovery.js?v=' + BUILD, './word-network-recovery.js?v=' + BUILD];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => /^flashcards-v\d+(?:-|$)/.test(k) && k !== CACHE && k !== 'flashcards-v18-private-cache-safe').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
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
