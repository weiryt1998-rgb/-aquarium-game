import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { getFloorTexture, getSoftGlowTexture, getWindowSkyTexture, getWoodTexture } from '../render/textures.js';
import { disposeObject } from '../assets/AssetLoader.js';
import { seededRandom, smoothstep } from '../utils/math.js';

/**
 * ฉากรอบตู้: ห้องนั่งเล่น — โต๊ะวางตู้พร้อมตู้ไม้ด้านล่าง ผนัง 3 ด้าน พื้นไม้ ชั้นหนังสือ โคมไฟตั้งพื้น ต้นไม้ในกระถาง
 * ชั้นวางของและกรอบรูปเหนือตู้ หน้าต่างผ้าม่าน (ผนังซ้าย) ตู้เตี้ยกับรูปภาพ (ผนังขวา) พรม
 *
 * ทำให้เบาที่สุด: ไม่มีไฟล์โมเดล ไม่มีไฟเพิ่ม ไม่ทำเงา และไม่โดนหมอกใต้น้ำ (fog: false)
 * เฟอร์นิเจอร์ทุกชิ้นสร้างจากรูปทรงพื้นฐาน ทาสีด้วย vertex color แล้วรวมเป็น mesh เดียวตามวัสดุ
 * → ทั้งห้องใช้ราว 7 draw call ไม่ว่าจะมีของกี่ชิ้น
 *
 * หน่วยเดียวกับตู้ (ตู้เริ่มต้นกว้าง 12 ≈ 60 ซม. → 1 หน่วย ≈ 5 ซม.) ตู้วางที่จุดกำเนิด ก้นตู้ที่ y = 0
 */

const FLOOR = -9;
const TABLE_TOP = -0.32;
const TABLE_THICK = 0.7;
const ROOM_H = 52;
/** ห้องยาวไปทางด้านหน้า (ด้านหลังกล้อง) — ไม่มีผนังด้านหน้าเพราะกล้องหันไปทางนั้นไม่ได้ */
const ROOM_DEPTH = 150;
/** ขนาดลายพื้นไม้ 1 แผ่นภาพ (หน่วยเกม) */
const FLOOR_TILE = 12;

const COLORS = {
  wallLow: '#3e5878',
  wallHigh: '#6a8bb2',
  ceiling: '#4a6589',
  trim: '#e4ddd0',
  cabinet: '#6e4a2e',
  cabinetDark: '#3c2718',
  seam: '#2a1a0f',
  brass: '#a8843f',
  metal: '#2b2d31',
  shelf: '#7a5434',
  shelfBack: '#4f3420',
  white: '#ece6dc',
  pot: '#d9d1c3',
  terracotta: '#b9683f',
  soil: '#3a2a1e',
  leaves: ['#3f7d3c', '#4f9446', '#2f6a35', '#5aa250'],
  books: ['#8c3b32', '#2f5d7c', '#d7b46a', '#3f6b4a', '#e6dccb', '#6b4f7a', '#b9643a', '#24384f', '#c8a27a'],
  curtain: '#d7c6a4',
  rug: '#b8a07e',
  rugBorder: '#7c5a3d',
  frame: '#3a2a20',
  lampShade: '#ffd9a0',
};

// ── รวมชิ้นส่วนเป็น mesh เดียว ──────────────────────────────────

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

/** ชิ้นส่วนหลายชิ้นที่ทาสีด้วย vertex color แล้วรวมเป็น mesh เดียว (1 draw call) */
class Batch {
  /** @param {{ uv?: boolean }} options uv = เก็บพิกัด texture ไว้ (ชิ้นที่ใช้ map) */
  constructor({ uv = false } = {}) {
    this.uv = uv;
    this.geos = [];
  }

