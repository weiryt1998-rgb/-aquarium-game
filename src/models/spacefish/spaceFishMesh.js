import * as THREE from 'three';
import { applyShaderMods, causticsMod, sharedUniforms } from '../../render/shaderMods.js';
import { createFishMotionMod, createFishMotionUniforms } from '../../render/fishMotion.js';
import { colorUniforms, noise } from './spaceFishShaders.js';

/**
 * ปลาอวกาศจากไฟล์โมเดล public/models/fish/spacefish.glb (แปลงด้วย scripts/build-spacefish-model.mjs)
 *
 * ใช้รูปทรงและเงาเกล็ดจากไฟล์ แต่ลวดลายเป็นของปลาอวกาศทั้งหมด (คำนวณใน shader จากตำแหน่งบนตัว เหมือนแบบสร้างด้วยโค้ด):
 *  - ลำตัว: เนบิวลา 3 ชั้น ดาวระยิบระยับ เส้นพลังงานที่มีแสงวิ่ง ขอบเรืองแสง (ใช้ฟังก์ชันชุดเดียวกับ spaceFishShaders.js)
 *  - ครีบ: โปร่งแสงไล่สีจากโคนถึงปลาย แสงวิ่งจากโคนไปปลาย มีดาวเล็ก ๆ — ความไกลจากโคนมาจาก _FLEX ในไฟล์
 *  - ตา: ใช้สีเดิมของเท็กซ์เจอร์ (_EYE) เรืองแสงสีม่านตาของชุดสีเล็กน้อย
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

// ความสว่างของเท็กซ์เจอร์เทียบกับค่าปกติ (uTexRef) → เงาเกล็ด/ร่องลำตัวของโมเดล
const TEX_SHADE = /* glsl */ `
uniform float uTexRef;
uniform vec3 uIris;
float sfTexLevel(vec3 lin) {
  return pow(max(lin.r, max(lin.g, lin.b)), 1.0 / 2.2) / uTexRef;
}
`;

function createBodyMod(variant, energy, octaves, texRef) {
  const own = { ...colorUniforms(variant), uEnergy: energy, uSFTime: sharedUniforms.uTime, uTexRef: { value: texRef }, uIris: { value: new THREE.Color(variant.iris) } };
  return {
    key: `sf-mesh-body-${octaves}`,
    apply(shader) {
      Object.assign(shader.uniforms, own);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${noise(octaves)}\n${TEX_SHADE}`)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          vec3 sfP = vSpacePos;
          vec3 sfNeb = sfNebula(sfP);
          sfNeb = mix(sfNeb, uNebC, smoothstep(-0.05, -0.3, sfP.y) * 0.25);
          float sfFlow = uSFTime * (0.5 + uEnergy * 1.2);
          float sfR = 1.0 - abs(sfFbm(sfP * vec3(4.0, 4.0, 2.6) + vec3(0.0, 0.0, sfFlow * 0.7)) * 2.0 - 1.0);
          float sfVein = pow(sfR, 26.0) * smoothstep(0.42, 0.62, sfNoise(sfP * 2.6 + vec3(11.0, 3.0, sfFlow * 0.15)));
          float sfPulse = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(sfP.z * 10.0 + uSFTime * (2.5 + uEnergy * 4.0)), 3.0);
          float sfStar = sfStars(sfP * 30.0, 0.8, 0.26) + sfStars(sfP * 12.0 + 7.0, 0.9, 0.2) * 1.5;
          vec4 sfTex = texture2D(map, vMapUv);
          float sfShade = clamp(pow(sfTexLevel(sfTex.rgb), 0.6), 0.45, 1.35);
          diffuseColor.rgb = mix(sfNeb * 0.4, sfNeb, uLight) * sfShade;
          diffuseColor.rgb = mix(diffuseColor.rgb, uStarColor, clamp(sfStar, 0.0, 1.0) * 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, sfTex.rgb, vSFEye);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          {
            float sfFres = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.5);
            float sfBody = 1.0 - vSFEye;
            totalEmissiveRadiance += sfNeb * mix(0.3, 0.1, uLight) * sfBody;
            totalEmissiveRadiance += uEnergyColor * sfVein * sfPulse * (1.6 + uEnergy * 2.0) * sfBody;
            totalEmissiveRadiance += uStarColor * sfStar * 2.5 * sfBody;
            totalEmissiveRadiance += mix(uNebA, uNebB, 0.4) * sfFres * (0.8 + uEnergy * 0.6) * sfBody;
            totalEmissiveRadiance += uIris * vSFEye * 0.35;
          }`,
        );
    },
  };
}

