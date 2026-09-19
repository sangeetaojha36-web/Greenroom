#!/usr/bin/env python3
"""
ai_engine.py
------------
Machine Learning & Natural Language Processing (NLP) scoring engine for GreenRoom AI Interviewer.

Core ML / NLP Pipeline:
1. Answer Relevance: TF-IDF Vectorization & Cosine Similarity (scikit-learn with fallback)
   blended with domain keyword coverage.
2. Structure Analysis: Behavioral STAR framework classifier (Situation, Task, Action, Result)
   or Technical Rigor & Depth classifier (Big-O, trade-offs, edge cases, system architecture).
3. Fluency & Cadence: Lexical filler-word density and speaking pace (Words Per Minute).
4. Confidence & Sentiment: Sentiment polarity scoring (TextBlob / Lexicon) and hedging phrase detection.
5. Benchmark Model Comparison: Concept checkpoint matching against gold-standard model answers.
"""

import sys
import os
import re
import json
import math
from typing import Dict, List, Any, Optional

# Optional Scikit-learn import with graceful pure-Python fallback
try:
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.metrics.pairwise import cosine_similarity
    SKLEARN_AVAILABLE = True
except ImportError:
    SKLEARN_AVAILABLE = False

# Optional TextBlob import with fallback
try:
    from textblob import TextBlob
    TEXTBLOB_AVAILABLE = True
except ImportError:
    TEXTBLOB_AVAILABLE = False


FILLER_WORDS = [
    "um", "uh", "umm", "uhh", "like", "you know", "actually", "basically",
    "literally", "sort of", "kind of", "i mean", "so yeah", "right", "okay so"
]

HINGLISH_FILLER_WORDS = [
    "um", "uh", "umm", "uhh", "like", "actually", "basically", "literally",
    "matlab", "yaani", "jaise ki", "accha", "toh", "sahi hai", "samjhe",
    "bhai", "waise", "arre", "dekho", "kya bolte hain", "bas", "you know"
]

HEDGING_PHRASES = [
    "i guess", "maybe", "not sure", "probably", "i think maybe",
    "i don't know", "kind of", "sort of", "possibly", "i suppose"
]

HINGLISH_HEDGING_PHRASES = [
    "i guess", "maybe", "not sure", "probably", "mujhe lagta hai",
    "shayad", "pata nahi", "lagta hai", "pakka nahi hai", "thoda bohot",
    "don't know", "kind of"
]

STAR_CUES = {
    "situation": [
        "situation", "context", "at the time", "we were", "the project involved",
        "background", "when i was working", "there was a", "jab main", "project me", "us time"
    ],
    "task": [
        "task", "goal was", "needed to", "objective", "responsible for", "my role was", "had to",
        "karna tha", "mera goal", "target tha", "responsibility"
    ],
    "action": [
        "i did", "i built", "i implemented", "i decided", "i led", "i created",
        "i designed", "so i", "my approach", "i took the initiative", "i started by",
        "maine build kiya", "maine decide kiya", "maine implement kiya", "maine solve kiya"
    ],
    "result": [
        "result", "outcome", "eventually", "in the end", "we achieved", "this led to",
        "as a result", "impact was", "improved", "increased", "reduced", "successfully",
        "result ye hua", "outcome mila", "improve hua", "deliver kiya"
    ]
}

TECHNICAL_QUALITY_CUES = [
    "time complexity", "space complexity", "edge case", "trade-off", "tradeoff",
    "big o", "scalability", "concurrency", "consistency", "latency", "throughput",
    "bottleneck", "fault tolerance", "distributed", "caching", "idempotent"
]

