import { CONFIG } from '../config.js';
import { getSpecies } from '../data/fish.js';
import { clamp, todayKey } from '../utils/math.js';
import { applyCommand } from './commands.js';
import { FEED_WINDOW_MS, LIMITS } from './constants.js';
import { CommandError, ensureMissionDay, isId, isNum, maxGrowthIn, tankMeta } from './economy.js';
import { cloneData } from './saveDoc.js';

/**
 * "commit" = ชุดการเปลี่ยนแปลงหนึ่งครั้งจากหน้าเกมหนึ่งหน้า
 * {
 *   writer, seq,          // หน้าเกมนี้ + เลขลำดับ (เพิ่มทีละ 1) → ส่งซ้ำกี่ครั้งก็บันทึกครั้งเดียว
 *   epoch,                // epoch ของเซฟที่หน้าเกมเห็น ถ้าเซฟถูกรีเซ็ต/กู้คืนไปแล้ว ทั้งชุดจะถูกยกเลิก
 *   commands: [...],      // การกระทำ (ดู commands.js) ตรวจซ้ำบนข้อมูลล่าสุดทีละคำสั่ง
 *   snapshot: { tanks: { [tankId]: { baseSimRev, cleanliness, fish: { [fishId]: { satiety, health, growth, age, breedCooldown, coinTimer } } } } }
 * }
 *
 * snapshot = ค่าที่เกมจำลองต่อเนื่อง (ความหิว สุขภาพ การโต ความสะอาด) จะถูกรับก็ต่อเมื่อ baseSimRev ตรงกับบนคลาวด์
 * ถ้ามีอุปกรณ์อื่นบันทึกตู้นั้นไปก่อน ค่าจากเครื่องนี้ถูกปัดตก (ไม่เขียนข้อมูลเก่าทับข้อมูลใหม่) แล้วเครื่องนี้รับค่าล่าสุดไปเล่นต่อ
 */

const SIM_FIELDS = ['satiety', 'health', 'growth', 'age', 'breedCooldown', 'coinTimer'];

function invalid(detail) {
  const err = new Error(`invalid-commit: ${detail}`);
  err.code = 'invalid-argument';
  return err;
}

/** ตรวจรูปแบบ commit ที่รับมาจากเครื่องผู้เล่น (คำสั่งแต่ละตัวถูกตรวจละเอียดอีกครั้งใน commands.js) */
export function validateCommit(raw) {
  if (!raw || typeof raw !== 'object') throw invalid('body');
  if (!isId(raw.writer)) throw invalid('writer');
  if (!Number.isInteger(raw.seq) || raw.seq < 1 || raw.seq > 1e12) throw invalid('seq');
  if (!Number.isInteger(raw.epoch) || raw.epoch < 0) throw invalid('epoch');
  if (!Array.isArray(raw.commands) || raw.commands.length > LIMITS.commandsPerCommit) throw invalid('commands');
  for (const c of raw.commands) if (!c || typeof c !== 'object' || typeof c.type !== 'string') throw invalid('command');
  const snap = raw.snapshot;
  if (snap != null) {
    if (typeof snap !== 'object' || typeof snap.tanks !== 'object' || snap.tanks === null) throw invalid('snapshot');
    const tanks = Object.entries(snap.tanks);
    if (tanks.length > 8) throw invalid('snapshot.tanks');
    for (const [id, t] of tanks) {
      if (!isId(id) || !t || typeof t !== 'object' || !Number.isInteger(t.baseSimRev)) throw invalid('snapshot.tank');
      if (t.fish != null && (typeof t.fish !== 'object' || Object.keys(t.fish).length > 80)) throw invalid('snapshot.fish');
    }
  }
  // ตัด prototype / ค่าแปลก ๆ ทิ้ง เหลือ JSON ล้วน
  return JSON.parse(JSON.stringify({ writer: raw.writer, seq: raw.seq, epoch: raw.epoch, commands: raw.commands, snapshot: snap ?? null }));
}

/**
 * รับค่าจำลองจากเครื่อง โดยตรวจเพดานตามเวลาจริงที่ผ่านไป (เช่น ปลาโตเร็วกว่าที่เป็นไปได้ไม่ได้,
 * ความอิ่มเพิ่มได้เฉพาะหลังให้อาหาร, น้ำใสขึ้นได้เฉพาะคำสั่งทำความสะอาด)
 * @returns {{[tankId]: 'accepted'|'rejected'|'missing'}}
 */
