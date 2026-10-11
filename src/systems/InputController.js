import * as THREE from 'three';

/**
 * รับเมาส์/นิ้ว/คีย์บอร์ดบน canvas
 * - แยก "แตะ" ออกจาก "ลากหมุนกล้อง" ด้วยระยะและเวลาที่กดค้าง
 * - โหมดตกแต่งส่งต่อให้ PlacementController
 */
export class InputController {
  constructor(game) {
    this.game = game;
    this.canvas = game.sceneMgr.canvas;
    this.raycaster = new THREE.Raycaster();
    this.ndc = new THREE.Vector2();
    this.down = null;
    this.lastHover = 0;

    this.canvas.addEventListener('pointerdown', (e) => this.#onDown(e));
    this.canvas.addEventListener('pointermove', (e) => this.#onMove(e));
    window.addEventListener('pointerup', (e) => this.#onUp(e));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.#onKey(e));
  }

  #updateRay(e) {
    const rect = this.canvas.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.game.sceneMgr.camera);
    return this.raycaster;
  }

  #onDown(e) {
    this.game.sound.unlock();
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), button: e.button };
    if (this.game.mode === 'decor') this.game.placement.onPointerDown(this.#updateRay(e), e);
  }

  #onMove(e) {
    if (this.game.mode === 'decor') {
      this.game.placement.onPointerMove(this.#updateRay(e), e);
      return;
    }
    const now = performance.now();
    if (this.down || now - this.lastHover < 60) return;
    this.lastHover = now;
    const ray = this.#updateRay(e).ray;
    const hover = this.game.coins.pick(ray) || this.game.fish.pick(ray);
    this.canvas.style.cursor = hover ? 'pointer' : '';
  }

  #onUp(e) {
    const down = this.down;
    if (!down) return;
    this.down = null;
    if (this.game.mode === 'decor') {
      this.game.placement.onPointerUp(e);
      return;
    }
    if (e.target !== this.canvas || down.button !== 0) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    if (moved < 8 && performance.now() - down.t < 600) this.game.handleTap(this.#updateRay(e));
  }

  #onKey(e) {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || !this.game.started) return;
    if (this.game.placement.onKey(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Escape') this.game.ui.closeAll();
    else if (e.key === 'f' || e.key === 'F') this.game.feed();
  }
}
