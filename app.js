// phone app/app.js — مزامنة جديدة فقط عبر Supabase — نسخة 4.4 إصلاح إشعارات جذري
// السحابة هي المصدر الوحيد — لا منتجات قديمة، لا كاش قديم، لا migration
// تم مسح كل ما يخص المنتجات القديمة والتعارضات

let products=[];
window.products = products; // مرجع للواجهات الأخرى (NotifManager)
let cart=[];
let selected=null;
// مزامنة مرجع window.products تلقائياً بعد كل تحديث
function _syncWindowProducts(){
  try{ window.products = products; }catch(e){}
}

// ===== Toast System — بديل alert() =====
function showToast(msg, type='info', duration=3000){
  try{
    const container = document.getElementById('toastContainer');
    if(!container){
      // fallback لو الحاوية مش موجودة
      alert(msg);
      return;
    }
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    const icons = {success:'✓', error:'✕', warning:'⚠', info:'ℹ'};
    const icon = icons[type] || icons.info;
    toast.innerHTML = '<span class="toast-icon">'+icon+'</span> ' + msg;
    container.appendChild(toast);
    // auto remove
    setTimeout(()=>{
      toast.classList.add('toast-out');
      setTimeout(()=>{ try{ toast.remove(); }catch(e){} }, 300);
    }, duration);
    // إزالة الأقدم لو زاد العدد عن 3
    while(container.children.length > 3){
      try{ container.firstElementChild.remove(); }catch(e){ break; }
    }
  }catch(e){
    try{ alert(msg); }catch(_e){}
  }
}
window.showToast = showToast;

// === سحابة فقط — لا حفظ محلي للمنتجات ===
function _saveLocal(){ /* معطل — سحابة فقط */ }
let _lastTableHash="", _lastUserHash="", _lastPricingHash="", _lastShortageHash="";
function _hashList(arr){
  try{ return JSON.stringify(arr.map(p=> p.id+":"+p.price+":"+p.stock+":"+p.name).join("|")); }catch(e){ return ""; }
}
function _clearCache(){
  try{ localStorage.removeItem('prot_products'); }catch(e){}
  try{ localStorage.removeItem('deleted_barcodes'); }catch(e){}
}
// تنظيف لمرة واحدة: احذف أي كاش محلي قديم للمنتجات (سحابة فقط)
try{
  if(localStorage.getItem('prot_products')){
    console.log('[CLOUD-ONLY] حذف كاش محلي قديم للمنتجات');
    localStorage.removeItem('prot_products');
  }
  localStorage.removeItem('deleted_barcodes');
  localStorage.removeItem('migration_6_fixed_v37');
  localStorage.removeItem('migration_v4_done');
}catch(e){}
// === مسح شامل فوري — جديد فقط ===
function _nukeAllCaches(opts={}){
  const silent = !!opts.silent;
  try{
    try{ localStorage.removeItem('prot_products'); }catch(e){}
    try{ localStorage.removeItem('deleted_barcodes'); }catch(e){}
    try{ localStorage.removeItem('migration_6_fixed_v37'); }catch(e){}
    try{ localStorage.removeItem('migration_v4_done'); }catch(e){}
    try{
      for(let i=localStorage.length-1;i>=0;i--){
        const k=localStorage.key(i);
        if(k && k.startsWith('ota_')) localStorage.removeItem(k);
      }
      localStorage.removeItem('ota_version');
      localStorage.removeItem('ota_github_sha');
      localStorage.removeItem('ota_ignore_version');
    }catch(e){}
    products = [];
    _syncWindowProducts();
    try{ localStorage.setItem('prot_products', JSON.stringify([])); }catch(e){}
    if('caches' in window){
      caches.keys().then(keys=> Promise.all(keys.map(k=> caches.delete(k)))).catch(()=>{});
    }
    try{
      if(window.indexedDB && indexedDB.databases){
        indexedDB.databases().then(dbs=>{ dbs.forEach(db=>{ try{ indexedDB.deleteDatabase(db.name); }catch(e){} }); }).catch(()=>{});
      }
    }catch(e){}
    _lastTableHash=""; _lastUserHash=""; _lastPricingHash=""; _lastShortageHash="";
    if(!silent) console.log('[NUKE] تم مسح كل الكاشات ✓');
  }catch(e){ console.log('[NUKE] fail', e.message); }
}
window.nukeAllData = function(){
  if(confirm('مسح شامل لكل الكاش؟ سيتم إعادة التحميل من السحابة.')){
    _nukeAllCaches();
    try{ localStorage.clear(); }catch(e){}
    try{ localStorage.setItem('prot_products', JSON.stringify([])); }catch(e){}
    if('caches' in window){
      caches.keys().then(keys=> Promise.all(keys.map(k=> caches.delete(k)))).then(()=> location.reload());
      setTimeout(()=> location.reload(), 900);
    } else location.reload();
  }
};
window.forceWipe = function(){
  _nukeAllCaches({silent:true});
  try{ renderUserTable(); renderPricingTable(); renderShortageTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); }catch(e){}
  _setBadge(0);
};
try{
  const _url = location.href || "";
  if(_url.includes('nuke') || _url.includes('clear') || _url.includes('wipe')){
    setTimeout(()=>{ _nukeAllCaches({silent:true}); try{ location.replace(location.pathname); }catch(e){} }, 800);
  }
}catch(e){}

window.forceCloudSync = async ()=>{
  try{
    if(!window.SupabaseSync || !SupabaseSync.isConfigured()){ showToast('Supabase غير مهيأ','warning'); return; }
    _setSyncState('جاري المزامنة...','#c8943a','syncing');
    const d=await SupabaseSync.getProducts();
    _applyProducts(d,'Supabase');
    _setBadge(products.length);
    showToast('تمت المزامنة من السحابة: '+products.length,'success');
  }catch(e){ showToast('فشل: '+e.message,'error'); _setSyncState('فشل المزامنة','#c73e3e','error'); }
};
window.clearLocalCache = ()=>{
  if(confirm('مسح الكاش المحلي وإعادة التحميل من السحابة؟')){
    try{
      _clearCache();
      localStorage.removeItem('deleted_barcodes');
      localStorage.removeItem('migration_6_fixed_v37');
      localStorage.removeItem('migration_v4_done');
      for(let i=localStorage.length-1;i>=0;i--){
        const k=localStorage.key(i);
        if(k && k.startsWith('ota_')) localStorage.removeItem(k);
      }
      localStorage.removeItem('ota_version');
      localStorage.removeItem('ota_github_sha');
      localStorage.removeItem('ota_ignore_version');
    }catch(e){}
    if('caches' in window){
      caches.keys().then(keys=> Promise.all(keys.map(k=> caches.delete(k)))).then(()=> location.reload());
      setTimeout(()=> location.reload(), 900);
    } else location.reload();
  }
};
window.clearAllAppMemory = window.clearLocalCache;

let _supaRealtimeActive = false;
let _lastBadgeCount = -1;
let _syncFailCount = 0;
let _syncRetryId = null;
let _syncInProgress = false;
let _lastSyncTime = 0;
let _consecutiveEmptyCount = 0;
let _lastSuccessTime = Date.now();
let _lastStatusChange = 0;
let _rtDebounceTimer = null;
let _rtPendingData = null;
function _clearSyncRetry(){
  if(_syncRetryId){ clearTimeout(_syncRetryId); _syncRetryId=null; }
}
function _scheduleSyncRetry(){
  // معطل لتقليل التذبذب — الاعتماد على interval 4s الموحد
  _clearSyncRetry();
  _syncRetryId=setTimeout(()=>{ console.log('[SYNC-RETRY] إعادة محاولة 3s'); syncFromApi({force:true}); }, 4000);
}
function _updateSyncDot(state){
  const dot=document.getElementById('syncDot');
  if(!dot) return;
  dot.className='sync-dot ' + state;
}
function _setBadge(count){
  const badge=document.getElementById('syncStatus');
  if(!badge) return;
  const dot=document.getElementById('syncDot');
  const isOk = dot && dot.classList.contains('ok');
  if(_lastBadgeCount === count && isOk) return;
  _lastBadgeCount = count;
  badge.textContent=`مزامن ✓ ${count}`;
  badge.style.color='#3a86c8';
  _updateSyncDot('ok');
  _syncFailCount = 0;
  _clearSyncRetry();
}
function _setSyncState(text, color, dotState){
  const now = Date.now();
  // منع التذبذب: لا تغير الحالة أكثر من مرة كل 1.5 ثانية
  if(now - _lastStatusChange < 1500){
    const dot=document.getElementById('syncDot');
    if(dot && dot.classList.contains(dotState)) return;
  }
  _lastStatusChange = now;
  const badge=document.getElementById('syncStatus');
  if(badge){ badge.textContent=text; badge.style.color=color; }
  _updateSyncDot(dotState);
}

function _applyProducts(newData, source){
  if(!Array.isArray(newData)) return false;
  const normalized = newData.map(p=>({
    id: p.id,
    name: p.name||'',
    barcode: p.barcode||'',
    category: p.category||'عام',
    price: parseFloat(p.price)||0,
    stock: parseInt(p.stock)||0,
    description: p.description||'',
    image_path: p.image_path||'',
    barcode_path: p.barcode_path||'',
    created_at: p.created_at||'',
    updated_at: p.updated_at||''
  })).filter(p=> p.barcode);
  if(normalized.length===0){
    // سحابة فقط — لو السحابة فارغة، لكن قد تكون استجابة عابرة
    _consecutiveEmptyCount = (_consecutiveEmptyCount||0)+1;
    console.warn(`[APPLY] سحابة فارغة ${source} — محاولة ${_consecutiveEmptyCount}/2 (ذاكرة ${products.length})`);
    if(products.length===0){
      _lastTableHash=""; _lastUserHash=""; _lastPricingHash=""; _lastShortageHash="";
      try{ renderUserTable(); renderPricingTable(); renderShortageTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); }catch(e){}
      _setBadge(0);
      return false;
    }
    if(_consecutiveEmptyCount >= 2){
      console.log(`[APPLY] تأكدت سحابة فارغة ${source} بعد محاولتين — مسح الذاكرة (سحابة فقط)`);
      products = [];
      _lastTableHash=""; _lastUserHash=""; _lastPricingHash=""; _lastShortageHash="";
      try{ renderUserTable(); renderPricingTable(); renderShortageTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); }catch(e){}
      _setBadge(0);
      return true;
    } else {
      console.log('[APPLY] سحابة فارغة — احتفاظ بالذاكرة مؤقتاً وإعادة التحقق بعد 2s');
      setTimeout(()=> { _consecutiveEmptyCount=0; syncFromApi({force:true}); }, 2000);
      return false;
    }
  }
  _consecutiveEmptyCount = 0;
  const oldHash = _hashList(products);
  const newHash = _hashList(normalized);
  const same = products.length===normalized.length && products.every(pr=>{
    const np = normalized.find(x=> x.barcode===pr.barcode);
    return np && String(np.price)===String(pr.price) && String(np.stock)===String(pr.stock) && np.name===pr.name;
  });
  if(same && oldHash===newHash){
    return false;
  }
  const prevCount = products.length;
  products = normalized.slice().sort((a,b)=> (b.id||0)-(a.id||0));
  _syncWindowProducts();
  _lastTableHash=""; _lastUserHash=""; _lastPricingHash=""; _lastShortageHash="";
  renderUserTable(); renderPricingTable(); renderShortageTable();
  const tb=document.getElementById('tableBody'); if(tb) renderTable();
  // حدث حالة الخلفية في SW أيضاً
  try{ _updateSWBgState(); }catch(e){}
  console.log(`✓ سحابة ${source}: ${prevCount} -> ${products.length}`);
  return true;
}

async function syncFromApi(opts={}){
  const force = !!(opts && opts.force);
  const now = Date.now();
  // تسريع: السماح بمزامنة كل 500ms بدل 1200ms (بعد إصلاح التداخل)
  if(!force && _syncInProgress){
    console.log('[SYNC] تخطي - مزامنة جارية');
    return;
  }
  if(force && _syncInProgress){
    if(now - _lastSyncTime < 500){
      console.log('[SYNC] force مؤجل 500ms');
      setTimeout(()=> syncFromApi({force:true}), 550);
      return;
    }
  }
  if(!force && now - _lastSyncTime < 800){
    return;
  }
  if(typeof navigator !== 'undefined' && navigator.onLine === false){
    _setSyncState('غير متصل - تحقق من الإنترنت','#c73e3e','error');
    return;
  }
  if(!window.SupabaseSync || !window.SupabaseSync.isConfigured()){
    _setSyncState('غير مهيأ - Supabase','#c8943a','idle');
    return;
  }
  _syncInProgress = true;
  _lastSyncTime = now;
  // سحابة فقط: اعرض "جاري" فقط لو لم يكن مزامن منذ فترة (لمنع الوميض)
  const dotPrev=document.getElementById('syncDot');
  const wasOk = dotPrev && dotPrev.classList.contains('ok');
  const sinceSuccess = now - _lastSuccessTime;
  if(!wasOk && (_syncFailCount>0 || _lastBadgeCount===-1 || sinceSuccess>10000)){
    _setSyncState('جاري المزامنة...','#c8943a','syncing');
  }
  try{
    const data = await SupabaseSync.getProducts();
    if(Array.isArray(data)){
      const changed = _applyProducts(data, 'Supabase');
      _setBadge(products.length);
      _lastSuccessTime = Date.now();
      _syncFailCount = 0;
      _clearSyncRetry();
      // (الإشعارات معطلة V4.7 - لا حاجة)
      // لو Realtime متوقف وحصلت مزامنة ناجحة، حاول إعادة تشغيله
      if(!changed && window.SupabaseSync && window.SupabaseSync.isRealtimeConnected && !window.SupabaseSync.isRealtimeConnected()){
        console.log('[SYNC] Realtime غير متصل — محاولة إعادة تشغيل');
        try{ initSupabaseRealtime(); }catch(e){}
      }
      return;
    } else {
      throw new Error('بيانات غير متوقعة من السحابة');
    }
  }catch(e){
    console.log('Supabase fail', e.message);
    _syncFailCount++;
    const sinceSuccess2 = Date.now() - _lastSuccessTime;
    // لا تظهر "غير متصل" إلا بعد 3 فشلات ومرور 12 ثانية من آخر نجاح (لمنع التذبذب)
    if(_syncFailCount >= 4 && sinceSuccess2 > 12000){
      _setSyncState('غير متصل - السحابة','#c73e3e','error');
    } else if(_syncFailCount >= 2){
      _setSyncState('جاري المزامنة...','#c8943a','syncing');
    }
    // لا تستدعي retry فوري — interval 4s سيتكفل
    return;
  }finally{
    _syncInProgress = false;
  }
}
window.syncFromApi = syncFromApi; // ← كشف عام لـ FCM / NotifManager / SW
window._applyProducts = _applyProducts;

async function apiPostProduct(prod){
  if(!prod.created_at) prod.created_at = _localNow();
  if(!prod.updated_at) prod.updated_at = prod.created_at;
  if(window.SupabaseSync && window.SupabaseSync.isConfigured()){
    try{
      const saved = await SupabaseSync.addProduct(prod);
      if(saved) return saved;
    }catch(e){ console.log('Supabase POST fail', e.message); throw e; }
  }
  throw new Error('Supabase غير متاح - لا يمكن الحفظ');
}

