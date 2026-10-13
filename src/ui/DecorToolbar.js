import { DECOR_CATEGORIES, DECOR_ITEMS } from '../data/decor.js';
import { atDecorLimit } from '../shared/economy.js';
import { ICONS } from './icons.js';
import { priceHtml } from './helpers.js';

/** แถบเครื่องมือโหมดตกแต่ง: เลือกของ (ซ้าย), ปุ่มหมุน/ขาย (ล่าง), คำแนะนำ (บน) */
export class DecorToolbar {
  constructor(ui, root) {
    this.ui = ui;
    this.game = ui.game;
    this.root = root;
    this.category = DECOR_CATEGORIES[0].id;
    this.lastCoins = -1;
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (el && !el.disabled) this.#onAction(el.dataset.action, el);
    });
    root.addEventListener('change', (e) => {
      if (e.target.dataset.action === 'snap') this.game.placement.snap = e.target.checked;
    });
  }

  show() {
    this.root.classList.remove('hidden');
    this.render();
  }

  hide() {
    this.root.classList.add('hidden');
  }

  render() {
    const placement = this.game.placement;
    const state = this.game.state;
    this.lastCoins = state.coins;
    const items = DECOR_ITEMS.filter((i) => i.category === this.category)
      .map((item) => {
        const active = placement.previewItem?.id === item.id;
        const full = atDecorLimit(state.activeTank, item);
        const poor = full || !state.canAfford(item.price);
        const title = item.pearl ? `${item.name} — เปิดฝาพร้อมไข่มุกทุก ${item.pearl.interval / 60} นาที แตะเก็บได้ ${item.pearl.reward.coins} เหรียญ` : item.name;
        return `
          <button class="decor-item ${active ? 'active' : ''} ${poor ? 'poor' : ''}" data-action="place" data-id="${item.id}" title="${title}">
            <img src="${this.game.thumbs.decor(item)}" alt="" draggable="false">
            <span>${item.name}</span>
            ${full ? '<small>ตู้ละ 1 ชิ้น</small>' : priceHtml(item.price)}
          </button>`;
      })
      .join('');
    const sel = placement.selected;
    this.root.innerHTML = `
      <div class="decor-hint">${
        placement.state === 'placing'
          ? `แตะพื้นทรายเพื่อวาง <b>${placement.previewItem.name}</b> · R = หมุน · Shift ค้าง = วางต่อ · Esc/คลิกขวา = ยกเลิก`
          : 'เลือกของจากแถบซ้าย แล้วแตะพื้นทรายเพื่อวาง · ลากของในตู้เพื่อย้าย · คลิกขวาลาก = หมุนกล้อง'
      }</div>
      <aside class="decor-panel">
        <header><b>🪴 ตกแต่งตู้</b></header>
        <div class="cat-tabs">
          ${DECOR_CATEGORIES.map((c) => `<button class="${c.id === this.category ? 'active' : ''}" data-action="cat" data-id="${c.id}" title="${c.name}">${c.icon}<span>${c.name}</span></button>`).join('')}
        </div>
        <div class="decor-grid">${items}</div>
        <label class="snap-toggle"><input type="checkbox" data-action="snap" ${placement.snap ? 'checked' : ''}> ยึดตามกริด</label>
      </aside>
      <div class="decor-actions">
        ${
          sel
            ? `<span class="sel-name">${sel.item.name}</span>
               <button class="btn" data-action="rotate">${ICONS.rotate}<span>หมุน</span></button>
               <button class="btn btn-ghost" data-action="sell">${ICONS.trash}<span>ขาย ${priceHtml(placement.sellValue(sel))}</span></button>`
            : placement.state === 'placing'
              ? `<button class="btn" data-action="rotate">${ICONS.rotate}<span>หมุน</span></button>
                 <button class="btn btn-ghost" data-action="cancel">${ICONS.close}<span>ยกเลิก</span></button>`
              : ''
        }
        <button class="btn-done" data-action="done">${ICONS.check}<span>เสร็จสิ้น</span></button>
      </div>`;
  }

  /** เรียกเมื่อสถานะการจัดวางเปลี่ยน */
  refresh() {
    if (!this.root.classList.contains('hidden')) this.render();
  }

  /** วาดใหม่เมื่อเงินเปลี่ยน (ของที่ซื้อไม่ไหวจะจางลง) */
  tick() {
    if (!this.root.classList.contains('hidden') && this.game.state.coins !== this.lastCoins) this.render();
  }

  #onAction(action, el) {
    const placement = this.game.placement;
    switch (action) {
      case 'cat':
        this.category = el.dataset.id;
        this.game.sound.play('click');
        this.render();
        break;
      case 'place':
        this.game.sound.play('click');
        if (placement.previewItem?.id === el.dataset.id) placement.cancelPlacing();
        else placement.startPlacing(el.dataset.id);
        break;
      case 'rotate':
        placement.rotate();
        break;
      case 'sell':
        placement.sellSelected();
        break;
      case 'cancel':
        placement.cancelPlacing();
        break;
      case 'done':
        this.game.sound.play('click');
        placement.exit();
        break;
      default:
        break;
    }
  }
}
