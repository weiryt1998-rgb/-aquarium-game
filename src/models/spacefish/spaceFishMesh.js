import * as THREE from 'three';
import { applyShaderMods, causticsMod, sharedUniforms } from '../../render/shaderMods.js';
import { createFishMotionMod, createFishMotionUniforms } from '../../render/fishMotion.js';
import { colorUniforms, noise } from './spaceFishShaders.js';

/**
 * ปลาอวกาศจากไฟล์โมเดล (แปลงด้วย scripts/build-spacefish-model.mjs)
 *  - ตัวเต็มวัย public/models/fish/spacefish.glb: ใช้ลายกาแล็กซีในเท็กซ์เจอร์ของโมเดลตามเดิม แต่ "เปลี่ยนสี" ตามชุดสีของสายพันธุ์
 *    (sfRecolor: น้ำเงิน/ฟ้า → nebula[0], ม่วง → nebula[1], ชมพู → nebula[2], ทอง → energy, ประกายขาว → star) คงความสว่างและลายเดิม
 *    ประกายในลายกระพริบ เรืองแสงแรงขึ้นตอนว่ายเร็ว ขอบตัวเรืองแสง ครีบโปร่งแสงขึ้นที่ปลายและมีแสงวิ่งจากโคนไปปลาย
 *  - ลูกปลาแรกเกิด public/models/fish/spacefish_baby.glb (baby: true): ใช้ความสว่างของเท็กซ์เจอร์ลูกปลาเป็นลาย
 *    ระบายด้วยโทนสีของสายพันธุ์แบบอ่อน ๆ มีดาวเล็ก ๆ ระยิบระยับ ครีบเกือบใส
 *  - ความไกลจากโคนครีบมาจาก _FLEX ในไฟล์ / ตา (_EYE) ใช้สีเดิมของเท็กซ์เจอร์ เรืองแสงสีม่านตาเล็กน้อย
 *  - ท่าว่าย: render/fishMotion.js ('fish') — ลำตัวเป็นคลื่น ครีบพลิ้วตามแบบหน่วงเวลา
 */

const OCTAVES = { high: 4, medium: 3, low: 2 };

