/**
 * ค่าคงที่ของเกม — ปรับสมดุลเกมได้จากไฟล์นี้ที่เดียว
 */
export const CONFIG = {
  /** เร่งเวลาจำลอง (เช่น 5 = เร็วขึ้น 5 เท่า) ใช้ตอนทดสอบระบบหิว/โต/ออกลูก */
  timeScale: 1,

  /** คีย์เซฟเก่าใน localStorage (ก่อนมีเซฟกลาง) — ใช้อ่านเพื่อนำเข้าเท่านั้น ไม่เขียนทับ */
  saveKey: 'aquarium-game-save',
  saveVersion: 1,
  autoSaveInterval: 15, // วินาที (ระบบเซฟกลางรวมการบันทึกให้ไม่ถี่เกินไปเอง)
  /** เขตเวลาของเกม: ภารกิจรายวัน/รางวัลประจำวันรีเซ็ตเที่ยงคืนตามเวลานี้พร้อมกันทุกอุปกรณ์ */
  timeZone: 'Asia/Bangkok',

  start: {
    coins: 1250,
    gems: 50,
    inventory: { flakes: 25, pellets: 5, bloodworm: 0, medicine: 1 },
  },

  care: {
    /** ความสะอาดลดลงต่อวินาที (ฐาน + ต่อปลา 1 ตัวขนาดปกติ) */
    dirtBase: 0.012,
    dirtPerFish: 0.01,
    /** อาหารที่ตกค้างพื้นทรายนานเกินไปจะเน่าและทำให้น้ำสกปรก */
    foodDecayTime: 30,
    foodDecayDirt: 1.2,
    cleanCooldown: 45, // วินาที
    medicineHeal: 50,
    /** สุขภาพลด/ฟื้นต่อวินาที */
    starvingDamage: 0.25,
    dirtyDamage: 0.15,
    regen: 0.08,
  },

  breeding: {
    checkInterval: 10,
    cooldown: 240,
    minHappiness: 70,
    minHealth: 70,
  },

  coins: {
    maxInTank: 20,
    riseSpeed: 0.55,
    surfaceTime: 5, // ลอยอยู่ที่ผิวน้ำกี่วินาทีก่อนเก็บอัตโนมัติ
  },

  offline: {
    maxSeconds: 8 * 3600,
    coinSeconds: 2 * 3600, // คิดเหรียญออฟไลน์สูงสุดกี่วินาที
    coinRate: 0.5, // ได้เหรียญออฟไลน์กี่ % ของตอนเล่น
    minSatiety: 25, // ระหว่างออฟไลน์ ปลาจะไม่หิวต่ำกว่านี้ (ไม่ตายตอนไม่อยู่)
    minCleanliness: 35,
  },

  feed: {
    pelletsPerSprinkle: 8,
    maxPellets: 160,
  },

  dailyReward: { coins: 200, gems: 5 },

  sellRate: 0.4, // ขายคืนได้ 40% ของราคา
  decorSellRate: 0.5,
  gridSize: 0.25,
};

/** คุณภาพกราฟิก */
export const QUALITY = {
  high: { pixelRatio: 2, shadows: true, shadowMapSize: 2048, pebbles: 520 },
  medium: { pixelRatio: 1.5, shadows: true, shadowMapSize: 1024, pebbles: 300 },
  low: { pixelRatio: 1, shadows: false, shadowMapSize: 512, pebbles: 120 },
};
