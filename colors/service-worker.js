const CACHE = 'colors1000-review47-drive3-v3';
const STATIC = ['./index.html', './research-data.js?v=3', './progress-data.js?v=3', './origin-editor.js', './manual-edit-compat.js', './drive-sync.js?v=5', './asset-migration.js?v=1', './private-assets-manifest.json?v=2', '../drive-core.js?v=4', '../drive-config.js?v=3'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(STATIC)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('colors1000-review47-drive3-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url), scope = new URL(self.registration.scope);
  if (r.method !== 'GET' || u.origin !== scope.origin || u.pathname.includes('/assets/')) return;
  if (!u.pathname.startsWith(scope.pathname) && !/\/drive-(core|config)\.js$/.test(u.pathname)) return;
  e.respondWith(fetch(new Request(r, { cache: 'no-cache' })).then(async response => {
    if (response.ok && response.type === 'basic') { const c = await caches.open(CACHE); await c.put(r, response.clone()); } return response;
  }).catch(async () => { const c = await caches.open(CACHE); return await c.match(r) || (r.mode === 'navigate' ? await c.match('./index.html') : null) || Response.error(); }));
});
