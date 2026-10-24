import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Room } from '../world/Room.js';
import { getSoftGlowTexture } from '../render/textures.js';

/**
 * 🎃 ของตกแต่งฮาโลวีนในห้องรอบตู้ (ชั่วคราว — โหลดจาก halloween.js เฉพาะช่วงเทศกาล)
 * ฟักทองแกะสลักบนโต๊ะ/พื้น/ชั้นวาง · เทียน · ธงราวฮาโลวีนใต้ชั้นวาง · ค้างคาวกระดาษห้อยเชือกแกว่งเบา ๆ
 *
 * ไม่แก้ world/Room.js: ต่อท้าย Room.build() ให้ใส่ของเพิ่มเข้า room.group → ถูกล้างพร้อมห้องตอนเปลี่ยนตู้
 * ทำแบบเดียวกับห้อง: รูปทรงพื้นฐาน + vertex color รวมเป็น mesh ตามวัสดุ ไม่มีไฟเพิ่ม (แสงเทียนเป็นแผ่นเรืองแสง)
 */

const FLOOR = -9; // ตรงกับ world/Room.js
const TABLE_TOP = -0.32;
const CEIL = FLOOR + 52;

const ORANGE = new THREE.Color('#ff7a12');
const FACE = '#ffd23f';
const BLACK = '#22142c';
const FLAG_COLORS = ['#ff8a1f', BLACK, '#7b3fc4'];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);

/** ชิ้นส่วนทาสีด้วย vertex color แล้วรวมเป็น mesh เดียว (แบบ Batch ใน world/Room.js) — color ฟังก์ชันได้พิกัดของชิ้นก่อนย้าย */
class Parts {
  constructor({ uv = false } = {}) {
    this.uv = uv;
    this.geos = [];
  }

  add(geo, color, [x, y, z] = [0, 0, 0], { rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (!this.uv) g.deleteAttribute('uv');
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    if (typeof color !== 'function') _c.set(color);
    for (let i = 0; i < pos.count; i++) {
      const c = typeof color === 'function' ? color(pos.getX(i), pos.getY(i), pos.getZ(i), _c) : _c;
      col.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.applyMatrix4(_m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rot[0], rot[1], rot[2])), _s.set(scale[0], scale[1], scale[2])));
    this.geos.push(g);
    return this;
  }

  /** สร้างชิ้นส่วนในพิกัดของตัวเอง (fn) แล้วย้ายทั้งชุดไปวางที่ pos หมุนรอบแกนตั้ง rotY */
  place(pos, rotY, fn) {
    const local = new Parts({ uv: this.uv });
    fn(local);
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromAxisAngle(UP, rotY), _s.set(1, 1, 1));
    for (const g of local.geos) this.geos.push(g.applyMatrix4(_m));
    return this;
  }

  mesh(material) {
    if (!this.geos.length) return null;
    const geo = mergeGeometries(this.geos);
    for (const g of this.geos) g.dispose();
    this.geos = [];
    return new THREE.Mesh(geo, material);
  }
}

// ── ฟักทองแกะสลัก ───────────────────────────────────────────────

const FLAT = 0.78; // ฟักทองเตี้ยกว่ากว้าง
const ribOf = (x, z) => Math.sqrt(Math.abs(Math.cos(4 * Math.atan2(z, x)))); // 1 = กลางพู, 0 = ร่อง (8 พู)

/** ลูกฟักทอง: ทรงกลมแป้น มีร่อง 8 พู และบุ๋มที่ขั้ว */
function pumpkinBody(r) {
  const geo = new THREE.SphereGeometry(r, 32, 18);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 0.9 + 0.1 * ribOf(x, z);
    const pole = (1 - Math.hypot(x, z) / r) ** 3;
    pos.setXYZ(i, x * k, y * FLAT - Math.sign(y) * r * FLAT * (y > 0 ? 0.2 : 0.1) * pole, z * k);
  }
  geo.computeVertexNormals();
  return geo;
}

/** ความลึก z ของผิวฟักทองด้านหน้าที่ (x, y) — ให้หน้าแกะสลักแนบผิวโค้ง */
function surfaceZ(x, y, r) {
  const rh = r * Math.sqrt(Math.max(0, 1 - (y / (r * FLAT)) ** 2));
  const z0 = Math.sqrt(Math.max(0, rh * rh - x * x));
  const k = 0.9 + 0.1 * ribOf(x, z0);
  return Math.sqrt(Math.max(0, (rh * k) ** 2 - x * x));
}

