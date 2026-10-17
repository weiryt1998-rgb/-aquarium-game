import * as THREE from 'three';
import { SceneManager } from '../src/world/SceneManager.js';
import { Aquarium } from '../src/world/Aquarium.js';
import { Room } from '../src/world/Room.js';
import { TANK_TYPES } from '../src/data/tanks.js';
import { sharedUniforms } from '../src/render/shaderMods.js';

/**
 * หน้าทดสอบฉากห้องรอบตู้ (src/world/Room.js) — ใช้ SceneManager / Aquarium / Room ตัวเดียวกับในเกม ไม่ต้องล็อกอิน
 * เปิดที่ /preview/room.html  (?tank=aurora&view=left เลือกตู้/มุมกล้องจากลิงก์ได้)
 * ทดสอบแบบมือถือ: เปิด DevTools → โหมดอุปกรณ์ (แนวตั้ง)
 */

const params = new URLSearchParams(location.search);
const state = { tank: TANK_TYPES.some((t) => t.id === params.get('tank')) ? params.get('tank') : 'starter', view: params.get('view') ?? 'front', quality: 'high' };

const settings = { quality: state.quality };
const sceneMgr = new SceneManager(document.getElementById('c'), settings);
const aquarium = new Aquarium(sceneMgr);
const room = new Room(sceneMgr.scene);

/** มุมกล้อง: หมุนรอบตู้จากมุมหลัก (เรเดียน) และระยะ (เท่าของระยะหลัก) — ขอบเขตเดียวกับที่ผู้เล่นหมุนได้ในเกม */
const VIEWS = {
  front: { label: 'มุมหลัก', yaw: 0, dist: 1 },
  left: { label: 'หมุนซ้ายสุด', yaw: -1, dist: 1.2 },
  right: { label: 'หมุนขวาสุด', yaw: 1, dist: 1.2 },
  far: { label: 'ซูมออกสุด', yaw: 0.35, dist: 1.7 },
};

function setView(id) {
  state.view = VIEWS[id] ? id : 'front';
  const v = VIEWS[state.view];
  const { position, target } = sceneMgr.home;
  const offset = position.clone().sub(target).applyAxisAngle(new THREE.Vector3(0, 1, 0), v.yaw).multiplyScalar(v.dist);
  sceneMgr.tween = null;
  sceneMgr.camera.position.copy(target).add(offset);
  sceneMgr.controls.target.copy(target);
  sceneMgr.controls.update();
  renderButtons();
}

function loadTank(id) {
  state.tank = id;
  const type = TANK_TYPES.find((t) => t.id === id);
  aquarium.build(type, sceneMgr.quality);
  room.build(aquarium.dims);
  sceneMgr.setupLights(aquarium.dims);
  sceneMgr.frameTank(aquarium.dims);
  setView(state.view);
}

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
  buttons(document.getElementById('tanks'), Object.fromEntries(TANK_TYPES.map((t) => [t.id, t.name])), state.tank, loadTank);
  buttons(document.getElementById('views'), Object.fromEntries(Object.entries(VIEWS).map(([id, v]) => [id, v.label])), state.view, setView);
  buttons(document.getElementById('qualities'), { high: 'กราฟิกสูง', medium: 'กลาง', low: 'ต่ำ (มือถือ)' }, state.quality, (q) => {
    state.quality = settings.quality = q;
    sceneMgr.applyQuality(q);
    loadTank(state.tank);
  });
}

document.getElementById('toggle').onclick = () => document.getElementById('panel').classList.toggle('hidden');
sceneMgr.onResize = () => sceneMgr.dims && setView(state.view);
loadTank(state.tank);

// วัดภาระของห้อง: draw call / สามเหลี่ยม ของทั้งฉาก และเฉพาะห้อง
const roomStats = () => {
  let tris = 0;
  room.group.traverse((o) => {
    if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
  });
  return { meshes: room.group.children.length, tris: Math.round(tris) };
};

let last = performance.now();
let time = 0;
let frames = 0;
let fpsTime = 0;
const stats = document.getElementById('stats');
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  sharedUniforms.uTime.value = time;
  sceneMgr.update(dt);
  aquarium.update(dt, time, sceneMgr.camera);
  sceneMgr.render();
  frames++;
  fpsTime += dt;
  if (fpsTime > 0.5) {
    const info = sceneMgr.renderer.info.render;
    const r = roomStats();
    stats.textContent = `${Math.round(frames / fpsTime)} FPS · ทั้งฉาก ${info.calls} draw calls / ${(info.triangles / 1000).toFixed(1)}k สามเหลี่ยม · ห้อง ${r.meshes} ชิ้น / ${(r.tris / 1000).toFixed(1)}k สามเหลี่ยม`;
    frames = 0;
    fpsTime = 0;
  }
}
requestAnimationFrame(loop);

window.roomPreview = { setView, loadTank, sceneMgr, room };
