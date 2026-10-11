import * as THREE from 'three';
import { getRayTexture } from '../render/textures.js';
import { sharedUniforms } from '../render/shaderMods.js';
import { rand } from '../utils/math.js';

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const fragmentShader = /* glsl */ `
uniform sampler2D uMap;
uniform float uTime;
uniform float uSeed;
uniform float uIntensity;
varying vec2 vUv;
void main() {
  float a = texture2D(uMap, vUv).r;
  float flicker = 0.55 + 0.45 * sin(uTime * (0.35 + uSeed * 0.4) + uSeed * 6.2831);
  gl_FragColor = vec4(vec3(0.78, 0.94, 1.0), a * flicker * uIntensity);
}`;

/** ลำแสงส่องลงมาจากผิวน้ำ (หันหาและเอียงตามกล้องเสมอ) */
export class LightRays {
  constructor(dims) {
    this.group = new THREE.Group();
    this.intensity = { value: 0.22 };
    this.rays = [];
    const count = Math.round(dims.w / 2);
    const tex = getRayTexture();
    for (let i = 0; i < count; i++) {
      const height = dims.waterTop * rand(0.75, 1.0);
      const width = rand(0.7, 1.8);
      const material = new THREE.ShaderMaterial({
        uniforms: { uMap: { value: tex }, uTime: sharedUniforms.uTime, uSeed: { value: Math.random() }, uIntensity: this.intensity },
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        fog: false,
      });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), material);
      mesh.position.y = -height / 2;
      mesh.renderOrder = 2;
      const slant = new THREE.Group();
      slant.rotation.z = rand(0.12, 0.3);
      slant.add(mesh);
      const pivot = new THREE.Group();
      const x = ((i + 0.5) / count - 0.5) * dims.w * 0.9 + rand(-0.4, 0.4);
      pivot.position.set(x, dims.waterTop, rand(-dims.d * 0.3, dims.d * 0.2));
      pivot.add(slant);
      this.group.add(pivot);
      this.rays.push(pivot);
    }
  }

  update(camera) {
    for (const pivot of this.rays) {
      pivot.rotation.y = Math.atan2(camera.position.x - pivot.position.x, camera.position.z - pivot.position.z);
    }
  }

  dispose() {
    this.group.traverse((obj) => {
      obj.geometry?.dispose();
      obj.material?.dispose();
    });
  }
}
