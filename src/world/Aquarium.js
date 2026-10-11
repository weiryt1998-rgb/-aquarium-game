import * as THREE from 'three';
import { Substrate } from './Substrate.js';
import { LightRays } from './LightRays.js';
import { getGlassStreakTexture, getTankBackdropTexture } from '../render/textures.js';
import { sharedUniforms } from '../render/shaderMods.js';
import { clamp, lerp, rand } from '../utils/math.js';

const CLEAR_FOG = new THREE.Color('#1b6aa8');
const MURKY_FOG = new THREE.Color('#4f6f3a');
const SURFACE_DEEP = new THREE.Color('#2f8fd0');
const SURFACE_SHALLOW = new THREE.Color('#9fe6ff');
const SURFACE_MURKY = new THREE.Color('#7a9a5a');

const surfaceVertex = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
void main() {
  vec3 p = position;
  p.z += sin(p.x * 1.7 + uTime * 1.2) * 0.025 + sin(p.y * 2.3 + uTime * 0.9) * 0.02;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const surfaceFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
varying vec3 vWorld;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float grazing = 1.0 - abs(viewDir.y);
  float n = sin(vWorld.x * 3.1 + uTime * 1.3) * sin(vWorld.z * 2.7 - uTime * 1.1) + sin((vWorld.x + vWorld.z) * 1.9 + uTime * 0.7) * 0.5;
  float shimmer = smoothstep(0.6, 1.4, n);
  vec3 col = mix(uDeep, uShallow, 0.4 + 0.6 * grazing) + shimmer * 0.3;
  float alpha;
  if (cameraPosition.y < vWorld.y) {
    // มองจากใต้น้ำ: มุมเฉียงสะท้อนแสงกลับหมด (total internal reflection) จึงดูสว่างเงา
    alpha = mix(0.3, 0.9, pow(grazing, 2.0));
    col = mix(col, vec3(0.86, 0.97, 1.0), pow(grazing, 3.0) * 0.6);
  } else {
    alpha = mix(0.16, 0.5, pow(grazing, 3.0));
  }
  gl_FragColor = vec4(col, alpha);
}`;

/**
 * ตู้ปลา: พื้นกรวด กระจก ขอบตู้ ผิวน้ำ พื้นหลัง ลำแสง และเครื่องมือช่วยจัดวาง (กริด/วงกลมบอกตำแหน่ง)
 * พิกัดภายในตู้: กึ่งกลางตู้ที่ x=0,z=0 ก้นตู้ที่ y=0
 */
export class Aquarium {
  constructor(sceneMgr) {
    this.sceneMgr = sceneMgr;
    this.group = new THREE.Group();
    sceneMgr.scene.add(this.group);
    this.dims = null;
    this.quality = 1;
    this.box = new THREE.Box3();
    this.surfaceUniforms = {
      uTime: sharedUniforms.uTime,
      uDeep: { value: SURFACE_DEEP.clone() },
      uShallow: { value: SURFACE_SHALLOW.clone() },
    };
  }

  build(tankType, qualitySettings) {
    this.dispose();
    const { w, h, d } = tankType.size;
    this.dims = { w, h, d, waterTop: h - 0.45 };
    sharedUniforms.uWaterTop.value = this.dims.waterTop;
    this.box.set(new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, h, d / 2));

    this.substrate = new Substrate(this.dims, { pebbles: qualitySettings.pebbles });
    this.group.add(this.substrate.group);
    this.#buildBackdrop();
    this.#buildGlass();
    this.#buildFrame();
    this.#buildWaterSurface();
    this.#buildDebris();
    this.rays = new LightRays(this.dims);
    this.group.add(this.rays.group);
    this.marker = this.#buildMarker();
    this.marker.visible = false;
    this.group.add(this.marker);
    this.setWaterQuality(this.quality);
  }

  // ── ส่วนประกอบของตู้ ──────────────────────────────────────

  #buildBackdrop() {
    const { w, h, d } = this.dims;
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: getTankBackdropTexture() }));
    backdrop.position.set(0, h / 2, -d / 2 + 0.005);
    this.group.add(backdrop);
  }

  #buildGlass() {
    const { w, h, d, waterTop } = this.dims;
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xe6fbff,
      metalness: 0,
      roughness: 0.04,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMap: this.sceneMgr.envMap,
      envMapIntensity: 1.6,
      fog: false,
    });
    const panes = [
      [new THREE.PlaneGeometry(w, h), [0, h / 2, d / 2], 0],
      [new THREE.PlaneGeometry(d, h), [-w / 2, h / 2, 0], -Math.PI / 2],
      [new THREE.PlaneGeometry(d, h), [w / 2, h / 2, 0], Math.PI / 2],
    ];
    for (const [geo, pos, rotY] of panes) {
      const pane = new THREE.Mesh(geo, glass);
      pane.position.set(...pos);
      pane.rotation.y = rotY;
      pane.renderOrder = 5;
      this.group.add(pane);
    }
    // แถบสะท้อนแสงบนกระจกหน้า
    const streak = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: getGlassStreakTexture(), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    streak.position.set(0, h / 2, d / 2 + 0.01);
    streak.renderOrder = 6;
    this.group.add(streak);
    // เส้นขอบกระจก
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineBasicMaterial({ color: '#c8f2ff', transparent: true, opacity: 0.35, fog: false }),
    );
    edges.position.y = h / 2;
    this.group.add(edges);
    // เส้นระดับน้ำบนกระจก
    const lineMat = new THREE.MeshBasicMaterial({ color: '#e2f8ff', transparent: true, opacity: 0.55, depthWrite: false, fog: false });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.05), lineMat);
    front.position.set(0, waterTop, d / 2 - 0.004);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(d, 0.05), lineMat);
    left.position.set(-w / 2 + 0.004, waterTop, 0);
    left.rotation.y = Math.PI / 2;
    const right = left.clone();
    right.position.x = w / 2 - 0.004;
    right.rotation.y = -Math.PI / 2;
    this.group.add(front, left, right);
  }

  #buildFrame() {
    const { w, h, d } = this.dims;
    const mat = new THREE.MeshStandardMaterial({ color: '#14171d', roughness: 0.42, metalness: 0.45, fog: false });
    const t = 0.16;
    const addBar = (sx, sy, sz, x, y, z) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      bar.position.set(x, y, z);
      bar.castShadow = true;
      bar.receiveShadow = true;
      this.group.add(bar);
    };
    const rim = (height, y) => {
      addBar(w + t * 2, height, t, 0, y, d / 2 + t / 2);
      addBar(w + t * 2, height, t, 0, y, -d / 2 - t / 2);
      addBar(t, height, d, -w / 2 - t / 2, y, 0);
      addBar(t, height, d, w / 2 + t / 2, y, 0);
    };
    rim(0.22, h + 0.06); // ขอบบน
    rim(0.44, -0.1); // ฐานล่าง
    // ซิลิโคนตามมุมตู้
    const post = new THREE.MeshStandardMaterial({ color: '#0c1a26', transparent: true, opacity: 0.55, roughness: 0.3, fog: false });
    for (const [x, z] of [
      [-w / 2, d / 2],
      [w / 2, d / 2],
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
    ]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), post);
      p.position.set(x, h / 2, z);
      this.group.add(p);
    }
  }

  #buildWaterSurface() {
    const { w, d, waterTop } = this.dims;
    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.surfaceUniforms,
        vertexShader: surfaceVertex,
        fragmentShader: surfaceFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = waterTop;
    surface.renderOrder = 4;
    this.group.add(surface);
  }

  /** ตะกอนลอยในน้ำ (เห็นชัดขึ้นเมื่อน้ำสกปรก) */
  #buildDebris() {
    const { w, d, waterTop } = this.dims;
    const count = Math.round(w * d * 2.5);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = rand(-w / 2, w / 2);
      positions[i * 3 + 1] = rand(0.6, waterTop);
      positions[i * 3 + 2] = rand(-d / 2, d / 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.debris = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#b5a86a', size: 0.04, transparent: true, opacity: 0, depthWrite: false }));
    this.group.add(this.debris);
  }

  #buildMarker() {
    const marker = new THREE.Group();
    const discMat = new THREE.MeshBasicMaterial({ color: '#46e07a', transparent: true, opacity: 0.25, depthTest: false, depthWrite: false, fog: false });
    const ringMat = new THREE.MeshBasicMaterial({ color: '#46e07a', transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), discMat);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), ringMat);
    for (const m of [disc, ring]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 20;
      marker.add(m);
    }
    marker.userData.materials = [discMat, ringMat];
    return marker;
  }

  // ── ตัวช่วย ──────────────────────────────────────────────────

  heightAt(x, z) {
    return this.substrate.heightAt(x, z);
  }

  /** บังคับตำแหน่งให้อยู่ในน้ำ (ไม่ทะลุกระจก พื้นทราย หรือผิวน้ำ) */
  clampToWater(pos, margin = 0.3) {
    const { w, d, waterTop } = this.dims;
    pos.x = clamp(pos.x, -w / 2 + margin, w / 2 - margin);
    pos.z = clamp(pos.z, -d / 2 + margin, d / 2 - margin);
    const floor = this.heightAt(pos.x, pos.z) + margin * 0.6;
    pos.y = clamp(pos.y, floor, waterTop - margin * 0.6);
    return pos;
  }

  /** สุ่มจุดในน้ำตามระดับความลึกที่ปลาชอบ */
  randomPoint(zone = 'any', margin = 0.5, out = new THREE.Vector3()) {
    const { w, d, waterTop } = this.dims;
    const x = rand(-w / 2 + margin, w / 2 - margin);
    const z = rand(-d / 2 + margin, d / 2 - margin * 0.8);
    const floor = this.heightAt(x, z) + margin;
    const top = waterTop - margin;
    const range = Math.max(top - floor, 0.1);
    const band = { top: [0.62, 1], middle: [0.25, 0.8], bottom: [0, 0.38] }[zone] ?? [0, 1];
    return out.set(x, floor + range * rand(band[0], band[1]), z);
  }

  /** วางของได้ไหม (อยู่ในตู้ทั้งชิ้น) */
  isInside(x, z, radius) {
    const { w, d } = this.dims;
    const r = radius * 0.7;
    return Math.abs(x) <= w / 2 - r && Math.abs(z) <= d / 2 - r;
  }

  raycastSubstrate(raycaster) {
    const hit = raycaster.intersectObject(this.substrate.top, false)[0];
    return hit ? hit.point : null;
  }

  showGrid(visible) {
    this.substrate.gridUniforms.opacity.value = visible ? 0.7 : 0;
  }

  showMarker(x, z, radius, valid) {
    this.marker.visible = true;
    this.marker.position.set(x, this.heightAt(x, z) + 0.06, z);
    this.marker.scale.setScalar(Math.max(radius, 0.25));
    const color = valid ? '#46e07a' : '#ff5a5a';
    this.marker.userData.materials.forEach((m) => m.color.set(color));
  }

  hideMarker() {
    this.marker.visible = false;
  }

  /** ความสะอาดของน้ำ 0..1 → สีหมอก ลายแสง และตะกอน */
  setWaterQuality(q) {
    this.quality = clamp(q, 0, 1);
    const dirt = 1 - this.quality;
    this.sceneMgr.scene.fog.color.copy(CLEAR_FOG).lerp(MURKY_FOG, dirt * 0.85);
    sharedUniforms.uCausticIntensity.value = 0.55 * (0.35 + 0.65 * this.quality);
    this.surfaceUniforms.uDeep.value.copy(SURFACE_DEEP).lerp(SURFACE_MURKY, dirt * 0.7);
    this.surfaceUniforms.uShallow.value.copy(SURFACE_SHALLOW).lerp(SURFACE_MURKY, dirt * 0.5);
    if (this.debris) this.debris.material.opacity = Math.max(0, dirt - 0.25) * 1.1;
    if (this.rays) this.rays.intensity.value = 0.22 * (0.3 + 0.7 * this.quality);
  }

  update(dt, time, camera) {
    if (!this.dims) return;
    // หมอกใต้น้ำ: เริ่มที่ผิวตู้ด้านใกล้กล้อง ยิ่งน้ำขุ่นยิ่งทึบเร็ว
    const fog = this.sceneMgr.scene.fog;
    const near = Math.max(0.1, this.box.distanceToPoint(camera.position) - 0.2);
    fog.near = near;
    fog.far = near + ((this.dims.w + this.dims.d) / 2) * lerp(1.1, 3.0, this.quality);
    this.rays.update(camera);
    if (this.debris) this.debris.rotation.y = Math.sin(time * 0.05) * 0.02;
  }

  dispose() {
    if (!this.dims) return;
    this.substrate?.dispose();
    this.rays?.dispose();
    this.group.traverse((obj) => {
      if (obj === this.substrate?.group || obj.parent === this.substrate?.group) return;
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      mats.forEach((m) => m.dispose());
    });
    this.group.clear();
    this.dims = null;
  }
}