function _localNow(){
  const d=new Date(); const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
async function apiPatchPrice(id, price){
  const now = _localNow();
  if(window.SupabaseSync && window.SupabaseSync.isConfigured()){
    try{
      const saved = await SupabaseSync.updateProduct(id, {price, updated_at: now});
      if(saved) return saved;
    }catch(e){ console.log('Supabase PATCH fail', e.message); throw e; }
  }
  throw new Error('Supabase غير متاح');
}

function initSupabaseRealtime(){
  if(!window.SupabaseSync || !window.SupabaseSync.isConfigured() || !window.SupabaseSync.subscribeRealtime) return;
  // إصلاح جذري: لا تعتمد فقط على Flag — تحقق من حالة الـ socket الفعلية
  try{
    const isAlive = window.SupabaseSync.isRealtimeConnected ? window.SupabaseSync.isRealtimeConnected() : false;
    if(_supaRealtimeActive && isAlive) return;
    // لو Flag مفعل لكن الـ socket ميت → أعد المحاولة
    if(_supaRealtimeActive && !isAlive){
      console.log('[RT] Flag مفعل لكن WS ميت — إعادة اتصال');
      _supaRealtimeActive = false;
    }
    if(_supaRealtimeActive) return;
  }catch(e){}
  try{
    const ok = SupabaseSync.subscribeRealtime((newData)=>{
      _rtPendingData = newData;
      if(_rtDebounceTimer) clearTimeout(_rtDebounceTimer);
      _rtDebounceTimer = setTimeout(()=>{
        const dataToApply = _rtPendingData;
        _rtPendingData = null;
        _rtDebounceTimer = null;
        if(!dataToApply) return;
        if(_syncInProgress){
          console.log('[RT] syncInProgress — تأجيل RT update');
          setTimeout(()=>{ try{ _applyProducts(dataToApply, 'Supabase RT'); _setBadge(products.length); }catch(e){} }, 700);
        } else {
          console.log('[Supabase RT] onChange debounced', dataToApply.length);
          _applyProducts(dataToApply, 'Supabase RT');
          _setBadge(products.length);
        }
      }, 450);
    });
    if(ok){
      _supaRealtimeActive = true;
      console.log('✓ Supabase Realtime مفعل');
      // راقب حالة الاتصال كل فترة وصحح Flag لو انقطع
      setTimeout(()=>{
        try{
          const alive = window.SupabaseSync.isRealtimeConnected ? window.SupabaseSync.isRealtimeConnected() : true;
          if(!alive){
            console.warn('[RT] فشل الاتصال بعد 5s — إعادة محاولة');
            _supaRealtimeActive = false;
          }
        }catch(e){}
      }, 5000);
    }
  }catch(e){ console.log('RT init fail', e.message); _supaRealtimeActive = false; }
}
function _checkRealtimeHealth(){
  try{
    if(!window.SupabaseSync || !window.SupabaseSync.isRealtimeConnected) return;
    const alive = window.SupabaseSync.isRealtimeConnected();
    if(!alive && _supaRealtimeActive){
      console.warn('[RT-HEALTH] WS ميت — إعادة تشغيل');
      _supaRealtimeActive = false;
      initSupabaseRealtime();
    }
  }catch(e){}
}


function _getEl(id){ try{ return document.getElementById(id); }catch(e){ return null; } }
function _isEligible(p){ try{ const price=parseFloat(p.price); const stock=parseInt(p.stock); return price!==0 && !isNaN(price) && p.price!=='' && p.price!==null && !isNaN(stock) && stock>0; }catch(e){ return false; } }
function _filterEligible(arr){ try{ return (arr||[]).filter(_isEligible); }catch(e){ return []; } }
function _roundPrice(price, mode){ try{ const p=parseFloat(price); if(isNaN(p)) return p; if(mode==='none') return Math.round(p*100)/100; if(mode==='int') return Math.round(p); if(mode==='5') return Math.round(p/5)*5; if(mode==='10') return Math.round(p/10)*10; return Math.round(p*100)/100; }catch(e){ return price; } }
function _matchesQuery(p, q){
  try{
    if(!q) return false;
    const words = q.trim().toLowerCase().split(/\s+/).filter(w=>w);
    if(words.length===0) return false;
    const hay = ((p.name||'') + ' ' + (p.barcode||'') + ' ' + (p.category||'')).toLowerCase();
    // لو كتبت كلمتين، أي منتج فيه إحدى الكلمتين يُطابق (OR) — كما طلبت
    return words.some(w=> hay.includes(w));
  }catch(e){ return false; }
}
function _filterByQuery(arr, q){
  try{
    if(!q || !q.trim()) return [];
    return _filterEligible(arr).filter(p=> _matchesQuery(p, q));
  }catch(e){ return []; }
}
function genBarcode(){
  const prefix="880";
  let base=prefix+Array.from({length:9},()=>Math.floor(Math.random()*10)).join("");
  base=base.slice(0,12);
  let sum=0; for(let i=0;i<12;i++) sum+= parseInt(base[i])*(i%2?3:1);
  const check=(10-(sum%10))%10;
  const bcEl=_getEl('pBarcode'); if(bcEl) bcEl.value=base+check;
  const prev=_getEl('barcodePreview'); if(prev) prev.textContent="معاينة: "+(bcEl? bcEl.value : base+check);
}
function clearForm(){
  const nEl=_getEl('pName'), prEl=_getEl('pPrice'), stEl=_getEl('pStock'), dEl=_getEl('pDesc');
  if(nEl) nEl.value=""; if(prEl) prEl.value=""; if(stEl) stEl.value=""; if(dEl) dEl.value=""; try{ genBarcode(); }catch(e){}
}
async function saveProduct(){
  const nEl=_getEl('pName'), bcEl=_getEl('pBarcode'), catEl=_getEl('pCat'), prEl=_getEl('pPrice'), stEl=_getEl('pStock'), dEl=_getEl('pDesc');
  if(!nEl || !bcEl || !catEl || !prEl || !stEl){ return showToast('واجهة الإضافة غير جاهزة','error'); }
  const name=nEl.value.trim(), barcode=bcEl.value.trim(), cat=catEl.value, price=parseFloat(prEl.value||0), stock=parseInt(stEl.value||0), desc=dEl? dEl.value.trim() : '';
  if(!name) return showToast("ادخل اسم المنتج",'warning');
  try{
    const saved = await apiPostProduct({name, barcode, category:cat, price, stock, description:desc});
    if(saved && saved.id){
      const exists = products.find(p=> p.id===saved.id || p.barcode===saved.barcode);
      if(!exists) products.unshift(saved);
      else Object.assign(exists, saved);
      _syncWindowProducts();
      try{ _updateSWBgState(); }catch(e){}
      renderUserTable();
      if(document.getElementById('tableBody')) renderTable();
      renderPricingTable();
      renderShortageTable();
      _setBadge(products.length);
      clearForm();
      showToast(`تم الحفظ ومزامنته لحظياً ✓ ${saved.name} - ${saved.price} جنيه`,'success',3500);
      setTimeout(()=> syncFromApi({force:true}), 800);
      return;
    }
  }catch(e){
    showToast('فشل الحفظ: '+e.message,'error',4000);
    return;
  }
  showToast('فشل الحفظ - تأكد من الاتصال بالسحابة','error');
}

function renderTable(){
  const searchEl=document.getElementById('search');
  const body=document.getElementById('tableBody');
  if(!body) return;
  const q=(searchEl ? searchEl.value : "").trim().toLowerCase();
  try{
    const curHash = _hashList(products) + "|q:" + q;
    if(curHash === _lastTableHash && body.children.length>0) return;
    _lastTableHash = curHash;
  }catch(e){}
  body.innerHTML="";
  const filtered=products.filter(p=>{
    if(!q) return true;
    if(q && /^\d+$/.test(q)){
      const seq=products.indexOf(p)+1;
      if(String(seq)===q) return true;
      if(String(p.id)===q) return true;
    }
    return p.name.toLowerCase().includes(q) || p.barcode.includes(q);
  });
  filtered.forEach((p,i)=>{
    const seq=products.indexOf(p)+1;
    const row=document.createElement('div'); row.className='row-item';
    row.innerHTML=`
      <span class="w-num">${seq}</span>
      <span class="w-num" style="color:#fff">${p.stock}</span>
      <span class="price">${parseFloat(p.price).toFixed(2)}</span>
      <span>${p.category}</span>
      <span style="font-size:11px">${p.barcode}</span>
      <span>${p.name}</span>
      <span class="w-ctrl ctrl">
        <button class="show" onclick="showBarcode(${p.id})">↻</button>
        <button class="print" onclick="showToast('طباعة ${p.name} - قريباً','info')">🖨</button>
        <button class="edit" onclick="editProd(${p.id})">✏</button>
        <button class="del" onclick="delProd(${p.id})">✕</button>
      </span>`;
    body.appendChild(row);
  });
  if(filtered.length===0) body.innerHTML=`<div style="text-align:center;color:#9e9e9e;padding:20px">لا توجد منتجات</div>`;
}
function editProd(id){ const p=products.find(x=>x.id===id); if(!p) return; const nEl=_getEl('pName'), bcEl=_getEl('pBarcode'), catEl=_getEl('pCat'), prEl=_getEl('pPrice'), stEl=_getEl('pStock'), dEl=_getEl('pDesc'); if(nEl) nEl.value=p.name; if(bcEl) bcEl.value=p.barcode; if(catEl) catEl.value=p.category; if(prEl) prEl.value=p.price; if(stEl) stEl.value=p.stock; if(dEl) dEl.value=p.description||p.desc||""; try{ switchRole('admin'); }catch(e){} try{ window.scrollTo(0,0); }catch(e){} }
function showBarcode(id){
  try{
    const p=products.find(x=>x.id===id);
    if(!p) return showToast('المنتج غير موجود','error');
    const barcode = p.barcode || '';
    const preview=_getEl('barcodePreview');
    if(preview) preview.textContent='باركود: '+barcode;
    showToast('باركود: '+barcode+' — '+p.name,'info',3000);
    console.log('[BARCODE] show', id, barcode);
  }catch(e){ console.warn('showBarcode fail', e.message); try{ showToast('خطأ عرض الباركود','error'); }catch(_){} }
}
window.showBarcode = showBarcode;
function delProd(id){
  const toDel = products.find(p=> p.id===id);
  const bc = toDel ? toDel.barcode : null;
  if(!confirm(`حذف ${toDel?toDel.name:''}؟`)) return;
  if(window.SupabaseSync && window.SupabaseSync.isConfigured()){
    SupabaseSync.deleteProduct(id, bc).then(()=>{
      console.log('✓ حذف من السحابة');
      showToast('تم الحذف ✓','success');
    }).catch(e=>{ showToast('فشل الحذف: '+e.message,'error'); });
  } else {
    showToast('Supabase غير مهيأ','warning');
    return;
  }
  products=products.filter(p=>p.id!==id); _syncWindowProducts(); _saveLocal(); renderUserTable(); renderShortageTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); renderPricingTable(); try{ _updateSWBgState(); }catch(e){}
}

function switchRole(r){
  const map={admin:'viewAdmin', employee:'viewUser', pricing:'viewPricing', shortage:'viewShortage'};
  Object.values(map).forEach(id=>{
    const el=document.getElementById(id);
    if(el){ el.classList.remove('active'); el.style.display='none'; }
  });
  const targetId=map[r];
  const target=document.getElementById(targetId);
  if(target){
    target.style.display='block';
    void target.offsetWidth;
    target.classList.add('active');
  }
  document.getElementById('tabAdmin').classList.toggle('active', r==='admin');
  document.getElementById('tabUser').classList.toggle('active', r==='employee');
  const tabPricing=document.getElementById('tabPricing');
  if(tabPricing) tabPricing.classList.toggle('active', r==='pricing');
  const tabShortage=document.getElementById('tabShortage');
  if(tabShortage) tabShortage.classList.toggle('active', r==='shortage');
  const ul=document.getElementById('userLabel');
  if(ul) ul.textContent='المستخدم: '+(r==='admin'?'admin':'user');
  const tabAdmin=document.getElementById('tabAdmin');
  const tabUser=document.getElementById('tabUser');
  if(tabAdmin) tabAdmin.textContent='اضافة منتج';
  if(tabUser) tabUser.textContent='المنتجات ';
  if(tabPricing) tabPricing.textContent='تسعير منتج';
  if(tabShortage) tabShortage.textContent='النواقص';
  if(r==='employee') {
    renderUserTable();
  }
  if(r==='pricing') {
    syncPricing();
    renderPricingTable();
  }
  if(r==='shortage'){
    syncShortage();
    renderShortageTable();
  }
}
function renderUserTable(){
  const q=((_getEl('searchUser')?.value)||"").trim().toLowerCase();
  const body=document.getElementById('userTableBody');
  if(!body) return;
  try{
    const curHash = _hashList(products.filter(p=> parseFloat(p.price) !== 0)) + "|q:" + q;
    if(curHash === _lastUserHash && body.children.length>0) return;
    _lastUserHash = curHash;
  }catch(e){}
  body.innerHTML="";
  const pricedProducts = products.filter(p=> parseFloat(p.price) !== 0 && p.price !== null && p.price !== '' );
  const filtered=pricedProducts.filter(p=>{
    if(!q) return true;
    if(q && /^\d+$/.test(q)){
      const seq=products.indexOf(p)+1;
      if(String(seq)===q) return true;
      if(String(p.id)===q) return true;
    }
    return p.name.toLowerCase().includes(q) || p.barcode.includes(q);
  });
  filtered.forEach((p,i)=>{
    const seq=products.indexOf(p)+1;
    const row=document.createElement('div'); row.className='row-item';
    row.innerHTML=`
      <span class="w-num">${seq}</span>
      <span class="w-num" style="color:#fff">${p.stock}</span>
      <span class="price">${parseFloat(p.price).toFixed(2)}</span>
      <span>${p.category}</span>
      <span style="font-size:11px;flex:1.2">${p.barcode}</span>
      <span style="flex:1.5">${p.name}</span>
      <span class="w-ctrl" style="flex:0 0 70px;display:flex;gap:4px;justify-content:center">
        <button class="edit" style="width:62px;height:26px;font-size:11px;background:#c8943a;color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="openEditModal(${p.id})" title="تعديل">✏ تعديل</button>
      </span>`;
    // ضغط على الصف نفسه يفتح التعديل
    row.style.cursor='pointer';
    row.addEventListener('click', (e)=>{
      if(e.target.closest('button')) return;
      openEditModal(p.id);
    });
    body.appendChild(row);
  });
  if(filtered.length===0) body.innerHTML=`<div style="text-align:center;color:#9e9e9e;padding:20px">لا توجد منتجات</div>`;
}

