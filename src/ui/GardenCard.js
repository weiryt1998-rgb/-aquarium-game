import { ICONS } from './icons.js';
import { collectRefs, priceHtml } from './helpers.js';
import { CONFIG } from '../config.js';
import { formatDuration } from '../utils/math.js';
import { isDead, sunflowerStage } from '../shared/garden.js';

/**
 * การ์ดดูแลกระถางทานตะวัน (แตะกระถางในฉาก หรือปุ่ม 🌻 ที่แถบซ้าย)
 * ไม่บังฉากเหมือนหน้าต่างเมนู — เห็นบัวรดน้ำ/ถุงปุ๋ยเทลงกระถางระหว่างที่กดได้
 */
export class GardenCard {
  constructor(ui, root) {
    this.ui = ui;
    this.game = ui.game;
    this.root = root;
    this.isOpen = false;
    this.layout = null;
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el || el.disabled) return;
      const action = el.dataset.action;
      if (action === 'close') {
        this.game.sound.play('click');
        this.hide();
      } else if (this.game.garden.act(action)) this.update();
    });
  }

  toggle() {
    if (this.isOpen) this.hide();
    else this.show();
  }

  show() {
    this.isOpen = true;
    this.layout = null;
    this.root.classList.remove('hidden');
    this.update();
  }

  hide() {
    this.isOpen = false;
    this.root.classList.add('hidden');
  }

  /** โครงการ์ด: กระถางว่าง/ต้นตาย = ปุ่มปลูก · มีต้นไม้ = ค่าสถานะ + ปุ่มดูแล */
  #render(layout) {
    const g = CONFIG.garden;
    const body =
      layout === 'grow'
        ? `
      <div class="fc-stats">
        <div><span>💧 น้ำในดิน</span><div class="bar water"><i data-ref="water"></i></div></div>
        <div><span>🧪 ปุ๋ย</span><div class="bar fertilizer"><i data-ref="food"></i></div></div>
        <div><span>❤️ สุขภาพ</span><div class="bar health"><i data-ref="health"></i></div></div>
        <div><span>🌱 การเติบโต</span><div class="bar growth"><i data-ref="growth"></i></div></div>
      </div>
      <div class="fc-meta" data-ref="meta"></div>
      <div class="gc-actions">
        <button class="btn" data-action="water" data-ref="waterBtn">💧<span>รดน้ำ</span><small>ฟรี</small></button>
        <button class="btn" data-action="fertilize" data-ref="fertilizeBtn">🧪<span>ใส่ปุ๋ย</span>${priceHtml(g.fertilizerPrice)}</button>
        <button class="btn" data-action="harvest" data-ref="harvestBtn">🌻<span>เก็บเมล็ด</span>${priceHtml(g.seedReward, 'reward')}</button>
      </div>
      <div class="gc-hint" data-ref="hint"></div>`
        : `
      <div class="fc-meta" data-ref="meta"></div>
      <div class="gc-actions">
        <button class="btn-buy" data-action="plant">🌱<span>ปลูกเมล็ดทานตะวัน</span>${priceHtml(g.seedPrice)}</button>
      </div>`;
    this.root.innerHTML = `
      <button class="btn-close" data-action="close" title="ปิด">${ICONS.close}</button>
      <div class="fc-head">
        <span class="gc-icon" data-ref="icon">🌻</span>
        <div><b class="gc-title">กระถางทานตะวัน</b><small data-ref="stage"></small></div>
      </div>
      ${body}`;
    this.refs = collectRefs(this.root);
    this.layout = layout;
  }

  update() {
    if (!this.isOpen) return;
    const garden = this.game.garden;
    const s = garden.status;
    const layout = s && !isDead(s) ? 'grow' : 'empty';
    if (layout !== this.layout) this.#render(layout);
    const r = this.refs;
    const g = CONFIG.garden;

    if (layout === 'empty') {
      r.icon.textContent = s ? '🥀' : '🪴';
      r.stage.textContent = s ? 'เหี่ยวตายแล้ว' : 'กระถางว่าง';
      r.meta.textContent = s
        ? 'ขาดน้ำนานเกินไปจนเหี่ยวตาย ปลูกใหม่แล้วหมั่นรดน้ำนะ'
        : 'ปลูกทานตะวันไว้ข้างตู้ปลา รดน้ำ ใส่ปุ๋ย ดูแลจนดอกบาน แล้วเก็บเมล็ดไปขายได้เหรียญ';
      return;
    }

    const stage = sunflowerStage(s);
    r.icon.textContent = stage.icon;
    r.stage.textContent = `${stage.name} · ปลูกมาแล้ว ${formatDuration((Date.now() - s.plantedAt) / 1000)}`;
    const set = (key, v) => {
      const el = r[key];
      el.style.width = `${Math.max(0, Math.min(100, v))}%`;
      el.parentElement.classList.toggle('low', v < 25);
    };
    set('water', s.water);
    set('food', s.food);
    set('health', s.health);
    set('growth', s.growth * 100);
    r.growth.parentElement.classList.remove('low');

    // บอกสิ่งที่ต้องทำ/เวลาที่เหลือ
    const notes = [];
    if (s.water <= 0) notes.push('🚨 ดินแห้งสนิท ต้นไม้กำลังเหี่ยว — รดน้ำด่วน!');
    else if (s.water < g.thirstyBelow) notes.push('💧 ดินเริ่มแห้ง ใบเริ่มลู่แล้ว');
    else notes.push(`💧 ดินจะแห้งในอีก ${formatDuration((s.water / g.waterUse) * 3600)}`);
    if (s.food <= 0 && s.growth < 1) notes.push('🧪 ปุ๋ยหมด โตช้าลง');
    if (s.growth >= 1) {
      const wait = garden.seedsReadyIn();
      notes.push(wait > 0 ? `🌻 เก็บเมล็ดได้ในอีก ${formatDuration(wait)}` : '✨ เมล็ดแก่แล้ว เก็บได้เลย!');
    } else if (s.water > 0) {
      const rate = (s.food > 0 ? g.foodBoost : 1) * (s.health >= 50 ? 1 : 0.5);
      notes.push(`🌼 ดอกบานในอีกราว ${formatDuration(((1 - s.growth) * g.growHours * 3600) / rate)}`);
    }
    r.meta.textContent = notes.join(' · ');

    // เน้นเฉพาะปุ่มที่ต้นไม้ต้องการจริง ๆ ตอนนี้: ดินเริ่มแห้ง / ปุ๋ยหมดระหว่างโต / เมล็ดแก่แล้ว
    const needed = { water: s.water < g.thirstyBelow, fertilize: s.food <= 0 && s.growth < 1, harvest: true };
    const hints = [];
    for (const action of ['water', 'fertilize', 'harvest']) {
      const block = garden.blockOf(action);
      const btn = r[`${action}Btn`];
      btn.disabled = !!block;
      btn.classList.toggle('ready', !block && needed[action]);
      if (block && block !== 'not-ready') hints.push(garden.blockText(block));
    }
    r.hint.textContent = hints[0] ?? '';
  }
}
