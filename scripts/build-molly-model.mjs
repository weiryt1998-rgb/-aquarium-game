/**
 * แปลงโมเดลปลาสอดจาก Meshy AI (Fish/*.glb) เป็นไฟล์ที่เกมใช้: public/models/fish/molly.glb
 *
 *   node scripts/build-molly-model.mjs [input.glb] [output.glb] [--debug]
 *
 * สิ่งที่ทำ
 *  - ถอดโครงกระดูก (rig อัตโนมัติของ Meshy เป็นแบบคน ใช้ว่ายน้ำไม่ได้) → เกมขยับลำตัวด้วย shader แทน (models/molly/mollySwim.js)
 *  - แยกครีบออกจากลำตัวด้วยความหนา (ครีบบางเป็นแผ่น) แล้วระบุชนิดครีบจากตำแหน่ง
 *    เก็บเป็น attribute _FIN = (ชนิดชิ้นส่วนตาม PART ใน mollyShape.js, น้ำหนัก 0 ที่โคน → 1 ที่ปลาย)
 *  - หาตาจากสีเข้มบนเท็กซ์เจอร์ → attribute _EYE (1 = ตา ไม่ย้อมสี)
 *  - ย้ายพิกัดให้ตรงกับปลาสอดในเกม: หัวไป +Z ปลายจมูก z=+0.5 โคนหาง z=-0.5 (ลำตัวยาว 1 หน่วย)
 *  - ลดจำนวนโพลิกอน 2 ระดับ (ปกติ / มือถือ) แยกลำตัว (ทึบ) กับครีบ (โปร่งแสง) เป็นคนละ mesh
 *  - ย่อเท็กซ์เจอร์เป็น 1024px WebP ทิ้ง metallic/roughness (ใช้ค่าตามสีของปลาแทน) และบีบอัด geometry ด้วย Meshopt
 * --debug = เขียนไฟล์ *.debug.glb เพิ่ม ระบายสีตามชิ้นส่วน (ไว้ตรวจการแยกครีบ)
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { compactPrimitive, dedup, prune, reorder, simplifyPrimitive, textureCompress, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const args = process.argv.slice(2);
const DEBUG = args.includes('--debug');
const [INPUT = 'Fish/Meshy_AI_Character_output.glb', OUTPUT = 'public/models/fish/molly.glb'] = args.filter((a) => !a.startsWith('--'));

/** ต้องตรงกับ PART ใน src/models/molly/mollyShape.js */
const PART = { body: 0, tail: 1, dorsal: 2, pectoralL: 3, pectoralR: 4, pelvicL: 5, pelvicR: 6, anal: 7 };
/** จำนวนสามเหลี่ยมของแต่ละระดับ */
const LODS = [
  { suffix: '', triangles: 16000 },
  { suffix: '_low', triangles: 6000 },
];
/** ความหนาที่ถือว่าเป็นครีบ (สัดส่วนของความยาวลำตัว) */
const FIN_THICKNESS = 0.035;
const TEXTURE_SIZE = 1024;

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptEncoder });
const doc = await io.read(INPUT);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];

// ── 1. ถอดโครงกระดูก ───────────────────────────────────────────
const meshNode = root.listNodes().find((n) => n.getMesh());
const mesh = meshNode.getMesh();
const prim = mesh.listPrimitives()[0];
meshNode.setSkin(null);
for (const s of root.listSkins()) s.dispose();
for (const n of root.listNodes()) if (n !== meshNode) n.dispose();
scene.addChild(meshNode);
for (const name of ['JOINTS_0', 'WEIGHTS_0']) prim.setAttribute(name, null);
await doc.transform(weld());

const material = prim.getMaterial();
material.setMetallicRoughnessTexture(null);

