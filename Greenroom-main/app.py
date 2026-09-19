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

if __name__ == "__main__":
    sys.path.insert(0, str(BACKEND_DIR))
    runpy.run_path(str(BACKEND_DIR / "app.py"), run_name="__main__")
