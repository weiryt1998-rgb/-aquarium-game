import { modifiersOf, personalityOf } from './personality.ts';
import type { BehaviorModifiers, Personality } from './personality.ts';
import type { AIWorld, FishNeeds, FishState, FoodItem, SpeciesMotion, Zone } from './types.ts';
import { Vec3, clamp, smoothstep } from './vec.ts';
import type { FishAI } from './FishAI.ts';

/**
 * ปลา 1 ตัวในมุมของ AI: ค่าสถานะ (หิว พลังงาน เครียด สุขภาพ อายุ บุคลิก) + Finite State Machine + Steering
 *
 *  - ตัดสินใจ (decide) เป็นระยะตามบุคลิก (~0.35–0.7 วินาที แต่ละตัวไม่พร้อมกัน) — ไม่เปลี่ยนใจทุกเฟรม
 *    แต่ละสถานะมีเวลาขั้นต่ำ + โบนัสให้อยู่สถานะเดิม (hysteresis) ยกเว้นเหตุด่วน (หิวแล้วเห็นอาหาร ตกใจ จะชน)
 *  - เคลื่อนที่ (step) ทุกจังหวะคงที่: รวมแรงบังคับทิศ → เร่ง/ชะลอ → หมุนหัวได้ไม่เกินอัตราสูงสุด
 *    → ว่ายไปตามทิศหัว (ไม่ไถลข้าง) → บังคับให้อยู่ในตู้เสมอ (ไม่ทะลุกระจก พื้น ของตกแต่ง)
 */

const MAX_PITCH = 0.55; // เงย/ก้มได้ไม่เกิน ~31°
const _want = new Vec3();
const _tmp = new Vec3();
const _dir = new Vec3();
const _ahead = new Vec3();
const _align = new Vec3();
const _center = new Vec3();

export interface AgentInit {
  x: number;
  y: number;
  z: number;
  /** ทิศเริ่มต้น (มุมรอบแกน y) */
  yaw?: number;
  speed?: number;
  energy?: number;
  stress?: number;
}

export class FishAgent {
  readonly id: string;
  species: SpeciesMotion;
  readonly personality: Personality;
  readonly mods: BehaviorModifiers;

  readonly pos = new Vec3();
  readonly prevPos = new Vec3();
  /** ทิศหัวปลา (เวกเตอร์หนึ่งหน่วย) — ปลาว่ายไปตามทิศหัวเสมอ */
  readonly heading = new Vec3(0, 0, 1);
  readonly prevHeading = new Vec3(0, 0, 1);
  readonly vel = new Vec3();
  speed = 0;
  /** อัตราเลี้ยวซ้าย/ขวา (เรเดียน/วินาที, ปรับให้นุ่มแล้ว) ใช้เอียงตัวและโค้งลำตัวในฝั่งเรนเดอร์ */
  yawRate = 0;

  state: FishState = 'idle';
  stateTime = 0;
  private stateMin = 3;
  private resume: FishState = 'idle';
  readonly target = new Vec3();
  targetFood: FoodItem | null = null;
  private eatTimer = 0;
  private thinkTimer: number;
  private readonly phase: number;
  private hazardTime = 0;
  /** เพิ่งได้ยินเสียงโรยอาหาร (วินาทีที่เหลือ) — มองหาอาหารไกลขึ้น */
  foodAlert = 0;

  /** 0 หมดแรง → 100 เต็มที่ */
  energy: number;
  /** 0 สงบ → 100 เครียดมาก */
  stress: number;
  needs: FishNeeds = { hunger: 30, health: 100, growth: 1, age: 0, length: 0.7, pregnant: false, cleanliness: 100 };

  constructor(id: string, species: SpeciesMotion, init: AgentInit, random: () => number) {
    this.id = id;
    this.species = species;
    this.personality = personalityOf(id);
    this.mods = modifiersOf(this.personality);
    this.pos.set(init.x, init.y, init.z);
    this.prevPos.copy(this.pos);
    const yaw = init.yaw ?? random() * Math.PI * 2;
    this.heading.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.prevHeading.copy(this.heading);
    this.speed = init.speed ?? 0;
    this.vel.copy(this.heading).scale(this.speed);
    this.energy = init.energy ?? 65 + random() * 30;
    this.stress = init.stress ?? 10 + random() * 15;
    this.thinkTimer = random() * this.mods.thinkEvery; // แต่ละตัวคิดไม่พร้อมกัน
    this.phase = random() * 100;
    this.target.copy(this.pos);
  }

