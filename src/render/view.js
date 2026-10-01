// 三维视图：渲染器、后期辉光、相机控制、天体与轨迹的生命周期管理
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js';

import { StarVisual, PlanetVisual, Trail } from './bodies.js';
import {
  makeStarfield, makeGrid, updateGrid, makeHabitableZone, updateHabitableZone,
  makeOsculatingOrbit, updateOsculatingOrbit,
} from './environment.js';

const PLANET_COLOR = [0.55, 0.9, 0.6];

export class SceneView {
  constructor(container) {
    this.container = container;
    this.options = {
      trails: true, habitable: true, grid: true, labels: true, orbit: true, bloom: true, twin: false,
      sizeScale: 12, camera: 'com',
    };

    const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(container.clientWidth, container.clientHeight);
    this.labelRenderer.domElement.className = 'label-layer';
    container.appendChild(this.labelRenderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020308);
    this.camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 1e-5, 1e7);
    this.camera.position.set(0, 20, 30);

    this.controls = new OrbitControls(this.camera, renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.02;
    this.controls.maxDistance = 50000;
    this.controls.zoomSpeed = 1.2;

    this.starfield = makeStarfield();
    this.scene.add(this.starfield);
    this.grid = makeGrid();
    this.scene.add(this.grid);
    this.hz = makeHabitableZone();
    this.scene.add(this.hz);
    this.orbitLine = makeOsculatingOrbit();
    this.scene.add(this.orbitLine);

    // 后期：HDR 渲染 → 辉光 → 色调映射与 sRGB 输出
    this.composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }));
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 0.85, 0.6, 0.92);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
    this.composer.setSize(container.clientWidth, container.clientHeight);

    this.visuals = new Map();   // id → StarVisual | PlanetVisual
    this.trails = new Map();    // id → Trail
    this.twinVisuals = new Map();
    this.twinTrails = new Map();
    this._target = new THREE.Vector3();
    this._lastTarget = null;
    this.time = 0;

    addEventListener('resize', () => this.resize());
    new ResizeObserver(() => this.resize()).observe(container);
  }

  resize() {
    const w = this.container.clientWidth, h = this.container.clientHeight;
    if (!w || !h) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.labelRenderer.setSize(w, h);
  }

  /** 根据当前模拟的天体列表重建可视对象（保留同 id 天体的轨迹） */
  sync(sim, { resetTrails = false, resetCamera = false } = {}) {
    const { sys } = sim;
    const ids = new Set(sys.meta.map(m => m.id));
    for (const [id, v] of this.visuals) {
      if (!ids.has(id) || resetTrails) { v.dispose(this.scene); this.visuals.delete(id); }
    }
    for (const [id, t] of this.trails) {
      if (!ids.has(id) || resetTrails) { t.dispose(this.scene); this.trails.delete(id); }
    }
    this.viewScale = sim.preset.view;
    const spacing = this.viewScale * 0.0012;
    sys.meta.forEach(m => {
      let v = this.visuals.get(m.id);
      if (v && m.kind === 'star' && v.meta.mass !== m.mass) { v.dispose(this.scene); this.visuals.delete(m.id); v = null; }
      if (!v) {
        v = m.kind === 'star' ? new StarVisual(m, this.scene) : new PlanetVisual(m, this.scene);
        this.visuals.set(m.id, v);
      }
      if (m.kind === 'star') v.setMeta(m, this.options.sizeScale); else v.setScale(this.options.sizeScale);
      if (!this.trails.has(m.id)) {
        const t = m.kind === 'star'
          ? new Trail(m.color, 4000, spacing, this.scene, 0.75)
          : new Trail(PLANET_COLOR, 1500, spacing * 0.5, this.scene, 0.6);
        this.trails.set(m.id, t);
      }
    });
    this.applyOptions();
    if (resetCamera) this.frame(sim);
    this.syncTwin(sim);
  }

  syncTwin(sim) {
    for (const v of this.twinVisuals.values()) this.scene.remove(v);
    for (const t of this.twinTrails.values()) t.dispose(this.scene);
    this.twinVisuals.clear(); this.twinTrails.clear();
    if (!this.options.twin) return;
    const tw = sim.twin.sys;
    tw.meta.forEach(m => {
      const r = (m.kind === 'star' ? m.radiusSun * 0.00465 : 0.0016) * this.options.sizeScale * 1.25;
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12),
        new THREE.MeshBasicMaterial({ color: 0xc8d8ff, wireframe: true, transparent: true, opacity: 0.45 }));
      this.scene.add(mesh);
      this.twinVisuals.set(m.id, mesh);
      this.twinTrails.set(m.id, new Trail([0.75, 0.8, 1.0], 2500, this.viewScale * 0.0012, this.scene, 0.35));
    });
  }

  /** 相机取景：使整个系统可见 */
  frame(sim) {
    const d = sim.preset.view;
    const c = this._focusPoint(sim) || this._focusPoint(sim, 'com');
    this.controls.target.set(...c);
    this.camera.position.set(c[0] + d * 0.15, c[1] + d * 0.75, c[2] + d * 1.05);
    this._lastTarget = null;
    this.controls.update();
  }

  applyOptions() {
    const o = this.options;
    for (const t of this.trails.values()) t.line.visible = o.trails;
    this.grid.visible = o.grid;
    this.hz.visible = o.habitable;
    this.labelRenderer.domElement.style.display = o.labels ? '' : 'none';
    this.bloom.enabled = o.bloom;
  }

  setSizeScale(s, sim) {
    this.options.sizeScale = s;
    for (const [id, v] of this.visuals) {
      const m = sim.sys.meta.find(mm => mm.id === id);
      if (!m) continue;
      if (m.kind === 'star') v.setMeta(m, s); else v.setScale(s);
    }
    this.syncTwin(sim);
  }

  clearTrails() {
    for (const t of this.trails.values()) t.clear();
    for (const t of this.twinTrails.values()) t.clear();
  }

  /** 每个积分步后调用：采样轨迹 */
  sampleTrails(sys) {
    for (let i = 0; i < sys.n; i++) {
      const t = this.trails.get(sys.meta[i].id);
      if (t) t.sample(sys.x[3 * i], sys.x[3 * i + 1], sys.x[3 * i + 2]);
    }
  }

  _focusPoint(sim, mode = this.options.camera) {
    const { sys } = sim;
    if (mode === 'planet') {
      const p = sim.planetIdx;
      if (p >= 0) return sys.pos(p);
    }
    if (mode === 'free') return null;
    // 质心：只计入未被抛射的恒星（否则逃逸星会把质心拖走）
    // 同时排除远在视野尺度之外的恒星（如 8700 AU 外的比邻星）
    const escaped = new Set((sim.analysis?.hierarchy.escaped || []).map(i => sys.meta[i]?.id));
    const p = sim.planetIdx;
    let anchor = null;
    sys.meta.forEach((m, i) => {
      if (m.kind !== 'star' || escaped.has(m.id)) return;
      const d = p >= 0 ? Math.hypot(...sys.pos(i).map((c, k) => c - sys.x[3 * p + k])) : -sys.m[i];
      if (!anchor || d < anchor.d) anchor = { d, pos: sys.pos(i) };
    });
    if (!anchor) return [0, 0, 0];
    const reach = 8 * sim.preset.view;
    const c = sys.centerOfMass((m, i) => m.kind === 'star' && !escaped.has(m.id)
      && Math.hypot(...sys.pos(i).map((x, k) => x - anchor.pos[k])) < reach);
    return c.mass > 0 ? c.pos : anchor.pos;
  }

  update(sim, dtReal) {
    const { sys } = sim;
    this.time += dtReal;
    const cam = this.camera;

    // --- 相机跟随：平移相机与目标，保持当前视角 ---
    const focus = this._focusPoint(sim);
    if (focus) {
      this._target.set(...focus);
      if (this._lastTarget) {
        const delta = this._target.clone().sub(this._lastTarget);
        cam.position.add(delta);
        this.controls.target.add(delta);
      } else {
        this.controls.target.copy(this._target);
      }
      // 平滑地消除残差
      const resid = this._target.clone().sub(this.controls.target);
      this.controls.target.addScaledVector(resid, 0.15);
      cam.position.addScaledVector(resid, 0.15);
      this._lastTarget = this._target.clone();
    } else {
      this._lastTarget = null;
    }
    this.controls.update();

    const viewDist = cam.position.distanceTo(this.controls.target);
    const H = this.renderer.domElement.clientHeight;

    // --- 恒星 ---
    const starInfo = [];
    let maxScreen = 0;
    sys.meta.forEach((m, i) => {
      const v = this.visuals.get(m.id);
      if (!v) return;
      const pos = sys.pos(i);
      if (m.kind === 'star') {
        maxScreen = Math.max(maxScreen, v.update(pos, this.time, cam, H));
        starInfo.push({ pos, color: m.color, luminosity: m.luminosity });
      }
    });
    // 恒星占据大片屏幕时减弱辉光，保留表面细节
    this.bloom.strength = 0.9 * THREE.MathUtils.clamp(1 - maxScreen * 2.2, 0.12, 1);

    // --- 行星 ---
    const p = sim.planetIdx;
    if (p >= 0) {
      const v = this.visuals.get(sim.planetId);
      const pp = sys.pos(p);
      const stars = starInfo.map(s => {
        const d2 = (s.pos[0] - pp[0]) ** 2 + (s.pos[1] - pp[1]) ** 2 + (s.pos[2] - pp[2]) ** 2;
        return { pos: s.pos, color: s.color, flux: s.luminosity / d2 };
      }).sort((a, b) => b.flux - a.flux);
      const civ = sim.civ;
      const civLevel = civ.status === 'active' || civ.status === 'dehydrated'
        ? Math.min(1, civ.progress / 30) * (civ.status === 'active' ? 1 : 0.15) : 0;
      v.update(pp, stars, sim.climate.T, civLevel, this.time, cam);

      // 密切轨道
      const orbit = sim.analysis?.planet?.orbit;
      if (this.options.orbit && orbit && (orbit.type === 'S' || orbit.type === 'P')) {
        let hp, hv, M = 0;
        if (orbit.type === 'S') { hp = sys.pos(orbit.host[0]); hv = sys.vel(orbit.host[0]); M = sys.m[orbit.host[0]]; }
        else {
          const [a, b] = orbit.host; M = sys.m[a] + sys.m[b];
          hp = sys.pos(a).map((c, k) => (c * sys.m[a] + sys.pos(b)[k] * sys.m[b]) / M);
          hv = sys.vel(a).map((c, k) => (c * sys.m[a] + sys.vel(b)[k] * sys.m[b]) / M);
        }
        updateOsculatingOrbit(this.orbitLine, hp, hv, pp, sys.vel(p), M + sys.m[p], viewDist);
      } else {
        this.orbitLine.visible = false;
      }
    } else {
      this.orbitLine.visible = false;
    }

    // --- 孪生宇宙 ---
    if (this.options.twin && sim.twinEnabled) {
      const tw = sim.twin.sys;
      for (const [id, mesh] of this.twinVisuals) {
        const j = tw.indexOf(id);
        mesh.visible = j >= 0;
        if (j < 0) continue;
        mesh.position.set(tw.x[3 * j], tw.x[3 * j + 1], tw.x[3 * j + 2]);
        const tr = this.twinTrails.get(id);
        tr.sample(tw.x[3 * j], tw.x[3 * j + 1], tw.x[3 * j + 2]);
        tr.flush();
      }
    }

    for (const t of this.trails.values()) t.flush();

    // --- 环境 ---
    const center = this.controls.target;
    if (this.hz.visible) updateHabitableZone(this.hz, starInfo, [center.x, center.y, center.z], Math.max(viewDist * 2.5, 3));
    const com = this._focusPoint(sim, 'com');
    this.grid.position.set(com[0], com[1], com[2]);
    updateGrid(this.grid, viewDist);
    this.starfield.position.copy(cam.position);
  }

  render() {
    this.composer.render();
    this.labelRenderer.render(this.scene, this.camera);
  }

  screenshot() {
    this.render();
    return this.renderer.domElement.toDataURL('image/png');
  }
}
