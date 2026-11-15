/**
 * ทดสอบ "เล่นด้วยกันสองคน" ในเกมจริง: Chrome 2 หน้าต่าง (คนละเครื่องจำลอง) บน Firebase Emulator
 * - ตัวละครไม่ชนกัน (เครื่องที่เปิดทีหลังได้อีกตัว) · เชื่อมต่อตรง WebRTC · เดินแล้วอีกเครื่องเห็นตาม
 * - คุยกันข้ามเครื่อง · สลับตัวไม่ได้ระหว่างเล่นด้วยกัน
 * - เครื่องที่ใช้ WebRTC ไม่ได้ → ส่งตำแหน่งผ่านคลาวด์แทน · ปิดหน้าเกม → อีกเครื่องกลับมาใช้ AI
 *
 * รัน: npm run test:e2e:coop   (ต้องมี Google Chrome และ Java)
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
import { createUser, resetEmulators, setSparkPlayer } from '../../scripts/emulator-api.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'test-results', 'e2e-dist-coop');
const PORT = 5197;
const URL = `http://127.0.0.1:${PORT}/`;
const EMAIL = 'player@aquarium.test';
const PASSWORD = 'e2e-test-password-only';
const log = (...a) => console.log('[e2e:coop]', ...a);

let browser;
let server;
const devices = [];

async function newDevice(name, { noRtc = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 700 } });
  await context.addInitScript(
    ({ noRtc }) => {
      if (!localStorage.getItem('aquarium-game-settings')) localStorage.setItem('aquarium-game-settings', JSON.stringify({ sound: false, ambient: false, quality: 'low', character: 'man' }));
      if (noRtc) delete window.RTCPeerConnection;
    },
    { noRtc },
  );
  const d = { name, context, errors: [] };
  d.page = await context.newPage();
  d.page.on('pageerror', (e) => d.errors.push(`pageerror: ${e.message}`));
  d.page.on('console', (m) => {
    if (m.type() === 'error' && !/net::ERR|Failed to load resource/.test(m.text())) d.errors.push(`console: ${m.text()}`);
    if (/\[coop\]/.test(m.text())) log(name, m.text());
  });
  devices.push(d);
  return d;
}

async function waitFor(fn, { timeout = 30_000, interval = 250, message = 'condition' } = {}) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timeout waiting for ${message}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

const ev = (d, fn, arg) => d.page.evaluate(fn, arg);

/** เข้าสู่ระบบ → เริ่มเล่น → ออกไปฟาร์ม → รอโมเดลคนโหลดเสร็จ */
async function enterFarm(d) {
  await d.page.goto(URL);
  await d.page.waitForSelector('[data-state="login"]', { timeout: 60_000 });
  await d.page.fill('#game-password', PASSWORD);
  await d.page.click('[data-state="login"] button[type="submit"]');
  // เครื่องแรก: ยังไม่มีเซฟกลาง → ยืนยันสร้างเซฟใหม่
  const first = await Promise.race([
    d.page.waitForSelector('[data-state="no-save"]', { timeout: 120_000 }).then(() => true),
    d.page.waitForSelector('.start-screen:not(.auth-screen) .btn-start:not(.hidden)', { timeout: 120_000 }).then(() => false),
  ]);
  if (first) await d.page.click('[data-state="no-save"] [data-choice]');
  await d.page.waitForSelector('.start-screen:not(.auth-screen) .btn-start:not(.hidden)', { timeout: 120_000 });
  await d.page.addStyleTag({ content: '.btn-start { animation: none !important; transition: none !important; }' });
  await d.page.click('.start-screen:not(.auth-screen) .btn-start');
  await d.page.waitForFunction(() => window.game?.started === true, null, { timeout: 20_000 });
  await ev(d, () => window.game.goTo('farm'));
  await d.page.waitForFunction(() => window.game.location === 'farm' && !!window.game.farm.player, null, { timeout: 180_000 });
}

/** กด W ค้างไว้ ms มิลลิวินาที (เดินไปทางที่กล้องมอง) */
async function walk(d, ms) {
  await d.page.bringToFront();
  await d.page.keyboard.down('KeyW');
  await new Promise((r) => setTimeout(r, ms));
  await d.page.keyboard.up('KeyW');
}

const posOf = (d, key) => ev(d, (k) => {
  const p = window.game.farm.people[k].position;
  return { x: p.x, z: p.z };
}, key);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

before(async () => {
  process.env.VITE_CLOUD_SAVE_MODE = 'rules';
  log('building web app (mode emulator)');
  await build({ root: ROOT, mode: 'emulator', logLevel: 'warn', build: { outDir: OUT_DIR, emptyOutDir: true } });
  server = await preview({ root: ROOT, mode: 'emulator', logLevel: 'warn', build: { outDir: OUT_DIR }, preview: { port: PORT, strictPort: true, host: '127.0.0.1', open: false } });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  await resetEmulators();
  const { uid } = await createUser(EMAIL, PASSWORD);
  await setSparkPlayer(uid);
});

after(async () => {
  for (const d of devices) if (d.errors.length) log(`${d.name} errors:`, d.errors);
  await browser?.close();
  await new Promise((r) => (server?.httpServer ? server.httpServer.close(r) : r()));
});

let A;
let B;

