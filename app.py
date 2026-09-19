#!/usr/bin/env python3
"""
Root entry point for GreenRoom Python Server.
Allows running `python app.py` directly from the main Greenroom directory.
"""
import sys
import os
import runpy
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent / "backend"
if str(BACKEND_DIR) not in sys.path:
    sys.path.insert(0, str(BACKEND_DIR))

# Expose top-level Flask app instance for Vercel / WSGI servers
try:
    from backend.app import app
except Exception:
    try:
        from app import app
    except Exception:
        # Fallback to empty WSGI callable if Flask dependencies are absent
        def app(environ, start_response):
            start_response("200 OK", [("Content-Type", "text/plain")])
            return [b"GreenRoom Server"]

if __name__ == "__main__":
    if hasattr(app, "run"):
        app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 3000)), debug=True)
    else:
        runpy.run_path(str(BACKEND_DIR / "app.py"), run_name="__main__")
