import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Farm, COW_AREA, FARM_MODELS } from '../world/Farm.js';
import { Cow, COW_MODEL } from '../entities/Cow.js';
import { COW_BREEDS, getCowBreed } from '../data/animals.js';
import { COW_NAMES, applyCowAction, buyCowBlock, cowAt, cowBlock, cowSellValue, farmAt, findCow, isCowDead, newCow } from '../shared/farm.js';
import { pick, uid } from '../utils/math.js';

/** คำสั่งเซฟกลางของการดูแลแต่ละแบบ (shared/commands.js) */
const COMMANDS = { feed: 'feedCow', milk: 'milkCow' };

/** ข้อความเมื่อทำไม่ได้ (เหตุผลจาก shared/farm.js) */
const BLOCK_TEXT = {
  'not-found': 'ไม่พบวัวตัวนี้แล้ว',
  dead: 'วัวตัวนี้ตายแล้ว',
  'too-full': 'วัวยังอิ่มอยู่ ให้ฟางเพิ่มตอนนี้ไม่ได้',
  'not-ready': `นมยังน้อยอยู่ (ต้องมีอย่างน้อย ${CONFIG.farm.milkMin}%)`,
  limit: `คอกเต็มแล้ว (เลี้ยงได้สูงสุด ${CONFIG.farm.maxCows} ตัว)`,
  'remove-dead': 'นำวัวที่ตายแล้วออกจากคอกก่อน จึงจะซื้อตัวใหม่ได้',
  invalid: 'ทำไม่ได้ตอนนี้',
};

/**
 * ฟาร์มนอกบ้าน: ฝั่งเกมของ shared/farm.js (แบบเดียวกับ GardenSystem ของกระถางทานตะวัน)
 * - สร้างฉากฟาร์ม (world/Farm.js) ครั้งแรกตอนออกนอกบ้าน — ผู้เล่นที่ไม่เคยออกไปไม่เสียหน่วยความจำ/เวลาโหลด
 * - คำนวณสถานะวัวจากเซฟ + นาฬิกาจริง (วินาทีละครั้ง แม้อยู่ในบ้าน) แล้วส่งให้วัวแต่ละตัว (entities/Cow.js)
 * - ซื้อ / ให้ฟาง / รีดนม / ขาย: ตรวจกฎเดียวกับฝั่งตรวจ แก้เซฟในเครื่อง แล้วส่งคำสั่งให้เซฟกลางตรวจซ้ำ
 * - เตือนผู้เล่นเมื่อวัวหิว นมเต็ม ป่วย หรือตาย (ครั้งเดียวต่อการเปลี่ยนสถานะ)
 */
export class FarmSystem {
  constructor(game) {
    this.game = game;
    /** @type {Farm | null} */
    this.world = null;
    /** @type {Map<string, Cow>} */
    this.cows = new Map();
    this.active = false;
    this.timer = 0;
    /** โมเดลวัวจริง + ภาพผิวแต่ละสายพันธุ์ (โหลดครั้งแรกตอนออกนอกบ้าน) */
    this.cowGltf = null;
    this.skins = new Map();
    this.modelsRequested = false;
    /** สถานะที่แจ้งไปแล้วของวัวแต่ละตัว (null = ยังไม่เคยดู → ครั้งแรกไม่แจ้งการเปลี่ยนแปลง) */
    this.flags = null;
    this.greeted = false;
    this.welcomed = false;
    this.status = this.current();
  }

  /** ข้อมูลในเซฟ (ไม่มี = ยังไม่เคยซื้อวัว) */
  get record() {
    return this.game.state.data.farm ?? null;
  }

  /** สถานะ ณ ตอนนี้ (null = ยังไม่มีฟาร์ม) */
  current(now = Date.now()) {
    return farmAt(this.record, now);
  }

  get herd() {
    return this.status?.cows ?? [];
  }

  get cowCount() {
    return this.herd.filter((c) => !isCowDead(c)).length;
  }

  cowStatus(id) {
    return this.herd.find((c) => c.id === id) ?? null;
  }

