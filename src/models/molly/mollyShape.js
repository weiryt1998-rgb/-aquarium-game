import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * รูปทรง 3 มิติของปลา Balloon Molly (สร้างด้วย BufferGeometry ทั้งหมด ไม่ต้องใช้ไฟล์โมเดล)
 *
 * ระบบพิกัดเหมือนโมเดลปลาอื่นในเกม: หันหัวไป +Z, ลำตัวยาว 1 หน่วย (ปลายจมูก z=+0.5 → โคนหาง z=-0.5)
 * หางยื่นต่อไปถึงประมาณ z=-0.95  แกน +Y คือด้านหลังปลา
 *
 * t = ตำแหน่งตามความยาวลำตัว 0 (ปลายจมูก) → 1 (โคนหาง)   θ = มุมรอบลำตัว 0 (สันหลัง) → π (ท้อง)
 * ทุกจุดมี attribute aFin = (ชนิดชิ้นส่วน, น้ำหนักการขยับ 0 ที่โคน → 1 ที่ปลาย) ให้ shader ขยับครีบแต่ละชิ้นได้
 */

/** รหัสชิ้นส่วนใน aFin.x (ต้องตรงกับ mollySwim.js) */
export const PART = { body: 0, tail: 1, dorsal: 2, pectoralL: 3, pectoralR: 4, pelvicL: 5, pelvicR: 6, anal: 7 };

/** ระดับรายละเอียด — มือถือ/คุณภาพต่ำใช้ polygon และ texture น้อยลง */
export const MOLLY_DETAIL = {
  high: { rings: 72, radial: 48, fin: 1, eye: [24, 16], texture: 1024 },
  medium: { rings: 54, radial: 36, fin: 0.75, eye: [18, 12], texture: 512 },
  low: { rings: 36, radial: 24, fin: 0.5, eye: [12, 8], texture: 512 },
};

/** จำนวนก้านครีบต่อความกว้าง 1 รอบของ texture ครีบ (ใช้ร่วมกับ mollyTextures.js) */
export const FIN_RAYS_PER_TEXTURE = 8;

// ── โปรไฟล์ลำตัว ───────────────────────────────────────────────

