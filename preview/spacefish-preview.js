import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Fish } from '../src/entities/Fish.js';
import { AssetLoader } from '../src/assets/AssetLoader.js';
import { ModelFactory } from '../src/assets/ModelFactory.js';
import { getSpecies } from '../src/data/fish.js';
import { CONFIG, QUALITY } from '../src/config.js';
import { pregnancyProgress } from '../src/shared/breeding.js';
import { applyShaderMods, causticsMod, sharedUniforms } from '../src/render/shaderMods.js';
import { SPACEFISH_VARIANT_IDS } from '../src/models/spacefish/variants.js';
import { Sparkles } from '../src/world/Sparkles.js';
import { clamp, rand } from '../src/utils/math.js';

/**
 * หน้าทดสอบโมเดลปลาอวกาศ (เปิดตอน npm run dev ที่ /preview/spacefish.html — ไม่ถูกรวมในไฟล์ build)
 * ใช้คลาส Fish, ModelFactory และ Sparkles ตัวเดียวกับในเกม จึงเห็นการว่าย แสง และประกายดาวแบบเดียวกับในตู้จริง
 */

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.35;
scene.background = (() => {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#163a5c');
  grad.addColorStop(0.55, '#0b1c36');
  grad.addColorStop(1, '#050a1c');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
})();
scene.fog = new THREE.Fog('#0b1c36', 10, 28);

// แสงแบบเดียวกับในเกม (SceneManager)
scene.add(new THREE.HemisphereLight(0xcfeeff, 0x9c8a66, 1.25));
const sun = new THREE.DirectionalLight(0xfff6e6, 2.7);
sun.position.set(2, 9, 3);
const fill = new THREE.DirectionalLight(0x9fd6ff, 0.55);
fill.position.set(0, 3, 10);
scene.add(sun, fill);

const TANK = { w: 9, d: 4, waterTop: 4.5 };
sharedUniforms.uWaterTop.value = TANK.waterTop;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(TANK.w, TANK.d), applyShaderMods(new THREE.MeshStandardMaterial({ color: '#4a4560', roughness: 0.95 }), [causticsMod]));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

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

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 80);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;

const sparkles = new Sparkles();
scene.add(sparkles.points);

// ── สถานะ ──────────────────────────────────────────────────────
const state = { mode: 'breed', view: 'hero', variant: 'nebula_blue', detail: 'high', shape: 'file', age: 'adult', speed: 180, paused: false };
// รูปทรงจากไฟล์ spacefish.glb / spacefish_baby.glb (เหมือนในเกม) หรือรูปทรงที่สร้างด้วยโค้ด (ตัวสำรองเมื่อไม่มีไฟล์)
const assets = new AssetLoader();
const { procedural } = getSpecies('spacefish_nebula_blue');
await assets.preload([procedural.mesh, procedural.babyMesh]);
const factory = new ModelFactory({ first: (urls) => (state.shape === 'file' ? assets.first(urls) : null) }, { detail: () => state.detail });
const game = { models: factory, sparkles };
let fishes = [];

function makeFish(variant, extra = {}) {
  const species = getSpecies(`spacefish_${variant}`);
  const growth = state.age === 'baby' ? 0.1 : 1;
  const record = { id: `p${Math.random()}`, speciesId: species.id, name: 'ดาว', gender: 'f', satiety: 80, health: 100, growth, age: 0, breedCooldown: 99, coinTimer: 99, ...extra };
  const fish = new Fish(game, record, species);
  scene.add(fish.group);
  fishes.push(fish);
  return fish;
}

