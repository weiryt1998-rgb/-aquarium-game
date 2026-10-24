import test from 'node:test';
import assert from 'node:assert/strict';
import { getSpecies } from '../../src/data/fish.js';
import { fryAmount, hasFryLook, isColorHidden, isRevealing } from '../../src/models/molly/fry.js';

const molly = getSpecies('molly_golden');
const hybrid = getSpecies('molly_hybrid');

test('ลูกปลาสอดแรกเกิดยังไม่เห็นสีจริง แล้วค่อย ๆ เผยสีจนเห็นเต็มที่ตอนเปลี่ยนเป็นตัวเต็มวัย', () => {
  const revealAt = molly.procedural.babyUntil;
  assert.equal(fryAmount(molly, 0), 1, 'แรกเกิดสีลูกปลาทั้งตัว');
  assert.equal(fryAmount(molly, revealAt * 0.6), 1, 'ช่วงแรกยังไม่เห็นสีเลย');
  const mid = fryAmount(molly, revealAt * 0.83);
  assert.ok(mid > 0 && mid < 1, `ช่วงเผยสี ${mid}`);
  assert.equal(fryAmount(molly, revealAt), 0, 'เผยสีครบเมื่อเปลี่ยนเป็นตัวเต็มวัย');
  let prev = 1;
  for (let g = 0; g <= 1; g += 0.02) {
    const f = fryAmount(molly, g);
    assert.ok(f <= prev + 1e-12, 'สีเผยออกทางเดียว ไม่กลับไปเข้มอีก');
    prev = f;
  }
});

test('ซ่อนชื่อสายพันธุ์/ยีนจนกว่าจะเผยสีครบ ทั้งปลาสอดพันธุ์แท้และลูกผสม', () => {
  for (const s of [molly, hybrid]) {
    assert.equal(hasFryLook(s), true, s.id);
    assert.equal(isColorHidden(s, 0), true);
    assert.equal(isColorHidden(s, 0.59), true);
    assert.equal(isColorHidden(s, 0.6), false);
  }
  assert.equal(isRevealing(molly, 0.2), false);
  assert.equal(isRevealing(molly, 0.5), true);
  assert.equal(isRevealing(molly, 0.6), false);
});

test('ปลาที่ซื้อจากร้าน (โต 60%) และปลาชนิดอื่นเห็นสีจริงตั้งแต่แรก', () => {
  assert.equal(isColorHidden(molly, 0.6), false, 'ปลาสอดจากร้านเริ่มที่ growth 0.6');
  assert.equal(fryAmount(molly, 0.6), 0);
  for (const id of ['crab', 'seahorse']) {
    const s = getSpecies(id);
    if (!s) continue;
    assert.equal(hasFryLook(s), false, id);
    assert.equal(fryAmount(s, 0), 0, id);
    assert.equal(isColorHidden(s, 0), false, id);
  }
});
