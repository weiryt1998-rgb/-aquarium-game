import * as THREE from 'three';
import { clamp, lerp, seededRandom, smoothstep } from '../../utils/math.js';
import { circumference, FIN_RAYS_PER_TEXTURE, surfacePoint, T_END } from './mollyShape.js';
import { barSpec } from './variants.js';

/**
 * texture ของปลา Molly วาดด้วยโค้ดตอนรันไทม์ (ไม่ต้องมีไฟล์รูป)
 *  - ลำตัว: สี (map), ความนูนของเกล็ด (normalMap), ความมันวาว (roughnessMap)
 *    uv.x = t / T_END ตามความยาว (0 จมูก → 1 ปลายโคนหาง), uv.y = รอบลำตัว (0 สันหลัง → 0.5 ท้อง → 1 สันหลัง)
 *  - ครีบ: สีโปร่งแสง + ก้านครีบ (uv.x ตามก้าน, uv.y ขวางก้าน วนซ้ำ)
 *  - ตา: รูม่านตา + ม่านตาสีเงิน
 * แต่ละสีสร้างครั้งเดียวแล้วใช้ร่วมกันทุกตัว
 */

const SCALE_ROWS = 30; // จำนวนแถวเกล็ดตามความยาว (Molly จริงมี ~26–28 เกล็ดตามเส้นข้างตัว)
const SCALE_AROUND = 36; // จำนวนเกล็ดรอบตัว (ต้องเป็นเลขคู่ให้ลายต่อกันที่สันหลัง)
const LIP_COLUMN = 0.008; // แถบซ้ายสุดของ texture สำหรับสีปาก/ช่องปาก (ดู buildMouth ใน mollyShape.js)

function makeCanvas(w, h) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return [canvas, canvas.getContext('2d', { willReadFrequently: true })];
}

function toTexture(canvas, { color = false, wrapS = THREE.ClampToEdgeWrapping, wrapT = THREE.RepeatWrapping } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (color) tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = wrapS;
  tex.wrapT = wrapT;
  tex.anisotropy = 4;
  tex.userData.shared = true;
  return tex;
}

const rgb = (hex) => new THREE.Color(hex);

/** ความสูงของเกล็ด ณ (t, v): เกล็ดซ้อนกันเป็นแถวเหลื่อม ขอบท้ายเกล็ดเป็นเส้นโค้ง */
function scaleCell(t, v, out) {
  const U = t * SCALE_ROWS;
  const V = v * SCALE_AROUND;
  const r0 = Math.floor(U);
  let best = -Infinity;
  let fvBest = 0.5;
  for (let k = r0 - 1; k <= r0; k++) {
    const shift = (k & 1) * 0.5;
    const fv = (((V + shift) % 1) + 1) % 1;
    const edge = k + 0.62 * Math.sqrt(Math.max(0, 1 - (2 * fv - 1) ** 2));
    if (edge <= U && edge > best) {
      best = edge;
      fvBest = fv;
    }
  }
  const d = Math.min(U - best, 1); // 0 = ใต้ขอบเกล็ดแถวหน้า → 1 = ขอบท้ายของเกล็ดนี้
  const seam = 0.78 + 0.22 * smoothstep(0, 0.16, Math.min(fvBest, 1 - fvBest));
  out.h = smoothstep(0, 0.1, d) * (0.3 + 0.7 * Math.pow(d, 0.85)) * seam;
  out.rim = smoothstep(0.72, 0.97, d) * seam;
  return out;
}

/** ขอบแผ่นปิดเหงือก (เส้นโค้งหลังหัว) — หน้าเส้นนี้คือหัวที่ไม่มีเกล็ด */
const gillEdge = (up) => 0.2 + 0.035 * (1 - up * up);

/** ชั้นลายจุดของสีนี้ (variant.spots เป็น object ชั้นเดียว หรือ array หลายชั้นก็ได้) */
const spotLayers = (variant) => (Array.isArray(variant.spots) ? variant.spots : variant.spots ? [variant.spots] : []);

