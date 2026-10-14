import { CONFIG } from '../config.js';
import { EV } from '../core/EventBus.js';
import { WATER_STAGES, waterStageIndex } from '../sim/water.ts';

// คงชื่อเดิมไว้ให้โค้ดส่วนอื่นใช้ต่อได้ — ตัวคำนวณจริงอยู่ใน Simulation Engine (src/sim/)
export { WATER_STAGES, waterStageIndex, dirtyHealthDamage } from '../sim/water.ts';

/**
 * ฝั่งแสดงผลของการดูแลตู้: อ่านค่าจาก Simulation Engine (game.sim) มาแสดงบน HUD
 * อัปเดตภาพน้ำ/ตะไคร่เมื่อ engine คำนวณจังหวะใหม่ และทำความสะอาดตู้ (เอฟเฟกต์ฟองอากาศ เสียง)
 * ไม่มีการคำนวณระบบนิเวศในไฟล์นี้
 */
export class CareSystem {
  constructor(game) {
    this.game = game;
    this.lastQuality = -1;
  }

  get stats() {
    return this.game.sim?.stats ?? { cleanliness: this.cleanliness, avgHappiness: 0, avgHealth: 0, avgSatiety: 0, crowdPenalty: 0 };
  }

  get cleanliness() {
    return this.game.state.activeTank.cleanliness;
  }

  get avgHappiness() {
    return this.stats.avgHappiness;
  }

  get avgHealth() {
    return this.stats.avgHealth;
  }

  get avgSatiety() {
    return this.stats.avgSatiety;
  }

  get waterStage() {
    return WATER_STAGES[waterStageIndex(this.cleanliness)];
  }

  /** ปรับภาพน้ำ/ตะไคร่ตามความสะอาด (เรียกหลัง engine คำนวณจังหวะใหม่ หรือหลังโหลดตู้) */
  syncVisuals() {
    const quality = this.cleanliness / 100;
    if (Math.abs(quality - this.lastQuality) <= 0.004) return;
    // lastQuality = -1 หลังโหลดตู้ → แสดงตะไคร่ตามสภาพจริงทันที ไม่ค่อย ๆ ขึ้น
    this.game.aquarium.setWaterQuality(quality, { immediate: this.lastQuality < 0 });
    this.lastQuality = quality;
  }

  addDirt(amount) {
    this.game.sim.addDirt(amount);
  }

  cleanCooldownLeft() {
    const elapsed = (Date.now() - (this.game.state.data.lastCleanAt ?? 0)) / 1000;
    return Math.max(0, CONFIG.care.cleanCooldown - elapsed);
  }

  clean() {
    if (this.cleanCooldownLeft() > 0) return false;
    this.game.sim.clean();
    this.game.state.data.lastCleanAt = Date.now();
    this.game.food.clear();
    this.syncVisuals();
    const { w, d } = this.game.aquarium.dims;
    for (let i = 0; i < 6; i++) {
      const x = (i / 5 - 0.5) * w * 0.8;
      this.game.bubbles.emit(x, this.game.aquarium.heightAt(x, 0) + 0.1, (Math.random() - 0.5) * d * 0.6, 8, { spread: 0.4, minSize: 0.04, maxSize: 0.12 });
    }
    this.game.fish.startle(null, 45); // เปลี่ยนน้ำ/ดูดตะกอน: ปลาตกใจ ตัวขี้อายไปหลบสักพัก
    this.game.sound.play('clean');
    this.game.events.emit(EV.TANK_CLEANED, { amount: 1 });
    return true;
  }
}
