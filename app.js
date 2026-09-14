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
let _lastTableHash="", _lastUserHash="", _lastPricingHash="";
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
    _lastTableHash=""; _lastUserHash=""; _lastPricingHash="";
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
  try{ renderUserTable(); renderPricingTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); }catch(e){}
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
      _lastTableHash=""; _lastUserHash=""; _lastPricingHash="";
      try{ renderUserTable(); renderPricingTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); }catch(e){}
      _setBadge(0);
      return false;
    }
    if(_consecutiveEmptyCount >= 2){
      console.log(`[APPLY] تأكدت سحابة فارغة ${source} بعد محاولتين — مسح الذاكرة (سحابة فقط)`);
      products = [];
      _lastTableHash=""; _lastUserHash=""; _lastPricingHash="";
      try{ renderUserTable(); renderPricingTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); }catch(e){}
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
  _lastTableHash=""; _lastUserHash=""; _lastPricingHash="";
  renderUserTable(); renderPricingTable();
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
      // إشعار عند منتج جديد (polling)
      try{ if(window.NotifManager) NotifManager.onProductsUpdated(data, 'poll'); }catch(e){}
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
      console.log('[Supabase RT] onChange', newData.length);
      _applyProducts(newData, 'Supabase RT');
      _setBadge(products.length);
      // إشعار عند منتج جديد (واتساب)
      try{ if(window.NotifManager) NotifManager.onProductsUpdated(newData, 'RT'); }catch(e){}
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


function genBarcode(){
  const prefix="880";
  let base=prefix+Array.from({length:9},()=>Math.floor(Math.random()*10)).join("");
  base=base.slice(0,12);
  let sum=0; for(let i=0;i<12;i++) sum+= parseInt(base[i])*(i%2?3:1);
  const check=(10-(sum%10))%10;
  document.getElementById('pBarcode').value=base+check;
  document.getElementById('barcodePreview').textContent="معاينة: "+(document.getElementById('pBarcode').value);
}
function clearForm(){
  pName.value=""; pPrice.value=""; pStock.value=""; pDesc.value=""; genBarcode();
}
async function saveProduct(){
  const name=pName.value.trim(), barcode=pBarcode.value.trim(), cat=pCat.value, price=parseFloat(pPrice.value||0), stock=parseInt(pStock.value||0), desc=pDesc.value.trim();
  if(!name) return showToast("ادخل اسم المنتج",'warning');
  // علّم أنك أنت اللي أضفت — عشان ما يجيلك إشعار لنفسك
  try{ if(window.NotifManager) NotifManager.markSelfAdd(barcode); }catch(e){}
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
      <span class="w-num">${p.stock}</span>
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
function editProd(id){ const p=products.find(x=>x.id===id); if(!p) return; pName.value=p.name; pBarcode.value=p.barcode; pCat.value=p.category; pPrice.value=p.price; pStock.value=p.stock; pDesc.value=p.description||p.desc||""; window.scrollTo(0,0); }
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
  products=products.filter(p=>p.id!==id); _syncWindowProducts(); _saveLocal(); renderUserTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); renderPricingTable(); try{ _updateSWBgState(); }catch(e){}
}

function switchRole(r){
  const map={admin:'viewAdmin', employee:'viewUser', pricing:'viewPricing'};
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
  const ul=document.getElementById('userLabel');
  if(ul) ul.textContent='المستخدم: '+(r==='admin'?'admin':'user');
  const tabAdmin=document.getElementById('tabAdmin');
  const tabUser=document.getElementById('tabUser');
  if(tabAdmin) tabAdmin.textContent='اضافة منتج';
  if(tabUser) tabUser.textContent='المنتجات ';
  if(tabPricing) tabPricing.textContent='تسعير منتج';
  if(r==='employee') {
    renderUserTable();
  }
  if(r==='pricing') {
    syncPricing();
    renderPricingTable();
  }
}
function renderUserTable(){
  const q=(document.getElementById('searchUser').value||"").trim().toLowerCase();
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
      <span class="w-num">${p.stock}</span>
      <span class="price">${parseFloat(p.price).toFixed(2)}</span>
      <span>${p.category}</span>
      <span style="font-size:11px">${p.barcode}</span>
      <span>${p.name}</span>`;
    body.appendChild(row);
  });
  if(filtered.length===0) body.innerHTML=`<div style="text-align:center;color:#9e9e9e;padding:20px">لا توجد منتجات</div>`;
}
function syncPricing(){
  const badge=document.getElementById('pricingCount');
  const count=products.filter(p=>!p.price || parseFloat(p.price)===0).length;
  if(badge) badge.textContent=count+" جاهز";
}
let _expandedPricingId = null;
function renderPricingTable(){
  const q=(document.getElementById('searchPricing').value||"").trim().toLowerCase();
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
      _lastPricingHash="";
      renderPricingTable();
    }, 280);
  } else {
    _expandedPricingId=null;
    _lastPricingHash="";
    renderPricingTable();
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
        _lastPricingHash="";
        renderPricingTable();
        renderUserTable();
        const tb=document.getElementById('tableBody'); if(tb) renderTable();
      }, 300);
    } else {
      _expandedPricingId=null;
      _lastPricingHash="";
      renderPricingTable();
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
  const hasDetails = typeof dName !== 'undefined' && dName && typeof dBarcode !== 'undefined' && dBarcode;
  if(!hasDetails) { selected=prod; return; }
  if(!prod){ dName.textContent="اختر منتج أو امسح باركود"; dBarcode.textContent="—"; dSerial.textContent="—"; dPrice.textContent="—"; dStock.textContent="المتاح: —"; selected=null; return; }
  selected=prod;
  const seq=products.indexOf(prod)+1;
  dName.textContent=prod.name; dBarcode.textContent="باركود: "+prod.barcode; dSerial.textContent=`#${seq} — ${String(prod.id).padStart(4,'0')}`; dPrice.textContent=parseFloat(prod.price).toFixed(2)+" جنيه"; dStock.textContent=`المتاح: ${prod.stock} قطعة`;
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
  cart=[]; renderCart(); renderDetails(null); renderUserTable();
  const tb=document.getElementById('tableBody'); if(tb) renderTable();
}