test('1) สองเครื่องเลือกตัวเดียวกัน → เครื่องที่เปิดทีหลังได้อีกตัว และเห็นกันเป็นเพื่อน', async () => {
  A = await newDevice('A');
  await enterFarm(A);
  B = await newDevice('B');
  await enterFarm(B);
  await waitFor(async () => (await ev(A, () => window.game.farm.remoteKey)) === 'woman' && (await ev(B, () => window.game.farm.remoteKey)) === 'man', {
    message: 'remote keys',
  });
  assert.equal(await ev(A, () => window.game.farm.controlled), 'man');
  assert.equal(await ev(B, () => window.game.farm.controlled), 'woman');
  assert.match(await A.page.textContent('.coop-badge'), /เพื่อน 👩 ผู้หญิง/);
});

test('2) เชื่อมต่อตรง (WebRTC) แล้วเดิน → อีกเครื่องเห็นตำแหน่งเดียวกัน', async () => {
  await waitFor(async () => (await ev(A, () => window.game.farm.coop.direct)) && (await ev(B, () => window.game.farm.coop.direct)), { message: 'direct link' });
  // ย้ายตัวไปจุดใหม่ (ไม่พึ่งการกดปุ่ม — เฟรมเรตในเครื่องทดสอบต่ำ เดินได้ไม่แน่นอน) แล้วเดินต่ออีกนิด
  const moved = await ev(A, () => {
    const p = window.game.farm.player;
    p.place(p.position.x + 2.5, p.position.z + 1.5, 0.5);
    return { x: p.position.x, z: p.position.z };
  });
  await waitFor(async () => dist(await posOf(B, 'man'), moved) < 0.3, { timeout: 5000, message: 'B sees A move' });
  const bMoved = await ev(B, () => {
    const p = window.game.farm.player;
    p.place(p.position.x - 2, p.position.z + 2, 2);
    return { x: p.position.x, z: p.position.z };
  });
  await waitFor(async () => dist(await posOf(A, 'woman'), bMoved) < 0.3, { timeout: 5000, message: 'A sees B move' });
  // เดินด้วยปุ่มจริง: อีกเครื่องเห็นท่าเดิน/วิ่ง
  await A.page.bringToFront();
  await A.page.keyboard.down('KeyW');
  const clip = await waitFor(async () => {
    const c = await ev(B, () => window.game.farm.people.man.clipName);
    return c === 'walk' || c === 'run' ? c : null;
  }, { timeout: 5000, message: 'B sees walk clip' });
  await A.page.keyboard.up('KeyW');
  log('B sees A clip', clip);
});

test('3) คุยกับเพื่อน → อีกเครื่องเล่นฉากเดียวกัน · บันทึกผลครั้งเดียว', async () => {
  const before = await ev(A, () => window.game.state.data.social ?? null);
  // เมนูวงกลมจริง: หมวด "ทั่วไป" → บทสนทนาแรกที่ไม่ล็อก
  await ev(A, () => window.game.farm.social.open('woman'));
  await A.page.click('.social-menu button.sm-cat[data-id="friendly"]');
  await A.page.click('.social-menu button.sm-item.sm-item:not(.locked):not(.sm-cat):not(.sm-extra)');
  await waitFor(async () => ev(A, () => !!window.game.farm.social.job), { timeout: 5000, message: 'A social job' });
  await waitFor(async () => ev(B, () => window.game.farm.social.job?.remote === true), { timeout: 5000, message: 'B mirrors social' });
  const jobA = await ev(A, () => ({ id: window.game.farm.social.job.def.id, ok: window.game.farm.social.job.ok }));
  const jobB = await ev(B, () => ({ id: window.game.farm.social.job.def.id, ok: window.game.farm.social.job.ok }));
  assert.deepEqual(jobB, jobA);
  await waitFor(async () => !(await ev(A, () => !!window.game.farm.social.job)), { timeout: 120_000, message: 'social finished' });
  const after = await ev(A, () => window.game.state.data.social ?? null);
  assert.notDeepEqual(after, before, 'ความสัมพันธ์เปลี่ยน (บันทึกจากเครื่อง A)');
  log('social', jobA);
});

test('4) สลับตัวไม่ได้ระหว่างเล่นด้วยกัน', async () => {
  await ev(A, () => window.game.farm.swapCharacter());
  assert.equal(await ev(A, () => window.game.farm.controlled), 'man');
});

test('5) ปิดหน้าเกม B → A เห็นว่าเพื่อนออกแล้ว ตัวละครกลับมาเดินเอง', async () => {
  await B.context.close();
  await waitFor(async () => (await ev(A, () => window.game.farm.remoteKey)) === null, { timeout: 90_000, message: 'peer gone' });
  assert.equal(await ev(A, () => window.game.farm.people.woman.remote), false);
});

test('6) เครื่องที่ใช้ WebRTC ไม่ได้ → ส่งตำแหน่งผ่านคลาวด์แทน', async () => {
  const C = await newDevice('C', { noRtc: true });
  await enterFarm(C);
  await waitFor(async () => (await ev(A, () => window.game.farm.remoteKey)) === 'woman', { message: 'A sees C' });
  assert.equal(await ev(C, () => window.game.farm.controlled), 'woman');
  assert.equal(await ev(C, () => window.game.farm.coop.direct), false);
  await walk(C, 2500);
  const moved = await posOf(C, 'woman');
  await waitFor(async () => dist(await posOf(A, 'woman'), moved) < 0.4, { timeout: 12_000, message: 'A sees C move via relay' });
  assert.match(await A.page.textContent('.coop-badge'), /☁️/);
});
