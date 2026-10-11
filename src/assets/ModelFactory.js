import * as THREE from 'three';
import { FISH_SPECIES, GENERIC_FISH_MODEL } from '../data/fish.js';
import { DECOR_ITEMS, getDecorCategory } from '../data/decor.js';
import { buildFishPlaceholder, createFishMaterials } from '../placeholders/fishPlaceholder.js';
import { buildDecorPlaceholder } from '../placeholders/decorPlaceholder.js';
import { forEachMaterial, normalizeModel } from './AssetLoader.js';
import { applyShaderMods, causticsMod, createSwayMod, createSwimMod } from '../render/shaderMods.js';

/** ความยาวรวม (หัวถึงปลายหาง) ของโมเดล .glb หลังปรับขนาด เทียบกับลำตัวโมเดลชั่วคราวที่ยาว 1 */
export const FISH_MODEL_LENGTH = 1.35;

/**
 * จุดเดียวที่ตัดสินใจว่าจะใช้โมเดล .glb หรือโมเดลชั่วคราว
 * ทั้งฉากหลักและรูปตัวอย่างใน UI เรียกผ่านที่นี่
 */
export class ModelFactory {
  constructor(assets) {
    this.assets = assets;
  }

  fishModelUrls(species) {
    return [species.model?.url, GENERIC_FISH_MODEL].filter(Boolean);
  }

  decorModelUrls(item) {
    return [item.model?.url, getDecorCategory(item.category)?.fallbackModel].filter(Boolean);
  }

  allModelUrls() {
    return [...FISH_SPECIES.flatMap((s) => this.fishModelUrls(s)), ...DECOR_ITEMS.flatMap((d) => this.decorModelUrls(d))];
  }

  /**
   * @returns {{ object: THREE.Object3D, mixer: THREE.AnimationMixer|null, swimUniforms: object|null, isPlaceholder: boolean }}
   *  object หันหัวไป +Z จุดศูนย์กลางที่กลางลำตัว ลำตัวยาวประมาณ 1 หน่วย
   */
  createFish(species, { animated = true } = {}) {
    const found = this.assets.first(this.fishModelUrls(species));
    if (found) {
      const { scene, animations } = this.assets.instantiate(found.gltf);
      // ตั้งท่าเป็นเฟรมแรกของแอนิเมชันก่อนวัดขนาด เพราะบางไฟล์ท่าพักกับท่าว่ายต่างกันมาก
      // (เช่น koi_fish.glb ที่แอนิเมชันแบบ morph หันหัวกลับด้านกับท่าพัก) รูปตัวอย่างจะได้ตรงกับที่เห็นในตู้
      let mixer = null;
      if (animations.length) {
        mixer = new THREE.AnimationMixer(scene);
        const clip = animations.find((a) => /swim/i.test(a.name)) ?? animations[0];
        mixer.clipAction(clip).play();
        mixer.update(0);
      }
      const { root } = normalizeModel(scene, {
        rotation: species.model?.rotation,
        fit: 'length',
        size: FISH_MODEL_LENGTH * (species.model?.scale ?? 1),
        align: 'center',
      });
      // ใช้ไฟล์ปลากลาง (fish.glb) → ย้อมสีตามสายพันธุ์ให้พอแยกออก
      if (found.url === GENERIC_FISH_MODEL && species.model?.url !== GENERIC_FISH_MODEL) {
        const tint = new THREE.Color(species.look.pattern.colors[0]).lerp(new THREE.Color('#ffffff'), 0.2);
        forEachMaterial(root, (m) => m.color?.copy(tint));
      }
      // วัสดุโปร่งใส (alphaMode BLEND เช่นครีบ) ปกติไม่เขียน depth ทำให้ลำตัวด้านไกลโผล่ทะลุด้านใกล้
      // → ให้เขียน depth และตัดพิกเซลที่ใสสนิททิ้ง ได้ลำดับการบังที่ถูกต้องกว่า
      forEachMaterial(root, (m) => {
        if (!m.transparent) return;
        m.depthWrite = true;
        m.alphaTest = Math.max(m.alphaTest, 0.02);
      });
      if (animated) forEachMaterial(root, (m) => m.isMeshStandardMaterial && applyShaderMods(m, [causticsMod]));
      return { object: root, mixer: animated ? mixer : null, swimUniforms: null, isPlaceholder: false };
    }

    const materials = createFishMaterials(species.look);
    let swimUniforms = null;
    if (animated) {
      swimUniforms = { uSwimPhase: { value: Math.random() * 10 }, uSwimAmp: { value: 0.08 } };
      applyShaderMods(materials.body, [createSwimMod(swimUniforms), causticsMod]);
      applyShaderMods(materials.fins, [createSwimMod(swimUniforms)]);
    }
    return { object: buildFishPlaceholder(species, materials), mixer: null, swimUniforms, isPlaceholder: true };
  }

  /**
   * @param {number} seed 0..1 ทำให้โมเดลชั่วคราวแต่ละชิ้นหน้าตาต่างกัน
   * @returns {{ object: THREE.Object3D, isPlaceholder: boolean }} ฐานของโมเดลอยู่ที่ y=0
   */
  createDecor(item, seed = 0.5, { animated = true } = {}) {
    const found = this.assets.first(this.decorModelUrls(item));
    const raw = found ? this.assets.instantiate(found.gltf).scene : buildDecorPlaceholder(item, seed);
    const fit = item.model?.fit ?? 'height';
    const size = fit === 'width' ? item.model?.size ?? item.radius * 2 : item.height;
    const { root, scale } = normalizeModel(raw, {
      rotation: found ? item.model?.rotation : [0, 0, 0],
      fit,
      size,
      align: 'base',
    });
    if (animated) {
      const sway = item.sway ? createSwayMod(scale) : null;
      forEachMaterial(root, (m) => applyShaderMods(m, [sway, m.isMeshStandardMaterial ? causticsMod : null]));
    }
    return { object: root, isPlaceholder: !found };
  }
}