  /**
   * @param {THREE.BufferGeometry} geo
   * @param {string | THREE.Color | ((x: number, y: number, z: number, out: THREE.Color) => THREE.Color)} color สีทั้งชิ้น หรือฟังก์ชันทาสีทีละจุด (ตำแหน่งหลังย้ายแล้ว)
   * @param {number[]} pos ตำแหน่ง
   * @param {{ rot?: number[] | THREE.Quaternion, scale?: number[] }} options rot = มุม Euler หรือ Quaternion
   */
  add(geo, color, [x, y, z], { rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    if (g !== geo) geo.dispose();
    if (!this.uv) g.deleteAttribute('uv');
    const q = rot.isQuaternion ? rot : _q.setFromEuler(_e.set(rot[0], rot[1], rot[2]));
    g.applyMatrix4(_m.compose(_p.set(x, y, z), q, _s.set(scale[0], scale[1], scale[2])));
    const pos = g.attributes.position;
    const col = new Float32Array(pos.count * 3);
    if (typeof color !== 'function') _c.set(color);
    for (let i = 0; i < pos.count; i++) {
      const c = typeof color === 'function' ? color(pos.getX(i), pos.getY(i), pos.getZ(i), _c) : _c;
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geos.push(g);
    return this;
  }

  box(size, color, pos, options) {
    return this.add(new THREE.BoxGeometry(size[0], size[1], size[2]), color, pos, options);
  }

  /** สร้างชิ้นส่วนในพิกัดของตัวเอง (fn) แล้วย้ายทั้งชุดไปวางที่ pos หมุนรอบแกนตั้ง rotY — ใช้กับของบนผนังด้านข้าง */
  place(pos, rotY, fn) {
    const local = new Batch({ uv: this.uv });
    fn(local);
    _m.compose(_p.set(pos[0], pos[1], pos[2]), _q.setFromAxisAngle(UP, rotY), _s.set(1, 1, 1));
    for (const g of local.geos) this.geos.push(g.applyMatrix4(_m));
    return this;
  }

  build(material) {
    if (!this.geos.length) return null;
    const geo = mergeGeometries(this.geos);
    for (const g of this.geos) g.dispose();
    this.geos = [];
    return new THREE.Mesh(geo, material);
  }
}

/** ทิศจากแกนตั้ง → dir (หมุนทรงกระบอกให้ชี้ไปตามก้าน) */
const alongDir = (dir) => new THREE.Quaternion().setFromUnitVectors(UP, dir);

// ── ห้อง ───────────────────────────────────────────────────────

export class Room {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  build(dims) {
    this.clear();
    const { w, d, h } = dims;

    // โต๊ะ
    const tableW = w + 8;
    const tableD = d + 9; // ลึกพอให้มุมกล้องของตู้ใหญ่ไม่เห็นขอบโต๊ะด้านหน้า
    const tableZ = 2.85;
    const wood = getWoodTexture();
    wood.repeat.set(tableW / 9, 1);
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(tableW, TABLE_THICK, tableD),
      new THREE.MeshStandardMaterial({ map: wood, roughness: 0.5, metalness: 0.05, fog: false }),
    );
    table.position.set(0, TABLE_TOP - TABLE_THICK / 2, tableZ);
    table.receiveShadow = true;
    this.group.add(table);

    const R = {
      W: w / 2,
      D: d / 2,
      h,
      back: -d / 2 - 16,
      side: w / 2 + 22,
      ceil: FLOOR + ROOM_H,
      table: { w: tableW, d: tableD, z: tableZ, bottom: TABLE_TOP - TABLE_THICK },
    };
    const rnd = seededRandom(0.271);
    const shell = new Batch();
    const solid = new Batch();
    const glow = new Batch();
    const halo = new Batch({ uv: true });

    buildShell(shell, solid, R);
    buildCabinet(solid, R);
    buildRug(solid, R);
    buildDeskItems(solid, R);
    buildBookshelf(solid, -R.W - 10, R.back + 1.7, rnd);
    buildSnakePlant(solid, R.W + 9.5, R.back + 4.5, rnd);
    buildFloorLamp(solid, glow, halo, R.W + 13.5, R.back + 3.5, R);
    buildWallShelf(solid, R, rnd);
    buildWindow(solid, halo, R);
    buildSideboard(solid, R, rnd);
    // แสงจากตู้ปลาเรืองบนผนังด้านหลัง
    halo.add(new THREE.PlaneGeometry(w * 2.6, h * 3), '#1f5578', [0, h * 0.55, R.back + 0.08]);

    const add = (mesh) => mesh && this.group.add(mesh);
    add(shell.build(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false })));
    add(solid.build(new THREE.MeshLambertMaterial({ vertexColors: true, fog: false })));
    add(glow.build(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide })));
    add(
      halo.build(
        new THREE.MeshBasicMaterial({ map: getSoftGlowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
      ),
    );
    add(buildFloor(R));
    add(buildWindowSky(R));
  }

  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeObject(child);
    }
  }
}

// ── ผนัง พื้น เพดาน ────────────────────────────────────────────

