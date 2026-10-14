import { test } from 'node:test';
import assert from 'node:assert/strict';
import { processCommit, replayCommands, validateCommit } from '../../src/shared/commit.js';
import { planAdminAction } from '../../src/shared/adminOps.js';
import { getSpecies } from '../../src/data/fish.js';
import { getFood } from '../../src/data/food.js';
import { CONFIG } from '../../src/config.js';
import { FEED_WINDOW_MS } from '../../src/shared/constants.js';
import { maxGrowthIn } from '../../src/shared/economy.js';
import { T0, fishRecord, makeDoc, tankId } from '../helpers/fixtures.js';

const commit = (writer, seq, commands, extra = {}) => ({ writer, seq, epoch: 0, commands, snapshot: null, ...extra });
const buy = (doc, id, speciesId = 'molly_golden') => ({ type: 'buyFish', tankId: tankId(doc), speciesId, fish: { id, name: 'x', gender: 'm' } });

test('ส่ง commit เดิมซ้ำ (seq เดิม) ไม่ถูกบันทึกซ้ำ — ไม่หักเงินสองครั้ง', () => {
  const doc0 = makeDoc({ coins: 1000 });
  const c = commit('w_a', 1, [buy(doc0, 'fish_a1')]);
  const r1 = processCommit(doc0, c, { now: T0 });
  const r2 = processCommit(r1.doc, c, { now: T0 + 1000 });
  assert.equal(r1.doc.game.coins, 850);
  assert.equal(r2.duplicate, true);
  assert.equal(r2.doc.game.coins, 850);
  assert.equal(r2.doc.revision, r1.doc.revision);
  assert.equal(doc0.game.coins, 1000, 'ไม่แก้เอกสารต้นฉบับ');
});

test('สองเครื่องซื้อพร้อมกันจากข้อมูลชุดเดียวกัน: transaction ทำต่อกัน ได้ปลาทั้งคู่ เงินถูกหักครบ', () => {
  const base = makeDoc({ coins: 1000 });
  // ทั้งสองเครื่องเห็น revision เดียวกัน — เซิร์ฟเวอร์ประมวลผลทีละ commit บนข้อมูลล่าสุดเสมอ
  const a = processCommit(base, commit('w_a', 1, [buy(base, 'fish_a1', 'crab')]), { now: T0 });
  const b = processCommit(a.doc, commit('w_b', 1, [buy(base, 'fish_b1', 'molly_golden')]), { now: T0 + 5 });
  const fish = b.doc.game.tanks[0].fish.map((f) => f.id);
  assert.ok(fish.includes('fish_a1') && fish.includes('fish_b1'));
  assert.equal(b.doc.game.coins, 1000 - getSpecies('crab').price.coins - getSpecies('molly_golden').price.coins);
  assert.equal(b.doc.revision, base.revision + 2);
});

test('ใช้เงินเกินจากหลายเครื่อง: คำสั่งที่มาทีหลังถูกปฏิเสธ ไม่ติดลบ', () => {
  const base = makeDoc({ coins: 200 });
  const a = processCommit(base, commit('w_a', 1, [buy(base, 'fish_a1', 'molly_golden')]), { now: T0 });
  const b = processCommit(a.doc, commit('w_b', 1, [buy(base, 'fish_b1', 'molly_golden')]), { now: T0 + 5 });
  assert.deepEqual(b.results, [{ ok: false, code: 'insufficient-funds' }]);
  assert.equal(b.doc.game.coins, 50);
});

test('รับรางวัลซ้ำจากสองเครื่องพร้อมกัน: ได้รางวัลครั้งเดียว', () => {
  const base = makeDoc({ coins: 0 });
  const a = processCommit(base, commit('w_a', 1, [{ type: 'claimDaily' }]), { now: T0 });
  const b = processCommit(a.doc, commit('w_b', 1, [{ type: 'claimDaily' }]), { now: T0 + 5 });
  assert.equal(b.doc.game.coins, 200);
  assert.deepEqual(b.results, [{ ok: false, code: 'already-claimed' }]);
});

