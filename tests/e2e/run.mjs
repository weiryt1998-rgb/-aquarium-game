/**
 * ทดสอบ end-to-end: เปิดเกมจริงใน Chrome หลาย "อุปกรณ์" (browser context แยกกัน = คนละเครื่อง)
 * เชื่อมกับ Firebase Emulator ผ่านหน้าเว็บที่ build แบบ production
 *
 * รัน: npm run test:e2e        (แผน Spark: Auth + Firestore, Rules ล็อก UID บัญชีหลัก)
 *      npm run test:e2e:blaze  (แผน Blaze: + Cloud Functions)
 * ต้องมี Google Chrome ในเครื่อง และ Java สำหรับ Firestore Emulator
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { build, preview } from 'vite';
import { allowPlayer, clearFirestore, createUser, deleteDoc, listDocs, readDoc, resetEmulators, setSparkPlayer } from '../../scripts/emulator-api.mjs';

const MODE = process.argv.includes('functions') ? 'functions' : 'rules';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT_DIR = path.join(ROOT, 'test-results', `e2e-dist-${MODE}`);
const PORT = MODE === 'rules' ? 5198 : 5199;
const URL = `http://127.0.0.1:${PORT}/`;
const EMAIL = 'player@aquarium.test';
const PASSWORD = 'e2e-test-password-only';
const log = (...a) => console.log(`[e2e:${MODE}]`, ...a);
/** ให้สิทธิ์: Spark = โหลด firestore.rules ที่ใส่ UID นี้เข้า emulator · Blaze = gameAccess/{uid} */
const grant = (u) => (MODE === 'rules' ? setSparkPlayer(u) : allowPlayer(u));
/** ถอนสิทธิ์: Spark = Rules ชี้ไปบัญชีอื่น · Blaze = ลบ gameAccess/{uid} */
const revoke = (u) => (MODE === 'rules' ? setSparkPlayer('SomeOtherAccountUid000000001') : deleteDoc(`gameAccess/${u}`));

let browser;
let server;
let uid;
const devices = [];

/** เซฟเก่ารูปแบบเดิมใน localStorage */
const LEGACY = {
  version: 1,
  coins: 4321,
  gems: 33,
  inventory: { flakes: 9, pellets: 1, bloodworm: 0, medicine: 2 },
  selectedFood: 'flakes',
  collection: { goldfish: true, guppy: true },
  tanks: [
    {
      id: 'tank_legacy',
      typeId: 'starter',
      name: 'ตู้เริ่มต้น',
      cleanliness: 88,
      fish: [
        { id: 'fish_l1', speciesId: 'goldfish', name: 'ส้มโอ', gender: 'f', satiety: 70, health: 95, growth: 1, age: 900, breedCooldown: 0, coinTimer: 20 },
        { id: 'fish_l2', speciesId: 'guppy', name: 'หางยาว', gender: 'm', satiety: 65, health: 90, growth: 1, age: 800, breedCooldown: 0, coinTimer: 15 },
        { id: 'fish_l3', speciesId: 'guppy', name: 'จุดจุด', gender: 'f', satiety: 60, health: 92, growth: 0.7, age: 300, breedCooldown: 40, coinTimer: 8 },
      ],
      decor: [{ id: 'decor_l1', itemId: 'castle', x: 2, z: -0.5, rotY: 0 }],
      lastUpdate: Date.now() - 60_000,
    },
  ],
  activeTankId: 'tank_legacy',
  missions: { day: '2026-01-01', progress: {}, claimed: {} },
  dailyRewardDay: null,
  lastCleanAt: 0,
  stats: { feeds: 0, coinsCollected: 0, fishBorn: 0, fishBought: 0 },
  settings: { sound: false, ambient: false, quality: 'low' },
  lastSaved: Date.now() - 60_000,
};

// ── ตัวช่วย ─────────────────────────────────────────────────

