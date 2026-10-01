// 状态面板：纪元、文明、气候、轨道、恒星、数值诊断
import { KELVIN, S0 } from '../physics/constants.js';
import { linearToCss } from '../physics/stellar.js';
import { albedo, iceFraction, oceanFraction } from '../climate/ebm.js';
import { stageOf } from '../climate/civilization.js';
import { describeOrbit } from '../sim/simulation.js';
import { drawSky } from './charts.js';

const $ = id => document.getElementById(id);

export function formatTime(t) {
  const y = Math.floor(t);
  const d = Math.floor((t - y) * 365.25);
  return `第 ${y} 年 ${String(d).padStart(3, ' ')} 天`;
}

export function fmtYears(y) {
  if (!Number.isFinite(y)) return '∞';
  if (y < 1) return `${(y * 365.25).toFixed(0)} 天`;
  if (y < 100) return `${y.toFixed(1)} 年`;
  return `${y.toFixed(0)} 年`;
}

function fmtSci(x, digits = 1) {
  if (!Number.isFinite(x)) return '—';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e < 4) return x.toFixed(Math.max(0, digits + 1 - e));
  const m = x / Math.pow(10, e);
  return `${m.toFixed(digits)}×10${sup(e)}`;
}
const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const sup = n => String(n).split('').map(c => SUP[c]).join('');

/** 温度条位置：分段线性，与刻度 −100 / 0 / 45 / 150 ℃ 对齐 */
function tempPct(c) {
  if (c < 0) return Math.max(0, 40 * (c + 100) / 100);
  if (c < 45) return 40 + 18 * c / 45;
  return Math.min(100, 58 + 42 * (c - 45) / 105);
}

const CIV_STATUS = { active: '浸泡 · 繁衍', dehydrated: '脱水 · 储存', extinct: '已毁灭', nascent: '生命演化中', gone: '行星不复存在' };

export class Hud {
  constructor() {
    this.frame = 0;
    this.stepsWindow = [];
  }

