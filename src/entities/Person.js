import * as THREE from 'three';
import { angleDelta, clamp, damp } from '../utils/math.js';
import { nameLabel } from './Farmer.js';

/**
 * ตัวละครคน 2 ตัวในฟาร์ม (Fish/farm/build_player.py · ท่าทาง motion capture จริงจาก CMU)
 * clip = ความเร็วจริง (ม./วิ) ที่ท่าเดิน/วิ่งในไฟล์ก้าวพอดีพื้น (พิมพ์ตอนสร้างโมเดล) — ใช้ปรับความเร็วคลิปให้เท้าไม่ไถล
 */
export const PEOPLE = {
  // ผู้ชาย: เดินแบบ "Relaxed" ก้าวกว้างสบาย ๆ · walk = ความเร็วตอนผู้เล่นบังคับ (เร็วกว่าคลิปไม่เกิน ~30% ยังดูเป็นธรรมชาติ)
  man: { model: 'models/farm/player.glb', prefix: 'Pl', label: 'ผู้ชาย', icon: '👨', clip: { walk: 0.809, run: 3.409 }, walk: 1.05, run: 3.4, head: 1.84 },
  // ผู้หญิง: เดินแบบ "Cool" ตัวตรง ก้าวเท้าเกือบเป็นเส้นเดียว
  woman: { model: 'models/farm/woman.glb', prefix: 'Wm', label: 'ผู้หญิง', icon: '👩', clip: { walk: 1.337, run: 3.225 }, walk: 1.4, run: 3.2, head: 1.74, sitLift: 0.04 },
  // ยายเพ็ญ เมียตาเหม — เดินทำกิจวัตรเอง (npc: ผู้เล่นบังคับไม่ได้) · ก้าวสั้นเพราะนุ่งผ้าถุง · ไม่มีท่าวิ่ง
  pen: { model: 'models/farm/pen.glb', prefix: 'Pn', label: 'ยายเพ็ญ', icon: '👵', clip: { walk: 0.637, run: 99 }, walk: 0.64, run: 0.64, head: 1.6, npc: true, sitLift: 0.08, sitFwd: 0.08 },
};
/** คนที่ผู้เล่นบังคับได้ */
export const PLAYABLE_PEOPLE = Object.keys(PEOPLE).filter((k) => !PEOPLE[k].npc);
/** รัศมีลำตัวสำหรับชนสิ่งของ (ม.) */
export const PERSON_RADIUS = 0.3;
const TURN = 9;
const AI_TURN = 4.5;
const FADE = 0.3;
/** ท่าที่เล่นวน — ท่าอื่นทั้งหมด (tend stretch wave laugh angry shrug highfive shake hug dance) เล่นครั้งเดียวแล้วกลับไปยืน */
const LOOPED = new Set(['idle', 'walk', 'run', 'talk', 'sit', 'sleep', 'work']);

/**
 * คนในฟาร์ม — ผู้เล่นบังคับ (drive) หรือเดินทำกิจวัตรเอง (FarmSystem ส่งคำสั่ง goTo / act ผ่าน PersonAI)
 * ไม่ถูกบันทึกในเซฟ: ทุกครั้งที่ออกนอกบ้านวางตำแหน่งใหม่
 */
