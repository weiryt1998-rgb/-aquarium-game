import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Room } from '../world/Room.js';
import { getSoftGlowTexture } from '../render/textures.js';

/**
 * 🪷 ของตกแต่งลอยกระทงในห้องรอบตู้ (ชั่วคราว — โหลดจาก loykrathong.js เฉพาะช่วงเทศกาล)
 * กระทงใบตองบนโต๊ะ/พื้น/ชั้นวาง (ดอกบัว ดาวเรือง เทียน ธูป) · กระทงลอยบนผิวน้ำในตู้
 * ไฟประดับใต้ชั้นวาง · โคมล้านนาห้อยเพดานแกว่งเบา ๆ
 *
 * ไม่แก้ world/Room.js: ต่อท้าย Room.build() ให้ใส่ของเพิ่มเข้า room.group → ถูกล้างพร้อมห้องตอนเปลี่ยนตู้
 * ทำแบบเดียวกับห้อง: รูปทรงพื้นฐาน + vertex color รวมเป็น mesh ตามวัสดุ ไม่มีไฟเพิ่ม (แสงเทียนเป็นแผ่นเรืองแสง)
 */

const FLOOR = -9; // ตรงกับ world/Room.js
const TABLE_TOP = -0.32;
const CEIL = FLOOR + 52;

const LEAF_DARK = '#2f7a35';
const LEAF_LIGHT = '#58a64a';
const PETAL_BASE = new THREE.Color('#f8d0e0');
const PETAL_TIP = new THREE.Color('#d23a78');
const TRUNK_LOW = new THREE.Color('#8fa36a');
const TRUNK_TOP = new THREE.Color('#e6e3bd');
const BULB_COLORS = ['#ffd36b', '#ff9ec4', '#fff1c2', '#ffb347'];
const LANTERN_COLORS = ['#e8452c', '#ff9a2e', '#f2c14e', '#d8336b'];

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

/** หมุนให้แผ่นแสงเรืองหันไปทางกล้อง (กล้องอยู่ด้านหน้าตู้ทาง +z) */
const faceCamera = (x, z, camZ) => Math.atan2(-x, camZ - z);

/** วางชิ้นเป็นวงรอบแกนตั้ง: ชิ้น (สร้างที่จุดกำเนิด ปลายชี้ +y) เอนออกนอกวงด้วย tilt */
function ring(p, count, radius, y, offset, fn) {
  for (let i = 0; i < count; i++) {
    const a = offset + (i / count) * Math.PI * 2;
    p.place([Math.sin(a) * radius, y, Math.cos(a) * radius], a, (q) => fn(q, i));
  }
}

// ── กระทง ───────────────────────────────────────────────────────

