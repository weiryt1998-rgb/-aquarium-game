import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../../src/shared/commands.js';
import { CommandError, fishSellValue, maxCoinRate, offlineCoins } from '../../src/shared/economy.js';
import { getSpecies } from '../../src/data/fish.js';
import { CONFIG } from '../../src/config.js';
import { LIMITS } from '../../src/shared/constants.js';
import { getFood } from '../../src/data/food.js';
import { getDecorItem } from '../../src/data/decor.js';
import { todayKey } from '../../src/utils/math.js';
import { T0, ctxAt, fishRecord, makeGame } from '../helpers/fixtures.js';
import { gestationMs, planOffspring, restMs } from '../../src/shared/breeding.js';
import { seededRandom } from '../../src/utils/math.js';

const run = (game, cmd, ctx = ctxAt(T0), meta = { tanks: {}, writers: {} }) => applyCommand(game, meta, cmd, ctx);
const rejects = (fn, code) => assert.throws(fn, (err) => err instanceof CommandError && err.code === code);
const newFish = (id = 'fish_new1') => ({ id, name: 'ใหม่', gender: 'f', breedCooldown: 50, coinTimer: 20 });

test('ซื้อปลา: หักเงินตามราคา เพิ่มปลาด้วยค่าเริ่มต้นฝั่งเซิร์ฟเวอร์ นับภารกิจและสถิติ', () => {
  const game = makeGame({ coins: 1000 });
  const tank = game.tanks[0];
  run(game, { type: 'buyFish', tankId: tank.id, speciesId: 'molly_golden', fish: newFish() });
  assert.equal(game.coins, 1000 - getSpecies('molly_golden').price.coins);
  const f = tank.fish.find((x) => x.id === 'fish_new1');
  assert.deepEqual({ satiety: f.satiety, health: f.health, growth: f.growth, age: f.age }, { satiety: 70, health: 100, growth: 0.6, age: 0 });
  assert.equal(game.collection.molly_golden, true);
  assert.equal(game.stats.fishBought, 1);
  assert.equal(game.missions.progress.d_buy, 1);
});

test('ซื้อปลา: เงินไม่พอ/ตู้เต็ม/ตู้เล็กไป/ข้อมูลผิด ถูกปฏิเสธโดยไม่แก้ข้อมูล', () => {
  const game = makeGame({ coins: 10 });
  const tank = game.tanks[0];
  const before = JSON.stringify(game);
  rejects(() => run(game, { type: 'buyFish', tankId: tank.id, speciesId: 'molly_golden', fish: newFish() }), 'insufficient-funds');
  game.coins = 99999;
  rejects(() => run(game, { type: 'buyFish', tankId: tank.id, speciesId: 'arowana', fish: newFish() }), 'tank-too-small');
  rejects(() => run(game, { type: 'buyFish', tankId: tank.id, speciesId: 'molly_golden', fish: { ...newFish(), gender: 'x' } }), 'invalid');
  rejects(() => run(game, { type: 'buyFish', tankId: 'tank_nope', speciesId: 'molly_golden', fish: newFish() }), 'not-found');
  game.coins = 10;
  assert.equal(JSON.stringify(game), before);

  const full = makeGame({ coins: 99999, fish: Array.from({ length: 14 }, () => fishRecord('neon')) });
  rejects(() => run(full, { type: 'buyFish', tankId: full.tanks[0].id, speciesId: 'molly_golden', fish: newFish() }), 'tank-full');
  assert.equal(full.coins, 99999);
});

