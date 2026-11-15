import * as THREE from 'three';
import { fbm2 } from '../utils/noise.js';
import { seededRandom } from '../utils/math.js';
import { PASTURE, TROUGH } from './Farm.js';
import { swayMaterial, tuftGeometry } from './Grass.js';

/**
 * ของตกแต่งรอบบ้าน/โรงนา (ฉากฟาร์ม)
 *  - ทันที (ไม่ต้องรอไฟล์): ทางเดินดินโค้ง · บ่อน้ำ + ต้นกก + ใบบัว · หญ้ากอเล็ก ๆ ทั่วลาน
 *  - เมื่อโหลด decor.glb (Fish/farm/build_decor.py): ฟางม้วน รางน้ำ ถังไม้ ลัง ถังนม รถเข็น กองฟืน ม้านั่ง ตู้จดหมาย เสาไฟ
 *    กังหันลม (ใบพัดหมุน) พุ่มไม้ ดอกไม้ รั้วไม้ขาวสวนหน้าบ้าน หิน แปลงผัก — ของซ้ำกันวางด้วย InstancedMesh (ชนิดละ 1 draw call)
 *
 * พิกัดเป็นเมตรของฉากฟาร์ม (world/Farm.js): กลางคอก = (0, 0) · บ้านซ้าย (ระเบียงหัน +X) · โรงนาหลังคอก (ประตูหัน +Z)
 * rot = มุมหมุนรอบแกนตั้ง (เรเดียน) — โมเดลในไฟล์หันหน้า +Z · rot π/2 → หันหน้า +X
 */

/** ทางเดินดิน: บ้าน → ประตูคอก · แยกอ้อมคอกด้านตะวันตกไปมุมโรงนา · ช่องรั้วหลัง → ประตูโรงนา */
export const PATHS = [
  [[-16.6, 10.5], [-13.5, 10.6], [-9, 10.3], [-4.5, 9.7], [-1.2, 9.1], [0, 8.4]],
  [[-9, 10.3], [-12.2, 8.4], [-13.4, 5], [-13.5, -2], [-13.1, -7.4], [-11, -9.9], [-8.2, -10.6], [-6.4, -10.4]],  [[0, -8.3], [0, -9.9]], // ช่องรั้วหลังคอก → ประตูโรงนา (ทางวัวเข้าโรงนา)
];
export const PATH_WIDTH = 1.5;
/** บ่อน้ำข้างคอก (ซ้ายมือ ระหว่างบ้านกับโรงนา) */
export const POND = { x: -18.6, z: -2.8, r: 3.2 };

const HOUSE_BOX = { minX: -28.4, maxX: -16.2, minZ: 4.4, maxZ: 16.0 };
const BARN_BOX = { minX: -6, maxX: 6, minZ: -22.8, maxZ: -8.4 };
export const YARD = { minX: -16.3, maxX: -12.6, minZ: 5.0, maxZ: 16.0, gate: [9.6, 11.4] };
const GARDEN = [[-21.2, 3.2], [-24.6, 3.2]];

const HALF_PI = Math.PI / 2;