// ===== مودال تعديل المنتج (قائمة المنتجات) — V4.6 =====
let _editingProductId = null;
function openEditModal(id){
  const p = products.find(x=> x.id===id);
  if(!p){ showToast('المنتج غير موجود','error'); return; }
  _editingProductId = id;
  const modal = document.getElementById('editModal');
  if(!modal) return;
  // عبئ الحقول
  const nameEl=document.getElementById('editName');
  const barcodeEl=document.getElementById('editBarcode');
  const catEl=document.getElementById('editCategory');
  const priceEl=document.getElementById('editPrice');
  const stockEl=document.getElementById('editStock');
  const descEl=document.getElementById('editDesc');
  const idEl=document.getElementById('editId');
  const hintEl=document.getElementById('editModalHint');
  if(nameEl) nameEl.value = p.name||'';
  if(barcodeEl) barcodeEl.value = p.barcode||'';
  if(catEl) catEl.value = p.category||'عام';
  if(priceEl) priceEl.value = (p.price!=null? String(p.price):'');
  if(stockEl) stockEl.value = (p.stock!=null? String(p.stock):'');
  if(descEl) descEl.value = p.description||p.desc||'';
  if(idEl) idEl.value = String(p.id);
  if(hintEl){ hintEl.style.display='none'; hintEl.textContent=''; }
  modal.style.display='flex';
  document.body.style.overflow='hidden';
  setTimeout(()=>{ if(nameEl) nameEl.focus(); }, 80);
  console.log('[EDIT] فتح', id, p.name);
}
function closeEditModal(){
  const modal=document.getElementById('editModal');
  if(modal) modal.style.display='none';
  document.body.style.overflow='';
  _editingProductId=null;
}
window.openEditModal = openEditModal;
window.closeEditModal = closeEditModal;
// إغلاق بـ ESC
document.addEventListener('keydown', (e)=>{
  if(e.key==='Escape'){
    const m=document.getElementById('editModal');
    if(m && m.style.display!=='none') closeEditModal();
    const b=document.getElementById('bulkModal');
    if(b && b.style.display!=='none') closeBulkModal();
    const d=document.getElementById('discountModal');
    if(d && d.style.display!=='none') closeDiscountModal();
  }
});
async function saveEditModal(){
  const idVal = document.getElementById('editId')?.value;
  const id = idVal ? parseInt(idVal,10) : _editingProductId;
  if(!id) return showToast('معرف غير صالح','error');
  const orig = products.find(x=> x.id===id);
  if(!orig) return showToast('المنتج غير موجود','error');
  const name = (document.getElementById('editName')?.value||'').trim();
  const category = document.getElementById('editCategory')?.value||'عام';
  const priceRaw = document.getElementById('editPrice')?.value;
  const stockRaw = document.getElementById('editStock')?.value;
  const desc = (document.getElementById('editDesc')?.value||'').trim();
  const price = parseFloat(priceRaw);
  const stock = parseInt(stockRaw,10);
  const hintEl=document.getElementById('editModalHint');
  if(!name) return showToast('ادخل اسم المنتج','warning');
  if(isNaN(price) || price<0) return showToast('ادخل سعر صحيح >=0','warning');
  if(isNaN(stock) || stock<0) return showToast('ادخل مخزون صحيح >=0','warning');
  // لا تغيّر الباركود — ثابت
  const patch = {
    name: name,
    category: category,
    price: price,
    stock: stock,
    description: desc,
    barcode: orig.barcode,
    updated_at: _localNow()
  };
  const saveBtn = document.querySelector('#editModal .btn-success');
  if(saveBtn){ saveBtn.disabled=true; saveBtn.textContent='جاري الحفظ...'; }
  try{
    let updated=null;
    if(window.SupabaseSync && window.SupabaseSync.isConfigured()){
      console.log('[EDIT] إرسال للسحابة', id, patch);
      updated = await SupabaseSync.updateProduct(id, patch);
      if(!updated){
        console.warn('[EDIT] updateProduct رجع null — محاولة جلب');
        try{
          const all=await SupabaseSync.getProducts();
          updated = all.find(x=> x.id===id || x.barcode===orig.barcode) || null;
        }catch(e){}
      }
      if(!updated){
        throw new Error('فشل التحديث — تحقق من الاتصال بالسحابة');
      }
    } else {
      throw new Error('Supabase غير مهيأ');
    }
    // حدّث الذاكرة المحلية فوراً
    const p = products.find(x=> x.id===id);
    if(p){
      p.name = updated.name!=null? updated.name : name;
      p.category = updated.category||category;
      p.price = updated.price!=null? updated.price : price;
      p.stock = updated.stock!=null? updated.stock : stock;
      p.description = updated.description!=null? updated.description : desc;
      p.barcode = updated.barcode||orig.barcode;
      p.updated_at = updated.updated_at||patch.updated_at;
    }
    _syncWindowProducts();
    try{ _updateSWBgState(); }catch(e){}
    _lastTableHash=""; _lastUserHash=""; _lastPricingHash=""; _lastShortageHash="";
    renderUserTable();
    renderPricingTable();
    renderShortageTable();
    const tb=document.getElementById('tableBody'); if(tb) renderTable();
    _setBadge(products.length);
    closeEditModal();
    showToast(`تم التعديل ومزامنته ✓ ${name} — ${price} جنيه / ${stock} متاح`,'success',3500);
    // مزامنة فورية للتأكد
    setTimeout(()=> syncFromApi({force:true}), 700);
    if(hintEl){ hintEl.style.display='block'; hintEl.textContent='تم الحفظ ✓'; }
  }catch(e){
    console.error('[EDIT] fail', e);
    showToast('فشل الحفظ: '+e.message,'error',4000);
    if(hintEl){ hintEl.style.display='block'; hintEl.textContent='فشل: '+e.message; hintEl.style.color='#c73e3e'; }
  }finally{
    if(saveBtn){ saveBtn.disabled=false; saveBtn.textContent='حفظ التعديل ✓'; }
  }
}
window.saveEditModal = saveEditModal;

