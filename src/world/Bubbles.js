import * as THREE from 'three';
import { rand } from '../utils/math.js';

const vertexShader = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
uniform float uScale;
varying float vAlpha;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
  vAlpha = aAlpha;
}`;

const fragmentShader = /* glsl */ `
varying float vAlpha;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0 || vAlpha <= 0.0) discard;
  float rim = smoothstep(0.55, 0.92, r) * (1.0 - smoothstep(0.92, 1.0, r));
  float highlight = smoothstep(0.38, 0.0, length(p - vec2(-0.35, -0.35)));
  float a = (0.1 + rim * 0.85 + highlight * 0.9) * vAlpha;
  vec3 col = mix(vec3(0.72, 0.9, 1.0), vec3(1.0), highlight);
  gl_FragColor = vec4(col, a);
}`;

/**
 * ระบบฟองอากาศ (Points + shader วาดฟองกลมมีขอบ)
 * แหล่งกำเนิดฟอง: หัวทราย หีบสมบัติ ฯลฯ ลงทะเบียนผ่าน addSource()
 */
export class Bubbles {
  constructor(max = 500) {
    this.max = max;
    this.particles = Array.from({ length: max }, () => ({ alive: false, x: 0, y: 0, z: 0, size: 0, speed: 0, phase: 0, wobble: 0 }));
    this.positions = new Float32Array(max * 3);
    this.sizes = new Float32Array(max);
    this.alphas = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { uScale: { value: 500 } };
    this.points = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false }),
    );
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    this.sources = new Map();
    this.waterTop = 6;
    this.ambientTimer = 0;
    this.bounds = null;
  }

  /** ตั้งค่าตามขนาดตู้ */
  setTank(dims, heightAt) {
    this.waterTop = dims.waterTop;
    this.bounds = dims;
    this.heightAt = heightAt;
    this.clear();
  }

  /** ขนาดฟองบนจอขึ้นกับความสูงหน้าจอและมุมกล้อง */
  setViewport(heightPx, fovDeg, pixelRatio) {
    this.uniforms.uScale.value = (heightPx * pixelRatio) / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  addSource(id, { x, y, z, rate = 8, spread = 0.05, burst = 0, burstInterval = 0 }) {
    this.sources.set(id, { x, y, z, rate, spread, burst, burstInterval, acc: Math.random(), burstTimer: burstInterval * Math.random() });
  }

  moveSource(id, x, y, z) {
    const s = this.sources.get(id);
    if (s) Object.assign(s, { x, y, z });
  }

  removeSource(id) {
    this.sources.delete(id);
  }

  emit(x, y, z, count = 1, { spread = 0.05, minSize = 0.04, maxSize = 0.13 } = {}) {
    for (let n = 0; n < count; n++) {
      const p = this.particles.find((q) => !q.alive);
      if (!p) return;
      p.alive = true;
      p.x = x + rand(-spread, spread);
      p.y = y;
      p.z = z + rand(-spread, spread);
      p.size = rand(minSize, maxSize);
      p.speed = 0.7 + p.size * 7 + rand(0, 0.3);
      p.phase = Math.random() * Math.PI * 2;
      p.wobble = rand(1.5, 4);
    }
  }

  clear() {
    this.particles.forEach((p) => (p.alive = false));
    this.alphas.fill(0);
    this.points.geometry.attributes.aAlpha.needsUpdate = true;
  }

  update(dt, time) {
    for (const s of this.sources.values()) {
      s.acc += s.rate * dt;
      while (s.acc >= 1) {
        s.acc -= 1;
        this.emit(s.x, s.y, s.z, 1, { spread: s.spread });
      }
      if (s.burst > 0 && s.burstInterval > 0) {
        s.burstTimer -= dt;
        if (s.burstTimer <= 0) {
          s.burstTimer = s.burstInterval * rand(0.8, 1.3);
          this.emit(s.x, s.y, s.z, s.burst, { spread: s.spread * 2, minSize: 0.06, maxSize: 0.16 });
        }
      }
    }
    // ฟองเล็ก ๆ ผุดจากพื้นทรายเป็นครั้งคราว
    if (this.bounds) {
      this.ambientTimer -= dt;
      if (this.ambientTimer <= 0) {
        this.ambientTimer = rand(0.4, 1.4);
        const x = rand(-this.bounds.w / 2 + 0.5, this.bounds.w / 2 - 0.5);
        const z = rand(-this.bounds.d / 2 + 0.4, this.bounds.d / 2 - 0.4);
        this.emit(x, this.heightAt(x, z) + 0.05, z, 1, { minSize: 0.025, maxSize: 0.06 });
      }
    }

    for (let i = 0; i < this.max; i++) {
      const p = this.particles[i];
      if (p.alive) {
        p.y += p.speed * dt;
        p.x += Math.sin(time * p.wobble + p.phase) * 0.18 * dt;
        p.z += Math.cos(time * p.wobble * 0.8 + p.phase) * 0.12 * dt;
        if (p.y >= this.waterTop) p.alive = false;
      }
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
      this.sizes[i] = p.size;
      // จางลงเมื่อใกล้ผิวน้ำ
      this.alphas[i] = p.alive ? Math.min(1, (this.waterTop - p.y) * 4) : 0;
    }
    const attrs = this.points.geometry.attributes;
    attrs.position.needsUpdate = true;
    attrs.aSize.needsUpdate = true;
    attrs.aAlpha.needsUpdate = true;
  }
}