/** ค่าสุ่ม 0..1 จากพิกัดจำนวนเต็ม 3 ค่า */
function hash3(x, y, z) {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** value noise 3 มิติ 0..1 (แบบเดียวกับ mollyNoise ใน mollyMesh.js) */
function noise3(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const fx = (x - xi) * (x - xi) * (3 - 2 * (x - xi));
  const fy = (y - yi) * (y - yi) * (3 - 2 * (y - yi));
  const fz = (z - zi) * (z - zi) * (3 - 2 * (z - zi));
  const n = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(n(0, 0, 0), n(1, 0, 0), fx), lerp(n(0, 1, 0), n(1, 1, 0), fx), fy),
    lerp(lerp(n(0, 0, 1), n(1, 0, 1), fx), lerp(n(0, 1, 1), n(1, 1, 1), fx), fy),
    fz,
  );
}

/**
 * ลายบั้งแนวตั้ง + ลายหินอ่อน ณ จุด p บนผิวลำตัว (ตรรกะเดียวกับ mollyBars ใน mollyMesh.js)
 * @param {object} b barSpec ของชั้นลาย  @param {number} t 0 ปลายจมูก → 1 โคนหาง  @param {number} up +1 สันหลัง → -1 ท้อง
 * @param {number} seed จำนวนเต็มของชั้นลาย/ตัวปลา  @param {number} fineFade 0..1 ลดลายละเอียดเมื่อ texture ความละเอียดต่ำ
 */
function barsAt(b, p, t, up, seed, fineFade) {
  const s = seed * 0.013;
  const nA = noise3(p.x * 8 + s, p.y * 8 + s, p.z * 8 + s);
  const nB = noise3(p.x * 21 + s * 1.7 + 3.1, p.y * 21 + s * 1.7 + 3.1, p.z * 21 + s * 1.7 + 3.1);
  // ลายละเอียดของหินอ่อน: หมุนแกนก่อน ลายจะได้ไม่เรียงเป็นเหลี่ยม แล้วยืดคอนทราสต์ให้กระจายเต็มช่วง
  const rx = -0.8 * p.y - 0.6 * p.z;
  const ry = 0.8 * p.x + 0.36 * p.y - 0.48 * p.z;
  const rz = 0.6 * p.x - 0.48 * p.y + 0.64 * p.z;
  const nC = lerp(clamp((noise3(rx * 110 + s, ry * 110 + s, rz * 110 + s) - 0.5) * 2.2 + 0.5, 0, 1), 0.5, fineFade);
  const tt = t + (nA - 0.5) * 0.09 + (nB - 0.5) * 0.05 - b.slant * p.y;
  const x = clamp((tt - b.from) / Math.max(b.to - b.from, 0.05), 0, 1);
  const u = x * (0.77 + 0.23 * x) * (b.count - 1);
  const k = Math.floor(u + 0.5);
  const w = b.width * (0.75 + 0.5 * hash3(k, seed, 1)) * (0.9 + 0.3 * x);
  let bar = 1 - smoothstep(w * 0.5 - 0.13, w * 0.5 + 0.13, Math.abs(u - k - (hash3(k, seed, 2) - 0.5) * 0.25));
  bar *= smoothstep(b.from - 0.04, b.from, tt) * (1 - smoothstep(b.to, b.to + 0.04, tt));
  const low = lerp(b.low[0], b.low[1], smoothstep(b.from, b.to, t));
  bar *= smoothstep(low - 0.15, low + 0.2, up + (nB - 0.5) * 0.3);
  const m = nA * 0.62 + nB * 0.38;
  bar *= smoothstep(0.3 * b.marble - 0.05, 0.3 * b.marble + 0.05, m);
  const fleck = lerp(0.5, nC, b.marble);
  const head = 1 - smoothstep(0.22, 0.32, t);
  const dark = b.marble * Math.max(head * lerp(0.2, 0.55, smoothstep(-0.45, 0.4, up)), 0.35 * smoothstep(0.6, 0.92, up));
  const level = lerp(1, 0.5 + (0.5 - dark) * 0.42, smoothstep(0, 0.15, dark));
  const marble = smoothstep(-0.05, 0.05, smoothstep(-0.07, 0.07, m - level) - fleck);
  return Math.max(smoothstep(-0.05, 0.05, bar - fleck), marble);
}