// === إصلاح OTA V4.6.2: مودال HTML لا يصل عبر OTA (index.html معطل) → أنشئه عبر JS + أخفِ زر الكاش ===
function ensureEditModalExists(){
  if(document.getElementById('editModal')) return;
  try{
    const modal = document.createElement('div');
    modal.id='editModal';
    modal.className='edit-modal';
    modal.style.display='none';
    modal.onclick = function(e){ if(e.target===modal) closeEditModal(); };
    modal.innerHTML = `
    <div class="edit-modal-card" role="dialog" aria-modal="true" aria-labelledby="editModalTitle">
      <div class="edit-modal-header">
        <span id="editModalTitle">تعديل المنتج</span>
        <button class="edit-modal-close" onclick="closeEditModal()" aria-label="إغلاق">✕</button>
      </div>
      <div class="edit-modal-body">
        <label class="label">اسم المنتج</label>
        <input id="editName" class="input" placeholder="اسم المنتج"/>
        <label class="label">الباركود (لا يمكن تعديله)</label>
        <input id="editBarcode" class="input" disabled style="opacity:.6;background:#1c2333"/>
        <label class="label">الفئة</label>
        <select id="editCategory" class="input"><option>عام</option><option>أجهزة</option><option>قطع غيار</option><option>إكسسوارات</option><option>أخرى</option></select>
        <div class="row" style="margin-top:8px">
          <div style="flex:1"><label class="label">السعر (جنيه)</label><input id="editPrice" class="input" type="number" inputmode="decimal" placeholder="0.00"/></div>
          <div style="flex:1"><label class="label">المخزون</label><input id="editStock" class="input" type="number" inputmode="numeric" placeholder="0"/></div>
        </div>
        <label class="label">الوصف (اختياري)</label>
        <input id="editDesc" class="input" placeholder="وصف مختصر"/>
        <input type="hidden" id="editId"/>
      </div>
      <div class="edit-modal-footer">
        <button class="btn btn-ghost" style="flex:1" onclick="closeEditModal()">إلغاء</button>
        <button class="btn btn-success" style="flex:1.2" onclick="saveEditModal()">حفظ التعديل ✓</button>
      </div>
      <div id="editModalHint" style="text-align:center;font-size:11px;color:#9e9e9e;padding:0 12px 10px;display:none"></div>
    </div>`;
    document.body.appendChild(modal);
    console.log('[EDIT] modal injected via JS OTA ✓');
  }catch(e){ console.warn('[EDIT] inject fail', e); }
}
function hideCacheButton(){
  try{
    const btns = document.querySelectorAll('.sync-actions button');
    btns.forEach(b=>{
      const onclick = b.getAttribute('onclick')||'';
      const txt = (b.textContent||'').trim();
      if(onclick.includes('clearLocalCache') || txt.includes('كاش') || txt.includes('⟲')){
        b.style.display='none';
        console.log('[OTA] hide cache button', txt);
      }
    });
  }catch(e){}
}
function ensurePlusButtonExists(){
  try{
    if(document.getElementById('plusBtn')) {
      const existing = document.getElementById('plusBtn');
      // حدث وظيفته لفتح Bulk — لا تحركه إذا كان في مكانه الصحيح لتجنب حلقة مراقبة
      try{
        if(typeof existing.onclick !== 'function' || !String(existing.onclick).includes('openBulkModal')){
          existing.onclick = ()=> { try{ openBulkModal(); }catch(e){} };
        }
        if(existing.title !== 'زيادة سعر جماعية') existing.title='زيادة سعر جماعية';
        // صحح الستايل فقط إذا اختلف
        if(existing.style.marginInlineEnd !== '22px'){
          existing.style.marginInlineStart='';
          existing.style.marginInlineEnd='22px';
        }
      }catch(e){}
      // لا تعيد ترتيب DOM إذا كان الزر موجودًا بالفعل — كان يسبب حلقة MutationObserver لانهائية
      return;
    }
    const syncActions = document.querySelector('.sync-actions');
    if(!syncActions) return;
    const syncBtn = syncActions.querySelector('button[onclick*="syncFromApi"]');
    const btn = document.createElement('button');
    btn.id='plusBtn';
    btn.title='زيادة سعر جماعية';
    btn.textContent='+';
    btn.style.cssText='background:transparent;color:var(--accent);border:1px solid var(--accent);width:34px;height:32px;border-radius:8px;font-size:20px;font-weight:900;line-height:1;display:grid;place-items:center;margin-inline-end:22px';
    btn.onclick = ()=> { try{ openBulkModal(); }catch(e){} };
    if(syncBtn){
      syncBtn.parentNode.insertBefore(btn, syncBtn);
    } else {
      syncActions.insertBefore(btn, syncActions.firstChild);
    }
    console.log('[PLUS] btn injected via JS OTA ✓ (يمين)');
  }catch(e){ console.warn('[PLUS] inject fail', e); }
}
function ensureShortageViewExists(){
  try{
    if(document.getElementById('viewShortage')) return;
    const pricingView = document.getElementById('viewPricing');
    if(!pricingView || !pricingView.parentNode) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
  <div id=\"viewShortage\" class=\"view\" style=\"display:none\">
    <div class=\"card\">
      <div class=\"card-header\" style=\"justify-content:space-between;padding:0 12px\"><span>النواقص</span><span id=\"shortageCount\" class=\"badge\">0 منتج</span></div>
      <div style=\"padding:10px;color:#c8943a;font-size:12px;text-align:right\">المنتجات التي متاحها أقل من 3 — مرتبة تصاعدياً (0 أولاً كأولوية)</div>
      <div class=\"search-row\">
        <input id=\"searchShortage\" class=\"input\" placeholder=\"بحث في النواقص بالاسم أو الباركود\" oninput=\"renderShortageTable()\"/>
        <button class=\"btn btn-accent\" style=\"width:40px\" onclick=\"syncShortage()\">↻</button>
      </div>
      <div class=\"list-header\">
        <span class=\"w-num\">الرقم</span>
        <span class=\"w-num\">المتاح</span>
        <span>السعر</span>
        <span>الفئة</span>
        <span style=\"flex:1.2\">الباركود</span>
        <span style=\"flex:1.5\">الاسم</span>
        <span class=\"w-ctrl\" style=\"flex:0 0 70px\">تعديل</span>
      </div>
      <div id=\"shortageTableBody\" style=\"flex:1;overflow-y:auto;scrollbar-width:none;-ms-overflow-style:none\"></div>
    </div>
  </div>`;
    const el = wrap.firstElementChild;
    pricingView.parentNode.insertBefore(el, pricingView.nextSibling);
    console.log('[SHORTAGE] view injected via JS OTA ✓');
  }catch(e){ console.warn('[SHORTAGE] inject view fail', e); }
  try{
    const tabs = document.querySelector('.tabs div');
    if(tabs && !document.getElementById('tabShortage')){
      const btn = document.createElement('button');
      btn.id='tabShortage';
      btn.style.cssText='min-width:120px';
      btn.textContent='النواقص';
      btn.onclick = ()=> switchRole('shortage');
      tabs.appendChild(btn);
      console.log('[SHORTAGE] tab injected ✓');
    }
  }catch(e){}
}
function ensureBulkModalExists(){
  if(document.getElementById('bulkModal')) return;
  try{
    const modal = document.createElement('div');
    modal.id='bulkModal';
    modal.className='edit-modal';
    modal.style.display='none';
    modal.onclick = function(e){ if(e.target===modal) closeBulkModal(); };
    modal.innerHTML = `
    <div class="edit-modal-card" role="dialog" aria-modal="true" aria-labelledby="bulkModalTitle" style="max-width:460px">
      <div class="edit-modal-header">
        <span id="bulkModalTitle">زيادة سعر جماعية</span>
        <button class="edit-modal-close" onclick="closeBulkModal()" aria-label="إغلاق">✕</button>
      </div>
      <div class="edit-modal-body">
        <label class="label">قيمة الزيادة (جنيه)</label>
        <input id="bulkValue" class="input" type="number" inputmode="decimal" placeholder="مثال: 10" oninput="this.value=this.value.replace(/[^0-9.]/g,'').replace(/(\\..*)\\./g,'$1')" />
        <div style="font-size:11px;color:#9e9e9e;margin-top:4px">تُطبق فقط على المنتجات المسعّرة ومتاحها &gt;0 — غير ذلك يُترك كما هو</div>

        <label class="label" style="margin-top:14px">نطاق التطبيق</label>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label style="display:flex;align-items:center;gap:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;padding:10px;cursor:pointer">
            <input type="radio" name="bulkScope" value="all" checked onchange="onBulkScopeChange()" />
            <span>كل المنتجات</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;padding:10px;cursor:pointer">
            <input type="radio" name="bulkScope" value="category" onchange="onBulkScopeChange()" />
            <span>تصنيف معين</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;padding:10px;cursor:pointer">
            <input type="radio" name="bulkScope" value="product" onchange="onBulkScopeChange()" />
            <span>بحث نصي (كلمة أو أكثر)</span>
          </label>
        </div>
        <div id="bulkCategoryWrap" style="display:none;margin-top:10px">
          <label class="label">اختر التصنيف</label>
          <select id="bulkCategory" class="input"></select>
        </div>
        <div id="bulkProductWrap" style="display:none;margin-top:10px">
          <label class="label">فلترة بالكلمات (مثلاً: ترموستات)</label>
          <input id="bulkProductSearch" class="input" placeholder="اكتب كلمة أو أكثر — سيطبق على كل المطابق" oninput="onBulkProductSearch(this.value)" autocomplete="off"/>
          <div style="font-size:11px;color:#9e9e9e;margin-top:4px">لو كتبت كلمتين، أي منتج فيه الكلمتين سيُطبق — مثال: ترموستات مروحة</div>
          <div id="bulkProductList" style="max-height:160px;overflow-y:auto;margin-top:6px;border:1px solid var(--border);border-radius:8px;display:none;background:var(--bg-input)"></div>
          <div id="bulkProductSelected" style="margin-top:8px;padding:8px;background:rgba(200,148,58,.12);border:1px solid var(--accent);border-radius:8px;display:none;font-size:12px"></div>
          <button type="button" id="bulkPreviewBtn" class="btn btn-ghost" style="width:100%;height:32px;margin-top:8px;display:none;font-size:12px" onclick="toggleBulkPreviewList()">👁 معاينة المنتجات (<span id="bulkPreviewCount">0</span>)</button>
          <div id="bulkPreviewList" style="max-height:200px;overflow-y:auto;margin-top:6px;border:1px solid var(--border);border-radius:8px;display:none;background:var(--bg-card);padding:6px"></div>
        </div>
        <div id="bulkPreview" style="margin-top:12px;padding:10px;background:rgba(45,138,78,.1);border:1px solid rgba(45,138,78,.25);border-radius:8px;display:none;font-size:12px;color:#a8d5b5"></div>
      </div>
      <div class="edit-modal-footer">
        <button class="btn btn-ghost" style="flex:1" onclick="closeBulkModal()">إلغاء</button>
        <button class="btn btn-success" style="flex:1.2" onclick="applyBulkIncrease()">تطبيق الزيادة ✓</button>
      </div>
      <div id="bulkHint" style="text-align:center;font-size:11px;color:#9e9e9e;padding:0 12px 10px;display:none"></div>
    </div>`;
    document.body.appendChild(modal);
    console.log('[BULK] modal injected via JS OTA ✓');
  }catch(e){ console.warn('[BULK] inject fail', e); }
}
let _bulkSelectedProductId = null;
let _bulkSelectedProductBarcode = null;
let _bulkFilterQuery = '';
function openBulkModal(){
  try{ ensureBulkModalExists(); }catch(e){}
  const modal=document.getElementById('bulkModal');
  if(!modal){ showToast('النافذة غير جاهزة','error'); return; }
  const valEl=document.getElementById('bulkValue');
  const hintEl=document.getElementById('bulkHint');
  const previewEl=document.getElementById('bulkPreview');
  if(valEl) valEl.value='';
  if(hintEl){ hintEl.style.display='none'; hintEl.textContent=''; }
  if(previewEl) previewEl.style.display='none';
  try{
    const radios=document.querySelectorAll('input[name="bulkScope"]');
    radios.forEach(r=> r.checked = r.value==='all');
  }catch(e){}
  _bulkSelectedProductId=null; _bulkSelectedProductBarcode=null; _bulkFilterQuery='';
  const selDiv=document.getElementById('bulkProductSelected');
  if(selDiv) selDiv.style.display='none';
  const listDiv=document.getElementById('bulkProductList');
  if(listDiv) listDiv.style.display='none';
  const searchEl=document.getElementById('bulkProductSearch');
  if(searchEl) searchEl.value='';
  const previewBtn=_getEl('bulkPreviewBtn');
  if(previewBtn) previewBtn.style.display='none';
  const previewList=_getEl('bulkPreviewList');
  if(previewList){ previewList.style.display='none'; previewList.innerHTML=''; }
  const previewCount=_getEl('bulkPreviewCount');
  if(previewCount) previewCount.textContent='0';
  try{
    const catSel=document.getElementById('bulkCategory');
    if(catSel){
      const cats=[...new Set(products.map(p=> p.category||'عام'))].sort();
      const allCats=['عام','أجهزة','قطع غيار','إكسسوارات','أخرى'];
      const uniq=[...new Set([...allCats, ...cats])];
      catSel.innerHTML=uniq.map(c=> `<option value="${c.replace(/"/g,'&quot;')}">${c}</option>`).join('');
    }
  }catch(e){}
  onBulkScopeChange();
  modal.style.display='flex';
  document.body.style.overflow='hidden';
  setTimeout(()=>{ const v=document.getElementById('bulkValue'); if(v) v.focus(); }, 80);
}
function closeBulkModal(){
  const modal=document.getElementById('bulkModal');
  if(modal) modal.style.display='none';
  document.body.style.overflow='';
}
function onBulkScopeChange(){
  const scope = (document.querySelector('input[name="bulkScope"]:checked')||{}).value || 'all';
  const catWrap=document.getElementById('bulkCategoryWrap');
  const prodWrap=document.getElementById('bulkProductWrap');
  if(catWrap) catWrap.style.display = scope==='category' ? 'block' : 'none';
  if(prodWrap) prodWrap.style.display = scope==='product' ? 'block' : 'none';
  updateBulkPreview();
}
function onBulkProductSearch(q){
  _bulkFilterQuery=(q||'').trim();
  const listEl=_getEl('bulkProductList');
  const selEl=_getEl('bulkProductSelected');
  const previewBtn=_getEl('bulkPreviewBtn');
  const previewList=_getEl('bulkPreviewList');
  const countEl=_getEl('bulkPreviewCount');
  const valEl=_getEl('bulkValue');
  const val=parseFloat(valEl?.value||'');
  const qTrim=_bulkFilterQuery;
  if(!qTrim){
    if(listEl) listEl.style.display='none';
    if(selEl) selEl.style.display='none';
    if(previewBtn) previewBtn.style.display='none';
    if(previewList) previewList.style.display='none';
    updateBulkPreview();
    return;
  }
  const matched=_filterByQuery(products, qTrim);
  const totalMatching=products.filter(p=> _matchesQuery(p, qTrim)).length;
  const skippedNonEligible=totalMatching-matched.length;
  if(listEl){
    if(matched.length===0){
      listEl.innerHTML='<div style="padding:10px;color:#9e9e9e;font-size:12px">لا يوجد منتجات مطابقة مسعرة ومتاحة</div>';
    } else {
      listEl.innerHTML = matched.slice(0,12).map(p=> {
        const cur=parseFloat(p.price).toFixed(2);
        const newP = isNaN(val)||val<=0 ? cur : (parseFloat(p.price)+val).toFixed(2);
        const priceTxt = isNaN(val)||val<=0 ? `${cur}ج` : `${cur} → ${newP}ج`;
        return `<div style="padding:6px 8px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</span><span style="font-size:11px;color:#9e9e9e;flex:0 0 auto;margin-inline-start:8px">${priceTxt}</span></div>`;
      }).join('') + (matched.length>12? `<div style="padding:6px;text-align:center;color:#9e9e9e;font-size:11px">+${matched.length-12} أكثر</div>` : '');
    }
    listEl.style.display='block';
  }
  if(selEl){
    selEl.textContent = `تم العثور على ${matched.length} منتج مطابق مسعر ومتاح>0` + (skippedNonEligible>0?` (تخطي ${skippedNonEligible} غير مسعر/صفر من ${totalMatching} مطابق)` : ` (من ${totalMatching} مطابق)`);
    selEl.style.display='block';
  }
  if(countEl) countEl.textContent=matched.length;
  if(previewBtn) previewBtn.style.display= matched.length>0 ? 'block' : 'none';
  if(previewList){
    if(matched.length===0){
      previewList.innerHTML='<div style="padding:10px;color:#9e9e9e">لا يوجد</div>';
    } else {
      previewList.innerHTML = matched.map(p=>{
        const cur=parseFloat(p.price).toFixed(2);
        const newP = isNaN(val)||val<=0 ? cur : (parseFloat(p.price)+val).toFixed(2);
        return `<div style="padding:4px 6px;border-bottom:1px solid #1c2333;display:flex;justify-content:space-between"><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</span><span style="color:#c8943a;flex:0 0 auto">${cur}→${newP}</span></div>`;
      }).join('');
    }
  }
  updateBulkPreview();
}
function toggleBulkPreviewList(){
  const list=_getEl('bulkPreviewList');
  if(!list) return;
  list.style.display = list.style.display==='none' ? 'block' : 'none';
}
function selectBulkProduct(id){
  const p=products.find(x=> x.id===id);
  if(!p) return;
  // للفلترة النصية: املأ البحث باسم المنتج وطبق الفلترة (يدعم كلمة أو أكثر)
  const searchEl=_getEl('bulkProductSearch');
  if(searchEl){ searchEl.value=p.name; }
  onBulkProductSearch(p.name);
}
function updateBulkPreview(){
  const previewEl=document.getElementById('bulkPreview');
  if(!previewEl) return;
  const valEl=document.getElementById('bulkValue');
  const val=parseFloat(valEl? valEl.value : '');
  if(isNaN(val) || val<=0){
    previewEl.style.display='none';
    return;
  }
  const scope=(document.querySelector('input[name="bulkScope"]:checked')||{}).value || 'all';
  let count=0, example='', skipped=0;
  if(scope==='all'){
    const eligible=_filterEligible(products);
    count=eligible.length;
    skipped=products.length-eligible.length;
    if(count>0){
      const p=eligible[0];
      const newPrice = parseFloat(p.price)+val;
      example = `${p.name}: ${parseFloat(p.price).toFixed(2)} → ${newPrice.toFixed(2)}`;
    } else {
      example='لا يوجد منتجات مسعرة ومتاحة >0';
    }
  } else if(scope==='category'){
    const cat=document.getElementById('bulkCategory')?.value||'عام';
    const filtered=products.filter(p=> (p.category||'عام')===cat);
    const eligible=_filterEligible(filtered);
    count=eligible.length;
    skipped=filtered.length-eligible.length;
    if(count>0){
      const p=eligible[0];
      const newPrice = parseFloat(p.price)+val;
      example = `${p.name} (${cat}): ${parseFloat(p.price).toFixed(2)} → ${newPrice.toFixed(2)}`;
    } else {
      example='لا يوجد منتجات مسعرة ومتاحة في هذا التصنيف';
    }
  } else if(scope==='product'){
    const q = (_bulkFilterQuery || _getEl('bulkProductSearch')?.value || '').trim();
    if(!q){
      count=0;
      example='اكتب كلمة للبحث (مثلاً: ترموستات)';
    } else {
      const matched=_filterByQuery(products, q);
      const totalMatching=products.filter(p=> _matchesQuery(p,q)).length;
      const skippedNonEligible=totalMatching-matched.length;
      count=matched.length;
      skipped=skippedNonEligible;
      if(count>0){
        const p=matched[0];
        const newPrice = parseFloat(p.price)+val;
        example = `${p.name}: ${parseFloat(p.price).toFixed(2)} → ${newPrice.toFixed(2)}`;
        if(matched.length>1) example += ` (+${matched.length-1} آخر)`;
      } else {
        if(totalMatching>0) example='لا يوجد مطابق مسعر ومتاح>0';
        else example='لا يوجد منتجات مطابقة';
      }
    }
  }
  const unit = ' جنيه';
  let skipTxt = skipped>0 ? `<br><span style="color:#9e9e9e;font-size:11px">سيتم تخطي ${skipped} منتج غير مسعر أو متاحه 0</span>` : '';
  previewEl.innerHTML = `سيتم تطبيق <b>${val}${unit}</b> على <b>${count}</b> منتج مسعر ومتاح>0<br><span style="color:#fff">${example}</span>${skipTxt}`;
  previewEl.style.display='block';
}
async function applyBulkIncrease(){
  const valEl=document.getElementById('bulkValue');
  const hintEl=document.getElementById('bulkHint');
  const rawVal=(valEl? valEl.value : '').trim();
  if(!rawVal || !/^[0-9]+(\.[0-9]+)?$/.test(rawVal)){
    showToast('ادخل قيمة رقمية صحيحة','warning');
    if(valEl) valEl.focus();
    return;
  }
  const val=parseFloat(rawVal);
  if(isNaN(val) || val<=0){
    showToast('القيمة يجب أن تكون > 0','warning');
    return;
  }
  const scope=(document.querySelector('input[name="bulkScope"]:checked')||{}).value || 'all';
  let rawTargets=[];
  if(scope==='all'){
    rawTargets = products.slice();
  } else if(scope==='category'){
    const cat=document.getElementById('bulkCategory')?.value||'عام';
    rawTargets = products.filter(p=> (p.category||'عام')===cat);
    if(rawTargets.length===0) return showToast('لا يوجد منتجات في هذا التصنيف','warning');
  } else if(scope==='product'){
    const q = (_bulkFilterQuery || _getEl('bulkProductSearch')?.value || '').trim();
    if(!q) return showToast('اكتب كلمة للبحث','warning');
    rawTargets = products.filter(p=> _matchesQuery(p, q));
    if(rawTargets.length===0) return showToast('لا يوجد منتجات مطابقة','warning');
  }
  if(rawTargets.length===0) return showToast('لا يوجد منتجات للتطبيق','warning');
  // فلترة: فقط المسعر ومتاح>0 — الباقي يبقى كما هو
  let targets = _filterEligible(rawTargets);
  const skipped = rawTargets.length - targets.length;
  if(targets.length===0) return showToast('لا يوجد منتجات مسعرة ومتاحة >0 للتطبيق' + (skipped>0?` (تم تخطي ${skipped} غير مسعر/صفر)` : ''),'warning');
  if(navigator.onLine===false){
    return showToast('لا يوجد اتصال بالإنترنت - تحقق من الشبكة','error');
  }
  if(targets.length>500){
    return showToast('العدد كبير جداً (>500) — قسّمه إلى فئات لتجنب الحظر','warning');
  }
  if(targets.length>200){
    if(!confirm(`تحذير: سيتم تحديث ${targets.length} منتج مسعر ومتاح>0 (تخطي ${skipped}) — قد يستغرق وقتاً. هل أنت متأكد؟`)) return;
  }
  let confirmMsg = `تأكيد زيادة ${val} جنيه على ${targets.length} منتج مسعر ومتاح>0؟ سيتم تحديث السعر فقط`;
  if(skipped>0) confirmMsg += ` (سيتم تخطي ${skipped} غير مسعر/صفر)`;
  if(!confirm(confirmMsg)) return;
  const btn=document.querySelector('#bulkModal .btn-success');
  if(btn){ btn.disabled=true; btn.textContent='جاري التطبيق...'; }
  if(hintEl){ hintEl.style.display='block'; hintEl.textContent=`جاري تحديث ${targets.length} منتج...`; hintEl.style.color='#9e9e9e'; }
  let ok=0, fail=0;
  for(const p of targets){
    const oldPrice=parseFloat(p.price)||0;
    let newPrice = oldPrice + val;
    newPrice = Math.round(newPrice*100)/100;
    if(newPrice<0) newPrice=0;
    try{
      const patch={price:newPrice, updated_at:_localNow()};
      let updated=null;
      if(window.SupabaseSync && window.SupabaseSync.isConfigured()){
        updated = await SupabaseSync.updateProduct(p.id, {...patch, barcode:p.barcode});
      }
      if(updated && updated.price!=null){
        p.price=updated.price;
      } else {
        p.price=newPrice;
      }
      p.updated_at=patch.updated_at;
      ok++;
      if(ok%5===0){
        _lastTableHash=""; _lastUserHash=""; _lastPricingHash=""; _lastShortageHash="";
        try{ renderUserTable(); renderPricingTable(); renderShortageTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); }catch(e){}
        if(hintEl) hintEl.textContent=`تم ${ok}/${targets.length}...`;
        await new Promise(r=> setTimeout(r, 80));
      }
    }catch(e){
      console.warn('[BULK] fail', p.barcode, e.message);
      fail++;
    }
  }
  _syncWindowProducts();
  try{ _updateSWBgState(); }catch(e){}
  _lastTableHash=""; _lastUserHash=""; _lastPricingHash=""; _lastShortageHash="";
  try{ renderUserTable(); renderPricingTable(); renderShortageTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); _setBadge(products.length); }catch(e){}
  try{ syncPricing(); syncShortage(); }catch(e){}
  if(btn){ btn.disabled=false; btn.textContent='تطبيق الزيادة ✓'; }
  if(hintEl){
    let hintTxt = `تم: ${ok} نجح، ${fail} فشل`;
    if(typeof skipped !== 'undefined' && skipped>0) hintTxt += `، تخطي ${skipped} غير مسعر/صفر`;
    hintEl.textContent = hintTxt;
    hintEl.style.color = fail? '#c73e3e' : '#2d8a4e';
  }
  let _skippedTxt = (typeof skipped !== 'undefined' && skipped>0) ? ` (تخطي ${skipped} غير مسعر/صفر)` : '';
  showToast(`تمت الزيادة ${val} جنيه على ${ok} منتج مسعر ومتاح>0${_skippedTxt}${fail?` (${fail} فشل)`:''}`,'success',4000);
  setTimeout(()=> syncFromApi({force:true}), 800);
}
window.openBulkModal=openBulkModal; window.closeBulkModal=closeBulkModal; window.onBulkScopeChange=onBulkScopeChange; window.onBulkProductSearch=onBulkProductSearch; window.selectBulkProduct=selectBulkProduct; window.applyBulkIncrease=applyBulkIncrease;
window.updateBulkPreview=updateBulkPreview;