async function newDevice(name, { legacy = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(
    ({ legacy }) => {
      if (!localStorage.getItem('aquarium-game-settings')) localStorage.setItem('aquarium-game-settings', JSON.stringify({ sound: false, ambient: false, quality: 'low' }));
      if (legacy && !localStorage.getItem('aquarium-game-save')) localStorage.setItem('aquarium-game-save', JSON.stringify(legacy));
      // หยุดเวลาจำลองในเครื่องทดสอบ (ปลาไม่ผลิตเหรียญ/หิว/ออกลูกเอง) เพื่อให้ตรวจตัวเลขเงินได้แม่นยำ
      let game;
      Object.defineProperty(window, 'game', {
        configurable: true,
        get: () => game,
        set: (v) => {
          game = v;
          if (v?.config) v.config.timeScale = 0;
        },
      });
    },
    { legacy },
  );
  const d = { name, context, errors: [] };
  d.page = await openPage(d);
  devices.push(d);
  return d;
}

async function openPage(d) {
  const page = await d.context.newPage();
  page.on('pageerror', (e) => d.errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|net::ERR|Failed to load resource|PERMISSION_DENIED|status of 500/.test(m.text())) d.errors.push(`console: ${m.text()}`);
  });
  return page;
}

const state = (d, selector, timeout = 60_000) => d.page.waitForSelector(selector, { timeout });

async function login(d, password = PASSWORD) {
  await d.page.goto(URL);
  await state(d, '[data-state="login"]');
  await d.page.fill('#game-password', password);
  await d.page.click('[data-state="login"] button[type="submit"]');
}

/** รอจนเกมโหลดโมเดลเสร็จ แล้วกด "เริ่มเล่น" และรอการบันทึกแรกของเครื่องนี้ */
async function startGame(d) {
  await state(d, '.start-screen:not(.auth-screen) .btn-start:not(.hidden)', 120_000);
  // Keep real pointer hit-testing: forced clicks can miss a moving button or hit an overlay.
  await d.page.addStyleTag({ content: '.btn-start, .feed-btn { animation: none !important; transition: none !important; }' });
  await d.page.click('.start-screen:not(.auth-screen) .btn-start');
  await d.page.waitForFunction(() => window.game?.started === true && !document.querySelector('.start-screen:not(.auth-screen)'), null, { timeout: 10_000 });
  await d.page.waitForFunction(() => window.game.cloud.seq > 0 && window.game.cloud.info.status === 'saved', null, { timeout: 30_000 });
}

const evalGame = (d, fn, arg) => d.page.evaluate(fn, arg);
const coinsOf = (d) => evalGame(d, () => window.game.state.data.coins);
const fishIdsOf = (d) => evalGame(d, () => window.game.state.activeTank.fish.map((f) => f.id).sort());
const hudCoins = (d) => d.page.textContent('[data-ref="coins"]').then((t) => Number(t.replace(/,/g, '')));
const statusOf = (d) => evalGame(d, () => window.game.cloud.info.status);

async function waitFor(fn, { timeout = 20_000, interval = 200, message = 'condition' } = {}) {
  const end = Date.now() + timeout;
  let last;
  for (;;) {
    last = await fn();
    if (last) return last;
    if (Date.now() > end) throw new Error(`timeout waiting for ${message}`);
    await new Promise((r) => setTimeout(r, interval));
  }
}

const cloud = async () => (await readDoc('gameSaves/global')).data;
const waitCloud = (pred, message) => waitFor(async () => {
  const doc = await cloud();
  return doc && pred(doc) ? doc : null;
}, { message: message ?? 'cloud doc' });
const waitSaved = (d) => d.page.waitForFunction(() => window.game?.cloud?.info.status === 'saved', null, { timeout: 30_000 });
const cloudFishIds = (doc) => doc.game.tanks[0].fish.map((f) => f.id).sort();

async function closePanel(d) {
  await d.page.click('.modal .btn-close');
}

async function buyFishUI(d, speciesId) {
  await d.page.click('nav.sidebar button[data-action="shop"]');
  await d.page.click(`.item-card[data-id="${speciesId}"]`);
  await d.page.click('.shop-detail [data-action="buy"]');
  await closePanel(d);
}

async function buyFoodUI(d, foodId = 'flakes') {
  await d.page.click('nav.sidebar button[data-action="food"]');
  await d.page.click(`[data-action="buy-food"][data-id="${foodId}"]`);
  await closePanel(d);
}

// ── เตรียม ─────────────────────────────────────────────────

