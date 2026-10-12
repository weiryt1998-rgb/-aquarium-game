#!/usr/bin/env node
/**
 * ตั้ง / เปลี่ยน "รหัสผ่านเกม" (บัญชีผู้เล่นหลักใน Firebase Authentication) และใส่ UID ของบัญชีนั้นลง firestore.rules ในเครื่อง
 * (ใช้ได้กับแผน Spark — Admin SDK จัดการบัญชีได้โดยไม่ต้องใช้ Cloud Functions · สคริปต์นี้ไม่ deploy อะไร)
 * รันบนเครื่องของผู้ดูแลเท่านั้น — รหัสผ่านถูกพิมพ์แบบซ่อนตัวอักษร และส่งตรงไป Firebase ไม่ถูกบันทึกลงไฟล์ใด
 *
 * ใช้:
 *   node functions/scripts/set-game-password.mjs --project <project-id> --email <อีเมลบัญชีหลัก> [--revoke] [--blaze]
 *     --revoke  ตัดการเข้าสู่ระบบของทุกอุปกรณ์ทันที (ใช้ตอนเปลี่ยนรหัสเพราะรหัสเดิมรั่ว)
 *     --blaze   (เฉพาะแผน Blaze) สร้างเอกสาร gameAccess/{uid} แทนการแก้ firestore.rules
 *
 * สิทธิ์ที่ต้องใช้ (เลือกอย่างใดอย่างหนึ่ง — ห้ามใส่ไฟล์กุญแจไว้ในโฟลเดอร์โปรเจกต์หรือ commit เด็ดขาด):
 *   - gcloud auth application-default login   (ใช้บัญชี Google ของผู้ดูแลโปรเจกต์)
 *   - หรือ GOOGLE_APPLICATION_CREDENTIALS=<path ไฟล์ service account ที่เก็บนอกโปรเจกต์>
 *     (สร้างที่ Firebase Console → Project settings → Service accounts → ใช้เสร็จแล้วควรลบกุญแจทิ้ง)
 * ทดลองกับ emulator: ตั้ง FIREBASE_AUTH_EMULATOR_HOST และ FIRESTORE_EMULATOR_HOST ก่อนรัน (ไม่ต้องใช้กุญแจ)
 */
import { parseArgs } from 'node:util';
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import fs from 'node:fs';
import { RULES_FILE, readPlayerUid, withPlayerUid } from '../../scripts/player-uid.mjs';
import { askNewPassword } from '../../scripts/prompt.mjs';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    email: { type: 'string' },
    revoke: { type: 'boolean', default: false },
    blaze: { type: 'boolean', default: false },
  },
});

if (!values.project || !values.email) {
  console.error('ต้องระบุ --project <project-id> และ --email <อีเมลบัญชีผู้เล่นหลัก>');
  process.exit(1);
}
if (values.project === 'project2-ff906') {
  console.error('✖ project2-ff906 เป็นโปรเจกต์ของระบบอื่น — ใช้โปรเจกต์ของเกมเท่านั้น');
  process.exit(1);
}

const usingEmulator = !!(process.env.FIREBASE_AUTH_EMULATOR_HOST && process.env.FIRESTORE_EMULATOR_HOST);
initializeApp(usingEmulator ? { projectId: values.project } : { projectId: values.project, credential: applicationDefault() });
const auth = getAuth();

console.log(`โปรเจกต์: ${values.project}${usingEmulator ? ' (emulator)' : ''}`);
console.log(`บัญชีผู้เล่นหลัก: ${values.email}`);
const password = await askNewPassword(12);

let user;
try {
  user = await auth.getUserByEmail(values.email);
  await auth.updateUser(user.uid, { password });
  console.log('✓ เปลี่ยนรหัสผ่านแล้ว');
} catch (err) {
  if (err?.code !== 'auth/user-not-found') throw err;
  user = await auth.createUser({ email: values.email, password, emailVerified: true });
  console.log('✓ สร้างบัญชีผู้เล่นหลักแล้ว');
}

if (values.blaze) {
  await getFirestore().doc(`gameAccess/${user.uid}`).set({ role: 'player', updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  console.log(`✓ ให้สิทธิ์เข้าเซฟกลางแล้ว (gameAccess/${user.uid})`);
} else {
  const rules = fs.readFileSync(RULES_FILE, 'utf8');
  if (readPlayerUid(rules) === user.uid) console.log(`✓ firestore.rules ใช้ UID ${user.uid} อยู่แล้ว`);
  else {
    fs.writeFileSync(RULES_FILE, withPlayerUid(rules, user.uid));
    console.log(`✓ ใส่ UID ${user.uid} ลง firestore.rules แล้ว — ยังไม่ได้ deploy: รัน npm run deploy เมื่อพร้อม`);
  }
}

if (values.revoke) {
  await auth.revokeRefreshTokens(user.uid);
  console.log('✓ ตัดการเข้าสู่ระบบของทุกอุปกรณ์แล้ว (อุปกรณ์เดิมจะต้องกรอกรหัสใหม่ภายในไม่เกิน 1 ชั่วโมง)');
}
console.log('\nแจ้งรหัสผ่านใหม่ให้ผู้เล่นผ่านช่องทางส่วนตัว — อย่าโพสต์ในที่สาธารณะ หรือใส่ไว้ในโค้ด/ไฟล์ .env');
process.exit(0);
