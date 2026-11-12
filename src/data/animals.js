/**
 * สัตว์ในฟาร์มนอกบ้าน — แก้หรือเพิ่มได้โดยไม่ต้องแตะโค้ดระบบ (แบบเดียวกับ data/fish.js)
 *
 * ห้ามลบ object ออกจาก COW_BREEDS เมื่อเปิดใช้เซฟแล้ว (วัวในเซฟของผู้เล่นจะหายตอนโหลด) — เลิกขายให้ใส่ retired: true
 *
 * milkPerHour = เต้านมเต็มขึ้น %/ชม. ตอนอิ่มและแข็งแรง · milkReward = เหรียญเมื่อรีดนมตอนเต็ม 100%
 * look = สีของโมเดลชั่วคราว (entities/Cow.js) · model.scale = ขนาดเทียบวัวโฮลสไตน์
 * skin = ภาพผิวแทนลายในไฟล์โมเดล (ทุกสายพันธุ์ใช้ mesh/ท่าทางเดียวกัน: models/farm/cow.glb)
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
  },
];

const BY_ID = new Map(COW_BREEDS.map((b) => [b.id, b]));

export const getCowBreed = (id) => BY_ID.get(id) ?? null;
