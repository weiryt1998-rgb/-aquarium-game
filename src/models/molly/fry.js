/**
 * สีลูกปลาสอดแรกเกิด (fry) — เหมือนธรรมชาติ: ลูกปลาเกิดมาตัวสีเทาเข้มอมเขียวมะกอก ท้องเทาเงินจาง ๆ ครีบใส
 * ยังไม่เห็นสีและลายจริง → ผู้เล่นต้องลุ้นว่าจะได้สีอะไร
 *
 *   growth < hideUntil            ลูกปลาสีเข้มทั้งตัว (ทุกสี/ทุกยีนหน้าตาเหมือนกัน)
 *   hideUntil..revealAt           สีจริงค่อย ๆ ซึมออกมา
 *   growth >= revealAt            เห็นสีจริงเต็มที่ (= ตอนเปลี่ยนจากโมเดลลูกปลาเป็นตัวเต็มวัย procedural.babyUntil)
 * ปลาที่ซื้อจากร้านเริ่มที่ growth 0.6 จึงเห็นสีจริงตั้งแต่แรก
 */

export const FRY_COLORS = {
  back: '#2e322a', // หลังเข้มเกือบดำ
  base: '#4d5247', // ข้างตัวเทาอมเขียวมะกอก
  belly: '#8d918a', // ท้องเทาเงินจาง ๆ
  fin: '#9aa095', // ครีบเกือบใส
};
export const FRY_FIN_OPACITY = 0.18;

const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const fryWindow = (species) => {
  const revealAt = species?.procedural?.babyUntil ?? 0.6;
  return [revealAt * (2 / 3), revealAt];
};

/** สายพันธุ์นี้มีช่วงลูกปลาสีเข้มไหม (ปลาสอดทุกสีและลูกผสม) */
export const hasFryLook = (species) => species?.procedural?.type === 'molly';

/** สัดส่วนสีลูกปลาที่ทับสีจริง 1 = สีลูกปลาทั้งตัว → 0 = สีจริง */
export function fryAmount(species, growth = 1) {
  if (!hasFryLook(species)) return 0;
  const [hideUntil, revealAt] = fryWindow(species);
  return 1 - smoothstep(hideUntil, revealAt, growth);
}

/** ยังไม่เผยสีจริงครบ → ซ่อนชื่อสายพันธุ์/ยีนใน UI ไว้ก่อน */
export const isColorHidden = (species, growth = 1) => hasFryLook(species) && growth < fryWindow(species)[1];

/** ระยะที่สีเริ่มซึมออกมา (UI บอกผู้เล่นว่า "เริ่มเห็นสีแล้ว") */
export const isRevealing = (species, growth = 1) => hasFryLook(species) && growth >= fryWindow(species)[0] && growth < fryWindow(species)[1];
