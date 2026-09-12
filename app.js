// phone app/app.js — مزامنة سحابية فقط عبر Supabase (قراءة/كتابة) — نسخة نظيفة new
// المصدر الوحيد: Supabase → phone و desktop
// LocalStorage فقط كـ cache/offline وليس مصدراً

const sample = [
  {id:17, name:"مفتاح انجليزي 10 بوصة", barcode:"8801000000011", category:"أجهزة", price:0, stock:5},
  {id:16, name:"ثاوزان تنظيف مواسير", barcode:"8808717568194", category:"إكسسوارات", price:10, stock:17},
  {id:15, name:"ترموستات كوري", barcode:"8807523246425", category:"قطع غيار", price:150, stock:10},
  {id:14, name:"شربون صاروخ ماكيتا 9 بوصة", barcode:"8807684468568", category:"قطع غيار", price:50, stock:17},
];
let products=[];
let _cachedProducts=null;
try{
  const ls = localStorage.getItem('prot_products');
  if(ls){
    const parsed = JSON.parse(ls);
    if(Array.isArray(parsed) && parsed.length>0) _cachedProducts = parsed;
  }
}catch(e){}
if(!Array.isArray(products)) products=[];
// --- migration: حذف المنتجات الستة العالقة بسعر 0 (مرة واحدة فقط) ---
(function(){
  try{
    if(localStorage.getItem('migration_6_fixed_v37')) return;
    const bad = ["8803901533378","8809987644250","8803873034354","8809404749629","8802242127031"];
    // نظف localStorage
    try{
      const ls = localStorage.getItem('prot_products');
      if(ls){
        let arr = JSON.parse(ls);
        if(Array.isArray(arr)){
          const filtered = arr.filter(p=> !bad.includes(String(p.barcode||"").trim()));
          if(filtered.length !== arr.length){
            localStorage.setItem('prot_products', JSON.stringify(filtered));
            console.log('[migration] localStorage cleaned', arr.length, '->', filtered.length);
          }
        }
      }
    }catch(e){}
    // نظف products الحالية
    if(Array.isArray(products) && products.length){
      const before = products.length;
      const filtered = products.filter(p=> !bad.includes(String(p.barcode||"").trim()));
      if(filtered.length !== before){
        products = filtered;
        _saveLocal();
        console.log('[migration] products cleaned', before, '->', filtered.length);
      }
    }
    // نظف deleted_barcodes أيضاً إذا كانت تحتوي القديم
    try{
      const dm = JSON.parse(localStorage.getItem('deleted_barcodes')||'{}');
      let ch=false;
      for(const b of bad){ if(dm[b]){ delete dm[b]; ch=true; } }
      if(ch) localStorage.setItem('deleted_barcodes', JSON.stringify(dm));
    }catch(e){}
    try{ localStorage.setItem('migration_6_fixed_v37','1'); }catch(e){}
  }catch(e){}
})();

let cart=[];
let selected=null;
function _saveLocal(){
  try{ localStorage.setItem('prot_products', JSON.stringify(products)); }catch(e){}
}
// منع الوميض
let _lastTableHash="", _lastUserHash="", _lastPricingHash="";
function _hashList(arr){
  try{ return JSON.stringify(arr.map(p=> p.id+":"+p.price+":"+p.stock+":"+p.name).join("|")); }catch(e){ return ""; }
}

// --- Cache helper ---
function _clearCache(){
  try{ localStorage.removeItem('prot_products'); }catch(e){}
}
window.forceCloudSync = async ()=>{
  try{
    if(!window.SupabaseSync || !SupabaseSync.isConfigured()){ alert('Supabase غير مهيأ'); return; }
    const d=await SupabaseSync.getProducts();
    _applyProducts(d,'Supabase');
    _setBadge(products.length);
    alert('✓ تمت المزامنة من السحابة: '+products.length);
  }catch(e){ alert('فشل: '+e.message); }
};
window.clearLocalCache = ()=>{
  if(confirm('مسح الكاش المحلي وإعادة التحميل من السحابة؟')){
    try{
      _clearCache();
      localStorage.removeItem('deleted_barcodes');
      // مسح كل كاش OTA
      for(let i=localStorage.length-1;i>=0;i--){
        const k=localStorage.key(i);
        if(k && k.startsWith('ota_')) localStorage.removeItem(k);
      }
      localStorage.removeItem('ota_version');
    }catch(e){}
    // مسح Cache API (Service Worker)
    if('caches' in window){
      caches.keys().then(keys=> Promise.all(keys.map(k=> caches.delete(k)))).then(()=>{
        location.reload();
      });
      setTimeout(()=> location.reload(), 800);
    } else {
      location.reload();
    }
  }
};
window.clearAllAppMemory = window.clearLocalCache; // alias للطلب "مسح ذاكرة التطبيق"


