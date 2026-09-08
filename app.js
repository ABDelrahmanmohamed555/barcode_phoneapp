// phone app/app.js — منطق تجريبي مطابق لـ prot/main.py + مزامنة حقيقية مع prot/db/products.db
function getApiBase(){
  try{
    const saved = localStorage.getItem('prot_api_base');
    if(saved) return saved.replace(/\/+$/,'');
    const host = location.hostname;
    if(!host || host==='') return 'http://127.0.0.1:5000';
    return `http://${host}:5000`;
  }catch(e){ return 'http://127.0.0.1:5000'; }
}
const API_BASE = getApiBase();
let useApi = true;
function setApiBase(url){
  localStorage.setItem('prot_api_base', url);
  location.reload();
}
// اكتشاف تلقائي للسيرفر لو file:// وبدون إعداد سابق (يستخدم نفس منطق updater.js)
async function autoDiscoverApiBase(){
  try{
    if(localStorage.getItem('prot_api_base')) return localStorage.getItem('prot_api_base');
    if(location.hostname && location.hostname!=='') return null;
    // حاول WebRTC لاستنتاج الشبكة
    let subnet = null;
    try{
      subnet = await new Promise(res=>{
        try{
          const pc=new RTCPeerConnection({iceServers:[]});
          pc.createDataChannel('');
          pc.createOffer().then(o=> pc.setLocalDescription(o)).catch(()=> res(null));
          let done=false;
          pc.onicecandidate=e=>{
            if(done||!e||!e.candidate||!e.candidate.candidate) return;
            const m=e.candidate.candidate.match(/(\d+\.\d+\.\d+)\.\d+/);
            if(m){ done=true; try{pc.close();}catch(_){} res(m[1]+'.'); }
          };
          setTimeout(()=> res(null), 1200);
        }catch(_){ res(null); }
      });
    }catch(_){}
    const prefixes = subnet ? [subnet] : [];
    for(const c of ['192.168.1.','192.168.0.','192.168.43.','192.168.137.','10.0.2.','10.42.0.']) if(!prefixes.includes(c)) prefixes.push(c);
    const tryBase = async (base)=>{
      const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),700);
      try{ const r=await fetch(base+'/api/app_version?_t='+Date.now(),{cache:'no-store',signal:ctrl.signal}); clearTimeout(t); return r.ok; }catch(_){ clearTimeout(t); return false; }
    };
    for(const pref of prefixes){
      const order=[1,15,100,42,101,2,10,20];
      const rest=[]; for(let i=1;i<=50;i++) if(!order.includes(i)) rest.push(i);
      const all=[...order, ...rest];
      for(let s=0;s<all.length;s+=15){
        const batch=all.slice(s,s+15);
        const res=await Promise.all(batch.map(async ip=> (await tryBase(`http://${pref}${ip}:5000`)) ? `http://${pref}${ip}:5000` : null));
        const found=res.find(x=>x);
        if(found){ try{ localStorage.setItem('prot_api_base', found); }catch(_){} console.log('[API] اكتشاف تلقائي',found); return found; }
      }
    }
  }catch(_){}
  return null;
}
// شغل الاكتشاف في الخلفية لو file://
if(!location.hostname || location.hostname===''){
  setTimeout(()=>{ autoDiscoverApiBase().then(found=>{ if(found && found!==API_BASE) location.reload(); }); }, 2000);
}
const sample = [
  {id:17, name:"مفتاح انجليزي 10 بوصة", barcode:"8801000000011", category:"أجهزة", price:0, stock:5},
  {id:16, name:"ثاوزان تنظيف مواسير", barcode:"8808717568194", category:"إكسسوارات", price:10, stock:17},
  {id:15, name:"ترموستات كوري", barcode:"8807523246425", category:"قطع غيار", price:150, stock:10},
  {id:14, name:"شربون صاروخ ماكيتا 9 بوصة", barcode:"8807684468568", category:"قطع غيار", price:50, stock:17},
];
let products=[...sample];
try{
  const ls = localStorage.getItem('prot_products');
  if(ls){
    const parsed = JSON.parse(ls);
    if(Array.isArray(parsed) && parsed.length>0) products = parsed;
  }
}catch(e){}
let cart=[];
let selected=null;
function _saveLocal(){
  try{ localStorage.setItem('prot_products', JSON.stringify(products)); }catch(e){}
}

