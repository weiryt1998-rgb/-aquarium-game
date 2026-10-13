/**
 * ส่วนต่อเติม shader ของวัสดุมาตรฐานของ Three.js (ผ่าน onBeforeCompile)
 *  - caustics : ลายแสงระยิบระยับใต้น้ำบนพื้นทราย หิน และปลา
 *  - swim     : ลำตัวและหางปลาส่ายเป็นคลื่น (โมเดลชั่วคราว)
 *  - sway     : พืชน้ำโยกไหวตามกระแสน้ำ
 *  - crawl    : ขาเดินของสัตว์ที่ไม่มีแอนิเมชันในไฟล์ (เช่น ปู)
 */

/** uniform ที่ใช้ร่วมกันทั้งเกม (อัปเดตทุกเฟรมใน Game) */
export const sharedUniforms = {
  uTime: { value: 0 },
  uCausticIntensity: { value: 0.55 },
  uCausticScale: { value: 0.3 },
  uWaterTop: { value: 6 },
};

/**
 * ใส่ mod หลายตัวให้วัสดุเดียว
 * สำคัญ: ต้องตั้ง customProgramCacheKey ไม่งั้น Three.js จะใช้ shader program ผิดตัว
 * (เพราะทุก material ใช้ฟังก์ชัน onBeforeCompile หน้าตาเดียวกัน)
 */
export function applyShaderMods(material, mods) {
  const list = mods.filter(Boolean);
  if (list.length === 0) return material;
  const all = [...(material._shaderMods ?? []), ...list];
  material._shaderMods = all;
  material.onBeforeCompile = (shader) => {
    for (const mod of all) mod.apply(shader);
  };
  material.customProgramCacheKey = () => all.map((m) => m.key).join('|');
  material.needsUpdate = true;
  return material;
}

const CAUSTIC_PARS = /* glsl */ `
uniform float uCTime;
uniform float uCausticIntensity;
uniform float uCausticScale;
uniform float uWaterTop;
varying vec3 vCausticPos;
varying vec3 vCausticNormal;

// Tileable water caustic (อ้างอิงจาก Dave Hoskins)
float causticPattern(vec2 uv, float time) {
  vec2 p = mod(uv * 6.28318, 6.28318) - 250.0;
  vec2 i = p;
  float c = 1.0;
  float inten = 0.005;
  for (int n = 0; n < 5; n++) {
    float t = time * (1.0 - (3.5 / float(n + 1)));
    i = p + vec2(cos(t - i.x) + sin(t + i.y), sin(t - i.y) + cos(t + i.x));
    c += 1.0 / length(vec2(p.x / (sin(i.x + t) / inten), p.y / (cos(i.y + t) / inten)));
  }
  c /= 5.0;
  c = 1.17 - pow(c, 1.4);
  return clamp(pow(abs(c), 8.0), 0.0, 2.0);
}
`;

export const causticsMod = {
  key: 'caustics',
  apply(shader) {
    shader.uniforms.uCTime = sharedUniforms.uTime;
    shader.uniforms.uCausticIntensity = sharedUniforms.uCausticIntensity;
    shader.uniforms.uCausticScale = sharedUniforms.uCausticScale;
    shader.uniforms.uWaterTop = sharedUniforms.uWaterTop;

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCausticPos;\nvarying vec3 vCausticNormal;')
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `#include <worldpos_vertex>
        {
          vec4 cPos = vec4(transformed, 1.0);
          vec3 cNrm = objectNormal;
          #ifdef USE_INSTANCING
            cPos = instanceMatrix * cPos;
            cNrm = mat3(instanceMatrix) * cNrm;
          #endif
          cPos = modelMatrix * cPos;
          vCausticPos = cPos.xyz;
          vCausticNormal = normalize(mat3(modelMatrix) * cNrm);
        }`,
      );

    const anchor = shader.fragmentShader.includes('#include <opaque_fragment>') ? '#include <opaque_fragment>' : '#include <output_fragment>';
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${CAUSTIC_PARS}`).replace(
      anchor,
      /* glsl */ `
      if (vCausticPos.y < uWaterTop) {
        float cDepth = clamp((uWaterTop - vCausticPos.y) / max(uWaterTop, 0.001), 0.0, 1.0);
        float cUp = clamp(vCausticNormal.y * 0.7 + 0.4, 0.0, 1.0);
        vec2 cuv = vCausticPos.xz * uCausticScale + vec2(vCausticPos.y * 0.04);
        float c = causticPattern(cuv, uCTime * 0.45);
        outgoingLight += diffuseColor.rgb * vec3(0.75, 0.95, 1.0) * c * cUp * uCausticIntensity * (1.0 - cDepth * 0.5);
      }
      ${anchor}`,
    );
  },
};

/**
 * เส้นกริดบนพื้นกรวด (โหมดตกแต่ง) — วาดใน fragment shader จึงคมและแนบไปกับพื้นที่ลาดเอียงพอดี
 * ต้องใส่ต่อจาก causticsMod เพราะใช้ตำแหน่ง/normal จาก mod นั้น
 * @param {{opacity:{value:number}, size:{value:number}}} uniforms
 */
export function createGridMod(uniforms) {
  return {
    key: 'grid',
    apply(shader) {
      shader.uniforms.uGridOpacity = uniforms.opacity;
      shader.uniforms.uGridSize = uniforms.size;
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uGridOpacity;\nuniform float uGridSize;').replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        if (uGridOpacity > 0.0) {
          vec2 gp = vCausticPos.xz / uGridSize;
          vec2 gd = abs(fract(gp - 0.5) - 0.5) / max(fwidth(gp), vec2(1e-4));
          float gLine = 1.0 - smoothstep(0.4, 1.6, min(gd.x, gd.y));
          float gUp = smoothstep(0.5, 0.85, vCausticNormal.y);
          outgoingLight = mix(outgoingLight, vec3(0.42, 1.0, 0.58), gLine * gUp * uGridOpacity);
        }
        #include <opaque_fragment>`,
      );
    },
  };
}

