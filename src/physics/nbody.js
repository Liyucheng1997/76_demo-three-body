// N 体引力积分器：四阶 Hermite 预估-校正 + Aarseth 自适应步长
// ------------------------------------------------------------
// · 纯牛顿引力，无软化 —— 近距离交会靠自适应步长精确解析，而非人为削弱引力。
// · P(EC)² 迭代 Hermite 格式（Kokubo, Yoshinaga & Makino 1998），近似时间对称，
//   长期能量误差远小于 Verlet / RK4。
// · 共享时间步长由 Aarseth (1985) 判据决定，近距离交会时自动缩小到所需精度。
// · 天体半径为物理半径：恒星相撞则合并（动量守恒），行星落入恒星则被吞没。
//
// 本模块不依赖 three.js，可在 Web Worker 和 Node 测试中直接运行。

import { G } from './constants.js';

export class NBodySystem {
  /**
   * @param {Array<{mass:number, radius:number, pos:number[], vel:number[]}>} bodies
   *   每个天体还可以携带任意元数据（name、kind、luminosity …），会原样保存在 meta 中。
   */
  constructor(bodies, { eta = 0.001 } = {}) {
    this.eta = eta;
    this.t = 0;
    this.steps = 0;
    this._setBodies(bodies);
    this.initForces();
  }

  _setBodies(bodies) {
    const n = bodies.length;
    this.n = n;
    this.meta = bodies.map(b => ({ ...b, pos: undefined, vel: undefined }));
    this.m = new Float64Array(n);
    this.R = new Float64Array(n);
    this.x = new Float64Array(3 * n);
    this.v = new Float64Array(3 * n);
    this.a = new Float64Array(3 * n);
    this.j = new Float64Array(3 * n);
    // 积分工作区
    this._x0 = new Float64Array(3 * n); this._v0 = new Float64Array(3 * n);
    this._a0 = new Float64Array(3 * n); this._j0 = new Float64Array(3 * n);
    bodies.forEach((b, i) => {
      this.m[i] = b.mass; this.R[i] = b.radius;
      for (let k = 0; k < 3; k++) { this.x[3 * i + k] = b.pos[k]; this.v[3 * i + k] = b.vel[k]; }
    });
  }

  /** 导出为普通对象数组（用于克隆、合并、传给 Worker） */
  toBodies() {
    return this.meta.map((meta, i) => ({
      ...meta, mass: this.m[i], radius: this.R[i],
      pos: [this.x[3 * i], this.x[3 * i + 1], this.x[3 * i + 2]],
      vel: [this.v[3 * i], this.v[3 * i + 1], this.v[3 * i + 2]],
    }));
  }

  clone() {
    const c = new NBodySystem(this.toBodies(), { eta: this.eta });
    c.t = this.t; c.steps = this.steps; c.dt = this.dt;
    return c;
  }

  // ---------- 引力：加速度 a 与加加速度（jerk）j ----------
  forces(x, v, a, j) {
    const n = this.n, m = this.m;
    a.fill(0); j.fill(0);
    for (let p = 0; p < n; p++) {
      const p3 = 3 * p;
      for (let q = p + 1; q < n; q++) {
        const q3 = 3 * q;
        const rx = x[q3] - x[p3], ry = x[q3 + 1] - x[p3 + 1], rz = x[q3 + 2] - x[p3 + 2];
        const vx = v[q3] - v[p3], vy = v[q3 + 1] - v[p3 + 1], vz = v[q3 + 2] - v[p3 + 2];
        const r2 = rx * rx + ry * ry + rz * rz;
        const inv_r2 = 1 / r2;
        const inv_r3 = inv_r2 * Math.sqrt(inv_r2);
        const rv3 = 3 * (rx * vx + ry * vy + rz * vz) * inv_r2;
        // a = G m r / r³ ；j = G m [v / r³ − 3 (r·v) r / r⁵]
        const ax = rx * inv_r3, ay = ry * inv_r3, az = rz * inv_r3;
        const jx = (vx - rv3 * rx) * inv_r3, jy = (vy - rv3 * ry) * inv_r3, jz = (vz - rv3 * rz) * inv_r3;
        const mq = G * m[q], mp = G * m[p];
        a[p3] += mq * ax; a[p3 + 1] += mq * ay; a[p3 + 2] += mq * az;
        j[p3] += mq * jx; j[p3 + 1] += mq * jy; j[p3 + 2] += mq * jz;
        a[q3] -= mp * ax; a[q3 + 1] -= mp * ay; a[q3 + 2] -= mp * az;
        j[q3] -= mp * jx; j[q3 + 1] -= mp * jy; j[q3 + 2] -= mp * jz;
      }
    }
  }

