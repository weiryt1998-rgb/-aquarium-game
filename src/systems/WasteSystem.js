import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { rand } from '../utils/math.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _back = new THREE.Vector3();

/**
 * ของเสียที่ปลาปล่อยออกมา (ภาพของระบบนิเวศ): ลอยจมช้า ๆ = ฝุ่นขยะในน้ำ → ตกถึงพื้น = ของเสียบนทราย
 * หอยที่คลานบนพื้นไปเก็บกิน หอยสองฝาดูดฝุ่นที่ลอยผ่านใกล้ ๆ ไม่มีใครกินนาน ๆ จะสลายไปเอง ทำความสะอาดตู้แล้วหายหมด
 * ผลต่อคุณภาพน้ำคิดใน Simulation Engine (sim/ecology.ts) — ระบบนี้เป็นภาพเท่านั้น ไม่ต้องบันทึกลงเซฟ
 * ใช้ InstancedMesh เดียว (draw call เดียว) และจำกัดจำนวนที่ CONFIG.ecology.maxWaste
 */
export class WasteSystem {
  constructor(game) {
    this.game = game;
    this.max = CONFIG.ecology.maxWaste;
    this.items = [];
    this.spawnAcc = 0;
    this.mesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.035, 6, 4), new THREE.MeshStandardMaterial({ color: '#4b3a26', roughness: 1 }), this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    game.sceneMgr.scene.add(this.mesh);
  }

  /** ปล่อยของเสีย 1 ก้อนที่ตำแหน่ง (เช่น ใต้หางปลา) */
  drop(position) {
    if (this.items.length >= this.max) return null;
    const item = { position: position.clone(), settled: false, age: 0, sink: rand(0.07, 0.12), phase: rand(0, Math.PI * 2), scale: rand(0.7, 1.3), gone: false };
    this.items.push(item);
    return item;
  }

  /**
   * ของเสียบนพื้นที่ใกล้ที่สุดภายในรัศมี (หอยที่คลานบนพื้นใช้หาอาหาร)
   * @param {(position) => boolean} [reachable] กรองก้อนที่ไปไม่ถึงออก (เช่น ตกบนฐานของตกแต่ง)
   */
  nearestSettled(pos, radius, reachable = null) {
    let best = null;
    let bestD = radius * radius;
    for (const w of this.items) {
      if (!w.settled || (reachable && !reachable(w.position))) continue;
      const dx = w.position.x - pos.x;
      const dz = w.position.z - pos.z;
      const d = dx * dx + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = w;
      }
    }
    return best;
  }

  consume(item) {
    const i = this.items.indexOf(item);
    if (i < 0) return false;
    this.items.splice(i, 1);
    item.gone = true;
    return true;
  }

  /**
   * หอยสองฝากรองน้ำ: ดูดฝุ่นที่ยังลอยอยู่ภายในรัศมีเข้าหาตัว แล้วกินเมื่อถึงปากหอย
   * @returns {number} จำนวนที่กินในเฟรมนี้
   */
  filterNear(pos, radius, dt) {
    let eaten = 0;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const w = this.items[i];
      if (w.settled) continue;
      _back.subVectors(pos, w.position);
      const d = _back.length();
      if (d > radius) continue;
      if (d < 0.12) {
        this.items.splice(i, 1);
        w.gone = true;
        eaten++;
        continue;
      }
      w.position.addScaledVector(_back, (Math.min(0.35, d) * dt) / d);
    }
    return eaten;
  }

  update(dt, time) {
    const game = this.game;
    const aq = game.aquarium;
    if (!aq.dims) return;
    const scaled = dt * CONFIG.timeScale;
    const E = CONFIG.ecology;

    // ปลาปล่อยของเสียตามจำนวนปลา (สุ่มตัวที่ปล่อย ไม่ต้องจับเวลาทีละตัว)
    const fish = game.fish.list;
    this.spawnAcc += (fish.length / E.wasteInterval) * scaled;
    while (this.spawnAcc >= 1) {
      this.spawnAcc -= 1;
      const f = fish[Math.floor(Math.random() * fish.length)];
      if (!f || f.dying || f.species.behavior.walker) continue;
      _back.copy(f.heading).multiplyScalar(-f.length * 0.45).add(f.position);
      this.drop(_back);
    }

    for (let i = this.items.length - 1; i >= 0; i--) {
      const w = this.items[i];
      const p = w.position;
      if (!w.settled) {
        p.y -= w.sink * dt;
        p.x += Math.sin(time * 0.9 + w.phase) * 0.05 * dt;
        p.z += Math.cos(time * 0.7 + w.phase) * 0.03 * dt;
        aq.clampToWater(p, 0.05);
        const floor = aq.heightAt(p.x, p.z) + 0.02;
        if (p.y <= floor) {
          p.y = floor;
          w.settled = true;
        }
      } else {
        w.age += scaled;
        if (w.age > E.wasteLife) {
          this.items.splice(i, 1);
          w.gone = true;
        }
      }
    }

    for (let i = 0; i < this.items.length; i++) {
      const w = this.items[i];
      _s.set(w.scale, w.settled ? w.scale * 0.55 : w.scale, w.scale);
      _m.compose(w.position, _q, _s);
      this.mesh.setMatrixAt(i, _m);
    }
    this.mesh.count = this.items.length;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    for (const w of this.items) w.gone = true;
    this.items = [];
    this.mesh.count = 0;
  }
}
