import * as THREE from 'three';
import { pearlReadyAt } from '../shared/economy.js';

/** มุมที่หมุนฝาบนลงมาปิด (เรเดียน, หมุนรอบแกน X ที่บานพับด้านหลัง) — ท่าในไฟล์โมเดลคือท่าเปิด */
const CLOSED_ANGLE = 0.88;
const OPEN_SPEED = 0.8; // ต่อวินาที (เปิด/ปิดเสร็จใน ~1.25 วินาที)

const _box = new THREE.Box3();
const ease = (t) => t * t * (3 - 2 * t);

/**
 * ฝาหอยที่เปิด-ปิดตามเวลาไข่มุก (ใช้กับของตกแต่งที่มี item.pearl)
 * ต้องการโมเดลที่มี node ชื่อ shell_top (ฝาบน) และ pearl (ไข่มุก) — ถ้าเป็นโมเดลชั่วคราว จะสร้างไข่มุกลอยไว้ด้านบนแทน
 */
export class PearlClam {
  /** @param object โมเดลที่ปรับขนาดแล้ว (ยังไม่ถูกใส่ใน group อื่น จึงใช้พิกัดของ object เป็นพิกัดโลกได้) */
  constructor(object, item) {
    this.item = item;
    object.updateMatrixWorld(true);
    const top = object.getObjectByName('shell_top');
    this.pearl = object.getObjectByName('pearl') ?? this.#makePearl(object);
    this.pearlScale = this.pearl.scale.clone();
    this.pivot = null;
    if (top) {
      // บานพับ = ขอบล่างด้านหลังของฝาบน แล้วย้ายฝาบนไปอยู่ใต้ pivot โดยคงตำแหน่งเดิม
      _box.setFromObject(top);
      this.pivot = new THREE.Group();
      this.pivot.position.set((_box.min.x + _box.max.x) / 2, _box.min.y, _box.min.z);
      object.add(this.pivot);
      object.updateMatrixWorld(true);
      this.pivot.attach(top);
    }
    this.openness = null; // 0 = ปิด, 1 = เปิด (null = ยังไม่ได้ตั้งค่าเริ่ม)
    this.ready = false;
  }

  #makePearl(object) {
    const pearl = new THREE.Mesh(
      new THREE.SphereGeometry(0.16, 24, 16),
      new THREE.MeshStandardMaterial({ color: '#fdf3f6', metalness: 0.3, roughness: 0.15, emissive: '#2a1f24' }),
    );
    pearl.position.y = this.item.height + 0.2;
    pearl.castShadow = true;
    object.add(pearl);
    return pearl;
  }

  /** ตำแหน่งไข่มุกในพิกัดโลก */
  pearlPosition(target = new THREE.Vector3()) {
    return this.pearl.getWorldPosition(target);
  }

  /**
   * @param record ข้อมูลของตกแต่งในเซฟ (ใช้ pearlAt)
   * @returns {boolean} true ถ้าเพิ่งเปิดฝาในเฟรมนี้
   */
  update(dt, time, record, now = Date.now()) {
    const wasReady = this.ready;
    this.ready = now >= pearlReadyAt(record, this.item);
    const target = this.ready ? 1 : 0;
    if (this.openness === null) this.openness = target; // ตอนโหลดตู้: ไม่ต้องเล่นแอนิเมชัน
    else if (this.openness < target) this.openness = Math.min(target, this.openness + OPEN_SPEED * dt);
    else if (this.openness > target) this.openness = Math.max(target, this.openness - OPEN_SPEED * dt * 1.6);

    if (this.pivot) this.pivot.rotation.x = CLOSED_ANGLE * (1 - ease(this.openness));
    // ไข่มุกโผล่เมื่อฝาเปิดเกินครึ่ง และหายทันทีเมื่อถูกเก็บ (ready = false)
    this.pearl.visible = this.ready && this.openness > 0.5;
    if (this.pearl.visible) this.pearl.scale.copy(this.pearlScale).multiplyScalar(1 + Math.sin(time * 3) * 0.05);
    return this.ready && !wasReady && this.openness < 1;
  }
}
