import * as THREE from 'three';
import { disposeObject, forEachMaterial } from '../assets/AssetLoader.js';
import { hashString } from '../utils/math.js';

const HIGHLIGHT = new THREE.Color('#2f6f3f');
const BLACK = new THREE.Color('#000000');

/** ของตกแต่ง 1 ชิ้นในตู้ (data = record ในเซฟ: itemId, x, z, rotY) */
export class Decoration {
  constructor(game, data, item, { preview = false } = {}) {
    this.game = game;
    this.data = data;
    this.item = item;
    this.id = data.id;
    this.preview = preview;
    this.group = new THREE.Group();
    this.group.userData.decor = this;
    this.object = game.models.createDecor(item, hashString(data.id)).object;
    this.group.add(this.object);
    this.bubbleId = null;
    this.setPosition(data.x, data.z);
    this.setRotation(data.rotY ?? 0);
    if (item.bubbles && !preview) this.#addBubbles();
  }

  /** วางบนพื้นกรวด: ใช้จุดต่ำสุดใต้ฐานเพื่อไม่ให้ลอย */
  setPosition(x, z) {
    this.data.x = x;
    this.data.z = z;
    const aq = this.game.aquarium;
    const r = this.item.radius * 0.6;
    const y = Math.min(aq.heightAt(x, z), aq.heightAt(x + r, z), aq.heightAt(x - r, z), aq.heightAt(x, z + r), aq.heightAt(x, z - r)) - 0.04;
    this.group.position.set(x, y, z);
    if (this.bubbleId) this.game.bubbles.moveSource(this.bubbleId, ...this.#bubblePoint());
  }

  setRotation(rotY) {
    this.data.rotY = rotY;
    this.group.rotation.y = rotY;
  }

  /** สิ่งกีดขวางทรงกระบอกให้ปลาว่ายหลบ (null = ว่ายผ่านได้) */
  get obstacle() {
    if (!this.item.obstacle) return null;
    return { x: this.data.x, z: this.data.z, r: this.item.radius, top: this.group.position.y + (this.item.obstacleHeight ?? this.item.height) };
  }

  setHighlight(on) {
    forEachMaterial(this.object, (m) => m.emissive?.copy(on ? HIGHLIGHT : BLACK));
  }

  #bubblePoint() {
    const p = this.group.position;
    const h = this.item.placeholder === 'bubbler' ? this.item.height * 0.8 : this.item.height * 0.75;
    return [p.x, p.y + h, p.z];
  }

  #addBubbles() {
    const [x, y, z] = this.#bubblePoint();
    this.bubbleId = `decor:${this.id}`;
    const b = this.item.bubbles;
    this.game.bubbles.addSource(this.bubbleId, { x, y, z, rate: b.rate, burst: b.burst ?? 0, burstInterval: b.burstInterval ?? 0, spread: 0.06 });
  }

  dispose() {
    if (this.bubbleId) this.game.bubbles.removeSource(this.bubbleId);
    disposeObject(this.group);
  }
}
