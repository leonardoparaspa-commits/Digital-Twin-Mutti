// Pianta dello stabilimento e posizione di ogni camion in un dato minuto.
// Nessuna dipendenza da Three.js: la scena 3D e i test usano le stesse funzioni.
// Unità in metri. L'asse x va dall'ingresso (ovest) alla linea (est), l'asse z verso sud.

export const SLOT = 11; // passo tra due camion in fila
export const LANE = 4.5; // distanza tra due corsie
export const MID_Z = -16; // asse del flusso

export const ZONES = {
  road: { z: 24, from: -420, to: -168 }, // strada di accesso
  yard: { front: -60, lanes: 10, depth: 10 }, // piazzale della coda al cancello
  gateX: -50,
  stationX: -26,
  stationPitch: 7,
  lab: { x: -26, z: -58 },
  result: { front: 26, lanes: 4, depth: 4 }, // attesa dell'esito
  dock: { front: 102, lanes: 8, depth: 6 }, // attesa dello scarico
  bayX: 124,
  bayPitch: 9,
  tankX: 160,
  tankPitch: 13,
  tankSize: 10,
  plant: { x: 210, z: MID_Z, w: 34, d: 64, h: 16 },
  exit: { z: -80, to: -200 }, // strada di uscita verso ovest
};

const ARRIVE = 3; // minuti sulla strada prima del cancello
const LEAVE = 6; // minuti per uscire dopo lo scarico o il rifiuto

export const PHASES = {
  road: 'In arrivo',
  gate: 'In coda al cancello',
  sample: 'Carotaggio',
  result: 'Attesa esito',
  rejected: 'Rifiutato, esce',
  dock: 'Attesa scarico',
  unload: 'Scarico',
  leave: 'Scaricato, esce',
  gone: 'Fuori impianto',
  later: 'Non ancora partito',
};

export const across = (i, n, pitch) => MID_Z + (i - (n - 1) / 2) * pitch;
export const stationZ = (s, n) => across(s, n, ZONES.stationPitch);
export const bayZ = (b, n) => across(b, n, ZONES.bayPitch);
export const tankZ = (k, n) => across(k, n, ZONES.tankPitch);

// Posto i-esimo di un'area a corsie: i primi camion stanno davanti, uno per corsia.
function slot(area, i) {
  const lane = i % area.lanes;
  const row = Math.floor(i / area.lanes);
  return { x: area.front - row * SLOT, z: across(lane, area.lanes, LANE), row };
}

const lerp = (a, b, f) => a + (b - a) * Math.min(1, Math.max(0, f));

// Percorso di uscita: dal punto di partenza alla strada nord, poi verso ovest.
// heading: angolo attorno all'asse verticale, 0 verso est, π/2 verso nord.
function leaving(laneX, f) {
  const turn = 0.35;
  if (f < turn) return { x: laneX, z: lerp(MID_Z, ZONES.exit.z, f / turn), heading: Math.PI / 2 };
  return { x: lerp(laneX, laneX - 120, (f - turn) / (1 - turn)), z: ZONES.exit.z, heading: Math.PI };
}