test('epoch ไม่ตรง (เซฟถูกรีเซ็ต/กู้คืนแล้ว): ยกเลิกทั้ง commit', () => {
  const base = makeDoc({ coins: 1000 });
  const r = processCommit(base, commit('w_a', 1, [buy(base, 'fish_a1')], { epoch: 3 }), { now: T0 });
  assert.equal(r.epochMismatch, true);
  assert.equal(r.doc, base);
  assert.deepEqual(r.results, [{ ok: false, code: 'epoch' }]);
});

test('snapshot จากข้อมูลเก่า (baseSimRev ไม่ตรง) ไม่ถูกเขียนทับข้อมูลใหม่', () => {
  const fish = fishRecord('goldfish', { satiety: 50, growth: 0.5 });
  const base = makeDoc({ fish: [fish] });
  const tid = tankId(base);
  const snapA = { tanks: { [tid]: { baseSimRev: 0, cleanliness: 90, fish: { [fish.id]: { satiety: 49, health: 99, growth: 0.5, age: 1001, breedCooldown: 0, coinTimer: 5 } } } } };
  const a = processCommit(base, commit('w_a', 1, [], { snapshot: snapA }), { now: T0 + 1000 });
  assert.equal(a.snapshot[tid], 'accepted');
  assert.equal(a.doc.meta.tanks[tid].simRev, 1);
  assert.equal(a.doc.meta.tanks[tid].simBy, 'w_a');
  // เครื่อง B ยังอ้าง simRev 0 (เห็นข้อมูลเก่า) → ปัดตก
  const snapB = { tanks: { [tid]: { baseSimRev: 0, cleanliness: 10, fish: { [fish.id]: { satiety: 5, health: 10, growth: 0.5, age: 1001, breedCooldown: 0, coinTimer: 5 } } } } };
  const b = processCommit(a.doc, commit('w_b', 1, [], { snapshot: snapB }), { now: T0 + 2000 });
  assert.equal(b.snapshot[tid], 'rejected');
  assert.equal(b.doc.game.tanks[0].fish[0].satiety, 49);
  assert.equal(b.doc.game.tanks[0].cleanliness, 90);
});

test('snapshot: ค่าที่เป็นไปไม่ได้ถูกบีบ (อิ่มขึ้นโดยไม่ให้อาหาร, โตเร็วเกิน, น้ำใสขึ้นเอง)', () => {
  const fish = fishRecord('koi', { satiety: 40, growth: 0.2 });
  const base = makeDoc({ fish: [fish] });
  const tid = tankId(base);
  base.game.tanks[0].cleanliness = 50;
  const snap = { tanks: { [tid]: { baseSimRev: 0, cleanliness: 100, fish: { [fish.id]: { satiety: 100, health: 100, growth: 1, age: 2000, breedCooldown: 0, coinTimer: 5 } } } } };
  const r = processCommit(base, commit('w_a', 1, [], { snapshot: snap }), { now: T0 + 10_000 });
  const f = r.doc.game.tanks[0].fish[0];
  assert.equal(f.satiety, 40);
  assert.ok(f.growth < 0.3, `growth ${f.growth}`);
  assert.equal(r.doc.game.tanks[0].cleanliness, 50);
});

test('repeated snapshots at the same server time cannot refill, heal, clean, grow, or age fish', () => {
  const fish = fishRecord('koi', { satiety: 40, health: 50, growth: 0.2, age: 100 });
  let doc = makeDoc({ fish: [fish] });
  const tid = tankId(doc);
  doc.game.tanks[0].cleanliness = 50;
  for (let seq = 1; seq <= 100; seq++) {
    const snapshot = { tanks: { [tid]: {
      baseSimRev: seq - 1,
      cleanliness: 100,
      fish: { [fish.id]: { satiety: 100, health: 100, growth: 1, age: 10000 } },
    } } };
    doc = processCommit(doc, commit('w_a', seq, [], { snapshot }), { now: T0 }).doc;
  }
  assert.equal(doc.game.tanks[0].cleanliness, 50);
  assert.deepEqual(doc.game.tanks[0].fish[0], fish);
});