/** กระทงใบตอง: ฐานหยวกกล้วย กลีบตองพับสองชั้น ดอกบัวตรงกลาง ดาวเรืองรอบ ๆ เทียน 1 เล่ม ธูป 3 ดอก (r = รัศมีฐาน) */
function krathong(P, [x, y, z], r, camZ) {
  const rotY = faceCamera(x, z, camZ);
  const baseH = r * 0.32;
  const candleH = r * 0.55;
  const candleTop = baseH + r * 0.12 + candleH;
  const incense = [
    [-0.16, 0.3, -0.22],
    [0, 0.34, -0.26],
    [0.16, 0.3, -0.22],
  ];

  P.solid.place([x, y, z], rotY, (p) => {
    p.add(new THREE.CylinderGeometry(r, r * 0.9, baseH, 28), (px, py, pz, c) => c.copy(TRUNK_LOW).lerp(TRUNK_TOP, py / baseH + 0.5), [0, baseH / 2, 0]);
    // กลีบตองชั้นนอก (ใหญ่ เข้ม) และชั้นใน (เล็ก อ่อน) สลับตำแหน่งกัน
    ring(p, 12, r * 0.86, baseH, 0, (q, i) =>
      q.add(new THREE.ConeGeometry(r * 0.2, r * 0.6, 4), i % 2 ? LEAF_DARK : '#286b2e', [0, r * 0.26, 0], { rot: [0.55, Math.PI / 4, 0], scale: [1, 1, 0.42] }),
    );
    ring(p, 8, r * 0.6, baseH, Math.PI / 8, (q) =>
      q.add(new THREE.ConeGeometry(r * 0.17, r * 0.5, 4), LEAF_LIGHT, [0, r * 0.22, 0], { rot: [0.3, Math.PI / 4, 0], scale: [1, 1, 0.42] }),
    );
    // ดาวเรืองระหว่างกลีบตองกับดอกบัว
    ring(p, 7, r * 0.42, baseH + r * 0.06, 0.3, (q, i) => q.add(new THREE.IcosahedronGeometry(r * 0.1, 1), i % 2 ? '#ffc21a' : '#ff8c12'));
    // ดอกบัว: กลีบนอก 6 กลีบบานออก กลีบใน 5 กลีบหุบ ไล่สีขาวที่โคนเป็นชมพูที่ปลาย
    // py ของทรงกลมก่อนยืดอยู่ในช่วง ±รัศมี → 0 ที่โคน 1 ที่ปลาย
    const petal = (rad) => (px, py, pz, c) => c.copy(PETAL_BASE).lerp(PETAL_TIP, ((py / rad + 1) / 2) ** 1.4);
    ring(p, 6, r * 0.2, baseH + r * 0.04, 0, (q) =>
      q.add(new THREE.SphereGeometry(r * 0.12, 10, 8), petal(r * 0.12), [0, r * 0.2, 0], { rot: [0.75, 0, 0], scale: [1, 2.2, 0.45] }),
    );
    ring(p, 5, r * 0.1, baseH + r * 0.06, 0.6, (q) =>
      q.add(new THREE.SphereGeometry(r * 0.1, 10, 8), petal(r * 0.1), [0, r * 0.18, 0], { rot: [0.32, 0, 0], scale: [1, 2.1, 0.45] }),
    );
    p.add(new THREE.CylinderGeometry(r * 0.065, r * 0.07, candleH, 12), '#f3ead2', [0, candleTop - candleH / 2, 0]);
    p.add(new THREE.CylinderGeometry(r * 0.012, r * 0.012, r * 0.08, 5), '#2a1d14', [0, candleTop + r * 0.04, 0]);
    for (const [ix, lean, iz] of incense) {
      p.add(new THREE.CylinderGeometry(r * 0.014, r * 0.014, r * 0.85, 5), '#8a3b1c', [ix * r, baseH + r * 0.5, iz * r], { rot: [-lean * 0.5, 0, -ix * 1.4] });
    }
  });

  P.glow.place([x, y, z], rotY, (p) => {
    p.add(new THREE.SphereGeometry(r * 0.06, 10, 8), '#ffb52a', [0, candleTop + r * 0.13, 0], { scale: [1, 2.3, 1] });
    p.add(new THREE.SphereGeometry(r * 0.03, 8, 6), '#fff6cc', [0, candleTop + r * 0.11, r * 0.02], { scale: [1, 2, 1] });
    for (const [ix, lean, iz] of incense) {
      // ปลายธูปตามมุมเอียงของก้าน (ก้านยาว 0.85r กลางก้านอยู่ที่ baseH + 0.5r)
      const half = r * 0.425;
      const tx = ix * r + Math.sin(ix * 1.4) * half;
      const ty = baseH + r * 0.5 + Math.cos(ix * 1.4) * Math.cos(lean * 0.5) * half;
      const tz = iz * r - Math.sin(lean * 0.5) * half;
      p.add(new THREE.SphereGeometry(r * 0.025, 6, 4), '#ff5a1f', [tx, ty, tz]);
    }
  });
  P.halo.place([x, y + candleTop + r * 0.13, z], rotY, (p) => p.add(new THREE.PlaneGeometry(r * 2.2, r * 2.2), '#b8641c', [0, 0, r * 0.4]));
  // แสงเทียนตกกระทบพื้นรอบกระทง
  P.halo.add(new THREE.PlaneGeometry(r * 4, r * 3.2), '#4a2808', [x, y + 0.04, z + r * 0.5], { rot: [-Math.PI / 2, 0, 0] });
}

