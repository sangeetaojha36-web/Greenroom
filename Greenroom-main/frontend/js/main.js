/* ==========================================================================
   GreenRoom — Main Application Logic & GSAP Stage Engine
   ========================================================================== */

const API = ""; // same-origin, Flask serves both frontend + API

const PANEL_INTERVIEWERS = [
  { name: "Alex Chen", role: "Principal Tech Lead", persona: "technical", avatar: "💻", tag: "Tech Lead" },
  { name: "Priya Sharma", role: "HR Business Partner", persona: "friendly", avatar: "🤝", tag: "Culture & Fit" },
  { name: "Marcus Vance", role: "VP / Bar Raiser", persona: "barraiser", avatar: "⚖️", tag: "Bar Raiser" }
];

const state = {
  userId: localStorage.getItem("gr_user_id") || (() => {
    const id = "cand_" + Math.random().toString(36).slice(2, 9);
    localStorage.setItem("gr_user_id", id);
    return id;
  })(),
  interviewId: null,
  candidateName: localStorage.getItem("gr_user_name") || "Candidate",
  candidateRole: localStorage.getItem("gr_user_role") || "Software Engineer",
  companies: [],
  customBanks: [],
  activeCompany: null,
  selectedRole: null,
  selectedLevel: "mid",
  cameraStream: null,
  cameraGranted: false,
  cameraFlipped: false,
  selectedPersona: "friendly",
  selectedFormat: "onsite",
  selectedLang: "english",
  breathingEnabled: true,
  notesView: false,
  reportNotesView: false,
  qCount: 6,
  questions: [],
  currentIndex: 0,
  results: [],
  timerInterval: null,
  timerSeconds: 0,
  answerStartTime: null,
  recognition: null,
  isRecording: false,
  baseTranscript: "",
  isSpacedRepMode: false,
  isReadOnlyShared: false,
  searchQuery: "",
  weakSpots: [],
  upcomingInterview: null,
  achievements: {
    first_interview: false,
    ninety_plus_score: false,
    five_companies: false,
    ten_sessions: false,
    perfect_fluency: false,
    structure_master: false,
    barraiser_approved: false,
    spaced_rep_warrior: false
  }
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function escapeHtml(str){
  if (!str) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* -------------------------------------------------------------------------
   Toast
   ------------------------------------------------------------------------- */
function toast(msg, ms = 2600){
  const el = $("#toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(()=> el.classList.remove("show"), ms);
}

/* -------------------------------------------------------------------------
   Achievements System
   ------------------------------------------------------------------------- */
const BADGE_DEFINITIONS = {
  first_interview: { icon: "🎤", text: "First Audition", desc: "Completed your first mock rehearsal" },
  ninety_plus_score: { icon: "🏆", text: "90+ Score", desc: "Achieved a 90+ overall score on any answer" },
  five_companies: { icon: "🏢", text: "5 Companies", desc: "Rehearsed for 5 different company panels" },
  ten_sessions: { icon: "📊", text: "10 Sessions", desc: "Logged 10 full rehearsal sessions" },
  perfect_fluency: { icon: "💬", text: "Fluency Virtuoso", desc: "Scored 95+ in Fluency (low fillers, crisp pace)" },
  structure_master: { icon: "📐", text: "STAR Master", desc: "Scored 95+ in Structure / STAR narrative" },
  barraiser_approved: { icon: "⚖️", text: "Bar Raiser Approved", desc: "Scored 85+ under the Bar-Raiser persona" },
  spaced_rep_warrior: { icon: "🔁", text: "Weak Spot Hero", desc: "Completed a Weak Spots spaced repetition deck" }
};

function loadAchievements(){
  const saved = localStorage.getItem("greenroom_achievements");
  if (saved) {
    try { state.achievements = { ...state.achievements, ...JSON.parse(saved) }; } catch(e){}
  }
  renderBadges();
}

function saveAchievements(){
  localStorage.setItem("greenroom_achievements", JSON.stringify(state.achievements));
  renderBadges();
}

function renderBadges(){
  const grid = $("#badgesGrid");
  if (!grid) return;
  grid.innerHTML = "";
  let unlockedCount = 0;
  Object.entries(BADGE_DEFINITIONS).forEach(([key, def]) => {
    const unlocked = !!state.achievements[key];
    if (unlocked) unlockedCount++;
    const badge = document.createElement("div");
    badge.className = `badge ${unlocked ? "unlocked" : ""}`;
    badge.title = def.desc;
    badge.innerHTML = `
      <span class="badge-icon">${def.icon}</span>
      <span class="badge-text">${def.text}</span>
    `;
    grid.appendChild(badge);
  });
  const counterEl = $("#unlockedBadgeCount");
  if (counterEl) counterEl.textContent = `${unlockedCount} / ${Object.keys(BADGE_DEFINITIONS).length} unlocked`;
}

function checkAchievements(){
  let newUnlock = false;

  if (!state.achievements.first_interview && state.results.length > 0) {
    state.achievements.first_interview = true;
    newUnlock = true;
  }

  if (!state.achievements.ninety_plus_score) {
    if (state.results.some(r => r.overall_score >= 90)) {
      state.achievements.ninety_plus_score = true;
      newUnlock = true;
    }
  }

  if (!state.achievements.perfect_fluency) {
    if (state.results.some(r => r.breakdown && r.breakdown.fluency && r.breakdown.fluency.score >= 95)) {
      state.achievements.perfect_fluency = true;
      newUnlock = true;
    }
  }

  if (!state.achievements.structure_master) {
    if (state.results.some(r => r.breakdown && r.breakdown.structure && r.breakdown.structure.score >= 95)) {
      state.achievements.structure_master = true;
      newUnlock = true;
    }
  }

  if (!state.achievements.barraiser_approved && state.selectedPersona === "barraiser") {
    if (state.results.some(r => r.overall_score >= 85)) {
      state.achievements.barraiser_approved = true;
      newUnlock = true;
    }
  }

  if (!state.achievements.spaced_rep_warrior && state.isSpacedRepMode && state.results.length >= 3) {
    state.achievements.spaced_rep_warrior = true;
    newUnlock = true;
  }

  if (newUnlock) {
    saveAchievements();
    toast("🎉 Achievement unlocked!");
  }
}

/* -------------------------------------------------------------------------
   Spaced Repetition / Weak Spots Deck
   ------------------------------------------------------------------------- */
function loadWeakSpots(){
  try {
    state.weakSpots = JSON.parse(localStorage.getItem("greenroom_weak_spots") || "[]");
  } catch(e){ state.weakSpots = []; }
  updateWeakSpotsCounter();
}

function updateWeakSpotsCounter(){
  const badge = $("#weakSpotsCount");
  if (badge) badge.textContent = state.weakSpots.length;
}

function recordQuestionResultForSpacedRep(question, result){
  if (!question || !result) return;
  const existingIdx = state.weakSpots.findIndex(q => q.id === question.id || q.q === question.q);

  if (result.overall_score < 70) {
    const entry = {
      id: question.id || ("custom_" + Date.now()),
      q: question.q,
      type: question.type || "technical",
      keywords: question.keywords || [],
      company: state.activeCompany?.name || "General",
      lastScore: result.overall_score,
      lastReviewed: Date.now()
    };
    if (existingIdx >= 0) {
      state.weakSpots[existingIdx] = entry;
    } else {
      state.weakSpots.unshift(entry);
    }
  } else if (result.overall_score >= 80 && existingIdx >= 0) {
    state.weakSpots.splice(existingIdx, 1);
  }
  localStorage.setItem("greenroom_weak_spots", JSON.stringify(state.weakSpots));
  updateWeakSpotsCounter();
}

function startSpacedRepRehearsal(){
  if (!state.weakSpots.length) {
    toast("No weak spots recorded yet! Complete mock questions to build your review deck.");
    return;
  }
  state.isSpacedRepMode = true;
  state.activeCompany = {
    id: "weak_spots",
    name: "Weak Spots Deck",
    accent: "#FFB020",
    difficulty: "Adaptive",
    focus: "Targeted Spaced Repetition on your lowest scoring questions",
    rounds: ["Spaced Repetition Review"],
    roles: { "All Roles": state.weakSpots }
  };
  state.selectedRole = "All Roles";
  state.questions = [...state.weakSpots].slice(0, 8);
  state.currentIndex = 0;
  state.results = [];

  $("#interviewerCompanyName").textContent = "Weak Spots Deck";
  $("#interviewerRoleLabel").textContent = "Spaced Repetition Panel";
  $("#qTotal").textContent = state.questions.length;

  goToScreen(2, { live: true });
  setTimeout(()=> loadQuestion(), 650);
  toast(`Loaded ${state.questions.length} weak spot questions for review!`);
}

/* -------------------------------------------------------------------------
   Upcoming Interview Countdown & Calendar Sync
   ------------------------------------------------------------------------- */
function loadCountdown(){
  try {
    const saved = localStorage.getItem("greenroom_countdown");
    if (saved) {
      state.upcomingInterview = JSON.parse(saved);
      initCountdownDisplay();
    }
  } catch(e){}
}

function saveCountdown(data){
  state.upcomingInterview = data;
  localStorage.setItem("greenroom_countdown", JSON.stringify(data));
  initCountdownDisplay();
}

function initCountdownDisplay(){
  const info = state.upcomingInterview;
  const targetText = $("#countdownTargetText");
  const timerDisplay = $("#countdownTimerDisplay");
  const navPill = $("#navCountdownPill");
  const navText = $("#navCountdownText");

  if (!info || !info.date) {
    if (targetText) targetText.textContent = "No target date set yet";
    if (timerDisplay) timerDisplay.style.display = "none";
    if (navPill) navPill.style.display = "none";
    return;
  }

  const targetDate = new Date(info.date).getTime();
  if (targetText) targetText.textContent = `${info.companyName} (${info.role || "Role"}) • ${new Date(info.date).toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute:"2-digit" })}`;
  if (timerDisplay) timerDisplay.style.display = "flex";

  clearInterval(initCountdownDisplay._interval);
  function tick(){
    const now = Date.now();
    const diff = targetDate - now;

    if (diff <= 0) {
      if ($("#cdDays")) $("#cdDays").textContent = "00";
      if ($("#cdHours")) $("#cdHours").textContent = "00";
      if ($("#cdMins")) $("#cdMins").textContent = "00";
      if (navPill) { navPill.style.display = "inline-flex"; if (navText) navText.textContent = "Interview Day!"; }
      return;
    }

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const mins = Math.floor((diff / (1000 * 60)) % 60);

    if ($("#cdDays")) $("#cdDays").textContent = String(days).padStart(2, "0");
    if ($("#cdHours")) $("#cdHours").textContent = String(hours).padStart(2, "0");
    if ($("#cdMins")) $("#cdMins").textContent = String(mins).padStart(2, "0");

    if (navPill) {
      navPill.style.display = "inline-flex";
      if (navText) navText.textContent = `${days}d ${hours}h left • ${info.companyName}`;
    }
  }
  tick();
  initCountdownDisplay._interval = setInterval(tick, 10000);
}

function generateGoogleCalendarUrl(title, details, startTimeDate, durationHours = 1){
  const start = new Date(startTimeDate);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  const formatTime = (d) => d.toISOString().replace(/-|:|\.\d+/g, "");
  const dates = `${formatTime(start)}/${formatTime(end)}`;
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${dates}&details=${encodeURIComponent(details)}&location=GreenRoom+Mock+Studio`;
}

function downloadIcsFile(title, details, startTimeDate, durationHours = 1){
  const start = new Date(startTimeDate);
  const end = new Date(start.getTime() + durationHours * 60 * 60 * 1000);
  const formatTime = (d) => d.toISOString().replace(/-|:|\.\d+/g, "");

  const icsContent = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GreenRoom//Interview Rehearsal//EN",
    "BEGIN:VEVENT",
    `SUMMARY:${title}`,
    `DESCRIPTION:${details}`,
    `DTSTART:${formatTime(start)}`,
    `DTEND:${formatTime(end)}`,
    "LOCATION:GreenRoom Mock Studio",
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR"
  ].join("\r\n");

  const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${title.replace(/\s+/g, "_")}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast("📅 Downloaded .ics calendar file!");
}

/* -------------------------------------------------------------------------
   Custom Question Bank (Upload / Paste)
   ------------------------------------------------------------------------- */
function loadCustomBanks(){
  try {
    state.customBanks = JSON.parse(localStorage.getItem("greenroom_custom_banks") || "[]");
  } catch(e){ state.customBanks = []; }
}

function saveCustomBank(companyName, roleName, questionsText){
  if (!companyName.trim() || !questionsText.trim()) {
    toast("Please enter a company name and paste at least one question.");
    return false;
  }

  let parsedQuestions = [];
  const trimmed = questionsText.trim();

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    try {
      const jsonArr = JSON.parse(trimmed);
      parsedQuestions = jsonArr.map((item, idx) => ({
        id: `custom_${Date.now()}_${idx}`,
        q: typeof item === "string" ? item : (item.q || item.question || JSON.stringify(item)),
        type: item.type || (idx % 2 === 0 ? "technical" : "behavioral"),
        keywords: item.keywords || item.kw || extractKeywordsFromQuestion(typeof item === "string" ? item : (item.q || ""))
      }));
    } catch(e){}
  }

  if (!parsedQuestions.length) {
    const lines = trimmed.split(/\r?\n/).map(l => l.trim().replace(/^[-*•\d.)\s]+/, "")).filter(l => l.length > 5);
    parsedQuestions = lines.map((qText, idx) => ({
      id: `custom_${Date.now()}_${idx}`,
      q: qText,
      type: idx % 2 === 0 ? "technical" : "behavioral",
      keywords: extractKeywordsFromQuestion(qText)
    }));
  }

  if (!parsedQuestions.length) {
    toast("Could not parse any valid questions. Please paste one question per line.");
    return false;
  }

  const customCompany = {
    id: "custom_" + Date.now(),
    name: companyName.trim(),
    accent: "#59D9C4",
    difficulty: "Custom",
    focus: "Custom imported question set",
    rounds: ["Custom Rehearsal Round"],
    roles: { [roleName.trim() || "Candidate"]: parsedQuestions },
    culture_brief: {
      what_they_value: "Custom question bank rehearsal tailored to your specific past notes.",
      scoring_emphasis: "STAR method for behavioral questions and technical depth for system questions.",
      red_flags: "Rushed answers without clear structure.",
      pro_tip: "Focus on articulating clear trade-offs and concrete results."
    },
    isCustom: true
  };

  state.customBanks.unshift(customCompany);
  localStorage.setItem("greenroom_custom_banks", JSON.stringify(state.customBanks));
  renderCompanyGrid();

  state.activeCompany = customCompany;
  state.selectedRole = roleName.trim() || "Candidate";
  state.questions = parsedQuestions;
  state.currentIndex = 0;
  state.results = [];

  $("#interviewerCompanyName").textContent = customCompany.name;
  $("#interviewerRoleLabel").textContent = `${state.selectedRole} Panel`;
  $("#qTotal").textContent = state.questions.length;

  closeAllModals();
  goToScreen(2, { live: true });
  setTimeout(()=> loadQuestion(), 650);
  toast(`Loaded ${parsedQuestions.length} custom questions!`);
  return true;
}

function extractKeywordsFromQuestion(qText){
  const words = qText.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/);
  const stopwords = new Set(["explain", "how", "what", "would", "you", "tell", "about", "time", "describe", "when", "using", "with", "from", "that", "this", "your"]);
  return words.filter(w => w.length > 3 && !stopwords.has(w)).slice(0, 6);
}

/* -------------------------------------------------------------------------
   LinkedIn / Profile Text Parser
   ------------------------------------------------------------------------- */
function parseLinkedInProfile(text, autoNavigate = true){
  if (!text || text.trim().length < 3) {
    if (autoNavigate) toast("Please paste your LinkedIn headline, bio, or skills list.");
    return;
  }

  const lower = text.toLowerCase();
  const detectedSkills = [];
  const detectedRoles = [];

  const skillDict = [
    "python", "javascript", "typescript", "react", "node", "java", "c++", "golang", "aws", "gcp", "azure", "docker",
    "kubernetes", "sql", "postgresql", "mongodb", "machine learning", "distributed systems", "system design",
    "nosql", "redis", "graphql", "microservices", "ci/cd", "product management", "analytics", "data engineering", "spring boot"
  ];

  skillDict.forEach(sk => {
    if (lower.includes(sk)) detectedSkills.push(sk.toUpperCase());
  });

  if (lower.includes("data analyst") || lower.includes("analytics") || lower.includes("tableau") || lower.includes("power bi") || lower.includes("bi ")) {
    detectedRoles.push("Data Analyst");
  }
  if (lower.includes("data scientist") || lower.includes("machine learning") || lower.includes("deep learning") || lower.includes("ai ") || lower.includes("llm")) {
    detectedRoles.push("Data Scientist");
  }
  if (lower.includes("devops") || lower.includes("sre") || lower.includes("infrastructure") || lower.includes("cloud")) {
    detectedRoles.push("DevOps Engineer");
  }
  if (lower.includes("product manager") || lower.includes("product lead") || lower.includes("roadmap") || lower.includes("pm")) {
    detectedRoles.push("Product Manager");
  }
  if (lower.includes("qa") || lower.includes("test") || lower.includes("automation") || lower.includes("sdet")) {
    detectedRoles.push("QA Engineer");
  }
  if (lower.includes("frontend") || lower.includes("react") || lower.includes("ui") || lower.includes("web developer")) {
    detectedRoles.push("Frontend Engineer");
  }
  if (lower.includes("backend") || lower.includes("java") || lower.includes("node") || lower.includes("microservices")) {
    detectedRoles.push("Backend Engineer");
  }
  if (!detectedRoles.length || lower.includes("software") || lower.includes("developer") || lower.includes("engineer")) {
    detectedRoles.unshift("Software Engineer");
  }

  const preview = $("#linkedinPreview");
  const chips = $("#detectedChips");
  if (preview && chips) {
    preview.style.display = "block";
    chips.innerHTML = [
      ...detectedRoles.map(r => `<span class="detected-chip selectable-role" data-role="${r}" style="border-color:var(--spotlight); color:var(--spotlight); cursor:pointer;">💼 ${r}</span>`),
      ...detectedSkills.slice(0, 10).map(s => `<span class="detected-chip">⚡ ${s}</span>`)
    ].join("");

    $$(".selectable-role").forEach(chip => {
      chip.onclick = () => {
        state.selectedRole = chip.dataset.role;
        $$(".selectable-role").forEach(c => c.style.background = "");
        chip.style.background = "rgba(255,176,32,0.25)";
        toast(`Selected target role: ${state.selectedRole}`);
      };
    });
  }

  state.selectedRole = detectedRoles[0];

  if (autoNavigate) {
    toast(`✨ Profile analyzed! Target role: ${detectedRoles[0]}`);
    setTimeout(() => {
      closeAllModals();
      goToScreen(1);
    }, 900);
  }
}

/* -------------------------------------------------------------------------
   Anki Flashcards Export (.tsv / .csv)
   ------------------------------------------------------------------------- */
function exportAnkiDeck(company){
  if (!company) return;
  const questions = [];

  if (company.roles) {
    Object.entries(company.roles).forEach(([role, qList]) => {
      (qList || []).forEach(q => questions.push({ q: q.q, type: `Technical (${role})`, keywords: (q.keywords || []).join(", ") }));
    });
  }
  (company.behavioral || []).forEach(q => questions.push({ q: q.q, type: "Behavioral (STAR)", keywords: (q.keywords || []).join(", ") }));
  (company.hr || []).forEach(q => questions.push({ q: q.q, type: "HR / Culture Fit", keywords: (q.keywords || []).join(", ") }));

  if (!questions.length) {
    toast("No questions available to export.");
    return;
  }

  const culture = company.culture_brief || {};
  let csv = "Front\tBack\tTags\n";

  questions.forEach(item => {
    const front = item.q.replace(/\t/g, " ").replace(/"/g, '""');
    const back = `<b>[${company.name} - ${item.type}]</b><br><br>` +
      `<b>Keywords to hit:</b> ${item.keywords || "Core principles"}<br><br>` +
      `<b>Scoring Focus:</b> ${culture.scoring_emphasis || "Clear structure and depth"}<br>` +
      `<b>Pro Tip:</b> ${culture.pro_tip || "Communicate trade-offs clearly."}`;
    csv += `"${front}"\t"${back.replace(/"/g, '""')}"\t"GreenRoom ${company.name.replace(/\s+/g, "_")}"\n`;
  });

  const blob = new Blob([csv], { type: "text/tab-separated-values;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `GreenRoom_${company.name.replace(/\s+/g, "_")}_Anki_Deck.tsv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`📥 Downloaded ${questions.length} cards for Anki!`);
}

/* -------------------------------------------------------------------------
   Shareable Report & Read-Only Report Link
   ------------------------------------------------------------------------- */
function generateShareableReport(report){
  const payload = {
    company: state.activeCompany?.name || "Company",
    role: state.selectedRole || "Software Engineer",
    overall_average: report.overall_average,
    hire_verdict: report.hire_verdict,
    radar: report.radar,
    strongest_area: report.strongest_area,
    weakest_area: report.weakest_area,
    questions_answered: report.questions_answered,
    benchmark: report.benchmark,
    per_question: report.per_question.map(q => ({
      question_text: q.question_text,
      overall_score: q.overall_score,
      verdict: q.verdict,
      feedback: q.feedback,
      interviewer_notes: q.interviewer_notes
    })),
    timestamp: Date.now()
  };

  const jsonStr = JSON.stringify(payload);
  const encoded = btoa(encodeURIComponent(jsonStr));
  const shareUrl = `${window.location.origin}${window.location.pathname}#report=${encoded}`;

  const shareInput = $("#shareUrlInput");
  if (shareInput) shareInput.value = shareUrl;

  const mentorMarkdown = [
    `# 🎤 GreenRoom Mock Interview Performance Summary`,
    `**Company:** ${payload.company} | **Role:** ${payload.role}`,
    `**Verdict:** ${payload.hire_verdict} (Score: ${payload.overall_average}/100)`,
    `**Benchmark:** ${payload.benchmark?.comparison_text || "Strong candidate"}`,
    ``,
    `### Radar Breakdown:`,
    `- **Relevance:** ${payload.radar.Relevance}/100`,
    `- **Structure (STAR/Tech Depth):** ${payload.radar.Structure}/100`,
    `- **Fluency & Pace:** ${payload.radar.Fluency}/100`,
    `- **Confidence:** ${payload.radar.Confidence}/100`,
    ``,
    `### Key Highlights:`,
    `- **Strongest:** ${payload.strongest_area}`,
    `- **Needs Polish:** ${payload.weakest_area}`,
    ``,
    `### Per-Question Performance:`,
    ...payload.per_question.map((q, idx) => `**Q${idx+1}:** ${q.question_text}\n- Score: ${q.overall_score}/100 (${q.verdict})\n- Note: ${q.feedback[0] || ""}`)
  ].join("\n");

  const summaryArea = $("#mentorSummaryText");
  if (summaryArea) summaryArea.value = mentorMarkdown;

  $("#shareModal").classList.add("open");
}

function checkHashForSharedReport(){
  const hash = window.location.hash;
  if (!hash || !hash.startsWith("#report=")) return;

  try {
    const raw = hash.replace("#report=", "");
    const decoded = decodeURIComponent(atob(raw));
    const reportData = JSON.parse(decoded);

    state.isReadOnlyShared = true;
    goToScreen(3);
    renderReport(reportData);
    toast("Viewing shared read-only performance report");
  } catch(e){
    console.error("Failed to parse shared report hash:", e);
  }
}

/* -------------------------------------------------------------------------
   Peer Mock Mode
   ------------------------------------------------------------------------- */
function openPeerMockModal(){
  const list = $("#peerQaList");
  if (!list) return;
  list.innerHTML = "";

  if (!state.results.length) {
    toast("No answers in current session yet.");
    return;
  }

  state.results.forEach((r, idx) => {
    const item = document.createElement("div");
    item.className = "peer-qa-item";
    item.innerHTML = `
      <div class="peer-qa-q">Q${idx+1}. ${r.question_text}</div>
      <div class="peer-qa-a">"Candidate answer evaluated with AI score: ${r.overall_score}/100"</div>
      <label style="font-size:.72rem; color:var(--muted); font-family:var(--font-mono); margin-bottom:4px; display:block;">Peer / Mentor Notes & Feedback:</label>
      <input type="text" class="peer-notes-input" data-idx="${idx}" placeholder="e.g. Good grasp of concepts, but explain the why before the how." value="${r.peer_note || ""}" />
    `;
    list.appendChild(item);
  });

  $("#peerModal").classList.add("open");
}

function savePeerMockNotes(){
  $$(".peer-notes-input").forEach(input => {
    const idx = Number(input.dataset.idx);
    if (state.results[idx]) {
      state.results[idx].peer_note = input.value.trim();
    }
  });
  $("#peerModal").classList.remove("open");
  toast("👥 Peer review notes saved alongside AI scores!");
  if (currentScreen === 3 && state.results.length) {
    buildReport();
  }
}

/* -------------------------------------------------------------------------
   Session History & Comparison
   ------------------------------------------------------------------------- */
function saveSession(report){
  if (state.isReadOnlyShared) return;
  const sessions = JSON.parse(localStorage.getItem("greenroom_sessions") || "[]");
  const session = {
    company: state.activeCompany?.name || "Unknown",
    companyId: state.activeCompany?.id || "unknown",
    role: state.selectedRole,
    score: report.overall_average,
    date: new Date().toISOString(),
    radar: report.radar
  };
  sessions.unshift(session);
  if (sessions.length > 15) sessions.pop();
  localStorage.setItem("greenroom_sessions", JSON.stringify(sessions));

  const companies = new Set(sessions.map(s => s.company));
  if (companies.size >= 5 && !state.achievements.five_companies) {
    state.achievements.five_companies = true;
    saveAchievements();
    toast("🎉 Achievement unlocked: 5 Companies!");
  }

  if (sessions.length >= 10 && !state.achievements.ten_sessions) {
    state.achievements.ten_sessions = true;
    saveAchievements();
    toast("🎉 Achievement unlocked: 10 Sessions!");
  }
}

function renderSessionHistory(){
  const sessions = JSON.parse(localStorage.getItem("greenroom_sessions") || "[]");
  const list = $("#sessionList");
  if (!list) return;
  list.innerHTML = "";

  if (sessions.length === 0) {
    list.innerHTML = `<p style="color:var(--muted-2); font-size:.75rem;">No sessions yet. Complete an interview to see your history.</p>`;
    return;
  }

  sessions.slice(0, 5).forEach(session => {
    const date = new Date(session.date);
    const dateStr = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const item = document.createElement("div");
    item.className = "session-item";
    item.innerHTML = `
      <div>
        <span class="session-item-company">${session.company}</span>
        <span style="color:var(--muted); margin:0 6px;">•</span>
        <span class="session-item-date">${dateStr}</span>
      </div>
      <span class="session-item-score">${Number(session.score).toFixed(1)}</span>
    `;
    list.appendChild(item);
  });
}

function renderSessionComparison(currentReport){
  const deltasContainer = $("#compDeltas");
  if (!deltasContainer) return;

  const sessions = JSON.parse(localStorage.getItem("greenroom_sessions") || "[]");
  const currentCompany = state.activeCompany?.name || "";
  const prevSession = sessions.find((s, idx) => idx > 0 && s.company === currentCompany);

  if (!prevSession) {
    deltasContainer.innerHTML = `<span class="comp-delta-chip neutral">🎯 First attempt on record for ${currentCompany} — baseline established!</span>`;
    return;
  }

  const scoreDiff = currentReport.overall_average - prevSession.score;
  const relDiff = currentReport.radar.Relevance - (prevSession.radar?.Relevance || 0);
  const structDiff = currentReport.radar.Structure - (prevSession.radar?.Structure || 0);
  const fluDiff = currentReport.radar.Fluency - (prevSession.radar?.Fluency || 0);
  const confDiff = currentReport.radar.Confidence - (prevSession.radar?.Confidence || 0);

  const formatDelta = (val, label) => {
    const sign = val > 0 ? `+${val.toFixed(1)}` : val.toFixed(1);
    const cls = val > 0 ? "pos" : val < 0 ? "neg" : "neutral";
    const icon = val > 0 ? "▲" : val < 0 ? "▼" : "•";
    return `<span class="comp-delta-chip ${cls}">${icon} ${label}: ${sign}</span>`;
  };

  deltasContainer.innerHTML = `
    ${formatDelta(scoreDiff, "Overall Score")}
    ${formatDelta(relDiff, "Relevance")}
    ${formatDelta(structDiff, "Structure")}
    ${formatDelta(fluDiff, "Fluency")}
    ${formatDelta(confDiff, "Confidence")}
  `;
}

/* -------------------------------------------------------------------------
   Spotlight follows cursor
   ------------------------------------------------------------------------- */
window.addEventListener("mousemove", (e)=>{
  gsap.to("#spotlight", { x: e.clientX - 300, y: e.clientY - 300, duration: 1.1, ease: "power3.out" });
});

/* -------------------------------------------------------------------------
   Screen Navigation
   ------------------------------------------------------------------------- */
let currentScreen = 0;

function goToScreen(index, { live = false } = {}){
  if (index === currentScreen) return;
  const curtain = $("#curtain");
  const left = $(".curtain-left");
  const right = $(".curtain-right");

  const tl = gsap.timeline();
  tl.set(curtain, { pointerEvents: "all" })
    .to(left, { x: "0%", duration: 0.55, ease: "power4.inOut" }, 0)
    .to(right, { x: "0%", duration: 0.55, ease: "power4.inOut" }, 0)
    .call(()=>{
      $$(".screen").forEach(s => s.classList.remove("active"));
      const target = document.querySelector(`.screen[data-screen="${index}"]`);
      if (target) target.classList.add("active");
      window.scrollTo({ top:0, behavior:"instant" });
      animateScreenIn(index);
      currentScreen = index;
      updateNav(index, live);
    })
    .to(left, { x: "-100%", duration: 0.55, ease: "power4.inOut", delay: 0.15 }, ">")
    .to(right, { x: "100%", duration: 0.55, ease: "power4.inOut" }, "<")
    .set(curtain, { pointerEvents: "none" });
}

function updateNav(index, live){
  $$(".nav-step").forEach(s => s.classList.toggle("active", Number(s.dataset.step) === index));
  const cue = $("#navCue");
  if (!cue) return;
  if (live){
    cue.classList.add("live");
    cue.innerHTML = `<span class="cue-dot"></span> ON AIR`;
  } else {
    cue.classList.remove("live");
    cue.innerHTML = `<span class="cue-dot"></span> OFF AIR`;
  }
}

function animateScreenIn(index){
  const target = document.querySelector(`.screen[data-screen="${index}"]`);
  if (target) gsap.fromTo(target.children, { y: 24, opacity: 0 }, { y:0, opacity:1, duration:.7, stagger:.08, ease:"power3.out" });
}

/* -------------------------------------------------------------------------
   Hero Animations
   ------------------------------------------------------------------------- */
function buildWaveform(){
  const wf = $("#heroWaveform");
  if (!wf) return;
  wf.innerHTML = "";
  const bars = 20;
  for (let i=0;i<bars;i++){
    const bar = document.createElement("span");
    const h = 6 + Math.random()*20;
    bar.style.height = h + "px";
    wf.appendChild(bar);
  }
  gsap.to("#heroWaveform span", {
    height: () => 4 + Math.random()*24,
    duration: 0.5,
    repeat: -1,
    yoyo: true,
    stagger: { each: 0.04, repeat: -1, yoyo: true },
    ease: "sine.inOut"
  });
}

function pulseRings(){
  gsap.to(".ring-1", { scale: 1.06, opacity: .4, duration: 2.2, repeat:-1, yoyo:true, ease:"sine.inOut" });
  gsap.to(".ring-2", { scale: 1.1, opacity: .6, duration: 1.8, repeat:-1, yoyo:true, ease:"sine.inOut", delay:.2 });
  gsap.to(".ring-3", { scale: 1.14, opacity: .8, duration: 1.5, repeat:-1, yoyo:true, ease:"sine.inOut", delay:.4 });
}

function countUpStats(){
  $$(".stat-num").forEach(el => {
    const target = Number(el.dataset.count);
    const obj = { v: 0 };
    gsap.to(obj, {
      v: target, duration: 1.6, ease: "power2.out", delay: .4,
      onUpdate: () => el.textContent = Math.round(obj.v)
    });
  });
}

function heroLoadAnimation(){
  const tl = gsap.timeline({ defaults:{ ease:"power3.out" } });
  tl.from(".nav", { y:-40, opacity:0, duration:.7 })
    .from(".eyebrow", { y:16, opacity:0, duration:.6 }, "-=.3")
    .from(".hero-title", { y:30, opacity:0, duration:.8 }, "-=.4")
    .from(".hero-sub", { y:20, opacity:0, duration:.7 }, "-=.5")
    .from(".countdown-widget", { y:20, opacity:0, duration:.6 }, "-=.4")
    .from(".hero-actions .btn", { y:16, opacity:0, stagger:.1, duration:.6 }, "-=.4")
    .from(".stat", { y:16, opacity:0, stagger:.1, duration:.5 }, "-=.3")
    .from(".mic-rig", { scale:.7, opacity:0, duration:.9, ease:"back.out(1.6)" }, "-=1")
    .from(".mic-caption", { opacity:0, duration:.5 }, "-=.2")
    .from(".marquee", { opacity:0, duration:.8 }, "-=.2");
}

/* -------------------------------------------------------------------------
   Load & Render Companies
   ------------------------------------------------------------------------- */
async function loadCompanies(){
  try{
    const res = await fetch(`${API}/api/companies`);
    state.companies = await res.json();
    loadCustomBanks();
    renderCompanyGrid();
    populateCountdownCompanySelect();
  }catch(e){
    toast("Operating in offline / cached mode.");
    renderCompanyGrid();
  }
}

function renderCompanyGrid(){
  const grid = $("#companyGrid");
  if (!grid) return;
  grid.innerHTML = "";

  const q = state.searchQuery.toLowerCase().trim();
  const allCards = [...state.customBanks, ...state.companies].filter(c => {
    if (!q) return true;
    const nameMatch = (c.name || "").toLowerCase().includes(q);
    const focusMatch = (c.focus || "").toLowerCase().includes(q);
    const roleMatch = c.roles ? JSON.stringify(c.roles).toLowerCase().includes(q) : false;
    return nameMatch || focusMatch || roleMatch;
  });

  if (allCards.length === 0) {
    grid.innerHTML = `<div style="grid-column:1/-1; padding:40px; text-align:center; color:var(--muted);">No companies found matching "${state.searchQuery}". Try searching "Google", "Amazon", "Frontend", or "Python".</div>`;
    return;
  }

  allCards.forEach((c) => {
    const card = document.createElement("div");
    card.className = "company-card";
    card.style.setProperty("--card-accent", c.accent || "#FFB020");
    const avgText = c.benchmark_avg ? `Avg Score: ${c.benchmark_avg}` : (c.isCustom ? "Custom Bank" : "");

    card.innerHTML = `
      <div class="card-top">
        <div class="card-logo">${c.name[0]}</div>
        <div>
          <div class="card-name">${c.name} ${c.isCustom ? '<span style="font-size:.65rem; color:var(--signal);">[CUSTOM]</span>' : ''}</div>
          <div class="card-diff">${c.difficulty} • ${avgText}</div>
        </div>
      </div>
      <p class="card-focus">${c.focus}</p>
      <div class="card-rounds">
        ${(c.rounds || ["Interview"]).map(r => `<span class="round-pill">${r}</span>`).join("")}
      </div>
    `;
    card.addEventListener("click", () => openSetupModal(c));
    grid.appendChild(card);
  });
  gsap.fromTo(".company-card", { y: 20, opacity: 0 }, { y:0, opacity:1, duration:.45, stagger:.03, ease:"power3.out" });
}

function populateCountdownCompanySelect(){
  const select = $("#countdownCompanySelect");
  if (!select) return;
  select.innerHTML = state.companies.map(c => `<option value="${c.id}">${c.name}</option>`).join("");
}

/* -------------------------------------------------------------------------
   Webcam & Camera Access Management
   ------------------------------------------------------------------------- */
async function requestCameraAccess(triggerSource = "user"){
  try {
    if (state.cameraStream && state.cameraStream.active && state.cameraStream.getVideoTracks().some(t => t.readyState === "live")) {
      updateCameraUI(true);
      return true;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false
      });
    } catch(err) {
      console.warn("getUserMedia standard constraint failed, attempting basic video:", err);
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
    }

    state.cameraStream = stream;
    state.cameraGranted = true;

    const vTracks = stream.getVideoTracks();
    if (vTracks && vTracks.length > 0) {
      vTracks[0].onended = () => {
        handleCameraDisconnected();
      };
    }

    updateCameraUI(true);
    toast("Camera access verified successfully! 🎥");
    return true;
  } catch(err) {
    console.warn("Camera access failed or was denied:", err);
    state.cameraStream = null;
    state.cameraGranted = false;
    updateCameraUI(false);
    return false;
  }
}

