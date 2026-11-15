/**
 * เมนูวงกลมเลือกบทสนทนา (แตะตัวละครอีกคน / ตาเหม ในฟาร์ม)
 *   ชั้นแรก = หมวด (ทั่วไป ขำ ๆ หวาน ๆ เรื่องฟาร์ม งอน/ทะเลาะ) + ปุ่มพิเศษ (สลับไปเล่นตัวนี้)
 *   ชั้นที่สอง = การกระทำในหมวด (ที่ยังไม่ปลดล็อกแสดงเป็นสีจาง พร้อมเหตุผล) · แตะกลางวง = ย้อนกลับ
 * กลางวงแสดงชื่อ ระดับความสัมพันธ์ แถบความสนิท/ความรัก และอารมณ์ตอนนี้
 */
export class SocialMenu {
  /** @param {HTMLElement} root ชั้น UI (#ui) */
  constructor(root) {
    this.backdrop = document.createElement('div');
    this.backdrop.className = 'social-backdrop hidden';
    this.el = document.createElement('div');
    this.el.className = 'social-menu hidden';
    this.el.setAttribute('role', 'menu');
    root.append(this.backdrop, this.el);
    this.model = null;
    this.cat = null;
    this.backdrop.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.close();
    });
    this.el.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-id]');
      if (!btn) return;
      e.stopPropagation();
      const id = btn.dataset.id;
      if (id === '__back') {
        this.cat = null;
        this.#render();
        return;
      }
      if (btn.dataset.cat) {
        this.cat = id;
        this.#render();
        return;
      }
      if (btn.classList.contains('locked')) {
        this.model.onLocked?.(btn.dataset.reason);
        return;
      }
      const pick = this.model.onPick;
      this.close();
      pick?.(id);
    });
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.isOpen) this.close();
    });
  }

  get isOpen() {
    return !!this.model;
  }

  /**
   * @param {{ x: number, y: number, icon: string, title: string, level: string, mood: { icon: string, label: string } | null,
   *   bars: { label: string, value: number, kind: 'friend' | 'love' }[],
   *   categories: { id: string, icon: string, label: string, items: { id: string, icon: string, label: string, locked?: boolean, reason?: string }[] }[],
   *   extras: { id: string, icon: string, label: string }[], onPick: (id: string) => void, onLocked?: (reason: string) => void, onClose?: () => void }} model
   */
  open(model) {
    this.model = model;
    this.cat = null;
    this.backdrop.classList.remove('hidden');
    this.el.classList.remove('hidden');
    this.el.parentElement.classList.add('social-open');
    this.#render();
  }

  close() {
    if (!this.model) return;
    const cb = this.model.onClose;
    this.model = null;
    this.backdrop.classList.add('hidden');
    this.el.classList.add('hidden');
    this.el.parentElement.classList.remove('social-open');
    cb?.();
  }

  #render() {
    const m = this.model;
    const cat = this.cat ? m.categories.find((c) => c.id === this.cat) : null;
    const items = cat
      ? cat.items.map((it) => ({ ...it, kind: 'item' }))
      : [...m.categories.map((c) => ({ id: c.id, icon: c.icon, label: c.label, kind: 'cat' })), ...m.extras.map((x) => ({ ...x, kind: 'extra' }))];
    const esc = (t) => String(t).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
    const ring = items
      .map((it, i) => {
        const cls = ['sm-item', `sm-${it.kind}`, it.locked ? 'locked' : ''].join(' ');
        return `<button class="${cls}" role="menuitem" data-id="${esc(it.id)}" ${it.kind === 'cat' ? 'data-cat="1"' : ''} ${it.reason ? `data-reason="${esc(it.reason)}" title="${esc(it.reason)}"` : ''}
          style="--i:${i}"><span class="sm-ico">${it.icon}</span><span class="sm-label">${esc(it.label)}</span>${it.locked ? '<span class="sm-lock">🔒</span>' : ''}</button>`;
      })
      .join('');
    const bars = m.bars
      .map((b) => `<div class="sm-bar ${b.kind}"><span>${b.kind === 'love' ? '❤️' : '💛'}</span><i style="--v:${Math.round(b.value * 100)}%"></i><em>${esc(b.label)}</em></div>`)
      .join('');
    const center = cat
      ? `<button class="sm-center sm-back" data-id="__back" title="ย้อนกลับ"><span class="sm-big">${cat.icon}</span><b>${esc(cat.label)}</b><small>⬅ ย้อนกลับ</small></button>`
      : `<div class="sm-center"><span class="sm-big">${m.icon}</span><b>${esc(m.title)}</b>${m.level ? `<small>${esc(m.level)}</small>` : ''}${bars}${
          m.mood ? `<small class="sm-mood">${m.mood.icon} ${esc(m.mood.label)}</small>` : ''
        }</div>`;
    this.el.innerHTML = center + ring;
    this.#layout();
  }

  /**
   * วางปุ่มเป็นวงรีรอบกล่องกลาง ตามขนาดจริงของแต่ละปุ่ม (ปุ่มยาว/สั้นไม่ทับกล่องกลาง) แล้วเลื่อนทั้งวงให้อยู่ในจอ
   * และไม่ทับแถบปุ่มซ้าย/ปุ่มมุมบน (วัดขนาดด้วย offsetWidth — ไม่ถูกแอนิเมชันย่อ/ขยายรบกวน)
   */
  #layout() {
    const m = this.model;
    const box = this.el.querySelector('.sm-center');
    const btns = [...this.el.querySelectorAll('.sm-item')];
    const cw = box.offsetWidth / 2;
    const ch = box.offsetHeight / 2;
    const gap = 10;
    const n = btns.length;
    const pos = btns.map((b, i) => {
      const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
      const bw = b.offsetWidth / 2;
      const bh = b.offsetHeight / 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      // ระยะจากกลางที่ปุ่มพ้นกล่องกลาง (เทียบตามทิศ) + ไม่ชิดกันเกินไปตามจำนวนปุ่ม
      const rx = Math.abs(c) > 1e-3 ? (cw + bw + gap) / Math.abs(c) : Infinity;
      const ry = Math.abs(sn) > 1e-3 ? (ch + bh + gap) / Math.abs(sn) : Infinity;
      const r = Math.min(rx, ry) + (n > 6 ? 14 : 4);
      return { b, x: c * r, y: sn * r, bw, bh, c, sn, r };
    });
    // ปุ่มติดกันที่ยาว (จอแคบ) ทับกันได้ → ดันคู่ที่ทับออกไปตามทิศของตัวเองทีละน้อยจนไม่ทับ
    const hit = (p, q) => Math.abs(p.x - q.x) < p.bw + q.bw + 4 && Math.abs(p.y - q.y) < p.bh + q.bh + 4;
    for (let round = 0; round < 40; round++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        const p = pos[i];
        const q = pos[(i + 1) % n];
        if (n < 2 || p === q || !hit(p, q)) continue;
        for (const t of [p, q]) {
          t.r += 6;
          t.x = t.c * t.r;
          t.y = t.sn * t.r;
        }
        moved = true;
      }
      if (!moved) break;
    }
    // ขอบเขตทั้งวง (เทียบกลาง)
    let minX = -cw;
    let maxX = cw;
    let minY = -ch;
    let maxY = ch;
    for (const p of pos) {
      minX = Math.min(minX, p.x - p.bw);
      maxX = Math.max(maxX, p.x + p.bw);
      minY = Math.min(minY, p.y - p.bh);
      maxY = Math.max(maxY, p.y + p.bh);
    }
    const W = window.innerWidth;
    const H = window.innerHeight;
    const side = document.querySelector('nav.sidebar')?.getBoundingClientRect();
    const safeL = (side && side.width ? side.right : 0) + 8;
    const safeT = 64;
    const cx = Math.min(Math.max(m.x, safeL - minX), W - 8 - maxX);
    const cy = Math.min(Math.max(m.y, safeT - minY), H - 8 - maxY);
    this.el.style.left = `${Math.round(cx)}px`;
    this.el.style.top = `${Math.round(cy)}px`;
    for (const p of pos) p.b.style.translate = `calc(${p.x.toFixed(1)}px - 50%) calc(${p.y.toFixed(1)}px - 50%)`;
  }
}
