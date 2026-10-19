import { CONFIG } from '../config.js';
import { clamp } from '../utils/math.js';
import { isNum } from './economy.js';

/**
 * กระถางทานตะวันข้างตู้ปลา — ต้นไม้มีชีวิตที่ต้องรดน้ำ ใส่ปุ๋ย ถ้าปล่อยไว้นานจะเหี่ยวจนตาย
 *
 * game.sunflower (ไม่มี = กระถางว่าง ยังไม่ได้ปลูก) = {
 *   plantedAt,   // เวลาที่ปลูก (ms)
 *   at,          // เวลาที่ค่าข้างล่างถูกคำนวณ (ms) — ค่าปัจจุบัน = sunflowerAt(s, now)
 *   water,       // น้ำในดิน 0..100
 *   food,        // ปุ๋ยในดิน 0..100
 *   growth,      // 0 เมล็ด → 1 ดอกบาน
 *   health,      // 0 = ตาย (เหี่ยวแห้ง)
 *   seedsAt,     // 0 = ยังไม่บาน · ไม่ใช่ 0 = เวลาที่บาน/เก็บเมล็ดครั้งล่าสุด (เมล็ดพร้อมเก็บอีก seedHours ชม.)
 * }
 *
 * ค่าเปลี่ยนตามนาฬิกาจริงด้วยสูตรเดียวกันทั้งในเครื่องและฝั่งตรวจ (Cloud Functions / transaction ของ Rules)
 * จึงเก็บเฉพาะค่า ณ เวลาที่ผู้เล่นทำอะไรกับต้นไม้ ไม่ต้องบันทึกต่อเนื่อง
 * ไฟล์นี้ห้ามแตะ DOM / Three.js (ถูก bundle ไปรันบนเซิร์ฟเวอร์ด้วย)
 */

const HOUR = 3_600_000;
/** คำนวณทีละ 5 นาที — ละเอียดพอให้น้ำหมดกลางช่วงแล้วสุขภาพเริ่มลดได้ใกล้เคียงความจริง */
const STEP_MS = 5 * 60_000;
/** ไม่คำนวณย้อนหลังเกิน 30 วัน (ต้นไม้ตายไปนานแล้ว) */
const MAX_CATCH_UP_MS = 30 * 24 * HOUR;
/** คำสั่งที่ส่งช้า (ออฟไลน์) นับเวลาตามที่ทำในเครื่องได้ แต่ไม่เก่ากว่าหนึ่งสัปดาห์ (เหมือนการผสมพันธุ์ปลา) */
const MAX_COMMAND_DELAY_MS = 7 * 24 * HOUR;
/** เผื่อนาฬิกาเครื่องกับฝั่งตรวจต่างกันเล็กน้อย */
const SLACK = 2;

export const SUNFLOWER_KEYS = ['plantedAt', 'at', 'water', 'food', 'growth', 'health', 'seedsAt'];

/** ขั้นการเติบโต (ตามค่า growth) */
export const SUNFLOWER_STAGES = [
  { id: 'seedling', from: 0, name: 'ต้นกล้าเพิ่งงอก', icon: '🌱' },
  { id: 'sprout', from: 0.15, name: 'ต้นอ่อน', icon: '🌿' },
  { id: 'young', from: 0.45, name: 'ต้นโต', icon: '🪴' },
  { id: 'bud', from: 0.75, name: 'ดอกตูม', icon: '🌼' },
  { id: 'bloom', from: 1, name: 'ดอกบาน', icon: '🌻' },
];

export function newSunflower(now) {
  return { plantedAt: now, at: now, water: 70, food: 30, growth: 0.04, health: 100, seedsAt: 0 };
}

export const isDead = (s) => !!s && s.health <= 0;

export function sunflowerStage(s) {
  let stage = SUNFLOWER_STAGES[0];
  for (const st of SUNFLOWER_STAGES) if ((s?.growth ?? 0) >= st.from) stage = st;
  return stage;
}

