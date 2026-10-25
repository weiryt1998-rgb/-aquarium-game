import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Fish } from '../src/entities/Fish.js';
import { AssetLoader } from '../src/assets/AssetLoader.js';
import { ModelFactory } from '../src/assets/ModelFactory.js';
import { FishAI } from '../src/ai/FishAI.ts';
import { motionOf } from '../src/systems/FishManager.js';
import { getSpecies } from '../src/data/fish.js';
import { QUALITY } from '../src/config.js';
import { applyShaderMods, causticsMod, sharedUniforms } from '../src/render/shaderMods.js';
import { MOLLY_VARIANTS, MOLLY_VARIANT_IDS } from '../src/models/molly/variants.js';
import { MOLLY_SHAPES, crossGenes, describeGenes, variantGenes } from '../src/models/molly/genetics.js';

/** สีที่ขายในร้าน (ใช้สุ่มพ่อแม่ของลูกผสม) */
const SHOP_COLORS = ['dalmatian', 'redhead', 'golden', 'calico', 'golddust'];
const randomColor = () => SHOP_COLORS[Math.floor(Math.random() * SHOP_COLORS.length)];
import { clamp, rand } from '../src/utils/math.js';

/**
 * หน้าทดสอบโมเดลปลา Molly (เปิดตอน npm run dev ที่ /preview/molly.html — ไม่ถูกรวมในไฟล์ build)
 * ใช้คลาส Fish และ ModelFactory ตัวเดียวกับในเกม จึงเห็นการว่าย/เลี้ยวแบบเดียวกับในตู้จริง
 */

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.45;
scene.background = (() => {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#1d6f8c');
  grad.addColorStop(0.55, '#0c3a52');
  grad.addColorStop(1, '#06202e');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
scene.fog = new THREE.Fog('#0c3a52', 9, 26);

// แสงแบบเดียวกับในเกม (SceneManager)
scene.add(new THREE.HemisphereLight(0xcfeeff, 0x9c8a66, 1.25));
const sun = new THREE.DirectionalLight(0xfff6e6, 2.7);
sun.position.set(2, 9, 3);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -5, right: 5, top: 5, bottom: -5, near: 1, far: 20 });
const fill = new THREE.DirectionalLight(0x9fd6ff, 0.55);
fill.position.set(0, 3, 10);
scene.add(sun, fill);

// ตู้: พื้นทราย + ขอบกระจก
const TANK = { w: 7, d: 3.6, waterTop: 4 };
sharedUniforms.uWaterTop.value = TANK.waterTop;
const floorMat = applyShaderMods(new THREE.MeshStandardMaterial({ color: '#cdb892', roughness: 0.95 }), [causticsMod]);
const floor = new THREE.Mesh(new THREE.PlaneGeometry(TANK.w, TANK.d), floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
const glass = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(TANK.w, TANK.waterTop + 0.4, TANK.d)),
  new THREE.LineBasicMaterial({ color: '#9ad7ee', transparent: true, opacity: 0.35 }),
);
glass.position.y = (TANK.waterTop + 0.4) / 2;
const tank = new THREE.Group();
tank.add(floor, glass);
scene.add(tank);

const aquarium = {
  dims: TANK,
  heightAt: () => 0,
  clampToWater(pos, margin = 0.3) {
    pos.x = clamp(pos.x, -TANK.w / 2 + margin, TANK.w / 2 - margin);
    pos.z = clamp(pos.z, -TANK.d / 2 + margin, TANK.d / 2 - margin);
    pos.y = clamp(pos.y, margin * 0.6, TANK.waterTop - margin * 0.6);
    return pos;
  },
  randomPoint(zone = 'any', margin = 0.5, out = new THREE.Vector3()) {
    const band = { top: [0.62, 1], middle: [0.25, 0.8], bottom: [0, 0.38] }[zone] ?? [0, 1];
    const range = TANK.waterTop - 2 * margin;
    return out.set(rand(-TANK.w / 2 + margin, TANK.w / 2 - margin), margin + range * rand(band[0], band[1]), rand(-TANK.d / 2 + margin, TANK.d / 2 - margin));
  },
};

