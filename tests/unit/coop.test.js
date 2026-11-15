import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STALE, isOfferer, onlinePeers, otherChar, packState, resolveCharacter } from '../../src/cloud/coop.js';

test('onlinePeers: ตัดตัวเอง เครื่องที่หมดอายุ และตัวละครที่ไม่ถูกต้อง · เรียงตามเวลาที่เปิดก่อน', () => {
  const now = 1_000_000;
  const docs = [
    { id: 'me', char: 'man', since: 1, at: now },
    { id: 'b', char: 'woman', since: 50, at: now - 1000 },
    { id: 'a', char: 'man', since: 10, at: now - 2000 },
    { id: 'old', char: 'woman', since: 0, at: now - STALE - 1 },
    { id: 'hidden', char: 'woman', since: 0, at: 0 },
    { id: 'bad', char: 'pen', since: 0, at: now },
  ];
  assert.deepEqual(
    onlinePeers(docs, 'me', now).map((d) => d.id),
    ['a', 'b'],
  );
});

test('resolveCharacter: ไม่ซ้ำ = ตามเดิม · ซ้ำ = เครื่องที่เปิดทีหลังเปลี่ยน (ทั้งสองเครื่องตัดสินตรงกัน)', () => {
  const a = { id: 'w1', char: 'man', since: 100 };
  const b = { id: 'w2', char: 'woman', since: 200 };
  assert.equal(resolveCharacter(a, b), 'man');
  assert.equal(resolveCharacter(b, a), 'woman');
  assert.equal(resolveCharacter(a, null), 'man');

  const late = { id: 'w2', char: 'man', since: 200 };
  assert.equal(resolveCharacter(a, late), 'man');
  assert.equal(resolveCharacter(late, a), 'woman');

  // เปิดพร้อมกัน: ใช้ id ตัดสิน
  const x = { id: 'aa', char: 'woman', since: 5 };
  const y = { id: 'bb', char: 'woman', since: 5 };
  const rx = resolveCharacter(x, y);
  const ry = resolveCharacter(y, x);
  assert.notEqual(rx, ry);
  assert.equal(rx, 'woman');
});

test('isOfferer: มีฝั่งเดียวที่สร้าง offer', () => {
  assert.equal(isOfferer('a', 'b'), true);
  assert.equal(isOfferer('b', 'a'), false);
  assert.equal(otherChar('man'), 'woman');
  assert.equal(otherChar('woman'), 'man');
});

test('packState: ปัดทศนิยม 2 ตำแหน่ง เก็บชื่อท่า/ลำดับ/สถานที่', () => {
  assert.deepEqual(packState({ x: 1.23456, y: 0, z: -3.33333, h: 0.123, s: 1.005, c: 'walk', n: 7, loc: 'farm' }), {
    x: 1.23,
    y: 0,
    z: -3.33,
    h: 0.12,
    s: 1,
    c: 'walk',
    n: 7,
    loc: 'farm',
  });
});
