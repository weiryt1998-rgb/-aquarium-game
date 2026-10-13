import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TANK_TYPES } from '../../src/data/tanks.js';
import { FISH_SPECIES } from '../../src/data/fish.js';
import { getDecorItem } from '../../src/data/decor.js';
import { getSpecies } from '../../src/data/fish.js';

// Security Rules (แผน Spark) ตรวจโครงสร้างเซฟเอง — ถ้าเพิ่มตู้ใน data แต่ลืมแก้ Rules การซื้อตู้ใหม่จะถูกปฏิเสธ
const rules = fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');

test('firestore.rules: รู้จักตู้ทุกชนิดใน data/tanks.js และความจุตรงกัน', () => {
  const body = rules.match(/function tankCapacities\(\) \{([\s\S]*?)\n\s*\}/)[1];
  const pairs = Object.fromEntries([...body.matchAll(/'([^']+)'\s*:\s*(\d+)/g)].map((m) => [m[1], Number(m[2])]));
  assert.deepEqual(Object.keys(pairs).sort(), TANK_TYPES.map((t) => t.id).sort());
  for (const t of TANK_TYPES) assert.equal(pairs[t.id], t.capacity, `ความจุของ ${t.id}`);
});

test('firestore.rules: จำนวนตู้สูงสุดและจำนวนสายพันธุ์ในสมุดสะสมพอสำหรับข้อมูลเกม', () => {
  const max = Number(rules.match(/tankCount <= (\d+)/)[1]);
  assert.equal(max, TANK_TYPES.length);
  for (let i = 0; i < max; i++) assert.ok(rules.includes(`validTank(tanks[${i}], capacities, tankKeys)`), `ตรวจตู้ลำดับ ${i}`);
  const collection = Number(rules.match(/g\.collection\.size\(\) <= (\d+)/)[1]);
  assert.ok(FISH_SPECIES.length <= collection, `สายพันธุ์ ${FISH_SPECIES.length} เกินที่ Rules รับ (${collection})`);
});

test('ตู้ทุกใบ: ปลาและของตกแต่งในภาพตัวอย่างมีอยู่จริง และตู้ที่แพงกว่าจุปลาได้มากกว่า', () => {
  for (const t of TANK_TYPES) {
    for (const id of t.showcase?.fish ?? []) assert.ok(getSpecies(id), `${t.id}: ไม่รู้จักปลา ${id}`);
    for (const [id] of t.showcase?.extraDecor ?? []) assert.ok(getDecorItem(id), `${t.id}: ไม่รู้จักของตกแต่ง ${id}`);
  }
  for (let i = 1; i < TANK_TYPES.length; i++) assert.ok(TANK_TYPES[i].capacity > TANK_TYPES[i - 1].capacity);
});