test('ซื้อปลา: สายพันธุ์ที่เลิกขายแล้วซื้อไม่ได้ แต่ปลาเดิมในตู้ยังขายคืนได้', () => {
  const old = fishRecord('goldfish');
  const game = makeGame({ coins: 1000, fish: [old] });
  const tank = game.tanks[0];
  for (const id of ['goldfish', 'neon', 'yellowtang', 'bluetang']) {
    assert.equal(getSpecies(id).retired, true);
    rejects(() => run(game, { type: 'buyFish', tankId: tank.id, speciesId: id, fish: newFish() }), 'invalid');
  }
  assert.equal(game.coins, 1000);
  run(game, { type: 'sellFish', tankId: tank.id, fishId: old.id });
  assert.equal(game.coins, 1000 + fishSellValue(getSpecies('goldfish'), 1).coins);
});

test('ซื้อปลา: id ซ้ำกับปลาที่มีอยู่ถูกปฏิเสธ (กันคำสั่งเดิมสร้างปลาซ้ำ)', () => {
  const game = makeGame({ coins: 1000 });
  const tank = game.tanks[0];
  run(game, { type: 'buyFish', tankId: tank.id, speciesId: 'molly_golden', fish: newFish('fish_dup') });
  rejects(() => run(game, { type: 'buyFish', tankId: tank.id, speciesId: 'molly_golden', fish: newFish('fish_dup') }), 'invalid');
  assert.equal(game.coins, 1000 - getSpecies('molly_golden').price.coins);
});

test('ขายปลา: คืนเงินตามสูตรเดิม และไม่เชื่อค่าการเติบโตที่เกินจริง', () => {
  const fish = fishRecord('koi', { growth: 0.5 });
  const game = makeGame({ coins: 0, fish: [fish] });
  const tank = game.tanks[0];
  const meta = { tanks: { [tank.id]: { simRev: 1, simAt: T0 } }, writers: {} };
  // อ้างว่าโตเต็มวัยทั้งที่เพิ่งผ่านไป 1 วินาที → ใช้ค่าสูงสุดที่เป็นไปได้แทน
  run(game, { type: 'sellFish', tankId: tank.id, fishId: fish.id, growth: 1 }, ctxAt(T0 + 1000), meta);
  const species = getSpecies('koi');
  const maxGrowth = 0.5 + (1 * 1.6) / species.care.growTime + 0.01;
  assert.equal(game.coins, fishSellValue(species, maxGrowth).coins);
  assert.ok(game.coins < fishSellValue(species, 1).coins);
  assert.equal(tank.fish.length, 0);
  rejects(() => run(game, { type: 'sellFish', tankId: tank.id, fishId: fish.id, growth: 1 }), 'not-found');
});

test('เก็บเหรียญ: จำกัดด้วยอัตราผลิตสูงสุดของปลาในตู้ (กันปั๊มเหรียญ/เปิดหลายเครื่อง)', () => {
  const game = makeGame({ coins: 0, fish: [fishRecord('goldfish')] });
  const tank = game.tanks[0];
  const meta = { tanks: {}, writers: {} };
  const cap = Math.floor(maxCoinRate(tank) * 120 + 50);
  const first = run(game, { type: 'collectCoins', tankId: tank.id, count: 1000, value: 100000 }, ctxAt(T0), meta);
  assert.equal(game.coins, cap);
  assert.deepEqual(first, { accepted: cap, requested: 100000 });
  // ทันทีหลังจากนั้นธนาคารเหรียญว่าง
  run(game, { type: 'collectCoins', tankId: tank.id, count: 5, value: 50 }, ctxAt(T0 + 10), meta);
  assert.equal(game.coins, cap);
  // ผ่านไป 60 วินาที ได้ไม่เกินที่ปลาผลิตได้จริง
  run(game, { type: 'collectCoins', tankId: tank.id, count: 5, value: 1000 }, ctxAt(T0 + 60_010), meta);
  assert.ok(game.coins - cap <= Math.ceil(maxCoinRate(tank) * 60));
  // เหรียญต้องมีค่าอย่างน้อย 1 ต่อเหรียญ
  rejects(() => run(game, { type: 'collectCoins', tankId: tank.id, count: 10, value: 5 }), 'invalid');
});

