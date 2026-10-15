import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialGame, sanitizeGame } from '../../src/shared/sanitize.js';
import { isId } from '../../src/shared/economy.js';
import { T0 } from '../helpers/fixtures.js';

test('เปลือกหอย: เก็บเวลาไข่มุกไว้ ตัดชิ้นที่เกินตู้ละ 1 และไม่เพิ่ม pearlAt ให้ของชิ้นอื่น', () => {
  const raw = legacySave();
  raw.tanks[0].decor.push(
    { id: 'decor_s1', itemId: 'seashell', x: 0, z: 0, rotY: 0, pearlAt: T0 - 5000 },
    { id: 'decor_s2', itemId: 'seashell', x: 2, z: 0, rotY: 0, pearlAt: T0 },
    { id: 'decor_s3', itemId: 'seashell', x: -2, z: 0, rotY: 0, pearlAt: T0 + 9e9 },
  );
  const decor = sanitizeGame(raw, { now: T0 }).tanks[0].decor;
  assert.deepEqual(decor.map((d) => d.id), ['decor_1', 'decor_s1']);
  assert.equal(decor[1].pearlAt, T0 - 5000);
  assert.equal('pearlAt' in decor[0], false);
  // เวลาในอนาคตถูกบีบไม่ให้เกินตอนนี้
  raw.tanks[0].decor = [{ id: 'decor_s3', itemId: 'seashell', x: 0, z: 0, rotY: 0, pearlAt: T0 + 9e9 }];
  assert.equal(sanitizeGame(raw, { now: T0 }).tanks[0].decor[0].pearlAt, T0);
});

/** เซฟรูปแบบเดิมใน localStorage (เวอร์ชัน 1) */
const legacySave = () => ({
  version: 1,
  coins: 4321,
  gems: 12,
  inventory: { flakes: 7, pellets: 2, bloodworm: 0, medicine: 3 },
  selectedFood: 'pellets',
  collection: { goldfish: true, neon: true },
  tanks: [
    {
      id: 'tank_abc',
      typeId: 'starter',
      name: 'ตู้เริ่มต้น',
      cleanliness: 77,
      fish: [
        { id: 'fish_1', speciesId: 'goldfish', name: 'ส้ม', gender: 'f', satiety: 60, health: 90, growth: 1, age: 500, breedCooldown: 0, coinTimer: 12 },
        { id: 'fish_2', speciesId: 'neon', name: 'ฟ้า', gender: 'm', satiety: 55, health: 80, growth: 0.4, age: 100, breedCooldown: 30, coinTimer: 3 },
      ],
      decor: [{ id: 'decor_1', itemId: 'castle', x: 1, z: 0.5, rotY: 0.785 }],
      lastUpdate: T0 - 1000,
    },
  ],
  activeTankId: 'tank_abc',
  missions: { day: '2026-10-11', progress: { d_feed: 3 }, claimed: { a_tank: true } },
  dailyRewardDay: '2026-10-11',
  lastCleanAt: T0 - 5000,
  stats: { feeds: 9, coinsCollected: 20, fishBorn: 0, fishBought: 2 },
  settings: { sound: false, ambient: true, quality: 'low' },
  lastSaved: T0 - 1000,
});

test('นำเข้าเซฟเก่า: เก็บข้อมูลเดิมครบ และตัดการตั้งค่าของเครื่องออก', () => {
  const g = sanitizeGame(legacySave(), { now: T0 });
  assert.equal(g.coins, 4321);
  assert.equal(g.gems, 12);
  assert.deepEqual(g.inventory, { flakes: 7, pellets: 2, bloodworm: 0, medicine: 3 });
  assert.equal(g.selectedFood, 'pellets');
  assert.equal(g.tanks.length, 1);
  assert.equal(g.tanks[0].fish.length, 2);
  assert.deepEqual(g.tanks[0].fish[0], legacySave().tanks[0].fish[0]);
  assert.deepEqual(g.tanks[0].decor[0], legacySave().tanks[0].decor[0]);
  assert.equal(g.activeTankId, 'tank_abc');
  assert.deepEqual(g.missions.claimed, { a_tank: true });
  assert.equal(g.missions.progress.d_feed, 3);
  assert.equal('settings' in g, false);
});

