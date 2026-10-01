// 场景环境：真实色温的背景星空、参考网格、宜居带辐照场、密切轨道
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { blackbodyColor } from '../physics/stellar.js';
import { G } from '../physics/constants.js';

const LOGDEPTH_V_PARS = '#include <common>\n#include <logdepthbuf_pars_vertex>';
const LOGDEPTH_V = '#include <logdepthbuf_vertex>';
const LOGDEPTH_F_PARS = '#include <logdepthbuf_pars_fragment>';
const LOGDEPTH_F = '#include <logdepthbuf_fragment>';

/**
 * 背景星空：星等服从幂律分布、颜色取自真实色温的黑体颜色，
 * 约 45% 的恒星集中在一条银河带上。整体随相机移动（无穷远）。
 */
export function makeStarfield(count = 9000) {
  const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count);
  // 银河平面法向
  const pole = new THREE.Vector3(0.3, 0.85, 0.42).normalize();
  const u = new THREE.Vector3(1, 0, 0).cross(pole).normalize();
  const w = pole.clone().cross(u);
  const v = new THREE.Vector3();
  const palette = [];
  for (let T = 2800; T <= 30000; T *= 1.12) palette.push(blackbodyColor(T));
  for (let i = 0; i < count; i++) {
    if (Math.random() < 0.45) {
      const ang = Math.random() * Math.PI * 2;
      const lat = (Math.random() + Math.random() + Math.random() - 1.5) * 0.18;
      v.copy(u).multiplyScalar(Math.cos(ang)).addScaledVector(w, Math.sin(ang)).addScaledVector(pole, lat).normalize();
    } else {
      const z = Math.random() * 2 - 1, ph = Math.random() * Math.PI * 2, s = Math.sqrt(1 - z * z);
      v.set(s * Math.cos(ph), z, s * Math.sin(ph));
    }
    pos.set([v.x, v.y, v.z], 3 * i);
    // 色温分布偏向 K/G 型
    const k = Math.min(palette.length - 1, Math.floor(Math.pow(Math.random(), 1.8) * palette.length));
    const c = palette[k];
    const mag = Math.pow(Math.random(), 7);                 // 绝大多数暗、少数亮
    const b = 0.25 + 1.6 * mag;
    col.set([c[0] * b, c[1] * b, c[2] * b], 3 * i);
    size[i] = 1.0 + 3.2 * mag;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('size', new THREE.BufferAttribute(size, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { uPixelRatio: { value: Math.min(devicePixelRatio, 2) } },
    vertexShader: /* glsl */ `
      attribute float size; attribute vec3 color; varying vec3 vCol;
      uniform float uPixelRatio;
      void main() {
        vCol = color;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_Position.z = gl_Position.w * 0.99999;   // 永远位于最远处
        gl_PointSize = size * uPixelRatio;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float a = smoothstep(0.5, 0.0, length(d));
        gl_FragColor = vec4(vCol * a, 1.0);
      }`,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -10;
  pts.scale.setScalar(1000);
  return pts;
}

/** 轨道平面参考网格：同心圆（AU）+ 径向线 + 刻度标签 */
export function makeGrid() {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: 0x5a7bb0, transparent: true, opacity: 0.16, depthWrite: false });
  const radii = [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500];
  group.userData.labels = [];
  for (const r of radii) {
    const pts = [];
    for (let i = 0; i <= 256; i++) {
      const a = i / 256 * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    }
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    ring.userData.radius = r;
    group.add(ring);
    const el = document.createElement('div');
    el.className = 'grid-label';
    el.textContent = `${r} AU`;
    const label = new CSS2DObject(el);
    label.position.set(r * Math.SQRT1_2, 0, r * Math.SQRT1_2);
    label.userData.radius = r;
    group.add(label);
    group.userData.labels.push(label);
  }
  const spokes = [];
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * Math.PI * 2;
    spokes.push(new THREE.Vector3(Math.cos(a) * 0.5, 0, Math.sin(a) * 0.5), new THREE.Vector3(Math.cos(a) * 500, 0, Math.sin(a) * 500));
  }
  group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(spokes),
    new THREE.LineBasicMaterial({ color: 0x5a7bb0, transparent: true, opacity: 0.06, depthWrite: false })));
  return group;
}

/** 按视距显示合适尺度的网格环 */
export function updateGrid(grid, viewDist) {
  grid.children.forEach(o => {
    const r = o.userData.radius;
    if (r === undefined) return;
    o.visible = r > viewDist * 0.04 && r < viewDist * 3;
  });
}

/**
 * 宜居带：在轨道平面上实时计算三颗恒星的总辐照场 S(x) = Σ Lᵢ / dᵢ²（以 S₀ 为单位），
 * 以 Kopparapu et al. (2013) 的保守宜居带边界着色：
 *   内边界（失控温室）S ≈ 1.1 S₀ ；外边界（最大温室）S ≈ 0.36 S₀
 */
