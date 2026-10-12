import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  indexedDBLocalPersistence,
  initializeAuth,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import { connectFirestoreEmulator, initializeFirestore, memoryLocalCache, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

/** เปิดใช้ Firebase เท่าที่จำเป็น: Auth (บัญชีผู้เล่นกลาง), Firestore (เซฟกลาง), Functions (ตรวจคำสั่ง) */
export function initFirebase(cfg) {
  const app = initializeApp(cfg.firebase);
  // เก็บเฉพาะ session token ของ Firebase ไว้ในเครื่อง (ไม่เก็บรหัสผ่าน) → รีเฟรชหน้าแล้วยังเข้าสู่ระบบอยู่
  const auth = initializeAuth(app, { persistence: [indexedDBLocalPersistence, browserLocalPersistence] });
  let db;
  try {
    // แคชใน IndexedDB: เปิดเกมตอนเน็ตหลุดยังเห็นเซฟล่าสุดที่เคยโหลด (แสดงสถานะว่าเป็นข้อมูลออฟไลน์)
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }), ignoreUndefinedProperties: true });
  } catch (err) {
    console.warn('ใช้แคชออฟไลน์ไม่ได้ ใช้หน่วยความจำแทน', err);
    db = initializeFirestore(app, { localCache: memoryLocalCache(), ignoreUndefinedProperties: true });
  }
  const functions = cfg.mode === 'functions' ? getFunctions(app, cfg.region) : null;

  if (cfg.emulators) {
    const { host, auth: authPort, firestore: fsPort, functions: fnPort } = cfg.emulators;
    connectAuthEmulator(auth, `http://${host}:${authPort}`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, fsPort);
    if (functions) connectFunctionsEmulator(functions, host, fnPort);
  }
  return { app, auth, db, functions };
}

export async function currentUser(auth) {
  await auth.authStateReady();
  return auth.currentUser;
}

export function signInPlayer(fb, email, password) {
  return signInWithEmailAndPassword(fb.auth, email, password).then((cred) => cred.user);
}

export function signOutPlayer(fb) {
  return signOut(fb.auth);
}

/**
 * แยกข้อผิดพลาดตอนเข้าสู่ระบบเป็นประเภท เพื่อบอกผู้เล่นว่าเป็นปัญหาที่ตัวเอง (รหัสผ่าน) หรือที่ระบบ (ตั้งค่า/เชื่อมต่อ)
 * kind: credentials = รหัสผ่าน/บัญชีไม่ตรง · config = ตั้งค่า Firebase ผิด · network = เชื่อมต่อ Firebase ไม่ได้
 *       rate-limit = ลองผิดบ่อยเกิน · disabled = บัญชีถูกปิด · unknown = อื่น ๆ (แสดง code ดิบ)
 * หมายเหตุ: โปรเจกต์ที่เปิด Email enumeration protection (ค่าเริ่มต้น) จะตอบ auth/invalid-credential
 * ทั้งกรณีรหัสผิดและอีเมลไม่มีในระบบ — แยกสองกรณีนี้จากหน้าเว็บไม่ได้ (ตั้งใจ เพื่อไม่ให้เดาอีเมลได้)
 * @returns {{ kind: string, code: string, text: string, hint: string }}
 */
export function authErrorInfo(err) {
  const code = err?.code ?? 'unknown';
  const info = (kind, text, hint = '') => ({ kind, code, text, hint });
  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return info('credentials', 'รหัสผ่านไม่ถูกต้อง', 'ตรวจว่าแป้นพิมพ์เป็นภาษาอังกฤษ, Caps Lock ปิดอยู่ และเบราว์เซอร์ไม่ได้เติมรหัสเก่าให้เอง (กด 👁 เพื่อดูสิ่งที่พิมพ์)');
    case 'auth/missing-password':
      return info('credentials', 'กรุณากรอกรหัสผ่าน');
    case 'auth/too-many-requests':
      return info('rate-limit', 'ลองผิดหลายครั้งเกินไป Firebase ระงับชั่วคราว', 'รอสักครู่ (ราว 5–15 นาที) แล้วลองใหม่ หรือให้ผู้ดูแลรีเซ็ตรหัสผ่าน');
    case 'auth/user-disabled':
      return info('disabled', 'บัญชีผู้เล่นถูกปิดใช้งาน', 'ผู้ดูแล: เปิดบัญชีที่ Firebase Console → Authentication → Users');
    case 'auth/network-request-failed':
    case 'auth/timeout':
    case 'auth/internal-error':
      return info('network', 'เชื่อมต่อ Firebase ไม่ได้', 'ตรวจอินเทอร์เน็ต หรือส่วนขยายที่บล็อก googleapis.com แล้วลองใหม่');
    case 'auth/operation-not-allowed':
    case 'auth/admin-restricted-operation':
      return info('config', 'ตั้งค่า Firebase ไม่ครบ: ยังไม่ได้เปิดการเข้าสู่ระบบแบบ Email/Password', 'ผู้ดูแล: Firebase Console → Authentication → Sign-in method → Email/Password → Enable');
    case 'auth/configuration-not-found':
      return info('config', 'ตั้งค่า Firebase ไม่ครบ: โปรเจกต์ยังไม่ได้เปิด Authentication', 'ผู้ดูแล: Firebase Console → Authentication → Get started');
    case 'auth/invalid-email':
    case 'auth/missing-email':
      return info('config', 'ตั้งค่าไม่ถูกต้อง: VITE_GAME_ACCOUNT_EMAIL ไม่ใช่อีเมลที่ใช้ได้', 'ผู้ดูแล: ตรวจด้วย npm run check:firebase');
    case 'auth/invalid-api-key':
    case 'auth/api-key-not-valid.-please-pass-a-valid-api-key.':
    case 'auth/api-key-expired.-please-renew-the-api-key.':
      return info('config', 'ตั้งค่า Firebase ไม่ถูกต้อง: API key ใช้ไม่ได้', 'ผู้ดูแล: คัดลอก firebaseConfig ใหม่จาก Project settings แล้ว build ใหม่');
    case 'auth/unauthorized-domain':
    case 'auth/requests-from-referer-are-blocked.':
    case 'auth/app-not-authorized':
      return info('config', 'โดเมนนี้ไม่ได้รับอนุญาตให้ใช้ Firebase ของเกม', 'ผู้ดูแล: เพิ่มโดเมนใน Authentication → Settings → Authorized domains และตรวจข้อจำกัด API key');
    default:
      return info('unknown', 'เข้าสู่ระบบไม่สำเร็จ', 'ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้ส่งรหัสข้อผิดพลาดด้านล่างให้ผู้ดูแล');
  }
}

/** ข้อความภาษาไทยของข้อผิดพลาดตอนเข้าสู่ระบบ */
export function authErrorText(err) {
  return authErrorInfo(err).text;
}
