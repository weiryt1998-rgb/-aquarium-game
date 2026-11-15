import * as THREE from 'three';

/**
 * บ้านหลังใหม่ที่เดินเข้าไปได้ (Fish/farm/build_home.py → models/farm/home.glb) — วางตรงพิกัดในไฟล์ (ไม่ย้าย/หมุน)
 *
 * โหมดในบ้าน (setInterior): ซ่อนหลังคา + ลดผนังที่บังกล้อง (แบบเกมจำลองชีวิต) — ผนังทั้งเส้นที่อยู่ระหว่างกล้องกับจุดที่มอง
 *   ท่อนแตะพื้นย่อเหลือ CUT_HEIGHT · ท่อนลอย (เหนือประตู/หน้าต่าง/กระจก) ซ่อน · เปลี่ยนนุ่ม ๆ
 * ประตูหน้าเปิดเองเมื่อมีคนเดินใกล้ · จอทีวีสว่างเมื่อมีคนดู
 * เฟอร์นิเจอร์ F_<ชนิด>_<n> + จุดใช้งาน Use_<F>_<k> (ตำแหน่ง + ทิศหันหน้า) — ระบบกิจกรรม (systems/HouseLife.js) ใช้
 */
export const HOUSE_RECT = { minX: -31, maxX: -17, minZ: 4.6, maxZ: 17.4 };
/** ผนังที่ลดลงเหลือสูงเท่านี้ (ม.) */
const CUT_HEIGHT = 0.32;
const WALL_H = 2.7;
/** ชนิดเฟอร์นิเจอร์จากชื่อ F_<ชนิด>_<n> */
const typeOf = (name) => name.replace(/^F_/, '').replace(/_\d+$/, '');

/** จุดเดินในบ้าน (หน้า/หลังทุกช่องประตู + กลางห้อง) — เพิ่มให้ FarmNav */
export const HOUSE_NAV = [
  // ประตูหน้า (นอก/ใน)
  [-15.7, 10.5], [-17.9, 10.5],
  // ห้องนั่งเล่น
  [-19.6, 11.2], [-19.2, 15.6], [-22.5, 11.0], [-22.8, 13.9],
  // ช่องเปิดครัว ↔ ห้องนั่งเล่น + ครัว
  [-20.4, 10.25], [-20.4, 9.0], [-18.4, 7.4], [-22.6, 6.4], [-22.6, 8.6], [-19.3, 6.0],
  // ประตูห้องนอนบี (z 6.2) · ห้องนอนบี
  [-23.3, 6.2], [-24.7, 6.2], [-26.5, 6.6], [-27.6, 5.4],
  // ประตูห้องน้ำ (z 10.6) · ห้องน้ำ
  [-23.3, 10.6], [-24.7, 10.6], [-26.0, 10.6], [-28.6, 10.6],
  // ประตูห้องนอนเอ (z 13.6) · ห้องนอนเอ
  [-23.3, 13.6], [-24.7, 13.6], [-26.5, 14.6], [-27.6, 16.2], [-27.4, 13.6],
];

