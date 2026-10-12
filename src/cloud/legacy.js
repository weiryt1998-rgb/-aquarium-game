import { CONFIG } from '../config.js';
import { hashString } from '../utils/math.js';

/**
 * เซฟเก่าที่เกมเวอร์ชันก่อนเก็บใน localStorage ของเครื่องนี้
 * ระบบใหม่ "อ่านอย่างเดียว" — ไม่ลบ ไม่เขียนทับ ผู้เล่นเลือกเองว่าจะนำเข้าไปเป็นเซฟกลางหรือไม่
 */
const HANDLED_KEY = 'aquarium-legacy-handled';

export function readLegacySave() {
  try {
    const raw = localStorage.getItem(CONFIG.saveKey);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.version !== CONFIG.saveVersion || !Array.isArray(data.tanks) || data.tanks.length === 0) return null;
    const fish = data.tanks.reduce((n, t) => n + (Array.isArray(t.fish) ? t.fish.length : 0), 0);
    return {
      data,
      fingerprint: `${raw.length}:${hashString(raw)}`,
      summary: { coins: Math.floor(data.coins ?? 0), gems: Math.floor(data.gems ?? 0), fish, tanks: data.tanks.length, savedAt: data.lastSaved ?? null },
    };
  } catch {
    return null;
  }
}

/** ผู้เล่นตัดสินใจกับเซฟเก่าชุดนี้ไปแล้ว (นำเข้า หรือเลือกใช้เซฟกลาง) — ไม่ถามซ้ำ */
export function isLegacyHandled(legacy) {
  try {
    return localStorage.getItem(HANDLED_KEY) === legacy.fingerprint;
  } catch {
    return false;
  }
}

export function markLegacyHandled(legacy) {
  try {
    localStorage.setItem(HANDLED_KEY, legacy.fingerprint);
  } catch {
    /* ไม่เป็นไร จะถามอีกครั้งรอบหน้า */
  }
}

/** ดาวน์โหลดข้อมูลเป็นไฟล์ JSON (สำรองไว้ในเครื่องผู้เล่นเอง) */
export function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export const fileStamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
