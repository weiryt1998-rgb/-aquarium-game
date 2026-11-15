import * as THREE from 'three';
import { angleDelta, clamp, damp, lerp } from '../utils/math.js';

/** ตาเหม คนเลี้ยงวัว (Fish/farm/build_tahem.py): คลิป HemIdle · HemWalk · HemTend + ท่าคุย HemTalk HemLaugh HemShrug HemWave */
export const FARMER_MODEL = 'models/farm/tahem.glb';
export const FARMER_NAME = 'ตาเหม';

/** ความเร็วที่ท่าเดินในไฟล์ก้าวพอดีพื้น (ก้าวละ ~0.5 ม. · รอบ 32 เฟรม) */
const WALK_CLIP_SPEED = 0.94;
const SPEED = 0.95;
const TURN = 3.2;
const FADE = 0.35;
/** ท่าที่เล่นวน (ที่เหลือเล่นครั้งเดียว) */
const LOOPED = new Set(['idle', 'walk', 'talk']);
/** ความสูงหัว (ม.) — วางฟองคำพูด */
export const FARMER_HEAD = 1.9;

/**
 * จุดในเส้นทาง: Vector3 คงที่ หรือฟังก์ชันที่คืน Vector3 (คำนวณใหม่ทุกเฟรม — ใช้ตามวัวที่ยังเดินอยู่)
 * @typedef {THREE.Vector3 | (() => THREE.Vector3)} RoutePoint
 */

/**
 * ตาเหม: เดินเล่นในคอก (area) · ผู้เล่นดูแลวัวตัวไหน → FarmSystem ส่งเส้นทางมาให้เดินไปข้างวัว หันหน้าเข้าหา แล้วก้มลูบ (HemTend)
 * ไม่มีการชนกับอะไร — เส้นทางต้องเลี่ยงรั้ว/ผนังเอง (FarmSystem ใช้ช่องรั้วหลังและประตูโรงนา)
 */
export class Farmer {
  /**
   * @param {{ scene: THREE.Object3D, animations: THREE.AnimationClip[] }} model สำเนาโมเดล (AssetLoader.instantiate)
   * @param {{ minX: number, maxX: number, minZ: number, maxZ: number }} area พื้นที่เดินเล่น (คอกหญ้า)
   */
  constructor(model, area) {
    this.area = area;
    this.group = new THREE.Group();
    this.group.add(model.scene);
    this.mixer = new THREE.AnimationMixer(model.scene);
    this.actions = {};
    for (const clip of model.animations) this.actions[clip.name.replace(/^Hem/, '').toLowerCase()] = this.mixer.clipAction(clip);
    this.clip = null;

    this.label = nameLabel(FARMER_NAME);
    this.label.position.y = 2.0;
    this.group.add(this.label);
    this.hitSphere = new THREE.Sphere(new THREE.Vector3(), 0.7);

    this.group.position.set(lerp(area.minX, area.maxX, 0.45), 0, area.maxZ - 0.5);
    this.group.rotation.y = Math.PI;
    this.speed = 0;
    this.target = new THREE.Vector3();
    /** 'idle' · 'walk' · 'tend' */
    this.state = 'idle';
    this.stateTime = 2;
    /** @type {{ points: RoutePoint[], i: number, face: (() => THREE.Vector3) | null, onDone: (() => void) | null } | null} */
    this.route = null;
    /** หันหน้าเข้าหาจุดนี้ระหว่างก้มลูบวัว */
    this.faceAt = null;
    /** วัวที่กำลังเดินไปหา (ไม่หลบตัวนี้ — ต้องเข้าไปยืนข้าง ๆ) · FarmSystem ใส่ให้ */
    this.focus = null;
    /** @type {((heading: number) => { heading: number, slow: number }) | null} ทิศเดินที่อ้อมวัว (bodySpace.steer) */
    this.avoid = null;
    /** @type {{ face: () => THREE.Vector3, once: { done: Function | null, until: number | null } | null } | null} กำลังคุยกับผู้เล่น (SocialSystem) */
    this.convo = null;
    this.mixer.addEventListener('finished', (e) => {
      if (this.convo?.once && e.action === this.clip) {
        const done = this.convo.once.done;
        this.convo.once = null;
        done?.();
      }
    });
    this.#play('idle', 0);
  }

