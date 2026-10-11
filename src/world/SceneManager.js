import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { QUALITY } from '../config.js';
import { clamp } from '../utils/math.js';

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/** renderer, กล้อง, ตัวควบคุมกล้อง, แสง และการปรับขนาดหน้าจอ */
export class SceneManager {
  constructor(canvas, settings) {
    this.canvas = canvas;
    this.settings = settings;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // ตรวจ error ของ shader เฉพาะตอนพัฒนา (บน Windows/D3D มี warning ความแม่นยำจาก shader ของ Three.js เองซึ่งไม่มีผล)
    this.renderer.debug.checkShaderErrors = import.meta.env.DEV;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#24476f');
    this.scene.fog = new THREE.Fog('#1b6aa8', 10, 30);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.scene.environment = this.envMap;
    this.scene.environmentIntensity = 0.45;

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 220);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.screenSpacePanning = true;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.8;
    this.controls.minAzimuthAngle = -1.0;
    this.controls.maxAzimuthAngle = 1.0;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.06;
    this.controls.minPolarAngle = 0.25;

    this.#createLights();

    this.dims = null;
    this.home = { position: new THREE.Vector3(), target: new THREE.Vector3() };
    this.tween = null;
    this.followTarget = null;
    this.lastAspect = 0;
    this.onResize = null;

    this.applyQuality(settings.quality);
    window.addEventListener('resize', () => this.resize());
  }

  #createLights() {
    this.hemi = new THREE.HemisphereLight(0xcfeeff, 0x9c8a66, 1.25);
    // ไฟส่องตู้ด้านบน (ทำเงา)
    this.sun = new THREE.DirectionalLight(0xfff6e6, 2.7);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.sun.shadow.radius = 3;
    // ไฟเติมจากด้านหน้า
    this.fill = new THREE.DirectionalLight(0x9fd6ff, 0.55);
    this.scene.add(this.hemi, this.sun, this.sun.target, this.fill, this.fill.target);
  }

  /** จัดแสงให้พอดีกับขนาดตู้ */
  setupLights(dims) {
    const { w, h, d } = dims;
    this.sun.position.set(w * 0.12, h * 2.6, d * 0.45);
    this.sun.target.position.set(0, 0, 0);
    const r = Math.max(w, d) * 0.62;
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = h * 5;
    cam.updateProjectionMatrix();
    this.fill.position.set(0, h * 0.6, d * 4);
    this.fill.target.position.set(0, h * 0.4, 0);
  }

  applyQuality(name) {
    const q = QUALITY[name] ?? QUALITY.high;
    this.quality = q;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.pixelRatio));
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    if (this.sun.shadow.map) {
      this.sun.shadow.map.dispose();
      this.sun.shadow.map = null;
    }
    // การเปิด/ปิดเงาต้องคอมไพล์ shader ใหม่
    this.scene.traverse((obj) => {
      if (!obj.material) return;
      (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m) => (m.needsUpdate = true));
    });
    this.resize(true);
  }

  /** ตั้งกล้องให้เห็นตู้ทั้งตู้ (มุมมองหลัก) */
  frameTank(dims, { immediate = true } = {}) {
    this.dims = dims;
    const { w, h, d } = dims;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fitW = (w * 0.5 * 1.12) / Math.tan(hFov / 2);
    const fitH = ((h + 1.4) * 0.5 * 1.2) / Math.tan(vFov / 2);
    const dist = d / 2 + Math.max(fitW, fitH);
    this.home.target.set(0, h * 0.44, 0);
    this.home.position.set(0, h * 0.62, dist);
    this.controls.minDistance = Math.max(w, h) * 0.35;
    this.controls.maxDistance = dist * 1.7;
    this.camera.far = dist * 6 + 80;
    this.camera.updateProjectionMatrix();
    this.followTarget = null;
    if (immediate) {
      this.tween = null;
      this.camera.position.copy(this.home.position);
      this.controls.target.copy(this.home.target);
      this.controls.update();
    } else {
      this.flyTo(this.home.position, this.home.target);
    }
  }

  /** มุมมองจากด้านบนเฉียง สำหรับโหมดตกแต่ง */
  decorView() {
    const { w, h, d } = this.dims;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const dist = Math.max((w * 0.5 * 1.25) / Math.tan(hFov / 2), (d * 1.2) / Math.tan(vFov / 2));
    const dir = new THREE.Vector3(0, 0.78, 0.62).normalize();
    const target = new THREE.Vector3(0, h * 0.12, 0);
    this.flyTo(target.clone().addScaledVector(dir, dist + h * 0.3), target);
  }

  flyTo(position, target, duration = 1.0) {
    this.followTarget = null;
    this.tween = {
      fromPos: this.camera.position.clone(),
      toPos: position.clone(),
      fromTarget: this.controls.target.clone(),
      toTarget: target.clone(),
      t: 0,
      duration,
    };
  }

  /** ให้กล้องติดตามวัตถุ (เช่น ปลาที่เลือก) */
  follow(object3d) {
    this.tween = null;
    this.followTarget = object3d;
  }

  stopFollow() {
    this.followTarget = null;
  }

  update(dt) {
    if (this.tween) {
      const tw = this.tween;
      tw.t = Math.min(1, tw.t + dt / tw.duration);
      const e = easeInOut(tw.t);
      this.camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
      this.controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
      if (tw.t >= 1) this.tween = null;
    } else if (this.followTarget) {
      const k = 1 - Math.exp(-3.5 * dt);
      const delta = this.followTarget.position.clone().sub(this.controls.target).multiplyScalar(k);
      this.controls.target.add(delta);
      this.camera.position.add(delta);
    }
    if (this.dims) {
      const t = this.controls.target;
      t.x = clamp(t.x, -this.dims.w / 2, this.dims.w / 2);
      t.y = clamp(t.y, 0, this.dims.h);
      t.z = clamp(t.z, -this.dims.d / 2, this.dims.d / 2);
    }
    this.controls.enabled = !this.tween;
    this.controls.update();
  }

  resize(force = false) {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    const aspectChanged = Math.abs(this.camera.aspect - this.lastAspect) / Math.max(this.lastAspect, 0.01) > 0.12;
    this.lastAspect = this.camera.aspect;
    if (this.dims && (aspectChanged || force) && !this.tween) this.frameTank(this.dims);
    this.onResize?.(width, height);
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