const WALL_LOW = new THREE.Color(COLORS.wallLow);
const WALL_HIGH = new THREE.Color(COLORS.wallHigh);

/** สีผนัง: สว่างช่วงกลาง มืดลงใกล้พื้น ใต้เพดาน และตามมุมห้อง (corner = 0 กลางผนัง → 1 มุมห้อง) */
function wallColor(out, y, corner) {
  const t = (y - FLOOR) / ROOM_H;
  out.copy(WALL_LOW).lerp(WALL_HIGH, smoothstep(0, 0.45, t));
  return out.multiplyScalar(1 - 0.35 * smoothstep(0.35, 1, corner) - 0.25 * smoothstep(0.6, 1, t));
}

function buildShell(shell, solid, R) {
  const midY = FLOOR + ROOM_H / 2;
  const midZ = R.back + ROOM_DEPTH / 2;
  shell.add(new THREE.PlaneGeometry(R.side * 2, ROOM_H, 24, 12), (x, y, z, c) => wallColor(c, y, Math.abs(x) / R.side), [0, midY, R.back]);
  for (const s of [-1, 1]) {
    // ผนังด้านข้าง: มืดลงที่มุมด้านหลัง และค่อย ๆ มืดเมื่อห่างออกมาทางกล้อง
    const corner = (z) => Math.max(1 - (z - R.back) / 30, (z - R.back - 50) / 60);
    shell.add(new THREE.PlaneGeometry(ROOM_DEPTH, ROOM_H, 24, 12), (x, y, z, c) => wallColor(c, y, corner(z)).multiplyScalar(0.88), [s * R.side, midY, midZ], {
      rot: [0, -s * (Math.PI / 2), 0],
    });
  }
  shell.add(new THREE.PlaneGeometry(R.side * 2, ROOM_DEPTH), COLORS.ceiling, [0, R.ceil, midZ], { rot: [Math.PI / 2, 0, 0] });
  // บัวเชิงผนัง
  solid.box([R.side * 2, 1.4, 0.35], COLORS.trim, [0, FLOOR + 0.7, R.back + 0.17]);
  for (const s of [-1, 1]) solid.box([0.35, 1.4, ROOM_DEPTH], COLORS.trim, [s * (R.side - 0.17), FLOOR + 0.7, midZ]);
}

/** พื้นไม้: ลายกระดานตามขนาดจริง (ไม่ยืดตามขนาดห้อง) มืดลงตามมุมห้องและไกลออกไป */
function buildFloor(R) {
  const width = R.side * 2;
  const geo = new THREE.PlaneGeometry(width, ROOM_DEPTH, 16, 24);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * width) / FLOOR_TILE, (uv.getY(i) * ROOM_DEPTH) / FLOOR_TILE);
  geo.rotateX(-Math.PI / 2);
  geo.translate(0, FLOOR, R.back + ROOM_DEPTH / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const edge = Math.abs(pos.getX(i)) / R.side;
    const back = 1 - (pos.getZ(i) - R.back) / 25;
    const k = 0.95 - 0.35 * smoothstep(0.5, 1, edge) - 0.3 * smoothstep(0, 1, back);
    col.fill(k, i * 3, i * 3 + 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: getFloorTexture(), vertexColors: true, fog: false }));
}

// ── เฟอร์นิเจอร์ ───────────────────────────────────────────────

/** ตู้ไม้ใต้โต๊ะวางตู้ปลา: บานประตู ลิ้นชักด้านบน มือจับทองเหลือง ฐานเว้าเข้าไป */
function buildCabinet(b, R) {
  const t = R.table;
  const half = t.w / 2 - 0.6;
  const front = t.z + t.d / 2 - 0.7;
  const rear = t.z - t.d / 2 + 0.6;
  const top = t.bottom;
  const base = FLOOR + 0.9;
  const midY = (top + base) / 2;
  b.box([half * 2, top - base, front - rear], COLORS.cabinet, [0, midY, (front + rear) / 2]);
  b.box([half * 2 - 1, 0.9, front - rear - 1], COLORS.cabinetDark, [0, FLOOR + 0.45, (front + rear) / 2]);
  const doors = Math.max(2, Math.round((half * 2) / 7));
  const dw = (half * 2) / doors;
  const drawerY = top - 1.5;
  b.box([half * 2 - 0.5, 0.12, 0.06], COLORS.seam, [0, drawerY, front + 0.03]);
  for (let i = 0; i < doors; i++) {
    const cx = -half + (i + 0.5) * dw;
    if (i > 0) b.box([0.12, top - base - 0.5, 0.06], COLORS.seam, [-half + i * dw, midY, front + 0.03]);
    b.box([1.6, 0.22, 0.22], COLORS.brass, [cx, (top + drawerY) / 2, front + 0.11]);
    // ปุ่มจับบานประตูอยู่ฝั่งที่ชิดบานคู่กัน
    const inner = i % 2 === 0 ? 1 : -1;
    b.box([0.22, 1.4, 0.22], COLORS.brass, [cx + inner * dw * 0.38, (drawerY + base) / 2 + 0.6, front + 0.11]);
  }
}

