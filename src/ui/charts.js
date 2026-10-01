// 二维图表：温度曲线（含纪元色带与集合预报）、各恒星辐照、行星天空投影
import { KELVIN } from '../physics/constants.js';
import { linearToCss } from '../physics/stellar.js';

const C = {
  grid: 'rgba(130,165,230,0.10)',
  axis: 'rgba(150,170,210,0.55)',
  text: 'rgba(160,175,205,0.8)',
  good: '#6fe3a1',
  bad: '#ff7a6b',
  line: '#e7eefc',
  fc: 'rgba(127,182,255,',
  hab: 'rgba(111,227,161,0.08)',
};

function setupCanvas(canvas) {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

function niceStep(range, target = 5) {
  const raw = range / target;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

// 温度轴：以 15 ℃ 为中心的 asinh 刻度——宜居区间附近保持线性分辨率，
// 同时能容纳数百至上千摄氏度的极端值。
const tf = T => Math.asinh((T - 15) / 30);
const T_TICKS = [-200, -100, -50, 0, 50, 100, 300, 1000, 3000];

const PAD = { l: 38, r: 8, t: 6, b: 18 };

export class TemperatureChart {
  constructor(canvas) { this.canvas = canvas; this.window = 30; }

  draw(history, now, forecast) {
    const { ctx, w, h } = setupCanvas(this.canvas);
    const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;
    const fcSpan = forecast ? forecast.times[forecast.times.length - 1] - forecast.t0 : 0;
    const tEnd = forecast ? Math.max(now, forecast.t0) + fcSpan * 1.0 : now;
    const tStart = Math.max(0, (forecast ? Math.min(now, forecast.t0) : now) - this.window);
    const span = Math.max(1e-6, tEnd - tStart);
    const X = t => PAD.l + (t - tStart) / span * pw;

    // y 范围：根据窗口内数据自适应
    let lo = -60, hi = 70;
    for (const s of history) {
      if (s.t < tStart || Number.isNaN(s.T)) continue;
      const c = s.T - KELVIN; if (c < lo) lo = c; if (c > hi) hi = c;
    }
    if (forecast) for (let i = 0; i < forecast.times.length; i++) {
      const a = forecast.p10[i] - KELVIN, b = forecast.p90[i] - KELVIN;
      if (a < lo) lo = a; if (b > hi) hi = b;
    }
    lo = Math.max(lo, -270); hi = Math.min(hi, 5000);
    const y0 = tf(lo) - 0.15, y1 = tf(hi) + 0.15;
    const Y = T => PAD.t + (1 - (tf(T) - y0) / (y1 - y0)) * ph;

    // 宜居带
    ctx.fillStyle = C.hab;
    ctx.fillRect(PAD.l, Y(45), pw, Y(0) - Y(45));
    // 网格与刻度
    ctx.font = '10px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (const t of T_TICKS) {
      const y = Y(t);
      if (y < PAD.t - 1 || y > PAD.t + ph + 1) continue;
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
      ctx.fillStyle = C.text; ctx.fillText(String(t), PAD.l - 4, y);
    }
    this._timeAxis(ctx, tStart, tEnd, X, PAD.t + ph, ph);

    // 纪元色带（底部）
    let prev = null;
    for (const s of history) {
      if (s.t < tStart) continue;
      if (prev) {
        ctx.fillStyle = Number.isNaN(s.T) ? 'rgba(120,120,140,0.3)' : s.stable ? C.good : C.bad;
        ctx.fillRect(X(prev.t), PAD.t + ph - 3, Math.max(1, X(s.t) - X(prev.t)) + 0.5, 3);
      }
      prev = s;
    }

    // 温度曲线（按纪元着色）
    ctx.lineWidth = 1.6; ctx.lineJoin = 'round';
    prev = null;
    for (const s of history) {
      if (s.t < tStart || Number.isNaN(s.T)) { prev = null; continue; }
      if (prev) {
        ctx.strokeStyle = s.stable ? C.good : '#ffb4a8';
        ctx.beginPath(); ctx.moveTo(X(prev.t), Y(prev.T - KELVIN)); ctx.lineTo(X(s.t), Y(s.T - KELVIN)); ctx.stroke();
      }
      prev = s;
    }

    // 集合预报
    if (forecast) {
      const n = forecast.times.length;
      ctx.fillStyle = C.fc + '0.18)';
      ctx.beginPath();
      let started = false;
      for (let i = 0; i < n; i++) {
        if (Number.isNaN(forecast.p90[i])) break;
        const x = X(forecast.times[i]), y = Y(forecast.p90[i] - KELVIN);
        if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
      }
      for (let i = n - 1; i >= 0; i--) {
        if (Number.isNaN(forecast.p10[i])) continue;
        ctx.lineTo(X(forecast.times[i]), Y(forecast.p10[i] - KELVIN));
      }
      ctx.closePath(); ctx.fill();
      // 各成员细线
      ctx.lineWidth = 0.6; ctx.strokeStyle = C.fc + '0.25)';
      for (const m of forecast.members) {
        ctx.beginPath(); let st = false;
        for (let i = 0; i < n; i++) {
          if (Number.isNaN(m[i])) break;
          const x = X(forecast.times[i]), y = Y(m[i] - KELVIN);
          if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      // 控制预报
      ctx.lineWidth = 1.4; ctx.strokeStyle = C.fc + '0.95)'; ctx.setLineDash([4, 3]);
      ctx.beginPath(); let st = false;
      for (let i = 0; i < n; i++) {
        if (Number.isNaN(forecast.control[i])) break;
        const x = X(forecast.times[i]), y = Y(forecast.control[i] - KELVIN);
        if (!st) { ctx.moveTo(x, y); st = true; } else ctx.lineTo(x, y);
      }
      ctx.stroke(); ctx.setLineDash([]);
      // 恒纪元概率条
      for (let i = 1; i < n; i++) {
        const p = forecast.pStable[i];
        ctx.fillStyle = `rgba(111,227,161,${0.1 + 0.8 * p})`;
        ctx.fillRect(X(forecast.times[i - 1]), PAD.t, X(forecast.times[i]) - X(forecast.times[i - 1]) + 0.5, 3);
      }
      ctx.strokeStyle = 'rgba(127,182,255,0.6)';
      ctx.beginPath(); ctx.moveTo(X(forecast.t0), PAD.t); ctx.lineTo(X(forecast.t0), PAD.t + ph); ctx.stroke();
    }

    // 当前时刻
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath(); ctx.moveTo(X(now), PAD.t); ctx.lineTo(X(now), PAD.t + ph); ctx.stroke();
  }

  _timeAxis(ctx, t0, t1, X, yBase, ph) {
    const step = niceStep(t1 - t0, 6);
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.fillStyle = C.text;
    for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) {
      const x = X(t);
      ctx.strokeStyle = C.grid; ctx.beginPath(); ctx.moveTo(x, yBase - ph); ctx.lineTo(x, yBase); ctx.stroke();
      ctx.fillText(formatYear(t, step), x, yBase + 3);
    }
  }
}

function formatYear(t, step) {
  return step >= 1 ? `${Math.round(t)}` : t.toFixed(step >= 0.1 ? 1 : 2);
}

export class FluxChart {
  constructor(canvas) { this.canvas = canvas; this.window = 30; }

  draw(history, now, starsMeta) {
    const { ctx, w, h } = setupCanvas(this.canvas);
    const pw = w - PAD.l - PAD.r, ph = h - PAD.t - PAD.b;
    const tStart = Math.max(0, now - this.window), span = Math.max(1e-6, now - tStart);
    const X = t => PAD.l + (t - tStart) / span * pw;
    const lo = -3, hi = 2.5;
    const Y = v => PAD.t + (1 - (v - lo) / (hi - lo)) * ph;

    // Kopparapu 保守宜居带
    ctx.fillStyle = C.hab;
    ctx.fillRect(PAD.l, Y(Math.log10(1.1)), pw, Y(Math.log10(0.36)) - Y(Math.log10(1.1)));
    ctx.font = '10px "JetBrains Mono", Consolas, monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let v = -3; v <= 2; v++) {
      const y = Y(v);
      ctx.strokeStyle = v === 0 ? 'rgba(111,227,161,0.35)' : C.grid;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + pw, y); ctx.stroke();
      ctx.fillStyle = C.text; ctx.fillText(v === 0 ? '1' : `1e${v}`, PAD.l - 4, y);
    }
    TemperatureChart.prototype._timeAxis.call(this, ctx, tStart, now, X, PAD.t + ph, ph);

    const colors = new Map(starsMeta.map(m => [m.id, linearToCss(m.color)]));
    const series = new Map();
    for (const s of history) {
      if (s.t < tStart) continue;
      let total = 0;
      for (const f of s.fluxes) {
        total += f.v;
        if (!series.has(f.id)) series.set(f.id, []);
        series.get(f.id).push([s.t, f.v]);
      }
      if (s.fluxes.length) {
        if (!series.has('total')) series.set('total', []);
        series.get('total').push([s.t, total]);
      }
    }
    for (const [id, pts] of series) {
      ctx.strokeStyle = id === 'total' ? 'rgba(255,255,255,0.85)' : (colors.get(id) || '#888');
      ctx.lineWidth = id === 'total' ? 1.6 : 1.1;
      ctx.setLineDash(id === 'total' ? [] : []);
      ctx.globalAlpha = id === 'total' ? 1 : 0.85;
      ctx.beginPath();
      pts.forEach(([t, v], i) => {
        const y = Y(Math.max(lo, Math.min(hi, Math.log10(Math.max(v, 1e-9)))));
        if (i) ctx.lineTo(X(t), y); else ctx.moveTo(X(t), y);
      });
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

/**
 * 行星天空：方位等距投影，中心为最亮太阳的方向，边缘为其反方向。
 * 每个太阳的圆盘大小按真实视直径（相对于地球上看太阳）缩放。
 */
export function drawSky(canvas, sky) {
  const { ctx, w, h } = setupCanvas(canvas);
  const R = Math.min(w, h) / 2 - 8, cx = w / 2, cy = h / 2;
  ctx.strokeStyle = 'rgba(130,165,230,0.18)';
  for (const f of [1, 0.5]) { ctx.beginPath(); ctx.arc(cx, cy, R * f, 0, Math.PI * 2); ctx.stroke(); }
  ctx.font = '10px "Segoe UI", sans-serif';
  ctx.fillStyle = 'rgba(160,175,205,0.6)';
  ctx.textAlign = 'left';
  ctx.fillText('90°', cx + R * 0.5 + 3, cy - 3);
  if (!sky || !sky.length) return;

  const brightest = sky.reduce((a, b) => (b.flux > a.flux ? b : a));
  const c = brightest.dir;
  // 构造与 c 垂直的基
  const ref = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let u = [c[1] * ref[2] - c[2] * ref[1], c[2] * ref[0] - c[0] * ref[2], c[0] * ref[1] - c[1] * ref[0]];
  const un = Math.hypot(...u); u = u.map(x => x / un);
  const v = [c[1] * u[2] - c[2] * u[1], c[2] * u[0] - c[0] * u[2], c[0] * u[1] - c[1] * u[0]];

  const sorted = [...sky].sort((a, b) => a.flux - b.flux);
  for (const s of sorted) {
    const d = s.dir;
    const th = Math.acos(Math.max(-1, Math.min(1, d[0] * c[0] + d[1] * c[1] + d[2] * c[2])));
    const ph = Math.atan2(d[0] * v[0] + d[1] * v[1] + d[2] * v[2], d[0] * u[0] + d[1] * u[1] + d[2] * u[2]);
    const r = th / Math.PI * R;
    const x = cx + r * Math.cos(ph), y = cy + r * Math.sin(ph);
    const col = linearToCss(s.color);
    const disc = Math.max(1.2, Math.min(R * 0.45, 7 * s.size));
    const glow = disc + 6 + 10 * Math.min(1, Math.sqrt(s.flux));
    const g = ctx.createRadialGradient(x, y, 0, x, y, glow);
    g.addColorStop(0, col); g.addColorStop(Math.min(0.95, disc / glow), col);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = Math.min(1, 0.35 + 0.65 * Math.sqrt(Math.min(1, s.flux * 4)));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, glow, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = 'rgba(220,230,250,0.85)';
    ctx.textAlign = x > cx + R * 0.5 ? 'right' : 'left';
    const label = `${s.name.replace('恒星 ', '')} · ${s.size >= 0.1 ? s.size.toFixed(s.size < 1 ? 2 : 1) + '☉' : '飞星'}`;
    ctx.fillText(label, x + (ctx.textAlign === 'left' ? glow * 0.5 + 4 : -glow * 0.5 - 4), y - glow * 0.4);
  }
}
