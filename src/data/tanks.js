/**
 * ชนิดของตู้ปลา (ซื้อได้ชนิดละ 1 ตู้ แต่ละตู้มีปลาและของตกแต่งของตัวเอง)
 * size: ขนาดภายในตู้ (หน่วยเกม) w = กว้าง, h = สูง, d = ลึก
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
  },
  {
    id: 'classic',
    name: 'ตู้มาตรฐาน',
    label: '90 ซม.',
    size: { w: 14.5, h: 7.2, d: 6.5 },
    capacity: 20,
    price: { coins: 3000 },
    theme: '#1fa6a0',
  },
  {
    id: 'large',
    name: 'ตู้ใหญ่',
    label: '120 ซม.',
    size: { w: 17, h: 8, d: 7.5 },
    capacity: 28,
    price: { coins: 8000 },
    theme: '#3a6fd8',
  },
  {
    id: 'panorama',
    name: 'ตู้พาโนรามา',
    label: '150 ซม.',
    size: { w: 21, h: 8.5, d: 8.5 },
    capacity: 40,
    price: { gems: 150 },
    theme: '#7a4fd8',
  },
];

export const getTankType = (id) => TANK_TYPES.find((t) => t.id === id);
export const tankTier = (id) => TANK_TYPES.findIndex((t) => t.id === id);
