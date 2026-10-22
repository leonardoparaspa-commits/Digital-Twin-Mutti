// Modello del ricevimento del pomodoro. Passo di un minuto.
// Flusso: arrivo al cancello, carotaggio (postazioni), esito di laboratorio,
// scarico (baie), vasche, linea di lavorazione.
// Tutte le quantità sono in tonnellate e tutti i tempi in minuti dal primo minuto del giorno.

export const DEFAULTS = {
  trucks: 260, // camion nel giorno (REALE, picco 2025)
  tonsPerTruck: 24, // t per camion (STIMATO, 22-27)
  stations: 4, // postazioni di carotaggio (STIMATO, 3-5)
  sampleMin: 20, // minuti di carotaggio e cernita (DA CHIEDERE a Mutti)
  labMin: 30, // minuti di laboratorio dopo il campione (STIMATO)
  rejectRate: 0.02, // quota di carichi rifiutati (DA CHIEDERE a Mutti, ipotesi 1-3%)
  bays: 3, // baie di scarico (non pubblico)
  unloadMin: 16, // minuti per scarico in una baia (STIMATO, 3 baie = circa 11 camion/h)
  tanks: 5, // vasche (REALE, video)
  tankCap: 100, // t per vasca (REALE, video: circa 4 camion)
  lineRate: 250, // t/h in lavorazione (STIMATO, 6.000 t / 24 h)
  scenario: 'picco',
  mode: 'libero', // 'libero' = arrivi come oggi, 'piano' = slot distribuiti
  seed: 7,
};

// trucks: camion del giorno proposti quando si sceglie lo scenario.
// startLevel: riempimento iniziale delle vasche (STIMATO: impianto già in marcia, tranne all'avvio).
export const SCENARIOS = {
  picco: { label: 'Giorno di picco', trucks: 260, startLevel: 0.8, note: 'Arrivi concentrati nelle ore centrali, come nei giorni di punta.' },
  pioggia: { label: 'Pioggia e ondata', trucks: 260, startLevel: 0.8, note: 'La pioggia ferma la raccolta per sei ore, poi i camion arrivano tutti insieme.' },
  linea: { label: 'Linea ferma', trucks: 260, startLevel: 0.8, note: 'La linea si ferma dalle 10 alle 14. Il ricevimento continua.' },
  avvio: { label: 'Inizio campagna', trucks: 100, startLevel: 0, note: 'Circa 100 camion e vasche vuote: la linea a piena velocità resta spesso senza prodotto. Prova a ridurla.' },
};

export const HORIZON = 2880; // due giorni: la coda deve svuotarsi
export const LINE = { RUNNING: 0, STARVED: 1, STOPPED: 2 };
const SAMPLE_EVERY = 10; // minuti tra due punti delle serie storiche

// Generatore pseudo-casuale con seme (mulberry32): stessi parametri, stesso risultato.
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Solo nello scenario "Linea ferma": linea spenta dalle 10 alle 14.
export function lineStopped(scenario, t) {
  return scenario === 'linea' && t >= 600 && t < 840;
}

// Istanti di arrivo dei camion secondo lo scenario e la modalità.
export function arrivals(p) {
  const r = rng(p.seed);
  const n = p.trucks;
  const times = [];
  if (p.mode === 'piano') {
    // Slot pianificati: distribuiti in modo regolare nelle 24 ore,
    // a partire dall’inizio disponibile dello scenario.
    const start = p.scenario === 'pioggia' ? 360 : 0;
    for (let i = 0; i < n; i++) times.push(start + Math.floor((i * 1440) / n));
    return times;
  }
  // Arrivi liberi: la maggior parte nelle ore centrali, con ondate casuali.
  if (p.scenario === 'pioggia') {
    for (let i = 0; i < n; i++) times.push(Math.floor(360 + r() * 720));
  } else {
    for (let i = 0; i < n; i++) {
      const central = r() < 0.6;
      times.push(Math.floor(central ? 360 + r() * 480 : r() * 1440));
    }
  }
  return times.sort((a, b) => a - b);
}

