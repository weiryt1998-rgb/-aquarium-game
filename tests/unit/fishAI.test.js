import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { FishAI } from '../../src/ai/FishAI.ts';
import { personalityOf } from '../../src/ai/personality.ts';
import { seededRandom } from '../../src/ai/vec.ts';

const STEP = FishAI.STEP;
const MOLLY = { speed: 0.7, agility: 2.2, zone: 'middle', schooling: true, group: 'molly' };

/** ตู้ 90 ซม. พื้นทรายเป็นลอน มีของตกแต่ง 3 ชิ้นและพืชน้ำ 2 ต้น */
function makeWorld() {
  const food = [];
  const eaten = [];
  const world = {
    w: 14.5,
    d: 6.5,
    waterTop: 6.75,
    floorAt: (x, z) => 0.35 + 0.25 * Math.sin(x * 0.5) * Math.cos(z * 0.4),
    obstacles: [
      { x: -3, z: 0.5, r: 1.0, top: 2.2 },
      { x: 2.5, z: -1, r: 0.8, top: 1.6 },
      { x: 5, z: 1.5, r: 1.2, top: 3.0 },
    ],
    covers: [],
    food,
    consume(item, fishId) {
      assert.ok(!item.gone, 'ไม่กินเม็ดเดียวซ้ำ');
      item.gone = true;
      food.splice(food.indexOf(item), 1);
      eaten.push(fishId);
    },
  };
  world.covers = [...world.obstacles.map((o) => ({ ...o, plant: false })), { x: -5.5, z: -2, r: 0.9, top: 3.5, plant: true }, { x: 0, z: 2.2, r: 0.7, top: 3, plant: true }];
  return { world, food, eaten };
}

function makeAI(count, { seed = 7, hunger = 20, ids, species = MOLLY } = {}) {
  const { world, food, eaten } = makeWorld();
  const rnd = seededRandom(seed);
  const ai = new FishAI(world, { random: rnd });
  // เหมือนเกมจริง: กินแล้วอิ่มขึ้น (Simulation Engine เพิ่มความอิ่มตามคุณค่าอาหาร)
  const consume = world.consume;
  world.consume = (item, id) => {
    consume(item, id);
    const fish = ai.get(id);
    fish.needs.hunger = Math.max(0, fish.needs.hunger - 25);
  };
  for (let i = 0; i < count; i++) {
    const id = ids?.[i] ?? `fish_${seed}_${i}`;
    const x = (rnd() - 0.5) * 10;
    const z = (rnd() - 0.5) * 4;
    const a = ai.add(id, species, { x, y: 3 + rnd() * 2, z });
    a.needs = { hunger, health: 100, growth: 1, age: 0, length: 0.7, pregnant: false, cleanliness: 90 };
  }
  return { ai, world, food, eaten };
}

/** โรยอาหาร n เม็ดที่ผิวน้ำ (เหมือน FoodSystem.sprinkle + แจ้ง AI) */
const sprinkle = (food, n, x = 0, z = 0, ai = null) => {
  for (let i = 0; i < n; i++) food.push({ position: { x: x + (i % 4) * 0.25 - 0.4, y: 6.5 - i * 0.05, z: z + Math.floor(i / 4) * 0.25 } });
  ai?.notifyFood({ x, y: 6.5, z });
};

/** ทุกตัวอยู่ในน้ำ ไม่ทะลุกระจก/พื้น/ผิวน้ำ/ของตกแต่ง */
function assertInside(ai, world) {
  for (const a of ai.agents) {
    const p = a.pos;
    assert.ok(Number.isFinite(p.x + p.y + p.z), 'ตำแหน่งต้องเป็นตัวเลข');
    const m = a.radius * 0.6 + 0.12 - 1e-6;
    assert.ok(Math.abs(p.x) <= world.w / 2 - m && Math.abs(p.z) <= world.d / 2 - m, `ทะลุกระจก ${p.x.toFixed(2)},${p.z.toFixed(2)}`);
    assert.ok(p.y >= world.floorAt(p.x, p.z) + a.radius * 0.45 + 0.12 - 1e-6, 'ทะลุพื้น');
    assert.ok(p.y <= world.waterTop, 'ลอยพ้นน้ำ');
    for (const o of world.obstacles) {
      if (p.y > o.top + a.radius * 0.3) continue;
      assert.ok(Math.hypot(p.x - o.x, p.z - o.z) >= o.r * 0.8 + a.radius * 0.5 - 1e-6, 'ทะลุของตกแต่ง');
    }
  }
}

