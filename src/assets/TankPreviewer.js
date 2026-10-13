import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Aquarium } from '../world/Aquarium.js';
import { Room } from '../world/Room.js';
import { STARTER_DECOR } from '../core/GameState.js';
import { getDecorItem } from '../data/decor.js';
import { getSpecies } from '../data/fish.js';
import { sharedUniforms } from '../render/shaderMods.js';
import { getWoodTexture } from '../render/textures.js';
import { disposeObject } from './AssetLoader.js';
import { seededRandom } from '../utils/math.js';

const WIDTH = 960;
const HEIGHT = 540;

/**
 * ภาพตัวอย่างตู้ปลาสำหรับร้านค้า: สร้างตู้ชนิดนั้นพร้อมของตกแต่งและปลาตัวอย่าง (data/tanks.js → showcase)
 * แล้วเรนเดอร์ด้วย renderer แยก (ไม่ยุ่งกับฉากหลัก) ได้เป็นรูป JPEG เก็บไว้ใช้ซ้ำ
 * สร้างทีละรูปตามคิว เฉพาะตอนเปิดแท็บตู้ปลา (ไม่เสียเวลาตอนโหลดเกม)
 */
export class TankPreviewer {
  constructor(factory) {
    this.factory = factory;
    this.cache = new Map();
    this.pending = new Map();
    this.queue = Promise.resolve();
  }

  /** รูปที่สร้างไว้แล้ว (หรือ null) */
  peek(type) {
    return this.cache.get(type.id) ?? null;
  }

  /** @returns {Promise<string>} data URL ของรูปตัวอย่าง ('' ถ้าสร้างไม่สำเร็จ) */
  get(type) {
    if (this.cache.has(type.id)) return Promise.resolve(this.cache.get(type.id));
    if (this.pending.has(type.id)) return this.pending.get(type.id);
    const job = (this.queue = this.queue
      .then(() => new Promise((r) => setTimeout(r, 20))) // ให้ UI วาดก่อน ไม่ค้างทั้งชุด
      .then(() => {
        const url = this.#render(type);
        this.cache.set(type.id, url);
        this.pending.delete(type.id);
        return url;
      }));
    this.pending.set(type.id, job);
    return job;
  }

  #render(type) {
    const saved = { top: sharedUniforms.uWaterTop.value, caustic: sharedUniforms.uCausticIntensity.value };
    const wood = getWoodTexture();
    const woodRepeat = wood.repeat.clone();
    let renderer = null;
    let url = '';
    const extras = [];
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
      renderer.setPixelRatio(1);
      renderer.setSize(WIDTH, HEIGHT, false);
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;

      const scene = new THREE.Scene();
      scene.fog = new THREE.Fog('#1b6aa8', 10, 60);
      const pmrem = new THREE.PMREMGenerator(renderer);
      const envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      scene.environment = envMap;
      scene.environmentIntensity = 0.45;

      const aquarium = new Aquarium({ scene, envMap });
      aquarium.build(type, { pebbles: 220 });
      const room = new Room(scene);
      room.build(aquarium.dims);
      const { w, h, d } = aquarium.dims;

      // แสงแบบเดียวกับฉากหลัก (SceneManager)
      const hemi = new THREE.HemisphereLight(0xcfeeff, 0x9c8a66, 1.25);
      const sun = new THREE.DirectionalLight(0xfff6e6, 2.7);
      sun.position.set(w * 0.12, h * 2.6, d * 0.45);
      sun.castShadow = true;
      sun.shadow.mapSize.set(1024, 1024);
      sun.shadow.bias = -0.0004;
      sun.shadow.normalBias = 0.03;
      const r = Math.max(w, d) * 0.62;
      Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 0.5, far: h * 5 });
      const fill = new THREE.DirectionalLight(0x9fd6ff, 0.55);
      fill.position.set(0, h * 0.6, d * 4);
      fill.target.position.set(0, h * 0.4, 0);
      scene.add(hemi, sun, sun.target, fill, fill.target);

      // ของตกแต่ง: ผังเดียวกับตู้เริ่มต้น + ของเพิ่มเติมของตู้นั้น
      const halfW = w / 2 - 0.6;
      const halfD = d / 2 - 0.5;
      [...STARTER_DECOR, ...(type.showcase?.extraDecor ?? [])].forEach(([itemId, u, v, rot], i) => {
        const item = getDecorItem(itemId);
        if (!item) return;
        const { object } = this.factory.createDecor(item, (i * 0.137) % 1, { animated: false });
        const x = u * halfW;
        const z = v * halfD;
        object.position.set(x, aquarium.heightAt(x, z), z);
        object.rotation.y = rot;
        scene.add(object);
        extras.push(object);
      });

      // ปลาตัวอย่าง: วางกระจายตามระดับน้ำที่ชอบ หันข้างให้เห็นทรงตัว (สุ่มแบบกำหนด seed → รูปเหมือนเดิมทุกครั้ง)
      const rnd = seededRandom(0.3 + type.size.w * 0.01);
      for (const id of type.showcase?.fish ?? []) {
        const species = getSpecies(id);
        if (!species) continue;
        const { object } = this.factory.createFish(species, { animated: false });
        const fish = new THREE.Group();
        fish.add(object);
        fish.scale.setScalar(species.length);
        const x = (rnd() * 2 - 1) * (w / 2 - 1 - species.length * 0.4);
        const z = (rnd() * 1.4 - 0.9) * (d / 2 - 0.9);
        const floor = aquarium.heightAt(x, z);
        if (species.behavior.walker) {
          const foot = -new THREE.Box3().setFromObject(object, true).min.y * species.length;
          fish.position.set(x, floor + foot, z);
          fish.rotation.y = rnd() * Math.PI * 2;
        } else {
          const band = { top: [0.62, 0.95], middle: [0.3, 0.75], bottom: [0.12, 0.35] }[species.behavior.zone] ?? [0.2, 0.8];
          const top = aquarium.dims.waterTop - 0.6;
          fish.position.set(x, floor + 0.7 + (top - floor - 0.7) * (band[0] + rnd() * (band[1] - band[0])), z);
          fish.rotation.y = (rnd() < 0.5 ? 1 : -1) * (Math.PI / 2 + (rnd() - 0.5) * 0.9);
        }
        scene.add(fish);
        extras.push(fish);
      }

      // กล้องมุมเดียวกับมุมมองหลักในเกม
      const camera = new THREE.PerspectiveCamera(38, WIDTH / HEIGHT, 0.1, 400);
      const vFov = THREE.MathUtils.degToRad(camera.fov);
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const dist = d / 2 + Math.max((w * 0.5 * 1.16) / Math.tan(hFov / 2), ((h + 1.4) * 0.5 * 1.2) / Math.tan(vFov / 2));
      camera.position.set(0, h * 0.62, dist);
      camera.lookAt(0, h * 0.44, 0);
      camera.updateMatrixWorld();

      aquarium.setWaterQuality(1);
      aquarium.update(0, 0, camera);
      renderer.render(scene, camera);
      url = renderer.domElement.toDataURL('image/jpeg', 0.88);

      for (const obj of extras) disposeObject(obj);
      aquarium.dispose();
      room.clear();
      envMap.dispose();
      pmrem.dispose();
    } catch (err) {
      console.warn('สร้างภาพตัวอย่างตู้ไม่สำเร็จ', type.id, err);
    } finally {
      sharedUniforms.uWaterTop.value = saved.top;
      sharedUniforms.uCausticIntensity.value = saved.caustic;
      wood.repeat.copy(woodRepeat);
      renderer?.dispose();
      renderer?.forceContextLoss();
    }
    return url;
  }
}
