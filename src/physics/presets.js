// 场景预设
// ------------------------------------------------------------
// 每个预设返回 { bodies, view, speed, notes }，所有量为 AU / M☉ / yr。
// 经典周期解原始数据为 G = m = 1 的无量纲单位，通过 scaleNBody() 换算。

import { G, R_EARTH_AU, M_EARTH, R_SUN_AU } from './constants.js';
import { starProperties } from './stellar.js';
import { keplerToState } from './orbit.js';
import { toCenterOfMassFrame } from './nbody.js';

const STAR_NAMES = ['恒星 A', '恒星 B', '恒星 C'];

/** 可复现的伪随机数（mulberry32） */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeStar(id, name, mass, pos, vel) {
  const p = starProperties(mass);
  return {
    id, name, kind: 'star', mass, radius: p.radius * R_SUN_AU,
    luminosity: p.luminosity, Teff: p.Teff, spectral: p.spectral, color: p.color,
    radiusSun: p.radius, pos, vel,
  };
}

export function makePlanet(pos, vel, name = '三体星') {
  return { id: 'planet', name, kind: 'planet', mass: M_EARTH, radius: R_EARTH_AU, pos, vel };
}

const add = (a, b) => a.map((c, k) => c + b[k]);

/** 把 G=1 无量纲单位下的初值换算成 AU / M☉ / yr */
function scaleNBody(list, L, M) {
  const vUnit = Math.sqrt(G * M / L);
  return list.map(b => ({ ...b, mass: b.m * M, pos: b.p.map(c => c * L), vel: b.v.map(c => c * vUnit) }));
}

/** 环绕整个恒星系统的行星（P 型 / 环三星轨道） */
function circumsystemPlanet(stars, a, phase = 0.3) {
  const Mt = stars.reduce((s, b) => s + b.mass, 0);
  const st = keplerToState({ a, e: 0, nu: phase, M: Mt });
  return makePlanet(st.pos, st.vel);
}

/** 把二维（xz 平面）构型的周期解装配成恒星列表 */
function planarStars(list, L, M, ids = [0, 1, 2]) {
  return scaleNBody(list, L, M).map((b, i) =>
    makeStar(ids[i], STAR_NAMES[i], b.mass, [b.pos[0], 0, b.pos[1]], [b.vel[0], 0, b.vel[1]]));
}

