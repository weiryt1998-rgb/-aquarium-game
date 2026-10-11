import { collectRefs } from './helpers.js';
import { formatDuration, formatNumber } from '../utils/math.js';

/** หน้าจอเริ่มเกม: โหลดโมเดล → ปุ่มเริ่มเล่น (ต้องคลิกเพื่อเปิดเสียงได้) */
export class StartScreen {
  constructor(ui, root) {
    this.ui = ui;
    this.root = root;
    this.offline = null;
    root.innerHTML = `
      <div class="start-inner">
        <div class="logo">
          <span class="logo-fish">🐠</span>
          <h1>เกมเลี้ยงปลาในตู้ปลา</h1>
        </div>
        <p class="subtitle">เลี้ยงปลา ตกแต่งตู้ ดูแลให้พวกมันมีความสุข</p>
        <div class="loading" data-ref="loading">
          <div class="bar"><i data-ref="progress"></i></div>
          <small data-ref="status">กำลังโหลดโมเดล...</small>
        </div>
        <p class="welcome hidden" data-ref="welcome"></p>
        <button class="btn-start hidden" data-ref="startBtn">▶ เริ่มเล่น</button>
        <p class="credit">สร้างด้วย Three.js + WebGL · เล่นผ่านเว็บเบราว์เซอร์</p>
      </div>`;
    this.refs = collectRefs(root);
    this.refs.startBtn.addEventListener('click', () => this.#start());
  }

  setProgress(p) {
    this.refs.progress.style.width = `${Math.round(p * 100)}%`;
  }

  /** โหลดเสร็จแล้ว แสดงปุ่มเริ่ม */
  ready(offline) {
    this.offline = offline;
    this.setProgress(1);
    this.refs.loading.classList.add('hidden');
    this.refs.startBtn.classList.remove('hidden');
    if (offline?.coins > 0) {
      this.refs.welcome.innerHTML = `ยินดีต้อนรับกลับ! ระหว่างที่คุณไม่อยู่ ${formatDuration(offline.seconds)}<br>ปลาหาเหรียญให้ได้ <b>${formatNumber(offline.coins)}</b> เหรียญ 🪙`;
      this.refs.welcome.classList.remove('hidden');
    }
    this.refs.startBtn.focus();
  }

  #start() {
    this.root.classList.add('leaving');
    setTimeout(() => this.root.remove(), 600);
    this.ui.game.begin();
  }
}
