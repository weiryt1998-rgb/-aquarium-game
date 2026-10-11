/** value noise แบบเบา ๆ ใช้สร้างพื้นทราย หิน และลวดลายปลา */

function hash2(x, y) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

function hash3(x, y, z) {
  return hash2(x * 31 + z * 1013, y * 17 - z * 7919);
}

const fade = (t) => t * t * (3 - 2 * t);

/** 2D value noise ช่วง 0..1 */
export function noise2(x, y) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const a = hash2(xi, yi);
  const b = hash2(xi + 1, yi);
  const c = hash2(xi, yi + 1);
  const d = hash2(xi + 1, yi + 1);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

/** 3D value noise ช่วง 0..1 */
export function noise3(x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const xf = fade(x - xi);
  const yf = fade(y - yi);
  const zf = fade(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const x00 = l(hash3(xi, yi, zi), hash3(xi + 1, yi, zi), xf);
  const x10 = l(hash3(xi, yi + 1, zi), hash3(xi + 1, yi + 1, zi), xf);
  const x01 = l(hash3(xi, yi, zi + 1), hash3(xi + 1, yi, zi + 1), xf);
  const x11 = l(hash3(xi, yi + 1, zi + 1), hash3(xi + 1, yi + 1, zi + 1), xf);
  return l(l(x00, x10, yf), l(x01, x11, yf), zf);
}

/** fractal noise (หลายชั้น) ช่วงประมาณ 0..1 */
export function fbm2(x, y, octaves = 3) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x, y) * amp;
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

export function fbm3(x, y, z, octaves = 3) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x, y, z) * amp;
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    z *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}
