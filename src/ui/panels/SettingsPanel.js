import { Panel } from '../Panel.js';

const QUALITY_LABEL = { high: 'สูง', medium: 'กลาง', low: 'ต่ำ' };

/** ตั้งค่า: เสียง คุณภาพกราฟิก กล้อง และเริ่มเกมใหม่ */
export class SettingsPanel extends Panel {
  constructor(ui) {
    super(ui, { title: '⚙️ ตั้งค่า', className: 'panel-settings' });
    this.confirmReset = false;
  }

  onOpen() {
    this.confirmReset = false;
  }

  render() {
    const s = this.game.settings;
    this.body.innerHTML = `
      <div class="settings">
        <label class="setting-row">
          <span>🔊 เสียงเอฟเฟกต์</span>
          <input type="checkbox" data-setting="sound" ${s.sound ? 'checked' : ''}><i class="switch"></i>
        </label>
        <label class="setting-row">
          <span>🌊 เสียงน้ำบรรยากาศ</span>
          <input type="checkbox" data-setting="ambient" ${s.ambient ? 'checked' : ''}><i class="switch"></i>
        </label>
        <div class="setting-row">
          <span>✨ คุณภาพกราฟิก</span>
          <div class="segmented">
            ${Object.keys(QUALITY_LABEL).map((q) => `<button class="${s.quality === q ? 'active' : ''}" data-action="quality" data-q="${q}">${QUALITY_LABEL[q]}</button>`).join('')}
          </div>
        </div>
        <div class="setting-row">
          <span>🎥 มุมกล้อง</span>
          <button class="btn" data-action="camera">กลับมุมมองเริ่มต้น</button>
        </div>
        <div class="setting-row danger">
          <span>🗑️ เริ่มเกมใหม่ทั้งหมด</span>
          <button class="btn-danger" data-action="reset">${this.confirmReset ? 'กดอีกครั้งเพื่อยืนยัน' : 'ลบเซฟ'}</button>
        </div>
        <p class="hint">ความคืบหน้าบันทึกอัตโนมัติในเบราว์เซอร์นี้ · ลากเพื่อหมุนกล้อง · ล้อเมาส์/สองนิ้วเพื่อซูม</p>
      </div>`;
  }

  onChange(e) {
    const key = e.target.dataset.setting;
    if (!key) return;
    this.game.settings[key] = e.target.checked;
    if (key === 'ambient') this.game.sound.updateAmbient();
    this.game.sound.play('click');
    this.game.state.save();
  }

  onAction(action, el) {
    const game = this.game;
    if (action === 'quality') {
      game.settings.quality = el.dataset.q;
      game.sceneMgr.applyQuality(el.dataset.q);
      game.reloadTankVisuals();
      game.state.save();
      this.render();
    } else if (action === 'camera') {
      game.sceneMgr.flyTo(game.sceneMgr.home.position, game.sceneMgr.home.target);
      this.ui.closeAll();
    } else if (action === 'reset') {
      if (!this.confirmReset) {
        this.confirmReset = true;
        this.render();
        return;
      }
      game.resetGame();
    }
  }
}