  get radius(): number {
    return this.needs.length * 0.5;
  }

  /** ความเร็วสูงสุดตอนนี้ (สายพันธุ์ × บุคลิก × สุขภาพ/อายุ/ตั้งท้อง) */
  get maxSpeed(): number {
    const n = this.needs;
    const sick = n.health < 25 ? 0.45 : n.health < 50 ? 0.75 : 1;
    const young = n.growth < 1 ? 0.85 : 1;
    const old = 1 - 0.12 * smoothstep(3 * 3600, 12 * 3600, n.age);
    const tired = 0.7 + 0.3 * smoothstep(5, 40, this.energy);
    return this.species.speed * this.mods.speed * sick * young * old * tired * (n.pregnant ? 0.85 : 1);
  }

  /** อัตราหมุนหัวสูงสุด (เรเดียน/วินาที) */
  get maxTurn(): number {
    return (1.1 + this.species.agility * 0.85) * this.mods.turn * (this.needs.growth < 1 ? 1.15 : 1);
  }

  /** ตกใจ (ทำความสะอาดตู้ ปลาใหม่ลงตู้ โรยอาหาร) */
  startle(amount: number): void {
    this.stress = Math.min(100, this.stress + amount * this.mods.sensitivity);
    if (this.stress >= this.mods.hideStress) this.thinkTimer = 0;
  }

  // ── ตัดสินใจ (FSM) ──────────────────────────────────────────

  private enter(state: FishState, world: AIWorld, ai: FishAI): void {
    if (state === 'avoid' && this.state !== 'avoid') this.resume = this.state === 'eat' ? 'seekFood' : this.state;
    this.state = state;
    this.stateTime = 0;
    const r = ai.random;
    const p = this.personality;
    switch (state) {
      case 'idle':
        this.stateMin = 2.5 + r() * 4 + 3 * p.calm;
        this.pickNearby(world, ai, 1.2);
        break;
      case 'explore':
        this.stateMin = 5 + r() * 8 + 4 * p.curious;
        this.pickWaypoint(world, ai);
        break;
      case 'school':
        this.stateMin = 8 + r() * 10 + 6 * p.social;
        this.pickWaypoint(world, ai);
        break;
      case 'rest':
        this.stateMin = 6 + r() * 6;
        this.pickRestSpot(world, ai);
        break;
      case 'hide':
        this.stateMin = 5 + r() * 5 + 6 * p.shy;
        this.pickCover(world, ai);
        break;
      case 'eat':
        this.stateMin = 0;
        this.eatTimer = 0.35 + r() * 0.3;
        break;
      case 'avoid':
        this.stateMin = 0.5;
        break;
      case 'seekFood':
        this.stateMin = 0;
        break;
    }
  }

  /** ตัดสินใจสถานะถัดไป (เรียกเป็นระยะ ไม่ใช่ทุกจังหวะ) */
  decide(world: AIWorld, ai: FishAI): void {
    const n = this.needs;
    if (this.state === 'eat' || this.state === 'avoid') return;

    // 1) เครียดมาก → หนีไปหลบ (ด่วน)
    if (this.stress >= this.mods.hideStress && world.covers.length) {
      if (this.state !== 'hide') this.enter('hide', world, ai);
      return;
    }
    // 2) หิวและเห็นอาหาร → ไปกิน (ด่วน) — หิวมากยิ่งมองเห็นไกลและอยากไปมาก
    const wantFood = n.hunger >= 8 && (n.hunger > 35 || ai.random() < n.hunger / 35 || this.state === 'seekFood');
    if (wantFood) {
      const food = ai.pickFood(this);
      if (food) {
        this.targetFood = food;
        if (this.state !== 'seekFood') this.enter('seekFood', world, ai);
        return;
      }
    }
    if (this.state === 'seekFood') this.targetFood = null;

    // 3) อยู่สถานะเดิมจนครบเวลาขั้นต่ำ (ไม่เปลี่ยนใจถี่)
    const settled = this.stateTime >= this.stateMin;
    if (this.state === 'hide' && (this.stress > 25 || !settled)) return;
    if (this.state === 'rest' && (this.energy < 85 || !settled) && n.health >= 25) return;
    if (this.state !== 'seekFood' && !settled) return;

    // 4) เหนื่อยหรือป่วย → พัก
    if (this.energy < this.mods.restBelow || n.health < 25) {
      if (this.state !== 'rest') this.enter('rest', world, ai);
      return;
    }

    // 5) เลือกตามบุคลิก (สุ่มแบบถ่วงน้ำหนัก + โบนัสให้ทำต่อ)
    const p = this.personality;
    const mates = ai.countMates(this, 3);
    const keep = (s: FishState) => (this.state === s ? 0.25 : 0);
    const wIdle = 0.25 + 0.55 * p.calm + 0.3 * smoothstep(60, 20, this.energy) + keep('idle');
    const wExplore = 0.1 + this.mods.explore * 0.9 + keep('explore');
    const wSchool = mates > 0 ? (this.species.schooling ? 0.3 + this.mods.school : this.mods.school * 0.35) + keep('school') : 0;
    const total = wIdle + wExplore + wSchool;
    let roll = ai.random() * total;
    const next: FishState = (roll -= wIdle) < 0 ? 'idle' : (roll -= wExplore) < 0 ? 'explore' : 'school';
    this.enter(next, world, ai);
  }

