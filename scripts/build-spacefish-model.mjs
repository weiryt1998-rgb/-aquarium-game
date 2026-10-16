/**
 * แปลงโมเดลปลาจาก Meshy AI เป็นรูปทรงของปลาอวกาศ: public/models/fish/spacefish.glb
 *
 *   node scripts/build-spacefish-model.mjs <input.glb> [output.glb] [--debug] [--texture=2048]
 *
 *   ตัวเต็มวัย: node scripts/build-spacefish-model.mjs Fish/โมเดลปลาอวกาศ.glb public/models/fish/spacefish.glb --texture=2048
 *   ลูกปลา:    node scripts/build-spacefish-model.mjs Fish/โมเดลูกกปลาอวกาศ.glb public/models/fish/spacefish_baby.glb
 *
 * เกมใช้แค่รูปทรงกับเงาเกล็ดจากไฟล์ แล้ววาดลายกาแล็กซีตามสีของแต่ละสายพันธุ์เอง (src/models/spacefish/spaceFishMesh.js)
 *  - ถอดโครงกระดูก ย้ายพิกัด: หันหัวไป +Z ยาวรวม TOTAL_LENGTH หน่วย จุดกึ่งกลางที่ 0 (โมเดลต้องหันหัวไป +Z อยู่แล้ว)
 *  - _FLEX = ความพลิ้วของครีบ (scripts/lib/flex.mjs) — ใช้ทั้งท่าว่าย และแยกครีบ (โปร่งแสง) ออกจากลำตัว
 *  - _EYE  = ตา (จุดสีเข้มบนหัว) ใช้สีเดิมจากเท็กซ์เจอร์ ไม่วาดลายทับ
 *  - ลดโพลิกอน 2 ระดับ (ปกติ / มือถือ) → mesh spacefish_body, spacefish_fins, spacefish_body_low, spacefish_fins_low
 *  - material.extras.texRef = ความสว่างปกติของเท็กซ์เจอร์ (ใช้ปรับเงาเกล็ดให้ไม่มืด/สว่างเกิน)
 * --debug = เขียน *.debug.glb ระบายสี: ลำตัวเทา ครีบแดง (เข้มตามความพลิ้ว) ตาดำ
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, getBounds, prune, reorder, simplifyPrimitive, textureCompress, transformMesh, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { computeFlex } from './lib/flex.mjs';

const args = process.argv.slice(2);
const DEBUG = args.includes('--debug');
/** ขนาด texture ในไฟล์ (เท็กซ์เจอร์จาก Meshy เป็นชิ้นเล็ก ๆ กระจายทั้งภาพ ย่อมากไปลายดาวจะหาย) */
const option = (name, fallback) => Number(args.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback);
const TEXTURE = option('texture', 1024);
/** ตัดครีบที่แผ่ออกด้านข้างจนถูกนับเป็นลำตัว (ครีบท้องยาว ๆ ของโมเดลปลากัด) — ดู scripts/lib/flex.mjs */
const FLEX_OPEN = option('flex-open', 0);
/**
 * ลำตัวในภาพด้านข้างเป็นวงรี --body=y,z,ครึ่งความสูง,ครึ่งความยาว (หน่วยหลังย่อแล้ว) — จุดนอกวงรีนับเป็นครีบเสมอ
 * (ครีบท้องยาวที่ห้อยลงและแผ่ออกด้านข้างจะหนาจนถูกนับเป็นลำตัว) ความพลิ้วเพิ่มตามระยะห่างจากวงรี
 */
const BODY = args.find((a) => a.startsWith('--body='))?.split('=')[1].split(',').map(Number) ?? null;
/** ความสว่างสูงสุดของตาดำบนเท็กซ์เจอร์ */
const EYE_DARK = option('eye-dark', 0.08);
const [INPUT, OUTPUT = 'public/models/fish/spacefish.glb'] = args.filter((a) => !a.startsWith('--'));
if (!INPUT) {
  console.error('ใช้: node scripts/build-spacefish-model.mjs <input.glb> [output.glb] [--debug]');
  process.exit(1);
}
/** ความยาวรวม (ปลายปาก → ปลายหาง) ใกล้เคียงปลาอวกาศแบบสร้างด้วยโค้ด (SPACEFISH_TOTAL_LENGTH) */
const TOTAL_LENGTH = 2.0;
/** error = ความคลาดเคลื่อนที่ยอมให้ตอนลดโพลิกอน (ครีบพลิ้วรายละเอียดเยอะ ต้องยอมมากขึ้นถึงจะลดได้ตามเป้า) */
const LODS = [
  { suffix: '', triangles: 14000, error: 0.004 },
  { suffix: '_low', triangles: 6000, error: 0.02 },
];
/** ความพลิ้วที่ถือว่าเป็นครีบ (ทั้ง 3 มุมของสามเหลี่ยมต้องเกิน) */
const FIN_FLEX = 0.22;

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(INPUT);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
const buffer = root.listBuffers()[0];

