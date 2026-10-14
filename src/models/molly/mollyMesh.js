import * as THREE from 'three';
import { applyShaderMods, causticsMod } from '../../render/shaderMods.js';
import { createMollySwimMod, createMollySwimUniforms } from './mollySwim.js';

/**
 * ปลาสอดจากไฟล์โมเดล public/models/fish/molly.glb (แปลงจากโมเดล Meshy ด้วย scripts/build-molly-model.mjs)
 *
 * ใช้รูปทรง ลายเกล็ด และก้านครีบจากไฟล์ แต่ "ย้อมสีใหม่" ใน fragment shader ตามชุดสี (variants.js หรือยีนลูกผสม)
 *  - ความสว่างของเท็กซ์เจอร์เดิม = เงาเกล็ด/ก้านครีบ  ส่วนสีส้มในเท็กซ์เจอร์ = ลายด่าง (ใช้กับชั้นลายที่ตั้ง patches: true)
 *  - สีตัว หลัง ท้อง หัว ปาก ครีบ คำนวณจากตำแหน่งบนตัวปลา (ระบบพิกัดเดียวกับ mollyShape.js)
 *  - ลายจุดแต่ละชั้นสุ่มในพื้นที่ 3 มิติ (ไม่มีรอยต่อ UV) ลูกผสมแต่ละตัวใช้ seed ของตัวเอง
 * ไฟล์มี attribute _FIN (ชนิดครีบ, น้ำหนัก) ให้ mollySwim.js ขยับลำตัวและครีบได้เหมือนโมเดลที่สร้างด้วยโค้ด
 * และ _EYE (1 = ตา ใช้สีจากเท็กซ์เจอร์เดิม)
 */

/** พื้นที่ผิวลำตัวและครีบโดยประมาณ (หน่วยลำตัว²) ใช้แปลงจำนวนจุดของชุดสีเป็นขนาดช่องสุ่ม */
const BODY_AREA = 1.4;
const FIN_AREA = 0.6;
/** finCount ในชุดสีคือจำนวนจุดต่อครีบ 1 ชิ้น (texture ครีบของโมเดลเดิม) → คูณจำนวนครีบที่มองเห็น */
const FIN_PIECES = 5;
const MAX_LAYERS = 3;
/** ชดเชยจุดที่ถูกตัดทิ้งตามความหนาแน่นหลัง/ท้อง และกลุ่มจุดเล็กรอบจุดใหญ่ของ texture แบบเดิม */
const SPOT_BOOST = 1.2;
/** สัดส่วนของจุดขนาดใหญ่ (ครึ่งบนของช่วงขนาด) */
const BIG_SPOTS = 0.3;

const PAINT_VERTEX_PARS = /* glsl */ `
#ifndef MOLLY_AFIN
#define MOLLY_AFIN
attribute vec2 aFin;
#endif
attribute float aEye;
varying vec3 vPaintPos;
varying vec3 vPaintNormal;
varying vec2 vPaintFin;
varying float vPaintEye;
`;

