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
  selectedLevel: "junior",
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
  recommendedCompanies: JSON.parse(localStorage.getItem("gr_recommended_companies") || "[]"),
  companyFilter: "all",
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
   LinkedIn / Profile Text & Bio Parser
   ------------------------------------------------------------------------- */
let currentParsedProfile = null;

function renderDetectedSkillsChips(skills) {
  const container = $("#detectedChips");
  if (!container) return;
  const badge = $("#skillCountBadge");
  if (!skills || !skills.length) {
    container.innerHTML = `<span style="font-size:.75rem; color:var(--muted); font-style:italic;">No skills detected yet. Type in the box below to add skills.</span>`;
    if (badge) badge.textContent = "0 skills";
    return;
  }
  if (badge) badge.textContent = `${skills.length} skills`;
  container.innerHTML = skills.map((sk, idx) => `
    <span class="detected-chip" data-index="${idx}">
      <span>⚡ ${escapeHtml(sk)}</span>
      <button type="button" class="remove-chip-btn" data-skill="${escapeHtml(sk)}" title="Remove skill">✕</button>
    </span>
  `).join("");

  container.querySelectorAll(".remove-chip-btn").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const skToRemove = btn.dataset.skill;
      if (currentParsedProfile && currentParsedProfile.skills) {
        currentParsedProfile.skills = currentParsedProfile.skills.filter(s => s !== skToRemove);
        renderDetectedSkillsChips(currentParsedProfile.skills);
        refreshProfileRecommendations();
      }
    };
  });
}

function renderMatchedCompaniesChips(companies) {
  const container = $("#previewMatchedCompanies");
  const countBadge = $("#recCountBadge");
  if (!container) return;

  if (!companies || !companies.length) {
    container.innerHTML = `<div style="grid-column:1/-1; padding:16px; text-align:center; color:var(--muted); font-size:.78rem;">Matches standard tech company question pools. Add skills or role to see specialized recommendations.</div>`;
    if (countBadge) countBadge.textContent = "0 Matches";
    return;
  }

  if (countBadge) countBadge.textContent = `${companies.length} Matches`;

  container.innerHTML = companies.map(c => {
    const accent = c.accent || "var(--spotlight)";
    const matchPct = c.match_percent || 90;
    const fitLabel = c.experience_fit || `${c.difficulty || 'Tier 1'} Bar Alignment`;
    const skillsList = Array.isArray(c.matching_skills) ? c.matching_skills : [];

    return `
      <div class="recommended-company-card" style="border-top: 3px solid ${accent};">
        <div class="rec-card-header">
          <div class="rec-card-company">
            <div class="rec-card-logo" style="background:${accent};">${escapeHtml(c.name[0])}</div>
            <div>
              <div class="rec-card-name">${escapeHtml(c.name)}</div>
              <span class="rec-card-fit">${escapeHtml(fitLabel)}</span>
            </div>
          </div>
          <span class="rec-match-badge">🎯 ${matchPct}% Match</span>
        </div>

        <div class="rec-card-reason">${escapeHtml(c.reason || 'Strong technical and seniority bar match.')}</div>

        ${skillsList.length > 0 ? `
          <div class="rec-card-skills">
            ${skillsList.map(s => `<span class="rec-skill-tag">✓ ${escapeHtml(s)}</span>`).join("")}
          </div>
        ` : ''}

        <div class="rec-card-actions">
          <button type="button" class="btn btn-primary btn-xs rec-rehearse-btn" data-company-id="${c.id}" data-role="${escapeHtml(c.recommended_role || '')}">
            <span>🎯 Rehearse with ${escapeHtml(c.name)}</span>
          </button>
        </div>
      </div>
    `;
  }).join("");

  // Attach one-click rehearse action to each card
  container.querySelectorAll(".rec-rehearse-btn").forEach(btn => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const compId = btn.dataset.companyId;
      const recRole = btn.dataset.role;
      applyImportedProfile();
      const targetCompany = state.companies.find(c => c.id === compId) || state.customBanks.find(c => c.id === compId);
      if (targetCompany) {
        if (recRole) state.selectedRole = recRole;
        openSetupModal(targetCompany);
      }
    };
  });
}

