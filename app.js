// phone app/app.js — منطق تجريبي مطابق لـ prot/main.py + مزامنة لحظية حقيقية عبر Supabase/GitHub/Local
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

// --- مزامنة لحظية جذرية: Supabase Realtime + GitHub + Local API ---
const GITHUB_REPO = 'ABDelrahmanmohamed555/barcode_phoneapp';
const GITHUB_PRODUCTS_RAW = `https://raw.githubusercontent.com/${GITHUB_REPO}/main/products.json`;
const GITHUB_PRODUCTS_API = `https://api.github.com/repos/${GITHUB_REPO}/contents/products.json`;
const GITHUB_TOKEN_KEY = 'github_token';
function getGitHubToken(){ try{ return localStorage.getItem(GITHUB_TOKEN_KEY) || null; }catch(e){ return null; } }
function setGitHubToken(t){ try{ if(t) localStorage.setItem(GITHUB_TOKEN_KEY, t); else localStorage.removeItem(GITHUB_TOKEN_KEY); }catch(e){} }
function b64EncodeUtf8(str){ return btoa(unescape(encodeURIComponent(str))); }
function b64DecodeUtf8(b64){ return decodeURIComponent(escape(atob(b64))); }
let _githubSha = null;
let _lastSyncTime = 0;
let _supaRealtimeActive = false;

function _applyProducts(newData, source){
  if(!Array.isArray(newData)) return false;
  // تطبيع
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
  }));
  // دمج ذكي بدل استبدال كامل — يحل مشكلة الرجوع
  // 1) ابنِ خريطة المحلي بالباركود
  const byBarcode = {};
  const byId = {};
  products.forEach(p=>{ if(p.barcode) byBarcode[p.barcode]=p; byId[p.id]=p; });
  let changed = false;
  let added = 0, updated = 0;
  for(const rp of normalized){
    if(!rp.barcode) continue;
    const local = byBarcode[rp.barcode] || byId[rp.id];
    if(!local){
      // منتج جديد من السحابة
      products.push(rp);
      changed = true; added++;
    } else {
      // قارن updated_at — احتفظ بالأحدث
      const rTime = rp.updated_at || rp.created_at || "";
      const lTime = local.updated_at || local.created_at || "";
      // لو السحابي أحدث أو نفس الوقت لكن القيم مختلفة، حدث
      const needUpdate = (rTime > lTime) || (rTime===lTime && (parseFloat(rp.price)!==parseFloat(local.price) || parseInt(rp.stock)!==parseInt(local.stock) || rp.name!==local.name));
      // لو المحلي أحدث، لا ترجع لقديم
      const localNewer = lTime > rTime;
      if(localNewer){
        // تجاهل السحابي القديم — حافظ على المحلي
        continue;
      }
      if(needUpdate){
        // حدث الحقول
        let diff = false;
        for(const k of ['name','barcode','category','price','stock','description','image_path','barcode_path','updated_at','created_at']){
          if(String(rp[k]||'') !== String(local[k]||'')){
            local[k]=rp[k];
            diff=true;
          }
        }
        if(diff){ changed=true; updated++; }
      }
    }
  }
  // لا نحذف منتجات محلية غير موجودة في السحابة (لمنع ضياع بيانات لم تُرفع بعد)
  if(changed){
    // ترتيب حسب id desc مثل السيرفر
    products.sort((a,b)=> (b.id||0)-(a.id||0));
    _saveLocal();
    renderUserTable(); renderPricingTable();
    const tb=document.getElementById('tableBody'); if(tb) renderTable();
    console.log(`✓ دمج ${normalized.length} من ${source} (+${added} جديد، ~${updated} تحديث)`);
    return true;
  }
  // لو لا تغيير بالدمج، تحقق لو العدد أو الترتيب اختلف فقط
  if(JSON.stringify(normalized)!==JSON.stringify(products)){
    // لا نستبدل كاملاً إذا الدمج لم يغير — نحافظ على المحلي
    console.log(`[sync] تجاهل استبدال كامل من ${source} — المحلي أحدث`);
    return false;
  }
  return false;
}