const POS = prim.getAttribute('POSITION');
const NRM = prim.getAttribute('NORMAL');
const UV = prim.getAttribute('TEXCOORD_0');
const pos = POS.getArray();
const nrm = NRM.getArray();
const uvs = UV.getArray();
const idx = prim.getIndices().getArray();
const V = POS.getCount();
const T = idx.length / 3;

// ── 2. ความหนาที่แต่ละจุด: ยิงรังสีเข้าด้านในตาม -normal ไปชนผิวอีกด้าน ─────
let minZ = Infinity;
let maxZ = -Infinity;
for (let i = 0; i < V; i++) {
  minZ = Math.min(minZ, pos[3 * i + 2]);
  maxZ = Math.max(maxZ, pos[3 * i + 2]);
}
const totalLength = maxZ - minZ;
const maxProbe = totalLength * 0.06;
const cell = maxProbe;
const grid = new Map();
const cellKey = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
for (let t = 0; t < T; t++) {
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < 3; k++) {
    const v = idx[3 * t + k];
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], pos[3 * v + a]);
      hi[a] = Math.max(hi[a], pos[3 * v + a]);
    }
  }
  lo = lo.map((x) => Math.floor(x / cell));
  hi = hi.map((x) => Math.floor(x / cell));
  for (let x = lo[0]; x <= hi[0]; x++)
    for (let y = lo[1]; y <= hi[1]; y++)
      for (let z = lo[2]; z <= hi[2]; z++) {
        const key = `${x},${y},${z}`;
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push(t);
      }
}

/** Möller–Trumbore คืนระยะที่ชน หรือ Infinity */
function rayTriangle(o, d, t) {
  const a = 3 * idx[3 * t];
  const b = 3 * idx[3 * t + 1];
  const c = 3 * idx[3 * t + 2];
  const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
  const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
  const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]];
  const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
  if (Math.abs(det) < 1e-12) return Infinity;
  const inv = 1 / det;
  const s = [o[0] - pos[a], o[1] - pos[a + 1], o[2] - pos[a + 2]];
  const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) * inv;
  if (u < 0 || u > 1) return Infinity;
  const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
  const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) * inv;
  if (v < 0 || u + v > 1) return Infinity;
  const dist = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) * inv;
  return dist > totalLength * 1e-4 ? dist : Infinity;
}

const thickness = new Float32Array(V);
for (let i = 0; i < V; i++) {
  const o = [pos[3 * i], pos[3 * i + 1], pos[3 * i + 2]];
  const d = [-nrm[3 * i], -nrm[3 * i + 1], -nrm[3 * i + 2]];
  const seen = new Set();
  let best = Infinity;
  for (let s = 0; s <= 4; s++) {
    const f = (s / 4) * maxProbe;
    const key = cellKey(o[0] + d[0] * f, o[1] + d[1] * f, o[2] + d[2] * f);
    for (const t of grid.get(key) ?? []) {
      if (seen.has(t)) continue;
      seen.add(t);
      best = Math.min(best, rayTriangle(o, d, t));
    }
  }
  thickness[i] = best / totalLength;
}

// ── 3. แยกครีบ: จุดที่บาง แล้วจัดกลุ่มตามการเชื่อมต่อ ───────────────
const neighbors = Array.from({ length: V }, () => new Set());
for (let t = 0; t < T; t++)
  for (let k = 0; k < 3; k++) {
    const a = idx[3 * t + k];
    const b = idx[3 * t + ((k + 1) % 3)];
    neighbors[a].add(b);
    neighbors[b].add(a);
  }
// จุดที่ตำแหน่งเดียวกัน (รอยต่อ UV) ต้องอยู่ชิ้นเดียวกัน
const byPosition = new Map();
for (let i = 0; i < V; i++) {
  const key = `${pos[3 * i].toFixed(6)},${pos[3 * i + 1].toFixed(6)},${pos[3 * i + 2].toFixed(6)}`;
  if (byPosition.has(key)) {
    const j = byPosition.get(key);
    neighbors[i].add(j);
    neighbors[j].add(i);
  } else byPosition.set(key, i);
}

