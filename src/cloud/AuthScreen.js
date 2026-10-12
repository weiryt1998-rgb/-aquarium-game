import { collectRefs } from '../ui/helpers.js';
import { escapeHtml } from '../utils/math.js';

const BUTTON_CLASS = { primary: 'btn-start auth-primary', secondary: 'btn auth-secondary', danger: 'btn-danger auth-secondary' };

/**
 * หน้าจอก่อนเข้าเกม: เข้าสู่ระบบด้วยรหัสผ่านเกม, โหลดเซฟกลาง, สร้าง/นำเข้าเซฟครั้งแรก, แจ้งข้อผิดพลาด
 * หน้าตาเดียวกับหน้าเริ่มเกมเดิม (ใช้คลาส start-screen)
 */
export class AuthScreen {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <div class="start-screen auth-screen">
        <div class="start-inner">
          <div class="logo">
            <span class="logo-fish">🐠</span>
            <h1>เกมเลี้ยงปลาในตู้ปลา</h1>
          </div>
          <p class="subtitle">เซฟกลางบนคลาวด์ · เล่นต่อได้ทุกอุปกรณ์</p>
          <div class="auth-body" data-ref="body"></div>
          <p class="credit">สร้างด้วย Three.js + WebGL · เล่นผ่านเว็บเบราว์เซอร์</p>
        </div>
      </div>`;
    this.body = root.querySelector('[data-ref="body"]');
  }

  #render(html) {
    this.body.innerHTML = html;
    return collectRefs(this.body);
  }

  /** แสดงข้อความระหว่างรอ */
  busy(text) {
    this.#render(`<div class="loading auth-busy" data-state="busy"><div class="bar indeterminate"><i></i></div><small>${escapeHtml(text)}</small></div>`);
  }

  /**
   * ช่องกรอกรหัสผ่านเกม → resolve เป็นรหัสที่กรอก (ไม่เก็บไว้ที่ใดเลย)
   * error: ผลจาก authErrorInfo() ของรอบก่อน { kind, code, text, hint } หรือ null
   */
  askPassword({ error = null, email = '' } = {}) {
    const refs = this.#render(`
      <form class="auth-form" data-ref="form" data-state="login" novalidate>
        <input type="email" name="username" autocomplete="username" value="${escapeHtml(email)}" readonly hidden>
        <label class="auth-label" for="game-password">รหัสผ่านเกม</label>
        <div class="auth-password">
          <input id="game-password" class="auth-input" type="password" name="password" autocomplete="current-password" data-ref="input" required>
          <button type="button" class="auth-reveal" data-ref="reveal" aria-label="แสดงรหัสผ่าน" aria-pressed="false" title="แสดง/ซ่อนรหัสผ่าน">👁</button>
        </div>
        <p class="auth-warn" data-ref="warn" hidden></p>
        <div class="auth-msg ${error ? 'error' : ''}" data-ref="msg" role="alert" ${error ? `data-kind="${escapeHtml(error.kind)}"` : ''}>${
          error
            ? `<span>${escapeHtml(error.text)}</span>${error.hint ? `<small class="auth-hint">${escapeHtml(error.hint)}</small>` : ''}<small class="auth-code">รหัสข้อผิดพลาด: ${escapeHtml(error.code)}</small>`
            : ''
        }</div>
        <button class="btn-start" type="submit" data-ref="submit">เข้าสู่เกม</button>
        <p class="auth-note">ผู้เล่นทุกคนใช้รหัสผ่านเดียวกัน และเล่นเซฟกลางชุดเดียวกัน</p>
      </form>`);
    refs.input.focus();

    // ตัวช่วยพิมพ์รหัส: แสดง/ซ่อน, เตือนแป้นพิมพ์ภาษาไทย และ Caps Lock (ตรวจในเครื่องเท่านั้น ไม่ส่งไปที่ใด)
    refs.reveal.addEventListener('click', () => {
      const show = refs.input.type === 'password';
      refs.input.type = show ? 'text' : 'password';
      refs.reveal.setAttribute('aria-pressed', String(show));
      refs.reveal.setAttribute('aria-label', show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน');
      refs.input.focus();
    });
    let capsLock = false;
    const updateWarn = () => {
      const notes = [];
      if (/[฀-๿]/.test(refs.input.value)) notes.push('รหัสที่พิมพ์มีตัวอักษรภาษาไทย — แป้นพิมพ์อาจเป็นภาษาไทยอยู่');
      if (capsLock) notes.push('Caps Lock เปิดอยู่');
      refs.warn.textContent = notes.join(' · ');
      refs.warn.hidden = notes.length === 0;
    };
    const readCaps = (e) => {
      if (typeof e.getModifierState === 'function') capsLock = e.getModifierState('CapsLock');
      updateWarn();
    };
    refs.input.addEventListener('input', updateWarn);
    refs.input.addEventListener('keydown', readCaps);
    refs.input.addEventListener('keyup', readCaps);

    return new Promise((resolve) => {
      refs.form.addEventListener('submit', (e) => {
        e.preventDefault();
        const value = refs.input.value;
        if (!value) {
          refs.msg.textContent = 'กรุณากรอกรหัสผ่าน';
          refs.msg.classList.add('error');
          return;
        }
        refs.input.value = '';
        refs.input.type = 'password';
        refs.submit.disabled = true;
        resolve(value);
      });
    });
  }

  /**
   * กล่องข้อความพร้อมปุ่มเลือก → resolve เป็น id ของปุ่มที่กด
   * body เป็น HTML ที่โค้ดนี้สร้างเอง (ข้อมูลจากภายนอกต้อง escape ก่อนส่งเข้ามา)
   */
  choose({ title, body = '', actions, state = 'choose' }) {
    const refs = this.#render(`
      <div class="auth-card" data-state="${state}">
        <h2>${escapeHtml(title)}</h2>
        <div class="auth-text">${body}</div>
        ${actions.length ? `<div class="auth-actions">${actions.map((a) => `<button type="button" class="${BUTTON_CLASS[a.kind ?? 'secondary']}" data-choice="${a.id}">${escapeHtml(a.label)}</button>`).join('')}</div>` : ''}
      </div>`);
    return new Promise((resolve) => {
      this.body.querySelectorAll('[data-choice]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.body.querySelectorAll('[data-choice]').forEach((b) => (b.disabled = true));
          resolve(btn.dataset.choice);
        }),
      );
      refs.body?.focus?.();
    });
  }

  /** ยืนยันการกระทำที่ทับข้อมูล: ต้องพิมพ์คำยืนยันให้ตรง → resolve true/false */
  confirmTyped({ title, body, word, confirmLabel }) {
    const refs = this.#render(`
      <form class="auth-card" data-ref="form" data-state="confirm" novalidate>
        <h2>${escapeHtml(title)}</h2>
        <div class="auth-text">${body}</div>
        <label class="auth-label" for="confirm-word">พิมพ์ <b>${escapeHtml(word)}</b> เพื่อยืนยัน</label>
        <input id="confirm-word" class="auth-input" autocomplete="off" data-ref="input">
        <div class="auth-actions">
          <button type="submit" class="btn-danger auth-secondary" data-ref="ok" disabled>${escapeHtml(confirmLabel)}</button>
          <button type="button" class="btn auth-secondary" data-ref="cancel">ยกเลิก</button>
        </div>
      </form>`);
    refs.input.focus();
    refs.input.addEventListener('input', () => (refs.ok.disabled = refs.input.value.trim() !== word));
    return new Promise((resolve) => {
      refs.form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (refs.input.value.trim() === word) resolve(true);
      });
      refs.cancel.addEventListener('click', () => resolve(false));
    });
  }
}
