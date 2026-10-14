import { CONFIG } from '../config.js';
import { WATER_STAGES } from '../sim/water.ts';
import { formatDuration } from '../utils/math.js';

/** ไม่แจ้งเรื่องเดียวกันถี่กว่านี้ (วินาทีจริง) — ปลาหลายตัวหิวพร้อมกันจะรวมเป็นข้อความเดียว */
const HUNGRY_GAP = 60;

/**
 * แจ้งเตือนผู้เล่นจากเหตุการณ์ของ Simulation Engine (อาการปลา สภาพน้ำ)
 * ไล่ระดับ: หิว (ข้อมูล) → อดอาหาร/ป่วย (เตือน) → อาการหนัก (ด่วน + บอกเวลาที่เหลือ + เตือนซ้ำเป็นระยะ) → หายดี
 * ทุกข้อความบอกวิธีแก้ เพื่อให้ผู้เล่นมีเวลาและรู้ว่าต้องทำอะไร
 */
export class AlertSystem {
  constructor(game) {
    this.game = game;
    this.time = 0;
    this.lastHungry = -Infinity;
    this.reminderAt = Infinity;
    /** อาการที่รอรวมแจ้งเตือนในเฟรมนี้ */
    this.pending = [];
  }

  /** เริ่มตู้ใหม่ (โหลดเกม / ย้ายตู้) — ถ้ามีปลาอาการหนักอยู่แล้วให้เตือนทันที */
  reset() {
    this.pending = [];
    this.lastHungry = -Infinity;
    this.reminderAt = this.#critical().length ? this.time + 3 : Infinity;
  }

  /** @param {import('../sim/types.ts').SimEvent} e */
  handle(e) {
    if (e.type === 'condition') this.pending.push(e);
    else if (e.type === 'water') this.#water(e);
  }

  update(dt) {
    this.time += dt;
    if (this.pending.length) this.#flushConditions();
    if (this.time >= this.reminderAt) this.#remind();
  }

  #flushConditions() {
    const sim = this.game.sim;
    const byCondition = new Map();
    for (const e of this.pending) {
      // อาการเปลี่ยนหลายครั้งในเฟรมเดียว → ใช้ค่าล่าสุด และข้ามปลาที่ไม่อยู่แล้ว
      if (sim.condition(e.fishId) !== e.condition) continue;
      const fish = this.game.fish.getById(e.fishId);
      if (!fish || fish.dying) continue;
      const better = rank(e.condition) < rank(e.previous);
      // หายป่วย = จากป่วย/อาการหนัก กลับมาเป็นปกติหรือแค่หิว
      const key = better ? (rank(e.previous) >= rank('sick') && rank(e.condition) <= rank('hungry') ? 'recovered' : null) : e.condition;
      if (!key) continue;
      if (!byCondition.has(key)) byCondition.set(key, []);
      byCondition.get(key).push({ fish, e });
    }
    this.pending = [];

    const names = (list) => (list.length === 1 ? `"${list[0].fish.data.name}" ` : `ปลา ${list.length} ตัว`);
    const critical = byCondition.get('critical');
    if (critical) {
      this.#criticalToast(critical.map((c) => c.fish));
      this.game.sound.play('error');
    }
    const sick = byCondition.get('sick');
    if (sick) this.game.ui.toast(`🤒 ${names(sick)}ป่วย (สุขภาพต่ำกว่า ${CONFIG.care.sickBelow}%) — ${this.#fixHint(sick.map((c) => c.fish))} หรือใช้ยา 💊`, 'warn');
    const starving = byCondition.get('starving');
    if (starving) this.game.ui.toast(`⚠️ ${names(starving)}ไม่ได้กินอาหารนาน สุขภาพเริ่มลดลง — โรยอาหารด่วน 🥣`, 'warn');
    const hungry = byCondition.get('hungry');
    if (hungry && this.time - this.lastHungry > HUNGRY_GAP) {
      this.lastHungry = this.time;
      this.game.ui.toast(`🍽️ ${names(hungry)}หิวแล้ว — โรยอาหารได้เลย`);
    }
    const recovered = byCondition.get('recovered');
    if (recovered) this.game.ui.toast(`💚 ${names(recovered)}อาการดีขึ้นแล้ว`, 'success');

    this.reminderAt = this.#critical().length ? Math.min(this.reminderAt, this.time + CONFIG.care.alertReminder) : Infinity;
  }

  #critical() {
    if (!this.game.sim) return [];
    return this.game.sim.fishIn('critical').map((r) => this.game.fish.getById(r.id)).filter((f) => f && !f.dying);
  }

  #remind() {
    const list = this.#critical();
    if (!list.length) {
      this.reminderAt = Infinity;
      return;
    }
    this.#criticalToast(list);
    this.reminderAt = this.time + CONFIG.care.alertReminder;
  }

  #criticalToast(list) {
    const sim = this.game.sim;
    const left = Math.min(...list.map((f) => sim.secondsLeft(f.id) ?? Infinity));
    const who = list.length === 1 ? `"${list[0].data.name}" (${list[0].species.name}) ` : `ปลา ${list.length} ตัว`;
    const time = Number.isFinite(left) ? ` เหลือเวลาประมาณ ${formatDuration(left / CONFIG.timeScale)}` : '';
    this.game.ui.toast(`🚨 ${who}อาการหนัก!${time} — ใช้ยา 💊 ทันที แล้ว${this.#fixHint(list)}`, 'warn');
  }

  /** บอกสาเหตุที่ต้องแก้: หิว / น้ำสกปรก */
  #fixHint(list) {
    const sim = this.game.sim;
    const hungry = list.some((f) => sim.causes(f.id).hungry);
    const dirty = list.some((f) => sim.causes(f.id).dirtyWater);
    const fixes = [hungry && 'ให้อาหาร 🥣', dirty && 'ทำความสะอาดตู้ 🧽'].filter(Boolean);
    return fixes.length ? fixes.join(' และ') : 'ดูแลให้อิ่มและน้ำสะอาด';
  }

  /** แจ้งเมื่อน้ำสกปรกลงถึงขั้นใหม่ (ไม่แจ้งตอนน้ำใสขึ้น) */
  #water(e) {
    if (e.stage <= e.previous || e.previous < 0) return;
    const info = WATER_STAGES[e.stage];
    if (info.warn && this.game.fish.count > 0) this.game.ui.toast(info.warn, e.stage >= 2 ? 'warn' : 'info');
  }
}

const ORDER = ['healthy', 'hungry', 'starving', 'sick', 'critical'];
const rank = (c) => ORDER.indexOf(c);
