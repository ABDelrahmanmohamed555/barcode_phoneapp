// sw.js — Service Worker حل جذري للكاش العالق — v4.0
const CACHE_PREFIX = 'nahal-ota-';
let CURRENT_CACHE = CACHE_PREFIX + 'v4.0';

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './icon.png',
  './version.json',
  './updater.js',
  './supabase_sync.js',
  './clear_cache.html'
];

self.addEventListener('install', e=>{
  console.log('[SW v4] install - clearing old caches');
  e.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=> k.startsWith(CACHE_PREFIX) && k!==CURRENT_CACHE).map(k=> caches.delete(k))))
    .then(()=> caches.open(CURRENT_CACHE).then(c=> c.addAll(ASSETS).catch(()=>{}))).then(()=> self.skipWaiting())
  );
});

self.addEventListener('activate', e=>{
  console.log('[SW v4] activate - purge');
  e.waitUntil(
    caches.keys().then(keys=> Promise.all(
      keys.filter(k=> k.startsWith(CACHE_PREFIX) && k!==CURRENT_CACHE).map(k=> { console.log('[SW] delete',k); return caches.delete(k); })
    )).then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  // version.json دائماً من الشبكة
  if(url.pathname.endsWith('version.json')){
    e.respondWith(fetch(e.request, {cache:'no-store'}).catch(()=> caches.match(e.request)));
    return;
  }
  // كل ملفات JS/CSS/HTML دائماً من الشبكة أولاً لمنع التصاق النسخ القديمة
  if(url.pathname.match(/(app\.js|supabase_sync\.js|updater\.js|index\.html|clear_cache\.html|style\.css)$/)){
    e.respondWith(
      fetch(e.request, {cache:'no-store'}).then(resp=>{
        if(resp.ok){
          const clone = resp.clone();
          caches.open(CURRENT_CACHE).then(c=> c.put(e.request, clone)).catch(()=>{});
        }
        return resp;
      }).catch(()=> caches.match(e.request).then(cached=> cached || fetch(e.request).catch(()=> new Response('',{status:503}))))
    );
    return;
  }
  // الباقي: network first ثم cache
  e.respondWith(
    fetch(e.request, {cache:'no-store'}).then(resp=>{
      if(resp.ok){
        const clone = resp.clone();
        caches.open(CURRENT_CACHE).then(c=> c.put(e.request, clone)).catch(()=>{});
      }
      return resp;
    }).catch(()=> caches.match(e.request))
  );
});

self.addEventListener('message', e=>{
  if(e.data && e.data.type==='SKIP_WAITING') self.skipWaiting();
  if(e.data && e.data.type==='UPDATE_CACHE'){
    const ver = e.data.version || 'unknown';
    CURRENT_CACHE = CACHE_PREFIX + 'v' + ver;
    e.waitUntil(caches.open(CURRENT_CACHE).then(c=> c.addAll(ASSETS).catch(()=>{})));
  }
  if(e.data && e.data.type==='NUKE_ALL'){
    e.waitUntil(caches.keys().then(keys=> Promise.all(keys.map(k=> caches.delete(k)))));
  }
});
