import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG } from '../../src/config.js';
import { TankSimulation } from '../../src/sim/TankSimulation.ts';
import { catchUpTank } from '../../src/sim/offline.ts';
import { createFishRecord } from '../../src/sim/records.ts';
import { conditionOf, secondsUntilDeath } from '../../src/sim/needs.ts';

const ENV = { decorHappiness: 0.5, cleanBonus: 0, capacity: 14 };
const makeTank = (fish) => ({ id: 'tank_t', typeId: 'starter', name: 'ตู้', cleanliness: 100, fish, decor: [], lastUpdate: 0 });
const molly = (extra = {}) => ({ ...createFishRecord('molly_dalmatian', { satiety: 100 }), ...extra });

/** เดินเวลาทีละจังหวะจนเงื่อนไขเป็นจริง คืนเวลาที่ใช้ (วินาทีเกม) และเหตุการณ์ทั้งหมด */
function runUntil(sim, done, maxSeconds = 4 * 3600) {
  const events = [];
  for (let t = 0; t < maxSeconds; t += CONFIG.sim.tickSeconds) {
    sim.tick(CONFIG.sim.tickSeconds);
    for (const e of sim.drainEvents()) events.push({ ...e, t });
    if (done(events)) return { t, events };
  }
  return { t: Infinity, events };
}

