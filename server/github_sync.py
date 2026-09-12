#!/usr/bin/env python3
# phone app/server/github_sync.py — wrapper موحد (يستدعي prot/github_sync.py)
import os, sys
prot_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "prot"))
if prot_path not in sys.path:
    sys.path.insert(0, os.path.dirname(prot_path))
try:
    from prot.github_sync import *
except ImportError:
    import importlib.util, pathlib
    prot_gh = os.path.abspath(os.path.join(os.path.dirname(os.path.dirname(__file__)), "..", "prot", "github_sync.py"))
    spec = importlib.util.spec_from_file_location("prot.github_sync", prot_gh)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    globals().update({k: getattr(mod, k) for k in dir(mod) if not k.startswith("_")})