// ── 1. ถอดโครงกระดูก ฝังตำแหน่ง node แล้วย้ายพิกัด ─────────────────
const meshNode = root.listNodes().find((n) => n.getMesh());
const prim = meshNode.getMesh().listPrimitives()[0];
transformMesh(meshNode.getMesh(), meshNode.getWorldMatrix());
meshNode.setSkin(null).setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
for (const name of ['JOINTS_0', 'WEIGHTS_0']) prim.setAttribute(name, null);
scene.addChild(meshNode);
for (const s of root.listSkins()) s.dispose();
for (const a of root.listAnimations()) a.dispose();
for (const n of root.listNodes()) if (n !== meshNode) n.dispose();
await doc.transform(weld());

{
  const { min, max } = getBounds(scene);
  const s = TOTAL_LENGTH / (max[2] - min[2]);
  const c = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  transformMesh(meshNode.getMesh(), [s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, -c[0] * s, -c[1] * s, -c[2] * s, 1]);
  console.log(`ขนาดเดิม ${max.map((v, i) => (v - min[i]).toFixed(2)).join(' × ')} → ย่อ ${s.toFixed(3)} เท่า`);
}

const pos = prim.getAttribute('POSITION').getArray();
const uvs = prim.getAttribute('TEXCOORD_0').getArray();
const V = pos.length / 3;

// ── 2. ความพลิ้วของครีบ ─────────────────────────────────────────
const [flex] = computeFlex([{ pos, idx: prim.getIndices().getArray() }], { open: FLEX_OPEN });
// ปาก/จะงอยยื่นไปข้างหน้าแคบ ๆ จึงถูกนับเป็นครีบ → ช่วงหัว (หน้าสุด 22% ของตัว) ไม่พลิ้ว
for (let i = 0; i < V; i++) flex[i] *= 1 - smoothstep(TOTAL_LENGTH * 0.24, TOTAL_LENGTH * 0.28, pos[3 * i + 2]);
if (BODY) {
  const [yc, zc, b, a] = BODY;
  for (let i = 0; i < V; i++) {
    const e = Math.hypot((pos[3 * i + 1] - yc) / b, (pos[3 * i + 2] - zc) / a);
    flex[i] = Math.max(flex[i], Math.min(1, Math.max(0, (e - 1) / 2)));
  }
}