  // ── เป้าหมาย ─────────────────────────────────────────────────

  private bandFor(zone: Zone): [number, number] {
    // ป่วยหนักนอนก้นตู้ / น้ำเน่าออกซิเจนต่ำ → ขึ้นไปฮุบอากาศที่ผิวน้ำ (เหมือนปลาจริง)
    if (this.needs.cleanliness < 25) return [0.65, 1];
    if (zone === 'top') return [0.6, 1];
    if (zone === 'bottom') return [0, 0.4];
    if (zone === 'middle') return [0.25, 0.8];
    return [0, 1];
  }

  /** จุดสุ่มในตู้ตามระดับความลึกที่ชอบ (ขี้สงสัย = กว้างขึ้น, ขี้อาย = ไม่ไกลที่หลบ) */
  private pickWaypoint(world: AIWorld, ai: FishAI): void {
    const r = ai.random;
    const m = 0.7 + this.radius;
    const zone = this.personality.curious > 0.7 && r() < 0.35 ? 'any' : this.species.zone;
    const [lo, hi] = this.bandFor(zone);
    for (let i = 0; i < 6; i++) {
      const x = (r() - 0.5) * (world.w - 2 * m);
      const z = (r() - 0.5) * (world.d - 2 * m);
      const floor = world.floorAt(x, z) + m;
      const top = world.waterTop - m;
      const y = floor + Math.max(top - floor, 0.1) * (lo + r() * (hi - lo));
      this.target.set(x, y, z);
      if (!this.insideObstacle(world, this.target, 0.3)) break;
    }
  }

  /** จุดใกล้ ๆ ตำแหน่งเดิม (ว่ายเล่นอยู่แถวนี้) */
  private pickNearby(world: AIWorld, ai: FishAI, range: number): void {
    const r = ai.random;
    this.target.set(this.pos.x + (r() - 0.5) * 2 * range, this.pos.y + (r() - 0.5) * range * 0.5, this.pos.z + (r() - 0.5) * 2 * range);
    const [lo, hi] = this.bandFor(this.species.zone);
    const floor = world.floorAt(this.target.x, this.target.z) + 0.6;
    const top = world.waterTop - 0.6;
    this.target.y = clamp(this.target.y, floor + (top - floor) * lo * 0.8, floor + (top - floor) * Math.min(1, hi + 0.1));
    this.clampTarget(world);
  }

  /** ที่พัก: ใกล้พื้น (ขี้อายพักใกล้ที่หลบ) */
  private pickRestSpot(world: AIWorld, ai: FishAI): void {
    const cover = this.personality.shy > 0.5 ? ai.nearestCover(this, false) : null;
    if (cover) this.target.set(cover.x + (ai.random() - 0.5) * cover.r, 0, cover.z + (ai.random() - 0.5) * cover.r);
    else this.target.set(this.pos.x, 0, this.pos.z);
    this.target.y = world.floorAt(this.target.x, this.target.z) + this.radius + 0.35;
    this.clampTarget(world);
  }

