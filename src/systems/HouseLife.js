import * as THREE from 'three';
import { angleDelta, clamp } from '../utils/math.js';

/**
 * กิจกรรมในบ้าน (แบบเกมจำลองชีวิต): ตัวละคร (Person) เดินไปที่เฟอร์นิเจอร์ → หันหน้า → ขยับเข้าที่ → ท่าเริ่ม → ท่าวน → ท่าจบ → ถอยออก
 * ใช้ทั้งผู้เล่น (แตะเฟอร์นิเจอร์ → เมนู) และตัวละคร AI (PersonAI ส่งงานมา) · จุดใช้งานมาจาก home.glb (House.furniture[].spots)
 *
 * kind:
 *   sit    = นั่ง (SitDown → Sit วน → SitUp) · สะโพกตอนนั่งอยู่หลังจุดยืน SIT_BACK ม. → วางจุดยืนหน้าจุดนั่ง
 *   lie    = นั่งขอบเตียง → เอนตัวลงนอน (Sleep วน) → ลุกนั่ง → ยืน
 *   work   = ยืนทำงานหน้าเคาน์เตอร์/อ่าง (Work วน)
 *   shower = ยืนในห้องอาบน้ำ (Shower ครั้งเดียว ~9 วิ)
 *   tank   = เดินไปหน้าตู้ปลา → เข้าโหมดเลี้ยงปลา (FarmSystem)
 */
export const ACTIVITIES = {
  tv: { label: 'ดูทีวี', icon: '📺', kind: 'sit', loop: 24, tv: true, bubble: '📺 ดูทีวี' },
  sit: { label: 'นั่งพัก', icon: '🛋️', kind: 'sit', loop: 10, bubble: '😌' },
  eat: { label: 'นั่งกินข้าว', icon: '🍚', kind: 'sit', loop: 12, bubble: '🍚 อร่อยจัง' },
  sleep: { label: 'นอนหลับ', icon: '😴', kind: 'lie', loop: 40, bubble: '💤' },
  nap: { label: 'งีบสักพัก', icon: '🛏️', kind: 'lie', loop: 14, bubble: '💤' },
  cook: { label: 'ทำกับข้าว', icon: '🍳', kind: 'work', loop: 12, bubble: '🍳 ทำกับข้าว' },
  dishes: { label: 'ล้างจาน', icon: '🍽️', kind: 'work', loop: 8, bubble: '🫧 ล้างจาน' },
  snack: { label: 'หาของกินในตู้เย็น', icon: '🍉', kind: 'work', loop: 3, bubble: '🍉 หิวจัง' },
  toilet: { label: 'เข้าห้องน้ำ', icon: '🚽', kind: 'sit', loop: 6, bubble: '🚽' },
  shower: { label: 'อาบน้ำ', icon: '🚿', kind: 'shower', bubble: '🚿 อาบน้ำ' },
  wash: { label: 'ล้างหน้า แปรงฟัน', icon: '🪥', kind: 'work', loop: 6, bubble: '🪥' },
  dress: { label: 'เปลี่ยนชุด', icon: '👕', kind: 'work', loop: 3.5, bubble: '👕 เปลี่ยนชุด' },
  tank: { label: 'ดูตู้ปลา / ให้อาหารปลา', icon: '🐠', kind: 'tank' },
};

/**
 * เฟอร์นิเจอร์แต่ละชนิด: ชื่อ ไอคอน กิจกรรม (ตัวแรก = ค่าเริ่มต้น)
 * seatY = ยกตัวตอนนั่ง · seatFwd = นั่งค่อนมาข้างหน้า (ม.) — วัดด้วย test-results/debug-seat.mjs: นับจุดเมชที่จมในเฟอร์นิเจอร์ = 0
 * (โซฟา/เก้าอี้นวมเบาะลึก: นั่งตรงจุดเดิมแล้วหน้าแข้งทะลุหน้าเบาะ) · ตัวละครแต่ละคนยกเพิ่มอีก PEOPLE[key].sitLift
 */
