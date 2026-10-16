import * as THREE from 'three';
import { applyShaderMods, causticsMod } from '../../render/shaderMods.js';
import { clamp, seededRandom, smoothstep } from '../../utils/math.js';
import { createMeshSpaceFish } from './spaceFishMesh.js';
import { getSpaceFishGeometry } from './spaceFishShape.js';
import { createSpaceBodyMod, createSpaceFinMod, createSpaceSwimMod, spaceAttrMod } from './spaceFishShaders.js';
import { getSpaceFishVariant } from './variants.js';

/**
 * โมเดลปลาอวกาศ (Space Fish) ระดับตำนาน — สร้างด้วยโค้ดทั้งหมด (geometry + shader)
 *
 * ใช้งาน:
 *   const { object, swimUniforms, trail } = createSpaceFish({ variant: 'nebula_blue' });
 *   // ทุกเฟรม: swimUniforms.uSwimPhase / uSwimAmp / uTurn เหมือน Molly
 *   //          swimUniforms.uEnergy.value = 0..1 (ว่ายเร็ว → เรืองแสงแรงขึ้น)
 *   // trail = { colors, rate, offset } สำหรับปล่อยอนุภาคแสงตามหลัง (ดู world/Sparkles.js)
 *
 * object หันหัวไป +Z ลำตัวยาว 1 หน่วย (ไม่รวมหาง) จุดศูนย์กลางอยู่กลางลำตัว — ตรงกับปลาตัวอื่นในเกม
 * geometry ใช้ร่วมกันทุกตัว / material แยกต่อตัว แต่ใช้ shader program เดียวกันทุกสี
 * ถ้าส่งไฟล์ spacefish.glb มาใน options.mesh จะใช้รูปทรงจากไฟล์แทน (ดู spaceFishMesh.js) — แบบนี้เป็นตัวสำรองเมื่อไม่มีไฟล์
 */

/** ความยาวรวมจากปลายจมูกถึงปลายหาง เทียบกับลำตัว 1 หน่วย */
export const SPACEFISH_TOTAL_LENGTH = 2.1;

const OCTAVES = { high: 4, medium: 3, low: 2 };

const eyeTextures = new Map();

/** ตาแบบกาแล็กซี: รูม่านตามืดมีดาว ม่านตาเรืองแสงไล่สี วงนอกสีทอง */
function getEyeTexture(variant) {
  if (eyeTextures.has(variant.id)) return eyeTextures.get(variant.id);
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const iris = new THREE.Color(variant.iris);
  const deep = new THREE.Color(variant.deep).multiplyScalar(0.35);
  const gold = new THREE.Color('#e9b45a');
  const pupil = new THREE.Color('#05030c');
  const c = new THREE.Color();
  const rnd = seededRandom(0.4242);
  const stars = Array.from({ length: 14 }, () => [rnd() - 0.5, rnd() - 0.5, 0.008 + rnd() * 0.012]);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S - 0.5;
      const dy = (y + 0.5) / S - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const ang = Math.atan2(dy, dx);
      const streak = 0.75 + 0.25 * Math.sin(ang * 19) * Math.sin(ang * 5 + 1.1);
      c.copy(pupil);
      // ดาวในรูม่านตา
      for (const [sx, sy, sr] of stars) if (Math.hypot(dx - sx * 0.4, dy - sy * 0.4) < sr) c.set('#ffffff');
      const irisK = smoothstep(0.4, 0.46, r) * (1 - smoothstep(0.68, 0.74, r));
      c.lerp(iris.clone().lerp(new THREE.Color('#ffffff'), smoothstep(0.62, 0.46, r) * 0.45).multiplyScalar(streak), irisK);
      c.lerp(gold, smoothstep(0.7, 0.76, r) * (1 - smoothstep(0.84, 0.9, r)));
      if (r > 0.88) c.copy(deep);
      const i = (y * S + x) * 4;
      d[i] = clamp(c.r, 0, 1) * 255;
      d[i + 1] = clamp(c.g, 0, 1) * 255;
      d[i + 2] = clamp(c.b, 0, 1) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  eyeTextures.set(variant.id, tex);
  return tex;
}

let haloTexture = null;

/** แสงฟุ้งกลม ๆ (ใช้ร่วมกันทุกตัว ย้อมสีด้วย SpriteMaterial.color) */
function getHaloTexture() {
  if (haloTexture) return haloTexture;
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = S;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  haloTexture = new THREE.CanvasTexture(canvas);
  haloTexture.userData.shared = true;
  return haloTexture;
}

