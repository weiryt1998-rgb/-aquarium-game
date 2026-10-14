import * as THREE from 'three';

/**
 * ขยับโครงกระดูกด้วยโค้ด สำหรับโมเดลที่มีกระดูกแต่ไม่มีคลิปแอนิเมชัน (เช่นม้าน้ำจาก Meshy AI)
 * แปลงไฟล์ด้วย scripts/build-model.mjs --fish --keep-skin แล้วตั้ง model.rig ใน src/data/fish.js:
 *
 *   rig: { tail: 'Bone_016', head: 'Bone_025', fins: ['Bone_018', 'Bone_020'] }
 *     tail/head = กระดูกข้อแรกของสาย (ไล่ลงไปตามลูกข้อแรกจนสุด)  fins = กระดูกโคนครีบแต่ละข้าง
 *
 * ทิศอ้างอิงเป็นของตัวโมเดล: หน้า +Z, หลัง +Y, ข้าง X — ข้อกระดูกแต่ละข้อหมุนรอบแกนเหล่านี้
 * (คิดแกนในพิกัดของกระดูกแต่ละข้อไว้ตอนสร้าง เพราะ rig อัตโนมัติวางทิศกระดูกไม่เหมือนกัน)
 *
 * ท่าม้าน้ำ:
 *  - หาง: ม้วนเข้าออกช้า ๆ เป็นคลื่นจากโคนไปปลาย + แกว่งซ้ายขวาเบา ๆ  ว่ายเร็วแล้วหางคลายตรงขึ้นเล็กน้อย
 *  - คอ/หัว: พยักช้า ๆ และหันตามทิศที่เลี้ยว
 *  - ครีบ: กระพือถี่ (ถี่และกว้างขึ้นเมื่อว่ายเร็ว) ซ้ายขวาสมมาตรกัน
 */

const AXES = [new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)];
const _q = new THREE.Quaternion();
const _r = new THREE.Quaternion();

/** สายกระดูกจากข้อแรก ไล่ตามลูกที่เป็นกระดูกข้อแรกจนสุด */
function chain(first) {
  const out = [];
  for (let b = first; b; b = b.children.find((c) => c.isBone)) out.push(b);
  return out;
}

/** ข้อมูลของกระดูก 1 ข้อ: ท่าพัก + แกน X/Y/Z ของตัวโมเดลในพิกัดของกระดูกข้อนี้ */
function joint(bone) {
  const world = bone.getWorldQuaternion(new THREE.Quaternion()).invert();
  return { bone, rest: bone.quaternion.clone(), axes: AXES.map((a) => a.clone().applyQuaternion(world)) };
}

/** หมุนข้อกระดูกจากท่าพัก รอบแกน X, Y, Z ของตัวโมเดล (เรเดียน) */
function pose(j, ax, ay, az) {
  _q.copy(j.rest);
  if (ax) _q.multiply(_r.setFromAxisAngle(j.axes[0], ax));
  if (ay) _q.multiply(_r.setFromAxisAngle(j.axes[1], ay));
  if (az) _q.multiply(_r.setFromAxisAngle(j.axes[2], az));
  j.bone.quaternion.copy(_q);
}

/**
 * @param {THREE.Object3D} scene โมเดลที่เพิ่ง instantiate (ยังไม่ถูกย่อ/หมุน — ใช้ทิศของตัวโมเดลเป็นแกนอ้างอิง)
 * @param {{ tail?: string, head?: string, fins?: string[] }} spec
 * @returns {{ update(dt: number, speedRatio: number, turn: number): void } | null}
 */
export function createBoneRig(scene, spec) {
  scene.updateMatrixWorld(true);
  const find = (name) => (name ? scene.getObjectByName(name) : null);
  const tail = chain(find(spec.tail)).map(joint);
  const head = chain(find(spec.head)).map(joint);
  const fins = (spec.fins ?? []).map((name) => chain(find(name)).map(joint));
  if (!tail.length && !head.length && !fins.length) return null;

  let t = Math.random() * 100;
  let speed = 0;
  return {
    update(dt, speedRatio, turn) {
      t += dt;
      speed += (Math.min(speedRatio, 1.5) - speed) * (1 - Math.exp(-3 * dt));
      tail.forEach((j, i) => {
        const k = (i + 1) / tail.length; // ปลายหางขยับมากกว่าโคน
        const curl = 0.1 * Math.sin(t * 0.7 - i * 0.32) * (0.4 + k) - 0.03 * speed * k;
        const sway = 0.05 * Math.sin(t * 0.9 - i * 0.25) * k - turn * 0.04 * k;
        pose(j, curl, 0, sway);
      });
      head.forEach((j, i) => pose(j, 0.025 * Math.sin(t * 0.8 + 2 - i * 0.3), turn * 0.05, 0.01 * Math.sin(t * 0.6 + i)));
      const flap = (0.18 + 0.25 * speed) * Math.sin(t * (16 + 10 * speed));
      fins.forEach((side, s) =>
        side.forEach((j, i) => {
          const lag = (0.3 + 0.25 * speed) * Math.sin(t * (16 + 10 * speed) - 1.2 * (i + 1));
          pose(j, 0, (s ? -1 : 1) * (i ? lag : flap), 0);
        }),
      );
    },
  };
}
