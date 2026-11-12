import * as THREE from 'three';
import { fbm2 } from '../utils/noise.js';
import { seededRandom, smoothstep } from '../utils/math.js';

/** โมเดลจริงจาก Blender (Fish/farm/ → scripts/build-farm-models.mjs) — ไม่มีไฟล์ = ใช้โมเดลชั่วคราวจากรูปทรงพื้นฐาน */
export const FARM_MODELS = {
  house: 'models/farm/house.glb',
  barn: 'models/farm/barn.glb',
  fence: 'models/farm/fence.glb',
  treeA: 'models/farm/tree_a.glb',
  treeB: 'models/farm/tree_b.glb',
};
/** บ้าน: หันหน้า (ระเบียง/ประตู) ไปทางคอก · ประตูอยู่บนแนวทางเดินดิน z = 10.5 */
const HOUSE_AT = { x: -23.2, z: 10.5, rotY: Math.PI / 2 };
const BARN_AT = { x: 0, z: -16 };

/**
 * ฉากนอกบ้าน: ทุ่งหญ้าหลังบ้าน — คอกวัวล้อมรั้ว, โรงนา, รางอาหาร, กองฟาง, ประตูบ้าน (แตะเพื่อกลับเข้าบ้าน), ต้นไม้ เนินเขา เมฆ
 *
 * เป็น THREE.Scene แยกจากห้อง (SceneManager.registerScene) มีแสงและหมอกของตัวเอง — สร้างครั้งแรกตอนออกนอกบ้าน
 * เริ่มด้วยโมเดลชั่วคราวจากรูปทรงพื้นฐาน แล้ว useModels() สลับเป็นโมเดลจริงเมื่อโหลดไฟล์เสร็จ (บ้าน โรงนา รั้ว ต้นไม้)
 * ของที่ซ้ำกันเยอะ (รั้ว ต้นไม้) ใช้ InstancedMesh — รั้วทั้งคอก/ป่าทั้งแนว = ไม่กี่ draw call
 *
 * หน่วย: 1 หน่วย = 1 เมตร (ต่างจากห้องในบ้านที่ 1 หน่วย ≈ 5 ซม. — คนละฉากจึงไม่ปนกัน)
 * จุดกำเนิด = กลางคอกวัว พื้น y = 0 · กล้องมองจากด้านหน้า (+Z) เข้าไปทางโรงนา (−Z)
 */

/** ขอบรั้วคอกวัว */
export const PASTURE = { minX: -11, maxX: 11, minZ: -8, maxZ: 8 };
/** พื้นที่ที่วัวเดินได้ (เว้นจากรั้ว) */
export const COW_AREA = { minX: PASTURE.minX + 1.5, maxX: PASTURE.maxX - 1.5, minZ: PASTURE.minZ + 1.5, maxZ: PASTURE.maxZ - 1.5 };

const COLORS = {
  sky: '#a9d8f5',
  fog: '#cfe7f3',
  grass: '#6f9e45',
  grassDry: '#9cab55',
  path: '#a78b62',
  fence: '#8a6a48',
  barn: '#a3402e',
  barnTrim: '#f1ece2',
  roof: '#4d4a48',
  houseWall: '#eadfc8',
  houseRoof: '#7a3f2c',
  door: '#5b3a24',
  wood: '#86603d',
  water: '#5aa7d6',
  hay: '#d8b860',
  trunk: '#5e4430',
  leaves: '#3f7a35',
  hill: '#7fa85a',
  cloud: '#ffffff',
};

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, metalness: 0, ...extra });