test('เก็บเหรียญ: เล่นปกติไม่ชนเพดาน และนับภารกิจเก็บเหรียญ', () => {
  const game = makeGame({ coins: 0, fish: [fishRecord('goldfish'), fishRecord('guppy')] });
  const tank = game.tanks[0];
  const meta = { tanks: {}, writers: {} };
  run(game, { type: 'collectCoins', tankId: tank.id, count: 3, value: 18 }, ctxAt(T0), meta);
  assert.equal(game.coins, 18);
  assert.equal(game.stats.coinsCollected, 3);
  assert.equal(game.missions.progress.d_coins, 3);
});

test('เหรียญออฟไลน์: เซิร์ฟเวอร์คำนวณเองจากเวลาที่ผ่านไป และรับซ้ำไม่ได้', () => {
  const game = makeGame({ coins: 0, fish: [fishRecord('goldfish'), fishRecord('koi')] });
  const tank = game.tanks[0];
  tank.lastUpdate = T0 - 3600_000; // ไม่อยู่ 1 ชั่วโมง
  const meta = { tanks: {}, writers: {} };
  const expected = offlineCoins(tank, 3600);
  const r1 = run(game, { type: 'offlineIncome', tankId: tank.id }, ctxAt(T0), meta);
  assert.equal(r1.coins, expected);
  assert.equal(game.coins, expected);
  const r2 = run(game, { type: 'offlineIncome', tankId: tank.id }, ctxAt(T0 + 2000), meta);
  assert.equal(r2.coins, 0);
  assert.equal(game.coins, expected);
});

test('ภารกิจ: รับได้เมื่อทำครบ และรับซ้ำไม่ได้', () => {
  const game = makeGame({ coins: 0 });
  rejects(() => run(game, { type: 'claimMission', missionId: 'd_feed' }), 'not-complete');
  for (let i = 0; i < 5; i++) run(game, { type: 'feed', tankId: game.tanks[0].id, foodId: 'flakes' });
  assert.equal(game.inventory.flakes, 0);
  run(game, { type: 'claimMission', missionId: 'd_feed' });
  assert.equal(game.coins, 100);
  rejects(() => run(game, { type: 'claimMission', missionId: 'd_feed' }), 'already-claimed');
  assert.equal(game.coins, 100);
  rejects(() => run(game, { type: 'feed', tankId: game.tanks[0].id, foodId: 'flakes' }), 'out-of-stock');
});

test('ภารกิจแบบ gauge (สะสมสายพันธุ์) ตรวจจากข้อมูลจริงบนเซิร์ฟเวอร์', () => {
  const game = makeGame({ gems: 0 });
  game.collection = { goldfish: true };
  rejects(() => run(game, { type: 'claimMission', missionId: 'a_species' }), 'not-complete');
  for (const id of ['guppy', 'neon', 'clownfish', 'betta', 'angelfish', 'yellowtang', 'bluetang']) game.collection[id] = true;
  run(game, { type: 'claimMission', missionId: 'a_species' });
  assert.equal(game.gems, 15);
});

test('รางวัลประจำวัน: วันละครั้งตามเวลาไทย', () => {
  const game = makeGame({ coins: 0, gems: 0 });
  const lateNight = Date.parse('2026-10-12T16:59:00Z'); // 23:59 ไทย
  run(game, { type: 'claimDaily' }, ctxAt(lateNight));
  rejects(() => run(game, { type: 'claimDaily' }, ctxAt(lateNight + 30_000)), 'already-claimed');
  run(game, { type: 'claimDaily' }, ctxAt(lateNight + 120_000)); // 00:01 วันถัดไป
  assert.equal(game.coins, CONFIG.dailyReward.coins * 2);
  assert.equal(todayKey(new Date(lateNight + 120_000)), '2026-10-13');
});

