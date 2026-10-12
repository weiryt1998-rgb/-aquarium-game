#!/usr/bin/env node
/**
 * เปลี่ยนอีเมล และ/หรือ รหัสผ่านของ "บัญชีผู้เล่นหลัก" ใน Firebase Authentication — บัญชีเดิม UID เดิม
 *
 *   npm run account:check  -- --project fish-game-606c9    ตรวจสิทธิ์/โปรเจกต์/บัญชีอย่างเดียว (ไม่เปลี่ยนอะไร)
 *   npm run account:update -- --project fish-game-606c9    กรอกอีเมลใหม่ + รหัสผ่านใหม่ (ซ่อน) → สรุป → พิมพ์ยืนยัน → อัปเดต
 *
 * สิ่งที่สคริปต์นี้ทำ / ไม่ทำ
 * - ใช้ Firebase Admin SDK: auth.updateUser(<UID ใน firestore.rules>) — ไม่ลบบัญชี ไม่สร้างบัญชีใหม่ UID ไม่เปลี่ยน
 * - ไม่แตะ Firestore เลย (ไม่ import Firestore) → เซฟเกมและ Security Rules ไม่เปลี่ยน ไม่ต้อง deploy ใหม่
 * - รหัสผ่านพิมพ์แบบซ่อน อยู่ในหน่วยความจำของสคริปต์เท่านั้น ไม่เขียนลงไฟล์/โค้ด/log และไม่รับผ่าน argument หรือ env
 * - หลังอัปเดตสำเร็จ แก้ VITE_GAME_ACCOUNT_EMAIL ใน .env.local (บรรทัดเดียว) ให้ตรงกับอีเมลใหม่
 *
 * สิทธิ์ที่ใช้ (ตามลำดับ):
 *   1) GOOGLE_APPLICATION_CREDENTIALS (ไฟล์ service account ที่เก็บนอกโปรเจกต์) ถ้าตั้งไว้
 *   2) บัญชี Firebase CLI ที่ใช้กับโฟลเดอร์นี้ (npm run firebase -- login:use <อีเมล>) — ไม่ต้องมีไฟล์กุญแจ
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { applicationDefault, initializeApp, refreshToken } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { RULES_FILE, UID_PATTERN, readPlayerUid } from '../../scripts/player-uid.mjs';
import { ask, askNewPassword } from '../../scripts/prompt.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ENV_FILE = path.join(ROOT, '.env.local');
const FIREBASE_TOOLS_VERSION = '15.31.0';
const FORBIDDEN_PROJECTS = ['project2-ff906'];
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const { values } = parseArgs({ options: { project: { type: 'string' }, check: { type: 'boolean', default: false } } });
const fail = (msg) => {
  console.error(`✖ ${msg}`);
  process.exit(1);
};

// ── 1) ยืนยันโปรเจกต์ ─────────────────────────────────────────
function readEnv(file) {
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
  );
}

const project = values.project;
if (!project) fail('ต้องระบุ --project <project-id> (เช่น npm run account:update -- --project fish-game-606c9)');
if (FORBIDDEN_PROJECTS.includes(project)) fail(`${project} เป็นโปรเจกต์ของระบบอื่น — ห้ามใช้กับเกม`);
const rcProject = fs.existsSync(path.join(ROOT, '.firebaserc')) ? JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects?.default : null;
if (rcProject !== project) fail(`--project ${project} ไม่ตรงกับ .firebaserc (${rcProject ?? 'ไม่มีไฟล์'})`);
const env = readEnv(ENV_FILE);
if (env.VITE_FIREBASE_PROJECT_ID && env.VITE_FIREBASE_PROJECT_ID !== project) fail(`--project ${project} ไม่ตรงกับ VITE_FIREBASE_PROJECT_ID ใน .env.local (${env.VITE_FIREBASE_PROJECT_ID})`);

const uid = readPlayerUid(fs.readFileSync(RULES_FILE, 'utf8'));
if (!UID_PATTERN.test(uid)) fail('firestore.rules ยังไม่ได้ตั้ง UID ผู้เล่นหลัก');

// ── 2) สิทธิ์ ─────────────────────────────────────────────────
/** OAuth client ของ Firebase CLI (refresh token ของ CLI ใช้ได้กับ client นี้เท่านั้น) — อ่านจาก firebase-tools ที่ติดตั้งผ่าน npx */
function firebaseToolsClient() {
  const cache = spawnSync('npm config get cache', { encoding: 'utf8', shell: true }).stdout.trim();
  const npxDir = path.join(cache, '_npx');
  for (const dir of fs.existsSync(npxDir) ? fs.readdirSync(npxDir) : []) {
    const pkg = path.join(npxDir, dir, 'node_modules', 'firebase-tools', 'package.json');
    if (fs.existsSync(pkg) && JSON.parse(fs.readFileSync(pkg, 'utf8')).version === FIREBASE_TOOLS_VERSION) {
      const api = createRequire(pkg)('./lib/api.js');
      return { clientId: api.clientId(), clientSecret: api.clientSecret() };
    }
  }
  return null;
}

