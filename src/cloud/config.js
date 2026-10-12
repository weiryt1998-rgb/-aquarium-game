import { DEFAULT_FUNCTIONS_REGION } from '../shared/constants.js';

/**
 * ค่าตั้ง Firebase จากไฟล์ .env (ตัวแปร VITE_* ถูกฝังลงหน้าเว็บตอน build)
 * ค่าเหล่านี้ไม่ใช่ความลับ — Firebase web config เปิดเผยได้ ความปลอดภัยอยู่ที่ Authentication + Security Rules
 * ห้ามใส่รหัสผ่านเกม, service account หรือ private key ในตัวแปร VITE_* เด็ดขาด
 */
const REQUIRED = ['VITE_FIREBASE_API_KEY', 'VITE_FIREBASE_AUTH_DOMAIN', 'VITE_FIREBASE_PROJECT_ID', 'VITE_FIREBASE_APP_ID', 'VITE_GAME_ACCOUNT_EMAIL'];

export function readCloudConfig(env = import.meta.env) {
  const missing = REQUIRED.filter((key) => !env[key]);
  const emulators = env.VITE_USE_FIREBASE_EMULATORS === 'true';
  return {
    ok: missing.length === 0,
    missing,
    firebase: {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: env.VITE_FIREBASE_PROJECT_ID,
      appId: env.VITE_FIREBASE_APP_ID,
      ...(env.VITE_FIREBASE_STORAGE_BUCKET ? { storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET } : {}),
      ...(env.VITE_FIREBASE_MESSAGING_SENDER_ID ? { messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID } : {}),
    },
    /** อีเมลของบัญชีผู้เล่นกลาง (เป็นแค่ชื่อบัญชี ไม่ใช่ความลับ — รหัสผ่านอยู่ใน Firebase Auth เท่านั้น) */
    accountEmail: env.VITE_GAME_ACCOUNT_EMAIL,
    /** rules = เขียนผ่าน Firestore transaction + Security Rules (แผน Spark ฟรี, ค่าเริ่มต้น) · functions = Cloud Functions (แผน Blaze เท่านั้น) */
    mode: env.VITE_CLOUD_SAVE_MODE === 'functions' ? 'functions' : 'rules',
    region: env.VITE_FIREBASE_FUNCTIONS_REGION || DEFAULT_FUNCTIONS_REGION,
    emulators: emulators ? { host: env.VITE_EMULATOR_HOST || '127.0.0.1', auth: 9099, firestore: 8080, functions: 5001 } : null,
  };
}
