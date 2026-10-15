import { CONFIG } from '../config.js';
import { FISH_SPECIES, getSpecies } from '../data/fish.js';
import { getDecorItem } from '../data/decor.js';
import { FOOD_TYPES, CARE_ITEMS, getFood } from '../data/food.js';
import { MISSIONS } from '../data/missions.js';
import { getTankType } from '../data/tanks.js';
import { createDefaultState } from '../core/GameState.js';
import { clamp, todayKey, uid } from '../utils/math.js';
import { LIMITS } from './constants.js';
import { isId, isNum } from './economy.js';
import { sanitizeFetus } from './breeding.js';
import { sanitizeGenes } from '../models/molly/genetics.js';

/**
 * ทำความสะอาดข้อมูลเกมที่มาจากภายนอก (เซฟเก่าใน localStorage, จุดสำรอง) ให้อยู่ในรูปที่ถูกต้องเสมอ
 * ใช้ทั้งในเครื่องและบนเซิร์ฟเวอร์ — ค่าที่ไม่รู้จักถูกตัดทิ้ง ค่าตัวเลขถูกบีบให้อยู่ในช่วงที่เป็นไปได้
 */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ITEM_KEYS = [...FOOD_TYPES.map((f) => f.id), ...CARE_ITEMS.map((c) => c.id)];
const STAT_KEYS = ['feeds', 'coinsCollected', 'fishBorn', 'fishBought'];

const num = (v, min, max, fallback) => (isNum(v) ? clamp(v, min, max) : fallback);
const int = (v, min, max, fallback) => Math.floor(num(v, min, max, fallback));
const obj = (v) => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
const text = (v, max, fallback) => (typeof v === 'string' && v.trim() ? v.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : fallback);

function freshId(prefix, taken) {
  let id;
  do id = uid(prefix);
  while (taken.has(id));
  return id;
}

function sanitizeFish(raw, taken, now = Date.now()) {
  const species = getSpecies(raw?.speciesId);
  if (!species) return null;
  const id = isId(raw.id) && !taken.has(raw.id) ? raw.id : freshId('fish', taken);
  taken.add(id);
  const gender = raw.gender === 'm' ? 'm' : 'f';
  const fish = {
    id,
    speciesId: species.id,
    name: text(raw.name, LIMITS.nameLength, species.name),
    gender,
    satiety: num(raw.satiety, 0, 100, 70),
    health: num(raw.health, 0, 100, 100),
    growth: num(raw.growth, 0, 1, 1),
    age: num(raw.age, 0, 1e10, 0),
    breedCooldown: num(raw.breedCooldown, 0, CONFIG.breeding.cooldown, 60),
    coinTimer: num(raw.coinTimer, 0, species.economy.coinInterval * 1.25, species.economy.coinInterval / 2),
  };
  // ยีนสีของลูกผสม (เฉพาะสายพันธุ์ที่มีระบบสี)
  const genes = species.procedural?.type === 'molly' ? sanitizeGenes(raw.genes) : null;
  if (genes) fish.genes = genes;
  // ตั้งท้องอยู่ (เฉพาะตัวเมีย) — เวลาต้องไม่ล้ำอนาคต พร้อมลูกในท้อง
  if (gender === 'f' && isNum(raw.pregnantAt) && raw.pregnantAt > 0) {
    fish.pregnantAt = Math.min(raw.pregnantAt, now);
    const fetus = raw.fetus ? sanitizeFetus(raw.fetus, fish) : null;
    if (fetus) fish.fetus = fetus;
  }
  // พักฟื้นหลังคลอด (เฉพาะตัวเมีย) — เวลาต้องไม่ล้ำอนาคต
  if (gender === 'f' && isNum(raw.lastBirthAt) && raw.lastBirthAt > 0) fish.lastBirthAt = Math.min(raw.lastBirthAt, now);
  return fish;
}

function sanitizeDecor(raw, type, taken, now) {
  const item = getDecorItem(raw?.itemId);
  if (!item) return null;
  const id = isId(raw.id) && !taken.has(raw.id) ? raw.id : freshId('decor', taken);
  taken.add(id);
  const r = item.radius * 0.7;
  const maxX = Math.max(0, type.size.w / 2 - r);
  const maxZ = Math.max(0, type.size.d / 2 - r);
  const record = {
    id,
    itemId: item.id,
    x: num(raw.x, -maxX, maxX, 0),
    z: num(raw.z, -maxZ, maxZ, 0),
    rotY: num(raw.rotY, -1e6, 1e6, 0),
  };
  if (item.pearl) record.pearlAt = num(raw.pearlAt, 0, now, now);
  return record;
}

