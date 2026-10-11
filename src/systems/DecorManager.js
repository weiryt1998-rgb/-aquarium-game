import * as THREE from 'three';
import { createDecorRecord } from '../core/GameState.js';
import { Decoration } from '../entities/Decoration.js';
import { getDecorItem } from '../data/decor.js';

/** ของตกแต่งทั้งหมดในตู้ที่แสดงอยู่ + ข้อมูลสิ่งกีดขวางสำหรับปลา */
export class DecorManager {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.group = new THREE.Group();
    game.sceneMgr.scene.add(this.group);
    this.obstacles = [];
    this.happinessScore = 0;
    this.cleanBonus = 0;
  }

  load(tank) {
    this.clear();
    for (const record of tank.decor) this.spawn(record);
    this.refresh();
  }

  spawn(record) {
    const item = getDecorItem(record.itemId);
    if (!item) {
      console.warn('ไม่รู้จักของตกแต่ง', record.itemId);
      return null;
    }
    const decor = new Decoration(this.game, record, item);
    this.group.add(decor.group);
    this.items.push(decor);
    return decor;
  }

  add(itemId, x, z, rotY = 0) {
    const record = createDecorRecord(itemId, x, z, rotY);
    this.game.state.activeTank.decor.push(record);
    const decor = this.spawn(record);
    this.refresh();
    return decor;
  }

  remove(decor) {
    const tank = this.game.state.activeTank;
    tank.decor = tank.decor.filter((r) => r !== decor.data);
    this.items = this.items.filter((d) => d !== decor);
    this.group.remove(decor.group);
    decor.dispose();
    this.refresh();
  }

  /** คำนวณค่าที่ขึ้นกับของตกแต่งใหม่ (เรียกหลังเพิ่ม/ลบ/ย้าย) */
  refresh() {
    this.obstacles = this.items.map((d) => d.obstacle).filter(Boolean);
    const happiness = this.items.reduce((s, d) => s + (d.item.happiness ?? 0), 0);
    this.happinessScore = Math.min(1, happiness / 30);
    this.cleanBonus = Math.min(0.5, this.items.reduce((s, d) => s + (d.item.cleanBonus ?? 0), 0));
  }

  /** ตรวจว่าวางทับของชิ้นอื่นมากเกินไปไหม (พืชวางซ้อนได้มากกว่า) */
  overlaps(item, x, z, ignore = null) {
    return this.items.some((d) => {
      if (d === ignore) return false;
      const factor = item.obstacle && d.item.obstacle ? 0.7 : 0.3;
      const min = (item.radius + d.item.radius) * factor;
      const dx = d.data.x - x;
      const dz = d.data.z - z;
      return dx * dx + dz * dz < min * min;
    });
  }

  pick(raycaster) {
    const hit = raycaster.intersectObjects(this.group.children, true)[0];
    let obj = hit?.object;
    while (obj && !obj.userData.decor) obj = obj.parent;
    return obj?.userData.decor ?? null;
  }

  clear() {
    for (const d of this.items) {
      this.group.remove(d.group);
      d.dispose();
    }
    this.items = [];
    this.obstacles = [];
  }
}
