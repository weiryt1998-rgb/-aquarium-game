import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { lerp, seededRandom, smoothstep } from '../utils/math.js';
import { fbm3, noise3 } from '../utils/noise.js';
import { applyShaderMods, sharedUniforms } from '../render/shaderMods.js';

/**
 * ของตกแต่งชั่วคราวสร้างด้วยโค้ด (ใช้จนกว่าจะมีไฟล์ .glb)
 * ทุกชิ้นวางฐานที่ y = 0 และใช้ vertex color แทน texture
 */

const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _q = new THREE.Quaternion();
const UP = new THREE.Vector3(0, 1, 0);

/** เตรียมชิ้นส่วน: แปลงเป็น non-indexed, ลบ uv, ใส่สี (คงที่ หรือฟังก์ชัน (pos, normal, outColor)) */
function part(geo, color, matrix) {
  let g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  if (matrix) g.applyMatrix4(matrix);
  if (g.attributes.uv) g.deleteAttribute('uv');
  if (!g.attributes.normal) g.computeVertexNormals();
  const pos = g.attributes.position;
  const nrm = g.attributes.normal;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const fixed = typeof color === 'function' ? null : new THREE.Color(color);
  for (let i = 0; i < pos.count; i++) {
    if (fixed) c.copy(fixed);
    else color(_v.fromBufferAttribute(pos, i), _n.fromBufferAttribute(nrm, i), c);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

function merge(parts) {
  const geo = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  geo.computeBoundingSphere();
  return geo;
}

function mesh(geo, matParams = {}) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0, ...matParams });
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

/** matrix สำหรับวาง geometry ที่ตั้งตามแกน Y ให้ชี้ไปทาง dir จากจุด start */
function alignMatrix(start, dir, scale = 1) {
  _q.setFromUnitVectors(UP, _v.copy(dir).normalize());
  return new THREE.Matrix4().compose(start, _q, new THREE.Vector3(scale, scale, scale));
}

/**
 * ใบไม้/ใบหญ้าแบบแถบยาว
 * widthProfile(v) คืนค่า 0..1 ของความกว้างตามความสูง
 */
function blade({ base, height, width, lean, angle, twist = 0, segments = 10, widthProfile, droop = 0.12, bottom, top, shade = 1 }) {
  const positions = [];
  const colors = [];
  const indices = [];
  const leanDir = new THREE.Vector3(Math.cos(angle), 0, Math.sin(angle));
  const cBottom = new THREE.Color(bottom).multiplyScalar(shade);
  const cTop = new THREE.Color(top).multiplyScalar(shade);
  const c = new THREE.Color();
  for (let i = 0; i <= segments; i++) {
    const v = i / segments;
    const center = new THREE.Vector3()
      .copy(base)
      .addScaledVector(leanDir, lean * height * Math.pow(v, 1.6))
      .add(new THREE.Vector3(0, height * v * (1 - droop * lean * v), 0));
    const a = angle + Math.PI / 2 + twist * v;
    const wDir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
    const hw = (width / 2) * widthProfile(v);
    const p1 = center.clone().addScaledVector(wDir, hw);
    const p2 = center.clone().addScaledVector(wDir, -hw);
    positions.push(p1.x, p1.y, p1.z, p2.x, p2.y, p2.z);
    c.copy(cBottom).lerp(cTop, Math.pow(v, 0.8));
    colors.push(c.r, c.g, c.b, c.r, c.g, c.b);
  }
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  const flat = geo.toNonIndexed();
  geo.dispose();
  return flat;
}

const plantMaterial = { side: THREE.DoubleSide, roughness: 0.7 };

// ── พืชน้ำ ─────────────────────────────────────────────────────

function buildVallis(item, rnd) {
  const parts = [];
  const count = 11;
  for (let i = 0; i < count; i++) {
    const r = rnd() * 0.25;
    const a = rnd() * Math.PI * 2;
    parts.push(
      blade({
        base: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r),
        height: item.height * lerp(0.55, 1, rnd()),
        width: lerp(0.1, 0.16, rnd()),
        lean: lerp(0.08, 0.35, rnd()),
        angle: rnd() * Math.PI * 2,
        twist: lerp(-1, 1, rnd()),
        segments: 14,
        widthProfile: (v) => 1 - 0.75 * Math.pow(v, 3),
        bottom: '#1f6b2a',
        top: '#7ed35c',
        shade: lerp(0.8, 1.15, rnd()),
      }),
    );
  }
  return [mesh(merge(parts), plantMaterial)];
}