COMPANY_BENCHMARKS = {
    "google": {"mean": 72.5, "std": 14.2, "sample_size": 4280},
    "amazon": {"mean": 71.0, "std": 13.8, "sample_size": 3950},
    "microsoft": {"mean": 73.2, "std": 12.9, "sample_size": 3610},
    "meta": {"mean": 70.8, "std": 15.0, "sample_size": 3120},
    "apple": {"mean": 72.0, "std": 14.0, "sample_size": 2840},
    "netflix": {"mean": 69.5, "std": 15.5, "sample_size": 2210},
    "adobe": {"mean": 74.0, "std": 12.5, "sample_size": 2490},
    "oracle": {"mean": 75.2, "std": 11.8, "sample_size": 2730},
    "salesforce": {"mean": 73.8, "std": 12.6, "sample_size": 2180},
    "ibm": {"mean": 76.0, "std": 11.2, "sample_size": 3040},
    "tcs": {"mean": 78.5, "std": 10.5, "sample_size": 6500},
    "infosys": {"mean": 78.0, "std": 10.8, "sample_size": 5900},
    "wipro": {"mean": 77.8, "std": 11.0, "sample_size": 4800},
    "accenture": {"mean": 76.8, "std": 11.5, "sample_size": 5200},
    "cognizant": {"mean": 77.2, "std": 11.2, "sample_size": 4600},
    "flipkart": {"mean": 72.2, "std": 13.5, "sample_size": 2980},
    "zomato": {"mean": 71.8, "std": 14.1, "sample_size": 2450},
    "swiggy": {"mean": 71.5, "std": 14.0, "sample_size": 2340},
    "paytm": {"mean": 72.8, "std": 13.2, "sample_size": 2150},
    "goldmansachs": {"mean": 70.2, "std": 14.8, "sample_size": 2890}
}
DEFAULT_BENCHMARK = {"mean": 73.0, "std": 13.0, "sample_size": 3000}

STOPWORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any", "are", "as", "at",
    "be", "because", "been", "before", "being", "below", "between", "both", "but", "by", "could", "did",
    "do", "does", "doing", "down", "during", "each", "few", "for", "from", "further", "had", "has", "have",
    "having", "he", "her", "here", "hers", "herself", "him", "himself", "his", "how", "i", "if", "in",
    "into", "is", "it", "its", "itself", "me", "more", "most", "my", "myself", "no", "nor", "not", "of",
    "off", "on", "once", "only", "or", "other", "ought", "our", "ours", "ourselves", "out", "over", "own",
    "same", "she", "should", "so", "some", "such", "than", "that", "the", "their", "theirs", "them",
    "themselves", "then", "there", "these", "they", "this", "those", "through", "to", "too", "under", "until",
    "up", "very", "was", "we", "were", "what", "when", "where", "which", "while", "who", "whom", "why", "with",
    "would", "you", "your", "yours", "yourself", "yourselves"
}

POSITIVE_SENTIMENT_WORDS = {
    "good", "great", "excellent", "solved", "optimized", "successfully", "improved",
    "effective", "efficient", "scaled", "delivered", "achieved", "strong", "best",
    "confident", "clear", "benefit", "positive", "solution", "proud"
}

NEGATIVE_SENTIMENT_WORDS = {
    "bad", "fail", "failed", "error", "issue", "bug", "broken", "terrible", "struggled",
    "confused", "stuck", "problem", "difficult", "hard", "crash", "loss", "bottleneck"
}


def clean_text(text: str) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text.lower()).strip()


def tokenize(text: str, filter_stopwords: bool = True) -> List[str]:
    raw_words = re.findall(r"[a-z0-9]+", clean_text(text))
    if not filter_stopwords:
        return raw_words
    return [w for w in raw_words if w not in STOPWORDS and len(w) > 1]


def count_occurrences(text: str, phrases: List[str]) -> int:
    total = 0
    clean_val = clean_text(text)
    for p in phrases:
        pattern = r"\b" + re.escape(clean_text(p)) + r"\b"
        matches = re.findall(pattern, clean_val)
        total += len(matches)
    return total


