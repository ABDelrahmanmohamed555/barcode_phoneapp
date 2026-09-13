// phone app/app.js — مزامنة جديدة فقط عبر Supabase — نسخة 3.3 نظيفة
// السحابة هي المصدر الوحيد — لا منتجات قديمة، لا كاش قديم، لا migration
// تم مسح كل ما يخص المنتجات القديمة والتعارضات

let products=[];
let cart=[];
let selected=null;

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

function _saveLocal(){
  try{ localStorage.setItem('prot_products', JSON.stringify(products)); }catch(e){}
}
let _lastTableHash="", _lastUserHash="", _lastPricingHash="";
function _hashList(arr){
  try{ return JSON.stringify(arr.map(p=> p.id+":"+p.price+":"+p.stock+":"+p.name).join("|")); }catch(e){ return ""; }
}
function _clearCache(){
  try{ localStorage.removeItem('prot_products'); }catch(e){}
}
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
function _updateSyncDot(state){
  const dot=document.getElementById('syncDot');
  if(!dot) return;
  dot.className='sync-dot ' + state;
}
function _setBadge(count){
  const badge=document.getElementById('syncStatus');
  if(!badge) return;
  // حدث العدد حتى لو نفس القيمة؟ نتجاهل فقط لو نفس العدد وحالة ok
  const dot=document.getElementById('syncDot');
  const isOk = dot && dot.classList.contains('ok');
  if(_lastBadgeCount === count && isOk) return;
  _lastBadgeCount = count;
  badge.textContent=`مزامن ✓ ${count}`;
  badge.style.color='#2d8a4e';
  _updateSyncDot('ok');
  _syncFailCount = 0;
}
function _setSyncState(text, color, dotState){
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
    const hadLocal = products.length>0;
    let hadStorage = false;
    try{
      const ls = localStorage.getItem('prot_products');
      if(ls){
        const arr = JSON.parse(ls);
        if(Array.isArray(arr) && arr.length>0) hadStorage = true;
      }
    }catch(e){}
    try{ localStorage.setItem('prot_products', JSON.stringify([])); }catch(e){}
    if(hadLocal || hadStorage){
      console.log(`[APPLY] سحابة فارغة ${source} — مسح كل المحلي`);
      products = [];
      _lastTableHash=""; _lastUserHash=""; _lastPricingHash="";
      _saveLocal();
      try{ renderUserTable(); renderPricingTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); }catch(e){}
      _setBadge(0);
      return true;
    }
    if(products.length===0){
      _lastTableHash=""; _lastUserHash=""; _lastPricingHash="";
      try{ renderUserTable(); renderPricingTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); }catch(e){}
      _setBadge(0);
      return false;
    }
  }
  const oldHash = _hashList(products);
  const newHash = _hashList(normalized);
  const same = products.length===normalized.length && products.every(pr=>{
    const np = normalized.find(x=> x.barcode===pr.barcode);
    return np && String(np.price)===String(pr.price) && String(np.stock)===String(pr.stock) && np.name===pr.name;
  });
  if(same && oldHash===newHash){
    try{
      const ls = localStorage.getItem('prot_products');
      if(ls){
        const parsed = JSON.parse(ls);
        if(Array.isArray(parsed) && parsed.length!==normalized.length){
          localStorage.setItem('prot_products', JSON.stringify(normalized));
        }
      } else {
        localStorage.setItem('prot_products', JSON.stringify(normalized));
      }
    }catch(e){}
    return false;
  }
  const prevCount = products.length;
  products = normalized.slice().sort((a,b)=> (b.id||0)-(a.id||0));
  _lastTableHash=""; _lastUserHash=""; _lastPricingHash="";
  _saveLocal();
  renderUserTable(); renderPricingTable();
  const tb=document.getElementById('tableBody'); if(tb) renderTable();
  console.log(`✓ سحابة ${source}: ${prevCount} -> ${products.length}`);
  return true;
}

