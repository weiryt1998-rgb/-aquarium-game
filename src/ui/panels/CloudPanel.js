import { Panel } from '../Panel.js';
import { downloadJson, fileStamp, readLegacySave } from '../../cloud/legacy.js';
import { timeText } from '../../cloud/SaveStatus.js';
import { cloudErrorText } from '../../cloud/transports.js';
import { escapeHtml, formatNumber } from '../../utils/math.js';

const STATUS_TEXT = {
  saved: '✅ บันทึกแล้ว',
  pending: '🕒 มีการเปลี่ยนแปลงรอบันทึก',
  saving: '⏳ กำลังบันทึก…',
  offline: '📴 ออฟไลน์ — ยังไม่ได้บันทึก',
  error: '⚠️ บันทึกไม่สำเร็จ กำลังลองใหม่',
  blocked: '⛔ หยุดบันทึก',
};

const REASON_TEXT = {
  daily: 'อัตโนมัติรายวัน',
  manual: 'สร้างเอง',
  'before-reset': 'ก่อนรีเซ็ต',
  'before-restore': 'ก่อนกู้คืน',
  'before-replace': 'ก่อนนำเข้าเซฟเก่า',
  'before-migration': 'ก่อนอัปเดตโครงสร้าง',
};

/** เซฟกลาง: สถานะ, บันทึกทันที, จุดสำรองบนคลาวด์ (กู้คืนได้), ไฟล์สำรองในเครื่อง, นำเข้าเซฟเก่า, ออกจากระบบ */
export class CloudPanel extends Panel {
  constructor(ui) {
    super(ui, { title: '☁️ เซฟคลาวด์', className: 'panel-cloud' });
    this.backups = null;
    this.backupError = '';
    this.confirm = null;
    this.busy = false;
  }

  onOpen() {
    this.confirm = null;
    this.backups = null;
    this.#loadBackups();
  }

