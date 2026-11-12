import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_COW_RECORDS, applyCowAction, buyCowBlock, cowAt, cowBlock, cowSellValue, farmAt, findCow, isCowDead, milkValue, newCow, sanitizeFarm } from '../../src/shared/farm.js';
import { COW_BREEDS, getCowBreed } from '../../src/data/animals.js';
import { CONFIG } from '../../src/config.js';
import { applyCommand } from '../../src/shared/commands.js';
import { CommandError } from '../../src/shared/economy.js';
import { sanitizeGame } from '../../src/shared/sanitize.js';
import { T0, ctxAt, makeGame } from '../helpers/fixtures.js';

const H = 3_600_000;
const F = CONFIG.farm;
const cow = (overrides = {}) => ({ ...newCow({ id: 'cow_1', breedId: 'holstein', name: 'มะลิ' }, T0), ...overrides });

test('วัว: หิวตามเวลาจริง ท้องว่างแล้วสุขภาพลดจนตาย และตายแล้วไม่ฟื้น', () => {
  const c = cow({ satiety: 100 });
  const emptyAt = (100 / F.hungerUse) * H;
  assert.ok(cowAt(c, T0 + emptyAt - 10 * 60_000).satiety > 0);
  const empty = cowAt(c, T0 + emptyAt + 60_000);
  assert.equal(empty.satiety, 0);
  assert.ok(empty.health > 99, 'เพิ่งหิว สุขภาพยังดี');
  assert.ok(isCowDead(cowAt(c, T0 + emptyAt + (100 / F.starveDamage) * H + H)));
  assert.equal(cowAt(c, T0 + 40 * 24 * H).health, 0);
});

test('วัว: อิ่มแล้วนมเพิ่มตามสายพันธุ์ · ไม่แก้ object เดิม', () => {
  const c = cow({ satiety: 100 });
  const later = cowAt(c, T0 + 2 * H);
  const breed = getCowBreed('holstein');
  assert.ok(Math.abs(later.milk - breed.milkPerHour * 2) < 0.01, `นม ${later.milk}`);
  assert.equal(c.milk, 0);
  assert.equal(later.at, T0 + 2 * H);
});

test('วัว: ให้ฟาง/รีดนมตรวจเงื่อนไขก่อน และรีดนมได้เหรียญตามสัดส่วน', () => {
  assert.equal(cowBlock('feed', cow({ satiety: 90 })), 'too-full');
  assert.equal(cowBlock('feed', cow({ satiety: 10 })), null);
  assert.equal(cowBlock('milk', cow({ milk: F.milkMin - 1 })), 'not-ready');
  assert.equal(cowBlock('milk', cow({ milk: F.milkMin - 1 }), { strict: false }), null, 'ฝั่งตรวจเผื่อค่าคลาด');
  assert.equal(cowBlock('milk', cow({ health: 0, milk: 100 })), 'dead');
  assert.equal(cowBlock('milk', null), 'not-found');

  const full = cow({ milk: 100 });
  const { cow: after, reward } = applyCowAction('milk', full, T0 + H);
  assert.equal(reward.coins, getCowBreed('holstein').milkReward.coins);
  assert.equal(after.milk, 0);
  assert.equal(milkValue(cow({ milk: 50 })), Math.floor(getCowBreed('holstein').milkReward.coins / 2));

  const fed = applyCowAction('feed', cow({ satiety: 20 }), T0).cow;
  assert.equal(fed.satiety, 20 + F.hayAmount);
});

test('ฟาร์ม: จำกัดจำนวนวัว (ไม่นับตัวที่ตาย) และพันธุ์ต้องมีอยู่จริง', () => {
  const herd = (n, health = 100) => ({ cows: Array.from({ length: n }, (_, i) => cow({ id: `cow_${i}`, health })) });
  assert.equal(buyCowBlock(null, 'holstein'), null);
  assert.equal(buyCowBlock(herd(F.maxCows), 'holstein'), 'limit');
  assert.equal(buyCowBlock(herd(F.maxCows, 0), 'holstein'), null);
  assert.equal(buyCowBlock(herd(MAX_COW_RECORDS, 0), 'holstein'), 'remove-dead');
  assert.equal(buyCowBlock(null, 'unicorn'), 'invalid');
  assert.equal(farmAt(null, T0), null);
  assert.equal(farmAt(herd(2), T0 + H).cows.length, 2);
});

