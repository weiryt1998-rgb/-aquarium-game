/**
 * แปลงโมเดลฟาร์มที่ส่งออกจาก Blender (Fish/farm/out/*.glb) → public/models/farm/*.glb พร้อมใช้ในเกม
 *
 *   node scripts/build-farm-models.mjs
 *
 * ที่มา: สร้างด้วยโค้ดทั้งหมดใน Fish/farm/ (farm_lib.py, build_textures.py, build_props.py, build_cow*.py, export_farm.py)
 *  - วัสดุทึบ → ด้านเดียว (ประหยัดการวาด) · ใบไม้ → alphaMode MASK (ตัดขอบใบ ไม่ต้องเรียงลำดับความโปร่งใส)
 *  - เท็กซ์เจอร์ → WebP (ลายต่อกันของอาคาร 512 px · ผิววัว 2048 px / normal 1024 px) · geometry → Meshopt
 *  - วัว: เก็บโครงกระดูก + คลิป Walk / Graze / Idle · ลายวัวเจอร์ซีย์เป็นภาพแยก cow_jersey.webp (ใช้ mesh เดียวกัน)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, prune, reorder, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import sharp from 'sharp';
import fs from 'node:fs';

const SRC = 'Fish/farm/out';
const OUT = 'public/models/farm';
const ASSETS = [
  { name: 'house', texture: 512 },
  { name: 'barn', texture: 512 },
  { name: 'fence', texture: 512 },
  { name: 'tree_a', texture: 512 },
  { name: 'tree_b', texture: 512 },
  { name: 'cow', texture: 2048, normal: 1024, anim: true },
  // วัวบราห์มัน (Fish/farm/build_brahman.py จากโมเดล Meshy): คลิป Walk Graze Drink LieDown Lie StandUp Idle
  { name: 'brahman', texture: 2048, normal: 1024, anim: true },
  // ลูกวัวบราห์มัน (Fish/farm/build_brahman_calf.py ดัดจากตัวพ่อ) — คลิปชุดเดียวกัน
  { name: 'brahman_calf', texture: 2048, normal: 1024, anim: true },
  // ของตกแต่งรอบบ้าน/โรงนา (Fish/farm/build_decor.py) — วัตถุแยกชื่อ เกมวางซ้ำด้วย InstancedMesh (world/FarmDecor.js)
  { name: 'decor', texture: 512 },
];

await MeshoptEncoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
fs.mkdirSync(OUT, { recursive: true });

for (const a of ASSETS) {
  const doc = await io.read(`${SRC}/${a.name}.glb`);
  const root = doc.getRoot();
  for (const m of root.listMaterials()) {
    const leaves = /leaves/i.test(m.getName());
    m.setDoubleSided(leaves);
    if (leaves) m.setAlphaMode('MASK').setAlphaCutoff(0.5);
    else m.setAlphaMode('OPAQUE');
  }
  if (!a.anim) for (const anim of root.listAnimations()) anim.dispose();
  await doc.transform(
    weld(),
    prune({ keepAttributes: true }),
    dedup(),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^(?!normalTexture).*$/, resize: [a.texture, a.texture], quality: 86 }),
    textureCompress({ encoder: sharp, targetFormat: 'webp', slots: /^normalTexture$/, resize: [a.normal ?? a.texture, a.normal ?? a.texture], quality: 90 }),
    reorder({ encoder: MeshoptEncoder }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const file = `${OUT}/${a.name}.glb`;
  await io.write(file, doc);
  const tris = root.listMeshes().reduce((s, m) => s + m.listPrimitives().reduce((t, p) => t + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
  console.log(`${file}  ${(fs.statSync(file).size / 1024).toFixed(0)} KB  สามเหลี่ยม ${tris}  คลิป [${root.listAnimations().map((x) => x.getName()).join(', ')}]`);
}

// ลายวัวเจอร์ซีย์ (สลับ map ของผิววัวในเกม)
await sharp(`${SRC}/cow_jersey_base.png`).resize(2048, 2048).webp({ quality: 86 }).toFile(`${OUT}/cow_jersey.webp`);
console.log(`${OUT}/cow_jersey.webp  ${(fs.statSync(`${OUT}/cow_jersey.webp`).size / 1024).toFixed(0)} KB`);
