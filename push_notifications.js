// push_notifications.js — معطل V4.7 — لا إشعارات، المزامنة فقط
(function(){
  window.NotifManager = {
    isSupported: ()=> false,
    isGranted: ()=> false,
    requestPermission: async ()=> false,
    showNotification: async ()=> false,
    registerPeriodicSync: async ()=> false,
    registerBgSync: async ()=> false,
    onProductsUpdated: ()=> {},
    markSelfAdd: ()=> {}
  };
  window.testNotif = ()=> 'الإشعارات معطلة V4.7';
  window.testNotifAdd = ()=> 'الإشعارات معطلة';
  console.log('[Notif] معطل V4.7 — المزامنة تعمل بدون إشعارات');
})();
