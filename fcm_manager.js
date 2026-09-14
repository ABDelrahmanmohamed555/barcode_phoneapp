// fcm_manager.js — معطل V4.7 — لا إشعارات، المزامنة فقط
(function(){
  window.FCMManager = {
    init: async ()=> false,
    saveTokenToSupabase: async ()=> {},
    isCordova: ()=> false,
    hasCordovaLocal: ()=> false,
    isAnyCordova: ()=> false,
    getDeviceId: ()=> localStorage.getItem('device_id')||'dev_disabled',
    ensureAndroidChannel: async ()=> {}
  };
  console.log('[FCM] معطل V4.7 — المزامنة تعمل بدون إشعارات');
})();
