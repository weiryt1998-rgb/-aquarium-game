import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../../src/config.js';
import { WATER_STAGES, dirtyHealthDamage, waterStageIndex } from '../../src/systems/CareSystem.js';

test('น้ำสกปรก: ไม่ทำร้ายปลาเมื่อสะอาดพอ และยิ่งสกปรกยิ่งแรงขึ้นเรื่อย ๆ', () => {
  for (const c of [100, 70, CONFIG.care.dirtyFrom]) assert.equal(dirtyHealthDamage(c), 0);
  let prev = 0;
  for (let c = CONFIG.care.dirtyFrom - 1; c >= 0; c--) {
    const dmg = dirtyHealthDamage(c);
    assert.ok(dmg > prev, `ความเสียหายที่ ${c}% ต้องมากกว่าตอนสะอาดกว่า`);
    prev = dmg;
  }
  // น้ำเน่าสุดแรงเท่าระบบเดิม (ไม่ทำให้ปลาตายเร็วเกินไป)
  assert.ok(Math.abs(dirtyHealthDamage(0) - CONFIG.care.dirtyDamage * 1.3) < 1e-9);
  // ปลาหยุดฟื้นตัวตั้งแต่น้ำเริ่มทำร้าย — ไม่มีช่วงที่ทั้งฟื้นและเสียหายพร้อมกัน
  assert.ok(CONFIG.care.regenAbove >= CONFIG.care.dirtyFrom);
});

test('ขั้นสภาพน้ำ: เรียงจากสะอาดไปสกปรก ครอบคลุม 0..100', () => {
  assert.equal(waterStageIndex(100), 0);
  assert.equal(waterStageIndex(0), WATER_STAGES.length - 1);
  for (let i = 1; i < WATER_STAGES.length; i++) assert.ok(WATER_STAGES[i].min < WATER_STAGES[i - 1].min);
  for (let c = 0; c <= 100; c++) assert.ok(waterStageIndex(c) >= 0);
});