function buildRug(b, R) {
  const t = R.table;
  const front = t.z + t.d / 2;
  const width = t.w + 10;
  b.box([width, 0.08, 16], COLORS.rugBorder, [0, FLOOR + 0.04, front + 6]);
  b.box([width - 1.6, 0.1, 14.4], COLORS.rug, [0, FLOOR + 0.06, front + 6]);
}

/** ของเล็ก ๆ บนโต๊ะข้างตู้: กระปุกอาหารปลา (ขวา) กระบองเพชรจิ๋ว (ซ้าย) */
function buildDeskItems(b, R) {
  const y = TABLE_TOP;
  const fx = R.W + 1.9;
  const fz = -R.D * 0.4;
  b.add(new THREE.CylinderGeometry(0.4, 0.4, 1.05, 16), '#f1b13b', [fx, y + 0.53, fz]);
  b.add(new THREE.CylinderGeometry(0.41, 0.41, 0.34, 16), '#2f6fa0', [fx, y + 0.55, fz]);
  b.add(new THREE.CylinderGeometry(0.44, 0.44, 0.24, 16), '#d64532', [fx, y + 1.16, fz]);
  const cx = -R.W - 2;
  const cz = -R.D * 0.2;
  b.add(new THREE.CylinderGeometry(0.45, 0.35, 0.62, 14), COLORS.pot, [cx, y + 0.31, cz]);
  b.add(new THREE.SphereGeometry(0.29, 10, 8), '#4f9446', [cx, y + 0.92, cz], { scale: [1, 1.9, 1] });
  b.add(new THREE.SphereGeometry(0.15, 8, 6), '#5aa250', [cx + 0.31, y + 1.02, cz], { scale: [1, 1.8, 1], rot: [0, 0, -0.5] });
}

/** ชั้นหนังสือชิดผนังหลัง: 5 ช่อง หนังสือสุ่มสี/ขนาด บางช่องมีแจกันหรือหนังสือวางซ้อน */
function buildBookshelf(b, x, z, rnd) {
  const W = 9.5;
  const D = 3.2;
  const H = 34;
  const t = 0.45;
  const plinth = 1.2;
  b.box([W, plinth, D], COLORS.shelfBack, [x, FLOOR + plinth / 2, z]);
  for (const s of [-1, 1]) b.box([t, H, D], COLORS.shelf, [x + s * (W / 2 - t / 2), FLOOR + H / 2, z]);
  b.box([W, t, D], COLORS.shelf, [x, FLOOR + H - t / 2, z]);
  b.box([W - 2 * t, H - plinth - t, 0.2], COLORS.shelfBack, [x, FLOOR + plinth + (H - plinth - t) / 2, z - D / 2 + 0.1]);
  const inner = W - 2 * t;
  const rows = 5;
  const gap = (H - plinth - t) / rows;
  for (let k = 0; k < rows; k++) {
    const y0 = FLOOR + plinth + k * gap + (k > 0 ? 0.18 : 0);
    if (k > 0) b.box([inner, 0.36, D - 0.2], COLORS.shelf, [x, FLOOR + plinth + k * gap, z + 0.05]);
    // หนังสือเรียงจากซ้าย เว้นที่ด้านขวาไว้วางของ
    let bx = x - inner / 2 + 0.15;
    const end = x + inner / 2 - (rnd() < 0.6 ? 2.6 : 0.3);
    while (bx < end - 0.5) {
      const bw = 0.42 + rnd() * 0.5;
      const bh = gap * (0.55 + rnd() * 0.3);
      const color = new THREE.Color(COLORS.books[Math.floor(rnd() * COLORS.books.length)]).multiplyScalar(0.85 + rnd() * 0.3);
      b.box([bw, bh, D * 0.72], color, [bx + bw / 2, y0 + bh / 2, z + 0.2]);
      bx += bw + (rnd() < 0.1 ? 0.3 : 0.02);
    }
    if (end < x + inner / 2 - 1) {
      const ox = (end + x + inner / 2) / 2;
      if (rnd() < 0.5) {
        b.add(new THREE.CylinderGeometry(0.55, 0.75, 2.4, 14), rnd() < 0.5 ? '#e4ddd0' : '#3f7fa6', [ox, y0 + 1.2, z + 0.3]);
      } else {
        for (let i = 0; i < 3; i++) b.box([1.9 - i * 0.2, 0.4, 2.2], COLORS.books[Math.floor(rnd() * COLORS.books.length)], [ox, y0 + 0.2 + i * 0.4, z + 0.3]);
      }
    }
  }
  // ต้นไม้เล็กบนชั้น
  buildPlant(b, x + 2.5, z, 0.35, rnd, FLOOR + H);
}

