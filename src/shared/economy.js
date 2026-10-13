import { CONFIG } from '../config.js';
import { getSpecies } from '../data/fish.js';
import { FOOD_TYPES } from '../data/food.js';
import { getTankType } from '../data/tanks.js';
import { MISSIONS } from '../data/missions.js';
import { clamp } from '../utils/math.js';
import { LIMITS } from './constants.js';

/**
 * กฎเศรษฐกิจของเกมที่ต้องตรงกันทั้งในเครื่องและบนเซิร์ฟเวอร์
 * ทุกฟังก์ชันรับ "game" = ข้อมูลเซฟแบบ plain object (รูปเดียวกับ GameState.data)
 */

export class CommandError extends Error {
  constructor(code, detail = '') {
    super(detail ? `${code}: ${detail}` : code);
    this.code = code;
  }
}

export function fail(code, detail) {
  throw new CommandError(code, detail);
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// IDs also index plain-object metadata maps; inherited names must never become keys.
export const isId = (v) => typeof v === 'string' && ID_RE.test(v) && !Object.prototype.hasOwnProperty.call(Object.prototype, v);
export const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

export function needId(v, what = 'id') {
  return isId(v) ? v : fail('invalid', what);
}

export function needNum(v, what = 'number') {
  return isNum(v) ? v : fail('invalid', what);
}

export function needInt(v, min, max, what = 'int') {
  return Number.isInteger(v) && v >= min && v <= max ? v : fail('invalid', what);
}

/** ชื่อปลา: ตัดช่องว่าง/อักขระควบคุม ยาวไม่เกิน 16 (เหมือนการ์ดปลา) ว่าง = ใช้ชื่อสายพันธุ์ */
export function cleanName(value, fallback) {
  const s = typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16) : '';
  return s || fallback;
}

// ── เงิน ─────────────────────────────────────────────────────

export const priceOf = (p) => ({ coins: Math.max(0, Math.floor(p?.coins ?? 0)), gems: Math.max(0, Math.floor(p?.gems ?? 0)) });

export function canAfford(game, price) {
  const p = priceOf(price);
  return p.coins <= game.coins && p.gems <= game.gems;
}

export function spend(game, price) {
  const p = priceOf(price);
  if (!canAfford(game, p)) fail('insufficient-funds');
  game.coins -= p.coins;
  game.gems -= p.gems;
}

export function earn(game, reward) {
  game.coins = Math.min(LIMITS.maxCoins, game.coins + Math.max(0, Math.floor(reward?.coins ?? 0)));
  game.gems = Math.min(LIMITS.maxGems, game.gems + Math.max(0, Math.floor(reward?.gems ?? 0)));
}

export function needItemSpace(game, key, amount) {
  if ((game.inventory[key] ?? 0) + amount > LIMITS.maxItem) fail('limit', 'inventory');
}

export function addItem(game, key, amount) {
  game.inventory[key] = (game.inventory[key] ?? 0) + amount;
}

export function useItem(game, key, amount = 1) {
  if ((game.inventory[key] ?? 0) < amount) fail('out-of-stock', key);
  game.inventory[key] -= amount;
}

/** ราคาขายปลาคืน (เหมือน Game.sellValue) */
export function fishSellValue(species, growth) {
  const k = CONFIG.sellRate * (0.5 + growth * 0.5);
  return { coins: Math.floor((species.price.coins ?? 0) * k), gems: Math.floor((species.price.gems ?? 0) * k) };
}

/** ราคาขายของตกแต่งคืน (เหมือน PlacementController.sellValue) */
export function decorSellValue(item) {
  const p = item.price ?? {};
  return { coins: Math.floor((p.coins ?? 0) * CONFIG.decorSellRate), gems: Math.floor((p.gems ?? 0) * CONFIG.decorSellRate) };
}

// ── ตู้ / ปลา ───────────────────────────────────────────────

export function findTank(game, id) {
  return game.tanks.find((t) => t.id === id);
}

export function needTank(game, id) {
  return findTank(game, id) ?? fail('not-found', 'tank');
}

export function findFishAnywhere(game, id) {
  for (const t of game.tanks) {
    const f = t.fish.find((x) => x.id === id);
    if (f) return f;
  }
  return null;
}

export function findDecorAnywhere(game, id) {
  for (const t of game.tanks) {
    const d = t.decor.find((x) => x.id === id);
    if (d) return d;
  }
  return null;
}

/** วางของได้ไหม (สูตรเดียวกับ Aquarium.isInside) */
export function isInsideTank(tank, item, x, z) {
  const { w, d } = getTankType(tank.typeId).size;
  const r = item.radius * 0.7;
  return Math.abs(x) <= w / 2 - r + 0.01 && Math.abs(z) <= d / 2 - r + 0.01;
}

/** ของชิ้นนี้ในตู้ครบจำนวนที่วางได้แล้วหรือยัง (item.maxPerTank) */
export function atDecorLimit(tank, item) {
  return item.maxPerTank != null && tank.decor.filter((d) => d.itemId === item.id).length >= item.maxPerTank;
}

