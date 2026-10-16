import { MOLLY_VARIANTS } from './variants.js';

/**
 * พันธุกรรมสีของปลาสอด (Balloon Molly)
 *
 * ปลาที่ซื้อจากร้าน = "พันธุ์แท้" ไม่มีฟิลด์ genes ใช้สีตาม species.procedural.variant
 * ลูกที่เกิดจากพ่อแม่ต่างสี (หรือมีพ่อ/แม่เป็นลูกผสม) = "ลูกผสม" เก็บยีนสีไว้ใน fish.genes:
 *
 *   genes = {
 *     body:  { base, back, belly, from },   สีตัว + from = ชุดสีที่ใช้ค่าวัสดุ/เกล็ด/ตา (id ใน variants.js)
 *     fins:  { base, tip, ray, opacity },   สีครีบ
 *     head:  { color, end } | null,         สีหัว (แบบ Red Head)
 *     spots: [{ ref, color, k }],           ชั้นลายจุด ≤ 3 ชั้น: ref = 'calico:1' (ชั้นลายของสีนั้น), k = ความหนาแน่น
 *     seed,                                 ตำแหน่งจุดของแต่ละตัว (ลายไม่ซ้ำกัน)
 *   }
 *
 * ไฟล์นี้เป็นโค้ดล้วน (ไม่ใช้ DOM/Three.js) ใช้ได้ทั้งในเกมและฝั่งตรวจคำสั่งของเซฟกลาง
 */

const HEX = /^#[0-9a-f]{6}$/i;
const MAX_SPOT_LAYERS = 3;
const SEED_MAX = 999_999;

/** ชุดสีที่ใช้เป็นแหล่งยีนได้ (ไม่รวมตัวอย่างโชว์) */
const PALETTES = Object.values(MOLLY_VARIANTS).filter((v) => !v.showcase);

/** ชั้นลายจุดทั้งหมดที่มีในชุดสี เช่น 'calico:1' */
const spotLayersOf = (variant) => (Array.isArray(variant.spots) ? variant.spots : variant.spots ? [variant.spots] : []);
export const SPOT_REFS = Object.fromEntries(PALETTES.flatMap((v) => spotLayersOf(v).map((L, i) => [`${v.id}:${i}`, L])));

/** ชื่อเรียกลายแต่ละชั้น (ใช้บรรยายลูกผสม) */
const SPOT_NAMES = {
  'dalmatian:0': 'จุดดัลเมเชียน',
  'dalmatian:1': 'ลายบั้งหินอ่อน',
  'redhead:0': 'จุดครีบ',
  'redhead:1': 'จุดแดง',
  'redhead:2': 'จุดดำประปราย',
  'calico:0': 'ด่างส้ม',
  'calico:1': 'จุดดำ',
  'golddust:0': 'ลายด่างเข้ม',
  'golddust:1': 'ผงฝุ่น',
};

const HEAD_COLORS = ['#f0541c', '#ff8a1f', '#d8202e', '#ffb21e'];
const SPOT_COLORS = ['#0b0c10', '#f2882a', '#2a1608', '#f0541c', '#ffd22c', '#3b5fa8'];

// ── สี ─────────────────────────────────────────────────────────

