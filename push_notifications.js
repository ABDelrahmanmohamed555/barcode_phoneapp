// push_notifications.js — المرحلة 1: إشعارات محلية + مزامنة خلفية (بدون Firebase)
// يشتغل فوري لما التطبيق مفتوح/مصغر، وكل 15 دقيقة لما مقفول (عبر background-fetch لاحقاً)
// المرحلة 2 (FCM) هتضيف الإشعار اللحظي حتى لو مقتول — الكود هنا مجهز لها

(function(){
  const LS_KEY_ENABLED = 'notif_enabled';
  const LS_KEY_LAST_COUNT = 'notif_last_count';

  // هل المتصفح يدعم الإشعارات؟
  function isSupported(){
    return 'Notification' in window && 'serviceWorker' in navigator;
  }

  // هل الإذن ممنوح؟
  function isGranted(){
    return isSupported() && Notification.permission === 'granted';
  }

  // طلب الإذن (لازم يكون بضغطة زر — الأندرويد يرفض لو تلقائي)
  async function requestPermission(){
    if(!isSupported()){
      showToast('المتصفح لا يدعم الإشعارات','warning');
      return false;
    }
    if(Notification.permission === 'granted'){
      localStorage.setItem(LS_KEY_ENABLED, '1');
      showToast('الإشعارات مفعلة ✓','success');
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
        // اختبار إشعار
        await showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات عند إضافة منتج جديد');
        showToast('تم تفعيل الإشعارات ✓','success');
        // سجل للـ periodic sync لو مدعوم
        try{ registerPeriodicSync(); }catch(e){}
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

  // عرض إشعار (يحاول عبر ServiceWorker أولاً — يشتغل حتى لو الصفحة في الخلفية)
  async function showNotification(title, body, tag){
    if(!isGranted()) return false;
    try{
      // لو فيه ServiceWorker — استخدمه (يشتغل في الخلفية)
      if(navigator.serviceWorker && navigator.serviceWorker.controller){
        navigator.serviceWorker.controller.postMessage({
          type: 'SHOW_NOTIFICATION',
          title: title,
          body: body,
          tag: tag || ('notif-'+Date.now())
        });
        return true;
      }
      // fallback: عبر SW registration مباشرة
      const reg = await navigator.serviceWorker.getRegistration();
      if(reg){
        await reg.showNotification(title, {
          body: body,
          icon: './icon.png',
          badge: './icon.png',
          tag: tag || 'new-product',
          vibrate: [200,100,200]
        });
        return true;
      }
    }catch(e){
      console.warn('[Notif] SW fail', e.message);
    }
    // fallback أخير: Notification مباشر (يشتغل فقط لما الصفحة مفتوحة)
    try{
      new Notification(title, {body: body, icon: './icon.png'});
      return true;
    }catch(e){
      console.warn('[Notif] direct fail', e.message);
      return false;
    }
  }

  // تسجيل Periodic Background Sync (لو مدعوم — Chrome + PWA مثبت)
  async function registerPeriodicSync(){
    try{
      const reg = await navigator.serviceWorker.getRegistration();
      if(!reg || !('periodicSync' in reg)) {
        console.log('[Notif] periodicSync غير مدعوم — سيتم استخدام polling كبديل');
        return false;
      }
      const status = await navigator.permissions.query({name: 'periodic-background-sync'});
      if(status.state !== 'granted'){
        console.log('[Notif] periodicSync permission', status.state);
      }
      await reg.periodicSync.register('sync-products', {minInterval: 15*60*1000}); // 15 دقيقة
      console.log('[Notif] periodicSync مسجل كل 15د ✓');
      return true;
    }catch(e){
      console.log('[Notif] periodicSync fail', e.message);
      return false;
    }
  }

  // تسجيل Background Sync لمرة واحدة عند انقطاع الشبكة
  async function registerBgSync(){
    try{
      const reg = await navigator.serviceWorker.getRegistration();
      if(reg && 'sync' in reg){
        await reg.sync.register('sync-products');
        console.log('[Notif] bg sync مسجل');
      }
    }catch(e){}
  }

  // كشف منتج جديد ومقارنة بالعدد السابق — يبعت إشعار
  let _lastNotifiedCount = -1;
  try{
    const v = localStorage.getItem(LS_KEY_LAST_COUNT);
    if(v) _lastNotifiedCount = parseInt(v,10)||-1;
  }catch(e){}

  function onProductsUpdated(newProducts, source){
    if(!Array.isArray(newProducts)) return;
    // لا تبعت إشعار عند أول تحميل (بدون منتجات سابقة)
    if(_lastNotifiedCount === -1){
      _lastNotifiedCount = newProducts.length;
      try{ localStorage.setItem(LS_KEY_LAST_COUNT, String(_lastNotifiedCount)); }catch(e){}
      return;
    }
    // لو زاد العدد → منتج جديد
    if(newProducts.length > _lastNotifiedCount){
      const diff = newProducts.length - _lastNotifiedCount;
      // جد المنتجات الجديدة (مقارنة بالـ barcode)
      let newItems = [];
      try{
        const oldBarcodes = new Set((window.products || []).slice(diff).map(p=>p.barcode));
        // ببساطة: المنتجات الجديدة هي اللي مش في القديم — ناخد أول diff
        newItems = newProducts.slice(0, diff);
      }catch(e){ newItems = newProducts.slice(0, diff); }

      const names = newItems.slice(0,2).map(p=> p.name).join('، ');
      const title = diff===1 ? 'منتج جديد ✓' : `${diff} منتجات جديدة ✓`;
      const body = diff===1 ? `${newItems[0]?.name || 'منتج'} — تمت إضافته` : `${names}${diff>2?' ...':''}`;

      // لا تبعت لو المستخدم هو اللي أضاف (لتجنب إشعار لنفسك) — نتحقق من آخر إضافة محلية
      const isSelfAdd = sessionStorage.getItem('_self_add_barcode');
      const selfBarcode = isSelfAdd ? isSelfAdd : null;
      const isSelf = selfBarcode && newItems.some(p=> p.barcode===selfBarcode);
      if(isSelf){
        console.log('[Notif] تخطي إشعار — أنت اللي أضفت المنتج');
        sessionStorage.removeItem('_self_add_barcode');
      } else {
        // اعرض فقط لو الصفحة في الخلفية أو الإشعارات مفعلة
        const isVisible = document.visibilityState === 'visible';
        const enabled = localStorage.getItem(LS_KEY_ENABLED)==='1';
        if(enabled && isGranted()){
          // لو في الواجهة، اعرض Toast + إشعار خفيف؛ لو في الخلفية، إشعار نظام
          if(!isVisible){
            showNotification(title, body, 'new-product-'+Date.now());
          } else {
            // حتى وهو مفتوح، اعرض إشعار نظام لو مفعل (اختياري — نعرض Toast فقط افتراضياً)
            // showNotification(title, body); // فعّل لو عايز إشعار حتى وهو مفتوح
            console.log('[Notif] منتج جديد لكن الصفحة مفتوحة — Toast فقط');
          }
          // أيضاً اعرض Toast دائماً
          try{ showToast(title + ': ' + body,'info',3500); }catch(e){}
        } else {
          console.log('[Notif] إشعارات غير مفعلة — تخطي', title);
        }
      }
      _lastNotifiedCount = newProducts.length;
      try{ localStorage.setItem(LS_KEY_LAST_COUNT, String(_lastNotifiedCount)); }catch(e){}
    } else if(newProducts.length < _lastNotifiedCount){
      // حذف منتجات — حدّث العداد بدون إشعار
      _lastNotifiedCount = newProducts.length;
      try{ localStorage.setItem(LS_KEY_LAST_COUNT, String(_lastNotifiedCount)); }catch(e){}
    } else {
      // نفس العدد لكن قد يكون تحديث سعر — لا إشعار
    }
  }

  // عند إضافة منتج محلي — خزّن باركوده عشان ما نبعتش إشعار لنفسك
  function markSelfAdd(barcode){
    try{ sessionStorage.setItem('_self_add_barcode', barcode); }catch(e){}
    // حدّث العداد فوراً عشان ما نعتبره جديد
    try{
      const cur = (window.products? window.products.length:0) + 1;
      _lastNotifiedCount = cur;
      localStorage.setItem(LS_KEY_LAST_COUNT, String(cur));
    }catch(e){}
  }

  // واجهة عامة
  window.NotifManager = {
    isSupported, isGranted, requestPermission, showNotification,
    registerPeriodicSync, registerBgSync,
    onProductsUpdated, markSelfAdd
  };

  // اسأل عن الإذن بلطف بعد 4 ثواني من الفتح (مرة واحدة فقط)
  setTimeout(()=>{
    try{
      if(!isSupported()) return;
      if(Notification.permission === 'default' && !localStorage.getItem(LS_KEY_ENABLED)){
        // اعرض بانر لطيف بدل طلب مباشر (أفضل للمبتدئ)
        const banner = document.createElement('div');
        banner.id = 'notifBanner';
        banner.style.cssText = 'position:fixed;bottom:70px;left:12px;right:12px;z-index:9999;background:#1c2333;border:1px solid #c8943a;border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;box-shadow:0 8px 24px rgba(0,0,0,0.4)';
        banner.innerHTML = `
          <div style="color:#f5f0e3;font-size:13px;font-weight:700">📱 تفعيل الإشعارات؟</div>
          <div style="color:#9e9e9e;font-size:11px">ستصلك إشعارات عند إضافة منتج جديد حتى لو التطبيق مقفول</div>
          <div style="display:flex;gap:8px">
            <button id="notifAllow" style="flex:1;height:36px;background:#2d8a4e;color:#fff;border:none;border-radius:6px;font-weight:700">تفعيل ✓</button>
            <button id="notifLater" style="flex:0 0 80px;height:36px;background:transparent;color:#9e9e9e;border:1px solid #2d3543;border-radius:6px">لاحقاً</button>
          </div>
        `;
        document.body.appendChild(banner);
        document.getElementById('notifAllow').onclick = async ()=>{
          banner.remove();
          await requestPermission();
        };
        document.getElementById('notifLater').onclick = ()=> banner.remove();
        // اختفاء تلقائي بعد 12s
        setTimeout(()=>{ try{banner.remove();}catch(e){} }, 12000);
      } else if(Notification.permission === 'granted'){
        localStorage.setItem(LS_KEY_ENABLED,'1');
        try{ registerPeriodicSync(); }catch(e){}
      }
    }catch(e){}
  }, 4000);

  // استمع لرسائل من SW (periodicsync)
  try{
    navigator.serviceWorker?.addEventListener('message', e=>{
      if(e.data && e.data.type==='DO_BG_SYNC'){
        console.log('[Notif] SW طلب مزامنة خلفية');
        if(window.syncFromApi) window.syncFromApi({force:true});
      }
    });
  }catch(e){}

  // عند عودة الشبكة، سجل bg sync
  window.addEventListener('online', ()=>{ try{ registerBgSync(); }catch(e){} });

  console.log('[Notif] manager ready — supported:', isSupported(), 'granted:', isGranted());
})();
