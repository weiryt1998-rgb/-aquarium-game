import { FishAgent } from './FishAgent.ts';
import type { AgentInit } from './FishAgent.ts';
import { SpatialGrid } from './grid.ts';
import type { AIWorld, Cover, FoodItem, SpeciesMotion } from './types.ts';
import { Vec3 } from './vec.ts';
import type { Vec3Like } from './vec.ts';

/**
 * Fish Life AI ของตู้ 1 ใบ — TypeScript ล้วน ไม่มี Three.js (ฝั่งเรนเดอร์อ่านตำแหน่ง/ทิศของ agent ไปวาดเอง)
 *
 *   const ai = new FishAI(world);
 *   ai.add(id, species, { x, y, z });
 *   ทุกเฟรม: ai.update(dtจริง) → คำนวณเป็นจังหวะคงที่ STEP (30 ครั้ง/วินาที) ไม่ขึ้นกับ FPS
 *            ฝั่งเรนเดอร์ใช้ ai.alpha เกลี่ยตำแหน่งระหว่างจังหวะ (ภาพลื่นแม้จอ 144Hz)
 *
 * ประสิทธิภาพ: หาเพื่อนบ้านผ่าน Spatial Grid, การตัดสินใจกระจายกันคนละจังหวะ, ไม่สร้าง object ใหม่ในลูป
 */
export class FishAI {
  static readonly STEP = 1 / 30;
  /** กันเกมค้างตอนแท็บกลับมาหลังพักนาน */
  static readonly MAX_STEPS = 4;

  world: AIWorld;
  readonly agents: FishAgent[] = [];
  private readonly byId = new Map<string, FishAgent>();
  private readonly grid = new SpatialGrid<FishAgent>(2);
  private readonly near: FishAgent[] = [];
  /** จำนวนปลาที่กำลังเล็งอาหารแต่ละเม็ด (ไม่ให้แห่ไปเม็ดเดียวกัน) */
  private readonly claims = new Map<FoodItem, number>();
  readonly random: () => number;
  private acc = 0;
  /** สัดส่วนระหว่างจังหวะก่อนหน้า → ปัจจุบัน (0..1) สำหรับเกลี่ยภาพ */
  alpha = 1;
  time = 0;

  constructor(world: AIWorld, { random = Math.random }: { random?: () => number } = {}) {
    this.world = world;
    this.random = random;
  }

  add(id: string, species: SpeciesMotion, init: AgentInit): FishAgent {
    this.remove(id);
    const agent = new FishAgent(id, species, init, this.random);
    this.agents.push(agent);
    this.byId.set(id, agent);
    return agent;
  }

  remove(id: string): void {
    const agent = this.byId.get(id);
    if (!agent) return;
    this.byId.delete(id);
    this.agents.splice(this.agents.indexOf(agent), 1);
  }

  get(id: string): FishAgent | undefined {
    return this.byId.get(id);
  }

  /** ย้ายปลาไปตำแหน่งใหม่ทันที (ปลาลงตู้ ลูกเกิด) ไม่เกลี่ยภาพจากตำแหน่งเดิม */
  place(id: string, p: Vec3Like, velocity?: Vec3Like): void {
    const a = this.byId.get(id);
    if (!a) return;
    a.pos.copy(p);
    a.prevPos.copy(p);
    a.target.copy(p);
    if (velocity) {
      const s = Math.hypot(velocity.x, velocity.y, velocity.z);
      if (s > 1e-4) {
        a.heading.set(velocity.x / s, velocity.y / s, velocity.z / s);
        a.prevHeading.copy(a.heading);
        a.speed = s;
        a.vel.copy(velocity);
      }
    }
  }

  /** สิ่งรบกวน (ทำความสะอาด ปลาใหม่ ให้อาหาร) — ปลาใกล้จุดนั้นตกใจมาก ไกลออกไปตกใจน้อยลง */
  startle(at: Vec3Like | null, amount: number, radius = 6): void {
    for (const a of this.agents) {
      const k = at ? Math.max(0, 1 - Math.sqrt(a.pos.distanceSq(at)) / radius) : 1;
      if (k > 0) a.startle(amount * k);
    }
  }

  /**
   * มีคนโรยอาหาร: ปลาที่หิวในรัศมีได้ยิน/เห็นแรงกระเพื่อมที่ผิวน้ำ → หันมามองหาอาหารทันที (มองได้ไกลขึ้นชั่วครู่)
   * ปลาขี้อายตกใจเล็กน้อยก่อน แล้วค่อยตามมากินเมื่อหิว
   */
  notifyFood(at: Vec3Like, radius = 9): void {
    for (const a of this.agents) {
      if (Math.sqrt(a.pos.distanceSq(at)) > radius) continue;
      if (a.needs.hunger >= 8) a.foodAlert = 5;
      a.startle(6 * a.personality.shy);
    }
  }

