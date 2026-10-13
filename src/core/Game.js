import { CONFIG } from '../config.js';
import { EventBus, EV } from './EventBus.js';
import { GameState } from './GameState.js';
import { Sound } from './Sound.js';
import { AssetLoader } from '../assets/AssetLoader.js';
import { ModelFactory } from '../assets/ModelFactory.js';
import { Thumbnailer } from '../assets/Thumbnailer.js';
import { TankPreviewer } from '../assets/TankPreviewer.js';
import { SceneManager } from '../world/SceneManager.js';
import { Room } from '../world/Room.js';
import { Aquarium } from '../world/Aquarium.js';
import { Bubbles } from '../world/Bubbles.js';
import { Sparkles } from '../world/Sparkles.js';
import { FishManager, fishIdentity } from '../systems/FishManager.js';
import { FoodSystem } from '../systems/FoodSystem.js';
import { CoinSystem } from '../systems/CoinSystem.js';
import { CareSystem } from '../systems/CareSystem.js';
import { DecorManager } from '../systems/DecorManager.js';
import { MissionSystem } from '../systems/MissionSystem.js';
import { PlacementController } from '../systems/PlacementController.js';
import { InputController } from '../systems/InputController.js';
import { UI } from '../ui/UI.js';
import { sharedUniforms } from '../render/shaderMods.js';
import { getSpecies } from '../data/fish.js';
import { getFood, CARE_ITEMS } from '../data/food.js';
import { TANK_TYPES, getTankType, tankTier } from '../data/tanks.js';
import { rand } from '../utils/math.js';
import { LIMITS } from '../shared/constants.js';
import { pearlReadyAt } from '../shared/economy.js';

/**
 * ตัวควบคุมหลักของเกม — สร้างทุกระบบ, game loop และคำสั่งระดับเกม (ซื้อ ขาย ให้อาหาร ฯลฯ)
 * เปิด DevTools แล้วพิมพ์ `game` เพื่อสำรวจ/ดีบักได้
 *
 * save  = { data, isNewGame } ข้อมูลเกมที่โหลดจากเซฟกลางแล้ว (เกมเริ่มหลังโหลดสำเร็จเท่านั้น)
 * cloud = ระบบเซฟกลาง (cloud/CloudSync.js) — รับคำสั่งจาก state.record() ไปตรวจและบันทึกบนคลาวด์
 */
export class Game {
  constructor({ canvas, uiRoot, save = {}, cloud = null }) {
    this.config = CONFIG; // เปิดให้ปรับจาก DevTools ได้ เช่น game.config.timeScale = 20
    this.events = new EventBus();
    this.state = new GameState(this.events, save);
    this.cloud = cloud;
    this.settings = this.state.settings;
    this.sound = new Sound(this.settings);

    this.sceneMgr = new SceneManager(canvas, this.settings);
    this.assets = new AssetLoader();
    this.models = new ModelFactory(this.assets, { detail: () => this.sceneMgr.quality?.fishDetail ?? 'high' });
    this.thumbs = new Thumbnailer(this.models);
    this.tankPreviews = new TankPreviewer(this.models);

    this.room = new Room(this.sceneMgr.scene);
    this.aquarium = new Aquarium(this.sceneMgr);
    this.bubbles = new Bubbles();
    this.sceneMgr.scene.add(this.bubbles.points);
    this.sparkles = new Sparkles();
    this.sceneMgr.scene.add(this.sparkles.points);

    this.food = new FoodSystem(this);
    this.coins = new CoinSystem(this);
    this.decor = new DecorManager(this);
    this.fish = new FishManager(this);
    this.care = new CareSystem(this);
    this.missions = new MissionSystem(this);
    this.placement = new PlacementController(this);
    this.ui = new UI(this, uiRoot);
    this.input = new InputController(this);

    this.mode = 'normal';
    this.selectedFish = null;
    this.started = false;
    this.resetting = false;
    this.time = 0;
    this.saveTimer = CONFIG.autoSaveInterval;

    this.sceneMgr.onResize = (_w, h) => {
      const { camera, renderer } = this.sceneMgr;
      this.bubbles.setViewport(h, camera.fov, renderer.getPixelRatio());
      this.sparkles.setViewport(h, camera.fov, renderer.getPixelRatio());
    };
    this.sceneMgr.resize(true);
    const saveNow = () => !this.resetting && this.state.save({ urgent: true });
    window.addEventListener('beforeunload', saveNow);
    document.addEventListener('visibilitychange', () => document.hidden && saveNow());
  }