before(async () => {
  process.env.VITE_CLOUD_SAVE_MODE = MODE; // ทับค่าใน .env.emulator
  log('building web app (mode emulator) →', path.relative(ROOT, OUT_DIR));
  await build({ root: ROOT, mode: 'emulator', logLevel: 'warn', build: { outDir: OUT_DIR, emptyOutDir: true } });
  server = await preview({ root: ROOT, mode: 'emulator', logLevel: 'warn', build: { outDir: OUT_DIR }, preview: { port: PORT, strictPort: true, host: '127.0.0.1', open: false } });
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  await resetEmulators();
  ({ uid } = await createUser(EMAIL, PASSWORD));
  await grant(uid);
  log('ready', URL, 'uid', uid);
});

after(async () => {
  for (const d of devices) {
    if (d.errors.length) log(`${d.name} errors:`, d.errors);
  }
  await browser?.close();
  await new Promise((r) => (server?.httpServer ? server.httpServer.close(r) : r()));
});

// ── สถานการณ์ทดสอบ (เรียงตามลำดับ) ─────────────────────────

let A;
let B;

test('1) รหัสผ่านผิด → เข้าเกมไม่ได้ และแจ้งข้อผิดพลาด', async () => {
  const d = await newDevice('wrong-password');
  await login(d, 'wrong-password');
  await d.page.waitForFunction(() => document.querySelector('.auth-msg.error')?.textContent.includes('รหัสผ่านไม่ถูกต้อง'), null, { timeout: 20_000 });
  assert.equal(await d.page.evaluate(() => !!window.game), false, 'เกมยังไม่เริ่ม');
  assert.equal((await cloud()) ?? null, null, 'ไม่มีการสร้างเซฟใด ๆ');
  await d.context.close();
});

test('2) เครื่องที่มีเซฟเก่า: เข้าสู่ระบบครั้งแรก → ถามก่อนนำเข้า → นำเข้าเป็นเซฟกลาง', async () => {
  const L = await newDevice('legacy', { legacy: LEGACY });
  await login(L);
  await state(L, '[data-state="no-save-legacy"]');
  assert.equal(await cloud(), null, 'ยังไม่สร้างอะไรจนกว่าจะยืนยัน');
  await L.page.click('[data-choice="import"]');
  await startGame(L);
  const doc = await cloud();
  // เงินจากเซฟเก่า + เหรียญช่วงออฟไลน์ที่เซิร์ฟเวอร์คำนวณให้ (เซฟเก่าเล่นล่าสุดเมื่อ ~1 นาทีก่อน)
  assert.ok(doc.game.coins >= 4321 && doc.game.coins < 4321 + 100, `coins ${doc.game.coins}`);
  assert.equal(await coinsOf(L), doc.game.coins);
  assert.deepEqual(doc.game.inventory, LEGACY.inventory);
  assert.deepEqual(cloudFishIds(doc), ['fish_l1', 'fish_l2', 'fish_l3']);
  assert.equal(await L.page.evaluate(() => localStorage.getItem('aquarium-game-save') !== null), true, 'เซฟเก่าในเครื่องไม่ถูกลบ');
  await L.context.close();
});

test('3) เครื่อง A เข้าสู่ระบบ ซื้อปลา → เงินลด และรอจนบันทึกสำเร็จ', async () => {
  A = await newDevice('A');
  await login(A);
  await startGame(A);
  await waitSaved(A);
  const before = await cloud();
  assert.equal(await hudCoins(A), before.game.coins);
  await buyFishUI(A, 'guppy');
  assert.equal(await coinsOf(A), before.game.coins - 80, 'เงินในเครื่องลดทันที');
  const after = await waitCloud((d) => d.game.coins === before.game.coins - 80, 'buy saved');
  await waitSaved(A);
  assert.equal(cloudFishIds(after).length, 4);
  assert.ok(after.revision > before.revision);
  log('A bought neon, revision', after.revision);
});

test('4) เครื่อง B (อีกเบราว์เซอร์) ใช้รหัสเดียวกัน → ปลา เงิน และข้อมูลตรงกับเครื่อง A', async () => {
  B = await newDevice('B');
  await login(B);
  await startGame(B);
  const doc = await cloud();
  assert.equal(await coinsOf(B), doc.game.coins);
  assert.equal(await hudCoins(B), doc.game.coins);
  assert.deepEqual(await fishIdsOf(B), cloudFishIds(doc));
  assert.deepEqual(await fishIdsOf(B), await fishIdsOf(A));
  const inv = await evalGame(B, () => window.game.state.data.inventory);
  assert.deepEqual(inv, doc.game.inventory);
  const label = await B.page.textContent('[data-ref="tankLabel"]');
  assert.match(label, /ปลา 4\/14/);
});