let _recDebounceTimer = null;
async function refreshProfileRecommendations() {
  if (!currentParsedProfile) return;
  clearTimeout(_recDebounceTimer);
  _recDebounceTimer = setTimeout(async () => {
    const role = $("#previewRoleSelect")?.value || currentParsedProfile.target_role || "Software Engineer";
    const activeLvlBtn = $("#previewLevelGroup .chip-mini.active");
    const level = activeLvlBtn?.dataset.lvl || currentParsedProfile.experience_level || "mid";
    const skills = currentParsedProfile.skills || [];
    const years = currentParsedProfile.years_of_experience || null;

    try {
      const res = await fetch(`${API}/api/recommend-companies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, skills, level, years })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.ok && Array.isArray(data.recommendations) && data.recommendations.length > 0) {
          currentParsedProfile.recommended_companies = data.recommendations.slice(0, 5);
          renderMatchedCompaniesChips(currentParsedProfile.recommended_companies);
          return;
        }
      }
    } catch (err) {
      console.warn("Dynamic recommendation refresh warning:", err);
    }

    if (currentParsedProfile.recommended_companies) {
      renderMatchedCompaniesChips(currentParsedProfile.recommended_companies);
    }
  }, 250);
}

function parseBioClientFallback(rawText) {
  const text = (rawText || "").trim();
  const lower = text.toLowerCase();
  let name = "Candidate";

  const urlMatch = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
  if (urlMatch && urlMatch[1]) {
    const slug = urlMatch[1].replace(/[-_]/g, " ").trim();
    name = slug.split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  } else {
    const nameMatch = text.match(/(?:name|candidate|profile)\s*[:\-]\s*([A-Za-z\s.'-]{2,40})/i);
    if (nameMatch && nameMatch[1].trim()) {
      name = nameMatch[1].trim();
    } else {
      const firstLine = text.split("\n")[0].trim();
      if (/^[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3}$/.test(firstLine) && firstLine.length < 35 && !/developer|engineer|resume/i.test(firstLine)) {
        name = firstLine;
      }
    }
  }

  let level = "mid";
  if (lower.includes("senior") || lower.includes("sr.") || lower.includes("lead") || lower.includes("staff")) level = "senior";
  else if (lower.includes("junior") || lower.includes("entry") || lower.includes("intern")) level = "junior";

  const roles = [];
  if (lower.includes("frontend") || lower.includes("react")) roles.push("Frontend Engineer");
  if (lower.includes("backend") || lower.includes("node") || lower.includes("java")) roles.push("Backend Engineer");
  if (lower.includes("devops") || lower.includes("sre") || lower.includes("cloud")) roles.push("DevOps Engineer");
  if (lower.includes("data scientist") || lower.includes("machine learning")) roles.push("Data Scientist");
  if (lower.includes("data analyst") || lower.includes("tableau")) roles.push("Data Analyst");
  if (lower.includes("product manager") || lower.includes("pm")) roles.push("Product Manager");
  if (lower.includes("qa") || lower.includes("test")) roles.push("QA Engineer");
  if (!roles.length || lower.includes("software") || lower.includes("engineer")) roles.unshift("Software Engineer");

  const skillDict = [
    "Python", "JavaScript", "TypeScript", "React", "Next.js", "Node.js", "Express", "Java", "Spring Boot",
    "SQL", "PostgreSQL", "MongoDB", "Redis", "Kafka", "AWS", "GCP", "Azure", "Docker", "Kubernetes",
    "System Design", "Distributed Systems", "Microservices", "Machine Learning", "REST", "GraphQL", "Agile"
  ];
  const detectedSkills = [];
  skillDict.forEach(sk => {
    if (lower.includes(sk.toLowerCase())) detectedSkills.push(sk);
  });
  if (!detectedSkills.length) detectedSkills.push("Problem Solving", "System Architecture", "Clean Code");

  return {
    ok: true,
    name,
    target_role: roles[0],
    experience_level: level,
    skills: detectedSkills,
    summary: `${name} — ${level.toUpperCase()} ${roles[0]}. Skills: ${detectedSkills.slice(0, 5).join(", ")}.`,
    recommended_companies: [
      { name: "Google", reason: "Direct hiring for " + roles[0], accent: "#4285F4" },
      { name: "Amazon", reason: "Leadership Principles and Architecture", accent: "#FF9900" },
      { name: "Microsoft", reason: "Enterprise Engineering alignment", accent: "#00A4EF" }
    ]
  };
}

async function parseLinkedInProfile(text, autoNavigate = false) {
  const trimmed = (text || "").trim();
  if (!trimmed || trimmed.length < 3) {
    toast("Please paste your LinkedIn headline, bio, public URL, or skills summary.");
    return;
  }

  const spinner = $("#parseBtnSpinner");
  const btnText = $("#parseBtnText");
  const parseBtn = $("#parseLinkedInBtn");

  if (spinner) spinner.style.display = "inline";
  if (btnText) btnText.style.display = "none";
  if (parseBtn) parseBtn.disabled = true;

  try {
    let data = null;
    try {
      const res = await fetch(`${API}/api/parse-bio`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: trimmed })
      });
      if (res.ok) {
        data = await res.json();
      }
    } catch (netErr) {
      console.warn("Server bio parsing offline, using client fallback:", netErr);
    }

    if (!data || !data.ok) {
      data = parseBioClientFallback(trimmed);
    }

    populateProfilePreview(data, "Profile Text", autoNavigate);
    if (btnText) btnText.textContent = "🔄 Re-analyze Profile Text";
  } catch (err) {
    console.error("Error parsing profile:", err);
    toast("Error analyzing profile. Please check the text.");
  } finally {
    if (spinner) spinner.style.display = "none";
    if (btnText) btnText.style.display = "inline";
    if (parseBtn) parseBtn.disabled = false;
  }
}

let currentSelectedResumeFile = null;

function populateProfilePreview(data, sourceLabel = "Profile", autoNavigate = false) {
  if (!data) return;
  currentParsedProfile = data;

  const preview = $("#linkedinPreview");
  if (preview) preview.style.display = "block";

  const nameInput = $("#previewCandidateName");
  if (nameInput) nameInput.value = data.name || "Candidate";

  const avatar = $("#previewAvatar");
  if (avatar) {
    const initials = (data.name || "Candidate").split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
    avatar.textContent = initials || "SO";
  }

  const detectedLvl = (data.experience_level || "mid").toLowerCase();
  $$("#previewLevelGroup .chip-mini").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.lvl === detectedLvl);
  });

  const roleSelect = $("#previewRoleSelect");
  if (roleSelect) {
    const existingOptions = Array.from(roleSelect.options).map(o => o.value);
    if (data.target_role && !existingOptions.includes(data.target_role)) {
      const newOpt = document.createElement("option");
      newOpt.value = data.target_role;
      newOpt.textContent = `🎯 ${data.target_role}`;
      roleSelect.insertBefore(newOpt, roleSelect.firstChild);
    }
    roleSelect.value = data.target_role || "Software Engineer";
  }

  renderDetectedSkillsChips(data.skills || []);
  renderMatchedCompaniesChips(data.recommended_companies || []);

  toast(`✨ Analyzed ${sourceLabel}: ${data.name || 'Candidate'} (${data.target_role || 'Software Engineer'})`);

  if (autoNavigate) {
    setTimeout(() => {
      applyImportedProfile();
    }, 1000);
  }
}

function handleResumeFileSelection(file) {
  if (!file) return;

  const fileName = file.name || "resume";
  const ext = fileName.split(".").pop().toLowerCase();
  const isPdf = file.type === "application/pdf" || ext === "pdf";
  const isPng = file.type === "image/png" || ext === "png";
  const isImage = isPng || file.type.startsWith("image/") || ["jpg", "jpeg", "webp"].includes(ext);
  const isText = file.type.startsWith("text/") || ["txt", "md", "json"].includes(ext);

  if (!isPdf && !isPng && !isImage && !isText) {
    toast("⚠️ Please upload your resume in PDF (.pdf) or PNG (.png) format.");
    return;
  }

  const reader = new FileReader();
  reader.onload = (e) => {
    currentSelectedResumeFile = {
      file,
      name: fileName,
      size: file.size,
      type: file.type || (isPdf ? "application/pdf" : isPng ? "image/png" : "application/octet-stream"),
      dataUrl: e.target.result,
      isPdf,
      isPng
    };

    const card = $("#selectedFileCard");
    const nameEl = $("#selectedFileName");
    const sizeEl = $("#selectedFileSize");
    const iconEl = $("#selectedFileIcon");
    const badgeEl = $("#selectedFileBadge");

    if (nameEl) nameEl.textContent = fileName;
    if (sizeEl) sizeEl.textContent = (file.size / 1024).toFixed(1) + " KB";
    if (iconEl) iconEl.textContent = isPdf ? "📄" : isPng ? "🖼️" : "📁";
    if (badgeEl) {
      badgeEl.textContent = isPdf ? "PDF" : isPng ? "PNG" : ext.toUpperCase();
      badgeEl.className = "format-badge " + (isPdf ? "format-badge-pdf" : isPng ? "format-badge-png" : "format-badge-secondary");
    }
    if (card) card.style.display = "flex";

    toast(`Selected: ${fileName} (${isPdf ? 'PDF' : isPng ? 'PNG' : ext.toUpperCase()})`);
  };

  reader.onerror = () => {
    toast("Error reading file. Please try again.");
  };

  reader.readAsDataURL(file);
}

async function submitResumeUpload() {
  if (!currentSelectedResumeFile) {
    const input = $("#resumeFileInput");
    if (input && input.files && input.files[0]) {
      handleResumeFileSelection(input.files[0]);
    } else {
      toast("Please select or drop a PDF or PNG resume file first.");
      $("#resumeFileInput")?.click();
      return;
    }
  }

  const spinner = $("#uploadResumeBtnSpinner");
  const textEl = $("#uploadResumeBtnText");
  const submitBtn = $("#uploadResumeSubmitBtn");

  if (spinner) spinner.style.display = "inline";
  if (textEl) textEl.style.display = "none";
  if (submitBtn) submitBtn.disabled = true;

  try {
    const formatName = currentSelectedResumeFile.isPdf ? "PDF" : (currentSelectedResumeFile.isPng ? "PNG" : "Resume");
    toast(`⏳ Extracting skills & experience from ${formatName}...`);

    const res = await fetch(`${API}/api/upload-resume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        file_name: currentSelectedResumeFile.name,
        mime_type: currentSelectedResumeFile.type,
        file_data: currentSelectedResumeFile.dataUrl
      })
    });

    const data = await res.json();
    if (!res.ok || !data.ok) {
      throw new Error(data.message || data.error || "Failed to analyze resume file");
    }

    populateProfilePreview(data, (data.format || formatName).toUpperCase());
    if (textEl) textEl.textContent = "🔄 Re-analyze Resume File";
  } catch (err) {
    console.error("Resume upload extraction error:", err);
    toast(`⚠️ ${err.message || 'Error parsing resume file'}`);
  } finally {
    if (spinner) spinner.style.display = "none";
    if (textEl) textEl.style.display = "inline";
    if (submitBtn) submitBtn.disabled = false;
  }
}

function switchResumeModalMode(mode = "upload") {
  const tabUpload = $("#tabResumeUpload");
  const tabPaste = $("#tabBioPaste");
  const panelUpload = $("#resumeUploadPanel");
  const panelPaste = $("#bioPastePanel");

  if (mode === "upload") {
    tabUpload?.classList.add("active");
    tabPaste?.classList.remove("active");
    if (panelUpload) panelUpload.style.display = "block";
    if (panelPaste) panelPaste.style.display = "none";
  } else {
    tabPaste?.classList.add("active");
    tabUpload?.classList.remove("active");
    if (panelPaste) panelPaste.style.display = "block";
    if (panelUpload) panelUpload.style.display = "none";
  }
}

