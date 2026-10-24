import * as THREE from 'three';
import { rand } from '../utils/math.js';

const vertexShader = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
  vAlpha = aAlpha;
  vColor = aColor;
}`;

// ประกายดาว: แกนกลางสว่าง + แฉกแสงรูปกากบาท
const fragmentShader = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  if (vAlpha <= 0.0) discard;
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  float core = exp(-r * r * 9.0);
  float flare = max(0.0, 1.0 - abs(p.x) * 9.0) * max(0.0, 1.0 - abs(p.y)) + max(0.0, 1.0 - abs(p.y) * 9.0) * max(0.0, 1.0 - abs(p.x));
  float a = clamp(core + flare * 0.55, 0.0, 1.0) * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.5), a);
}`;

/**
 * อนุภาคแสงระยิบระยับ (Points + additive blending) — ประกายตอนมีเหตุการณ์ และประกายที่ปลาทิ้งไว้ข้างหลังขณะว่าย (ถ้าโมเดลมี trail)
 * อนุภาคอยู่ในพิกัดโลก (ไม่ติดไปกับตัวปลา) จึงเป็นทางยาวตามเส้นทางที่ว่ายผ่าน
 * ใช้ pool วนรอบ: อนุภาคใหม่ทับอนุภาคที่เก่าที่สุดเมื่อเต็ม
 */
export class Sparkles {
  constructor(max = 700) {
    this.max = max;
    this.particles = Array.from({ length: max }, () => ({ life: 0, maxLife: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, phase: 0 }));
    this.next = 0;
    this.positions = new Float32Array(max * 3);
    this.colors = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.alphas = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aColor', new THREE.BufferAttribute(this.colors, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 500 } };
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.active = 0;
  }

  /** ขนาดบนจอขึ้นกับความสูงหน้าจอและมุมกล้อง (เหมือน Bubbles) */
  setViewport(heightPx, fovDeg, pixelRatio) {
    this.uniforms.uScale.value = (heightPx * pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  /**
   * @param {THREE.Vector3} at ตำแหน่งในโลก
   * @param {THREE.Color} color
   * @param {{ spread?: number, size?: number, life?: number, speed?: number }} opts
   */
  emit(at, color, { spread = 0.1, size = 0.08, life = 1.6, speed = 0.08 } = {}) {
    const p = this.particles[this.next];
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    p.maxLife = p.life = life * rand(0.7, 1.2);
    p.x = at.x + rand(-spread, spread);
    p.y = at.y + rand(-spread, spread);
    p.z = at.z + rand(-spread, spread);
    p.vx = rand(-speed, speed);
    p.vy = rand(-speed, speed) + speed * 0.4; // ลอยขึ้นช้า ๆ
    p.vz = rand(-speed, speed);
    p.size = size * rand(0.5, 1.3);
    p.phase = Math.random() * 20;
    this.colors[i * 3] = color.r;
    this.colors[i * 3 + 1] = color.g;
    this.colors[i * 3 + 2] = color.b;
    this.points.geometry.attributes.aColor.needsUpdate = true;
  }

  /** ประกายระเบิดออกรอบตัว */
  burst(at, colors, count = 40, { size = 0.12, speed = 0.9 } = {}) {
    for (let n = 0; n < count; n++) this.emit(at, colors[n % colors.length], { spread: 0.15, size, life: 2, speed });
  }

  clear() {
    for (const p of this.particles) p.life = 0;
    this.alphas.fill(0);
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }

  update(dt, time) {
    const drag = Math.exp(-dt * 1.6);
    let active = 0;
    for (let i = 0; i < this.max; i++) {
      const p = this.particles[i];
      if (p.life <= 0) {
        this.alphas[i] = 0;
        continue;
      }
      active++;
      p.life -= dt;
      p.vx *= drag;
      p.vy *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const k = Math.max(p.life, 0) / p.maxLife; // 1 → 0
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
      this.sizes[i] = p.size * (0.4 + 0.6 * k);
      // สว่างขึ้นเร็ว จางลงช้า และกระพริบ
      this.alphas[i] = Math.min(1, (1 - k) * 8) * k * (0.65 + 0.35 * Math.sin(time * 14 + p.phase));
    }
    // ไม่มีอนุภาคเหลือ → ไม่ต้องส่งข้อมูลขึ้น GPU ทุกเฟรม
    if (active === 0 && this.active === 0) return;
    this.active = active;
    const attrs = this.points.geometry.attributes;
    attrs.position.needsUpdate = true;
    attrs.aSize.needsUpdate = true;
    attrs.aAlpha.needsUpdate = true;
  }
}
