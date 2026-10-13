import * as THREE from 'three';
import { sharedUniforms } from '../render/shaderMods.js';
import { seededRandom } from '../utils/math.js';

/**
 * อนุภาคบรรยากาศในน้ำของตู้พรีเมียม (tankType.style.ambient)
 *  - petals : กลีบซากุระสีชมพูค่อย ๆ ร่วงลง หมุนและส่ายไปมา
 *  - aurora : ดวงแสงเรืองนุ่ม ๆ สีออโรราลอยขึ้นช้า ๆ
 *  - stars  : ประกายดาวระยิบระยับลอยนิ่ง ๆ ทั่วตู้
 * การเคลื่อนที่ทั้งหมดคำนวณใน vertex shader จากเวลา (uTime) → ไม่ต้องอัปเดตอะไรบน CPU ทุกเฟรม
 */

const KINDS = {
  petals: { count: 90, size: [0.1, 0.17], fall: -0.16, sway: 0.45, spin: 1.2, twinkle: 0, shape: 1, additive: false, colors: ['#ffc6dc', '#ffb0cc', '#fff0f6'] },
  aurora: { count: 70, size: [0.14, 0.32], fall: 0.07, sway: 0.3, spin: 0, twinkle: 0.6, shape: 2, additive: true, colors: ['#5dffc0', '#6ad8ff', '#c08aff'] },
  stars: { count: 160, size: [0.05, 0.12], fall: 0.02, sway: 0.1, spin: 0, twinkle: 1, shape: 0, additive: true, colors: ['#ffffff', '#ffe9a8', '#c8b4ff'] },
};

const vertexShader = /* glsl */ `
attribute vec4 aSeed; // x = เฟส, y = ความเร็ว, z = ขนาด, w = ลำดับสี
uniform float uTime;
uniform float uScale;
uniform float uBottom;
uniform float uTop;
uniform float uFall;
uniform float uSway;
uniform float uSpin;
uniform float uTwinkle;
uniform vec3 uColors[3];
varying vec3 vColor;
varying float vAlpha;
varying float vRot;
void main() {
  vec3 p = position;
  float range = uTop - uBottom;
  p.y = uBottom + mod(p.y - uBottom + uFall * aSeed.y * uTime, range);
  p.x += sin(uTime * 0.6 * aSeed.y + aSeed.x) * uSway;
  p.z += cos(uTime * 0.45 * aSeed.y + aSeed.x * 1.3) * uSway * 0.6;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSeed.z * uScale / max(-mv.z, 0.1);
  float edge = smoothstep(0.0, 0.5, p.y - uBottom) * smoothstep(0.0, 0.5, uTop - p.y);
  float tw = mix(1.0, 0.25 + 0.75 * pow(0.5 + 0.5 * sin(uTime * (0.8 + aSeed.y * 2.5) + aSeed.x * 7.0), 2.0), uTwinkle);
  vAlpha = edge * tw;
  vRot = aSeed.x + uTime * uSpin * (aSeed.y - 0.5);
  vColor = aSeed.w < 0.5 ? uColors[0] : (aSeed.w < 1.5 ? uColors[1] : uColors[2]);
}`;

const fragmentShader = /* glsl */ `
uniform float uShape;
varying vec3 vColor;
varying float vAlpha;
varying float vRot;
void main() {
  vec2 p = gl_PointCoord * 2.0 - 1.0;
  float a;
  vec3 col = vColor;
  if (uShape < 0.5) {
    // ประกายดาว: แกนสว่าง + แฉกกากบาท
    float r = length(p);
    float core = exp(-r * r * 10.0);
    float flare = max(0.0, 1.0 - abs(p.x) * 10.0) * max(0.0, 1.0 - abs(p.y)) + max(0.0, 1.0 - abs(p.y) * 10.0) * max(0.0, 1.0 - abs(p.x));
    a = clamp(core + flare * 0.6, 0.0, 1.0);
    col = mix(col, vec3(1.0), core * 0.6);
  } else if (uShape < 1.5) {
    // กลีบดอกไม้: วงรีปลายเว้า หมุนตามเวลา
    float c = cos(vRot), s = sin(vRot);
    vec2 q = vec2(c * p.x - s * p.y, s * p.x + c * p.y);
    float d = length(vec2(q.x * 1.6, q.y + 0.15 * q.x * q.x));
    float notch = smoothstep(0.12, 0.0, abs(q.x)) * smoothstep(0.55, 0.85, q.y);
    a = (1.0 - smoothstep(0.82, 0.95, d)) * (1.0 - notch);
    col = mix(col, vec3(1.0, 0.97, 0.98), smoothstep(0.7, -0.3, q.y) * 0.5);
  } else {
    // ดวงแสงนุ่ม ๆ
    float r = length(p);
    a = exp(-r * r * 4.0) * (1.0 - smoothstep(0.85, 1.0, r));
  }
  a *= vAlpha;
  if (a < 0.004) discard;
  gl_FragColor = vec4(col, a);
}`;

const _size = new THREE.Vector2();

export class AmbientMotes {
  /**
   * @param {{w:number, d:number, waterTop:number}} dims ขนาดน้ำในตู้
   * @param {'petals'|'aurora'|'stars'} kind
   */
  constructor(dims, kind) {
    const K = KINDS[kind] ?? KINDS.stars;
    const count = Math.round(K.count * Math.max(1, (dims.w * dims.d) / 120));
    const rnd = seededRandom(kind.length * 0.37 + 0.11);
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (rnd() - 0.5) * (dims.w - 0.8);
      positions[i * 3 + 1] = 0.4 + rnd() * (dims.waterTop - 0.4);
      positions[i * 3 + 2] = (rnd() - 0.5) * (dims.d - 0.6);
      seeds[i * 4] = rnd() * 20;
      seeds[i * 4 + 1] = 0.5 + rnd();
      seeds[i * 4 + 2] = K.size[0] + rnd() * (K.size[1] - K.size[0]);
      seeds[i * 4 + 3] = Math.floor(rnd() * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
    this.uniforms = {
      uTime: sharedUniforms.uTime,
      uScale: { value: 800 },
      uBottom: { value: 0.4 },
      uTop: { value: dims.waterTop - 0.1 },
      uFall: { value: K.fall },
      uSway: { value: K.sway },
      uSpin: { value: K.spin },
      uTwinkle: { value: K.twinkle },
      uShape: { value: K.shape },
      uColors: { value: K.colors.map((c) => new THREE.Color(c)) },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: K.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 3;
    // ขนาดบนจอขึ้นกับความสูงของภาพและมุมกล้อง — คำนวณตอนเรนเดอร์ ใช้ได้ทั้งฉากหลักและภาพตัวอย่างตู้
    this.points.onBeforeRender = (renderer, _scene, camera) => {
      renderer.getDrawingBufferSize(_size);
      this.uniforms.uScale.value = _size.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov ?? 40) / 2));
    };
  }
}
