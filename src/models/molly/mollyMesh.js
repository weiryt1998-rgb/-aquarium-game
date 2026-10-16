import * as THREE from 'three';
import { applyShaderMods, causticsMod } from '../../render/shaderMods.js';
import { createMollySwimMod, createMollySwimUniforms } from './mollySwim.js';
import { FRY_COLORS, FRY_FIN_OPACITY } from './fry.js';
import { barSpec } from './variants.js';

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
/** ก้านครีบหลังของ molly.glb แผ่ออกจากจุดโคน (y, z) — [y, z, มุมกึ่งกลาง, ช่วงมุมทั้งครีบ] และระยะ [โคนครีบ, ปลายครีบ] จากจุดนั้น */
const DORSAL_FAN = [0.0, 0.25, 0.64, 0.8];
const DORSAL_LEN = [0.3, 0.75];
const vecGlsl = (a) => a.map((x) => x.toFixed(3)).join(', ');

const PAINT_VERTEX_PARS = /* glsl */ `
#ifndef MOLLY_AFIN
#define MOLLY_AFIN
attribute vec2 aFin;
#endif
attribute float aEye;
varying vec3 vPaintPos;
varying vec3 vPaintNormal;
varying vec2 vPaintFin;
flat varying float vPaintFinId;
varying float vPaintEye;
uniform float uBelly;
`;

/**
 * พุงกลม: ขยายครึ่งล่างช่วงกลางลำตัวออกจากแกนกลางลำตัว (ทั้งลงล่างและออกด้านข้าง) ครีบท้อง/ครีบก้นขยับตามผิวไปด้วย
 * ทำกับรูปทรงพักก่อนท่าว่าย — ลายคำนวณจาก vPaintPos (ตำแหน่งเดิม) จึงไม่ยืดตาม
 */
const BELLY_VERTEX = /* glsl */ `
{
  float bt = 0.5 - position.z;
  float bAlong = exp(-pow((bt - 0.52) / 0.27, 2.0));
  float bBelow = smoothstep(0.1, -0.22, position.y);
  vec2 bAxis = vec2(0.0, 0.03);
  transformed.xy = bAxis + (transformed.xy - bAxis) * (1.0 + uBelly * bAlong * bBelow);
}`;

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
uniform vec4 uSpotBarA[${MAX_LAYERS}];
uniform vec4 uSpotBarB[${MAX_LAYERS}];
uniform vec4 uSpotBarC[${MAX_LAYERS}];
uniform vec3 uSpotGlow[${MAX_LAYERS}];
uniform vec3 uSpotGlowFront[${MAX_LAYERS}];
uniform float uPaintSeed;
uniform float uTexRef;
uniform float uTexPatches;
uniform float uFry;
uniform vec3 uFryBack;
uniform vec3 uFryBase;
uniform vec3 uFryBelly;
uniform vec3 uFryFin;
uniform float uFryFinOpacity;
varying vec3 vPaintPos;
varying vec3 vPaintNormal;
varying vec2 vPaintFin;
flat varying float vPaintFinId;
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

// value noise 3 มิติ (0..1) ใช้ทำขอบบั้งให้คดเคี้ยวและลายหินอ่อน
float mollyNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 e = vec2(0.0, 1.0);
  return mix(
    mix(mix(mollyHash(i).x, mollyHash(i + e.yxx).x, f.x), mix(mollyHash(i + e.xyx).x, mollyHash(i + e.yyx).x, f.x), f.y),
    mix(mix(mollyHash(i + e.xxy).x, mollyHash(i + e.yxy).x, f.x), mix(mollyHash(i + e.xyy).x, mollyHash(i + e.yyy).x, f.x), f.y),
    f.z);
}

