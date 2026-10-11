import * as THREE from 'three';
import { getRoomTexture, getWoodTexture } from '../render/textures.js';
import { disposeObject } from '../assets/AssetLoader.js';

/** ฉากรอบตู้: โต๊ะไม้และผนังห้องเบลอ ๆ (ไม่โดนหมอกใต้น้ำ) */
export class Room {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
  }

  build(dims) {
    this.clear();
    const { w, d } = dims;

    // โต๊ะ
    const tableW = w + 8;
    const tableD = d + 4.5;
    const thick = 0.7;
    const wood = getWoodTexture();
    wood.repeat.set(tableW / 9, 1);
    const table = new THREE.Mesh(
      new THREE.BoxGeometry(tableW, thick, tableD),
      new THREE.MeshStandardMaterial({ map: wood, roughness: 0.5, metalness: 0.05, fog: false }),
    );
    table.position.set(0, -0.32 - thick / 2, 0.6);
    table.receiveShadow = true;
    this.group.add(table);

    // ผนังห้องรอบด้านหลัง (ทรงกระบอกโค้ง มองจากด้านใน)
    const arc = 4.4;
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(42, 42, 52, 48, 1, true, Math.PI - arc / 2, arc),
      new THREE.MeshBasicMaterial({ map: getRoomTexture(), side: THREE.BackSide, fog: false }),
    );
    wall.position.set(0, 9, 4);
    this.group.add(wall);

    // พื้นห้อง
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 32), new THREE.MeshBasicMaterial({ color: '#1d3350', fog: false }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -9;
    this.group.add(floor);
  }

  clear() {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      disposeObject(child);
    }
  }
}
