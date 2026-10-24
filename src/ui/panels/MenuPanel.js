import { Panel } from '../Panel.js';
import { AVAILABLE_SPECIES } from '../../data/fish.js';
import { MODEL_CREDITS } from '../../data/credits.js';
import { CONFIG } from '../../config.js';
import { formatDuration } from '../../utils/math.js';

/** เมนูหลัก (ปุ่ม ☰ มุมขวาบน) */
export class MenuPanel extends Panel {
  constructor(ui) {
    super(ui, { title: '☰ เมนู', className: 'panel-menu' });
  }

  render() {
    const game = this.game;
    const claimable = game.missions.claimableCount;
    const tanks = game.state.data.tanks.length;
    this.body.innerHTML = `
      <div class="menu-grid">
        <button data-action="go" data-panel="shop" data-tab="tanks"><span>🏠</span><b>ตู้ของฉัน</b><small>มี ${tanks} ตู้ · สลับ/ปลดล็อก</small></button>
        <button data-action="go" data-panel="missions"><span>🎯</span><b>ภารกิจ</b><small>${claimable > 0 ? `มีรางวัลรอรับ ${claimable}` : 'ทำภารกิจรับเหรียญ'}</small>${claimable > 0 ? '<i class="badge show"></i>' : ''}</button>
        <button data-action="go" data-panel="fish" data-tab="collection"><span>📘</span><b>สมุดสะสม</b><small>${game.state.collectionCount}/${AVAILABLE_SPECIES.length} สายพันธุ์</small></button>
        <button data-action="go" data-panel="help"><span>❓</span><b>วิธีเล่น</b><small>เริ่มต้นเลี้ยงปลา</small></button>
        <button data-action="go" data-panel="settings"><span>⚙️</span><b>ตั้งค่า</b><small>เสียง · กราฟิก</small></button>
        ${game.cloud ? '<button data-action="go" data-panel="cloud"><span>☁️</span><b>เซฟคลาวด์</b><small>สำรอง · กู้คืน · ออกจากระบบ</small></button>' : ''}
      </div>`;
  }

  onAction(action, el) {
    if (action !== 'go') return;
    this.game.sound.play('click');
    this.ui.open(el.dataset.panel, { tab: el.dataset.tab });
  }
}

export class HelpPanel extends Panel {
  constructor(ui) {
    super(ui, { title: '❓ วิธีเล่น', className: 'panel-help' });
  }

  render() {
    this.body.innerHTML = `
      <ol class="help-list">
        <li><b>🥣 ให้อาหาร</b> — กดปุ่มขวาล่าง (หรือปุ่ม F) ปลาจะว่ายมากิน แต่ถ้าให้มากไป อาหารที่เหลือจะเน่าทำให้น้ำสกปรก</li>
        <li><b>💧 รักษาความสะอาด</b> — น้ำจะค่อย ๆ ขุ่นตามจำนวนปลา กดปุ่ม 🧽 ข้างแถบความสะอาดเพื่อทำความสะอาด พืชน้ำและหัวทรายช่วยให้น้ำสกปรกช้าลง</li>
        <li><b>😊 ความสุข</b> — ปลาที่อิ่ม สุขภาพดี น้ำสะอาด และมีของตกแต่งเยอะ จะมีความสุข และผลิต <b>เหรียญ</b> ลอยขึ้นมา แตะเพื่อเก็บ</li>
        <li><b>🐣 เติบโตและออกลูก</b> — ปลาทุกชนิดออกลูกเป็นตัวแบบปลาสอด เลือกเพศได้ตอนซื้อปลา ถ้าในตู้มีตัวผู้ ♂ และตัวเมีย ♀ สายพันธุ์เดียวกันที่โตเต็มวัย สุขภาพดี และมีความสุข ตัวผู้จะว่ายตามเกี้ยวพาราสี 💞 แล้วตัวเมียตั้งท้อง 🤰 (ท้องค่อย ๆ ป่อง) ${formatDuration(CONFIG.breeding.gestation)} ก่อนคลอดลูกครั้งละ 1 ตัว จากนั้นพักฟื้น ${formatDuration(CONFIG.breeding.rest)} — ลูกปลาได้สีและลายจากพ่อแม่ (ลูกปลาสอดเกิดมาตัวสีเข้ม จะเผยสีจริงเมื่อโตขึ้น 🎨 ลุ้นกันเลย) ต้องมีที่ว่างในตู้ (ออกลูกได้จนเต็มความจุตู้)</li>
        <li><b>🧬 ปลาสอดลูกผสม</b> — ปลาสอดต่างสีผสมกันได้ ลูกจะได้สีและลายผสมจากพ่อแม่ (บางตัวกลายพันธุ์ได้สีใหม่) ไม่มีตัวไหนเหมือนกัน และผสมต่อได้อีกหลายรุ่น</li>
        <li><b>🪴 ตกแต่งตู้</b> — กดปุ่ม "ตกแต่ง" เลือกของแล้วแตะพื้นทรายเพื่อวาง ลากเพื่อย้าย กด R เพื่อหมุน (คลิกขวาลาก = หมุนกล้อง)</li>
        <li><b>🏪 ร้านค้า</b> — ซื้อปลาใหม่ สะสมให้ครบทุกสายพันธุ์ และปลดล็อกตู้ที่ใหญ่ขึ้นเพื่อเลี้ยงปลาหายาก</li>
        <li><b>🎯 ภารกิจ</b> — กดปุ่ม + ข้างเพชร ทำภารกิจรายวันและรับรางวัลประจำวัน</li>
        <li><b>💎 แลกเพชร</b> — แตะตัวเลขเพชรมุมซ้ายบน (หรือร้านค้า → แลกเพชร) ใช้ 2,000 เหรียญแลกได้ 1 เพชร</li>
        <li><b>📷 ถ่ายภาพ</b> — ปุ่มกล้องมุมขวาบนบันทึกภาพตู้ปลาของคุณ แตะปลาเพื่อดูข้อมูลและตั้งชื่อ</li>
      </ol>
      ${this.#credits()}`;
  }

  /** เครดิตโมเดล 3 มิติที่ใช้อยู่จริง (CC-BY ต้องแสดงชื่อผู้สร้าง) */
  #credits() {
    const used = MODEL_CREDITS.filter((c) => this.game.assets.exists(c.file));
    if (used.length === 0) return '';
    const rows = used
      .map(
        (c) => `<li>${c.usedAs}: <a href="${c.source}" target="_blank" rel="noopener">"${c.title}"</a>
          โดย <a href="${c.authorUrl}" target="_blank" rel="noopener">${c.author}</a>
          · <a href="${c.licenseUrl}" target="_blank" rel="noopener">${c.license}</a></li>`,
      )
      .join('');
    return `<h3 class="section-title">เครดิตโมเดล 3 มิติ</h3><ul class="credit-list">${rows}</ul>`;
  }
}
