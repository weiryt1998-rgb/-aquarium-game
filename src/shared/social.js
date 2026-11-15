import { getSocial } from '../data/socials.js';
import { clamp } from '../utils/math.js';
import { isNum } from './economy.js';

/**
 * ความสัมพันธ์ของคนในฟาร์ม (เซฟกลาง: game.social) — ใช้ทั้งในเครื่องและบนเซิร์ฟเวอร์ (commands.js คำสั่ง 'social')
 *
 * game.social = { rel: { 'man|woman': { f, r, at, last, rep }, 'man|tahem' · 'tahem|woman' · 'man|pen' · 'pen|woman': {...} } }
 *   f = ความสนิท −100..100 · r = ความรัก 0..100 (เฉพาะคู่แฟน man|woman) · at = เวลาคุยล่าสุด (ms)
 *   last / rep = การกระทำล่าสุด + จำนวนครั้งที่ทำซ้ำติดกันใน REPEAT_MS (ทำซ้ำ ๆ ได้ผลน้อยลง — กันกดรัว)
 * ไม่มี game.social หรือไม่มีคู่ไหน = ค่าเริ่มต้นของคู่นั้น (BASE) · ห่างกันนานเกินวัน ค่าค่อย ๆ กลับหาระดับปกติ (relAt)
 */
export const PEOPLE_KEYS = ['man', 'woman', 'tahem', 'pen'];
/** คนที่ผู้เล่นบังคับได้ (คนเริ่มบทสนทนาในคำสั่ง 'social') */
export const PLAYABLE = ['man', 'woman'];
const DAY = 24 * 3600 * 1000;
export const REPEAT_MS = 10 * 60 * 1000;

/** ค่าเริ่มต้น/ระดับปกติของแต่ละคู่ — ผู้ชายกับผู้หญิงเป็นแฟนกันอยู่แล้ว */
export const BASE = {
  'man|woman': { f: 55, r: 70, couple: true },
  'man|tahem': { f: 20 },
  'tahem|woman': { f: 20 },
  'man|pen': { f: 30 },
  'pen|woman': { f: 30 },
  // ตาเหม↔ยายเพ็ญ: คู่ชีวิต คุยกันเองเท่านั้น (ไม่บันทึก · คำสั่ง social ปฏิเสธ)
  'pen|tahem': { f: 85, r: 90, couple: true, npc: true },
};

export const pairKey = (a, b) => [a, b].sort().join('|');
export const isCouplePair = (a, b) => pairKey(a, b) === 'man|woman';
/** ชนิดคู่สำหรับดูว่าการกระทำไหนใช้ได้ ('couple' | 'tahem' | 'pen' | 'elders') */
export function pairType(a, b) {
  const pair = pairKey(a, b);
  if (pair === 'man|woman') return 'couple';
  if (pair === 'pen|tahem') return 'elders';
  return a === 'pen' || b === 'pen' ? 'pen' : 'tahem';
}

export function defaultRel(pair) {
  const b = BASE[pair];
  return { f: b.f, r: b.couple ? b.r : 0, at: 0, last: '', rep: 0 };
}

/** ความสัมพันธ์ของคู่นี้ ณ เวลา now (รวมการค่อย ๆ จางหายเมื่อไม่ได้คุยกันเกิน 1 วัน) */
export function relAt(social, a, b, now) {
  const pair = pairKey(a, b);
  const rel = { ...defaultRel(pair), ...(social?.rel?.[pair] ?? {}) };
  if (rel.at > 0) {
    const days = (now - rel.at) / DAY - 1;
    if (days > 0) {
      const base = BASE[pair];
      // ความสนิทกลับหาระดับปกติวันละ 2 · ความรักลดวันละ 3 (ไม่ต่ำกว่า 20 — ยังเป็นแฟนกัน)
      rel.f = rel.f > base.f ? Math.max(base.f, rel.f - 2 * days) : Math.min(base.f, rel.f + 2 * days);
      if (base.couple) rel.r = Math.max(Math.min(rel.r, 20), rel.r - 3 * days);
    }
  }
  return rel;
}

/** การกระทำนี้ทำกับคู่นี้ได้ไหม → null = ได้ · ไม่งั้นเป็นเหตุผล ('pair' | 'need-f' | 'need-r') */
export function socialBlock(def, a, b, rel) {
  if (!def.with.includes(pairType(a, b))) return 'pair';
  if (def.need?.f != null && rel.f < def.need.f) return 'need-f';
  if (def.need?.r != null && rel.r < def.need.r) return 'need-r';
  return null;
}

