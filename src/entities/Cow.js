import * as THREE from 'three';
import { fbm3 } from '../utils/noise.js';
import { iconTexture } from '../world/Sunflower.js';
import { angleDelta, clamp, damp, hashString, lerp, seededRandom } from '../utils/math.js';

/**
 * วัว 1 ตัวในฟาร์ม (ฝั่งแสดงผล) — อ่านค่าสถานะจาก shared/farm.js cowAt() ผ่าน show() แล้วเดินเล่น/เล็มหญ้าเอง
 *
 * โมเดลจริง (COW_MODEL จาก Blender: Fish/farm/build_cow*.py) มีโครงกระดูก + คลิป Walk / Graze / Idle
 * → เล่นด้วย AnimationMixer (สลับท่าแบบค่อย ๆ จาง · ความเร็วท่าเดินตามความเร็วจริง ขาไม่ไถล)
 * ผิวตามสายพันธุ์: ใช้ภาพในไฟล์ (โฮลสไตน์) หรือภาพ breed.skin แทน (เจอร์ซีย์)
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

const STATE = { idle: 'idle', walk: 'walk', graze: 'graze' };

export const COW_MODEL = 'models/farm/cow.glb';
/** ความเร็วที่ท่าเดินในไฟล์ก้าวพอดีกับพื้น (ม./วินาที: ก้าวละ ~0.75 ม. ต่อรอบ 1.33 วิ) */
const WALK_CLIP_SPEED = 0.56;
const FADE = 0.45;
/** ภาพป้ายไอคอนใช้ร่วมกันทุกตัว */
const badgeTextures = new Map();

export class Cow {
  /**
   * @param {{ id: string, breedId: string }} record ข้อมูลวัว (ใช้ id เป็น seed ให้แต่ละตัวเดินไม่พร้อมกัน)
   * @param {object} breed จาก data/animals.js
   * @param {{ minX: number, maxX: number, minZ: number, maxZ: number }} area ขอบคอก
   * @param {{ scene: THREE.Object3D, animations: THREE.AnimationClip[], skin?: THREE.Texture | null } | null} model
   *        สำเนาโมเดลจริง (AssetLoader.instantiate) · null = โมเดลชั่วคราว
   */
  constructor(record, breed, area, model = null) {
    this.id = record.id;
    this.breed = breed;
    this.area = area;
    this.rnd = seededRandom(hashString(record.id));
    this.status = null;
    this.mixer = null;

    const group = model ? this.#fromModel(model) : this.#placeholder(breed);
    group.scale.setScalar(breed.model?.scale ?? 1);
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
    if (this.mixer) this.#playClip(STATE.graze, 0);
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

  /** เปลี่ยนท่า (walk / graze / idle) แบบค่อย ๆ จาง · เริ่มคลิปที่เวลาสุ่ม วัวแต่ละตัวจะไม่ขยับพร้อมกัน */
  #playClip(name, fade = FADE) {
    const next = this.actions[name] ?? this.actions.idle;
    if (!next || next === this.clip) return;
    next.reset();
    next.time = this.rnd() * next.getClip().duration;
    next.setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(fade).play();
    this.clip?.fadeOut(fade);
    this.clip = next;
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

  /** เพิ่งได้ฟาง → ก้มกินหญ้าสักพัก */
  eat() {
    this.#decide(STATE.graze);
    this.stateTime = 10;
  }

  /** ระหว่างรีดนม → ยืนนิ่ง */
  stand() {
    this.#decide(STATE.idle);
    this.stateTime = 5;
    this.speed = 0;
  }

  get dead() {
    return !!this.status && this.status.health <= 0;
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
      g.rotation.z = damp(g.rotation.z, 1.35, 2, dt);
      g.position.y = damp(g.position.y, 0.35, 2, dt);
      this.mixer?.stopAllAction();
      return;
    }
    g.rotation.z = damp(g.rotation.z, 0, 4, dt);
    g.position.y = damp(g.position.y, 0, 4, dt);

    this.stateTime -= dt;
    if (this.stateTime <= 0) this.#decide();

    let wantSpeed = 0;
    if (this.state === STATE.walk) {
      const dx = this.target.x - g.position.x;
      const dz = this.target.z - g.position.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.3) this.#decide(STATE.graze);
      else {
        const heading = Math.atan2(dx, dz);
        g.rotation.y += clamp(angleDelta(g.rotation.y, heading), -1.2 * dt, 1.2 * dt);
        const hungry = (this.status?.satiety ?? 100) < 20;
        wantSpeed = (hungry ? 0.35 : 0.6) * clamp(dist, 0, 1);
      }
    }
    this.speed = damp(this.speed, wantSpeed, 3, dt);
    g.position.x += Math.sin(g.rotation.y) * this.speed * dt;
    g.position.z += Math.cos(g.rotation.y) * this.speed * dt;

    if (this.mixer) {
      // ท่าจากไฟล์: เดิน (ความเร็วท่าตามความเร็วจริง) · เล็มหญ้า · ยืนพัก
      const moving = this.speed > 0.08;
      this.#playClip(moving ? STATE.walk : this.state === STATE.graze ? STATE.graze : STATE.idle);
      if (moving) this.actions.walk?.setEffectiveTimeScale(clamp(this.speed / WALK_CLIP_SPEED, 0.4, 1.6));
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
    const r = this.rnd();
    this.state = force ?? (r < 0.45 ? STATE.walk : r < 0.8 ? STATE.graze : STATE.idle);
    this.stateTime = this.state === STATE.walk ? 12 : 3 + this.rnd() * 6;
    if (this.state === STATE.walk) {
      const a = this.area;
      this.target.set(lerp(a.minX, a.maxX, this.rnd()), 0, lerp(a.minZ, a.maxZ, this.rnd()));
    }
  }
}
