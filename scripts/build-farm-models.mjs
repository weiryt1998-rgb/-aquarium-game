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
  { name: 'fence', texture: 512 }, // รั้วไม้ไผ่ (Fish/farm/build_fence_bamboo.py)
  { name: 'tree_a', texture: 512 },
  { name: 'tree_b', texture: 512 },
  { name: 'cow', texture: 2048, normal: 1024, anim: true },
  // วัวบราห์มันแดงตัวเมีย (Meshy → Fish/farm/meshy_import.blend ยืดลำตัว + fit_zebu.py): คลิป Walk Graze Drink LieDown Lie StandUp Idle
  { name: 'brahman', texture: 2048, normal: 1024, anim: true },
  // บราห์มันแดงตัวผู้ (ดัดจากตัวเมียใน meshy_import.blend: ไม่มีเต้านม มีหนอกใหญ่ + หุ้มลึงค์) — model.fileMale ใน animals.js
  { name: 'brahman_bull', texture: 2048, normal: 1024, anim: true },
  // ลูกวัวบราห์มันแดง (Meshy → Fish/farm/build_calf_red.py + fit_zebu.py) — คลิปชุดเดียวกัน ไม่มี Mount
  { name: 'brahman_calf', texture: 2048, normal: 1024, anim: true, dropClips: ['Mount'] },
  // ลูกวัวพื้นเมืองมีเขา (วัวพื้นเมืองสีน้ำตาล + วัวขาวลำพูน · build_calf_red.py) — ลำพูนใช้ภาพผิว cow_calf_white.webp
  { name: 'cow_calf', texture: 2048, normal: 1024, anim: true, dropClips: ['Mount'] },
  // วัวเซบูจาก Meshy (Fish/farm/fit_zebu.py) — ยืมโครงกระดูก + คลิปทั้งหมดของวัวบราห์มัน
  { name: 'cow_brown', texture: 2048, normal: 1024, anim: true },
  { name: 'cow_white', texture: 2048, normal: 1024, anim: true },
  // ตาเหม คนเลี้ยงวัว (Fish/farm/build_tahem.py) — คลิป HemIdle / HemWalk / HemTend
  { name: 'tahem', texture: 2048, anim: true },
  // ตัวละครคน 2 ตัว (Meshy → Fish/farm/build_player.py · ท่าทาง motion capture CMU ผ่าน mocap_retarget.py)
  // คลิป Idle Walk Run Tend Stretch Wave (ขึ้นต้น Pl = ผู้ชาย · Wm = ผู้หญิง)
  { name: 'player', texture: 2048, normal: 1024, anim: true },
  { name: 'woman', texture: 2048, normal: 1024, anim: true },
  // ต้นไม้ใหญ่ให้ร่มเงา (Meshy ลดเหลือ ~14k สามเหลี่ยม) — ใบเป็นเรขาคณิต ไม่ใช่ภาพตัดขอบ
  { name: 'tree_c', texture: 1024 },
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
  // คลิปของตาเหม (HemIdle/HemWalk/HemTend) อยู่ใน meshy_import.blend เดียวกับวัว → ไฟล์วัวที่ส่งออกจากไฟล์นั้นติดมาด้วย (ไม่มีกระดูกให้ขยับ) ตัดทิ้ง
  if (a.name !== 'tahem') for (const anim of root.listAnimations()) if (/^Hem/.test(anim.getName())) anim.dispose();
  for (const anim of root.listAnimations()) if (a.dropClips?.includes(anim.getName())) anim.dispose();
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
for (const [src, out] of [['cow_jersey_base.png', 'cow_jersey.webp'], ['cow_calf_white_base.png', 'cow_calf_white.webp']]) {
  await sharp(`${SRC}/${src}`).resize(2048, 2048).webp({ quality: 86 }).toFile(`${OUT}/${out}`);
  console.log(`${OUT}/${out}  ${(fs.statSync(`${OUT}/${out}`).size / 1024).toFixed(0)} KB`);
}
