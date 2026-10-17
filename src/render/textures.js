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
  // ทะเลสาบซากุระ: น้ำใสอมชมพู เนินปะการังชมพู พุ่มดอกซากุระ กลีบดอกปลิว
  sakura: { sky: ['#ffe6f0', '#f8b4cf', '#8fc4e0', '#2c5b86'], haze: '#e9a6c4', layers: ['#d99ab8', '#b8698e', '#6a3f6e'], shafts: 0.28 },
  // ใต้น้ำแสงเหนือ: ม่านแสงเขียว-ม่วงพลิ้วด้านบน ยอดน้ำแข็งเป็นเงา จุดเรืองแสง
  aurora: { sky: ['#123a5c', '#0c2848', '#081a33', '#030a18'], haze: '#0f3050', layers: ['#16405e', '#0d2a44', '#061626'], shafts: 0.12, light: true },
  // ห้วงจักรวาล: เนบิวลา ดาวนับพัน ดาวเคราะห์มีวงแหวน หินต่างดาวมีคริสตัลเรืองแสง
  galaxy: { sky: ['#2a1660', '#1c0d4a', '#100732', '#040212'], haze: '#1a0c40', layers: ['#24124d', '#170a36', '#0a0420'], shafts: 0, light: true },
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
    } else if (kind === 'sakura') {
      hills(H * 0.66, 70, far, 3);
      // พุ่มดอกซากุระบนเนินไกล ๆ
      for (let i = 0; i < 12; i++) bush(rnd() * W, H * (0.62 + rnd() * 0.06), 34 + rnd() * 30, ['#f7b8d2', '#f29cc0', '#ffd3e4'][i % 3]);
      haze(0.3);
      hills(H * 0.8, 50, mid, 3);
      for (let i = 0; i < 9; i++) branch(rnd() * W, H * 0.84, 36 + rnd() * 26, Math.PI / 2 + (rnd() - 0.5) * 0.5, 8, 4, ['#f58fb8', '#ffc0d8', '#e070a0'][i % 3]);
      for (let i = 0; i < 6; i++) fan(rnd() * W, H * 0.88, 60 + rnd() * 50, '#ffd0e4');
      haze(0.12);
      hills(H * 0.93, 28, near, 2);
      // กลีบดอกลอยอยู่ในน้ำ
      for (let i = 0; i < 140; i++) {
        ctx.fillStyle = ['rgba(255,200,222,0.85)', 'rgba(255,170,205,0.75)', 'rgba(255,240,246,0.9)'][i % 3];
        ctx.beginPath();
        ctx.ellipse(rnd() * W, rnd() * H * 0.85, 3 + rnd() * 4, 2 + rnd() * 2, rnd() * Math.PI, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (kind === 'aurora') {
      // ม่านแสงเหนือ: เส้นแนวตั้งไล่สีจางลง ไหลตามคลื่นบนสุดของม่าน
      ctx.globalCompositeOperation = 'lighter';
      const curtains = [
        ['94,255,190', 0.1, 0.42],
        ['90,184,255', 0.22, 0.28],
        ['192,138,255', 0.06, 0.3],
      ];
      for (const [rgb, top, len] of curtains) {
        const phase = rnd() * 10;
        for (let x = 0; x < W; x += 2) {
          const y = H * top + Math.sin(x * 0.008 + phase) * 26 + Math.sin(x * 0.021 + phase * 2) * 12;
          const strength = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(x * 0.013 + phase * 3), 2);
          const lg = ctx.createLinearGradient(0, y, 0, y + H * len);
          lg.addColorStop(0, `rgba(${rgb},${0.8 * strength})`);
          lg.addColorStop(1, `rgba(${rgb},0)`);
          ctx.fillStyle = lg;
          ctx.fillRect(x, y, 2, H * len);
        }
      }
      ctx.globalCompositeOperation = 'source-over';
      hills(H * 0.7, 50, far, 3);
      // ยอดน้ำแข็งแหลม ๆ เป็นเงา
      const spire = (x, base, hgt, wid, color) => {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x - wid, base);
        ctx.lineTo(x - wid * 0.2, base - hgt);
        ctx.lineTo(x + wid * 0.15, base - hgt * 0.82);
        ctx.lineTo(x + wid, base);
        ctx.closePath();
        ctx.fill();
      };
      for (let i = 0; i < 10; i++) spire(rnd() * W, H * 0.8, 80 + rnd() * 120, 20 + rnd() * 30, mid);
      haze(0.18);
      hills(H * 0.88, 40, near, 3);
      for (let i = 0; i < 8; i++) spire(rnd() * W, H * 0.92, 40 + rnd() * 60, 12 + rnd() * 18, '#0a2238');
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 120; i++) {
        const x = rnd() * W;
        const y = H * 0.3 + rnd() * H * 0.65;
        const r = 1 + rnd() * 2.5;
        const rg = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
        rg.addColorStop(0, `rgba(${['120,255,210', '150,200,255', '210,170,255'][i % 3]},${0.4 + rnd() * 0.5})`);
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(x - r * 4, y - r * 4, r * 8, r * 8);
      }
      ctx.globalCompositeOperation = 'source-over';
    } else if (kind === 'galaxy') {
      ctx.globalCompositeOperation = 'lighter';
      // เนบิวลา: กลุ่มเมฆแสงหลายสีซ้อนกัน
      const nebula = (x, y, r, rgb, a) => {
        const rg = ctx.createRadialGradient(x, y, 0, x, y, r);
        rg.addColorStop(0, `rgba(${rgb},${a})`);
        rg.addColorStop(1, `rgba(${rgb},0)`);
        ctx.fillStyle = rg;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      };
      for (let i = 0; i < 26; i++) {
        const t = i / 26;
        const x = W * (0.1 + 0.8 * t) + (rnd() - 0.5) * 120;
        const y = H * (0.25 + 0.2 * Math.sin(t * 5)) + (rnd() - 0.5) * 80;
        nebula(x, y, 60 + rnd() * 110, ['150,70,255', '255,80,200', '60,120,255', '255,150,90'][i % 4], 0.16 + rnd() * 0.14);
      }
      // ดาว: เล็กจำนวนมาก + ดวงใหญ่มีแฉก
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = `rgba(255,255,255,${0.3 + rnd() * 0.7})`;
        const s = rnd() < 0.9 ? 1 : 2;
        ctx.fillRect(rnd() * W, rnd() * H * 0.85, s, s);
      }
      for (let i = 0; i < 22; i++) {
        const x = rnd() * W;
        const y = rnd() * H * 0.75;
        const r = 6 + rnd() * 10;
        nebula(x, y, r, '255,255,255', 0.9);
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.fillRect(x - r * 1.6, y - 0.5, r * 3.2, 1);
        ctx.fillRect(x - 0.5, y - r * 1.6, 1, r * 3.2);
      }
      ctx.globalCompositeOperation = 'source-over';
      // ดาวเคราะห์ 2 ดวง (ดวงใหญ่มีวงแหวน)
      const planet = (x, y, r, c1, c2, ring) => {
        const pg = ctx.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
        pg.addColorStop(0, c1);
        pg.addColorStop(1, c2);
        if (ring) {
          ctx.strokeStyle = 'rgba(255,220,180,0.5)';
          ctx.lineWidth = 5;
          ctx.beginPath();
          ctx.ellipse(x, y, r * 2, r * 0.45, -0.3, Math.PI, Math.PI * 2);
          ctx.stroke();
        }
        ctx.fillStyle = pg;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        if (ring) {
          ctx.beginPath();
          ctx.ellipse(x, y, r * 2, r * 0.45, -0.3, 0, Math.PI);
          ctx.stroke();
        }
      };
      planet(W * 0.78, H * 0.22, 46, '#ffd9a8', '#a2507a', true);
      planet(W * 0.18, H * 0.14, 18, '#b8e6ff', '#3a4fa8', false);
      hills(H * 0.74, 70, far, 3);
      // หินต่างดาวทรงแหลมมีคริสตัลเรืองแสง
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 14; i++) {
        const x = rnd() * W;
        const y = H * (0.76 + rnd() * 0.1);
        nebula(x, y - 14, 26, ['180,110,255', '90,200,255', '255,120,220'][i % 3], 0.5);
      }
      ctx.globalCompositeOperation = 'source-over';
      haze(0.12);
      hills(H * 0.88, 45, mid, 3);
      hills(H * 0.95, 22, near, 2);
    } else {
      hills(H * 0.62, 90, far, 3);
      haze(0.35);
      hills(H * 0.78, 70, mid, 3);
      for (let i = 0; i < 18; i++) blade(rnd() * W, H * 0.82, 60 + rnd() * 90, (rnd() - 0.5) * 60, 4 + rnd() * 3, mid);
      haze(0.15);
      hills(H * 0.9, 40, near, 2);
    }
    // ฝูงปลาไกล ๆ เป็นเงา
    ctx.fillStyle = kind === 'abyss' || P.light ? 'rgba(160,220,255,0.18)' : 'rgba(10,40,80,0.18)';
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

