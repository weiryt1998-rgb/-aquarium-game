/**
 * Cloud Functions ของเซฟกลาง (ต้องใช้แผน Blaze)
 *
 * เว็บอ่านเซฟจาก Firestore ได้ แต่ "เขียนไม่ได้เลย" (ดู firestore.rules) — ทุกการเปลี่ยนแปลงต้องผ่านฟังก์ชันเหล่านี้:
 *   saveCommit  ตรวจและบันทึกคำสั่งของผู้เล่น (ซื้อ ขาย เก็บเหรียญ รับรางวัล ฯลฯ) ด้วยกฎชุดเดียวกับในเกม + เวลาเซิร์ฟเวอร์
 *   saveInit    สร้างเซฟกลางครั้งแรก (ครั้งเดียว ถ้ามีอยู่แล้วจะไม่สร้างทับ)
 *   saveAdmin   สำรอง / รีเซ็ต / กู้คืน / นำเข้าเซฟเก่า (สำรองข้อมูลเดิมก่อนเสมอ)
 *
 * ทุกฟังก์ชันตรวจว่าเข้าสู่ระบบแล้ว และ UID อยู่ในรายชื่อ gameAccess/{uid}
 * โค้ดนี้ถูก bundle รวมกับ src/shared/ ด้วย `npm run build:functions` → functions/lib/index.js
 */
import { setGlobalOptions } from 'firebase-functions/v2';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import { initializeApp } from 'firebase-admin/app';
import { Timestamp, getFirestore } from 'firebase-admin/firestore';
import { planAdminAction } from '../../src/shared/adminOps.js';
import { processCommit, validateCommit } from '../../src/shared/commit.js';
import { ACCESS_COLLECTION, BACKUPS_PATH, DEFAULT_FUNCTIONS_REGION, LIMITS, SAVE_PATH } from '../../src/shared/constants.js';
import { isId } from '../../src/shared/economy.js';
import { createInitialGame, sanitizeGame } from '../../src/shared/sanitize.js';
import { createSaveDoc, docFromFirestore, docToFirestore, makeBackup, markDailyBackup, migrateDoc, needsDailyBackup } from '../../src/shared/saveDoc.js';

setGlobalOptions({ region: process.env.SAVE_FUNCTIONS_REGION || DEFAULT_FUNCTIONS_REGION, maxInstances: 10, memory: '256MiB', timeoutSeconds: 30 });

initializeApp();
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const saveRef = db.doc(SAVE_PATH);
const backupsCol = db.collection(BACKUPS_PATH);
const toTs = (ms) => Timestamp.fromMillis(ms);
const backupData = (backup) => ({ ...backup, createdAt: toTs(backup.createdAt) });
const MAX_PAYLOAD = 900_000;

/** แคชสิทธิ์ต่อ instance 60 วินาที (ถอนสิทธิ์แล้วมีผลภายใน ~1 นาที) */
const accessCache = new Map();

async function requirePlayer(request) {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อน');
  if ((accessCache.get(uid) ?? 0) > Date.now()) return uid;
  const snap = await db.collection(ACCESS_COLLECTION).doc(uid).get();
  if (!snap.exists) throw new HttpsError('permission-denied', 'บัญชีนี้ไม่มีสิทธิ์เข้าถึงเซฟกลาง');
  accessCache.set(uid, Date.now() + 60_000);
  return uid;
}

function toHttpsError(err) {
  if (err instanceof HttpsError) return err;
  switch (err?.code) {
    case 'invalid-argument':
      return new HttpsError('invalid-argument', err.message);
    case 'newer-schema':
      return new HttpsError('failed-precondition', err.message, { reason: 'newer-schema' });
    case 'revision-changed':
      return new HttpsError('aborted', err.message, { reason: 'revision-changed' });
    case 'not-found':
      return new HttpsError('not-found', err.message);
    default:
      logger.error('save function failed', err);
      return new HttpsError('internal', 'internal');
  }
}

function checkPayloadSize(value) {
  if (JSON.stringify(value ?? null).length > MAX_PAYLOAD) throw new HttpsError('invalid-argument', 'payload too large');
}

