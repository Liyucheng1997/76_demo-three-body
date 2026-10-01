// 恒星物理：主序星经验关系 + 黑体颜色
// ------------------------------------------------------------
// 所有量以太阳为单位（M☉, L☉, R☉），温度单位 K。

import { T_SUN } from './constants.js';

/** 主序星质光关系（分段幂律，参考 Duric 2004 / Salaris & Cassisi 2005） */
export function luminosity(M) {
  if (M < 0.43) return 0.23 * Math.pow(M, 2.3);
  if (M < 2) return Math.pow(M, 4);
  if (M < 55) return 1.4 * Math.pow(M, 3.5);
  return 32000 * M;
}

/** 主序星质量-半径关系（Demircan & Kahraman 1991 的简化形式） */
export function radius(M) {
  return M < 1 ? Math.pow(M, 0.8) : Math.pow(M, 0.57);
}

/** 由斯特藩-玻尔兹曼定律 L = 4πR²σT⁴ 得到有效温度 */
export function effectiveTemperature(L, R) {
  return T_SUN * Math.pow(L / (R * R), 0.25);
}

/** 光谱型（摩根-基南分类，含次型） */
const SPECTRAL = [
  ['O', 30000, 50000], ['B', 10000, 30000], ['A', 7500, 10000],
  ['F', 6000, 7500], ['G', 5200, 6000], ['K', 3700, 5200], ['M', 2400, 3700],
];
export function spectralType(Teff) {
  for (const [cls, lo, hi] of SPECTRAL) {
    if (Teff >= lo || cls === 'M') {
      const f = Math.min(1, Math.max(0, (hi - Teff) / (hi - lo)));
      return `${cls}${Math.min(9, Math.floor(f * 10))}V`;
    }
  }
  return 'M9V';
}

/** 由质量一次性得到恒星的全部物理参数 */
export function starProperties(M) {
  const L = luminosity(M);
  const R = radius(M);
  const Teff = effectiveTemperature(L, R);
  return { mass: M, luminosity: L, radius: R, Teff, spectral: spectralType(Teff), color: blackbodyColor(Teff) };
}

// ------------------------------------------------------------
// 黑体颜色：普朗克谱 × CIE 1931 色匹配函数 → XYZ → 线性 sRGB
// 色匹配函数使用 Wyman, Sloan & Shirley (2013) 的多叶高斯拟合。
// ------------------------------------------------------------
function g(x, mu, s1, s2) {
  const t = (x - mu) / (x < mu ? s1 : s2);
  return Math.exp(-0.5 * t * t);
}
function cieXYZ(nm) {
  return [
    1.056 * g(nm, 599.8, 37.9, 31.0) + 0.362 * g(nm, 442.0, 16.0, 26.7) - 0.065 * g(nm, 501.1, 20.4, 26.2),
    0.821 * g(nm, 568.8, 46.9, 40.5) + 0.286 * g(nm, 530.9, 16.3, 31.1),
    1.217 * g(nm, 437.0, 11.8, 36.0) + 0.681 * g(nm, 459.0, 26.0, 13.8),
  ];
}
function planck(nm, T) {
  const l = nm * 1e-9;
  // 常数项对归一化颜色无影响，只保留形状
  return 1 / (Math.pow(l, 5) * (Math.exp(1.4387769e-2 / (l * T)) - 1));
}

/**
 * 黑体在温度 T 下的颜色，返回线性 sRGB [r,g,b]，最大分量归一化为 1。
 * 线性空间结果可直接用于 three.js 着色器。
 */
export function blackbodyColor(T) {
  let X = 0, Y = 0, Z = 0;
  for (let nm = 380; nm <= 780; nm += 5) {
    const p = planck(nm, T);
    const [x, y, z] = cieXYZ(nm);
    X += p * x; Y += p * y; Z += p * z;
  }
  let r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let gg = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let b = 0.0557 * X - 0.2040 * Y + 1.0570 * Z;
  r = Math.max(0, r); gg = Math.max(0, gg); b = Math.max(0, b);
  const m = Math.max(r, gg, b) || 1;
  return [r / m, gg / m, b / m];
}

/** 线性 → sRGB 十六进制字符串（用于 UI） */
export function linearToCss([r, g, b]) {
  const enc = c => {
    const v = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  };
  return '#' + enc(r) + enc(g) + enc(b);
}