// Fish AI แบบเดียวกับในเกม (โหมด "ว่ายในตู้") — ไม่มีของตกแต่ง/อาหารในหน้านี้
const ai = new FishAI({ w: TANK.w, d: TANK.d, waterTop: TANK.waterTop, floorAt: () => 0, obstacles: [], covers: [], food: [], consume() {} });

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

// ── สถานะ ──────────────────────────────────────────────────────
// ?variant=rainbow = เปิดมาที่สีนั้นเลย · ?shape=long = ทรงตัวยาว (molly_long.glb) · ?view=hero = มุมกล้อง
const params = new URLSearchParams(location.search);
const urlVariant = params.get('variant');
const urlShape = params.get('shape');
const state = {
  mode: 'turntable',
  view: params.get('view') ?? 'side',
  variant: MOLLY_VARIANTS[urlVariant] ? urlVariant : 'dalmatian',
  count: 1,
  detail: 'high',
  shape: ['file', 'long', 'code'].includes(urlShape) ? urlShape : 'file',
  age: 'adult',
  wire: false,
  paused: false,
};
const baseSpecies = getSpecies('molly_dalmatian');
// รูปทรงจากไฟล์ molly.glb (เหมือนในเกม) หรือรูปทรงที่สร้างด้วยโค้ด (ตัวสำรองเมื่อไม่มีไฟล์) — สลับได้เพื่อเทียบกัน
const assets = new AssetLoader();
await assets.preload([...Object.values(MOLLY_SHAPES), baseSpecies.procedural.babyMesh]);
const factory = new ModelFactory({ first: (urls) => (state.shape !== 'code' ? assets.first(urls) : null) }, { detail: () => state.detail });
const meshShape = () => (state.shape === 'long' ? 'long' : 'balloon');
const speciesFor = (variant) => ({ ...baseSpecies, id: `molly_${variant}`, procedural: { ...baseSpecies.procedural, variant, mesh: MOLLY_SHAPES[meshShape()] } });
const game = { models: factory };
let fishes = [];
let orbitAngle = 0;

function clearFish() {
  for (const f of fishes) {
    ai.remove(f.id);
    scene.remove(f.group);
    f.dispose();
  }
  fishes = [];
}

/** variant = id ชุดสี หรือ 'cross' = ลูกผสมสุ่มจากพ่อแม่ 2 สี (เหมือนการผสมพันธุ์ในเกม) */
function makeFish(variant) {
  const record = { id: `p${Math.random()}`, speciesId: 'molly_dalmatian', name: 'molly', gender: 'f', satiety: 80, health: 100, growth: state.age === 'baby' ? 0.2 : 1, age: 0, breedCooldown: 99, coinTimer: 99 };
  if (variant === 'cross') {
    const a = randomColor();
    let b = randomColor();
    while (b === a) b = randomColor(); // พ่อแม่ต่างสี (สีเดียวกันในเกมได้ลูกพันธุ์แท้)
    record.genes = crossGenes(variantGenes(a), variantGenes(b));
    if (meshShape() === 'long') record.genes.shape = 'long';
    state.crossInfo = `${MOLLY_VARIANTS[a].name} × ${MOLLY_VARIANTS[b].name} → ${describeGenes(record.genes)}`;
  }
  const fish = new Fish(game, record, variant === 'cross' ? getSpecies('molly_hybrid') : speciesFor(variant));
  scene.add(fish.group);
  fishes.push(fish);
  applyWire();
  return fish;
}

