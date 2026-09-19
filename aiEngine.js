import { compareAnswerToBenchmark } from "./dbService.js";

/**
 * aiEngine.js
 * -----------
 * NLP evaluation engine for the AI Interviewer (GreenRoom).
 * Deterministic, offline, lightweight text analysis.
 */

export const FILLER_WORDS = [
  "um", "uh", "umm", "uhh", "like", "you know", "actually", "basically",
  "literally", "sort of", "kind of", "i mean", "so yeah", "right", "okay so"
];

export const HINGLISH_FILLER_WORDS = [
  "um", "uh", "umm", "uhh", "like", "actually", "basically", "literally",
  "matlab", "yaani", "jaise ki", "accha", "toh", "sahi hai", "samjhe",
  "bhai", "waise", "arre", "dekho", "kya bolte hain", "bas", "you know"
];

export const HEDGING_PHRASES = [
  "i guess", "maybe", "not sure", "probably", "i think maybe",
  "i don't know", "kind of", "sort of", "possibly", "i suppose"
];

export const HINGLISH_HEDGING_PHRASES = [
  "i guess", "maybe", "not sure", "probably", "mujhe lagta hai",
  "shayad", "pata nahi", "lagta hai", "pakka nahi hai", "thoda bohot",
  "don't know", "kind of"
];

export const STAR_CUES = {
  situation: ["situation", "context", "at the time", "we were", "the project involved",
    "background", "when i was working", "there was a", "jab main", "project me", "us time"],
  task: ["task", "goal was", "needed to", "objective", "responsible for", "my role was", "had to",
    "karna tha", "mera goal", "target tha", "responsibility"],
  action: ["i did", "i built", "i implemented", "i decided", "i led", "i created",
    "i designed", "so i", "my approach", "i took the initiative", "i started by",
    "maine build kiya", "maine decide kiya", "maine implement kiya", "maine solve kiya"],
  result: ["result", "outcome", "eventually", "in the end", "we achieved", "this led to",
    "as a result", "impact was", "improved", "increased", "reduced", "successfully",
    "result ye hua", "outcome mila", "improve hua", "deliver kiya"]
};

export const TECHNICAL_QUALITY_CUES = [
  "time complexity", "space complexity", "edge case", "trade-off", "tradeoff",
  "big o", "scalability", "concurrency", "consistency", "latency", "throughput"
];

export const COMPANY_BENCHMARKS = {
  google: { mean: 72.5, std: 14.2, sample_size: 4280 },
  amazon: { mean: 71.0, std: 13.8, sample_size: 3950 },
  microsoft: { mean: 73.2, std: 12.9, sample_size: 3610 },
  meta: { mean: 70.8, std: 15.0, sample_size: 3120 },
  apple: { mean: 72.0, std: 14.0, sample_size: 2840 },
  netflix: { mean: 69.5, std: 15.5, sample_size: 2210 },
  adobe: { mean: 74.0, std: 12.5, sample_size: 2490 },
  oracle: { mean: 75.2, std: 11.8, sample_size: 2730 },
  salesforce: { mean: 73.8, std: 12.6, sample_size: 2180 },
  ibm: { mean: 76.0, std: 11.2, sample_size: 3040 },
  tcs: { mean: 78.5, std: 10.5, sample_size: 6500 },
  infosys: { mean: 78.0, std: 10.8, sample_size: 5900 },
  wipro: { mean: 77.8, std: 11.0, sample_size: 4800 },
  accenture: { mean: 76.8, std: 11.5, sample_size: 5200 },
  cognizant: { mean: 77.2, std: 11.2, sample_size: 4600 },
  flipkart: { mean: 72.2, std: 13.5, sample_size: 2980 },
  zomato: { mean: 71.8, std: 14.1, sample_size: 2450 },
  swiggy: { mean: 71.5, std: 14.0, sample_size: 2340 },
  paytm: { mean: 72.8, std: 13.2, sample_size: 2150 },
  goldmansachs: { mean: 70.2, std: 14.8, sample_size: 2890 }
};

export const DEFAULT_BENCHMARK = { mean: 73.0, std: 13.0, sample_size: 3000 };

