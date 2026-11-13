import * as THREE from 'three';
import { GRASS_PATCHES, PATCH_D, PATCH_W, patchCenter } from '../shared/farm.js';
import { seededRandom } from '../utils/math.js';
import { TROUGH } from './Farm.js';

/**
 * หญ้าในคอกวัว (ฝั่งแสดงผลของ farm.grass ใน shared/farm.js) — 24 แปลง
 *  - ดิน: แผ่นสีใต้แต่ละแปลง สีตามความชื้น (แห้ง = ดินอ่อน · ชื้น = ดินเข้ม) และกลายเป็นเขียวเมื่อหญ้าเต็ม
 *  - หญ้า: กอหญ้า InstancedMesh ชุดเดียวทั้งคอก (1 draw call) · หญ้าน้อย = กอหายไปทีละกอ + ที่เหลือเตี้ยลง
 *    กอที่หายก่อนสุ่มคงที่ต่อแปลง (ตำแหน่งเดิมทุกครั้ง ไม่กระพริบ) · ปลายใบไหวตามลม (shader)
 *  - รดน้ำ: หยดน้ำตกลงบนแปลง (splash)
 */

const TUFTS_PER_PATCH = 110;
const BLADES = 7;
const COLORS = {
  dirt: new THREE.Color('#a8915c'),
  wetDirt: new THREE.Color('#5d4c2f'),
  turf: new THREE.Color('#6f9e45'),
  lush: new THREE.Color('#ffffff'),
  dry: new THREE.Color('#d8cf8a'),
};

