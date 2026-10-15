import { CONFIG } from '../config.js';

/**
 * ระบบนิเวศใต้น้ำ — บทบาทของหอย (ของตกแต่งที่มีชีวิต) ต่อคุณภาพน้ำ ฟังก์ชันล้วน ไม่มี Three.js
 *   algae  = กินตะไคร่ (ทำงานเต็มที่ตอนน้ำขุ่นซึ่งตะไคร่ขึ้นมาก)
 *   waste  = เก็บกินของเสียที่ปลาปล่อยลงพื้น (มีของเสียเท่า ๆ กันตลอด)
 *   filter = กรองฝุ่นขยะที่ลอยในน้ำ (ยิ่งน้ำขุ่นยิ่งกรองได้มาก)
 * ผลรวมเป็น "สัดส่วนความสกปรกที่ลดลง" ใช้คูณกับอัตราสกปรกของน้ำ (ทำให้สกปรกช้าลง ไม่ได้ทำให้น้ำใสขึ้นเอง
 * → เข้ากับการตรวจเซฟกลางที่ยอมให้ความสะอาดเพิ่มได้เฉพาะคำสั่งทำความสะอาด)
 */

export interface EcologyRoles {
  algae: number;
  waste: number;
  filter: number;
}

export const NO_ECOLOGY: EcologyRoles = Object.freeze({ algae: 0, waste: 0, filter: 0 });

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** รวมบทบาทของของตกแต่งทั้งตู้ (item.ecology ใน data/decor.js) */
export function sumEcology(items: ReadonlyArray<{ ecology?: Partial<EcologyRoles> }>): EcologyRoles {
  const out = { algae: 0, waste: 0, filter: 0 };
  for (const item of items) {
    const e = item.ecology;
    if (!e) continue;
    out.algae += e.algae ?? 0;
    out.waste += e.waste ?? 0;
    out.filter += e.filter ?? 0;
  }
  return out;
}

/** สัดส่วนความสกปรกที่หอยช่วยลด 0..CONFIG.ecology.maxReduction ตามความสะอาดตอนนี้ */
export function ecologyReduction(e: EcologyRoles, cleanliness: number): number {
  const dirt = 1 - clamp01(cleanliness / 100);
  const r = e.algae * (0.6 + 0.8 * dirt) + e.waste + e.filter * (0.7 + 1.0 * dirt);
  return Math.min(CONFIG.ecology.maxReduction, Math.max(0, r));
}

/** สัดส่วนตะไคร่บนกระจกที่หายไปเพราะหอยกินตะไคร่ 0..0.7 (ภาพเท่านั้น) */
export function algaeControl(e: EcologyRoles): number {
  return Math.min(0.7, Math.max(0, e.algae * CONFIG.ecology.algaeVisual));
}
