import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { forEachMaterial, disposeObject } from '../assets/AssetLoader.js';
import { angleDelta, clamp, damp, lerp, rand, smoothstep } from '../utils/math.js';
import { noise2 } from '../utils/noise.js';

const _desired = new THREE.Vector3();
const _steer = new THREE.Vector3();
const _sep = new THREE.Vector3();
const _align = new THREE.Vector3();
const _coh = new THREE.Vector3();
const _closest = new THREE.Vector3();
const _euler = new THREE.Euler(0, 0, 0, 'YXZ');

/**
 * ปลา 1 ตัวในฉาก
 * - data    : record ที่บันทึกลงเซฟ (ความอิ่ม สุขภาพ การเติบโต ฯลฯ)
 * - species : ข้อมูลสายพันธุ์จาก data/fish.js
 * การเคลื่อนที่ใช้ steering behaviors (wander + หลบกำแพง/สิ่งกีดขวาง + ว่ายเป็นฝูง + ไล่กินอาหาร)
 */
export class Fish {
  constructor(game, data, species) {
    this.game = game;
    this.data = data;
    this.species = species;
    this.id = data.id;

    const visual = game.models.createFish(species);
    this.visual = visual.object;
    this.mixer = visual.mixer;
    this.swim = visual.swimUniforms;
    this.wiggle = new THREE.Group();
    this.wiggle.add(this.visual);
    this.group = new THREE.Group();
    this.group.add(this.wiggle);
    this.group.userData.fish = this;

    const angle = Math.random() * Math.PI * 2;
    this.velocity = new THREE.Vector3(Math.sin(angle), 0, Math.cos(angle)).multiplyScalar(species.behavior.speed * 0.5);
    this.yaw = angle;
    this.pitch = 0;
    this.roll = 0;
    this.wanderTarget = new THREE.Vector3();
    this.wanderTimer = 0;
    this.seed = Math.random() * 100;
    this.wigglePhase = Math.random() * 10;
    this.eatCooldown = 0;
    this.happiness = 65;
    this.moodBoost = 0;
    this.growthBoost = 1;
    this.growthBoostTime = 0;
    this.dying = false;
    this.dyingTime = 0;
    this.updateScale();
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
  }

  // ── การเคลื่อนที่ ────────────────────────────────────────────

  updateMovement(dt, ctx) {
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

  #seek(target, speed, slowRadius, out) {
    _desired.subVectors(target, this.group.position);
    const dist = _desired.length();
    if (dist < 1e-4) return;
    const s = dist < slowRadius ? speed * (0.3 + (0.7 * dist) / slowRadius) : speed;
    _desired.multiplyScalar(s / dist).sub(this.velocity).multiplyScalar(this.species.behavior.agility ?? 2);
    out.add(_desired);
  }

  #pickWanderTarget(ctx) {
    const zone = this.data.health < 25 ? 'bottom' : this.species.behavior.zone;
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

  // ── ท่าทาง/แอนิเมชัน ────────────────────────────────────────

  updateVisual(dt) {
    const v = this.velocity;
    const speed = v.length();
    if (speed > 0.02) {
      const step = angleDelta(this.yaw, Math.atan2(v.x, v.z)) * (1 - Math.exp(-4 * dt));
      this.yaw += step;
      this.roll = damp(this.roll, clamp((-step / Math.max(dt, 1e-4)) * 0.12, -0.45, 0.45), 4, dt);
      this.pitch = damp(this.pitch, clamp(-Math.atan2(v.y, Math.hypot(v.x, v.z)), -0.5, 0.5), 4, dt);
    }
    _euler.set(this.pitch, this.yaw, this.roll, 'YXZ');
    this.group.quaternion.setFromEuler(_euler);

    const speedRatio = clamp(speed / this.species.behavior.speed, 0, 1.6);
    this.wigglePhase += dt * (2.5 + speedRatio * 7) * (this.species.behavior.tailBeat ?? 1);
    if (this.swim) {
      this.swim.uSwimPhase.value = this.wigglePhase;
      this.swim.uSwimAmp.value = 0.05 + 0.07 * Math.min(speedRatio, 1.2);
    } else if (this.mixer) {
      this.mixer.timeScale = 0.5 + speedRatio;
      this.mixer.update(dt);
    } else {
      this.wiggle.rotation.y = Math.sin(this.wigglePhase) * 0.12 * (0.4 + speedRatio);
    }
  }

  // ── ค่าสถานะ ────────────────────────────────────────────────

  /**
   * @param {number} dt เวลาจำลอง (คูณ timeScale แล้ว)
   * @param {{cleanliness:number, decorScore:number, crowdPenalty:number, coins:any, onGrown:Function}} ctx
   */
  updateStats(dt, ctx) {
    const d = this.data;
    const care = this.species.care;
    const C = CONFIG.care;
    d.age += dt;
    d.satiety = Math.max(0, d.satiety - care.hungerRate * dt);
    if (d.satiety < 15) d.health -= C.starvingDamage * dt * (1.3 - d.satiety / 15);
    if (ctx.cleanliness < 25) d.health -= C.dirtyDamage * dt * (1.3 - ctx.cleanliness / 25);
    if (d.satiety > 40 && ctx.cleanliness > 40) d.health += C.regen * dt;
    d.health = clamp(d.health, 0, 100);

    this.growthBoostTime -= dt;
    if (this.growthBoostTime <= 0) this.growthBoost = 1;
    if (d.growth < 1 && d.satiety > 30 && d.health > 40) {
      d.growth = Math.min(1, d.growth + (dt / care.growTime) * this.growthBoost);
      this.updateScale();
      if (d.growth >= 1) ctx.onGrown(this);
    }
    d.breedCooldown = Math.max(0, d.breedCooldown - dt);

    this.moodBoost = Math.max(0, this.moodBoost - dt * 0.2);
    const fed = smoothstep(10, 70, d.satiety);
    const target = 100 * (0.35 * fed + (0.25 * ctx.cleanliness) / 100 + (0.2 * d.health) / 100 + 0.2 * ctx.decorScore) - ctx.crowdPenalty + this.moodBoost;
    this.happiness = damp(this.happiness, clamp(target, 0, 100), 0.6, dt);

    // ปลาที่มีความสุขจะผลิตเหรียญ (สุขมากกว่า 80% ได้เหรียญเพิ่ม 50%)
    if (this.happiness >= 40) {
      d.coinTimer -= dt;
      if (d.coinTimer <= 0) {
        const eco = this.species.economy;
        d.coinTimer = eco.coinInterval * rand(0.85, 1.2);
        const value = Math.max(1, Math.round(eco.coinValue * (this.happiness > 80 ? 1.5 : 1) * (this.isAdult ? 1 : 0.5)));
        ctx.coins.spawn(this.group.position, value);
      }
    }
  }

  eat(food) {
    const d = this.data;
    d.satiety = Math.min(100, d.satiety + food.nutrition);
    d.health = Math.min(100, d.health + food.health);
    this.moodBoost = Math.min(30, this.moodBoost + food.happiness);
    if (food.growth > this.growthBoost) this.growthBoost = food.growth;
    this.growthBoostTime = 60;
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