function applyImportedProfile() {
  if (!currentParsedProfile) {
    const rawVal = $("#linkedinInput")?.value;
    if (rawVal && rawVal.trim().length >= 3) {
      currentParsedProfile = parseBioClientFallback(rawVal);
    } else {
      toast("Please extract your LinkedIn profile or bio text first.");
      return;
    }
  }

  const name = $("#previewCandidateName")?.value?.trim() || currentParsedProfile.name || "Candidate";
  const role = $("#previewRoleSelect")?.value || currentParsedProfile.target_role || "Software Engineer";
  const activeLvlBtn = $("#previewLevelGroup .chip-mini.active");
  const level = activeLvlBtn?.dataset.lvl || currentParsedProfile.experience_level || "mid";
  const skills = currentParsedProfile.skills || [];
  const summary = currentParsedProfile.summary || `${name} (${role} • ${level})`;
  const recs = currentParsedProfile.recommended_companies || [];

  state.candidateName = name;
  state.candidateRole = role;
  state.selectedRole = role;
  state.selectedLevel = level;
  state.importedSkills = skills;
  state.userBio = summary;
  state.recommendedCompanies = recs;
  state.profileImported = true;

  localStorage.setItem("gr_user_name", name);
  localStorage.setItem("gr_user_role", role);
  localStorage.setItem("gr_selected_level", level);
  localStorage.setItem("gr_imported_skills", JSON.stringify(skills));
  localStorage.setItem("gr_user_bio", summary);
  localStorage.setItem("gr_recommended_companies", JSON.stringify(recs));

  const userId = state.userId || localStorage.getItem("gr_user_id") || "default_user";
  fetch(`${API}/api/db/user`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: userId,
      display_name: name,
      target_role: role,
      target_level: level,
      skills: skills,
      recommended_companies: recs,
      bio: summary
    })
  }).catch(err => console.warn("Firestore sync error:", err));

  closeAllModals();
  goToScreen(1);
  renderImportedProfileBanner();
  renderCompanyGrid();
  toast(`🎯 Profile Active: ${name} (${role} • ${level.toUpperCase()})`);
}

function renderImportedProfileBanner() {
  const banner = $("#importedProfileBanner");
  if (!banner) return;

  const savedSkills = JSON.parse(localStorage.getItem("gr_imported_skills") || "[]");
  const savedRecs = JSON.parse(localStorage.getItem("gr_recommended_companies") || "[]");
  if (savedRecs.length && (!state.recommendedCompanies || !state.recommendedCompanies.length)) {
    state.recommendedCompanies = savedRecs;
  }

  const hasProfile = state.profileImported || (state.importedSkills && state.importedSkills.length > 0) || savedSkills.length > 0;
  if (!hasProfile) {
    banner.style.display = "none";
    return;
  }

  const name = state.candidateName || localStorage.getItem("gr_user_name") || "Candidate";
  const role = state.selectedRole || localStorage.getItem("gr_user_role") || "Software Engineer";
  const level = (state.selectedLevel || localStorage.getItem("gr_selected_level") || "mid").toUpperCase();
  const skillsCount = (state.importedSkills && state.importedSkills.length) || savedSkills.length || 0;

  const infoText = $("#pabInfoText");
  const skillsBadge = $("#pabSkillsCount");
  const recChip = $("#pabTopRecChip");

  if (infoText) infoText.textContent = `${name} (${role} • ${level})`;
  if (skillsBadge) skillsBadge.textContent = `${skillsCount} skills loaded`;

  if (recChip) {
    if (state.recommendedCompanies && state.recommendedCompanies.length > 0) {
      const top = state.recommendedCompanies[0];
      recChip.textContent = `🎯 Top Match: ${top.name} (${top.match_percent || 90}%) • ${state.recommendedCompanies.length} AI Recommended`;
      recChip.style.display = "inline-block";
      recChip.onclick = () => {
        state.companyFilter = "recommended";
        $("#tabRecommendedCompanies")?.classList.add("active");
        $("#tabAllCompanies")?.classList.remove("active");
        renderCompanyGrid();
        document.getElementById("companyFilterTabs")?.scrollIntoView({ behavior: "smooth" });
      };
    } else {
      recChip.style.display = "none";
    }
  }

  banner.style.display = "flex";
}