test('5) เครื่อง B เปลี่ยนข้อมูล → เครื่อง A ได้รับข้อมูลล่าสุดแบบเรียลไทม์', async () => {
  const before = await cloud();
  await buyFoodUI(B, 'flakes');
  const after = await waitCloud((d) => d.game.coins === before.game.coins - 50 && d.game.inventory.flakes === before.game.inventory.flakes + 10, 'B buy food');
  await waitFor(async () => (await coinsOf(A)) === after.game.coins, { message: 'A receives coins' });
  await waitFor(async () => (await evalGame(A, () => window.game.state.data.inventory.flakes)) === after.game.inventory.flakes, { message: 'A receives food' });
  assert.equal(await hudCoins(A), after.game.coins);
  const toast = await A.page.waitForFunction(() => [...document.querySelectorAll('.toast')].some((t) => t.textContent.includes('อุปกรณ์อื่น')), null, { timeout: 10_000 }).then(() => true, () => false);
  log('A saw remote toast:', toast);
});

test('6) รีเฟรชหน้า → ยังเข้าสู่ระบบอยู่ (ไม่ต้องกรอกรหัสใหม่) และเซฟยังอยู่ครบ', async () => {
  const before = await cloud();
  await A.page.reload();
  await startGame(A); // ไม่ผ่านหน้ากรอกรหัสผ่าน
  const doc = await cloud();
  assert.ok(doc.game.coins >= before.game.coins, 'เงินไม่หาย (อาจเพิ่มจากเหรียญช่วงออฟไลน์)');
  assert.deepEqual(cloudFishIds(doc), cloudFishIds(before), 'ปลาไม่หาย');
  assert.deepEqual(doc.game.inventory, before.game.inventory);
  assert.equal(await coinsOf(A), doc.game.coins);
  assert.deepEqual(await fishIdsOf(A), cloudFishIds(doc));
  assert.equal(await A.page.evaluate(() => Object.keys(localStorage).some((k) => /password/i.test(k) || localStorage.getItem(k)?.includes('e2e-test-password-only'))), false, 'ไม่มีรหัสผ่านใน localStorage');
  assert.equal(await A.page.evaluate(() => Object.keys(sessionStorage).some((k) => sessionStorage.getItem(k)?.includes('e2e-test-password-only'))), false, 'ไม่มีรหัสผ่านใน sessionStorage');
  const idb = await A.page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open('firebaseLocalStorageDb');
        req.onsuccess = () => {
          const tx = req.result.transaction('firebaseLocalStorage', 'readonly');
          const all = tx.objectStore('firebaseLocalStorage').getAll();
          all.onsuccess = () => resolve(JSON.stringify(all.result));
          all.onerror = () => resolve('');
        };
        req.onerror = () => resolve('');
      }),
  );
  assert.ok(idb.includes('refreshToken') || idb.includes('stsTokenManager'), 'มีเฉพาะ session token ของ Firebase');
  assert.equal(idb.includes('e2e-test-password-only'), false, 'ไม่มีรหัสผ่านใน IndexedDB');
});

test('7) ปิดเบราว์เซอร์แล้วเปิดใหม่ → เล่นต่อจากเซฟเดิม', async () => {
  const before = await cloud();
  // ปิดเบราว์เซอร์ทั้งหมด แล้วเปิดใหม่ด้วยข้อมูลเครื่องเดิม (localStorage + IndexedDB ที่ Firebase ใช้จำการเข้าสู่ระบบ)
  const storage = await A.context.storageState({ indexedDB: true });
  await A.context.close();
  A.context = await browser.newContext({ viewport: { width: 1280, height: 800 }, storageState: storage });
  await A.context.addInitScript(() => {
    let game;
    Object.defineProperty(window, 'game', { configurable: true, get: () => game, set: (v) => ((game = v), v?.config && (v.config.timeScale = 0)) });
  });
  A.page = await openPage(A);
  await A.page.goto(URL);
  await startGame(A); // ยังเข้าสู่ระบบอยู่ ไม่ต้องกรอกรหัสใหม่
  const doc = await cloud();
  assert.ok(doc.game.coins >= before.game.coins);
  assert.deepEqual(cloudFishIds(doc), cloudFishIds(before));
  assert.equal(await coinsOf(A), doc.game.coins);
});

