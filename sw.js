// sw.js — Service Worker للتحديث التلقائي (PWA)
// يخزن التطبيق ويحدثه عند وجود version.json جديد
const CACHE_PREFIX = 'nahal-ota-';
let CURRENT_CACHE = CACHE_PREFIX + 'vnew';

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './icon.png',
  './version.json',
  './updater.js'
];

self.addEventListener('install', e=>{
  console.log('[SW] install');
  e.waitUntil(
    caches.open(CURRENT_CACHE).then(c=> c.addAll(ASSETS)).then(()=> self.skipWaiting())
  );
});

self.addEventListener('activate', e=>{
  e.waitUntil(
    caches.keys().then(keys=> Promise.all(
      keys.filter(k=> k.startsWith(CACHE_PREFIX) && k!==CURRENT_CACHE).map(k=> caches.delete(k))
    )).then(()=> self.clients.claim())
  );
});

self.addEventListener('fetch', e=>{
  const url = new URL(e.request.url);
  // لا نكاش version.json — دائما من الشبكة
  if(url.pathname.endsWith('version.json')){
    e.respondWith(fetch(e.request, {cache:'no-store'}).catch(()=> caches.match(e.request)));
    return;
  }
  // حل جذري للوميض والـ cache القديم: app.js و supabase_sync.js و products.json دائماً من الشبكة أولاً
  if(url.pathname.match(/(app\.js|supabase_sync\.js|products\.json)$/)){
    e.respondWith(
      fetch(e.request, {cache:'no-store'}).then(resp=>{
        if(resp.ok){
          const clone = resp.clone();
          caches.open(CURRENT_CACHE).then(c=> c.put(e.request, clone));
        }
        return resp;
      }).catch(()=> caches.match(e.request))
    );
    return;
  }
  e.respondWith(
    caches.match(e.request).then(cached=>{
      const fetched = fetch(e.request).then(resp=>{
        if(resp.ok){
          const clone = resp.clone();
          caches.open(CURRENT_CACHE).then(c=> c.put(e.request, clone));
        }
        return resp;
      }).catch(()=> cached);
      return cached || fetched;
    })
  );
});

// تحديث الكاش عند رسالة من updater.js
self.addEventListener('message', e=>{
  if(e.data && e.data.type==='SKIP_WAITING') self.skipWaiting();
  if(e.data && e.data.type==='UPDATE_CACHE'){
    const ver = e.data.version || 'unknown';
    CURRENT_CACHE = CACHE_PREFIX + 'v' + ver;
    e.waitUntil(caches.open(CURRENT_CACHE).then(c=> c.addAll(ASSETS)));
  }
});
