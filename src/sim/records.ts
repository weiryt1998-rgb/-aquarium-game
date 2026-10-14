import { FISH_NAMES, getSpecies } from '../data/fish.js';
import { pick, rand, uid } from '../utils/math.js';
import type { FishRecord, Gender } from './types.ts';

export interface NewFishOptions {
  growth?: number;
  satiety?: number;
  name?: string;
  /** ไม่ระบุ = สุ่ม */
  gender?: Gender;
  /** ยีนสีของลูกผสม */
  genes?: unknown;
}

/** สร้าง record ปลาตัวใหม่ (ซื้อ / คลอด / ตู้เริ่มต้น) */
export function createFishRecord(speciesId: string, { growth = 1, satiety = 75, name, gender, genes }: NewFishOptions = {}): FishRecord {
  const species = getSpecies(speciesId);
  const record: FishRecord = {
    id: uid('fish'),
    speciesId,
    name: name ?? pick(FISH_NAMES),
    gender: gender === 'm' || gender === 'f' ? gender : Math.random() < 0.5 ? 'm' : 'f',
    satiety,
    health: 100,
    growth,
    age: 0,
    breedCooldown: rand(30, 90),
    coinTimer: rand(5, species?.economy.coinInterval ?? 30),
  };
  if (genes) record.genes = genes;
  return record;
}