  /** ที่หลบ: ในพุ่มพืชน้ำ หรือข้าง ๆ ของตกแต่ง */
  private pickCover(world: AIWorld, ai: FishAI): void {
    const cover = ai.nearestCover(this, true);
    if (!cover) return this.pickRestSpot(world, ai);
    const a = ai.random() * Math.PI * 2;
    const d = cover.plant ? cover.r * 0.45 : cover.r + this.radius + 0.25;
    const x = cover.x + Math.cos(a) * d;
    const z = cover.z + Math.sin(a) * d;
    const floor = world.floorAt(x, z);
    this.target.set(x, floor + this.radius + 0.3 + ai.random() * Math.max(0, (cover.top - floor) * 0.5), z);
    this.clampTarget(world);
  }

  private clampTarget(world: AIWorld): void {
    const m = 0.6 + this.radius;
    this.target.x = clamp(this.target.x, -world.w / 2 + m, world.w / 2 - m);
    this.target.z = clamp(this.target.z, -world.d / 2 + m, world.d / 2 - m);
    const floor = world.floorAt(this.target.x, this.target.z) + this.radius + 0.25;
    this.target.y = clamp(this.target.y, floor, world.waterTop - 0.35 - this.radius * 0.3);
  }

  private insideObstacle(world: AIWorld, p: Vec3, pad: number): boolean {
    for (const o of world.obstacles) {
      if (p.y > o.top + pad) continue;
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      if (dx * dx + dz * dz < (o.r + this.radius + pad) ** 2) return true;
    }
    return false;
  }

  // ── เคลื่อนที่ ───────────────────────────────────────────────

  /** เดินเวลา 1 จังหวะ (dt คงที่) */
  step(dt: number, world: AIWorld, ai: FishAI): void {
    this.prevPos.copy(this.pos);
    this.prevHeading.copy(this.heading);
    this.stateTime += dt;
    this.foodAlert = Math.max(0, this.foodAlert - dt);
    this.updateFeelings(dt, ai);

    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = this.mods.thinkEvery * (0.8 + ai.random() * 0.4);
      this.decide(world, ai);
    }

    const max = this.maxSpeed;
    let cruise = this.steerState(dt, world, ai, max); // ใส่ทิศที่อยากไปไว้ใน _want
    // แรงเสริม: ระยะห่างจากปลาตัวอื่น / ขอบตู้ / ของตกแต่ง
    ai.separation(this, _tmp);
    _want.addScaled(_tmp, max * 2.2);
    const hazard = this.avoidWalls(world, _tmp);
    _want.addScaled(_tmp, max * 3);
    const blocked = this.avoidObstacles(world, _tmp);
    _want.addScaled(_tmp, max * 3.5);

    // จะชนข้างหน้า → เข้าสถานะหลบชั่วคราว แล้วกลับไปทำสิ่งเดิม
    if ((hazard || blocked) && this.state !== 'eat' && this.state !== 'rest' && this.state !== 'hide') {
      this.hazardTime += dt;
      if (this.state !== 'avoid' && this.hazardTime > 0.15) this.enter('avoid', world, ai);
    } else this.hazardTime = 0;
    if (this.state === 'avoid') {
      cruise = Math.max(cruise, max * 0.7);
      if (!hazard && !blocked && this.stateTime > this.stateMin) this.enter(this.resume, world, ai);
    }