test('ภารกิจรายวันรีเซ็ตเมื่อขึ้นวันใหม่ตามเวลาไทย', () => {
  const game = makeGame();
  run(game, { type: 'feed', tankId: game.tanks[0].id, foodId: 'flakes' }, ctxAt(T0));
  assert.equal(game.missions.progress.d_feed, 1);
  run(game, { type: 'feed', tankId: game.tanks[0].id, foodId: 'flakes' }, ctxAt(T0 + 24 * 3600_000));
  assert.equal(game.missions.progress.d_feed, 1);
  assert.equal(game.missions.day, '2026-10-13');
});

test('ทำความสะอาดตู้: ติดคูลดาวน์ด้วยเวลาเซิร์ฟเวอร์', () => {
  const game = makeGame();
  const tank = game.tanks[0];
  tank.cleanliness = 30;
  run(game, { type: 'cleanTank', tankId: tank.id }, ctxAt(T0));
  assert.equal(tank.cleanliness, 100);
  tank.cleanliness = 50;
  rejects(() => run(game, { type: 'cleanTank', tankId: tank.id }, ctxAt(T0 + 10_000)), 'cooldown');
  run(game, { type: 'cleanTank', tankId: tank.id }, ctxAt(T0 + CONFIG.care.cleanCooldown * 1000));
  assert.equal(game.missions.progress.d_clean, 1);
});

test('ผสมพันธุ์: ตัวเมียตั้งท้องก่อน ครบกำหนดจึงคลอด และตัวเมียเท่านั้นที่คลอดได้', () => {
  const dad = fishRecord('guppy', { gender: 'm' });
  const mom = fishRecord('guppy', { gender: 'f' });
  const neonMom = fishRecord('neon', { gender: 'f' });
  const game = makeGame({ fish: [dad, mom, neonMom] });
  const tank = game.tanks[0];
  const meta = { tanks: {}, writers: {} };
  const G = gestationMs();
  const mated = (parents, extra = {}) => ({ type: 'fishMated', tankId: tank.id, parents, ...extra });
  const born = (motherId, id) => ({ type: 'fishBorn', tankId: tank.id, motherId, fish: { id, name: 'ลูก', gender: 'f' } });

  rejects(() => run(game, mated([dad.id, neonMom.id]), ctxAt(T0), meta), 'invalid'); // ต่างชนิด
  rejects(() => run(game, mated([mom.id, dad.id]), ctxAt(T0), meta), 'invalid'); // ตัวผู้ต้องมาก่อน ตัวเมียคือแม่
  rejects(() => run(game, born(mom.id, 'fish_b0'), ctxAt(T0), meta), 'invalid'); // ยังไม่ตั้งท้อง

  run(game, mated([dad.id, mom.id]), ctxAt(T0), meta);
  assert.equal(mom.pregnantAt, T0);
  assert.equal(dad.pregnantAt, undefined);
  assert.equal(dad.breedCooldown, CONFIG.breeding.cooldown);
  assert.equal(tank.fish.length, 3, 'ผสมพันธุ์แล้วยังไม่มีลูกทันที');

  rejects(() => run(game, born(mom.id, 'fish_b1'), ctxAt(T0 + 5000), meta), 'cooldown'); // ยังไม่ครบกำหนด
  rejects(() => run(game, born(dad.id, 'fish_b2'), ctxAt(T0 + G), meta), 'invalid'); // ตัวผู้คลอดไม่ได้
  rejects(() => run(game, mated([dad.id, mom.id]), ctxAt(T0 + G), meta), 'invalid'); // ตั้งท้องซ้อนไม่ได้

  // ขายตัวพ่อระหว่างตั้งท้อง → ตัวแม่ยังคลอดได้
  run(game, { type: 'sellFish', tankId: tank.id, fishId: dad.id }, ctxAt(T0 + G), meta);
  run(game, born(mom.id, 'fish_b3'), ctxAt(T0 + G), meta);
  assert.equal(tank.fish.length, 3);
  assert.equal(tank.fish.at(-1).growth, 0);
  assert.equal(mom.pregnantAt, undefined);
  assert.equal(mom.breedCooldown, CONFIG.breeding.cooldown);
  assert.equal(game.stats.fishBorn, 1);
  rejects(() => run(game, born(mom.id, 'fish_b4'), ctxAt(T0 + 2 * G), meta), 'invalid'); // คลอดไปแล้ว
});

