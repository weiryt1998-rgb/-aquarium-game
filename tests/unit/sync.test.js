import { test, before, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { CloudSync } from '../../src/cloud/CloudSync.js';
import { EventBus } from '../../src/core/EventBus.js';
import { GameState, createFishRecord } from '../../src/core/GameState.js';
import { getSpecies } from '../../src/data/fish.js';
import { processCommit, validateCommit } from '../../src/shared/commit.js';
import { LIMITS } from '../../src/shared/constants.js';
import { cloneData } from '../../src/shared/saveDoc.js';
import { T0, fishRecord, makeDoc } from '../helpers/fixtures.js';

/**
 * จำลองหลายอุปกรณ์ด้วย CloudSync ตัวจริง + เซิร์ฟเวอร์จำลองที่ใช้ processCommit ตัวเดียวกับ Cloud Functions
 * (ส่วนที่ใช้ Firebase จริงทดสอบแยกใน tests/integration และ tests/e2e)
 */
before(() => {
  globalThis.window ??= new EventTarget();
});

const active = [];
afterEach(() => {
  for (const d of active.splice(0)) d.sync.dispose(); // ปิด timer ทุกตัวแม้เทสต์ล้ม
});

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

class FakeServer {
  constructor(doc) {
    this.doc = doc;
    this.subs = new Set();
    this.now = T0;
    this.offline = false;
    this.dropResponses = 0;
    this.commitCount = 0;
  }

  transport() {
    const server = this;
    return {
      mode: 'test',
      subscribe(onDoc) {
        server.subs.add(onDoc);
        setTimeout(() => onDoc(cloneData(server.doc), { fromCache: false }), 0);
        return () => server.subs.delete(onDoc);
      },
      async commit(c) {
        await tick();
        if (server.offline) throw Object.assign(new Error('offline'), { code: 'unavailable' });
        const out = processCommit(server.doc, validateCommit(c), { now: (server.now += 100) });
        if (!out.duplicate && !out.epochMismatch) {
          server.doc = out.doc;
          server.commitCount += 1;
          for (const fn of server.subs) setTimeout(() => fn(cloneData(server.doc), { fromCache: false }), 0);
        }
        if (server.dropResponses > 0) {
          server.dropResponses -= 1; // บันทึกแล้วแต่คำตอบหายระหว่างทาง
          throw Object.assign(new Error('network'), { code: 'internal' });
        }
        return { ...out, doc: cloneData(server.doc) };
      },
      async load() {
        return { doc: cloneData(server.doc), fromCache: false };
      },
      async listBackups() {
        return [];
      },
    };
  }
}

/** เกมจำลองขั้นต่ำ: ใช้ GameState จริง แต่ไม่มีฉาก 3 มิติ */
function device(server, name) {
  const events = new EventBus();
  const state = new GameState(events, { data: cloneData(server.doc.game) });
  const synced = { fish: 0, decor: 0 };
  const game = {
    events,
    state,
    placement: null,
    loadTank() {},
    fish: { count: 0, syncRecords: () => (synced.fish++, false) },
    decor: { syncRecords: () => (synced.decor++, false) },
  };
  const sync = new CloudSync({ transport: server.transport(), uid: 'uid_test', writer: `w_${name}`, doc: cloneData(server.doc), fromCache: false, mode: 'test' });
  const events$ = [];
  sync.on((e) => events$.push(e));
  sync.attach(game);
  const d = { game, state, sync, events: events$, synced };
  active.push(d);
  return d;
}

/** ทำแบบเดียวกับ Game.buyFish: แก้ข้อมูลในเครื่องทันที แล้วส่งคำสั่งให้เซิร์ฟเวอร์ตรวจ */
function buyFish(d, speciesId) {
  const species = getSpecies(speciesId);
  if (!d.state.spend(species.price)) return null;
  const record = createFishRecord(speciesId, { growth: 0.6, satiety: 70 });
  d.state.activeTank.fish.push(record);
  d.state.record({ type: 'buyFish', tankId: d.state.activeTank.id, speciesId, fish: { id: record.id, name: record.name, gender: record.gender, breedCooldown: record.breedCooldown, coinTimer: record.coinTimer } });
  return record;
}

function sellFish(d, fishId) {
  const tank = d.state.activeTank;
  const fish = tank.fish.find((f) => f.id === fishId);
  tank.fish = tank.fish.filter((f) => f !== fish);
  d.state.earn({ coins: 10 });
  d.state.record({ type: 'sellFish', tankId: tank.id, fishId, growth: fish.growth });
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await tick(5);
};

test('เครื่อง A ซื้อปลา → บันทึกบนคลาวด์ → เครื่อง B เห็นปลาและเงินตรงกัน (เรียลไทม์)', async () => {
  const server = new FakeServer(makeDoc({ coins: 1000, fish: [fishRecord('goldfish')] }));
  const A = device(server, 'a');
  const B = device(server, 'b');
  await settle();
  const fish = buyFish(A, 'goldfish');
  assert.equal(A.sync.status, 'pending');
  await A.sync.flushNow();
  assert.equal(A.sync.status, 'saved');
  assert.equal(server.doc.game.coins, 900);
  assert.ok(server.doc.game.tanks[0].fish.some((f) => f.id === fish.id));
  await settle();
  assert.equal(B.state.data.coins, 900);
  assert.ok(B.state.activeTank.fish.some((f) => f.id === fish.id));
  assert.ok(B.events.some((e) => e.type === 'remote'));
  assert.ok(B.synced.fish > 0, 'ฉากของเครื่อง B ถูกสั่งให้ซิงก์ปลา');
  A.sync.dispose();
  B.sync.dispose();
});

test('เครื่อง B ขายปลา → เครื่อง A ได้รับข้อมูลล่าสุด', async () => {
  const f1 = fishRecord('koi');
  const server = new FakeServer(makeDoc({ coins: 100, fish: [f1, fishRecord('neon')] }));
  const A = device(server, 'a');
  const B = device(server, 'b');
  await settle();
  sellFish(B, f1.id);
  await B.sync.flushNow();
  await settle();
  assert.equal(server.doc.game.tanks[0].fish.length, 1);
  assert.equal(A.state.activeTank.fish.length, 1);
  assert.equal(A.state.data.coins, server.doc.game.coins);
  A.sync.dispose();
  B.sync.dispose();
});

test('สองเครื่องซื้อพร้อมกัน: ไม่มีข้อมูลหาย ทั้งสองเครื่องลงเอยที่ข้อมูลเดียวกัน', async () => {
  const server = new FakeServer(makeDoc({ coins: 1000, fish: [] }));
  const A = device(server, 'a');
  const B = device(server, 'b');
  await settle();
  const fa = buyFish(A, 'goldfish');
  const fb = buyFish(B, 'guppy');
  await Promise.all([A.sync.flushNow(), B.sync.flushNow()]);
  await settle();
  const ids = server.doc.game.tanks[0].fish.map((f) => f.id).sort();
  assert.deepEqual(ids, [fa.id, fb.id].sort());
  assert.equal(server.doc.game.coins, 1000 - 100 - 80);
  for (const d of [A, B]) {
    assert.equal(d.state.data.coins, server.doc.game.coins);
    assert.deepEqual(d.state.activeTank.fish.map((f) => f.id).sort(), ids);
  }
  A.sync.dispose();
  B.sync.dispose();
});

test('ใช้เงินชนกัน: เครื่องที่มาทีหลังถูกปฏิเสธ แจ้งผู้เล่น และข้อมูลในเครื่องถูกแก้ให้ตรงคลาวด์', async () => {
  const server = new FakeServer(makeDoc({ coins: 120, fish: [] }));
  const A = device(server, 'a');
  const B = device(server, 'b');
  await settle();
  buyFish(A, 'goldfish');
  const fb = buyFish(B, 'goldfish'); // B ยังเห็นเงิน 120 อยู่
  await A.sync.flushNow();
  await B.sync.flushNow();
  await settle();
  assert.equal(server.doc.game.coins, 20);
  assert.equal(server.doc.game.tanks[0].fish.length, 1);
  assert.equal(B.state.data.coins, 20);
  assert.ok(!B.state.activeTank.fish.some((f) => f.id === fb.id), 'ปลาที่ซื้อไม่สำเร็จถูกเอาออกจากเครื่อง B');
  assert.ok(B.events.some((e) => e.type === 'rejected' && /เงินไม่พอ/.test(e.text)));
  A.sync.dispose();
  B.sync.dispose();
});

test('เน็ตหลุด: สถานะไม่บอกว่าบันทึกแล้ว และส่งซ้ำเมื่อกลับมาออนไลน์โดยไม่หักเงินซ้ำ', async () => {
  const server = new FakeServer(makeDoc({ coins: 1000, fish: [] }));
  const A = device(server, 'a');
  await settle();
  server.offline = true;
  A.sync.online = false;
  buyFish(A, 'angelfish');
  await A.sync.flushNow();
  assert.equal(A.sync.status, 'offline');
  assert.notEqual(A.sync.status, 'saved');
  assert.equal(server.doc.game.coins, 1000);
  server.offline = false;
  A.sync.online = true;
  await A.sync.flushNow();
  assert.equal(A.sync.status, 'saved');
  assert.equal(server.doc.game.coins, 1000 - 400);
  assert.equal(server.doc.game.tanks[0].fish.length, 1);
  A.sync.dispose();
});

test('บันทึกสำเร็จแต่คำตอบหาย: ส่งซ้ำด้วย seq เดิม เซิร์ฟเวอร์ไม่บันทึกซ้ำ', async () => {
  const server = new FakeServer(makeDoc({ coins: 1000, fish: [] }));
  const A = device(server, 'a');
  await settle();
  server.dropResponses = 1;
  buyFish(A, 'goldfish');
  await A.sync.flushNow();
  assert.equal(A.sync.status, 'error', 'ยังไม่ได้รับการยืนยัน จึงไม่แสดงว่าบันทึกแล้ว');
  await A.sync.flushNow();
  assert.equal(A.sync.status, 'saved');
  assert.equal(server.commitCount, 1);
  assert.equal(server.doc.game.coins, 900);
  assert.equal(A.state.data.coins, 900);
  A.sync.dispose();
});

test('ค่าจำลอง: เครื่องที่ข้อมูลเก่ากว่าไม่เขียนทับ และรับค่าล่าสุดจากอีกเครื่องไปเล่นต่อ', async () => {
  const fish = fishRecord('goldfish', { satiety: 80 });
  const server = new FakeServer(makeDoc({ coins: 100, fish: [fish] }));
  const A = device(server, 'a');
  const B = device(server, 'b');
  await settle();
  A.state.activeTank.fish[0].satiety = 60;
  B.state.activeTank.fish[0].satiety = 10; // ค่าที่ B จำลองแยก (จะถูกปัดตกถ้าส่งหลัง A)
  await A.sync.flushNow();
  await B.sync.flushNow();
  await settle();
  assert.equal(server.doc.game.tanks[0].fish[0].satiety, 60);
  assert.equal(B.state.activeTank.fish[0].satiety, 60, 'B รับค่าล่าสุดจากคลาวด์');
  A.sync.dispose();
  B.sync.dispose();
});

test('คำสั่งที่ยังไม่ส่งไม่หายเมื่อมีข้อมูลใหม่จากอีกเครื่องเข้ามาก่อน', async () => {
  const server = new FakeServer(makeDoc({ coins: 1000, fish: [] }));
  const A = device(server, 'a');
  const B = device(server, 'b');
  await settle();
  const fa = buyFish(A, 'neon'); // A ยังไม่ส่ง
  buyFish(B, 'goldfish');
  await B.sync.flushNow();
  await settle();
  // A ได้ข้อมูลของ B แล้ว แต่ปลาที่ A เพิ่งซื้อยังอยู่ และเงินคิดรวมทั้งสองการซื้อ
  assert.ok(A.state.activeTank.fish.some((f) => f.id === fa.id));
  assert.equal(A.state.data.coins, 1000 - 50 - 100);
  await A.sync.flushNow();
  assert.equal(server.doc.game.coins, 850);
  assert.equal(server.doc.game.tanks[0].fish.length, 2);
  A.sync.dispose();
  B.sync.dispose();
});

test('เก็บเหรียญหลายครั้งถูกรวมเป็นคำสั่งเดียวก่อนส่ง (ลดจำนวนการเขียน)', async () => {
  const server = new FakeServer(makeDoc({ coins: 0, fish: [fishRecord('goldfish')] }));
  const A = device(server, 'a');
  await settle();
  for (let i = 0; i < 6; i++) {
    A.state.earn({ coins: 5 });
    A.state.record({ type: 'collectCoins', tankId: A.state.activeTank.id, count: 1, value: 5 });
  }
  assert.equal(A.sync.pending.length, 1);
  assert.deepEqual([A.sync.pending[0].count, A.sync.pending[0].value], [6, 30]);
  await A.sync.flushNow();
  assert.equal(server.doc.game.coins, 30);
  assert.equal(server.commitCount, 1);
  A.sync.dispose();
});

test('คิวสะสมเกินขนาด commit ถูกแบ่งส่งโดยไม่มีคำสั่งหาย', async () => {
  const server = new FakeServer(makeDoc({ coins: 1_000_000, fish: [] }));
  const A = device(server, 'backlog');
  await settle();
  const count = LIMITS.commandsPerCommit * 2 + 1;
  for (let i = 0; i < count; i++) A.state.record({ type: 'buyFood', foodId: 'flakes' });

  await A.sync.flushNow();
  assert.equal(A.sync.pending.length, count - LIMITS.commandsPerCommit);
  assert.equal(A.sync.status, 'pending');
  await A.sync.flushNow();
  await A.sync.flushNow();

  assert.equal(A.sync.pending.length, 0);
  assert.equal(A.sync.status, 'saved');
  assert.equal(server.commitCount, 3);
  assert.equal(server.doc.game.inventory.flakes, 5 + count * 10);
  assert.equal(A.state.data.inventory.flakes, server.doc.game.inventory.flakes);
});

test('ปิด CloudSync ระหว่างส่ง: คำตอบล้มเหลวที่มาทีหลังไม่เปิด timer ส่งซ้ำ', async () => {
  const server = new FakeServer(makeDoc());
  const A = device(server, 'disposed');
  await settle();
  let finish;
  A.sync.transport.commit = () => new Promise((resolve, reject) => { finish = reject; });
  A.state.record({ type: 'buyFood', foodId: 'flakes' });
  const sending = A.sync.flushNow();
  A.sync.dispose();
  finish(Object.assign(new Error('offline'), { code: 'unavailable' }));
  await sending;
  assert.equal(A.sync.retryTimer, null);
  assert.equal(A.state.sink, null);
});

test('รีเซ็ตรอการบันทึกที่กำลังส่งก่อนเริ่ม transaction แทนที่', async () => {
  const server = new FakeServer(makeDoc());
  const A = device(server, 'reset_wait');
  await settle();
  const commit = A.sync.transport.commit;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  A.sync.transport.commit = async (c) => { await gate; return commit(c); };
  let adminCalls = 0;
  A.sync.transport.admin = async (action, payload) => {
    adminCalls += 1;
    assert.equal(payload.expectedRevision, server.doc.revision);
    return { doc: cloneData(server.doc) };
  };
  A.state.record({ type: 'buyFood', foodId: 'flakes' });
  const saving = A.sync.flushNow();
  const resetting = A.sync.resetSave();
  assert.equal(adminCalls, 0);
  release();
  await Promise.all([saving, resetting]);
  assert.equal(adminCalls, 1);
  assert.equal(server.commitCount, 1);
});

test('รีเซ็ตล้มเหลว: หยุดส่งระหว่างแทนที่ และยังส่งคำสั่งที่ค้างต่อได้', async () => {
  const server = new FakeServer(makeDoc());
  const A = device(server, 'reset_failed');
  await settle();
  let rejectAdmin;
  A.sync.transport.admin = () => new Promise((resolve, reject) => { rejectAdmin = reject; });
  const resetting = A.sync.resetSave();
  A.state.record({ type: 'buyFood', foodId: 'flakes' });
  await A.sync.flushNow();
  assert.equal(server.commitCount, 0);
  rejectAdmin(Object.assign(new Error('admin unavailable'), { code: 'unavailable' }));
  await assert.rejects(resetting, /admin unavailable/);
  assert.equal(A.sync.pending.length, 1);
  await A.sync.flushNow();
  assert.equal(server.doc.game.inventory.flakes, 15);
  assert.equal(A.sync.status, 'saved');
});

test('สำรองด้วยตนเองรอให้บันทึกคำสั่งที่ค้าง และไม่สำรองเมื่อบันทึกไม่สำเร็จ', async () => {
  const server = new FakeServer(makeDoc());
  const A = device(server, 'backup_wait');
  await settle();
  const backups = [];
  A.sync.transport.admin = async () => { backups.push(cloneData(server.doc)); };
  A.state.record({ type: 'buyFood', foodId: 'flakes' });
  await A.sync.createBackup();
  assert.equal(backups[0].game.inventory.flakes, 15);

  server.offline = true;
  A.state.record({ type: 'buyFood', foodId: 'flakes' });
  await assert.rejects(A.sync.createBackup());
  assert.equal(backups.length, 1);
  assert.equal(A.sync.inflight.commands.length, 1);
});