    _want.clampLength(Math.max(cruise, 0.02) * 1.3);
    this.integrate(dt, max);
    this.constrain(world);
  }

  /** ทิศและความเร็วที่อยากไปตามสถานะ (เขียนลง _want) → คืนความเร็วเป้าหมาย */
  private steerState(dt: number, world: AIWorld, ai: FishAI, max: number): number {
    const t = ai.time + this.phase;
    _want.set(0, 0, 0);
    switch (this.state) {
      case 'idle': {
        // ลอยตัวช้า ๆ แถวเดิม ส่ายไปมาเล็กน้อย
        const speed = max * (0.22 + 0.12 * Math.sin(t * 0.37));
        this.seek(this.target, speed, 1.2);
        if (this.pos.distanceSq(this.target) < 0.25) this.pickNearby(world, ai, 1.2);
        return speed;
      }
      case 'explore': {
        const speed = max * (0.6 + 0.25 * this.personality.active);
        this.seek(this.target, speed, 1.0);
        if (this.pos.distanceSq(this.target) < 0.5) this.pickWaypoint(world, ai);
        return speed;
      }
      case 'school': {
        const speed = max * 0.6;
        const n = ai.mateCenter(this, 3, _center, _align);
        if (n > 0) {
          // Alignment + Cohesion (+ Separation ที่ใส่ภายหลัง) และค่อย ๆ ว่ายไปทางเป้าหมายรวม
          _want.addScaled(_align.normalize(), speed * (0.6 + 0.4 * this.mods.school));
          _tmp.subVectors(_center, this.pos);
          _want.addScaled(_tmp, 0.8 * this.mods.school);
        }
        this.seek(this.target, speed * 0.5, 1.0);
        if (this.pos.distanceSq(this.target) < 1) this.pickWaypoint(world, ai);
        return speed;
      }
      case 'rest': {
        // ว่ายไปที่พักแล้วลอยนิ่ง ๆ ครีบขยับเบา ๆ
        const speed = max * 0.25;
        this.seek(this.target, speed, 1.5);
        return this.pos.distanceSq(this.target) < 0.3 ? max * 0.05 : speed;
      }
      case 'hide': {
        const near = this.pos.distanceSq(this.target) < 0.4;
        const speed = near ? max * 0.08 : max * (0.85 + 0.2 * this.personality.shy);
        this.seek(this.target, speed, 1.2);
        return speed;
      }
      case 'seekFood': {
        const food = this.targetFood;
        if (!food || food.gone) {
          this.targetFood = null;
          this.thinkTimer = 0;
          this.seek(this.target, max * 0.4, 1);
          return max * 0.4;
        }
        // หิวมากยิ่งรีบ
        const speed = max * (1.0 + 0.4 * smoothstep(20, 80, this.needs.hunger));
        this.seek(food.position, speed, 0.6);
        const reach = this.radius * 0.7 + 0.12;
        if (this.pos.distanceSq(food.position) < reach * reach) this.enter('eat', world, ai);
        return speed;
      }
      case 'eat': {
        // ชะลอ จิกกินอาหาร แล้วกลับไปตัดสินใจใหม่
        const food = this.targetFood;
        if (food && !food.gone) this.seek(food.position, max * 0.15, 0.3);
        this.eatTimer -= dt;
        if (this.eatTimer <= 0) {
          if (food && !food.gone) world.consume(food, this.id);
          this.targetFood = null;
          this.state = 'seekFood'; // ตัดสินใจทันทีว่าจะกินต่อหรือพอแล้ว
          this.stateTime = 0;
          this.thinkTimer = 0;
          this.decide(world, ai);
          if (this.state === 'seekFood' && !this.targetFood) this.enter('idle', world, ai);
        }
        return max * 0.12;
      }
      case 'avoid':
        this.seek(this.target, max * 0.5, 1);
        return max * 0.7;
    }
  }

  /** ไปหาจุดเป้าหมาย ชะลอเมื่อใกล้ (arrive) */
  private seek(p: { x: number; y: number; z: number }, speed: number, slow: number): void {
    _dir.subVectors(p, this.pos);
    const d = _dir.length();
    if (d < 1e-4) return;
    const s = d < slow ? speed * (0.25 + (0.75 * d) / slow) : speed;
    _want.addScaled(_dir, s / d);
  }

  /** แรงผลักออกจากกระจก พื้น ผิวน้ำ (นุ่ม) — คืน true ถ้าจุดข้างหน้าใกล้ชน */
  private avoidWalls(world: AIWorld, out: Vec3): boolean {
    out.set(0, 0, 0);
    const p = this.pos;
    const range = 1.0 + this.radius;
    const hx = world.w / 2;
    const hz = world.d / 2;
    if (p.x < -hx + range) out.x += (-hx + range - p.x) / range;
    if (p.x > hx - range) out.x -= (p.x - (hx - range)) / range;
    if (p.z < -hz + range) out.z += (-hz + range - p.z) / range;
    if (p.z > hz - range) out.z -= (p.z - (hz - range)) / range;
    // ตอนไปกินอาหาร (ลอยที่ผิวน้ำ/จมถึงพื้น) หรือพัก/หลบใกล้พื้น ผ่อนแรงกันผิวน้ำ/พื้นลง — ข้อจำกัดใน constrain() ยังกันไม่ให้ทะลุ
    const feeding = this.state === 'seekFood' || this.state === 'eat';
    const floor = world.floorAt(p.x, p.z) + this.radius * 0.5 + 0.15;
    const vr = 0.6 + this.radius * 0.5;
    if (p.y < floor + vr && this.state !== 'rest' && this.state !== 'hide') out.y += ((floor + vr - p.y) / vr) * (feeding ? 0.15 : 1);
    const top = world.waterTop - 0.2 - this.radius * 0.25;
    if (p.y > top - vr) out.y -= ((p.y - (top - vr)) / vr) * (feeding ? 0.15 : 1);
    // มองข้างหน้า: ถ้าอีกครู่จะออกนอกตู้ = อันตราย
    _ahead.copy(p).addScaled(this.heading, this.speed * 0.8 + this.radius);
    const m = this.radius * 0.6 + 0.15;
    return _ahead.x < -hx + m || _ahead.x > hx - m || _ahead.z < -hz + m || _ahead.z > hz - m || _ahead.y < world.floorAt(_ahead.x, _ahead.z) + m * 0.5;
  }

  /** แรงหลบของตกแต่ง: ผลักออก + ไถลอ้อมไปด้านข้างตามทิศที่ว่ายอยู่ (ไม่ติดค้าง) — คืน true ถ้าจะชน */
  private avoidObstacles(world: AIWorld, out: Vec3): boolean {
    out.set(0, 0, 0);
    let blocked = false;
    const p = this.pos;
    for (const o of world.obstacles) {
      if (p.y > o.top + this.radius + 0.3) continue;
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const range = o.r + this.radius + 0.55;
      const d2 = dx * dx + dz * dz;
      if (d2 >= range * range) continue;
      const d = Math.sqrt(d2) || 0.001;
      const f = (range - d) / range;
      // ด้านที่ปลากำลังว่ายผ่าน (อ้อมไปทางเดียวกับที่หัวชี้)
      const side = this.heading.x * -dz + this.heading.z * dx >= 0 ? 1 : -1;
      out.x += (dx / d) * f * 1.4 + (-dz / d) * side * f * 0.8;
      out.z += (dz / d) * f * 1.4 + (dx / d) * side * f * 0.8;
      if (p.y > o.top - 0.4) out.y += f * 0.6; // ใกล้ยอด → ว่ายข้ามไปได้
      const ahead = this.heading.x * -dx + this.heading.z * -dz; // หัวชี้เข้าหาสิ่งกีดขวางไหม
      if (ahead > 0 && d < o.r + this.radius + 0.35) blocked = true;
    }
    return blocked;
  }

  /** เร่ง/ชะลอเข้าหาความเร็วที่ต้องการ แล้วหมุนหัวด้วยอัตราจำกัด ว่ายไปตามทิศหัว */
  private integrate(dt: number, max: number): void {
    const accel = 1.5 + this.species.agility * 0.8;
    this.vel.addScaled(_tmp.subVectors(_want, this.vel), Math.min(1, accel * dt));
    const speed = this.vel.length();

    // หมุนหัวไปทางที่อยากไป ได้ไม่เกิน maxTurn × dt (เลี้ยวนุ่ม ไม่หักมุม)
    const prevYaw = Math.atan2(this.heading.x, this.heading.z);
    if (speed > 0.01) {
      _dir.copy(this.vel).scale(1 / speed);
      limitPitch(_dir);
      // ความเร็วต่ำ (ลอยตัว) ไม่หันหัวตามแรงเล็ก ๆ บ่อย ๆ — กันหัวส่ายไปมา
      const turnScale = smoothstep(0.02, max * 0.25 + 0.03, speed);
      rotateTowards(this.heading, _dir, this.maxTurn * dt * (0.25 + 0.75 * turnScale));
    }
    this.heading.normalize();

    // ว่ายไปตามทิศหัว (ปลาไม่ไถลข้าง) — ความเร็วไม่เกินขีดจำกัด
    this.speed = Math.min(speed, max * 1.45);
    this.vel.copy(this.heading).scale(this.speed);
    // ปรับระดับความลึกด้วยครีบได้โดยไม่ต้องเงยหัวชัน (ขึ้นไปกินอาหารที่ผิวน้ำ/ลงไปพักที่พื้นได้)
    const lift = max * 0.45 + 0.05;
    this.vel.y += clamp(_want.y - this.vel.y, -lift, lift) * smoothstep(0.05, 0.6, Math.abs(_want.y));
    this.pos.addScaled(this.vel, dt);
    // ลอยตัวขึ้นลงเบา ๆ ตอนว่ายช้า (เหมือนพยุงตัวด้วยครีบ)
    const hover = 1 - smoothstep(0, max * 0.35, this.speed);
    this.pos.y += Math.sin((this.stateTime + this.phase) * 1.3) * 0.035 * hover * dt;

    let dyaw = Math.atan2(this.heading.x, this.heading.z) - prevYaw;
    if (dyaw > Math.PI) dyaw -= Math.PI * 2;
    if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.yawRate += (dyaw / dt - this.yawRate) * Math.min(1, 6 * dt);
  }

  /** บังคับให้อยู่ในน้ำเสมอ: ไม่ทะลุกระจก พื้นทราย ผิวน้ำ หรือของตกแต่ง */
  private constrain(world: AIWorld): void {
    const p = this.pos;
    const m = this.radius * 0.6 + 0.12;
    p.x = clamp(p.x, -world.w / 2 + m, world.w / 2 - m);
    p.z = clamp(p.z, -world.d / 2 + m, world.d / 2 - m);
    const floor = world.floorAt(p.x, p.z) + this.radius * 0.45 + 0.12;
    p.y = clamp(p.y, floor, world.waterTop - 0.18 - this.radius * 0.25);
    for (const o of world.obstacles) {
      if (p.y > o.top + this.radius * 0.3) continue;
      const dx = p.x - o.x;
      const dz = p.z - o.z;
      const min = o.r * 0.8 + this.radius * 0.5;
      const d2 = dx * dx + dz * dz;
      if (d2 >= min * min) continue;
      const d = Math.sqrt(d2) || 0.001;
      p.x = o.x + (dx / d) * min;
      p.z = o.z + (dz / d) * min;
    }
  }

  /** พลังงานและความเครียด (ค่าระยะสั้น ไม่บันทึกลงเซฟ) */
  private updateFeelings(dt: number, ai: FishAI): void {
    const n = this.needs;
    const effort = this.speed / Math.max(this.species.speed, 0.05);
    const age = 1 + 0.3 * smoothstep(3 * 3600, 12 * 3600, n.age);
    let energy = -(0.04 + 0.45 * effort * effort * (1 - 0.3 * this.personality.active)) * age;
    if (this.state === 'rest') energy += 4.5;
    else if (this.state === 'idle' || this.state === 'hide') energy += 0.7;
    this.energy = clamp(this.energy + energy * dt, 0, 100);

    const crowd = ai.crowdedness(this);
    const dirty = smoothstep(45, 10, n.cleanliness);
    const sick = smoothstep(50, 15, n.health);
    const gain = this.mods.sensitivity * (crowd * 2 + dirty * 2.5 + sick * 1.5);
    const calmDown = 3 + 3 * this.personality.calm + (this.state === 'hide' && this.stateTime > 2 ? 5 : 0);
    this.stress = clamp(this.stress + (gain - calmDown) * dt, 0, 100);
  }
}

