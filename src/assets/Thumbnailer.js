import * as THREE from 'three';
import { disposeObject } from './AssetLoader.js';
import { genesKey } from '../models/molly/genetics.js';

const SIZE = 192;

/**
 * เรนเดอร์รูปตัวอย่างของปลา/ของตกแต่งสำหรับใช้ใน UI (ร้านค้า แถบตกแต่ง)
 * ใช้ renderer แยกขนาดเล็ก → ได้รูปจากโมเดลจริงอัตโนมัติเมื่อใส่ไฟล์ .glb
 */
export class Thumbnailer {
  constructor(factory) {
    this.factory = factory;
    this.cache = new Map();
    this.renderer = null;
  }

  #setup() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(SIZE, SIZE, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.setClearColor(0x000000, 0);

    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight(0xeaf6ff, 0x6a5a48, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(2, 4, 3);
    const rim = new THREE.DirectionalLight(0x9fd8ff, 1.2);
    rim.position.set(-3, 2, -3);
    this.scene.add(key, rim);
    this.camera = new THREE.PerspectiveCamera(30, 1, 0.01, 100);
  }

  /** @param {object} [genes] ยีนสีของปลาลูกผสม — ได้รูปลายเฉพาะตัว */
  /** @param {number} [growth] ช่วงวัยของปลาตัวนั้น — ลูกปลาที่มีโมเดลแยกได้รูปลูกปลา (ไม่ระบุ = ตัวเต็มวัย) */
  fish(species, genes = null, growth = 1) {
    const baby = this.factory.isBabyLook(species, growth);
    const key = `fish:${species.id}${genes ? `:${genesKey(genes)}` : ''}${baby ? ':baby' : ''}`;
    return this.#render(key, () => this.factory.createFish(species, { animated: false, genes, growth: baby ? 0 : 1 }).object, new THREE.Vector3(-1, 0.22, 0.45));
  }

  decor(item) {
    return this.#render(`decor:${item.id}`, () => this.factory.createDecor(item, 0.37, { animated: false }).object, new THREE.Vector3(0.5, 0.55, 1));
  }

  #render(key, build, viewDir) {
    if (this.cache.has(key)) return this.cache.get(key);
    let url = '';
    try {
      if (!this.renderer) this.#setup();
      const object = build();
      this.scene.add(object);
      object.updateMatrixWorld(true);
      // precise = คิดจากจุดจริงของโมเดล (bounding box ปกติของ morph target รวมทุกท่าของแอนิเมชัน ทำให้รูปเล็กผิดปกติ)
      const sphere = new THREE.Box3().setFromObject(object, true).getBoundingSphere(new THREE.Sphere());
      const dist = (sphere.radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 0.92;
      this.camera.position.copy(sphere.center).addScaledVector(viewDir.normalize(), dist);
      this.camera.near = dist / 50;
      this.camera.far = dist * 4;
      this.camera.updateProjectionMatrix();
      this.camera.lookAt(sphere.center);
      this.renderer.render(this.scene, this.camera);
      url = this.renderer.domElement.toDataURL('image/png');
      this.scene.remove(object);
      disposeObject(object);
    } catch (err) {
      console.warn('สร้างรูปตัวอย่างไม่สำเร็จ', key, err);
    }
    this.cache.set(key, url);
    return url;
  }
}
