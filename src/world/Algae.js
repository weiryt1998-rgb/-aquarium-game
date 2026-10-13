import * as THREE from 'three';
import { fbm2, noise2 } from '../utils/noise.js';
import { damp } from '../utils/math.js';

/**
 * คราบตะไคร่น้ำเกาะผนังกระจกด้านในตู้ (หน้า ซ้าย ขวา หลัง) เมื่อน้ำสกปรก
 * ระดับตะไคร่ (0..1) มาจากความสะอาดของน้ำ — ไม่ต้องเก็บในเซฟ ทำความสะอาดตู้แล้วค่อย ๆ จางหายไป
 *
 * ลำดับการขึ้นของตะไคร่ (เหมือนตู้จริง): เริ่มจากมุมล่างของกระจกและแนวผิวน้ำก่อน แล้วลามเป็นดวง ๆ ขึ้นไปทั่วกระจก
 * texture เก็บ "ลำดับการขึ้น" ของแต่ละจุด แล้ว shader ค่อย ๆ เผยคราบตามระดับ → เปลี่ยนระดับได้ทุกเฟรมโดยไม่ต้องวาด texture ใหม่
 */

let texture = null;

/** R = ลำดับการขึ้น (noise เป็นดวง ๆ), G = ความเข้มของสี, B = จุดเล็ก ๆ (สปอร์ตะไคร่) */
function getAlgaeTexture() {
  if (texture) return texture;
  const S = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const v = y / S;
      const i = (y * S + x) * 4;
      d[i] = fbm2(u * 6 + 3.1, v * 6 - 1.7, 4) * 255;
      d[i + 1] = fbm2(u * 22 + 9.3, v * 22, 3) * 255;
      d[i + 2] = noise2(u * 70, v * 70) > 0.82 ? 255 : 0;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  texture = new THREE.CanvasTexture(canvas);
  // สะท้อนกลับไปมาตอนวน → ต่อกันไม่เห็นรอย แม้ noise จะไม่ได้วนรอบพอดี
  texture.wrapS = texture.wrapT = THREE.MirroredRepeatWrapping;
  texture.userData.shared = true;
  return texture;
}

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform float uLevel;
uniform float uMaxAlpha;
uniform float uWaterV;
uniform vec2 uRepeat;
uniform vec2 uOffset;
uniform vec3 uYoung;
uniform vec3 uOld;
uniform vec3 uScum;
varying vec2 vUv;
void main() {
  vec4 t = texture2D(uMap, vUv * uRepeat + uOffset);
  float y = vUv.y / uWaterV;                                      // 0 = ก้นตู้, 1 = ผิวน้ำ
  float corner = 1.0 - smoothstep(0.0, 0.14, min(vUv.x, 1.0 - vUv.x));
  float bottom = 1.0 - smoothstep(0.0, 0.35, y);
  float waterline = smoothstep(0.82, 0.98, y) * (1.0 - smoothstep(0.98, 1.02, y));
  // จุดที่ order ต่ำขึ้นก่อน: มุมกระจก ก้นตู้ และแนวผิวน้ำ
  float order = t.r * 0.75 + 0.35 * y - 0.3 * corner - 0.22 * bottom - 0.25 * waterline;
  float cover = smoothstep(order - 0.05, order + 0.03, uLevel);
  float age = clamp((uLevel - order) * 2.5, 0.0, 1.0);       // ขึ้นมานาน → เข้มและทึบขึ้น
  vec3 col = mix(uYoung, uOld, age) * (0.7 + 0.6 * t.g);
  float alpha = cover * mix(0.28, uMaxAlpha, age) * (0.75 + 0.25 * t.g);
  // สปอร์จุดเล็ก ๆ ก่อนจะเป็นแผ่น
  alpha = max(alpha, t.b * smoothstep(0.08, 0.3, uLevel) * 0.55 * smoothstep(1.0, 0.3, y));
  // คราบสีน้ำตาลเป็นเส้นตามแนวผิวน้ำ
  float scum = (1.0 - smoothstep(0.0, 0.025, abs(y - 1.0))) * smoothstep(0.25, 0.6, uLevel);
  col = mix(col, uScum, scum);
  alpha = max(alpha, scum * 0.85);
  alpha *= 1.0 - smoothstep(1.0, 1.04, y);                       // เหนือผิวน้ำไม่มีตะไคร่
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(col, alpha);
}`;

export class AlgaeFilm {
  /** @param {{w:number, h:number, d:number, waterTop:number}} dims */
  constructor(dims) {
    const { w, h, d, waterTop } = dims;
    this.level = 0;
    this.target = 0;
    this.group = new THREE.Group();
    this.materials = [];
    const map = getAlgaeTexture();
    // [กว้าง, ตำแหน่ง, หมุน, ความทึบสูงสุด, offset ของ texture] — กระจกหน้าบางกว่า ยังมองเห็นปลา
    const panes = [
      [w, [0, h / 2, d / 2 - 0.012], 0, 0.6, [0.13, 0.4]],
      [w, [0, h / 2, -d / 2 + 0.02], 0, 0.85, [0.71, 0.2]],
      [d, [-w / 2 + 0.012, h / 2, 0], Math.PI / 2, 0.8, [0.37, 0.9]],
      [d, [w / 2 - 0.012, h / 2, 0], -Math.PI / 2, 0.8, [0.55, 0.05]],
    ];
    for (const [width, pos, rotY, maxAlpha, offset] of panes) {
      const material = new THREE.ShaderMaterial({
        uniforms: {
          uMap: { value: map },
          uLevel: { value: 0 },
          uMaxAlpha: { value: maxAlpha },
          uWaterV: { value: waterTop / h },
          uRepeat: { value: new THREE.Vector2(width / 5, h / 5) },
          uOffset: { value: new THREE.Vector2(...offset) },
          uYoung: { value: new THREE.Color('#6fae3c') },
          uOld: { value: new THREE.Color('#2f5a22') },
          uScum: { value: new THREE.Color('#6b5a2c') },
        },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, h), material);
      mesh.position.set(...pos);
      mesh.rotation.y = rotY;
      mesh.renderOrder = 4.5; // หลังปลาและผิวน้ำ ก่อนกระจก
      this.group.add(mesh);
      this.materials.push(material);
    }
    this.group.visible = false;
  }

  /** ระดับตะไคร่ที่ควรเป็น (0..1) — ภาพค่อย ๆ เปลี่ยนตามใน update */
  setTarget(level, { immediate = false } = {}) {
    this.target = level;
    if (immediate) this.#apply(level);
  }

  update(dt) {
    if (Math.abs(this.level - this.target) < 0.001) return;
    // ขัดตู้: จางหายภายใน ~1.5 วินาที / ตะไคร่ขึ้น: ตามความสะอาดซึ่งลดลงช้าอยู่แล้ว
    this.#apply(damp(this.level, this.target, this.target < this.level ? 2.5 : 4, dt));
  }

  #apply(level) {
    this.level = level;
    for (const m of this.materials) m.uniforms.uLevel.value = level;
    this.group.visible = level > 0.005;
  }
}
