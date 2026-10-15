import * as THREE from 'three';
import { clamp, hashString, rand } from '../utils/math.js';

const UP = new THREE.Vector3(0, 1, 0);
const _f = new THREE.Vector3();
const _n = new THREE.Vector3();
const _r = new THREE.Vector3();
const _p = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _box = new THREE.Box3();

/** ระยะจากกระจกด้านใน (หน้าคราบตะไคร่ ไม่จมเข้าไปในกระจก) */
const GLASS_GAP = 0.03;
const TURN = 0.7; // เลี้ยวได้สูงสุด (เรเดียน/วินาที) — หอยค่อย ๆ เลี้ยวโค้งระหว่างคลาน

/**
 * หอย 1 ตัว (ของตกแต่งที่มีชีวิต — item.critter) ขยับ Decoration.group เองทุกเฟรม
 *  glass = คลานบนกระจกด้านในรอบตู้ แวะแทะตะไคร่เป็นพัก ๆ (วางบนทรายแล้วคลานไปเกาะกระจกที่ใกล้ที่สุดก่อน)
 *  floor = คลานบนพื้นทราย หาของเสียบนพื้นในระยะที่รับกลิ่นได้ → คลานไปกิน / ไม่มีก็เดินเล่นและหยุดพัก
 *  stay  = หอยสองฝาฝังตัวอยู่กับที่ อ้า-หุบฝาช้า ๆ และดูดฝุ่นขยะที่ลอยลงมาใกล้ ๆ
 * ไม่มีค่าที่ต้องบันทึก (ตำแหน่งที่วางในเซฟ = จุดเริ่มต้นหลังโหลดตู้) ไม่ตาย ไม่ต้องดูแล
 * ความเร็วต่ำมากและคำนวณแค่ตัวเอง → ต้นทุนต่อเฟรมน้อยมาก
 */
export class Critter {
  /** @param decor Decoration ที่เป็นเจ้าของ (group, object, item, data) */
  constructor(decor, { mixer = null } = {}) {
    this.decor = decor;
    this.item = decor.item;
    this.cfg = decor.item.critter;
    this.mixer = mixer;
    const h = hashString(decor.id ?? 'critter');
    this.phase = (h % 1000) / 159;
    this.speed = (this.cfg.speed ?? 0.05) * (0.8 + ((h >> 10) % 100) / 250);
    this.baseScale = decor.object.scale.clone();
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.state = 'rest';
    this.timer = rand(0.5, 3);
    this.target = new THREE.Vector3();
    this.food = null;
    this.moving = false;
    // บนกระจก: s = ระยะตามแนวกระจกรอบตู้, y = ความสูง, dir = ทิศคลานบนระนาบกระจก (หน่วยเวกเตอร์ 2 มิติ)
    this.onGlass = false;
    this.s = 0;
    this.goal = { s: 0, y: 0 };
    this.dir = { s: 0, y: 1 };
    this.gape = 0;
    this.pivot = this.cfg.move === 'stay' ? this.#makeHinge(decor.object) : null;
    this.reset(decor.data.x, decor.data.z, decor.data.rotY ?? 0);
  }

  /** ถูกวาง/ย้ายด้วยมือ (โหมดตกแต่ง) → เริ่มจากจุดนั้นใหม่ */
  reset(x, z, yaw = this.yaw) {
    this.pos.set(x, this.decor.group.position.y, z);
    this.yaw = yaw;
    this.onGlass = false;
    this.food = null;
    this.detour = null;
    this.blockedTime = 0;
    this.state = 'rest';
    this.timer = rand(0.5, 2);
    this.snapped = false;
  }

  /**
   * @param ctx {{ aquarium, waste, obstacles, frozen: boolean, algae: number }}
   *  frozen = อยู่ในโหมดตกแต่ง (หยุดนิ่งให้ผู้เล่นเลือก/ลากได้) · algae = ระดับตะไคร่บนกระจก 0..1
   */
  update(dt, time, ctx) {
    this.moving = false;
    if (!ctx.frozen && ctx.aquarium.dims) {
      if (this.cfg.move === 'stay') this.#filter(dt, time, ctx);
      else if (this.cfg.move === 'glass' && this.onGlass) this.#glassStep(dt, ctx);
      else this.#floorStep(dt, ctx);
    }
    this.#animate(dt, time);
  }

