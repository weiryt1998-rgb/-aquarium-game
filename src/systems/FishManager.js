import * as THREE from 'three';
import { EV } from '../core/EventBus.js';
import { createFishRecord } from '../sim/records.ts';
import { Fish } from '../entities/Fish.js';
import { getSpecies } from '../data/fish.js';
import { getTankType } from '../data/tanks.js';
import { formatDuration, rand } from '../utils/math.js';
import { breedGroupOf, gestationMs } from '../shared/breeding.js';
import { FishAI } from '../ai/FishAI.ts';
import { describeGenes } from '../models/molly/genetics.js';

/** ค่าที่สุ่มในเครื่องตอนสร้างปลาใหม่ — ส่งไปกับคำสั่งให้เซิร์ฟเวอร์สร้างปลาตัวเดียวกัน */
export const fishIdentity = (r) => ({ id: r.id, name: r.name, gender: r.gender, breedCooldown: r.breedCooldown, coinTimer: r.coinTimer });

/** การว่ายตามสายพันธุ์สำหรับ Fish AI */
export const motionOf = (species) => ({
  speed: species.behavior.speed,
  agility: species.behavior.agility ?? 2,
  zone: species.behavior.zone ?? 'middle',
  schooling: !!species.behavior.schooling,
  group: breedGroupOf(species),
});

/**
 * ปลาทุกตัวในตู้ที่แสดงอยู่ (ฝั่งแสดงผล): สร้าง/ลบโมเดล วาดท่าทางทุกเฟรม และแสดงผลเหตุการณ์ชีวิตจาก Simulation Engine
 * (การหิว ป่วย โต ผสมพันธุ์ คลอด ตาย คำนวณใน src/sim/TankSimulation.ts)
 * การว่ายและพฤติกรรม (FSM + steering + บุคลิก) คำนวณใน Fish AI (src/ai/) — ปู (เดินพื้น) ยังใช้การเดินแบบเดิมใน Fish.js
 */