/** หน้าแกะสลัก (ตา จมูก ปากฟันเก) จากสามเหลี่ยม 2 มิติ (หน่วย = รัศมี) ฉายลงบนผิวด้านหน้า */
function faceGeometry(r) {
  const tris = [];
  // ตาสามเหลี่ยม + จมูก
  for (const s of [-1, 1]) tris.push([s * 0.5, 0.06], [s * 0.12, 0.06], [s * 0.3, 0.4]);
  tris.push([-0.09, -0.1], [0.09, -0.1], [0, 0.05]);
  // ปากยิ้มกว้าง: แถบแคบ ๆ ต่อกัน (แนบผิวโค้งได้) ฟันบน 2 ซี่ ฟันล่าง 1 ซี่
  const W = 0.56;
  const top = (x) => -0.27 + 0.15 * (x / W) ** 2 - 0.11 * Math.max(0, 1 - Math.abs(Math.abs(x) - 0.22) / 0.08);
  const bottom = (x) => -0.5 + 0.38 * (x / W) ** 2 + 0.11 * Math.max(0, 1 - Math.abs(x) / 0.09);
  const N = 44;
  for (let i = 0; i < N; i++) {
    const a = -W + (2 * W * i) / N;
    const b = -W + (2 * W * (i + 1)) / N;
    if (top(a) <= bottom(a) && top(b) <= bottom(b)) continue;
    tris.push([a, bottom(a)], [b, bottom(b)], [b, top(b)], [a, bottom(a)], [b, top(b)], [a, top(a)]);
  }
  const arr = new Float32Array(tris.length * 3);
  tris.forEach(([u, v], i) => {
    const x = u * r;
    const y = v * r * FLAT * 1.15;
    arr.set([x, y, surfaceZ(x, y, r) + r * 0.035], i * 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  geo.computeVertexNormals();
  return geo;
}

/** หมุนให้หน้าฟักทอง/แสงเรืองหันไปทางกล้อง (กล้องอยู่ด้านหน้าตู้ทาง +z) */
const faceCamera = (x, z, camZ) => Math.atan2(-x, camZ - z);

function pumpkin(P, [x, y, z], r, camZ) {
  const rotY = faceCamera(x, z, camZ);
  const cy = y + r * FLAT * 0.97;
  P.solid.place([x, cy, z], rotY, (p) => {
    p.add(pumpkinBody(r), (px, py, pz, c) => c.copy(ORANGE).multiplyScalar(0.6 + 0.32 * ribOf(px, pz) + 0.14 * (py / (r * FLAT))));
    p.add(new THREE.CylinderGeometry(r * 0.09, r * 0.15, r * 0.5, 7), '#5c6b2c', [r * 0.04, r * FLAT * 0.92, 0], { rot: [0.12, 0, -0.28] });
  });
  P.glow.place([x, cy, z], rotY, (p) => p.add(faceGeometry(r), FACE));
  P.halo.place([x, cy, z], rotY, (p) => p.add(new THREE.PlaneGeometry(r * 4.2, r * 4.2), '#ff6a10', [0, -r * 0.1, r * 1.15]));
  P.halo.add(new THREE.PlaneGeometry(r * 5, r * 4), '#7a3208', [x, y + 0.04, z + r * 0.9], { rot: [-Math.PI / 2, 0, 0] });
}

function candle(P, [x, y, z], height, camZ) {
  const top = y + height;
  P.solid.add(new THREE.CylinderGeometry(0.24, 0.27, height, 14), '#efe3c4', [x, y + height / 2, z]);
  P.solid.add(new THREE.SphereGeometry(0.09, 8, 6), '#f6ecd4', [x + 0.2, top - 0.25, z + 0.08], { scale: [1, 2.4, 1] });
  P.solid.add(new THREE.CylinderGeometry(0.025, 0.025, 0.16, 5), '#2a1d14', [x, top + 0.08, z]);
  P.glow.add(new THREE.SphereGeometry(0.12, 10, 8), '#ffb52a', [x, top + 0.3, z], { scale: [1, 2.3, 1] });
  P.glow.add(new THREE.SphereGeometry(0.06, 8, 6), '#fff6cc', [x, top + 0.24, z + 0.04], { scale: [1, 2, 1] });
  P.halo.place([x, top + 0.3, z], faceCamera(x, z, camZ), (p) => p.add(new THREE.PlaneGeometry(2.6, 2.6), '#ff9a30', [0, 0, 0.2]));
}

// ── ธงราว + ค้างคาวกระดาษ ───────────────────────────────────────

/** ธงราวสามเหลี่ยม ส้ม-ดำ-ม่วง ขึงใต้ชั้นวางของเหนือตู้ (ไม่ชนชั้นหนังสือฝั่งซ้าย) */
function bunting(P, R) {
  const half = R.W + 4;
  const z = R.back + 2.5;
  // ชิดใต้ชั้นวาง (ขอบล่าง h + 5.75) ให้พ้นขอบบนตู้ในมุมกล้องหลัก
  const yEnd = R.h + 5.65;
  const sag = 0.6;
  const at = (t) => new THREE.Vector3(-half + 2 * half * t, yEnd - sag * 4 * t * (1 - t), z);
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 13 }, (_, i) => at(i / 12)));
  P.cloth.add(new THREE.TubeGeometry(curve, 48, 0.05, 5), '#3a2a1c');
  for (const s of [-1, 1]) P.cloth.add(new THREE.SphereGeometry(0.16, 8, 6), '#c9a24a', [s * half, yEnd, z]);
  const count = Math.round(half / 0.85);
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const p = at(t);
    const slope = Math.atan2(-sag * 4 * (1 - 2 * t), 2 * half);
    const flag = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([-0.5, 0, 0, 0.5, 0, 0, 0, -1.25, 0], 3));
    flag.computeVertexNormals();
    P.cloth.add(flag, FLAG_COLORS[i % FLAG_COLORS.length], [p.x, p.y - 0.04, p.z + 0.02], { rot: [0.08, 0, slope + Math.sin(i * 2.3) * 0.06] });
  }
}

