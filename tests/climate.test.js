import { test } from 'node:test';
import assert from 'node:assert/strict';

import { Climate, olr, absorbed, iceFraction } from '../src/climate/ebm.js';
import { Civilization } from '../src/climate/civilization.js';
import { EraTracker } from '../src/climate/era.js';
import { S0 } from '../src/physics/constants.js';

test('能量平衡模型：地球标定为 288 K', () => {
  assert.ok(Math.abs(olr(288) - absorbed(S0, 288)) < 1e-6);
  const T = Climate.equilibrium(S0, 288);
  assert.ok(Math.abs(T - 288) < 0.5, `T = ${T}`);
});

test('冰-反照率反馈：辐照减半进入雪球态，且存在滞后', () => {
  const cold = Climate.equilibrium(0.6 * S0, 288);
  assert.ok(cold < 240, `0.6 S₀ 应进入雪球，T = ${cold}`);
  // 多稳态：同一辐照下，从冰封和从温暖出发得到不同平衡
  const fromWarm = Climate.equilibrium(0.9 * S0, 288);
  const fromIce = Climate.equilibrium(0.9 * S0, 200);
  assert.ok(fromWarm - fromIce > 30, `应存在双稳态：${fromWarm} vs ${fromIce}`);
  assert.ok(iceFraction(fromIce) > 0.9);
});

test('失控温室：辐照超过约 1.2 S₀ 后温度跃升', () => {
  const T = Climate.equilibrium(1.3 * S0, 288);
  assert.ok(T > 500, `T = ${T}`);
  const mild = Climate.equilibrium(1.05 * S0, 288);
  assert.ok(mild < 320, `T = ${mild}`);
});

test('热惯性：辐照骤降后温度逐渐而非瞬间下降', () => {
  const c = new Climate(288, 50);
  c.step(0.05, 0);
  assert.ok(c.T > 270, `0.05 年后 T = ${c.T}`);
  c.step(3, 0);
  assert.ok(c.T < 240, `3 年无日照后 T = ${c.T}`);
});

test('纪元与文明：恒纪元发展，乱纪元脱水，烈日毁灭', () => {
  const era = new EraTracker();
  const civ = new Civilization();
  let t = 0;
  const events = [];
  const tick = (T, years) => {
    for (let i = 0; i < years / 0.01; i++) {
      t += 0.01;
      era.update(t, 0.01, T);
      const e = civ.update(t, 0.01, T, era.stable);
      if (e) events.push(e.type);
    }
  };
  tick(290, 6);
  assert.ok(era.stable);
  assert.ok(civ.progress > 5);
  tick(250, 1);
  assert.equal(era.stable, false);
  assert.equal(civ.status, 'dehydrated');
  tick(500, 0.5);
  assert.equal(civ.status, 'extinct');
  tick(290, 2);
  assert.equal(civ.number, 2);
  assert.deepEqual(events.slice(0, 4), ['civ-born', 'civ-stage', 'civ-stage', 'civ-dehydrate']);
  assert.ok(events.includes('civ-dehydrate') && events.includes('civ-destroyed'));
});
