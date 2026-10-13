import { EV } from '../core/EventBus.js';
import { getFood } from '../data/food.js';
import { getTankType } from '../data/tanks.js';
import { clamp, formatNumber } from '../utils/math.js';
import { ICONS, coinIcon, gemIcon } from './icons.js';
import { collectRefs } from './helpers.js';
import { DecorToolbar } from './DecorToolbar.js';
import { FishCard } from './FishCard.js';
import { StartScreen } from './StartScreen.js';
import { ShopPanel } from './panels/ShopPanel.js';
import { FishPanel } from './panels/FishPanel.js';
import { FoodPanel } from './panels/FoodPanel.js';
import { MissionsPanel } from './panels/MissionsPanel.js';
import { SettingsPanel } from './panels/SettingsPanel.js';
import { HelpPanel, MenuPanel } from './panels/MenuPanel.js';
import { CloudPanel } from './panels/CloudPanel.js';
import { SaveStatus } from '../cloud/SaveStatus.js';

const TEMPLATE = /* html */ `
  <div class="hud">
    <div class="hud-top-left">
      <div class="currency coins" data-ref="coinPill" title="เหรียญ">${coinIcon}<b data-ref="coins">0</b></div>
      <button class="currency gems" data-ref="gemPill" data-action="exchange" title="เพชร — แตะเพื่อแลกเหรียญเป็นเพชร">${gemIcon}<b data-ref="gems">0</b></button>
      <button class="btn-plus" data-action="missions" title="ภารกิจและรางวัล">${ICONS.plus}<i class="badge" data-ref="plusBadge"></i></button>
    </div>

    <div class="hud-top-right">
      <button class="btn-round" data-action="settings" title="ตั้งค่า">${ICONS.gear}</button>
      <button class="btn-round" data-action="screenshot" title="ถ่ายภาพตู้ปลา">${ICONS.camera}</button>
      <button class="btn-round" data-action="menu" title="เมนู">${ICONS.menu}<i class="badge" data-ref="menuBadge"></i></button>
    </div>
    <button class="save-status hidden" data-ref="saveStatus" type="button"></button>

    <nav class="sidebar">
      <button data-action="fish"><span class="ico">🐠</span><span>ปลา</span></button>
      <button data-action="decor"><span class="ico">🪴</span><span>ตกแต่ง</span></button>
      <button data-action="food"><span class="ico">🥫</span><span>อาหาร</span></button>
      <button data-action="shop"><span class="ico">🏪</span><span>ร้านค้า</span></button>
    </nav>

    <div class="tank-label" data-ref="tankLabel"></div>

    <div class="status-panel">
      <div class="stat happy">
        <div class="stat-head"><span class="emoji">😊</span>ความสุข<em data-ref="valHappy"></em></div>
        <div class="bar"><i data-ref="barHappy"></i></div>
      </div>
      <div class="stat clean">
        <div class="stat-head"><span class="emoji">💧</span>ความสะอาด<em data-ref="valClean"></em>
          <button class="mini-btn" data-action="clean" data-ref="cleanBtn" title="ทำความสะอาดตู้">🧽</button>
        </div>
        <div class="bar"><i data-ref="barClean"></i></div>
      </div>
      <div class="stat health">
        <div class="stat-head"><span class="emoji">❤️</span>สุขภาพ<em data-ref="valHealth"></em></div>
        <div class="bar"><i data-ref="barHealth"></i></div>
      </div>
    </div>

    <button class="feed-btn" data-action="feed" data-ref="feedBtn" title="ให้อาหาร (F)">
      ${ICONS.jar}
      <span>ให้อาหาร</span>
      <small data-ref="feedCount"></small>
    </button>
  </div>

  <div class="decor-toolbar hidden"></div>
  <div class="fish-card hidden"></div>
  <div class="modal-root"></div>
  <div class="toasts" data-ref="toasts"></div>
  <div class="floaters" data-ref="floaters"></div>
  <div class="flash" data-ref="flash"></div>
  <div class="start-screen"></div>
`;

/** ชั้น UI ทั้งหมด (HTML ซ้อนบน canvas) */
export class UI {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    root.innerHTML = TEMPLATE;
    this.refs = collectRefs(root);
    this.modalRoot = root.querySelector('.modal-root');
    this.panels = {
      shop: new ShopPanel(this),
      fish: new FishPanel(this),
      food: new FoodPanel(this),
      missions: new MissionsPanel(this),
      settings: new SettingsPanel(this),
      menu: new MenuPanel(this),
      help: new HelpPanel(this),
      ...(game.cloud ? { cloud: new CloudPanel(this) } : {}),
    };
    this.activePanel = null;
    this.decorToolbar = new DecorToolbar(this, root.querySelector('.decor-toolbar'));
    this.fishCard = new FishCard(this, root.querySelector('.fish-card'));
    this.start = new StartScreen(this, root.querySelector('.start-screen'));
    if (game.cloud) {
      this.refs.saveStatus.classList.remove('hidden');
      this.saveStatus = new SaveStatus(this, this.refs.saveStatus, game.cloud);
    }
    this.hudTimer = 0;
    this.shown = { coins: game.state.coins, gems: game.state.gems };

