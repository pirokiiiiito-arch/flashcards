/* Build adds APP and ASSETS. Scoped to the exact drive-view.html URL prefix,
 * not the editor directory. Contains public app files only, never private photos. */
const CACHE='flashcards-local-view-shell-v1-'+APP;
const absolute=path=>new URL(path,self.location.href).href;
const shell=absolute('./drive-view.html');
const allowed=new Set(ASSETS.map(absolute));
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    // Do not delete existing shell files or any private-photo cache on failure.
    await cache.addAll([...allowed].map(url=>new Request(url,{cache:'reload'})));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url),entry=new URL(shell);
  if(request.method!=='GET'||url.origin!==entry.origin)return;
  const key=request.mode==='navigate'&&url.pathname===entry.pathname?shell:url.href;
  if(!allowed.has(key))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),saved=await cache.match(key);
    if(saved)return saved;
    const result=await fetch(request);
    if(result.ok&&result.type==='basic')await cache.put(key,result.clone()).catch(()=>{});
    return result;
  })());
});
