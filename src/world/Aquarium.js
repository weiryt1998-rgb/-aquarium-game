import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Substrate } from './Substrate.js';
import { LightRays } from './LightRays.js';
import { getGlassStreakTexture, getLedGlowTexture, getTankBackdropTexture, getWoodTexture } from '../render/textures.js';
import { applyShaderMods, sharedUniforms } from '../render/shaderMods.js';
import { AmbientMotes } from './AmbientMotes.js';
import { AlgaeFilm } from './Algae.js';
import { clamp, lerp, rand, smoothstep } from '../utils/math.js';

const CLEAR_FOG = new THREE.Color('#1b6aa8');
const GREEN_FOG = new THREE.Color('#2f7a5e');
const MURKY_FOG = new THREE.Color('#5c5f30');
const ALGAE_SAND = new THREE.Color('#7f9150');
const SURFACE_DEEP = new THREE.Color('#2f8fd0');
const SURFACE_SHALLOW = new THREE.Color('#9fe6ff');
const SURFACE_MURKY = new THREE.Color('#7a9a5a');

const surfaceVertex = /* glsl */ `
uniform float uTime;
varying vec3 vWorld;
void main() {
  vec3 p = position;
  p.z += sin(p.x * 1.7 + uTime * 1.2) * 0.025 + sin(p.y * 2.3 + uTime * 0.9) * 0.02;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}`;

const surfaceFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uShallow;
varying vec3 vWorld;
void main() {
  vec3 viewDir = normalize(cameraPosition - vWorld);
  float grazing = 1.0 - abs(viewDir.y);
  float n = sin(vWorld.x * 3.1 + uTime * 1.3) * sin(vWorld.z * 2.7 - uTime * 1.1) + sin((vWorld.x + vWorld.z) * 1.9 + uTime * 0.7) * 0.5;
  float shimmer = smoothstep(0.6, 1.4, n);
  vec3 col = mix(uDeep, uShallow, 0.4 + 0.6 * grazing) + shimmer * 0.3;
  float alpha;
  if (cameraPosition.y < vWorld.y) {
    // มองจากใต้น้ำ: มุมเฉียงสะท้อนแสงกลับหมด (total internal reflection) จึงดูสว่างเงา
    alpha = mix(0.3, 0.9, pow(grazing, 2.0));
    col = mix(col, vec3(0.86, 0.97, 1.0), pow(grazing, 3.0) * 0.6);
  } else {
    alpha = mix(0.16, 0.5, pow(grazing, 3.0));
  }
  gl_FragColor = vec4(col, alpha);
}`;

/** สไตล์ตู้เริ่มต้น (ถ้าข้อมูลตู้ไม่ได้ระบุ style) */
const DEFAULT_STYLE = { frame: 'black', trim: null, led: '#cfefff', backdrop: 'ocean', sand: '#ffffff' };

/** วัสดุขอบตู้ตามสไตล์ (physical = ใช้ MeshPhysicalMaterial สำหรับประกายรุ้ง/เคลือบเงา, stars = ดาวระยิบบนผิว) */
const FRAME_MATERIALS = {
  black: () => ({ color: '#15181e', roughness: 0.38, metalness: 0.5 }),
  walnut: () => ({ color: '#8a5a36', map: getWoodTexture(), roughness: 0.48, metalness: 0.05 }),
  white: () => ({ color: '#eef2f6', roughness: 0.2, metalness: 0.05 }),
  lacquer: () => ({ color: '#0b0d12', roughness: 0.14, metalness: 0.65 }),
  // มุกขาวอมชมพู ประกายรุ้งเมื่อมองเฉียง
  pearl: () => ({ physical: true, color: '#f7eef3', roughness: 0.22, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 1, iridescenceIOR: 1.45, iridescenceThicknessRange: [220, 620] }),
  // โลหะเข้มเหลือบเขียว-ม่วงแบบแสงเหนือ
  aurora: () => ({ physical: true, color: '#14283a', roughness: 0.16, metalness: 0.7, clearcoat: 1, clearcoatRoughness: 0.04, iridescence: 1, iridescenceIOR: 1.8, iridescenceThicknessRange: [380, 900] }),
  // หินออบซิเดียนดำเงา มีดาวกระพริบอยู่ในเนื้อ
  cosmic: () => ({ physical: true, stars: true, color: '#08060f', roughness: 0.1, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.03 }),
};

/** แถบโลหะตกแต่ง */
const TRIM_MATERIALS = {
  chrome: { color: '#eef3f8', roughness: 0.12, metalness: 1 },
  brass: { color: '#c9a052', roughness: 0.28, metalness: 1 },
  gold: { color: '#ffd062', roughness: 0.2, metalness: 1 },
  rosegold: { color: '#f0b09a', roughness: 0.2, metalness: 1 },
  platinum: { color: '#e9eef7', roughness: 0.07, metalness: 1 },
};

/**
 * ดาวระยิบระยับบนผิวขอบตู้ (คำนวณจากตำแหน่งในโลก จึงไม่ยืดตามความยาวของแท่งขอบ)
 * ดาวแต่ละดวงกระพริบด้วยจังหวะของตัวเอง
 */
const frameStarsMod = {
  key: 'frame-stars',
  apply(shader) {
    shader.uniforms.uStarTime = sharedUniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vStarPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvStarPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float uStarTime;
        varying vec3 vStarPos;
        float starHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 sp = vStarPos * 26.0;
          vec3 cell = floor(sp);
          float h = starHash(cell);
          float d = length(fract(sp) - 0.5 - (vec3(starHash(cell + 3.1), starHash(cell + 7.7), starHash(cell + 1.3)) - 0.5) * 0.5);
          float tw = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(uStarTime * (1.0 + h * 3.0) + h * 50.0), 3.0);
          float star = step(0.9, h) * smoothstep(0.16, 0.0, d) * tw;
          vec3 tint = mix(vec3(0.75, 0.8, 1.0), vec3(1.0, 0.85, 0.6), starHash(cell + 9.1));
          totalEmissiveRadiance += tint * star * 2.4;
          // เนบิวลาจาง ๆ ใต้ดาว
          float neb = 0.5 + 0.5 * sin(vStarPos.x * 0.9 + sin(vStarPos.y * 1.7) * 2.0 + vStarPos.z * 0.6);
          totalEmissiveRadiance += mix(vec3(0.12, 0.03, 0.22), vec3(0.02, 0.06, 0.2), neb) * 0.6;
        }`,
      );
  },
};

