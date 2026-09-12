#!/usr/bin/env python3
# phone app/server/sync_api.py — wrapper موحد (يستدعي prot/sync_api.py لتجنب التكرار)
import os, sys
# أضف prot للمسار
prot_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "prot"))
if prot_path not in sys.path:
    sys.path.insert(0, os.path.dirname(prot_path))
# استيراد مباشر من prot
try:
    from prot.sync_api import *
except ImportError:
    # fallback: حاول من الجذر
    import importlib.util
    prot_sync = os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "prot", "sync_api.py")
    prot_sync = os.path.abspath(prot_sync)
    spec = importlib.util.spec_from_file_location("prot.sync_api", prot_sync)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    globals().update({k: getattr(mod, k) for k in dir(mod) if not k.startswith("_")})
