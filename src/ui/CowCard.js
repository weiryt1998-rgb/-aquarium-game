import { ICONS } from './icons.js';
import { collectRefs, priceHtml } from './helpers.js';
import { CONFIG } from '../config.js';
import { getCowBreed } from '../data/animals.js';
import { breedNow, canBreed, dueAt, grownAt, isBull, isCalf, isCowDead, isPregnant, milkValue } from '../shared/farm.js';
import { escapeHtml, formatDuration } from '../utils/math.js';

/**
 * การ์ดวัว 1 ตัว (แตะวัวในคอก หรือปุ่ม "ดู" ในหน้าต่างฟาร์ม) — กรอบเดียวกับการ์ดทานตะวัน ไม่บังคอกตรงกลาง
 * แสดงเพศ ♀/♂ ความอิ่ม สุขภาพ นมในเต้า (ตัวผู้ไม่มี) + เวลาที่เหลือ · ตั้งท้อง/ครบกำหนดคลอด
 * เพศ/ผสมพันธุ์มีเฉพาะสายพันธุ์ canBreed (บราห์มัน) · ปุ่มให้ฟาง / รีดนม (ตัวเมีย) / ผสมพันธุ์ (แม่วัวโตแล้วไม่ได้ท้อง — FarmSystem เลือกพ่อพันธุ์ให้) หรือคลอดลูก (ท้องอยู่) / ขาย (กดยืนยันอีกครั้ง)
 */
