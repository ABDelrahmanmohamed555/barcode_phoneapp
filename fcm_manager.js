// fcm_manager.js — إدارة FCM Token + إرساله لـ Supabase (واتساب)
// يشتغل على Cordova (APK) عبر cordova-plugin-firebasex، وعلى PWA عبر Web Push كـ fallback

(function(){
  const TABLE_TOKENS = 'fcm_tokens'; // سيتم إنشاؤه في Supabase (المرحلة 4)

  function isCordova(){
    return !!(window.cordova && window.FirebasePlugin);
  }

  // حفظ التوكن في Supabase (upsert حسب التوكن)
  async function saveTokenToSupabase(token){
    if(!token) return;
    if(!window.SupabaseSync || !SupabaseSync.isConfigured()){
      console.warn('[FCM] Supabase غير مهيأ — تأجيل حفظ التوكن');
      return;
    }
    try{
      const cfg = SupabaseSync.getConfig();
      const deviceId = getDeviceId();
      const payload = {
        token: token,
        device_id: deviceId,
        platform: isCordova() ? 'android' : 'web',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
      // استخدم REST مباشرة (upsert على token)
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
      } else {
        const txt = await r.text();
        console.warn('[FCM] فشل حفظ التوكن', r.status, txt.slice(0,100));
        // لو الجدول مش موجود، خزّن محلياً وسيُرسل لاحقاً
        localStorage.setItem('fcm_token_pending', token);
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

  // طلب إذن الإشعارات + جلب التوكن (Cordova)
  async function initCordovaFCM(){
    if(!isCordova()){
      console.log('[FCM] ليس Cordova — تخطي FirebasePlugin');
      return false;
    }
    return new Promise((resolve)=>{
      try{
        // 1) طلب إذن
        window.FirebasePlugin.hasPermission((has)=>{
          if(has){
            fetchToken();
          } else {
            window.FirebasePlugin.grantPermission(()=>{
              console.log('[FCM] تم منح إذن الإشعارات');
              fetchToken();
            }, (err)=>{
              console.warn('[FCM] رفض الإذن', err);
              resolve(false);
            });
          }
        });

        function fetchToken(){
          // 2) جلب التوكن
          window.FirebasePlugin.getToken((token)=>{
            console.log('[FCM] token', token ? token.slice(0,20)+'...' : 'null');
            if(token) saveTokenToSupabase(token);
            resolve(!!token);
          }, (err)=>{
            console.warn('[FCM] getToken fail', err);
            resolve(false);
          });

          // 3) استمع لتحديث التوكن
          window.FirebasePlugin.onTokenRefresh((newToken)=>{
            console.log('[FCM] token refresh', newToken.slice(0,20)+'...');
            saveTokenToSupabase(newToken);
          }, (err)=> console.warn('[FCM] onTokenRefresh fail', err));

          // 4) استمع للإشعارات وهي في المقدمة
          window.FirebasePlugin.onMessageReceived((msg)=>{
            console.log('[FCM] message received', msg);
            try{
              const title = msg.title || msg.notification?.title || 'منتج جديد';
              const body = msg.body || msg.notification?.body || msg.name || 'تمت إضافة منتج جديد';
              // اعرض إشعار + حدّث المزامنة
              if(window.NotifManager) window.NotifManager.showNotification(title, body, 'fcm-'+Date.now());
              if(window.syncFromApi) window.syncFromApi({force:true});
              // Toast أيضاً
              try{ showToast(title+': '+body,'info',4000); }catch(e){}
            }catch(e){ console.warn('[FCM] onMessage fail', e); }
          }, (err)=> console.warn('[FCM] onMessageReceived fail', err));
        }
      }catch(e){
        console.warn('[FCM] init fail', e.message);
        resolve(false);
      }
    });
  }

  // للـ PWA (Web Push) — كـ fallback لو لم يكن Cordova
  async function initWebPush(){
    if(isCordova()) return; // Cordova يستخدم FirebasePlugin
    if(!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    // Web Push عبر FCM يتطلب VAPID — سيتم تفعيله بعد إعداد Firebase Web
    console.log('[FCM] Web Push سيتم تفعيله بعد إعداد VAPID (اختياري للـ PWA)');
  }

  // تهيئة عند deviceready أو DOMContentLoaded
  function init(){
    // حاول حفظ أي توكن معلق سابقاً
    const pending = localStorage.getItem('fcm_token_pending');
    if(pending){
      setTimeout(()=> saveTokenToSupabase(pending), 3000);
    }

    if(window.cordova){
      document.addEventListener('deviceready', ()=>{
        console.log('[FCM] deviceready');
        setTimeout(initCordovaFCM, 1500);
      }, false);
      // لو deviceready فات
      if(window.FirebasePlugin){
        setTimeout(initCordovaFCM, 2000);
      }
    } else {
      document.addEventListener('DOMContentLoaded', ()=>{
        setTimeout(initWebPush, 2000);
      });
    }
  }

  window.FCMManager = {
    init: initCordovaFCM,
    saveTokenToSupabase,
    isCordova,
    getDeviceId
  };

  // شغل تلقائياً
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  // أيضاً عند deviceready
  document.addEventListener('deviceready', init, false);

  console.log('[FCM] manager loaded');
})();
