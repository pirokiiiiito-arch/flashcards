/* Application files only. Never delete or rewrite the private book IndexedDB. */
'use strict';
const CACHE_NAME='wh1-unified-reader-shell-v11-figure-viewport8';
const local=path=>new URL(path,self.registration.scope).toString();
const SHELL_URL=local('index.html');
const REPAIR_URL=local('figure-repair-v8.html');
const MANIFEST_URL=local('manifest.webmanifest');
const ICON_URL=local('apple-touch-icon.png');
const PAGINATION_URL=local('wh1-exact-pagination.js?v=figure-viewport-v8-20261110');
const VIEWPORT_URL=local('wh1-figure-viewport-v8.js?v=figure-viewport-v8-20261110');
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll([SHELL_URL,REPAIR_URL,MANIFEST_URL,ICON_URL,PAGINATION_URL,VIEWPORT_URL].map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('wh1-unified-reader-shell-')&&key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
 let fallback=null;
 if(request.mode==='navigate')fallback=url.pathname.endsWith('/figure-repair-v8.html')?REPAIR_URL:SHELL_URL;
 else if(url.pathname.endsWith('/wh1-exact-pagination.js'))fallback=PAGINATION_URL;
 else if(url.pathname.endsWith('/wh1-figure-viewport-v8.js'))fallback=VIEWPORT_URL;
 if(fallback){
  event.respondWith(fetch(request,{cache:'no-cache'}).then(response=>{
   if(!response.ok)throw Error('Reader application update unavailable');
   const copy=response.clone();event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(fallback,copy)));return response;
  }).catch(async()=>await caches.match(fallback)||Response.error()));
 }else if(url.pathname.endsWith('/manifest.webmanifest')||url.pathname.endsWith('/apple-touch-icon.png')){
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request)));
 }
});
