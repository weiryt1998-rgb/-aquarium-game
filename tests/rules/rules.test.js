import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { Timestamp, collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, setLogLevel, updateDoc } from 'firebase/firestore';
import { createInitialGame } from '../../src/shared/sanitize.js';
import { TANK_TYPES } from '../../src/data/tanks.js';
import { FISH_SPECIES } from '../../src/data/fish.js';
import { createSaveDoc, docToFirestore } from '../../src/shared/saveDoc.js';
import { PLACEHOLDER, UID_PATTERN, readPlayerUid, withPlayerUid } from '../../scripts/player-uid.mjs';

/**
 * ทดสอบ Security Rules ทั้งสองไฟล์บน Firestore Emulator
 * รัน: npm run test:rules (ต้องมี Java สำหรับ Firestore Emulator)
 */
const read = (file) => fs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
setLogLevel('silent'); // การถูกปฏิเสธเป็นผลที่คาดไว้ ไม่ต้องพิมพ์ log
/** เวลาที่เครื่องผู้เล่นกำหนดเอง (ต่างจากเวลาเซิร์ฟเวอร์ชัดเจน — Timestamp.now() บน localhost อาจตรงกับ request.time พอดี) */
const clientTime = () => Timestamp.fromMillis(Date.now() - 60_000);

function cloudDoc(overrides = {}) {
  const now = Date.now();
  const base = createSaveDoc(createInitialGame({ now }), { now, writer: 'w_setup' });
  return { ...docToFirestore(base, Timestamp.fromMillis), ...overrides };
}

async function seed(env, { save = true } = {}) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'gameAccess/player1'), { role: 'player' });
    if (save) await setDoc(doc(db, 'gameSaves/global'), cloudDoc());
    if (save) await setDoc(doc(db, 'gameSaves/global/backups/b1'), { createdAt: Timestamp.now(), reason: 'daily', revision: 1, game: {} });
  });
}

describe('firestore.blaze.rules (แผน Blaze โหมด functions: เว็บอ่านได้อย่างเดียว)', () => {
  let env;
  before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-rules-functions', firestore: { rules: read('firestore.blaze.rules') } });
  });
  after(() => env?.cleanup());

  test('ไม่ได้เข้าสู่ระบบ → อ่านเซฟไม่ได้', async () => {
    await seed(env);
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'gameSaves/global')));
  });

  test('เข้าสู่ระบบแต่ไม่อยู่ใน gameAccess (เช่น สมัครบัญชีเองด้วย API key) → อ่านเซฟไม่ได้', async () => {
    await seed(env);
    const stranger = env.authenticatedContext('stranger').firestore();
    await assertFails(getDoc(doc(stranger, 'gameSaves/global')));
    await assertFails(getDocs(collection(stranger, 'gameSaves/global/backups')));
  });

  test('ผู้เล่นที่ได้รับสิทธิ์อ่านเซฟและจุดสำรองได้', async () => {
    await seed(env);
    const db = env.authenticatedContext('player1').firestore();
    await assertSucceeds(getDoc(doc(db, 'gameSaves/global')));
    await assertSucceeds(getDocs(collection(db, 'gameSaves/global/backups')));
  });

  test('ผู้เล่นที่ได้รับสิทธิ์ก็เขียน/ลบเซฟเองไม่ได้ (ต้องผ่าน Cloud Functions)', async () => {
    await seed(env);
    const db = env.authenticatedContext('player1').firestore();
    const ref = doc(db, 'gameSaves/global');
    await assertFails(updateDoc(ref, { 'game.coins': 999999 }));
    await assertFails(setDoc(ref, cloudDoc()));
    await assertFails(deleteDoc(ref));
    await assertFails(setDoc(doc(db, 'gameSaves/global/backups/x'), { reason: 'manual' }));
    await assertFails(setDoc(doc(db, 'gameSaves/other'), cloudDoc()));
  });

  test('รายชื่อ gameAccess: อ่านได้เฉพาะของตัวเอง และไม่มีใครเพิ่มสิทธิ์ตัวเองได้', async () => {
    await seed(env);
    const stranger = env.authenticatedContext('stranger').firestore();
    await assertSucceeds(getDoc(doc(stranger, 'gameAccess/stranger')));
    await assertFails(getDoc(doc(stranger, 'gameAccess/player1')));
    await assertFails(setDoc(doc(stranger, 'gameAccess/stranger'), { role: 'player' }));
    const player = env.authenticatedContext('player1').firestore();
    await assertFails(setDoc(doc(player, 'gameAccess/friend'), { role: 'player' }));
    await assertFails(getDocs(collection(player, 'gameAccess')));
  });

  test('collection อื่นปิดทั้งหมด', async () => {
    await seed(env);
    const db = env.authenticatedContext('player1').firestore();
    await assertFails(getDoc(doc(db, 'anything/else')));
    await assertFails(setDoc(doc(db, 'anything/else'), { a: 1 }));
  });
});

