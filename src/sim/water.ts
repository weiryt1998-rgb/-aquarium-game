import { CONFIG } from '../config.js';

/**
 * คุณภาพน้ำ — ระดับความสกปรก (เรียงจากสะอาดไปสกปรก)
 * ภาพในตู้ (สีน้ำ ตะไคร่) เปลี่ยนต่อเนื่องตามความสะอาด ส่วนขั้นเหล่านี้ใช้แจ้งเตือนผู้เล่นและบอกผลต่อปลา
 */
export interface WaterStage {
  min: number;
  name: string;
  emoji: string;
  warn?: string;
}

export const WATER_STAGES: readonly WaterStage[] = [
  { min: 70, name: 'น้ำใส', emoji: '💧' },
  { min: 45, name: 'น้ำเริ่มขุ่น', emoji: '🌿', warn: '🌿 น้ำเริ่มขุ่น มีตะไคร่เกาะกระจกแล้ว — ปลาเริ่มไม่ค่อยมีความสุข ทำความสะอาดตู้ได้ตามสะดวก' },
  { min: 25, name: 'น้ำขุ่นเขียว', emoji: '🟢', warn: '⚠️ น้ำขุ่นเขียว ปลาเริ่มป่วยช้า ๆ และไม่ฟื้นตัว — กด 🧽 ทำความสะอาดตู้' },
  { min: 0, name: 'น้ำเน่า', emoji: '🤢', warn: '🚨 น้ำเน่ามาก! สุขภาพปลาลดลงเรื่อย ๆ ควรทำความสะอาดตู้โดยเร็ว' },
];

export const waterStageIndex = (cleanliness: number): number => WATER_STAGES.findIndex((s) => cleanliness >= s.min);

/** สุขภาพที่ลดต่อวินาทีจากน้ำสกปรก: 0 เมื่อสะอาดกว่า dirtyFrom แล้วแรงขึ้นแบบโค้ง (น้ำเน่าหนักอันตรายกว่าขุ่นนิดหน่อยมาก) */
export function dirtyHealthDamage(cleanliness: number): number {
  const C = CONFIG.care;
  if (cleanliness >= C.dirtyFrom) return 0;
  return C.dirtyDamage * 1.3 * ((C.dirtyFrom - cleanliness) / C.dirtyFrom) ** 1.6;
}

/**
 * ความสะอาดที่ลดลงต่อวินาที
 * @param biomass ความยาวปลารวมในตู้ (ปลาตัวใหญ่ขับของเสียมากกว่า)
 * @param cleanBonus 0..0.5 ของตกแต่งที่ช่วยกรองน้ำ (พืชน้ำ หัวทราย)
 */
export function dirtRate(biomass: number, cleanBonus: number): number {
  return (CONFIG.care.dirtBase + CONFIG.care.dirtPerFish * biomass) * (1 - cleanBonus);
}
