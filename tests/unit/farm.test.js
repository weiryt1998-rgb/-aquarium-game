import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GRASS_PATCHES,
  MAX_COW_RECORDS,
  applyCowAction,
  buyCowBlock,
  cowAt,
  cowBlock,
  cowSellValue,
  farmAt,
  findCow,
  grassBlock,
  grazePatch,
  adultBreedOf,
  applyBarn,
  applyBirth,
  applyBreed,
  barnBlock,
  inBarn,
  birthBlock,
  breedBlock,
  canBreed,
  breedNow,
  dueAt,
  grownAt,
  isCalf,
  isCowDead,
  isPregnant,
  newCalf,
  milkValue,
  newCow,
  newGrass,
  patchAt,
  patchCenter,
  pickPatch,
  sanitizeFarm,
} from '../../src/shared/farm.js';
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

test('ฟาร์ม: จำกัดจำนวนวัว (ไม่นับตัวที่ตาย) และพันธุ์ต้องมีอยู่จริง · พันธุ์ที่เลิกขายซื้อไม่ได้', () => {
  const herd = (n, health = 100) => ({ cows: Array.from({ length: n }, (_, i) => cow({ id: `cow_${i}`, health })) });
  assert.equal(buyCowBlock(null, 'brahman'), null);
  assert.equal(buyCowBlock(null, 'brahman_calf'), null);
  assert.equal(buyCowBlock(herd(F.maxCows), 'brahman'), 'limit');
  assert.equal(buyCowBlock(herd(F.maxCows, 0), 'brahman'), null);
  assert.equal(buyCowBlock(herd(MAX_COW_RECORDS, 0), 'brahman'), 'remove-dead');
  assert.equal(buyCowBlock(null, 'unicorn'), 'invalid');
  assert.equal(buyCowBlock(null, 'holstein'), 'invalid', 'โฮลสไตน์เลิกขายแล้ว (retired)');
  assert.equal(buyCowBlock(null, 'jersey'), 'invalid', 'เจอร์ซีย์เลิกขายแล้ว (retired)');
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
  assert.deepEqual(out.cows[0], { id: 'a', breedId: 'holstein', name: 'วัวนมขาวดำ', boughtAt: T0, at: T0, satiety: 100, health: 0, milk: 0, sex: 'f', preg: 0, bredAt: 0, born: 0, barn: 0 });
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
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_a', name: '  มะลิ  ' }, T0);
  assert.equal(game.coins, 5000 - getCowBreed('brahman').price.coins);
  assert.deepEqual(game.farm.cows[0], newCow({ id: 'cow_a', breedId: 'brahman', name: 'มะลิ' }, T0));
  rejects(() => run(game, { type: 'buyCow', breedId: 'brahman_calf', cowId: 'cow_a' }, T0), 'invalid');
  rejects(() => run(game, { type: 'buyCow', breedId: 'unicorn', cowId: 'cow_b' }, T0), 'invalid');
  rejects(() => run(game, { type: 'buyCow', breedId: 'holstein', cowId: 'cow_h' }, T0), 'invalid'); // เลิกขายแล้ว
  rejects(() => run(game, { type: 'buyCow', breedId: 'jersey', cowId: 'cow_j' }, T0), 'invalid');
  rejects(() => run(makeGame({ coins: 10 }), { type: 'buyCow', breedId: 'brahman_calf', cowId: 'cow_c' }, T0), 'insufficient-funds');
  run(game, { type: 'buyCow', breedId: 'brahman_calf', cowId: 'cow_d', name: '' }, T0); // ชื่อว่าง → ใช้ชื่อสายพันธุ์
  assert.equal(findCow(game.farm, 'cow_d').name, getCowBreed('brahman_calf').name);
  assert.equal(game.coins, 5000 - getCowBreed('brahman').price.coins - getCowBreed('brahman_calf').price.coins);
});