test('8) เน็ตหลุด → สถานะเป็นออฟไลน์/ยังไม่บันทึก → กลับมาออนไลน์แล้วบันทึกครั้งเดียว', async () => {
  const before = await cloud();
  await A.context.setOffline(true);
  await A.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await buyFoodUI(A, 'flakes');
  await A.page.waitForFunction(() => ['offline', 'error'].includes(window.game.cloud.info.status), null, { timeout: 20_000 });
  assert.notEqual(await statusOf(A), 'saved');
  assert.equal((await cloud()).game.coins, before.game.coins, 'ยังไม่ถึงคลาวด์');
  assert.match(await A.page.textContent('.save-status'), /ออฟไลน์|ไม่สำเร็จ/);
  await A.context.setOffline(false);
  await A.page.evaluate(() => window.dispatchEvent(new Event('online')));
  const after = await waitCloud((d) => d.game.coins === before.game.coins - 50, 'offline purchase synced');
  await waitSaved(A);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((await cloud()).game.coins, after.game.coins, 'ไม่ถูกหักซ้ำ');
});

test('9) บันทึกล้มเหลว (เซิร์ฟเวอร์ error) → ไม่แสดงว่าบันทึกแล้ว → แก้แล้วบันทึกครั้งเดียว', async () => {
  const before = await cloud();
  // โหมด functions: Cloud Function ตอบ error · โหมด rules: Firestore ปฏิเสธการ commit transaction
  const pattern = MODE === 'functions' ? '**/saveCommit' : '**/documents:commit*';
  let blocked = 0;
  await A.page.route(pattern, (route) => {
    blocked += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 500, status: 'INTERNAL', message: 'simulated failure' } }) });
  });
  await buyFoodUI(A, 'flakes');
  await A.page.waitForFunction(() => window.game.cloud.info.status === 'error', null, { timeout: 30_000 });
  assert.ok(blocked > 0, 'มีการพยายามบันทึกแล้วล้มเหลว');
  assert.match(await A.page.textContent('.save-status'), /ไม่สำเร็จ/);
  assert.equal((await cloud()).game.coins, before.game.coins);
  await A.page.unroute(pattern);
  await A.page.evaluate(() => window.game.cloud.flushNow());
  const after = await waitCloud((d) => d.game.coins === before.game.coins - 50, 'retry after failure');
  await waitSaved(A);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal((await cloud()).game.coins, after.game.coins, 'ไม่ถูกหักซ้ำหลังส่งซ้ำ');
});

test('10) สองเครื่องซื้อพร้อมกัน → ได้ของครบทั้งคู่ เงินถูกต้อง และทั้งสองเครื่องเห็นตรงกัน', async () => {
  const before = await cloud();
  await Promise.all([buyFishUI(A, 'guppy'), buyFishUI(B, 'betta')]);
  const after = await waitCloud((d) => d.game.tanks[0].fish.length === before.game.tanks[0].fish.length + 2, 'both purchases');
  assert.equal(after.game.coins, before.game.coins - 80 - 200);
  await waitFor(async () => (await coinsOf(A)) === after.game.coins && (await coinsOf(B)) === after.game.coins, { message: 'both devices converge' });
  await waitFor(async () => JSON.stringify(await fishIdsOf(A)) === JSON.stringify(cloudFishIds(after)) && JSON.stringify(await fishIdsOf(B)) === JSON.stringify(cloudFishIds(after)), { message: 'fish converge' });
});

test('11) เปิดเกมพร้อมกันหลายเครื่องเล่นต่อเนื่อง → เซฟไม่สูญหาย (เงิน = ผลรวมการซื้อจริง)', async () => {
  const C = await newDevice('C');
  await login(C);
  await startGame(C);
  const before = await cloud();
  for (let i = 0; i < 3; i++) await Promise.all([buyFoodUI(A, 'flakes'), buyFoodUI(B, 'flakes'), buyFoodUI(C, 'flakes')]);
  const after = await waitCloud((d) => d.game.inventory.flakes === before.game.inventory.flakes + 90, 'nine purchases');
  assert.equal(after.game.coins, before.game.coins - 9 * 50);
  await waitFor(async () => (await coinsOf(A)) === after.game.coins && (await coinsOf(B)) === after.game.coins && (await coinsOf(C)) === after.game.coins, { message: 'three devices converge' });
  await C.context.close();
});