export function makeHabitableZone() {
  const uniforms = {
    uStarPos: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
    uStarL: { value: [0, 0, 0] },
    uCount: { value: 0 },
    uExtent: { value: 50 },
    uCenter: { value: new THREE.Vector3() },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
      ${LOGDEPTH_V_PARS}
      varying vec3 vWorld;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
        ${LOGDEPTH_V}
      }`,
    fragmentShader: /* glsl */ `
      ${LOGDEPTH_F_PARS}
      uniform vec3 uStarPos[3];
      uniform float uStarL[3];
      uniform int uCount;
      uniform float uExtent;
      uniform vec3 uCenter;
      varying vec3 vWorld;
      void main() {
        ${LOGDEPTH_F}
        float S = 0.0;
        for (int i = 0; i < 3; i++) {
          if (i >= uCount) break;
          vec3 d = vWorld - uStarPos[i];
          S += uStarL[i] / max(dot(d, d), 1e-6);
        }
        float ls = log(S) / log(10.0);
        // 宜居带（log10 S ∈ [-0.44, 0.04]）
        float hz = smoothstep(-0.52, -0.40, ls) * (1.0 - smoothstep(0.0, 0.1, ls));
        // 等辐照线：S = 0.01, 0.1, 1, 10, 100 S₀
        float f = fract(ls + 100.0);
        float w = fwidth(ls) * 1.2;
        float iso = 1.0 - smoothstep(0.0, w, min(f, 1.0 - f));
        vec3 col = vec3(0.25, 0.9, 0.5) * hz * 0.16;
        col += vec3(1.0, 0.45, 0.15) * smoothstep(0.1, 1.2, ls) * 0.10;
        col += vec3(0.45, 0.6, 0.9) * iso * 0.12;
        float fade = 1.0 - smoothstep(0.55, 1.0, length(vWorld.xz - uCenter.xz) / uExtent);
        // 掠射角观察时淡出，避免平面在地平线方向堆积成色带
        vec3 toCam = normalize(cameraPosition - vWorld);
        fade *= smoothstep(0.03, 0.35, abs(toCam.y));
        gl_FragColor = vec4(col * fade, 1.0);
      }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

export function updateHabitableZone(mesh, stars, center, extent) {
  const u = mesh.material.uniforms;
  u.uCount.value = Math.min(3, stars.length);
  stars.slice(0, 3).forEach((s, i) => { u.uStarPos.value[i].set(...s.pos); u.uStarL.value[i] = s.luminosity; });
  mesh.position.set(center[0], 0, center[2]);
  mesh.scale.set(extent, 1, extent);
  u.uExtent.value = extent;
  u.uCenter.value.set(center[0], 0, center[2]);
}

/**
 * 行星当前的密切轨道（若此刻其他恒星消失，行星将沿此开普勒椭圆运行）。
 */
export function makeOsculatingOrbit() {
  const N = 256;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 3), 3));
  const line = new THREE.Line(geo, new THREE.LineDashedMaterial({
    color: 0x9fe0b0, dashSize: 0.05, gapSize: 0.04, transparent: true, opacity: 0.55, depthWrite: false,
  }));
  line.frustumCulled = false;
  line.userData.N = N;
  return line;
}

export function updateOsculatingOrbit(line, hostPos, hostVel, pPos, pVel, M, viewDist) {
  const r = pPos.map((c, k) => c - hostPos[k]);
  const v = pVel.map((c, k) => c - hostVel[k]);
  const mu = G * M;
  const rn = Math.hypot(...r);
  const h = [r[1] * v[2] - r[2] * v[1], r[2] * v[0] - r[0] * v[2], r[0] * v[1] - r[1] * v[0]];
  const hn = Math.hypot(...h);
  const vxh = [v[1] * h[2] - v[2] * h[1], v[2] * h[0] - v[0] * h[2], v[0] * h[1] - v[1] * h[0]];
  const ev = vxh.map((c, k) => c / mu - r[k] / rn);
  const e = Math.hypot(...ev);
  const energy = (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 2 - mu / rn;
  if (energy >= 0 || e >= 0.98) { line.visible = false; return; }
  const a = -mu / (2 * energy);
  const b = a * Math.sqrt(1 - e * e);
  const P = e > 1e-6 ? ev.map(c => c / e) : r.map(c => c / rn);
  const hh = h.map(c => c / hn);
  const Q = [hh[1] * P[2] - hh[2] * P[1], hh[2] * P[0] - hh[0] * P[2], hh[0] * P[1] - hh[1] * P[0]];
  const arr = line.geometry.attributes.position.array;
  const N = line.userData.N;
  for (let i = 0; i <= N; i++) {
    const E = i / N * Math.PI * 2;
    const x = a * (Math.cos(E) - e), y = b * Math.sin(E);
    for (let k = 0; k < 3; k++) arr[3 * i + k] = hostPos[k] + x * P[k] + y * Q[k];
  }
  line.geometry.attributes.position.needsUpdate = true;
  line.computeLineDistances();
  line.material.dashSize = viewDist * 0.006;
  line.material.gapSize = viewDist * 0.004;
  line.visible = true;
}