  /** @returns จำนวนจังหวะที่คำนวณ */
  update(dt: number): number {
    this.acc = Math.min(this.acc + dt, FishAI.STEP * FishAI.MAX_STEPS);
    let steps = 0;
    while (this.acc >= FishAI.STEP) {
      this.acc -= FishAI.STEP;
      this.step(FishAI.STEP);
      steps++;
    }
    this.alpha = this.acc / FishAI.STEP;
    return steps;
  }

  step(dt: number): void {
    this.time += dt;
    this.grid.clear();
    this.claims.clear();
    for (const a of this.agents) {
      this.grid.insert(a);
      if (a.targetFood && !a.targetFood.gone) this.claims.set(a.targetFood, (this.claims.get(a.targetFood) ?? 0) + 1);
    }
    for (const a of this.agents) a.step(dt, this.world, this);
  }

  // ── ข้อมูลที่ agent ถาม ─────────────────────────────────────

  /** แรงแยกตัวจากปลาที่ใกล้เกินระยะส่วนตัว (Separation) */
  separation(a: FishAgent, out: Vec3): Vec3 {
    out.set(0, 0, 0);
    const reach = a.mods.personalSpace * a.needs.length + 0.3;
    this.grid.query(a.pos.x, a.pos.y, a.pos.z, reach + 1, this.near);
    for (const o of this.near) {
      if (o === a) continue;
      const min = reach + o.radius * 0.6;
      const dx = a.pos.x - o.pos.x;
      const dy = a.pos.y - o.pos.y;
      const dz = a.pos.z - o.pos.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 >= min * min || d2 < 1e-8) continue;
      const d = Math.sqrt(d2);
      const f = (min - d) / min;
      out.x += (dx / d) * f;
      out.y += (dy / d) * f * 0.6;
      out.z += (dz / d) * f;
    }
    return out;
  }

  /** ปลาฝูงเดียวกันในรัศมี: จุดกึ่งกลาง (Cohesion) และทิศเฉลี่ย (Alignment) */
  mateCenter(a: FishAgent, radius: number, center: Vec3, align: Vec3): number {
    center.set(0, 0, 0);
    align.set(0, 0, 0);
    let n = 0;
    this.grid.query(a.pos.x, a.pos.y, a.pos.z, radius, this.near);
    for (const o of this.near) {
      if (o === a || o.species.group !== a.species.group || o.pos.distanceSq(a.pos) > radius * radius) continue;
      center.add(o.pos);
      align.add(o.heading);
      n++;
    }
    if (n) center.scale(1 / n);
    return n;
  }

  countMates(a: FishAgent, radius: number): number {
    let n = 0;
    this.grid.query(a.pos.x, a.pos.y, a.pos.z, radius, this.near);
    for (const o of this.near) if (o !== a && o.species.group === a.species.group && o.pos.distanceSq(a.pos) <= radius * radius) n++;
    return n;
  }

  /** ความแออัดรอบตัว 0..~2 (ใช้เพิ่มความเครียด) */
  crowdedness(a: FishAgent): number {
    const r = a.mods.personalSpace * a.needs.length * 1.2 + 0.2;
    let n = 0;
    this.grid.query(a.pos.x, a.pos.y, a.pos.z, r, this.near);
    for (const o of this.near) if (o !== a && o.pos.distanceSq(a.pos) < r * r) n++;
    return Math.min(2, n * 0.35);
  }

  /** อาหารที่มองเห็นและคุ้มที่สุด: ใกล้ + มีปลาตัวอื่นเล็งน้อย (ไม่แห่ไปจุดเดียว) */
  pickFood(a: FishAgent): FoodItem | null {
    const sight = a.mods.foodSight * (0.7 + (a.needs.hunger / 100) * 0.6) * (a.foodAlert > 0 ? 2.2 : 1);
    let best: FoodItem | null = null;
    let bestCost = Infinity;
    for (const f of this.world.food) {
      if (f.gone) continue;
      const d2 = a.pos.distanceSq(f.position);
      if (d2 > sight * sight) continue;
      const mine = a.targetFood === f ? 1 : 0;
      const others = (this.claims.get(f) ?? 0) - mine;
      const cost = Math.sqrt(d2) * (1 + others * 0.9) * (mine ? 0.8 : 1);
      if (cost < bestCost) {
        bestCost = cost;
        best = f;
      }
    }
    return best;
  }

  /** ที่หลบที่ใกล้ที่สุด (preferPlant = เลือกพุ่มพืชก่อน) */
  nearestCover(a: FishAgent, preferPlant: boolean): Cover | null {
    let best: Cover | null = null;
    let bestD = Infinity;
    for (const c of this.world.covers) {
      const dx = c.x - a.pos.x;
      const dz = c.z - a.pos.z;
      const d = Math.sqrt(dx * dx + dz * dz) * (preferPlant && !c.plant ? 1.8 : 1);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    return best;
  }
}

export type { FishAgent };
export { Vec3 };
