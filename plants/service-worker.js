const CACHE="plant-flashcards-v28";
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(["./","./index.html","./manifest.webmanifest","./data.json","./data-angio-extra-1.json","./data-angio-extra-2.json","./data-angio-extra-3.json","./data-angio-extra-4.json","./data-angio-extra-5.json","./data-nonangio-extra.json","./drive-sync.js"])));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  if(e.request.mode==="navigate"){e.respondWith(fetch(e.request).then(r=>{const c=r.clone();caches.open(CACHE).then(x=>x.put("./index.html",c));return r}).catch(()=>caches.match("./index.html")));return}
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});