const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('')}`;

/** ผสมสีแบบเส้นตรง t = 0 → a, 1 → b */
export function mixHex(a, b, t) {
  const A = toRgb(a);
  const B = toRgb(b);
  return toHex(A.map((c, i) => c + (B[i] - c) * t));
}

const colorDistance = (a, b) => {
  const A = toRgb(a);
  const B = toRgb(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
};

// ── ยีนของปลาพันธุ์แท้ ───────────────────────────────────────────

/** ยีนเทียบเท่าของชุดสีพันธุ์แท้ (ใช้ตอนผสมกับลูกผสม/สีอื่น) */
export function variantGenes(variantId) {
  const v = MOLLY_VARIANTS[variantId] ?? MOLLY_VARIANTS.dalmatian;
  return {
    body: { base: v.body.base, back: v.body.back, belly: v.body.belly, from: v.id },
    fins: { base: v.fins.base, tip: v.fins.tip, ray: v.fins.ray, opacity: v.fins.opacity },
    head: v.head ? { color: v.head.color, end: v.head.end } : null,
    spots: spotLayersOf(v).map((L, i) => ({ ref: `${v.id}:${i}`, color: L.color, k: 1 })),
    seed: 1,
  };
}

// ── การผสมพันธุ์ ────────────────────────────────────────────────

const pick = (rnd, list) => list[Math.floor(rnd() * list.length) % list.length];
const sameBody = (a, b) => a.base === b.base && a.back === b.back && a.belly === b.belly;

function inheritBody(a, b, rnd) {
  if (sameBody(a, b)) return { ...a };
  // 40% สีตัวผสมกันเป็นสีกลาง (เช่น ทอง × ขาว = ทองอ่อน), ที่เหลือได้สีของพ่อหรือแม่
  if (rnd() < 0.4) {
    const t = 0.3 + rnd() * 0.4;
    return { base: mixHex(a.base, b.base, t), back: mixHex(a.back, b.back, t), belly: mixHex(a.belly, b.belly, t), from: t < 0.5 ? a.from : b.from };
  }
  return { ...(rnd() < 0.5 ? a : b) };
}

function inheritFins(a, b, rnd) {
  if (rnd() < 0.3) {
    const t = 0.3 + rnd() * 0.4;
    return { base: mixHex(a.base, b.base, t), tip: mixHex(a.tip, b.tip, t), ray: mixHex(a.ray, b.ray, t), opacity: a.opacity + (b.opacity - a.opacity) * t };
  }
  return { ...(rnd() < 0.5 ? a : b) };
}

function inheritHead(a, b, rnd) {
  if (a && b) return rnd() < 0.85 ? { color: rnd() < 0.3 ? mixHex(a.color, b.color, 0.5) : pick(rnd, [a, b]).color, end: (a.end + b.end) / 2 } : null;
  const one = a ?? b;
  return one && rnd() < 0.5 ? { ...one } : null;
}

function inheritSpots(a, b, rnd) {
  const byRef = new Map();
  for (const s of a) byRef.set(s.ref, { a: s });
  for (const s of b) byRef.set(s.ref, { ...byRef.get(s.ref), b: s });
  const out = [];
  for (const [ref, { a: sa, b: sb }] of byRef) {
    const both = sa && sb;
    if (rnd() > (both ? 0.9 : 0.55)) continue;
    const src = both ? pick(rnd, [sa, sb]) : sa ?? sb;
    const color = both && sa.color !== sb.color && rnd() < 0.3 ? mixHex(sa.color, sb.color, 0.5) : src.color;
    const k = (both ? (sa.k + sb.k) / 2 : src.k) * (0.75 + rnd() * 0.5);
    out.push({ ref, color, k: clampK(k) });
  }
  // สุ่มลำดับแล้วเก็บไม่เกิน 3 ชั้น
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.slice(0, MAX_SPOT_LAYERS);
}

const clampK = (k) => Math.round(Math.min(2, Math.max(0.3, k)) * 100) / 100;

/** กลายพันธุ์: ได้สีหรือลายที่ไม่มีในพ่อแม่ (รวมถึงสีที่ไม่มีขายในร้าน เช่น ดำ เงิน) */
function mutate(g, rnd) {
  const kind = Math.floor(rnd() * 5);
  if (kind === 0) {
    const p = pick(rnd, PALETTES);
    const t = 0.4 + rnd() * 0.4;
    g.body = { base: mixHex(g.body.base, p.body.base, t), back: mixHex(g.body.back, p.body.back, t), belly: mixHex(g.body.belly, p.body.belly, t), from: t >= 0.5 ? p.id : g.body.from };
  } else if (kind === 1 && g.spots.length < MAX_SPOT_LAYERS) {
    const refs = Object.keys(SPOT_REFS).filter((r) => SPOT_REFS[r].count > 0 && !g.spots.some((s) => s.ref === r));
    if (refs.length) {
      const ref = pick(rnd, refs);
      g.spots.push({ ref, color: rnd() < 0.5 ? SPOT_REFS[ref].color : pick(rnd, SPOT_COLORS), k: clampK(0.5 + rnd()) });
    }
  } else if (kind === 2 && g.spots.length) {
    pick(rnd, g.spots).color = pick(rnd, SPOT_COLORS);
  } else if (kind === 3) {
    g.head = { color: pick(rnd, HEAD_COLORS), end: 0.26 + rnd() * 0.14 };
  } else {
    const p = pick(rnd, PALETTES);
    g.fins = { base: p.fins.base, tip: p.fins.tip, ray: p.fins.ray, opacity: p.fins.opacity };
  }
}

/**
 * ยีนของลูก จากยีนแม่ (a) และพ่อ (b)
 * @param {() => number} rnd ตัวสุ่ม 0..1
 */
export function crossGenes(a, b, rnd = Math.random) {
  const g = {
    body: inheritBody(a.body, b.body, rnd),
    fins: inheritFins(a.fins, b.fins, rnd),
    head: inheritHead(a.head, b.head, rnd),
    spots: inheritSpots(a.spots, b.spots, rnd),
    seed: 1 + Math.floor(rnd() * (SEED_MAX - 1)),
  };
  if (rnd() < 0.15) mutate(g, rnd);
  return sanitizeGenes(g);
}

// ── ตรวจข้อมูล ──────────────────────────────────────────────────

const hex = (v, fallback) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);
const num = (v, min, max, fallback) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** ทำให้ยีนจากภายนอก (เซฟ/คำสั่ง) อยู่ในรูปที่ถูกต้องเสมอ คืน null ถ้าใช้ไม่ได้ */
export function sanitizeGenes(raw) {
  if (!raw || typeof raw !== 'object' || !raw.body || !raw.fins) return null;
  const def = variantGenes('dalmatian');
  const from = MOLLY_VARIANTS[raw.body.from] && !MOLLY_VARIANTS[raw.body.from].showcase ? raw.body.from : def.body.from;
  const spots = (Array.isArray(raw.spots) ? raw.spots : [])
    .filter((s) => s && SPOT_REFS[s.ref])
    .slice(0, MAX_SPOT_LAYERS)
    .map((s) => ({ ref: s.ref, color: hex(s.color, SPOT_REFS[s.ref].color), k: clampK(num(s.k, 0.3, 2, 1)) }));
  return {
    body: { base: hex(raw.body.base, def.body.base), back: hex(raw.body.back, def.body.back), belly: hex(raw.body.belly, def.body.belly), from },
    fins: {
      base: hex(raw.fins.base, def.fins.base),
      tip: hex(raw.fins.tip, def.fins.tip),
      ray: hex(raw.fins.ray, def.fins.ray),
      opacity: Math.round(num(raw.fins.opacity, 0.35, 0.95, 0.7) * 100) / 100,
    },
    head: raw.head && typeof raw.head === 'object' ? { color: hex(raw.head.color, HEAD_COLORS[0]), end: Math.round(num(raw.head.end, 0.2, 0.45, 0.33) * 100) / 100 } : null,
    spots,
    seed: Math.floor(num(raw.seed, 1, SEED_MAX, 1)),
  };
}

// ── แปลงยีนเป็นชุดสีสำหรับวาด ───────────────────────────────────

function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

/** id คงที่ของยีนชุดหนึ่ง (ใช้เป็นคีย์แคช texture / รูปตัวอย่าง) */
export const genesKey = (genes) => `h${hashString(JSON.stringify(genes))}`;

/** ชุดสี (รูปแบบเดียวกับ variants.js) จากยีน ใช้วาด texture ได้ทันที */
export function genesToVariant(genes) {
  const g = sanitizeGenes(genes) ?? variantGenes('dalmatian');
  const src = MOLLY_VARIANTS[g.body.from];
  return {
    id: genesKey(g),
    hybrid: true,
    name: 'ลูกผสม',
    nameEn: 'Hybrid Molly',
    body: { base: g.body.base, back: g.body.back, belly: g.body.belly, gill: mixHex(g.body.base, '#f0c8c0', 0.4) },
    head: g.head ? { color: g.head.color, start: 0.16, end: g.head.end, back: 0.14 } : undefined,
    scales: src.scales,
    spots: g.spots.map((s) => {
      const L = SPOT_REFS[s.ref];
      return { ...L, color: s.color, count: Math.round((L.count ?? 0) * s.k), finCount: Math.round((L.finCount ?? 0) * s.k) };
    }),
    fins: { ...g.fins },
    lip: g.head ? mixHex(g.head.color, '#ffffff', 0.25) : mixHex(g.body.base, '#e0b0a0', 0.4),
    iris: src.iris,
    material: src.material,
    seed: g.seed / (SEED_MAX + 1),
  };
}

/** ชื่อสีตัวสำหรับบรรยาย */
const BODY_NAMES = [
  ['ขาว', '#f5f2ec'],
  ['ดำ', '#16171b'],
  ['ทอง', '#ffd22c'],
  ['เงิน', '#c4cad1'],
  ['ทองอำพัน', '#e9a33c'],
  ['ส้ม', '#f28a2a'],
  ['แดง', '#e0402a'],
  ['ครีม', '#f3dfae'],
  ['เทา', '#8a8f96'],
];

/** คำบรรยายลักษณะของลูกผสม เช่น "ตัวสีทอง · หัวแดง · จุดดัลเมเชียน" */
export function describeGenes(genes) {
  const g = sanitizeGenes(genes);
  if (!g) return '';
  let best = BODY_NAMES[0];
  for (const c of BODY_NAMES) if (colorDistance(c[1], g.body.base) < colorDistance(best[1], g.body.base)) best = c;
  const parts = [`ตัวสี${best[0]}`];
  if (g.head) parts.push('หัวแดง');
  for (const s of g.spots) {
    const name = SPOT_NAMES[s.ref];
    if (name && !parts.includes(name)) parts.push(name);
  }
  return parts.join(' · ');
}
