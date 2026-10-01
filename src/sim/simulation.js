// 模拟总控：把动力学、气候、纪元、文明、混沌度量与事件日志耦合在一起
// ------------------------------------------------------------
// 气候与纪元在每个积分步内更新（而不是每帧），因此近距离交会期间
// 辐照的剧烈变化能被完整捕捉，与播放速度无关。

import { NBodySystem } from '../physics/nbody.js';
import { buildPreset, PRESETS, makeStar } from '../physics/presets.js';
import { classifyPlanet, analyzeHierarchy } from '../physics/orbit.js';
import { S0, KELVIN } from '../physics/constants.js';
import { Climate, regime } from '../climate/ebm.js';
import { EraTracker, skyView, phenomena, HABITABLE } from '../climate/era.js';
import { Civilization } from '../climate/civilization.js';
import { LyapunovMeter, TwinUniverse } from './chaos.js';

const HISTORY_DT = 0.02;       // 历史曲线采样间隔（年）
const HISTORY_MAX = 8000;      // 保存最近 160 年
const EJECT_DIST = 150;        // 行星离开恒星系统质心超过该距离并且未束缚 → 判定被抛射（AU）

export class Simulation {
  constructor() {
    this.listeners = {};
    this.eta = 0.001;
    this.mixedLayer = 50;
    this.twinEnabled = false;
  }

  on(evt, fn) { (this.listeners[evt] ||= []).push(fn); }
  emit(evt, data) { (this.listeners[evt] || []).forEach(fn => fn(data)); }

  load(presetKey, seed) {
    this.presetKey = PRESETS[presetKey] ? presetKey : 'trisolaris';
    this.seed = seed;
    const preset = buildPreset(this.presetKey, seed);
    this.preset = preset;
    this.sys = new NBodySystem(preset.bodies, { eta: this.eta });
    this.E0 = this.sys.energy();
    this.events = [];
    this.history = [];
    this._nextSample = 0;
    this.planetId = this.sys.meta.some(m => m.kind === 'planet') ? 'planet' : null;
    this.planetFate = this.planetId ? null : 'none';

    // 初始温度：直接取当前辐照下的平衡温度，避免开局的人为瞬变
    const S = this.planetId ? this._insolation() : 0;
    this.climate = new Climate(this.planetId ? Climate.equilibrium(S, 288) : 3, this.mixedLayer);
    this.era = new EraTracker();
    this.civ = new Civilization();
    if (this.planetId && this.climate.T > HABITABLE.lo && this.climate.T < HABITABLE.hi) {
      this.era.stable = true;
      this.civ.update(0, 0, this.climate.T, true);
    }
    this.chaos = new LyapunovMeter(this.sys);
    this.twin = new TwinUniverse(this.sys);
    this._escaped = new Set();
    this._hostKey = undefined;
    this._pendingKey = undefined;
    this.stats = {};
    this.analysis = null;

    this.log('info', `载入场景「${PRESETS[this.presetKey].name}」` + (PRESETS[this.presetKey].random ? `，种子 ${seed}` : ''));
    if (this.civ.number > 0) this.log('good', `第 1 号文明在恒纪元中诞生`);
    this.analyze();
    this.emit('load', this);
  }

  setEta(eta) {
    this.eta = eta;
    for (const s of [this.sys, this.chaos.ref, this.chaos.shadow, this.twin.sys]) if (s) s.eta = eta;
  }

  setMixedLayer(h) {
    this.mixedLayer = h;
    this.climate.setMixedLayer(h);
  }

  get planetIdx() { return this.planetId ? this.sys.indexOf(this.planetId) : -1; }

  log(level, text) {
    const e = { t: this.sys ? this.sys.t : 0, level, text };
    this.events.push(e);
    if (this.events.length > 500) this.events.shift();
    this.emit('event', e);
  }

