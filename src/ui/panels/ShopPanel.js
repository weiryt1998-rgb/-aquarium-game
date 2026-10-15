import { Panel } from '../Panel.js';
import { SHOP_SPECIES, ZONE_LABEL, getSpecies } from '../../data/fish.js';
import { breedGroupOf } from '../../shared/breeding.js';
import { TANK_TYPES } from '../../data/tanks.js';
import { priceHtml, rarityHtml } from '../helpers.js';
import { CONFIG } from '../../config.js';
import { formatNumber } from '../../utils/math.js';

const EXCHANGE_STEPS = [1, 5, 10, 50];

/** ร้านค้า: แท็บซื้อปลา และแท็บตู้ปลา (ปลดล็อก/สลับตู้) */
export class ShopPanel extends Panel {
  constructor(ui) {
    super(ui, { title: '🏪 ร้านค้า', className: 'panel-shop' });
    this.tab = 'fish';
    this.selectedId = SHOP_SPECIES[0].id;
    this.gender = null; // เพศที่ผู้เล่นเลือกเอง (null = เลือกให้อัตโนมัติตามที่ตู้ยังขาด)
    this.exchangeAmount = 1;
  }

  onOpen(options) {
    if (options.tab) this.tab = options.tab;
    if (options.speciesId && options.speciesId !== this.selectedId && SHOP_SPECIES.includes(getSpecies(options.speciesId))) {
      this.selectedId = options.speciesId;
      this.gender = null;
    }
  }

