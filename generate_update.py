#!/usr/bin/env python3
# generate_update.py — إنشاء تحديث OTA جديد
# الاستخدام: python3 generate_update.py --version 1.0.1 --notes "تحديث الواجهة"
# أو بدون باراميتر يزيد patch تلقائياً

import argparse, json, hashlib, os, datetime, shutil, pathlib

BASE = pathlib.Path(__file__).parent.resolve()
VERSION_JSON = BASE / "version.json"
# حصر كل ملفات التطبيق تلقائياً — أي ملف جديد تضيفه سيدخل التحديث بدون تعديل
AUTO_IGNORE = {".git", "protPhone", "platforms", "node_modules", "venv", "__pycache__", ".vscode", "server", ".tmp", "reports"}
AUTO_EXCLUDE_EXT = {".apk", ".zip"}  # ملفات ثقيلة لا تدخل OTA
def _scan_files():
    files = []
    for p in BASE.iterdir():
        if p.name in AUTO_IGNORE:
            continue
        if p.is_file():
            if p.suffix.lower() in AUTO_EXCLUDE_EXT:
                continue
            # تجاهل ملفات مؤقتة
            if p.name.startswith(".") and p.name != ".htaccess":
                continue
            # فقط ملفات الويب والأصول
            if p.suffix.lower() in {".html",".js",".css",".json",".png",".jpg",".jpeg",".svg",".webp",".ico",".txt",".woff",".woff2",".ttf"}:
                files.append(p.name)
    # أضف ملفات داخل مجلدات مسموحة مثل assets لو موجود
    for sub in ["assets"]:
        sp = BASE / sub
        if sp.exists() and sp.is_dir():
            for q in sp.rglob("*"):
                if q.is_file() and q.suffix.lower() not in AUTO_EXCLUDE_EXT:
                    files.append(str(q.relative_to(BASE)))
    return sorted(set(files))
FILES = _scan_files() if False else ["index.html","app.js","style.css","manifest.json","updater.js","supabase_sync.js"]
# ستُحسب ديناميكياً في main()

