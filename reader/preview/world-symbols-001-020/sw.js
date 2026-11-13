'use strict';
const CACHE='world-symbols-preview-001-020-v8-20261113';
const ENTRY=new URL('./index.html',self.location).href;
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.add(ENTRY)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('world-symbols-preview-001-020-v8-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 if(e.request.mode!=='navigate'||!e.request.url.startsWith(new URL('./',self.location).href))return;
 e.respondWith(fetch(e.request).then(async r=>{if(r.ok)(await caches.open(CACHE)).put(ENTRY,r.clone());return r;}).catch(async()=>{const r=await caches.match(ENTRY);return r||Response.error();}));
});
