const PREFIX='beauty-deadline:'+self.registration.scope+':';
const CACHE=PREFIX+'v4';
const SHELL=['./','./index.html','./styles.css','./app.js','./dates.js','./db.js','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const url=new URL(e.request.url),scope=new URL(self.registration.scope);
  if(e.request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname))return;
  e.respondWith(fetch(e.request).then(r=>{
    if(r.ok&&r.type!=='opaque'&&!r.redirected){const copy=r.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{}));}
    return r;
  }).catch(()=>caches.open(CACHE).then(c=>c.match(e.request)).then(r=>r||Response.error())));
});
