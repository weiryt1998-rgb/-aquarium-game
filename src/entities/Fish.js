import * as THREE from 'three';
import { forEachMaterial, disposeObject } from '../assets/AssetLoader.js';
import { angleDelta, clamp, damp, lerp, pick, rand } from '../utils/math.js';
import { noise2 } from '../utils/noise.js';
import { isPregnant, pregnancyProgress } from '../shared/breeding.js';
import { fryAmount, isColorHidden } from '../models/molly/fry.js';

const _desired = new THREE.Vector3();
const _steer = new THREE.Vector3();
const _sep = new THREE.Vector3();
const _align = new THREE.Vector3();
const _coh = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _target = new THREE.Vector3();
const _box = new THREE.Box3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * ปลา 1 ตัวในฉาก (ฝั่งแสดงผล)
 * - data    : record ที่บันทึกลงเซฟ (ความอิ่ม สุขภาพ การเติบโต ฯลฯ) — ค่าเหล่านี้คำนวณใน Simulation Engine (src/sim/)
 *             คลาสนี้แค่อ่านไปใช้ (ขนาดตัว ว่ายช้าตอนป่วย ท้องป่องตอนตั้งท้อง)
 * - species : ข้อมูลสายพันธุ์จาก data/fish.js
 * การเคลื่อนที่ใช้ steering behaviors (wander + หลบกำแพง/สิ่งกีดขวาง + ว่ายเป็นฝูง + ไล่กินอาหาร) คำนวณทุกเฟรม
 */