// ── 3. ตา + ความสว่างปกติของเท็กซ์เจอร์ ───────────────────────────
const material = prim.getMaterial();
const { data: px, info } = await sharp(Buffer.from(material.getBaseColorTexture().getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const texel = (i) => {
  const x = Math.min(info.width - 1, Math.max(0, Math.round(uvs[2 * i] * (info.width - 1))));
  const y = Math.min(info.height - 1, Math.max(0, Math.round(uvs[2 * i + 1] * (info.height - 1))));
  const o = (y * info.width + x) * 3;
  return [px[o] / 255, px[o + 1] / 255, px[o + 2] / 255];
};
const brightness = [];
for (let i = 0; i < V; i++) if (flex[i] < FIN_FLEX) brightness.push(Math.max(...texel(i)));
brightness.sort((a, b) => a - b);
const texRef = brightness[Math.floor(brightness.length / 2)];

// ตา: จุดสีเข้มบนหัว (ครึ่งหน้า 20% ของตัว) ด้านข้าง และอยู่สูงกว่าแนวกลางหัว (ไม่ใช่ในปาก)
const headZ = TOTAL_LENGTH / 2 - TOTAL_LENGTH * 0.2;
const eyes = [-1, 1].map(() => ({ sum: [0, 0, 0], pts: [] }));
let headY = 0;
let headN = 0;
for (let i = 0; i < V; i++) if (pos[3 * i + 2] > headZ && flex[i] < FIN_FLEX) (headY += pos[3 * i + 1]), headN++;
headY /= Math.max(headN, 1);
for (let i = 0; i < V; i++) {
  const [x, y, z] = [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
  if (z < headZ || y < headY || Math.abs(x) < 0.02 || flex[i] >= FIN_FLEX) continue;
  const [r, g, b] = texel(i);
  if (0.3 * r + 0.59 * g + 0.11 * b > EYE_DARK) continue;
  const e = eyes[x < 0 ? 0 : 1];
  e.pts.push([x, y, z]);
  e.sum = e.sum.map((v, a) => v + [x, y, z][a]);
}
for (const e of eyes) {
  e.center = e.sum.map((v) => v / Math.max(e.pts.length, 1));
  const ds = e.pts.map((p) => Math.hypot(p[0] - e.center[0], p[1] - e.center[1], p[2] - e.center[2])).sort((a, b) => a - b);
  e.radius = (ds[Math.floor(ds.length * 0.9)] ?? 0) * 1.5;
}
const eye = new Float32Array(V);
for (let i = 0; i < V; i++) {
  const e = eyes[pos[3 * i] < 0 ? 0 : 1];
  if (!e.pts.length) continue;
  const d = Math.hypot(pos[3 * i] - e.center[0], pos[3 * i + 1] - e.center[1], pos[3 * i + 2] - e.center[2]);
  eye[i] = 1 - smoothstep(e.radius * 0.8, e.radius * 1.2, d);
}
console.log(`ตา ${eyes.map((e) => `${e.pts.length} จุด รัศมี ${e.radius.toFixed(3)}`).join(' | ')}  ความสว่างปกติของเท็กซ์เจอร์ ${texRef.toFixed(2)}`);

prim.setAttribute('_FLEX', doc.createAccessor().setType('SCALAR').setArray(flex).setBuffer(buffer));
prim.setAttribute('_EYE', doc.createAccessor().setType('SCALAR').setArray(eye).setBuffer(buffer));

// ── 4. ลดโพลิกอน แล้วแยกลำตัว/ครีบ ───────────────────────────────
material.setMetallicRoughnessTexture(null).setExtras({ texRef });
const finMaterial = material.clone().setAlphaMode('BLEND');

function copyPrimitive(src) {
  const out = doc.createPrimitive().setMaterial(src.getMaterial());
  for (const semantic of src.listSemantics()) out.setAttribute(semantic, src.getAttribute(semantic).clone());
  return out.setIndices(src.getIndices().clone());
}

function split(src) {
  const I = src.getIndices().getArray();
  const f = src.getAttribute('_FLEX').getArray();
  const lists = [[], []];
  for (let t = 0; t < I.length; t += 3) lists[f[I[t]] > FIN_FLEX && f[I[t + 1]] > FIN_FLEX && f[I[t + 2]] > FIN_FLEX ? 1 : 0].push(I[t], I[t + 1], I[t + 2]);
  return lists.map((list, k) => {
    const p = doc.createPrimitive().setMaterial(k ? finMaterial : material);
    for (const semantic of src.listSemantics()) p.setAttribute(semantic, src.getAttribute(semantic));
    p.setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(list)).setBuffer(buffer));
    return compactPrimitive(p);
  });
}

const T = prim.getIndices().getCount() / 3;
for (const lod of LODS) {
  const copy = copyPrimitive(prim);
  simplifyPrimitive(copy, { simplifier: MeshoptSimplifier, ratio: Math.min(1, lod.triangles / T), error: lod.error });
  const parts = split(copy);
  copy.dispose();
  ['body', 'fins'].forEach((part, k) => {
    const name = `spacefish_${part}${lod.suffix}`;
    scene.addChild(doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(parts[k])));
    console.log(`${name.padEnd(20)} ${parts[k].getIndices().getCount() / 3} สามเหลี่ยม`);
  });
}
meshNode.getMesh().dispose();
meshNode.dispose();

await doc.transform(
  prune({ keepAttributes: true }),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE, TEXTURE], quality: 88 }),
  reorder({ encoder: MeshoptEncoder }),
);

if (DEBUG) {
  for (const p of root.listMeshes().flatMap((m) => m.listPrimitives())) {
    const f = p.getAttribute('_FLEX').getArray();
    const e = p.getAttribute('_EYE').getArray();
    const col = new Float32Array(f.length * 3);
    for (let i = 0; i < f.length; i++) col.set(e[i] > 0.5 ? [0.02, 0.02, 0.02] : f[i] > FIN_FLEX ? [0.4 + 0.6 * f[i], 0.15, 0.15] : [0.8, 0.8, 0.8], 3 * i);
    p.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buffer));
  }
  const tex = material.getBaseColorTexture();
  for (const m of [material, finMaterial]) m.setBaseColorTexture(null);
  await io.write(OUTPUT.replace(/\.glb$/, '.debug.glb'), doc);
  for (const m of [material, finMaterial]) m.setBaseColorTexture(tex);
  for (const p of root.listMeshes().flatMap((m) => m.listPrimitives())) p.setAttribute('COLOR_0', null);
}

// ไม่ quantize: shader อ่านตำแหน่งจุดตามหน่วยจริงของโมเดล
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await doc.transform(prune({ keepAttributes: true }));
await io.write(OUTPUT, doc);
console.log(`เขียน ${OUTPUT}`);

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
