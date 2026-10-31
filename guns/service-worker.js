/* Offline shell for the firearm reference cards. No image blobs or OAuth responses cached publicly. */
const CACHE='gun-flashcards-static-v10';
const STATIC=[
 './','./index.html','./style.css?v=10','./data.js?v=3','./app.js?v=7',
 './manifest.webmanifest','./drive-transfer-core.js?v=1','./image-copy.js?v=1',
 './drive-sync.js?v=1','../drive-config.js?v=3','../persistent-drive-auth.js?v=1'
];
self.addEventListener('install',event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(STATIC)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(names=>Promise.all(names.filter(name=>
   name.startsWith('gun-flashcards-static-v')&&name!==CACHE).map(name=>caches.delete(name)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 const scope=new URL(self.registration.scope);
 if(url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
 if(url.pathname.includes('/photos/')||url.pathname.includes('/user-images/'))return;
 event.respondWith(fetch(new Request(request,{cache:'no-store'})).then(async response=>{
   if(response.ok&&response.type==='basic'){
     const cache=await caches.open(CACHE);
     await cache.put(request,response.clone());
   }
   return response;
 }).catch(async()=>{
   const cache=await caches.open(CACHE);
   return await cache.match(request) || (request.mode==='navigate'?await cache.match('./index.html'):null) || Response.error();
 }));
});
