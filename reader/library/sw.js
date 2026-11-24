/* Offline cache for the app shell only. Never cache private Drive book content. */
'use strict';
const CACHE='private-bookshelf-shell-v34-saved-edition-20261124';
const REVISION='wh1-library-v9-20261110';
const local=path=>new URL(path,self.registration.scope).href;
const ASSETS=[
  './index.html','./app.css?v=bookshelf-saved-edition-20261124','./app.js?v=bookshelf-saved-edition-20261124',
  './wh1-reader-routing.js?v='+REVISION,'./wh1-caption-ruby.js',
  './storage.js','./shelf-registration.mjs','../quality/shelf-registration.json','./read.html','./wh3-format.html','./wh1-exact-pagination.js',
  './read-wh1-v9.html','./wh1-pager-v9.js?v='+REVISION,
  './wh1-figure-viewport-v9.js?v='+REVISION,
  './wh1-display-check-v9.js?revision=display-check-v9-1-20261110',
  './manifest.webmanifest','./apple-touch-icon.png'
].map(local);
// Only these public application files are cached. Private book URLs are excluded.
const CURRENT=new Map(ASSETS.map(url=>[new URL(url).pathname,url]));
const INDEX=local('./index.html');
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS.map(url=>new Request(url,{cache:'reload'})))).then(()=>self.skipWaiting()));
});
self.addEventListener('activate', event => {
  // Keep every book, position and earlier shell cache intact.
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', event => {
  const req=event.request,url=new URL(req.url),scope=new URL(self.registration.scope);
  if(req.method!=='GET'||url.origin!==scope.origin||(!url.pathname.startsWith(scope.pathname)&&!CURRENT.has(url.pathname)))return;
  const fallback=url.pathname===scope.pathname?INDEX:CURRENT.get(url.pathname);
  if(!fallback)return;
  if(url.pathname===new URL(local('../quality/shelf-registration.json')).pathname&&url.searchParams.get('current')==='1'){
    event.respondWith(fetch(req,{cache:'no-store'}));return;
  }
  // Match by application pathname, not the book id in the query. A reader
  // navigation keeps its original URL/id while receiving the right HTML shell.
  event.respondWith(fetch(req,{cache:'no-cache'}).then(response=>{
    if(!response.ok)throw Error('Bookshelf application update unavailable');
    const copy=response.clone();event.waitUntil(caches.open(CACHE).then(c=>c.put(fallback,copy)));
    return response;
  }).catch(async()=>await (await caches.open(CACHE)).match(fallback)||Response.error()));
});

