import { coinIcon, gemIcon } from './icons.js';
import { formatNumber } from '../utils/math.js';

/** แสดงราคา เช่น { coins: 100 } → (เหรียญ) 100 */
export function priceHtml(price, extraClass = '') {
  if (!price) return '<span class="price free">ฟรี</span>';
  const parts = [];
  if (price.coins) parts.push(`${coinIcon}${formatNumber(price.coins)}`);
  if (price.gems) parts.push(`${gemIcon}${formatNumber(price.gems)}`);
  return `<span class="price ${extraClass}">${parts.join(' ') || 'ฟรี'}</span>`;
}

export function stars(rarity, max = 5) {
  return `<span class="stars" title="ความหายาก ${rarity}/${max}">${'★'.repeat(rarity)}<span class="dim">${'★'.repeat(max - rarity)}</span></span>`;
}

/** ดาวความหายากของสายพันธุ์ + ป้าย "ตำนาน" ถ้าเป็นปลาระดับตำนาน */
export function rarityHtml(species) {
  return `${stars(species.rarity)}${species.legendary ? '<b class="legend-label">✦ ตำนาน</b>' : ''}`;
}

/** แถบค่าสถานะเล็ก ๆ (0..100) */
export function meter(value, kind = '') {
  const v = Math.round(Math.max(0, Math.min(100, value)));
  return `<span class="meter ${kind} ${v < 25 ? 'low' : ''}"><i style="width:${v}%"></i></span>`;
}

/** หา element ที่มี data-ref แล้วคืนเป็น object */
export function collectRefs(root) {
  const refs = {};
  root.querySelectorAll('[data-ref]').forEach((el) => (refs[el.dataset.ref] = el));
  return refs;
}

export const genderIcon = (g) => (g === 'm' ? '<span class="gender m" title="ตัวผู้">♂</span>' : '<span class="gender f" title="ตัวเมีย">♀</span>');