export class CowCard {
  constructor(ui, root) {
    this.ui = ui;
    this.game = ui.game;
    this.root = root;
    this.cowId = null;
    this.layout = null;
    this.confirmSell = false;
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled) return;
      const farm = this.game.farm;
      const action = el.dataset.action;
      if (action === 'close') {
        this.game.sound.play('click');
        this.hide();
      } else if (action === 'sell') {
        if (!this.confirmSell) {
          this.confirmSell = true; // กดครั้งแรก = ถามยืนยัน
          this.game.sound.play('click');
          this.update();
          return;
        }
        farm.sell(this.cowId);
      } else if (action === 'breed' || action === 'birth') {
        if (farm[action](this.cowId)) this.update();
      } else if (farm.act(action, this.cowId)) this.update();
    });
  }

  get isOpen() {
    return !!this.cowId;
  }

  show(cowId) {
    this.ui.closeAll(); // หน้าต่างฟาร์มบังการ์ดอยู่ → ปิดก่อน
    this.cowId = cowId;
    this.layout = null;
    this.confirmSell = false;
    this.root.classList.remove('hidden');
    this.update();
  }

  hide() {
    this.cowId = null;
    this.root.classList.add('hidden');
  }

  /** @param {'cow'|'bull'|'dead'} layout */
  #render(layout) {
    const f = CONFIG.farm;
    const bull = layout === 'bull';
    const body =
      layout !== 'dead'
        ? `
      <div class="fc-stats">
        <div><span>🌾 ความอิ่ม</span><div class="bar satiety"><i data-ref="satiety"></i></div></div>
        <div><span>❤️ สุขภาพ</span><div class="bar health"><i data-ref="health"></i></div></div>
        ${bull ? '<div class="fc-note"><span class="gender m">♂</span> วัวตัวผู้ ไม่ให้นม — เป็นพ่อพันธุ์ให้แม่วัว</div>' : '<div><span>🥛 นมในเต้า</span><div class="bar milk"><i data-ref="milk"></i></div></div>'}
      </div>
      <div class="fc-meta" data-ref="meta"></div>
      <div class="gc-actions">
        <button class="btn" data-action="feed" data-ref="feedBtn">🌾<span>ให้ฟาง</span>${priceHtml(f.hayPrice)}</button>
        ${bull ? '' : '<button class="btn" data-action="milk" data-ref="milkBtn">🥛<span>รีดนม</span><span class="price reward" data-ref="milkValue"></span></button>'}
        ${bull ? '' : '<button class="btn" data-action="breed" data-ref="mateBtn"><b data-ref="mateIcon">💕</b><span data-ref="mateLabel">ผสมพันธุ์</span></button>'}
        <button class="btn" data-action="sell" data-ref="sellBtn">💰<span data-ref="sellLabel">ขาย</span><span class="price" data-ref="sellValue"></span></button>
      </div>
      <div class="gc-hint" data-ref="hint"></div>`
        : `
      <div class="fc-meta" data-ref="meta"></div>
      <div class="gc-actions">
        <button class="btn" data-action="sell" data-ref="sellBtn">🪦<span data-ref="sellLabel">นำออกจากคอก</span></button>
      </div>`;
    this.root.innerHTML = `
      <button class="btn-close" data-action="close" title="ปิด">${ICONS.close}</button>
      <div class="fc-head">
        <span class="gc-icon cow-icon" data-ref="icon">🐄</span>
        <div><b class="gc-title" data-ref="name"></b><small data-ref="sub"></small></div>
      </div>
      ${body}`;
    this.refs = collectRefs(this.root);
    this.layout = layout;
  }

  update() {
    if (!this.cowId) return;
    const farm = this.game.farm;
    const s = farm.cowStatus(this.cowId);
    if (!s) {
      this.hide();
      return;
    }
    const bull = isBull(s);
    const layout = isCowDead(s) ? 'dead' : bull ? 'bull' : 'cow';
    if (layout !== this.layout) this.#render(layout);
    const r = this.refs;
    const f = CONFIG.farm;
    const now = Date.now();
    const breed = breedNow(s, now) ?? getCowBreed(s.breedId);
    const sexed = canBreed(s);
    r.name.innerHTML = !sexed ? escapeHtml(s.name) : `${escapeHtml(s.name)} <span class="gender ${bull ? 'm' : 'f'}" title="${bull ? 'ตัวผู้' : 'ตัวเมีย'}">${bull ? '♂' : '♀'}</span>`;
    const age = s.born > 0 ? `เกิดในฟาร์มเมื่อ ${formatDuration((now - s.born) / 1000)} ที่แล้ว` : `อยู่ฟาร์มมา ${formatDuration((now - s.boughtAt) / 1000)}`;
    r.sub.textContent = `${breed?.name ?? ''} · ${age}`;
    const sellLabel = (text) => (r.sellLabel.textContent = this.confirmSell ? 'ยืนยัน?' : text);

    if (layout === 'dead') {
      r.icon.textContent = '🪦';
      r.meta.textContent = 'อดอาหารนานเกินไปจนตาย… นำออกจากคอกแล้วซื้อวัวตัวใหม่ได้ อย่าลืมให้ฟางสม่ำเสมอนะ';
      sellLabel('นำออกจากคอก');
      r.sellBtn.classList.toggle('danger', this.confirmSell);
      return;
    }

    const young = isCalf(s, now);
    const due = isPregnant(s) && now >= dueAt(s);
    r.icon.textContent = s.health < 40 ? '🤒' : s.satiety < f.hungryBelow ? '😟' : due ? '🍼' : bull ? '🐂' : '🐄';
    const set = (key, v) => {
      r[key].style.width = `${Math.max(0, Math.min(100, v))}%`;
      r[key].parentElement.classList.toggle('low', v < 25);
    };
    set('satiety', s.satiety);
    set('health', s.health);
    if (!bull) {
      set('milk', s.milk);
      r.milk.parentElement.classList.remove('low');
    }

    const notes = [];
    if (due) notes.push('🍼 พร้อมคลอดแล้ว!');
    else if (isPregnant(s)) notes.push(`🤰 ตั้งท้อง — คลอดในอีก ${formatDuration((dueAt(s) - now) / 1000)}`);
    if (s.satiety <= 0) notes.push('🚨 ท้องว่าง สุขภาพกำลังลด — ให้ฟางด่วน!');
    else notes.push(`🌾 ท้องว่างในอีก ${formatDuration((s.satiety / f.hungerUse) * 3600)}`);
    const rest = s.bredAt > 0 ? s.bredAt + f.breeding.cooldownHours * 3_600_000 - now : 0;
    if (young) notes.push(`🍼 ลูกวัว — โตเต็มวัย (${bull ? 'เป็นพ่อพันธุ์ได้' : 'เริ่มให้นม'}) ในอีก ${formatDuration((grownAt(s) - now) / 1000)}`);
    else if (bull) {
      if (rest > 0) notes.push(`💤 พักหลังผสมพันธุ์อีก ${formatDuration(rest / 1000)}`);
    } else if (s.satiety > 0 && s.milk < 100) {
      const rate = (breed?.milkPerHour ?? 1) * (s.health >= 50 ? 1 : 0.4);
      notes.push(`🥛 นมเต็มเต้าในอีก ${formatDuration(((100 - s.milk) / rate) * 3600)}`);
    } else if (s.milk >= 100) notes.push('🥛 นมเต็มเต้าแล้ว');
    if (s.health < 40) notes.push('🤒 ป่วย ผลิตนมได้น้อยลง');
    r.meta.textContent = notes.join(' · ');

    if (!bull) r.milkValue.textContent = `+${milkValue(s)}`;
    const refund = farm.sellValue(this.cowId).coins;
    r.sellValue.textContent = `+${refund}`;
    sellLabel('ขาย');
    r.sellBtn.classList.toggle('danger', this.confirmSell);

    // เน้นปุ่มที่ควรกดตอนนี้: หิว → ให้ฟาง · นมเต็ม → รีดนม · ครบกำหนด → คลอดลูก
    const needed = { feed: s.satiety < f.hungryBelow, milk: s.milk >= f.milkFullAbove };
    const hints = [];
    for (const action of bull ? ['feed'] : ['feed', 'milk']) {
      const block = farm.blockOf(action, this.cowId);
      const btn = r[`${action}Btn`];
      btn.disabled = !!block;
      btn.classList.toggle('ready', !block && needed[action]);
      if (block === 'too-full' && action === 'feed') hints.push(farm.blockText(block));
    }
    r.feedBtn.disabled ||= !this.game.state.canAfford(f.hayPrice);
    if (!bull) {
      // ปุ่มเดียวสลับ: ไม่ได้ท้อง = ผสมพันธุ์ · ท้องอยู่ = คลอดลูก (กดได้เมื่อครบกำหนด) · ลูกวัว = ซ่อน
      const pregnant = isPregnant(s);
      const action = pregnant ? 'birth' : 'breed';
      const btn = r.mateBtn;
      btn.hidden = young || !sexed;
      btn.dataset.action = action;
      r.mateIcon.textContent = pregnant ? '🍼' : '💕';
      r.mateLabel.textContent = pregnant ? 'คลอดลูก' : 'ผสมพันธุ์';
      const block = young || !sexed ? null : pregnant ? farm.birthBlockOf(this.cowId) : farm.breedBlockOf(this.cowId);
      btn.disabled = young || !sexed || !!block;
      btn.classList.toggle('ready', !block && due);
      btn.title = block && block !== 'not-ready' ? farm.blockText(block, action) : '';
      if (block && !young && sexed && block !== 'not-ready') hints.push(farm.blockText(block, action));
    }
    r.hint.textContent = this.confirmSell ? `กดอีกครั้งเพื่อขาย "${s.name}" ได้ ${refund} เหรียญ` : (hints[0] ?? '');
  }
}