test('คำสั่งซื้อวัว: เต็มคอก (ตัวที่ยังมีชีวิต) ไม่ได้ · ตัวตายค้างเต็มเซฟต้องนำออกก่อน', () => {
  const game = makeGame({ coins: 100_000 });
  for (let i = 0; i < F.maxCows; i++) run(game, { type: 'buyCow', breedId: 'brahman', cowId: `cow_${i}` }, T0);
  rejects(() => run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_x' }, T0), 'limit');
  const later = T0 + 40 * 24 * H; // ปล่อยจนตายหมด
  for (let i = F.maxCows; i < MAX_COW_RECORDS; i++) run(game, { type: 'buyCow', breedId: 'brahman', cowId: `cow_n${i}` }, later);
  assert.equal(game.farm.cows.length, MAX_COW_RECORDS);
  rejects(() => run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_z' }, later), 'limit');
  const r = run(game, { type: 'sellCow', cowId: 'cow_0' }, later);
  assert.equal(r.refund.coins, 0, 'วัวตายนำออกได้ 0 เหรียญ');
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_z' }, later);
});

test('คำสั่งให้ฟาง/รีดนม: ตามเวลาจริง · ราคา/รางวัลคิดฝั่งตรวจ · อิ่มอยู่/นมน้อยทำไม่ได้', () => {
  const game = makeGame({ coins: 5000 });
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_a' }, T0);
  rejects(() => run(game, { type: 'feedCow', cowId: 'cow_a' }, T0 + 1000), 'cooldown'); // เพิ่งซื้อ อิ่ม 80%
  rejects(() => run(game, { type: 'milkCow', cowId: 'cow_a' }, T0 + 1000), 'cooldown'); // ยังไม่มีนม
  rejects(() => run(game, { type: 'feedCow', cowId: 'nope' }, T0), 'not-found');
  const t = T0 + 4 * H;
  const cur = findCow(farmAt(game.farm, t), 'cow_a'); // วัวเล็มหญ้าในคอกด้วย → ใช้ค่าทั้งฟาร์ม
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
  const game = makeGame({ coins: 5000 });
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_a' }, T0);
  const coins = game.coins;
  const r = run(game, { type: 'sellCow', cowId: 'cow_a' }, T0 + 1000);
  assert.equal(r.refund.coins, Math.floor(getCowBreed('brahman').price.coins * F.sellRate));
  assert.equal(game.coins, coins + r.refund.coins);
  assert.equal(game.farm.cows.length, 0);
  assert.deepEqual(cowSellValue({ breedId: 'brahman', health: 0 }), { coins: 0 });
  // วัวพันธุ์ที่เลิกขายแล้วซึ่งมีอยู่ในเซฟเก่า ยังขายได้ตามราคาเดิม
  assert.equal(cowSellValue(cow()).coins, Math.floor(getCowBreed('holstein').price.coins * F.sellRate));
});

// ── หญ้าในคอก ──
const G = F.grass;
const sum = (a) => a.reduce((s, v) => s + v, 0);

test('หญ้า: แปลง ↔ ตำแหน่งในคอกตรงกัน · นอกคอก = -1', () => {
  for (let i = 0; i < GRASS_PATCHES; i++) {
    const c = patchCenter(i);
    assert.equal(patchAt(c.x, c.z), i);
  }
  assert.equal(patchAt(0, 50), -1);
  assert.equal(patchAt(-30, 0), -1);
});

test('หญ้า: วัวหิวเล็มหญ้า หญ้าในคอกลดลง และหิวช้ากว่าไม่มีหญ้า · อิ่มแล้วไม่กิน', () => {
  const c = cow({ satiety: 60 });
  const farm = { cows: [c], grass: newGrass(T0) };
  const later = farmAt(farm, T0 + 3 * H);
  assert.ok(sum(later.grass.g) < sum(farm.grass.g), 'หญ้าถูกกิน');
  assert.ok(findCow(later, 'cow_1').satiety > cowAt(c, T0 + 3 * H).satiety + 5, 'อิ่มกว่าวัวที่ไม่มีหญ้า');
  assert.equal(sum(farm.grass.g), GRASS_PATCHES * 100, 'ไม่แก้ object เดิม');
  // อิ่มเกิน grazeBelow → ไม่เล็ม
  const full = farmAt({ cows: [cow({ satiety: 100 })], grass: { ...newGrass(T0), w: Array(GRASS_PATCHES).fill(0) } }, T0 + 0.5 * H);
  assert.equal(sum(full.grass.g), GRASS_PATCHES * 100);
});

test('หญ้า: กินจากแปลงที่สูตรเลือก (grazePatch) · แปลงโล่งไม่เลือก · หญ้าหมดทั้งคอก = -1', () => {
  const g = Array(GRASS_PATCHES).fill(0);
  assert.equal(pickPatch(g, 'cow_1'), -1);
  g[7] = 50;
  assert.equal(pickPatch(g, 'cow_1'), 7);
  g[3] = G.minBite - 0.1;
  assert.equal(pickPatch(g, 'cow_1'), 7, 'แปลงที่เหลือน้อยกว่า minBite ไม่นับ');
  const dry = { at: T0, g: [...g], w: Array(GRASS_PATCHES).fill(0) };
  const farm = farmAt({ cows: [cow({ satiety: 50 })], grass: dry }, T0);
  assert.equal(grazePatch(farm, 'cow_1'), 7);
  const after = farmAt(farm, T0 + H);
  assert.ok(after.grass.g[7] < 50 && after.grass.g[3] === dry.g[3], 'กินแปลง 7 เท่านั้น');
  assert.equal(grazePatch(farmAt({ cows: [cow({ satiety: 95 })], grass: dry }, T0), 'cow_1'), -1, 'อิ่มแล้ว');
});

test('หญ้า: งอกใหม่เฉพาะตอนดินชื้น · ความชื้นลดตามเวลา · รดน้ำได้เมื่อแห้งลง', () => {
  const grass = { at: T0, g: Array(GRASS_PATCHES).fill(0), w: Array(GRASS_PATCHES).fill(0) };
  grass.w[2] = 100;
  const later = farmAt({ cows: [], grass }, T0 + 2 * H).grass;
  assert.equal(later.g[0], 0, 'ดินแห้ง หญ้าไม่ขึ้น');
  assert.ok(Math.abs(later.g[2] - 2 * G.growPerHour) < 1e-6, `หญ้างอก ${later.g[2]}`);
  assert.ok(Math.abs(later.w[2] - (100 - 2 * G.waterUse)) < 1e-6);
  assert.equal(grassBlock(later, 2), 'too-wet');
  assert.equal(grassBlock(later, 0), null);
  assert.equal(grassBlock(later, GRASS_PATCHES), 'invalid');
});

test('หญ้า: เซฟเก่าที่ไม่มีหญ้า = หญ้าเต็มตั้งแต่วัวตัวแรก · sanitize ตัดลิสต์ไม่ครบ/บีบค่า', () => {
  const old = farmAt({ cows: [cow({ satiety: 100 })] }, T0 + H);
  assert.equal(old.grass.g.length, GRASS_PATCHES);
  assert.equal(old.grass.at, T0 + H);
  assert.equal(sanitizeFarm({ cows: [], grass: { at: T0, g: [1, 2], w: [3] } }, T0).grass, undefined);
  const clean = sanitizeFarm({ cows: [], grass: { at: T0 + H, g: Array(GRASS_PATCHES).fill(150), w: Array(GRASS_PATCHES).fill('x') } }, T0);
  assert.deepEqual(clean.grass, { at: T0, g: Array(GRASS_PATCHES).fill(100), w: Array(GRASS_PATCHES).fill(0) });
});

test('คำสั่งรดน้ำหญ้า: ฟรี · ดินชื้นอยู่ทำไม่ได้ · แปลงผิดไม่ได้ · ยังไม่มีฟาร์มก็รดได้', () => {
  const game = makeGame({ coins: 5000 });
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_a' }, T0);
  const coins = game.coins;
  const t = T0 + 2 * H; // แปลงใหม่ชื้น startWater 40% → 16% (< wetAbove) รดได้
  run(game, { type: 'waterGrass', patch: 5, at: t }, t);
  assert.equal(game.coins, coins);
  assert.ok(game.farm.grass.w[5] > 100 - 1e-6);
  assert.equal(game.farm.grass.at, t);
  assert.equal(findCow(game.farm, 'cow_a').at, t, 'เดินเวลาวัวไปพร้อมกัน');
  rejects(() => run(game, { type: 'waterGrass', patch: 5, at: t }, t + 1000), 'cooldown');
  rejects(() => run(game, { type: 'waterGrass', patch: GRASS_PATCHES }, t), 'invalid');
  rejects(() => run(game, { type: 'waterGrass', patch: 1.5 }, t), 'invalid');
  const fresh = makeGame();
  run(fresh, { type: 'waterGrass', patch: 0 }, T0);
  assert.equal(fresh.farm.cows.length, 0, 'สร้างฟาร์มว่างพร้อมแปลงหญ้าให้');
  assert.equal(fresh.farm.grass.w[0], Math.min(100, G.startWater + G.waterAmount));
});

test('ลูกวัว: ยังไม่ให้นมจนโตครบ growHours · โตแล้วให้นมและขายได้ราคาตัวเต็มวัย', () => {
  const breed = getCowBreed('brahman_calf');
  const adult = getCowBreed(breed.calf.growsInto);
  const c = newCow({ id: 'cow_c', breedId: 'brahman_calf', name: 'น้อย' }, T0);
  const grownMs = breed.calf.growHours * H;
  assert.ok(isCalf(c, T0 + grownMs - 1000));
  assert.ok(!isCalf(c, T0 + grownMs));
  // ให้อิ่มตลอด (ใส่หญ้าไม่หมด) แล้วดูนม
  const farm = { cows: [{ ...c, satiety: 100 }], grass: { ...newGrass(T0), w: Array(GRASS_PATCHES).fill(100) } };
  assert.equal(findCow(farmAt(farm, T0 + grownMs - H), 'cow_c').milk, 0, 'ลูกวัวไม่ผลิตนม');
  assert.equal(cowAt({ ...c, satiety: 100 }, T0 + grownMs - H).milk, 0);
  const later = farmAt(farm, T0 + grownMs + 2 * H);
  assert.ok(findCow(later, 'cow_c').milk > 0, 'โตแล้วเริ่มมีนม');
  const young = cowSellValue({ ...c, at: T0 + H });
  const grown = cowSellValue({ ...c, at: T0 + grownMs + H });
  assert.equal(young.coins, Math.floor(breed.price.coins * F.sellRate));
  assert.equal(grown.coins, Math.floor(adult.price.coins * F.sellRate));
});

test('ผสมพันธุ์ได้เฉพาะสายพันธุ์ที่มี canBreed (บราห์มัน) · ซื้อตัวผู้ได้เฉพาะสายพันธุ์นั้น', () => {
  const t = T0 + 100 * H;
  const mk = (id, breedId, sex) => ({ ...newCow({ id, breedId, name: 'x', sex }, T0), at: t, satiety: 90 });
  assert.equal(breedBlock(mk('a', 'brahman', 'f'), mk('b', 'brahman', 'm'), t), null);
  assert.equal(breedBlock(mk('a', 'holstein', 'f'), mk('b', 'brahman', 'm'), t), 'breed');
  assert.equal(breedBlock(mk('a', 'brahman', 'f'), mk('b', 'jersey', 'm'), t), 'breed');
  assert.ok(canBreed(mk('c', 'brahman_calf', 'f')), 'ลูกวัวบราห์มันที่ซื้อ = บราห์มัน');
  const game = makeGame({ coins: 100_000 });
  rejects(() => run(game, { type: 'buyCow', breedId: 'holstein', cowId: 'cow_h', sex: 'm' }, T0), 'invalid');
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_b', sex: 'm' }, T0);
  assert.equal(findCow(game.farm, 'cow_b').sex, 'm');
});

test('sanitizeGame เก็บฟาร์มไว้ (และตัด record เกิน MAX_COW_RECORDS)', () => {
  const game = makeGame({ coins: 100 });
  game.farm = { cows: Array.from({ length: 12 }, (_, i) => newCow({ id: `cow_${i}`, breedId: 'holstein', name: 'x' }, T0)) };
  const clean = sanitizeGame(game, { now: T0 });
  assert.equal(clean.farm.cows.length, MAX_COW_RECORDS);
  assert.equal(sanitizeGame(makeGame(), { now: T0 }).farm, undefined);
});

// ── เพศ / ผสมพันธุ์ / คลอด ──
const B = F.breeding;
const bull = (overrides = {}) => ({ ...newCow({ id: 'bull_1', breedId: 'brahman', name: 'ทอง', sex: 'm' }, T0), satiety: 90, ...overrides });
const dam = (overrides = {}) => cow({ breedId: 'brahman', satiety: 90, ...overrides });
/** ฟาร์มที่หญ้าเต็มและดินชื้นตลอด (วัวอิ่มเสมอ) */
const lushFarm = (cows) => ({ cows, grass: { ...newGrass(T0), w: Array(GRASS_PATCHES).fill(100) } });

test('เพศ: เซฟเก่าไม่มี sex/preg/bredAt/born → แม่วัว ไม่ท้อง ซื้อมา · ค่าเสียถูกตัด', () => {
  const out = sanitizeFarm(
    {
      cows: [
        { id: 'a', breedId: 'holstein', at: T0, satiety: 50, health: 100, milk: 0 },
        { id: 'b', breedId: 'jersey', at: T0, sex: 'x', preg: -5, bredAt: 'y', born: T0 + 99 * H },
        { id: 'c', breedId: 'brahman', at: T0, sex: 'm', preg: T0 - H, bredAt: T0 - H },
      ],
    },
    T0,
  );
  const [a, b, c] = out.cows;
  assert.deepEqual([a.sex, a.preg, a.bredAt, a.born], ['f', 0, 0, 0]);
  assert.deepEqual([b.sex, b.preg, b.bredAt, b.born], ['f', 0, 0, T0], 'เวลาล้ำอนาคตถูกบีบไม่เกิน at');
  assert.deepEqual([c.sex, c.preg, c.bredAt], ['m', 0, T0 - H], 'พ่อพันธุ์ไม่มีท้อง');
  assert.deepEqual(newCow({ id: 'x', breedId: 'holstein', name: 'x' }, T0), { ...newCow({ id: 'x', breedId: 'holstein', name: 'x', sex: 'f' }, T0) });
});

test('เพศ: พ่อพันธุ์ไม่ผลิตนม (cowAt และ farmAt) · คำสั่งรีดนมถูกปฏิเสธ', () => {
  const b = bull({ satiety: 100 });
  assert.equal(cowAt(b, T0 + 3 * H).milk, 0);
  assert.equal(findCow(farmAt(lushFarm([b]), T0 + 3 * H), 'bull_1').milk, 0);
  assert.equal(cowBlock('milk', bull({ milk: 100 })), 'male');
  assert.equal(cowBlock('feed', bull({ satiety: 10 })), null, 'ให้ฟางพ่อพันธุ์ได้');

  const game = makeGame({ coins: 10_000 });
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_m', sex: 'm' }, T0);
  assert.equal(findCow(game.farm, 'cow_m').sex, 'm');
  rejects(() => run(game, { type: 'milkCow', cowId: 'cow_m', at: T0 + 5 * H }, T0 + 5 * H), 'invalid');
  rejects(() => run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_q', sex: 'q' }, T0), 'invalid');
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_f' }, T0);
  assert.equal(findCow(game.farm, 'cow_f').sex, 'f', 'ไม่ระบุเพศ = แม่วัว');
});

test('ผสมพันธุ์: breedBlock ตรวจเพศ อายุ ท้อง ช่วงพัก ความแข็งแรง · ลูกวัวบราห์มันที่ซื้อแล้วโตผสมได้', () => {
  const now = T0 + H;
  assert.equal(breedBlock(dam(), bull(), now), null);
  const grownCalf = dam({ breedId: 'brahman_calf' });
  assert.equal(breedBlock(grownCalf, bull(), now), 'young');
  assert.equal(breedBlock(grownCalf, bull(), T0 + 48 * H), null, 'brahman_calf โตแล้ว = บราห์มัน');
  assert.equal(breedBlock(null, bull(), now), 'not-found');
  assert.equal(breedBlock(dam({ health: 0 }), bull(), now), 'dead');
  assert.equal(breedBlock(bull(), bull({ id: 'b2' }), now), 'not-female');
  assert.equal(breedBlock(dam(), dam({ id: 'c2' }), now), 'not-male');
  const calf = newCow({ id: 'k', breedId: 'brahman_calf', name: 'k', sex: 'm' }, T0);
  assert.equal(breedBlock(dam(), { ...calf, satiety: 90 }, now), 'young');
  assert.equal(breedBlock(dam({ born: T0 }), bull(), now), 'young', 'ลูกวัวเกิดในฟาร์มยังไม่โต');
  assert.equal(breedBlock(dam({ preg: T0 }), bull(), now), 'pregnant');
  assert.equal(breedBlock(dam(), bull({ bredAt: now - (B.cooldownHours * H - 60_000) }), now), 'cooldown');
  assert.equal(breedBlock(dam({ bredAt: now - B.cooldownHours * H }), bull(), now), null, 'พักครบแล้ว');
  assert.equal(breedBlock(dam({ health: B.minHealth - 1 }), bull(), now), 'weak');
  assert.equal(breedBlock(dam(), bull({ satiety: B.minSatiety - 1 }), now), 'weak');
  assert.equal(breedBlock(dam({ health: B.minHealth - 1 }), bull(), now, { strict: false }), null, 'ฝั่งตรวจเผื่อค่าคลาด');

  const { cow: c2, bull: b2 } = applyBreed(dam(), bull(), now);
  assert.ok(isPregnant(c2) && c2.preg === now && c2.bredAt === now && b2.bredAt === now && b2.preg === 0);
  assert.equal(dueAt(c2), now + B.gestationHours * H);
  assert.equal(dueAt(dam()), Infinity);
});

test('คำสั่งผสมพันธุ์: ฟรี · แก้ทั้งแม่และพ่อ · ผสมซ้ำ/เพศผิด/ไม่พบไม่ได้', () => {
  const game = makeGame({ coins: 10_000 });
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_f', sex: 'f' }, T0);
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_m', sex: 'm' }, T0);
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_f2' }, T0);
  game.farm.cows.push(newCow({ id: 'cow_h', breedId: 'holstein', name: 'เก่า' }, T0)); // วัวโฮลสไตน์จากเซฟเก่า
  const coins = game.coins;
  const t = T0 + H;
  rejects(() => run(game, { type: 'breedCow', cowId: 'cow_h', bullId: 'cow_m', at: t }, t), 'invalid'); // สายพันธุ์ผสมไม่ได้
  rejects(() => run(game, { type: 'breedCow', cowId: 'cow_m', bullId: 'cow_f', at: t }, t), 'invalid');
  rejects(() => run(game, { type: 'breedCow', cowId: 'cow_f', bullId: 'nope', at: t }, t), 'not-found');
  run(game, { type: 'breedCow', cowId: 'cow_f', bullId: 'cow_m', at: t, preg: 1, coins: 999 }, t); // ฟิลด์แปลก ๆ ถูกเมิน
  assert.equal(game.coins, coins);
  const f = findCow(game.farm, 'cow_f');
  const m = findCow(game.farm, 'cow_m');
  assert.deepEqual([f.preg, f.bredAt, m.bredAt, m.preg], [t, t, t, 0]);
  rejects(() => run(game, { type: 'breedCow', cowId: 'cow_f', bullId: 'cow_m', at: t + H }, t + H), 'cooldown'); // ท้องแล้ว
  rejects(() => run(game, { type: 'breedCow', cowId: 'cow_f2', bullId: 'cow_m', at: t + H }, t + H), 'cooldown'); // พ่อยังพัก
});

test('คำสั่งคลอด: ก่อนครบกำหนดไม่ได้ · ครบแล้วได้ลูกวัวสายพันธุ์แม่ (born) และแม่หายท้อง · คอกเต็มไม่ได้', () => {
  const game = makeGame({ coins: 20_000 });
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_f' }, T0);
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_m', sex: 'm' }, T0);
  run(game, { type: 'breedCow', cowId: 'cow_f', bullId: 'cow_m', at: T0 }, T0);
  const due = T0 + B.gestationHours * H;
  const birth = (extra = {}, now = due) => run(game, { type: 'birthCalf', cowId: 'cow_f', calfId: 'calf_1', name: ' หนูน้อย ', sex: 'm', at: now, ...extra }, now);
  rejects(() => birth({}, due - H), 'cooldown');
  rejects(() => run(game, { type: 'birthCalf', cowId: 'cow_m', calfId: 'calf_1', sex: 'f', at: due }, due), 'invalid'); // พ่อพันธุ์ไม่ได้ท้อง
  rejects(() => birth({ sex: 'x' }), 'invalid');
  rejects(() => birth({ calfId: 'cow_m' }), 'invalid'); // id ซ้ำ
  birth();
  const calf = findCow(game.farm, 'calf_1');
  assert.equal(calf.breedId, 'brahman');
  assert.deepEqual([calf.sex, calf.born, calf.boughtAt, calf.preg, calf.bredAt, calf.name, calf.satiety], ['m', due, due, 0, 0, 'หนูน้อย', 80]);
  assert.equal(findCow(game.farm, 'cow_f').preg, 0);
  rejects(() => birth({ calfId: 'calf_2' }), 'invalid'); // ไม่ได้ท้องแล้ว

  // คอกเต็ม (วัวมีชีวิต = maxCows) → คลอดไม่ได้
  const full = lushFarm([dam({ preg: T0 }), ...Array.from({ length: F.maxCows - 1 }, (_, i) => cow({ id: `x_${i}`, satiety: 100 }))]);
  assert.equal(birthBlock(full, full.cows[0], due), 'limit');
  assert.equal(birthBlock(lushFarm([dam({ preg: T0 })]), dam({ preg: T0 }), due - 1000, { strict: false }), null, 'ฝั่งตรวจเผื่อเวลา');
  assert.equal(birthBlock(lushFarm([dam()]), dam(), due), 'not-pregnant');
  const g2 = makeGame({ coins: 0 });
  g2.farm = full;
  rejects(() => run(g2, { type: 'birthCalf', cowId: 'cow_1', calfId: 'calf_9', sex: 'f', at: due }, due), 'limit');
});

test('ลูกวัวเกิดในฟาร์ม: เป็นลูกวัวจนครบ growHours (ไม่ให้นม ผสมไม่ได้) แล้วโตเป็นสายพันธุ์แม่ · ขายครึ่งราคาตอนยังเล็ก', () => {
  const mother = dam({ breedId: 'brahman_calf', preg: T0 }); // แม่ซื้อมาเป็นลูกวัว → ลูกเป็นบราห์มันตัวเต็มวัย
  assert.equal(adultBreedOf(mother).id, 'brahman');
  const calf = newCalf({ id: 'k1', name: 'เล็ก', sex: 'f' }, mother, T0);
  assert.equal(calf.breedId, 'brahman');
  assert.equal(grownAt(calf), T0 + B.growHours * H);
  assert.ok(isCalf(calf, T0 + B.growHours * H - 1000));
  assert.ok(!isCalf(calf, T0 + B.growHours * H));
  assert.equal(breedNow(calf, T0).id, 'brahman');
  assert.equal(adultBreedOf(calf).young.file, 'models/farm/brahman_calf.glb');
  assert.equal(applyBirth(mother, T0 + H).preg, 0);

  const farm = lushFarm([{ ...calf, satiety: 100 }]);
  assert.equal(findCow(farmAt(farm, T0 + B.growHours * H - H), 'k1').milk, 0, 'ลูกวัวไม่ผลิตนม');
  assert.ok(findCow(farmAt(farm, T0 + B.growHours * H + 2 * H), 'k1').milk > 0, 'โตแล้ว (ตัวเมีย) ให้นม');

  const price = getCowBreed('brahman').price.coins;
  assert.equal(cowSellValue({ ...calf, at: T0 + H }).coins, Math.floor(price * 0.5 * F.sellRate));
  assert.equal(cowSellValue({ ...calf, at: T0 + B.growHours * H }).coins, Math.floor(price * F.sellRate));
});

test('สายพันธุ์: ตัวเต็มวัยมี young (หน้าตาลูกวัว) · brahman_calf โตเป็น brahman และยังซื้อได้', () => {
  for (const b of COW_BREEDS.filter((x) => !x.calf)) assert.ok(b.young?.scale > 0 && b.young.drinkReach > 0 && b.young.walkClipSpeed > 0, b.id);
  assert.deepEqual(getCowBreed('brahman_calf').calf, { growsInto: 'brahman', growHours: 48 });
  assert.equal(adultBreedOf({ breedId: 'brahman_calf' }).id, 'brahman');
  assert.equal(adultBreedOf({ breedId: 'jersey' }).id, 'jersey');
  const game = makeGame({ coins: 5000 });
  run(game, { type: 'buyCow', breedId: 'brahman_calf', cowId: 'cow_c' }, T0);
  const c = findCow(game.farm, 'cow_c');
  assert.equal(c.born, 0);
  assert.ok(isCalf(c, T0 + H) && !isCalf(c, T0 + 48 * H));
});

test('โรงนา: พาเข้า/ปล่อยออก · ในโรงนาไม่เล็มหญ้า · ผสมพันธุ์ไม่ได้ · ลูกเกิดในโรงนาอยู่โรงนา · คอกในโรงนามีจำกัด', () => {
  const game = makeGame({ coins: 20_000 });
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_f' }, T0);
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_m', sex: 'm' }, T0);
  assert.equal(findCow(game.farm, 'cow_f').barn, 0);
  rejects(() => run(game, { type: 'barnCow', cowId: 'cow_f', in: 'yes', at: T0 }, T0), 'invalid');
  rejects(() => run(game, { type: 'barnCow', cowId: 'nope', in: true, at: T0 }, T0), 'not-found');
  rejects(() => run(game, { type: 'barnCow', cowId: 'cow_f', in: false, at: T0 }, T0), 'invalid'); // อยู่ข้างนอกแล้ว
  run(game, { type: 'barnCow', cowId: 'cow_f', in: true, at: T0 + H }, T0 + H);
  assert.ok(inBarn(findCow(game.farm, 'cow_f')));
  rejects(() => run(game, { type: 'barnCow', cowId: 'cow_f', in: true, at: T0 + H }, T0 + H), 'invalid'); // อยู่ในโรงนาแล้ว
  const t = T0 + 2 * H;
  rejects(() => run(game, { type: 'breedCow', cowId: 'cow_f', bullId: 'cow_m', at: t }, t), 'invalid');
  run(game, { type: 'barnCow', cowId: 'cow_f', in: false, at: t }, t);
  assert.equal(findCow(game.farm, 'cow_f').barn, 0);

  // ในโรงนาไม่เล็มหญ้า: วัวหิวในโรงนาความอิ่มไม่เพิ่ม หญ้าไม่ลด
  const hungry = { ...cow({ id: 'h', satiety: 10 }), barn: 1 };
  const farm = lushFarm([hungry]);
  const later = farmAt(farm, T0 + H);
  assert.ok(findCow(later, 'h').satiety < 10);
  assert.deepEqual(later.grass.g, farmAt(lushFarm([]), T0 + H).grass.g);
  assert.equal(grazePatch(farm, 'h'), -1);

  // ลูกที่เกิดในโรงนาอยู่ในโรงนา
  assert.equal(newCalf({ id: 'k', name: 'ก', sex: 'f' }, { ...dam(), barn: 1 }, T0).barn, 1);
  assert.equal(applyBarn(dam(), true, T0 + H).at, T0 + H);

  // คอกในโรงนาเต็ม
  const many = lushFarm(Array.from({ length: F.barnStalls }, (_, i) => ({ ...cow({ id: `b_${i}` }), barn: 1 })).concat([cow({ id: 'out' })]));
  assert.equal(barnBlock(many, findCow(many, 'out'), true), 'barn-full');
  assert.equal(barnBlock(many, findCow(many, 'b_0'), false), null);

  // เซฟเสีย: barn แปลก ๆ = ข้างนอก
  const clean = sanitizeFarm({ cows: [{ ...cow({ id: 'z' }), barn: 'x' }, { ...cow({ id: 'y' }), barn: 1 }] }, T0);
  assert.deepEqual(clean.cows.map((c) => c.barn), [0, 1]);
});

test('คำสั่งตั้งชื่อวัว: ตัดช่องว่าง/ยาวเกิน 16 · ว่าง = ชื่อสายพันธุ์ · ไม่มีวัว = not-found · ไม่เสียเงิน', () => {
  const game = makeGame({ coins: 5000 });
  run(game, { type: 'buyCow', breedId: 'brahman', cowId: 'cow_a', name: 'มะลิ' }, T0);
  const coins = game.coins;
  run(game, { type: 'renameCow', cowId: 'cow_a', name: '  ดอกแก้ว  ' }, T0 + 1000);
  assert.equal(game.farm.cows[0].name, 'ดอกแก้ว');
  run(game, { type: 'renameCow', cowId: 'cow_a', name: 'ก'.repeat(30) }, T0 + 2000);
  assert.equal(game.farm.cows[0].name, 'ก'.repeat(16));
  run(game, { type: 'renameCow', cowId: 'cow_a', name: '   ' }, T0 + 3000);
  assert.equal(game.farm.cows[0].name, getCowBreed('brahman').name);
  assert.equal(game.coins, coins);
  rejects(() => run(game, { type: 'renameCow', cowId: 'cow_x', name: 'ใคร' }, T0), 'not-found');
});