function buildFern(item, rnd) {
  const parts = [];
  const count = 15;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.4;
    parts.push(
      blade({
        base: new THREE.Vector3(Math.cos(a) * 0.05, 0.05, Math.sin(a) * 0.05),
        height: item.height * lerp(0.6, 1, rnd()),
        width: lerp(0.24, 0.34, rnd()),
        lean: lerp(0.5, 0.95, rnd()),
        angle: a,
        twist: lerp(-0.4, 0.4, rnd()),
        segments: 10,
        droop: 0.35,
        widthProfile: (v) => Math.pow(Math.sin(Math.PI * Math.min(v * 1.1, 1)), 0.7),
        bottom: '#1d5a26',
        top: '#4fae47',
        shade: lerp(0.8, 1.15, rnd()),
      }),
    );
  }
  // โคนรากสีน้ำตาล
  parts.push(part(new THREE.SphereGeometry(0.16, 10, 6), '#4b3a28', new THREE.Matrix4().makeScale(1.4, 0.5, 1.2)));
  return [mesh(merge(parts), plantMaterial)];
}

function buildStemPlant(item, rnd) {
  const parts = [];
  const stems = 7;
  const green = new THREE.Color('#3f8f3a');
  const red = new THREE.Color(item.color ?? '#d8434f');
  for (let s = 0; s < stems; s++) {
    const a = rnd() * Math.PI * 2;
    const r = rnd() * 0.28;
    const base = new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
    const h = item.height * lerp(0.55, 1, rnd());
    const tilt = new THREE.Vector3(lerp(-0.18, 0.18, rnd()), 1, lerp(-0.18, 0.18, rnd())).normalize();
    parts.push(part(new THREE.CylinderGeometry(0.018, 0.026, h, 5, 1).translate(0, h / 2, 0), '#4b7d35', alignMatrix(base, tilt)));
    const nodes = Math.floor(h / 0.13);
    for (let k = 1; k <= nodes; k++) {
      const v = k / nodes;
      const p = base.clone().addScaledVector(tilt, v * h);
      const leafColor = green.clone().lerp(red, smoothstep(0.25, 0.85, v));
      for (const side of [0, Math.PI]) {
        const ang = side + k * 1.57 + rnd() * 0.3;
        const len = 0.2 * (1 - v * 0.45);
        const leaf = new THREE.PlaneGeometry(len, len * 0.32);
        leaf.translate(len / 2, 0, 0);
        // วางใบแนวนอน → เชิดปลายขึ้น → หมุนรอบลำต้น → ย้ายไปที่ข้อ
        const m = new THREE.Matrix4()
          .makeTranslation(p.x, p.y, p.z)
          .multiply(new THREE.Matrix4().makeRotationY(-ang))
          .multiply(new THREE.Matrix4().makeRotationZ(0.35))
          .multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2));
        parts.push(part(leaf, leafColor.clone().multiplyScalar(lerp(0.85, 1.1, rnd())), m));
      }
    }
  }
  return [mesh(merge(parts), plantMaterial)];
}

function buildGrass(item, rnd) {
  const parts = [];
  for (let i = 0; i < 46; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * item.radius * 0.8;
    parts.push(
      blade({
        base: new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r),
        height: item.height * lerp(0.45, 1, rnd()),
        width: lerp(0.035, 0.055, rnd()),
        lean: lerp(0.1, 0.5, rnd()),
        angle: rnd() * Math.PI * 2,
        segments: 5,
        widthProfile: (v) => 1 - 0.9 * v,
        bottom: '#2f8a3a',
        top: '#a6e86e',
        shade: lerp(0.85, 1.15, rnd()),
      }),
    );
  }
  return [mesh(merge(parts), plantMaterial)];
}

// ── หิน ─────────────────────────────────────────────────────────

function buildRock(item, rnd) {
  const seed = rnd() * 100;
  let geo = new THREE.IcosahedronGeometry(1, 4);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const pos = geo.attributes.position;
  const sx = lerp(1.1, 1.45, rnd());
  const sz = lerp(0.85, 1.15, rnd());
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    const n1 = fbm3(_v.x * 1.4 + seed, _v.y * 1.4, _v.z * 1.4 - seed, 3);
    const n2 = noise3(_v.x * 4 + seed, _v.y * 4, _v.z * 4);
    _v.multiplyScalar(1 + (n1 - 0.5) * 0.6 + (n2 - 0.5) * 0.12);
    if (_v.y < -0.25) _v.y = -0.25 + (_v.y + 0.25) * 0.25; // ฐานแบน
    _v.set(_v.x * sx, _v.y * 0.85, _v.z * sz);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  geo.computeVertexNormals();
  const base = new THREE.Color(item.color ?? '#8d8f94');
  const g = part(geo, (p, n, out) => {
    const k = fbm3(p.x * 2.2 + seed, p.y * 2.2, p.z * 2.2, 3);
    out.copy(base).multiplyScalar(0.62 + k * 0.6);
    if (n.y > 0.55) out.lerp(new THREE.Color('#5d7d3c'), smoothstep(0.55, 0.95, n.y) * 0.25 * k);
  });
  return [mesh(g, { roughness: 0.92 })];
}

