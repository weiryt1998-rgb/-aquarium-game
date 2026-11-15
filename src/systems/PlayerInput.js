/**
 * ปุ่มควบคุมตัวละครผู้เล่นในฟาร์ม
 *   คีย์บอร์ด: W A S D / ลูกศร = เดิน · Shift ค้าง = วิ่ง
 *   จอสัมผัส: จอยสติ๊กมุมซ้ายล่าง (แสดงเฉพาะอุปกรณ์จอสัมผัส ตอนอยู่นอกบ้าน — ดู .player-stick ใน main.css) · ดันสุดขอบ = วิ่ง
 * vector = { x: ขวา +, y: หน้า +, run } ขนาด 0..1
 */
const KEYS = {
  KeyW: [0, 1], ArrowUp: [0, 1],
  KeyS: [0, -1], ArrowDown: [0, -1],
  KeyA: [-1, 0], ArrowLeft: [-1, 0],
  KeyD: [1, 0], ArrowRight: [1, 0],
};
/** ดันจอยเกินสัดส่วนนี้ของรัศมี = วิ่ง */
const RUN_PUSH = 0.92;

export class PlayerInput {
  /**
   * @param {HTMLElement} uiRoot
   * @param {() => boolean} enabled เปิดรับปุ่มเมื่อไร (อยู่ฟาร์ม ไม่ได้พิมพ์ข้อความ)
   * @param {() => void} [onSwap] กด C = สลับตัวละคร
   */
  constructor(uiRoot, enabled, onSwap) {
    this.enabled = enabled;
    this.onSwap = onSwap;
    this.held = new Set();
    this.shift = false;
    this.stick = { x: 0, y: 0, active: false };

    window.addEventListener('keydown', (e) => {
      if (!this.#accept(e)) return;
      if (e.code in KEYS) {
        this.held.add(e.code);
        e.preventDefault();
      }
      if (e.key === 'Shift') this.shift = true;
      if (e.code === 'KeyC' && !e.repeat && !e.ctrlKey && !e.metaKey) this.onSwap?.();
    });
    window.addEventListener('keyup', (e) => {
      this.held.delete(e.code);
      if (e.key === 'Shift') this.shift = false;
    });
    // สลับแท็บ/หน้าต่าง = ปล่อยทุกปุ่ม (ไม่งั้นตัวละครเดินค้าง)
    window.addEventListener('blur', () => this.reset());

    this.el = document.createElement('div');
    this.el.className = 'player-stick';
    this.el.innerHTML = '<div class="player-stick-knob"></div>';
    this.knob = this.el.firstElementChild;
    uiRoot.appendChild(this.el);
    this.#bindStick();
  }

  reset() {
    this.held.clear();
    this.shift = false;
    this.#release();
  }

  #accept(e) {
    const t = e.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return false;
    return this.enabled();
  }

  /** @returns {{ x: number, y: number, run: boolean }} */
  get vector() {
    if (!this.enabled()) return { x: 0, y: 0, run: false };
    if (this.stick.active) {
      const m = Math.hypot(this.stick.x, this.stick.y);
      return { x: this.stick.x, y: this.stick.y, run: m > RUN_PUSH };
    }
    let x = 0;
    let y = 0;
    for (const code of this.held) {
      x += KEYS[code][0];
      y += KEYS[code][1];
    }
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    return { x, y, run: this.shift && m > 0 };
  }

  get active() {
    const v = this.vector;
    return Math.hypot(v.x, v.y) > 0.08;
  }

  #bindStick() {
    let id = null;
    const move = (e) => {
      const r = this.el.getBoundingClientRect();
      const rad = r.width / 2;
      let dx = (e.clientX - (r.left + rad)) / rad;
      let dy = (e.clientY - (r.top + rad)) / rad;
      const m = Math.hypot(dx, dy);
      if (m > 1) {
        dx /= m;
        dy /= m;
      }
      this.stick.x = dx;
      this.stick.y = -dy;
      this.knob.style.transform = `translate(${dx * 50}%, ${dy * 50}%)`;
    };
    this.el.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      id = e.pointerId;
      this.el.setPointerCapture(id);
      this.stick.active = true;
      this.el.classList.add('held');
      move(e);
      e.preventDefault();
      e.stopPropagation();
    });
    this.el.addEventListener('pointermove', (e) => {
      if (e.pointerId === id) move(e);
    });
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.#release();
    };
    this.el.addEventListener('pointerup', end);
    this.el.addEventListener('pointercancel', end);
    this.el.addEventListener('lostpointercapture', end);
    this.#releaseStick = () => {
      id = null;
    };
  }

  #releaseStick = () => {};

  #release() {
    this.#releaseStick();
    this.stick.x = 0;
    this.stick.y = 0;
    this.stick.active = false;
    this.el.classList.remove('held');
    this.knob.style.transform = '';
  }
}
