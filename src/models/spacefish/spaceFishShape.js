import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { hermiteCurve, lerp } from '../../utils/math.js';

/**
 * รูปทรง 3 มิติของปลาอวกาศ (Space Fish) — ทรงปลาทองแฟนซี ลำตัวกลมลึก ตาโต หางคู่ยาวพลิ้วแบบผ้าคลุม ครีบยาวทุกครีบ
 *
 * ระบบพิกัดเหมือนปลาตัวอื่นในเกม: หันหัวไป +Z, ลำตัวยาว 1 หน่วย (ปลายจมูก z=+0.5 → โคนหาง z=-0.5)
 * หางยาวต่อไปถึงประมาณ z=-1.6  แกน +Y คือด้านหลังปลา
 *
 * ทุกจุดมี attribute aSF = (ชนิดชิ้นส่วน, น้ำหนักการขยับ 0 โคน → 1 ปลาย, ตำแหน่งขวางครีบ 0..1)
 * ให้ shader ขยับครีบแต่ละชิ้นและวาดแสงวิ่งตามก้านครีบ (ดู spaceFishShaders.js)
 * ลวดลายทั้งหมดคำนวณใน shader จากตำแหน่งบนตัว จึงไม่ต้องมี UV/texture ของลำตัว
 */

/** รหัสชิ้นส่วนใน aSF.x (ต้องตรงกับ spaceFishShaders.js) */
export const PART = { body: 0, tail: 1, dorsal: 2, pectoralL: 3, pectoralR: 4, pelvicL: 5, pelvicR: 6, anal: 7, eye: 8 };

export const SPACEFISH_DETAIL = {
  high: { rings: 64, radial: 44, fin: 1, eye: [24, 16] },
  medium: { rings: 48, radial: 32, fin: 0.75, eye: [18, 12] },
  low: { rings: 32, radial: 22, fin: 0.5, eye: [12, 8] },
};

// ── โปรไฟล์ลำตัว ───────────────────────────────────────────────

// หลังโค้งสูงแบบปลาทอง (ไม่มีหนอก) ท้องกลมป่อง คอดเร็วที่โคนหาง
const TOP = hermiteCurve([[0, 0.06], [0.07, 0.125], [0.18, 0.21], [0.32, 0.268], [0.46, 0.278], [0.6, 0.252], [0.74, 0.205], [0.86, 0.148], [0.95, 0.118], [1, 0.11]]);
const BOTTOM = hermiteCurve([[0, -0.035], [0.07, -0.115], [0.18, -0.218], [0.32, -0.285], [0.46, -0.295], [0.6, -0.258], [0.74, -0.195], [0.86, -0.135], [0.95, -0.108], [1, -0.1]]);
const WIDTH = hermiteCurve([[0, 0.07], [0.07, 0.125], [0.18, 0.185], [0.32, 0.215], [0.46, 0.21], [0.6, 0.18], [0.74, 0.13], [0.86, 0.085], [0.95, 0.058], [1, 0.048]]);

const NOSE = 0.11;
const TAIL_CAP = 0.06;
const T_END = 1 + TAIL_CAP;
const E_UP = 2 / 2.2;
const E_LOW = 2 / 2.45;

const _sec = { c: 0, up: 0, w: 0 };

export function section(t, out = _sec) {
  const tc = Math.min(Math.max(t, 0), 1);
  const top = TOP(tc);
  const bot = BOTTOM(tc);
  let kh = 1;
  let kw = 1;
  if (t < NOSE) kh = kw = Math.pow(Math.max(0, 1 - (1 - t / NOSE) ** 2), 0.55);
  else if (t > 1) {
    const x = Math.min((t - 1) / TAIL_CAP, 1);
    kh = 1 - 0.25 * x * x;
    kw = Math.sqrt(Math.max(0, 1 - x * x));
  }
  out.c = (top + bot) / 2;
  out.up = ((top - bot) / 2) * kh;
  out.w = WIDTH(tc) * kw;
  return out;
}