test('12) เครื่องที่มีเซฟเก่า แต่เซฟกลางมีข้อมูลแล้ว → ไม่ทับอัตโนมัติ', async () => {
  const before = await cloud();
  const L2 = await newDevice('legacy-2', { legacy: { ...LEGACY, coins: 999999 } });
  await login(L2);
  await state(L2, '[data-state="legacy-conflict"]');
  const during = await cloud(); // (revision อาจเพิ่มจากเครื่อง A/B ที่บันทึกตามรอบ — ตรวจข้อมูลเกมแทน)
  assert.equal(during.game.coins, before.game.coins, 'แสดงตัวเลือกโดยไม่เขียนอะไรทับ');
  assert.deepEqual(cloudFishIds(during), cloudFishIds(before));
  await L2.page.click('[data-choice="cloud"]');
  await startGame(L2);
  const after = await cloud();
  // ไม่ถูกทับด้วยเซฟเก่า (999,999) — ต่างได้แค่เหรียญช่วงออฟไลน์เล็กน้อยที่เซิร์ฟเวอร์ให้ตอนเข้าเกม
  assert.ok(after.game.coins >= before.game.coins && after.game.coins < before.game.coins + 50, `coins ${after.game.coins}`);
  assert.deepEqual(cloudFishIds(after), cloudFishIds(before));
  assert.equal(await coinsOf(L2), after.game.coins);
  await L2.context.close();
});

test('13) บัญชีที่ถูกถอนสิทธิ์ → หน้าจอ "ยังไม่ได้รับสิทธิ์" และเข้าเกมไม่ได้', async () => {
  await revoke(uid);
  const N = await newDevice('no-access');
  await login(N);
  await state(N, '[data-state="no-access"]');
  assert.match(await N.page.textContent('[data-state="no-access"]'), new RegExp(uid));
  assert.equal(await N.page.evaluate(() => !!window.game), false);
  await grant(uid);
  await N.page.click('[data-choice="retry"]');
  await startGame(N);
  await N.context.close();
  // ระหว่างถอนสิทธิ์ เครื่องที่เปิดเล่นอยู่อาจถูกหยุดบันทึก (หน้าต่าง "สิทธิ์การเข้าถึงหมดอายุ") → โหลดหน้าใหม่เพื่อเล่นต่อ
  for (const d of [A, B]) {
    const blocked = await d.page.evaluate(() => window.game.cloud.blocked);
    log(`${d.name} blocked after revoke:`, blocked);
    if (blocked) {
      await d.page.reload();
      await startGame(d);
    }
  }
});

test('14) ปิดแท็บก่อนส่งข้อมูลเสร็จ → เปิดเกมใหม่แล้วส่งต่อให้อัตโนมัติ', async () => {
  const before = await cloud();
  await A.context.setOffline(true);
  await A.page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await buyFoodUI(A, 'flakes');
  await A.page.waitForFunction(() => ['offline', 'error'].includes(window.game.cloud.info.status), null, { timeout: 20_000 });
  // ปิดแท็บทันที (Playwright ไม่ส่ง pagehide → เหมือนเบราว์เซอร์ค้าง/ถูกปิดกะทันหัน)
  await A.page.close({ runBeforeUnload: false });
  await A.context.setOffline(false);
  A.page = await openPage(A);
  await A.page.goto(URL);
  await startGame(A);
  const after = await waitFor(
    async () => {
      const d = await cloud();
      return d.game.inventory.flakes === before.game.inventory.flakes + 10 ? d : null;
    },
    { timeout: 60_000, message: 'orphan outbox replayed' },
  );
  // หัก 50 จากการซื้อที่ค้าง (+ เหรียญช่วงออฟไลน์เล็กน้อยที่ได้ตอนเปิดหน้าใหม่) — และไม่ถูกหักซ้ำ
  assert.ok(after.game.coins >= before.game.coins - 50 && after.game.coins < before.game.coins, `coins ${after.game.coins}`);
  await waitFor(async () => (await coinsOf(A)) === after.game.coins, { message: 'A shows replayed purchase' });
});

test('15) มีจุดสำรองบนคลาวด์ (สำรองอัตโนมัติรายวัน)', async () => {
  const { docs } = await listDocs('gameSaves/global/backups');
  assert.ok(docs.some((d) => d.reason === 'daily'));
});