test('ฟาร์ม: sanitize ตัดค่าเสีย / id ซ้ำ / พันธุ์ที่ไม่มี และบีบค่าเข้าช่วง', () => {
  assert.equal(sanitizeFarm(null, T0), null);
  assert.equal(sanitizeFarm({ cows: 'x' }, T0), null);
  const out = sanitizeFarm(
    {
      cows: [
        { id: 'a', breedId: 'holstein', name: '  ', at: T0 + 99 * H, satiety: 250, health: -5, milk: 'x' },
        { id: 'a', breedId: 'holstein', at: T0 },
        { id: 'b', breedId: 'unicorn', at: T0 },
        { id: 'bad id!', breedId: 'jersey', at: T0 },
      ],
    },
    T0,
  );
  assert.equal(out.cows.length, 1);
  assert.deepEqual(out.cows[0], { id: 'a', breedId: 'holstein', name: 'วัวนมขาวดำ', boughtAt: T0, at: T0, satiety: 100, health: 0, milk: 0 });
});

test('ข้อมูลสายพันธุ์วัวครบทุกฟิลด์ที่กฎใช้', () => {
  const ids = new Set();
  for (const b of COW_BREEDS) {
    assert.ok(!ids.has(b.id), `id ซ้ำ ${b.id}`);
    ids.add(b.id);
    assert.ok(b.price.coins > 0 && b.milkPerHour > 0 && b.milkReward.coins > 0, b.id);
  }
});

// ── คำสั่งเซฟกลาง ──
const run = (game, cmd, now) => applyCommand(game, { tanks: {}, writers: {} }, cmd, ctxAt(now));
const rejects = (fn, code) => assert.throws(fn, (err) => err instanceof CommandError && err.code === code);

test('คำสั่งซื้อวัว: หักราคาสายพันธุ์ฝั่งตรวจ · id ซ้ำ/พันธุ์ไม่มี/เงินไม่พอไม่ได้ · ชื่อถูกตัด', () => {
  const game = makeGame({ coins: 5000 });
  run(game, { type: 'buyCow', breedId: 'holstein', cowId: 'cow_a', name: '  มะลิ  ' }, T0);
  assert.equal(game.coins, 5000 - getCowBreed('holstein').price.coins);
  assert.deepEqual(game.farm.cows[0], newCow({ id: 'cow_a', breedId: 'holstein', name: 'มะลิ' }, T0));
  rejects(() => run(game, { type: 'buyCow', breedId: 'holstein', cowId: 'cow_a' }, T0), 'invalid');
  rejects(() => run(game, { type: 'buyCow', breedId: 'unicorn', cowId: 'cow_b' }, T0), 'invalid');
  rejects(() => run(makeGame({ coins: 10 }), { type: 'buyCow', breedId: 'jersey', cowId: 'cow_c' }, T0), 'insufficient-funds');
  run(game, { type: 'buyCow', breedId: 'jersey', cowId: 'cow_d', name: '' }, T0); // ชื่อว่าง → ใช้ชื่อสายพันธุ์
  assert.equal(findCow(game.farm, 'cow_d').name, getCowBreed('jersey').name);
});

