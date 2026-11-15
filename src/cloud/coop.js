import { collection, deleteDoc, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { SAVE_COLLECTION, SAVE_DOC_ID } from '../shared/constants.js';

/**
 * เล่นด้วยกันสองคน: สองเครื่องที่เปิดเกม (บัญชีเดียวกัน เซฟเดียวกัน) เห็นกันในฟาร์ม คนละตัวละคร (ผู้ชาย / ผู้หญิง)
 *
 * - ประกาศตัว: เอกสาร gameSaves/global/coop/{writer} ของหน้าเกมนี้ { char, since, at } — ต่ออายุทุก HEARTBEAT ms
 *   (เฉพาะตอนแท็บเปิดอยู่) · เอกสารที่ at เก่ากว่า STALE ms = ออฟไลน์
 * - จับคู่กับเครื่องอื่นที่ออนไลน์และเปิดก่อน (since น้อยสุด) ได้ทีละ 1 เครื่อง
 * - ตัวละครชนกัน (เลือกตัวเดียวกัน) → เครื่องที่เปิดทีหลังเปลี่ยนไปอีกตัวเอง (resolveCharacter)
 * - ข้อมูลเรียลไทม์ (ตำแหน่ง ท่าทาง ≈ 10 ครั้ง/วินาที) ส่งตรงระหว่างเครื่องด้วย WebRTC DataChannel
 *   Firestore ใช้แค่ส่ง offer/answer (non-trickle ICE — เขียนครั้งเดียวต่อฝั่ง) → ไม่เปลืองโควตาฟรี
 * - เชื่อมต่อตรงไม่ได้ (เครือข่ายบางแบบ) → ส่งตำแหน่งผ่านเอกสารเดียวกันแทน ไม่เกิน 1 ครั้ง / RELAY_EVERY ms (ภาพช้ากว่าแต่ยังเล่นได้)
 *
 * ไม่มี Three.js / DOM ของเกม — FarmSystem เป็นคนอ่าน peerState / ส่ง sendState / sendEvent
 */
export const HEARTBEAT = 25_000;
export const STALE = 70_000;
export const RELAY_EVERY = 2_000;
const RTC_RETRY = 30_000;
const ICE_WAIT = 3_000;
const ICE_SERVERS = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
export const COOP_CHARS = ['man', 'woman'];

/** เอกสารของเครื่องอื่นที่ยังออนไลน์ เรียงตามเวลาที่เปิดเกม (เก่าสุดก่อน) */
export function onlinePeers(docs, selfId, now = Date.now()) {
  return docs
    .filter((d) => d.id !== selfId && COOP_CHARS.includes(d.char) && typeof d.at === 'number' && now - d.at < STALE)
    .sort((a, b) => (a.since ?? 0) - (b.since ?? 0) || (a.id < b.id ? -1 : 1));
}

/**
 * ตัวละครที่เครื่องนี้ควรใช้เมื่อมีเพื่อนออนไลน์: เลือกไม่ซ้ำกันอยู่แล้ว = ตามเดิม
 * ซ้ำกัน → เครื่องที่เปิดก่อน (since น้อยกว่า · เท่ากันใช้ id) ได้ตัวเดิม อีกเครื่องเปลี่ยนไปอีกตัว
 */
export function resolveCharacter(self, peer) {
  if (!peer || peer.char !== self.char) return self.char;
  const selfFirst = self.since < peer.since || (self.since === peer.since && self.id < peer.id);
  return selfFirst ? self.char : otherChar(self.char);
}

export function otherChar(c) {
  return c === 'woman' ? 'man' : 'woman';
}

/** ฝั่งที่สร้าง offer = id น้อยกว่า (ทั้งสองเครื่องตัดสินตรงกันโดยไม่ต้องคุยกัน) */
export function isOfferer(selfId, peerId) {
  return selfId < peerId;
}

/** ปัดตัวเลขให้ข้อความสั้น */
const r2 = (v) => Math.round(v * 100) / 100;
export function packState(s) {
  return { x: r2(s.x), y: r2(s.y), z: r2(s.z), h: r2(s.h), s: r2(s.s), c: s.c, n: s.n, loc: s.loc };
}

export class CoopLink {
  /**
   * @param {{ db: import('firebase/firestore').Firestore, selfId: string, char: () => string }} opts
   */
  constructor({ db, selfId, char }) {
    this.db = db;
    this.selfId = selfId;
    this.char = char;
    this.since = Date.now();
    this.col = collection(db, SAVE_COLLECTION, SAVE_DOC_ID, 'coop');
    this.ref = doc(this.col, selfId);
    /** เอกสารทั้งหมดล่าสุดจาก onSnapshot */
    this.docs = [];
    /** เครื่องที่จับคู่อยู่ { id, char, since } | null */
    this.peer = null;
    /** สถานะล่าสุดของเพื่อน (packState) + เวลาที่ได้รับ */
    this.peerState = null;
    this.peerStateAt = 0;
    this.listeners = new Set();
    this.pc = null;
    this.dc = null;
    this.sid = null;
    this.rtcStartedAt = 0;
    this.handledOffer = null;
    this.handledAnswer = null;
    this.lastRelay = 0;
    this.relayPending = null;
    this.lastEvSerial = 0;
    this.evSerial = 0;
    this.lastPeerEv = null;
    this.timer = null;
    this.unsub = null;
    this.stopped = false;
    this.visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #emit(e) {
    for (const fn of this.listeners) {
      try {
        fn(e);
      } catch (err) {
        console.error('[coop]', err);
      }
    }
  }

  /** เชื่อมต่อตรงอยู่ */
  get direct() {
    return this.dc?.readyState === 'open';
  }

  start() {
    this.unsub = onSnapshot(
      this.col,
      (snap) => {
        this.docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        this.#onDocs();
      },
      (err) => console.warn('[coop] อ่านรายชื่อผู้เล่นไม่ได้ (deploy Security Rules แล้วหรือยัง?)', err?.code ?? err),
    );
    this.#beat();
    this.timer = setInterval(() => this.#tick(), 1000);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        this.visible = document.visibilityState !== 'hidden';
        if (this.visible) this.#beat();
        else {
          // ซ่อนแท็บ = ออกจากการเล่นด้วยกัน (เพื่อนจะเห็นตัวละครเดินทำกิจวัตรเองแทน)
          this.#write({ at: 0 });
          this.#closeRtc();
        }
      });
      addEventListener('pagehide', () => this.stop());
    }
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearInterval(this.timer);
    this.unsub?.();
    this.#closeRtc();
    deleteDoc(this.ref).catch(() => {});
  }

  /** ตัวละครของเครื่องนี้เปลี่ยน (สลับตัว / ถูกเปลี่ยนเพราะชนกัน) → ประกาศทันที */
  announce() {
    this.#beat();
  }

  #beat() {
    if (this.stopped || !this.visible) return;
    this.lastBeat = Date.now();
    this.#write({ char: this.char(), since: this.since, at: Date.now() });
  }

  #write(data) {
    if (this.stopped) return Promise.resolve();
    return setDoc(this.ref, { char: this.char(), at: data.at ?? Date.now(), ...data }, { merge: true }).catch((err) =>
      console.warn('[coop] บันทึกสถานะไม่ได้', err?.code ?? err),
    );
  }

  #tick() {
    if (this.stopped || !this.visible) return;
    const now = Date.now();
    if (now - (this.lastBeat ?? 0) >= HEARTBEAT) this.#beat();
    this.#onDocs();
    // ตำแหน่งสำรองที่ค้างส่ง (ถูกจำกัดความถี่)
    if (this.relayPending && !this.direct && now - this.lastRelay >= RELAY_EVERY) this.#flushRelay();
    // ต่อตรงไม่สำเร็จ → ฝั่ง offer ลองใหม่เป็นระยะ (ระหว่างนี้ใช้ทางสำรอง) · ฝั่ง answer รอ offer ใหม่
    const offerer = this.peer && isOfferer(this.selfId, this.peer.id);
    if (offerer && !this.direct && this.pc && now - this.rtcStartedAt > RTC_RETRY) this.#closeRtc();
  }

  #onDocs() {
    const now = Date.now();
    // เอกสารของหน้าเกมที่ปิดไปโดยไม่ได้ลบ (แบตหมด/ปิดแอปแรง) → ลบทิ้งครั้งเดียว
    if (!this.swept && this.docs.length) {
      this.swept = true;
      for (const d of this.docs) if (d.id !== this.selfId && now - (d.at ?? 0) > 6 * 3600_000) deleteDoc(doc(this.col, d.id)).catch(() => {});
    }
    const peers = onlinePeers(this.docs, this.selfId, now);
    const p = peers[0] ?? null;
    const prev = this.peer;
    if (!p) {
      if (prev) {
        this.peer = null;
        this.peerState = null;
        this.#closeRtc();
        this.#emit({ type: 'peer', peer: null, prev });
      }
      return;
    }
    const changed = !prev || prev.id !== p.id || prev.char !== p.char;
    if (prev && prev.id !== p.id) this.#closeRtc();
    this.peer = { id: p.id, char: p.char, since: p.since ?? 0 };
    if (changed) this.#emit({ type: 'peer', peer: this.peer, prev });
    // ทางสำรอง: อ่านตำแหน่ง/เหตุการณ์จากเอกสารของเพื่อน (เมื่อไม่ได้ต่อตรง)
    if (!this.direct && p.st && typeof p.st === 'object') this.#gotState(p.st);
    if (p.ev && typeof p.ev === 'object' && p.ev.to === this.selfId && p.ev.k !== this.lastPeerEv) {
      this.lastPeerEv = p.ev.k;
      // เหตุการณ์เก่าที่ค้างในเอกสาร (เปิดเกมทีหลัง) ไม่ต้องเล่น
      if (now - (p.ev.at ?? 0) < 15_000) this.#emit({ type: 'event', event: p.ev.e });
    }
    this.#signal(p);
  }

  #gotState(st) {
    this.peerState = st;
    this.peerStateAt = Date.now();
  }

  // ── WebRTC ────────────────────────────────────────────────

  async #signal(p) {
    if (typeof RTCPeerConnection === 'undefined') return;
    const sig = p.sig;
    if (isOfferer(this.selfId, p.id)) {
      if (!this.pc) this.#makeOffer(p.id);
      else if (sig?.type === 'answer' && sig.to === this.selfId && sig.sid === this.sid && this.handledAnswer !== sig.sid) {
        this.handledAnswer = sig.sid;
        try {
          await this.pc.setRemoteDescription({ type: 'answer', sdp: sig.sdp });
        } catch (err) {
          console.warn('[coop] answer ใช้ไม่ได้', err);
        }
      }
    } else if (sig?.type === 'offer' && sig.to === this.selfId && sig.sid !== this.handledOffer) {
      this.handledOffer = sig.sid;
      this.#answer(p.id, sig);
    }
  }

  #newPc() {
    this.#closeRtc();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc = pc;
    this.rtcStartedAt = Date.now();
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.#emit({ type: 'link', direct: false });
    };
    return pc;
  }

  #useChannel(dc) {
    this.dc = dc;
    dc.onopen = () => {
      if (dc !== this.dc) return;
      // ลบตำแหน่งสำรองออกจากเอกสาร (ไม่ต้องใช้แล้ว)
      this.#write({ st: null });
      this.#emit({ type: 'link', direct: true });
    };
    dc.onclose = () => {
      if (dc === this.dc) this.#emit({ type: 'link', direct: false });
    };
    dc.onmessage = this.#onMessage;
  }

  #onMessage = (e) => {
    let m;
    try {
      m = JSON.parse(e.data);
    } catch {
      return;
    }
    if (m?.t === 's') this.#gotState(m.s);
    else if (m?.t === 'e') this.#emit({ type: 'event', event: m.e });
  };

  async #makeOffer(peerId) {
    const pc = this.#newPc();
    this.#useChannel(pc.createDataChannel('coop', { ordered: false, maxRetransmits: 0 }));
    // ช่องที่สองสำหรับเหตุการณ์ (ต้องถึงแน่นอน)
    this.ev = pc.createDataChannel('coop-ev', { ordered: true });
    this.ev.onmessage = this.#onMessage;
    this.sid = `${this.selfId}-${Date.now().toString(36)}`;
    try {
      await pc.setLocalDescription(await pc.createOffer());
      await waitIce(pc);
      if (pc !== this.pc) return;
      await this.#write({ sig: { type: 'offer', to: peerId, sid: this.sid, sdp: pc.localDescription.sdp } });
    } catch (err) {
      console.warn('[coop] สร้าง offer ไม่ได้', err);
    }
  }

  async #answer(peerId, sig) {
    const pc = this.#newPc();
    this.sid = sig.sid;
    pc.ondatachannel = (e) => {
      if (e.channel.label === 'coop-ev') {
        this.ev = e.channel;
        e.channel.onmessage = this.#onMessage;
      } else this.#useChannel(e.channel);
    };
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: sig.sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIce(pc);
      if (pc !== this.pc) return;
      await this.#write({ sig: { type: 'answer', to: peerId, sid: sig.sid, sdp: pc.localDescription.sdp } });
    } catch (err) {
      console.warn('[coop] ตอบ offer ไม่ได้', err);
    }
  }

  #closeRtc() {
    const had = this.direct;
    try {
      this.dc?.close();
      this.ev?.close();
      this.pc?.close();
    } catch {
      /* ปิดไปแล้ว */
    }
    this.pc = null;
    this.dc = null;
    this.ev = null;
    this.handledAnswer = null;
    if (had) this.#emit({ type: 'link', direct: false });
  }

  // ── ส่งข้อมูล ──────────────────────────────────────────────

  /** สถานะตัวละครของเครื่องนี้ (เรียกถี่ได้ — ต่อตรง = ส่งทันที · ทางสำรอง = รวมส่งตามรอบ) */
  sendState(state) {
    if (!this.peer || this.stopped) return;
    const s = packState(state);
    if (this.direct) {
      try {
        this.dc.send(JSON.stringify({ t: 's', s }));
      } catch {
        /* ช่องเพิ่งปิด */
      }
      return;
    }
    const last = this.lastRelayed;
    // ไม่เปลี่ยน (ยืนนิ่ง) = ไม่ต้องเขียน
    if (last && last.x === s.x && last.z === s.z && last.c === s.c && last.n === s.n && last.loc === s.loc && Math.abs(last.h - s.h) < 0.2) return;
    this.relayPending = s;
    if (Date.now() - this.lastRelay >= RELAY_EVERY) this.#flushRelay();
  }

  #flushRelay() {
    const s = this.relayPending;
    if (!s) return;
    this.relayPending = null;
    this.lastRelay = Date.now();
    this.lastRelayed = s;
    this.#write({ st: s });
  }

  /** เหตุการณ์ (เริ่มคุยกัน / เลิกคุย) — ต้องถึงเพื่อน */
  sendEvent(e) {
    if (!this.peer || this.stopped) return;
    if (this.ev?.readyState === 'open') {
      try {
        this.ev.send(JSON.stringify({ t: 'e', e }));
        return;
      } catch {
        /* ตกไปใช้ทางสำรอง */
      }
    }
    this.evSerial += 1;
    this.#write({ ev: { to: this.peer.id, k: `${this.selfId}-${this.evSerial}`, at: Date.now(), e } });
  }
}

/** รอให้รวบรวม ICE candidate ครบ (หรือครบเวลา) — ส่ง SDP ครั้งเดียวจบ */
function waitIce(pc) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      pc.removeEventListener('icegatheringstatechange', check);
      clearTimeout(t);
      resolve();
    };
    const check = () => pc.iceGatheringState === 'complete' && done();
    const t = setTimeout(done, ICE_WAIT);
    pc.addEventListener('icegatheringstatechange', check);
  });
}