function clearImportedProfile() {
  state.profileImported = false;
  state.importedSkills = [];
  state.userBio = "";
  state.recommendedCompanies = [];
  state.companyFilter = "all";
  localStorage.removeItem("gr_imported_skills");
  localStorage.removeItem("gr_user_bio");
  localStorage.removeItem("gr_recommended_companies");
  const banner = $("#importedProfileBanner");
  if (banner) banner.style.display = "none";
  const recTab = $("#tabRecommendedCompanies");
  if (recTab) recTab.style.display = "none";
  $("#tabAllCompanies")?.classList.add("active");
  $("#tabRecommendedCompanies")?.classList.remove("active");
  renderCompanyGrid();
  toast("Imported profile cleared.");
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

  const totalCompaniesCount = (state.companies.length || 0) + (state.customBanks.length || 0);
  const allCountEl = $("#allCompaniesCount");
  if (allCountEl) allCountEl.textContent = totalCompaniesCount;

  const recCompanies = Array.isArray(state.recommendedCompanies) ? state.recommendedCompanies : [];
  const recTab = $("#tabRecommendedCompanies");
  const recCountEl = $("#recCompaniesCount");

  if (recTab) {
    if (recCompanies.length > 0) {
      recTab.style.display = "inline-flex";
      if (recCountEl) recCountEl.textContent = recCompanies.length;
    } else {
      recTab.style.display = "none";
      if (state.companyFilter === "recommended") state.companyFilter = "all";
    }
  }

  const allTab = $("#tabAllCompanies");
  if (allTab && recTab) {
    allTab.classList.toggle("active", state.companyFilter === "all");
    recTab.classList.toggle("active", state.companyFilter === "recommended");
  }

  const q = state.searchQuery.toLowerCase().trim();
  let cards = [...state.customBanks, ...state.companies].filter(c => {
    if (!q) return true;
    const nameMatch = (c.name || "").toLowerCase().includes(q);
    const focusMatch = (c.focus || "").toLowerCase().includes(q);
    const roleMatch = c.roles ? JSON.stringify(c.roles).toLowerCase().includes(q) : false;
    return nameMatch || focusMatch || roleMatch;
  });

  // If user selected "AI Recommended" filter tab
  if (state.companyFilter === "recommended" && recCompanies.length > 0) {
    const recIdSet = new Set(recCompanies.map(r => r.id));
    cards = cards.filter(c => recIdSet.has(c.id));
    // Sort by recommendation match_percent descending
    cards.sort((a, b) => {
      const matchA = recCompanies.find(r => r.id === a.id)?.match_percent || 0;
      const matchB = recCompanies.find(r => r.id === b.id)?.match_percent || 0;
      return matchB - matchA;
    });
  } else if (recCompanies.length > 0) {
    // When in "all" mode, prioritize recommended companies to top
    const recIdSet = new Set(recCompanies.map(r => r.id));
    cards.sort((a, b) => {
      const isRecA = recIdSet.has(a.id) ? 1 : 0;
      const isRecB = recIdSet.has(b.id) ? 1 : 0;
      return isRecB - isRecA;
    });
  }

  if (cards.length === 0) {
    if (state.companyFilter === "recommended") {
      grid.innerHTML = `<div style="grid-column:1/-1; padding:40px; text-align:center; color:var(--muted);">No recommended companies matched your current search. <button class="btn btn-ghost btn-xs" id="gridClearFilterBtn">View All Companies</button></div>`;
      $("#gridClearFilterBtn")?.addEventListener("click", () => {
        state.companyFilter = "all";
        renderCompanyGrid();
      });
    } else {
      grid.innerHTML = `<div style="grid-column:1/-1; padding:40px; text-align:center; color:var(--muted);">No companies found matching "${escapeHtml(state.searchQuery)}". Try searching "Google", "Amazon", "Frontend", or "Python".</div>`;
    }
    return;
  }

  cards.forEach((c) => {
    const card = document.createElement("div");
    card.className = "company-card";
    card.style.setProperty("--card-accent", c.accent || "#FFB020");
    const avgText = c.benchmark_avg ? `Avg Score: ${c.benchmark_avg}` : (c.isCustom ? "Custom Bank" : "");
    const recMatch = recCompanies.find(r => r.id === c.id);

    if (recMatch) {
      card.classList.add("is-ai-recommended");
    }

    card.innerHTML = `
      ${recMatch ? `<div class="rec-ribbon">✨ AI Recommended • ${recMatch.match_percent || 90}% Fit</div>` : ''}
      <div class="card-top">
        <div class="card-logo">${escapeHtml(c.name[0])}</div>
        <div>
          <div class="card-name">${escapeHtml(c.name)} ${c.isCustom ? '<span style="font-size:.65rem; color:var(--signal);">[CUSTOM]</span>' : ''}</div>
          <div class="card-diff">${escapeHtml(c.difficulty)} • ${avgText}</div>
        </div>
      </div>
      <p class="card-focus">${escapeHtml(c.focus)}</p>
      ${recMatch ? `
        <div class="rec-card-matching-skills">
          <span class="rec-cms-title">🎯 FIT REASON (${escapeHtml(recMatch.experience_fit || 'Track Fit')}):</span>
          <span style="font-size:.72rem; color:var(--text); line-height:1.35;">${escapeHtml(recMatch.reason || 'Strong technical skills and seniority calibration match.')}</span>
          ${recMatch.matching_skills && recMatch.matching_skills.length ? `
            <div class="rec-cms-tags">
              ${recMatch.matching_skills.slice(0, 4).map(s => `<span class="rec-cms-tag">✓ ${escapeHtml(s)}</span>`).join("")}
            </div>
          ` : ''}
        </div>
      ` : ''}
      <div class="card-rounds">
        ${(c.rounds || ["Interview"]).map(r => `<span class="round-pill">${escapeHtml(r)}</span>`).join("")}
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
  const roleKeys = company.roles ? (Array.isArray(company.roles) ? [...company.roles] : Object.keys(company.roles)) : ["Software Engineer"];
  if (state.selectedRole && !roleKeys.includes(state.selectedRole)) {
    roleKeys.unshift(state.selectedRole);
  } else if (!state.selectedRole) {
    state.selectedRole = roleKeys[0];
  }
  state.selectedPersona = "friendly";
  state.selectedFormat = "onsite";
  state.selectedLang = "english";
  if (!state.selectedLevel) state.selectedLevel = localStorage.getItem("gr_selected_level") || "mid";

  $("#modalLogo").style.background = company.accent || "var(--spotlight)";
  $("#modalLogo").textContent = company.name[0];
  $("#modalCompanyName").textContent = company.name;
  $("#modalCompanyFocus").textContent = company.focus;

  $("#roundChips").innerHTML = (company.rounds || ["General Round"]).map(r => `<span class="chip">${r}</span>`).join("");
  $("#roleChips").innerHTML = roleKeys.map(r =>
    `<span class="chip selectable ${r === state.selectedRole ? "selected":""}" data-role="${r}">${r === state.selectedRole && state.profileImported ? `🎯 ${r}` : r}</span>`
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
   AI Behavior & Anti-Cheating Tracking Engine
   ------------------------------------------------------------------------- */
const behaviorTracker = {
  active: false,
  intervalId: null,
  totalFrames: 0,
  eyeContactFrames: 0,
  gazeAwayCount: 0,
  gazeDownCount: 0,
  faceAbsentFrames: 0,
  multipleFacesDetected: false,
  tabSwitches: 0,
  blurCount: 0,
  pasteAnomalies: 0,
  consecutiveAway: 0,
  consecutiveDown: 0,
  _bound: false,
  _alertTimer: null,

  resetForQuestion() {
    this.totalFrames = 0;
    this.eyeContactFrames = 0;
    this.gazeAwayCount = 0;
    this.gazeDownCount = 0;
    this.faceAbsentFrames = 0;
    this.multipleFacesDetected = false;
    this.tabSwitches = 0;
    this.pasteAnomalies = 0;
    this.consecutiveAway = 0;
    this.consecutiveDown = 0;
    this.updateHUD({
      eyeContact: 98,
      gazeDirection: "focused"
    });
  },

  start() {
    if (this.active) return;
    this.active = true;
    if (this.intervalId) clearInterval(this.intervalId);
    this.intervalId = setInterval(() => this.analyzeFrame(), 380);
    this.bindWindowEvents();
  },

  stop() {
    this.active = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.unbindWindowEvents();
  },

  bindWindowEvents() {
    if (this._bound) return;
    this._bound = true;

    this._onVisibilityChange = () => {
      if (document.hidden && $("#screen-2")?.classList.contains("active")) {
        this.tabSwitches++;
        this.showAlert("⚠️ Anti-Cheat: Tab switch detected! Please stay focused on the interview.");
        this.updateHUD();
      }
    };
    document.addEventListener("visibilitychange", this._onVisibilityChange);

    this._onBlur = () => {
      if ($("#screen-2")?.classList.contains("active")) {
        this.blurCount++;
      }
    };
    window.addEventListener("blur", this._onBlur);

    const answerEl = $("#answerInput");
    if (answerEl) {
      this._onPaste = (e) => {
        const text = (e.clipboardData || window.clipboardData)?.getData("text") || "";
        if (text.length > 80) {
          this.pasteAnomalies++;
          this.showAlert("⚠️ Notice: Large clipboard paste detected.");
          this.updateHUD();
        }
      };
      answerEl.addEventListener("paste", this._onPaste);
    }
  },

  unbindWindowEvents() {
    if (!this._bound) return;
    this._bound = false;
    document.removeEventListener("visibilitychange", this._onVisibilityChange);
    window.removeEventListener("blur", this._onBlur);
    const answerEl = $("#answerInput");
    if (answerEl && this._onPaste) {
      answerEl.removeEventListener("paste", this._onPaste);
    }
  },

  showAlert(msg) {
    const alertEl = $("#hudProctorAlert");
    if (!alertEl) return;
    alertEl.textContent = msg;
    alertEl.style.display = "block";
    clearTimeout(this._alertTimer);
    this._alertTimer = setTimeout(() => {
      alertEl.style.display = "none";
    }, 4500);
  },

  analyzeFrame() {
    const video = $("#candidateWebcam");
    const canvas = $("#behaviorCanvas");
    if (!video || !canvas || video.readyState < 2) return;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let imgData;
    try {
      imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    } catch(e) {
      return;
    }
    const data = imgData.data;

    let skinPixelCount = 0;
    let sumX = 0;
    let sumY = 0;
    const step = 4;

    for (let i = 0; i < data.length; i += 4 * step) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const isSkin = (r > 60 && g > 40 && b > 20) &&
                     (Math.max(r, g, b) - Math.min(r, g, b) > 15) &&
                     (Math.abs(r - g) > 15) && (r > g) && (r > b);

      if (isSkin) {
        skinPixelCount++;
        const pixelIdx = i / 4;
        const x = pixelIdx % canvas.width;
        const y = Math.floor(pixelIdx / canvas.width);
        sumX += x;
        sumY += y;
      }
    }

    this.totalFrames++;
    const minFacePixels = (canvas.width * canvas.height) / (step * 25);
    let gazeDirection = "focused";

    if (skinPixelCount < minFacePixels) {
      this.faceAbsentFrames++;
      gazeDirection = "absent";
    } else {
      const avgX = sumX / skinPixelCount;
      const avgY = sumY / skinPixelCount;
      const normX = avgX / canvas.width;
      const normY = avgY / canvas.height;

      if (normX < 0.28 || normX > 0.72) {
        gazeDirection = "away";
        this.consecutiveAway++;
        if (this.consecutiveAway === 4) {
          this.gazeAwayCount++;
          this.showAlert("⚠️ Anti-Cheat: Looking away from interviewer.");
        }
      } else if (normY > 0.68) {
        gazeDirection = "down";
        this.consecutiveDown++;
        if (this.consecutiveDown === 4) {
          this.gazeDownCount++;
          this.showAlert("⚠️ Notice: Head tilted down (desk/phone inspection).");
        }
      } else {
        this.consecutiveAway = 0;
        this.consecutiveDown = 0;
        this.eyeContactFrames++;
      }
    }

    this.updateHUD({ gazeDirection });
  },

  updateHUD(custom = {}) {
    const eyeDot = $("#hudEyeDot");
    const eyeText = $("#hudEyeText");
    const faceDot = $("#hudFaceDot");
    const faceText = $("#hudFaceText");
    const antiCheatText = $("#hudAntiCheatText");
    const antiCheatPill = $("#hudAntiCheatPill");
    const candScoreTag = $("#candBehaviorScoreTag");

    const ratio = this.totalFrames > 0
      ? Math.round((this.eyeContactFrames / this.totalFrames) * 100)
      : (custom.eyeContact ?? 98);

    const gaze = custom.gazeDirection || "focused";

    if (eyeDot && eyeText) {
      if (gaze === "away") {
        eyeDot.className = "hud-dot warn";
        eyeText.textContent = `Eye: Looking Away (${ratio}%)`;
      } else if (gaze === "down") {
        eyeDot.className = "hud-dot warn";
        eyeText.textContent = `Eye: Looking Down (${ratio}%)`;
      } else if (gaze === "absent") {
        eyeDot.className = "hud-dot danger";
        eyeText.textContent = `Eye: Out of Frame`;
      } else {
        eyeDot.className = "hud-dot good";
        eyeText.textContent = `Eye: ${Math.max(70, ratio)}% Focused`;
      }
    }

    if (faceDot && faceText) {
      if (gaze === "absent") {
        faceDot.className = "hud-dot danger";
        faceText.textContent = `👤 No Face`;
      } else if (gaze === "away" || gaze === "down") {
        faceDot.className = "hud-dot warn";
        faceText.textContent = `👤 Shifted`;
      } else {
        faceDot.className = "hud-dot good";
        faceText.textContent = `👤 Centered`;
      }
    }

    if (antiCheatText && antiCheatPill) {
      if (this.tabSwitches > 0) {
        antiCheatPill.className = "hud-pill danger";
        antiCheatText.textContent = `Flagged (${this.tabSwitches} Tab${this.tabSwitches > 1 ? "s" : ""})`;
      } else {
        antiCheatPill.className = "hud-pill";
        antiCheatText.textContent = `Verified (0 Tabs)`;
      }
    }

    if (candScoreTag) {
      const deductions = (this.tabSwitches * 14) + (this.gazeAwayCount * 3) + (this.gazeDownCount * 3);
      const score = Math.max(50, Math.min(100, Math.round((ratio * 0.4) + ((100 - deductions) * 0.6))));
      candScoreTag.textContent = `Composure: ${score}%`;
      candScoreTag.style.color = score >= 80 ? "var(--signal)" : score >= 65 ? "var(--spotlight)" : "var(--cue)";
    }
  },

  getReportData() {
    const ratio = this.totalFrames > 0
      ? Math.round((this.eyeContactFrames / this.totalFrames) * 100)
      : 95;
    const deductions = (this.tabSwitches * 15) + (this.gazeAwayCount * 3) + (this.gazeDownCount * 3) + (this.pasteAnomalies * 10);
    const score = Math.max(0, Math.min(100, Math.round((ratio * 0.4) + ((100 - deductions) * 0.6))));

    return {
      score,
      eye_contact_ratio: ratio,
      tab_switches: this.tabSwitches,
      gaze_away_count: this.gazeAwayCount,
      gaze_down_count: this.gazeDownCount,
      multiple_faces_detected: this.multipleFacesDetected,
      face_absent: this.faceAbsentFrames > (this.totalFrames * 0.2),
      paste_anomalies: this.pasteAnomalies,
      blur_count: this.blurCount
    };
  }
};

/* Audio VU Meter */
let audioMeterContext = null;
let audioAnalyser = null;
let audioMeterAnimId = null;

function setupAudioMeter(stream){
  if (!stream) return;
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    if (!audioMeterContext) {
      audioMeterContext = new AudioCtx();
    }
    if (audioMeterContext.state === "suspended") {
      audioMeterContext.resume().catch(() => {});
    }
    const source = audioMeterContext.createMediaStreamSource(stream);
    audioAnalyser = audioMeterContext.createAnalyser();
    audioAnalyser.fftSize = 64;
    source.connect(audioAnalyser);

    const bars = $$("#audioVuBars .vu-bar");
    const statusPill = $("#audioStatusPill");
    const dataArray = new Uint8Array(audioAnalyser.frequencyBinCount);

    function tick() {
      if (!audioAnalyser) return;
      audioAnalyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      const normalized = Math.min(1, avg / 60);

      if (bars.length) {
        bars.forEach((bar, idx) => {
          const factor = (idx + 1) / bars.length;
          const height = Math.max(3, Math.round(normalized * 14 * (0.6 + 0.4 * factor)));
          bar.style.height = `${height}px`;
          bar.style.background = normalized > 0.18 ? "var(--signal)" : "rgba(89,217,196,0.3)";
        });
      }

      if (statusPill) {
        if (normalized > 0.15) {
          statusPill.textContent = "Speaking…";
          statusPill.className = "audio-status-pill active";
        } else {
          statusPill.textContent = state.isRecording ? "Listening" : "Mic Ready";
          statusPill.className = "audio-status-pill";
        }
      }

      audioMeterAnimId = requestAnimationFrame(tick);
    }
    if (audioMeterAnimId) cancelAnimationFrame(audioMeterAnimId);
    tick();
  } catch (err) {
    console.warn("Audio meter setup notice:", err);
  }
}

/* -------------------------------------------------------------------------
   Interview Room Logic
   ------------------------------------------------------------------------- */
function loadQuestion(){
  const q = state.questions[state.currentIndex];
  if (!q){ return finishInterview(); }

  // Start AI behavior & proctoring tracker for this question
  behaviorTracker.resetForQuestion();
  behaviorTracker.start();

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
    const qLevel = q.level || state.selectedLevel || "junior";
    levelTag.textContent = qLevel.toUpperCase();
    levelTag.className = `level-tag ${qLevel}`;
  }

  // Populate Question Simplification & Hints Drawer
  const hintBox = $("#questionHintBox");
  if (hintBox) hintBox.style.display = "none";
  const simpText = $("#hintSimplifiedText");
  const pointsList = $("#hintPointsList");
  const starterText = $("#hintStarterText");

  if (simpText) simpText.textContent = q.simplified_prompt || q.q;
  if (pointsList) {
    const hints = q.hints || (Array.isArray(q.keywords) ? q.keywords.map(k => `Explain ${k} clearly`) : ["State your core definition", "Walk through a practical step-by-step example", "Mention benefits and trade-offs"]);
    pointsList.innerHTML = hints.map(h => `<li>${escapeHtml(h)}</li>`).join("");
  }
  if (starterText) {
    starterText.textContent = q.starter_template || `“In simple terms, I approach this by first…”`;
  }

  const candBadge = $("#candidateLevelBadge");
  if (candBadge) {
    const chosenLevel = state.selectedLevel === "all" ? "ALL-ROUND" : (state.selectedLevel || "JUNIOR").toUpperCase();
    candBadge.textContent = `${chosenLevel} CANDIDATE`;
  }

  const candidateCam = $("#candidateWebcam");
  if (candidateCam && state.cameraStream) {
    if (candidateCam.srcObject !== state.cameraStream) {
      candidateCam.srcObject = state.cameraStream;
    }
    candidateCam.play().catch(() => {});
    setupAudioMeter(state.cameraStream);
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

  const accentSelect = $("#speechAccentSelect");
  rec.lang = accentSelect ? accentSelect.value : (state.selectedLang === "hinglish" ? "hi-IN" : "en-US");

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

  rec.onerror = (e) => {
    // Ignore no-speech pause: normal conversation has pauses
    if (e.error === "no-speech") {
      return;
    }
    console.warn("Speech recognition notice:", e.error);
    if (e.error === "network" || e.error === "aborted") {
      setTimeout(() => {
        if (state.isRecording && state.recognition) {
          try { state.recognition.start(); } catch(_) {}
        }
      }, 350);
      return;
    }
    if (e.error === "not-allowed") {
      toast("Microphone access is required for voice recognition.");
      stopRecording();
    }
  };

  rec.onend = () => {
    // Keep recognition active while recording state is true
    if (state.isRecording) {
      setTimeout(() => {
        if (state.isRecording && state.recognition) {
          try {
            state.recognition.start();
          } catch(err) {}
        }
      }, 150);
    }
  };

  return rec;
}

function startRecording(){
  const accentSelect = $("#speechAccentSelect");
  if (state.recognition && accentSelect && state.recognition.lang !== accentSelect.value) {
    state.recognition = null;
  }
  if (!state.recognition) state.recognition = setupRecognition();
  if (!state.recognition){ toast("Speech recognition isn't supported in this browser — type your answer instead."); return; }
  state.isRecording = true;
  state.baseTranscript = $("#answerInput").value ? $("#answerInput").value + " " : "";
  try {
    state.recognition.start();
  } catch(_) {}
  $("#micToggle").classList.add("recording");
  $("#micToggleLabel").textContent = "Listening… tap to stop";
  const pill = $("#audioStatusPill");
  if (pill) { pill.textContent = "Listening"; pill.className = "audio-status-pill active"; }
  $("#onAirBadge").classList.add("live");
}

function stopRecording(){
  state.isRecording = false;
  if (state.recognition){ try{ state.recognition.stop(); }catch(e){} }
  $("#micToggle").classList.remove("recording");
  $("#micToggleLabel").textContent = "Tap mic to speak";
  const pill = $("#audioStatusPill");
  if (pill) { pill.textContent = "Mic Ready"; pill.className = "audio-status-pill"; }
}

/* Submit Answer */
async function submitAnswer(){
  const q = state.questions[state.currentIndex];
  const answer = $("#answerInput").value.trim();
  if (!answer){ toast("Say or type your answer before submitting."); return; }

  stopRecording();
  clearInterval(state.timerInterval);
  const duration = (Date.now() - state.answerStartTime) / 1000;

  // Retrieve anti-cheating and behavior proctoring metrics
  const behaviorData = behaviorTracker.getReportData();

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
        level: q.level || state.selectedLevel || "junior",
        question_type: q.type,
        keywords: q.keywords,
        answer,
        duration_seconds: duration,
        persona: state.selectedPersona,
        language: state.selectedLang,
        company_id: state.activeCompany?.id || "google",
        behavior: behaviorData
      })
    });
    const result = await res.json();
    result.question_text = q.q;
    result.candidate_answer = answer;
    result.behavior = behaviorData;
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

  const behaviorVal = result.behavior ? result.behavior.score : 95;
  const bars = [
    ["Relevance", result.breakdown.relevance],
    ["Structure", result.breakdown.structure.score],
    ["Fluency", result.breakdown.fluency.score],
    ["Confidence", result.breakdown.confidence.score],
    ["Behavior & Composure", behaviorVal]
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
  behaviorTracker.stop();
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

  // Render Candidate Behavior & Anti-Cheating Assessment
  if (report.proctoring) {
    const proc = report.proctoring;
    const score = proc.overall_behavior_score ?? proc.behavior_score ?? 90;
    const badge = $("#reportBehaviorScoreBadge");
    if (badge) {
      badge.textContent = `${score}% Composure`;
      badge.style.color = score >= 80 ? "var(--signal)" : score >= 60 ? "var(--spotlight)" : "var(--cue)";
    }
    const eyeEl = $("#reportEyeContactPct");
    if (eyeEl) eyeEl.textContent = `${proc.avg_eye_contact ?? proc.average_eye_contact ?? 95}%`;
    const integEl = $("#reportIntegrityRating");
    if (integEl) integEl.textContent = proc.integrity_status ?? proc.integrity_rating ?? "Verified Clean";
    const tabEl = $("#reportTabCountSub");
    if (tabEl) tabEl.textContent = `${proc.total_tab_switches ?? 0} tab switches`;
    const riskEl = $("#reportCheatRisk");
    if (riskEl) {
      const isClean = (proc.total_tab_switches === 0 && (!proc.flags || proc.flags.length === 0));
      riskEl.textContent = isClean ? "Clean" : "Flagged";
      riskEl.className = `p-stat-value ${isClean ? 'text-clean' : 'text-flagged'}`;
    }
    const sumEl = $("#reportProctorSummaryText");
    if (sumEl) sumEl.textContent = proc.proctor_verdict ?? proc.summary ?? "Consistently maintained eye contact with interviewer; no external tabs opened or unprompted clipboard paste detected.";
  }

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
  const colors = { Relevance:"#FFB020", Structure:"#59D9C4", Fluency:"#FF9F5A", Confidence:"#8FD9FF", Behavior:"#59D9C4" };

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
  $("#openLinkedInBtn")?.addEventListener("click", () => {
    switchResumeModalMode("upload");
    $("#linkedinModal")?.classList.add("open");
  });
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
  $("#castingUploadResumeBtn")?.addEventListener("click", () => {
    switchResumeModalMode("upload");
    $("#linkedinModal")?.classList.add("open");
  });

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
  // Question Simplification & Hints Drawer
  $("#simplifyQuestionBtn")?.addEventListener("click", () => {
    const hintBox = $("#questionHintBox");
    if (hintBox) {
      const isHidden = hintBox.style.display === "none";
      hintBox.style.display = isHidden ? "block" : "none";
      if (isHidden) {
        gsap.fromTo(hintBox, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" });
      }
    }
  });
  $("#closeHintBoxBtn")?.addEventListener("click", () => {
    const hintBox = $("#questionHintBox");
    if (hintBox) hintBox.style.display = "none";
  });

  // Speech Recognition Controls
  $("#speechAccentSelect")?.addEventListener("change", (e) => {
    if (state.recognition) {
      state.recognition.lang = e.target.value;
    }
    toast(`Speech accent set to: ${e.target.options[e.target.selectedIndex].text}`);
  });
  $("#clearSpeechBtn")?.addEventListener("click", () => {
    $("#answerInput").value = "";
    state.baseTranscript = "";
    updateLiveMeta();
    toast("Speech answer cleared. Ready to speak again!");
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

  // Resume & Profile Modal Mode Switchers
  $("#tabResumeUpload")?.addEventListener("click", () => switchResumeModalMode("upload"));
  $("#tabBioPaste")?.addEventListener("click", () => switchResumeModalMode("paste"));

  // Resume File Upload Dropzone & File Input Handlers
  const resumeDropzone = $("#resumeDropzone");
  const resumeFileInput = $("#resumeFileInput");

  if (resumeDropzone && resumeFileInput) {
    resumeDropzone.addEventListener("click", (e) => {
      // Don't trigger if clicking child input directly
      if (e.target !== resumeFileInput) {
        resumeFileInput.click();
      }
    });

    ["dragenter", "dragover"].forEach(evt => {
      resumeDropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        resumeDropzone.classList.add("dragover");
      });
    });

    ["dragleave", "dragend"].forEach(evt => {
      resumeDropzone.addEventListener(evt, (e) => {
        e.preventDefault();
        e.stopPropagation();
        resumeDropzone.classList.remove("dragover");
      });
    });

    resumeDropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      resumeDropzone.classList.remove("dragover");
      const files = e.dataTransfer?.files;
      if (files && files.length > 0) {
        handleResumeFileSelection(files[0]);
      }
    });

    resumeFileInput.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) handleResumeFileSelection(file);
    });
  }

  $("#removeFileBtn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    currentSelectedResumeFile = null;
    const card = $("#selectedFileCard");
    if (card) card.style.display = "none";
    if (resumeFileInput) resumeFileInput.value = "";
    toast("Selected resume file removed.");
  });

  $("#uploadResumeSubmitBtn")?.addEventListener("click", () => {
    submitResumeUpload();
  });

  // Bio & LinkedIn Modal Actions
  $("#parseLinkedInBtn")?.addEventListener("click", () => {
    const val = $("#linkedinInput")?.value;
    parseLinkedInProfile(val, false);
  });

  $("#applyLinkedInBtn")?.addEventListener("click", () => {
    applyImportedProfile();
  });

  $("#clearLinkedInBtn")?.addEventListener("click", () => {
    const input = $("#linkedinInput");
    if (input) input.value = "";
    currentSelectedResumeFile = null;
    const card = $("#selectedFileCard");
    if (card) card.style.display = "none";
    if (resumeFileInput) resumeFileInput.value = "";
    const preview = $("#linkedinPreview");
    if (preview) preview.style.display = "none";
    currentParsedProfile = null;
    toast("Input cleared.");
  });

  $("#loadSampleBioBtn")?.addEventListener("click", () => {
    const sample = `Sangeeta Ojha\nSenior Software Engineer with 5+ years of experience in React, Node.js, Python, AWS, Docker, and PostgreSQL. Passionate about system design and high-throughput microservices.`;
    const input = $("#linkedinInput");
    if (input) input.value = sample;
    parseLinkedInProfile(sample, false);
  });

  $("#bioFileInput")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content === "string" && content.trim()) {
        const input = $("#linkedinInput");
        if (input) input.value = content;
        parseLinkedInProfile(content, false);
        toast(`📁 Loaded ${file.name}`);
      }
    };
    reader.readAsText(file);
  });

  // Level selector in preview modal
  $$("#previewLevelGroup .chip-mini").forEach(btn => {
    btn.addEventListener("click", () => {
      $$("#previewLevelGroup .chip-mini").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      refreshProfileRecommendations();
    });
  });

  $("#previewRoleSelect")?.addEventListener("change", () => {
    refreshProfileRecommendations();
  });

  // Add custom skill in preview modal
  const handleAddSkill = () => {
    const input = $("#addSkillInput");
    const val = input?.value?.trim();
    if (!val) return;
    if (!currentParsedProfile) currentParsedProfile = { skills: [] };
    if (!currentParsedProfile.skills) currentParsedProfile.skills = [];
    if (!currentParsedProfile.skills.includes(val)) {
      currentParsedProfile.skills.push(val);
      renderDetectedSkillsChips(currentParsedProfile.skills);
      refreshProfileRecommendations();
    }
    input.value = "";
  };

  $("#addSkillBtn")?.addEventListener("click", handleAddSkill);
  $("#addSkillInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleAddSkill();
    }
  });

  // Company Grid Filtering Tabs
  $("#tabAllCompanies")?.addEventListener("click", () => {
    state.companyFilter = "all";
    $("#tabAllCompanies")?.classList.add("active");
    $("#tabRecommendedCompanies")?.classList.remove("active");
    renderCompanyGrid();
  });

  $("#tabRecommendedCompanies")?.addEventListener("click", () => {
    state.companyFilter = "recommended";
    $("#tabRecommendedCompanies")?.classList.add("active");
    $("#tabAllCompanies")?.classList.remove("active");
    renderCompanyGrid();
  });

  // Profile Banner Actions on Screen 1
  $("#pabEditBtn")?.addEventListener("click", () => {
    $("#linkedinModal")?.classList.add("open");
  });
  $("#pabClearBtn")?.addEventListener("click", () => {
    clearImportedProfile();
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
    openLogoutConfirmModal();
  });
  $("#cancelLogoutBtn")?.addEventListener("click", () => closeAllModals());
  $("#confirmLogoutBtn")?.addEventListener("click", () => handleLogout());

  $("#tabSignInBtn")?.addEventListener("click", () => switchAuthTab("signin"));
  $("#tabRegisterBtn")?.addEventListener("click", () => switchAuthTab("register"));
  $("#switchToRegLink")?.addEventListener("click", () => switchAuthTab("register"));
  $("#switchToLoginLink")?.addEventListener("click", () => switchAuthTab("signin"));
  $("#closeAuthModal")?.addEventListener("click", () => closeAllModals());
  $("#closeSocialModal")?.addEventListener("click", () => closeAllModals());

  // Password toggles
  $("#toggleLoginPwd")?.addEventListener("click", () => {
    const inp = $("#loginPassword");
    if (inp) inp.type = inp.type === "password" ? "text" : "password";
  });
  $("#toggleRegPwd")?.addEventListener("click", () => {
    const inp = $("#regPassword");
    if (inp) inp.type = inp.type === "password" ? "text" : "password";
  });

  // Form Submissions (single submission per form)
  $("#loginForm")?.addEventListener("submit", handleManualLogin);
  $("#registerForm")?.addEventListener("submit", handleManualRegister);

  // Social Sign-Ins (Google, LinkedIn, GitHub)
  $("#googleLoginBtn")?.addEventListener("click", () => openSocialAuthModal("google"));
  $("#googleRegBtn")?.addEventListener("click", () => openSocialAuthModal("google"));
  $("#linkedinLoginBtn")?.addEventListener("click", () => openSocialAuthModal("linkedin"));
  $("#linkedinRegBtn")?.addEventListener("click", () => openSocialAuthModal("linkedin"));
  $("#githubLoginBtn")?.addEventListener("click", () => openSocialAuthModal("github"));
  $("#githubRegBtn")?.addEventListener("click", () => openSocialAuthModal("github"));

  // Social Modal Actions
  $("#socialQuickConfirmBtn")?.addEventListener("click", handleSocialQuickConfirm);
  $("#toggleSocialCustomBtn")?.addEventListener("click", () => {
    const form = $("#socialCustomForm");
    if (form) {
      form.style.display = form.style.display === "none" ? "flex" : "none";
    }
  });
  $("#socialCustomForm")?.addEventListener("submit", handleSocialCustomSubmit);
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
let isAuthSubmitting = false;
let currentSocialProvider = "google";

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

function persistUserSession(user, rememberMe = true) {
  if (!user || !user.id) return;
  localStorage.setItem("gr_auth_token", "sess_" + Date.now());
  localStorage.setItem("gr_auth_user", JSON.stringify(user));
  localStorage.setItem("gr_user_id", user.id);
  localStorage.setItem("gr_user_name", user.display_name || "Candidate");
  localStorage.setItem("gr_user_role", user.target_role || "Software Engineer");
  if (user.target_company) localStorage.setItem("gr_user_company", user.target_company);
  if (user.target_level) localStorage.setItem("gr_selected_level", user.target_level);

  if (rememberMe) {
    localStorage.setItem("gr_remember_me", "true");
    if (user.email) localStorage.setItem("gr_remembered_email", user.email);
    if (user.display_name) localStorage.setItem("gr_remembered_name", user.display_name);
  } else {
    localStorage.removeItem("gr_remember_me");
  }
}

async function restoreUserSession() {
  const isRemembered = localStorage.getItem("gr_remember_me") === "true";
  const user = getAuthUser();
  const rememberedEmail = localStorage.getItem("gr_remembered_email") || "";
  const rememberedName = localStorage.getItem("gr_remembered_name") || "";

  // Pre-fill email inputs for seamless access
  const loginEmail = $("#loginEmail");
  if (loginEmail && rememberedEmail) {
    loginEmail.value = rememberedEmail;
  }
  const loginRemember = $("#loginRememberMe");
  if (loginRemember) {
    loginRemember.checked = isRemembered;
  }
  const regEmail = $("#regEmail");
  if (regEmail && rememberedEmail && !regEmail.value) {
    regEmail.value = rememberedEmail;
  }
  const regName = $("#regName");
  if (regName && rememberedName && !regName.value) {
    regName.value = rememberedName;
  }

  if (user && user.id) {
    updateAuthNavUI();
    renderImportedProfileBanner();

    // Silently synchronize profile & interview statistics with Cloud Firestore
    try {
      const res = await fetch(`${API}/api/auth/me?user_id=${encodeURIComponent(user.id)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.success && data.user) {
          localStorage.setItem("gr_auth_user", JSON.stringify(data.user));
          updateAuthNavUI();
        }
      }
    } catch (e) {
      // Offline fallback: existing local state remains active
    }
  }
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

  // If email is remembered, prefill loginEmail
  const remEmail = localStorage.getItem("gr_remembered_email");
  const loginEmail = $("#loginEmail");
  if (loginEmail && remEmail && !loginEmail.value) {
    loginEmail.value = remEmail;
  }
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
  if (isAuthSubmitting) return;

  const emailInput = $("#loginEmail");
  const pwdInput = $("#loginPassword");
  const errBanner = $("#loginErrorBanner");
  const errText = $("#loginErrorText");
  const btn = $("#submitLoginBtn");
  const rememberMe = $("#loginRememberMe")?.checked ?? true;

  const email = emailInput?.value.trim();
  const password = pwdInput?.value;

  if (!email || !password) {
    if (errBanner && errText) {
      errText.textContent = "Please enter both your email address and password.";
      errBanner.style.display = "flex";
    }
    return;
  }

  isAuthSubmitting = true;
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
    persistUserSession(user, rememberMe);
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
    isAuthSubmitting = false;
    if (btn) btn.disabled = false;
  }
}

