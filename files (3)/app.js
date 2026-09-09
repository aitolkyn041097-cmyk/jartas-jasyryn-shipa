/* =========================================================
   ЖАРТАСТАҒЫ ЖАСЫРЫН ШИПА — қолданба логикасы
   ========================================================= */

const LS_KEY = 'jjs_responses_v1';

const state = {
  view: 'home',
  stepIndex: 0,
  answers: {},
  charts: {},
  firebaseReady: false,
  db: null,
};

/* ---------------- Firebase (орталық дерекқор) ---------------- */
function initFirebase() {
  try {
    const configured = FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.includes('ЖАЗЫҢЫЗ');
    if (!configured || typeof firebase === 'undefined') {
      state.firebaseReady = false;
      updateDbStatus();
      return;
    }
    firebase.initializeApp(FIREBASE_CONFIG);
    state.db = firebase.firestore();
    state.firebaseReady = true;
  } catch (err) {
    console.error('Firebase init error:', err);
    state.firebaseReady = false;
  }
  updateDbStatus();
}

function updateDbStatus() {
  const el = document.getElementById('db-status');
  if (!el) return;
  if (state.firebaseReady) {
    el.innerHTML = '🟢 Орталық база қосылған — барлық қатысушының жауабы бір жерге жиналады';
    el.classList.add('db-on');
  } else {
    el.innerHTML = '🟡 Орталық база қосылмаған — жауаптар тек осы құрылғыда сақталады (config.js файлын толтырыңыз)';
    el.classList.remove('db-on');
  }
}

/* ---------------- деректер қабаты: Firestore немесе LocalStorage ---------------- */
async function getAllResponses() {
  if (state.firebaseReady) {
    try {
      const snap = await state.db.collection(FIREBASE_COLLECTION).get();
      return snap.docs.map(d => Object.assign({ _id: d.id }, d.data()));
    } catch (err) {
      console.error('Firestore оқу қатесі:', err);
      toast('Орталық базадан оқу мүмкін болмады, жергілікті деректер көрсетілуде', '⚠️');
      return loadLocalResponses();
    }
  }
  return loadLocalResponses();
}

async function addResponseRecord(record) {
  // әрқашан жергілікті көшірме сақтаймыз (офлайн сақтық көшірме ретінде)
  const local = loadLocalResponses();
  local.push(record);
  saveLocalResponses(local);

  if (state.firebaseReady) {
    try {
      await state.db.collection(FIREBASE_COLLECTION).add(record);
    } catch (err) {
      console.error('Firestore жазу қатесі:', err);
      toast('Орталық базаға жіберілмеді, жауап осы құрылғыда сақталды', '⚠️');
    }
  }
}

async function clearAllResponses() {
  saveLocalResponses([]);
  if (state.firebaseReady) {
    try {
      const snap = await state.db.collection(FIREBASE_COLLECTION).get();
      const batchSize = 400;
      const docs = snap.docs;
      for (let i = 0; i < docs.length; i += batchSize) {
        const batch = state.db.batch();
        docs.slice(i, i + batchSize).forEach(d => batch.delete(d.ref));
        await batch.commit();
      }
    } catch (err) {
      console.error('Firestore тазалау қатесі:', err);
      toast('Орталық базаны тазалау мүмкін болмады', '⚠️');
    }
  }
}

async function addManyResponses(records) {
  const local = loadLocalResponses();
  saveLocalResponses(local.concat(records));
  if (state.firebaseReady) {
    try {
      const batchSize = 400;
      for (let i = 0; i < records.length; i += batchSize) {
        const batch = state.db.batch();
        records.slice(i, i + batchSize).forEach(r => {
          const ref = state.db.collection(FIREBASE_COLLECTION).doc();
          batch.set(ref, r);
        });
        await batch.commit();
      }
    } catch (err) {
      console.error('Firestore топтап жазу қатесі:', err);
      toast('Демо деректер орталық базаға толық жазылмады', '⚠️');
    }
  }
}

