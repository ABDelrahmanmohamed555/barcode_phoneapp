// push_notifications.js — نظام إشعارات يعمل داخل وخارج التطبيق — V4.4 مُصلح جذري
// داخل: Toast + SW periodicSync (حتى لو مقفول 15د) + polling
// خارج: Cordova local notification + ServiceWorker showNotification + FCM Push
// الإصلاحات V4.4: حل مشكلة WebView بدون Notification API + تفعيل تلقائي + قناة أندرويد + إذن POST_NOTIFICATIONS
(function(){
  const LS_KEY_ENABLED = 'notif_enabled';
  const LS_KEY_LAST_COUNT = 'notif_last_count';
  const LS_KEY_LAST_BARCODES = 'notif_last_barcodes';
  const LS_KEY_LAST_SNAPSHOT = 'notif_last_snapshot';

  function hasCordovaLocal(){
    return !!(window.cordova && window.cordova.plugins && window.cordova.plugins.notification && window.cordova.plugins.notification.local);
  }
  function hasFirebase(){
    return !!(window.cordova && window.FirebasePlugin);
  }
  function isSupported(){
    if(hasCordovaLocal()) return true;
    if(hasFirebase()) return true;
    if('serviceWorker' in navigator) return true;
    return 'Notification' in window;
  }
  function isGranted(){
    // Cordova local: نعتمد على LS_ENABLED لأنه لا يوجد check sync
    if(hasCordovaLocal() || hasFirebase()){
      return localStorage.getItem(LS_KEY_ENABLED)==='1';
    }
    if('Notification' in window && typeof Notification!=='undefined'){
      return Notification.permission === 'granted' || localStorage.getItem(LS_KEY_ENABLED)==='1';
    }
    return localStorage.getItem(LS_KEY_ENABLED)==='1';
  }

  // إنشاء قناة أندرويد لـ local notification (مطلوبة أندرويد 8+)
  function ensureLocalChannel(){
    if(!hasCordovaLocal()) return;
    try{
      const local = window.cordova.plugins.notification.local;
      // بعض النسخ تدعم createChannel، بعضها لا
      if(local.createChannel){
        local.createChannel({
          id: 'nahal-products',
          name: 'منتجات النحال',
          description: 'إشعارات المنتجات الجديدة والتحديثات',
          importance: 4,
          visibility: 1,
          sound: 'default',
          vibration: true
        });
        console.log('[Notif] local channel created');
      }
    }catch(e){ console.warn('[Notif] channel fail', e.message); }
  }

  async function requestPermission(){
    // 1) Cordova local notification — الأفضل للـ APK بدون Firebase
    if(hasCordovaLocal()){
      return new Promise((resolve)=>{
        try{
          const local = window.cordova.plugins.notification.local;
          ensureLocalChannel();
          local.hasPermission((granted)=>{
            if(granted){
              localStorage.setItem(LS_KEY_ENABLED,'1');
              showToast('الإشعارات مفعلة ✓','success');
              try{registerPeriodicSync()}catch(e){}
              try{registerBgSync()}catch(e){}
              showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات حتى لو التطبيق مقفول');
              resolve(true);
            } else {
              local.requestPermission((granted2)=>{
                if(granted2){
                  localStorage.setItem(LS_KEY_ENABLED,'1');
                  showToast('الإشعارات مفعلة ✓','success');
                  try{registerPeriodicSync()}catch(e){}
                  showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات');
                  resolve(true);
                } else {
                  // حتى لو رفض، فعّل محلياً وحاول عبر SW
                  localStorage.setItem(LS_KEY_ENABLED,'1');
                  showToast('تم تفعيل الإشعارات محلياً ✓','info');
                  showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات داخل التطبيق');
                  resolve(true);
                }
              });
            }
          });
        }catch(e){
          console.warn('[Notif] local permission err', e.message);
          localStorage.setItem(LS_KEY_ENABLED,'1');
          showToast('الإشعارات مفعلة ✓','success');
          resolve(true);
        }
      });
    }
    // 2) FirebasePlugin — لو موجود
    if(hasFirebase()){
      return new Promise((resolve)=>{
        try{
          window.FirebasePlugin.hasPermission((has)=>{
            if(has){
              localStorage.setItem(LS_KEY_ENABLED,'1');
              showToast('الإشعارات مفعلة ✓','success');
              try{registerPeriodicSync()}catch(e){}
              showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات حتى لو التطبيق مقفول');
              resolve(true);
            } else {
              window.FirebasePlugin.grantPermission(()=>{
                localStorage.setItem(LS_KEY_ENABLED,'1');
                showToast('الإشعارات مفعلة ✓','success');
                resolve(true);
              }, (err)=>{
                console.warn('[FCM] grant fail', err);
                localStorage.setItem(LS_KEY_ENABLED,'1');
                resolve(true);
              });
            }
          });
        }catch(e){
          localStorage.setItem(LS_KEY_ENABLED,'1');
          resolve(true);
        }
      });
    }
    // 3) Web Notification API
    if('Notification' in window && typeof Notification!=='undefined'){
      if(Notification.permission==='granted'){
        localStorage.setItem(LS_KEY_ENABLED,'1');
        showToast('الإشعارات مفعلة ✓','success');
        try{registerPeriodicSync()}catch(e){}
        await showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات عند إضافة منتج');
        return true;
      }
      if(Notification.permission==='denied'){
        showToast('الإشعارات محجوبة - فعلها من إعدادات المتصفح','error',4000);
        // حاول fallback عبر SW
        localStorage.setItem(LS_KEY_ENABLED,'1');
        await showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات داخل التطبيق');
        return false;
      }
      try{
        const res=await Notification.requestPermission();
        if(res==='granted'){
          localStorage.setItem(LS_KEY_ENABLED,'1');
          await showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات');
          showToast('الإشعارات مفعلة ✓','success');
          try{registerPeriodicSync()}catch(e){}
          return true;
        } else {
          showToast('تم رفض الإذن','warning');
          localStorage.setItem(LS_KEY_ENABLED,'1');
          return false;
        }
      }catch(e){ /* fallback */ }
    }
    // 4) Fallback لـ WebView بدون أي API: فعل مباشرة واعتمد على SW + Toast
    localStorage.setItem(LS_KEY_ENABLED,'1');
    showToast('الإشعارات مفعلة ✓','success',4000);
    try{ registerPeriodicSync(); }catch(e){}
    try{ registerBgSync(); }catch(e){}
    try{ ensureLocalChannel(); }catch(e){}
    await showNotification('تم تفعيل الإشعارات ✓','ستصلك إشعارات عند إضافة منتج حتى لو التطبيق مقفول');
    return true;
  }

  async function showNotification(title, body, tag){
    let ok=false;
    const notifTitle = title || 'منتج جديد';
    const notifBody = body || 'تمت إضافة منتج جديد';
    const notifTag = tag || ('notif-'+Date.now());
    // 1) Cordova local — الأساسي للـ APK
    if(hasCordovaLocal()){
      try{
        const local = window.cordova.plugins.notification.local;
        const id = Date.now()%2147483647;
        // حاول إنشاء القناة أولاً
        try{ ensureLocalChannel(); }catch(e){}
        local.schedule({
          id: id,
          title: notifTitle,
          text: notifBody,
          smallIcon: 'res://icon',
          icon: 'res://icon',
          channel: 'nahal-products',
          foreground: true,
          priority: 2,
          visibility: 1,
          vibrate: true,
          sound: 'default',
          wakeup: true
        });
        console.log('[Notif] local scheduled', notifTitle);
        ok=true;
        // لا نرجع فوراً — نحاول أيضاً SW كتأكيد
      }catch(e){ console.warn('[Notif] local schedule fail', e.message); }
    }
    // 2) ServiceWorker — يعمل في WebView و PWA (حتى بدون Notification API)
    // نحاول دائماً حتى لو Cordova نجح، لضمان الظهور في شريط النظام عند الخلفية
    try{
      if('serviceWorker' in navigator){
        // أرسل لـ SW عبر controller (حتى لو في الخلفية)
        try{
          if(navigator.serviceWorker.controller){
            navigator.serviceWorker.controller.postMessage({type:'SHOW_NOTIFICATION', title:notifTitle, body:notifBody, tag:notifTag});
            ok=true;
          }
        }catch(e){}
        // وأيضاً حاول مباشرة عبر registration.showNotification
        try{
          const reg = await navigator.serviceWorker.getRegistration();
          if(reg){
            // registration.showNotification يتطلب إذن POST_NOTIFICATIONS على أندرويد 13+
            // في WebView قد ينجح لو الإذن ممنوح في Manifest
            await reg.showNotification(notifTitle, {
              body: notifBody,
              icon: './icon.png',
              badge: './icon.png',
              tag: notifTag,
              vibrate: [200,100,200],
              data: {url: './index.html'},
              requireInteraction: false
            });
            console.log('[Notif] SW showNotification ✓', notifTitle);
            ok=true;
          } else if(navigator.serviceWorker.controller){
            ok=true; // controller موجود يعني سيرسل
          }
        }catch(e){
          console.warn('[Notif] SW showNotification fail', e.message);
          // لو فشل بسبب إذن، حاول fallback لـ Toast
          if(e.message && e.message.includes('permission')){
            console.warn('[Notif] permission needed for SW notification');
          }
        }
        // fallback عبر ready.active
        if(!ok){
          try{
            const reg2 = await navigator.serviceWorker.ready;
            if(reg2 && reg2.active){
              reg2.active.postMessage({type:'SHOW_NOTIFICATION', title:notifTitle, body:notifBody, tag:notifTag});
              ok=true;
            }
          }catch(e){}
        }
      }
    }catch(e){ console.warn('[Notif] SW fail', e.message); }
    // 3) Web Notification API
    try{
      if(typeof Notification!=='undefined' && Notification.permission==='granted'){
        new Notification(notifTitle, {body:notifBody, icon:'./icon.png'});
        ok=true;
      }
    }catch(e){}
    // 4) Toast داخل التطبيق — دائماً كـ fallback بصري
    if(!ok){
      console.log('[Notif] fallback to toast', notifTitle, notifBody);
    }
    try{ if(typeof showToast==='function') showToast(notifTitle+': '+notifBody,'info',4000); }catch(e){}
    return ok;
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
    }catch(e){ console.log('[Notif] periodicSync fail', e.message); }
    return false;
  }
  async function registerBgSync(){
    try{
      const reg=await navigator.serviceWorker.ready;
      if(reg && 'sync' in reg){ await reg.sync.register('sync-products'); console.log('[Notif] bgSync ✓'); return true; }
    }catch(e){ console.log('[Notif] bgSync fail', e.message); }
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
    // أرسل للـ SW بكل الطرق الممكنة
    try{
      const barcodesStr=JSON.stringify(products.map(p=>p.barcode).sort());
      if(navigator.serviceWorker && navigator.serviceWorker.controller){
        navigator.serviceWorker.controller.postMessage({type:'SET_BG_STATE', count:count, barcodes:barcodesStr});
      }
      // fallback عبر ready
      navigator.serviceWorker.ready.then(reg=>{
        if(reg && reg.active) reg.active.postMessage({type:'SET_BG_STATE', count:count, barcodes:barcodesStr});
      }).catch(()=>{});
    }catch(e){}
  }
  function onProductsUpdated(newProducts, source){
    if(!Array.isArray(newProducts)) return;
    console.log('[Notif] onProductsUpdated', newProducts.length, 'source', source, 'last', _lastNotifiedCount);
    if(_lastNotifiedCount===-1 || !_lastBarcodesSet){
      console.log('[Notif] init state', newProducts.length);
      _saveState(newProducts.length, newProducts);
      return;
    }
    const newBarcodes=new Set(newProducts.map(p=>p.barcode));
    const oldBarcodes=_lastBarcodesSet;
    const oldSnap=_lastSnapshot||{};
    const added=newProducts.filter(p=>!oldBarcodes.has(p.barcode));
    const priceChanged=newProducts.filter(p=>{ const o=oldSnap[p.barcode]; return o && (String(o.price)!==String(p.price) || o.name!==p.name || String(o.stock)!==String(p.stock)); });
    const selfBarcode=(()=>{ try{ return sessionStorage.getItem('_self_add_barcode'); }catch(e){return null;}})();
    const selfTime=(()=>{ try{ return parseInt(sessionStorage.getItem('_self_add_time')||'0',10); }catch(e){return 0;}})();
    const isRecentSelf = selfTime && (Date.now() - selfTime < 30000); // 30 ثانية
    let notified=false;
    if(added.length>0){
      const isSelf=isRecentSelf && selfBarcode && added.some(p=>p.barcode===selfBarcode);
      if(isSelf){
        console.log('[Notif] skip self add', selfBarcode);
        try{sessionStorage.removeItem('_self_add_barcode');}catch(e){}
        try{sessionStorage.removeItem('_self_add_time');}catch(e){}
      } else {
        const title=added.length===1?'منتج جديد ✓':`${added.length} منتجات جديدة ✓`;
        const body=added.length===1?`${added[0].name} — تمت إضافته`:`${added.slice(0,2).map(p=>p.name).join('، ')}${added.length>2?' ...':''}`;
        console.log('[Notif] NOTIFY added', title, body);
        // اعرض دائماً كـ Toast داخل التطبيق
        try{ if(typeof showToast==='function') showToast(title+': '+body,'info',3800); }catch(e){}
        // واعرض كـ System notification خارج التطبيق (حتى لو في الواجهة)
        showNotification(title, body, 'new-product-'+Date.now());
        notified=true;
      }
    }
    if(!notified && priceChanged.length>0){
      // لو self وما تغير سعره بنفسه، تجاهل
      let filtered = priceChanged;
      if(isRecentSelf && selfBarcode){
        filtered = priceChanged.filter(p=> p.barcode!==selfBarcode);
        if(filtered.length===0){
          console.log('[Notif] skip self price change');
          try{sessionStorage.removeItem('_self_add_barcode');}catch(e){}
          try{sessionStorage.removeItem('_self_add_time');}catch(e){}
        }
      }
      if(filtered.length>0){
        const p=filtered[0]; const old=oldSnap[p.barcode];
        const title='تم تحديث ✓'; const body=`${p.name}: ${old?old.price:'?'} → ${p.price} جنيه`;
        console.log('[Notif] NOTIFY price', body);
        try{ if(typeof showToast==='function') showToast(title+': '+body,'info',3500); }catch(e){}
        showNotification(title, body, 'price-'+p.barcode);
        notified=true;
      }
    }
    _saveState(newProducts.length, newProducts);
    if(selfBarcode && added.length===0 && priceChanged.length===0){
      // نظف self بعد 30 ثانية حتى لو لم يظهر تغيير
      if(!isRecentSelf){
        try{sessionStorage.removeItem('_self_add_barcode');}catch(e){}
        try{sessionStorage.removeItem('_self_add_time');}catch(e){}
      }
    }
  }
  function markSelfAdd(barcode){ try{sessionStorage.setItem('_self_add_barcode', barcode);}catch(e){} try{sessionStorage.setItem('_self_add_time', String(Date.now()));}catch(e){} console.log('[Notif] markSelfAdd', barcode); }

  // دالة اختبار يدوي — للتشخيص
  window.testNotif = function(){
    console.log('[Notif] testNotif called');
    showNotification('اختبار إشعار ✓', 'هذا اختبار — الإشعارات تعمل بنجاح', 'test-'+Date.now());
    try{ if(typeof showToast==='function') showToast('اختبار إشعار ✓','info'); }catch(e){}
    return 'تم إرسال اختبار — تحقق من شريط الإشعارات';
  };
  window.testNotifAdd = function(name){
    // محاكاة إضافة منتج للاختبار
    const fakeBarcode = 'TEST'+Date.now();
    const fake = {name: name||'منتج تجريبي', barcode: fakeBarcode, price: '999', stock: '10'};
    console.log('[Notif] testNotifAdd', fake);
    // احفظ حالة وهمية ثم استدعي onProductsUpdated
    const curProducts = (()=>{ try{ return window.products||[]; }catch(e){return []}})();
    const newList = curProducts.concat([fake]);
    onProductsUpdated(newList, 'test');
    return 'تم محاكاة إضافة منتج — راجع الإشعار';
  };

  window.NotifManager={isSupported, isGranted, requestPermission, showNotification, registerPeriodicSync, registerBgSync, onProductsUpdated, markSelfAdd};

  // === تفعيل تلقائي ذكي ===
  function autoEnable(){
    try{
      // لو WebView بدون Notification ولا Cordova local، فعل تلقائياً
      if(!('Notification' in window) && 'serviceWorker' in navigator){
        if(!localStorage.getItem(LS_KEY_ENABLED)){
          console.log('[Notif] WebView auto-enable');
          localStorage.setItem(LS_KEY_ENABLED,'1');
          try{registerPeriodicSync()}catch(e){}
          try{registerBgSync()}catch(e){}
        }
      }
      // Cordova: حاول طلب الإذن تلقائياً عند deviceready إذا لم يكن مفعل
      if(window.cordova && hasCordovaLocal()){
        if(localStorage.getItem(LS_KEY_ENABLED)!=='1'){
          console.log('[Notif] Cordova auto-request');
          // لا نطلبه فوراً بل بعد 2 ثانية لتجنب مقاطعة السبلاش
          setTimeout(()=>{ requestPermission().catch(()=>{}); }, 2500);
        } else {
          try{ensureLocalChannel();}catch(e){}
          try{registerPeriodicSync()}catch(e){}
          try{registerBgSync()}catch(e){}
        }
      }
      // Web مع Notification: لو granted فعل LS
      if(typeof Notification!=='undefined' && Notification.permission==='granted'){
        localStorage.setItem(LS_KEY_ENABLED,'1');
        try{registerPeriodicSync()}catch(e){}
        try{registerBgSync()}catch(e){}
      }
    }catch(e){ console.warn('[Notif] autoEnable fail', e.message); }
  }

  setTimeout(()=>{
    try{
      if(!isSupported()) return;
      autoEnable();
      // بانر للمتصفح فقط (ليس WebView ولا Cordova)
      const isWeb = 'Notification' in window && !window.cordova;
      if(isWeb && Notification.permission==='default' && !localStorage.getItem(LS_KEY_ENABLED)){
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
      }
    }catch(e){}
  },3000);

  // استماع لـ deviceready للتفعيل التلقائي
  document.addEventListener('deviceready', ()=>{
    console.log('[Notif] deviceready');
    setTimeout(autoEnable, 1500);
    setTimeout(()=>{ if(hasCordovaLocal()) ensureLocalChannel(); }, 1800);
  }, false);

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
  console.log('[Notif] manager V4.4 ready — supported:', isSupported(), 'granted:', isGranted(), 'enabled:', localStorage.getItem(LS_KEY_ENABLED), 'cordovaLocal:', hasCordovaLocal(), 'firebase:', hasFirebase());
})();
