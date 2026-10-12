#!/usr/bin/env node
/**
 * UID ของบัญชีผู้เล่นหลักใน firestore.rules (Security Rules ของแผน Spark)
 *
 *   npm run set-player-uid -- <UID>      ใส่ UID (คัดลอกจาก Firebase Console → Authentication → Users หรือจากหน้า "ยังไม่ได้รับสิทธิ์" ในเกม)
 *   node scripts/player-uid.mjs check    ตรวจก่อน deploy (firebase.json เรียกให้อัตโนมัติทุกครั้งที่ deploy)
 *
 * UID ไม่ใช่ความลับ — ความปลอดภัยมาจากรหัสผ่านใน Firebase Authentication + การเทียบ UID ใน Rules
 * สคริปต์นี้แก้ไฟล์ในเครื่องเท่านั้น ไม่ deploy อะไรขึ้น Firebase
 */
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const RULES_FILE = fileURLToPath(new URL('../firestore.rules', import.meta.url));
export const PLACEHOLDER = 'SET_PLAYER_UID_BEFORE_DEPLOY';
/** UID ของบัญชี Email/Password ใน Firebase เป็นตัวอักษร/ตัวเลข (ปกติ 28 ตัว) */
export const UID_PATTERN = /^[A-Za-z0-9]{10,128}$/;
/** โปรเจกต์ที่ห้าม deploy เกมลงไป (เป็นของระบบเอกสารราชการ — rules ของเกมจะทับของระบบนั้น) */
const FORBIDDEN_PROJECTS = ['project2-ff906'];
const LINE = /(function playerUid\(\) \{\s*return ')([^']*)(';)/;

export function readPlayerUid(rules) {
  const m = rules.match(LINE);
  if (!m) throw new Error('ไม่พบ function playerUid() ใน firestore.rules');
  return m[2];
}

export function withPlayerUid(rules, uid) {
  if (!UID_PATTERN.test(uid)) throw new Error(`UID ไม่ถูกต้อง: "${uid}" (ต้องเป็นตัวอักษรภาษาอังกฤษ/ตัวเลข 10–128 ตัว)`);
  readPlayerUid(rules);
  return rules.replace(LINE, `$1${uid}$3`);
}

function check() {
  const project = process.env.GCLOUD_PROJECT; // Firebase CLI ส่งค่านี้ให้ predeploy hook
  if (project && FORBIDDEN_PROJECTS.includes(project)) {
    console.error(`✖ ห้าม deploy เกมลงโปรเจกต์ ${project} (เป็นของระบบอื่น) — ใช้ npm run firebase -- use <project-ของเกม>`);
    process.exit(1);
  }
  const uid = readPlayerUid(fs.readFileSync(RULES_FILE, 'utf8'));
  if (uid === PLACEHOLDER || !UID_PATTERN.test(uid)) {
    console.error('✖ ยังไม่ได้ตั้ง UID ของบัญชีผู้เล่นหลักใน firestore.rules');
    console.error('  คัดลอก User UID จาก Firebase Console → Authentication → Users แล้วรัน: npm run set-player-uid -- <UID>');
    process.exit(1);
  }
  console.log(`✓ firestore.rules อนุญาตเฉพาะ UID ${uid}${project ? ` (โปรเจกต์ ${project})` : ''}`);
}

function set(uid) {
  if (!uid) {
    console.error('วิธีใช้: npm run set-player-uid -- <UID>');
    process.exit(1);
  }
  const rules = fs.readFileSync(RULES_FILE, 'utf8');
  const before = readPlayerUid(rules);
  fs.writeFileSync(RULES_FILE, withPlayerUid(rules, uid.trim()));
  console.log(`✓ ตั้ง UID ผู้เล่นหลักใน firestore.rules แล้ว: ${uid.trim()}${before !== PLACEHOLDER && before !== uid.trim() ? ` (เดิม ${before})` : ''}`);
  console.log('  ยังไม่ได้ deploy — เมื่อพร้อมให้รัน npm run deploy');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, arg] = process.argv.slice(2);
  try {
    if (cmd === 'check') check();
    else if (cmd === 'set') set(arg);
    else {
      console.error('วิธีใช้: node scripts/player-uid.mjs set <UID> | check');
      process.exit(1);
    }
  } catch (err) {
    console.error(`✖ ${err.message}`);
    process.exit(1);
  }
}
