import './style.css';
import { Simulation } from './sim/simulation.js';
import { PRESETS, DEFAULT_PRESET } from './physics/presets.js';
import { SceneView } from './render/view.js';
import { Hud, fmtYears } from './ui/hud.js';
import { TemperatureChart, FluxChart } from './ui/charts.js';

const $ = id => document.getElementById(id);

const sim = new Simulation();
const view = new SceneView($('viewport'));
const hud = new Hud();
const tChart = new TemperatureChart($('chartT'));
const sChart = new FluxChart($('chartS'));

const state = {
  paused: false,
  speed: 1,           // 模拟年 / 真实秒
  forecast: null,
};

// ---------------------------------------------------------------------------
// 场景载入与 URL 状态（#preset=…&seed=… 可复现任意宇宙）
// ---------------------------------------------------------------------------
function readHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  return { preset: p.get('preset'), seed: p.has('seed') ? parseInt(p.get('seed'), 10) : null };
}
function writeHash() {
  const p = new URLSearchParams({ preset: sim.presetKey });
  if (PRESETS[sim.presetKey].random) p.set('seed', sim.seed);
  history.replaceState(null, '', '#' + p.toString());
}
const randomSeed = () => Math.floor(Math.random() * 1e6);

function load(presetKey, seed) {
  cancelForecast();
  state.forecast = null;
  $('fcSummary').textContent = '';
  sim.load(presetKey, seed ?? randomSeed());
  view.sync(sim, { resetTrails: true, resetCamera: true });
  setSpeed(sim.preset.speed);
  $('preset').value = sim.presetKey;
  $('seed').value = sim.seed;
  $('seedRow').classList.toggle('hidden', !PRESETS[sim.presetKey].random);
  $('presetDesc').textContent = PRESETS[sim.presetKey].desc;
  $('log').innerHTML = '';
  sim.events.forEach(addLog);
  writeHash();
}

sim.on('event', e => addLog(e));
sim.on('structure', () => view.sync(sim));

function addLog(e) {
  const li = document.createElement('li');
  li.className = e.level;
  li.innerHTML = `<span class="t">${e.t.toFixed(2)} 年</span>`;
  li.appendChild(document.createTextNode(e.text));
  const log = $('log');
  log.prepend(li);
  while (log.children.length > 200) log.lastChild.remove();
  if (e.level === 'bad') toast(e.text);
}

// ---------------------------------------------------------------------------
// 控件
// ---------------------------------------------------------------------------
for (const [key, p] of Object.entries(PRESETS)) {
  const o = document.createElement('option');
  o.value = key; o.textContent = p.name;
  $('preset').appendChild(o);
}
$('preset').onchange = () => load($('preset').value, PRESETS[$('preset').value].random ? randomSeed() : 0);
$('btnDice').onclick = () => load(sim.presetKey === 'trisolaris' || PRESETS[sim.presetKey].random ? sim.presetKey : DEFAULT_PRESET, randomSeed());
$('seed').onchange = () => load(sim.presetKey, Math.max(0, parseInt($('seed').value, 10) || 0));
$('btnReset').onclick = () => load(sim.presetKey, sim.seed);
$('btnShare').onclick = async () => {
  writeHash();
  try { await navigator.clipboard.writeText(location.href); toast('链接已复制：打开即可复现这个宇宙'); }
  catch { toast(location.href); }
};

function setPaused(p) {
  state.paused = p;
  $('btnPlay').textContent = p ? '▶' : '⏸';
}
$('btnPlay').onclick = () => setPaused(!state.paused);

// 速度滑块为对数刻度：10^x 年/秒
function setSpeed(s) {
  state.speed = Math.min(20, Math.max(0.01, s));
  $('speed').value = Math.log10(state.speed);
  $('speedVal').textContent = `${state.speed < 0.1 ? state.speed.toFixed(3) : state.speed.toFixed(2)} 年/秒`;
}
$('speed').oninput = () => setSpeed(Math.pow(10, parseFloat($('speed').value)));

function setCamera(mode) {
  view.options.camera = mode;
  document.querySelectorAll('#camSeg button').forEach(b => b.classList.toggle('on', b.dataset.cam === mode));
  view._lastTarget = null;
}
document.querySelectorAll('#camSeg button').forEach(b => { b.onclick = () => setCamera(b.dataset.cam); });

