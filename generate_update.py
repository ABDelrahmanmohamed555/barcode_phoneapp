#!/usr/bin/env python3
# generate_update.py — إنشاء تحديث OTA جديد
# الاستخدام: python3 generate_update.py --version 1.0.1 --notes "تحديث الواجهة"
# أو بدون باراميتر يزيد patch تلقائياً

import argparse, json, hashlib, os, datetime, shutil, pathlib

BASE = pathlib.Path(__file__).parent.resolve()
VERSION_JSON = BASE / "version.json"
FILES = ["index.html","app.js","style.css","manifest.json","updater.js"]
# icon.png نضيفه لو تغير

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
    args = ap.parse_args()

    data = load_version()
    old_ver = data.get("version","1.0.0")
    old_build = int(data.get("build",1))

    new_ver = args.version.strip() if args.version else bump_version(old_ver, args.part)
    new_build = args.build if args.build else old_build + 1
    if args.version and not args.build:
        new_build = old_build + 1

    # hash الملفات
    files_hash = {}
    for fname in FILES:
        fp = BASE / fname
        if fp.exists():
            files_hash[fname] = sha256_file(fp)
    # icon
    icon = BASE / "icon.png"
    if icon.exists():
        files_hash["icon.png"] = sha256_file(icon)

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
    print(f"  الملفات: {list(files_hash.keys())}")

    # انسخ إلى protPhone
    for dest in [BASE / "protPhone/www/version.json", BASE / "protPhone/platforms/android/app/src/main/assets/www/version.json"]:
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(VERSION_JSON, dest)
        print(f"  → نسخ إلى {dest.relative_to(BASE)}")

    # انسخ updater.js أيضا
    for dest in [BASE / "protPhone/www/updater.js", BASE / "protPhone/platforms/android/app/src/main/assets/www/updater.js"]:
        src = BASE / "updater.js"
        if src.exists():
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(src, dest)

    print("\nالخطوة التالية:")
    print(f"  1. تأكد أن sync_api.py يعمل: python3 ../prot/sync_api.py")
    print(f"  2. افتح التطبيق على الموبايل واضغط ⬇ تحديث أو انتظر الفحص التلقائي")
    print(f"  3. للـ APK الجديد (لو غيرت config.xml): cd protPhone && cordova build android")

if __name__ == "__main__":
    main()
