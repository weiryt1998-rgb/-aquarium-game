import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/EventBus.js';
import { Decoration } from '../entities/Decoration.js';
import { getDecorItem } from '../data/decor.js';

/**
 * โหมดตกแต่งตู้: เลือกของ → วางบนพื้นทราย, ลากเพื่อย้าย, หมุน, ขายคืน
 * ระหว่างโหมดนี้ คลิกซ้ายใช้จัดของ ส่วนการหมุนกล้องใช้คลิกขวา (มือถือ: สองนิ้ว)
 */
export class PlacementController {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.state = 'idle'; // idle | placing | moving
    this.preview = null;
    this.previewItem = null;
    this.selected = null;
    this.snap = true;
    this.valid = false;
    this.rotation = 0;
    this.moveOrigin = null;
    this.dragOffset = { x: 0, z: 0 };
    this.moved = false;
  }

  enter() {
    if (this.active) return;
    this.active = true;
    this.game.selectFish(null);
    const sm = this.game.sceneMgr;
    sm.decorView();
    sm.controls.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
    sm.controls.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
    this.game.aquarium.showGrid(true);
    this.game.setMode('decor');
  }

  exit() {
    if (!this.active) return;
    this.cancelPlacing();
    this.select(null);
    this.state = 'idle';
    this.active = false;
    const sm = this.game.sceneMgr;
    sm.controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
    sm.controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
    sm.flyTo(sm.home.position, sm.home.target);
    this.game.aquarium.showGrid(false);
    this.game.aquarium.hideMarker();
    this.game.setMode('normal');
    this.game.state.save();
  }

  startPlacing(itemId) {
    const item = getDecorItem(itemId);
    if (!item) return;
    this.cancelPlacing();
    this.select(null);
    if (!this.game.state.canAfford(item.price)) {
      this.game.sound.play('error');
      this.game.ui.toast('เหรียญไม่พอสำหรับของชิ้นนี้', 'warn');
      return;
    }
    const record = { id: `preview_${Date.now()}`, itemId, x: 0, z: 0, rotY: this.rotation };
    this.preview = new Decoration(this.game, record, item, { preview: true });
    this.preview.group.visible = false;
    this.game.sceneMgr.scene.add(this.preview.group);
    this.previewItem = item;
    this.state = 'placing';
    this.game.ui.decorToolbar.refresh();
  }

  cancelPlacing() {
    if (this.preview) {
      this.game.sceneMgr.scene.remove(this.preview.group);
      this.preview.dispose();
      this.preview = null;
      this.previewItem = null;
    }
    if (this.state === 'placing') this.state = 'idle';
    this.game.aquarium.hideMarker();
    this.game.ui.decorToolbar?.refresh();
  }

  select(decor) {
    this.selected?.setHighlight(false);
    this.selected = decor;
    if (decor) {
      decor.setHighlight(true);
      this.game.aquarium.showMarker(decor.data.x, decor.data.z, decor.item.radius, true);
    } else {
      this.game.aquarium.hideMarker();
    }
    this.game.ui.decorToolbar?.refresh();
  }

  #snap(v) {
    return this.snap ? Math.round(v / CONFIG.gridSize) * CONFIG.gridSize : v;
  }

  #isValid(item, x, z, ignore) {
    return this.game.aquarium.isInside(x, z, item.radius) && !this.game.decor.overlaps(item, x, z, ignore);
  }

  #updatePreview(point) {
    const x = this.#snap(point.x);
    const z = this.#snap(point.z);
    this.preview.group.visible = true;
    this.preview.setPosition(x, z);
    this.valid = this.#isValid(this.previewItem, x, z, null) && this.game.state.canAfford(this.previewItem.price);
    this.game.aquarium.showMarker(x, z, this.previewItem.radius, this.valid);
  }

  // ── เหตุการณ์จากเมาส์/นิ้ว (เรียกจาก InputController) ────────

  onPointerDown(raycaster, event) {
    if (event.button === 2) {
      if (this.state === 'placing') this.cancelPlacing();
      return;
    }
    if (event.button !== 0) return;
    const point = this.game.aquarium.raycastSubstrate(raycaster);

    if (this.state === 'placing') {
      if (!point) return;
      this.#updatePreview(point);
      if (!this.valid) {
        this.game.sound.play('error');
        this.game.ui.toast(this.game.state.canAfford(this.previewItem.price) ? 'วางตรงนี้ไม่ได้ ชิดขอบตู้หรือทับของอื่นมากไป' : 'เหรียญไม่พอแล้ว', 'warn');
        return;
      }
      const item = this.previewItem;
      if (!this.game.state.spend(item.price)) return;
      const { x, z, rotY } = this.preview.data;
      const decor = this.game.decor.add(item.id, x, z, rotY);
      this.game.bubbles.emit(x, decor.group.position.y + 0.2, z, 6, { spread: item.radius * 0.5 });
      this.game.sound.play('place');
      this.game.events.emit(EV.DECOR_PLACED, { decor });
      // กด Shift ค้างไว้เพื่อวางชิ้นเดิมต่อ
      if (!(event.shiftKey && this.game.state.canAfford(item.price))) {
        this.cancelPlacing();
        this.select(decor);
      }
      return;
    }

    const decor = this.game.decor.pick(raycaster);
    if (decor) {
      this.select(decor);
      this.state = 'moving';
      this.moved = false;
      this.valid = true;
      this.moveOrigin = { x: decor.data.x, z: decor.data.z };
      this.dragOffset = point ? { x: decor.data.x - point.x, z: decor.data.z - point.z } : { x: 0, z: 0 };
    } else {
      this.select(null);
    }
  }

  onPointerMove(raycaster) {
    if (this.state === 'placing') {
      const point = this.game.aquarium.raycastSubstrate(raycaster);
      if (point) this.#updatePreview(point);
      else {
        this.preview.group.visible = false;
        this.game.aquarium.hideMarker();
      }
    } else if (this.state === 'moving' && this.selected) {
      const point = this.game.aquarium.raycastSubstrate(raycaster);
      if (!point) return;
      const x = this.#snap(point.x + this.dragOffset.x);
      const z = this.#snap(point.z + this.dragOffset.z);
      if (x === this.selected.data.x && z === this.selected.data.z) return;
      this.moved = true;
      this.valid = this.#isValid(this.selected.item, x, z, this.selected);
      this.selected.setPosition(x, z);
      this.game.aquarium.showMarker(x, z, this.selected.item.radius, this.valid);
    }
  }

  onPointerUp() {
    if (this.state !== 'moving') return;
    this.state = 'idle';
    const decor = this.selected;
    if (!decor) return;
    if (!this.valid) {
      decor.setPosition(this.moveOrigin.x, this.moveOrigin.z);
      this.game.ui.toast('ตำแหน่งนั้นวางไม่ได้ ย้ายกลับที่เดิมแล้ว', 'warn');
    } else if (this.moved) {
      this.game.sound.play('place');
    }
    this.game.decor.refresh();
    this.game.aquarium.showMarker(decor.data.x, decor.data.z, decor.item.radius, true);
  }

  rotate(delta = Math.PI / 4) {
    if (this.preview) {
      this.rotation = this.preview.data.rotY + delta;
      this.preview.setRotation(this.rotation);
    } else if (this.selected) {
      this.selected.setRotation(this.selected.data.rotY + delta);
    }
  }

  sellValue(decor) {
    const p = decor.item.price;
    return { coins: Math.floor((p.coins ?? 0) * CONFIG.decorSellRate), gems: Math.floor((p.gems ?? 0) * CONFIG.decorSellRate) };
  }

  sellSelected() {
    const decor = this.selected;
    if (!decor) return;
    const refund = this.sellValue(decor);
    this.select(null);
    this.game.decor.remove(decor);
    this.game.state.earn(refund);
    this.game.sound.play('coin');
    this.game.ui.toast(`ขาย${decor.item.name}ได้ ${refund.coins} เหรียญ`);
    this.game.events.emit(EV.DECOR_SOLD, { item: decor.item });
  }

  /** @returns {boolean} true ถ้าจัดการปุ่มนี้แล้ว */
  onKey(event) {
    if (!this.active) return false;
    if (event.key === 'Escape') {
      if (this.state === 'placing') this.cancelPlacing();
      else if (this.selected) this.select(null);
      else this.exit();
      return true;
    }
    if (event.key === 'r' || event.key === 'R') {
      this.rotate(event.shiftKey ? -Math.PI / 4 : Math.PI / 4);
      return true;
    }
    return false;
  }
}