/** UID บัญชีผู้เล่นหลักที่ใส่ลง firestore.rules ระหว่างทดสอบ (ไฟล์จริงไม่ถูกแก้) */
const SPARK_UID = 'MainPlayerUid000000000000001';
/** token แบบเดียวกับการเข้าสู่ระบบด้วย Email/Password จริง (ค่าเริ่มต้นของ rules-unit-testing คือ custom) */
const PASSWORD_TOKEN = { firebase: { sign_in_provider: 'password', identities: {} } };
const signedIn = (env, uid) => env.authenticatedContext(uid, PASSWORD_TOKEN).firestore();

describe('firestore.rules (แผน Spark: เว็บเขียนเองภายใต้เงื่อนไข)', () => {
  let env;
  before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-rules-spark', firestore: { rules: withPlayerUid(read('firestore.rules'), SPARK_UID) } });
  });
  after(() => env?.cleanup());

  /** อ่านเซฟปัจจุบันแบบผู้ดูแล แล้วสร้างเอกสารถัดไปที่ถูกต้อง (revision + 1) */
  async function nextDoc(change = (d) => d) {
    let current;
    await env.withSecurityRulesDisabled(async (ctx) => {
      current = (await getDoc(doc(ctx.firestore(), 'gameSaves/global'))).data();
    });
    const next = structuredClone({ ...current, createdAt: null, updatedAt: null });
    next.createdAt = current.createdAt;
    next.revision = current.revision + 1;
    next.updatedAt = serverTimestamp();
    return change(next);
  }

  const player = () => signedIn(env, SPARK_UID);
  const saveRef = () => doc(player(), 'gameSaves/global');

  test('เฉพาะ UID บัญชีหลักที่กำหนดใน Rules: บัญชีอื่น (แม้อยู่ใน gameAccess) อ่าน/เขียน/สร้างจุดสำรองไม่ได้', async () => {
    await seed(env); // seed สร้าง gameAccess/player1 ไว้ด้วย — แผน Spark ต้องไม่สนใจรายชื่อนี้
    for (const other of ['player1', 'stranger', SPARK_UID.toLowerCase()]) {
      const db = signedIn(env, other);
      await assertFails(getDoc(doc(db, 'gameSaves/global')));
      await assertFails(setDoc(doc(db, 'gameSaves/global'), await nextDoc()));
      await assertFails(getDocs(collection(db, 'gameSaves/global/backups')));
      await assertFails(setDoc(doc(db, 'gameSaves/global/backups/x'), { createdAt: serverTimestamp(), reason: 'manual', revision: 1, game: {} }));
      await assertFails(getDoc(doc(db, `gameAccess/${other}`)));
    }
    await assertSucceeds(getDoc(saveRef()));
    await assertSucceeds(getDocs(collection(player(), 'gameSaves/global/backups')));
  });

  test('UID ถูกแต่ไม่ได้เข้าสู่ระบบด้วย Email/Password (custom / anonymous token) → ไม่มีสิทธิ์', async () => {
    await seed(env);
    for (const provider of ['custom', 'anonymous']) {
      const db = env.authenticatedContext(SPARK_UID, { firebase: { sign_in_provider: provider, identities: {} } }).firestore();
      await assertFails(getDoc(doc(db, 'gameSaves/global')));
      await assertFails(setDoc(doc(db, 'gameSaves/global'), await nextDoc()));
    }
  });

  test('ไม่ได้เข้าสู่ระบบ / ไม่มีสิทธิ์ → อ่านและเขียนไม่ได้', async () => {
    await seed(env);
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'gameSaves/global')));
    const stranger = signedIn(env, 'stranger');
    await assertFails(getDoc(doc(stranger, 'gameSaves/global')));
    await assertFails(setDoc(doc(stranger, 'gameSaves/global'), await nextDoc()));
  });

  test('สร้างเซฟครั้งแรกได้เมื่อ revision = 1 และใช้เวลาของเซิร์ฟเวอร์', async () => {
    await seed(env, { save: false });
    const fresh = { ...cloudDoc(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    await assertFails(setDoc(saveRef(), { ...fresh, revision: 2 }));
    await assertFails(setDoc(saveRef(), { ...fresh, updatedAt: clientTime() }));
    await assertSucceeds(setDoc(saveRef(), fresh));
  });

  test('บันทึกต่อจาก revision ล่าสุดได้', async () => {
    await seed(env);
    await assertSucceeds(setDoc(saveRef(), await nextDoc()));
  });

  test('บันทึกตู้ครบทุกชนิดที่ความจุสูงสุดได้ และปฏิเสธปลาเกินความจุในทุกตู้', async () => {
    await seed(env);
    const full = await nextDoc((d) => {
      const template = d.game.tanks[0];
      d.game.tanks = TANK_TYPES.map((type) => ({
        ...template,
        id: `tank_${type.id}`,
        typeId: type.id,
        fish: Array.from({ length: type.capacity }, (_, i) => ({ ...template.fish[0], id: `fish_${type.id}_${i}` })),
      }));
      d.game.activeTankId = d.game.tanks[0].id;
      d.game.collection = Object.fromEntries(FISH_SPECIES.map((species) => [species.id, true]));
      return d;
    });
    await assertSucceeds(setDoc(saveRef(), full));
    await assertSucceeds(setDoc(saveRef(), await nextDoc((d) => ({ ...d, epoch: d.epoch + 1 }))));
    for (let i = 0; i < TANK_TYPES.length; i++) {
      await assertFails(setDoc(saveRef(), await nextDoc((d) => {
        d.game.tanks[i].fish.push({ ...d.game.tanks[i].fish[0], id: 'fish_overflow' });
        return d;
      })));
    }
    await seed(env, { save: false });
    await assertSucceeds(setDoc(saveRef(), { ...full, revision: 1, epoch: 0, createdAt: serverTimestamp() }));
  });

  test('บันทึกความคืบหน้าภารกิจและสถิติที่มีรูปแบบถูกต้องได้', async () => {
    await seed(env);
    await assertSucceeds(setDoc(saveRef(), await nextDoc((d) => {
      d.game.missions.progress.d_feed = 1;
      d.game.missions.claimed.d_clean = true;
      d.game.stats.feeds = 1;
      return d;
    })));
  });

  test('เขียนทับด้วยข้อมูลเก่า (revision ไม่ต่อกัน) ไม่ได้', async () => {
    await seed(env);
    await assertFails(setDoc(saveRef(), await nextDoc((d) => ({ ...d, revision: d.revision - 1 }))));
    await assertFails(setDoc(saveRef(), await nextDoc((d) => ({ ...d, revision: d.revision + 1 }))));
  });

  test('เวลาบันทึกต้องเป็นของเซิร์ฟเวอร์ และห้ามเปลี่ยน createdAt', async () => {
    await seed(env);
    await assertFails(setDoc(saveRef(), await nextDoc((d) => ({ ...d, updatedAt: clientTime() }))));
    await assertFails(setDoc(saveRef(), await nextDoc((d) => ({ ...d, createdAt: Timestamp.fromMillis(0) }))));
  });

  test('ค่าผิดรูปแบบถูกปฏิเสธ (เงินติดลบ/ทศนิยม, ฟิลด์แปลก, ตู้ไม่รู้จัก, ปลาเกินความจุ)', async () => {
    await seed(env);
    const bad = [
      (d) => ((d.game.coins = -1), d),
      (d) => ((d.game.coins = 10.5), d),
      (d) => ((d.game.gems = 1e12), d),
      (d) => ((d.game.cheat = true), d),
      (d) => ((d.hacked = 1), d),
      (d) => ((d.game.inventory.flakes = -5), d),
      (d) => ((d.game.missions = {}), d),
      (d) => ((d.game.missions.progress = null), d),
      (d) => ((d.game.missions.claimed = []), d),
      (d) => ((d.game.missions.day = 1), d),
      (d) => ((d.game.stats = {}), d),
      (d) => ((d.game.stats.feeds = '1'), d),
      (d) => ((d.game.stats.fishBought = -1), d),
      (d) => ((d.game.tanks[0].typeId = 'ocean'), d),
      (d) => ((d.game.tanks[0].typeId = 1), d),
      (d) => ((d.game.tanks[0].cleanliness = '100'), d),
      (d) => ((d.game.tanks[0].cleanliness = -1), d),
      (d) => ((d.game.tanks[0].cleanliness = 101), d),
      (d) => ((d.game.tanks[0].fish = {}), d),
      (d) => ((d.game.tanks[0].decor = ''), d),
      (d) => ((d.game.tanks[0].hacked = true), d),
      (d) => ((delete d.game.tanks[0].id), d),
      (d) => ((delete d.game.tanks[0].fish), d),
      (d) => ((delete d.game.missions.progress), d),
      (d) => ((delete d.game.stats.feeds), d),
      (d) => ((delete d.createdAt), d),
      (d) => ((delete d.meta), d),
      // Rules ไม่ได้ตรวจ is map / hasAll แล้ว แต่ฟิลด์ที่ขาดหรือผิดชนิดทำให้ Rules error → ต้องถูกปฏิเสธเสมอ
      (d) => ((delete d.game.tanks[0].typeId), d),
      (d) => ((delete d.game.tanks[0].cleanliness), d),
      (d) => ((d.game.tanks[0] = 'tank'), d),
      (d) => ((d.game.tanks = { 0: d.game.tanks[0] }), d),
      (d) => ((d.game.tanks = Array.from({ length: 8 }, (_, i) => ({ ...d.game.tanks[0], id: `tank_x${i}`, fish: [] }))), d),
      (d) => ((d.game.inventory = 5), d),
      (d) => ((delete d.game.inventory), d),
      (d) => ((delete d.game.missions), d),
      (d) => ((delete d.game.missions.claimed), d),
      (d) => ((d.game.stats = 'x'), d),
      (d) => ((delete d.revision), d),
      (d) => ((delete d.epoch), d),
      (d) => ((d.epoch = d.epoch - 1), d),
      (d) => ((d.meta = []), d),
      (d) => ((d.game.tanks[0].fish = Array.from({ length: 15 }, (_, i) => ({ id: `f${i}` }))), d),
      (d) => ((d.game.tanks = []), d),
      (d) => ((d.epoch = d.epoch + 2), d),
      (d) => ((d.schemaVersion = 99), d),
    ];
    for (const change of bad) await assertFails(setDoc(saveRef(), await nextDoc(change)));
  });

  test('ลบเซฟไม่ได้', async () => {
    await seed(env);
    await assertFails(deleteDoc(saveRef()));
  });

  test('จุดสำรอง: สร้างได้อย่างเดียว แก้/ลบไม่ได้', async () => {
    await seed(env);
    const db = player();
    const good = { createdAt: serverTimestamp(), reason: 'manual', revision: 1, epoch: 0, schemaVersion: 1, by: 'w_x', summary: {}, game: {} };
    await assertSucceeds(setDoc(doc(db, 'gameSaves/global/backups/new1'), good));
    await assertFails(setDoc(doc(db, 'gameSaves/global/backups/new2'), { ...good, reason: 'whatever' }));
    await assertFails(setDoc(doc(db, 'gameSaves/global/backups/new3'), { ...good, createdAt: clientTime() }));
    await assertFails(updateDoc(doc(db, 'gameSaves/global/backups/b1'), { reason: 'manual' }));
    await assertFails(deleteDoc(doc(db, 'gameSaves/global/backups/b1')));
  });

  test('ไม่มีกฎ allow read, write: if true ในไฟล์ rules', () => {
    for (const file of ['firestore.rules', 'firestore.blaze.rules']) {
      assert.doesNotMatch(read(file).replace(/\/\/.*$/gm, ''), /if\s+true/);
    }
  });
});