// ---------------------------------------------------------------------------
export const PRESETS = {
  trisolaris: {
    name: '三体世界（随机混沌）',
    desc: '三颗质量相近的恒星构成非层级的"民主"三体系统，行星最初绕恒星 A 运行于宜居带内。'
      + '恒星间的近距离交会会扰乱甚至夺走行星——恒纪元与乱纪元由此交替。每个随机种子都是一个不同的宇宙。',
    random: true,
    build(seed) {
      const r = rng(seed);
      for (let attempt = 0; attempt < 200; attempt++) {
        const mA = 0.85 + 0.35 * r();
        const mB = 0.65 + 0.55 * r();
        const mC = 0.55 + 0.55 * r();
        const A = makeStar(0, STAR_NAMES[0], mA, [0, 0, 0], [0, 0, 0]);
        const others = [];
        for (const [i, m] of [[1, mB], [2, mC]]) {
          const rad = 8 + 12 * r();
          const ang = 2 * Math.PI * r();
          const pos = [rad * Math.cos(ang), (r() - 0.5) * 0.3 * rad, rad * Math.sin(ang)];
          // 大体同向绕转 + 随机分量
          const t = [-Math.sin(ang), 0, Math.cos(ang)];
          const vel = t.map(c => c + (r() - 0.5) * 0.9).map((c, k) => k === 1 ? (r() - 0.5) * 0.3 : c);
          others.push(makeStar(i, STAR_NAMES[i], m, pos, vel));
        }
        const stars = [A, ...others];
        // 彼此距离不能太近，否则开局即崩
        if (Math.hypot(...others[0].pos.map((c, k) => c - others[1].pos[k])) < 3) continue;

        // 按位力比 Q = 2K/|U| ∈ [0.4, 0.9] 缩放速度：束缚、但足够混沌
        const com = toCenterOfMassFrame(stars);
        let K = 0, U = 0;
        com.forEach((b, i) => {
          K += 0.5 * b.mass * b.vel.reduce((s, c) => s + c * c, 0);
          for (let j = i + 1; j < com.length; j++) {
            U -= G * b.mass * com[j].mass / Math.hypot(...b.pos.map((c, k) => c - com[j].pos[k]));
          }
        });
        const Q = 0.4 + 0.5 * r();
        const f = Math.sqrt(Q * Math.abs(U) / 2 / K);
        com.forEach(b => { b.vel = b.vel.map(c => c * f); });

        // 行星：绕恒星 A，位于其宜居带（S = S₀ 处 a = √L）
        const Ast = com[0];
        const ap = Math.sqrt(Ast.luminosity) * (0.95 + 0.1 * r());
        const pl = keplerToState({ a: ap, e: 0.01 + 0.03 * r(), nu: 2 * Math.PI * r(), M: Ast.mass, inc: 0.05 * r() });
        const planet = makePlanet(add(Ast.pos, pl.pos), add(Ast.vel, pl.vel));

        // 开局时行星须稳定地属于恒星 A：其余恒星距离 > 6 倍行星轨道
        const minD = Math.min(...com.slice(1).map(s => Math.hypot(...s.pos.map((c, k) => c - planet.pos[k]))));
        if (minD < 6 * ap) continue;

        return { bodies: toCenterOfMassFrame([...com, planet]), view: 40, speed: 1 };
      }
      throw new Error('无法生成有效初值');
    },
  },

  alphaCen: {
    name: '半人马座 α（真实数据）',
    desc: '三体人的故乡原型：α Cen A（1.08 M☉）与 B（0.91 M☉）以 79.9 年周期互绕（a = 23.3 AU，e = 0.52），'
      + '比邻星远在约 8700 AU 之外。行星位于 A 的宜居带。真实系统是层级稳定的——恒纪元远比小说中漫长。',
    build() {
      const mA = 1.079, mB = 0.909, mP = 0.122;
      const bin = keplerToState({ a: 23.3, e: 0.5179, nu: Math.PI * 0.85, M: mA + mB, omega: 0 });
      const A = makeStar(0, 'α Cen A', mA, bin.pos.map(c => -c * mB / (mA + mB)), bin.vel.map(c => -c * mB / (mA + mB)));
      const B = makeStar(1, 'α Cen B', mB, bin.pos.map(c => c * mA / (mA + mB)), bin.vel.map(c => c * mA / (mA + mB)));
      const prox = keplerToState({ a: 8700, e: 0.5, nu: Math.PI, M: mA + mB + mP, inc: 0.3 });
      const C = makeStar(2, '比邻星', mP, prox.pos, prox.vel);
      const pl = keplerToState({ a: Math.sqrt(A.luminosity), e: 0.02, nu: 1.0, M: mA });
      const planet = makePlanet(add(A.pos, pl.pos), add(A.vel, pl.vel));
      return { bodies: toCenterOfMassFrame([A, B, C, planet]), view: 45, speed: 2 };
    },
  },

  tatooine: {
    name: '环双星世界（层级稳定）',
    desc: '紧密双星 A–B（a = 0.18 AU）外有一颗环双星行星（P 型轨道），第三颗恒星 C 在 18 AU 外的偏心轨道上。'
      + '满足 Mardling–Aarseth 层级稳定判据：长期以恒纪元为主，C 过近星点时带来周期性气候扰动。',
    build() {
      const mA = 0.95, mB = 0.7, mC = 0.75;
      const Mab = mA + mB;
      const bin = keplerToState({ a: 0.18, e: 0.1, nu: 0, M: Mab });
      const A = makeStar(0, STAR_NAMES[0], mA, bin.pos.map(c => -c * mB / Mab), bin.vel.map(c => -c * mB / Mab));
      const B = makeStar(1, STAR_NAMES[1], mB, bin.pos.map(c => c * mA / Mab), bin.vel.map(c => c * mA / Mab));
      const Ltot = A.luminosity + B.luminosity;
      const pl = keplerToState({ a: Math.sqrt(Ltot) * 1.02, e: 0.01, nu: 2, M: Mab });
      const planet = makePlanet(pl.pos, pl.vel);
      const out = keplerToState({ a: 18, e: 0.35, nu: Math.PI, M: Mab + mC, inc: 0.12 });
      // 外星相对 (AB+行星) 质心
      const C = makeStar(2, STAR_NAMES[2], mC, out.pos.map(c => c * Mab / (Mab + mC)), out.vel.map(c => c * Mab / (Mab + mC)));
      const shift = (b) => ({ ...b, pos: b.pos.map((c, k) => c - out.pos[k] * mC / (Mab + mC)), vel: b.vel.map((c, k) => c - out.vel[k] * mC / (Mab + mC)) });
      return { bodies: toCenterOfMassFrame([shift(A), shift(B), C, shift(planet)]), view: 30, speed: 1 };
    },
  },

  figure8: {
    name: '8 字形周期解',
    desc: 'Chenciner & Montgomery (2000) 证明存在的经典周期解：三颗等质量恒星沿同一条 8 字形轨道追逐。'
      + '该解在扰动下是（线性）稳定的。行星在 1.8 AU 处环绕整个系统。',
    build() {
      const x1 = [-0.97000436, 0.24308753], v3 = [-0.93240737, -0.86473146];
      const stars = planarStars([
        { m: 1, p: x1, v: [-v3[0] / 2, -v3[1] / 2] },
        { m: 1, p: [-x1[0], -x1[1]], v: [-v3[0] / 2, -v3[1] / 2] },
        { m: 1, p: [0, 0], v: v3 },
      ], 0.25, 1);
      return { bodies: toCenterOfMassFrame([...stars, circumsystemPlanet(stars, 1.8)]), view: 5, speed: 0.15 };
    },
  },

  butterfly: {
    name: '蝴蝶 I 周期解',
    desc: 'Šuvakov & Dmitrašinović (2013) 发现的新周期解族之一。与 8 字形不同，它是不稳定的——'
      + '舍入误差会以指数速度放大，数个周期后系统偏离周期轨道陷入混沌。',
    build() {
      const p = [0.30689, 0.12551];
      const stars = planarStars([
        { m: 1, p: [-1, 0], v: p },
        { m: 1, p: [1, 0], v: p },
        { m: 1, p: [0, 0], v: [-2 * p[0], -2 * p[1]] },
      ], 0.2, 1);
      stars.forEach(s => { s.radius = 0; });   // 原问题为质点，轨道含极近交会
      return { bodies: toCenterOfMassFrame([...stars, circumsystemPlanet(stars, 2.0)]), view: 5, speed: 0.08 };
    },
  },

  moth: {
    name: '飞蛾 I 周期解',
    desc: 'Šuvakov–Dmitrašinović 周期解族中的"飞蛾 I"（周期 T = 14.89 无量纲时间）。同样不稳定。',
    build() {
      const p = [0.46444, 0.39606];
      const stars = planarStars([
        { m: 1, p: [-1, 0], v: p },
        { m: 1, p: [1, 0], v: p },
        { m: 1, p: [0, 0], v: [-2 * p[0], -2 * p[1]] },
      ], 0.2, 1);
      stars.forEach(s => { s.radius = 0; });   // 原问题为质点，轨道含极近交会
      return { bodies: toCenterOfMassFrame([...stars, circumsystemPlanet(stars, 2.0)]), view: 5, speed: 0.08 };
    },
  },

  lagrange: {
    name: '拉格朗日等边三角形',
    desc: '拉格朗日 (1772) 的严格解：三星位于等边三角形顶点做刚性圆周运动。'
      + '只有当一颗星占绝对主导时它才稳定（Routh 判据）；三颗等质量星的构型是不稳定的，会在数十个周期后瓦解。',
    build() {
      const s = 0.4, m = 1;
      const rr = s / Math.sqrt(3);
      const w = Math.sqrt(G * 3 * m / (s * s * s));
      const stars = [0, 1, 2].map(i => {
        const ang = i * 2 * Math.PI / 3;
        return makeStar(i, STAR_NAMES[i], m,
          [rr * Math.cos(ang), 0, rr * Math.sin(ang)],
          [-w * rr * Math.sin(ang), 0, w * rr * Math.cos(ang)]);
      });
      return { bodies: toCenterOfMassFrame([...stars, circumsystemPlanet(stars, 1.75)]), view: 5, speed: 0.2 };
    },
  },

  pythagorean: {
    name: '毕达哥拉斯三体问题',
    desc: 'Burrau (1913) 问题：质量比 3:4:5 的三颗星静止于 3-4-5 直角三角形的顶点。'
      + '经过一连串剧烈的近距离交会，最终最轻的星被抛射，其余两颗形成双星（Szebehely & Peters 1967）。'
      + '这是对积分器精度的经典考验。本场景无行星。',
    build() {
      const stars = planarStars([
        { m: 3, p: [1, 3], v: [0, 0] },
        { m: 4, p: [-2, -1], v: [0, 0] },
        { m: 5, p: [1, -1], v: [0, 0] },
      ], 1, 0.25);
      // 原问题为质点：碰撞半径置零，避免极近交会被判定为合并
      stars.forEach(s => { s.radius = 0; });
      return { bodies: toCenterOfMassFrame(stars), view: 9, speed: 1.2, pointMass: true };
    },
  },
};

export const DEFAULT_PRESET = 'trisolaris';

export function buildPreset(key, seed) {
  const preset = PRESETS[key] || PRESETS[DEFAULT_PRESET];
  return preset.build(seed);
}

