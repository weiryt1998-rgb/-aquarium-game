import { CONFIG } from '../config.js';
import { getCowBreed } from '../data/animals.js';
import { clamp, hashString } from '../utils/math.js';
import { cleanName, isId, isNum } from './economy.js';

/**
 * ฟาร์มนอกบ้าน — กฎของวัว (ไฟล์นี้ห้ามแตะ DOM / Three.js เพราะจะถูก bundle ไปรันฝั่งตรวจด้วย เหมือน shared/garden.js)
 *
 * game.farm (ไม่มี = ยังไม่มีฟาร์ม) = {
 *   cows: [{
 *     id, breedId, name,
 *     sex,       // 'f' = แม่วัว (ให้นม ตั้งท้องได้) · 'm' = พ่อพันธุ์ (ไม่ให้นม) — เซฟเก่าไม่มี = 'f'
 *     boughtAt,  // เวลาที่ซื้อ/เกิด (ms)
 *     born,      // เวลาเกิดในฟาร์ม (ms) · 0 = ซื้อมา
 *     preg,      // เวลาที่เริ่มตั้งท้อง (ms) · 0 = ไม่ได้ท้อง
 *     bredAt,    // เวลาผสมพันธุ์ครั้งล่าสุด (ms ทั้งสองเพศ) · 0 = ยังไม่เคย
 *     at,        // เวลาที่ค่าข้างล่างถูกคำนวณ (ms) — ค่าปัจจุบัน = cowAt(cow, now)
 *     satiety,   // ความอิ่ม 0..100
 *     health,    // 0 = ตาย
 *     milk,      // นมในเต้า 0..100 (เพิ่มขึ้นเมื่ออิ่มและแข็งแรง)
 *   }],
 *   grass: {     // หญ้าในคอก (ไม่มี = เซฟเก่า → ถือว่าหญ้าเต็มตั้งแต่วัวตัวแรก ดู grassOf)
 *     at,        // เวลาที่ค่าข้างล่างถูกคำนวณ (ms)
 *     g: [24],   // หญ้าแต่ละแปลง 0..100 (แปลง i = แถว floor(i / GRASS_COLS) คอลัมน์ i % GRASS_COLS — ดู patchCenter)
 *     w: [24],   // ความชื้นดินแต่ละแปลง 0..100 (หญ้างอกเฉพาะตอนชื้น)
 *   }
 * }
 *
 * ค่าเปลี่ยนตามนาฬิกาจริงด้วยสูตรเดียวกันทั้งในเครื่องและฝั่งตรวจ จึงเก็บเฉพาะค่า ณ เวลาที่ผู้เล่นทำอะไรกับฟาร์ม
 * วัวกับหญ้าเดินเวลาไปพร้อมกัน (farmAt): วัวที่ยังไม่อิ่มเล็มหญ้าจากแปลงที่เลือกด้วยสูตร (grazePatch) — ฉาก 3 มิติให้วัวเดินไปเล็มแปลงเดียวกัน
 *
 * ผสมพันธุ์ (CONFIG.farm.breeding): แม่วัว + พ่อพันธุ์ที่โตแล้ว แข็งแรง อิ่ม และพ้นช่วงพัก → แม่ตั้งท้อง (preg)
 * ครบ gestationHours ชม. ผู้เล่นกดให้คลอด (birthCalf) → ลูกวัวสายพันธุ์ตัวเต็มวัยของแม่ (born) โตครบใน growHours ชม.
 * การตั้งท้องไม่มีผลอื่นกับการจำลอง (ยังให้นมตามปกติ)
 *
 * คำสั่งเซฟกลาง (shared/commands.js): buyCow · feedCow · milkCow · sellCow · waterGrass · breedCow · birthCalf — ตรวจด้วยฟังก์ชันชุดนี้ทั้งในเครื่องและฝั่งตรวจ
 * firestore.rules ตรวจรูปแบบ game.farm (validFarm) ให้ตรงกับ COW_KEYS / MAX_COW_RECORDS / GRASS_KEYS
 */