// ── หินแปลก ๆ ─────────────────────────────────────────────────

/**
 * แสงเรืองกระพริบช้า ๆ (คริสตัล ลาวา) — คูณความสว่างของ emissive ตามเวลา
 * ทำให้ของเรืองแสงดูมีชีวิตโดยไม่ต้องอัปเดตอะไรบน CPU
 */
function glowPulseMod(speed, depth) {
  return {
    key: `glow-pulse-${speed}-${depth}`,
    apply(shader) {
      shader.uniforms.uPulseTime = sharedUniforms.uTime;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uPulseTime;').replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        totalEmissiveRadiance *= ${(1 - depth).toFixed(3)} + ${depth.toFixed(3)} * (0.5 + 0.5 * sin(uPulseTime * ${speed.toFixed(3)} + vViewPosition.y * 1.7));`,
      );
    },
  };
}

/** ชิ้นที่เรืองแสงเอง: เก็บค่าเรืองแสงเดิมไว้ให้ไฮไลต์ตอนเลือกคืนค่าได้ และกระพริบช้า ๆ */
function glowMesh(geo, params, pulse) {
  const m = mesh(geo, params);
  m.material.userData.baseEmissive = m.material.emissive.clone();
  applyShaderMods(m.material, [pulse]);
  return m;
}

/** ก้อนหินขรุขระเล็ก ๆ (ใช้ประกอบชิ้นอื่น) */
function noisyBlob(radius, scale, center, seed, colorFn, detail = 3) {
  let geo = new THREE.IcosahedronGeometry(radius, detail);
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  geo = mergeVertices(geo);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    _v.multiplyScalar(1 + (fbm3(_v.x * 2 + seed, _v.y * 2, _v.z * 2 - seed, 3) - 0.5) * 0.7);
    pos.setXYZ(i, _v.x * scale.x + center.x, Math.max(_v.y * scale.y + center.y, -0.05), _v.z * scale.z + center.z);
  }
  geo.computeVertexNormals();
  return part(geo, colorFn);
}

/** ซุ้มหินโค้งธรรมชาติ ลายหินทรายเป็นชั้น ๆ — ปลาว่ายลอดใต้ซุ้มได้ */
function buildRockArch(item, rnd) {
  const seed = rnd() * 40;
  const bands = ['#b0714a', '#c98d5f', '#9c5f3c', '#d6a072', '#b98058'].map((c) => new THREE.Color(c));
  const moss = new THREE.Color('#6d8a3e');
  const strata = (p, n, out) => {
    // ชั้นหินหนาไม่เท่ากันและเอียงเป็นคลื่น ไล่สีนุ่ม ๆ ระหว่างชั้น
    const w = p.y * 4.2 + p.x * 0.6 + (fbm3(p.x * 1.2 + seed, p.y * 0.6, p.z * 1.2, 2) - 0.5) * 2.6;
    const i = ((Math.floor(w) % 5) + 5) % 5;
    out.copy(bands[i]).lerp(bands[(i + 1) % 5], smoothstep(0.55, 1, w - Math.floor(w)));
    out.multiplyScalar(0.62 + fbm3(p.x * 5 + seed, p.y * 5, p.z * 5, 3) * 0.6);
    if (n.y > 0.6) out.lerp(moss, smoothstep(0.6, 0.95, n.y) * 0.3);
  };
  const R = 0.95;
  const H = 1.35;
  const points = [];
  for (let i = 0; i <= 12; i++) {
    const t = lerp(-0.08, Math.PI + 0.08, i / 12);
    points.push(new THREE.Vector3(Math.cos(t) * R, Math.max(Math.sin(t) * H, -0.12), (noise3(i * 0.7 + seed, 0, 0) - 0.5) * 0.25));
  }
  // ขาซุ้มหนา ช่วงบนบางลง ผิวขรุขระ
  const rough = (u, off) => 1 + (fbm3(off.x * 3 + seed, off.y * 3 + u * 9, off.z * 3, 3) - 0.5) * 0.8 + (noise3(off.x * 11, off.y * 11 + u * 30, off.z * 11) - 0.5) * 0.18;
  const arch = tubeWithRadius(points, 0.32, (u, off) => (1.05 - 0.4 * Math.sin(u * Math.PI)) * rough(u, off), 72, 18);
  const parts = [
    part(arch, strata),
    noisyBlob(0.42, new THREE.Vector3(1.1, 0.75, 1), new THREE.Vector3(-R - 0.05, 0.12, 0.05), seed + 1, strata),
    noisyBlob(0.38, new THREE.Vector3(1, 0.7, 1.1), new THREE.Vector3(R + 0.05, 0.1, -0.05), seed + 2, strata),
    noisyBlob(0.18, new THREE.Vector3(1, 0.7, 1), new THREE.Vector3(0.35, 0.03, 0.4), seed + 3, strata, 2),
  ];
  return [mesh(merge(parts), { roughness: 0.95 })];
}

