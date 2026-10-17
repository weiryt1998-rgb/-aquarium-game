/**
 * ชุดสีของปลา Balloon Molly
 * ทุกสีใช้รูปทรงและแอนิเมชันเดียวกัน ต่างกันแค่ texture และค่าวัสดุ
 *
 * body.base/back/belly : สีพื้นลำตัว สีหลัง สีท้อง (ไล่สีแบบ countershading)
 * scales               : ความเข้มของขอบเกล็ดบน texture สี (contrast) และความนูนบน normal map (relief)
 * spots                : ลายจุด/ด่าง — object ชั้นเดียว หรือ array หลายชั้น (วาดทับตามลำดับ) ไม่มี = ไม่มีจุด
 *                        { color, count, minSize, maxSize, sizePow, back, clusters, blur, matte, finCount, finSize, patches }
 *                        patches = ใช้ลายด่างสีส้มที่วาดมากับเท็กซ์เจอร์ของ molly.glb แทนการสุ่มจุด (ดู mollyMesh.js)
 *                        bars    = ชั้นลายบั้งแทนการสุ่มจุด: count = จำนวนบั้ง, finCount = จำนวนริ้วตามก้านครีบหลัง/ครีบหาง
 *                                  { from, to, width, low: [ขอบล่างช่วงหน้า, ช่วงท้าย], marble, slant }
 *                                  t = 0 ปลายจมูก → 1 โคนหาง, low = ค่า up (+1 สันหลัง, -1 ท้อง) ที่บั้งสิ้นสุด
 *                                  marble = ลายหินอ่อนบนหัว/สันหลัง และรูพรุนในบั้ง 0..1
 *                        glow    = สีพื้นระหว่างบั้ง (เหนือขอบล่างของบั้ง ท้องยังเป็นสีตัว) ใช้คู่กับ bars
 *                                  { front: สีช่วงหน้า, color: สีช่วงท้าย, from: t ที่เปลี่ยนสี, amount: ความเข้ม 0..1 }
 * head                 : สีบริเวณหัว { color, start, end, back } (t = 0 ปลายจมูก → 1 โคนหาง)
 * fins                 : สีครีบ ก้านครีบ ปลายครีบ และความทึบ
 * material             : ค่า PBR — clearcoat = ความมันวาวเหมือนเคลือบน้ำ, iridescence = ประกายมุก
 */
