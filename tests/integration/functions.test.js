import { test, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import { allowPlayer, callFunction, createUser, listDocs, readDoc, resetEmulators, writeDoc } from '../../scripts/emulator-api.mjs';
import { LIMITS } from '../../src/shared/constants.js';
import { todayKey } from '../../src/utils/math.js';

/**
 * ทดสอบ Cloud Functions จริงบน Firebase Emulator (Auth + Firestore + Functions)
 * รัน: npm run test:functions
 */
const PASSWORD = 'emulator-only-password';
let player;
let stranger;
const commitData = (writer, seq, commands, extra = {}) => ({ writer, seq, epoch: 0, commands, snapshot: null, ...extra });
const save = async () => (await readDoc('gameSaves/global')).data;

before(async () => {
  await resetEmulators();
  player = await createUser('player@aquarium.test', PASSWORD);
  stranger = await createUser('stranger@aquarium.test', PASSWORD);
  await allowPlayer(player.uid);
});

describe('การยืนยันตัวตนและสิทธิ์', () => {
  test('ไม่ได้เข้าสู่ระบบ → UNAUTHENTICATED', async () => {
    const r = await callFunction('saveInit', { mode: 'new' }, null);
    assert.equal(r.error?.status, 'UNAUTHENTICATED');
  });

  test('บัญชีที่ไม่อยู่ใน gameAccess → PERMISSION_DENIED', async () => {
    for (const name of ['saveInit', 'saveCommit', 'saveAdmin']) {
      const r = await callFunction(name, { mode: 'new' }, stranger.idToken);
      assert.equal(r.error?.status, 'PERMISSION_DENIED', name);
    }
  });

  test('token ปลอม → UNAUTHENTICATED', async () => {
    const r = await callFunction('saveInit', { mode: 'new' }, 'not-a-real-token');
    assert.equal(r.error?.status, 'UNAUTHENTICATED');
  });
});

describe('สร้างเซฟครั้งแรก', () => {
  test('กดสร้างพร้อมกัน 5 เครื่อง → สร้างจริงครั้งเดียว ทุกเครื่องได้เซฟเดียวกัน', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, (_, i) => callFunction('saveInit', { mode: 'new', writer: `w_init${i}` }, player.idToken)));
    for (const r of results) assert.equal(r.error, undefined, JSON.stringify(r.error));
    assert.equal(results.filter((r) => r.result.created).length, 1);
    const ids = new Set(results.map((r) => r.result.doc.game.tanks[0].id));
    assert.equal(ids.size, 1);
    const doc = await save();
    assert.equal(doc.revision, 1);
    assert.equal(doc.game.coins, 1250);
  });

  test('มีเซฟแล้ว → นำเข้าเซฟเก่าทับไม่ได้ (ได้เซฟเดิมกลับมา)', async () => {
    const r = await callFunction('saveInit', { mode: 'import', legacy: { version: 1, coins: 999999, tanks: [{ typeId: 'starter', fish: [], decor: [] }] } }, player.idToken);
    assert.equal(r.result.created, false);
    assert.equal((await save()).game.coins, 1250);
  });
});