/** หินคริสตัลอเมทิสต์: ก้อนหินสีเข้มมีแท่งคริสตัลหกเหลี่ยมสีม่วงงอกออกมา เรืองแสงระยิบ */
function buildCrystalRock(item, rnd) {
  const seed = rnd() * 40;
  const rockColor = new THREE.Color('#4a4452');
  const rockFn = (p, _n, out) => out.copy(rockColor).multiplyScalar(0.6 + fbm3(p.x * 3 + seed, p.y * 3, p.z * 3, 3) * 0.7);
  const rock = noisyBlob(0.62, new THREE.Vector3(1.25, 0.6, 1.05), new THREE.Vector3(0, 0.1, 0), seed, rockFn);

  const deep = new THREE.Color('#5a1aa8');
  const tip = new THREE.Color('#e9c8ff');
  const crystals = [];
  const d = new THREE.Vector3();
  const crystal = (base, dir, len, r) => {
    const body = len * 0.78;
    // ไล่สีจากโคน (ม่วงเข้ม) ไปปลาย (ม่วงอ่อนเกือบขาว)
    const crystalFn = (p, _n, out) => out.copy(deep).lerp(tip, Math.pow(smoothstep(0, len, d.copy(p).sub(base).dot(dir)), 1.3));
    const m = alignMatrix(base, dir);
    crystals.push(
      part(new THREE.CylinderGeometry(r, r * 1.08, body, 6, 1).translate(0, body / 2, 0), crystalFn, m),
      part(new THREE.ConeGeometry(r, len - body, 6, 1).translate(0, body + (len - body) / 2, 0), crystalFn, m),
    );
  };
  // กระจุกใหญ่ตรงกลาง + แท่งเล็กรอบ ๆ ชี้ออกไปคนละทิศ
  for (let i = 0; i < 13; i++) {
    const a = rnd() * Math.PI * 2;
    const outer = i >= 5;
    const r = outer ? lerp(0.25, 0.55, rnd()) : rnd() * 0.18;
    const base = new THREE.Vector3(Math.cos(a) * r, outer ? 0.22 : 0.3, Math.sin(a) * r);
    const spread = outer ? lerp(0.6, 1.1, rnd()) : lerp(0.05, 0.35, rnd());
    const dir = new THREE.Vector3(Math.cos(a) * spread, 1, Math.sin(a) * spread).normalize();
    crystal(base, dir, outer ? lerp(0.3, 0.6, rnd()) : lerp(0.75, 1.15, rnd()), outer ? lerp(0.05, 0.08, rnd()) : lerp(0.09, 0.13, rnd()));
  }
  const glass = { roughness: 0.12, metalness: 0.05, flatShading: true, emissive: new THREE.Color('#7a2cff'), emissiveIntensity: 0.55 };
  return [mesh(rock, { roughness: 0.9 }), glowMesh(merge(crystals), glass, glowPulseMod(1.3, 0.45))];
}

