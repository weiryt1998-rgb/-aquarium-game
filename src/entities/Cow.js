import * as THREE from 'three';
import { fbm3 } from '../utils/noise.js';
import { iconTexture } from '../world/Sunflower.js';
import { angleDelta, clamp, damp, hashString, lerp, seededRandom } from '../utils/math.js';
import { TROUGH } from '../world/Farm.js';

/**
 * วัว 1 ตัวในฟาร์ม (ฝั่งแสดงผล) — อ่านค่าสถานะจาก shared/farm.js cowAt() ผ่าน show() แล้วเดินเล่น/เล็มหญ้าเอง
 *
 * โมเดลจริง (COW_MODEL จาก Blender: Fish/farm/build_cow*.py) มีโครงกระดูก + คลิป Walk / Graze / Idle
 * → เล่นด้วย AnimationMixer (สลับท่าแบบค่อย ๆ จาง · ความเร็วท่าเดินตามความเร็วจริง ขาไม่ไถล)
 * โมเดลที่มีคลิปเพิ่ม (บราห์มัน: Fish/farm/build_brahman.py) ทำได้อีก 2 อย่าง:
 *   Drink → เดินไปยืนหน้ารางน้ำ (TROUGH) หันเข้าราง แล้วก้มดื่ม
 *   LieDown / Lie / StandUp → ลงนอนพักสักครู่ แล้วลุกขึ้น (ให้ฟางระหว่างนอน = ลุกมากิน)
 * ผิวตามสายพันธุ์: ใช้ภาพในไฟล์ (โฮลสไตน์) หรือภาพ breed.skin แทน (เจอร์ซีย์)
 * ขนาด/ระยะ (opts จาก FarmSystem): ตัวผู้ใหญ่กว่าตัวเมียเล็กน้อย · ลูกวัวใช้ไฟล์ของตัวเองหรือย่อโมเดลตัวโต (breed.young)
 *
 * ฉากผสมพันธุ์ (ผู้เล่นกด "ผสมพันธุ์" เท่านั้น — ไม่อยู่ใน #decide สุ่ม): สถานะ 'mate'
 *   ตัวเมีย holdStill() → หยุดยืนนิ่ง (นอนอยู่ = ลุกก่อน · ข้างหลังชิดรั้ว = หันเข้ากลางคอกก่อน ตัวผู้จะได้ไม่ชนรั้ว)
 *   ตัวผู้ mate(cow) → เดิน (อ้อมด้านข้างถ้าอยู่หน้าตัวเมีย) ไปหยุดหลังตัวเมีย MOUNT_STANDOFF ม. หันทางเดียวกัน
 *     แล้วเล่นคลิป Mount ครั้งเดียว: ไถลเข้าถึง MOUNT_DISTANCE ตอนยกตัว · ถอยกลับตอนลง (ไม่มีคลิป = ยืนคู่กัน 3 วิ)
 *     มีหัวใจลอยเหนือทั้งคู่ · จบแล้วกลับไปเดินเล่นตามปกติ
 *   ยกเลิกเองเมื่อตัวใดตัวหนึ่งตาย/ถูกนำออก หรือเกิน MATE_TIMEOUT วินาที
 * ไม่มีไฟล์ = โมเดลชั่วคราวจากรูปทรงพื้นฐาน (ขาแกว่งด้วยโค้ด)
 *
 * หน่วยฉากฟาร์ม: 1 หน่วย = 1 เมตร · หันหน้าไปทาง +Z · จุดกำเนิด = พื้นใต้กลางลำตัว
 */

/** geometry ใช้ร่วมกันทุกตัว · วัสดุแยกตามสายพันธุ์ (สีลาย) */
const shared = { geo: null, mats: new Map() };

function geometries() {
  if (shared.geo) return shared.geo;
  const body = new THREE.CapsuleGeometry(0.46, 1.25, 8, 20);
  body.rotateX(Math.PI / 2);
  body.scale(1, 1.12, 1);
  const neck = new THREE.CylinderGeometry(0.2, 0.3, 0.6, 12);
  neck.rotateX(-0.9);
  const head = new THREE.CapsuleGeometry(0.19, 0.38, 6, 12);
  head.rotateX(Math.PI / 2 - 0.35);
  const muzzle = new THREE.SphereGeometry(0.17, 12, 10);
  muzzle.scale(1.15, 0.85, 1);
  const leg = new THREE.CylinderGeometry(0.085, 0.07, 0.78, 8);
  leg.translate(0, -0.39, 0); // จุดหมุนที่สะโพก/ไหล่
  const hoof = new THREE.CylinderGeometry(0.075, 0.09, 0.09, 8);
  hoof.translate(0, -0.8, 0);
  const udder = new THREE.SphereGeometry(0.2, 12, 10);
  udder.scale(1, 0.75, 1.1);
  const ear = new THREE.SphereGeometry(0.09, 8, 6);
  ear.scale(1.6, 0.45, 0.9);
  const horn = new THREE.ConeGeometry(0.04, 0.16, 6);
  const tail = new THREE.CylinderGeometry(0.025, 0.02, 0.7, 5);
  tail.translate(0, -0.35, 0);
  const tuft = new THREE.SphereGeometry(0.06, 6, 5);
  tuft.scale(1, 1.8, 1);
  tuft.translate(0, -0.72, 0);
  shared.geo = { body, neck, head, muzzle, leg, hoof, udder, ear, horn, tail, tuft };
  return shared.geo;
}

