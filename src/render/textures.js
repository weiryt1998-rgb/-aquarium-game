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

/**
 * ภาพพื้นหลังด้านในตู้ ตามสไตล์ของตู้ (data/tanks.js → style.backdrop)
 *  ocean   = โขดหินในทะเลสีฟ้า (ตู้เริ่มต้น)
 *  planted = สวนพืชน้ำสีเขียว (ตู้มาตรฐาน)
 *  reef    = แนวปะการังหลากสี (ตู้ใหญ่)
 *  abyss   = ทะเลลึก แสงลอดลงมา มีแสงเรืองรอง (ตู้พาโนรามา)
 * วาดเป็นชั้น ๆ ไกล → ใกล้ ชั้นไกลจางกลืนกับสีน้ำ (หมอกใต้น้ำ) ให้รู้สึกมีความลึก
 */
const BACKDROPS = {
  ocean: { sky: ['#a9ecff', '#4cb8ef', '#1c72c2', '#0b3779'], haze: '#3f9fdc', layers: ['#2f7fbf', '#1f5f9c', '#123f73'], shafts: 0.2 },
  planted: { sky: ['#c9f2d8', '#5fc0a0', '#22806e', '#0d3d3a'], haze: '#4aa88e', layers: ['#3f8f6a', '#2a6b4c', '#174a33'], shafts: 0.22 },
  reef: { sky: ['#b8f4ff', '#45c4f0', '#1683cc', '#0a3f86'], haze: '#4cb2e6', layers: ['#7a6cc8', '#c25b8e', '#3d3f8f'], shafts: 0.26 },
  abyss: { sky: ['#5fb8e6', '#1b5e9e', '#0b2a5c', '#040c24'], haze: '#174a80', layers: ['#123a6a', '#0b2448', '#05122a'], shafts: 0.32 },
};

