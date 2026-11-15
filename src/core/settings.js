import { CONFIG } from '../config.js';

/**
 * การตั้งค่าของอุปกรณ์นี้ (เสียง, คุณภาพกราฟิก) — ไม่อยู่ในเซฟกลาง
 * เพราะมือถือกับคอมพิวเตอร์ควรตั้งคุณภาพกราฟิกต่างกันได้
 */
const KEY = 'aquarium-game-settings';
const DEFAULTS = { sound: true, ambient: true, quality: 'high' };

/**
 * คุณภาพเริ่มต้นตามอุปกรณ์ (ใช้จนกว่าผู้เล่นจะเลือกเองในหน้าตั้งค่า — qualityChosen)
 * คอมพิวเตอร์ = สูง · แท็บเล็ต = กลาง · มือถือ (จอแคบ) หรือแรมน้อย = ต่ำ
 * มือถือ/แท็บเล็ตที่ตั้ง "สูง" เปิดฟาร์มแล้วใช้หน่วยความจำกราฟิกเกินที่เบราว์เซอร์ให้ → หน้าเกมถูกปิดทิ้ง
 */
export function deviceQuality(env = globalThis) {
  const nav = env.navigator;
  if (!nav || !env.matchMedia) return 'high';
  const touchOnly = env.matchMedia('(pointer: coarse)').matches && !env.matchMedia('(any-pointer: fine)').matches;
  const iPadOS = nav.platform === 'MacIntel' && nav.maxTouchPoints > 1; // iPad รายงานตัวเองเป็น Mac
  const mobile = touchOnly || iPadOS || /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent ?? '');
  if (!mobile) return 'high';
  const shortSide = Math.min(env.screen?.width ?? 0, env.screen?.height ?? 0);
  const lowMemory = typeof nav.deviceMemory === 'number' && nav.deviceMemory <= 4;
  return shortSide < 600 || lowMemory ? 'low' : 'medium';
}

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
  const chosen = s.qualityChosen === true && ['high', 'medium', 'low'].includes(s.quality);
  return {
    sound: s.sound !== false,
    ambient: s.ambient !== false,
    // ยังไม่เคยเลือกเอง (รวมเซฟเก่าที่บันทึก 'high' ไว้อัตโนมัติ) = ตามอุปกรณ์
    quality: chosen ? s.quality : deviceQuality(),
    qualityChosen: chosen,
    /** ตัวละครที่บังคับในฟาร์ม ('man' | 'woman') — อีกตัวเดินทำกิจวัตรเอง */
    character: s.character === 'woman' ? 'woman' : 'man',
  };
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(
      KEY,
      JSON.stringify({ sound: !!settings.sound, ambient: !!settings.ambient, quality: settings.quality, qualityChosen: !!settings.qualityChosen, character: settings.character }),
    );
  } catch {
    /* เบราว์เซอร์ไม่ให้เขียน (เช่นโหมดส่วนตัว) — ใช้ค่าในหน่วยความจำต่อ */
  }
}
