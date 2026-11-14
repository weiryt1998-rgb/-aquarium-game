/**
 * สัตว์ในฟาร์มนอกบ้าน — แก้หรือเพิ่มได้โดยไม่ต้องแตะโค้ดระบบ (แบบเดียวกับ data/fish.js)
 *
 * ห้ามลบ object ออกจาก COW_BREEDS เมื่อเปิดใช้เซฟแล้ว (วัวในเซฟของผู้เล่นจะหายตอนโหลด) — เลิกขายให้ใส่ retired: true
 *
 * milkPerHour = เต้านมเต็มขึ้น %/ชม. ตอนอิ่มและแข็งแรง · milkReward = เหรียญเมื่อรีดนมตอนเต็ม 100%
 * look = สีของโมเดลชั่วคราว (entities/Cow.js) · model.scale = ขนาดเทียบวัวโฮลสไตน์
 * skin = ภาพผิวแทนลายในไฟล์โมเดล (ใช้ mesh/ท่าทางของ models/farm/cow.glb)
 * model.file = ไฟล์โมเดลของสายพันธุ์นั้นเอง (มีโครงกระดูก/ท่าทางของตัวเอง เช่นบราห์มัน: Walk Graze Drink LieDown Lie StandUp Idle)
 * young = หน้าตาตอนเป็นลูกวัวของสายพันธุ์ตัวเต็มวัย (ใช้กับลูกวัวที่เกิดในฟาร์ม และสายพันธุ์ลูกวัวที่ซื้อซึ่งโตเป็นสายพันธุ์นี้ — ดู shared/farm.js adultBreedOf):
 *   { file?, scale, drinkReach, walkClipSpeed } — ไม่มี file = ใช้โมเดลตัวเต็มวัยย่อขนาดตาม scale · มี file = โมเดลลูกวัวโดยเฉพาะ (ขนาดลูกวัวในไฟล์อยู่แล้ว)
 * calf = สายพันธุ์ลูกวัวที่ขายในร้าน: { growsInto, growHours } — โตตามเวลาจริงนับจากวันซื้อ (shared/farm.js isCalf) · หน้าตาใช้ young ของ growsInto
 * canBreed = มีเพศผู้/เมียและผสมพันธุ์ได้ (ตอนนี้เฉพาะบราห์มัน — โฮลสไตน์/เจอร์ซีย์ยังเป็นโมเดลชั่วคราว ซื้อได้แต่ตัวเมีย)
 */
export const COW_BREEDS = [
  {
    id: 'holstein',
    name: 'วัวนมขาวดำ',
    description: 'วัวนมพันธุ์มาตรฐาน ให้นมเร็ว เลี้ยงง่าย',
    price: { coins: 800 },
    milkPerHour: 20,
    milkReward: { coins: 90 },
    look: { base: '#f2efe8', patch: '#1f1f22', nose: '#e8a9a0', horn: '#e9e1cf' },
    model: { scale: 1 },
    retired: true, // โมเดลชั่วคราว — เลิกขาย (ตัวที่มีในเซฟยังอยู่)
    young: { scale: 0.55, drinkReach: 0.7, walkClipSpeed: 0.32 },
  },
  {
    id: 'jersey',
    name: 'วัวเจอร์ซีย์',
    description: 'ตัวเล็กสีน้ำตาลอ่อน นมเข้มข้น ขายได้ราคาดีกว่าแต่ผลิตช้ากว่า',
    price: { coins: 1500 },
    milkPerHour: 13,
    milkReward: { coins: 170 },
    look: { base: '#b9804c', patch: null, nose: '#2d2420', horn: '#e9e1cf' },
    model: { scale: 0.9 },
    skin: 'models/farm/cow_jersey.webp',
    retired: true, // โมเดลชั่วคราว — เลิกขาย (ตัวที่มีในเซฟยังอยู่)
    young: { scale: 0.5, drinkReach: 0.66, walkClipSpeed: 0.3 },
  },
  {
    id: 'brahman',
    name: 'วัวบราห์มัน',
    description: 'บราห์มันเลือด 100% ตัวโต มีโหนก ทนร้อน นมน้อยแต่ราคาดี ชอบเดินไปกินน้ำที่รางและลงนอนพัก',
    price: { coins: 2500 },
    milkPerHour: 9,
    milkReward: { coins: 300 },
    look: { base: '#c9c6c0', patch: null, nose: '#1b1a1a', horn: '#3a3734' },
    model: { scale: 1, file: 'models/farm/brahman.glb' },
    young: { file: 'models/farm/brahman_calf.glb', scale: 1, drinkReach: 0.72, walkClipSpeed: 0.4 },
    canBreed: true,
  },
  {
    id: 'thai_brown',
    name: 'วัวพื้นเมืองสีน้ำตาล',
    description: 'วัวพื้นเมืองหลังค่อม ตัวเล็กกระทัดรัด ราคาย่อมเยา เลี้ยงง่าย ให้นมสม่ำเสมอ',
    price: { coins: 1000 },
    milkPerHour: 12,
    milkReward: { coins: 160 },
    look: { base: '#9a7a62', patch: null, nose: '#2a2220', horn: '#d9c9a8' },
    model: { scale: 1, file: 'models/farm/cow_brown.glb' },
    young: { scale: 0.55, drinkReach: 0.7, walkClipSpeed: 0.32 },
  },
  {
    id: 'lamphun_white',
    name: 'วัวขาวลำพูน',
    description: 'วัวพื้นเมืองขาวล้วน เขาโค้งสวย ใจเย็น นมน้อยกว่าวัวนมแต่ราคาดี',
    price: { coins: 1800 },
    milkPerHour: 10,
    milkReward: { coins: 240 },
    look: { base: '#ece9e2', patch: null, nose: '#2c2a28', horn: '#4a4038' },
    model: { scale: 1, file: 'models/farm/cow_white.glb' },
    young: { scale: 0.55, drinkReach: 0.7, walkClipSpeed: 0.32 },
  },
  {
    id: 'brahman_calf',
    name: 'ลูกวัวบราห์มัน',
    description: 'ราคาถูกกว่าตัวโต เลี้ยงไว้ 2 วันจะโตเป็นวัวบราห์มันเต็มวัย (ระหว่างเป็นลูกวัวยังไม่ให้นม)',
    price: { coins: 1200 },
    milkPerHour: 9,
    milkReward: { coins: 300 },
    look: { base: '#ddd7cb', patch: null, nose: '#262222', horn: '#3a3734' },
    model: { scale: 1, file: 'models/farm/brahman.glb' },
    /** โตเป็น growsInto เมื่ออยู่ฟาร์มครบ growHours ชม. · ระหว่างนั้นใช้หน้าตา young ของ growsInto (brahman.young) */
    calf: { growsInto: 'brahman', growHours: 48 },
    canBreed: true,
  },
];

const BY_ID = new Map(COW_BREEDS.map((b) => [b.id, b]));

export const getCowBreed = (id) => BY_ID.get(id) ?? null;
