// Scena 3D dello stabilimento: piazzale, cancello, carotaggio, baie, vasche e linea.
// I camion sono due InstancedMesh (cassone e carico) mossi da molle a smorzamento critico.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { ZONES, SLOT, LANE, MID_Z, across, stationZ, bayZ, tankZ, frame } from './layout.js';
import { LINE } from './sim.js';

const MAX_TRUCKS = 400;
const COLORS = {
  sky: 0x0e0e10,
  ground: 0x121214,
  pad: 0x19191c,
  mark: 0x2c2c31,
  build: 0x2a2a2e,
  edge: 0x55555c,
  cab: 0xd9d9dd,
  bin: 0x6c6c72,
  chassis: 0x202024,
  wheel: 0x0b0b0c,
  tomato: 0xe5452f,
  idle: 0x5a5a60,
};

// Viste della camera: posizione e punto guardato.
// dir: da dove guarda la camera; span: larghezza in metri da tenere nel quadro.
const VIEWS = {
  panoramica: { dir: [-0.42, 0.58, 0.7], target: [26, 0, -14], span: 325 },
  cancello: { dir: [-0.55, 0.45, 0.7], target: [-80, 0, -14], span: 150 },
  scarico: { dir: [-0.5, 0.5, 0.7], target: [150, 0, -16], span: 130 },
};
// Su uno schermo verticale la panoramica guarda da ovest: il flusso corre dal basso verso l'alto.
const PORTRAIT = { dir: [-0.62, 0.78, 0.1], target: [12, 0, -20], vspan: 360 };

// Molla a smorzamento critico, soluzione esatta: nessuna oscillazione, nessun superamento.
function spring(x, v, target, omega, dt) {
  const d = x - target;
  const e = Math.exp(-omega * dt);
  const k = (v + omega * d) * dt;
  return [target + (d + k) * e, (v - omega * k) * e];
}

const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

function coloured(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function box(w, h, d, x, y, z, hex) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return coloured(g, hex);
}

// Camion lungo l'asse x, muso verso +x, ruote a terra.
function truckGeometry() {
  const parts = [
    box(2.4, 2.7, 2.5, 3.5, 2.05, 0, COLORS.cab),
    box(9.2, 0.5, 2.2, 0, 0.95, 0, COLORS.chassis),
    box(6.4, 1.7, 2.5, -1.0, 2.05, 0, COLORS.bin),
  ];
  for (const x of [3.4, -2.2, -3.6]) for (const z of [-1.15, 1.15]) parts.push(box(1.1, 1.1, 0.4, x, 0.55, z, COLORS.wheel));
  return mergeGeometries(parts);
}

function label(text, cls = '') {
  const el = document.createElement('div');
  el.className = `twin-label ${cls}`.trim();
  el.textContent = text;
  return new CSS2DObject(el);
}

