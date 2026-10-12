import { Panel } from '../Panel.js';
import { CARE_ITEMS, FOOD_TYPES } from '../../data/food.js';
import { CONFIG } from '../../config.js';
import { priceHtml } from '../helpers.js';

/** อาหาร (เลือก/ซื้อ) และของดูแลตู้ (ทำความสะอาด ยารักษา) */
export class FoodPanel extends Panel {
  constructor(ui) {
    super(ui, { title: '🥫 อาหารและการดูแล', className: 'panel-food' });
  }

  render() {
    const state = this.game.state;
    const selected = state.data.selectedFood;
    const foods = FOOD_TYPES.map((f) => {
      const effects = [`อิ่ม +${f.nutrition}/เม็ด`];
      if (f.health) effects.push(`สุขภาพ +${f.health}`);
      if (f.happiness) effects.push(`ความสุข +${f.happiness}`);
      if (f.growth > 1) effects.push(`โตไว x${f.growth}`);
      const isSel = selected === f.id;
      return `
        <div class="list-row ${isSel ? 'selected' : ''}">
          <span class="row-icon">${f.icon}</span>
          <div class="info">
            <b>${f.name}</b>
            <small>${f.description}</small>
            <small class="effects">${effects.join(' · ')}</small>
          </div>
          <div class="row-count">มี <b>${state.itemCount(f.id)}</b> ห่อ</div>
          <div class="row-actions">
            <button class="btn ${isSel ? 'btn-active' : ''}" data-action="select-food" data-id="${f.id}" ${isSel ? 'disabled' : ''}>${isSel ? '✓ ใช้อยู่' : 'เลือกใช้'}</button>
            <button class="btn-buy" data-action="buy-food" data-id="${f.id}" ${state.canAfford(f.price) ? '' : 'disabled'}>ซื้อ ${f.pack} ห่อ ${priceHtml(f.price)}</button>
          </div>
        </div>`;
    }).join('');

    const medicine = CARE_ITEMS.find((c) => c.id === 'medicine');
    this.body.innerHTML = `
      <p class="hint">กดปุ่ม <b>ให้อาหาร</b> มุมขวาล่าง (หรือกด F) เพื่อโรยอาหาร 1 ห่อ · ให้มากเกินไปอาหารจะเหลือและทำให้น้ำสกปรก</p>
      <div class="list">${foods}</div>
      <h3 class="section-title">ดูแลตู้ปลา</h3>
      <div class="list">
        <div class="list-row">
          <span class="row-icon">🧽</span>
          <div class="info">
            <b>ทำความสะอาดตู้</b>
            <small>เปลี่ยนน้ำและดูดตะกอน ฟรี (รอ ${CONFIG.care.cleanCooldown} วินาทีต่อครั้ง)</small>
            <small class="effects" data-ref="cleanInfo"></small>
          </div>
          <div class="row-actions"><button class="btn" data-action="clean" data-ref="cleanBtn">ทำความสะอาด</button></div>
        </div>
        <div class="list-row">
          <span class="row-icon">${medicine.icon}</span>
          <div class="info">
            <b>${medicine.name}</b>
            <small>${medicine.description} (+${CONFIG.care.medicineHeal})</small>
          </div>
          <div class="row-count">มี <b>${state.itemCount('medicine')}</b> ขวด</div>
          <div class="row-actions">
            <button class="btn" data-action="use-medicine" ${state.itemCount('medicine') > 0 ? '' : 'disabled'}>ใช้ยา</button>
            <button class="btn-buy" data-action="buy-medicine" ${state.canAfford(medicine.price) ? '' : 'disabled'}>ซื้อ ${priceHtml(medicine.price)}</button>
          </div>
        </div>
      </div>`;
    this.tick();
  }

  onAction(action, el) {
    const game = this.game;
    switch (action) {
      case 'select-food':
        game.state.data.selectedFood = el.dataset.id;
        game.state.record({ type: 'selectFood', foodId: el.dataset.id });
        game.sound.play('click');
        game.ui.refreshFeedButton();
        break;
      case 'buy-food':
        game.buyFood(el.dataset.id);
        break;
      case 'clean':
        game.cleanTank();
        break;
      case 'use-medicine':
        game.useMedicine();
        break;
      case 'buy-medicine':
        game.buyMedicine();
        break;
      default:
        return;
    }
    this.render();
  }

  tick() {
    const info = this.body?.querySelector('[data-ref="cleanInfo"]');
    const btn = this.body?.querySelector('[data-ref="cleanBtn"]');
    if (!info || !btn) return;
    const wait = Math.ceil(this.game.care.cleanCooldownLeft());
    info.textContent = `ความสะอาดตอนนี้ ${Math.round(this.game.care.cleanliness)}%`;
    btn.disabled = wait > 0;
    btn.textContent = wait > 0 ? `รอ ${wait} วิ` : 'ทำความสะอาด';
  }
}