export const FURNITURE = {
  Sofa: { label: 'โซฟา', icon: '🛋️', acts: ['tv', 'sit'], seatY: 0.1, seatFwd: 0.18 },
  Armchair: { label: 'เก้าอี้นวม', icon: '💺', acts: ['sit', 'tv'], seatY: 0.1, seatFwd: 0.2 },
  TV: { label: 'ทีวี', icon: '📺', acts: ['tv'], via: ['F_Sofa_0', 'F_Armchair_0'] },
  Chair: { label: 'เก้าอี้', icon: '🪑', acts: ['eat', 'sit'], seatY: 0.12 },
  DiningTable: { label: 'โต๊ะกินข้าว', icon: '🍽️', acts: ['eat'], via: ['F_Chair_0', 'F_Chair_1', 'F_Chair_2', 'F_Chair_3'] },
  Bed: { label: 'เตียง', icon: '🛏️', acts: ['sleep', 'nap'], seatY: 0.1 },
  Stove: { label: 'เตา', icon: '🍳', acts: ['cook'] },
  Sink: { label: 'อ่างล้างจาน', icon: '🚰', acts: ['dishes'] },
  Fridge: { label: 'ตู้เย็น', icon: '🧊', acts: ['snack'] },
  Toilet: { label: 'ส้วม', icon: '🚽', acts: ['toilet'], seatY: 0.08 },
  Shower: { label: 'ฝักบัว', icon: '🚿', acts: ['shower'] },
  Basin: { label: 'อ่างล้างหน้า', icon: '🪥', acts: ['wash'] },
  Wardrobe: { label: 'ตู้เสื้อผ้า', icon: '👕', acts: ['dress'] },
  FishTank: { label: 'ตู้ปลา', icon: '🐠', acts: ['tank'] },
};

/** สะโพกตอนนั่งอยู่หลังจุดยืนเท่านี้ (ม. · วัดจากท่า SitDown/Sit ทุกตัวละคร ~0.12) */
const SIT_BACK = 0.12;
/** ท่านอน: ทิศศีรษะเทียบทิศหันหน้าของตัวละคร (เรเดียน · วัดจากท่า Sleep: หัวอยู่ซ้ายหลัง) */
const LIE_HEAD = -2.47;
const MATTRESS_Y = 0.52;
const V = () => new THREE.Vector3();

export class HouseLife {
  /**
   * @param {{ house: () => import('../world/House.js').House | null, nav: () => import('../world/farmNav.js').FarmNav | null,
   *   collide: (p: THREE.Vector3) => void, blocked?: (p: THREE.Vector3) => boolean, bubble: (key: string, text: string, duration: number) => void, onTank: () => void }} world
   */
  constructor(world) {
    this.w = world;
    /** @type {Map<string, any>} key → งานที่ทำอยู่ */
    this.jobs = new Map();
  }

  drives(key) {
    return this.jobs.has(key);
  }

  jobOf(key) {
    return this.jobs.get(key) ?? null;
  }

  /** กิจกรรมที่เฟอร์นิเจอร์นี้ทำได้ → [{ id, label, icon }] */
  actionsFor(furnName) {
    const f = this.w.house()?.furniture.get(furnName);
    if (!f) return [];
    const def = FURNITURE[f.type];
    if (!def) return [];
    let acts = def.acts;
    if (furnName === 'F_Chair_4') acts = ['sit']; // เก้าอี้โต๊ะทำงาน
    return acts.map((id) => ({ id, ...ACTIVITIES[id] }));
  }

  /** ป้ายเฟอร์นิเจอร์ */
  info(furnName) {
    const f = this.w.house()?.furniture.get(furnName);
    return f ? FURNITURE[f.type] ?? null : null;
  }

