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
        const u = url.trim().replace(/\/+$/,'');
        const k = key.trim();
        if(u && k) return {url: u, key: k};
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
    if(!cfg || !cfg.url || !cfg.key) throw new Error('Supabase not configured');
    const headers = {
      'apikey': cfg.key,
      'Authorization': `Bearer ${cfg.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };
    // ادمج هيدرز opts إن وجدت (لتحديث Prefer مثلاً)
    if(opts.headers){
      Object.assign(headers, opts.headers);
      delete opts.headers;
    }
    const ctrl = new AbortController();
    const t = setTimeout(()=> ctrl.abort(), 15000); // زيادة ل 15s لتجنب الفشل المتقطع على الشبكات البطيئة
    try{
      const r = await fetch(`${cfg.url}/rest/v1/${path}`, {
        headers,
        signal: ctrl.signal,
        mode: 'cors',
        cache: 'no-store',
        ...opts
      });
      clearTimeout(t);
      if(!r.ok){
        const txt = await r.text().catch(()=> r.statusText);
        // 503/429/502 هي أخطاء عابرة قابلة لإعادة المحاولة
        if(r.status===503 || r.status===429 || r.status===502 || r.status===504){
          throw new Error(`HTTP ${r.status} retryable: ${txt.slice(0,80)}`);
        }
        throw new Error(`HTTP ${r.status}: ${txt.slice(0,120)}`);
      }
      const data = await r.json().catch(()=> null);
      return data;
    }catch(e){
      clearTimeout(t);
      if(e.name==='AbortError') throw new Error('انتهت مهلة الاتصال (15s) - تحقق من الإنترنت');
      throw e;
    }
  }

  async function getProducts(){
    // retry داخلي مرتين مع backoff لتغطية الفشل العابر (شبكة/503/timeout)
    let lastErr = null;
    for(let attempt=0; attempt<3; attempt++){
      try{
        const data = await supaFetch(`${TABLE}?select=*&order=id.desc`);
        return Array.isArray(data) ? data : [];
      }catch(e){
        lastErr = e;
        const msg = e.message || '';
        const retryable = msg.includes('مهلة') || msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('retryable') || msg.includes('15s') || msg.includes('503') || msg.includes('429') || msg.includes('502');
        if(retryable && attempt < 2){
          const wait = 800 * (attempt+1);
          console.warn(`[Supabase] getProducts retry ${attempt+1}/2 بعد ${wait}ms — ${msg.slice(0,60)}`);
          await new Promise(r=> setTimeout(r, wait));
          continue;
        }
        throw e;
      }
    }
    throw lastErr;
  }

  async function addProduct(prod){
    // upsert بالـ barcode لمنع التكرار والرجوع — أي تعديل يدمج لا يستبدل
    // توليد id إذا غير موجود (Supabase يتطلب id ليس null)
    if(!prod.id){
      try{ prod.id = Date.now() + Math.floor(Math.random()*10000); }catch(e){ prod.id = Math.floor(Math.random()*1e9)+100000; }
    }
    // حاول upsert مع retry مرة واحدة عند الفشل العابر
    for(let attempt=0; attempt<2; attempt++){
      try{
        const cfg = getConfig();
        if(!cfg) throw new Error('Supabase not configured');
        const headers = {
          'apikey': cfg.key,
          'Authorization': `Bearer ${cfg.key}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=merge-duplicates,return=representation'
        };
        const ctrl = new AbortController(); const t=setTimeout(()=>ctrl.abort(), 10000);
        const r = await fetch(`${cfg.url}/rest/v1/${TABLE}?on_conflict=barcode`, {method:'POST', headers, body: JSON.stringify(prod), signal: ctrl.signal, cache:'no-store'});
        clearTimeout(t);
        if(r.ok){
          const data = await r.json().catch(()=>null);
          return data && data[0] ? data[0] : null;
        }
        const txt = await r.text().catch(()=> r.statusText);
        if(r.status===503 || r.status===429 || r.status===502){
          throw new Error(`HTTP ${r.status} retryable: ${txt.slice(0,60)}`);
        }
        throw new Error(txt || `HTTP ${r.status}`);
      }catch(e){
        const retryable = e.message.includes('retryable') || e.message.includes('Failed to fetch') || e.message.includes('NetworkError') || e.name==='AbortError';
        if(retryable && attempt===0){
          console.warn('[Supabase] addProduct retry 1/1 —', e.message.slice(0,60));
          await new Promise(r=> setTimeout(r, 900));
          continue;
        }
        // fallback عادي في المحاولة الأخيرة
        if(attempt===1){
          try{
            const data = await supaFetch(TABLE, {method:'POST', body: JSON.stringify(prod)});
            return data && data[0] ? data[0] : null;
          }catch(e2){ throw e2; }
        }
        throw e;
      }
    }
  }

  async function updateProduct(id, patch){
    // حاول التحديث بالـ id مع retry، ولو فشل جرب بالـ barcode
    for(let attempt=0; attempt<2; attempt++){
      try{
        const data = await supaFetch(`${TABLE}?id=eq.${id}`, {method:'PATCH', body: JSON.stringify(patch)});
        if(data && data[0]) return data[0];
        // لو رجع [] قد يكون id غير موجود — جرب barcode فوراً
        break;
      }catch(e){
        const retryable = e.message.includes('retryable') || e.message.includes('Failed to fetch') || e.name==='AbortError';
        if(retryable && attempt===0){
          await new Promise(r=> setTimeout(r, 700));
          continue;
        }
        break;
      }
    }
    // fallback بالـ barcode لو متاح في patch
    if(patch.barcode){
      for(let attempt=0; attempt<2; attempt++){
        try{
          const data = await supaFetch(`${TABLE}?barcode=eq.${encodeURIComponent(patch.barcode)}`, {method:'PATCH', body: JSON.stringify(patch)});
          return data && data[0] ? data[0] : null;
        }catch(e){
          const retryable = e.message.includes('retryable') || e.message.includes('Failed to fetch') || e.name==='AbortError';
          if(retryable && attempt===0){
            await new Promise(r=> setTimeout(r, 700));
            continue;
          }
          break;
        }
      }
    }
    // آخر محاولة: جلب المنتج بعد التحديث للتأكد (قد يكون التحديث نجح لكن لم يرجع representation)
    if(patch.barcode){
      try{
        const all = await getProducts();
        const found = all.find(x=> x.id===id || x.barcode===patch.barcode);
        if(found) return found;
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

  // ========== Realtime WebSocket — مُصلّح جذري (إعادة اتصال موثوقة + منع التعليق) ==========
  let _ws = null;
  let _wsTimer = null;
  let _wsRetry = 1000;
  let _onChange = null;
  let _enabled = false;
  let _heartbeatTimer = null;
  let _openTimeout = null;

  function _isWsAlive(){
    return _ws && _ws.readyState === 1; // OPEN
  }
  function _isWsConnecting(){
    return _ws && _ws.readyState === 0; // CONNECTING
  }
  function _clearRealtimeTimers(){
    if(_heartbeatTimer){ clearInterval(_heartbeatTimer); _heartbeatTimer=null; }
    if(_openTimeout){ clearTimeout(_openTimeout); _openTimeout=null; }
  }

  function _connectRealtime(onChange){
    const cfg = getConfig();
    if(!cfg || !onChange) return false;
    if(_isWsAlive()) return true;
    if(_isWsConnecting()){
      console.log('[Supabase] Realtime already connecting — skip');
      return true;
    }
    // نظف أي مؤقت سابق قبل إنشاء اتصال جديد
    if(_wsTimer){ clearTimeout(_wsTimer); _wsTimer=null; }
    _clearRealtimeTimers();
    _onChange = onChange;
    _enabled = true;
    const wsUrl = cfg.url.replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' + encodeURIComponent(cfg.key) + '&vsn=1.0.0';
    try{
      console.log('[Supabase] Realtime connecting', wsUrl.slice(0,60));
      const ws = new WebSocket(wsUrl);
      _ws = ws;
      // مهلة 8 ثواني لفتح الاتصال وإلا اعتبره فشل وأعد المحاولة
      _openTimeout = setTimeout(()=>{
        if(ws.readyState !== 1){
          console.warn('[Supabase RT] open timeout — closing');
          try{ ws.close(); }catch(e){}
        }
      }, 8000);
      ws.onopen = ()=>{
        console.log('[Supabase] Realtime connected ✓');
        _wsRetry = 1000;
        if(_openTimeout){ clearTimeout(_openTimeout); _openTimeout=null; }
        // heartbeat every 25s
        _heartbeatTimer = setInterval(()=>{
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
      ws.onerror = (e)=>{
        console.log('[Supabase RT] error', e);
        // لا تغلق هنا — دع onclose يتكفل بإعادة المحاولة
      };
      ws.onclose = ()=>{
        console.log('[Supabase RT] closed, enabled=', _enabled, ' retry=', _wsRetry);
        _clearRealtimeTimers();
        // احذف المرجع فقط لو هو نفس الـ ws الحالي
        if(_ws === ws) _ws = null;
        if(_enabled && _onChange){
          if(_wsTimer) clearTimeout(_wsTimer);
          _wsTimer = setTimeout(()=>{
            _wsRetry = Math.min(_wsRetry*1.8, 15000);
            console.log('[Supabase RT] reconnect in', _wsRetry);
            _connectRealtime(_onChange);
          }, _wsRetry);
        }
      };
      return true;
    }catch(e){
      console.log('[Supabase RT] connect fail', e.message);
      _clearRealtimeTimers();
      // جدولة إعادة محاولة حتى لو فشل الإنشاء
      if(_enabled && _onChange){
        if(_wsTimer) clearTimeout(_wsTimer);
        _wsTimer = setTimeout(()=>{
          _wsRetry = Math.min(_wsRetry*1.8, 15000);
          _connectRealtime(_onChange);
        }, _wsRetry);
      }
      return false;
    }
  }

  function subscribeRealtime(onChange){
    // onChange = function(productsArray)
    if(!getConfig()) return false;
    _enabled = true;
    _onChange = onChange;
    // اسمح بإعادة الاتصال حتى لو كان هناك محاولة معلقة — _connectRealtime سيتعامل معها
    _connectRealtime(onChange);
    return true;
  }

  function unsubscribeRealtime(){
    _enabled = false;
    _onChange = null;
    _clearRealtimeTimers();
    if(_wsTimer){ clearTimeout(_wsTimer); _wsTimer=null; }
    if(_ws){
      try{ _ws.close(); }catch(e){}
      _ws = null;
    }
    _wsRetry = 1000;
  }
  function isRealtimeConnected(){
    return _isWsAlive();
  }
  function forceRealtimeReconnect(){
    if(_ws){
      try{ _ws.close(); }catch(e){}
      _ws = null;
    }
    _clearRealtimeTimers();
    if(_wsTimer){ clearTimeout(_wsTimer); _wsTimer=null; }
    _wsRetry = 1000;
    if(_enabled && _onChange){
      setTimeout(()=> _connectRealtime(_onChange), 500);
    }
  }

  // واجهة عامة
  window.SupabaseSync = {
    getConfig, setConfig,
    getProducts, addProduct, updateProduct, deleteProduct,
    isConfigured: ()=> !!getConfig(),
    subscribeRealtime, unsubscribeRealtime, isRealtimeConnected, forceRealtimeReconnect,
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
