import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EV } from '../core/EventBus.js';
import { getCoinFaceTexture } from '../render/textures.js';
import { clamp, rand } from '../utils/math.js';

const _closest = new THREE.Vector3();

/**
 * เหรียญที่ปลามีความสุขผลิตออกมา: ลอยขึ้นสู่ผิวน้ำ แตะเพื่อเก็บ
 * ถ้าไม่เก็บ จะถูกเก็บให้อัตโนมัติหลังลอยค้างที่ผิวน้ำครู่หนึ่ง
 */
export class CoinSystem {
  constructor(game) {
    this.game = game;
    this.coins = [];
    this.group = new THREE.Group();
    game.sceneMgr.scene.add(this.group);
    this.geometry = new THREE.CylinderGeometry(0.15, 0.15, 0.035, 28);
    this.geometry.rotateX(Math.PI / 2); // ตั้งเหรียญให้หน้าเหรียญหันออกด้านข้าง
    const face = getCoinFaceTexture();
    const side = new THREE.MeshStandardMaterial({ color: '#f0b429', metalness: 0.85, roughness: 0.3, emissive: '#6a4300', emissiveIntensity: 0.6, fog: false });
    const cap = new THREE.MeshStandardMaterial({ map: face, metalness: 0.55, roughness: 0.35, emissive: '#ffffff', emissiveMap: face, emissiveIntensity: 0.35, fog: false });
    this.materials = [side, cap, cap];
  }

  spawn(position, value) {
    if (this.coins.length >= CONFIG.coins.maxInTank) this.collect(this.coins[0], { auto: true });
    const mesh = new THREE.Mesh(this.geometry, this.materials);
    mesh.position.copy(position);
    mesh.position.y += 0.15;
    mesh.scale.setScalar(0.01);
    mesh.renderOrder = 2;
    this.group.add(mesh);
    this.coins.push({ mesh, value, age: 0, surfaceTime: 0, phase: rand(0, Math.PI * 2) });
  }

  update(dt, time) {
    const top = this.game.aquarium.dims.waterTop - 0.18;
    for (const coin of [...this.coins]) {
      const m = coin.mesh;
      coin.age += dt;
      m.scale.setScalar(clamp(coin.age / 0.35, 0.01, 1));
      m.rotation.y += dt * 2.4;
      if (m.position.y < top) {
        m.position.y = Math.min(top, m.position.y + CONFIG.coins.riseSpeed * dt);
        m.position.x += Math.sin(time * 2 + coin.phase) * 0.1 * dt;
      } else {
        m.position.y = top + Math.sin(time * 2.5 + coin.phase) * 0.03;
        coin.surfaceTime += dt;
        if (coin.surfaceTime > CONFIG.coins.surfaceTime) this.collect(coin, { auto: true });
      }
    }
  }

  /** เหรียญที่ถูกคลิก (ใช้ทรงกลมครอบให้คลิกง่าย) */
  pick(ray) {
    let best = null;
    let bestDist = Infinity;
    for (const coin of this.coins) {
      const p = coin.mesh.position;
      if (ray.distanceSqToPoint(p) > 0.36 * 0.36) continue;
      const d = ray.closestPointToPoint(p, _closest).distanceTo(ray.origin);
      if (d < bestDist) {
        bestDist = d;
        best = coin;
      }
    }
    return best;
  }

  collect(coin, { auto = false } = {}) {
    const i = this.coins.indexOf(coin);
    if (i < 0) return;
    this.coins.splice(i, 1);
    this.group.remove(coin.mesh);
    this.game.state.earn({ coins: coin.value });
    this.game.state.record({ type: 'collectCoins', tankId: this.game.state.activeTank.id, count: 1, value: coin.value });
    this.game.ui.floatText(coin.mesh.position, `+${coin.value}`, 'coin');
    if (!auto) this.game.sound.play('coin');
    this.game.events.emit(EV.COIN_COLLECTED, { amount: 1, value: coin.value, auto });
  }

  clear() {
    this.coins.forEach((c) => this.group.remove(c.mesh));
    this.coins = [];
  }
}