setInterval(()=>{ const d=new Date(); const cl=document.getElementById('clock'); const dl=document.getElementById('dateLabel'); if(cl) cl.textContent=d.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', hour12:true}); if(dl) dl.textContent=d.toLocaleDateString('en-GB'); },1000);
const scanEl=document.getElementById('scan');
if(scanEl) scanEl.addEventListener('keydown', e=>{ if(e.key==='Enter') scanEnter(); });
genBarcode(); renderTable(); renderUserTable(); renderPricingTable(); if(typeof renderCart==='function') renderCart();
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
  // تفعيل الإشعارات تلقائياً عند deviceready لو لم تكن مفعلة
  setTimeout(()=>{
    try{
      if(window.NotifManager && !localStorage.getItem('notif_enabled')){
        console.log('[BOOT] محاولة تفعيل إشعارات تلقائية');
        // لا نطلبه فوراً — ننتظر إذن المستخدم عبر زر أو auto في push_notifications.js
      }
      // أرسل حالة الخلفية بعد التأكد من الإشعارات
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
// اختبار إشعار يدوي للتشخيص — window.testNotif() و window.testNotifAdd()
window.debugNotif = function(){
  console.log('[DEBUG] notif_enabled', localStorage.getItem('notif_enabled'));
  console.log('[DEBUG] cordova', !!window.cordova, 'local', !!(window.cordova&&window.cordova.plugins&&window.cordova.plugins.notification));
  console.log('[DEBUG] SW controller', !!(navigator.serviceWorker&&navigator.serviceWorker.controller));
  console.log('[DEBUG] NotifManager', !!window.NotifManager, window.NotifManager?window.NotifManager.isSupported():'?');
  if(window.NotifManager && window.NotifManager.showNotification){
    window.NotifManager.showNotification('اختبار debug ✓','الإشعارات تعمل — debugNotif','debug-'+Date.now());
    return 'تم إرسال اختبار debug';
  }
  return 'NotifManager غير جاهز';
};
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
    if(_bootErrors>=3 && Date.now() - performance.timing.navigationStart < 6000){
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
    const splashStuck = splash && document.body.contains(splash) && splash.style.opacity!=='0' && getComputedStyle(splash).display!=='none';
    const phoneHidden = phone && (phone.offsetHeight<50 || getComputedStyle(phone).display==='none');
    const bodyBlack = document.body && getComputedStyle(document.body).backgroundColor==='rgba(0, 0, 0, 0)';
    if((splashStuck && Date.now()-performance.timing.navigationStart>7000) || phoneHidden){
      console.warn('[AUTO-RECOVER] شاشة سودة مكتشفة', {splashStuck, phoneHidden});
      autoRecoverBlackScreen('black_screen');
    }
  }catch(e){}
}, 7500);
// === سحابة فقط — تنظيف خلفي مبسط (لا يلمس localStorage للمنتجات) ===
let _lastBgClean = 0;
async function backgroundAutoClean(){
  try{
    if(!window.SupabaseSync || !SupabaseSync.isConfigured()) return;
    const now = Date.now();
    if(now - _lastBgClean < 30000) return;
    if(now - _lastSyncTime < 5000) return;
    _lastBgClean = now;
    const d = await SupabaseSync.getProducts();
    if(!Array.isArray(d)) return;
    if(d.length===0){
      _consecutiveEmptyCount = (_consecutiveEmptyCount||0)+1;
      if(_consecutiveEmptyCount < 2){
        console.log('[BG-clean] سحابة فارغة أول مرة — تأجيل');
        return;
      }
      if(products.length>0){
        console.log('[BG-clean] سحابة فارغة مؤكدة — مسح الذاكرة');
        products = [];
        _syncWindowProducts();
        try{ _updateSWBgState(); }catch(e){}
        _lastTableHash=""; _lastUserHash=""; _lastPricingHash="";
        try{ renderUserTable(); renderPricingTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); }catch(e){}
        _setBadge(0);
      }
    } else {
      _consecutiveEmptyCount = 0;
    }
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
    const CUR="4.5.2";
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
