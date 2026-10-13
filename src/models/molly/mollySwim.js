import { sharedUniforms } from '../../render/shaderMods.js';

/**
 * แอนิเมชันว่ายน้ำของ Molly ทำใน vertex shader ทั้งหมด (ไม่มี skeleton / ไม่ต้องอัปเดต geometry บน CPU)
 * จึงสร้างปลาได้หลายตัวโดยแทบไม่กิน CPU — แต่ละตัวต่างกันแค่ค่า uniform
 *
 *  - ลำตัว: คลื่นตามความยาว หัวนิ่ง ช่วงท้ายส่ายมาก (แบบปลาที่ว่ายด้วยหาง)
 *  - เลี้ยว: ลำตัวโค้งเป็นรูปตัว C ไปทางที่เลี้ยว (uTurn)
 *  - หาง: สะบัดตามลำตัวแต่ช้ากว่าเล็กน้อย ปลายหางพลิ้ว
 *  - ครีบอก: พัดสลับซ้าย-ขวาตลอดเวลาแม้ปลาลอยนิ่ง
 *  - ครีบหลัง ครีบท้อง ครีบก้น: ไหวเบา ๆ ตามน้ำ
 * normal ของลำตัวถูกหมุนตามการโค้งด้วย แสงสะท้อนจึงไหลไปตามตัวขณะว่าย
 *
 * ใช้คู่กับ geometry จาก mollyShape.js (attribute aFin = [ชนิดชิ้นส่วน, น้ำหนัก 0..1])
 */

const PARS = /* glsl */ `
uniform float uSwimPhase;
uniform float uSwimAmp;
uniform float uTurn;
uniform float uFinSeed;
uniform float uMollyTime;
attribute vec2 aFin;

// การเบี่ยงตามแกน x ของแนวกลางลำตัวที่ตำแหน่ง z → (dx, dx/dz)
vec2 mollyBend(float z) {
  float s = 0.5 - z;              // 0 ปลายจมูก → 1 โคนหาง → ~1.45 ปลายหาง
  float env = 0.12 + 0.7 * s * s;
  float k = 3.6;
  float ph = uSwimPhase - s * k;
  float amp = uSwimAmp * 0.7;         // ปลาตัวกลมส่ายตัวน้อยกว่าปลาทรงยาว
  float dx = amp * env * sin(ph);
  float dxds = amp * (1.4 * s * sin(ph) - env * k * cos(ph));
  float ts = s - 0.4;
  dx += uTurn * 0.2 * ts * ts;
  dxds += uTurn * 0.4 * ts;
  return vec2(dx, -dxds);
}

// การขยับเพิ่มเติมของครีบแต่ละชิ้น
vec3 mollyFin(vec3 p) {
  float id = aFin.x;
  float w = aFin.y;
  vec3 d = vec3(0.0);
  if (id < 0.5) return d;
  float t = uMollyTime + uFinSeed;
  if (id < 1.5) {
    // หาง: ปลายหางตามลำตัวช้ากว่า (ครีบยืดหยุ่น) + พลิ้วเล็กน้อยตลอดเวลา
    float s = 0.5 - p.z;
    d.x += uSwimAmp * 0.55 * w * w * sin(uSwimPhase - s * 3.6 - 1.1);
    d.x += 0.006 * w * sin(t * 7.0 + p.y * 28.0);
  } else if (id < 2.5) {
    // ครีบหลัง: ไหวตามคลื่นช้า ๆ และเอนออกด้านนอกตอนเลี้ยว
    d.x += w * w * (0.018 * sin(t * 2.3 + p.z * 9.0) + uSwimAmp * 0.25 * sin(uSwimPhase - 1.6) - uTurn * 0.04);
  } else if (id < 4.5) {
    // ครีบอก: พัดเข้า-ออกสลับซ้ายขวา ช่วงปลายครีบขยับมากกว่า
    float side = id < 3.5 ? -1.0 : 1.0;
    float flap = sin(t * 6.5 + side * 1.4);
    d.x += side * w * 0.05 * flap;
    d.z += w * 0.018 * cos(t * 6.5 + side * 1.4);
    d.y += w * w * 0.012 * flap;
  } else if (id < 6.5) {
    float side = id < 5.5 ? -1.0 : 1.0;
    d.x += side * w * 0.022 * sin(t * 3.1 + side);
  } else {
    d.x += w * w * (0.022 * sin(t * 2.7 + 0.6) + uSwimAmp * 0.2 * sin(uSwimPhase - 2.0));
  }
  return d;
}
`;

/**
 * @param {{uSwimPhase:{value:number}, uSwimAmp:{value:number}, uTurn:{value:number}, uFinSeed:{value:number}}} uniforms
 *  uniform เฉพาะของปลาแต่ละตัว (Fish.js อัปเดต uSwimPhase/uSwimAmp/uTurn ทุกเฟรม)
 */
export function createMollySwimMod(uniforms) {
  return {
    key: 'molly-swim',
    apply(shader) {
      shader.uniforms.uSwimPhase = uniforms.uSwimPhase;
      shader.uniforms.uSwimAmp = uniforms.uSwimAmp;
      shader.uniforms.uTurn = uniforms.uTurn;
      shader.uniforms.uFinSeed = uniforms.uFinSeed;
      shader.uniforms.uMollyTime = sharedUniforms.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${PARS}`)
        .replace(
          '#include <beginnormal_vertex>',
          /* glsl */ `#include <beginnormal_vertex>
          {
            vec2 mb = mollyBend(position.z);
            objectNormal = normalize(vec3(objectNormal.x, objectNormal.y, objectNormal.z - objectNormal.x * mb.y));
          }`,
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          transformed.x += mollyBend(position.z).x;
          transformed += mollyFin(position);`,
        );
    },
  };
}

/** สร้างชุด uniform ใหม่สำหรับปลา 1 ตัว */
export function createMollySwimUniforms() {
  return {
    uSwimPhase: { value: Math.random() * 10 },
    uSwimAmp: { value: 0.08 },
    uTurn: { value: 0 },
    uFinSeed: { value: Math.random() * 100 },
  };
}
