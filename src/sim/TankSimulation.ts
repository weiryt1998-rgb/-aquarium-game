import { CONFIG } from '../config.js';
import { getSpecies } from '../data/fish.js';
import { breedGroupOf, dueAt, isPregnant, isResting, planOffspring } from '../shared/breeding.js';
import { conditionOf, eat, healthDrain, newMood, secondsUntilDeath, sizeFactor, stepFish } from './needs.ts';
import { createFishRecord } from './records.ts';
import { dirtRate, waterStageIndex } from './water.ts';
import { NO_ECOLOGY, ecologyReduction } from './ecology.ts';
import type { DeathCause, Environment, FishCondition, FishMood, FishRecord, FoodEffect, SimEvent, SpeciesLike, TankRecord, TankStats } from './types.ts';

/**
 * Simulation Engine ของตู้ปลา 1 ใบ — คำนวณระบบนิเวศเป็นจังหวะเวลาคงที่ (CONFIG.sim.tickSeconds) ไม่ใช่ทุกเฟรม
 * ไม่รู้จัก Three.js / DOM / เสียง / เซฟกลาง: แก้ record ของตู้ตรง ๆ แล้วส่ง "เหตุการณ์" ให้ฝั่งเกมแสดงผล
 *
 *   const sim = new TankSimulation(tank, env);
 *   ทุกเฟรม: sim.advance(dtจริง)  → คืนจำนวนจังหวะที่คำนวณ (ส่วนใหญ่ 0 — เฟรมนั้นไม่ต้องคำนวณอะไร)
 *            for (const e of sim.drainEvents()) ...  (เหรียญ, โต, ตาย, อาการเปลี่ยน, สภาพน้ำ, เกี้ยวพาราสี, ผสมพันธุ์, คลอด)
 *   การกระทำของผู้เล่น: feed / clean / heal / addDirt
 *
 * ค่าที่ไม่ต้องบันทึก (ความสุข ผลของอาหาร) เก็บใน moods แยกตาม id ปลา — record จากเซฟกลางถูกแทนที่ได้ตลอด
 * engine จึงอ่าน tank.fish ใหม่ทุกจังหวะ ไม่ถือ reference ของ record ปลาไว้
 */
export class TankSimulation {
  tank: TankRecord;
  env: Environment;
  /** เวลาจำลองสะสมที่ยังไม่ถึงจังหวะถัดไป */
  private acc = 0;
  private breedAcc = 0;
  /** เวลาจำลองรวม (วินาทีเกม) ใช้นับเวลาเกี้ยวพาราสี */
  private clock = 0;
  private readonly moods = new Map<string, FishMood>();
  private readonly conditions = new Map<string, FishCondition>();
  /** ตัวเมียที่ครบกำหนดคลอดแต่ตู้เต็ม (แจ้งครั้งเดียว) */
  private readonly blockedBirths = new Set<string>();
  /** คู่ที่กำลังเกี้ยวพาราสี: id ตัวเมีย → ตัวผู้ + เวลาที่จะผสมพันธุ์ (ค่าชั่วคราว ไม่บันทึก — โหลดเกมใหม่ก็เริ่มเกี้ยวใหม่) */
  private readonly courtships = new Map<string, { dadId: string; until: number }>();
  private events: SimEvent[] = [];
  private waterStage: number;
  private readonly random: () => number;
  private readonly now: () => number;
  stats: TankStats = { cleanliness: 100, avgHappiness: 0, avgHealth: 0, avgSatiety: 0, crowdPenalty: 0, ecology: 0 };

  constructor(tank: TankRecord, env: Environment, { random = Math.random, now = () => Date.now() }: { random?: () => number; now?: () => number } = {}) {
    this.tank = tank;
    this.env = env;
    this.random = random;
    this.now = now;
    this.waterStage = waterStageIndex(tank.cleanliness);
    // อาการเริ่มต้น = สภาพตอนโหลด (ไม่เตือนซ้ำเรื่องที่เป็นอยู่แล้วตอนเปิดเกม ยกเว้นอาการหนัก — ดู AlertSystem)
    for (const fish of tank.fish) this.conditions.set(fish.id, conditionOf(fish));
    this.updateStats();
  }

  // ── เวลา ────────────────────────────────────────────────────

  /**
   * เดินเวลาตามเวลาจริงที่ผ่านไป — คำนวณเฉพาะเมื่อครบจังหวะ
   * @param dt วินาทีจริงตั้งแต่เฟรมก่อน
   * @returns จำนวนจังหวะที่คำนวณในครั้งนี้
   */
  advance(dt: number, timeScale: number = CONFIG.timeScale): number {
    const step = CONFIG.sim.tickSeconds;
    const max = CONFIG.sim.maxTicksPerFrame;
    this.acc = Math.min(this.acc + dt * timeScale, step * max);
    let ticks = 0;
    while (this.acc >= step && ticks < max) {
      this.acc -= step;
      this.tick(step);
      ticks++;
    }
    return ticks;
  }