test('หลังคลอด: ตัวเมียพักฟื้น 30 นาที (นับจากเวลาที่คลอดในเครื่อง) ก่อนผสมพันธุ์ใหม่ได้', () => {
  const dad = fishRecord('guppy', { gender: 'm' });
  const mom = fishRecord('guppy', { gender: 'f' });
  const game = makeGame({ fish: [dad, mom] });
  const tank = game.tanks[0];
  const meta = { tanks: {}, writers: {} };
  const G = gestationMs();
  const R = restMs();
  assert.equal(G, 15 * 60 * 1000);
  assert.equal(R, 30 * 60 * 1000);
  run(game, { type: 'fishMated', tankId: tank.id, parents: [dad.id, mom.id] }, ctxAt(T0), meta);
  // คำสั่งคลอดส่งช้า 10 นาที → นับพักฟื้นจากตอนคลอดจริงในเครื่อง
  run(game, { type: 'fishBorn', tankId: tank.id, motherId: mom.id, at: T0 + G, fish: { id: 'fish_r1', name: 'ลูก', gender: 'm' } }, ctxAt(T0 + G + 600_000), meta);
  assert.equal(mom.lastBirthAt, T0 + G);
  assert.equal(tank.fish.length, 3, 'คลอดครั้งละ 1 ตัว');
  const mated = { type: 'fishMated', tankId: tank.id, parents: [dad.id, mom.id] };
  rejects(() => run(game, mated, ctxAt(T0 + G + R - 60_000), meta), 'cooldown');
  run(game, mated, ctxAt(T0 + G + R), meta);
  assert.ok(mom.pregnantAt > 0);
});

test('ผสมข้ามสี: ปลาสอดต่างสีผสมกันได้ ลูกเป็นลูกผสมตามยีนที่กำหนดตอนตั้งท้อง', () => {
  const dad = fishRecord('molly_golden', { gender: 'm' });
  const mom = fishRecord('molly_calico', { gender: 'f' });
  const guppyDad = fishRecord('guppy', { gender: 'm' });
  const game = makeGame({ fish: [dad, mom, guppyDad] });
  const tank = game.tanks[0];
  const meta = { tanks: {}, writers: {} };
  rejects(() => run(game, { type: 'fishMated', tankId: tank.id, parents: [guppyDad.id, mom.id] }, ctxAt(T0), meta), 'invalid'); // ต่างกลุ่มพันธุ์

  const fetus = planOffspring(mom, dad, seededRandom(0.77));
  assert.equal(fetus.speciesId, 'molly_hybrid');
  run(game, { type: 'fishMated', tankId: tank.id, parents: [dad.id, mom.id], fetus }, ctxAt(T0), meta);
  assert.deepEqual(mom.fetus, fetus);

  // ขายตัวพ่อก่อนคลอด → ลูกยังได้ยีนตามที่กำหนดไว้
  run(game, { type: 'sellFish', tankId: tank.id, fishId: dad.id }, ctxAt(T0 + 1000), meta);
  run(game, { type: 'fishBorn', tankId: tank.id, motherId: mom.id, fish: { id: 'fish_hb1', name: 'ลูก', gender: 'm' } }, ctxAt(T0 + gestationMs()), meta);
  const baby = tank.fish.find((f) => f.id === 'fish_hb1');
  assert.equal(baby.speciesId, 'molly_hybrid');
  assert.deepEqual(baby.genes, fetus.genes);
  assert.equal(game.collection.molly_hybrid, true, 'ลูกผสมถูกบันทึกลงสมุดสะสม');
  assert.equal(mom.fetus, undefined);
});