  /** ต้องการการดูแล (จุดแดงบนปุ่ม): หิว · นมเต็ม · ตายค้างในคอก */
  get needsCare() {
    const f = CONFIG.farm;
    return this.herd.some((c) => isCowDead(c) || c.satiety < f.hungryBelow || c.milk >= f.milkFullAbove);
  }

  // ── ฉาก ─────────────────────────────────────────────────────

  /** ออกนอกบ้าน: สร้างฉาก (ครั้งแรก) แล้วสลับ renderer + กล้องมาที่ฟาร์ม */
  enter() {
    const sceneMgr = this.game.sceneMgr;
    this.world ??= new Farm(sceneMgr);
    this.active = true;
    this.#refresh();
    sceneMgr.showScene(this.world.scene);
    sceneMgr.frameArea(this.world.view);
    this.#loadModels();
    if (!this.herd.length && !this.welcomed) {
      this.welcomed = true;
      setTimeout(() => this.game.ui.toast('🐄 คอกยังว่างอยู่ — กดปุ่ม "วัว" ทางซ้ายเพื่อซื้อวัวตัวแรก'), 700);
    }
  }

  leave() {
    this.active = false;
  }

  /** โหลดโมเดลจริงของฟาร์มเบื้องหลัง — ระหว่างรอเห็นโมเดลชั่วคราว แล้วสลับเมื่อเสร็จ */
  async #loadModels() {
    if (this.modelsRequested) return;
    this.modelsRequested = true;
    const assets = this.game.assets;
    await assets.preload([...Object.values(FARM_MODELS), COW_MODEL]);
    const got = (url) => assets.models.get(url) ?? null;
    this.world.useModels(Object.fromEntries(Object.entries(FARM_MODELS).map(([k, url]) => [k, got(url)])));
    this.cowGltf = got(COW_MODEL);
    if (!this.cowGltf) return;
    const loader = new THREE.TextureLoader();
    await Promise.all(
      [...new Set(COW_BREEDS.map((b) => b.skin).filter(Boolean))].map(async (url) => {
        try {
          const tex = await loader.loadAsync(assets.resolve(url));
          tex.flipY = false; // พิกัด UV แบบ glTF
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          this.skins.set(url, tex);
        } catch (err) {
          console.warn(`[farm] โหลดผิววัว ${url} ไม่ได้ ใช้ลายเดิมในไฟล์`, err);
        }
      }),
    );
    // สร้างวัวใหม่ด้วยโมเดลจริง
    for (const cow of this.cows.values()) this.world.animals.remove(cow.group);
    this.cows.clear();
    this.#refresh();
  }

  #cowModel(breed) {
    if (!this.cowGltf) return null;
    const model = this.game.assets.instantiate(this.cowGltf);
    return { ...model, skin: breed.skin ? (this.skins.get(breed.skin) ?? null) : null };
  }

  /** ของที่แตะได้ในฟาร์ม: วัว หรือประตูบ้าน */
  pick(ray) {
    if (!this.world) return null;
    let best = null;
    let bestD = Infinity;
    for (const cow of this.cows.values()) {
      if (!cow.pick(ray)) continue;
      const d = ray.origin.distanceTo(cow.group.position);
      if (d < bestD) {
        bestD = d;
        best = cow;
      }
    }
    if (best) return best;
    return this.world.pickDoor(ray) ? 'door' : null;
  }

  handleTap(ray) {
    const hit = this.pick(ray);
    const game = this.game;
    if (hit === 'door') {
      game.goTo('home');
      return;
    }
    if (!hit) {
      game.ui.cowCard.hide();
      return;
    }
    game.sound.play('click');
    game.ui.cowCard.show(hit.id);
  }

  /** เลื่อนกล้องไปดูวัวตัวนี้ (จากรายการในหน้าต่างฟาร์ม) */
  focus(cowId) {
    const cow = this.cows.get(cowId);
    if (!cow) return;
    const p = cow.group.position;
    const view = this.world.view;
    const offset = view.position.clone().sub(view.target).setLength(7);
    this.game.sceneMgr.flyTo(new THREE.Vector3(p.x, 1, p.z).add(offset), new THREE.Vector3(p.x, 0.9, p.z));
  }

  // ── การกระทำของผู้เล่น ───────────────────────────────────────

  /** เหตุผลที่ซื้อพันธุ์นี้ไม่ได้ตอนนี้ (null = ได้) — ใช้กับปุ่มใน UI (ไม่รวมเรื่องเงิน) */
  buyBlockOf(breedId) {
    return buyCowBlock(this.status, breedId);
  }

  blockOf(action, cowId) {
    return cowBlock(action, this.cowStatus(cowId));
  }

  blockText(code) {
    return BLOCK_TEXT[code] ?? 'ทำไม่ได้ตอนนี้';
  }

  buy(breedId) {
    const game = this.game;
    const breed = getCowBreed(breedId);
    const block = this.buyBlockOf(breedId);
    if (block) return this.#denied(this.blockText(block));
    if (!game.state.spend(breed.price)) return this.#denied('เหรียญไม่พอ');
    const used = new Set(this.herd.map((c) => c.name));
    const name = pick(COW_NAMES.filter((n) => !used.has(n))) ?? breed.name;
    const id = uid('cow');
    const data = game.state.data;
    data.farm ??= { cows: [] };
    data.farm.cows.push(newCow({ id, breedId: breed.id, name }, Date.now()));
    game.state.record({ type: 'buyCow', breedId: breed.id, cowId: id, name });
    game.sound.play('place');
    game.ui.toast(`🐄 "${name}" (${breed.name}) มาอยู่ที่ฟาร์มแล้ว! อย่าลืมให้ฟางนะ`, 'success');
    this.#refresh();
    game.state.save();
    if (this.active) setTimeout(() => this.focus(id), 200);
    return true;
  }

  /** @param {'feed'|'milk'} action */
  act(action, cowId) {
    const game = this.game;
    const f = CONFIG.farm;
    const now = Date.now();
    const rec = findCow(this.record, cowId);
    const cur = cowAt(rec, now);
    const block = cowBlock(action, cur);
    if (block) return this.#denied(this.blockText(block));
    if (action === 'feed' && !game.state.spend(f.hayPrice)) return this.#denied('เหรียญไม่พอ');
    const { cow: next, reward } = applyCowAction(action, cur, now);
    Object.assign(rec, next);
    game.state.record({ type: COMMANDS[action], cowId });
    const cow = this.cows.get(cowId);
    if (action === 'feed') {
      cow?.eat();
      game.sound.play('buy');
      game.ui.toast(`🌾 ให้ฟาง "${rec.name}" แล้ว อิ่มแปล้`, 'success');
    } else {
      game.state.earn(reward);
      cow?.stand();
      if (cow && this.active) game.ui.floatText(cow.topPosition(), `+${reward.coins}`, 'coin');
      game.sound.play('coin');
      game.ui.toast(`🥛 รีดนม "${rec.name}" ได้ ${reward.coins} เหรียญ`, 'success');
    }
    this.#refresh();
    game.state.save();
    return true;
  }

  sellValue(cowId) {
    return cowSellValue(this.cowStatus(cowId));
  }

  /** ขายวัว (ตัวที่ตายแล้ว = นำออกจากคอก) */
  sell(cowId) {
    const game = this.game;
    const rec = findCow(this.record, cowId);
    if (!rec) return this.#denied(this.blockText('not-found'));
    const refund = cowSellValue(cowAt(rec, Date.now()));
    game.state.data.farm.cows = game.state.data.farm.cows.filter((c) => c !== rec);
    game.state.earn(refund);
    game.state.record({ type: 'sellCow', cowId });
    game.sound.play('coin');
    game.ui.toast(refund.coins > 0 ? `ขาย "${rec.name}" ได้ ${refund.coins} เหรียญ` : `นำ "${rec.name}" ออกจากคอกแล้ว`);
    game.ui.cowCard.hide();
    this.#refresh();
    game.state.save();
    return true;
  }

  #denied(message) {
    this.game.sound.play('error');
    this.game.ui.toast(message, 'warn');
    return false;
  }

  // ── ทุกเฟรม ─────────────────────────────────────────────────

  update(dt, time) {
    if (this.active) {
      this.world.update(dt, time);
      for (const cow of this.cows.values()) cow.update(dt, time, this.game.sceneMgr.camera);
    }
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1;
    this.#refresh();
  }

  /** คำนวณสถานะใหม่ แล้วเพิ่ม/ลบ/อัปเดตวัวในฉากให้ตรงกับข้อมูล + แจ้งเตือน */
  #refresh() {
    this.status = this.current();
    this.#alerts();
    if (!this.world) return;
    const f = CONFIG.farm;
    const alive = new Set();
    for (const s of this.herd) {
      const breed = getCowBreed(s.breedId);
      if (!breed) continue;
      alive.add(s.id);
      let cow = this.cows.get(s.id);
      if (!cow) {
        cow = new Cow(s, breed, COW_AREA, this.#cowModel(breed));
        this.cows.set(s.id, cow);
        this.world.animals.add(cow.group);
      }
      cow.show(s);
      cow.setBadge(isCowDead(s) ? null : s.health < 40 ? '🤒' : s.satiety < f.hungryBelow ? '🌾' : s.milk >= f.milkFullAbove ? '🥛' : null);
    }
    for (const [id, cow] of this.cows) {
      if (alive.has(id)) continue;
      this.world.animals.remove(cow.group);
      this.cows.delete(id);
    }
  }

  /** แจ้งเตือนเมื่อสถานะวัวเปลี่ยน (ไม่แจ้งซ้ำ) และสรุปครั้งเดียวตอนเริ่มเล่น */
  #alerts() {
    const f = CONFIG.farm;
    const flags = new Map(
      this.herd.map((c) => [
        c.id,
        {
          name: c.name,
          dead: isCowDead(c),
          hungry: !isCowDead(c) && c.satiety < f.hungryBelow,
          starving: !isCowDead(c) && c.satiety <= 0,
          full: !isCowDead(c) && c.milk >= f.milkFullAbove,
        },
      ]),
    );
    const prev = this.flags;
    this.flags = flags;
    const game = this.game;
    if (!game.started) return;
    if (!this.greeted) {
      this.greeted = true;
      const list = [...flags.values()];
      const dead = list.filter((x) => x.dead).length;
      const hungry = list.filter((x) => x.hungry).length;
      const full = list.filter((x) => x.full).length;
      if (dead) game.ui.toast(`💔 มีวัวตายระหว่างที่ไม่อยู่ ${dead} ตัว — ออกไปดูที่ฟาร์มนอกบ้าน`, 'warn');
      else if (hungry) game.ui.toast(`🌾 วัวหิว ${hungry} ตัว — ออกไปให้ฟางที่ฟาร์มนอกบ้าน`, 'warn');
      else if (full) game.ui.toast(`🥛 นมวัวเต็มเต้าแล้ว ${full} ตัว — ออกไปรีดนมได้เลย`);
      return;
    }
    if (!prev) return;
    for (const [id, now] of flags) {
      const was = prev.get(id);
      if (!was) continue; // เพิ่งซื้อ
      if (now.dead && !was.dead) {
        game.ui.toast(`💔 "${now.name}" อดอาหารนานเกินไปจนตาย…`, 'warn');
        game.sound.play('sad');
      } else if (now.starving && !was.starving) game.ui.toast(`🚨 "${now.name}" ท้องว่างแล้ว เริ่มป่วย — รีบให้ฟาง!`, 'warn');
      else if (now.hungry && !was.hungry) game.ui.toast(`🌾 "${now.name}" เริ่มหิวแล้ว`, 'warn');
      if (now.full && !was.full) game.ui.toast(`🥛 นมของ "${now.name}" เต็มเต้าแล้ว รีดได้เลย`);
    }
  }
}