/** เส้นโค้ง Hermite ผ่านจุด [t, ค่า] ที่กำหนด — ปรับรูปร่างได้ง่ายโดยแก้ตัวเลขในตาราง */
function curve(points) {
  const ts = points.map((p) => p[0]);
  const vs = points.map((p) => p[1]);
  const n = points.length;
  const m = vs.map((_, i) => {
    if (i === 0) return (vs[1] - vs[0]) / (ts[1] - ts[0]);
    if (i === n - 1) return (vs[n - 1] - vs[n - 2]) / (ts[n - 1] - ts[n - 2]);
    return (vs[i + 1] - vs[i - 1]) / (ts[i + 1] - ts[i - 1]);
  });
  return (t) => {
    if (t <= ts[0]) return vs[0];
    if (t >= ts[n - 1]) return vs[n - 1];
    let i = 0;
    while (t > ts[i + 1]) i++;
    const h = ts[i + 1] - ts[i];
    const u = (t - ts[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * vs[i] + (u3 - 2 * u2 + u) * h * m[i] + (-2 * u3 + 3 * u2) * vs[i + 1] + (u3 - u2) * h * m[i + 1];
  };
}

// แนวสันหลัง: ลาดขึ้นจากปากที่เชิดขึ้นเล็กน้อย หลังโก่งสูงสุดใต้ครีบหลัง แล้วลาดลงสู่โคนหาง
const TOP = curve([[0, 0.1], [0.06, 0.125], [0.14, 0.165], [0.24, 0.205], [0.36, 0.232], [0.48, 0.238], [0.6, 0.212], [0.72, 0.162], [0.84, 0.112], [0.94, 0.088], [1, 0.084]]);
// แนวท้อง: ท้องป่องกลมแบบ balloon ต่ำสุดกลางลำตัว แล้วคอดขึ้นเร็วหลังครีบก้น
const BOTTOM = curve([[0, -0.02], [0.06, -0.08], [0.14, -0.168], [0.24, -0.258], [0.36, -0.33], [0.46, -0.356], [0.56, -0.342], [0.66, -0.278], [0.76, -0.172], [0.86, -0.106], [0.94, -0.084], [1, -0.078]]);
// ครึ่งความกว้าง: อ้วนกลมช่วงท้อง แล้วแบนลงที่โคนหาง
const WIDTH = curve([[0, 0.085], [0.06, 0.11], [0.14, 0.152], [0.24, 0.192], [0.36, 0.218], [0.48, 0.22], [0.6, 0.192], [0.72, 0.136], [0.84, 0.082], [0.94, 0.052], [1, 0.042]]);

const NOSE = 0.12; // ช่วงปลายจมูกที่ปิดมนเป็นทรงกลม
export const TAIL_CAP = 0.06; // ช่วงโคนหางที่แบนลงเป็นแผ่นต่อเข้ากับครีบหาง
export const T_END = 1 + TAIL_CAP; // ปลายสุดของลำตัว (uv.x = t / T_END)
const E_UP = 2 / 2.15; // เลขชี้กำลัง superellipse ครึ่งบน (สันหลังมนแต่แคบกว่า)
const E_LOW = 2 / 2.55; // ครึ่งล่างอ้วนป่องกว่า

const _sec = { c: 0, up: 0, down: 0, w: 0 };

/** หน้าตัดลำตัวที่ตำแหน่ง t: จุดกึ่งกลาง c, ระยะขึ้นถึงหลัง up, ลงถึงท้อง down, ครึ่งความกว้าง w */
export function section(t, out = _sec) {
  const tc = Math.min(Math.max(t, 0), 1);
  const top = TOP(tc);
  const bot = BOTTOM(tc);
  let kh = 1;
  let kw = 1;
  if (t < NOSE) kh = kw = Math.pow(Math.max(0, 1 - (1 - t / NOSE) ** 2), 0.55);
  else if (t > 1) {
    // โคนหางบีบด้านข้างจนแบนเป็นแผ่น แต่ยังสูงเกือบเท่าเดิม → ต่อกับครีบหางได้เนียน
    const x = Math.min((t - 1) / TAIL_CAP, 1);
    kh = 1 - 0.25 * x * x;
    kw = Math.sqrt(Math.max(0, 1 - x * x));
  }
  out.c = (top + bot) / 2;
  out.up = ((top - bot) / 2) * kh;
  out.down = out.up;
  out.w = WIDTH(tc) * kw;
  return out;
}

/** แนวสันหลัง / ท้อง (ใช้วางครีบหลัง ครีบก้น) */
export const backY = (t) => TOP(t);
export const bellyY = (t) => BOTTOM(t);

/** จุดบนผิวลำตัวที่ (t, θ) */
export function surfacePoint(t, theta, out = new THREE.Vector3()) {
  const S = section(t);
  const s = Math.sin(theta);
  const co = Math.cos(theta);
  const lower = co < 0;
  const e = lower ? E_LOW : E_UP;
  // ท้องด้านข้างป่องออกเล็กน้อย (ช่วงท้องเท่านั้น) ให้ดูอ้วนกลมแบบ balloon
  const belly = lower ? 1 + 0.44 * -co * (1 + co) * Math.exp(-(((t - 0.45) / 0.22) ** 2)) : 1;
  out.set(Math.sign(s) * Math.pow(Math.abs(s), e) * S.w * belly, S.c + Math.sign(co) * Math.pow(Math.abs(co), e) * S.up, 0.5 - t);
  return out;
}

/** normal ของผิวลำตัวที่ (t, θ) คำนวณจากผลต่างเล็ก ๆ */
export function surfaceNormal(t, theta, out = new THREE.Vector3()) {
  const e = 1e-3;
  const p = surfacePoint(t, theta, new THREE.Vector3());
  const dt = surfacePoint(t + e, theta, new THREE.Vector3()).sub(p);
  const dq = surfacePoint(t, theta + e, new THREE.Vector3()).sub(p);
  return out.crossVectors(dq, dt).normalize();
}

/** เส้นรอบวงโดยประมาณของหน้าตัด (ใช้ชดเชยการยืดของ texture รอบตัว) */
export function circumference(t) {
  const S = section(t, {});
  const a = Math.max(S.w, 1e-4);
  const b = Math.max(S.up, 1e-4);
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h))) * 1.04;
}

