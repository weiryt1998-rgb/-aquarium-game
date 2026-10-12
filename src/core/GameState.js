import { CONFIG } from '../config.js';
import { EV } from './EventBus.js';
import { loadSettings, saveSettings } from './settings.js';
import { FISH_NAMES, FISH_SPECIES, getSpecies } from '../data/fish.js';
import { getTankType } from '../data/tanks.js';
import { earn, offlineCoins, offlineSeconds } from '../shared/economy.js';
import { clamp, pick, rand, todayKey, uid } from '../utils/math.js';

/** ของตกแต่งเริ่มต้น: [itemId, u, v, rotY] โดย u,v อยู่ในช่วง -1..1 (สัดส่วนของความกว้าง/ลึกตู้) */
const STARTER_DECOR = [
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

const STARTER_FISH = ['goldfish', 'betta', 'clownfish', 'yellowtang', 'angelfish', 'guppy', 'guppy', 'neon', 'neon', 'neon'];

export function createFishRecord(speciesId, { growth = 1, satiety = 75, name } = {}) {
  const species = getSpecies(speciesId);
  return {
    id: uid('fish'),
    speciesId,
    name: name ?? pick(FISH_NAMES),
    gender: Math.random() < 0.5 ? 'm' : 'f',
    satiety,
    health: 100,
    growth,
    age: 0,
    breedCooldown: rand(30, 90),
    coinTimer: rand(5, species?.economy.coinInterval ?? 30),
  };
}

export function createDecorRecord(itemId, x, z, rotY = 0) {
  return { id: uid('decor'), itemId, x, z, rotY };
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
    const off = CONFIG.offline;
    const seconds = offlineSeconds(tank.lastUpdate, now);
    tank.lastUpdate = now;
    if (seconds < 5) return { seconds: 0, coins: 0 };

    // คิดเหรียญก่อนปรับค่าปลา (สูตรเดียวกับที่เซิร์ฟเวอร์ใช้ตรวจ ดู shared/economy.js)
    const coins = giveCoins ? offlineCoins(tank, seconds) : 0;
    for (const fish of tank.fish) {
      const species = getSpecies(fish.speciesId);
      if (!species) continue;
      const rate = species.care.hungerRate;
      const before = fish.satiety;
      // ช่วงเวลาที่ยังอิ่มพอจะโตได้
      const growSeconds = clamp((before - 30) / rate, 0, seconds);
      fish.growth = Math.min(1, fish.growth + growSeconds / species.care.growTime);
      fish.satiety = Math.max(before - rate * seconds, Math.min(before, off.minSatiety));
      fish.breedCooldown = Math.max(0, (fish.breedCooldown ?? 0) - seconds);
      fish.age = (fish.age ?? 0) + seconds;
    }
    const dirt = (CONFIG.care.dirtBase + CONFIG.care.dirtPerFish * tank.fish.length) * seconds;
    tank.cleanliness = Math.max(tank.cleanliness - dirt, Math.min(tank.cleanliness, off.minCleanliness));

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
    return FISH_SPECIES.filter((s) => this.data.collection[s.id]).length;
  }

  hasRareFish(minRarity) {
    return this.data.tanks.some((t) => t.fish.some((f) => (getSpecies(f.speciesId)?.rarity ?? 0) >= minRarity));
  }
}