    root.querySelector('.hud').addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (el) this.#onHudAction(el.dataset.action);
    });
    game.events.on(EV.CURRENCY, () => this.#updateCurrency(true));
    game.events.on(EV.INVENTORY, () => this.refreshFeedButton());
    game.events.on(EV.FISH_COUNT, () => this.refreshTank());
    this.#updateCurrency(false);
    this.refreshFeedButton();
  }

  #onHudAction(action) {
    const game = this.game;
    if (action !== 'feed') game.sound.play('click');
    switch (action) {
      case 'fish':
      case 'food':
      case 'shop':
      case 'missions':
      case 'settings':
      case 'menu':
        this.open(action);
        break;
      case 'decor':
        this.closeAll();
        game.placement.enter();
        break;
      case 'screenshot':
        game.takeScreenshot();
        break;
      case 'feed':
        game.feed();
        break;
      case 'clean':
        game.cleanTank();
        break;
      case 'exchange':
        this.open('shop', { tab: 'exchange' });
        break;
      default:
        break;
    }
  }

  open(name, options = {}) {
    const panel = this.panels[name];
    if (!panel) return;
    if (this.activePanel && this.activePanel !== panel) this.activePanel.close();
    this.activePanel = panel;
    panel.open(options);
  }

  closeAll() {
    this.activePanel?.close();
    this.activePanel = null;
  }

  setMode(mode) {
    this.root.classList.toggle('mode-decor', mode === 'decor');
    if (mode === 'decor') {
      this.closeAll();
      this.decorToolbar.show();
    } else {
      this.decorToolbar.hide();
    }
  }

  refreshTank() {
    const type = getTankType(this.game.state.activeTank.typeId);
    this.refs.tankLabel.textContent = `${type.name} ${type.label} · ปลา ${this.game.fish.count}/${type.capacity} ตัว`;
  }

  refreshFeedButton() {
    const state = this.game.state;
    const food = getFood(state.data.selectedFood) ?? getFood('flakes');
    const n = state.itemCount(food.id);
    this.refs.feedCount.textContent = `${food.icon} x${n}`;
    this.refs.feedBtn.classList.toggle('empty', n === 0);
  }

  #updateCurrency(animate) {
    const s = this.game.state;
    this.refs.coins.textContent = formatNumber(s.coins);
    this.refs.gems.textContent = formatNumber(s.gems);
    if (animate) {
      const bump = (el) => {
        el.classList.remove('bump');
        void el.offsetWidth;
        el.classList.add('bump');
      };
      if (s.coins !== this.shown.coins) bump(this.refs.coinPill);
      if (s.gems !== this.shown.gems) bump(this.refs.gemPill);
    }
    this.shown = { coins: s.coins, gems: s.gems };
  }

  #setBar(name, value) {
    const v = Math.round(clamp(value, 0, 100));
    const bar = this.refs[`bar${name}`];
    bar.style.width = `${v}%`;
    bar.parentElement.classList.toggle('low', v < 30);
    this.refs[`val${name}`].textContent = `${v}%`;
  }

  update(dt) {
    this.hudTimer -= dt;
    if (this.hudTimer > 0) return;
    const step = 0.25 - this.hudTimer;
    this.hudTimer = 0.25;
    const care = this.game.care;
    this.#setBar('Happy', care.avgHappiness);
    this.#setBar('Clean', care.cleanliness);
    this.#setBar('Health', care.avgHealth);
    const wait = care.cleanCooldownLeft();
    this.refs.cleanBtn.classList.toggle('cooldown', wait > 0);
    this.refs.cleanBtn.title = wait > 0 ? `ทำความสะอาดได้อีกใน ${Math.ceil(wait)} วินาที` : 'ทำความสะอาดตู้';
    const claimable = this.game.missions.claimableCount > 0;
    this.refs.plusBadge.classList.toggle('show', claimable);
    this.refs.menuBadge.classList.toggle('show', claimable);
    this.activePanel?.tick(step);
    this.fishCard.update();
    this.decorToolbar.tick();
  }

  toast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    this.refs.toasts.appendChild(el);
    while (this.refs.toasts.children.length > 4) this.refs.toasts.firstChild.remove();
    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 400);
    }, 3200);
  }

  /** ตัวเลขลอยขึ้นจากตำแหน่งในฉาก 3 มิติ (เช่น +5 ตอนเก็บเหรียญ) */
  floatText(worldPos, text, kind = '') {
    const v = worldPos.clone().project(this.game.sceneMgr.camera);
    if (v.z > 1) return;
    const el = document.createElement('div');
    el.className = `floater ${kind}`;
    el.innerHTML = kind === 'coin' ? `${coinIcon}<span>${text}</span>` : `<span>${text}</span>`;
    el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
    el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
    this.refs.floaters.appendChild(el);
    setTimeout(() => el.remove(), 1300);
  }

  flash() {
    const f = this.refs.flash;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }
}
