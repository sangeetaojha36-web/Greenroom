import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import embeddedQuestionBank from "./data/question_bank_data.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load Firebase configuration with candidate paths
let firebaseConfig = null;
try {
  const cfgCandidates = [
    path.join(__dirname, "firebase-applet-config.json"),
    path.join(process.cwd(), "firebase-applet-config.json"),
    path.join(process.cwd(), "Greenroom-main", "firebase-applet-config.json"),
    path.join(__dirname, "..", "firebase-applet-config.json")
  ];
  for (const cp of cfgCandidates) {
    if (fs.existsSync(cp)) {
      firebaseConfig = JSON.parse(fs.readFileSync(cp, "utf8"));
      break;
    }
  }
} catch (e) {
  console.warn("Could not load firebase-applet-config.json:", e.message);
}

const PROJECT_ID = firebaseConfig?.projectId || process.env.FIREBASE_PROJECT_ID || "";
const DATABASE_ID = firebaseConfig?.firestoreDatabaseId || "(default)";
const API_KEY = firebaseConfig?.apiKey || process.env.FIREBASE_API_KEY || "";
const FIRESTORE_BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents`;

// In-memory fallback caches
const cache = {
  questions: new Map(),
  users: new Map(),
  interviews: new Map(),
  responses: new Map(),
  isSeeded: false
};

/* -------------------------------------------------------------------------
   Firestore REST Value Serialization Helpers
   ------------------------------------------------------------------------- */
export function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === "boolean") return { booleanValue: val };
  if (typeof val === "number") {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === "string") return { stringValue: val };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === "object") {
    const fields = {};
    for (const [k, v] of Object.entries(val)) {
      fields[k] = toFirestoreValue(v);
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function fromFirestoreValue(val) {
  if (!val) return null;
  if ("nullValue" in val) return null;
  if ("booleanValue" in val) return val.booleanValue;
  if ("integerValue" in val) return parseInt(val.integerValue, 10);
  if ("doubleValue" in val) return Number(val.doubleValue);
  if ("stringValue" in val) return val.stringValue;
  if ("timestampValue" in val) return val.timestampValue;
  if ("arrayValue" in val) {
    return (val.arrayValue?.values || []).map(fromFirestoreValue);
  }
  if ("mapValue" in val) {
    const res = {};
    for (const [k, v] of Object.entries(val.mapValue?.fields || {})) {
      res[k] = fromFirestoreValue(v);
    }
    return res;
  }
  return null;
}

export function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

export function fromFirestoreDoc(doc) {
  if (!doc || !doc.fields) return null;
  const result = {};
  for (const [k, v] of Object.entries(doc.fields)) {
    result[k] = fromFirestoreValue(v);
  }
  // Extract id from full document name: projects/.../databases/.../documents/collection/docId
  if (doc.name) {
    const parts = doc.name.split("/");
    result.id = parts[parts.length - 1];
  }
  return result;
}

/* -------------------------------------------------------------------------
   Generic REST Operations to Firestore
   ------------------------------------------------------------------------- */
export async function firestoreSetDoc(collection, docId, data) {
  // Always update in-memory cache first
  const collectionMap = cache[collection] || (cache[collection] = new Map());
  collectionMap.set(docId, { ...data, id: docId });

  if (!PROJECT_ID || !API_KEY) return { ...data, id: docId };

  try {
    const url = `${FIRESTORE_BASE_URL}/${collection}/${encodeURIComponent(docId)}?key=${API_KEY}`;
    const res = await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: toFirestoreFields(data) })
    });
    if (!res.ok) {
      const errTxt = await res.text();
      console.warn(`Firestore setDoc error on ${collection}/${docId}:`, res.status, errTxt);
    }
    return { ...data, id: docId };
  } catch (err) {
    console.warn(`Firestore network error on setDoc ${collection}/${docId}:`, err.message);
    return { ...data, id: docId };
  }
}

export async function firestoreGetDoc(collection, docId) {
  const collectionMap = cache[collection];
  if (collectionMap && collectionMap.has(docId)) {
    return collectionMap.get(docId);
  }

  if (!PROJECT_ID || !API_KEY) return null;

  try {
    const url = `${FIRESTORE_BASE_URL}/${collection}/${encodeURIComponent(docId)}?key=${API_KEY}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) return null;
    const doc = await res.json();
    const parsed = fromFirestoreDoc(doc);
    if (collectionMap && parsed) {
      collectionMap.set(docId, parsed);
    }
    return parsed;
  } catch (err) {
    console.warn(`Firestore network error on getDoc ${collection}/${docId}:`, err.message);
    return collectionMap ? collectionMap.get(docId) || null : null;
  }
}

