import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { AssetLoader } from '../src/assets/AssetLoader.js';
import { SUNFLOWER_MODEL, Sunflower } from '../src/world/Sunflower.js';
import { sunflowerStage } from '../src/shared/garden.js';

/**
 * หน้าตรวจกระถางทานตะวัน (เปิดตอน npm run dev ที่ /preview/sunflower.html)
 * เลื่อนค่าการเติบโต/น้ำ/สุขภาพ แล้วดูท่าทางต้นไม้ · กดปุ่มดูภาพรดน้ำ/ใส่ปุ๋ย/เก็บเมล็ด/ปลูก
 * ?procedural = ใช้โมเดลชั่วคราวจากโค้ด (ไม่โหลดไฟล์) · ?growth=0.5&water=10&health=80&view=front
 */

const params = new URLSearchParams(location.search);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#24476f');
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
scene.add(new THREE.HemisphereLight(0xcfeeff, 0x9c8a66, 1.25));
const sun = new THREE.DirectionalLight(0xfff6e6, 2.2);
sun.position.set(3, 12, 6);
scene.add(sun);
const table = new THREE.Mesh(new THREE.BoxGeometry(14, 0.7, 10), new THREE.MeshStandardMaterial({ color: '#7a5434', roughness: 0.6 }));
table.position.set(0, -0.67, 0);
scene.add(table);

const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.target.set(0, 3.2, 0);
const views = { front: [0, 4.5, 15], side: [15, 4.5, 0.01], high: [7, 11, 10] };
camera.position.set(...(views[params.get('view')] ?? [6, 5.5, 13]));

const plant = new Sunflower(scene);
if (!params.has('procedural')) {
  const assets = new AssetLoader();
  const gltf = await assets.load(SUNFLOWER_MODEL);
  if (gltf) plant.useModel(assets.instantiate(gltf).scene);
}
plant.place({ w: 12, h: 6.5, d: 5.5 });
plant.group.position.set(0, -0.32, 0);

const state = { growth: Number(params.get('growth') ?? 1), water: Number(params.get('water') ?? 70), health: Number(params.get('health') ?? 100), planted: !params.has('empty'), ripe: false };
const sliders = document.getElementById('sliders');
for (const [key, label, max, step] of [
  ['growth', '🌱 เติบโต', 1, 0.01],
  ['water', '💧 น้ำในดิน', 100, 1],
  ['health', '❤️ สุขภาพ', 100, 1],
]) {
  const row = document.createElement('label');
  row.innerHTML = `<span>${label}</span><input type="range" min="0" max="${max}" step="${step}" value="${state[key]}"><b></b>`;
  const input = row.querySelector('input');
  const out = row.querySelector('b');
  const sync = () => {
    state[key] = Number(input.value);
    out.textContent = key === 'growth' ? state[key].toFixed(2) : String(state[key]);
    apply();
  };
  input.oninput = sync;
  sliders.append(row);
  queueMicrotask(sync);
}

const button = (parent, text, fn) => {
  const b = document.createElement('button');
  b.textContent = text;
  b.onclick = fn;
  document.getElementById(parent).append(b);
};
for (const [text, g] of [['ต้นกล้า', 0.05], ['ต้นอ่อน', 0.3], ['ต้นโต', 0.6], ['ดอกตูม', 0.85], ['บาน', 1]]) {
  button('stages', text, () => {
    state.growth = g;
    sliders.querySelector('input').value = g;
    sliders.querySelector('input').dispatchEvent(new Event('input'));
  });
}
button('stages', 'กระถางว่าง', () => {
  state.planted = !state.planted;
  apply();
});
for (const [text, kind] of [['💧 รดน้ำ', 'water'], ['🧪 ใส่ปุ๋ย', 'fertilize'], ['🌻 เก็บเมล็ด', 'harvest'], ['🌱 ปลูก', 'plant']]) button('actions', text, () => plant.play(kind));

function apply() {
  const s = state.planted ? { growth: state.growth, water: state.water, health: state.health } : null;
  plant.show(s, { ripe: state.ripe });
  plant.setBadge(!s ? '🌱' : s.health <= 0 ? '🥀' : s.water < 25 ? '💧' : null);
  document.getElementById('info').textContent = s ? `${sunflowerStage(s).icon} ${sunflowerStage(s).name}${s.health <= 0 ? ' · ตายแล้ว' : ''}` : 'กระถางว่าง';
}
apply();
plant.show(state.planted ? state : null, { immediate: true });

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();
const clock = new THREE.Clock();
let time = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.1);
  time += dt;
  controls.update();
  plant.update(dt, time, camera);
  renderer.render(scene, camera);
});
window.preview = { ready: true, plant, state, apply, settle: () => plant.show(state.planted ? state : null, { immediate: true }) };