/** เวลา (ms) ที่ไข่มุกของหอยชิ้นนี้จะพร้อมเก็บ — pearlAt = เวลาที่วางหรือเก็บไข่มุกครั้งล่าสุด (ไม่มี = พร้อมแล้ว) */
export function pearlReadyAt(decor, item) {
  return (decor.pearlAt ?? 0) + item.pearl.interval * 1000;
}

/** อาหารที่ช่วยให้โตไวที่สุด — ใช้คำนวณเพดานการเติบโต */
export const MAX_GROWTH_BOOST = Math.max(1, ...FOOD_TYPES.map((f) => f.growth ?? 1));

/** ปลาโตได้มากที่สุดเท่าไรในเวลา seconds (เวลาจำลอง) */
export function maxGrowthIn(species, seconds) {
  return (Math.max(0, seconds) * MAX_GROWTH_BOOST) / species.care.growTime;
}

/** อัตราผลิตเหรียญสูงสุดที่เป็นไปได้ของตู้ (เหรียญ/วินาทีจริง) — เผื่อปลามีความสุขเต็มที่และสุ่มรอบเร็วสุด */
export function maxCoinRate(tank) {
  let rate = 0;
  for (const fish of tank.fish) {
    const s = getSpecies(fish.speciesId);
    if (!s) continue;
    const adult = fish.growth >= 1;
    const coin = Math.max(1, Math.round(s.economy.coinValue * 1.5 * (adult ? 1 : 0.5)));
    rate += (coin + 1) / (s.economy.coinInterval * 0.85);
  }
  return rate * CONFIG.timeScale;
}

/** เพดานเหรียญที่เก็บรวดเดียวได้ (เหรียญสะสมในตู้ได้ราว 2 นาที) */
export function coinBankCap(tank) {
  return maxCoinRate(tank) * 120 + 50;
}

/** วินาทีจำลองที่ผ่านไปตั้งแต่ตู้ถูกจำลองครั้งล่าสุด (สูตรเดียวกับ GameState.catchUpTank) */
export function offlineSeconds(lastUpdate, now) {
  return clamp((now - (lastUpdate ?? now)) / 1000, 0, CONFIG.offline.maxSeconds) * CONFIG.timeScale;
}

/** เหรียญที่ปลาหาได้ระหว่างออฟไลน์ seconds วินาที (สูตรเดียวกับ GameState.catchUpTank เดิม) */
export function offlineCoins(tank, seconds) {
  const off = CONFIG.offline;
  let rate = 0;
  for (const fish of tank.fish) {
    const s = getSpecies(fish.speciesId);
    if (!s) continue;
    const growSeconds = clamp((fish.satiety - 30) / s.care.hungerRate, 0, seconds);
    const growth = Math.min(1, fish.growth + growSeconds / s.care.growTime);
    rate += (s.economy.coinValue / s.economy.coinInterval) * (0.5 + growth * 0.5);
  }
  return Math.floor(rate * Math.min(seconds, off.coinSeconds) * off.coinRate);
}

// ── ภารกิจ ──────────────────────────────────────────────────

/** ขึ้นวันใหม่ → ล้างความคืบหน้าภารกิจรายวัน (เหมือน MissionSystem.ensureDay) */
export function ensureMissionDay(game, day) {
  if (game.missions.day === day) return;
  for (const m of MISSIONS) {
    if (!m.daily) continue;
    delete game.missions.progress[m.id];
    delete game.missions.claimed[m.id];
  }
  game.missions.day = day;
}

/** นับความคืบหน้าจากเหตุการณ์ (เหมือน MissionSystem.#onEvent) */
export function bumpMissions(game, event, amount, day) {
  ensureMissionDay(game, day);
  for (const m of MISSIONS) {
    if (m.event !== event) continue;
    const before = game.missions.progress[m.id] ?? 0;
    if (game.missions.claimed[m.id] || before >= m.target) continue;
    game.missions.progress[m.id] = Math.min(m.target, before + amount);
  }
}

export function missionProgress(game, m) {
  const stored = game.missions.progress[m.id] ?? 0;
  const live = m.gauge ? m.gauge(game) : 0;
  return Math.min(m.target, Math.max(stored, live));
}

// ── metadata ต่อตู้ (ใช้ฝั่งเซิร์ฟเวอร์) ─────────────────────

/** meta.tanks[tankId] = { simRev, simBy, simAt, incomeBank, incomeAt, lastFedAt, foodHealthBudget, lastMedAt, offlineAt, bredAt } */
export function tankMeta(meta, tankId) {
  meta.tanks ??= {};
  return (meta.tanks[tankId] ??= { simRev: 0 });
}

export function summarizeGame(game) {
  return {
    coins: game.coins,
    gems: game.gems,
    fish: game.tanks.reduce((n, t) => n + t.fish.length, 0),
    tanks: game.tanks.length,
    decor: game.tanks.reduce((n, t) => n + t.decor.length, 0),
  };
}