/** ไฟ LED ที่เปลี่ยนสีเอง (style.ledAnim) — คืนสีตามเวลา */
const LED_ANIMATIONS = {
  // ไล่สีแสงเหนือ เขียว → ฟ้า → ม่วง ช้า ๆ
  aurora: (t, out) => {
    const k = (t * 0.06) % 3;
    const i = Math.floor(k);
    const pal = LED_AURORA;
    return out.copy(pal[i]).lerp(pal[(i + 1) % 3], k - i);
  },
  // สีรุ้งวนรอบ
  rainbow: (t, out) => out.setHSL((t * 0.04) % 1, 0.85, 0.62),
};
const LED_AURORA = ['#5dffc0', '#5ab8ff', '#c08aff'].map((c) => new THREE.Color(c));

/**
 * ตู้ปลา: พื้นกรวด กระจก ขอบตู้ ผิวน้ำ พื้นหลัง ลำแสง และเครื่องมือช่วยจัดวาง (กริด/วงกลมบอกตำแหน่ง)
 * รูปลักษณ์ (ขอบตู้ ไฟ LED พื้นหลัง สีทราย) เปลี่ยนตาม tankType.style
 * ตู้พรีเมียมมีเพิ่ม: ledAnim (ไฟเปลี่ยนสีเอง), neon (ไฟเส้นตามขอบ), edge (ขอบกระจกเรืองแสง), ambient (อนุภาคในน้ำ)
 * พิกัดภายในตู้: กึ่งกลางตู้ที่ x=0,z=0 ก้นตู้ที่ y=0
 */
export class Aquarium {
  constructor(sceneMgr) {
    this.sceneMgr = sceneMgr;
    this.group = new THREE.Group();
    sceneMgr.scene.add(this.group);
    this.dims = null;
    this.quality = 1;
    this.box = new THREE.Box3();
    this.surfaceUniforms = {
      uTime: sharedUniforms.uTime,
      uDeep: { value: SURFACE_DEEP.clone() },
      uShallow: { value: SURFACE_SHALLOW.clone() },
    };
  }

