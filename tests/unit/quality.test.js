import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviceQuality } from '../../src/core/settings.js';
import { QUALITY } from '../../src/config.js';

// AssetLoader import ต้องใช้ virtual module ของ vite → ทดสอบสูตรขนาดผ่านสำเนาที่ export ไว้ไม่ได้ จึงคัดสูตรมาตรวจตรงนี้
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../../src/assets/AssetLoader.js', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('export function shrunkSize'), src.indexOf('/** วาดภาพเท็กซ์เจอร์'));
const shrunkSize = new Function(`${body.replace('export ', '')}; return shrunkSize;`)();

const env = ({ coarse = false, fine = true, ua = 'Mozilla/5.0 (Windows NT 10.0)', platform = 'Win32', touch = 0, w = 1920, h = 1080, mem } = {}) => ({
  navigator: { userAgent: ua, platform, maxTouchPoints: touch, deviceMemory: mem },
  screen: { width: w, height: h },
  matchMedia: (q) => ({ matches: q === '(pointer: coarse)' ? coarse : q === '(any-pointer: fine)' ? fine : false }),
});

test('คุณภาพเริ่มต้นตามอุปกรณ์: คอม = สูง · แท็บเล็ต = กลาง · มือถือ/แรมน้อย = ต่ำ', () => {
  assert.equal(deviceQuality(env()), 'high');
  assert.equal(deviceQuality({}), 'high', 'ไม่มีข้อมูลอุปกรณ์ (เช่น node) = สูง');
  assert.equal(deviceQuality(env({ coarse: true, fine: false, ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)', w: 393, h: 852 })), 'low');
  assert.equal(deviceQuality(env({ coarse: true, fine: false, ua: 'Mozilla/5.0 (Linux; Android 14) Mobile', w: 412, h: 915 })), 'low');
  assert.equal(deviceQuality(env({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', touch: 5, w: 1024, h: 1366 })), 'medium', 'iPad บอกตัวเองว่าเป็น Mac');
  assert.equal(deviceQuality(env({ coarse: true, fine: false, ua: 'Mozilla/5.0 (Linux; Android 14; Tab)', w: 800, h: 1280, mem: 4 })), 'low', 'แท็บเล็ตแรม ≤ 4 GB');
  assert.equal(deviceQuality(env({ coarse: true, fine: false, ua: 'Mozilla/5.0 (Linux; Android 14; Tab)', w: 800, h: 1280, mem: 8 })), 'medium');
});

test('ย่อเท็กซ์เจอร์ตามคุณภาพ: สูง = เท่าเดิม · กลาง = ครึ่ง (≤1024) · ต่ำ = ครึ่ง (≤512) · กำลังสองเสมอ ไม่ขยาย', () => {
  assert.equal(shrunkSize(2048, QUALITY.high), 2048);
  assert.equal(shrunkSize(2048, QUALITY.medium), 1024);
  assert.equal(shrunkSize(512, QUALITY.medium), 256);
  assert.equal(shrunkSize(2048, QUALITY.low), 512);
  assert.equal(shrunkSize(1024, QUALITY.low), 512);
  assert.equal(shrunkSize(64, QUALITY.low), 64, 'ไม่ต่ำกว่า 64');
  assert.equal(shrunkSize(300, QUALITY.medium), 128, 'ภาพที่ไม่ใช่กำลังสอง → กำลังสองที่ไม่เกินครึ่ง');
  for (const q of Object.values(QUALITY)) assert.equal(typeof q.antialias, 'boolean');
});