const backY = (t) => TOP(t);
const bellyY = (t) => BOTTOM(t);

/** จุดบนผิวลำตัวที่ (t, θ)  θ: 0 สันหลัง → π ท้อง */
export function surfacePoint(t, theta, out = new THREE.Vector3()) {
  const S = section(t);
  const s = Math.sin(theta);
  const co = Math.cos(theta);
  const e = co < 0 ? E_LOW : E_UP;
  out.set(Math.sign(s) * Math.pow(Math.abs(s), e) * S.w, S.c + Math.sign(co) * Math.pow(Math.abs(co), e) * S.up, 0.5 - t);
  return out;
}

export function surfaceNormal(t, theta, out = new THREE.Vector3()) {
  const e = 1e-3;
  const p = surfacePoint(t, theta, new THREE.Vector3());
  const dt = surfacePoint(t + e, theta, new THREE.Vector3()).sub(p);
  const dq = surfacePoint(t, theta + e, new THREE.Vector3()).sub(p);
  return out.crossVectors(dq, dt).normalize();
}

// ── เครื่องมือสร้าง geometry ──────────────────────────────────────

function sfAttribute(count, id) {
  const arr = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) arr[i * 3] = id;
  return new THREE.BufferAttribute(arr, 3);
}

/** เหลือเฉพาะ attribute ที่ใช้ (position, normal, uv, aSF) ให้รวม geometry กันได้ */
function normalizeAttributes(geo, id = PART.body) {
  for (const name of Object.keys(geo.attributes)) {
    if (!['position', 'normal', 'uv', 'aSF'].includes(name)) geo.deleteAttribute(name);
  }
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  if (!geo.attributes.aSF) geo.setAttribute('aSF', sfAttribute(geo.attributes.position.count, id));
  return geo;
}

/** แผ่นครีบแบบตาราง a×b  a = ตามก้านครีบ (0 โคน → 1 ปลาย)  b = ขวางก้านครีบ (0 → 1) */
function finGrid(na, nb, id, posFn) {
  na = Math.max(3, Math.round(na));
  nb = Math.max(3, Math.round(nb));
  const positions = [];
  const sf = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= na; i++) {
    for (let j = 0; j <= nb; j++) {
      const a = i / na;
      const b = j / nb;
      posFn(a, b, p);
      positions.push(p.x, p.y, p.z);
      sf.push(id, a, b);
    }
  }
  const indices = [];
  for (let i = 0; i < na; i++) {
    for (let j = 0; j < nb; j++) {
      const a = i * (nb + 1) + j;
      const b = a + nb + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aSF', new THREE.Float32BufferAttribute(sf, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return normalizeAttributes(geo);
}

// ── ลำตัว ───────────────────────────────────────────────────────

function buildBody(D) {
  const N = D.rings;
  const M = D.radial;
  const positions = [];
  const sf = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = T_END * (0.5 - 0.5 * Math.cos((Math.PI * i) / N));
    for (let j = 0; j <= M; j++) {
      surfacePoint(t, (j / M) * Math.PI * 2, p);
      positions.push(p.x, p.y, p.z);
      sf.push(PART.body, 0, j / M);
    }
  }
  const indices = [];
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * (M + 1) + j;
      const b = a + M + 1;
      indices.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aSF', new THREE.Float32BufferAttribute(sf, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // ปลายจมูก (จุดยอดซ้อนกัน) และรอยต่อ θ=0/2π ให้ normal เรียบ
  const nrm = geo.attributes.normal;
  for (let j = 0; j <= M; j++) nrm.setXYZ(j, 0, 0.2, 0.98);
  const n = new THREE.Vector3();
  for (let i = 1; i <= N; i++) {
    const a = i * (M + 1);
    const b = a + M;
    n.set(nrm.getX(a) + nrm.getX(b), nrm.getY(a) + nrm.getY(b), nrm.getZ(a) + nrm.getZ(b)).normalize();
    nrm.setXYZ(a, n.x, n.y, n.z);
    nrm.setXYZ(b, n.x, n.y, n.z);
  }
  return normalizeAttributes(geo);
}