  /** คำนวณระบบนิเวศ 1 จังหวะ (dt วินาทีเกม) */
  tick(dt: number): void {
    this.clock += dt;
    const tank = this.tank;
    const living = tank.fish;
    const biomass = living.reduce((sum, f) => sum + ((getSpecies(f.speciesId) as SpeciesLike & { length?: number })?.length ?? 0.7) * sizeFactor(f), 0);
    // หอย (ระบบนิเวศ) ทำให้น้ำสกปรกช้าลง
    const dirt = dirtRate(biomass, this.env.cleanBonus) * (1 - ecologyReduction(this.env.ecology ?? NO_ECOLOGY, tank.cleanliness));
    tank.cleanliness = Math.min(100, Math.max(0, tank.cleanliness - dirt * dt));
    const crowdPenalty = Math.max(0, living.length - this.env.capacity * 0.85) * 4;
    const ctx = { cleanliness: tank.cleanliness, decorHappiness: this.env.decorHappiness, crowdPenalty };

    for (const fish of [...living]) {
      const species = getSpecies(fish.speciesId) as SpeciesLike | undefined;
      if (!species) continue;
      const cause = this.deathCause(fish);
      const result = stepFish(fish, species, this.mood(fish.id), ctx, dt, this.random);
      if (fish.health <= 0) {
        this.die(fish, cause);
        continue;
      }
      if (result.coin > 0) this.events.push({ type: 'coin', fishId: fish.id, value: result.coin });
      if (result.grew) this.events.push({ type: 'grew', fishId: fish.id });
      this.checkCondition(fish);
    }

    const stage = waterStageIndex(tank.cleanliness);
    if (stage !== this.waterStage) {
      this.events.push({ type: 'water', stage, previous: this.waterStage });
      this.waterStage = stage;
    }

    this.breedAcc += dt;
    if (this.breedAcc >= CONFIG.breeding.checkInterval) {
      this.breedAcc = 0;
      this.checkBreeding();
    }
    this.updateStats();
  }

  // ── การกระทำของผู้เล่น ─────────────────────────────────────

  /** ปลากินอาหาร 1 เม็ด */
  feed(fishId: string, food: FoodEffect): void {
    const fish = this.tank.fish.find((f) => f.id === fishId);
    if (!fish) return;
    eat(fish, this.mood(fishId), food);
    this.checkCondition(fish);
  }

  /** ทำความสะอาดตู้ (น้ำใสทันที) */
  clean(): void {
    this.tank.cleanliness = 100;
    this.syncWaterStage();
    this.updateStats();
  }

  /** อาหารเน่า ฯลฯ */
  addDirt(amount: number): void {
    this.tank.cleanliness = Math.max(0, this.tank.cleanliness - amount);
    this.updateStats();
  }

  /** ให้ยา: สุขภาพปลาทุกตัวเพิ่มขึ้น */
  heal(amount: number): void {
    for (const fish of this.tank.fish) {
      fish.health = Math.min(100, fish.health + amount);
      this.checkCondition(fish);
    }
    this.updateStats();
  }

  // ── อ่านค่า ─────────────────────────────────────────────────

  happiness(fishId: string): number {
    return this.mood(fishId).happiness;
  }

  condition(fishId: string): FishCondition {
    return this.conditions.get(fishId) ?? 'healthy';
  }

  /** เวลาโดยประมาณก่อนปลาตายถ้าไม่มีใครแก้ไข (วินาทีเกม) — null = ไม่ได้แย่ลง */
  secondsLeft(fishId: string): number | null {
    const fish = this.tank.fish.find((f) => f.id === fishId);
    return fish ? secondsUntilDeath(fish, this.tank.cleanliness) : null;
  }

  /** สาเหตุที่ทำให้สุขภาพลดตอนนี้ (ใช้บอกผู้เล่นว่าต้องแก้อะไร) */
  causes(fishId: string): { hungry: boolean; dirtyWater: boolean } {
    const fish = this.tank.fish.find((f) => f.id === fishId);
    if (!fish) return { hungry: false, dirtyWater: false };
    const drain = healthDrain(fish, this.tank.cleanliness);
    return { hungry: drain.starving > 0 || fish.satiety < CONFIG.care.hungryBelow, dirtyWater: drain.water > 0 };
  }