export const MOLLY_VARIANTS = {
  dalmatian: {
    id: 'dalmatian',
    name: 'ดัลเมเชียน',
    nameEn: 'Dalmatian Molly',
    // พื้นขาวอมชมพูอ่อน จุดดำละเอียดทั่วตัว หัวลายหินอ่อนดำ บั้งดำแนวตั้ง ระหว่างบั้งอมทองจาง ๆ ช่วงหน้า อมฟ้าจาง ๆ ช่วงท้าย
    // ครีบสีครีม ครีบหลังและครีบหางมีริ้วดำตามก้านครีบ
    body: { base: '#f8f0eb', back: '#f5ebd6', belly: '#fbf5f1', gill: '#f0d4c8' },
    scales: { contrast: 0.12, relief: 0.75, rim: '#fff4ea' },
    spots: [
      { color: '#0a0a0c', count: 750, minSize: 0.0025, maxSize: 0.009, sizePow: 1.6, back: 0.1, finCount: 30, finSize: 0.022 },
      {
        color: '#0b0c0e',
        count: 8,
        bars: { from: 0.1, to: 0.98, width: 0.5, low: [-0.25, -0.85], marble: 1, slant: 0.12 },
        glow: { front: '#f0d6a4', color: '#c4e8e3', from: 0.55, amount: 0.35 },
        finCount: 7,
        matte: 0.6,
      },
    ],
    fins: { base: '#f1d6a6', tip: '#fbf4e8', ray: '#cfa86a', opacity: 0.8 },
    lip: '#3b3330',
    iris: '#e0c189',
    material: { roughness: 0.34, metalness: 0.05, clearcoat: 0.75, iridescence: 0.55, sheenGlow: 0.05 },
  },
  black: {
    id: 'black',
    name: 'ดำ',
    nameEn: 'Black Molly',
    body: { base: '#16171b', back: '#0a0b0d', belly: '#202227', gill: '#1d1d22' },
    scales: { contrast: 0.35, relief: 1.1, rim: '#3a4458' },
    spots: null,
    fins: { base: '#111215', tip: '#1d1f24', ray: '#050506', opacity: 0.86 },
    lip: '#1c1b1f',
    iris: '#8d939c',
    material: { roughness: 0.3, metalness: 0.08, clearcoat: 0.85, iridescence: 0.35, sheenGlow: 0.0 },
  },
  white: {
    id: 'white',
    name: 'ขาว',
    nameEn: 'White Molly',
    body: { base: '#f6f4ef', back: '#eceae6', belly: '#fdfbf7', gill: '#f3dcd6' },
    scales: { contrast: 0.12, relief: 0.9, rim: '#ffffff' },
    spots: null,
    fins: { base: '#f4f2ee', tip: '#ffffff', ray: '#d4d1cb', opacity: 0.55 },
    lip: '#efdcd5',
    iris: '#c3c8cf',
    material: { roughness: 0.32, metalness: 0.04, clearcoat: 0.75, iridescence: 0.6, sheenGlow: 0.07 },
  },
  golden: {
    id: 'golden',
    name: 'ทอง',
    nameEn: 'Golden Molly',
    // เหลืองทองทั้งตัว หลังอมส้มเล็กน้อย ปลายครีบอ่อนลง
    body: { base: '#ffd22c', back: '#f8b41a', belly: '#ffec9c', gill: '#ffc040' },
    scales: { contrast: 0.2, relief: 1.0, rim: '#fff1b0' },
    spots: null,
    fins: { base: '#ffcb2e', tip: '#f4f0a0', ray: '#eda812', opacity: 0.76 },
    lip: '#ffc35a',
    iris: '#e9c27a',
    material: { roughness: 0.3, metalness: 0.14, clearcoat: 0.7, iridescence: 0.3, sheenGlow: 0.09 },
  },
  redhead: {
    id: 'redhead',
    name: 'หัวแดง',
    nameEn: 'Red Head Molly',
    // ลำตัวขาวมุก หัวแดงส้มลามไปตามสันหลังเล็กน้อย ครีบขาวใสมีจุดดำประปราย
    body: { base: '#f5f2ec', back: '#ebe7e1', belly: '#fcfaf6', gill: '#f3d8cf' },
    head: { color: '#f0541c', start: 0.16, end: 0.33, back: 0.14 },
    scales: { contrast: 0.12, relief: 0.8, rim: '#ffffff' },
    // ชั้นแรกคงไว้ตามเดิม (ลูกผสมในเซฟอ้างอิง 'redhead:0') — ลายเพิ่มต่อท้าย: จุดแดงส้มนุ่ม ๆ ตามหลัง + จุดดำละเอียดประปราย
    spots: [
      { color: '#0b0c10', count: 0, finCount: 14, finSize: 0.04 },
      { color: '#f06a30', count: 80, minSize: 0.012, maxSize: 0.032, sizePow: 1.4, back: 0.65, blur: 1.4, matte: 0.3, finCount: 8, finSize: 0.04 },
      { color: '#0b0c10', count: 160, minSize: 0.003, maxSize: 0.009, sizePow: 1.8, back: 0.5, clusters: false },
    ],
    fins: { base: '#f3f1ec', tip: '#ffffff', ray: '#d6d2cb', opacity: 0.66 },
    lip: '#f2793f',
    iris: '#c9ced6',
    material: { roughness: 0.32, metalness: 0.04, clearcoat: 0.75, iridescence: 0.55, sheenGlow: 0.07 },
  },
  calico: {
    id: 'calico',
    name: 'คาลิโก้',
    nameEn: 'Calico Molly',
    // ลายสามสี: พื้นขาวมุก ด่างส้มก้อนใหญ่ แล้วจุดดำกระจายทับ หางไล่เป็นสีฟ้าอมเทา
    body: { base: '#f4f1ea', back: '#e6e3dc', belly: '#fbf9f4', gill: '#f2d8cf' },
    scales: { contrast: 0.14, relief: 0.85, rim: '#ffffff' },
    spots: [
      { color: '#f2882a', count: 54, minSize: 0.03, maxSize: 0.09, sizePow: 1.2, back: 0.25, blur: 1.2, matte: 0.35, finCount: 10, finSize: 0.07, patches: true },
      { color: '#0c0c10', count: 120, minSize: 0.006, maxSize: 0.04, back: 0.3, finCount: 40, finSize: 0.045 },
    ],
    fins: { base: '#e8ecef', tip: '#6e9fd2', ray: '#bfc7cf', opacity: 0.72 },
    lip: '#ecd6cc',
    iris: '#c9ced6',
    material: { roughness: 0.33, metalness: 0.05, clearcoat: 0.75, iridescence: 0.45, sheenGlow: 0.06 },
  },
  golddust: {
    id: 'golddust',
    name: 'โกลด์ดัสต์',
    nameEn: 'Gold Dust Molly',
    // พื้นทองอำพัน มีจุดดำละเอียดเหมือนผงฝุ่นทั่วตัว + ลายด่างเข้มบางส่วน ครีบอำพันไล่เป็นดำที่ปลาย
    body: { base: '#e9a33c', back: '#c67a20', belly: '#f7dca0', gill: '#e9944a' },
    scales: { contrast: 0.24, relief: 1.05, rim: '#ffe2a0' },
    spots: [
      { color: '#2a1608', count: 34, minSize: 0.015, maxSize: 0.04, sizePow: 1.4, back: 0.4, blur: 1.4, matte: 0.5 },
      { color: '#0b0907', count: 760, minSize: 0.0035, maxSize: 0.014, sizePow: 1.6, back: 0.35, clusters: false, finCount: 70, finSize: 0.03 },
    ],
    fins: { base: '#c58a32', tip: '#1d1611', ray: '#6e4a1c', opacity: 0.82 },
    lip: '#d78a3c',
    iris: '#e1b968',
    material: { roughness: 0.3, metalness: 0.16, clearcoat: 0.72, iridescence: 0.3, sheenGlow: 0.05 },
  },
  silver: {
    id: 'silver',
    name: 'เงิน',
    nameEn: 'Silver Molly',
    body: { base: '#c4cad1', back: '#959ea8', belly: '#eceff2', gill: '#d4cdd0' },
    scales: { contrast: 0.32, relief: 1.15, rim: '#ffffff' },
    spots: null,
    fins: { base: '#cfd4d9', tip: '#f2f4f6', ray: '#8e969f', opacity: 0.5 },
    lip: '#c9c4c4',
    iris: '#d6dbe1',
    material: { roughness: 0.26, metalness: 0.5, clearcoat: 0.6, iridescence: 0.45, sheenGlow: 0.02 },
  },
  rainbow: {
    id: 'rainbow',
    // special = สีหายากที่สุด ไม่มีขายในร้าน ได้จากการผสมพันธุ์เท่านั้น และไม่ใช้เป็นแหล่งกลายพันธุ์ของสีอื่น (ดู genetics.js)
    special: true,
    name: 'สีรุ้ง',
    nameEn: 'Rainbow Molly',
    // หลังน้ำเงิน ข้างตัวฟ้า ท้องขาว หัวแดงลามตามสันหลัง ด่างส้ม จุดเขียว จุดดำละเอียด ครีบทองก้านเข้มปลายฟ้า ประกายมุกแรง
    body: { base: '#4fb3e6', back: '#1f3ea8', belly: '#fbfaf6', gill: '#f0c2b8' },
    head: { color: '#e3262e', start: 0.16, end: 0.3, back: 0.2 },
    scales: { contrast: 0.2, relief: 1.0, rim: '#e8f6ff' },
    spots: [
      { color: '#ff7a1a', count: 26, minSize: 0.03, maxSize: 0.07, sizePow: 1.2, back: 0.1, blur: 1.2, matte: 0.35, finCount: 4, finSize: 0.05 },
      { color: '#2fbf4f', count: 30, minSize: 0.03, maxSize: 0.065, sizePow: 1.2, back: 0.15, blur: 1.2, matte: 0.3, finCount: 6, finSize: 0.06 },
      { color: '#0b0c10', count: 160, minSize: 0.004, maxSize: 0.012, sizePow: 1.7, back: 0.45, clusters: false, finCount: 24, finSize: 0.025 },
    ],
    fins: { base: '#ffb400', tip: '#4fb3e6', ray: '#3a2a12', opacity: 0.86 },
    lip: '#e8463a',
    iris: '#e6c470',
    material: { roughness: 0.28, metalness: 0.1, clearcoat: 0.85, iridescence: 0.85, sheenGlow: 0.08 },
  },
};

