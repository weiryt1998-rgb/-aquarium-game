import { BARN_AT, Farm, SHADE_TREES, TROUGH } from './Farm.js';
import { POND, YARD } from './FarmDecor.js';

/**
 * สิ่งกีดขวางสำหรับผู้เล่นเดินในฟาร์ม (ระนาบ x-z) — รูปทรงง่าย ๆ ตามตำแหน่งในฉาก:
 *   เส้น (segment) = รั้วคอก · รั้วขาวหน้าบ้าน · ผนังโรงนา (เว้นช่องประตูรั้วหน้า/หลัง ประตูสวน และประตูโรงนา)
 *   กล่อง (box)   = ตัวบ้าน · รางน้ำ
 *   วงกลม (circle) = บ่อน้ำ · ลำต้นไม้ใหญ่ · ของตกแต่งที่ตั้งบนพื้น (ตำแหน่งจาก FarmDecor.places)
 * ตำแหน่งต้องตรงกับ Farm.js / FarmDecor.js — ย้ายของในฉากแล้วแก้ที่นี่ด้วย
 */

/** ตัวบ้าน + ระเบียง (ขอบหน้าระเบียง x = −16.4 · ประตูบ้านอยู่บนแนว z = 10.5) */
const HOUSE = { minX: -28.4, maxX: -16.4, minZ: 4.4, maxZ: 16.0 };
/** โรงนา 11 × 12 ม. (Fish/farm/build_barn.py) · ประตูหน้ากว้าง 3.6 ม. ที่ z = BARN_AT.z + 6 */
const BARN_HALF_W = 5.5;
const BARN_HALF_D = 6;
const BARN_DOOR_HALF = 1.8;
/** ขอบเขตที่เดินได้ (อยู่ในพื้นราบและในกรอบเงาแดด) */
export const WALK_BOUNDS = { minX: -32, maxX: 30, minZ: -27, maxZ: 24 };

/** รัศมีของตกแต่งแต่ละชนิด (ชื่อ object ใน decor.glb) — ไม่อยู่ในรายการ = เดินผ่านได้ (ทางเดิน ดอกไม้ หิน) */
const DECOR_RADIUS = {
  HayBale: 0.75,
  Barrel: 0.4,
  Crate: 0.45,
  MilkCan: 0.22,
  Wheelbarrow: 0.65,
  Woodpile: 0.85,
  Windmill: 1.3,
  LampPost: 0.18,
  Mailbox: 0.18,
  Bench: 0.85,
  GardenBed: 1.1,
  BushA: 0.6,
  BushB: 0.55,
};

/** @param {{ decor?: { places: Record<string, { x: number, z: number, y?: number, s?: number | number[] }[]> } }} world */
export function buildFarmColliders(world) {
  const segments = [];
  const seg = (ax, az, bx, bz) => segments.push({ ax, az, bx, bz });
  for (const { a, b } of Farm.fenceSegments()) seg(a[0], a[1], b[0], b[1]);

  // รั้วขาวล้อมสวนหน้าบ้าน (ด้านตะวันตกติดตัวบ้าน) · ประตูสวนด้านตะวันออก
  seg(YARD.maxX, YARD.minZ, YARD.maxX, YARD.gate[0]);
  seg(YARD.maxX, YARD.gate[1], YARD.maxX, YARD.maxZ);
  seg(YARD.minX, YARD.minZ, YARD.maxX, YARD.minZ);
  seg(YARD.minX, YARD.maxZ, YARD.maxX, YARD.maxZ);

  // ผนังโรงนา (เดินเข้าไปในทางเดินกลางได้ทางประตูหน้า)
  const bx0 = BARN_AT.x - BARN_HALF_W;
  const bx1 = BARN_AT.x + BARN_HALF_W;
  const bz0 = BARN_AT.z - BARN_HALF_D;
  const bz1 = BARN_AT.z + BARN_HALF_D;
  seg(bx0, bz0, bx1, bz0);
  seg(bx0, bz0, bx0, bz1);
  seg(bx1, bz0, bx1, bz1);
  seg(bx0, bz1, BARN_AT.x - BARN_DOOR_HALF, bz1);
  seg(BARN_AT.x + BARN_DOOR_HALF, bz1, bx1, bz1);

  const boxes = [
    HOUSE,
    { minX: TROUGH.x - TROUGH.width / 2, maxX: TROUGH.x + TROUGH.width / 2, minZ: TROUGH.z - TROUGH.depth / 2, maxZ: TROUGH.z + TROUGH.depth / 2 },
  ];

  const circles = [{ x: POND.x, z: POND.z, r: POND.r * 1.12 }];
  for (const [x, z, s] of SHADE_TREES) circles.push({ x, z, r: 0.45 * s });
  for (const [name, list] of Object.entries(world.decor?.places ?? {})) {
    const r = DECOR_RADIUS[name];
    if (!r) continue;
    for (const p of list) {
      if (p.y) continue; // ของที่วางซ้อนบนของอื่น
      const s = typeof p.s === 'number' ? p.s : 1;
      circles.push({ x: p.x, z: p.z, r: r * s });
    }
  }
  return { segments, boxes, circles, bounds: WALK_BOUNDS };
}

