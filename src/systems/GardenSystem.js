import { CONFIG } from '../config.js';
import { SUNFLOWER_MODEL, Sunflower } from '../world/Sunflower.js';
import { applySunflowerAction, isDead, seedsReadyAt, sunflowerAt, sunflowerBlock, sunflowerStage } from '../shared/garden.js';

/** คำสั่งเซฟกลางของการดูแลแต่ละแบบ (shared/commands.js) */
const COMMANDS = { plant: 'plantSunflower', water: 'waterSunflower', fertilize: 'fertilizeSunflower', harvest: 'harvestSunflower' };

/** ข้อความเมื่อทำไม่ได้ (เหตุผลจาก shared/garden.js sunflowerBlock) */
const BLOCK_TEXT = {
  'already-planted': 'ปลูกไว้แล้ว',
  'not-planted': 'ยังไม่ได้ปลูก — ปลูกเมล็ดก่อนนะ',
  dead: 'ต้นทานตะวันตายแล้ว — ปลูกเมล็ดใหม่ได้',
  'too-wet': 'ดินยังชุ่มอยู่ รดน้ำมากไปรากจะเน่า',
  'too-full': 'ปุ๋ยในดินยังเหลือเยอะ ใส่เพิ่มตอนนี้ไม่ได้',
  'not-ready': 'เมล็ดยังไม่แก่ รออีกหน่อยนะ',
};

/**
 * กระถางทานตะวันข้างตู้: ฝั่งเกมของ shared/garden.js
 * - คำนวณสถานะปัจจุบันจากเซฟ + นาฬิกาจริง (วินาทีละครั้ง) แล้วส่งให้โมเดล 3 มิติ (world/Sunflower.js)
 * - ปลูก / รดน้ำ / ใส่ปุ๋ย / เก็บเมล็ด: ตรวจกฎเดียวกับเซิร์ฟเวอร์ แก้เซฟในเครื่อง แล้วส่งคำสั่งให้เซฟกลางตรวจซ้ำ
 * - เตือนผู้เล่นเมื่อดินแห้ง ต้นอ่อนแอ/ตาย ดอกบาน หรือเมล็ดพร้อมเก็บ (ครั้งเดียวต่อการเปลี่ยนสถานะ)
 */
export class GardenSystem {
  constructor(game) {
    this.game = game;
    this.plant = new Sunflower(game.sceneMgr.scene);
    this.timer = 0;
    /** สถานะที่แจ้งไปแล้ว (null = ยังไม่เคยดู → ครั้งแรกไม่แจ้งการเปลี่ยนแปลง) */
    this.flags = null;
    this.greeted = false;
    this.status = this.current();
  }

  /** ข้อมูลในเซฟ (ค่า ณ เวลาที่ดูแลครั้งล่าสุด) */
  get record() {
    return this.game.state.data.sunflower ?? null;
  }

  /** สถานะ ณ ตอนนี้ (null = กระถางว่าง) */
  current(now = Date.now()) {
    return sunflowerAt(this.record, now);
  }

  /** วางกระถางข้างตู้ที่เพิ่งโหลด — ใช้ไฟล์โมเดลทานตะวันถ้าโหลดได้ (ไม่มีไฟล์ = โมเดลชั่วคราวจากโค้ด) */
  place(dims) {
    const found = this.plant.model ? null : this.game.assets.first([SUNFLOWER_MODEL]);
    if (found) this.plant.useModel(this.game.assets.instantiate(found.gltf).scene);
    this.plant.place(dims);
    this.#refresh({ immediate: true });
  }

  /** เหตุผลที่ทำไม่ได้ตอนนี้ (null = ทำได้) — ใช้กับปุ่มใน UI */
  blockOf(action, now = Date.now()) {
    return sunflowerBlock(action, this.current(now), now);
  }

  blockText(code) {
    return BLOCK_TEXT[code] ?? 'ทำไม่ได้ตอนนี้';
  }

  seedsReadyIn(now = Date.now()) {
    return Math.max(0, (seedsReadyAt(this.status) - now) / 1000);
  }

  /** ต้องการการดูแล (ไว้แสดงจุดแดงบนปุ่ม) */
  get needsCare() {
    const s = this.status;
    if (!s || isDead(s)) return true;
    return s.water < CONFIG.garden.thirstyBelow || Date.now() >= seedsReadyAt(s);
  }