// ลายบั้งแนวตั้ง + ลายหินอ่อน 1 ชั้นบนลำตัว: t = 0 ปลายจมูก → 1 โคนหาง, up = +1 สันหลัง → -1 ท้อง
// A = (จำนวนบั้ง, t เริ่ม, t สิ้นสุด, ความกว้างเทียบช่วงห่าง)  B = (ขอบล่างช่วงหน้า, ขอบล่างช่วงท้าย, หินอ่อน, ความเอียง)
// px = ขนาด 1 พิกเซลบนตัวปลา (หน่วยลำตัว)
float mollyBars(vec3 p, float t, float up, vec4 A, vec4 B, float salt, float px) {
  float nA = mollyNoise(p * 8.0 + salt);
  float nB = mollyNoise(p * 21.0 + salt * 1.7 + 3.1);
  // ลายละเอียดของหินอ่อน (ยืดคอนทราสต์ให้กระจายเต็มช่วง 0..1) — ปลาอยู่ไกลจนลายเล็กกว่าพิกเซลจะค่อย ๆ เป็นค่ากลาง กันลายกะพริบ
  // หมุนแกนก่อนสุ่ม ลายจุดเล็ก ๆ จะได้ไม่เรียงเป็นเหลี่ยมตามแกน
  vec3 pr = mat3(0.0, 0.8, 0.6, -0.8, 0.36, -0.48, -0.6, -0.48, 0.64) * p;
  float nC = clamp((mollyNoise(pr * 110.0 + salt * 0.7 + 7.9) - 0.5) * 2.2 + 0.5, 0.0, 1.0);
  nC = mix(nC, 0.5, smoothstep(0.3, 0.8, px * 110.0));
  // ขอบบั้งคดเคี้ยว เอียงไปทางหัวตามความสูงเล็กน้อย
  float tt = t + (nA - 0.5) * 0.09 + (nB - 0.5) * 0.05 - B.w * p.y;
  float x = clamp((tt - A.y) / max(A.z - A.y, 0.05), 0.0, 1.0);
  // ช่วงท้ายบั้งถี่กว่าช่วงหน้า ~1.6 เท่า (ลำตัวเรียวลง)
  float u = x * (0.77 + 0.23 * x) * (A.x - 1.0);
  float k = floor(u + 0.5);
  vec3 h = mollyHash(vec3(k, salt, 3.7));
  float w = A.w * (0.75 + 0.5 * h.x) * (0.9 + 0.3 * x); // บั้งช่วงโคนหางหนากว่า
  // ความเข้มของบั้ง 1 กลางบั้ง → 0 นอกบั้ง ไล่แบบนุ่ม แล้วตัดด้วยลายละเอียด → ขอบบั้งแตกเป็นจุด/ก้อนแบบหินอ่อน
  float b = 1.0 - smoothstep(w * 0.5 - 0.13, w * 0.5 + 0.13, abs(u - k - (h.y - 0.5) * 0.25));
  b *= smoothstep(A.y - 0.04, A.y, tt) * (1.0 - smoothstep(A.z, A.z + 0.04, tt));
  // ขอบล่าง: ช่วงท้องป่องบั้งสั้น ช่วงโคนหางยาวเกือบรอบตัว ปลายบั้งค่อย ๆ แตกเป็นจุด
  float low = mix(B.x, B.y, smoothstep(A.y, A.z, t));
  b *= smoothstep(low - 0.15, low + 0.2, up + (nB - 0.5) * 0.3);
  // รูพรุนกลางบั้ง
  float m = nA * 0.62 + nB * 0.38;
  b *= smoothstep(0.3 * B.z - 0.05, 0.3 * B.z + 0.05, m);
  float fleck = mix(0.5, nC, B.z);
  float bar = smoothstep(-0.05, 0.05, b - fleck);
  // ก้อนดำบนหัว (มากสุดที่กระหม่อม/จมูก) แก้ม และตามสันหลัง
  // dark = สัดส่วนพื้นที่สีดำโดยประมาณ → แปลงเป็นระดับตัดของ noise (m กระจายรอบ 0.5)
  float head = 1.0 - smoothstep(0.22, 0.32, t);
  float dark = B.z * max(head * mix(0.2, 0.55, smoothstep(-0.45, 0.4, up)), 0.35 * smoothstep(0.6, 0.92, up));
  float level = mix(1.0, 0.5 + (0.5 - dark) * 0.42, smoothstep(0.0, 0.15, dark));
  float marble = smoothstep(-0.05, 0.05, smoothstep(-0.07, 0.07, m - level) - fleck);
  return max(bar, marble);
}

