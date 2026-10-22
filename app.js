import { simulate, DEFAULTS, SCENARIOS } from './sim.js';

const state = { ...DEFAULTS };

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

function fmtMin(min) {
  if (!Number.isFinite(min) || min <= 0) return '0 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}

function fmtInt(n) {
  return Math.round(n).toLocaleString('it-IT');
}

function fmtDec(n) {
  return n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

// Legge i cursori e i bottoni nello stato.
function syncControls() {
  $$('[data-param]').forEach((input) => {
    const key = input.dataset.param;
    const v = Number(input.value);
    // Il cursore del rifiuto è in percentuale, il modello lavora con la frazione.
    state[key] = key === 'rejectRate' ? v / 100 : v;
    const out = document.querySelector(`[data-out="${key}"]`);
    if (out) out.textContent = key === 'rejectRate' ? `${v}%` : String(v);
  });
  $$('[data-scenario]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.scenario === state.scenario)));
  $$('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === state.mode)));
  $('#scenario-note').textContent = SCENARIOS[state.scenario].note;
}

function kpiTiles(kpi) {
  const tiles = [
    { label: 'Attesa media al cancello', value: fmtMin(kpi.gateWaitAvg), note: `massima ${fmtMin(kpi.gateWaitMax)}` },
    { label: 'Coda massima al cancello', value: `${kpi.gateQueueMax} camion`, note: 'nel momento più affollato' },
    { label: 'Dall’arrivo allo scarico', value: fmtMin(kpi.dockWaitAvg), note: `massimo ${fmtMin(kpi.dockWaitMax)}` },
    { label: 'Linea senza prodotto', value: `${fmtDec(kpi.starvedHours)} h`, note: 'con la linea accesa' },
    { label: 'Carichi rifiutati', value: `${kpi.rejected}`, note: `${fmtDec(kpi.rejectedShare * 100)}% dei camion` },
    { label: 'Tonnellate lavorate', value: fmtInt(kpi.processedTons), note: 'in due giornate' },
  ];
  return tiles
    .map((t) => `<div class="kpi pop"><p class="kpi-value">${t.value}</p><div><p class="kpi-label">${t.label}</p><p class="kpi-note">${t.note}</p></div></div>`)
    .join('');
}

function drawTanks(result) {
  const svg = $('#tanks');
  const n = result.params.tanks;
  const cap = result.params.tankCap;
  const last = result.series[result.series.length - 1];
  const r = 50;
  const gap = 600 / n;
  const cx = (i) => gap * i + gap / 2;
  const cy = 75;
  // Lo stato delle vasche nel momento in cui sono più piene.
  const peakSeries = result.series.reduce((best, s) => {
    const sum = s.tanks.reduce((a, b) => a + b, 0);
    return sum > best.sum ? { sum, s } : best;
  }, { sum: -1, s: last });
  const levels = peakSeries.s.tanks;
  let html = '';
  levels.forEach((level, i) => {
    const id = `clip-${i}`;
    const fill = Math.max(0, Math.min(1, level));
    const top = cy + r - fill * 2 * r;
    html += `<clipPath id="${id}"><circle cx="${cx(i)}" cy="${cy}" r="${r}"/></clipPath>`;
    html += `<circle cx="${cx(i)}" cy="${cy}" r="${r}" class="tank-bg"/>`;
    html += `<rect x="${cx(i) - r}" y="${top}" width="${2 * r}" height="${fill * 2 * r}" class="tank-fill" clip-path="url(#${id})"/>`;
    const labelClass = fill > 0.5 ? 'tank-label on-fill' : 'tank-label';
    html += `<text x="${cx(i)}" y="${cy + 7}" text-anchor="middle" class="${labelClass}">${Math.round(fill * 100)}%</text>`;
    html += `<text x="${cx(i)}" y="146" text-anchor="middle" class="tank-cap">${Math.round(cap)} t</text>`;
  });
  svg.innerHTML = html;
}

function drawChart(result) {
  const svg = $('#chart');
  const W = 600;
  const H = 180;
  const pad = 24;
  const series = result.series;
  const maxY = Math.max(5, ...series.map((s) => Math.max(s.queue, s.waiting)));
  const x = (t) => pad + (t / (series[series.length - 1].t || 1)) * (W - 2 * pad);
  const y = (v) => H - pad - (v / maxY) * (H - 2 * pad);
  const line = (key) => series.map((s) => `${x(s.t).toFixed(1)},${y(s[key]).toFixed(1)}`).join(' ');
  // Ore sull’asse
  let ticks = '';
  const lastHour = series[series.length - 1].t / 60;
  for (let h = 0; h <= lastHour; h += 6) {
    const tx = x(h * 60);
    ticks += `<line x1="${tx}" y1="${H - pad}" x2="${tx}" y2="${H - pad + 4}" class="axis"/>`;
    ticks += `<text x="${tx}" y="${H - 6}" text-anchor="middle" class="axis-label">${h}h</text>`;
  }
  svg.innerHTML = `
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" class="axis"/>
    ${ticks}
    <polyline points="${line('waiting')}" class="line-dock"/>
    <polyline points="${line('queue')}" class="line-queue"/>
    <text x="${pad}" y="${pad - 8}" class="axis-label">${maxY}</text>`;
}

function renderCompare(scenario) {
  const free = simulate({ ...state, mode: 'libero', scenario }).kpi;
  const plan = simulate({ ...state, mode: 'piano', scenario }).kpi;
  const rows = [
    ['Attesa media al cancello', fmtMin(free.gateWaitAvg), fmtMin(plan.gateWaitAvg)],
    ['Coda massima al cancello', `${free.gateQueueMax}`, `${plan.gateQueueMax}`],
    ['Dall’arrivo allo scarico (media)', fmtMin(free.dockWaitAvg), fmtMin(plan.dockWaitAvg)],
    ['Dall’arrivo allo scarico (massimo)', fmtMin(free.dockWaitMax), fmtMin(plan.dockWaitMax)],
    ['Linea senza prodotto', `${fmtDec(free.starvedHours)} h`, `${fmtDec(plan.starvedHours)} h`],
    ['Tonnellate lavorate', fmtInt(free.processedTons), fmtInt(plan.processedTons)],
  ];
  $('#compare').innerHTML = `
    <thead><tr><th scope="col">Indicatore</th><th scope="col">Come oggi</th><th scope="col">Slot</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><th scope="row">${r[0]}</th><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('')}</tbody>`;
}

function render() {
  syncControls();
  const result = simulate({ ...state });
  $('#kpis').innerHTML = kpiTiles(result.kpi);
  drawTanks(result);
  drawChart(result);
  renderCompare(state.scenario);
}

function bind() {
  $$('[data-param]').forEach((input) => input.addEventListener('input', render));
  $$('[data-scenario]').forEach((b) => b.addEventListener('click', () => {
    state.scenario = b.dataset.scenario;
    // Ogni scenario propone il suo numero di camion; il cursore resta modificabile.
    $('[data-param="trucks"]').value = String(SCENARIOS[state.scenario].trucks);
    render();
  }));
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    render();
  }));
}

// Entrate: ogni parte di una sezione sale e compare una volta, con un piccolo ritardo tra le parti.
function reveal() {
  const items = $$('.reveal');
  if (!('IntersectionObserver' in window)) return;
  document.documentElement.classList.add('js');
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const el = entry.target;
      const siblings = [...el.parentElement.querySelectorAll(':scope > .reveal')];
      el.style.transitionDelay = `${Math.max(0, siblings.indexOf(el)) * 80}ms`;
      el.classList.add('in');
      io.unobserve(el);
    });
  }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach((el) => io.observe(el));
}

bind();
render();
reveal();
