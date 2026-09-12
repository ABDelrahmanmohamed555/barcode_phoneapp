// supabase_sync.js — حل جذري لمزامنة المنتجات لحظياً عبر الإنترنت
// يستخدم Supabase (Postgres + Realtime) — مجاني، سريع، لا يحتاج سيرفر
// أنشئ مشروع على supabase.com → انسخ URL و anon key → ضعهما في الإعدادات
// التحديث الجديد: يدعم Realtime WebSocket لحظياً + polling fallback كل 3 ثواني
(function(){
  const KEY_URL = 'supabase_url';
  const KEY_KEY = 'supabase_key';
  const TABLE = 'products';

  // القاعدة الموحدة — كل التطبيقين يشاركان نفس Supabase (service_role للوصول الكامل)
  // ملاحظة: المفتاح الحالي هو service_role (آمن للاستخدام الداخلي فقط)
  const DEFAULT_URL = 'https://vseycanfadblfmkevoqe.supabase.co';
  const DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzZXljYW5mYWRibGZta2V2b3FlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODk0Mzk4NywiZXhwIjoyMTA0NTE5OTg3fQ.XX6gBLx6t5exMwk0xqnOY8nMSZ00oHq9qdj2jdo223g';
  function getConfig(){
    try{
      const url = localStorage.getItem(KEY_URL);
      const key = localStorage.getItem(KEY_KEY);
      if(url && key && url.trim() && key.trim()){
        // تجاهل القيم الفارغة أو القديمة
        const u = url.trim().replace(/\/+$/,'');
        const k = key.trim();
        if(u && k){
          // لو كان المخزن لمشروع قديم غير موجود، استخدم الافتراضي
          if(u.includes('zvbdfkdhradhkqdywcal')) return {url: DEFAULT_URL, key: DEFAULT_KEY};
          return {url: u, key: k};
        }
      }
    }catch(e){}
    return {url: DEFAULT_URL, key: DEFAULT_KEY};
  }

  function setConfig(url, key){
    try{
      if(url) localStorage.setItem(KEY_URL, url.trim());
      else localStorage.removeItem(KEY_URL);
      if(key) localStorage.setItem(KEY_KEY, key.trim());
      else localStorage.removeItem(KEY_KEY);
    }catch(e){}
  }

  async function supaFetch(path, opts={}){
    const cfg = getConfig();
    if(!cfg) throw new Error('Supabase not configured');
    const headers = {
      'apikey': cfg.key,
      'Authorization': `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
    const ctrl = new AbortController();
    const t = setTimeout(()=> ctrl.abort(), 8000);
    try{
      const r = await fetch(`${cfg.url}/rest/v1/${path}`, {headers, signal: ctrl.signal, ...opts});
      clearTimeout(t);
      if(!r.ok) throw new Error(await r.text());
      const data = await r.json().catch(()=> null);
      return data;
    }catch(e){ clearTimeout(t); throw e; }
  }

  async function getProducts(){
    const data = await supaFetch(`${TABLE}?select=*&order=id.desc`);
    return Array.isArray(data) ? data : [];
  }

  async function addProduct(prod){
    // upsert بالـ barcode لمنع التكرار والرجوع — أي تعديل يدمج لا يستبدل
    try{
      const cfg = getConfig();
      if(!cfg) throw new Error('Supabase not configured');
      const headers = {
        'apikey': cfg.key,
        'Authorization': `Bearer ${cfg.key}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates,return=representation'
      };
      const ctrl = new AbortController(); const t=setTimeout(()=>ctrl.abort(), 8000);
      const r = await fetch(`${cfg.url}/rest/v1/${TABLE}?on_conflict=barcode`, {method:'POST', headers, body: JSON.stringify(prod), signal: ctrl.signal});
      clearTimeout(t);
      if(r.ok){
        const data = await r.json().catch(()=>null);
        return data && data[0] ? data[0] : null;
      }
      throw new Error(await r.text());
    }catch(e){
      // fallback عادي
      const data = await supaFetch(TABLE, {method:'POST', body: JSON.stringify(prod)});
      return data && data[0] ? data[0] : null;
    }
  }

  async function updateProduct(id, patch){
    // حاول التحديث بالـ id، ولو فشل جرب بالـ barcode
    try{
      const data = await supaFetch(`${TABLE}?id=eq.${id}`, {method:'PATCH', body: JSON.stringify(patch)});
      if(data && data[0]) return data[0];
    }catch(e){}
    // fallback بالـ barcode لو متاح في patch
    if(patch.barcode){
      try{
        const data = await supaFetch(`${TABLE}?barcode=eq.${encodeURIComponent(patch.barcode)}`, {method:'PATCH', body: JSON.stringify(patch)});
        return data && data[0] ? data[0] : null;
      }catch(e){}
    }
    return null;
  }

  async function deleteProduct(id, barcode){
    // حذف بالـ id ثم بالـ barcode للتأكد (id قد يختلف بين SQLite و Supabase)
    try{
      await supaFetch(`${TABLE}?id=eq.${id}`, {method:'DELETE'});
    }catch(e){}
    if(barcode){
      try{
        await supaFetch(`${TABLE}?barcode=eq.${encodeURIComponent(barcode)}`, {method:'DELETE'});
      }catch(e){}
    }
    return true;
  }

  // ========== Realtime WebSocket ==========
  let _ws = null;
  let _wsTimer = null;
  let _wsRetry = 1000;
  let _onChange = null;
  let _enabled = false;

  function _connectRealtime(onChange){
    const cfg = getConfig();
    if(!cfg || !onChange) return false;
    if(_ws && _ws.readyState === 1) return true;
    _onChange = onChange;
    _enabled = true;
    const wsUrl = cfg.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(cfg.key) + '&vsn=1.0.0';
    try{
      console.log('[Supabase] Realtime connecting', wsUrl.slice(0,60));
      const ws = new WebSocket(wsUrl);
      _ws = ws;
      let heartbeat = null;
      ws.onopen = ()=>{
        console.log('[Supabase] Realtime connected ✓');
        _wsRetry = 1000;
        // heartbeat every 25s
        heartbeat = setInterval(()=>{
          try{ ws.send(JSON.stringify({topic:"phoenix", event:"heartbeat", payload:{}, ref:"1"})); }catch(e){}
        }, 25000);
        // join channel
        const joinPayload = {
          topic: `realtime:${TABLE}`,
          event: "phx_join",
          payload: {
            config: {
              broadcast:{ack:false,self:false},
              presence:{enabled:false},
              postgres_changes:[{event:"*", schema:"public", table:TABLE}]
            }
          },
          ref:"2"
        };
        ws.send(JSON.stringify(joinPayload));
        // also try legacy channel
        const legacy = {
          topic: `realtime:public:${TABLE}`,
          event: "phx_join",
          payload: {config:{postgres_changes:[{event:"*", schema:"public", table:TABLE}]}},
          ref:"3"
        };
        try{ ws.send(JSON.stringify(legacy)); }catch(e){}
      };
      ws.onmessage = (ev)=>{
        try{
          const msg = JSON.parse(ev.data);
          // console.log('[Supabase RT raw]', JSON.stringify(msg).slice(0,300));
          let eventType = null;
          let payloadData = null;
          // Supabase الجديد يرسل payload.data.eventType
          if(msg.payload && msg.payload.data && msg.payload.data.eventType){
            eventType = msg.payload.data.eventType;
            payloadData = msg.payload.data;
          } else if(msg.payload && msg.payload.eventType){
            eventType = msg.payload.eventType;
            payloadData = msg.payload;
          } else if(msg.payload && msg.payload.type){
            eventType = msg.payload.type;
            payloadData = msg.payload;
          } else if(msg.event === "postgres_changes"){
            // قد يكون الحدث مباشرة في msg.event
            eventType = "postgres_changes";
          }
          // أيضاً تحقق من msg.event نفسه INSERT/UPDATE/DELETE
          if(!eventType && msg.event && ["INSERT","UPDATE","DELETE"].includes(msg.event)){
            eventType = msg.event;
          }
          if(eventType){
            console.log('[Supabase RT] change', eventType, payloadData ? (payloadData.table || TABLE) : '');
            // لأي تغيير (INSERT/UPDATE/DELETE) اطلب تحديث كامل — يضمن معالجة DELETE موثوقة
            getProducts().then(data=>{ try{ _onChange(data); }catch(e){} }).catch(()=>{});
            return;
          }
          // fallback: أي رسالة على قناة الجدول → حدث
          if(msg.topic && msg.topic.includes(TABLE) && msg.payload){
            if(msg.payload.record || msg.payload.new || msg.payload.old || msg.payload.data){
              console.log('[Supabase RT] fallback refresh');
              getProducts().then(data=>{ try{ _onChange(data); }catch(e){} }).catch(()=>{});
            }
          }
        }catch(e){ console.log('[Supabase RT] parse fail', e.message); }
      };
      ws.onerror = (e)=>{ console.log('[Supabase RT] error', e); };
      ws.onclose = ()=>{
        console.log('[Supabase RT] closed');
        if(heartbeat) clearInterval(heartbeat);
        _ws = null;
        if(_enabled){
          _wsTimer = setTimeout(()=>{
            _wsRetry = Math.min(_wsRetry*1.8, 15000);
            _connectRealtime(_onChange);
          }, _wsRetry);
        }
      };
      return true;
    }catch(e){
      console.log('[Supabase RT] connect fail', e.message);
      return false;
    }
  }

  function subscribeRealtime(onChange){
    // onChange = function(productsArray)
    if(!getConfig()) return false;
    _enabled = true;
    _onChange = onChange;
    _connectRealtime(onChange);
    // حافظ على polling كـ fallback كل 3 ثواني حتى لو RT شغال
    return true;
  }

  function unsubscribeRealtime(){
    _enabled = false;
    _onChange = null;
    if(_wsTimer) clearTimeout(_wsTimer);
    if(_ws){
      try{ _ws.close(); }catch(e){}
      _ws = null;
    }
  }

  // واجهة عامة
  window.SupabaseSync = {
    getConfig, setConfig,
    getProducts, addProduct, updateProduct, deleteProduct,
    isConfigured: ()=> !!getConfig(),
    subscribeRealtime, unsubscribeRealtime,
    // للاختبار
    test: async ()=>{
      try{
        const p = await getProducts();
        return `✓ متصل — ${p.length} منتج`;
      }catch(e){ return `✗ فشل: ${e.message}`; }
    }
  };

  // إعداد سريع عبر prompt
  window.setupSupabase = ()=>{
    const curUrl = localStorage.getItem(KEY_URL) || '';
    const curKey = localStorage.getItem(KEY_KEY) || '';
    const url = prompt('Supabase URL (https://xxx.supabase.co):', curUrl);
    if(url===null) return;
    const key = prompt('Supabase anon key:', curKey);
    if(key===null) return;
    setConfig(url, key);
    alert('✓ تم الحفظ — سيتم المزامنة عبر Supabase لحظياً');
    location.reload();
  };
  // واجهة لإظهار الحالة في الإعدادات
  window.getSupabaseStatus = ()=>{
    const c = getConfig();
    if(!c) return 'غير مهيأ';
    return c.url.replace('https://','').split('.')[0];
  };
})();