test('ผสมข้ามสี: ลูกในท้องที่ไม่ถูกต้องถูกแทนด้วยผลที่เป็นไปได้ และซื้อลูกผสมจากร้านไม่ได้', () => {
  const dad = fishRecord('molly_golden', { gender: 'm' });
  const mom = fishRecord('molly_redhead', { gender: 'f' });
  const game = makeGame({ coins: 99999, fish: [dad, mom] });
  const tank = game.tanks[0];
  run(game, { type: 'fishMated', tankId: tank.id, parents: [dad.id, mom.id], fetus: { speciesId: 'molly_golddust' } }, ctxAt(T0));
  assert.equal(mom.fetus.speciesId, 'molly_hybrid');
  assert.ok(mom.fetus.genes);
  rejects(() => run(game, { type: 'buyFish', tankId: tank.id, speciesId: 'molly_hybrid', fish: newFish('fish_hb2') }), 'invalid');

  // สีเดียวกัน พันธุ์แท้ → ลูกพันธุ์แท้ไม่มียีน
  const d2 = fishRecord('molly_golden', { gender: 'm' });
  const m2 = fishRecord('molly_golden', { gender: 'f' });
  const g2 = makeGame({ fish: [d2, m2] });
  run(g2, { type: 'fishMated', tankId: g2.tanks[0].id, parents: [d2.id, m2.id], fetus: planOffspring(m2, d2) }, ctxAt(T0));
  assert.deepEqual(m2.fetus, { speciesId: 'molly_golden' });
});

test('ผสมพันธุ์: นับการตั้งท้องจากเวลาที่เกิดในเครื่อง แต่ไม่ล้ำอนาคต', () => {
  const dad = fishRecord('guppy', { gender: 'm' });
  const mom = fishRecord('guppy', { gender: 'f' });
  const game = makeGame({ fish: [dad, mom] });
  const tank = game.tanks[0];
  run(game, { type: 'fishMated', tankId: tank.id, parents: [dad.id, mom.id], at: T0 - 30_000 }, ctxAt(T0));
  assert.equal(mom.pregnantAt, T0 - 30_000);
  delete mom.pregnantAt;
  run(game, { type: 'fishMated', tankId: tank.id, parents: [dad.id, mom.id], at: T0 + 999_999 }, ctxAt(T0 + 600_000));
  assert.equal(mom.pregnantAt, T0 + 600_000);
});

test('ปลาออกลูกแบบเก่า (คำสั่งค้างจากเวอร์ชันก่อน): ต้องมีพ่อแม่คู่จริง และเว้นระยะตามเวลาจริง', () => {
  const dad = fishRecord('guppy', { gender: 'm' });
  const mom = fishRecord('guppy', { gender: 'f' });
  const game = makeGame({ fish: [dad, mom] });
  const tank = game.tanks[0];
  const meta = { tanks: {}, writers: {} };
  const baby = (id) => ({ type: 'fishBorn', tankId: tank.id, parents: [dad.id, mom.id], fish: { id, name: 'ลูก', gender: 'm' } });
  run(game, baby('fish_baby1'), ctxAt(T0), meta);
  assert.equal(tank.fish.length, 3);
  assert.equal(dad.breedCooldown, CONFIG.breeding.cooldown);
  rejects(() => run(game, baby('fish_baby2'), ctxAt(T0 + 5000), meta), 'cooldown');
  rejects(() => run(game, { ...baby('fish_baby3'), parents: [dad.id, dad.id] }, ctxAt(T0 + 600_000), meta), 'invalid');
  run(game, baby('fish_baby4'), ctxAt(T0 + 600_000), meta);
  assert.equal(game.stats.fishBorn, 2);
});

