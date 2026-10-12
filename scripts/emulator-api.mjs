/**
 * ตัวช่วยเรียก Firebase Emulator ผ่าน REST (ใช้ในสคริปต์ seed และการทดสอบ) — ใช้กับ emulator เท่านั้น
 * project id ขึ้นต้นด้วย demo- จึงไม่มีทางแตะโปรเจกต์ Firebase จริง
 */
import fs from 'node:fs';
import { RULES_FILE, withPlayerUid } from './player-uid.mjs';

export const PROJECT = process.env.GCLOUD_PROJECT || 'demo-aquarium';
const hostOf = (name, fallback) => `http://${process.env[name] || fallback}`;
export const AUTH_URL = hostOf('FIREBASE_AUTH_EMULATOR_HOST', '127.0.0.1:9099');
export const FIRESTORE_URL = hostOf('FIRESTORE_EMULATOR_HOST', '127.0.0.1:8080');
export const FUNCTIONS_URL = `http://127.0.0.1:5001/${PROJECT}/asia-southeast1`;
export const API_KEY = 'demo-api-key';
const DOCS = `${FIRESTORE_URL}/v1/projects/${PROJECT}/databases/(default)/documents`;

async function json(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { raw: text };
  }
}

/** ล้างข้อมูลทั้งหมดใน emulator (Firestore + Auth) */
export async function resetEmulators() {
  await fetch(`${FIRESTORE_URL}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`${AUTH_URL}/emulator/v1/projects/${PROJECT}/accounts`, { method: 'DELETE' });
}

async function identity(endpoint, body) {
  const res = await fetch(`${AUTH_URL}/identitytoolkit.googleapis.com/v1/accounts:${endpoint}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, returnSecureToken: true }),
  });
  const data = await json(res);
  if (!res.ok) throw Object.assign(new Error(data?.error?.message ?? `auth ${res.status}`), { status: res.status, data });
  return { uid: data.localId, idToken: data.idToken };
}

export const createUser = (email, password) => identity('signUp', { email, password });
export const signIn = (email, password) => identity('signInWithPassword', { email, password });

// ── แปลงค่า Firestore REST ↔ JS ──────────────────────────────

export function decode(v) {
  if (!v || typeof v !== 'object') return v;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('timestampValue' in v) return Date.parse(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values ?? []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields ?? {});
  return v;
}

export function decodeFields(fields) {
  return Object.fromEntries(Object.entries(fields).map(([k, val]) => [k, decode(val)]));
}

export function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, val]) => [k, encode(val)])) } };
}

/** อ่านเอกสาร (token 'owner' = ข้าม Security Rules แบบผู้ดูแล emulator, null = ไม่ได้เข้าสู่ระบบ) */
export async function readDoc(path, token = 'owner') {
  const res = await fetch(`${DOCS}/${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (res.status === 404) return { status: 404, data: null };
  const body = await json(res);
  return { status: res.status, data: res.ok ? decodeFields(body.fields ?? {}) : null, error: res.ok ? null : body };
}

export async function listDocs(path, token = 'owner') {
  const res = await fetch(`${DOCS}/${path}?pageSize=100`, { headers: { Authorization: `Bearer ${token}` } });
  const body = await json(res);
  return { status: res.status, docs: (body?.documents ?? []).map((d) => ({ id: d.name.split('/').pop(), ...decodeFields(d.fields ?? {}) })) };
}

/** เขียนเอกสาร (ใช้ทดสอบว่าหน้าเว็บเขียนตรงไม่ได้ หรือใช้ seed ด้วย owner) */
export async function writeDoc(path, data, token = 'owner') {
  const res = await fetch(`${DOCS}/${path}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: encode(data).mapValue.fields }),
  });
  return { status: res.status, body: await json(res) };
}

/** ให้สิทธิ์แบบแผน Blaze (firestore.blaze.rules อ่านรายชื่อ gameAccess) */
export const allowPlayer = (uid) => writeDoc(`gameAccess/${uid}`, { role: 'player', note: 'emulator' });

/** โหลด Security Rules ชุดใหม่เข้า Firestore Emulator (ไม่แก้ไฟล์ในโปรเจกต์) */
export async function loadRules(content) {
  const res = await fetch(`${FIRESTORE_URL}/emulator/v1/projects/${PROJECT}:securityRules`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules: { files: [{ name: 'firestore.rules', content }] } }),
  });
  if (!res.ok) throw new Error(`load rules ${res.status}: ${await res.text()}`);
}

/** ให้สิทธิ์แบบแผน Spark: โหลด firestore.rules ที่ใส่ UID นี้เป็นบัญชีผู้เล่นหลัก เข้า emulator */
export async function setSparkPlayer(uid) {
  await loadRules(withPlayerUid(fs.readFileSync(RULES_FILE, 'utf8'), uid));
}

export async function deleteDoc(path, token = 'owner') {
  const res = await fetch(`${DOCS}/${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  return { status: res.status };
}

/** ล้างเฉพาะข้อมูล Firestore (บัญชีใน Auth ยังอยู่) */
export async function clearFirestore() {
  await fetch(`${FIRESTORE_URL}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
}

/** เรียก callable function ผ่านโปรโตคอล HTTP ของ Firebase */
export async function callFunction(name, data, idToken) {
  const res = await fetch(`${FUNCTIONS_URL}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
    body: JSON.stringify({ data }),
  });
  const body = await json(res);
  return { status: res.status, result: body?.result, error: body?.error };
}

/** รอให้ emulator พร้อม */
export async function waitForEmulators(timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      const [a, f] = await Promise.all([fetch(`${AUTH_URL}/`), fetch(`${FIRESTORE_URL}/`)]);
      if (a.ok !== undefined && f.ok !== undefined) return;
    } catch {
      if (Date.now() > end) throw new Error('emulators not reachable');
      await new Promise((r) => setTimeout(r, 500));
    }
  }
}
