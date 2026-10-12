/**
 * ค่าคงที่ของระบบเซฟกลาง (ใช้ร่วมกันทั้งหน้าเว็บ, Cloud Functions และ Security Rules ให้ตรงกัน)
 * ไฟล์ในโฟลเดอร์ shared/ ต้องไม่แตะ DOM / Three.js เพราะถูก bundle ไปรันบนเซิร์ฟเวอร์ด้วย
 */

/** ที่อยู่เอกสารเซฟกลางใน Firestore (มีชุดเดียวทั้งเกม) */
export const SAVE_COLLECTION = 'gameSaves';
export const SAVE_DOC_ID = 'global';
export const SAVE_PATH = `${SAVE_COLLECTION}/${SAVE_DOC_ID}`;
export const BACKUPS_PATH = `${SAVE_PATH}/backups`;
/** รายชื่อ UID ที่มีสิทธิ์เล่น (ผู้ดูแลสร้างเองใน Firebase Console) */
export const ACCESS_COLLECTION = 'gameAccess';

/** เวอร์ชันโครงสร้างเอกสารบนคลาวด์ — เพิ่มเมื่อเปลี่ยน schema (ระบบจะสำรองก่อน migrate) */
export const SCHEMA_VERSION = 1;

/** region ของ Cloud Functions (สิงคโปร์ ใกล้ไทยที่สุดที่มี Firestore/Functions ครบ) */
export const DEFAULT_FUNCTIONS_REGION = 'asia-southeast1';

export const LIMITS = {
  maxCoins: 1_000_000_000,
  maxGems: 10_000_000,
  maxItem: 1_000_000,
  decorPerTank: 150,
  commandsPerCommit: 300,
  nameLength: 16,
  /** ลบข้อมูลกันส่งซ้ำของอุปกรณ์ที่ไม่ได้ใช้นานเกินนี้ */
  writerTtlMs: 14 * 24 * 3600 * 1000,
  /** เก็บข้อมูลกันส่งซ้ำไว้ไม่เกินจำนวนนี้ (หน้าเกมที่บันทึกล่าสุด) — ต้องน้อยกว่าเพดานใน firestore.spark.rules */
  maxWriters: 200,
  /** คำสั่งที่ค้างในเครื่องนานเกินนี้จะถูกทิ้ง ไม่ส่งขึ้นคลาวด์ (ต้องน้อยกว่า writerTtlMs) */
  outboxTtlMs: 7 * 24 * 3600 * 1000,
  /** จำนวนจุดสำรองที่เก็บไว้ (โหมด Functions ลบที่เก่ากว่านี้ให้อัตโนมัติ) */
  backupsToKeep: 30,
};

/** ช่วงเวลาที่ถือว่า "เพิ่งให้อาหาร" — ความอิ่มของปลาเพิ่มได้เฉพาะช่วงนี้ */
export const FEED_WINDOW_MS = 180_000;

/** เหตุผลของจุดสำรอง */
export const BACKUP_REASONS = ['daily', 'manual', 'before-reset', 'before-restore', 'before-replace', 'before-migration'];

/** รหัสข้อผิดพลาดของคำสั่ง → ข้อความไทย */
export const COMMAND_ERROR_TEXT = {
  'insufficient-funds': 'เงินไม่พอ',
  'tank-full': 'ตู้เต็มแล้ว',
  'tank-too-small': 'ตู้เล็กเกินไปสำหรับปลาชนิดนี้',
  'not-found': 'ไม่พบรายการนี้ (อาจถูกขาย/ลบจากอุปกรณ์อื่นแล้ว)',
  'already-claimed': 'รับรางวัลไปแล้ว',
  'not-complete': 'ภารกิจยังไม่สำเร็จ',
  'already-owned': 'มีอยู่แล้ว',
  cooldown: 'ยังอยู่ในช่วงรอ',
  'out-of-stock': 'ของหมด',
  limit: 'เกินจำนวนที่กำหนด',
  invalid: 'ข้อมูลไม่ถูกต้อง',
  epoch: 'เซฟกลางถูกรีเซ็ตหรือกู้คืนจากอุปกรณ์อื่น',
  internal: 'เซิร์ฟเวอร์ประมวลผลไม่สำเร็จ',
};