test('แลกเพชร: เหรียญ 2,000 = 1 เพชร หักตามจำนวนจริง และปฏิเสธเมื่อเหรียญไม่พอหรือข้อมูลผิด', () => {
  const rate = CONFIG.exchange.coinsPerGem;
  assert.equal(rate, 2000);
  const game = makeGame({ coins: 5000, gems: 3 });
  assert.deepEqual(run(game, { type: 'exchangeGems', gems: 2 }), { gems: 2 });
  assert.equal(game.coins, 1000);
  assert.equal(game.gems, 5);
  const before = JSON.stringify(game);
  rejects(() => run(game, { type: 'exchangeGems', gems: 1 }), 'insufficient-funds');
  for (const gems of [0, -1, 1.5, '1', null, LIMITS.maxExchangeGems + 1]) rejects(() => run(game, { type: 'exchangeGems', gems }), 'invalid');
  assert.equal(JSON.stringify(game), before, 'คำสั่งที่ไม่ผ่านไม่แก้ข้อมูล');

  const rich = makeGame({ coins: 99_999_999, gems: LIMITS.maxGems - 1 });
  rejects(() => run(rich, { type: 'exchangeGems', gems: 2 }), 'limit');
  run(rich, { type: 'exchangeGems', gems: 1 });
  assert.equal(rich.gems, LIMITS.maxGems);
});

test('ของตกแต่ง: วางในตู้ได้ หักเงิน ขายคืนครึ่งราคา และวางนอกตู้ไม่ได้', () => {
  const game = makeGame({ coins: 1000 });
  const tank = game.tanks[0];
  run(game, { type: 'placeDecor', tankId: tank.id, decor: { id: 'decor_t1', itemId: 'castle', x: 0, z: 0, rotY: 0 } });
  assert.equal(game.coins, 750);
  rejects(() => run(game, { type: 'placeDecor', tankId: tank.id, decor: { id: 'decor_t2', itemId: 'castle', x: 99, z: 0, rotY: 0 } }), 'invalid');
  run(game, { type: 'moveDecor', tankId: tank.id, decorId: 'decor_t1', x: 1, z: 0.5, rotY: 0.78 });
  assert.deepEqual(tank.decor[0], { id: 'decor_t1', itemId: 'castle', x: 1, z: 0.5, rotY: 0.78 });
  run(game, { type: 'sellDecor', tankId: tank.id, decorId: 'decor_t1' });
  assert.equal(game.coins, 875);
  assert.equal(tank.decor.length, 0);
});

test('เปลือกหอย: วางได้ตู้ละ 1 ชิ้น เริ่มแบบปิดฝา เก็บไข่มุกได้เมื่อครบ 2 นาที', () => {
  const game = makeGame({ coins: 5000 });
  const tank = game.tanks[0];
  const reward = getDecorItem('seashell').pearl.reward.coins;
  run(game, { type: 'placeDecor', tankId: tank.id, decor: { id: 'decor_s1', itemId: 'seashell', x: 0, z: 0, rotY: 0, pearlAt: 0 } });
  const shell = tank.decor.find((d) => d.id === 'decor_s1');
  assert.equal(shell.pearlAt, T0); // ใช้เวลาฝั่งที่ตรวจ ไม่ใช้ค่าที่เครื่องส่งมา
  rejects(() => run(game, { type: 'placeDecor', tankId: tank.id, decor: { id: 'decor_s2', itemId: 'seashell', x: 2, z: 0, rotY: 0 } }), 'limit');

  const coins = game.coins;
  const pearl = { type: 'collectPearl', tankId: tank.id, decorId: 'decor_s1' };
  rejects(() => run(game, pearl, ctxAt(T0 + 60_000)), 'cooldown');
  run(game, pearl, ctxAt(T0 + 120_000));
  assert.equal(game.coins, coins + reward);
  assert.equal(shell.pearlAt, T0 + 120_000);
  rejects(() => run(game, pearl, ctxAt(T0 + 130_000)), 'cooldown');
  // โหมดทำนายผลในเครื่อง: ไม่ตรวจเวลา (เซิร์ฟเวอร์ตรวจแล้ว) แต่ยังบันทึกเวลาเก็บ
  run(game, pearl, ctxAt(T0 + 130_000, { predict: true }));
  assert.equal(shell.pearlAt, T0 + 130_000);

  run(game, { type: 'placeDecor', tankId: tank.id, decor: { id: 'decor_c1', itemId: 'castle', x: 3, z: 0, rotY: 0 } });
  rejects(() => run(game, { type: 'collectPearl', tankId: tank.id, decorId: 'decor_c1' }, ctxAt(T0 + 999_999)), 'invalid');
});

