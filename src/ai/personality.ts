import { clamp, hashString, seededRandom } from './vec.ts';

/**
 * บุคลิกของปลาแต่ละตัว — คำนวณจาก ID ของปลา (ไม่ต้องบันทึกเพิ่มในเซฟ: ID เดิม = บุคลิกเดิมทุกเครื่องทุกครั้งที่โหลด)
 * ทุกตัวมีทั้ง 5 ด้านในระดับต่างกัน โดยมี "บุคลิกหลัก" 1 ด้านที่เด่นที่สุด
 */
export type Trait = 'curious' | 'shy' | 'social' | 'calm' | 'active';

export const TRAITS: readonly Trait[] = ['curious', 'shy', 'social', 'calm', 'active'];

export const TRAIT_LABEL: Record<Trait, string> = {
  curious: 'ขี้สงสัย ชอบสำรวจ',
  shy: 'ขี้อาย ชอบหลบ',
  social: 'ชอบอยู่กับเพื่อน',
  calm: 'ใจเย็น ว่ายช้า ๆ',
  active: 'กระฉับกระเฉง',
};

export interface Personality {
  primary: Trait;
  curious: number;
  shy: number;
  social: number;
  calm: number;
  active: number;
}

/** ค่าที่บุคลิกส่งผลต่อพฤติกรรม (คูณ/บวกกับค่าของสายพันธุ์) */
export interface BehaviorModifiers {
  /** ตัวคูณความเร็ว */
  speed: number;
  /** ตัวคูณอัตราการเลี้ยว */
  turn: number;
  /** ระยะส่วนตัวจากปลาตัวอื่น (หน่วยเท่าของความยาวตัว) */
  personalSpace: number;
  /** แนวโน้มออกสำรวจ 0..1 */
  explore: number;
  /** แนวโน้มว่ายรวมฝูง 0..1 */
  school: number;
  /** ความไวต่อสิ่งรบกวน (ความเครียดที่ได้รับ ×) */
  sensitivity: number;
  /** ความเครียดที่ทำให้หนีไปหลบ */
  hideStress: number;
  /** ระยะมองเห็นอาหาร (หน่วยฉาก) */
  foodSight: number;
  /** พลังงานที่ต่ำกว่านี้จะไปพัก */
  restBelow: number;
  /** ช่วงเวลาตัดสินใจ (วินาที) — ปลาใจเย็นเปลี่ยนใจช้ากว่า */
  thinkEvery: number;
}

export function personalityOf(id: string): Personality {
  const rnd = seededRandom(hashString(id));
  const primary = TRAITS[Math.floor(rnd() * TRAITS.length)];
  const p = { primary } as Personality;
  for (const t of TRAITS) p[t] = 0.1 + rnd() * 0.45;
  p[primary] = 0.75 + rnd() * 0.25;
  // ด้านที่ขัดกันไม่สูงพร้อมกัน
  if (primary === 'shy') p.active *= 0.6;
  if (primary === 'active') (p.calm *= 0.6), (p.shy *= 0.6);
  if (primary === 'calm') p.active *= 0.6;
  return p;
}

export function modifiersOf(p: Personality): BehaviorModifiers {
  return {
    speed: clamp(0.85 + 0.35 * p.active - 0.25 * p.calm, 0.65, 1.25),
    turn: clamp(0.9 + 0.3 * p.active - 0.2 * p.calm, 0.7, 1.25),
    personalSpace: 0.75 + 0.6 * p.shy - 0.35 * p.social,
    explore: clamp(0.15 + 0.7 * p.curious + 0.25 * p.active - 0.2 * p.shy, 0, 1),
    school: clamp(0.1 + 0.85 * p.social - 0.2 * p.shy, 0, 1),
    sensitivity: 0.5 + 1.2 * p.shy - 0.35 * p.calm,
    hideStress: 70 - 30 * p.shy + 10 * p.calm,
    foodSight: 3.2 + 1.8 * p.curious + 0.8 * p.active,
    restBelow: 22 + 18 * p.calm - 10 * p.active,
    thinkEvery: 0.35 + 0.35 * p.calm,
  };
}
