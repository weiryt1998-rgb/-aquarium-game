/** Package the textured Blender koi for the game's +Z forward / +Y up convention.
 * node scripts/build-loy-krathong-model.mjs
 * Authored _FLEX weights keep the lotus rigid and the membranes flexible.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, getBounds, prune, reorder, simplify, textureCompress, transformMesh, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';
import { mkdir, stat, writeFile } from 'node:fs/promises';

const input = 'Fish/loy_krathong_game_src.glb';
const output = 'public/models/fish/loy_krathong.glb';
await Promise.all([MeshoptEncoder.ready, MeshoptSimplifier.ready]);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(input);
const root = doc.getRoot();
const scene = root.getDefaultScene() ?? root.listScenes()[0];
if (root.listScenes().length !== 1) throw new Error('Export only the GAME PBR scene.');
if (root.listMeshes().length !== 4) throw new Error('Expected exactly four draw groups.');
for (const node of root.listNodes().filter((n) => n.getMesh())) {
  transformMesh(node.getMesh(), node.getWorldMatrix());
  node.setMatrix([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  scene.addChild(node);
}
const triangles = () => root.listMeshes().reduce((sum, m) => sum + m.listPrimitives().reduce((n, p) => n + p.getIndices().getCount() / 3, 0), 0);
const before = triangles();
await doc.transform(weld(), simplify({ simplifier: MeshoptSimplifier, ratio: Math.min(1, 12000 / before), error: 0.0015 }));
const bounds = getBounds(scene);
const scale = 1 / (bounds.max[2] - bounds.min[2]);
const cz = (bounds.max[2] + bounds.min[2]) / 2;
const matrix = [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, -cz * scale, 1];
for (const mesh of root.listMeshes()) transformMesh(mesh, matrix);
for (const m of root.listMaterials()) {
  m.setMetallicFactor(0);
  // No clearcoat/subsurface/transmission dependency: ordinary glTF PBR + alpha.
  for (const ext of m.listExtensions()) m.setExtension(ext.extensionName, null);
  if (m.getName().includes('membrane')) m.setAlphaMode('BLEND').setDoubleSided(true);
  if (m.getName().includes('botanical')) m.setDoubleSided(true);
}
for (const mesh of root.listMeshes()) for (const p of mesh.listPrimitives()) {
  for (const a of ['POSITION', 'NORMAL', 'TEXCOORD_0', '_FLEX']) if (!p.getAttribute(a)) throw new Error(`Missing ${a} on ${mesh.getName()}`);
}
await doc.transform(
  prune({ keepAttributes: true }), dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 95 }),
  reorder({ encoder: MeshoptEncoder }),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await mkdir('public/models/fish', { recursive: true });
await io.write(output, doc);
const report = {
  file: output, source: input, triangles: triangles(), beforeTriangles: before,
  drawGroups: root.listMeshes().length, materials: root.listMaterials().length,
  textureCount: root.listTextures().length, bytes: (await stat(output)).size,
  forward: '+Z', up: '+Y', length: 1,
  animation: 'Authored _FLEX; use existing model.motion = fish. No embedded animation clip.',
};
await writeFile('Fish/loy_krathong_game_report.json', JSON.stringify(report, null, 2) + '\n');
console.log(report);