let _supaRealtimeActive = false;
let _lastBadgeCount = -1;
let _syncFailCount = 0;
function _setBadge(count){
  const badge=document.getElementById('syncStatus');
  if(!badge) return;
  if(_lastBadgeCount === count) return;
  _lastBadgeCount = count;
  badge.textContent=`مزامن ✓ ${count}`;
  badge.style.color='#3a86c8';
  _syncFailCount = 0;
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
  // السحابة هي المصدر الوحيد — استبدال كامل
  const oldHash = _hashList(products);
  const newHash = _hashList(normalized);
  // تحقق سريع
  const same = products.length===normalized.length && products.every(pr=>{
    const np = normalized.find(x=> x.barcode===pr.barcode);
    return np && String(np.price)===String(pr.price) && String(np.stock)===String(pr.stock) && np.name===pr.name;
  });
  if(same && oldHash===newHash) return false;
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
  // السحابة فقط
  if(!window.SupabaseSync || !window.SupabaseSync.isConfigured()){
    const badge=document.getElementById('syncStatus');
    if(badge){ badge.textContent='غير مهيأ - Supabase'; badge.style.color='#c8943a'; }
    // حاول عرض الكاش فقط
    if(products.length===0){
      try{
        const ls = localStorage.getItem('prot_products');
        if(ls){
          const cached = JSON.parse(ls);
          if(Array.isArray(cached) && cached.length>0){
            console.log('[sync] عرض الكاش المحلي (offline)');
            // لا نستدعي _applyProducts حتى لا نعتبر الكاش مصدراً
          }
        }
      }catch(e){}
    }
    return;
  }
  try{
    const data = await SupabaseSync.getProducts();
    if(Array.isArray(data)){
      _applyProducts(data, 'Supabase');
      _setBadge(products.length);
      console.log(`✓ Supabase: ${data.length} منتج`);
      return;
    }
  }catch(e){
    console.log('Supabase fail', e.message);
    // offline: اعرض الكاش فقط إذا فشلت السحابة
    if(_cachedProducts && Array.isArray(_cachedProducts) && _cachedProducts.length>0 && products.length===0){
      console.log('[sync] عرض الكاش المحلي (offline) مؤقتاً');
      products = _cachedProducts.slice();
      _saveLocal();
      renderUserTable(); renderPricingTable();
      const tb=document.getElementById('tableBody'); if(tb) renderTable();
      _setBadge(products.length);
    }
    _syncFailCount++;
    if(_syncFailCount >= 2){
      const badge=document.getElementById('syncStatus');
      if(badge){ badge.textContent='غير متصل - السحابة'; badge.style.color='#c8943a'; }
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
  if(!name) return alert("ادخل اسم المنتج");
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
      alert(`تم الحفظ ومزامنته لحظياً ✓\n${saved.name} - ${saved.price} جنيه`);
      return;
    }
  }catch(e){
    alert('فشل الحفظ: '+e.message);
    return;
  }
  alert('فشل الحفظ - تأكد من الاتصال بالسحابة');
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
        <button class="print" onclick="alert('طباعة ${p.name}')">🖨</button>
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
    }).catch(e=>{ alert('فشل الحذف: '+e.message); });
  } else {
    alert('Supabase غير مهيأ');
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
function renderPricingTable(){
  const q=(document.getElementById('searchPricing').value||"").trim().toLowerCase();
  const body=document.getElementById('pricingTableBody');
  if(!body) return;
  try{
    const curHash = _hashList(products.filter(p=>!p.price || parseFloat(p.price)===0)) + "|q:" + q;
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
    const row=document.createElement('div'); row.className='row-item';
    row.innerHTML=`
      <span class="w-num">${seq}</span>
      <span>${p.name}</span>
      <span style="font-size:11px">${p.barcode}</span>
      <span style="flex:0 0 90px"><input id="price_${p.id}" type="number" inputmode="decimal" placeholder="0.00" style="width:80px;height:30px;background:#1c2333;border:1px solid #2d3543;border-radius:6px;color:#f5f0e3;text-align:center"/><button onclick="setPrice(${p.id})" style="margin-right:4px;height:30px;padding:0 8px;background:#c8943a;color:#fff;border:none;border-radius:6px">حفظ</button></span>`;
    body.appendChild(row);
  });
  if(filtered.length===0) body.innerHTML=`<div style="text-align:center;color:#9e9e9e;padding:20px">لا يوجد منتجات بسعر 0 - الكل مسعّر</div>`;
}
async function setPrice(id){
  const inp=document.getElementById('price_'+id);
  const v=parseFloat(inp.value);
  if(isNaN(v) || v<0) return alert('ادخل سعر صحيح >= 0');
  try{
    const updated = await apiPatchPrice(id, v);
    if(updated){
      const p=products.find(x=>x.id===id);
      if(p) p.price=updated.price;
      _saveLocal();
      renderPricingTable();
      renderUserTable();
      const tb=document.getElementById('tableBody'); if(tb) renderTable();
      alert(`تم تحديث السعر ومزامنته ✓ ${updated.price} جنيه`);
      return;
    }
  }catch(e){
    alert('فشل تحديث السعر: '+e.message);
    return;
  }
  alert('فشل تحديث السعر');
}
function scanEnter(){
  const el=document.getElementById('searchUser');
  if(el) el.focus();
}
function addToCart(prod){
  const it=cart.find(x=>x.product.id===prod.id);
  if(it){
    if(it.qty+1>prod.stock) return alert('المتاح فقط '+prod.stock);
    it.qty++;
  } else {
    if(prod.stock<1) return alert('نفد المخزون');
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
  if(nq>it.product.stock) return alert('المتاح '+it.product.stock);
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
  if(cart.length===0) return alert('السلة فارغة');
  const total=cart.reduce((s,it)=>s+it.product.price*it.qty,0);
  alert(`تم الدفع ${total.toFixed(2)} جنيه — ${cart.length} منتجات`);
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
  if(w===_lastW && h===_lastH) return;
  _lastW=w; _lastH=h;
  const phone=document.querySelector('.phone');
  if(!phone) return;
  phone.style.width=w+'px';
  phone.style.height=h+'px';
  phone.style.maxWidth='none';
  phone.style.minHeight=h+'px';
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
