import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { lerp, seededRandom, smoothstep } from '../utils/math.js';
import { fbm3, noise3 } from '../utils/noise.js';

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

const BUILDERS = {
  vallis: buildVallis,
  fern: buildFern,
  stem: buildStemPlant,
  grass: buildGrass,
  rock: buildRock,
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
