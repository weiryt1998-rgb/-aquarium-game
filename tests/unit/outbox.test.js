import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Outbox, replayOrphans } from '../../src/cloud/outbox.js';
import { LIMITS } from '../../src/shared/constants.js';
import { processCommit, validateCommit } from '../../src/shared/commit.js';
import { makeDoc, T0 } from '../helpers/fixtures.js';

/** localStorage จำลอง (คีย์ที่เก็บเป็น own property เพื่อให้ Object.keys ใช้ได้เหมือนเบราว์เซอร์) */
class MemoryStorage {
  getItem(k) {
    return Object.prototype.hasOwnProperty.call(this, k) ? this[k] : null;
  }
  setItem(k, v) {
    this[k] = String(v);
  }
  removeItem(k) {
    delete this[k];
  }
}

const now = Date.now();
const put = (writer, data) => localStorage.setItem(`aquarium-cloud-outbox:uid1:${writer}`, JSON.stringify({ writer, epoch: 0, seq: 1, inflight: null, pending: [], savedAt: now, aliveAt: now, ...data }));
const keys = () => Object.keys(localStorage);

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
});

test('คิวของแท็บที่ยังเปิดอยู่ไม่ถูกหยิบไป · แท็บที่ปิดแล้ว/เงียบเกิน 15 วินาทีถูกหยิบ · คิวเก่ากว่า 7 วันถูกทิ้ง', () => {
  put('w_alive', { pending: [{ type: 'feed' }] });
  put('w_closed', { pending: [{ type: 'feed' }], closed: true });
  put('w_silent', { pending: [{ type: 'feed' }], aliveAt: now - 20_000 });
  put('w_expired', { pending: [{ type: 'feed' }], savedAt: now - 8 * 24 * 3600_000, aliveAt: now - 8 * 24 * 3600_000 });
  put('w_self', { pending: [{ type: 'feed' }], closed: true });
  localStorage.setItem('aquarium-cloud-outbox:other-user:w_x', JSON.stringify({ writer: 'w_x', closed: true }));
  const found = Outbox.orphans('uid1', 'w_self', now).map((o) => o.writer).sort();
  assert.deepEqual(found, ['w_closed', 'w_silent']);
  assert.ok(!keys().some((k) => k.endsWith('w_expired')), 'คิวหมดอายุถูกลบ');
});

test('ส่งคิวค้าง: ใช้ writer/seq เดิม (กันบันทึกซ้ำ) · คิวที่เซิร์ฟเวอร์ไม่รับถาวรถูกทิ้งและไม่บังคิวอื่น · คิวจาก epoch เก่าไม่ถูกส่ง', async () => {
  put('w_bad', { closed: true, seq: 3, pending: [{ type: 'feed' }] });
  put('w_good', { closed: true, seq: 5, inflight: { seq: 5, commands: [{ type: 'buyFood' }] }, pending: [{ type: 'feed' }] });
  put('w_old_epoch', { closed: true, epoch: 7, pending: [{ type: 'feed' }] });
  put('w_offline', { closed: true, seq: 1, pending: [{ type: 'feed' }] });
  const sent = [];
  const transport = {
    async commit(c) {
      sent.push(`${c.writer}#${c.seq}`);
      if (c.writer === 'w_bad') throw Object.assign(new Error('bad'), { code: 'functions/invalid-argument' });
      if (c.writer === 'w_offline') throw Object.assign(new Error('net'), { code: 'functions/internal' });
      return { doc: { epoch: 0, revision: sent.length + 10 }, results: c.commands.map(() => ({ ok: true })) };
    },
  };
  const result = await replayOrphans(transport, 'uid1', 'w_self', { epoch: 0, revision: 1 });
  assert.deepEqual(sent.sort(), ['w_bad#4', 'w_good#5', 'w_good#6', 'w_offline#2'].sort());
  assert.equal(result.replayed, 2);
  const left = keys().map((k) => k.split(':').pop()).sort();
  assert.deepEqual(left, ['w_offline'], 'เหลือเฉพาะคิวที่ส่งไม่สำเร็จชั่วคราว (ลองใหม่ภายหลัง)');
});

test('คิวค้างขนาดใหญ่แบ่งเป็นหลาย commit และส่งซ้ำหลังคำตอบหายโดยไม่ซื้อซ้ำ', async () => {
  const count = LIMITS.commandsPerCommit * 2 + 1;
  put('w_large', { closed: true, pending: Array.from({ length: count }, () => ({ type: 'buyFood', foodId: 'flakes' })) });
  let doc = makeDoc({ coins: 1_000_000 });
  let dropped = false;
  const sent = [];
  const transport = {
    async commit(raw) {
      const c = validateCommit(raw);
      sent.push([c.seq, c.commands.length]);
      const res = processCommit(doc, c, { now: T0 + sent.length * 100 });
      doc = res.doc;
      if (c.seq === 3 && !dropped) {
        dropped = true;
        throw Object.assign(new Error('response lost'), { code: 'functions/internal' });
      }
      return res;
    },
  };

  await replayOrphans(transport, 'uid1', 'w_self', doc);
  assert.equal(keys().length, 1, 'คำตอบหายต้องเก็บคิวไว้ส่งซ้ำ');
  await replayOrphans(transport, 'uid1', 'w_self', doc);
  assert.equal(keys().length, 0);
  assert.deepEqual(sent, [[2, 300], [3, 300], [2, 300], [3, 300], [4, 1]]);
  assert.equal(doc.game.inventory.flakes, 5 + count * 10);
});
