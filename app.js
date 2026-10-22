import { simulate, DEFAULTS, SCENARIOS, LINE } from './sim.js';
import { frame, queueCurves, PHASES } from './layout.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Parametri modificabili. tag: reale, stima o da chiedere, come nel README.
const PARAMS = [
  { key: 'trucks', name: 'Camion nel giorno', tag: 'reale', min: 50, max: 320, step: 5, unit: '', src: 'Fino a 260 nei giorni di punta (Linkiesta, 2025).' },
  { key: 'tonsPerTruck', name: 'Tonnellate per camion', tag: 'stima', min: 18, max: 30, step: 1, unit: ' t', src: 'Da 22 a 27 t, calcolo dai dati pubblici.' },
  { key: 'stations', name: 'Postazioni di carotaggio', tag: 'stima', min: 1, max: 6, step: 1, unit: '', src: 'Da 3 a 5 al picco, con un ciclo ipotetico.' },
  { key: 'sampleMin', name: 'Minuti per campione', tag: 'da chiedere', min: 5, max: 40, step: 1, unit: ' min', src: 'Il dato interno che manca di più.' },
  { key: 'labMin', name: 'Minuti di laboratorio', tag: 'stima', min: 10, max: 60, step: 5, unit: ' min', src: 'Nessun dato pubblico.' },
  { key: 'rejectRate', name: 'Carichi rifiutati', tag: 'da chiedere', min: 0, max: 10, step: 0.5, unit: '%', pct: true, src: 'Ipotesi da 1 a 3%.' },
  { key: 'bays', name: 'Baie di scarico', tag: 'stima', min: 1, max: 5, step: 1, unit: '', src: 'Numero non pubblico.' },
  { key: 'unloadMin', name: 'Minuti per scarico', tag: 'stima', min: 8, max: 30, step: 1, unit: ' min', src: '3 baie da 16 minuti fanno circa 11 camion all’ora.' },
  { key: 'lineRate', name: 'Linea, tonnellate all’ora', tag: 'stima', min: 100, max: 320, step: 5, unit: ' t/h', src: '6.000 t in 24 ore fanno 250 t/h.' },
];

const state = { ...DEFAULTS, t: 360, playing: !reducedMotion, speed: 15, selected: null, view: 'panoramica' };
let result = null;
let curves = null;
let twin = null;
let snapNext = true;

const fmtInt = (n) => Math.round(n).toLocaleString('it-IT');
const fmtDec = (n) => n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
function fmtMin(min) {
  if (!Number.isFinite(min) || min <= 0) return '0 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m ? `${h} h ${m} min` : `${h} h`;
}
function clock(t) {
  const m = Math.floor(t) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
const dayOf = (t) => Math.floor(t / 1440) + 1;
// Forma breve per la tabella dei risultati.
const fmtShort = (min) => (min < 60 ? `${Math.round(min)} min` : `${fmtDec(min / 60)} h`);
const stamp = (t) => (t === null ? '–' : dayOf(t) > 1 ? `G${dayOf(t)} ${clock(t)}` : clock(t));

// Cursori dei parametri.
function buildParams() {
  const host = $('#params');
  for (const p of PARAMS) {
    const v = p.pct ? DEFAULTS[p.key] * 100 : DEFAULTS[p.key];
    const el = document.createElement('label');
    el.className = 'param';
    el.innerHTML = `
      <span class="param-row"><span class="param-name">${p.name}</span><span class="param-value num" data-out="${p.key}"></span></span>
      <input type="range" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" data-param="${p.key}">
      <span class="param-row"><span class="param-src">${p.src}</span><em class="tag" data-tag="${p.tag}">${p.tag}</em></span>`;
    host.appendChild(el);
  }
  $('#info-params').innerHTML = `<thead><tr><th scope="col">Parametro</th><th scope="col">Valore</th><th scope="col">Tipo</th><th scope="col">Da dove</th></tr></thead><tbody>${PARAMS.map((p) => {
    const v = p.pct ? DEFAULTS[p.key] * 100 : DEFAULTS[p.key];
    return `<tr><th scope="row">${p.name}</th><td class="num">${fmtValue(p, v)}</td><td>${p.tag}</td><td>${p.src}</td></tr>`;
  }).join('')}<tr><th scope="row">Vasche</th><td class="num">5 da 100 t</td><td>reale</td><td>Video della visita, circa quattro camion per vasca.</td></tr><tr><th scope="row">Vasche a inizio giorno</th><td class="num">80%</td><td>stima</td><td>Impianto già in marcia; 0% all’avvio della campagna.</td></tr></tbody>`;
}

function fmtValue(p, v) {
  return `${p.pct ? fmtDec(v) : fmtInt(v)}${p.unit}`;
}

function readParams() {
  for (const input of $$('[data-param]')) {
    const p = PARAMS.find((x) => x.key === input.dataset.param);
    const v = Number(input.value);
    state[p.key] = p.pct ? v / 100 : v;
    $(`[data-out="${p.key}"]`).textContent = fmtValue(p, v);
  }
}

function press(selector, attr, value) {
  $$(selector).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(value))));
}