/** ต้นไม้ในกระถาง: พุ่มใบรูปไข่บนก้านสั้นยาวสลับกันที่แผ่ออกรอบกระถาง  scale 1 ≈ สูง 1 ม. */
function buildPlant(b, x, z, s, rnd, y = FLOOR) {
  b.add(new THREE.CylinderGeometry(2 * s, 1.55 * s, 4 * s, 18), s > 0.5 ? COLORS.terracotta : COLORS.pot, [x, y + 2 * s, z]);
  b.add(new THREE.CylinderGeometry(1.85 * s, 1.85 * s, 0.2 * s, 18), COLORS.soil, [x, y + 3.9 * s, z]);
  const n = s > 0.5 ? 16 : 8;
  const base = new THREE.Vector3(x, y + 3.9 * s, z);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 * 2.3 + rnd() * 0.8; // วนรอบ 2 ชั้น ใบไม่เรียงเป็นวงเดียว
    const tilt = 0.15 + rnd() * 0.75;
    const len = (3 + rnd() * 9) * s;
    const dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(a), Math.cos(tilt), Math.sin(tilt) * Math.sin(a));
    const mid = base.clone().addScaledVector(dir, len / 2);
    b.add(new THREE.CylinderGeometry(0.07 * s + 0.03, 0.12 * s + 0.03, len, 5), '#4d7a3a', [mid.x, mid.y, mid.z], { rot: alongDir(dir) });
    // ใบ: แกนยาวชี้ออกจากกระถาง ใบล่าง ๆ ห้อยลงมากกว่า
    const pitch = 0.35 - tilt * 0.9 + (rnd() - 0.5) * 0.4;
    const leafDir = new THREE.Vector3(Math.cos(a) * Math.cos(pitch), Math.sin(pitch), Math.sin(a) * Math.cos(pitch));
    const size = (1.8 + rnd() * 1.4) * s;
    const tip = base.clone().addScaledVector(dir, len).addScaledVector(leafDir, size * 0.8);
    // บิดใบรอบแกนยาวเล็กน้อย ใบจะได้ไม่แบนราบเป็นแผ่นเดียวกันหมด
    const rot = new THREE.Quaternion().setFromUnitVectors(X_AXIS, leafDir).multiply(new THREE.Quaternion().setFromAxisAngle(X_AXIS, (rnd() - 0.5) * 1.4));
    b.add(new THREE.SphereGeometry(1, 16, 6), COLORS.leaves[Math.floor(rnd() * COLORS.leaves.length)], [tip.x, tip.y, tip.z], {
      rot,
      scale: [size, 0.16 * s + 0.05, size * 0.5],
    });
  }
}