  _insolation() {
    const p = this.planetIdx;
    if (p < 0) return 0;
    const { sys } = this;
    const px = sys.x[3 * p], py = sys.x[3 * p + 1], pz = sys.x[3 * p + 2];
    let S = 0;
    for (let i = 0; i < sys.n; i++) {
      if (sys.meta[i].kind !== 'star') continue;
      const dx = sys.x[3 * i] - px, dy = sys.x[3 * i + 1] - py, dz = sys.x[3 * i + 2] - pz;
      S += sys.meta[i].luminosity * S0 / (dx * dx + dy * dy + dz * dz);
    }
    return S;
  }

  /**
   * 推进 dtSim 年；计算预算 budgetMs 用尽则提前返回（模拟变慢但不卡顿）。
   * onStep(sys) 在每个积分步之后调用（用于轨迹采样）。
   */
  advance(dtSim, budgetMs = 12, onStep) {
    const { sys } = this;
    const target = sys.t + dtSim;
    const t0 = performance.now();
    const tStart = sys.t, steps0 = sys.steps;
    let k = 0;
    while (sys.t < target) {
      const tPrev = sys.t;
      sys.step(target);
      const h = sys.t - tPrev;
      this._afterStep(h);
      if (onStep) onStep(sys);
      if ((++k & 31) === 0 && performance.now() - t0 > budgetMs) break;
    }
    // 混沌度量与孪生宇宙同步到同一时刻
    this.chaos.advance(sys.t);
    if (this.twinEnabled) this.twin.advance(sys.t);

    const elapsed = Math.max(1e-3, performance.now() - t0);
    this.stats.stepsThisFrame = sys.steps - steps0;
    this.stats.simAdvanced = sys.t - tStart;
    this.stats.lagging = sys.t < target - 1e-12;
    this.stats.computeMs = elapsed;
    this.analyze();
  }

  _afterStep(h) {
    const { sys } = this;
    // --- 碰撞 ---
    const c = sys.findCollision();
    if (c) this._handleCollision(c);

    const p = this.planetIdx;
    if (p >= 0) {
      const S = this._insolation();
      this.climate.step(h, S);
    } else if (this.planetFate) {
      // 行星已不存在
    }
    const T = this.climate.T;
    const alive = p >= 0;
    if (alive) {
      if (this.era.update(sys.t, h, T)) {
        this.log(this.era.stable ? 'good' : 'warn', this.era.stable
          ? `恒纪元开始（${(T - KELVIN).toFixed(0)} ℃）`
          : `乱纪元开始（${(T - KELVIN).toFixed(0)} ℃）`);
      }
    }
    if (this.planetFate !== 'none') {
      const ev = this.civ.update(sys.t, h, T, alive && this.era.stable, alive);
      if (ev) this.log(ev.type === 'civ-destroyed' ? 'bad' : ev.type === 'civ-dehydrate' ? 'warn' : 'good', ev.text);
    }

    // --- 历史采样 ---
    if (sys.t >= this._nextSample) {
      this._nextSample = sys.t + HISTORY_DT;
      const fluxes = [];
      if (alive) {
        const pp = sys.pos(p);
        for (let i = 0; i < sys.n; i++) {
          const m = sys.meta[i];
          if (m.kind !== 'star') continue;
          const d2 = (sys.x[3 * i] - pp[0]) ** 2 + (sys.x[3 * i + 1] - pp[1]) ** 2 + (sys.x[3 * i + 2] - pp[2]) ** 2;
          fluxes.push({ id: m.id, v: m.luminosity / d2 });
        }
      }
      this.history.push({ t: sys.t, T: alive ? T : NaN, stable: alive && this.era.stable, fluxes });
      if (this.history.length > HISTORY_MAX) this.history.splice(0, this.history.length - HISTORY_MAX);
    }
  }

