import { CONFIG } from '../config.js';
import { EV } from './EventBus.js';
import { loadSettings, saveSettings } from './settings.js';
import { AVAILABLE_SPECIES, getSpecies } from '../data/fish.js';
import { getDecorItem } from '../data/decor.js';
import { getTankType } from '../data/tanks.js';
import { earn, offlineCoins, offlineSeconds } from '../shared/economy.js';
import { todayKey, uid } from '../utils/math.js';
import { createFishRecord } from '../sim/records.ts';
import { catchUpTank } from '../sim/offline.ts';

/** ของตกแต่งเริ่มต้น: [itemId, u, v, rotY] โดย u,v อยู่ในช่วง -1..1 (สัดส่วนของความกว้าง/ลึกตู้) */
export const STARTER_DECOR = [
  ['plant_vallis', -0.88, -0.65, 0],
  ['plant_vallis', -0.7, -0.82, 1.2],
  ['plant_fern', -0.62, 0.05, 0.5],
  ['plant_red', -0.42, -0.55, 0],
  ['rock_grey', -0.78, 0.55, 0.4],
  ['driftwood', -0.12, -0.05, 0.1],
  ['rock_blue', -0.02, 0.55, 0.8],
  ['rock_purple', 0.2, 0.62, 2.1],
  ['chest', 0.3, 0.12, -0.35],
  ['castle', 0.62, -0.25, -0.2],
  ['coral', 0.28, -0.7, 0],
  ['plant_vallis', 0.9, -0.6, 0.7],
  ['plant_fern', 0.88, 0.25, 2.2],
  ['rock_grey', 0.72, 0.65, 1.3],
  ['plant_grass', -0.35, 0.7, 0],
  ['plant_grass', 0.5, 0.78, 0],
  ['bubbler', 0.08, -0.78, 0],
];

const STARTER_FISH = ['molly_golddust', 'crab', 'molly_redhead', 'molly_redhead', 'molly_golden', 'molly_golden', 'molly_calico', 'molly_dalmatian', 'molly_dalmatian', 'molly_dalmatian'];

// สร้าง record ปลาอยู่ใน Simulation Engine (คลอดลูกต้องใช้ด้วย) — ส่งต่อชื่อเดิมให้โค้ดส่วนอื่น
export { createFishRecord };

export function createDecorRecord(itemId, x, z, rotY = 0) {
  const record = { id: uid('decor'), itemId, x, z, rotY };
  if (getDecorItem(itemId)?.pearl) record.pearlAt = Date.now(); // หอยเริ่มแบบปิดฝา
  return record;
}

export function createTankRecord(typeId, withStarterContent = false) {
  const type = getTankType(typeId);
  const tank = {
    id: uid('tank'),
    typeId,
    name: type.name,
    cleanliness: 100,
    fish: [],
    decor: [],
    lastUpdate: Date.now(),
  };
  if (withStarterContent) {
    const { w, d } = type.size;
    const halfW = w / 2 - 0.6;
    const halfD = d / 2 - 0.5;
    tank.decor = STARTER_DECOR.map(([itemId, u, v, rot]) => createDecorRecord(itemId, u * halfW, v * halfD, rot));
    tank.fish = STARTER_FISH.map((id) => createFishRecord(id, { satiety: 70 }));
  }
  return tank;
}

export function createDefaultState() {
  const tank = createTankRecord('starter', true);
  const collection = {};
  tank.fish.forEach((f) => (collection[f.speciesId] = true));
  return {
    version: CONFIG.saveVersion,
    coins: CONFIG.start.coins,
    gems: CONFIG.start.gems,
    inventory: { ...CONFIG.start.inventory },
    selectedFood: 'flakes',
    collection,
    tanks: [tank],
    activeTankId: tank.id,
    missions: { day: todayKey(), progress: {}, claimed: {} },
    dailyRewardDay: null,
    lastCleanAt: 0,
    stats: { feeds: 0, coinsCollected: 0, fishBorn: 0, fishBought: 0 },
    lastSaved: Date.now(),
  };
}

/**
 * สถานะเกมทั้งหมดที่ต้องบันทึก (เงิน ปลา ของตกแต่ง ภารกิจ)
 * entity ในฉาก (Fish, Decoration) อ้างอิง record ในนี้โดยตรง
 * ข้อมูลจริงอยู่ในเซฟกลางบน Cloud Firestore — คลาสนี้ถือสำเนาที่กำลังเล่น แล้วส่ง "คำสั่ง" (ซื้อ ขาย เก็บเหรียญ ฯลฯ)
 * ให้ระบบเซฟกลาง (sink) ตรวจและบันทึก ส่วนการตั้งค่าเสียง/กราฟิกเป็นของแต่ละอุปกรณ์ (core/settings.js)
 */