  // ── พื้นทราย ────────────────────────────────────────────────

  #floorStep(dt, ctx) {
    const aq = ctx.aquarium;
    const seekWall = this.cfg.move === 'glass';
    if (this.food?.gone) this.food = null;
    this.timer -= dt;
    if (this.state === 'eat') {
      if (this.timer <= 0) {
        if (this.food) ctx.waste?.consume(this.food);
        this.food = null;
        this.#choose(ctx, seekWall);
      }
      return this.#placeOnFloor(aq);
    }
    if (this.state === 'rest') {
      if (this.timer <= 0) this.#choose(ctx, seekWall);
      return this.#placeOnFloor(aq);
    }
    // หาของเสียใหม่ระหว่างเดินเล่น (เป็นระยะ ไม่ต้องทุกเฟรม)
    if (this.state === 'wander' && !seekWall && this.timer <= 0) this.#choose(ctx, false);
    if (this.food) this.target.copy(this.food.position);

    // อ้อมของตกแต่งอยู่ → มุ่งไปจุดอ้อมก่อน (หมดเวลา/ถึงแล้ว = กลับไปหาเป้าหมายเดิม)
    let goal = this.target;
    if (this.detour) {
      this.detour.time -= dt;
      if (this.detour.time <= 0 || Math.hypot(this.detour.x - this.pos.x, this.detour.z - this.pos.z) < 0.1) this.detour = null;
      else goal = this.detour;
    }
    const dx = goal.x - this.pos.x;
    const dz = goal.z - this.pos.z;
    const dist = Math.hypot(dx, dz);
    if (goal === this.target && dist < 0.08 + this.item.radius * 0.3) {
      if (seekWall) return this.#attachToGlass(aq);
      if (this.food) {
        this.state = 'eat';
        this.timer = rand(2.5, 4.5);
      } else {
        this.state = 'rest';
        this.timer = rand(3, 9);
      }
      return this.#placeOnFloor(aq);
    }
    // เลี้ยวช้า ๆ ระหว่างคลาน (โค้งไปเหมือนหอยจริง ไม่หมุนตัวอยู่กับที่)
    let diff = Math.atan2(dx, dz) - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += clamp(diff, -TURN * dt, TURN * dt);
    const step = this.speed * dt * (0.35 + 0.65 * Math.max(0, Math.cos(diff)));
    const nx = this.pos.x + Math.sin(this.yaw) * step;
    const nz = this.pos.z + Math.cos(this.yaw) * step;
    const o = this.#blockedBy(nx, nz, ctx);
    if (o) {
      // ชนของตกแต่ง → คลานอ้อมตามขอบ ไปทางด้านที่ใกล้เป้าหมาย (ไม่หมุนหาทางอยู่กับที่)
      const rx = this.pos.x - o.x;
      const rz = this.pos.z - o.z;
      const rl = Math.hypot(rx, rz) || 1;
      const side = -rz * (this.target.x - this.pos.x) + rx * (this.target.z - this.pos.z) >= 0 ? 1 : -1;
      this.detour = { x: this.pos.x + ((-rz * side) / rl) * 0.6 + (rx / rl) * 0.15, z: this.pos.z + ((rx * side) / rl) * 0.6 + (rz / rl) * 0.15, time: 4 };
      this.blockedTime = (this.blockedTime ?? 0) + dt;
      // อ้อมนานแล้วยังไปไม่ถึง (เป้าหมายอยู่หลังของตกแต่งชิดกระจก ฯลฯ) → เปลี่ยนเป้าหมาย
      if (this.blockedTime > 6) {
        this.blockedTime = 0;
        this.food = null;
        if (seekWall) this.#wallAt(rand(...this.#glassSpan()), this.target, _r, _n);
        else this.#choose(ctx, false);
      }
    } else {
      const m = this.item.radius * 0.6 + 0.05;
      const { w, d } = aq.dims;
      this.pos.x = clamp(nx, -w / 2 + m, w / 2 - m);
      this.pos.z = clamp(nz, -d / 2 + m, d / 2 - m);
      this.moving = step > 1e-5;
      if (!this.detour) this.blockedTime = 0;
    }
    this.#placeOnFloor(aq);
  }

  /** เลือกสิ่งที่จะทำต่อ: ไปหาของเสีย / เดินเล่น / พัก (หอยเกาะกระจกที่ยังอยู่บนทราย = คลานไปหากระจก) */
  #choose(ctx, seekWall) {
    const { w, d } = ctx.aquarium.dims;
    if (seekWall) {
      this.#nearestWallPoint(ctx.aquarium, this.target);
      this.state = 'wander';
      return;
    }
    // ของเสียที่ตกบนฐานของตกแต่งไปไม่ถึง → ไม่สนใจ
    const food = ctx.waste?.nearestSettled(this.pos, 3.5, (p) => !this.#insideObstacle(p.x, p.z, ctx));
    if (food) {
      this.food = food;
      this.state = 'forage';
      this.timer = Infinity;
      return;
    }
    if (this.state !== 'rest' && Math.random() < 0.35) {
      this.state = 'rest';
      this.timer = rand(4, 10);
      return;
    }
    // เดินเล่น: จุดถัดไปอยู่ค่อนไปข้างหน้า (คลานต่อไปเรื่อย ๆ ไม่เลี้ยวกลับหลังหันบ่อย) — ชนขอบตู้ค่อยหันไปทางอื่น
    const m = this.item.radius + 0.3;
    for (let i = 0; i < 6; i++) {
      const a = this.yaw + rand(-1, 1) * (0.8 + i * 0.4);
      const r = rand(0.8, 2.2);
      this.target.set(clamp(this.pos.x + Math.sin(a) * r, -w / 2 + m, w / 2 - m), 0, clamp(this.pos.z + Math.cos(a) * r, -d / 2 + m, d / 2 - m));
      const far = Math.hypot(this.target.x - this.pos.x, this.target.z - this.pos.z) > 0.5; // ไม่ติดขอบตู้
      if (far && !this.#insideObstacle(this.target.x, this.target.z, ctx)) break;
    }
    this.state = 'wander';
    this.timer = rand(4, 7); // ระหว่างเดินเล่นมองหาของเสียใหม่ทุก ๆ ช่วงนี้
  }

  #footprint(o) {
    return o.r * 0.8 + this.item.radius * 0.5;
  }

  #insideObstacle(x, z, ctx) {
    for (const o of ctx.obstacles ?? []) {
      const r = this.#footprint(o);
      if ((x - o.x) ** 2 + (z - o.z) ** 2 < r * r) return true;
    }
    return false;
  }

  /**
   * ของตกแต่งที่ขวางก้าวถัดไป — นับเฉพาะก้าวที่ลึกเข้าไปในฐานของตกแต่งมากขึ้น
   * (หอยที่ถูกวางทับฐานหินอยู่แล้วคลานออกมาได้ ไม่ติดหมุนอยู่กับที่)
   */
  #blockedBy(x, z, ctx) {
    for (const o of ctx.obstacles ?? []) {
      const r = this.#footprint(o);
      const next = (x - o.x) ** 2 + (z - o.z) ** 2;
      if (next < r * r && next < (this.pos.x - o.x) ** 2 + (this.pos.z - o.z) ** 2) return o;
    }
    return null;
  }

  /** วางบนทราย เอียงตามความลาดของพื้น */
  #placeOnFloor(aq) {
    const { x, z } = this.pos;
    const e = 0.15;
    this.pos.y = aq.heightAt(x, z) - 0.01;
    _n.set(aq.heightAt(x - e, z) - aq.heightAt(x + e, z), 2 * e, aq.heightAt(x, z - e) - aq.heightAt(x, z + e)).normalize();
    _f.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
    this.#orient(_f, _n);
  }

  // ── กระจก ───────────────────────────────────────────────────
  // เส้นทางรอบตู้ (มองจากบน): หลัง (z=-d/2, x: -→+) → ขวา (x=+w/2, z: -→+) → หน้า (z=+d/2, x: +→-) → ซ้าย (x=-w/2, z: +→-)

  /** จุดบนกระจกที่ระยะ s: out = ตำแหน่ง (y = 0), tangent = ทิศที่ s เพิ่ม, normal = ทิศเข้าในตู้ */
  #wallAt(s, out, tangent, normal) {
    const { w, d } = this.decor.game.aquarium.dims;
    const a = w / 2 - GLASS_GAP;
    const b = d / 2 - GLASS_GAP;
    const P = 2 * (w + d);
    s = ((s % P) + P) % P;
    if (s < w) {
      out.set(-w / 2 + s, 0, -b);
      tangent.set(1, 0, 0);
      normal.set(0, 0, 1);
    } else if (s < w + d) {
      out.set(a, 0, -d / 2 + (s - w));
      tangent.set(0, 0, 1);
      normal.set(-1, 0, 0);
    } else if (s < 2 * w + d) {
      out.set(w / 2 - (s - w - d), 0, b);
      tangent.set(-1, 0, 0);
      normal.set(0, 0, -1);
    } else {
      out.set(-a, 0, d / 2 - (s - 2 * w - d));
      tangent.set(0, 0, -1);
      normal.set(1, 0, 0);
    }
    // เว้นมุมตู้เล็กน้อย ไม่ให้ทะลุกระจกอีกด้าน
    const m = this.item.radius * 0.5 + GLASS_GAP;
    out.x = clamp(out.x, -w / 2 + m, w / 2 - m);
    out.z = clamp(out.z, -d / 2 + m, d / 2 - m);
    return out;
  }

  /**
   * ช่วง s ที่คลานได้: กระจกซ้าย → หลัง → ขวา (ไม่เกาะกระจกหน้า — ไม่บังวิว และผู้เล่นเห็นเปลือกหอยแทนฝ่าเท้า)
   * ซ้าย = s ติดลบ (ต่อจากมุมหลังซ้าย) จึงเป็นช่วงต่อเนื่อง [-d, w + d] เว้นมุมหน้าไว้เล็กน้อย
   */
  #glassSpan() {
    const { w, d } = this.decor.game.aquarium.dims;
    const m = this.item.radius + 0.25;
    return [-d + m, w + d - m];
  }

  /** ระยะ s ของจุดบนกระจก (ซ้าย/หลัง/ขวา) ที่ใกล้ตำแหน่ง (x, z) ที่สุด */
  #nearestS(x, z) {
    const { w, d } = this.decor.game.aquarium.dims;
    const gaps = [z + d / 2, w / 2 - x, x + w / 2]; // หลัง ขวา ซ้าย
    const side = gaps.indexOf(Math.min(...gaps));
    const [lo, hi] = this.#glassSpan();
    const s = side === 0 ? x + w / 2 : side === 1 ? w + (z + d / 2) : -(z + d / 2);
    return clamp(s, lo, hi);
  }

  #nearestWallPoint(aq, out) {
    return this.#wallAt(this.#nearestS(this.pos.x, this.pos.z), out, _r, _n);
  }

  #attachToGlass(aq) {
    this.onGlass = true;
    this.s = this.#nearestS(this.pos.x, this.pos.z);
    this.#wallAt(this.s, _p, _r, _n);
    this.pos.y = aq.heightAt(_p.x, _p.z) + 0.04;
    this.dir = { s: 0, y: 1 }; // เริ่มคลานขึ้นกระจก
    this.#pickGlassGoal(aq);
  }

  #glassRange(aq, x, z) {
    return [aq.heightAt(x, z) + 0.06 + this.item.radius * 0.5, aq.dims.waterTop - 0.3];
  }

  #pickGlassGoal(aq) {
    const [sLo, sHi] = this.#glassSpan();
    // ค่อนไปทางที่คลานอยู่ (ไม่กลับหลังหันบ่อย) — สุดขอบช่วงกระจกแล้วจึงกลับทาง
    const ahead = this.dir.s >= 0 ? 1 : -1;
    let s = this.s + ahead * rand(-0.8, 3);
    if (s < sLo || s > sHi) s = this.s - ahead * rand(0.8, 3);
    s = clamp(s, sLo, sHi);
    this.#wallAt(s, _p, _r, _n);
    const [lo, hi] = this.#glassRange(aq, _p.x, _p.z);
    this.goal = { s, y: rand(lo, Math.max(lo, hi)) };
    this.state = 'wander';
  }

  #glassStep(dt, ctx) {
    const aq = ctx.aquarium;
    this.timer -= dt;
    if (this.state === 'graze') {
      // แทะตะไคร่อยู่กับที่ (ตะไคร่เยอะ = แทะนานขึ้น)
      if (this.timer <= 0) this.#pickGlassGoal(aq);
    } else {
      const ds = this.goal.s - this.s;
      const dy = this.goal.y - this.pos.y;
      const dist = Math.hypot(ds, dy);
      if (dist < 0.06) {
        this.state = 'graze';
        this.timer = rand(2, 5) * (1 + 2 * (ctx.algae ?? 0));
      } else {
        // หมุนทิศคลานบนระนาบกระจกเข้าหาเป้าหมายด้วยอัตราจำกัด
        const want = Math.atan2(ds, dy);
        let cur = Math.atan2(this.dir.s, this.dir.y);
        let diff = Math.atan2(Math.sin(want - cur), Math.cos(want - cur));
        cur += clamp(diff, -TURN * dt, TURN * dt);
        this.dir = { s: Math.sin(cur), y: Math.cos(cur) };
        const step = this.speed * dt * (0.35 + 0.65 * Math.max(0, Math.cos(diff)));
        this.s += this.dir.s * step;
        this.pos.y += this.dir.y * step;
        this.moving = step > 1e-5;
      }
    }
    this.#wallAt(this.s, _p, _r, _n);
    const [lo, hi] = this.#glassRange(aq, _p.x, _p.z);
    this.pos.set(_p.x, clamp(this.pos.y, lo, hi), _p.z);
    // หน้า = ทิศคลานบนกระจก, หลังหอย (ขึ้น) = ทิศเข้าในตู้
    _f.copy(_r).multiplyScalar(this.dir.s).addScaledVector(UP, this.dir.y);
    this.#orient(_f, _n);
  }

  // ── หอยสองฝา ────────────────────────────────────────────────

  /** บานพับของฝาบน (node ชื่อ shell_top) ที่ขอบด้านหลัง — ไม่มีก็แค่ขยับตัวเบา ๆ */
  #makeHinge(object) {
    object.updateMatrixWorld(true);
    const top = object.getObjectByName('shell_top');
    if (!top) return null;
    _box.setFromObject(top);
    const pivot = new THREE.Group();
    pivot.position.set((_box.min.x + _box.max.x) / 2, (_box.min.y + _box.max.y) / 2, _box.min.z);
    object.worldToLocal(pivot.position);
    object.add(pivot);
    object.updateMatrixWorld(true);
    pivot.attach(top);
    return pivot;
  }

  #filter(dt, time, ctx) {
    const g = this.decor.group.position;
    this.pos.copy(g);
    // อ้า-หุบเป็นจังหวะช้า ๆ ดูดฝุ่นขยะเฉพาะตอนอ้าฝา
    const open = 0.5 + 0.5 * Math.sin(time * 0.35 + this.phase);
    this.gape = open;
    if (open > 0.3 && ctx.waste) {
      _p.set(g.x, g.y + this.item.height, g.z);
      ctx.waste.filterNear(_p, 1.6, dt);
    }
  }

  // ── ภาพ ─────────────────────────────────────────────────────

  /** หมุนตัวให้หัวไป forward และหลังไป up (ตั้งฉากกันโดยปรับ forward ให้อยู่บนระนาบ) */
  #orient(forward, up) {
    _f.copy(forward).addScaledVector(up, -forward.dot(up));
    if (_f.lengthSq() < 1e-8) return;
    _f.normalize();
    _r.crossVectors(up, _f).normalize();
    _m.makeBasis(_r, up, _f);
    _q.setFromRotationMatrix(_m);
    const g = this.decor.group;
    g.position.copy(this.pos);
    // เกลี่ยการหมุน (เลี้ยวมุมตู้/ขึ้นกระจกไม่กระตุก)
    g.quaternion.slerp(_q, this.snapped ? 0.15 : 1);
    this.snapped = true;
  }

  #animate(dt, time) {
    if (this.mixer) {
      this.mixer.timeScale = this.moving || this.cfg.move === 'stay' ? 1 : 0.15;
      this.mixer.update(dt);
    } else if (this.cfg.move !== 'stay') {
      // ไม่มีแอนิเมชันในไฟล์: ลำตัวยืด-หดเป็นจังหวะตอนคลาน
      const pulse = this.moving ? Math.sin(time * 3 + this.phase) * 0.05 : 0;
      this.decor.object.scale.set(this.baseScale.x * (1 - pulse * 0.4), this.baseScale.y, this.baseScale.z * (1 + pulse));
    }
    if (this.pivot) this.pivot.rotation.x = -(this.cfg.gape ?? 0.3) * this.gape;
  }

  dispose() {
    this.mixer?.stopAllAction();
  }
}
