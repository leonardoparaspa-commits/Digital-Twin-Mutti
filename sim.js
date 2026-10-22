// Modello del ricevimento del pomodoro. Passo di un minuto.
// Flusso: arrivo al cancello, carotaggio (stazioni), esito di laboratorio,
// scarico (baie), vasche, linea di lavorazione.
// Tutte le quantità sono in tonnellate e tutti i tempi in minuti dal primo minuto del giorno.

export const DEFAULTS = {
  trucks: 260, // camion nel giorno (REALE, picco 2025)
  tonsPerTruck: 24, // t per camion (STIMATO, 22-27)
  stations: 4, // postazioni di carotaggio (STIMATO, 3-5)
  sampleMin: 20, // minuti di carotaggio e cernita (STIMATO, 15-25: da chiedere a Mutti)
  labMin: 30, // minuti di laboratorio dopo il campione (STIMATO)
  rejectRate: 0.02, // quota di carichi rifiutati (STIMATO, 1-3%: da chiedere a Mutti)
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

const HORIZON = 2880; // due giorni: la coda deve svuotarsi
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

// Istanti di arrivo dei camion secondo lo scenario e la modalità.
export function arrivals(p) {
  const r = rng(p.seed);
  const n = p.trucks;
  const times = [];
  if (p.mode === 'piano') {
    // Slot pianificati: distribuiti in modo regolare alla velocità delle baie,
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

  const trucks = times.map((arr, id) => ({ id, arr, rejected: false, deposit: null }));
  const gateQ = [];
  const unloadQ = [];
  const stationFree = Array(p.stations).fill(0);
  const pendingLab = []; // { truck, at, accepted }
  const bays = Array.from({ length: p.bays }, () => ({ truck: null, until: -1 }));
  const startLevel = p.startLevel ?? SCENARIOS[p.scenario].startLevel;
  const tanks = Array(p.tanks).fill(startLevel * p.tankCap);
  const initialTons = tanks.reduce((a, b) => a + b, 0);
  const perMin = p.lineRate / 60;
  // Solo nello scenario "Linea ferma": linea spenta dalle 10 alle 14.
  const lineStopped = (t) => p.scenario === 'linea' && t >= 600 && t < 840;

  let next = 0;
  let processed = 0;
  const starvedAt = []; // minuti con la linea accesa e le vasche quasi vuote
  let lastDeposit = 0;
  let deliveredTons = 0;
  let accepted = 0;
  let rejected = 0;
  let gateWaits = [];
  let gateMax = 0;
  let tankPeak = 0;
  const series = [];

  for (let t = 0; t < HORIZON; t++) {
    // 1. Arrivi al cancello.
    while (next < trucks.length && trucks[next].arr === t) gateQ.push(trucks[next++]);

    // 2. Carotaggio: ogni postazione libera prende il camion successivo.
    for (let s = 0; s < stationFree.length; s++) {
      if (stationFree[s] <= t && gateQ.length) {
        const truck = gateQ.shift();
        gateWaits.push(t - truck.arr);
        stationFree[s] = t + p.sampleMin;
        const reject = rand() < p.rejectRate;
        pendingLab.push({ truck, at: t + p.sampleMin + p.labMin, accepted: !reject });
      }
    }

    // 3. Esito di laboratorio: accettato va in coda allo scarico, rifiutato esce.
    for (let i = pendingLab.length - 1; i >= 0; i--) {
      const item = pendingLab[i];
      if (item.at !== t) continue;
      pendingLab.splice(i, 1);
      if (item.accepted) {
        accepted++;
        unloadQ.push(item.truck);
      } else {
        rejected++;
        item.truck.rejected = true;
      }
    }

    // 4. Scarico: si consegna nella vasca con più spazio libero.
    const freeTank = () => {
      let best = -1;
      for (let k = 0; k < tanks.length; k++) {
        const free = p.tankCap - tanks[k];
        if (free >= load && (best < 0 || free > p.tankCap - tanks[best])) best = k;
      }
      return best;
    };
    for (const bay of bays) {
      if (bay.truck && bay.until <= t) {
        const k = freeTank();
        if (k >= 0) {
          tanks[k] += load;
          bay.truck.deposit = t;
          deliveredTons += load;
          lastDeposit = t;
          bay.truck = null;
        } // altrimenti la baia resta occupata finché una vasca si libera
      }
      if (!bay.truck && unloadQ.length && bay.until <= t) {
        bay.truck = unloadQ.shift();
        bay.until = t + p.unloadMin;
      }
    }

    // 5. Linea: prende dalla vasca più piena. Se il prodotto manca, la linea gira a vuoto.
    const running = !lineStopped(t);
    if (running) {
      let want = perMin;
      const total = tanks.reduce((a, b) => a + b, 0);
      if (total < perMin) starvedAt.push(t);
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
    tankPeak = Math.max(tankPeak, Math.max(...tanks) / p.tankCap);
    gateMax = Math.max(gateMax, gateQ.length);

    if (t % SAMPLE_EVERY === 0) {
      series.push({
        t,
        queue: gateQ.length,
        waiting: unloadQ.length + bays.filter((b) => b.truck && b.until <= t).length,
        tanks: tanks.map((x) => x / p.tankCap),
        processed,
      });
    }

    // Fine: tutti i camion hanno scaricato o sono usciti, e la lavorazione ha svuotato le vasche.
    const done = next >= trucks.length && gateQ.length === 0 && unloadQ.length === 0 && pendingLab.length === 0 &&
      bays.every((b) => !b.truck) && tanks.every((x) => x < 1e-9);
    if (done) break;
  }

  // Contano solo i minuti fino all'ultimo scarico: dopo, la linea si svuota e si ferma.
  const starvedMin = starvedAt.filter((t) => t <= lastDeposit).length;
  const avg = gateWaits.length ? gateWaits.reduce((a, b) => a + b, 0) / gateWaits.length : 0;
  const waitMax = gateWaits.length ? Math.max(...gateWaits) : 0;
  const unloaded = trucks.filter((x) => x.deposit !== null).map((x) => x.deposit - x.arr);
  const dockAvg = unloaded.length ? unloaded.reduce((a, b) => a + b, 0) / unloaded.length : 0;
  const dockMax = unloaded.length ? Math.max(...unloaded) : 0;
  const inTanks = tanks.reduce((a, b) => a + b, 0);
  return {
    params: p,
    series,
    kpi: {
      trucks: trucks.length,
      accepted,
      rejected,
      rejectedShare: trucks.length ? rejected / trucks.length : 0,
      gateWaitAvg: avg,
      gateWaitMax: waitMax,
      gateQueueMax: gateMax,
      dockWaitAvg: dockAvg,
      dockWaitMax: dockMax,
      starvedHours: starvedMin / 60,
      tankPeak,
      processedTons: processed,
      initialTons,
      deliveredTons,
      inTanksTons: inTanks,
      endHour: lastDeposit / 60,
    },
    trucks,
  };
}