test('Fish AI ไม่พึ่ง Three.js หรือ DOM', () => {
  for (const file of fs.readdirSync('src/ai')) {
    const src = fs.readFileSync(path.join('src/ai', file), 'utf8');
    assert.doesNotMatch(src, /from ['"]three|document\.|window\.|requestAnimationFrame/, file);
  }
});

test('ปลาไม่ทะลุกระจก พื้น ผิวน้ำ หรือของตกแต่ง (60 ตัว 3 นาที มีอาหารและสิ่งรบกวน)', () => {
  const { ai, world, food } = makeAI(60, { hunger: 50 });
  for (let i = 0; i < 180 / STEP; i++) {
    if (i % 600 === 0) sprinkle(food, 8, (i / 600) % 2 ? 4 : -4, 0, ai);
    if (i === 2000) ai.startle(null, 60);
    ai.step(STEP);
    assertInside(ai, world);
  }
});

test('เลี้ยวนุ่ม: หมุนหัวไม่เกินอัตราสูงสุด และไม่ส่ายสั่นไปมา', () => {
  const { ai, world, food } = makeAI(30, { hunger: 40 });
  const flips = new Map(ai.agents.map((a) => [a.id, 0]));
  const lastSign = new Map();
  for (let i = 0; i < 120 / STEP; i++) {
    if (i % 900 === 300) sprinkle(food, 8, 0, 0, ai);
    ai.step(STEP);
    for (const a of ai.agents) {
      const turned = Math.acos(Math.min(1, a.heading.x * a.prevHeading.x + a.heading.y * a.prevHeading.y + a.heading.z * a.prevHeading.z));
      assert.ok(turned <= a.maxTurn * STEP * 1.0001 + 1e-6, `หักหัว ${turned} > ${a.maxTurn * STEP}`);
      // นับการสลับทิศเลี้ยวซ้าย/ขวาที่ชัดเจน (ส่ายสั่น)
      if (Math.abs(a.yawRate) > 0.4) {
        const s = Math.sign(a.yawRate);
        if (lastSign.has(a.id) && lastSign.get(a.id) !== s) flips.set(a.id, flips.get(a.id) + 1);
        lastSign.set(a.id, s);
      }
    }
  }
  const perMinute = [...flips.values()].reduce((s, n) => s + n, 0) / ai.agents.length / 2;
  assert.ok(perMinute < 20, `สลับทิศเลี้ยว ${perMinute.toFixed(1)} ครั้ง/นาที`);
  assertInside(ai, world);
});

test('ปลาที่หิวว่ายไปหาอาหารและกินได้ โดยไม่แห่ทับจุดเดียวกัน', () => {
  const { ai, food, eaten } = makeAI(10, { hunger: 70 });
  for (let i = 0; i < 3 / STEP; i++) ai.step(STEP);
  sprinkle(food, 8, 0, 0, ai);
  let overlaps = 0;
  let samples = 0;
  for (let i = 0; i < 40 / STEP && food.length; i++) {
    ai.step(STEP);
    for (let j = 0; j < ai.agents.length; j++)
      for (let k = j + 1; k < ai.agents.length; k++) {
        samples++;
        if (ai.agents[j].pos.distanceSq(ai.agents[k].pos) < 0.2 * 0.2) overlaps++;
      }
  }
  assert.equal(eaten.length, 8, `กินได้ ${eaten.length}/8 เม็ด`);
  assert.ok(new Set(eaten).size >= 4, 'กระจายกันกินหลายตัว ไม่ใช่ตัวเดียวกินหมด');
  assert.ok(overlaps / samples < 0.01, `ปลาทับกัน ${((overlaps / samples) * 100).toFixed(2)}% ของเวลา`);
});

test('ปลาที่อิ่มแล้วไม่สนอาหาร', () => {
  const { ai, food, eaten } = makeAI(6, { hunger: 2 });
  sprinkle(food, 8, 0, 0, ai);
  for (let i = 0; i < 20 / STEP; i++) ai.step(STEP);
  assert.equal(eaten.length, 0);
});

test('เปลี่ยนสถานะไม่ถี่เกินไป', () => {
  const { ai, food } = makeAI(30, { hunger: 30 });
  const changes = new Map(ai.agents.map((a) => [a.id, 0]));
  const last = new Map(ai.agents.map((a) => [a.id, a.state]));
  let calmSteps = 0;
  let varied = 0;
  for (let i = 0; i < 180 / STEP; i++) {
    if (i % 1800 === 900) sprinkle(food, 8, 0, 0, ai);
    ai.step(STEP);
    for (const a of ai.agents) {
      if (a.state !== last.get(a.id) && a.state !== 'avoid' && last.get(a.id) !== 'avoid') changes.set(a.id, changes.get(a.id) + 1);
      last.set(a.id, a.state);
    }
    if (!food.length) {
      calmSteps++;
      if (new Set(ai.agents.map((a) => a.state)).size >= 2) varied++;
    }
  }
  const perMinute = [...changes.values()].reduce((s, n) => s + n, 0) / ai.agents.length / 3;
  assert.ok(perMinute < 10, `เปลี่ยนสถานะเฉลี่ย ${perMinute.toFixed(1)} ครั้ง/นาที`);
  assert.ok(varied / calmSteps > 0.9, 'ช่วงไม่มีอาหาร ปลาแต่ละตัวทำสิ่งต่างกันในเวลาเดียวกัน');
});

test('ใช้ครบทุกสถานะ: ว่ายเล่น สำรวจ หาอาหาร กิน พัก ฝูง หลบสิ่งกีดขวาง หลบซ่อน', () => {
  const { ai, food } = makeAI(40, { hunger: 40 });
  const seen = new Set();
  for (let i = 0; i < 240 / STEP; i++) {
    if (i % 1200 === 600) sprinkle(food, 8, (i % 2400) - 1200 > 0 ? 3 : -3, 0, ai);
    if (i === 3000) ai.startle(null, 80);
    if (i === 5000) for (const a of ai.agents) a.energy = 5;
    ai.step(STEP);
    for (const a of ai.agents) seen.add(a.state);
  }
  for (const s of ['idle', 'explore', 'seekFood', 'eat', 'rest', 'school', 'avoid', 'hide']) assert.ok(seen.has(s), `ไม่เคยเข้าสถานะ ${s}`);
});

test('เกี้ยวพาราสี: ตัวผู้ว่ายตามตัวเมีย เข้าประชิดเป็นระยะ ไม่ทะลุตู้ และเลิกเมื่อถูกสั่ง/ตัวเมียหายไป', () => {
  const { ai, world } = makeAI(12, { hunger: 10 });
  const [dad, mom] = ai.agents;
  for (let i = 0; i < 2 / STEP; i++) ai.step(STEP);
  assert.equal(ai.court(dad.id, mom.id), true);
  assert.equal(ai.court('fish_nope', mom.id), false, 'ไม่มี agent (เช่น ปู) → ไม่มีท่าเกี้ยว');
  let sum = 0;
  let n = 0;
  let closest = Infinity;
  for (let i = 0; i < 30 / STEP; i++) {
    ai.step(STEP);
    assertInside(ai, world);
    if (i < 10 / STEP) continue; // ช่วงแรกตัวผู้ยังว่ายไปหา (อาจเริ่มห่างกันเกือบสุดตู้)
    assert.equal(dad.state === 'court' || dad.state === 'avoid' || dad.state === 'hide' || dad.state === 'seekFood' || dad.state === 'eat', true, dad.state);
    const d = Math.sqrt(dad.pos.distanceSq(mom.pos));
    sum += d;
    n++;
    closest = Math.min(closest, d);
  }
  console.log(`เกี้ยว: ระยะเฉลี่ย ${(sum / n).toFixed(2)} · ใกล้สุด ${closest.toFixed(2)} (ความยาวปลา 0.7)`);
  assert.ok(sum / n < 1.6, `ตัวผู้ว่ายตามใกล้ ๆ ตัวเมีย (เฉลี่ย ${(sum / n).toFixed(2)})`);
  assert.ok(closest < 0.45, `เข้าประชิดตัวเมีย (ใกล้สุด ${closest.toFixed(2)})`);
  assert.equal(mom.courtedBy, dad);

  ai.endCourt(dad.id);
  assert.equal(dad.mate, null);
  assert.equal(mom.courtedBy, null);
  for (let i = 0; i < 3 / STEP; i++) ai.step(STEP);
  assert.notEqual(dad.state, 'court');

  // ตัวเมียถูกเอาออกจากตู้ระหว่างเกี้ยว → ตัวผู้เลิกเกี้ยวเอง ไม่ค้างอ้างถึงปลาที่ไม่อยู่แล้ว
  ai.court(dad.id, mom.id);
  ai.remove(mom.id);
  assert.equal(dad.mate, null);
  for (let i = 0; i < 3 / STEP; i++) ai.step(STEP);
  assert.notEqual(dad.state, 'court');
});

test('บุคลิกต่างกันทำให้พฤติกรรมต่างกัน', () => {
  // หา ID ที่ได้บุคลิกหลักแต่ละแบบ
  const idsOf = (trait, n) => {
    const out = [];
    for (let i = 0; out.length < n; i++) if (personalityOf(`p_${i}`).primary === trait) out.push(`p_${i}`);
    return out;
  };
  const measure = (trait) => {
    const { ai } = makeAI(8, { ids: idsOf(trait, 8), seed: 11, hunger: 0 });
    let speed = 0;
    let hide = 0;
    let n = 0;
    const visited = new Set();
    for (let i = 0; i < 240 / STEP; i++) {
      if (i === 3600) ai.startle(null, 45);
      ai.step(STEP);
      for (const a of ai.agents) {
        speed += a.speed;
        if (a.state === 'hide') hide++;
        visited.add(`${Math.floor(a.pos.x)}:${Math.floor(a.pos.y)}:${Math.floor(a.pos.z)}`);
        n++;
      }
    }
    return { speed: speed / n, hide: hide / n, area: visited.size };
  };
  const curious = measure('curious');
  const calm = measure('calm');
  const active = measure('active');
  const shy = measure('shy');
  console.log({ curious, calm, active, shy });
  assert.ok(active.speed > calm.speed * 1.15, 'ปลากระฉับกระเฉงว่ายเร็วกว่าปลาใจเย็น');
  assert.ok(curious.area > calm.area, 'ปลาขี้สงสัยสำรวจพื้นที่มากกว่า');
  assert.ok(shy.hide > calm.hide, 'ปลาขี้อายหลบซ่อนนานกว่าเมื่อตกใจ');
});

test('บุคลิกคงที่ตาม ID (โหลดเซฟใหม่ได้บุคลิกเดิม)', () => {
  assert.deepEqual(personalityOf('fish_abc'), personalityOf('fish_abc'));
  const kinds = new Set(Array.from({ length: 50 }, (_, i) => personalityOf(`fish_${i}`).primary));
  assert.equal(kinds.size, 5);
});

test('Fixed timestep: คำนวณ 30 ครั้ง/วินาทีไม่ว่า FPS เท่าไร และไม่ค้างเมื่อเฟรมยาวมาก', () => {
  const { ai } = makeAI(3);
  let steps = 0;
  for (let i = 0; i < 144; i++) steps += ai.update(1 / 144);
  assert.ok(Math.abs(steps - 30) <= 1, `${steps} จังหวะใน 1 วินาที`);
  assert.equal(ai.update(10), FishAI.MAX_STEPS);
  assert.ok(ai.alpha >= 0 && ai.alpha < 1);
});

test('ประสิทธิภาพ: ปลา 300 ตัวยังคำนวณได้เร็ว (Spatial Grid)', () => {
  const { ai, food } = makeAI(300, { hunger: 40 });
  sprinkle(food, 40, 0, 0, ai);
  for (let i = 0; i < 60; i++) ai.step(STEP); // อุ่นเครื่อง
  const t0 = performance.now();
  const steps = 300;
  for (let i = 0; i < steps; i++) ai.step(STEP);
  const ms = (performance.now() - t0) / steps;
  console.log(`ปลา 300 ตัว: ${ms.toFixed(2)} ms ต่อจังหวะ`);
  assert.ok(ms < 8, `${ms.toFixed(2)} ms/จังหวะ`);
});
