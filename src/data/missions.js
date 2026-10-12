import { EV } from '../core/EventBus.js';
import { FISH_SPECIES, getSpecies } from './fish.js';

/**
 * ภารกิจ
 * daily: true  = ภารกิจรายวัน รีเซ็ตทุกเที่ยงคืน
 * event        = นับจากเหตุการณ์ (ดู EV ใน core/EventBus.js) แต่ละครั้งนับ +payload.amount หรือ +1
 * gauge(data)  = คำนวณจากข้อมูลเซฟโดยตรง (ไม่ต้องนับสะสม) — เซิร์ฟเวอร์ใช้ฟังก์ชันเดียวกันตรวจตอนรับรางวัล
 */
const collectionCount = (data) => FISH_SPECIES.filter((s) => data.collection[s.id]).length;
const mostFishInTank = (data) => Math.max(0, ...data.tanks.map((t) => t.fish.length));
const hasRareFish = (data, minRarity) => data.tanks.some((t) => t.fish.some((f) => (getSpecies(f.speciesId)?.rarity ?? 0) >= minRarity));

export const MISSIONS = [
  { id: 'd_feed', daily: true, title: 'ให้อาหารปลา 5 ครั้ง', icon: '🥣', event: EV.FEED, target: 5, reward: { coins: 100 } },
  { id: 'd_coins', daily: true, title: 'เก็บเหรียญจากปลา 10 เหรียญ', icon: '🪙', event: EV.COIN_COLLECTED, target: 10, reward: { coins: 120 } },
  { id: 'd_clean', daily: true, title: 'ทำความสะอาดตู้ 1 ครั้ง', icon: '🧽', event: EV.TANK_CLEANED, target: 1, reward: { coins: 80 } },
  { id: 'd_decor', daily: true, title: 'วางของตกแต่ง 2 ชิ้น', icon: '🪴', event: EV.DECOR_PLACED, target: 2, reward: { coins: 150 } },
  { id: 'd_buy', daily: true, title: 'ซื้อปลาตัวใหม่ 1 ตัว', icon: '🐟', event: EV.FISH_BOUGHT, target: 1, reward: { coins: 100, gems: 2 } },

  { id: 'a_breed', title: 'ปลาออกลูกครั้งแรก', icon: '🐣', event: EV.FISH_BORN, target: 1, reward: { gems: 10 } },
  { id: 'a_species', title: 'สะสมปลาให้ครบ 8 สายพันธุ์', icon: '📘', gauge: collectionCount, target: 8, reward: { gems: 15 } },
  { id: 'a_fish15', title: 'เลี้ยงปลาในตู้เดียวพร้อมกัน 15 ตัว', icon: '🐠', gauge: mostFishInTank, target: 15, reward: { gems: 10 } },
  { id: 'a_tank', title: 'ปลดล็อกตู้ปลาใหม่', icon: '🏠', event: EV.TANK_UNLOCKED, target: 1, reward: { gems: 20 } },
  { id: 'a_rare', title: 'เลี้ยงปลาหายากระดับ 4 ดาวขึ้นไป', icon: '💎', gauge: (data) => (hasRareFish(data, 4) ? 1 : 0), target: 1, reward: { coins: 1000 } },
];
