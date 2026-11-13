import { Panel } from '../Panel.js';
import { CONFIG } from '../../config.js';
import { COW_BREEDS, getCowBreed } from '../../data/animals.js';
import { breedNow, canBreed, dueAt, grownAt, isBull, isCalf, isCowDead, isPregnant, milkValue } from '../../shared/farm.js';
import { escapeHtml, formatDuration } from '../../utils/math.js';
import { priceHtml } from '../helpers.js';

/**
 * หน้าต่างฟาร์มวัว (ปุ่ม 🐄 วัว นอกบ้าน): ซื้อวัว (บราห์มันเลือก ♀ ตัวเมีย / ♂ ตัวผู้ · พันธุ์อื่นตัวเมียเสมอ) + รายการวัวในคอกพร้อมปุ่มดูแลด่วน
 * (ให้ฟาง · รีดนม · ผสมพันธุ์ · คลอดลูกเมื่อครบกำหนด) · แสดงเพศ การตั้งท้อง และเวลาคลอด
 */
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
            ${
              b.canBreed
                ? `<button class="btn-buy" data-action="buy" data-id="${b.id}" data-sex="f" ${block || !afford ? 'disabled' : ''} title="${block ? farm.blockText(block) : 'ซื้อตัวเมีย (ให้นม · ตั้งท้องได้)'}"><span class="gender f">♀</span> ตัวเมีย ${priceHtml(b.price)}</button>
            <button class="btn-buy" data-action="buy" data-id="${b.id}" data-sex="m" ${block || !afford ? 'disabled' : ''} title="${block ? farm.blockText(block) : 'ซื้อตัวผู้ (พ่อพันธุ์ · ไม่ให้นม)'}"><span class="gender m">♂</span> ตัวผู้ ${priceHtml(b.price)}</button>`
                : `<button class="btn-buy" data-action="buy" data-id="${b.id}" data-sex="f" ${block || !afford ? 'disabled' : ''} title="${block ? farm.blockText(block) : ''}">ซื้อ ${priceHtml(b.price)}</button>`
            }
          </div>
        </div>`;
      })
      .join('');

    const rows = herd
      .map((c) => {
        const now = Date.now();
        const breed = breedNow(c, now) ?? getCowBreed(c.breedId);
        const dead = isCowDead(c);
        const young = isCalf(c, now);
        const bull = isBull(c);
        const sexed = canBreed(c);
        const pregnant = isPregnant(c);
        const due = pregnant && now >= dueAt(c);
        const growth = young
          ? `🍼 โตในอีก ${Math.ceil((grownAt(c) - now) / 3_600_000)} ชม.`
          : bull
            ? '♂ พ่อพันธุ์'
            : `🥛 นม ${Math.round(c.milk)}%`;
        const status = dead
          ? '<small class="effects warn">🪦 ตายแล้ว — นำออกได้ที่การ์ดวัว</small>'
          : `<small class="effects ${c.satiety < f.hungryBelow ? 'warn' : ''}">🌾 อิ่ม ${Math.round(c.satiety)}% · ❤️ ${Math.round(c.health)}% · ${growth}</small>`;
        const preg = dead || !pregnant
          ? ''
          : `<small class="effects due">${due ? '🍼 พร้อมคลอดแล้ว!' : `🤰 ตั้งท้อง — คลอดในอีก ${formatDuration((dueAt(c) - now) / 1000)}`}</small>`;
        const feedBlock = dead || farm.blockOf('feed', c.id) || !state.canAfford(f.hayPrice);
        const milkBlock = dead || farm.blockOf('milk', c.id);
        // ผสมพันธุ์ด่วน: แม่วัวโตแล้วที่ไม่ได้ท้อง (ทำไม่ได้ = ปุ่มจาง + เหตุผลใน title)
        const breedBlock = dead || bull || young || pregnant || !sexed ? 'skip' : farm.breedBlockOf(c.id);
        const breedBtn =
          breedBlock === 'skip'
            ? ''
            : `<button class="btn" data-action="breed" data-id="${c.id}" ${breedBlock ? 'disabled' : ''} title="${breedBlock ? farm.blockText(breedBlock, 'breed') : 'ผสมกับพ่อพันธุ์ตัวที่ใกล้ที่สุด'}">💕 ผสม</button>`;
        const birthBtn = due && !dead ? `<button class="btn btn-active" data-action="birth" data-id="${c.id}">🍼 คลอดลูก</button>` : '';
        return `
        <div class="list-row">
          <span class="row-icon">${dead ? '🪦' : c.satiety < f.hungryBelow ? '😟' : due ? '🍼' : bull ? '🐂' : '🐄'}</span>
          <div class="info">
            <b>${escapeHtml(c.name)}${sexed ? ` <span class="gender ${bull ? 'm' : 'f'}">${bull ? '♂' : '♀'}</span>` : ''}</b> <small>${breed?.name ?? ''}</small>
            ${status}
            ${preg}
          </div>
          <div class="row-actions">
            <button class="btn" data-action="view" data-id="${c.id}">ดู</button>
            ${dead ? '' : `<button class="btn ${feedBlock ? '' : 'btn-active'}" data-action="feed" data-id="${c.id}" ${feedBlock ? 'disabled' : ''}>🌾 ให้ฟาง ${priceHtml(f.hayPrice)}</button>`}
            ${dead || bull ? '' : `<button class="btn" data-action="milk" data-id="${c.id}" ${milkBlock ? 'disabled' : ''}>🥛 รีด +${milkValue(c)}</button>`}
            ${breedBtn}${birthBtn}
          </div>
        </div>`;
      })
      .join('');

    const grass = farm.grass;
    const avg = grass.g.reduce((s, v) => s + v, 0) / grass.g.length;
    const bare = grass.g.filter((v) => v < 30).length;
    const canWater = grass.w.filter((v) => v < f.grass.wetAbove).length;

    this.body.innerHTML = `
      <p class="hint">วัวกินฟางแล้วผลิตนม ยิ่งอิ่มและแข็งแรงนมยิ่งออกเร็ว · รีดนมแล้วได้เหรียญ · ปล่อยให้ท้องว่างนาน ๆ วัวจะป่วยจนตาย
        (ทุกอย่างเดินตามเวลาจริง ปิดเกมไว้วัวก็ยังหิว)</p>
      <h3 class="section-title">🌱 หญ้าในคอก</h3>
      <div class="list-row">
        <span class="row-icon">${avg >= 60 ? '🌿' : avg >= 25 ? '🌱' : '🟫'}</span>
        <div class="info">
          <b>หญ้าเหลือเฉลี่ย ${Math.round(avg)}%</b>
          <small>วัวที่ยังไม่อิ่มจะเดินไปเล็มหญ้าเอง หญ้าตรงนั้นจะหายไป · เล็มหญ้าแล้วหิวช้าลงมาก ประหยัดฟาง</small>
          <small class="effects ${bare ? 'warn' : ''}">แปลงโล่ง ${bare}/${grass.g.length} · รดน้ำได้ ${canWater} แปลง — แตะพื้นในคอกเพื่อรดน้ำ (ฟรี) หญ้าจะงอกขึ้นใหม่ตอนดินชื้น</small>
        </div>
      </div>
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
        farm.buy(id, el.dataset.sex === 'm' ? 'm' : 'f');
        break;
      case 'breed':
      case 'birth':
        // สำเร็จ = ปิดหน้าต่างให้เห็นฉากในคอก (กล้องเลื่อนไปที่แม่วัวเอง)
        if (farm[action](id)) {
          this.ui.closeAll();
          return;
        }
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
