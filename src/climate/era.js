// 纪元判定与天象
// ------------------------------------------------------------
// 恒纪元：表面温度持续处于宜居区间、且变化平缓；
// 乱纪元：其余一切情况。带有滞后（迟滞）区间，避免在边界附近频繁切换。

import { R_SUN_AU } from '../physics/constants.js';

export const HABITABLE = { lo: 273.15, hi: 318.15 };    // 0 ~ 45 ℃
const EXIT = { lo: 268, hi: 323 };                       // 退出恒纪元的宽松边界
const MIN_STREAK = 0.25;                                 // 进入恒纪元需连续宜居的时长（年）
const MAX_RATE = 25;                                     // 允许的最大温度变化率（K/年）

export class EraTracker {
  constructor() {
    this.stable = false;
    this.streak = 0;        // 连续宜居时长
    this.eraStart = 0;      // 当前纪元开始时间
    this.rate = 0;          // 温度变化率（指数滑动平均）
    this._T = null;
  }

  /** @returns {boolean} 本次更新是否发生纪元切换 */
  update(t, dt, T) {
    if (this._T !== null && dt > 0) {
      const r = (T - this._T) / dt;
      const k = Math.min(1, dt / 0.08);
      this.rate += (r - this.rate) * k;
    }
    this._T = T;

    const calm = Math.abs(this.rate) < MAX_RATE;
    const inBand = T >= HABITABLE.lo && T <= HABITABLE.hi;
    this.streak = inBand && calm ? this.streak + dt : 0;

    let next = this.stable;
    if (!this.stable && this.streak >= MIN_STREAK) next = true;
    if (this.stable && (T < EXIT.lo || T > EXIT.hi || Math.abs(this.rate) > 2 * MAX_RATE)) next = false;
    if (next !== this.stable) {
      this.stable = next;
      this.eraStart = t;
      return true;
    }
    return false;
  }
}

/**
 * 从行星上看到的天空：每颗恒星的方向、视直径（以地球上看太阳为 1）、辐照贡献。
 */
export function skyView(sys, planetIdx) {
  const p = sys.pos(planetIdx);
  const suns = [];
  for (let i = 0; i < sys.n; i++) {
    const m = sys.meta[i];
    if (m.kind !== 'star') continue;
    const d = [sys.x[3 * i] - p[0], sys.x[3 * i + 1] - p[1], sys.x[3 * i + 2] - p[2]];
    const r = Math.hypot(...d);
    suns.push({
      idx: i, name: m.name, color: m.color, dir: d.map(c => c / r), dist: r,
      size: (sys.R[i] / R_SUN_AU) / r,                 // 视直径 / 太阳视直径
      flux: m.luminosity / (r * r),                    // S / S₀
    });
  }
  return suns;
}

/**
 * 天象描述（致敬《三体》游戏中的现象）。
 *   飞星：远处的恒星看起来只是一颗明亮的星星（视直径 < 太阳的 1/10）
 */
export function phenomena(sky, T, era) {
  const big = sky.filter(s => s.flux > 0.25);
  const flying = sky.filter(s => s.size < 0.1 && s.flux < 0.05);
  // 视方向上是否接近（天空中挤在一起）
  const together = big.length >= 2 && big.every(a => big.every(b => a === b ||
    Math.acos(Math.max(-1, Math.min(1, a.dir[0] * b.dir[0] + a.dir[1] * b.dir[1] + a.dir[2] * b.dir[2]))) < Math.PI / 3));

  if (T > 600) return { icon: '🔥', text: '烈焰焚天 —— 海洋沸腾，大气成为蒸汽', level: 'deadly' };
  if (big.length >= 3) return { icon: '☀☀☀', text: together ? '三日连珠 —— 三颗太阳并列天际，大地将被焚毁' : '三日凌空 —— 无处躲藏的烈日', level: 'deadly' };
  if (big.length === 2) return { icon: '☀☀', text: together ? '双日凌空 —— 两颗太阳同时升起' : '双日临空 —— 昼夜交替失序', level: 'danger' };
  if (sky.length >= 3 && flying.length === sky.length) return { icon: '✦✦✦', text: '三颗飞星 —— 天空中只剩星星，漫长的严寒即将来临', level: 'danger' };
  if (T < 200) return { icon: '❄', text: '严寒长夜 —— 大气开始凝结', level: 'deadly' };
  if (T < 250) return { icon: '❄', text: '冰封大地 —— 海洋封冻', level: 'danger' };
  if (T > 340) return { icon: '♨', text: '失控温室 —— 海洋正在蒸发', level: 'danger' };
  if (era) return { icon: '☀', text: '恒纪元 —— 太阳规律地升起落下，适合浸泡复苏', level: 'good' };
  if (flying.length >= 2) return { icon: '✦✦', text: `${flying.length} 颗飞星 —— 太阳远去，气候失序`, level: 'warn' };
  return { icon: '〜', text: '乱纪元 —— 太阳运行毫无规律，冷热无常', level: 'warn' };
}
