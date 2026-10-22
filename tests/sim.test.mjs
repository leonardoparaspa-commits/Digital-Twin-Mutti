// Test del modello: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulate, SCENARIOS } from '../sim.js';

test('le tonnellate si conservano: iniziali + consegnate = lavorate + ancora nelle vasche', () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    for (const mode of ['libero', 'piano']) {
      const { kpi } = simulate({ scenario, mode, trucks: SCENARIOS[scenario].trucks });
      const inflow = kpi.initialTons + kpi.deliveredTons;
      assert.ok(Math.abs(inflow - (kpi.processedTons + kpi.inTanksTons)) < 1e-6, `${scenario}/${mode}`);
    }
  }
});

test('ogni camion finisce accettato o rifiutato, e tutti vengono processati', () => {
  const { kpi } = simulate({ scenario: 'picco', mode: 'libero' });
  assert.equal(kpi.accepted + kpi.rejected, kpi.trucks);
  assert.equal(kpi.trucks, 260);
});

test('con il rifiuto a zero nessun camion viene respinto', () => {
  const { kpi } = simulate({ rejectRate: 0 });
  assert.equal(kpi.rejected, 0);
});

test('gli slot pianificati riducono la coda massima nel giorno di picco', () => {
  const free = simulate({ scenario: 'picco', mode: 'libero' }).kpi;
  const plan = simulate({ scenario: 'picco', mode: 'piano' }).kpi;
  assert.ok(plan.gateQueueMax < free.gateQueueMax, `${plan.gateQueueMax} < ${free.gateQueueMax}`);
});

test('la stessa configurazione dà sempre lo stesso risultato (seme fisso)', () => {
  const a = simulate({ scenario: 'pioggia' }).kpi;
  const b = simulate({ scenario: 'pioggia' }).kpi;
  assert.deepEqual(a, b);
});

test('una linea ferma allunga il tempo fino allo scarico, non la coda al cancello', () => {
  const base = simulate({ scenario: 'picco', mode: 'libero' }).kpi;
  const stop = simulate({ scenario: 'linea', mode: 'libero' }).kpi;
  assert.ok(stop.dockWaitMax > base.dockWaitMax, `${stop.dockWaitMax} > ${base.dockWaitMax}`);
  assert.equal(stop.gateQueueMax, base.gateQueueMax);
});

test('la pioggia lascia la linea senza prodotto, con o senza slot', () => {
  for (const mode of ['libero', 'piano']) {
    const { kpi } = simulate({ scenario: 'pioggia', mode });
    assert.ok(kpi.starvedHours > 2, `${mode}: ${kpi.starvedHours}`);
  }
});

test('all’inizio campagna le vasche partono vuote', () => {
  const { kpi } = simulate({ scenario: 'avvio', trucks: 100 });
  assert.equal(kpi.initialTons, 0);
  assert.equal(kpi.trucks, 100);
});

test('la linea lavora dal primo minuto, tranne nello scenario della linea ferma', () => {
  const { series } = simulate({ scenario: 'picco', mode: 'piano' });
  const atOneHour = series.find((x) => x.t === 60);
  assert.ok(atOneHour.processed > 240, `lavorate nella prima ora: ${atOneHour.processed}`);
  const stop = simulate({ scenario: 'linea', mode: 'piano' }).series;
  const at10 = stop.find((x) => x.t === 600).processed;
  const at14 = stop.find((x) => x.t === 840).processed;
  assert.ok(at14 - at10 < 5, `lavorate durante la fermata: ${at14 - at10}`);
});

test('ogni camion passa le fasi in ordine e le risorse non sono mai sovraccariche', () => {
  for (const scenario of Object.keys(SCENARIOS)) {
    for (const mode of ['libero', 'piano']) {
      const r = simulate({ scenario, mode, trucks: SCENARIOS[scenario].trucks });
      const p = r.params;
      for (const x of r.trucks) {
        assert.ok(x.sampleStart >= x.arr);
        assert.equal(x.resultAt, x.sampleStart + p.sampleMin + p.labMin);
        if (x.rejected) {
          assert.equal(x.bay, -1);
          continue;
        }
        assert.ok(x.unloadStart >= x.resultAt);
        assert.equal(x.deposit, x.unloadStart + p.unloadMin);
        assert.ok(x.bay >= 0 && x.bay < p.bays && x.tank >= 0 && x.tank < p.tanks);
      }
      const busy = (key, start, end) => {
        const byRes = new Map();
        for (const x of r.trucks) {
          if (x[key] < 0 || x[start] === null) continue;
          const list = byRes.get(x[key]) ?? [];
          list.push([x[start], end(x)]);
          byRes.set(x[key], list);
        }
        for (const list of byRes.values()) {
          list.sort((a, b) => a[0] - b[0]);
          for (let i = 1; i < list.length; i++) assert.ok(list[i][0] >= list[i - 1][1]);
        }
      };
      busy('station', 'sampleStart', (x) => x.sampleStart + p.sampleMin);
      busy('bay', 'unloadStart', (x) => x.deposit);
      const { levels, count } = r.minutes;
      for (let i = 0; i < count * p.tanks; i++) assert.ok(levels[i] >= -1e-6 && levels[i] <= p.tankCap + 1e-6);
    }
  }
});