/** หินภูเขาไฟลาวา: ภูเขาไฟจิ๋วสีดำ ปล่องมีลาวาเรืองแสง และธารลาวาไหลลงตามไหล่เขา (พ่นฟองเป็นระยะ ดู item.bubbles) */
function buildVolcanoRock(item, rnd) {
  const seed = rnd() * 40;
  // โปรไฟล์ [รัศมี, ความสูง] จากฐานขึ้นไปถึงปากปล่อง แล้วลงไปก้นปล่อง
  const profile = [[1.0, -0.05], [0.98, 0.12], [0.82, 0.38], [0.62, 0.68], [0.45, 0.95], [0.36, 1.06], [0.3, 1.04], [0.24, 0.92], [0.0, 0.9]];
  const radiusAt = (y) => {
    for (let i = 0; i < 5; i++) {
      const [r0, y0] = profile[i];
      const [r1, y1] = profile[i + 1];
      if (y <= y1) return lerp(r0, r1, (y - y0) / (y1 - y0));
    }
    return profile[5][0];
  };
  const bump = (a, y) => 1 + (fbm3(Math.cos(a) * 1.6 + seed, y * 2.4, Math.sin(a) * 1.6, 3) - 0.5) * 0.38;
  const lathe = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 56);
  const pos = lathe.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    _v.fromBufferAttribute(pos, i);
    const k = bump(Math.atan2(_v.x, _v.z), _v.y);
    pos.setXYZ(i, _v.x * k, _v.y, _v.z * k);
  }
  lathe.computeVertexNormals();
  const basalt = new THREE.Color('#2b2523');
  const ember = new THREE.Color('#5a2a1a');
  const rock = part(lathe, (p, _n, out) => {
    out.copy(basalt).multiplyScalar(0.55 + fbm3(p.x * 4 + seed, p.y * 4, p.z * 4, 3) * 0.8);
    out.lerp(ember, smoothstep(0.7, 1.05, p.y) * 0.6); // ขอบปล่องไหม้เป็นสีแดงคล้ำ
  });

  // ลาวาในปล่อง + ธารลาวาไหลลงตามไหล่เขา (แนบผิวพอดี เพราะใช้สูตรผิวขรุขระ bump เดียวกัน)
  const hot = new THREE.Color('#ffd25a');
  const warm = new THREE.Color('#ff4a12');
  const lava = [part(new THREE.CircleGeometry(0.25, 20).rotateX(-Math.PI / 2).translate(0, 0.93, 0), hot)];
  for (let f = 0; f < 4; f++) {
    let a = (f / 4) * Math.PI * 2 + rnd() * 0.8;
    const pts = [];
    const end = lerp(0.05, 0.45, rnd());
    for (let y = 1.0; y >= end; y -= 0.08) {
      a += (noise3(f * 3.1 + seed, y * 3, 0) - 0.5) * 0.35;
      const r = radiusAt(y) * bump(a, y) * 1.012;
      pts.push(new THREE.Vector3(Math.sin(a) * r, y, Math.cos(a) * r));
    }
    if (pts.length < 3) continue;
    lava.push(part(tubeWithRadius(pts, 0.045, (u) => 1 - 0.7 * u, 24, 6), (p, _n, out) => out.copy(hot).lerp(warm, smoothstep(0.9, 0.2, p.y))));
  }
  const glow = { roughness: 0.5, emissive: new THREE.Color('#ff5a14'), emissiveIntensity: 1.6 };
  return [mesh(rock, { roughness: 0.97 }), glowMesh(merge(lava), glow, glowPulseMod(2.1, 0.35))];
}

// ── ขอนไม้ ─────────────────────────────────────────────────────