function updateCameraUI(isReady){
  const preview = $("#setupCameraPreview");
  const overlay = $("#cameraStatusOverlay");
  const indicator = $("#camIndicatorDot");
  const statusText = $("#camStatusText");
  const candidateCam = $("#candidateWebcam");

  if (isReady && state.cameraStream) {
    if (preview) {
      preview.srcObject = state.cameraStream;
      preview.classList.add("active");
      preview.play().catch(() => {});
    }
    if (overlay) overlay.classList.add("hidden");
    if (indicator) {
      indicator.classList.remove("not-ready");
      indicator.classList.add("ready");
    }
    if (statusText) statusText.textContent = "Camera: Verified & Active";

    if (candidateCam) {
      candidateCam.srcObject = state.cameraStream;
      candidateCam.play().catch(() => {});
    }
  } else {
    if (preview) {
      preview.srcObject = null;
      preview.classList.remove("active");
    }
    if (overlay) overlay.classList.remove("hidden");
    if (indicator) {
      indicator.classList.remove("ready");
      indicator.classList.add("not-ready");
    }
    if (statusText) statusText.textContent = "Camera: Access Required";

    if (candidateCam) {
      candidateCam.srcObject = null;
    }
  }
}

function handleCameraDisconnected(){
  state.cameraStream = null;
  state.cameraGranted = false;
  updateCameraUI(false);
  const roomScreen = document.querySelector('.screen.screen-room.active');
  if (roomScreen) {
    openCameraBlockModal();
    toast("Camera disconnected. Interview paused until camera is reconnected.");
  }
}

