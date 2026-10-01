// 集合预报（"智子预测"）
// ------------------------------------------------------------
// 三体人面临的根本问题：能否预测下一个恒纪元？
// 做法与现代天气预报相同 —— 集合预报（ensemble forecast）：
//   以当前状态为中心，加入与观测误差同量级的微小扰动，生成 N 个成员，
//   各自独立积分动力学 + 气候。成员间的发散程度即预报的不确定性。
// 混沌使发散呈指数增长，超过李雅普诺夫时间数倍后预报便失去意义。

import { NBodySystem } from '../physics/nbody.js';
import { S0 } from '../physics/constants.js';
import { Climate } from '../climate/ebm.js';
import { EraTracker } from '../climate/era.js';

function gauss(r) {
  return Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());
}

function insolation(sys, p) {
  let S = 0;
  for (let i = 0; i < sys.n; i++) {
    if (sys.meta[i].kind !== 'star') continue;
    const d2 = (sys.x[3 * i] - sys.x[3 * p]) ** 2 + (sys.x[3 * i + 1] - sys.x[3 * p + 1]) ** 2 + (sys.x[3 * i + 2] - sys.x[3 * p + 2]) ** 2;
    S += sys.meta[i].luminosity * S0 / d2;
  }
  return S;
}

export function runMember(snapshot, years, sampleDt, perturb, rand, maxSteps = 4e6) {
  const bodies = snapshot.bodies.map(b => ({ ...b, pos: [...b.pos], vel: [...b.vel] }));
  if (perturb > 0) {
    for (const b of bodies) {
      if (b.kind !== 'star') continue;
      b.pos = b.pos.map(c => c + perturb * gauss(rand));
      b.vel = b.vel.map(c => c * (1 + perturb * gauss(rand)));
    }
  }
  const sys = new NBodySystem(bodies, { eta: snapshot.eta });
  sys.t = 0;
  const climate = new Climate(snapshot.T, snapshot.mixedLayer);
  const era = new EraTracker();
  Object.assign(era, snapshot.era);
  const n = Math.floor(years / sampleDt) + 1;
  const T = new Float32Array(n).fill(NaN);
  const stable = new Uint8Array(n);
  let p = sys.indexOf(snapshot.planetId);
  let steps = 0;
  for (let s = 0; s < n; s++) {
    const tTarget = s * sampleDt;
    while (sys.t < tTarget && p >= 0 && steps++ < maxSteps) {
      const t0 = sys.t;
      sys.step(tTarget);
      const c = sys.findCollision();
      if (c) {
        const [a, b] = c;
        if (sys.meta[a].kind === 'star' && sys.meta[b].kind === 'star') sys.merge(a, b, A => ({ ...A }));
        else { sys.remove(sys.meta[a].kind === 'planet' ? a : b); p = -1; break; }
        p = sys.indexOf(snapshot.planetId);
      }
      climate.step(sys.t - t0, insolation(sys, p));
      era.update(sys.t, sys.t - t0, climate.T);
    }
    if (p < 0 || steps >= maxSteps) break;
    T[s] = climate.T;
    stable[s] = era.stable ? 1 : 0;
  }
  return { T, stable };
}

function percentile(sorted, q) {
  if (!sorted.length) return NaN;
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * @returns {{t0, times, median, p10, p90, pStable, members}}
 */
export function runEnsemble(snapshot, { members = 16, years = 20, sampleDt = 0.05, perturb = 1e-7, seed = 1, onProgress } = {}) {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const runs = [];
  for (let m = 0; m < members; m++) {
    // 0 号成员为不加扰动的"控制预报"
    runs.push(runMember(snapshot, years, sampleDt, m === 0 ? 0 : perturb, rand));
    if (onProgress) onProgress((m + 1) / members);
  }
  const n = runs[0].T.length;
  const times = new Float32Array(n), median = new Float32Array(n), p10 = new Float32Array(n), p90 = new Float32Array(n), pStable = new Float32Array(n);
  for (let s = 0; s < n; s++) {
    times[s] = snapshot.t + s * sampleDt;
    const vals = [];
    let st = 0;
    for (const r of runs) {
      if (!Number.isNaN(r.T[s])) vals.push(r.T[s]);
      st += r.stable[s];
    }
    vals.sort((x, y) => x - y);
    median[s] = percentile(vals, 0.5);
    p10[s] = percentile(vals, 0.1);
    p90[s] = percentile(vals, 0.9);
    pStable[s] = st / runs.length;
  }
  return { t0: snapshot.t, times, median, p10, p90, pStable, control: runs[0].T, members: runs.map(r => r.T) };
}