/** รูปค้างคาวแบน (กว้าง ~3 หน่วย) ปีกหยักเป็นลอน */
function batGeometry() {
  const right = [
    ['m', 0, 0.36], ['l', 0.12, 0.62], ['l', 0.22, 0.34],
    ['q', 0.75, 0.62, 1.5, 0.52],
    ['q', 1.24, 0.24, 1.18, 0.02], ['q', 1.0, 0.18, 0.82, -0.04], ['q', 0.64, 0.12, 0.46, -0.12], ['q', 0.3, -0.08, 0.16, -0.3],
    ['l', 0, -0.46],
  ];
  const shape = new THREE.Shape();
  for (const [op, ...v] of right) {
    if (op === 'm') shape.moveTo(v[0], v[1]);
    else if (op === 'l') shape.lineTo(v[0], v[1]);
    else shape.quadraticCurveTo(v[0], v[1], v[2], v[3]);
  }
  // ฝั่งซ้าย: สะท้อนจุดเดิมย้อนกลับ
  for (let i = right.length - 2; i >= 0; i--) {
    const [op, ...v] = right[i];
    const next = right[i + 1];
    if (next[0] === 'q') shape.quadraticCurveTo(-next[1], next[2], -v.at(-2), v.at(-1));
    else shape.lineTo(-v.at(-2), v.at(-1));
  }
  return new THREE.ShapeGeometry(shape, 6);
}