/** ตัดของที่เกินจำนวนต่อตู้ (item.maxPerTank) — เก็บชิ้นที่มาก่อน */
function withinItemLimits(decor) {
  const counts = new Map();
  return decor.filter((d) => {
    const n = (counts.get(d.itemId) ?? 0) + 1;
    counts.set(d.itemId, n);
    return n <= (getDecorItem(d.itemId).maxPerTank ?? Infinity);
  });
}

function sanitizeTanks(rawTanks, now) {
  const tanks = [];
  const tankIds = new Set();
  const fishIds = new Set();
  const decorIds = new Set();
  for (const raw of Array.isArray(rawTanks) ? rawTanks : []) {
    const type = getTankType(raw?.typeId);
    if (!type || tanks.some((t) => t.typeId === type.id)) continue; // ชนิดละ 1 ตู้
    const id = isId(raw.id) && !tankIds.has(raw.id) ? raw.id : freshId('tank', tankIds);
    tankIds.add(id);
    const fish = (Array.isArray(raw.fish) ? raw.fish : []).map((f) => sanitizeFish(f, fishIds, now)).filter(Boolean).slice(0, type.capacity);
    const decor = withinItemLimits(
      (Array.isArray(raw.decor) ? raw.decor : []).map((d) => sanitizeDecor(d, type, decorIds, now)).filter(Boolean),
    ).slice(0, LIMITS.decorPerTank);
    tanks.push({
      id,
      typeId: type.id,
      name: text(raw.name, 40, type.name),
      cleanliness: num(raw.cleanliness, 0, 100, 100),
      fish,
      decor,
      lastUpdate: num(raw.lastUpdate, 0, now, now),
    });
  }
  return tanks;
}

function sanitizeMissions(raw, today) {
  const src = obj(raw);
  const progress = {};
  const claimed = {};
  for (const m of MISSIONS) {
    const p = obj(src.progress)[m.id];
    if (isNum(p) && p > 0) progress[m.id] = Math.floor(clamp(p, 0, m.target));
    if (obj(src.claimed)[m.id] === true) claimed[m.id] = true;
  }
  return { day: typeof src.day === 'string' && DAY_RE.test(src.day) ? src.day : today, progress, claimed };
}

/** แปลงข้อมูลเกมใด ๆ ให้เป็นเซฟที่ถูกต้อง (ไม่มี settings — เป็นค่าของแต่ละเครื่อง) */
export function sanitizeGame(raw, { now = Date.now() } = {}) {
  const src = obj(raw);
  const defaults = createDefaultState();
  const inventory = {};
  for (const key of ITEM_KEYS) inventory[key] = int(obj(src.inventory)[key], 0, LIMITS.maxItem, defaults.inventory[key] ?? 0);
  const stats = {};
  for (const key of STAT_KEYS) stats[key] = int(obj(src.stats)[key], 0, 1e12, 0);

  let tanks = sanitizeTanks(src.tanks, now);
  if (tanks.length === 0) tanks = defaults.tanks;

  const collection = {};
  for (const s of FISH_SPECIES) if (obj(src.collection)[s.id] === true) collection[s.id] = true;
  for (const t of tanks) for (const f of t.fish) collection[f.speciesId] = true;

  return {
    version: CONFIG.saveVersion,
    coins: int(src.coins, 0, LIMITS.maxCoins, defaults.coins),
    gems: int(src.gems, 0, LIMITS.maxGems, defaults.gems),
    inventory,
    selectedFood: getFood(src.selectedFood) ? src.selectedFood : 'flakes',
    collection,
    tanks,
    activeTankId: tanks.some((t) => t.id === src.activeTankId) ? src.activeTankId : tanks[0].id,
    missions: sanitizeMissions(src.missions, todayKey(new Date(now))),
    dailyRewardDay: typeof src.dailyRewardDay === 'string' && DAY_RE.test(src.dailyRewardDay) ? src.dailyRewardDay : null,
    lastCleanAt: num(src.lastCleanAt, 0, now, 0),
    stats,
    lastSaved: num(src.lastSaved, 0, now, now),
  };
}

/** เซฟเริ่มต้นของเกมใหม่ (ตู้เริ่มต้น + ปลาและของตกแต่งชุดแรก เหมือนเดิม) */
export function createInitialGame({ now = Date.now() } = {}) {
  return sanitizeGame(createDefaultState(), { now });
}
