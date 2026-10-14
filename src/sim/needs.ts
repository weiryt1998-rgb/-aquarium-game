import { CONFIG } from '../config.js';
import { dirtyHealthDamage } from './water.ts';
import type { FishCondition, FishMood, FishRecord, FoodEffect, SpeciesLike } from './types.ts';

/**
 * ความต้องการของปลา 1 ตัว (ความอิ่ม สุขภาพ การโต ความสุข เหรียญ) — ฟังก์ชันล้วน คำนวณทีละจังหวะเวลา
 */

const clamp = (v: number, min: number, max: number) => (v < min ? min : v > max ? max : v);
const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export const newMood = (): FishMood => ({ happiness: 65, moodBoost: 0, growthBoost: 1, growthBoostTime: 0 });

/** ขนาดตัวเทียบกับตัวเต็มวัย (ลูกปลาตัวเล็กกว่า) — ใช้คิดของเสียในน้ำ */
export const sizeFactor = (fish: FishRecord): number => 0.45 + 0.55 * fish.growth;

/** สุขภาพที่ลดต่อวินาทีตอนนี้ (อดอาหาร + น้ำสกปรก) ก่อนคิดการชะลอตอนอาการหนัก */
export function healthDrain(fish: FishRecord, cleanliness: number): { starving: number; water: number } {
  const C = CONFIG.care;
  const starving = fish.satiety < C.starvingBelow ? C.starvingDamage * (1 - fish.satiety / C.starvingBelow) : 0;
  return { starving, water: dirtyHealthDamage(cleanliness) };
}

/** การเปลี่ยนแปลงสุขภาพต่อวินาที (ลบ = แย่ลง) */
export function healthRate(fish: FishRecord, cleanliness: number): number {
  const C = CONFIG.care;
  const { starving, water } = healthDrain(fish, cleanliness);
  let rate = -(starving + water);
  if (fish.health < C.criticalBelow) rate *= C.criticalSlowdown;
  if (fish.satiety > 40 && cleanliness > C.regenAbove) rate += C.regen;
  return rate;
}

/** อาการปัจจุบัน */
export function conditionOf(fish: FishRecord): FishCondition {
  const C = CONFIG.care;
  if (fish.health < C.criticalBelow) return 'critical';
  if (fish.health < C.sickBelow) return 'sick';
  if (fish.satiety < C.starvingBelow) return 'starving';
  if (fish.satiety < C.hungryBelow) return 'hungry';
  return 'healthy';
}

/**
 * เวลาโดยประมาณ (วินาทีเกม) ก่อนสุขภาพหมด ถ้าสภาพตอนนี้ไม่ดีขึ้น — null ถ้าสุขภาพไม่ได้ลดลง
 * คิดการชะลอตอนอาการหนักด้วย (สุขภาพช่วงต่ำกว่า criticalBelow ลดช้าลง)
 */
export function secondsUntilDeath(fish: FishRecord, cleanliness: number): number | null {
  const C = CONFIG.care;
  const { starving, water } = healthDrain(fish, cleanliness);
  const drain = starving + water;
  if (drain <= 0) return null;
  const above = Math.max(0, fish.health - C.criticalBelow);
  const below = Math.min(fish.health, C.criticalBelow);
  return above / drain + below / (drain * C.criticalSlowdown);
}

export interface StepContext {
  cleanliness: number;
  decorHappiness: number;
  crowdPenalty: number;
}

export interface StepResult {
  /** มูลค่าเหรียญที่ปลาผลิตในจังหวะนี้ (0 = ไม่มี) */
  coin: number;
  /** เพิ่งโตเต็มวัยในจังหวะนี้ */
  grew: boolean;
}

/** เดินเวลาปลา 1 ตัวไป dt วินาทีเกม */
export function stepFish(fish: FishRecord, species: SpeciesLike, mood: FishMood, ctx: StepContext, dt: number, random: () => number): StepResult {
  const care = species.care;
  fish.age += dt;
  fish.satiety = Math.max(0, fish.satiety - care.hungerRate * dt);
  fish.health = clamp(fish.health + healthRate(fish, ctx.cleanliness) * dt, 0, 100);

  mood.growthBoostTime -= dt;
  if (mood.growthBoostTime <= 0) mood.growthBoost = 1;
  let grew = false;
  if (fish.growth < 1 && fish.satiety > 30 && fish.health > 40) {
    fish.growth = Math.min(1, fish.growth + (dt / care.growTime) * mood.growthBoost);
    grew = fish.growth >= 1;
  }
  fish.breedCooldown = Math.max(0, fish.breedCooldown - dt);

  mood.moodBoost = Math.max(0, mood.moodBoost - dt * 0.2);
  const fed = smoothstep(10, 70, fish.satiety);
  const target = 100 * (0.35 * fed + (0.25 * ctx.cleanliness) / 100 + (0.2 * fish.health) / 100 + 0.2 * ctx.decorHappiness) - ctx.crowdPenalty + mood.moodBoost;
  mood.happiness += (clamp(target, 0, 100) - mood.happiness) * (1 - Math.exp(-0.6 * dt));

  // ปลาที่มีความสุขจะผลิตเหรียญ (สุขมากกว่า 80% ได้เหรียญเพิ่ม 50%)
  let coin = 0;
  if (mood.happiness >= 40) {
    fish.coinTimer -= dt;
    if (fish.coinTimer <= 0) {
      const eco = species.economy;
      fish.coinTimer = eco.coinInterval * (0.85 + random() * 0.35);
      coin = Math.max(1, Math.round(eco.coinValue * (mood.happiness > 80 ? 1.5 : 1) * (fish.growth >= 1 ? 1 : 0.5)));
    }
  }
  return { coin, grew };
}

/** ปลากินอาหาร 1 เม็ด */
export function eat(fish: FishRecord, mood: FishMood, food: FoodEffect): void {
  fish.satiety = Math.min(100, fish.satiety + food.nutrition);
  fish.health = Math.min(100, fish.health + food.health);
  mood.moodBoost = Math.min(30, mood.moodBoost + food.happiness);
  if ((food.growth ?? 1) > mood.growthBoost) mood.growthBoost = food.growth ?? 1;
  mood.growthBoostTime = 60;
}
