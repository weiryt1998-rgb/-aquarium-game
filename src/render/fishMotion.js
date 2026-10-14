import * as THREE from 'three';
import { sharedUniforms } from './shaderMods.js';

/**
 * ท่าว่ายจาก shader สำหรับโมเดล .glb ที่ไม่มีแอนิเมชัน (เช่นโมเดลจาก Meshy AI)
 * ไฟล์ต้องแปลงด้วย scripts/build-model.mjs --fish (หันหัวไป +Z) — shader แปลงพิกัดเป็นหน่วยตัวปลาเอง
 * (ยาว 1 ตามแกน Z จุดกึ่งกลางที่ 0) จากขอบเขตของ geometry
 * และมี attribute _FLEX = ความพลิ้ว 0 (ลำตัว) → 1 (ปลายครีบ/ชายผ้า) ดู scripts/lib/flex.mjs
 *
 * ตั้งใน src/data/fish.js ด้วย model.motion:
 *  'fish'     — ปลาทั่วไป: ลำตัวเป็นคลื่นจากหัวถึงหาง หัวส่ายสวนเล็กน้อย โค้งเป็นตัว C ตอนเลี้ยว
 *               ครีบและชายผ้าพลิ้วตามคลื่นแบบหน่วงเวลา (ยิ่งไกลลำตัวยิ่งช้าและแกว่งมาก) ไหวเบา ๆ แม้ลอยนิ่ง
 *               และลู่ไปด้านหลังเมื่อว่ายเร็ว
 *  'seahorse' — ม้าน้ำ: ตัวตั้งตรง ครีบหลัง/ครีบหูกระพือถี่ (ถี่ขึ้นเมื่อว่ายเร็ว) ลอยขึ้นลงตลอดเวลา
 *               ถ้ามีโครงกระดูก (model.rig → boneRig.js) กระดูกขยับหาง/หัว/ครีบเอง shader ทำแค่เยื่อครีบสั่น
 *               ถ้าไม่มี shader เลียนแบบหางม้วนเข้าออกและหัวพยักเอง
 *
 * Fish.js อัปเดต uSwimPhase / uSwimAmp / uTurn ทุกเฟรม (เหมือนปลาสอด)
 */

const PARS = /* glsl */ `
uniform float uSwimPhase;
uniform float uSwimAmp;
uniform float uTurn;
uniform float uFlowSeed;
uniform float uFlowTime;
uniform vec3 uFlowCenter;
uniform float uFlowScale;
#ifndef FLEX_ATTR
#define FLEX_ATTR
attribute float aFlex;
#endif
`;

const FISH = /* glsl */ `
// การเบี่ยงตามแกน x ของแนวกลางลำตัวที่ตำแหน่ง z → (dx, ความชัน) ใช้หมุน normal ตามการโค้ง
vec2 flowBend(float z) {
  float s = clamp(0.5 - z, 0.0, 1.0);   // 0 ปลายจมูก → 1 ปลายหาง
  float env = 0.16 + 0.84 * s * s;      // หัวส่ายสวนนิดหน่อย ช่วงท้ายส่ายมาก
  float k = 5.0;
  float ph = uSwimPhase - s * k;
  float dx = uSwimAmp * env * sin(ph);
  float dxds = uSwimAmp * (1.68 * s * sin(ph) - env * k * cos(ph));
  float ts = s - 0.35;
  dx += uTurn * 0.22 * ts * ts;
  dxds += uTurn * 0.44 * ts;
  return vec2(dx, -dxds);
}

// ครีบ/ชายผ้า: ตามคลื่นลำตัวแบบหน่วงเวลา + ไหวเป็นระลอกจากโคนไปปลาย + ลู่ไปด้านหลังเมื่อว่ายเร็ว
vec3 flowFlex(vec3 p, float f) {
  if (f < 0.001) return vec3(0.0);
  float s = clamp(0.5 - p.z, 0.0, 1.0);
  float t = uFlowTime + uFlowSeed;
  float f2 = f * f;
  vec3 d;
  d.x = uSwimAmp * 0.9 * f * sin(uSwimPhase - s * 5.0 - 1.5 * f);
  d.x += 0.035 * f2 * sin(t * 2.6 - f * 5.0 + p.y * 4.0 + p.z * 3.0);
  d.x -= uTurn * 0.07 * f2;
  d.y = 0.022 * f2 * sin(t * 1.9 - f * 4.0 + p.z * 5.0);
  d.z = 0.016 * f2 * sin(t * 2.2 - f * 4.5 + p.y * 5.0) - f2 * uSwimAmp * 0.3;
  return d;
}
`;

