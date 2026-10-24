import '@fontsource/kanit/300.css';
import '@fontsource/kanit/400.css';
import '@fontsource/kanit/500.css';
import '@fontsource/kanit/600.css';
import './styles/main.css';
// 🎃 ธีมฮาโลวีนชั่วคราว (ปิดเองหลัง 3 พ.ย. 2026) — หมดเทศกาลแล้วลบบรรทัดนี้และโฟลเดอร์ src/seasonal/
import './seasonal/halloween.js';

import WebGL from 'three/addons/capabilities/WebGL.js';
import { startCloudSession } from './cloud/boot.js';
import { CloudSync } from './cloud/CloudSync.js';
import { cloneData } from './shared/saveDoc.js';
import { GAME_NAME } from './ui/brand.js';

const canvas = document.getElementById('scene');
const uiRoot = document.getElementById('ui');

function showFatal(message) {
  uiRoot.innerHTML = `<div class="fatal"><h1>🐠 ${GAME_NAME}</h1><p>${message}</p></div>`;
}

async function boot() {
  // โหลดตัวเกม (Three.js) ไปพร้อมกับหน้าเข้าสู่ระบบ
  const gameModule = import('./core/Game.js');
  gameModule.catch(() => {});
  // 1) เข้าสู่ระบบ + โหลดเซฟกลางให้สำเร็จก่อน เกมจึงเริ่ม (ไม่มีการใช้ค่าเริ่มต้นเขียนทับเซฟบนคลาวด์)
  const session = await startCloudSession(uiRoot);
  if (!session) return;
  const { Game } = await gameModule;
  const cloud = new CloudSync({
    transport: session.transport,
    uid: session.user.uid,
    writer: session.writer,
    doc: session.doc,
    fromCache: session.fromCache,
    mode: session.cfg.mode,
  });
  cloud.signOut = session.signOut;

  // 2) เริ่มเกมด้วยข้อมูลจากเซฟกลาง
  const game = new Game({ canvas, uiRoot, save: { data: cloneData(session.doc.game), isNewGame: session.isNewGame }, cloud });
  window.game = game; // สำหรับดีบักใน DevTools
  game.notices = session.notices; // แสดงหลังกดเริ่มเล่น
  await game.init();
}

if (!WebGL.isWebGL2Available()) {
  showFatal('เบราว์เซอร์หรืออุปกรณ์นี้ไม่รองรับ WebGL 2 — ลองใช้ Chrome, Edge, Firefox หรือ Safari เวอร์ชันล่าสุด');
} else {
  boot().catch((err) => {
    console.error(err);
    showFatal('โหลดเกมไม่สำเร็จ ดูรายละเอียดใน Console');
  });
}
