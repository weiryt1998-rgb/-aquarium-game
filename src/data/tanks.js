/**
 * ชนิดของตู้ปลา (ซื้อได้ชนิดละ 1 ตู้ แต่ละตู้มีปลาและของตกแต่งของตัวเอง)
 * size: ขนาดภายในตู้ (หน่วยเกม) w = กว้าง, h = สูง, d = ลึก
 * style: รูปลักษณ์ของตู้ (world/Aquarium.js)
 *   frame     = วัสดุขอบตู้ black | walnut | white | lacquer
 *   trim      = แถบโลหะตกแต่ง chrome | brass | gold | null
 *   led       = สีไฟ LED ใต้ฝาตู้
 *   backdrop  = ภาพพื้นหลังในตู้ ocean | planted | reef | abyss (render/textures.js)
 *   sand      = สีย้อมพื้นทราย
 * showcase: ปลาที่ใช้ในภาพตัวอย่างของร้านค้า (ของตกแต่งใช้ผังเดียวกับตู้เริ่มต้น + ของเพิ่มเติม extraDecor)
 */
export const TANK_TYPES = [
  {
    id: 'starter',
    name: 'ตู้เริ่มต้น',
    label: '60 ซม.',
    size: { w: 12, h: 6.5, d: 5.5 },
    capacity: 14,
    price: null,
    theme: '#2a8fd6',
    style: { name: 'โอเชียนบลู', frame: 'black', trim: null, led: '#cfefff', backdrop: 'ocean', sand: '#ffffff' },
    showcase: { fish: ['molly_dalmatian', 'molly_golden', 'clownfish', 'guppy', 'guppy', 'betta', 'crab'] },
  },
  {
    id: 'classic',
    name: 'ตู้มาตรฐาน',
    label: '90 ซม.',
    size: { w: 14.5, h: 7.2, d: 6.5 },
    capacity: 20,
    price: { coins: 3000 },
    theme: '#1fa6a0',
    style: { name: 'วอลนัทการ์เดน', frame: 'walnut', trim: 'brass', led: '#ffe2b0', backdrop: 'planted', sand: '#d8c8a8' },
    showcase: {
      fish: ['molly_redhead', 'molly_calico', 'angelfish', 'guppy', 'guppy', 'guppy', 'betta', 'koi', 'crab'],
      extraDecor: [['plant_vallis', -0.25, -0.85, 0.4], ['plant_red', 0.05, -0.6, 1], ['plant_fern', 0.55, 0.45, 0.3]],
    },
  },
  {
    id: 'large',
    name: 'ตู้ใหญ่',
    label: '120 ซม.',
    size: { w: 17, h: 8, d: 7.5 },
    capacity: 28,
    price: { coins: 8000 },
    theme: '#3a6fd8',
    style: { name: 'คอรัลรีฟ', frame: 'white', trim: 'chrome', led: '#9fb8ff', backdrop: 'reef', sand: '#fff6e8' },
    showcase: {
      fish: ['clownfish', 'clownfish', 'discus', 'lionfish', 'molly_golddust', 'molly_calico', 'angelfish', 'eagleray', 'crab'],
      extraDecor: [['coral', -0.3, -0.75, 0.6], ['coral', 0.75, -0.75, 2], ['seashell', 0.1, 0.4, 0.5]],
    },
  },
  {
    id: 'panorama',
    name: 'ตู้พาโนรามา',
    label: '150 ซม.',
    size: { w: 21, h: 8.5, d: 8.5 },
    capacity: 40,
    price: { gems: 150 },
    theme: '#7a4fd8',
    style: { name: 'รอยัลอะบิส', frame: 'lacquer', trim: 'gold', led: '#8ff3ff', backdrop: 'abyss', sand: '#b9b4c4' },
    showcase: {
      fish: ['arowana', 'eagleray', 'discus', 'discus', 'lionfish', 'molly_golden', 'molly_golden', 'angelfish', 'koi', 'crab'],
      extraDecor: [['temple_ruin', -0.45, -0.45, 0.3], ['coral', 0.45, -0.8, 1.2], ['seashell', -0.15, 0.5, 2]],
    },
  },
];

export const getTankType = (id) => TANK_TYPES.find((t) => t.id === id);
export const tankTier = (id) => TANK_TYPES.findIndex((t) => t.id === id);