// ===== نظام الخصم الجماعي — مشابه للزيادة لكن بالطرح =====
function ensureDiscountModalExists(){
  if(document.getElementById('discountModal')) return;
  try{
    const modal = document.createElement('div');
    modal.id='discountModal';
    modal.className='edit-modal';
    modal.style.display='none';
    modal.onclick = function(e){ if(e.target===modal) closeDiscountModal(); };
    modal.innerHTML = `
    <div class="edit-modal-card" role="dialog" aria-modal="true" aria-labelledby="discountModalTitle" style="max-width:460px">
      <div class="edit-modal-header">
        <span id="discountModalTitle">خصم جماعي</span>
        <button class="edit-modal-close" onclick="closeDiscountModal()" aria-label="إغلاق">✕</button>
      </div>
      <div class="edit-modal-body">
        <label class="label">قيمة الخصم (جنيه)</label>
        <input id="discountValue" class="input" type="number" inputmode="decimal" placeholder="مثال: 10" oninput="this.value=this.value.replace(/[^0-9.]/g,'').replace(/(\\..*)\\./g,'$1')" />
        <div style="font-size:11px;color:#9e9e9e;margin-top:4px">يُطبق فقط على المسعّرة ومتاحها &gt;0 — لن يقل عن 0 جنيه وغير ذلك يُترك</div>

        <label class="label" style="margin-top:14px">نطاق التطبيق</label>
        <div style="display:flex;flex-direction:column;gap:8px">
          <label style="display:flex;align-items:center;gap:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;padding:10px;cursor:pointer">
            <input type="radio" name="discountScope" value="all" checked onchange="onDiscountScopeChange()" />
            <span>كل المنتجات</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;padding:10px;cursor:pointer">
            <input type="radio" name="discountScope" value="category" onchange="onDiscountScopeChange()" />
            <span>تصنيف معين</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;background:var(--bg-input);border:1px solid var(--border);border-radius:8px;padding:10px;cursor:pointer">
            <input type="radio" name="discountScope" value="product" onchange="onDiscountScopeChange()" />
            <span>بحث نصي (كلمة أو أكثر)</span>
          </label>
        </div>
        <div id="discountCategoryWrap" style="display:none;margin-top:10px">
          <label class="label">اختر التصنيف</label>
          <select id="discountCategory" class="input"></select>
        </div>
        <div id="discountProductWrap" style="display:none;margin-top:10px">
          <label class="label">فلترة بالكلمات (مثلاً: ترموستات)</label>
          <input id="discountProductSearch" class="input" placeholder="اكتب كلمة أو أكثر — سيطبق على كل المطابق" oninput="onDiscountProductSearch(this.value)" autocomplete="off"/>
          <div style="font-size:11px;color:#9e9e9e;margin-top:4px">لو كتبت كلمتين، أي منتج فيه الكلمتين سيُطبق — مثال: ترموستات مروحة</div>
          <div id="discountProductList" style="max-height:160px;overflow-y:auto;margin-top:6px;border:1px solid var(--border);border-radius:8px;display:none;background:var(--bg-input)"></div>
          <div id="discountProductSelected" style="margin-top:8px;padding:8px;background:rgba(199,62,62,.12);border:1px solid #c73e3e;border-radius:8px;display:none;font-size:12px"></div>
          <button type="button" id="discountPreviewBtn" class="btn btn-ghost" style="width:100%;height:32px;margin-top:8px;display:none;font-size:12px" onclick="toggleDiscountPreviewList()">👁 معاينة المنتجات (<span id="discountPreviewCount">0</span>)</button>
          <div id="discountPreviewList" style="max-height:200px;overflow-y:auto;margin-top:6px;border:1px solid var(--border);border-radius:8px;display:none;background:var(--bg-card);padding:6px"></div>
        </div>
        <div id="discountPreview" style="margin-top:12px;padding:10px;background:rgba(199,62,62,.08);border:1px solid rgba(199,62,62,.25);border-radius:8px;display:none;font-size:12px;color:#e8a0a0"></div>
      </div>
      <div class="edit-modal-footer">
        <button class="btn btn-ghost" style="flex:1" onclick="closeDiscountModal()">إلغاء</button>
        <button class="btn btn-success" style="flex:1.2;background:#c73e3e;border-color:#c73e3e" onclick="applyDiscount()">تطبيق الخصم ✓</button>
      </div>
      <div id="discountHint" style="text-align:center;font-size:11px;color:#9e9e9e;padding:0 12px 10px;display:none"></div>
    </div>`;
    document.body.appendChild(modal);
    console.log('[DISCOUNT] modal injected via JS OTA ✓');
  }catch(e){ console.warn('[DISCOUNT] inject fail', e); }
}
let _discountSelectedProductId = null;
let _discountSelectedProductBarcode = null;
let _discountFilterQuery = '';
function openDiscountModal(){
  try{ ensureDiscountModalExists(); }catch(e){}
  const modal=document.getElementById('discountModal');
  if(!modal){ showToast('النافذة غير جاهزة','error'); return; }
  const valEl=document.getElementById('discountValue');
  const hintEl=document.getElementById('discountHint');
  const previewEl=document.getElementById('discountPreview');
  if(valEl) valEl.value='';
  if(hintEl){ hintEl.style.display='none'; hintEl.textContent=''; }
  if(previewEl) previewEl.style.display='none';
  try{
    const radios=document.querySelectorAll('input[name="discountScope"]');
    radios.forEach(r=> r.checked = r.value==='all');
  }catch(e){}
  _discountSelectedProductId=null; _discountSelectedProductBarcode=null; _discountFilterQuery='';
  const selDiv=document.getElementById('discountProductSelected');
  if(selDiv) selDiv.style.display='none';
  const listDiv=document.getElementById('discountProductList');
  if(listDiv) listDiv.style.display='none';
  const searchEl=document.getElementById('discountProductSearch');
  if(searchEl) searchEl.value='';
  const previewBtn2=_getEl('discountPreviewBtn');
  if(previewBtn2) previewBtn2.style.display='none';
  const previewList2=_getEl('discountPreviewList');
  if(previewList2){ previewList2.style.display='none'; previewList2.innerHTML=''; }
  const previewCount2=_getEl('discountPreviewCount');
  if(previewCount2) previewCount2.textContent='0';
  try{
    const catSel=document.getElementById('discountCategory');
    if(catSel){
      const cats=[...new Set(products.map(p=> p.category||'عام'))].sort();
      const allCats=['عام','أجهزة','قطع غيار','إكسسوارات','أخرى'];
      const uniq=[...new Set([...allCats, ...cats])];
      catSel.innerHTML=uniq.map(c=> `<option value="${c.replace(/"/g,'&quot;')}">${c}</option>`).join('');
    }
  }catch(e){}
  onDiscountScopeChange();
  modal.style.display='flex';
  document.body.style.overflow='hidden';
  setTimeout(()=>{ const v=document.getElementById('discountValue'); if(v) v.focus(); }, 80);
}
function closeDiscountModal(){
  const modal=document.getElementById('discountModal');
  if(modal) modal.style.display='none';
  document.body.style.overflow='';
}
function onDiscountScopeChange(){
  const scope = (document.querySelector('input[name="discountScope"]:checked')||{}).value || 'all';
  const catWrap=document.getElementById('discountCategoryWrap');
  const prodWrap=document.getElementById('discountProductWrap');
  if(catWrap) catWrap.style.display = scope==='category' ? 'block' : 'none';
  if(prodWrap) prodWrap.style.display = scope==='product' ? 'block' : 'none';
  updateDiscountPreview();
}
function onDiscountProductSearch(q){
  _discountFilterQuery=(q||'').trim();
  const listEl=_getEl('discountProductList');
  const selEl=_getEl('discountProductSelected');
  const previewBtn=_getEl('discountPreviewBtn');
  const previewList=_getEl('discountPreviewList');
  const countEl=_getEl('discountPreviewCount');
  const valEl=_getEl('discountValue');
  const val=parseFloat(valEl?.value||'');
  const qTrim=_discountFilterQuery;
  if(!qTrim){
    if(listEl) listEl.style.display='none';
    if(selEl) selEl.style.display='none';
    if(previewBtn) previewBtn.style.display='none';
    if(previewList) previewList.style.display='none';
    updateDiscountPreview();
    return;
  }
  const matched=_filterByQuery(products, qTrim);
  const totalMatching=products.filter(p=> _matchesQuery(p, qTrim)).length;
  const skippedNonEligible=totalMatching-matched.length;
  if(listEl){
    if(matched.length===0){
      listEl.innerHTML='<div style="padding:10px;color:#9e9e9e;font-size:12px">لا يوجد منتجات مطابقة مسعرة ومتاحة</div>';
    } else {
      listEl.innerHTML = matched.slice(0,12).map(p=> {
        const cur=parseFloat(p.price).toFixed(2);
        const newP = isNaN(val)||val<=0 ? cur : Math.max(0, parseFloat(p.price)-val).toFixed(2);
        const priceTxt = isNaN(val)||val<=0 ? `${cur}ج` : `${cur} → ${newP}ج`;
        return `<div style="padding:6px 8px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center"><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</span><span style="font-size:11px;color:#9e9e9e;flex:0 0 auto;margin-inline-start:8px">${priceTxt}</span></div>`;
      }).join('') + (matched.length>12? `<div style="padding:6px;text-align:center;color:#9e9e9e;font-size:11px">+${matched.length-12} أكثر</div>` : '');
    }
    listEl.style.display='block';
  }
  if(selEl){
    selEl.textContent = `تم العثور على ${matched.length} منتج مطابق مسعر ومتاح>0` + (skippedNonEligible>0?` (تخطي ${skippedNonEligible} غير مسعر/صفر من ${totalMatching} مطابق)` : ` (من ${totalMatching} مطابق)`);
    selEl.style.display='block';
  }
  if(countEl) countEl.textContent=matched.length;
  if(previewBtn) previewBtn.style.display= matched.length>0 ? 'block' : 'none';
  if(previewList){
    if(matched.length===0){
      previewList.innerHTML='<div style="padding:10px;color:#9e9e9e">لا يوجد</div>';
    } else {
      previewList.innerHTML = matched.map(p=>{
        const cur=parseFloat(p.price).toFixed(2);
        const newP = isNaN(val)||val<=0 ? cur : Math.max(0, parseFloat(p.price)-val).toFixed(2);
        return `<div style="padding:4px 6px;border-bottom:1px solid #1c2333;display:flex;justify-content:space-between"><span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.name}</span><span style="color:#c73e3e;flex:0 0 auto">${cur}→${newP}</span></div>`;
      }).join('');
    }
  }
  updateDiscountPreview();
}
function toggleDiscountPreviewList(){
  const list=_getEl('discountPreviewList');
  if(!list) return;
  list.style.display = list.style.display==='none' ? 'block' : 'none';
}
function selectDiscountProduct(id){
  const p=products.find(x=> x.id===id);
  if(!p) return;
  const searchEl=_getEl('discountProductSearch');
  if(searchEl){ searchEl.value=p.name; }
  onDiscountProductSearch(p.name);
}
function updateDiscountPreview(){
  const previewEl=document.getElementById('discountPreview');
  if(!previewEl) return;
  const valEl=document.getElementById('discountValue');
  const val=parseFloat(valEl? valEl.value : '');
  if(isNaN(val) || val<=0){
    previewEl.style.display='none';
    return;
  }
  const scope=(document.querySelector('input[name="discountScope"]:checked')||{}).value || 'all';
  let count=0, example='', skipped=0;
  if(scope==='all'){
    const eligible=_filterEligible(products);
    count=eligible.length;
    skipped=products.length-eligible.length;
    if(count>0){
      const p=eligible[0];
      let newPrice = Math.max(0, parseFloat(p.price)-val);
      example = `${p.name}: ${parseFloat(p.price).toFixed(2)} → ${newPrice.toFixed(2)}`;
    } else {
      example='لا يوجد منتجات مسعرة ومتاحة >0';
    }
  } else if(scope==='category'){
    const cat=document.getElementById('discountCategory')?.value||'عام';
    const filtered=products.filter(p=> (p.category||'عام')===cat);
    const eligible=_filterEligible(filtered);
    count=eligible.length;
    skipped=filtered.length-eligible.length;
    if(count>0){
      const p=eligible[0];
      const newPrice = Math.max(0, parseFloat(p.price)-val);
      example = `${p.name} (${cat}): ${parseFloat(p.price).toFixed(2)} → ${newPrice.toFixed(2)}`;
    } else {
      example='لا يوجد منتجات مسعرة ومتاحة في هذا التصنيف';
    }
  } else if(scope==='product'){
    const q = (_discountFilterQuery || _getEl('discountProductSearch')?.value || '').trim();
    if(!q){
      count=0;
      example='اكتب كلمة للبحث (مثلاً: ترموستات)';
    } else {
      const matched=_filterByQuery(products, q);
      const totalMatching=products.filter(p=> _matchesQuery(p,q)).length;
      const skippedNonEligible=totalMatching-matched.length;
      count=matched.length;
      skipped=skippedNonEligible;
      if(count>0){
        const p=matched[0];
        const newPrice = Math.max(0, parseFloat(p.price)-val);
        example = `${p.name}: ${parseFloat(p.price).toFixed(2)} → ${newPrice.toFixed(2)}`;
        if(matched.length>1) example += ` (+${matched.length-1} آخر)`;
      } else {
        if(totalMatching>0) example='لا يوجد مطابق مسعر ومتاح>0';
        else example='لا يوجد منتجات مطابقة';
      }
    }
  }
  const unit = ' جنيه';
  let skipTxt = skipped>0 ? `<br><span style="color:#9e9e9e;font-size:11px">سيتم تخطي ${skipped} منتج غير مسعر أو متاحه 0</span>` : '';
  previewEl.innerHTML = `سيتم خصم <b>${val}${unit}</b> على <b>${count}</b> منتج مسعر ومتاح>0<br><span style="color:#fff">${example}</span>${skipTxt}`;
  previewEl.style.display='block';
}
async function applyDiscount(){
  const valEl=document.getElementById('discountValue');
  const hintEl=document.getElementById('discountHint');
  const rawVal=(valEl? valEl.value : '').trim();
  if(!rawVal || !/^[0-9]+(\.[0-9]+)?$/.test(rawVal)){
    showToast('ادخل قيمة رقمية صحيحة','warning');
    if(valEl) valEl.focus();
    return;
  }
  const val=parseFloat(rawVal);
  if(isNaN(val) || val<=0){
    showToast('القيمة يجب أن تكون > 0','warning');
    return;
  }
  const scope=(document.querySelector('input[name="discountScope"]:checked')||{}).value || 'all';
  let rawTargets=[];
  if(scope==='all'){
    rawTargets = products.slice();
  } else if(scope==='category'){
    const cat=document.getElementById('discountCategory')?.value||'عام';
    rawTargets = products.filter(p=> (p.category||'عام')===cat);
    if(rawTargets.length===0) return showToast('لا يوجد منتجات في هذا التصنيف','warning');
  } else if(scope==='product'){
    const q = (_discountFilterQuery || _getEl('discountProductSearch')?.value || '').trim();
    if(!q) return showToast('اكتب كلمة للبحث','warning');
    rawTargets = products.filter(p=> _matchesQuery(p, q));
    if(rawTargets.length===0) return showToast('لا يوجد منتجات مطابقة','warning');
  }
  if(rawTargets.length===0) return showToast('لا يوجد منتجات للتطبيق','warning');
  let targets=_filterEligible(rawTargets);
  const skipped=rawTargets.length-targets.length;
  if(targets.length===0) return showToast('لا يوجد منتجات مسعرة ومتاحة >0 للتطبيق' + (skipped>0?` (تم تخطي ${skipped} غير مسعر/صفر)`:''),'warning');
  if(navigator.onLine===false){
    return showToast('لا يوجد اتصال بالإنترنت - تحقق من الشبكة','error');
  }
  if(targets.length>500){
    return showToast('العدد كبير جداً (>500) — قسّمه إلى فئات لتجنب الحظر','warning');
  }
  if(targets.length>200){
    if(!confirm(`تحذير: سيتم خصم ${targets.length} منتج مسعر ومتاح>0 (تخطي ${skipped}) — قد يستغرق وقتاً. هل أنت متأكد؟`)) return;
  }
  let confirmMsg=`تأكيد خصم ${val} جنيه على ${targets.length} منتج مسعر ومتاح>0؟ سيتم خصم السعر فقط`;
  if(skipped>0) confirmMsg+=` (سيتم تخطي ${skipped} غير مسعر/صفر)`;
  if(!confirm(confirmMsg)) return;
  const btn=document.querySelector('#discountModal .btn-success');
  if(btn){ btn.disabled=true; btn.textContent='جاري التطبيق...'; }
  if(hintEl){ hintEl.style.display='block'; hintEl.textContent=`جاري تحديث ${targets.length} منتج...`; hintEl.style.color='#9e9e9e'; }
  let ok=0, fail=0;
  for(const p of targets){
    const oldPrice=parseFloat(p.price)||0;
    let newPrice = oldPrice - val;
    newPrice = Math.round(newPrice*100)/100;
    if(newPrice<0) newPrice=0;
    try{
      const patch={price:newPrice, updated_at:_localNow()};
      let updated=null;
      if(window.SupabaseSync && window.SupabaseSync.isConfigured()){
        updated = await SupabaseSync.updateProduct(p.id, {...patch, barcode:p.barcode});
      }
      if(updated && updated.price!=null){
        p.price=updated.price;
      } else {
        p.price=newPrice;
      }
      p.updated_at=patch.updated_at;
      ok++;
      if(ok%5===0){
        _lastTableHash=""; _lastUserHash=""; _lastPricingHash=""; _lastShortageHash="";
        try{ renderUserTable(); renderPricingTable(); renderShortageTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); }catch(e){}
        if(hintEl) hintEl.textContent=`تم ${ok}/${targets.length}...`;
        await new Promise(r=> setTimeout(r, 80));
      }
    }catch(e){
      console.warn('[DISCOUNT] fail', p.barcode, e.message);
      fail++;
    }
  }
  _syncWindowProducts();
  try{ _updateSWBgState(); }catch(e){}
  _lastTableHash=""; _lastUserHash=""; _lastPricingHash=""; _lastShortageHash="";
  try{ renderUserTable(); renderPricingTable(); renderShortageTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); _setBadge(products.length); }catch(e){}
  try{ syncPricing(); syncShortage(); }catch(e){}
  if(btn){ btn.disabled=false; btn.textContent='تطبيق الخصم ✓'; }
  if(hintEl){
    let hintTxt2 = `تم: ${ok} نجح، ${fail} فشل`;
    if(typeof skipped !== 'undefined' && skipped>0) hintTxt2 += `، تخطي ${skipped} غير مسعر/صفر`;
    hintEl.textContent = hintTxt2;
    hintEl.style.color = fail? '#c73e3e' : '#2d8a4e';
  }
  let _skippedTxt2 = (typeof skipped !== 'undefined' && skipped>0) ? ` (تخطي ${skipped} غير مسعر/صفر)` : '';
  showToast(`تم الخصم ${val} جنيه على ${ok} منتج مسعر ومتاح>0${_skippedTxt2}${fail?` (${fail} فشل)`:''}`,'success',4000);
  setTimeout(()=> syncFromApi({force:true}), 800);
}
window.openDiscountModal=openDiscountModal; window.closeDiscountModal=closeDiscountModal; window.onDiscountScopeChange=onDiscountScopeChange; window.onDiscountProductSearch=onDiscountProductSearch; window.selectDiscountProduct=selectDiscountProduct; window.applyDiscount=applyDiscount;
window.updateDiscountPreview=updateDiscountPreview;
function ensureDiscountButtonExists(){
  try{
    if(document.getElementById('discountBtn')) {
      const existing=document.getElementById('discountBtn');
      try{
        if(typeof existing.onclick !== 'function' || !String(existing.onclick).includes('openDiscountModal')){
          existing.onclick = ()=> { try{ openDiscountModal(); }catch(e){} };
        }
        if(existing.title !== 'خصم جماعي') existing.title='خصم جماعي';
      }catch(e){}
      return;
    }
    const plusBtn=document.getElementById('plusBtn');
    const syncActions=document.querySelector('.sync-actions');
    if(!syncActions) return;
    const btn=document.createElement('button');
    btn.id='discountBtn';
    btn.title='خصم جماعي';
    btn.textContent='−';
    btn.style.cssText='background:transparent;color:#c73e3e;border:1px solid #c73e3e;width:34px;height:32px;border-radius:8px;font-size:20px;font-weight:900;line-height:1;display:grid;place-items:center;margin-inline-end:22px';
    btn.onclick = ()=> { try{ openDiscountModal(); }catch(e){} };
    const syncBtn=syncActions.querySelector('button[onclick*="syncFromApi"]');
    if(syncBtn){
      syncBtn.parentNode.insertBefore(btn, syncBtn);
    } else if(plusBtn && plusBtn.nextSibling){
      plusBtn.parentNode.insertBefore(btn, plusBtn.nextSibling);
    } else {
      syncActions.insertBefore(btn, syncActions.firstChild);
    }
    console.log('[DISCOUNT] btn injected ✓');
  }catch(e){ console.warn('[DISCOUNT] inject fail', e); }
}
// شغّل فوراً و عند الجاهزية (لضمان بعد OTA)
try{ ensureEditModalExists(); ensureShortageViewExists(); ensureBulkModalExists(); ensureDiscountModalExists(); ensurePlusButtonExists(); ensureDiscountButtonExists(); hideCacheButton(); }catch(e){}
if(document.readyState==='loading'){
  document.addEventListener('DOMContentLoaded', ()=>{ try{ ensureEditModalExists(); ensureShortageViewExists(); ensureBulkModalExists(); ensureDiscountModalExists(); ensurePlusButtonExists(); ensureDiscountButtonExists(); hideCacheButton(); }catch(e){} });
} else {
  setTimeout(()=>{ try{ ensureEditModalExists(); ensureShortageViewExists(); ensureBulkModalExists(); ensureDiscountModalExists(); ensurePlusButtonExists(); ensureDiscountButtonExists(); hideCacheButton(); }catch(e){} }, 300);
}
// راقب DOM لو تأخر تحميل sync-bar — مع منع حلقة لانهائية (debounce + فصل مبكر)
try{
  let _obsPending=false;
  const obs = new MutationObserver(()=>{
    if(_obsPending) return;
    _obsPending=true;
    setTimeout(()=>{
      _obsPending=false;
      try{ hideCacheButton(); ensureShortageViewExists(); ensurePlusButtonExists(); ensureBulkModalExists(); ensureDiscountModalExists(); ensureDiscountButtonExists(); }catch(e){}
      try{
        if(document.getElementById('editModal') && document.getElementById('bulkModal') && document.getElementById('discountModal') && document.getElementById('plusBtn') && document.getElementById('discountBtn') && document.getElementById('viewShortage')){
          obs.disconnect();
        }
      }catch(e){}
    }, 250);
  });
  obs.observe(document.documentElement, {childList:true, subtree:true});
  setTimeout(()=> { try{ obs.disconnect(); }catch(e){} }, 8000);
}catch(e){}
try{
  document.addEventListener('input', (e)=>{
    if(e.target && (e.target.id==='bulkValue' || e.target.id==='bulkCategory')) updateBulkPreview();
    if(e.target && (e.target.id==='discountValue' || e.target.id==='discountCategory')) updateDiscountPreview();
  });
  document.addEventListener('change', (e)=>{
    if(e.target && (e.target.name==='bulkScope' || e.target.id==='bulkCategory')) setTimeout(updateBulkPreview, 50);
    if(e.target && (e.target.name==='discountScope' || e.target.id==='discountCategory')) setTimeout(updateDiscountPreview, 50);
  });
}catch(e){}
function syncPricing(){
  const badge=document.getElementById('pricingCount');
  const count=products.filter(p=>!p.price || parseFloat(p.price)===0).length;
  if(badge) badge.textContent=count+" جاهز";
}
let _expandedPricingId = null;
function renderPricingTable(){
  const q=((_getEl('searchPricing')?.value)||"").trim().toLowerCase();
  const body=document.getElementById('pricingTableBody');
  if(!body) return;
  try{
    const curHash = _hashList(products.filter(p=>!p.price || parseFloat(p.price)===0)) + "|q:" + q + "|exp:" + _expandedPricingId;
    if(curHash === _lastPricingHash && body.children.length>0) return;
    _lastPricingHash = curHash;
  }catch(e){}
  body.innerHTML="";
  let filtered=products.filter(p=>!p.price || parseFloat(p.price)===0);
  if(q){
    filtered=filtered.filter(p=>{
      if(/^\d+$/.test(q)){
        const seq=products.indexOf(p)+1;
        if(String(seq)===q) return true;
        if(String(p.id)===q) return true;
      }
      return p.name.toLowerCase().includes(q) || p.barcode.includes(q);
    });
  }
  const badge=document.getElementById('pricingCount');
  if(badge) badge.textContent=filtered.length+" جاهز";
  filtered.forEach(p=>{
    const seq=products.indexOf(p)+1;
    const isExp = _expandedPricingId===p.id;
    const card=document.createElement('div'); card.className='pricing-card' + (isExp?' expanded':'');
    card.dataset.id=p.id;
    card.innerHTML=`
      <div class="pricing-row" onclick="togglePricingExpand(${p.id})">
        <span class="w-num">${seq}</span>
        <span>${p.name}</span>
        <span style="font-size:11px">${p.barcode}</span>
        <span class="edit-icon" onclick="event.stopPropagation(); toggleEditPricingName(${p.id})" title="تعديل الاسم">✏</span>
      </div>
      <div class="pricing-expand">
        <div class="pricing-expand-inner">
          <div class="pricing-expand-body">
            <div class="pricing-fields">
              <div class="pricing-field">
                <label>المتاح</label>
                <input id="stock_${p.id}" type="number" inputmode="numeric" class="input" value="${p.stock}" placeholder="0"/>
              </div>
              <div class="pricing-field">
                <label>السعر (جنيه)</label>
                <input id="price_${p.id}" type="number" inputmode="decimal" class="input" placeholder="0.00" value="${p.price? parseFloat(p.price).toFixed(2):''}"/>
              </div>
            </div>
            <div class="pricing-name-row" id="nameRow_${p.id}">
              <span class="name-text" id="nameText_${p.id}">${p.name}</span>
              <input class="name-input" id="nameInput_${p.id}" value="${p.name.replace(/"/g,'&quot;')}" placeholder="اسم المنتج"/>
              <button class="btn btn-ghost" style="height:32px;padding:0 10px;flex:0 0 auto" onclick="toggleEditPricingName(${p.id})">✏</button>
            </div>
            <div class="pricing-actions">
              <button class="btn btn-ghost" onclick="collapsePricingCard(${p.id})">إلغاء</button>
              <button class="btn btn-success" onclick="savePricing(${p.id})">حفظ</button>
            </div>
          </div>
        </div>
      </div>`;
    body.appendChild(card);
  });
  if(filtered.length===0) body.innerHTML=`<div style="text-align:center;color:#9e9e9e;padding:20px">لا يوجد منتجات بسعر 0 - الكل مسعّر</div>`;
}
// ===== النواقص: متاح < 3 مرتب تصاعدي =====
function syncShortage(){
  const badge=document.getElementById('shortageCount');
  const c = products.filter(p=> (parseInt(p.stock)||0) < 3).length;
  if(badge) badge.textContent=c+" منتج";
}
function renderShortageTable(){
  const qEl=document.getElementById('searchShortage');
  const q=(qEl? qEl.value : "").trim().toLowerCase();
  const body=document.getElementById('shortageTableBody');
  if(!body) return;
  // فلترة + ترتيب تصاعدي حسب المتاح (0 أولاً)
  let filtered = products.filter(p=> (parseInt(p.stock)||0) < 3);
  // ترتيب تصاعدي
  filtered.sort((a,b)=> (parseInt(a.stock)||0) - (parseInt(b.stock)||0) || (a.name||'').localeCompare(b.name||''));
  // بحث
  if(q){
    filtered=filtered.filter(p=>{
      if(/^\d+$/.test(q)){
        const seq=products.indexOf(p)+1;
        if(String(seq)===q) return true;
        if(String(p.id)===q) return true;
      }
      return p.name.toLowerCase().includes(q) || p.barcode.includes(q) || String(p.stock).includes(q);
    });
  }
  try{
    const curHash = _hashList(filtered) + "|q:" + q;
    if(curHash === _lastShortageHash && body.children.length>0) return;
    _lastShortageHash = curHash;
  }catch(e){}
  body.innerHTML="";
  const badge=document.getElementById('shortageCount');
  if(badge) badge.textContent=filtered.length+" منتج";
  filtered.forEach((p)=>{
    const seq=products.indexOf(p)+1;
    const stockVal = parseInt(p.stock)||0;
    let stockColor = stockVal===0 ? '#c73e3e' : stockVal===1 ? '#c8943a' : '#dbaa55';
    let stockBg = stockVal===0 ? 'rgba(199,62,62,.15)' : stockVal===1 ? 'rgba(200,148,58,.15)' : 'rgba(219,170,85,.12)';
    const row=document.createElement('div'); row.className='row-item';
    // تلوين صف النواقص حسب الخطورة
    row.style.borderRight=`3px solid ${stockColor}`;
    row.innerHTML=`
      <span class="w-num">${seq}</span>
      <span class="w-num" style="color:#fff;background:${stockBg};border-radius:4px;padding:2px 0;font-weight:900">${stockVal}</span>
      <span class="price">${parseFloat(p.price).toFixed(2)}</span>
      <span>${p.category}</span>
      <span style="font-size:11px;flex:1.2">${p.barcode}</span>
      <span style="flex:1.5">${p.name}</span>
      <span class="w-ctrl" style="flex:0 0 70px;display:flex;gap:4px;justify-content:center">
        <button class="edit" style="width:62px;height:26px;font-size:11px;background:#c8943a;color:#fff;border:none;border-radius:6px;cursor:pointer" onclick="openEditModal(${p.id})" title="تعديل">✏ تعديل</button>
      </span>`;
    row.style.cursor='pointer';
    row.addEventListener('click', (e)=>{
      if(e.target.closest('button')) return;
      openEditModal(p.id);
    });
    body.appendChild(row);
  });
  if(filtered.length===0) body.innerHTML=`<div style="text-align:center;color:#9e9e9e;padding:20px">لا يوجد نواقص — كل المنتجات متاحها ≥ 3</div>`;
}
function togglePricingExpand(id){
  if(_expandedPricingId===id){
    collapsePricingCard(id);
    return;
  }
  // أغلق السابق بانبثاق عكسي
  const prev=_expandedPricingId;
  if(prev!==null){
    const prevCard=document.querySelector(`.pricing-card[data-id="${prev}"]`);
    if(prevCard){
      prevCard.classList.add('closing');
      prevCard.classList.remove('expanded');
      setTimeout(()=>{ _expandedPricingId=null; renderPricingTable(); }, 280);
      setTimeout(()=>{ _expandedPricingId=id; renderPricingTable(); }, 300);
      return;
    }
  }
  _expandedPricingId=id;
  renderPricingTable();
  setTimeout(()=>{
    const inp=document.getElementById('price_'+id);
    if(inp) inp.focus();
  }, 360);
}
function collapsePricingCard(id){
  const card=document.querySelector(`.pricing-card[data-id="${id}"]`);
  if(card){
    card.classList.add('closing');
    card.classList.remove('expanded');
    setTimeout(()=>{
      if(_expandedPricingId===id) _expandedPricingId=null;
      _lastPricingHash=""; _lastShortageHash="";
      renderPricingTable(); renderShortageTable();
    }, 280);
  } else {
    _expandedPricingId=null;
    _lastPricingHash=""; _lastShortageHash="";
    renderPricingTable(); renderShortageTable();
  }
}
function toggleEditPricingName(id){
  const row=document.getElementById('nameRow_'+id);
  if(!row) return;
  const isEditing=row.classList.contains('editing');
  if(isEditing){
    row.classList.remove('editing');
  } else {
    row.classList.add('editing');
    const inp=document.getElementById('nameInput_'+id);
    if(inp){ inp.focus(); inp.select(); }
  }
}
async function savePricing(id){
  const priceInp=document.getElementById('price_'+id);
  const stockInp=document.getElementById('stock_'+id);
  const nameInp=document.getElementById('nameInput_'+id);
  const vPrice=parseFloat(priceInp?priceInp.value:'');
  const vStock=parseInt(stockInp?stockInp.value:'');
  const vName=(nameInp?nameInp.value:document.getElementById('nameText_'+id)?.textContent||'').trim();
  if(!vName) return showToast('ادخل اسم المنتج','warning');
  if(isNaN(vPrice) || vPrice<0) return showToast('ادخل سعر صحيح >= 0','warning');
  if(isNaN(vStock) || vStock<0) return showToast('ادخل متاح صحيح >= 0','warning');
  const orig=products.find(x=>x.id===id);
  const patch={price:vPrice, stock:vStock, name:vName, barcode: orig?orig.barcode:undefined, updated_at:_localNow()};
  try{
    let updated=null;
    if(window.SupabaseSync && window.SupabaseSync.isConfigured()){
      console.log('[PRICING] إرسال للسحابة',id, patch);
      updated=await SupabaseSync.updateProduct(id, patch);
      if(!updated){
        console.warn('[PRICING] updateProduct رجع null — يحاول إعادة الجلب');
        // حاول جلب المنتج بعد التحديث للتأكد
        try{
          const all=await SupabaseSync.getProducts();
          updated=all.find(x=> x.id===id || x.barcode===patch.barcode) || patch;
        }catch(e){ updated=patch; }
      } else {
        console.log('[PRICING] تم تحديث السحابة',updated);
      }
      if(!updated) updated=patch;
    } else {
      throw new Error('Supabase غير متاح');
    }
    const p=products.find(x=>x.id===id);
    if(p){
      p.price=updated.price!=null?updated.price:vPrice;
      p.stock=updated.stock!=null?updated.stock:vStock;
      p.name=updated.name||vName;
      p.updated_at=updated.updated_at||patch.updated_at;
    }
    _syncWindowProducts(); try{ _updateSWBgState(); }catch(e){}
    // انيميشن انبثاق عكسي ثم تحديث
    const card=document.querySelector(`.pricing-card[data-id="${id}"]`);
    if(card){
      card.classList.add('closing');
      card.classList.remove('expanded');
      showToast(`تم الحفظ ومزامنته ✓ ${vName} — ${vPrice} جنيه / ${vStock} متاح`,'success');
      setTimeout(()=>{
        _expandedPricingId=null;
        _lastPricingHash=""; _lastShortageHash="";
        renderPricingTable(); renderShortageTable();
        renderUserTable();
        const tb=document.getElementById('tableBody'); if(tb) renderTable();
      }, 300);
    } else {
      _expandedPricingId=null;
      _lastPricingHash=""; _lastShortageHash="";
      renderPricingTable(); renderShortageTable();
      renderUserTable();
      showToast(`تم الحفظ ✓`,'success');
    }
  }catch(e){
    showToast('فشل الحفظ: '+e.message,'error');
  }
}
async function setPrice(id){
  // للتوافق مع أي استدعاء قديم — يحول إلى savePricing
  return savePricing(id);
}
function scanEnter(){
  const el=document.getElementById('searchUser');
  if(el) el.focus();
}
function addToCart(prod){
  const it=cart.find(x=>x.product.id===prod.id);
  if(it){
    if(it.qty+1>prod.stock) return showToast('المتاح فقط '+prod.stock,'warning');
    it.qty++;
  } else {
    if(prod.stock<1) return showToast('نفد المخزون','warning');
    cart.push({product:prod, qty:1});
  }
  selected=prod; renderCart(); renderDetails(prod);
}
function renderCart(){
  const body=document.getElementById('cartBody'); if(!body) return; body.innerHTML='';
  if(cart.length===0){ body.innerHTML=`<div style="text-align:center;color:#9e9e9e;padding:20px">السلة فارغة — امسح باركود</div>`; updateTotal(); return; }
  cart.forEach((it,idx)=>{
    const p=it.product, qty=it.qty, total=(p.price*qty).toFixed(2);
    const row=document.createElement('div'); row.className='row-item';
    row.innerHTML=`
      <span>${p.name}</span>
      <span>${p.price.toFixed(2)}</span>
      <span><button onclick="changeQty(${idx},-1)" style="width:26px">−</button> ${qty} <button onclick="changeQty(${idx},1)" style="width:26px">+</button></span>
      <span class="price">${total}</span>
      <span class="w-ctrl"><button class="del" style="width:100%" onclick="removeCart(${idx})">✕</button></span>`;
    row.onclick=()=>renderDetails(p);
    body.appendChild(row);
  });
  updateTotal();
}
function renderDetails(prod){
  const dNameEl=_getEl('dName'), dBarcodeEl=_getEl('dBarcode'), dSerialEl=_getEl('dSerial'), dPriceEl=_getEl('dPrice'), dStockEl=_getEl('dStock');
  const hasDetails = !!(dNameEl && dBarcodeEl);
  if(!hasDetails) { selected=prod; return; }
  if(!prod){ if(dNameEl) dNameEl.textContent="اختر منتج أو امسح باركود"; if(dBarcodeEl) dBarcodeEl.textContent="—"; if(dSerialEl) dSerialEl.textContent="—"; if(dPriceEl) dPriceEl.textContent="—"; if(dStockEl) dStockEl.textContent="المتاح: —"; selected=null; return; }
  selected=prod;
  const seq=products.indexOf(prod)+1;
  if(dNameEl) dNameEl.textContent=prod.name; if(dBarcodeEl) dBarcodeEl.textContent="باركود: "+prod.barcode; if(dSerialEl) dSerialEl.textContent=`#${seq} — ${String(prod.id).padStart(4,'0')}`; if(dPriceEl) dPriceEl.textContent=parseFloat(prod.price).toFixed(2)+" جنيه"; if(dStockEl) dStockEl.textContent=`المتاح: ${prod.stock} قطعة`;
}
function changeQty(idx,delta){
  const it=cart[idx]; if(!it) return;
  const nq=it.qty+delta;
  if(nq<1) return removeCart(idx);
  if(nq>it.product.stock) return showToast('المتاح '+it.product.stock,'warning');
  it.qty=nq; renderCart(); renderDetails(it.product);
}
function removeCart(idx){ cart.splice(idx,1); renderCart(); renderDetails(null); }
function clearCart(){ cart=[]; renderCart(); renderDetails(null); }
function updateTotal(){
  const total=cart.reduce((s,it)=>s+it.product.price*it.qty,0);
  const count=cart.reduce((s,it)=>s+it.qty,0);
  const el=document.getElementById('totalLabel');
  if(el) el.textContent=`${count} قطعة | الإجمالي: ${total.toFixed(2)} جنيه`;
}
function checkout(){
  if(cart.length===0) return showToast('السلة فارغة','warning');
  const total=cart.reduce((s,it)=>s+it.product.price*it.qty,0);
  showToast(`تم الدفع ${total.toFixed(2)} جنيه — ${cart.length} منتجات`,'success',4000);
  cart.forEach(it=>{ const p=products.find(x=>x.id===it.product.id); if(p) p.stock=Math.max(0,p.stock-it.qty); });
  _syncWindowProducts(); try{ _updateSWBgState(); }catch(e){}
  cart=[]; renderCart(); renderDetails(null); renderUserTable(); renderShortageTable();
  const tb=document.getElementById('tableBody'); if(tb) renderTable();
}

