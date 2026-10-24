import * as THREE from 'three';
import { FISH_SPECIES, GENERIC_FISH_MODEL } from '../data/fish.js';
import { DECOR_ITEMS, getDecorCategory } from '../data/decor.js';
import { buildFishPlaceholder, createFishMaterials } from '../placeholders/fishPlaceholder.js';
import { buildDecorPlaceholder } from '../placeholders/decorPlaceholder.js';
import { forEachMaterial, normalizeModel } from './AssetLoader.js';
import { applyShaderMods, causticsMod, createCrawlMod, createSwayMod, createSwimMod } from '../render/shaderMods.js';
import { createBoneRig } from '../render/boneRig.js';
import { createFishMotionMod, createFishMotionUniforms, prepareFlexAttribute } from '../render/fishMotion.js';
import { createMolly } from '../models/molly/MollyModel.js';
import { genesToVariant } from '../models/molly/genetics.js';
import { fryAmount } from '../models/molly/fry.js';

/** ความยาวรวม (หัวถึงปลายหาง) ของโมเดล .glb หลังปรับขนาด เทียบกับลำตัวโมเดลชั่วคราวที่ยาว 1 */
export const FISH_MODEL_LENGTH = 1.35;

/** โมเดลปลาที่สร้างด้วยโค้ดแบบละเอียด (species.procedural.type) — ใช้แทนโมเดลชั่วคราว ถ้าไม่มีไฟล์ .glb ของสายพันธุ์นั้น */
const PROCEDURAL_FISH = {
  // ลูกปลาสอดแรกเกิดยังไม่เห็นสีจริง (fry.js) — สีค่อย ๆ เผยตามการเติบโต
  molly: (species, { animated, detail, genes, mesh, growth, baby }) =>
    createMolly({ variant: genes ? genesToVariant(genes) : species.procedural.variant, detail, animated, mesh, fry: fryAmount(species, growth), baby }),
};

/**
 * จุดเดียวที่ตัดสินใจว่าจะใช้โมเดล .glb หรือโมเดลชั่วคราว
 * ทั้งฉากหลักและรูปตัวอย่างใน UI เรียกผ่านที่นี่
 */
export class ModelFactory {
  /** @param {{ detail?: () => 'high'|'medium'|'low' }} options detail = ระดับรายละเอียดของโมเดลปลาที่สร้างด้วยโค้ด (ตามคุณภาพกราฟิก) */
  constructor(assets, { detail = () => 'high' } = {}) {
    this.assets = assets;
    this.detail = detail;
  }

  fishModelUrls(species) {
    // ปลาที่มีโมเดลจากโค้ดแบบละเอียดแล้ว ไม่ใช้ไฟล์ปลากลาง (fish.glb) แทน
    if (species.procedural) return [species.model?.url].filter(Boolean);
    return [species.model?.url, GENERIC_FISH_MODEL].filter(Boolean);
  }

  decorModelUrls(item) {
    // model.fallback = false → รูปทรงเฉพาะตัว ห้ามใช้ไฟล์กลางของหมวดแทน (เช่น หินรูปทรงแปลก ๆ)
    const fallback = item.model?.fallback === false ? null : getDecorCategory(item.category)?.fallbackModel;
    return [item.model?.url, fallback].filter(Boolean);
  }

  allModelUrls() {
    return [
      ...FISH_SPECIES.flatMap((s) => [...this.fishModelUrls(s), s.procedural?.mesh, s.procedural?.babyMesh].filter(Boolean)),
      ...DECOR_ITEMS.flatMap((d) => this.decorModelUrls(d)),
    ];
  }

  /**
   * @returns {{ object: THREE.Object3D, mixer: THREE.AnimationMixer|null, swimUniforms: object|null, trail?: object|null, rig?: object|null, isPlaceholder: boolean }}
   *  rig = ตัวขยับโครงกระดูกด้วยโค้ด (render/boneRig.js) เรียก rig.update ทุกเฟรม
   *  object หันหัวไป +Z จุดศูนย์กลางที่กลางลำตัว ลำตัวยาวประมาณ 1 หน่วย
   *  trail = อนุภาคแสงที่ปลาปล่อยตามหลังขณะว่าย (ถ้าโมเดลจากโค้ดส่งมา) ดู world/Sparkles.js
   */
  /**
   * ใช้โมเดลลูกปลาไหม: สายพันธุ์ที่มี procedural.babyMesh และโตไม่ถึง procedural.babyUntil (ต้องโหลดไฟล์ได้ด้วย)
   * @param {number} [growth] 0 แรกเกิด → 1 โตเต็มวัย (ไม่ระบุ = ตัวเต็มวัย เช่น รูปในร้านค้า)
   */
  isBabyLook(species, growth = 1) {
    const p = species.procedural;
    return !!p?.babyMesh && growth < (p.babyUntil ?? 0.6) && !!this.assets.first([p.babyMesh]);
  }