/**
 * จุด/ด่างบนลำตัว วาดเป็นก้อนรูปทรงไม่สม่ำเสมอ ชดเชยการยืดของ texture รอบตัว
 * spec: { count, minSize, maxSize, sizePow = 2.3 (มาก = จุดเล็กเยอะ), back = 0.3 (หลังหนาแน่นกว่าท้อง), clusters = true }
 */
function drawBodySpots(ctx, W, H, spec, rnd) {
  ctx.fillStyle = '#000';
  const blob = (cx, cy, rx, ry) => {
    const n = 12;
    const phase = rnd() * 6.28;
    const wob = 0.18 + rnd() * 0.22;
    for (const oy of [-H, 0, H]) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const k = 1 + wob * Math.sin(a * 2 + phase) * 0.6 + wob * Math.sin(a * 3 + phase * 1.7) * 0.4;
        const x = cx + Math.cos(a) * rx * k;
        const y = cy + oy + Math.sin(a) * ry * k;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
    }
  };
  let placed = 0;
  let guard = 0;
  while (placed < spec.count && guard++ < spec.count * 20) {
    const t = 0.035 + rnd() * (T_END - 0.035);
    const v = rnd();
    const up = Math.cos(v * Math.PI * 2);
    // หลังและช่วงท้ายลำตัวมีจุดหนาแน่นกว่าท้อง
    const back = spec.back ?? 0.3;
    if (rnd() > 0.72 - back + back * up + 0.15 * Math.min(t, 1)) continue;
    const sizeK = t < 0.2 || t > 0.92 ? 0.6 : 1; // หัวและโคนหางจุดเล็กกว่า
    const r = (spec.minSize + (spec.maxSize - spec.minSize) * Math.pow(rnd(), spec.sizePow ?? 2.3)) * sizeK;
    const circ = Math.max(circumference(t), 0.16);
    const rx = (r / T_END) * W;
    const ry = (r / circ) * H;
    blob((t / T_END) * W, v * H, rx, ry);
    // จุดเล็กรอบ ๆ จุดใหญ่ (กลุ่มจุดแบบธรรมชาติ)
    if (spec.clusters !== false && r > spec.maxSize * 0.45 && rnd() < 0.55) {
      for (let i = 0, m = 1 + Math.floor(rnd() * 3); i < m; i++) {
        const a = rnd() * Math.PI * 2;
        const d = r * (1.4 + rnd() * 0.8);
        const rr = r * (0.2 + rnd() * 0.25);
        blob(((t + Math.cos(a) * d) / T_END) * W, (v + (Math.sin(a) * d) / circ) * H, (rr / T_END) * W, (rr / circ) * H);
      }
    }
    placed++;
  }
}