function toggleOption(opt, value = !view.options[opt]) {
  view.options[opt] = value;
  if (opt === 'twin') {
    sim.twinEnabled = value;
    if (value) sim.twin.reset(sim.sys);
    view.syncTwin(sim);
    if (value) toast('孪生宇宙：初始仅相差 10⁻⁶ AU（约 150 千米）');
  }
  view.applyOptions();
  document.querySelectorAll('#toggles button').forEach(b => b.classList.toggle('on', !!view.options[b.dataset.opt]));
}
document.querySelectorAll('#toggles button').forEach(b => { b.onclick = () => toggleOption(b.dataset.opt); });

$('size').oninput = () => {
  const s = parseInt($('size').value, 10);
  $('sizeVal').textContent = `${s}×`;
  view.setSizeScale(s, sim);
};
$('btnClearTrails').onclick = () => view.clearTrails();

$('eta').oninput = () => {
  const eta = Math.pow(10, parseFloat($('eta').value));
  $('etaVal').textContent = eta.toExponential(0).replace('e', 'e');
  sim.setEta(eta);
};
$('mixed').oninput = () => {
  const h = parseInt($('mixed').value, 10);
  $('mlVal').textContent = `${h} m`;
  sim.setMixedLayer(h);
};

$('toggleLeft').onclick = () => { $('left').classList.toggle('collapsed'); document.body.classList.toggle('left-collapsed'); };
$('toggleRight').onclick = () => { $('right').classList.toggle('collapsed'); document.body.classList.toggle('right-collapsed'); };
$('toggleBottom').onclick = () => $('bottom').classList.toggle('collapsed');
$('btnHelp').onclick = () => $('help').classList.remove('hidden');
$('btnHelpClose').onclick = () => $('help').classList.add('hidden');
$('help').onclick = e => { if (e.target === $('help')) $('help').classList.add('hidden'); };

$('btnShot').onclick = screenshot;
function screenshot() {
  const a = document.createElement('a');
  a.href = view.screenshot();
  a.download = `trisolaris-${sim.presetKey}-${sim.seed}-y${sim.sys.t.toFixed(1)}.png`;
  a.click();
}

let toastTimer;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------------------
// 集合预报（Web Worker，不阻塞渲染）
// ---------------------------------------------------------------------------
let worker = null, fcId = 0;
function cancelForecast() {
  if (worker) { worker.terminate(); worker = null; }
  $('fcProgress').classList.add('hidden');
  $('btnForecast').disabled = false;
}
function runForecast() {
  if (sim.planetIdx < 0) { toast('当前没有行星可供预测'); return; }
  cancelForecast();
  const years = parseInt($('fcYears').value, 10);
  worker = new Worker(new URL('./sim/forecast.worker.js', import.meta.url), { type: 'module' });
  const id = ++fcId;
  $('btnForecast').disabled = true;
  $('fcProgress').classList.remove('hidden');
  $('fcProgress').firstElementChild.style.width = '0%';
  $('fcSummary').textContent = '正在积分 16 个集合成员……';
  worker.onmessage = (e) => {
    const msg = e.data;
    if (msg.id !== id) return;
    if (msg.type === 'progress') $('fcProgress').firstElementChild.style.width = `${msg.progress * 100}%`;
    if (msg.type === 'done') {
      state.forecast = msg.result;
      summarizeForecast(msg.result);
      cancelForecast();
    }
    if (msg.type === 'error') { $('fcSummary').textContent = `预测失败：${msg.message}`; cancelForecast(); }
  };
  const perturb = parseFloat($('fcErr').value);
  worker.postMessage({ id, snapshot: sim.snapshot(), options: { members: 16, years, sampleDt: years / 400, perturb, seed: randomSeed() } });
}
$('btnForecast').onclick = runForecast;