/** ตำแหน่งของตกแต่งแต่ละชนิด { x, z, rot?, y?, s? (ขนาด หรือ [sx, sy, sz]) } */
function placements() {
  const P = {
    HayBale: [
      { x: 7.2, z: -11.6 }, { x: 8.7, z: -11.6 }, { x: 7.95, z: -11.6, y: 1.3 },
      { x: -7.5, z: -11.4, rot: 0.3 }, { x: 8.4, z: -13.5, rot: 1.25 },
    ],
    Trough: [{ x: TROUGH.x, z: TROUGH.z }],
    TroughWater: [{ x: TROUGH.x, z: TROUGH.z }],
    Barrel: [{ x: 6.8, z: -14.6, rot: 0.3 }, { x: 7.5, z: -15.2, rot: 1.1 }, { x: 6.9, z: -15.7, rot: 2 }],
    Crate: [{ x: 6.6, z: -16.8, rot: 0.2 }, { x: 7.3, z: -17.0, rot: 0.8 }, { x: 6.9, z: -16.9, y: 0.6, rot: 0.5 }],
    MilkCan: [{ x: -6.5, z: -11.2 }, { x: -6.95, z: -11.55, rot: 0.7 }, { x: -6.4, z: -11.8, rot: 1.4 }],
    Wheelbarrow: [{ x: -7.8, z: -13.4, rot: 2.2 }],
    Woodpile: [{ x: -6.15, z: -17.6, rot: -HALF_PI }, { x: -6.15, z: -19.6, rot: -HALF_PI }],
    Windmill: [{ x: -11.5, z: -16.5, rot: 0.35 }],
    // เสาไฟเฉพาะทางเดินหลัก (ฝั่งนอกทาง ไม่ยืนบังหน้าคอก)
    LampPost: [{ x: -14.2, z: 12.1, rot: Math.PI }, { x: -6.8, z: 11.5, rot: Math.PI }],
    Mailbox: [{ x: -11.9, z: 12.0, rot: Math.PI }],
    Bench: [{ x: -18.6, z: 1.6, rot: Math.PI }],
    GardenBed: GARDEN.map(([x, z]) => ({ x, z })),
    GardenVeg: GARDEN.map(([x, z]) => ({ x, z })),
    // พุ่มไม้ชิดอาคารเท่านั้น (ทุ่งโล่ง)
    BushA: [{ x: -28.3, z: 5.3 }, { x: -28.3, z: 15.4, s: 1.2 }, { x: -6.8, z: -21.5, s: 1.3 }, { x: 6.9, z: -21.0, s: 1.1 }],
    BushB: [{ x: -15.7, z: 5.6 }, { x: -15.7, z: 15.4 }],
    RockA: [],
    RockB: [],
    Picket: [],
  };
  // รั้วไม้ขาวล้อมสวนหน้าบ้าน (เว้นประตูตรงทางเดิน) — ช่วงละ 2 ม. ยืด/หดให้พอดีด้าน
  const run = (x0, z0, x1, z1, n) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const rot = -Math.atan2(z1 - z0, x1 - x0);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      P.Picket.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, rot, s: [len / n / 2, 1, 1] });
    }
  };
  run(YARD.maxX, YARD.minZ, YARD.maxX, YARD.gate[0], 2);
  run(YARD.maxX, YARD.gate[1], YARD.maxX, YARD.maxZ, 2);
  run(YARD.minX, YARD.minZ, YARD.maxX, YARD.minZ, 2);
  run(YARD.minX, YARD.maxZ, YARD.maxX, YARD.maxZ, 2);
  // หินรอบบ่อ
  const rnd = seededRandom(0.512);
  for (let i = 0; i < 11; i++) {
    const a = (i / 11) * Math.PI * 2 + rnd() * 0.3;
    if (Math.sin(a) > 0.75) continue; // เว้นฝั่งม้านั่งให้มองเห็นน้ำ
    const r = POND.r * pondEdge(a) + 0.15;
    (rnd() < 0.4 ? P.RockA : P.RockB).push({ x: POND.x + Math.cos(a) * r, z: POND.z + Math.sin(a) * r, rot: rnd() * 6, s: 0.5 + rnd() * 0.5 });
  }
  return P;
}

/** รูปทรงขอบบ่อไม่กลมเป๊ะ (คูณรัศมีตามมุม) */
function pondEdge(a) {
  return 1 + 0.16 * Math.sin(a * 2 + 0.7) + 0.08 * Math.sin(a * 3 + 2.1) + 0.05 * Math.sin(a * 5);
}

/** จุดตามทางเดินทุก ~0.5 ม. (ใช้หาว่าใกล้ทางเดินไหม) */
function pathSamples() {
  const out = [];
  for (const pts of PATHS) {
    const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
    const n = Math.ceil(curve.getLength() / 0.5);
    for (let i = 0; i <= n; i++) out.push(curve.getPointAt(i / n));
  }
  return out;
}

const inBox = (b, x, z, m = 0) => x > b.minX - m && x < b.maxX + m && z > b.minZ - m && z < b.maxZ + m;

/** ขอบนุ่มของทางเดิน (alpha ตามแนวขวาง: ขอบโปร่ง → กลางทึบ) */
function edgeAlpha() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 4;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, '#000');
  grad.addColorStop(0.22, '#fff');
  grad.addColorStop(0.78, '#fff');
  grad.addColorStop(1, '#000');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 4);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  t.channel = 1;
  return t;
}

