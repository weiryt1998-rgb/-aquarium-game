import { CONFIG } from '../config.js';
import { EV } from '../core/EventBus.js';
import { clamp } from '../utils/math.js';

/**
 * ระดับความสกปรกของน้ำ (เรียงจากสะอาดไปสกปรก) — ภาพในตู้ (สีน้ำ ตะไคร่) เปลี่ยนต่อเนื่องตามความสะอาด
 * ส่วนขั้นเหล่านี้ใช้แจ้งเตือนผู้เล่นและบอกผลต่อปลา
 */
export const WATER_STAGES = [
  { min: 70, name: 'น้ำใส', emoji: '💧' },
  { min: 45, name: 'น้ำเริ่มขุ่น', emoji: '🌿', warn: '🌿 น้ำเริ่มขุ่น มีตะไคร่เกาะกระจกแล้ว — ปลาเริ่มไม่ค่อยมีความสุข' },
  { min: 25, name: 'น้ำขุ่นเขียว', emoji: '🟢', warn: '⚠️ น้ำขุ่นเขียว ตะไคร่ลามทั่วตู้ ปลาเริ่มป่วยและไม่ฟื้นตัว — กด 🧽 ทำความสะอาดตู้' },
  { min: 0, name: 'น้ำเน่า', emoji: '🤢', warn: '🚨 น้ำเน่ามาก! ปลาสุขภาพทรุดลงเร็ว ต้องทำความสะอาดตู้ด่วน' },
];

export const waterStageIndex = (cleanliness) => WATER_STAGES.findIndex((s) => cleanliness >= s.min);

/** สุขภาพที่ลดต่อวินาทีจากน้ำสกปรก: 0 เมื่อสะอาดกว่า dirtyFrom แล้วแรงขึ้นแบบโค้ง (น้ำเน่าหนักอันตรายกว่าขุ่นนิดหน่อยมาก) */
export function dirtyHealthDamage(cleanliness) {
  const C = CONFIG.care;
  if (cleanliness >= C.dirtyFrom) return 0;
  return C.dirtyDamage * 1.3 * ((C.dirtyFrom - cleanliness) / C.dirtyFrom) ** 1.6;
}

/** ค่าสถานะระดับตู้: ความสะอาดของน้ำ ค่าเฉลี่ยความสุข/สุขภาพ และการทำความสะอาด */
export class CareSystem {
  constructor(game) {
    this.game = game;
    this.avgHappiness = 0;
    this.avgHealth = 0;
    this.avgSatiety = 0;
    this.crowdPenalty = 0;
    this.lastQuality = -1;
  }

  get tank() {
    return this.game.state.activeTank;
  }

  get cleanliness() {
    return this.tank.cleanliness;
  }

  update(simDt) {
    const tank = this.tank;
    const fish = this.game.fish.alive;
    const biomass = fish.reduce((sum, f) => sum + f.length, 0);
    const rate = (CONFIG.care.dirtBase + CONFIG.care.dirtPerFish * biomass) * (1 - this.game.decor.cleanBonus);
    tank.cleanliness = clamp(tank.cleanliness - rate * simDt, 0, 100);

    const n = fish.length;
    this.avgHappiness = n ? fish.reduce((s, f) => s + f.happiness, 0) / n : 0;
    this.avgHealth = n ? fish.reduce((s, f) => s + f.data.health, 0) / n : 0;
    this.avgSatiety = n ? fish.reduce((s, f) => s + f.data.satiety, 0) / n : 0;
    const capacity = this.game.fish.capacity;
    this.crowdPenalty = Math.max(0, n - capacity * 0.85) * 4;

    const quality = tank.cleanliness / 100;
    if (Math.abs(quality - this.lastQuality) > 0.004) {
      // lastQuality = -1 หลังโหลดตู้ → แสดงตะไคร่ตามสภาพจริงทันที ไม่ค่อย ๆ ขึ้น
      this.game.aquarium.setWaterQuality(quality, { immediate: this.lastQuality < 0 });
      this.lastQuality = quality;
    }
    this.#checkStage(tank);
  }

  /** แจ้งเตือนเมื่อน้ำสกปรกลงถึงขั้นใหม่ (ไม่แจ้งตอนเพิ่งโหลดตู้ หรือตอนน้ำใสขึ้น) */
  #checkStage(tank) {
    const stage = waterStageIndex(tank.cleanliness);
    const prev = this.stage;
    this.stage = stage;
    if (prev == null || prev === -1 || stage <= prev) return;
    const info = WATER_STAGES[stage];
    if (info.warn && this.game.fish.count > 0) this.game.ui.toast(info.warn, stage >= 2 ? 'warn' : 'info');
  }

  get waterStage() {
    return WATER_STAGES[waterStageIndex(this.cleanliness)];
  }

  addDirt(amount) {
    this.tank.cleanliness = Math.max(0, this.tank.cleanliness - amount);
  }

  cleanCooldownLeft() {
    const elapsed = (Date.now() - (this.game.state.data.lastCleanAt ?? 0)) / 1000;
    return Math.max(0, CONFIG.care.cleanCooldown - elapsed);
  }

  clean() {
    if (this.cleanCooldownLeft() > 0) return false;
    this.tank.cleanliness = 100;
    this.game.state.data.lastCleanAt = Date.now();
    this.game.food.clear();
    const { w, d } = this.game.aquarium.dims;
    for (let i = 0; i < 6; i++) {
      const x = (i / 5 - 0.5) * w * 0.8;
      this.game.bubbles.emit(x, this.game.aquarium.heightAt(x, 0) + 0.1, (Math.random() - 0.5) * d * 0.6, 8, { spread: 0.4, minSize: 0.04, maxSize: 0.12 });
    }
    this.game.sound.play('clean');
    this.game.events.emit(EV.TANK_CLEANED, { amount: 1 });
    return true;
  }
}