/** ค้างคาวกระดาษห้อยด้ายจากเพดาน แกว่งเบา ๆ (คนละ mesh เพื่อแกว่งแยกกัน — ใช้ geometry/วัสดุร่วม) */
function hangingBats(group, R) {
  const geo = batGeometry();
  geo.userData.shared = true;
  const mat = new THREE.MeshLambertMaterial({ color: '#2a1838', side: THREE.DoubleSide, fog: false });
  const threadMat = new THREE.LineBasicMaterial({ color: '#d8d0c0', transparent: true, opacity: 0.45, fog: false });
  const base = Math.max(R.W, 7.5);
  const spots = [
    [-(base + 2.2), R.h + 10.5, 0.9],
    [-(base + 4.6), R.h + 8, 0.7],
    [-(base + 1), R.h + 13.5, 0.6],
    [base + 2.4, R.h + 11, 0.85],
    [base + 4.8, R.h + 8.4, 0.65],
    [base + 1.6, R.h + 14, 0.55],
  ];
  spots.forEach(([x, y, s], i) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, CEIL, R.back + 4.5 + (i % 3) * 0.8);
    const drop = y - CEIL;
    const thread = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, drop + 0.5 * s, 0)]), threadMat);
    const bat = new THREE.Mesh(geo, mat);
    bat.position.y = drop;
    bat.scale.setScalar(s);
    const phase = i * 1.7;
    bat.onBeforeRender = () => {
      const t = performance.now() / 1000;
      pivot.rotation.z = Math.sin(t * 0.9 + phase) * 0.03;
      bat.rotation.y = Math.sin(t * 0.6 + phase) * 0.35;
    };
    pivot.add(thread, bat);
    group.add(pivot);
  });
}

// ── ประกอบ ─────────────────────────────────────────────────────

function buildHalloweenRoom({ w, d, h }) {
  const R = { W: w / 2, D: d / 2, h, back: -d / 2 - 16 };
  const camZ = R.D + 40;
  const P = { solid: new Parts(), glow: new Parts(), cloth: new Parts(), halo: new Parts({ uv: true }) };

  // บนโต๊ะ มุมหน้าซ้าย/ขวาของตู้ (กระปุกอาหารกับกระบองเพชรอยู่ด้านหลังซ้าย ทานตะวันอยู่ขวา)
  pumpkin(P, [-R.W - 2.1, TABLE_TOP, R.D + 2.3], 1.05, camZ);
  candle(P, [-R.W - 3.35, TABLE_TOP, R.D + 3.6], 1.3, camZ);
  candle(P, [-R.W - 1.0, TABLE_TOP, R.D + 4.1], 0.8, camZ);
  pumpkin(P, [R.W + 2.4, TABLE_TOP, R.D + 2.7], 0.85, camZ);
  candle(P, [R.W + 1.2, TABLE_TOP, R.D + 4], 1.0, camZ);
  // บนพื้นหน้ามุมตู้ไม้ (หน้าตู้ไม้อยู่ที่ R.D + 6.65)
  pumpkin(P, [-R.W - 5.4, FLOOR, R.D + 8.6], 2.3, camZ);
  pumpkin(P, [-R.W - 8.8, FLOOR, R.D + 10], 1.3, camZ);
  pumpkin(P, [R.W + 5.6, FLOOR, R.D + 8.8], 1.9, camZ);
  // ฟักทองจิ๋วบนชั้นวางเหนือตู้ (ข้างตุ๊กตาปลาทอง)
  pumpkin(P, [6.75, h + 6.25, R.back + 1.1], 0.5, camZ);
  bunting(P, R);

  const group = new THREE.Group();
  group.name = 'halloween';
  const add = (mesh) => {
    if (mesh) group.add(mesh);
    return mesh;
  };
  add(P.solid.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, fog: false })));
  add(P.cloth.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false })));
  add(P.glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
  const haloMat = new THREE.MeshBasicMaterial({
    map: getSoftGlowTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const halo = add(P.halo.mesh(haloMat));
  // แสงเทียนวูบวาบ
  if (halo) {
    halo.renderOrder = 1;
    halo.onBeforeRender = () => {
      const t = performance.now() / 1000;
      haloMat.opacity = 0.78 + 0.12 * Math.sin(t * 11) + 0.08 * Math.sin(t * 6.3 + 1.2) + 0.05 * Math.sin(t * 23);
    };
  }
  hangingBats(group, R);
  return group;
}

const build = Room.prototype.build;
Room.prototype.build = function buildWithHalloween(dims) {
  build.call(this, dims);
  this.group.add(buildHalloweenRoom(dims));
};

// โมดูลนี้โหลดแบบ dynamic — ถ้าเกมสร้างห้องไปก่อนแล้ว ให้สร้างใหม่อีกรอบพร้อมของตกแต่ง
const game = /** @type {any} */ (window).game;
if (game?.room && game.aquarium?.dims) game.room.build(game.aquarium.dims);
