/**
 * แปลงปลาสอดตัวยาวที่ส่งออกจาก Blender (Fish/export_molly_long.py) เป็นไฟล์ที่เกมใช้: public/models/fish/molly_long.glb
 *
 *   node scripts/build-molly-long-model.mjs [input.glb] [output.glb]
 *
 * ต่างจาก build-molly-model.mjs (ไฟล์จาก Meshy) ตรงที่ไฟล์จาก Blender มี _FIN / _EYE และพิกัดตามเกมมาแล้ว
 * (หัวไป +Z ปลายจมูก z=+0.5 โคนหาง z=-0.5) — สคริปต์นี้ทำแค่ขั้นสุดท้ายให้เหมือน molly.glb
 *  - คำนวณความสว่างปกติของลำตัวในเท็กซ์เจอร์ (texRef) ที่ shader ย้อมสีใช้ปรับเงาเกล็ด
 *  - ลดโพลิกอน 2 ระดับ (ปกติ / มือถือ) แยกลำตัว (ทึบ) กับครีบ (โปร่งแสง) เป็นคนละ mesh
 *  - ย่อเท็กซ์เจอร์เป็น 1024px WebP และบีบอัด geometry ด้วย Meshopt
 * extras ของวัสดุจาก Blender (belly, dorsalFan, tailFan …) ส่งต่อให้ mollyMesh.js ตามเดิม และเพิ่ม thinFins
 * (ครีบเป็นแผ่นหน้าเดียว ต้องวาด 2 ด้าน — ครีบของ molly.glb มีความหนา)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, prune, reorder, simplifyPrimitive, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const [INPUT = 'Fish/molly_long_src.glb', OUTPUT = 'public/models/fish/molly_long.glb'] = process.argv.slice(2);

/** จำนวนสามเหลี่ยมของแต่ละระดับ (เท่ากับ molly.glb) */
const LODS = [
  { suffix: '', triangles: 16000 },
  { suffix: '_low', triangles: 6000 },
];
const TEXTURE_SIZE = 1024;

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptEncoder });
const doc = await io.read(INPUT);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
await doc.transform(weld());

const meshNode = root.listNodes().find((n) => n.getMesh());
const mesh = meshNode.getMesh();
const prim = mesh.listPrimitives()[0];
const material = prim.getMaterial();
for (const semantic of ['_FIN', '_EYE', 'TEXCOORD_0']) if (!prim.getAttribute(semantic)) throw new Error(`ไฟล์ไม่มี ${semantic} — ส่งออกด้วย Fish/export_molly_long.py`);
material.setMetallicRoughnessTexture(null);

// ── ความสว่างปกติของลำตัวในเท็กซ์เจอร์ (ค่ากลาง) ───────────────────
const uvs = prim.getAttribute('TEXCOORD_0').getArray();
const fin = prim.getAttribute('_FIN').getArray();
const eye = prim.getAttribute('_EYE').getArray();
const { data: px, info } = await sharp(Buffer.from(material.getBaseColorTexture().getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const bright = [];
for (let i = 0; i < eye.length; i++) {
  if (fin[2 * i] > 0 || eye[i] > 0.5) continue;
  const x = Math.min(info.width - 1, Math.max(0, Math.round(uvs[2 * i] * (info.width - 1))));
  const y = Math.min(info.height - 1, Math.max(0, Math.round(uvs[2 * i + 1] * (info.height - 1))));
  const o = (y * info.width + x) * 3;
  bright.push(Math.max(px[o], px[o + 1], px[o + 2]) / 255);
}
bright.sort((a, b) => a - b);
const texRef = bright[Math.floor(bright.length / 2)] ?? 0.93;
// ไม่มีลายด่างในเท็กซ์เจอร์ → ชั้นลายด่าง (patches) สุ่มด้วย shader แทน
material.setExtras({ ...material.getExtras(), texRef, patches: false, thinFins: true });
console.log(`ความสว่างปกติของเท็กซ์เจอร์ ${texRef.toFixed(2)}`);

// ── ลดโพลิกอน แล้วแยกลำตัว/ครีบ ───────────────────────────────────
const buffer = root.listBuffers()[0];
const finMaterial = material.clone().setName('molly_fins').setAlphaMode('BLEND').setDoubleSided(true);
material.setName('molly_body').setAlphaMode('OPAQUE').setDoubleSided(false);
const T = prim.getIndices().getCount() / 3;

function copyPrimitive(src) {
  const out = doc.createPrimitive().setMaterial(src.getMaterial());
  for (const semantic of src.listSemantics()) out.setAttribute(semantic, src.getAttribute(semantic).clone());
  return out.setIndices(src.getIndices().clone());
}

function splitPrimitive(src) {
  const I = src.getIndices().getArray();
  const f = src.getAttribute('_FIN').getArray();
  const body = [];
  const fins = [];
  for (let t = 0; t < I.length; t += 3) {
    const allFin = f[2 * I[t]] > 0 && f[2 * I[t + 1]] > 0 && f[2 * I[t + 2]] > 0;
    (allFin ? fins : body).push(I[t], I[t + 1], I[t + 2]);
  }
  return [body, fins].map((list, k) => {
    const p = doc.createPrimitive().setMaterial(k ? finMaterial : material);
    for (const semantic of src.listSemantics()) p.setAttribute(semantic, src.getAttribute(semantic));
    p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(list)).setBuffer(buffer));
    return compactPrimitive(p);
  });
}

for (const lod of LODS) {
  const copy = copyPrimitive(prim);
  simplifyPrimitive(copy, { simplifier: MeshoptSimplifier, ratio: Math.min(1, lod.triangles / T), error: 0.002, lockBorder: false });
  const [bodyPrim, finsPrim] = splitPrimitive(copy);
  copy.dispose();
  for (const [name, p] of [
    [`molly_body${lod.suffix}`, bodyPrim],
    [`molly_fins${lod.suffix}`, finsPrim],
  ]) {
    const m = doc.createMesh(name).addPrimitive(p);
    scene.addChild(doc.createNode(name).setMesh(m));
    console.log(`${name.padEnd(16)} ${p.getIndices().getCount() / 3} สามเหลี่ยม, ${p.getAttribute('POSITION').getCount()} จุด`);
  }
}
meshNode.dispose();
mesh.dispose();

await doc.transform(
  prune({ keepAttributes: true }),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_SIZE, TEXTURE_SIZE], quality: 88 }),
  reorder({ encoder: MeshoptEncoder }),
);
// บีบอัด geometry แบบไม่ quantize (shader ของปลาสอดอ่านตำแหน่งจุดตามหน่วยลำตัวตรง ๆ)
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await doc.transform(prune({ keepAttributes: true }));
await io.write(OUTPUT, doc);
console.log(`เขียน ${OUTPUT}`);
