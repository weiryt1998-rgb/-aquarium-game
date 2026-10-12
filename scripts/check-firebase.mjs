#!/usr/bin/env node
/**
 * ตรวจค่าตั้ง Firebase ของโปรเจกต์ (แผน Spark) ก่อน build/deploy — อ่านไฟล์ในเครื่องเท่านั้น ไม่เชื่อมต่อ Firebase
 *   npm run check:firebase
 *
 * ตรวจ: ตัวแปร VITE_* ที่หน้าเว็บต้องใช้ (.env / .env.local / .env.production[.local] หรือ environment ของเครื่อง),
 *       โหมดเซฟเป็นแผน Spark, UID ผู้เล่นหลักใน firestore.rules, โปรเจกต์ใน .firebaserc, firebase.json ไม่มี Cloud Functions
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PLACEHOLDER, RULES_FILE, UID_PATTERN, readPlayerUid } from './player-uid.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FORBIDDEN_PROJECTS = ['project2-ff906'];
const errors = [];
const warnings = [];
const ok = (msg) => console.log(`✓ ${msg}`);

function readEnvFile(name) {
  const file = `${ROOT}${name}`;
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs
      .readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => [line.slice(0, line.indexOf('=')).trim(), line.slice(line.indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2')]),
  );
}

// ลำดับเดียวกับ Vite ตอน build (ไฟล์หลังทับไฟล์ก่อน, environment ของเครื่องทับทุกไฟล์)
const files = ['.env', '.env.local', '.env.production', '.env.production.local'].filter((f) => fs.existsSync(`${ROOT}${f}`));
const env = Object.assign({}, ...files.map(readEnvFile));
for (const [k, v] of Object.entries(process.env)) if (k.startsWith('VITE_')) env[k] = v;
console.log(files.length ? `อ่านค่าจาก: ${files.join(', ')}` : 'ไม่พบไฟล์ .env.local (ถ้าตั้งค่าบน Netlify/GitHub แทน ให้ตรวจที่นั่น)');

// ── ค่าตั้งหน้าเว็บ ──────────────────────────────────────────
const REQUIRED = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_GAME_ACCOUNT_EMAIL'];
const missing = REQUIRED.filter((k) => !env[k]);
if (missing.length) (files.length ? errors : warnings).push(`ยังไม่ได้ตั้ง ${missing.join(', ')}`);
else ok('ตั้งตัวแปร VITE_* ที่จำเป็นครบ');

const project = env.VITE_FIREBASE_PROJECT_ID;
if (project) {
  if (FORBIDDEN_PROJECTS.includes(project)) errors.push(`VITE_FIREBASE_PROJECT_ID = ${project} เป็นโปรเจกต์ของระบบอื่น — สร้างโปรเจกต์ใหม่สำหรับเกม`);
  if (project.startsWith('demo-')) errors.push(`VITE_FIREBASE_PROJECT_ID = ${project} เป็นค่าของ emulator ไม่ใช่โปรเจกต์จริง`);
  if (env.VITE_FIREBASE_AUTH_DOMAIN && !env.VITE_FIREBASE_AUTH_DOMAIN.startsWith(`${project}.`)) {
    warnings.push(`VITE_FIREBASE_AUTH_DOMAIN (${env.VITE_FIREBASE_AUTH_DOMAIN}) ไม่ขึ้นต้นด้วย ${project}. — ตรวจว่าคัดลอกจากโปรเจกต์เดียวกัน`);
  }
}
if (env.VITE_GAME_ACCOUNT_EMAIL && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(env.VITE_GAME_ACCOUNT_EMAIL)) errors.push('VITE_GAME_ACCOUNT_EMAIL ไม่ใช่รูปแบบอีเมล');
if (env.VITE_USE_FIREBASE_EMULATORS === 'true') errors.push('VITE_USE_FIREBASE_EMULATORS=true — ห้ามใช้กับเว็บจริง');
if (env.VITE_CLOUD_SAVE_MODE === 'functions') errors.push('VITE_CLOUD_SAVE_MODE=functions ต้องใช้ Cloud Functions (แผน Blaze) — ลบออกหรือตั้งเป็น rules');
else ok('โหมดเซฟ: แผน Spark (Firestore transaction + Security Rules)');
for (const [k, v] of Object.entries(env)) {
  if (k.startsWith('VITE_') && /PASSWORD|SECRET|PRIVATE/i.test(k)) errors.push(`${k}: ห้ามใส่รหัสผ่าน/ข้อมูลลับในตัวแปร VITE_* (ถูกฝังลงหน้าเว็บ)`);
  if (k.startsWith('VITE_') && /BEGIN PRIVATE KEY|"private_key"/.test(v)) errors.push(`${k}: มี private key — ลบออกทันที`);
}

// ── Security Rules ───────────────────────────────────────────
const uid = readPlayerUid(fs.readFileSync(RULES_FILE, 'utf8'));
if (uid === PLACEHOLDER || !UID_PATTERN.test(uid)) errors.push('firestore.rules ยังไม่ได้ตั้ง UID ผู้เล่นหลัก → npm run set-player-uid -- <UID>');
else ok(`firestore.rules อนุญาตเฉพาะ UID ${uid}`);

// ── Firebase CLI ─────────────────────────────────────────────
const firebaseJson = JSON.parse(fs.readFileSync(`${ROOT}firebase.json`, 'utf8'));
if (firebaseJson.functions) errors.push('firebase.json มี functions — แผน Spark deploy Cloud Functions ไม่ได้');
else if (firebaseJson.firestore?.rules !== 'firestore.rules') errors.push('firebase.json ต้อง deploy firestore.rules');
else ok('firebase.json deploy เฉพาะ Firestore (rules + indexes)');

const rcFile = `${ROOT}.firebaserc`;
if (!fs.existsSync(rcFile)) warnings.push('ยังไม่ได้เลือกโปรเจกต์สำหรับ deploy → npm run firebase -- use --add');
else {
  const rcProject = JSON.parse(fs.readFileSync(rcFile, 'utf8')).projects?.default;
  if (FORBIDDEN_PROJECTS.includes(rcProject)) errors.push(`.firebaserc ชี้ไปที่ ${rcProject} (โปรเจกต์ของระบบอื่น)`);
  else if (project && rcProject && rcProject !== project) errors.push(`.firebaserc (${rcProject}) ไม่ตรงกับ VITE_FIREBASE_PROJECT_ID (${project})`);
  else ok(`.firebaserc: โปรเจกต์ ${rcProject}`);
}

for (const w of warnings) console.log(`! ${w}`);
for (const e of errors) console.log(`✖ ${e}`);
if (errors.length) {
  console.log(`\nพบปัญหา ${errors.length} ข้อ — ดู docs/CLOUD_SAVE.md`);
  process.exit(1);
}
console.log(warnings.length ? '\nไม่มีข้อผิดพลาด (มีข้อควรตรวจด้านบน)' : '\nค่าตั้งพร้อมใช้งาน');
