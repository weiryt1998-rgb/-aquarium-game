import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { TankSimulation } from '../../src/sim/TankSimulation.ts';
import { createFishRecord } from '../../src/sim/records.ts';
import { AlertSystem } from '../../src/systems/AlertSystem.js';
import { getSpecies } from '../../src/data/fish.js';

/** เกมจำลองขนาดเล็ก: engine จริง + AlertSystem จริง เก็บข้อความแจ้งเตือนที่ผู้เล่นจะเห็น */
function makeGame(fishRecords, { cleanliness = 100 } = {}) {
  const tank = { id: 't', typeId: 'starter', name: 'ตู้', cleanliness, fish: fishRecords, decor: [], lastUpdate: 0 };
  const toasts = [];
  const game = {
    sim: new TankSimulation(tank, { decorHappiness: 0.5, cleanBonus: 0, capacity: 14 }, { random: () => 0.99 }),
    ui: { toast: (text, type = 'info') => toasts.push({ text, type }) },
    sound: { play() {} },
    fish: {
      get count() {
        return tank.fish.length;
      },
      getById: (id) => {
        const data = tank.fish.find((f) => f.id === id);
        return data && { id, data, species: getSpecies(data.speciesId), dying: false };
      },
    },
  };
  const alerts = new AlertSystem(game);
  alerts.reset();
  /** เดินเวลา seconds วินาที (เฟรมละ 1 วินาที) */
  const run = (seconds) => {
    for (let i = 0; i < seconds; i++) {
      game.sim.advance(1, 1);
      for (const e of game.sim.drainEvents()) alerts.handle(e);
      alerts.update(1);
    }
  };
  return { game, alerts, toasts, tank, run };
}

test('แจ้งเตือนไล่ระดับ: หิว → อดอาหาร → ป่วย → อาการหนัก (บอกเวลาที่เหลือและวิธีแก้) แล้วเตือนซ้ำ', () => {
  const fish = createFishRecord('molly_dalmatian', { satiety: 100, name: 'โมจิ' });
  const { toasts, run } = makeGame([fish]);
  run(60 * 60);
  const texts = toasts.map((t) => t.text);
  const first = (re) => texts.findIndex((t) => re.test(t));
  const order = [/หิวแล้ว/, /ไม่ได้กินอาหารนาน/, /ป่วย/, /อาการหนัก/].map(first);
  assert.ok(order.every((i) => i >= 0), `ได้รับครบทุกขั้น: ${texts.join(' | ')}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'เรียงตามลำดับความรุนแรง');
  const critical = texts.filter((t) => /อาการหนัก/.test(t));
  assert.match(critical[0], /"โมจิ".*เหลือเวลาประมาณ .*ใช้ยา.*ให้อาหาร/);
  assert.ok(critical.length >= 2, 'เตือนซ้ำระหว่างที่ยังอาการหนัก');
  console.log(texts.map((t) => `  • ${t}`).join('\n'));
});

test('แก้ไขแล้วแจ้งว่าอาการดีขึ้น และหยุดเตือนซ้ำ', () => {
  const fish = createFishRecord('molly_dalmatian', { satiety: 0, name: 'ทาโร่' });
  fish.health = CONFIG.care.criticalBelow - 1;
  const { game, toasts, run } = makeGame([fish]);
  game.sim.feed(fish.id, { nutrition: 90, health: 0, happiness: 0 });
  game.sim.heal(CONFIG.care.medicineHeal);
  run(5);
  assert.ok(toasts.some((t) => /ทาโร่.*อาการดีขึ้น/.test(t.text)), toasts.map((t) => t.text).join(' | '));
  const before = toasts.length;
  run(CONFIG.care.alertReminder * 3);
  assert.ok(!toasts.slice(before).some((t) => /อาการหนัก/.test(t.text)), 'ไม่เตือนอาการหนักอีก');
});

test('ปลาหลายตัวหิวพร้อมกันรวมเป็นข้อความเดียว', () => {
  const fish = Array.from({ length: 5 }, () => createFishRecord('molly_golden', { satiety: CONFIG.care.hungryBelow + 0.05 }));
  const { toasts, run } = makeGame(fish);
  run(3);
  const hungry = toasts.filter((t) => /หิวแล้ว/.test(t.text));
  assert.equal(hungry.length, 1);
  assert.match(hungry[0].text, /ปลา 5 ตัว/);
});
