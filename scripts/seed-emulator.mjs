#!/usr/bin/env node
/**
 * เตรียม Firebase Emulator สำหรับทดลองเล่นในเครื่อง: สร้างบัญชีผู้เล่นหลัก + ให้สิทธิ์เข้าเซฟกลาง
 * (แผน Spark: โหลด firestore.rules ที่ใส่ UID นี้เข้า emulator · แผน Blaze: สร้าง gameAccess/{uid})
 * ใช้คู่กับ: npm run emulators (หน้าต่างหนึ่ง) → npm run seed:emulator → npm run dev:emulators
 * ข้อมูลอยู่ใน emulator เท่านั้น ไม่แตะโปรเจกต์ Firebase จริง
 */
import fs from 'node:fs';
import { allowPlayer, createUser, setSparkPlayer, signIn } from './emulator-api.mjs';
import { askNewPassword } from './prompt.mjs';

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../.env.emulator', import.meta.url), 'utf8')
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith('#') && line.includes('='))
    .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim()]),
);
const email = env.VITE_GAME_ACCOUNT_EMAIL;
const password = process.env.SEED_GAME_PASSWORD || (await askNewPassword(8));

let uid;
try {
  ({ uid } = await createUser(email, password));
  console.log(`✓ สร้างบัญชี ${email} ใน Auth Emulator`);
} catch (err) {
  if (!/EMAIL_EXISTS/.test(err.message)) throw err;
  ({ uid } = await signIn(email, password));
  console.log(`✓ มีบัญชี ${email} อยู่แล้ว`);
}
if (env.VITE_CLOUD_SAVE_MODE === 'functions') {
  await allowPlayer(uid);
  console.log(`✓ ให้สิทธิ์ gameAccess/${uid} แล้ว (แผน Blaze)`);
} else {
  await setSparkPlayer(uid);
  console.log(`✓ โหลด firestore.rules ที่อนุญาตเฉพาะ UID ${uid} เข้า emulator แล้ว (ไฟล์ในโปรเจกต์ไม่ถูกแก้)`);
}
console.log('  เปิดเกมด้วย npm run dev:emulators แล้วกรอกรหัสผ่านที่ตั้งไว้');
