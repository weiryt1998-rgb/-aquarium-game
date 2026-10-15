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
  assert.equal(events.find((e) => e.type === 'birthBlocked').reason, 'full');
});

// ── วงจรการขยายพันธุ์แบบปลาสอด (ใช้กับทุกสายพันธุ์) ─────────────────

/** ตู้ที่มีนาฬิกาจริงควบคุมได้: 1 จังหวะ = 1 วินาทีเกม = 1,000 ms */
function breedingTank(fish, env = ENV, random = () => 0) {
  const clock = { now: 1e12 };
  const tank = makeTank(fish);
  const sim = new TankSimulation(tank, env, { random, now: () => clock.now });
  const run = (seconds, done = () => false) => {
    const events = [];
    for (let t = 0; t < seconds; t++) {
      clock.now += 1000;
      for (const f of tank.fish) f.satiety = 100; // ผู้เล่นให้อาหารสม่ำเสมอ
      sim.tick(1);
      for (const e of sim.drainEvents()) events.push({ ...e, t });
      if (done(events)) break;
    }
    return events;
  };
  return { tank, sim, clock, run };
}
const adult = (speciesId, gender, extra = {}) => ({ ...createFishRecord(speciesId, { satiety: 100, gender }), breedCooldown: 0, ...extra });

test('วงจรเต็ม: เกี้ยวพาราสี → ตั้งท้อง 15 นาที → คลอด 1 ตัว → แม่พักฟื้น 30 นาที → ผสมพันธุ์ใหม่ได้', () => {
  const B = CONFIG.breeding;
  assert.equal(B.gestation, 15 * 60);
  assert.equal(B.rest, 30 * 60);
  const dad = adult('molly_golden', 'm');
  const mom = adult('molly_golden', 'f');
  const { tank, sim, clock, run } = breedingTank([dad, mom]);

  // 1) ตัวผู้เกี้ยวตัวเมียก่อน ยังไม่ตั้งท้องทันที
  let ev = run(600, (e) => e.some((x) => x.type === 'mated'));
  const court = ev.find((e) => e.type === 'courtStart');
  const mated = ev.find((e) => e.type === 'mated');
  assert.ok(court && mated, 'ต้องมีทั้งการเกี้ยวและการผสมพันธุ์');
  assert.deepEqual([court.dadId, court.momId], [dad.id, mom.id]);
  assert.ok(mated.t - court.t >= B.courtship, `เกี้ยว ${mated.t - court.t} วินาทีก่อนผสมพันธุ์`);
  assert.ok(mom.pregnantAt > 0);
  assert.equal(sim.courtingPartner(dad.id), null, 'เกี้ยวเสร็จแล้ว');

  // 2) ยังไม่ครบ 15 นาที → ยังไม่คลอด
  clock.now = mom.pregnantAt + 14 * 60 * 1000;
  ev = run(B.checkInterval * 3);
  assert.equal(ev.filter((e) => e.type === 'born').length, 0);

  // 3) ครบกำหนด → คลอดลูก 1 ตัวเท่านั้น ลูกตัวเล็ก (growth 0) สีตามพ่อแม่
  clock.now = mom.pregnantAt + 15 * 60 * 1000;
  ev = run(B.checkInterval * 3);
  const born = ev.filter((e) => e.type === 'born');
  assert.equal(born.length, 1);
  assert.equal(tank.fish.length, 3);
  assert.ok(born[0].baby.growth < 0.2, 'ลูกปลาเกิดมาตัวเล็ก แล้วค่อย ๆ โต');
  assert.equal(born[0].baby.speciesId, 'molly_golden');
  assert.equal(mom.pregnantAt, undefined);
  assert.ok(mom.lastBirthAt > 0);
  // ขายลูกออก (ลูกโตเร็ว ถ้าเป็นตัวเมียจะไปจับคู่กับพ่อแทน ทำให้ผลทดสอบไม่แน่นอน)
  tank.fish = tank.fish.filter((f) => f.id !== born[0].baby.id);
  sim.forget(born[0].baby.id);

  // 4) ช่วงพักฟื้น 30 นาที ตัวเมียไม่ถูกเกี้ยว (แม้พ่อพร้อม) — เดินเวลาต่ออีก 5 นาทีก็ยังไม่ครบ
  dad.breedCooldown = 0;
  clock.now = mom.lastBirthAt + 24 * 60 * 1000;
  ev = run(B.checkInterval * 30);
  assert.equal(ev.filter((e) => e.type === 'courtStart' && e.momId === mom.id).length, 0, 'ยังพักฟื้นอยู่');

  // 5) พ้น 30 นาที → เกี้ยวใหม่ได้
  clock.now = mom.lastBirthAt + 30 * 60 * 1000;
  ev = run(B.checkInterval * 3);
  assert.ok(ev.some((e) => e.type === 'courtStart' && e.momId === mom.id));
});

