import * as THREE from 'three';
import { getGravelTextures } from '../render/textures.js';
import { applyShaderMods, causticsMod, createGridMod } from '../render/shaderMods.js';
import { CONFIG } from '../config.js';
import { clamp, lerp, rand, smoothstep } from '../utils/math.js';
import { fbm2 } from '../utils/noise.js';

const UV_SCALE = 1 / 2.2; // ขนาดลายกรวด (หน่วยเกมต่อ 1 รอบ texture)

/** พื้นกรวดในตู้: ลาดจากหลังสูงไปหน้าต่ำ มีหินกรวดเม็ดเล็กกระจาย */
export class Substrate {
  constructor(dims, { pebbles = 400 } = {}) {
    this.dims = dims;
    this.backHeight = 1.25;
    this.frontHeight = 0.55;
    this.group = new THREE.Group();

    const { map, bumpMap } = getGravelTextures();
    /** opacity > 0 = แสดงกริดโหมดตกแต่ง */
    this.gridUniforms = { opacity: { value: 0 }, size: { value: CONFIG.gridSize * 2 } };
    this.material = applyShaderMods(new THREE.MeshStandardMaterial({ map, bumpMap, bumpScale: 1.6, roughness: 0.95, metalness: 0 }), [
      causticsMod,
      createGridMod(this.gridUniforms),
    ]);

    this.top = this.#buildTop();
    this.group.add(this.top, this.#buildSkirts());
    if (pebbles > 0) this.group.add(this.#buildPebbles(pebbles));
  }

  /** ความสูงของพื้นกรวด ณ ตำแหน่ง (x, z) */
  heightAt(x, z) {
    const { d } = this.dims;
    const v = clamp(z / d + 0.5, 0, 1); // 0 = ด้านหลัง, 1 = ด้านหน้า
    const base = lerp(this.backHeight, this.frontHeight, smoothstep(0, 1, v));
    return base + (fbm2(x * 0.45 + 3.7, z * 0.45 - 1.2, 3) - 0.5) * 0.35;
  }

  #buildTop() {
    const { w, d } = this.dims;
    const segX = Math.ceil(w * 5);
    const segZ = Math.ceil(d * 5);
    const geo = new THREE.PlaneGeometry(w, d, segX, segZ);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const uv = geo.attributes.uv;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, this.heightAt(x, z));
      uv.setXY(i, x * UV_SCALE, -z * UV_SCALE);
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.material);
    mesh.receiveShadow = true;
    mesh.name = 'substrate';
    return mesh;
  }

  /** ผนังด้านข้างของชั้นกรวด (มองเห็นผ่านกระจกหน้า/ข้าง) */
  #buildSkirts() {
    const { w, d } = this.dims;
    const positions = [];
    const uvs = [];
    const normals = [];
    const indices = [];
    const strip = (count, pointAt, normal) => {
      const start = positions.length / 3;
      for (let i = 0; i <= count; i++) {
        const [x, z, u] = pointAt(i / count);
        const top = this.heightAt(x, z);
        positions.push(x, top, z, x, 0, z);
        uvs.push(u * UV_SCALE, top * UV_SCALE, u * UV_SCALE, 0);
        normals.push(...normal, ...normal);
      }
      for (let i = 0; i < count; i++) {
        const a = start + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    };
    // ทิศการไล่จุดของแต่ละด้านต้องทวนเข็มเมื่อมองจากด้านนอก (ด้านหน้าของ face)
    const e = 0.002;
    strip(Math.ceil(w * 5), (t) => [lerp(-w / 2, w / 2, t), d / 2 - e, lerp(-w / 2, w / 2, t)], [0, 0, 1]);
    strip(Math.ceil(d * 5), (t) => [-w / 2 + e, lerp(-d / 2, d / 2, t), lerp(-d / 2, d / 2, t)], [-1, 0, 0]);
    strip(Math.ceil(d * 5), (t) => [w / 2 - e, lerp(d / 2, -d / 2, t), lerp(d / 2, -d / 2, t)], [1, 0, 0]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    return new THREE.Mesh(geo, this.material);
  }

  #buildPebbles(count) {
    const { w, d } = this.dims;
    const geo = new THREE.IcosahedronGeometry(1, 1);
    const mat = applyShaderMods(new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0 }), [causticsMod]);
    const mesh = new THREE.InstancedMesh(geo, mat, count);
    const palette = ['#e9dfcb', '#b9a17d', '#8a7860', '#f6f0e4', '#6f6458', '#c7ad86', '#9b8f84', '#d8c09a'].map((c) => new THREE.Color(c));
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    const e = new THREE.Euler();
    for (let i = 0; i < count; i++) {
      const x = rand(-w / 2 + 0.08, w / 2 - 0.08);
      const z = rand(-d / 2 + 0.08, d / 2 - 0.08);
      const size = 0.035 + Math.pow(Math.random(), 3) * 0.13;
      s.set(size * rand(0.9, 1.4), size * rand(0.45, 0.75), size * rand(0.9, 1.3));
      p.set(x, this.heightAt(x, z) + s.y * 0.3, z);
      q.setFromEuler(e.set(rand(-0.3, 0.3), rand(0, Math.PI * 2), rand(-0.3, 0.3)));
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, palette[Math.floor(Math.random() * palette.length)]);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.receiveShadow = true;
    return mesh;
  }

  dispose() {
    this.group.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
    });
    this.material.dispose();
    this.group.children.forEach((c) => c.material !== this.material && c.material?.dispose());
  }
}
