import { Panel } from '../Panel.js';
import { AVAILABLE_SPECIES } from '../../data/fish.js';
import { escapeHtml } from '../../utils/math.js';
import { genderIcon, meter, priceHtml, stars } from '../helpers.js';
import { isPregnant } from '../../shared/breeding.js';
import { describeGenes } from '../../models/molly/genetics.js';

/** ปลาในตู้ + สมุดสะสมสายพันธุ์ */
export class FishPanel extends Panel {
  constructor(ui) {
    super(ui, { title: '🐠 ปลาของฉัน', className: 'panel-fish' });
    this.tab = 'mine';
    this.pendingSell = null;
    this.tickTimer = 0;
  }

  onOpen(options) {
    if (options.tab) this.tab = options.tab;
    this.pendingSell = null;
  }

  render() {
    const count = this.game.fish.count;
    const cap = this.game.fish.capacity;
    const collected = this.game.state.collectionCount;
    this.body.innerHTML = `
      <div class="tabs">
        <button class="tab ${this.tab === 'mine' ? 'active' : ''}" data-action="tab" data-tab="mine">🐟 ปลาในตู้ (${count}/${cap})</button>
        <button class="tab ${this.tab === 'collection' ? 'active' : ''}" data-action="tab" data-tab="collection">📘 สมุดสะสม (${collected}/${AVAILABLE_SPECIES.length})</button>
      </div>
      <div class="tab-content">${this.tab === 'mine' ? this.#mine() : this.#collection()}</div>`;
  }

  #mine() {
    const list = this.game.fish.alive;
    if (list.length === 0) {
      return `<div class="empty">ยังไม่มีปลาในตู้นี้เลย<br><button class="btn-buy" data-action="shop">ไปร้านค้า</button></div>`;
    }
    const rows = list
      .map((f) => {
        const growth = f.isAdult ? 'โตเต็มวัย' : `กำลังโต ${Math.round(f.data.growth * 100)}%`;
        const sell = this.game.sellValue(f);
        const confirming = this.pendingSell === f.id;
        return `
        <div class="fish-row">
          <img src="${this.game.thumbs.fish(f.species, f.data.genes)}" alt="" draggable="false">
          <div class="info">
            <b>${escapeHtml(f.data.name)} ${genderIcon(f.data.gender)}${isPregnant(f.data) ? ' <span title="ตั้งท้อง">🤰</span>' : ''}</b>
            <small>${f.species.name}${f.data.genes ? ` (${describeGenes(f.data.genes)})` : ''} · ${growth}${f.data.health < 30 ? ' · <span class="warn">ป่วย</span>' : ''}</small>
            <div class="mini-meters">
              <span title="ความอิ่ม">🍽️ ${meter(f.data.satiety, 'satiety')}</span>
              <span title="สุขภาพ">❤️ ${meter(f.data.health, 'health')}</span>
              <span title="ความสุข">😊 ${meter(f.happiness, 'happy')}</span>
            </div>
          </div>
          <div class="row-actions">
            <button class="btn" data-action="view" data-id="${f.id}">ดู</button>
            <button class="btn ${confirming ? 'btn-danger' : 'btn-ghost'}" data-action="sell" data-id="${f.id}">${confirming ? 'ยืนยันขาย' : `ขาย ${priceHtml(sell)}`}</button>
          </div>
        </div>`;
      })
      .join('');
    return `<div class="fish-list">${rows}</div>`;
  }

  #collection() {
    const state = this.game.state;
    const cards = AVAILABLE_SPECIES.map((s) => {
      const known = state.isDiscovered(s.id);
      return `
        <div class="col-card ${known ? '' : 'unknown'}" ${known ? '' : `title="${s.notForSale ? 'ผสมพันธุ์ปลาสอดต่างสีเพื่อปลดล็อก' : 'ซื้อปลาชนิดนี้เพื่อปลดล็อก'}"`}>
          <img src="${this.game.thumbs.fish(s)}" alt="" draggable="false">
          <b>${known ? s.name : '???'}</b>
          ${stars(s.rarity)}
          <small>${known ? `${s.sizeCm} ซม.` : s.notForSale ? 'ได้จากการผสมพันธุ์' : priceHtml(s.price)}</small>
        </div>`;
    }).join('');
    const total = this.game.state.data.tanks.reduce((n, t) => n + t.fish.length, 0);
    return `<p class="hint">สะสมแล้ว ${state.collectionCount} จาก ${AVAILABLE_SPECIES.length} สายพันธุ์ · ปลาทุกตู้รวม ${total} ตัว</p><div class="collection-grid">${cards}</div>`;
  }

  onAction(action, el) {
    const game = this.game;
    switch (action) {
      case 'tab':
        this.tab = el.dataset.tab;
        game.sound.play('click');
        this.render();
        break;
      case 'shop':
        this.ui.open('shop', { tab: 'fish' });
        break;
      case 'view': {
        const fish = game.fish.getById(el.dataset.id);
        if (!fish) return;
        this.ui.closeAll();
        game.selectFish(fish);
        game.followFish(fish);
        break;
      }
      case 'sell': {
        const id = el.dataset.id;
        if (this.pendingSell !== id) {
          this.pendingSell = id;
          this.render();
          return;
        }
        const fish = game.fish.getById(id);
        if (fish) game.sellFish(fish);
        this.pendingSell = null;
        this.render();
        break;
      }
      default:
        break;
    }
  }

  tick(dt) {
    this.tickTimer -= dt;
    if (this.tickTimer > 0 || this.tab !== 'mine' || this.pendingSell) return;
    this.tickTimer = 1;
    this.render();
  }
}
