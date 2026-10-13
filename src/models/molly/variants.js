/**
 * ชุดสีของปลา Balloon Molly
 * ทุกสีใช้รูปทรงและแอนิเมชันเดียวกัน ต่างกันแค่ texture และค่าวัสดุ
 *
 * body.base/back/belly : สีพื้นลำตัว สีหลัง สีท้อง (ไล่สีแบบ countershading)
 * scales               : ความเข้มของขอบเกล็ดบน texture สี (contrast) และความนูนบน normal map (relief)
 * spots                : ลายจุด/ด่าง — object ชั้นเดียว หรือ array หลายชั้น (วาดทับตามลำดับ) ไม่มี = ไม่มีจุด
 *                        { color, count, minSize, maxSize, sizePow, back, clusters, blur, matte, finCount, finSize }
 * head                 : สีบริเวณหัว { color, start, end, back } (t = 0 ปลายจมูก → 1 โคนหาง)
 * fins                 : สีครีบ ก้านครีบ ปลายครีบ และความทึบ
 * material             : ค่า PBR — clearcoat = ความมันวาวเหมือนเคลือบน้ำ, iridescence = ประกายมุก
 */
export const MOLLY_VARIANTS = {
  dalmatian: {
    id: 'dalmatian',
    name: 'ดัลเมเชียน',
    nameEn: 'Dalmatian Molly',
    body: { base: '#f3f1ec', back: '#dcdfe3', belly: '#fbf9f4', gill: '#f2dcd8' },
    scales: { contrast: 0.12, relief: 0.75, rim: '#ffffff' },
    spots: { color: '#07080b', count: 330, minSize: 0.005, maxSize: 0.036, finCount: 46 },
    fins: { base: '#f1efea', tip: '#fbfaf8', ray: '#d2cfc9', opacity: 0.76 },
    lip: '#ecdcd6',
    iris: '#c9ced6',
    material: { roughness: 0.34, metalness: 0.04, clearcoat: 0.75, iridescence: 0.5, sheenGlow: 0.06 },
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
    spots: { color: '#0b0c10', count: 0, finCount: 14, finSize: 0.04 },
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
      { color: '#f2882a', count: 54, minSize: 0.03, maxSize: 0.09, sizePow: 1.2, back: 0.25, blur: 1.2, matte: 0.35, finCount: 10, finSize: 0.07 },
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

export const getMollyVariant = (id) => MOLLY_VARIANTS[id] ?? MOLLY_VARIANTS.dalmatian;