// ── ไฟประดับ + โคมล้านนา ───────────────────────────────────────

/** ไฟประดับดวงเล็กหลากสี ขึงใต้ชั้นวางของเหนือตู้ (ตำแหน่งเดียวกับธงราวฮาโลวีนเดิม ไม่ชนชั้นหนังสือฝั่งซ้าย) */
function fairyLights(P, R) {
  const half = R.W + 4;
  const z = R.back + 2.5;
  // ชิดใต้ชั้นวาง (ขอบล่าง h + 5.75) ให้พ้นขอบบนตู้ในมุมกล้องหลัก
  const yEnd = R.h + 5.65;
  const sag = 0.7;
  const at = (t) => new THREE.Vector3(-half + 2 * half * t, yEnd - sag * 4 * t * (1 - t), z);
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 13 }, (_, i) => at(i / 12)));
  P.solid.add(new THREE.TubeGeometry(curve, 48, 0.035, 5), '#2c3a24');
  const count = Math.round(half / 0.7);
  for (let i = 1; i < count; i++) {
    const p = at(i / count);
    const color = BULB_COLORS[i % BULB_COLORS.length];
    P.glow.add(new THREE.SphereGeometry(0.13, 8, 6), color, [p.x, p.y - 0.16, p.z + 0.02], { scale: [1, 1.3, 1] });
    P.lights.add(new THREE.PlaneGeometry(1.1, 1.1), color, [p.x, p.y - 0.16, p.z + 0.2]);
  }
}

/** รูปทรงโคมล้านนา (ป่องกลาง) ยาว ~1.9 หน่วย ฐานที่ y = 0 */
const LANTERN_PROFILE = [
  [0.2, 0],
  [0.5, 0.18],
  [0.72, 0.58],
  [0.78, 0.95],
  [0.72, 1.32],
  [0.5, 1.72],
  [0.2, 1.9],
].map(([px, py]) => new THREE.Vector2(px, py));

/** โคมล้านนาห้อยด้ายจากเพดาน แกว่งเบา ๆ (คนละกลุ่มเพื่อแกว่งแยกกัน) ตัวโคมเรืองแสงเหมือนจุดไฟข้างใน */
function hangingLanterns(group, R, camZ) {
  const bodyMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const trimMat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false });
  const haloMat = new THREE.MeshBasicMaterial({
    map: getSoftGlowTexture(),
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });
  const threadMat = new THREE.LineBasicMaterial({ color: '#d8d0c0', transparent: true, opacity: 0.45, fog: false });
  const base = Math.max(R.W, 7.5);
  const spots = [
    [-(base + 2.2), R.h + 10.5, 1.15],
    [-(base + 4.8), R.h + 7.8, 0.9],
    [-(base + 1), R.h + 13.8, 0.8],
    [base + 2.4, R.h + 11, 1.1],
    [base + 5, R.h + 8.2, 0.85],
    [base + 1.6, R.h + 14.2, 0.75],
  ];
  spots.forEach(([x, y, s], i) => {
    const color = new THREE.Color(LANTERN_COLORS[i % LANTERN_COLORS.length]);
    const lit = color.clone().lerp(new THREE.Color('#fff1c8'), 0.35);
    const body = new Parts();
    // ซี่โครงโคม 12 ซี่: แถบมืดลงตามมุมรอบตัว + สว่างตรงกลางเหมือนแสงเทียนข้างใน
    body.add(new THREE.LatheGeometry(LANTERN_PROFILE, 24), (px, py, pz, c) => {
      const rib = Math.abs(Math.cos(6 * Math.atan2(pz, px))) ** 8;
      const mid = 1 - Math.abs(py - 0.95) / 0.95;
      return c.copy(color).lerp(lit, mid * 0.8).multiplyScalar(1 - rib * 0.35);
    });
    const trim = new Parts();
    trim.add(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 12), '#c9a24a', [0, 1.95, 0]);
    trim.add(new THREE.CylinderGeometry(0.24, 0.24, 0.14, 12), '#c9a24a', [0, -0.05, 0]);
    trim.add(new THREE.ConeGeometry(0.16, 0.9, 8), '#b81d3a', [0, -0.58, 0], { rot: [Math.PI, 0, 0] });
    trim.add(new THREE.SphereGeometry(0.08, 8, 6), '#e6c25a', [0, -0.14, 0]);
    const halo = new Parts({ uv: true });
    halo.place([0, 0.95, 0], faceCamera(x, R.back, camZ), (p) => p.add(new THREE.PlaneGeometry(4.2, 4.2), color, [0, 0, 0.9]));

    const pivot = new THREE.Group();
    pivot.position.set(x, CEIL, R.back + 4.5 + (i % 3) * 0.8);
    const drop = y - CEIL;
    const lantern = new THREE.Group();
    lantern.position.y = drop;
    lantern.scale.setScalar(s);
    const bodyMesh = body.mesh(bodyMat);
    const haloMesh = halo.mesh(haloMat);
    haloMesh.renderOrder = 1;
    lantern.add(bodyMesh, trim.mesh(trimMat), haloMesh);
    const thread = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, drop + 2 * s, 0)]), threadMat);
    const phase = i * 1.7;
    bodyMesh.onBeforeRender = () => {
      const t = performance.now() / 1000;
      pivot.rotation.z = Math.sin(t * 0.8 + phase) * 0.025;
      lantern.rotation.y = t * 0.15 + phase;
    };
    pivot.add(thread, lantern);
    group.add(pivot);
  });
}

