#!/usr/bin/env python3
# push_to_github.py — رفع التحديث والمنتجات إلى GitHub ليصل للموبايل عبر الإنترنت
# الاستخدام:
#   python3 push_to_github.py --message "update 3"           # يرفع version.json + app.js + products.json
#   python3 push_to_github.py --products-only               # يرفع products.json فقط (مزامنة منتجات)
# يتطلب: git remote origin = https://github.com/ABDelrahmanmohamed555/barcode_phoneapp.git
#        و TOKEN في env GITHUB_TOKEN أو في git credential

import argparse, subprocess, os, pathlib, sys, json

BASE = pathlib.Path(__file__).parent.resolve()

def run(cmd, cwd=BASE):
    r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    return r

def has_token():
    # تحقق من وجود token في remote URL أو env
    r = run(["git", "remote", "get-url", "origin"])
    url = r.stdout.strip() if r.returncode==0 else ""
    if "TOKEN" in url or "ghp_" in url:
        return True
    if os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN"):
        return True
    # تحقق من credential helper
    return False

def ensure_token_in_remote():
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if not token:
        return False
    r = run(["git", "remote", "get-url", "origin"])
    url = r.stdout.strip()
    if token not in url and "github.com" in url:
        # حول https://github.com/user/repo.git إلى https://TOKEN@github.com/user/repo.git
        if url.startswith("https://"):
            new_url = url.replace("https://", f"https://{token}@")
            run(["git", "remote", "set-url", "origin", new_url])
            print(f"✓ تم ضبط remote مع token")
            return True
    return False

def push(message, files):
    # files: list of Path relative to BASE
    for f in files:
        fp = BASE / f if not isinstance(f, pathlib.Path) else f
        if fp.exists():
            run(["git", "add", str(fp.relative_to(BASE))])
        else:
            print(f"⚠ غير موجود: {f}")
    # تحقق هل هناك تغيير
    r = run(["git", "diff", "--cached", "--name-only"])
    if not r.stdout.strip():
        print("لا يوجد تغيير للرفع")
        return False
    r = run(["git", "commit", "-m", message])
    if r.returncode!=0:
        print(f"commit fail: {r.stderr or r.stdout}")
        return False
    print(f"✓ commit: {message}")
    # push
    ensure_token_in_remote()
    r = run(["git", "push", "origin", "main"])
    if r.returncode!=0:
        print(f"push fail: {r.stderr or r.stdout}")
        print("→ تأكد من GITHUB_TOKEN. أنشئ واحد من: https://github.com/settings/tokens → Generate → repo")
        print("  ثم: export GITHUB_TOKEN=ghp_xxx && python3 push_to_github.py --message 'update 3'")
        return False
    print("✓ تم الرفع إلى GitHub — الموبايل سيجده خلال دقيقة")
    return True

def main():
    ap = argparse.ArgumentParser(description="رفع التحديث/المنتجات إلى GitHub")
    ap.add_argument("--message", default="update 1", help="رسالة الكومنت (يجب أن تبدأ بـ update+رقم ليكتشفها الموبايل)")
    ap.add_argument("--products-only", action="store_true", help="رفع products.json فقط")
    ap.add_argument("--version-only", action="store_true", help="رفع version.json فقط")
    args = ap.parse_args()

    if args.products_only:
        files = ["products.json"]
        msg = "auto sync products"
    elif args.version_only:
        files = ["version.json","app.js","style.css","index.html","updater.js"]
        msg = args.message
    else:
        # افتراضي: كل ملفات التحديث + المنتجات
        files = ["version.json","app.js","style.css","index.html","updater.js","sw.js","products.json","manifest.json"]
        msg = args.message
        # تأكد أن الرسالة تبدأ بـ update
        if not msg.strip().lower().startswith("update"):
            msg = "update 1 - " + msg

    # تحقق من token
    if not has_token():
        print("⚠ لا يوجد GITHUB_TOKEN. الرفع قد يفشل بدون تسجيل.")
        print("  أنشئ token من https://github.com/settings/tokens")
        print("  ثم: export GITHUB_TOKEN=ghp_xxx")
        print("  أو سجل دخول: git config credential.helper store")

    ok = push(msg, files)
    sys.exit(0 if ok else 1)

if __name__ == "__main__":
    main()
