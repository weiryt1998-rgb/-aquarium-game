/**
 * อาหารและของใช้ดูแลปลา
 * nutrition = ความอิ่มต่ออาหาร 1 เม็ด, pack = ซื้อครั้งละกี่ห่อ (1 ห่อ = โรย 1 ครั้ง)
 */
export const FOOD_TYPES = [
  {
    id: 'flakes',
    name: 'อาหารเกล็ด',
    icon: '🥣',
    description: 'อาหารพื้นฐาน ราคาถูก ปลาทุกชนิดกินได้',
    nutrition: 15,
    health: 0,
    happiness: 0,
    growth: 1,
    color: '#e8a24a',
    pack: 10,
    price: { coins: 50 },
  },
  {
    id: 'pellets',
    name: 'อาหารเม็ดพรีเมียม',
    icon: '🧆',
    description: 'อิ่มนาน เพิ่มสุขภาพ และช่วยให้ปลาโตไวขึ้น',
    nutrition: 22,
    health: 3,
    happiness: 2,
    growth: 1.6,
    color: '#a2512b',
    pack: 10,
    price: { coins: 120 },
  },
  {
    id: 'bloodworm',
    name: 'หนอนแดง',
    icon: '🪱',
    description: 'ของโปรดของปลา เพิ่มความสุขมากเป็นพิเศษ',
    nutrition: 18,
    health: 1,
    happiness: 12,
    growth: 1.3,
    color: '#c8233a',
    pack: 10,
    price: { gems: 5 },
  },
];

export const CARE_ITEMS = [
  {
    id: 'medicine',
    name: 'ยารักษาปลา',
    icon: '💊',
    description: 'ฟื้นฟูสุขภาพปลาทุกตัวในตู้',
    price: { coins: 150 },
  },
];

export const getFood = (id) => FOOD_TYPES.find((f) => f.id === id);
