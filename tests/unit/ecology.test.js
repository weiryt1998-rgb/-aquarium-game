import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CONFIG } from '../../src/config.js';
import { DECOR_ITEMS, getDecorCategory, getDecorItem } from '../../src/data/decor.js';
import { NO_ECOLOGY, algaeControl, ecologyReduction, sumEcology } from '../../src/sim/ecology.ts';
import { TankSimulation } from '../../src/sim/TankSimulation.ts';
import { createFishRecord } from '../../src/sim/records.ts';
import { Critter } from '../../src/entities/Critter.js';
import { WasteSystem } from '../../src/systems/WasteSystem.js';

const CRITTERS = DECOR_ITEMS.filter((d) => d.critter);

// ── สูตร ────────────────────────────────────────────────────────

test('ระบบนิเวศ: รวมบทบาทของหอยทั้งตู้ และของตกแต่งที่ไม่ใช่หอยไม่มีผล', () => {
  const e = sumEcology([getDecorItem('snail_nerite'), getDecorItem('snail_nerite'), getDecorItem('clam_freshwater'), getDecorItem('castle')]);
  assert.deepEqual(e, { algae: 0.1, waste: 0, filter: 0.05 });
  assert.equal(ecologyReduction(NO_ECOLOGY, 50), 0);
});

test('ระบบนิเวศ: หอยกรองน้ำ/กินตะไคร่ทำงานมากขึ้นเมื่อน้ำขุ่น และรวมแล้วไม่เกินเพดาน', () => {
  const filter = { algae: 0, waste: 0, filter: 0.05 };
  assert.ok(ecologyReduction(filter, 20) > ecologyReduction(filter, 95), 'น้ำขุ่นกรองได้มากกว่า');
  const algae = { algae: 0.05, waste: 0, filter: 0 };
  assert.ok(ecologyReduction(algae, 30) > ecologyReduction(algae, 100));
  const waste = { algae: 0, waste: 0.05, filter: 0 };
  assert.equal(ecologyReduction(waste, 30), ecologyReduction(waste, 100), 'ของเสียมีเท่า ๆ กันตลอด');
  // หอยเต็มทุกชนิดตามจำนวนสูงสุดต่อตู้
  const all = sumEcology(CRITTERS.flatMap((d) => Array(d.maxPerTank).fill(d)));
  assert.equal(ecologyReduction(all, 0), CONFIG.ecology.maxReduction);
  assert.ok(algaeControl(all) <= 0.7);
});

test('Simulation Engine: ตู้ที่มีหอยน้ำสกปรกช้ากว่า ส่วนตู้ที่ไม่มีหอยเหมือนเดิมทุกประการ', () => {
  const run = (ecology) => {
    const fish = Array.from({ length: 10 }, () => createFishRecord('molly_golden', { satiety: 100 }));
    const tank = { id: 't', typeId: 'starter', name: 't', cleanliness: 100, fish, decor: [], lastUpdate: 0 };
    const env = { decorHappiness: 0.5, cleanBonus: 0.1, capacity: 14, ...(ecology ? { ecology } : {}) };
    const sim = new TankSimulation(tank, env, { random: () => 0.99 });
    for (let i = 0; i < 1200; i++) {
      for (const f of tank.fish) f.satiety = 100;
      sim.tick(1);
    }
    return { cleanliness: tank.cleanliness, stats: sim.stats };
  };
  const none = run(null);
  const zero = run(NO_ECOLOGY);
  const snails = run(sumEcology([...Array(6).fill(getDecorItem('snail_nerite')), ...Array(4).fill(getDecorItem('snail_mystery'))]));
  assert.equal(zero.cleanliness, none.cleanliness, 'ไม่มีหอย = สูตรเดิม');
  assert.ok(snails.cleanliness > none.cleanliness, `มีหอย ${snails.cleanliness.toFixed(2)} > ไม่มี ${none.cleanliness.toFixed(2)}`);
  const lostWith = 100 - snails.cleanliness;
  const lostWithout = 100 - none.cleanliness;
  console.log(`20 นาที ปลา 10 ตัว: ไม่มีหอย สกปรก ${lostWithout.toFixed(1)}% · มีหอย 10 ตัว ${lostWith.toFixed(1)}% (ระบบนิเวศช่วย ${(snails.stats.ecology * 100).toFixed(0)}%)`);
  assert.ok(lostWith >= lostWithout * (1 - CONFIG.ecology.maxReduction) - 1e-9, 'ไม่ลดเกินเพดาน');
  assert.ok(snails.stats.ecology > 0 && none.stats.ecology === 0);
});