let isFin = Array.from(thickness, (t) => t < FIN_THICKNESS);
// ปรับให้เรียบ: จุดที่เพื่อนบ้านส่วนใหญ่ต่างจากตัวเองให้เปลี่ยนตาม (ลบจุดกระจัดกระจาย)
for (let pass = 0; pass < 3; pass++) {
  isFin = isFin.map((f, i) => {
    let fin = 0;
    for (const j of neighbors[i]) fin += isFin[j] ? 1 : 0;
    const r = fin / Math.max(neighbors[i].size, 1);
    return r > 0.6 ? true : r < 0.4 ? false : f;
  });
}

const group = new Int32Array(V).fill(-1);
const groups = [];
for (let i = 0; i < V; i++) {
  if (!isFin[i] || group[i] >= 0) continue;
  const members = [];
  const stack = [i];
  group[i] = groups.length;
  while (stack.length) {
    const v = stack.pop();
    members.push(v);
    for (const j of neighbors[v])
      if (isFin[j] && group[j] < 0) {
        group[j] = groups.length;
        stack.push(j);
      }
  }
  groups.push(members);
}

// โคนหาง = ช่วงที่ลำตัวคอดที่สุด (ความสูงน้อยสุด) ในครึ่งหลังของตัวปลา — หลังจุดนี้ทั้งหมดคือหาง
// (หางของโมเดลจาก Meshy หนาเกินกว่าจะแยกด้วยความหนาได้)
const SLICES = 120;
const sliceLo = new Float64Array(SLICES).fill(Infinity);
const sliceHi = new Float64Array(SLICES).fill(-Infinity);
const sliceOf = (z) => Math.min(SLICES - 1, Math.floor(((z - minZ) / totalLength) * SLICES));
for (let i = 0; i < V; i++) {
  const s = sliceOf(pos[3 * i + 2]);
  sliceLo[s] = Math.min(sliceLo[s], pos[3 * i + 1]);
  sliceHi[s] = Math.max(sliceHi[s], pos[3 * i + 1]);
}
let pedSlice = Math.floor(SLICES * 0.1);
for (let s = pedSlice; s < SLICES / 2; s++) if (sliceHi[s] - sliceLo[s] < sliceHi[pedSlice] - sliceLo[pedSlice]) pedSlice = s;
const tailBaseZ = minZ + ((pedSlice + 0.5) / SLICES) * totalLength;

let bodyMinY = Infinity;
let bodyMaxY = -Infinity;
for (let i = 0; i < V; i++) {
  if (isFin[i] || pos[3 * i + 2] < tailBaseZ) continue;
  bodyMinY = Math.min(bodyMinY, pos[3 * i + 1]);
  bodyMaxY = Math.max(bodyMaxY, pos[3 * i + 1]);
}
const bodyLength = maxZ - tailBaseZ;
const center = [0, (bodyMinY + bodyMaxY) / 2, (maxZ + tailBaseZ) / 2];
const scale = 1 / bodyLength;
const local = (i) => [(pos[3 * i] - center[0]) * scale, (pos[3 * i + 1] - center[1]) * scale, (pos[3 * i + 2] - center[2]) * scale];