/** ปากจู๋อวบ ๆ แบบปลาทอง */
function buildLips() {
  const S = section(0);
  const lips = new THREE.TorusGeometry(0.03, 0.014, 8, 20);
  lips.scale(1, 0.75, 0.8);
  lips.rotateX(-0.25);
  lips.translate(0, S.c - 0.004, 0.495);
  return normalizeAttributes(lips);
}

// ── ตา ──────────────────────────────────────────────────────────

const EYE = { t: 0.15, cosTheta: 0.3, radius: 0.08, sink: 0.3 };

/** ลูกตาโปน 2 ข้าง: UV ฉายจากด้านหน้าของตา (กลาง = รูม่านตา) */
function buildEyes(D) {
  const theta = Math.acos(EYE.cosTheta);
  const surf = surfacePoint(EYE.t, theta, new THREE.Vector3());
  const normal = surfaceNormal(EYE.t, theta);
  const geos = [];
  for (const side of [1, -1]) {
    const center = surf.clone().addScaledVector(normal, -EYE.radius * EYE.sink);
    center.x *= side;
    const axis = new THREE.Vector3(normal.x * side, normal.y * 0.5, normal.z + 0.3).normalize();
    const b1 = new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
    const b2 = new THREE.Vector3().crossVectors(axis, b1);
    const geo = new THREE.SphereGeometry(EYE.radius, D.eye[0], D.eye[1]);
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const d = new THREE.Vector3();
    const world = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      d.fromBufferAttribute(nrm, i);
      world.set(0, 0, 0).addScaledVector(axis, d.y).addScaledVector(b1, d.z).addScaledVector(b2, d.x);
      pos.setXYZ(i, center.x + world.x * EYE.radius, center.y + world.y * EYE.radius, center.z + world.z * EYE.radius);
      nrm.setXYZ(i, world.x, world.y, world.z);
      uv.setXY(i, 0.5 + world.dot(b2) * 0.5 * side, 0.5 + world.dot(b1) * 0.5);
    }
    geos.push(normalizeAttributes(geo, PART.eye));
  }
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  return merged;
}

// ── ครีบ ────────────────────────────────────────────────────────

/** หางคู่แบบผ้าคลุม: 2 แฉกกางออกเป็นรูปตัว V เมื่อมองจากด้านบน แฉกบน-ล่างยาวกว่าตรงกลาง ขอบปลายเป็นคลื่น */
function tailLobe(q, side) {
  const S = section(0.98, {});
  const z0 = 0.5 - 0.98;
  return finGrid(20 * q, 16 * q, PART.tail, (a, b, p) => {
    const s = b * 2 - 1;
    const spread = S.up * 0.95 + (0.44 - S.up) * Math.pow(a, 0.55);
    const len = 1.08 * (0.7 + 0.34 * s * s) * (1 + 0.06 * Math.sin(s * 7 + side * 1.3));
    const splay = 0.012 + 0.34 * a * (0.45 + 0.55 * (1 - s * s));
    // ปลายหางห้อยลงเล็กน้อยและเป็นลอนเหมือนผ้าไหม
    p.set(side * splay, S.c + s * spread - 0.12 * a * a + 0.035 * a * Math.sin(a * 3 + s * 2), z0 - a * len);
  });
}

/** ครีบหลังทรงใบเรือสูง ก้านเอนไปด้านหลังมากขึ้นเรื่อย ๆ ปลายท้ายยื่นยาวพลิ้ว */
function dorsalFin(q) {
  return finGrid(12 * q, 22 * q, PART.dorsal, (a, b, p) => {
    const t = lerp(0.22, 0.72, b);
    const phi = lerp(0.32, 1.22, b) + 0.38 * a * a;
    const len = 0.36 * (0.62 + 0.75 * b - 0.6 * b * b);
    p.set(0, backY(t) - 0.015 + Math.cos(phi) * len * a, 0.5 - t - Math.sin(phi) * len * a);
  });
}