async function syncFromApi(){
  if(!window.SupabaseSync || !window.SupabaseSync.isConfigured()){
    _setSyncState('غير مهيأ - Supabase','#c8943a','idle');
    return;
  }
  // حالة جاري المزامنة فقط أول مرة أو عند الفشل السابق
  if(_syncFailCount>0 || _lastBadgeCount===-1){
    _setSyncState('جاري المزامنة...','#c8943a','syncing');
  }
  try{
    const data = await SupabaseSync.getProducts();
    if(Array.isArray(data)){
      _applyProducts(data, 'Supabase');
      _setBadge(products.length);
      _syncFailCount = 0;
      return;
    }
  }catch(e){
    console.log('Supabase fail', e.message);
    _syncFailCount++;
    if(_syncFailCount >= 2){
      _setSyncState('غير متصل - السحابة','#c73e3e','error');
    } else {
      _setSyncState('جاري إعادة المحاولة...','#c8943a','syncing');
    }
  }
}

async function apiPostProduct(prod){
  if(!prod.created_at) prod.created_at = new Date().toISOString().slice(0,19).replace('T',' ');
  if(!prod.updated_at) prod.updated_at = prod.created_at;
  if(window.SupabaseSync && window.SupabaseSync.isConfigured()){
    try{
      const saved = await SupabaseSync.addProduct(prod);
      if(saved) return saved;
    }catch(e){ console.log('Supabase POST fail', e.message); throw e; }
  }
  throw new Error('Supabase غير متاح - لا يمكن الحفظ');
}

