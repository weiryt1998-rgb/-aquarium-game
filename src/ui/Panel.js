import { ICONS } from './icons.js';

/**
 * หน้าต่าง (modal) พื้นฐาน — แต่ละเมนูสืบทอดแล้วเขียน render() / onAction()
 * ปุ่มใด ๆ ที่มี data-action="xxx" จะเรียก onAction('xxx', element)
 */
export class Panel {
  constructor(ui, { title, className = '' }) {
    this.ui = ui;
    this.game = ui.game;
    this.title = title;
    this.className = className;
    this.isOpen = false;
    this.body = null;
  }

  open(options = {}) {
    this.options = options;
    const root = this.ui.modalRoot;
    root.innerHTML = `
      <div class="modal-backdrop" data-close></div>
      <section class="modal ${this.className}" role="dialog" aria-label="${this.title}">
        <header class="modal-header">
          <h2>${this.title}</h2>
          <button class="btn-close" data-close title="ปิด">${ICONS.close}</button>
        </header>
        <div class="modal-body"></div>
      </section>`;
    root.classList.add('open');
    this.body = root.querySelector('.modal-body');
    root.onclick = (e) => {
      if (e.target.closest('[data-close]')) {
        this.game.sound.play('click');
        this.ui.closeAll();
        return;
      }
      const el = e.target.closest('[data-action]');
      if (el && root.contains(el) && !el.disabled) this.onAction(el.dataset.action, el, e);
    };
    root.onchange = (e) => this.onChange?.(e);
    this.isOpen = true;
    this.onOpen?.(options);
    this.render();
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    const root = this.ui.modalRoot;
    root.classList.remove('open');
    root.innerHTML = '';
    root.onclick = null;
    root.onchange = null;
  }

  /** วาดเนื้อหาใหม่ (ให้คลาสลูก override) */
  render() {}

  /** เรียกประมาณ 4 ครั้งต่อวินาทีขณะเปิดอยู่ สำหรับอัปเดตค่าที่เปลี่ยนตลอด */
  tick() {}

  onAction() {}
}