/** ระบายลายด่างบนลำตัว (ลายเดียวกันทุกตัวของพันธุ์นั้น — ตัวละลายต่างกันทำตอนใช้ไฟล์โมเดลจริง) */
function paintedBody(look) {
  const geo = geometries().body.clone();
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const base = new THREE.Color(look.base);
  const patch = look.patch ? new THREE.Color(look.patch) : null;
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    c.copy(base);
    if (patch && fbm3(x * 1.8 + 3.1, y * 1.8, z * 1.4, 3) > 0.6) c.copy(patch); // fbm3 ≈ 0..1 → ลายดำราว 40%
    else if (!patch) c.offsetHSL(0, 0, (y - 0.2) * 0.12); // หลังเข้ม ท้องอ่อน
    c.toArray(colors, i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

function materials(breed) {
  let m = shared.mats.get(breed.id);
  if (m) return m;
  const look = breed.look;
  const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });
  m = {
    bodyGeo: paintedBody(look),
    body: std('#ffffff', { vertexColors: true }),
    coat: std(look.patch ?? look.base),
    base: std(look.base),
    nose: std(look.nose, { roughness: 0.55 }),
    hoof: std('#2a2420'),
    horn: std(look.horn, { roughness: 0.5 }),
    udder: std('#efb4a8', { roughness: 0.6 }),
  };
  shared.mats.set(breed.id, m);
  return m;
}

const STATE = { idle: 'idle', walk: 'walk', graze: 'graze', drink: 'drink', lie: 'lie', mate: 'mate' };
/** คลิปที่เล่นเมื่อยืนอยู่กับที่ในแต่ละสถานะ (ชื่อคลิปตัวพิมพ์เล็ก) */
const STAND_CLIP = { idle: 'idle', walk: 'idle', graze: 'graze', drink: 'drink', mate: 'idle' };
/**
 * ระยะจากจุดกำเนิดตัวเมียไปข้างหลังถึงจุดกำเนิดตัวผู้ตอนเล่นคลิป Mount (ม. ที่ขนาดโมเดล 1 — คูณขนาดตัวผู้)
 * ต้องตรงกับที่ทำคลิปใน Blender (Fish/farm/build_cow*.py / build_brahman.py)
 */
export const MOUNT_DISTANCE = 1.3;
/**
 * ระยะที่ตัวผู้เดินมาหยุดรอ (ม. ที่ขนาดโมเดล 1) — ท่ายืนปกติที่ 1.3 ม. หัว/อกจะจมเข้าสะโพกตัวเมีย
 * คลิป Mount: ไถลเข้าจาก MOUNT_STANDOFF → MOUNT_DISTANCE ช่วง MOUNT_IN วิแรก (ตอนยกตัวขึ้น)
 * แล้วถอยกลับช่วง MOUNT_OUT วิสุดท้าย (ตอนลง) — ค่อย ๆ เร่งค่อย ๆ หยุด
 */
export const MOUNT_STANDOFF = 2.3;
const MOUNT_IN = 25 / 30;
const MOUNT_OUT = 30 / 30;
const smooth = (x) => {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
};
/** ฉากผสมพันธุ์ยกเลิกเองถ้าเกินเวลานี้ (วินาที — บวกเวลาเดินตามระยะห่างตอนเริ่ม) เช่นเดินไปไม่ถึง */
export const MATE_TIMEOUT = 20;
/** ไม่มีคลิป Mount (โมเดลชั่วคราว/ไฟล์เก่า) = ยืนคู่กันเท่านี้ (วินาที) */
const MATE_STAND = 3;
const HEART_COUNT = 5;
/** ปากถึงน้ำเมื่อยืนห่างขอบรางด้านใกล้ราว 0.85 ม. (ท่า Drink ปากยื่นไปหน้า ~1.2 ม. จากจุดกำเนิด) */
const DRINK_REACH = 1.25;

export const COW_MODEL = 'models/farm/cow.glb';
/** ความเร็วที่ท่าเดินในไฟล์ก้าวพอดีกับพื้น (ม./วินาที: ก้าวละ ~0.75 ม. ต่อรอบ 1.33 วิ) */
const WALK_CLIP_SPEED = 0.56;
const FADE = 0.45;
/** ภาพป้ายไอคอนใช้ร่วมกันทุกตัว */
const badgeTextures = new Map();
/** @type {THREE.CanvasTexture | null} */
let heartTex = null;

/** หัวใจลอย (อีโมจิล้วน ไม่มีกรอบวงกลมแบบป้ายไอคอน iconTexture) */
function heartTexture() {
  if (heartTex) return heartTex;
  const size = 96;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.shadowColor = 'rgba(0,0,0,0.3)';
  g.shadowBlur = 6;
  g.font = '72px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('💗', size / 2, size / 2 + 4);
  heartTex = new THREE.CanvasTexture(canvas);
  heartTex.colorSpace = THREE.SRGBColorSpace;
  return heartTex;
}

const _v = new THREE.Vector3();

