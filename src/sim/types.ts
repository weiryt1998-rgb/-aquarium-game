import type { EcologyRoles } from './ecology.ts';

/**
 * ชนิดข้อมูลของ Simulation Engine (ระบบนิเวศในตู้) — ไม่มีอะไรเกี่ยวกับ Three.js/DOM
 * record ของปลาและตู้เป็นข้อมูลเดียวกับที่บันทึกลงเซฟกลาง (shared/sanitize.js)
 */

export type Gender = 'm' | 'f';

export interface Fetus {
  speciesId: string;
  genes?: unknown;
}

/** ปลา 1 ตัวในเซฟ */
export interface FishRecord {
  id: string;
  speciesId: string;
  name: string;
  gender: Gender;
  satiety: number;
  health: number;
  growth: number;
  age: number;
  breedCooldown: number;
  coinTimer: number;
  genes?: unknown;
  pregnantAt?: number;
  fetus?: Fetus;
  /** เวลาจริง (ms) ที่คลอดลูกครั้งล่าสุด (ตัวเมียพักฟื้นหลังคลอด) */
  lastBirthAt?: number;
}

/** ตู้ 1 ใบในเซฟ */
export interface TankRecord {
  id: string;
  typeId: string;
  name: string;
  cleanliness: number;
  fish: FishRecord[];
  decor: unknown[];
  lastUpdate: number;
}

/** ข้อมูลสายพันธุ์ส่วนที่ระบบนิเวศใช้ (มาจาก src/data/fish.js) */
export interface SpeciesLike {
  id: string;
  breedGroup?: string;
  care: { hungerRate: number; growTime: number; breedChance: number };
  economy: { coinValue: number; coinInterval: number };
}

/** ผลของอาหาร 1 เม็ด (src/data/food.js) */
export interface FoodEffect {
  nutrition: number;
  health: number;
  happiness: number;
  growth?: number;
}

/** สภาพแวดล้อมของตู้ที่มาจากฝั่งเกม (ของตกแต่ง ขนาดตู้) */
export interface Environment {
  /** 0..1 ความสุขจากของตกแต่ง */
  decorHappiness: number;
  /** 0..0.5 ของตกแต่งที่ช่วยกรองน้ำ */
  cleanBonus: number;
  /** จำนวนปลาสูงสุดของตู้ */
  capacity: number;
  /** บทบาทของหอยในตู้ (กินตะไคร่ กินของเสีย กรองน้ำ — ดู sim/ecology.ts) ไม่ระบุ = ไม่มีหอย */
  ecology?: EcologyRoles;
}

/** ค่าที่ไม่ต้องบันทึก (คำนวณใหม่ได้) ของปลาแต่ละตัว */
export interface FishMood {
  happiness: number;
  /** ความสุขพิเศษจากอาหาร ค่อย ๆ จางลง */
  moodBoost: number;
  /** ตัวคูณการโตจากอาหารบางชนิด และเวลาที่เหลือ */
  growthBoost: number;
  growthBoostTime: number;
}

/**
 * อาการของปลา (เรียงจากดีไปแย่) — ใช้แจ้งเตือนผู้เล่นทีละขั้น พร้อมเวลาให้แก้ไข
 *  healthy  ปกติ
 *  hungry   หิว (ยังไม่เสียสุขภาพ)
 *  starving อดอาหารนาน สุขภาพเริ่มลด
 *  sick     ป่วย สุขภาพต่ำกว่าครึ่ง
 *  critical อาการหนัก ใกล้ตาย (ร่างกายพยายามเอาตัวรอด สุขภาพลดช้าลง ให้เวลาผู้เล่นแก้ไข)
 */
export type FishCondition = 'healthy' | 'hungry' | 'starving' | 'sick' | 'critical';

export const CONDITION_ORDER: readonly FishCondition[] = ['healthy', 'hungry', 'starving', 'sick', 'critical'];

export type DeathCause = 'starving' | 'water' | 'illness';

/** เหตุการณ์ที่ engine ส่งให้ฝั่งแสดงผล (เสียง เอฟเฟกต์ แจ้งเตือน คำสั่งเซฟกลาง) */
export type SimEvent =
  | { type: 'coin'; fishId: string; value: number }
  | { type: 'grew'; fishId: string }
  | { type: 'died'; fish: FishRecord; cause: DeathCause }
  | { type: 'condition'; fishId: string; condition: FishCondition; previous: FishCondition; secondsLeft: number | null }
  | { type: 'water'; stage: number; previous: number }
  | { type: 'courtStart'; momId: string; dadId: string }
  | { type: 'courtEnd'; momId: string; dadId: string }
  | { type: 'mated'; momId: string; dadId: string; fetus: Fetus }
  | { type: 'born'; momId: string; baby: FishRecord }
  /** ครบกำหนดคลอดแต่ตู้เต็มตามความจุ */
  | { type: 'birthBlocked'; momId: string };

/** ค่าเฉลี่ยระดับตู้ (แสดงบน HUD) */
export interface TankStats {
  cleanliness: number;
  avgHappiness: number;
  avgHealth: number;
  avgSatiety: number;
  crowdPenalty: number;
  /** สัดส่วนความสกปรกที่หอยช่วยลดตอนนี้ (0..CONFIG.ecology.maxReduction) */
  ecology: number;
}
