import { Panel } from '../Panel.js';
import { CONFIG } from '../../config.js';
import { COW_BREEDS, getCowBreed } from '../../data/animals.js';
import { isCowDead, milkValue } from '../../shared/farm.js';
import { escapeHtml } from '../../utils/math.js';
import { priceHtml } from '../helpers.js';

/** หน้าต่างฟาร์มวัว (ปุ่ม 🐄 วัว นอกบ้าน): ซื้อวัว + รายการวัวในคอกพร้อมปุ่มดูแลด่วน */
export class FarmPanel extends Panel {
  constructor(ui) {
    super(ui, { title: '🐄 ฟาร์มวัว', className: 'panel-farm' });
    this.wait = 0;
  }

  render() {
    const farm = this.game.farm;
    const state = this.game.state;
    const f = CONFIG.farm;
    const herd = farm.herd;

    const breeds = COW_BREEDS.filter((b) => !b.retired)
      .map((b) => {
        const block = farm.buyBlockOf(b.id);
        const afford = state.canAfford(b.price);
        const fullHours = Math.round(100 / b.milkPerHour);
        return `
        <div class="list-row">
          <span class="row-icon">${b.skin ? '🐮' : '🐄'}</span>
          <div class="info">
            <b>${b.name}</b>
            <small>${b.description}</small>
            <small class="effects">นมเต็มเต้าใน ~${fullHours} ชม. · รีดเต็มเต้าได้ ${b.milkReward.coins} เหรียญ</small>
          </div>
          <div class="row-actions">
            <button class="btn-buy" data-action="buy" data-id="${b.id}" ${block || !afford ? 'disabled' : ''} title="${block ? farm.blockText(block) : ''}">ซื้อ ${priceHtml(b.price)}</button>
          </div>
        </div>`;
      })
      .join('');

    const rows = herd
      .map((c) => {
        const breed = getCowBreed(c.breedId);
        const dead = isCowDead(c);
        const status = dead
          ? '<small class="effects warn">🪦 ตายแล้ว — นำออกได้ที่การ์ดวัว</small>'
          : `<small class="effects ${c.satiety < f.hungryBelow ? 'warn' : ''}">🌾 อิ่ม ${Math.round(c.satiety)}% · ❤️ ${Math.round(c.health)}% · 🥛 นม ${Math.round(c.milk)}%</small>`;
        const feedBlock = dead || farm.blockOf('feed', c.id) || !state.canAfford(f.hayPrice);
        const milkBlock = dead || farm.blockOf('milk', c.id);
        return `
        <div class="list-row">
          <span class="row-icon">${dead ? '🪦' : c.satiety < f.hungryBelow ? '😟' : '🐄'}</span>
          <div class="info">
            <b>${escapeHtml(c.name)}</b> <small>${breed?.name ?? ''}</small>
            ${status}
          </div>
          <div class="row-actions">
            <button class="btn" data-action="view" data-id="${c.id}">ดู</button>
            ${dead ? '' : `<button class="btn ${feedBlock ? '' : 'btn-active'}" data-action="feed" data-id="${c.id}" ${feedBlock ? 'disabled' : ''}>🌾 ให้ฟาง ${priceHtml(f.hayPrice)}</button>`}
            ${dead ? '' : `<button class="btn" data-action="milk" data-id="${c.id}" ${milkBlock ? 'disabled' : ''}>🥛 รีด +${milkValue(c)}</button>`}
          </div>
        </div>`;
      })
      .join('');

    this.body.innerHTML = `
      <p class="hint">วัวกินฟางแล้วผลิตนม ยิ่งอิ่มและแข็งแรงนมยิ่งออกเร็ว · รีดนมแล้วได้เหรียญ · ปล่อยให้ท้องว่างนาน ๆ วัวจะป่วยจนตาย
        (ทุกอย่างเดินตามเวลาจริง ปิดเกมไว้วัวก็ยังหิว)</p>
      <h3 class="section-title">วัวในคอก (${farm.cowCount}/${f.maxCows} ตัว)</h3>
      <div class="list">${rows || '<p class="hint">ยังไม่มีวัว — ซื้อตัวแรกได้ข้างล่าง</p>'}</div>
      <h3 class="section-title">ซื้อวัว</h3>
      <div class="list">${breeds}</div>`;
  }

  onAction(action, el) {
    const farm = this.game.farm;
    const id = el.dataset.id;
    switch (action) {
      case 'buy':
        farm.buy(id);
        break;
      case 'feed':
        farm.act('feed', id);
        break;
      case 'milk':
        farm.act('milk', id);
        break;
      case 'view':
        this.game.sound.play('click');
        this.ui.closeAll();
        farm.focus(id);
        this.ui.cowCard.show(id);
        return;
      default:
        return;
    }
    this.render();
  }

  /** ค่าเปลี่ยนตามเวลา → วาดใหม่ทุก 2 วินาที (ไม่ถี่เกินจนปุ่มกระพริบ) */
  tick(step) {
    this.wait -= step;
    if (this.wait > 0) return;
    this.wait = 2;
    this.render();
  }
}