  /**
   * @param {{ animated?: boolean, genes?: object, growth?: number }} options genes = ยีนสีของปลาลูกผสม (ดู models/molly/genetics.js)
   *  growth = ช่วงวัย (ลูกปลาบางสายพันธุ์ใช้โมเดลแยก — ผลลัพธ์มี baby: true)
   */
  createFish(species, { animated = true, genes = null, growth = 1 } = {}) {
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
      // มีกระดูกแต่ไม่มีคลิปแอนิเมชัน → ขยับข้อกระดูกด้วยโค้ด (ต้องสร้างก่อนย่อ/หมุนโมเดล ใช้ทิศของตัวโมเดลเป็นแกนอ้างอิง)
      const rig = animated && !mixer && species.model?.rig ? createBoneRig(scene, species.model.rig) : null;
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
      const walkUniforms = animated && species.model?.crawl ? this.#applyCrawl(root, species.model.crawl) : null;
      // ไม่มีแอนิเมชันในไฟล์ แต่ไฟล์ถูกแปลงด้วย build-model.mjs --fish แล้ว → ท่าว่ายจาก shader (render/fishMotion.js)
      let swimUniforms = null;
      if (animated && !mixer && species.model?.motion) {
        prepareFlexAttribute(root);
        swimUniforms = createFishMotionUniforms(root);
        forEachMaterial(root, (m) => applyShaderMods(m, [createFishMotionMod(species.model.motion, swimUniforms, { rigged: !!rig })]));
      }
      return { object: root, mixer: animated ? mixer : null, swimUniforms, walkUniforms, rig, isPlaceholder: false };
    }

    const procedural = PROCEDURAL_FISH[species.procedural?.type];
    if (procedural) {
      // procedural.mesh = ไฟล์รูปทรงที่โมเดลจากโค้ดนำไปย้อมสีเอง (เช่น molly.glb ใช้กับปลาสอดทุกสี)
      // procedural.babyMesh = รูปทรงลูกปลา (ย้อมสีตามสายพันธุ์/ยีนแบบเดียวกัน) ใช้จนโตถึง babyUntil
      const baby = this.isBabyLook(species, growth);
      const url = baby ? species.procedural.babyMesh : species.procedural.mesh;
      const mesh = url ? (this.assets.first([url])?.gltf ?? null) : null;
      const { object, swimUniforms, trail = null, fry = null } = procedural(species, { animated, detail: this.detail(), genes, mesh, growth, baby });
      return { object, mixer: null, swimUniforms, trail, baby, fry, isPlaceholder: false };
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

  /** ขาเดินด้วย shader: mesh ที่ชื่อตรงกับ crawl.legs = ขา (กลุ่มแรกของ regex = ลำดับคู่ขา), crawl.claws = ก้าม */
  #applyCrawl(root, crawl) {
    const walk = { uWalkPhase: { value: Math.random() * 10 }, uWalkAmp: { value: 0 } };
    const legRe = new RegExp(crawl.legs);
    const clawRe = crawl.claws ? new RegExp(crawl.claws) : null;
    root.traverse((obj) => {
      if (!obj.isMesh || Array.isArray(obj.material)) return;
      const m = legRe.exec(obj.name);
      const leg = m ? Number(m[1] ?? 1) - 1 : clawRe?.test(obj.name) ? -1 : null;
      if (leg !== null) applyShaderMods(obj.material, [createCrawlMod(walk, { ...crawl, leg })]);
    });
    return walk;
  }

  /**
   * @param {number} seed 0..1 ทำให้โมเดลชั่วคราวแต่ละชิ้นหน้าตาต่างกัน
   * @returns {{ object: THREE.Object3D, isPlaceholder: boolean, mixer: THREE.AnimationMixer|null }} ฐานของโมเดลอยู่ที่ y=0
   *  mixer = แอนิเมชันคลานของหอย (item.critter) จากไฟล์ .glb — เล่นคลิปที่ชื่อมี crawl/walk/move ก่อน
   */
  createDecor(item, seed = 0.5, { animated = true } = {}) {
    const found = this.assets.first(this.decorModelUrls(item));
    const inst = found ? this.assets.instantiate(found.gltf) : null;
    const raw = inst ? inst.scene : buildDecorPlaceholder(item, seed);
    let mixer = null;
    if (animated && item.critter && inst?.animations?.length) {
      mixer = new THREE.AnimationMixer(raw);
      mixer.clipAction(inst.animations.find((a) => /crawl|walk|move/i.test(a.name)) ?? inst.animations[0]).play();
    }
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
    return { object: root, isPlaceholder: !found, mixer };
  }
}
