// sw.js — Service Worker V2 — يدعم OTA سحابي 100% (أيقونة/اسم/HTML جذري)
const CACHE_PREFIX = 'nahal-ota-';
let CURRENT_CACHE = CACHE_PREFIX + 'v3.11';
// نسخة سحابية قد تُحدث عبر postMessage UPDATE_CACHE

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

function compareVer(a,b){
  const pa=String(a).replace(/^v/,'').split('.').map(x=>parseInt(x,10)||0);
  const pb=String(b).replace(/^v/,'').split('.').map(x=>parseInt(x,10)||0);
  const len=Math.max(pa.length,pb.length);
  for(let i=0;i<len;i++){ const av=pa[i]||0,bv=pb[i]||0; if(av>bv) return 1; if(av<bv) return -1; }
  return 0;
}
self.addEventListener('install', e=>{
  console.log('[SW 3.11] install - OTA V2');
  e.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=>{
      if(!k.startsWith(CACHE_PREFIX)) return false;
      if(k===CURRENT_CACHE) return false;
      // احذف فقط الكاش الأقدم من الحالي — احتفظ بالأحدث (OTA مستقبلي)
      try{
        const vOld=k.replace(CACHE_PREFIX,'');
        const vCur=CURRENT_CACHE.replace(CACHE_PREFIX,'');
        return compareVer(vOld, vCur) < 0;
      }catch(e){ return true; }
    }).map(k=> caches.delete(k))))
    .then(()=> caches.open(CURRENT_CACHE).then(c=> c.addAll(ASSETS).catch(()=>{}))).then(()=> self.skipWaiting())
  );
});

self.addEventListener('activate', e=>{
  console.log('[SW 3.11] activate');
  e.waitUntil(
    caches.keys().then(keys=> Promise.all(
      keys.filter(k=>{
        if(!k.startsWith(CACHE_PREFIX)) return false;
        if(k===CURRENT_CACHE) return false;
        try{
          const vOld=k.replace(CACHE_PREFIX,'');
          const vCur=CURRENT_CACHE.replace(CACHE_PREFIX,'');
          return compareVer(vOld, vCur) < 0;
        }catch(e){ return false; }
      }).map(k=> { console.log('[SW] delete old',k); return caches.delete(k); })
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
  // OTA cache أولاً: لو الملف موجود في أي ota-v* cache أرجعه مباشرة (سحابي 100%)
  // هذا يسمح بتحديث جذري حتى لو الشبكة مقطوعة بعد OTA
  const otaMatch = caches.keys().then(keys=>{
    const otaKeys=keys.filter(k=>k.startsWith(CACHE_PREFIX));
    // ابحث من الأحدث للأقدم
    otaKeys.sort((a,b)=> compareVer(b.replace(CACHE_PREFIX,''), a.replace(CACHE_PREFIX,'')));
    return Promise.all(otaKeys.map(k=> caches.open(k).then(c=> c.match(e.request)))).then(results=> results.find(r=>r) || null);
  });
  // كل ملفات JS/CSS/HTML/manifest/icon دائماً network first لكن مع fallback لـ OTA cache ثم cache العادي
  if(url.pathname.match(/(app\.js|supabase_sync\.js|updater\.js|index\.html|clear_cache\.html|style\.css|manifest\.json|icon\.png)$/)){
    e.respondWith(
      fetch(e.request, {cache:'no-store'}).then(resp=>{
        if(resp.ok){
          const clone = resp.clone();
          caches.open(CURRENT_CACHE).then(c=> c.put(e.request, clone)).catch(()=>{});
        }
        return resp;
      }).catch(()=> otaMatch.then(ota=> ota || caches.match(e.request).then(cached=> cached || fetch(e.request).catch(()=> new Response('',{status:503})))))
    );
    return;
  }
  // الباقي: network first ثم OTA cache ثم cache
  e.respondWith(
    fetch(e.request, {cache:'no-store'}).then(resp=>{
      if(resp.ok){
        const clone = resp.clone();
        caches.open(CURRENT_CACHE).then(c=> c.put(e.request, clone)).catch(()=>{});
      }
      return resp;
    }).catch(()=> otaMatch.then(ota=> ota || caches.match(e.request)))
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