// ริ้วดำตามก้านครีบหาง/ครีบหลัง n = จำนวนริ้ว — ก้านครีบแผ่ออกจากโคน จึงใช้มุมรอบจุดโคนเป็นพิกัดขวางก้าน
// และระยะจากจุดโคน (0 โคนครีบ → 1 ปลายครีบ) เป็นพิกัดตามก้าน
float mollyStreaks(vec3 p, float id, float n, float salt) {
  // จุดโคน (y, z), มุมกึ่งกลาง, ช่วงมุมทั้งครีบ, ระยะโคน, ระยะปลาย
  vec4 fan;
  vec2 len;
  if (n < 0.5 || id < 0.5) return 0.0;
  if (id < 1.5) {
    fan = vec4(-0.02, -0.5, 0.0, 1.9);
    len = vec2(0.0, 0.48);
  } else if (id < 2.5) {
    fan = vec4(${vecGlsl(DORSAL_FAN)});
    len = vec2(${vecGlsl(DORSAL_LEN)});
  } else return 0.0;
  vec2 d = vec2(p.y - fan.x, fan.y - p.z);
  float r = (length(d) - len.x) / (len.y - len.x);
  float u = ((atan(d.x, d.y) - fan.z) / fan.w + 0.5) * n + (mollyNoise(p * 16.0 + salt) - 0.5) * 0.7;
  float k = floor(u);
  vec3 h = mollyHash(vec3(k, salt, id * 5.3));
  float w = (0.4 + 0.4 * h.y) * step(h.x, 0.85);
  float s = 1.0 - smoothstep(w * 0.5 - 0.06, w * 0.5 + 0.03, abs(fract(u) - 0.5) + (mollyNoise(p * 45.0 + salt) - 0.5) * 0.12);
  // ริ้วแต่ละเส้นเริ่ม/จบไม่เท่ากัน
  float a0 = 0.1 + 0.35 * h.z;
  float a1 = a0 + 0.35 + 0.6 * fract(h.z * 7.31);
  return s * smoothstep(a0, a0 + 0.1, r) * (1.0 - smoothstep(a1, a1 + 0.15, r));
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
float mPx = length(fwidth(vPaintPos)); // ขนาด 1 พิกเซลบนตัวปลา (คำนวณนอก if เพราะ derivative ต้องอยู่ใน control flow เดียวกันทั้งกลุ่มพิกเซล)
// สีพื้นระหว่างบั้ง (ชั้นลายบั้ง) ทาก่อนลายทุกชั้นเพื่อไม่ให้กลบจุดของชั้นอื่น:
// เหนือขอบล่างของบั้ง (ท้องยังเป็นสีตัว) ช่วงหน้าสี front → ช่วงท้ายสี color
for (int i = 0; i < ${MAX_LAYERS}; i++) {
  if (i >= uSpotCount) break;
  if (uSpotBarA[i].x < 0.5) continue;
  vec4 A = uSpotBarA[i];
  vec4 C = uSpotBarC[i];
  float low = mix(uSpotBarB[i].x, uSpotBarB[i].y, smoothstep(A.y, A.z, mT));
  float g = C.z * smoothstep(low - 0.1, low + 0.35, mN.y) * smoothstep(A.y - 0.08, A.y + 0.05, mT);
  vec3 ground = mix(uSpotGlowFront[i], uSpotGlow[i], smoothstep(C.y - 0.12, C.y + 0.12, mT));
  mCol = mix(mCol, ground, g * (1.0 - mFinAmt));
}
for (int i = 0; i < ${MAX_LAYERS}; i++) {
  if (i >= uSpotCount) break;
  float s;
  float salt = float(i) * 7.13 + uPaintSeed * 91.0;
  if (uSpotBarA[i].x > 0.5) {
    // ลำตัว = บั้ง, ครีบ = ริ้วตามก้านครีบ — โคนครีบที่ติดมากับ mesh ลำตัว (สามเหลี่ยมที่มีทั้งจุดลำตัวและจุดครีบ)
    // ค่อย ๆ เปลี่ยนจากบั้งเป็นริ้ว ส่วนชนิดครีบใช้ค่า flat เพราะค่าที่ interpolate ข้ามรอยต่อ (เช่น 0 → 2) จะผ่าน 1 ซึ่งเป็นรหัสของหาง
    #ifdef MOLLY_FINS
      float onFin = 1.0;
    #else
      float onFin = smoothstep(0.15, 0.6, vPaintFin.x);
    #endif
    s = onFin < 0.999 ? mollyBars(vPaintPos, mT, mN.y, uSpotBarA[i], uSpotBarB[i], salt, mPx) * (1.0 - onFin) : 0.0;
    if (onFin > 0.001) s = max(s, mollyStreaks(vPaintPos, vPaintFinId, uSpotBarC[i].x, salt) * onFin);
  } else if (uSpotShape[i].w > 0.5 && uTexPatches > 0.5) s = mPatch;
  else {
    vec3 off = vec3(uPaintSeed * 37.0 + float(i) * 5.3);
    // จุดเล็กกับจุดใหญ่ใช้ตารางคนละขนาด จุดใหญ่จะได้ไม่ถูกจำกัดด้วยช่องเล็ก ๆ ของจุดที่หนาแน่น
    s = mOnFin
      ? mollySpot(vPaintPos, mN, off, uSpotFin[i], uSpotShape[i], salt)
      : max(mollySpot(vPaintPos, mN, off, uSpotSmall[i], uSpotShape[i], salt), mollySpot(vPaintPos, mN, off + 1.7, uSpotBig[i], uSpotShape[i], salt + 3.1));
  }
  mCol = mix(mCol, uSpotColor[i], s * 0.97);
  mMatte = max(mMatte, s * uSpotMatte[i]);
}

// ลูกปลาแรกเกิด (ดู fry.js): สีเทาเข้มอมเขียว หลังเข้ม ท้องเทาเงิน ครีบใส ทับสีจริงไว้ → ค่อย ๆ จางเมื่อโต
vec3 mFry = mix(uFryBelly, uFryBase, smoothstep(-0.9, -0.45, mN.y));
mFry = mix(mFry, uFryBack, smoothstep(0.1, 0.75, mN.y));
mFry = mix(mFry, uFryFin, mFinAmt);
mCol = mix(mCol, mFry, uFry);
mMatte *= 1.0 - uFry;

// ตา: ใช้สีเดิมของเท็กซ์เจอร์ (ตาดำ + ประกาย) ม่านตาย้อมเป็นสีของชุดสี (ลูกปลาม่านตาสีเทาเหมือนกันหมด)
float mLum = dot(mTex.rgb, vec3(0.2126, 0.7152, 0.0722));
vec3 mEye = mix(mTex.rgb, mix(uIris, vec3(0.35), uFry) * mShade, smoothstep(0.03, 0.15, mLum) * 0.65);
diffuseColor.rgb *= mix(mCol * mShade, mEye, vPaintEye);
#ifdef MOLLY_FINS
  float mFinFade = smoothstep(0.08, 0.4, vPaintFin.y);
  diffuseColor.a *= mix(1.0, mix(mix(uFinOpacity, 1.0, 0.45 * mRay), uFryFinOpacity, uFry), mFinFade);
#endif
`;

/** สีลูกปลาแรกเกิด ใช้ร่วมกันทุกตัว */
const FRY_PAINT = {
  uFryBack: { value: new THREE.Color(FRY_COLORS.back) },
  uFryBase: { value: new THREE.Color(FRY_COLORS.base) },
  uFryBelly: { value: new THREE.Color(FRY_COLORS.belly) },
  uFryFin: { value: new THREE.Color(FRY_COLORS.fin) },
  uFryFinOpacity: { value: FRY_FIN_OPACITY },
};

/**
 * @param {object} paint uniform ของชุดสี (จาก getPaint) ใช้ร่วมกันทุกตัวที่สีเดียวกัน
 * @param {{ value: number }} fry สีลูกปลาแรกเกิดของตัวนี้ 0..1 (แยกต่อตัว — ปรับตามการเติบโต)
 * @param {number} belly ขยายพุงเพิ่ม (สัดส่วน เช่น 0.2 = กว้างขึ้น 20% ตรงกลางพุง) 0 = รูปทรงตามไฟล์
 */
function createPaintMod(paint, texRef = 0.97, texPatches = true, fry = { value: 0 }, belly = 0) {
  const own = { uTexRef: { value: texRef }, uTexPatches: { value: texPatches ? 1 : 0 }, uFry: fry, uBelly: { value: belly }, ...FRY_PAINT };
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
        vPaintFinId = aFin.x;
        vPaintEye = aEye;
        ${BELLY_VERTEX}`,
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
  // ชั้นลายบั้งไม่สุ่มจุด (ตารางจุดว่าง) ใช้ uSpotBar* แทน
  const bars = layers.map(barSpec);
  const padBars = (fn) => Array.from({ length: MAX_LAYERS }, (_, i) => (bars[i] ? fn(bars[i]) : new THREE.Vector4()));
  const noGrid = () => new THREE.Vector4(1, 0, 0, 0);
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
    uSpotSmall: { value: pad((L) => (L.bars ? noGrid() : bodySpots(L, false)), noGrid) },
    uSpotBig: { value: pad((L) => (L.bars ? noGrid() : bodySpots(L, true)), noGrid) },
    uSpotFin: {
      value: pad((L) => {
        if (L.bars) return noGrid();
        // finSize ในชุดสีเทียบกับขนาด texture ครีบ (ครีบยาว ~0.4 หน่วยลำตัว)
        const maxR = (L.finSize ?? 0.05) * 0.4;
        return new THREE.Vector4(...spotGrid((L.finCount ?? 0) * FIN_PIECES, maxR, FIN_AREA), maxR * 0.35, maxR);
      }, noGrid),
    },
    uSpotShape: { value: pad((L) => new THREE.Vector4(L.sizePow ?? 2.3, L.back ?? 0.3, L.blur ?? 0.5, L.patches ? 1 : 0), () => new THREE.Vector4()) },
    uSpotMatte: { value: pad((L) => L.matte ?? 0.85, () => 0) },
    uSpotBarA: { value: padBars((b) => new THREE.Vector4(b.count, b.from, b.to, b.width)) },
    uSpotBarB: { value: padBars((b) => new THREE.Vector4(b.low[0], b.low[1], b.marble, b.slant)) },
    uSpotBarC: { value: padBars((b) => new THREE.Vector4(b.streaks, b.glow?.from ?? 0, b.glow?.amount ?? 0, 0)) },
    uSpotGlow: { value: Array.from({ length: MAX_LAYERS }, (_, i) => new THREE.Color(bars[i]?.glow?.color ?? '#000000')) },
    uSpotGlowFront: { value: Array.from({ length: MAX_LAYERS }, (_, i) => new THREE.Color(bars[i]?.glow?.front ?? '#000000')) },
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
 * @param {{ fry?: number, belly?: number }} options fry = สีลูกปลาแรกเกิดทับสีจริง 0..1 (ดู fry.js)
 *  belly = ขยายพุงให้กลมขึ้น (สัดส่วน) — ตัวเต็มวัยใช้ MOLLY_BELLY, ไฟล์ลูกปลาใช้ 0
 * @returns {{ object: THREE.Group, swimUniforms: object|null, materials: object, variant: object, fry: { value: number } } | null}
 *  null = ไฟล์ใช้ไม่ได้ · fry = uniform ของตัวนี้ (ตั้ง .value ใหม่เมื่อปลาโตขึ้น)
 */
export function createMeshMolly(gltf, V, { detail = 'high', animated = true, caustics = true, fry = 0, belly = 0 } = {}) {
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
  const fryUniform = { value: fry };
  const paint = createPaintMod(getPaint(V), src.texRef, src.texPatches, fryUniform, belly);
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
  return { object: group, swimUniforms, materials: { body, fins }, variant: V, fry: fryUniform };
}