export function getTankBackdropTexture(kind = 'ocean') {
  const P = BACKDROPS[kind] ?? BACKDROPS.ocean;
  return cached(`backdrop:${kind}`, () => {
    const W = 1024;
    const H = 512;
    const [canvas, ctx] = makeCanvas(W, H);
    const rnd = seededRandom(kind.length * 0.1373 + 0.17);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, P.sky[0]);
    g.addColorStop(0.3, P.sky[1]);
    g.addColorStop(0.65, P.sky[2]);
    g.addColorStop(1, P.sky[3]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // ลำแสงจากผิวน้ำ
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 11; i++) {
      const x = rnd() * W;
      const w = 18 + rnd() * 70;
      const lg = ctx.createLinearGradient(0, 0, 0, H * 0.85);
      lg.addColorStop(0, `rgba(210,245,255,${P.shafts * (0.5 + rnd() * 0.6)})`);
      lg.addColorStop(1, 'rgba(210,245,255,0)');
      ctx.fillStyle = lg;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + w, 0);
      ctx.lineTo(x + w * 1.7 + 90, H * 0.85);
      ctx.lineTo(x + 90, H * 0.85);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';

    const haze = (alpha) => {
      ctx.fillStyle = P.haze;
      ctx.globalAlpha = alpha;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    };
    // เนินหิน/ทรายเป็นแนวยาว
    const hills = (base, amp, color, bumps) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, H);
      const phase = rnd() * 10;
      for (let x = 0; x <= W; x += 8) {
        let y = base;
        for (let k = 1; k <= bumps; k++) y -= Math.max(0, Math.sin(x * 0.006 * k + phase * k)) * amp / k;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    };
    // ใบพืชน้ำโค้งพลิ้ว
    const blade = (x, y, len, lean, width, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(x + lean * 0.2, y - len * 0.4, x + lean * 0.8, y - len * 0.7, x + lean, y - len);
      ctx.stroke();
    };
    const bush = (x, y, r, color) => {
      ctx.fillStyle = color;
      for (let k = 0; k < 7; k++) {
        ctx.beginPath();
        ctx.arc(x + (rnd() - 0.5) * r * 1.6, y - rnd() * r * 0.9, r * (0.35 + rnd() * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }
    };
    // ปะการังกิ่ง (แตกกิ่งแบบสุ่ม)
    const branch = (x, y, len, angle, width, depth, color) => {
      const x2 = x + Math.cos(angle) * len;
      const y2 = y - Math.sin(angle) * len;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      if (depth <= 0) return;
      const n = 2 + (rnd() < 0.3 ? 1 : 0);
      for (let k = 0; k < n; k++) branch(x2, y2, len * (0.62 + rnd() * 0.2), angle + (rnd() - 0.5) * 1.1, width * 0.72, depth - 1, color);
    };
    // กัลปังหา (พัดทะเล)
    const fan = (x, y, r, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      for (let a = 0.15; a < Math.PI - 0.1; a += 0.09) {
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + Math.cos(a) * r * 0.5, y - Math.sin(a) * r * 0.6, x + Math.cos(a) * r, y - Math.sin(a) * r);
        ctx.stroke();
      }
      ctx.globalAlpha = 0.45;
      for (let k = 0.35; k <= 1; k += 0.16) {
        ctx.beginPath();
        ctx.arc(x, y, r * k, Math.PI + 0.1, -0.1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    const dome = (x, y, r, color) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.7, 0, Math.PI, 0);
      ctx.fill();
    };

    const [far, mid, near] = P.layers;
    if (kind === 'planted') {
      hills(H * 0.66, 70, far, 3);
      for (let i = 0; i < 70; i++) blade(rnd() * W, H * 0.75, 120 + rnd() * 200, (rnd() - 0.5) * 120, 4 + rnd() * 5, far);
      haze(0.35);
      hills(H * 0.8, 50, mid, 3);
      for (let i = 0; i < 14; i++) bush(rnd() * W, H * 0.82, 40 + rnd() * 40, mid);
      for (let i = 0; i < 60; i++) blade(rnd() * W, H * 0.9, 90 + rnd() * 170, (rnd() - 0.5) * 100, 5 + rnd() * 6, mid);
      haze(0.18);
      hills(H * 0.93, 30, near, 2);
    } else if (kind === 'reef') {
      hills(H * 0.7, 60, far, 3);
      for (let i = 0; i < 9; i++) branch(rnd() * W, H * 0.74, 40 + rnd() * 30, Math.PI / 2 + (rnd() - 0.5) * 0.5, 9, 4, far);
      haze(0.4);
      hills(H * 0.84, 40, near, 2);
      for (let i = 0; i < 6; i++) fan(rnd() * W, H * 0.86, 70 + rnd() * 60, mid);
      for (let i = 0; i < 7; i++) dome(rnd() * W, H * 0.9, 40 + rnd() * 40, ['#a45a9a', '#c77a5a', '#6a5ab0'][i % 3]);
      for (let i = 0; i < 8; i++) branch(rnd() * W, H * 0.92, 32 + rnd() * 26, Math.PI / 2 + (rnd() - 0.5) * 0.6, 8, 4, ['#d0688c', '#e08a4a', '#8d6ad8'][i % 3]);
      haze(0.16);
    } else if (kind === 'abyss') {
      hills(H * 0.62, 120, far, 2);
      // ซุ้มหินโค้งขนาดใหญ่
      ctx.fillStyle = mid;
      ctx.beginPath();
      ctx.moveTo(W * 0.52, H);
      ctx.bezierCurveTo(W * 0.5, H * 0.35, W * 0.86, H * 0.28, W * 0.9, H);
      ctx.lineTo(W * 0.82, H);
      ctx.bezierCurveTo(W * 0.8, H * 0.55, W * 0.6, H * 0.52, W * 0.6, H);
      ctx.closePath();
      ctx.fill();
      haze(0.25);
      hills(H * 0.85, 80, near, 3);
      // จุดแสงเรืองรอง (แพลงก์ตอน)
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 160; i++) {
        const x = rnd() * W;
        const y = H * 0.25 + rnd() * H * 0.7;
        const r = 1 + rnd() * 3;
        const rg = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
        rg.addColorStop(0, `rgba(140,255,240,${0.4 + rnd() * 0.5})`);
        rg.addColorStop(1, 'rgba(140,255,240,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
      }
      ctx.globalCompositeOperation = 'source-over';
    } else {
      hills(H * 0.62, 90, far, 3);
      haze(0.35);
      hills(H * 0.78, 70, mid, 3);
      for (let i = 0; i < 18; i++) blade(rnd() * W, H * 0.82, 60 + rnd() * 90, (rnd() - 0.5) * 60, 4 + rnd() * 3, mid);
      haze(0.15);
      hills(H * 0.9, 40, near, 2);
    }
    // ฝูงปลาไกล ๆ เป็นเงา
    ctx.fillStyle = kind === 'abyss' ? 'rgba(160,220,255,0.18)' : 'rgba(10,40,80,0.18)';
    for (let s = 0; s < 2; s++) {
      const cx = W * (0.2 + rnd() * 0.6);
      const cy = H * (0.2 + rnd() * 0.25);
      for (let i = 0; i < 14; i++) {
        const x = cx + (rnd() - 0.5) * 160;
        const y = cy + (rnd() - 0.5) * 50;
        ctx.beginPath();
        ctx.ellipse(x, y, 7, 2.6, 0, 0, Math.PI * 2);
        ctx.moveTo(x - 6, y);
        ctx.lineTo(x - 11, y - 3);
        ctx.lineTo(x - 11, y + 3);
        ctx.fill();
      }
    }
    // ขอบล่างเข้ม + ขอบข้างจางลง (vignette) ให้กลืนกับพื้นทราย
    const v = ctx.createLinearGradient(0, H * 0.7, 0, H);
    v.addColorStop(0, 'rgba(0,10,30,0)');
    v.addColorStop(1, 'rgba(0,10,30,0.35)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, W, H);
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

/** แสงเรืองจากไฟ LED ใต้ฝาตู้: สว่างด้านบน จางเป็นใสด้านล่าง */
export function getLedGlowTexture() {
  return cached('led-glow', () => {
    const [canvas, ctx] = makeCanvas(8, 128);
    const g = ctx.createLinearGradient(0, 0, 0, 128);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 8, 128);
    return colorTexture(canvas);
  });
}