  async init() {
    await this.assets.preload(this.models.allModelUrls(), (p) => this.ui.start.setProgress(p));
    const tank = this.state.activeTank;
    const offline = this.state.catchUpTank(tank, Date.now(), { giveCoins: !this.state.isNewGame });
    this.loadTank(tank);
    // เริ่มซิงก์หลังคำนวณช่วงออฟไลน์แล้ว — เหรียญออฟไลน์ให้เซิร์ฟเวอร์คำนวณยืนยันเอง
    this.cloud?.attach(this, this.state.isNewGame ? [] : [{ type: 'offlineIncome', tankId: tank.id }]);
    this.lastFrame = performance.now();
    requestAnimationFrame((t) => this.#loop(t));
    this.ui.start.ready(offline);
  }

  /** ผู้เล่นกด "เริ่มเล่น" */
  begin() {
    this.started = true;
    this.sound.unlock();
    (this.notices ?? []).forEach((text, i) => setTimeout(() => this.ui.toast(text), 300 + i * 700));
    if (this.state.isNewGame) {
      setTimeout(() => this.ui.toast('👋 ยินดีต้อนรับ! ลองกดปุ่ม "ให้อาหาร" มุมขวาล่าง แล้วแตะเหรียญที่ปลาผลิตออกมา'), 800);
    }
  }

  // ── ตู้ปลา ──────────────────────────────────────────────────

  loadTank(tank) {
    const type = getTankType(tank.typeId);
    if (this.placement.active) this.placement.exit();
    this.selectFish(null);
    this.aquarium.build(type, this.sceneMgr.quality);
    this.room.build(this.aquarium.dims);
    this.sceneMgr.setupLights(this.aquarium.dims);
    this.sceneMgr.frameTank(this.aquarium.dims);
    this.bubbles.setTank(this.aquarium.dims, (x, z) => this.aquarium.heightAt(x, z));
    this.sparkles.clear();
    this.food.clear();
    this.coins.clear();
    this.decor.load(tank);
    this.fish.load(tank);
    this.care.lastQuality = -1;
    this.care.stage = null; // ย้ายตู้ไม่ต้องเตือนสภาพน้ำซ้ำ
    this.care.update(0);
    this.ui.refreshTank();
  }

  /** สร้างฉากตู้ใหม่ (เช่น หลังเปลี่ยนคุณภาพกราฟิก) */
  reloadTankVisuals() {
    this.loadTank(this.state.activeTank);
  }

  switchTank(tankId) {
    const current = this.state.activeTank;
    const next = this.state.getTank(tankId);
    if (!next || next === current) return;
    current.lastUpdate = Date.now();
    this.cloud?.noteSimulated(current.id); // บันทึกค่าล่าสุดของตู้เดิมด้วย
    this.state.data.activeTankId = next.id;
    this.state.catchUpTank(next);
    this.loadTank(next);
    this.state.record({ type: 'switchTank', tankId: next.id });
    this.state.save();
    this.events.emit(EV.TANK_SWITCHED, { tank: next });
    this.ui.toast(`🏠 ย้ายมาที่${next.name}แล้ว`);
  }

  buyTank(typeId) {
    const type = getTankType(typeId);
    if (!type || this.state.ownsTankType(typeId)) return false;
    if (!this.state.spend(type.price)) {
      this.#denied('เงินไม่พอสำหรับปลดล็อกตู้นี้');
      return false;
    }
    const tank = this.state.addTank(typeId);
    this.state.record({ type: 'buyTank', typeId, tankId: tank.id });
    this.sound.play('buy');
    this.events.emit(EV.TANK_UNLOCKED, { tank });
    this.ui.toast(`🎉 ปลดล็อก${type.name}แล้ว! ไปซื้อปลามาเลี้ยงกันเลย`, 'success');
    this.switchTank(tank.id);
    return true;
  }

  // ── ปลา ─────────────────────────────────────────────────────

  canBuyFish(species) {
    if (species.retired) return { ok: false, reason: 'ปลาชนิดนี้เลิกขายแล้ว' };
    if (species.notForSale) return { ok: false, reason: 'ได้จากการผสมพันธุ์เท่านั้น' };
    const tankType = getTankType(this.state.activeTank.typeId);
    if (this.fish.count >= tankType.capacity) return { ok: false, reason: `ตู้เต็มแล้ว (${this.fish.count}/${tankType.capacity}) ปลดล็อกตู้ใหม่ได้ที่แท็บตู้ปลา` };
    if (tankTier(tankType.id) < species.minTank) return { ok: false, reason: `ต้องใช้${TANK_TYPES[species.minTank].name}ขึ้นไป` };
    if (!this.state.canAfford(species.price)) return { ok: false, reason: species.price.gems ? 'เพชรไม่พอ' : 'เหรียญไม่พอ' };
    return { ok: true, reason: '' };
  }

  /** @param {'m'|'f'} [gender] เพศที่เลือกตอนซื้อ (ไม่ระบุ = สุ่ม) */
  buyFish(speciesId, gender) {
    const species = getSpecies(speciesId);
    const check = this.canBuyFish(species);
    if (!check.ok) {
      this.#denied(check.reason);
      return null;
    }
    this.state.spend(species.price);
    const fish = this.fish.addNew(speciesId, gender);
    this.state.record({ type: 'buyFish', tankId: this.state.activeTank.id, speciesId, fish: fishIdentity(fish.data) });
    const isNew = this.state.discover(speciesId);
    this.sound.play('splash');
    this.events.emit(EV.FISH_BOUGHT, { fish });
    const sex = fish.data.gender === 'm' ? '♂ ตัวผู้' : '♀ ตัวเมีย';
    this.ui.toast(`🐟 "${fish.data.name}" (${species.name} ${sex}) ลงตู้แล้ว!${isNew ? ' 📘 บันทึกลงสมุดสะสม' : ''}`, 'success');
    this.state.save();
    return fish;
  }

  /** เพชรที่แลกได้มากที่สุดด้วยเหรียญที่มี */
  get maxExchangeGems() {
    return Math.min(LIMITS.maxExchangeGems, LIMITS.maxGems - this.state.gems, Math.floor(this.state.coins / CONFIG.exchange.coinsPerGem));
  }

  /** แลกเหรียญเป็นเพชร @returns {boolean} */
  exchangeGems(gems) {
    gems = Math.floor(gems);
    if (!(gems >= 1)) return false;
    if (gems > this.maxExchangeGems) return this.#denied('เหรียญไม่พอ');
    const cost = { coins: gems * CONFIG.exchange.coinsPerGem };
    this.state.spend(cost);
    this.state.earn({ gems });
    this.state.record({ type: 'exchangeGems', gems });
    this.sound.play('buy');
    this.ui.toast(`💎 แลกได้ ${gems.toLocaleString('en-US')} เพชร (ใช้ ${cost.coins.toLocaleString('en-US')} เหรียญ)`, 'success');
    this.state.save();
    return true;
  }

  sellValue(fish) {
    const k = CONFIG.sellRate * (0.5 + fish.data.growth * 0.5);
    return { coins: Math.floor((fish.species.price.coins ?? 0) * k), gems: Math.floor((fish.species.price.gems ?? 0) * k) };
  }

  sellFish(fish) {
    const refund = this.sellValue(fish);
    this.fish.remove(fish);
    this.state.earn(refund);
    this.state.record({ type: 'sellFish', tankId: this.state.activeTank.id, fishId: fish.id, growth: fish.data.growth });
    this.sound.play('coin');
    this.ui.toast(`ขาย "${fish.data.name}" แล้ว`);
    this.events.emit(EV.FISH_SOLD, { fish });
  }

  selectFish(fish) {
    if (this.selectedFish === fish) return;
    if (this.selectedFish && this.sceneMgr.followTarget === this.selectedFish.group) this.sceneMgr.stopFollow();
    this.selectedFish = fish;
    this.ui.fishCard.show(fish);
  }

  followFish(fish) {
    this.sceneMgr.follow(fish.group);
  }

  // ── ดูแล ────────────────────────────────────────────────────

  /** โรยอาหารที่ตำแหน่ง (x, z) หรือสุ่มถ้าไม่ระบุ */
  feed(x, z) {
    const state = this.state;
    const food = getFood(state.data.selectedFood) ?? getFood('flakes');
    if (!state.useItem(food.id)) {
      this.#denied(`${food.name}หมดแล้ว — ซื้อเพิ่มได้ที่เมนูอาหาร`);
      this.ui.open('food');
      return false;
    }
    const { w, d } = this.aquarium.dims;
    this.food.sprinkle(food, x ?? rand(-w * 0.32, w * 0.32), z ?? rand(-d * 0.25, d * 0.2));
    this.sound.play('splash');
    state.data.stats.feeds++;
    state.record({ type: 'feed', tankId: state.activeTank.id, foodId: food.id });
    this.events.emit(EV.FEED, { amount: 1, food });
    return true;
  }

  buyFood(foodId) {
    const food = getFood(foodId);
    if (this.state.itemCount(food.id) + food.pack > LIMITS.maxItem) return this.#denied('คลังอาหารเต็มแล้ว');
    if (!this.state.spend(food.price)) return this.#denied('เงินไม่พอ');
    this.state.addItem(food.id, food.pack);
    this.state.record({ type: 'buyFood', foodId: food.id });
    this.sound.play('buy');
    this.ui.toast(`ซื้อ${food.name} ${food.pack} ห่อแล้ว`);
    return true;
  }

  buyMedicine() {
    const item = CARE_ITEMS.find((c) => c.id === 'medicine');
    if (this.state.itemCount('medicine') >= LIMITS.maxItem) return this.#denied('คลังยาเต็มแล้ว');
    if (!this.state.spend(item.price)) return this.#denied('เงินไม่พอ');
    this.state.addItem('medicine', 1);
    this.state.record({ type: 'buyMedicine' });
    this.sound.play('buy');
    return true;
  }

  useMedicine() {
    if (!this.state.useItem('medicine')) return this.#denied('ไม่มียาแล้ว');
    for (const f of this.fish.alive) f.data.health = Math.min(100, f.data.health + CONFIG.care.medicineHeal);
    this.state.record({ type: 'useMedicine', tankId: this.state.activeTank.id });
    this.sound.play('clean');
    this.ui.toast('💊 ให้ยาแล้ว ปลาทุกตัวแข็งแรงขึ้น', 'success');
    this.events.emit(EV.MEDICINE_USED, { amount: 1 });
    return true;
  }

  cleanTank() {
    if (this.care.clean()) {
      this.state.record({ type: 'cleanTank', tankId: this.state.activeTank.id });
      this.ui.toast('✨ ทำความสะอาดตู้แล้ว น้ำใสปิ๊ง!', 'success');
      return true;
    }
    return this.#denied(`ทำความสะอาดได้อีกใน ${Math.ceil(this.care.cleanCooldownLeft())} วินาที`);
  }

  #denied(message) {
    this.sound.play('error');
    this.ui.toast(message, 'warn');
    return false;
  }