const HOUR = 3_600_000;
/** คำนวณทีละ 5 นาที (เหมือนทานตะวัน) */
const STEP_MS = 5 * 60_000;
/** ไม่คำนวณย้อนหลังเกิน 30 วัน */
const MAX_CATCH_UP_MS = 30 * 24 * HOUR;
/** เผื่อนาฬิกาเครื่องกับฝั่งตรวจต่างกันเล็กน้อย */
const SLACK = 2;
/** เผื่อเวลา (ms) ของฝั่งตรวจสำหรับเงื่อนไขที่ขึ้นกับเวลา (ครบกำหนดคลอด / พ้นช่วงพัก) — แบบเดียวกับเก็บเมล็ดทานตะวัน */
const TIME_SLACK_MS = 3000;

export const COW_KEYS = ['id', 'breedId', 'name', 'boughtAt', 'at', 'satiety', 'health', 'milk', 'sex', 'preg', 'bredAt', 'born'];
/** จำนวนวัวในเซฟสูงสุด (รวมตัวที่ตายแล้วแต่ยังไม่ได้นำออก) — ต้องตรงกับ validFarm ใน firestore.rules */
export const MAX_COW_RECORDS = 8;

/** ชื่อตั้งต้นของวัวตัวใหม่ (ผู้เล่นได้ชื่อสุ่มจากรายการนี้) */
export const COW_NAMES = ['มะลิ', 'ส้มโอ', 'คาราเมล', 'นมสด', 'ขาวมณี', 'ลูกชุบ', 'โกโก้', 'บัวลอย', 'ทองหยอด', 'ข้าวเหนียว', 'มัทฉะ', 'ขนมปัง', 'ชาไทย', 'ถั่วแดง'];

export const findCow = (farm, id) => farm?.cows?.find((c) => c.id === id) ?? null;

/** วัวตัวใหม่ (ซื้อ: born = 0 · เกิดในฟาร์ม: born = เวลาเกิด) */
export function newCow({ id, breedId, name, sex = 'f' }, now, { born = 0 } = {}) {
  return { id, breedId, name, sex, boughtAt: now, at: now, satiety: 80, health: 100, milk: 0, preg: 0, bredAt: 0, born };
}

export const isCowDead = (c) => !!c && c.health <= 0;
/** พ่อพันธุ์ (record ที่ไม่มี sex = แม่วัว) */
export const isBull = (c) => c?.sex === 'm';

/**
 * ลูกวัว: โตเต็มวัยตามเวลาจริง (ไม่ต้องเก็บค่าเพิ่มในเซฟ)
 *   - เกิดในฟาร์ม (born > 0): born + CONFIG.farm.breeding.growHours ชม. (breedId = สายพันธุ์ตัวเต็มวัยตั้งแต่เกิด)
 *   - ซื้อสายพันธุ์ลูกวัว (breed.calf): boughtAt + calf.growHours ชม. แล้วใช้ราคา/กฎของ calf.growsInto
 * ระหว่างเป็นลูกวัวยังไม่ผลิตนมและผสมพันธุ์ไม่ได้ · −Infinity = โตแล้วตั้งแต่แรก
 */
export function grownAt(c) {
  if (!c) return -Infinity;
  if (c.born > 0) return c.born + CONFIG.farm.breeding.growHours * HOUR;
  const calf = getCowBreed(c.breedId)?.calf;
  return calf ? c.boughtAt + calf.growHours * HOUR : -Infinity;
}

export const isCalf = (c, now) => !!c && now < grownAt(c);

/** สายพันธุ์ที่ใช้ตอนนี้ (ลูกวัวที่โตแล้ว = สายพันธุ์ตัวเต็มวัย) */
export function breedNow(c, now) {
  const breed = getCowBreed(c?.breedId);
  if (!breed?.calf || isCalf(c, now)) return breed;
  return getCowBreed(breed.calf.growsInto) ?? breed;
}

/** สายพันธุ์ตัวเต็มวัยของวัวตัวนี้ (brahman_calf → brahman · อื่น ๆ = ตัวเอง) — ฉาก 3 มิติใช้ adultBreedOf(c).young เป็นหน้าตาลูกวัว */
/** ผสมพันธุ์ได้ไหม (เฉพาะสายพันธุ์ที่มี canBreed — ตอนนี้วัวบราห์มัน · โฮลสไตน์/เจอร์ซีย์ยังเป็นโมเดลชั่วคราว เป็นตัวเมียเสมอ) */
export const canBreed = (c) => !!adultBreedOf(c)?.canBreed;

