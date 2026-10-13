import { CONFIG } from '../config.js';

export const clamp = (v, min, max) => (v < min ? min : v > max ? max : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** เส้นโค้ง Hermite ผ่านจุด [t, ค่า] ที่กำหนด — ใช้กำหนดรูปร่างลำตัวปลาด้วยตาราง แก้ตัวเลขแล้วรูปเปลี่ยนตามได้ง่าย */
export function hermiteCurve(points) {
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

/** ค่าหน่วงแบบไม่ขึ้นกับ frame rate: ใช้แทน lerp(a, b, k) ทุกเฟรม */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

/** ผลต่างมุมที่สั้นที่สุด (เรเดียน) */
export function angleDelta(from, to) {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

let uidCounter = 0;
export function uid(prefix = 'id') {
  uidCounter = (uidCounter + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${uidCounter.toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
}

/** hash ข้อความ → ตัวเลข 0..1 (ใช้เป็น seed ให้ของแต่ละชิ้นหน้าตาไม่ซ้ำกัน) */
export function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

/** ตัวสุ่มที่กำหนด seed ได้ (mulberry32) */
export function seededRandom(seed) {
  let a = Math.floor(seed * 4294967296) || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatNumber(n) {
  return Math.floor(n).toLocaleString('en-US');
}

let dayFormat = null;

/** วันที่ YYYY-MM-DD ตามเขตเวลาของเกม (CONFIG.timeZone) — เครื่องและเซิร์ฟเวอร์ขึ้นวันใหม่พร้อมกัน */
export function todayKey(date = new Date()) {
  dayFormat ??= new Intl.DateTimeFormat('en-US', { timeZone: CONFIG.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const parts = {};
  for (const p of dayFormat.formatToParts(date)) parts[p.type] = p.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s} วินาที`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} นาที`;
  const h = Math.floor(m / 60);
  return `${h} ชม. ${m % 60} นาที`;
}