function tubeWithRadius(points, radius, radiusFn, tubular = 48, radial = 10) {
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, tubular, radius, radial, false);
  const pos = geo.attributes.position;
  const center = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    const ring = Math.floor(i / (radial + 1));
    const u = ring / tubular;
    curve.getPointAt(u, center);
    _v.fromBufferAttribute(pos, i).sub(center);
    _v.multiplyScalar(radiusFn(u, _v));
    _v.add(center);
    pos.setXYZ(i, _v.x, _v.y, _v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

function buildDriftwood(item, rnd) {
  const seed = rnd() * 50;
  const wood = new THREE.Color('#7a5634');
  const moss = new THREE.Color('#5f8f36');
  const colorFn = (p, n, out) => {
    const streak = noise3(p.x * 3 + seed, p.y * 9, p.z * 3);
    out.copy(wood).multiplyScalar(0.6 + streak * 0.6);
    const mossy = fbm3(p.x * 1.8 + seed, p.y * 1.8, p.z * 1.8, 2);
    if (n.y > 0.35) out.lerp(moss, smoothstep(0.35, 0.9, n.y) * smoothstep(0.45, 0.65, mossy));
  };
  const gnarl = (u, offset) => 1 + (noise3(offset.x * 5 + seed, offset.y * 5 + u * 8, offset.z * 5) - 0.5) * 0.45;
  const main = tubeWithRadius(
    [
      new THREE.Vector3(-1.7, -0.15, 0.05),
      new THREE.Vector3(-1.25, 0.75, 0.15),
      new THREE.Vector3(-0.35, 1.3, -0.05),
      new THREE.Vector3(0.55, 1.2, 0.1),
      new THREE.Vector3(1.3, 0.6, -0.1),
      new THREE.Vector3(1.75, -0.15, 0.05),
    ],
    0.24,
    (u, off) => (1.35 - Math.sin(u * Math.PI) * 0.55) * gnarl(u, off),
    64,
    12,
  );
  const branch1 = tubeWithRadius(
    [new THREE.Vector3(-0.4, 1.25, 0), new THREE.Vector3(-0.15, 1.6, 0.2), new THREE.Vector3(0.05, 1.85, 0.25)],
    0.09,
    (u, off) => (1 - u * 0.7) * gnarl(u, off),
    12,
    8,
  );
  const branch2 = tubeWithRadius(
    [new THREE.Vector3(1.1, 0.8, 0), new THREE.Vector3(1.45, 1.1, -0.25), new THREE.Vector3(1.6, 1.3, -0.35)],
    0.07,
    (u, off) => (1 - u * 0.7) * gnarl(u, off),
    10,
    8,
  );
  const geo = merge([part(main, colorFn), part(branch1, colorFn), part(branch2, colorFn)]);
  return [mesh(geo, { roughness: 0.95 })];
}

// ── ปราสาท ─────────────────────────────────────────────────────

function buildCastle(item, rnd) {
  const seed = rnd() * 30;
  const stone = new THREE.Color(item.color ?? '#b9a58a');
  const moss = new THREE.Color('#5e7f3a');
  const dark = '#2a2320';
  const stoneFn = (p, n, out) => {
    const blocks = noise3(Math.floor(p.x * 6) + seed, Math.floor(p.y * 7), Math.floor(p.z * 6));
    out.copy(stone).multiplyScalar(0.72 + blocks * 0.4);
    const mossy = fbm3(p.x * 2 + seed, p.y * 2, p.z * 2, 2);
    out.lerp(moss, (1 - smoothstep(0.1, 0.9, p.y)) * smoothstep(0.4, 0.7, mossy) * 0.8);
  };
  const parts = [];
  const box = (w, h, d, x, y, z, color = stoneFn) => parts.push(part(new THREE.BoxGeometry(w, h, d), color, new THREE.Matrix4().makeTranslation(x, y, z)));
  const cyl = (rt, rb, h, x, y, z, seg = 14, color = stoneFn) => parts.push(part(new THREE.CylinderGeometry(rt, rb, h, seg), color, new THREE.Matrix4().makeTranslation(x, y, z)));

  const baseH = 0.22;
  box(2.1, baseH, 1.6, 0, baseH / 2, 0);
  // ตัวปราสาทกลาง
  const keepH = 1.35;
  box(1.15, keepH, 0.9, 0, baseH + keepH / 2, -0.12);
  for (let i = 0; i < 5; i++) {
    const x = -0.5 + i * 0.25;
    box(0.13, 0.17, 0.13, x, baseH + keepH + 0.085, 0.27);
    box(0.13, 0.17, 0.13, x, baseH + keepH + 0.085, -0.51);
  }
  // หอคอย
  const towers = [
    [-0.78, 0.3, 0.28, 1.65],
    [0.78, 0.26, 0.28, 1.85],
    [0.12, -0.42, 0.33, 2.35],
  ];
  for (const [x, z, r, h] of towers) {
    cyl(r, r * 1.06, h, x, baseH + h / 2, z);
    cyl(r * 1.15, r * 1.15, 0.12, x, baseH + h + 0.06, z);
    const teeth = 8;
    for (let k = 0; k < teeth; k++) {
      const a = (k / teeth) * Math.PI * 2;
      box(0.11, 0.15, 0.11, x + Math.cos(a) * r * 1.02, baseH + h + 0.19, z + Math.sin(a) * r * 1.02);
    }
    // หน้าต่าง
    box(0.08, 0.17, 0.04, x, baseH + h * 0.72, z + r * 0.98, dark);
  }
  // ประตูโค้ง
  box(0.34, 0.42, 0.05, 0, baseH + 0.21, 0.34, dark);
  // ครึ่งวงกลมด้านบนประตู: แกนทรงกระบอก Y→Z แล้วหมุนให้ส่วนโค้งชี้ขึ้น
  const arch = new THREE.Matrix4()
    .makeTranslation(0, baseH + 0.42, 0.34)
    .multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
  parts.push(part(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 14, 1, false, 0, Math.PI), dark, arch));
  box(0.1, 0.16, 0.04, -0.3, baseH + 0.95, 0.34, dark);
  box(0.1, 0.16, 0.04, 0.3, baseH + 0.95, 0.34, dark);

  return [mesh(merge(parts), { roughness: 0.9 })];
}

// ── หีบสมบัติ ──────────────────────────────────────────────────