/** เก็บจุดสำรองล่าสุดไว้ LIMITS.backupsToKeep ชุด (ลบที่เก่ากว่า) */
async function pruneBackups() {
  try {
    const old = await backupsCol.orderBy('createdAt', 'desc').offset(LIMITS.backupsToKeep).limit(50).get();
    if (old.empty) return;
    const batch = db.batch();
    old.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch (err) {
    logger.warn('prune backups failed', err);
  }
}

/** บันทึกคำสั่งของผู้เล่น — ตรวจทุกคำสั่งบนข้อมูลล่าสุดใน transaction (ส่งซ้ำด้วย seq เดิมจะไม่บันทึกซ้ำ) */
export const saveCommit = onCall(async (request) => {
  await requirePlayer(request);
  checkPayloadSize(request.data);
  let commit;
  try {
    commit = validateCommit(request.data);
  } catch (err) {
    throw new HttpsError('invalid-argument', err.message);
  }
  try {
    let backedUp = false;
    const out = await db.runTransaction(async (tx) => {
      backedUp = false;
      const snap = await tx.get(saveRef);
      if (!snap.exists) throw new HttpsError('failed-precondition', 'ยังไม่มีเซฟกลาง', { reason: 'no-save' });
      const now = Date.now();
      const current = docFromFirestore(snap.data());
      const { doc: base, migrated } = migrateDoc(current);
      const result = processCommit(base, commit, { now });
      if (result.duplicate || result.epochMismatch) return result;
      if (migrated) {
        tx.create(backupsCol.doc(), backupData(makeBackup(current, { reason: 'before-migration', now, writer: commit.writer })));
        backedUp = true;
      }
      if (needsDailyBackup(current, now)) {
        tx.create(backupsCol.doc(), backupData(makeBackup(current, { reason: 'daily', now, writer: commit.writer })));
        markDailyBackup(result.doc, now);
        backedUp = true;
      }
      tx.set(saveRef, docToFirestore(result.doc, toTs));
      return result;
    });
    if (backedUp) await pruneBackups();
    return { doc: out.doc, results: out.results, snapshot: out.snapshot, duplicate: out.duplicate, epochMismatch: !!out.epochMismatch, serverTime: Date.now() };
  } catch (err) {
    throw toHttpsError(err);
  }
});

/** สร้างเซฟกลางครั้งแรก: transaction + create → หลายเครื่องกดพร้อมกันก็ได้เซฟเดียว (เครื่องหลังได้เซฟของเครื่องแรก) */
export const saveInit = onCall(async (request) => {
  await requirePlayer(request);
  checkPayloadSize(request.data);
  const { mode, legacy, writer } = request.data ?? {};
  if (mode !== 'new' && mode !== 'import') throw new HttpsError('invalid-argument', 'mode');
  if (mode === 'import' && (!legacy || typeof legacy !== 'object')) throw new HttpsError('invalid-argument', 'legacy');
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(saveRef);
      if (snap.exists) return { created: false, doc: docFromFirestore(snap.data()) };
      const now = Date.now();
      const game = mode === 'import' ? sanitizeGame(legacy, { now }) : createInitialGame({ now });
      const doc = createSaveDoc(game, { now, writer: isId(writer) ? writer : 'setup' });
      tx.create(saveRef, docToFirestore(doc, toTs));
      return { created: true, doc };
    });
  } catch (err) {
    throw toHttpsError(err);
  }
});

/** สำรอง / รีเซ็ต / กู้คืน / นำเข้าเซฟเก่า — ต้องยืนยัน และ revision ต้องตรงกับที่ผู้เล่นเห็น */
export const saveAdmin = onCall(async (request) => {
  await requirePlayer(request);
  checkPayloadSize(request.data);
  const { action, expectedRevision, legacy, backupId, confirm } = request.data ?? {};
  const writer = isId(request.data?.writer) ? request.data.writer : 'admin';
  if (!['backup', 'reset', 'restore', 'replace'].includes(action)) throw new HttpsError('invalid-argument', 'action');
  if (action !== 'backup' && (confirm !== action || !Number.isInteger(expectedRevision))) throw new HttpsError('invalid-argument', 'confirm');
  if (action === 'restore' && !isId(backupId)) throw new HttpsError('invalid-argument', 'backupId');
  try {
    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(saveRef);
      const backupSnap = action === 'restore' ? await tx.get(backupsCol.doc(backupId)) : null;
      if (!snap.exists) throw new HttpsError('failed-precondition', 'ยังไม่มีเซฟกลาง', { reason: 'no-save' });
      const now = Date.now();
      const current = docFromFirestore(snap.data());
      const ref = backupsCol.doc();
      if (action === 'backup') {
        tx.create(ref, backupData(makeBackup(current, { reason: 'manual', now, writer })));
        return { doc: null, backupId: ref.id };
      }
      const plan = planAdminAction(current, { action, expectedRevision, legacy, backup: backupSnap?.exists ? backupSnap.data() : null, now, writer });
      tx.create(ref, backupData(plan.backup));
      tx.set(saveRef, docToFirestore(plan.doc, toTs));
      logger.info('save replaced', { action, revision: current.revision, backupId: ref.id });
      return { doc: plan.doc, backupId: ref.id };
    });
    await pruneBackups();
    return out;
  } catch (err) {
    throw toHttpsError(err);
  }
});
