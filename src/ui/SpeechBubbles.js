import * as THREE from 'three';

/**
 * ฟองคำพูด / ไอคอนอารมณ์ / ตัวเลขความสัมพันธ์ลอยเหนือหัวตัวละครในฟาร์ม (HTML ทับฉาก — ตัวอักษรไทยคมชัดทุกขนาดจอ)
 * แต่ละตัวละคร (key) มีฟองได้ทีละอัน: say() ใหม่แทนอันเดิม · update() ทุกเฟรมเพื่อย้ายตามตำแหน่งหัวบนจอ
 */
const _v = new THREE.Vector3();

export class SpeechBubbles {
  /** @param {HTMLElement} root ชั้น UI (#ui) */
  constructor(root) {
    this.layer = document.createElement('div');
    this.layer.className = 'speech-layer';
    root.appendChild(this.layer);
    /** @type {Map<string, { el: HTMLElement, head: () => THREE.Vector3, until: number, kind: string }>} */
    this.items = new Map();
    this.time = 0;
  }

  /**
   * ฟองคำพูด
   * @param {string} key ตัวละคร
   * @param {() => THREE.Vector3} head ตำแหน่งเหนือหัว (โลก)
   * @param {string} text
   * @param {{ duration?: number, tone?: 'say' | 'yes' | 'no' }} [opts]
   */
  say(key, head, text, { duration = 2.6, tone = 'say' } = {}) {
    const id = `say:${key}`;
    this.items.get(id)?.el.remove();
    const el = document.createElement('div');
    el.className = `speech-bubble tone-${tone}`;
    el.textContent = text;
    this.layer.appendChild(el);
    this.items.set(id, { el, head, until: this.time + duration, kind: 'say' });
  }

  /** ตัวเลขลอยขึ้น (+4 💛) เหนือหัว · dx = เลื่อนซ้ายขวา (px) เมื่อมีหลายตัวพร้อมกัน */
  pop(key, head, text, good = true, dx = 0) {
    const id = `pop:${key}:${this.time}`;
    const el = document.createElement('div');
    el.className = `speech-pop ${good ? 'good' : 'bad'}`;
    el.textContent = text;
    el.style.marginLeft = `${dx}px`;
    this.layer.appendChild(el);
    this.items.set(id, { el, head, until: this.time + 1.8, kind: 'pop', born: this.time });
  }

  /** ไอคอนอารมณ์ค้างเหนือหัวจนถึงเวลาที่กำหนด · icon = null ลบ */
  mood(key, head, icon, duration = 0) {
    const id = `mood:${key}`;
    this.items.get(id)?.el.remove();
    this.items.delete(id);
    if (!icon) return;
    const el = document.createElement('div');
    el.className = 'speech-mood';
    el.textContent = icon;
    this.layer.appendChild(el);
    this.items.set(id, { el, head, until: this.time + duration, kind: 'mood' });
  }

  /** ปิดฟองคำพูดของคนนี้ (อีกคนเริ่มตอบ — ไม่ให้สองฟองทับกัน) */
  end(key) {
    const it = this.items.get(`say:${key}`);
    if (it) it.until = Math.min(it.until, this.time);
  }

  clear(key) {
    for (const [id, it] of this.items) {
      if (key && !id.includes(`:${key}`)) continue;
      it.el.remove();
      this.items.delete(id);
    }
  }

  /** ย้ายทุกฟองตามหัวตัวละครบนจอ (camera = กล้องของฉาก) · visible = false ซ่อนทั้งหมด (ออกจากฟาร์ม) */
  update(dt, camera, visible = true) {
    this.time += dt;
    this.layer.style.display = visible ? '' : 'none';
    if (!visible) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    for (const [id, it] of this.items) {
      if (this.time > it.until) {
        it.el.classList.add('out');
        if (this.time > it.until + 0.3) {
          it.el.remove();
          this.items.delete(id);
        }
        continue;
      }
      _v.copy(it.head());
      if (it.kind === 'pop') _v.y += (this.time - it.born) * 0.35;
      _v.project(camera);
      const behind = _v.z > 1;
      const x = (_v.x * 0.5 + 0.5) * w;
      const y = (-_v.y * 0.5 + 0.5) * h;
      it.el.style.visibility = behind ? 'hidden' : 'visible';
      it.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    }
  }
}
