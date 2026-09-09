// supabase_sync.js — حل جذري لمزامنة المنتجات لحظياً عبر الإنترنت
// يستخدم Supabase (Postgres + Realtime) — مجاني، سريع، لا يحتاج سيرفر
// أنشئ مشروع على supabase.com → انسخ URL و anon key → ضعهما في الإعدادات
// التحديث الجديد: يدعم Realtime WebSocket لحظياً + polling fallback كل 3 ثواني
(function(){
  const KEY_URL = 'supabase_url';
  const KEY_KEY = 'supabase_key';
  const TABLE = 'products';

  function getConfig(){
    try{
      const url = localStorage.getItem(KEY_URL);
      const key = localStorage.getItem(KEY_KEY);
      if(url && key) return {url: url.replace(/\/+$/,''), key: key.trim()};
    }catch(e){}
    return null;
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
    const data = await supaFetch(TABLE, {method:'POST', body: JSON.stringify(prod)});
    return data && data[0] ? data[0] : null;
  }

  async function updateProduct(id, patch){
    const data = await supaFetch(`${TABLE}?id=eq.${id}`, {method:'PATCH', body: JSON.stringify(patch)});
    return data && data[0] ? data[0] : null;
  }

  async function deleteProduct(id){
    await supaFetch(`${TABLE}?id=eq.${id}`, {method:'DELETE'});
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
          // console.log('[Supabase RT]', msg);
          if(msg.event === "postgres_changes" || (msg.payload && msg.payload.type)){
            // fresh payload
            const p = msg.payload;
            if(p && (p.eventType || p.type)){
              console.log('[Supabase RT] change', p.eventType || p.type);
              // اطلب تحديث كامل
              getProducts().then(data=>{ try{ _onChange(data); }catch(e){} }).catch(()=>{});
            }
          }
          // also handle broadcast
          if(msg.topic && msg.topic.includes(TABLE) && msg.payload){
            if(msg.payload.record || msg.payload.new || msg.event==='INSERT' || msg.event==='UPDATE' || msg.event==='DELETE'){
              getProducts().then(data=>{ try{ _onChange(data); }catch(e){} }).catch(()=>{});
            }
          }
        }catch(e){}
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