export class Fish {
  constructor(game, data, species) {
    this.game = game;
    this.data = data;
    this.species = species;
    this.id = data.id;

    this.wiggle = new THREE.Group();
    this.#buildVisual();
    this.trailAcc = 0;
    this.group = new THREE.Group();
    this.group.add(this.wiggle);
    this.group.userData.fish = this;

    const angle = Math.random() * Math.PI * 2;
    this.velocity = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(species.behavior.speed * 0.5);
    /** Fish AI ของตัวนี้ (FishManager ผูกให้ปลาที่ว่ายน้ำ — ปูยังใช้การเดินแบบเดิม) */
    this.agent = null;
    this.heading = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle));
    this.yaw = angle;
    this.pitch = 0;
    this.roll = 0;
    this.wanderTarget = new THREE.Vector3();
    this.wanderTimer = 0;
    this.seed = Math.random() * 100;
    this.wigglePhase = Math.random() * 10;
    this.eatCooldown = 0;
    this.dying = false;
    this.dyingTime = 0;
    this.updateScale();
    /** สถานะ "ยังไม่เผยสี" ที่แสดงอยู่ล่าสุด — FishManager ใช้จับจังหวะเผยสี */
    this.shownHidden = this.colorHidden;
  }

  /** สร้างโมเดล 3 มิติตามช่วงวัย (ลูกปลาบางสายพันธุ์มีโมเดลแยก — ดู ModelFactory.isBabyLook) */
  #buildVisual() {
    const visual = this.game.models.createFish(this.species, { genes: this.data.genes, growth: this.data.growth });
    this.visual = visual.object;
    this.babyLook = !!visual.baby;
    this.mixer = visual.mixer;
    this.swim = visual.swimUniforms;
    this.walk = visual.walkUniforms ?? null;
    this.rig = visual.rig ?? null; // ขยับโครงกระดูกด้วยโค้ด (ม้าน้ำ)
    this.fry = visual.fry ?? null; // สีลูกปลาแรกเกิดทับสีจริง (ปลาสอด — models/molly/fry.js)
    // อนุภาคแสงที่ปล่อยตามหลังขณะว่าย (ถ้าโมเดลจากโค้ดส่งมา) — { colors, rate ต่อวินาที, offset = ตำแหน่งปลายหางบนแกน z }
    this.trail = visual.trail ?? null;
    // สัตว์ที่เดินพื้น: ระยะจากจุดศูนย์กลางถึงปลายขา (หน่วยของโมเดล) ใช้วางตัวให้ยืนบนทรายพอดี
    this.footOffset = this.species.behavior.walker ? -_box.setFromObject(this.visual, true).min.y : 0;
    this.wiggle.add(this.visual);
  }

  /**
   * ลูกปลาโตพ้นช่วงวัยเด็กแล้ว → เปลี่ยนจากโมเดลลูกปลาเป็นตัวเต็มวัย (หรือกลับกันถ้าข้อมูลจากอีกเครื่องต่างไป)
   * @returns {boolean} เปลี่ยนโมเดลแล้ว
   */
  refreshLook() {
    if (this.dying || this.game.models.isBabyLook(this.species, this.data.growth) === this.babyLook) return false;
    this.mixer?.stopAllAction();
    this.wiggle.remove(this.visual);
    disposeObject(this.visual);
    this.#buildVisual();
    return true;
  }

  get position() {
    return this.group.position;
  }

  get sizeFactor() {
    return 0.45 + 0.55 * this.data.growth;
  }

  get length() {
    return this.species.length * this.sizeFactor;
  }

  get radius() {
    return this.length * 0.5;
  }

  get isAdult() {
    return this.data.growth >= 1;
  }

  updateScale() {
    this.group.scale.setScalar(this.length);
    // ลูกปลาสอด: สีจริงค่อย ๆ เผยออกมาเมื่อโตขึ้น
    if (this.fry) this.fry.value = fryAmount(this.species, this.data.growth);
  }

  /** ยังไม่เผยสีจริง (ลูกปลาสอดแรกเกิด) — UI ซ่อนชื่อสายพันธุ์/ยีนไว้ให้ผู้เล่นลุ้น */
  get colorHidden() {
    return isColorHidden(this.species, this.data.growth);
  }

  // ── การเคลื่อนที่ ────────────────────────────────────────────

  updateMovement(dt, ctx) {
    if (this.species.behavior.walker) {
      this.#walkMovement(dt, ctx);
      return;
    }
    const b = this.species.behavior;
    const pos = this.group.position;
    const sick = this.data.health < 25;
    const maxSpeed = b.speed * (sick ? 0.45 : 1) * (this.isAdult ? 1 : 0.85);
    let cruise = maxSpeed * lerp(0.35, 0.85, noise2(this.seed, ctx.time * 0.15));
    let limit = maxSpeed;
    _steer.set(0, 0, 0);
    this.eatCooldown -= dt;

    // 1) ไล่กินอาหาร
    let seeking = false;
    if (this.data.satiety < 92 && this.eatCooldown <= 0) {
      const food = ctx.food.findNearest(pos);
      if (food) {
        seeking = true;
        limit = maxSpeed * 1.4;
        this.#seek(food.position, limit, 0.35, _steer);
        const reach = 0.12 + this.length * 0.35;
        if (pos.distanceToSquared(food.position) < reach * reach) {
          ctx.food.consume(food, this);
          this.eatCooldown = 0.4;
        }
      }
    }

    // 2) ว่ายเล่นไปเรื่อย ๆ
    if (!seeking) {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0 || pos.distanceToSquared(this.wanderTarget) < 0.4) this.#pickWanderTarget(ctx);
      this.#seek(this.wanderTarget, cruise, 1.2, _steer);
    }

    // 3) เพื่อนรอบตัว / 4) สิ่งกีดขวาง / 5) ขอบตู้
    this.#flock(ctx.fish, maxSpeed, _steer);
    this.#avoidObstacles(ctx.obstacles, _steer);
    this.#avoidBounds(ctx.aquarium, _steer);

    const agility = b.agility ?? 2;
    _steer.clampLength(0, maxSpeed * agility * 1.6);
    this.velocity.addScaledVector(_steer, dt);
    this.velocity.y *= Math.exp(-dt * 1.2); // ปลาชอบว่ายแนวนอนมากกว่าขึ้นลง
    const speed = this.velocity.length();
    if (speed > limit) this.velocity.multiplyScalar(limit / speed);
    if (speed < 0.05) {
      this.velocity.x += Math.sin(this.yaw) * 0.05;
      this.velocity.z += Math.cos(this.yaw) * 0.05;
    }
    pos.addScaledVector(this.velocity, dt);
    ctx.aquarium.clampToWater(pos, this.radius * 0.6 + 0.15);
  }

  /** เดินบนพื้นทราย (ปู): เดินบ้างหยุดบ้าง เก็บอาหารที่จมถึงพื้น หลบของตกแต่งและขอบตู้ */
  #walkMovement(dt, ctx) {
    const b = this.species.behavior;
    const pos = this.group.position;
    const aq = ctx.aquarium;
    const maxSpeed = b.speed * (this.data.health < 25 ? 0.5 : 1) * (this.isAdult ? 1 : 0.85);
    const active = noise2(this.seed, ctx.time * 0.12) > 0.4;
    let limit = active ? maxSpeed * lerp(0.5, 1, noise2(this.seed + 7, ctx.time * 0.3)) : 0;
    _steer.set(0, 0, 0);
    this.eatCooldown -= dt;

    let seeking = false;
    if (this.data.satiety < 92 && this.eatCooldown <= 0) {
      const food = ctx.food.findNearest(pos, (p) => p.settled || p.position.y < aq.heightAt(p.position.x, p.position.z) + 0.5);
      if (food) {
        seeking = true;
        limit = maxSpeed * 1.3;
        this.#seek(_target.set(food.position.x, pos.y, food.position.z), limit, 0.3, _steer);
        const reach = 0.15 + this.length * 0.4;
        const dx = food.position.x - pos.x;
        const dz = food.position.z - pos.z;
        if (dx * dx + dz * dz < reach * reach) {
          ctx.food.consume(food, this);
          this.eatCooldown = 0.6;
        }
      }
    }
    if (!seeking) {
      this.wanderTimer -= dt;
      if (this.wanderTimer <= 0 || pos.distanceToSquared(this.wanderTarget) < 0.3) this.#pickWanderTarget(ctx);
      this.#seek(_target.set(this.wanderTarget.x, pos.y, this.wanderTarget.z), limit, 0.8, _steer);
    }
    this.#flock(ctx.fish, maxSpeed, _steer);
    this.#walkAround(ctx.obstacles, _steer);
    this.#avoidBounds(aq, _steer);

    _steer.y = 0;
    _steer.clampLength(0, maxSpeed * (b.agility ?? 2) * 1.6);
    this.velocity.addScaledVector(_steer, dt);
    this.velocity.y = 0;
    const speed = this.velocity.length();
    if (speed > Math.max(limit, 0.001)) this.velocity.multiplyScalar(Math.max(limit, 0) / speed);
    if (!active && !seeking) this.velocity.multiplyScalar(Math.exp(-dt * 4)); // หยุดพัก
    pos.addScaledVector(this.velocity, dt);
    aq.clampToWater(pos, this.radius * 0.6 + 0.15);
    pos.y = aq.heightAt(pos.x, pos.z) + this.footOffset * this.group.scale.y; // ยืนบนทราย
  }

  /**
   * หลบของตกแต่งสำหรับสัตว์ที่เดินพื้น — ข้ามไปด้านบนไม่ได้ จึงดันออกพร้อม "ไถลอ้อม" ไปด้านข้าง
   * (ไม่งั้นจะติดนิ่งในซอกระหว่างของตกแต่ง เมื่อแรงหลบหักล้างกับแรงเดินไปหาเป้าหมายพอดี)
   */
  #walkAround(obstacles, out) {
    const pos = this.group.position;
    const slide = this.seed % 2 < 1 ? 1 : -1; // แต่ละตัวอ้อมคนละทาง
    for (const o of obstacles) {
      const dx = pos.x - o.x;
      const dz = pos.z - o.z;
      const range = o.r * 0.75 + this.radius * 0.6;
      const d2 = dx * dx + dz * dz;
      if (d2 >= range * range) continue;
      const d = Math.sqrt(d2) || 0.001;
      const f = (range - d) / range;
      out.x += (dx / d) * f * 3 - (dz / d) * f * 1.5 * slide;
      out.z += (dz / d) * f * 3 + (dx / d) * f * 1.5 * slide;
    }
  }

  #seek(target, speed, slowRadius, out) {
    _desired.subVectors(target, this.group.position);
    const dist = _desired.length();
    if (dist < 1e-4) return;
    const s = dist < slowRadius ? speed * (0.3 + (0.7 * dist) / slowRadius) : speed;
    _desired.multiplyScalar(s / dist).sub(this.velocity).multiplyScalar(this.species.behavior.agility ?? 2);
    out.add(_desired);
  }

  #pickWanderTarget(ctx) {
    // ป่วยหนัก → นอนก้นตู้ / น้ำเน่าออกซิเจนต่ำ → ว่ายขึ้นไปฮุบอากาศที่ผิวน้ำ (เหมือนปลาจริง)
    const zone = this.data.health < 25 ? 'bottom' : ctx.cleanliness < 25 ? 'top' : this.species.behavior.zone;
    for (let i = 0; i < 6; i++) {
      ctx.aquarium.randomPoint(zone, 0.6 + this.radius, this.wanderTarget);
      const blocked = ctx.obstacles.some((o) => {
        const dx = this.wanderTarget.x - o.x;
        const dz = this.wanderTarget.z - o.z;
        return dx * dx + dz * dz < (o.r + this.radius) ** 2 && this.wanderTarget.y < o.top + 0.3;
      });
      if (!blocked) break;
    }
    this.wanderTimer = rand(3, 8);
  }

  #flock(list, maxSpeed, out) {
    const pos = this.group.position;
    _sep.set(0, 0, 0);
    _align.set(0, 0, 0);
    _coh.set(0, 0, 0);
    let mates = 0;
    const schooling = this.species.behavior.schooling;
    for (const other of list) {
      if (other === this || other.dying) continue;
      const dx = pos.x - other.position.x;
      const dy = pos.y - other.position.y;
      const dz = pos.z - other.position.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      const minDist = (this.length + other.length) * 0.55;
      if (d2 < minDist * minDist && d2 > 1e-6) {
        const d = Math.sqrt(d2);
        const f = (minDist - d) / minDist;
        _sep.x += (dx / d) * f;
        _sep.y += (dy / d) * f;
        _sep.z += (dz / d) * f;
      }
      if (schooling && other.species === this.species && d2 < 6.25) {
        _align.add(other.velocity);
        _coh.add(other.position);
        mates++;
      }
    }
    out.addScaledVector(_sep, maxSpeed * 3);
    if (mates > 0) {
      _align.divideScalar(mates).sub(this.velocity).multiplyScalar(0.9);
      _coh.divideScalar(mates).sub(pos).multiplyScalar(0.7);
      out.add(_align).add(_coh);
    }
  }

  #avoidObstacles(obstacles, out) {
    const pos = this.group.position;
    for (const o of obstacles) {
      if (pos.y > o.top + 0.3) continue;
      const dx = pos.x - o.x;
      const dz = pos.z - o.z;
      const range = o.r + this.radius + 0.25;
      const d2 = dx * dx + dz * dz;
      if (d2 >= range * range) continue;
      const d = Math.sqrt(d2) || 0.001;
      const f = (range - d) / range;
      out.x += (dx / d) * f * 4;
      out.z += (dz / d) * f * 4;
      out.y += f * 1.5;
    }
  }

  #avoidBounds(aquarium, out) {
    const pos = this.group.position;
    const { w, d, waterTop } = aquarium.dims;
    const m = 0.9 + this.radius;
    const k = 3;
    if (pos.x < -w / 2 + m) out.x += (-w / 2 + m - pos.x) * k;
    if (pos.x > w / 2 - m) out.x -= (pos.x - (w / 2 - m)) * k;
    if (pos.z < -d / 2 + m) out.z += (-d / 2 + m - pos.z) * k;
    if (pos.z > d / 2 - m) out.z -= (pos.z - (d / 2 - m)) * k;
    const floor = aquarium.heightAt(pos.x, pos.z) + 0.6 + this.radius * 0.5;
    if (pos.y < floor) out.y += (floor - pos.y) * k;
    const ceiling = waterTop - 0.35;
    if (pos.y > ceiling) out.y -= (pos.y - ceiling) * k;
  }

  // ── Fish AI ─────────────────────────────────────────────────

  /**
   * รับตำแหน่ง/ทิศจาก Fish AI (src/ai/ — คำนวณเป็นจังหวะคงที่) แล้วเกลี่ยระหว่างจังหวะด้วย alpha ให้ภาพลื่นทุก FPS
   * @param {number} alpha 0..1 สัดส่วนระหว่างจังหวะก่อนหน้า → ปัจจุบัน
   */
  syncFromAgent(alpha) {
    const a = this.agent;
    this.group.position.set(
      a.prevPos.x + (a.pos.x - a.prevPos.x) * alpha,
      a.prevPos.y + (a.pos.y - a.prevPos.y) * alpha,
      a.prevPos.z + (a.pos.z - a.prevPos.z) * alpha,
    );
    this.heading
      .set(
        a.prevHeading.x + (a.heading.x - a.prevHeading.x) * alpha,
        a.prevHeading.y + (a.heading.y - a.prevHeading.y) * alpha,
        a.prevHeading.z + (a.heading.z - a.prevHeading.z) * alpha,
      )
      .normalize();
    this.velocity.set(a.vel.x, a.vel.y, a.vel.z);
  }

  /** ค่าจากระบบนิเวศที่ AI ใช้ตัดสินใจ (ความหิว สุขภาพ อายุ ขนาดตัว ตั้งท้อง ความสะอาดน้ำ) */
  syncNeedsToAgent(cleanliness) {
    const n = this.agent.needs;
    const d = this.data;
    n.hunger = 100 - d.satiety;
    n.health = d.health;
    n.growth = d.growth;
    n.age = d.age;
    n.length = this.length;
    n.pregnant = isPregnant(d);
    n.cleanliness = cleanliness;
  }

  // ── ท่าทาง/แอนิเมชัน ────────────────────────────────────────

  updateVisual(dt) {
    if (this.species.behavior.walker) {
      this.#walkVisual(dt);
      return;
    }
    const v = this.velocity;
    const speed = v.length();
    // สัตว์ตัวตั้งตรง (ม้าน้ำ) แทบไม่ก้มเงยตามทิศที่ว่ายขึ้นลง
    const pitchLimit = this.species.behavior.upright ? 0.08 : 0.5;
    let turnRate = 0;
    if (this.agent) {
      // ทิศหัวมาจาก Fish AI (จำกัดอัตราเลี้ยวแล้ว) — แค่แปลงเป็นมุมและเอียงตัวตามการเลี้ยว
      const h = this.heading;
      turnRate = this.agent.yawRate;
      this.yaw = Math.atan2(h.x, h.z);
      this.pitch = clamp(-Math.atan2(h.y, Math.hypot(h.x, h.z)), -pitchLimit, pitchLimit);
      this.roll = damp(this.roll, clamp(-turnRate * 0.12, -0.45, 0.45), 4, dt);
    } else if (speed > 0.02) {
      const step = angleDelta(this.yaw, Math.atan2(v.x, v.z)) * (1 - Math.exp(-4 * dt));
      turnRate = step / Math.max(dt, 1e-4);
      this.yaw += step;
      this.roll = damp(this.roll, clamp(-turnRate * 0.12, -0.45, 0.45), 4, dt);
      this.pitch = damp(this.pitch, clamp(-Math.atan2(v.y, Math.hypot(v.x, v.z)), -pitchLimit, pitchLimit), 4, dt);
    }
    _euler.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.group.quaternion.setFromEuler(_euler);

    // ตัวเมียตั้งท้อง: ท้องค่อย ๆ ป่องขึ้น (อ้วนออกด้านข้างและลึกลงเล็กน้อย) จนคลอด
    const belly = pregnancyProgress(this.data);
    if (belly > 0 || this.visual.scale.x !== 1) this.visual.scale.set(1 + 0.16 * belly, 1 + 0.09 * belly, 1 + 0.03 * belly);

    const speedRatio = clamp(speed / this.species.behavior.speed, 0, 1.6);
    this.wigglePhase += dt * (2.5 + speedRatio * 7) * (this.species.behavior.tailBeat ?? 1);
    if (this.swim) {
      this.swim.uSwimPhase.value = this.wigglePhase;
      this.swim.uSwimAmp.value = 0.05 + 0.07 * Math.min(speedRatio, 1.2);
      // โมเดลที่รองรับการโค้งลำตัวตอนเลี้ยว (เช่น Molly)
      if (this.swim.uTurn) this.swim.uTurn.value = damp(this.swim.uTurn.value, clamp(turnRate * 0.35, -1, 1), 5, dt);
      // โมเดลที่เรืองแสงแรงขึ้นตอนว่ายเร็ว (shader มี uEnergy)
      if (this.swim.uEnergy) this.swim.uEnergy.value = damp(this.swim.uEnergy.value, clamp((speedRatio - 0.5) * 1.6, 0, 1), 3, dt);
      this.rig?.update(dt, speedRatio, this.swim.uTurn?.value ?? 0);
    } else if (this.mixer) {
      this.mixer.timeScale = 0.5 + speedRatio;
      this.mixer.update(dt);
    } else {
      this.wiggle.rotation.y = Math.sin(this.wigglePhase) * 0.12 * (0.4 + speedRatio);
    }
    if (this.trail) this.#emitTrail(dt, speedRatio);
  }

  /** ปล่อยประกายดาวจากปลายหาง ยิ่งว่ายเร็วยิ่งถี่ */
  #emitTrail(dt, speedRatio) {
    const T = this.trail;
    this.trailAcc += dt * T.rate * (0.25 + speedRatio);
    if (this.trailAcc < 1) return;
    const s = this.group.scale.x;
    _target.set(0, 0, T.offset * s).applyQuaternion(this.group.quaternion).add(this.group.position);
    for (; this.trailAcc >= 1; this.trailAcc--) {
      this.game.sparkles.emit(_target, pick(T.colors), { spread: 0.22 * s, size: 0.1 * s + 0.03, speed: 0.06 + 0.05 * speedRatio });
    }
  }

  /** ท่าเดินของสัตว์ที่เดินพื้น: หันข้างไปทางที่เดิน (เดินตะแคงแบบปู) และขยับขาตามความเร็ว */
  #walkVisual(dt) {
    const v = this.velocity;
    const speed = Math.hypot(v.x, v.z);
    if (speed > 0.03) {
      const heading = Math.atan2(v.x, v.z);
      // เลือกด้านที่หมุนน้อยกว่า → เดินกลับทางก็แค่เดินตะแคงไปอีกฝั่ง ไม่ต้องหมุนตัว
      const left = heading + Math.PI / 2;
      const right = heading - Math.PI / 2;
      const target = Math.abs(angleDelta(this.yaw, left)) < Math.abs(angleDelta(this.yaw, right)) ? left : right;
      this.yaw += angleDelta(this.yaw, target) * (1 - Math.exp(-3 * dt));
    }
    this.pitch = damp(this.pitch, 0, 4, dt);
    this.roll = damp(this.roll, 0, 4, dt);
    _euler.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.group.quaternion.setFromEuler(_euler);
    const belly = pregnancyProgress(this.data);
    if (belly > 0 || this.visual.scale.x !== 1) this.visual.scale.set(1 + 0.1 * belly, 1 + 0.08 * belly, 1 + 0.1 * belly);
    const ratio = clamp(speed / this.species.behavior.speed, 0, 1.5);
    if (this.walk) {
      this.walk.uWalkPhase.value += dt * (1.5 + ratio * 10);
      this.walk.uWalkAmp.value = damp(this.walk.uWalkAmp.value, Math.min(1, ratio * 1.4), 6, dt);
    }
  }

  // ── ค่าสถานะ (คำนวณใน Simulation Engine — game.sim) ─────────────

  /** ความสุข 0..100 (ไม่บันทึกลงเซฟ engine คำนวณใหม่จากความอิ่ม น้ำ สุขภาพ ของตกแต่ง) */
  get happiness() {
    return this.game.sim?.happiness(this.id) ?? 65;
  }

  /** อาการตอนนี้: healthy / hungry / starving / sick / critical */
  get condition() {
    return this.game.sim?.condition(this.id) ?? 'healthy';
  }

  /** กินอาหาร 1 เม็ด — ผลต่อค่าสถานะคิดใน engine */
  eat(food) {
    this.game.sim?.feed(this.id, food);
  }

  /** ระยะตามแนวรังสีถ้าคลิกโดนปลา (ใช้ทรงกลมครอบ เพราะปลาตัวเล็กคลิกยาก) */
  hitDistance(ray) {
    const r = Math.max(this.length * 0.6, 0.35);
    if (ray.distanceSqToPoint(this.group.position) > r * r) return null;
    ray.closestPointToPoint(this.group.position, _closest);
    return _closest.distanceTo(ray.origin);
  }

  // ── ตาย ─────────────────────────────────────────────────────

  startDying() {
    this.dying = true;
    this.dyingTime = 0;
    this.velocity.set(0, 0, 0);
    this.visual.traverse((o) => o.isSprite && (o.visible = false)); // แสงฟุ้งรอบตัวดับทันที
    forEachMaterial(this.visual, (m) => {
      m.userData.baseOpacity = m.opacity;
      m.transparent = true;
      m.needsUpdate = true;
    });
  }

  /** @returns {boolean} true เมื่อแอนิเมชันจบ ลบออกจากฉากได้ */
  updateDying(dt, aquarium) {
    this.dyingTime += dt;
    this.roll = damp(this.roll, Math.PI, 1.5, dt);
    _euler.set(0, this.yaw, this.roll, 'YXZ');
    this.group.quaternion.setFromEuler(_euler);
    this.group.position.y = Math.min(this.group.position.y + dt * 0.35, aquarium.dims.waterTop - 0.15);
    const fade = clamp(1 - (this.dyingTime - 3) / 2, 0, 1);
    forEachMaterial(this.visual, (m) => (m.opacity = (m.userData.baseOpacity ?? 1) * fade));
    return this.dyingTime > 5;
  }

  dispose() {
    this.mixer?.stopAllAction();
    disposeObject(this.group);
  }
}
