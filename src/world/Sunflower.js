import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep } from '../utils/math.js';

/**
 * กระถางทานตะวันบนโต๊ะข้างตู้ปลา (ด้านขวา — ด้านซ้ายของจอมีแถบเมนูบังอยู่)
 *
 * มีชีวิต: โตจากต้นกล้า → ต้นอ่อน → ดอกตูม → ดอกบานตามค่า growth, ลู่ลมเบา ๆ, หันดอกตามกล้อง (เหมือนหันตามแสง)
 * ขาดน้ำ = ก้านโค้ง ดอกคอตก · สุขภาพต่ำ = สีซีดเหลือง · ตาย = เหี่ยวแห้งสีน้ำตาล · ดินชุ่มน้ำ = สีเข้ม
 * ท่าทางทั้งหมดค่อย ๆ เปลี่ยน (รดน้ำแล้วต้นไม้ค่อย ๆ ตั้งตรง)
 *
 * ใช้ไฟล์ SUNFLOWER_MODEL ถ้ามี (กระถาง + ต้นไม้ใน mesh เดียว จาก Meshy AI) → ท่าทาง/สีทำใน shader ตามความสูงเหนือดิน (useModel)
 * ไม่มีไฟล์ = โมเดลชั่วคราวจากรูปทรงพื้นฐาน: ก้านเป็นข้อ ๆ ซ้อนกัน (เหมือนกระดูก) ใบและดอกติดกับข้อจึงโค้งตามไปด้วย
 * หน่วยเดียวกับห้อง (1 หน่วย ≈ 5 ซม.) จุดกำเนิด = ก้นกระถาง
 */

export const SUNFLOWER_MODEL = 'models/garden/sunflower.glb';

/**
 * ตำแหน่งในไฟล์โมเดล (พิกัดของไฟล์ สูง 2 หน่วย ก้นกระถาง y = -1 ดอกหัน +Z) — วัดจากไฟล์ที่แปลงด้วย build-model.mjs
 * soil = ผิวดิน · rimR = รัศมีปากกระถาง · potR = รัศมีกระถางด้านนอก · spread = รัศมีใบที่แผ่กว้างที่สุด
 * headFrom = ต่ำกว่านี้ไม่ใช่ดอก · headPivot = คอดอก (ดอกงอกออกจากตรงนี้และก้มคอรอบจุดนี้) · head = กลางดอก
 */
const MODEL = { soil: -0.47, rimR: 0.27, potR: 0.33, spread: 0.54, headFrom: 0.3, headPivot: [0, 0.3, 0.03], head: [0, 0.67, 0.1] };
/** ความสูงทั้งกระถางเมื่อใช้ไฟล์โมเดล (หน่วยห้อง) */
const MODEL_HEIGHT = 7.5;

const TABLE_TOP = -0.32; // ผิวโต๊ะ (ตรงกับ world/Room.js)
const POT_H = 1.75;
const POT_R = 1.02;
const SOIL_Y = 1.62;
const SEGMENTS = 8;
const MAX_STEM = 5.0;
const LEAVES = 7;
const OUTER_PETALS = 15;
const INNER_PETALS = 12;
const DISK_R = 0.52;
const MAX_PARTICLES = 90;
const GRAVITY = 7;

const COLOR = {
  pot: '#c4713f',
  potBand: '#e6c49a',
  saucer: '#a95b33',
  soilDry: '#8d6b4b',
  soilWet: '#3a2618',
  stem: '#5f9c38',
  leaf: '#4c9a34',
  leafSick: '#b0a23c',
  dead: '#6f5131',
  petal: '#ffbf14',
  petalSick: '#cf8a2c',
  petalBud: '#8fb544',
  disk: '#ffffff',
  diskDead: '#5a3a1e',
  sepal: '#4f8a30',
  water: '#7fd4ff',
  fertilizer: '#f1e2b8',
  seed: '#2b1d12',
  dirt: '#6b4a2e',
};

const _v = new THREE.Vector3();
const _c = new THREE.Color();
const _c2 = new THREE.Color();
const tint = (out, a, b, t) => out.set(a).lerp(_c2.set(b), clamp(t, 0, 1));
const f = (n) => n.toFixed(3);

// ── shader ของไฟล์โมเดล ──────────────────────────────────────

/**
 * ต้นไม้ในไฟล์โมเดลเป็น mesh เดียวกับกระถาง → แยกด้วยตำแหน่ง: สูงกว่าผิวดิน (ยกเว้นขอบปากกระถาง) = ต้นไม้
 * vertex: ดอกงอกจากคอดอก (uSfHead) → ทั้งต้นขยายจากผิวดิน (uSfGrow) → ก้มคอ (uSfNod) → ก้านโค้งไปทางหน้า (uSfBend) → ลู่ลม/หันตามกล้อง
 * fragment: ดอกตูมกลีบยังเขียว (uSfBloom) · ป่วย = ซีดเหลือง · ตาย = น้ำตาล · ดินเปียกสีเข้ม · กระถางว่าง = ไม่วาดต้นไม้
 */