function buildBodyTextures(variant, size) {
  const W = size;
  const H = size / 2;
  const B = variant.body;
  const base = rgb(B.base);
  const back = rgb(B.back);
  const belly = rgb(B.belly);
  const gill = rgb(B.gill);
  const rim = rgb(variant.scales.rim);
  const lip = rgb(variant.lip);
  const mouth = rgb('#2a1214');
  const head = variant.head ? { ...variant.head, color: rgb(variant.head.color) } : null;

  // ชั้นลายวาดทับกันตามลำดับ — ลายจุด: หน้ากากจาก Canvas 2D (วาดรูปทรง แล้วอ่านค่า alpha กลับมา)
  // ลายบั้ง: คำนวณทีละพิกเซลจากจุดบนผิวลำตัว (barsAt)
  const seed = variant.seed ?? 0.1234; // ลูกผสมแต่ละตัวมี seed ของตัวเอง → ลายไม่ซ้ำกัน
  const layers = spotLayers(variant)
    .filter((L) => L.count > 0)
    .map((L, n) => {
      const bars = barSpec(L);
      if (bars) return { color: rgb(L.color), matte: L.matte ?? 0.85, bars, seed: Math.floor(seed * 1e6) + n * 7919 };
      const [, sctx] = makeCanvas(W, H);
      sctx.filter = `blur(${((L.blur ?? 0.5) * W) / 1024}px)`;
      drawBodySpots(sctx, W, H, L, seededRandom(seed + n * 0.071));
      return { color: rgb(L.color), matte: L.matte ?? 0.85, alpha: sctx.getImageData(0, 0, W, H).data };
    });
  // สีพื้นระหว่างบั้ง (ชั้นลายบั้งที่มี glow)
  const grounds = layers.filter((L) => L.bars?.glow).map(({ bars: b }) => ({ ...b, front: rgb(b.glow.front), rear: rgb(b.glow.color) }));
  const anyBars = layers.some((L) => L.bars);
  const fineFade = smoothstep(0.3, 0.8, (T_END / W) * 110); // texture ความละเอียดต่ำ → ลดลายละเอียดของหินอ่อน
  const p = new THREE.Vector3();
  const groundColor = new THREE.Color();

  const height = new Float32Array(W * H);
  const [colorCanvas, cctx] = makeCanvas(W, H);
  const [roughCanvas, rctx] = makeCanvas(W, H);
  const colorImg = cctx.createImageData(W, H);
  const roughImg = rctx.createImageData(W, H);
  const cd = colorImg.data;
  const rd = roughImg.data;
  const c = new THREE.Color();
  const cell = { h: 0, rim: 0 };
  const contrast = variant.scales.contrast;
  const rough = variant.material.roughness;

  for (let y = 0; y < H; y++) {
    const v = (y + 0.5) / H;
    const up = Math.cos(v * Math.PI * 2); // +1 สันหลัง, -1 ท้อง
    const side = 1 - up * up;
    const edge = gillEdge(up);
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W;
      const t = u * T_END;
      const i = y * W + x;
      scaleCell(t, v, cell);
      const scaled = smoothstep(edge, edge + 0.045, t); // หัวไม่มีเกล็ด
      const ridge = Math.exp(-(((t - edge) / 0.006) ** 2)) * smoothstep(0.1, 0.5, side);
      height[i] = scaled * cell.h + (1 - scaled) * 0.55 + ridge * 0.7;

      // สีพื้น: ท้องอ่อน หลังเข้ม
      c.copy(belly).lerp(base, smoothstep(-0.75, 0.05, up));
      c.lerp(back, smoothstep(0.35, 0.98, up) * 0.85);
      // แก้มและแผ่นปิดเหงือกอมชมพูเล็กน้อย
      if (t < edge) c.lerp(gill, 0.35 * smoothstep(0.08, edge, t) * smoothstep(0.75, 0.0, Math.abs(up + 0.1)));
      // สีหัว (เช่น Red Head): จากปลายจมูกถึงหลังแผ่นปิดเหงือก ขอบไม่เรียบ ลามไปตามสันหลังมากกว่า ใต้คางอ่อนลง
      if (head) {
        const wob = 0.025 * Math.sin(v * Math.PI * 6 + 1.3) + 0.015 * Math.sin(v * Math.PI * 14);
        const reach = head.end + (head.back ?? 0.1) * Math.max(up, 0) + wob;
        const k = (1 - smoothstep(head.start, reach, t)) * (0.35 + 0.65 * smoothstep(-0.85, 0.15, up));
        c.lerp(head.color, k * (head.strength ?? 0.95));
      }
      // สีพื้นระหว่างบั้ง: เหนือขอบล่างของบั้ง (ท้องยังเป็นสีตัว) ช่วงหน้าสี front → ช่วงท้ายสี color
      for (const G of grounds) {
        const low = lerp(G.low[0], G.low[1], smoothstep(G.from, G.to, t));
        const g = G.glow.amount * smoothstep(low - 0.1, low + 0.35, up) * smoothstep(G.from - 0.08, G.from + 0.05, t);
        c.lerp(groundColor.copy(G.front).lerp(G.rear, smoothstep(G.glow.from - 0.12, G.glow.from + 0.12, t)), g);
      }
      if (anyBars) surfacePoint(t, v * Math.PI * 2, p);
      // ลายเกล็ด: เงาตามความนูน + ขอบเกล็ดวาวมุก
      c.multiplyScalar(1 + contrast * (cell.h - 0.6) * scaled - ridge * 0.12);
      c.lerp(rim, cell.rim * 0.22 * scaled);
      let spot = 0;
      for (const L of layers) {
        let a = L.bars ? barsAt(L.bars, p, t, up, L.seed, fineFade) : L.alpha[i * 4 + 3] / 255;
        if (t < 0.03) a *= smoothstep(0.012, 0.03, t);
        if (a <= 0) continue;
        // ในจุดยังเห็นลายเกล็ดจาง ๆ
        c.lerp(L.color, a * 0.97).multiplyScalar(1 + 0.6 * contrast * (cell.h - 0.6) * scaled * a);
        spot = Math.max(spot, a * L.matte);
      }
      if (u < LIP_COLUMN) c.copy(v < 0.5 ? lip : mouth);

      cd[i * 4] = clamp(c.r, 0, 1) * 255;
      cd[i * 4 + 1] = clamp(c.g, 0, 1) * 255;
      cd[i * 4 + 2] = clamp(c.b, 0, 1) * 255;
      cd[i * 4 + 3] = 255;

      // roughness อยู่ในช่อง G: ขอบเกล็ดเรียบมันกว่า ร่องเกล็ดด้านกว่า
      const r = clamp(rough - 0.1 * cell.rim * scaled + 0.08 * (1 - cell.h) * scaled + 0.05 * spot, 0.08, 1);
      rd[i * 4] = (1 - spot) * 255; // ช่อง R = ความแรงประกายมุก (iridescenceMap) ในจุดประกายน้อยลง
      rd[i * 4 + 1] = r * 255;
      rd[i * 4 + 2] = 0;
      rd[i * 4 + 3] = 255;
    }
  }
  cctx.putImageData(colorImg, 0, 0);
  rctx.putImageData(roughImg, 0, 0);

  // normal map จากความสูง (วนรอบตามแกน v, หยุดที่ปลายตามแกน u)
  const [normalCanvas, nctx] = makeCanvas(W, H);
  const normalImg = nctx.createImageData(W, H);
  const nd = normalImg.data;
  const k = variant.scales.relief * 2.4 * (W / 1024);
  for (let y = 0; y < H; y++) {
    const yu = ((y - 1 + H) % H) * W;
    const yd = ((y + 1) % H) * W;
    for (let x = 0; x < W; x++) {
      const xl = Math.max(x - 1, 0);
      const xr = Math.min(x + 1, W - 1);
      const dx = (height[y * W + xr] - height[y * W + xl]) * k;
      const dy = (height[yd + x] - height[yu + x]) * k;
      const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1);
      const i = (y * W + x) * 4;
      nd[i] = (-dx * inv * 0.5 + 0.5) * 255;
      nd[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
      nd[i + 2] = (inv * 0.5 + 0.5) * 255;
      nd[i + 3] = 255;
    }
  }
  nctx.putImageData(normalImg, 0, 0);

  return {
    map: toTexture(colorCanvas, { color: true }),
    normalMap: toTexture(normalCanvas),
    roughnessMap: toTexture(roughCanvas),
  };
}