test('snapshot gains still follow elapsed simulation time', () => {
  const fish = fishRecord('koi', { health: 50, growth: 0.2, age: 100 });
  const doc = makeDoc({ fish: [fish] });
  const tid = tankId(doc);
  const snapshot = { tanks: { [tid]: { baseSimRev: 0, fish: { [fish.id]: { health: 100, growth: 1, age: 10000 } } } } };
  const result = processCommit(doc, commit('w_a', 1, [], { snapshot }), { now: T0 + 10000 });
  const actual = result.doc.game.tanks[0].fish[0];
  const elapsed = 10 * CONFIG.timeScale;
  assert.equal(actual.health, fish.health + CONFIG.care.regen * elapsed);
  assert.equal(actual.growth, fish.growth + maxGrowthIn(getSpecies(fish.speciesId), elapsed));
  assert.equal(actual.age, fish.age + elapsed);
});

test('feeding permits delayed satiety changes and spends its healing budget only once', () => {
  const fish = fishRecord('koi', { satiety: 40, health: 20 });
  let doc = makeDoc({ fish: [fish] });
  const tid = tankId(doc);
  doc.game.inventory.pellets = 1;
  doc = processCommit(doc, commit('w_a', 1, [{ type: 'feed', tankId: tid, foodId: 'pellets' }]), { now: T0 }).doc;
  const snap = (rev, health, satiety = 80) => ({ tanks: { [tid]: { baseSimRev: rev, fish: { [fish.id]: { health, satiety } } } } });
  doc = processCommit(doc, commit('w_a', 2, [], { snapshot: snap(0, 23) }), { now: T0 }).doc;
  assert.equal(doc.game.tanks[0].fish[0].health, 23);
  assert.equal(doc.game.tanks[0].fish[0].satiety, 80);
  for (let seq = 3; seq <= 20; seq++) {
    doc = processCommit(doc, commit('w_a', seq, [], { snapshot: snap(seq - 2, 100) }), { now: T0 }).doc;
  }
  assert.equal(doc.game.tanks[0].fish[0].health, 20 + getFood('pellets').health * CONFIG.feed.pelletsPerSprinkle);
  assert.equal(doc.meta.tanks[tid].foodHealthBudget, 0);
  // The feed window expires; later snapshots cannot increase satiety from that feed.
  doc = processCommit(doc, commit('w_a', 21, [], { snapshot: snap(19, 100, 100) }), { now: T0 + FEED_WINDOW_MS + 1 }).doc;
  assert.equal(doc.game.tanks[0].fish[0].satiety, 80);
});

test('snapshot หลังให้อาหารและทำความสะอาดใน commit เดียวกัน: รับค่าได้ปกติ', () => {
  const fish = fishRecord('koi', { satiety: 40 });
  const base = makeDoc({ fish: [fish] });
  const tid = tankId(base);
  base.game.tanks[0].cleanliness = 50;
  const snap = { tanks: { [tid]: { baseSimRev: 0, cleanliness: 99.9, fish: { [fish.id]: { satiety: 75, health: 100, growth: 1, age: 1010, breedCooldown: 0, coinTimer: 5 } } } } };
  const r = processCommit(
    base,
    commit('w_a', 1, [
      { type: 'feed', tankId: tid, foodId: 'flakes' },
      { type: 'cleanTank', tankId: tid },
    ], { snapshot: snap }),
    { now: T0 + 10_000 },
  );
  assert.deepEqual(r.results, [{ ok: true }, { ok: true }]);
  assert.equal(r.doc.game.tanks[0].fish[0].satiety, 75);
  assert.equal(r.doc.game.tanks[0].cleanliness, 99.9);
});

test('ใช้ยาจากอีกเครื่อง (ไม่มี snapshot ที่ถูกรับ) → simRev เพิ่มและให้ทุกเครื่องรับค่าจากคลาวด์', () => {
  const fish = fishRecord('koi', { health: 20 });
  const base = makeDoc({ fish: [fish] });
  const tid = tankId(base);
  const r = processCommit(base, commit('w_b', 1, [{ type: 'useMedicine', tankId: tid }]), { now: T0 });
  assert.equal(r.doc.game.tanks[0].fish[0].health, 70);
  assert.equal(r.doc.meta.tanks[tid].simRev, 1);
  assert.equal(r.doc.meta.tanks[tid].simBy, '*');
});

