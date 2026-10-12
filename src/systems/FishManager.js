import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/EventBus.js';
import { createFishRecord } from '../core/GameState.js';
import { Fish } from '../entities/Fish.js';
import { getSpecies } from '../data/fish.js';
import { getTankType } from '../data/tanks.js';
import { rand } from '../utils/math.js';

/** ค่าที่สุ่มในเครื่องตอนสร้างปลาใหม่ — ส่งไปกับคำสั่งให้เซิร์ฟเวอร์สร้างปลาตัวเดียวกัน */
export const fishIdentity = (r) => ({ id: r.id, name: r.name, gender: r.gender, breedCooldown: r.breedCooldown, coinTimer: r.coinTimer });

/** ดูแลปลาทุกตัวในตู้ที่แสดงอยู่: สร้าง/ลบ อัปเดต การออกลูก และการตาย */
export class FishManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.sceneMgr.scene.add(this.group);
    this.breedTimer = CONFIG.breeding.checkInterval;
  }

  /** จำนวนปลาที่ยังมีชีวิต */
  get count() {
    return this.list.reduce((n, f) => n + (f.dying ? 0 : 1), 0);
  }

  get alive() {
    return this.list.filter((f) => !f.dying);
  }

  get capacity() {
    return getTankType(this.game.state.activeTank.typeId)?.capacity ?? 10;
  }

  load(tank) {
    this.clear();
    for (const record of tank.fish) this.spawn(record);
  }

  spawn(record, { position = null, fromTop = false } = {}) {
    const species = getSpecies(record.speciesId);
    if (!species) {
      console.warn('ไม่รู้จักสายพันธุ์', record.speciesId);
      return null;
    }
    const fish = new Fish(this.game, record, species);
    const aq = this.game.aquarium;
    if (position) fish.position.copy(position);
    else if (fromTop) fish.position.set(rand(-aq.dims.w * 0.3, aq.dims.w * 0.3), aq.dims.waterTop - 0.2, rand(-aq.dims.d * 0.2, aq.dims.d * 0.2));
    else aq.randomPoint(species.behavior.zone, 0.8, fish.position);
    if (fromTop) fish.velocity.set(rand(-0.3, 0.3), -1.2, rand(-0.2, 0.2));
    this.group.add(fish.group);
    this.list.push(fish);
    return fish;
  }

  /** เพิ่มปลาตัวใหม่ลงตู้ (ซื้อ) */
  addNew(speciesId) {
    const record = createFishRecord(speciesId, { growth: 0.6, satiety: 70 });
    this.game.state.activeTank.fish.push(record);
    const fish = this.spawn(record, { fromTop: true });
    const p = fish.position;
    this.game.bubbles.emit(p.x, p.y - 0.2, p.z, 14, { spread: 0.35, minSize: 0.05, maxSize: 0.14 });
    this.game.events.emit(EV.FISH_COUNT, { count: this.count });
    return fish;
  }

  /** เอาปลาออกจากตู้ (ขาย) */
  remove(fish) {
    const tank = this.game.state.activeTank;
    tank.fish = tank.fish.filter((r) => r !== fish.data);
    this.#detach(fish);
    this.game.events.emit(EV.FISH_COUNT, { count: this.count });
  }

  #detach(fish) {
    this.list = this.list.filter((f) => f !== fish);
    this.group.remove(fish.group);
    if (this.game.selectedFish === fish) this.game.selectFish(null);
    fish.dispose();
  }

  getById(id) {
    return this.list.find((f) => f.id === id);
  }

  /**
   * ทำให้ปลาในฉากตรงกับ record ของตู้ (หลังรับข้อมูลจากเซฟกลาง เช่น อีกเครื่องซื้อ/ขายปลา)
   * @returns {boolean} มีปลาเพิ่มหรือหายไปไหม
   */
  syncRecords(tank) {
    const records = new Map(tank.fish.map((r) => [r.id, r]));
    let changed = false;
    for (const fish of [...this.list]) {
      if (fish.dying) continue;
      const record = records.get(fish.id);
      if (!record) {
        this.#detach(fish);
        changed = true;
        continue;
      }
      fish.data = record;
      fish.updateScale();
    }
    for (const record of tank.fish) {
      if (this.list.some((f) => f.id === record.id && !f.dying)) continue;
      if (this.spawn(record, { fromTop: true })) changed = true;
    }
    return changed;
  }

  update(dt, simDt, time) {
    const game = this.game;
    const care = game.care;
    const ctx = {
      time,
      food: game.food,
      fish: this.list,
      obstacles: game.decor.obstacles,
      aquarium: game.aquarium,
      coins: game.coins,
      cleanliness: game.state.activeTank.cleanliness,
      decorScore: game.decor.happinessScore,
      crowdPenalty: care.crowdPenalty,
      onGrown: (fish) => {
        game.events.emit(EV.FISH_GREW, { fish });
        game.ui.toast(`🌱 ${fish.data.name} (${fish.species.name}) โตเต็มวัยแล้ว!`);
      },
    };

    for (const fish of [...this.list]) {
      if (fish.dying) {
        if (fish.updateDying(dt, game.aquarium)) this.#detach(fish);
        continue;
      }
      fish.updateStats(simDt, ctx);
      if (fish.data.health <= 0) {
        this.#die(fish);
        continue;
      }
      fish.updateMovement(dt, ctx);
      fish.updateVisual(dt);
    }

    this.breedTimer -= simDt;
    if (this.breedTimer <= 0) {
      this.breedTimer = CONFIG.breeding.checkInterval;
      this.#checkBreeding();
    }
  }

  #die(fish) {
    const tank = this.game.state.activeTank;
    tank.fish = tank.fish.filter((r) => r !== fish.data);
    this.game.state.record({ type: 'fishDied', tankId: tank.id, fishId: fish.id });
    fish.startDying();
    if (this.game.selectedFish === fish) this.game.selectFish(null);
    this.game.sound.play('sad');
    this.game.ui.toast(`😢 ${fish.data.name} (${fish.species.name}) จากไปแล้ว… อย่าลืมให้อาหารและทำความสะอาดตู้นะ`, 'warn');
    this.game.events.emit(EV.FISH_DIED, { fish });
    this.game.events.emit(EV.FISH_COUNT, { count: this.count });
  }

  #checkBreeding() {
    const B = CONFIG.breeding;
    if (this.count >= this.capacity) return;
    const ready = this.list.filter((f) => !f.dying && f.isAdult && f.happiness >= B.minHappiness && f.data.health >= B.minHealth && f.data.breedCooldown <= 0);
    const bySpecies = new Map();
    for (const f of ready) {
      if (!bySpecies.has(f.species.id)) bySpecies.set(f.species.id, []);
      bySpecies.get(f.species.id).push(f);
    }
    for (const [speciesId, group] of bySpecies) {
      const dad = group.find((f) => f.data.gender === 'm');
      const mom = group.find((f) => f.data.gender === 'f');
      if (!dad || !mom || Math.random() > mom.species.care.breedChance) continue;
      const record = createFishRecord(speciesId, { growth: 0, satiety: 60 });
      const tank = this.game.state.activeTank;
      tank.fish.push(record);
      const pos = dad.position.clone().lerp(mom.position, 0.5);
      const baby = this.spawn(record, { position: pos });
      dad.data.breedCooldown = mom.data.breedCooldown = B.cooldown;
      this.game.state.record({ type: 'fishBorn', tankId: tank.id, parents: [dad.id, mom.id], fish: fishIdentity(record) });
      this.game.bubbles.emit(pos.x, pos.y, pos.z, 10, { spread: 0.2, minSize: 0.03, maxSize: 0.08 });
      this.game.sound.play('born');
      this.game.ui.toast(`🐣 ${mom.species.name}ออกลูกแล้ว! ยินดีต้อนรับ "${baby.data.name}"`, 'success');
      this.game.events.emit(EV.FISH_BORN, { fish: baby });
      this.game.events.emit(EV.FISH_COUNT, { count: this.count });
      if (this.count >= this.capacity) break;
    }
  }

  /** หาปลาที่ถูกคลิก (ใกล้กล้องที่สุด) */
  pick(ray) {
    let best = null;
    let bestDist = Infinity;
    for (const fish of this.list) {
      if (fish.dying) continue;
      const d = fish.hitDistance(ray);
      if (d !== null && d < bestDist) {
        bestDist = d;
        best = fish;
      }
    }
    return best;
  }

  clear() {
    for (const fish of this.list) {
      this.group.remove(fish.group);
      fish.dispose();
    }
    this.list = [];
  }
}