/**
 * ริ้วตามก้านครีบ n เส้นต่อความกว้าง texture ครีบ (x = ตามก้าน 0 โคน → 1 ปลาย, y = ขวางก้าน วนซ้ำ)
 * แต่ละเส้นกว้าง/เริ่ม/จบไม่เท่ากัน บางช่องไม่มีริ้ว — คืน alpha ในรูปแบบเดียวกับ ImageData.data
 */
function drawFinStreaks(S, n, rnd) {
  const bands = Array.from({ length: n }, () => ({ on: rnd() < 0.85, w: 0.4 + 0.4 * rnd(), a0: 0.1 + 0.35 * rnd(), len: 0.35 + 0.6 * rnd() }));
  const out = new Uint8ClampedArray(S * S * 4);
  for (let y = 0; y < S; y++) {
    const yy = (y + 0.5) / S;
    for (let x = 0; x < S; x++) {
      const a = (x + 0.5) / S;
      const u = yy * n + 0.1 * Math.sin(a * 6.5 + yy * Math.PI * 4); // ริ้วคดเล็กน้อย (วนซ้ำต่อกันได้ตามแกน y)
      const k = Math.floor(u);
      const B = bands[((k % n) + n) % n];
      if (!B.on) continue;
      const s = (1 - smoothstep(B.w * 0.5 - 0.06, B.w * 0.5 + 0.03, Math.abs(u - k - 0.5))) * smoothstep(B.a0, B.a0 + 0.1, a) * (1 - smoothstep(B.a0 + B.len, B.a0 + B.len + 0.15, a));
      out[(y * S + x) * 4 + 3] = s * 255;
    }
  }
  return out;
}

