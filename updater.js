// updater.js — نظام التحديث الهوائي OTA لـ phone app
// يعمل في المتصفح و Cordova (file://) بدون الحاجة لإعادة بناء APK
// الفكرة: يفحص version.json من السيرفر، لو نسخة جديدة يحمل الملفات ويطبقها
(function(){
  const CURRENT_VERSION = "3.11"; // يجب أن يتطابق مع version.json — يُحدثه generate_update.py تلقائياً
  const STORAGE_KEY_VERSION = "ota_version";
  const STORAGE_KEY_IGNORE = "ota_ignore_version";
  const CHECK_INTERVAL_MS = 5 * 60 * 1000; // فحص كل 5 دقائق + عند كل فتح (كان ساعة)

  // حدد سيرفر التحديث — نفس API_BASE المستخدم في app.js
  function getApiBase(){
    try{
      const saved = localStorage.getItem('prot_api_base');
      if(saved) return saved.replace(/\/+$/,'');
      const host = location.hostname;
      if(!host || host==='') return 'http://127.0.0.1:5000';
      return `http://${host}:5000`;
    }catch(e){ return 'http://127.0.0.1:5000'; }
  }

  // --- اكتشاف تلقائي للسيرفر في الشبكة المحلية (بدون إدخال يدوي) ---
  let _discovering = false;
  let _discoveredBase = null;

  async function getLocalSubnetViaWebRTC(){
    // يحاول استخراج IP المحلي للموبايل عبر WebRTC ثم يستنتج الشبكة
    return new Promise(resolve=>{
      try{
        const pc = new RTCPeerConnection({iceServers:[]});
        pc.createDataChannel('');
        pc.createOffer().then(o=> pc.setLocalDescription(o)).catch(()=> resolve(null));
        let found = false;
        pc.onicecandidate = e=>{
          if(found) return;
          if(!e || !e.candidate || !e.candidate.candidate) return;
          const m = e.candidate.candidate.match(/(\d+\.\d+\.\d+)\.\d+/);
          if(m){
            found = true;
            try{ pc.close(); }catch(_){}
            resolve(m[1] + '.');
          }
        };
        setTimeout(()=> resolve(null), 1500);
      }catch(e){ resolve(null); }
    });
  }

  async function tryFetchBase(base, timeoutMs=900){
    const ctrl = new AbortController();
    const t = setTimeout(()=> ctrl.abort(), timeoutMs);
    try{
      const r = await fetch(base + '/api/app_version?_t=' + Date.now(), {cache:'no-store', signal: ctrl.signal});
      clearTimeout(t);
      if(!r.ok) return false;
      const j = await r.json();
      return !!j.version;
    }catch(e){ clearTimeout(t); return false; }
  }

  async function autoDiscoverServer(){
    if(_discovering) return _discoveredBase;
    const saved = (()=>{ try{ return localStorage.getItem('prot_api_base'); }catch(e){return null;} })();
    if(saved) return saved;
    // لو مفتوح عبر http (ليس file://) لا حاجة للبحث
    if(location.hostname && location.hostname!=='') return null;
    _discovering = true;
    console.log('[OTA] بدء البحث التلقائي عن السيرفر...');
    toast('جاري البحث التلقائي عن السيرفر...');
    // 1) حاول استنتاج الشبكة من WebRTC
    const subFromRTC = await getLocalSubnetViaWebRTC();
    const prefixes = [];
    if(subFromRTC) prefixes.push(subFromRTC);
    // 2) شبكات شائعة (الأكثر شيوعاً أولاً)
    const common = ['192.168.1.','192.168.0.','192.168.43.','192.168.137.','10.0.2.','10.42.0.','192.168.100.','192.168.8.','192.168.2.'];
    for(const c of common) if(!prefixes.includes(c)) prefixes.push(c);

    const concurrency = 20;
    for(const prefix of prefixes){
      console.log('[OTA] فحص الشبكة', prefix + 'x');
      // افحص الـ IP الأكثر احتمالاً أولاً (1, 15, 100, 42 ...)
      const priority = [1,15,100,42,101,102,2,10,20,30,50];
      const rest = [];
      for(let i=1;i<=254;i++) if(!priority.includes(i)) rest.push(i);
      const order = [...priority, ...rest];
      for(let start=0; start<order.length; start+=concurrency){
        const batch = order.slice(start, start+concurrency);
        const results = await Promise.all(batch.map(async ip=>{
          const base = `http://${prefix}${ip}:5000`;
          const ok = await tryFetchBase(base, 700);
          return ok ? base : null;
        }));
        const found = results.find(x=> x);
        if(found){
          console.log('[OTA] وجد السيرفر', found);
          try{ localStorage.setItem('prot_api_base', found); }catch(e){}
          _discoveredBase = found;
          _discovering = false;
          toast('تم العثور على السيرفر تلقائياً ✓');
          return found;
        }
      }
    }
    _discovering = false;
    console.log('[OTA] لم يتم العثور على سيرفر');
    return null;
  }
  function getRemoteOverride(){
    try{ return localStorage.getItem('ota_remote_url') || null; }catch(e){ return null; }
  }
  function setRemoteOverride(url){
    try{
      if(url) localStorage.setItem('ota_remote_url', url);
      else localStorage.removeItem('ota_remote_url');
    }catch(e){}
  }

  // روابط الفحص بالترتيب — أول واحد ينجح يُستخدم
  function getCheckUrls(){
    const api = getApiBase();
    const override = getRemoteOverride();
    const urls = [];
    if(override) urls.push(override.replace(/\/+$/,'') + '/version.json');
    urls.push(api + '/api/app_version');
    urls.push(api + '/version.json');
    urls.push('./version.json');
    // لو مفتوح عبر https (GitHub Pages مثلاً) جرب نفس الـ origin
    if(location.origin && location.origin !== 'null' && location.origin !== 'file://'){
      urls.push(location.origin + '/version.json');
    }
    // --- عبر الإنترنت (GitHub Raw) هو المصدر الوحيد عند انطفاء اللابتوب ---
    // (تمت إزالة روابط Cloudflare/Catbox القديمة المنتهية لتجنب التضارب)
    // --- عبر الإنترنت (GitHub Raw) — يعمل حتى لو اللابتوب مطفي (بعد push) ---
    const PUBLIC_RAW = 'https://raw.githubusercontent.com/ABDelrahmanmohamed555/barcode_phoneapp/main/version.json';
    urls.push(PUBLIC_RAW);
    urls.push(PUBLIC_RAW.replace('/version.json','/phone%20app/version.json'));
    return [...new Set(urls)];
  }

  function compareVersions(a,b){
    // ترجع 1 لو a>b, -1 لو a<b, 0 لو متساوي — تدعم 1.0.0 و "new" (يعتبر الأحدث)
    const sa = String(a).trim().toLowerCase();
    const sb = String(b).trim().toLowerCase();
    // "new" يعتبر أحدث من أي رقم
    if(sa==="new" && sb!=="new") return 1;
    if(sb==="new" && sa!=="new") return -1;
    if(sa==="new" && sb==="new") return 0;
    const pa = sa.split('.').map(x=>parseInt(x,10)||0);
    const pb = sb.split('.').map(x=>parseInt(x,10)||0);
    const len = Math.max(pa.length, pb.length);
    for(let i=0;i<len;i++){
      const av = pa[i]||0, bv = pb[i]||0;
      if(av > bv) return 1;
      if(av < bv) return -1;
    }
    return 0;
  }

  function getStoredVersion(){
    try{ return localStorage.getItem(STORAGE_KEY_VERSION) || CURRENT_VERSION; }catch(e){ return CURRENT_VERSION; }
  }
  function setStoredVersion(v){
    try{ localStorage.setItem(STORAGE_KEY_VERSION, v); }catch(e){}
  }

  // --- واجهة المستخدم (Banner) ---
  function ensureBanner(){
    if(document.getElementById('otaBanner')) return document.getElementById('otaBanner');
    const banner = document.createElement('div');
    banner.id = 'otaBanner';
    banner.style.cssText = 'display:none;position:fixed;top:48px;left:0;right:0;z-index:9998;background:#1c2333;border-bottom:2px solid #c8943a;padding:10px 12px;flex-direction:column;gap:8px;font-size:13px;';
    banner.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
        <span id="otaBannerText" style="color:#f5f0e3;flex:1">تحديث جديد متاح</span>
        <span id="otaBannerVer" style="color:#c8943a;font-weight:700;font-size:11px;border:1px solid #2d3543;padding:2px 6px;border-radius:4px;background:#0d1117"></span>
      </div>
      <div id="otaBannerNotes" style="color:#9e9e9e;font-size:11px;display:none"></div>
      <div style="display:flex;gap:8px">
        <button id="otaBtnUpdate" style="flex:1;height:36px;background:#2d8a4e;color:#fff;border:none;border-radius:6px;font-weight:700">⬇ تحديث الآن</button>
        <button id="otaBtnLater" style="flex:0 0 90px;height:36px;background:transparent;color:#9e9e9e;border:1px solid #2d3543;border-radius:6px">لاحقاً</button>
        <button id="otaBtnIgnore" style="flex:0 0 90px;height:36px;background:transparent;color:#c8943a;border:1px solid #2d3543;border-radius:6px">تجاهل</button>
      </div>
      <div id="otaProgress" style="display:none">
        <div style="height:4px;background:#1c2333;border-radius:2px;overflow:hidden"><div id="otaProgressBar" style="height:100%;width:0%;background:linear-gradient(90deg,#c8943a,#dbaa55);transition:width 0.3s"></div></div>
        <div id="otaProgressText" style="color:#9e9e9e;font-size:11px;text-align:center;margin-top:4px">جاري التحميل...</div>
      </div>
    `;
    document.body.appendChild(banner);
    document.getElementById('otaBtnLater').onclick = ()=>{ banner.style.display='none'; };
    document.getElementById('otaBtnIgnore').onclick = ()=>{
      try{ localStorage.setItem(STORAGE_KEY_IGNORE, banner.dataset.version||''); }catch(e){}
      banner.style.display='none';
    };
    return banner;
  }

  function showBanner(verData){
    const banner = ensureBanner();
    const ver = verData.version || 'جديد';
    banner.dataset.version = ver;
    document.getElementById('otaBannerVer').textContent = 'v' + ver;
    const notes = verData.notes || (verData.changelog && verData.changelog[0]) || '';
    const notesEl = document.getElementById('otaBannerNotes');
    if(notes){ notesEl.textContent = notes; notesEl.style.display='block'; } else notesEl.style.display='none';
    document.getElementById('otaBannerText').textContent = `تحديث جديد ${ver} متاح — اضغط تحديث`;
    document.getElementById('otaProgress').style.display='none';
    document.getElementById('otaBtnUpdate').style.display='block';
    banner.style.display='flex';
    document.getElementById('otaBtnUpdate').onclick = ()=> applyUpdate(verData);
  }

  function showProgress(pct, text){
    const bar = document.getElementById('otaProgressBar');
    const txt = document.getElementById('otaProgressText');
    const prog = document.getElementById('otaProgress');
    if(prog) prog.style.display='block';
    if(bar) bar.style.width = pct + '%';
    if(txt && text) txt.textContent = text;
  }

  // --- فحص التحديث ---
  let _lastCheck = 0;
  let _pendingData = null;

  async function fetchVersion(url){
    const controller = new AbortController();
    const t = setTimeout(()=>controller.abort(), 7000);
    try{
      const r = await fetch(url + (url.includes('?')?'&':'?') + '_t=' + Date.now(), {cache:'no-store', signal: controller.signal, headers:{'Cache-Control':'no-cache'}});
      clearTimeout(t);
      if(!r.ok) throw new Error('HTTP '+r.status);
      const j = await r.json();
      if(!j.version) throw new Error('version missing');
      return j;
    }catch(e){
      clearTimeout(t);
      throw e;
    }
  }

  // --- فحص GitHub commits بعنوان update+رقم (مطابق لـ prot/updater.py) ---
  const GITHUB_COMMITS_API = 'https://api.github.com/repos/ABDelrahmanmohamed555/barcode_phoneapp/commits?per_page=20&sha=main';
  const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/ABDelrahmanmohamed555/barcode_phoneapp/main';
  const STORAGE_GITHUB_SHA = 'ota_github_sha';
  function isUpdateCommit(msg){
    if(!msg) return false;
    const first = msg.split('\n')[0].trim();
    const pats = [
      /^\s*update\s*[:\-]?\s*\d+(\.\d+)*\s*$/i,
      /^\s*update\s+\d+(\.\d+)*\s*$/i,
      /^\s*v\d+(\.\d+)*.*$/i,
      /^\s*version\s*[:\-]?\s*\d+.*$/i
    ];
    for(const p of pats) if(p.test(first)) return true;
    if(first.toLowerCase().startsWith('update')){
      const rest = first.slice(6).trim().replace(/^[:\-\s]+/,'');
      if(rest && /^\d/.test(rest)) return true;
    }
    return false;
  }
  function extractVersionFromCommit(msg){
    // يأخذ الرقم بعد update → هو رقم الإصدار
    if(!msg) return null;
    const first = msg.split('\n')[0].trim();
    let m = first.match(/^\s*update\s*[:\-]?\s*(\d+(?:\.\d+)*)/i);
    if(m) return m[1];
    m = first.match(/^\s*v(\d+(?:\.\d+)*)/i);
    if(m) return m[1];
    m = first.match(/^\s*version\s*[:\-]?\s*(\d+(?:\.\d+)*)/i);
    if(m) return m[1];
    return null;
  }
  async function checkGitHubUpdates(){
    const ctrl = new AbortController();
    const t = setTimeout(()=> ctrl.abort(), 8000);
    try{
      const r = await fetch(GITHUB_COMMITS_API + '&_t=' + Date.now(), {cache:'no-store', signal: ctrl.signal, headers:{'Accept':'application/vnd.github.v3+json'}});
      clearTimeout(t);
      if(!r.ok) throw new Error('GitHub '+r.status);
      const commits = await r.json();
      if(!Array.isArray(commits)) return null;
      const lastSha = (()=>{ try{ return localStorage.getItem(STORAGE_GITHUB_SHA); }catch(e){return null;} })();
      for(const c of commits){
        const msg = c.commit && c.commit.message ? c.commit.message : '';
        if(isUpdateCommit(msg)){
          const sha = c.sha;
          if(sha === lastSha) return null; // نفس آخر تحديث تم تجاهله/تثبيته
          // وجد تحديث جديد
          const verFromMsg = extractVersionFromCommit(msg);
          console.log('[OTA] وجد commit تحديث', sha.slice(0,7), msg, '→', verFromMsg);
          // حاول جلب version.json من هذا الـ commit عبر raw
          try{
            const rawUrl = `${GITHUB_RAW_BASE}/version.json?_t=${Date.now()}`;
            const verData = await fetchVersion(rawUrl);
            // لو version.json لم يُحدَّث، استخدم الرقم من commit كـ version
            if(verFromMsg && compareVersions(verFromMsg, verData.version) > 0){
              verData.version = verFromMsg;
            }
            verData._sourceBase = GITHUB_RAW_BASE;
            verData._githubSha = sha;
            verData._commitMsg = msg;
            if(verFromMsg) verData.version = verFromMsg;
            return verData;
          }catch(e){
            // لو فشل جلب version.json، استخدم الرقم من commit كـ version
            const v = verFromMsg || msg.trim();
            return {version: v, build: Date.now(), notes: msg, files: null, _sourceBase: GITHUB_RAW_BASE, _githubSha: sha, _commitMsg: msg};
          }
        }
      }
    }catch(e){ clearTimeout(t); console.log('[OTA] GitHub check fail', e.message); }
    return null;
  }

  async function checkForUpdate(manual=false){
    const now = Date.now();
    if(!manual && now - _lastCheck < 30000) return null; // debounce 30s
    _lastCheck = now;
    // لو لا يوجد سيرفر محفوظ ويعمل file:// حاول الاكتشاف التلقائي أولاً
    const needDiscover = (()=>{ try{ return !localStorage.getItem('prot_api_base') && (!location.hostname || location.hostname===''); }catch(e){return false;} })();
    if(needDiscover && !_discoveredBase){
      const discovered = await autoDiscoverServer();
      if(discovered){
        // أعد بناء الروابط بعد الاكتشاف
        _lastCheck = 0; // اسمح بفحص فوري بعد الاكتشاف
      } else if(manual){
        // لو يدوي ولم نجد سيرفر اعرض رسالة مساعدة
        toast('لم يتم العثور تلقائياً — تأكد أن الموبايل والديسكتوب على نفس الواي فاي وأن السيرفر يعمل');
      }
    }
    const stored = getStoredVersion();
    const ignore = (()=>{ try{ return localStorage.getItem(STORAGE_KEY_IGNORE); }catch(e){ return null; } })();
    // 1) فحص GitHub commits أولاً (عبر الإنترنت حتى لو اللابتوب مطفي)
    try{
      const ghData = await checkGitHubUpdates();
      if(ghData){
        const cmp = compareVersions(ghData.version, stored);
        // لو حتى نفس النسخة لكن commit جديد مختلف، اعتبره تحديث
        const isNewCommit = ghData._githubSha && ghData._githubSha !== (()=>{ try{ return localStorage.getItem(STORAGE_GITHUB_SHA);}catch(e){return null;} })();
        if(cmp > 0 || isNewCommit){
          if(ignore && ignore === ghData.version && !manual){
            console.log('[OTA] تم تجاهل هذا الإصدار GitHub');
          } else {
            _pendingData = ghData;
            showBanner(ghData);
            if(manual) toast('تحديث جديد من GitHub: ' + ghData._commitMsg);
            return ghData;
          }
        }
      }
    }catch(e){ console.log('[OTA] GitHub skip', e.message); }

    const urls = getCheckUrls();
    let lastErr = null;
    for(const url of urls){
      try{
        console.log('[OTA] فحص', url);
        const data = await fetchVersion(url);
        // فحص APK native أولاً (حتى لو إصدار الويب نفسه)
        if(data.apk_url && data.apk_version && window.cordova && cordova.file){
          const curApk = (()=>{ try{ return localStorage.getItem('ota_apk_version')|| stored; }catch(e){return stored;} })();
          if(compareVersions(data.apk_version, curApk) > 0){
            _pendingData = data;
            _pendingData._sourceBase = url.replace(/\/version\.json.*$/,'').replace(/\/api\/app_version.*$/,'');
            if(url.includes('/api/app_version')) _pendingData._sourceBase = getApiBase();
            const apkData = {...data, version: data.apk_version, notes: `تحديث APK ${data.apk_version} — اضغط للتثبيت`, _isApk:true};
            showBanner(apkData);
            if(manual) toast('تحديث APK جديد ' + data.apk_version + ' متاح');
            return apkData;
          }
        }
        const cmp = compareVersions(data.version, stored);
        console.log(`[OTA] local ${stored} vs remote ${data.version} = ${cmp}`);
        if(cmp > 0){
          if(ignore && ignore === data.version && !manual){
            console.log('[OTA] تم تجاهل هذا الإصدار');
            return null;
          }
          _pendingData = data;
          // احفظ رابط المصدر لاستخدامه في التحميل
          _pendingData._sourceBase = url.replace(/\/version\.json.*$/,'').replace(/\/api\/app_version.*$/,'');
          if(url.includes('/api/app_version')) _pendingData._sourceBase = getApiBase();
          showBanner(data);
          if(manual) toast('تحديث جديد ' + data.version + ' متاح');
          return data;
        } else {
          if(manual) toast('التطبيق محدث ✓ (' + stored + ')');
          console.log('[OTA] لا يوجد تحديث');
          return null;
        }
      }catch(e){
        lastErr = e;
        console.log('[OTA] فشل', url, e.message);
        continue;
      }
    }
    if(manual){
      toast('فشل فحص التحديث: ' + (lastErr? lastErr.message : 'لا يوجد سيرفر'));
    }
    return null;
  }

  function toast(msg){
    let t = document.getElementById('otaToast');
    if(!t){
      t = document.createElement('div');
      t.id='otaToast';
      t.style.cssText='position:fixed;bottom:70px;left:50%;transform:translateX(-50%);background:#1c2333;color:#f5f0e3;border:1px solid #2d3543;padding:10px 16px;border-radius:8px;font-size:13px;z-index:9999;max-width:90%;text-align:center;';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.display='block';
    clearTimeout(t._timer);
    t._timer = setTimeout(()=> t.style.display='none', 3000);
  }

  // --- تطبيق التحديث ---
  async function applyUpdate(verData){
    verData = verData || _pendingData;
    if(!verData) return;
    const btn = document.getElementById('otaBtnUpdate');
    if(btn){ btn.disabled=true; btn.textContent='جاري...'; }
    showProgress(5, 'جاري التحميل...');

    try{
      const isCordova = !!(window.cordova && cordova.file);
      const base = verData._sourceBase || getApiBase();
      // لو يوجد APK جديد حمله وثبته (native — يتطلب تثبيت)
      if(isCordova && verData.apk_url){
        const curApk = (()=>{ try{ return localStorage.getItem('ota_apk_version')|| CURRENT_VERSION; }catch(e){return CURRENT_VERSION;} })();
        if(verData.apk_version && compareVersions(verData.apk_version, curApk) > 0){
          await downloadAndInstallApk(verData.apk_url, verData.apk_version);
          return;
        }
      }
      // لو يوجد bundle_url حمله كـ zip (لـ Cordova)
      if(isCordova && verData.bundle_url){
        await applyViaBundle(base, verData);
      } else {
        await applyViaFiles(base, verData);
      }
      setStoredVersion(verData.version);
      if(verData._githubSha){ try{ localStorage.setItem(STORAGE_GITHUB_SHA, verData._githubSha); }catch(e){} }
      try{ localStorage.removeItem(STORAGE_KEY_IGNORE); }catch(e){}
      showProgress(100, 'تم التحديث ✓ سيتم إعادة التشغيل');
      toast('تم التحديث إلى ' + verData.version + ' ✓');
      setTimeout(()=> location.reload(), 1200);
    }catch(e){
      console.error('[OTA] فشل التحديث', e);
      toast('فشل التحديث: ' + e.message);
      if(btn){ btn.disabled=false; btn.textContent='⬇ تحديث الآن'; }
      showProgress(0, 'فشل: ' + e.message);
    }
  }

  async function applyViaFiles(base, verData){
    // يحمل كل الملفات المذكورة في version.json ويخزنها — أي ملف جديد تضيفه سينزل تلقائياً
    const files = verData.files ? Object.keys(verData.files) : ['index.html','app.js','style.css','manifest.json','version.json'];
    let done = 0;
    const total = files.length || 1;
    // أنواع الصور/الباينري
    const isBinary = (f)=> /\.(png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot)$/i.test(f);
    const isText = (f)=> !isBinary(f) && !f.endsWith('.apk') && !f.endsWith('.zip');
    for(const f of files){
      showProgress( 5 + Math.round(done/total*85), `تحميل ${f}...`);
      const url = base.replace(/\/+$/,'') + '/' + f.replace(/^\//,'');
      try{
        const r = await fetch(url + '?_t=' + Date.now(), {cache:'no-store'});
        if(!r.ok) throw new Error(r.status);
        if(isBinary(f)){
          // صورة/خط: خزن كـ base64 + Cache
          const blob = await r.blob();
          const b64 = await new Promise((res,rej)=>{
            const reader = new FileReader();
            reader.onload=()=>res(reader.result);
            reader.onerror=rej;
            reader.readAsDataURL(blob);
          });
          try{ localStorage.setItem('ota_' + f, b64); }catch(e){ console.warn('localStorage full for', f); }
          try{
            if('caches' in window){
              const cache = await caches.open('ota-v' + verData.version);
              const res = new Response(blob, {headers:{'Content-Type': r.headers.get('Content-Type')||'application/octet-stream'}});
              await cache.put(f, res);
            }
          }catch(e){}
          console.log(`[OTA] حمل binary ${f} ${blob.size} bytes`);
        } else if(isText(f)){
          const txt = await r.text();
          if(verData.files && verData.files[f]) console.log(`[OTA] حمل ${f} ${txt.length} bytes`);
          try{ localStorage.setItem('ota_' + f, txt); }catch(e){ console.warn('localStorage full', f, e); }
          try{
            if('caches' in window){
              const contentType = f.endsWith('.js')?'text/javascript': f.endsWith('.css')?'text/css': f.endsWith('.json')?'application/json': 'text/html';
              const cache = await caches.open('ota-v' + verData.version);
              const res = new Response(txt, {headers:{'Content-Type': contentType}});
              await cache.put(f, res);
              // أيضاً احفظ نسخة مطلقة للـ file://
              await cache.put(url, res.clone());
            }
          }catch(e){}
        }
      }catch(e){
        console.warn('[OTA] تخطي', f, e.message);
      }
      done++;
    }
    showProgress(95, 'جاري الحفظ...');
  }

  async function applyViaBundle(base, verData){
    // لـ Cordova: حمل bundle.zip وفكه
    const bundleUrl = verData.bundle_url.startsWith('http') ? verData.bundle_url : base.replace(/\/+$/,'') + '/' + verData.bundle_url.replace(/^\//,'');
    showProgress(20, 'تحميل الحزمة...');
    // استخدم fetch + cordova file
    const zipBlob = await fetch(bundleUrl + '?_t=' + Date.now(), {cache:'no-store'}).then(r=>{
      if(!r.ok) throw new Error('bundle '+r.status);
      return r.blob();
    });
    showProgress(50, 'حفظ الحزمة...');
    // احفظ باستخدام cordova-plugin-file
    const fileEntry = await new Promise((resolve, reject)=>{
      window.resolveLocalFileSystemURL(cordova.file.cacheDirectory, dir=>{
        dir.getFile('ota_update.zip', {create:true}, resolve, reject);
      }, reject);
    });
    await new Promise((resolve, reject)=>{
      fileEntry.createWriter(writer=>{
        writer.onwriteend=resolve;
        writer.onerror=reject;
        writer.write(zipBlob);
      }, reject);
    });
    showProgress(70, 'فك الضغط...');
    // فك الضغط باستخدام cordova-plugin-zip
    if(window.zip){
      await new Promise((resolve, reject)=>{
        zip.unzip(fileEntry.nativeURL, cordova.file.dataDirectory + 'ota/', (code)=>{
          if(code===0) resolve();
          else reject(new Error('zip '+code));
        });
      });
      // انقل الملفات إلى dataDirectory/www أو احفظ المسار
      localStorage.setItem('ota_data_dir', cordova.file.dataDirectory + 'ota/');
    } else {
      throw new Error('cordova-plugin-zip غير مثبت — استخدم التحميل المباشر');
    }
    showProgress(90, 'تم فك الحزمة');
  }

  async function downloadAndInstallApk(apkUrl, apkVersion){
    showProgress(10, 'جاري تحميل APK الجديد...');
    const apkFullUrl = apkUrl.startsWith('http') ? apkUrl : (getApiBase().replace(/\/+$/,'') + '/' + apkUrl.replace(/^\//,''));
    console.log('[OTA] تحميل APK', apkFullUrl);
    const resp = await fetch(apkFullUrl + '?_t=' + Date.now(), {cache:'no-store'});
    if(!resp.ok) throw new Error('فشل تحميل APK ' + resp.status);
    const blob = await resp.blob();
    showProgress(50, `تم التحميل ${(blob.size/1024/1024).toFixed(1)}MB — جاري الحفظ...`);
    // احفظ في cacheDirectory
    const fileEntry = await new Promise((resolve, reject)=>{
      window.resolveLocalFileSystemURL(cordova.file.externalCacheDirectory || cordova.file.cacheDirectory, dir=>{
        dir.getFile('elnahal-update.apk', {create:true}, resolve, reject);
      }, reject);
    });
    await new Promise((resolve, reject)=>{
      fileEntry.createWriter(writer=>{
        writer.onwriteend=resolve;
        writer.onerror=reject;
        writer.write(blob);
      }, reject);
    });
    showProgress(80, 'جاري التثبيت...');
    try{ localStorage.setItem('ota_apk_version', apkVersion); }catch(e){}
    // افتح المثبت عبر fileOpener2
    if(window.cordova && cordova.plugins && cordova.plugins.fileOpener2){
      await new Promise((resolve, reject)=>{
        cordova.plugins.fileOpener2.open(fileEntry.nativeURL, 'application/vnd.android.package-archive', {
          error: (e)=> reject(new Error(JSON.stringify(e))),
          success: ()=> resolve()
        });
      });
      showProgress(100, 'تم فتح المثبت ✓');
      toast('اضغط تثبيت لإكمال التحديث');
    } else if(window.cordova && window.cordova.plugins && window.cordova.plugins.fileOpener2){
      window.cordova.plugins.fileOpener2.open(fileEntry.toURL(), 'application/vnd.android.package-archive');
    } else {
      // fallback: حاول فتح عبر intent
      window.open(fileEntry.nativeURL, '_system');
      toast('نزل الـ APK — افتحه من التنزيلات للتثبيت');
    }
  }

  // --- تحميل ملفات OTA المخزنة مبكراً (قبل تحميل app.js) — V2 شامل للأيقونة والاسم والـ PWA ---
  function injectCachedIfExists(){
    try{
      const ver = getStoredVersion();
      if(compareVersions(ver, CURRENT_VERSION) <=0) return;
      // 1) manifest.json سحابي — حدث الاسم والـ PWA مبكراً
      try{
        const manTxt=localStorage.getItem('ota_manifest.json');
        if(manTxt){
          const m=JSON.parse(manTxt);
          if(m.name){
            document.title=m.name;
            window.__OTA_APP_NAME=m.name;
            // حدث manifest ديناميكي
            let ml=document.querySelector('link[rel="manifest"]');
            if(ml){
              try{
                const blob=new Blob([manTxt],{type:'application/json'});
                const u=URL.createObjectURL(blob);
                ml.href=u;
              }catch(e){}
            }
            // حدث عنوان الهيدر لاحقاً
            const upd=()=>{
              const el=document.getElementById('mainTitle');
              if(el) el.textContent=m.name;
            };
            if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', upd);
            else upd();
          }
        }
      }catch(e){}
      // 2) حقن كل ملفات OTA المحفوظة
      for(let i=0;i<localStorage.length;i++){
        const key = localStorage.key(i);
        if(!key || !key.startsWith('ota_')) continue;
        const fname = key.slice(4); // بعد ota_
        if(fname==='version.json') continue;
        // manifest تمت معالجته أعلاه
        if(fname==='manifest.json') continue;
        const val = localStorage.getItem(key);
        if(!val) continue;
        try{
          if(fname.endsWith('.css')){
            // لا تكرر لو تم حقنه مبكراً في index.html
            if(document.getElementById('ota-'+fname) || document.getElementById('ota-style-early')) continue;
            const st = document.createElement('style');
            st.id='ota-'+fname;
            st.textContent = val;
            document.head.appendChild(st);
            console.log('[OTA] حقن', fname, ver);
          } else if(fname.endsWith('.js')){
            if(fname==='updater.js' || fname==='sw.js') continue;
            if(document.getElementById('ota-'+fname)) continue;
            const orig = document.querySelector(`script[src="${fname}"]`);
            if(orig) orig.remove();
            const s = document.createElement('script');
            s.id='ota-'+fname;
            s.textContent = val;
            if(document.readyState === 'loading'){
              document.addEventListener('DOMContentLoaded', ()=> { try{document.body.appendChild(s);}catch(e){} });
            } else {
              try{document.body.appendChild(s);}catch(e){}
            }
            console.log('[OTA] حقن', fname, ver);
          } else if(/\.(png|jpg|jpeg|gif|webp|ico)$/i.test(fname)){
            // صورة base64 — استبدال فوري + مراقبة للمستقبل
            const applyIcon=(b64)=>{
              try{
                document.querySelectorAll(`img[src="${fname}"]`).forEach(img=>{ if(img.src!==b64) img.src=b64; });
                if(fname==='icon.png'){
                  document.querySelectorAll('img[src="icon.png"]').forEach(img=>{ if(img.src!==b64) img.src=b64; });
                  // favicon
                  let l=document.querySelector('link[rel="icon"]');
                  if(l) l.href=b64;
                  let al=document.querySelector('link[rel="apple-touch-icon"]');
                  if(al) al.href=b64;
                  // splash و titlebar
                  const splashImg=document.querySelector('#splashLogo img');
                  if(splashImg) splashImg.src=b64;
                  const titleImg=document.querySelector('#mainLogo img');
                  if(titleImg) titleImg.src=b64;
                  window.__OTA_ICON_B64=b64;
                }
              }catch(e){}
            };
            if(val.startsWith('data:')){
              applyIcon(val);
              // MutationObserver لأي صورة تضاف لاحقاً
              const mo=new MutationObserver(()=>applyIcon(val));
              mo.observe(document.documentElement,{childList:true,subtree:true});
              setTimeout(()=>mo.disconnect(), 15000);
              console.log('[OTA] حقن صورة', fname, ver);
            }
          }
        }catch(e){ console.warn('[OTA] inject fail', fname, e); }
      }
      // 3) تأكيد نهائي بعد DOM جاهز للأيقونة والاسم
      const finalPatch=()=>{
        try{
          const iconB64=localStorage.getItem('ota_icon.png');
          if(iconB64 && iconB64.startsWith('data:')){
            document.querySelectorAll('img[src="icon.png"]').forEach(img=>img.src=iconB64);
            const sImg=document.querySelector('#splashLogo img'); if(sImg) sImg.src=iconB64;
            const tImg=document.querySelector('#mainLogo img'); if(tImg) tImg.src=iconB64;
          }
          const manTxt=localStorage.getItem('ota_manifest.json');
          if(manTxt){
            try{
              const m=JSON.parse(manTxt);
              if(m.name){
                const el=document.getElementById('mainTitle');
                if(el) el.textContent=m.name;
                document.title=m.name;
              }
            }catch(e){}
          }
        }catch(e){}
      };
      if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', finalPatch);
      else setTimeout(finalPatch, 300);
    }catch(e){ console.warn('[OTA] inject fail', e); }
  }

  // اعتراض fetch لخدمة أي ملف OTA حتى لو الملف جديد — يضمن أن أي ملف جديد تضيفه يُحمّل بدون تثبيت
  (function(){
    if(window._otaFetchPatched) return;
    window._otaFetchPatched = true;
    const origFetch = window.fetch;
    window.fetch = async function(input, init){
      try{
        const url = typeof input === 'string' ? input : input.url;
        const clean = url.split('?')[0].split('#')[0];
        const fname = clean.split('/').pop();
        // لو الملف موجود في localStorage كـ OTA، أرجعه مباشرة
        const otaKey = 'ota_' + fname;
        const otaVal = (()=>{ try{ return localStorage.getItem(otaKey); }catch(e){return null;} })();
        const ver = getStoredVersion();
        if(otaVal && compareVersions(ver, CURRENT_VERSION) > 0){
          if(fname.endsWith('.js') || fname.endsWith('.css') || fname.endsWith('.html') || fname.endsWith('.json')){
            console.log('[OTA] fetch intercept', fname);
            const ct = fname.endsWith('.js')?'text/javascript': fname.endsWith('.css')?'text/css': fname.endsWith('.json')?'application/json':'text/html';
            return new Response(otaVal, {headers:{'Content-Type': ct}, status:200});
          } else if(/\.(png|jpg|jpeg|gif|webp)$/i.test(fname) && otaVal.startsWith('data:')){
            // صورة base64 → حولها لـ blob
            const res = await fetch(otaVal);
            return res;
          }
        }
      }catch(e){}
      return origFetch.apply(this, arguments);
    };
  })();

  // --- تنظيف تلقائي مع كل فتحة: لو OTA قديم أو تالف امسحه قبل الحقن ---
  (function autoCleanOTA(){
    try{
      const ver=getStoredVersion();
      if(ver && compareVersions(ver, CURRENT_VERSION) < 0){
        console.log('[AUTO-CLEAN updater] OTA قديم',ver,'<',CURRENT_VERSION,'→ مسح');
        for(let i=localStorage.length-1;i>=0;i--){ const k=localStorage.key(i); if(k&&k.startsWith('ota_')) localStorage.removeItem(k); }
        localStorage.removeItem(STORAGE_KEY_VERSION);
        localStorage.removeItem(STORAGE_GITHUB_SHA);
        try{ sessionStorage.removeItem('_ota_html_boot'); }catch(e){}
        if('caches' in window) caches.keys().then(keys=> Promise.all(keys.filter(k=>k.startsWith(CACHE_PREFIX)).map(k=> caches.delete(k)))).catch(()=>{});
        return;
      }
      // بقايا بدون version
      if(!ver){
        let has=false; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k&&k.startsWith('ota_')){ has=true; break; } }
        if(has){
          console.log('[AUTO-CLEAN updater] بقايا OTA بدون version → مسح');
          for(let i=localStorage.length-1;i>=0;i--){ const k=localStorage.key(i); if(k&&k.startsWith('ota_')) localStorage.removeItem(k); }
        }
      }
    }catch(e){}
  })();

  // شغل الحقن فوراً (قبل DOMContentLoaded)
  if(document.readyState === 'loading'){
    injectCachedIfExists();
  } else {
    injectCachedIfExists();
  }

  // تعامل مع index.html المحدث: لو ota_index.html موجود وحديث، اعرض زر لإعادة تحميله
  // لا نعمل document.write تلقائياً لأنه يخرب السبلاش

  // --- تهيئة ---
  function init(){
    ensureBanner();
    // فحص أولي بعد 3 ثواني (بعد السبلاش)
    setTimeout(()=> checkForUpdate(false), 3500);
    // فحص دوري
    setInterval(()=> checkForUpdate(false), CHECK_INTERVAL_MS);
    // فحص عند العودة للواجهة
    document.addEventListener('visibilitychange', ()=>{
      if(document.visibilityState==='visible') checkForUpdate(false);
    });
    // استماع لـ deviceready في Cordova
    if(window.cordova){
      document.addEventListener('deviceready', ()=> checkForUpdate(false), false);
    }
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // واجهة عامة
  window.OTA = {
    check: ()=> checkForUpdate(true),
    apply: applyUpdate,
    setRemote: setRemoteOverride,
    getRemote: getRemoteOverride,
    getVersion: getStoredVersion,
    compare: compareVersions,
    getApiBase,
  };
  window.checkForUpdate = ()=> checkForUpdate(true);
  window.applyOTAUpdate = applyUpdate;
})();