async function apiPatchPrice(id, price){
  const now = new Date().toISOString().slice(0,19).replace('T',' ');
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
  if(_supaRealtimeActive) return;
  try{
    const ok = SupabaseSync.subscribeRealtime((newData)=>{
      console.log('[Supabase RT] onChange', newData.length);
      _applyProducts(newData, 'Supabase RT');
      _setBadge(products.length);
    });
    if(ok){
      _supaRealtimeActive = true;
      console.log('✓ Supabase Realtime مفعل');
    }
  }catch(e){ console.log('RT init fail', e.message); }
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
  try{
    const saved = await apiPostProduct({name, barcode, category:cat, price, stock, description:desc});
    if(saved && saved.id){
      const exists = products.find(p=> p.id===saved.id || p.barcode===saved.barcode);
      if(!exists) products.unshift(saved);
      else Object.assign(exists, saved);
      _saveLocal();
      renderUserTable();
      if(document.getElementById('tableBody')) renderTable();
      renderPricingTable();
      clearForm();
      showToast(`تم الحفظ ومزامنته لحظياً ✓ ${saved.name} - ${saved.price} جنيه`,'success',3500);
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
  products=products.filter(p=>p.id!==id); _saveLocal(); renderUserTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); renderPricingTable();
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
  const patch={price:vPrice, stock:vStock, name:vName, barcode: orig?orig.barcode:undefined, updated_at:new Date().toISOString().slice(0,19).replace('T',' ')};
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
    _saveLocal();
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
  _saveLocal();
  cart=[]; renderCart(); renderDetails(null); renderUserTable();
  const tb=document.getElementById('tableBody'); if(tb) renderTable();
}

setInterval(()=>{ const d=new Date(); const cl=document.getElementById('clock'); const dl=document.getElementById('dateLabel'); if(cl) cl.textContent=d.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', hour12:true}); if(dl) dl.textContent=d.toLocaleDateString('en-GB'); },1000);
const scanEl=document.getElementById('scan');
if(scanEl) scanEl.addEventListener('keydown', e=>{ if(e.key==='Enter') scanEnter(); });
genBarcode(); renderTable(); renderUserTable(); renderPricingTable(); if(typeof renderCart==='function') renderCart();
syncFromApi();
initSupabaseRealtime();
setInterval(()=>{ syncFromApi(); }, 8000);
setInterval(()=>{ if(window.SupabaseSync && window.SupabaseSync.isConfigured() && !_supaRealtimeActive) initSupabaseRealtime(); }, 8000);

// يتعرف على ريزولوشن الشاشة
let _lastW=0,_lastH=0,_screenTimer=null;
function applyScreenSize(){
  const w=window.innerWidth, h=window.innerHeight;
  // حماية من قيم صفرية تسبب شاشة سودة
  if(!w || !h || w<100 || h<100) return;
  if(w===_lastW && h===_lastH) return;
  _lastW=w; _lastH=h;
  const phone=document.querySelector('.phone');
  if(!phone) return;
  // لا تفرض عرض ثابت على الديسكتوب — فقط على الموبايل الصغير
  if(w<=500){
    phone.style.width=w+'px';
    phone.style.height=h+'px';
    phone.style.maxWidth='none';
    phone.style.minHeight=h+'px';
  } else {
    phone.style.width='';
    phone.style.height='';
    phone.style.maxWidth='420px';
    phone.style.minHeight='';
  }
  document.documentElement.style.setProperty('--screen-w', w+'px');
  document.documentElement.style.setProperty('--screen-h', h+'px');
}
function _debouncedApply(){
  if(_screenTimer) clearTimeout(_screenTimer);
  _screenTimer=setTimeout(applyScreenSize, 120);
}
window.addEventListener('load', applyScreenSize);
window.addEventListener('resize', _debouncedApply);
window.addEventListener('orientationchange', ()=> setTimeout(applyScreenSize, 250));
if(window.visualViewport) window.visualViewport.addEventListener('resize', _debouncedApply);
applyScreenSize();

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
// === تنظيف خلفي تلقائي مع كل فتحة — يعمل بدون فتح clear_cache.html ===
async function backgroundAutoClean(){
  try{
    if(!window.SupabaseSync || !SupabaseSync.isConfigured()) return;
    const d = await SupabaseSync.getProducts();
    if(!Array.isArray(d)) return;
    if(d.length===0){
      let needWipe=false;
      try{
        const ls = localStorage.getItem('prot_products');
        if(ls){
          const arr=JSON.parse(ls);
          if(Array.isArray(arr) && arr.length>0) needWipe=true;
        }
      }catch(e){}
      if(products.length>0) needWipe=true;
      try{
        const ver=localStorage.getItem('ota_version');
        const otaApp=localStorage.getItem('ota_app.js')||'';
        if(ver==='new' && otaApp && !otaApp.includes('migration_v4_done')) needWipe=true;
      }catch(e){}
      if(needWipe){
        console.log('[BG-clean] سحابة فارغة لكن محلي متسخ — مسح خلفي صامت');
        _nukeAllCaches({silent:true});
        _setBadge(0);
        try{ renderUserTable(); renderPricingTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); }catch(e){}
        if('caches' in window){
          caches.keys().then(keys=> Promise.all(keys.filter(k=> k.includes('nahal-ota')).map(k=> caches.delete(k)))).catch(()=>{});
        }
      }
    }
  }catch(e){}
}
setTimeout(backgroundAutoClean, 2500);
document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible') setTimeout(backgroundAutoClean, 800); });
window.addEventListener('focus', ()=> setTimeout(backgroundAutoClean, 800));
setInterval(backgroundAutoClean, 30000);
// مسح تلقائي ذكي مع كل فتحة — يمنع تعارض النسخ
(function autoCleanOnBoot(){
  try{
    function cmp(a,b){ const pa=String(a).split('.').map(x=>parseInt(x,10)||0); const pb=String(b).split('.').map(x=>parseInt(x,10)||0); const l=Math.max(pa.length,pb.length); for(let i=0;i<l;i++){ const av=pa[i]||0,bv=pb[i]||0; if(av>bv) return 1; if(av<bv) return -1; } return 0; }
    const CUR="3.9";
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
  }catch(e){ console.warn('[BOOT-CLEAN] fail',e); }
})();