export function adultBreedOf(c) {
  const breed = getCowBreed(c?.breedId);
  if (!breed?.calf) return breed;
  return getCowBreed(breed.calf.growsInto) ?? breed;
}

/** ไม่ผลิตนม: พ่อพันธุ์ หรือยังเป็นลูกวัว ณ เวลา t */
const noMilk = (c, t) => isBull(c) || t < grownAt(c);

/** สถานะวัว ณ เวลา now (ไม่แก้ object เดิม) — เดินเวลาทีละช่วงจาก c.at */
export function cowAt(c, now) {
  if (!c) return null;
  const f = CONFIG.farm;
  const breed = getCowBreed(c.breedId);
  const out = { ...c };
  let t = c.at;
  const end = Math.min(now, t + MAX_CATCH_UP_MS);
  const grown = grownAt(c);
  while (t < end && out.health > 0) {
    const h = Math.min(STEP_MS, end - t) / HOUR;
    const fed = out.satiety > 0;
    out.satiety = Math.max(0, out.satiety - f.hungerUse * h);
    if (!fed) {
      out.health = Math.max(0, out.health - f.starveDamage * h);
    } else {
      out.health = Math.min(100, out.health + f.regen * h);
      const rate = t < grown || isBull(c) ? 0 : (breed?.milkPerHour ?? 0) * (out.health >= 50 ? 1 : 0.4);
      out.milk = Math.min(100, out.milk + rate * h);
    }
    t += Math.min(STEP_MS, end - t);
  }
  out.at = Math.max(c.at, now);
  return out;
}

// ── หญ้าในคอก ─────────────────────────────────────────────────

export const GRASS_COLS = 6;
export const GRASS_ROWS = 4;
export const GRASS_PATCHES = GRASS_COLS * GRASS_ROWS;
export const GRASS_KEYS = ['at', 'g', 'w'];
/** พื้นที่แปลงหญ้า (เมตร ในฉากฟาร์ม — ในรั้วคอก world/Farm.js PASTURE เว้นขอบ 0.5 ม.) */
export const GRASS_AREA = { minX: -10.5, maxX: 10.5, minZ: -7.5, maxZ: 7.5 };
export const PATCH_W = (GRASS_AREA.maxX - GRASS_AREA.minX) / GRASS_COLS;
export const PATCH_D = (GRASS_AREA.maxZ - GRASS_AREA.minZ) / GRASS_ROWS;

/** กลางแปลง i (x, z) */
export function patchCenter(i) {
  return { x: GRASS_AREA.minX + ((i % GRASS_COLS) + 0.5) * PATCH_W, z: GRASS_AREA.minZ + (Math.floor(i / GRASS_COLS) + 0.5) * PATCH_D };
}

/** แปลงที่จุด (x, z) อยู่ (-1 = นอกแปลง) */
export function patchAt(x, z) {
  const a = GRASS_AREA;
  if (!(x >= a.minX && x < a.maxX && z >= a.minZ && z < a.maxZ)) return -1;
  return Math.floor((z - a.minZ) / PATCH_D) * GRASS_COLS + Math.floor((x - a.minX) / PATCH_W);
}

export function newGrass(now) {
  const g = CONFIG.farm.grass;
  return { at: now, g: Array(GRASS_PATCHES).fill(100), w: Array(GRASS_PATCHES).fill(g.startWater) };
}

/** หญ้าของฟาร์ม (เซฟเก่าที่ยังไม่มี = หญ้าเต็มตั้งแต่ตอนที่มีวัวตัวแรก — ค่าคงที่ ไม่ขึ้นกับเวลาที่เปิดดู) */
export function grassOf(farm, now) {
  if (farm?.grass) return farm.grass;
  const ats = (farm?.cows ?? []).map((c) => c.at);
  return newGrass(ats.length ? Math.min(...ats) : now);
}

/**
 * แปลงที่วัวตัวนี้เล็ม: แปลงที่หญ้าเหลือมากที่สุด บวกค่าสุ่มคงที่ต่อวัว-แปลง (วัวแต่ละตัวชอบคนละแปลง ไม่รุมแปลงเดียว)
 * -1 = ไม่มีหญ้าเหลือ
 */