/** พื้นไม้ลายแผ่นกระดาน (ต่อกันได้ไร้รอยต่อ) — 1 แผ่นภาพ = 4 แถวกระดาน */
export function getFloorTexture() {
  return cached('floor', () => {
    const size = 512;
    const rows = 4;
    const rowH = size / rows;
    const [canvas, ctx] = makeCanvas(size, size);
    const rnd = seededRandom(0.58);
    const tones = ['#6f4a2f', '#7b5435', '#86603d', '#664329', '#7f5a3a'];
    for (let r = 0; r < rows; r++) {
      // รอยต่อหัวกระดานแต่ละแถวไม่ตรงกัน
      let x = -rnd() * size * 0.5;
      while (x < size) {
        const len = size * (0.45 + rnd() * 0.5);
        ctx.fillStyle = tones[Math.floor(rnd() * tones.length)];
        for (const dx of [0, size]) ctx.fillRect(x + dx, r * rowH, len, rowH); // วาดซ้ำอีกฝั่งให้ต่อกันได้
        for (let i = 0; i < 9; i++) {
          const y = r * rowH + 6 + rnd() * (rowH - 12);
          ctx.strokeStyle = `rgba(${rnd() < 0.5 ? '40,24,12' : '160,115,75'},${0.12 + rnd() * 0.18})`;
          ctx.lineWidth = 0.8 + rnd() * 1.6;
          for (const dx of [0, size]) {
            ctx.beginPath();
            ctx.moveTo(x + dx, y);
            ctx.bezierCurveTo(x + dx + len * 0.3, y + (rnd() - 0.5) * 6, x + dx + len * 0.7, y + (rnd() - 0.5) * 6, x + dx + len, y);
            ctx.stroke();
          }
        }
        ctx.fillStyle = 'rgba(28,16,8,0.7)';
        for (const dx of [0, size]) ctx.fillRect(x + dx, r * rowH, 2, rowH);
        x += len;
      }
      ctx.fillStyle = 'rgba(28,16,8,0.75)';
      ctx.fillRect(0, r * rowH, size, 2);
    }
    return colorTexture(canvas, { repeat: true });
  });
}

