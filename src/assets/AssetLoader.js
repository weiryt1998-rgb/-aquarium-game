import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader, DRACO_GLTF_CONFIG } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import availableModels from 'virtual:model-manifest';

const BASE_URL = import.meta.env.BASE_URL;
const isExternal = (url) => /^(https?:)?\/\//.test(url);

/**
 * โหลดโมเดล .glb/.gltf พร้อมแคช
 * - โหลดเฉพาะไฟล์ที่มีอยู่จริงใน public/models (ดู vite.config.js) หรือ URL ภายนอก
 * - ถ้าโหลดไม่ได้จะคืน null แล้วเกมจะใช้โมเดลชั่วคราวแทน
 */
export class AssetLoader {
  constructor() {
    this.loader = new GLTFLoader();
    // ตัวถอดรหัส Draco ถูก bundle มากับเกม (ไม่ต้องต่ออินเทอร์เน็ต) และโหลดเฉพาะตอนเจอไฟล์ที่บีบอัด
    const draco = new DRACOLoader();
    draco.setDecoderPath(DRACO_GLTF_CONFIG);
    this.loader.setDRACOLoader(draco);
    this.loader.setMeshoptDecoder(MeshoptDecoder);
    this.available = new Set(availableModels);
    this.models = new Map(); // url → gltf | null
    this.pending = new Map(); // url → Promise
  }

  /** มีไฟล์นี้ให้โหลดไหม */
  exists(url) {
    return !!url && (isExternal(url) || this.available.has(url.replace(/^\.?\//, '')));
  }

  resolve(url) {
    return isExternal(url) || url.startsWith('/') ? url : BASE_URL + url;
  }

  load(url) {
    if (this.models.has(url)) return Promise.resolve(this.models.get(url));
    if (this.pending.has(url)) return this.pending.get(url);
    const promise = this.#fetchModel(url).then((gltf) => {
      this.models.set(url, gltf);
      this.pending.delete(url);
      return gltf;
    });
    this.pending.set(url, promise);
    return promise;
  }

  async #fetchModel(url) {
    if (!this.exists(url)) return null;
    try {
      const full = this.resolve(url);
      const res = await fetch(full, { headers: { Accept: 'model/gltf-binary, model/gltf+json, application/octet-stream' } });
      if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null;
      const buffer = await res.arrayBuffer();
      const basePath = full.substring(0, full.lastIndexOf('/') + 1);
      const gltf = await this.loader.parseAsync(buffer, basePath);
      console.info(`[models] โหลดสำเร็จ: ${url}`);
      return gltf;
    } catch (err) {
      console.warn(`[models] โหลด ${url} ไม่สำเร็จ จะใช้โมเดลชั่วคราวแทน`, err);
      return null;
    }
  }

  /** โหลดล่วงหน้าหลายไฟล์ (เฉพาะที่มีอยู่จริง) */
  async preload(urls, onProgress) {
    const list = [...new Set(urls.filter((u) => this.exists(u)))];
    let done = 0;
    onProgress?.(list.length === 0 ? 1 : 0);
    await Promise.all(
      list.map((u) =>
        this.load(u).then(() => {
          done++;
          onProgress?.(done / list.length);
        }),
      ),
    );
  }

  /** คืน gltf ตัวแรกที่โหลดสำเร็จจากรายการ */
  first(urls) {
    for (const url of urls) {
      const gltf = url ? this.models.get(url) : null;
      if (gltf) return { gltf, url };
    }
    return null;
  }

  /** สร้างสำเนาของโมเดล (รองรับ skinned mesh) และ clone วัสดุ เพื่อแก้ไขแยกแต่ละชิ้นได้ */
  instantiate(gltf) {
    const scene = SkeletonUtils.clone(gltf.scene);
    scene.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.geometry.userData.shared = true; // geometry ใช้ร่วมกับต้นฉบับ ห้าม dispose
      obj.material = Array.isArray(obj.material) ? obj.material.map((m) => m.clone()) : obj.material.clone();
      obj.castShadow = true;
      obj.receiveShadow = true;
      // ขอบเขตของ skinned mesh คำนวณจากท่าเริ่มต้น ระหว่างแอนิเมชันอาจถูกตัดทิ้งผิด ๆ ตอนอยู่ขอบจอ
      if (obj.isSkinnedMesh) obj.frustumCulled = false;
    });
    return { scene, animations: gltf.animations ?? [] };
  }
}

/**
 * ปรับขนาดและจุดศูนย์กลางของโมเดลให้เป็นมาตรฐาน
 * @param {THREE.Object3D} object
 * @param {{ rotation?: number[], fit?: 'length'|'height'|'width'|'max', size?: number, align?: 'center'|'base' }} opts
 * @returns {{ root: THREE.Group, scale: number }}
 */
export function normalizeModel(object, { rotation = [0, 0, 0], fit = 'max', size = 1, align = 'center' } = {}) {
  const rot = new THREE.Group();
  rot.rotation.set(rotation[0] ?? 0, rotation[1] ?? 0, rotation[2] ?? 0);
  rot.add(object);
  rot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rot, true);
  if (box.isEmpty()) {
    const root = new THREE.Group();
    root.add(rot);
    return { root, scale: 1 };
  }
  const dims = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const measure = { length: dims.z, height: dims.y, width: Math.max(dims.x, dims.z) }[fit] ?? Math.max(dims.x, dims.y, dims.z);
  const scale = measure > 1e-6 ? size / measure : 1;
  rot.position.set(-center.x, align === 'base' ? -box.min.y : -center.y, -center.z);
  const scaler = new THREE.Group();
  scaler.scale.setScalar(scale);
  scaler.add(rot);
  const root = new THREE.Group();
  root.add(scaler);
  return { root, scale };
}

/** เรียก fn กับทุก material ของทุก mesh ใน object */
export function forEachMaterial(object, fn) {
  object.traverse((obj) => {
    if (!obj.isMesh) return;
    if (Array.isArray(obj.material)) obj.material.forEach((m) => fn(m, obj));
    else if (obj.material) fn(obj.material, obj);
  });
}

/** ล้างหน่วยความจำ GPU ของ object (ยกเว้น geometry ที่แชร์กัน ซึ่งตั้ง userData.shared = true) */
export function disposeObject(object) {
  object.traverse((obj) => {
    if (!obj.isMesh && !obj.isPoints && !obj.isLine) return;
    if (obj.geometry && !obj.geometry.userData.shared) obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
    mats.forEach((m) => m?.dispose());
  });
}