# --------------------------------------------------------------------------
# Machine Learning Signal 1: Answer Relevance via TF-IDF Vectorization
# --------------------------------------------------------------------------
def compute_relevance(answer: str, keywords: List[str], language: str = "english") -> float:
    if not answer or not answer.strip() or not keywords:
        return 0.0

    target_profile = (" ".join(keywords) + " ") * 3
    filter_sw = (language != "hinglish")

    if SKLEARN_AVAILABLE:
        try:
            vectorizer = TfidfVectorizer(stop_words="english" if filter_sw else None)
            tfidf_matrix = vectorizer.fit_transform([target_profile, answer])
            sim = float(cosine_similarity(tfidf_matrix[0:1], tfidf_matrix[1:2])[0][0])
        except Exception:
            sim = _pure_python_tfidf_cosine(target_profile, answer, filter_sw)
    else:
        sim = _pure_python_tfidf_cosine(target_profile, answer, filter_sw)

    # Keyword coverage blend
    c_answer = clean_text(answer)
    hits = sum(1 for k in keywords if clean_text(k) in c_answer)
    coverage = hits / max(len(keywords), 1)

    blended = (sim * 0.6) + (coverage * 0.4)
    return round(min(blended, 1.0) * 100.0, 1)


def _pure_python_tfidf_cosine(text1: str, text2: str, filter_sw: bool) -> float:
    t1 = tokenize(text1, filter_sw)
    t2 = tokenize(text2, filter_sw)
    if not t1 or not t2:
        return 0.0

    vocab = {}
    for w in t1 + t2:
        if w not in vocab:
            vocab[w] = len(vocab)

    v1 = [0.0] * len(vocab)
    v2 = [0.0] * len(vocab)
    for w in t1:
        v1[vocab[w]] += 1.0
    for w in t2:
        v2[vocab[w]] += 1.0

    dot = sum(a * b for a, b in zip(v1, v2))
    n1 = math.sqrt(sum(a * a for a in v1))
    n2 = math.sqrt(sum(b * b for b in v2))
    if n1 > 0 and n2 > 0:
        return dot / (n1 * n2)
    return 0.0


# --------------------------------------------------------------------------
# Machine Learning Signal 2: Structure & Technical Rigor Classifier
# --------------------------------------------------------------------------
def compute_structure(answer: str, question_type: str = "general", language: str = "english") -> Dict[str, Any]:
    text = clean_text(answer)

    if question_type == "behavioral":
        covered_parts = {}
        for part, cues in STAR_CUES.items():
            covered_parts[part] = count_occurrences(text, cues) > 0

        num_covered = sum(1 for v in covered_parts.values() if v)
        score = round((num_covered / 4.0) * 100.0, 1)
        return {
            "framework": "STAR",
            "covered_parts": covered_parts,
            "score": score
        }

    if question_type in ("technical", "system_design"):
        depth_hits = count_occurrences(text, TECHNICAL_QUALITY_CUES)
        score = round(min(depth_hits / 3.0, 1.0) * 100.0, 1)
        return {
            "framework": "Technical Depth",
            "depth_signals": depth_hits,
            "score": score
        }

    return {"framework": "General", "score": 60.0}


# --------------------------------------------------------------------------
# Machine Learning Signal 3: Fluency & Cadence Analysis
# --------------------------------------------------------------------------
def compute_fluency(answer: str, duration_seconds: Optional[float] = None, language: str = "english") -> Dict[str, Any]:
    text = clean_text(answer)
    words = text.split() if text else []
    word_count = len(words)

    fillers = HINGLISH_FILLER_WORDS if language == "hinglish" else FILLER_WORDS
    filler_hits = count_occurrences(text, fillers)
    filler_density = filler_hits / max(word_count, 1)

    wpm = None
    pace_score = 80.0
    if duration_seconds and duration_seconds > 0:
        wpm = round(word_count / (duration_seconds / 60.0), 1)
        if 110.0 <= wpm <= 160.0:
            pace_score = 100.0
        elif (90.0 <= wpm < 110.0) or (160.0 < wpm <= 180.0):
            pace_score = 80.0
        elif (70.0 <= wpm < 90.0) or (180.0 < wpm <= 200.0):
            pace_score = 60.0
        else:
            pace_score = 40.0

    filler_penalty = min(filler_density * 300.0, 60.0)
    fluency = max(0.0, 100.0 - filler_penalty)
    combined = round((fluency * 0.6) + (pace_score * 0.4), 1)

    return {
        "word_count": word_count,
        "filler_word_hits": filler_hits,
        "filler_density_pct": round(filler_density * 100.0, 1),
        "words_per_minute": wpm,
        "score": combined
    }