setInterval(()=>{ try{ const d=new Date(); const cl=document.getElementById('clock'); const dl=document.getElementById('dateLabel'); if(cl) cl.textContent=d.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', hour12:true}); if(dl) dl.textContent=d.toLocaleDateString('en-GB'); }catch(e){} },1000);
const scanEl=document.getElementById('scan');
if(scanEl) try{ scanEl.addEventListener('keydown', e=>{ if(e.key==='Enter') try{ scanEnter(); }catch(_){} }); }catch(e){}
try{ genBarcode(); }catch(e){ console.warn('genBarcode init fail', e.message); }
try{ renderTable(); }catch(e){ console.warn('renderTable init fail', e.message); }
try{ renderUserTable(); }catch(e){ console.warn('renderUserTable init fail', e.message); }
try{ renderPricingTable(); }catch(e){ console.warn('renderPricingTable init fail', e.message); }
try{ renderShortageTable(); }catch(e){ console.warn('renderShortageTable init fail', e.message); }
try{ if(typeof renderCart==='function') renderCart(); }catch(e){}
 // افتراضي: افتح على قائمة المنتجات V4.11
try{ switchRole('employee'); }catch(e){}
// عرض فوري للكاش المحلي — يظهر مزامن بالأزرق حتى قبل وصول السحابة
// === إرسال إعدادات Supabase إلى SW للمزامنة الذاتية — V4.4 مُصلح جذري (يعيد المحاولة حتى ينجح) ===
function _sendConfigToSW(){
  try{
    if(!navigator.serviceWorker) return false;
    if(!window.SupabaseSync || !SupabaseSync.getConfig) return false;
    const cfg = SupabaseSync.getConfig();
    if(!cfg || !cfg.url || !cfg.key) return false;
    let sent=false;
    // 1) عبر controller إن وجد
    try{
      if(navigator.serviceWorker.controller){
        navigator.serviceWorker.controller.postMessage({type:'SYNC_CONFIG', url: cfg.url, key: cfg.key});
        console.log('[SYNC-CONFIG] أرسلت عبر controller');
        sent=true;
      }
    }catch(e){}
    // 2) عبر ready.active كـ fallback (مهم عند أول تحميل قبل سيطرة SW)
    try{
      navigator.serviceWorker.ready.then(reg=>{
        if(reg && reg.active){
          try{ reg.active.postMessage({type:'SYNC_CONFIG', url: cfg.url, key: cfg.key}); console.log('[SYNC-CONFIG] أرسلت عبر ready.active'); sent=true; }catch(e){}
        }
        // أيضاً عبر getRegistration
        navigator.serviceWorker.getRegistration().then(r=>{
          if(r && r.active && r.active!==reg.active){
            try{ r.active.postMessage({type:'SYNC_CONFIG', url: cfg.url, key: cfg.key}); }catch(e){}
          }
        }).catch(()=>{});
      }).catch(()=>{});
      if(sent) return true;
      // إذا لم يكن هناك controller بعد، سنعيد المحاولة
      if(!navigator.serviceWorker.controller){
        console.log('[SYNC-CONFIG] لا يوجد controller — سيعاد بعد 1.5ث');
        setTimeout(_sendConfigToSW, 1500);
        return false;
      }
    }catch(e){}
    return sent;
  }catch(e){ console.warn('[SYNC-CONFIG] fail', e.message); return false; }
}
function _updateSWBgState(){
  try{
    if(!navigator.serviceWorker) return;
    const barcodes = JSON.stringify(products.map(p=>p.barcode).sort());
    const count = products.length;
    let sent=false;
    try{
      if(navigator.serviceWorker.controller){
        navigator.serviceWorker.controller.postMessage({type:'SET_BG_STATE', count: count, barcodes: barcodes});
        sent=true;
      }
    }catch(e){}
    try{
      navigator.serviceWorker.ready.then(reg=>{
        if(reg && reg.active) reg.active.postMessage({type:'SET_BG_STATE', count: count, barcodes: barcodes});
      }).catch(()=>{});
    }catch(e){}
    if(!sent && !navigator.serviceWorker.controller){
      // أجل لما يجهز
      setTimeout(_updateSWBgState, 1200);
    }
  }catch(e){}
}
// حاول إرسال الإعداد عند جاهزية SW — مع إعادة محاولة
if('serviceWorker' in navigator){
  navigator.serviceWorker.ready.then(()=> { setTimeout(_sendConfigToSW, 800); setTimeout(_sendConfigToSW, 2500); }).catch(()=>{});
  navigator.serviceWorker.addEventListener('controllerchange', ()=> setTimeout(_sendConfigToSW, 500));
  // استقبال طلب الإعداد من SW
  navigator.serviceWorker.addEventListener('message', e=>{
    if(e.data && e.data.type==='REQUEST_SYNC_CONFIG'){ _sendConfigToSW(); }
    if(e.data && e.data.type==='BG_PRODUCTS_UPDATED'){
      console.log('[SYNC] إشعار خلفي — تحديث فوري');
      syncFromApi({force:true});
    }
    if(e.data && e.data.type==='DO_BG_SYNC'){
      console.log('[SYNC] SW طلب مزامنة خلفية');
      syncFromApi({force:true});
    }
  });
  // إعادة إرسال دورية لضمان الخلفية (كل 20 ثانية لأول دقيقة)
  let _cfgRetries=0;
  const _cfgInterval=setInterval(()=>{
    _cfgRetries++;
    _sendConfigToSW();
    _updateSWBgState();
    if(_cfgRetries>=3) clearInterval(_cfgInterval);
  }, 5000);
}
// Periodic Background Sync registration (PWA)
async function _registerPeriodicSyncApp(){
  try{
    const reg = await navigator.serviceWorker.ready;
    if(reg && 'periodicSync' in reg){
      const st = await navigator.permissions.query({name:'periodic-background-sync'}).catch(()=>({state:'granted'}));
      if(st.state==='granted' || st.state==='prompt'){
        await reg.periodicSync.register('sync-products', {minInterval: 15*60*1000});
        console.log('[SYNC] periodicSync مسجل 15د ✓');
      }
    }
  }catch(e){ console.log('[SYNC] periodicSync غير مدعوم', e.message); }
}
async function _registerBgSyncOne(){
  try{
    const reg = await navigator.serviceWorker.ready;
    if(reg && 'sync' in reg){ await reg.sync.register('sync-products'); console.log('[SYNC] bg sync مسجل'); }
  }catch(e){}
}
// Cordova BackgroundFetch (يعمل حتى لو التطبيق مقفول)
function _initCordovaBackgroundFetch(){
  try{
    if(window.BackgroundFetch){
      const onEvent = async (taskId)=>{
        console.log('[BG-FETCH] event', taskId);
        try{ await syncFromApi({force:true}); }catch(e){}
        // أرسل إشعار خفيف عبر SW لو زاد العدد
        try{ _updateSWBgState(); }catch(e){}
        BackgroundFetch.finish(taskId);
      };
      const onTimeout = (taskId)=>{ console.log('[BG-FETCH] timeout',taskId); BackgroundFetch.finish(taskId); };
      BackgroundFetch.configure({minimumFetchInterval:15, stopOnTerminate:false, startOnBoot:true, enableHeadless:true, requiresBatteryNotLow:false, requiresCharging:false}, onEvent, onTimeout);
      BackgroundFetch.start(()=> console.log('[BG-FETCH] started')).catch(()=>{});
      console.log('[BG-FETCH] مهيأ ✓');
    }
    // BackgroundMode — إبقاء الجافاسكربت حي عند التصغير
    if(window.cordova && window.cordova.plugins && window.cordova.plugins.backgroundMode){
      const bg = window.cordova.plugins.backgroundMode;
      bg.setDefaults({title:'مزامنة النحال', text:'المزامنة نشطة في الخلفية', silent:true});
      bg.enable();
      bg.on('activate', ()=>{ try{ bg.disableWebViewOptimizations(); }catch(e){} console.log('[BG-MODE] activate'); });
      console.log('[BG-MODE] مفعل');
    }
  }catch(e){ console.log('[BG] Cordova bg fail', e.message); }
}
document.addEventListener('deviceready', ()=>{
  setTimeout(_initCordovaBackgroundFetch, 1500);
  setTimeout(_registerPeriodicSyncApp, 2000);
  setTimeout(_sendConfigToSW, 1000);
  setTimeout(_sendConfigToSW, 3500);
  setTimeout(()=>{
    try{
      _updateSWBgState();
    }catch(e){}
  }, 4000);
}, false);
if(document.readyState!=='loading'){ setTimeout(_registerPeriodicSyncApp, 2500); } else { document.addEventListener('DOMContentLoaded', ()=> setTimeout(_registerPeriodicSyncApp, 2500)); }

// Wake Lock — منع إيقاف الشاشة/المزامنة عند فتح التطبيق
let _wakeLock=null;
async function _requestWakeLock(){
  try{ if('wakeLock' in navigator){ _wakeLock = await navigator.wakeLock.request('screen'); console.log('[WAKELOCK] ✓'); _wakeLock.addEventListener('release', ()=> console.log('[WAKELOCK] released')); } }catch(e){}
}
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible' && 'wakeLock' in navigator && !_wakeLock) _requestWakeLock(); });
setTimeout(_requestWakeLock, 2000);

try{
  if(products.length>0){
    _setBadge(products.length);
  } else {
    _setSyncState('جاري المزامنة...','#c8943a','syncing');
  }
}catch(e){}
syncFromApi({force:true});
initSupabaseRealtime();
setTimeout(_sendConfigToSW, 1200);
setTimeout(_sendConfigToSW, 3000);
setTimeout(_registerPeriodicSyncApp, 1800);
setTimeout(_updateSWBgState, 1500);
setTimeout(_updateSWBgState, 3500);
// (الإشعارات معطلة V4.7)
window.debugNotif = function(){ return 'الإشعارات معطلة'; };
// === نظام مزامنة موحّد مُصلح V4.5.2 — سريع + ذكي + بدون تزاحم ===
let _pollFg = 3500; // سريع لما Realtime مقطوع (3.5ث)
let _pollBg = 12000; // خلفية أسرع (12ث) بدل 25ث
let _pollTimer = null;
function _getPollInterval(){
  const isVisible = document.visibilityState==='visible';
  const realtimeOk = (window.SupabaseSync && window.SupabaseSync.isRealtimeConnected && window.SupabaseSync.isRealtimeConnected());
  if(realtimeOk){
    // لو Realtime شغال، polling خفيف كـ backup فقط
    return isVisible ? 12000 : 30000;
  } else {
    // لو Realtime مقطوع، سرّع polling للتعويض
    return isVisible ? _pollFg : _pollBg;
  }
}
function _schedulePoll(){
  if(_pollTimer) clearTimeout(_pollTimer);
  const interval = _getPollInterval();
  _pollTimer = setTimeout(async ()=>{
    try{ await syncFromApi({force:false}); }catch(e){}
    _schedulePoll();
  }, interval);
}
_schedulePoll();
document.addEventListener('visibilitychange', ()=>{
  _schedulePoll();
  if(document.visibilityState==='visible'){ _throttledSync('visibility visible'); }
});
// فحص صحة Realtime كل 7 ثوان (بدل 10) + إعادة تشغيل فوري لو ميت
setInterval(()=>{ _checkRealtimeHealth(); }, 7000);
// إعادة محاولة ذكية — كل 3 ثوان فقط لو فعلاً غير متصل + Realtime مقطوع
setInterval(()=>{
  const dot=document.getElementById('syncDot');
  const isOk=dot && dot.classList.contains('ok');
  const rtOk = window.SupabaseSync && window.SupabaseSync.isRealtimeConnected && window.SupabaseSync.isRealtimeConnected();
  if(rtOk && isOk && _syncFailCount===0) return; // لا حاجة — Realtime يكفي
  if(_syncFailCount>0 || _lastBadgeCount===-1 || !isOk || !rtOk){
    console.log('[SYNC-RETRY 3s] محاولة تلقائية (rtOk='+rtOk+')');
    syncFromApi({force:true});
  }
}, 3000);
// throttling لحدث online/visibility/focus — منع الطلقات المتكررة
let _lastOnlineSync = 0;
function _throttledSync(reason){
  const now = Date.now();
  if(now - _lastOnlineSync < 1500) return;
  _lastOnlineSync = now;
  console.log('[SYNC]', reason);
  _syncFailCount=0; _clearSyncRetry();
  // لو Realtime ميت أعد تشغيله أولاً
  try{ _checkRealtimeHealth(); }catch(e){}
  syncFromApi({force:true});
  // أرسل config محدث للـ SW
  try{ _sendConfigToSW(); }catch(e){}
  // سجل bg sync
  try{ _registerBgSyncOne(); }catch(e){}
}
window.addEventListener('online', ()=>{ _throttledSync('online'); });
window.addEventListener('offline', ()=>{ _setSyncState('غير متصل - السحابة','#c73e3e','error'); _scheduleSyncRetry(); });
// مزامنة فورية عند عودة التطبيق للواجهة بدون الحاجة لإغلاقه — مع throttling
window.addEventListener('focus', ()=>{ _throttledSync('focus'); });
window.addEventListener('pageshow', ()=>{ _throttledSync('pageshow'); });
// عند العودة من الخلفية، حدث SW state أيضاً (كان 30ث → 60ث لتقليل ضغط)
setInterval(()=>{ try{ _updateSWBgState(); }catch(e){} }, 60000);

// ===== حل جذري V3.12: اكتشاف حجم الشاشة الحقيقي وملء متجاوب لكل جهاز =====
// يكتشف العرض/الطول/DPR/الاتجاه ويضيف فئات CSS ويحدّث متغيرات --screen-*
let _lastW=0,_lastH=0,_screenTimer=null,_lastOri='';
function applyScreenSize(){
  try{
    const vv = window.visualViewport;
    const w = Math.round(vv ? vv.width : window.innerWidth);
    const h = Math.round(vv ? vv.height : window.innerHeight);
    const sw = Math.round(window.screen ? window.screen.width : w);
    const sh = Math.round(window.screen ? window.screen.height : h);
    const dpr = window.devicePixelRatio || 1;
    const availW = Math.round(window.screen ? (window.screen.availWidth || sw) : w);
    const availH = Math.round(window.screen ? (window.screen.availHeight || sh) : h);
    if(!w || !h || w<50 || h<50) return;
    const isLandscape = w > h;
    const ori = isLandscape ? 'landscape' : 'portrait';
    const isSameSize = (w===_lastW && h===_lastH && ori===_lastOri);
    if(isSameSize) return;
    _lastW=w; _lastH=h; _lastOri=ori;
    const docEl=document.documentElement;
    docEl.style.setProperty('--screen-w', w+'px');
    docEl.style.setProperty('--screen-h', h+'px');
    docEl.style.setProperty('--screen-sw', sw+'px');
    docEl.style.setProperty('--screen-sh', sh+'px');
    docEl.style.setProperty('--screen-aw', availW+'px');
    docEl.style.setProperty('--screen-ah', availH+'px');
    docEl.style.setProperty('--screen-dpr', dpr);
    docEl.style.setProperty('--screen-orientation', ori);
    // فئات متجاوبة للـ CSS و JS
    const body=document.body;
    if(body){
      body.classList.remove('screen-xs','screen-sm','screen-md','screen-lg','screen-xl','orient-portrait','orient-landscape','is-mobile','is-tablet','is-desktop');
      let sizeCls='screen-xs';
      if(w>=1600) sizeCls='screen-xl';
      else if(w>=1200) sizeCls='screen-lg';
      else if(w>=900) sizeCls='screen-md';
      else if(w>=600) sizeCls='screen-sm';
      body.classList.add(sizeCls);
      body.classList.add(ori==='landscape' ? 'orient-landscape' : 'orient-portrait');
      if(w>=900) body.classList.add('is-desktop');
      else if(w>=600) body.classList.add('is-tablet');
      else body.classList.add('is-mobile');
      body.dataset.screenW=w;
      body.dataset.screenH=h;
      body.dataset.orient=ori;
    }
    // تأكد أن .phone يملأ الشاشة فعلياً (حماية إضافية لو CSS لم يطبق)
    try{
      const phone=document.querySelector('.phone');
      if(phone){
        phone.style.width='100%';
        phone.style.maxWidth='none';
        // استخدم 100dvh لو مدعوم وإلا 100vh
        if(CSS && CSS.supports && CSS.supports('height','100dvh')){
          phone.style.height='100dvh';
          phone.style.minHeight='100dvh';
        } else {
          phone.style.height='100vh';
          phone.style.minHeight='100vh';
        }
      }
    }catch(e){}
    console.log(`[SCREEN V3.12] ${w}x${h} ${ori} DPR ${dpr} (screen ${sw}x${sh} avail ${availW}x${availH}) → ${body?body.className:''}`);
  }catch(e){ console.warn('[SCREEN] fail',e); }
}
function _debouncedApply(){
  if(_screenTimer) clearTimeout(_screenTimer);
  _screenTimer=setTimeout(applyScreenSize, 80);
}
// مراقبة تغيير الحجم بكل الطرق
window.addEventListener('load', applyScreenSize);
window.addEventListener('resize', _debouncedApply);
window.addEventListener('orientationchange', ()=> setTimeout(applyScreenSize, 200));
if(window.visualViewport){
  window.visualViewport.addEventListener('resize', _debouncedApply);
  window.visualViewport.addEventListener('scroll', _debouncedApply);
}
// MediaQuery للاتجاه
try{
  const mqlPortrait=window.matchMedia('(orientation: portrait)');
  const mqlLandscape=window.matchMedia('(orientation: landscape)');
  if(mqlPortrait.addEventListener) mqlPortrait.addEventListener('change', _debouncedApply);
  else if(mqlPortrait.addListener) mqlPortrait.addListener(_debouncedApply);
  if(mqlLandscape.addEventListener) mqlLandscape.addEventListener('change', _debouncedApply);
} catch(e){}
// ResizeObserver على .phone و documentElement
try{
  if(window.ResizeObserver){
    const ro=new ResizeObserver(_debouncedApply);
    ro.observe(document.documentElement);
    const phone=document.querySelector('.phone');
    if(phone) ro.observe(phone);
    // راقب أيضاً body
    if(document.body) ro.observe(document.body);
  }
} catch(e){}
applyScreenSize();
// إعادة تطبيق عند العودة للواجهة (مهم للتابلت عند تدوير)
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') setTimeout(applyScreenSize, 150); });
window.addEventListener('pageshow', applyScreenSize);
window.addEventListener('focus', _debouncedApply);
// فحص دوري قصير للتأكد من ثبات الحجم (يعالج تأخر visualViewport على بعض الأجهزة)
let _screenChecks=0;
const _screenInterval=setInterval(()=>{
  applyScreenSize();
  _screenChecks++;
  if(_screenChecks>10) clearInterval(_screenInterval);
}, 600);

// تنظيف OTA قديم يحتوي 420px (بقايا محاكاة الموبايل)
(function purgeOldOTACSS(){
  try{
    const css=localStorage.getItem('ota_style.css');
    if(css && (css.includes('max-width:420') || css.includes('max-width: 420'))){
      console.warn('[SCREEN] اكتشاف OTA قديم بحد 420px → مسح فوري');
      localStorage.removeItem('ota_style.css');
      // احذف أيضاً كاش SW القديم
      if('caches' in window){
        caches.keys().then(keys=> Promise.all(keys.filter(k=>k.startsWith('nahal-ota-')).map(k=> caches.delete(k)))).catch(()=>{});
      }
      // أزل أي ستايل محقون قديم
      const old=document.getElementById('ota-style-early');
      if(old) old.remove();
      const old2=document.getElementById('ota-style-fallback');
      if(old2) old2.remove();
      // أعد تحميل CSS الحالي
      setTimeout(()=> applyScreenSize(), 200);
    }
  }catch(e){}
})();

// === كاشف الشاشة السودة + أخطاء تلقائي — يصلح نفسه بدون مسح يدوي ===
let _bootErrors=0, _lastErrorTime=0;
window.addEventListener('error', (e)=>{
  try{
    _bootErrors++;
    _lastErrorTime=Date.now();
    // لو 3 أخطاء في أول 5 ثواني → تعارض واضح → امسح OTA تلقائياً
    let _elapsed = 99999;
    try{ _elapsed = (typeof performance !== 'undefined' && performance.now) ? performance.now() : (Date.now() - ((performance.timing && performance.timing.navigationStart) || performance.timeOrigin || Date.now())); }catch(e){}
    if(_bootErrors>=3 && _elapsed < 6000){
      console.warn('[AUTO-RECOVER] أخطاء متتالية → مسح OTA');
      autoRecoverBlackScreen('js_error');
    }
  }catch(_e){}
});
window.addEventListener('unhandledrejection', (e)=>{
  try{ _bootErrors++; if(_bootErrors>=3) autoRecoverBlackScreen('promise_error'); }catch(_e){}
});
function autoRecoverBlackScreen(reason){
  try{
    if(sessionStorage.getItem('_auto_recovered')) return;
    sessionStorage.setItem('_auto_recovered','1');
    console.log('[AUTO-RECOVER] سبب:',reason);
    // مسح OTA فقط — احتفظ بالمنتجات ليُعاد مزامنتها
    for(let i=localStorage.length-1;i>=0;i--){ const k=localStorage.key(i); if(k&&k.startsWith('ota_')) localStorage.removeItem(k); }
    try{ localStorage.removeItem('ota_version'); localStorage.removeItem('ota_github_sha'); }catch(e){}
    try{ sessionStorage.removeItem('_ota_html_boot'); }catch(e){}
    if('caches' in window){
      caches.keys().then(keys=> Promise.all(keys.filter(k=>k.startsWith('nahal-ota-')).map(k=> caches.delete(k)))).catch(()=>{});
    }
    showToast('تم إصلاح التعارض تلقائياً — إعادة تحميل','info',2500);
    setTimeout(()=> location.reload(), 900);
  }catch(e){ console.warn('[RECOVER] fail',e); }
}
// كاشف شاشة سودة: لو السبلاش لم يختف بعد 7s أو phone مخفي
setTimeout(()=>{
  try{
    const splash=document.getElementById('splash');
    const phone=document.querySelector('.phone');
    let _elapsed2 = 99999;
    try{ _elapsed2 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0; }catch(e){}
    const splashStuck = splash && document.body.contains(splash) && splash.style.opacity!=='0' && getComputedStyle(splash).display!=='none';
    const phoneHidden = phone && (phone.offsetHeight<50 || getComputedStyle(phone).display==='none');
    const bodyBlack = document.body && getComputedStyle(document.body).backgroundColor==='rgba(0, 0, 0, 0)';
    if((splashStuck && _elapsed2>7000) || phoneHidden){
      console.warn('[AUTO-RECOVER] شاشة سودة مكتشفة', {splashStuck, phoneHidden, _elapsed2});
      autoRecoverBlackScreen('black_screen');
    }
  }catch(e){}
}, 7500);
// === سحابة فقط — تنظيف خلفي مبسط (لا يلمس localStorage للمنتجات) ===
let _lastBgClean = 0;
async function backgroundAutoClean(){
  try{
    if(_syncInProgress) return;
    if(!window.SupabaseSync || !SupabaseSync.isConfigured()) return;
    const now = Date.now();
    if(now - _lastBgClean < 30000) return;
    if(now - _lastSyncTime < 5000) return;
    _lastBgClean = now;
    const d = await SupabaseSync.getProducts();
    if(!Array.isArray(d)) return;
    // استخدم المسار الموحد _applyProducts لتوحيد منطق الفراغ والمزامنة
    const changed = _applyProducts(d, 'BG-clean');
    // _applyProducts يحدّث المنتجات والواجهة، لكن _setBadge يحتاج تحديث حتى لو لم يتغير
    try{ _setBadge(products.length); }catch(e){}
    if(changed) console.log('[BG-clean] تم تحديث من الخلفية');
  }catch(e){}
}
setTimeout(backgroundAutoClean, 6000);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') setTimeout(backgroundAutoClean, 2500); });
window.addEventListener('focus', ()=> setTimeout(backgroundAutoClean, 2500));
setInterval(backgroundAutoClean, 90000); // كان 45ث → 90ث لتقليل التداخل
// مسح تلقائي ذكي مع كل فتحة — يمنع تعارض النسخ + 420px
(function autoCleanOnBoot(){
  try{
    function cmp(a,b){ const pa=String(a).split('.').map(x=>parseInt(x,10)||0); const pb=String(b).split('.').map(x=>parseInt(x,10)||0); const l=Math.max(pa.length,pb.length); for(let i=0;i<l;i++){ const av=pa[i]||0,bv=pb[i]||0; if(av>bv) return 1; if(av<bv) return -1; } return 0; }
    const CUR="4.21";
    const ver=localStorage.getItem('ota_version');
    if(ver && cmp(ver, CUR) < 0){
      console.log('[BOOT-CLEAN] OTA قديم',ver,'<',CUR,'→ مسح تلقائي');
      for(let i=localStorage.length-1;i>=0;i--){ const k=localStorage.key(i); if(k&&k.startsWith('ota_')) localStorage.removeItem(k); }
      localStorage.removeItem('ota_version');
      try{ sessionStorage.removeItem('_ota_html_boot'); }catch(e){}
      sessionStorage.removeItem('_auto_recovered');
      if('caches' in window) caches.keys().then(keys=> Promise.all(keys.filter(k=>k.startsWith('nahal-ota-')).map(k=> caches.delete(k)))).catch(()=>{});
    }
    // لو لا يوجد ota_version لكن يوجد ota_* بقايا → مسح
    if(!ver){
      let hasOta=false;
      for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k&&k.startsWith('ota_')){ hasOta=true; break; } }
      if(hasOta){
        console.log('[BOOT-CLEAN] بقايا OTA بدون version → مسح');
        for(let i=localStorage.length-1;i>=0;i--){ const k=localStorage.key(i); if(k&&k.startsWith('ota_')) localStorage.removeItem(k); }
      }
    }
    // فحص إضافي: لو ota_style.css لا يزال يحتوي 420px → مسح فوري (حل جذري V3.12)
    try{
      const css=localStorage.getItem('ota_style.css');
      if(css && (css.includes('max-width:420') || css.includes('max-width: 420'))){
        console.warn('[BOOT-CLEAN] OTA style يحتوي 420px → مسح');
        localStorage.removeItem('ota_style.css');
        const el1=document.getElementById('ota-style-early');
        if(el1) el1.remove();
        const el2=document.getElementById('ota-style-fallback');
        if(el2) el2.remove();
        if('caches' in window) caches.keys().then(keys=> Promise.all(keys.filter(k=>k.startsWith('nahal-ota-')).map(k=> caches.delete(k)))).catch(()=>{});
      }
    }catch(e){}
  }catch(e){ console.warn('[BOOT-CLEAN] fail',e); }
})();