/** จำกัดมุมก้ม/เงยของทิศ (เวกเตอร์หนึ่งหน่วย) */
function limitPitch(v: Vec3): void {
  const limit = Math.sin(MAX_PITCH);
  if (Math.abs(v.y) <= limit) return;
  const h = Math.hypot(v.x, v.z);
  if (h < 1e-6) {
    v.set(0, Math.sign(v.y) * limit, Math.cos(MAX_PITCH));
    return;
  }
  const k = Math.cos(MAX_PITCH) / h;
  v.set(v.x * k, Math.sign(v.y) * limit, v.z * k);
}

/** หมุนเวกเตอร์หนึ่งหน่วย v เข้าหา to ได้ไม่เกิน maxAngle (slerp) */
function rotateTowards(v: Vec3, to: Vec3, maxAngle: number): void {
  const dot = clamp(v.dot(to), -1, 1);
  const angle = Math.acos(dot);
  if (angle <= maxAngle || angle < 1e-5) {
    v.copy(to);
    return;
  }
  if (Math.PI - angle < 1e-3) {
    // ตรงข้ามกันพอดี: หมุนรอบแกนตั้งไปข้างใดข้างหนึ่ง
    const c = Math.cos(maxAngle);
    const s = Math.sin(maxAngle);
    v.set(v.x * c + v.z * s, v.y, -v.x * s + v.z * c);
    return;
  }
  const t = maxAngle / angle;
  const sin = Math.sin(angle);
  const a = Math.sin((1 - t) * angle) / sin;
  const b = Math.sin(t * angle) / sin;
  v.set(v.x * a + to.x * b, v.y * a + to.y * b, v.z * a + to.z * b).normalize();
}