  build(tankType, qualitySettings) {
    this.dispose();
    const { w, h, d } = tankType.size;
    this.dims = { w, h, d, waterTop: h - 0.45 };
    this.style = { ...DEFAULT_STYLE, ...tankType.style };
    sharedUniforms.uWaterTop.value = this.dims.waterTop;
    this.box.set(new THREE.Vector3(-w / 2, 0, -d / 2), new THREE.Vector3(w / 2, h, d / 2));

    this.substrate = new Substrate(this.dims, { pebbles: qualitySettings.pebbles });
    this.substrate.material.color.set(this.style.sand);
    this.group.add(this.substrate.group);
    this.#buildBackdrop();
    this.#buildGlass();
    this.#buildFrame();
    this.#buildWaterSurface();
    this.#buildDebris();
    this.algae = new AlgaeFilm(this.dims);
    this.group.add(this.algae.group);
    this.rays = new LightRays(this.dims);
    this.group.add(this.rays.group);
    if (this.style.ambient) this.group.add(new AmbientMotes(this.dims, this.style.ambient).points);
    this.marker = this.#buildMarker();
    this.marker.visible = false;
    this.group.add(this.marker);
    this.setWaterQuality(this.quality, { immediate: true });
  }

  // ── ส่วนประกอบของตู้ ──────────────────────────────────────

