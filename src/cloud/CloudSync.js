import { SILENT_REJECTIONS, URGENT_COMMANDS } from '../shared/commands.js';
import { replayCommands } from '../shared/commit.js';
import { COMMAND_ERROR_TEXT, LIMITS } from '../shared/constants.js';
import { cloneData } from '../shared/saveDoc.js';
import { Outbox, replayOrphans } from './outbox.js';
import { reconcileGame } from './reconcile.js';
import { CloudError, errorCode } from './transports.js';

const URGENT_DELAY = 400; // ms — รวมการคลิกซื้อรัว ๆ เป็นการบันทึกเดียว
const BATCH_DELAY = 15_000; // ms — ค่าจำลองและคำสั่งทั่วไป (เก็บเหรียญ ให้อาหาร) บันทึกอย่างน้อยทุก 15 วินาทีขณะเล่น
const RETRY_DELAYS = [2000, 4000, 8000, 15000, 30000];
const MAX_PENDING = 60;
const round = (v) => Math.round(v * 10000) / 10000;

const COMMAND_LABEL = {
  buyFish: 'ซื้อปลา',
  sellFish: 'ขายปลา',
  buyFood: 'ซื้ออาหาร',
  feed: 'ให้อาหาร',
  buyMedicine: 'ซื้อยา',
  useMedicine: 'ใช้ยา',
  cleanTank: 'ทำความสะอาดตู้',
  buyTank: 'ปลดล็อกตู้',
  placeDecor: 'วางของตกแต่ง',
  sellDecor: 'ขายของตกแต่ง',
  claimMission: 'รับรางวัลภารกิจ',
  claimDaily: 'รับรางวัลประจำวัน',
};

/**
 * ระบบเซฟกลาง: รับคำสั่งจากเกม → รวมเป็นชุด (commit) → ส่งให้เซิร์ฟเวอร์ตรวจ/บันทึก → รับข้อมูลล่าสุดกลับมาใส่เกม
 *
 * - ส่งได้ทีละ commit (เรียงลำดับเสมอ) ถ้าล้มเหลวจะส่ง commit เดิม (seq เดิม) ซ้ำจนสำเร็จ → ไม่บันทึกซ้ำ ไม่หาย
 * - ฟัง onSnapshot: อุปกรณ์อื่นเปลี่ยนข้อมูล → เล่นคำสั่งที่ค้างในเครื่องซ้ำบนข้อมูลใหม่ แล้วอัปเดตฉากทันที
 * - สถานะ (status): loading | saving | pending | saved | offline | error | blocked
 * - ห้ามแสดง "บันทึกแล้ว" จนกว่าเซิร์ฟเวอร์ตอบรับจริง
 */
export class CloudSync {
  constructor({ transport, uid, writer, doc, fromCache, mode }) {
    this.transport = transport;
    this.mode = mode;
    this.uid = uid;
    this.writer = writer;
    /** เอกสารล่าสุดที่ยืนยันจากคลาวด์แล้ว */
    this.doc = doc;
    this.seq = 0;
    this.pending = [];
    this.inflight = null;
    this.sending = null;
    this.simBase = new Map(doc.game.tanks.map((t) => [t.id, doc.meta.tanks?.[t.id]?.simRev ?? 0]));
    this.simTanks = new Set();
    this.lastSent = null;
    this.outbox = new Outbox(uid, writer);
    this.listeners = new Set();
    this.game = null;
    this.disposed = false;
    this.timer = null;
    this.dueAt = Infinity;
    this.retryTimer = null;
    this.attempt = 0;
    this.blocked = null;
    this.lastError = null;
    this.lastSavedAt = fromCache ? null : Date.now();
    this.stale = !!fromCache;
    this.online = typeof navigator === 'undefined' || navigator.onLine !== false;
    this.status = fromCache ? 'offline' : 'saved';
    this.lastRemoteToast = 0;
  }