// ── กระทงลอยบนผิวน้ำในตู้ ──────────────────────────────────────

const glowMaterial = () =>
  new THREE.MeshBasicMaterial({
    map: getSoftGlowTexture(),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  });

/** แสงเทียนวูบวาบ (ใช้กับแผ่นเรืองแสงของเทียน) */
const flicker = (t) => 0.78 + 0.12 * Math.sin(t * 11) + 0.08 * Math.sin(t * 6.3 + 1.2) + 0.05 * Math.sin(t * 23);

/**
 * กระทงลอยวนตามกระแสน้ำบนผิวน้ำในตู้ — ทุกใบอยู่บนวงรีเดียวกัน เว้นระยะเท่ากัน จึงไม่ชนกันและไม่ชนกระจก
 * จำนวน/ขนาดตามขนาดตู้ (ตู้เริ่มต้น 2 ใบ ตู้ใหญ่สุด 5 ใบ) · ฐานจมน้ำเล็กน้อย โยกขึ้นลงเบา ๆ
 */
function floatingKrathongs(group, { w, d, h, waterTop = h - 0.45 }) {
  const r = THREE.MathUtils.clamp(d * 0.1, 0.5, 0.85);
  const count = THREE.MathUtils.clamp(Math.round(w / 5), 2, 5);
  const A = w / 2 - r - 0.6;
  const B = d / 2 - r - 0.5;
  const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true, fog: false });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const haloMat = glowMaterial();
  for (let i = 0; i < count; i++) {
    const P = { solid: new Parts(), glow: new Parts(), halo: new Parts({ uv: true }) };
    krathong(P, [0, 0, 0], r, 1); // แผ่นแสงหันทาง +z (กล้อง) — กระทงจึงโยกได้แต่ไม่หมุนรอบตัวเอง
    const k = new THREE.Group();
    const solid = P.solid.mesh(solidMat);
    const halo = P.halo.mesh(haloMat);
    halo.renderOrder = 5; // หลังผิวน้ำ (renderOrder 4) ให้แสงเทียนเหนือน้ำไม่ถูกผิวน้ำทับ
    k.add(solid, P.glow.mesh(glowMat), halo);
    // ตำแหน่งคำนวณจากเวลาจริงทุกเฟรม — ไม่ตัดทิ้งนอกจอ ไม่งั้นใบที่ลอยกลับเข้าจอจะค้างอยู่ที่เดิมหนึ่งเฟรม
    for (const m of k.children) m.frustumCulled = false;
    const phase = (i / count) * Math.PI * 2;
    const bob = i * 1.37;
    solid.onBeforeRender = () => {
      const t = performance.now() / 1000;
      const a = phase + t * 0.035;
      k.position.set(A * Math.cos(a), waterTop - r * 0.12 + Math.sin(t * 1.4 + bob) * 0.03, B * Math.sin(a));
      k.rotation.set(Math.sin(t * 1.1 + bob) * 0.05, Math.sin(t * 0.3 + bob) * 0.25, Math.cos(t * 1.3 + bob) * 0.05);
      if (i === 0) haloMat.opacity = flicker(t);
    };
    group.add(k);
  }
}