describe('บันทึกคำสั่ง (saveCommit)', () => {
  let tankId;
  before(async () => {
    tankId = (await save()).game.tanks[0].id;
  });

  test('ซื้อปลา: เซิร์ฟเวอร์หักเงินและเพิ่มปลา revision เพิ่ม 1', async () => {
    const before = await save();
    const r = await callFunction(
      'saveCommit',
      commitData('w_a', 1, [{ type: 'buyFish', tankId, speciesId: 'neon', fish: { id: 'fish_it1', name: 'ทดสอบ', gender: 'm' } }]),
      player.idToken,
    );
    assert.equal(r.error, undefined, JSON.stringify(r.error));
    assert.deepEqual(r.result.results, [{ ok: true }]);
    const after = await save();
    assert.equal(after.game.coins, before.game.coins - 50);
    assert.equal(after.revision, before.revision + 1);
    assert.ok(after.game.tanks[0].fish.some((f) => f.id === 'fish_it1'));
    assert.ok(after.updatedAt > 0, 'updatedAt เป็นเวลาเซิร์ฟเวอร์');
  });

  test('ส่ง seq เดิมซ้ำ (เช่น เน็ตหลุดตอนรอคำตอบ) → ไม่หักเงินซ้ำ', async () => {
    const before = await save();
    const r = await callFunction(
      'saveCommit',
      commitData('w_a', 1, [{ type: 'buyFish', tankId, speciesId: 'neon', fish: { id: 'fish_it2', name: 'ซ้ำ', gender: 'm' } }]),
      player.idToken,
    );
    assert.equal(r.result.duplicate, true);
    const after = await save();
    assert.equal(after.game.coins, before.game.coins);
    assert.equal(after.revision, before.revision);
  });

  test('หลายเครื่องส่งพร้อมกัน 20 commit → บันทึกครบทุกอัน ไม่มีการเขียนทับกันหาย', async () => {
    const before = await save();
    const buyFood = (w, seq) => callFunction('saveCommit', commitData(w, seq, [{ type: 'buyFood', foodId: 'flakes' }]), player.idToken);
    // แต่ละหน้าเกมส่ง commit ของตัวเองทีละอัน (เหมือน CloudSync) แต่หลายเครื่องส่งพร้อมกัน
    const sequential = async (w, n) => {
      const out = [];
      for (let seq = 1; seq <= n; seq++) out.push(await buyFood(w, seq));
      return out;
    };
    const batches = await Promise.all([sequential('w_b', 7), sequential('w_c', 7), ...Array.from({ length: 6 }, (_, i) => sequential(`w_s${i}`, 1))]);
    const results = batches.flat();
    for (const r of results) assert.equal(r.error, undefined, JSON.stringify(r.error));
    const after = await save();
    const okCount = results.filter((r) => !r.result.duplicate && r.result.results[0]?.ok).length;
    assert.equal(okCount, 20);
    assert.equal(after.game.coins, before.game.coins - 20 * 50);
    assert.equal(after.game.inventory.flakes, before.game.inventory.flakes + 20 * 10);
    assert.equal(after.revision, before.revision + 20);
  });

  test('รับรางวัลประจำวันพร้อมกันหลายเครื่อง → ได้รางวัลครั้งเดียว', async () => {
    const before = await save();
    const results = await Promise.all(['w_d', 'w_e', 'w_f'].map((w) => callFunction('saveCommit', commitData(w, 1, [{ type: 'claimDaily' }]), player.idToken)));
    const ok = results.filter((r) => r.result.results[0]?.ok).length;
    assert.equal(ok, 1);
    const after = await save();
    assert.equal(after.game.coins, before.game.coins + 200);
  });

  test('เงินไม่พอ → คำสั่งถูกปฏิเสธ เงินไม่เปลี่ยน', async () => {
    const before = await save();
    const r = await callFunction('saveCommit', commitData('w_g', 1, [{ type: 'buyTank', typeId: 'panorama', tankId: 'tank_it1' }]), player.idToken);
    assert.deepEqual(r.result.results, [{ ok: false, code: 'insufficient-funds' }]);
    const after = await save();
    assert.equal(after.game.coins, before.game.coins);
    assert.equal(after.game.tanks.length, 1);
  });

  test('เก็บเหรียญเกินอัตราที่ปลาผลิตได้ → รับไม่เกินเพดาน', async () => {
    const before = await save();
    const r = await callFunction('saveCommit', commitData('w_h', 1, [{ type: 'collectCoins', tankId, count: 10, value: 5_000_000 }]), player.idToken);
    const res = r.result.results[0];
    assert.equal(res.ok, true);
    assert.ok(res.accepted < 5_000_000);
    const after = await save();
    assert.equal(after.game.coins, before.game.coins + res.accepted);
  });

  test('ข้อมูลผิดรูปแบบ → INVALID_ARGUMENT', async () => {
    const r = await callFunction('saveCommit', { writer: 'bad writer!', seq: 1, epoch: 0, commands: [] }, player.idToken);
    assert.equal(r.error?.status, 'INVALID_ARGUMENT');
  });

  test('หน้าเว็บเขียน Firestore ตรง ๆ ไม่ได้ แม้มี token ผู้เล่น', async () => {
    const r = await writeDoc('gameSaves/global', { revision: 999, game: { coins: 999999999 } }, player.idToken);
    assert.equal(r.status, 403);
    assert.notEqual((await save()).game.coins, 999999999);
  });

  test('อ่านเซฟโดยไม่เข้าสู่ระบบ / token ปลอม / บัญชีไม่มีสิทธิ์ ไม่ได้', async () => {
    const anonymous = await readDoc('gameSaves/global', null);
    assert.equal(anonymous.status, 403);
    const fake = await readDoc('gameSaves/global', 'not-a-token');
    assert.notEqual(fake.status, 200);
    assert.equal(fake.data, null);
    const notAllowed = await readDoc('gameSaves/global', stranger.idToken);
    assert.equal(notAllowed.status, 403);
    const allowed = await readDoc('gameSaves/global', player.idToken);
    assert.equal(allowed.status, 200);
  });
});