// ── ข้อมูล ──────────────────────────────────────────────────────

test('ข้อมูลหอย: หมวดหอย ชนิดการเคลื่อนที่ถูกต้อง มีบทบาท จำกัดจำนวนต่อตู้ และปลาว่ายผ่านได้', () => {
  assert.ok(getDecorCategory('critter'));
  assert.ok(CRITTERS.length >= 3);
  for (const d of CRITTERS) {
    assert.equal(d.category, 'critter', d.id);
    assert.ok(['glass', 'floor', 'stay'].includes(d.critter.move), `${d.id}: move`);
    assert.ok(d.critter.move === 'stay' || d.critter.speed > 0, `${d.id}: speed`);
    assert.ok(Object.values(d.ecology ?? {}).some((v) => v > 0), `${d.id}: ต้องมีบทบาทในระบบนิเวศ`);
    assert.ok(d.maxPerTank > 0 && d.maxPerTank <= 10, `${d.id}: maxPerTank`);
    assert.equal(d.obstacle, false, `${d.id}: ปลาต้องว่ายผ่านได้`);
    assert.ok(!d.pearl && !d.bubbles, d.id);
    assert.ok(d.description, `${d.id}: ต้องมีคำอธิบายบทบาท`);
  }
  const moves = new Set(CRITTERS.map((d) => d.critter.move));
  assert.deepEqual([...moves].sort(), ['floor', 'glass', 'stay'], 'มีครบทั้งคลานกระจก คลานพื้น และกรองอยู่กับที่');
});

// ── พฤติกรรมหอย (Three.js ล้วน ไม่ต้องมีหน้าจอ) ─────────────────

const DIMS = { w: 14.5, d: 6.5, h: 7.2, waterTop: 6.75 };
const floorAt = (x, z) => 0.35 + 0.2 * Math.sin(x * 0.5) * Math.cos(z * 0.4);
const aquarium = { dims: DIMS, heightAt: floorAt, clampToWater: (p, m) => p.clamp(new THREE.Vector3(-DIMS.w / 2 + m, floorAt(p.x, p.z), -DIMS.d / 2 + m), new THREE.Vector3(DIMS.w / 2 - m, DIMS.waterTop - m, DIMS.d / 2 - m)) };

function makeCritter(itemId, x = 0, z = 0) {
  const item = getDecorItem(itemId);
  const group = new THREE.Group();
  const object = new THREE.Group();
  object.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.2, 0.4)));
  group.add(object);
  group.position.set(x, floorAt(x, z), z);
  const decor = { id: `decor_${itemId}_${x}`, item, data: { x, z, rotY: 0 }, group, object, game: { aquarium } };
  decor.critter = new Critter(decor);
  return decor;
}

function makeWaste() {
  const game = { aquarium, fish: { list: [] }, sceneMgr: { scene: { add() {} } } };
  return new WasteSystem(game);
}

const step = (decors, seconds, ctx, dt = 1 / 30) => {
  for (let t = 0; t < seconds; t += dt) {
    ctx.waste?.update(dt, t);
    for (const d of decors) d.critter.update(dt, t, ctx);
  }
};