function openCameraBlockModal(){
  const modal = $("#cameraBlockModal");
  if (modal) modal.classList.add("open");
}

function closeCameraBlockModal(){
  const modal = $("#cameraBlockModal");
  if (modal) modal.classList.remove("open");
}

async function ensureCameraReady(){
  if (state.cameraStream && state.cameraStream.active && state.cameraStream.getVideoTracks().some(t => t.readyState === "live")) {
    updateCameraUI(true);
    return true;
  }
  return await requestCameraAccess("check");
}

/* -------------------------------------------------------------------------
   Setup Modal
   ------------------------------------------------------------------------- */
function openSetupModal(company){
  state.activeCompany = company;
  state.isSpacedRepMode = false;
  const roleKeys = company.roles ? (Array.isArray(company.roles) ? company.roles : Object.keys(company.roles)) : ["Software Engineer"];
  if (!state.selectedRole || !roleKeys.includes(state.selectedRole)) {
    state.selectedRole = roleKeys[0];
  }
  state.selectedPersona = "friendly";
  state.selectedFormat = "onsite";
  state.selectedLang = "english";
  if (!state.selectedLevel) state.selectedLevel = "mid";

  $("#modalLogo").style.background = company.accent || "var(--spotlight)";
  $("#modalLogo").textContent = company.name[0];
  $("#modalCompanyName").textContent = company.name;
  $("#modalCompanyFocus").textContent = company.focus;

  $("#roundChips").innerHTML = (company.rounds || ["General Round"]).map(r => `<span class="chip">${r}</span>`).join("");
  $("#roleChips").innerHTML = roleKeys.map(r =>
    `<span class="chip selectable ${r === state.selectedRole ? "selected":""}" data-role="${r}">${r}</span>`
  ).join("");

  $$(".role-chips .chip").forEach(chip => {
    chip.onclick = () => {
      state.selectedRole = chip.dataset.role;
      $$(".role-chips .chip").forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
      loadCallSheet(company.id);
    };
  });

  // Level selector chips
  $$("#levelChips .chip").forEach(chip => {
    chip.classList.toggle("selected", chip.dataset.level === state.selectedLevel);
    chip.onclick = () => {
      state.selectedLevel = chip.dataset.level;
      $$("#levelChips .chip").forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
      loadCallSheet(company.id);
    };
  });

  $$("#personaChips .chip").forEach(chip => {
    chip.classList.toggle("selected", chip.dataset.persona === state.selectedPersona);
    chip.onclick = () => {
      state.selectedPersona = chip.dataset.persona;
      $$("#personaChips .chip").forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
    };
  });

  $$("#formatChips .chip").forEach(chip => {
    chip.classList.toggle("selected", chip.dataset.format === state.selectedFormat);
    chip.onclick = () => {
      state.selectedFormat = chip.dataset.format;
      $$("#formatChips .chip").forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
    };
  });

  $$("#langChips .chip").forEach(chip => {
    chip.classList.toggle("selected", chip.dataset.lang === state.selectedLang);
    chip.onclick = () => {
      state.selectedLang = chip.dataset.lang;
      $$("#langChips .chip").forEach(c => c.classList.remove("selected"));
      chip.classList.add("selected");
    };
  });

  const breathToggle = $("#breathingToggle");
  if (breathToggle) {
    breathToggle.checked = state.breathingEnabled;
    breathToggle.onchange = (e) => state.breathingEnabled = e.target.checked;
  }

  // Camera preview setup
  const isCameraActive = state.cameraStream && state.cameraStream.active && state.cameraStream.getVideoTracks().some(t => t.readyState === "live");
  updateCameraUI(isCameraActive);
  const grantCamBtn = $("#grantCameraBtn");
  if (grantCamBtn) {
    grantCamBtn.onclick = async () => {
      await requestCameraAccess();
    };
  }

  renderCultureBriefTab(company);
  switchTab("setup");
  loadCallSheet(company.id);

  $("#setupModal").classList.add("open");
}