  async #loadBackups() {
    try {
      this.backups = await this.game.cloud.listBackups();
      this.backupError = '';
    } catch (err) {
      this.backups = [];
      this.backupError = cloudErrorText(err);
    }
    if (this.isOpen) this.render();
  }

  render() {
    const info = this.game.cloud.info;
    const legacy = readLegacySave();
    const rows =
      this.backups === null
        ? '<p class="hint">กำลังโหลดรายการจุดสำรอง…</p>'
        : this.backups.length === 0
          ? `<p class="hint">${escapeHtml(this.backupError || 'ยังไม่มีจุดสำรอง (ระบบสร้างให้อัตโนมัติวันละครั้งเมื่อมีการบันทึก)')}</p>`
          : this.backups.map((b) => this.#backupRow(b)).join('');
    this.body.innerHTML = `
      <div class="settings">
        <div class="setting-row"><span>สถานะ</span><b data-ref="status">${STATUS_TEXT[info.status] ?? info.status}</b></div>
        <div class="setting-row"><span>บันทึกล่าสุด</span><b data-ref="last-saved">${timeText(info.lastSavedAt)} · revision ${info.revision}</b></div>
        <div class="setting-row"><span>ข้อมูลที่เห็น</span><b data-ref="freshness">${info.stale ? 'อาจไม่ล่าสุด (ออฟไลน์/รอเซิร์ฟเวอร์)' : 'ล่าสุดจากคลาวด์'}</b></div>
        <div class="setting-row"><span>การตรวจสอบ</span><b>${info.mode === 'functions' ? 'Cloud Functions ตรวจทุกการซื้อขาย' : 'Security Rules (แผนฟรี)'}</b></div>
        <div class="setting-row"><span>💾 บันทึกขึ้นคลาวด์ทันที</span><button class="btn" data-action="save-now">บันทึกตอนนี้</button></div>
        <div class="setting-row"><span>📥 ไฟล์สำรองในเครื่อง</span><button class="btn" data-action="download">ดาวน์โหลด JSON</button></div>
      </div>
      <h3 class="section-title">จุดสำรองบนคลาวด์ <small>อัตโนมัติวันละครั้ง และก่อนรีเซ็ต/กู้คืน/นำเข้า</small></h3>
      <div class="list backup-list">${rows}</div>
      <p><button class="btn" data-action="backup" ${this.busy ? 'disabled' : ''}>สร้างจุดสำรองตอนนี้</button></p>
      ${legacy ? this.#legacySection(legacy) : ''}
      <h3 class="section-title">บัญชี</h3>
      <div class="setting-row"><span>ออกจากระบบบนอุปกรณ์นี้</span><button class="btn" data-action="logout">ออกจากระบบ</button></div>
      <p class="hint">ทุกอุปกรณ์ที่ใช้รหัสผ่านเกมเดียวกันเล่นเซฟชุดนี้ร่วมกัน · การตั้งค่าเสียง/กราฟิกเป็นของแต่ละอุปกรณ์</p>`;
  }

  #backupRow(b) {
    const s = b.summary ?? {};
    const confirming = this.confirm === `restore:${b.id}`;
    return `
      <div class="list-row">
        <span class="row-icon">🗂️</span>
        <div class="info">
          <b>${escapeHtml(new Date(b.createdAt).toLocaleString('th-TH'))}</b>
          <small>${escapeHtml(REASON_TEXT[b.reason] ?? b.reason)} · revision ${b.revision} · ${formatNumber(s.coins ?? 0)} เหรียญ · ปลา ${formatNumber(s.fish ?? 0)} ตัว</small>
        </div>
        <div class="row-actions">
          <button class="btn ${confirming ? 'btn-danger' : 'btn-ghost'}" data-action="restore" data-id="${escapeHtml(b.id)}" ${this.busy ? 'disabled' : ''}>${confirming ? 'ยืนยันกู้คืน (ทุกอุปกรณ์)' : 'กู้คืน'}</button>
        </div>
      </div>`;
  }

  #legacySection(legacy) {
    const s = legacy.summary;
    const confirming = this.confirm === 'replace';
    return `
      <h3 class="section-title">เซฟเก่าในเครื่องนี้ <small>จากเกมเวอร์ชันก่อน (ยังเก็บไว้ ไม่ถูกลบ)</small></h3>
      <div class="list-row">
        <span class="row-icon">💽</span>
        <div class="info"><b>${formatNumber(s.coins)} เหรียญ · ${formatNumber(s.gems)} เพชร</b><small>ปลา ${formatNumber(s.fish)} ตัว · ${formatNumber(s.tanks)} ตู้</small></div>
        <div class="row-actions">
          <button class="btn" data-action="download-legacy">ดาวน์โหลด</button>
          <button class="btn ${confirming ? 'btn-danger' : 'btn-ghost'}" data-action="replace" ${this.busy ? 'disabled' : ''}>${confirming ? 'ยืนยันแทนที่เซฟกลาง' : 'แทนที่เซฟกลางด้วยเซฟนี้'}</button>
        </div>
      </div>`;
  }

  async #run(label, fn) {
    this.busy = true;
    this.render();
    this.ui.toast(label);
    try {
      return await fn();
    } catch (err) {
      this.ui.toast(`ไม่สำเร็จ: ${cloudErrorText(err)}`, 'warn');
      return null;
    } finally {
      this.busy = false;
      if (this.isOpen) this.render();
    }
  }

  async onAction(action, el) {
    if (this.busy) return;
    const cloud = this.game.cloud;
    this.game.sound.play('click');
    switch (action) {
      case 'save-now':
        this.game.state.save({ urgent: true });
        this.ui.toast('กำลังบันทึกขึ้นคลาวด์…');
        break;
      case 'download':
        downloadJson(`aquarium-cloud-save-${fileStamp()}.json`, { exportedAt: new Date().toISOString(), revision: cloud.doc.revision, game: this.game.state.data });
        break;
      case 'download-legacy': {
        const legacy = readLegacySave();
        if (legacy) downloadJson(`aquarium-local-save-${fileStamp()}.json`, legacy.data);
        break;
      }
      case 'backup':
        if (await this.#run('กำลังสร้างจุดสำรอง…', () => cloud.createBackup()) !== null) {
          this.ui.toast('✅ สร้างจุดสำรองแล้ว', 'success');
          this.#loadBackups();
        }
        break;
      case 'restore': {
        const key = `restore:${el.dataset.id}`;
        if (this.confirm !== key) {
          this.confirm = key;
          this.render();
          return;
        }
        this.confirm = null;
        const res = await this.#run('กำลังสำรองข้อมูลปัจจุบันและกู้คืน…', () => cloud.restoreBackup(el.dataset.id));
        if (res) {
          this.game.resetting = true;
          location.reload();
        }
        break;
      }
      case 'replace': {
        if (this.confirm !== 'replace') {
          this.confirm = 'replace';
          this.render();
          return;
        }
        this.confirm = null;
        const legacy = readLegacySave();
        if (!legacy) return;
        const res = await this.#run('กำลังสำรองเซฟกลางและแทนที่…', () => cloud.replaceWithLegacy(legacy.data));
        if (res) {
          this.game.resetting = true;
          location.reload();
        }
        break;
      }
      case 'logout':
        this.game.state.save({ urgent: true });
        await cloud.signOut?.();
        location.reload();
        break;
      default:
        break;
    }
  }

  tick() {
    const info = this.game.cloud.info;
    const el = this.body?.querySelector('[data-ref="status"]');
    if (el) el.textContent = STATUS_TEXT[info.status] ?? '';
    const saved = this.body?.querySelector('[data-ref="last-saved"]');
    if (saved) saved.textContent = `${timeText(info.lastSavedAt)} · revision ${info.revision}`;
    const freshness = this.body?.querySelector('[data-ref="freshness"]');
    if (freshness) freshness.textContent = info.stale ? 'อาจไม่ล่าสุด (ออฟไลน์/รอเซิร์ฟเวอร์)' : 'ล่าสุดจากคลาวด์';
  }
}
