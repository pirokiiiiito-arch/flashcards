/* Application files only. Never delete or rewrite the private book IndexedDB. */
'use strict';
const CACHE_NAME='wh1-unified-reader-shell-v14-bookshelf-return';
const local=path=>new URL(path,self.registration.scope).toString();
const SHELL_URL=local('index.html');
const REPAIR_URL=local('figure-repair-v9.html');
const LEGACY_REPAIR_URL=local('figure-repair-v8.html');
const CHECK_URL=local('figure-check-v9-1.html');
const MANIFEST_URL=local('manifest.webmanifest');
const ICON_URL=local('apple-touch-icon.png');
const PAGINATION_URL=local('wh1-exact-pagination.js?v=bookshelf-return-20261114-v2');
const VIEWPORT_URL=local('wh1-figure-viewport-v9.js?v=figure-viewport-v9-20261110');
const CHECK_SCRIPT_URL=local('wh1-display-check-v9.js?revision=display-check-v9-1-20261110');
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll([SHELL_URL,MANIFEST_URL,ICON_URL,PAGINATION_URL,VIEWPORT_URL,CHECK_SCRIPT_URL].map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 // Keep previous application caches for already-open documents and rollback.
 // No book database, saved ZIP, localStorage or reading position is touched.
 event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch',event=>{
 const request=event.request,url=new URL(request.url);
 if(request.method!=='GET'||url.origin!==self.location.origin||!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
 let fallback=null;
 if(request.mode==='navigate'){
  if(url.pathname.endsWith('/figure-check-v9-1.html'))fallback=CHECK_URL;
  else fallback=/\/figure-repair-v[89]\.html$/.test(url.pathname)?REPAIR_URL:SHELL_URL;
 }
 else if(url.pathname.endsWith('/wh1-exact-pagination.js'))fallback=PAGINATION_URL;
 else if(url.pathname.endsWith('/wh1-figure-viewport-v9.js'))fallback=VIEWPORT_URL;
 else if(url.pathname.endsWith('/wh1-display-check-v9.js'))fallback=CHECK_SCRIPT_URL;
 if(fallback){
  event.respondWith(fetch(request,{cache:'no-cache'}).then(response=>{
   if(!response.ok)throw Error('Reader application update unavailable');
   const copy=response.clone();event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.put(fallback,copy)));return response;
  }).catch(async()=>await (await caches.open(CACHE_NAME)).match(fallback)||Response.error()));
 }else if(url.pathname.endsWith('/manifest.webmanifest')||url.pathname.endsWith('/apple-touch-icon.png')){
  event.respondWith(caches.open(CACHE_NAME).then(cache=>cache.match(request)).then(cached=>cached||fetch(request)));
 }
});