test('หอยเนอไรต์: วางบนทรายแล้วคลานไปเกาะกระจก (ซ้าย/หลัง/ขวา ไม่เกาะกระจกหน้า) อยู่ใต้ผิวน้ำ ไม่หลุดออกนอกตู้', () => {
  const snail = makeCritter('snail_nerite', 1, DIMS.d / 2 - 0.4); // วางชิดกระจกหน้า
  const ctx = { aquarium, waste: makeWaste(), obstacles: [], frozen: false, algae: 0.5 };
  step([snail], 240, ctx);
  assert.equal(snail.critter.onGlass, true, 'เกาะกระจกแล้ว');
  let maxY = 0;
  for (let i = 0; i < 600 / (1 / 30); i++) {
    snail.critter.update(1 / 30, i / 30, ctx);
    const p = snail.group.position;
    const toGlass = Math.min(DIMS.w / 2 - Math.abs(p.x), DIMS.d / 2 - Math.abs(p.z));
    assert.ok(toGlass < 0.2 && toGlass > 0, `ชิดกระจก (ห่าง ${toGlass.toFixed(3)})`);
    assert.ok(p.z < DIMS.d / 2 - 0.3, `ไม่อยู่บนกระจกหน้า (z ${p.z.toFixed(2)})`);
    assert.ok(p.y < DIMS.waterTop && p.y > floorAt(p.x, p.z), 'อยู่ใต้ผิวน้ำ เหนือพื้น');
    maxY = Math.max(maxY, p.y);
  }
  assert.ok(maxY > 1.5, `คลานขึ้นกระจกได้ (สูงสุด ${maxY.toFixed(2)})`);
  // หลังหอยหันเข้าในตู้ (แกน y ของตัวหอยตั้งฉากกับกระจก)
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(snail.group.quaternion);
  assert.ok(Math.abs(up.y) < 0.3, 'ตัวแนบกระจก ไม่ได้ตั้งขึ้นฟ้า');
});

test('หอยคลานพื้น: คลานไปกินของเสียที่ปลาปล่อยลงพื้น ไม่ทะลุของตกแต่ง', () => {
  const waste = makeWaste();
  const ctx = { aquarium, waste, obstacles: [{ x: 1.5, z: 0, r: 0.6, top: 2 }], frozen: false, algae: 0 };
  const snail = makeCritter('snail_mystery', 0, 0);
  for (const [x, z] of [[2.6, 0.2], [-1.5, 1], [0.5, -1.4]]) waste.drop(new THREE.Vector3(x, 3, z));
  step([snail], 20, { ...ctx, waste }); // รอของเสียจมถึงพื้นก่อน (หอยยังไม่ได้กลิ่น)
  let inside = 0;
  for (let t = 0; t < 900 && waste.items.length; t += 1 / 30) {
    waste.update(1 / 30, t);
    snail.critter.update(1 / 30, t, ctx);
    const p = snail.group.position;
    if (Math.hypot(p.x - 1.5, p.z) < 0.6 * 0.8 + 0.1) inside++;
  }
  assert.equal(waste.items.length, 0, 'กินของเสียหมด');
  assert.equal(inside, 0, 'ไม่คลานทะลุของตกแต่ง');
});

test('หอยไม่หมุนอยู่กับที่: วางทับฐานหิน / ของเสียตกบนฐานหิน / ที่โล่ง → คลานออกไปได้ และเลี้ยวโค้งช้า ๆ', () => {
  const rock = { x: 1.5, z: 0, r: 0.9, top: 2 };
  const yawOf = (g) => {
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(g.quaternion);
    return Math.atan2(f.x, f.z);
  };
  const cases = [
    ['วางทับฐานหิน', makeCritter('snail_trumpet', 1.3, 0.1), null],
    ['ของเสียบนฐานหิน', makeCritter('snail_ramshorn', 0.2, 0), [1.5, 0.2]],
    ['ที่โล่ง', makeCritter('snail_ramshorn', -4, -1), null],
  ];
  for (const [label, snail, wasteAt] of cases) {
    const waste = makeWaste();
    if (wasteAt) waste.drop(new THREE.Vector3(wasteAt[0], floorAt(...wasteAt), wasteAt[1])).settled = true;
    const ctx = { aquarium, waste, obstacles: [rock], frozen: false, algae: 0 };
    let worst = 0;
    let turn = 0;
    let prev = null;
    for (let i = 0; i < 120 * 30; i++) {
      snail.critter.update(1 / 30, i / 30, ctx);
      const yaw = yawOf(snail.group);
      if (prev != null) turn += Math.abs(Math.atan2(Math.sin(yaw - prev), Math.cos(yaw - prev)));
      prev = yaw;
      if (i % 300 === 299) {
        worst = Math.max(worst, turn);
        turn = 0;
      }
    }
    const deg = (worst * 180) / Math.PI;
    assert.ok(deg < 180, `${label}: เลี้ยวมากสุด ${deg.toFixed(0)}°/10 วินาที`);
    const p = snail.group.position;
    assert.ok(Math.hypot(p.x - rock.x, p.z - rock.z) >= rock.r * 0.8, `${label}: ออกจากฐานหินได้`);
  }
});

