// push_notifications.js — نظام إشعارات يعمل داخل وخارج التطبيق
// داخل: Toast + SW periodicSync (حتى لو مقفول 15د)
// خارج: ServiceWorker showNotification (يظهر في شريط الإشعارات) + Cordova local إن وجد
(function(){
  const LS_KEY_ENABLED = 'notif_enabled';
  const LS_KEY_LAST_COUNT = 'notif_last_count';
  const LS_KEY_LAST_BARCODES = 'notif_last_barcodes';
  const LS_KEY_LAST_SNAPSHOT = 'notif_last_snapshot';

  function hasCordovaLocal(){
    return !!(window.cordova && window.cordova.plugins && window.cordova.plugins.notification && window.cordova.plugins.notification.local);
  }
  function isSupported(){
    if(hasCordovaLocal()) return true;
    if('serviceWorker' in navigator) return true; // SW يكفي للإشعار خارجي حتى بدون Notification API في WebView
    return 'Notification' in window;
  }
  function isGranted(){
    if(hasCordovaLocal()) return true; // إذن النظام POST_NOTIFICATIONS يكفي
    if('Notification' in window && typeof Notification!=='undefined'){
      return Notification.permission === 'granted';
    }
    // بدون Notification API، نعتمد على تفعيل المستخدم في LS
    return localStorage.getItem(LS_KEY_ENABLED)==='1';
  }
  async function requestPermission(){
    if(hasCordovaLocal()){
      return new Promise((resolve)=>{
        try{
          window.cordova.plugins.notification.local.hasPermission((g)=>{
            if(g){ localStorage.setItem(LS_KEY_ENABLED,'1'); showToast('الإشعارات مفعلة ✓','success'); try{registerPeriodicSync()}catch(e){} showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات حتى لو التطبيق مقفول'); resolve(true); }
            else window.cordova.plugins.notification.local.requestPermission((g2)=>{ if(g2){ localStorage.setItem(LS_KEY_ENABLED,'1'); showToast('الإشعارات مفعلة ✓','success'); resolve(true);} else { showToast('تم رفض الإذن','warning'); resolve(false); }});
          });
        }catch(e){ localStorage.setItem(LS_KEY_ENABLED,'1'); showToast('الإشعارات مفعلة ✓','success'); resolve(true); }
      });
    }
    // Web / SW: حاول Notification API إن وجد
    if('Notification' in window && typeof Notification!=='undefined'){
      if(Notification.permission==='granted'){ localStorage.setItem(LS_KEY_ENABLED,'1'); showToast('الإشعارات مفعلة ✓','success'); try{registerPeriodicSync()}catch(e){} await showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات عند إضافة منتج'); return true; }
      if(Notification.permission==='denied'){ showToast('الإشعارات محجوبة - فعلها من إعدادات المتصفح','error',4000); return false; }
      try{
        const res=await Notification.requestPermission();
        if(res==='granted'){ localStorage.setItem(LS_KEY_ENABLED,'1'); await showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات'); showToast('الإشعارات مفعلة ✓','success'); try{registerPeriodicSync()}catch(e){} return true; }
        else { showToast('تم رفض الإذن','warning'); return false; }
      }catch(e){ /* fallback */ }
    }
    // Fallback لـ WebView بدون Notification API: فعل مباشرة واعتمد على SW
    localStorage.setItem(LS_KEY_ENABLED,'1');
    showToast('الإشعارات مفعلة ✓ (سيظهر الإشعار خارج التطبيق عبر النظام)','success',4000);
    try{ registerPeriodicSync(); }catch(e){}
    try{ registerBgSync(); }catch(e){}
    await showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات عند إضافة منتج حتى لو التطبيق مقفول');
    return true;
  }

  async function showNotification(title, body, tag){
    const enabled = localStorage.getItem(LS_KEY_ENABLED)==='1';
    // 1) Cordova local
    if(hasCordovaLocal()){
      try{
        const id=Date.now()%2147483647;
        window.cordova.plugins.notification.local.schedule({id:id, title:title, text:body, smallIcon:'res://icon', icon:'res://icon', sound:null, vibrate:true, foreground:true, priority:2});
        return true;
      }catch(e){}
    }
    // 2) ServiceWorker (يعمل حتى بدون Notification API، يظهر في شريط النظام)
    try{
      if('serviceWorker' in navigator){
        // حاول عبر controller أولاً
        if(navigator.serviceWorker.controller){
          navigator.serviceWorker.controller.postMessage({type:'SHOW_NOTIFICATION', title:title, body:body, tag:tag||('notif-'+Date.now())});
          // لا نرجع فوراً - نجرب أيضاً registration كـ fallback
        }
        const reg = await navigator.serviceWorker.getRegistration();
        if(reg){
          // registration.showNotification يعمل حتى لو Notification.permission غير موجود في WebView، طالما POST_NOTIFICATIONS ممنوح في AndroidManifest
          await reg.showNotification(title, {body:body, icon:'./icon.png', badge:'./icon.png', tag:tag||'new-product', vibrate:[200,100,200], data:{url:'./index.html'}});
          return true;
        }
        if(navigator.serviceWorker.controller) return true;
      }
    }catch(e){ console.warn('[Notif] SW fail', e.message); }
    // 3) Web Notification
    try{
      if(typeof Notification!=='undefined' && Notification.permission==='granted'){
        new Notification(title, {body:body, icon:'./icon.png'});
        return true;
      }
    }catch(e){}
    // 4) حتى لو فشل كل شيء، اعرض Toast داخل التطبيق كـ fallback
    try{ showToast(title+': '+body,'info',4000); }catch(e){}
    return false;
  }

  async function registerPeriodicSync(){
    try{
      const reg=await navigator.serviceWorker.ready;
      if(reg && 'periodicSync' in reg){
        const st=await navigator.permissions.query({name:'periodic-background-sync'}).catch(()=>({state:'granted'}));
        if(st.state!=='denied'){
          await reg.periodicSync.register('sync-products',{minInterval:15*60*1000});
          console.log('[Notif] periodicSync 15m ✓');
          return true;
        }
      }
    }catch(e){}
    return false;
  }
  async function registerBgSync(){
    try{
      const reg=await navigator.serviceWorker.ready;
      if(reg && 'sync' in reg){ await reg.sync.register('sync-products'); return true; }
    }catch(e){}
    return false;
  }

  let _lastNotifiedCount=-1, _lastBarcodesSet=null, _lastSnapshot=null;
  try{
    const v=localStorage.getItem(LS_KEY_LAST_COUNT);
    if(v!==null) _lastNotifiedCount=parseInt(v,10)||-1;
    const b=localStorage.getItem(LS_KEY_LAST_BARCODES);
    if(b) _lastBarcodesSet=new Set(JSON.parse(b));
    const s=localStorage.getItem(LS_KEY_LAST_SNAPSHOT);
    if(s) _lastSnapshot=JSON.parse(s);
  }catch(e){}
  function _saveState(count, products){
    _lastNotifiedCount=count;
    try{ localStorage.setItem(LS_KEY_LAST_COUNT, String(count)); }catch(e){}
    try{
      const barcodes=products.map(p=>p.barcode).sort();
      localStorage.setItem(LS_KEY_LAST_BARCODES, JSON.stringify(barcodes));
      _lastBarcodesSet=new Set(barcodes);
      const snap={}; products.forEach(p=> snap[p.barcode]={price:String(p.price), name:p.name, stock:String(p.stock)});
      localStorage.setItem(LS_KEY_LAST_SNAPSHOT, JSON.stringify(snap));
      _lastSnapshot=snap;
    }catch(e){}
    try{
      if(navigator.serviceWorker && navigator.serviceWorker.controller){
        const barcodesStr=JSON.stringify(products.map(p=>p.barcode).sort());
        navigator.serviceWorker.controller.postMessage({type:'SET_BG_STATE', count:count, barcodes:barcodesStr});
      }
    }catch(e){}
  }
  function onProductsUpdated(newProducts, source){
    if(!Array.isArray(newProducts)) return;
    if(_lastNotifiedCount===-1 || !_lastBarcodesSet){ _saveState(newProducts.length, newProducts); return; }
    const newBarcodes=new Set(newProducts.map(p=>p.barcode));
    const oldBarcodes=_lastBarcodesSet;
    const oldSnap=_lastSnapshot||{};
    const added=newProducts.filter(p=>!oldBarcodes.has(p.barcode));
    const priceChanged=newProducts.filter(p=>{ const o=oldSnap[p.barcode]; return o && (String(o.price)!==String(p.price) || o.name!==p.name); });
    const selfBarcode=(()=>{ try{ return sessionStorage.getItem('_self_add_barcode'); }catch(e){return null;}})();
    let notified=false;
    if(added.length>0){
      const isSelf=selfBarcode && added.some(p=>p.barcode===selfBarcode);
      if(isSelf){ try{sessionStorage.removeItem('_self_add_barcode');}catch(e){} }
      else {
        const title=added.length===1?'منتج جديد ✓':`${added.length} منتجات جديدة ✓`;
        const body=added.length===1?`${added[0].name} — تمت إضافته`:`${added.slice(0,2).map(p=>p.name).join('، ')}${added.length>2?' ...':''}`;
        const enabled=localStorage.getItem(LS_KEY_ENABLED)==='1';
        // اعرض دائماً كـ Toast داخل التطبيق
        try{ showToast(title+': '+body,'info',3800); }catch(e){}
        // واعرض كـ System notification خارج التطبيق لو مفعل أو حتى لو التطبيق في الخلفية
        if(enabled || document.visibilityState!=='visible'){
          showNotification(title, body, 'new-product-'+Date.now());
        } else {
          // حتى لو في الواجهة، اعرض System أيضاً لو المستخدم يريد خارجي
          showNotification(title, body, 'new-product-'+Date.now());
        }
        notified=true;
      }
    }
    if(!notified && priceChanged.length>0){
      const p=priceChanged[0]; const old=oldSnap[p.barcode];
      const title='تم تحديث سعر ✓'; const body=`${p.name}: ${old.price} → ${p.price} جنيه`;
      try{ showToast(title+': '+body,'info',3500); }catch(e){}
      if(localStorage.getItem(LS_KEY_ENABLED)==='1') showNotification(title, body, 'price-'+p.barcode);
      notified=true;
    }
    _saveState(newProducts.length, newProducts);
    if(selfBarcode && added.length===0 && priceChanged.length===0){ try{sessionStorage.removeItem('_self_add_barcode');}catch(e){} }
  }
  function markSelfAdd(barcode){ try{sessionStorage.setItem('_self_add_barcode', barcode);}catch(e){} try{sessionStorage.setItem('_self_add_time', String(Date.now()));}catch(e){} }

  window.NotifManager={isSupported, isGranted, requestPermission, showNotification, registerPeriodicSync, registerBgSync, onProductsUpdated, markSelfAdd};

  setTimeout(()=>{
    try{
      if(!isSupported()) return;
      // لا نعرض بانر مزعج في WebView بدون Notification - فقط لو SW مدعوم
      if('Notification' in window && Notification.permission==='default' && !localStorage.getItem(LS_KEY_ENABLED)){
        const banner=document.createElement('div');
        banner.id='notifBanner';
        banner.style.cssText='position:fixed;bottom:70px;left:12px;right:12px;z-index:9999;background:#1c2333;border:1px solid #c8943a;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;box-shadow:0 8px 24px rgba(0,0,0,0.4)';
        banner.innerHTML=`<div style="color:#f5f0e3;font-size:13px;font-weight:700">📱 تفعيل الإشعارات؟</div><div style="color:#9e9e9e;font-size:11px">ستصلك إشعارات خارج التطبيق حتى لو مقفول</div><div style="display:flex;gap:8px"><button id="notifAllow" style="flex:1;height:36px;background:#2d8a4e;color:#fff;border:none;border-radius:6px;font-weight:700">تفعيل ✓</button><button id="notifLater" style="flex:0 0 80px;height:36px;background:transparent;color:#9e9e9e;border:1px solid #2d3543;border-radius:6px">لاحقاً</button></div>`;
        document.body.appendChild(banner);
        document.getElementById('notifAllow').onclick=async()=>{ banner.remove(); await requestPermission(); try{registerPeriodicSync()}catch(e){} };
        document.getElementById('notifLater').onclick=()=>banner.remove();
        setTimeout(()=>{ try{banner.remove();}catch(e){} },12000);
      } else if(typeof Notification!=='undefined' && Notification.permission==='granted'){
        localStorage.setItem(LS_KEY_ENABLED,'1'); try{registerPeriodicSync()}catch(e){} try{registerBgSync()}catch(e){}
      } else if(!('Notification' in window) && 'serviceWorker' in navigator){
        // WebView بدون Notification - فعّل تلقائياً عبر SW
        if(!localStorage.getItem(LS_KEY_ENABLED)){
          // لا بانر مزعج، فقط سجل
          console.log('[Notif] WebView بدون Notification - سيعمل عبر SW');
        }
        if(localStorage.getItem(LS_KEY_ENABLED)==='1'){ try{registerPeriodicSync()}catch(e){} }
      }
    }catch(e){}
  },4000);

  try{
    navigator.serviceWorker?.addEventListener('message', e=>{
      if(e.data && e.data.type==='DO_BG_SYNC'){ if(window.syncFromApi) window.syncFromApi({force:true}); }
      if(e.data && e.data.type==='BG_PRODUCTS_UPDATED'){ if(window.syncFromApi) window.syncFromApi({force:true}); }
    });
  }catch(e){}
  window.addEventListener('online', ()=>{ try{registerBgSync()}catch(e){} try{registerPeriodicSync()}catch(e){} });
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible'){ try{registerBgSync()}catch(e){} }});
  if(document.readyState==='complete' || document.readyState==='interactive'){
    setTimeout(()=>{ if(localStorage.getItem(LS_KEY_ENABLED)==='1'){ try{registerPeriodicSync()}catch(e){} try{registerBgSync()}catch(e){} } },2000);
  } else {
    document.addEventListener('DOMContentLoaded', ()=> setTimeout(()=>{ if(localStorage.getItem(LS_KEY_ENABLED)==='1'){ try{registerPeriodicSync()}catch(e){} } },2000));
  }
  console.log('[Notif] manager ready — supported:', isSupported(), 'granted:', isGranted(), 'enabled:', localStorage.getItem(LS_KEY_ENABLED));
})();
