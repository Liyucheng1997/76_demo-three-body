// 轨道力学工具：轨道根数、开普勒→直角坐标、行星轨道分类、系统层级分析
// ------------------------------------------------------------
import { G } from './constants.js';

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = a => Math.hypot(a[0], a[1], a[2]);

/**
 * 由相对位置/速度求密切轨道根数。
 * @param r 相对位置（AU） @param v 相对速度（AU/yr） @param M 两体总质量（M☉）
 */
export function orbitalElements(r, v, M) {
  const mu = G * M;
  const rn = len(r), v2 = dot(v, v);
  const energy = v2 / 2 - mu / rn;            // 比轨道能
  const h = cross(r, v);
  const evec = cross(v, h).map((c, k) => c / mu - r[k] / rn);
  const e = len(evec);
  const a = energy < 0 ? -mu / (2 * energy) : Infinity;
  const period = energy < 0 ? Math.sqrt(a ** 3 / M) : Infinity;   // 年
  const inc = Math.acos(Math.max(-1, Math.min(1, h[1] / (len(h) || 1)))); // 相对 y 轴（参考平面 xz）
  return { energy, a, e, period, inc, h, r: rn, rp: a * (1 - e), ra: a * (1 + e), bound: energy < 0 };
}

/**
 * 开普勒轨道根数 → 相对状态向量。参考平面为 xz 平面（y 轴朝上，与渲染坐标一致）。
 * @param a 半长轴 @param e 偏心率 @param nu 真近点角 @param M 总质量
 * @param inc 倾角 @param omega 近点幅角 @param node 升交点经度（均为弧度）
 */
export function keplerToState({ a, e = 0, nu = 0, M, inc = 0, omega = 0, node = 0 }) {
  const mu = G * M;
  const p = a * (1 - e * e);
  const r = p / (1 + e * Math.cos(nu));
  // 轨道平面内（x 指向近点，z 为轨道运动方向）
  const xo = r * Math.cos(nu), zo = r * Math.sin(nu);
  const f = Math.sqrt(mu / p);
  const vxo = -f * Math.sin(nu), vzo = f * (e + Math.cos(nu));
  // 依次旋转：近点幅角（绕 y）→ 倾角（绕 x）→ 升交点（绕 y）
  const rot = (x, z) => {
    const c1 = Math.cos(omega), s1 = Math.sin(omega);
    let X = c1 * x - s1 * z, Z = s1 * x + c1 * z, Y = 0;
    const c2 = Math.cos(inc), s2 = Math.sin(inc);
    const Y2 = Y * c2 - Z * s2, Z2 = Y * s2 + Z * c2;
    Y = Y2; Z = Z2;
    const c3 = Math.cos(node), s3 = Math.sin(node);
    return [c3 * X - s3 * Z, Y, s3 * X + c3 * Z];
  };
  return { pos: rot(xo, zo), vel: rot(vxo, vzo) };
}

/** 引力加速度（AU/yr²） */
function accel(from, to, M) {
  const d = sub(to, from);
  const r = len(d);
  const f = G * M / (r * r * r);
  return d.map(c => c * f);
}

/**
 * 判定行星当前的动力学状态。
 * 返回 { type: 'S'|'P'|'chaotic'|'unbound', host, elements, perturbation }
 *   S 型：绕单颗恒星运转（如地球绕太阳）
 *   P 型：绕一对紧密双星运转（环双星轨道）
 *   chaotic：被三星系统整体束缚，但在恒星之间无序游荡
 *   unbound：能量为正，正在脱离系统（流浪行星）
 */
