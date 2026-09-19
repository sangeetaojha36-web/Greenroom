import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import * as aiEngine from "./aiEngine.js";
import * as dbService from "./dbService.js";
import embeddedQuestionBank from "./data/question_bank_data.js";

const execFileAsync = promisify(execFile);

async function evaluateWithPythonOrJs(question, answer, duration, persona, language, companyId) {
  try {
    const payload = JSON.stringify({
      answer,
      keywords: question.keywords || [],
      question_type: question.type || "general",
      question,
      company_id: companyId,
      persona,
      duration_seconds: duration,
      language
    });
    const { stdout } = await execFileAsync("python3", [path.join(__dirname, "backend", "ai_engine.py"), "--eval", payload], { timeout: 3500 });
    const pyResult = JSON.parse(stdout.trim());
    if (pyResult && pyResult.overall_score !== undefined) {
      return pyResult;
    }
  } catch (err) {
    // Fall back gracefully to native JS aiEngine
  }
  return aiEngine.evaluateAnswer(question, answer, duration, persona, language, companyId);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function getFrontendDir() {
  const candidates = [
    path.join(__dirname, "frontend"),
    path.join(process.cwd(), "frontend"),
    path.join(process.cwd(), "Greenroom-main", "frontend"),
    path.join(__dirname, "..", "frontend")
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(__dirname, "frontend");
}

const app = express();
const PORT = 3000;
const FRONTEND_DIR = getFrontendDir();

app.use(cors());
app.use(express.json());

// API route normalizer: handles serverless environments where /api prefix may be stripped or present
app.use((req, res, next) => {
  if (!req.url.startsWith("/api") && (
    req.url.startsWith("/companies") ||
    req.url.startsWith("/company") ||
    req.url.startsWith("/questions") ||
    req.url.startsWith("/evaluate") ||
    req.url.startsWith("/report") ||
    req.url.startsWith("/benchmark") ||
    req.url.startsWith("/db") ||
    req.url.startsWith("/auth")
  )) {
    req.url = "/api" + req.url;
  }
  next();
});

// Initialize question bank with gold standard model answers
dbService.initQuestionBank().catch(err => console.warn("Background DB init note:", err.message));

// Load Question Bank with multi-tier resilient fallback
let QUESTION_BANK = embeddedQuestionBank?.companies || [];
try {
  const qbCandidates = [
    path.join(__dirname, "data", "question_bank.json"),
    path.join(process.cwd(), "data", "question_bank.json"),
    path.join(process.cwd(), "Greenroom-main", "data", "question_bank.json"),
    path.join(__dirname, "..", "data", "question_bank.json")
  ];
  for (const qbPath of qbCandidates) {
    if (fs.existsSync(qbPath)) {
      const qbRaw = fs.readFileSync(qbPath, "utf-8");
      const parsed = JSON.parse(qbRaw);
      if (parsed.companies && parsed.companies.length) {
        QUESTION_BANK = parsed.companies;
        break;
      }
    }
  }
} catch (err) {
  console.warn("Using embedded question bank fallback:", err.message);
}
const COMPANY_INDEX = new Map(QUESTION_BANK.map(c => [c.id, c]));

const CULTURE_BRIEFS = {
  google: {
    what_they_value: "Googleyness, intellectual humility, navigating ambiguity, scalable system thinking, trade-off clarity.",
    scoring_emphasis: "Clean structural thinking, discussing trade-offs before choosing an approach, and collaborative mindset.",
    red_flags: "Jumping straight into code without clarifying constraints, ignoring edge cases, or being defensive during hints.",
    pro_tip: "Always state your assumptions out loud and verify Big-O complexity upfront."
  },
  amazon: {
    what_they_value: "16 Leadership Principles (Customer Obsession, Bias for Action, Ownership, Deliver Results, Invent & Simplify).",
    scoring_emphasis: "STAR-method storytelling with quantifiable business metrics and high ownership.",
    red_flags: "Saying 'we did' instead of 'I did', lacking data/metrics, or failing to admit mistakes.",
    pro_tip: "Prepare 2 distinct real stories for each top Leadership Principle."
  },
  microsoft: {
    what_they_value: "Growth mindset, collaborative design, learning from failure, platform & cloud thinking.",
    scoring_emphasis: "How you receive feedback, iterate on architecture, and empathize with diverse end-users.",
    red_flags: "Fixed mindset, dismissing alternative approaches, or ignoring accessibility and enterprise constraints.",
    pro_tip: "Show enthusiasm for learning new tech stacks and adapting to customer needs."
  },
  meta: {
    what_they_value: "Velocity ('Move Fast'), massive scale, bottom-up impact, iterative execution.",
    scoring_emphasis: "Speed of problem-solving, clean algorithmic intuition, and designing for billions of users.",
    red_flags: "Over-engineering simple problems or getting paralyzed by missing specifications.",
    pro_tip: "Get a working baseline down quickly, then optimize bottlenecks iteratively."
  },
  apple: {
    what_they_value: "Pixel-level craft, confidentiality, obsessive attention to detail, privacy-first engineering.",
    scoring_emphasis: "Extreme care for user experience, memory efficiency, and flawless edge-case handling.",
    red_flags: "Treating user experience as a secondary afterthought or sloppy code architecture.",
    pro_tip: "Demonstrate passion for seamless hardware-software integration."
  },
  netflix: {
    what_they_value: "Freedom & Responsibility, extreme candor, high context without control, mature autonomy.",
    scoring_emphasis: "High-conviction decision making, fault-tolerant distributed systems, and clear communication.",
    red_flags: "Needing constant micro-management or being uncomfortable with direct constructive feedback.",
    pro_tip: "Explain how you made high-stakes decisions independently with full accountability."
  },
  adobe: {
    what_they_value: "Creativity tools, cross-platform performance, visual fidelity, developer empathy.",
    scoring_emphasis: "Multi-threaded rendering responsiveness, state management, and user productivity.",
    red_flags: "Ignoring desktop/mobile platform nuances or UI latency.",
    pro_tip: "Discuss undo/redo stacks, memory management, and smooth 60fps UX."
  },
  oracle: {
    what_they_value: "Database internals, enterprise reliability, zero downtime, ACID guarantees.",
    scoring_emphasis: "Deep knowledge of indexing, query plans, concurrency locks, and failover strategies.",
    red_flags: "Vagueness around database transactions or distributed consistency.",
    pro_tip: "Highlight familiarity with high availability and mission-critical SLAs."
  },
  salesforce: {
    what_they_value: "Multi-tenant cloud architecture, customer success mindset, Ohana team culture.",
    scoring_emphasis: "Secure tenant isolation, metadata-driven platforms, and enterprise business impact.",
    red_flags: "Security oversights in data isolation or lack of user empathy.",
    pro_tip: "Emphasize trust, scalability, and measurable customer outcomes."
  },
  ibm: {
    what_they_value: "Enterprise AI trust, explainability, legacy modernization, consulting clarity.",
    scoring_emphasis: "Translating technical complexities into business ROI and ethical AI principles.",
    red_flags: "Treating AI as a black box without explainability or governance.",
    pro_tip: "Structure your answers with clear executive summaries."
  },
  tcs: {
    what_they_value: "Rock-solid CS fundamentals (OOP, DBMS, DSA), communication clarity, professional demeanor.",
    scoring_emphasis: "Clear explanations of core OOP concepts, normalization, and willingness to learn.",
    red_flags: "Memorized answers without understanding real-world application.",
    pro_tip: "Use clear real-world analogies for OOP and database concepts."
  },
  infosys: {
    what_they_value: "Algorithmic logic, clean pseudocode, analytical aptitude, strong learning agility.",
    scoring_emphasis: "Step-by-step problem breakdown, error-free logic, and cultural adaptability.",
    red_flags: "Rushing through logic without dry-running test inputs.",
    pro_tip: "Walk the interviewer through your pseudocode step-by-step."
  },
  wipro: {
    what_they_value: "Core CS principles, cloud fundamentals, teamwork, client service orientation.",
    scoring_emphasis: "Structured technical explanations and client problem-solving orientation.",
    red_flags: "Inability to explain your own academic or internship projects.",
    pro_tip: "Know every project on your resume in deep detail."
  },
  accenture: {
    what_they_value: "Consulting problem solving, agile execution, digital transformation mindset.",
    scoring_emphasis: "Structured communication, client empathy, and cross-functional collaboration.",
    red_flags: "Overly narrow technical view without considering business feasibility.",
    pro_tip: "Balance technical rigor with clear business value propositions."
  },
  cognizant: {
    what_they_value: "Domain knowledge, software engineering best practices, exception handling.",
    scoring_emphasis: "Writing clean, production-ready code with comprehensive test coverage.",
    red_flags: "Ignoring error handling or basic testing principles.",
    pro_tip: "Always mention unit testing and boundary condition handling."
  },
  flipkart: {
    what_they_value: "E-commerce scale, flash sale concurrency, high ownership, fast execution.",
    scoring_emphasis: "Handling race conditions, caching strategies, and inventory atomicity.",
    red_flags: "Naive database locking that degrades during high-concurrency traffic.",
    pro_tip: "Discuss Redis caching, distributed locks, and message queues for asynchronous processing."
  },
  zomato: {
    what_they_value: "Real-time logistics, geospatial ranking, speed of delivery, scrappy execution.",
    scoring_emphasis: "Low-latency search, ranking algorithms, and intuitive product sense.",
    red_flags: "Theoretical designs that cannot handle sudden dinner-rush traffic spikes.",
    pro_tip: "Focus on geospatial indexing (QuadTree/H3) and real-time WebSockets."
  },
  swiggy: {
    what_they_value: "Hyperlocal dispatch optimization, resilient microservices, logistical data analysis.",
    scoring_emphasis: "Matching algorithms, surge pricing analysis, and infrastructure autoscaling.",
    red_flags: "Ignoring rider network dynamics or cold-start delivery problems.",
    pro_tip: "Combine algorithmic efficiency with operational realities."
  },
  paytm: {
    what_they_value: "Fintech security, payment idempotency, fraud detection, regulatory compliance.",
    scoring_emphasis: "Zero data loss, double-entry ledger consistency, and distributed transactions.",
    red_flags: "Lacking idempotency or ignoring transaction reconciliation.",
    pro_tip: "Emphasize two-phase commits, idempotency keys, and fraud monitoring."
  },
  goldmansachs: {
    what_they_value: "Mathematical precision, low latency, financial markets mindset, Big-O mastery.",
    scoring_emphasis: "Optimal space-time trade-offs, multi-threading synchronization, and high rigor.",
    red_flags: "Sub-optimal algorithmic complexity or hand-waving memory limits.",
    pro_tip: "Analyze worst-case and average-case complexity with mathematical precision."
  }
};

const DEFAULT_CULTURE = {
  what_they_value: "Strong CS fundamentals, clear structured communication, and high ownership.",
  scoring_emphasis: "STAR-method narrative, architectural depth, and crisp articulation.",
  red_flags: "Vague answers without concrete technical details.",
  pro_tip: "Clarify requirements early and communicate your thoughts aloud."
};

function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function mean(numbers) {
  if (!numbers.length) return 0;
  return numbers.reduce((a, b) => a + b, 0) / numbers.length;
}

// ---------------------------------------------------------------------------
// API Routes
// ---------------------------------------------------------------------------
app.get("/api/companies", (req, res) => {
  const summary = QUESTION_BANK.map(c => {
    const cid = c.id;
    const culture = CULTURE_BRIEFS[cid] || DEFAULT_CULTURE;
    const benchmarkInfo = aiEngine.COMPANY_BENCHMARKS[cid] || aiEngine.DEFAULT_BENCHMARK;
    return {
      id: cid,
      name: c.name,
      accent: c.accent,
      difficulty: c.difficulty,
      focus: c.focus,
      rounds: c.rounds,
      roles: Object.keys(c.roles || {}),
      culture_brief: culture,
      benchmark_avg: benchmarkInfo.mean,
      total_candidates: benchmarkInfo.sample_size
    };
  });
  res.json(summary);
});

app.get("/api/company/:company_id", (req, res) => {
  const companyId = req.params.company_id;
  const c = COMPANY_INDEX.get(companyId);
  if (!c) {
    return res.status(404).json({ error: "Company not found" });
  }
  const data = {
    ...c,
    culture_brief: CULTURE_BRIEFS[companyId] || DEFAULT_CULTURE,
    benchmark_stats: aiEngine.COMPANY_BENCHMARKS[companyId] || aiEngine.DEFAULT_BENCHMARK
  };
  res.json(data);
});

app.get("/api/benchmark/:company_id", (req, res) => {
  const companyId = req.params.company_id;
  const score = parseFloat(req.query.score || "70.0");
  const bm = aiEngine.calculatePercentile(score, companyId);
  res.json(bm);
});

app.get("/api/questions/:company_id", (req, res) => {
  const companyId = req.params.company_id;
  const c = COMPANY_INDEX.get(companyId);
  if (!c) {
    return res.status(404).json({ error: "Company not found" });
  }

  const roleKeys = Object.keys(c.roles || {});
  const role = req.query.role || roleKeys[0] || "Software Engineer";
  const count = parseInt(req.query.count || "6", 10);
  const requestedLevel = (req.query.level || "mid").toLowerCase(); // "junior", "mid", "senior", "all"

  const allRoleQuestions = c.roles?.[role] || [];
  const allBehavioral = c.behavioral || [];
  const allHr = c.hr || [];

  // Filter or sort pool according to level
  const filterByLevel = (pool, targetLevel) => {
    if (targetLevel === "all") return shuffle(pool);
    const exact = pool.filter(q => q.level === targetLevel);
    const fallback = pool.filter(q => q.level !== targetLevel);
    // If not enough exact questions, pad with fallback
    return [...shuffle(exact), ...shuffle(fallback)];
  };

  const technicalPool = filterByLevel(allRoleQuestions, requestedLevel);
  const behavioralPool = filterByLevel(allBehavioral, requestedLevel);
  const hrPool = filterByLevel(allHr, requestedLevel);

  const nTech = Math.max(1, Math.round(count * 0.5));
  const nBeh = Math.max(1, Math.round(count * 0.3));
  const nHr = Math.max(1, count - nTech - nBeh);

  const selected = shuffle([
    ...technicalPool.slice(0, nTech),
    ...behavioralPool.slice(0, nBeh),
    ...hrPool.slice(0, nHr)
  ]).map(q => {
    const bench = dbService.generateBenchmarkForQuestion(q, c.name);
    return {
      ...q,
      level: q.level || (requestedLevel === "all" ? "mid" : requestedLevel),
      expected_answer: q.expected_answer || bench.expected_answer,
      key_points: q.key_points || bench.key_points,
      genuine: true
    };
  });

  res.json({
    company: c.name,
    company_id: c.id,
    role,
    level: requestedLevel,
    culture_brief: CULTURE_BRIEFS[companyId] || DEFAULT_CULTURE,
    questions: selected.slice(0, count),
    all_technical: technicalPool.map(q => ({ ...q, level: q.level || "mid" })),
    all_behavioral: behavioralPool.map(q => ({ ...q, level: q.level || "mid" })),
    all_hr: hrPool.map(q => ({ ...q, level: q.level || "mid" }))
  });
});

app.post("/api/evaluate", async (req, res) => {
  const data = req.body || {};
  let question = {
    type: data.question_type || "general",
    keywords: data.keywords || [],
    q: data.question_text || "",
    level: data.level || "mid"
  };

  if (data.question_id) {
    const dbQ = await dbService.getQuestionById(data.question_id);
    if (dbQ) {
      question = { ...dbQ, ...question };
    }
  }

  const answer = data.answer || "";
  const duration = data.duration_seconds;
  const persona = data.persona || "friendly";
  const language = data.language || "english";
  const companyId = data.company_id || "google";

  const result = await evaluateWithPythonOrJs(
    question,
    answer,
    duration,
    persona,
    language,
    companyId
  );
  result.question_id = data.question_id;

  // If candidate is in an active session, save response to database
  if (data.interview_id) {
    dbService.saveCandidateResponse({
      interview_id: data.interview_id,
      user_id: data.user_id || "default_user",
      question_id: data.question_id || "",
      question_text: data.question_text || question.q || "",
      question_type: question.type || "technical",
      level: question.level || "mid",
      candidate_answer: answer,
      expected_answer: result.comparison?.expected_answer || "",
      key_points: result.comparison?.key_points || [],
      covered_points: result.comparison?.covered_points || [],
      missed_points: result.comparison?.missed_points || [],
      overall_score: result.overall_score || 0,
      breakdown: result.breakdown || {},
      feedback: result.feedback || [],
      interviewer_notes: result.interviewer_notes || [],
      duration_seconds: duration || 0
    }).catch(e => console.warn("Async response save notice:", e.message));
  }

  res.json(result);
});

app.post("/api/report", async (req, res) => {
  const data = req.body || {};
  const results = data.results || [];
  const companyId = data.company_id || "google";

  if (!results.length) {
    return res.status(400).json({ error: "No results submitted" });
  }

  const overallScores = results.map(r => parseFloat(r.overall_score || 0));
  const relevance = results.map(r => parseFloat(r.breakdown?.relevance || 0));
  const structure = results.map(r => parseFloat(r.breakdown?.structure?.score || 0));
  const fluency = results.map(r => parseFloat(r.breakdown?.fluency?.score || 0));
  const confidence = results.map(r => parseFloat(r.breakdown?.confidence?.score || 0));

  const radar = {
    Relevance: Number(mean(relevance).toFixed(1)),
    Structure: Number(mean(structure).toFixed(1)),
    Fluency: Number(mean(fluency).toFixed(1)),
    Confidence: Number(mean(confidence).toFixed(1))
  };

  let strongest = "Relevance";
  let weakest = "Relevance";
  let maxVal = -Infinity;
  let minVal = Infinity;

  for (const [key, val] of Object.entries(radar)) {
    if (val > maxVal) { maxVal = val; strongest = key; }
    if (val < minVal) { minVal = val; weakest = key; }
  }

  const verdictAvg = Number(mean(overallScores).toFixed(1));
  let hireVerdict = "No Hire (yet)";
  if (verdictAvg >= 85) hireVerdict = "Strong Hire";
  else if (verdictAvg >= 70) hireVerdict = "Hire";
  else if (verdictAvg >= 50) hireVerdict = "Borderline";

  const benchmark = aiEngine.calculatePercentile(verdictAvg, companyId);

  // Persist session to Firestore database
  let savedSessionId = null;
  try {
    const compObj = COMPANY_INDEX.get(companyId);
    const sessionRecord = {
      id: data.interview_id || `iv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      user_id: data.user_id || "default_user",
      company_id: companyId,
      company_name: compObj?.name || data.company_name || companyId,
      role: data.role || "Software Engineer",
      level: data.level || "mid",
      format: data.format || "onsite",
      persona: data.persona || "friendly",
      language: data.language || "english",
      overall_score: verdictAvg,
      hire_verdict: hireVerdict,
      radar,
      strongest_area: strongest,
      weakest_area: weakest,
      questions_count: results.length,
      duration_seconds: data.duration_seconds || 0,
      created_at: new Date().toISOString()
    };
    const saved = await dbService.saveInterviewSession(sessionRecord);
    savedSessionId = saved.id;

    // Save all question responses to Firestore
    for (const r of results) {
      await dbService.saveCandidateResponse({
        interview_id: savedSessionId,
        user_id: sessionRecord.user_id,
        question_id: r.question_id || "",
        question_text: r.question_text || r.q || "",
        question_type: r.question_type || "technical",
        level: r.level || sessionRecord.level,
        candidate_answer: r.answer || "",
        expected_answer: r.comparison?.expected_answer || "",
        key_points: r.comparison?.key_points || [],
        covered_points: r.comparison?.covered_points || [],
        missed_points: r.comparison?.missed_points || [],
        overall_score: r.overall_score || 0,
        breakdown: r.breakdown || {},
        feedback: r.feedback || [],
        interviewer_notes: r.interviewer_notes || [],
        duration_seconds: r.duration_seconds || 0
      });
    }
  } catch (err) {
    console.warn("Error saving interview session to database:", err.message);
  }

  res.json({
    overall_average: verdictAvg,
    hire_verdict: hireVerdict,
    radar,
    strongest_area: strongest,
    weakest_area: weakest,
    questions_answered: results.length,
    benchmark,
    per_question: results,
    interview_id: savedSessionId,
    saved_to_database: Boolean(savedSessionId)
  });
});

/* ---------------------------------------------------------------------------
   Database & Performance Records Endpoints
   --------------------------------------------------------------------------- */
app.get("/api/db/history", async (req, res) => {
  try {
    const userId = req.query.user_id || "default_user";
    const history = await dbService.getUserInterviewHistory(userId);
    res.json({ user_id: userId, interviews: history });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch interview history", message: err.message });
  }
});

app.get("/api/db/interview/:id", async (req, res) => {
  try {
    const session = await dbService.getInterviewSession(req.params.id);
    if (!session) {
      return res.status(404).json({ error: "Interview session not found in database" });
    }
    const responses = await dbService.getResponsesForInterview(req.params.id);
    res.json({ session, responses });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch interview details", message: err.message });
  }
});

app.get("/api/db/user", async (req, res) => {
  try {
    const userId = req.query.user_id || "default_user";
    const user = await dbService.getUserProfile(userId);
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch user profile", message: err.message });
  }
});

app.post("/api/db/user", async (req, res) => {
  try {
    const updated = await dbService.saveUserProfile(req.body || {});
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: "Failed to update user profile", message: err.message });
  }
});

app.get("/api/db/question/:id", async (req, res) => {
  try {
    const q = await dbService.getQuestionById(req.params.id);
    if (!q) {
      return res.status(404).json({ error: "Question not found" });
    }
    res.json(q);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch question", message: err.message });
  }
});

/* ---------------------------------------------------------------------------
   Authentication Endpoints (Manual + Google + LinkedIn + GitHub)
   --------------------------------------------------------------------------- */
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password, target_role, target_company, experience_level, language } = req.body || {};
    const user = await dbService.registerUser({
      name,
      email,
      password,
      target_role,
      target_company,
      experience_level,
      language
    });
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const user = await dbService.authenticateUser(email, password);
    res.json({ success: true, user });
  } catch (err) {
    res.status(401).json({ success: false, error: err.message });
  }
});

app.post("/api/auth/social", async (req, res) => {
  try {
    const { provider, email, name, avatar, provider_id, target_role, target_company, experience_level } = req.body || {};
    const user = await dbService.socialAuthUser({
      provider: provider || "google",
      email,
      name,
      avatar,
      provider_id,
      target_role,
      target_company,
      experience_level
    });
    res.json({ success: true, user });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

app.get("/api/auth/me", async (req, res) => {
  try {
    const userId = req.query.user_id;
    if (!userId) {
      return res.status(400).json({ error: "user_id is required" });
    }
    const user = await dbService.getUserProfile(userId);
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get("/api/db/status", (req, res) => {
  res.json({
    status: "connected",
    database: "Firebase Cloud Firestore",
    database_id: "ai-studio-aiinterviewer-c21e2258-b44a-4995-8291-4eceeee270e2",
    collections: ["questions", "users", "interviews", "responses"],
    cached_questions: dbService.cache.questions.size,
    cached_interviews: dbService.cache.interviews.size,
    cached_users: dbService.cache.users.size
  });
});

// ---------------------------------------------------------------------------
// Static file serving
// ---------------------------------------------------------------------------
app.use(express.static(FRONTEND_DIR));

// Fallback to index.html for SPA
app.get("*", (req, res) => {
  if (req.path.startsWith("/api/")) {
    return res.status(404).json({ error: "API route not found" });
  }
  const indexPath = path.join(FRONTEND_DIR, "index.html");
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.status(404).send("GreenRoom UI not found");
  }
});

// Global Express Error Handler
app.use((err, req, res, next) => {
  console.error("Unhandled server error:", err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({
    error: "Internal Server Error",
    message: process.env.NODE_ENV === "production" ? "An unexpected error occurred" : err.message
  });
});

const isServerless = Boolean(
  process.env.VERCEL ||
  process.env.NOW_REGION ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT
);

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isMain && !isServerless) {
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`GreenRoom server running on http://0.0.0.0:${PORT}`);
  });
}

export default app;