function createSunflowerMod(u) {
  // sfPlant ใช้ทั้ง vertex และ fragment (ก้านมีจุดน้อย สามเหลี่ยมยาว → ต้องคำนวณรายพิกเซลจากตำแหน่ง ไม่ใช่ประมาณค่าจากจุด)
  const COMMON = /* glsl */ `
    const float SF_SOIL = ${f(MODEL.soil)};
    const float SF_HEAD_FROM = ${f(MODEL.headFrom)};
    varying vec3 vSfPos;
    float sfPlant(vec3 p) {
      float above = smoothstep(SF_SOIL - 0.005, SF_SOIL + 0.03, p.y);
      float rim = smoothstep(${f(MODEL.rimR - 0.03)}, ${f(MODEL.rimR + 0.02)}, length(p.xz)) * (1.0 - smoothstep(SF_SOIL + 0.04, SF_SOIL + 0.08, p.y));
      return above * (1.0 - rim);
    }`;
  const VERTEX = /* glsl */ `
    ${COMMON}
    uniform float uSfGrow;
    uniform float uSfHead;
    uniform float uSfBend;
    uniform float uSfNod;
    uniform float uSfYaw;
    uniform float uSfSway;
    uniform float uSfTime;
    mat3 sfRotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
    mat3 sfRotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
    mat3 sfRotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
    vec3 sfDeform(vec3 p, out mat3 R) {
      float w = sfPlant(p);
      float wh = smoothstep(SF_HEAD_FROM, SF_HEAD_FROM + 0.06, p.y) * w;
      vec3 pivot = vec3(${MODEL.headPivot.map(f).join(', ')});
      mat3 Rn = sfRotX(uSfNod * wh);
      vec3 q = mix(p, pivot + Rn * ((p - pivot) * uSfHead), wh);
      vec3 base = vec3(0.0, SF_SOIL, 0.0);
      vec3 d = (q - base) * mix(1.0, uSfGrow, w);
      float h = clamp(d.y / (${f(1 - MODEL.soil)} * uSfGrow), 0.0, 1.0);
      float sway = sin(uSfTime * 0.9 + h * 2.0) * uSfSway * h * h;
      R = sfRotY(uSfYaw * smoothstep(0.35, 0.75, h) * w) * sfRotZ(sway * w) * sfRotX(uSfBend * pow(h, 1.6) * w);
      vec3 outP = base + R * d;
      R = R * Rn;
      return outP;
    }`;
  const FRAGMENT = /* glsl */ `
    ${COMMON}
    uniform float uSfBloom;
    uniform float uSfSick;
    uniform float uSfDead;
    uniform float uSfWet;
    uniform float uSfPlanted;`;
  return {
    key: 'sunflower',
    apply(shader) {
      Object.assign(shader.uniforms, u);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERTEX}`)
        .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n{ mat3 sfR; sfDeform(position, sfR); objectNormal = sfR * objectNormal; }')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n{ mat3 sfR; transformed = sfDeform(position, sfR); vSfPos = position; }');
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${FRAGMENT}`).replace(
        '#include <map_fragment>',
        /* glsl */ `#include <map_fragment>
        {
          bool sfIsPlant = sfPlant(vSfPos) > 0.5;
          if (sfIsPlant && uSfPlanted < 0.5) discard;
          vec3 c = diffuseColor.rgb;
          float l = dot(c, vec3(0.299, 0.587, 0.114));
          if (sfIsPlant) {
            float head = smoothstep(SF_HEAD_FROM, SF_HEAD_FROM + 0.06, vSfPos.y);
            float petal = head * smoothstep(0.08, 0.25, c.r - c.b) * smoothstep(0.2, 0.4, c.g);
            c = mix(c, vec3(0.2, 0.42, 0.1) * (0.5 + l), petal * (1.0 - uSfBloom));
            c = mix(c, vec3(l * 1.15, l * 1.0, l * 0.42), uSfSick * 0.7);
            c = mix(c, vec3(l * 0.8, l * 0.55, l * 0.3) + vec3(0.05, 0.025, 0.0), uSfDead);
          } else if (vSfPos.y > SF_SOIL - 0.08 && length(vSfPos.xz) < ${f(MODEL.rimR)}) {
            c *= mix(1.0, 0.5, uSfWet);
          }
          diffuseColor.rgb = c;
        }`,
      );
    },
  };
}

// ── geometry ของโมเดลชั่วคราว ────────────────────────────────