  /** @param {'plant'|'water'|'fertilize'|'harvest'} action */
  act(action) {
    const game = this.game;
    const g = CONFIG.garden;
    const now = Date.now();
    const cur = this.current(now);
    const block = sunflowerBlock(action, cur, now);
    if (block) return this.#denied(BLOCK_TEXT[block]);
    const price = action === 'plant' ? g.seedPrice : action === 'fertilize' ? g.fertilizerPrice : null;
    if (price && !game.state.spend(price)) return this.#denied('เหรียญไม่พอ');

    game.state.data.sunflower = applySunflowerAction(action, cur, now);
    game.state.record({ type: COMMANDS[action] });
    this.plant.play(action);
    if (action === 'harvest') {
      game.state.earn(g.seedReward);
      game.ui.floatText(this.plant.flowerPosition(), `+${g.seedReward.coins}`, 'coin');
      game.sound.play('coin');
      game.ui.toast(`🌻 เก็บเมล็ดทานตะวันได้ ${g.seedReward.coins} เหรียญ อีก ${g.seedHours} ชม. เก็บได้อีกรอบ`, 'success');
    } else if (action === 'plant') {
      game.sound.play('place');
      game.ui.toast('🌱 ปลูกเมล็ดทานตะวันแล้ว อย่าลืมรดน้ำและใส่ปุ๋ยนะ', 'success');
    } else {
      game.sound.play(action === 'water' ? 'splash' : 'buy');
      game.ui.toast(action === 'water' ? '💧 รดน้ำแล้ว ต้นทานตะวันชุ่มชื่น' : '🧪 ใส่ปุ๋ยแล้ว ต้นทานตะวันจะโตเร็วขึ้น', 'success');
    }
    this.#refresh();
    game.state.save();
    return true;
  }

  pick(ray) {
    return this.plant.pick(ray);
  }

  update(dt, time) {
    this.plant.update(dt, time, this.game.sceneMgr.camera);
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1;
    this.#refresh();
  }

  #refresh({ immediate = false } = {}) {
    const g = CONFIG.garden;
    const now = Date.now();
    const s = this.current(now);
    this.status = s;
    const ripe = !!s && !isDead(s) && now >= seedsReadyAt(s);
    this.plant.show(s, { ripe, thirstyBelow: g.thirstyBelow, immediate });
    this.plant.setBadge(!s ? '🌱' : isDead(s) ? '🥀' : s.water < g.thirstyBelow ? '💧' : ripe ? '✨' : null);
    this.#alerts(s, ripe);
  }

  /** แจ้งเตือนเมื่อสถานะเปลี่ยน (ไม่แจ้งซ้ำ) และสรุปครั้งเดียวตอนเริ่มเล่นถ้าต้นไม้ต้องการการดูแล */
  #alerts(s, ripe) {
    const g = CONFIG.garden;
    const flags = {
      planted: !!s,
      dead: isDead(s),
      thirsty: !!s && !isDead(s) && s.water < g.thirstyBelow,
      weak: !!s && !isDead(s) && s.health < 40,
      bloom: !!s && !isDead(s) && sunflowerStage(s).id === 'bloom',
      ripe,
    };
    const prev = this.flags;
    this.flags = flags;
    const ui = this.game.ui;
    if (!this.game.started) return;
    if (!this.greeted) {
      this.greeted = true;
      if (flags.dead) ui.toast('🥀 ต้นทานตะวันข้างตู้เหี่ยวตายระหว่างที่ไม่อยู่ — แตะกระถางเพื่อปลูกใหม่', 'warn');
      else if (flags.thirsty) ui.toast('💧 ดินในกระถางทานตะวันแห้งแล้ว — แตะกระถางเพื่อรดน้ำ', 'warn');
      else if (ripe) ui.toast('✨ เมล็ดทานตะวันแก่แล้ว แตะกระถางเพื่อเก็บ');
      return;
    }
    if (!prev || prev.planted !== flags.planted) return; // เพิ่งปลูก/โหลดใหม่
    if (flags.dead && !prev.dead) {
      ui.toast('🥀 ต้นทานตะวันเหี่ยวตายแล้ว… ปลูกเมล็ดใหม่ได้ที่กระถาง', 'warn');
      this.game.sound.play('sad');
    } else if (flags.thirsty && !prev.thirsty) ui.toast('💧 ต้นทานตะวันเริ่มเหี่ยว ดินแห้งแล้ว — รดน้ำหน่อยนะ', 'warn');
    else if (flags.weak && !prev.weak) ui.toast('🍂 ต้นทานตะวันอ่อนแอลง รีบรดน้ำก่อนจะเหี่ยวตาย', 'warn');
    if (flags.bloom && !prev.bloom) {
      ui.toast('🌻 ดอกทานตะวันบานแล้ว! อีกไม่นานจะเก็บเมล็ดได้', 'success');
      this.game.sound.play('mission');
    } else if (ripe && !prev.ripe) ui.toast('✨ เมล็ดทานตะวันแก่แล้ว แตะกระถางเพื่อเก็บ');
  }

  #denied(message) {
    this.game.sound.play('error');
    this.game.ui.toast(message, 'warn');
    return false;
  }
}
