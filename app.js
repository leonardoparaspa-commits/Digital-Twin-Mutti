import { simulate, DEFAULTS, SCENARIOS, LINE } from './sim.js';
import { frame, queueCurves, PHASES } from './layout.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Parametri modificabili. tag: real, estimate o ask Mutti, come nel README.
const PARAMS = [
  { key: 'trucks', name: 'Trucks per day', tag: 'real', min: 50, max: 320, step: 5, unit: '', src: 'Up to 260 on peak days (Linkiesta, 2025).' },
  { key: 'tonsPerTruck', name: 'Tonnes per truck', tag: 'estimate', min: 18, max: 30, step: 1, unit: ' t', src: '22 to 27 t, worked out from public data.' },
  { key: 'stations', name: 'Core sampling stations', tag: 'estimate', min: 1, max: 6, step: 1, unit: '', src: '3 to 5 at peak, with an assumed cycle time.' },
  { key: 'sampleMin', name: 'Minutes per sample', tag: 'ask Mutti', min: 5, max: 40, step: 1, unit: ' min', src: 'The internal number we miss most.' },
  { key: 'labMin', name: 'Lab minutes', tag: 'estimate', min: 10, max: 60, step: 5, unit: ' min', src: 'No public data.' },
  { key: 'rejectRate', name: 'Rejected loads', tag: 'ask Mutti', min: 0, max: 10, step: 0.5, unit: '%', pct: true, src: 'Assumed 1 to 3%.' },
  { key: 'bays', name: 'Unloading bays', tag: 'estimate', min: 1, max: 5, step: 1, unit: '', src: 'Not public.' },
  { key: 'unloadMin', name: 'Minutes per unload', tag: 'estimate', min: 8, max: 30, step: 1, unit: ' min', src: '10 to 15 minutes in our report. 3 bays at 15 minutes give 12 trucks an hour.' },
  { key: 'lineRate', name: 'Line, tonnes per hour', tag: 'estimate', min: 100, max: 320, step: 5, unit: ' t/h', src: '6,000 t in 24 hours is 250 t/h.' },
];

const MODE_NOTES = {
  libero: 'Trucks turn up when they like, mostly between 6:00 and 14:00. This is our assumption of how it works today.',
  piano: 'Each truck is given a time slot, spread evenly over the day.',
};

const state = { ...DEFAULTS, t: 360, playing: !reducedMotion, speed: 15, selected: null, view: 'panoramica' };
let result = null;
let curves = null;
let twin = null;
let snapNext = true;

