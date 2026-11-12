import { CONFIG } from '../config.js';
import { getCowBreed } from '../data/animals.js';
import { clamp } from '../utils/math.js';
import { cleanName, isId, isNum } from './economy.js';

/**
 * ฟาร์มนอกบ้าน — กฎของวัว (ไฟล์นี้ห้ามแตะ DOM / Three.js เพราะจะถูก bundle ไปรันฝั่งตรวจด้วย เหมือน shared/garden.js)
 *
 * game.farm (ไม่มี = ยังไม่มีฟาร์ม) = {
 *   cows: [{
 *     id, breedId, name,
 *     boughtAt,  // เวลาที่ซื้อ (ms)
 *     at,        // เวลาที่ค่าข้างล่างถูกคำนวณ (ms) — ค่าปัจจุบัน = cowAt(cow, now)
 *     satiety,   // ความอิ่ม 0..100
 *     health,    // 0 = ตาย
 *     milk,      // นมในเต้า 0..100 (เพิ่มขึ้นเมื่ออิ่มและแข็งแรง)
 *   }]
 * }
 *
 * ค่าเปลี่ยนตามนาฬิกาจริงด้วยสูตรเดียวกันทั้งในเครื่องและฝั่งตรวจ จึงเก็บเฉพาะค่า ณ เวลาที่ผู้เล่นทำอะไรกับวัวตัวนั้น
 *
 * คำสั่งเซฟกลาง (shared/commands.js): buyCow · feedCow · milkCow · sellCow — ตรวจด้วยฟังก์ชันชุดนี้ทั้งในเครื่องและฝั่งตรวจ
 * firestore.rules ตรวจรูปแบบ game.farm (validFarm) ให้ตรงกับ COW_KEYS / MAX_COW_RECORDS
 */

const HOUR = 3_600_000;
/** คำนวณทีละ 5 นาที (เหมือนทานตะวัน) */
const STEP_MS = 5 * 60_000;
/** ไม่คำนวณย้อนหลังเกิน 30 วัน */
const MAX_CATCH_UP_MS = 30 * 24 * HOUR;
/** เผื่อนาฬิกาเครื่องกับฝั่งตรวจต่างกันเล็กน้อย */
const SLACK = 2;

export const COW_KEYS = ['id', 'breedId', 'name', 'boughtAt', 'at', 'satiety', 'health', 'milk'];
/** จำนวนวัวในเซฟสูงสุด (รวมตัวที่ตายแล้วแต่ยังไม่ได้นำออก) — ต้องตรงกับ validFarm ใน firestore.rules */
export const MAX_COW_RECORDS = 8;

/** ชื่อตั้งต้นของวัวตัวใหม่ (ผู้เล่นได้ชื่อสุ่มจากรายการนี้) */
export const COW_NAMES = ['มะลิ', 'ส้มโอ', 'คาราเมล', 'นมสด', 'ขาวมณี', 'ลูกชุบ', 'โกโก้', 'บัวลอย', 'ทองหยอด', 'ข้าวเหนียว', 'มัทฉะ', 'ขนมปัง', 'ชาไทย', 'ถั่วแดง'];

export const findCow = (farm, id) => farm?.cows?.find((c) => c.id === id) ?? null;

export function newCow({ id, breedId, name }, now) {
  return { id, breedId, name, boughtAt: now, at: now, satiety: 80, health: 100, milk: 0 };
}

export const isCowDead = (c) => !!c && c.health <= 0;

/** สถานะวัว ณ เวลา now (ไม่แก้ object เดิม) — เดินเวลาทีละช่วงจาก c.at */
export function cowAt(c, now) {
  if (!c) return null;
  const f = CONFIG.farm;
  const breed = getCowBreed(c.breedId);
  const out = { ...c };
  let t = c.at;
  const end = Math.min(now, t + MAX_CATCH_UP_MS);
  while (t < end && out.health > 0) {
    const h = Math.min(STEP_MS, end - t) / HOUR;
    const fed = out.satiety > 0;
    out.satiety = Math.max(0, out.satiety - f.hungerUse * h);
    if (!fed) {
      out.health = Math.max(0, out.health - f.starveDamage * h);
    } else {
      out.health = Math.min(100, out.health + f.regen * h);
      const rate = (breed?.milkPerHour ?? 0) * (out.health >= 50 ? 1 : 0.4);
      out.milk = Math.min(100, out.milk + rate * h);
    }
    t += Math.min(STEP_MS, end - t);
  }
  out.at = Math.max(c.at, now);
  return out;
}