async function handleManualRegister(e) {
  if (e) e.preventDefault();
  if (isAuthSubmitting) return;

  const name = $("#regName")?.value.trim();
  const email = $("#regEmail")?.value.trim();
  const password = $("#regPassword")?.value;
  const role = $("#regRole")?.value;
  const company = $("#regCompany")?.value;
  const level = $("#regLevel")?.value;
  const language = $("#regLanguage")?.value || "english";
  const rememberMe = $("#regRememberMe")?.checked ?? true;

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

  isAuthSubmitting = true;
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
    persistUserSession(user, rememberMe);
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
    isAuthSubmitting = false;
    if (btn) btn.disabled = false;
  }
}

/* -------------------------------------------------------------------------
   In-App Social Auth (Google, LinkedIn, GitHub) - No iframe-blocked prompts
   ------------------------------------------------------------------------- */
function openSocialAuthModal(provider) {
  currentSocialProvider = provider;
  closeAllModals();

  const modal = $("#socialAccountModal");
  if (!modal) return;

  const modalLogo = $("#socialModalLogo");
  const modalTitle = $("#socialModalTitle");
  const modalSubtitle = $("#socialModalSubtitle");
  const quickAvatar = $("#socialQuickAvatar");
  const quickName = $("#socialQuickName");
  const quickEmail = $("#socialQuickEmail");
  const quickBtnText = $("#socialQuickBtnText");
  const customName = $("#socialCustomName");
  const customEmail = $("#socialCustomEmail");
  const customForm = $("#socialCustomForm");
  const errBanner = $("#socialErrorBanner");

  if (errBanner) errBanner.style.display = "none";
  if (customForm) customForm.style.display = "none";

  const defaultName = state.candidateName || localStorage.getItem("gr_remembered_name") || localStorage.getItem("gr_user_name") || "Sangeeta Ojha";
  const rememberedEmail = localStorage.getItem("gr_remembered_email");

  if (provider === "google") {
    if (modalLogo) {
      modalLogo.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#EA4335" d="M12 5c1.6 0 3 .6 4.1 1.7l3.1-3.1C17.3 1.8 14.8 1 12 1 7.5 1 3.7 3.6 1.9 7.3l3.7 2.9C6.5 7.4 9 5 12 5z"/><path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.6h6.5c-.3 1.5-1.1 2.8-2.4 3.7l3.7 2.9c2.2-2 3.7-5 3.7-8.9z"/><path fill="#FBBC05" d="M5.6 14.8c-.2-.7-.4-1.5-.4-2.3s.2-1.6.4-2.3L1.9 7.3C.7 9.7 0 12.3 0 15.1s.7 5.4 1.9 7.8l3.7-2.9c-.2-.7-.4-1.5-.4-2.3z"/><path fill="#34A853" d="M12 23.5c3.2 0 6-1.1 8-3l-3.7-2.9c-1.1.7-2.5 1.2-4.3 1.2-3 0-5.5-2-6.4-4.8L1.9 16.9C3.7 20.6 7.5 23.5 12 23.5z"/></svg>`;
      modalLogo.style.background = "#fff";
    }
    if (modalTitle) modalTitle.textContent = "Sign in with Google";
    if (modalSubtitle) modalSubtitle.textContent = "Instant one-click authentication & profile sync.";
    const candidateEmail = rememberedEmail || "sangeetaojha36@gmail.com";

    if (quickName) quickName.textContent = defaultName;
    if (quickEmail) quickEmail.textContent = candidateEmail;
    if (quickAvatar) {
      quickAvatar.textContent = (defaultName.charAt(0) || "G").toUpperCase();
      quickAvatar.style.background = "#4285F4";
      quickAvatar.style.color = "#fff";
    }
    if (quickBtnText) quickBtnText.textContent = `Continue as ${defaultName.split(" ")[0]}`;

    if (customName) customName.value = defaultName;
    if (customEmail) customEmail.value = candidateEmail;

  } else if (provider === "linkedin") {
    if (modalLogo) {
      modalLogo.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#0A66C2" d="M19 3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14m-.5 15.5v-5.3a3.26 3.26 0 0 0-3.26-3.26c-.85 0-1.84.52-2.28 1.3v-1.11h-2.79v8.37h2.79v-4.93c0-.77.62-1.4 1.39-1.4a1.4 1.4 0 0 1 1.4 1.4v4.93h2.75M6.88 8.56a1.68 1.68 0 0 0 1.68-1.68c0-.93-.75-1.69-1.68-1.69a1.69 1.69 0 0 0-1.69 1.69c0 .93.76 1.68 1.69 1.68m1.39 9.94v-8.37H5.5v8.37h2.77z"/></svg>`;
      modalLogo.style.background = "#fff";
    }
    if (modalTitle) modalTitle.textContent = "Sign in with LinkedIn";
    if (modalSubtitle) modalSubtitle.textContent = "Professional pedigree, skills & interview benchmarks.";
    const candidateEmail = `${defaultName.toLowerCase().replace(/\s+/g, ".")}@linkedin.user`;

    if (quickName) quickName.textContent = defaultName;
    if (quickEmail) quickEmail.textContent = candidateEmail;
    if (quickAvatar) {
      quickAvatar.textContent = (defaultName.charAt(0) || "L").toUpperCase();
      quickAvatar.style.background = "#0A66C2";
      quickAvatar.style.color = "#fff";
    }
    if (quickBtnText) quickBtnText.textContent = `Continue with LinkedIn (${defaultName.split(" ")[0]})`;

    if (customName) customName.value = defaultName;
    if (customEmail) customEmail.value = candidateEmail;

  } else if (provider === "github") {
    if (modalLogo) {
      modalLogo.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22"><path fill="#f0f6fc" d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.87 1.52 2.34 1.07 2.91.83.1-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2z"/></svg>`;
      modalLogo.style.background = "#24292e";
    }
    if (modalTitle) modalTitle.textContent = "Sign in with GitHub";
    if (modalSubtitle) modalSubtitle.textContent = "Sync coding benchmarks, GitHub portfolio & target role.";
    const candidateEmail = `${defaultName.toLowerCase().replace(/\s+/g, "-")}@users.noreply.github.com`;

    if (quickName) quickName.textContent = defaultName;
    if (quickEmail) quickEmail.textContent = candidateEmail;
    if (quickAvatar) {
      quickAvatar.textContent = (defaultName.charAt(0) || "G").toUpperCase();
      quickAvatar.style.background = "#24292e";
      quickAvatar.style.color = "#fff";
    }
    if (quickBtnText) quickBtnText.textContent = `Continue with GitHub`;

    if (customName) customName.value = defaultName;
    if (customEmail) customEmail.value = candidateEmail;
  }

  modal.classList.add("open");
}