export class Cow {
  /**
   * @param {{ id: string, breedId: string }} record ข้อมูลวัว (ใช้ id เป็น seed ให้แต่ละตัวเดินไม่พร้อมกัน)
   * @param {object} breed จาก data/animals.js
   * @param {{ minX: number, maxX: number, minZ: number, maxZ: number }} area ขอบคอก
   * @param {{ scene: THREE.Object3D, animations: THREE.AnimationClip[], skin?: THREE.Texture | null } | null} model
   *        สำเนาโมเดลจริง (AssetLoader.instantiate) · null = โมเดลชั่วคราว
   * @param {{ scale?: number, drinkReach?: number, walkClipSpeed?: number }} [opts]
   *        scale = ขนาดรวม (สายพันธุ์ × เพศ × ลูกวัว) ใช้กับโมเดลชั่วคราวด้วย · ระยะกินน้ำ/จังหวะก้าวของตัวเล็ก
   */
  constructor(record, breed, area, model = null, opts = {}) {
    this.id = record.id;
    this.breed = breed;
    this.area = area;
    this.rnd = seededRandom(hashString(record.id));
    this.status = null;
    this.mixer = null;
    const scale = opts.scale ?? breed.model?.scale ?? 1;
    /** ลูกวัวตัวเล็ก: ปากยื่นถึงรางใกล้กว่า · ก้าวสั้นกว่า (ท่าเดินต้องเร็วขึ้นถึงจะไม่ไถล) */
    this.drinkReach = opts.drinkReach ?? DRINK_REACH * scale;
    this.walkClipSpeed = opts.walkClipSpeed ?? WALK_CLIP_SPEED * scale;

    const group = model ? this.#fromModel(model) : this.#placeholder(breed);
    group.scale.setScalar(scale);
    group.userData.cow = this;
    this.group = group;
    this.hitSphere = new THREE.Sphere(new THREE.Vector3(), 1.3);
    // ป้ายบอกสิ่งที่วัวต้องการ (🌾 หิว · 🥛 นมเต็ม · 🤒 ป่วย) ลอยเหนือหลัง
    this.badge = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false }));
    this.badge.scale.setScalar(0.75);
    this.badge.position.y = 2.25;
    this.badge.visible = false;
    this.badgeIcon = null;
    group.add(this.badge);
    /** @type {THREE.Sprite[] | null} หัวใจลอยระหว่างฉากผสมพันธุ์ (เฉพาะตัวผู้ — ลอยเหนือกึ่งกลางระหว่างคู่) */
    this.hearts = null;

    // เริ่มที่จุดสุ่มในคอก
    group.position.set(lerp(area.minX, area.maxX, this.rnd()), 0, lerp(area.minZ, area.maxZ, this.rnd()));
    group.rotation.y = this.rnd() * Math.PI * 2;
    this.target = new THREE.Vector3();
    this.state = STATE.graze;
    this.stateTime = 2 + this.rnd() * 4;
    this.walkPhase = this.rnd() * 10;
    this.speed = 0;
    this.headDown = 0;
    this.clip = null;
    /** 'trough' = กำลังเดินไปรางน้ำ · 'graze' = เดินไปแปลงหญ้า */
    this.goal = null;
    /** () => จุดเล็มหญ้า (THREE.Vector3) | null — FarmSystem ใส่ให้ (แปลงเดียวกับที่สูตรในเซฟให้วัวตัวนี้กิน) */
    this.grazeSpot = null;
    /** ขั้นตอนตอนนอน: 'down' (กำลังลง) · 'rest' · 'up' (กำลังลุก) */
    this.liePhase = null;
    /** ทำอะไรต่อหลังลุกขึ้น { state, time } */
    this.after = null;
    /**
     * ฉากผสมพันธุ์ (null = ไม่ได้อยู่ในฉาก)
     * phase ของตัวผู้: 'side' (อ้อมไปด้านข้าง) → 'approach' → 'align' (เข้าที่ + หมุนตาม) → 'act' (คลิป Mount / ยืนคู่กัน)
     * @type {{ role: 'hold' | 'mount', partner: Cow | null, phase: string, left: number, heading: number,
     *          onDone: ((ok: boolean) => void) | null, side?: number, hasClip?: boolean, actLeft?: number, dist?: number } | null}
     */
    this.mating = null;
    /** เดินตามเส้นทาง (เข้า/ออกโรงนา) { points, i, onDone } · null = เดินเล่นตามปกติ */
    this.route = null;
    /** คอกในโรงนาที่ยืนประจำ { x, z, heading } · null = อยู่ในคอกหญ้าข้างนอก */
    this.stall = null;
    /**
     * (heading) => { heading, slow } — ทิศเดินที่อ้อมตัวอื่น (FarmSystem ใส่ให้ · entities/bodySpace.js steer)
     * @type {((heading: number) => { heading: number, slow: number }) | null}
     */
    this.avoid = null;
    if (this.mixer) this.#playClip(STATE.graze, 0);
  }

  /**
   * เดินตามจุด points ไปเรื่อย ๆ (ไม่ชนอะไร — จุดต้องเลี่ยงรั้ว/ผนังเอง) แล้วเรียก onDone()
   * นอนอยู่ = ลุกก่อน · ยกเลิกฉากผสมพันธุ์ · ระหว่างทางไม่เล็มหญ้า/ไม่ดื่มน้ำ
   * @param {THREE.Vector3[]} points
   * @param {(() => void) | null} [onDone]
   */
  travel(points, onDone = null) {
    if (this.dead || !points.length) return;
    if (this.mating) this.#endMate(false);
    this.route = { points, i: 0, onDone };
    if (this.state === STATE.lie) this.#getUp();
    else this.#nextLeg();
  }

  get traveling() {
    return !!this.route;
  }

  /** ยืนประจำคอกในโรงนา (null = กลับไปเดินเล่นในคอกหญ้า area) */
  setStall(stall) {
    this.stall = stall;
  }

  /** วางที่คอกในโรงนาทันที หันหน้าเข้ารางหญ้า (ตอนเริ่มฉาก) */
  placeInStall(stall) {
    this.stall = stall;
    this.route = null;
    this.group.position.set(stall.x, 0, stall.z);
    this.group.rotation.y = stall.heading;
    this.#decide(STATE.idle);
  }

  #nextLeg() {
    const r = this.route;
    this.state = STATE.walk;
    this.goal = 'route';
    this.stateTime = Infinity;
    this.target.copy(r.points[r.i]);
  }

  /** ถึงจุดหนึ่งในเส้นทาง → ไปจุดต่อไป / จบเส้นทาง */
  #legDone() {
    const r = this.route;
    if (++r.i < r.points.length) return this.#nextLeg();
    this.route = null;
    this.goal = null;
    this.#decide(this.stall ? STATE.idle : STATE.graze);
    r.onDone?.();
  }

  get canDrink() {
    return !!this.actions?.drink;
  }

  get canLie() {
    return !!(this.actions?.liedown && this.actions?.lie && this.actions?.standup);
  }

  #fromModel({ scene, animations, skin }) {
    const group = new THREE.Group();
    group.add(scene);
    if (skin) {
      scene.traverse((o) => {
        if (o.isMesh && /CowHide/i.test(o.material.name)) {
          o.material.map = skin;
          o.material.needsUpdate = true;
        }
      });
    }
    this.mixer = new THREE.AnimationMixer(scene);
    this.actions = {};
    for (const clip of animations) this.actions[clip.name.toLowerCase()] = this.mixer.clipAction(clip);
    return group;
  }

  /**
   * เปลี่ยนท่าแบบค่อย ๆ จาง · ท่าวนเริ่มที่เวลาสุ่ม วัวแต่ละตัวจะไม่ขยับพร้อมกัน
   * once = เล่นครั้งเดียวจากต้นคลิปแล้วค้างท่าสุดท้าย (ลงนอน / ลุก)
   */
  #playClip(name, fade = FADE, once = false) {
    const next = this.actions[name] ?? this.actions.idle;
    if (!next || next === this.clip) return;
    next.reset();
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    next.clampWhenFinished = once;
    next.time = once ? 0 : this.rnd() * next.getClip().duration;
    next.setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    this.clip?.fadeOut(fade);
    this.clip = next;
  }

  /** คลิปที่เล่นครั้งเดียวจบแล้วหรือยัง */
  get #clipDone() {
    const a = this.clip;
    return !a || a.time >= a.getClip().duration - 0.02;
  }

  #placeholder(breed) {
    const g = geometries();
    const m = materials(breed);
    const group = new THREE.Group();
    const mesh = (geo, mat, pos, parent = group) => {
      const o = new THREE.Mesh(geo, mat);
      o.position.set(...pos);
      o.castShadow = true;
      parent.add(o);
      return o;
    };

    mesh(m.bodyGeo, m.body, [0, 1.12, 0]);
    mesh(g.udder, m.udder, [0, 0.72, -0.45]);

    // หัวและคอ (หมุนรวมกันตอนก้มเล็มหญ้า)
    this.headPivot = new THREE.Group();
    this.headPivot.position.set(0, 1.35, 0.88);
    group.add(this.headPivot);
    mesh(g.neck, m.coat, [0, 0.02, 0.18], this.headPivot);
    mesh(g.head, m.base, [0, 0.0, 0.52], this.headPivot);
    mesh(g.muzzle, m.nose, [0, -0.14, 0.78], this.headPivot);
    for (const s of [-1, 1]) {
      mesh(g.ear, m.coat, [s * 0.24, 0.12, 0.42], this.headPivot).rotation.z = s * 0.35;
      mesh(g.horn, m.horn, [s * 0.12, 0.24, 0.42], this.headPivot).rotation.z = -s * 0.5;
    }

    // ขา: [x, z] ของไหล่/สะโพก — คู่ทแยงก้าวพร้อมกัน
    this.legs = [
      [-0.27, 0.62, 0],
      [0.27, 0.62, Math.PI],
      [-0.27, -0.62, Math.PI],
      [0.27, -0.62, 0],
    ].map(([x, z, phase]) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, 0.86, z);
      group.add(pivot);
      mesh(g.leg, m.base, [0, 0, 0], pivot);
      mesh(g.hoof, m.hoof, [0, 0, 0], pivot);
      return { pivot, phase };
    });

    this.tail = new THREE.Group();
    this.tail.position.set(0, 1.42, -1.05);
    this.tail.rotation.x = 0.25;
    group.add(this.tail);
    mesh(g.tail, m.coat, [0, 0, 0], this.tail);
    mesh(g.tuft, m.coat, [0, 0, 0], this.tail);
    return group;
  }

  /** ค่าสถานะปัจจุบันจาก cowAt() — หิว = เดินช้าลง · ตาย = นอนตะแคง */
  show(status) {
    this.status = status;
  }

  setBadge(icon) {
    if (icon === this.badgeIcon) return;
    this.badgeIcon = icon;
    this.badge.visible = !!icon;
    if (!icon) return;
    if (!badgeTextures.has(icon)) badgeTextures.set(icon, iconTexture(icon));
    this.badge.material.map = badgeTextures.get(icon);
    this.badge.material.needsUpdate = true;
  }

  /** เพิ่งได้ฟาง → ก้มกินหญ้าสักพัก (นอนอยู่ = ลุกขึ้นมากินก่อน) */
  eat() {
    if (this.mating || this.route) return; // ฉากผสมพันธุ์จบแล้วค่อยกิน (ค่าในเซฟอิ่มแล้วอยู่ดี)
    if (this.state === STATE.lie) return this.#getUp({ state: STATE.graze, time: 10 });
    this.#decide(STATE.graze);
    this.stateTime = 10;
  }

  /** ระหว่างรีดนม → ยืนนิ่ง (นอนอยู่ = นอนต่อ อยู่นิ่งอยู่แล้ว) */
  stand() {
    if (this.state === STATE.lie || this.mating || this.route) return;
    this.#decide(STATE.idle);
    this.stateTime = 5;
    this.speed = 0;
  }

  get dead() {
    return !!this.status && this.status.health <= 0;
  }

  /** อยู่ในฉากผสมพันธุ์อยู่ไหม */
  get isMating() {
    return !!this.mating;
  }

  /**
   * ตัวเมีย: หยุดยืนนิ่งรอตัวผู้ seconds วินาที (นอนอยู่ = ลุกก่อน · เดิน/ดื่มน้ำอยู่ = หยุดทันที)
   * ถ้าข้างหลังชิดรั้วจนตัวผู้ยืนไม่ได้ → หันหน้าเข้ากลางคอกก่อน · ตาย = false
   */
  holdStill(seconds = MATE_TIMEOUT) {
    if (this.dead) return false;
    if (this.mating) this.#endMate(false);
    const g = this.group;
    const a = this.area;
    const back = MOUNT_STANDOFF * 1.1 * g.scale.x + 0.6;
    const bx = g.position.x - Math.sin(g.rotation.y) * back;
    const bz = g.position.z - Math.cos(g.rotation.y) * back;
    const inside = bx > a.minX - 0.8 && bx < a.maxX + 0.8 && bz > a.minZ - 0.8 && bz < a.maxZ + 0.8;
    const heading = inside ? g.rotation.y : Math.atan2((a.minX + a.maxX) / 2 - g.position.x, (a.minZ + a.maxZ) / 2 - g.position.z);
    this.mating = { role: 'hold', partner: null, phase: 'hold', left: seconds, heading, onDone: null };
    this.goal = null;
    if (this.state === STATE.lie) this.#getUp({ state: STATE.mate, time: seconds });
    else this.#enterMate(seconds);
    return true;
  }

  /** ตัวเมียพร้อมแล้ว: ยืนอยู่ (ไม่นอน/ไม่กำลังลุก) หยุดนิ่ง และหันตามทิศที่ต้องการแล้ว */
  get holdReady() {
    const m = this.mating;
    return !!m && m.role === 'hold' && this.state === STATE.mate && this.speed < 0.05 && Math.abs(angleDelta(this.group.rotation.y, m.heading)) < 0.03;
  }

  /** ปล่อยตัวเมียกลับไปทำอย่างอื่น (ตัวผู้เรียกตอนจบฉาก) */
  release() {
    if (this.mating?.role !== 'hold') return;
    this.mating = null;
    if (this.state === STATE.lie) {
      // ยังลุกไม่เสร็จ → ลุกเสร็จแล้วเลือกเอง
      this.after = null;
      return;
    }
    this.#decide(STATE.idle);
    this.stateTime = 2 + this.rnd() * 2;
  }

  /**
   * ตัวผู้: เดินไปยืนหลังตัวเมีย cow แล้วขึ้นผสม (คลิป Mount) · onDone(ok) เมื่อจบหรือถูกยกเลิก
   * ตัวเมียยังไม่ได้ holdStill() = เรียกให้เอง · ตัวใดตัวหนึ่งตาย = false
   * @param {Cow} cow
   * @param {((ok: boolean) => void) | null} [onDone]
   */
  mate(cow, onDone = null) {
    if (this.dead || !cow || cow.dead || cow === this) return false;
    if (this.mating) this.#endMate(false);
    if (cow.mating?.role !== 'hold' && !cow.holdStill(MATE_TIMEOUT)) return false;
    cow.mating.partner = this;
    // กันค้าง: MATE_TIMEOUT + เวลาเดินจากจุดที่อยู่ตอนนี้ (คอกกว้าง ~20 ม. เดิน ~0.6 ม./วิ) · ตัวเมียรอนานเท่ากัน
    const far = this.group.position.distanceTo(cow.group.position);
    const left = MATE_TIMEOUT + far / 0.45;
    cow.mating.left = Math.max(cow.mating.left, left + 1);
    const m = { role: 'mount', partner: cow, phase: 'approach', left, heading: 0, onDone, dist: MOUNT_STANDOFF };
    this.mating = /** @type {any} */ (m);
    this.goal = null;
    // อยู่หน้า/ข้างตัวเมีย → อ้อมไปด้านข้างก่อน ไม่เดินทะลุตัว
    const c = cow.group;
    const h = cow.mating.heading;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const dx = this.group.position.x - c.position.x;
    const dz = this.group.position.z - c.position.z;
    if (dx * fx + dz * fz > -0.8) {
      this.mating.phase = 'side';
      this.mating.side = dx * fz - dz * fx >= 0 ? 1 : -1; // ฝั่งที่ตัวผู้อยู่ตอนนี้
    }
    if (this.state === STATE.lie) this.#getUp({ state: STATE.mate, time: MATE_TIMEOUT });
    else this.#enterMate(MATE_TIMEOUT);
    return true;
  }

  #enterMate(seconds) {
    this.state = STATE.mate;
    this.stateTime = seconds;
  }

  /**
   * จุดที่ตัวผู้ต้องยืน: หลังตัวเมียตามทิศที่ตัวเมียจะหัน ห่าง m.dist ม. (ขนาดโมเดล 1 — คูณขนาดตัวผู้)
   * 'side' = ข้างตัวเมียค่อนไปทางหลัง
   */
  #mountSpot(out) {
    const m = this.mating;
    const c = m.partner.group;
    const h = m.partner.mating?.heading ?? c.rotation.y;
    const d = (m.dist ?? MOUNT_STANDOFF) * this.group.scale.x;
    out.set(c.position.x - Math.sin(h) * d, 0, c.position.z - Math.cos(h) * d);
    if (m.phase === 'side') {
      // ข้างตัวเมีย 2 ม. ค่อนไปทางหลังอีก 0.8 ม. → เดินต่อเข้าหลังตัวเมียโดยไม่ผ่านลำตัว
      const s = m.side * 2;
      out.x += Math.cos(h) * s - Math.sin(h) * 0.8;
      out.z += -Math.sin(h) * s - Math.cos(h) * 0.8;
    }
    return out;
  }

  /** จบฉาก (ok = เล่นจนจบ) — ปล่อยอีกตัว เก็บหัวใจ แล้วกลับไปเดินเล่นตามปกติ */
  #endMate(ok) {
    const m = this.mating;
    if (!m) return;
    if (m.role === 'hold') {
      // ตัวเมียถูกยกเลิก (ตาย/สั่งใหม่) → ให้ตัวผู้จบด้วย
      const bull = m.partner;
      if (bull?.mating?.partner === this) bull.#endMate(ok);
      this.release();
      return;
    }
    this.mating = null;
    this.#showHearts(false);
    if (m.partner?.mating?.partner === this) m.partner.release();
    if (this.state !== STATE.lie) {
      this.#decide(STATE.idle);
      this.stateTime = 2 + this.rnd() * 2;
    }
    m.onDone?.(ok);
  }

  /** ระหว่างฉากผสมพันธุ์: คืน { wantSpeed, facing } ให้ update ขยับต่อ */
  #updateMate(dt) {
    const m = this.mating;
    const g = this.group;
    const still = { wantSpeed: 0, facing: true };
    m.left -= dt;
    const partner = m.partner;
    const gone = (c) => !c || c.dead || !c.group.parent || c.mating?.partner !== this;
    if (m.left <= 0 || (m.role === 'mount' && gone(partner))) {
      this.#endMate(false);
      return still;
    }
    if (m.role === 'hold') {
      // ยืนนิ่ง หันตามทิศที่เลือกไว้ (ปกติ = ทิศเดิม)
      const off = angleDelta(g.rotation.y, m.heading);
      g.rotation.y += clamp(off, -1.2 * dt, 1.2 * dt);
      return still;
    }
    // ตัวผู้: ระหว่างคลิป Mount ระยะเลื่อนเข้า/ออกตามเวลาในคลิป (ไม่มีคลิป = ยืนรอที่ MOUNT_STANDOFF)
    if (m.phase === 'act' && m.hasClip) {
      const a = this.actions.mount;
      const t = a.time;
      const dur = a.getClip().duration;
      const k = t < MOUNT_IN ? smooth(t / MOUNT_IN) : t > dur - MOUNT_OUT ? 1 - smooth((t - (dur - MOUNT_OUT)) / MOUNT_OUT) : 1;
      m.dist = lerp(MOUNT_STANDOFF, MOUNT_DISTANCE, k);
    }
    const spot = this.#mountSpot(_v);
    const dx = spot.x - g.position.x;
    const dz = spot.z - g.position.z;
    const dist = Math.hypot(dx, dz);
    const heading = partner.mating.heading;
    if (m.phase === 'side' || m.phase === 'approach') {
      if (dist < (m.phase === 'side' ? 0.6 : 0.3)) {
        m.phase = m.phase === 'side' ? 'approach' : 'align';
        return still;
      }
      g.rotation.y += clamp(angleDelta(g.rotation.y, Math.atan2(dx, dz)), -1.5 * dt, 1.5 * dt);
      return { wantSpeed: 0.6 * clamp(dist, 0.3, 1), facing: true };
    }
    if (m.phase === 'align') {
      // ค่อย ๆ เข้าที่ + หมุนตามตัวเมีย แล้วรอตัวเมียพร้อม (ลุกเสร็จ/หันเสร็จ)
      g.position.x = damp(g.position.x, spot.x, 4, dt);
      g.position.z = damp(g.position.z, spot.z, 4, dt);
      const off = angleDelta(g.rotation.y, heading);
      g.rotation.y += clamp(off, -1.4 * dt, 1.4 * dt);
      this.#showHearts(true);
      if (Math.abs(off) < 0.03 && dist < 0.05 && this.speed < 0.05 && partner.holdReady) {
        g.position.set(spot.x, g.position.y, spot.z);
        g.rotation.y = heading;
        m.phase = 'act';
        m.hasClip = !!this.actions?.mount;
        m.actLeft = MATE_STAND;
        if (m.hasClip) this.#playClip('mount', 0.3, true);
      }
      return still;
    }
    // act: ล็อกตำแหน่งไว้หลังตัวเมีย (ระยะตาม m.dist) จนจบคลิป
    g.position.set(spot.x, g.position.y, spot.z);
    g.rotation.y = heading;
    m.actLeft -= dt;
    if (m.hasClip ? this.#clipDone : m.actLeft <= 0) this.#endMate(true);
    return still;
  }

  /** หัวใจลอยเหนือตัวเมียค่อนไปทางตัวผู้ (sprite ในกลุ่มของตัวผู้ ข้างหน้าตามระยะคู่ตอนนี้) */
  #showHearts(on) {
    if (on && !this.hearts) {
      this.hearts = Array.from({ length: HEART_COUNT }, (_, i) => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: heartTexture(), transparent: true, depthWrite: false, fog: false }));
        s.userData.t = i / HEART_COUNT;
        s.userData.x = (this.rnd() - 0.5) * 0.9;
        s.material.opacity = 0;
        this.group.add(s);
        return s;
      });
    } else if (!on && this.hearts) {
      for (const s of this.hearts) {
        this.group.remove(s);
        s.material.dispose();
      }
      this.hearts = null;
    }
  }

  #updateHearts(dt) {
    if (!this.hearts) return;
    const z = (this.mating?.dist ?? MOUNT_DISTANCE) * 0.6;
    for (const s of this.hearts) {
      const u = s.userData;
      u.t = (u.t + dt * 0.4) % 1;
      s.position.set(u.x + Math.sin(u.t * 9 + u.x * 7) * 0.12, 2.0 + u.t * 1.3, z);
      s.scale.setScalar(0.32 + 0.18 * Math.sin(u.t * Math.PI));
      s.material.opacity = Math.min(1, u.t * 5) * (1 - u.t);
    }
  }

  pick(ray) {
    this.hitSphere.center.copy(this.group.position).setY(1.0);
    return ray.intersectsSphere(this.hitSphere);
  }

  /** ตำแหน่งเหนือหลังวัว (ไว้ลอยตัวเลข/ไอคอน) */
  topPosition(out = new THREE.Vector3()) {
    return out.copy(this.group.position).setY(2.1);
  }

  update(dt, time) {
    const g = this.group;
    // ป้ายลอยขึ้นลงเบา ๆ
    if (this.badge.visible) this.badge.position.y = 2.25 + Math.sin(time * 2.4 + this.walkPhase) * 0.06;
    if (this.dead) {
      if (this.mating) this.#endMate(false);
      g.rotation.z = damp(g.rotation.z, 1.35, 2, dt);
      g.position.y = damp(g.position.y, 0.35, 2, dt);
      this.mixer?.stopAllAction();
      return;
    }
    g.rotation.z = damp(g.rotation.z, 0, 4, dt);
    g.position.y = damp(g.position.y, 0, 4, dt);

    this.stateTime -= dt;
    if (this.state === STATE.lie) {
      this.#updateLie();
      // ยังลุกไม่เสร็จก็นับเวลากันค้างด้วย
      if (this.mating && this.state === STATE.lie && (this.mating.left -= dt) <= 0) this.#endMate(false);
    } else if (this.state === STATE.mate ? !this.mating : this.stateTime <= 0) this.#decide();
    this.#updateHearts(dt);

    let wantSpeed = 0;
    let facing = true;
    if (this.state === STATE.mate) {
      ({ wantSpeed, facing } = this.#updateMate(dt));
    } else if (this.state === STATE.drink) {
      // หันเข้ารางก่อนค่อยก้มดื่ม
      const off = angleDelta(g.rotation.y, Math.PI);
      g.rotation.y += clamp(off, -1.4 * dt, 1.4 * dt);
      facing = Math.abs(off) < 0.25;
    } else if (this.state === STATE.walk) {
      const dx = this.target.x - g.position.x;
      const dz = this.target.z - g.position.z;
      const dist = Math.hypot(dx, dz);
      const onRoute = this.goal === 'route';
      if (dist < (onRoute && this.route.i < this.route.points.length - 1 ? 0.6 : 0.3)) {
        if (onRoute) this.#legDone();
        else if (this.goal === 'trough') this.#startDrink();
        else this.#decide(STATE.graze);
      } else {
        const heading = Math.atan2(dx, dz);
        // มีตัวอื่นขวางทาง: เลี้ยวอ้อม (ใกล้ถึงที่หมายแล้วอ้อมน้อยลง ไม่วนรอบจุด) + ชะลอ/หยุดรอ
        const av = this.avoid?.(heading) ?? { heading, slow: 1 };
        const off = angleDelta(g.rotation.y, heading + angleDelta(heading, av.heading) * clamp(dist / 1.5, 0.3, 1));
        g.rotation.y += clamp(off, -1.2 * dt, 1.2 * dt);
        const hungry = (this.status?.satiety ?? 100) < 20;
        // ตามเส้นทาง: เดินเร็วขึ้นหน่อย แต่ชะลอตอนต้องเลี้ยวมาก (ไม่ให้วนรอบจุดหรือเฉียดผนัง)
        wantSpeed = onRoute ? 0.9 * clamp(dist, 0.4, 1) * clamp(1 - Math.abs(off) / 1.6, 0.2, 1) : (hungry ? 0.35 : 0.6) * clamp(dist, 0, 1);
        wantSpeed *= av.slow;
      }
    } else if (this.stall) {
      // ในคอกโรงนา: หันหน้าเข้ารางหญ้าชิดผนัง
      const off = angleDelta(g.rotation.y, this.stall.heading);
      g.rotation.y += clamp(off, -1.2 * dt, 1.2 * dt);
      facing = Math.abs(off) < 0.3;
    }
    this.speed = damp(this.speed, wantSpeed, 3, dt);
    g.position.x += Math.sin(g.rotation.y) * this.speed * dt;
    g.position.z += Math.cos(g.rotation.y) * this.speed * dt;

    if (this.mixer) {
      // ท่าจากไฟล์: เดิน (ความเร็วท่าตามความเร็วจริง) · เล็มหญ้า · ดื่มน้ำ · ยืนพัก (ท่านอนเลือกใน #updateLie)
      const moving = this.speed > 0.08;
      if (this.state !== STATE.lie && this.mating?.phase !== 'act') this.#playClip(moving ? STATE.walk : facing ? STAND_CLIP[this.state] : STATE.idle);
      if (moving) this.actions.walk?.setEffectiveTimeScale(clamp(this.speed / this.walkClipSpeed, 0.4, 2));
      this.mixer.update(dt);
      return;
    }

    // โมเดลชั่วคราว: ขาก้าวตามความเร็ว · หัวก้มตอนเล็มหญ้า · หางปัดแมลง
    this.walkPhase += dt * this.speed * 7;
    const swing = Math.min(1, this.speed / 0.4) * 0.45;
    for (const leg of this.legs) leg.pivot.rotation.x = Math.sin(this.walkPhase + leg.phase) * swing;
    this.headDown = damp(this.headDown, this.state === STATE.graze ? 1 : 0, 2.5, dt);
    this.headPivot.rotation.x = lerp(0, 0.95, this.headDown) + Math.sin(time * 1.3 + this.walkPhase) * 0.04;
    this.headPivot.rotation.y = this.state === STATE.idle ? Math.sin(time * 0.7) * 0.35 : 0;
    this.tail.rotation.z = Math.sin(time * 2.1 + this.walkPhase) * 0.35;
  }

  #decide(force) {
    this.goal = null;
    if (this.route) return this.#nextLeg();
    if (this.stall) {
      // ในโรงนา: ไม่เดินไปไหน — กินฟางในราง / ยืนพัก / นอน
      const r = this.rnd();
      if (!force && this.canLie && r < 0.15) return this.#lieDown();
      this.state = force && force !== STATE.walk ? force : r < 0.6 ? STATE.graze : STATE.idle;
      this.stateTime = 5 + this.rnd() * 9;
      return;
    }
    if (!force && this.mixer) {
      const r = this.rnd();
      if (this.canLie && r < 0.1) return this.#lieDown();
      if (this.canDrink && r < 0.22) return this.#goDrink();
    }
    const r = this.rnd();
    this.state = force ?? (r < 0.45 ? STATE.walk : r < 0.8 ? STATE.graze : STATE.idle);
    this.stateTime = this.state === STATE.walk ? 12 : 3 + this.rnd() * 6;
    // หิวและในคอกมีหญ้า: เดินไปเล็มแปลงที่สูตรในเซฟให้กิน (หญ้าแปลงนั้นจะค่อย ๆ หายไปตรงที่วัวยืน)
    if (!force && this.state !== STATE.idle) {
      const spot = this.grazeSpot?.();
      if (spot) {
        const near = Math.hypot(spot.x - this.group.position.x, spot.z - this.group.position.z) < 1.6;
        this.state = near ? STATE.graze : STATE.walk;
        this.stateTime = near ? 6 + this.rnd() * 8 : 20;
        if (!near) {
          this.goal = 'graze';
          this.target.copy(spot);
        }
        return;
      }
    }
    if (this.state === STATE.walk) {
      const a = this.area;
      this.target.set(lerp(a.minX, a.maxX, this.rnd()), 0, lerp(a.minZ, a.maxZ, this.rnd()));
    }
  }

  /** เดินไปยืนหน้ารางน้ำ (ฝั่ง +Z ของราง) ตำแหน่งสุ่มตามความยาวราง */
  #goDrink() {
    const reach = this.drinkReach;
    this.state = STATE.walk;
    this.goal = 'trough';
    this.stateTime = 25;
    this.target.set(TROUGH.x + (this.rnd() - 0.5) * (TROUGH.width - 0.8), 0, TROUGH.z + TROUGH.depth / 2 + reach - 0.6);
  }

  #startDrink() {
    this.goal = null;
    this.state = STATE.drink;
    this.stateTime = 6 + this.rnd() * 6;
  }

  #lieDown() {
    this.state = STATE.lie;
    this.liePhase = 'down';
    this.stateTime = 18 + this.rnd() * 22;
    this.after = null;
    this.#playClip('liedown', FADE, true);
  }

  /** ลุกขึ้น แล้วทำ next ต่อ (ไม่ระบุ = เลือกเอง) */
  #getUp(next = null) {
    this.after = next;
    if (this.liePhase === 'up') return;
    this.liePhase = 'up';
    this.#playClip('standup', 0.3, true);
  }

  #updateLie() {
    if (this.liePhase === 'down' && this.#clipDone) {
      this.liePhase = 'rest';
      this.#playClip('lie', 0.3);
    } else if (this.liePhase === 'rest' && this.stateTime <= 0) {
      this.#getUp();
    } else if (this.liePhase === 'up' && this.#clipDone) {
      const next = this.after;
      this.liePhase = null;
      this.after = null;
      if (this.route) return this.#nextLeg();
      this.#decide(next?.state ?? STATE.idle);
      if (next?.time) this.stateTime = next.time;
    }
  }
}