test('ข้อมูลกันส่งซ้ำ (writers) ไม่โตเกินเพดาน — เก็บหน้าเกมที่บันทึกล่าสุด', () => {
  let doc = makeDoc();
  for (let i = 0; i < 230; i++) doc.meta.writers[`w_old${i}`] = { seq: 1, at: T0 - 1000 + i };
  const r = processCommit(doc, commit('w_new', 1, []), { now: T0 });
  assert.equal(Object.keys(r.doc.meta.writers).length, 200);
  assert.ok(r.doc.meta.writers.w_new, 'หน้าที่เพิ่งบันทึกต้องอยู่');
  assert.equal(r.doc.meta.writers.w_old0, undefined, 'ตัวที่เก่าที่สุดถูกลบก่อน');
});

test('validateCommit ปฏิเสธรูปแบบที่ผิด', () => {
  assert.throws(() => validateCommit(null));
  assert.throws(() => validateCommit({ writer: 'bad id!', seq: 1, epoch: 0, commands: [] }));
  assert.throws(() => validateCommit({ writer: 'w_a', seq: 0, epoch: 0, commands: [] }));
  assert.throws(() => validateCommit({ writer: 'w_a', seq: 1, epoch: 0, commands: Array(301).fill({ type: 'feed' }) }));
  assert.throws(() => validateCommit({ writer: 'w_a', seq: 1, epoch: 0, commands: [], snapshot: { tanks: { t: { baseSimRev: 'x' } } } }));
  const ok = validateCommit({ writer: 'w_a', seq: 1, epoch: 0, commands: [{ type: 'feed', extra: undefined }] });
  assert.deepEqual(ok.commands, [{ type: 'feed' }]);
});

test('validateCommit rejects inherited metadata keys before processing commands', () => {
  for (const key of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    assert.throws(() => validateCommit(commit(key, 1, [{ type: 'claimDaily' }])), (e) => e.code === 'invalid-argument');
    assert.throws(() => validateCommit(commit('w_a', 1, [], {
      snapshot: { tanks: { [key]: { baseSimRev: 0, fish: {} } } },
    })), (e) => e.code === 'invalid-argument');
  }
});

test('เล่นคำสั่งซ้ำฝั่งเว็บ (predict) ได้ผลเท่ากับที่เกมคำนวณในเครื่อง', () => {
  const base = makeDoc({ coins: 500, fish: [fishRecord('goldfish')] });
  const tid = tankId(base);
  const game = structuredClone(base.game);
  replayCommands(game, structuredClone(base.meta), [
    { type: 'buyFish', tankId: tid, speciesId: 'molly_golden', fish: { id: 'fish_p1', name: 'x', gender: 'f' }, at: T0 },
    { type: 'collectCoins', tankId: tid, count: 4, value: 99999, at: T0 + 10 }, // ฝั่งเว็บไม่ใช้เพดานเวลาเซิร์ฟเวอร์
    { type: 'sellFish', tankId: tid, fishId: 'fish_nope', at: T0 + 20 }, // คำสั่งที่ไม่ผ่านถูกข้าม
  ], 'w_a');
  assert.equal(game.coins, 500 - 150 + 99999);
  assert.equal(game.tanks[0].fish.length, 2);
});

test('รีเซ็ต/กู้คืน: ต้องยืนยันด้วย revision ล่าสุด และสร้างจุดสำรองของข้อมูลเดิมเสมอ', () => {
  const doc = makeDoc({ coins: 777 });
  assert.throws(() => planAdminAction(doc, { action: 'reset', expectedRevision: doc.revision - 1, now: T0 }), (e) => e.code === 'revision-changed');
  const plan = planAdminAction(doc, { action: 'reset', expectedRevision: doc.revision, now: T0, writer: 'w_a' });
  assert.equal(plan.backup.reason, 'before-reset');
  assert.equal(plan.backup.game.coins, 777);
  assert.equal(plan.doc.epoch, doc.epoch + 1);
  assert.equal(plan.doc.revision, doc.revision + 1);
  assert.equal(plan.doc.game.coins, 1250);
  const restored = planAdminAction(plan.doc, { action: 'restore', expectedRevision: plan.doc.revision, backup: plan.backup, now: T0 + 1, writer: 'w_a' });
  assert.equal(restored.doc.game.coins, 777);
  assert.equal(restored.backup.reason, 'before-restore');
});
