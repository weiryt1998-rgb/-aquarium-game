import * as THREE from 'three';

/**
 * กิจวัตรประจำวันของตัวละครที่ผู้เล่นไม่ได้บังคับ (Person) — สุ่มทำทีละอย่าง เดินตามเส้นทาง (FarmNav) แล้วทำท่า:
 *   ดูแลวัว (เดินไปข้างวัวตัวหนึ่งในคอก ก้มดู) · เติมน้ำรางน้ำ · ยกฟางหน้าโรงนา · เข้าไปดูในโรงนา
 *   นั่งพัก (ยืนชมบ่อน้ำ บิดขี้เกียจ) · ยืนหน้าบ้าน · เดินเล่นรอบคอก
 * ผู้เล่นเดินเข้ามาใกล้ → หยุด หันมาโบกมือทักทาย (เว้นช่วงกันโบกถี่)
 */
const V = (x, z) => new THREE.Vector3(x, 0, z);

/** [ชื่อ, น้ำหนักการสุ่ม, จุดยืน, จุดที่หันหน้าไปหา, ท่า, เวลายืนต่อ (วิ)] */
const SPOTS = [
  ['trough', 2, V(6, -3.85), V(6, -5), 'tend', 2],
  ['hay', 2, V(7.9, -10.3), V(7.95, -11.6), 'tend', 2],
  ['barn', 1.5, V(0, -15.5), V(-3.4, -15.9), 'tend', 3],
  ['pond', 1.5, V(-17.0, 2.7), V(-18.6, -2.8), 'stretch', 8],
  ['porch', 1, V(-14.3, 10.5), V(-5, 6), 'stretch', 5],
];
/** จุดเดินเล่นในคอก/รอบคอก */
const STROLL = [V(-6, 4), V(6, 4), V(0, 0), V(-8.5, 0), V(8.5, 0), V(12.6, 0), V(6, 9.7), V(-6, 9.8), V(-6, -9.3)];

/** ยายเพ็ญ: แปลงผักข้างบ้าน · ลานหน้าบ้าน · ม้านั่งริมบ่อ · ประตูสวน (ดูหลานในคอก) */
export const PEN_SPOTS = [
  ['garden', 3, V(-21.2, 1.75), V(-21.2, 3.2), 'tend', 3],
  ['garden2', 2, V(-24.6, 1.75), V(-24.6, 3.2), 'tend', 3],
  ['yard', 2, V(-14.6, 7.3), V(-8, 6), 'stretch', 6],
  ['pond', 1.5, V(-16.6, 1.0), V(-18.6, -2.8), 'stretch', 9],
  ['gate', 1, V(-11.2, 9.0), V(-4, 4), 'wave', 4],
];
export const PEN_STROLL = [V(-14.6, 7.3), V(-13.3, 0), V(-18.6, 2.95), V(-11.8, 10.4), V(-6, 9.8), V(-23, 1.4)];

/** งานในบ้าน (systems/HouseLife.js): [เฟอร์นิเจอร์, กิจกรรม, น้ำหนักการสุ่ม] */
export const PEN_HOUSE = {
  bed: 'F_Bed_1',
  tasks: [['F_Stove_0', 'cook', 3], ['F_Sink_0', 'dishes', 2], ['F_DiningTable_0', 'eat', 1.5], ['F_TV_0', 'tv', 1.5], ['F_Armchair_0', 'sit', 1], ['F_Basin_0', 'wash', 0.6]],
};
export const MATE_HOUSE = {
  bed: 'F_Bed_0',
  tasks: [['F_TV_0', 'tv', 2.5], ['F_DiningTable_0', 'eat', 1.5], ['F_Fridge_0', 'snack', 1.5], ['F_Basin_0', 'wash', 1], ['F_Toilet_0', 'toilet', 0.7], ['F_Shower_0', 'shower', 0.8], ['F_Wardrobe_0', 'dress', 0.7], ['F_Sofa_0', 'sit', 1], ['F_Stove_0', 'cook', 0.8]],
};
/** กลางคืนตามเวลาเครื่อง (22:00–06:00) = เข้านอนเป็นส่วนใหญ่ */
const isNight = () => {
  const h = new Date().getHours();
  return h >= 22 || h < 6;
};

const WAVE_NEAR = 3.2;
const WAVE_COOLDOWN = 25;

export class PersonAI {
  /**
   * @param {import('./Person.js').Person} person
   * @param {{ nav: import('../world/farmNav.js').FarmNav, collide: (p: THREE.Vector3) => void,
   *   cows: () => THREE.Vector3[], player: () => import('./Person.js').Person | null, avoid: (h: number) => { heading: number, slow: number },
   *   spots?: typeof SPOTS, stroll?: THREE.Vector3[], cowChance?: number,
   *   house?: { bed: string, tasks: [string, string, number][], chance?: number, start: (person: any, furn: string, act: string, opts: object) => boolean } }} world
   *   spots/stroll = กิจวัตรเฉพาะคน (ไม่ระบุ = งานในฟาร์ม) · house = งานในบ้าน (นั่งดูทีวี ทำกับข้าว นอน …)
   */
  constructor(person, world) {
    this.p = person;
    this.w = world;
    this.spots = world.spots ?? SPOTS;
    this.stroll = world.stroll ?? STROLL;
    this.cowChance = world.cowChance ?? 0.35;
    this.house = world.house ?? null;
    /** 'idle' · 'walk' · 'face' · 'act' · 'greet' */
    this.state = 'idle';
    this.timer = 1.5 + Math.random() * 2;
    this.route = null;
    this.task = null;
    this.waveAt = -Infinity;
    this.time = 0;
  }

