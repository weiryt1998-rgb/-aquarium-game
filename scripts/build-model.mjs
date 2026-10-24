/**
 * แปลงโมเดลจาก Meshy AI (หรือไฟล์ .glb ทั่วไป) ให้พร้อมใช้ในเกม
 *
 *   node scripts/build-model.mjs <input.glb> <output.glb> [--fish] [--keep-skin] [--keep-anim] [--flex-open 0] [--triangles 12000] [--texture 1024]
 *
 *  - ถอดโครงกระดูก (rig อัตโนมัติของ Meshy มักเป็นแบบคน ไม่มีแอนิเมชัน) แล้วฝังตำแหน่งของ node ลงใน geometry
 *    --keep-skin = เก็บโครงกระดูกไว้ เมื่อกระดูกวางตามตัวสัตว์จริง (เช่นม้าน้ำ: กระดูกไล่ตามหางและคอ)
 *                  เกมหมุนข้อกระดูกเองตาม model.rig ใน src/data/fish.js (ดู src/render/boneRig.js)
 *  - ลดจำนวนสามเหลี่ยมให้ไม่เกิน --triangles (ค่าเริ่มต้น 12000) โดยรูปทรงคลาดได้ไม่เกิน --error (สัดส่วนของขนาดโมเดล ค่าเริ่มต้น 0.002)
 *    ถ้าลดได้ไม่ถึงเป้า (เช่นต้นไม้ที่ใบแยกเป็นชิ้นเล็กจำนวนมาก) ลองเพิ่ม --error 0.01
 *  - ย่อเท็กซ์เจอร์เป็น WebP ขนาด --texture px (ค่าเริ่มต้น 1024) และบีบอัด geometry ด้วย Meshopt
 *    --keep-anim = เก็บทั้งโครงกระดูกและแอนิเมชันในไฟล์ (รวม --keep-skin) สำหรับโมเดลที่ทำ rig + คลิปว่ายน้ำมาเอง
 *                  เกมเล่นคลิปที่ชื่อมีคำว่า "swim" ด้วย AnimationMixer (ไม่ต้องตั้ง model.motion / model.rig)
 *  - --fish = ย้ายพิกัดให้ตัวยาว 1 หน่วยตามแกน Z (หัว z=+0.5 ปลายหาง z=-0.5) จุดกึ่งกลางอยู่ที่ 0 (ยกเว้น --keep-skin)
 *             และคำนวณความพลิ้วของครีบ (attribute _FLEX ดู scripts/lib/flex.mjs)
 *             --flex-open N = ตัดครีบ/ชายผ้าที่แผ่ออกด้านข้างจนถูกนับเป็นลำตัวออก (ลองค่า 3–5)
 *             → ใช้ท่าว่ายจาก shader ได้โดยตั้ง model.motion ใน src/data/fish.js (ดู src/render/fishMotion.js)
 *    โมเดลต้องหันหัวไป +Z อยู่แล้ว (ถ้าไม่ใช่ ให้หมุนใน Blender ก่อน)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, getBounds, prune, reorder, simplify, textureCompress, transformMesh, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { computeFlex } from './lib/flex.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const FISH = args.includes('--fish');
const KEEP_ANIM = args.includes('--keep-anim');
const KEEP_SKIN = KEEP_ANIM || args.includes('--keep-skin');
const TRIANGLES = option('triangles', 12000);
const TEXTURE_SIZE = option('texture', 1024);
const ERROR = option('error', 0.002);
const [INPUT, OUTPUT] = args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.match(/^--(triangles|texture|flex-open|error)$/));
if (!INPUT || !OUTPUT) {
  console.error('ใช้: node scripts/build-model.mjs <input.glb> <output.glb> [--fish] [--keep-skin] [--keep-anim] [--flex-open 0] [--triangles 12000] [--texture 1024]');
  process.exit(1);
}

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(INPUT);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];

// ── 1. ถอดโครงกระดูก + ฝังตำแหน่ง node ลง geometry → mesh ทุกชิ้นอยู่ที่ราก scene ──
const meshNodes = KEEP_SKIN ? [] : root.listNodes().filter((n) => n.getMesh());
for (const node of meshNodes) {
  const matrix = node.getWorldMatrix();
  node.setSkin(null);
  for (const prim of node.getMesh().listPrimitives()) for (const name of ['JOINTS_0', 'WEIGHTS_0']) prim.setAttribute(name, null);
  transformMesh(node.getMesh(), matrix);
  node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  scene.addChild(node);
}
if (!KEEP_ANIM) for (const a of root.listAnimations()) a.dispose();
if (!KEEP_SKIN) {
  for (const s of root.listSkins()) s.dispose();
  for (const n of root.listNodes()) if (!n.getMesh()) n.dispose();
}

// ── 2. ลดสามเหลี่ยม ───────────────────────────────────────────────
await doc.transform(weld());
const countTriangles = () => root.listMeshes().reduce((sum, m) => sum + m.listPrimitives().reduce((s, p) => s + (p.getIndices()?.getCount() ?? 0) / 3, 0), 0);
const before = countTriangles();
if (before > TRIANGLES) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: TRIANGLES / before, error: ERROR }));
console.log(`สามเหลี่ยม ${before} → ${countTriangles()}`);

// ── 3. ปลา: ยาว 1 หน่วยตามแกน Z จุดกึ่งกลางที่ 0 ─────────────────────
if (FISH) {
  // มีโครงกระดูก: ย้ายพิกัดไม่ได้ (ต้องแก้ทั้งกระดูก) — shader แปลงพิกัดเองจากขอบเขตของ geometry
  if (!KEEP_SKIN) {
    const { min, max } = getBounds(scene);
    const s = 1 / (max[2] - min[2]);
    const c = [0, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
    const matrix = [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -c[0] * s, -c[1] * s, -c[2] * s, 1];
    for (const mesh of root.listMeshes()) transformMesh(mesh, matrix);
    console.log(`ขนาดเดิม ${max.map((v, i) => (v - min[i]).toFixed(2)).join(' × ')} → ย่อ ${s.toFixed(3)} เท่า`);
  }

  // ความพลิ้วของแต่ละจุด (ครีบ/ชายผ้าบาง ๆ ที่อยู่ห่างลำตัว) → attribute _FLEX ให้ shader ใน src/render/fishMotion.js
  const prims = root.listMeshes().flatMap((m) => m.listPrimitives());
  const flex = computeFlex(prims.map((p) => ({ pos: p.getAttribute('POSITION').getArray(), idx: p.getIndices().getArray() })), { open: option('flex-open', 0) });
  const buffer = root.listBuffers()[0];
  prims.forEach((p, k) => p.setAttribute('_FLEX', doc.createAccessor().setType('SCALAR').setArray(flex[k]).setBuffer(buffer)));
  const all = flex.flatMap((f) => Array.from(f));
  console.log(`จุดที่พลิ้วได้ ${((all.filter((f) => f > 0.05).length / all.length) * 100).toFixed(0)}%`);
}

// ── 4. เท็กซ์เจอร์ + บีบอัด ─────────────────────────────────────────
await doc.transform(
  prune({ keepAttributes: true }),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_SIZE, TEXTURE_SIZE], quality: 88 }),
  reorder({ encoder: MeshoptEncoder }),
);
// ไม่ quantize: shader ว่ายน้ำอ่านตำแหน่งจุดตามหน่วยจริงของโมเดล
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(OUTPUT, doc);
const { min, max } = getBounds(scene);
console.log(`เขียน ${OUTPUT}  ขนาด ${max.map((v, i) => (v - min[i]).toFixed(2)).join(' × ')}`);
