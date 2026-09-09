// supabase_sync.js — حل جذري لمزامنة المنتجات لحظياً عبر الإنترنت
// يستخدم Supabase (Postgres + Realtime) — مجاني، سريع، لا يحتاج سيرفر
// أنشئ مشروع على supabase.com → انسخ URL و anon key → ضعهما في الإعدادات
(function(){
  const KEY_URL = 'supabase_url';
  const KEY_KEY = 'supabase_key';
  const TABLE = 'products';

  function getConfig(){
    try{
      const url = localStorage.getItem(KEY_URL);
      const key = localStorage.getItem(KEY_KEY);
      if(url && key) return {url: url.replace(/\/+$/,''), key};
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

  // واجهة عامة
  window.SupabaseSync = {
    getConfig, setConfig,
    getProducts, addProduct, updateProduct,
    isConfigured: ()=> !!getConfig(),
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
    alert('✓ تم الحفظ — سيتم المزامنة عبر Supabase');
    location.reload();
  };
})();
