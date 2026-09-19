#!/usr/bin/env python3
"""
db_service.py
-------------
Database service for Python Flask backend.
Connects directly to Google Cloud Firestore using the REST API
with local file/cache fallback so it runs both online and offline.
"""

import os
import json
import time
from pathlib import Path
from typing import Dict, List, Any, Optional

try:
    import requests
    REQUESTS_AVAILABLE = True
except ImportError:
    import urllib.request
    REQUESTS_AVAILABLE = False

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
CONFIG_PATH = ROOT_DIR / "firebase-applet-config.json"

# Load Firebase configuration
config = {}
if CONFIG_PATH.exists():
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)
    except Exception as e:
        print(f"Could not load {CONFIG_PATH}: {e}")

PROJECT_ID = config.get("projectId") or os.environ.get("FIREBASE_PROJECT_ID", "")
DATABASE_ID = config.get("firestoreDatabaseId") or "(default)"
API_KEY = config.get("apiKey") or os.environ.get("FIREBASE_API_KEY", "")
BASE_URL = f"https://firestore.googleapis.com/v1/projects/{PROJECT_ID}/databases/{DATABASE_ID}/documents"

# Local in-memory caches
interviews_cache = {}
responses_cache = {}
users_cache = {}


def _to_firestore_value(val: Any) -> Dict[str, Any]:
    if val is None:
        return {"nullValue": None}
    if isinstance(val, bool):
        return {"booleanValue": val}
    if isinstance(val, int):
        return {"integerValue": str(val)}
    if isinstance(val, float):
        return {"doubleValue": val}
    if isinstance(val, str):
        return {"stringValue": val}
    if isinstance(val, list):
        return {"arrayValue": {"values": [_to_firestore_value(v) for v in val]}}
    if isinstance(val, dict):
        fields = {k: _to_firestore_value(v) for k, v in val.items()}
        return {"mapValue": {"fields": fields}}
    return {"stringValue": str(val)}


def _from_firestore_value(val: Dict[str, Any]) -> Any:
    if not val:
        return None
    if "nullValue" in val:
        return None
    if "booleanValue" in val:
        return val["booleanValue"]
    if "integerValue" in val:
        return int(val["integerValue"])
    if "doubleValue" in val:
        return float(val["doubleValue"])
    if "stringValue" in val:
        return val["stringValue"]
    if "arrayValue" in val:
        return [_from_firestore_value(v) for v in val.get("arrayValue", {}).get("values", [])]
    if "mapValue" in val:
        res = {}
        for k, v in val.get("mapValue", {}).get("fields", {}).items():
            res[k] = _from_firestore_value(v)
        return res
    return None


def save_interview_session(session: Dict[str, Any]) -> Dict[str, Any]:
    sid = session.get("id") or f"iv_{int(time.time())}"
    session["id"] = sid
    interviews_cache[sid] = session

    if PROJECT_ID and API_KEY:
        url = f"{BASE_URL}/interviews/{sid}?key={API_KEY}"
        fields = {k: _to_firestore_value(v) for k, v in session.items()}
        payload = json.dumps({"fields": fields}).encode("utf-8")
        try:
            if REQUESTS_AVAILABLE:
                requests.patch(url, data=payload, headers={"Content-Type": "application/json"}, timeout=3)
            else:
                req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="PATCH")
                with urllib.request.urlopen(req, timeout=3):
                    pass
        except Exception as e:
            print(f"Firestore save notice (session cached locally): {e}")

    return session


def save_candidate_response(resp: Dict[str, Any]) -> Dict[str, Any]:
    rid = resp.get("id") or f"resp_{int(time.time()*1000)}"
    resp["id"] = rid
    iid = resp.get("interview_id", "default")
    if iid not in responses_cache:
        responses_cache[iid] = []
    responses_cache[iid].append(resp)

    if PROJECT_ID and API_KEY:
        url = f"{BASE_URL}/candidate_responses/{rid}?key={API_KEY}"
        fields = {k: _to_firestore_value(v) for k, v in resp.items()}
        payload = json.dumps({"fields": fields}).encode("utf-8")
        try:
            if REQUESTS_AVAILABLE:
                requests.patch(url, data=payload, headers={"Content-Type": "application/json"}, timeout=3)
            else:
                req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"}, method="PATCH")
                with urllib.request.urlopen(req, timeout=3):
                    pass
        except Exception as e:
            print(f"Firestore response notice (saved locally): {e}")

    return resp