  /** 初始化力并给出初始步长（a / j 的特征时间） */
  initForces() {
    this.forces(this.x, this.v, this.a, this.j);
    let dt = Infinity;
    for (let i = 0; i < this.n; i++) {
      const a = norm3(this.a, i), j = norm3(this.j, i);
      if (a > 0 && j > 0) dt = Math.min(dt, 0.01 * a / j);
    }
    this.dt = Number.isFinite(dt) ? dt : 1e-3;
  }

  /** 单个 Hermite 步，步长 h。返回 Aarseth 判据建议的下一步长。 */
  _hermiteStep(h) {
    const n3 = 3 * this.n;
    const { x, v, a, j, _x0: x0, _v0: v0, _a0: a0, _j0: j0 } = this;
    x0.set(x); v0.set(v); a0.set(a); j0.set(j);
    const h2 = h * h, h3 = h2 * h;

    // 预估（泰勒展开到 jerk）
    for (let k = 0; k < n3; k++) {
      x[k] = x0[k] + v0[k] * h + a0[k] * h2 / 2 + j0[k] * h3 / 6;
      v[k] = v0[k] + a0[k] * h + j0[k] * h2 / 2;
    }
    // 两次 估值-校正 迭代
    for (let it = 0; it < 2; it++) {
      this.forces(x, v, a, j);
      for (let k = 0; k < n3; k++) {
        v[k] = v0[k] + (a0[k] + a[k]) * h / 2 + (j0[k] - j[k]) * h2 / 12;
      }
      for (let k = 0; k < n3; k++) {
        x[k] = x0[k] + (v0[k] + v[k]) * h / 2 + (a0[k] - a[k]) * h2 / 12;
      }
    }
    this.forces(x, v, a, j);

    // Aarseth 判据：由端点处的 a, j 及插值得到的 snap、crackle 估计下一步长
    let dtNew = Infinity;
    for (let i = 0; i < this.n; i++) {
      let A = 0, J = 0, S = 0, C = 0;
      for (let k = 3 * i; k < 3 * i + 3; k++) {
        const da = a0[k] - a[k];
        const a3 = (12 * da + 6 * h * (j0[k] + j[k])) / h3;
        const a2 = (-6 * da - h * (4 * j0[k] + 2 * j[k])) / h2 + a3 * h;
        A += a[k] * a[k]; J += j[k] * j[k]; S += a2 * a2; C += a3 * a3;
      }
      A = Math.sqrt(A); J = Math.sqrt(J); S = Math.sqrt(S); C = Math.sqrt(C);
      const den = J * C + S * S;
      if (den > 0) dtNew = Math.min(dtNew, Math.sqrt(this.eta * (A * S + J * J) / den));
    }
    return dtNew;
  }

  /**
   * 推进一步（步长不超过 tMax - t，以便精确落在目标时刻）。
   * @returns {number} 实际步长
   */
  step(tMax = Infinity) {
    let h = this.dt;
    let clamped = false;
    if (this.t + h > tMax) { h = tMax - this.t; clamped = true; }
    const suggested = this._hermiteStep(h);
    this.t = clamped ? tMax : this.t + h;
    this.steps++;
    // 被截断的极短步对 snap/crackle 的估计数值不稳，此时保留原步长
    if (!clamped || h > 0.5 * this.dt) {
      const grow = Math.min(suggested, 2 * h);
      if (Number.isFinite(grow) && grow > 0) this.dt = Math.max(grow, 1e-14);
    }
    return h;
  }