const PAINT_FRAGMENT_PARS = /* glsl */ `
uniform vec3 uBodyBase;
uniform vec3 uBodyBack;
uniform vec3 uBodyBelly;
uniform vec3 uLip;
uniform vec3 uIris;
uniform vec3 uHeadColor;
uniform vec4 uHead;
uniform vec3 uFinBase;
uniform vec3 uFinTip;
uniform vec3 uFinRay;
uniform float uFinOpacity;
uniform int uSpotCount;
uniform vec3 uSpotColor[${MAX_LAYERS}];
uniform vec4 uSpotSmall[${MAX_LAYERS}];
uniform vec4 uSpotBig[${MAX_LAYERS}];
uniform vec4 uSpotFin[${MAX_LAYERS}];
uniform vec4 uSpotShape[${MAX_LAYERS}];
uniform float uSpotMatte[${MAX_LAYERS}];
uniform float uPaintSeed;
uniform float uTexRef;
uniform float uTexPatches;
varying vec3 vPaintPos;
varying vec3 vPaintNormal;
varying vec2 vPaintFin;
varying float vPaintEye;

vec3 mollyHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}

// ลายจุด 1 ชั้น: แบ่งพื้นที่เป็นช่องลูกบาศก์ขนาด grid.x แต่ละช่องมีจุดได้ไม่เกิน 1 จุด (โอกาส grid.y)
// และจุดอยู่ในช่องทั้งจุด → คำนวณแค่ช่องเดียวต่อพิกเซล
// grid = (ขนาดช่อง, โอกาส, รัศมีเล็กสุด, รัศมีใหญ่สุด)  shape = (sizePow, back, blur, patches)
// offset = เลื่อนตารางช่องตาม seed (ลายแต่ละตัว/แต่ละชั้นไม่ตรงกัน)
// วัดระยะเฉพาะตามแนวผิว (ตัดส่วนที่ขนานกับ normal ทิ้ง) → ทุกช่องที่ผิวผ่านจะเห็นจุดเต็มดวง ไม่ใช่แค่ช่องที่จุดบังเอิญอยู่ใกล้ผิว
float mollySpot(vec3 p, vec3 n, vec3 offset, vec4 grid, vec4 shape, float salt) {
  float cell = grid.x;
  vec3 ci = floor((p + offset) / cell);
  vec3 h1 = mollyHash(ci + salt);
  vec3 h2 = mollyHash(ci.zxy + salt * 1.7 + 11.3);
  vec3 origin = ci * cell - offset;
  vec3 cc = origin + 0.5 * cell;
  float t = 0.5 - cc.z;
  // หลังและช่วงท้ายลำตัวมีจุดหนาแน่นกว่าท้อง (เหมือน drawBodySpots ใน mollyTextures.js)
  float up = clamp(cc.y / 0.22, -1.0, 1.0);
  float accept = clamp((0.72 - shape.y + shape.y * up + 0.15 * clamp(t, 0.0, 1.0)) / 0.8, 0.0, 1.0);
  if (h1.x > grid.y * accept) return 0.0;
  float r = mix(grid.z, grid.w, pow(h1.y, shape.x)) * ((t < 0.2 || t > 0.92) ? 0.6 : 1.0);
  r = min(r, cell / 2.6);
  vec3 c = origin + 1.3 * r + vec3(h1.z, h2.x, h2.y) * max(cell - 2.6 * r, 0.0);
  vec3 q = p - c;
  q -= dot(q, n) * n;
  float len = length(q);
  vec3 dir = q / max(len, 1e-5);
  // ขอบจุดไม่กลมเป๊ะ
  float wob = 1.0 + 0.16 * sin(dot(dir, vec3(5.1, 3.7, 4.3)) + h2.z * 6.283) + 0.1 * sin(dot(dir, vec3(-2.3, 6.1, 1.7)) * 1.7 + h1.y * 6.283);
  float soft = 0.08 + 0.12 * shape.z;
  return 1.0 - smoothstep(r * (1.0 - soft), r, len / wob);
}
`;