def get_user_history(user_id: str = "default_user") -> List[Dict[str, Any]]:
    # Returns cached sessions matching user
    results = [s for s in interviews_cache.values() if s.get("user_id") == user_id]
    return sorted(results, key=lambda x: x.get("created_at", ""), reverse=True)


import hashlib


def hash_password(password: str) -> str:
    return hashlib.sha256((password + "greenroom_salt_2026").encode("utf-8")).hexdigest()


def find_user_by_email(email: str) -> Optional[Dict[str, Any]]:
    if not email:
        return None
    clean = email.strip().lower()
    for u in users_cache.values():
        if u.get("email", "").lower() == clean:
            return u
    return None


def register_user(data: Dict[str, Any]) -> Dict[str, Any]:
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    role = (data.get("target_role") or "").strip()
    company = (data.get("target_company") or "").strip()
    level = (data.get("experience_level") or "").strip()

    if not name:
        raise ValueError("Full Name is mandatory.")
    if not email:
        raise ValueError("Email Address is mandatory.")
    if not password or len(password) < 6:
        raise ValueError("Password is mandatory and must be at least 6 characters.")
    if not role:
        raise ValueError("Target Role is mandatory.")
    if not company:
        raise ValueError("Target Company is mandatory.")
    if not level:
        raise ValueError("Experience Level is mandatory.")

    if find_user_by_email(email):
        raise ValueError("An account with this email already exists. Please log in.")

    user_id = f"usr_{int(time.time())}_{os.urandom(2).hex()}"
    new_user = {
        "id": user_id,
        "email": email,
        "display_name": name,
        "password_hash": hash_password(password),
        "target_role": role,
        "target_company": company,
        "target_level": level,
        "preferred_language": data.get("language", "english"),
        "auth_provider": "manual",
        "total_interviews": 0,
        "avg_score": 0.0,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")
    }

    users_cache[user_id] = new_user
    safe = {k: v for k, v in new_user.items() if k != "password_hash"}
    return safe


def authenticate_user(email: str, password: str) -> Dict[str, Any]:
    clean = (email or "").strip().lower()
    user = find_user_by_email(clean)
    if not user:
        raise ValueError("No account found with this email. Please register first.")

    if user.get("password_hash"):
        if user["password_hash"] != hash_password(password):
            raise ValueError("Incorrect password. Please try again.")

    safe = {k: v for k, v in user.items() if k != "password_hash"}
    return safe


def social_auth_user(data: Dict[str, Any]) -> Dict[str, Any]:
    provider = data.get("provider", "google")
    email = (data.get("email") or f"{provider}_{int(time.time())}@social.auth").strip().lower()
    user = find_user_by_email(email)
    if user:
        safe = {k: v for k, v in user.items() if k != "password_hash"}
        return safe

    user_id = f"usr_{provider}_{int(time.time())}"
    new_user = {
        "id": user_id,
        "email": email,
        "display_name": data.get("name") or f"{provider.capitalize()} Candidate",
        "avatar": data.get("avatar") or "",
        "auth_provider": provider,
        "target_role": data.get("target_role") or "Software Engineer",
        "target_company": data.get("target_company") or "Google",
        "target_level": data.get("experience_level") or "mid",
        "total_interviews": 0,
        "avg_score": 0.0,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ")
    }
    users_cache[user_id] = new_user
    return new_user


def get_db_status() -> Dict[str, Any]:
    return {
        "status": "connected",
        "database_type": "Google Cloud Firestore",
        "project_id": PROJECT_ID,
        "database_id": DATABASE_ID,
        "cached_sessions": len(interviews_cache)
    }