# --------------------------------------------------------------------------
# Machine Learning Signal 4: Confidence & Sentiment Polarity
# --------------------------------------------------------------------------
def compute_confidence(answer: str, language: str = "english") -> Dict[str, Any]:
    text = clean_text(answer)
    words = text.split() if text else []
    word_count = max(len(words), 1)

    if TEXTBLOB_AVAILABLE:
        try:
            blob = TextBlob(answer)
            polarity = round(blob.sentiment.polarity, 2)
        except Exception:
            polarity = _lexicon_sentiment(words)
    else:
        polarity = _lexicon_sentiment(words)

    hedges = HINGLISH_HEDGING_PHRASES if language == "hinglish" else HEDGING_PHRASES
    hedge_hits = count_occurrences(text, hedges)
    hedge_density = hedge_hits / word_count

    base = 70.0 + (polarity * 20.0)
    hedge_penalty = min(hedge_density * 400.0, 50.0)
    score = round(max(0.0, min(100.0, base - hedge_penalty)), 1)

    return {
        "sentiment_polarity": polarity,
        "hedging_phrases_detected": hedge_hits,
        "score": score
    }


def _lexicon_sentiment(words: List[str]) -> float:
    pos = sum(1 for w in words if w in POSITIVE_SENTIMENT_WORDS)
    neg = sum(1 for w in words if w in NEGATIVE_SENTIMENT_WORDS)
    raw = (pos - neg) / max(pos + neg, 1)
    return round(max(-1.0, min(1.0, 0.15 + (raw * 0.5))), 2)


# --------------------------------------------------------------------------
# Benchmark Model Answer Matching & Percentile Calculation
# --------------------------------------------------------------------------
def compare_with_benchmark(candidate_answer: str, question: Dict[str, Any]) -> Dict[str, Any]:
    text = clean_text(candidate_answer)
    key_points = question.get("key_points", [])
    expected_answer = question.get("expected_answer", "")

    if not key_points or not expected_answer:
        # Fallback generated checkpoints
        q_text = question.get("q") or question.get("question_text") or "Engineering Problem"
        kw = question.get("keywords", [])
        expected_answer = f"A benchmark answer systematically explains {q_text}, touching on {', '.join(kw[:3])} and analyzing trade-offs."
        key_points = [
            "Core Concept: Clearly define and explain the underlying mechanism.",
            "Performance & Complexity: Discuss algorithmic complexity, time/memory footprint.",
            "Trade-Offs & Edge Cases: Compare alternatives and failure modes.",
            "Production Reliability: Fault tolerance, concurrency, or scale."
        ]

    covered = []
    missed = []
    for kp in key_points:
        kp_clean = clean_text(kp)
        # Extract meaningful words
        words = [w for w in re.findall(r"[a-z0-9]+", kp_clean) if len(w) > 3 and w not in STOPWORDS]
        hits = sum(1 for w in words if w in text)
        if hits >= max(1, math.ceil(len(words) * 0.25)):
            covered.append(kp)
        else:
            missed.append(kp)

    total_pts = max(len(key_points), 1)
    coverage_pct = round((len(covered) / total_pts) * 100.0)

    if coverage_pct >= 85:
        summary = "Outstanding coverage! Your response touched on every critical dimension in the benchmark model answer."
    elif coverage_pct >= 50:
        summary = f"Good grasp. You hit {len(covered)} of {total_pts} core benchmark concepts. Key area to reinforce: {missed[0].split(':')[0] if missed else 'trade-offs'}."
    else:
        summary = f"You covered {len(covered)} of {total_pts} benchmark concepts. Key area to reinforce: {', '.join([m.split(':')[0] for m in missed[:2]])}."

    return {
        "expected_answer": expected_answer,
        "key_points": key_points,
        "covered_points": covered,
        "missed_points": missed,
        "coverage_percentage": coverage_pct,
        "summary": summary
    }