// Ricalcola il modello e tutto ciò che non cambia con il tempo.
function recompute() {
  readParams();
  const input = { ...state };
  result = simulate(input);
  curves = queueCurves(result);
  const other = simulate({ ...input, mode: state.mode === 'piano' ? 'libero' : 'piano' });
  const free = state.mode === 'libero' ? result.kpi : other.kpi;
  const plan = state.mode === 'piano' ? result.kpi : other.kpi;

  $('#title').textContent = SCENARIOS[state.scenario].label;
  $('#scenario-note').textContent = SCENARIOS[state.scenario].note;
  press('[data-scenario]', 'scenario', state.scenario);
  press('[data-mode]', 'mode', state.mode);
  $('#finding').textContent = `Con gli arrivi di oggi la coda al cancello arriva a ${free.gateQueueMax} camion e la linea resta senza prodotto per ${fmtDec(free.starvedHours)} h. Con gli slot: ${plan.gateQueueMax} camion e ${fmtDec(plan.starvedHours)} h.${state.scenario === 'linea' ? ` Durante la fermata le vasche si riempiono e un camion aspetta lo scarico fino a ${fmtShort(free.dockWaitMax)}.` : ''}`;

  const rows = [
    ['Coda massima al cancello', `${free.gateQueueMax}`, `${plan.gateQueueMax}`],
    ['Attesa media al cancello', fmtShort(free.gateWaitAvg), fmtShort(plan.gateWaitAvg)],
    ['Dall’arrivo allo scarico', fmtShort(free.dockWaitAvg), fmtShort(plan.dockWaitAvg)],
    ['Linea senza prodotto', `${fmtDec(free.starvedHours)} h`, `${fmtDec(plan.starvedHours)} h`],
    ['Carichi rifiutati', `${free.rejected}`, `${plan.rejected}`],
    ['Tonnellate lavorate', fmtInt(free.processedTons), fmtInt(plan.processedTons)],
  ];
  const on = (m) => (state.mode === m ? ' class="on"' : '');
  $('#compare').innerHTML = `<thead><tr><th scope="col"><span class="sr">Indicatore</span></th><th scope="col"${on('libero')}><span>Come oggi</span></th><th scope="col"${on('piano')}><span>Slot</span></th></tr></thead>
    <tbody>${rows.map((r) => `<tr><th scope="row">${r[0]}</th><td class="num">${r[1]}</td><td class="num">${r[2]}</td></tr>`).join('')}</tbody>`;

  const scrub = $('#scrub');
  scrub.max = String(result.minutes.count - 1);
  state.t = Math.min(state.t, result.minutes.count - 1);
  if (state.selected !== null && state.selected >= result.trucks.length) select(null);
  drawStrip();
  if (twin) twin.setResult(result);
  snapNext = true;
  lastMinute = -1;
}

// Linea del tempo: code nel tempo, minuti senza prodotto e fermata della linea.
function drawStrip() {
  const svg = $('#strip');
  const n = result.minutes.count;
  const W = 1000;
  const H = 100;
  const top = Math.max(5, ...curves.gate, ...curves.dock);
  const x = (t) => (t / (n - 1)) * W;
  const y = (v) => H - 4 - (v / top) * (H - 14);
  const spans = (code) => {
    let out = '';
    let start = -1;
    for (let t = 0; t <= n; t++) {
      const hit = t < n && result.minutes.line[t] === code && (code !== LINE.STARVED || t <= result.kpi.endHour * 60);
      if (hit && start < 0) start = t;
      if (!hit && start >= 0) {
        out += `<rect x="${x(start).toFixed(1)}" y="0" width="${Math.max(1, x(t) - x(start)).toFixed(1)}" height="${H}"/>`;
        start = -1;
      }
    }
    return out;
  };
  const path = (arr) => {
    let d = `M0 ${y(arr[0]).toFixed(1)}`;
    const step = Math.max(1, Math.floor(n / 500));
    for (let t = step; t < n; t += step) d += `L${x(t).toFixed(1)} ${y(arr[t]).toFixed(1)}`;
    return d;
  };
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.innerHTML = `
    <g class="s-starved">${spans(LINE.STARVED)}</g>
    <g class="s-stop">${spans(LINE.STOPPED)}</g>
    <line class="s-day" x1="${x(1440)}" x2="${x(1440)}" y1="0" y2="${H}"/>
    <path class="s-dock" d="${path(curves.dock)}"/>
    <path class="s-gate" d="${path(curves.gate)}"/>`;
  let ticks = `<span class="tick tick-top num" style="left:0">${top} camion</span>`;
  for (let h = 0; h * 60 < n; h += 6) {
    const label = h === 24 ? 'G2 00:00' : clock(h * 60);
    ticks += `<span class="tick num" style="left:${((h * 60) / (n - 1)) * 100}%">${label}</span>`;
  }
  $('#axis').innerHTML = ticks;
}