test('หอยกาบ: ดูดฝุ่นขยะที่ลอยลงมาใกล้ ๆ และอยู่กับที่', () => {
  const waste = makeWaste();
  const clam = makeCritter('clam_freshwater', 0, 0);
  const before = clam.group.position.clone();
  for (let i = 0; i < 5; i++) waste.drop(new THREE.Vector3(i * 0.2 - 0.4, 1.5, 0));
  waste.drop(new THREE.Vector3(5, 2, 2)); // ไกลเกินไป ตกถึงพื้นตามปกติ
  step([clam], 30, { aquarium, waste, obstacles: [], frozen: false, algae: 0 });
  assert.equal(waste.items.length, 1, 'ดูดเฉพาะที่อยู่ใกล้');
  assert.equal(waste.items[0].settled, true);
  assert.ok(clam.group.position.equals(before), 'ไม่เคลื่อนที่');
});

test('โหมดตกแต่ง: หอยหยุดนิ่งให้เลือก/ลากได้', () => {
  const snail = makeCritter('snail_ramshorn', 0, 0);
  const ctx = { aquarium, waste: makeWaste(), obstacles: [], frozen: false, algae: 0 };
  step([snail], 15, ctx);
  const at = snail.group.position.clone();
  step([snail], 15, { ...ctx, frozen: true });
  assert.ok(snail.group.position.equals(at));
});

// ── ของเสีย ─────────────────────────────────────────────────────

test('ของเสีย: ปลาปล่อยตามจำนวนปลา จมถึงพื้น ไม่เกินจำนวนสูงสุด สลายเองเมื่อไม่มีใครกิน และล้างหมดเมื่อทำความสะอาด', () => {
  const fish = Array.from({ length: 20 }, (_, i) => ({ dying: false, species: { behavior: {} }, heading: new THREE.Vector3(0, 0, 1), position: new THREE.Vector3(i * 0.3 - 3, 3, 0), length: 0.7 }));
  const game = { aquarium, fish: { list: fish }, sceneMgr: { scene: { add() {} } } };
  const waste = new WasteSystem(game);
  const dt = 0.5;
  for (let t = 0; t < 60; t += dt) waste.update(dt, t);
  const expected = (20 * 60) / CONFIG.ecology.wasteInterval;
  assert.ok(Math.abs(waste.items.length - expected) <= 2, `ปล่อย ${waste.items.length} ก้อนใน 1 นาที (คาด ~${expected})`);
  for (let t = 0; t < 240; t += dt) waste.update(dt, t); // ยังไม่ถึงอายุที่สลายเอง
  assert.equal(waste.items.length, CONFIG.ecology.maxWaste, 'ไม่เกินเพดาน');
  assert.ok(waste.items.every((w) => w.settled && Math.abs(w.position.y - (floorAt(w.position.x, w.position.z) + 0.02)) < 1e-6), 'จมถึงพื้นหมด');
  game.fish.list = [];
  for (let t = 0; t < CONFIG.ecology.wasteLife + 10; t += 5) waste.update(5, t);
  assert.equal(waste.items.length, 0, 'สลายไปเอง');
  game.fish.list = fish;
  for (let t = 0; t < 30; t += dt) waste.update(dt, t);
  assert.ok(waste.items.length > 0);
  waste.clear();
  assert.equal(waste.items.length, 0);
  assert.equal(waste.mesh.count, 0);
});