/** สถานะ ณ เวลา now (ไม่แก้ object เดิม) — เดินเวลาทีละช่วงจาก s.at */
export function sunflowerAt(s, now) {
  if (!s) return null;
  const g = CONFIG.garden;
  const out = { ...s };
  let t = s.at;
  const end = Math.min(now, t + MAX_CATCH_UP_MS);
  while (t < end && out.health > 0) {
    const dtMs = Math.min(STEP_MS, end - t);
    const h = dtMs / HOUR;
    const wet = out.water > 0;
    const fed = out.food > 0;
    out.water = Math.max(0, out.water - g.waterUse * h);
    out.food = Math.max(0, out.food - g.foodUse * h);
    if (!wet) {
      out.health = Math.max(0, out.health - g.dryDamage * h);
    } else {
      out.health = Math.min(100, out.health + g.regen * (fed ? 1 : 0.4) * h);
      if (out.growth < 1) {
        const rate = (fed ? g.foodBoost : 1) * (out.health >= 50 ? 1 : 0.5);
        out.growth = Math.min(1, out.growth + (rate * h) / g.growHours);
        if (out.growth >= 1) out.seedsAt = t + dtMs; // เพิ่งบาน → เริ่มนับเวลาเมล็ด
      }
    }
    t += dtMs;
  }
  out.at = Math.max(s.at, now);
  return out;
}

/** เวลา (ms) ที่เมล็ดพร้อมเก็บ (ยังไม่บาน = Infinity) */
export function seedsReadyAt(s) {
  return s?.seedsAt ? s.seedsAt + CONFIG.garden.seedHours * HOUR : Infinity;
}

/**
 * ตรวจว่าทำได้ไหม ณ สถานะปัจจุบัน (ค่าจาก sunflowerAt) → null = ทำได้ / รหัสเหตุผล
 * strict = false ใช้ฝั่งตรวจ: เผื่อค่าคลาดเล็กน้อยจากเวลาเครื่องกับฝั่งตรวจไม่ตรงกัน
 */
export function sunflowerBlock(action, s, now, { strict = true } = {}) {
  const g = CONFIG.garden;
  const slack = strict ? 0 : SLACK;
  if (action === 'plant') return s && !isDead(s) ? 'already-planted' : null;
  if (!s) return 'not-planted';
  if (isDead(s)) return 'dead';
  if (action === 'water') return s.water >= g.wetAbove + slack ? 'too-wet' : null;
  if (action === 'fertilize') return s.food >= g.fullAbove + slack ? 'too-full' : null;
  if (action === 'harvest') return now < seedsReadyAt(s) - (strict ? 0 : 3000) ? 'not-ready' : null;
  return 'invalid';
}

/** เวลาที่คำสั่งเกิดขึ้นจริง: ตามเวลาในเครื่อง (c.at) แต่ไม่ก่อนค่าล่าสุดของต้นไม้ ไม่ล้ำอนาคต และไม่เก่ากว่าหนึ่งสัปดาห์ */
export function actionTime(s, at, now) {
  const t = isNum(at) ? at : now;
  return Math.round(clamp(t, Math.max(s?.at ?? 0, now - MAX_COMMAND_DELAY_MS), now));
}

/** ผลของการกระทำแต่ละแบบ (s = สถานะ ณ เวลาที่ทำ ผ่านการตรวจ sunflowerBlock แล้ว) */
export function applySunflowerAction(action, s, t) {
  const g = CONFIG.garden;
  if (action === 'plant') return newSunflower(t);
  const next = { ...s, at: t };
  if (action === 'water') next.water = Math.min(100, s.water + g.waterAmount);
  else if (action === 'fertilize') next.food = Math.min(100, s.food + g.foodAmount);
  else if (action === 'harvest') next.seedsAt = t;
  return next;
}

/** ตัดค่าผิดรูปแบบจากเซฟ (ไม่มี/เสีย = กระถางว่าง) */
export function sanitizeSunflower(raw, now) {
  if (!raw || typeof raw !== 'object' || !isNum(raw.plantedAt) || !isNum(raw.at)) return null;
  const at = clamp(raw.at, 0, now);
  const num = (v, max, fallback) => (isNum(v) ? clamp(v, 0, max) : fallback);
  const growth = num(raw.growth, 1, 0);
  return {
    plantedAt: clamp(raw.plantedAt, 0, at),
    at,
    water: num(raw.water, 100, 0),
    food: num(raw.food, 100, 0),
    growth,
    health: num(raw.health, 100, 0),
    seedsAt: growth < 1 ? 0 : isNum(raw.seedsAt) && raw.seedsAt > 0 ? clamp(raw.seedsAt, 0, at) : at,
  };
}