const part = new Uint8Array(V);
const report = [];
const minFinGroup = V * 0.004;
for (const members of groups) {
  const c = [0, 0, 0];
  for (const v of members) local(v).forEach((x, a) => (c[a] += x / members.length));
  const [x, y, z] = c;
  let id;
  if (members.length < minFinGroup || z > 0.35 || z < -0.5) id = PART.body; // เศษเล็ก ๆ ริมฝีปาก หรือขอบหาง
  else if (y > 0.1 && Math.abs(x) < 0.08) id = PART.dorsal;
  else if (Math.abs(x) > 0.06 && y > -0.15) id = x > 0 ? PART.pectoralR : PART.pectoralL;
  else if (Math.abs(x) > 0.04) id = x > 0 ? PART.pelvicR : PART.pelvicL;
  else id = PART.anal;
  for (const v of members) {
    part[v] = id;
    if (id === PART.body) {
      isFin[v] = false;
      group[v] = -1;
    }
  }
  if (id !== PART.body) report.push(`${Object.keys(PART).find((k) => PART[k] === id).padEnd(10)} ${String(members.length).padStart(6)} จุด  กึ่งกลาง ${c.map((n) => n.toFixed(2)).join(', ')}`);
}
// หาง: น้ำหนักตามระยะจากโคนหางถึงปลายหาง
const tailGroup = groups.length;
for (let i = 0; i < V; i++) {
  if (pos[3 * i + 2] >= tailBaseZ) continue;
  isFin[i] = true;
  part[i] = PART.tail;
  group[i] = tailGroup;
}

// น้ำหนักครีบ: ระยะทางตามผิวจากโคนครีบ (จุดลำตัวที่ใกล้ที่สุด) หารด้วยระยะไกลสุดของครีบนั้น
const dist = new Float64Array(V).fill(Infinity);
const queue = [];
for (let i = 0; i < V; i++)
  if (!isFin[i]) {
    dist[i] = 0;
    queue.push(i);
  }
// Dijkstra แบบง่าย (heap ขนาดเล็กพอ ใช้ bucket ตามระยะ)
const heap = new MinHeap();
for (const i of queue) heap.push(0, i);
while (heap.size) {
  const [d, v] = heap.pop();
  if (d > dist[v]) continue;
  for (const j of neighbors[v]) {
    if (!isFin[j]) continue;
    const e = Math.hypot(pos[3 * v] - pos[3 * j], pos[3 * v + 1] - pos[3 * j + 1], pos[3 * v + 2] - pos[3 * j + 2]);
    if (d + e < dist[j]) {
      dist[j] = d + e;
      heap.push(d + e, j);
    }
  }
}
const groupMax = new Map();
for (let i = 0; i < V; i++) if (isFin[i] && Number.isFinite(dist[i])) groupMax.set(group[i], Math.max(groupMax.get(group[i]) ?? 0, dist[i]));
const finWeight = new Float32Array(V);
for (let i = 0; i < V; i++) if (isFin[i]) finWeight[i] = Math.min(1, (Number.isFinite(dist[i]) ? dist[i] : 0) / (groupMax.get(group[i]) || 1));

// ── 4. ตา: จุดสีเข้มบนหัว ────────────────────────────────────────
const baseTexture = material.getBaseColorTexture();
const { data: px, info } = await sharp(Buffer.from(baseTexture.getImage())).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const texel = (u, v) => {
  const x = Math.min(info.width - 1, Math.max(0, Math.round(u * (info.width - 1))));
  const y = Math.min(info.height - 1, Math.max(0, Math.round(v * (info.height - 1))));
  const o = (y * info.width + x) * 3;
  return [px[o] / 255, px[o + 1] / 255, px[o + 2] / 255];
};
const eyes = [-1, 1].map(() => ({ sum: [0, 0, 0], n: 0, pts: [] }));
for (let i = 0; i < V; i++) {
  if (isFin[i]) continue;
  const p = local(i);
  if (p[2] < 0.2 || Math.abs(p[0]) < 0.03) continue;
  const [r, g, b] = texel(uvs[2 * i], uvs[2 * i + 1]);
  if (0.3 * r + 0.59 * g + 0.11 * b > 0.12) continue;
  const e = eyes[p[0] < 0 ? 0 : 1];
  e.n++;
  e.pts.push(p);
  p.forEach((x, a) => (e.sum[a] += x));
}
for (const e of eyes) {
  e.center = e.sum.map((x) => x / Math.max(e.n, 1));
  const ds = e.pts.map((p) => Math.hypot(p[0] - e.center[0], p[1] - e.center[1], p[2] - e.center[2])).sort((a, b) => a - b);
  // รัศมีตาดำ แล้วขยายออกให้คลุมม่านตาด้วย
  e.radius = (ds[Math.floor(ds.length * 0.9)] ?? 0.03) * 1.7;
}
const eyeWeight = new Float32Array(V);
for (let i = 0; i < V; i++) {
  const p = local(i);
  const e = eyes[p[0] < 0 ? 0 : 1];
  const d = Math.hypot(p[0] - e.center[0], p[1] - e.center[1], p[2] - e.center[2]);
  eyeWeight[i] = isFin[i] ? 0 : 1 - smoothstep(e.radius * 0.85, e.radius * 1.15, d);
}