function renderCultureBriefTab(company){
  const container = $("#cultureBriefContent");
  if (!container) return;
  const cb = company.culture_brief || {
    what_they_value: "Clear structured communication, problem decomposition, and strong fundamental principles.",
    scoring_emphasis: "STAR method for behavioral questions and trade-off depth for technical ones.",
    red_flags: "Rushed answers, lack of ownership, or failing to state assumptions.",
    pro_tip: "Speak with clarity and structure your thoughts before diving into implementation."
  };

  container.innerHTML = `
    <div class="culture-sec">
      <p class="culture-sec-title">WHAT ${company.name.toUpperCase()} ACTUALLY VALUES</p>
      <p class="culture-sec-text">${cb.what_they_value}</p>
    </div>
    <div class="culture-sec">
      <p class="culture-sec-title">SCORING & EVALUATION EMPHASIS</p>
      <p class="culture-sec-text">${cb.scoring_emphasis}</p>
    </div>
    <div class="culture-sec culture-red-flags">
      <p class="culture-sec-title" style="color:var(--danger);">RED FLAGS TO AVOID</p>
      <p class="culture-sec-text">${cb.red_flags}</p>
    </div>
    <div class="culture-sec culture-pro-tip">
      <p class="culture-sec-title" style="color:var(--signal);">PRO TIP FOR YOUR REHEARSAL</p>
      <p class="culture-sec-text">${cb.pro_tip}</p>
    </div>
  `;
}

