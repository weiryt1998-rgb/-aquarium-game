import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand } from '../../src/shared/commands.js';
import { CommandError } from '../../src/shared/economy.js';
import { sanitizeGame } from '../../src/shared/sanitize.js';
import { isDead, newSunflower, seedsReadyAt, sunflowerAt, sunflowerBlock, sunflowerStage } from '../../src/shared/garden.js';
import { CONFIG } from '../../src/config.js';
import { T0, ctxAt, makeGame } from '../helpers/fixtures.js';

const H = 3_600_000;
const G = CONFIG.garden;
const run = (game, cmd, now, extra = {}) => applyCommand(game, { tanks: {}, writers: {} }, cmd, ctxAt(now, extra));
const rejects = (fn, code) => assert.throws(fn, (err) => err instanceof CommandError && err.code === code);

test('ทานตะวัน: ดินแห้งตามเวลาจริง ขาดน้ำแล้วเหี่ยวจนตาย (ไม่รดน้ำเลย ≈ 4 + 16 ชม.)', () => {
  const s = { ...newSunflower(T0), water: 100, health: 100 };
  const dryAt = (100 / G.waterUse) * H;
  assert.ok(sunflowerAt(s, T0 + dryAt - 10 * 60_000).water > 0);
  const dry = sunflowerAt(s, T0 + dryAt + 60_000);
  assert.equal(dry.water, 0);
  assert.ok(dry.health > 99, 'เพิ่งแห้ง สุขภาพยังดี');
  const later = sunflowerAt(s, T0 + dryAt + 8 * H);
  assert.ok(later.health > 0 && later.health < 60, `เหี่ยวลงเรื่อย ๆ (${later.health})`);
  assert.ok(isDead(sunflowerAt(s, T0 + dryAt + (100 / G.dryDamage) * H + H)));
  // ตายแล้วไม่ฟื้น/ไม่โตต่อ แม้ผ่านไปนาน
  const dead = sunflowerAt(s, T0 + 40 * 24 * H);
  assert.equal(dead.health, 0);
});

test('ทานตะวัน: มีน้ำ = โตจนบาน · มีปุ๋ยโตเร็วขึ้น · บานแล้วเริ่มนับเวลาเมล็ด', () => {
  // จำลองการดูแลดี: รดน้ำ/ใส่ปุ๋ยทุก 2 ชม. ด้วยสูตรเดียวกับคำสั่ง
  const grow = (fertilize) => {
    const game = makeGame({ coins: 10_000 });
    run(game, { type: 'plantSunflower' }, T0);
    let t = T0;
    while (sunflowerStage(sunflowerAt(game.sunflower, t)).id !== 'bloom' && t < T0 + 48 * H) {
      t += 2 * H;
      try {
        run(game, { type: 'waterSunflower' }, t);
      } catch {}
      if (fertilize) {
        try {
          run(game, { type: 'fertilizeSunflower' }, t);
        } catch {}
      }
    }
    return { game, hours: (t - T0) / H };
  };
  const plain = grow(false);
  const fed = grow(true);
  assert.ok(fed.hours < plain.hours, `ใส่ปุ๋ยบานเร็วกว่า (${fed.hours} < ${plain.hours} ชม.)`);
  assert.ok(plain.hours <= G.growHours + 2);
  const s = sunflowerAt(fed.game.sunflower, T0 + fed.hours * H);
  assert.equal(s.growth, 1);
  assert.ok(s.seedsAt > T0 && seedsReadyAt(s) === s.seedsAt + G.seedHours * H);
});

test('คำสั่งปลูก: หักค่าเมล็ดฝั่งตรวจ ปลูกซ้ำไม่ได้จนกว่าต้นเดิมจะตาย', () => {
  const game = makeGame({ coins: 100 });
  run(game, { type: 'plantSunflower' }, T0);
  assert.equal(game.coins, 100 - G.seedPrice.coins);
  assert.deepEqual(game.sunflower, newSunflower(T0));
  rejects(() => run(game, { type: 'plantSunflower' }, T0 + 1000), 'already-owned');
  // ปล่อยจนตาย → ปลูกใหม่ได้
  run(game, { type: 'plantSunflower' }, T0 + 30 * 24 * H);
  assert.equal(game.sunflower.plantedAt, T0 + 30 * 24 * H);
  const poor = makeGame({ coins: 5 });
  rejects(() => run(poor, { type: 'plantSunflower' }, T0), 'insufficient-funds');
  assert.equal(poor.sunflower, undefined);
});