const SEAHORSE_BODY = /* glsl */ `
  float low = clamp(-p.y / 0.9, 0.0, 1.0);   // 0 กลางตัว → 1 ปลายหางด้านล่าง
  float high = clamp(p.y / 0.9, 0.0, 1.0);
  // หางม้วนเข้าออกและแกว่งช้า ๆ
  d.z += sin(t * 0.7 + 1.0) * 0.1 * low * low * low;
  d.x += sin(t * 0.9) * 0.06 * low * low;
  // หัวพยักและเอียงเบา ๆ
  d.z += sin(t * 0.8 + 2.0) * 0.018 * high;
  d.x += sin(t * 0.6 + 0.5) * 0.012 * high;
`;

/** rigged = กระดูกขยับหาง/หัว/ครีบให้แล้ว → เหลือแค่เยื่อครีบสั่น (แรงน้อยลง) และลอยขึ้นลง */
const seahorse = (rigged) => /* glsl */ `
vec3 seahorseMotion(vec3 p, float f) {
  float t = uFlowTime + uFlowSeed;
  vec3 d = vec3(0.0);
  ${rigged ? '' : SEAHORSE_BODY}
  // ครีบหลัง/ครีบหูกระพือถี่ เป็นคลื่นวิ่งตามแนวครีบ (เฉพาะครึ่งบน หางไม่กระพือ)
  float flutter = f * smoothstep(-0.45, -0.25, p.y) * (0.7 + 4.0 * uSwimAmp);
  float w = t * 24.0 - f * 6.0 + p.y * 26.0;
  d.x += flutter * ${rigged ? '0.022' : '0.04'} * sin(w);
  d.z += flutter * ${rigged ? '0.007' : '0.012'} * sin(w + 1.5);
  // ลอยขึ้นลง
  d.y += 0.012 * sin(t * 1.3);
  return d;
}
`;

/**
 * @param {'fish'|'seahorse'} type
 * @param {object} uniforms จาก createFishMotionUniforms
 * @param {{ rigged?: boolean }} options rigged = มีโครงกระดูกขยับตัวให้แล้ว (boneRig.js)
 */
export function createFishMotionMod(type, uniforms, { rigged = false } = {}) {
  const fish = type !== 'seahorse';
  return {
    key: `motion-${fish ? 'fish' : rigged ? 'seahorse-rig' : 'seahorse'}`,
    apply(shader) {
      Object.assign(shader.uniforms, uniforms, { uFlowTime: sharedUniforms.uTime });
      shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>\n${PARS}${fish ? FISH : seahorse(rigged)}`);
      if (fish) {
        shader.vertexShader = shader.vertexShader
          .replace(
            '#include <beginnormal_vertex>',
            /* glsl */ `#include <beginnormal_vertex>
            {
              vec2 fb = flowBend((position.z - uFlowCenter.z) * uFlowScale);
              objectNormal = normalize(vec3(objectNormal.x, objectNormal.y, objectNormal.z - objectNormal.x * fb.y));
            }`,
          )
          .replace(
            '#include <begin_vertex>',
            /* glsl */ `#include <begin_vertex>
            {
              vec3 fp = (position - uFlowCenter) * uFlowScale;
              transformed.x += flowBend(fp.z).x / uFlowScale;
              transformed += flowFlex(fp, aFlex) / uFlowScale;
            }`,
          );
      } else {
        shader.vertexShader = shader.vertexShader.replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\ntransformed += seahorseMotion((position - uFlowCenter) * uFlowScale, aFlex) / uFlowScale;',
        );
      }
    },
  };
}

/**
 * uniform เฉพาะของสัตว์แต่ละตัว
 * @param {THREE.Object3D} object โมเดล — ใช้ขอบเขตของ geometry (ท่าพัก) แปลงพิกัดเป็นหน่วยตัวปลา
 */
export function createFishMotionUniforms(object) {
  const box = new THREE.Box3();
  object.traverse((o) => {
    if (!o.isMesh) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    box.union(o.geometry.boundingBox);
  });
  const size = box.getSize(new THREE.Vector3());
  return {
    uFlowCenter: { value: box.getCenter(new THREE.Vector3()) },
    uFlowScale: { value: size.z > 1e-6 ? 1 / size.z : 1 },
    uSwimPhase: { value: Math.random() * 10 },
    uSwimAmp: { value: 0.08 },
    uTurn: { value: 0 },
    uFlowSeed: { value: Math.random() * 100 },
  };
}

/** ตั้งชื่อ attribute จากไฟล์ (_FLEX → GLTFLoader ตั้งเป็น _flex) ให้ตรงกับ shader — geometry ใช้ร่วมกัน ทำครั้งเดียวพอ */
export function prepareFlexAttribute(object) {
  object.traverse((o) => {
    const g = o.isMesh ? o.geometry : null;
    if (g && !g.getAttribute('aFlex') && g.getAttribute('_flex')) g.setAttribute('aFlex', g.getAttribute('_flex'));
  });
}
