// fcm_manager.js — إدارة FCM Token + إرساله لـ Supabase — V4.4 مُصلح
// يدعم Cordova (APK) عبر cordova-plugin-firebasex، و PWA عبر Web Push كـ fallback
// V4.4: fallback لـ local notification عند غياب FirebasePlugin + إنشاء قناة موحدة + تسجيل تلقائي
(function(){
  const TABLE_TOKENS = 'fcm_tokens';

  function isCordova(){
    return !!(window.cordova && window.FirebasePlugin);
  }
  function hasCordovaLocal(){
    return !!(window.cordova && window.cordova.plugins && window.cordova.plugins.notification && window.cordova.plugins.notification.local);
  }
  function isAnyCordova(){
    return !!(window.cordova);
  }

  async function saveTokenToSupabase(token){
    if(!token) return;
    let tries=0;
    while((!window.SupabaseSync || !SupabaseSync.isConfigured()) && tries<8){
      await new Promise(r=>setTimeout(r, 800));
      tries++;
    }
    if(!window.SupabaseSync || !SupabaseSync.isConfigured()){
      console.warn('[FCM] Supabase غير مهيأ — تأجيل حفظ التوكن');
      localStorage.setItem('fcm_token_pending', token);
      return;
    }
    try{
      const cfg = SupabaseSync.getConfig();
      const deviceId = getDeviceId();
      const payload = {
        token: token,
        device_id: deviceId,
        platform: isCordova() ? 'android-fcm' : (hasCordovaLocal() ? 'android-local' : 'web'),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      const r = await fetch(`${cfg.url}/rest/v1/${TABLE_TOKENS}?on_conflict=token`, {
        method: 'POST',
        headers: {
          'apikey': cfg.key,
          'Authorization': `Bearer ${cfg.key}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=representation'
        },
        body: JSON.stringify(payload)
      });
      if(r.ok){
        console.log('[FCM] تم حفظ التوكن في Supabase ✓', token.slice(0,20)+'...');
        localStorage.setItem('fcm_token', token);
        localStorage.setItem('fcm_saved', '1');
        localStorage.removeItem('fcm_token_pending');
      } else {
        const txt = await r.text().catch(()=> '');
        console.warn('[FCM] فشل حفظ التوكن', r.status, txt.slice(0,120));
        localStorage.setItem('fcm_token_pending', token);
        if(txt.includes('Could not find') || txt.includes('PGRST')){
          console.warn('[FCM] تأكد من تنفيذ supabase_fcm_setup.sql في Supabase');
        }
      }
    }catch(e){
      console.warn('[FCM] save fail', e.message);
      localStorage.setItem('fcm_token_pending', token);
    }
  }

  function getDeviceId(){
    let id = localStorage.getItem('device_id');
    if(!id){
      id = 'dev_' + Date.now() + '_' + Math.floor(Math.random()*1e9);
      localStorage.setItem('device_id', id);
    }
    return id;
  }

  async function ensureAndroidChannel(){
    // حاول FirebasePlugin أولاً
    if(isCordova()){
      try{
        if(window.FirebasePlugin.createChannel){
          window.FirebasePlugin.createChannel({
            id: "nahal-products",
            name: "منتجات النحال",
            description: "إشعارات المنتجات الجديدة والتحديثات",
            importance: 4,
            visibility: 1,
            sound: "default",
            vibration: true,
            lights: true,
            lightColor: "#c8943a"
          }, ()=> console.log('[FCM] Firebase channel created'), (e)=> console.warn('[FCM] Firebase channel fail', e));
        }
      }catch(e){ console.warn('[FCM] Firebase channel err', e.message); }
    }
    // وحاول local notification channel
    if(hasCordovaLocal()){
      try{
        const local = window.cordova.plugins.notification.local;
        if(local.createChannel){
          local.createChannel({
            id: 'nahal-products',
            name: 'منتجات النحال',
            description: 'إشعارات المنتجات الجديدة',
            importance: 4,
            visibility: 1,
            sound: 'default',
            vibration: true
          });
          console.log('[FCM] Local channel created');
        }
      }catch(e){ console.warn('[FCM] Local channel err', e.message); }
    }
  }

  // fallback: لو لا يوجد FirebasePlugin لكن يوجد Cordova، استخدم local notification كبديل
  // وأيضاً ولّد توكن وهمي للتمييز (device_id) وحاول حفظه
  async function initCordovaFallback(){
    if(!isAnyCordova()) return false;
    if(isCordova()) return initCordovaFCM(); // Firebase موجود
    // لا يوجد Firebase — استخدم local notification فقط
    console.log('[FCM] FirebasePlugin غير موجود — استخدام local notification fallback');
    await ensureAndroidChannel();
    // اطلب إذن local notification
    if(hasCordovaLocal()){
      try{
        const local = window.cordova.plugins.notification.local;
        local.hasPermission((granted)=>{
          if(!granted){
            local.requestPermission((g2)=>{
              console.log('[FCM] local permission', g2);
              if(g2) localStorage.setItem('notif_enabled','1');
            });
          } else {
            localStorage.setItem('notif_enabled','1');
          }
        });
      }catch(e){}
    }
    // ولّد توكن وهمي للسجل (ليس FCM حقيقي لكن يفيد في التتبع)
    try{
      const fakeToken = 'local_' + getDeviceId() + '_' + Date.now();
      // لا نحفظه في fcm_tokens لأنه ليس FCM، لكن نحفظ device_id فقط للتمييز
      console.log('[FCM] local mode — device', getDeviceId());
    }catch(e){}
    return true;
  }

  async function initCordovaFCM(){
    if(!isCordova()){
      console.log('[FCM] ليس Cordova FirebasePlugin — fallback local');
      return initCordovaFallback();
    }
    await ensureAndroidChannel();
    return new Promise((resolve)=>{
      try{
        window.FirebasePlugin.hasPermission((has)=>{
          if(has){
            fetchToken();
          } else {
            window.FirebasePlugin.grantPermission(()=>{
              console.log('[FCM] تم منح إذن الإشعارات');
              fetchToken();
            }, (err)=>{
              console.warn('[FCM] رفض الإذن', err);
              // حتى لو رفض، حاول fallback local
              initCordovaFallback().then(()=> resolve(false));
            });
          }
        });

        function fetchToken(){
          window.FirebasePlugin.getToken((token)=>{
            console.log('[FCM] token', token ? token.slice(0,20)+'...' : 'null');
            if(token) saveTokenToSupabase(token);
            resolve(!!token);
          }, (err)=>{
            console.warn('[FCM] getToken fail', err);
            resolve(false);
          });

          try{
            window.FirebasePlugin.onTokenRefresh((newToken)=>{
              console.log('[FCM] token refresh', newToken.slice(0,20)+'...');
              saveTokenToSupabase(newToken);
            }, (err)=> console.warn('[FCM] onTokenRefresh fail', err));
          }catch(e){}

          try{
            window.FirebasePlugin.onMessageReceived((msg)=>{
              console.log('[FCM] message received', msg);
              try{
                const title = msg.title || msg.notification?.title || msg.name || 'منتج جديد';
                const body = msg.body || msg.notification?.body || msg.description || 'تمت إضافة منتج جديد';
                if(window.NotifManager) window.NotifManager.showNotification(title, body, 'fcm-'+Date.now());
                else if(navigator.serviceWorker && navigator.serviceWorker.controller){
                  navigator.serviceWorker.controller.postMessage({type:'SHOW_NOTIFICATION', title, body, tag:'fcm-'+Date.now()});
                }
                if(window.syncFromApi) window.syncFromApi({force:true});
                else if(window.SupabaseSync) window.SupabaseSync.getProducts().catch(()=>{});
                try{ if(window.showToast) showToast(title+': '+body,'info',4000); }catch(e){}
              }catch(e){ console.warn('[FCM] onMessage fail', e); }
            }, (err)=> console.warn('[FCM] onMessageReceived fail', err));
          }catch(e){ console.warn('[FCM] onMessage setup fail', e.message); }
        }
      }catch(e){
        console.warn('[FCM] init fail', e.message);
        resolve(false);
      }
    });
  }

  async function initWebPush(){
    if(isCordova() || hasCordovaLocal()) return;
    if(!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    console.log('[FCM] Web Push ready — سيتم استخدام الإشعارات المحلية + PeriodicSync كبديل');
  }

  function init(){
    const pending = localStorage.getItem('fcm_token_pending');
    if(pending){
      setTimeout(()=> saveTokenToSupabase(pending), 2500);
      setInterval(()=>{ const p=localStorage.getItem('fcm_token_pending'); if(p) saveTokenToSupabase(p); }, 30000);
    }
    if(window.cordova){
      document.addEventListener('deviceready', ()=>{
        console.log('[FCM] deviceready');
        setTimeout(()=>{
          if(isCordova()) initCordovaFCM();
          else initCordovaFallback();
        }, 1200);
      }, false);
      if(window.FirebasePlugin){
        setTimeout(()=> initCordovaFCM(), 2000);
      } else {
        // fallback بعد 2 ث
        setTimeout(()=> initCordovaFallback(), 2000);
      }
      setTimeout(()=>{
        if(isCordova()) initCordovaFCM().catch(()=>{});
        else initCordovaFallback().catch(()=>{});
      }, 5000);
    } else {
      if(document.readyState==='loading'){
        document.addEventListener('DOMContentLoaded', ()=> setTimeout(initWebPush, 1500));
      } else setTimeout(initWebPush, 1500);
    }
  }

  window.FCMManager = {
    init: isCordova() ? initCordovaFCM : initCordovaFallback,
    initCordovaFCM,
    initCordovaFallback,
    saveTokenToSupabase,
    isCordova,
    hasCordovaLocal,
    isAnyCordova,
    getDeviceId,
    ensureAndroidChannel
  };

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  document.addEventListener('deviceready', init, false);

  console.log('[FCM] manager V4.4 loaded — cordova:', isAnyCordova(), 'firebase:', isCordova(), 'local:', hasCordovaLocal());
})();