  get position() {
    return this.group.position;
  }

  get traveling() {
    return !!this.route;
  }

  /**
   * เดินตามเส้นทางไปหาวัว แล้วหันหน้าเข้าหา face() และก้มลูบ (HemTend) ครั้งหนึ่ง · มีงานเดิมอยู่ = ยกเลิกงานเดิม
   * @param {RoutePoint[]} points
   * @param {() => THREE.Vector3} face
   * @param {(() => void) | null} [onDone] เรียกเมื่อลูบเสร็จ
   */
  visit(points, face, onDone = null) {
    this.convo = null;
    this.route = { points, i: 0, face, onDone };
    this.faceAt = null;
    this.#walkTo(this.#point(points[0]));
  }

  /** เดินไปตามจุดแล้วเลือกทำอย่างอื่นเอง (ใช้ตอนเดินออกจากโรงนา) */
  walk(points) {
    this.route = { points, i: 0, face: null, onDone: null };
    this.faceAt = null;
    this.#walkTo(this.#point(points[0]));
  }

  get key() {
    return 'tahem';
  }

  hasClip(name) {
    return !!this.actions[name];
  }

  clipDuration(name, fallback = 2.5) {
    const a = this.actions[name];
    return a && !LOOPED.has(name) ? a.getClip().duration : fallback;
  }

  /** หยุดงานแล้วหันมาคุยกับคนที่ face() ชี้ (เส้นทางเดิมยกเลิก) */
  talkTo(face) {
    this.route = null;
    this.focus = null;
    this.faceAt = null;
    this.state = 'convo';
    this.convo = { face, once: null };
  }

  /** เล่นท่าระหว่างคุย — 'talk' วนนาน duration วินาที · ท่าอื่นเล่นครั้งเดียว */
  act(name, done = null, { duration = 2.5 } = {}) {
    if (!this.convo) return done?.();
    const n = this.actions[name] ? name : 'talk';
    this.convo.once = { done, until: LOOPED.has(n) ? duration : null };
    this.#play(n, FADE, true);
  }

  /** คุยจบ กลับไปทำงานต่อ */
  release() {
    if (!this.convo) return;
    this.convo = null;
    // ถูกสั่งงานใหม่ระหว่างคุย (เช่นผู้เล่นให้ฟางวัว → visit) = ทำงานนั้นต่อ ไม่ต้องกลับไปยืน
    if (this.state === 'convo') this.#idle(1.5 + Math.random() * 2);
  }

  /** แตะโดนตาเหมไหม */
  pick(ray) {
    this.hitSphere.center.copy(this.group.position).setY(0.9);
    return ray.intersectsSphere(this.hitSphere);
  }

