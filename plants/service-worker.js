const CACHE = 'plant-flashcards-v33-description-photos';
const STATIC = ['./', './index.html', './manifest.webmanifest', './data.json', './data-angio-extra-1.json', './data-angio-extra-2.json', './data-angio-extra-3.json', './data-angio-extra-4.json', './data-angio-extra-5.json', './data-nonangio-extra.json', './drive-sync.js?v=3', './drive-image-copy.js?v=1', '../drive-config.js?v=3', '../persistent-drive-auth.js?v=1', '../drive-core.js?v=persist1', '../auth-only-ui.js?v=persist1', '../auth-only-ui.css?v=persist1'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('plant-flashcards-v') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url), scope = new URL(self.registration.scope);
  if (r.method !== 'GET' || u.origin !== scope.origin) return;
  if (!u.pathname.startsWith(scope.pathname) && !/\/(?:drive-(?:core|config)|persistent-drive-auth|auth-only-ui)\.(?:js|css)$/.test(u.pathname)) return;
  e.respondWith(fetch(new Request(r, { cache: 'no-cache' })).then(async response => {
    if (response.ok && response.type === 'basic') { const c = await caches.open(CACHE); await c.put(r, response.clone()); }
    return response;
  }).catch(async () => {
    const c = await caches.open(CACHE); return await c.match(r) || (r.mode === 'navigate' ? await c.match('./index.html') : null) || Response.error();
  }));
});
