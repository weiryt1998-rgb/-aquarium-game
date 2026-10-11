import { Panel } from '../Panel.js';
import { FISH_SPECIES, ZONE_LABEL, getSpecies } from '../../data/fish.js';
import { TANK_TYPES } from '../../data/tanks.js';
import { priceHtml, stars } from '../helpers.js';

/** ร้านค้า: แท็บซื้อปลา และแท็บตู้ปลา (ปลดล็อก/สลับตู้) */
export class ShopPanel extends Panel {
  constructor(ui) {
    super(ui, { title: '🏪 ร้านค้า', className: 'panel-shop' });
    this.tab = 'fish';
    this.selectedId = FISH_SPECIES[0].id;
  }

  onOpen(options) {
    if (options.tab) this.tab = options.tab;
    if (options.speciesId) this.selectedId = options.speciesId;
  }

  render() {
    this.body.innerHTML = `
      <div class="tabs">
        <button class="tab ${this.tab === 'fish' ? 'active' : ''}" data-action="tab" data-tab="fish">🐟 ปลา</button>
        <button class="tab ${this.tab === 'tanks' ? 'active' : ''}" data-action="tab" data-tab="tanks">🏠 ตู้ปลา</button>
      </div>
      <div class="tab-content">${this.tab === 'fish' ? this.#fishTab() : this.#tankTab()}</div>`;
  }

  #fishTab() {
    const thumbs = this.game.thumbs;
    const grid = FISH_SPECIES.map((s) => {
      const isNew = !this.game.state.isDiscovered(s.id);
      return `
        <button class="item-card ${s.id === this.selectedId ? 'active' : ''}" data-action="select" data-id="${s.id}">
          ${isNew ? '<i class="tag-new">ใหม่</i>' : ''}
          <img src="${thumbs.fish(s)}" alt="" draggable="false">
          <span class="item-name">${s.name}</span>
          ${priceHtml(s.price)}
        </button>`;
    }).join('');
    return `<div class="shop-layout"><div class="item-grid">${grid}</div><div class="shop-detail">${this.#detail()}</div></div>`;
  }

  #detail() {
    const s = getSpecies(this.selectedId);
    const check = this.game.canBuyFish(s);
    const perMinute = Math.round((s.economy.coinValue / s.economy.coinInterval) * 60);
    return `
      <div class="detail-preview" style="--glow:${s.look.pattern.colors[0]}"><img src="${this.game.thumbs.fish(s)}" alt="" draggable="false"></div>
      <h3>${s.name} <small>${s.nameEn}</small></h3>
      <p class="desc">${s.description}</p>
      <ul class="facts">
        <li><span>ความหายาก</span>${stars(s.rarity)}</li>
        <li><span>ขนาด</span><b>${s.sizeCm} ซม.</b></li>
        <li><span>นิสัย</span><b>${ZONE_LABEL[s.behavior.zone]}${s.behavior.schooling ? ' · ว่ายเป็นฝูง' : ''}</b></li>
        <li><span>รายได้</span><b>~${perMinute} เหรียญ/นาที</b></li>
      </ul>
      <div class="detail-buy">
        ${priceHtml(s.price, 'big')}
        <button class="btn-buy" data-action="buy" ${check.ok ? '' : 'disabled'}>ซื้อ</button>
      </div>
      ${check.ok ? '' : `<p class="hint warn">${check.reason}</p>`}`;
  }

  #tankTab() {
    const state = this.game.state;
    const active = state.activeTank;
    const cards = TANK_TYPES.map((t) => {
      const owned = state.data.tanks.find((x) => x.typeId === t.id);
      const isActive = active.typeId === t.id;
      let footer;
      if (isActive) footer = '<span class="tag-active">กำลังใช้งาน</span>';
      else if (owned) footer = `<button class="btn" data-action="switch" data-id="${owned.id}">ไปที่ตู้นี้</button>`;
      else footer = `<button class="btn-buy" data-action="buy-tank" data-id="${t.id}" ${state.canAfford(t.price) ? '' : 'disabled'}>ปลดล็อก ${priceHtml(t.price)}</button>`;
      const fishCount = isActive ? this.game.fish.count : owned?.fish.length ?? 0;
      return `
        <div class="tank-card ${isActive ? 'active' : ''} ${owned ? 'owned' : 'locked'}" style="--theme:${t.theme}">
          <div class="tank-preview" style="--w:${t.size.w}">
            <span class="tp-glass">${owned ? '<i>🐠</i><i>🐟</i><i>🪸</i>' : '<i class="lock">🔒</i>'}</span>
          </div>
          <h4>${t.name} <small>${t.label}</small></h4>
          <p>จุปลาได้ ${t.capacity} ตัว${owned ? ` · มีปลา ${fishCount} ตัว` : ''}</p>
          ${footer}
        </div>`;
    }).join('');
    return `<p class="hint">ตู้ใหญ่ขึ้น = เลี้ยงปลาได้มากขึ้น และปลาหายากบางชนิดต้องใช้ตู้ใหญ่ แต่ละตู้มีปลาและของตกแต่งแยกกัน</p><div class="tank-grid">${cards}</div>`;
  }

  onAction(action, el) {
    const game = this.game;
    switch (action) {
      case 'tab':
        this.tab = el.dataset.tab;
        game.sound.play('click');
        this.render();
        break;
      case 'select':
        this.selectedId = el.dataset.id;
        game.sound.play('click');
        this.render();
        break;
      case 'buy':
        if (game.buyFish(this.selectedId)) this.render();
        break;
      case 'buy-tank':
        if (game.buyTank(el.dataset.id)) this.render();
        break;
      case 'switch':
        game.switchTank(el.dataset.id);
        this.render();
        break;
      default:
        break;
    }
  }

  tick() {
    // อัปเดตปุ่มซื้อเมื่อเงินเปลี่ยน โดยไม่วาดใหม่ทั้งหน้าต่าง
    if (this.tab !== 'fish') return;
    const btn = this.body.querySelector('[data-action="buy"]');
    const ok = this.game.canBuyFish(getSpecies(this.selectedId)).ok;
    if (btn && btn.disabled === ok) this.render();
  }
}