export async function firestoreListDocs(collection, limit = 50) {
  if (!PROJECT_ID || !API_KEY) {
    return Array.from(cache[collection]?.values() || []).slice(0, limit);
  }

  try {
    const url = `${FIRESTORE_BASE_URL}/${collection}?pageSize=${limit}&key=${API_KEY}`;
    const res = await fetch(url);
    if (!res.ok) {
      return Array.from(cache[collection]?.values() || []).slice(0, limit);
    }
    const data = await res.json();
    const docs = (data.documents || []).map(fromFirestoreDoc);
    // Update local cache
    const collectionMap = cache[collection] || (cache[collection] = new Map());
    docs.forEach(d => {
      if (d && d.id) collectionMap.set(d.id, d);
    });
    return docs;
  } catch (err) {
    console.warn(`Firestore list error for ${collection}:`, err.message);
    return Array.from(cache[collection]?.values() || []).slice(0, limit);
  }
}

/* -------------------------------------------------------------------------
   Benchmark Model Answer & Key Points Synthesis
   Synthesizes high-caliber gold standard benchmark answers for each question
   ------------------------------------------------------------------------- */
export function generateBenchmarkForQuestion(qObj, companyName = "the company") {
  if (qObj.expected_answer && qObj.key_points && qObj.key_points.length > 0) {
    return {
      expected_answer: qObj.expected_answer,
      key_points: qObj.key_points
    };
  }

  const text = qObj.q || "";
  const type = qObj.type || "technical";
  const level = qObj.level || "mid";
  const kw = qObj.keywords || [];

  let keyPoints = [];
  let modelAnswer = "";

  if (type === "technical") {
    const kwStr = kw.length ? kw.slice(0, 4).join(", ") : "fundamentals, performance, trade-offs";
    keyPoints = [
      `Core Principle: Define the underlying mechanism and architecture (${kw[0] || 'core components'}).`,
      `Performance & Complexity: Discuss Big-O time and space complexity or resource footprint.`,
      `Trade-Offs: Compare against alternative approaches and explain real-world limitations.`,
      `Production Considerations: Edge cases, error handling, or operational reliability.`
    ];

    modelAnswer = `A strong candidate begins by clearly defining the core concept: "${text.replace(/\?$/, '')}". `
      + `They systematically explain how it functions under the hood, citing key mechanisms like ${kwStr}. `
      + `Next, they analyze the computational complexity (time and memory implications) and compare this approach with viable alternatives. `
      + `Finally, they highlight real-world production trade-offs such as concurrency, write vs read bottlenecks, and resilient failure recovery.`;

  } else if (type === "system_design") {
    keyPoints = [
      "Requirements & Scale: Establish functional vs non-functional requirements (throughput, latency, availability).",
      "Architecture Decomposition: Design API interfaces, service layers, and stateful storage with appropriate partitioning.",
      "Scalability & Caching: Implement load balancing, horizontal scaling, and multi-tier caching strategies.",
      "Resilience & Bottlenecks: Address single points of failure, data replication, and graceful degradation under peak load."
    ];

    modelAnswer = `The candidate starts with requirement clarification and mathematical back-of-the-envelope estimations (QPS, storage, bandwidth). `
      + `They draw a high-level modular diagram featuring client gateways, stateless application clusters, caching layers (e.g. Redis), and partitioned database storage. `
      + `They dive into data modeling, consistency models (CAP theorem trade-offs), and explain database sharding and replication. `
      + `To conclude, they address operational bottlenecks: rate limiting, circuit breakers, disaster recovery, and observability.`;

  } else if (type === "behavioral") {
    keyPoints = [
      "Situation & Context: Concise business environment, high stakes, and initial problem scope.",
      "Task & Ownership: Clear definition of personal responsibility and measurable target.",
      "Action & Initiative: Concrete technical, interpersonal, or strategic decisions executed by the candidate.",
      "Result & Learning: Quantifiable impact (metrics, efficiency, delivery) and retrospective key takeaway."
    ];

    modelAnswer = `Using the STAR framework, the candidate delivers a structured narrative: `
      + `(1) Situation: Sets the stage with a real, high-impact business challenge at their organization. `
      + `(2) Task: Clarifies their specific personal ownership rather than speaking generally as a team. `
      + `(3) Action: Details the rigorous decision-making process, stakeholder alignment, and technical trade-offs navigated. `
      + `(4) Result: Concludes with quantifiable business results (e.g., 'reduced latency by 35%' or 'delivered on schedule') and a mature reflection on lessons learned.`;

  } else {
    // HR / Fit
    keyPoints = [
      "Value Alignment: Demonstrates authentic understanding of company culture and mission.",
      "Professional Growth: Articulates clear trajectory, curiosity, and appetite for high-impact challenges.",
      "Collaboration: Emphasizes transparent feedback, team velocity, and constructive communication."
    ];

    modelAnswer = `The candidate expresses genuine motivation aligned with ${companyName}'s engineering culture. `
      + `They demonstrate strong self-awareness regarding their strengths and areas of growth, while illustrating how they elevate their peers and communicate transparently during challenging deadlines.`;
  }

  return {
    expected_answer: modelAnswer,
    key_points: keyPoints
  };
}