/** ครีบก้นยาวลู่ไปด้านหลัง */
function analFin(q) {
  return finGrid(10 * q, 12 * q, PART.anal, (a, b, p) => {
    const t = lerp(0.64, 0.8, b);
    const phi = lerp(0.55, 1.05, b) + 0.25 * a * a;
    const len = 0.26 * (1 - 0.35 * b);
    p.set(0, bellyY(t) + 0.012 - Math.cos(phi) * len * a, 0.5 - t - Math.sin(phi) * len * a);
  });
}

/** ครีบอกคู่ยาวทรงพัด ห้อยลงและลู่ไปด้านหลัง */
function pectoralFin(q, side) {
  const base = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const dir = new THREE.Vector3();
  return finGrid(10 * q, 10 * q, side > 0 ? PART.pectoralR : PART.pectoralL, (a, b, p) => {
    const t = 0.27 + 0.02 * b;
    const theta = Math.PI / 2 + lerp(0.2, 0.75, b);
    const th = side > 0 ? theta : Math.PI * 2 - theta;
    surfacePoint(t, th, base);
    surfaceNormal(t, th, nrm);
    base.addScaledVector(nrm, -0.004);
    dir.set(side * 0.55, lerp(0.15, -0.65, b), -0.8).normalize();
    const len = 0.3 * (0.5 + 0.5 * Math.pow(Math.sin(Math.PI * b), 0.6));
    p.copy(base).addScaledVector(dir, len * a);
    p.x += side * 0.03 * Math.sin(a * Math.PI * 0.8) * Math.sin(Math.PI * b);
    p.y -= 0.05 * a * a;
  });
}

/** ครีบท้องคู่ยาวพลิ้วใต้ท้อง */
function pelvicFin(q, side) {
  const base = new THREE.Vector3();
  const dir = new THREE.Vector3();
  return finGrid(10 * q, 8 * q, side > 0 ? PART.pelvicR : PART.pelvicL, (a, b, p) => {
    const t = lerp(0.42, 0.5, b);
    surfacePoint(t, Math.PI - side * 0.35, base);
    base.y += 0.008;
    dir.set(side * 0.32, -0.78, -0.55 - 0.4 * b).normalize();
    const len = 0.3 * (1 - 0.45 * b);
    p.copy(base).addScaledVector(dir, len * a);
    p.z -= 0.06 * a * a;
  });
}

function buildFins(D) {
  const q = D.fin;
  const parts = [tailLobe(q, -1), tailLobe(q, 1), dorsalFin(q), analFin(q)];
  for (const side of [-1, 1]) parts.push(pectoralFin(q, side), pelvicFin(q, side));
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

// ── API ─────────────────────────────────────────────────────────

const cache = new Map();

/**
 * geometry ของปลาอวกาศตามระดับรายละเอียด สร้างครั้งเดียวแล้วใช้ร่วมกันทุกตัว (ทุกสี)
 * @returns {{ body: THREE.BufferGeometry, eyes: THREE.BufferGeometry, fins: THREE.BufferGeometry }}
 */
export function getSpaceFishGeometry(detail = 'high') {
  const key = SPACEFISH_DETAIL[detail] ? detail : 'high';
  if (!cache.has(key)) {
    const D = SPACEFISH_DETAIL[key];
    const bodyParts = [buildBody(D), buildLips()];
    const body = mergeGeometries(bodyParts);
    bodyParts.forEach((g) => g.dispose());
    const geos = { body, eyes: buildEyes(D), fins: buildFins(D) };
    for (const g of Object.values(geos)) {
      g.computeBoundingSphere();
      g.boundingSphere.radius += 0.2; // เผื่อการส่ายตัว/ครีบพลิ้วใน shader
      g.userData.shared = true;
    }
    cache.set(key, geos);
  }
  return cache.get(key);
}