test('15b) ให้อาหาร / ขายปลา / รับรางวัลประจำวัน / วางของตกแต่ง ผ่าน UI → เซิร์ฟเวอร์ตรวจผ่านและบันทึกตรงกับในเครื่อง', async () => {
  const before = await cloud();
  // ให้อาหาร (ปุ่มขวาล่าง) → อาหารลด 1 ห่อ และนับภารกิจ
  await A.page.click('.feed-btn');
  // ให้อาหารเป็นคำสั่งทั่วไป ปกติรวมบันทึกภายใน 25 วินาที (BATCH_DELAY) ซึ่งนานกว่า timeout ของ waitCloud → สั่งบันทึกทันที
  await A.page.evaluate(() => window.game.cloud.flushNow());
  await waitCloud((d) => d.game.inventory.flakes === before.game.inventory.flakes - 1 && d.game.stats.feeds === before.game.stats.feeds + 1, 'feed');

  // ขายปลา (ต้องกดยืนยันสองครั้ง) → ได้เงินคืนตามสูตรเดิม
  const coinsBeforeSell = (await cloud()).game.coins;
  await A.page.click('nav.sidebar button[data-action="fish"]');
  const sellBtn = A.page.locator('.fish-row [data-action="sell"]').first();
  const sellId = await sellBtn.getAttribute('data-id');
  await sellBtn.click();
  await A.page.click(`.fish-row [data-action="sell"][data-id="${sellId}"]`);
  await closePanel(A);
  const afterSell = await waitCloud((d) => !d.game.tanks[0].fish.some((f) => f.id === sellId), 'sell fish');
  assert.ok(afterSell.game.coins > coinsBeforeSell, 'ได้เงินคืน');
  assert.equal(await coinsOf(A), afterSell.game.coins);

  // รับรางวัลประจำวัน (ปุ่ม + ข้างเพชร)
  await A.page.click('[data-action="missions"]');
  await A.page.click('[data-action="claim-daily"]');
  await closePanel(A);
  const afterDaily = await waitCloud((d) => d.game.dailyRewardDay !== null && d.game.coins === afterSell.game.coins + 200, 'claim daily');
  assert.equal(await coinsOf(A), afterDaily.game.coins);

  // วางของตกแต่ง: เลือกของแล้ววางลงบนพื้นทรายด้วย API ของโหมดตกแต่ง (เหมือนคลิกพื้นทราย)
  const placed = await A.page.evaluate(() => {
    const game = window.game;
    game.placement.enter();
    game.placement.startPlacing('rock_grey');
    const p = game.placement;
    p.preview.setPosition(0.5, 0.5);
    p.valid = true;
    // จำลองการคลิกวาง: เรียกขั้นตอนเดียวกับ onPointerDown เมื่อชี้ที่พื้นทราย
    const point = { x: 0.5, z: 0.5 };
    const raycaster = { ray: null };
    game.aquarium.raycastSubstrate = () => point;
    p.onPointerDown(raycaster, { button: 0, shiftKey: false });
    p.exit();
    return game.state.activeTank.decor.length;
  });
  const afterDecor = await waitCloud((d) => d.game.tanks[0].decor.length === placed, 'place decor');
  assert.equal(afterDecor.game.coins, afterDaily.game.coins - 30);
  assert.equal(await coinsOf(A), afterDecor.game.coins);
  await waitFor(async () => (await coinsOf(B)) === afterDecor.game.coins, { message: 'B sees decor purchase' });
  assert.equal(await evalGame(B, () => window.game.state.activeTank.decor.length), placed);
});