  update(dt, time) {
    const g = this.group;
    this.label.position.y = 2.0 + Math.sin(time * 2) * 0.03;
    this.stateTime -= dt;
    let wantSpeed = 0;

    if (this.state === 'convo' && this.convo) {
      const f = this.convo.face();
      const off = angleDelta(g.rotation.y, Math.atan2(f.x - g.position.x, f.z - g.position.z));
      g.rotation.y += clamp(off, -TURN * dt, TURN * dt);
      const o = this.convo.once;
      if (o?.until != null && (o.until -= dt) <= 0) {
        this.convo.once = null;
        o.done?.();
      }
      if (!this.convo?.once) this.#play('idle');
      this.speed = damp(this.speed, 0, 8, dt);
      this.mixer.update(dt);
      return;
    }
    if (this.state === 'walk') {
      if (this.route) this.target.copy(this.#point(this.route.points[this.route.i]));
      const dx = this.target.x - g.position.x;
      const dz = this.target.z - g.position.z;
      const dist = Math.hypot(dx, dz);
      const last = !this.route || this.route.i >= this.route.points.length - 1;
      if (dist < (last ? 0.25 : 0.5)) this.#arrived();
      else {
        const want = Math.atan2(dx, dz);
        const av = this.avoid?.(want) ?? { heading: want, slow: 1 };
        const off = angleDelta(g.rotation.y, want + angleDelta(want, av.heading) * clamp(dist / 1.2, 0.3, 1));
        g.rotation.y += clamp(off, -TURN * dt, TURN * dt);
        wantSpeed = SPEED * clamp(dist / 0.8, 0.35, 1) * clamp(1 - Math.abs(off) / 1.8, 0.15, 1) * av.slow;
        if (this.stateTime <= 0 && !this.route) this.#idle(); // เดินเล่นไปไม่ถึงในเวลาที่ให้ → พัก
      }
    } else if (this.state === 'tend') {
      if (this.faceAt) {
        const f = this.faceAt();
        const off = angleDelta(g.rotation.y, Math.atan2(f.x - g.position.x, f.z - g.position.z));
        g.rotation.y += clamp(off, -TURN * dt, TURN * dt);
      }
      if (this.stateTime <= 0) {
        const done = this.route?.onDone;
        this.route = null;
        this.faceAt = null;
        this.focus = null;
        this.#idle(2 + Math.random() * 2);
        done?.();
      }
    } else if (this.stateTime <= 0) {
      this.#wander();
    }

    this.speed = damp(this.speed, wantSpeed, 5, dt);
    g.position.x += Math.sin(g.rotation.y) * this.speed * dt;
    g.position.z += Math.cos(g.rotation.y) * this.speed * dt;

    const moving = this.speed > 0.08;
    this.#play(this.state === 'tend' ? 'tend' : moving ? 'walk' : 'idle');
    if (moving) this.actions.walk?.setEffectiveTimeScale(clamp(this.speed / WALK_CLIP_SPEED, 0.5, 1.6));
    this.mixer.update(dt);
  }

  #point(p) {
    return typeof p === 'function' ? p() : p;
  }

  #walkTo(p) {
    this.state = 'walk';
    this.stateTime = 25;
    this.target.copy(p);
  }

  #arrived() {
    const r = this.route;
    if (!r) return this.#idle();
    if (++r.i < r.points.length) return this.#walkTo(this.#point(r.points[r.i]));
    if (!r.face) {
      this.route = null;
      return this.#idle();
    }
    // ถึงข้างวัวแล้ว: หันหน้าเข้าหาแล้วก้มลูบ 1 รอบคลิป
    this.state = 'tend';
    this.faceAt = r.face;
    this.stateTime = this.actions.tend?.getClip().duration ?? 3;
    this.actions.tend?.reset();
  }

  #idle(time = 3 + Math.random() * 6) {
    this.state = 'idle';
    this.stateTime = time;
  }

  /** เดินเล่นไปจุดสุ่มในคอก (ไม่ไกลจากที่เดิมนัก) */
  #wander() {
    const a = this.area;
    const p = this.group.position;
    const x = clamp(p.x + (Math.random() - 0.5) * 10, a.minX, a.maxX);
    const z = clamp(p.z + (Math.random() - 0.5) * 8, a.minZ, a.maxZ);
    this.#walkTo(new THREE.Vector3(x, 0, z));
  }

  #play(name, fade = FADE, restart = false) {
    const next = this.actions[name] ?? this.actions.idle;
    if (!next || (next === this.clip && !restart)) return;
    next.reset();
    const once = !LOOPED.has(name);
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    this.clip?.fadeOut(fade);
    this.clip = next;
  }
}

/** ป้ายชื่อลอยเหนือหัว (พื้นเข้มโปร่ง ตัวอักษรขาว) · icon = อีโมจิหน้าชื่อ */
export function nameLabel(text, icon = '👴') {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(20, 40, 70, 0.72)';
  ctx.beginPath();
  ctx.roundRect(8, 8, 240, 56, 28);
  ctx.fill();
  ctx.font = 'bold 34px "Noto Sans Thai", "Leelawadee UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#fff';
  ctx.fillText(`${icon} ${text}`, 128, 38);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, fog: false }));
  sprite.scale.set(0.9, 0.25, 1);
  return sprite;
}