/**
 * ดันตำแหน่ง p (ระนาบ x-z) ออกจากสิ่งกีดขวางทั้งหมด (แก้ในที่) — วนสองรอบให้มุมรั้ว/ของชิดกันไม่ทะลุ
 * @param {ReturnType<typeof buildFarmColliders>} c
 * @param {{ x: number, z: number }} p
 * @param {number} r รัศมีตัวผู้เล่น
 */
export function resolveCollisions(c, p, r) {
  for (let pass = 0; pass < 2; pass++) {
    for (const s of c.segments) {
      const dx = s.bx - s.ax;
      const dz = s.bz - s.az;
      const t = Math.max(0, Math.min(1, ((p.x - s.ax) * dx + (p.z - s.az) * dz) / (dx * dx + dz * dz)));
      pushFrom(p, s.ax + dx * t, s.az + dz * t, r + 0.08);
    }
    for (const b of c.boxes) {
      const qx = Math.max(b.minX, Math.min(b.maxX, p.x));
      const qz = Math.max(b.minZ, Math.min(b.maxZ, p.z));
      if (qx === p.x && qz === p.z) {
        // อยู่ในกล่อง (เช่นวางผิดที่) → ออกทางด้านที่ใกล้สุด
        const opts = [
          [p.x - b.minX, b.minX - r, p.z],
          [b.maxX - p.x, b.maxX + r, p.z],
          [p.z - b.minZ, p.x, b.minZ - r],
          [b.maxZ - p.z, p.x, b.maxZ + r],
        ].sort((u, v) => u[0] - v[0]);
        p.x = opts[0][1];
        p.z = opts[0][2];
      } else pushFrom(p, qx, qz, r);
    }
    for (const o of c.circles) {
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const d = Math.hypot(dx, dz);
      const min = o.r + r;
      if (d < min && d > 1e-6) {
        p.x = o.x + (dx / d) * min;
        p.z = o.z + (dz / d) * min;
      }
    }
  }
  const b = c.bounds;
  p.x = Math.max(b.minX, Math.min(b.maxX, p.x));
  p.z = Math.max(b.minZ, Math.min(b.maxZ, p.z));
}

function pushFrom(p, qx, qz, min) {
  const dx = p.x - qx;
  const dz = p.z - qz;
  const d = Math.hypot(dx, dz);
  if (d >= min) return;
  if (d < 1e-6) {
    p.x += min;
    return;
  }
  p.x = qx + (dx / d) * min;
  p.z = qz + (dz / d) * min;
}

/** จุดนี้ชนสิ่งกีดขวางไหม (ตัวรัศมี r) — ใช้หาเส้นทางเดิน */
export function blockedAt(c, x, z, r) {
  for (const s of c.segments) {
    const dx = s.bx - s.ax;
    const dz = s.bz - s.az;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / (dx * dx + dz * dz)));
    if (Math.hypot(x - s.ax - dx * t, z - s.az - dz * t) < r + 0.08) return true;
  }
  for (const b of c.boxes) if (x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r) return true;
  for (const o of c.circles) if (Math.hypot(x - o.x, z - o.z) < o.r + r) return true;
  const b = c.bounds;
  return x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ;
}

/** เดินเป็นเส้นตรงจาก a ไป b ได้โดยไม่ชนอะไร (ตรวจทุก 0.2 ม.) */
export function lineClear(c, ax, az, bx, bz, r) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.2));
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (blockedAt(c, ax + (bx - ax) * t, az + (bz - az) * t, r)) return false;
  }
  return true;
}
