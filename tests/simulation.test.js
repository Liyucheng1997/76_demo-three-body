import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Simulation } from '../src/sim/simulation.js';
import { runEnsemble } from '../src/sim/forecast.js';

function runFor(sim, years, dt = 0.05) {
  for (let t = 0; t < years; t += dt) sim.advance(dt, 1e9);
  return sim;
}

test('同一种子可完全复现同一个宇宙', () => {
  const a = new Simulation(), b = new Simulation();
  a.load('trisolaris', 1234); b.load('trisolaris', 1234);
  runFor(a, 20); runFor(b, 20);
  assert.deepEqual(Array.from(a.sys.x), Array.from(b.sys.x));
  assert.equal(a.climate.T, b.climate.T);
});

test('MEGNO：8 字形解为规则运动（⟨Y⟩ → 2），毕达哥拉斯问题为混沌', () => {
  const fig8 = new Simulation(); fig8.load('figure8', 0);
  runFor(fig8, 10, 0.01);
  assert.ok(Math.abs(fig8.analysis.megno - 2) < 0.3, `figure-8 ⟨Y⟩ = ${fig8.analysis.megno}`);

  const pyth = new Simulation(); pyth.load('pythagorean', 0);
  runFor(pyth, 15, 0.01);
  assert.ok(pyth.analysis.megno > 5, `Pythagorean ⟨Y⟩ = ${pyth.analysis.megno}`);
});

test('半人马座 α：层级稳定，行星长期处于恒纪元，能量守恒至 1e-10', () => {
  const sim = new Simulation(); sim.load('alphaCen', 0);
  runFor(sim, 100, 0.1);
  assert.equal(sim.analysis.hierarchy.kind, 'hierarchical');
  assert.ok(sim.era.stable);
  assert.equal(sim.civ.number, 1);
  assert.ok(sim.analysis.energyError < 1e-10, `ΔE/E = ${sim.analysis.energyError}`);
});

test('集合预报：零扰动成员与主模拟一致；较大扰动导致分化', () => {
  const sim = new Simulation(); sim.load('trisolaris', 5);
  runFor(sim, 10);
  const snap = sim.snapshot();
  const fc = runEnsemble(snap, { members: 6, years: 8, sampleDt: 0.1, perturb: 1e-3, seed: 9 });
  // 控制预报（0 号成员）应复现主模拟的未来
  const twin = new Simulation(); twin.load('trisolaris', 5);
  runFor(twin, 10);
  twin.setEta(snap.eta);
  runFor(twin, 5, 0.1);
  const i = Math.round(5 / 0.1);
  assert.ok(Math.abs(fc.control[i] - twin.climate.T) < 5, `${fc.control[i]} vs ${twin.climate.T}`);
  // seed 5 在第 15.6 年进入乱纪元：集合应在预报期内出现分化
  const spread = fc.p90.map((v, k) => v - fc.p10[k]);
  assert.ok(Math.max(...spread) > 20, '集合成员应在混沌交会后显著分化');
});