/** ต้นลิ้นมังกรในกระถางตั้งพื้น: ใบยาวปลายแหลมตั้งขึ้นเป็นกอ (สูงราว 1 ม.) */
function buildSnakePlant(b, x, z, rnd) {
  b.add(new THREE.CylinderGeometry(2.1, 1.6, 4.4, 20), COLORS.terracotta, [x, FLOOR + 2.2, z]);
  b.add(new THREE.CylinderGeometry(2.25, 2.25, 0.4, 20), '#a95d38', [x, FLOOR + 4.3, z]);
  b.add(new THREE.CylinderGeometry(1.95, 1.95, 0.2, 20), COLORS.soil, [x, FLOOR + 4.4, z]);
  const greens = ['#2f6a35', '#3f7d3c', '#4b8a42', '#365f2e'];
  for (let i = 0; i < 15; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 1.3;
    const len = 9 + rnd() * 9 - r * 2;
    const lean = 0.05 + (r / 1.3) * 0.3 + rnd() * 0.1; // ใบรอบนอกเอนออกมากกว่า
    const dir = new THREE.Vector3(Math.sin(lean) * Math.cos(a), Math.cos(lean), Math.sin(lean) * Math.sin(a));
    const base = new THREE.Vector3(x + Math.cos(a) * r, FLOOR + 4.4, z + Math.sin(a) * r);
    const mid = base.addScaledVector(dir, len / 2);
    // หน้าใบหันตามแนวรัศมี + บิดเล็กน้อย
    const rot = alongDir(dir).multiply(new THREE.Quaternion().setFromAxisAngle(UP, -a + (rnd() - 0.5) * 0.8));
    b.add(new THREE.ConeGeometry(1, len, 4, 3), greens[i % greens.length], [mid.x, mid.y, mid.z], { rot, scale: [0.55 + rnd() * 0.25, 1, 0.12] });
  }
}

/** โคมไฟตั้งพื้น: โป๊ะเรืองแสง (glow) + แสงตกบนผนังด้านหลังและพื้น (halo) */
function buildFloorLamp(solid, glow, halo, x, z, R) {
  solid.add(new THREE.CylinderGeometry(1.5, 1.7, 0.35, 20), COLORS.metal, [x, FLOOR + 0.18, z]);
  solid.add(new THREE.CylinderGeometry(0.14, 0.14, 27, 8), COLORS.brass, [x, FLOOR + 13.8, z]);
  const shadeY = FLOOR + 29.5;
  glow.add(new THREE.CylinderGeometry(1.8, 2.9, 4.2, 24, 1, true), (px, py, pz, c) => c.set(COLORS.lampShade).multiplyScalar(0.8 + 0.3 * (1 - (py - shadeY + 2.1) / 4.2)), [x, shadeY, z]);
  halo.add(new THREE.PlaneGeometry(30, 30), '#d8782e', [x, shadeY - 2, R.back + 0.1]);
  halo.add(new THREE.PlaneGeometry(16, 16), '#8a4a1c', [x, FLOOR + 0.12, z + 1], { rot: [-Math.PI / 2, 0, 0] });
}

/** ชั้นวางของติดผนังเหนือตู้ + กรอบรูป 2 ภาพ (เห็นชัดตอนเล่นบนมือถือแนวตั้ง) */
function buildWallShelf(b, R, rnd) {
  const y = R.h + 6;
  const z = R.back;
  const W = 15;
  b.box([W, 0.5, 2.2], COLORS.white, [0, y, z + 1.1]);
  for (const s of [-1, 1]) b.box([0.35, 1.6, 1.6], '#d6cfc2', [s * (W / 2 - 1.5), y - 1, z + 0.8]);
  const top = y + 0.25;
  // หนังสือตั้ง
  let bx = -W / 2 + 0.6;
  for (let i = 0; i < 6; i++) {
    const bw = 0.4 + rnd() * 0.3;
    const bh = 2 + rnd() * 1;
    b.box([bw, bh, 1.6], COLORS.books[(i * 4) % COLORS.books.length], [bx + bw / 2, top + bh / 2, z + 1.1]);
    bx += bw + 0.03;
  }
  // กระถางไม้อวบน้ำ
  b.add(new THREE.CylinderGeometry(0.75, 0.6, 1.2, 14), COLORS.pot, [-1.5, top + 0.6, z + 1.1]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    b.add(new THREE.SphereGeometry(0.32, 8, 6), COLORS.leaves[i % 4], [-1.5 + Math.cos(a) * 0.35, top + 1.4, z + 1.1 + Math.sin(a) * 0.35], { scale: [1, 1.5, 1], rot: [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5] });
  }
  // กระบองเพชร
  b.add(new THREE.CylinderGeometry(0.6, 0.5, 1, 14), COLORS.terracotta, [2.2, top + 0.5, z + 1.1]);
  b.add(new THREE.CapsuleGeometry(0.32, 1.4, 4, 10), '#4f9446', [2.2, top + 1.9, z + 1.1]);
  b.add(new THREE.CapsuleGeometry(0.16, 0.5, 3, 8), '#5aa250', [2.65, top + 2.1, z + 1.1], { rot: [0, 0, -0.6] });
  // ตุ๊กตาปลาทอง
  b.add(new THREE.SphereGeometry(0.55, 14, 10), '#f08a2c', [5.2, top + 0.6, z + 1.1], { scale: [1.3, 1, 0.8] });
  b.add(new THREE.ConeGeometry(0.45, 0.7, 10), '#f6a64a', [4.2, top + 0.6, z + 1.1], { rot: [0, 0, Math.PI / 2] });
  // กรอบรูป
  buildPicture(b, [-3.6, y + 7, z], 6, 7.5, (art) => {
    art.box([5, 6.5, 0.05], '#d7e8ee', [0, 0, 0]);
    art.box([5, 1.6, 0.06], '#3b7ea1', [0, -2.45, 0.01]);
    art.box([5, 0.9, 0.07], '#6aaccb', [0, -1.3, 0.02]);
    art.add(new THREE.CircleGeometry(0.7, 16), '#ee8a3a', [0.4, 0.9, 0.04], { scale: [1.4, 0.9, 1] });
    art.add(new THREE.CircleGeometry(0.45, 3), '#ee8a3a', [-0.75, 0.9, 0.04], { rot: [0, 0, Math.PI] });
  });
  buildPicture(b, [4.4, y + 6.2, z], 8, 5.6, (art) => {
    art.box([7, 4.6, 0.05], '#f1dcc0', [0, 0, 0]);
    art.add(new THREE.CircleGeometry(1, 20), '#e9885a', [1.6, 0.6, 0.02]);
    art.add(new THREE.CircleGeometry(2.1, 20, 0, Math.PI), '#7a9b6e', [-1.4, -2.3, 0.03], { scale: [1, 0.8, 1] });
    art.add(new THREE.CircleGeometry(2, 20, 0, Math.PI), '#5a7d58', [1.45, -2.3, 0.04], { scale: [1, 0.6, 1] });
  });
}

