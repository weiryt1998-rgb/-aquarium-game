import * as THREE from 'three';
import { disposeObject, forEachMaterial } from '../assets/AssetLoader.js';
import { hashString } from '../utils/math.js';
import { PearlClam } from './PearlClam.js';
import { Critter } from './Critter.js';

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
    const visual = game.models.createDecor(item, hashString(data.id));
    this.object = visual.object;
    this.clam = item.pearl && !preview ? new PearlClam(this.object, item) : null;
    this.group.add(this.object);
    this.bubbleId = null;
    /** ตำแหน่งที่วางล่าสุด (หอยคลานออกจากจุดนี้ได้ จึงเทียบกับข้อมูลจากคลาวด์ด้วยค่านี้แทนตำแหน่งในฉาก) */
    this.placed = { x: data.x, z: data.z };
    this.critter = null;
    this.setPosition(data.x, data.z);
    this.setRotation(data.rotY ?? 0);
    // หอย (ของตกแต่งที่มีชีวิต) — ขยับตัวเองทุกเฟรมใน DecorManager.update
    this.critter = item.critter && !preview ? new Critter(this, { mixer: visual.mixer }) : null;
    if (item.bubbles && !preview) this.#addBubbles();
  }

  /** วางบนพื้นกรวด: ใช้จุดต่ำสุดใต้ฐานเพื่อไม่ให้ลอย */
  setPosition(x, z) {
    this.data.x = x;
    this.data.z = z;
    this.placed = { x, z };
    const aq = this.game.aquarium;
    const r = this.item.radius * 0.6;
    const y = Math.min(aq.heightAt(x, z), aq.heightAt(x + r, z), aq.heightAt(x - r, z), aq.heightAt(x, z + r), aq.heightAt(x, z - r)) - 0.04;
    this.group.position.set(x, y, z);
    this.critter?.reset(x, z);
    if (this.bubbleId) this.game.bubbles.moveSource(this.bubbleId, ...this.#bubblePoint());
  }

  setRotation(rotY) {
    this.data.rotY = rotY;
    this.group.rotation.y = rotY;
    if (this.critter) this.critter.yaw = rotY; // หอยที่คลานได้: หันหัวใหม่แล้วคลานต่อจากทิศนี้
  }

  /** สิ่งกีดขวางทรงกระบอกให้ปลาว่ายหลบ (null = ว่ายผ่านได้) */
  get obstacle() {
    if (!this.item.obstacle) return null;
    return { x: this.data.x, z: this.data.z, r: this.item.radius, top: this.group.position.y + (this.item.obstacleHeight ?? this.item.height) };
  }

  setHighlight(on) {
    // ของที่เรืองแสงเอง (คริสตัล ลาวา) เก็บค่าเดิมไว้ใน userData.baseEmissive
    forEachMaterial(this.object, (m) => m.emissive?.copy(on ? HIGHLIGHT : (m.userData.baseEmissive ?? BLACK)));
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
    this.critter?.dispose();
    if (this.bubbleId) this.game.bubbles.removeSource(this.bubbleId);
    disposeObject(this.group);
  }
}
