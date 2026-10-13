import * as THREE from 'three';
import { sharedUniforms } from '../../render/shaderMods.js';

/**
 * shader ของปลาอวกาศ (ต่อเติมวัสดุมาตรฐานของ Three.js ผ่าน applyShaderMods)
 *
 *  - spaceAttrMod      : ส่งตำแหน่งเดิมบนตัวปลา (ก่อนส่ายตัว) และ aSF ไปให้ fragment shader — ลายจึงติดไปกับตัวปลาไม่ไหลตามคลื่น
 *  - createSpaceSwimMod: ลำตัวส่ายเป็นคลื่น หางคู่และครีบยาวพลิ้วช้ากว่าลำตัวเหมือนผ้าไหมในน้ำ
 *  - createSpaceBodyMod: ลวดลายกาแล็กซี (เนบิวลา 3 ชั้น + ดาวระยิบระยับ + เส้นพลังงานที่มีแสงวิ่งตามตัว + ขอบเรืองแสง)
 *  - createSpaceFinMod : ครีบโปร่งแสงไล่สี แสงวิ่งตามก้านครีบจากโคนไปปลาย และมีดาวเล็ก ๆ บนครีบ
 *
 * ทุกอย่างคำนวณใน GPU จากตำแหน่ง ไม่มี texture ลำตัว — ปลาทุกสีใช้ shader program เดียวกัน ต่างกันแค่ค่า uniform
 * uEnergy (0..1) ตั้งจาก Fish.js ตามความเร็ว: ว่ายเร็ว → เส้นพลังงานสว่างขึ้นและวิ่งเร็วขึ้น
 */

const VARYINGS = /* glsl */ `
varying vec3 vSpacePos;
varying vec3 vSF;
`;

/** ต้องใส่เป็น mod ตัวแรกของทุกวัสดุของปลาอวกาศ (ประกาศ attribute aSF ที่ mod อื่นใช้) */
export const spaceAttrMod = {
  key: 'sf-attr',
  apply(shader) {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\nattribute vec3 aSF;\n${VARYINGS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSpacePos = position;\nvSF = aSF;');
  },
};

const SWIM_PARS = /* glsl */ `
uniform float uSwimPhase;
uniform float uSwimAmp;
uniform float uTurn;
uniform float uFinSeed;
uniform float uSFSwimTime;

// การเบี่ยงตามแกน x ของแนวกลางลำตัวที่ตำแหน่ง z → (dx, -dx/dz)
vec2 sfBend(float z) {
  float s = min(0.5 - z, 1.9);
  float env = 0.1 + 0.55 * s * s;
  float k = 3.2;
  float ph = uSwimPhase - s * k;
  float amp = uSwimAmp * 0.75;
  float dx = amp * env * sin(ph);
  float dxds = amp * (1.1 * s * sin(ph) - env * k * cos(ph));
  float ts = s - 0.4;
  dx += uTurn * 0.2 * ts * ts;
  dxds += uTurn * 0.4 * ts;
  return vec2(dx, -dxds);
}

// ครีบยาวพลิ้ว: ปลายครีบตามลำตัวช้ากว่า + คลื่นเล็ก ๆ วิ่งจากโคนไปปลายตลอดเวลา
vec3 sfFin(vec3 p, vec3 sf) {
  float id = sf.x;
  float w = sf.y;
  vec3 d = vec3(0.0);
  if (id < 0.5 || id > 7.5) return d;
  float t = uSFSwimTime + uFinSeed;
  float w2 = w * w;
  if (id < 1.5) {
    float s = 0.5 - p.z;
    d.x += uSwimAmp * 0.8 * w2 * sin(uSwimPhase - s * 3.2 - 1.3);
    d.x += 0.035 * w2 * sin(t * 2.6 + p.y * 7.0 - w * 4.0);
    d.y += 0.03 * w2 * sin(t * 1.9 - w * 5.0 + p.x * 16.0);
  } else if (id < 2.5) {
    d.x += w2 * (0.045 * sin(t * 2.0 + p.z * 7.0 - w * 3.0) + uSwimAmp * 0.3 * sin(uSwimPhase - 1.6) - uTurn * 0.05);
  } else if (id < 4.5) {
    float side = id < 3.5 ? -1.0 : 1.0;
    float flap = sin(t * 3.8 + side * 1.4 - w * 2.5);
    d.x += side * w * 0.06 * flap;
    d.y += w2 * 0.035 * flap;
    d.z += w * 0.02 * cos(t * 3.8 + side * 1.4);
  } else if (id < 6.5) {
    float side = id < 5.5 ? -1.0 : 1.0;
    d.x += side * w * 0.04 * sin(t * 2.4 + side - w * 3.0);
    d.z += w2 * 0.025 * sin(t * 1.8 + side);
  } else {
    d.x += w2 * (0.04 * sin(t * 2.3 + 0.6 - w * 3.0) + uSwimAmp * 0.25 * sin(uSwimPhase - 2.0));
  }
  return d;
}
`;

/** @param {{uSwimPhase, uSwimAmp, uTurn, uFinSeed}} uniforms uniform เฉพาะตัว (Fish.js อัปเดตทุกเฟรม) */
export function createSpaceSwimMod(uniforms) {
  return {
    key: 'sf-swim',
    apply(shader) {
      Object.assign(shader.uniforms, {
        uSwimPhase: uniforms.uSwimPhase,
        uSwimAmp: uniforms.uSwimAmp,
        uTurn: uniforms.uTurn,
        uFinSeed: uniforms.uFinSeed,
        uSFSwimTime: sharedUniforms.uTime,
      });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${SWIM_PARS}`)
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `#include <beginnormal_vertex>
          {
            vec2 sb = sfBend(position.z);
            objectNormal = normalize(vec3(objectNormal.x, objectNormal.y, objectNormal.z - objectNormal.x * sb.y));
          }`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          transformed.x += sfBend(position.z).x;
          transformed += sfFin(position, aSF);`,
        );
    },
  };
}