describe('สำรอง / รีเซ็ต / กู้คืน', () => {
  test('มีจุดสำรองรายวันอัตโนมัติหลังการบันทึกแรกของวัน', async () => {
    const { docs } = await listDocs('gameSaves/global/backups');
    assert.ok(docs.some((d) => d.reason === 'daily'));
  });

  test('รีเซ็ตต้องยืนยันด้วย revision ล่าสุด, สำรองก่อนเสมอ, และคำสั่งค้างจาก epoch เก่าถูกยกเลิก', async () => {
    const before = await save();
    const wrong = await callFunction('saveAdmin', { action: 'reset', confirm: 'reset', expectedRevision: before.revision - 1 }, player.idToken);
    assert.equal(wrong.error?.status, 'ABORTED');
    const noConfirm = await callFunction('saveAdmin', { action: 'reset', expectedRevision: before.revision }, player.idToken);
    assert.equal(noConfirm.error?.status, 'INVALID_ARGUMENT');

    const r = await callFunction('saveAdmin', { action: 'reset', confirm: 'reset', expectedRevision: before.revision, writer: 'w_admin' }, player.idToken);
    assert.equal(r.error, undefined, JSON.stringify(r.error));
    const after = await save();
    assert.equal(after.epoch, before.epoch + 1);
    assert.equal(after.game.coins, 1250);
    const backup = (await readDoc(`gameSaves/global/backups/${r.result.backupId}`)).data;
    assert.equal(backup.reason, 'before-reset');
    assert.equal(backup.game.coins, before.game.coins);

    const stale = await callFunction('saveCommit', commitData('w_old', 1, [{ type: 'claimDaily' }], { epoch: before.epoch }), player.idToken);
    assert.equal(stale.result.epochMismatch, true);
    assert.equal((await save()).game.coins, 1250);

    // กู้คืนจุดสำรองที่เพิ่งสร้าง → ข้อมูลก่อนรีเซ็ตกลับมา
    const restore = await callFunction('saveAdmin', { action: 'restore', confirm: 'restore', backupId: r.result.backupId, expectedRevision: after.revision }, player.idToken);
    assert.equal(restore.error, undefined, JSON.stringify(restore.error));
    const restored = await save();
    assert.equal(restored.game.coins, before.game.coins);
    assert.equal(restored.epoch, after.epoch + 1);
  });

  test('การย้าย schema ตัดจุดสำรองเก่า แม้วันนั้นสำรองรายวันแล้ว', async () => {
    const before = await save();
    const now = Date.now();
    const oldSchema = {
      ...before,
      schemaVersion: 0,
      createdAt: new Date(before.createdAt),
      updatedAt: new Date(before.updatedAt),
      meta: { ...before.meta, lastBackupDay: todayKey(new Date(now)) },
    };
    const written = await writeDoc('gameSaves/global', oldSchema);
    assert.equal(written.status, 200);
    await Promise.all(Array.from({ length: LIMITS.backupsToKeep + 5 }, async (_, i) => {
      const r = await writeDoc(`gameSaves/global/backups/old_migration_${i}`, {
        createdAt: new Date(now - 86_400_000 - i * 1000),
        reason: 'manual', revision: 1, epoch: 0, schemaVersion: 0, by: 'setup', summary: {}, game: before.game,
      });
      assert.equal(r.status, 200);
    }));

    const result = await callFunction('saveCommit', commitData('w_migrate', 1, [], { epoch: before.epoch }), player.idToken);
    assert.equal(result.error, undefined, JSON.stringify(result.error));
    assert.equal((await save()).schemaVersion, 1);
    const backups = await listDocs('gameSaves/global/backups');
    assert.equal(backups.docs.length, LIMITS.backupsToKeep);
    assert.ok(backups.docs.some((b) => b.reason === 'before-migration' && b.schemaVersion === 0));
  });
});