function summarizeForecast(f) {
  const n = f.times.length, span = f.times[n - 1] - f.t0;
  const at = i => fmtYears(f.times[i] - f.t0);
  // 可预报时长：成员温度离散度（10–90% 区间）首次超过 20 K 的时刻
  let horizon = -1;
  for (let i = 0; i < n; i++) if (!(f.p90[i] - f.p10[i] < 20)) { horizon = i; break; }
  const parts = [horizon < 0
    ? `预报期内各成员保持一致（可预报时长 > ${fmtYears(span)}）`
    : `约 ${at(horizon)} 后各成员显著分化，此后的预报只剩统计意义`];
  // 纪元转换：以集合中恒纪元成员占比 50% 为界
  const nowStable = f.pStable[0] >= 0.5;
  let cross = -1;
  for (let i = 1; i < n; i++) if ((f.pStable[i] >= 0.5) !== nowStable) { cross = i; break; }
  if (nowStable) {
    parts.push(cross < 0 ? `当前恒纪元预计持续整个预报期（末端概率 ${(f.pStable[n - 1] * 100).toFixed(0)}%）`
      : `当前恒纪元预计在 ${at(cross)} 后结束`);
  } else {
    parts.push(cross < 0 ? '预报期内多数成员未出现恒纪元'
      : `预计 ${at(cross)} 后进入恒纪元（峰值概率 ${(Math.max(...f.pStable.slice(cross)) * 100).toFixed(0)}%）`);
  }
  const lost = f.members.filter(m => Number.isNaN(m[n - 1])).length;
  if (lost) parts.push(`${lost} 个成员中行星被恒星吞没`);
  $('fcSummary').textContent = parts.join('；') + '。';
}

// ---------------------------------------------------------------------------
// 键盘
// ---------------------------------------------------------------------------
addEventListener('keydown', (e) => {
  if (e.target.matches('input[type=number], select')) return;
  const k = e.key.toLowerCase();
  const map = { t: 'trails', h: 'habitable', o: 'orbit', g: 'grid', l: 'labels', b: 'bloom', u: 'twin' };
  if (k === ' ') { setPaused(!state.paused); e.preventDefault(); }
  else if (k === 'r') $('btnDice').click();
  else if (k === '[') setSpeed(state.speed / 1.5);
  else if (k === ']') setSpeed(state.speed * 1.5);
  else if (k === '1') setCamera('com');
  else if (k === '2') setCamera('planet');
  else if (k === '3') setCamera('free');
  else if (k === 'f') runForecast();
  else if (k === 'p') screenshot();
  else if (k === 'escape') $('help').classList.add('hidden');
  else if (k === '?') $('help').classList.toggle('hidden');
  else if (map[k]) toggleOption(map[k]);
});

// ---------------------------------------------------------------------------
// 主循环
// ---------------------------------------------------------------------------
let last = performance.now();
let chartTick = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dtReal = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (!state.paused) {
    sim.advance(state.speed * dtReal, 14, s => view.sampleTrails(s));
    if (state.forecast && sim.sys.t > state.forecast.times[state.forecast.times.length - 1]) state.forecast = null;
  }
  view.update(sim, state.paused ? 0 : dtReal);
  view.render();
  hud.update(sim, sim.stats);
  if (++chartTick % 3 === 0) {
    tChart.draw(sim.history, sim.sys.t, state.forecast);
    sChart.draw(sim.history, sim.sys.t, sim.sys.meta.filter(m => m.kind === 'star'));
  }
}

// 初始化
// 窄屏默认收起两侧面板，把空间留给三维视图
if (innerWidth < 960) {
  $('left').classList.add('collapsed'); document.body.classList.add('left-collapsed');
  $('right').classList.add('collapsed'); document.body.classList.add('right-collapsed');
}
// 两侧面板在窄屏上互斥展开
$('toggleLeft').addEventListener('click', () => {
  if (innerWidth < 960 && !$('left').classList.contains('collapsed')) { $('right').classList.add('collapsed'); document.body.classList.add('right-collapsed'); }
});
$('toggleRight').addEventListener('click', () => {
  if (innerWidth < 960 && !$('right').classList.contains('collapsed')) { $('left').classList.add('collapsed'); document.body.classList.add('left-collapsed'); }
});
const init = readHash();
document.querySelectorAll('#toggles button').forEach(b => b.classList.toggle('on', !!view.options[b.dataset.opt]));
setCamera('com');
load(PRESETS[init.preset] ? init.preset : DEFAULT_PRESET, init.seed ?? randomSeed());
requestAnimationFrame(frame);

// 便于调试
window.__sim = sim;
window.__view = view;