/** ครีบโปร่งแสง: ก้านครีบแตกแขนงที่ปลาย มีข้อปล้อง ขอบปลายครีบหยักระหว่างก้าน */
function buildFinTexture(variant, size) {
  const S = size;
  const F = variant.fins;
  const fbase = rgb(F.base);
  const ftip = rgb(F.tip);
  const fray = rgb(F.ray);
  // จุดบนครีบของแต่ละชั้นลาย (finCount, finSize = ขนาดใหญ่สุดเทียบกับ texture) — ชั้นลายบั้งเป็นริ้วตามก้านครีบแทน
  const layers = spotLayers(variant)
    .filter((L) => L.finCount > 0)
    .map((L, n) => {
      const rnd = seededRandom((variant.seed != null ? variant.seed + 0.5 : 0.777) + n * 0.113);
      const bars = barSpec(L);
      if (bars) return { color: rgb(L.color), alpha: drawFinStreaks(S, bars.streaks, rnd) };
      const [, sctx] = makeCanvas(S, S);
      sctx.filter = 'blur(0.7px)';
      sctx.fillStyle = '#000';
      const maxR = L.finSize ?? 0.05;
      for (let k = 0; k < L.finCount; k++) {
        const x = (0.08 + rnd() * 0.84) * S;
        const y = rnd() * S;
        const rx = (maxR * 0.3 + rnd() * rnd() * maxR) * S;
        const ry = rx * (0.5 + rnd() * 0.6);
        for (const oy of [-S, 0, S]) {
          sctx.beginPath();
          sctx.ellipse(x, y + oy, rx, ry, rnd() * 0.6 - 0.3, 0, Math.PI * 2);
          sctx.fill();
        }
      }
      return { color: rgb(L.color), alpha: sctx.getImageData(0, 0, S, S).data };
    });

  const [canvas, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const c = new THREE.Color();
  for (let y = 0; y < S; y++) {
    const b = ((y + 0.5) / S) * FIN_RAYS_PER_TEXTURE;
    const phase = b - Math.floor(b);
    for (let x = 0; x < S; x++) {
      const a = (x + 0.5) / S;
      // ก้านครีบแตกเป็น 2 แขนงช่วงปลาย
      const fork = 0.13 * smoothstep(0.45, 1, a);
      const dr = Math.min(Math.abs(phase - 0.5 + fork), Math.abs(phase - 0.5 - fork)) * 2;
      const between = Math.abs(phase - 0.5) * 2; // 0 = กลางก้าน, 1 = กึ่งกลางระหว่างก้าน
      const joint = 0.82 + 0.18 * smoothstep(0.08, 0.2, (a * 16) % 1);
      const ray = (1 - smoothstep(0.06, 0.2 + 0.06 * (1 - a), dr)) * joint * (0.55 + 0.45 * smoothstep(0, 0.1, a));
      c.copy(fbase).lerp(ftip, Math.pow(a, 1.3));
      c.lerp(fray, ray * 0.45);
      let alpha = F.opacity * (0.82 + 0.18 * (1 - a));
      alpha += (Math.min(1, F.opacity + 0.15) - alpha) * ray;
      // ขอบปลายครีบ: เยื่อครีบหดเข้าระหว่างก้านเล็กน้อย
      const limit = 1 - 0.035 * Math.pow(between, 1.5);
      alpha *= 1 - smoothstep(limit - 0.06, limit, a) * (1 - ray * 0.7);
      alpha *= smoothstep(1, 0.985, a);
      for (const L of layers) {
        const s = L.alpha[(y * S + x) * 4 + 3] / 255;
        if (s > 0) {
          c.lerp(L.color, s * 0.95);
          alpha = Math.max(alpha, s * 0.92 * (alpha > 0.05 ? 1 : 0));
        }
      }
      const i = (y * S + x) * 4;
      d[i] = clamp(c.r, 0, 1) * 255;
      d[i + 1] = clamp(c.g, 0, 1) * 255;
      d[i + 2] = clamp(c.b, 0, 1) * 255;
      d[i + 3] = clamp(alpha, 0, 1) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, { color: true });
}

/** ตา: รูม่านตาดำใหญ่ วงม่านตาสีเงินมีลายรัศมี ขอบนอกเข้ม */
function buildEyeTexture(variant) {
  const S = 128;
  const [canvas, ctx] = makeCanvas(S, S);
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const iris = rgb(variant.iris);
  const pupil = rgb('#040507');
  const outer = rgb('#26282c');
  const body = rgb(variant.body.base).multiplyScalar(0.7);
  const c = new THREE.Color();
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x + 0.5) / S - 0.5;
      const dy = (y + 0.5) / S - 0.5;
      const r = Math.hypot(dx, dy) * 2;
      const ang = Math.atan2(dy, dx);
      const streak = 0.85 + 0.15 * Math.sin(ang * 23) * Math.sin(ang * 7 + 1.3);
      c.copy(pupil).lerp(rgb('#14202c'), smoothstep(0.1, 0.46, r) * 0.5);
      const irisK = smoothstep(0.44, 0.48, r) * (1 - smoothstep(0.62, 0.68, r));
      const ring = iris.clone().multiplyScalar(streak * (0.8 + 0.35 * smoothstep(0.5, 0.47, r)));
      c.lerp(ring, irisK);
      if (r > 0.66) c.copy(outer).lerp(body, smoothstep(0.8, 0.98, r));
      const i = (y * S + x) * 4;
      d[i] = clamp(c.r, 0, 1) * 255;
      d[i + 1] = clamp(c.g, 0, 1) * 255;
      d[i + 2] = clamp(c.b, 0, 1) * 255;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return toTexture(canvas, { color: true, wrapT: THREE.ClampToEdgeWrapping });
}

const cache = new Map();
const refs = new Map();

/**
 * @param {object} variant จาก variants.js (หรือ genesToVariant ของลูกผสม)
 * @param {number} size ความกว้าง texture ลำตัว (สูงครึ่งหนึ่ง)
 */
export function getMollyTextures(variant, size = 1024) {
  const key = `${variant.id}:${size}`;
  if (!cache.has(key)) {
    cache.set(key, {
      body: buildBodyTextures(variant, size),
      fin: buildFinTexture(variant, size >= 1024 ? 256 : 128),
      eye: buildEyeTexture(variant),
    });
  }
  return cache.get(key);
}

/**
 * ยืม texture พร้อมนับจำนวนผู้ใช้ — ลูกผสมแต่ละตัวมีลายของตัวเอง จึงต้องคืนหน่วยความจำ GPU เมื่อไม่มีใครใช้แล้ว
 * (สีพันธุ์แท้มีไม่กี่ชุด เก็บไว้ตลอด)
 * @returns {{ textures: object, release: () => void }}
 */
export function acquireMollyTextures(variant, size) {
  const key = `${variant.id}:${size}`;
  const textures = getMollyTextures(variant, size);
  refs.set(key, (refs.get(key) ?? 0) + 1);
  let released = false;
  return {
    textures,
    release() {
      if (released) return;
      released = true;
      const n = (refs.get(key) ?? 1) - 1;
      refs.set(key, n);
      if (n > 0 || !variant.hybrid) return;
      refs.delete(key);
      cache.delete(key);
      const t = textures;
      for (const tex of [t.body.map, t.body.normalMap, t.body.roughnessMap, t.fin, t.eye]) tex.dispose();
    },
  };
}