  _handleCollision([p, q]) {
    const { sys } = this;
    const A = sys.meta[p], B = sys.meta[q];
    if (A.kind === 'star' && B.kind === 'star') {
      const vrel = Math.hypot(...sys.vel(p).map((c, k) => c - sys.vel(q)[k])) * 4.74;  // AU/yr → km/s
      sys.merge(p, q, (a, b, M) => {
        const s = makeStar(Math.min(a.id, b.id), `${a.name}+${b.name.replace(/^恒星 /, '')}`, M, [0, 0, 0], [0, 0, 0]);
        return { ...s, pos: undefined, vel: undefined };
      });
      this.log('bad', `${A.name} 与 ${B.name} 以 ${vrel.toFixed(0)} km/s 相撞并合并`);
      this.E0 = sys.energy();
      this.chaos.reset(sys);
      this.emit('structure', this);
    } else {
      const star = A.kind === 'star' ? A : B;
      sys.remove(A.kind === 'planet' ? p : q);
      this.planetFate = 'engulfed';
      this.log('bad', `行星坠入${star.name}，被恒星吞没`);
      this.E0 = sys.energy();
      this.emit('structure', this);
    }
  }

  /** 每帧的结构化分析（轨道分类、层级、天象、守恒量） */
  analyze() {
    const { sys } = this;
    const p = this.planetIdx;
    const E = sys.energy();
    const a = {
      t: sys.t,
      energyError: Math.abs((E - this.E0) / this.E0),
      dt: sys.dt,
      hierarchy: analyzeHierarchy(sys),
      lyapunovTime: this.chaos.ok ? this.chaos.lyapunovTime : NaN,
      lambda: this.chaos.lambda,
      megno: this.chaos.ok ? this.chaos.megno : NaN,
      chaosAge: this.sys.t - this.chaos.t0,
      twinDivergence: this.twinEnabled ? this.twin.divergence(sys) : 0,
    };
    // 新逃逸的恒星
    for (const i of a.hierarchy.escaped) {
      const id = sys.meta[i].id;
      if (!this._escaped.has(id)) {
        this._escaped.add(id);
        this.log('bad', `${sys.meta[i].name} 获得逃逸速度，被永久抛射出系统`);
      }
    }
    if (p >= 0) {
      const T = this.climate.T;
      const orbit = classifyPlanet(sys, p);
      const sky = skyView(sys, p);
      a.planet = {
        T, S: this.climate.S, regime: regime(T), orbit, sky,
        phenom: phenomena(sky, T, this.era.stable),
        pos: sys.pos(p),
      };
      // 抛射判定
      if (orbit.type === 'unbound' && orbit.elements.r > EJECT_DIST && this.planetFate !== 'ejected') {
        this.planetFate = 'ejected';
        this.log('bad', '行星被抛射出三星系统，坠入永恒的黑暗');
      }
      // 宿主变化：新状态需持续 0.3 年才记入日志（过滤交会期间的瞬时抖动）
      const hostKey = orbit.type + ':' + orbit.host.map(i => sys.meta[i].id).join(',');
      if (hostKey !== this._pendingKey) { this._pendingKey = hostKey; this._pendingSince = sys.t; }
      if (this._hostKey === undefined) this._hostKey = hostKey;
      if (hostKey !== this._hostKey && sys.t - this._pendingSince > 0.3) {
        this._hostKey = hostKey;
        this.log(orbit.type === 'S' || orbit.type === 'P' ? 'info' : 'warn', `行星轨道改变：${describeOrbit(orbit, sys)}`);
      }
    }
    this.analysis = a;
    return a;
  }

  /** 导出当前状态（供预测 Worker 使用） */
  snapshot() {
    return {
      bodies: this.sys.toBodies(),
      t: this.sys.t,
      T: this.climate.T,
      mixedLayer: this.mixedLayer,
      eta: Math.max(this.eta, 0.002),
      era: { stable: this.era.stable, streak: this.era.streak, rate: this.era.rate },
      planetId: this.planetId,
    };
  }
}

export function describeOrbit(orbit, sys) {
  const names = orbit.host.map(i => sys.meta[i].name);
  switch (orbit.type) {
    case 'S': return `绕 ${names[0]} 运行（S 型轨道）`;
    case 'P': return `绕双星 ${names.join('–')} 运行（P 型环双星轨道）`;
    case 'chaotic': return '在三颗恒星之间无序游荡';
    default: return '未被束缚，正在逃离系统';
  }
}
