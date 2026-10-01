// 行星气候：零维能量平衡模型（Energy Balance Model）
// ------------------------------------------------------------
//   C · dT/dt = S·(1 − α(T)) / 4  −  OLR(T)
//
// · S      ：三颗恒星在行星处的总辐照度 Σ Lᵢ·S₀ / dᵢ²（W/m²）
// · α(T)   ：冰-反照率反馈 —— 结冰后反照率升高，形成"雪球"正反馈（Budyko–Sellers）
// · OLR(T) ：向外长波辐射。水汽温室效应使 OLR 在高温时饱和于
//            Simpson–Nakajima 极限（≈ 282 W/m²）——吸收超过该值即进入失控温室；
//            海洋蒸干后由干大气的 σT⁴ 项重新主导。
// · C      ：海洋混合层热容（ρ·c_p·h），决定气候的"热惯性"，
//            使温度滞后于日照变化（恒星远离后不会瞬间冰封）。
//
// 模型在 S = S₀（地球）时标定为 288 K 平衡温度。

import { S0, SIGMA, YEAR_S } from '../physics/constants.js';

export const ALBEDO_WARM = 0.29;
export const ALBEDO_ICE = 0.62;
export const OLR_LIMIT = 282;          // W/m²，失控温室辐射极限
const EPS_DRY = 1e-3;                  // 蒸干后的残余有效发射率（金星式厚大气）
const SAT_N = 10;                      // 饱和过渡的锐度

/** 冰覆盖比例（0~1）：以 263 K 为中点、约 ±15 K 内由全冰过渡到无冰 */
export function iceFraction(T) {
  return 0.5 * (1 - Math.tanh((T - 263) / 9));
}

export function albedo(T) {
  return ALBEDO_WARM + (ALBEDO_ICE - ALBEDO_WARM) * iceFraction(T);
}

/** 海洋存量（0~1）：373 K 以上开始大规模蒸发，约 650 K（水的临界点）完全成为蒸汽大气 */
export function oceanFraction(T) {
  return Math.min(1, Math.max(0, (647 - T) / (647 - 373)));
}

let EPS_MOIST = 0.612; // 稍后标定

function olrMoist(T) {
  const raw = EPS_MOIST * SIGMA * T ** 4;
  return raw / Math.pow(1 + Math.pow(raw / OLR_LIMIT, SAT_N), 1 / SAT_N);
}

export function olr(T) {
  return olrMoist(T) + EPS_DRY * SIGMA * T ** 4;
}

export function absorbed(S, T) {
  return S * (1 - albedo(T)) / 4;
}

// 标定湿大气发射率，使 S₀ 下的平衡温度恰为 288 K（二分法）
(function calibrate() {
  const target = absorbed(S0, 288);
  let lo = 0.3, hi = 1.0;
  for (let i = 0; i < 60; i++) {
    EPS_MOIST = (lo + hi) / 2;
    if (olr(288) > target) hi = EPS_MOIST; else lo = EPS_MOIST;
  }
})();

/** 气候态分类 */
export function regime(T) {
  if (T > 647) return { id: 'steam', name: '蒸汽大气（海洋蒸干）' };
  if (T > 340) return { id: 'runaway', name: '失控温室' };
  if (T > 318) return { id: 'hot', name: '湿热' };
  if (T >= 273) return { id: 'temperate', name: '温和' };
  if (T >= 240) return { id: 'cold', name: '寒冷（部分冰封）' };
  return { id: 'snowball', name: '雪球（全球冰封）' };
}

export class Climate {
  /**
   * @param {number} T0 初始表面温度（K）
   * @param {number} mixedLayer 海洋混合层深度（m），决定热容
   */
  constructor(T0 = 288, mixedLayer = 50) {
    this.T = T0;
    this.setMixedLayer(mixedLayer);
    this.S = S0;
  }

  setMixedLayer(h) {
    this.mixedLayer = h;
    // 热容 = ρ c_p h（海水）；再加上大气与陆地的少量热容
    this.C = 1025 * 3990 * h + 1.0e7;
  }

  /** 以辐照度 S（W/m²）推进 dt 年 */
  step(dtYears, S) {
    this.S = S;
    let remaining = dtYears;
    while (remaining > 0) {
      // 局部线性化给出弛豫时间，子步取其 1/5 保证显式积分稳定
      const T = this.T;
      const dOLR = (olr(T + 0.5) - olr(T - 0.5)) + 1e-6;
      const tau = this.C / dOLR / YEAR_S;
      const h = Math.min(remaining, Math.max(1e-5, 0.2 * tau), 0.02);
      const net = absorbed(S, T) - olr(T);
      this.T = Math.max(3, T + net / this.C * h * YEAR_S);
      remaining -= h;
    }
    return this.T;
  }

  /** 给定辐照度下的平衡温度（从当前温度出发迭代，体现滞后/多稳态） */
  static equilibrium(S, T0 = 288) {
    const c = new Climate(T0, 1);
    for (let i = 0; i < 4000; i++) c.step(0.05, S);
    return c.T;
  }
}
