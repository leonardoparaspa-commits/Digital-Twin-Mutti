import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, SCENARIOS } from '../sim.js';
import { frame, queueCurves } from '../layout.js';

test('i conteggi della scena coincidono con le code del modello', () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    const r = simulate({ scenario, trucks: SCENARIOS[scenario].trucks });
    const curves = queueCurves(r);
    for (let t = 0; t < r.minutes.count; t += 7) {
      const f = frame(r, t);
      assert.equal(f.counts.gate, curves.gate[t]);
      assert.equal(f.counts.dock, curves.dock[t]);
      assert.ok(f.counts.sample <= r.params.stations);
      assert.ok(f.counts.unload <= r.params.bays);
    }
  }
});

test('due camion visibili e fermi non occupano mai lo stesso posto', () => {
  const r = simulate({ scenario: 'linea' });
  for (let t = 0; t < r.minutes.count; t += 11) {
    const seen = new Set();
    for (const s of frame(r, t).trucks) {
      if (!s.visible || !['gate', 'sample', 'result', 'dock', 'unload'].includes(s.phase)) continue;
      const key = `${s.x.toFixed(2)},${s.z.toFixed(2)}`;
      assert.ok(!seen.has(key), `posto doppio ${key} al minuto ${t}`);
      seen.add(key);
    }
  }
});