export function simulate(input) {
  const p = { ...DEFAULTS, ...input };
  const times = arrivals(p);
  const rand = rng(p.seed + 1);
  const load = p.tonsPerTruck;

  // Ogni camion registra dove e quando passa: è il "diario" che la scena 3D rilegge.
  const trucks = times.map((arr, id) => ({
    id,
    arr,
    load,
    station: -1,
    sampleStart: null,
    resultAt: null,
    rejected: false,
    bay: -1,
    unloadStart: null,
    tank: -1,
    deposit: null,
  }));
  const gateQ = [];
  const unloadQ = [];
  const stationFree = Array(p.stations).fill(0);
  const pendingLab = [];
  const bays = Array.from({ length: p.bays }, () => ({ truck: null, until: -1 }));
  const startLevel = p.startLevel ?? SCENARIOS[p.scenario].startLevel;
  const tanks = Array(p.tanks).fill(startLevel * p.tankCap);
  const reserved = Array(p.tanks).fill(0); // carichi già assegnati a una vasca ma non ancora versati
  const initialTons = tanks.reduce((a, b) => a + b, 0);
  const perMin = p.lineRate / 60;

  // Stato minuto per minuto, per la riproduzione e la linea del tempo.
  const levels = new Float32Array(HORIZON * p.tanks);
  const processedAt = new Float32Array(HORIZON);
  const lineState = new Uint8Array(HORIZON);

  let next = 0;
  let processed = 0;
  let lastDeposit = 0;
  let deliveredTons = 0;
  let accepted = 0;
  let rejected = 0;
  let gateMax = 0;
  let gateMaxAt = 0;
  let tankPeak = 0;
  let minutes = HORIZON;
  const series = [];

  for (let t = 0; t < HORIZON; t++) {
    // 1. Arrivi al cancello.
    while (next < trucks.length && trucks[next].arr === t) gateQ.push(trucks[next++]);

    // 2. Carotaggio: ogni postazione libera prende il primo camion della coda.
    for (let s = 0; s < stationFree.length; s++) {
      if (stationFree[s] <= t && gateQ.length) {
        const truck = gateQ.shift();
        truck.station = s;
        truck.sampleStart = t;
        truck.resultAt = t + p.sampleMin + p.labMin;
        truck.rejected = rand() < p.rejectRate;
        stationFree[s] = t + p.sampleMin;
        pendingLab.push(truck);
      }
    }

    // 3. Esito di laboratorio: accettato va in coda allo scarico, rifiutato esce.
    for (let i = 0; i < pendingLab.length; ) {
      const truck = pendingLab[i];
      if (truck.resultAt !== t) {
        i++;
        continue;
      }
      pendingLab.splice(i, 1);
      if (truck.rejected) {
        rejected++;
      } else {
        accepted++;
        unloadQ.push(truck);
      }
    }

    // 4. Scarico: il camion entra in una baia solo se una vasca ha spazio per tutto il carico.
    for (let b = 0; b < bays.length; b++) {
      const bay = bays[b];
      if (bay.truck && bay.until <= t) {
        const truck = bay.truck;
        tanks[truck.tank] += truck.load;
        reserved[truck.tank] -= truck.load;
        truck.deposit = t;
        deliveredTons += truck.load;
        lastDeposit = t;
        bay.truck = null;
      }
    }
    for (let b = 0; b < bays.length; b++) {
      const bay = bays[b];
      if (bay.truck || !unloadQ.length) continue;
      let best = -1;
      for (let k = 0; k < tanks.length; k++) {
        const free = p.tankCap - tanks[k] - reserved[k];
        if (free >= load - 1e-9 && (best < 0 || free > p.tankCap - tanks[best] - reserved[best])) best = k;
      }
      if (best < 0) break; // vasche piene: i camion aspettano in coda
      const truck = unloadQ.shift();
      truck.bay = b;
      truck.tank = best;
      truck.unloadStart = t;
      reserved[best] += truck.load;
      bay.truck = truck;
      bay.until = t + p.unloadMin;
    }

    // 5. Linea: prende dalla vasca più piena. Se il prodotto manca, la linea gira a vuoto.
    if (lineStopped(p.scenario, t)) {
      lineState[t] = LINE.STOPPED;
    } else {
      const total = tanks.reduce((a, b) => a + b, 0);
      lineState[t] = total < perMin - 1e-9 ? LINE.STARVED : LINE.RUNNING;
      let want = perMin;
      while (want > 1e-9) {
        let top = -1;
        for (let k = 0; k < tanks.length; k++) if (tanks[k] > 1e-9 && (top < 0 || tanks[k] > tanks[top])) top = k;
        if (top < 0) break;
        const take = Math.min(want, tanks[top]);
        tanks[top] -= take;
        processed += take;
        want -= take;
      }
    }

    for (let k = 0; k < tanks.length; k++) levels[t * p.tanks + k] = tanks[k];
    processedAt[t] = processed;
    tankPeak = Math.max(tankPeak, Math.max(...tanks) / p.tankCap);
    if (gateQ.length > gateMax) {
      gateMax = gateQ.length;
      gateMaxAt = t;
    }

    if (t % SAMPLE_EVERY === 0) {
      series.push({
        t,
        queue: gateQ.length,
        waiting: unloadQ.length,
        tanks: tanks.map((x) => x / p.tankCap),
        processed,
      });
    }

    // Fine: tutti i camion hanno scaricato o sono usciti, e la lavorazione ha svuotato le vasche.
    const done = next >= trucks.length && gateQ.length === 0 && unloadQ.length === 0 && pendingLab.length === 0 &&
      bays.every((b) => !b.truck) && tanks.every((x) => x < 1e-9);
    if (done) {
      minutes = t + 1;
      break;
    }
  }

  // Le ore senza prodotto contano fino all'ultimo scarico: dopo, la linea si svuota e si ferma.
  let starvedMin = 0;
  for (let t = 0; t <= Math.min(lastDeposit, minutes - 1); t++) if (lineState[t] === LINE.STARVED) starvedMin++;

  const gateWaits = trucks.filter((x) => x.sampleStart !== null).map((x) => x.sampleStart - x.arr);
  const unloaded = trucks.filter((x) => x.deposit !== null).map((x) => x.deposit - x.arr);
  const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const max = (xs) => (xs.length ? Math.max(...xs) : 0);
  const inTanks = tanks.reduce((a, b) => a + b, 0);

  return {
    params: p,
    trucks,
    series,
    minutes: { count: minutes, tanks: p.tanks, levels, processed: processedAt, line: lineState },
    kpi: {
      trucks: trucks.length,
      accepted,
      rejected,
      rejectedShare: trucks.length ? rejected / trucks.length : 0,
      gateWaitAvg: mean(gateWaits),
      gateWaitMax: max(gateWaits),
      gateQueueMax: gateMax,
      gateQueueMaxAt: gateMaxAt,
      dockWaitAvg: mean(unloaded),
      dockWaitMax: max(unloaded),
      starvedHours: starvedMin / 60,
      tankPeak,
      processedTons: processed,
      initialTons,
      deliveredTons,
      inTanksTons: inTanks,
      endHour: lastDeposit / 60,
    },
  };
}