/** attribute ของไฟล์ → varying ที่ shader ลายใช้ (ต้องใส่เป็น mod ตัวแรก) */
const meshAttrMod = {
  key: 'sf-mesh-attr',
  apply(shader) {
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
        #ifndef FLEX_ATTR
        #define FLEX_ATTR
        attribute float aFlex;
        #endif
        attribute float aEye;
        varying vec3 vSpacePos;
        varying vec3 vSF;
        varying float vSFEye;`,
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSpacePos = position;\nvSF = vec3(1.0, aFlex, 0.0);\nvSFEye = aEye;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vSFEye;');
  },
};

/** สีจากเท็กซ์เจอร์ → สีของสายพันธุ์ (ใช้ทั้งลำตัวและครีบ) — uniform สีมาจาก noise() ใน spaceFishShaders.js */
const PAINT = /* glsl */ `
uniform vec3 uIris;
vec3 sfSrgb(vec3 lin) { return pow(max(lin, vec3(0.0)), vec3(1.0 / 2.2)); }
vec3 sfLin(vec3 c) { return pow(max(c, vec3(0.0)), vec3(2.2)); }
// สีเดิมที่สว่างที่สุด (ค่าสูงสุด = 1) — ความสว่างจริงเอามาจากเท็กซ์เจอร์
vec3 sfUnit(vec3 c) { return c / max(max(c.r, max(c.g, c.b)), 1e-3); }
float sfHueBand(float h, float center, float width) {
  float d = abs(h - center);
  d = min(d, 1.0 - d);
  return exp(-(d * d) / (width * width));
}

// ตัวเต็มวัย: ลายกาแล็กซีในเท็กซ์เจอร์ (น้ำเงิน/ฟ้า → nebula[0], ม่วง → nebula[1], ชมพู/แดง → nebula[2], ทอง → energy, ขาว → star)
// คงความสว่างและลายเดิม เปลี่ยนแค่สี  spark = ประกายดาวในลาย (จุดสว่างสีขาว/ทอง)
vec3 sfRecolor(vec3 lin, out float spark) {
  vec3 c = sfSrgb(lin);
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  float sat = (mx - mn) / max(mx, 1e-3);
  float h = 0.0;
  if (mx - mn > 1e-4) {
    if (mx == c.r) h = mod((c.g - c.b) / (mx - mn), 6.0);
    else if (mx == c.g) h = (c.b - c.r) / (mx - mn) + 2.0;
    else h = (c.r - c.g) / (mx - mn) + 4.0;
    h /= 6.0;
  }
  float wA = max(sfHueBand(h, 0.5, 0.07), sfHueBand(h, 0.62, 0.07));
  float wB = sfHueBand(h, 0.74, 0.06);
  float wC = max(sfHueBand(h, 0.86, 0.06), sfHueBand(h, 0.98, 0.05));
  float wE = sfHueBand(h, 0.12, 0.08);
  vec3 hue = wA * sfUnit(sfSrgb(uNebA)) + wB * sfUnit(sfSrgb(uNebB)) + wC * sfUnit(sfSrgb(uNebC)) + wE * sfUnit(sfSrgb(uEnergyColor));
  hue = sfUnit(hue / max(wA + wB + wC + wE, 1e-3));
  float v = mix(mx, 0.25 + 0.75 * mx, uLight); // ลำตัวสีอ่อน (Stardust White) ยกส่วนมืดขึ้นเล็กน้อย
  vec3 col = mix(sfUnit(sfSrgb(uStarColor)), hue, smoothstep(0.08, 0.35, sat)) * v;
  col = mix(sfUnit(sfSrgb(uDeep)) * v, col, smoothstep(0.04, 0.25, mx));
  spark = smoothstep(0.72, 0.95, mx) * max(1.0 - smoothstep(0.15, 0.45, sat), wE);
  return sfLin(col);
}

// ลูกปลาแรกเกิด: เนบิวลาสีของสายพันธุ์ไหลวนบนตัว (เข้มกว่าตัวเต็มวัย) + ลายมืด/สว่างของเท็กซ์เจอร์ลูกปลา
// ส่วนสว่างของลาย (ท้อง เกล็ดวาว) อมสีเนบิวลาอ่อน ๆ — p = ตำแหน่งบนตัว
vec3 sfBabyColor(vec3 lin, vec3 p) {
  float l = dot(sfSrgb(lin), vec3(0.299, 0.587, 0.114));
  vec3 neb = sfNebula(p * 1.3);
  vec3 col = mix(neb * 0.8, mix(uNebA, uStarColor, 0.45), smoothstep(0.55, 0.95, l) * 0.45);
  col *= 0.45 + 0.75 * l;
  float g = dot(col, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(g), col, 0.85); // ยังสีไม่จัดเท่าตัวเต็มวัย
}
`;

function createBodyMod(variant, energy, octaves, baby) {
  const own = { ...colorUniforms(variant), uEnergy: energy, uSFTime: sharedUniforms.uTime, uIris: { value: new THREE.Color(variant.iris) } };
  const color = baby
    ? /* glsl */ `
      vec4 sfTex = texture2D(map, vMapUv);
      vec3 sfCol = sfBabyColor(sfTex.rgb, vSpacePos);
      float sfSpark = 0.0;
      float sfStar = sfStars(vSpacePos * 45.0, 0.93, 0.2);`
    : /* glsl */ `
      vec4 sfTex = texture2D(map, vMapUv);
      float sfSpark;
      vec3 sfCol = sfRecolor(sfTex.rgb, sfSpark);
      float sfStar = sfStars(vSpacePos * 30.0, 0.86, 0.22);`;
  return {
    key: `sf-mesh-body-${baby ? 'baby' : 'adult'}-${octaves}`,
    apply(shader) {
      Object.assign(shader.uniforms, own);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${noise(octaves)}\n${PAINT}`)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          ${color}
          diffuseColor.rgb = mix(sfCol, uStarColor, clamp(sfStar, 0.0, 1.0) * 0.5);
          diffuseColor.rgb = mix(diffuseColor.rgb, sfTex.rgb, vSFEye);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          {
            float sfFres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.5);
            float sfBody = 1.0 - vSFEye;
            float sfTwinkle = 0.5 + 0.5 * sin(uSFTime * 3.0 + sfNoise(vSpacePos * 25.0) * 30.0);
            float sfGlow = ${baby ? '0.5' : '1.0'};
            totalEmissiveRadiance += sfCol * mix(0.35, 0.12, uLight) * (1.0 + uEnergy * 0.8) * sfGlow * sfBody;
            totalEmissiveRadiance += mix(uStarColor, uEnergyColor, 0.3) * sfSpark * (0.5 + 1.3 * sfTwinkle) * (0.8 + uEnergy) * sfBody;
            totalEmissiveRadiance += uStarColor * sfStar * 2.0 * sfBody;
            totalEmissiveRadiance += mix(uNebA, uNebB, 0.4) * sfFres * (0.6 + uEnergy * 0.6) * sfGlow * sfBody;
            totalEmissiveRadiance += uIris * vSFEye * 0.35;
          }`,
        );
    },
  };
}

function createFinMod(variant, energy, octaves, baby) {
  const own = {
    ...colorUniforms(variant),
    uEnergy: energy,
    uSFTime: sharedUniforms.uTime,
    uIris: { value: new THREE.Color(variant.iris) },
    uFinBase: { value: new THREE.Color(variant.fins.base) },
    uFinTip: { value: new THREE.Color(variant.fins.tip) },
  };
  // ลูกปลา: ครีบเกือบใส สีครีบของสายพันธุ์จาง ๆ / ตัวเต็มวัย: สีจากลายในเท็กซ์เจอร์ โปร่งแสงขึ้นที่ปลายครีบ
  const color = baby
    ? /* glsl */ `
      vec3 fCol = mix(sfBabyColor(fTex.rgb, vSpacePos) * 1.3, mix(uFinBase, uFinTip, fa), 0.25);
      float fSpark = 0.0;
      float fAlpha = mix(0.92, 0.45, pow(fa, 0.8)) + fFlow * 0.05;`
    : /* glsl */ `
      float fSpark;
      vec3 fCol = sfRecolor(fTex.rgb, fSpark);
      float fAlpha = mix(0.97, 0.6, pow(fa, 0.9)) + fFlow * 0.04;`;
  return {
    key: `sf-mesh-fin-${baby ? 'baby' : 'adult'}-${octaves}`,
    apply(shader) {
      Object.assign(shader.uniforms, own);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${noise(octaves)}\n${PAINT}\nuniform vec3 uFinBase;\nuniform vec3 uFinTip;`)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          float fa = clamp(vSF.y, 0.0, 1.0);
          vec4 fTex = texture2D(map, vMapUv);
          // แสงวิ่งจากโคนไปปลายครีบ
          float fFlow = pow(0.5 + 0.5 * sin(fa * 12.0 - uSFTime * (3.0 + uEnergy * 4.0)), 8.0);
          ${color}
          float fStar = sfStars(vSpacePos * 30.0, 0.9, 0.14);
          diffuseColor.rgb = fCol;
          diffuseColor.a *= clamp(fAlpha, 0.0, 1.0);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          {
            float fTwinkle = 0.5 + 0.5 * sin(uSFTime * 3.0 + sfNoise(vSpacePos * 25.0) * 30.0);
            totalEmissiveRadiance += fCol * (0.3 + 0.2 * fa) * mix(1.0, 0.4, uLight) * ${baby ? '0.5' : '1.0'};
            totalEmissiveRadiance += uFinTip * smoothstep(0.75, 1.0, fa) * ${baby ? '0.06' : '0.25'};
            // แสงวิ่งตามครีบ: ครีบใหญ่ แนวแสงเป็นวงโค้งกว้าง จึงให้เห็นจาง ๆ ตอนว่ายเร็วเท่านั้น
            totalEmissiveRadiance += uEnergyColor * fFlow * 0.12 * (0.15 + uEnergy * 1.5);
            totalEmissiveRadiance += mix(uStarColor, uEnergyColor, 0.3) * fSpark * (0.5 + 1.3 * fTwinkle);
            totalEmissiveRadiance += uStarColor * fStar * 1.5;
          }`,
        );
    },
  };
}

const prepared = new WeakMap();

/** geometry + texture จากไฟล์ (ใช้ร่วมกันทุกตัว) — null ถ้าไฟล์ไม่ใช่รูปแบบที่ build-spacefish-model.mjs สร้าง */
function prepare(gltf) {
  if (prepared.has(gltf)) return prepared.get(gltf);
  const meshes = {};
  gltf.scene.traverse((o) => o.isMesh && (meshes[o.name] = o));
  const geometry = (name) => {
    const g = meshes[name]?.geometry;
    if (!g?.getAttribute('_flex') || !g.getAttribute('_eye')) return null;
    g.setAttribute('aFlex', g.getAttribute('_flex'));
    g.setAttribute('aEye', g.getAttribute('_eye'));
    g.userData.shared = true; // ห้าม disposeObject ล้างทิ้ง
    return g;
  };
  const high = { body: geometry('spacefish_body'), fins: geometry('spacefish_fins') };
  const low = { body: geometry('spacefish_body_low') ?? high.body, fins: geometry('spacefish_fins_low') ?? high.fins };
  const source = meshes.spacefish_body?.material;
  const out = high.body && high.fins && source?.map ? { high, low, map: source.map, normalMap: source.normalMap, normalScale: source.normalScale } : null;
  prepared.set(gltf, out);
  return out;
}

/**
 * @param {object} gltf ไฟล์ spacefish.glb (หรือ spacefish_baby.glb) ที่โหลดแล้ว
 * @param {object} V ชุดสี (variants.js)
 * @param {{ baby?: boolean }} options baby = ลูกปลาแรกเกิด (ไฟล์ลูกปลา ระบายสีแบบลูกปลา)
 * @returns {{ object: THREE.Group, body: THREE.Mesh, fins: THREE.Mesh, swimUniforms: object|null, tailZ: number } | null}
 */
export function createMeshSpaceFish(gltf, V, { detail = 'high', animated = true, energy, baby = false }) {
  const src = prepare(gltf);
  if (!src) return null;
  const fancy = detail !== 'low';
  const geo = fancy ? src.high : src.low;
  const octaves = OCTAVES[detail] ?? 4;
  const common = { map: src.map, normalMap: src.normalMap, normalScale: src.normalScale?.clone() ?? new THREE.Vector2(1, 1), emissive: '#000000' };
  const bodyParams = { ...common, color: '#ffffff', roughness: 0.28, metalness: 0.05 };
  const body = fancy
    ? new THREE.MeshPhysicalMaterial({ ...bodyParams, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.45, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520] })
    : new THREE.MeshStandardMaterial(bodyParams);
  // ครีบเป็นแผ่นบาง 2 หน้าอยู่แล้ว: ด้านหน้าอย่างเดียว เขียน depth ให้ลำดับการบังถูกต้อง
  const fins = new THREE.MeshStandardMaterial({ ...common, color: '#ffffff', transparent: true, depthWrite: true, roughness: 0.35, metalness: 0 });

  const group = new THREE.Group();
  const bodyMesh = new THREE.Mesh(geo.body, body);
  bodyMesh.castShadow = true;
  const finsMesh = new THREE.Mesh(geo.fins, fins);
  finsMesh.renderOrder = 1;
  group.add(bodyMesh, finsMesh);

  let swimUniforms = null;
  let motion = null;
  if (animated) {
    swimUniforms = { ...createFishMotionUniforms(group), uEnergy: energy };
    motion = createFishMotionMod('fish', swimUniforms);
  }
  applyShaderMods(body, [meshAttrMod, motion, createBodyMod(V, energy, octaves, baby), animated ? causticsMod : null]);
  applyShaderMods(fins, [meshAttrMod, motion, createFinMod(V, energy, octaves, baby)]);

  if (!geo.body.boundingBox) geo.body.computeBoundingBox();
  if (!geo.fins.boundingBox) geo.fins.computeBoundingBox();
  const tailZ = Math.min(geo.body.boundingBox.min.z, geo.fins.boundingBox.min.z);
  return { object: group, body: bodyMesh, fins: finsMesh, swimUniforms, tailZ };
}