function createFinMod(variant, energy, octaves, texRef) {
  const own = {
    ...colorUniforms(variant),
    uEnergy: energy,
    uSFTime: sharedUniforms.uTime,
    uTexRef: { value: texRef },
    uIris: { value: new THREE.Color(variant.iris) },
    uFinBase: { value: new THREE.Color(variant.fins.base) },
    uFinTip: { value: new THREE.Color(variant.fins.tip) },
  };
  return {
    key: `sf-mesh-fin-${octaves}`,
    apply(shader) {
      Object.assign(shader.uniforms, own);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${noise(octaves)}\n${TEX_SHADE}\nuniform vec3 uFinBase;\nuniform vec3 uFinTip;`)
        .replace(
          '#include <color_fragment>',
          /* glsl */ `#include <color_fragment>
          float fa = clamp(vSF.y, 0.0, 1.0);
          float fL = sfTexLevel(texture2D(map, vMapUv).rgb);
          float fRay = smoothstep(0.75, 1.15, fL); // ก้านครีบในเท็กซ์เจอร์สว่างกว่าเยื่อครีบ
          vec3 fCol = mix(uFinBase, uFinTip, smoothstep(0.15, 1.0, fa));
          fCol = mix(fCol, sfNebula(vSpacePos * 1.4), 0.35 * (1.0 - fa * 0.6));
          // แสงวิ่งจากโคนไปปลายครีบ
          float fFlow = pow(0.5 + 0.5 * sin(fa * 12.0 - uSFTime * (3.0 + uEnergy * 4.0)), 8.0);
          float fStar = sfStars(vSpacePos * 30.0, 0.9, 0.14);
          float fAlpha = mix(0.95, 0.45, pow(fa, 0.8)) + fRay * 0.12 + fFlow * 0.25;
          diffuseColor.rgb = fCol * 0.65 * clamp(fL, 0.6, 1.2);
          diffuseColor.a *= clamp(fAlpha, 0.0, 1.0);`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          /* glsl */ `#include <emissivemap_fragment>
          totalEmissiveRadiance += fCol * (0.4 + 0.35 * fa) * mix(1.0, 0.45, uLight);
          totalEmissiveRadiance += uFinTip * smoothstep(0.7, 1.0, fa) * 0.5;
          totalEmissiveRadiance += uEnergyColor * fFlow * (0.3 + fRay) * (0.8 + uEnergy * 1.4);
          totalEmissiveRadiance += uStarColor * fStar * 1.8;`,
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
  const out =
    high.body && high.fins && source?.map
      ? { high, low, map: source.map, normalMap: source.normalMap, normalScale: source.normalScale, texRef: source.userData.texRef ?? 0.6 }
      : null;
  prepared.set(gltf, out);
  return out;
}

/**
 * @param {object} gltf ไฟล์ spacefish.glb ที่โหลดแล้ว
 * @param {object} V ชุดสี (variants.js)
 * @returns {{ object: THREE.Group, body: THREE.Mesh, fins: THREE.Mesh, swimUniforms: object|null, tailZ: number } | null}
 */
export function createMeshSpaceFish(gltf, V, { detail = 'high', animated = true, energy }) {
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
  applyShaderMods(body, [meshAttrMod, motion, createBodyMod(V, energy, octaves, src.texRef), animated ? causticsMod : null]);
  applyShaderMods(fins, [meshAttrMod, motion, createFinMod(V, energy, octaves, src.texRef)]);

  if (!geo.body.boundingBox) geo.body.computeBoundingBox();
  if (!geo.fins.boundingBox) geo.fins.computeBoundingBox();
  const tailZ = Math.min(geo.body.boundingBox.min.z, geo.fins.boundingBox.min.z);
  return { object: group, body: bodyMesh, fins: finsMesh, swimUniforms, tailZ };
}