export function classifyPlanet(sys, planetIdx) {
  const stars = [];
  for (let i = 0; i < sys.n; i++) if (sys.meta[i].kind === 'star') stars.push(i);
  const pr = sys.pos(planetIdx), pv = sys.vel(planetIdx), pm = sys.m[planetIdx];

  // --- S 型：对每颗恒星计算束缚能与"其余恒星的潮汐扰动 / 主星引力" ---
  let best = null;
  for (const s of stars) {
    const sr = sys.pos(s), sv = sys.vel(s);
    const el = orbitalElements(sub(pr, sr), sub(pv, sv), sys.m[s] + pm);
    if (!el.bound) continue;
    const main = len(accel(pr, sr, sys.m[s]));
    // 潮汐扰动：其他恒星对行星与对主星加速度之差
    let tidal = [0, 0, 0];
    for (const o of stars) {
      if (o === s) continue;
      const or = sys.pos(o);
      const ap = accel(pr, or, sys.m[o]), as = accel(sr, or, sys.m[o]);
      tidal = tidal.map((c, k) => c + ap[k] - as[k]);
    }
    const pert = len(tidal) / main;
    if (pert < 0.1 && (!best || pert < best.perturbation)) {
      best = { type: 'S', host: [s], elements: el, perturbation: pert };
    }
  }
  if (best) return best;

  // --- P 型：对每一对相互束缚的恒星，检查行星是否在外侧绕其质心运转 ---
  for (let x = 0; x < stars.length; x++) {
    for (let y = x + 1; y < stars.length; y++) {
      const s1 = stars[x], s2 = stars[y];
      const m1 = sys.m[s1], m2 = sys.m[s2], M = m1 + m2;
      const r1 = sys.pos(s1), r2 = sys.pos(s2), v1 = sys.vel(s1), v2 = sys.vel(s2);
      const bin = orbitalElements(sub(r2, r1), sub(v2, v1), M);
      if (!bin.bound) continue;
      const com = r1.map((c, k) => (c * m1 + r2[k] * m2) / M);
      const vcom = v1.map((c, k) => (c * m1 + v2[k] * m2) / M);
      const el = orbitalElements(sub(pr, com), sub(pv, vcom), M + pm);
      if (!el.bound || el.rp < 2 * bin.ra) continue;
      // 第三颗星的扰动
      const main = len(accel(pr, com, M));
      let tidal = [0, 0, 0];
      for (const o of stars) {
        if (o === s1 || o === s2) continue;
        const or = sys.pos(o);
        const ap = accel(pr, or, sys.m[o]), ac = accel(com, or, sys.m[o]);
        tidal = tidal.map((c, k) => c + ap[k] - ac[k]);
      }
      const pert = len(tidal) / main;
      if (pert < 0.1) return { type: 'P', host: [s1, s2], elements: el, binary: bin, perturbation: pert };
    }
  }

  // --- 整体束缚 or 逃逸 ---
  const com = sys.centerOfMass(m => m.kind === 'star');
  const el = orbitalElements(sub(pr, com.pos), sub(pv, com.vel), com.mass + pm);
  return { type: el.bound ? 'chaotic' : 'unbound', host: [], elements: el, perturbation: Infinity };
}

/**
 * 分析恒星系统的层级结构：
 *   - 找出束缚最紧的恒星对（内双星）
 *   - 判断第三颗星相对内双星质心的轨道：若外轨道近星点远大于内双星远星点 → 层级稳定
 *   - 检测被抛射的恒星（相对其余系统能量为正、远离且向外运动）
 */
export function analyzeHierarchy(sys) {
  const stars = [];
  for (let i = 0; i < sys.n; i++) if (sys.meta[i].kind === 'star') stars.push(i);
  if (stars.length < 2) return { kind: 'single', stars, escaped: [] };

  // 束缚最紧（比结合能最低）的一对
  let inner = null;
  for (let x = 0; x < stars.length; x++) {
    for (let y = x + 1; y < stars.length; y++) {
      const p = stars[x], q = stars[y];
      const el = orbitalElements(sub(sys.pos(q), sys.pos(p)), sub(sys.vel(q), sys.vel(p)), sys.m[p] + sys.m[q]);
      const eb = el.energy * sys.m[p] * sys.m[q] / (sys.m[p] + sys.m[q]);
      if (el.bound && (!inner || eb < inner.eb)) inner = { pair: [p, q], el, eb };
    }
  }

  // 逃逸检测：每颗星相对"其余恒星质心"的双体能量
  const escaped = [];
  for (const s of stars) {
    const rest = sys.centerOfMass((m, i) => m.kind === 'star' && i !== s);
    const r = sub(sys.pos(s), rest.pos), v = sub(sys.vel(s), rest.vel);
    const el = orbitalElements(r, v, rest.mass + sys.m[s]);
    // 其余恒星的尺度
    let size = 0;
    for (const o of stars) if (o !== s) size = Math.max(size, len(sub(sys.pos(o), rest.pos)));
    if (!el.bound && dot(r, v) > 0 && el.r > 5 * Math.max(size, 0.5)) escaped.push(s);
  }

  if (stars.length === 2) return { kind: inner ? 'binary' : 'unbound', inner, stars, escaped };
  if (!inner) return { kind: 'democratic', inner: null, stars, escaped };

  const third = stars.find(s => !inner.pair.includes(s));
  const [p, q] = inner.pair;
  const M = sys.m[p] + sys.m[q];
  const com = sys.pos(p).map((c, k) => (c * sys.m[p] + sys.pos(q)[k] * sys.m[q]) / M);
  const vcom = sys.vel(p).map((c, k) => (c * sys.m[p] + sys.vel(q)[k] * sys.m[q]) / M);
  const outer = orbitalElements(sub(sys.pos(third), com), sub(sys.vel(third), vcom), M + sys.m[third]);

  // Mardling & Aarseth (2001) 层级三体稳定判据
  let stable = false, ratio = 0;
  if (outer.bound && outer.e < 1) {
    const qout = sys.m[third] / M;
    const mutual = Math.acos(Math.max(-1, Math.min(1, dot(inner.el.h, outer.h) / (len(inner.el.h) * len(outer.h) || 1))));
    const crit = 2.8 * Math.pow((1 + qout) * (1 + outer.e) / Math.sqrt(1 - outer.e), 0.4) * (1 - 0.3 * mutual / Math.PI);
    ratio = outer.rp / inner.el.a;
    stable = ratio > crit;
  }
  const kind = stable ? 'hierarchical' : 'democratic';
  return { kind, inner, third, outer, stable, ratio, stars, escaped };
}