  /** เลือกจุดใช้งานที่ว่าง (เฟอร์นิเจอร์ที่ใช้ผ่านชิ้นอื่น เช่น ทีวี → โซฟา) ใกล้คนที่สุด */
  #pickSpot(person, furnName, prefer = null) {
    const house = this.w.house();
    const f = house?.furniture.get(furnName);
    if (!f) return null;
    const def = FURNITURE[f.type] ?? {};
    const names = def.via ?? [furnName];
    let best = null;
    for (const n of names) {
      const ff = house.furniture.get(n);
      if (!ff) continue;
      ff.spots.forEach((s, i) => {
        if (!s || (s.taken && s.taken !== person.key)) return;
        let d = s.pos.distanceTo(person.position);
        if (prefer != null && i === prefer && n === furnName) d -= 100;
        if (!best || d < best.d) best = { d, furn: ff, name: n, spot: s, index: i };
      });
    }
    return best;
  }

  /**
   * เริ่มกิจกรรม actId ที่เฟอร์นิเจอร์ furnName (เดินไปเอง)
   * @param {import('../entities/Person.js').Person} person
   * @param {{ onDone?: () => void, duration?: number, prefer?: number }} [opts] prefer = จุดใช้งานที่อยากได้ (เช่นฝั่งเตียงของตัวเอง)
   * @returns {boolean} เริ่มได้ไหม (จุดเต็ม/ไม่มี = ไม่ได้)
   */
  start(person, furnName, actId, { onDone = null, duration = null, prefer = null } = {}) {
    const act = ACTIVITIES[actId];
    if (!act) return false;
    this.cancel(person.key, true);
    const pick = this.#pickSpot(person, furnName, prefer);
    if (!pick) return false;
    const { spot, furn } = pick;
    const fwd = (h) => new THREE.Vector3(Math.sin(h), 0, Math.cos(h));
    const job = { person, act, actId, spot, furn, phase: 'walk', t: 0, onDone, loop: duration ?? act.loop ?? 5, exitWanted: false };
    const seatY = (FURNITURE[furn.type]?.seatY ?? 0) + (person.def.sitLift ?? 0);
    const seatFwd = (FURNITURE[furn.type]?.seatFwd ?? 0) + (person.def.sitFwd ?? 0);
    if (act.kind === 'sit') {
      job.heading = spot.heading;
      job.root = spot.pos.clone().addScaledVector(fwd(spot.heading), SIT_BACK + seatFwd);
      job.approach = spot.pos.clone().addScaledVector(fwd(spot.heading), 0.62);
      job.y = seatY;
    } else if (act.kind === 'lie') {
      // นั่งขอบเตียงฝั่งของจุดนั้น (หันออกนอกเตียง) แล้วเอนลงนอน
      const out = spot.pos.clone().sub(furn.node.getWorldPosition(V())).setY(0);
      const side = out.clone().sub(fwd(spot.heading).multiplyScalar(out.dot(fwd(spot.heading)))).normalize();
      const edge = spot.pos.clone().addScaledVector(side, 0.42);
      job.heading = Math.atan2(side.x, side.z);
      job.root = edge.clone().addScaledVector(side, SIT_BACK);
      job.approach = edge.clone().addScaledVector(side, 0.62);
      job.y = seatY;
      job.lieRoot = spot.pos.clone();
      job.lieHeading = spot.heading - LIE_HEAD;
    } else if (act.kind === 'shower') {
      job.heading = spot.heading;
      job.root = spot.pos.clone();
      job.approach = spot.pos.clone().addScaledVector(fwd(spot.heading), -0.95);
      job.y = 0;
    } else {
      // work / tank: ยืนที่จุดใช้งานเลย
      job.heading = spot.heading;
      job.root = spot.pos.clone();
      job.approach = spot.pos.clone();
      job.y = 0;
    }
    // จุดเข้าหาชนของ (เช่นหน้าเก้าอี้ = ใต้โต๊ะกินข้าว) → เข้าทางข้าง/หลังแทน
    if (this.w.blocked?.(job.approach)) {
      // วัดจากจุดใช้งานของเฟอร์นิเจอร์ (ไม่ใช่จุดนั่งที่เลื่อนมาข้างหน้าแล้ว — เลื่อนเข้าใต้โต๊ะ)
      const found = [0.62, 0.8].some((d) =>
        [Math.PI / 2, -Math.PI / 2, Math.PI * 0.75, -Math.PI * 0.75, Math.PI].some((da) => {
          const q = spot.pos.clone().addScaledVector(fwd(job.heading + da), d);
          if (this.w.blocked(q)) return false;
          job.approach = q;
          return true;
        }),
      );
      if (!found) job.approach = spot.pos.clone().addScaledVector(fwd(job.heading), 0.62);
    }
    const nav = this.w.nav();
    job.route = { points: nav?.path(person.position, job.approach) ?? [job.approach], i: 0 };
    const len = job.route.points.reduce((s, q, i) => s + q.distanceTo(i ? job.route.points[i - 1] : person.position), 0);
    job.timeout = 8 + (len / Math.max(0.5, person.def.clip.walk)) * 1.8;
    spot.taken = person.key;
    person.cancelAct();
    this.jobs.set(person.key, job);
    return true;
  }

  /** ขอเลิก (ผู้เล่นขยับ): ถ้านั่ง/นอนอยู่ = ลุกก่อน · ยังเดินอยู่ = เลิกทันที */
  requestExit(key) {
    const j = this.jobs.get(key);
    if (!j) return;
    if (j.phase === 'walk' || j.phase === 'face') this.cancel(key, false);
    else j.exitWanted = true;
  }

  /** เลิกทันที (immediate = วางตัวยืนข้างเฟอร์นิเจอร์เลย ไม่เล่นท่าลุก) */
  cancel(key, immediate = true) {
    const j = this.jobs.get(key);
    if (!j) return;
    this.jobs.delete(key);
    j.spot.taken = null;
    const p = j.person;
    if (j.act.tv) this.#tvCheck();
    if (immediate || j.phase !== 'walk') {
      p.group.position.y = 0;
      if (j.phase !== 'walk' && j.phase !== 'face') p.group.position.copy(j.approach).setY(0);
    }
    p.cancelAct();
    j.onDone?.(false);
  }

  #tvCheck() {
    const anyTV = [...this.jobs.values()].some((x) => x.act.tv && (x.phase === 'loop' || x.phase === 'enter'));
    this.w.house()?.setTV(anyTV);
  }

  #next(j, phase) {
    j.phase = phase;
    j.t = 0;
  }

  update(dt) {
    for (const [key, j] of [...this.jobs]) this.#step(key, j, dt);
  }

  #step(key, j, dt) {
    const p = j.person;
    const g = p.group;
    j.t += dt;
    switch (j.phase) {
      case 'walk': {
        const r = j.route;
        const last = r.i >= r.points.length - 1;
        // ช่วงท้าย: ใกล้พอแล้วเลื่อนเข้าที่เอง (จุดเข้าหาบางจุดชิดของจนเดินด้วยระบบชนไปไม่ถึงพอดี)
        if (p.walkToward(dt, r.points[r.i], this.w.collide, { reach: last ? 0.4 : 0.45 })) {
          if (last) this.#next(j, 'face');
          else r.i++;
        }
        // ช่วงสุดท้ายติดของ (ขยับไม่ได้ ~1.2 วิ) แต่ใกล้จุดนั่งแล้ว → เลื่อนเข้าที่เลย ไม่ยกเลิก
        if (last && p.position.distanceTo(j.root) < 1.1) {
          j.stuck = (j.lastPos && p.position.distanceTo(j.lastPos) < 0.004) ? (j.stuck ?? 0) + dt : 0;
          j.lastPos = p.position.clone();
          if (j.stuck > 1.2) this.#next(j, 'face');
        }
        if (j.t > j.timeout) this.cancel(key, false);
        return;
      }
      case 'face': {
        // หันหน้า + ขยับเข้าที่ (ไม่ชนเฟอร์นิเจอร์ — จุดนั่งอยู่ในกล่องชน)
        const off = angleDelta(g.rotation.y, j.heading);
        g.rotation.y += clamp(off, -5 * dt, 5 * dt);
        const k = 1 - Math.exp(-8 * dt);
        g.position.x += (j.root.x - g.position.x) * k;
        g.position.z += (j.root.z - g.position.z) * k;
        p.stand(dt, null);
        if ((Math.abs(off) < 0.08 && g.position.distanceTo(j.root) < 0.04) || j.t > 1.6) {
          g.rotation.y = j.heading;
          g.position.set(j.root.x, 0, j.root.z);
          this.#enter(j);
        }
        return;
      }
      case 'enter':
      case 'exit':
      case 'liedown':
      case 'getup':
        // ยกตัวขึ้นเบาะ/ลงพื้นระหว่างนั่งลง-ลุก
        if (j.phase === 'enter' && j.act.kind !== 'work' && j.act.kind !== 'tank') g.position.y = j.y * clamp(j.t / 0.5, 0, 1);
        if (j.phase === 'exit' && j.act.kind !== 'work') g.position.y = j.y * (1 - clamp((j.t - 0.6) / 0.4, 0, 1));
        if (j.phase === 'liedown' || j.phase === 'getup') this.#lieBlend(j, dt);
        p.stand(dt, null);
        return;
      case 'loop':
        p.stand(dt, null);
        if (j.exitWanted || j.t >= j.loop) {
          j.exitWanted = false;
          this.#exit(j);
        }
        return;
      case 'leave': {
        const k = 1 - Math.exp(-7 * dt);
        g.position.x += (j.approach.x - g.position.x) * k;
        g.position.z += (j.approach.z - g.position.z) * k;
        g.position.y = 0;
        p.stand(dt, null);
        if (g.position.distanceTo(j.approach) < 0.05 || j.t > 0.8) this.#finish(key, j);
        return;
      }
      default:
        p.stand(dt, null);
    }
  }

  #enter(j) {
    const p = j.person;
    const a = j.act;
    if (a.bubble) this.w.bubble(p.key, a.bubble, Math.min(a.kind === 'shower' ? 9 : j.loop, 8));
    if (a.kind === 'tank') {
      this.#next(j, 'loop');
      j.loop = 0.4;
      return;
    }
    if (a.kind === 'work') {
      this.#next(j, 'loop');
      p.act('work', null, { duration: j.loop + 1 });
      return;
    }
    if (a.kind === 'shower') {
      this.#next(j, 'enter');
      p.act('shower', () => this.#exit(j));
      return;
    }
    // sit / lie: นั่งลงก่อน
    this.#next(j, 'enter');
    if (a.tv) this.w.house()?.setTV(true);
    p.act('sitdown', () => {
      if (!this.jobs.has(p.key)) return;
      if (a.kind === 'lie') {
        this.#next(j, 'liedown');
        j.blend = 0;
        p.act('sleep', null, { duration: 9999 });
        return;
      }
      this.#next(j, 'loop');
      p.act('sit', null, { duration: 9999 });
    });
  }

  /** เอนลงนอน / ลุกนั่ง: เลื่อนตัวจากขอบเตียงไปกลางที่นอน + หมุน + ยกขึ้นระดับที่นอน */
  #lieBlend(j, dt) {
    const g = j.person.group;
    const T = 0.9;
    const t = clamp(j.t / T, 0, 1);
    const s = t * t * (3 - 2 * t);
    const w = j.phase === 'liedown' ? s : 1 - s;
    g.position.x = THREE.MathUtils.lerp(j.root.x, j.lieRoot.x, w);
    g.position.z = THREE.MathUtils.lerp(j.root.z, j.lieRoot.z, w);
    g.position.y = THREE.MathUtils.lerp(j.y, MATTRESS_Y, w);
    g.rotation.y = j.heading + angleDelta(j.heading, j.lieHeading) * w;
    if (t >= 1) {
      if (j.phase === 'liedown') this.#next(j, 'loop');
      else {
        // กลับมานั่งขอบเตียงแล้ว → ลุก
        this.#next(j, 'exit');
        j.person.act('situp', () => this.#leave(j));
      }
    }
  }

  #exit(j) {
    const p = j.person;
    const a = j.act;
    if (a.kind === 'tank') {
      this.#finish(p.key, j);
      this.w.onTank(p);
      return;
    }
    if (a.kind === 'work' || a.kind === 'shower') {
      p.cancelAct();
      this.#leave(j);
      return;
    }
    if (a.kind === 'lie') {
      this.#next(j, 'getup');
      p.act('sit', null, { duration: 9999 });
      return;
    }
    this.#next(j, 'exit');
    p.act('situp', () => this.#leave(j));
  }

  #leave(j) {
    if (!this.jobs.has(j.person.key)) return;
    j.spot.taken = null;
    if (j.act.tv) {
      j.act = { ...j.act, tv: false };
      this.#tvCheck();
    }
    if (j.act.kind === 'work' || j.act.kind === 'tank') return this.#finish(j.person.key, j);
    this.#next(j, 'leave');
  }

  #finish(key, j) {
    if (this.jobs.get(key) !== j) return;
    this.jobs.delete(key);
    j.spot.taken = null;
    j.person.group.position.y = 0;
    j.person.cancelAct();
    this.#tvCheck();
    j.onDone?.(true);
  }
}