  /** จำนวนตัวผู้/ตัวเมียในตู้ที่เปิดอยู่ ที่ผสมพันธุ์กับสายพันธุ์นี้ได้ (ปลาสอดนับทุกสี) */
  #genderCount(speciesId) {
    const group = breedGroupOf(getSpecies(speciesId));
    const count = { m: 0, f: 0 };
    for (const f of this.game.fish.alive) if (breedGroupOf(f.species) === group) count[f.data.gender === 'm' ? 'm' : 'f']++;
    return count;
  }

  /** เพศที่จะซื้อ: ตามที่เลือก หรือถ้ายังไม่เลือก ให้เติมเพศที่ตู้ยังขาด (ค่าเริ่มต้นตัวเมีย) */
  #pickedGender(count) {
    if (this.gender) return this.gender;
    return count.f > 0 && count.m === 0 ? 'm' : 'f';
  }

  render() {
    this.body.innerHTML = `
      <div class="tabs">
        <button class="tab ${this.tab === 'fish' ? 'active' : ''}" data-action="tab" data-tab="fish">🐟 ปลา</button>
        <button class="tab ${this.tab === 'tanks' ? 'active' : ''}" data-action="tab" data-tab="tanks">🏠 ตู้ปลา</button>
        <button class="tab ${this.tab === 'exchange' ? 'active' : ''}" data-action="tab" data-tab="exchange">💎 แลกเพชร</button>
      </div>
      <div class="tab-content">${this.tab === 'fish' ? this.#fishTab() : this.tab === 'tanks' ? this.#tankTab() : this.#exchangeTab()}</div>`;
  }

  #fishTab() {
    const thumbs = this.game.thumbs;
    const grid = SHOP_SPECIES.map((s) => {
      const isNew = !this.game.state.isDiscovered(s.id);
      return `
        <button class="item-card ${s.id === this.selectedId ? 'active' : ''} ${s.legendary ? 'legendary' : ''}" data-action="select" data-id="${s.id}">
          ${isNew ? '<i class="tag-new">ใหม่</i>' : ''}
          ${s.legendary ? '<i class="tag-legend" title="ปลาระดับตำนาน">✦</i>' : ''}
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
        <li><span>ความหายาก</span><b>${rarityHtml(s)}</b></li>
        <li><span>ขนาด</span><b>${s.sizeCm} ซม.</b></li>
        <li><span>นิสัย</span><b>${ZONE_LABEL[s.behavior.zone]}${s.behavior.schooling ? ' · ว่ายเป็นฝูง' : ''}</b></li>
        <li><span>รายได้</span><b>~${perMinute} เหรียญ/นาที</b></li>
      </ul>
      ${this.#genderPicker(s)}
      <div class="detail-buy">
        ${priceHtml(s.price, 'big')}
        <button class="btn-buy" data-action="buy" ${check.ok ? '' : 'disabled'}>ซื้อ</button>
      </div>
      ${check.ok ? '' : `<p class="hint warn">${check.reason}</p>`}`;
  }

  #genderPicker(s) {
    const count = this.#genderCount(s.id);
    const g = this.#pickedGender(count);
    let advice;
    if (count.m > 0 && count.f > 0) advice = 'ครบคู่ มีลูกได้';
    else if (count.m > 0) advice = 'ขาดตัวเมีย';
    else if (count.f > 0) advice = 'ขาดตัวผู้';
    else advice = 'ต้องมีทั้ง ♂ และ ♀ ถึงจะมีลูก';
    const help = 'ต้องมีตัวผู้และตัวเมียชนิดเดียวกันในตู้ เมื่อโตเต็มวัย สุขภาพดี และมีความสุข ตัวผู้จะเกี้ยวพาราสี แล้วตัวเมียตั้งท้องและคลอดลูกครั้งละ 1 ตัว';
    return `
      <div class="gender-pick" role="radiogroup" aria-label="เลือกเพศ">
        <span>เพศ</span>
        <button class="gp m ${g === 'm' ? 'active' : ''}" data-action="gender" data-g="m" role="radio" aria-checked="${g === 'm'}">♂ ตัวผู้</button>
        <button class="gp f ${g === 'f' ? 'active' : ''}" data-action="gender" data-g="f" role="radio" aria-checked="${g === 'f'}">♀ ตัวเมีย</button>
      </div>
      <p class="hint gender-hint" title="${help}">ในตู้นี้${s.breedGroup ? ' (นับทุกสี)' : ''}: <b class="gender m">♂ ${count.m}</b> · <b class="gender f">♀ ${count.f}</b> · ${advice}</p>`;
  }

  /** แลกเหรียญเป็นเพชร */
  #exchangeTab() {
    const rate = CONFIG.exchange.coinsPerGem;
    const max = this.game.maxExchangeGems;
    const n = Math.max(1, Math.min(this.exchangeAmount, Math.max(max, 1)));
    this.exchangeAmount = n;
    const steps = EXCHANGE_STEPS.map(
      (k) => `<button class="ex-step ${n === k ? 'active' : ''}" data-action="ex-amount" data-n="${k}" ${k > max ? 'disabled' : ''}>${k}</button>`,
    ).join('');
    return `
      <div class="exchange">
        <div class="ex-rate">${priceHtml({ coins: rate }, 'big')} <span class="ex-arrow">➜</span> ${priceHtml({ gems: 1 }, 'big')}</div>
        <p class="hint">มีเหรียญ ${formatNumber(this.game.state.coins)} · แลกได้สูงสุด ${formatNumber(max)} เพชร</p>
        <div class="ex-steps">
          <button class="ex-step" data-action="ex-delta" data-n="-1" ${n <= 1 ? 'disabled' : ''}>−</button>
          <b class="ex-amount">${formatNumber(n)}</b>
          <button class="ex-step" data-action="ex-delta" data-n="1" ${n >= max ? 'disabled' : ''}>+</button>
        </div>
        <div class="ex-steps">${steps}<button class="ex-step ${n === max && max > 0 ? 'active' : ''}" data-action="ex-amount" data-n="${max}" ${max < 1 ? 'disabled' : ''}>สูงสุด</button></div>
        <div class="ex-summary">จ่าย ${priceHtml({ coins: n * rate })} ได้รับ ${priceHtml({ gems: n })}</div>
        <button class="btn-buy" data-action="exchange" ${max >= n && max > 0 ? '' : 'disabled'}>แลกเพชร</button>
        ${max < 1 ? `<p class="hint warn">ต้องมีอย่างน้อย ${formatNumber(rate)} เหรียญ</p>` : ''}
      </div>`;
  }

  /** การ์ดตู้แต่ละใบ: ภาพตัวอย่างจริงของตู้ (กดดูภาพใหญ่ได้) + ปุ่มปลดล็อก/สลับตู้ */
  #tankTab() {
    const state = this.game.state;
    const cards = TANK_TYPES.map((t) => {
      const owned = state.data.tanks.find((x) => x.typeId === t.id);
      const isActive = state.activeTank.typeId === t.id;
      const fishCount = isActive ? this.game.fish.count : owned?.fish.length ?? 0;
      return `
        <div class="tank-card ${isActive ? 'active' : ''} ${owned ? 'owned' : 'locked'}" style="--theme:${t.theme}">
          ${this.#tankShot(t, owned)}
          <h4>${t.name} <small>${t.label}</small></h4>
          ${t.style ? `<p class="tank-style">✨ สไตล์${t.style.name}</p>` : ''}
          <p>จุปลาได้ ${t.capacity} ตัว${owned ? ` · มีปลา ${fishCount} ตัว` : ''}</p>
          ${this.#tankFooter(t, owned, isActive)}
        </div>`;
    }).join('');
    // สร้างภาพที่ยังไม่มี (ทีละภาพ) แล้วใส่แทนตัวโหลดเมื่อเสร็จ
    for (const t of TANK_TYPES) if (!this.game.tankPreviews.peek(t)) this.game.tankPreviews.get(t).then((url) => this.#fillShot(t.id, url));
    return `<p class="hint">ตู้ใหญ่ขึ้น = เลี้ยงปลาได้มากขึ้น และปลาหายากบางชนิดต้องใช้ตู้ใหญ่ แต่ละตู้มีสไตล์ ปลา และของตกแต่งแยกกัน · แตะรูปเพื่อดูตัวอย่าง</p>
      <div class="tank-grid">${cards}</div>${this.#lightbox()}`;
  }

  #tankShot(t, owned) {
    const url = this.game.tankPreviews.peek(t);
    return `
      <button class="tank-shot" data-action="preview-tank" data-id="${t.id}" title="ดูตัวอย่าง${t.name}">
        ${url ? `<img src="${url}" alt="ตัวอย่าง${t.name}" draggable="false">` : '<span class="shot-loading">กำลังสร้างภาพตัวอย่าง…</span>'}
        <span class="shot-zoom">🔍 ดูตัวอย่าง</span>
        ${owned ? '' : '<span class="shot-lock">🔒 ยังไม่ปลดล็อก</span>'}
      </button>`;
  }

  #tankFooter(t, owned, isActive) {
    if (isActive) return '<span class="tag-active">กำลังใช้งาน</span>';
    if (owned) return `<button class="btn" data-action="switch" data-id="${owned.id}">ไปที่ตู้นี้</button>`;
    return `<button class="btn-buy" data-action="buy-tank" data-id="${t.id}" ${this.game.state.canAfford(t.price) ? '' : 'disabled'}>ปลดล็อก ${priceHtml(t.price)}</button>`;
  }

  /** ภาพตัวอย่างขนาดใหญ่ของตู้ที่เลือก */
  #lightbox() {
    const t = TANK_TYPES.find((x) => x.id === this.previewTankId);
    if (!t) return '';
    const state = this.game.state;
    const owned = state.data.tanks.find((x) => x.typeId === t.id);
    const isActive = state.activeTank.typeId === t.id;
    const url = this.game.tankPreviews.peek(t);
    return `
      <div class="tank-lightbox" role="dialog" aria-label="ตัวอย่าง${t.name}">
        <div class="tl-backdrop" data-action="close-preview"></div>
        <div class="tl-card">
          <div class="tl-image tank-shot" data-id="${t.id}">
            ${url ? `<img src="${url}" alt="ตัวอย่าง${t.name}" draggable="false">` : '<span class="shot-loading">กำลังสร้างภาพตัวอย่าง…</span>'}
          </div>
          <div class="tl-info">
            <div>
              <h3>${t.name} <small>${t.label}</small></h3>
              <p>${t.style ? `✨ สไตล์${t.style.name} · ` : ''}จุปลาได้ ${t.capacity} ตัว · ภาพตัวอย่างตกแต่งพร้อมปลา</p>
            </div>
            <div class="tl-actions">
              ${this.#tankFooter(t, owned, isActive)}
              <button class="btn" data-action="close-preview">ปิด</button>
            </div>
          </div>
        </div>
      </div>`;
  }

  /** ใส่ภาพที่สร้างเสร็จแทนตัวโหลด (ถ้ายังเปิดแท็บตู้อยู่) */
  #fillShot(id, url) {
    if (!url || !this.isOpen || this.tab !== 'tanks') return;
    for (const el of this.body.querySelectorAll(`.tank-shot[data-id="${id}"] .shot-loading`)) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.draggable = false;
      el.replaceWith(img);
    }
  }

  onAction(action, el) {
    const game = this.game;
    switch (action) {
      case 'tab':
        this.tab = el.dataset.tab;
        this.previewTankId = null;
        game.sound.play('click');
        this.render();
        break;
      case 'select':
        if (this.selectedId !== el.dataset.id) this.gender = null;
        this.selectedId = el.dataset.id;
        game.sound.play('click');
        this.render();
        break;
      case 'gender':
        this.gender = el.dataset.g === 'm' ? 'm' : 'f';
        game.sound.play('click');
        this.render();
        break;
      case 'buy':
        if (game.buyFish(this.selectedId, this.#pickedGender(this.#genderCount(this.selectedId)))) this.render();
        break;
      case 'ex-amount':
        this.exchangeAmount = Number(el.dataset.n) || 1;
        game.sound.play('click');
        this.render();
        break;
      case 'ex-delta':
        this.exchangeAmount = Math.max(1, Math.min(this.game.maxExchangeGems, this.exchangeAmount + Number(el.dataset.n)));
        game.sound.play('click');
        this.render();
        break;
      case 'exchange':
        if (game.exchangeGems(this.exchangeAmount)) this.render();
        break;
      case 'preview-tank':
        this.previewTankId = el.dataset.id;
        game.sound.play('click');
        this.render();
        break;
      case 'close-preview':
        this.previewTankId = null;
        this.render();
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
    // หน้าแลกเพชร: วาดใหม่เมื่อจำนวนที่แลกได้เปลี่ยน (เช่น เก็บเหรียญเพิ่ม)
    if (this.tab === 'exchange') {
      const max = this.game.maxExchangeGems;
      if (max !== this.shownMax) {
        this.shownMax = max;
        this.render();
      }
      return;
    }
    // อัปเดตปุ่มซื้อเมื่อเงินเปลี่ยน โดยไม่วาดใหม่ทั้งหน้าต่าง
    if (this.tab === 'tanks') {
      for (const btn of this.body.querySelectorAll('[data-action="buy-tank"]')) {
        const type = TANK_TYPES.find((t) => t.id === btn.dataset.id);
        btn.disabled = !type || !this.game.state.canAfford(type.price);
      }
      return;
    }
    if (this.tab !== 'fish') return;
    const btn = this.body.querySelector('[data-action="buy"]');
    const ok = this.game.canBuyFish(getSpecies(this.selectedId)).ok;
    if (btn && btn.disabled === ok) this.render();
  }
}