export function pickPatch(g, cowId) {
  const min = CONFIG.farm.grass.minBite;
  let best = -1;
  let bestScore = -Infinity;
  for (let i = 0; i < g.length; i++) {
    if (g[i] < min) continue;
    const score = g[i] + hashString(`${cowId}:${i}`) * 30;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** แปลงที่วัว (สถานะจาก farmAt) กำลังเล็มอยู่ — -1 = อิ่มแล้ว/ตาย/หญ้าหมด (ฉาก 3 มิติให้เดินเล่นตามปกติ) */
export function grazePatch(farm, cowId) {
  const c = findCow(farm, cowId);
  if (!c || isCowDead(c) || c.satiety >= CONFIG.farm.grass.grazeBelow || !farm.grass) return -1;
  return pickPatch(farm.grass.g, c.id);
}

/** ช่วงเวลา h ชม. ของหญ้า: ดินชื้นหญ้างอก · ความชื้นลดลง */
function growGrass(grass, h) {
  const gr = CONFIG.farm.grass;
  for (let i = 0; i < GRASS_PATCHES; i++) {
    const wet = grass.w[i] > 0;
    grass.w[i] = Math.max(0, grass.w[i] - gr.waterUse * h);
    if (wet && grass.g[i] < 100) grass.g[i] = Math.min(100, grass.g[i] + gr.growPerHour * h);
  }
}

/** ช่วงเวลา h ชม. ของวัว 1 ตัว (แก้ c ตรง ๆ) · grass = null → ไม่มีหญ้าให้เล็ม · dry = ไม่ผลิตนม (ลูกวัว/พ่อพันธุ์) */
function stepCow(c, breed, h, grass, dry = false) {
  const f = CONFIG.farm;
  const gr = f.grass;
  if (grass && c.satiety < gr.grazeBelow) {
    const p = pickPatch(grass.g, c.id);
    if (p >= 0) {
      const bite = Math.min(grass.g[p], gr.eatPerHour * h, (100 - c.satiety) / gr.food);
      grass.g[p] -= bite;
      c.satiety = Math.min(100, c.satiety + bite * gr.food);
    }
  }
  const fed = c.satiety > 0;
  c.satiety = Math.max(0, c.satiety - f.hungerUse * h);
  if (!fed) {
    c.health = Math.max(0, c.health - f.starveDamage * h);
  } else {
    c.health = Math.min(100, c.health + f.regen * h);
    const rate = dry ? 0 : (breed?.milkPerHour ?? 0) * (c.health >= 50 ? 1 : 0.4);
    c.milk = Math.min(100, c.milk + rate * h);
  }
}

/** เวลาล่าสุดที่ค่าในฟาร์มถูกคำนวณ (คำสั่งต้องไม่ย้อนก่อนเวลานี้) */
export function farmClock(farm) {
  return Math.max(farm?.grass?.at ?? 0, ...(farm?.cows ?? []).map((c) => c.at));
}

/**
 * ทั้งฟาร์ม ณ เวลา now (null = ยังไม่มีฟาร์ม) — วัวทุกตัวกับหญ้าเดินเวลาพร้อมกันทีละ 5 นาที
 * (วัวแย่งหญ้ากัน ค่าของแต่ละตัวจึงขึ้นกับตัวอื่น) · ผลมีรูปแบบเดียวกับ record ในเซฟ ใช้แทนที่ได้เลย
 */
export function farmAt(farm, now) {
  if (!farm) return null;
  const cows = farm.cows.map((c) => ({ ...c }));
  const src = grassOf(farm, now);
  const grass = { at: src.at, g: [...src.g], w: [...src.w] };
  const alive = cows.filter((c) => c.health > 0);
  let t = Math.max(now - MAX_CATCH_UP_MS, Math.min(grass.at, ...alive.map((c) => c.at)));
  const breeds = new Map(cows.map((c) => [c.id, getCowBreed(c.breedId)]));
  while (t < now) {
    const t1 = t + Math.min(STEP_MS, now - t);
    if (t1 > grass.at) growGrass(grass, (t1 - Math.max(t, grass.at)) / HOUR);
    const field = t >= grass.at ? grass : null; // เซฟเก่า: ก่อนมีหญ้าเล็มไม่ได้
    for (const c of alive) {
      if (t1 <= c.at || c.health <= 0) continue;
      stepCow(c, breeds.get(c.id), (t1 - Math.max(t, c.at)) / HOUR, field, noMilk(c, t));
    }
    t = t1;
  }
  for (const c of cows) c.at = Math.max(c.at, now);
  grass.at = Math.max(grass.at, now);
  return { ...farm, cows, grass };
}

/** รดน้ำแปลง i ได้ไหม (grass = ค่าจาก farmAt) → null = ได้ / รหัสเหตุผล */
export function grassBlock(grass, i, { strict = true } = {}) {
  if (!Number.isInteger(i) || i < 0 || i >= GRASS_PATCHES) return 'invalid';
  return grass.w[i] >= CONFIG.farm.grass.wetAbove + (strict ? 0 : SLACK) ? 'too-wet' : null;
}

/** ผลของการรดน้ำแปลง i ที่เวลา t (grass ผ่าน grassBlock แล้ว) */
export function waterPatch(grass, i, t) {
  const w = [...grass.w];
  w[i] = Math.min(100, w[i] + CONFIG.farm.grass.waterAmount);
  return { at: t, g: [...grass.g], w };
}

/** เหรียญที่ได้จากการรีดนม ณ ระดับนมตอนนี้ */
export function milkValue(c) {
  const reward = getCowBreed(c?.breedId)?.milkReward?.coins ?? 0;
  return Math.floor((reward * clamp(c?.milk ?? 0, 0, 100)) / 100);
}

/**
 * ตรวจว่าทำกับวัวตัวนี้ได้ไหม ณ สถานะปัจจุบัน (ค่าจาก cowAt) → null = ทำได้ / รหัสเหตุผล
 * strict = false ใช้ฝั่งตรวจ: เผื่อค่าคลาดเล็กน้อยจากเวลาเครื่องกับฝั่งตรวจไม่ตรงกัน
 * รหัส: not-found · dead · too-full · not-ready · male (พ่อพันธุ์รีดนมไม่ได้) · invalid
 * @param {'feed'|'milk'} action
 */
export function cowBlock(action, c, { strict = true } = {}) {
  const f = CONFIG.farm;
  const slack = strict ? 0 : SLACK;
  if (!c) return 'not-found';
  if (isCowDead(c)) return 'dead';
  if (action === 'feed') return c.satiety >= f.fullAbove + slack ? 'too-full' : null;
  if (action === 'milk' && isBull(c)) return 'male';
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

/**
 * เงินที่ได้เมื่อขายวัว: ตามราคาสายพันธุ์ × sellRate × สุขภาพ · ตายแล้ว = 0 (นำออกจากคอกเฉย ๆ)
 * ลูกวัวที่โตแล้วขายได้ตามราคาตัวเต็มวัย · ลูกวัวที่เกิดในฟาร์มและยังไม่โต = ครึ่งราคาตัวเต็มวัย
 */
export function cowSellValue(c) {
  const breed = c ? breedNow(c, c.at) : null;
  if (!breed || isCowDead(c)) return { coins: 0 };
  const young = c.born > 0 && isCalf(c, c.at) ? 0.5 : 1;
  return { coins: Math.floor((breed.price.coins ?? 0) * young * CONFIG.farm.sellRate * (0.5 + 0.5 * c.health / 100)) };
}

// ── ผสมพันธุ์ / ตั้งท้อง / คลอด ─────────────────────────────────

export const isPregnant = (c) => !!c && c.preg > 0;
/** เวลาครบกำหนดคลอด (Infinity = ไม่ได้ท้อง) */
export const dueAt = (c) => (isPregnant(c) ? c.preg + CONFIG.farm.breeding.gestationHours * HOUR : Infinity);

/**
 * ผสมแม่วัว cow กับพ่อพันธุ์ bull ได้ไหม ณ เวลา now (ค่าจาก farmAt) → null = ได้ / รหัสเหตุผล
 * not-found · dead · breed (สายพันธุ์ไม่มี canBreed) · not-female · not-male · young · pregnant · cooldown (ตัวใดตัวหนึ่งเพิ่งผสมไม่ถึง cooldownHours) · weak (สุขภาพ/ความอิ่มไม่ถึงเกณฑ์)
 * ต่างสายพันธุ์ที่ผสมได้ผสมกันได้ (ลูกเป็นสายพันธุ์ของแม่) · strict = false ใช้ฝั่งตรวจ (เผื่อค่าคลาด)
 */
export function breedBlock(cow, bull, now, { strict = true } = {}) {
  const b = CONFIG.farm.breeding;
  const slack = strict ? 0 : SLACK;
  if (!cow || !bull) return 'not-found';
  if (isCowDead(cow) || isCowDead(bull)) return 'dead';
  if (!canBreed(cow) || !canBreed(bull)) return 'breed';
  if (isBull(cow)) return 'not-female';
  if (!isBull(bull)) return 'not-male';
  if (isCalf(cow, now) || isCalf(bull, now)) return 'young';
  if (isPregnant(cow)) return 'pregnant';
  const rested = (c) => !(c.bredAt > 0) || now - c.bredAt >= b.cooldownHours * HOUR - (strict ? 0 : TIME_SLACK_MS);
  if (!rested(cow) || !rested(bull)) return 'cooldown';
  const weak = (c) => c.health < b.minHealth - slack || c.satiety < b.minSatiety - slack;
  if (weak(cow) || weak(bull)) return 'weak';
  return null;
}

/** ผลของการผสมพันธุ์ที่เวลา t (ผ่าน breedBlock แล้ว) */
export function applyBreed(cow, bull, t) {
  return { cow: { ...cow, at: t, preg: t, bredAt: t }, bull: { ...bull, at: t, bredAt: t } };
}

/**
 * ให้แม่วัวคลอดได้ไหม ณ เวลา now (farm = ค่าจาก farmAt) → null = ได้ / รหัสเหตุผล
 * not-found · dead · not-pregnant · not-ready (ยังไม่ครบกำหนด) · limit (วัวมีชีวิตเต็มคอก) · remove-dead (record เต็มเซฟ)
 */
export function birthBlock(farm, cow, now, { strict = true } = {}) {
  if (!cow) return 'not-found';
  if (isCowDead(cow)) return 'dead';
  if (!isPregnant(cow)) return 'not-pregnant';
  if (now < dueAt(cow) - (strict ? 0 : TIME_SLACK_MS)) return 'not-ready';
  const cows = farm?.cows ?? [];
  if (cows.filter((c) => !isCowDead(c)).length >= CONFIG.farm.maxCows) return 'limit';
  return cows.length >= MAX_COW_RECORDS ? 'remove-dead' : null;
}

/** ลูกวัวที่เกิดจากแม่ mother ที่เวลา t: สายพันธุ์ตัวเต็มวัยของแม่ · born = t */
export function newCalf({ id, name, sex }, mother, t) {
  return { ...newCow({ id, breedId: adultBreedOf(mother).id, name, sex }, t, { born: t }), satiety: 80 };
}

/** แม่วัวหลังคลอดที่เวลา t (หายท้อง · ช่วงพักนับจาก bredAt ตามเดิม) */
export function applyBirth(mother, t) {
  return { ...mother, at: t, preg: 0 };
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
    const time = (v) => (isNum(v) && v > 0 ? clamp(v, 0, at) : 0);
    cows.push({
      id: c.id,
      breedId: c.breedId,
      name: cleanName(c.name, getCowBreed(c.breedId).name),
      boughtAt: isNum(c.boughtAt) ? clamp(c.boughtAt, 0, at) : at,
      at,
      satiety: num(c.satiety, 0),
      health: num(c.health, 0),
      milk: num(c.milk, 0),
      sex: c.sex === 'm' ? 'm' : 'f',
      preg: c.sex === 'm' ? 0 : time(c.preg),
      bredAt: time(c.bredAt),
      born: time(c.born),
    });
    if (cows.length >= MAX_COW_RECORDS) break;
  }
  const grass = sanitizeGrass(raw.grass, now);
  return grass ? { cows, grass } : { cows };
}

/** หญ้าในเซฟ: ลิสต์ต้องครบ 24 แปลง (ไม่ครบ/เสีย = ตัดทิ้ง → grassOf สร้างหญ้าเต็มให้) · ค่าบีบเข้า 0..100 */
function sanitizeGrass(raw, now) {
  if (!raw || typeof raw !== 'object' || !isNum(raw.at)) return null;
  if (!Array.isArray(raw.g) || !Array.isArray(raw.w) || raw.g.length !== GRASS_PATCHES || raw.w.length !== GRASS_PATCHES) return null;
  const num = (v) => (isNum(v) ? clamp(v, 0, 100) : 0);
  return { at: clamp(raw.at, 0, now), g: raw.g.map(num), w: raw.w.map(num) };
}
