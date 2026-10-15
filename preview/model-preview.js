import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AssetLoader, normalizeModel } from '../src/assets/AssetLoader.js';

/**
 * หน้าตรวจไฟล์ .glb ใด ๆ ใน public/models (เปิดตอน npm run dev ที่ /preview/model.html?url=models/decor/cliff_sanctuary.glb)
 * ใช้ดูทิศของโมเดลก่อนใส่ในเกม: เกมถือว่าหัวปลา/หอยชี้ +Z (ลูกศรแดง) และด้านบนคือ +Y
 * ย่อให้สูงสุด 2 หน่วยและวางฐานบนพื้น ไม่หมุนอะไรเพิ่ม — เห็นทิศตามไฟล์จริง
 */

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0b2233');
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.add(new THREE.HemisphereLight('#cfefff', '#3a2a18', 1.0));
const sun = new THREE.DirectionalLight('#ffffff', 1.6);
sun.position.set(2, 4, 3);
scene.add(sun);
scene.add(new THREE.GridHelper(6, 24, '#5d7f92', '#2e4d5e'));
const axis = (dir, color) => scene.add(new THREE.ArrowHelper(dir, new THREE.Vector3(0, 0.01, 0), 1.6, color, 0.18, 0.1));
axis(new THREE.Vector3(0, 0, 1), '#ff3b30');
axis(new THREE.Vector3(0, 1, 0), '#34c759');
axis(new THREE.Vector3(1, 0, 0), '#3fa9ff');

const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const VIEWS = {
  'มุมเฉียง': [3.5, 2.6, 4.2],
  'หน้า (+Z มองกลับ)': [0, 1, 6],
  'ข้าง (+X)': [6, 1, 0.001],
  'บน': [0.001, 7, 0.001],
};
const setView = (name) => {
  camera.position.set(...VIEWS[name]);
  controls.target.set(0, 0.8, 0);
  controls.update();
  document.querySelectorAll('#views button').forEach((b) => b.classList.toggle('active', b.textContent === name));
};
for (const name of Object.keys(VIEWS)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.onclick = () => setView(name);
  document.getElementById('views').append(b);
}

const assets = new AssetLoader();
let current = null;
async function show(url) {
  if (current) scene.remove(current);
  const gltf = await assets.load(url);
  const info = document.getElementById('info');
  if (!gltf) {
    info.textContent = `โหลด ${url} ไม่ได้ (ต้องอยู่ใน public/models)`;
    return;
  }
  const { scene: obj, animations } = assets.instantiate(gltf);
  const { root } = normalizeModel(obj, { fit: 'max', size: 2, align: 'base' });
  scene.add(root);
  current = root;
  let tris = 0;
  let bones = 0;
  obj.traverse((o) => {
    if (o.isMesh) tris += (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
    if (o.isBone) bones++;
  });
  info.textContent = `${url} · ${Math.round(tris)} สามเหลี่ยม · กระดูก ${bones} · แอนิเมชัน ${animations.length}`;
}

const params = new URLSearchParams(location.search);
const url = params.get('url') ?? 'models/decor/cliff_sanctuary.glb';
document.getElementById('url').value = url;
document.getElementById('load').onclick = () => show(document.getElementById('url').value.trim());
setView(params.get('view') ?? 'มุมเฉียง');
await show(url);

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
window.preview = { ready: true, setView };