function buildChest(item, rnd) {
  const woodBase = new THREE.Color('#8a5a2b');
  const woodFn = (p, _n, out) => out.copy(woodBase).multiplyScalar(0.7 + noise3(p.x * 2, p.y * 14, p.z * 2) * 0.5);
  const W = 0.95;
  const H = 0.42;
  const D = 0.62;
  const lidAngle = -0.55;
  const hinge = new THREE.Matrix4().makeTranslation(0, H, -D / 2).multiply(new THREE.Matrix4().makeRotationX(lidAngle));

  const wood = [];
  wood.push(part(new THREE.BoxGeometry(W, H, D), woodFn, new THREE.Matrix4().makeTranslation(0, H / 2, 0)));
  // ฝาโค้ง: ครึ่งทรงกระบอกแกน X โดมชี้ขึ้น จุดหมุนอยู่ขอบหลังด้านบน
  const lid = new THREE.CylinderGeometry(D / 2, D / 2, W, 18, 1, false, 0, Math.PI);
  lid.rotateZ(Math.PI / 2);
  lid.translate(0, 0, D / 2);
  wood.push(part(lid, woodFn, hinge));

  const gold = [];
  const goldColor = '#e0ac2a';
  for (const x of [-W * 0.32, W * 0.32]) {
    gold.push(part(new THREE.BoxGeometry(0.07, H + 0.02, D + 0.02), goldColor, new THREE.Matrix4().makeTranslation(x, H / 2, 0)));
  }
  gold.push(part(new THREE.BoxGeometry(0.14, 0.16, 0.04), goldColor, new THREE.Matrix4().makeTranslation(0, H * 0.72, D / 2 + 0.01)));
  // เหรียญทองล้นหีบ
  for (let i = 0; i < 16; i++) {
    const coin = new THREE.CylinderGeometry(0.06, 0.06, 0.015, 10);
    const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rnd() * 0.8, rnd() * 3, rnd() * 0.8));
    m.setPosition(lerp(-W * 0.4, W * 0.4, rnd()), H + 0.02 + rnd() * 0.08, lerp(-D * 0.35, D * 0.35, rnd()));
    gold.push(part(coin, rnd() < 0.5 ? '#ffd23f' : '#f2b72c', m));
  }
  return [mesh(merge(wood), { roughness: 0.85 }), mesh(merge(gold), { roughness: 0.3, metalness: 0.85 })];
}

// ── ปะการัง ────────────────────────────────────────────────────

function buildCoral(item, rnd) {
  const parts = [];
  const deep = new THREE.Color(item.color ?? '#ff6f91').multiplyScalar(0.75);
  const tip = new THREE.Color('#ffd0dc');
  const colorFn = (p, _n, out) => out.copy(deep).lerp(tip, smoothstep(0.2, item.height, p.y));
  const grow = (start, dir, length, radius, depth) => {
    const geo = new THREE.CylinderGeometry(radius * 0.72, radius, length, 8, 1).translate(0, length / 2, 0);
    parts.push(part(geo, colorFn, alignMatrix(start, dir)));
    const end = start.clone().addScaledVector(dir, length);
    parts.push(part(new THREE.SphereGeometry(radius * 0.74, 8, 6), colorFn, new THREE.Matrix4().makeTranslation(end.x, end.y, end.z)));
    if (depth <= 0) return;
    const kids = 2 + (rnd() < 0.5 ? 1 : 0);
    for (let i = 0; i < kids; i++) {
      const a = rnd() * Math.PI * 2;
      const spread = lerp(0.35, 0.75, rnd());
      const nd = dir.clone().add(new THREE.Vector3(Math.cos(a) * spread, 0.25, Math.sin(a) * spread)).normalize();
      grow(end, nd, length * lerp(0.62, 0.82, rnd()), radius * 0.72, depth - 1);
    }
  };
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + rnd();
    grow(new THREE.Vector3(Math.cos(a) * 0.15, -0.05, Math.sin(a) * 0.15), new THREE.Vector3(Math.cos(a) * 0.3, 1, Math.sin(a) * 0.3).normalize(), item.height * 0.38, 0.09, 3);
  }
  return [mesh(merge(parts), { roughness: 0.65 })];
}

// ── หัวทรายออกซิเจน ───────────────────────────────────────────

function buildBubbler(item) {
  const parts = [
    part(new THREE.CylinderGeometry(0.2, 0.24, 0.16, 18), '#9fb3c8', new THREE.Matrix4().makeTranslation(0, 0.08, 0)),
    part(new THREE.TorusGeometry(0.21, 0.025, 6, 18), '#5d6f82', new THREE.Matrix4().makeTranslation(0, 0.16, 0).multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2))),
    part(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 6), '#cfe3ef', new THREE.Matrix4().makeTranslation(0.22, 0.25, -0.05).multiply(new THREE.Matrix4().makeRotationZ(-0.9))),
  ];
  return [mesh(merge(parts), { roughness: 0.8 })];
}

// ── หอย (ระบบนิเวศ) ──────────────────────────────────────────
// หันหัวไป +Z ฐาน (เท้า) ที่ y = 0 — ขนาดจริงถูกปรับตาม item.height ภายหลัง

