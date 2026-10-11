import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { clamp, lerp, smoothstep } from '../utils/math.js';
import { fbm3 } from '../utils/noise.js';

/**
 * โมเดลปลาชั่วคราวสร้างด้วยโค้ด ใช้ระหว่างที่ยังไม่มีไฟล์ .glb
 * ปลาทุกตัวถูกสร้างให้ยาว 1 หน่วย หันหัวไป +Z (หัว z=+0.5, โคนหาง z=-0.5)
 * แล้วค่อยย่อ/ขยายตาม species.length ใน Fish.js
 */

const PROFILE_SEGMENTS = 44;
const RADIAL_SEGMENTS = 28;

/** รัศมีลำตัว (0..1) ตามความยาว: t=0 ปลายจมูก → t=1 โคนหาง */
export function bodyProfile(t, body) {
  const peak = body.peak ?? 0.38;
  const tailR = body.peduncle ?? 0.2;
  if (t <= peak) {
    return Math.pow(Math.sin((t / peak) * Math.PI * 0.5), body.nose ?? 0.55);
  }
  const u = (t - peak) / (1 - peak);
  return tailR + (1 - tailR) * Math.pow(Math.cos(u * Math.PI * 0.5), body.taper ?? 1.1);
}

// ── ลวดลาย ─────────────────────────────────────────────────────

function preparePattern(pattern) {
  const colors = (pattern.colors ?? ['#ff8800']).map((c) => new THREE.Color(c));
  return {
    ...pattern,
    c0: colors[0],
    c1: colors[1] ?? colors[0],
    c2: colors[2] ?? colors[1] ?? colors[0],
    belly: new THREE.Color(pattern.belly ?? '#ffffff'),
  };
}

/** คำนวณสีของลำตัว ณ ตำแหน่งหนึ่ง  t: ตามความยาว, up: -1 ท้อง → +1 หลัง */
function patternColor(P, t, up, pos, out) {
  switch (P.type) {
    case 'patches': {
      const s = P.scale ?? 3;
      const n = fbm3(pos.x * s + 1.3, pos.y * s, pos.z * s - 2.1);
      out.copy(P.c0).lerp(P.c1, smoothstep(0.5, 0.58, n));
      break;
    }
    case 'bands': {
      out.copy(P.c0);
      const tt = t + up * up * 0.035;
      for (const [at, hw] of P.bands ?? []) {
        const d = Math.abs(tt - at);
        if (d < hw) out.copy(P.c1);
        else if (P.edge && d < hw + P.edge) out.copy(P.c2);
      }
      break;
    }
    case 'neon': {
      if (t > 0.08 && t < 0.88 && up > 0.0 && up < 0.32) out.copy(P.c0).multiplyScalar(1.15);
      else if (up < 0.02 && up > -0.85 && t > 0.42 && t < 0.96) out.copy(P.c1);
      else if (up >= 0.32) out.copy(P.c2);
      else out.copy(P.belly);
      return out; // ลายนีออนจัดการสีท้องเอง
    }
    case 'gradient':
      out.copy(P.c0).lerp(P.c1, smoothstep(0.1, 0.95, t));
      break;
    case 'koi': {
      out.copy(P.c0);
      const s = P.scale ?? 2.6;
      const n = fbm3(pos.x * s - 4.0, pos.y * s + 1.0, pos.z * s * 0.8);
      if (up > -0.35 && n > 0.52) out.copy(P.c1);
      if (t < 0.16 && up > 0.1) out.copy(P.c1);
      break;
    }
    case 'tang': {
      out.copy(P.c0);
      const inBand = t > 0.15 && t < 0.9 && Math.abs(up - 0.45) < 0.24 + 0.1 * Math.sin(t * Math.PI);
      const inOval = Math.hypot((t - 0.56) / 0.14, (up - 0.5) / 0.13) < 1;
      if ((inBand && !inOval) || (t > 0.86 && Math.abs(up) < 0.55)) out.copy(P.c1);
      break;
    }
    case 'discus': {
      out.copy(P.c0);
      if (t > 0.12 && Math.sin(up * 22 + Math.sin(t * 9) * 2.0) > 0.55) out.copy(P.c1);
      break;
    }
    case 'stripes': {
      const f = P.frequency ?? 30;
      out.copy(Math.sin(t * f + up * 1.5) > 0.15 ? P.c1 : P.c0);
      break;
    }
    case 'scales': {
      const f = P.frequency ?? 24;
      const sx = t * f;
      const cell = Math.floor(sx);
      const fx = sx - cell;
      const sy = up * f * 0.35 + (cell % 2) * 0.5;
      const fy = sy - Math.floor(sy);
      const d = Math.hypot(fx, (fy - 0.5) * 1.2);
      const edge = smoothstep(0.42, 0.55, d) * (1 - smoothstep(0.55, 0.72, d));
      out.copy(P.c0).lerp(P.c1, edge * 0.85);
      break;
    }
    case 'solid':
    default:
      out.copy(P.c0);
  }
  // ท้องสีอ่อนกว่า (countershading) และหลังเข้มขึ้นเล็กน้อย
  if (up < -0.1) out.lerp(P.belly, smoothstep(-0.1, -0.85, up) * 0.85);
  if (up > 0.55) out.multiplyScalar(1 - (up - 0.55) * 0.3);
  return out;
}

