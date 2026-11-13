import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Farm, COW_AREA, FARM_MODELS, TROUGH } from '../world/Farm.js';
import { Cow, COW_MODEL } from '../entities/Cow.js';
import { COW_BREEDS, getCowBreed } from '../data/animals.js';
import {
  COW_NAMES,
  PATCH_D,
  PATCH_W,
  adultBreedOf,
  applyBirth,
  applyBreed,
  applyCowAction,
  birthBlock,
  breedBlock,
  buyCowBlock,
  canBreed,
  cowBlock,
  cowSellValue,
  dueAt,
  farmAt,
  findCow,
  grassBlock,
  grassOf,
  grazePatch,
  isBull,
  isCalf,
  isCowDead,
  isPregnant,
  newCalf,
  newCow,
  newGrass,
  patchAt,
  patchCenter,
  waterPatch,
} from '../shared/farm.js';
import { pick, uid } from '../utils/math.js';

/** คำสั่งเซฟกลางของการดูแลแต่ละแบบ (shared/commands.js) */
const COMMANDS = { feed: 'feedCow', milk: 'milkCow' };
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const _hit = new THREE.Vector3();

const BREEDING = CONFIG.farm.breeding;
/** ข้อความเมื่อทำไม่ได้ (เหตุผลจาก shared/farm.js) */
const BLOCK_TEXT = {
  'not-found': 'ไม่พบวัวตัวนี้แล้ว',
  dead: 'วัวตัวนี้ตายแล้ว',
  'too-full': 'วัวยังอิ่มอยู่ ให้ฟางเพิ่มตอนนี้ไม่ได้',
  'not-ready': `นมยังน้อยอยู่ (ต้องมีอย่างน้อย ${CONFIG.farm.milkMin}%)`,
  limit: `คอกเต็มแล้ว (เลี้ยงได้สูงสุด ${CONFIG.farm.maxCows} ตัว)`,
  'remove-dead': 'นำวัวที่ตายแล้วออกจากคอกก่อน จึงจะซื้อตัวใหม่ได้',
  male: '♂ วัวตัวผู้ ไม่ให้นม',
  'not-female': 'ผสมพันธุ์ได้จากแม่วัว (ตัวเมีย ♀) เท่านั้น',
  'not-male': 'ต้องมีพ่อพันธุ์ (ตัวผู้ ♂)',
  'no-bull': 'ยังไม่มีพ่อพันธุ์บราห์มันในคอก — ซื้อวัวบราห์มันตัวผู้ ♂ ก่อน',
  breed: 'ผสมพันธุ์ได้เฉพาะวัวบราห์มัน',
  young: 'ยังเป็นลูกวัวอยู่ รอให้โตเต็มวัยก่อนจึงผสมพันธุ์ได้',
  pregnant: 'ตั้งท้องอยู่แล้ว',
  cooldown: `เพิ่งผสมพันธุ์ไป ต้องพักให้ครบ ${BREEDING.cooldownHours} ชม. ก่อน`,
  weak: `ต้องสุขภาพอย่างน้อย ${BREEDING.minHealth}% และอิ่มอย่างน้อย ${BREEDING.minSatiety}% ทั้งแม่วัวและพ่อพันธุ์`,
  'not-pregnant': 'วัวตัวนี้ไม่ได้ตั้งท้อง',
  invalid: 'ทำไม่ได้ตอนนี้',
};
/** ข้อความเฉพาะการกระทำ (รหัสเดียวกันแต่ความหมายต่างกัน) */
const ACTION_TEXT = {
  breed: { 'not-found': 'ไม่พบวัวตัวนี้แล้ว', dead: 'แม่วัวหรือพ่อพันธุ์ตายแล้ว', young: 'แม่วัวหรือพ่อพันธุ์ยังเป็นลูกวัวอยู่ รอให้โตก่อน' },
  birth: {
    'not-ready': 'ยังไม่ครบกำหนดคลอด',
    limit: `คอกเต็มแล้ว (สูงสุด ${CONFIG.farm.maxCows} ตัว) — ขายวัวสักตัวก่อนจึงจะคลอดลูกได้`,
    'remove-dead': 'นำวัวที่ตายแล้วออกจากคอกก่อน จึงจะคลอดลูกได้',
  },
};
/** ขนาดตัวตามเพศ (ตัวผู้ตัวโตกว่าเล็กน้อย) — เฉพาะสายพันธุ์ที่มีเพศ (canBreed) ที่เหลือขนาดเดิม */
const SEX_SCALE = { m: 1.06, f: 0.97 };
/** ลูกวัวที่มีไฟล์ของตัวเองแต่ไฟล์ยังโหลดไม่ได้ → ย่อโมเดลตัวโตเท่านี้แทน */
const CALF_FALLBACK_SCALE = 0.55;