// ความสว่างปกติของลำตัวในเท็กซ์เจอร์ (ค่ากลางของช่องสีที่สว่างที่สุด) — shader ย้อมสีใช้ปรับเงาเกล็ด
// ให้เท็กซ์เจอร์สีเข้ม (เช่นลูกปลาสีเทา) ย้อมออกมาสว่างเท่าเท็กซ์เจอร์สีขาว
const bodyBrightness = [];
for (let i = 0; i < V; i++) if (!isFin[i] && eyeWeight[i] < 0.5) bodyBrightness.push(Math.max(...texel(uvs[2 * i], uvs[2 * i + 1])));
bodyBrightness.sort((a, b) => a - b);
const texRef = bodyBrightness[Math.floor(bodyBrightness.length / 2)] ?? 0.97;
// มีลายด่างสีส้มชัด ๆ ไหม (สัดส่วนจุดบนลำตัวที่สีอิ่มมาก) — ไม่มี = ลายด่างของปลาคาลิโก้สุ่มด้วย shader แทน
let saturated = 0;
let bodyCount = 0;
for (let i = 0; i < V; i++) {
  if (isFin[i] || eyeWeight[i] >= 0.5) continue;
  const c = texel(uvs[2 * i], uvs[2 * i + 1]);
  const max = Math.max(...c);
  bodyCount++;
  if (max > 0.05 && (max - Math.min(...c)) / max > 0.6) saturated++;
}
const patches = saturated / Math.max(bodyCount, 1) > 0.08;
material.setExtras({ ...material.getExtras(), texRef, patches });
console.log(`ความสว่างปกติของเท็กซ์เจอร์ ${texRef.toFixed(2)} · ลายด่างในเท็กซ์เจอร์ ${patches ? 'มี' : 'ไม่มี'} (${((saturated / Math.max(bodyCount, 1)) * 100).toFixed(1)}%)`);

// ── 5. เขียน attribute และย้ายพิกัด ──────────────────────────────
const finAttr = new Float32Array(V * 2);
for (let i = 0; i < V; i++) {
  finAttr[2 * i] = isFin[i] ? part[i] : 0;
  finAttr[2 * i + 1] = isFin[i] ? finWeight[i] : 0;
  const p = local(i);
  pos.set(p, 3 * i);
}
POS.setArray(pos);
const buffer = root.listBuffers()[0];
prim.setAttribute('_FIN', doc.createAccessor('fin').setType('VEC2').setArray(finAttr).setBuffer(buffer));
prim.setAttribute('_EYE', doc.createAccessor('eye').setType('SCALAR').setArray(eyeWeight).setBuffer(buffer));

// ── 6. ลดโพลิกอน แล้วแยกลำตัว/ครีบ ───────────────────────────────
const finMaterial = material.clone().setName('molly_fins').setAlphaMode('BLEND').setDoubleSided(true);
material.setName('molly_body').setAlphaMode('OPAQUE').setDoubleSided(false);

function copyPrimitive(src) {
  const out = doc.createPrimitive().setMaterial(src.getMaterial());
  for (const semantic of src.listSemantics()) out.setAttribute(semantic, src.getAttribute(semantic).clone());
  return out.setIndices(src.getIndices().clone());
}