function switchTab(name){
  $$(".modal-tabs .tab-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  $$(".modal-card .tab-panel").forEach(p => p.classList.toggle("active", p.dataset.panel === name));
}

async function loadCallSheet(companyId){
  const list = $("#callsheetList");
  list.innerHTML = `<p class="callsheet-note">Loading call sheet…</p>`;
  try{
    if (state.activeCompany && state.activeCompany.isCustom) {
      const qList = state.activeCompany.roles[state.selectedRole] || [];
      list.innerHTML = qList.map(q => {
        const lvl = q.level || "mid";
        return `<div class="callsheet-item"><span class="callsheet-level-badge ${lvl}">${lvl.toUpperCase()}</span> ${q.q}</div>`;
      }).join("");
      return;
    }

    const role = state.selectedRole;
    const lvl = state.selectedLevel || "mid";
    const res = await fetch(`${API}/api/questions/${companyId}?role=${encodeURIComponent(role)}&count=12&level=${encodeURIComponent(lvl)}`);
    const data = await res.json();
    let html = "";
    const groups = [
      ["Technical", data.all_technical],
      ["Behavioral", data.all_behavioral],
      ["HR / Fit", data.all_hr]
    ];
    groups.forEach(([label, arr]) => {
      if (!arr || !arr.length) return;
      html += `<div class="callsheet-group-title">${label.toUpperCase()}</div>`;
      arr.forEach(q => {
        const qLevel = q.level || lvl || "mid";
        html += `<div class="callsheet-item"><span class="callsheet-level-badge ${qLevel}">${qLevel.toUpperCase()}</span> ${q.q}</div>`;
      });
    });
    list.innerHTML = html || "<p class='callsheet-note'>No questions on file yet.</p>";
  }catch(e){
    list.innerHTML = "<p class='callsheet-note'>Couldn't load the call sheet.</p>";
  }
}

/* -------------------------------------------------------------------------
   Begin Interview
   ------------------------------------------------------------------------- */
async function beginInterview(){
  const company = state.activeCompany;
  if (!company) return;

  // 1. MANDATORY CAMERA PERMISSION ENFORCEMENT
  const hasCamera = await ensureCameraReady();
  if (!hasCamera) {
    openCameraBlockModal();
    toast("Camera access is strictly required to start the interview.");
    return; // Interview will not start without camera access!
  }

  try{
    if (company.isCustom) {
      state.questions = (company.roles[state.selectedRole] || []).slice(0, state.qCount);
    } else {
      const lvl = state.selectedLevel || "mid";
      const res = await fetch(`${API}/api/questions/${company.id}?role=${encodeURIComponent(state.selectedRole)}&count=${state.qCount}&level=${encodeURIComponent(lvl)}`);
      const data = await res.json();
      state.questions = data.questions;
    }

    state.currentIndex = 0;
    state.results = [];
    state.interviewId = "iv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);

    const roomGrid = $("#roomGrid");
    if (roomGrid) {
      roomGrid.classList.toggle("phone-screen-mode", state.selectedFormat === "phone");
    }
    $("#roomFormatTag").textContent = state.selectedFormat.toUpperCase();
    $("#roomLangTag").textContent = state.selectedLang === "hinglish" ? "HINGLISH" : "EN";

    $("#interviewerCompanyName").textContent = company.name;
    $("#interviewerRoleLabel").textContent = `${state.selectedRole} Panel`;
    $("#qTotal").textContent = state.questions.length;

    // Attach camera to live candidate webcam element
    const candidateCam = $("#candidateWebcam");
    if (candidateCam && state.cameraStream) {
      candidateCam.srcObject = state.cameraStream;
      candidateCam.play().catch(() => {});
    }

    closeAllModals();
    goToScreen(2, { live: true });
    setTimeout(()=> loadQuestion(), 650);
  }catch(e){
    console.error("Error beginning interview:", e);
    toast("Couldn't start the rehearsal. Check backend server.");
  }
}

/* -------------------------------------------------------------------------
   Interview Room Logic
   ------------------------------------------------------------------------- */
function loadQuestion(){
  const q = state.questions[state.currentIndex];
  if (!q){ return finishInterview(); }

  if (state.selectedFormat === "panel") {
    const panelInterviewer = PANEL_INTERVIEWERS[state.currentIndex % PANEL_INTERVIEWERS.length];
    $("#interviewerCompanyName").textContent = `${state.activeCompany?.name || 'Company'} Panel`;
    $("#interviewerRoleLabel").textContent = `${panelInterviewer.name} (${panelInterviewer.role})`;
    $("#interviewerPersonaTag").textContent = panelInterviewer.tag;
    state.selectedPersona = panelInterviewer.persona;
  } else {
    const personaLabels = { friendly: "Friendly HR", technical: "Technical Lead", barraiser: "Bar-Raiser" };
    $("#interviewerPersonaTag").textContent = personaLabels[state.selectedPersona] || "Interviewer";
  }

  $("#feedbackResult").style.display = "none";
  $("#feedbackEmpty").style.display = "block";
  $("#answerInput").value = "";
  state.baseTranscript = "";
  updateLiveMeta();

  $("#questionTag").textContent = (q.type || "general").replace("_", " ").toUpperCase();
  const levelTag = $("#questionLevelTag");
  if (levelTag) {
    const qLevel = q.level || state.selectedLevel || "mid";
    levelTag.textContent = qLevel.toUpperCase();
    levelTag.className = `level-tag ${qLevel}`;
  }

  const candBadge = $("#candidateLevelBadge");
  if (candBadge) {
    const chosenLevel = state.selectedLevel === "all" ? "ALL-ROUND" : (state.selectedLevel || "MID").toUpperCase();
    candBadge.textContent = `${chosenLevel} CANDIDATE`;
  }

  const candidateCam = $("#candidateWebcam");
  if (candidateCam && state.cameraStream) {
    if (candidateCam.srcObject !== state.cameraStream) {
      candidateCam.srcObject = state.cameraStream;
    }
    candidateCam.play().catch(() => {});
  }

  $("#qCurrent").textContent = state.currentIndex + 1;
  $("#progressFill").style.width = `${(state.currentIndex / state.questions.length) * 100}%`;

  const qEl = $("#questionText");
  qEl.textContent = "";
  typewriter(qEl, q.q);

  startQuestionTimer();
  gsap.fromTo(".room-center > *", { opacity:0, y:14 }, { opacity:1, y:0, duration:.5, stagger:.06, ease:"power3.out" });
}

function typewriter(el, text){
  let i = 0;
  const speed = 15;
  clearInterval(typewriter._int);
  typewriter._int = setInterval(()=>{
    el.textContent = text.slice(0, i);
    i++;
    if (i > text.length) clearInterval(typewriter._int);
  }, speed);
}

function startQuestionTimer(){
  clearInterval(state.timerInterval);
  state.timerSeconds = 0;
  state.answerStartTime = Date.now();
  const circle = $("#timerProgress");
  const maxSeconds = state.selectedFormat === "onsite" ? 90 : 120;
  if (circle) circle.style.strokeDashoffset = 327;

  state.timerInterval = setInterval(()=>{
    state.timerSeconds++;
    const mins = String(Math.floor(state.timerSeconds/60)).padStart(2,"0");
    const secs = String(state.timerSeconds % 60).padStart(2,"0");
    const textEl = $("#timerText");
    if (textEl) textEl.textContent = `${mins}:${secs}`;
    if (circle) {
      const pct = Math.min(state.timerSeconds / maxSeconds, 1);
      circle.style.strokeDashoffset = 327 - (327 * pct);
    }
  }, 1000);
}

function updateLiveMeta(){
  const text = $("#answerInput").value;
  const words = text.trim().length ? text.trim().split(/\s+/) : [];
  const fillerRegex = /\b(um|uh|umm|uhh|like|actually|basically|literally|you know|matlab|yaani|jaise ki|accha|toh|samjhe|bhai)\b/gi;
  const fillers = (text.match(fillerRegex) || []).length;
  $("#liveWordCount").textContent = `${words.length} words`;
  $("#liveFillerCount").textContent = `${fillers} filler words`;
}

/* Speech recognition */
function setupRecognition(){
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return null;
  const rec = new SR();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = state.selectedLang === "hinglish" ? "hi-IN" : "en-US";

  rec.onresult = (e) => {
    let interim = "";
    let final = "";
    for (let i = e.resultIndex; i < e.results.length; i++){
      const transcript = e.results[i][0].transcript;
      if (e.results[i].isFinal) final += transcript + " ";
      else interim += transcript;
    }
    if (final) state.baseTranscript += final;
    $("#answerInput").value = (state.baseTranscript + " " + interim).trim();
    updateLiveMeta();
  };
  rec.onerror = () => { stopRecording(); };
  rec.onend = () => { if (state.isRecording) rec.start(); };
  return rec;
}

function startRecording(){
  if (!state.recognition) state.recognition = setupRecognition();
  if (!state.recognition){ toast("Speech recognition isn't supported in this browser — type your answer instead."); return; }
  state.isRecording = true;
  state.baseTranscript = $("#answerInput").value ? $("#answerInput").value + " " : "";
  state.recognition.start();
  $("#micToggle").classList.add("recording");
  $("#micToggleLabel").textContent = "Listening… tap to stop";
  $("#onAirBadge").classList.add("live");
}

function stopRecording(){
  state.isRecording = false;
  if (state.recognition){ try{ state.recognition.stop(); }catch(e){} }
  $("#micToggle").classList.remove("recording");
  $("#micToggleLabel").textContent = "Tap mic to speak";
}

/* Submit Answer */
async function submitAnswer(){
  const q = state.questions[state.currentIndex];
  const answer = $("#answerInput").value.trim();
  if (!answer){ toast("Say or type your answer before submitting."); return; }

  stopRecording();
  clearInterval(state.timerInterval);
  const duration = (Date.now() - state.answerStartTime) / 1000;

  $("#submitAnswerBtn").textContent = "Scoring with NLP engine…";
  $("#submitAnswerBtn").disabled = true;

  try{
    const res = await fetch(`${API}/api/evaluate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interview_id: state.interviewId,
        user_id: state.userId,
        question_id: q.id,
        question_text: q.q,
        level: q.level || state.selectedLevel || "mid",
        question_type: q.type,
        keywords: q.keywords,
        answer,
        duration_seconds: duration,
        persona: state.selectedPersona,
        language: state.selectedLang,
        company_id: state.activeCompany?.id || "google"
      })
    });
    const result = await res.json();
    result.question_text = q.q;
    result.candidate_answer = answer;
    state.results.push(result);

    recordQuestionResultForSpacedRep(q, result);
    revealScorecard(result);
    checkAchievements();
  }catch(e){
    toast("Evaluation failed — check backend server.");
  }finally{
    $("#submitAnswerBtn").textContent = "Submit Answer";
    $("#submitAnswerBtn").disabled = false;
  }
}

function revealScorecard(result){
  $("#feedbackEmpty").style.display = "none";
  const panel = $("#feedbackResult");
  panel.style.display = "block";
  gsap.fromTo(panel, { opacity:0, y:20 }, { opacity:1, y:0, duration:.5, ease:"power3.out" });

  const score = result.overall_score;
  $("#scoreNum").textContent = "0";
  $("#scoreVerdict").textContent = result.verdict;

  const circumference = 377;
  const gaugeFill = $("#gaugeFill");
  gaugeFill.style.stroke = score >= 70 ? "var(--success)" : score >= 50 ? "var(--spotlight)" : "var(--danger)";
  gsap.fromTo(gaugeFill, { strokeDashoffset: circumference }, {
    strokeDashoffset: circumference - (circumference * score/100),
    duration: 1.3, ease: "power2.out"
  });

  const counter = { v: 0 };
  gsap.to(counter, { v: score, duration: 1.3, ease:"power2.out", onUpdate: () => {
    $("#scoreNum").textContent = Math.round(counter.v);
  }});

  const bars = [
    ["Relevance", result.breakdown.relevance],
    ["Structure", result.breakdown.structure.score],
    ["Fluency", result.breakdown.fluency.score],
    ["Confidence", result.breakdown.confidence.score]
  ];
  const barsEl = $("#miniBars");
  barsEl.innerHTML = bars.map(([label, val]) => `
    <div class="mini-bar-row">
      <div class="mini-bar-label"><span>${label}</span><span>${val}</span></div>
      <div class="mini-bar-track"><div class="mini-bar-fill" data-val="${val}"></div></div>
    </div>
  `).join("");
  gsap.to("#miniBars .mini-bar-fill", {
    width: (i, el) => el.dataset.val + "%",
    duration: 1, ease:"power2.out", stagger: .1, delay:.2
  });

  renderFeedback(result);

  // Render Benchmark Model Answer Comparison
  const compCard = $("#benchmarkComparisonCard");
  if (compCard && result.comparison) {
    compCard.style.display = "block";
    const cov = Math.round(result.comparison.coverage_percentage || 0);
    const pill = $("#compCoveragePill");
    if (pill) {
      pill.textContent = `${cov}% Match`;
      pill.className = `comp-coverage-pill ${cov < 45 ? "low" : cov < 75 ? "medium" : ""}`;
    }
    const summary = $("#compSummaryText");
    if (summary) summary.textContent = result.comparison.summary || "";

    const coveredTags = $("#compCoveredTags");
    if (coveredTags) {
      const pts = result.comparison.covered_points || [];
      coveredTags.innerHTML = pts.length 
        ? pts.map(p => `<span class="concept-tag covered">✓ ${escapeHtml(p)}</span>`).join("")
        : `<span style="color:var(--muted); font-size:.72rem;">No benchmark concepts matched yet</span>`;
    }

    const missedTags = $("#compMissedTags");
    if (missedTags) {
      const missed = result.comparison.missed_points || [];
      missedTags.innerHTML = missed.length
        ? missed.map(p => `<span class="concept-tag missed">⚠ ${escapeHtml(p)}</span>`).join("")
        : `<span class="concept-tag covered">✓ All key benchmark concepts hit!</span>`;
    }

    const modelAns = $("#compModelAnswerText");
    if (modelAns) modelAns.textContent = result.comparison.expected_answer || "Standard benchmark criteria applied.";
  } else if (compCard) {
    compCard.style.display = "none";
  }
}

function renderFeedback(result){
  const listEl = $("#feedbackList");
  listEl.innerHTML = "";
  listEl.classList.toggle("interviewer-notes", state.notesView);

  const items = state.notesView ? (result.interviewer_notes || result.feedback) : result.feedback;
  items.forEach((f, i) => {
    const li = document.createElement("li");
    li.textContent = f;
    if (state.notesView) {
      li.className = f.startsWith("[+]") ? "positive" : f.startsWith("[-]") ? "negative" : "";
    }
    li.style.opacity = 0;
    listEl.appendChild(li);
    gsap.to(li, { opacity:1, y:0, duration:.4, delay: .3 + i*.1, ease:"power2.out" });
  });
}

function showBreathingBreak(){
  const overlay = $("#breathingOverlay");
  const text = $("#breathingText");
  const timer = $("#breathingTimer");
  overlay.classList.add("active");

  let secondsLeft = 10;
  if (timer) timer.textContent = `${secondsLeft}s`;

  let phase = 0;
  const phases = [
    { text: "Breathe in deeply...", duration: 3500 },
    { text: "Hold and compose...", duration: 3000 },
    { text: "Breathe out slowly...", duration: 3500 }
  ];

  function cyclePhase(){
    if (!overlay.classList.contains("active")) return;
    text.textContent = phases[phase].text;
    cyclePhase._t = setTimeout(() => {
      phase = (phase + 1) % phases.length;
      cyclePhase();
    }, phases[phase].duration);
  }
  cyclePhase();

  const secInterval = setInterval(() => {
    secondsLeft--;
    if (timer) timer.textContent = `${secondsLeft}s`;
    if (secondsLeft <= 0) {
      clearInterval(secInterval);
      hideBreathingBreak();
    }
  }, 1000);

  const skipBtn = $("#skipBreathingBtn");
  if(skipBtn) skipBtn.onclick = () => {
    clearInterval(secInterval);
    clearTimeout(cyclePhase._t);
    hideBreathingBreak();
  };
}

function hideBreathingBreak(){
  const overlay = $("#breathingOverlay");
  overlay.classList.remove("active");
  setTimeout(() => loadQuestion(), 300);
}

function finishInterview(){
  goToScreen(3, { live: false });
  setTimeout(()=> buildReport(), 650);
}

function renderReport(report){
  $("#reportVerdictLabel").textContent = report.hire_verdict;
  $("#reportQCount").textContent = report.questions_answered;

  const counter = { v: 0 };
  gsap.to(counter, { v: report.overall_average, duration: 1.4, ease:"power2.out", onUpdate: () => {
    $("#reportOverallScore").textContent = Math.round(counter.v);
  }});

  $("#strongestArea").textContent = report.strongest_area;
  $("#weakestArea").textContent = report.weakest_area;

  if (report.benchmark) {
    const pVal = report.benchmark.percentile;
    $("#benchmarkPercentileText").textContent = `Top ${100 - pVal}% (Percentile: ${pVal}%)`;
    $("#benchmarkSummaryText").textContent = report.benchmark.comparison_text || `Scored higher than ${pVal}% of candidate rehearsals.`;
    gsap.to("#benchmarkFill", { width: `${pVal}%`, duration: 1.4, ease:"power2.out", delay:.3 });
  }

  renderSessionComparison(report);
  drawRadar(report.radar);
  renderSessionHistory();
  renderReportQaList(report.per_question);
}

function renderReportQaList(perQuestion){
  const qaEl = $("#qaReview");
  if(!qaEl) return;
  qaEl.innerHTML = "";

  perQuestion.forEach((r, i) => {
    const div = document.createElement("div");
    div.className = "qa-item";
    const color = (r.overall_score || 0) >= 70 ? "var(--success)" : (r.overall_score || 0) >= 50 ? "var(--spotlight)" : "var(--danger)";
    const feedbackText = state.reportNotesView && r.interviewer_notes ? r.interviewer_notes.join(" | ") : (r.feedback ? r.feedback[0] : "");
    const comp = r.comparison;

    div.innerHTML = `
      <div class="qa-item-top">
        <span class="qa-item-q">Q${i+1}. ${escapeHtml(r.question_text || "Interview Question")}</span>
        <span class="qa-item-score" style="color:${color}">${r.overall_score || 0}</span>
      </div>
      <p class="qa-item-fb">${escapeHtml(feedbackText)}</p>
      ${r.candidate_answer ? `
        <div style="margin-top:8px; font-size:.75rem; color:#cbd5e1; background:rgba(0,0,0,0.25); padding:7px 10px; border-radius:4px; border:1px solid var(--border);">
          <div style="font-size:.67rem; color:var(--muted); margin-bottom:2px; font-weight:600; font-family:var(--font-mono);">YOUR RECORDED ANSWER:</div>
          <div>${escapeHtml(r.candidate_answer)}</div>
        </div>
      ` : ''}
      ${comp ? `
        <div style="margin-top:8px; font-size:.74rem; border-left:2px solid var(--signal); background:rgba(89,217,196,0.05); padding:8px 10px; border-radius:0 4px 4px 0;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
            <strong style="color:var(--signal); font-size:.72rem; font-family:var(--font-mono);">DATABASE BENCHMARK ANSWER (${comp.coverage_percentage || 0}% match):</strong>
          </div>
          <p style="color:#94a3b8; margin:0 0 6px 0; font-size:.73rem; line-height:1.4;">${escapeHtml(comp.expected_answer || '')}</p>
          ${comp.covered_points && comp.covered_points.length ? `
            <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;">
              <span style="font-size:.65rem; color:var(--signal); font-weight:600;">Covered:</span>
              ${comp.covered_points.map(p => `<span class="concept-tag covered" style="font-size:.65rem; padding:1px 5px;">✓ ${escapeHtml(p)}</span>`).join("")}
            </div>
          ` : ''}
          ${comp.missed_points && comp.missed_points.length ? `
            <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;">
              <span style="font-size:.65rem; color:var(--spotlight); font-weight:600;">Key Gaps:</span>
              ${comp.missed_points.map(p => `<span class="concept-tag missed" style="font-size:.65rem; padding:1px 5px;">⚠ ${escapeHtml(p)}</span>`).join("")}
            </div>
          ` : ''}
        </div>
      ` : ''}
      ${r.peer_note ? `<p style="color:var(--signal); font-size:.75rem; margin-top:4px;">👥 Peer Note: ${escapeHtml(r.peer_note)}</p>` : ''}
    `;
    qaEl.appendChild(div);
  });
  gsap.fromTo(".qa-item", { opacity:0, x:-14 }, { opacity:1, x:0, duration:.5, stagger:.06, ease:"power3.out" });
}

function drawRadar(radar){
  const canvas = $("#radarCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const labels = Object.keys(radar);
  const values = Object.values(radar);
  const colors = { Relevance:"#FFB020", Structure:"#59D9C4", Fluency:"#FF9F5A", Confidence:"#8FD9FF" };

  const cx = canvas.width/2, cy = canvas.height/2, radius = 120;
  const n = labels.length;
  const angleStep = (Math.PI*2)/n;

  let frame = 0;
  const totalFrames = 40;

  function drawFrame(progress){
    ctx.clearRect(0,0,canvas.width, canvas.height);

    ctx.strokeStyle = "rgba(255,255,255,0.08)";
    for (let ring=1; ring<=4; ring++){
      ctx.beginPath();
      for (let i=0;i<=n;i++){
        const angle = i*angleStep - Math.PI/2;
        const r = (radius/4)*ring;
        const x = cx + Math.cos(angle)*r;
        const y = cy + Math.sin(angle)*r;
        i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
      }
      ctx.stroke();
    }

    ctx.fillStyle = "#8B8D9B";
    ctx.font = "12px 'JetBrains Mono', monospace";
    labels.forEach((label, i) => {
      const angle = i*angleStep - Math.PI/2;
      const x1 = cx, y1 = cy;
      const x2 = cx + Math.cos(angle)*radius;
      const y2 = cy + Math.sin(angle)*radius;
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();

      const lx = cx + Math.cos(angle)*(radius+22);
      const ly = cy + Math.sin(angle)*(radius+22);
      ctx.textAlign = "center";
      ctx.fillText(label, lx, ly);
    });

    ctx.beginPath();
    values.forEach((v, i) => {
      const angle = i*angleStep - Math.PI/2;
      const r = (radius * (v/100)) * progress;
      const x = cx + Math.cos(angle)*r;
      const y = cy + Math.sin(angle)*r;
      i===0 ? ctx.moveTo(x,y) : ctx.lineTo(x,y);
    });
    ctx.closePath();
    ctx.fillStyle = "rgba(255,176,32,0.18)";
    ctx.strokeStyle = "#FFB020";
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();

    values.forEach((v, i) => {
      const angle = i*angleStep - Math.PI/2;
      const r = (radius * (v/100)) * progress;
      const x = cx + Math.cos(angle)*r;
      const y = cy + Math.sin(angle)*r;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI*2);
      ctx.fillStyle = colors[labels[i]] || "#FFB020";
      ctx.fill();
    });
  }

  function animate(){
    frame++;
    const progress = Math.min(frame/totalFrames, 1);
    drawFrame(progress);
    if (progress < 1) requestAnimationFrame(animate);
  }
  animate();

  const legend = $("#radarLegend");
  if(legend) legend.innerHTML = labels.map(l =>
    `<span><span class="legend-dot" style="background:${colors[l]}"></span>${l}: ${radar[l]}</span>`
  ).join("");
}

function closeAllModals(){
  $$(".modal-overlay").forEach(m => m.classList.remove("open"));
}

/* -------------------------------------------------------------------------
   Report Builder & Aggregation
   ------------------------------------------------------------------------- */
async function buildReport(){
  if (!state.results || !state.results.length) return;
  try {
    const res = await fetch(`${API}/api/report`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        interview_id: state.interviewId,
        user_id: state.userId,
        company_id: state.activeCompany?.id || "google",
        company_name: state.activeCompany?.name || "Target Company",
        role: state.selectedRole || "Software Engineer",
        level: state.selectedLevel || "mid",
        format: state.selectedFormat || "onsite",
        persona: state.selectedPersona || "friendly",
        language: state.selectedLang || "english",
        results: state.results
      })
    });
    if (!res.ok) throw new Error("Report generation failed");
    const report = await res.json();

    if (report.interview_id) {
      state.interviewId = report.interview_id;
      const sessEl = $("#reportSessionIdText");
      if (sessEl) sessEl.textContent = report.interview_id;
    }

    saveSession(report);
    renderReport(report);
    checkAchievements();
  } catch(e) {
    console.error("Failed to build report:", e);
    toast("Failed to generate report.");
  }
}

/* -------------------------------------------------------------------------
   Event Listeners Setup
   ------------------------------------------------------------------------- */
function initEventListeners(){
  // Navigation
  $$(".nav-step").forEach(step => {
    step.addEventListener("click", () => goToScreen(Number(step.dataset.step)));
  });
  const brand = $(".nav-brand");
  if (brand) brand.addEventListener("click", () => goToScreen(0));

  const navPill = $("#navCountdownPill");
  if (navPill) navPill.addEventListener("click", () => $("#countdownModal")?.classList.add("open"));

  // Hero Actions
  $("#startBtn")?.addEventListener("click", () => goToScreen(1));
  $("#openLinkedInBtn")?.addEventListener("click", () => $("#linkedinModal")?.classList.add("open"));
  $("#howItWorksBtn")?.addEventListener("click", () => {
    goToScreen(1);
    toast("Pick a company panel to customize rounds, personas, and start rehearsal.");
  });
  $("#setCountdownBtn")?.addEventListener("click", () => $("#countdownModal")?.classList.add("open"));
  $("#heroCalSyncBtn")?.addEventListener("click", () => {
    const info = state.upcomingInterview;
    if (info && info.date) {
      downloadIcsFile(`Mock Rehearsal: ${info.companyName}`, `Target rehearsal for ${info.role}`, info.date);
      toast("📅 .ics calendar event downloaded!");
    } else {
      $("#countdownModal")?.classList.add("open");
    }
  });

  // Casting / Company Selection Screen
  $("#companySearchInput")?.addEventListener("input", (e) => {
    state.searchQuery = e.target.value;
    renderCompanyGrid();
  });
  $("#spacedRepBtn")?.addEventListener("click", () => startSpacedRepRehearsal());
  $("#customBankBtn")?.addEventListener("click", () => $("#customBankModal")?.classList.add("open"));

  // Setup Modal Controls
  $$(".modal-tabs .tab-btn").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });
  $("#qCountSlider")?.addEventListener("input", (e) => {
    state.qCount = Number(e.target.value);
    const lbl = $("#qCountLabel");
    if (lbl) lbl.textContent = e.target.value;
  });
  $("#beginInterviewBtn")?.addEventListener("click", () => beginInterview());
  $("#exportAnkiBtn")?.addEventListener("click", () => exportAnkiDeck(state.activeCompany));

  // Rehearsal Room Controls
  $("#speakQuestionBtn")?.addEventListener("click", () => {
    const q = state.questions[state.currentIndex];
    if (q && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(q.q);
      utt.rate = 0.95;
      window.speechSynthesis.speak(utt);
    }
  });
  $("#skipQuestionBtn")?.addEventListener("click", () => {
    state.currentIndex++;
    if (state.currentIndex < state.questions.length) {
      if (state.breathingEnabled) showBreathingBreak();
      else loadQuestion();
    } else {
      finishInterview();
    }
  });
  $("#micToggle")?.addEventListener("click", () => {
    if (state.isRecording) stopRecording();
    else startRecording();
  });
  $("#answerInput")?.addEventListener("input", () => updateLiveMeta());
  $("#submitAnswerBtn")?.addEventListener("click", () => submitAnswer());
  $("#notesToggleBtn")?.addEventListener("click", () => {
    state.notesView = !state.notesView;
    const last = state.results[state.results.length - 1];
    if (last) renderFeedback(last);
  });
  $("#nextQuestionBtn")?.addEventListener("click", () => {
    state.currentIndex++;
    if (state.currentIndex < state.questions.length) {
      if (state.breathingEnabled) showBreathingBreak();
      else loadQuestion();
    } else {
      finishInterview();
    }
  });

  // Report Actions
  $("#restartBtn")?.addEventListener("click", () => {
    if (state.activeCompany) {
      beginInterview();
    } else {
      goToScreen(1);
    }
  });
  $("#anotherCompanyBtn")?.addEventListener("click", () => goToScreen(1));
  $("#shareReportBtn")?.addEventListener("click", () => {
    if (state.results && state.results.length) {
      const rep = {
        overall_average: Number($("#reportOverallScore")?.textContent || "70"),
        hire_verdict: $("#reportVerdictLabel")?.textContent || "Hire",
        radar: {
          Relevance: Number((state.results.reduce((s, r) => s + (r.breakdown?.relevance || 0), 0) / state.results.length).toFixed(1)),
          Structure: Number((state.results.reduce((s, r) => s + (r.breakdown?.structure?.score || 0), 0) / state.results.length).toFixed(1)),
          Fluency: Number((state.results.reduce((s, r) => s + (r.breakdown?.fluency?.score || 0), 0) / state.results.length).toFixed(1)),
          Confidence: Number((state.results.reduce((s, r) => s + (r.breakdown?.confidence?.score || 0), 0) / state.results.length).toFixed(1))
        },
        strongest_area: $("#strongestArea")?.textContent || "Relevance",
        weakest_area: $("#weakestArea")?.textContent || "Structure",
        questions_answered: state.results.length,
        benchmark: { comparison_text: $("#benchmarkSummaryText")?.textContent || "" },
        per_question: state.results
      };
      generateShareableReport(rep);
    } else {
      toast("No completed questions to share.");
    }
  });
  $("#peerReviewBtn")?.addEventListener("click", () => openPeerMockModal());
  $("#savePeerNotesBtn")?.addEventListener("click", () => savePeerMockNotes());
  $("#reportNotesToggleBtn")?.addEventListener("click", () => {
    state.reportNotesView = !state.reportNotesView;
    renderReportQaList(state.results);
  });
  $("#reportAnkiBtn")?.addEventListener("click", () => exportAnkiDeck(state.activeCompany));
  $("#calendarSyncBtn")?.addEventListener("click", () => $("#countdownModal")?.classList.add("open"));

  // Modals close triggers
  $$(".modal-close").forEach(btn => btn.addEventListener("click", closeAllModals));
  $$(".modal-overlay").forEach(overlay => {
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeAllModals();
    });
  });

  // Camera Block Modal & Webcam Controls
  $("#retryCameraBtn")?.addEventListener("click", async () => {
    const granted = await requestCameraAccess("retry");
    if (granted) {
      closeCameraBlockModal();
      beginInterview();
    } else {
      toast("Camera access still not granted. Check browser permissions.");
    }
  });
  $("#closeCameraBlockModal")?.addEventListener("click", () => closeCameraBlockModal());
  $("#cancelCameraBlockBtn")?.addEventListener("click", () => closeCameraBlockModal());

  $("#flipCamBtn")?.addEventListener("click", () => {
    state.cameraFlipped = !state.cameraFlipped;
    $("#candidateWebcam")?.classList.toggle("flipped", state.cameraFlipped);
  });

  // LinkedIn Modal
  $("#parseLinkedInBtn")?.addEventListener("click", () => {
    const val = $("#linkedinInput")?.value;
    parseLinkedInProfile(val, true);
  });

  // Custom Question Bank Modal
  $("#saveCustomBankBtn")?.addEventListener("click", () => {
    saveCustomBank(
      $("#customCompanyName")?.value,
      $("#customRoleName")?.value,
      $("#customQuestionsInput")?.value
    );
  });

  // Countdown Modal
  $("#saveCountdownBtn")?.addEventListener("click", () => {
    const compSelect = $("#countdownCompanySelect");
    const dateInput = $("#countdownDateInput");
    const roleInput = $("#countdownRoleInput");
    if (!dateInput?.value) {
      toast("Please select a target interview date.");
      return;
    }
    const comp = state.companies.find(c => c.id === compSelect?.value) || state.companies[0];
    saveCountdown({
      companyId: comp?.id || "google",
      companyName: comp?.name || "Target Company",
      date: dateInput.value,
      role: roleInput?.value?.trim() || "Software Engineer"
    });
    closeAllModals();
    toast("⏱️ Interview countdown set!");
  });

  // Share Modal Copy Buttons
  $("#copyShareUrlBtn")?.addEventListener("click", () => {
    const inp = $("#shareUrlInput");
    if (inp) {
      inp.select();
      navigator.clipboard?.writeText(inp.value);
      toast("🔗 Shareable link copied to clipboard!");
    }
  });
  $("#copyMentorSummaryBtn")?.addEventListener("click", () => {
    const txt = $("#mentorSummaryText");
    if (txt) {
      txt.select();
      navigator.clipboard?.writeText(txt.value);
      toast("📋 Mentor Markdown copied to clipboard!");
    }
  });

  // Cloud Database Modal & Performance Vault Listeners
  $("#navDbRecordsBtn")?.addEventListener("click", () => openDbRecordsModal());
  $("#reportViewDbBtn")?.addEventListener("click", () => openDbRecordsModal());
  $("#closeDbRecordsModal")?.addEventListener("click", () => closeAllModals());
  $("#refreshDbBtn")?.addEventListener("click", () => refreshDbHistory());
  $("#dbSaveProfileBtn")?.addEventListener("click", () => saveCandidateProfile());
  $("#closeDetailBtn")?.addEventListener("click", () => {
    const d = $("#dbSessionDetail");
    if (d) d.style.display = "none";
  });

  // Benchmark Model Answer Accordion
  $("#comparisonHeadToggle")?.addEventListener("click", () => {
    const b = $("#comparisonBody");
    if (b) b.style.display = b.style.display === "none" ? "flex" : "none";
  });

  // Candidate Authentication & Profile Listeners
  $("#navAuthBtn")?.addEventListener("click", () => openAuthModal("signin"));
  $("#navUserChip")?.addEventListener("click", (e) => {
    // If clicked logout button, don't open db modal
    if (e.target.closest("#navLogoutBtn")) return;
    openDbRecordsModal();
  });
  $("#navLogoutBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    handleLogout();
  });
  $("#tabSignInBtn")?.addEventListener("click", () => switchAuthTab("signin"));
  $("#tabRegisterBtn")?.addEventListener("click", () => switchAuthTab("register"));
  $("#switchToRegLink")?.addEventListener("click", () => switchAuthTab("register"));
  $("#switchToLoginLink")?.addEventListener("click", () => switchAuthTab("signin"));
  $("#closeAuthModal")?.addEventListener("click", () => closeAllModals());

  // Password toggles
  $("#toggleLoginPwd")?.addEventListener("click", () => {
    const inp = $("#loginPassword");
    if (inp) inp.type = inp.type === "password" ? "text" : "password";
  });
  $("#toggleRegPwd")?.addEventListener("click", () => {
    const inp = $("#regPassword");
    if (inp) inp.type = inp.type === "password" ? "text" : "password";
  });

  // Form Submissions
  $("#loginForm")?.addEventListener("submit", handleManualLogin);
  $("#submitLoginBtn")?.addEventListener("click", handleManualLogin);
  $("#registerForm")?.addEventListener("submit", handleManualRegister);
  $("#submitRegisterBtn")?.addEventListener("click", handleManualRegister);

  // Social Sign-Ins (Google, LinkedIn, GitHub)
  $("#googleLoginBtn")?.addEventListener("click", () => handleSocialAuth("google"));
  $("#googleRegBtn")?.addEventListener("click", () => handleSocialAuth("google"));
  $("#linkedinLoginBtn")?.addEventListener("click", () => handleSocialAuth("linkedin"));
  $("#linkedinRegBtn")?.addEventListener("click", () => handleSocialAuth("linkedin"));
  $("#githubLoginBtn")?.addEventListener("click", () => handleSocialAuth("github"));
  $("#githubRegBtn")?.addEventListener("click", () => handleSocialAuth("github"));
}

/* -------------------------------------------------------------------------
   Cloud Database & Performance Vault Functions
   ------------------------------------------------------------------------- */
async function openDbRecordsModal(){
  const modal = $("#dbRecordsModal");
  if (!modal) return;
  modal.classList.add("open");

  // Load candidate profile
  try {
    const userRes = await fetch(`${API}/api/db/user?user_id=${encodeURIComponent(state.userId)}`);
    if (userRes.ok) {
      const userData = await userRes.json();
      if (userData.profile) {
        if ($("#dbCandidateName")) $("#dbCandidateName").value = userData.profile.name || state.candidateName;
        if ($("#dbCandidateRole")) $("#dbCandidateRole").value = userData.profile.target_role || state.candidateRole;
      }
      if (userData.stats) {
        if ($("#dbTotalInterviews")) $("#dbTotalInterviews").textContent = userData.stats.total_interviews || 0;
        if ($("#dbAvgScore")) $("#dbAvgScore").textContent = (userData.stats.average_score || 0) + "%";
        if ($("#dbQuestionsAnswered")) $("#dbQuestionsAnswered").textContent = userData.stats.total_questions_answered || 0;
      }
    }
  } catch(e) {
    console.warn("Could not load candidate profile:", e);
  }

  // Load interview history from database
  await refreshDbHistory();
}

async function refreshDbHistory(){
  const listEl = $("#dbHistoryList");
  if (!listEl) return;
  listEl.innerHTML = "<p style='color:var(--muted); font-size:.8rem;'>Loading saved sessions from Firestore database…</p>";

  try {
    const res = await fetch(`${API}/api/db/history?user_id=${encodeURIComponent(state.userId)}`);
    if (!res.ok) throw new Error("History fetch error");
    const data = await res.json();
    const sessions = data.interviews || data.history || [];

    if ($("#dbSessionCountText")) {
      $("#dbSessionCountText").textContent = `${sessions.length} session${sessions.length === 1 ? '' : 's'}`;
    }

    if (!sessions.length) {
      listEl.innerHTML = `
        <div style="background:var(--surface); border:1px dashed var(--border); border-radius:var(--radius-sm); padding:24px; text-align:center;">
          <p style="color:var(--text); font-weight:600; font-size:.9rem; margin-bottom:6px;">No rehearsal records in database yet</p>
          <p style="color:var(--muted); font-size:.8rem;">Complete a mock interview round to store your transcript, scores, and benchmark comparisons in Cloud Firestore.</p>
        </div>
      `;
      return;
    }

    let totalScore = 0;
    let totalQuestions = 0;
    let totalCov = 0;
    let covCount = 0;

    listEl.innerHTML = sessions.map(s => {
      const score = s.overall_average || s.overall_score || 0;
      totalScore += score;
      const qCount = s.questions_answered || (s.results ? s.results.length : 0);
      totalQuestions += qCount;

      if (s.results) {
        s.results.forEach(r => {
          if (r.comparison && r.comparison.coverage_percentage !== undefined) {
            totalCov += r.comparison.coverage_percentage;
            covCount++;
          }
        });
      }

      const badgeClass = score >= 70 ? "" : score >= 50 ? "subpar" : "failed";
      const dt = s.created_at ? new Date(s.created_at).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Recent";

      return `
        <div class="history-item-card" data-session-id="${escapeHtml(s.id)}">
          <div class="history-item-top">
            <div>
              <span class="history-company-name">${escapeHtml(s.company_name || s.company_id || "Mock Interview")}</span>
              <span style="font-size:.72rem; color:var(--muted); margin-left:8px; font-family:var(--font-mono);">${escapeHtml(dt)}</span>
            </div>
            <span class="history-score-badge ${badgeClass}">${score}% • ${escapeHtml(s.hire_verdict || "Evaluated")}</span>
          </div>
          <div class="history-meta-row">
            <span>Role: <strong style="color:var(--text);">${escapeHtml(s.role || "Software Engineer")}</strong></span>
            <span>Level: <strong style="color:var(--text); text-transform:capitalize;">${escapeHtml(s.level || "mid")}</strong></span>
            <span>Questions: <strong style="color:var(--text);">${qCount}</strong></span>
            <span>Session ID: <code style="font-size:.7rem; color:var(--signal);">${escapeHtml(s.id)}</code></span>
          </div>
          ${s.radar ? `
            <div class="history-radar-pills">
              <span class="radar-mini-pill">Relevance: ${s.radar.Relevance || 0}</span>
              <span class="radar-mini-pill">Structure: ${s.radar.Structure || 0}</span>
              <span class="radar-mini-pill">Fluency: ${s.radar.Fluency || 0}</span>
              <span class="radar-mini-pill">Confidence: ${s.radar.Confidence || 0}</span>
            </div>
          ` : ''}
          <div style="margin-top:8px; text-align:right;">
            <span style="font-size:.72rem; color:var(--signal); font-weight:600;">Click to view questions, responses & model benchmarks →</span>
          </div>
        </div>
      `;
    }).join("");

    if ($("#dbTotalInterviews")) $("#dbTotalInterviews").textContent = sessions.length;
    if ($("#dbAvgScore")) $("#dbAvgScore").textContent = Math.round(totalScore / sessions.length) + "%";
    if ($("#dbQuestionsAnswered")) $("#dbQuestionsAnswered").textContent = totalQuestions;
    if ($("#dbBenchmarkCoverage") && covCount > 0) {
      $("#dbBenchmarkCoverage").textContent = Math.round(totalCov / covCount) + "%";
    }

    // Attach click handlers to cards
    $$(".history-item-card").forEach(card => {
      card.addEventListener("click", () => {
        const id = card.dataset.sessionId;
        if (id) viewSessionDetail(id);
      });
    });

  } catch(e) {
    console.error("Failed to fetch db history:", e);
    listEl.innerHTML = "<p style='color:var(--danger); font-size:.8rem;'>Failed to connect to database history service.</p>";
  }
}

async function viewSessionDetail(sessionId){
  const detailEl = $("#dbSessionDetail");
  const qaListEl = $("#detailQaList");
  const titleEl = $("#detailSessionTitle");
  if (!detailEl || !qaListEl) return;

  detailEl.style.display = "block";
  qaListEl.innerHTML = "<p style='color:var(--muted); font-size:.8rem;'>Retrieving responses and question benchmarks from Firestore…</p>";
  if (titleEl) titleEl.textContent = `Session: ${sessionId}`;

  try {
    const res = await fetch(`${API}/api/db/interview/${encodeURIComponent(sessionId)}`);
    if (!res.ok) throw new Error("Could not fetch session detail");
    const data = await res.json();
    const session = data.session || data.interview;
    const questions = data.responses || session?.results || [];

    if (!questions.length) {
      qaListEl.innerHTML = "<p style='color:var(--muted); font-size:.8rem;'>No detailed question responses found in this record.</p>";
      return;
    }

    qaListEl.innerHTML = questions.map((q, idx) => {
      const expAnswer = q.expected_answer || q.comparison?.expected_answer || "";
      const covPts = q.covered_points || q.comparison?.covered_points || [];
      const missPts = q.missed_points || q.comparison?.missed_points || [];
      const covPct = q.coverage_percentage !== undefined ? q.coverage_percentage : (q.comparison?.coverage_percentage || (covPts.length && (covPts.length + missPts.length) ? Math.round((covPts.length / (covPts.length + missPts.length)) * 100) : 0));
      const scoreColor = (q.overall_score || 0) >= 70 ? "var(--success)" : (q.overall_score || 0) >= 50 ? "var(--spotlight)" : "var(--danger)";
      return `
        <div class="session-qa-item">
          <div class="qa-item-header">
            <span style="font-weight:600; font-size:.8rem; color:var(--text);">Q${idx+1}. ${escapeHtml(q.question_text || "Question")}</span>
            <span style="font-family:var(--font-mono); font-weight:700; color:${scoreColor}; font-size:.8rem;">${q.overall_score || 0}/100</span>
          </div>
          <div class="qa-answer-block">
            <div style="font-size:.68rem; color:var(--muted); margin-bottom:2px; font-weight:600;">CANDIDATE RECORDED ANSWER:</div>
            <div>${escapeHtml(q.candidate_answer || "(No transcript captured)")}</div>
          </div>
          ${expAnswer ? `
            <div class="qa-benchmark-block">
              <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
                <span style="font-size:.7rem; color:var(--signal); font-weight:600;">DATABASE EXPECTED BENCHMARK ANSWER:</span>
                <span style="font-size:.68rem; font-family:var(--font-mono); color:var(--signal);">${covPct}% Coverage</span>
              </div>
              <p style="margin:0 0 6px 0; font-size:.75rem; color:#e2e8f0;">${escapeHtml(expAnswer)}</p>
              ${covPts.length ? `
                <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;">
                  <span style="font-size:.65rem; color:var(--muted);">Covered:</span>
                  ${covPts.map(p => `<span class="concept-tag covered" style="font-size:.65rem; padding:1px 5px;">✓ ${escapeHtml(p)}</span>`).join("")}
                </div>
              ` : ''}
              ${missPts.length ? `
                <div style="display:flex; gap:4px; flex-wrap:wrap; margin-top:4px;">
                  <span style="font-size:.65rem; color:var(--muted);">Gaps:</span>
                  ${missPts.map(p => `<span class="concept-tag missed" style="font-size:.65rem; padding:1px 5px;">⚠ ${escapeHtml(p)}</span>`).join("")}
                </div>
              ` : ''}
            </div>
          ` : ''}
        </div>
      `;
    }).join("");

    detailEl.scrollIntoView({ behavior: "smooth" });
  } catch(e) {
    console.error("Error viewing session detail:", e);
    qaListEl.innerHTML = "<p style='color:var(--danger); font-size:.8rem;'>Could not load question benchmark details.</p>";
  }
}

async function saveCandidateProfile(){
  const name = $("#dbCandidateName")?.value.trim() || "Candidate";
  const role = $("#dbCandidateRole")?.value.trim() || "Software Engineer";

  state.candidateName = name;
  state.candidateRole = role;
  localStorage.setItem("gr_user_name", name);
  localStorage.setItem("gr_user_role", role);

  try {
    const res = await fetch(`${API}/api/db/user`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id: state.userId,
        name,
        target_role: role
      })
    });
    if (res.ok) {
      toast("Profile updated in Cloud Firestore!");
    } else {
      toast("Profile saved locally.");
    }
  } catch(e) {
    toast("Profile saved locally.");
  }
}

/* -------------------------------------------------------------------------
   Candidate Authentication & Registration (Manual + Google + LinkedIn + GitHub)
   ------------------------------------------------------------------------- */
function getAuthUser() {
  const userJson = localStorage.getItem("gr_auth_user");
  if (userJson) {
    try {
      return JSON.parse(userJson);
    } catch(e) {
      return null;
    }
  }
  return null;
}

function updateAuthNavUI() {
  const user = getAuthUser();
  const navAuthBtn = $("#navAuthBtn");
  const navUserChip = $("#navUserChip");
  const navUserAvatar = $("#navUserAvatar");
  const navUserName = $("#navUserName");
  const navUserRole = $("#navUserRole");

  if (user && user.display_name) {
    if (navAuthBtn) navAuthBtn.style.display = "none";
    if (navUserChip) {
      navUserChip.style.display = "inline-flex";
      if (navUserAvatar) navUserAvatar.textContent = (user.display_name.charAt(0) || "C").toUpperCase();
      if (navUserName) navUserName.textContent = user.display_name.split(" ")[0];
      if (navUserRole) navUserRole.textContent = user.target_role || "Candidate";
    }

    state.userId = user.id;
    state.candidateName = user.display_name;
    state.candidateRole = user.target_role || state.candidateRole;
    if (user.target_level) state.selectedLevel = user.target_level;
    if (user.preferred_language) state.selectedLang = user.preferred_language;

    const dbName = $("#dbCandidateName");
    const dbRole = $("#dbCandidateRole");
    if (dbName) dbName.value = user.display_name;
    if (dbRole) dbRole.value = user.target_role || "Software Engineer";
  } else {
    if (navAuthBtn) navAuthBtn.style.display = "inline-flex";
    if (navUserChip) navUserChip.style.display = "none";
  }
}

function openAuthModal(mode = "signin") {
  const modal = $("#authModal");
  if (!modal) return;
  modal.classList.add("open");
  switchAuthTab(mode);
}

function switchAuthTab(tab) {
  const tabSignIn = $("#tabSignInBtn");
  const tabRegister = $("#tabRegisterBtn");
  const loginPane = $("#authLoginPane");
  const regPane = $("#authRegisterPane");
  const title = $("#authModalTitle");

  if (tab === "signin") {
    tabSignIn?.classList.add("active");
    tabRegister?.classList.remove("active");
    if (loginPane) loginPane.style.display = "block";
    if (regPane) regPane.style.display = "none";
    if (title) title.textContent = "Candidate Sign In";
  } else {
    tabRegister?.classList.add("active");
    tabSignIn?.classList.remove("active");
    if (loginPane) loginPane.style.display = "none";
    if (regPane) regPane.style.display = "block";
    if (title) title.textContent = "Create Candidate Profile";
  }
}

async function handleManualLogin(e) {
  if (e) e.preventDefault();
  const emailInput = $("#loginEmail");
  const pwdInput = $("#loginPassword");
  const errBanner = $("#loginErrorBanner");
  const errText = $("#loginErrorText");
  const btn = $("#submitLoginBtn");

  const email = emailInput?.value.trim();
  const password = pwdInput?.value;

  if (!email || !password) {
    if (errBanner && errText) {
      errText.textContent = "Please enter both your email address and password.";
      errBanner.style.display = "flex";
    }
    return;
  }

  if (btn) btn.disabled = true;
  if (errBanner) errBanner.style.display = "none";

  try {
    const res = await fetch(`${API}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Login failed. Please check your credentials.");
    }

    const user = data.user;
    localStorage.setItem("gr_auth_token", "sess_" + Date.now());
    localStorage.setItem("gr_auth_user", JSON.stringify(user));
    localStorage.setItem("gr_user_id", user.id);
    localStorage.setItem("gr_user_name", user.display_name);
    localStorage.setItem("gr_user_role", user.target_role || "Software Engineer");

    updateAuthNavUI();
    closeAllModals();
    toast(`Welcome back, ${user.display_name}! Ready to rehearse.`);
    refreshDbHistory();
  } catch(err) {
    if (errBanner && errText) {
      errText.textContent = err.message;
      errBanner.style.display = "flex";
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleManualRegister(e) {
  if (e) e.preventDefault();
  const name = $("#regName")?.value.trim();
  const email = $("#regEmail")?.value.trim();
  const password = $("#regPassword")?.value;
  const role = $("#regRole")?.value;
  const company = $("#regCompany")?.value;
  const level = $("#regLevel")?.value;
  const language = $("#regLanguage")?.value || "english";

  const errBanner = $("#registerErrorBanner");
  const errText = $("#registerErrorText");
  const btn = $("#submitRegisterBtn");

  function showRegError(msg) {
    if (errBanner && errText) {
      errText.textContent = msg;
      errBanner.style.display = "flex";
    }
  }

  if (!name) {
    showRegError("Full Name is mandatory.");
    return;
  }
  if (!email) {
    showRegError("Email Address is mandatory.");
    return;
  }
  if (!password || password.length < 6) {
    showRegError("Password is mandatory and must contain at least 6 characters.");
    return;
  }
  if (!role) {
    showRegError("Target Role is mandatory.");
    return;
  }
  if (!company) {
    showRegError("Target Company is mandatory.");
    return;
  }
  if (!level) {
    showRegError("Experience Level is mandatory.");
    return;
  }

  if (btn) btn.disabled = true;
  if (errBanner) errBanner.style.display = "none";

  try {
    const res = await fetch(`${API}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        email,
        password,
        target_role: role,
        target_company: company,
        experience_level: level,
        language
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || "Registration could not be completed.");
    }

    const user = data.user;
    localStorage.setItem("gr_auth_token", "sess_" + Date.now());
    localStorage.setItem("gr_auth_user", JSON.stringify(user));
    localStorage.setItem("gr_user_id", user.id);
    localStorage.setItem("gr_user_name", user.display_name);
    localStorage.setItem("gr_user_role", user.target_role || role);

    updateAuthNavUI();
    closeAllModals();
    toast(`Candidate profile created! Welcome, ${user.display_name}.`);

    if (state.companies && state.companies.length) {
      const match = state.companies.find(c => c.name.toLowerCase() === company.toLowerCase() || c.id.toLowerCase() === company.toLowerCase());
      if (match) {
        state.activeCompany = match;
      }
    }

    refreshDbHistory();
  } catch(err) {
    showRegError(err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function handleSocialAuth(provider) {
  let candidateName = "";
  let candidateEmail = "";
  let avatar = "";

  if (provider === "google") {
    const emailPrompt = prompt("Google Sign-In: Enter your Google account email", "sangeeta@gmail.com");
    if (!emailPrompt) return;
    candidateEmail = emailPrompt.trim();
    const handle = candidateEmail.split("@")[0].replace(/[._]/g, " ");
    candidateName = handle.charAt(0).toUpperCase() + handle.slice(1);
    avatar = "https://lh3.googleusercontent.com/a/default-user=s96-c";
  } else if (provider === "linkedin") {
    const handle = prompt("LinkedIn Sign-In: Enter your LinkedIn profile name or email", "Sangeeta Ojha");
    if (!handle) return;
    candidateName = handle.trim();
    candidateEmail = `${candidateName.toLowerCase().replace(/\s+/g, ".")}@linkedin.user`;
  } else if (provider === "github") {
    const username = prompt("GitHub Sign-In: Enter your GitHub username", "sangeeta-ojha");
    if (!username) return;
    candidateName = username.trim();
    candidateEmail = `${username.toLowerCase()}@users.noreply.github.com`;
  }

  try {
    toast(`Connecting with ${provider.toUpperCase()}...`);
    const res = await fetch(`${API}/api/auth/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        name: candidateName,
        email: candidateEmail,
        avatar,
        provider_id: `${provider}_${Date.now()}`
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `${provider} authentication failed.`);
    }

    const user = data.user;
    localStorage.setItem("gr_auth_token", "sess_" + Date.now());
    localStorage.setItem("gr_auth_user", JSON.stringify(user));
    localStorage.setItem("gr_user_id", user.id);
    localStorage.setItem("gr_user_name", user.display_name);
    localStorage.setItem("gr_user_role", user.target_role || "Software Engineer");

    updateAuthNavUI();
    closeAllModals();
    toast(`Signed in with ${provider.toUpperCase()} as ${user.display_name}!`);
    refreshDbHistory();
  } catch(err) {
    alert(err.message);
  }
}

function handleLogout() {
  if (confirm("Sign out of your GreenRoom candidate account?")) {
    localStorage.removeItem("gr_auth_token");
    localStorage.removeItem("gr_auth_user");
    updateAuthNavUI();
    toast("Signed out successfully.");
  }
}

/* -------------------------------------------------------------------------
   Init
   ------------------------------------------------------------------------- */
window.addEventListener("DOMContentLoaded", () => {
  buildWaveform();
  pulseRings();
  countUpStats();
  heroLoadAnimation();
  loadCompanies();
  loadAchievements();
  loadWeakSpots();
  loadCountdown();
  checkHashForSharedReport();
  updateAuthNavUI();
  initEventListeners();
});