// Pannelli che cambiano con il tempo.
let lastMinute = -1;
function updatePanels(f) {
  const t = state.t;
  const minute = Math.floor(t);
  if (minute === lastMinute && !panelsDirty) return;
  lastMinute = minute;
  panelsDirty = false;
  const p = result.params;
  const c = f.counts;
  $('#clock').textContent = clock(t);
  $('#clock-day').textContent = `Giorno ${dayOf(t)}`;
  const line = result.minutes.line[Math.min(minute, result.minutes.count - 1)];
  const ls = $('#line-state');
  ls.textContent = line === LINE.RUNNING ? 'Linea in marcia' : line === LINE.STOPPED ? 'Linea ferma' : 'Linea senza prodotto';
  ls.dataset.state = line === LINE.RUNNING ? 'on' : 'off';
  const lv = result.minutes.levels;
  let inTanks = 0;
  const levels = [];
  for (let k = 0; k < p.tanks; k++) {
    const v = lv[Math.min(minute, result.minutes.count - 1) * p.tanks + k];
    levels.push(v / p.tankCap);
    inTanks += v;
  }
  const processed = result.minutes.processed[Math.min(minute, result.minutes.count - 1)];
  const rows = [
    ['In coda al cancello', `${c.gate}`],
    ['In carotaggio', `${c.sample}/${p.stations}`],
    ['In attesa dell’esito', `${c.result}`],
    ['In attesa di scarico', `${c.dock}`],
    ['In scarico', `${c.unload}/${p.bays}`],
    ['Scaricati finora', `${c.done}`],
    ['Rifiutati finora', `${c.refused}`],
    ['Prodotto nelle vasche', `${fmtInt(inTanks)} t`],
    ['Lavorato finora', `${fmtInt(processed)} t`],
  ];
  $('#telemetry').innerHTML = rows.map((r) => `<div><dt>${r[0]}</dt><dd class="num">${r[1]}</dd></div>`).join('');
  $('#tanks').innerHTML = levels.map((v, k) => `<div class="tank"><span class="tank-bar"><span style="height:${Math.min(100, v * 100).toFixed(1)}%"></span></span><span class="num">${Math.round(v * 100)}%</span><span class="tank-name">V${k + 1}</span></div>`).join('');
  updateTruck(f);
  $('#scrub').value = String(minute);
  $('#scrub').setAttribute('aria-valuetext', `Giorno ${dayOf(t)}, ore ${clock(t)}`);
}
let panelsDirty = true;

// Scheda del camion scelto: orari e barra del percorso.
function updateTruck(f) {
  const host = $('#truck');
  const id = state.selected;
  if (id === null) {
    host.innerHTML = '<p class="empty">Tocca un camion nella scena per vedere il suo percorso.</p>';
    return;
  }
  const tr = result.trucks[id];
  const p = result.params;
  const s = f.trucks[id];
  const end = tr.rejected ? tr.resultAt : tr.deposit;
  const segs = [
    ['Cancello', tr.arr, tr.sampleStart],
    ['Carotaggio', tr.sampleStart, tr.sampleStart + p.sampleMin],
    ['Esito', tr.sampleStart + p.sampleMin, tr.resultAt],
  ];
  if (!tr.rejected) segs.push(['Attesa', tr.resultAt, tr.unloadStart], ['Scarico', tr.unloadStart, tr.deposit]);
  const span = Math.max(1, end - tr.arr);
  const now = Math.min(1, Math.max(0, (state.t - tr.arr) / span));
  const bar = segs.map(([name, a, b]) => `<span class="seg" data-seg="${name}" style="width:${(((b - a) / span) * 100).toFixed(2)}%" title="${name}: ${fmtMin(b - a)}"></span>`).join('');
  const times = [
    ['Arrivo', stamp(tr.arr)],
    ['Attesa al cancello', fmtMin(tr.sampleStart - tr.arr)],
    ['Postazione', `${tr.station + 1}`],
    ['Esito', tr.rejected ? `rifiutato, ${stamp(tr.resultAt)}` : `accettato, ${stamp(tr.resultAt)}`],
  ];
  if (!tr.rejected) times.push(['Baia e vasca', `baia ${tr.bay + 1}, vasca ${tr.tank + 1}`], ['Fine scarico', stamp(tr.deposit)], ['Dall’arrivo allo scarico', fmtMin(tr.deposit - tr.arr)]);
  host.innerHTML = `
    <div class="truck-head"><p class="truck-name">Camion <span class="num">${id + 1}</span></p><button type="button" class="ghost" id="truck-close">Chiudi</button></div>
    <p class="truck-phase">${PHASES[s.phase]}${s.phase === 'unload' ? `, carico al ${Math.round(s.load * 100)}%` : ''}</p>
    <div class="journey" aria-hidden="true">${bar}<span class="journey-now" style="left:${(now * 100).toFixed(2)}%"></span></div>
    <p class="journey-legend">${segs.map(([name, a, b]) => `${name} ${fmtMin(b - a)}`).join(' · ')}</p>
    <dl class="truck-times">${times.map((r) => `<div><dt>${r[0]}</dt><dd class="num">${r[1]}</dd></div>`).join('')}</dl>`;
  $('#truck-close').addEventListener('click', () => select(null));
}

