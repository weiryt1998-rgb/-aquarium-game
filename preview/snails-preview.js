import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AssetLoader } from '../src/assets/AssetLoader.js';
import { ModelFactory } from '../src/assets/ModelFactory.js';
import { DECOR_ITEMS } from '../src/data/decor.js';

/**
 * หน้าตรวจโมเดลหอย (เปิดตอน npm run dev ที่ /preview/snails.html — ไม่ถูกรวมในไฟล์ build)
 * ใช้ ModelFactory ตัวเดียวกับในเกม: ขนาด (item.height) ทิศ (model.rotation) และฐานที่ y = 0 เหมือนในตู้จริง
 * ลูกศรแดงใต้หอยแต่ละตัว = ทิศ +Z ที่เกมถือเป็น "หัว" ตอนคลาน — ถ้าหัวไม่ชี้ตามลูกศร ให้แก้ model.rotation ใน src/data/decor.js
 */

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b2233');
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight('#cfefff', '#3a2a18', 1.2));
const sun = new THREE.DirectionalLight('#ffffff', 1.6);
sun.position.set(2, 4, 3);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 8), new THREE.MeshStandardMaterial({ color: '#c9b48a', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
scene.add(ground);
scene.add(new THREE.GridHelper(20, 80, '#8d7a55', '#a8956c'));

const critters = DECOR_ITEMS.filter((d) => d.critter);
const assets = new AssetLoader();
const factory = new ModelFactory(assets);
await assets.preload(critters.flatMap((d) => factory.decorModelUrls(d)));

const GAP = 1.1;
const shown = critters.map((item, i) => {
  const x = (i - (critters.length - 1) / 2) * GAP;
  const visual = factory.createDecor(item, 0.5, { animated: false });
  const group = new THREE.Group();
  group.position.x = x;
  group.add(visual.object);
  const arrow = new THREE.ArrowHelper(new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0.005, -0.3), 0.75, '#ff3b30', 0.12, 0.07);
  group.add(arrow);
  scene.add(group);
  const li = document.createElement('li');
  li.textContent = `${item.name} (${item.id}) — ${visual.isPlaceholder ? 'โมเดลชั่วคราว' : 'ไฟล์ .glb'} · ${item.critter.move}`;
  document.getElementById('list').append(li);
  return { item, object: visual.object, base: visual.object.scale.clone(), phase: i };
});

const VIEWS = {
  'มุมเฉียง': [3.2, 1.6, 3.6],
  'ด้านข้าง (หัวไปทางขวา)': [-6, 0.35, 0.001],
  'ด้านบน': [0.001, 6, 0.001],
};
const setView = (name) => {
  camera.position.set(...VIEWS[name]);
  controls.target.set(0, 0.15, 0);
  controls.update();
  document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('active', b.textContent === name));
};
for (const name of Object.keys(VIEWS)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => setView(name);
  document.getElementById('views').append(b);
}
const params = new URLSearchParams(location.search);
setView(params.get('view') ?? 'มุมเฉียง');

let crawl = true;
document.getElementById('crawl').onclick = (e) => {
  crawl = !crawl;
  e.target.textContent = `คลาน: ${crawl ? 'เปิด' : 'ปิด'}`;
};

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  // ท่าคลานแบบเดียวกับในเกม (ยืด-หดลำตัว) สำหรับหอยที่ไม่มีคลิปแอนิเมชัน
  for (const s of shown) {
    if (s.item.critter.move === 'stay') continue;
    const pulse = crawl ? Math.sin(t * 3 + s.phase) * 0.05 : 0;
    s.object.scale.set(s.base.x * (1 - pulse * 0.4), s.base.y, s.base.z * (1 + pulse));
  }
  controls.update();
  renderer.render(scene, camera);
});
window.preview = { scene, camera, controls, setView };
