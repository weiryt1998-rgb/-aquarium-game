import type { Vec3Like } from './vec.ts';

/**
 * ชนิดข้อมูลของ Fish AI — โลกที่ปลามองเห็น (ตู้ ของตกแต่ง อาหาร) ส่งมาจากฝั่งเกมเป็นข้อมูลล้วน ไม่มี Three.js
 */

/** สถานะพฤติกรรม (Finite State Machine) */
export type FishState = 'idle' | 'explore' | 'seekFood' | 'eat' | 'rest' | 'school' | 'avoid' | 'hide' | 'court';

export const STATE_LABEL: Record<FishState, string> = {
  idle: 'ว่ายเล่นสบาย ๆ',
  explore: 'กำลังสำรวจตู้',
  seekFood: 'กำลังไปหาอาหาร',
  eat: 'กำลังกินอาหาร',
  rest: 'กำลังพักผ่อน',
  school: 'ว่ายรวมฝูง',
  avoid: 'หลบสิ่งกีดขวาง',
  hide: 'หลบซ่อนตัว',
  court: 'กำลังเกี้ยวพาราสี',
};

export type Zone = 'top' | 'middle' | 'bottom' | 'any';

/** ของตกแต่งที่ว่ายทะลุไม่ได้ (ทรงกระบอกจากพื้นถึง top) */
export interface Obstacle {
  x: number;
  z: number;
  r: number;
  top: number;
}

/** ที่หลบซ่อน (พืชน้ำ = ว่ายเข้าไปในพุ่มได้, ของตกแต่งอื่น = หลบข้าง ๆ) */
export interface Cover {
  x: number;
  z: number;
  r: number;
  top: number;
  plant: boolean;
}

/** เม็ดอาหาร (โครงสร้างเดียวกับ pellet ใน systems/FoodSystem.js) */
export interface FoodItem {
  position: Vec3Like;
  settled?: boolean;
  /** ถูกกินหรือเน่าไปแล้ว (FoodSystem ตั้งให้) */
  gone?: boolean;
}

/** โลกที่ AI รับรู้ — ฝั่งเกมอัปเดตค่าเหล่านี้ (ของตกแต่งย้าย อาหารใหม่) AI แค่อ่าน */
export interface AIWorld {
  /** กว้าง (x) ลึก (z) ของตู้ จุดกึ่งกลางที่ 0 */
  w: number;
  d: number;
  waterTop: number;
  floorAt(x: number, z: number): number;
  obstacles: readonly Obstacle[];
  covers: readonly Cover[];
  food: readonly FoodItem[];
  /** ปลากินอาหาร (ระบบอาหารเดิมเป็นคนลบเม็ดอาหารและเพิ่มความอิ่ม) */
  consume(item: FoodItem, fishId: string): void;
}

/** การว่ายตามสายพันธุ์ (มาจาก species.behavior ใน src/data/fish.js) */
export interface SpeciesMotion {
  speed: number;
  agility: number;
  zone: Zone;
  schooling: boolean;
  /** ปลาชนิดเดียวกัน/กลุ่มพันธุ์เดียวกันรวมฝูงกันได้ */
  group: string;
}

/** ค่าจากระบบนิเวศ (src/sim/) ที่มีผลต่อพฤติกรรม — ฝั่งเกมอัปเดตทุกเฟรม */
export interface FishNeeds {
  /** 0 อิ่ม → 100 หิวมาก (= 100 - ความอิ่ม) */
  hunger: number;
  health: number;
  /** 0 ลูกปลา → 1 โตเต็มวัย */
  growth: number;
  /** อายุ (วินาทีเกม) */
  age: number;
  /** ความยาวตัวในฉาก (หน่วยเดียวกับตู้) */
  length: number;
  pregnant: boolean;
  /** ความสะอาดน้ำ 0..100 */
  cleanliness: number;
}