test('15c) สำรองและกู้คืนผ่าน UI → ได้ข้อมูลเดิม พร้อมสำรองก่อนกู้และแจ้งอีกเครื่อง', async () => {
  await Promise.all([waitSaved(A), waitSaved(B)]);
  const oldBackups = new Set((await listDocs('gameSaves/global/backups')).docs.map((d) => d.id));
  await A.page.click('.save-status');
  await A.page.click('[data-action="backup"]');
  const backup = await waitFor(async () => (await listDocs('gameSaves/global/backups')).docs.find((d) => d.reason === 'manual' && !oldBackups.has(d.id)), { message: 'manual backup' });
  await A.page.waitForSelector(`[data-action="restore"][data-id="${backup.id}"]`);
  // รายละเอียดในหน้าจัดการเซฟต้องตาม revision ใหม่ แม้ยังเปิดหน้าต่างเดิมอยู่
  await A.page.evaluate(() => window.game.cloud.flushNow());
  await waitSaved(A);
  await A.page.waitForFunction(() => document.querySelector('[data-ref="last-saved"]')?.textContent.endsWith(`revision ${window.game.cloud.info.revision}`));
  await closePanel(A);

  await buyFoodUI(A, 'flakes');
  const changed = await waitCloud((d) => d.game.inventory.flakes === backup.game.inventory.flakes + 10, 'purchase after backup');
  await waitSaved(A);
  await A.page.click('.save-status');
  const selector = `[data-action="restore"][data-id="${backup.id}"]`;
  await A.page.click(selector);
  await A.page.click(selector);
  await startGame(A);
  const restored = await cloud();
  assert.equal(restored.epoch, changed.epoch + 1);
  assert.deepEqual(restored.game.inventory, backup.game.inventory);
  assert.deepEqual(cloudFishIds(restored), cloudFishIds(backup));
  const backups = (await listDocs('gameSaves/global/backups')).docs;
  assert.ok(backups.some((d) => d.reason === 'before-restore' && d.game.inventory.flakes === changed.game.inventory.flakes));
  await state(B, '.cloud-block[data-reason="epoch"]');
  await B.page.click('.cloud-block button');
  await startGame(B);
  assert.deepEqual(await evalGame(B, () => window.game.state.data.inventory), backup.game.inventory);
});

test('15d) รีเซ็ตผ่าน UI → สำรองก่อนเริ่มใหม่และอีกเครื่องโหลดเซฟใหม่ได้', async () => {
  await Promise.all([waitSaved(A), waitSaved(B)]);
  const before = await cloud();
  await A.page.click('[data-action="settings"]');
  await A.page.click('[data-action="reset"]');
  await A.page.click('[data-action="reset"]');
  await startGame(A);
  const reset = await cloud();
  assert.equal(reset.epoch, before.epoch + 1);
  // เซฟใหม่ 1250 (+ เหรียญช่วงออฟไลน์เล็กน้อยที่เซิร์ฟเวอร์คำนวณให้ถ้ากด "เริ่มเล่น" หลังรีเซ็ตเกิน 5 วินาที)
  assert.ok(reset.game.coins >= 1250 && reset.game.coins < 1300, `coins ${reset.game.coins}`);
  assert.deepEqual(reset.game.stats, { feeds: 0, coinsCollected: reset.game.stats.coinsCollected, fishBorn: 0, fishBought: 0 });
  assert.equal(reset.game.tanks[0].fish.length, 10);
  const backups = (await listDocs('gameSaves/global/backups')).docs;
  assert.ok(backups.some((d) => d.reason === 'before-reset' && JSON.stringify(cloudFishIds(d)) === JSON.stringify(cloudFishIds(before))));
  await state(B, '.cloud-block[data-reason="epoch"]');
  await B.page.click('.cloud-block button');
  await startGame(B);
  assert.deepEqual(await fishIdsOf(B), cloudFishIds(reset));
});

test('16) ยังไม่มีเซฟกลาง + กดสร้างพร้อมกัน 2 เครื่อง → ได้เซฟเดียว ไม่เขียนทับกัน', async () => {
  for (const d of [A, B]) await d.context.close();
  await clearFirestore();
  await grant(uid);
  const X = await newDevice('X');
  const Y = await newDevice('Y');
  await Promise.all([login(X), login(Y)]);
  await Promise.all([state(X, '[data-state="no-save"]'), state(Y, '[data-state="no-save"]')]);
  await Promise.all([X.page.click('[data-choice="new"]'), Y.page.click('[data-choice="new"]')]);
  await Promise.all([startGame(X), startGame(Y)]);
  const doc = await cloud();
  assert.equal(doc.game.coins, 1250);
  assert.equal(await evalGame(X, () => window.game.state.activeTank.id), await evalGame(Y, () => window.game.state.activeTank.id), 'ทั้งสองเครื่องใช้เซฟชุดเดียวกัน');
  for (const d of [X, Y]) await d.context.close();
});

test('17) ไม่มีข้อผิดพลาดของหน้าเว็บระหว่างทดสอบ', () => {
  const errors = devices.flatMap((d) => d.errors.map((e) => `${d.name}: ${e}`));
  assert.deepEqual(errors, []);
});