function addColor(geometry, colorFn) {
  const pos = geometry.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    colorFn(v, c, i);
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

// ── ลำตัว + ตา ──────────────────────────────────────────────────

function buildBodyGeometry(look) {
  const body = look.body;
  const H = body.height;
  const W = body.width;
  const pts = [new THREE.Vector2(0, -0.5)];
  for (let j = 0; j <= PROFILE_SEGMENTS; j++) {
    const y = -0.5 + j / PROFILE_SEGMENTS; // หาง → จมูก (ต้องเรียง y จากน้อยไปมาก ให้ normal ชี้ออก)
    const r = Math.max(bodyProfile(0.5 - y, body) * H * 0.5, 0.0001);
    pts.push(new THREE.Vector2(r, y));
  }
  const geo = new THREE.LatheGeometry(pts, RADIAL_SEGMENTS);
  geo.rotateX(Math.PI / 2); // แกนหมุนจาก Y → Z
  geo.scale(W, 1, 1); // บีบด้านข้างให้แบน

  const P = preparePattern(look.pattern);
  addColor(geo, (p, out) => {
    const t = clamp(0.5 - p.z, 0, 1);
    const R = Math.max(bodyProfile(t, body) * H * 0.5, 1e-4);
    const up = clamp(p.y / R, -1, 1);
    patternColor(P, t, up, p, out);
  });

  // ตา
  const tEye = 0.13;
  const R = bodyProfile(tEye, body) * H * 0.5;
  const upEye = 0.25;
  const eyeR = look.eyeSize ?? 0.07;
  const ex = R * W * Math.sqrt(1 - upEye * upEye) * 0.88;
  const ey = R * upEye;
  const ez = 0.5 - tEye;
  const white = new THREE.Color('#f6f6f0');
  const black = new THREE.Color('#0b0b0d');
  const parts = [geo];
  for (const side of [-1, 1]) {
    const sclera = new THREE.SphereGeometry(eyeR, 14, 10);
    sclera.translate(side * ex, ey, ez);
    addColor(sclera, (_p, out) => out.copy(white));
    const pupil = new THREE.SphereGeometry(eyeR * 0.62, 12, 8);
    pupil.translate(side * (ex + eyeR * 0.5), ey, ez + eyeR * 0.12);
    addColor(pupil, (_p, out) => out.copy(black));
    parts.push(sclera, pupil);
  }
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
}

// ── ครีบ ────────────────────────────────────────────────────────

/** สร้างแผ่นครีบแบบตาราง u×v ให้บิดตามคลื่นว่ายน้ำได้นุ่มนวล */
function gridGeometry(nu, nv, posFn, colorFn) {
  const positions = [];
  const colors = [];
  const uvs = [];
  const indices = [];
  const p = new THREE.Vector3();
  const c = new THREE.Color();
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const u = i / nu;
      const v = j / nv;
      posFn(u, v, p);
      colorFn(u, v, c);
      positions.push(p.x, p.y, p.z);
      colors.push(c.r, c.g, c.b);
      uvs.push(u, v);
    }
  }
  for (let i = 0; i < nu; i++) {
    for (let j = 0; j < nv; j++) {
      const a = i * (nv + 1) + j;
      const b = a + nv + 1;
      indices.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function tailGeometry(look) {
  const { body, fins } = look;
  const H = body.height;
  const z0 = -0.5 + 0.04;
  const hb = (body.peduncle ?? 0.2) * H * 0.5 * 1.1;
  const len = fins.tailLength ?? 0.4;
  const hh = (fins.tailHeight ?? 0.5) * 0.5;
  const type = fins.tail ?? 'fan';
  const base = new THREE.Color(fins.tailColor ?? fins.color);
  const tip = new THREE.Color(fins.tailColor ? fins.tailColor : fins.tip ?? fins.color);
  const colorFn = (u, _v, c) => c.copy(base).lerp(tip, Math.pow(u, 1.4));

  const lobe = (shapeLen, heightFn, extra) =>
    gridGeometry(10, 10, (u, v, p) => {
      const s = v * 2 - 1;
      const L = shapeLen(s);
      p.set(0, s * heightFn(u), z0 - u * L);
      if (extra) extra(u, s, p);
    }, colorFn);

  const grow = (pow) => (u) => hb + (hh - hb) * Math.pow(u, pow);

  switch (type) {
    case 'fork':
      return [lobe((s) => len * (0.5 + 0.5 * Math.pow(Math.abs(s), 1.3)), grow(0.85))];
    case 'lunate':
      return [lobe((s) => len * (0.42 + 0.58 * Math.pow(Math.abs(s), 2.2)), grow(0.6))];
    case 'veil':
      return [
        lobe(
          (s) => len * (0.85 + 0.15 * (1 - s * s)),
          grow(0.7),
          (u, s, p) => {
            p.y -= u * u * len * 0.28;
            p.z += Math.sin(s * 7) * 0.025 * u;
          },
        ),
      ];
    case 'double': {
      const geos = [];
      for (const side of [-1, 1]) {
        const angle = side * 0.42;
        geos.push(
          lobe(
            (s) => len * Math.sqrt(1 - 0.3 * s * s),
            (u) => hb + (hh * 0.85 - hb) * Math.pow(u, 0.8),
            (_u, _s, p) => {
              const dz = p.z - z0;
              p.x = dz * Math.sin(angle);
              p.z = z0 + dz * Math.cos(angle);
              p.y -= Math.pow(_u, 2) * len * 0.08;
            },
          ),
        );
      }
      return geos;
    }
    case 'fan':
    default:
      return [lobe((s) => len * Math.sqrt(1 - 0.35 * s * s), grow(0.8))];
  }
}

function crestFin(look, { start, end, size, top }) {
  const { body, fins } = look;
  const H = body.height;
  const sweep = fins.sweep ?? 0.45;
  const base = new THREE.Color(fins.color);
  const tip = new THREE.Color(fins.tip ?? fins.color);
  return gridGeometry(14, 6, (u, v, p) => {
    const t = lerp(start, end, u);
    const yb = bodyProfile(t, body) * H * 0.5 * 0.9;
    let h = size * Math.pow(Math.sin(Math.PI * Math.pow(u, 0.7)), 0.8);
    if (fins.spiky) h *= 0.55 + 0.45 * Math.abs(Math.sin(u * Math.PI * 7));
    const dir = top ? 1 : -1;
    p.set(0, dir * (yb + v * h), 0.5 - t - v * h * sweep);
  }, (_u, v, c) => c.copy(base).lerp(tip, Math.pow(v, 1.3)));
}

function pectoralFins(look) {
  const { body, fins } = look;
  const H = body.height;
  const W = body.width;
  const len = fins.pectoral ?? 0.15;
  if (len <= 0) return [];
  const t = 0.3;
  const R = bodyProfile(t, body) * H * 0.5;
  const up = -0.3;
  const base = new THREE.Color(fins.color);
  const tip = new THREE.Color(fins.tip ?? fins.color);
  const geos = [];
  for (const side of [-1, 1]) {
    const origin = new THREE.Vector3(side * R * W * Math.sqrt(1 - up * up) * 0.9, R * up, 0.5 - t);
    const D = new THREE.Vector3(side * 0.6, -0.3, -0.75).normalize();
    const Y = new THREE.Vector3(0, 1, 0);
    const E = Y.sub(D.clone().multiplyScalar(D.dot(Y))).normalize();
    geos.push(
      gridGeometry(6, 4, (u, v, p) => {
        const s = v * 2 - 1;
        const width = len * 0.42 * (0.35 + 0.65 * Math.sin(Math.PI * Math.pow(u, 0.75)));
        p.copy(origin).addScaledVector(D, u * len).addScaledVector(E, s * width);
      }, (u, _v, c) => c.copy(base).lerp(tip, Math.pow(u, 1.3))),
    );
  }
  return geos;
}

function buildFinGeometry(look) {
  const f = look.fins;
  const parts = [...tailGeometry(look)];
  if ((f.dorsal ?? 0) > 0) parts.push(crestFin(look, { start: f.dorsalStart ?? 0.32, end: f.dorsalEnd ?? 0.68, size: f.dorsal, top: true }));
  if ((f.anal ?? 0) > 0) parts.push(crestFin(look, { start: f.analStart ?? 0.56, end: f.analEnd ?? 0.82, size: f.anal, top: false }));
  parts.push(...pectoralFins(look));
  const merged = mergeGeometries(parts);
  parts.forEach((g) => g.dispose());
  merged.computeBoundingSphere();
  return merged;
}

// ── API ─────────────────────────────────────────────────────────

const geometryCache = new Map();

/** geometry ของแต่ละสายพันธุ์สร้างครั้งเดียวแล้วใช้ร่วมกันทุกตัว */
export function getFishGeometry(species) {
  if (!geometryCache.has(species.id)) {
    const body = buildBodyGeometry(species.look);
    const fins = buildFinGeometry(species.look);
    body.userData.shared = fins.userData.shared = true; // ห้าม dispose ตอนลบปลา
    geometryCache.set(species.id, { body, fins });
  }
  return geometryCache.get(species.id);
}

export function createFishMaterials(look) {
  const shine = look.shine ?? 0.4;
  const params = { vertexColors: true, roughness: clamp(1 - shine * 0.8, 0.15, 1), metalness: look.metalness ?? 0.08 };
  const body = look.iridescence
    ? new THREE.MeshPhysicalMaterial({ ...params, iridescence: look.iridescence, iridescenceIOR: 1.35, iridescenceThicknessRange: [200, 600] })
    : new THREE.MeshStandardMaterial(params);
  const fins = new THREE.MeshStandardMaterial({
    vertexColors: true,
    transparent: true,
    opacity: look.fins.opacity ?? 0.8,
    side: THREE.DoubleSide,
    depthWrite: false,
    roughness: 0.55,
    metalness: 0,
  });
  return { body, fins };
}

/** สร้างโมเดลปลาชั่วคราวพร้อมใช้ (คืน Group ที่มี body กับ fins) */
export function buildFishPlaceholder(species, materials = createFishMaterials(species.look)) {
  const geo = getFishGeometry(species);
  const group = new THREE.Group();
  const body = new THREE.Mesh(geo.body, materials.body);
  body.castShadow = true;
  const fins = new THREE.Mesh(geo.fins, materials.fins);
  fins.renderOrder = 1;
  group.add(body, fins);
  group.userData.parts = { body, fins };
  return group;
}