/** ทั้งฟาร์ม ณ เวลา now (null = ยังไม่มีฟาร์ม) */
export function farmAt(farm, now) {
  if (!farm) return null;
  return { ...farm, cows: farm.cows.map((c) => cowAt(c, now)) };
}

/** เหรียญที่ได้จากการรีดนม ณ ระดับนมตอนนี้ */
export function milkValue(c) {
  const reward = getCowBreed(c?.breedId)?.milkReward?.coins ?? 0;
  return Math.floor((reward * clamp(c?.milk ?? 0, 0, 100)) / 100);
}

/**
 * ตรวจว่าทำกับวัวตัวนี้ได้ไหม ณ สถานะปัจจุบัน (ค่าจาก cowAt) → null = ทำได้ / รหัสเหตุผล
 * strict = false ใช้ฝั่งตรวจ: เผื่อค่าคลาดเล็กน้อยจากเวลาเครื่องกับฝั่งตรวจไม่ตรงกัน
 * @param {'feed'|'milk'} action
 */
export function cowBlock(action, c, { strict = true } = {}) {
  const f = CONFIG.farm;
  const slack = strict ? 0 : SLACK;
  if (!c) return 'not-found';
  if (isCowDead(c)) return 'dead';
  if (action === 'feed') return c.satiety >= f.fullAbove + slack ? 'too-full' : null;
  if (action === 'milk') return c.milk < f.milkMin - slack ? 'not-ready' : null;
  return 'invalid';
}

/**
 * ซื้อวัวเพิ่มได้ไหม → null = ได้ / รหัสเหตุผล (ไม่ตรวจเงิน — ใช้ spend/canAfford แบบเดียวกับของอื่น)
 * farm ควรเป็นสถานะ ณ ตอนนี้ (farmAt) เพื่อนับวัวที่ตายระหว่างนั้นด้วย
 */
export function buyCowBlock(farm, breedId) {
  const breed = getCowBreed(breedId);
  if (!breed || breed.retired) return 'invalid';
  const cows = farm?.cows ?? [];
  if (cows.filter((c) => !isCowDead(c)).length >= CONFIG.farm.maxCows) return 'limit';
  return cows.length >= MAX_COW_RECORDS ? 'remove-dead' : null;
}

/** เงินที่ได้เมื่อขายวัว: ตามราคาสายพันธุ์ × sellRate × สุขภาพ · ตายแล้ว = 0 (นำออกจากคอกเฉย ๆ) */
export function cowSellValue(c) {
  const breed = getCowBreed(c?.breedId);
  if (!breed || isCowDead(c)) return { coins: 0 };
  return { coins: Math.floor((breed.price.coins ?? 0) * CONFIG.farm.sellRate * (0.5 + 0.5 * c.health / 100)) };
}

/** ผลของการกระทำ (c = สถานะ ณ เวลาที่ทำ ผ่าน cowBlock แล้ว) → { cow, reward } */
export function applyCowAction(action, c, t) {
  const f = CONFIG.farm;
  if (action === 'feed') return { cow: { ...c, at: t, satiety: Math.min(100, c.satiety + f.hayAmount) }, reward: null };
  if (action === 'milk') return { cow: { ...c, at: t, milk: 0 }, reward: { coins: milkValue(c) } };
  return { cow: c, reward: null };
}

/** ตัดค่าผิดรูปแบบจากเซฟ (ไม่มี/เสีย = ยังไม่มีฟาร์ม) · วัวพันธุ์ที่หาไม่เจอถูกตัดออก */
export function sanitizeFarm(raw, now) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.cows)) return null;
  const num = (v, fallback) => (isNum(v) ? clamp(v, 0, 100) : fallback);
  const seen = new Set();
  const cows = [];
  for (const c of raw.cows) {
    if (!c || !isId(c.id) || seen.has(c.id) || !getCowBreed(c.breedId) || !isNum(c.at)) continue;
    seen.add(c.id);
    const at = clamp(c.at, 0, now);
    cows.push({
      id: c.id,
      breedId: c.breedId,
      name: cleanName(c.name, getCowBreed(c.breedId).name),
      boughtAt: isNum(c.boughtAt) ? clamp(c.boughtAt, 0, at) : at,
      at,
      satiety: num(c.satiety, 0),
      health: num(c.health, 0),
      milk: num(c.milk, 0),
    });
    if (cows.length >= MAX_COW_RECORDS) break;
  }
  return { cows };
}