/**
 * ฟาร์มนอกบ้าน: ฝั่งเกมของ shared/farm.js (แบบเดียวกับ GardenSystem ของกระถางทานตะวัน)
 * - สร้างฉากฟาร์ม (world/Farm.js) ครั้งแรกตอนออกนอกบ้าน — ผู้เล่นที่ไม่เคยออกไปไม่เสียหน่วยความจำ/เวลาโหลด
 * - คำนวณสถานะวัวจากเซฟ + นาฬิกาจริง (วินาทีละครั้ง แม้อยู่ในบ้าน) แล้วส่งให้วัวแต่ละตัว (entities/Cow.js)
 * - ซื้อ (บราห์มัน/canBreed เลือกเพศ ♀/♂ · พันธุ์อื่นเป็นตัวเมียเสมอ) / ให้ฟาง / รีดนม / ขาย / ผสมพันธุ์ / คลอดลูก: ตรวจกฎเดียวกับฝั่งตรวจ แก้เซฟในเครื่อง แล้วส่งคำสั่งให้เซฟกลางตรวจซ้ำ
 * - ผสมพันธุ์ (breed): เลือกพ่อพันธุ์ที่ผสมได้ตัวใกล้ที่สุดให้เอง → แม่ตั้งท้องทันทีในเซฟ แล้วเล่นฉากในคอก
 *   (ตัวเมียยืนนิ่ง ตัวผู้เดินมาด้านหลังแล้วเล่นคลิป Mount มีหัวใจลอย — entities/Cow.js holdStill / mate)
 * - คลอดลูก (birth): ครบกำหนดแล้วผู้เล่นกดเอง → ลูกวัวเพศสุ่มเกิดข้างแม่ โตเต็มวัยตามเวลาจริง
 * - หน้าตา: ตัวผู้ใหญ่กว่าตัวเมียเล็กน้อย · ลูกวัวใช้ adultBreedOf(c).young (ไฟล์ของตัวเอง หรือย่อโมเดลตัวโต)
 * - เตือนผู้เล่นเมื่อวัวหิว นมเต็ม ป่วย ตาย หรือครบกำหนดคลอด (ครั้งเดียวต่อการเปลี่ยนสถานะ)
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
    /** โมเดลวัวจริงตามไฟล์ (COW_MODEL + breed.model.file) + ภาพผิวแต่ละสายพันธุ์ (โหลดครั้งแรกตอนออกนอกบ้าน) */
    this.cowGltfs = new Map();
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

  /** ต้องการการดูแล (จุดแดงบนปุ่ม): หิว · นมเต็ม · ครบกำหนดคลอด · ตายค้างในคอก */
  get needsCare() {
    const f = CONFIG.farm;
    return this.herd.some((c) => isCowDead(c) || c.satiety < f.hungryBelow || c.milk >= f.milkFullAbove || this.isDue(c));
  }

  /** ท้องครบกำหนดคลอดแล้ว (c = สถานะจาก farmAt) */
  isDue(c) {
    return !isCowDead(c) && isPregnant(c) && c.at >= dueAt(c);
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
    const cowFiles = [...new Set([COW_MODEL, ...COW_BREEDS.flatMap((b) => [b.model?.file, b.young?.file]).filter(Boolean)])];
    await assets.preload([...Object.values(FARM_MODELS), ...cowFiles]);
    const got = (url) => assets.models.get(url) ?? null;
    this.world.useModels(Object.fromEntries(Object.entries(FARM_MODELS).map(([k, url]) => [k, got(url)])));
    for (const url of cowFiles) if (got(url)) this.cowGltfs.set(url, got(url));
    if (!this.cowGltfs.size) return;
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

  /**
   * โมเดล + ขนาดของวัวตัวนี้ → { model, opts } (model = null → โมเดลชั่วคราว/ยังโหลดไม่เสร็จ)
   * หน้าตาตามสายพันธุ์ตัวเต็มวัย (adultBreedOf): ไฟล์ของตัวเอง → ไม่มี/โหลดไม่ได้ ใช้วัวมาตรฐาน + ภาพผิว
   * young = ยังเป็นลูกวัว → adult.young: มี file = ไฟล์ลูกวัว (ขนาดในไฟล์ × young.scale) · ไม่มี = ย่อโมเดลตัวโตด้วย young.scale
   * ขนาดคูณตามเพศอีกที (SEX_SCALE)
   */
  #cowModel(s, young = false) {
    const adult = adultBreedOf(s) ?? getCowBreed(s.breedId);
    const yv = young ? (adult.young ?? null) : null;
    const calf = yv?.file ? (this.cowGltfs.get(yv.file) ?? null) : null;
    const own = calf ?? (adult.model?.file ? (this.cowGltfs.get(adult.model.file) ?? null) : null);
    const gltf = own ?? this.cowGltfs.get(COW_MODEL);
    const size = calf ? (yv.scale ?? 1) : (adult.model?.scale ?? 1) * (yv ? (yv.file ? CALF_FALLBACK_SCALE : (yv.scale ?? 1)) : 1);
    const opts = {
      scale: size * (canBreed(s) ? (SEX_SCALE[s.sex] ?? SEX_SCALE.f) : 1),
      drinkReach: yv?.drinkReach,
      walkClipSpeed: yv?.walkClipSpeed,
    };
    if (!gltf) return { model: null, opts };
    const model = this.game.assets.instantiate(gltf);
    return { model: { ...model, skin: !own && adult.skin ? (this.skins.get(adult.skin) ?? null) : null }, opts };
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
      // แตะพื้นในคอก = รดน้ำแปลงหญ้าตรงนั้น
      if (this.world && ray.intersectPlane(GROUND, _hit)) {
        const patch = patchAt(_hit.x, _hit.z);
        if (patch >= 0) this.water(patch);
      }
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

  /** @param {string} code @param {'breed'|'birth'|string} [action] */
  blockText(code, action = '') {
    return ACTION_TEXT[action]?.[code] ?? BLOCK_TEXT[code] ?? 'ทำไม่ได้ตอนนี้';
  }

  /**
   * พ่อพันธุ์ที่จะผสมกับแม่วัว cowId (farm = สถานะจาก farmAt) → { bull, block }
   * เลือกตัวที่ผสมได้ (breedBlock = null) ที่ยืนใกล้แม่วัวที่สุดในฉาก · ไม่มีตัวไหนได้ = เหตุผลของตัวที่ใกล้ที่สุด
   */
  #pickBull(farm, cowId, now) {
    const cow = findCow(farm, cowId);
    if (!cow) return { bull: null, block: 'not-found' };
    // ตรวจฝั่งแม่วัวก่อน (เทียบกับพ่อพันธุ์สมมุติที่พร้อมทุกอย่าง) — ข้อความจะได้บอกปัญหาของแม่วัวเอง
    const ideal = { ...cow, id: '', sex: 'm', breedId: adultBreedOf(cow)?.id ?? cow.breedId, born: 0, boughtAt: 0, health: 100, satiety: 100, bredAt: 0, preg: 0 };
    const own = breedBlock(cow, ideal, now);
    if (own) return { bull: null, block: own };
    const at = this.cows.get(cowId)?.group.position;
    const dist = (c) => {
      const p = this.cows.get(c.id)?.group.position;
      return at && p ? at.distanceTo(p) : 0;
    };
    const bulls = farm.cows.filter((c) => c.id !== cowId && isBull(c) && canBreed(c) && !isCowDead(c)).sort((a, b) => dist(a) - dist(b));
    if (!bulls.length) return { bull: null, block: 'no-bull' };
    const ok = bulls.find((b) => !breedBlock(cow, b, now));
    return ok ? { bull: ok, block: null } : { bull: null, block: breedBlock(cow, bulls[0], now) };
  }

  /** เหตุผลที่ผสมพันธุ์แม่วัวตัวนี้ไม่ได้ตอนนี้ (null = ได้) — ใช้กับปุ่มใน UI */
  breedBlockOf(cowId) {
    if (!this.status) return 'not-found';
    return this.#pickBull(this.status, cowId, Date.now()).block;
  }

  /** เหตุผลที่คลอดลูกไม่ได้ตอนนี้ (null = ได้) */
  birthBlockOf(cowId) {
    return birthBlock(this.status, this.cowStatus(cowId), Date.now());
  }

  /** ผสมพันธุ์แม่วัว cowId กับพ่อพันธุ์ที่ผสมได้ตัวใกล้ที่สุด (ฟรี) → แม่ตั้งท้อง แล้วเล่นฉากในคอก */
  breed(cowId) {
    const game = this.game;
    const now = Date.now();
    const settled = farmAt(this.record, now);
    if (!settled) return this.#denied(this.blockText('not-found', 'breed'));
    const { bull, block } = this.#pickBull(settled, cowId, now);
    if (block || !bull) return this.#denied(this.blockText(block ?? 'no-bull', 'breed'));
    const cow = findCow(settled, cowId);
    const next = applyBreed(cow, bull, now);
    Object.assign(cow, next.cow);
    Object.assign(bull, next.bull);
    game.state.data.farm = settled;
    game.state.record({ type: 'breedCow', cowId, bullId: bull.id });
    game.sound.play('mission');
    game.ui.toast(
      `💕 "${cow.name}" ผสมพันธุ์กับ "${bull.name}" แล้ว — ตั้งท้อง ${BREEDING.gestationHours} ชม. แล้วกลับมาทำคลอดนะ`,
      'success',
    );
    this.#refresh();
    game.state.save();
    this.#mateScene(cowId, bull.id);
    return true;
  }

  /** ฉากผสมพันธุ์ในคอก (แค่ภาพ — เซฟเปลี่ยนไปแล้ว ตัวใดตัวหนึ่งตาย/ถูกขายระหว่างนั้น = ฉากจบเอง) */
  #mateScene(cowId, bullId) {
    const cow = this.cows.get(cowId);
    const bull = this.cows.get(bullId);
    if (!this.active || !cow || !bull) return;
    cow.holdStill();
    bull.mate(cow);
    this.focus(cowId);
  }

  /** แม่วัวที่ครบกำหนดคลอดลูก: ลูกวัวเพศสุ่ม ชื่อสุ่ม เกิดข้างแม่ */
  birth(cowId) {
    const game = this.game;
    const now = Date.now();
    const settled = farmAt(this.record, now);
    const mother = findCow(settled, cowId);
    const block = birthBlock(settled, mother, now);
    if (block) return this.#denied(this.blockText(block, 'birth'));
    const used = new Set(settled.cows.map((c) => c.name));
    const name = pick(COW_NAMES.filter((n) => !used.has(n))) ?? `ลูก${mother.name}`;
    const sex = Math.random() < 0.5 ? 'f' : 'm';
    const calfId = uid('cow');
    // ลำดับเดียวกับฝั่งตรวจ (shared/commands.js birthCalf): เพิ่มลูกท้ายรายการ แล้วแม่หายท้อง
    settled.cows.push(newCalf({ id: calfId, name, sex }, mother, now));
    Object.assign(mother, applyBirth(mother, now));
    game.state.data.farm = settled;
    game.state.record({ type: 'birthCalf', cowId, calfId, name, sex });
    game.sound.play('born');
    game.ui.toast(`🍼 "${mother.name}" คลอดลูกแล้ว! ลูกวัว${sex === 'm' ? 'ตัวผู้ ♂' : 'ตัวเมีย ♀'} ชื่อ "${name}"`, 'success');
    this.#refresh();
    // ลูกวัวเกิดข้างแม่ หันทางเดียวกัน
    const mom3d = this.cows.get(cowId);
    const calf3d = this.cows.get(calfId);
    if (mom3d && calf3d) {
      const g = mom3d.group;
      const side = Math.random() < 0.5 ? -1 : 1;
      calf3d.group.position.set(
        THREE.MathUtils.clamp(g.position.x + Math.cos(g.rotation.y) * side * 1.3, COW_AREA.minX, COW_AREA.maxX),
        0,
        THREE.MathUtils.clamp(g.position.z - Math.sin(g.rotation.y) * side * 1.3, COW_AREA.minZ, COW_AREA.maxZ),
      );
      calf3d.group.rotation.y = g.rotation.y;
      calf3d.stand();
      mom3d.stand();
    }
    game.state.save();
    if (this.active) this.focus(cowId);
    return true;
  }

  /** @param {'f'|'m'} [sex] */
  buy(breedId, sex = 'f') {
    const game = this.game;
    const breed = getCowBreed(breedId);
    if (!breed?.canBreed) sex = 'f'; // โฮลสไตน์/เจอร์ซีย์ (โมเดลชั่วคราว) เป็นตัวเมียเสมอ
    const block = this.buyBlockOf(breedId);
    if (block) return this.#denied(this.blockText(block));
    if (!game.state.spend(breed.price)) return this.#denied('เหรียญไม่พอ');
    const used = new Set(this.herd.map((c) => c.name));
    const name = pick(COW_NAMES.filter((n) => !used.has(n))) ?? breed.name;
    const id = uid('cow');
    const data = game.state.data;
    data.farm ??= { cows: [], grass: newGrass(Date.now()) };
    data.farm.cows.push(newCow({ id, breedId: breed.id, name, sex }, Date.now()));
    game.state.record({ type: 'buyCow', breedId: breed.id, cowId: id, name, sex });
    game.sound.play('place');
    game.ui.toast(`🐄 "${name}" ${breed.canBreed ? (sex === 'm' ? '♂ ' : '♀ ') : ''}(${breed.name}) มาอยู่ที่ฟาร์มแล้ว! อย่าลืมให้ฟางนะ`, 'success');
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
    // เดินเวลาทั้งฟาร์ม (วัวทุกตัว + หญ้า) ถึงตอนนี้ แบบเดียวกับฝั่งตรวจ (shared/commands.js settleFarm)
    const settled = farmAt(this.record, now);
    const rec = findCow(settled, cowId);
    const block = cowBlock(action, rec);
    if (block) return this.#denied(this.blockText(block));
    if (action === 'feed' && !game.state.spend(f.hayPrice)) return this.#denied('เหรียญไม่พอ');
    const { cow: next, reward } = applyCowAction(action, rec, now);
    Object.assign(rec, next);
    game.state.data.farm = settled;
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
    if (!findCow(this.record, cowId)) return this.#denied(this.blockText('not-found'));
    const settled = farmAt(this.record, Date.now());
    const rec = findCow(settled, cowId);
    const refund = cowSellValue(rec);
    settled.cows = settled.cows.filter((c) => c !== rec);
    game.state.data.farm = settled;
    game.state.earn(refund);
    game.state.record({ type: 'sellCow', cowId });
    game.sound.play('coin');
    game.ui.toast(refund.coins > 0 ? `ขาย "${rec.name}" ได้ ${refund.coins} เหรียญ` : `นำ "${rec.name}" ออกจากคอกแล้ว`);
    game.ui.cowCard.hide();
    this.#refresh();
    game.state.save();
    return true;
  }

  /** รดน้ำแปลงหญ้า i (แตะพื้นในคอก) — ฟรี · ดินยังชื้นอยู่ = ยังรดไม่ได้ */
  water(patch) {
    const game = this.game;
    const now = Date.now();
    const settled = farmAt(this.record ?? { cows: [], grass: newGrass(now) }, now);
    if (grassBlock(settled.grass, patch)) {
      game.ui.toast('💧 ดินแปลงนี้ยังชื้นอยู่ ไว้ให้แห้งลงก่อนค่อยรดอีกนะ');
      return false;
    }
    settled.grass = waterPatch(settled.grass, patch, now);
    game.state.data.farm = settled;
    game.state.record({ type: 'waterGrass', patch });
    game.sound.play('splash');
    this.world?.grass.splash(patch);
    this.#refresh();
    game.state.save();
    return true;
  }

  /** สถานะหญ้าตอนนี้ (ยังไม่มีฟาร์ม = หญ้าเต็มทั้งคอก) */
  get grass() {
    return grassOf(this.status, Date.now());
  }

  /** จุดที่วัวตัวนี้ควรไปเล็มหญ้า (แปลงเดียวกับที่สูตรในเซฟให้มันกิน) · null = อิ่มแล้ว/หญ้าหมด */
  #grazeSpot(cowId) {
    const p = grazePatch(this.status, cowId);
    if (p < 0) return null;
    const c = patchCenter(p);
    const x = c.x + (Math.random() - 0.5) * PATCH_W * 0.6;
    let z = c.z + (Math.random() - 0.5) * PATCH_D * 0.6;
    // แปลงที่มีรางน้ำ: ไม่เดินเข้าไปในราง ยืนเล็มหน้ารางแทน
    if (Math.abs(x - TROUGH.x) < TROUGH.width / 2 + 0.8 && Math.abs(z - TROUGH.z) < TROUGH.depth / 2 + 1.2) z = TROUGH.z + TROUGH.depth / 2 + 1.5;
    return new THREE.Vector3(
      THREE.MathUtils.clamp(x, COW_AREA.minX, COW_AREA.maxX),
      0,
      THREE.MathUtils.clamp(z, COW_AREA.minZ, COW_AREA.maxZ),
    );
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
    this.world.grass.show(this.grass);
    const f = CONFIG.farm;
    const alive = new Set();
    const now = Date.now();
    for (const s of this.herd) {
      const breed = getCowBreed(s.breedId);
      if (!breed) continue;
      alive.add(s.id);
      let cow = this.cows.get(s.id);
      const young = isCalf(s, now);
      // ลูกวัวเพิ่งโตเต็มวัย → สลับเป็นโมเดลตัวโต ยืนที่เดิม
      if (cow && cow.young !== young && this.cowGltfs.size) {
        this.world.animals.remove(cow.group);
        const { position, rotation } = cow.group;
        cow = this.#spawnCow(s, breed, young);
        cow.group.position.copy(position);
        cow.group.rotation.y = rotation.y;
      }
      if (!cow) cow = this.#spawnCow(s, breed, young);
      cow.show(s);
      cow.setBadge(
        isCowDead(s)
          ? null
          : s.health < 40
            ? '🤒'
            : s.satiety < f.hungryBelow
              ? '🌾'
              : this.isDue(s)
                ? '🍼'
                : s.milk >= f.milkFullAbove
                  ? '🥛'
                  : null,
      );
    }
    for (const [id, cow] of this.cows) {
      if (alive.has(id)) continue;
      this.world.animals.remove(cow.group);
      this.cows.delete(id);
    }
  }

  #spawnCow(s, breed, young) {
    const { model, opts } = this.#cowModel(s, young);
    const cow = new Cow(s, breed, COW_AREA, model, opts);
    cow.young = young;
    cow.grazeSpot = () => this.#grazeSpot(s.id);
    this.cows.set(s.id, cow);
    this.world.animals.add(cow.group);
    return cow;
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
          calf: isCalf(c, c.at),
          bull: isBull(c),
          due: this.isDue(c),
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
      const due = list.filter((x) => x.due).length;
      if (due) game.ui.toast(`🍼 แม่วัวครบกำหนดคลอดแล้ว ${due} ตัว — ออกไปทำคลอดที่ฟาร์มนอกบ้าน`, 'success');
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
      if (now.due && !was.due) {
        game.ui.toast(`🍼 "${now.name}" ครบกำหนดคลอดแล้ว! แตะที่แม่วัวเพื่อทำคลอด`, 'success');
        game.sound.play('mission');
      }
      if (was.calf && !now.calf && !now.dead) {
        game.ui.toast(`🐂 "${now.name}" โตเป็นวัวเต็มวัยแล้ว! ${now.bull ? 'เป็นพ่อพันธุ์ได้แล้ว' : 'เริ่มให้นมและผสมพันธุ์ได้'}`, 'success');
        game.sound.play('mission');
      }
    }
  }
}

