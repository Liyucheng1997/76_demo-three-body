// 天体可视化：恒星（米粒组织 + 临边昏暗 + 日冕）、行星（程序化地表 + 多光源照明）、轨迹
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { NOISE } from './glsl.js';
import { R_SUN_AU } from '../physics/constants.js';
import { linearToCss, blackbodyColor } from '../physics/stellar.js';
import { iceFraction, oceanFraction } from '../climate/ebm.js';

const LOGDEPTH_V_PARS = '#include <common>\n#include <logdepthbuf_pars_vertex>';
const LOGDEPTH_V = '#include <logdepthbuf_vertex>';
const LOGDEPTH_F_PARS = '#include <logdepthbuf_pars_fragment>';
const LOGDEPTH_F = '#include <logdepthbuf_fragment>';

/** 程序生成的径向光晕贴图 */
function glowTexture(rays = false) {
  const S = 256;
  const c = document.createElement('canvas'); c.width = c.height = S;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1;
      const r = Math.hypot(dx, dy);
      let v = Math.max(0, Math.pow(Math.max(0, 1 - r), 2.2)) * 0.9 + 0.12 * Math.exp(-r * r * 30);
      if (rays) {
        const ang = Math.atan2(dy, dx);
        const ray = Math.pow(Math.abs(Math.cos(ang * 2)), 60) + Math.pow(Math.abs(Math.cos(ang * 2 + Math.PI / 4)), 120) * 0.5;
        v += ray * Math.max(0, 1 - r) ** 3 * 0.6;
      }
      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(255, v * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}
const GLOW = glowTexture(false);
const FLARE = glowTexture(true);

// ---------------------------------------------------------------------------
// 恒星
// ---------------------------------------------------------------------------
const STAR_VERT = /* glsl */ `
${LOGDEPTH_V_PARS}
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
void main() {
  vObjN = normal;
  vViewN = normalize(normalMatrix * normal);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
  ${LOGDEPTH_V}
}`;

const STAR_FRAG = /* glsl */ `
${LOGDEPTH_F_PARS}
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
uniform float uSeed;
uniform float uSpots;
varying vec3 vObjN;
varying vec3 vViewN;
varying vec3 vViewPos;
${NOISE}
void main() {
  ${LOGDEPTH_F}
  vec3 n = normalize(vObjN);
  float mu = clamp(dot(normalize(vViewN), normalize(-vViewPos)), 0.0, 1.0);
  // 二次临边昏暗律 I(μ)/I(1) = 1 − u₁(1−μ) − u₂(1−μ)²
  float limb = 1.0 - 0.45 * (1.0 - mu) - 0.25 * (1.0 - mu) * (1.0 - mu);
  // 米粒组织（对流元胞）与超米粒组织
  float gran = snoise(n * 38.0 + vec3(0.0, uTime * 0.6, uSeed)) * 0.5 + snoise(n * 9.0 - vec3(uTime * 0.15)) * 0.5;
  // 黑子：冷星（K/M 型）对流层更深，黑子更多
  float sp = smoothstep(0.5, 0.7, fbm(n * 2.5 + vec3(uSeed, uTime * 0.02, 0.0))) * uSpots;
  // 临边处看到的是更高、更冷的光球层 → 颜色偏红（以色温幂次近似）
  vec3 base = pow(uColor, vec3(1.4));
  vec3 limbCol = pow(uColor, vec3(3.0)) * vec3(1.0, 0.8, 0.6);
  vec3 col = mix(limbCol, base, smoothstep(0.0, 0.9, mu));
  col *= (0.62 + 0.45 * gran) * (1.0 - 0.8 * sp);
  col = mix(col, vec3(1.0), 0.18 * pow(mu, 3.0));
  gl_FragColor = vec4(col * limb * uIntensity, 1.0);
}`;

export class StarVisual {
  constructor(meta, scene, labelLayer) {
    this.id = meta.id;
    this.group = new THREE.Group();
    this.uniforms = {
      uColor: { value: new THREE.Color(...meta.color) },
      uIntensity: { value: 1.6 },
      uTime: { value: 0 },
      uSeed: { value: Math.random() * 100 },
      uSpots: { value: THREE.MathUtils.clamp((5800 - meta.Teff) / 2500, 0, 1) },
    };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 64, 32),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: STAR_VERT, fragmentShader: STAR_FRAG }),
    );
    this.group.add(this.mesh);

    const col = new THREE.Color(...meta.color);
    this.corona = new THREE.Sprite(new THREE.SpriteMaterial({
      map: GLOW, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.group.add(this.corona);
    // 远距离时的屏幕空间光点（保证缩小视图时恒星依然可见）
    this.flare = new THREE.Sprite(new THREE.SpriteMaterial({
      map: FLARE, color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: false,
    }));
    this.group.add(this.flare);

    const el = document.createElement('div');
    el.className = 'body-label';
    el.innerHTML = `<span class="dot" style="background:${linearToCss(meta.color)}"></span>${meta.name}`;
    this.label = new CSS2DObject(el);
    this.label.center.set(-0.15, 1.4);
    this.group.add(this.label);
    this.labelLayer = labelLayer;

    this.setMeta(meta, 12);
    scene.add(this.group);
  }

  setMeta(meta, sizeScale) {
    this.meta = meta;
    this.radius = meta.radiusSun * R_SUN_AU * sizeScale;
    this.mesh.scale.setScalar(this.radius);
    const lumBoost = Math.pow(meta.luminosity, 0.18);
    this.corona.scale.setScalar(this.radius * 7 * lumBoost);
    this.flareBase = 0.05 * Math.pow(meta.luminosity, 0.15);
  }

  update(pos, time, camera, viewportH) {
    this.group.position.set(pos[0], pos[1], pos[2]);
    this.uniforms.uTime.value = time;
    // 屏幕上的视半径（占视口高度比例），据此淡入淡出远距离光点
    const dist = camera.position.distanceTo(this.group.position);
    const screen = this.radius / (dist * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    const f = THREE.MathUtils.clamp(1 - screen / 0.03, 0, 1);
    this.flare.material.opacity = 0.9 * f;
    // 相机进入日冕范围时淡出，避免整屏过曝
    const near = THREE.MathUtils.smoothstep(dist / this.corona.scale.x, 0.6, 2.5);
    this.corona.material.opacity = 0.6 * near;
    this.flare.scale.setScalar(this.flareBase);
    return screen;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.label.element.remove();
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
    this.corona.material.dispose(); this.flare.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// 行星
// ---------------------------------------------------------------------------
const PLANET_VERT = /* glsl */ `
${LOGDEPTH_V_PARS}
varying vec3 vObjN;
varying vec3 vWorldN;
varying vec3 vWorldPos;
void main() {
  vObjN = normal;
  vWorldN = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${LOGDEPTH_V}
}`;

const PLANET_FRAG = /* glsl */ `
${LOGDEPTH_F_PARS}
#define MAX_STARS 3
uniform vec3 uStarPos[MAX_STARS];
uniform vec3 uStarCol[MAX_STARS];
uniform float uStarFlux[MAX_STARS];
uniform int uCount;
uniform float uIce;      // 冰覆盖比例
uniform float uOcean;    // 海洋存量
uniform float uVeg;      // 植被
uniform float uLava;     // 地表炽热程度
uniform vec3 uLavaCol;
uniform float uCity;     // 城市灯光（文明程度）
uniform float uCloud;
uniform float uTime;
uniform vec3 uCamPos;
varying vec3 vObjN;
varying vec3 vWorldN;
varying vec3 vWorldPos;
${NOISE}
void main() {
  ${LOGDEPTH_F}
  vec3 n = normalize(vObjN);
  vec3 N = normalize(vWorldN);
  float h = fbm(n * 1.7 + vec3(3.1, 7.7, 1.3));
  float detail = fbm(n * 9.0);
  float lat = abs(n.y);

  // 海平面随海洋存量下降
  float sea = mix(-1.2, 0.02, uOcean);
  bool isLand = h > sea;

  vec3 deep = vec3(0.010, 0.035, 0.11), shallow = vec3(0.02, 0.12, 0.25);
  vec3 ocean = mix(deep, shallow, smoothstep(sea - 0.25, sea, h));
  vec3 desert = vec3(0.50, 0.38, 0.24), green = vec3(0.07, 0.20, 0.05), rock = vec3(0.32, 0.30, 0.28);
  vec3 seabed = vec3(0.35, 0.24, 0.17);
  vec3 land = mix(desert, green, uVeg * smoothstep(-0.2, 0.3, detail + 0.3 * (1.0 - lat)));
  land = mix(land, rock, smoothstep(0.35, 0.6, h));
  // 海洋蒸干后裸露的海床
  if (h < 0.02 && isLand) land = mix(seabed, land, 0.3);
  vec3 albedo = isLand ? land : ocean;

  // 冰盖：两极面积比例 uIce 对应纬度 sin(φ) = 1 − uIce
  float iceLine = 1.0 - uIce + 0.06 * detail;
  float ice = smoothstep(iceLine - 0.02, iceLine + 0.02, lat);
  albedo = mix(albedo, vec3(0.80, 0.86, 0.92), ice);

  // 云层
  float cl = fbm(n * 3.0 + vec3(uTime * 0.05, 0.0, uTime * 0.03));
  float cloud = smoothstep(0.55 - uCloud, 0.9 - uCloud, cl * 0.5 + 0.5) * uCloud;
  albedo = mix(albedo, vec3(0.9), cloud);

  // 多恒星照明：每颗星按其在行星处的辐照度 S/S₀ 与自身颜色贡献光照
  vec3 irr = vec3(0.0);
  float day = 0.0;
  for (int i = 0; i < MAX_STARS; i++) {
    if (i >= uCount) break;
    vec3 L = normalize(uStarPos[i] - vWorldPos);
    float ndl = max(dot(N, L), 0.0);
    irr += uStarCol[i] * uStarFlux[i] * ndl;
    day += uStarFlux[i] * smoothstep(-0.05, 0.15, dot(N, L));
  }
  vec3 light = 1.0 - exp(-1.8 * irr);       // 曝光压缩：S₀ 附近接近正常亮度
  vec3 col = albedo * (light * 1.6 + 0.012);

  // 夜面城市灯光
  float night = 1.0 - clamp(day * 3.0, 0.0, 1.0);
  float city = smoothstep(0.55, 0.75, snoise(n * 40.0) * 0.5 + 0.5) * smoothstep(0.0, 0.3, detail + 0.2);
  if (isLand && ice < 0.5) col += vec3(1.0, 0.62, 0.25) * city * uCity * night * 1.2;

  // 熔岩地表 / 炽热辐射
  float cracks = smoothstep(0.1, 0.0, abs(detail)) + 0.35;
  col += uLavaCol * uLava * cracks * 2.0;

  // 大气边缘散射
  vec3 V = normalize(uCamPos - vWorldPos);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  col += vec3(0.30, 0.55, 1.0) * rim * min(1.0, length(light)) * 0.6 * uOcean;

  gl_FragColor = vec4(col, 1.0);
}`;

export class PlanetVisual {
  constructor(meta, scene) {
    this.id = meta.id;
    this.group = new THREE.Group();
    this.uniforms = {
      uStarPos: { value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()] },
      uStarCol: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] },
      uStarFlux: { value: [0, 0, 0] },
      uCount: { value: 0 },
      uIce: { value: 0.1 }, uOcean: { value: 1 }, uVeg: { value: 1 },
      uLava: { value: 0 }, uLavaCol: { value: new THREE.Color(1, 0.3, 0.05) },
      uCity: { value: 0 }, uCloud: { value: 0.35 }, uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
    };
    this.mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 96, 64),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG }),
    );
    this.mesh.rotation.z = 0.41;   // 自转轴倾角 23.5°
    this.group.add(this.mesh);

    const el = document.createElement('div');
    el.className = 'body-label planet';
    el.innerHTML = `<span class="ring"></span>${meta.name}`;
    this.label = new CSS2DObject(el);
    this.label.center.set(-0.12, 1.6);
    this.group.add(this.label);
    this.setScale(12);
    scene.add(this.group);
  }

  setScale(sizeScale) {
    this.radius = 0.0016 * sizeScale;
    this.mesh.scale.setScalar(this.radius);
  }

  /**
   * @param stars [{pos, color, flux}] @param T 表面温度 K @param civ 文明对象
   */
  update(pos, stars, T, civLevel, time, camera) {
    this.group.position.set(pos[0], pos[1], pos[2]);
    const u = this.uniforms;
    u.uCount.value = Math.min(3, stars.length);
    stars.slice(0, 3).forEach((s, i) => {
      u.uStarPos.value[i].set(s.pos[0], s.pos[1], s.pos[2]);
      u.uStarCol.value[i].setRGB(...s.color);
      u.uStarFlux.value[i] = s.flux;
    });
    u.uIce.value = iceFraction(T) * 0.98 + 0.02 * Math.max(0, Math.min(1, (300 - T) / 30));
    u.uOcean.value = oceanFraction(T);
    u.uVeg.value = THREE.MathUtils.clamp(1 - Math.abs(T - 292) / 35, 0, 1);
    u.uLava.value = THREE.MathUtils.clamp((T - 750) / 900, 0, 1);
    if (T > 700) u.uLavaCol.value.setRGB(...blackbodyColor(Math.max(1000, T)));
    u.uCloud.value = THREE.MathUtils.clamp(0.25 + (T - 288) / 150, 0.1, 0.85) * (T > 900 ? 0.3 : 1);
    u.uCity.value = civLevel;
    u.uTime.value = time;
    u.uCamPos.value.copy(camera.position);
    this.mesh.rotation.y = time * 1.3;
  }

  dispose(scene) {
    scene.remove(this.group);
    this.label.element.remove();
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
  }
}