function rebuild() {
  for (const f of fishes) {
    scene.remove(f.group);
    f.dispose();
  }
  fishes = [];
  sparkles.clear();
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY[state.detail].pixelRatio));
  breed.mom = null;
  if (state.mode === 'tank') {
    SPACEFISH_VARIANT_IDS.forEach((v) => aquarium.randomPoint('middle', 0.8, makeFish(v).position));
  } else if (state.mode === 'breed') {
    // ตัวเมียตั้งท้องตั้งแต่เริ่ม + ตัวผู้ว่ายอยู่ด้วย (ไม่ผูกกับเซฟใด ๆ — แค่ดูการตั้งท้อง คลอด และลูกปลาโต)
    breed.mom = makeFish(state.variant, { gender: 'f', growth: 1, pregnantAt: Date.now() });
    makeFish(state.variant, { gender: 'm', growth: 1 });
    for (const f of fishes) aquarium.randomPoint('middle', 1.2, f.position);
    breed.born = 0;
    breed.elapsed = 0;
    breed.rest = 0;
  } else if (state.mode === 'lineup') {
    // 6 สีเรียงกัน 2 แถว หันข้าง
    SPACEFISH_VARIANT_IDS.forEach((v, i) => {
      const f = makeFish(v);
      f.group.scale.setScalar(1);
      f.position.set(((i % 3) - 1) * 2.4, 2.9 - Math.floor(i / 3) * 1.7, 0);
      f.yaw = Math.PI / 2;
    });
  } else {
    const f = makeFish(state.variant);
    f.group.scale.setScalar(1);
    f.position.set(0, 2, 0);
    f.yaw = 0;
  }
  floor.visible = state.mode === 'tank' || state.mode === 'breed';
  setView(state.mode === 'hero' ? state.view : state.mode);
}

// ── เร่งเฉพาะหน้าทดสอบ: นับเวลาแบบ dt เพื่อหยุดพัก/เปลี่ยนความเร็วได้โดยความคืบหน้าไม่กระโดด ──
const MAX_BABIES = 4;
const BABY_GROWTH_SPEED = 20; // คงโมเดลลูกปลาไว้ประมาณ 15 วินาทีเพื่อดูรายละเอียด
const breed = { mom: null, born: 0, elapsed: 0, rest: 0 };

function stepBreeding(dt) {
  const mom = breed.mom;
  if (!mom) return;
  const now = Date.now();
  // โตเฉพาะลูกที่มีอยู่ก่อนเฟรมนี้ ลูกแรกเกิดเริ่มจาก growth = 0 เสมอ
  for (const f of fishes) {
    if (!f.isPreviewBaby || f.data.growth >= 1) continue;
    f.data.growth = Math.min(1, f.data.growth + (dt * BABY_GROWTH_SPEED) / f.species.care.growTime);
    f.updateScale();
    f.refreshLook();
  }
  if (mom.data.pregnantAt) {
    breed.elapsed = Math.min(CONFIG.breeding.gestation, breed.elapsed + dt * state.speed);
    // ให้ Fish.updateVisual ใช้ความคืบหน้าเดียวกับนาฬิกาพรีวิว โดยไม่แก้ CONFIG ของเกม
    mom.data.pregnantAt = now - (breed.elapsed * 1000) / CONFIG.timeScale;
  } else {
    breed.rest = Math.max(0, breed.rest - dt);
    if (breed.rest === 0) {
      breed.elapsed = 0;
      mom.data.pregnantAt = now;
    }
  }
  // ครบกำหนดคลอด → ลูกปลาแรกเกิด 1 ตัวข้างแม่ แล้วตั้งท้องใหม่ในอีก 3 วินาที (ดูได้หลายรอบ)
  if (mom.data.pregnantAt && breed.elapsed >= CONFIG.breeding.gestation) {
    delete mom.data.pregnantAt;
    const babies = fishes.filter((f) => f.isPreviewBaby);
    if (babies.length >= MAX_BABIES) {
      scene.remove(babies[0].group);
      babies[0].dispose();
      fishes.splice(fishes.indexOf(babies[0]), 1);
    }
    const baby = makeFish(state.variant, { gender: Math.random() < 0.5 ? 'f' : 'm', growth: 0 });
    baby.position.copy(mom.position).add(new THREE.Vector3(0.25, -0.1, 0));
    baby.isPreviewBaby = true;
    breed.born++;
    breed.rest = 3;
  }
  const babies = fishes.filter((f) => f.isPreviewBaby);
  const growth = babies.map((f) => `${Math.round(f.data.growth * 100)}%${f.babyLook ? '' : ' (ตัวเต็มวัยแล้ว)'}`).join(', ');
  const remaining = Math.ceil((CONFIG.breeding.gestation - breed.elapsed) / state.speed);
  const preg = mom.data.pregnantAt ? `ตั้งท้อง ${Math.round(pregnancyProgress(mom.data, now) * 100)}% · คลอดใน ${remaining} วินาที` : 'เพิ่งคลอด พักก่อนตั้งท้องใหม่';
  breedInfo.textContent = `ท้อง ×${state.speed} · ${preg} · คลอดแล้ว ${breed.born} ตัว · ลูกปลาโต ×${BABY_GROWTH_SPEED}${growth ? `: ${growth}` : ''}`;
  document.getElementById('birthNow').disabled = !mom.data.pregnantAt;
}
const breedInfo = document.getElementById('breedInfo');

