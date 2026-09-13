// fcm_manager.js — إدارة FCM Token + إرساله لـ Supabase — مُصلح للعمل الدائم
// يدعم Cordova (APK) عبر cordova-plugin-firebasex، و PWA عبر Web Push كـ fallback
// يتضمن: قناة إشعارات أندرويد + إذن POST_NOTIFICATIONS + حفظ تلقائي + إعادة محاولة

(function(){
  const TABLE_TOKENS = 'fcm_tokens';

  function isCordova(){
    return !!(window.cordova && window.FirebasePlugin);
  }

  async function saveTokenToSupabase(token){
    if(!token) return;
    // انتظر SupabaseSync إن لم يكن جاهزاً
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
        platform: isCordova() ? 'android' : 'web',
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
        // لو الجدول غير موجود (PGRST205) اطبع تعليمات
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
    if(!isCordova()) return;
    try{
      // إنشاء قناة إشعارات أندرويد 8+ — ضرورية لظهور الإشعارات
      if(window.FirebasePlugin.createChannel){
        window.FirebasePlugin.createChannel({
          id: "nahal-products",
          name: "منتجات النحال",
          description: "إشعارات المنتجات الجديدة والتحديثات",
          importance: 4, // HIGH
          visibility: 1,
          sound: "default",
          vibration: true,
          lights: true,
          lightColor: "#c8943a"
        }, ()=> console.log('[FCM] channel created'), (e)=> console.warn('[FCM] channel fail', e));
      }
    }catch(e){ console.warn('[FCM] channel err', e.message); }
  }

  async function initCordovaFCM(){
    if(!isCordova()){
      console.log('[FCM] ليس Cordova — تخطي FirebasePlugin');
      return false;
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
              resolve(false);
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

          // تحديث التوكن
          try{
            window.FirebasePlugin.onTokenRefresh((newToken)=>{
              console.log('[FCM] token refresh', newToken.slice(0,20)+'...');
              saveTokenToSupabase(newToken);
            }, (err)=> console.warn('[FCM] onTokenRefresh fail', err));
          }catch(e){}

          // استقبال الرسائل في المقدمة
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
    if(isCordova()) return;
    if(!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    console.log('[FCM] Web Push ready — سيتم استخدام الإشعارات المحلية + PeriodicSync كبديل (FCM Web يحتاج VAPID)');
    // لا حاجة لـ VAPID حالياً — PWA يعتمد على periodicSync + SW autonomous
  }

  function init(){
    const pending = localStorage.getItem('fcm_token_pending');
    if(pending){
      setTimeout(()=> saveTokenToSupabase(pending), 2500);
      // حاول كل 30ث
      setInterval(()=>{ const p=localStorage.getItem('fcm_token_pending'); if(p) saveTokenToSupabase(p); }, 30000);
    }
    if(window.cordova){
      document.addEventListener('deviceready', ()=>{
        console.log('[FCM] deviceready');
        setTimeout(initCordovaFCM, 1200);
      }, false);
      if(window.FirebasePlugin){
        setTimeout(initCordovaFCM, 2000);
      }
      // أيضاً بعد 5ث كـ fallback
      setTimeout(()=>{ if(isCordova()) initCordovaFCM().catch(()=>{}); }, 5000);
    } else {
      if(document.readyState==='loading'){
        document.addEventListener('DOMContentLoaded', ()=> setTimeout(initWebPush, 1500));
      } else setTimeout(initWebPush, 1500);
    }
  }

  window.FCMManager = {
    init: initCordovaFCM,
    saveTokenToSupabase,
    isCordova,
    getDeviceId
  };

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
  document.addEventListener('deviceready', init, false);

  console.log('[FCM] manager loaded — cordova:', isCordova());
})();
