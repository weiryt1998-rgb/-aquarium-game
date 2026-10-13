/**
 * ชุดสีของปลาอวกาศ (Space Fish) — ทุกสีใช้รูปทรงและ shader เดียวกัน ต่างกันแค่ค่าสี
 *
 *  deep    = สีพื้นอวกาศ (ส่วนมืดของลำตัว)
 *  nebula  = สีเนบิวลา 3 ชั้นที่ไหลวนบนลำตัว [หลัก, รอง, ประกาย]
 *  energy  = เส้นพลังงานเรืองแสงที่วิ่งตามลำตัวและก้านครีบ
 *  star    = สีดวงดาวระยิบระยับ
 *  fins    = ครีบโปร่งแสง ไล่สีจากโคน (base) → ปลาย (tip)
 *  iris    = ม่านตา (ตาสะท้อนแสงคล้ายดวงดาว)
 *  glow    = แสงฟุ้งรอบตัว
 *  trail   = สีอนุภาคแสงที่ตามหลังขณะว่าย
 *  light   = ลำตัวสีอ่อน (Stardust White): เพิ่มความสว่างพื้นผิว ลดการเรืองแสงไม่ให้ขาวจนเห็นลายไม่ชัด
 *
 * ไฟล์นี้เป็นข้อมูลล้วน (ไม่ใช้ three) ทดสอบใน Node ได้
 */
export const SPACEFISH_VARIANTS = {
  nebula_blue: {
    deep: '#060b2e',
    nebula: ['#2f6bff', '#8b3cff', '#ff7ad9'],
    energy: '#ffb36b',
    star: '#e8f2ff',
    fins: { base: '#5d8dff', tip: '#ff9fe0' },
    iris: '#58c8ff',
    glow: '#5f8cff',
    trail: ['#9fd0ff', '#c79bff', '#ffffff', '#ffc4e8'],
  },
  galaxy_purple: {
    deep: '#12052b',
    nebula: ['#8a3dff', '#ff4fd8', '#3a6bff'],
    energy: '#ffc4ff',
    star: '#fff0ff',
    fins: { base: '#a86bff', tip: '#ff9be8' },
    iris: '#d78bff',
    glow: '#b46bff',
    trail: ['#d9a8ff', '#ff9be8', '#ffffff', '#9fb4ff'],
  },
  cosmic_gold: {
    deep: '#1c0d00',
    nebula: ['#ffaa1e', '#ff6a12', '#fff0a8'],
    energy: '#fff3c0',
    star: '#fffbe8',
    fins: { base: '#ffbe45', tip: '#fff2c8' },
    iris: '#ffd36b',
    glow: '#ffb03a',
    trail: ['#ffd77a', '#ffb347', '#fffbe8', '#ffe9b0'],
  },
  stardust_white: {
    deep: '#8590b8',
    nebula: ['#f4f6ff', '#b8c6ff', '#ffc8ef'],
    energy: '#a77bff',
    star: '#b9a4ff',
    fins: { base: '#eef2ff', tip: '#d4c4ff' },
    iris: '#9fb8ff',
    glow: '#dfe6ff',
    trail: ['#ffffff', '#dfe6ff', '#e8d4ff', '#cfe4ff'],
    light: true,
  },
  red_nebula: {
    deep: '#1e0206',
    nebula: ['#ff2238', '#ff7a2a', '#a01a6a'],
    energy: '#ffd27a',
    star: '#fff0e0',
    fins: { base: '#ff4a3c', tip: '#ffb08a' },
    iris: '#ff8a5a',
    glow: '#ff4040',
    trail: ['#ff8a7a', '#ffc46b', '#ffffff', '#ff6a8a'],
  },
  green_aurora: {
    deep: '#011616',
    nebula: ['#14f5b8', '#2a9bff', '#b4ff4a'],
    energy: '#e4ff9a',
    star: '#effffa',
    fins: { base: '#2ef0c0', tip: '#9affff' },
    iris: '#5effd0',
    glow: '#2affc0',
    trail: ['#7affd8', '#9affff', '#ffffff', '#c8ff8a'],
  },
};

export const SPACEFISH_VARIANT_IDS = Object.keys(SPACEFISH_VARIANTS);

export const getSpaceFishVariant = (id) => {
  const v = SPACEFISH_VARIANTS[id] ?? SPACEFISH_VARIANTS.nebula_blue;
  return { id: SPACEFISH_VARIANTS[id] ? id : 'nebula_blue', ...v };
};
