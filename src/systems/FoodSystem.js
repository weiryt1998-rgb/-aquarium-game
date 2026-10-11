import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/EventBus.js';
import { rand } from '../utils/math.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();

/**
 * เม็ดอาหาร: ลอยที่ผิวน้ำครู่หนึ่ง → จมช้า ๆ → ตกถึงพื้น
 * ถ้าไม่มีปลากินนานเกินไปจะเน่า ทำให้น้ำสกปรก (ให้อาหารมากไปไม่ดี!)
 */
export class FoodSystem {
  constructor(game) {
    this.game = game;
    this.max = CONFIG.feed.maxPellets;
    this.pellets = [];
    this.mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.05, 0), new THREE.MeshStandardMaterial({ roughness: 0.7 }), this.max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color()); // สร้าง buffer สีล่วงหน้า
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    game.sceneMgr.scene.add(this.mesh);
  }

  /** โรยอาหารที่ตำแหน่ง (x, z) บนผิวน้ำ */
  sprinkle(food, x, z, count = CONFIG.feed.pelletsPerSprinkle) {
    const aq = this.game.aquarium;
    const top = aq.dims.waterTop;
    for (let i = 0; i < count && this.pellets.length < this.max; i++) {
      const position = new THREE.Vector3(x + rand(-0.55, 0.55), top - 0.03, z + rand(-0.35, 0.35));
      aq.clampToWater(position, 0.15);
      this.pellets.push({
        position,
        food,
        floatTime: rand(0.3, 1.8),
        sinkSpeed: rand(0.22, 0.38),
        phase: rand(0, Math.PI * 2),
        settled: false,
        settledTime: 0,
        color: new THREE.Color(food.color).multiplyScalar(rand(0.85, 1.15)),
        scale: rand(0.7, 1.25),
      });
    }
  }

  findNearest(pos) {
    let best = null;
    let bestD = Infinity;
    for (const p of this.pellets) {
      const d = p.position.distanceToSquared(pos);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  consume(pellet, fish) {
    const i = this.pellets.indexOf(pellet);
    if (i < 0) return;
    this.pellets.splice(i, 1);
    fish.eat(pellet.food);
    this.game.events.emit(EV.FISH_ATE, { fish, food: pellet.food });
  }

  update(dt, time) {
    const aq = this.game.aquarium;
    const top = aq.dims.waterTop;
    for (let i = this.pellets.length - 1; i >= 0; i--) {
      const p = this.pellets[i];
      if (p.floatTime > 0) {
        p.floatTime -= dt;
        p.position.y = top - 0.03 + Math.sin(time * 3 + p.phase) * 0.01;
        p.position.x += Math.sin(time * 0.7 + p.phase) * 0.04 * dt;
      } else if (!p.settled) {
        p.position.y -= p.sinkSpeed * dt;
        p.position.x += Math.sin(time * 1.5 + p.phase) * 0.06 * dt;
        p.position.z += Math.cos(time * 1.2 + p.phase) * 0.04 * dt;
        const floor = aq.heightAt(p.position.x, p.position.z) + 0.03;
        if (p.position.y <= floor) {
          p.position.y = floor;
          p.settled = true;
        }
      } else {
        p.settledTime += dt * CONFIG.timeScale;
        if (p.settledTime > CONFIG.care.foodDecayTime) {
          this.pellets.splice(i, 1);
          this.game.care.addDirt(CONFIG.care.foodDecayDirt);
        }
      }
    }
    for (let i = 0; i < this.pellets.length; i++) {
      const p = this.pellets[i];
      _s.setScalar(p.scale);
      _m.compose(p.position, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      this.mesh.setColorAt(i, p.color);
    }
    this.mesh.count = this.pellets.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() {
    this.pellets = [];
    this.mesh.count = 0;
  }
}