// --- مزامنة حقيقية + محلية + عبر الإنترنت GitHub ---
const GITHUB_PRODUCTS_RAW = 'https://raw.githubusercontent.com/ABDelrahmanmohamed555/barcode_phoneapp/main/products.json';
const GITHUB_PRODUCTS_FALLBACK = 'https://files.catbox.moe/87yk0c.json'.replace('87yk0c.json','products.json'); // سيتم رفعه مع version

async function syncFromGitHub(){
  // جلب products.json من GitHub Raw (يعمل عبر الإنترنت حتى لو اللابتوب مطفي بعد push)
  try{
    const ctrl = new AbortController(); const t=setTimeout(()=>ctrl.abort(), 7000);
    const r = await fetch(GITHUB_PRODUCTS_RAW + '?_t=' + Date.now(), {cache:'no-store', signal: ctrl.signal});
    clearTimeout(t);
    if(!r.ok) throw new Error(r.status);
    const data = await r.json();
    if(Array.isArray(data) && data.length>0){
      if(JSON.stringify(data) !== JSON.stringify(products)){
        products = data;
        _saveLocal();
        renderUserTable(); renderPricingTable();
        const tb=document.getElementById('tableBody'); if(tb) renderTable();
      }
      const badge=document.getElementById('syncStatus');
      if(badge){ badge.textContent=`سحابي ✓ ${products.length}`; badge.style.color='#2d8a4e'; }
      console.log(`✓ مزامنة GitHub: ${products.length} منتج`);
      return true;
    }
  }catch(e){ console.log('GitHub sync fail', e.message); }
  return false;
}
async function syncFromLocalFile(){
  try{
    const r = await fetch('products.json', {cache:'no-store'});
    if(!r.ok) throw new Error(r.status);
    const data = await r.json();
    if(Array.isArray(data) && data.length>=0){
      // فقط لو البيانات مختلفة لتجنب إعادة الرسم الزائدة
      if(JSON.stringify(data) !== JSON.stringify(products)){
        products = data;
        renderUserTable(); renderPricingTable();
        const tb=document.getElementById('tableBody'); if(tb) renderTable();
      }
      const badge=document.getElementById('syncStatus');
      if(badge){ badge.textContent=`محلي ✓ ${products.length}`; badge.style.color='#3a86c8'; }
      return true;
    }
  }catch(e){
    // ملف محلي غير متاح (يعمل بدون http.server)
  }
  return false;
}
async function syncFromApi(){
  if(!useApi){
    await syncFromLocalFile();
    return;
  }
  const bases = [];
  const localBase = getApiBase();
  if(localBase) bases.push(localBase);
  // عبر الإنترنت Cloudflare (يعمل من 4G)
  const PUBLIC_CF = 'https://mileage-officially-narrow-oldest.trycloudflare.com';
  if(!bases.includes(PUBLIC_CF)) bases.push(PUBLIC_CF);
  // جرب كل bases
  for(const base of bases){
    try{
      const r = await fetch(`${base}/api/products`);
      if(!r.ok) throw new Error(r.status);
      const data = await r.json();
      if(Array.isArray(data) && data.length>0){
        products = data;
        _saveLocal();
        console.log(`✓ تمت المزامنة: ${products.length} منتج من ${base}`);
        renderUserTable(); renderPricingTable();
        const tb=document.getElementById('tableBody'); if(tb) renderTable();
        const badge=document.getElementById('syncStatus');
        if(badge){ badge.textContent=`مزامن ✓ ${products.length}`; badge.style.color='#2d8a4e'; }
        return;
      }
    }catch(e){ console.log('API', base, 'غير متاح', e.message); }
  }
  // 2) حاول GitHub عبر الإنترنت (يعمل حتى لو اللابتوب مطفي بعد push)
  if(await syncFromGitHub()) return;
  // 3) fallback محلي
  if(await syncFromLocalFile()) return;
  const badge=document.getElementById('syncStatus');
  if(badge){ badge.textContent='غير متصل - محلي'; badge.style.color='#c8943a'; }
}
async function apiPostProduct(prod){
  if(!useApi) return null;
  const bases = [getApiBase(), 'https://mileage-officially-narrow-oldest.trycloudflare.com'];
  for(const base of bases){
    try{
      const r=await fetch(`${base}/api/products`, {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(prod)});
      if(!r.ok) throw new Error(await r.text());
      return await r.json();
    }catch(e){ console.log('POST fail', base, e.message); }
  }
  return null;
}
async function apiPatchPrice(id, price){
  if(!useApi) return null;
  const bases = [getApiBase(), 'https://mileage-officially-narrow-oldest.trycloudflare.com'];
  for(const base of bases){
    try{
      const r=await fetch(`${base}/api/products/${id}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({price})});
      if(!r.ok) throw new Error(await r.text());
      return await r.json();
    }catch(e){ console.log('PATCH fail', base, e.message); }
  }
  return null;
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
  // حتى لو price 0 يحفظ تلقائياً (محلي + API)
  if(useApi){
    const saved = await apiPostProduct({name, barcode, category:cat, price, stock, description:desc});
    if(saved && saved.id){
      products.unshift(saved);
      _saveLocal();
      renderUserTable();
      if(document.getElementById('tableBody')) renderTable();
      renderPricingTable();
      clearForm();
      alert(`تم الحفظ في قاعدة البيانات ✓\n${saved.name} - ${saved.price} جنيه`);
      return;
    }
  }
  const id=Math.max(0,...products.map(p=>p.id))+1;
  products.unshift({id,name,barcode:barcode||"880"+Date.now(),category:cat,price,stock,desc});
  _saveLocal();
  renderUserTable();
  if(document.getElementById('tableBody')) renderTable();
}

function renderTable(){
  const searchEl=document.getElementById('search');
  const body=document.getElementById('tableBody');
  if(!body) return; // لم تعد موجودة في وضع اضافة منتج فقط
  const q=(searchEl ? searchEl.value : "").trim().toLowerCase();
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
      <span class="price">${p.price.toFixed(2)}</span>
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
function editProd(id){ const p=products.find(x=>x.id===id); if(!p) return; pName.value=p.name; pBarcode.value=p.barcode; pCat.value=p.category; pPrice.value=p.price; pStock.value=p.stock; pDesc.value=p.desc||""; window.scrollTo(0,0); }
function delProd(id){ products=products.filter(p=>p.id!==id); _saveLocal(); renderUserTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); renderPricingTable(); }

// تبويب: اضافة منتج / المنتجات (متسعرة) / تسعير منتج (سعر 0) + انيميشن
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
    // force reflow لضمان تشغيل الانيميشن
    void target.offsetWidth;
    target.classList.add('active');
  }
  document.getElementById('tabAdmin').classList.toggle('active', r==='admin');
  document.getElementById('tabUser').classList.toggle('active', r==='employee');
  const tabPricing=document.getElementById('tabPricing');
  if(tabPricing) tabPricing.classList.toggle('active', r==='pricing');
  const ul=document.getElementById('userLabel');
  if(ul) ul.textContent='المستخدم: '+(r==='admin'?'admin':'user');
  // الأسماء الجديدة: اضافة منتج / المنتجات / تسعير 
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
  body.innerHTML="";
  // قسم المنتجات يعرض فقط المتسعرة (سعر != 0) حسب الطلب
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
      <span class="price">${p.price.toFixed(2)}</span>
      <span>${p.category}</span>
      <span style="font-size:11px">${p.barcode}</span>
      <span>${p.name}</span>`;
    body.appendChild(row);
  });
  if(filtered.length===0) body.innerHTML=`<div style="text-align:center;color:#9e9e9e;padding:20px">لا توجد منتجات</div>`;
}
function syncPricing(){
  // مزامنة مع قاعدة البيانات: المنتجات التي سعرها 0
  const badge=document.getElementById('pricingCount');
  const count=products.filter(p=>!p.price || p.price===0).length;
  if(badge) badge.textContent=count+" جاهز";
}
function renderPricingTable(){
  const q=(document.getElementById('searchPricing').value||"").trim().toLowerCase();
  const body=document.getElementById('pricingTableBody');
  if(!body) return;
  body.innerHTML="";
  let filtered=products.filter(p=>!p.price || p.price===0);
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
  // مزامنة العدد
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
  if(useApi){
    const updated = await apiPatchPrice(id, v);
    if(updated){
      const p=products.find(x=>x.id===id);
      if(p) p.price=updated.price;
      _saveLocal();
      renderPricingTable();
      renderUserTable();
      const tb=document.getElementById('tableBody'); if(tb) renderTable();
      alert(`تم تحديث السعر ✓ ${updated.price} جنيه`);
      return;
    }
  }
  const p=products.find(x=>x.id===id);
  if(!p) return;
  p.price=v;
  _saveLocal();
  renderPricingTable();
  renderUserTable();
  const tb=document.getElementById('tableBody'); if(tb) renderTable();
}
function scanEnter(){
  // لم تعد السلة موجودة - البحث الآن عبر القائمة
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
  const body=document.getElementById('cartBody'); body.innerHTML='';
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
  // تفاصيل المنتج أزيلت من قسم المنتجات حسب الطلب — نحتفظ بالدالة للتوافق مع السلة
  const hasDetails = typeof dName !== 'undefined' && dName && typeof dBarcode !== 'undefined' && dBarcode;
  if(!hasDetails) { selected=prod; return; }
  if(!prod){ dName.textContent="اختر منتج أو امسح باركود"; dBarcode.textContent="—"; dSerial.textContent="—"; dPrice.textContent="—"; dStock.textContent="المتاح: —"; selected=null; return; }
  selected=prod;
  const seq=products.indexOf(prod)+1;
  dName.textContent=prod.name; dBarcode.textContent="باركود: "+prod.barcode; dSerial.textContent=`#${seq} — ${String(prod.id).padStart(4,'0')}`; dPrice.textContent=prod.price.toFixed(2)+" جنيه"; dStock.textContent=`المتاح: ${prod.stock} قطعة`;
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
  document.getElementById('totalLabel').textContent=`${count} قطعة | الإجمالي: ${total.toFixed(2)} جنيه`;
}
function checkout(){
  if(cart.length===0) return alert('السلة فارغة');
  const total=cart.reduce((s,it)=>s+it.product.price*it.qty,0);
  alert(`تم الدفع ${total.toFixed(2)} جنيه — ${cart.length} منتجات`);
  // خصم مخزون تجريبي
  cart.forEach(it=>{ const p=products.find(x=>x.id===it.product.id); if(p) p.stock=Math.max(0,p.stock-it.qty); });
  _saveLocal();
  cart=[]; renderCart(); renderDetails(null); renderUserTable();
  const tb=document.getElementById('tableBody'); if(tb) renderTable();
}

// clock - أرقام إنجليزية فقط
setInterval(()=>{ const d=new Date(); clock.textContent=d.toLocaleTimeString('en-GB', {hour: '2-digit', minute: '2-digit', hour12:true}); dateLabel.textContent=d.toLocaleDateString('en-GB'); },1000);
const scanEl=document.getElementById('scan');
if(scanEl) scanEl.addEventListener('keydown', e=>{ if(e.key==='Enter') scanEnter(); });
genBarcode(); renderTable(); renderUserTable(); renderPricingTable(); renderCart();
// مزامنة مع قاعدة البيانات الحقيقية + المحلية
try{ document.getElementById('apiUrl').textContent=getApiBase(); }catch(e){}
syncFromLocalFile().then(()=> syncFromApi());
// حدث عنوان الـ API في الواجهة بعد الاكتشاف التلقائي
setTimeout(()=>{ try{ const el=document.getElementById('apiUrl'); if(el) el.textContent=getApiBase(); }catch(e){} }, 3500);
setInterval(()=>{ syncFromLocalFile(); syncFromApi(); }, 5000); // تحديث كل 5 ثواني (محلي + شبكة)

// يتعرف على ريزولوشن الشاشة ويأخذ حجمها فور التشغيل (مع debounce لتجنب التهنيج في VS Code)
let _lastW=0,_lastH=0,_screenTimer=null;
function applyScreenSize(){
  const w=window.innerWidth, h=window.innerHeight;
  if(w===_lastW && h===_lastH) return;
  _lastW=w; _lastH=h;
  const phone=document.querySelector('.phone');
  if(!phone) return;
  const sw=window.screen?window.screen.width:w, sh=window.screen?window.screen.height:h;
  const dpr=window.devicePixelRatio||1;
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