function rebuild() {
  clearFish();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[state.detail].pixelRatio));
  if (state.mode === 'tank') {
    for (let i = 0; i < state.count; i++) {
      const v = state.variant === 'mixed' ? (i % 2 ? 'cross' : SHOP_COLORS[(i / 2) % SHOP_COLORS.length | 0]) : state.variant;
      const f = makeFish(v);
      aquarium.randomPoint('middle', 0.8, f.position);
      f.agent = ai.add(f.id, motionOf(f.species), { x: f.position.x, y: f.position.y, z: f.position.z });
    }
  } else {
    const f = makeFish(state.variant === 'mixed' ? 'dalmatian' : state.variant);
    f.group.scale.setScalar(1);
    f.position.set(0, 2, 0);
    f.velocity.set(0, 0, 0.55);
    f.yaw = 0;
  }
  tank.visible = state.mode !== 'turntable';
  setView(state.mode === 'tank' ? 'tank' : state.view);
}

function setView(view) {
  if (view !== 'tank') state.view = view;
  const c = new THREE.Vector3(0, 2, 0);
  const d = 3.0;
  const pos = {
    tank: [0, 3.2, 9.5],
    front: [0, 0, d],
    side: [d, 0.05, -0.15],
    sideR: [-d, 0.05, -0.15],
    top: [0, d, -0.01],
    bottom: [0, -d, -0.01],
    hero: [2.1, 0.7, 1.8],
  }[view] ?? [d, 0, 0];
  if (state.mode === 'circle') {
    camera.position.set(0, 4.6, 3.2);
    controls.target.set(0, 2, 0);
  } else if (view === 'tank') {
    camera.position.set(...pos);
    controls.target.set(0, 1.8, 0);
  } else {
    camera.position.copy(c).add(new THREE.Vector3(...pos));
    controls.target.copy(c).add(new THREE.Vector3(0, 0, -0.15));
  }
  controls.update();
  renderButtons();
}

function applyWire() {
  for (const f of fishes) f.visual.traverse((o) => o.isMesh && (o.material.wireframe = state.wire));
}

// ── UI ─────────────────────────────────────────────────────────
const MODES = { turntable: 'หมุนดูรอบตัว', circle: 'ว่ายวน (ดูการเลี้ยว)', tank: 'ว่ายในตู้ (AI เกม)' };
const VIEWS = { hero: 'มุมสวย', front: 'หน้า', side: 'ซ้าย', sideR: 'ขวา', top: 'บน', bottom: 'ล่าง' };
const DETAILS = { high: 'สูง', medium: 'กลาง', low: 'ต่ำ (มือถือ)' };
const SHAPES = { file: 'ทรงบอลลูน (molly.glb)', long: 'ทรงตัวยาว (molly_long.glb)', code: 'รูปทรงจากโค้ด (สำรอง)' };
const AGES = { adult: 'ตัวเต็มวัย', baby: 'ลูกปลา (molly_baby.glb)' };

function buttons(el, items, current, onClick) {
  el.replaceChildren(
    ...Object.entries(items).map(([id, label]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.className = id === current ? 'active' : '';
      b.onclick = () => onClick(id);
      return b;
    }),
  );
}

function renderButtons() {
  buttons(document.getElementById('modes'), MODES, state.mode, (m) => {
    state.mode = m;
    rebuild();
  });
  const views = document.getElementById('views');
  views.style.display = state.mode === 'turntable' ? '' : 'none';
  buttons(views, VIEWS, state.view, setView);
  const variants = Object.fromEntries(MOLLY_VARIANT_IDS.map((id) => [id, MOLLY_VARIANTS[id].nameEn.replace(' Molly', '')]));
  variants.cross = '🧬 ลูกผสม (สุ่มใหม่)';
  if (state.mode === 'tank') variants.mixed = 'ผสมทุกสี + ลูกผสม';
  document.getElementById('cross').textContent = state.variant === 'cross' && state.crossInfo ? state.crossInfo : '';
  buttons(document.getElementById('variants'), variants, state.variant, (v) => {
    state.variant = v;
    rebuild();
  });
  buttons(document.getElementById('ages'), AGES, state.age, (a) => {
    state.age = a;
    rebuild();
  });
  buttons(document.getElementById('shapes'), SHAPES, state.shape, (s) => {
    state.shape = s;
    rebuild();
  });
  buttons(document.getElementById('details'), DETAILS, state.detail, (d) => {
    state.detail = d;
    rebuild();
  });
  document.getElementById('count').parentElement.style.display = state.mode === 'tank' ? '' : 'none';
  document.getElementById('wire').className = state.wire ? 'active' : '';
  document.getElementById('pause').className = state.paused ? 'active' : '';
}