test('ข้อมูลผิดรูปแบบ/เกินจริงถูกทำให้ถูกต้อง ไม่ทำให้เกมพัง', () => {
  const raw = legacySave();
  raw.coins = 1e15;
  raw.gems = -50;
  raw.inventory.flakes = 'lots';
  raw.selectedFood = 'cake';
  raw.collection.dragon = true;
  raw.tanks[0].fish.push({ id: 'fish_1', speciesId: 'goldfish', satiety: 500, health: NaN, growth: 7, gender: '?' }); // id ซ้ำ + ค่าผิด
  raw.tanks[0].fish.push({ id: 'fish_x', speciesId: 'shark' }); // ไม่รู้จัก
  raw.tanks[0].fish.push(...Array.from({ length: 30 }, (_, i) => ({ id: `fish_m${i}`, speciesId: 'neon' }))); // เกินความจุ
  raw.tanks[0].decor.push({ id: 'decor_2', itemId: 'castle', x: 500, z: -500, rotY: 'x' });
  raw.tanks.push({ id: 'tank_dup', typeId: 'starter', fish: [], decor: [] }); // ตู้ชนิดซ้ำ
  raw.missions.progress.d_feed = 999;
  raw.activeTankId = 'tank_missing';
  const g = sanitizeGame(raw, { now: T0 });
  assert.equal(g.coins, 1_000_000_000);
  assert.equal(g.gems, 0, 'ค่าติดลบถูกบีบเป็น 0');
  assert.equal(g.inventory.flakes, 25);
  assert.equal(g.selectedFood, 'flakes');
  assert.equal(g.collection.dragon, undefined);
  assert.equal(g.tanks.length, 1);
  const fish = g.tanks[0].fish;
  assert.equal(fish.length, 14);
  assert.equal(new Set(fish.map((f) => f.id)).size, fish.length);
  const fixed = fish[2];
  assert.equal(fixed.satiety, 100);
  assert.equal(fixed.health, 100);
  assert.equal(fixed.growth, 1);
  assert.equal(fixed.gender, 'f');
  assert.ok(Math.abs(g.tanks[0].decor[1].x) <= 6);
  assert.equal(g.tanks[0].decor[1].rotY, 0);
  assert.equal(g.missions.progress.d_feed, 5);
  assert.equal(g.activeTankId, 'tank_abc');
});

test('ข้อมูลว่าง/ขยะ → ได้เซฟเริ่มต้นที่ใช้งานได้', () => {
  for (const junk of [null, 42, 'x', [], {}, { tanks: 'no' }]) {
    const g = sanitizeGame(junk, { now: T0 });
    assert.equal(g.tanks.length, 1);
    assert.equal(g.tanks[0].typeId, 'starter');
    assert.equal(g.activeTankId, g.tanks[0].id);
  }
});

test('เซฟเริ่มต้นของเกมใหม่เหมือนเดิม (ตู้เริ่มต้น ปลา 10 ตัว ของตกแต่ง 17 ชิ้น เงิน 1250)', () => {
  const g = createInitialGame({ now: T0 });
  assert.equal(g.coins, 1250);
  assert.equal(g.gems, 50);
  assert.equal(g.tanks[0].fish.length, 10);
  assert.equal(g.tanks[0].decor.length, 17);
  assert.equal('settings' in g, false);
});

test('legacy IDs that collide with object prototypes are replaced with usable unique IDs', () => {
  const raw = legacySave();
  raw.tanks[0].id = '__proto__';
  raw.activeTankId = '__proto__';
  raw.tanks[0].fish[0].id = 'constructor';
  raw.tanks[0].fish[1].id = 'toString';
  raw.tanks[0].decor[0].id = 'hasOwnProperty';
  const game = sanitizeGame(raw, { now: T0 });
  const tank = game.tanks[0];
  assert.equal(game.activeTankId, tank.id);
  assert.notEqual(tank.id, '__proto__');
  for (const record of [tank, ...tank.fish, ...tank.decor]) assert.ok(isId(record.id));
  assert.equal(tank.fish.length, 2);
  assert.equal(new Set(tank.fish.map((f) => f.id)).size, 2);
});

