import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execFile } from "child_process";
import { promisify } from "util";
import { createRequire } from "module";
import { GoogleGenAI } from "@google/genai";
import * as aiEngine from "./aiEngine.js";
import * as dbService from "./dbService.js";
import embeddedQuestionBank from "./data/question_bank_data.js";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

let genAIClient = null;
function getGenAI() {
  if (!genAIClient && process.env.GEMINI_API_KEY) {
    try {
      genAIClient = new GoogleGenAI({});
    } catch (e) {
      console.warn("Failed to initialize GoogleGenAI:", e.message);
    }
  }
  return genAIClient;
}

const execFileAsync = promisify(execFile);

async function evaluateWithPythonOrJs(question, answer, duration, persona, language, companyId, behaviorData = null) {
  try {
    const payload = JSON.stringify({
      answer,
      keywords: question.keywords || [],
      question_type: question.type || "general",
      question,
      company_id: companyId,
      persona,
      duration_seconds: duration,
      language,
      behavior: behaviorData
    });
    const { stdout } = await execFileAsync("python3", [path.join(__dirname, "backend", "ai_engine.py"), "--eval", payload], { timeout: 3500 });
    const pyResult = JSON.parse(stdout.trim());
    if (pyResult && pyResult.overall_score !== undefined) {
      return pyResult;
    }
  } catch (err) {
    // Fall back gracefully to native JS aiEngine
  }
  return aiEngine.evaluateAnswer(question, answer, duration, persona, language, companyId, behaviorData);
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
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

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
    req.url.startsWith("/auth") ||
    req.url.startsWith("/parse-bio") ||
    req.url.startsWith("/upload-resume") ||
    req.url.startsWith("/recommend-companies")
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

// Helper to make questions approachable and easier to understand
function enrichQuestionWithHints(q) {
  let simplified = q.q;
  let hints = [];
  let starter = "A clear way to begin is: 'In simple terms, ...'";

  const text = (q.q || "").toLowerCase();

  if (text.includes("indexing") || text.includes("index")) {
    simplified = "What is a database index, and why would you add or avoid adding too many indexes?";
    hints = [
      "Explain that an index works like a book index to speed up search queries",
      "Mention that each new index slows down insert and update writes",
      "Trade-off: Fast search vs. slower writes and extra disk space"
    ];
    starter = "Think of an index like the index at the back of a book: it helps you find data immediately without reading every page...";
  } else if (text.includes("process") && text.includes("thread")) {
    simplified = "What is the simple difference between a process and a thread?";
    hints = [
      "A process is a standalone running program with its own private memory",
      "Threads live inside a process and share memory together",
      "Processes are heavier to create; threads are lightweight"
    ];
    starter = "The key difference comes down to memory: a process has its own isolated memory space, while threads inside it share memory...";
  } else if (text.includes("rest") || text.includes("api")) {
    simplified = "How do APIs work, and what makes a REST API clean?";
    hints = [
      "An API is a bridge that lets two different applications exchange data",
      "REST uses standard HTTP methods (GET to fetch, POST to create)",
      "Stateless requests returning clean JSON responses"
    ];
    starter = "In simple terms, an API is like a waiter in a restaurant taking orders from the client to the server and bringing back the response...";
  } else if (text.includes("solid") || text.includes("oop") || text.includes("object oriented")) {
    simplified = "What are the key principles of writing clean, organized code?";
    hints = [
      "Single Responsibility: Each function/class should do one job well",
      "Modularity: Easy to test and update without breaking other parts",
      "Reusability: Avoid duplicating code unnecessarily"
    ];
    starter = "The main goal of clean code principles is to keep code easy to understand, test, and maintain over time...";
  } else if (text.includes("sql") || text.includes("nosql")) {
    simplified = "When would you choose a relational SQL database versus a NoSQL database?";
    hints = [
      "SQL (like Postgres/MySQL) has strict tables, schemas, and ACID transactions",
      "NoSQL (like MongoDB) is flexible document storage for rapidly changing schemas",
      "Use SQL for relational financial/user data, NoSQL for high-velocity logs or documents"
    ];
    starter = "I choose SQL when data structure is consistent and relationships matter, whereas NoSQL is great for flexible, nested data...";
  } else if (text.includes("conflict") || text.includes("failure") || text.includes("disagree") || text.includes("mistake") || text.includes("challenge") || text.includes("tell me about")) {
    simplified = "Tell a real personal story: What was the challenge, what action did you take, and what was the positive outcome?";
    hints = [
      "Brief context: What was the situation in 1-2 sentences?",
      "Your action: Focus on what YOU did to solve or de-escalate it",
      "The result: What did the team learn or achieve?"
    ];
    starter = "A great example was when our team encountered... I stepped in by... which resulted in...";
  } else {
    // Conversational simplification
    simplified = q.q
      .replace(/What are the trade-offs of/i, "What are the pros and cons of")
      .replace(/Elaborate on/i, "Explain simply")
      .replace(/Walk through/i, "Explain step-by-step")
      .replace(/Discuss the ramifications/i, "What happens when");
    hints = [
      "Start by defining the core concept in plain words without jargon",
      "Give one quick practical example of where you would use it",
      "Mention a common edge case or pitfall to look out for"
    ];
    starter = "To explain this directly, the central idea is...";
  }

  return {
    ...q,
    simplified_prompt: simplified,
    hints,
    starter_template: starter
  };
}

app.get("/api/questions/:company_id", (req, res) => {
  const companyId = req.params.company_id;
  const c = COMPANY_INDEX.get(companyId);
  if (!c) {
    return res.status(404).json({ error: "Company not found" });
  }

  const roleKeys = Object.keys(c.roles || {});
  const role = req.query.role || roleKeys[0] || "Software Engineer";
  const count = parseInt(req.query.count || "6", 10);
  let rawLevel = (req.query.level || "junior").toLowerCase();
  if (rawLevel === "easy") rawLevel = "junior";
  const requestedLevel = rawLevel; // "junior", "mid", "senior", "all"

  let allRoleQuestions = c.roles?.[role] || [];
  if (!allRoleQuestions.length) {
    const matchedKey = roleKeys.find(k => k.toLowerCase().includes(role.toLowerCase()) || role.toLowerCase().includes(k.toLowerCase()));
    allRoleQuestions = c.roles?.[matchedKey] || c.roles?.["Software Engineer"] || Object.values(c.roles || {})[0] || [];
  }
  const allBehavioral = c.behavioral || [];
  const allHr = c.hr || [];

  // Filter or sort pool according to level
  const filterByLevel = (pool, targetLevel) => {
    if (targetLevel === "all") return shuffle(pool);
    const target = targetLevel === "easy" ? "junior" : targetLevel;
    const exact = pool.filter(q => q.level === target || (target === "junior" && q.level === "easy"));
    const fallback = pool.filter(q => q.level !== target && q.level !== "easy");
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
    const enriched = enrichQuestionWithHints({
      ...q,
      level: q.level || (requestedLevel === "all" ? "junior" : requestedLevel),
      expected_answer: q.expected_answer || bench.expected_answer,
      key_points: q.key_points || bench.key_points,
      genuine: true
    });
    return enriched;
  });

  res.json({
    company: c.name,
    company_id: c.id,
    role,
    level: requestedLevel,
    culture_brief: CULTURE_BRIEFS[companyId] || DEFAULT_CULTURE,
    questions: selected.slice(0, count),
    all_technical: technicalPool.map(q => enrichQuestionWithHints({ ...q, level: q.level || "junior" })),
    all_behavioral: behavioralPool.map(q => enrichQuestionWithHints({ ...q, level: q.level || "junior" })),
    all_hr: hrPool.map(q => enrichQuestionWithHints({ ...q, level: q.level || "junior" }))
  });
});