export class Farm {
  /** @param {import('./SceneManager.js').SceneManager} sceneMgr */
  constructor(sceneMgr) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.sky);
    scene.fog = new THREE.Fog(COLORS.fog, 70, 170);
    scene.environment = sceneMgr.envMap;
    scene.environmentIntensity = 0.3;
    this.scene = scene;
    this.rnd = seededRandom(0.4242);
    /** กลุ่มของโมเดลชั่วคราวแต่ละอย่าง (ลบทิ้งเมื่อได้โมเดลจริง) */
    this.placeholders = {};

    this.#lights();
    sceneMgr.registerScene(scene, { shadowLight: this.sun });

    this.#ground();
    this.#fence();
    this.#barn();
    this.#house();
    this.#props();
    this.#trees();
    this.#hills();
    this.#clouds();

    /** กลุ่มของวัว (FarmSystem เพิ่ม/ลบวัวที่นี่) */
    this.animals = new THREE.Group();
    scene.add(this.animals);

    /** มุมกล้องหลักของฟาร์ม (SceneManager.frameArea) */
    this.view = {
      position: new THREE.Vector3(0, 11, 25),
      target: new THREE.Vector3(0, 1, -1.5),
      bounds: { w: 52, h: 14, d: 46 },
      minDistance: 6,
      maxDistance: 60,
      maxPolar: 1.38,
    };
  }

  #lights() {
    const hemi = new THREE.HemisphereLight('#cfe9ff', '#5d7d36', 1.15);
    const sun = new THREE.DirectionalLight('#fff0d4', 2.6);
    sun.position.set(18, 30, 14);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    const cam = sun.shadow.camera;
    cam.left = -26;
    cam.right = 26;
    cam.top = 26;
    cam.bottom = -26;
    cam.near = 1;
    cam.far = 90;
    this.sun = sun;
    this.scene.add(hemi, sun, sun.target);
  }

  #ground() {
    const size = 260;
    const geo = new THREE.PlaneGeometry(size, size, 90, 90);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const grass = new THREE.Color(COLORS.grass);
    const dry = new THREE.Color(COLORS.grassDry);
    const path = new THREE.Color(COLORS.path);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      // พื้นราบในบริเวณฟาร์ม แล้วค่อย ๆ เป็นเนินออกไปไกล ๆ
      const far = smoothstep(30, 70, Math.hypot(x, z));
      pos.setY(i, fbm2(x * 0.025, z * 0.025, 3) * 6 * far);
      c.copy(grass).lerp(dry, smoothstep(-0.2, 0.5, fbm2(x * 0.08 + 7, z * 0.08, 2)));
      // ทางเดินดินจากประตูบ้านไปหน้าคอก
      const onPath = Math.abs(z - 10.5) < 1.1 && x > -16 && x < 2;
      if (onPath) c.lerp(path, 0.85);
      c.toArray(colors, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    const ground = new THREE.Mesh(geo, std('#ffffff', { vertexColors: true }));
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  #group(key) {
    const g = new THREE.Group();
    this.placeholders[key] = g;
    this.scene.add(g);
    return g;
  }

  /** ช่วงรั้วยาว 2 ม. รอบคอก: { a, b } = จุดเสาต้นและปลาย เรียงให้ด้านนอกคอกอยู่ทางขวามือ · เว้นช่องประตูด้านหน้า */
  static fenceSegments() {
    const { minX, maxX, minZ, maxZ } = PASTURE;
    const segs = [];
    const line = (ax, az, bx, bz) => {
      const n = Math.round(Math.hypot(bx - ax, bz - az) / 2);
      for (let i = 0; i < n; i++) {
        const t0 = i / n;
        const t1 = (i + 1) / n;
        const a = [ax + (bx - ax) * t0, az + (bz - az) * t0];
        const b = [ax + (bx - ax) * t1, az + (bz - az) * t1];
        if (az === maxZ && bz === maxZ && Math.abs((a[0] + b[0]) / 2) < 1.6) continue; // ช่องประตูคอก
        segs.push({ a, b });
      }
    };
    line(minX, minZ, maxX, minZ); // หลัง
    line(maxX, minZ, maxX, maxZ); // ขวา
    line(maxX, maxZ, minX, maxZ); // หน้า
    line(minX, maxZ, minX, minZ); // ซ้าย
    return segs;
  }

  #fence() {
    const g = this.#group('fence');
    const { minX, maxX, minZ, maxZ } = PASTURE;
    const posts = [];
    const gate = (x, z) => z === maxZ && Math.abs(x) < 1.6; // ช่องประตูคอกด้านหน้า
    for (let x = minX; x <= maxX + 0.01; x += 2) {
      for (const z of [minZ, maxZ]) if (!gate(x, z)) posts.push([x, z]);
    }
    for (let z = minZ + 2; z < maxZ - 0.01; z += 2) {
      for (const x of [minX, maxX]) posts.push([x, z]);
    }
    const mat = std(COLORS.fence);
    const postGeo = new THREE.BoxGeometry(0.16, 1.3, 0.16);
    postGeo.translate(0, 0.65, 0);
    const inst = new THREE.InstancedMesh(postGeo, mat, posts.length);
    const m = new THREE.Matrix4();
    posts.forEach(([x, z], i) => inst.setMatrixAt(i, m.makeTranslation(x, 0, z)));
    inst.castShadow = true;
    g.add(inst);

    // ราวรั้ว 2 ชั้น · ด้านหน้าแบ่งเป็น 2 ท่อนเว้นช่องประตู
    const w = maxX - minX;
    const d = maxZ - minZ;
    const rails = [
      [0, minZ, w, 0],
      [minX, 0, d, Math.PI / 2],
      [maxX, 0, d, Math.PI / 2],
      [(minX - 1.6) / 2, maxZ, -1.6 - minX, 0],
      [(maxX + 1.6) / 2, maxZ, maxX - 1.6, 0],
    ];
    for (const [x, z, len, rot] of rails) {
      for (const y of [0.55, 1.05]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.06), mat);
        rail.position.set(x, y, z);
        rail.rotation.y = rot;
        rail.castShadow = true;
        g.add(rail);
      }
    }
  }

  #barn() {
    const barn = new THREE.Group();
    barn.position.set(0, 0, -15);
    const W = 10;
    const H = 4.6;
    const D = 7;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), std(COLORS.barn));
    body.position.y = H / 2;
    barn.add(body);
    // หลังคาจั่ว (ปริซึมสามเหลี่ยม)
    const shape = new THREE.Shape([new THREE.Vector2(-W / 2 - 0.4, 0), new THREE.Vector2(W / 2 + 0.4, 0), new THREE.Vector2(0, 3.2)]);
    const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: D + 0.8, bevelEnabled: false });
    roofGeo.translate(0, H, -(D + 0.8) / 2);
    barn.add(new THREE.Mesh(roofGeo, std(COLORS.roof)));
    // ประตูบานใหญ่ + กากบาทสีขาว
    const trim = std(COLORS.barnTrim);
    const door = new THREE.Mesh(new THREE.BoxGeometry(3.6, 3.4, 0.1), std('#7d2f22'));
    door.position.set(0, 1.7, D / 2 + 0.05);
    barn.add(door);
    for (const r of [0.75, -0.75]) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.18, 0.06), trim);
      bar.position.set(0, 1.7, D / 2 + 0.12);
      bar.rotation.z = r;
      barn.add(bar);
    }
    const frame = new THREE.Mesh(new THREE.BoxGeometry(3.9, 0.2, 0.08), trim);
    frame.position.set(0, 3.45, D / 2 + 0.1);
    barn.add(frame);
    barn.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
    this.#group('barn').add(barn);
  }

  /** บ้านของผู้เล่น (ด้านซ้าย) — ประตูหันมาทางทุ่ง แตะประตูเพื่อเข้าบ้าน */
  #house() {
    const house = new THREE.Group();
    house.position.set(-21, 0, 8);
    const W = 8;
    const H = 4.2;
    const D = 9;
    const body = new THREE.Mesh(new THREE.BoxGeometry(W, H, D), std(COLORS.houseWall));
    body.position.y = H / 2;
    house.add(body);
    const shape = new THREE.Shape([new THREE.Vector2(-D / 2 - 0.5, 0), new THREE.Vector2(D / 2 + 0.5, 0), new THREE.Vector2(0, 2.6)]);
    const roofGeo = new THREE.ExtrudeGeometry(shape, { depth: W + 1, bevelEnabled: false });
    roofGeo.translate(0, H, -(W + 1) / 2);
    roofGeo.rotateY(Math.PI / 2);
    house.add(new THREE.Mesh(roofGeo, std(COLORS.houseRoof)));
    // ประตู (หันไป +X) และหน้าต่างที่มีแสงไฟในบ้าน (ตู้ปลาอยู่ข้างใน)
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.3, 1.3), std(COLORS.door));
    door.position.set(W / 2 + 0.06, 1.15, 2.5);
    house.add(door);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), std('#c9a548', { metalness: 0.6, roughness: 0.4 }));
    knob.position.set(W / 2 + 0.14, 1.15, 2.0);
    house.add(knob);
    const glass = new THREE.MeshStandardMaterial({ color: '#ffe2a6', emissive: '#ffcf7a', emissiveIntensity: 0.6, roughness: 0.3 });
    for (const z of [-1.2, -3.2]) {
      const win = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.2, 1.4), glass);
      win.position.set(W / 2 + 0.05, 2.3, z);
      house.add(win);
    }
    const step = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.2, 1.8), std('#9b9488'));
    step.position.set(W / 2 + 0.6, 0.1, 2.5);
    house.add(step);
    house.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
    this.#group('house').add(house);
    this.door = door;
    /** จุดแตะประตู (ใหญ่กว่าตัวประตูหน่อย จะได้แตะง่ายบนมือถือ) */
    this.doorHit = new THREE.Sphere(door.getWorldPosition(new THREE.Vector3()), 1.6);
  }

  #props() {
    const wood = std(COLORS.wood);
    // รางน้ำ/รางอาหารในคอก
    const trough = new THREE.Group();
    trough.position.set(6, 0, -5);
    const box = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.55, 0.8), wood);
    box.position.y = 0.45;
    trough.add(box);
    const water = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.05, 0.62), std(COLORS.water, { roughness: 0.15 }));
    water.position.y = 0.7;
    trough.add(water);
    for (const x of [-1.1, 1.1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.2, 0.8), wood);
      leg.position.set(x, 0.1, 0);
      trough.add(leg);
    }
    this.trough = trough;

    // กองฟางม้วนข้างโรงนา
    const hay = std(COLORS.hay);
    const bale = new THREE.CylinderGeometry(0.75, 0.75, 1.2, 18);
    bale.rotateZ(Math.PI / 2);
    const props = new THREE.Group();
    props.add(trough);
    for (const [x, y, z] of [[7.2, 0.75, -11.6], [8.7, 0.75, -11.6], [7.95, 2.0, -11.6], [-7.5, 0.75, -11.2]]) {
      const b = new THREE.Mesh(bale, hay);
      b.position.set(x, y, z);
      props.add(b);
    }
    props.traverse((o) => o.isMesh && ((o.castShadow = true), (o.receiveShadow = true)));
    this.scene.add(props);
  }

  #trees() {
    const spots = [];
    const rnd = this.rnd;
    for (let i = 0; i < 46; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 24 + rnd() * 30;
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      if (z > 14 && Math.abs(x) < 22) continue; // ไม่บังกล้อง
      if (Math.abs(x - HOUSE_AT.x) < 9 && Math.abs(z - HOUSE_AT.z) < 9) continue; // ไม่ขึ้นทับบ้าน
      if (Math.abs(x - BARN_AT.x) < 9 && Math.abs(z - BARN_AT.z) < 10) continue; // ไม่ขึ้นทับโรงนา
      spots.push([x, z, 0.8 + rnd() * 0.7]);
    }
    this.treeSpots = spots;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 2.4, 7);
    trunkGeo.translate(0, 1.2, 0);
    const crownGeo = new THREE.IcosahedronGeometry(1.7, 1);
    crownGeo.translate(0, 3.5, 0);
    const trunks = new THREE.InstancedMesh(trunkGeo, std(COLORS.trunk), spots.length);
    const crowns = new THREE.InstancedMesh(crownGeo, std(COLORS.leaves), spots.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const tint = new THREE.Color();
    spots.forEach(([x, z, s], i) => {
      m.compose(new THREE.Vector3(x, 0, z), q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rnd() * 6), new THREE.Vector3(s, s, s));
      trunks.setMatrixAt(i, m);
      crowns.setMatrixAt(i, m);
      crowns.setColorAt(i, tint.set(COLORS.leaves).offsetHSL((rnd() - 0.5) * 0.05, 0, (rnd() - 0.5) * 0.12));
    });
    trunks.castShadow = crowns.castShadow = true;
    this.#group('trees').add(trunks, crowns);
  }

  #hills() {
    const mat = std(COLORS.hill, { fog: true });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), mat);
      const r = 110 + this.rnd() * 30;
      hill.position.set(Math.cos(a) * r, -2, Math.sin(a) * r);
      hill.scale.set(35 + this.rnd() * 25, 12 + this.rnd() * 14, 30);
      hill.lookAt(0, -2, 0);
      this.scene.add(hill);
    }
  }

  #clouds() {
    this.clouds = new THREE.Group();
    const mat = new THREE.MeshLambertMaterial({ color: COLORS.cloud, fog: false });
    const puff = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 10; i++) {
      const cloud = new THREE.Group();
      for (let j = 0; j < 4; j++) {
        const p = new THREE.Mesh(puff, mat);
        p.position.set(j * 2.2 - 3.3, Math.sin(j * 1.7) * 0.6, (this.rnd() - 0.5) * 2);
        p.scale.setScalar(1.8 + this.rnd() * 1.4);
        cloud.add(p);
      }
      cloud.position.set((this.rnd() - 0.5) * 220, 38 + this.rnd() * 18, -40 - this.rnd() * 90);
      cloud.scale.set(2, 1, 1.4);
      this.clouds.add(cloud);
    }
    this.scene.add(this.clouds);
  }

  /**
   * สลับเป็นโมเดลจริง (ชิ้นไหนโหลดไม่ได้ = ใช้โมเดลชั่วคราวต่อ)
   * @param {Record<keyof FARM_MODELS, import('three/addons/loaders/GLTFLoader.js').GLTF | null>} gltfs
   */
  useModels(gltfs) {
    const swap = (key, object) => {
      const old = this.placeholders[key];
      if (old) this.scene.remove(old);
      delete this.placeholders[key];
      if (object) this.scene.add(object);
    };
    const shadowed = (root) => {
      root.traverse((o) => {
        if (o.isMesh) o.castShadow = o.receiveShadow = true;
      });
      return root;
    };
    if (gltfs.house) {
      const house = shadowed(gltfs.house.scene.clone());
      house.position.set(HOUSE_AT.x, 0, HOUSE_AT.z);
      house.rotation.y = HOUSE_AT.rotY;
      swap('house', house);
      house.updateMatrixWorld(true);
      // ประตูหน้าบ้านในไฟล์: กลางหน้าบ้าน สูงจากพื้น ~1.6 ม. ห่างแนวกลางบ้าน 3.5 ม.
      this.doorHit.center.copy(house.localToWorld(new THREE.Vector3(0, 1.6, 3.55)));
      this.doorHit.radius = 1.7;
    }
    if (gltfs.barn) {
      const barn = shadowed(gltfs.barn.scene.clone());
      barn.position.set(BARN_AT.x, 0, BARN_AT.z);
      swap('barn', barn);
    }
    if (gltfs.fence) swap('fence', this.#instancedFence(gltfs.fence));
    if (gltfs.treeA || gltfs.treeB) swap('trees', this.#instancedTrees([gltfs.treeA, gltfs.treeB].filter(Boolean)));
  }

  /** mesh ทุกชิ้นในไฟล์ (พร้อม matrix ภายในไฟล์) → ไว้ทำ InstancedMesh */
  static #meshesOf(gltf) {
    const out = [];
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse((o) => o.isMesh && out.push(o));
    return out;
  }

  /**
   * รั้วจากไฟล์: เสา (FencePost) + ราว 3 ชั้นยาว 2 ม. (FenceRails ตามแกน +x ของโมเดล ติดด้าน +z ของเสา)
   * ช่วงรั้วเรียงวนรอบคอก → วางราวที่เสาปลายช่วง หมุน atan2(dz, −dx) แล้วราวจะทอดกลับไปหาเสาต้นโดยอยู่ด้านนอกคอกเสมอ
   */
  #instancedFence(gltf) {
    const group = new THREE.Group();
    const segs = Farm.fenceSegments();
    const rnd = seededRandom(0.77);
    const rails = segs.map(({ a, b }) => ({ x: b[0], z: b[1], yaw: Math.atan2(b[1] - a[1], -(b[0] - a[0])) }));
    const posts = new Map();
    segs.forEach(({ a, b }, i) => {
      for (const p of [a, b]) {
        const k = `${p[0].toFixed(2)},${p[1].toFixed(2)}`;
        if (!posts.has(k)) posts.set(k, { x: p[0], z: p[1], yaw: rails[i].yaw + (rnd() - 0.5) * 0.12 });
      }
    });
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const one = new THREE.Vector3(1, 1, 1);
    for (const part of Farm.#meshesOf(gltf)) {
      const places = /post/i.test(part.name) ? [...posts.values()] : rails;
      const inst = new THREE.InstancedMesh(part.geometry, part.material, places.length);
      places.forEach((p, i) => {
        q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
        m.compose(new THREE.Vector3(p.x, 0, p.z), q, one).multiply(part.matrixWorld);
        inst.setMatrixAt(i, m);
      });
      inst.castShadow = inst.receiveShadow = true;
      group.add(inst);
    }
    return group;
  }

  #instancedTrees(gltfs) {
    const group = new THREE.Group();
    const rnd = seededRandom(0.31);
    const spots = this.treeSpots.map(([x, z, s]) => ({ x, z, s: 0.75 + s * 0.35, yaw: rnd() * Math.PI * 2, kind: Math.floor(rnd() * gltfs.length) }));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    // ต้นที่อยู่ไกลเกินกล้องเงา (±26 ม.) ไม่ต้องวาดลง shadow map → แยกเป็นชุดใกล้ (ทำเงา) / ชุดไกล
    const near = (p) => Math.hypot(p.x, p.z) < 34;
    gltfs.forEach((gltf, kind) => {
      for (const shadow of [true, false]) {
        const mine = spots.filter((p) => p.kind === kind && near(p) === shadow);
        if (!mine.length) continue;
        for (const part of Farm.#meshesOf(gltf)) {
          const inst = new THREE.InstancedMesh(part.geometry, part.material, mine.length);
          mine.forEach((p, i) => {
            q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, p.yaw);
            m.compose(new THREE.Vector3(p.x, 0, p.z), q, new THREE.Vector3(p.s, p.s, p.s)).multiply(part.matrixWorld);
            inst.setMatrixAt(i, m);
          });
          inst.castShadow = shadow;
          inst.receiveShadow = !/leaves/i.test(part.material.name); // ใบไม้รับเงาตัวเองแล้วดำเป็นจุด ๆ
          group.add(inst);
        }
      }
    });
    return group;
  }

  /** แตะโดนประตูบ้านไหม */
  pickDoor(ray) {
    return ray.intersectsSphere(this.doorHit);
  }

  update(dt) {
    for (const c of this.clouds.children) {
      c.position.x += dt * 1.2;
      if (c.position.x > 130) c.position.x = -130;
    }
  }
}
