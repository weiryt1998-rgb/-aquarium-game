import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Fish } from '../src/entities/Fish.js';
import { ModelFactory } from '../src/assets/ModelFactory.js';
import { getSpecies } from '../src/data/fish.js';
import { QUALITY } from '../src/config.js';
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
const state = { mode: 'hero', view: 'hero', variant: 'nebula_blue', detail: 'high', paused: false };
const factory = new ModelFactory({ first: () => null }, { detail: () => state.detail });
const game = { models: factory, sparkles };
let fishes = [];

function makeFish(variant) {
  const species = getSpecies(`spacefish_${variant}`);
  const record = { id: `p${Math.random()}`, speciesId: species.id, name: 'ดาว', gender: 'f', satiety: 80, health: 100, growth: 1, age: 0, breedCooldown: 99, coinTimer: 99 };
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
  if (state.mode === 'tank') {
    SPACEFISH_VARIANT_IDS.forEach((v) => aquarium.randomPoint('middle', 0.8, makeFish(v).position));
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
  floor.visible = state.mode === 'tank';
  setView(state.mode === 'hero' ? state.view : state.mode);
}

function setView(view) {
  if (state.mode === 'hero') state.view = view;
  const c = new THREE.Vector3(0, 2, -0.2);
  const d = 3.4;
  const pos = {
    tank: [0, 3.4, 11],
    lineup: [0, 2.1, 8.2],
    hero: [2.4, 0.6, 1.9],
    front: [0, 0.1, d],
    side: [d, 0.05, 0],
    top: [0, d, -0.01],
  }[view] ?? [d, 0, 0];
  if (view === 'tank' || view === 'lineup') {
    camera.position.set(...pos);
    controls.target.set(0, view === 'tank' ? 2 : 2.05, 0);
  } else {
    camera.position.copy(c).add(new THREE.Vector3(...pos));
    controls.target.copy(c);
  }
  controls.update();
  renderButtons();
}

// ── UI ─────────────────────────────────────────────────────────
const MODES = { hero: 'ดูใกล้', lineup: '6 สี', tank: 'ว่ายในตู้ (AI เกม)' };
const VIEWS = { hero: 'มุมสวย', front: 'หน้า', side: 'ข้าง', top: 'บน' };
const DETAILS = { high: 'สูง', medium: 'กลาง', low: 'ต่ำ (มือถือ)' };

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
  variantsEl.style.display = state.mode === 'hero' ? '' : 'none';
  const variants = Object.fromEntries(SPACEFISH_VARIANT_IDS.map((id) => [id, getSpecies(`spacefish_${id}`).nameEn.replace('Space Fish · ', '')]));
  buttons(variantsEl, variants, state.variant, (v) => {
    state.variant = v;
    rebuild();
  });
  buttons(document.getElementById('details'), DETAILS, state.detail, (d) => {
    state.detail = d;
    rebuild();
  });
  document.getElementById('pause').className = state.paused ? 'active' : '';
}

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
  for (const f of fishes) {
    if (state.mode === 'tank') f.updateMovement(dt, ctx);
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