/**
 * คลื่นว่ายน้ำของปลา — ตัวปลาต้องหันหัวไป +Z ยาว 1 หน่วย (หัว z=+0.5, โคนหาง z=-0.5)
 * @param {{uSwimPhase:{value:number}, uSwimAmp:{value:number}}} uniforms uniform เฉพาะของปลาแต่ละตัว
 */
export function createSwimMod(uniforms) {
  return {
    key: 'swim',
    apply(shader) {
      shader.uniforms.uSwimPhase = uniforms.uSwimPhase;
      shader.uniforms.uSwimAmp = uniforms.uSwimAmp;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSwimPhase;\nuniform float uSwimAmp;').replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          float swimT = clamp(0.5 - position.z, 0.0, 1.8);
          float swimEnv = min(swimT * swimT, 1.0 + (swimT - 1.0) * 1.2);
          transformed.x += sin(uSwimPhase - swimT * 4.2) * uSwimAmp * swimEnv;
        }`,
      );
    },
  };
}

/**
 * พืชน้ำโยกไหว — ฐานของโมเดลต้องอยู่ที่ y=0
 * @param {number} unit จำนวนหน่วยในฉากต่อ 1 หน่วยของโมเดล (สำหรับไฟล์ .glb ที่ถูกย่อ/ขยาย)
 */
export function createSwayMod(unit = 1) {
  const uSwayUnit = { value: unit };
  return {
    key: 'sway',
    apply(shader) {
      shader.uniforms.uSwayTime = sharedUniforms.uTime;
      shader.uniforms.uSwayUnit = uSwayUnit;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSwayTime;\nuniform float uSwayUnit;').replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
        {
          float swayH = max(position.y * uSwayUnit, 0.0);
          float swayK = swayH * swayH * 0.022 / uSwayUnit;
          float swayPhase = modelMatrix[3][0] * 0.7 + modelMatrix[3][2] * 0.9;
          transformed.x += sin(uSwayTime * 1.1 + swayPhase + swayH * 0.55) * swayK;
          transformed.z += cos(uSwayTime * 0.85 + swayPhase * 1.3 + swayH * 0.4) * swayK * 0.6;
        }`,
      );
    },
  };
}

export const swayMod = createSwayMod(1);

/**
 * ขาเดินของสัตว์ที่ไม่มีแอนิเมชันในไฟล์ (เช่น ปู) — ใช้กับ mesh ขาแต่ละชุด (ขาซ้าย+ขวาอยู่ใน mesh เดียวกันได้)
 * พิกัดภายใน mesh: x = ซ้าย/ขวา, z = ขึ้น  ขายิ่งห่างจากลำตัว (|x| มาก) ยิ่งขยับมาก
 * ขาแต่ละคู่ยกสลับกัน และฝั่งซ้าย-ขวาสลับจังหวะกัน
 * @param {{uWalkPhase:{value:number}, uWalkAmp:{value:number}}} walk uniform เฉพาะตัว (Fish.js อัปเดตตามความเร็ว)
 * @param {{ leg: number, bodyHalfWidth: number, legReach: number, lift: number, swing: number }} opts leg = ลำดับคู่ขา 0.. หรือ -1 = ก้าม
 */
export function createCrawlMod(walk, { leg, bodyHalfWidth = 1.5, legReach = 4, lift = 0.8, swing = 0.5 }) {
  const own = { uLeg: { value: leg }, uCrawlBody: { value: bodyHalfWidth }, uCrawlReach: { value: legReach }, uCrawlLift: { value: lift }, uCrawlSwing: { value: swing } };
  return {
    key: 'crawl',
    apply(shader) {
      Object.assign(shader.uniforms, own, { uWalkPhase: walk.uWalkPhase, uWalkAmp: walk.uWalkAmp, uCrawlTime: sharedUniforms.uTime });
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nuniform float uWalkPhase;\nuniform float uWalkAmp;\nuniform float uLeg;\nuniform float uCrawlBody;\nuniform float uCrawlReach;\nuniform float uCrawlLift;\nuniform float uCrawlSwing;\nuniform float uCrawlTime;',
        )
        .replace(
          '#include <begin_vertex>',
          /* glsl */ `#include <begin_vertex>
          {
            float side = position.x >= 0.0 ? 1.0 : -1.0;
            float reach = smoothstep(uCrawlBody, uCrawlReach, abs(position.x));
            if (uLeg >= 0.0) {
              float ph = uWalkPhase + uLeg * 1.6 + (side > 0.0 ? 0.0 : 3.14159);
              transformed.z += max(0.0, sin(ph)) * reach * uCrawlLift * uWalkAmp;
              transformed.x += cos(ph) * reach * uCrawlSwing * uWalkAmp * side;
              transformed.z += sin(uCrawlTime * 1.3 + uLeg * 2.1 + side) * 0.05 * reach; // ขยับเบา ๆ แม้ยืนนิ่ง
            } else {
              // ก้าม: ยกขึ้นลงช้า ๆ ซ้ายขวาไม่พร้อมกัน
              float claw = smoothstep(uCrawlBody * 0.4, uCrawlReach * 0.8, abs(position.x) + max(0.0, -position.y - 2.0));
              transformed.z += sin(uCrawlTime * 1.1 + side * 1.7) * 0.2 * claw;
            }
          }`,
        );
    },
  };
}