app.post("/api/evaluate", async (req, res) => {
  const data = req.body || {};
  let question = {
    type: data.question_type || "general",
    keywords: data.keywords || [],
    q: data.question_text || "",
    level: data.level || "junior"
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
  const behaviorData = data.behavior || null;

  const result = await evaluateWithPythonOrJs(
    question,
    answer,
    duration,
    persona,
    language,
    companyId,
    behaviorData
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
      level: question.level || "junior",
      candidate_answer: answer,
      expected_answer: result.comparison?.expected_answer || "",
      key_points: result.comparison?.key_points || [],
      covered_points: result.comparison?.covered_points || [],
      missed_points: result.comparison?.missed_points || [],
      overall_score: result.overall_score || 0,
      breakdown: result.breakdown || {},
      feedback: result.feedback || [],
      interviewer_notes: result.interviewer_notes || [],
      behavior: result.behavior || null,
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
  const behaviorScores = results.map(r => parseFloat(r.breakdown?.behavior?.score ?? r.behavior?.score ?? 90));
  const eyeContacts = results.map(r => parseFloat(r.breakdown?.behavior?.eye_contact ?? r.behavior?.eye_contact ?? 90));
  const totalTabSwitches = results.reduce((acc, r) => acc + parseInt(r.breakdown?.behavior?.tab_switches ?? r.behavior?.tab_switches ?? 0, 10), 0);
  const allCheatFlags = results.flatMap(r => r.breakdown?.behavior?.cheat_flags ?? r.behavior?.cheat_flags ?? []);

  const radar = {
    Relevance: Number(mean(relevance).toFixed(1)),
    Structure: Number(mean(structure).toFixed(1)),
    Fluency: Number(mean(fluency).toFixed(1)),
    Confidence: Number(mean(confidence).toFixed(1)),
    Behavior: Number(mean(behaviorScores).toFixed(1))
  };

  const avgBehavior = Number(mean(behaviorScores).toFixed(1));
  const avgEyeContact = Number(mean(eyeContacts).toFixed(1));
  let integrityStatus = "Verified Clean";
  let proctorVerdict = "High Professional Composure & Integrity";
  if (totalTabSwitches >= 2 || allCheatFlags.length >= 2 || avgBehavior < 65) {
    integrityStatus = "Attention Flags Recorded";
    proctorVerdict = "Noticed attention drift / screen switching during interview";
  } else if (totalTabSwitches === 1 || allCheatFlags.length === 1 || avgBehavior < 80) {
    integrityStatus = "Minor Drift Detected";
    proctorVerdict = "Generally focused with occasional peripheral glance";
  }

  const proctoringSummary = {
    overall_behavior_score: avgBehavior,
    avg_eye_contact: avgEyeContact,
    total_tab_switches: totalTabSwitches,
    integrity_status: integrityStatus,
    proctor_verdict: proctorVerdict,
    flags: Array.from(new Set(allCheatFlags)),
    passed_integrity: totalTabSwitches <= 1 && avgBehavior >= 65
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
      level: data.level || "junior",
      format: data.format || "onsite",
      persona: data.persona || "friendly",
      language: data.language || "english",
      overall_score: verdictAvg,
      hire_verdict: hireVerdict,
      radar,
      behavior_summary: proctoringSummary,
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
        behavior: r.behavior || r.breakdown?.behavior || null,
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
    proctoring: proctoringSummary,
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

/* ---------------------------------------------------------------------------
   LinkedIn & Bio NLP Parsing Endpoint
   --------------------------------------------------------------------------- */
function parseCandidateBio(rawInput) {
  const input = (rawInput || "").trim();
  if (!input) {
    throw new Error("No bio, LinkedIn text, or profile URL provided.");
  }

  let extractedUrl = "";
  let handleName = "";
  const urlMatch = input.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
  if (urlMatch) {
    extractedUrl = urlMatch[0];
    const slug = urlMatch[1].replace(/[-_]/g, " ").trim();
    if (slug) {
      handleName = slug.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    }
  }

  const lower = input.toLowerCase();

  // Candidate Name extraction
  let name = handleName;
  const nameLineMatch = input.match(/(?:name|candidate|profile|full name)\s*[:\-]\s*([A-Za-z\s.'-]{2,40})/i);
  if (nameLineMatch && nameLineMatch[1].trim()) {
    name = nameLineMatch[1].trim();
  } else if (!name) {
    const lines = input.split("\n").map(l => l.trim()).filter(Boolean);
    if (lines.length > 0) {
      const first = lines[0];
      if (/^[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3}$/.test(first) && first.length < 35 && !/resume|cv|profile|linkedin|developer|engineer|summary/i.test(first)) {
        name = first;
      }
    }
  }
  if (!name) name = "Candidate";

  // Seniority / Experience Level
  let level = "mid";
  let years = null;
  const yrMatch = lower.match(/(\d+)\+?\s*(?:years?|yrs?)(?:\s+of)?\s+experience/i) || lower.match(/experience\s*[:\-]?\s*(\d+)\+?\s*(?:years?|yrs?)/i);
  if (yrMatch) {
    years = parseInt(yrMatch[1], 10);
  }

  if (lower.includes("lead") || lower.includes("staff") || lower.includes("principal") || lower.includes("architect") || lower.includes("director") || (years && years >= 8)) {
    level = "senior";
  } else if (lower.includes("senior") || lower.includes("sr.") || lower.includes("sr ") || (years && years >= 4)) {
    level = "senior";
  } else if (lower.includes("junior") || lower.includes("entry") || lower.includes("intern") || lower.includes("fresh") || (years !== null && years <= 2)) {
    level = "junior";
  }

  // Role detection
  const detectedRoles = [];
  if (lower.includes("frontend") || lower.includes("front-end") || lower.includes("react developer") || lower.includes("ui engineer")) {
    detectedRoles.push("Frontend Engineer");
  }
  if (lower.includes("backend") || lower.includes("back-end") || lower.includes("node developer") || lower.includes("java developer") || lower.includes("microservices")) {
    detectedRoles.push("Backend Engineer");
  }
  if (lower.includes("devops") || lower.includes("sre") || lower.includes("site reliability") || lower.includes("cloud engineer") || lower.includes("infrastructure")) {
    detectedRoles.push("DevOps Engineer");
  }
  if (lower.includes("data scientist") || lower.includes("machine learning") || lower.includes("deep learning") || lower.includes("ai engineer") || lower.includes("nlp") || lower.includes("computer vision")) {
    detectedRoles.push("Data Scientist");
  }
  if (lower.includes("data analyst") || lower.includes("business analyst") || lower.includes("analytics") || lower.includes("tableau") || lower.includes("power bi")) {
    detectedRoles.push("Data Analyst");
  }
  if (lower.includes("product manager") || lower.includes("product lead") || lower.includes("technical product manager") || lower.includes("roadmap")) {
    detectedRoles.push("Product Manager");
  }
  if (lower.includes("qa") || lower.includes("quality assurance") || lower.includes("sdet") || lower.includes("test automation")) {
    detectedRoles.push("QA Engineer");
  }
  if (detectedRoles.length === 0) {
    detectedRoles.push("Software Engineer");
  } else if (!detectedRoles.includes("Software Engineer") && (lower.includes("software engineer") || lower.includes("full stack") || lower.includes("fullstack"))) {
    detectedRoles.push("Software Engineer");
  }

  const primaryRole = detectedRoles[0] || "Software Engineer";

  // Skills extraction
  const skillVocabulary = [
    { key: "python", label: "Python" },
    { key: "javascript", label: "JavaScript" },
    { key: "typescript", label: "TypeScript" },
    { key: "react", label: "React" },
    { key: "next.js", label: "Next.js" },
    { key: "nextjs", label: "Next.js" },
    { key: "node", label: "Node.js" },
    { key: "nodejs", label: "Node.js" },
    { key: "express", label: "Express" },
    { key: "java", label: "Java" },
    { key: "spring", label: "Spring Boot" },
    { key: "c++", label: "C++" },
    { key: "golang", label: "Go" },
    { key: "rust", label: "Rust" },
    { key: "sql", label: "SQL" },
    { key: "postgres", label: "PostgreSQL" },
    { key: "mongodb", label: "MongoDB" },
    { key: "redis", label: "Redis" },
    { key: "kafka", label: "Kafka" },
    { key: "rabbitmq", label: "RabbitMQ" },
    { key: "aws", label: "AWS" },
    { key: "gcp", label: "GCP" },
    { key: "azure", label: "Azure" },
    { key: "docker", label: "Docker" },
    { key: "kubernetes", label: "Kubernetes" },
    { key: "terraform", label: "Terraform" },
    { key: "ci/cd", label: "CI/CD" },
    { key: "github", label: "GitHub" },
    { key: "git", label: "Git" },
    { key: "system design", label: "System Design" },
    { key: "distributed systems", label: "Distributed Systems" },
    { key: "microservices", label: "Microservices" },
    { key: "machine learning", label: "Machine Learning" },
    { key: "deep learning", label: "Deep Learning" },
    { key: "llm", label: "LLMs / Generative AI" },
    { key: "pytorch", label: "PyTorch" },
    { key: "tensorflow", label: "TensorFlow" },
    { key: "graphql", label: "GraphQL" },
    { key: "rest api", label: "REST APIs" },
    { key: "rest", label: "REST" },
    { key: "html", label: "HTML5" },
    { key: "css", label: "CSS3" },
    { key: "tailwind", label: "Tailwind CSS" },
    { key: "agile", label: "Agile / Scrum" },
    { key: "scrum", label: "Scrum" },
    { key: "tdd", label: "TDD" },
    { key: "unit testing", label: "Unit Testing" },
    { key: "jest", label: "Jest" },
    { key: "cypress", label: "Cypress" }
  ];

  const detectedSkills = [];
  const seenSkills = new Set();
  skillVocabulary.forEach(s => {
    if (lower.includes(s.key) && !seenSkills.has(s.label)) {
      seenSkills.add(s.label);
      detectedSkills.push(s.label);
    }
  });

  if (!detectedSkills.length) {
    if (primaryRole === "Software Engineer" || primaryRole === "Backend Engineer") {
      detectedSkills.push("Problem Solving", "System Architecture", "Clean Code", "APIs");
    } else if (primaryRole === "Data Scientist") {
      detectedSkills.push("Python", "Statistical Analysis", "Data Modeling");
    } else {
      detectedSkills.push("Problem Solving", "Team Collaboration", "Communication");
    }
  }

  // Matched Companies using rich recommendation engine
  const recommended_companies = recommendCompaniesForCandidate({
    role: primaryRole,
    skills: detectedSkills,
    level,
    years
  }).slice(0, 5);

  let headline = `${level === "senior" ? "Senior " : level === "junior" ? "Junior " : ""}${primaryRole}`;
  if (detectedSkills.length > 0) {
    headline += ` (${detectedSkills.slice(0, 3).join(", ")})`;
  }

  return {
    ok: true,
    name,
    headline,
    target_role: primaryRole,
    alternative_roles: detectedRoles.filter(r => r !== primaryRole),
    experience_level: level,
    years_of_experience: years,
    skills: detectedSkills,
    summary: `${name} — ${headline}. Demonstrated proficiency across ${detectedSkills.slice(0, 5).join(", ")}.`,
    recommended_companies,
    linkedin_url: extractedUrl || null
  };
}

const COMPANY_MATCH_PROFILES = {
  google: {
    skills: ["Algorithms", "Data Structures", "Distributed Systems", "System Design", "C++", "Java", "Python", "Go", "Concurrency", "Clean Code"],
    seniorFit: "Senior L5/L6 System Architecture & Distributed Concurrency Bar",
    midFit: "L4 Core Engineering, Algorithmic Thinking & Clean Architecture",
    juniorFit: "L3 Data Structures, Algorithmic Problem Solving & Code Quality",
    domain: "Planetary-scale distributed systems & search architecture"
  },
  amazon: {
    skills: ["AWS", "Microservices", "System Design", "Distributed Systems", "Java", "Python", "DynamoDB", "REST", "Leadership Principles", "Docker", "DevOps"],
    seniorFit: "Senior L6 Distributed Scale & Operational Excellence Bar",
    midFit: "L5 Microservice Architecture, Cloud Design & Low-Level Design",
    juniorFit: "L4 Object-Oriented Design, Modular Code & Cloud Fundamentals",
    domain: "High-throughput cloud services & resilient microservices"
  },
  microsoft: {
    skills: ["C#", ".NET", "Azure", "Cloud", "System Design", "TypeScript", "React", "Enterprise", "SQL", "Distributed Systems"],
    seniorFit: "Principal/Senior Cloud Architect & Scalable Platform Design",
    midFit: "Software Engineer II Enterprise Microservices & Full-Stack Cloud",
    juniorFit: "Software Engineer I Cloud Services & Core Systems",
    domain: "Global enterprise cloud, Azure infra & modern developer platforms"
  },
  meta: {
    skills: ["React", "JavaScript", "TypeScript", "GraphQL", "Python", "C++", "High Throughput", "System Design", "Distributed Systems", "Web Performance"],
    seniorFit: "E5/E6 Senior System Design & Cross-Functional Product Architecture",
    midFit: "E4 Full-Stack / Product Architecture & Performance Engineering",
    juniorFit: "E3 Core Front-End / Product Coding & Rapid Feature Delivery",
    domain: "Hyper-scale social networking, rich web interfaces & low-latency feeds"
  },
  apple: {
    skills: ["Swift", "C++", "Objective-C", "Python", "Clean Code", "APIs", "System Design", "Security", "Performance", "Software Reliability"],
    seniorFit: "Senior Software Engineer System Reliability & Core APIs",
    midFit: "Software Engineer II High-Performance Engineering & Clean Architecture",
    juniorFit: "Software Engineer I Foundational Coding & Performance Optimization",
    domain: "Consumer hardware ecosystem, privacy-first software & high-reliability OS services"
  },
  netflix: {
    skills: ["Java", "Spring Boot", "AWS", "Distributed Systems", "Microservices", "Kafka", "Resilience", "System Design", "NoSQL", "DevOps"],
    seniorFit: "Senior Platform / Distributed Systems Resilience & High-Throughput Streaming",
    midFit: "Software Engineer Microservices Architecture & Fault Tolerance",
    juniorFit: "Core Backend & Telemetry Engineering",
    domain: "Global high-throughput video streaming & chaos-tested microservices"
  },
  adobe: {
    skills: ["React", "TypeScript", "JavaScript", "C++", "WebAssembly", "Cloud", "UI Architecture", "APIs", "Microservices"],
    seniorFit: "Senior Staff Creative Cloud Architect & Canvas Performance",
    midFit: "Computer Scientist II Rich UI Architecture & Cloud Sync Services",
    juniorFit: "Associate Computer Scientist UI Engineering & Web Standards",
    domain: "Creative suite platforms, real-time collaboration & visual performance"
  },
  oracle: {
    skills: ["Java", "SQL", "Database Internals", "Distributed Storage", "Cloud Infrastructure", "Kubernetes", "Docker", "Linux", "System Design"],
    seniorFit: "Principal Cloud Engineer Distributed Storage & Database Engines",
    midFit: "Senior Software Developer Enterprise Cloud & Database APIs",
    juniorFit: "Software Developer I Core Database & Cloud Infrastructure",
    domain: "Mission-critical enterprise databases, distributed cloud infrastructure & OCI"
  },
  salesforce: {
    skills: ["Java", "Apex", "Cloud", "Multi-Tenant", "Microservices", "REST", "SQL", "TypeScript", "React", "APIs"],
    seniorFit: "Lead Software Engineer Multi-Tenant Cloud Architecture & Scale",
    midFit: "Senior Developer Platform APIs, Integration & Business Logic",
    juniorFit: "Member of Technical Staff Cloud Services & Platform Features",
    domain: "World-leading multi-tenant enterprise CRM platform & microservices"
  },
  ibm: {
    skills: ["Kubernetes", "Red Hat", "OpenShift", "Hybrid Cloud", "Java", "Python", "Docker", "Security", "Enterprise", "AI"],
    seniorFit: "Senior Technical Staff Member Hybrid Cloud & Enterprise Modernization",
    midFit: "Advisory Software Engineer Container Platforms & Enterprise Cloud",
    juniorFit: "Associate Software Engineer Core Cloud Services & Enterprise Systems",
    domain: "Hybrid cloud computing, open-source container infrastructure & mission-critical systems"
  },
  goldmansachs: {
    skills: ["Java", "Python", "Low-Latency", "Financial Systems", "Distributed Systems", "Spring Boot", "Kafka", "SQL", "Security", "Algorithms"],
    seniorFit: "Vice President Low-Latency Financial Platforms & Distributed Resiliency",
    midFit: "Associate Quantitative / Distributed Backend Engineering",
    juniorFit: "Analyst Core Financial Services & Data Pipelines",
    domain: "Ultra-low-latency financial transaction engines, algorithmic trading & risk analytics"
  },
  flipkart: {
    skills: ["Java", "Go", "Kafka", "Redis", "Microservices", "Distributed Systems", "System Design", "MySQL", "Docker", "High Concurrency"],
    seniorFit: "SDE 3 High-Concurrency Flash Sale Scale & Distributed Order Systems",
    midFit: "SDE 2 Resilient Microservices & Catalog Search Architecture",
    juniorFit: "SDE 1 Core Backend Services & E-Commerce APIs",
    domain: "High-scale e-commerce transactions, logistics microservices & flash-sale scaling"
  },
  zomato: {
    skills: ["Node.js", "React", "Python", "Go", "Microservices", "Redis", "Kafka", "Elasticsearch", "PostgreSQL", "AWS"],
    seniorFit: "Principal/Lead Architect Real-Time Dispatch & High-Load Order Processing",
    midFit: "Software Development Engineer II Real-Time Geolocation & Merchant APIs",
    juniorFit: "Software Development Engineer I Core Delivery Platforms & APIs",
    domain: "Real-time food delivery logistics, high-frequency dispatch & consumer discovery"
  },
  swiggy: {
    skills: ["Go", "Java", "Python", "Kafka", "Distributed Systems", "AWS", "Microservices", "Redis", "System Design", "Docker"],
    seniorFit: "Lead Architect AI-driven Logistics & Real-Time Delivery Optimization",
    midFit: "Software Development Engineer II High-Volume Event Streams & Routing",
    juniorFit: "Software Development Engineer I Backend Services & Core APIs",
    domain: "Hyper-local on-demand delivery, graph routing & distributed event processing"
  },
  paytm: {
    skills: ["Java", "Node.js", "Spring Boot", "Kafka", "MySQL", "Redis", "Security", "Payment Systems", "Microservices", "High Throughput"],
    seniorFit: "Engineering Manager / Lead High-Volume Payment Gateways & FinTech Scale",
    midFit: "Senior Software Engineer Financial Ledger & Transaction Security",
    juniorFit: "Software Engineer I Payment Microservices & Merchant APIs",
    domain: "High-throughput UPI/fintech payments, transaction ledgers & regulatory security"
  },
  tcs: {
    skills: ["Java", "Spring Boot", "Python", "SQL", "Full Stack", "React", "Cloud", "Agile", "APIs", "Problem Solving"],
    seniorFit: "Lead Consultant Enterprise Digital Transformation & Modernization",
    midFit: "IT Analyst Full-Stack Enterprise Services & Microservices",
    juniorFit: "Assistant System Engineer Core Enterprise Programming & Cloud Support",
    domain: "Global enterprise IT consulting, cloud migrations & full-stack development"
  },
  infosys: {
    skills: ["Java", "Python", "React", "Angular", "SQL", "Cloud", "Microservices", "Agile", "DevOps", "Problem Solving"],
    seniorFit: "Technology Lead / Architect Cloud Migration & Enterprise Frameworks",
    midFit: "Technology Analyst Scalable Application Services & Modern Web",
    juniorFit: "Systems Engineer Core Programming & Cloud Modernization",
    domain: "Enterprise digital services, next-generation cloud architectures & agile solutions"
  },
  wipro: {
    skills: ["Java", "Python", "Cloud", "DevOps", "Docker", "Kubernetes", "SQL", "Full Stack", "Agile", "System Design"],
    seniorFit: "Lead Architect Enterprise Cloud Strategies & Infrastructure Automation",
    midFit: "Senior Project Engineer Cloud Automation & Full-Stack Solutions",
    juniorFit: "Project Engineer Software Development & Cloud Pipelines",
    domain: "Global infrastructure services, hybrid cloud integrations & digital consulting"
  },
  accenture: {
    skills: ["Java", "React", "Python", "Cloud", "AWS", "Azure", "Microservices", "DevOps", "Agile", "Product Thinking"],
    seniorFit: "Associate Director / Tech Lead Enterprise Cloud Innovation",
    midFit: "Application Development Senior Analyst Cloud Solutions & Modernization",
    juniorFit: "Application Development Associate Core Enterprise Delivery & Testing",
    domain: "Global management consulting, cloud-first technology services & enterprise agile"
  },
  cognizant: {
    skills: ["Java", "Python", "SQL", "Full Stack", "React", "Node.js", "Cloud", "Agile", "QA", "Problem Solving"],
    seniorFit: "Senior Manager / Architect Scalable Enterprise Modernization",
    midFit: "Associate Full-Stack Development & Cloud API Delivery",
    juniorFit: "Programmer Analyst Core Engineering & Automated Quality Delivery",
    domain: "Digital transformation, IoT & healthcare/financial technology modernization"
  }
};

function recommendCompaniesForCandidate({ role = "Software Engineer", skills = [], level = "mid", years = null }) {
  const normRole = (role || "Software Engineer").trim();
  const normLevel = (level || "mid").toLowerCase();
  const candSkills = Array.isArray(skills) ? skills : [];
  const candSkillsLower = candSkills.map(s => s.toLowerCase());

  const results = [];

  for (const comp of QUESTION_BANK) {
    const profile = COMPANY_MATCH_PROFILES[comp.id] || {
      skills: ["Problem Solving", "Clean Code", "System Design", "Agile"],
      seniorFit: "Senior Architecture & Technical Leadership",
      midFit: "Core Engineering & Feature Delivery",
      juniorFit: "Foundational Problem Solving & Code Quality",
      domain: comp.focus || "Technology Solutions"
    };

    let score = 55; // base score
    const matchingSkills = [];

    // 1. Role match: +20 for exact role, +12 for related
    const compRoles = Object.keys(comp.roles || {});
    if (compRoles.includes(normRole)) {
      score += 20;
    } else if (compRoles.some(r => r.toLowerCase().includes("engineer") && normRole.toLowerCase().includes("engineer"))) {
      score += 12;
    } else if (compRoles.length > 0) {
      score += 6;
    }

    // 2. Skill overlap
    profile.skills.forEach(reqSkill => {
      const match = candSkillsLower.find(cs => cs === reqSkill.toLowerCase() || cs.includes(reqSkill.toLowerCase()) || reqSkill.toLowerCase().includes(cs));
      if (match) {
        matchingSkills.push(reqSkill);
        score += 5;
      }
    });

    // Also check company focus string
    const focusLower = (comp.focus || "").toLowerCase();
    candSkillsLower.forEach(cs => {
      if (focusLower.includes(cs) && !matchingSkills.includes(cs)) {
        const orig = candSkills[candSkillsLower.indexOf(cs)];
        if (orig) matchingSkills.push(orig);
        score += 3;
      }
    });

    // 3. Experience level calibration
    let fitText = "";
    if (normLevel === "senior" || (years && years >= 5)) {
      fitText = profile.seniorFit;
      if (["Hard", "Very Hard"].includes(comp.difficulty)) score += 8;
    } else if (normLevel === "junior" || (years && years < 2)) {
      fitText = profile.juniorFit;
      if (["Medium", "Easy"].includes(comp.difficulty)) score += 8;
    } else {
      fitText = profile.midFit;
      score += 5;
    }

    // Bound match percentage between 75% and 98%
    const matchPercent = Math.min(98, Math.max(75, Math.round(score)));

    // Generate tailored reason
    let reason = "";
    if (matchingSkills.length > 0) {
      reason = `Matches your ${normLevel.toUpperCase()} background with direct alignment in ${matchingSkills.slice(0, 3).join(", ")}.`;
    } else {
      reason = `Direct alignment for ${normRole} rehearsal panels and ${profile.domain}.`;
    }

    results.push({
      id: comp.id,
      name: comp.name,
      accent: comp.accent || "#FFB020",
      difficulty: comp.difficulty,
      match_percent: matchPercent,
      matching_skills: matchingSkills.slice(0, 5),
      experience_fit: fitText,
      domain: profile.domain,
      reason: reason,
      recommended_role: compRoles.includes(normRole) ? normRole : (compRoles[0] || "Software Engineer")
    });
  }

  // Sort descending by match percentage
  results.sort((a, b) => b.match_percent - a.match_percent);
  return results;
}

app.post("/api/recommend-companies", (req, res) => {
  try {
    const { role, skills, level, years } = req.body || {};
    const recommendations = recommendCompaniesForCandidate({ role, skills, level, years });
    res.json({ ok: true, recommendations });
  } catch (err) {
    console.error("Recommend companies error:", err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.post("/api/parse-bio", async (req, res) => {
  try {
    const { text, url, file_data, file_name, mime_type } = req.body || {};
    if (file_data) {
      const result = await parseResumeDocument({
        fileData: file_data,
        fileName: file_name || "resume.pdf",
        mimeType: mime_type || ""
      });
      return res.json(result);
    }
    const inputContent = (text || url || "").trim();
    if (!inputContent) {
      return res.status(400).json({ error: "Please provide a resume file (PDF/PNG), bio text, or LinkedIn profile URL." });
    }

    const parsed = parseCandidateBio(inputContent);
    res.json(parsed);
  } catch (err) {
    console.error("Bio parsing error:", err);
    res.status(500).json({ error: "Failed to parse profile", message: err.message });
  }
});

async function parseResumeDocument({ fileData, fileName = "resume.pdf", mimeType = "" }) {
  let cleanBase64 = fileData || "";
  let detectedMime = mimeType || "";

  if (cleanBase64.startsWith("data:")) {
    const commaIdx = cleanBase64.indexOf(",");
    if (commaIdx !== -1) {
      const header = cleanBase64.slice(0, commaIdx);
      cleanBase64 = cleanBase64.slice(commaIdx + 1);
      const mimeMatch = header.match(/data:([^;]+)/);
      if (mimeMatch && mimeMatch[1]) {
        detectedMime = mimeMatch[1].toLowerCase();
      }
    }
  }

  const ext = path.extname(fileName || "").toLowerCase();
  const isPdf = detectedMime.includes("pdf") || ext === ".pdf";
  const isPng = detectedMime.includes("png") || ext === ".png";
  const isImage = isPng || detectedMime.includes("image") || [".jpg", ".jpeg", ".webp"].includes(ext);

  const fileBuffer = Buffer.from(cleanBase64, "base64");
  const ai = getGenAI();

  // 1. PDF Handler
  if (isPdf) {
    let localExtractedText = "";
    try {
      const parser = new PDFParse({ data: fileBuffer });
      await parser.load();
      const textRes = await parser.getText();
      localExtractedText = textRes?.text?.trim() || "";
    } catch (pdfErr) {
      console.warn("Local PDFParse warning:", pdfErr.message);
    }

    if (ai) {
      try {
        const prompt = `You are a world-class technical recruiter analyzing a candidate's resume PDF document.
Extract the candidate's professional profile into strict JSON with these exact keys:
{
  "name": "Candidate's full name",
  "headline": "Current title or professional headline",
  "target_role": "One of: Software Engineer, Frontend Engineer, Backend Engineer, DevOps Engineer, Data Scientist, Data Analyst, Product Manager, QA Engineer",
  "alternative_roles": ["other suitable roles"],
  "experience_level": "junior", "mid", or "senior",
  "years_of_experience": number or null,
  "skills": ["Array of 6 to 15 key technical skills, languages, frameworks"],
  "summary": "2-sentence executive summary of their background, domain expertise, and key accomplishments.",
  "recommended_companies": [
    {"name": "Company Name", "reason": "Why candidate is a strong fit"}
  ]
}
Return ONLY a valid JSON object. Do not include markdown code block markers or extra text.`;

        const response = await ai.models.generateContent({
          model: "gemini-3.6-flash",
          contents: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType: "application/pdf"
              }
            },
            prompt
          ]
        });

        const rawAiText = response.text?.trim() || "";
        const jsonMatch = rawAiText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const aiParsed = JSON.parse(jsonMatch[0]);
          return {
            ok: true,
            format: "pdf",
            file_name: fileName,
            name: aiParsed.name || "Candidate",
            headline: aiParsed.headline || `${aiParsed.target_role || 'Software Engineer'}`,
            target_role: aiParsed.target_role || "Software Engineer",
            alternative_roles: aiParsed.alternative_roles || [],
            experience_level: (aiParsed.experience_level || "mid").toLowerCase(),
            years_of_experience: aiParsed.years_of_experience || null,
            skills: Array.isArray(aiParsed.skills) && aiParsed.skills.length ? aiParsed.skills : ["Problem Solving", "System Architecture", "Clean Code"],
            summary: aiParsed.summary || `${aiParsed.name || 'Candidate'} — ${aiParsed.target_role || 'Software Engineer'}.`,
            recommended_companies: recommendCompaniesForCandidate({
              role: aiParsed.target_role || "Software Engineer",
              skills: aiParsed.skills || [],
              level: aiParsed.experience_level || "mid",
              years: aiParsed.years_of_experience
            }).slice(0, 5)
          };
        }
      } catch (aiErr) {
        console.warn("Gemini PDF parsing warning:", aiErr.message);
      }
    }

    if (localExtractedText && localExtractedText.length > 20) {
      const fallbackParsed = parseCandidateBio(localExtractedText);
      return {
        ...fallbackParsed,
        format: "pdf",
        file_name: fileName,
        extracted_text_preview: localExtractedText.slice(0, 300)
      };
    }

    throw new Error("Unable to extract text from the uploaded PDF resume. Please ensure it contains readable text or try exporting as PNG.");
  }

  // 2. PNG / Image Handler
  if (isImage) {
    if (!ai) {
      throw new Error("AI Vision processing is temporarily unavailable. Please upload a PDF resume or paste your bio summary.");
    }

    const prompt = `You are a world-class technical recruiter and OCR specialist analyzing a candidate's resume image (PNG format).
Read the resume image and extract the candidate's professional profile into strict JSON with these exact keys:
{
  "name": "Candidate's full name",
  "headline": "Current title or professional headline",
  "target_role": "One of: Software Engineer, Frontend Engineer, Backend Engineer, DevOps Engineer, Data Scientist, Data Analyst, Product Manager, QA Engineer",
  "alternative_roles": ["other suitable roles"],
  "experience_level": "junior", "mid", or "senior",
  "years_of_experience": number or null,
  "skills": ["Array of 6 to 15 key technical skills, languages, frameworks"],
  "summary": "2-sentence executive summary of their background, domain expertise, and key accomplishments.",
  "recommended_companies": [
    {"name": "Company Name", "reason": "Why candidate is a strong fit"}
  ]
}
Return ONLY a valid JSON object. Do not include markdown code block markers or extra text.`;

    let rawAiText = "";
    const modelsToTry = ["gemini-3.6-flash", "gemini-3.8-flash"];
    let lastErr = null;

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            {
              inlineData: {
                data: cleanBase64,
                mimeType: isPng ? "image/png" : (detectedMime || "image/jpeg")
              }
            },
            prompt
          ]
        });
        rawAiText = response.text?.trim() || "";
        if (rawAiText) break;
      } catch (err) {
        lastErr = err;
        console.warn(`Vision model ${modelName} warning:`, err.message);
      }
    }

    const jsonMatch = rawAiText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const aiParsed = JSON.parse(jsonMatch[0]);
      return {
        ok: true,
        format: isPng ? "png" : "image",
        file_name: fileName,
        name: aiParsed.name || "Candidate",
        headline: aiParsed.headline || `${aiParsed.target_role || 'Software Engineer'}`,
        target_role: aiParsed.target_role || "Software Engineer",
        alternative_roles: aiParsed.alternative_roles || [],
        experience_level: (aiParsed.experience_level || "mid").toLowerCase(),
        years_of_experience: aiParsed.years_of_experience || null,
        skills: Array.isArray(aiParsed.skills) && aiParsed.skills.length ? aiParsed.skills : ["Problem Solving", "System Architecture", "Clean Code"],
        summary: aiParsed.summary || `${aiParsed.name || 'Candidate'} — ${aiParsed.target_role || 'Software Engineer'}.`,
        recommended_companies: recommendCompaniesForCandidate({
          role: aiParsed.target_role || "Software Engineer",
          skills: aiParsed.skills || [],
          level: aiParsed.experience_level || "mid",
          years: aiParsed.years_of_experience
        }).slice(0, 5)
      };
    }

    if (lastErr && (lastErr.message?.includes("503") || lastErr.message?.includes("high demand") || lastErr.message?.includes("UNAVAILABLE"))) {
      throw new Error("The AI Vision service is experiencing temporary peak demand. Please retry in a few moments, or upload your resume in PDF format for instant processing.");
    }

    throw new Error("Unable to parse text from the uploaded PNG image. Please ensure the image has good lighting and readable text, or try uploading in PDF format.");
  }

  // 3. Plain text / Markdown fallback
  const textContent = fileBuffer.toString("utf-8");
  const parsed = parseCandidateBio(textContent);
  return {
    ...parsed,
    format: "text",
    file_name: fileName
  };
}

app.post("/api/upload-resume", async (req, res) => {
  try {
    const { file_data, file_name, mime_type, text } = req.body || {};
    if (!file_data && !text) {
      return res.status(400).json({ error: "Please provide a resume file in PDF (.pdf) or PNG (.png) format, or paste your bio." });
    }

    if (file_data) {
      const result = await parseResumeDocument({
        fileData: file_data,
        fileName: file_name || "resume.pdf",
        mimeType: mime_type || ""
      });
      return res.json(result);
    }

    const parsed = parseCandidateBio(text);
    res.json(parsed);
  } catch (err) {
    console.error("Resume upload error:", err);
    res.status(500).json({ error: "Failed to parse resume file", message: err.message });
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

app.get("/api/db/status", async (req, res) => {
  try {
    const liveTest = await dbService.testDatabaseConnection();
    res.json({
      status: liveTest.ok ? "connected" : "degraded",
      database: "Firebase Cloud Firestore",
      database_id: "ai-studio-aiinterviewer-c21e2258-b44a-4995-8291-4eceeee270e2",
      live_check: liveTest,
      collections: ["questions", "users", "interviews", "responses"],
      cached_questions: dbService.cache.questions.size,
      cached_interviews: dbService.cache.interviews.size,
      cached_users: dbService.cache.users.size
    });
  } catch (err) {
    res.status(500).json({ status: "error", error: err.message });
  }
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
