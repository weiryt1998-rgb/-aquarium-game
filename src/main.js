import '@fontsource/kanit/300.css';
import '@fontsource/kanit/400.css';
import '@fontsource/kanit/500.css';
import '@fontsource/kanit/600.css';
import './styles/main.css';

import WebGL from 'three/addons/capabilities/WebGL.js';
import { Game } from './core/Game.js';

const canvas = document.getElementById('scene');
const uiRoot = document.getElementById('ui');

function showFatal(message) {
  uiRoot.innerHTML = `<div class="fatal"><h1>🐠 เกมเลี้ยงปลาในตู้ปลา</h1><p>${message}</p></div>`;
}

if (!WebGL.isWebGL2Available()) {
  showFatal('เบราว์เซอร์หรืออุปกรณ์นี้ไม่รองรับ WebGL 2 — ลองใช้ Chrome, Edge, Firefox หรือ Safari เวอร์ชันล่าสุด');
} else {
  try {
    const game = new Game({ canvas, uiRoot });
    window.game = game; // สำหรับดีบักใน DevTools
    game.init().catch((err) => {
      console.error(err);
      showFatal('โหลดเกมไม่สำเร็จ ดูรายละเอียดใน Console');
    });
  } catch (err) {
    console.error(err);
    showFatal('เริ่มเกมไม่สำเร็จ ดูรายละเอียดใน Console');
  }
}