function cliCredential() {
  const store = path.join(process.env.USERPROFILE || process.env.HOME || '', '.config', 'configstore', 'firebase-tools.json');
  if (!fs.existsSync(store)) return null;
  const cfg = JSON.parse(fs.readFileSync(store, 'utf8'));
  const email = cfg.activeAccounts?.[ROOT] ?? cfg.user?.email;
  const account = [{ user: cfg.user, tokens: cfg.tokens }, ...(cfg.additionalAccounts ?? [])].find((a) => a.user?.email === email);
  if (!account?.tokens?.refresh_token) return null;
  const client = firebaseToolsClient();
  if (!client) fail(`ไม่พบ firebase-tools@${FIREBASE_TOOLS_VERSION} — รัน npm run firebase -- --version ก่อน แล้วลองใหม่`);
  return {
    email,
    credential: refreshToken({ type: 'authorized_user', client_id: client.clientId, client_secret: client.clientSecret, refresh_token: account.tokens.refresh_token }),
  };
}

let credential;
let who;
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  credential = applicationDefault();
  who = `service account จาก GOOGLE_APPLICATION_CREDENTIALS`;
} else {
  const cli = cliCredential();
  if (!cli) fail('ยังไม่ได้ล็อกอิน Firebase CLI — รัน npx firebase-tools@15.31.0 login:add แล้ว login:use <อีเมลเจ้าของโปรเจกต์>');
  credential = cli.credential;
  who = `บัญชี Firebase CLI ${cli.email}`;
}
process.env.GOOGLE_CLOUD_QUOTA_PROJECT ||= project; // บัญชีผู้ใช้ (ไม่ใช่ service account) ต้องระบุโปรเจกต์ที่ใช้โควตา API
initializeApp({ projectId: project, credential });
const auth = getAuth();

console.log(`โปรเจกต์      : ${project}  (.firebaserc ✓${env.VITE_FIREBASE_PROJECT_ID ? ' · .env.local ✓' : ''})`);
console.log(`สิทธิ์ที่ใช้    : ${who}`);
console.log(`UID ผู้เล่นหลัก: ${uid}  (จาก firestore.rules)`);

let user;
try {
  user = await auth.getUser(uid);
} catch (err) {
  if (err?.code === 'auth/user-not-found') fail(`ไม่พบบัญชี UID ${uid} ในโปรเจกต์ ${project}`);
  fail(`ตรวจสิทธิ์ไม่ผ่าน (${err?.code ?? 'error'}): ${err?.message ?? err} — บัญชีที่ใช้ต้องเป็น Owner/Editor/Firebase Admin ของ ${project}`);
}
const providers = user.providerData.map((p) => p.providerId);
console.log(`บัญชีปัจจุบัน : ${user.email} · provider ${providers.join(', ') || '-'} · ${user.disabled ? 'ถูกปิดใช้งาน' : 'ใช้งานได้'} · ล็อกอินล่าสุด ${user.metadata.lastSignInTime ?? 'ยังไม่เคย'}`);
console.log(`.env.local    : VITE_GAME_ACCOUNT_EMAIL=${env.VITE_GAME_ACCOUNT_EMAIL ?? '(ไม่มี)'}${env.VITE_GAME_ACCOUNT_EMAIL === user.email ? ' ✓ ตรงกับบัญชี' : ' ✖ ไม่ตรงกับบัญชี'}`);
if (!providers.includes('password')) fail('บัญชีนี้ไม่ได้ใช้การล็อกอินแบบ Email/Password');
console.log('✓ มีสิทธิ์จัดการบัญชีผู้ใช้ในโปรเจกต์นี้');

if (values.check) {
  console.log('\n(โหมด --check: ไม่ได้เปลี่ยนอะไร)');
  process.exit(0);
}
if (!process.stdin.isTTY) fail('ต้องรันใน Terminal ที่พิมพ์ได้ (ไม่รับรหัสผ่านผ่าน pipe/ไฟล์)');

