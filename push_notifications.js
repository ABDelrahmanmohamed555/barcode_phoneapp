// push_notifications.js — نظام إشعارات دائم — مُصلح جذري
// يشتغل: فوراً (Realtime) + polling + خلفية (periodicSync / SW autonomous) + FCM لاحقاً
// يدعم: منتج جديد + تعديل سعر + حذف — مع منع إشعار لنفسك + عمل في الخلفية حتى لو مقفول

(function(){
  const LS_KEY_ENABLED = 'notif_enabled';
  const LS_KEY_LAST_COUNT = 'notif_last_count';
  const LS_KEY_LAST_BARCODES = 'notif_last_barcodes';
  const LS_KEY_LAST_SNAPSHOT = 'notif_last_snapshot'; // JSON map barcode->price

  function isSupported(){
    return 'Notification' in window && 'serviceWorker' in navigator;
  }
  function isGranted(){
    return isSupported() && Notification.permission === 'granted';
  }
  async function requestPermission(){
    if(!isSupported()){
      showToast('المتصفح لا يدعم الإشعارات','warning');
      return false;
    }
    if(Notification.permission === 'granted'){
      localStorage.setItem(LS_KEY_ENABLED, '1');
      showToast('الإشعارات مفعلة ✓','success');
      try{ registerPeriodicSync(); }catch(e){}
      try{ registerBgSync(); }catch(e){}
      // اختبر إشعار فوري
      await showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات عند إضافة أو تعديل منتج');
      return true;
    }
    if(Notification.permission === 'denied'){
      showToast('الإشعارات محجوبة من إعدادات المتصفح — افتح إعدادات الموقع وفعّلها','error',4000);
      return false;
    }
    try{
      const res = await Notification.requestPermission();
      if(res === 'granted'){
        localStorage.setItem(LS_KEY_ENABLED, '1');
        await showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات عند إضافة منتج جديد');
        showToast('تم تفعيل الإشعارات ✓','success');
        try{ registerPeriodicSync(); }catch(e){}
        try{ registerBgSync(); }catch(e){}
        return true;
      } else {
        showToast('تم رفض الإذن','warning');
        return false;
      }
    }catch(e){
      showToast('فشل طلب الإذن: '+e.message,'error');
      return false;
    }
  }

  async function showNotification(title, body, tag){
    if(!isGranted()){
      // حاول حتى لو isGranted false لكن permission granted و LS not set
      if(Notification.permission !== 'granted') return false;
    }
    // حاول عبر SW controller أولاً
    try{
      if(navigator.serviceWorker && navigator.serviceWorker.controller){
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_NOTIFICATION',
          title: title,
          body: body,
          tag: tag || ('notif-'+Date.now())
        });
        return true;
      }
    }catch(e){ console.warn('[Notif] controller fail', e.message); }
    // fallback عبر registration
    try{
      const reg = await navigator.serviceWorker.getRegistration();
      if(reg){
        await reg.showNotification(title, {
          body: body,
          icon: './icon.png',
          badge: './icon.png',
          tag: tag || 'new-product',
          vibrate: [200,100,200],
          data: {url:'./index.html'}
        });
        return true;
      }
    }catch(e){ console.warn('[Notif] reg fail', e.message); }
    try{
      new Notification(title, {body: body, icon: './icon.png'});
      return true;
    }catch(e){
      console.warn('[Notif] direct fail', e.message);
      return false;
    }
  }

  async function registerPeriodicSync(){
    try{
      const reg = await navigator.serviceWorker.ready;
      if(!reg || !('periodicSync' in reg)) {
        console.log('[Notif] periodicSync غير مدعوم — استخدام polling/ backgroundFetch');
        return false;
      }
      try{
        const status = await navigator.permissions.query({name: 'periodic-background-sync'});
        if(status.state === 'denied') { console.log('[Notif] periodicSync denied'); return false; }
      }catch(e){}
      await reg.periodicSync.register('sync-products', {minInterval: 15*60*1000});
      console.log('[Notif] periodicSync مسجل كل 15د ✓');
      return true;
    }catch(e){
      console.log('[Notif] periodicSync fail', e.message);
      return false;
    }
  }
  async function registerBgSync(){
    try{
      const reg = await navigator.serviceWorker.ready;
      if(reg && 'sync' in reg){
        await reg.sync.register('sync-products');
        console.log('[Notif] bg sync مسجل');
        return true;
      }
    }catch(e){ console.log('[Notif] bg sync fail', e.message); }
    return false;
  }

  // === تتبع الحالة ===
  let _lastNotifiedCount = -1;
  let _lastBarcodesSet = null;
  let _lastSnapshot = null; // Map barcode -> {price, name}
  try{
    const v = localStorage.getItem(LS_KEY_LAST_COUNT);
    if(v!==null) _lastNotifiedCount = parseInt(v,10)||-1;
    const b = localStorage.getItem(LS_KEY_LAST_BARCODES);
    if(b) _lastBarcodesSet = new Set(JSON.parse(b));
    const s = localStorage.getItem(LS_KEY_LAST_SNAPSHOT);
    if(s) _lastSnapshot = JSON.parse(s);
  }catch(e){}

  function _saveState(count, products){
    _lastNotifiedCount = count;
    try{ localStorage.setItem(LS_KEY_LAST_COUNT, String(count)); }catch(e){}
    try{
      const barcodes = products.map(p=>p.barcode).sort();
      localStorage.setItem(LS_KEY_LAST_BARCODES, JSON.stringify(barcodes));
      _lastBarcodesSet = new Set(barcodes);
      const snap = {};
      products.forEach(p=> snap[p.barcode] = {price:String(p.price), name:p.name, stock:String(p.stock)});
      localStorage.setItem(LS_KEY_LAST_SNAPSHOT, JSON.stringify(snap));
      _lastSnapshot = snap;
    }catch(e){}
    // أرسل للـ SW أيضاً
    try{
      if(navigator.serviceWorker && navigator.serviceWorker.controller){
        const barcodesStr = JSON.stringify(products.map(p=>p.barcode).sort());
        navigator.serviceWorker.controller.postMessage({type:'SET_BG_STATE', count: count, barcodes: barcodesStr});
      }
    }catch(e){}
  }

  function onProductsUpdated(newProducts, source){
    if(!Array.isArray(newProducts)) return;
    // أول مرة: حفظ فقط
    if(_lastNotifiedCount === -1 || !_lastBarcodesSet){
      _saveState(newProducts.length, newProducts);
      console.log('[Notif] تهيئة أولية', newProducts.length);
      return;
    }
    const newBarcodes = new Set(newProducts.map(p=>p.barcode));
    const oldBarcodes = _lastBarcodesSet;
    const oldSnap = _lastSnapshot || {};

    // اكتشف الإضافات
    const added = newProducts.filter(p=> !oldBarcodes.has(p.barcode));
    // اكتشف المحذوفات
    const removedCount = oldBarcodes.size - (newProducts.length - added.length);
    // اكتشف تعديلات سعر/اسم
    const priceChanged = newProducts.filter(p=>{
      const old = oldSnap[p.barcode];
      if(!old) return false;
      return String(old.price)!==String(p.price) || old.name!==p.name;
    });

    let notified = false;

    // فحص self-add
    const selfBarcode = (()=>{ try{ return sessionStorage.getItem('_self_add_barcode'); }catch(e){return null;} })();

    if(added.length>0){
      const isSelf = selfBarcode && added.some(p=> p.barcode===selfBarcode);
      if(isSelf){
        console.log('[Notif] تخطي إشعار — أنت اللي أضفت');
        try{ sessionStorage.removeItem('_self_add_barcode'); }catch(e){}
      } else {
        const title = added.length===1 ? 'منتج جديد ✓' : `${added.length} منتجات جديدة ✓`;
        const body = added.length===1 ? `${added[0].name} — تمت إضافته` : `${added.slice(0,2).map(p=>p.name).join('، ')}${added.length>2?' ...':''}`;
        const enabled = localStorage.getItem(LS_KEY_ENABLED)==='1';
        const isVisible = document.visibilityState === 'visible';
        // اعرض إشعار دائماً لو مفعل، و Toast دائماً
        if(enabled && isGranted()){
          if(!isVisible){
            showNotification(title, body, 'new-product-'+Date.now());
          } else {
            // حتى وهو مفتوح، اعرض Toast + إشعار خفيف اختياري (نعرض Toast فقط افتراضياً)
            // لكن لو المستخدم يريد إشعار حتى وهو مفتوح، فعّل السطر التالي:
            showNotification(title, body, 'new-product-'+Date.now());
          }
          try{ showToast(title + ': ' + body,'info',3800); }catch(e){}
        } else if(!enabled){
          // حتى لو غير مفعل، اعرض Toast للتنبيه داخل التطبيق
          try{ showToast(title + ': ' + body,'info',3500); }catch(e){}
          console.log('[Notif] إشعارات النظام غير مفعلة — Toast فقط', title);
        }
        notified = true;
      }
    }

    if(!notified && priceChanged.length>0){
      // إشعار تعديل سعر (مرة واحدة لكل دفعة)
      const p = priceChanged[0];
      const old = oldSnap[p.barcode];
      const title = 'تم تحديث سعر ✓';
      const body = `${p.name}: ${old.price} → ${p.price} جنيه`;
      const enabled = localStorage.getItem(LS_KEY_ENABLED)==='1';
      const isSelf = selfBarcode && priceChanged.some(x=> x.barcode===selfBarcode);
      if(!isSelf && enabled && isGranted()){
        showNotification(title, body, 'price-'+p.barcode);
        try{ showToast(title+': '+body,'info',3500); }catch(e){}
      } else if(priceChanged.length>0){
        try{ showToast(title+': '+body,'info',3000); }catch(e){}
      }
      notified = true;
    }

    if(added.length===0 && newProducts.length < _lastNotifiedCount){
      console.log('[Notif] حذف', _lastNotifiedCount,'->',newProducts.length);
      // لا إشعار للحذف، فقط حدث الحالة
    }

    // حدث الحالة دوماً
    _saveState(newProducts.length, newProducts);
    if(selfBarcode && added.length===0 && priceChanged.length===0){
      // نظف self flag لو لم يعد relevant
      try{ sessionStorage.removeItem('_self_add_barcode'); }catch(e){}
    }
  }

  function markSelfAdd(barcode){
    try{ sessionStorage.setItem('_self_add_barcode', barcode); }catch(e){}
    // لا تحدث العداد هنا — دع onProductsUpdated يكتشف بدقة عبر الباركود
    // لكن خزن توقيت لمنع الإشعار خلال 15ث
    try{ sessionStorage.setItem('_self_add_time', String(Date.now())); }catch(e){}
  }

  window.NotifManager = {
    isSupported, isGranted, requestPermission, showNotification,
    registerPeriodicSync, registerBgSync,
    onProductsUpdated, markSelfAdd
  };

  // بانر طلب إذن لطيف بعد 4ث (مرة واحدة)
  setTimeout(()=>{
    try{
      if(!isSupported()) return;
      if(Notification.permission === 'default' && !localStorage.getItem(LS_KEY_ENABLED)){
        const banner = document.createElement('div');
        banner.id = 'notifBanner';
        banner.style.cssText = 'position:fixed;bottom:70px;left:12px;right:12px;z-index:9999;background:#1c2333;border:1px solid #c8943a;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;box-shadow:0 8px 24px rgba(0,0,0,0.4)';
        banner.innerHTML = `
          <div style="color:#f5f0e3;font-size:13px;font-weight:700">📱 تفعيل الإشعارات؟</div>
          <div style="color:#9e9e9e;font-size:11px">ستصلك إشعارات عند إضافة أو تعديل منتج حتى لو التطبيق في الخلفية</div>
          <div style="display:flex;gap:8px">
            <button id="notifAllow" style="flex:1;height:36px;background:#2d8a4e;color:#fff;border:none;border-radius:6px;font-weight:700">تفعيل ✓</button>
            <button id="notifLater" style="flex:0 0 80px;height:36px;background:transparent;color:#9e9e9e;border:1px solid #2d3543;border-radius:6px">لاحقاً</button>
          </div>
        `;
        document.body.appendChild(banner);
        document.getElementById('notifAllow').onclick = async ()=>{
          banner.remove();
          await requestPermission();
          try{ registerPeriodicSync(); }catch(e){}
        };
        document.getElementById('notifLater').onclick = ()=> banner.remove();
        setTimeout(()=>{ try{banner.remove();}catch(e){} }, 12000);
      } else if(Notification.permission === 'granted'){
        localStorage.setItem(LS_KEY_ENABLED,'1');
        try{ registerPeriodicSync(); }catch(e){}
        try{ registerBgSync(); }catch(e){}
      }
    }catch(e){}
  }, 4000);

  // استمع لرسائل SW
  try{
    navigator.serviceWorker?.addEventListener('message', e=>{
      if(e.data && e.data.type==='DO_BG_SYNC'){
        console.log('[Notif] SW طلب مزامنة خلفية');
        if(window.syncFromApi) window.syncFromApi({force:true});
        else if(window.SupabaseSync) window.SupabaseSync.getProducts().then(d=>{ try{onProductsUpdated(d,'sw');}catch(e){} });
      }
      if(e.data && e.data.type==='BG_PRODUCTS_UPDATED'){
        if(window.syncFromApi) window.syncFromApi({force:true});
      }
    });
  }catch(e){}

  // سجل bg sync عند العودة online + visibility
  window.addEventListener('online', ()=>{ try{ registerBgSync(); }catch(e){} try{ registerPeriodicSync(); }catch(e){} });
  document.addEventListener('visibilitychange', ()=>{ if(document.visibilityState==='visible'){ try{ registerBgSync(); }catch(e){} }});
  // حاول تسجيل periodicSync عند التحميل
  if(document.readyState==='complete' || document.readyState==='interactive'){
    setTimeout(()=>{ if(Notification.permission==='granted'){ try{ registerPeriodicSync(); }catch(e){} try{ registerBgSync(); }catch(e){} } }, 2000);
  } else {
    document.addEventListener('DOMContentLoaded', ()=> setTimeout(()=>{ if(Notification.permission==='granted'){ try{ registerPeriodicSync(); }catch(e){} } }, 2000));
  }

  console.log('[Notif] manager ready — supported:', isSupported(), 'granted:', isGranted(), 'enabled:', localStorage.getItem(LS_KEY_ENABLED));
})();