const PAINT_FRAGMENT = /* glsl */ `
vec4 mTex = texture2D(map, vMapUv);
vec3 mSrgb = pow(max(mTex.rgb, vec3(0.0)), vec3(1.0 / 2.2));
float mMax = max(mSrgb.r, max(mSrgb.g, mSrgb.b));
float mMin = min(mSrgb.r, min(mSrgb.g, mSrgb.b));
// สีส้มในเท็กซ์เจอร์เดิม = ลายด่าง, ความสว่าง = เงาของเกล็ดและก้านครีบ
float mSat = (mMax - mMin) / max(mMax, 1e-3);
float mPatch = smoothstep(0.35, 0.6, mSat);
float mShade = pow(clamp(mMax / uTexRef, 0.0, 1.05), 2.2);
vec3 mN = normalize(vPaintNormal);
float mT = 0.5 - vPaintPos.z;

vec3 mCol = mix(uBodyBelly, uBodyBase, smoothstep(-0.9, -0.45, mN.y));
mCol = mix(mCol, uBodyBack, smoothstep(0.1, 0.75, mN.y));
float mHead = uHead.w * (1.0 - smoothstep(uHead.x, uHead.y, mT - uHead.z * smoothstep(0.2, 0.9, mN.y)));
mCol = mix(mCol, uHeadColor, mHead);
mCol = mix(mCol, uLip, 1.0 - smoothstep(0.015, 0.045, mT));

// ก้านครีบในเท็กซ์เจอร์เดิมเป็นเส้นสีส้ม → ใช้ความอิ่มสีเป็นตำแหน่งก้านครีบ
float mRay = smoothstep(0.22, 0.6, mSat);
vec3 mFinCol = mix(uFinBase, uFinTip, smoothstep(0.35, 1.0, vPaintFin.y));
mFinCol = mix(mFinCol, uFinRay, 0.75 * mRay);
float mFinAmt = clamp(vPaintFin.x, 0.0, 1.0) * smoothstep(0.02, 0.25, vPaintFin.y);
mCol = mix(mCol, mFinCol, mFinAmt);

float mMatte = 0.0;
bool mOnFin = vPaintFin.x > 0.5;
for (int i = 0; i < ${MAX_LAYERS}; i++) {
  if (i >= uSpotCount) break;
  float s;
  if (uSpotShape[i].w > 0.5 && uTexPatches > 0.5) s = mPatch;
  else {
    vec3 off = vec3(uPaintSeed * 37.0 + float(i) * 5.3);
    float salt = float(i) * 7.13 + uPaintSeed * 91.0;
    // จุดเล็กกับจุดใหญ่ใช้ตารางคนละขนาด จุดใหญ่จะได้ไม่ถูกจำกัดด้วยช่องเล็ก ๆ ของจุดที่หนาแน่น
    s = mOnFin
      ? mollySpot(vPaintPos, mN, off, uSpotFin[i], uSpotShape[i], salt)
      : max(mollySpot(vPaintPos, mN, off, uSpotSmall[i], uSpotShape[i], salt), mollySpot(vPaintPos, mN, off + 1.7, uSpotBig[i], uSpotShape[i], salt + 3.1));
  }
  mCol = mix(mCol, uSpotColor[i], s * 0.97);
  mMatte = max(mMatte, s * uSpotMatte[i]);
}

// ตา: ใช้สีเดิมของเท็กซ์เจอร์ (ตาดำ + ประกาย) ม่านตาย้อมเป็นสีของชุดสี
float mLum = dot(mTex.rgb, vec3(0.2126, 0.7152, 0.0722));
vec3 mEye = mix(mTex.rgb, uIris * mShade, smoothstep(0.03, 0.15, mLum) * 0.65);
diffuseColor.rgb *= mix(mCol * mShade, mEye, vPaintEye);
#ifdef MOLLY_FINS
  diffuseColor.a *= mix(1.0, mix(uFinOpacity, 1.0, 0.45 * mRay), smoothstep(0.08, 0.4, vPaintFin.y));
#endif
`;