function escapeRegExp(string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clean(text) {
  return (text || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function countOccurrences(text, phrases) {
  let count = 0;
  for (const p of phrases) {
    const regex = new RegExp(`\\b${escapeRegExp(p)}\\b`, "gi");
    const matches = text.match(regex);
    if (matches) count += matches.length;
  }
  return count;
}

function erf(x) {
  // Abramowitz and Stegun formula 7.1.26
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  const absX = Math.abs(x);
  const t = 1.0 / (1.0 + p * absX);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absX * absX);
  return sign * y;
}

export function calculatePercentile(score, companyId = "google") {
  const bm = COMPANY_BENCHMARKS[(companyId || "").toLowerCase()] || DEFAULT_BENCHMARK;
  const mean = bm.mean;
  const std = bm.std;

  const z = (score - mean) / (std * Math.SQRT2);
  const percentile = 0.5 * (1.0 + erf(z));
  const percentilePct = Math.max(1, Math.min(99, Math.round(percentile * 100)));

  return {
    percentile: percentilePct,
    company_average: Number(mean.toFixed(1)),
    total_cohort_samples: bm.sample_size,
    comparison_text: `Scored higher than ${percentilePct}% of candidates who rehearsed for this company.`
  };
}

const STOPWORDS = new Set([
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
]);

function tokenize(text, filterStopwords = true) {
  const words = clean(text).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  if (!filterStopwords) return words;
  return words.filter(w => !STOPWORDS.has(w) && w.length > 1);
}

export function relevanceScore(answer, keywords = [], language = "english") {
  if (!answer || !answer.trim() || !keywords.length) return 0.0;

  const idealTokens = tokenize((keywords.join(" ") + " ").repeat(3), language !== "hinglish");
  const answerTokens = tokenize(answer, language !== "hinglish");

  if (!idealTokens.length || !answerTokens.length) return 0.0;

  // Build vocabulary
  const vocab = new Map();
  let idx = 0;
  for (const t of idealTokens) {
    if (!vocab.has(t)) vocab.set(t, idx++);
  }
  for (const t of answerTokens) {
    if (!vocab.has(t)) vocab.set(t, idx++);
  }

  // Term frequency vectors
  const v1 = new Float64Array(vocab.size);
  const v2 = new Float64Array(vocab.size);

  for (const t of idealTokens) v1[vocab.get(t)]++;
  for (const t of answerTokens) v2[vocab.get(t)]++;

  // Cosine similarity
  let dot = 0, norm1 = 0, norm2 = 0;
  for (let i = 0; i < vocab.size; i++) {
    dot += v1[i] * v2[i];
    norm1 += v1[i] * v1[i];
    norm2 += v2[i] * v2[i];
  }

  const sim = (norm1 > 0 && norm2 > 0) ? dot / (Math.sqrt(norm1) * Math.sqrt(norm2)) : 0;

  const text = clean(answer);
  let hits = 0;
  for (const k of keywords) {
    if (text.includes(clean(k))) hits++;
  }
  const keywordCoverage = hits / Math.max(keywords.length, 1);

  const blended = (sim * 0.6) + (keywordCoverage * 0.4);
  return Number((Math.min(blended, 1.0) * 100).toFixed(1));
}

export function structureScore(answer, questionType = "general", language = "english") {
  const text = clean(answer);

  if (questionType === "behavioral") {
    const present = {};
    for (const [part, cues] of Object.entries(STAR_CUES)) {
      present[part] = countOccurrences(text, cues) > 0;
    }
    const covered = Object.values(present).filter(Boolean).length;
    const score = Number(((covered / 4) * 100).toFixed(1));
    return { framework: "STAR", covered_parts: present, score };
  }

  if (questionType === "technical" || questionType === "system_design") {
    const depthHits = countOccurrences(text, TECHNICAL_QUALITY_CUES);
    const score = Number((Math.min(depthHits / 3, 1.0) * 100).toFixed(1));
    return { framework: "Technical Depth", depth_signals: depthHits, score };
  }

  return { framework: "General", score: 60.0 };
}

export function fluencyScore(answer, durationSeconds = null, language = "english") {
  const text = clean(answer);
  const words = text ? text.split(/\s+/) : [];
  const wordCount = words.length;

  const fillersList = language === "hinglish" ? HINGLISH_FILLER_WORDS : FILLER_WORDS;
  const fillerHits = countOccurrences(text, fillersList);
  const fillerDensity = fillerHits / Math.max(wordCount, 1);

  let wpm = null;
  let paceScore = 80.0;
  if (durationSeconds && durationSeconds > 0) {
    wpm = Number((wordCount / (durationSeconds / 60)).toFixed(1));
    if (wpm >= 110 && wpm <= 160) paceScore = 100.0;
    else if ((wpm >= 90 && wpm < 110) || (wpm > 160 && wpm <= 180)) paceScore = 80.0;
    else if ((wpm >= 70 && wpm < 90) || (wpm > 180 && wpm <= 200)) paceScore = 60.0;
    else paceScore = 40.0;
  }

  const fillerPenalty = Math.min(fillerDensity * 300, 60);
  const fluency = Math.max(0.0, 100 - fillerPenalty);
  const combined = Number(((fluency * 0.6) + (paceScore * 0.4)).toFixed(1));

  return {
    word_count: wordCount,
    filler_word_hits: fillerHits,
    filler_density_pct: Number((fillerDensity * 100).toFixed(1)),
    words_per_minute: wpm,
    score: combined
  };
}

const POSITIVE_SENTIMENT_WORDS = new Set([
  "good", "great", "excellent", "solved", "optimized", "successfully", "improved",
  "effective", "efficient", "scaled", "delivered", "achieved", "strong", "best",
  "confident", "clear", "benefit", "positive", "solution", "proud"
]);

const NEGATIVE_SENTIMENT_WORDS = new Set([
  "bad", "fail", "failed", "error", "issue", "bug", "broken", "terrible", "struggled",
  "confused", "stuck", "problem", "difficult", "hard", "crash", "loss", "bottleneck"
]);

export function confidenceScore(answer, language = "english") {
  const text = clean(answer);
  const words = text ? text.split(/\s+/) : [];
  const wordCount = Math.max(words.length, 1);

  let posCount = 0;
  let negCount = 0;
  for (const w of words) {
    if (POSITIVE_SENTIMENT_WORDS.has(w)) posCount++;
    if (NEGATIVE_SENTIMENT_WORDS.has(w)) negCount++;
  }

  // Polarity between -1 and +1, slight positive baseline for interview answer
  const rawPolarity = (posCount - negCount) / Math.max(posCount + negCount, 1);
  const polarity = Number(Math.max(-1.0, Math.min(1.0, 0.15 + (rawPolarity * 0.5))).toFixed(2));

  const hedgesList = language === "hinglish" ? HINGLISH_HEDGING_PHRASES : HEDGING_PHRASES;
  const hedges = countOccurrences(text, hedgesList);
  const hedgeDensity = hedges / wordCount;

  const base = 70 + (polarity * 20);
  const hedgePenalty = Math.min(hedgeDensity * 400, 50);
  const score = Number(Math.max(0.0, Math.min(100.0, base - hedgePenalty)).toFixed(1));

  return {
    sentiment_polarity: polarity,
    hedging_phrases_detected: hedges,
    score
  };
}

export function generateFeedback(overall, relevance, structure, fluency, confidence, questionType, persona = "friendly", language = "english") {
  const feedback = [];

  const pTech = persona === "technical";
  const pBar = persona === "barraiser";
  const isHinglish = language === "hinglish";

  // 1. Relevance feedback
  if (relevance >= 80) {
    if (isHinglish) feedback.push("Content relevance kaafi solid hai — core concepts directly hit kiye.");
    else if (pTech) feedback.push("Solid technical coverage. Core architecture and concepts addressed.");
    else if (pBar) feedback.push("Relevance on point. Demonstrates genuine mastery of fundamentals.");
    else feedback.push("Strong content relevance — you hit the key concepts the interviewer is listening for.");
  } else if (relevance >= 50) {
    if (isHinglish) feedback.push("Relevance theek hai, but kuch key technical terms miss ho gaye. Specific concepts direct mention karo.");
    else if (pTech) feedback.push("Partial coverage. Missing key technical trade-offs.");
    else if (pBar) feedback.push("Adequate but surface-level. Must dive deeper into trade-offs.");
    else feedback.push("Decent relevance, but you're missing some key terms/concepts. Try naming the specific technique or principle directly.");
  } else {
    if (isHinglish) feedback.push("Answer question ke core topic se drift kar gaya. Pehle main concept define karo fir detail me jao.");
    else if (pTech) feedback.push("Missed the target. Technical fundamentals unclear.");
    else if (pBar) feedback.push("Off-target. Lacks the depth required for this bar.");
    else feedback.push("Your answer drifted from what this question is really asking. Anchor your response in the core concept first, then elaborate.");
  }

  // 2. Structure feedback
  if (questionType === "behavioral") {
    const missing = Object.entries(structure.covered_parts || {})
      .filter(([_, v]) => !v)
      .map(([k]) => k.charAt(0).toUpperCase() + k.slice(1));

    if (missing.length > 0) {
      const missingStr = missing.join(", ");
      if (isHinglish) feedback.push(`STAR framework me ${missingStr} missing tha. Story ko complete closure do.`);
      else if (pTech) feedback.push(`STAR narrative incomplete. Missing: ${missingStr}.`);
      else if (pBar) feedback.push(`Critical gaps in narrative structure: ${missingStr}. Needs concrete data/impact.`);
      else feedback.push(`Your STAR structure is missing: ${missingStr}. Add this to make the story land.`);
    } else {
      if (isHinglish) feedback.push("Bohot badiya STAR structure — Situation, Task, Action aur Result sab clearly present the.");
      else if (pTech) feedback.push("STAR structure complete. Good narrative flow and ownership.");
      else if (pBar) feedback.push("Structured execution. Good ownership demonstrated.");
      else feedback.push("Great STAR structure — Situation, Task, Action and Result were all present.");
    }
  } else if (questionType === "technical" || questionType === "system_design") {
    if ((structure.score || 0) < 50) {
      if (isHinglish) feedback.push("Technical depth badhao — time/space complexity, edge cases aur scalability trade-offs explain karo.");
      else if (pTech) feedback.push("Lacks technical rigor. Discuss Big-O, edge cases, and horizontal scaling.");
      else if (pBar) feedback.push("Superficial analysis. I need to see boundary conditions and failure modes.");
      else feedback.push("Add more technical depth — mention time/space complexity, trade-offs, or scalability considerations.");
    } else {
      if (isHinglish) feedback.push("Achha technical depth — complexity aur trade-offs cover kiye, jo interviewers notice karte hain.");
      else if (pTech) feedback.push("Strong technical depth. Complexity and system trade-offs well articulated.");
      else if (pBar) feedback.push("Rigorous technical reasoning. Demonstrates senior-level intuition.");
      else feedback.push("Good technical depth — you referenced trade-offs and complexity, which interviewers love to hear.");
    }
  }

  // 3. Fluency & Pace feedback
  if (fluency.filler_density_pct > 7) {
    if (isHinglish) feedback.push(`Filler words thode zyada use huye (${fluency.filler_density_pct}% words). Gap aane par silent pause lene ki practice karo.`);
    else if (pTech) feedback.push(`High filler density (${fluency.filler_density_pct}%). Practice silent pauses.`);
    else if (pBar) feedback.push(`Filler density (${fluency.filler_density_pct}%) signals uncertainty. Speak with deliberate economy.`);
    else feedback.push(`You used filler words fairly often (${fluency.filler_density_pct}% of words). Practice pausing silently instead.`);
  }

  if (fluency.words_per_minute) {
    const wpm = fluency.words_per_minute;
    if (wpm > 175) {
      if (isHinglish) feedback.push(`Speed kaafi fast thi (${wpm} WPM). Thoda aaram se bolo taaki interviewer easily samajh sake.`);
      else if (pTech) feedback.push(`Pace too fast (${wpm} wpm). Slow down for architectural clarity.`);
      else if (pBar) feedback.push(`Rushed delivery (${wpm} wpm). Maintain composure under pressure.`);
      else feedback.push(`You spoke quite fast (${wpm} wpm). Slow down slightly so the interviewer can follow your logic.`);
    } else if (wpm < 85) {
      if (isHinglish) feedback.push(`Pace thoda slow tha (${wpm} WPM). Thoda energy aur confidence increase karo.`);
      else if (pTech) feedback.push(`Pace too slow (${wpm} wpm). Increase cadence and momentum.`);
      else if (pBar) feedback.push(`Hesitant delivery (${wpm} wpm). Projects lack of conviction.`);
      else feedback.push(`Your pace was slow (${wpm} wpm). A bit more energy will help you sound more confident.`);
    }
  }

  // 4. Confidence & Hedging feedback
  if (confidence.hedging_phrases_detected > 2) {
    if (isHinglish) feedback.push("Hedging phrases ('mujhe lagta hai', 'maybe') zyada the. Apne solution pe direct stand lo.");
    else if (pTech) feedback.push("Excessive hedging detected. State technical reasoning assertively.");
    else if (pBar) feedback.push("Too much ambiguity in phrasing. Own your assertions.");
    else feedback.push("You hedged a lot ('I guess', 'maybe', 'not sure'). State your reasoning directly, even if you're not 100% certain.");
  }

  // 5. Overall summary verdict
  if (overall >= 85) {
    if (isHinglish) feedback.push("Overall: Top notch performance — interview-ready answer! Bas minor polish chahiye.");
    else if (pTech) feedback.push("Overall: Clear pass. Ready for onsite technical rounds.");
    else if (pBar) feedback.push("Overall: Strongly above the bar. High-conviction hire signal.");
    else feedback.push("Overall: Interview-ready answer. Minor polish only.");
  } else if (overall >= 65) {
    if (isHinglish) feedback.push("Overall: Achha attempt hai, thodi structure aur confidence ki polishing se solid ban jayega.");
    else if (pTech) feedback.push("Overall: Acceptable baseline, needs sharper technical precision.");
    else if (pBar) feedback.push("Overall: Borderline. Needs more decisive reasoning and depth.");
    else feedback.push("Overall: Solid foundation, needs sharper structure and confidence.");
  } else {
    if (isHinglish) feedback.push("Overall: Rework ki zaroorat hai — core concepts dobara prepare karke 2-3 baar bol ke practice karo.");
    else if (pTech) feedback.push("Overall: Below technical threshold. Revisit core principles.");
    else if (pBar) feedback.push("Overall: Significant gaps. Does not meet the hiring bar yet.");
    else feedback.push("Overall: Needs significant rework — revisit the core concept and practice this answer aloud 2-3 times.");
  }

  return feedback;
}

export function formatInterviewerNotes(feedback = []) {
  const notes = [];
  for (const item of feedback) {
    const lower = item.toLowerCase();
    const summary = item.split("—")[0].replace("Overall:", "").trim();
    if (["strong", "solid", "great", "excellent", "top notch", "on point", "achha", "badiya", "clear pass"].some(w => lower.includes(w))) {
      notes.push(`[+] ${summary}`);
    } else if (["missing", "weak", "lacks", "drifted", "off-target", "below", "gaps", "rework"].some(w => lower.includes(w))) {
      notes.push(`[-] ${summary}`);
    } else {
      notes.push(`[?] ${summary}`);
    }
  }
  return notes;
}

export function evaluateAnswer(question, answer, durationSeconds = null, persona = "friendly", language = "english", companyId = "google") {
  const qType = question?.type || "general";
  const keywords = question?.keywords || [];

  const rel = relevanceScore(answer, keywords, language);
  const struct = structureScore(answer, qType, language);
  const fl = fluencyScore(answer, durationSeconds, language);
  const conf = confidenceScore(answer, language);

  // Compare candidate answer against model benchmark answer stored in database
  const comparison = compareAnswerToBenchmark(answer, question);
  const coverageBonus = (comparison.coverage_percentage - 50) * 0.1; // -5 to +5 adjustment

  const overall = Number(Math.max(0, Math.min(100, (
    (rel * 0.35) + (struct.score * 0.20) + (fl.score * 0.15) + (conf.score * 0.10) + (comparison.coverage_percentage * 0.20) + coverageBonus
  ))).toFixed(1));

  let verdict = "Weak";
  if (overall >= 85) verdict = "Excellent";
  else if (overall >= 70) verdict = "Strong";
  else if (overall >= 50) verdict = "Needs Work";

  const feedback = generateFeedback(overall, rel, struct, fl, conf, qType, persona, language);

  if (comparison.missed_points.length > 0) {
    const mainMissed = comparison.missed_points[0].split(":")[0];
    feedback.unshift(`Model Comparison: Review the benchmark answer to incorporate ${mainMissed}.`);
  } else if (comparison.covered_points.length > 0) {
    feedback.unshift(`Model Comparison: Comprehensive answer matching the benchmark criteria!`);
  }

  const interviewerNotes = formatInterviewerNotes(feedback);
  const benchmark = calculatePercentile(overall, companyId);

  return {
    overall_score: overall,
    verdict,
    breakdown: {
      relevance: rel,
      structure: struct,
      fluency: fl,
      confidence: conf,
      benchmark_coverage: comparison.coverage_percentage
    },
    feedback,
    interviewer_notes: interviewerNotes,
    benchmark,
    comparison: {
      expected_answer: comparison.expected_answer,
      key_points: comparison.key_points,
      covered_points: comparison.covered_points,
      missed_points: comparison.missed_points,
      coverage_percentage: comparison.coverage_percentage,
      summary: comparison.summary
    }
  };
}