/* -------------------------------------------------------------------------
   Question Bank Seeding and Retrieval
   ------------------------------------------------------------------------- */
export async function initQuestionBank() {
  if (cache.isSeeded) return;

  try {
    let raw = null;
    const candidates = [
      path.join(__dirname, "data", "question_bank.json"),
      path.join(process.cwd(), "data", "question_bank.json"),
      path.join(process.cwd(), "Greenroom-main", "data", "question_bank.json"),
      path.join(__dirname, "..", "data", "question_bank.json")
    ];
    for (const cp of candidates) {
      if (fs.existsSync(cp)) {
        try {
          raw = JSON.parse(fs.readFileSync(cp, "utf8"));
          break;
        } catch (e) {}
      }
    }
    if (!raw && embeddedQuestionBank) {
      raw = embeddedQuestionBank;
    }
    if (!raw) {
      console.warn("Question bank data not found, skipping bank init.");
      return;
    }

    const companies = raw.companies || [];

    for (const comp of companies) {
      const roles = comp.roles || {};
      for (const [roleName, qList] of Object.entries(roles)) {
        for (const q of qList) {
          const bench = generateBenchmarkForQuestion(q, comp.name);
          const enrichedQ = {
            id: q.id,
            company_id: comp.id,
            company_name: comp.name,
            role: roleName,
            level: q.level || "mid",
            type: q.type || "technical",
            q: q.q,
            keywords: q.keywords || [],
            expected_answer: q.expected_answer || bench.expected_answer,
            key_points: q.key_points || bench.key_points,
            genuine: q.genuine !== false
          };
          cache.questions.set(enrichedQ.id, enrichedQ);
        }
      }
    }

    cache.isSeeded = true;
    console.log(`Initialized in-memory question bank: ${cache.questions.size} questions loaded with benchmark answers.`);

    // Asynchronously verify or seed questions to Firestore in background without blocking server startup
    seedFirestoreQuestionsAsync();
  } catch (err) {
    console.error("Error initializing question bank:", err);
  }
}

async function seedFirestoreQuestionsAsync() {
  if (!PROJECT_ID || !API_KEY) return;
  try {
    // Check if questions collection already has entries
    const existing = await firestoreListDocs("questions", 5);
    if (existing && existing.length >= 5) {
      console.log("Firestore questions collection already seeded.");
      return;
    }

    console.log("Seeding question bank to Firestore database...");
    const allQuestions = Array.from(cache.questions.values());
    // Seed a representative sample of foundational questions first (e.g. 50 core questions)
    // and let the rest be stored on-demand or in batches to avoid rate limits
    const seedSubset = allQuestions.slice(0, 60);
    for (const q of seedSubset) {
      await firestoreSetDoc("questions", q.id, q);
    }
    console.log(`Seeded ${seedSubset.length} questions with benchmark answers to Firestore!`);
  } catch (err) {
    console.warn("Async Firestore question seeding notice:", err.message);
  }
}