function setView(view) {
  if (state.mode === 'hero') state.view = view;
  const c = new THREE.Vector3(0, 2, -0.2);
  const d = 3.4;
  const pos = {
    tank: [0, 3.4, 11],
    breed: [0, 3.0, 8.5],
    lineup: [0, 2.1, 8.2],
    hero: [2.4, 0.6, 1.9],
    front: [0, 0.1, d],
    side: [d, 0.05, 0],
    top: [0, d, -0.01],
  }[view] ?? [d, 0, 0];
  if (view === 'tank' || view === 'breed' || view === 'lineup') {
    camera.position.set(...pos);
    controls.target.set(0, view === 'lineup' ? 2.05 : 2, 0);
  } else {
    camera.position.copy(c).add(new THREE.Vector3(...pos));
    controls.target.copy(c);
  }
  controls.update();
  renderButtons();
}

// ── UI ─────────────────────────────────────────────────────────
const MODES = { hero: 'ดูใกล้', lineup: '6 สี', tank: 'ว่ายในตู้ (AI เกม)', breed: 'ทดสอบออกลูก (เร่งเวลา)' };
const SPEEDS = { 5: 'เร็ว ×5', 20: '×20', 60: '×60', 180: '×180 (5 วินาที)' };
const VIEWS = { hero: 'มุมสวย', front: 'หน้า', side: 'ข้าง', top: 'บน' };
const DETAILS = { high: 'สูง', medium: 'กลาง', low: 'ต่ำ (มือถือ)' };
const AGES = { adult: 'ตัวเต็มวัย', baby: 'ลูกปลาแรกเกิด' };
const SHAPES = { file: 'รูปทรงจากไฟล์ .glb', code: 'รูปทรงจากโค้ด (สำรอง)' };

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
  views.style.display = state.mode === 'hero' ? '' : 'none';
  buttons(views, VIEWS, state.view, setView);
  const variantsEl = document.getElementById('variants');
  variantsEl.style.display = state.mode === 'hero' || state.mode === 'breed' ? '' : 'none';
  const speedsEl = document.getElementById('speeds');
  speedsEl.style.display = state.mode === 'breed' ? '' : 'none';
  buttons(speedsEl, SPEEDS, String(state.speed), (s) => {
    state.speed = Number(s);
    renderButtons();
  });
  breedInfo.style.display = state.mode === 'breed' ? '' : 'none';
  document.getElementById('breedActions').style.display = state.mode === 'breed' ? '' : 'none';
  if (state.mode === 'breed') stepBreeding(0);
  const variants = Object.fromEntries(SPACEFISH_VARIANT_IDS.map((id) => [id, getSpecies(`spacefish_${id}`).nameEn.replace('Space Fish · ', '')]));
  buttons(variantsEl, variants, state.variant, (v) => {
    state.variant = v;
    rebuild();
  });
  buttons(document.getElementById('details'), DETAILS, state.detail, (d) => {
    state.detail = d;
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
  document.getElementById('pause').className = state.paused ? 'active' : '';
}

document.getElementById('pause').onclick = () => {
  state.paused = !state.paused;
  renderButtons();
};
document.getElementById('birthNow').onclick = () => {
  if (!breed.mom?.data.pregnantAt) return;
  breed.elapsed = CONFIG.breeding.gestation;
  step(0);
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
  sparkles.setViewport(h, camera.fov, renderer.getPixelRatio());
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
  if (state.mode === 'breed') stepBreeding(dt);
  for (const f of fishes) {
    if (state.mode === 'tank' || state.mode === 'breed') f.updateMovement(dt, ctx);
    else {
      // ว่ายอยู่กับที่ เร็ว-ช้าสลับกัน (เห็นแสงพลังงานแรงขึ้นตอนเร่ง) — ประกายดาวลอยไปทางหางเหมือนว่ายผ่าน
      const fwd = 0.45 + 0.4 * Math.max(0, Math.sin(ctx.time * 0.5));
      f.velocity.set(Math.sin(f.yaw), 0, Math.cos(f.yaw)).multiplyScalar(fwd);
    }
    f.updateVisual(dt);
  }
  sparkles.update(dt, ctx.time);
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
    rebuild();
  },
  render: () => renderer.render(scene, camera),
  camera,
  controls,
  get fishes() {
    return fishes;
  },
};