/** กรอบรูปติดผนัง (หันหน้าไปทาง +z) — art = ฟังก์ชันวาดภาพในกรอบ (พิกัดกลางภาพ) */
function buildPicture(b, [x, y, z], w, h, art) {
  b.place([x, y, z], 0, (p) => {
    const t = 0.45;
    for (const s of [-1, 1]) {
      p.box([w, t, 0.5], COLORS.frame, [0, s * (h / 2 - t / 2), 0.25]);
      p.box([t, h, 0.5], COLORS.frame, [s * (w / 2 - t / 2), 0, 0.25]);
    }
    p.box([w - 2 * t, h - 2 * t, 0.1], COLORS.white, [0, 0, 0.1]);
    p.place([0, 0, 0.2], 0, art);
  });
}

/** หน้าต่างบนผนังซ้าย: วงกบ ไม้คั่น ขอบหน้าต่าง ผ้าม่านพับจีบ ราวม่าน + แสงจากหน้าต่าง */
const WINDOW = { w: 16, h: 20, y: 15, z: 22 };

function buildWindow(solid, halo, R) {
  const { w, h, y } = WINDOW;
  solid.place([-R.side, y, R.back + WINDOW.z], Math.PI / 2, (p) => {
    const t = 0.8;
    for (const s of [-1, 1]) {
      p.box([w + 2 * t, t, 0.6], COLORS.white, [0, s * (h / 2 + t / 2), 0.3]);
      p.box([t, h, 0.6], COLORS.white, [s * (w / 2 + t / 2), 0, 0.3]);
    }
    p.box([0.3, h, 0.3], COLORS.white, [0, 0, 0.2]);
    p.box([w, 0.3, 0.3], COLORS.white, [0, h * 0.18, 0.2]);
    p.box([w + 3, 0.5, 1.8], COLORS.white, [0, -h / 2 - 0.8, 0.9]);
    // ผ้าม่าน 2 ข้าง ห้อยจากราวม่านถึงพื้น
    const rodY = h / 2 + 3;
    const ch = rodY - (FLOOR - y) - 1;
    for (const s of [-1, 1]) p.add(curtainGeometry(6, ch, 5), COLORS.curtain, [s * (w / 2 + 2.6), rodY - ch / 2, 1.3]);
    p.add(new THREE.CylinderGeometry(0.18, 0.18, w + 14, 8), COLORS.brass, [0, rodY + 0.3, 1.4], { rot: [0, 0, Math.PI / 2] });
  });
  halo.place([-R.side + 0.1, y, R.back + WINDOW.z], Math.PI / 2, (p) => p.add(new THREE.PlaneGeometry(38, 38), '#5c7a96', [0, 0, 0]));
}

