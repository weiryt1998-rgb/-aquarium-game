import { CONFIG } from '../config.js';
import { EV } from '../core/EventBus.js';
import { clamp } from '../utils/math.js';

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
      this.lastQuality = quality;
      this.game.aquarium.setWaterQuality(quality);
    }
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