export class GameState {
  constructor(events, { data, isNewGame = false } = {}) {
    this.events = events;
    this.isNewGame = isNewGame;
    this.data = data ?? createDefaultState();
    this.settings = loadSettings();
    /** ระบบเซฟกลาง (cloud/CloudSync.js) — รับคำสั่งและคำขอบันทึก */
    this.sink = null;
  }

  // ── บันทึก ──────────────────────────────────────────────────

  /** ขอให้บันทึก: เซฟกลางจะรวมการบันทึกให้ไม่ถี่เกินไป, urgent = ส่งทันที (เช่น ตอนปิดแท็บ) */
  save({ urgent = false } = {}) {
    saveSettings(this.settings);
    const tank = this.activeTank;
    if (tank) tank.lastUpdate = Date.now();
    this.sink?.requestSave({ urgent });
  }

  /** ส่งการกระทำที่มีผลกับเงิน/ของ/ปลา ให้เซิร์ฟเวอร์ตรวจซ้ำแล้วบันทึกลงเซฟกลาง */
  record(command) {
    this.sink?.record(command);
  }

  // ── ตู้ปลา ──────────────────────────────────────────────────

  get activeTank() {
    return this.getTank(this.data.activeTankId) ?? this.data.tanks[0];
  }

  getTank(id) {
    return this.data.tanks.find((t) => t.id === id);
  }

  ownsTankType(typeId) {
    return this.data.tanks.some((t) => t.typeId === typeId);
  }

  addTank(typeId) {
    const tank = createTankRecord(typeId);
    this.data.tanks.push(tank);
    return tank;
  }

  /**
   * จำลองเวลาที่ผ่านไปตอนผู้เล่นไม่อยู่ (ปิดเกม/อยู่ตู้อื่น)
   * ปลาจะหิวและน้ำจะสกปรกลง แต่ไม่ต่ำกว่าค่าขั้นต่ำ เพื่อไม่ให้ปลาตายตอนไม่อยู่
   * @returns {{ seconds: number, coins: number }}
   */
  catchUpTank(tank, now = Date.now(), { giveCoins = false } = {}) {
    const seconds = offlineSeconds(tank.lastUpdate, now);
    tank.lastUpdate = now;
    if (seconds < 5) return { seconds: 0, coins: 0 };

    // คิดเหรียญก่อนปรับค่าปลา (สูตรเดียวกับที่เซิร์ฟเวอร์ใช้ตรวจ ดู shared/economy.js)
    const coins = giveCoins ? offlineCoins(tank, seconds) : 0;
    catchUpTank(tank, seconds);
    if (coins > 0) this.earn({ coins });
    return { seconds, coins };
  }

  // ── เงิน ────────────────────────────────────────────────────

  get coins() {
    return this.data.coins;
  }

  get gems() {
    return this.data.gems;
  }

  canAfford(price) {
    if (!price) return true;
    return (price.coins ?? 0) <= this.data.coins && (price.gems ?? 0) <= this.data.gems;
  }

  spend(price) {
    if (!this.canAfford(price)) return false;
    this.data.coins -= price.coins ?? 0;
    this.data.gems -= price.gems ?? 0;
    this.events.emit(EV.CURRENCY, { coins: this.data.coins, gems: this.data.gems });
    return true;
  }

  earn(reward) {
    if (!reward) return;
    earn(this.data, reward);
    this.events.emit(EV.CURRENCY, { coins: this.data.coins, gems: this.data.gems, reward });
  }

  // ── คลังของ ─────────────────────────────────────────────────

  itemCount(key) {
    return this.data.inventory[key] ?? 0;
  }

  addItem(key, amount = 1) {
    this.data.inventory[key] = this.itemCount(key) + amount;
    this.events.emit(EV.INVENTORY, { key, count: this.data.inventory[key] });
  }

  useItem(key, amount = 1) {
    if (this.itemCount(key) < amount) return false;
    this.data.inventory[key] -= amount;
    this.events.emit(EV.INVENTORY, { key, count: this.data.inventory[key] });
    return true;
  }

  // ── สมุดสะสม ────────────────────────────────────────────────

  discover(speciesId) {
    if (this.data.collection[speciesId]) return false;
    this.data.collection[speciesId] = true;
    this.events.emit(EV.COLLECTION, { speciesId, count: this.collectionCount });
    return true;
  }

  isDiscovered(speciesId) {
    return !!this.data.collection[speciesId];
  }

  get collectionCount() {
    return AVAILABLE_SPECIES.filter((s) => this.data.collection[s.id]).length;
  }

  hasRareFish(minRarity) {
    return this.data.tanks.some((t) => t.fish.some((f) => (getSpecies(f.speciesId)?.rarity ?? 0) >= minRarity));
  }
}