export class FishManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.group = new THREE.Group();
    game.sceneMgr.scene.add(this.group);
    /** โลกที่ Fish AI รับรู้ — อัปเดตค่าทุกเฟรมจากตู้ ของตกแต่ง และอาหาร (ข้อมูลล้วน ไม่ส่ง object ของ Three.js) */
    this.aiWorld = {
      w: 1,
      d: 1,
      waterTop: 1,
      floorAt: (x, z) => game.aquarium.heightAt(x, z),
      obstacles: [],
      covers: [],
      food: [],
      // ใช้ระบบให้อาหารเดิม: ลบเม็ดอาหาร + ส่งให้ Simulation Engine เพิ่มความอิ่ม
      consume: (item, fishId) => {
        const fish = this.getById(fishId);
        if (fish && !fish.dying) game.food.consume(item, fish);
      },
    };
    this.ai = new FishAI(this.aiWorld);
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
    this.#syncWorld();
    for (const record of tank.fish) this.spawn(record);
  }

  #syncWorld() {
    const game = this.game;
    const w = this.aiWorld;
    const dims = game.aquarium.dims;
    w.w = dims.w;
    w.d = dims.d;
    w.waterTop = dims.waterTop;
    w.obstacles = game.decor.obstacles;
    w.covers = game.decor.covers;
    w.food = game.food.pellets;
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
    if (!species.behavior.walker) {
      fish.agent = this.ai.add(record.id, motionOf(species), { x: fish.position.x, y: fish.position.y, z: fish.position.z, yaw: fish.yaw });
      fish.syncNeedsToAgent(this.game.state.activeTank.cleanliness);
      // ลงตู้จากผิวน้ำ = ตกใจนิดหน่อย จมลงก่อนแล้วค่อยว่าย
      if (fromTop) this.ai.place(record.id, fish.position, fish.velocity);
    }
    this.group.add(fish.group);
    this.list.push(fish);
    return fish;
  }

  /** เพิ่มปลาตัวใหม่ลงตู้ (ซื้อ) @param {'m'|'f'} [gender] ไม่ระบุ = สุ่ม */
  addNew(speciesId, gender) {
    const record = createFishRecord(speciesId, { growth: 0.6, satiety: 70, gender });
    this.game.state.activeTank.fish.push(record);
    const fish = this.spawn(record, { fromTop: true });
    const p = fish.position;
    this.game.bubbles.emit(p.x, p.y - 0.2, p.z, 14, { spread: 0.35, minSize: 0.05, maxSize: 0.14 });
    if (fish.trail) this.game.sparkles.burst(p, fish.trail.colors, 60); // ปลาระดับตำนานลงตู้พร้อมประกายดาว
    this.ai.startle(p, 25, 5); // ปลาตัวอื่นแถวนั้นตกใจเล็กน้อย
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
    this.game.sim?.forget(fish.id);
    this.ai.remove(fish.id);
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

  /**
   * ทุกเฟรม: ส่งค่าสถานะให้ Fish AI → AI คำนวณเป็นจังหวะคงที่ → วาดตำแหน่ง/ท่าทาง (เกลี่ยระหว่างจังหวะ)
   * (ค่าสถานะคำนวณใน Simulation Engine — ดู handleSimEvent)
   */
  update(dt, time) {
    const game = this.game;
    const cleanliness = game.state.activeTank.cleanliness;
    this.#syncWorld();
    for (const fish of this.list) if (fish.agent && !fish.dying) fish.syncNeedsToAgent(cleanliness);
    this.ai.update(dt);
    const alpha = this.ai.alpha;
    const ctx = { time, food: game.food, fish: this.list, obstacles: game.decor.obstacles, aquarium: game.aquarium, cleanliness };
    for (const fish of [...this.list]) {
      if (fish.dying) {
        if (fish.updateDying(dt, game.aquarium)) this.#detach(fish);
        continue;
      }
      if (fish.agent) fish.syncFromAgent(alpha);
      else fish.updateMovement(dt, ctx); // สัตว์เดินพื้น (ปู)
      fish.updateVisual(dt);
    }
  }

  /** มีคนโรยอาหาร: ปลาที่หิวแถวนั้นหันมาหา ปลาขี้อายตกใจนิดหน่อย */
  notifyFood(x, z) {
    this.ai.notifyFood({ x, y: this.game.aquarium.dims.waterTop, z });
  }

  /** สิ่งรบกวน เช่น ทำความสะอาดตู้ (at = null ทั้งตู้) */
  startle(at, amount, radius) {
    this.ai.startle(at, amount, radius);
  }

  /** หลัง engine คำนวณจังหวะใหม่: ปรับขนาดตัวตามการเติบโต */
  syncFromSim() {
    for (const fish of this.list) {
      if (fish.dying) continue;
      fish.updateScale();
      // ลูกปลาโตพ้นวัยเด็ก → เปลี่ยนเป็นโมเดลตัวเต็มวัย (มีฟองอากาศเล็ก ๆ ตอนเปลี่ยนร่าง)
      if (fish.refreshLook()) {
        const p = fish.position;
        this.game.bubbles.emit(p.x, p.y, p.z, 8, { spread: 0.15, minSize: 0.03, maxSize: 0.07 });
        if (this.game.selectedFish === fish) this.game.ui.fishCard.show(fish);
      }
    }
  }

  /**
   * แสดงผลเหตุการณ์จาก Simulation Engine: เหรียญ โต ตาย ผสมพันธุ์ คลอด
   * พร้อมส่งคำสั่งให้เซฟกลางบันทึก (ปลาตาย/ผสมพันธุ์/คลอด)
   * @param {import('../sim/types.ts').SimEvent} e
   */
  handleSimEvent(e) {
    const game = this.game;
    const tank = game.state.activeTank;
    switch (e.type) {
      case 'coin': {
        const fish = this.getById(e.fishId);
        if (fish && !fish.dying) game.coins.spawn(fish.position, e.value);
        break;
      }
      case 'grew': {
        const fish = this.getById(e.fishId);
        if (!fish) break;
        game.events.emit(EV.FISH_GREW, { fish });
        game.ui.toast(`🌱 ${fish.data.name} (${fish.species.name}) โตเต็มวัยแล้ว!`);
        break;
      }
      case 'died':
        this.#die(e.fish, e.cause);
        break;
      case 'mated':
        this.#mated(e);
        break;
      case 'birthBlocked': {
        const mom = this.getById(e.momId);
        if (mom) game.ui.toast(`🤰 "${mom.data.name}" ครบกำหนดคลอดแล้ว แต่ตู้เต็ม — ขายหรือย้ายปลาออกเพื่อให้มีที่ว่าง`, 'warn');
        break;
      }
      case 'born':
        this.#born(e.baby, this.getById(e.momId), tank);
        break;
    }
  }

  #die(record, cause) {
    const fish = this.getById(record.id);
    const tank = this.game.state.activeTank;
    this.game.state.record({ type: 'fishDied', tankId: tank.id, fishId: record.id });
    const species = getSpecies(record.speciesId);
    const why = { starving: 'เพราะหิวนานเกินไป', water: 'เพราะน้ำสกปรกเกินไป', illness: 'เพราะป่วยหนัก' }[cause] ?? '';
    this.game.sound.play('sad');
    this.game.ui.toast(`😢 ${record.name} (${species?.name ?? ''}) จากไปแล้ว${why}… หมั่นให้อาหารและทำความสะอาดตู้นะ`, 'warn');
    if (fish) {
      this.ai.remove(fish.id);
      fish.agent = null;
      fish.startDying();
      if (this.game.selectedFish === fish) this.game.selectFish(null);
      this.game.events.emit(EV.FISH_DIED, { fish });
    }
    this.game.events.emit(EV.FISH_COUNT, { count: this.count });
  }

  #mated({ momId, dadId, fetus }) {
    const tank = this.game.state.activeTank;
    const mom = this.getById(momId);
    const dad = this.getById(dadId);
    this.game.state.record({ type: 'fishMated', tankId: tank.id, parents: [dadId, momId], fetus });
    if (!mom || !dad) return;
    const p = mom.position;
    this.game.bubbles.emit(p.x, p.y, p.z, 6, { spread: 0.15, minSize: 0.03, maxSize: 0.07 });
    const cross = mom.species !== dad.species ? ` กับ "${dad.data.name}" (${dad.species.name})` : '';
    const kind = fetus.genes ? ' ลูกจะเป็นลูกผสมสีใหม่ 🌈' : '';
    this.game.ui.toast(`🤰 "${mom.data.name}" (${mom.species.name})${cross} ตั้งท้องแล้ว!${kind} จะคลอดในอีกประมาณ ${formatDuration(gestationMs() / 1000)}`, 'success');
    this.game.events.emit(EV.FISH_PREGNANT, { fish: mom, father: dad });
  }

  #born(record, mom, tank) {
    // ลูกออกมาด้านหลังท้องแม่เล็กน้อย
    const pos = mom ? mom.position.clone().addScaledVector(mom.velocity.clone().normalize(), -mom.length * 0.3) : null;
    const baby = this.spawn(record, { position: pos, fromTop: !pos });
    this.game.state.record({ type: 'fishBorn', tankId: tank.id, motherId: mom?.id ?? record.id, fish: fishIdentity(record) });
    if (!baby) return;
    const p = baby.position;
    this.game.bubbles.emit(p.x, p.y, p.z, 10, { spread: 0.2, minSize: 0.03, maxSize: 0.08 });
    this.game.sound.play('born');
    const look = record.genes ? ` — ${baby.species.name} ${describeGenes(record.genes)}` : '';
    const momName = mom ? `"${mom.data.name}" (${mom.species.name}) ` : '';
    this.game.ui.toast(`🐣 ${momName}คลอดลูกแล้ว! ยินดีต้อนรับ "${baby.data.name}" ${baby.data.gender === 'm' ? '♂' : '♀'}${look}`, 'success');
    if (this.game.state.discover(baby.species.id)) this.game.ui.toast(`📘 ค้นพบสายพันธุ์ใหม่: ${baby.species.name}`, 'success');
    this.game.events.emit(EV.FISH_BORN, { fish: baby, mother: mom });
    this.game.events.emit(EV.FISH_COUNT, { count: this.count });
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
      this.ai.remove(fish.id);
      this.group.remove(fish.group);
      fish.dispose();
    }
    this.list = [];
  }
}