export async function getQuestionById(questionId) {
  if (!cache.isSeeded) await initQuestionBank();

  // Try cache first
  if (cache.questions.has(questionId)) {
    return cache.questions.get(questionId);
  }

  // Try Firestore
  const doc = await firestoreGetDoc("questions", questionId);
  if (doc) {
    cache.questions.set(questionId, doc);
    return doc;
  }
  return null;
}

export async function queryQuestions({ companyId, role, level, type, count = 6 }) {
  if (!cache.isSeeded) await initQuestionBank();

  let list = Array.from(cache.questions.values());

  if (companyId) {
    list = list.filter(q => q.company_id === companyId);
  }
  if (role) {
    const roleLower = role.toLowerCase();
    list = list.filter(q => q.role.toLowerCase() === roleLower);
  }
  if (type) {
    list = list.filter(q => q.type === type);
  }

  if (level && level !== "all") {
    const filtered = list.filter(q => q.level === level);
    if (filtered.length >= count) {
      list = filtered;
    } else if (filtered.length > 0) {
      // Complement with other levels
      const remainder = list.filter(q => q.level !== level);
      list = [...filtered, ...remainder];
    }
  }

  // Shuffle slightly for realism
  const shuffled = list.sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
}

/* -------------------------------------------------------------------------
   User Authentication & Profile Management
   ------------------------------------------------------------------------- */
export function hashPassword(password) {
  return crypto.createHash("sha256").update(password + "greenroom_salt_2026").digest("hex");
}

export async function findUserByEmail(email) {
  if (!email) return null;
  const cleanEmail = email.trim().toLowerCase();

  // Check in-memory cache first
  for (const u of cache.users.values()) {
    if (u.email && u.email.toLowerCase() === cleanEmail) {
      return u;
    }
  }

  // Check Firestore
  const allUsers = await firestoreListDocs("users", 100);
  for (const u of allUsers) {
    if (u.email && u.email.toLowerCase() === cleanEmail) {
      return u;
    }
  }
  return null;
}