test('ผสมพันธุ์ได้เฉพาะตัวผู้-ตัวเมียสายพันธุ์เดียวกัน ที่โตเต็มวัยและสุขภาพดี', () => {
  const cases = [
    ['ต่างสายพันธุ์', [adult('guppy', 'm'), adult('molly_golden', 'f')]],
    ['เพศเดียวกัน', [adult('molly_golden', 'f'), adult('molly_golden', 'f')]],
    ['ยังไม่โตเต็มวัย', [adult('molly_golden', 'm', { growth: 0.2 }), adult('molly_golden', 'f')]],
    ['สุขภาพไม่ดี', [adult('molly_golden', 'm', { health: 40 }), adult('molly_golden', 'f')]],
    ['ตัวผู้ยังพักหลังผสมพันธุ์', [adult('molly_golden', 'm', { breedCooldown: 9999 }), adult('molly_golden', 'f')]],
  ];
  for (const [label, fish] of cases) {
    const { run } = breedingTank(fish);
    const ev = run(120);
    assert.equal(ev.filter((e) => e.type === 'courtStart').length, 0, label);
  }
  // ปลาสอดต่างสีเป็นสายพันธุ์เดียวกัน (Poecilia) → ผสมได้ ลูกได้ยีนสีผสม
  const dad = adult('molly_golden', 'm');
  const mom = adult('molly_dalmatian', 'f');
  const { run } = breedingTank([dad, mom]);
  run(600, (e) => e.some((x) => x.type === 'mated'));
  assert.equal(mom.fetus.speciesId, 'molly_hybrid');
  assert.ok(mom.fetus.genes, 'ลูกผสมได้สีและลายจากพ่อแม่');
});

test('เกี้ยวอยู่แล้วตัวเมียหิว/ถูกขาย → เลิกเกี้ยว ไม่ตั้งท้อง', () => {
  const dad = adult('molly_golden', 'm');
  const mom = adult('molly_golden', 'f');
  const { tank, sim, run } = breedingTank([dad, mom]);
  run(600, (e) => e.some((x) => x.type === 'courtStart'));
  assert.equal(sim.courtingPartner(mom.id), dad.id);
  // ขายตัวเมียระหว่างเกี้ยว
  tank.fish = tank.fish.filter((f) => f !== mom);
  sim.forget(mom.id);
  assert.equal(sim.courtingPartner(dad.id), null);

  const mom2 = adult('molly_golden', 'f');
  tank.fish.push(mom2);
  run(600, (e) => e.some((x) => x.type === 'courtStart' && x.momId === mom2.id));
  // ตัวเมียหิวจัดกลางคัน (ทดสอบตรง ๆ ด้วย tick โดยไม่ให้อาหาร)
  mom2.satiety = 0;
  const events = [];
  for (let i = 0; i < CONFIG.breeding.checkInterval * 3; i++) {
    sim.tick(1);
    events.push(...sim.drainEvents());
  }
  assert.ok(events.some((e) => e.type === 'courtEnd' && e.momId === mom2.id));
  assert.ok(!events.some((e) => e.type === 'mated'));
  assert.equal(mom2.pregnantAt, undefined);
});

test('จำกัดประชากร: ถึงเพดานแล้วไม่เกี้ยว/คลอดใหม่ และไม่ลบปลาที่มีอยู่', () => {
  const cap = CONFIG.breeding.maxPopulation;
  const env = { ...ENV, capacity: 64 };
  // ปลาเต็มเพดาน: คู่พร้อมผสมพันธุ์ก็ไม่เกี้ยว
  const crowd = Array.from({ length: cap }, (_, i) => adult('molly_golden', i % 2 ? 'm' : 'f'));
  const full = breedingTank(crowd, env);
  assert.equal(full.sim.breedingCap, cap);
  assert.equal(full.run(300).filter((e) => e.type === 'courtStart').length, 0);
  assert.equal(full.tank.fish.length, cap);

  // แม่ครบกำหนดคลอดแต่ถึงเพดาน → รอคลอด (แจ้งครั้งเดียว เหตุผล population) ไม่มีปลาหาย
  crowd[0].pregnantAt = 1;
  crowd[0].fetus = { speciesId: 'molly_golden' };
  const blocked = full.run(CONFIG.breeding.checkInterval * 5);
  assert.deepEqual(
    blocked.filter((e) => e.type === 'birthBlocked').map((e) => e.reason),
    ['population'],
  );
  assert.equal(full.tank.fish.length, cap);
  // ขายออก 1 ตัว → คลอดได้
  full.tank.fish.pop();
  assert.equal(full.run(CONFIG.breeding.checkInterval * 2).filter((e) => e.type === 'born').length, 1);
  assert.equal(full.tank.fish.length, cap);

  // นับลูกที่จะตามมาด้วย: ที่ว่าง 1 ที่ → ตั้งท้องได้แค่ 1 ตัว แม้มีตัวเมียพร้อมหลายตัว
  const fish = [adult('molly_golden', 'm'), adult('molly_golden', 'm'), adult('molly_golden', 'f'), adult('molly_golden', 'f')];
  const small = breedingTank(fish, { ...ENV, capacity: 5 });
  const ev = small.run(CONFIG.breeding.gestation - 60); // ตรวจก่อนครบกำหนดคลอด
  assert.equal(ev.filter((e) => e.type === 'mated').length, 1);
  assert.equal(small.tank.fish.filter((f) => f.pregnantAt).length, 1);
});

test('การผสมพันธุ์คำนวณเป็นช่วง ไม่ใช่ทุกจังหวะ', () => {
  const { run } = breedingTank([adult('molly_golden', 'm'), adult('molly_golden', 'f')]);
  const ev = run(600).filter((e) => e.type === 'courtStart' || e.type === 'mated');
  for (const e of ev) assert.equal((e.t + 1) % CONFIG.breeding.checkInterval, 0, `เกิดที่วินาที ${e.t + 1}`);
});