const countInput = document.getElementById('count');
countInput.oninput = () => {
  state.count = Number(countInput.value);
  document.getElementById('countLabel').textContent = state.count;
};
countInput.onchange = rebuild;
document.getElementById('wire').onclick = () => {
  state.wire = !state.wire;
  applyWire();
  renderButtons();
};
document.getElementById('pause').onclick = () => {
  state.paused = !state.paused;
  renderButtons();
};
document.getElementById('hide').onclick = () => {
  const body = document.getElementById('body');
  body.hidden = !body.hidden;
};

// ── loop ───────────────────────────────────────────────────────
function resize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const ctx = { time: 0, food: { findNearest: () => null }, fish: fishes, obstacles: [], aquarium };
let last = performance.now();
let frames = 0;
let fpsTime = 0;
const fpsEl = document.getElementById('fps');

/** ขยับเวลาไปข้างหน้า dt วินาที (เรียกเองได้จาก console: preview.step(0.016)) */
function step(dt) {
  sharedUniforms.uTime.value += dt;
  ctx.time += dt;
  ctx.fish = fishes;
  if (state.mode === 'tank') {
    for (const f of fishes) f.syncNeedsToAgent(100);
    ai.update(dt);
    for (const f of fishes) {
      f.syncFromAgent(ai.alpha);
      f.updateVisual(dt);
    }
  } else if (state.mode === 'circle') {
    // ว่ายเป็นวงรีรอบจุดกลาง เร็ว-ช้าสลับกัน → เห็นลำตัวโค้งตอนเลี้ยวและหางสะบัดแรงตอนเร่ง
    const f = fishes[0];
    const speed = 0.45 + 0.35 * Math.sin(ctx.time * 0.5);
    orbitAngle += (dt * speed) / 1.3;
    const target = new THREE.Vector3(Math.sin(orbitAngle) * 1.6, 2 + Math.sin(orbitAngle * 2) * 0.15, Math.cos(orbitAngle) * 1.0);
    f.velocity.subVectors(target, f.position).divideScalar(Math.max(dt, 1e-3)).clampLength(0, 2);
    f.position.copy(target);
    f.updateVisual(dt);
    // กล้องตามปลา
    controls.target.lerp(f.position, 1 - Math.exp(-3 * dt));
  } else {
    const f = fishes[0];
    f.velocity.set(0, 0, 0.55 + 0.25 * Math.sin(ctx.time * 0.6));
    f.position.set(0, 2, 0);
    f.updateVisual(dt);
  }
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  if (!state.paused) step(dt);
  controls.update();
  renderer.render(scene, camera);
  frames++;
  fpsTime += dt;
  if (fpsTime >= 0.5) {
    const info = renderer.info.render;
    fpsEl.textContent = `${Math.round(frames / fpsTime)} FPS · ${info.calls} draw calls · ${(info.triangles / 1000).toFixed(1)}k สามเหลี่ยม`;
    frames = 0;
    fpsTime = 0;
  }
  requestAnimationFrame(frame);
}

rebuild();
requestAnimationFrame(frame);

// เปิดให้สคริปต์ทดสอบ/console ควบคุมได้
window.preview = {
  state,
  step,
  setView,
  set(options) {
    Object.assign(state, options);
    if (options.count) countInput.value = options.count;
    rebuild();
  },
  render: () => renderer.render(scene, camera),
  camera,
  controls,
  get fishes() {
    return fishes;
  },
  ai,
};
