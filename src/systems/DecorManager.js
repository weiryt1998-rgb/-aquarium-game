import * as THREE from 'three';
import { createDecorRecord } from '../core/GameState.js';
import { Decoration } from '../entities/Decoration.js';
import { getDecorItem } from '../data/decor.js';

const _pearl = new THREE.Vector3();

/** ของตกแต่งทั้งหมดในตู้ที่แสดงอยู่ + ข้อมูลสิ่งกีดขวางสำหรับปลา */
export class DecorManager {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.group = new THREE.Group();
    game.sceneMgr.scene.add(this.group);
    this.obstacles = [];
    /** ที่หลบซ่อนของปลา (Fish AI): พุ่มพืชน้ำว่ายเข้าไปได้ ของตกแต่งอื่นหลบข้าง ๆ */
    this.covers = [];
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

  /**
   * ทำให้ของตกแต่งในฉากตรงกับ record ของตู้ (หลังรับข้อมูลจากเซฟกลาง)
   * skipId = ชิ้นที่ผู้เล่นกำลังลากอยู่ ไม่ย้ายตามข้อมูลจากคลาวด์
   */
  syncRecords(tank, { skipId = null } = {}) {
    const records = new Map(tank.decor.map((r) => [r.id, r]));
    let changed = false;
    for (const decor of [...this.items]) {
      const record = records.get(decor.id);
      if (!record) {
        if (this.game.placement.selected === decor) this.game.placement.select(null);
        this.remove(decor);
        changed = true;
        continue;
      }
      decor.data = record;
      if (decor.id === skipId) continue;
      if (decor.group.position.x !== record.x || decor.group.position.z !== record.z) {
        decor.setPosition(record.x, record.z);
        changed = true;
      }
      if (decor.group.rotation.y !== record.rotY) {
        decor.setRotation(record.rotY);
        changed = true;
      }
    }
    for (const record of tank.decor) {
      if (this.items.some((d) => d.id === record.id)) continue;
      if (this.spawn(record)) changed = true;
    }
    if (changed) this.refresh();
    return changed;
  }

  /** เปิด-ปิดฝาหอยตามเวลาไข่มุก */
  update(dt, time) {
    for (const d of this.items) {
      if (!d.clam?.update(dt, time, d.data)) continue;
      const p = d.clam.pearlPosition();
      this.game.bubbles.emit(p.x, p.y, p.z, 10, { spread: 0.3 });
      this.game.sound.play('bubble');
    }
  }

  /** หอยที่ไข่มุกพร้อมเก็บและถูกแตะ (ใช้ทรงกลมครอบให้แตะง่ายเหมือนเหรียญ) */
  pickPearl(ray) {
    let best = null;
    let bestDist = Infinity;
    for (const d of this.items) {
      if (!d.clam?.pearl.visible) continue;
      const p = d.clam.pearlPosition(_pearl);
      if (ray.distanceSqToPoint(p) > 0.45 * 0.45) continue;
      const dist = p.distanceTo(ray.origin);
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    return best;
  }

  /** คำนวณค่าที่ขึ้นกับของตกแต่งใหม่ (เรียกหลังเพิ่ม/ลบ/ย้าย) */
  refresh() {
    this.obstacles = this.items.map((d) => d.obstacle).filter(Boolean);
    this.covers = this.items
      .filter((d) => d.item.category === 'plant' || d.item.obstacle)
      .map((d) => ({ x: d.data.x, z: d.data.z, r: d.item.radius, top: d.group.position.y + (d.item.obstacleHeight ?? d.item.height), plant: d.item.category === 'plant' }));
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
    this.covers = [];
  }
}
