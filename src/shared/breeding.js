import { CONFIG } from '../config.js';
import { FISH_SPECIES, getSpecies } from '../data/fish.js';
import { crossGenes, sanitizeGenes, variantGenes } from '../models/molly/genetics.js';
import { isNum } from './economy.js';

/**
 * การตั้งท้องของปลาตัวเมีย (ออกลูกเป็นตัวแบบปลาสอด ใช้กับทุกสายพันธุ์) — ใช้ร่วมกันทั้งในเกมและฝั่งตรวจคำสั่ง
 * fish.pregnantAt  = เวลาจริง (ms) ที่ผสมพันธุ์ ไม่มีฟิลด์นี้ = ไม่ได้ตั้งท้อง
 * fish.lastBirthAt = เวลาจริง (ms) ที่คลอดลูกครั้งล่าสุด — ตัวเมียพักฟื้น CONFIG.breeding.rest ก่อนผสมพันธุ์ใหม่
 */

/** ระยะตั้งท้องเป็นมิลลิวินาทีจริง (เร่งตาม CONFIG.timeScale) */
export const gestationMs = () => (CONFIG.breeding.gestation * 1000) / CONFIG.timeScale;

/** ระยะพักฟื้นหลังคลอดเป็นมิลลิวินาทีจริง (เร่งตาม CONFIG.timeScale) */
export const restMs = () => (CONFIG.breeding.rest * 1000) / CONFIG.timeScale;

export const isPregnant = (fish) => fish?.gender === 'f' && isNum(fish.pregnantAt) && fish.pregnantAt > 0;

/** เวลาที่ครบกำหนดคลอด (ms) */
export const dueAt = (fish) => fish.pregnantAt + gestationMs();

/** ความคืบหน้าการตั้งท้อง 0..1 */
export const pregnancyProgress = (fish, now = Date.now()) => (isPregnant(fish) ? Math.min(1, Math.max(0, (now - fish.pregnantAt) / gestationMs())) : 0);

/** เวลาที่ตัวเมียพักฟื้นหลังคลอดเสร็จ (ms) — 0 = ไม่ได้พักฟื้น */
export const restEndsAt = (fish) => (fish?.gender === 'f' && isNum(fish.lastBirthAt) && fish.lastBirthAt > 0 ? fish.lastBirthAt + restMs() : 0);

export const isResting = (fish, now = Date.now()) => now < restEndsAt(fish);

// ── การผสมข้ามสี ───────────────────────────────────────────────

/** กลุ่มที่ผสมพันธุ์ด้วยกันได้ (ปลาสอดทุกสี = 'molly', ชนิดอื่นผสมได้เฉพาะชนิดเดียวกัน) */
export const breedGroupOf = (species) => species?.breedGroup ?? species?.id;

/** สายพันธุ์ลูกผสมของกลุ่ม (ถ้ามี) */
export const hybridSpeciesOf = (group) => FISH_SPECIES.find((s) => s.hybrid && s.breedGroup === group) ?? null;

/** ยีนสีที่ใช้จริงของปลาตัวหนึ่ง (พันธุ์แท้ = ยีนของสีนั้น) — null ถ้าสายพันธุ์นี้ไม่มีระบบสี */
export function effectiveGenes(fish, species) {
  if (species?.procedural?.type !== 'molly') return null;
  return sanitizeGenes(fish.genes) ?? variantGenes(species.procedural.variant);
}

/**
 * ลูกในท้อง (กำหนดตอนผสมพันธุ์ เก็บไว้ที่ตัวแม่ใน fish.fetus)
 * - พ่อแม่สายพันธุ์เดียวกัน และเป็นพันธุ์แท้ทั้งคู่ → ลูกพันธุ์แท้สีเดียวกัน
 * - ต่างสี หรือมีพ่อ/แม่เป็นลูกผสม → ลูกผสม ได้ยีนสีใหม่จากพ่อแม่ (มีโอกาสกลายพันธุ์)
 * @returns {{ speciesId: string, genes?: object }}
 */
export function planOffspring(mom, dad, rnd = Math.random) {
  const ms = getSpecies(mom.speciesId);
  const ds = getSpecies(dad.speciesId);
  const pure = !mom.genes && !dad.genes && mom.speciesId === dad.speciesId;
  const hybrid = hybridSpeciesOf(breedGroupOf(ms));
  if (pure || !hybrid) return { speciesId: mom.speciesId };
  return { speciesId: hybrid.id, genes: crossGenes(effectiveGenes(mom, ms), effectiveGenes(dad, ds), rnd) };
}

/** ตรวจลูกในท้องที่รับมาจากภายนอก (คำสั่ง/เซฟ) — คืน null ถ้าใช้ไม่ได้ */
export function sanitizeFetus(raw, mom, dad = null) {
  const ms = getSpecies(mom?.speciesId);
  const fs = getSpecies(raw?.speciesId);
  if (!ms || !fs || breedGroupOf(fs) !== breedGroupOf(ms)) return null;
  // ลูกต้องเป็นสายพันธุ์ของแม่ ของพ่อ หรือลูกผสมของกลุ่ม
  if (fs.id !== ms.id && fs.id !== dad?.speciesId && !fs.hybrid && dad) return null;
  const out = { speciesId: fs.id };
  if (fs.procedural?.type === 'molly') {
    const genes = sanitizeGenes(raw.genes);
    if (genes) out.genes = genes;
    else if (fs.hybrid) out.genes = effectiveGenes(mom, ms); // ลูกผสมต้องมียีนเสมอ
  }
  return out;
}
