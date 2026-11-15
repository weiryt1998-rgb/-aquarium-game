import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Farm, BARN_ROUTE, BARN_STALLS, COW_AREA, FARM_MODELS, TROUGH } from '../world/Farm.js';
import { Cow, COW_MODEL } from '../entities/Cow.js';
import { Farmer, FARMER_MODEL } from '../entities/Farmer.js';
import { PEOPLE, Person, PERSON_RADIUS } from '../entities/Person.js';
import { PEN_SPOTS, PEN_STROLL, PersonAI, PEN_HOUSE, MATE_HOUSE } from '../entities/PersonAI.js';
import { FarmNav } from '../world/farmNav.js';
import { blockedAt, buildFarmColliders, resolveCollisions, WALK_BOUNDS } from '../world/farmColliders.js';
import { SocialSystem } from './SocialSystem.js';
import { HouseLife, ACTIVITIES } from './HouseLife.js';
import { HOUSE_NAV } from '../world/House.js';
import { PlayerInput } from './PlayerInput.js';
import { saveSettings } from '../core/settings.js';
import { otherChar, resolveCharacter } from '../cloud/coop.js';
import { cleanName } from '../shared/economy.js';
import { getSocial } from '../data/socials.js';
import { separate, steer } from '../entities/bodySpace.js';
import { COW_BREEDS, getCowBreed } from '../data/animals.js';
import {
  COW_NAMES,
  PATCH_D,
  PATCH_W,
  adultBreedOf,
  applyBarn,
  applyBirth,
  applyBreed,
  applyCowAction,
  barnBlock,
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
  inBarn,
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
const _rc = new THREE.Raycaster();

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
  'in-barn': 'แม่วัวหรือพ่อพันธุ์พักอยู่ในโรงนา — ปล่อยออกคอกก่อนจึงผสมพันธุ์ได้',
  'barn-full': `คอกในโรงนาเต็มแล้ว (${CONFIG.farm.barnStalls} คอก)`,
  already: 'วัวอยู่ที่นั่นแล้ว',
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
/** ขอบที่ตัวในคอกหญ้าถูกดันไปได้ (ในรั้ว เว้นระยะครึ่งตัว) — กันถูกดันทะลุรั้ว */
const PEN_BOUNDS = { minX: COW_AREA.minX - 1, maxX: COW_AREA.maxX + 1, minZ: COW_AREA.minZ - 1, maxZ: COW_AREA.maxZ + 1 };
/** จุดเกิดผู้เล่น: บนทางเดินดินหน้าประตูสวนหน้าบ้าน หันไปทางคอก (+X) */
const PLAYER_SPAWN = { x: -11.4, z: 10.4, heading: Math.PI / 2 };
/** จุดเริ่มของตัวละครอีกตัว (เดินทำกิจวัตรเอง): ในคอกใกล้ประตูหน้า */
const COMPANION_SPAWN = { x: 2.2, z: 5.5, heading: -2.4 };
/** ยายเพ็ญเริ่มที่แปลงผักข้างบ้าน */
const PEN_SPAWN = { x: -21.2, z: 1.75, heading: 0 };
/** กล้องตามผู้เล่น: ถอยหลัง back ม. สูง up ม. จากระดับอก */
const PLAYER_CAM = { back: 4.6, up: 2.2 };
/** กล้องในบ้าน (แบบเกมจำลองชีวิต): มุมสูง ~52° จากแนวตั้ง ระยะ 11 ม. · ลากหมุนรอบได้ · ซูม 5..18 ม. */
const HOUSE_CAM = { dist: 11, polar: 0.92 };
/** ขอบเขตจุดหมุนกล้อง/ระยะซูมตอนตามผู้เล่น (ครอบพื้นที่เดินได้ทั้งหมด) */
const PLAYER_VIEW = {
  center: new THREE.Vector3((WALK_BOUNDS.minX + WALK_BOUNDS.maxX) / 2, 0, (WALK_BOUNDS.minZ + WALK_BOUNDS.maxZ) / 2),
  bounds: { w: WALK_BOUNDS.maxX - WALK_BOUNDS.minX, h: 3, d: WALK_BOUNDS.maxZ - WALK_BOUNDS.minZ },
  minDistance: 2,
  maxDistance: 16,
  maxPolar: 1.45,
};

/** ตาเหมพูดเมื่อทุกอย่างเรียบร้อย */
const FARMER_CHAT = [
  'วัวอิ่มกันทุกตัว ลุงชื่นใจจริง ๆ',
  'อากาศดีนะวันนี้ หญ้าในคอกเขียวดี',
  'วัวพื้นเมืองเลี้ยงง่าย ทนแดดทนฝน ลุงเลี้ยงมาตั้งแต่หนุ่ม ๆ',
  'ถ้าจะให้วัวพักในโรงนา อย่าลืมให้ฟางด้วยนะ ในนั้นไม่มีหญ้า',
  'รีดนมตอนเต้าเต็ม ๆ จะได้เหรียญเยอะกว่านะหลาน',
];
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
 * - โรงนา (barnCow): วัวเดินจากคอกหญ้าผ่านช่องรั้วหลังเข้าคอกในโรงนา (จองคอกให้ตัวละคอก) · แตะประตูโรงนา = กล้องเข้าไปข้างใน
 *   ประตูบานเลื่อนเปิดเองตอนกล้องอยู่ข้างในหรือมีวัวกำลังเดินเข้า/ออก
 * - ตาเหม (entities/Farmer.js) คนเลี้ยงวัว: เดินเล่นในคอก · ผู้เล่นให้ฟาง/รีดนม/ทำคลอดตัวไหน ตาเหมเดินไปข้างวัวตัวนั้นแล้วก้มลูบ
 *   (วัวในโรงนา = เดินผ่านช่องรั้วหลังเข้าโรงนา แล้วเดินกลับออกมา) · แตะตาเหม = บอกว่าวัวตัวไหนต้องการอะไร
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
    /** วัว id → ลำดับคอกในโรงนา (BARN_STALLS) ที่จองไว้ระหว่างเล่น */
    this.stalls = new Map();
    /** กล้องอยู่ในโรงนา */
    this.inBarnView = false;
    /** @type {Farmer | null} ตาเหม (สร้างเมื่อโหลดโมเดลเสร็จ) */
    this.farmer = null;
    /** @type {Record<string, Person>} ตัวละครคนทั้งสอง (สร้างเมื่อโหลดโมเดลเสร็จ) — ผู้เล่นบังคับหนึ่งตัว อีกตัวเดินทำกิจวัตรเอง */
    this.people = {};
    /** @type {Record<string, PersonAI>} */
    this.brains = {};
    /** @type {FarmNav | null} */
    this.nav = null;
    /** @type {PlayerInput | null} */
    this.input = null;
    /** สิ่งกีดขวางของผู้เล่น (world/farmColliders.js) */
    this.colliders = null;
    /** กล้องกำลังบินกลับมาหาผู้เล่น → ตามติดเมื่อบินถึง */
    this.camToPlayer = false;
    /** ระบบคุยกัน (แตะตัวละครอีกคน/ตาเหม → เมนูวงกลม) */
    this.social = new SocialSystem(this);
    /** กิจกรรมในบ้าน (นั่ง นอน ทำกับข้าว อาบน้ำ …) */
    this.life = new HouseLife({
      house: () => this.world?.house ?? null,
      nav: () => this.nav,
      collide: (pos) => this.collide?.(pos),
      blocked: (pos) => this.blocked(pos),
      bubble: (key, text, duration) => this.social.say(key, text, duration),
      onTank: (person) => {
        if (person.key === this.controlled) this.game.goTo('home');
      },
    });
    /** มุมกล้องในบ้าน (หลังคาซ่อน ผนังบังกล้องลดลง) */
    this.inHouseView = false;
    /** ตัวละครทั้งหมดในฉากสำหรับกันเดินทะลุกัน (entities/bodySpace.js) — สร้างใหม่ทุกเฟรมจากวัวที่มีอยู่ */
    this.bodies = [];
    this.greeted = false;
    this.welcomed = false;
    this.status = this.current();
    /** @type {import('../cloud/coop.js').CoopLink | null} เล่นด้วยกันสองคน (ตั้งจาก main.js เมื่อมีเซฟกลาง) */
    this.coop = null;
    /** key ของตัวที่อีกเครื่องบังคับอยู่ (ตอนเฟรมล่าสุด) — ใช้จับจังหวะเปลี่ยน */
    this.remoteWas = null;
    this.netTimer = 0;
  }

  // ── เล่นด้วยกันสองคน ────────────────────────────────────────

  /**
   * เชื่อมกับอีกเครื่อง: เพื่อนบังคับตัวละครอีกตัว (ผู้ชาย/ผู้หญิง) แทน AI · เห็นการเดิน ท่าทาง นั่ง/นอนในบ้าน และคุยกันได้
   * @param {import('../cloud/coop.js').CoopLink} link
   */
  attachCoop(link) {
    this.coop = link;
    link.on((e) => {
      if (e.type === 'peer') this.#onPeer(e.peer, e.prev);
      else if (e.type === 'event') this.#onPeerEvent(e.event);
      else if (e.type === 'link') this.#coopBadge();
    });
    link.start();
  }

  /** key ของตัวที่อีกเครื่องบังคับ (null = ไม่มีเพื่อนออนไลน์ → ตัวละครอีกตัวเดินทำกิจวัตรเอง) */
  get remoteKey() {
    const peer = this.coop?.peer;
    return peer && peer.char !== this.controlled ? peer.char : null;
  }

  #onPeer(peer, prev) {
    const ui = this.game.ui;
    if (peer) {
      // เลือกตัวเดียวกัน → เครื่องที่เปิดทีหลังเปลี่ยนไปอีกตัว
      const mine = resolveCharacter({ id: this.coop.selfId, char: this.controlled, since: this.coop.since }, peer);
      if (mine !== this.controlled) {
        this.#switchTo(mine);
        ui?.toast(`👥 อีกเครื่องเล่น${PEOPLE[peer.char].label}อยู่ — คุณได้เล่น${PEOPLE[mine].icon} ${PEOPLE[mine].label}`);
      } else if (!prev && peer.char !== this.controlled) {
        ui?.toast(`👥 เพื่อนเข้ามาเล่นด้วยแล้ว — เพื่อนเล่น${PEOPLE[peer.char].icon} ${PEOPLE[peer.char].label}`);
        this.game.sound?.play('click');
      }
    } else if (prev) {
      ui?.toast(`👋 เพื่อนออกจากเกมแล้ว — ${PEOPLE[prev.char]?.label ?? 'ตัวละครอีกตัว'}จะทำกิจวัตรเอง`);
    }
    this.#coopBadge();
  }

  /** เหตุการณ์จากเพื่อน: เริ่มคุย / เลิกคุย (ทั้งสองเครื่องเล่นฉากเดียวกัน · เครื่องที่เริ่มเป็นคนบันทึกผลลงเซฟ) */
  #onPeerEvent(e) {
    if (!e || !this.active || !this.player) return;
    const rk = this.remoteKey;
    if (e.k === 'social' && rk && e.a === rk && e.b === this.controlled) {
      this.social.start(e.a, e.b, getSocial(e.id), { ok: !!e.ok, remote: true });
    } else if (e.k === 'cancel' && rk && this.social.drives(rk)) {
      this.social.cancel({ fromPeer: true });
    }
  }

  /** ป้ายมุมจอ: เล่นด้วยกันอยู่กับใคร · เชื่อมต่อตรง/ผ่านคลาวด์ */
  #coopBadge() {
    const root = this.game.ui?.root;
    if (!root) return;
    this.badge ??= Object.assign(document.createElement('div'), { className: 'coop-badge hidden' });
    if (!this.badge.isConnected) root.appendChild(this.badge);
    const rk = this.remoteKey;
    this.badge.classList.toggle('hidden', !rk);
    if (!rk) return;
    const d = PEOPLE[rk];
    const direct = this.coop?.direct;
    this.badge.textContent = `👥 เล่นด้วยกัน · เพื่อน ${d.icon} ${d.label}${direct ? '' : ' · ☁️'}`;
    this.badge.title = direct ? 'เชื่อมต่อตรงกับอีกเครื่อง' : 'เชื่อมต่อตรงไม่ได้ — ส่งตำแหน่งผ่านคลาวด์ (ช้ากว่า)';
  }

  /** ทุกเฟรม: จับจังหวะเพื่อนเข้า/ออก · ส่งสถานะตัวเอง ~10 ครั้ง/วินาที */
  #updateCoop(dt) {
    const rk = this.remoteKey;
    for (const [key, person] of Object.entries(this.people)) {
      person.remote = key === rk;
      if (person.body) person.body.priority = key === this.controlled || key === rk;
    }
    if (rk !== this.remoteWas) {
      const was = this.remoteWas;
      this.remoteWas = rk;
      if (rk && this.people[rk]) {
        // เพื่อนเข้ามาบังคับ → เลิกกิจวัตร/คุยที่ AI ทำค้างอยู่
        if (this.social.drives(rk)) this.social.cancel({ fromPeer: true });
        this.life.cancel(rk, true);
        this.people[rk].cancelAct();
      }
      if (was && this.people[was]) this.brains[was]?.reset(1.5);
      this.#coopBadge();
    }
    if (!this.coop?.peer || !this.player) return;
    this.netTimer -= dt;
    if (this.netTimer > 0) return;
    this.netTimer = 0.1;
    const st = this.active ? this.player.netState() : { ...(this.lastNet ?? this.player.netState()), s: 0, c: 'idle' };
    this.lastNet = st;
    this.coop.sendState({ ...st, loc: this.active ? 'farm' : 'home' });
  }

  /** จุดยืนหน้าตู้ปลาในห้องนั่งเล่น (หันเข้าตู้) — เพื่อนที่อยู่หน้าตู้ปลา (ในบ้าน) ยืนตรงนี้ */
  #tankStand() {
    const tank = this.world?.house?.furniture.get('F_FishTank_0')?.spots[0];
    if (!tank) return null;
    return { x: tank.pos.x - Math.sin(tank.heading) * 0.4, y: 0, z: tank.pos.z - Math.cos(tank.heading) * 0.4, h: tank.heading, s: 0, c: 'idle', n: 0 };
  }

  /** ตัวที่เพื่อนบังคับ: ตามสถานะล่าสุดที่ได้รับ */
  #updateRemote(dt, person) {
    let st = this.coop?.peerState;
    if (st?.loc === 'home') st = this.#tankStand() ?? st;
    if (st && Number.isFinite(st.x) && Number.isFinite(st.z)) person.puppet(dt, st);
    else person.stand(dt, this.collide);
  }

  /** ตัวละครที่ผู้เล่นบังคับอยู่ (null = โมเดลยังไม่โหลด) */
  get player() {
    return this.people[this.controlled] ?? null;
  }

  /** key ของตัวที่บังคับ ('man' | 'woman') — จำไว้ในการตั้งค่าของเครื่อง */
  get controlled() {
    return this.game.settings?.character === 'woman' ? 'woman' : 'man';
  }

  /** ตัวละครที่ไม่ได้บังคับ (เดินทำกิจวัตรเอง) */
  get companion() {
    return this.people[this.controlled === 'man' ? 'woman' : 'man'] ?? null;
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
    this.#setBarnView(false);
    if (this.player) {
      this.#spawnPlayer();
      this.#syncHouseView(true);
    } else sceneMgr.frameArea(this.world.view);
    this.#loadModels();
    if (!this.herd.length && !this.welcomed) {
      this.welcomed = true;
      setTimeout(() => this.game.ui.toast('🐄 คอกยังว่างอยู่ — กดปุ่ม "วัว" ทางซ้ายเพื่อซื้อวัวตัวแรก'), 700);
    }
  }

  leave() {
    this.active = false;
    this.#setBarnView(false);
    this.input?.reset();
    this.camToPlayer = false;
    this.social.cancel();
    this.social.menu?.close();
    this.social.bubbles?.clear();
  }

  /** จุดนี้อยู่ในโรงนาไหม */
  insideBarnAt(p) {
    return this.#insideBarn(p);
  }

  /** จุดนี้คนยืนไม่ได้ (ชนรั้ว/บ้าน/ของ) */
  blocked(p) {
    return !this.colliders || blockedAt(this.colliders, p.x, p.z, PERSON_RADIUS);
  }

  // ── ตัวละครผู้เล่น ──────────────────────────────────────────

  /** วางผู้เล่นที่หน้าประตูสวนหน้าบ้าน หันไปทางคอก (ทุกครั้งที่ออกนอกบ้าน) */
  #spawnPlayer() {
    // ออกจากโหมดตู้ปลา = ยืนหน้าตู้ปลาในห้องนั่งเล่น (ตู้ปลาอยู่ในบ้าน) · ยังไม่มีบ้าน = หน้าประตูสวน
    for (const k of Object.keys(this.people)) this.life.cancel(k, true);
    const tank = this.world?.house?.furniture.get('F_FishTank_0')?.spots[0];
    if (tank) this.player?.place(tank.pos.x - Math.sin(tank.heading) * 0.4, tank.pos.z - Math.cos(tank.heading) * 0.4, tank.heading + Math.PI);
    else this.player?.place(PLAYER_SPAWN.x, PLAYER_SPAWN.z, PLAYER_SPAWN.heading);
    const c = this.companion;
    // ตัวที่เพื่อนบังคับ: ยืนตามตำแหน่งที่เพื่อนส่งมา (ไม่วางใหม่)
    if (c && !c.remote) {
      c.place(COMPANION_SPAWN.x, COMPANION_SPAWN.z, COMPANION_SPAWN.heading);
      this.brains[c.key]?.reset(1 + Math.random() * 2);
    }
    const pen = this.people.pen;
    if (pen) {
      pen.place(PEN_SPAWN.x, PEN_SPAWN.z, PEN_SPAWN.heading);
      this.brains.pen?.reset(2 + Math.random() * 3);
    }
  }

  /** สลับไปบังคับอีกตัว — ตัวเดิมเดินทำกิจวัตรต่อจากที่ยืนอยู่ · กล้องบินไปหาตัวใหม่ */
  swapCharacter() {
    const next = this.companion;
    if (!next || !this.active) return;
    // เล่นด้วยกันอยู่: อีกตัวเป็นของเพื่อน
    if (this.remoteKey) return this.#denied(`👥 ${next.def.label}เป็นตัวที่เพื่อนเล่นอยู่ — สลับตัวไม่ได้ระหว่างเล่นด้วยกัน`);
    const prevLabel = this.player?.def.label ?? '';
    this.#switchTo(next.key);
    this.game.ui.toast(`${next.def.icon} ตอนนี้บังคับ${next.def.label}แล้ว — ${prevLabel}จะทำกิจวัตรเอง`);
  }

  /** เปลี่ยนตัวที่เครื่องนี้บังคับ (ปุ่มสลับตัว / ถูกเปลี่ยนเพราะเพื่อนเลือกตัวเดียวกัน) */
  #switchTo(key) {
    if (key === this.controlled) return;
    this.game.settings.character = key;
    saveSettings(this.game.settings); // เก็บในเครื่อง (ไม่ใช่เซฟกลาง)
    this.coop?.announce();
    const next = this.people[key];
    const prev = this.people[otherChar(key)];
    if (!next || !prev) return;
    this.social.cancel();
    this.life.cancel(key, true);
    next.remote = false;
    next.cancelAct();
    this.brains[prev.key]?.reset(0.8);
    prev.body.priority = false;
    next.body.priority = true;
    this.input?.reset();
    this.game.sound.play('click');
    this.game.ui.cowCard.hide();
    if (this.inBarnView) this.#setBarnView(false);
    this.walkTarget = null;
    if (this.active) this.#syncHouseView(false, true);
  }

  /**
   * กล้องกลับมาตามหลังผู้เล่น: มองจากด้านหลังเฉียงสูง (ตามทิศที่ตัวละครหัน) แล้วตามติด (SceneManager.follow) · ลากจอหมุนรอบตัวได้
   * immediate = วางทันที (ตอนออกนอกบ้าน) · ไม่งั้นบินไปแล้วค่อยตาม
   */
  #cameraToPlayer(immediate, keepAngle = false) {
    const p = this.player;
    if (!p) return;
    const sm = this.game.sceneMgr;
    // keepAngle = มองจากทิศเดิมของกล้อง (เดินออกจากบ้าน: ไม่หมุนไปด้านหลังตัวซึ่งเป็นในตัวบ้าน)
    const h = keepAngle ? Math.atan2(p.position.x - sm.camera.position.x, p.position.z - sm.camera.position.z) : p.group.rotation.y;
    const at = p.anchor.position.clone();
    const view = {
      ...PLAYER_VIEW,
      target: at,
      position: at.clone().add(new THREE.Vector3(-Math.sin(h) * PLAYER_CAM.back, PLAYER_CAM.up, -Math.cos(h) * PLAYER_CAM.back)),
    };
    sm.frameArea(view, { immediate });
    // ปรับขนาดจอแล้วไม่ต้องดึงกล้องกลับจุดเกิด (frameArea ตั้ง reframe ไว้) — ตามผู้เล่นต่อจากมุมเดิม
    sm.reframe = null;
    if (immediate) {
      sm.follow(p.anchor);
      this.camToPlayer = false;
    } else this.camToPlayer = true;
  }

  /**
   * เข้า/ออกบ้าน: ในบ้าน = กล้องมุมสูงแบบเกมจำลองชีวิต (มุมหมุนเดิม) + ซ่อนหลังคา + ลดผนังบังกล้อง · นอกบ้าน = ตามหลังผู้เล่น
   * immediate = วางกล้องทันที (ตอนออกจากโหมดตู้ปลา)
   */
  #syncHouseView(immediate = false, force = false) {
    const p = this.player;
    const house = this.world?.house;
    if (!p) return;
    const inside = !!house && (this.inHouseView ? house.contains(p.position, 0.35) : house.contains(p.position, -0.15));
    if (inside === this.inHouseView && !immediate && !force) return;
    this.inHouseView = inside;
    house?.setInterior(inside);
    this.game.ui.root.classList.toggle('in-house', inside);
    if (!inside) return this.#cameraToPlayer(immediate, !!house && house.contains(p.position, 2.5));
    const sm = this.game.sceneMgr;
    const at = p.anchor.position.clone();
    // มุมหมุนรอบเดิมของกล้อง (เข้าทางประตูหน้า = มองจากฝั่งทุ่งหญ้า)
    const cam = sm.camera.position;
    let az = Math.atan2(cam.x - at.x, cam.z - at.z);
    // เข้ามุมแรก (ออกจากตู้ปลา): มองจากฝั่งใต้เฉียงตะวันออก — เห็นห้องนั่งเล่นเต็ม ตู้ปลาไม่บังตัว
    if (immediate) az = Math.atan2(0.45, 1);
    // จอแนวตั้ง (มือถือ) มุมกว้างแนวนอนแคบ → ถอยกล้องออกให้เห็นทั้งห้อง
    const r = HOUSE_CAM.dist * Math.max(1, Math.sqrt(1.3 / sm.camera.aspect));
    const view = {
      ...PLAYER_VIEW,
      minDistance: 5,
      maxDistance: Math.max(18, r + 4),
      maxPolar: 1.15,
      target: at,
      position: at.clone().add(new THREE.Vector3(Math.sin(az) * Math.sin(HOUSE_CAM.polar) * r, Math.cos(HOUSE_CAM.polar) * r, Math.cos(az) * Math.sin(HOUSE_CAM.polar) * r)),
    };
    sm.frameArea(view, { immediate });
    sm.reframe = null;
    if (immediate) {
      sm.follow(p.anchor);
      this.camToPlayer = false;
    } else this.camToPlayer = true;
  }

  /** กล้องกลับมาหาผู้เล่น: ในบ้าน = มุมสูง · นอกบ้าน = ตามหลัง */
  #playerCam() {
    this.#syncHouseView(false, true);
  }

  /** มุมกล้องหลักของฟาร์ม: มีผู้เล่น = ตามหลังผู้เล่น · ยังไม่มี = มุมกว้างทั้งคอก */
  #mainView() {
    if (this.player) this.#playerCam();
    else this.game.sceneMgr.frameArea(this.world.view, { immediate: false });
  }

  /** บอกวิธีเดินครั้งแรกที่มีตัวละคร */
  #controlsHint() {
    if (this.hinted) return;
    this.hinted = true;
    const touch = window.matchMedia?.('(pointer: coarse)').matches;
    setTimeout(
      () =>
        this.game.ui.toast(
          touch
            ? '🚶 จอยซ้ายล่าง = เดิน (ดันสุด = วิ่ง) · ลากจอหมุนกล้อง · แตะคนเพื่อคุย · ในบ้านแตะเฟอร์นิเจอร์/พื้นห้อง · ปุ่ม "สลับตัว" เปลี่ยนตัวละคร'
            : '🚶 W A S D / ลูกศร = เดิน · Shift = วิ่ง · ลากเมาส์หมุนกล้อง · คลิกคนเพื่อคุย · ในบ้านคลิกเฟอร์นิเจอร์/พื้นห้อง · C = สลับตัวละคร',
        ),
      900,
    );
  }

  #updatePlayer(dt) {
    const p = this.player;
    const sm = this.game.sceneMgr;
    const v = this.input.vector;
    const moving = Math.hypot(v.x, v.y) > 0.08;
    // เริ่มเดินระหว่างดูโรงนา/ดูวัวตัวไหนอยู่ → กล้องกลับมาหาผู้เล่น
    if (moving && this.inBarnView) this.leaveBarn();
    else if (moving && !sm.tween && sm.followTarget !== p.anchor && !this.camToPlayer) this.#playerCam();
    if (this.camToPlayer && !sm.tween) {
      sm.follow(p.anchor);
      this.camToPlayer = false;
    }
    if (moving && this.game.ui.cowCard && !this.game.ui.cowCard.root.classList.contains('hidden')) this.game.ui.cowCard.hide();
    const cam = sm.camera.position;
    const t = sm.controls.target;
    const yaw = Math.atan2(t.x - cam.x, t.z - cam.z);
    // กำลังคุยกันอยู่: ระบบคุยบังคับตัวละครเอง · ผู้เล่นขยับ = เลิกคุย
    if (moving && this.social.drives(p.key)) this.social.cancel();
    // กำลังทำกิจกรรมในบ้าน: ขยับ = เลิก (นั่ง/นอนอยู่ = ลุกก่อน)
    if (moving && this.life.drives(p.key)) this.life.requestExit(p.key);
    if (moving) this.walkTarget = null;
    const wt = this.walkTarget;
    if (wt && !this.social.drives(p.key) && !this.life.drives(p.key)) {
      // แตะพื้นในบ้าน: เดินตามเส้นทางไปจุดนั้น
      const last = wt.i >= wt.points.length - 1;
      wt.t += dt;
      if (p.walkToward(dt, wt.points[wt.i], this.collide, { reach: last ? 0.2 : 0.45 })) {
        if (last) this.walkTarget = null;
        else wt.i++;
      }
      if (wt.t > 30) this.walkTarget = null;
    } else if (!this.social.drives(p.key) && !this.life.drives(p.key)) p.drive(dt, v, yaw, this.collide);
    this.life.update(dt);
    const c = this.companion;
    if (c?.remote && !this.social.drives(c.key)) this.#updateRemote(dt, c);
    else if (c && !c.remote && !this.social.drives(c.key) && !this.life.drives(c.key)) this.brains[c.key].update(dt);
    // ตัวละครที่ผู้เล่นบังคับไม่ได้ (ยายเพ็ญ) ทำกิจวัตรของตัวเอง
    for (const [key, person] of Object.entries(this.people)) {
      if (person.def.npc && !this.social.drives(key) && !this.life.drives(key)) this.brains[key].update(dt);
    }
    this.#syncHouseView();
    if (this.world.house) {
      const ppl = Object.values(this.people).map((x) => x.position);
      if (this.farmer) ppl.push(this.farmer.position);
      this.world.house.update(dt, sm.camera, sm.controls.target, ppl);
    }
  }

  /** แตะเฟอร์นิเจอร์ในบ้าน → เมนูกิจกรรม */
  #openFurniture(name) {
    const info = this.life.info(name);
    const acts = this.life.actionsFor(name);
    if (!info || !acts.length) return;
    const p = this.player;
    this.game.sound.play('click');
    this.social.menuOpen({
      icon: info.icon,
      title: info.label,
      level: 'แตะเพื่อเลือกสิ่งที่จะทำ',
      anchor: this.world.house.furniture.get(name).node.getWorldPosition(new THREE.Vector3()).setY(1.0),
      actions: acts,
      onPick: (id) => {
        this.social.cancel();
        if (!this.life.start(p, name, id)) this.game.ui.toast('ตอนนี้มีคนใช้อยู่ — รอสักครู่นะ');
      },
    });
  }

  /** แตะพื้นในบ้าน → เดินไปตรงนั้น */
  #walkTo(point) {
    const p = this.player;
    if (!p || !this.nav) return;
    this.social.cancel();
    this.life.cancel(p.key, false);
    this.walkTarget = { points: this.nav.path(p.position, point.clone().setY(0)) ?? [point.clone().setY(0)], i: 0, t: 0 };
  }

  // ── โรงนา ───────────────────────────────────────────────────

  /** กล้องเข้าไปในโรงนา (แตะประตูโรงนา / ปุ่ม "โรงนา") — ประตูเลื่อนเปิดเอง */
  enterBarn() {
    if (!this.world || !this.active || this.inBarnView) return;
    this.game.ui.cowCard.hide();
    this.game.sound.play('click');
    this.#setBarnView(true);
    this.game.sceneMgr.frameArea(this.world.barnView, { immediate: false });
    const inside = this.herd.filter((c) => inBarn(c)).length;
    this.game.ui.toast(inside ? `🏚️ ในโรงนามีวัว ${inside} ตัว — แตะวัวเพื่อดูแล` : '🏚️ โรงนายังว่าง — เปิดการ์ดวัวแล้วกด "เข้าโรงนา" เพื่อพาวัวมาพัก');
  }

  /** ออกจากโรงนา: กล้องกลับมุมคอกหญ้า */
  leaveBarn() {
    if (!this.world || !this.inBarnView) return;
    this.game.sound.play('click');
    this.game.ui.cowCard.hide();
    this.#setBarnView(false);
    this.#mainView();
  }

  #setBarnView(on) {
    this.inBarnView = on;
    if (this.world) this.world.barnInside = on ? 1 : 0;
    this.game.ui.root.classList.toggle('in-barn', on);
  }

  /** เหตุผลที่พาวัวเข้า (into = true) / ออกโรงนาไม่ได้ (null = ได้) */
  barnBlockOf(cowId, into) {
    return barnBlock(this.status, this.cowStatus(cowId), into);
  }

  /** ตั้งชื่อวัว (การ์ดวัว) — กฎเดียวกับฝั่งตรวจ (cleanName) · คืนชื่อที่ใช้จริง */
  rename(cowId, name) {
    const rec = findCow(this.record, cowId);
    if (!rec) return null;
    const next = cleanName(name, getCowBreed(rec.breedId)?.name ?? rec.name);
    if (next === rec.name) return next;
    rec.name = next;
    this.status = this.current();
    this.game.state.record({ type: 'renameCow', cowId, name: next });
    this.game.state.save();
    return next;
  }

  /** สลับ: อยู่ข้างนอก → พาเข้าโรงนา · อยู่ในโรงนา → ปล่อยออกคอกหญ้า (ฟรี) */
  toggleBarn(cowId) {
    const game = this.game;
    const now = Date.now();
    const settled = farmAt(this.record, now);
    const rec = findCow(settled, cowId);
    const into = !inBarn(rec);
    const block = barnBlock(settled, rec, into);
    if (block) return this.#denied(this.blockText(block));
    Object.assign(rec, applyBarn(rec, into, now));
    game.state.data.farm = settled;
    game.state.record({ type: 'barnCow', cowId, in: into });
    game.sound.play('click');
    game.ui.toast(
      into ? `🏚️ พา "${rec.name}" เข้าโรงนาแล้ว — ในโรงนาไม่มีหญ้าให้เล็ม อย่าลืมให้ฟางนะ` : `🌿 ปล่อย "${rec.name}" ออกไปเล็มหญ้าในคอกแล้ว`,
      'success',
    );
    this.#refresh();
    game.state.save();
    return true;
  }

  /** ตำแหน่งนี้อยู่ในโรงนา (เลยประตูเข้าไปแล้ว) */
  #insideBarn(p) {
    return p.z < BARN_ROUTE[2].z - 0.4;
  }

  /**
   * ตาเหมเดินไปข้างวัว cowId แล้วก้มลูบ: วัวในคอกหญ้า = ยืนข้างลำตัวฝั่งที่ใกล้ (ตามวัวที่ยังเดินอยู่)
   * วัวในโรงนา = เดินผ่านช่องรั้วหลัง/ประตูโรงนาไปยืนในทางเดินหน้าคอกนั้น ลูบเสร็จเดินกลับออกมาที่คอกหญ้า
   */
  #sendFarmer(cowId) {
    const f = this.farmer;
    const cow = this.cows.get(cowId);
    if (!f || !cow || !this.active || cow.dead) return;
    f.focus = cow;
    const V = (x, z) => new THREE.Vector3(x, 0, z);
    const p = f.position;
    const inBarnNow = this.#insideBarn(p);
    const inPen = p.z > BARN_ROUTE[0].z - 0.3;
    const out = () => [...BARN_ROUTE].reverse().map((q) => q.clone());
    const pts = [];
    if (cow.stall) {
      const st = cow.stall;
      if (inBarnNow) pts.push(V(0, Math.min(p.z, BARN_ROUTE[3].z)));
      else pts.push(...BARN_ROUTE.filter((q) => inPen || q.z < p.z - 0.3).map((q) => q.clone()));
      pts.push(V(0, st.z), V(Math.sign(st.x) * 1.45, st.z));
      // ลูบเสร็จ: เดินกลับออกไปที่คอกหญ้า (ถ้ายังไม่มีงานใหม่)
      f.visit(pts, () => cow.group.position, () => {
        if (!f.traveling && this.#insideBarn(f.position)) f.walk([V(0, Math.min(f.position.z, BARN_ROUTE[3].z)), ...out(), V(1.5, -3)]);
      });
      return;
    }
    if (inBarnNow) pts.push(V(0, Math.min(p.z, BARN_ROUTE[3].z)), ...out());
    else if (!inPen) pts.push(...out().filter((q) => q.z > p.z + 0.3));
    // ยืนข้างลำตัวฝั่งที่ใกล้ตาเหม (เลือกครั้งเดียว) ห่างกลางตัววัว ~1.1 ม. × ขนาดวัว · ไม่ออกนอกรั้ว
    const g = cow.group;
    const right = () => new THREE.Vector3(Math.cos(g.rotation.y), 0, -Math.sin(g.rotation.y));
    const side = Math.sign(right().dot(p.clone().sub(g.position))) || 1;
    const lim = { x: COW_AREA.maxX + 0.9, z: COW_AREA.maxZ + 0.9 };
    pts.push(() => {
      const q = g.position.clone().addScaledVector(right(), side * 1.1 * g.scale.x);
      q.x = THREE.MathUtils.clamp(q.x, -lim.x, lim.x);
      q.z = THREE.MathUtils.clamp(q.z, -lim.z, lim.z);
      return q;
    });
    f.visit(pts, () => g.position);
  }

  /** แตะตาเหม: บอกเรื่องที่ควรทำตอนนี้ (เรียงตามความด่วน) */
  /** ตาเหมตอบเรื่องที่ควรทำตอนนี้ (เรียงตามความด่วน) — ใช้ในบทสนทนา "ถามงานในฟาร์ม" (SocialSystem) */
  farmStatusLine() {
    const f = CONFIG.farm;
    const alive = this.herd.filter((c) => !isCowDead(c));
    const dead = this.herd.filter((c) => isCowDead(c));
    const names = (list) => list.slice(0, 2).map((c) => `"${c.name}"`).join(' กับ ') + (list.length > 2 ? ` และอีก ${list.length - 2} ตัว` : '');
    const due = alive.filter((c) => this.isDue(c));
    const hungry = alive.filter((c) => c.satiety < f.hungryBelow);
    const full = alive.filter((c) => !isBull(c) && c.milk >= f.milkFullAbove);
    const grass = this.grass.g.reduce((a, b) => a + b, 0) / this.grass.g.length;
    let msg;
    if (!this.herd.length) msg = 'คอกยังว่างอยู่เลยหลาน ไปซื้อวัวมาสักตัวสิ เดี๋ยวลุงช่วยดูแลให้';
    else if (dead.length) msg = `${names(dead)} ไม่ไหวแล้ว… นำออกจากคอกเถอะ แล้วหมั่นให้ฟางตัวอื่นด้วยนะ`;
    else if (due.length) msg = `${names(due)} ครบกำหนดคลอดแล้ว! แตะที่แม่วัวแล้วกดคลอดลูกได้เลย`;
    else if (hungry.length) msg = `${names(hungry)} หิวแล้ว${hungry.some(inBarn) ? ' (ตัวที่อยู่ในโรงนาไม่มีหญ้ากินนะ)' : ''} ให้ฟางหน่อยเถอะ`;
    else if (full.length) msg = `นมของ${names(full)} เต็มเต้าแล้ว มารีดได้เลย`;
    else if (grass < 30) msg = 'หญ้าในคอกเหลือน้อยแล้ว แตะพื้นในคอกรดน้ำหน่อย หญ้าจะได้งอกขึ้นมาใหม่';
    else msg = pick(FARMER_CHAT);
    return msg;
  }

  /** ยายเพ็ญตอบว่าตาเหมอยู่ไหน (จากตำแหน่งจริง) */
  tahemWhereLine() {
    const f = this.farmer;
    if (!f) return 'ไม่รู้สิจ้ะ ออกไปตั้งแต่เช้าแล้ว';
    const p = f.position;
    if (f.state === 'tend') return 'นั่นไง กำลังดูวัวอยู่ในคอกโน่นแน่ะหลาน';
    if (this.#insideBarn(p)) return 'อยู่ในโรงนาจ้ะ ไปดูวัวที่พักอยู่ข้างในน่ะ';
    if (Math.abs(p.x) < 11 && Math.abs(p.z) < 8) return 'อยู่ในคอกวัวจ้ะ เดินวนดูวัวทั้งวันแหละตาคนนี้';
    return 'เดินอยู่แถว ๆ นี้แหละจ้ะ ตะโกนเรียกดูสิ';
  }

  /** "ขอให้ช่วยดูวัว": ตาเหมเดินไปดูตัวที่ต้องการที่สุด (ครบคลอด → หิว → นมเต็ม → ตัวไหนก็ได้) */
  sendFarmerToNeediest() {
    const f = CONFIG.farm;
    const alive = this.herd.filter((c) => !isCowDead(c) && this.cows.has(c.id));
    const cow =
      alive.find((c) => this.isDue(c)) ??
      alive.find((c) => c.satiety < f.hungryBelow) ??
      alive.find((c) => !isBull(c) && c.milk >= f.milkFullAbove) ??
      pick(alive);
    if (cow) this.#sendFarmer(cow.id);
  }

  /** คอกในโรงนาของวัวตัวนี้ (จองไว้ตลอดที่อยู่ในโรงนา) · null = เต็ม */
  #stallFor(id) {
    if (!this.stalls.has(id)) {
      const used = new Set(this.stalls.values());
      const free = BARN_STALLS.findIndex((_, i) => !used.has(i));
      if (free < 0) return null;
      this.stalls.set(id, free);
    }
    return BARN_STALLS[this.stalls.get(id)];
  }

  /**
   * ให้วัวในฉากเดินไปอยู่ที่ใหม่ตามเซฟ: เข้า = คอกหญ้า → ช่องรั้วหลัง → ประตูโรงนา → ทางเดินกลาง → คอกของตัวเอง
   * ออก = ย้อนทางเดิม แล้วเดินเข้ากลางคอกหญ้า · กำลังเดินอยู่กลางทาง = เริ่มจากจุดที่ยังไม่ผ่าน
   */
  #walkCow(cow, id, into) {
    const p = cow.group.position;
    const V = (x, z) => new THREE.Vector3(x, 0, z);
    const insideBarn = p.z < BARN_ROUTE[2].z - 0.4;
    const inPen = p.z > BARN_ROUTE[0].z - 0.3;
    if (into) {
      const stall = this.#stallFor(id);
      if (!stall) return;
      cow.setStall(stall);
      // จุดบนเส้นทางที่ยังอยู่ข้างหน้า (เส้นทางเรียง z จากมากไปน้อย)
      const ahead = insideBarn ? [V(0, Math.min(p.z, BARN_ROUTE[3].z))] : BARN_ROUTE.filter((q) => inPen || q.z < p.z - 0.3).map((q) => q.clone());
      cow.travel([...ahead, V(0, stall.z), V(stall.x, stall.z)]);
      return;
    }
    this.stalls.delete(id);
    cow.setStall(null);
    if (inPen) return;
    const back = [...BARN_ROUTE].reverse().map((q) => q.clone());
    const ahead = insideBarn ? [V(0, Math.min(p.z, back[0].z)), ...back] : back.filter((q) => q.z > p.z + 0.3);
    const a = COW_AREA;
    const r = cow.rnd;
    ahead.push(V(THREE.MathUtils.lerp(a.minX * 0.5, a.maxX * 0.5, r()), THREE.MathUtils.lerp(a.minZ + 1, 0, r())));
    cow.travel(ahead);
  }

  /** โหลดโมเดลจริงของฟาร์มเบื้องหลัง — ระหว่างรอเห็นโมเดลชั่วคราว แล้วสลับเมื่อเสร็จ */
  async #loadModels() {
    if (this.modelsRequested) return;
    this.modelsRequested = true;
    const assets = this.game.assets;
    const cowFiles = [...new Set([COW_MODEL, ...COW_BREEDS.flatMap((b) => [b.model?.file, b.model?.fileMale, b.young?.file]).filter(Boolean)])];
    await assets.preload([...Object.values(FARM_MODELS), ...cowFiles, FARMER_MODEL, ...Object.values(PEOPLE).map((d) => d.model)]);
    const got = (url) => assets.models.get(url) ?? null;
    this.world.useModels(Object.fromEntries(Object.entries(FARM_MODELS).map(([k, url]) => [k, got(url)])));
    if (got(FARMER_MODEL) && !this.farmer) {
      this.farmer = new Farmer(assets.instantiate(got(FARMER_MODEL)), COW_AREA);
      this.farmer.body = { group: this.farmer.group, kind: 'person' };
      this.farmer.avoid = (heading) => steer(this.farmer.body, this.bodies, heading);
      this.world.animals.add(this.farmer.group);
    }
    if (!this.player && Object.values(PEOPLE).every((d) => got(d.model))) {
      this.colliders = buildFarmColliders(this.world);
      this.collide = (pos) => resolveCollisions(this.colliders, pos, PERSON_RADIUS);
      this.nav = new FarmNav(this.colliders, PERSON_RADIUS, this.world.house ? HOUSE_NAV : []);
      for (const [key, d] of Object.entries(PEOPLE)) {
        const person = new Person(assets.instantiate(got(d.model)), key);
        person.body = { group: person.group, kind: 'person', priority: key === this.controlled };
        this.people[key] = person;
        this.brains[key] = new PersonAI(person, {
          nav: this.nav,
          collide: this.collide,
          cows: () => [...this.cows.values()].filter((c) => !c.stall && !c.traveling && !c.dead).map((c) => c.group.position),
          player: () => this.player,
          avoid: (heading) => steer(person.body, this.bodies, heading),
          // ยายเพ็ญ: งานบ้าน/แปลงผัก ไม่ไปดูแลวัว (เป็นงานของตาเหม)
          ...(d.npc ? { spots: PEN_SPOTS, stroll: PEN_STROLL, cowChance: 0 } : {}),
          // งานในบ้าน (ระบบกิจกรรมพาเดินเข้าไปใช้เฟอร์นิเจอร์)
          ...(this.world.house
            ? { house: { ...(d.npc ? PEN_HOUSE : MATE_HOUSE), start: (who, furn, act, opts) => this.life.start(who, furn, act, opts) } }
            : {}),
        });
        this.world.animals.add(person.group);
      }
      this.input ??= new PlayerInput(this.game.ui.root, () => this.active && this.game.started && !this.game.ui.modalRoot.classList.contains('open'), () => this.swapCharacter());
      this.game.ui.root.classList.add('has-player');
      this.#spawnPlayer();
      if (this.active && !this.inBarnView) this.#syncHouseView(true, true);
      if (this.active) this.#controlsHint();
    }
    for (const url of cowFiles) if (got(url)) this.cowGltfs.set(url, got(url));
    if (!this.cowGltfs.size) return;
    const loader = new THREE.TextureLoader();
    await Promise.all(
      [...new Set(COW_BREEDS.flatMap((b) => [b.skin, b.young?.skin]).filter(Boolean))].map(async (url) => {
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
    // ตัวผู้ที่โตแล้วใช้ไฟล์ตัวผู้ของสายพันธุ์ (ถ้ามีและโหลดได้) ไม่งั้นใช้ไฟล์หลัก
    const male = canBreed(s) && s.sex === 'm' && adult.model?.fileMale ? (this.cowGltfs.get(adult.model.fileMale) ?? null) : null;
    const own = calf ?? male ?? (adult.model?.file ? (this.cowGltfs.get(adult.model.file) ?? null) : null);
    const gltf = own ?? this.cowGltfs.get(COW_MODEL);
    const size = calf ? (yv.scale ?? 1) : (adult.model?.scale ?? 1) * (yv ? (yv.file ? CALF_FALLBACK_SCALE : (yv.scale ?? 1)) : 1);
    const opts = {
      scale: size * (canBreed(s) ? (SEX_SCALE[s.sex] ?? SEX_SCALE.f) : 1),
      drinkReach: yv?.drinkReach,
      walkClipSpeed: yv?.walkClipSpeed,
    };
    if (!gltf) return { model: null, opts };
    const model = this.game.assets.instantiate(gltf);
    // ภาพผิว: ลูกวัวที่ใช้ไฟล์ลูกวัวร่วมกัน → young.skin · วัวที่ไม่มีไฟล์ของตัวเอง → breed.skin
    const skinUrl = calf ? yv.skin : !own ? adult.skin : null;
    return { model: { ...model, skin: skinUrl ? (this.skins.get(skinUrl) ?? null) : null }, opts };
  }

  /** ของที่แตะได้ในฟาร์ม: วัว หรือประตูบ้าน */
  pick(ray) {
    if (!this.world) return null;
    let best = null;
    let bestD = Infinity;
    for (const cow of this.cows.values()) {
      // ในโรงนาแตะได้เฉพาะวัวในโรงนา · ข้างนอกแตะได้เฉพาะวัวที่มองเห็น (ไม่ทะลุผนังโรงนา)
      const housed = !!cow.stall && !cow.traveling;
      if (housed !== this.inBarnView || !cow.pick(ray)) continue;
      const d = ray.origin.distanceTo(cow.group.position);
      if (d < bestD) {
        bestD = d;
        best = cow;
      }
    }
    if (best) return best;
    const f = this.farmer;
    if (f && this.#insideBarn(f.position) === this.inBarnView && f.pick(ray)) return 'farmer';
    // แตะตัวละครอีกตัว = เมนูคุย (มีปุ่มสลับไปเล่นตัวนั้นด้วย)
    if (this.companion?.pick(ray)) return 'companion';
    // ในบ้าน: เฟอร์นิเจอร์ / พื้นห้อง
    if (this.inHouseView && this.world.house) {
      _rc.ray.copy(ray);
      for (const [key, person] of Object.entries(this.people)) if (person.def.npc && person.pick(ray)) return `npc:${key}`;
      const f = this.world.house.pickFurniture(_rc);
      if (f && this.life.actionsFor(f.name).length) return `furn:${f.name}`;
      const fl = this.world.house.pickFloor(_rc);
      if (fl) return { floor: fl };
    }
    for (const [key, person] of Object.entries(this.people)) if (person.def.npc && person.pick(ray)) return `npc:${key}`;
    if (this.inBarnView) return null;
    return this.world.pickDoor(ray) ? 'door' : this.world.pickBarnDoor(ray) ? 'barn' : null;
  }

  handleTap(ray) {
    const hit = this.pick(ray);
    const game = this.game;
    if (hit === 'door') {
      game.goTo('home');
      return;
    }
    if (hit === 'barn') {
      this.enterBarn();
      return;
    }
    if (typeof hit === 'string' && hit.startsWith('furn:')) {
      game.ui.cowCard.hide();
      this.#openFurniture(hit.slice(5));
      return;
    }
    if (hit?.floor) {
      this.#walkTo(hit.floor);
      return;
    }
    if (hit === 'farmer' || hit === 'companion' || (typeof hit === 'string' && hit.startsWith('npc:'))) {
      game.ui.cowCard.hide();
      this.social.open(hit === 'farmer' ? 'tahem' : hit === 'companion' ? this.companion.key : hit.slice(4));
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
    if (cow.stall && !cow.traveling) {
      // วัวในโรงนา: กล้องเข้าไปยืนในทางเดินกลางหน้าคอกนั้น
      if (!this.inBarnView) {
        this.#setBarnView(true);
        this.game.sceneMgr.frameArea(this.world.barnView, { immediate: false });
      }
      // จุดหมุนต้องอยู่ในทางเดินกลาง (barnView.bounds) → เล็งไปขอบทางเดินฝั่งคอกนั้น กล้องยืนเฉียงอีกฝั่ง วัวอยู่ในแนวสายตาพอดี
      const side = Math.sign(p.x - this.world.barnView.center.x) || 1;
      const cx = this.world.barnView.center.x;
      this.game.sceneMgr.flyTo(new THREE.Vector3(cx - side * 1.2, 2.6, p.z + 2.1), new THREE.Vector3(cx + side * 1.0, 1, p.z));
      return;
    }
    if (this.inBarnView) {
      this.#setBarnView(false);
      this.game.sceneMgr.frameArea(this.world.view, { immediate: false });
    }
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
    const ideal = { ...cow, id: '', barn: 0, sex: 'm', breedId: adultBreedOf(cow)?.id ?? cow.breedId, born: 0, boughtAt: 0, health: 100, satiety: 100, bredAt: 0, preg: 0 };
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
    if (mom3d && calf3d && !inBarn(mother)) {
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
    this.#sendFarmer(cowId);
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
    this.#sendFarmer(cowId);
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
      // ประตูโรงนาเปิดเมื่อกล้องอยู่ข้างใน หรือมีวัวกำลังเดินเข้า/ออก
      const f = this.farmer;
      const farmerAtDoor = !!f?.traveling && Math.abs(f.position.z - BARN_ROUTE[2].z) < 4;
      this.world.setBarnDoors(this.inBarnView || farmerAtDoor || [...this.cows.values()].some((c) => c.traveling));
      this.world.update(dt, time);
      this.#updateBodies();
      for (const cow of this.cows.values()) cow.update(dt, time, this.game.sceneMgr.camera);
      f?.update(dt, time);
      if (this.player) this.#updatePlayer(dt);
      separate(this.bodies);
    }
    this.#updateCoop(dt);
    this.social.update(dt);
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
        const { stall, route, housed } = cow;
        cow = this.#spawnCow(s, breed, young);
        cow.group.position.copy(position);
        cow.group.rotation.y = rotation.y;
        cow.housed = housed;
        cow.setStall(stall);
        if (route) cow.travel(route.points.slice(route.i), route.onDone);
      }
      const housed = inBarn(s);
      if (!cow) {
        cow = this.#spawnCow(s, breed, young);
        const stall = housed ? this.#stallFor(s.id) : null;
        if (stall) cow.placeInStall(stall);
      } else if (cow.housed !== housed && !isCowDead(s)) this.#walkCow(cow, s.id, housed);
      cow.housed = housed;
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
      this.stalls.delete(id);
    }
  }

  /**
   * อัปเดตสถานะการชนของทุกตัว: ใครขยับไม่ได้ (นอน/ในคอกโรงนา/ตาย/ผสมพันธุ์/ตาเหมกำลังลูบวัว) · ใครมีสิทธิ์ผ่านก่อน (เดินเข้า-ออกโรงนา)
   * คู่ผสมพันธุ์ไม่กันกัน · ตาเหมไม่หลบวัวตัวที่เดินไปหา
   */
  #updateBodies() {
    const list = [];
    for (const cow of this.cows.values()) {
      const b = (cow.body ??= { group: cow.group, kind: 'cow' });
      b.group = cow.group;
      b.fixed = cow.dead || cow.state === 'lie' || cow.isMating || (!!cow.stall && !cow.traveling);
      b.priority = cow.traveling;
      b.partner = cow.mating?.partner?.body ?? null;
      b.bounds = !cow.stall && !cow.traveling ? PEN_BOUNDS : null;
      list.push(b);
    }
    const f = this.farmer;
    if (f) {
      const b = f.body;
      b.fixed = f.state === 'tend';
      b.partner = f.focus?.body ?? null;
      b.bounds = !f.traveling && !this.#insideBarn(f.position) ? PEN_BOUNDS : null;
      list.push(b);
    }
    for (const [key, person] of Object.entries(this.people)) {
      // นั่ง/นอน/ทำงานอยู่ = ไม่ถูกดันออก (ตัวอยู่ในกล่องเฟอร์นิเจอร์)
      // ยืนคุยอยู่ (กอด/จูบตัวชิดกัน) = ไม่ถูกดันแยก
      // ตัวที่เพื่อนบังคับ = ตำแหน่งจากอีกเครื่อง ไม่ถูกดัน
      person.body.fixed = this.life.drives(key) || this.social.holds(key) || (person.remote && !this.social.drives(key));
      list.push(person.body);
    }
    this.bodies = list;
  }

  #spawnCow(s, breed, young) {
    const { model, opts } = this.#cowModel(s, young);
    const cow = new Cow(s, breed, COW_AREA, model, opts);
    cow.avoid = (heading) => (cow.body ? steer(cow.body, this.bodies, heading) : { heading, slow: 1 });
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

