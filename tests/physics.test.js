import { test } from 'node:test';
import assert from 'node:assert/strict';

import { NBodySystem } from '../src/physics/nbody.js';
import { keplerToState, orbitalElements, classifyPlanet, analyzeHierarchy } from '../src/physics/orbit.js';
import { starProperties, blackbodyColor, luminosity, radius } from '../src/physics/stellar.js';
import { buildPreset, PRESETS } from '../src/physics/presets.js';
import { G } from '../src/physics/constants.js';

const sub = (a, b) => a.map((c, k) => c - b[k]);

function run(sys, tEnd) {
  while (sys.t < tEnd) sys.step(tEnd);
  return sys;
}

test('单位制：G = 4π²，地球绕太阳周期为 1 年', () => {
  const st = keplerToState({ a: 1, e: 0, M: 1 });
  const sys = new NBodySystem([
    { mass: 1, radius: 0, pos: [0, 0, 0], vel: [0, 0, 0] },
    { mass: 1e-12, radius: 0, pos: st.pos, vel: st.vel },
  ]);
  run(sys, 1);
  const d = Math.hypot(...sub(sys.pos(1), st.pos));
  assert.ok(d < 1e-6, `一年后偏离初始位置 ${d} AU`);
  assert.ok(Math.abs(G - 39.478417604) < 1e-8);
});

test('Hermite 积分器：高偏心率开普勒轨道 100 圈能量守恒', () => {
  const st = keplerToState({ a: 1, e: 0.9, nu: 0, M: 1 });
  const sys = new NBodySystem([
    { mass: 0.5, radius: 0, pos: st.pos.map(c => -c / 2), vel: st.vel.map(c => -c / 2) },
    { mass: 0.5, radius: 0, pos: st.pos.map(c => c / 2), vel: st.vel.map(c => c / 2) },
  ]);
  const E0 = sys.energy();
  run(sys, 100);
  const err = Math.abs((sys.energy() - E0) / E0);
  assert.ok(err < 1e-6, `相对能量误差 ${err}`);
  const el = orbitalElements(sub(sys.pos(1), sys.pos(0)), sub(sys.vel(1), sys.vel(0)), 1);
  assert.ok(Math.abs(el.e - 0.9) < 1e-5, `偏心率漂移到 ${el.e}`);
});

test('8 字形解：一个周期后回到初始构型', () => {
  const { bodies } = buildPreset('figure8');
  const stars = bodies.filter(b => b.kind === 'star');
  const sys = new NBodySystem(stars);
  const x0 = Array.from(sys.x);
  const E0 = sys.energy();
  // 无量纲周期 6.32591398，换算：t_unit = sqrt(L³/(G M))
  const T = 6.32591398 * Math.sqrt(0.25 ** 3 / G);
  run(sys, T);
  let maxd = 0;
  for (let i = 0; i < 3; i++) maxd = Math.max(maxd, Math.hypot(...sub(sys.pos(i), x0.slice(3 * i, 3 * i + 3))));
  assert.ok(maxd < 1e-4 * 0.25 * 10, `一个周期后偏差 ${maxd} AU`);
  assert.ok(Math.abs((sys.energy() - E0) / E0) < 1e-9);
});

test('毕达哥拉斯三体：最轻的恒星被抛射，其余两颗形成双星', () => {
  const { bodies } = buildPreset('pythagorean');
  const sys = new NBodySystem(bodies, { eta: 0.0005 });
  const E0 = sys.energy();
  const tUnit = Math.sqrt(1 / (G * 0.25));
  run(sys, 80 * tUnit);
  const err = Math.abs((sys.energy() - E0) / E0);
  assert.ok(err < 1e-5, `能量误差 ${err}`);
  const h = analyzeHierarchy(sys);
  assert.deepEqual(h.escaped, [0], `逃逸者应为质量 3 的恒星，实际 ${h.escaped}`);
  assert.deepEqual([...h.inner.pair].sort(), [1, 2]);
});

test('恒星模型：太阳标定与黑体颜色', () => {
  const sun = starProperties(1);
  assert.equal(luminosity(1), 1);
  assert.equal(radius(1), 1);
  assert.ok(Math.abs(sun.Teff - 5772) < 1);
  assert.match(sun.spectral, /^G\dV$/);
  const red = blackbodyColor(3000), blue = blackbodyColor(15000);
  assert.ok(red[0] > red[2] * 2, 'M 型星应偏红');
  assert.ok(blue[2] > blue[0], 'B 型星应偏蓝');
});

test('行星分类：随机三体世界开局时行星以 S 型轨道绕恒星 A', () => {
  for (const seed of [1, 2, 3, 42, 2024]) {
    const { bodies } = buildPreset('trisolaris', seed);
    const sys = new NBodySystem(bodies);
    const p = sys.indexOf('planet');
    const c = classifyPlanet(sys, p);
    assert.equal(c.type, 'S', `seed ${seed}`);
    assert.equal(sys.meta[c.host[0]].id, 0);
    // 质心系
    const com = sys.centerOfMass();
    assert.ok(Math.hypot(...com.pos) < 1e-9 && Math.hypot(...com.vel) < 1e-9);
  }
});

test('行星分类：环双星世界为 P 型，且层级稳定', () => {
  const { bodies } = buildPreset('tatooine');
  const sys = new NBodySystem(bodies);
  const c = classifyPlanet(sys, sys.indexOf('planet'));
  assert.equal(c.type, 'P');
  const h = analyzeHierarchy(sys);
  assert.equal(h.kind, 'hierarchical');
});

test('所有预设都能构建并积分', () => {
  for (const key of Object.keys(PRESETS)) {
    const { bodies } = buildPreset(key, 7);
    const sys = new NBodySystem(bodies);
    run(sys, 0.5);
    assert.ok(Number.isFinite(sys.energy()), key);
  }
});