  /** ปลาทั้งหมดที่อยู่ในอาการที่ระบุ */
  fishIn(condition: FishCondition): FishRecord[] {
    return this.tank.fish.filter((f) => this.condition(f.id) === condition);
  }

  /** คู่ที่ปลาตัวนี้กำลังเกี้ยวพาราสีอยู่ (id) — null = ไม่ได้เกี้ยว */
  courtingPartner(fishId: string): string | null {
    const c = this.courtships.get(fishId);
    if (c) return c.dadId;
    for (const [momId, x] of this.courtships) if (x.dadId === fishId) return momId;
    return null;
  }

  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** ลืมค่าของปลาที่ไม่อยู่ในตู้แล้ว (ขาย / ถูกลบจากอีกเครื่อง) */
  forget(fishId: string): void {
    this.moods.delete(fishId);
    this.conditions.delete(fishId);
    this.blockedBirths.delete(fishId);
    this.courtships.delete(fishId);
    for (const [momId, c] of this.courtships) if (c.dadId === fishId) this.courtships.delete(momId);
  }

  // ── ภายใน ──────────────────────────────────────────────────

  private mood(fishId: string): FishMood {
    let mood = this.moods.get(fishId);
    if (!mood) {
      mood = newMood();
      this.moods.set(fishId, mood);
    }
    return mood;
  }

  private deathCause(fish: FishRecord): DeathCause {
    const { starving, water } = healthDrain(fish, this.tank.cleanliness);
    if (starving === 0 && water === 0) return 'illness';
    return starving >= water ? 'starving' : 'water';
  }

  private checkCondition(fish: FishRecord): void {
    const previous = this.conditions.get(fish.id) ?? 'healthy';
    const condition = conditionOf(fish);
    if (condition === previous) return;
    this.conditions.set(fish.id, condition);
    this.events.push({ type: 'condition', fishId: fish.id, condition, previous, secondsLeft: secondsUntilDeath(fish, this.tank.cleanliness) });
  }

  private syncWaterStage(): void {
    const stage = waterStageIndex(this.tank.cleanliness);
    if (stage !== this.waterStage) this.events.push({ type: 'water', stage, previous: this.waterStage });
    this.waterStage = stage;
  }

  private die(fish: FishRecord, cause: DeathCause): void {
    this.tank.fish = this.tank.fish.filter((f) => f !== fish);
    this.forget(fish.id);
    this.events.push({ type: 'died', fish, cause });
  }

  private updateStats(): void {
    const fish = this.tank.fish;
    const n = fish.length;
    const avg = (fn: (f: FishRecord) => number) => (n ? fish.reduce((s, f) => s + fn(f), 0) / n : 0);
    this.stats = {
      cleanliness: this.tank.cleanliness,
      avgHappiness: avg((f) => this.mood(f.id).happiness),
      avgHealth: avg((f) => f.health),
      avgSatiety: avg((f) => f.satiety),
      crowdPenalty: Math.max(0, n - this.env.capacity * 0.85) * 4,
      ecology: ecologyReduction(this.env.ecology ?? NO_ECOLOGY, this.tank.cleanliness),
    };
  }

  /**
   * พร้อมผสมพันธุ์: โตเต็มวัย สุขภาพดี (ไม่หิว/ไม่ป่วย) มีความสุข พ้นช่วงพักของตัวผู้ ไม่ได้ตั้งท้องหรือพักฟื้นหลังคลอด
   * @param slack ผ่อนเกณฑ์ความสุข/สุขภาพระหว่างเกี้ยว (ไม่เลิกกลางคันเพราะค่าแกว่งนิดหน่อย)
   */
  private canBreed(f: FishRecord, now: number, slack = 0): boolean {
    const B = CONFIG.breeding;
    return (
      f.growth >= 1 &&
      f.health >= B.minHealth - slack &&
      conditionOf(f) === 'healthy' &&
      this.happiness(f.id) >= B.minHappiness - slack &&
      f.breedCooldown <= 0 &&
      !isPregnant(f) &&
      !isResting(f, now)
    );
  }