  #buildBackdrop() {
    const { w, h, d } = this.dims;
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: getTankBackdropTexture(this.style.backdrop) }));
    backdrop.position.set(0, h / 2, -d / 2 + 0.005);
    this.group.add(backdrop);
  }

  #buildGlass() {
    const { w, h, d, waterTop } = this.dims;
    const glass = new THREE.MeshPhysicalMaterial({
      color: 0xe6fbff,
      metalness: 0,
      roughness: 0.04,
      transparent: true,
      opacity: 0.1,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMap: this.sceneMgr.envMap,
      envMapIntensity: 1.6,
      fog: false,
    });
    const panes = [
      [new THREE.PlaneGeometry(w, h), [0, h / 2, d / 2], 0],
      [new THREE.PlaneGeometry(d, h), [-w / 2, h / 2, 0], -Math.PI / 2],
      [new THREE.PlaneGeometry(d, h), [w / 2, h / 2, 0], Math.PI / 2],
    ];
    for (const [geo, pos, rotY] of panes) {
      const pane = new THREE.Mesh(geo, glass);
      pane.position.set(...pos);
      pane.rotation.y = rotY;
      pane.renderOrder = 5;
      this.group.add(pane);
    }
    // แถบสะท้อนแสงบนกระจกหน้า
    const streak = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ map: getGlassStreakTexture(), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
    );
    streak.position.set(0, h / 2, d / 2 + 0.01);
    streak.renderOrder = 6;
    this.group.add(streak);
    // เส้นขอบกระจก
    // style.edge = สีเส้นขอบกระจกเรืองแสง (ตู้พรีเมียม)
    const edges = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(w, h, d)),
      new THREE.LineBasicMaterial({ color: this.style.edge ?? '#c8f2ff', transparent: true, opacity: this.style.edge ? 0.9 : 0.35, fog: false }),
    );
    edges.position.y = h / 2;
    this.group.add(edges);
    // เส้นระดับน้ำบนกระจก
    const lineMat = new THREE.MeshBasicMaterial({ color: '#e2f8ff', transparent: true, opacity: 0.55, depthWrite: false, fog: false });
    const front = new THREE.Mesh(new THREE.PlaneGeometry(w, 0.05), lineMat);
    front.position.set(0, waterTop, d / 2 - 0.004);
    const left = new THREE.Mesh(new THREE.PlaneGeometry(d, 0.05), lineMat);
    left.position.set(-w / 2 + 0.004, waterTop, 0);
    left.rotation.y = Math.PI / 2;
    const right = left.clone();
    right.position.x = w / 2 - 0.004;
    right.rotation.y = -Math.PI / 2;
    this.group.add(front, left, right);
  }

  #buildFrame() {
    const { w, h, d } = this.dims;
    const style = this.style;
    const premium = style.trim != null;
    const { physical, stars, ...frameParams } = (FRAME_MATERIALS[style.frame] ?? FRAME_MATERIALS.black)();
    const mat = physical ? new THREE.MeshPhysicalMaterial({ ...frameParams, fog: false }) : new THREE.MeshStandardMaterial({ ...frameParams, fog: false });
    if (stars) applyShaderMods(mat, [frameStarsMod]);
    const t = style.frame === 'white' ? 0.13 : 0.16;
    const addBar = (sx, sy, sz, x, y, z, material = mat) => {
      const r = Math.min(0.06, sx / 2, sy / 2, sz / 2) * 0.9;
      const bar = new THREE.Mesh(new RoundedBoxGeometry(sx, sy, sz, 3, r), material);
      bar.position.set(x, y, z);
      bar.castShadow = true;
      bar.receiveShadow = true;
      this.group.add(bar);
      return bar;
    };
    const rim = (height, y, thick = t) => {
      addBar(w + thick * 2, height, thick, 0, y, d / 2 + thick / 2);
      addBar(w + thick * 2, height, thick, 0, y, -d / 2 - thick / 2);
      addBar(thick, height, d, -w / 2 - thick / 2, y, 0);
      addBar(thick, height, d, w / 2 + thick / 2, y, 0);
    };
    // ฝาตู้: ตู้รุ่นพรีเมียมสูงกว่าและยื่นออกมาเล็กน้อย
    const lidH = premium ? 0.34 : 0.22;
    rim(lidH, h + lidH / 2 - 0.05, premium ? t + 0.04 : t);
    // ฐานตู้
    const baseH = premium ? 0.56 : 0.44;
    rim(baseH, -baseH / 2 + 0.12, premium ? t + 0.06 : t);

    // แถบโลหะตกแต่งด้านหน้าฝาและฐาน
    if (premium) {
      const trim = new THREE.MeshStandardMaterial({ ...TRIM_MATERIALS[style.trim], fog: false });
      const lidFront = d / 2 + t + 0.04;
      const baseFront = d / 2 + t + 0.06;
      addBar(w + t * 2 + 0.1, 0.09, 0.04, 0, h + lidH / 2 - 0.05, lidFront + 0.01, trim);
      addBar(w + t * 2 + 0.14, 0.1, 0.04, 0, 0.06, baseFront + 0.01, trim);
      addBar(w + t * 2 + 0.14, 0.07, 0.04, 0, -baseH + 0.24, baseFront + 0.01, trim);
    }

    // ไฟ LED ใต้ฝาตู้ + แสงเรืองลงมาในน้ำ
    const led = new THREE.Color(style.led);
    const ledMat = new THREE.MeshBasicMaterial({ color: led.clone().multiplyScalar(1.6), fog: false });
    for (const z of [d / 2 - 0.12, -d / 2 + 0.12]) {
      const strip = new THREE.Mesh(new THREE.BoxGeometry(w - 0.3, 0.025, 0.07), ledMat);
      strip.position.set(0, h - 0.06, z);
      this.group.add(strip);
    }
    const glowMat = new THREE.MeshBasicMaterial({ map: getLedGlowTexture(), color: led, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.2, 0.9), glowMat);
    glow.position.set(0, h - 0.5, d / 2 - 0.14);
    glow.renderOrder = 7;
    this.group.add(glow);

    // ไฟนีออนเส้นบางเรืองแสงตามขอบล่างของฝาและขอบบนของฐาน (สีเดียวกับไฟ LED)
    let neonMat = null;
    if (style.neon) {
      neonMat = new THREE.MeshBasicMaterial({ color: led.clone().multiplyScalar(2), fog: false });
      const front = d / 2 + t + 0.03;
      for (const y of [h - 0.07, 0.15]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(w + t * 2, 0.035, 0.03), neonMat);
        bar.position.set(0, y, front + 0.04);
        this.group.add(bar);
        for (const side of [-1, 1]) {
          const sideBar = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.035, d + t * 2), neonMat);
          sideBar.position.set(side * (w / 2 + t + 0.04), y, 0);
          this.group.add(sideBar);
        }
      }
    }
    this.leds = { base: led, ledMat, glowMat, neonMat, anim: LED_ANIMATIONS[style.ledAnim] ?? null, color: new THREE.Color() };

    // ซิลิโคนตามมุมตู้
    const post = new THREE.MeshStandardMaterial({ color: style.frame === 'white' ? '#dfe8ef' : '#0c1a26', transparent: true, opacity: 0.55, roughness: 0.3, fog: false });
    for (const [x, z] of [
      [-w / 2, d / 2],
      [w / 2, d / 2],
      [-w / 2, -d / 2],
      [w / 2, -d / 2],
    ]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.05, h, 0.05), post);
      p.position.set(x, h / 2, z);
      this.group.add(p);
    }
  }

  #buildWaterSurface() {
    const { w, d, waterTop } = this.dims;
    const surface = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d, 48, 24),
      new THREE.ShaderMaterial({
        uniforms: this.surfaceUniforms,
        vertexShader: surfaceVertex,
        fragmentShader: surfaceFragment,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    surface.rotation.x = -Math.PI / 2;
    surface.position.y = waterTop;
    surface.renderOrder = 4;
    this.group.add(surface);
  }

  /** ตะกอนลอยในน้ำ (เห็นชัดขึ้นเมื่อน้ำสกปรก) */
  #buildDebris() {
    const { w, d, waterTop } = this.dims;
    const count = Math.round(w * d * 2.5);
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = rand(-w / 2, w / 2);
      positions[i * 3 + 1] = rand(0.6, waterTop);
      positions[i * 3 + 2] = rand(-d / 2, d / 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.debris = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#b5a86a', size: 0.04, transparent: true, opacity: 0, depthWrite: false }));
    this.group.add(this.debris);
  }

  #buildMarker() {
    const marker = new THREE.Group();
    const discMat = new THREE.MeshBasicMaterial({ color: '#46e07a', transparent: true, opacity: 0.25, depthTest: false, depthWrite: false, fog: false });
    const ringMat = new THREE.MeshBasicMaterial({ color: '#46e07a', transparent: true, opacity: 0.95, depthTest: false, depthWrite: false, fog: false });
    const disc = new THREE.Mesh(new THREE.CircleGeometry(1, 40), discMat);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 48), ringMat);
    for (const m of [disc, ring]) {
      m.rotation.x = -Math.PI / 2;
      m.renderOrder = 20;
      marker.add(m);
    }
    marker.userData.materials = [discMat, ringMat];
    return marker;
  }

  // ── ตัวช่วย ──────────────────────────────────────────────────

  heightAt(x, z) {
    return this.substrate.heightAt(x, z);
  }

  /** บังคับตำแหน่งให้อยู่ในน้ำ (ไม่ทะลุกระจก พื้นทราย หรือผิวน้ำ) */
  clampToWater(pos, margin = 0.3) {
    const { w, d, waterTop } = this.dims;
    pos.x = clamp(pos.x, -w / 2 + margin, w / 2 - margin);
    pos.z = clamp(pos.z, -d / 2 + margin, d / 2 - margin);
    const floor = this.heightAt(pos.x, pos.z) + margin * 0.6;
    pos.y = clamp(pos.y, floor, waterTop - margin * 0.6);
    return pos;
  }

  /** สุ่มจุดในน้ำตามระดับความลึกที่ปลาชอบ */
  randomPoint(zone = 'any', margin = 0.5, out = new THREE.Vector3()) {
    const { w, d, waterTop } = this.dims;
    const x = rand(-w / 2 + margin, w / 2 - margin);
    const z = rand(-d / 2 + margin, d / 2 - margin * 0.8);
    const floor = this.heightAt(x, z) + margin;
    const top = waterTop - margin;
    const range = Math.max(top - floor, 0.1);
    const band = { top: [0.62, 1], middle: [0.25, 0.8], bottom: [0, 0.38] }[zone] ?? [0, 1];
    return out.set(x, floor + range * rand(band[0], band[1]), z);
  }

  /** วางของได้ไหม (อยู่ในตู้ทั้งชิ้น) */
  isInside(x, z, radius) {
    const { w, d } = this.dims;
    const r = radius * 0.7;
    return Math.abs(x) <= w / 2 - r && Math.abs(z) <= d / 2 - r;
  }

  raycastSubstrate(raycaster) {
    const hit = raycaster.intersectObject(this.substrate.top, false)[0];
    return hit ? hit.point : null;
  }

  showGrid(visible) {
    this.substrate.gridUniforms.opacity.value = visible ? 0.7 : 0;
  }

  showMarker(x, z, radius, valid) {
    this.marker.visible = true;
    this.marker.position.set(x, this.heightAt(x, z) + 0.06, z);
    this.marker.scale.setScalar(Math.max(radius, 0.25));
    const color = valid ? '#46e07a' : '#ff5a5a';
    this.marker.userData.materials.forEach((m) => m.color.set(color));
  }

  hideMarker() {
    this.marker.visible = false;
  }

  /**
   * ความสะอาดของน้ำ 0..1 → สีน้ำ (หมอก) ลายแสง ตะกอน สีทราย และตะไคร่บนกระจก
   * น้ำเปลี่ยนสีเป็นขั้น: ใส → อมเขียว (ตะไคร่ในน้ำ) → เขียวขี้ม้าอมน้ำตาล (สกปรกมาก)
   * @param {{immediate?: boolean}} options immediate = ตะไคร่แสดงทันที (ตอนโหลดตู้) ไม่ค่อย ๆ ขึ้น
   */
  setWaterQuality(q, { immediate = false } = {}) {
    this.quality = clamp(q, 0, 1);
    const dirt = 1 - this.quality;
    const fog = this.sceneMgr.scene.fog.color.copy(CLEAR_FOG).lerp(GREEN_FOG, smoothstep(0.15, 0.6, dirt));
    fog.lerp(MURKY_FOG, smoothstep(0.55, 1, dirt));
    sharedUniforms.uCausticIntensity.value = 0.55 * (0.35 + 0.65 * this.quality);
    this.surfaceUniforms.uDeep.value.copy(SURFACE_DEEP).lerp(SURFACE_MURKY, dirt * 0.8);
    this.surfaceUniforms.uShallow.value.copy(SURFACE_SHALLOW).lerp(SURFACE_MURKY, dirt * 0.6);
    if (this.debris) this.debris.material.opacity = Math.max(0, dirt - 0.25) * 1.1;
    if (this.rays) this.rays.intensity.value = 0.22 * (0.3 + 0.7 * this.quality);
    // ทรายมีคราบเขียวเมื่อสกปรก
    if (this.substrate) this.substrate.material.color.set(this.style.sand).lerp(ALGAE_SAND, smoothstep(0.35, 1, dirt) * 0.55);
    // ตะไคร่เริ่มขึ้นเมื่อความสะอาดต่ำกว่า 75% และเต็มกระจกเมื่อใกล้ 0
    this.algae?.setTarget(smoothstep(0.25, 0.97, dirt), { immediate });
  }

  update(dt, time, camera) {
    if (!this.dims) return;
    // หมอกใต้น้ำ: เริ่มที่ผิวตู้ด้านใกล้กล้อง ยิ่งน้ำขุ่นยิ่งทึบเร็ว
    const fog = this.sceneMgr.scene.fog;
    const near = Math.max(0.1, this.box.distanceToPoint(camera.position) - 0.2);
    fog.near = near;
    fog.far = near + ((this.dims.w + this.dims.d) / 2) * lerp(1.1, 3.0, this.quality);
    this.rays.update(camera);
    if (this.debris) this.debris.rotation.y = Math.sin(time * 0.05) * 0.02;
    this.algae?.update(dt);
    // ไฟ LED เปลี่ยนสีเอง
    const L = this.leds;
    if (L?.anim) {
      L.anim(time, L.color);
      L.ledMat.color.copy(L.color).multiplyScalar(1.6);
      L.glowMat.color.copy(L.color);
      L.neonMat?.color.copy(L.color).multiplyScalar(2);
    }
  }

  dispose() {
    if (!this.dims) return;
    this.substrate?.dispose();
    this.rays?.dispose();
    this.group.traverse((obj) => {
      if (obj === this.substrate?.group || obj.parent === this.substrate?.group) return;
      obj.geometry?.dispose();
      const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
      mats.forEach((m) => m.dispose());
    });
    this.group.clear();
    this.dims = null;
  }
}