test('ปลดล็อกตู้: ชนิดละครั้ง และต้องมีเงินพอ', () => {
  const game = makeGame({ coins: 5000 });
  run(game, { type: 'buyTank', typeId: 'classic', tankId: 'tank_t2' });
  assert.equal(game.coins, 2000);
  assert.equal(game.tanks.length, 2);
  rejects(() => run(game, { type: 'buyTank', typeId: 'classic', tankId: 'tank_t3' }), 'already-owned');
  rejects(() => run(game, { type: 'buyTank', typeId: 'large', tankId: 'tank_t4' }), 'insufficient-funds');
});

test('คำสั่งที่ไม่รู้จักถูกปฏิเสธ', () => {
  const game = makeGame();
  rejects(() => run(game, { type: '__proto__' }), 'invalid');
  rejects(() => run(game, { type: 'giveMeCoins', coins: 999999 }), 'invalid');
});

test('metadata IDs cannot use inherited object keys', () => {
  for (const id of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
    const game = makeGame({ coins: 10000 });
    const before = structuredClone(game);
    rejects(() => run(game, { type: 'buyFish', tankId: game.tanks[0].id, speciesId: 'molly_golden', fish: newFish(id) }), 'invalid');
    rejects(() => run(game, { type: 'buyTank', typeId: 'classic', tankId: id }), 'invalid');
    assert.deepEqual(game, before, 'invalid IDs must not spend currency or create records');
  }
});

test('rewards and coin collection preserve the supported currency limits', () => {
  const game = makeGame({ coins: LIMITS.maxCoins - 1, gems: LIMITS.maxGems - 1, fish: [fishRecord('goldfish')] });
  run(game, { type: 'claimDaily' });
  assert.equal(game.coins, LIMITS.maxCoins);
  assert.equal(game.gems, LIMITS.maxGems);
  run(game, { type: 'collectCoins', tankId: game.tanks[0].id, count: 1, value: 10 });
  assert.equal(game.coins, LIMITS.maxCoins);
  assert.equal(game.stats.coinsCollected, 1);
  // Selling still removes the fish when the wallet is full.
  run(game, { type: 'sellFish', tankId: game.tanks[0].id, fishId: game.tanks[0].fish[0].id });
  assert.equal(game.coins, LIMITS.maxCoins);
  assert.equal(game.tanks[0].fish.length, 0);
});

test('full inventory rejects purchases before spending and accepts a pack that exactly fits', () => {
  const game = makeGame({ coins: 10000 });
  const food = getFood('flakes');
  game.inventory.flakes = LIMITS.maxItem - food.pack + 1;
  game.inventory.medicine = LIMITS.maxItem;
  const before = structuredClone(game);
  rejects(() => run(game, { type: 'buyFood', foodId: food.id }), 'limit');
  rejects(() => run(game, { type: 'buyMedicine' }), 'limit');
  assert.deepEqual(game, before);
  game.inventory.flakes = LIMITS.maxItem - food.pack;
  run(game, { type: 'buyFood', foodId: food.id });
  assert.equal(game.inventory.flakes, LIMITS.maxItem);
  assert.equal(game.coins, before.coins - food.price.coins);
});