/** สัญญาณรบกวนและดวงดาว ใช้ร่วมกันทั้งลำตัวและครีบ  octaves = ความละเอียดของลายเนบิวลา (คุณภาพต่ำใช้น้อยลง) */
const noise = (octaves) => /* glsl */ `
uniform float uSFTime;
uniform float uEnergy;
uniform vec3 uDeep;
uniform vec3 uNebA;
uniform vec3 uNebB;
uniform vec3 uNebC;
uniform vec3 uEnergyColor;
uniform vec3 uStarColor;
uniform float uLight;
${VARYINGS}

float sfHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float sfNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(sfHash(i), sfHash(i + vec3(1, 0, 0)), f.x), mix(sfHash(i + vec3(0, 1, 0)), sfHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(sfHash(i + vec3(0, 0, 1)), sfHash(i + vec3(1, 0, 1)), f.x), mix(sfHash(i + vec3(0, 1, 1)), sfHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float sfFbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < ${octaves}; i++) {
    s += a * sfNoise(p);
    p = p * 2.03 + vec3(1.7, 9.2, 3.1);
    a *= 0.5;
  }
  return s;
}
// ดาว 1 ดวงต่อช่อง (บางช่อง) กระพริบด้วยจังหวะของตัวเอง
float sfStars(vec3 p, float density, float size) {
  vec3 c = floor(p);
  float h = sfHash(c);
  if (h < density) return 0.0;
  vec3 o = vec3(sfHash(c + 3.1), sfHash(c + 7.7), sfHash(c + 1.3)) - 0.5;
  float d = length(fract(p) - 0.5 - o * 0.5);
  float twinkle = 0.55 + 0.45 * sin(uSFTime * (1.5 + h * 4.0) + h * 40.0);
  return smoothstep(size, 0.0, d) * twinkle;
}
// สีเนบิวลาที่ตำแหน่ง p (ไหลวนช้า ๆ)
vec3 sfNebula(vec3 p) {
  float t = uSFTime;
  float n1 = sfFbm(p * 4.6 + vec3(0.0, 0.0, t * 0.04));
  float n2 = sfFbm(p * 8.0 - vec3(t * 0.03, 0.0, 0.0) + 4.0);
  vec3 c = mix(uDeep, uNebA, smoothstep(0.4, 0.74, n1));
  c = mix(c, uNebB, smoothstep(0.52, 0.8, n2) * 0.8);
  c = mix(c, uNebC, smoothstep(0.5, 0.7, n1 * n2 * 1.7) * 0.6);
  return c;
}
`;

function colorUniforms(variant) {
  const c = (hex) => ({ value: new THREE.Color(hex) });
  return {
    uDeep: c(variant.deep),
    uNebA: c(variant.nebula[0]),
    uNebB: c(variant.nebula[1]),
    uNebC: c(variant.nebula[2]),
    uEnergyColor: c(variant.energy),
    uStarColor: c(variant.star),
    uLight: { value: variant.light ? 1 : 0 },
  };
}

/**
 * ลวดลายกาแล็กซีบนลำตัว
 * @param {object} variant จาก variants.js
 * @param {{value:number}} energy uniform uEnergy ของปลาตัวนี้
 * @param {number} octaves ความละเอียดของลาย (2..4)
 */