// ---------------------------------------------------------------------------
// 轨迹：定长环形缓冲 + 逐顶点透明度渐隐
// ---------------------------------------------------------------------------
export class Trail {
  constructor(color, maxPoints, spacing, scene, opacity = 0.8) {
    this.max = maxPoints;
    this.spacing2 = spacing * spacing;
    this.count = 0;
    // 轨迹颜色做饱和度增强，便于区分色温相近的恒星
    const sat = color.map(c => Math.pow(c, 2.2));
    const m = Math.max(...sat);
    this.color = new THREE.Color(...sat.map(c => c / m));
    this.opacity = opacity;
    this.positions = new Float32Array(maxPoints * 3);
    this.colors = new Float32Array(maxPoints * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.line.frustumCulled = false;
    this.last = null;
    this.dirty = false;
    scene.add(this.line);
  }

  setSpacing(s) { this.spacing2 = s * s; }

  sample(x, y, z) {
    if (this.last) {
      const dx = x - this.last[0], dy = y - this.last[1], dz = z - this.last[2];
      if (dx * dx + dy * dy + dz * dz < this.spacing2) {
        // 让轨迹末端始终贴住天体
        this._writeHead(x, y, z);
        return;
      }
    }
    this.last = [x, y, z];
    if (this.count < this.max) {
      this.count++;
      this._ramp();
    } else {
      this.positions.copyWithin(0, 3);
    }
    this._writeHead(x, y, z);
  }

  _writeHead(x, y, z) {
    if (!this.count) return;
    const i = (this.count - 1) * 3;
    this.positions[i] = x; this.positions[i + 1] = y; this.positions[i + 2] = z;
    this.dirty = true;
  }

  _ramp() {
    const n = this.count, c = this.colors, col = this.color;
    for (let i = 0; i < n; i++) {
      const a = Math.pow(i / Math.max(1, n - 1), 1.6) * this.opacity;
      c[4 * i] = col.r; c[4 * i + 1] = col.g; c[4 * i + 2] = col.b; c[4 * i + 3] = a;
    }
    this.line.geometry.attributes.color.needsUpdate = true;
    this.line.geometry.setDrawRange(0, n);
  }

  flush() {
    if (!this.dirty) return;
    this.line.geometry.attributes.position.needsUpdate = true;
    this.dirty = false;
  }

  clear() {
    this.count = 0; this.last = null;
    this.line.geometry.setDrawRange(0, 0);
  }

  dispose(scene) {
    scene.remove(this.line);
    this.line.geometry.dispose(); this.line.material.dispose();
  }
}