test('การตั้งท้อง: เก็บไว้เฉพาะตัวเมีย และเวลาไม่ล้ำอนาคต', () => {
  const now = Date.parse('2026-10-13T05:00:00Z');
  const fish = (id, gender, pregnantAt) => ({ id, speciesId: 'guppy', name: 'x', gender, pregnantAt });
  const game = sanitizeGame(
    { tanks: [{ id: 'tank_p', typeId: 'starter', name: 'ตู้', cleanliness: 90, fish: [fish('fish_p1', 'f', now - 1000), fish('fish_p2', 'm', now - 1000), fish('fish_p3', 'f', now + 99_000), fish('fish_p4', 'f', 'x')], decor: [] }] },
    { now },
  );
  const byId = Object.fromEntries(game.tanks[0].fish.map((f) => [f.id, f]));
  assert.equal(byId.fish_p1.pregnantAt, now - 1000);
  assert.equal(byId.fish_p2.pregnantAt, undefined);
  assert.equal(byId.fish_p3.pregnantAt, now);
  assert.equal('pregnantAt' in byId.fish_p4, false);
});

test('พักฟื้นหลังคลอด: เก็บไว้เฉพาะตัวเมีย และเวลาไม่ล้ำอนาคต', () => {
  const now = Date.parse('2026-10-13T05:00:00Z');
  const fish = (id, gender, lastBirthAt) => ({ id, speciesId: 'molly_golden', name: 'x', gender, lastBirthAt });
  const game = sanitizeGame(
    { tanks: [{ id: 'tank_r', typeId: 'starter', name: 'ตู้', cleanliness: 90, fish: [fish('fish_r1', 'f', now - 1000), fish('fish_r2', 'm', now - 1000), fish('fish_r3', 'f', now + 99_000), fish('fish_r4', 'f', 'x')], decor: [] }] },
    { now },
  );
  const byId = Object.fromEntries(game.tanks[0].fish.map((f) => [f.id, f]));
  assert.equal(byId.fish_r1.lastBirthAt, now - 1000);
  assert.equal('lastBirthAt' in byId.fish_r2, false);
  assert.equal(byId.fish_r3.lastBirthAt, now);
  assert.equal('lastBirthAt' in byId.fish_r4, false);
});

test('ยีนลูกผสมและลูกในท้อง: เก็บไว้เฉพาะปลาที่มีระบบสี และข้อมูลผิดถูกตัดทิ้ง', () => {
  const now = Date.parse('2026-10-13T05:00:00Z');
  const genes = {
    body: { base: '#ffd22c', back: '#f8b41a', belly: '#ffec9c', from: 'golden' },
    fins: { base: '#f1efea', tip: '#fbfaf8', ray: '#d2cfc9', opacity: 0.7 },
    head: null,
    spots: [{ ref: 'dalmatian:0', color: '#07080b', k: 1 }],
    seed: 77,
  };
  const fish = [
    { id: 'fish_g1', speciesId: 'molly_hybrid', name: 'x', gender: 'f', genes, pregnantAt: now - 5, fetus: { speciesId: 'molly_hybrid', genes } },
    { id: 'fish_g2', speciesId: 'guppy', name: 'x', gender: 'f', genes, pregnantAt: now - 5, fetus: { speciesId: 'molly_hybrid', genes } },
    { id: 'fish_g3', speciesId: 'molly_golden', name: 'x', gender: 'f', fetus: { speciesId: 'molly_hybrid', genes } },
  ];
  const game = sanitizeGame({ tanks: [{ id: 'tank_g', typeId: 'starter', name: 'ตู้', cleanliness: 90, fish, decor: [] }] }, { now });
  const byId = Object.fromEntries(game.tanks[0].fish.map((f) => [f.id, f]));
  assert.deepEqual(byId.fish_g1.genes, genes);
  assert.deepEqual(byId.fish_g1.fetus, { speciesId: 'molly_hybrid', genes });
  assert.equal('genes' in byId.fish_g2, false, 'ปลาหางนกยูงไม่มีระบบสี');
  assert.equal('fetus' in byId.fish_g2, false, 'ลูกในท้องต่างกลุ่มพันธุ์ถูกตัดทิ้ง');
  assert.equal('fetus' in byId.fish_g3, false, 'ไม่ได้ตั้งท้อง');
});