describe('firestore.rules ที่ยังไม่ได้ตั้ง UID (ค่าเริ่มต้น)', () => {
  let env;
  before(async () => {
    const unset = read('firestore.rules').replace(/(function playerUid\(\) \{\s*return ')[^']*(';)/, `$1${PLACEHOLDER}$2`);
    assert.equal(readPlayerUid(unset), PLACEHOLDER);
    env = await initializeTestEnvironment({ projectId: 'demo-rules-unset', firestore: { rules: unset } });
  });
  after(() => env?.cleanup());

  test('ไม่มีใครอ่านหรือเขียนเซฟได้เลย (ปิดไว้ก่อนจนกว่าผู้ดูแลจะตั้ง UID)', async () => {
    await seed(env);
    for (const uid of ['player1', 'SET_PLAYER_UID_BEFORE_DEPLOY', 'anyone']) {
      const db = signedIn(env, uid);
      await assertFails(getDoc(doc(db, 'gameSaves/global')));
      await assertFails(setDoc(doc(db, 'gameSaves/global'), cloudDoc({ updatedAt: serverTimestamp(), revision: 2 })));
    }
    await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'gameSaves/global')));
  });
});

/** ไฟล์ตามที่จะ deploy จริง (ไม่แทนค่าอะไร) — ข้ามถ้ายังไม่ได้ตั้ง UID */
const FILE_UID = readPlayerUid(read('firestore.rules'));
describe(`firestore.rules ตามไฟล์จริงที่จะ deploy (UID ${FILE_UID})`, { skip: !UID_PATTERN.test(FILE_UID) && 'ยังไม่ได้ตั้ง UID' }, () => {
  let env;
  before(async () => {
    env = await initializeTestEnvironment({ projectId: 'demo-rules-deploy', firestore: { rules: read('firestore.rules') } });
  });
  after(() => env?.cleanup());

  test('บัญชีหลัก (Email/Password) อ่าน สร้าง และบันทึกเซฟต่อได้', async () => {
    await seed(env, { save: false });
    const db = signedIn(env, FILE_UID);
    const ref = doc(db, 'gameSaves/global');
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(setDoc(ref, { ...cloudDoc(), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    const current = (await getDoc(ref)).data();
    await assertSucceeds(setDoc(ref, { ...current, revision: current.revision + 1, updatedAt: serverTimestamp() }));
    await assertFails(setDoc(ref, { ...current, revision: current.revision + 1, updatedAt: serverTimestamp() })); // revision เก่า
    await assertFails(deleteDoc(ref));
  });

  test('บัญชีอื่น / ไม่ได้เข้าสู่ระบบ / token แบบอื่น → ถูกปฏิเสธ', async () => {
    await seed(env);
    const others = [
      env.unauthenticatedContext().firestore(),
      signedIn(env, 'someoneElseUid000000000000001'),
      env.authenticatedContext(FILE_UID).firestore(), // custom token
      env.authenticatedContext(FILE_UID, { firebase: { sign_in_provider: 'anonymous', identities: {} } }).firestore(),
    ];
    for (const db of others) {
      await assertFails(getDoc(doc(db, 'gameSaves/global')));
      await assertFails(getDocs(collection(db, 'gameSaves/global/backups')));
    }
  });
});