export class House {
  /** @param {THREE.Object3D} root ฉากจาก home.glb (สำเนาแล้ว) */
  constructor(root) {
    this.root = root;
    root.updateMatrixWorld(true);
    this.roof = root.getObjectByName('HomeRoof');
    /** @type {Map<string, { pieces: { node: THREE.Object3D, floating: boolean, cut: number }[], center: THREE.Vector3 }>} */
    this.lines = new Map();
    /** @type {Map<string, { node: THREE.Object3D, type: string, spots: { pos: THREE.Vector3, heading: number, y: number, name: string }[], box: THREE.Box3 }>} */
    this.furniture = new Map();
    this.floors = [];
    this.pickables = [];
    this.door = root.getObjectByName('F_FrontDoor');
    this.doorOpen = 0;
    this.tvOn = 0;
    this.tvWant = 0;
    this.interior = 0;
    const box = new THREE.Box3();
    root.traverse((o) => {
      const name = o.name || '';
      // วัตถุหลายวัสดุ = กลุ่ม + mesh ลูกชื่อขึ้นต้นเหมือนกัน → นับเฉพาะตัวบนสุด
      const parentName = o.parent?.name ?? '';
      if (name.startsWith('Wall_') && !parentName.startsWith('Wall_')) {
        const line = name.split('_')[1];
        if (!this.lines.has(line)) this.lines.set(line, { pieces: [], center: new THREE.Vector3(), n: 0 });
        box.setFromObject(o);
        const L = this.lines.get(line);
        L.pieces.push({ node: o, floating: box.min.y > 0.3, cut: 0, sy: o.scale.y });
        L.center.add(box.getCenter(new THREE.Vector3()));
        L.n++;
      } else if (name.startsWith('Floor_') && !parentName.startsWith('Floor_')) this.floors.push(o);
      else if (name.startsWith('F_') && name !== 'F_FrontDoor' && !o.parent?.name?.startsWith('F_')) {
        this.furniture.set(name, { node: o, type: typeOf(name), spots: [], box: new THREE.Box3().setFromObject(o) });
        this.pickables.push(o);
      }
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
      }
    });
    // ผนังทุกเส้นขนานแกน: เก็บแกน + พิกัดระนาบ (ใช้ตัดสินว่าผนังอยู่ระหว่างกล้องกับจุดที่มองไหม)
    for (const [name, L] of this.lines) {
      L.center.divideScalar(Math.max(1, L.n));
      const u = new THREE.Box3();
      for (const p of L.pieces) u.union(new THREE.Box3().setFromObject(p.node));
      L.axis = u.max.x - u.min.x < u.max.z - u.min.z ? 'x' : 'z';
      L.at = L.axis === 'x' ? (u.min.x + u.max.x) / 2 : (u.min.z + u.max.z) / 2;
      if (this.door && name === 'front') this.doorLine = L;
    }
    // จุดใช้งาน: Use_<ชื่อเฟอร์นิเจอร์>_<k>
    const q = new THREE.Quaternion();
    const fwd = new THREE.Vector3();
    root.traverse((o) => {
      const m = /^Use_(F_.+)_(\d+)$/.exec(o.name || '');
      if (!m) return;
      const f = this.furniture.get(m[1]);
      if (!f) return;
      const pos = o.getWorldPosition(new THREE.Vector3());
      o.getWorldQuaternion(q);
      fwd.set(0, 0, 1).applyQuaternion(q);
      f.spots[+m[2]] = { pos: pos.clone().setY(0), y: pos.y, heading: Math.atan2(fwd.x, fwd.z), name: o.name, taken: null };
    });
    this.screen = null;
    root.traverse((o) => {
      if (o.isMesh && o.material?.name === 'M_TVScreen') {
        o.material = o.material.clone();
        this.screen = o.material;
      }
    });
    // วัสดุโปร่งใส (กระจก น้ำตู้ปลา) ไม่ทับเงา/ไม่บังกันเอง
    root.traverse((o) => {
      if (o.isMesh && o.material?.transparent) {
        o.material.depthWrite = false;
        o.castShadow = false;
      }
    });
  }

  /** จุดนี้อยู่ในตัวบ้านไหม (margin = ขยายขอบ) */
  contains(p, margin = 0) {
    const r = HOUSE_RECT;
    return p.x > r.minX - margin && p.x < r.maxX + margin && p.z > r.minZ - margin && p.z < r.maxZ + margin;
  }

  /** เปิด/ปิดโหมดมองในบ้าน (หลังคา + ผนังบังกล้อง) */
  setInterior(on) {
    this.interiorWant = on ? 1 : 0;
  }

  /** ทีวีเปิดอยู่ (มีคนดู) */
  setTV(on) {
    this.tvWant = on ? 1 : 0;
  }

  /**
   * สิ่งกีดขวางสำหรับคนเดิน: ผนังทุกท่อนที่แตะพื้น + เฟอร์นิเจอร์ (ยกเว้นพรม/รูป/ประตู) เป็นกล่องตามแกน
   * @returns {{ minX: number, maxX: number, minZ: number, maxZ: number }[]}
   */
  colliderBoxes() {
    const out = [];
    const b = new THREE.Box3();
    for (const L of this.lines.values()) {
      for (const p of L.pieces) {
        if (p.floating) continue;
        b.setFromObject(p.node);
        if (b.max.y - b.min.y < 0.5 && b.max.y < 0.5) continue;
        out.push({ minX: b.min.x, maxX: b.max.x, minZ: b.min.z, maxZ: b.max.z });
      }
    }
    for (const f of this.furniture.values()) {
      if (/^(Rug|Picture)/.test(f.type)) continue;
      const fb = f.box;
      // หดเข้านิดหน่อย — เดินชิดเฟอร์นิเจอร์ได้ (ลำตัวคนกว้างกว่ารัศมีชนอยู่แล้ว)
      const s = /Lamp|Plant/.test(f.type) ? 0.05 : 0.04;
      out.push({ minX: fb.min.x + s, maxX: fb.max.x - s, minZ: fb.min.z + s, maxZ: fb.max.z - s });
    }
    return out;
  }

  /** แตะเฟอร์นิเจอร์ → ชื่อ (F_…) หรือ null */
  pickFurniture(raycaster) {
    const hits = raycaster.intersectObjects(this.pickables, true);
    for (const h of hits) {
      let o = h.object;
      while (o && !this.furniture.has(o.name)) o = o.parent;
      if (o) return { name: o.name, point: h.point, distance: h.distance };
    }
    return null;
  }

  /** แตะพื้นห้อง → จุดบนพื้น หรือ null */
  pickFloor(raycaster) {
    const h = raycaster.intersectObjects(this.floors, true)[0];
    return h ? h.point : null;
  }

  /**
   * @param {number} dt
   * @param {THREE.Camera} camera
   * @param {THREE.Vector3} target จุดที่กล้องมอง
   * @param {THREE.Vector3[]} people ตำแหน่งคนทั้งหมด (ประตูเปิดเมื่อมีคนใกล้)
   */
  update(dt, camera, target, people) {
    const k = 1 - Math.exp(-6 * dt);
    this.interior += ((this.interiorWant ?? 0) - this.interior) * k;
    if (this.roof) this.roof.visible = this.interior < 0.5;
    // ผนังเส้นไหน (ทั้งระนาบ) อยู่ระหว่างกล้องกับจุดที่มอง → ลด (แบบเกมจำลองชีวิต: ผนังฝั่งกล้องลงหมด ผนังฝั่งไกลยังตั้งอยู่)
    for (const L of this.lines.values()) {
      const t = L.axis === 'x' ? target.x : target.z;
      const c = L.axis === 'x' ? camera.position.x : camera.position.z;
      const between = (c - L.at) * (t - L.at) < 0 && Math.abs(t - L.at) > 0.2;
      const want = this.interiorWant && between ? 1 : 0;
      for (const p of L.pieces) {
        p.cut += (want - p.cut) * k;
        if (p.floating) p.node.visible = p.cut < 0.5;
        else p.node.scale.y = p.sy * (1 - p.cut * (1 - CUT_HEIGHT / WALL_H));
      }
    }
    // ประตูหน้าเปิดเข้าในบ้านเมื่อมีคนอยู่ใกล้
    if (this.door) {
      const hinge = this.door.position;
      const near = people.some((p) => Math.hypot(p.x - (hinge.x - 0.2), p.z - (hinge.z + 0.5)) < 1.9);
      this.doorOpen += ((near ? 1 : 0) - this.doorOpen) * (1 - Math.exp(-5 * dt));
      this.door.rotation.y = -1.45 * this.doorOpen;
      // ผนังหน้าบ้านถูกลด → บานประตูลดตามด้วย
      const cut = this.doorLine?.pieces[0]?.cut ?? 0;
      this.door.scale.y = 1 - cut * (1 - CUT_HEIGHT / WALL_H);
    }
    // จอทีวี
    this.tvOn += (this.tvWant - this.tvOn) * k;
    if (this.screen) {
      this.screen.emissive.setRGB(0.35, 0.55, 0.75).multiplyScalar(this.tvOn * (0.85 + Math.sin(performance.now() * 0.004) * 0.15));
      this.screen.emissiveIntensity = 1.4;
    }
  }
}
