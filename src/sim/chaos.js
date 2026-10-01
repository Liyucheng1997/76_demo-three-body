// 混沌度量
// ------------------------------------------------------------
// LyapunovMeter：Benettin 方法估计恒星系统的最大李雅普诺夫指数 λ。
//   在主系统旁积分一个相空间距离为 d₀ 的"影子"系统，每帧测量分离 d，
//   累加 ln(d/d₀) 后把影子拉回距离 d₀ 处（重正化）。λ = Σ ln(d/d₀) / t。
//   李雅普诺夫时间 1/λ 即误差放大 e 倍所需时间 —— 也就是可预测性的极限。
//   同时计算 MEGNO 指标 ⟨Y⟩（Cincotta & Simó 2000）：规则（准周期）运动收敛到 2，
//   混沌运动则随时间线性增长（⟨Y⟩ ≈ λt/2）。它比有限时间 λ 更快、更可靠地区分二者。
//
// TwinUniverse：不做重正化的"孪生宇宙"，初始仅相差 1e-6 AU（约 150 千米），
//   用于直观展示蝴蝶效应。

import { NBodySystem } from '../physics/nbody.js';

const D0 = 1e-9;

/** 相空间距离：位置（AU）+ 速度（AU/yr ÷ 2π，使两者量纲可比） */
function phaseDistance(a, b, idx) {
  let s = 0;
  const w = 1 / (2 * Math.PI);
  for (const i of idx) {
    for (let k = 0; k < 3; k++) {
      const dx = a.x[3 * i + k] - b.x[3 * i + k];
      const dv = (a.v[3 * i + k] - b.v[3 * i + k]) * w;
      s += dx * dx + dv * dv;
    }
  }
  return Math.sqrt(s);
}

function starsOnly(sys) {
  return sys.toBodies().filter(b => b.kind === 'star');
}

export class LyapunovMeter {
  constructor(sys) { this.reset(sys); }

  reset(sys) {
    const stars = starsOnly(sys);
    this.ref = new NBodySystem(stars, { eta: sys.eta });
    this.ref.t = sys.t;
    const shadow = stars.map(b => ({ ...b, pos: [...b.pos], vel: [...b.vel] }));
    // 沿随机方向施加 d₀ 的扰动
    const dir = shadow.map(() => [Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5]);
    const n = Math.hypot(...dir.flat());
    shadow.forEach((b, i) => { b.pos = b.pos.map((c, k) => c + D0 * dir[i][k] / n); });
    this.shadow = new NBodySystem(shadow, { eta: sys.eta });
    this.shadow.t = sys.t;
    this.idx = stars.map((_, i) => i);
    this.t0 = sys.t;
    this.sum = 0;
    this.lambda = 0;
    this._I = 0;        // ∫ s·d(ln δ)
    this._J = 0;        // ∫ Y ds
    this.megno = NaN;
    this._tPrev = sys.t;
    this.ok = stars.length >= 2;
  }

  /** 推进到时刻 t（与主系统同步） */
  advance(t, maxSteps = 200000) {
    if (!this.ok) return;
    for (const s of [this.ref, this.shadow]) {
      let k = 0;
      while (s.t < t && k++ < maxSteps) s.step(t);
      if (s.findCollision()) { this.ok = false; return; }
    }
    const d = phaseDistance(this.ref, this.shadow, this.idx);
    if (!(d > 0) || !Number.isFinite(d)) { this.ok = false; return; }
    const dl = Math.log(d / D0);
    this.sum += dl;
    // MEGNO：Y(t) = (2/t)∫ s·(d ln δ/ds) ds，⟨Y⟩ = (1/t)∫ Y ds
    const s1 = t - this.t0, s0 = this._tPrev - this.t0;
    if (s1 > 0) {
      this._I += 0.5 * (s0 + s1) * dl;
      const Y = 2 * this._I / s1;
      this._J += Y * (s1 - s0);
      this.megno = this._J / s1;
    }
    this._tPrev = t;
    // 重正化
    const f = D0 / d;
    for (let k = 0; k < this.ref.x.length; k++) {
      this.shadow.x[k] = this.ref.x[k] + (this.shadow.x[k] - this.ref.x[k]) * f;
      this.shadow.v[k] = this.ref.v[k] + (this.shadow.v[k] - this.ref.v[k]) * f;
    }
    this.shadow.initForces();
    this.shadow.dt = this.ref.dt;
    const elapsed = t - this.t0;
    if (elapsed > 0) this.lambda = this.sum / elapsed;
  }

  /** 李雅普诺夫时间（年）；规则运动时返回 Infinity */
  get lyapunovTime() {
    return this.lambda > 1e-6 ? 1 / this.lambda : Infinity;
  }
}

export class TwinUniverse {
  constructor(sys, delta = 1e-6) { this.reset(sys, delta); }

  reset(sys, delta = this.delta) {
    this.delta = delta;
    const bodies = sys.toBodies();
    const s = bodies.find(b => b.kind === 'star');
    if (s) s.pos = s.pos.map((c, k) => c + (k === 0 ? delta : 0));
    this.sys = new NBodySystem(bodies, { eta: sys.eta });
    this.sys.t = sys.t;
    this.alive = true;
  }

  advance(t, maxSteps = 200000) {
    if (!this.alive) return;
    let k = 0;
    while (this.sys.t < t && k++ < maxSteps) {
      this.sys.step(t);
      const c = this.sys.findCollision();
      if (c) {
        const [p, q] = c;
        if (this.sys.meta[p].kind === 'star' && this.sys.meta[q].kind === 'star') {
          this.sys.merge(p, q, (A) => ({ ...A }));
        } else {
          this.sys.remove(this.sys.meta[p].kind === 'planet' ? p : q);
        }
      }
    }
  }

  /** 与主宇宙中同 id 天体的最大位置偏差（AU） */
  divergence(sys) {
    let m = 0;
    for (let i = 0; i < sys.n; i++) {
      const j = this.sys.indexOf(sys.meta[i].id);
      if (j < 0) continue;
      m = Math.max(m, Math.hypot(...sys.pos(i).map((c, k) => c - this.sys.x[3 * j + k])));
    }
    return m;
  }
}
