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

const WAVE_NEAR = 3.2;
const WAVE_COOLDOWN = 25;

export class PersonAI {
  /**
   * @param {import('./Person.js').Person} person
   * @param {{ nav: import('../world/farmNav.js').FarmNav, collide: (p: THREE.Vector3) => void,
   *   cows: () => THREE.Vector3[], player: () => import('./Person.js').Person | null, avoid: (h: number) => { heading: number, slow: number } }} world
   */
  constructor(person, world) {
    this.p = person;
    this.w = world;
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
    const cows = this.w.cows();
    const r = Math.random();
    let task = null;
    if (cows.length && r < 0.35 && this.lastSpot !== 'cow') {
      this.lastSpot = 'cow';
      // ดูแลวัว: ยืนข้างวัวห่าง ~1.1 ม. ฝั่งที่ใกล้ตัว
      const cow = cows[Math.floor(Math.random() * cows.length)];
      const side = new THREE.Vector3().subVectors(this.p.position, cow).setY(0);
      if (side.lengthSq() < 0.01) side.set(1, 0, 0);
      side.setLength(1.15);
      task = { at: cow.clone().add(side), look: cow.clone(), act: 'tend', hold: 2.5, cow: true };
    } else if (r < 0.8) {
      // ไม่ทำที่เดิมซ้ำติดกัน
      const pool = SPOTS.filter((x) => x[0] !== this.lastSpot);
      const total = pool.reduce((s, x) => s + x[1], 0);
      let k = Math.random() * total;
      const s = pool.find((x) => (k -= x[1]) < 0) ?? pool[0];
      this.lastSpot = s[0];
      task = { at: s[2], look: s[3], act: s[4], hold: s[5] };
    } else {
      this.lastSpot = 'stroll';
      const s = STROLL[Math.floor(Math.random() * STROLL.length)];
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

  #arrive() {
    const t = this.task;
    this.route = null;
    if (t?.act && t.look) this.state = 'face';
    else this.#rest(t?.hold ?? 2);
  }
}