def sha256_file(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            h.update(chunk)
    return h.hexdigest()

def bump_version(v, part="patch"):
    a,b,c = [int(x) for x in v.split(".")]
    if part=="major": a+=1; b=0; c=0
    elif part=="minor": b+=1; c=0
    else: c+=1
    return f"{a}.{b}.{c}"

def load_version():
    if VERSION_JSON.exists():
        return json.loads(VERSION_JSON.read_text(encoding="utf-8"))
    return {"version":"1.0.0","build":1,"files":{}}

def main():
    ap = argparse.ArgumentParser(description="إنشاء تحديث OTA")
    ap.add_argument("--version", help="النسخة الجديدة مثل 1.0.1 (لو فارغ يزيد patch)")
    ap.add_argument("--build", type=int, help="رقم البناء (لو فارغ يزيد تلقائياً)")
    ap.add_argument("--notes", default="", help="ملاحظات التحديث")
    ap.add_argument("--part", choices=["patch","minor","major"], default="patch", help="جزء الزيادة لو لم تحدد version")
    ap.add_argument("--push", action="store_true", help="رفع تلقائي إلى GitHub بعد الإنشاء (يتطلب GITHUB_TOKEN)")
    args = ap.parse_args()

    data = load_version()
    old_ver = data.get("version","1.0.0")
    old_build = int(data.get("build",1))

    new_ver = args.version.strip() if args.version else bump_version(old_ver, args.part)
    new_build = args.build if args.build else old_build + 1
    if args.version and not args.build:
        new_build = old_build + 1

    # hash الملفات — حصر تلقائي لأي ملف جديد
    try:
        scanned = _scan_files()
        _files_to_hash = scanned if scanned else FILES
    except Exception:
        _files_to_hash = FILES
    # تأكد أن الأساسيات موجودة حتى لو _scan_files فشل
    for must in ["index.html","app.js","style.css","manifest.json","updater.js","supabase_sync.js","version.json","sw.js"]:
        if must not in _files_to_hash and (BASE / must).exists():
            _files_to_hash.append(must)
    # icon دائما
    if "icon.png" not in _files_to_hash and (BASE / "icon.png").exists():
        _files_to_hash.append("icon.png")
    files_hash = {}
    for fname in sorted(set(_files_to_hash)):
        fp = BASE / fname
        if fp.exists() and fp.is_file():
            try:
                files_hash[fname] = sha256_file(fp)
            except Exception:
                pass

    # --- OTA V2: حدّث sw.js ليحمل رقم النسخة الجديدة (حتى لا يحذف كاش OTA المستقبلي) ---
    try:
        sw_path = BASE / "sw.js"
        if sw_path.exists():
            sw_text = sw_path.read_text(encoding="utf-8")
            import re
            # حدّث CURRENT_CACHE + لوج
            new_cache_line = f"let CURRENT_CACHE = CACHE_PREFIX + 'v{new_ver}';"
            sw_text_new = re.sub(r"let CURRENT_CACHE\s*=\s*CACHE_PREFIX\s*\+\s*'v[^']*';", new_cache_line, sw_text)
            sw_text_new = re.sub(r"\[SW [^\]]+\] install", f"[SW {new_ver}] install", sw_text_new)
            sw_text_new = re.sub(r"\[SW [^\]]+\] activate", f"[SW {new_ver}] activate", sw_text_new)
            if sw_text_new != sw_text:
                sw_path.write_text(sw_text_new, encoding="utf-8")
                print(f"  → حدّث sw.js إلى v{new_ver}")
    except Exception as e:
        print(f"  ⚠ فشل تحديث sw.js: {e}")

    data["version"] = new_ver
    data["build"] = new_build
    data["date"] = datetime.datetime.now().isoformat(timespec="seconds")
    if args.notes:
        data["notes"] = args.notes
    else:
        data["notes"] = data.get("notes","") or f"تحديث {new_ver}"
    data["files"] = files_hash
    if "changelog" not in data:
        data["changelog"] = []
    # أضف لل changelog
    data["changelog"].insert(0, f"{new_ver} - {data['notes']} ({data['date'][:10]})")
    data["changelog"] = data["changelog"][:20]

    VERSION_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"✓ تم إنشاء version.json → {new_ver} build {new_build}")
    print(f"  الملفات ({len(files_hash)}): {list(files_hash.keys())}")

    # انسخ version.json إلى protPhone
    for dest in [BASE / "protPhone/www/version.json", BASE / "protPhone/platforms/android/app/src/main/assets/www/version.json"]:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(VERSION_JSON, dest)
        print(f"  → نسخ إلى {dest.relative_to(BASE)}")

    # انسخ كل ملفات التحديث إلى protPhone/www (للبناء القادم) — أي ملف جديد سينسخ تلقائياً
    for fname in files_hash.keys():
        if fname == "version.json":
            continue
        src = BASE / fname
        if not src.exists():
            continue
        for dest in [BASE / "protPhone/www" / fname, BASE / "protPhone/platforms/android/app/src/main/assets/www" / fname]:
            try:
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src, dest)
            except Exception:
                pass

    if args.push:
        import subprocess, os
        # استخدم push_to_github.py
        push_script = BASE / "push_to_github.py"
        if push_script.exists():
            msg = f"update {new_ver} - {data['notes']}"
            print(f"\n→ رفع إلى GitHub: {msg}")
            subprocess.run([os.sys.executable, str(push_script), "--message", msg], cwd=BASE)
        else:
            # fallback مباشر
            import subprocess as sp
            sp.run(["git", "add", "version.json","app.js","style.css","index.html","updater.js","sw.js","products.json"], cwd=BASE)
            sp.run(["git", "commit","-m", f"update {new_ver} - {data['notes']}"], cwd=BASE)
            sp.run(["git", "push","origin","main"], cwd=BASE)

    print("\nالخطوة التالية:")
    print(f"  1. تأكد أن sync_api.py يعمل: python3 ../prot/sync_api.py  (للمزامنة المحلية)")
    print(f"  2. للإنترنت: python3 push_to_github.py --message 'update {new_ver}'  (أو استخدم --push)")
    print(f"  3. افتح التطبيق على الموبايل واضغط ⬇ تحديث أو انتظر الفحص التلقائي (GitHub كل 5 دقائق)")
    print(f"  4. للـ APK الجديد (لو غيرت config.xml): cd protPhone && cordova build android")

if __name__ == "__main__":
    main()
