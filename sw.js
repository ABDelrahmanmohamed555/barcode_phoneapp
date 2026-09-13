// sw.js — Service Worker V2 — يدعم OTA سحابي 100% (أيقونة/اسم/HTML جذري)
const CACHE_PREFIX = 'nahal-ota-';
let CURRENT_CACHE = CACHE_PREFIX + 'v3.23';
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
  console.log('[SW 3.23] install - OTA V2 responsive');
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
  console.log('[SW 3.23] activate');
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
  // === إصلاح جذري: لا تلمس أبداً طلبات Supabase / Realtime / API خارجية — دعها تمر مباشرة للشبكة ===
  // هذه الطلبات يجب ألا تُخزن في Cache أبداً وإلا ترجع بيانات قديمة وتفشل المزامنة
  if(url.hostname.includes('supabase.co') || url.hostname.includes('supabase.') || url.pathname.includes('/rest/v1/') || url.pathname.includes('/realtime/') || url.pathname.includes('/auth/v1/')){
    // Network only — لا cache ولا fallback
    e.respondWith(fetch(e.request, {cache:'no-store'}).catch(()=> new Response(JSON.stringify([]), {status: 503, headers:{'Content-Type':'application/json'}})));
    return;
  }
  if(url.hostname.includes('githubusercontent.com') || url.hostname.includes('api.github.com')){
    e.respondWith(fetch(e.request, {cache:'no-store'}).catch(()=> caches.match(e.request)));
    return;
  }
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
  // الباقي: network first ثم OTA cache ثم cache — لكن لا تخزن أبداً طلبات API خارجية
  e.respondWith(
    fetch(e.request, {cache:'no-store'}).then(resp=>{
      // لا تخزن طلبات API/JSON ديناميكية — فقط أصول ثابتة
      const ct = resp.headers.get('Content-Type') || '';
      const isApi = ct.includes('application/json') && !url.pathname.endsWith('version.json') && !url.pathname.endsWith('manifest.json');
      if(resp.ok && !isApi){
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
  // === واتساب: استقبال طلب إظهار إشعار من الصفحة (Realtime) ===
  if(e.data && e.data.type==='SHOW_NOTIFICATION'){
    const {title, body, tag} = e.data;
    e.waitUntil(
      self.registration.showNotification(title || 'منتج جديد', {
        body: body || 'تمت إضافة منتج جديد',
        icon: './icon.png',
        badge: './icon.png',
        tag: tag || 'new-product',
        vibrate: [200,100,200],
        data: {url: './index.html'},
        requireInteraction: false
      })
    );
  }
  // مزامنة في الخلفية (Background Sync)
  if(e.data && e.data.type==='SYNC_PRODUCTS'){
    e.waitUntil(
      fetch(e.data.supabaseUrl + '/rest/v1/products?select=*&order=id.desc', {
        headers: {'apikey': e.data.supabaseKey, 'Authorization': 'Bearer ' + e.data.supabaseKey},
        cache: 'no-store'
      }).then(r=> r.json()).then(data=>{
        return self.registration.showNotification('مزامنة خلفية', {
          body: `تمت مزامنة ${Array.isArray(data)?data.length:0} منتج`,
          icon: './icon.png',
          tag: 'bg-sync',
          silent: true
        }).catch(()=>{});
      }).catch(()=>{})
    );
  }
});

// === Push API: استقبال Push من Firebase/Supabase حتى لو التطبيق مقفول ===
self.addEventListener('push', e=>{
  console.log('[SW] push received', e);
  let payload = {title: 'منتج جديد', body: 'تمت إضافة منتج جديد'};
  try{
    if(e.data){
      const j = e.data.json();
      payload.title = j.title || j.notification?.title || payload.title;
      payload.body = j.body || j.notification?.body || j.data?.name || payload.body;
      if(j.data) payload.data = j.data;
    }
  }catch(err){
    try{ payload.body = e.data.text(); }catch(_e){}
  }
  e.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: './icon.png',
      badge: './icon.png',
      tag: 'push-product',
      vibrate: [200,100,200],
      data: payload.data || {url: './index.html'},
      requireInteraction: false
    })
  );
});

self.addEventListener('notificationclick', e=>{
  console.log('[SW] notification click', e.notification.tag);
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './index.html';
  e.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(list=>{
      for(const c of list){
        if(c.url.includes('index.html') && 'focus' in c) return c.focus();
      }
      if(clients.openWindow) return clients.openWindow(url);
    })
  );
});

// === Periodic Background Sync (لو مدعوم) ===
self.addEventListener('periodicsync', e=>{
  if(e.tag === 'sync-products'){
    console.log('[SW] periodicsync', e.tag);
    e.waitUntil(
      // سيتم استدعاء مزامنة عبر الرسائل — نحتاج supabase config من clients
      clients.matchAll({type:'window'}).then(clients=>{
        if(clients.length>0){
          clients[0].postMessage({type:'DO_BG_SYNC'});
        }
      })
    );
  }
});
self.addEventListener('sync', e=>{
  if(e.tag === 'sync-products'){
    console.log('[SW] background sync', e.tag);
    e.waitUntil(
      clients.matchAll({type:'window'}).then(clients=>{
        if(clients.length>0) clients[0].postMessage({type:'DO_BG_SYNC'});
        else {
          // fallback: حاول جلب مباشرة لو عندنا config مخزن (يُرسل لاحقاً من الصفحة)
          return fetch('./version.json', {cache:'no-store'}).catch(()=>{});
        }
      })
    );
  }
});
