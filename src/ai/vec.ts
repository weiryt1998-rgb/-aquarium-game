/**
 * เวกเตอร์ 3 มิติแบบเบา ๆ สำหรับ Fish AI (ไม่ใช้ THREE.Vector3 เพื่อแยก AI ออกจากการเรนเดอร์)
 * ทุกเมธอดแก้ค่าในตัวเองแล้วคืน this — ใช้ซ้ำได้โดยไม่สร้าง object ใหม่ทุกเฟรม
 * โครงสร้าง {x, y, z} ตรงกับ THREE.Vector3 จึงอ่านตำแหน่งจากฝั่งเรนเดอร์ได้ตรง ๆ (Vec3Like)
 */
export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export class Vec3 implements Vec3Like {
  x: number;
  y: number;
  z: number;

  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x: number, y: number, z: number): this {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v: Vec3Like): this {
    return this.set(v.x, v.y, v.z);
  }

  add(v: Vec3Like): this {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }

  addScaled(v: Vec3Like, s: number): this {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }

  sub(v: Vec3Like): this {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }

  /** this = a - b */
  subVectors(a: Vec3Like, b: Vec3Like): this {
    return this.set(a.x - b.x, a.y - b.y, a.z - b.z);
  }

  scale(s: number): this {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  dot(v: Vec3Like): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  lengthSq(): number {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length(): number {
    return Math.sqrt(this.lengthSq());
  }

  normalize(): this {
    const l = this.length();
    return l > 1e-9 ? this.scale(1 / l) : this;
  }

  clampLength(max: number): this {
    const l = this.length();
    return l > max && l > 1e-9 ? this.scale(max / l) : this;
  }

  distanceSq(v: Vec3Like): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    const dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /** this = a + (b - a) * t */
  lerpVectors(a: Vec3Like, b: Vec3Like, t: number): this {
    return this.set(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t);
  }
}

export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);

export function smoothstep(a: number, b: number, x: number): number {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** สุ่มแบบกำหนด seed ได้ (mulberry32) — ใช้ให้บุคลิกและการตัดสินใจทดสอบซ้ำได้ */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** hash ข้อความ → จำนวนเต็ม 32 บิต (FNV-1a) */
export function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