  update(sim, stats) {
    this.frame++;
    const a = sim.analysis;
    if (!a) return;
    $('simDate').textContent = formatTime(sim.sys.t);

    // 性能统计（滑动窗口）
    const now = performance.now();
    this.stepsWindow.push([now, sim.sys.steps]);
    while (this.stepsWindow.length > 2 && now - this.stepsWindow[0][0] > 1000) this.stepsWindow.shift();

    if (this.frame % 4 !== 0) return;   // 文本类信息不必每帧刷新

    const planet = a.planet;
    const alive = !!planet;
    // ---- 纪元 ----
    const eraCls = !alive ? 'dead' : sim.era.stable ? 'stable' : 'chaos';
    const eraText = !alive ? (sim.planetFate === 'none' ? '无行星' : '行星毁灭') : sim.era.stable ? '恒纪元' : '乱纪元';
    $('eraBadge').className = `badge ${eraCls}`;
    $('eraBadge').textContent = eraText;
    $('eraCard').className = `era-card ${eraCls}`;
    $('eraName').textContent = eraText;
    $('eraDur').textContent = alive ? `已持续 ${fmtYears(sim.sys.t - sim.era.eraStart)}` : '';
    const ph = $('phenom');
    if (alive) {
      ph.textContent = `${planet.phenom.icon}  ${planet.phenom.text}`;
      ph.className = `phenom ${planet.phenom.level}`;
    } else {
      ph.textContent = sim.planetFate === 'none' ? '本场景仅模拟恒星动力学' : sim.planetFate === 'engulfed' ? '行星已坠入恒星' : '—';
      ph.className = 'phenom deadly';
    }

    // ---- 文明 ----
    const civ = sim.civ;
    const st = stageOf(civ.progress);
    $('civName').textContent = civ.number > 0 ? `第 ${civ.number} 号文明` : '尚无文明';
    $('civStatus').textContent = CIV_STATUS[civ.status] || civ.status;
    $('civStatus').className = `tag ${civ.status}`;
    $('civStage').textContent = civ.number > 0 && civ.status !== 'nascent' ? st.name : '—';
    $('civNext').textContent = st.next && civ.status !== 'extinct' && civ.number > 0 ? `→ ${st.next.name}` : '';
    const frac = st.next ? (civ.progress - st.at) / (st.next.at - st.at) : 1;
    $('civBar').style.width = `${(civ.status === 'extinct' || civ.number === 0 ? 0 : frac * 100).toFixed(1)}%`;
    const hist = civ.history;
    $('civHistory').textContent = hist.length
      ? `已毁灭 ${hist.length} 个文明 · 最高达到 ${stageOf(civ.best).name}` : '';

    // ---- 气候 ----
    if (alive) {
      const T = planet.T, c = T - KELVIN;
      $('tempC').textContent = `${c >= 0 ? '+' : ''}${c.toFixed(1)} ℃`;
      $('tempK').textContent = `${T.toFixed(0)} K`;
      $('tempMarker').style.left = `${tempPct(c)}%`;
      $('flux').textContent = `${(planet.S / S0).toFixed(3)} S₀  (${planet.S.toFixed(0)} W/m²)`;
      $('albedo').textContent = albedo(T).toFixed(2);
      $('iceOcean').textContent = `${(iceFraction(T) * 100).toFixed(0)}% / ${(oceanFraction(T) * 100).toFixed(0)}%`;
      $('regime').textContent = planet.regime.name;
      // ---- 轨道 ----
      const o = planet.orbit, el = o.elements;
      $('orbitType').textContent = describeOrbit(o, sim.sys);
      $('orbA').textContent = el.bound ? `${el.a.toFixed(3)} AU` : '—';
      $('orbE').textContent = el.bound ? el.e.toFixed(3) : (el.e.toFixed(2) + '（双曲）');
      $('orbP').textContent = el.bound ? fmtYears(el.period) : '—';
      $('orbPert').textContent = Number.isFinite(o.perturbation) ? fmtSci(o.perturbation, 1) : '强';
      drawSky($('sky'), planet.sky);
      $('tempMarker').style.display = '';
    } else {
      $('tempMarker').style.display = 'none';
      for (const id of ['tempC', 'tempK', 'flux', 'albedo', 'iceOcean', 'regime', 'orbitType', 'orbA', 'orbE', 'orbP', 'orbPert']) $(id).textContent = '—';
      drawSky($('sky'), []);
    }

    // ---- 恒星表 ----
    const sys = sim.sys;
    const escaped = new Set(a.hierarchy.escaped);
    const p = sim.planetIdx;
    const rows = [];
    sys.meta.forEach((m, i) => {
      if (m.kind !== 'star') return;
      const d = p >= 0 ? Math.hypot(...sys.pos(i).map((c, k) => c - sys.x[3 * p + k])) : NaN;
      rows.push(`<tr class="${escaped.has(i) ? 'escaped' : ''}" title="${escaped.has(i) ? '已逃逸' : ''}">
        <td><span class="dot" style="background:${linearToCss(m.color)}"></span>${m.name}</td>
        <td>${m.mass.toFixed(2)}</td><td>${m.luminosity < 0.01 ? m.luminosity.toExponential(0) : m.luminosity.toFixed(2)}</td>
        <td>${Math.round(m.Teff)}</td><td>${m.spectral}</td><td>${Number.isFinite(d) ? d.toFixed(2) : '—'}</td></tr>`);
    });
    const tbody = $('starTable').tBodies[0];
    const html = rows.join('');
    if (tbody._html !== html) { tbody.innerHTML = html; tbody._html = html; }
    $('hierarchy').textContent = describeHierarchy(a.hierarchy, sys);

    // ---- 数值诊断 ----
    $('dE').textContent = fmtSci(a.energyError, 1);
    $('dtVal').textContent = fmtYears(a.dt).replace(' 天', ' 天') + (a.dt < 1 / 365.25 ? ` (${(a.dt * 8766).toFixed(2)} 小时)` : '');
    if (this.stepsWindow.length > 1) {
      const [t0, s0] = this.stepsWindow[0], [t1, s1] = this.stepsWindow[this.stepsWindow.length - 1];
      $('stepsPS').textContent = t1 > t0 ? Math.round((s1 - s0) / (t1 - t0) * 1000).toLocaleString() : '—';
    }
    const Y = a.megno;
    const chaotic = Y > 2.5;
    $('megno').textContent = Number.isFinite(Y) && a.chaosAge > 1
      ? `${Y.toFixed(2)} · ${Y < 2.5 ? '规则' : Y < 5 ? '弱混沌' : '强混沌'}` : '—';
    $('lyap').textContent = Number.isNaN(a.lyapunovTime) || !Number.isFinite(Y) ? '—'
      : !chaotic ? '—（规则运动）' : fmtYears(a.lyapunovTime);
    const twinOn = sim.twinEnabled;
    $('twinLabel').classList.toggle('hidden', !twinOn);
    $('twinDiv').classList.toggle('hidden', !twinOn);
    if (twinOn) $('twinDiv').textContent = `${fmtSci(a.twinDivergence, 1)} AU`;

    if (stats && stats.lagging) $('speedVal').classList.add('lag'); else $('speedVal').classList.remove('lag');
  }
}

function describeHierarchy(h, sys) {
  const nm = i => sys.meta[i].name.replace('恒星 ', '');
  const esc = h.escaped.length ? `；${h.escaped.map(nm).join('、')} 已逃逸` : '';
  switch (h.kind) {
    case 'single': return '单星系统' + esc;
    case 'binary': return `双星 ${h.inner.pair.map(nm).join('–')}（a = ${h.inner.el.a.toFixed(2)} AU，e = ${h.inner.el.e.toFixed(2)}）` + esc;
    case 'hierarchical':
      return `层级稳定：内双星 ${h.inner.pair.map(nm).join('–')}（a = ${h.inner.el.a.toFixed(2)} AU）+ 外星 ${nm(h.third)}（近星点/内轨道 = ${h.ratio.toFixed(1)}，满足 Mardling–Aarseth 判据）` + esc;
    case 'democratic':
      if (h.escaped.length && h.inner) return `双星 ${h.inner.pair.map(nm).join('–')}（a = ${h.inner.el.a.toFixed(2)} AU）` + esc;
      return '非层级（民主）三体：三星强烈相互作用，轨道混沌' + esc;
    default: return '恒星间均未束缚' + esc;
  }
}