async function syncFromGitHub(){
  const token = getGitHubToken();
  // 1) Contents API (أحدث، بدون كاش)
  try{
    const ctrl = new AbortController(); const t=setTimeout(()=>ctrl.abort(), 7000);
    const headers = {'Accept':'application/vnd.github.v3+json'};
    if(token) headers['Authorization'] = `token ${token}`;
    const r = await fetch(GITHUB_PRODUCTS_API + '?_t=' + Date.now(), {cache:'no-store', signal: ctrl.signal, headers});
    clearTimeout(t);
    if(r.ok){
      const j = await r.json();
      _githubSha = j.sha;
      const content = b64DecodeUtf8(j.content.replace(/\n/g,''));
      const data = JSON.parse(content);
      if(Array.isArray(data)){
        const changed = _applyProducts(data, `GitHub API ${token?'✓':'anon'} sha:${_githubSha?.slice(0,7)}`);
        const badge=document.getElementById('syncStatus');
        if(badge){ badge.textContent=`سحابي GitHub ✓ ${data.length}`; badge.style.color='#2d8a4e'; }
        return true;
      }
    } else if(r.status===404){
      console.log('GitHub products.json غير موجود - سيُنشأ عند أول دفع');
    }
  }catch(e){ console.log('GitHub API fail', e.message); }
  // 2) fallback Raw (مع cache-bust)
  for(const rawUrl of [GITHUB_PRODUCTS_RAW]){
    try{
      const ctrl = new AbortController(); const t=setTimeout(()=>ctrl.abort(), 7000);
      const r = await fetch(rawUrl + '?_t=' + Date.now(), {cache:'no-store', signal: ctrl.signal, mode:'cors', credentials:'omit'});
      clearTimeout(t);
      if(!r.ok) throw new Error(r.status);
      const data = await r.json();
      if(Array.isArray(data)){
        _applyProducts(data, `GitHub Raw`);
        const badge=document.getElementById('syncStatus');
        if(badge){ badge.textContent=`سحابي GitHub Raw ✓ ${data.length}`; badge.style.color='#2d8a4e'; }
        return true;
      }
    }catch(e){ console.log('GitHub Raw fail', e.message); }
  }
  return false;
}
async function githubPushProducts(newProducts, message){
  const token = getGitHubToken();
  if(!token){
    console.log('GitHub push skip: no token - استخدم Supabase أو API المحلي');
    return false;
  }
  try{
    let sha = _githubSha;
    if(!sha){
      const r = await fetch(GITHUB_PRODUCTS_API, {headers:{'Accept':'application/vnd.github.v3+json','Authorization':`token ${token}`}});
      if(r.ok){ const j=await r.json(); sha=j.sha; _githubSha=sha; }
    }
    const content = b64EncodeUtf8(JSON.stringify(newProducts, null, 2));
    const body = {message: message || `auto sync products ${new Date().toISOString()}`, content, sha};
    if(!sha) delete body.sha;
    const r = await fetch(GITHUB_PRODUCTS_API, {method:'PUT', headers:{'Content-Type':'application/json','Accept':'application/vnd.github.v3+json','Authorization':`token ${token}`}, body: JSON.stringify(body)});
    if(!r.ok) throw new Error(await r.text());
    const j = await r.json();
    _githubSha = j.content.sha;
    console.log('✓ GitHub push products', _githubSha.slice(0,7));
    return true;
  }catch(e){ console.log('GitHub push fail', e.message); return false; }
}
async function syncFromLocalFile(){
  try{
    const r = await fetch('products.json?_t='+Date.now(), {cache:'no-store'});
    if(!r.ok) throw new Error(r.status);
    const data = await r.json();
    if(Array.isArray(data)){
      const changed = _applyProducts(data, 'محلي');
      const badge=document.getElementById('syncStatus');
      if(badge){ badge.textContent=`محلي ✓ ${data.length}`; badge.style.color='#3a86c8'; }
      return true;
    }
  }catch(e){}
  return false;
}
async function syncFromApi(){
  if(!useApi){
    await syncFromLocalFile();
    return;
  }
  // 0) Supabase أولاً (لحظي)
  if(window.SupabaseSync && SupabaseSync.isConfigured()){
    try{
      const data = await SupabaseSync.getProducts();
      if(Array.isArray(data)){
        if(data.length>0) _applyProducts(data, 'Supabase');
        const badge=document.getElementById('syncStatus');
        if(badge){ badge.textContent=`سحابي Supabase ✓ ${data.length}`; badge.style.color='#2d8a4e'; }
        if(_supaRealtimeActive) return; // لو Realtime شغال لا حاجة لمحاولة الباقي
      }
    }catch(e){ console.log('Supabase fail', e.message); }
  }
  // لو Supabase غير مهيأ، جرب Local API أولاً (أسرع على نفس الشبكة)
  const bases = [];
  const localBase = getApiBase();
  if(localBase) bases.push(localBase);
  // رابط Cloudflare اختياري من الإعدادات (لا تستخدم الرابط المنتهي افتراضياً)
  const cfFromStorage = (()=>{ try{ return localStorage.getItem('public_cf_url')||''; }catch(e){return '';} })();
  if(cfFromStorage && !bases.includes(cfFromStorage)) bases.push(cfFromStorage);
  // جرب Local API
  for(const base of bases){
    try{
      const ctrl = new AbortController(); const t=setTimeout(()=>ctrl.abort(), 2500);
      const r = await fetch(`${base}/api/products?_t=`+Date.now(), {cache:'no-store', signal: ctrl.signal, mode:'cors', credentials:'omit'});
      clearTimeout(t);
      if(!r.ok) throw new Error(r.status);
      const data = await r.json();
      if(Array.isArray(data) && data.length>=0){
        if(data.length>0) _applyProducts(data, base);
        console.log(`✓ تمت المزامنة: ${data.length} منتج من ${base}`);
        const badge=document.getElementById('syncStatus');
        if(badge){ badge.textContent=`مزامن ✓ ${data.length}`; badge.style.color='#2d8a4e'; }
        return;
      }
    }catch(e){ console.log('API', base, 'غير متاح', e.message); }
  }
  // 2) GitHub (يعمل عبر الإنترنت حتى لو اللابتوب مطفي)
  if(await syncFromGitHub()) return;
  // 3) fallback محلي
  if(await syncFromLocalFile()) return;
  const badge=document.getElementById('syncStatus');
  if(badge){
    if(window.SupabaseSync && !SupabaseSync.isConfigured()){
      badge.textContent='غير متصل - اضغط ⚙ Supabase أو ⚙ GitHub';
    } else {
      badge.textContent='غير متصل - محلي';
    }
    badge.style.color='#c8943a';
  }
}
async function apiPostProduct(prod){
  // أضف طوابع زمنية لمنع الرجوع
  if(!prod.created_at) prod.created_at = new Date().toISOString().slice(0,19).replace('T',' ');
  if(!prod.updated_at) prod.updated_at = prod.created_at;
  // جرب Supabase أولاً
  if(window.SupabaseSync && SupabaseSync.isConfigured()){
    try{
      const saved = await SupabaseSync.addProduct(prod);
      if(saved) return saved;
    }catch(e){ console.log('Supabase POST fail', e.message); }
  }
  // جرب Local API
  const bases = [getApiBase()];
  const cf = (()=>{ try{ return localStorage.getItem('public_cf_url'); }catch(e){return null;} })();
  if(cf) bases.push(cf);
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
  const now = new Date().toISOString().slice(0,19).replace('T',' ');
  if(window.SupabaseSync && SupabaseSync.isConfigured()){
    try{
      const saved = await SupabaseSync.updateProduct(id, {price, updated_at: now});
      if(saved) return saved;
    }catch(e){ console.log('Supabase PATCH fail', e.message); }
  }
  const bases = [getApiBase()];
  const cf = (()=>{ try{ return localStorage.getItem('public_cf_url'); }catch(e){return null;} })();
  if(cf) bases.push(cf);
  for(const base of bases){
    try{
      const r=await fetch(`${base}/api/products/${id}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({price})});
      if(!r.ok) throw new Error(await r.text());
      return await r.json();
    }catch(e){ console.log('PATCH fail', base, e.message); }
  }
  return null;
}

// تفعيل Supabase Realtime اللحظي
function initSupabaseRealtime(){
  if(!window.SupabaseSync || !SupabaseSync.isConfigured() || !SupabaseSync.subscribeRealtime) return;
  if(_supaRealtimeActive) return;
  try{
    const ok = SupabaseSync.subscribeRealtime((newData)=>{
      console.log('[Supabase RT] onChange', newData.length);
      _applyProducts(newData, 'Supabase RT');
      const badge=document.getElementById('syncStatus');
      if(badge){ badge.textContent=`سحابي لحظي ✓ ${newData.length}`; badge.style.color='#2d8a4e'; }
    });
    if(ok){
      _supaRealtimeActive = true;
      console.log('✓ Supabase Realtime مفعل - مزامنة لحظية');
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
  // حتى لو price 0 يحفظ تلقائياً (محلي + API + سحابي)
  const saved = await apiPostProduct({name, barcode, category:cat, price, stock, description:desc});
  if(saved && saved.id){
    // تم الحفظ عبر Supabase أو API - حدث المحلي فوراً
    const exists = products.find(p=> p.id===saved.id || p.barcode===saved.barcode);
    if(!exists) products.unshift(saved);
    else Object.assign(exists, saved);
    _saveLocal();
    renderUserTable();
    if(document.getElementById('tableBody')) renderTable();
    renderPricingTable();
    // أيضاً ارفع لـ GitHub كـ نسخة احتياطية
    githubPushProducts(products, `auto sync products add ${name}`).catch(()=>{});
    clearForm();
    alert(`تم الحفظ ومزامنته لحظياً ✓\n${saved.name} - ${saved.price} جنيه`);
    return;
  }
  // fallback محلي + GitHub
  const id=Math.max(0,...products.map(p=>p.id))+1;
  const nowStr = new Date().toISOString().slice(0,19).replace('T',' ');
  const newProd={id,name,barcode:barcode||"880"+Date.now(),category:cat,price,stock,description:desc, created_at: nowStr, updated_at: nowStr};
  products.unshift(newProd);
  _saveLocal();
  renderUserTable();
  if(document.getElementById('tableBody')) renderTable();
  renderPricingTable();
  // حل جذري: ارفع لـ Supabase و GitHub حتى لو API غير متصل
  if(window.SupabaseSync && SupabaseSync.isConfigured()){
    SupabaseSync.addProduct(newProd).then(ok=>{
      if(ok) console.log('✓ Supabase fallback push');
    }).catch(()=>{});
  }
  githubPushProducts(products, `auto sync products add ${name}`).then(ok=>{
    if(ok) console.log('✓ تم رفع المنتج لـ GitHub');
  });
  alert(`تم الحفظ محلياً ✓\n${name} - ${price} جنيه${getGitHubToken()?' (سيرفع لـ GitHub)':''}${window.SupabaseSync && SupabaseSync.isConfigured()?' (سيرفع لـ Supabase)':''}`);
}

function renderTable(){
  const searchEl=document.getElementById('search');
  const body=document.getElementById('tableBody');
  if(!body) return;
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
  // حاول حذف من Supabase أيضاً
  if(window.SupabaseSync && SupabaseSync.isConfigured()){
    SupabaseSync.deleteProduct(id).catch(()=>{});
  }
  products=products.filter(p=>p.id!==id); _saveLocal(); renderUserTable(); const tb=document.getElementById('tableBody'); if(tb) renderTable(); renderPricingTable();
  githubPushProducts(products, `delete product ${id}`).catch(()=>{});
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
  const updated = await apiPatchPrice(id, v);
  if(updated){
    const p=products.find(x=>x.id===id);
    if(p) p.price=updated.price;
    _saveLocal();
    renderPricingTable();
    renderUserTable();
    const tb=document.getElementById('tableBody'); if(tb) renderTable();
    // رفع لـ GitHub كنسخة احتياطية
    githubPushProducts(products, `price ${id}=${v}`).catch(()=>{});
    alert(`تم تحديث السعر ومزامنته ✓ ${updated.price} جنيه`);
    return;
  }
  const p=products.find(x=>x.id===id);
  if(!p) return;
  p.price=v;
  _saveLocal();
  renderPricingTable();
  renderUserTable();
  const tb=document.getElementById('tableBody'); if(tb) renderTable();
  if(window.SupabaseSync && SupabaseSync.isConfigured()){
    SupabaseSync.updateProduct(id, {price: v}).catch(()=>{});
  }
  githubPushProducts(products, `auto sync products price ${id}=${v}`).then(ok=>{
    if(ok) console.log('✓ GitHub price push');
  });
  alert(`تم تحديث السعر محلياً ✓ ${v} جنيه${getGitHubToken()?' (سيرفع لـ GitHub)':''}`);
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
try{ document.getElementById('apiUrl').textContent=getApiBase(); }catch(e){}
syncFromLocalFile().then(()=> syncFromApi());
initSupabaseRealtime();
setTimeout(()=>{ try{ const el=document.getElementById('apiUrl'); if(el) el.textContent=getApiBase(); }catch(e){} }, 3500);
// مزامنة لحظية كل 2.5 ثانية + Supabase Realtime
setInterval(()=>{ syncFromLocalFile(); syncFromApi(); }, 2500);
setInterval(()=>{ if(window.SupabaseSync && SupabaseSync.isConfigured() && !_supaRealtimeActive) initSupabaseRealtime(); }, 8000);

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