function splitPrimitive(src) {
  const I = src.getIndices().getArray();
  const fin = src.getAttribute('_FIN').getArray();
  const body = [];
  const fins = [];
  for (let t = 0; t < I.length; t += 3) {
    const allFin = fin[2 * I[t]] > 0 && fin[2 * I[t + 1]] > 0 && fin[2 * I[t + 2]] > 0;
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

console.log(report.join('\n'));
console.log('ตา', eyes.map((e) => `${e.n} จุด กึ่งกลาง ${e.center.map((n) => n.toFixed(3)).join(', ')} รัศมี ${e.radius.toFixed(3)}`).join(' | '));
console.log(`ลำตัว ${bodyLength.toFixed(3)} หน่วย → ย่อ ${scale.toFixed(3)} เท่า, ความยาวรวม ${(totalLength * scale).toFixed(3)}`);

await doc.transform(
  prune({ keepAttributes: true }),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [TEXTURE_SIZE, TEXTURE_SIZE], quality: 88 }),
  reorder({ encoder: MeshoptEncoder }),
);

if (DEBUG) {
  const debug = OUTPUT.replace(/\.glb$/, '.debug.glb');
  const colors = [[0.9, 0.9, 0.9], [1, 0.2, 0.2], [0.2, 0.9, 0.2], [0.2, 0.4, 1], [0.2, 0.9, 1], [1, 0.9, 0.2], [1, 0.4, 1], [1, 0.6, 0.1]];
  for (const p of root.listMeshes().flatMap((m) => m.listPrimitives())) {
    const f = p.getAttribute('_FIN').getArray();
    const e = p.getAttribute('_EYE').getArray();
    const n = f.length / 2;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const c = colors[f[2 * i]];
      const k = f[2 * i] > 0 ? 0.35 + 0.65 * f[2 * i + 1] : 1;
      for (let a = 0; a < 3; a++) col[3 * i + a] = e[i] > 0.5 ? 0.05 : c[a] * k;
    }
    p.setAttribute('COLOR_0', doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buffer));
  }
  const tex = [material, finMaterial].map((m) => m.getBaseColorTexture());
  for (const m of [material, finMaterial]) m.setBaseColorTexture(null).setNormalTexture(null);
  await io.write(debug, doc);
  for (const [k, m] of [material, finMaterial].entries()) m.setBaseColorTexture(tex[k]);
  for (const p of root.listMeshes().flatMap((m) => m.listPrimitives())) p.setAttribute('COLOR_0', null);
  console.log(`เขียน ${debug}`);
}

// บีบอัด geometry แบบไม่ quantize (shader ของปลาสอดอ่านตำแหน่งจุดตามหน่วยลำตัวตรง ๆ)
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await doc.transform(prune({ keepAttributes: true }));
await io.write(OUTPUT, doc);
console.log(`เขียน ${OUTPUT}`);

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function MinHeap() {
  const keys = [];
  const vals = [];
  return {
    get size() {
      return keys.length;
    },
    push(k, v) {
      let i = keys.length;
      keys.push(k);
      vals.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= keys[i]) break;
        [keys[p], keys[i]] = [keys[i], keys[p]];
        [vals[p], vals[i]] = [vals[i], vals[p]];
        i = p;
      }
    },
    pop() {
      const top = [keys[0], vals[0]];
      const k = keys.pop();
      const v = vals.pop();
      if (keys.length) {
        keys[0] = k;
        vals[0] = v;
        for (let i = 0; ; ) {
          const l = 2 * i + 1;
          const r = l + 1;
          let m = i;
          if (l < keys.length && keys[l] < keys[m]) m = l;
          if (r < keys.length && keys[r] < keys[m]) m = r;
          if (m === i) break;
          [keys[m], keys[i]] = [keys[i], keys[m]];
          [vals[m], vals[i]] = [vals[i], vals[m]];
          i = m;
        }
      }
      return top;
    },
  };
}