function createMaterials(variant, detail, energy) {
  const fancy = detail !== 'low';
  const bodyParams = { color: '#ffffff', roughness: 0.28, metalness: 0.05, emissive: '#000000' };
  const body = fancy
    ? new THREE.MeshPhysicalMaterial({ ...bodyParams, clearcoat: 1, clearcoatRoughness: 0.08, iridescence: 0.45, iridescenceIOR: 1.35, iridescenceThicknessRange: [180, 520] })
    : new THREE.MeshStandardMaterial(bodyParams);
  const fins = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    alphaTest: 0.01,
    roughness: 0.35,
    metalness: 0,
    emissive: '#000000',
  });
  const eyeTex = getEyeTexture(variant);
  const eyeParams = { map: eyeTex, emissive: '#ffffff', emissiveMap: eyeTex, emissiveIntensity: 0.9, roughness: 0.12, metalness: 0.1 };
  const eyes = fancy ? new THREE.MeshPhysicalMaterial({ ...eyeParams, clearcoat: 1, clearcoatRoughness: 0.03 }) : new THREE.MeshStandardMaterial(eyeParams);
  const octaves = OCTAVES[detail] ?? 4;
  applyShaderMods(body, [spaceAttrMod]);
  applyShaderMods(fins, [spaceAttrMod]);
  applyShaderMods(eyes, [spaceAttrMod]);
  return { body, fins, eyes, bodyMod: createSpaceBodyMod(variant, energy, octaves), finMod: createSpaceFinMod(variant, energy, octaves) };
}

/**
 * @param {{ variant?: string, detail?: 'high'|'medium'|'low', animated?: boolean, mesh?: object|null, baby?: boolean }} options
 *  mesh = ไฟล์ spacefish.glb ที่โหลดแล้ว · baby = mesh เป็นไฟล์ลูกปลาแรกเกิด (spacefish_baby.glb) แสงฟุ้งและประกายดาวเบากว่า
 * @returns {{ object: THREE.Group, swimUniforms: object|null, trail: object|null, variant: object }}
 */
export function createSpaceFish({ variant = 'nebula_blue', detail = 'high', animated = true, mesh = null, baby = false } = {}) {
  const V = getSpaceFishVariant(variant);
  const energy = { value: 0 };
  const fromFile = mesh && createMeshSpaceFish(mesh, V, { detail, animated, energy, baby });
  if (fromFile) {
    const { object, body, fins, swimUniforms, tailZ } = fromFile;
    object.name = `spacefish-${V.id}`;
    const trail = animated ? addGlow(object, V, tailZ, baby) : null;
    object.userData.parts = { body, fins };
    return { object, swimUniforms, trail, variant: V };
  }
  const geo = getSpaceFishGeometry(detail);
  const M = createMaterials(V, detail, energy);

  let swimUniforms = null;
  if (animated) {
    swimUniforms = { uSwimPhase: { value: Math.random() * 10 }, uSwimAmp: { value: 0.08 }, uTurn: { value: 0 }, uFinSeed: { value: Math.random() * 100 }, uEnergy: energy };
    const swim = createSpaceSwimMod(swimUniforms);
    applyShaderMods(M.body, [swim, M.bodyMod, causticsMod]);
    applyShaderMods(M.fins, [swim, M.finMod]);
    applyShaderMods(M.eyes, [swim]);
  } else {
    applyShaderMods(M.body, [M.bodyMod]);
    applyShaderMods(M.fins, [M.finMod]);
  }

  const group = new THREE.Group();
  group.name = `spacefish-${V.id}`;
  const body = new THREE.Mesh(geo.body, M.body);
  body.castShadow = true;
  const eyes = new THREE.Mesh(geo.eyes, M.eyes);
  const fins = new THREE.Mesh(geo.fins, M.fins);
  fins.renderOrder = 1;
  group.add(body, eyes, fins);

  const trail = animated ? addGlow(group, V, -1.05) : null;
  group.userData.parts = { body, eyes, fins };
  return { object: group, swimUniforms, trail, variant: V };
}

/**
 * แสงฟุ้งรอบตัว (เฉพาะในตู้ — รูปตัวอย่างใน UI ไม่ต้องมี) และค่าประกายดาวที่ปล่อยตามหลัง
 * @param {number} tailZ ตำแหน่งปลายหางบนแกน z (จุดปล่อยประกายดาว)
 * @param {boolean} baby ลูกปลาแรกเกิด: แสงฟุ้งจางลงครึ่งหนึ่ง ประกายดาวน้อยลง
 */
function addGlow(group, V, tailZ, baby = false) {
  const opacity = (V.light ? 0.22 : 0.32) * (baby ? 0.5 : 1);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: getHaloTexture(), color: new THREE.Color(V.glow), transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.scale.set(2.5, 1.7, 1);
  halo.position.set(0, -0.02, -0.35);
  halo.renderOrder = 2;
  group.add(halo);
  group.userData.release = () => halo.material.dispose(); // disposeObject ไม่ล้างวัสดุของ Sprite
  return { colors: V.trail.map((c) => new THREE.Color(c)), rate: baby ? 6 : 16, offset: tailZ };
}