export function applySnapshot(game, meta, snapshot, ctx) {
  const out = {};
  if (!snapshot?.tanks) return out;
  for (const [tankId, ts] of Object.entries(snapshot.tanks)) {
    const tank = game.tanks.find((t) => t.id === tankId);
    if (!tank) {
      out[tankId] = 'missing';
      continue;
    }
    const tm = tankMeta(meta, tankId);
    if (ts.baseSimRev !== (tm.simRev ?? 0)) {
      out[tankId] = 'rejected';
      continue;
    }
    const since = tm.simAt ?? tank.lastUpdate ?? ctx.now;
    const elapsed = (Math.max(0, ctx.now - since) / 1000) * CONFIG.timeScale;
    const fed = ctx.now - (tm.lastFedAt ?? -Infinity) <= FEED_WINDOW_MS;
    let foodHealthBudget = fed ? (tm.foodHealthBudget ?? 0) : 0;

    // Bounds depend on elapsed time or paid actions, never on how often a client commits.
    if (isNum(ts.cleanliness)) tank.cleanliness = clamp(Math.min(ts.cleanliness, tank.cleanliness), 0, 100);
    for (const fish of tank.fish) {
      const s = ts.fish?.[fish.id];
      const species = getSpecies(fish.speciesId);
      if (!s || !species) continue;
      if (isNum(s.satiety)) fish.satiety = clamp(fed ? s.satiety : Math.min(s.satiety, fish.satiety), 0, 100);
      if (isNum(s.health)) {
        const passiveHealth = fish.health + CONFIG.care.regen * elapsed;
        fish.health = clamp(Math.min(s.health, passiveHealth + foodHealthBudget), 0, 100);
        foodHealthBudget = Math.max(0, foodHealthBudget - Math.max(0, fish.health - passiveHealth));
      }
      if (isNum(s.growth)) fish.growth = clamp(s.growth, fish.growth, Math.min(1, fish.growth + maxGrowthIn(species, elapsed)));
      if (isNum(s.age)) fish.age = clamp(s.age, fish.age, fish.age + elapsed);
      if (isNum(s.breedCooldown)) fish.breedCooldown = clamp(s.breedCooldown, 0, CONFIG.breeding.cooldown);
      if (isNum(s.coinTimer)) fish.coinTimer = clamp(s.coinTimer, 0, species.economy.coinInterval * 1.25);
    }
    tank.lastUpdate = ctx.now;
    tm.simRev = (tm.simRev ?? 0) + 1;
    tm.simBy = ctx.writer;
    tm.simAt = ctx.now;
    tm.foodHealthBudget = foodHealthBudget;
    out[tankId] = 'accepted';
  }
  return out;
}

/** ลบ metadata ที่ไม่ใช้แล้ว ไม่ให้เอกสารโตเรื่อย ๆ */
function pruneMeta(doc, now) {
  const { meta, game } = doc;
  for (const [w, info] of Object.entries(meta.writers)) if (now - (info?.at ?? 0) > LIMITS.writerTtlMs) delete meta.writers[w];
  const writers = Object.entries(meta.writers);
  if (writers.length > LIMITS.maxWriters) {
    writers.sort((a, b) => (b[1]?.at ?? 0) - (a[1]?.at ?? 0));
    for (const [w] of writers.slice(LIMITS.maxWriters)) delete meta.writers[w];
  }
  for (const tankId of Object.keys(meta.tanks)) {
    const tank = game.tanks.find((t) => t.id === tankId);
    if (!tank) {
      delete meta.tanks[tankId];
      continue;
    }
    const bred = meta.tanks[tankId].bredAt;
    if (bred) for (const fishId of Object.keys(bred)) if (!tank.fish.some((f) => f.id === fishId)) delete bred[fishId];
  }
}

/**
 * ประมวลผล commit กับเอกสารเซฟ (ไม่แก้ input) — รันใน transaction ของ Firestore เสมอ
 * @returns {{doc, results: Array<{ok:boolean, code?:string}>, snapshot, duplicate:boolean, epochMismatch?:boolean}}
 */
export function processCommit(input, commit, { now }) {
  const last = input.meta?.writers?.[commit.writer]?.seq ?? 0;
  if (commit.seq <= last) return { doc: input, results: [], snapshot: {}, duplicate: true };
  if (commit.epoch !== (input.epoch ?? 0)) {
    return { doc: input, results: commit.commands.map(() => ({ ok: false, code: 'epoch' })), snapshot: {}, duplicate: false, epochMismatch: true };
  }

  const doc = cloneData(input);
  const { game, meta } = doc;
  const ctx = { now, day: todayKey(new Date(now)), writer: commit.writer, predict: false, simTouched: new Set() };
  ensureMissionDay(game, ctx.day);

  const results = commit.commands.map((cmd) => {
    try {
      const info = applyCommand(game, meta, cmd, ctx);
      return info ? { ok: true, ...info } : { ok: true };
    } catch (err) {
      if (err instanceof CommandError) return { ok: false, code: err.code };
      console.error('command failed', cmd?.type, err);
      return { ok: false, code: 'internal' };
    }
  });

  const snapshot = applySnapshot(game, meta, commit.snapshot, ctx);
  // คำสั่งที่แก้ค่าจำลอง (ยา, ทำความสะอาด, ออกลูก) แต่ snapshot ของเครื่องนั้นไม่ถูกรับ → บังคับทุกเครื่องรับค่าจากคลาวด์
  for (const tankId of ctx.simTouched) {
    if (snapshot[tankId] === 'accepted') continue;
    const tm = tankMeta(meta, tankId);
    tm.simRev = (tm.simRev ?? 0) + 1;
    tm.simBy = '*';
  }

  meta.writers[commit.writer] = { seq: commit.seq, at: now };
  pruneMeta(doc, now);
  doc.revision += 1;
  doc.updatedAt = now;
  doc.updatedBy = commit.writer;
  game.lastSaved = now;
  return { doc, results, snapshot, duplicate: false };
}

/** ใช้ฝั่งเว็บ: เล่นคำสั่งที่ยังไม่ถูกบันทึกซ้ำบนข้อมูลล่าสุดจากคลาวด์ (คำสั่งที่ไม่ผ่านถูกข้ามไป) */
export function replayCommands(game, meta, commands, writer) {
  for (const cmd of commands) {
    const now = cmd.at ?? Date.now();
    try {
      applyCommand(game, meta, cmd, { now, day: todayKey(new Date(now)), writer, predict: true, simTouched: null });
    } catch (err) {
      if (!(err instanceof CommandError)) console.warn('replay failed', cmd?.type, err);
    }
  }
}

export { SIM_FIELDS };