// ── 3) รับอีเมลใหม่ + รหัสผ่านใหม่ ────────────────────────────
console.log('\n— กรอกข้อมูลใหม่ (กด Ctrl+C เพื่อยกเลิกได้ทุกเมื่อ ยังไม่มีอะไรเปลี่ยน) —');
let newEmail;
for (;;) {
  const answer = (await ask(`อีเมลใหม่ (Enter = ใช้ ${user.email} เดิม): `)).trim().toLowerCase();
  newEmail = answer || user.email;
  if (!EMAIL_RE.test(newEmail)) {
    console.log('× รูปแบบอีเมลไม่ถูกต้อง');
    continue;
  }
  if (newEmail !== user.email) {
    const owner = await auth.getUserByEmail(newEmail).catch((err) => (err?.code === 'auth/user-not-found' ? null : Promise.reject(err)));
    if (owner && owner.uid !== uid) {
      console.log(`× อีเมลนี้เป็นของบัญชีอื่นในโปรเจกต์อยู่แล้ว (UID ${owner.uid}) — เลือกอีเมลอื่น`);
      continue;
    }
  }
  break;
}
let password = await askNewPassword(12);
const revoke = /^(y|yes|ใช่)$/i.test((await ask('ให้ทุกอุปกรณ์ที่ล็อกอินค้างอยู่ออกจากระบบด้วยไหม? (y/N): ')).trim());

// ── 4) สรุปและยืนยัน ─────────────────────────────────────────
console.log('\nสรุปสิ่งที่จะเปลี่ยน:');
console.log(`  โปรเจกต์ : ${project}`);
console.log(`  UID      : ${uid} (เดิม ไม่เปลี่ยน)`);
console.log(`  อีเมล    : ${user.email}${newEmail === user.email ? ' (คงเดิม)' : ` → ${newEmail}`}`);
console.log('  รหัสผ่าน : เปลี่ยนเป็นรหัสใหม่ที่เพิ่งพิมพ์ (ไม่แสดง)');
console.log(`  อุปกรณ์อื่น: ${revoke ? 'ให้ออกจากระบบ (ต้องกรอกรหัสใหม่)' : 'ไม่บังคับออก'}`);
console.log('  เซฟเกม / Firestore / Security Rules: ไม่แตะ');
console.log(`  .env.local: VITE_GAME_ACCOUNT_EMAIL=${newEmail}`);
const confirm = (await ask('\nพิมพ์ "ยืนยัน" เพื่อเปลี่ยนข้อมูลจริง (อย่างอื่น = ยกเลิก): ')).trim();
if (confirm !== 'ยืนยัน') {
  password = null;
  console.log('ยกเลิกแล้ว — ไม่มีอะไรเปลี่ยน');
  process.exit(0);
}

// ── 5) อัปเดต ─────────────────────────────────────────────────
try {
  await auth.updateUser(uid, { ...(newEmail !== user.email ? { email: newEmail } : {}), password });
} catch (err) {
  password = null;
  fail(`อัปเดตไม่สำเร็จ (${err?.code ?? 'error'}) — บัญชีไม่ถูกเปลี่ยน`);
}
console.log('✓ อัปเดตบัญชีแล้ว');
if (revoke) {
  await auth.revokeRefreshTokens(uid);
  console.log('✓ ให้ทุกอุปกรณ์ออกจากระบบแล้ว (มีผลภายในไม่เกิน ~1 ชั่วโมง)');
}

// ── 6) ตรวจผล: UID เดิม อีเมลใหม่ และล็อกอินด้วยรหัสใหม่ได้จริง ─────────
const after = await auth.getUser(uid);
console.log(`✓ ตรวจแล้ว: UID ${after.uid} · อีเมล ${after.email}`);
if (env.VITE_FIREBASE_API_KEY) {
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${env.VITE_FIREBASE_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: newEmail, password, returnSecureToken: false }),
  });
  const data = await res.json().catch(() => ({}));
  console.log(res.ok && data.localId === uid ? '✓ ทดลองล็อกอินด้วยอีเมล + รหัสใหม่สำเร็จ' : `! ทดลองล็อกอินไม่ผ่าน (${data.error?.message ?? res.status}) — ลองล็อกอินในเกมอีกครั้ง`);
}
password = null;

// ── 7) อัปเดต .env.local ────────────────────────────────────
if (fs.existsSync(ENV_FILE)) {
  const text = fs.readFileSync(ENV_FILE, 'utf8');
  const line = `VITE_GAME_ACCOUNT_EMAIL=${newEmail}`;
  const next = /^VITE_GAME_ACCOUNT_EMAIL=.*$/m.test(text) ? text.replace(/^VITE_GAME_ACCOUNT_EMAIL=.*$/m, line) : `${text.trimEnd()}\n${line}\n`;
  if (next !== text) fs.writeFileSync(ENV_FILE, next);
  console.log(`✓ .env.local: ${line}`);
} else {
  console.log(`! ไม่พบ .env.local — ตั้ง VITE_GAME_ACCOUNT_EMAIL=${newEmail} เอง`);
}
console.log('\nขั้นต่อไป: ถ้าเว็บจริงอยู่บน Netlify/GitHub Pages ให้แก้ตัวแปร VITE_GAME_ACCOUNT_EMAIL ที่นั่นด้วย แล้ว build/deploy เว็บใหม่');
console.log('แจ้งรหัสผ่านใหม่ให้ผู้เล่นผ่านช่องทางส่วนตัว — อย่าโพสต์ในที่สาธารณะ');
process.exit(0);
