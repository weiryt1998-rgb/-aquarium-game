import { CONFIG } from '../config.js';
import { getSpecies } from '../data/fish.js';
import type { SpeciesLike, TankRecord } from './types.ts';

/**
 * จำลองเวลาที่ผ่านไปตอนผู้เล่นไม่อยู่ (ปิดเกม/อยู่ตู้อื่น) แบบคำนวณรวดเดียว
 * ปลาจะหิวและน้ำจะสกปรกลง แต่ไม่ต่ำกว่าค่าขั้นต่ำ และสุขภาพไม่ลด — ปลาไม่ตายตอนผู้เล่นไม่อยู่
 * (เหรียญออฟไลน์คิดแยกใน shared/economy.js เพราะเซิร์ฟเวอร์ต้องตรวจด้วยสูตรเดียวกัน)
 */
export function catchUpTank(tank: TankRecord, seconds: number): void {
  if (seconds <= 0) return;
  const off = CONFIG.offline;
  for (const fish of tank.fish) {
    const species = getSpecies(fish.speciesId) as SpeciesLike | undefined;
    if (!species) continue;
    const rate = species.care.hungerRate;
    const before = fish.satiety;
    // ช่วงเวลาที่ยังอิ่มพอจะโตได้
    const growSeconds = Math.min(Math.max((before - 30) / rate, 0), seconds);
    fish.growth = Math.min(1, fish.growth + growSeconds / species.care.growTime);
    fish.satiety = Math.max(before - rate * seconds, Math.min(before, off.minSatiety));
    fish.breedCooldown = Math.max(0, (fish.breedCooldown ?? 0) - seconds);
    fish.age = (fish.age ?? 0) + seconds;
  }
  const dirt = (CONFIG.care.dirtBase + CONFIG.care.dirtPerFish * tank.fish.length) * seconds;
  tank.cleanliness = Math.max(tank.cleanliness - dirt, Math.min(tank.cleanliness, off.minCleanliness));
}