export async function registerUser({ name, email, password, target_role, target_company, experience_level, language }) {
  if (!name || !name.trim()) throw new Error("Full Name is mandatory.");
  if (!email || !email.trim()) throw new Error("Email Address is mandatory.");
  if (!password || password.length < 6) throw new Error("Password is mandatory and must be at least 6 characters.");
  if (!target_role || !target_role.trim()) throw new Error("Target Role is mandatory.");
  if (!target_company || !target_company.trim()) throw new Error("Target Company is mandatory.");
  if (!experience_level || !experience_level.trim()) throw new Error("Experience Level is mandatory.");

  const cleanEmail = email.trim().toLowerCase();
  const existing = await findUserByEmail(cleanEmail);
  if (existing) {
    throw new Error("An account with this email already exists. Please log in.");
  }

  const userId = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const newUser = {
    id: userId,
    email: cleanEmail,
    display_name: name.trim(),
    password_hash: hashPassword(password),
    target_role: target_role.trim(),
    target_company: target_company.trim(),
    target_level: experience_level.trim(),
    preferred_language: language || "english",
    auth_provider: "manual",
    total_interviews: 0,
    avg_score: 0,
    achievements: ["Account Registered", "First Step"],
    weak_spots: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  await firestoreSetDoc("users", userId, newUser);

  // Return sanitized user object without password_hash
  const { password_hash, ...safeUser } = newUser;
  return safeUser;
}

export async function authenticateUser(email, password) {
  if (!email || !email.trim()) throw new Error("Email is required.");
  if (!password) throw new Error("Password is required.");

  const cleanEmail = email.trim().toLowerCase();
  const user = await findUserByEmail(cleanEmail);
  if (!user) {
    throw new Error("No account found with this email. Please register first.");
  }

  if (user.password_hash) {
    const hashed = hashPassword(password);
    if (user.password_hash !== hashed) {
      throw new Error("Incorrect password. Please try again.");
    }
  } else if (user.auth_provider && user.auth_provider !== "manual") {
    throw new Error(`This account was registered using ${user.auth_provider.toUpperCase()}. Please sign in with ${user.auth_provider}.`);
  }

  // Update last login
  const updated = {
    ...user,
    last_login_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
  await firestoreSetDoc("users", user.id, updated);

  const { password_hash, ...safeUser } = updated;
  return safeUser;
}

export async function socialAuthUser({ provider, email, name, avatar, provider_id, target_role, target_company, experience_level }) {
  if (!provider) throw new Error("Provider is required.");
  const cleanEmail = (email || `${provider}_${provider_id || Date.now()}@social.auth`).trim().toLowerCase();
  let user = await findUserByEmail(cleanEmail);

  if (user) {
    // Update existing user with latest info if provided
    const updated = {
      ...user,
      display_name: name || user.display_name,
      avatar: avatar || user.avatar,
      auth_provider: provider,
      last_login_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    await firestoreSetDoc("users", user.id, updated);
    const { password_hash, ...safeUser } = updated;
    return safeUser;
  }

  // Create new user via social auth
  const userId = `usr_${provider}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const newUser = {
    id: userId,
    email: cleanEmail,
    display_name: name || `${provider.charAt(0).toUpperCase() + provider.slice(1)} User`,
    avatar: avatar || "",
    auth_provider: provider,
    provider_id: provider_id || "",
    target_role: target_role || "Software Engineer",
    target_company: target_company || "Google",
    target_level: experience_level || "mid",
    total_interviews: 0,
    avg_score: 0,
    achievements: [`Signed in via ${provider.toUpperCase()}`, "First Step"],
    weak_spots: [],
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  await firestoreSetDoc("users", userId, newUser);
  return newUser;
}

export async function getUserProfile(userId = "default_user") {
  let user = await firestoreGetDoc("users", userId);
  if (!user) {
    // Default initial profile
    user = {
      id: userId,
      email: "candidate@interview.pro",
      display_name: "Candidate",
      target_role: "Software Engineer",
      target_level: "mid",
      total_interviews: 0,
      avg_score: 0,
      achievements: ["First Step"],
      weak_spots: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    await firestoreSetDoc("users", userId, user);
  }
  return user;
}

export async function saveUserProfile(userData) {
  const userId = userData.id || userData.userId || "default_user";
  const existing = (await firestoreGetDoc("users", userId)) || {};
  const merged = {
    ...existing,
    ...userData,
    id: userId,
    updated_at: new Date().toISOString()
  };
  return await firestoreSetDoc("users", userId, merged);
}

export async function recordUserInterviewCompletion(userId, sessionResult) {
  const user = await getUserProfile(userId);
  const total = (user.total_interviews || 0) + 1;
  const currentAvg = user.avg_score || 0;
  const newScore = sessionResult.overall_score || 0;
  const updatedAvg = Number(((currentAvg * (total - 1) + newScore) / total).toFixed(1));

  const weakSpots = user.weak_spots || [];
  if (sessionResult.weakest_area && !weakSpots.includes(sessionResult.weakest_area)) {
    weakSpots.push(sessionResult.weakest_area);
  }

  const achievements = user.achievements || [];
  if (total >= 1 && !achievements.includes("First Rehearsal Completed")) {
    achievements.push("First Rehearsal Completed");
  }
  if (newScore >= 80 && !achievements.includes("High Performer (80%+)")) {
    achievements.push("High Performer (80%+)");
  }
  if (total >= 5 && !achievements.includes("Seasoned Rehearser (5+ Sessions)")) {
    achievements.push("Seasoned Rehearser (5+ Sessions)");
  }

  const updatedUser = {
    ...user,
    total_interviews: total,
    avg_score: updatedAvg,
    weak_spots: weakSpots.slice(0, 5),
    achievements,
    last_interview_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  await firestoreSetDoc("users", userId, updatedUser);
  return updatedUser;
}

/* -------------------------------------------------------------------------
   Interview Sessions Storage
   ------------------------------------------------------------------------- */
export async function saveInterviewSession(sessionData) {
  const interviewId = sessionData.id || `iv_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const record = {
    ...sessionData,
    id: interviewId,
    user_id: sessionData.user_id || "default_user",
    created_at: sessionData.created_at || new Date().toISOString()
  };

  await firestoreSetDoc("interviews", interviewId, record);

  // Update user stats
  await recordUserInterviewCompletion(record.user_id, record);

  return record;
}

export async function getInterviewSession(interviewId) {
  return await firestoreGetDoc("interviews", interviewId);
}

export async function getUserInterviewHistory(userId = "default_user", limit = 30) {
  // Query all cached or stored interviews
  const all = Array.from(cache.interviews.values()).filter(iv => iv.user_id === userId);
  if (all.length > 0) {
    return all.sort((a, b) => new Date(b.created_at) - new Date(a.created_at)).slice(0, limit);
  }

  const docs = await firestoreListDocs("interviews", limit);
  const userDocs = docs.filter(d => d.user_id === userId || !d.user_id);
  return userDocs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

/* -------------------------------------------------------------------------
   Candidate Responses Storage
   ------------------------------------------------------------------------- */
export async function saveCandidateResponse(responseData) {
  const responseId = responseData.id || `resp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const record = {
    ...responseData,
    id: responseId,
    created_at: responseData.created_at || new Date().toISOString()
  };

  await firestoreSetDoc("responses", responseId, record);
  return record;
}

export async function getResponsesForInterview(interviewId) {
  const cached = Array.from(cache.responses.values()).filter(r => r.interview_id === interviewId);
  if (cached.length > 0) return cached;

  const docs = await firestoreListDocs("responses", 100);
  return docs.filter(r => r.interview_id === interviewId);
}

/* -------------------------------------------------------------------------
   Answer Comparison Engine against Model Benchmark
   ------------------------------------------------------------------------- */
export function compareAnswerToBenchmark(candidateAnswer, question) {
  const text = (candidateAnswer || "").toLowerCase();
  let keyPoints = question?.key_points || [];
  let expectedAnswer = question?.expected_answer || "";

  if (!keyPoints.length || !expectedAnswer) {
    const synth = generateBenchmarkForQuestion(question || {}, question?.company_name || "Engineering Panel");
    if (!expectedAnswer) expectedAnswer = synth.expected_answer;
    if (!keyPoints.length) keyPoints = synth.key_points;
  }

  const questionKeywords = (question?.keywords || []).map(k => k.toLowerCase());

  const covered = [];
  const missed = [];

  for (const point of keyPoints) {
    // Extract key vocabulary from this point, ignoring common filler words
    const stopWords = new Set(["the", "and", "for", "with", "that", "this", "from", "define", "discuss", "explain", "core", "principle"]);
    const words = point.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    // Match words and stems
    const matches = words.filter(w => {
      if (text.includes(w)) return true;
      if (w.length > 4 && text.includes(w.slice(0, -1))) return true; // stem match e.g. trade-off -> trade-offs
      return false;
    });

    // Also check if any question keyword is present in this point and matched in the answer
    const kwMatches = questionKeywords.filter(k => point.toLowerCase().includes(k) && text.includes(k));

    if (matches.length >= 1 || kwMatches.length >= 1) {
      covered.push(point);
    } else {
      missed.push(point);
    }
  }

  const coveragePct = keyPoints.length > 0 ? Math.round((covered.length / keyPoints.length) * 100) : 70;

  return {
    expected_answer: expectedAnswer,
    key_points: keyPoints,
    covered_points: covered,
    missed_points: missed,
    coverage_percentage: coveragePct,
    summary: covered.length === keyPoints.length
      ? "Outstanding coverage! Your response touched on every critical dimension in the benchmark model answer."
      : `You covered ${covered.length} of ${keyPoints.length} benchmark concepts. Key area to reinforce: ${missed.slice(0, 2).map(m => m.split(':')[0]).join(", ")}.`
  };
}

export { cache };
