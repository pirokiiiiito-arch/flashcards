/* World History 1 reader app shell only. Book bytes are never cached by this worker. */
'use strict';
const CACHE_NAME='wh1-unified-reader-shell-v1';
const SHELL_URL=new URL('index.html',self.registration.scope).toString();
const MANIFEST_URL=new URL('manifest.webmanifest',self.registration.scope).toString();
const ICON_URL=new URL('apple-touch-icon.png',self.registration.scope).toString();
self.addEventListener('install',e=>{
  e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll([SHELL_URL,MANIFEST_URL,ICON_URL])).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',e=>{
  e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('wh1-unified-reader-shell-')&&k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',e=>{
  const request=e.request;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
  if(request.mode==='navigate'){
    e.respondWith(fetch(request).then(response=>{
      if(response.ok){const copy=response.clone();e.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(SHELL_URL,copy)));}
      return response;
    }).catch(async()=>{
      const local=await caches.match(SHELL_URL);
      return local||Response.error();
    }));
  }else if(url.pathname.endsWith('/manifest.webmanifest')||url.pathname.endsWith('/apple-touch-icon.png')){
    e.respondWith(caches.match(request).then(local=>local||fetch(request)));
  }
});
