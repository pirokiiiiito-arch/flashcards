/* Offline cache for the app shell only. Never cache private Drive book content. */
'use strict';
const CACHE='private-bookshelf-shell-v2';
const ASSETS=['./','./index.html','./app.css','./app.js','./storage.js','./read.html','./manifest.webmanifest','./apple-touch-icon.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(x=>new URL(x,self.registration.scope).href))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('private-bookshelf-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const req=event.request,url=new URL(req.url),scope=new URL(self.registration.scope);
  if(url.origin!==scope.origin || !url.pathname.startsWith(scope.pathname)) return;
  if(req.mode==='navigate'){
    event.respondWith(fetch(req).then(response=>{
      if(response.ok){const clone=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(req,clone)));}
      return response;
    }).catch(async()=>await caches.match(req)||await caches.match(new URL('./',scope).href)||Response.error()));
  }else{
    event.respondWith(caches.match(req).then(cached=>cached||fetch(req)));
  }
});