test('Simulation Engine ไม่พึ่ง Three.js หรือ DOM', () => {
  const dir = path.resolve('src/sim');
  for (const file of fs.readdirSync(dir)) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    assert.doesNotMatch(src, /from ['"]three|document\.|window\.|requestAnimationFrame/, `${file} ต้องเป็นโค้ดคำนวณล้วน`);
  }
});

test('คำนวณเป็นจังหวะคงที่ ไม่ใช่ทุกเฟรม', () => {
  const sim = new TankSimulation(makeTank([molly()]), ENV);
  let ticks = 0;
  for (let i = 0; i < 59; i++) ticks += sim.advance(1 / 60, 1); // เกือบ 1 วินาทีแรก
  assert.equal(ticks, 0, 'ยังไม่ครบจังหวะ ไม่ต้องคำนวณ');
  ticks += sim.advance(1 / 60 + 1e-6, 1);
  assert.equal(ticks, 1);
  // แท็บกลับมาหลังพักนาน: คำนวณไม่เกินเพดานต่อเฟรม เกมไม่ค้าง
  assert.equal(sim.advance(3600, 1), CONFIG.sim.maxTicksPerFrame);
});

test('ปลาที่ถูกละเลย (ไม่ให้อาหาร ไม่ทำความสะอาด) อยู่ได้นานพอ และได้รับการเตือนทีละขั้นก่อนตาย', () => {
  const fish = molly();
  const tank = makeTank([fish, ...Array.from({ length: 9 }, () => molly())]);
  const sim = new TankSimulation(tank, ENV, { random: () => 0.99 }); // ไม่ผสมพันธุ์ระหว่างทดสอบ
  const { t, events } = runUntil(sim, (ev) => ev.some((e) => e.type === 'died' && e.fish.id === fish.id));
  const minutes = t / 60;
  const at = (c) => events.find((e) => e.type === 'condition' && e.fishId === fish.id && e.condition === c)?.t / 60;
  console.log(`ไทม์ไลน์ (นาที): หิว ${at('hungry').toFixed(1)} · อดอาหาร ${at('starving').toFixed(1)} · ป่วย ${at('sick').toFixed(1)} · อาการหนัก ${at('critical').toFixed(1)} · ตาย ${minutes.toFixed(1)}`);
  assert.ok(minutes >= 30 && minutes <= 60, `ตายหลังถูกละเลย ${minutes.toFixed(1)} นาที (ควรอยู่ราว 30–60 นาที)`);

  const steps = events.filter((e) => e.type === 'condition' && e.fishId === fish.id).map((e) => e.condition);
  for (const c of ['hungry', 'starving', 'sick', 'critical']) assert.ok(steps.includes(c), `ต้องเตือนขั้น ${c}`);
  const hungryAt = events.find((e) => e.type === 'condition' && e.fishId === fish.id && e.condition === 'hungry').t;
  const critical = events.find((e) => e.type === 'condition' && e.fishId === fish.id && e.condition === 'critical');
  assert.ok((t - hungryAt) / 60 >= 15, 'ตั้งแต่เตือนว่าหิวจนตายมีเวลาเกิน 15 นาที');
  assert.ok((t - critical.t) / 60 >= 4, `หลังเตือนอาการหนักยังมีเวลาแก้ไข ${((t - critical.t) / 60).toFixed(1)} นาที`);
  assert.ok(critical.secondsLeft > 0 && Math.abs(critical.secondsLeft - (t - critical.t)) < 120, 'เวลาที่เหลือที่บอกผู้เล่นใกล้เคียงความจริง');
  assert.ok(events.some((e) => e.type === 'water' && e.stage >= 2), 'เตือนเรื่องน้ำสกปรกด้วย');
});

test('แก้ปัญหาทันเวลา: ให้อาหาร ทำความสะอาด ให้ยา แล้วปลาฟื้นกลับเป็นปกติ', () => {
  const fish = molly({ satiety: 0, health: 15 });
  const tank = makeTank([fish]);
  tank.cleanliness = 10;
  const sim = new TankSimulation(tank, ENV);
  assert.equal(conditionOf(fish), 'critical');
  sim.feed(fish.id, { nutrition: 80, health: 2, happiness: 5 });
  sim.clean();
  sim.heal(CONFIG.care.medicineHeal);
  // ผู้เล่นให้อาหารต่อเป็นปกติเมื่อปลาเริ่มหิว
  const { t } = runUntil(sim, () => {
    if (fish.satiety < 50) sim.feed(fish.id, { nutrition: 40, health: 0, happiness: 2 });
    return fish.health >= 99;
  }, 3600);
  assert.ok(t < 15 * 60, `ฟื้นเต็มใน ${(t / 60).toFixed(1)} นาทีหลังแก้ปัญหา`);
  assert.equal(sim.condition(fish.id), 'healthy');
});

test('อาการหนัก: สุขภาพลดช้าลง และเวลาที่เหลือคิดรวมช่วงชะลอแล้ว', () => {
  const C = CONFIG.care;
  const fish = molly({ satiety: 0, health: C.criticalBelow });
  const fast = secondsUntilDeath({ ...fish, health: C.criticalBelow + 10 }, 100) - secondsUntilDeath(fish, 100);
  const slow = secondsUntilDeath(fish, 100);
  assert.ok(slow / C.criticalBelow > fast / 10, 'ช่วงอาการหนักสุขภาพลดช้ากว่าช่วงป่วย');
});

test('ออฟไลน์: ปลาหิวและน้ำสกปรกได้ แต่ไม่ต่ำกว่าค่าขั้นต่ำ และสุขภาพไม่ลด', () => {
  const fish = molly({ satiety: 90, health: 80 });
  const tank = makeTank([fish]);
  catchUpTank(tank, 8 * 3600);
  assert.equal(fish.satiety, CONFIG.offline.minSatiety);
  assert.equal(tank.cleanliness, CONFIG.offline.minCleanliness);
  assert.equal(fish.health, 80);
});

test('คลอดลูกเมื่อครบกำหนด / ตู้เต็มแจ้งครั้งเดียว', () => {
  const mom = molly({ gender: 'f', pregnantAt: 1, fetus: { speciesId: 'molly_dalmatian' } });
  const tank = makeTank([mom]);
  const sim = new TankSimulation(tank, { ...ENV, capacity: 1 }, { now: () => 1e13 });
  runUntil(sim, () => false, CONFIG.breeding.checkInterval * 3);
  sim.env = { ...ENV, capacity: 14 };
  const { events } = runUntil(sim, (ev) => ev.some((e) => e.type === 'born'), CONFIG.breeding.checkInterval * 2);
  assert.equal(tank.fish.length, 2);
  assert.equal(events.filter((e) => e.type === 'born').length, 1);
});

test('ตู้เต็ม: แจ้งว่าคลอดไม่ได้ครั้งเดียว', () => {
  const mom = molly({ gender: 'f', pregnantAt: 1, fetus: { speciesId: 'molly_dalmatian' } });
  const sim = new TankSimulation(makeTank([mom]), { ...ENV, capacity: 1 }, { now: () => 1e13 });
  const { events } = runUntil(sim, () => false, CONFIG.breeding.checkInterval * 5);
  assert.equal(events.filter((e) => e.type === 'birthBlocked').length, 1);
});