  /** เริ่มกิจวัตรใหม่ (เช่นหลังผู้เล่นสลับตัว) */
  reset(delay = 1.5) {
    this.p.cancelAct();
    this.state = 'idle';
    this.timer = delay;
    this.route = null;
    this.task = null;
  }

  update(dt) {
    this.time += dt;
    const p = this.p;
    const { collide } = this.w;

    // ผู้เล่นเดินมาใกล้ (และหันมาทางนี้) → ทักทาย
    const pl = this.w.player();
    if (pl && this.state !== 'greet' && this.state !== 'act' && this.time - this.waveAt > WAVE_COOLDOWN) {
      const d = pl.position.distanceTo(p.position);
      if (d < WAVE_NEAR) {
        this.waveAt = this.time;
        this.state = 'greet';
        this.greetFaced = false;
      }
    }

    switch (this.state) {
      case 'greet': {
        if (!this.greetFaced) {
          if (p.face(dt, pl?.position ?? p.position, collide) || !pl) {
            this.greetFaced = true;
            p.act('wave', () => this.#rest(1 + Math.random()));
          }
        } else p.stand(dt, collide);
        break;
      }
      case 'walk': {
        const r = this.route;
        const last = r.i >= r.points.length - 1;
        if (p.walkToward(dt, r.points[r.i], collide, { reach: last ? 0.25 : 0.55, avoid: this.w.avoid })) {
          if (last) this.#arrive();
          else r.i++;
        }
        // ติดอยู่นานเกิน (ถูกวัวขวางทาง) → เลิกงานนี้
        this.timer -= dt;
        if (this.timer <= 0) this.#rest(1);
        break;
      }
      case 'face': {
        if (p.face(dt, this.task.look, collide)) {
          this.state = 'act';
          p.act(this.task.act, () => this.#rest(this.task?.hold ?? 2));
        }
        break;
      }
      case 'act':
        p.stand(dt, collide);
        break;
      default:
        p.stand(dt, collide);
        this.timer -= dt;
        if (this.timer <= 0) this.#next();
    }
  }

  #rest(t) {
    this.state = 'idle';
    this.timer = t + Math.random() * 2;
    this.task = null;
    this.route = null;
  }

  /** เลือกกิจกรรมถัดไป */
  #next() {
    if (this.house && this.#houseTask()) return;
    const cows = this.w.cows();
    const r = Math.random();
    let task = null;
    if (cows.length && r < this.cowChance && this.lastSpot !== 'cow') {
      this.lastSpot = 'cow';
      // ดูแลวัว: ยืนข้างวัวห่าง ~1.1 ม. ฝั่งที่ใกล้ตัว
      const cow = cows[Math.floor(Math.random() * cows.length)];
      const side = new THREE.Vector3().subVectors(this.p.position, cow).setY(0);
      if (side.lengthSq() < 0.01) side.set(1, 0, 0);
      side.setLength(1.15);
      task = { at: cow.clone().add(side), look: cow.clone(), act: 'tend', hold: 2.5, cow: true };
    } else if (r < 0.8) {
      // ไม่ทำที่เดิมซ้ำติดกัน
      const pool = this.spots.filter((x) => x[0] !== this.lastSpot);
      const total = pool.reduce((s, x) => s + x[1], 0);
      let k = Math.random() * total;
      const s = pool.find((x) => (k -= x[1]) < 0) ?? pool[0];
      this.lastSpot = s[0];
      task = { at: s[2], look: s[3], act: s[4], hold: s[5] };
    } else {
      this.lastSpot = 'stroll';
      const s = this.stroll[Math.floor(Math.random() * this.stroll.length)];
      task = { at: s, look: null, act: null, hold: 2 + Math.random() * 4 };
    }
    const path = this.w.nav.path(this.p.position, task.at);
    if (!path) {
      this.#rest(1);
      return;
    }
    this.task = task;
    this.route = { points: path, i: 0 };
    this.state = 'walk';
    this.timer = 12 + path.reduce((s, q, i) => s + q.distanceTo(i ? path[i - 1] : this.p.position), 0) / 0.8;
  }

  /** งานในบ้าน: กลางคืน = นอน (ส่วนใหญ่) · กลางวัน = สุ่มตามน้ำหนัก (~40% ของกิจวัตร) · ระบบกิจกรรมพาเดิน/ทำท่าเอง เสร็จแล้วค่อยเลือกต่อ */
  #houseTask() {
    const h = this.house;
    const night = isNight();
    let furn;
    let act;
    let duration = null;
    if (night && Math.random() < 0.75) {
      furn = h.bed;
      act = 'sleep';
      duration = 150 + Math.random() * 120;
    } else if (Math.random() < (night ? 0.8 : (h.chance ?? 0.4))) {
      const pool = h.tasks.filter((x) => x[0] + x[1] !== this.lastSpot);
      const total = pool.reduce((sum, x) => sum + x[2], 0);
      let k = Math.random() * total;
      [furn, act] = pool.find((x) => (k -= x[2]) < 0) ?? pool[0];
    } else return false;
    if (!h.start(this.p, furn, act, { duration, onDone: () => this.#rest(2 + Math.random() * 3) })) return false;
    this.lastSpot = furn + act;
    this.state = 'house';
    this.task = null;
    this.route = null;
    return true;
  }

  #arrive() {
    const t = this.task;
    this.route = null;
    if (t?.act && t.look) this.state = 'face';
    else this.#rest(t?.hold ?? 2);
  }
}