export function createSpaceBodyMod(variant, energy, octaves = 4) {
  const own = { ...colorUniforms(variant), uEnergy: energy, uSFTime: sharedUniforms.uTime };
  return {
    key: `sf-body-${octaves}`,
    apply(shader) {
      Object.assign(shader.uniforms, own);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${noise(octaves)}`)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          vec3 sfP = vSpacePos;
          vec3 sfNeb = sfNebula(sfP);
          // ท้องสว่างกว่าหลังเล็กน้อย
          sfNeb = mix(sfNeb, uNebC, smoothstep(-0.05, -0.3, sfP.y) * 0.25);
          // เส้นพลังงาน: สันของ noise (ridged) ไหลจากหัวไปหาง
          float sfFlow = uSFTime * (0.5 + uEnergy * 1.2);
          float sfR = 1.0 - abs(sfFbm(sfP * vec3(4.0, 4.0, 2.6) + vec3(0.0, 0.0, sfFlow * 0.7)) * 2.0 - 1.0);
          // เส้นบาง ๆ และมีเป็นบางช่วงของตัว (ไม่งั้นมองไกล ๆ จะกลายเป็นลายด่างทั้งตัว)
          float sfVein = pow(sfR, 26.0) * smoothstep(0.42, 0.62, sfNoise(sfP * 2.6 + vec3(11.0, 3.0, sfFlow * 0.15)));
          // แสงวิ่งเป็นห้วง ๆ ตามแนวลำตัว
          float sfPulse = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(sfP.z * 10.0 + uSFTime * (2.5 + uEnergy * 4.0)), 3.0);
          float sfStar = sfStars(sfP * 30.0, 0.8, 0.26) + sfStars(sfP * 12.0 + 7.0, 0.9, 0.2) * 1.5;
          diffuseColor.rgb = mix(sfNeb * 0.4, sfNeb, uLight);
          diffuseColor.rgb = mix(diffuseColor.rgb, uStarColor, clamp(sfStar, 0.0, 1.0) * 0.6);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          {
            float sfFres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.5);
            float sfGlow = mix(0.3, 0.1, uLight);
            totalEmissiveRadiance += sfNeb * sfGlow;
            totalEmissiveRadiance += uEnergyColor * sfVein * sfPulse * (1.6 + uEnergy * 2.0);
            totalEmissiveRadiance += uStarColor * sfStar * 2.5;
            totalEmissiveRadiance += mix(uNebA, uNebB, 0.4) * sfFres * (0.8 + uEnergy * 0.6);
          }`,
        );
    },
  };
}

/**
 * ครีบโปร่งแสงเรืองแสง
 * @param {object} variant จาก variants.js
 * @param {{value:number}} energy uniform uEnergy ของปลาตัวนี้
 * @param {number} octaves ความละเอียดของลาย (2..4)
 */
export function createSpaceFinMod(variant, energy, octaves = 4) {
  const own = {
    ...colorUniforms(variant),
    uEnergy: energy,
    uSFTime: sharedUniforms.uTime,
    uFinBase: { value: new THREE.Color(variant.fins.base) },
    uFinTip: { value: new THREE.Color(variant.fins.tip) },
  };
  return {
    key: `sf-fin-${octaves}`,
    apply(shader) {
      Object.assign(shader.uniforms, own);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${noise(octaves)}\nuniform vec3 uFinBase;\nuniform vec3 uFinTip;`)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          float fa = vSF.y;
          float fb = vSF.z;
          float rays = vSF.x < 1.5 ? 18.0 : 11.0;
          float fr = abs(fract(fb * rays) - 0.5) * 2.0;
          float fRay = 1.0 - smoothstep(0.0, 0.14, fr);
          vec3 fCol = mix(uFinBase, uFinTip, smoothstep(0.15, 1.0, fa));
          fCol = mix(fCol, sfNebula(vSpacePos * 1.4), 0.35 * (1.0 - fa * 0.6));
          // แสงวิ่งตามก้านครีบจากโคนไปปลาย
          float fFlow = pow(0.5 + 0.5 * sin(fa * 12.0 - uSFTime * (3.0 + uEnergy * 4.0) + fb * 2.5), 8.0);
          float fStar = sfStars(vSpacePos * 30.0, 0.9, 0.14);
          // ขอบปลายครีบเป็นคลื่น ใสขึ้นเรื่อย ๆ ไปทางปลาย
          float fEdge = 1.0 - smoothstep(0.84, 1.0, fa + 0.05 * sin(fb * 40.0) + 0.03 * sin(fb * 91.0));
          float fRim = smoothstep(0.72, 0.95, fa) * fEdge;
          float fAlpha = (mix(0.62, 0.2, pow(fa, 0.7)) + fRay * 0.1 + fFlow * fRay * 0.3 + fRim * 0.25) * fEdge;
          diffuseColor.rgb = fCol * 0.5;
          diffuseColor.a *= clamp(fAlpha, 0.0, 1.0);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          totalEmissiveRadiance += fCol * (0.3 + 0.3 * fa) * mix(1.0, 0.45, uLight);
          totalEmissiveRadiance += uFinTip * fRim * 0.7;
          totalEmissiveRadiance += uEnergyColor * fFlow * (0.15 + fRay) * (0.8 + uEnergy * 1.4);
          totalEmissiveRadiance += uStarColor * fStar * 1.8;`,
        );
    },
  };
}