  // ── อื่น ๆ ──────────────────────────────────────────────────

  /** เก็บไข่มุกจากหอยที่เปิดฝาอยู่ */
  collectPearl(decor) {
    const now = Date.now();
    if (now < pearlReadyAt(decor.data, decor.item)) return false;
    const reward = decor.item.pearl.reward;
    const at = decor.clam.pearlPosition();
    decor.data.pearlAt = now;
    this.state.earn(reward);
    this.state.record({ type: 'collectPearl', tankId: this.state.activeTank.id, decorId: decor.id });
    this.ui.floatText(at, `+${reward.coins}`, 'coin');
    this.bubbles.emit(at.x, at.y, at.z, 8, { spread: 0.2 });
    this.sound.play('coin');
    return true;
  }

  /** แตะในฉาก (ไม่ได้ลาก): เก็บเหรียญ → เก็บไข่มุก → เลือกปลา → ยกเลิกการเลือก */
  handleTap(raycaster) {
    const ray = raycaster.ray;
    const coin = this.coins.pick(ray);
    if (coin) {
      this.coins.collect(coin);
      return;
    }
    const clam = this.decor.pickPearl(ray);
    if (clam) {
      this.collectPearl(clam);
      return;
    }
    const fish = this.fish.pick(ray);
    if (fish) this.sound.play('bubble');
    this.selectFish(fish);
  }

