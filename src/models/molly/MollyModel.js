import * as THREE from 'three';
import { applyShaderMods, causticsMod } from '../../render/shaderMods.js';
import { createMeshMolly } from './mollyMesh.js';
import { getMollyGeometry, MOLLY_DETAIL } from './mollyShape.js';
import { acquireMollyTextures } from './mollyTextures.js';
import { createMollySwimMod, createMollySwimUniforms } from './mollySwim.js';
import { getMollyVariant } from './variants.js';

/**
 * โมเดลปลา Balloon Molly แบบ 3 มิติ สร้างด้วยโค้ดทั้งหมด (geometry + texture + shader)
 * ถ้าส่งไฟล์ molly.glb มาใน options.mesh จะใช้รูปทรงจากไฟล์แทน (ดู mollyMesh.js) — แบบนี้เป็นตัวสำรองเมื่อไม่มีไฟล์
 *
 * ใช้งาน:
 *   const { object, swimUniforms } = createMolly({ variant: 'dalmatian' });
 *   scene.add(object);
 *   // ทุกเฟรม: swimUniforms.uSwimPhase.value += dt * ความถี่การสะบัดหาง
 *   //          swimUniforms.uSwimAmp.value = 0.05..0.13 (ตามความเร็ว)
 *   //          swimUniforms.uTurn.value = -1..1 (อัตราการเลี้ยว + = เลี้ยวไปทาง +X ของตัวปลา)
 *
 * object หันหัวไป +Z ลำตัวยาว 1 หน่วย (ไม่รวมหาง) จุดศูนย์กลางอยู่กลางลำตัว — ตรงกับปลาตัวอื่นในเกม
 * geometry และ texture ใช้ร่วมกันทุกตัว ส่วน material แยกต่อตัว (เพราะ uniform ว่ายน้ำต่างกัน)
 * แต่ shader program ใช้ร่วมกัน → ปลา 1 ตัว = 3 draw call (ลำตัว, ตา, ครีบ)
 */

/** ความยาวรวมจากปลายจมูกถึงปลายหาง เทียบกับลำตัว 1 หน่วย */
export const MOLLY_TOTAL_LENGTH = 1.46;

function createMaterials(variant, detail, textures) {
  const M = variant.material;
  const fancy = detail !== 'low'; // มือถือ/คุณภาพต่ำ: ใช้ MeshStandardMaterial ที่เบากว่า
  const bodyParams = {
    map: textures.body.map,
    normalMap: textures.body.normalMap,
    normalScale: new THREE.Vector2(0.7, 0.7),
    roughnessMap: textures.body.roughnessMap,
    roughness: 1,
    metalness: M.metalness,
    // เรืองแสงอ่อน ๆ ตามสีผิวเอง (ไม่ทับจุดดำ) ให้ปลาสีอ่อนดูนวลเหมือนมุกใต้น้ำ
    emissive: new THREE.Color('#ffffff'),
    emissiveMap: textures.body.map,
    emissiveIntensity: M.sheenGlow,
  };
  const body = fancy
    ? new THREE.MeshPhysicalMaterial({
        ...bodyParams,
        clearcoat: M.clearcoat,
        clearcoatRoughness: 0.16,
        iridescence: M.iridescence,
        iridescenceMap: textures.body.roughnessMap, // ใช้ช่อง R ของ texture เดียวกัน
        iridescenceIOR: 1.32,
        iridescenceThicknessRange: [160, 480],
      })
    : new THREE.MeshStandardMaterial(bodyParams);

  // ครีบโปร่งแสง: เรืองแสงเล็กน้อยจาก texture ตัวเอง เหมือนแสงลอดผ่านเยื่อครีบ
  const fins = new THREE.MeshStandardMaterial({
    map: textures.fin,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    alphaTest: 0.01,
    roughness: 0.42,
    metalness: 0,
    emissive: new THREE.Color('#ffffff'),
    emissiveMap: textures.fin,
    emissiveIntensity: 0.22,
  });

  const eyeParams = { map: textures.eye, roughness: 0.18, metalness: 0.1 };
  const eyes = fancy ? new THREE.MeshPhysicalMaterial({ ...eyeParams, clearcoat: 1, clearcoatRoughness: 0.04 }) : new THREE.MeshStandardMaterial(eyeParams);
  return { body, fins, eyes };
}

/**
 * @param {{ variant?: string|object, detail?: 'high'|'medium'|'low', animated?: boolean, caustics?: boolean, mesh?: object|null }} options
 *  variant = id ใน variants.js หรือชุดสีที่ได้จาก genesToVariant (ลูกผสม)
 *  mesh    = ไฟล์ molly.glb ที่โหลดแล้ว → ใช้รูปทรงจากไฟล์และย้อมสีตามชุดสี (mollyMesh.js) ไม่มี = สร้างรูปทรงด้วยโค้ด
 * @returns {{ object: THREE.Group, swimUniforms: object|null, materials: object, variant: object }}
 *  เมื่อเลิกใช้ ให้เรียก object.userData.release() (disposeObject ใน AssetLoader เรียกให้อัตโนมัติ)
 */
export function createMolly({ variant = 'dalmatian', detail = 'high', animated = true, caustics = true, mesh = null } = {}) {
  const V = typeof variant === 'object' && variant ? variant : getMollyVariant(variant);
  const D = MOLLY_DETAIL[detail] ? detail : 'high';
  const fromFile = mesh && createMeshMolly(mesh, V, { detail: D, animated, caustics });
  if (fromFile) return fromFile;
  const geo = getMollyGeometry(D);
  // ลูกผสมทุกตัวมีลายเฉพาะตัว → ใช้ texture เล็กลงเพื่อประหยัดหน่วยความจำ
  const size = V.hybrid ? Math.min(MOLLY_DETAIL[D].texture, D === 'low' ? 256 : 512) : MOLLY_DETAIL[D].texture;
  const { textures, release } = acquireMollyTextures(V, size);
  const materials = createMaterials(V, D, textures);

  let swimUniforms = null;
  if (animated) {
    swimUniforms = createMollySwimUniforms();
    const swim = createMollySwimMod(swimUniforms);
    applyShaderMods(materials.body, [swim, caustics ? causticsMod : null]);
    applyShaderMods(materials.eyes, [swim]);
    applyShaderMods(materials.fins, [swim]);
  }

  const group = new THREE.Group();
  group.name = `molly-${V.id}`;
  const body = new THREE.Mesh(geo.body, materials.body);
  body.castShadow = true;
  const eyes = new THREE.Mesh(geo.eyes, materials.eyes);
  const fins = new THREE.Mesh(geo.fins, materials.fins);
  fins.renderOrder = 1;
  group.add(body, eyes, fins);
  group.userData.parts = { body, eyes, fins };
  group.userData.release = release;
  return { object: group, swimUniforms, materials, variant: V };
}
