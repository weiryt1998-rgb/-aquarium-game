import * as THREE from 'three';
import { seededRandom } from '../utils/math.js';

/** texture ทั้งหมดวาดด้วย Canvas 2D ตอนรันไทม์ (ไม่ต้องมีไฟล์รูป) */

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext('2d')];
}

function colorTexture(canvas, { repeat = false } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

const cache = new Map();
function cached(key, fn) {
  if (!cache.has(key)) cache.set(key, fn());
  return cache.get(key);
}

/** กรวดพื้นตู้: คืน { map, bumpMap } ที่ต่อกันได้ไร้รอยต่อ */
export function getGravelTextures() {
  return cached('gravel', () => {
    const size = 512;
    const rnd = seededRandom(0.4242);
    const palette = ['#dccbaa', '#b89c76', '#927c60', '#f1e8d6', '#a08f7c', '#ccb28b', '#7f6c56', '#e5d5b8', '#c4a27a', '#6f6255'];
    const pebbles = [];
    for (let i = 0; i < 2600; i++) {
      const r = 3 + rnd() * rnd() * 9;
      pebbles.push({ x: rnd() * size, y: rnd() * size, rx: r * (0.8 + rnd() * 0.5), ry: r * (0.7 + rnd() * 0.4), rot: rnd() * Math.PI, color: palette[Math.floor(rnd() * palette.length)] });
    }
    const [colorCanvas, c] = makeCanvas(size, size);
    const [bumpCanvas, b] = makeCanvas(size, size);
    c.fillStyle = '#8c7a62';
    c.fillRect(0, 0, size, size);
    b.fillStyle = '#000';
    b.fillRect(0, 0, size, size);

    const drawWrapped = (p, fn) => {
      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          const x = p.x + ox;
          const y = p.y + oy;
          if (x + p.rx < 0 || x - p.rx > size || y + p.rx < 0 || y - p.rx > size) continue;
          fn(x, y);
        }
      }
    };

    for (const p of pebbles) {
      drawWrapped(p, (x, y) => {
        c.save();
        c.translate(x, y);
        c.rotate(p.rot);
        const g = c.createRadialGradient(-p.rx * 0.3, -p.ry * 0.35, p.rx * 0.1, 0, 0, p.rx * 1.1);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(0.25, p.color);
        g.addColorStop(1, '#3b3127');
        c.fillStyle = g;
        c.globalAlpha = 0.95;
        c.beginPath();
        c.ellipse(0, 0, p.rx, p.ry, 0, 0, Math.PI * 2);
        c.fill();
        c.restore();

        b.save();
        b.translate(x, y);
        b.rotate(p.rot);
        const bg = b.createRadialGradient(0, 0, 0, 0, 0, p.rx);
        bg.addColorStop(0, '#ffffff');
        bg.addColorStop(0.6, '#9a9a9a');
        bg.addColorStop(1, '#000000');
        b.fillStyle = bg;
        b.beginPath();
        b.ellipse(0, 0, p.rx, p.ry, 0, 0, Math.PI * 2);
        b.fill();
        b.restore();
      });
    }
    const map = colorTexture(colorCanvas, { repeat: true });
    const bumpMap = new THREE.CanvasTexture(bumpCanvas);
    bumpMap.wrapS = bumpMap.wrapT = THREE.RepeatWrapping;
    return { map, bumpMap };
  });
}

/** พื้นหลังด้านในตู้: ไล่สีฟ้าจากบนลงล่าง พร้อมลำแสงจาง ๆ */
export function getTankBackdropTexture() {
  return cached('backdrop', () => {
    const [canvas, ctx] = makeCanvas(512, 512);
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#9be7ff');
    g.addColorStop(0.28, '#45b3ec');
    g.addColorStop(0.62, '#1d74c4');
    g.addColorStop(1, '#0c3c80');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 512, 512);
    const rnd = seededRandom(0.17);
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 9; i++) {
      const x = rnd() * 512;
      const w = 20 + rnd() * 60;
      const lg = ctx.createLinearGradient(0, 0, 0, 420);
      lg.addColorStop(0, 'rgba(200,240,255,0.18)');
      lg.addColorStop(1, 'rgba(200,240,255,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + w, 0);
      ctx.lineTo(x + w * 1.6 + 60, 420);
      ctx.lineTo(x + 60, 420);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    return colorTexture(canvas);
  });
}

