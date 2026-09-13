// supabase_sync.js — نظام المزامنة الوحيد عبر Supabase — نسخة 4.0 نظيفة من الصفر
// مستوحى من prot/supabase_sync.py — نفس المنطق، نفس الجدول، نفس المفاتيح
// السحابة هي المصدر الوحيد — لا GitHub للمنتجات، لا localStorage للمنتجات
(function(){
  const KEY_URL = 'supabase_url';
  const KEY_KEY = 'supabase_key';
  const TABLE = 'products';
  // نفس إعدادات الديسكتوب prot/assets/supabase_config.json
  const DEFAULT_URL = 'https://vseycanfadblfmkevoqe.supabase.co';
  const DEFAULT_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZzZXljYW5mYWRibGZta2V2b3FlIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODk0Mzk4NywiZXhwIjoyMTA0NTE5OTg3fQ.XX6gBLx6t5exMwk0xqnOY8nMSZ00oHq9qdj2jdo223g';

  function getConfig(){
    try{
      const url = localStorage.getItem(KEY_URL);
      const key = localStorage.getItem(KEY_KEY);
      if(url && key && url.trim() && key.trim()){
        return {url: url.trim().replace(/\/+$/,''), key: key.trim()};
      }
    }catch(e){}
    return {url: DEFAULT_URL, key: DEFAULT_KEY};
  }

  function isConfigured(){
    const c=getConfig();
    return !!(c.url && c.key);
  }

  // —— fetch موحد مع retry
  async function supaFetch(path, opts={}){
    const cfg=getConfig();
    if(!cfg.url||!cfg.key) throw new Error('Supabase غير مهيأ');
    const headers={'apikey':cfg.key,'Authorization':'Bearer '+cfg.key,'Content-Type':'application/json','Prefer':'return=representation'};
    if(opts.headers){ Object.assign(headers,opts.headers); delete opts.headers; }
    const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),15000);
    try{
      const r=await fetch(`${cfg.url}/rest/v1/${path}`,{headers,signal:ctrl.signal,cache:'no-store',mode:'cors',...opts});
      clearTimeout(t);
      if(!r.ok){
        const txt=await r.text().catch(()=>r.statusText);
        if([502,503,504,429].includes(r.status)) throw new Error(`HTTP ${r.status} retryable: ${txt.slice(0,80)}`);
        throw new Error(`HTTP ${r.status}: ${txt.slice(0,120)}`);
      }
      return await r.json().catch(()=>null);
    }catch(e){
      clearTimeout(t);
      if(e.name==='AbortError') throw new Error('انتهت مهلة الاتصال (15s)');
      throw e;
    }
  }

  // —— المنتجات: السحابة فقط
  async function getProducts(){
    let lastErr=null;
    for(let i=0;i<3;i++){
      try{
        const data=await supaFetch(`${TABLE}?select=*&order=id.desc`);
        return Array.isArray(data)?data:[];
      }catch(e){
        lastErr=e;
        const m=e.message||'';
        const retryable=m.includes('retryable')||m.includes('Failed to fetch')||m.includes('NetworkError')||m.includes('15s')||m.includes('مهلة');
        if(retryable && i<2){ await new Promise(r=>setTimeout(r,800*(i+1))); continue; }
        throw e;
      }
    }
    throw lastErr;
  }

  async function addProduct(prod){
    if(!prod.id) prod.id = Date.now()+Math.floor(Math.random()*10000);
    // upsert بالباركود هو الأساس (مثل prot/supabase_sync.py push_product)
    for(let attempt=0; attempt<2; attempt++){
      try{
        const cfg=getConfig();
        const headers={'apikey':cfg.key,'Authorization':'Bearer '+cfg.key,'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=representation'};
        const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),10000);
        const r=await fetch(`${cfg.url}/rest/v1/${TABLE}?on_conflict=barcode`,{method:'POST',headers,body:JSON.stringify(prod),signal:ctrl.signal,cache:'no-store',mode:'cors'});
        clearTimeout(t);
        if(r.ok){ const d=await r.json().catch(()=>null); return d&&d[0]?d[0]:null; }
        const txt=await r.text().catch(()=>r.statusText);
        if([502,503,504,429].includes(r.status)) throw new Error(`HTTP ${r.status} retryable`);
        throw new Error(txt||`HTTP ${r.status}`);
      }catch(e){
        const retryable=e.message.includes('retryable')||e.message.includes('Failed to fetch')||e.name==='AbortError';
        if(retryable && attempt===0){ await new Promise(r=>setTimeout(r,900)); continue; }
        if(attempt===1){
          try{ const d=await supaFetch(TABLE,{method:'POST',body:JSON.stringify(prod)}); return d&&d[0]?d[0]:null; }catch(e2){ throw e2; }
        }
        throw e;
      }
    }
  }

  async function updateProduct(id, patch){
    // جرب بالـ id ثم بالـ barcode (مثل prot)
    for(let a=0;a<2;a++){
      try{
        const d=await supaFetch(`${TABLE}?id=eq.${id}`,{method:'PATCH',body:JSON.stringify(patch)});
        if(d&&d[0]) return d[0];
        break;
      }catch(e){
        const retryable=e.message.includes('retryable')||e.message.includes('Failed to fetch');
        if(retryable && a===0){ await new Promise(r=>setTimeout(r,700)); continue; }
        break;
      }
    }
    if(patch.barcode){
      for(let a=0;a<2;a++){
        try{
          const d=await supaFetch(`${TABLE}?barcode=eq.${encodeURIComponent(patch.barcode)}`,{method:'PATCH',body:JSON.stringify(patch)});
          return d&&d[0]?d[0]:null;
        }catch(e){
          const retryable=e.message.includes('retryable');
          if(retryable && a===0){ await new Promise(r=>setTimeout(r,700)); continue; }
          break;
        }
      }
      // تأكيد: جلب بعد التحديث
      try{ const all=await getProducts(); return all.find(x=>x.barcode===patch.barcode)||null; }catch(e){}
    }
    return null;
  }

  async function deleteProduct(id, barcode){
    if(barcode){
      try{ await supaFetch(`${TABLE}?barcode=eq.${encodeURIComponent(barcode)}`,{method:'DELETE'}); }catch(e){}
    }
    try{ await supaFetch(`${TABLE}?id=eq.${id}`,{method:'DELETE'}); }catch(e){}
    return true;
  }

  // —— Realtime WebSocket — مبسط وموثوق (مثل prot/realtime_sync.py pull)
  let _ws=null, _wsTimer=null, _wsRetry=1000, _onChange=null, _enabled=false, _hb=null, _openT=null;
  function _alive(){ return _ws && _ws.readyState===1; }
  function _connecting(){ return _ws && _ws.readyState===0; }
  function _clearTimers(){ if(_hb){clearInterval(_hb);_hb=null;} if(_openT){clearTimeout(_openT);_openT=null;} }
  function _connect(onChange){
    const cfg=getConfig(); if(!cfg||!onChange) return false;
    if(_alive()) return true;
    if(_connecting()) return true;
    if(_wsTimer){clearTimeout(_wsTimer);_wsTimer=null;}
    _clearTimers(); _onChange=onChange; _enabled=true;
    const wsUrl=cfg.url.replace(/^http/,'ws')+'/realtime/v1/websocket?apikey='+encodeURIComponent(cfg.key)+'&vsn=1.0.0';
    try{
      const ws=new WebSocket(wsUrl); _ws=ws;
      _openT=setTimeout(()=>{ if(ws.readyState!==1) try{ws.close();}catch(e){} },8000);
      ws.onopen=()=>{
        _wsRetry=1000; if(_openT){clearTimeout(_openT);_openT=null;}
        _hb=setInterval(()=>{ try{ws.send(JSON.stringify({topic:"phoenix",event:"heartbeat",payload:{},ref:"1"}));}catch(e){} },25000);
        ws.send(JSON.stringify({topic:`realtime:${TABLE}`,event:"phx_join",payload:{config:{broadcast:{ack:false,self:false},presence:{enabled:false},postgres_changes:[{event:"*",schema:"public",table:TABLE}] }},ref:"2"}));
        try{ ws.send(JSON.stringify({topic:`realtime:public:${TABLE}`,event:"phx_join",payload:{config:{postgres_changes:[{event:"*",schema:"public",table:TABLE}]}},ref:"3"})); }catch(e){}
        console.log('[Supabase RT] connected ✓');
      };
      ws.onmessage=(ev)=>{
        try{
          const msg=JSON.parse(ev.data);
          let evType=msg.payload?.data?.eventType||msg.payload?.eventType||msg.payload?.type||msg.event||null;
          if(!evType && msg.event && ["INSERT","UPDATE","DELETE"].includes(msg.event)) evType=msg.event;
          if(evType){
            console.log('[Supabase RT] change',evType);
            getProducts().then(d=>{ try{_onChange(d);}catch(e){} }).catch(()=>{});
            return;
          }
          if(msg.topic&&msg.topic.includes(TABLE)&&msg.payload&&(msg.payload.record||msg.payload.new||msg.payload.old||msg.payload.data)){
            getProducts().then(d=>{ try{_onChange(d);}catch(e){} }).catch(()=>{});
          }
        }catch(e){}
      };
      ws.onerror=()=>{};
      ws.onclose=()=>{
        _clearTimers(); if(_ws===ws) _ws=null;
        if(_enabled&&_onChange){
          if(_wsTimer) clearTimeout(_wsTimer);
          _wsTimer=setTimeout(()=>{ _wsRetry=Math.min(_wsRetry*1.8,15000); _connect(_onChange); },_wsRetry);
        }
      };
      return true;
    }catch(e){
      _clearTimers();
      if(_enabled&&_onChange){ if(_wsTimer) clearTimeout(_wsTimer); _wsTimer=setTimeout(()=>{ _wsRetry=Math.min(_wsRetry*1.8,15000); _connect(_onChange); },_wsRetry); }
      return false;
    }
  }
  function subscribeRealtime(onChange){ _enabled=true; _onChange=onChange; _connect(onChange); return true; }
  function unsubscribeRealtime(){ _enabled=false; _onChange=null; _clearTimers(); if(_wsTimer){clearTimeout(_wsTimer);_wsTimer=null;} if(_ws){try{_ws.close();}catch(e){} _ws=null;} _wsRetry=1000; }
  function isRealtimeConnected(){ return _alive(); }
  function forceRealtimeReconnect(){ if(_ws){try{_ws.close();}catch(e){} _ws=null;} _clearTimers(); if(_wsTimer){clearTimeout(_wsTimer);_wsTimer=null;} _wsRetry=1000; if(_enabled&&_onChange) setTimeout(()=>_connect(_onChange),500); }

  window.SupabaseSync={
    getConfig, isConfigured, getProducts, addProduct, updateProduct, deleteProduct,
    subscribeRealtime, unsubscribeRealtime, isRealtimeConnected, forceRealtimeReconnect,
    test: async()=>{ try{ const p=await getProducts(); return `✓ متصل — ${p.length} منتج`; }catch(e){ return `✗ فشل: ${e.message}`; } }
  };
})();
