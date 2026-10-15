import * as THREE from 'three';

/**
 * ถ่ายภาพฉาก 3 มิติเป็นรูป (data URL) ด้วย renderer หลักของเกม — ไม่สร้าง WebGL context ใหม่
 *
 * เดิมรูปตัวอย่างปลา/ของตกแต่ง และภาพตัวอย่างตู้ สร้าง WebGLRenderer แยก (ตู้ละตัว!) ซึ่งต้องอัปโหลด texture ทุกชิ้นซ้ำ
 * เข้า context ใหม่ทุกครั้ง บนมือถือหน่วยความจำ GPU ไม่พอ / เปิด context ถี่เกินไป → เบราว์เซอร์ปิดหรือรีโหลดหน้าเกม
 * แบบนี้ใช้ texture/shader ที่อยู่บน GPU ของเกมอยู่แล้ว เพิ่มแค่ render target ชั่วคราว 1 ชิ้น
 *
 * ให้สีเหมือนวาดลงจอทุกพิกเซล: ปกติ three.js วาดลง render target เป็นสีเชิงเส้นโดยไม่ทำ tone mapping ทีละวัตถุ
 * → วัตถุโปร่งใสสว่าง ๆ (กระจกตู้สะท้อนแสง) ผสมกันก่อนแล้วค่อยถูกปรับ กลายเป็นฝ้าขาว
 * จึงตั้ง isXRRenderTarget ซึ่งใน three.js r186 มีผลแค่ (1) ทำ tone mapping + แปลงเป็น sRGB ในแต่ละวัตถุเหมือนวาดลงจอ
 * (2) buffer MSAA เก็บเป็น RGBA8 ธรรมดา (ค่าเป็น sRGB อยู่แล้ว) — ถ้าอัปเกรด three.js ให้เทียบภาพตัวอย่างตู้กับในเกมว่าสียังตรงกัน
 */
export class OffscreenShot {
  /** @param {THREE.WebGLRenderer} renderer renderer หลักของเกม */
  constructor(renderer) {
    this.renderer = renderer;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.target = null;
  }

  /** render target ขนาด w×h (ใช้ซ้ำถ้าขนาดเดิม) */
  #targetFor(w, h) {
    if (this.target?.width === w && this.target?.height === h) return this.target;
    this.release();
    const target = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, samples: 4 });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    target.isXRRenderTarget = true; // ดูคำอธิบายด้านบน
    // เก็บเป็น RGBA8 ทั้ง buffer MSAA และ texture ปลายทาง (ถ้าปล่อยให้ texture เป็น SRGB8 จะแปลงสีซ้ำ หรือคัดลอกจาก MSAA ไม่ได้ → ภาพดำ)
    target.texture.internalFormat = 'RGBA8';
    target.pixels = new Uint8Array(w * h * 4);
    this.target = target;
    return target;
  }

  /**
   * @param {{ width: number, height: number, background?: THREE.ColorRepresentation|null, exposure?: number, type?: string, quality?: number }} options
   *  background = สีพื้นหลัง (null = โปร่งใส สำหรับ PNG) · exposure = ความสว่าง (ไม่ระบุ = เท่ากับฉากหลัก)
   * @returns {string} data URL ('' ถ้าถ่ายไม่สำเร็จ)
   */
  capture(scene, camera, { width, height, background = null, exposure = null, type = 'image/png', quality } = {}) {
    const r = this.renderer;
    const prev = { target: r.getRenderTarget(), color: r.getClearColor(new THREE.Color()), alpha: r.getClearAlpha(), exposure: r.toneMappingExposure };
    try {
      const t = this.#targetFor(width, height);
      if (exposure != null) r.toneMappingExposure = exposure;
      r.setClearColor(background ?? 0x000000, background == null ? 0 : 1);
      r.setRenderTarget(t);
      r.clear();
      r.render(scene, camera);
      r.readRenderTargetPixels(t, 0, 0, width, height, t.pixels);
      r.setRenderTarget(prev.target);

      // pixel ใน render target เรียงจากล่างขึ้นบน และบนพื้นใสสีถูกคูณด้วย alpha แล้ว (เหมือน canvas แบบ premultiplied) → กลับด้าน + หารคืน
      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      const img = this.ctx.createImageData(width, height);
      const src = t.pixels;
      const dst = img.data;
      const row = width * 4;
      const transparent = background == null;
      for (let y = 0; y < height; y++) {
        const s = (height - 1 - y) * row;
        const d = y * row;
        for (let x = 0; x < row; x += 4) {
          const a = src[s + x + 3];
          if (transparent && a > 0 && a < 255) {
            const k = 255 / a;
            dst[d + x] = Math.min(255, src[s + x] * k);
            dst[d + x + 1] = Math.min(255, src[s + x + 1] * k);
            dst[d + x + 2] = Math.min(255, src[s + x + 2] * k);
          } else {
            dst[d + x] = src[s + x];
            dst[d + x + 1] = src[s + x + 1];
            dst[d + x + 2] = src[s + x + 2];
          }
          dst[d + x + 3] = transparent ? a : 255;
        }
      }
      this.ctx.putImageData(img, 0, 0);
      return this.canvas.toDataURL(type, quality);
    } catch (err) {
      console.warn('ถ่ายภาพตัวอย่างไม่สำเร็จ', err);
      return '';
    } finally {
      r.setRenderTarget(prev.target);
      r.setClearColor(prev.color, prev.alpha);
      r.toneMappingExposure = prev.exposure;
    }
  }

  /** คืนหน่วยความจำ GPU ของ render target (ถ่ายใหม่ได้ภายหลัง — จะสร้างใหม่ให้) */
  release() {
    this.target?.dispose();
    this.target = null;
  }
}