function select(id) {
  state.selected = id;
  panelsDirty = true;
  if (twin) twin.select(id);
  const follow = $('[data-view="segui"]');
  follow.disabled = id === null;
  if (id === null && state.view === 'segui') setView('panoramica');
}

function setView(name) {
  state.view = name;
  press('[data-view]', 'view', name);
  if (twin) twin.view(name);
}

function setPlaying(on) {
  state.playing = on;
  $('#play').setAttribute('aria-label', on ? 'Metti in pausa' : 'Avvia');
  $('#play-icon').setAttribute('d', on ? 'M4 2.5h3v11H4zM9 2.5h3v11H9z' : 'M4 2.5v11l9-5.5z');
}

function jump(t) {
  state.t = Math.max(0, Math.min(result.minutes.count - 1, t));
  snapNext = true;
  panelsDirty = true;
}

function bind() {
  let pending = false;
  $$('[data-param]').forEach((input) => input.addEventListener('input', () => {
    if (pending) return;
    pending = true;
    requestAnimationFrame(() => {
      pending = false;
      recompute();
    });
  }));
  $$('[data-scenario]').forEach((b) => b.addEventListener('click', () => {
    state.scenario = b.dataset.scenario;
    $('[data-param="trucks"]').value = String(SCENARIOS[state.scenario].trucks);
    recompute();
  }));
  $$('[data-mode]').forEach((b) => b.addEventListener('click', () => {
    state.mode = b.dataset.mode;
    recompute();
  }));
  $$('[data-speed]').forEach((b) => b.addEventListener('click', () => {
    state.speed = Number(b.dataset.speed);
    press('[data-speed]', 'speed', state.speed);
  }));
  $$('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
  $('#play').addEventListener('click', () => {
    if (!state.playing && state.t >= result.minutes.count - 1) jump(0);
    setPlaying(!state.playing);
  });
  $('#to-peak').addEventListener('click', () => jump(result.kpi.gateQueueMaxAt));
  $('#scrub').addEventListener('input', (e) => jump(Number(e.target.value)));
  $('#info-open').addEventListener('click', () => $('#info').showModal());
  $('#info-close').addEventListener('click', () => $('#info').close());
  document.addEventListener('keydown', (e) => {
    if (e.key !== ' ' || e.target.closest('input, button, dialog')) return;
    e.preventDefault();
    setPlaying(!state.playing);
  });
}

function webglOk() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGL2RenderingContext && c.getContext('webgl2'));
  } catch {
    return false;
  }
}

async function start() {
  buildParams();
  bind();
  setPlaying(state.playing);
  if (webglOk()) {
    try {
      const { createTwin } = await import('./scene.js');
      twin = createTwin($('#canvas'), { onSelect: select, reducedMotion });
    } catch (err) {
      console.error(err);
      twin = null;
    }
  }
  if (!twin) $('#fallback').hidden = false;
  recompute();

  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state.playing) {
      state.t += state.speed * dt;
      if (state.t >= result.minutes.count - 1) {
        state.t = result.minutes.count - 1;
        setPlaying(false);
      }
    }
    let f;
    if (twin) {
      f = twin.update(state.t, dt, snapNext).frame;
      twin.render(dt);
    } else {
      f = frame(result, state.t);
    }
    snapNext = false;
    updatePanels(f);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

start();