  /**
   * การขยายพันธุ์ (ทุก CONFIG.breeding.checkInterval วินาทีเกม ไม่ใช่ทุกเฟรม) — ทุกสายพันธุ์ออกลูกเป็นตัวแบบปลาสอด
   * 1) ตัวเมียที่ตั้งท้องครบกำหนด → คลอดลูก 1 ตัว (ต้องมีที่ว่าง) แล้วพักฟื้น CONFIG.breeding.rest
   * 2) คู่ที่เกี้ยวครบเวลา → ผสมพันธุ์ ตัวเมียตั้งท้อง (ปลาสอดต่างสีได้ลูกผสม — planOffspring)
   * 3) ตัวผู้และตัวเมียสายพันธุ์เดียวกันที่พร้อม → ตัวผู้เริ่มว่ายตามเกี้ยวพาราสี (courtStart → Fish AI แสดงท่าทาง)
   */
  private checkBreeding(): void {
    const now = this.now();
    this.deliverBabies(now);
    this.updateCourtships(now);
    const B = CONFIG.breeding;
    const fish = this.tank.fish;
    // นับลูกที่จะตามมา (ตั้งท้องอยู่ + กำลังเกี้ยว) ด้วย — คลอดครบทุกตัวแล้วประชากรต้องไม่เกินความจุตู้
    let room = this.env.capacity - fish.length - this.courtships.size - fish.filter(isPregnant).length;
    if (room <= 0) return;
    const busy = new Set<string>();
    for (const [momId, c] of this.courtships) busy.add(momId).add(c.dadId);
    const byGroup = new Map<string, FishRecord[]>();
    for (const f of fish) {
      if (busy.has(f.id) || !this.canBreed(f, now)) continue;
      const group = breedGroupOf(getSpecies(f.speciesId)) as string;
      if (!byGroup.has(group)) byGroup.set(group, []);
      byGroup.get(group)!.push(f);
    }
    for (const group of byGroup.values()) {
      if (room <= 0) break;
      const males = group.filter((f) => f.gender === 'm');
      const females = group.filter((f) => f.gender === 'f');
      if (!males.length || !females.length) continue;
      const mom = females[Math.floor(this.random() * females.length)];
      const species = getSpecies(mom.speciesId) as SpeciesLike;
      if (this.random() > species.care.breedChance) continue;
      const dad = males[Math.floor(this.random() * males.length)];
      this.courtships.set(mom.id, { dadId: dad.id, until: this.clock + B.courtship });
      room--;
      this.events.push({ type: 'courtStart', momId: mom.id, dadId: dad.id });
    }
  }

  /** เกี้ยวครบเวลา → ผสมพันธุ์ / คู่ที่ไม่พร้อมแล้ว (หิว ป่วย ถูกขาย) → เลิกเกี้ยว */
  private updateCourtships(now: number): void {
    for (const [momId, c] of this.courtships) {
      const mom = this.tank.fish.find((f) => f.id === momId);
      const dad = this.tank.fish.find((f) => f.id === c.dadId);
      if (!mom || !dad || !this.canBreed(mom, now, 10) || !this.canBreed(dad, now, 10)) {
        this.courtships.delete(momId);
        this.events.push({ type: 'courtEnd', momId, dadId: c.dadId });
        continue;
      }
      if (this.clock < c.until) continue;
      this.courtships.delete(momId);
      const fetus = planOffspring(mom, dad, this.random);
      mom.pregnantAt = now;
      mom.fetus = fetus;
      dad.breedCooldown = CONFIG.breeding.cooldown;
      this.events.push({ type: 'mated', momId: mom.id, dadId: dad.id, fetus });
    }
  }

  /** ตัวเมียที่ตั้งท้องครบกำหนด (รวมถึงที่ครบระหว่างปิดเกม) คลอดลูกครั้งละ 1 ตัว — ตัวพ่อไม่ต้องอยู่ในตู้แล้วก็ได้ */
  private deliverBabies(now: number): void {
    for (const mom of [...this.tank.fish]) {
      if (!isPregnant(mom) || now < dueAt(mom)) continue;
      // ตู้เต็ม → รอคลอดไว้ก่อน (ไม่ลบปลาตัวไหน) จนกว่าจะมีที่ว่าง
      if (this.tank.fish.length >= this.env.capacity) {
        if (!this.blockedBirths.has(mom.id)) this.events.push({ type: 'birthBlocked', momId: mom.id });
        this.blockedBirths.add(mom.id);
        continue;
      }
      this.blockedBirths.delete(mom.id);
      // ลูกตามที่กำหนดไว้ตอนตั้งท้อง (ตั้งท้องก่อนมีระบบผสมสี = สายพันธุ์เดียวกับแม่)
      const fetus = mom.fetus ?? { speciesId: mom.speciesId };
      const baby = createFishRecord(fetus.speciesId, { growth: 0, satiety: 60, genes: fetus.genes });
      this.tank.fish.push(baby);
      this.conditions.set(baby.id, conditionOf(baby));
      delete mom.pregnantAt;
      delete mom.fetus;
      mom.breedCooldown = CONFIG.breeding.cooldown;
      mom.lastBirthAt = now;
      this.events.push({ type: 'born', momId: mom.id, baby });
    }
  }
}