async function handleSocialQuickConfirm() {
  const name = $("#socialQuickName")?.textContent?.trim();
  const email = $("#socialQuickEmail")?.textContent?.trim();
  await executeSocialAuth({
    provider: currentSocialProvider,
    name: name || "Candidate",
    email: email || `${currentSocialProvider}@user.auth`,
    target_role: state.candidateRole || "Software Engineer",
    target_company: state.activeCompany?.name || "Google"
  });
}

async function handleSocialCustomSubmit(e) {
  if (e) e.preventDefault();
  const name = $("#socialCustomName")?.value?.trim();
  const email = $("#socialCustomEmail")?.value?.trim();
  const role = $("#socialCustomRole")?.value;
  const company = $("#socialCustomCompany")?.value;

  if (!name || !email) {
    const errBanner = $("#socialErrorBanner");
    const errText = $("#socialErrorText");
    if (errBanner && errText) {
      errText.textContent = "Name and Email/Username are required.";
      errBanner.style.display = "flex";
    }
    return;
  }

  await executeSocialAuth({
    provider: currentSocialProvider,
    name,
    email,
    target_role: role || "Software Engineer",
    target_company: company || "Google"
  });
}

async function executeSocialAuth({ provider, name, email, target_role, target_company }) {
  if (isAuthSubmitting) return;

  const errBanner = $("#socialErrorBanner");
  const errText = $("#socialErrorText");
  const quickBtn = $("#socialQuickConfirmBtn");
  const customBtn = $("#socialCustomSubmitBtn");
  const rememberMe = $("#socialRememberMe")?.checked ?? true;

  isAuthSubmitting = true;
  if (quickBtn) quickBtn.disabled = true;
  if (customBtn) customBtn.disabled = true;
  if (errBanner) errBanner.style.display = "none";

  toast(`Authenticating with ${provider.toUpperCase()}...`);

  try {
    const res = await fetch(`${API}/api/auth/social`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider,
        name,
        email,
        target_role: target_role || "Software Engineer",
        target_company: target_company || "Google",
        avatar: provider === "google" ? "https://lh3.googleusercontent.com/a/default-user=s96-c" : "",
        provider_id: `${provider}_${Date.now()}`
      })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      throw new Error(data.error || `${provider} authentication failed.`);
    }

    const user = data.user;
    persistUserSession(user, rememberMe);
    updateAuthNavUI();
    closeAllModals();
    toast(`✨ Signed in with ${provider.toUpperCase()} as ${user.display_name}!`);

    if (target_company && state.companies && state.companies.length) {
      const match = state.companies.find(c => c.name.toLowerCase() === target_company.toLowerCase() || c.id.toLowerCase() === target_company.toLowerCase());
      if (match) {
        state.activeCompany = match;
      }
    }

    refreshDbHistory();
  } catch(err) {
    if (errBanner && errText) {
      errText.textContent = err.message;
      errBanner.style.display = "flex";
    }
  } finally {
    isAuthSubmitting = false;
    if (quickBtn) quickBtn.disabled = false;
    if (customBtn) customBtn.disabled = false;
  }
}

function openLogoutConfirmModal() {
  const modal = $("#logoutConfirmModal");
  if (modal) modal.classList.add("open");
}

function handleLogout() {
  localStorage.removeItem("gr_auth_token");
  localStorage.removeItem("gr_auth_user");
  localStorage.removeItem("gr_user_id");
  localStorage.removeItem("gr_user_name");

  state.userId = "default_user";
  state.candidateName = "";
  closeAllModals();
  updateAuthNavUI();
  toast("Signed out successfully. Profile data remains saved in Cloud Firestore.");
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
  renderImportedProfileBanner();
  checkHashForSharedReport();
  restoreUserSession();
  initEventListeners();
});
