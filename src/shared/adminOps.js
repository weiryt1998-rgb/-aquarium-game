import { createInitialGame, sanitizeGame } from './sanitize.js';
import { makeBackup, replaceGameInDoc } from './saveDoc.js';

/**
 * การกระทำที่แทนข้อมูลทั้งเซฟ (รีเซ็ต / กู้คืน / นำเข้าเซฟเก่าทับ)
 * ทุกแบบ: ต้องยืนยัน + revision ต้องตรงกับที่ผู้เล่นเห็นตอนกดยืนยัน + สร้างจุดสำรองของข้อมูลเดิมก่อนเสมอ
 * ผู้เรียก (Cloud Function หรือ transaction ฝั่งเว็บ) ต้องเขียน backup และ doc ใน transaction เดียวกัน
 */
export const ADMIN_ACTIONS = ['reset', 'restore', 'replace'];

function adminError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function planAdminAction(current, { action, expectedRevision, legacy, backup, now, writer }) {
  if (!ADMIN_ACTIONS.includes(action)) throw adminError('invalid-argument', 'action');
  if (current.revision !== expectedRevision) throw adminError('revision-changed', 'เซฟกลางเพิ่งเปลี่ยนจากอุปกรณ์อื่น กรุณาตรวจสอบแล้วยืนยันอีกครั้ง');
  let game;
  if (action === 'reset') game = createInitialGame({ now });
  else if (action === 'replace') {
    if (!legacy || typeof legacy !== 'object') throw adminError('invalid-argument', 'legacy');
    game = sanitizeGame(legacy, { now });
  } else {
    if (!backup?.game) throw adminError('not-found', 'ไม่พบจุดสำรองนี้');
    game = sanitizeGame(backup.game, { now });
  }
  return {
    backup: makeBackup(current, { reason: `before-${action}`, now, writer }),
    doc: replaceGameInDoc(current, game, { now, writer }),
  };
}
