import { LIMITS } from '../shared/constants.js';

/**
 * คิวคำสั่งที่ยังไม่ได้บันทึกขึ้นคลาวด์ เก็บใน localStorage เป็น "แคชชั่วคราว" เท่านั้น
 * — ถ้าปิดแท็บ/รีเฟรช/เน็ตหลุดก่อนบันทึกเสร็จ เปิดเกมครั้งหน้าจะส่งต่อให้เซิร์ฟเวอร์ตรวจใหม่บนข้อมูลล่าสุด
 * — แต่ละหน้าเกม (writer) มีคิวของตัวเอง ส่งซ้ำได้โดยไม่บันทึกซ้ำ เพราะเซิร์ฟเวอร์จำเลขลำดับ (seq) ไว้
 * — ไม่ใช่ที่เก็บเซฟ: ข้อมูลเกมจริงอยู่บน Firestore เท่านั้น
 */
const PREFIX = 'aquarium-cloud-outbox:';
const ORPHAN_AFTER_MS = 15_000;

const safe = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export class Outbox {
  constructor(uid, writer) {
    this.key = `${PREFIX}${uid}:${writer}`;
    this.writer = writer;
    this.hasData = false;
  }

  /** บันทึกสถานะคิวของ CloudSync (เรียกทุกครั้งที่คิวเปลี่ยน) */
  save(sync) {
    const inflight = sync.inflight ? { seq: sync.inflight.seq, commands: sync.inflight.commands } : null;
    if (!inflight && sync.pending.length === 0) return this.clear();
    const now = Date.now();
    const data = { writer: this.writer, epoch: sync.doc.epoch, savedAt: now, aliveAt: now, seq: sync.seq, inflight, pending: sync.pending };
    this.hasData = safe(() => (localStorage.setItem(this.key, JSON.stringify(data)), true), false);
  }

  /** บอกแท็บอื่นว่าหน้านี้ยังเปิดอยู่ (คิวของหน้าที่ปิดไปแล้วจะถูกหยิบไปส่งต่อ) */
  touch() {
    if (!this.hasData) return;
    safe(() => {
      const data = JSON.parse(localStorage.getItem(this.key) ?? 'null');
      if (data) localStorage.setItem(this.key, JSON.stringify({ ...data, aliveAt: Date.now() }));
    });
  }

  /** หน้านี้กำลังปิด → หน้าเกมถัดไปส่งคิวที่ค้างต่อได้ทันที ไม่ต้องรอ heartbeat หมดอายุ */
  markClosed() {
    if (!this.hasData) return;
    safe(() => {
      const data = JSON.parse(localStorage.getItem(this.key) ?? 'null');
      if (data) localStorage.setItem(this.key, JSON.stringify({ ...data, closed: true }));
    });
  }

  clear() {
    this.hasData = false;
    safe(() => localStorage.removeItem(this.key));
  }

  /** คิวของหน้าเกมก่อนหน้า (ปิดไปแล้ว) ของผู้ใช้คนเดียวกัน */
  static orphans(uid, selfWriter, now = Date.now()) {
    const prefix = `${PREFIX}${uid}:`;
    const keys = safe(() => Object.keys(localStorage).filter((k) => k.startsWith(prefix)), []);
    const out = [];
    for (const key of keys) {
      const data = safe(() => JSON.parse(localStorage.getItem(key)));
      if (!data || data.writer === selfWriter) continue;
      if (!data.closed && now - (data.aliveAt ?? 0) < ORPHAN_AFTER_MS) continue; // แท็บอื่นที่ยังเปิดอยู่
      if (now - (data.savedAt ?? data.aliveAt ?? 0) > LIMITS.outboxTtlMs) {
        Outbox.remove(key); // เก่าเกินไป — ทิ้ง ไม่ส่งข้อมูลเก่าขึ้นคลาวด์
        continue;
      }
      out.push({ key, ...data });
    }
    return out;
  }

  static remove(key) {
    safe(() => localStorage.removeItem(key));
  }
}

/**
 * ส่งคิวที่ค้างจากหน้าเกมก่อน ๆ (เช่น ปิดแท็บก่อนบันทึกเสร็จ) — เซิร์ฟเวอร์ตรวจแต่ละคำสั่งใหม่บนข้อมูลล่าสุด
 * คิวที่ epoch ไม่ตรง (เซฟถูกรีเซ็ต/กู้คืนไปแล้ว) ถูกทิ้ง
 * @returns {{doc, replayed:number, rejected:number}}
 */
export async function replayOrphans(transport, uid, selfWriter, doc) {
  let replayed = 0;
  let rejected = 0;
  for (const o of Outbox.orphans(uid, selfWriter)) {
    if (o.epoch !== doc.epoch) {
      Outbox.remove(o.key);
      continue;
    }
    const commits = [];
    if (o.inflight?.commands) commits.push({ seq: o.inflight.seq, commands: o.inflight.commands });
    let seq = Math.max(o.seq ?? 0, o.inflight?.seq ?? 0);
    // กำหนดขอบเขตและ seq จากคิวเดิมเสมอ: ถ้าคำตอบหาย การลองใหม่ต้องส่งแต่ละชุดด้วย seq เดิม
    for (let offset = 0; offset < (o.pending?.length ?? 0); offset += LIMITS.commandsPerCommit) {
      commits.push({ seq: ++seq, commands: o.pending.slice(offset, offset + LIMITS.commandsPerCommit) });
    }
    try {
      for (const c of commits) {
        const res = await transport.commit({ writer: o.writer, seq: c.seq, epoch: o.epoch, commands: c.commands, snapshot: null });
        doc = res.doc;
        replayed += c.commands.length;
        rejected += (res.results ?? []).filter((r) => !r.ok).length;
      }
      Outbox.remove(o.key);
    } catch (err) {
      const code = String(err?.code ?? '').replace(/^(functions|firestore)\//, '');
      if (code === 'invalid-argument') {
        console.warn('ทิ้งคิวที่ค้างซึ่งเซิร์ฟเวอร์ไม่รับ (ข้อมูลผิดรูปแบบ)', err);
        Outbox.remove(o.key); // ส่งซ้ำก็ไม่ผ่าน — ไม่ให้บังคิวอื่น
      } else {
        console.warn('ส่งคิวที่ค้างไม่สำเร็จ จะลองใหม่ภายหลัง', err);
      }
    }
  }
  return { doc, replayed, rejected };
}