/** ใบทานตะวัน: โคนกว้างรูปหัวใจ ปลายแหลม ห่อเล็กน้อยและโค้งลงที่ปลาย — ยาวตามแกน +Z, หน้าใบหัน +Y */
function leafGeometry({ width = 0.42, cup = 0.07, curl = 0.2 } = {}) {
  const geo = new THREE.PlaneGeometry(1, 1, 6, 10);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) * 2;
    const t = pos.getY(i) + 0.5;
    const w = width * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.9);
    const y = cup * (1 - u * u) * Math.sin(Math.PI * t) - curl * t * t + 0.018 * Math.sin(t * 22) * u * u;
    pos.setXYZ(i, u * w, y, t);
    const shade = 0.72 + 0.28 * (1 - Math.abs(u)) - 0.08 * t; // เส้นกลางใบสว่างกว่า
    col.set([shade, shade, shade * 0.95], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** กลีบดอก: ยาวตามแกน +X ปลายมน-แหลม ห่อไปทาง +Z เล็กน้อย — โคนกลีบสีเข้มกว่าปลาย */
function petalGeometry({ width = 0.15 } = {}) {
  const geo = new THREE.PlaneGeometry(1, 1, 2, 7);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) * 2;
    const t = pos.getY(i) + 0.5;
    const w = width * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.55)), 0.75);
    pos.setXYZ(i, t, u * w, 0.07 * Math.sin(Math.PI * t) - 0.05 * u * u);
    const k = 0.78 + 0.22 * t;
    col.set([k, k * 0.92 + 0.06 * t, k * 0.8], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/** จานดอก: เมล็ดเรียงเป็นเกลียวทานตะวัน (มุมทองคำ) ตรงกลางเขียวอมเหลือง ขอบนอกน้ำตาลเข้ม */
function diskTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.fillStyle = '#3a2210';
  g.fillRect(0, 0, size, size);
  const n = 620;
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(i / n) * (size / 2 - 4);
    const a = i * golden;
    const t = i / n;
    g.fillStyle = t < 0.12 ? '#9a8a2a' : t < 0.3 ? '#6b4a1a' : `hsl(${28 - t * 8}, ${55 - t * 15}%, ${22 - t * 6}%)`;
    g.beginPath();
    g.arc(size / 2 + Math.cos(a) * r, size / 2 + Math.sin(a) * r, 2.2 + t * 2.4, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function diskGeometry() {
  const geo = new THREE.CircleGeometry(DISK_R, 40, 0, Math.PI * 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const r = Math.hypot(pos.getX(i), pos.getY(i)) / DISK_R;
    pos.setZ(i, 0.08 * (1 - r * r)); // นูนตรงกลาง
  }
  geo.computeVertexNormals();
  return geo;
}

/** กระถางดินเผา: ปากบานมีขอบหนา */
function potGeometry() {
  const p = [
    [0, 0.02],
    [0.74, 0.02],
    [0.78, 0.08],
    [0.97, 1.42],
    [1.1, 1.44],
    [1.13, 1.52],
    [1.13, POT_H],
    [1.04, POT_H + 0.02],
    [0.98, POT_H - 0.1],
    [0.9, SOIL_Y - 0.25],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  return new THREE.LatheGeometry(p, 28);
}

function iconTexture(emoji) {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const g = canvas.getContext('2d');
  g.shadowColor = 'rgba(0,0,0,0.35)';
  g.shadowBlur = 8;
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.beginPath();
  g.arc(size / 2, size / 2 - 4, 46, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(size / 2 - 12, size / 2 + 36);
  g.lineTo(size / 2, size / 2 + 56);
  g.lineTo(size / 2 + 12, size / 2 + 36);
  g.fill();
  g.shadowBlur = 0;
  g.font = '60px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, size / 2, size / 2 - 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, metalness: 0, fog: false, ...extra });

// ── ต้นทานตะวัน ─────────────────────────────────────────────

export class Sunflower {
  constructor(scene) {
    this.group = new THREE.Group();
    this.group.name = 'sunflower';
    scene.add(this.group);
    this.scale = 1;
    this.box = new THREE.Box3();
    this.time = 0;
    /** ขนาดกระถาง/ต้นไม้ของโมเดลที่ใช้อยู่ (โมเดลชั่วคราว หรือไฟล์ — ดู useModel) */
    this.soilY = SOIL_Y;
    this.potR = POT_R;
    this.spread = 1.5;
    this.plantHeight = MAX_STEM + 1.6;
    this.model = null;

    /** สถานะเป้าหมาย (จาก show) และค่าที่แสดงอยู่ (ค่อย ๆ เข้าหาเป้าหมาย) */
    this.target = { planted: false, growth: 0, wilt: 0, sick: 0, dead: 0, wet: 0, ripe: 0 };
    this.vis = { ...this.target };
    this.yaw = 0;

    this.procedural = new THREE.Group();
    this.group.add(this.procedural);
    this.#buildPot();
    this.#buildPlant();
    this.#buildTools();
    this.#buildParticles();
    this.badge = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false, fog: false }));
    this.badge.scale.setScalar(0.95);
    this.badge.visible = false;
    this.badgeIcon = null;
    this.badgeTextures = new Map();
    this.group.add(this.badge);
    this.#applyVisuals(0);
  }

  /**
   * ใช้ไฟล์โมเดลแทนโมเดลชั่วคราว (เรียกครั้งเดียวหลังโหลดไฟล์เสร็จ)
   * @param {THREE.Object3D} scene สำเนาจาก AssetLoader.instantiate
   */
  useModel(scene) {
    if (this.model) return;
    const k = MODEL_HEIGHT / 2;
    const uniforms = {
      uSfGrow: { value: 1 },
      uSfHead: { value: 1 },
      uSfBend: { value: 0 },
      uSfNod: { value: 0 },
      uSfYaw: { value: 0 },
      uSfSway: { value: 0 },
      uSfTime: { value: 0 },
      uSfBloom: { value: 1 },
      uSfSick: { value: 0 },
      uSfDead: { value: 0 },
      uSfWet: { value: 0 },
      uSfPlanted: { value: 1 },
    };
    const mod = createSunflowerMod(uniforms);
    scene.traverse((obj) => {
      if (!obj.isMesh) return;
      obj.castShadow = obj.receiveShadow = false;
      obj.frustumCulled = false; // shader ย่อ/งอต้นไม้ → ขอบเขตเดิมใช้ตัดทิ้งไม่ได้
      for (const m of Array.isArray(obj.material) ? obj.material : [obj.material]) {
        // ไฟล์จาก Meshy มีค่าโลหะทำให้จานดอกสะท้อนแสงเป็นสีเทา → ใช้ผิวด้านแบบต้นไม้จริง
        m.metalness = 0;
        m.metalnessMap = null;
        m.roughnessMap = null;
        m.roughness = 0.85;
        m.fog = false;
        m.side = THREE.DoubleSide;
        const prev = m.onBeforeCompile;
        m.onBeforeCompile = (shader, renderer) => {
          prev?.call(m, shader, renderer);
          mod.apply(shader);
        };
        m.customProgramCacheKey = () => 'sunflower';
        m.needsUpdate = true;
      }
    });
    const holder = new THREE.Group();
    holder.scale.setScalar(k);
    holder.position.y = k; // ก้นกระถางที่ y = 0
    holder.add(scene);
    this.group.add(holder);
    this.model = { holder, uniforms };
    this.procedural.visible = false;
    this.soilY = (MODEL.soil + 1) * k;
    this.potR = MODEL.potR * k;
    this.spread = MODEL.spread * k;
    this.plantHeight = (1 - MODEL.soil) * k;
    this.#updateBox();
  }

  #buildPot() {
    const pot = new THREE.Mesh(potGeometry(), mat(COLOR.pot, { roughness: 0.9, side: THREE.DoubleSide }));
    const band = new THREE.Mesh(new THREE.CylinderGeometry(1.115, 1.115, 0.09, 28, 1, true), mat(COLOR.potBand, { roughness: 0.8 }));
    band.position.y = 1.6;
    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 0.86, 0.14, 28), mat(COLOR.saucer, { roughness: 0.9 }));
    saucer.position.y = 0.07;
    this.soilMat = mat(COLOR.soilDry, { roughness: 1 });
    const soilGeo = new THREE.CircleGeometry(0.97, 28).rotateX(-Math.PI / 2);
    const sp = soilGeo.attributes.position;
    for (let i = 0; i < sp.count; i++) sp.setY(i, 0.06 * (1 - Math.hypot(sp.getX(i), sp.getZ(i)) / 0.97) + Math.sin(i * 12.9898) * 0.01);
    soilGeo.computeVertexNormals();
    const soil = new THREE.Mesh(soilGeo, this.soilMat);
    soil.position.y = SOIL_Y;
    // ก้อนดินเล็ก ๆ บนผิวดิน
    const pebbles = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.06, 0), mat('#5a4030', { roughness: 1 }), 9);
    const m = new THREE.Matrix4();
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      const r = 0.3 + ((i * 37) % 10) / 16;
      m.makeTranslation(Math.cos(a) * r, SOIL_Y + 0.05, Math.sin(a) * r);
      pebbles.setMatrixAt(i, m);
    }
    this.procedural.add(pot, band, saucer, soil, pebbles);
  }

  #buildPlant() {
    this.stemMat = mat(COLOR.stem, { roughness: 0.7 });
    this.leafMat = mat(COLOR.leaf, { vertexColors: true, side: THREE.DoubleSide, roughness: 0.65 });
    this.petalMat = mat(COLOR.petal, { vertexColors: true, side: THREE.DoubleSide, roughness: 0.55 });
    this.sepalMat = mat(COLOR.sepal, { side: THREE.DoubleSide, roughness: 0.7 });
    this.diskMat = mat(COLOR.disk, { map: diskTexture(), roughness: 0.95 });

    this.root = new THREE.Group();
    this.root.position.y = SOIL_Y;
    this.procedural.add(this.root);

    // ก้าน: ข้อซ้อนกัน SEGMENTS ข้อ (เรียวขึ้นไปด้านบน)
    this.joints = [];
    let parent = this.root;
    for (let i = 0; i < SEGMENTS; i++) {
      const joint = new THREE.Group();
      const r0 = lerp(0.13, 0.075, i / SEGMENTS);
      const r1 = lerp(0.13, 0.075, (i + 1) / SEGMENTS);
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, 1, 8, 1).translate(0, 0.5, 0), this.stemMat);
      joint.add(seg);
      joint.userData.seg = seg;
      parent.add(joint);
      this.joints.push(joint);
      parent = joint;
    }
    this.top = new THREE.Group();
    parent.add(this.top);

    // ใบ: เรียงสลับรอบก้านด้วยมุมทองคำ ใบล่างใหญ่กว่าใบบน
    const leafGeo = leafGeometry();
    const petioleGeo = new THREE.CylinderGeometry(0.025, 0.035, 1, 5).rotateX(Math.PI / 2).translate(0, 0, 0.5);
    this.leaves = [];
    for (let i = 0; i < LEAVES; i++) {
      const holder = new THREE.Group();
      holder.rotation.y = i * 2.4 + 0.7;
      const pivot = new THREE.Group();
      const petiole = new THREE.Mesh(petioleGeo, this.stemMat);
      petiole.scale.set(1, 1, 0.28);
      const leaf = new THREE.Mesh(leafGeo, this.leafMat);
      leaf.position.z = 0.26;
      pivot.add(petiole, leaf);
      holder.add(pivot);
      this.joints[Math.min(SEGMENTS - 1, i + 1)].add(holder);
      this.leaves.push({ holder, pivot, size: lerp(1.6, 0.9, i / (LEAVES - 1)), from: 0.12 + i * 0.075, twist: ((i * 53) % 7) / 7 - 0.5 });
    }

    // ใบเลี้ยงคู่แรกของต้นกล้า (หายไปเมื่อต้นโต)
    const cotGeo = leafGeometry({ width: 0.55, cup: 0.12, curl: 0.05 });
    this.cotyledons = [0, Math.PI].map((a) => {
      const holder = new THREE.Group();
      holder.rotation.y = a + Math.PI / 2;
      const pivot = new THREE.Group();
      pivot.add(new THREE.Mesh(cotGeo, this.leafMat));
      holder.add(pivot);
      this.top.add(holder);
      return { holder, pivot };
    });

    // ดอก: หันหน้าไป +Z (ทางกล้อง) — คอดอกต่อกับยอดก้านที่ด้านหลังดอก · หันซ้ายขวาก่อนแล้วจึงก้มคอ (YXZ)
    this.headPivot = new THREE.Group();
    this.headPivot.rotation.order = 'YXZ';
    this.top.add(this.headPivot);
    this.head = new THREE.Group();
    this.head.position.set(0, 0.12, 0.2);
    this.headPivot.add(this.head);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(DISK_R + 0.02, 0.2, 0.26, 24, 1).rotateX(Math.PI / 2).translate(0, 0, -0.13), this.sepalMat);
    this.disk = new THREE.Mesh(diskGeometry(), this.diskMat);
    this.disk.position.z = 0.01;
    this.head.add(back, this.disk);

    const petalGeo = petalGeometry();
    const sepalGeo = petalGeometry({ width: 0.2 });
    this.petals = [];
    const ring = (count, radius, length, z, offset, list, material, geo) => {
      for (let i = 0; i < count; i++) {
        const spin = new THREE.Group();
        spin.rotation.z = (i / count) * Math.PI * 2 + offset;
        const tilt = new THREE.Group();
        tilt.position.set(radius, 0, z);
        const mesh = new THREE.Mesh(geo, material);
        mesh.scale.set(length, 1, 1);
        tilt.add(mesh);
        spin.add(tilt);
        this.head.add(spin);
        list.push({ tilt, mesh, jitter: ((i * 7919) % 13) / 13 - 0.5, inner: z > 0 });
      }
    };
    this.sepals = [];
    ring(14, DISK_R - 0.1, 0.42, -0.1, 0.1, this.sepals, this.sepalMat, sepalGeo);
    ring(OUTER_PETALS, DISK_R - 0.06, 0.82, -0.02, 0, this.petals, this.petalMat, petalGeo);
    ring(INNER_PETALS, DISK_R - 0.1, 0.66, 0.02, Math.PI / INNER_PETALS, this.petals, this.petalMat, petalGeo);
  }

  /** บัวรดน้ำ (ฝักบัวด้านหน้าพวย) และถุงปุ๋ย — โผล่มาข้างกระถางตอนผู้เล่นดูแล */
  #buildTools() {
    const can = new THREE.Group();
    const metal = mat('#3ea6cc', { metalness: 0.45, roughness: 0.4 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.78, 20), metal);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.42, 0.12, 20), metal);
    lid.position.y = 0.45;
    const spoutDir = new THREE.Vector3(1, 0.85, 0).normalize();
    const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.08, 1.05, 8), metal);
    spout.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), spoutDir);
    spout.position.set(0.32, -0.05, 0).addScaledVector(spoutDir, 0.52);
    const rose = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.06, 0.13, 14), mat('#d9b44a', { metalness: 0.6, roughness: 0.35 }));
    rose.quaternion.copy(spout.quaternion);
    rose.position.set(0.32, -0.05, 0).addScaledVector(spoutDir, 1.08);
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.05, 8, 18, Math.PI), metal);
    handle.rotation.z = Math.PI / 2;
    handle.position.set(-0.42, 0.1, 0);
    can.add(body, lid, spout, rose, handle);
    can.userData.tip = rose.position.clone().addScaledVector(spoutDir, 0.06);
    can.userData.dir = spoutDir;

    const bag = new THREE.Group();
    const paper = mat('#e9d6a6', { roughness: 0.95 });
    const sack = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.86, 0.34), paper);
    const label = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.3, 0.35), mat('#4f9a3a', { roughness: 0.8 }));
    const fold = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.12, 0.2), paper);
    fold.position.y = 0.48;
    bag.add(sack, label, fold);
    bag.userData.yaw = 0.35; // เอียงให้เห็นป้ายหน้าถุง
    bag.userData.tip = new THREE.Vector3(0.32, 0.5, 0);
    bag.userData.dir = new THREE.Vector3(1, 0.3, 0).normalize();

    for (const t of [can, bag]) {
      t.visible = false;
      this.group.add(t);
    }
    this.tools = { water: can, fertilize: bag };
    /** การดูแลที่กำลังเล่นภาพอยู่ { kind, t, obj } */
    this.action = null;
  }

  #buildParticles() {
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3).fill(-1e4);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.11, vertexColors: true, transparent: true, depthWrite: false, fog: false }));
    this.points.frustumCulled = false;
    this.group.add(this.points);
    this.parts = Array.from({ length: MAX_PARTICLES }, () => ({ life: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), soak: true }));
    this.nextPart = 0;
    this.emitCarry = 0;
  }

  // ── จัดวาง / สถานะ ────────────────────────────────────────

  /**
   * วางบนโต๊ะทางขวาของตู้: ใบที่แผ่กว้างไม่ชนกรอบตู้ และกระถางไม่ล้นขอบโต๊ะ (โต๊ะยื่นจากตู้ข้างละ 4 หน่วย)
   * ตู้ใหญ่ขยายต้นไม้ขึ้นเล็กน้อยให้ยังดูสมส่วน
   */
  place(dims) {
    const s = clamp(dims.h / 6.5, 1, 1.15);
    this.scale = s;
    this.group.scale.setScalar(s);
    const gap = Math.max(this.spread, this.potR) * s + 0.2;
    this.group.position.set(dims.w / 2 + Math.min(gap, 3.95 - this.potR * s), TABLE_TOP, Math.min(0.4, dims.d * 0.1));
    this.#updateBox();
  }

  /**
   * สถานะต้นไม้ล่าสุด (ค่าจาก shared/garden.js sunflowerAt) หรือ null = กระถางว่าง
   * @param {{ growth:number, water:number, health:number } | null} s
   * @param {{ ripe?: boolean, thirstyBelow?: number, immediate?: boolean }} options ripe = เมล็ดพร้อมเก็บ
   */
  show(s, { ripe = false, thirstyBelow = 25, immediate = false } = {}) {
    const t = this.target;
    t.planted = !!s;
    if (s) {
      const dead = s.health <= 0;
      t.growth = s.growth;
      t.dead = dead ? 1 : 0;
      // คอตก/ใบลู่: ดินแห้ง (ยิ่งแห้งยิ่งลู่) หรือสุขภาพต่ำ
      const thirst = smoothstep(thirstyBelow, 0, s.water);
      t.wilt = dead ? 1 : clamp(Math.max(thirst * 0.6, (75 - s.health) / 75), 0, 1);
      t.sick = dead ? 1 : smoothstep(80, 15, s.health);
      t.wet = s.water / 100;
      t.ripe = ripe && !dead ? 1 : 0;
    }
    if (immediate) Object.assign(this.vis, t);
  }

  /** ไอคอนลอยเหนือต้นไม้ (เช่น 💧 ขาดน้ำ) — null = ซ่อน */
  setBadge(icon) {
    if (icon === this.badgeIcon) return;
    this.badgeIcon = icon;
    this.badge.visible = !!icon;
    if (!icon) return;
    if (!this.badgeTextures.has(icon)) this.badgeTextures.set(icon, iconTexture(icon));
    this.badge.material.map = this.badgeTextures.get(icon);
    this.badge.material.needsUpdate = true;
  }

  /** แตะโดนกระถาง/ต้นไม้ไหม */
  pick(ray) {
    return ray.intersectsBox(this.box);
  }

  /** ตำแหน่งดอก (หรือผิวดินถ้ายังไม่ได้ปลูก) ในโลก — ใช้แสดงตัวเลขลอย */
  flowerPosition(out = new THREE.Vector3()) {
    if (!this.target.planted) return this.group.localToWorld(out.set(0, this.soilY + 0.5, 0));
    return this.group.localToWorld(this.#headLocal(out));
  }

  /** เล่นภาพการดูแล: 'water' | 'fertilize' | 'harvest' | 'plant' */
  play(kind) {
    if (this.action?.obj) this.action.obj.visible = false;
    const obj = this.tools[kind] ?? null;
    this.action = { kind, t: 0, obj, duration: obj ? 2.4 : 0.6 };
    if (obj) obj.visible = true;
    if (kind === 'harvest') this.#burst(this.#headLocal(_v), COLOR.seed, 26, 1.6, 2.2);
    if (kind === 'plant') {
      this.#burst(_v.set(0, this.soilY + 0.05, 0), COLOR.dirt, 22, 0.9, 1.6);
      for (let i = 0; i < 3; i++) this.#emit(_v.set((i - 1) * 0.15, this.soilY + 1.6 + i * 0.2, 0), new THREE.Vector3(0, -0.5, 0), COLOR.seed, 1.4);
    }
  }

  // ── ทุกเฟรม ───────────────────────────────────────────────

  update(dt, time, camera) {
    this.time = time;
    const v = this.vis;
    const t = this.target;
    v.planted = t.planted;
    v.growth = damp(v.growth, t.growth, 1.2, dt);
    v.wilt = damp(v.wilt, t.wilt, 0.9, dt);
    v.sick = damp(v.sick, t.sick, 0.8, dt);
    v.dead = damp(v.dead, t.dead, 0.6, dt);
    v.wet = damp(v.wet, t.wet, 1.5, dt);
    v.ripe = damp(v.ripe, t.ripe, 2, dt);

    // หันดอกตามกล้องช้า ๆ (ดอกทานตะวันหันหาแสง) — ต้นที่เหี่ยวไม่หัน
    if (camera) {
      const local = this.group.worldToLocal(_v.copy(camera.position));
      const want = clamp(Math.atan2(local.x, local.z), -0.7, 0.7) * (1 - v.wilt);
      this.yaw = damp(this.yaw, want, 0.4, dt);
    }
    this.#applyVisuals(time);
    this.#updateAction(dt);
    this.#updateParticles(dt);
  }

  /** ขนาดต้นไม้ตามการเติบโต (1 = โตเต็มที่) / ขนาดดอก (0 = ยังไม่ออกดอก) / ดอกบาน */
  #growthShape(g) {
    return { size: lerp(0.14, 1, smoothstep(0, 0.95, g)), head: smoothstep(0.62, 1, g), bloom: smoothstep(0.88, 1, g) };
  }

  #applyVisuals(time) {
    if (this.model) this.#applyModel(time);
    else this.#applyProcedural(time);
  }

  #applyModel(time) {
    const v = this.vis;
    const u = this.model.uniforms;
    const shape = this.#growthShape(v.growth);
    u.uSfPlanted.value = v.planted ? 1 : 0;
    u.uSfGrow.value = shape.size;
    u.uSfHead.value = Math.max(0.001, shape.head);
    u.uSfBloom.value = shape.bloom;
    u.uSfBend.value = v.wilt * 0.85;
    u.uSfNod.value = v.wilt * 1.1 - 0.05;
    u.uSfYaw.value = this.yaw;
    u.uSfSway.value = 0.012 + 0.02 * (1 - v.wilt);
    u.uSfTime.value = time;
    u.uSfSick.value = v.sick;
    u.uSfDead.value = v.dead;
    u.uSfWet.value = smoothstep(0, 0.6, v.wet);
    this.#placeBadge(v.planted ? this.soilY + this.plantHeight * shape.size * (1 - v.wilt * 0.3) + 0.7 : this.soilY + 1.2);
  }

  #applyProcedural(time) {
    const v = this.vis;
    this.root.visible = v.planted;
    tint(this.soilMat.color, COLOR.soilDry, COLOR.soilWet, smoothstep(0, 0.6, v.wet));
    if (!v.planted) {
      this.#placeBadge(SOIL_Y + 1.2);
      return;
    }
    const g = v.growth;
    const sick = Math.max(v.sick, v.dead);
    // สีตามสุขภาพ: เขียวสด → เหลืองซีด → น้ำตาลแห้ง (ตาย)
    tint(this.leafMat.color, COLOR.leaf, COLOR.leafSick, sick).lerp(_c.set(COLOR.dead), v.dead);
    tint(this.stemMat.color, COLOR.stem, COLOR.leafSick, sick * 0.8).lerp(_c.set(COLOR.dead), v.dead);
    this.sepalMat.color.copy(this.stemMat.color);
    this.diskMat.color.set(COLOR.disk).lerp(_c.set(COLOR.diskDead), v.dead * 0.7).multiplyScalar(1 - v.ripe * 0.25);

    // ก้าน: ยาวและหนาขึ้นตามการเติบโต · โค้งลง (ไปทางกล้อง) ตอนเหี่ยว · ลู่ลมเบา ๆ
    const stemLen = lerp(0.2, MAX_STEM, Math.pow(smoothstep(0.02, 0.95, g), 0.9));
    const seg = stemLen / SEGMENTS;
    const thick = lerp(0.35, 1, smoothstep(0, 0.7, g));
    const bend = v.wilt * 0.95;
    const sway = 0.012 + 0.01 * (1 - v.wilt);
    for (let i = 0; i < SEGMENTS; i++) {
      const j = this.joints[i];
      const k = (i + 1) / SEGMENTS;
      if (i > 0) j.position.y = seg;
      j.userData.seg.scale.set(thick, seg, thick);
      j.rotation.x = 0.015 + (bend / SEGMENTS) * (0.3 + 1.4 * k);
      j.rotation.z = Math.sin(time * 0.9 + i * 0.35) * sway * k;
    }
    this.top.position.y = seg;
    this.root.rotation.y = this.yaw * 0.25;

    // ใบ: ค่อย ๆ แตกจากล่างขึ้นบน · ชี้เฉียงขึ้นตอนสดชื่น ห้อยลงตอนขาดน้ำ
    for (const leaf of this.leaves) {
      const grow = smoothstep(leaf.from, leaf.from + 0.2, g);
      leaf.holder.visible = grow > 0.01;
      leaf.pivot.scale.setScalar(Math.max(0.001, grow * leaf.size * thick));
      const up = lerp(0.45, -0.95, v.wilt) + Math.sin(time * 1.3 + leaf.from * 20) * 0.03;
      leaf.pivot.rotation.set(-up, 0, leaf.twist * 0.5);
    }
    const cot = 1 - smoothstep(0.18, 0.42, g);
    for (const c of this.cotyledons) {
      c.holder.visible = cot > 0.01;
      c.pivot.scale.setScalar(Math.max(0.001, cot * 0.42));
      c.pivot.rotation.x = -lerp(0.55, -0.6, v.wilt);
    }

    // ดอก: ตูมตั้งแต่ g 0.62 บานเต็มที่ g = 1 · คอตกตอนเหี่ยว · หันตามกล้อง
    const { head: headSize, bloom } = this.#growthShape(g);
    this.head.visible = headSize > 0.01;
    this.head.scale.setScalar(Math.max(0.001, lerp(0.28, 1, headSize)));
    this.headPivot.rotation.set(lerp(-0.22, 1.25, v.wilt) + Math.sin(time * 0.7) * 0.02, this.yaw * 0.75, 0);
    const open = smoothstep(0.9, 1, g) * (1 - v.dead);
    tint(this.petalMat.color, COLOR.petalBud, COLOR.petal, bloom).lerp(_c.set(COLOR.petalSick), sick).lerp(_c.set(COLOR.dead), v.dead);
    for (const p of this.petals) {
      // ตูม = กลีบหุบไปด้านหน้าคลุมจานดอก · บาน = แผ่ออกเอนหลังเล็กน้อย · เหี่ยว = ลู่ไปด้านหลัง · ตาย = ร่วงหายไป
      const closed = p.inner ? 1.45 : 1.3;
      p.tilt.rotation.y = -lerp(closed, -0.12 - p.jitter * 0.1, open) + v.wilt * 0.9 + Math.sin(time * 2 + p.jitter * 9) * 0.015;
      p.mesh.scale.set(lerp(0.55, 0.82 + p.jitter * 0.08, bloom) * (1 - v.dead * 0.85), 1, 1);
      p.mesh.visible = v.dead < 0.97;
    }
    for (const s of this.sepals) s.tilt.rotation.y = -lerp(1.15, -0.55, open) + v.wilt * 0.4;

    this.#placeBadge(SOIL_Y + stemLen * (1 - v.wilt * 0.35) + 1.55 * headSize + 0.9);
  }

  /** กลางดอกในพิกัดของกระถาง */
  #headLocal(out) {
    if (!this.model) return this.group.worldToLocal(this.head.getWorldPosition(out));
    const k = MODEL_HEIGHT / 2;
    const size = this.#growthShape(this.vis.growth).size;
    return out.set(MODEL.head[0] * k, this.soilY + (MODEL.head[1] - MODEL.soil) * k * size, MODEL.head[2] * k * size);
  }

  #placeBadge(y) {
    if (!this.badge.visible) return;
    this.badge.position.set(0, y + Math.sin(this.time * 2.2) * 0.08, 0.3);
  }

  #updateBox() {
    this.group.updateMatrixWorld(true);
    const s = this.scale;
    const p = this.group.position;
    const r = Math.max(this.potR + 0.3, this.spread * 0.8) * s;
    this.box.min.set(p.x - r, p.y, p.z - r);
    this.box.max.set(p.x + r, p.y + (this.soilY + this.plantHeight + 0.3) * s, p.z + r + 0.3 * s);
  }

  // ── ภาพการดูแล ────────────────────────────────────────────

  #updateAction(dt) {
    const a = this.action;
    if (!a) return;
    a.t += dt;
    const obj = a.obj;
    if (obj) {
      // ลอยเข้ามาด้านหน้าเยื้องขวาของกระถาง (ฝั่งที่ห่างจากตู้ ยังอยู่ในจอ) หันพวยเข้ากลางกระถาง → เอียงเท → ลอยออก
      const enter = smoothstep(0, 0.35, a.t);
      const leave = smoothstep(a.duration - 0.45, a.duration, a.t);
      const tilt = smoothstep(0.25, 0.6, a.t) * (1 - leave);
      obj.scale.setScalar(Math.max(0.001, enter * (1 - leave)));
      obj.position.set(this.potR * 0.9 + 0.3 + (1 - enter) * 0.6, this.soilY + 2 + (1 - enter) * 0.5 + leave * 0.4, this.potR * 0.7);
      obj.rotation.set(0, Math.PI + (obj.userData.yaw ?? 0), -tilt * (a.kind === 'water' ? 0.75 : 1.5));
      if (tilt > 0.5) {
        this.emitCarry += dt * (a.kind === 'water' ? 45 : 30);
        obj.updateMatrix();
        while (this.emitCarry >= 1) {
          this.emitCarry -= 1;
          const tip = obj.userData.tip.clone().applyMatrix4(obj.matrix);
          const dir = obj.userData.dir.clone().applyQuaternion(obj.quaternion);
          const vel = dir.multiplyScalar(a.kind === 'water' ? 1.3 : 0.9).add(new THREE.Vector3((Math.random() - 0.5) * 0.4, Math.random() * 0.2, (Math.random() - 0.5) * 0.4));
          this.#emit(tip, vel, a.kind === 'water' ? COLOR.water : COLOR.fertilizer, 2);
        }
      }
    }
    if (a.t >= a.duration) {
      if (obj) obj.visible = false;
      this.action = null;
      this.emitCarry = 0;
    }
  }

  #emit(p, v, color, life, soak = true) {
    const i = this.nextPart;
    this.nextPart = (i + 1) % MAX_PARTICLES;
    const part = this.parts[i];
    part.p.copy(p);
    part.v.copy(v);
    part.life = life;
    part.soak = soak;
    _c.set(color);
    this.pCol.set([_c.r, _c.g, _c.b], i * 3);
  }

  /** กระจายอนุภาคออกรอบจุด (เมล็ดดีดออกจากดอก / ดินกระเด็นตอนปลูก) */
  #burst(at, color, count, speed, life) {
    const origin = at.clone();
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const vel = new THREE.Vector3(Math.cos(a) * speed * (0.4 + Math.random() * 0.6), speed * (0.6 + Math.random()), Math.sin(a) * speed * 0.5 + 0.3);
      this.#emit(origin, vel, color, life * (0.7 + Math.random() * 0.3), false);
    }
  }

  #updateParticles(dt) {
    let any = false;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const part = this.parts[i];
      if (part.life <= 0) continue;
      any = true;
      part.life -= dt;
      part.v.y -= GRAVITY * dt;
      part.p.addScaledVector(part.v, dt);
      // ตกถึงผิวดินในกระถาง → ซึมหายไป (น้ำ/ปุ๋ย) · ตกถึงโต๊ะ → หายไป
      const inPot = Math.hypot(part.p.x, part.p.z) < this.potR - 0.05;
      if ((inPot && part.p.y < this.soilY + 0.04 && part.soak) || part.p.y < 0) part.life = 0;
      if (part.life <= 0) this.pPos[i * 3 + 1] = -1e4;
      else this.pPos.set([part.p.x, part.p.y, part.p.z], i * 3);
    }
    if (any || this.particlesDirty) {
      this.points.geometry.attributes.position.needsUpdate = true;
      this.points.geometry.attributes.color.needsUpdate = true;
    }
    this.particlesDirty = any;
  }
}