/** ตัวอย่างโชว์ของ "ปลาสอดลูกผสม" (รูปในร้าน/สมุดสะสม) — ลูกผสมจริงแต่ละตัวใช้ยีนของตัวเอง ดู genetics.js */
MOLLY_VARIANTS.hybrid = {
  id: 'hybrid',
  showcase: true,
  name: 'ลูกผสม',
  nameEn: 'Hybrid Molly',
  body: { base: '#fbe6a6', back: '#f2c24a', belly: '#fdf6e2', gill: '#f6d6c6' },
  head: { color: '#f0541c', start: 0.16, end: 0.3, back: 0.12 },
  scales: { contrast: 0.15, relief: 0.9, rim: '#ffffff' },
  spots: [{ color: '#0b0c10', count: 140, minSize: 0.006, maxSize: 0.03, finCount: 30, finSize: 0.04 }],
  fins: { base: '#f0e6cf', tip: '#6e9fd2', ray: '#cfc4ad', opacity: 0.72 },
  lip: '#f2793f',
  iris: '#d6c08a',
  material: { roughness: 0.32, metalness: 0.06, clearcoat: 0.75, iridescence: 0.5, sheenGlow: 0.06 },
};

export const MOLLY_VARIANT_IDS = Object.keys(MOLLY_VARIANTS);