/** ท้องฟ้าในหน้าต่าง (ใช้ texture แยก จึงไม่รวมกับชิ้นอื่น) */
function buildWindowSky(R) {
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW.w, WINDOW.h), new THREE.MeshBasicMaterial({ map: getWindowSkyTexture(), fog: false }));
  sky.position.set(-R.side + 0.05, WINDOW.y, R.back + WINDOW.z);
  sky.rotation.y = Math.PI / 2;
  return sky;
}

/** ผ้าม่านพับจีบ: แผ่นระนาบที่โค้งเป็นคลื่นตามแนวกว้าง */
function curtainGeometry(width, height, folds) {
  const geo = new THREE.PlaneGeometry(width, height, folds * 6, 1);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) / width + 0.5) * folds * Math.PI * 2) * 0.45);
  geo.computeVertexNormals();
  return geo;
}

/** ตู้เตี้ยชิดผนังขวา + แจกันกิ่งไม้ + รูปภาพเหนือตู้ */
function buildSideboard(b, R, rnd) {
  const z = R.back + 20;
  b.place([R.side, FLOOR, z], -Math.PI / 2, (p) => {
    const len = 14;
    const dep = 3.4;
    const hgt = 7.5;
    p.box([len, hgt - 1, dep], COLORS.cabinet, [0, 1 + (hgt - 1) / 2, dep / 2]);
    for (const sx of [-1, 1]) for (const sz of [0.4, dep - 0.4]) p.box([0.35, 1, 0.35], COLORS.cabinetDark, [sx * (len / 2 - 0.6), 0.5, sz]);
    for (let i = 1; i < 3; i++) p.box([0.12, hgt - 1.6, 0.06], COLORS.seam, [-len / 2 + (i * len) / 3, 1 + (hgt - 1) / 2, dep + 0.03]);
    for (let i = 0; i < 3; i++) p.box([1.4, 0.2, 0.2], COLORS.brass, [-len / 2 + ((i + 0.5) * len) / 3, hgt - 1.2, dep + 0.1]);
    // แจกันกิ่งไม้
    p.add(new THREE.CylinderGeometry(0.55, 0.85, 3.2, 14), '#3f7fa6', [-3.5, hgt + 1.6, dep / 2]);
    for (let i = 0; i < 5; i++) {
      const dir = new THREE.Vector3((rnd() - 0.5) * 0.8, 1, (rnd() - 0.5) * 0.5).normalize();
      const len2 = 4 + rnd() * 3;
      const base = new THREE.Vector3(-3.5, hgt + 3, dep / 2);
      const mid = base.clone().addScaledVector(dir, len2 / 2);
      p.add(new THREE.CylinderGeometry(0.05, 0.08, len2, 5), '#5b4030', [mid.x, mid.y, mid.z], { rot: alongDir(dir) });
      const tip = base.clone().addScaledVector(dir, len2);
      p.add(new THREE.SphereGeometry(0.45, 8, 6), '#e9a7b8', [tip.x, tip.y, tip.z]);
    }
    // หนังสือวางซ้อน + กล่อง
    for (let i = 0; i < 3; i++) p.box([2.6 - i * 0.3, 0.45, 2], COLORS.books[(i * 3 + 1) % COLORS.books.length], [2.5, hgt + 0.22 + i * 0.45, dep / 2]);
    p.box([1.6, 1.6, 1.6], '#d9cbb0', [5, hgt + 0.8, dep / 2]);
  });
  buildPictureOn(b, [R.side, FLOOR + 18, z], -Math.PI / 2, 11, 7.5);
}

/** รูปภาพบนผนังด้านข้าง (ภาพทะเลยามเย็น) */
function buildPictureOn(b, pos, rotY, w, h) {
  b.place(pos, rotY, (p) =>
    buildPicture(p, [0, 0, 0], w, h, (art) => {
      art.box([w - 1.6, h - 1.6, 0.05], '#f3c99a', [0, 0, 0]);
      art.box([w - 1.6, (h - 1.6) * 0.45, 0.06], '#2f6f98', [0, -(h - 1.6) * 0.275, 0.01]);
      art.add(new THREE.CircleGeometry(1.1, 20), '#f07a46', [1.5, 0.2, 0.02]);
      art.box([w - 1.6, 0.25, 0.07], '#f5a66e', [0, -0.35, 0.03]);
    }),
  );
}