/**
 * ผลของการกระทำต่อความสัมพันธ์ (คำนวณเหมือนกันทั้งในเครื่องและบนเซิร์ฟเวอร์)
 * ทำซ้ำอย่างเดิมภายใน REPEAT_MS → ผลบวกลดลง (1 / (1 + 0.7 × ครั้งที่ซ้ำ)) · repair = ความสนิทเพิ่มได้แค่ถึงระดับปกติ + 5
 * @returns {{ rel, df, dr }}
 */
export function applySocial(rel, def, ok, t, pair) {
  const rep = rel.last === def.id && t - rel.at < REPEAT_MS ? rel.rep + 1 : 0;
  const eff = (ok ? def.win : def.lose) ?? {};
  const mult = 1 / (1 + 0.7 * rep);
  const scale = (v) => (v > 0 ? v * mult : v);
  let df = scale(eff.f ?? 0);
  let dr = BASE[pair].couple ? scale(eff.r ?? 0) : 0;
  if (def.repair && df > 0) df = Math.max(0, Math.min(df, BASE[pair].f + 5 - rel.f));
  const next = {
    f: round1(clamp(rel.f + df, -100, 100)),
    r: round1(clamp(rel.r + dr, 0, 100)),
    at: t,
    last: def.id,
    rep: Math.min(rep, 20),
  };
  return { rel: next, df: next.f - rel.f, dr: next.r - rel.r };
}

const round1 = (v) => Math.round(v * 10) / 10;

/** ใส่ผลลงเซฟ (สำเนาใหม่) */
export function withRel(social, a, b, rel) {
  return { rel: { ...(social?.rel ?? {}), [pairKey(a, b)]: rel } };
}

/**
 * โอกาสสำเร็จ (คิดในเครื่องเท่านั้น — เซิร์ฟเวอร์รับผลสำเร็จ/ไม่สำเร็จจากเครื่อง แต่คิดผลต่อความสัมพันธ์เอง)
 * mood = อารมณ์ของคนฟัง (data/socials.js MOODS)
 */
export function successChance(def, rel, mood, t) {
  let p = def.base + (rel.f - 20) / 250;
  if (def.cat === 'romance') p += (rel.r - 50) / 200;
  if (mood === 'happy') p += 0.08;
  if (mood === 'playful' && def.cat === 'funny') p += 0.15;
  if (mood === 'flirty' && def.cat === 'romance') p += 0.15;
  if ((mood === 'angry' || mood === 'annoyed') && !def.repair) p -= mood === 'angry' ? 0.35 : 0.15;
  if ((mood === 'angry' || mood === 'sad') && def.repair) p += 0.1;
  if (mood === 'sad' && (def.cat === 'funny' || def.cat === 'romance')) p -= 0.15;
  if (rel.last === def.id && t - rel.at < REPEAT_MS) p -= 0.15 * (rel.rep + 1);
  return def.base >= 1 ? 1 : clamp(p, 0.05, 0.97);
}

/** ระดับความสัมพันธ์ (ป้ายในเมนู) */
export function friendLabel(f) {
  if (f <= -50) return 'ศัตรู';
  if (f < -15) return 'ไม่ถูกกัน';
  if (f < 15) return 'คนรู้จัก';
  if (f < 45) return 'เพื่อน';
  if (f < 75) return 'เพื่อนสนิท';
  return 'เพื่อนรู้ใจ';
}

export function loveLabel(r) {
  if (r < 25) return 'ห่างเหินกัน';
  if (r < 50) return 'แฟน';
  if (r < 80) return 'แฟนที่รักกันดี';
  return 'คู่รักหวานฉ่ำ';
}

/** ทำความสะอาดข้อมูลจากเซฟ — ไม่มีคู่ไหนที่ต่างจากค่าเริ่มต้น = null (ไม่ต้องเก็บ) */
export function sanitizeSocial(raw, now = Date.now()) {
  const src = raw?.rel && typeof raw.rel === 'object' && !Array.isArray(raw.rel) ? raw.rel : null;
  if (!src) return null;
  const rel = {};
  for (const pair of Object.keys(BASE)) {
    if (BASE[pair].npc) continue;
    const r = src[pair];
    if (!r || typeof r !== 'object') continue;
    const d = defaultRel(pair);
    rel[pair] = {
      f: isNum(r.f) ? round1(clamp(r.f, -100, 100)) : d.f,
      r: BASE[pair].couple && isNum(r.r) ? round1(clamp(r.r, 0, 100)) : d.r,
      at: isNum(r.at) ? Math.round(clamp(r.at, 0, now)) : 0,
      last: typeof r.last === 'string' && getSocial(r.last) ? r.last : '',
      rep: Number.isInteger(r.rep) ? clamp(r.rep, 0, 20) : 0,
    };
  }
  return Object.keys(rel).length ? { rel } : null;
}