/** หอยฝาเดียว: เท้า + หนวด 2 เส้น + เปลือกตาม look.shell */
function buildSnail(item) {
  const look = item.look ?? {};
  const body = new THREE.Color(look.body ?? '#8a7a66');
  const shellColor = new THREE.Color(item.color ?? '#d9b43a');
  const parts = [];
  // เท้า: แคปซูลแบนยาวตามแกน z
  const foot = new THREE.CapsuleGeometry(0.2, 0.75, 4, 10).rotateX(Math.PI / 2).scale(1, 0.42, 1).translate(0, 0.085, 0.05);
  parts.push(part(foot, (p, _n, out) => out.copy(body).multiplyScalar(0.85 + 0.25 * smoothstep(0, 0.17, p.y))));
  for (const side of [-1, 1]) {
    const tentacle = new THREE.CylinderGeometry(0.018, 0.032, 0.32, 6).translate(0, 0.16, 0);
    parts.push(part(tentacle, body, alignMatrix(new THREE.Vector3(side * 0.08, 0.12, 0.52), new THREE.Vector3(side * 0.45, 0.6, 1))));
  }
  const shell = look.shell ?? 'nerite';
  if (shell === 'ramshorn') {
    // เปลือกขดแบนแนวตั้ง (วงใหญ่ + วงใน)
    const ring = (p, _n, out) => out.copy(shellColor).multiplyScalar(0.75 + 0.3 * Math.abs(Math.sin(Math.atan2(p.y - 0.42, p.z + 0.08) * 6)));
    parts.push(part(new THREE.TorusGeometry(0.24, 0.14, 10, 20).rotateY(Math.PI / 2).translate(0, 0.42, -0.08), ring));
    parts.push(part(new THREE.TorusGeometry(0.1, 0.08, 8, 14).rotateY(Math.PI / 2).translate(0.03, 0.42, -0.08), ring));
  } else if (shell === 'mystery') {
    // เปลือกกลมโต + ยอดเกลียวเล็ก แถบสีจาง ๆ ตามแนวเกลียว
    const band = (p, _n, out) => out.copy(shellColor).multiplyScalar(0.85 + 0.2 * Math.sin(p.y * 22 + p.x * 6));
    parts.push(part(new THREE.SphereGeometry(0.42, 18, 14).scale(0.95, 0.95, 1.05).translate(0, 0.44, -0.08), band));
    parts.push(part(new THREE.SphereGeometry(0.2, 12, 10).translate(0.1, 0.78, -0.22), band));
    parts.push(part(new THREE.SphereGeometry(0.09, 8, 6).translate(0.15, 0.95, -0.28), band));
  } else {
    // เนอไรต์: เปลือกครึ่งทรงกลม ลายม้าลายดำ-เหลือง
    const zebra = (p, _n, out) => out.copy(Math.sin(Math.atan2(p.y - 0.18, p.z + 0.05) * 9 + p.x * 4) > 0.25 ? '#1e1a14' : shellColor);
    parts.push(part(new THREE.SphereGeometry(0.36, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.6).scale(1, 0.85, 1.1).translate(0, 0.16, -0.05), zebra));
  }
  return [mesh(merge(parts), { roughness: 0.55 })];
}

/** หอยสองฝา: ฝาล่างฝังทราย + ฝาบน (ชื่อ shell_top — เกมหมุนอ้า-หุบที่บานพับด้านหลัง) มีเส้นวงปีบนเปลือก */
function buildClam(item) {
  const base = new THREE.Color(item.color ?? '#6f6a4a');
  const rings = (p, _n, out) => out.copy(base).multiplyScalar(0.75 + 0.35 * Math.abs(Math.sin(Math.hypot(p.x * 0.8, p.z) * 26)));
  const half = (top) => new THREE.SphereGeometry(0.5, 22, 10, 0, Math.PI * 2, top ? 0 : Math.PI / 2, Math.PI / 2).scale(1.25, top ? 0.42 : 0.36, 0.9).translate(0, 0.19, 0);
  const lower = mesh(merge([part(half(false), rings)]), { roughness: 0.6 });
  const upper = mesh(merge([part(half(true), rings)]), { roughness: 0.6 });
  upper.name = 'shell_top';
  // เนื้อหอยด้านใน (เห็นตอนอ้าฝา)
  const inner = mesh(merge([part(new THREE.SphereGeometry(0.42, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1.2, 0.12, 0.85).translate(0, 0.18, 0), '#f0d9c4')]), { roughness: 0.4 });
  return [lower, inner, upper];
}

const BUILDERS = {
  snail: buildSnail,
  clam: buildClam,
  vallis: buildVallis,
  fern: buildFern,
  stem: buildStemPlant,
  grass: buildGrass,
  rock: buildRock,
  rock_arch: buildRockArch,
  crystal: buildCrystalRock,
  volcano: buildVolcanoRock,
  driftwood: buildDriftwood,
  castle: buildCastle,
  chest: buildChest,
  coral: buildCoral,
  bubbler: buildBubbler,
};

/**
 * สร้างโมเดลชั่วคราวของของตกแต่ง
 * @param {object} item ข้อมูลจาก data/decor.js
 * @param {number} seed 0..1 ทำให้แต่ละชิ้นหน้าตาไม่ซ้ำกัน
 */
export function buildDecorPlaceholder(item, seed = 0.5) {
  const builder = BUILDERS[item.placeholder] ?? buildRock;
  const rnd = seededRandom(seed + 0.0001);
  const group = new THREE.Group();
  for (const m of builder(item, rnd)) group.add(m);
  return group;
}