// Stato di tutti i camion al minuto t (anche frazionario).
// Restituisce per ogni camion fase, posizione, direzione e carico rimasto,
// e i conteggi delle zone per i pannelli.
export function frame(result, t) {
  const p = result.params;
  const out = new Array(result.trucks.length);
  const counts = { road: 0, gate: 0, sample: 0, result: 0, dock: 0, unload: 0, leave: 0, rejected: 0, done: 0, refused: 0, overflowGate: 0, overflowDock: 0 };
  let gateI = 0;
  let resultI = 0;
  let dockI = 0;
  const yardCap = ZONES.yard.lanes * ZONES.yard.depth;
  const dockCap = ZONES.dock.lanes * ZONES.dock.depth;

  // I camion sono in ordine di arrivo e ogni coda è servita in ordine: l'indice in coda
  // è il numero di camion davanti nella stessa fase.
  for (const tr of result.trucks) {
    const sampleEnd = tr.sampleStart + p.sampleMin;
    let s;
    if (t < tr.arr - ARRIVE) {
      s = { phase: 'later', visible: false };
    } else if (t < tr.arr) {
      const f = (t - (tr.arr - ARRIVE)) / ARRIVE;
      s = { phase: 'road', x: lerp(ZONES.road.from, ZONES.road.to, f), z: ZONES.road.z, heading: 0 };
      counts.road++;
    } else if (t < tr.sampleStart) {
      const i = gateI++;
      counts.gate++;
      if (i < yardCap) {
        const q = slot(ZONES.yard, i);
        s = { phase: 'gate', x: q.x, z: q.z, heading: 0, queue: i };
      } else {
        // Il piazzale è pieno: i camion restano in fila sulla strada.
        counts.overflowGate++;
        s = { phase: 'gate', x: ZONES.road.to - (i - yardCap) * SLOT, z: ZONES.road.z, heading: 0, queue: i };
      }
    } else if (t < sampleEnd) {
      s = { phase: 'sample', x: ZONES.stationX, z: stationZ(tr.station, p.stations), heading: 0, progress: (t - tr.sampleStart) / p.sampleMin };
      counts.sample++;
    } else if (t < tr.resultAt) {
      const q = slot(ZONES.result, resultI++);
      s = { phase: 'result', x: q.x, z: q.z, heading: 0 };
      counts.result++;
    } else if (tr.rejected) {
      const f = (t - tr.resultAt) / LEAVE;
      if (f >= 1) {
        s = { phase: 'gone', visible: false };
      } else {
        s = { phase: 'rejected', ...leaving(ZONES.result.front + 8, f) };
        counts.rejected++;
      }
      counts.refused++;
    } else if (t < tr.unloadStart) {
      const i = dockI++;
      counts.dock++;
      if (i < dockCap) {
        const q = slot(ZONES.dock, i);
        s = { phase: 'dock', x: q.x, z: q.z, heading: 0, queue: i };
      } else {
        counts.overflowDock++;
        s = { phase: 'dock', visible: false, queue: i };
      }
    } else if (t < tr.deposit) {
      const f = (t - tr.unloadStart) / p.unloadMin;
      s = { phase: 'unload', x: ZONES.bayX, z: bayZ(tr.bay, p.bays), heading: 0, load: 1 - f };
      counts.unload++;
    } else {
      const f = (t - tr.deposit) / LEAVE;
      counts.done++;
      if (f >= 1) {
        s = { phase: 'gone', visible: false, load: 0 };
      } else {
        s = { phase: 'leave', ...leaving(ZONES.bayX + 16, f), load: 0 };
        counts.leave++;
      }
    }
    if (s.visible === undefined) s.visible = true;
    if (s.load === undefined) s.load = 1;
    out[tr.id] = s;
  }
  return { trucks: out, counts };
}

// Curve minuto per minuto per la linea del tempo: camion al cancello e in attesa dello scarico.
export function queueCurves(result) {
  const n = result.minutes.count;
  const gate = new Int32Array(n + 1);
  const dock = new Int32Array(n + 1);
  for (const tr of result.trucks) {
    if (tr.arr < n) gate[tr.arr]++;
    if (tr.sampleStart !== null && tr.sampleStart < n) gate[tr.sampleStart]--;
    if (!tr.rejected && tr.resultAt !== null && tr.resultAt < n) {
      dock[tr.resultAt]++;
      if (tr.unloadStart !== null && tr.unloadStart < n) dock[tr.unloadStart]--;
    }
  }
  for (let t = 1; t < n; t++) {
    gate[t] += gate[t - 1];
    dock[t] += dock[t - 1];
  }
  return { gate: gate.subarray(0, n), dock: dock.subarray(0, n) };
}
