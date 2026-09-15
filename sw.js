// sw.js — Service Worker V4.7 — المزامنة فقط بدون إشعارات
const CACHE_PREFIX = 'nahal-ota-';
let CURRENT_CACHE = CACHE_PREFIX + 'v4.12';

// إعدادات Supabase الافتراضية — fallback حتى قبل وصول SYNC_CONFIG من الصفحة
const DEFAULT_SUPA_URL = 'https://vseycanfadblfmkevoqe.supabase.co';
const DEFAULT_SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzZXljYW5mYWRibGZta2V2b3FlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODk0Mzk4NywiZXhwIjoyMTA0NTE5OTg3fQ.XX6gBLx6t5exMwk0xqnOY8nMSZ00oHq9qdj2jdo223g';

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
  './push_notifications.js',
  './fcm_manager.js',
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
  console.log('[SW 4.12] install');
  e.waitUntil(
    caches.keys().then(keys=> Promise.all(keys.filter(k=>{
      if(!k.startsWith(CACHE_PREFIX)) return false;
      if(k===CURRENT_CACHE) return false;
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
  console.log('[SW 4.12] activate');
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
  if(url.hostname.includes('supabase.co') || url.hostname.includes('supabase.') || url.pathname.includes('/rest/v1/') || url.pathname.includes('/realtime/') || url.pathname.includes('/auth/v1/')){
    e.respondWith(fetch(e.request, {cache:'no-store'}).catch(()=> new Response(JSON.stringify([]), {status: 503, headers:{'Content-Type':'application/json'}})));
    return;
  }
  if(url.hostname.includes('githubusercontent.com') || url.hostname.includes('api.github.com')){
    e.respondWith(fetch(e.request, {cache:'no-store'}).catch(()=> caches.match(e.request)));
    return;
  }
  if(url.pathname.endsWith('version.json')){
    e.respondWith(fetch(e.request, {cache:'no-store'}).catch(()=> caches.match(e.request)));
    return;
  }
  const otaMatch = caches.keys().then(keys=>{
    const otaKeys=keys.filter(k=>k.startsWith(CACHE_PREFIX));
    otaKeys.sort((a,b)=> compareVer(b.replace(CACHE_PREFIX,''), a.replace(CACHE_PREFIX,'')));
    return Promise.all(otaKeys.map(k=> caches.open(k).then(c=> c.match(e.request)))).then(results=> results.find(r=>r) || null);
  });
  if(url.pathname.match(/(app\.js|supabase_sync\.js|updater\.js|push_notifications\.js|fcm_manager\.js|index\.html|clear_cache\.html|style\.css|manifest\.json|icon\.png)$/)){
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
  e.respondWith(
    fetch(e.request, {cache:'no-store'}).then(resp=>{
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

// === مزامنة خلفية ذاتية — تخزين إعدادات Supabase داخل SW ===
let _bgSupaUrl = null;
let _bgSupaKey = null;
let _bgLastCount = null;
let _bgLastBarcodes = null;
const BG_DB = 'nahal-bg-sync';
const BG_STORE = 'state';
function _bgIDB(){
  return new Promise((res, rej)=>{
    try{
      const req = indexedDB.open(BG_DB, 1);
      req.onupgradeneeded = ()=>{ try{ req.result.createObjectStore(BG_STORE); }catch(e){} };
      req.onsuccess = ()=> res(req.result);
      req.onerror = ()=> rej(req.error);
    }catch(e){ rej(e); }
  });
}
async function _bgSaveConfig(url, key){
  _bgSupaUrl = url; _bgSupaKey = key;
  try{
    const db = await _bgIDB();
    const tx = db.transaction(BG_STORE,'readwrite');
    tx.objectStore(BG_STORE).put(url, 'supa_url');
    tx.objectStore(BG_STORE).put(key, 'supa_key');
    console.log('[SW BG] config saved', url.slice(0,30));
  }catch(e){ console.warn('[SW BG] save config fail', e.message); }
}
async function _bgLoadConfig(){
  if(_bgSupaUrl && _bgSupaKey) return {url:_bgSupaUrl, key:_bgSupaKey};
  try{
    const db = await _bgIDB();
    const tx = db.transaction(BG_STORE,'readonly');
    const get = (k)=> new Promise(r=>{
      const req=tx.objectStore(BG_STORE).get(k);
      req.onsuccess=()=>r(req.result); req.onerror=()=>r(null);
    });
    const u = await get('supa_url');
    const k = await get('supa_key');
    if(u && k){ _bgSupaUrl=u; _bgSupaKey=k; return {url:u,key:k}; }
  }catch(e){ console.warn('[SW BG] load IDB fail', e.message); }
  // fallback للافتراضي — يضمن عمل الخلفية حتى قبل أول رسالة SYNC_CONFIG
  if(DEFAULT_SUPA_URL && DEFAULT_SUPA_KEY){
    console.log('[SW BG] use DEFAULT config');
    _bgSupaUrl = DEFAULT_SUPA_URL;
    _bgSupaKey = DEFAULT_SUPA_KEY;
    return {url: DEFAULT_SUPA_URL, key: DEFAULT_SUPA_KEY};
  }
  return null;
}
async function _bgGetLastState(){
  if(_bgLastCount!==null) return {count:_bgLastCount, barcodes:_bgLastBarcodes};
  try{
    const db=await _bgIDB();
    const tx=db.transaction(BG_STORE,'readonly');
    const get=(k)=>new Promise(r=>{ const req=tx.objectStore(BG_STORE).get(k); req.onsuccess=()=>r(req.result); req.onerror=()=>r(null); });
    const c=await get('last_count');
    const b=await get('last_barcodes');
    if(c!==undefined && c!==null){ _bgLastCount=c; _bgLastBarcodes=b; return {count:c, barcodes:b}; }
  }catch(e){}
  return {count:null, barcodes:null};
}
async function _bgSaveLastState(count, barcodes){
  _bgLastCount=count; _bgLastBarcodes=barcodes;
  try{
    const db=await _bgIDB();
    const tx=db.transaction(BG_STORE,'readwrite');
    tx.objectStore(BG_STORE).put(count,'last_count');
    tx.objectStore(BG_STORE).put(barcodes,'last_barcodes');
  }catch(e){}
}
async function _bgFetchAndNotify(){
  const cfg = await _bgLoadConfig();
  if(!cfg || !cfg.url || !cfg.key){
    console.log('[SW BG] لا يوجد إعداد Supabase — محاولة جلب من clients');
    try{
      const clientsList = await clients.matchAll({type:'window', includeUncontrolled:true});
      if(clientsList.length>0){
        clientsList[0].postMessage({type:'REQUEST_SYNC_CONFIG'});
        clientsList[0].postMessage({type:'DO_BG_SYNC'});
      } else {
        console.log('[SW BG] لا يوجد clients — استخدام DEFAULT');
        // حاول مرة أخرى مع DEFAULT
        if(DEFAULT_SUPA_URL){
          const r = await fetch(DEFAULT_SUPA_URL + '/rest/v1/products?select=*&order=id.desc', {
            headers:{'apikey': DEFAULT_SUPA_KEY, 'Authorization':'Bearer '+DEFAULT_SUPA_KEY},
            cache:'no-store'
          });
          if(r.ok){
            const data = await r.json();
            if(Array.isArray(data)){
              const newCount=data.length;
              const newBarcodes=JSON.stringify(data.map(p=>p.barcode).sort());
              const last=await _bgGetLastState();
              if(last.count===null){ await _bgSaveLastState(newCount,newBarcodes); return; }
              if(newCount>last.count && newBarcodes!==last.barcodes){
                const diff=newCount-last.count;
                console.log('[SW BG] جديد بدون إشعار', diff, '— مزامنة فقط');
                try{
                  const cl = await clients.matchAll({type:'window', includeUncontrolled:true});
                  cl.forEach(c=> c.postMessage({type:'BG_PRODUCTS_UPDATED', count:newCount}));
                }catch(e){}
              }
              await _bgSaveLastState(newCount,newBarcodes);
            }
          }
        }
      }
    }catch(e){ console.log('[SW BG] fallback fail', e.message); }
    return;
  }
  try{
    const r = await fetch(cfg.url + '/rest/v1/products?select=*&order=id.desc', {
      headers:{'apikey': cfg.key, 'Authorization':'Bearer '+cfg.key},
      cache:'no-store'
    });
    if(!r.ok) throw new Error('HTTP '+r.status);
    const data = await r.json();
    if(!Array.isArray(data)) return;
    const newCount = data.length;
    const newBarcodes = JSON.stringify(data.map(p=>p.barcode).sort());
    const last = await _bgGetLastState();
    if(last.count===null){
      await _bgSaveLastState(newCount, newBarcodes);
      console.log('[SW BG] تهيئة أولية', newCount);
      return;
    }
    if(newCount > last.count){
      const diff = newCount - last.count;
      if(newBarcodes !== last.barcodes){
        console.log('[SW BG] جديد بدون إشعار', diff, '— مزامنة فقط V4.7');
        try{
          const cl = await clients.matchAll({type:'window', includeUncontrolled:true});
          cl.forEach(c=> c.postMessage({type:'BG_PRODUCTS_UPDATED', count:newCount}));
        }catch(e){}
      }
    } else if(newCount < last.count){
      console.log('[SW BG] حذف', last.count,'->',newCount);
    } else {
      if(newBarcodes !== last.barcodes){
        const oldSet = new Set(JSON.parse(last.barcodes||'[]'));
        const newSet = new Set(data.map(p=>p.barcode));
        const added = [...newSet].filter(x=> !oldSet.has(x));
        if(added.length>0){
          console.log('[SW BG] added via diff بدون إشعار', added[0]);
        } else {
          // تعديل سعر/اسم بدون تغيير عدد — نبه أيضاً
          try{
            const cl2 = await clients.matchAll({type:'window', includeUncontrolled:true});
            if(cl2.length>0) cl2.forEach(c=> c.postMessage({type:'BG_PRODUCTS_UPDATED', count:newCount}));
          }catch(e){}
        }
      }
    }
    await _bgSaveLastState(newCount, newBarcodes);
  }catch(e){
    console.log('[SW BG] fetch fail', e.message);
  }
}

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
  if(e.data && e.data.type==='SYNC_CONFIG'){
    e.waitUntil(_bgSaveConfig(e.data.url, e.data.key));
  }
  if(e.data && e.data.type==='SET_BG_STATE'){
    e.waitUntil(_bgSaveLastState(e.data.count, e.data.barcodes));
  }
  if(e.data && e.data.type==='SHOW_NOTIFICATION'){
    console.log('[SW] SHOW_NOTIFICATION معطل V4.7');
    // معطل — لا إشعارات
  }
  if(e.data && e.data.type==='SYNC_PRODUCTS'){
    if(e.data.supabaseUrl && e.data.supabaseKey){
      e.waitUntil(_bgSaveConfig(e.data.supabaseUrl, e.data.supabaseKey).then(()=> _bgFetchAndNotify()));
    } else {
      e.waitUntil(_bgFetchAndNotify());
    }
  }
});

// Push و notificationclick معطلة V4.7 — لا إشعارات
self.addEventListener('push', e=>{
  console.log('[SW] push معطل');
});
self.addEventListener('notificationclick', e=>{
  try{ e.notification.close(); }catch(err){}
});

self.addEventListener('periodicsync', e=>{
  if(e.tag === 'sync-products'){
    console.log('[SW] periodicsync', e.tag);
    e.waitUntil(_bgFetchAndNotify().then(()=>{
      return clients.matchAll({type:'window'}).then(list=>{
        list.forEach(c=> c.postMessage({type:'DO_BG_SYNC'}));
      });
    }));
  }
});
self.addEventListener('sync', e=>{
  if(e.tag === 'sync-products'){
    console.log('[SW] background sync', e.tag);
    e.waitUntil(_bgFetchAndNotify().then(()=>{
      return clients.matchAll({type:'window'}).then(list=>{
        if(list.length>0) list.forEach(c=> c.postMessage({type:'DO_BG_SYNC'}));
      });
    }));
  }
});