export class FarmDecor {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.time = { value: 0 };
    this.rotor = null;
    this.places = placements();
    this.samples = pathSamples();
    this.#paths();
    this.#pond();
    this.#meadow();
    scene.add(this.group);
  }

  /** ระยะแนวนอนถึงทางเดินที่ใกล้สุด */
  pathDistance(x, z) {
    let best = Infinity;
    for (const p of this.samples) best = Math.min(best, (p.x - x) ** 2 + (p.z - z) ** 2);
    return Math.sqrt(best);
  }

  /** ห้ามขึ้นหญ้า/ดอกไม้ตรงนี้ (คอก บ้าน โรงนา ทางเดิน บ่อ แปลงผัก) */
  #blocked(x, z, pathGap = 0.95) {
    if (inBox(PASTURE, x, z, 0.25)) return true;
    if (inBox(HOUSE_BOX, x, z) || inBox(BARN_BOX, x, z)) return true;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r * 1.3) return true;
    if (GARDEN.some(([gx, gz]) => Math.abs(x - gx) < 1.4 && Math.abs(z - gz) < 0.7)) return true;
    return this.pathDistance(x, z) < pathGap;
  }

  // ── ทางเดินดินโค้ง (แถบ mesh ขอบนุ่ม วางเหนือพื้นนิดเดียว) ──
  #paths() {
    const geos = [];
    for (const pts of PATHS) {
      const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)));
      const len = curve.getLength();
      const n = Math.ceil(len / 0.35);
      const pos = [];
      const uv = [];
      const uv1 = [];
      const idx = [];
      const cols = 4;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = curve.getPointAt(t);
        const tan = curve.getTangentAt(t);
        const side = new THREE.Vector3(-tan.z, 0, tan.x).normalize();
        const w = (PATH_WIDTH / 2) * (1 + 0.18 * fbm2(p.x * 0.35 + 3, p.z * 0.35, 2) - 0.09);
        for (let k = 0; k <= cols; k++) {
          const f = k / cols;
          const q = p.clone().addScaledVector(side, (f - 0.5) * 2 * w);
          pos.push(q.x, 0.025, q.z);
          uv.push(q.x / 2, q.z / 2); // ลายดินต่อเนื่องตามพื้นจริง (2 ม. ต่อรอบ)
          uv1.push(f, t);
        }
        if (i < n) {
          for (let k = 0; k < cols; k++) {
            const a = i * (cols + 1) + k;
            const b = a + cols + 1;
            idx.push(a, a + 1, b, a + 1, b + 1, b); // หน้าผิวหันขึ้นฟ้า
          }
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('uv1', new THREE.Float32BufferAttribute(uv1, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      geos.push(g);
    }
    this.pathMat = new THREE.MeshStandardMaterial({
      color: '#a78b62',
      roughness: 0.95,
      transparent: true,
      alphaMap: edgeAlpha(),
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
    });
    for (const g of geos) {
      const m = new THREE.Mesh(g, this.pathMat);
      m.receiveShadow = true;
      m.renderOrder = -1;
      this.group.add(m);
    }
  }

  // ── บ่อน้ำ: ตลิ่งดินชื้น + ผิวน้ำสะท้อนฟ้า + ต้นกกรอบขอบ + ใบบัว ──
  #pond() {
    const shape = (scale) => {
      const s = new THREE.Shape();
      for (let i = 0; i <= 48; i++) {
        const a = (i / 48) * Math.PI * 2;
        const r = POND.r * pondEdge(a) * scale;
        const x = Math.cos(a) * r;
        const y = -Math.sin(a) * r; // ShapeGeometry วางบน XY → หมุนลงพื้นแล้ว y → −z
        i ? s.lineTo(x, y) : s.moveTo(x, y);
      }
      return s;
    };
    const flat = (geo, y) => {
      geo.rotateX(-Math.PI / 2);
      geo.translate(POND.x, y, POND.z);
      return geo;
    };
    const bank = new THREE.Mesh(flat(new THREE.ShapeGeometry(shape(1.22), 48), 0.015), new THREE.MeshStandardMaterial({ color: '#6d5a3a', roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 }));
    bank.receiveShadow = true;
    // environment ของฉากเป็นภาพห้องในบ้าน (โทนน้ำตาล) — ผิวน้ำไม่สะท้อน env แต่ไล่สีฟ้าเองตามมุมมอง (ขอบสะท้อนฟ้า กลางเห็นน้ำลึก) + แสงแดดเป็นประกาย
    // polygonOffset มากกว่าตลิ่ง: มองจากไกล offset ของตลิ่งโตเกินระยะห่าง 2.5 ซม. จนบังน้ำ
    const waterMat = new THREE.MeshStandardMaterial({ color: '#2f6f86', roughness: 0.12, metalness: 0, envMapIntensity: 0, transparent: true, opacity: 0.94, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6 });
    waterMat.onBeforeCompile = (sh) => {
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <opaque_fragment>',
        `float fres = pow(1.0 - clamp(dot(normalize(vViewPosition), vec3(0.0, 0.0, 1.0)), 0.0, 1.0), 3.0);
        outgoingLight = mix(outgoingLight, vec3(0.62, 0.82, 0.95), clamp(fres * 0.9 + 0.12, 0.0, 0.85));
        #include <opaque_fragment>`,
      );
    };
    const water = new THREE.Mesh(flat(new THREE.ShapeGeometry(shape(1.0), 48), 0.04), waterMat);
    water.receiveShadow = true;
    this.water = water;
    this.group.add(bank, water);

    const rnd = seededRandom(0.919);
    // ต้นกก: กอหญ้าแบบเดียวกับในคอก ยืดสูงผอม สีเขียวเข้ม
    const reeds = [];
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      if (Math.sin(a) > 0.7) continue; // ฝั่งม้านั่งโล่ง
      const r = POND.r * pondEdge(a) * (0.92 + rnd() * 0.22);
      reeds.push([POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r, 0.8 + rnd() * 0.7]);
    }
    const reedMesh = new THREE.InstancedMesh(tuftGeometry(), swayMaterial(this.time, null, 0.08), reeds.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const tint = new THREE.Color();
    reeds.forEach(([x, z, h], i) => {
      m.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * 6), new THREE.Vector3(0.55, h, 0.55));
      reedMesh.setMatrixAt(i, m);
      reedMesh.setColorAt(i, tint.setRGB(0.55 + rnd() * 0.15, 0.75 + rnd() * 0.1, 0.45));
    });
    reedMesh.receiveShadow = true;
    this.group.add(reedMesh);
    // ใบบัว: แผ่นกลมเว้าเป็นปาก ลอยผิวน้ำ
    const pad = new THREE.CircleGeometry(0.28, 14, 0.35, Math.PI * 2 - 0.35);
    pad.rotateX(-Math.PI / 2);
    const pads = new THREE.InstancedMesh(pad, new THREE.MeshStandardMaterial({ color: '#4f8a3a', roughness: 0.55, side: THREE.DoubleSide }), 9);
    for (let i = 0; i < 9; i++) {
      const a = rnd() * Math.PI * 2;
      const r = POND.r * (0.25 + rnd() * 0.55);
      const s = 0.7 + rnd() * 0.6;
      m.compose(new THREE.Vector3(POND.x + Math.cos(a) * r, 0.05, POND.z + Math.sin(a) * r), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * 6), new THREE.Vector3(s, 1, s));
      pads.setMatrixAt(i, m);
    }
    this.group.add(pads);
  }

  /**
   * ระยะถึง "ขอบ" ที่หญ้าขึ้นรก: แนวรั้วคอก ฐานบ้าน/โรงนา ขอบบ่อ (ทางเดินคิดแยก)
   * ทุ่งที่ห่างขอบเหล่านี้ปล่อยโล่ง — ดูสะอาดตา ไม่เป็นจุด ๆ เต็มจอ
   */
  #edgeDistance(x, z) {
    const box = (b) => {
      const dx = Math.max(b.minX - x, 0, x - b.maxX);
      const dz = Math.max(b.minZ - z, 0, z - b.maxZ);
      return Math.hypot(dx, dz);
    };
    const fence = Math.min(Math.abs(Math.max(Math.abs(x) - PASTURE.maxX, Math.abs(z) - PASTURE.maxZ)), 99);
    return Math.min(fence, box(HOUSE_BOX), box(BARN_BOX), Math.abs(Math.hypot(x - POND.x, z - POND.z) - POND.r * 1.3));
  }

  // ── หญ้ากอเล็ก ๆ ขึ้นตามขอบ (รั้วคอก ขอบทาง ฐานอาคาร รอบบ่อ) — กลางทุ่งโล่ง ──
  #meadow() {
    const rnd = seededRandom(0.2718);
    const spots = [];
    for (let tries = 0; spots.length < 850 && tries < 40000; tries++) {
      const x = (rnd() - 0.5) * 64;
      const z = (rnd() - 0.5) * 56 - 2;
      if (this.#blocked(x, z)) continue;
      const edge = Math.min(this.#edgeDistance(x, z), Math.abs(this.pathDistance(x, z) - 1.1));
      if (rnd() > Math.exp(-edge / 0.45)) continue; // ห่างขอบเกิน ~1 ม. แทบไม่มี
      spots.push([x, z]);
    }
    const mesh = new THREE.InstancedMesh(tuftGeometry(), swayMaterial(this.time), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    spots.forEach(([x, z], i) => {
      const dry = Math.max(0, fbm2(x * 0.08 + 7, z * 0.08, 2));
      const h = 0.22 + rnd() * 0.22;
      const w = 0.9 + rnd() * 0.6;
      m.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * 6), new THREE.Vector3(w, h, w));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setRGB(0.85 + dry * 0.3, 0.95, 0.65 + rnd() * 0.15));
    });
    mesh.frustumCulled = false;
    mesh.receiveShadow = true;
    this.group.add(mesh);
  }

  /** วางของจากไฟล์ decor.glb */
  useModel(gltf) {
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    // วัสดุทางเดินจริง (ลายดิน + กรวด) จากแผ่นตัวอย่างในไฟล์
    const tile = root.getObjectByName('PathTile');
    tile?.traverse((o) => {
      if (!o.isMesh) return;
      this.pathMat.map = o.material.map;
      this.pathMat.normalMap = o.material.normalMap;
      this.pathMat.color.set('#ffffff');
      for (const t of [this.pathMat.map, this.pathMat.normalMap]) if (t) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      this.pathMat.needsUpdate = true;
    });
    for (const [name, list] of Object.entries(this.places)) {
      const g = this.#instanced(root, name, list, { sway: /Bush|Flower|Veg/.test(name) });
      if (g) this.group.add(g);
    }
    this.#flowers(root);
    // ใบพัดกังหัน: ชิ้นเดียว หมุนรอบแกนหน้า-หลังของมันเอง
    const rotorSrc = root.getObjectByName('WindmillRotor');
    const mill = this.places.Windmill[0];
    if (rotorSrc && mill) {
      const pivot = new THREE.Group();
      pivot.position.set(mill.x, 0, mill.z);
      pivot.rotation.y = mill.rot ?? 0;
      const rotor = rotorSrc.clone();
      rotor.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = false)));
      pivot.add(rotor);
      this.rotor = rotor;
      this.group.add(pivot);
    }
  }

  /** ดอกไม้: แปลงในสวนหน้าบ้าน + ดอกไม้ป่าเป็นหย่อม ๆ ในทุ่ง + แนวหน้ารั้วคอก */
  #flowers(root) {
    const rnd = seededRandom(0.1618);
    const list = [];
    const add = (x, z, s = 1) => list.push({ x, z, rot: rnd() * 6, s: s * 1.5 * (0.8 + rnd() * 0.5) });
    // สวนหน้าบ้าน: ชิดรั้วด้านใน
    for (let z = YARD.minZ + 0.5; z < YARD.maxZ - 0.4; z += 0.42) {
      if (z > YARD.gate[0] - 0.4 && z < YARD.gate[1] + 0.4) continue;
      add(YARD.maxX - 0.45, z, 1.1);
      if (rnd() < 0.6) add(YARD.maxX - 0.9, z + 0.2, 0.9);
    }
    for (let x = YARD.minX + 0.6; x < YARD.maxX - 0.6; x += 0.42) {
      add(x, YARD.minZ + 0.45, 1.1);
      add(x, YARD.maxZ - 0.45, 1.1);
    }
    // ริมบ่อฝั่งตรงข้ามม้านั่ง (หย่อมเดียว ไม่โรยทั่วทุ่ง)
    for (let j = 0; j < 7; j++) {
      const a = -Math.PI / 2 + (rnd() - 0.5) * 1.4;
      const r = POND.r * pondEdge(a) * 1.32 + rnd() * 0.4;
      add(POND.x + Math.cos(a) * r, POND.z + Math.sin(a) * r, 0.9);
    }
    const g = this.#instanced(root, 'FlowerClump', list, { sway: true, shadow: false });
    if (g) this.group.add(g);
  }

  /** ชิ้นงานชื่อ name ในไฟล์ → InstancedMesh ต่อชิ้นส่วน (คงตำแหน่ง/หมุนภายในไฟล์ไว้) */
  #instanced(root, name, list, { sway = false, shadow = true } = {}) {
    const node = root.getObjectByName(name);
    if (!node || !list.length) return null;
    const group = new THREE.Group();
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    node.traverse((part) => {
      if (!part.isMesh) return;
      const mat = sway ? swayMaterial(this.time, part.material.clone(), 0.05) : part.material;
      const inst = new THREE.InstancedMesh(part.geometry, mat, list.length);
      list.forEach((p, i) => {
        const sc = p.s ?? 1;
        Array.isArray(sc) ? s.set(...sc) : s.setScalar(sc);
        m.compose(new THREE.Vector3(p.x, p.y ?? 0, p.z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.rot ?? 0), s).multiply(part.matrixWorld);
        inst.setMatrixAt(i, m);
      });
      inst.castShadow = shadow && !/Water/i.test(name);
      inst.receiveShadow = true;
      group.add(inst);
    });
    return group;
  }

  update(dt, time) {
    this.time.value = time;
    if (this.rotor) this.rotor.rotation.z -= dt * 1.4;
  }
}