// ── เครื่องมือสร้าง geometry ──────────────────────────────────────

function finAttribute(count, id, weightFn) {
  const arr = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) {
    arr[i * 2] = id;
    arr[i * 2 + 1] = weightFn ? weightFn(i) : 0;
  }
  return new THREE.BufferAttribute(arr, 2);
}

/** ให้ geometry มี attribute ครบชุดเดียวกัน (position, normal, uv, aFin) ก่อนรวมกัน */
function normalizeAttributes(geo, id = PART.body) {
  for (const name of Object.keys(geo.attributes)) {
    if (!['position', 'normal', 'uv', 'aFin'].includes(name)) geo.deleteAttribute(name);
  }
  if (!geo.attributes.aFin) geo.setAttribute('aFin', finAttribute(geo.attributes.position.count, id));
  return geo;
}

function setUniformUv(geo, u, v) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
}

// ── ลำตัว ───────────────────────────────────────────────────────

function buildBody(D) {
  const N = D.rings;
  const M = D.radial;
  const tMax = T_END;
  const positions = [];
  const uvs = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= N; i++) {
    const t = tMax * (0.5 - 0.5 * Math.cos((Math.PI * i) / N)); // ถี่ที่ปลายจมูกและโคนหาง
    for (let j = 0; j <= M; j++) {
      const theta = (j / M) * Math.PI * 2;
      surfacePoint(t, theta, p);
      positions.push(p.x, p.y, p.z);
      uvs.push(t / T_END, j / M);
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
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // แก้ normal ที่ปลายจมูก (จุดยอดซ้อนกัน) และรอยต่อ θ=0/2π ให้เรียบ
  const nrm = geo.attributes.normal;
  for (let j = 0; j <= M; j++) nrm.setXYZ(j, 0, 0.25, 0.97);
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

/**
 * ริมฝีปาก (ปากเล็กเชิดขึ้นแบบปลาสอด) + ช่องปากสีเข้ม
 * ใช้สีจากแถบซ้ายสุดของ texture ลำตัว (mollyTextures วาดสีปาก/ช่องปากไว้ตรงนั้น)
 */
function buildMouth() {
  const S = section(0);
  const tilt = -0.42;
  const lips = new THREE.TorusGeometry(0.021, 0.0085, 8, 18);
  lips.scale(1, 0.62, 0.7);
  lips.rotateX(tilt);
  lips.translate(0, S.c + 0.002, 0.493);
  setUniformUv(lips, 0.003, 0.25);
  const inner = new THREE.CircleGeometry(0.017, 16);
  inner.scale(1, 0.55, 1);
  inner.rotateX(tilt);
  inner.translate(0, S.c + 0.002, 0.496);
  setUniformUv(inner, 0.003, 0.75);
  return [normalizeAttributes(lips), normalizeAttributes(inner)];
}

// ── ตา ──────────────────────────────────────────────────────────

export const EYE = { t: 0.15, cosTheta: 0.42, radius: 0.057, sink: 0.42 };

/** ลูกตา 2 ข้าง: UV แบบฉายจากด้านหน้าของตา (ตรงกลาง = รูม่านตา) */
function buildEyes(D) {
  const theta = Math.acos(EYE.cosTheta);
  const surf = surfacePoint(EYE.t, theta);
  const normal = surfaceNormal(EYE.t, theta);
  const geos = [];
  for (const side of [1, -1]) {
    const center = surf.clone().addScaledVector(normal, -EYE.radius * EYE.sink);
    center.x *= side;
    // ตาปลามองออกด้านข้างและเฉียงไปข้างหน้าเล็กน้อย
    const axis = new THREE.Vector3(normal.x * side, normal.y * 0.6, normal.z + 0.22).normalize();
    const b1 = new THREE.Vector3(0, 1, 0).addScaledVector(axis, -axis.y).normalize();
    const b2 = new THREE.Vector3().crossVectors(axis, b1);
    const geo = new THREE.SphereGeometry(EYE.radius, D.eye[0], D.eye[1]);
    const pos = geo.attributes.position;
    const nrm = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const d = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      d.fromBufferAttribute(nrm, i);
      // หมุนทรงกลมให้ขั้ว +Y เดิมชี้ไปตามแกนตา
      const lx = d.x;
      const ly = d.y;
      const lz = d.z;
      const world = new THREE.Vector3().addScaledVector(axis, ly).addScaledVector(b1, lz).addScaledVector(b2, lx);
      pos.setXYZ(i, center.x + world.x * EYE.radius, center.y + world.y * EYE.radius, center.z + world.z * EYE.radius);
      nrm.setXYZ(i, world.x, world.y, world.z);
      uv.setXY(i, 0.5 + world.dot(b2) * 0.5 * side, 0.5 + world.dot(b1) * 0.5);
    }
    // ทรงกลมเดิมเรียงสามเหลี่ยมตามด้านนอก การหมุน (ไม่สะท้อน) ไม่ทำให้ด้านกลับ
    geos.push(normalizeAttributes(geo));
  }
  const merged = mergeGeometries(geos);
  geos.forEach((g) => g.dispose());
  return merged;
}

// ── ครีบ ────────────────────────────────────────────────────────

/**
 * แผ่นครีบแบบตาราง a×b
 * a = ตามก้านครีบ (0 โคน → 1 ปลาย)  b = ขวางก้านครีบ (0 → 1)
 * uv.x = a, uv.y = b × (จำนวนก้าน / ก้านต่อ texture) → ก้านครีบมีระยะห่างพอ ๆ กันทุกครีบ
 */
function finGrid(na, nb, id, rays, posFn) {
  na = Math.max(3, Math.round(na));
  nb = Math.max(3, Math.round(nb));
  const positions = [];
  const uvs = [];
  const fin = [];
  const p = new THREE.Vector3();
  const vScale = rays / FIN_RAYS_PER_TEXTURE;
  for (let i = 0; i <= na; i++) {
    for (let j = 0; j <= nb; j++) {
      const a = i / na;
      const b = j / nb;
      posFn(a, b, p);
      positions.push(p.x, p.y, p.z);
      uvs.push(a, b * vScale);
      fin.push(id, a);
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
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setAttribute('aFin', new THREE.Float32BufferAttribute(fin, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const lerp = (a, b, t) => a + (b - a) * t;

/** หางทรงพัดกว้าง ปลายบน-ล่างยื่นยาวกว่าตรงกลางเล็กน้อย */
function tailFin(q) {
  const S = section(0.985, {});
  const yc = S.c;
  const hb = S.up;
  const ht = 0.3;
  const L = 0.49;
  const z0 = 0.5 - 0.985;
  return finGrid(14 * q, 18 * q, PART.tail, 17, (a, b, p) => {
    const s = b * 2 - 1;
    const spread = hb + (ht - hb) * Math.pow(a, 0.62);
    const len = L * (0.86 + 0.1 * (1 - s * s) + 0.07 * s * s * s * s);
    // ก้านครีบโค้งออกนิดหน่อยและครีบเว้าเหมือนพัด
    p.set(0.012 * Math.sin(a * Math.PI) * (1 - s * s), yc + s * spread * (1 + 0.04 * a), z0 - a * len);
  });
}

/** ครีบหลังทรงใบเรือ ก้านครีบเอนไปด้านหลังมากขึ้นเรื่อย ๆ ปลายท้ายยื่นเลยฐานครีบ */
function dorsalFin(q) {
  const t0 = 0.34;
  const t1 = 0.7;
  const H = 0.3;
  return finGrid(10 * q, 20 * q, PART.dorsal, 13, (a, b, p) => {
    const t = lerp(t0, t1, b);
    const phi = lerp(0.42, 1.12, b) + 0.2 * a * a;
    const len = H * (0.78 + 0.32 * b - 0.3 * b * b);
    p.set(0, backY(t) - 0.012 + Math.cos(phi) * len * a, 0.5 - t - Math.sin(phi) * len * a);
  });
}

/** ครีบก้น (ใต้ลำตัวหลังท้องป่อง) */
function analFin(q) {
  const t0 = 0.6;
  const t1 = 0.71;
  const H = 0.13;
  return finGrid(7 * q, 9 * q, PART.anal, 8, (a, b, p) => {
    const t = lerp(t0, t1, b);
    const phi = lerp(0.45, 0.95, b) + 0.12 * a;
    const len = H * (1 - 0.3 * b);
    p.set(0, bellyY(t) + 0.01 - Math.cos(phi) * len * a, 0.5 - t - Math.sin(phi) * len * a);
  });
}

/** ครีบท้องคู่เล็ก ๆ ใต้ท้อง */
function pelvicFin(q, side) {
  const t0 = 0.4;
  const t1 = 0.455;
  const base = new THREE.Vector3();
  const dir = new THREE.Vector3();
  return finGrid(6 * q, 6 * q, side > 0 ? PART.pelvicR : PART.pelvicL, 5, (a, b, p) => {
    const t = lerp(t0, t1, b);
    surfacePoint(t, Math.PI - side * 0.32, base);
    base.y += 0.006;
    dir.set(side * 0.38, -0.75, -0.5 - 0.35 * b).normalize();
    const len = 0.115 * (1 - 0.4 * b);
    p.copy(base).addScaledVector(dir, len * a);
  });
}

/** ครีบอกคู่ทรงพัดหลังแผ่นปิดเหงือก */
function pectoralFin(q, side) {
  const base = new THREE.Vector3();
  const nrm = new THREE.Vector3();
  const dir = new THREE.Vector3();
  return finGrid(7 * q, 10 * q, side > 0 ? PART.pectoralR : PART.pectoralL, 10, (a, b, p) => {
    const t = 0.255 + 0.014 * b;
    const theta = Math.PI / 2 + lerp(0.12, 0.62, b);
    const th = side > 0 ? theta : Math.PI * 2 - theta;
    surfacePoint(t, th, base);
    surfaceNormal(t, th, nrm);
    base.addScaledVector(nrm, -0.004);
    dir.set(side * 0.5, lerp(0.38, -0.5, b), -0.85).normalize();
    const len = 0.16 * (0.55 + 0.45 * Math.pow(Math.sin(Math.PI * b), 0.7)); // ปลายครีบมนแบบพัด
    p.copy(base).addScaledVector(dir, len * a);
    p.x += side * 0.02 * Math.sin(a * Math.PI * 0.8) * Math.sin(Math.PI * b); // ครีบโค้งเป็นแอ่งเล็กน้อย
  });
}

function buildFins(D) {
  const q = D.fin;
  const parts = [tailFin(q), dorsalFin(q), analFin(q)];
  for (const side of [-1, 1]) parts.push(pectoralFin(q, side), pelvicFin(q, side));
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  return merged;
}

// ── API ─────────────────────────────────────────────────────────

const cache = new Map();

/**
 * geometry ของ Molly ตามระดับรายละเอียด สร้างครั้งเดียวแล้วใช้ร่วมกันทุกตัว (ทุกสี)
 * @returns {{ body: THREE.BufferGeometry, eyes: THREE.BufferGeometry, fins: THREE.BufferGeometry }}
 */
export function getMollyGeometry(detail = 'high') {
  const key = MOLLY_DETAIL[detail] ? detail : 'high';
  if (!cache.has(key)) {
    const D = MOLLY_DETAIL[key];
    const bodyParts = [buildBody(D), ...buildMouth()];
    const body = mergeGeometries(bodyParts);
    bodyParts.forEach((g) => g.dispose());
    const geos = { body, eyes: buildEyes(D), fins: buildFins(D) };
    for (const g of Object.values(geos)) {
      g.computeBoundingSphere();
      // ขอบเขตเผื่อการส่ายตัว/สะบัดหางใน shader ไม่ให้ถูกตัดทิ้งตอนอยู่ขอบจอ
      g.boundingSphere.radius += 0.12;
      g.userData.shared = true; // ห้าม dispose ตอนลบปลา
    }
    cache.set(key, geos);
  }
  return cache.get(key);
}
