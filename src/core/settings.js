import { CONFIG } from '../config.js';

/**
 * การตั้งค่าของอุปกรณ์นี้ (เสียง, คุณภาพกราฟิก) — ไม่อยู่ในเซฟกลาง
 * เพราะมือถือกับคอมพิวเตอร์ควรตั้งคุณภาพกราฟิกต่างกันได้
 */
const KEY = 'aquarium-game-settings';
const DEFAULTS = { sound: true, ambient: true, quality: 'high' };

function readJson(key) {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

export function loadSettings() {
  // ครั้งแรกหลังอัปเดต: ใช้ค่าจากเซฟเก่าในเครื่อง (ถ้ามี)
  const saved = readJson(KEY) ?? readJson(CONFIG.saveKey)?.settings ?? {};
  const s = { ...DEFAULTS, ...(typeof saved === 'object' ? saved : {}) };
  return {
    sound: s.sound !== false,
    ambient: s.ambient !== false,
    quality: ['high', 'medium', 'low'].includes(s.quality) ? s.quality : DEFAULTS.quality,
  };
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ sound: !!settings.sound, ambient: !!settings.ambient, quality: settings.quality }));
  } catch {
    /* เบราว์เซอร์ไม่ให้เขียน (เช่นโหมดส่วนตัว) — ใช้ค่าในหน่วยความจำต่อ */
  }
}