/** @param {object} paint uniform ของชุดสี (จาก getPaint) ใช้ร่วมกันทุกตัวที่สีเดียวกัน */
function createPaintMod(paint, texRef = 0.97, texPatches = true) {
  const own = { uTexRef: { value: texRef }, uTexPatches: { value: texPatches ? 1 : 0 } };
  return {
    key: 'molly-paint',
    apply(shader) {
      Object.assign(shader.uniforms, paint, own);
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${PAINT_VERTEX_PARS}`).replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        vPaintPos = position;
        vPaintNormal = normal;
        vPaintFin = aFin;
        vPaintEye = aEye;`,
      );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${PAINT_FRAGMENT_PARS}`)
        .replace('#include <map_fragment>', PAINT_FRAGMENT)
        // จุดบางชนิดด้าน (matte) ตาเงาวาว
        .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = mix(mix(roughness, 0.85, mMatte), 0.12, vPaintEye);')
        // เรืองแสงอ่อน ๆ ตามสีผิวเอง ให้ปลาสีอ่อนดูนวลใต้น้ำ
        .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance *= diffuseColor.rgb * (1.0 - vPaintEye);');
    },
  };
}

const spotLayers = (variant) => (Array.isArray(variant.spots) ? variant.spots : variant.spots ? [variant.spots] : []);

/** ขนาดช่องสุ่มและโอกาสที่ช่องจะมีจุด ให้ได้ประมาณ count จุดบนพื้นที่ area */
function spotGrid(count, maxR, area) {
  if (!(count > 0)) return [1, 0];
  const cell = Math.max(Math.sqrt((1.5 * area) / count), 2.6 * maxR); // จุดต้องอยู่ในช่องทั้งจุด (ดู mollySpot)
  return [cell, Math.min(1, (count * cell * cell) / (1.5 * area))];
}

/** ตารางจุดบนลำตัวของชั้นลาย L — big = ช่วงจุดใหญ่ (สัดส่วน BIG_SPOTS ของจำนวนทั้งหมด) */
function bodySpots(L, big) {
  const maxR = L.maxSize ?? 0.03;
  const minR = L.minSize ?? maxR * 0.3;
  const midR = (minR + maxR) / 2;
  const count = (L.count ?? 0) * SPOT_BOOST * (big ? BIG_SPOTS : 1 - BIG_SPOTS);
  return new THREE.Vector4(...spotGrid(count, big ? maxR : midR, BODY_AREA), big ? midR : minR, big ? maxR : midR);
}

const paints = new Map();

/** uniform ของชุดสี — สร้างครั้งเดียวต่อสี (ลูกผสมใช้ id ตามยีน) */
function getPaint(V) {
  let paint = paints.get(V.id);
  if (paint) return paint;
  const color = (hex) => ({ value: new THREE.Color(hex) });
  const layers = spotLayers(V).slice(0, MAX_LAYERS);
  const pad = (fn, empty) => Array.from({ length: MAX_LAYERS }, (_, i) => (layers[i] ? fn(layers[i]) : empty()));
  const head = V.head;
  paint = {
    uBodyBase: color(V.body.base),
    uBodyBack: color(V.body.back),
    uBodyBelly: color(V.body.belly),
    uLip: color(V.lip ?? V.body.base),
    uIris: color(V.iris ?? '#c9ced6'),
    uHeadColor: color(head?.color ?? '#000000'),
    uHead: { value: new THREE.Vector4(head?.start ?? 0, head?.end ?? 0, head?.back ?? 0, head ? 1 : 0) },
    uFinBase: color(V.fins.base),
    uFinTip: color(V.fins.tip),
    uFinRay: color(V.fins.ray),
    uFinOpacity: { value: V.fins.opacity ?? 0.7 },
    uSpotCount: { value: layers.length },
    uSpotColor: { value: pad((L) => new THREE.Color(L.color), () => new THREE.Color()) },
    // จุดแบ่งเป็น 2 ขนาด: เล็ก (minSize → กึ่งกลาง) และใหญ่ (กึ่งกลาง → maxSize)
    uSpotSmall: { value: pad((L) => bodySpots(L, false), () => new THREE.Vector4(1, 0, 0, 0)) },
    uSpotBig: { value: pad((L) => bodySpots(L, true), () => new THREE.Vector4(1, 0, 0, 0)) },
    uSpotFin: {
      value: pad(
        (L) => {
          // finSize ในชุดสีเทียบกับขนาด texture ครีบ (ครีบยาว ~0.4 หน่วยลำตัว)
          const maxR = (L.finSize ?? 0.05) * 0.4;
          return new THREE.Vector4(...spotGrid((L.finCount ?? 0) * FIN_PIECES, maxR, FIN_AREA), maxR * 0.35, maxR);
        },
        () => new THREE.Vector4(1, 0, 0, 0),
      ),
    },
    uSpotShape: { value: pad((L) => new THREE.Vector4(L.sizePow ?? 2.3, L.back ?? 0.3, L.blur ?? 0.5, L.patches ? 1 : 0), () => new THREE.Vector4()) },
    uSpotMatte: { value: pad((L) => L.matte ?? 0.85, () => 0) },
    uPaintSeed: { value: V.seed ?? 0.1234 },
  };
  paints.set(V.id, paint);
  return paint;
}

const prepared = new WeakMap();

/** ดึง geometry และ texture จากไฟล์ครั้งเดียวแล้วใช้ร่วมกันทุกตัว — คืน null ถ้าไฟล์ไม่ใช่รูปแบบที่ build-molly-model.mjs สร้าง */
function prepare(gltf) {
  if (prepared.has(gltf)) return prepared.get(gltf);
  const meshes = {};
  gltf.scene.traverse((obj) => {
    if (obj.isMesh) meshes[obj.name] = obj;
  });
  const geometry = (name) => {
    const g = meshes[name]?.geometry;
    if (!g?.getAttribute('_fin') || !g.getAttribute('_eye')) return null;
    g.setAttribute('aFin', g.getAttribute('_fin'));
    g.setAttribute('aEye', g.getAttribute('_eye'));
    g.userData.shared = true; // ห้าม disposeObject ล้างทิ้ง
    return g;
  };
  const high = { body: geometry('molly_body'), fins: geometry('molly_fins') };
  const low = { body: geometry('molly_body_low') ?? high.body, fins: geometry('molly_fins_low') ?? high.fins };
  const source = meshes.molly_body?.material;
  const out = high.body && high.fins && source?.map ? { high, low, map: source.map, normalMap: source.normalMap, normalScale: source.normalScale, texRef: source.userData.texRef ?? 0.97, texPatches: source.userData.patches ?? true } : null;
  prepared.set(gltf, out);
  return out;
}

/**
 * @param {object} gltf ไฟล์ molly.glb ที่โหลดแล้ว
 * @param {object} V ชุดสี (variants.js หรือ genesToVariant)
 * @returns {{ object: THREE.Group, swimUniforms: object|null, materials: object, variant: object } | null} null = ไฟล์ใช้ไม่ได้
 */
export function createMeshMolly(gltf, V, { detail = 'high', animated = true, caustics = true } = {}) {
  const src = prepare(gltf);
  if (!src) return null;
  const M = V.material;
  const fancy = detail !== 'low'; // มือถือ/คุณภาพต่ำ: polygon น้อยลง และใช้ MeshStandardMaterial ที่เบากว่า
  const geo = fancy ? src.high : src.low;
  const normalScale = (src.normalScale ?? new THREE.Vector2(1, 1)).clone().multiplyScalar(0.55 + 0.35 * (V.scales?.relief ?? 1));
  const bodyParams = {
    map: src.map,
    normalMap: src.normalMap,
    normalScale,
    roughness: M.roughness,
    metalness: M.metalness,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: M.sheenGlow,
  };
  const body = fancy
    ? new THREE.MeshPhysicalMaterial({
        ...bodyParams,
        clearcoat: M.clearcoat,
        clearcoatRoughness: 0.16,
        iridescence: M.iridescence * 0.7,
        iridescenceIOR: 1.32,
        iridescenceThicknessRange: [160, 480],
      })
    : new THREE.MeshStandardMaterial(bodyParams);
  // ครีบเป็นแผ่นบาง 2 หน้าอยู่แล้ว ใช้ด้านหน้าอย่างเดียว และเขียน depth ให้ลำดับการบังถูกต้อง
  const fins = new THREE.MeshStandardMaterial({
    map: src.map,
    normalMap: src.normalMap,
    normalScale,
    transparent: true,
    depthWrite: true,
    roughness: 0.42,
    metalness: 0,
    emissive: new THREE.Color('#ffffff'),
    emissiveIntensity: 0.22,
  });
  fins.defines = { MOLLY_FINS: '' };

  // texRef = ความสว่างปกติของเท็กซ์เจอร์ในไฟล์ (ลูกปลาสีเทาเข้มกว่าตัวเต็มวัยสีขาว) ให้ย้อมสีออกมาสว่างเท่ากัน
  const paint = createPaintMod(getPaint(V), src.texRef, src.texPatches);
  let swimUniforms = null;
  let swim = null;
  if (animated) {
    swimUniforms = createMollySwimUniforms();
    swim = createMollySwimMod(swimUniforms);
  }
  applyShaderMods(body, [swim, paint, caustics && animated ? causticsMod : null]);
  applyShaderMods(fins, [swim, paint]);

  const group = new THREE.Group();
  group.name = `molly-${V.id}`;
  const bodyMesh = new THREE.Mesh(geo.body, body);
  bodyMesh.castShadow = true;
  const finsMesh = new THREE.Mesh(geo.fins, fins);
  finsMesh.renderOrder = 1;
  group.add(bodyMesh, finsMesh);
  group.userData.parts = { body: bodyMesh, fins: finsMesh };
  return { object: group, swimUniforms, materials: { body, fins }, variant: V };
}