test('คำสั่งรดน้ำ/ใส่ปุ๋ย: ดินยังชุ่ม/ปุ๋ยยังเยอะทำไม่ได้ · ใส่ปุ๋ยเสียเงิน · ยังไม่ปลูก/ตายแล้วทำไม่ได้', () => {
  const game = makeGame({ coins: 1000 });
  rejects(() => run(game, { type: 'waterSunflower' }, T0), 'not-found');
  run(game, { type: 'plantSunflower' }, T0);
  run(game, { type: 'waterSunflower' }, T0 + 1000); // ปลูกแล้วรดน้ำได้ทันที (ดินเริ่มที่ 70%)
  assert.equal(game.sunflower.water, 100);
  rejects(() => run(game, { type: 'waterSunflower' }, T0 + 2000), 'cooldown'); // ดินยังชุ่ม
  const t = T0 + 3 * H;
  const before = sunflowerAt(game.sunflower, t);
  run(game, { type: 'waterSunflower' }, t);
  assert.equal(game.sunflower.water, Math.min(100, before.water + G.waterAmount));
  assert.equal(game.sunflower.at, t);
  const coins = game.coins;
  run(game, { type: 'fertilizeSunflower' }, t);
  assert.equal(game.coins, coins - G.fertilizerPrice.coins);
  rejects(() => run(game, { type: 'fertilizeSunflower' }, t + 1000), 'cooldown');
  rejects(() => run(game, { type: 'waterSunflower' }, T0 + 40 * 24 * H), 'invalid'); // ตายแล้ว
});

test('คำสั่งเก็บเมล็ด: ได้เมื่อบานครบเวลาเท่านั้น รางวัลกำหนดฝั่งตรวจ', () => {
  const game = makeGame({ coins: 0 });
  game.sunflower = { ...newSunflower(T0), growth: 1, seedsAt: T0, water: 100, food: 100 };
  rejects(() => run(game, { type: 'harvestSunflower', reward: { coins: 99999 } }, T0 + H), 'cooldown');
  const ready = T0 + G.seedHours * H;
  const info = run(game, { type: 'harvestSunflower', reward: { coins: 99999 } }, ready);
  assert.deepEqual(info, { reward: G.seedReward });
  assert.equal(game.coins, G.seedReward.coins);
  assert.equal(game.sunflower.seedsAt, ready);
  rejects(() => run(game, { type: 'harvestSunflower' }, ready + 1000), 'cooldown');
});

test('คำสั่งที่ส่งช้า (ออฟไลน์): นับตามเวลาที่ทำในเครื่อง ไม่ใช่ตอนที่ถึงเซิร์ฟเวอร์ — แต่ห้ามล้ำอนาคต', () => {
  const game = makeGame({ coins: 100 });
  run(game, { type: 'plantSunflower' }, T0);
  // รดน้ำจริงตอน 3 ชม. แต่คำสั่งถึงเซิร์ฟเวอร์ตอน 20 ชม. → ต้นไม้ไม่ตายเพราะความล่าช้าของเน็ต
  const wateredAt = T0 + 3 * H;
  run(game, { type: 'waterSunflower', at: wateredAt }, T0 + 20 * H);
  assert.equal(game.sunflower.at, wateredAt);
  // เวลาในเครื่องล้ำอนาคต → ใช้เวลาฝั่งตรวจ
  const g2 = makeGame({ coins: 100 });
  run(g2, { type: 'plantSunflower', at: T0 + 99 * H }, T0);
  assert.equal(g2.sunflower.plantedAt, T0);
  // ย้อนไปก่อนค่าล่าสุดของต้นไม้ไม่ได้
  run(game, { type: 'fertilizeSunflower', at: T0 }, T0 + 21 * H);
  assert.equal(game.sunflower.at, wateredAt);
});

test('ฝั่งเครื่องตรวจเข้มกว่าฝั่งเซิร์ฟเวอร์เล็กน้อย (เผื่อนาฬิกาต่างกัน)', () => {
  const s = { ...newSunflower(T0), water: G.wetAbove + 1 };
  assert.equal(sunflowerBlock('water', s, T0), 'too-wet');
  assert.equal(sunflowerBlock('water', s, T0, { strict: false }), null);
});

test('sanitize: เก็บต้นทานตะวันที่ถูกต้อง ตัดค่าเสีย/ฟิลด์แปลก ไม่มี = กระถางว่าง', () => {
  const ok = { plantedAt: T0 - H, at: T0 - 1000, water: 50, food: 20, growth: 0.5, health: 90, seedsAt: 0 };
  assert.deepEqual(sanitizeGame({ sunflower: { ...ok, hacked: 1 } }, { now: T0 }).sunflower, ok);
  const wild = sanitizeGame({ sunflower: { ...ok, water: 500, health: -3, growth: 2, at: T0 + 9e9 } }, { now: T0 }).sunflower;
  assert.deepEqual([wild.water, wild.health, wild.growth, wild.at], [100, 0, 1, T0]);
  assert.equal(wild.seedsAt, T0, 'บานแล้วแต่ไม่มีเวลาเมล็ด → เริ่มนับจากเวลาที่บันทึก');
  assert.equal('sunflower' in sanitizeGame({}, { now: T0 }), false);
  assert.equal('sunflower' in sanitizeGame({ sunflower: 'x' }, { now: T0 }), false);
});