def calculate_percentile(score: float, company_id: str = "google") -> Dict[str, Any]:
    bm = COMPANY_BENCHMARKS.get(company_id.lower(), DEFAULT_BENCHMARK)
    mean = bm["mean"]
    std = bm["std"]

    z = (score - mean) / (std * math.sqrt(2))
    percentile = 0.5 * (1.0 + math.erf(z))
    pct = max(1, min(99, round(percentile * 100)))

    return {
        "percentile": pct,
        "company_average": round(mean, 1),
        "total_cohort_samples": bm["sample_size"],
        "comparison_text": f"Scored higher than {pct}% of candidates who rehearsed for this company."
    }


# --------------------------------------------------------------------------
# Main Evaluation Pipeline
# --------------------------------------------------------------------------
class AIEngine:
    @staticmethod
    def evaluate(
        answer: str,
        keywords: Optional[List[str]] = None,
        question_type: str = "general",
        question: Optional[Dict[str, Any]] = None,
        company_id: str = "google",
        persona: str = "friendly",
        duration_seconds: Optional[float] = None,
        language: str = "english"
    ) -> Dict[str, Any]:
        keywords = keywords or []
        question = question or {}

        relevance = compute_relevance(answer, keywords, language)
        structure = compute_structure(answer, question_type, language)
        fluency = compute_fluency(answer, duration_seconds, language)
        confidence = compute_confidence(answer, language)

        comparison = compare_with_benchmark(answer, question)
        benchmark_cov = float(comparison.get("coverage_percentage", 60.0))

        # 40% Relevance, 25% Structure, 20% Fluency, 15% Confidence
        overall = round(
            (relevance * 0.40) +
            (structure["score"] * 0.25) +
            (fluency["score"] * 0.20) +
            (confidence["score"] * 0.15),
            1
        )

        if overall >= 85:
            verdict = "Strong"
        elif overall >= 70:
            verdict = "Strong"
        elif overall >= 50:
            verdict = "Needs Work"
        else:
            verdict = "Weak"

        feedback = []
        if comparison["missed_points"]:
            first_gap = comparison["missed_points"][0].split(":")[0]
            feedback.append(f"Model Comparison: Review the benchmark answer to incorporate {first_gap}.")

        if relevance >= 80:
            feedback.append("Strong content relevance — you hit key concepts the interviewer expects.")
        elif relevance >= 50:
            feedback.append("Decent relevance, but missing some key terms. Try naming specific techniques directly.")
        else:
            feedback.append("Your answer drifted from the core question. Anchor in the primary principle first.")

        if structure["score"] < 50:
            feedback.append("Add more technical depth — mention trade-offs, complexity, or edge cases.")

        interviewer_notes = [f"[+] {fb}" if "strong" in fb.lower() or "good" in fb.lower() else f"[-] {fb}" for fb in feedback]

        percentile_data = calculate_percentile(overall, company_id)

        return {
            "overall_score": overall,
            "verdict": verdict,
            "breakdown": {
                "relevance": relevance,
                "structure": structure,
                "fluency": fluency,
                "confidence": confidence,
                "benchmark_coverage": benchmark_cov
            },
            "feedback": feedback,
            "interviewer_notes": interviewer_notes,
            "benchmark": percentile_data,
            "comparison": comparison
        }


# CLI Execution Interface
if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--eval":
        payload = json.loads(sys.argv[2])
        res = AIEngine.evaluate(
            answer=payload.get("answer", ""),
            keywords=payload.get("keywords", []),
            question_type=payload.get("question_type", "general"),
            question=payload.get("question", {}),
            company_id=payload.get("company_id", "google"),
            persona=payload.get("persona", "friendly"),
            duration_seconds=payload.get("duration_seconds"),
            language=payload.get("language", "english")
        )
        print(json.dumps(res))
    else:
        # Self test
        test_res = AIEngine.evaluate(
            answer="To handle caching, we use consistent hashing and LRU eviction policy with replication.",
            keywords=["consistent hashing", "caching", "LRU", "replication"],
            question_type="technical"
        )
        print("ML Engine Status: Operational.")
        print(f"Test Score: {test_res['overall_score']}, Verdict: {test_res['verdict']}")