  // ── เหตุการณ์ให้ UI ─────────────────────────────────────────

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  #emit(event) {
    for (const fn of this.listeners) fn(event);
  }

  get info() {
    return {
      status: this.status,
      pending: this.pending.length + (this.inflight?.commands.length ?? 0),
      lastSavedAt: this.lastSavedAt,
      revision: this.doc.revision,
      stale: this.stale,
      online: this.online,
      error: this.lastError,
      blocked: this.blocked,
      mode: this.mode,
    };
  }

  #setStatus(status) {
    if (this.blocked) status = 'blocked';
    this.status = status;
    this.#emit({ type: 'status', info: this.info });
  }

  #refreshStatus() {
    if (this.inflight && this.attempt === 0) return this.#setStatus('saving');
    if (this.inflight || this.lastError) return this.#setStatus(this.online ? 'error' : 'offline');
    if (!this.online) return this.#setStatus('offline');
    this.#setStatus(this.pending.length || !this.lastSavedAt ? 'pending' : 'saved');
  }

  // ── เริ่มทำงานกับเกม ─────────────────────────────────────────

  /** เรียกจาก Game.init หลังโหลดฉากแล้ว: เริ่มฟังเรียลไทม์และรับคำสั่งแรก (เช่น เหรียญออฟไลน์) */
  attach(game, initialCommands = []) {
    this.game = game;
    game.state.sink = this;
    for (const c of initialCommands) this.record(c);
    this.simTanks.add(game.state.activeTank.id);
    this.unsubscribe = this.transport.subscribe(
      (doc, metadata) => this.#onSnapshot(doc, metadata),
      (err) => this.#onListenError(err),
    );
    this.handlers = {
      online: () => {
        this.online = true;
        this.flushNow();
      },
      offline: () => {
        this.online = false;
        this.#refreshStatus();
      },
      pagehide: () => {
        this.flushNow();
        this.outbox.markClosed(); // ให้หน้าถัดไปส่งคิวที่ค้างต่อได้ทันที
      },
    };
    for (const [name, fn] of Object.entries(this.handlers)) window.addEventListener(name, fn);
    this.heartbeat = setInterval(() => this.outbox.touch(), 5000);
    // คิวของหน้าเกมที่ปิดไปแบบไม่ทันบันทึก (เช่น เบราว์เซอร์ค้าง) → เก็บมาส่งต่อระหว่างเล่น
    this.orphanTimer = setTimeout(() => this.#adoptOrphans(), 8000);
    this.orphanInterval = setInterval(() => this.#adoptOrphans(), 30_000);
    this.schedule(URGENT_DELAY);
    this.#refreshStatus();
  }

  async #adoptOrphans() {
    if (this.disposed || this.replacing || this.blocked || this.adopting || !this.online) return;
    this.adopting = true;
    try {
      const result = await replayOrphans(this.transport, this.uid, this.writer, this.doc);
      if (this.disposed) return;
      if (result.replayed) {
        this.#applyDoc(result.doc);
        this.#emit({ type: 'orphans', count: result.replayed, rejected: result.rejected });
        this.#refreshStatus();
      }
    } catch (err) {
      console.warn('ส่งคิวที่ค้างจากหน้าก่อนไม่สำเร็จ', err);
    } finally {
      this.adopting = false;
    }
  }

  /** หยุดทำงาน (ใช้ในการทดสอบ / ก่อนโหลดหน้าใหม่) */
  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
    clearTimeout(this.orphanTimer);
    clearInterval(this.heartbeat);
    clearInterval(this.orphanInterval);
    this.unsubscribe?.();
    if (this.game?.state.sink === this) this.game.state.sink = null;
    this.outbox.markClosed();
    for (const [name, fn] of Object.entries(this.handlers ?? {})) window.removeEventListener(name, fn);
    this.listeners.clear();
  }

  /** บันทึกคำสั่งจากเกม (ดู shared/commands.js) */
  record(command) {
    if (this.disposed || this.blocked) return;
    const cmd = { ...command, at: Date.now() };
    if (!this.#compact(cmd)) this.pending.push(cmd);
    if (this.game) this.simTanks.add(this.game.state.activeTank.id);
    this.outbox.save(this);
    const urgent = URGENT_COMMANDS.has(cmd.type) || this.pending.length >= MAX_PENDING;
    this.schedule(urgent ? URGENT_DELAY : BATCH_DELAY);
    if (this.status === 'saved') this.#refreshStatus();
  }

  /** รวมคำสั่งซ้ำ ๆ ที่ยังไม่ได้ส่ง (เช่น เก็บเหรียญหลายเหรียญ) เพื่อลดขนาดและจำนวนการเขียน */
  #compact(cmd) {
    const last = this.pending[this.pending.length - 1];
    if (!last || last.type !== cmd.type) return false;
    if (cmd.type === 'collectCoins' && last.tankId === cmd.tankId) {
      last.count += cmd.count;
      last.value += cmd.value;
      last.at = cmd.at;
      return true;
    }
    if ((cmd.type === 'moveDecor' && last.decorId === cmd.decorId) || cmd.type === 'selectFood' || (cmd.type === 'renameFish' && last.fishId === cmd.fishId)) {
      Object.assign(last, cmd);
      return true;
    }
    return false;
  }

  /** ตู้นี้ถูกจำลองในเครื่องนี้ (เช่น ตู้ที่เพิ่งสลับออก) → ส่งค่าล่าสุดไปด้วยในการบันทึกครั้งหน้า */
  noteSimulated(tankId) {
    this.simTanks.add(tankId);
  }

  /** เกมขอให้บันทึก (ทุก ~10 วินาที, ปิดแท็บ, ออกจากโหมดตกแต่ง ฯลฯ) */
  requestSave({ urgent = false } = {}) {
    if (urgent) this.flushNow();
    else if (!this.retryTimer) this.schedule(BATCH_DELAY);
  }

  schedule(delay) {
    if (this.disposed || this.replacing || this.blocked || !this.game) return;
    const due = Date.now() + delay;
    if (this.timer && this.dueAt <= due) return;
    clearTimeout(this.timer);
    this.dueAt = due;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.dueAt = Infinity;
      this.flush();
    }, delay);
  }

  /** ส่งให้เร็วที่สุด (รวมถึงส่งซ้ำทันทีถ้ากำลังรอลองใหม่) @returns {Promise<void>} */
  flushNow() {
    clearTimeout(this.timer);
    this.timer = null;
    this.dueAt = Infinity;
    if (this.disposed || this.replacing || this.blocked) return;
    if (this.sending) return this.sending;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.inflight) return this.#send();
    return this.flush();
  }

  // ── ส่ง commit ──────────────────────────────────────────────

  #takeSnapshot({ retry = false } = {}) {
    const state = this.game.state;
    const ids = new Set(this.simTanks);
    ids.add(state.activeTank.id);
    if (retry) for (const id of Object.keys(this.lastSent?.tanks ?? {})) ids.add(id);
    this.simTanks.clear();
    const tanks = {};
    for (const id of ids) {
      const tank = state.getTank(id);
      if (!tank) continue;
      const fish = {};
      for (const f of tank.fish) {
        fish[f.id] = { satiety: round(f.satiety), health: round(f.health), growth: round(f.growth), age: round(f.age), breedCooldown: round(f.breedCooldown), coinTimer: round(f.coinTimer) };
      }
      tanks[id] = { baseSimRev: this.simBase.get(id) ?? 0, cleanliness: round(tank.cleanliness), fish };
    }
    return { tanks };
  }

  async flush() {
    if (this.disposed || this.replacing || this.inflight || this.blocked || !this.game || this.retryTimer) return;
    this.inflight = { seq: ++this.seq, epoch: this.doc.epoch, commands: this.pending.splice(0, LIMITS.commandsPerCommit) };
    this.outbox.save(this);
    await this.#send();
  }

  #send() {
    if (this.disposed || this.replacing || this.blocked) return;
    if (!this.sending) {
      this.sending = this.#commitCurrent().finally(() => { this.sending = null; });
    }
    return this.sending;
  }

  async #commitCurrent() {
    const inflight = this.inflight;
    const snapshot = this.#takeSnapshot({ retry: this.attempt > 0 });
    this.lastSent = snapshot;
    this.#refreshStatus();
    let res;
    try {
      res = await this.transport.commit({ writer: this.writer, seq: inflight.seq, epoch: inflight.epoch, commands: inflight.commands, snapshot });
    } catch (err) {
      if (this.disposed) return;
      this.#onCommitError(err);
      return;
    }
    if (!this.disposed) this.#onCommitted(inflight, res);
  }

  #onCommitted(inflight, res) {
    this.inflight = null;
    this.attempt = 0;
    this.lastError = null;
    this.outbox.save(this);
    if (res.epochMismatch) {
      this.#block('epoch');
      return;
    }
    this.lastSavedAt = Date.now();
    this.#applyDoc(res.doc);
    this.#reportResults(inflight.commands, res.results ?? []);
    this.#refreshStatus();
    if (this.pending.length >= MAX_PENDING || this.pending.some((c) => URGENT_COMMANDS.has(c.type))) this.schedule(URGENT_DELAY);
    else if (this.pending.length) this.schedule(BATCH_DELAY);
  }

  #reportResults(commands, results) {
    const rejected = [];
    let coinsLost = 0;
    results.forEach((r, i) => {
      const cmd = commands[i];
      if (!cmd) return;
      if (!r.ok && !SILENT_REJECTIONS.has(cmd.type)) rejected.push({ type: cmd.type, code: r.code });
      if (r.ok && r.requested > r.accepted) coinsLost += r.requested - r.accepted;
    });
    if (rejected.length) {
      const text = rejected.map((r) => `${COMMAND_LABEL[r.type] ?? r.type}: ${COMMAND_ERROR_TEXT[r.code] ?? r.code}`).join(' · ');
      this.#emit({ type: 'rejected', text, items: rejected });
    }
    if (coinsLost > 0) this.#emit({ type: 'coins-capped', amount: coinsLost });
  }

  #onCommitError(err) {
    const code = errorCode(err);
    this.lastError = { code, message: err?.message ?? String(err), at: Date.now() };
    console.warn('บันทึกเซฟกลางไม่สำเร็จ', code, err);
    if (code === 'unauthenticated' || code === 'permission-denied') return this.#block('auth');
    if (code === 'no-save') return this.#block('no-save');
    if (code === 'newer-schema') return this.#block('schema');
    if (code === 'invalid-argument') {
      // ข้อมูลที่ส่งผิดรูปแบบ (บั๊ก) — ส่งซ้ำก็ไม่ผ่าน: ทิ้ง commit นี้แล้วกลับไปใช้ข้อมูลล่าสุดบนคลาวด์
      this.inflight = null;
      this.outbox.save(this);
      this.#applyDoc(this.doc, { force: true });
      this.#emit({ type: 'rejected', text: 'ข้อมูลบางส่วนไม่ถูกต้อง เซิร์ฟเวอร์ไม่บันทึก — กลับไปใช้ข้อมูลล่าสุดบนคลาวด์แล้ว' });
      this.#refreshStatus();
      return;
    }
    // เน็ตหลุด / เซิร์ฟเวอร์ไม่ว่าง / timeout → ส่ง commit เดิมซ้ำ (seq เดิม เซิร์ฟเวอร์ไม่บันทึกซ้ำ)
    this.attempt += 1;
    this.#refreshStatus();
    if (this.replacing) return;
    const delay = RETRY_DELAYS[Math.min(this.attempt - 1, RETRY_DELAYS.length - 1)];
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (this.inflight && !this.blocked) this.#send();
    }, delay);
  }

  // ── รับข้อมูลจากคลาวด์ ──────────────────────────────────────

  #onSnapshot(doc, metadata) {
    if (this.disposed) return;
    if (this.replacing) return; // เครื่องนี้กำลังรีเซ็ต/กู้คืนเอง จะโหลดหน้าใหม่หลังเสร็จ
    this.stale = !!metadata?.fromCache;
    if (!doc) {
      if (!metadata?.fromCache) this.#block('no-save');
      return;
    }
    const fromOther = doc.updatedBy !== this.writer;
    if (this.#applyDoc(doc) && fromOther && doc.epoch === this.doc.epoch) {
      const now = Date.now();
      if (now - this.lastRemoteToast > 20_000) {
        this.lastRemoteToast = now;
        this.#emit({ type: 'remote' });
      }
    }
    this.#refreshStatus();
  }

  #onListenError(err) {
    if (this.disposed) return;
    const code = errorCode(err);
    console.warn('ฟังการเปลี่ยนแปลงเซฟกลางไม่ได้', code, err);
    if (code === 'permission-denied' || code === 'unauthenticated') this.#block('auth');
    else {
      this.stale = true;
      this.#refreshStatus();
    }
  }

  /**
   * ใช้เอกสารใหม่จากคลาวด์: เล่นคำสั่งที่ยังไม่ถูกบันทึกซ้ำบนข้อมูลใหม่ แล้วใส่ลงเกม
   * @returns {boolean} มีการเปลี่ยนข้อมูลในเกมไหม
   */
  #applyDoc(doc, { force = false } = {}) {
    if (!doc) return false;
    if (!force && doc.revision <= this.doc.revision) return false;
    if (doc.epoch !== this.doc.epoch) {
      this.doc = doc;
      this.#block('epoch');
      return false;
    }
    this.doc = doc;
    if (!this.game) return true;
    const acked = doc.meta.writers?.[this.writer]?.seq ?? 0;
    const replay = [...(this.inflight && this.inflight.seq > acked ? this.inflight.commands : []), ...this.pending];
    const next = cloneData(doc.game);
    replayCommands(next, cloneData(doc.meta), replay, this.writer);
    reconcileGame(this.game, next, { adopt: this.#simAdoption(doc), server: doc.game, sent: this.lastSent });
    return true;
  }

  /** ตัดสินว่าค่าจำลองของแต่ละตู้ควรใช้ของเครื่องนี้หรือของคลาวด์ (ดู reconcile.js) */
  #simAdoption(doc) {
    const adopt = {};
    for (const tank of doc.game.tanks) {
      const tm = doc.meta.tanks?.[tank.id];
      const rev = tm?.simRev ?? 0;
      const base = this.simBase.get(tank.id);
      if (base === undefined) adopt[tank.id] = 'all';
      else if (rev === base) adopt[tank.id] = 'none';
      else if (tm?.simBy === this.writer) adopt[tank.id] = 'corrections';
      else adopt[tank.id] = 'all';
      this.simBase.set(tank.id, rev);
    }
    return adopt;
  }

  #block(reason) {
    if (this.blocked) return;
    this.blocked = reason;
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    if (reason === 'epoch' || reason === 'no-save') {
      // คำสั่งที่ค้างอยู่ใช้กับเซฟชุดใหม่ไม่ได้แล้ว (เซิร์ฟเวอร์ก็จะปฏิเสธ) — ทิ้งไป
      this.pending = [];
      this.inflight = null;
      this.outbox.clear();
    }
    this.#setStatus('blocked');
    this.#emit({ type: 'blocked', reason });
  }

  // ── การกระทำจากหน้า "เซฟคลาวด์" ─────────────────────────────

  listBackups() {
    return this.transport.listBackups(20);
  }

  async createBackup() {
    do {
      if (this.disposed || this.replacing || this.blocked) throw new CloudError('failed-precondition', 'ยังสร้างจุดสำรองไม่ได้ ระบบบันทึกกำลังหยุดทำงาน');
      await this.flushNow();
      if (this.lastError || this.inflight || this.blocked || this.disposed) {
        throw new CloudError(this.lastError?.code ?? 'failed-precondition', 'บันทึกการเปลี่ยนแปลงล่าสุดไม่สำเร็จ จึงยังไม่ได้สร้างจุดสำรอง');
      }
    } while (this.pending.length);
    await this.transport.admin('backup', {});
  }

  /** รีเซ็ต/กู้คืน/นำเข้า: หยุดบันทึกปกติก่อน แล้วให้เซิร์ฟเวอร์สำรองข้อมูลเดิมและแทนที่ใน transaction เดียว */
  async #replaceAll(action, payload) {
    clearTimeout(this.timer);
    clearTimeout(this.retryTimer);
    this.timer = null;
    this.retryTimer = null;
    this.dueAt = Infinity;
    this.replacing = true;
    try {
      // ให้คำขอที่ส่งไปแล้วจบก่อน เพื่อใช้ revision ล่าสุดและไม่ให้คำตอบเก่ากลับมาปะปนหลังแทนที่
      await this.sending;
      for (let attempt = 0; ; attempt++) {
        try {
          const res = await this.transport.admin(action, { ...payload, confirm: action, expectedRevision: this.doc.revision });
          this.blocked = 'replaced';
          this.pending = [];
          this.inflight = null;
          this.outbox.clear();
          this.unsubscribe?.();
          return res;
        } catch (err) {
          if (errorCode(err) !== 'revision-changed' || attempt > 0) throw err;
          const latest = await this.transport.load(); // มีการบันทึกระหว่างยืนยัน → ใช้ revision ล่าสุดแล้วลองอีกครั้ง
          if (latest.doc) this.doc = latest.doc;
        }
      }
    } catch (err) {
      this.replacing = false;
      if (this.inflight && !this.disposed && !this.blocked) {
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.#send();
        }, URGENT_DELAY);
      } else {
        this.schedule(URGENT_DELAY);
      }
      throw err;
    }
  }

  resetSave() {
    return this.#replaceAll('reset', {});
  }

  restoreBackup(backupId) {
    return this.#replaceAll('restore', { backupId });
  }

  replaceWithLegacy(legacy) {
    return this.#replaceAll('replace', { legacy });
  }
}