/**
 * ค่าของชั้นลายบั้ง (spots[].bars) พร้อมค่าเริ่มต้น — ใช้ร่วมกันทั้ง shader (mollyMesh.js) และ texture (mollyTextures.js)
 * จำกัดจำนวนบั้ง/ริ้วไว้ เพราะลูกผสมคูณ count/finCount ตามความหนาแน่นในยีน (k = 0.3..2)
 * @returns {null | { count: number, from: number, to: number, width: number, low: number[], marble: number, slant: number, streaks: number, glow: { color: string, from: number, amount: number } | null }}
 */
export function barSpec(L) {
  if (!L?.bars) return null;
  const B = L.bars;
  const int = (v, min, max) => Math.min(max, Math.max(min, Math.round(v)));
  return {
    count: int(L.count ?? 7, 3, 12),
    from: B.from ?? 0.1,
    to: B.to ?? 0.98,
    width: B.width ?? 0.45,
    low: [B.low?.[0] ?? -0.2, B.low?.[1] ?? -0.85],
    marble: B.marble ?? 0,
    slant: B.slant ?? 0,
    streaks: L.finCount > 0 ? int(L.finCount, 2, 12) : 0,
    glow: L.glow ? { color: L.glow.color, front: L.glow.front ?? L.glow.color, from: L.glow.from ?? 0.5, amount: L.glow.amount ?? 0.7 } : null,
  };
}

export const getMollyVariant = (id) => MOLLY_VARIANTS[id] ?? MOLLY_VARIANTS.dalmatian;