export class Person {
  /**
   * @param {{ scene: THREE.Object3D, animations: THREE.AnimationClip[] }} model สำเนาโมเดล (AssetLoader.instantiate)
   * @param {keyof typeof PEOPLE} key
   */
  constructor(model, key) {
    this.key = key;
    this.def = PEOPLE[key];
    this.group = new THREE.Group();
    this.group.add(model.scene);
    model.scene.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.frustumCulled = false; // กล่องขอบเขตของ skinned mesh ไม่ตามท่าทาง — กันหายตอนอยู่ขอบจอ
      }
    });
    this.mixer = new THREE.AnimationMixer(model.scene);
    this.actions = {};
    const re = new RegExp(`^${this.def.prefix}`);
    for (const clip of model.animations) this.actions[clip.name.replace(re, '').toLowerCase()] = this.mixer.clipAction(clip);
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.clip && this.once) {
        const done = this.once.done;
        this.once = null;
        done?.();
      }
    });
    this.clip = null;
    /** ชื่อท่าที่เล่นอยู่ + ลำดับการเริ่มท่า (เล่นท่าเดิมซ้ำก็นับ) — ส่งให้อีกเครื่องตอนเล่นด้วยกัน */
    this.clipName = 'idle';
    this.clipSerial = 0;
    /** ตัวนี้ถูกบังคับจากอีกเครื่อง (เล่นด้วยกันสองคน) */
    this.remote = false;
    /** ท่าที่เล่นครั้งเดียวอยู่ { name, done } — ระหว่างนี้ไม่เดิน */
    this.once = null;
    this.speed = 0;
    /** เวลาที่เหลือของการก้าวหมุนตัวอยู่กับที่ */
    this.turning = 0;
    this.hitSphere = new THREE.Sphere(new THREE.Vector3(), 0.55);
    // ตัวละครที่ผู้เล่นบังคับไม่ได้: ป้ายชื่อเหนือหัว (แบบตาเหม)
    if (this.def.npc) {
      this.label = nameLabel(this.def.label, this.def.icon);
      this.label.position.y = this.def.head + 0.32;
      this.group.add(this.label);
    }
    /** จุดที่กล้องเล็ง (ระดับอก) */
    this.anchor = new THREE.Object3D();
    this.#play('idle', 0);
  }

  get position() {
    return this.group.position;
  }

  get busy() {
    return !!this.once;
  }

  /** วางตัวที่จุดนี้ หันหน้าตามมุม heading (เรเดียน · 0 = +Z) */
  place(x, z, heading) {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = heading;
    this.speed = 0;
    this.anchor.position.set(x, 1.1, z);
  }

  pick(ray) {
    this.hitSphere.center.copy(this.group.position).setY(0.9);
    return ray.intersectsSphere(this.hitSphere);
  }

  hasClip(name) {
    return !!this.actions[name];
  }

  /**
   * เล่นท่า ('tend' ก้มดูแล · 'wave' โบกมือ · 'laugh' หัวเราะ · 'talk' พูด ฯลฯ) แล้วเรียก done
   * ท่าวน ('talk') เล่นนาน duration วินาที · ท่าครั้งเดียวจบเองตามความยาวคลิป
   */
  act(name, done = null, { duration = 2.5 } = {}) {
    if (!this.actions[name]) {
      done?.();
      return;
    }
    this.once = { name, done, until: LOOPED.has(name) ? duration : null };
    this.speed = 0;
    this.#play(name, FADE, true);
  }

  /** ความยาวท่า (วินาที) — ท่าวนคืน fallback */
  clipDuration(name, fallback = 2.5) {
    const a = this.actions[name];
    return a && !LOOPED.has(name) ? a.getClip().duration : fallback;
  }

  /** เลิกท่าครั้งเดียวกลางคัน (ผู้เล่นเริ่มเดิน) */
  cancelAct() {
    if (!this.once) return;
    this.once = null;
    this.#play('idle');
  }

  /**
   * ผู้เล่นบังคับ
   * @param {{ x: number, y: number, run: boolean }} input x = ขวา, y = หน้า (ขนาด 0..1)
   * @param {number} camYaw มุมที่กล้องมอง (เรเดียน · 0 = มองไป +Z) — ปุ่ม "หน้า" = เดินไปทางที่กล้องมอง
   */
  drive(dt, input, camYaw, collide) {
    const g = this.group;
    const mag = Math.min(1, Math.hypot(input.x, input.y));
    let want = 0;
    if (mag > 0.08) {
      this.cancelAct();
      const fx = Math.sin(camYaw);
      const fz = Math.cos(camYaw);
      const heading = Math.atan2(fx * input.y - fz * input.x, fz * input.y + fx * input.x);
      const off = angleDelta(g.rotation.y, heading);
      g.rotation.y += clamp(off, -TURN * dt, TURN * dt);
      if (Math.abs(off) > 0.6) this.turning = 0.2;
      // หันกลับหลังทันที → ชะลอก่อนแล้วค่อยเดิน (ไม่ไถลถอยหลัง)
      want = (input.run ? this.def.run : this.def.walk * mag) * clamp(1 - Math.abs(off) / 2.2, 0.25, 1);
    }
    this.#move(dt, want, collide);
  }

  /**
   * เดินเองไปทาง target (AI) ด้วยความเร็วที่ท่าเดินในไฟล์ก้าวพอดี · avoid = ทิศที่อ้อมวัว/คน (bodySpace.steer)
   * คืน true เมื่อถึง (ระยะ < reach)
   */
  walkToward(dt, target, collide, { reach = 0.3, avoid = null, run = false } = {}) {
    const g = this.group;
    const dx = target.x - g.position.x;
    const dz = target.z - g.position.z;
    const dist = Math.hypot(dx, dz);
    if (dist < reach) {
      this.#move(dt, 0, collide);
      return true;
    }
    const want = Math.atan2(dx, dz);
    const av = avoid?.(want) ?? { heading: want, slow: 1 };
    const heading = want + angleDelta(want, av.heading) * clamp(dist / 1.2, 0.3, 1);
    const off = angleDelta(g.rotation.y, heading);
    g.rotation.y += clamp(off, -AI_TURN * dt, AI_TURN * dt);
    const base = run ? this.def.clip.run : this.def.clip.walk;
    // ชะลอเฉพาะก้าวสุดท้าย/ตอนเลี้ยวแรง — คนจริงไม่เดินแบบภาพช้า ท่าเดินช้าลงได้ไม่เกิน ~30%
    const v = base * clamp(dist / 0.5, 0.7, 1) * clamp(1 - Math.abs(off) / 1.6, 0.6, 1) * av.slow;
    this.#move(dt, v, collide);
    return false;
  }

  /** ยืนที่เดิม หันหน้าเข้าหาจุด p (คืน true เมื่อหันตรงแล้ว) */
  face(dt, p, collide) {
    const g = this.group;
    const off = angleDelta(g.rotation.y, Math.atan2(p.x - g.position.x, p.z - g.position.z));
    const step = clamp(off, -AI_TURN * 0.6 * dt, AI_TURN * 0.6 * dt);
    g.rotation.y += step;
    // หมุนตัวเกิน ~20° = ก้าวเท้าหมุน (ไม่ใช่ไถลหมุนทั้งตัวในท่ายืน)
    this.turning = Math.abs(off) > 0.35 ? 0.35 : Math.max(0, (this.turning ?? 0) - dt);
    this.#move(dt, 0, collide);
    return Math.abs(off) < 0.12;
  }

  /** ยืนนิ่ง (อัปเดตท่าทางอย่างเดียว) */
  stand(dt, collide) {
    this.#move(dt, 0, collide);
  }

  /** สถานะสำหรับส่งให้อีกเครื่อง (เล่นด้วยกันสองคน) */
  netState() {
    const g = this.group;
    return { x: g.position.x, y: g.position.y, z: g.position.z, h: g.rotation.y, s: this.speed, c: this.clipName, n: this.clipSerial };
  }

  /**
   * ตัวที่อีกเครื่องบังคับ: ไหลตามตำแหน่ง/ทิศที่ได้รับ (เกลี่ยให้นุ่ม · ห่างเกิน 4 ม. = วางทันที)
   * ท่าเดิน/วิ่ง/ยืนเลือกจากความเร็วแบบเดียวกับตัวเอง · ท่าอื่น (นั่ง นอน โบกมือ …) เล่นตามชื่อที่ได้รับ
   * @param {{ x: number, y: number, z: number, h: number, s: number, c: string, n: number }} st
   */
  puppet(dt, st) {
    const g = this.group;
    const dx = st.x - g.position.x;
    const dz = st.z - g.position.z;
    if (Math.hypot(dx, dz) > 4) {
      g.position.set(st.x, st.y ?? 0, st.z);
      g.rotation.y = st.h;
    } else {
      const k = 1 - Math.exp(-8 * dt);
      g.position.x += dx * k;
      g.position.z += dz * k;
      g.position.y += ((st.y ?? 0) - g.position.y) * k;
      g.rotation.y += angleDelta(g.rotation.y, st.h) * (1 - Math.exp(-12 * dt));
    }
    this.anchor.position.set(g.position.x, 1.1, g.position.z);
    this.speed = damp(this.speed, st.s ?? 0, 8, dt);
    const loco = st.c === 'idle' || st.c === 'walk' || st.c === 'run' || !this.actions[st.c];
    this.once = null;
    if (loco) {
      this.netClip = null;
      this.#animate(dt);
      return;
    }
    // ท่าใหม่ (หรือท่าเดิมที่เริ่มใหม่) → เล่นตั้งแต่ต้น
    if (this.netClip !== `${st.c}:${st.n}`) {
      this.netClip = `${st.c}:${st.n}`;
      this.#play(st.c, FADE, true);
    }
    this.mixer.update(dt);
  }

  #move(dt, want, collide) {
    const g = this.group;
    if (this.once) want = 0;
    this.speed = damp(this.speed, want, want > this.speed ? 6 : 9, dt);
    g.position.x += Math.sin(g.rotation.y) * this.speed * dt;
    g.position.z += Math.cos(g.rotation.y) * this.speed * dt;
    collide?.(g.position);
    this.anchor.position.set(g.position.x, 1.1, g.position.z);
    this.#animate(dt);
  }

  /** เลือกท่าตามความเร็ว + จบท่าครั้งเดียวที่หมดเวลา แล้วเดินแอนิเมชัน */
  #animate(dt) {

    if (this.once?.until != null) {
      this.once.until -= dt;
      if (this.once.until <= 0) {
        const done = this.once.done;
        this.once = null;
        this.#play('idle');
        done?.();
      }
    }
    if (!this.once && this.turning > 0 && this.speed < 0.2) {
      // ก้าวหมุนตัวอยู่กับที่: ใช้ท่าเดินช้า ๆ
      this.#play('walk');
      this.clip.setEffectiveTimeScale(0.75);
      this.turning = Math.max(0, this.turning - dt);
    } else if (!this.once) {
      const clip = this.def.clip;
      // วิ่งเมื่อเร็วเกินกึ่งกลางระหว่างเดินกับวิ่ง (มีช่วงกันสลับไปมา)
      const runAt = (clip.walk + clip.run) / 2;
      const running = this.clip === this.actions.run ? this.speed > runAt - 0.4 : this.speed > runAt;
      const moving = this.clip === this.actions.walk || this.clip === this.actions.run ? this.speed > 0.1 : this.speed > 0.2;
      this.#play(running ? 'run' : moving ? 'walk' : 'idle');
      // ความเร็วคลิปตามความเร็วจริง → เท้าไม่ไถล
      if (moving) this.clip.setEffectiveTimeScale(clamp(this.speed / (running ? clip.run : clip.walk), 0.6, 1.5));
    }
    this.mixer.update(dt);
  }

  #play(name, fade = FADE, restart = false) {
    const next = this.actions[name] ?? this.actions.idle;
    if (!next) return;
    const once = !LOOPED.has(name);
    if (next === this.clip && !once && !restart) return;
    this.clipName = this.actions[name] ? name : 'idle';
    this.clipSerial++;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    // ท่ายืนเริ่มจุดสุ่ม — สองคนไม่ขยับพร้อมกัน
    if (name === 'idle') next.time = Math.random() * next.getClip().duration;
    next.setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    if (this.clip && this.clip !== next) this.clip.fadeOut(fade);
    this.clip = next;
  }
}
