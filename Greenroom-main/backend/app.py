#!/usr/bin/env python3
"""
app.py
------
Flask API Server for GreenRoom AI Interview Simulator.
Serves the frontend client, question bank, and Machine Learning scoring endpoints.
"""

import os
import sys
import json
import time
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from ai_engine import AIEngine
import db_service

# Paths
BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
FRONTEND_DIR = ROOT_DIR / "frontend"
DATA_FILE = ROOT_DIR / "data" / "question_bank.json"

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
CORS(app)

# Load questions into memory
companies_cache = []
try:
    if DATA_FILE.exists():
        with open(DATA_FILE, "r", encoding="utf-8") as f:
            companies_cache = json.load(f)
            print(f"Loaded {len(companies_cache)} companies from {DATA_FILE}")
    else:
        print(f"Warning: {DATA_FILE} not found.")
except Exception as e:
    print(f"Error loading question bank: {e}")


# Static Frontend Routing
@app.route("/")
def serve_index():
    return send_from_directory(str(FRONTEND_DIR), "index.html")


@app.route("/<path:path>")
def serve_static(path):
    if (FRONTEND_DIR / path).exists():
        return send_from_directory(str(FRONTEND_DIR), path)
    return send_from_directory(str(FRONTEND_DIR), "index.html")


# API Endpoints
@app.route("/api/companies", methods=["GET"])
def get_companies():
    return jsonify(companies_cache)


@app.route("/api/evaluate", methods=["POST"])
def evaluate():
    data = request.get_json() or {}
    answer = data.get("answer", "")
    keywords = data.get("keywords", [])
    q_type = data.get("question_type", "general")
    company_id = data.get("company_id", "google")
    persona = data.get("persona", "friendly")
    duration = data.get("duration_seconds")
    language = data.get("language", "english")

    question = {
        "id": data.get("question_id"),
        "q": data.get("question_text"),
        "level": data.get("level"),
        "expected_answer": data.get("expected_answer"),
        "key_points": data.get("key_points", []),
        "keywords": keywords
    }

    result = AIEngine.evaluate(
        answer=answer,
        keywords=keywords,
        question_type=q_type,
        question=question,
        company_id=company_id,
        persona=persona,
        duration_seconds=duration,
        language=language
    )
    result["question_id"] = data.get("question_id")
    return jsonify(result)


@app.route("/api/report", methods=["POST"])
def generate_report():
    data = request.get_json() or {}
    results = data.get("results", [])
    company_id = data.get("company_id", "google")

    if not results:
        return jsonify({"error": "No question results provided"}), 400

    scores = [r.get("overall_score", 0) for r in results]
    avg_score = round(sum(scores) / len(scores), 1)

    relevance_scores = [r.get("breakdown", {}).get("relevance", 0) for r in results]
    structure_scores = [r.get("breakdown", {}).get("structure", {}).get("score", 0) for r in results]
    fluency_scores = [r.get("breakdown", {}).get("fluency", {}).get("score", 0) for r in results]
    confidence_scores = [r.get("breakdown", {}).get("confidence", {}).get("score", 0) for r in results]

    radar = {
        "Relevance": round(sum(relevance_scores) / len(results), 1),
        "Structure": round(sum(structure_scores) / len(results), 1),
        "Fluency": round(sum(fluency_scores) / len(results), 1),
        "Confidence": round(sum(confidence_scores) / len(results), 1)
    }

    strongest = max(radar.items(), key=lambda x: x[1])[0]
    weakest = min(radar.items(), key=lambda x: x[1])[0]

    if avg_score >= 85:
        hire_verdict = "Strong Hire"
    elif avg_score >= 70:
        hire_verdict = "Hire"
    elif avg_score >= 55:
        hire_verdict = "Lean Hire"
    else:
        hire_verdict = "No Hire"

    from ai_engine import calculate_percentile
    percentile_data = calculate_percentile(avg_score, company_id)

    # Save session to Firestore Database
    session_id = data.get("interview_id") or f"iv_{int(time.time())}"
    db_service.save_interview_session({
        "id": session_id,
        "user_id": data.get("user_id", "default_user"),
        "company_id": companyId,
        "overall_score": avg_score,
        "hire_verdict": hire_verdict,
        "radar": radar,
        "questions_count": len(results)
    })

    return jsonify({
        "overall_average": avg_score,
        "hire_verdict": hire_verdict,
        "radar": radar,
        "strongest_area": strongest,
        "weakest_area": weakest,
        "questions_answered": len(results),
        "benchmark": percentile_data,
        "per_question": results,
        "interview_id": session_id,
        "saved_to_database": True
    })


@app.route("/api/auth/register", methods=["POST"])
def auth_register():
    data = request.get_json() or {}
    try:
        user = db_service.register_user(data)
        return jsonify({"success": True, "user": user})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400


@app.route("/api/auth/login", methods=["POST"])
def auth_login():
    data = request.get_json() or {}
    email = data.get("email", "")
    password = data.get("password", "")
    try:
        user = db_service.authenticate_user(email, password)
        return jsonify({"success": True, "user": user})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 401


@app.route("/api/auth/social", methods=["POST"])
def auth_social():
    data = request.get_json() or {}
    try:
        user = db_service.social_auth_user(data)
        return jsonify({"success": True, "user": user})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 400


@app.route("/api/auth/me", methods=["GET"])
def auth_me():
    user_id = request.args.get("user_id", "")
    if not user_id:
        return jsonify({"error": "user_id is required"}), 400
    user = db_service.users_cache.get(user_id) or {
        "id": user_id,
        "display_name": "Candidate",
        "target_role": "Software Engineer"
    }
    safe = {k: v for k, v in user.items() if k != "password_hash"}
    return jsonify({"success": True, "user": safe})


@app.route("/api/db/history", methods=["GET"])
def get_history():
    user_id = request.args.get("user_id", "default_user")
    history = db_service.get_user_history(user_id)
    return jsonify({"user_id": user_id, "interviews": history})


@app.route("/api/db/status", methods=["GET"])
def db_status():
    status = db_service.get_db_status()
    status["engine"] = "Python Machine Learning NLP Engine"
    status["cached_companies"] = len(companies_cache)
    return jsonify(status)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    print(f"Starting GreenRoom Flask ML Server on http://0.0.0.0:{port}")
    app.run(host="0.0.0.0", port=port, debug=False)