test('คำสั่งซื้อวัว: เต็มคอก (ตัวที่ยังมีชีวิต) ไม่ได้ · ตัวตายค้างเต็มเซฟต้องนำออกก่อน', () => {
  const game = makeGame({ coins: 100_000 });
  for (let i = 0; i < F.maxCows; i++) run(game, { type: 'buyCow', breedId: 'holstein', cowId: `cow_${i}` }, T0);
  rejects(() => run(game, { type: 'buyCow', breedId: 'holstein', cowId: 'cow_x' }, T0), 'limit');
  const later = T0 + 40 * 24 * H; // ปล่อยจนตายหมด
  for (let i = F.maxCows; i < MAX_COW_RECORDS; i++) run(game, { type: 'buyCow', breedId: 'holstein', cowId: `cow_n${i}` }, later);
  assert.equal(game.farm.cows.length, MAX_COW_RECORDS);
  rejects(() => run(game, { type: 'buyCow', breedId: 'holstein', cowId: 'cow_z' }, later), 'limit');
  const r = run(game, { type: 'sellCow', cowId: 'cow_0' }, later);
  assert.equal(r.refund.coins, 0, 'วัวตายนำออกได้ 0 เหรียญ');
  run(game, { type: 'buyCow', breedId: 'holstein', cowId: 'cow_z' }, later);
});

test('คำสั่งให้ฟาง/รีดนม: ตามเวลาจริง · ราคา/รางวัลคิดฝั่งตรวจ · อิ่มอยู่/นมน้อยทำไม่ได้', () => {
  const game = makeGame({ coins: 2000 });
  run(game, { type: 'buyCow', breedId: 'holstein', cowId: 'cow_a' }, T0);
  rejects(() => run(game, { type: 'feedCow', cowId: 'cow_a' }, T0 + 1000), 'cooldown'); // เพิ่งซื้อ อิ่ม 80%
  rejects(() => run(game, { type: 'milkCow', cowId: 'cow_a' }, T0 + 1000), 'cooldown'); // ยังไม่มีนม
  rejects(() => run(game, { type: 'feedCow', cowId: 'nope' }, T0), 'not-found');
  const t = T0 + 4 * H;
  const cur = cowAt(findCow(game.farm, 'cow_a'), t);
  const coins = game.coins;
  run(game, { type: 'feedCow', cowId: 'cow_a', at: t }, t);
  assert.equal(game.coins, coins - F.hayPrice.coins);
  assert.ok(Math.abs(findCow(game.farm, 'cow_a').satiety - Math.min(100, cur.satiety + F.hayAmount)) < 1e-9);
  const r = run(game, { type: 'milkCow', cowId: 'cow_a', at: t }, t);
  assert.equal(r.reward.coins, milkValue(cur));
  assert.equal(game.coins, coins - F.hayPrice.coins + r.reward.coins);
  assert.equal(findCow(game.farm, 'cow_a').milk, 0);
  // เวลาจากเครื่องที่ล้ำอนาคตถูกบีบไม่ให้เกินเวลาฝั่งตรวจ
  rejects(() => run(game, { type: 'milkCow', cowId: 'cow_a', at: t + 10 * H }, t + 1000), 'cooldown');
});

test('คำสั่งขายวัว: คืนเงินตามราคา × sellRate ลดตามสุขภาพ · วัวหายจากคอก', () => {
  const game = makeGame({ coins: 2000 });
  run(game, { type: 'buyCow', breedId: 'jersey', cowId: 'cow_a' }, T0);
  const coins = game.coins;
  const r = run(game, { type: 'sellCow', cowId: 'cow_a' }, T0 + 1000);
  assert.equal(r.refund.coins, Math.floor(getCowBreed('jersey').price.coins * F.sellRate));
  assert.equal(game.coins, coins + r.refund.coins);
  assert.equal(game.farm.cows.length, 0);
  assert.deepEqual(cowSellValue({ breedId: 'jersey', health: 0 }), { coins: 0 });
});

test('sanitizeGame เก็บฟาร์มไว้ (และตัด record เกิน MAX_COW_RECORDS)', () => {
  const game = makeGame({ coins: 100 });
  game.farm = { cows: Array.from({ length: 12 }, (_, i) => newCow({ id: `cow_${i}`, breedId: 'holstein', name: 'x' }, T0)) };
  const clean = sanitizeGame(game, { now: T0 });
  assert.equal(clean.farm.cows.length, MAX_COW_RECORDS);
  assert.equal(sanitizeGame(makeGame(), { now: T0 }).farm, undefined);
});