// ── ประกอบ ─────────────────────────────────────────────────────

function buildLoyKrathongRoom(dims) {
  const { w, d, h } = dims;
  const R = { W: w / 2, D: d / 2, h, back: -d / 2 - 16 };
  const camZ = R.D + 40;
  const glowParts = () => new Parts({ uv: true });
  const P = { solid: new Parts(), glow: new Parts(), halo: glowParts(), lights: glowParts() };

  // บนโต๊ะ มุมหน้าซ้าย/ขวาของตู้ (กระปุกอาหารกับกระบองเพชรอยู่ด้านหลังซ้าย ทานตะวันอยู่ขวา)
  krathong(P, [-R.W - 2.2, TABLE_TOP, R.D + 2.4], 1.15, camZ);
  krathong(P, [R.W + 2.4, TABLE_TOP, R.D + 2.8], 0.95, camZ);
  // บนพื้นหน้ามุมตู้ไม้ (หน้าตู้ไม้อยู่ที่ R.D + 6.65)
  krathong(P, [-R.W - 5.6, FLOOR, R.D + 8.8], 2.3, camZ);
  krathong(P, [-R.W - 9.4, FLOOR, R.D + 10.4], 1.4, camZ);
  krathong(P, [R.W + 5.8, FLOOR, R.D + 9], 2, camZ);
  // กระทงจิ๋วบนชั้นวางเหนือตู้ (ข้างตุ๊กตาปลาทอง)
  krathong(P, [6.75, h + 6.25, R.back + 1.1], 0.55, camZ);
  fairyLights(P, R);

  const group = new THREE.Group();
  group.name = 'loykrathong';
  const add = (mesh) => {
    if (mesh) group.add(mesh);
    return mesh;
  };
  add(P.solid.mesh(new THREE.MeshLambertMaterial({ vertexColors: true, fog: false })));
  add(P.glow.mesh(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
  const halo = add(P.halo.mesh(glowMaterial()));
  if (halo) {
    halo.renderOrder = 1;
    halo.onBeforeRender = () => {
      halo.material.opacity = flicker(performance.now() / 1000);
    };
  }
  // ไฟประดับกระพริบช้า ๆ
  const lights = add(P.lights.mesh(glowMaterial()));
  if (lights) {
    lights.renderOrder = 1;
    lights.onBeforeRender = () => {
      lights.material.opacity = 0.6 + 0.25 * Math.sin(performance.now() / 700);
    };
  }
  hangingLanterns(group, R, camZ);
  floatingKrathongs(group, dims);
  return group;
}

const build = Room.prototype.build;
Room.prototype.build = function buildWithLoyKrathong(dims) {
  build.call(this, dims);
  this.group.add(buildLoyKrathongRoom(dims));
};

// โมดูลนี้โหลดแบบ dynamic — ถ้าเกมสร้างห้องไปก่อนแล้ว ให้สร้างใหม่อีกรอบพร้อมของตกแต่ง
const game = /** @type {any} */ (window).game;
if (game?.room && game.aquarium?.dims) game.room.build(game.aquarium.dims);