  /** 检测物理碰撞（距离小于两者物理半径之和），返回首个碰撞对或 null */
  findCollision() {
    const { n, x, R } = this;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        const dx = x[3 * q] - x[3 * p], dy = x[3 * q + 1] - x[3 * p + 1], dz = x[3 * q + 2] - x[3 * p + 2];
        const rr = R[p] + R[q];
        if (dx * dx + dy * dy + dz * dz < rr * rr) return [p, q];
      }
    }
    return null;
  }

  /**
   * 合并两个天体（完全非弹性碰撞，质量与动量守恒），
   * mergeMeta(a, b, mass) 决定合并后天体的元数据与半径。
   */
  merge(p, q, mergeMeta) {
    const bodies = this.toBodies();
    const A = bodies[p], B = bodies[q];
    const M = A.mass + B.mass;
    const pos = [0, 1, 2].map(k => (A.pos[k] * A.mass + B.pos[k] * B.mass) / M);
    const vel = [0, 1, 2].map(k => (A.vel[k] * A.mass + B.vel[k] * B.mass) / M);
    const merged = { ...mergeMeta(A, B, M), mass: M, pos, vel };
    const keep = Math.min(p, q), drop = Math.max(p, q);
    bodies[keep] = merged;
    bodies.splice(drop, 1);
    this._setBodies(bodies);
    this.initForces();
  }

  /** 移除一个天体 */
  remove(i) {
    const bodies = this.toBodies();
    bodies.splice(i, 1);
    this._setBodies(bodies);
    this.initForces();
  }

  indexOf(id) { return this.meta.findIndex(b => b.id === id); }

  // ---------- 守恒量 ----------
  energy() {
    const { n, m, x, v } = this;
    let K = 0, U = 0;
    for (let i = 0; i < n; i++) {
      K += 0.5 * m[i] * (v[3 * i] ** 2 + v[3 * i + 1] ** 2 + v[3 * i + 2] ** 2);
      for (let k = i + 1; k < n; k++) {
        const r = Math.hypot(x[3 * k] - x[3 * i], x[3 * k + 1] - x[3 * i + 1], x[3 * k + 2] - x[3 * i + 2]);
        U -= G * m[i] * m[k] / r;
      }
    }
    return K + U;
  }

  angularMomentum() {
    const { n, m, x, v } = this;
    const L = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const i3 = 3 * i;
      L[0] += m[i] * (x[i3 + 1] * v[i3 + 2] - x[i3 + 2] * v[i3 + 1]);
      L[1] += m[i] * (x[i3 + 2] * v[i3] - x[i3] * v[i3 + 2]);
      L[2] += m[i] * (x[i3] * v[i3 + 1] - x[i3 + 1] * v[i3]);
    }
    return L;
  }

  centerOfMass(filter = () => true) {
    let M = 0; const c = [0, 0, 0], u = [0, 0, 0];
    for (let i = 0; i < this.n; i++) {
      if (!filter(this.meta[i], i)) continue;
      M += this.m[i];
      for (let k = 0; k < 3; k++) { c[k] += this.m[i] * this.x[3 * i + k]; u[k] += this.m[i] * this.v[3 * i + k]; }
    }
    if (M > 0) for (let k = 0; k < 3; k++) { c[k] /= M; u[k] /= M; }
    return { mass: M, pos: c, vel: u };
  }

  pos(i) { return [this.x[3 * i], this.x[3 * i + 1], this.x[3 * i + 2]]; }
  vel(i) { return [this.v[3 * i], this.v[3 * i + 1], this.v[3 * i + 2]]; }
}

function norm3(arr, i) {
  return Math.hypot(arr[3 * i], arr[3 * i + 1], arr[3 * i + 2]);
}

/** 把一组天体平移到质心系（位置与动量均归零） */
export function toCenterOfMassFrame(bodies) {
  let M = 0; const c = [0, 0, 0], p = [0, 0, 0];
  for (const b of bodies) {
    M += b.mass;
    for (let k = 0; k < 3; k++) { c[k] += b.mass * b.pos[k]; p[k] += b.mass * b.vel[k]; }
  }
  return bodies.map(b => ({
    ...b,
    pos: b.pos.map((x, k) => x - c[k] / M),
    vel: b.vel.map((x, k) => x - p[k] / M),
  }));
}
