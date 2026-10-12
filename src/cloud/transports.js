import {
  Timestamp,
  collection,
  doc,
  getDoc,
  getDocFromCache,
  getDocFromServer,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { planAdminAction } from '../shared/adminOps.js';
import { processCommit } from '../shared/commit.js';
import { ACCESS_COLLECTION, SAVE_COLLECTION, SAVE_DOC_ID } from '../shared/constants.js';
import { createInitialGame, sanitizeGame } from '../shared/sanitize.js';
import {
  backupFromFirestore,
  createSaveDoc,
  docFromFirestore,
  docToFirestore,
  makeBackup,
  markDailyBackup,
  migrateDoc,
  needsDailyBackup,
  normalizeDoc,
} from '../shared/saveDoc.js';

export class CloudError extends Error {
  constructor(code, message = code) {
    super(message);
    this.code = code;
  }
}

/** รหัสข้อผิดพลาดแบบเดียวกันทั้ง Firestore และ Functions เช่น unavailable, permission-denied, no-save */
export function errorCode(err) {
  if (err?.details?.reason) return err.details.reason;
  const code = String(err?.code ?? '').replace(/^(functions|firestore)\//, '');
  return code || 'unknown';
}

/** ข้อความภาษาไทยของข้อผิดพลาดจากคลาวด์ */
export function cloudErrorText(err) {
  switch (errorCode(err)) {
    case 'offline':
    case 'unavailable':
    case 'deadline-exceeded':
      return 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ (ออฟไลน์หรือเน็ตช้า)';
    case 'internal':
      return 'เซิร์ฟเวอร์ไม่ตอบ — อาจเน็ตหลุด หรือยังไม่ได้ deploy Cloud Functions (ดู docs/CLOUD_SAVE.md)';
    case 'not-found':
      return 'ไม่พบ Cloud Functions — ยังไม่ได้ deploy หรือตั้ง VITE_CLOUD_SAVE_MODE / region ไม่ตรง';
    case 'permission-denied':
      return 'ไม่มีสิทธิ์ (UID ของบัญชีไม่ตรงกับที่ตั้งใน Security Rules หรือ deploy Rules ไม่ตรงกับโหมดที่ใช้)';
    case 'unauthenticated':
      return 'ยังไม่ได้เข้าสู่ระบบ หรือเซสชันหมดอายุ';
    case 'resource-exhausted':
      return 'ใช้โควตาฟรีของ Firebase วันนี้ครบแล้ว — ข้อมูลยังเก็บไว้ในเครื่องและจะบันทึกเมื่อโควตารีเซ็ต (ราว 14:00–15:00 น. เวลาไทย)';
    case 'revision-changed':
      return 'เซฟกลางเพิ่งเปลี่ยนจากอุปกรณ์อื่น กรุณาลองอีกครั้ง';
    case 'no-save':
      return 'ยังไม่มีเซฟกลาง';
    case 'newer-schema':
      return 'เซฟกลางสร้างจากเกมเวอร์ชันใหม่กว่า กรุณารีเฟรชหน้าเว็บ';
    default:
      return err?.message || 'เกิดข้อผิดพลาด';
  }
}

/** การอ่านเซฟ (ทั้งสองโหมดอ่านจาก Firestore โดยตรง — Security Rules อนุญาตเฉพาะผู้เล่นที่ได้รับสิทธิ์) */
class BaseTransport {
  constructor(fb, { writer }) {
    this.fb = fb;
    this.db = fb.db;
    this.writer = writer;
    this.ref = doc(fb.db, SAVE_COLLECTION, SAVE_DOC_ID);
    this.backupsRef = collection(this.ref, 'backups');
  }

  /** @returns {'ok'|'denied'|'unknown'} unknown = ตรวจไม่ได้ (เช่น ออฟไลน์) */
  async checkAccess(uid) {
    try {
      const snap = await getDoc(doc(this.db, ACCESS_COLLECTION, uid));
      return snap.exists() ? 'ok' : 'denied';
    } catch (err) {
      return errorCode(err) === 'permission-denied' ? 'denied' : 'unknown';
    }
  }

  /** โหลดเซฟจากเซิร์ฟเวอร์ก่อนเสมอ ถ้าออฟไลน์จึงใช้สำเนาในแคช (แจ้ง fromCache ให้ผู้เล่นรู้) */
  async load() {
    try {
      const snap = await getDocFromServer(this.ref);
      return { doc: snap.exists() ? docFromFirestore(snap.data()) : null, fromCache: false };
    } catch (err) {
      if (errorCode(err) !== 'unavailable') throw err;
      try {
        const snap = await getDocFromCache(this.ref);
        return { doc: snap.exists() ? docFromFirestore(snap.data()) : null, fromCache: true };
      } catch {
        throw new CloudError('offline', 'ออฟไลน์ และเครื่องนี้ยังไม่เคยโหลดเซฟกลาง');
      }
    }
  }

  /** ฟังการเปลี่ยนแปลงแบบเรียลไทม์ (onSnapshot) */
  subscribe(onDoc, onError) {
    return onSnapshot(this.ref, { includeMetadataChanges: true }, (snap) => onDoc(snap.exists() ? docFromFirestore(snap.data()) : null, snap.metadata), onError);
  }

  async listBackups(count = 20) {
    const snap = await getDocs(query(this.backupsRef, orderBy('createdAt', 'desc'), limit(count)));
    return snap.docs.map((d) => backupFromFirestore(d.id, d.data()));
  }

  async getBackup(id) {
    const snap = await getDoc(doc(this.backupsRef, id));
    return snap.exists() ? backupFromFirestore(snap.id, snap.data()) : null;
  }
}

/**
 * โหมด functions (แนะนำ, ต้องใช้แผน Blaze): เว็บเขียน Firestore เองไม่ได้เลย
 * ทุกการเปลี่ยนแปลงผ่าน Cloud Functions ที่ตรวจราคา/เงิน/สิทธิ์ใน transaction ด้วยเวลาของเซิร์ฟเวอร์
 */
export class FunctionsTransport extends BaseTransport {
  mode = 'functions';

  async #call(name, data) {
    const res = await httpsCallable(this.fb.functions, name, { timeout: 30000 })(data);
    return res.data;
  }

  async init({ mode, legacy }) {
    const r = await this.#call('saveInit', { mode, legacy, writer: this.writer });
    return { created: r.created, doc: normalizeDoc(r.doc) };
  }

  async commit(commit) {
    const r = await this.#call('saveCommit', commit);
    return { ...r, doc: normalizeDoc(r.doc) };
  }

  /** action: backup | reset | restore | replace */
  async admin(action, payload = {}) {
    const r = await this.#call('saveAdmin', { action, writer: this.writer, ...payload });
    return { ...r, doc: r.doc ? normalizeDoc(r.doc) : null };
  }
}

/**
 * โหมด rules (แผน Spark ฟรี): เว็บรันกฎเดียวกันใน transaction ของ Firestore แล้วเขียนเอง
 * Security Rules บังคับ: ต้องเป็นผู้เล่นที่ได้รับสิทธิ์, revision ต้องเพิ่มทีละ 1 (กันข้อมูลเก่าทับใหม่), เวลาเป็นของเซิร์ฟเวอร์,
 * รูปแบบ/ช่วงค่าถูกต้อง — แต่ไม่สามารถพิสูจน์ได้ว่าการซื้อขายแต่ละครั้งถูกต้อง (ดู docs/CLOUD_SAVE.md)
 */
export class RulesTransport extends BaseTransport {
  mode = 'rules';

  /** Rules อนุญาตเฉพาะ UID ของบัญชีผู้เล่นหลัก → ลองอ่านเซฟจากเซิร์ฟเวอร์ (ถูกปฏิเสธ = UID ไม่ตรงกับ firestore.rules) */
  async checkAccess() {
    try {
      await getDocFromServer(this.ref);
      return 'ok';
    } catch (err) {
      return errorCode(err) === 'permission-denied' ? 'denied' : 'unknown';
    }
  }

  #toFirestore(saveDoc, createdAt) {
    return { ...docToFirestore(saveDoc, Timestamp.fromMillis), createdAt: createdAt ?? serverTimestamp(), updatedAt: serverTimestamp() };
  }

  #writeBackup(tx, backup) {
    tx.set(doc(this.backupsRef), { ...backup, createdAt: serverTimestamp() });
  }

  async init({ mode, legacy }) {
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(this.ref);
      if (snap.exists()) return { created: false, doc: docFromFirestore(snap.data()) };
      const now = Date.now();
      const game = mode === 'import' ? sanitizeGame(legacy, { now }) : createInitialGame({ now });
      const saveDoc = createSaveDoc(game, { now, writer: this.writer });
      tx.set(this.ref, this.#toFirestore(saveDoc));
      return { created: true, doc: saveDoc };
    });
  }

  async commit(commit) {
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(this.ref);
      if (!snap.exists()) throw new CloudError('no-save', 'ยังไม่มีเซฟกลาง');
      const raw = snap.data();
      const current = docFromFirestore(raw);
      const now = Date.now();
      const { doc: base, migrated } = migrateDoc(current);
      const out = processCommit(base, commit, { now });
      if (out.duplicate || out.epochMismatch) return out;
      if (migrated) this.#writeBackup(tx, makeBackup(current, { reason: 'before-migration', now, writer: commit.writer }));
      if (needsDailyBackup(current, now)) {
        this.#writeBackup(tx, makeBackup(current, { reason: 'daily', now, writer: commit.writer }));
        markDailyBackup(out.doc, now);
      }
      tx.set(this.ref, this.#toFirestore(out.doc, raw.createdAt));
      return out;
    });
  }

  async admin(action, { expectedRevision, legacy, backupId } = {}) {
    return runTransaction(this.db, async (tx) => {
      const snap = await tx.get(this.ref);
      const backupSnap = backupId ? await tx.get(doc(this.backupsRef, backupId)) : null;
      if (!snap.exists()) throw new CloudError('no-save', 'ยังไม่มีเซฟกลาง');
      const raw = snap.data();
      const current = docFromFirestore(raw);
      const now = Date.now();
      if (action === 'backup') {
        this.#writeBackup(tx, makeBackup(current, { reason: 'manual', now, writer: this.writer }));
        return { doc: null };
      }
      const plan = planAdminAction(current, { action, expectedRevision, legacy, backup: backupSnap?.exists() ? backupSnap.data() : null, now, writer: this.writer });
      this.#writeBackup(tx, plan.backup);
      tx.set(this.ref, this.#toFirestore(plan.doc, raw.createdAt));
      return { doc: plan.doc };
    });
  }
}

export function createTransport(fb, cfg, { writer }) {
  return cfg.mode === 'functions' ? new FunctionsTransport(fb, { writer }) : new RulesTransport(fb, { writer });
}
