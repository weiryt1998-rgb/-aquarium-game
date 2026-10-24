import { getSpecies } from '../data/fish.js';
import { todayKey } from '../utils/math.js';
import { SCHEMA_VERSION } from './constants.js';
import { summarizeGame } from './economy.js';

/**
 * เอกสารเซฟกลาง gameSaves/global (รูปแบบในโค้ด — เวลาเป็นมิลลิวินาที)
 * {
 *   schemaVersion, revision,   // revision เพิ่มทีละ 1 ทุกครั้งที่บันทึก (ใช้ตรวจข้อมูลเก่า/ใหม่)
 *   epoch,                     // เพิ่มเมื่อรีเซ็ต/กู้คืน/นำเข้า → คำสั่งที่ค้างจากก่อนหน้าถูกยกเลิกทั้งหมด
 *   createdAt, updatedAt, updatedBy,
 *   game: { ...ข้อมูลเกม รูปเดียวกับ GameState.data },
 *   meta: {
 *     writers: { [writerId]: { seq, at } },   // กันคำสั่งซ้ำ: เลขลำดับล่าสุดที่บันทึกแล้วของแต่ละหน้าเกม
 *     tanks: { [tankId]: { simRev, simBy, simAt, incomeBank, incomeAt, lastFedAt, foodHealthBudget, lastMedAt, offlineAt, bredAt } },
 *     lastBackupDay,
 *   }
 * }
 */

export const cloneData = (v) => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

function freshMeta(prev) {
  return { writers: prev?.writers ?? {}, tanks: {}, lastBackupDay: prev?.lastBackupDay ?? null };
}

export function normalizeDoc(doc) {
  doc.schemaVersion ??= SCHEMA_VERSION;
  doc.revision ??= 0;
  doc.epoch ??= 0;
  doc.meta = { ...freshMeta(), ...(doc.meta ?? {}) };
  doc.meta.writers ??= {};
  doc.meta.tanks ??= {};
  dropRemovedSpecies(doc.game);
  return doc;
}

/**
 * ปลาของสายพันธุ์ที่ถูกลบออกจากเกมแล้ว (เช่น ปลาอวกาศ) → เอาออกจากตู้ตอนอ่านเซฟ
 * ไม่ให้เกมพังเพราะหาข้อมูลสายพันธุ์ไม่เจอ และไม่กินที่ในตู้ — การบันทึกครั้งถัดไปจะเขียนเซฟที่ไม่มีปลาเหล่านี้ทับ
 * (สายพันธุ์ที่แค่เลิกขาย ใส่ retired: true ไว้ใน data/fish.js จะไม่โดนลบ)
 */
function dropRemovedSpecies(game) {
  for (const tank of Array.isArray(game?.tanks) ? game.tanks : []) {
    if (Array.isArray(tank?.fish)) tank.fish = tank.fish.filter((f) => getSpecies(f?.speciesId));
  }
}

export function createSaveDoc(game, { now, writer = 'setup' }) {
  return { schemaVersion: SCHEMA_VERSION, revision: 1, epoch: 0, createdAt: now, updatedAt: now, updatedBy: writer, game, meta: freshMeta() };
}

/** แทนข้อมูลเกมทั้งชุด (รีเซ็ต / กู้คืน / นำเข้าเซฟเก่า) — ผู้เรียกต้องสร้างจุดสำรองของข้อมูลเดิมก่อนเสมอ */
export function replaceGameInDoc(doc, game, { now, writer }) {
  return {
    ...doc,
    schemaVersion: SCHEMA_VERSION,
    revision: doc.revision + 1,
    epoch: (doc.epoch ?? 0) + 1,
    updatedAt: now,
    updatedBy: writer,
    game,
    meta: freshMeta(doc.meta),
  };
}

export function makeBackup(doc, { reason, now, writer }) {
  return {
    createdAt: now,
    reason,
    revision: doc.revision,
    epoch: doc.epoch ?? 0,
    schemaVersion: doc.schemaVersion ?? SCHEMA_VERSION,
    by: writer ?? 'unknown',
    summary: summarizeGame(doc.game),
    game: doc.game,
  };
}

/** สำรองอัตโนมัติวันละครั้ง (ก่อนการบันทึกแรกของวัน) */
export function needsDailyBackup(doc, now) {
  return (doc.meta?.lastBackupDay ?? null) !== todayKey(new Date(now));
}

export function markDailyBackup(doc, now) {
  doc.meta.lastBackupDay = todayKey(new Date(now));
}

const toMs = (v) => (typeof v?.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : 0);

/** Firestore → โค้ด (Timestamp → มิลลิวินาที) ใช้ได้ทั้ง Web SDK และ Admin SDK */
export function docFromFirestore(data) {
  return normalizeDoc({ ...data, createdAt: toMs(data.createdAt), updatedAt: toMs(data.updatedAt) });
}

/** โค้ด → Firestore: toTimestamp(ms) สร้าง Timestamp ของ SDK ที่ใช้อยู่ */
export function docToFirestore(doc, toTimestamp) {
  return { ...doc, createdAt: toTimestamp(doc.createdAt), updatedAt: toTimestamp(doc.updatedAt) };
}

export function backupFromFirestore(id, data) {
  return { id, ...data, createdAt: toMs(data.createdAt) };
}

/**
 * ย้ายข้อมูลจาก schema เก่ามาเป็นปัจจุบัน — ตอนนี้มีเวอร์ชันเดียว จึงยังไม่ต้องแปลงอะไร
 * ถ้าวันหน้าเพิ่ม SCHEMA_VERSION ให้เขียนขั้นตอนแปลงที่นี่ ระบบจะสร้างจุดสำรอง 'before-migration' ก่อนเขียนผลลัพธ์เสมอ
 */
export function migrateDoc(doc) {
  if (doc.schemaVersion > SCHEMA_VERSION) {
    const err = new Error('เซฟกลางสร้างจากเกมเวอร์ชันใหม่กว่า — กรุณารีเฟรชหน้าเว็บเพื่ออัปเดตเกม');
    err.code = 'newer-schema';
    throw err;
  }
  if (doc.schemaVersion === SCHEMA_VERSION) return { doc, migrated: false };
  return { doc: { ...doc, schemaVersion: SCHEMA_VERSION }, migrated: true };
}