/** ลำแสง: สว่างด้านบน จางลงด้านล่าง ขอบนุ่ม */
export function getRayTexture() {
  return cached('ray', () => {
    const w = 64;
    const h = 256;
    const [canvas, ctx] = makeCanvas(w, h);
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const v = y / (h - 1);
      const fall = Math.pow(1 - v, 1.6);
      for (let x = 0; x < w; x++) {
        const u = x / (w - 1);
        const across = Math.pow(Math.sin(Math.PI * u), 2.2);
        const val = Math.round(255 * across * fall);
        const i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(canvas);
  });
}

/** ลายไม้ของโต๊ะวางตู้ */
export function getWoodTexture() {
  return cached('wood', () => {
    const [canvas, ctx] = makeCanvas(1024, 256);
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#9a6a3c');
    g.addColorStop(1, '#7c5230');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 256);
    const rnd = seededRandom(0.77);
    for (let i = 0; i < 90; i++) {
      const y0 = rnd() * 256;
      const amp = 2 + rnd() * 6;
      const freq = 0.004 + rnd() * 0.01;
      const phase = rnd() * 10;
      ctx.strokeStyle = `rgba(${rnd() < 0.5 ? '60,35,18' : '190,140,90'},${0.08 + rnd() * 0.18})`;
      ctx.lineWidth = 0.6 + rnd() * 2.2;
      ctx.beginPath();
      for (let x = 0; x <= 1024; x += 8) {
        const y = y0 + Math.sin(x * freq + phase) * amp + Math.sin(x * freq * 3.1) * amp * 0.3;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    const tex = colorTexture(canvas, { repeat: true });
    return tex;
  });
}

/** ผนังห้องเบลอ ๆ ด้านหลังตู้ (เหมือนถ่ายภาพหน้าชัดหลังเบลอ) */
export function getRoomTexture() {
  return cached('room', () => {
    const [canvas, ctx] = makeCanvas(1024, 512);
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#79a3cf');
    g.addColorStop(0.55, '#4f77a6');
    g.addColorStop(1, '#2c4a72');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 1024, 512);

    const blob = (x, y, r, color, alpha) => {
      const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, color.replace('A', alpha));
      rg.addColorStop(1, color.replace('A', 0));
      ctx.fillStyle = rg;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    };
    // แสงจากหน้าต่าง
    blob(180, 120, 260, 'rgba(225,240,255,A)', 0.55);
    blob(330, 60, 160, 'rgba(255,255,255,A)', 0.35);
    // เฟอร์นิเจอร์ไม้ด้านขวา
    blob(860, 330, 230, 'rgba(150,104,66,A)', 0.55);
    blob(930, 260, 150, 'rgba(176,124,80,A)', 0.4);
    // ต้นไม้ในกระถาง
    blob(800, 170, 120, 'rgba(70,130,72,A)', 0.55);
    blob(870, 120, 90, 'rgba(96,160,90,A)', 0.45);
    blob(760, 230, 80, 'rgba(60,110,64,A)', 0.4);
    // โบเก้
    const rnd = seededRandom(0.31);
    for (let i = 0; i < 26; i++) {
      blob(rnd() * 1024, rnd() * 300, 12 + rnd() * 30, 'rgba(255,245,220,A)', 0.08 + rnd() * 0.16);
    }
    return colorTexture(canvas);
  });
}

/** หน้าเหรียญทอง */
export function getCoinFaceTexture() {
  return cached('coin', () => {
    const [canvas, ctx] = makeCanvas(128, 128);
    const g = ctx.createRadialGradient(48, 44, 6, 64, 64, 64);
    g.addColorStop(0, '#fff6c2');
    g.addColorStop(0.45, '#ffcd3c');
    g.addColorStop(1, '#c98a0c');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(150,95,0,0.7)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(64, 64, 50, 0, Math.PI * 2);
    ctx.stroke();
    // ดาว
    ctx.fillStyle = '#fff1a8';
    ctx.strokeStyle = 'rgba(160,100,0,0.8)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? 30 : 13;
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const x = 64 + Math.cos(a) * r;
      const y = 64 + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    return colorTexture(canvas);
  });
}

/** แถบสะท้อนแสงบนกระจก */
export function getGlassStreakTexture() {
  return cached('glass', () => {
    const [canvas, ctx] = makeCanvas(256, 256);
    ctx.clearRect(0, 0, 256, 256);
    const bands = [
      [40, 26, 0.5],
      [86, 8, 0.35],
      [170, 40, 0.25],
      [218, 6, 0.3],
    ];
    for (const [x, w, a] of bands) {
      const g = ctx.createLinearGradient(x - w, 0, x + w, 0);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, `rgba(255,255,255,${a})`);
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save();
      ctx.translate(128, 128);
      ctx.rotate(-0.5);
      ctx.translate(-128, -128);
      ctx.fillStyle = g;
      ctx.fillRect(x - w, -200, w * 2, 700);
      ctx.restore();
    }
    return colorTexture(canvas);
  });
}
