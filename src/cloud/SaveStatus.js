import { escapeHtml } from '../utils/math.js';

const LABEL = {
  saved: ['☁️', 'บันทึกแล้ว'],
  pending: ['☁️', 'รอบันทึก'],
  saving: ['⏳', 'กำลังบันทึก…'],
  offline: ['📴', 'ออฟไลน์ · ยังไม่ได้บันทึก'],
  error: ['⚠️', 'บันทึกไม่สำเร็จ · กำลังลองใหม่'],
  blocked: ['⛔', 'หยุดบันทึก'],
};

const BLOCKED = {
  epoch: { title: 'เซฟกลางถูกรีเซ็ตหรือกู้คืนจากอุปกรณ์อื่น', text: 'ต้องโหลดเกมใหม่เพื่อเล่นต่อจากข้อมูลชุดล่าสุด', action: 'reload', label: 'โหลดเกมใหม่' },
  'no-save': { title: 'ไม่พบเซฟกลางบนคลาวด์', text: 'เซฟกลางอาจถูกลบโดยผู้ดูแล — โหลดหน้าใหม่เพื่อตรวจสอบ', action: 'reload', label: 'โหลดใหม่' },
  auth: { title: 'สิทธิ์การเข้าถึงหมดอายุ', text: 'อาจมีการเปลี่ยนรหัสผ่านเกมหรือถอนสิทธิ์ การเปลี่ยนแปลงที่ยังไม่บันทึกถูกเก็บไว้ในเครื่อง และจะถูกส่งหลังเข้าสู่ระบบใหม่', action: 'relogin', label: 'เข้าสู่ระบบใหม่' },
  schema: { title: 'มีเกมเวอร์ชันใหม่', text: 'เซฟกลางถูกอัปเดตโดยเกมเวอร์ชันใหม่กว่า กรุณารีเฟรชเพื่อใช้เวอร์ชันล่าสุด', action: 'reload', label: 'รีเฟรช' },
};

export const timeText = (ms) => (ms ? new Date(ms).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '-');

/** ป้ายสถานะเซฟกลางบน HUD + แจ้งเตือนจากระบบเซฟ (บันทึกไม่ผ่าน, ข้อมูลเปลี่ยนจากอุปกรณ์อื่น ฯลฯ) */
export class SaveStatus {
  constructor(ui, el, cloud) {
    this.ui = ui;
    this.el = el;
    this.cloud = cloud;
    el.addEventListener('click', () => ui.open('cloud'));
    cloud.on((e) => this.#onEvent(e));
    this.render(cloud.info);
    setInterval(() => this.render(cloud.info), 30_000);
  }

  #onEvent(e) {
    switch (e.type) {
      case 'status':
        this.render(e.info);
        break;
      case 'rejected':
        this.ui.toast(`⚠️ ${e.text} — ปรับข้อมูลให้ตรงกับเซฟกลางแล้ว`, 'warn');
        break;
      case 'remote':
        this.ui.toast('🔄 มีการเปลี่ยนแปลงจากอุปกรณ์อื่น — อัปเดตเป็นข้อมูลล่าสุดแล้ว');
        break;
      case 'orphans':
        this.ui.toast(`☁️ บันทึกการกระทำที่ค้างจากครั้งก่อนแล้ว ${e.count} รายการ${e.rejected ? ` (ไม่ผ่านการตรวจ ${e.rejected})` : ''}`);
        break;
      case 'coins-capped':
        this.ui.toast(`🪙 เหรียญ ${e.amount} เหรียญไม่ถูกนับ เพราะเกินอัตราที่ปลาผลิตได้จริง (เช่น เปิดตู้เดียวกันหลายเครื่อง)`, 'warn');
        break;
      case 'blocked':
        this.#showBlocked(e.reason);
        break;
      default:
        break;
    }
  }

  render(info) {
    const [icon, label] = LABEL[info.status] ?? LABEL.pending;
    const extra = info.status === 'saved' && info.lastSavedAt ? ` ${timeText(info.lastSavedAt)}` : info.pending && info.status !== 'saved' ? ` (${info.pending})` : '';
    this.el.innerHTML = `<span class="ss-icon">${icon}</span><span class="ss-text">${escapeHtml(label + extra)}</span>${info.stale && info.status !== 'offline' ? '<i class="ss-stale" title="ข้อมูลอาจไม่ล่าสุด"></i>' : ''}`;
    this.el.dataset.status = info.status;
    this.el.title = [`เซฟกลาง revision ${info.revision}`, `บันทึกล่าสุด ${timeText(info.lastSavedAt)}`, info.stale ? 'ข้อมูลที่เห็นอาจไม่ใช่ล่าสุด (ออฟไลน์/รอเซิร์ฟเวอร์)' : 'ข้อมูลล่าสุดจากคลาวด์', info.error ? `ข้อผิดพลาดล่าสุด: ${info.error.code}` : '']
      .filter(Boolean)
      .join('\n');
  }

  #showBlocked(reason) {
    const b = BLOCKED[reason];
    if (!b || this.ui.root.querySelector('.cloud-block')) return;
    const el = document.createElement('div');
    el.className = 'cloud-block';
    el.dataset.reason = reason;
    el.innerHTML = `<div class="cloud-block-card" role="alertdialog"><h2>${escapeHtml(b.title)}</h2><p>${escapeHtml(b.text)}</p><button class="btn-start" data-action="${b.action}">${escapeHtml(b.label)}</button></div>`;
    el.querySelector('button').addEventListener('click', async () => {
      if (b.action === 'relogin') await this.cloud.signOut?.().catch(() => {});
      location.reload();
    });
    this.ui.root.appendChild(el);
  }
}