/** กอหญ้า 1 กอ: ใบเรียวหลายใบเอนออกรอบทิศ · สีไล่จากโคนเข้มถึงปลายอ่อน (สูง 1 หน่วย ย่อด้วย instance) */
export function tuftGeometry() {
  const rnd = seededRandom(0.42);
  const pos = [];
  const col = [];
  const base = new THREE.Color('#3f6b25');
  const tip = new THREE.Color('#a9cf62');
  for (let b = 0; b < BLADES; b++) {
    const a = (b / BLADES) * Math.PI * 2 + rnd() * 0.6;
    const r = 0.03 + rnd() * 0.05;
    const h = 0.7 + rnd() * 0.3;
    const lean = 0.15 + rnd() * 0.25;
    const w = 0.022 + rnd() * 0.012;
    const cx = Math.cos(a) * r;
    const cz = Math.sin(a) * r;
    const px = -Math.sin(a) * w;
    const pz = Math.cos(a) * w;
    pos.push(cx - px, 0, cz - pz, cx + px, 0, cz + pz, cx + Math.cos(a) * lean, h, cz + Math.sin(a) * lean);
    col.push(...base.toArray(), ...base.toArray(), ...tip.toArray());
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  // ใบหญ้าบาง: ให้แสงเหมือนหันขึ้นฟ้า (สว่างสม่ำเสมอทั้งสองด้าน)
  const n = geo.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return geo;
}

/**
 * วัสดุพืชไหวตามลม (หญ้า/กก/ดอกไม้): ปลายบน (y ของ geometry สูง) ไหวมากกว่าโคน · แต่ละต้นจังหวะต่างกันตามตำแหน่ง instance
 * @param {{ value: number }} time uniform เวลา (ใช้ร่วมกันได้) · base = วัสดุตั้งต้น (ไม่ระบุ = สีจาก vertex color)
 */
export function swayMaterial(time, base = null, amount = 0.12) {
  const mat = base ?? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = time;
    sh.vertexShader = `uniform float uTime;\n${sh.vertexShader}`.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float bend = position.y * position.y;
      vec2 ip = vec2(instanceMatrix[3][0], instanceMatrix[3][2]);
      float gust = sin(uTime * 1.6 + ip.x * 0.55 + ip.y * 0.35) + 0.4 * sin(uTime * 3.1 + ip.y * 1.3);
      transformed.x += gust * ${amount.toFixed(3)} * bend;
      transformed.z += cos(uTime * 1.2 + ip.x * 0.4) * ${(amount / 2).toFixed(3)} * bend;`,
    );
  };
  mat.customProgramCacheKey = () => `sway${amount}`;
  return mat;
}

/** ขอบแผ่นดินนุ่ม (แปลงข้างเคียงกลืนกัน ไม่เห็นเป็นตาราง) */
function softEdgeTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const img = g.createImageData(64, 64);
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const dx = Math.abs(x / 63 - 0.5) * 2;
      const dy = Math.abs(y / 63 - 0.5) * 2;
      const d = Math.max(dx, dy);
      const a = Math.max(0, Math.min(1, (1 - d) / 0.5));
      img.data.set([255, 255, 255, Math.round(a * a * (3 - 2 * a) * 255)], (y * 64 + x) * 4);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export class GrassField {
  constructor(scene) {
    this.group = new THREE.Group();
    this.time = { value: 0 };
    this.shown = null;

    // ── ดินใต้แปลง ──
    const soilGeo = new THREE.PlaneGeometry(PATCH_W * 1.45, PATCH_D * 1.45);
    soilGeo.rotateX(-Math.PI / 2);
    const soilMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true, alphaMap: softEdgeTexture(), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    this.soil = new THREE.InstancedMesh(soilGeo, soilMat, GRASS_PATCHES);
    this.soil.receiveShadow = true;
    this.soil.renderOrder = -1;
    const m = new THREE.Matrix4();
    for (let i = 0; i < GRASS_PATCHES; i++) {
      const c = patchCenter(i);
      this.soil.setMatrixAt(i, m.makeTranslation(c.x, 0.012, c.z));
      this.soil.setColorAt(i, COLORS.turf);
    }
    this.group.add(this.soil);

    // ── กอหญ้า ──
    this.tufts = new THREE.InstancedMesh(tuftGeometry(), swayMaterial(this.time), GRASS_PATCHES * TUFTS_PER_PATCH);
    this.tufts.frustumCulled = false; // ทั้งคอกอยู่ใน mesh เดียว
    this.tufts.castShadow = false;
    this.tufts.receiveShadow = true;
    /** ต่อกอ: ตำแหน่ง มุม ขนาด และลำดับที่หาย (rank 0..1 — หญ้าเหลือ g% = กอที่ rank < g/100 ยังอยู่) */
    this.slots = [];
    const rnd = seededRandom(0.1337);
    for (let i = 0; i < GRASS_PATCHES; i++) {
      const c = patchCenter(i);
      for (let k = 0; k < TUFTS_PER_PATCH; k++) {
        const x = c.x + (rnd() - 0.5) * PATCH_W;
        const z = c.z + (rnd() - 0.5) * PATCH_D;
        const underTrough = Math.abs(x - TROUGH.x) < TROUGH.width / 2 + 0.1 && Math.abs(z - TROUGH.z) < TROUGH.depth / 2 + 0.1;
        this.slots.push({ patch: i, x, z, rot: rnd() * Math.PI * 2, size: 0.75 + rnd() * 0.5, rank: underTrough ? 2 : rnd() });
      }
    }
    this.group.add(this.tufts);

    // ── หยดน้ำตอนรดน้ำ ──
    const DROPS = 90;
    const dropGeo = new THREE.BufferGeometry();
    dropGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(DROPS * 3), 3));
    this.drops = new THREE.Points(dropGeo, new THREE.PointsMaterial({ color: '#8fd3ff', size: 0.09, transparent: true, opacity: 0.85, depthWrite: false }));
    this.drops.visible = false;
    this.drops.frustumCulled = false;
    this.dropState = Array.from({ length: DROPS }, () => ({ x: 0, y: 0, z: 0, v: 0, delay: 0 }));
    this.splashTime = 0;
    this.group.add(this.drops);

    scene.add(this.group);
    this.show({ g: Array(GRASS_PATCHES).fill(100), w: Array(GRASS_PATCHES).fill(40) });
  }

  /** แสดงสถานะหญ้า { g: [24], w: [24] } — อัปเดตเฉพาะแปลงที่เปลี่ยนเห็นได้ */
  show(grass) {
    if (!grass) return;
    const prev = this.shown;
    const changed = [];
    for (let i = 0; i < GRASS_PATCHES; i++) {
      if (!prev || Math.abs(prev.g[i] - grass.g[i]) > 0.4 || Math.abs(prev.w[i] - grass.w[i]) > 1) changed.push(i);
    }
    if (!changed.length) return;
    this.shown = { g: [...grass.g], w: [...grass.w] };
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const c = new THREE.Color();
    const tint = new THREE.Color();
    const set = new Set(changed);
    for (const i of changed) {
      const g = grass.g[i] / 100;
      const w = grass.w[i] / 100;
      // ดิน: ความชื้นทำให้ดินเข้ม · หญ้าเยอะ = พื้นเขียว
      c.copy(COLORS.dirt).lerp(COLORS.wetDirt, Math.min(1, w * 1.3)).lerp(COLORS.turf, Math.pow(g, 0.7) * 0.85);
      this.soil.setColorAt(i, c);
    }
    this.soil.instanceColor.needsUpdate = true;
    for (let k = 0; k < this.slots.length; k++) {
      const t = this.slots[k];
      if (!set.has(t.patch)) continue;
      const g = grass.g[t.patch] / 100;
      const w = grass.w[t.patch] / 100;
      const keep = t.rank < g;
      const h = keep ? (0.12 + 0.3 * Math.min(1, g * 1.4)) * t.size : 0;
      q.setFromAxisAngle(up, t.rot);
      s.set(keep ? t.size * 1.1 : 0, h, keep ? t.size * 1.1 : 0);
      p.set(t.x, 0, t.z);
      this.tufts.setMatrixAt(k, m.compose(p, q, s));
      // ดินแห้งนาน หญ้าซีดลง
      tint.copy(COLORS.dry).lerp(COLORS.lush, Math.min(1, 0.45 + w * 1.5));
      this.tufts.setColorAt(k, tint);
    }
    this.tufts.instanceMatrix.needsUpdate = true;
    if (this.tufts.instanceColor) this.tufts.instanceColor.needsUpdate = true;
  }

  /** หยดน้ำตกลงบนแปลง i */
  splash(i) {
    const c = patchCenter(i);
    const pos = this.drops.geometry.attributes.position;
    for (const d of this.dropState) {
      d.x = c.x + (Math.random() - 0.5) * PATCH_W * 0.8;
      d.z = c.z + (Math.random() - 0.5) * PATCH_D * 0.8;
      d.y = 1.6 + Math.random() * 0.8;
      d.v = 0;
      d.delay = Math.random() * 0.5;
    }
    pos.needsUpdate = true;
    this.splashTime = 1.6;
    this.drops.visible = true;
  }

  update(dt, time) {
    this.time.value = time;
    if (this.splashTime <= 0) return;
    this.splashTime -= dt;
    const pos = this.drops.geometry.attributes.position;
    this.dropState.forEach((d, k) => {
      if (d.delay > 0) d.delay -= dt;
      else if (d.y > 0) {
        d.v += 9.8 * dt;
        d.y = Math.max(0, d.y - d.v * dt);
      }
      pos.setXYZ(k, d.x, d.delay > 0 || d.y <= 0 ? -10 : d.y, d.z);
    });
    pos.needsUpdate = true;
    this.drops.material.opacity = Math.min(0.85, this.splashTime);
    if (this.splashTime <= 0) this.drops.visible = false;
  }
}