/** ท้องฟ้านอกหน้าต่าง: ฟ้าใส เมฆบาง ๆ และแนวต้นไม้ไกล ๆ (เบลอเหมือนอยู่นอกโฟกัส) */
export function getWindowSkyTexture() {
  return cached('window-sky', () => {
    const [canvas, ctx] = makeCanvas(256, 320);
    const g = ctx.createLinearGradient(0, 0, 0, 320);
    g.addColorStop(0, '#8cc4ef');
    g.addColorStop(0.65, '#cfe7f7');
    g.addColorStop(1, '#eaf4f2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 320);
    const rnd = seededRandom(0.83);
    ctx.filter = 'blur(6px)';
    for (let i = 0; i < 7; i++) {
      ctx.fillStyle = `rgba(255,255,255,${0.35 + rnd() * 0.35})`;
      ctx.beginPath();
      ctx.ellipse(rnd() * 256, 30 + rnd() * 120, 30 + rnd() * 40, 10 + rnd() * 10, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.filter = 'blur(4px)';
    for (let i = 0; i < 16; i++) {
      ctx.fillStyle = ['#5f9a63', '#4d8655', '#76ad6c'][i % 3];
      ctx.beginPath();
      ctx.arc(rnd() * 256, 255 + rnd() * 40, 28 + rnd() * 30, 0, Math.PI * 2);
      ctx.fill();
    }
    return colorTexture(canvas);
  });
}

/** แสงเรืองกลม ๆ ขอบนุ่ม (แสงจากโคมไฟ/หน้าต่างที่ตกบนผนัง) — ใช้กับ AdditiveBlending */
export function getSoftGlowTexture() {
  return cached('soft-glow', () => {
    const [canvas, ctx] = makeCanvas(128, 128);
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
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