function loadLocalResponses() {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch (e) { return []; }
}
function saveLocalResponses(arr) {
  localStorage.setItem(LS_KEY, JSON.stringify(arr));
}

/* ---------------- toast ---------------- */
function toast(msg, icon) {
  const wrap = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span>${icon || '✓'}</span><span>${msg}</span>`;
  wrap.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateY(8px)'; el.style.transition = '.3s'; }, 2400);
  setTimeout(() => el.remove(), 2800);
}

/* ---------------- ripple ---------------- */
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.btn, .opt, .type-card');
  if (!btn) return;
  const rect = btn.getBoundingClientRect();
  const r = document.createElement('span');
  const size = Math.max(rect.width, rect.height) * 1.6;
  r.className = 'ripple';
  r.style.width = r.style.height = size + 'px';
  r.style.left = (e.clientX - rect.left - size / 2) + 'px';
  r.style.top = (e.clientY - rect.top - size / 2) + 'px';
  btn.style.position = btn.style.position || 'relative';
  btn.appendChild(r);
  setTimeout(() => r.remove(), 650);
});

/* ---------------- navigation between views ---------------- */
function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById('view-' + name).classList.add('active');
  document.querySelectorAll('.nav-links button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  state.view = name;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  document.getElementById('nav-links').classList.remove('open');
  if (name === 'results') renderDashboard();
}

function startSurvey() {
  state.stepIndex = 0;
  state.answers = {};
  document.getElementById('done-screen').style.display = 'none';
  document.getElementById('survey-card-body').style.display = 'block';
  switchView('survey');
  renderStep();
}

/* ---------------- survey engine ---------------- */
function currentSteps() {
  return buildSteps(state.answers);
}

function renderStep() {
  const steps = currentSteps();
  if (state.stepIndex >= steps.length) { finishSurvey(); return; }
  const step = steps[state.stepIndex];
  const total = steps.length;
  const pct = Math.round(((state.stepIndex) / total) * 100);

  document.getElementById('survey-counter').textContent = `${state.stepIndex + 1}/${total} сұрақ`;
  document.getElementById('progress-fill').style.width = pct + '%';
  document.getElementById('progress-pct').textContent = pct + '%';

  const qWrap = document.getElementById('q-wrap');
  qWrap.style.opacity = '0';
  qWrap.style.transform = 'translateY(10px)';

  let html = `<div class="q-title">${step.title}</div>`;
  if (step.hint) html += `<div class="q-hint">${step.hint}</div>`;

  const val = state.answers[step.key];

  if (step.type === 'type') {
    html += `<div class="type-grid">` + PARTICIPANT_TYPES.map(t => `
      <div class="type-card ${val === t.id ? 'selected' : ''}" onclick="selectType('${t.id}')">
        <span class="icon">${t.icon}</span>
        <div class="name">${t.name}</div>
      </div>`).join('') + `</div>`;
  } else if (step.type === 'single') {
    html += `<div class="opt-grid">` + step.options.map((o, i) => `
      <div class="opt ${val === o ? 'selected' : ''}" onclick="selectSingle('${step.key}','${escAttr(o)}')">
        <span class="mark"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.4-1.4z"/></svg></span>
        <span class="label">${o}</span>
      </div>`).join('') + `</div>`;
  } else if (step.type === 'multi') {
    const arr = val || [];
    html += `<div class="opt-grid">` + step.options.map((o, i) => `
      <div class="opt checkbox ${arr.includes(o) ? 'selected' : ''}" onclick="toggleMulti('${step.key}','${escAttr(o)}')">
        <span class="mark"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 16.2l-3.5-3.5L4 14.2l5 5 11-11-1.4-1.4z"/></svg></span>
        <span class="label">${o}</span>
      </div>`).join('') + `</div>`;
  } else if (step.type === 'text') {
    html += `<input class="field-text" id="field-input" type="text" value="${escAttr(val || '')}" placeholder="${step.placeholder || ''}" oninput="setText('${step.key}', this.value)" />`;
  } else if (step.type === 'textarea') {
    html += `<textarea class="field-textarea" id="field-input" placeholder="${step.placeholder || ''}" oninput="setText('${step.key}', this.value)">${val || ''}</textarea>`;
  } else if (step.type === 'rating') {
    const r = val || 0;
    html += `<div class="rating">` + [1, 2, 3, 4, 5].map(n => `
      <button type="button" class="${n <= r ? 'active' : ''}" onclick="setRating('${step.key}', ${n})" aria-label="${n} жұлдыз">★</button>`).join('') + `</div>`;
  }

  qWrap.innerHTML = html;
  requestAnimationFrame(() => {
    qWrap.style.transition = 'opacity .35s ease, transform .35s ease';
    qWrap.style.opacity = '1';
    qWrap.style.transform = 'translateY(0)';
  });

  document.getElementById('btn-prev').disabled = state.stepIndex === 0;
  document.getElementById('btn-next').textContent = (state.stepIndex === total - 1) ? 'Аяқтау' : 'Келесі';
  updateNextEnabled(step);
}

function escAttr(s) { return String(s).replace(/'/g, "&#39;").replace(/"/g, '&quot;'); }

function stepIsAnswered(step) {
  const v = state.answers[step.key];
  if (step.type === 'multi') return Array.isArray(v) && v.length > 0;
  if (step.type === 'text' || step.type === 'textarea') return true; // optional
  if (step.type === 'rating') return true; // optional nuance, but encouraged
  return v !== undefined && v !== null && v !== '';
}

function updateNextEnabled(step) {
  document.getElementById('btn-next').disabled = !stepIsAnswered(step);
}

function selectType(id) {
  state.answers.q_type = id;
  updateNextEnabled(currentSteps()[state.stepIndex]);
  renderStep();
}
function selectSingle(key, val) {
  state.answers[key] = val;
  renderStep();
}
function toggleMulti(key, val) {
  const arr = state.answers[key] || [];
  const i = arr.indexOf(val);
  if (i > -1) arr.splice(i, 1); else arr.push(val);
  state.answers[key] = arr;
  renderStep();
}
function setText(key, val) {
  state.answers[key] = val;
  updateNextEnabled(currentSteps()[state.stepIndex]);
}
function setRating(key, n) {
  state.answers[key] = n;
  renderStep();
}

function nextStep() {
  const steps = currentSteps();
  if (!stepIsAnswered(steps[state.stepIndex])) return;
  state.stepIndex++;
  if (state.stepIndex >= steps.length) { finishSurvey(); return; }
  renderStep();
}
function prevStep() {
  if (state.stepIndex === 0) return;
  state.stepIndex--;
  renderStep();
}

async function finishSurvey() {
  const record = Object.assign({}, state.answers, { _ts: new Date().toISOString() });

  document.getElementById('survey-card-body').style.display = 'none';
  const done = document.getElementById('done-screen');
  done.style.display = 'block';
  launchConfetti();

  await addResponseRecord(record);
  toast(state.firebaseReady ? 'Жауабыңыз орталық базаға жіберілді' : 'Жауабыңыз осы құрылғыда сақталды', '🎉');
}

/* ---------------- confetti ---------------- */
function launchConfetti() {
  const colors = ['#c8a24a', '#e0bd6a', '#8a5a34', '#f3efe4', '#7fae7a'];
  const host = document.getElementById('done-screen');
  for (let i = 0; i < 60; i++) {
    const p = document.createElement('div');
    p.className = 'confetti-piece';
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDuration = (2 + Math.random() * 1.6) + 's';
    p.style.animationDelay = (Math.random() * 0.4) + 's';
    host.appendChild(p);
    setTimeout(() => p.remove(), 4200);
  }
}

/* ================= ДАШБОРД ================= */
const GROUP_LABELS = { auyl: 'Ауыл тұрғыны', oqushy: 'Мектеп оқушысы', mugalim: 'Мұғалім' };

function count(arr, fn) { return arr.reduce((s, x) => s + (fn(x) ? 1 : 0), 0); }
function tally(arr, key) {
  const m = {};
  arr.forEach(r => {
    const v = r[key];
    if (v === undefined || v === null || v === '') return;
    if (Array.isArray(v)) v.forEach(x => m[x] = (m[x] || 0) + 1);
    else m[v] = (m[v] || 0) + 1;
  });
  return m;
}

async function renderDashboard() {
  const empty = document.getElementById('dash-empty');
  const body = document.getElementById('dash-body');
  empty.querySelector('h3') && (empty.querySelector('h3').textContent = 'Жүктелуде...');
  const data = await getAllResponses();
  if (!data.length) {
    empty.querySelector('h3') && (empty.querySelector('h3').textContent = 'Әзірге дерек жоқ');
    empty.style.display = 'block';
    body.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  body.style.display = 'block';

  const total = data.length;
  const nAuyl = count(data, r => r.q_type === 'auyl');
  const nOqushy = count(data, r => r.q_type === 'oqushy');
  const nMugalim = count(data, r => r.q_type === 'mugalim');

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-auyl').textContent = nAuyl;
  document.getElementById('stat-oqushy').textContent = nOqushy;
  document.getElementById('stat-mugalim').textContent = nMugalim;

  drawGroupPie(data, nAuyl, nOqushy, nMugalim);
  drawHeardBar(data);
  drawSourceDoughnut(data);
  drawUsedBar(data);
  drawResearchNeedBar(data);
  drawAgeChart(data);
  renderAIAnalysis(data, { total, nAuyl, nOqushy, nMugalim });
}

const CHART_PALETTE = ['#c8a24a', '#e0bd6a', '#8a5a34', '#7fae7a', '#5b6779', '#cfc9ba'];
const CHART_TEXT = '#f3efe4';
const CHART_GRID = 'rgba(243,239,228,0.08)';

function destroyChart(id) {
  if (state.charts[id]) { state.charts[id].destroy(); delete state.charts[id]; }
}

function baseOptions(extra) {
  return Object.assign({
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { labels: { color: CHART_TEXT, font: { family: 'Manrope' } } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const val = ctx.parsed.y ?? ctx.parsed.x ?? ctx.parsed;
            const dataset = ctx.dataset.data;
            const sum = dataset.reduce((a, b) => a + b, 0);
            const pct = sum ? Math.round((ctx.raw / sum) * 100) : 0;
            return `${ctx.label || ctx.dataset.label}: ${ctx.raw} (${pct}%)`;
          }
        }
      }
    }
  }, extra || {});
}

function drawGroupPie(data, nAuyl, nOqushy, nMugalim) {
  destroyChart('pie');
  const ctx = document.getElementById('chart-pie');
  state.charts.pie = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: ['Ауыл тұрғыны', 'Мектеп оқушысы', 'Мұғалім'],
      datasets: [{ data: [nAuyl, nOqushy, nMugalim], backgroundColor: CHART_PALETTE, borderColor: '#142235', borderWidth: 2 }]
    },
    options: baseOptions()
  });
}

function drawHeardBar(data) {
  destroyChart('heard');
  const t = tally(data, 'q1_heard');
  const ctx = document.getElementById('chart-heard');
  state.charts.heard = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Иә', 'Жоқ'],
      datasets: [{ label: 'Қатысушы саны', data: [t['Иә'] || 0, t['Жоқ'] || 0], backgroundColor: [CHART_PALETTE[0], CHART_PALETTE[4]], borderRadius: 8 }]
    },
    options: baseOptions({
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CHART_TEXT }, grid: { color: CHART_GRID } },
        y: { beginAtZero: true, ticks: { color: CHART_TEXT, precision: 0 }, grid: { color: CHART_GRID } }
      }
    })
  });
}

function drawSourceDoughnut(data) {
  destroyChart('source');
  const t = tally(data, 'q2_source');
  const labels = Object.keys(t);
  const ctx = document.getElementById('chart-source');
  state.charts.source = new Chart(ctx, {
    type: 'doughnut',
    data: { labels, datasets: [{ data: labels.map(l => t[l]), backgroundColor: CHART_PALETTE.concat(['#3d4a5e', '#9c7b3e']), borderColor: '#142235', borderWidth: 2 }] },
    options: baseOptions()
  });
}

function drawUsedBar(data) {
  destroyChart('used');
  const t = tally(data, 'q7_used');
  const ctx = document.getElementById('chart-used');
  state.charts.used = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Иә, қолданған', 'Жоқ, қолданбаған'],
      datasets: [{ label: 'Қатысушы саны', data: [t['Иә'] || 0, t['Жоқ'] || 0], backgroundColor: [CHART_PALETTE[1], CHART_PALETTE[4]], borderRadius: 8 }]
    },
    options: baseOptions({
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CHART_TEXT }, grid: { color: CHART_GRID } },
        y: { beginAtZero: true, ticks: { color: CHART_TEXT, precision: 0 }, grid: { color: CHART_GRID } }
      }
    })
  });
}

function drawResearchNeedBar(data) {
  destroyChart('research');
  const t = tally(data, 'q10_research_need');
  const labels = ['Өте қажет', 'Қажет', 'Білмеймін', 'Қажет емес'];
  const ctx = document.getElementById('chart-research');
  state.charts.research = new Chart(ctx, {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Қатысушы саны', data: labels.map(l => t[l] || 0), backgroundColor: CHART_PALETTE, borderRadius: 8 }] },
    options: baseOptions({
      indexAxis: 'y',
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, ticks: { color: CHART_TEXT, precision: 0 }, grid: { color: CHART_GRID } },
        y: { ticks: { color: CHART_TEXT }, grid: { color: CHART_GRID } }
      }
    })
  });
}

function drawAgeChart(data) {
  destroyChart('age');
  const t = tally(data, 'age');
  const ctx = document.getElementById('chart-age');
  state.charts.age = new Chart(ctx, {
    type: 'bar',
    data: { labels: AGE_OPTIONS, datasets: [{ label: 'Қатысушы саны', data: AGE_OPTIONS.map(l => t[l] || 0), backgroundColor: CHART_PALETTE[0], borderRadius: 8 }] },
    options: baseOptions({
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: CHART_TEXT }, grid: { color: CHART_GRID } },
        y: { beginAtZero: true, ticks: { color: CHART_TEXT, precision: 0 }, grid: { color: CHART_GRID } }
      }
    })
  });
}

/* ---------------- AI ДЕМО ТАЛДАУЫ ---------------- */
function renderAIAnalysis(data, meta) {
  const heard = tally(data, 'q1_heard');
  const heardPct = meta.total ? Math.round(((heard['Иә'] || 0) / meta.total) * 100) : 0;
  const used = tally(data, 'q7_used');
  const usedPct = meta.total ? Math.round(((used['Иә'] || 0) / meta.total) * 100) : 0;
  const research = tally(data, 'q10_research_need');
  const wantResearchPct = meta.total ? Math.round((((research['Өте қажет'] || 0) + (research['Қажет'] || 0)) / meta.total) * 100) : 0;

  const oqushyData = data.filter(r => r.q_type === 'oqushy');
  const mugalimData = data.filter(r => r.q_type === 'mugalim');
  const auylData = data.filter(r => r.q_type === 'auyl');

  const oqushyHeard = oqushyData.length ? Math.round((count(oqushyData, r => r.q1_heard === 'Иә') / oqushyData.length) * 100) : null;
  const mugalimHeard = mugalimData.length ? Math.round((count(mugalimData, r => r.q1_heard === 'Иә') / mugalimData.length) * 100) : null;
  const auylUsed = auylData.length ? Math.round((count(auylData, r => r.q7_used === 'Иә') / auylData.length) * 100) : null;

  let text = `Сауалнама нәтижелері бойынша қатысушылардың ${heardPct}% тастың майы туралы естіген, ал ${usedPct}% оны нақты қолданып көрген. `;
  text += `Алайда оның табиғи құрамы мен ғылыми ерекшеліктері туралы нақты ақпарат деңгейі әлі де толық қалыптаспаған болуы мүмкін. `;
  if (oqushyHeard !== null && mugalimHeard !== null) {
    text += `Оқушылар тобында хабардарлық ${oqushyHeard}% деңгейінде, ал мұғалімдер арасында ${mugalimHeard}% құрайды — бұл екі топ арасындағы білім алшақтығын көрсетеді. `;
  }
  if (auylUsed !== null) {
    text += `Ауыл тұрғындарының ${auylUsed}% тастың майын дәстүрлі тәжірибеде қолданғанын атап өткен, бұл өңірде осы табиғи ресурстың халықтық медицинада алатын орны маңызды екенін дәлелдейді. `;
  }
  text += `Қатысушылардың ${wantResearchPct}% табиғи өнімдерді ғылыми тұрғыдан зерттеуді қажет немесе өте қажет деп санайды, бұл жобаның зертханалық талдау бағытын жалғастыруға негіз береді.`;

  document.getElementById('ai-analysis-text').textContent = text;
}

/* ---------------- демо деректер ---------------- */
async function generateDemoData() {
  if (state.firebaseReady) {
    const ok = confirm('Назар аударыңыз: орталық база қосулы. Демо деректер ОРТАЛЫҚ базаға да жазылады (нағыз жауаптармен араласады). Тек сынақ мақсатында жалғастырасыз ба?');
    if (!ok) return;
  }
  const sources = ['Ата-анамнан', 'Ата-әжелерден', 'Ауыл тұрғындарынан', 'Интернеттен', 'Әлеуметтік желіден', 'Мектептен'];
  const purposes = ['Халық медицинасында', 'Тері күтімінде', 'Шаш күтімінде', 'Жалпы денсаулықты қолдау мақсатында', 'Білмеймін'];
  const types = ['auyl', 'oqushy', 'mugalim'];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const pickMulti = (arr) => arr.filter(() => Math.random() > 0.55).length ? arr.filter(() => Math.random() > 0.55) : [pick(arr)];

  const records = [];
  for (let i = 0; i < 40; i++) {
    const type = pick(types);
    const heard = Math.random() > 0.25 ? 'Иә' : 'Жоқ';
    const used = heard === 'Иә' && Math.random() > 0.45 ? 'Иә' : 'Жоқ';
    records.push({
      _demo: true,
      _ts: new Date().toISOString(),
      q_type: type,
      age: pick(AGE_OPTIONS),
      gender: pick(GENDER_OPTIONS),
      location: type === 'auyl' ? 'Катонқарағай ауданы' : 'Өскемен қаласы',
      q1_heard: heard,
      q2_source: pickMulti(sources),
      q3_what: pick(['Табиғи минералды зат', 'Дәрілік зат', 'Халық медицинасында қолданылатын табиғи өнім', 'Нақты білмеймін']),
      q4_seen: Math.random() > 0.4 ? 'Иә' : 'Жоқ',
      q5_know_users: Math.random() > 0.3 ? 'Иә' : 'Жоқ',
      q6_purpose: pickMulti(purposes),
      q7_used: used,
      q8_used_purpose: used === 'Иә' ? 'Тері күтіміне' : undefined,
      q9_experience: used === 'Иә' ? 1 + Math.floor(Math.random() * 5) : undefined,
      q10_research_need: pick(['Өте қажет', 'Қажет', 'Білмеймін', 'Қажет емес']),
      q11_students_research: pick(['Иә', 'Жоқ', 'Білмеймін']),
      q12_lab_analysis: pick(['Иә', 'Жоқ', 'Міндетті түрде қажет']),
      q13_want_more: pick(['Иә', 'Жоқ']),
      q14_what_info: '',
    });
  }
  await addManyResponses(records);
  toast('Демо деректер қосылды', '🧪');
  renderDashboard();
}

async function clearAllData() {
  const msg = state.firebaseReady
    ? 'Барлық сақталған сауалнама деректерін ОРТАЛЫҚ БАЗАДАН да, осы құрылғыдан да өшіргіңіз келе ме? Бұл әрекетті қайтару мүмкін емес.'
    : 'Барлық сақталған сауалнама деректерін өшіргіңіз келе ме? Бұл әрекетті қайтару мүмкін емес.';
  if (!confirm(msg)) return;
  await clearAllResponses();
  toast('Деректер тазаланды', '🗑️');
  renderDashboard();
}

/* ---------------- экспорт: JSON / CSV / PDF ---------------- */
async function exportJSON() {
  const data = await getAllResponses();
  if (!data.length) { toast('Экспорттауға дерек жоқ', '⚠️'); return; }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  downloadBlob(blob, 'zhartastagy-jasyryn-shipa-nәtijeler.json');
  toast('JSON файлы жүктелді', '📥');
}

async function exportCSV() {
  const data = await getAllResponses();
  if (!data.length) { toast('Экспорттауға дерек жоқ', '⚠️'); return; }
  const cols = Array.from(data.reduce((set, r) => { Object.keys(r).forEach(k => set.add(k)); return set; }, new Set()));
  const esc = (v) => {
    if (v === undefined || v === null) return '';
    const s = Array.isArray(v) ? v.join('; ') : String(v);
    return '"' + s.replace(/"/g, '""') + '"';
  };
  const rows = [cols.join(',')].concat(data.map(r => cols.map(c => esc(r[c])).join(',')));
  const blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(blob, 'zhartastagy-jasyryn-shipa-nәtijeler.csv');
  toast('CSV файлы жүктелді', '📊');
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

async function exportPDF() {
  const data = await getAllResponses();
  if (!data.length) { toast('Экспорттауға дерек жоқ', '⚠️'); return; }
  toast('PDF есеп дайындалуда...', '⏳');
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'pt', 'a4');
    const pageW = doc.internal.pageSize.getWidth();
    let y = 50;

    doc.setFontSize(18);
    doc.text('Zhartastagy Jasyryn Shipa', pageW / 2, y, { align: 'center' }); y += 22;
    doc.setFontSize(11);
    doc.text('Gylymi-zertteu jobasy - saualnama esebi', pageW / 2, y, { align: 'center' }); y += 30;

    const total = data.length;
    const nAuyl = count(data, r => r.q_type === 'auyl');
    const nOqushy = count(data, r => r.q_type === 'oqushy');
    const nMugalim = count(data, r => r.q_type === 'mugalim');

    doc.setFontSize(12);
    doc.text(`Qatysushylar sany: ${total}`, 50, y); y += 18;
    doc.text(`Auyl turgyny: ${nAuyl}    Oqushy: ${nOqushy}    Mugalim: ${nMugalim}`, 50, y); y += 26;

    const heard = tally(data, 'q1_heard');
    const used = tally(data, 'q7_used');
    doc.text(`"Tastyn' mayy" turaly estigender: ${heard['Иә'] || 0} / ${total}`, 50, y); y += 18;
    doc.text(`Qoldangandar sany: ${used['Иә'] || 0} / ${total}`, 50, y); y += 30;

    doc.setFontSize(14);
    doc.text('Diagrammalar:', 50, y); y += 14;

    const chartIds = ['chart-pie', 'chart-heard', 'chart-source', 'chart-used', 'chart-research', 'chart-age'];
    for (const id of chartIds) {
      const el = document.getElementById(id);
      if (!el) continue;
      const canvasImg = await html2canvas(el.closest('.chart-card'), { backgroundColor: '#142235', scale: 2 });
      const imgData = canvasImg.toDataURL('image/png');
      const imgW = pageW - 100;
      const imgH = imgW * (canvasImg.height / canvasImg.width);
      if (y + imgH > 780) { doc.addPage(); y = 50; }
      doc.addImage(imgData, 'PNG', 50, y, imgW, imgH);
      y += imgH + 16;
    }

    doc.save('zhartastagy-jasyryn-shipa-esep.pdf');
    toast('PDF есеп жүктелді', '📄');
  } catch (err) {
    console.error(err);
    toast('PDF жасау кезінде қате шықты', '⚠️');
  }
}

/* ================= ФОН: ТАУ + ТҰМАН БӨЛШЕКТЕРІ ================= */
function initFogCanvas() {
  const canvas = document.getElementById('bg-canvas');
  const ctx = canvas.getContext('2d');
  let w, h, particles;

  function resize() {
    w = canvas.width = window.innerWidth;
    h = canvas.height = window.innerHeight;
  }
  function makeParticles() {
    const n = Math.min(40, Math.floor(w / 40));
    particles = Array.from({ length: n }, () => ({
      x: Math.random() * w,
      y: h * 0.35 + Math.random() * h * 0.6,
      r: 60 + Math.random() * 140,
      speed: 0.06 + Math.random() * 0.15,
      alpha: 0.02 + Math.random() * 0.035,
    }));
  }
  resize(); makeParticles();
  window.addEventListener('resize', () => { resize(); makeParticles(); });

  function frame() {
    ctx.clearRect(0, 0, w, h);
    particles.forEach(p => {
      p.x += p.speed;
      if (p.x - p.r > w) p.x = -p.r;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
      g.addColorStop(0, `rgba(200,190,170,${p.alpha})`);
      g.addColorStop(1, 'rgba(200,190,170,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    });
    requestAnimationFrame(frame);
  }
  frame();
}

/* ---------------- параллакс hero ---------------- */
function initParallax() {
  const layers = document.querySelectorAll('[data-parallax]');
  window.addEventListener('scroll', () => {
    const sc = window.scrollY;
    layers.forEach(l => {
      const speed = parseFloat(l.dataset.parallax);
      l.style.transform = `translateY(${sc * speed}px)`;
    });
  }, { passive: true });
}

/* ---------------- init ---------------- */
document.addEventListener('DOMContentLoaded', async () => {
  initFogCanvas();
  initParallax();
  initFirebase();

  document.querySelectorAll('.nav-links button[data-view]').forEach(btn => {
    btn.addEventListener('click', () => switchView(btn.dataset.view));
  });
  document.getElementById('nav-toggle').addEventListener('click', () => {
    document.getElementById('nav-links').classList.toggle('open');
  });

  document.getElementById('btn-next').addEventListener('click', nextStep);
  document.getElementById('btn-prev').addEventListener('click', prevStep);

  const refreshBtn = document.getElementById('btn-refresh-dash');
  if (refreshBtn) refreshBtn.addEventListener('click', renderDashboard);

  // Hero stat strip (based on already-saved responses, if any)
  const data = await getAllResponses();
  document.getElementById('hero-stat-total').textContent = data.length;
  document.getElementById('hero-stat-auyl').textContent = count(data, r => r.q_type === 'auyl');
  document.getElementById('hero-stat-oqushy').textContent = count(data, r => r.q_type === 'oqushy');
  document.getElementById('hero-stat-mugalim').textContent = count(data, r => r.q_type === 'mugalim');

  switchView('home');
});