export function createTwin(host, { onSelect, reducedMotion }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-hidden', 'true');

  const labels = new CSS2DRenderer();
  labels.domElement.className = 'twin-labels';
  host.appendChild(labels.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sky);
  scene.fog = new THREE.Fog(COLORS.sky, 420, 1100);

  const camera = new THREE.PerspectiveCamera(32, 1, 1, 3000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = 1.38;
  controls.minDistance = 30;
  controls.maxDistance = 900;
  controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0x1a1a1e, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 1.9);
  sun.position.set(-160, 260, 160);
  sun.target.position.set(20, 0, -16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -260, right: 260, top: 160, bottom: -160, near: 50, far: 700 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: COLORS.ground, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
  const grid = new THREE.GridHelper(1400, 70, 0x1d1d21, 0x1a1a1d);
  grid.position.y = 0.01;
  scene.add(grid);

  const mats = {
    pad: new THREE.MeshStandardMaterial({ color: COLORS.pad, roughness: 1 }),
    build: new THREE.MeshStandardMaterial({ color: COLORS.build, roughness: 0.9 }),
    edge: new THREE.LineBasicMaterial({ color: COLORS.edge }),
    mark: new THREE.LineBasicMaterial({ color: COLORS.mark }),
    tomato: new THREE.MeshStandardMaterial({ color: COLORS.tomato, roughness: 0.7 }),
    water: new THREE.MeshStandardMaterial({ color: 0x1c1c20, roughness: 0.4 }),
    idle: new THREE.MeshStandardMaterial({ color: COLORS.idle, roughness: 0.8 }),
    ring: new THREE.MeshBasicMaterial({ color: COLORS.tomato, side: THREE.DoubleSide }),
  };

  let site = new THREE.Group();
  scene.add(site);
  let parts = null; // pezzi animati della pianta: sonde, getti, vasche, nastro, etichette

  function solid(group, w, h, d, x, y, z, mat = mats.build, edges = true) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
    if (edges) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), mats.edge);
      e.position.copy(m.position);
      group.add(e);
    }
    return m;
  }

  function pad(group, x0, x1, z0, z1) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), mats.pad);
    m.rotation.x = -Math.PI / 2;
    m.position.set((x0 + x1) / 2, 0.03, (z0 + z1) / 2);
    m.receiveShadow = true;
    group.add(m);
  }

  // Linee di corsia di un'area di sosta.
  function lanes(group, area) {
    const pts = [];
    const back = area.front - (area.depth - 1) * SLOT - 6;
    for (let l = 0; l <= area.lanes; l++) {
      const z = across(l - 0.5, area.lanes, LANE);
      pts.push(back, 0.06, z, area.front + 6, 0.06, z);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    group.add(new THREE.LineSegments(g, mats.mark));
    return { back, z0: across(-0.5, area.lanes, LANE), z1: across(area.lanes - 0.5, area.lanes, LANE) };
  }

  function place(group, obj, x, y, z) {
    obj.position.set(x, y, z);
    group.add(obj);
    return obj;
  }

  // Costruisce la pianta per un numero di postazioni, baie e vasche.
  function buildSite(p) {
    scene.remove(site);
    site.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.isCSS2DObject) o.element.remove();
    });
    site = new THREE.Group();
    scene.add(site);
    const g = site;

    // Strade e aree di sosta.
    pad(g, ZONES.road.from, ZONES.road.to + 8, ZONES.road.z - 4, ZONES.road.z + 4);
    const yard = lanes(g, ZONES.yard);
    pad(g, yard.back, ZONES.gateX + 4, yard.z0, yard.z1);
    pad(g, ZONES.road.to - 4, ZONES.road.to + 8, yard.z1, ZONES.road.z + 4);
    const res = lanes(g, ZONES.result);
    pad(g, ZONES.gateX, ZONES.bayX + 10, MID_Z - 26, MID_Z + 26);
    const dock = lanes(g, ZONES.dock);
    pad(g, ZONES.exit.to, ZONES.bayX + 20, ZONES.exit.z - 4, ZONES.exit.z + 4);
    pad(g, ZONES.result.front + 4, ZONES.result.front + 12, ZONES.exit.z, MID_Z - 26);
    pad(g, ZONES.bayX + 12, ZONES.bayX + 20, ZONES.exit.z, MID_Z);

    // Cancello: sbarra sul fronte del piazzale e casotto.
    const gz0 = yard.z0;
    const gz1 = yard.z1;
    solid(g, 0.6, 5, 0.6, ZONES.gateX, 2.5, gz0 - 1);
    solid(g, 0.6, 5, 0.6, ZONES.gateX, 2.5, gz1 + 1);
    solid(g, 0.5, 0.5, gz1 - gz0 + 2, ZONES.gateX, 5, (gz0 + gz1) / 2);
    solid(g, 5, 3.5, 5, ZONES.gateX - 2, 1.75, gz1 + 6);

    // Postazioni di carotaggio: portale con sonda.
    const probes = [];
    for (let s = 0; s < p.stations; s++) {
      const z = stationZ(s, p.stations);
      solid(g, 0.5, 7, 0.5, ZONES.stationX, 3.5, z - 2.9);
      solid(g, 0.5, 7, 0.5, ZONES.stationX, 3.5, z + 2.9);
      solid(g, 3, 0.6, 6.3, ZONES.stationX, 7.2, z);
      probes.push(solid(g, 0.35, 3, 0.35, ZONES.stationX - 1, 5.4, z, mats.idle, false));
    }
    solid(g, 14, 5, 10, ZONES.lab.x, 2.5, ZONES.lab.z);

    // Baie di scarico sotto una tettoia, canale verso le vasche.
    const bz0 = bayZ(0, p.bays) - 5;
    const bz1 = bayZ(p.bays - 1, p.bays) + 5;
    solid(g, 20, 0.6, bz1 - bz0, ZONES.bayX, 9, (bz0 + bz1) / 2);
    for (const z of [bz0, bz1]) for (const x of [ZONES.bayX - 9.5, ZONES.bayX + 9.5]) solid(g, 0.6, 9, 0.6, x, 4.5, z);
    const streams = [];
    for (let b = 0; b < p.bays; b++) {
      const z = bayZ(b, p.bays);
      const st = solid(g, 2.2, 0.7, 2, ZONES.bayX - 6.4, 1.4, z, mats.tomato, false);
      st.visible = false;
      streams.push(st);
    }
    const tz0 = tankZ(0, p.tanks) - ZONES.tankSize / 2;
    const tz1 = tankZ(p.tanks - 1, p.tanks) + ZONES.tankSize / 2;
    const flumeX = ZONES.tankX - ZONES.tankSize / 2 - 4;
    solid(g, 2.4, 0.8, Math.max(tz1, bz1) - Math.min(tz0, bz0), flumeX, 0.4, (Math.min(tz0, bz0) + Math.max(tz1, bz1)) / 2, mats.water);
    for (let b = 0; b < p.bays; b++) solid(g, flumeX - ZONES.bayX - 6, 0.8, 2, (ZONES.bayX + 7 + flumeX) / 2 - 0.5, 0.4, bayZ(b, p.bays), mats.water);

    // Vasche: pareti basse e riempimento rosso.
    const fills = [];
    const tankLabels = [];
    const s2 = ZONES.tankSize;
    for (let k = 0; k < p.tanks; k++) {
      const z = tankZ(k, p.tanks);
      const x = ZONES.tankX;
      solid(g, s2, 4, 0.5, x, 2, z - s2 / 2);
      solid(g, s2, 4, 0.5, x, 2, z + s2 / 2);
      solid(g, 0.5, 4, s2, x - s2 / 2, 2, z);
      solid(g, 0.5, 4, s2, x + s2 / 2, 2, z);
      const f = new THREE.Mesh(new THREE.BoxGeometry(s2 - 0.6, 1, s2 - 0.6).translate(0, 0.5, 0), mats.tomato);
      f.position.set(x, 0.05, z);
      f.receiveShadow = true;
      g.add(f);
      fills.push(f);
      tankLabels.push(place(g, label('', 'twin-label--small'), x + s2 / 2 + 7, 1, z));
    }

    // Edificio della linea e nastro dalle vasche.
    const pl = ZONES.plant;
    solid(g, pl.w, pl.h, pl.d, pl.x, pl.h / 2, pl.z);
    const beltX0 = ZONES.tankX + s2 / 2 + 1;
    const beltX1 = pl.x - pl.w / 2;
    solid(g, beltX1 - beltX0, 0.6, 2.4, (beltX0 + beltX1) / 2, 2.2, MID_Z, mats.water);
    const crates = new THREE.InstancedMesh(new THREE.BoxGeometry(1.1, 0.8, 1.6), mats.tomato, 16);
    crates.castShadow = true;
    g.add(crates);

    const zone = (text, x, z, y = 10) => place(g, label(text), x, y, z);
    parts = {
      probes,
      streams,
      fills,
      tankLabels,
      crates,
      belt: { x0: beltX0, x1: beltX1 },
      labels: {
        gate: zone('', -110, yard.z0 - 6),
        overflow: zone('', ZONES.road.to - 40, ZONES.road.z + 9, 4),
        sample: zone('', ZONES.stationX, stationZ(0, p.stations) - 6, 12),
        lab: zone('Lab', ZONES.lab.x - 16, ZONES.lab.z - 4, 6),
        result: zone('', (ZONES.result.front + res.back) / 2, res.z1 + 5, 4),
        dock: zone('', (ZONES.dock.front + dock.back) / 2, dock.z0 - 4),
        unload: zone('', ZONES.bayX, bz0 - 4, 12),
        tanks: zone('', ZONES.tankX, tz0 - 6, 7),
        line: zone('', pl.x, pl.z - pl.d / 2 - 4, pl.h + 4),
      },
    };
  }

  // Camion.
  const bodyMesh = new THREE.InstancedMesh(truckGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 }), MAX_TRUCKS);
  const loadGeo = new THREE.BoxGeometry(6, 1, 2.2).translate(-1.0, 0.5, 0);
  const loadMesh = new THREE.InstancedMesh(loadGeo, mats.tomato, MAX_TRUCKS);
  for (const m of [bodyMesh, loadMesh]) {
    m.castShadow = true;
    m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(m);
  }
  const ring = new THREE.Mesh(new THREE.RingGeometry(7, 7.6, 64), mats.ring);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  ring.visible = false;
  scene.add(ring);

  const pos = { x: new Float32Array(MAX_TRUCKS), z: new Float32Array(MAX_TRUCKS), vx: new Float32Array(MAX_TRUCKS), vz: new Float32Array(MAX_TRUCKS), h: new Float32Array(MAX_TRUCKS), hv: new Float32Array(MAX_TRUCKS) };
  const shown = new Uint8Array(MAX_TRUCKS);
  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const v3 = new THREE.Vector3();
  const sc = new THREE.Vector3();
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);

  let result = null;
  let current = null;
  let selected = null;
  let siteKey = '';
  let follow = false;
  let camGoal = null;
  const camVel = { p: new THREE.Vector3(), t: new THREE.Vector3() };

  function setResult(r) {
    result = r;
    const p = r.params;
    const key = `${p.stations}/${p.bays}/${p.tanks}`;
    if (key !== siteKey) {
      buildSite(p);
      siteKey = key;
    }
    shown.fill(0);
    bodyMesh.count = Math.min(MAX_TRUCKS, r.trucks.length);
    loadMesh.count = bodyMesh.count;
  }

  // Aggiorna la scena al minuto t. snap: i camion saltano subito al loro posto (trascinamento).
  function update(t, dt, snap = false) {
    if (!result) return null;
    const p = result.params;
    const f = frame(result, t);
    current = f;
    const omega = reducedMotion ? 60 : 7;
    const n = bodyMesh.count;
    for (let i = 0; i < n; i++) {
      const s = f.trucks[i];
      if (!s.visible) {
        bodyMesh.setMatrixAt(i, zero);
        loadMesh.setMatrixAt(i, zero);
        shown[i] = 0;
        continue;
      }
      if (snap || !shown[i]) {
        pos.x[i] = s.x;
        pos.z[i] = s.z;
        pos.vx[i] = 0;
        pos.vz[i] = 0;
        pos.h[i] = s.heading;
        pos.hv[i] = 0;
        shown[i] = 1;
      } else {
        [pos.x[i], pos.vx[i]] = spring(pos.x[i], pos.vx[i], s.x, omega, dt);
        [pos.z[i], pos.vz[i]] = spring(pos.z[i], pos.vz[i], s.z, omega, dt);
        const speed = Math.hypot(pos.vx[i], pos.vz[i]);
        // In movimento il muso segue la velocità, da fermo torna alla direzione del posto.
        const aim = speed > 3 ? Math.atan2(-pos.vz[i], pos.vx[i]) : s.heading;
        const goal = pos.h[i] + wrap(aim - pos.h[i]);
        [pos.h[i], pos.hv[i]] = spring(pos.h[i], pos.hv[i], goal, omega * 1.2, dt);
      }
      q.setFromAxisAngle(up, pos.h[i]);
      v3.set(pos.x[i], 0, pos.z[i]);
      m4.compose(v3, q, sc.set(1, 1, 1));
      bodyMesh.setMatrixAt(i, m4);
      if (s.load > 0.01) {
        v3.set(pos.x[i], 2.9, pos.z[i]);
        m4.compose(v3, q, sc.set(1, 0.05 + 1.1 * s.load, 1));
        loadMesh.setMatrixAt(i, m4);
      } else {
        loadMesh.setMatrixAt(i, zero);
      }
    }
    bodyMesh.instanceMatrix.needsUpdate = true;
    loadMesh.instanceMatrix.needsUpdate = true;

    // Pianta: sonde, getti di scarico, vasche, nastro.
    const busyStation = new Array(p.stations).fill(-1);
    const busyBay = new Array(p.bays).fill(false);
    for (let i = 0; i < n; i++) {
      const s = f.trucks[i];
      if (s.phase === 'sample') busyStation[result.trucks[i].station] = s.progress;
      if (s.phase === 'unload') busyBay[result.trucks[i].bay] = true;
    }
    parts.probes.forEach((pr, s) => {
      const pg = busyStation[s];
      pr.position.y = pg >= 0 ? 5.4 - 2.6 * Math.abs(Math.sin(pg * Math.PI * 3)) : 5.4;
      pr.material = pg >= 0 ? mats.tomato : mats.idle;
    });
    parts.streams.forEach((st, b) => (st.visible = busyBay[b]));

    const m = result.minutes;
    const t0 = Math.min(m.count - 1, Math.max(0, Math.floor(t)));
    const t1 = Math.min(m.count - 1, t0 + 1);
    const a = Math.min(1, Math.max(0, t - t0));
    let inTanks = 0;
    parts.fills.forEach((fill, k) => {
      const lv = m.levels[t0 * p.tanks + k] * (1 - a) + m.levels[t1 * p.tanks + k] * a;
      inTanks += lv;
      const frac = lv / p.tankCap;
      fill.scale.y = Math.max(0.02, frac * 3.6);
      fill.visible = frac > 0.004;
      parts.tankLabels[k].element.textContent = `${Math.round(frac * 100)}%`;
    });

    const line = m.line[t0];
    const L = parts.belt.x1 - parts.belt.x0;
    const spacing = L / parts.crates.count;
    const offset = line === LINE.RUNNING ? (t * 6) % spacing : 0;
    for (let c = 0; c < parts.crates.count; c++) {
      if (line === LINE.STARVED) {
        parts.crates.setMatrixAt(c, zero);
        continue;
      }
      m4.makeTranslation(parts.belt.x0 + c * spacing + offset + spacing / 2, 2.9, MID_Z);
      parts.crates.setMatrixAt(c, m4);
    }
    parts.crates.material = line === LINE.STOPPED ? mats.idle : mats.tomato;
    parts.crates.instanceMatrix.needsUpdate = true;

    const c = f.counts;
    const L2 = parts.labels;
    L2.gate.element.textContent = `Gate queue  ${c.gate}`;
    L2.overflow.element.textContent = c.overflowGate ? `+${c.overflowGate} on the road` : '';
    L2.overflow.element.hidden = !c.overflowGate;
    L2.sample.element.textContent = `Core sampling  ${c.sample}/${p.stations}`;
    L2.result.element.textContent = `Lab result  ${c.result}`;
    L2.dock.element.textContent = `Unloading queue  ${c.dock}${c.overflowDock ? ` (+${c.overflowDock} out of view)` : ''}`;
    L2.unload.element.textContent = `Unloading  ${c.unload}/${p.bays}`;
    L2.tanks.element.textContent = `Tanks  ${Math.round(inTanks)} t`;
    L2.line.element.textContent = line === LINE.RUNNING ? 'Line  running' : line === LINE.STOPPED ? 'Line  stopped' : 'Line  no product';
    L2.line.element.dataset.state = line === LINE.RUNNING ? 'on' : 'off';

    // Anello sotto il camion scelto; la camera lo segue se richiesto.
    const sel = selected !== null && selected < n && f.trucks[selected].visible ? selected : null;
    ring.visible = sel !== null;
    if (sel !== null) {
      const dx = pos.x[sel] - ring.position.x;
      const dz = pos.z[sel] - ring.position.z;
      ring.position.x = pos.x[sel];
      ring.position.z = pos.z[sel];
      if (follow && !snap && !camGoal) {
        camera.position.x += dx;
        camera.position.z += dz;
        controls.target.x += dx;
        controls.target.z += dz;
      }
    }
    return { frame: f, inTanks, line };
  }

  const lp = new THREE.Vector3();
  function render(dt) {
    if (camGoal) {
      const w = 5;
      for (const axis of ['x', 'y', 'z']) {
        [camera.position[axis], camVel.p[axis]] = spring(camera.position[axis], camVel.p[axis], camGoal.pos[axis], w, dt);
        [controls.target[axis], camVel.t[axis]] = spring(controls.target[axis], camVel.t[axis], camGoal.target[axis], w, dt);
      }
      if (camera.position.distanceTo(camGoal.pos) < 0.3 && controls.target.distanceTo(camGoal.target) < 0.3) camGoal = null;
    }
    controls.update();
    renderer.render(scene, camera);
    // Le etichette troppo vicine al bordo del riquadro si nascondono invece di essere tagliate.
    if (parts) {
      const w = host.clientWidth;
      // Da lontano restano solo le etichette principali: le piccole si sovrappongono.
      const far = camera.position.distanceTo(controls.target) > 190;
      const minor = new Set([parts.labels.lab, parts.labels.result, parts.labels.dock, ...parts.tankLabels]);
      for (const obj of [...Object.values(parts.labels), ...parts.tankLabels]) {
        if (far && minor.has(obj)) { obj.visible = false; continue; }
        lp.copy(obj.position).project(camera);
        const px = ((lp.x + 1) / 2) * w;
        const half = obj.element.offsetWidth / 2 || 40;
        obj.visible = lp.z < 1 && px - half > 12 && px + half < w - 12;
      }
    }
    labels.render(scene, camera);
  }

  function moveCamera(pos3, target3) {
    if (reducedMotion) {
      camera.position.copy(pos3);
      controls.target.copy(target3);
      camGoal = null;
      return;
    }
    camVel.p.set(0, 0, 0);
    camVel.t.set(0, 0, 0);
    camGoal = { pos: pos3, target: target3 };
  }

  function view(name) {
    follow = name === 'segui';
    if (follow) {
      if (selected === null) return;
      const x = pos.x[selected];
      const z = pos.z[selected];
      moveCamera(new THREE.Vector3(x - 55, 48, z + 70), new THREE.Vector3(x, 0, z));
      return;
    }
    const [p3, t3] = fit(VIEWS[name]);
    moveCamera(p3, t3);
  }

  // Distanza della camera perché la larghezza span entri nel quadro, qualunque sia il formato.
  function fit(v) {
    if (v === VIEWS.panoramica && camera.aspect < 1) v = PORTRAIT;
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const d = v.vspan ? v.vspan / 2 / half : v.span / 2 / (half * Math.min(camera.aspect, 1.45)) * 0.92;
    const target = new THREE.Vector3(...v.target);
    return [new THREE.Vector3(...v.dir).normalize().multiplyScalar(d).add(target), target];
  }
  let userMoved = false;

  // L'utente che trascina la camera interrompe il movimento automatico.
  controls.addEventListener('start', () => {
    camGoal = null;
    userMoved = true;
  });

  // Tocco su un camion: lo seleziona. Un trascinamento non conta come tocco.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY };
  });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    bodyMesh.computeBoundingSphere();
    const hit = ray.intersectObject(bodyMesh)[0];
    onSelect(hit ? hit.instanceId : null);
  });

  function resize() {
    const w = host.clientWidth;
    const h = host.clientHeight;
    renderer.setSize(w, h);
    labels.setSize(w, h);
    camera.aspect = w / h;
    // Su schermi stretti la camera si allontana per tenere tutto l'impianto nel quadro.
    camera.fov = w / h < 1 ? 45 : 30;
    camera.updateProjectionMatrix();
    // Finché l'utente non muove la camera, la panoramica si adatta al riquadro.
    if (!userMoved && !follow) {
      const [p3, t3] = fit(VIEWS.panoramica);
      camera.position.copy(p3);
      controls.target.copy(t3);
      controls.update();
    }
  }
  new ResizeObserver(resize).observe(host);
  resize();

  return {
    setResult,
    update,
    render,
    view,
    select(id) {
      selected = id;
      if (id === null && follow) follow = false;
    },
    get following() {
      return follow;
    },
  };
}