const fmtInt = (n) => Math.round(n).toLocaleString('en-GB');
const fmtDec = (n) => n.toLocaleString('en-GB', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
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
const stamp = (t) => (t === null ? '–' : dayOf(t) > 1 ? `Day ${dayOf(t)} ${clock(t)}` : clock(t));

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
  $('#info-params').innerHTML = `<thead><tr><th scope="col">Parameter</th><th scope="col">Value</th><th scope="col">Type</th><th scope="col">Where it comes from</th></tr></thead><tbody>${PARAMS.map((p) => {
    const v = p.pct ? DEFAULTS[p.key] * 100 : DEFAULTS[p.key];
    return `<tr><th scope="row">${p.name}</th><td class="num">${fmtValue(p, v)}</td><td>${p.tag}</td><td>${p.src}</td></tr>`;
  }).join('')}<tr><th scope="row">Tanks</th><td class="num">5 of 100 t</td><td>real</td><td>Plant visit video, about four truckloads per tank.</td></tr><tr><th scope="row">Tanks at start of day</th><td class="num">80%</td><td>estimate</td><td>Plant already running; 0% at the start of the season.</td></tr></tbody>`;
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
  press('[data-scenario]', 'scenario', state.scenario);
  press('[data-mode]', 'mode', state.mode);
  const starved = (k) => `${fmtDec(k.starvedHours)} h`;
  // La frase dice cosa significa il confronto; le cifre stanno solo nella tabella.
  const noQueue = plan.gateQueueMax <= free.gateQueueMax * 0.2 && free.gateQueueMax > 5;
  const dry = plan.starvedHours >= 1;
  $('#finding').textContent = !noQueue
    ? 'In this scenario planning the arrivals changes little.'
    : dry
      ? 'Planned slots remove the queue at the gate, but the line still runs out of product: the tanks are empty and slots cannot fix that.'
      : 'Planned slots remove the queue at the gate and keep the line fed.';
  $('#mode-note').textContent = MODE_NOTES[state.mode];

  const rows = [
    ['Trucks waiting at the gate, at worst', `${free.gateQueueMax}`, `${plan.gateQueueMax}`],
    ['Average time from arrival to unloaded', fmtShort(free.dockWaitAvg), fmtShort(plan.dockWaitAvg)],
    ['Line without product', starved(free), starved(plan)],
  ];
  const on = (m) => (state.mode === m ? ' class="on"' : '');
  const tbl = $('#compare');
  tbl.innerHTML = `<thead><tr><th scope="col"><span class="sr">Indicator</span></th><th scope="col"${on('libero')}><span>Free arrival</span></th><th scope="col"${on('piano')}><span>Planned slots</span></th></tr></thead>
    <tbody>${rows.map((r) => `<tr><th scope="row">${r[0]}</th><td class="num${state.mode === 'libero' ? ' on' : ''}">${r[1]}</td><td class="num${state.mode === 'piano' ? ' on' : ''}">${r[2]}</td></tr>`).join('')}</tbody>`;
  if (!reducedMotion) {
    tbl.classList.remove('swap');
    void tbl.offsetWidth;
    tbl.classList.add('swap');
  }

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
  let ticks = `<span class="tick tick-top num" style="left:0">${top} trucks</span>`;
  for (let h = 0; h * 60 < n; h += 6) {
    const label = h === 24 ? 'Day 2' : clock(h * 60);
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
  $('#clock-day').textContent = `Day ${dayOf(t)}`;
  const line = result.minutes.line[Math.min(minute, result.minutes.count - 1)];
  const ls = $('#line-state');
  ls.textContent = line === LINE.RUNNING ? 'Line running' : line === LINE.STOPPED ? 'Line stopped' : 'Line without product';
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
    ['Waiting at the gate', `${c.gate}`],
    ['In sampling and lab', `${c.sample + c.result}`],
    ['Waiting to unload', `${c.dock}`],
    ['Unloading', `${c.unload}/${p.bays}`],
  ];
  $('#telemetry').innerHTML = rows.map((r) => `<div><dt>${r[0]}</dt><dd class="num">${r[1]}</dd></div>`).join('');
  $('#tanks').setAttribute('aria-label', `Tank levels: ${levels.map((v) => Math.round(v * 100) + '%').join(', ')}`);
  $('#tanks').innerHTML = levels.map((v, k) => `<div class="tank"><span class="tank-bar"><span style="height:${Math.min(100, v * 100).toFixed(1)}%"></span></span><span class="tank-name">T${k + 1}</span></div>`).join('');
  updateTruck(f);
  $('#scrub').value = String(minute);
  $('#scrub').setAttribute('aria-valuetext', `Day ${dayOf(t)}, ${clock(t)}`);
}
let panelsDirty = true;

// Scheda del camion scelto: orari e barra del percorso.
function updateTruck(f) {
  const host = $('#truck');
  const id = state.selected;
  if (id === null) {
    host.hidden = true;
    return;
  }
  host.hidden = false;
  const tr = result.trucks[id];
  const p = result.params;
  const s = f.trucks[id];
  const end = tr.rejected ? tr.resultAt : tr.deposit;
  const segs = [
    ['Gate', tr.arr, tr.sampleStart],
    ['Sampling', tr.sampleStart, tr.sampleStart + p.sampleMin],
    ['Lab', tr.sampleStart + p.sampleMin, tr.resultAt],
  ];
  if (!tr.rejected) segs.push(['Queue', tr.resultAt, tr.unloadStart], ['Unloading', tr.unloadStart, tr.deposit]);
  const span = Math.max(1, end - tr.arr);
  const now = Math.min(1, Math.max(0, (state.t - tr.arr) / span));
  const bar = segs.map(([name, a, b]) => `<span class="seg" data-seg="${name}" style="width:${(((b - a) / span) * 100).toFixed(2)}%" title="${name}: ${fmtMin(b - a)}"></span>`).join('');
  const times = [
    ['Arrival', stamp(tr.arr)],
    ['Wait at the gate', fmtMin(tr.sampleStart - tr.arr)],
    ['Station', `${tr.station + 1}`],
    ['Lab result', tr.rejected ? `rejected, ${stamp(tr.resultAt)}` : `accepted, ${stamp(tr.resultAt)}`],
  ];
  if (!tr.rejected) times.push(['Bay and tank', `bay ${tr.bay + 1}, tank ${tr.tank + 1}`], ['Unloaded at', stamp(tr.deposit)], ['Arrival to unloaded', fmtMin(tr.deposit - tr.arr)]);
  host.innerHTML = `
    <div class="truck-head"><p class="truck-name">Truck <span class="num">${id + 1}</span></p><button type="button" class="ghost" id="truck-close">Close</button></div>
    <p class="truck-phase">${PHASES[s.phase]}${s.phase === 'unload' ? `, ${Math.round(s.load * 100)}% of load left` : ''}</p>
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
  $('#play').setAttribute('aria-label', on ? 'Pause' : 'Play');
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