  setMode(mode) {
    this.mode = mode;
    this.ui.setMode(mode);
    this.events.emit(EV.MODE, { mode });
  }

  takeScreenshot() {
    this.sceneMgr.render();
    this.sceneMgr.canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `aquarium-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }, 'image/png');
    this.sound.play('camera');
    this.ui.flash();
    this.ui.toast('📷 บันทึกภาพตู้ปลาแล้ว');
    this.events.emit(EV.SCREENSHOT);
  }

  /** เริ่มเกมใหม่ทั้งหมด = รีเซ็ตเซฟกลาง (ทุกอุปกรณ์) — ระบบสำรองเซฟเดิมบนคลาวด์ให้ก่อนเสมอ */
  async resetGame() {
    if (!this.cloud) return false;
    this.ui.toast('กำลังสำรองและรีเซ็ตเซฟกลาง…');
    try {
      await this.cloud.resetSave();
    } catch (err) {
      this.#denied(`รีเซ็ตไม่สำเร็จ: ${err.message}`);
      return false;
    }
    this.resetting = true;
    location.reload();
    return true;
  }

  // ── game loop ───────────────────────────────────────────────

  #loop(now) {
    requestAnimationFrame((t) => this.#loop(t));
    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;
    this.update(dt);
    this.sceneMgr.render();
  }

  update(dt) {
    this.time += dt;
    sharedUniforms.uTime.value = this.time;
    const simDt = dt * CONFIG.timeScale;

    this.sceneMgr.update(dt);
    this.fish.update(dt, simDt, this.time);
    this.food.update(dt, this.time);
    this.coins.update(dt, this.time);
    this.decor.update(dt, this.time);
    this.care.update(simDt);
    this.bubbles.update(dt, this.time);
    this.sparkles.update(dt, this.time);
    this.aquarium.update(dt, this.time, this.sceneMgr.camera);
    this.missions.update(dt);
    this.sound.update(dt);
    this.ui.update(dt);

    this.saveTimer -= dt;
    if (this.saveTimer <= 0) {
      this.saveTimer = CONFIG.autoSaveInterval;
      this.state.save();
    }
  }
}
