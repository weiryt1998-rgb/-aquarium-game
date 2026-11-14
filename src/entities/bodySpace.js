import { clamp } from '../utils/math.js';

/**
 * พื้นที่ตัวของวัว/คน ไม่ให้เดินทะลุกัน (ฉากฟาร์ม · ไม่มีระบบฟิสิกส์ — คำนวณเองทุกเฟรม ตัวละครมีไม่กี่ตัว)
 *
 * ตัววัวยาวกว่ากว้าง → แทนด้วยวงกลม 4 วงเรียงตามแนวตัว (ก้น ท้อง อก หัว) ขนาดคูณ scale ของตัวนั้น
 *  1) steer(): ก่อนก้าว — มองไปข้างหน้า ~3 ม. เจอตัวอื่นขวางทาง = เดินตามเส้นสัมผัสอ้อมไป (ยึดฝั่งเดิมจนพ้น) + ชะลอ (ชิดมาก = แทบหยุด)
 *  2) separate(): หลังก้าว — ตัวที่ยังเหลื่อมกัน (เช่น เดินมาจากคนละทาง) ถูกดันแยกออกนุ่ม ๆ
 *     ใครหลบ: ตัวที่นอน/อยู่ในคอกโรงนา/ตาย/อยู่ในฉากผสมพันธุ์ = ไม่ขยับ · ตัวที่เดินตามเส้นทาง (เข้า-ออกโรงนา) มีสิทธิ์ผ่านก่อน
 *     คน (ตาเหม) หลบให้วัวเสมอ · คู่ที่กำลังผสมพันธุ์ไม่ดันกันเอง
 *
 * agent = { group: THREE.Object3D, kind: 'cow' | 'person', fixed: boolean, priority: boolean, partner?: agent ตัวที่ยกเว้น,
 *           bounds?: { minX, maxX, minZ, maxZ } (กันไม่ให้ถูกดันออกนอกรั้ว) }
 */

/** วงกลมของวัวขนาด 1: [ระยะไปข้างหน้าจากจุดกำเนิด (ม.), รัศมี] — วัวบราห์มันยาว ~2.2 ม. (หัว +1.25 · ก้น −0.95) กว้าง ~0.7 ม. */
const COW_CIRCLES = [
  [-0.6, 0.36],
  [0.05, 0.4],
  [0.65, 0.37],
  [1.1, 0.22],
];
const PERSON_RADIUS = 0.28;
/** ระยะมองข้างหน้าตอนเดิน (× ขนาดตัว) */
const LOOK = 3.0;

/** วงกลมของ agent ในพิกัดโลก [{x, z, r}] */
export function circlesOf(agent) {
  const g = agent.group;
  const s = g.scale.x;
  const fx = Math.sin(g.rotation.y);
  const fz = Math.cos(g.rotation.y);
  if (agent.kind === 'person') return [{ x: g.position.x, z: g.position.z, r: PERSON_RADIUS }];
  return COW_CIRCLES.map(([d, r]) => ({ x: g.position.x + fx * d * s, z: g.position.z + fz * d * s, r: r * s }));
}

/** คู่นี้ไม่ต้องกันกัน (ฉากผสมพันธุ์ — ตัวผู้ต้องเข้าไปชิดตัวเมีย) */
const exempt = (a, b) => a === b || a.partner === b || b.partner === a;

/**
 * ทิศเดินที่อ้อมสิ่งกีดขวาง สำหรับ self ที่อยากเดินไปทาง heading (เรเดียน · แกนเดียวกับ rotation.y)
 * เจอตัวขวางทางในระยะมอง → เดินตามเส้นสัมผัสอ้อมตัวนั้น (เลือกฝั่งที่ใกล้ทิศเดิมที่สุด แล้วยึดฝั่งเดิมไว้จนพ้น — ไม่ลังเลซ้ายขวา)
 * ชิดเกินจะอ้อมพ้น = ชะลอแล้วเบี่ยงออกข้าง · คู่ที่ยกเว้น (partner) ไม่ต้องหลบ
 * @returns {{ heading: number, slow: number }}
 */
export function steer(self, others, heading) {
  const g = self.group;
  const person = self.kind === 'person';
  const s = person ? 0.6 : g.scale.x;
  const halfW = (person ? PERSON_RADIUS : 0.4 * s) + 0.2;
  const look = LOOK * s;
  // วัดจากอก (หัวชนก่อนเสมอ) · คนวัดจากกลางตัว
  const front = person ? 0 : 0.65 * s;
  let h = heading;
  let slow = 1;
  for (let pass = 0; pass < 2; pass++) {
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const ox = g.position.x + Math.sin(g.rotation.y) * front;
    const oz = g.position.z + Math.cos(g.rotation.y) * front;
    let hit = null;
    for (const o of others) {
      if (exempt(self, o)) continue;
      for (const c of circlesOf(o)) {
        const rx = c.x - ox;
        const rz = c.z - oz;
        const ahead = rx * fx + rz * fz;
        if (ahead <= 0 || ahead > look + c.r) continue;
        const side = rx * fz - rz * fx; // + = อยู่ทางขวาของทิศเดิน
        const clear = halfW + c.r;
        if (Math.abs(side) >= clear) continue;
        if (!hit || ahead < hit.ahead) hit = { o, rx, rz, ahead, side, clear, r: c.r };
      }
    }
    if (!hit) break;
    const dist = Math.hypot(hit.rx, hit.rz);
    const bearing = Math.atan2(hit.rx, hit.rz);
    // ชิดเกินระยะอ้อม: เบี่ยงเลยตั้งฉากออกไปอีกนิด (110°) ให้ห่างออกก่อน ไม่ใช่เดินเฉียดตัวอีกฝ่ายไปเรื่อย ๆ
    const alpha = dist < hit.clear ? Math.PI / 2 + 0.35 : Math.asin(hit.clear / dist);
    // ฝั่งที่จะอ้อม: จำไว้ต่อสิ่งกีดขวางตัวเดิม · ครั้งแรกเลือกฝั่งที่หักน้อยกว่า (สิ่งกีดขวางอยู่ขวา = อ้อมซ้าย)
    let dir = self.detour?.o === hit.o ? self.detour.dir : hit.side >= 0 ? -1 : 1;
    self.detour = { o: hit.o, dir };
    h = bearing + dir * alpha;
    // อ้อมได้ (เส้นสัมผัสพ้นตัว) = เดินต่อเกือบเต็มความเร็ว · ชิดเกินจะอ้อมพ้น = ชะลอแล้วค่อย ๆ เบี่ยงออกข้าง
    slow = Math.min(slow, dist < hit.clear ? 0.35 : 0.85);
  }
  if (h === heading) self.detour = null;
  return { heading: h, slow };
}

/** ดันตัวที่ยังเหลื่อมกันออกจากกัน (เรียกหลังทุกตัวก้าวแล้ว · 2 รอบพอสำหรับไม่กี่ตัว) */
export function separate(agents, iterations = 2) {
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        const a = agents[i];
        const b = agents[j];
        if (exempt(a, b)) continue;
        const [wa, wb] = shares(a, b);
        if (wa + wb === 0) continue;
        const ca = circlesOf(a);
        const cb = circlesOf(b);
        let px = 0;
        let pz = 0;
        for (const p of ca) {
          for (const q of cb) {
            let dx = p.x - q.x;
            let dz = p.z - q.z;
            let d = Math.hypot(dx, dz);
            const overlap = p.r + q.r - d;
            if (overlap <= 0) continue;
            if (d < 1e-4) {
              dx = 1;
              dz = 0;
              d = 1;
            }
            // ดันเฉพาะส่วนที่ลึกที่สุด (รวมทุกวงจะดันแรงเกินตอนตัวขนานกัน)
            if (overlap > Math.hypot(px, pz)) {
              px = (dx / d) * overlap;
              pz = (dz / d) * overlap;
            }
          }
        }
        if (!px && !pz) continue;
        move(a, px * wa, pz * wa);
        move(b, -px * wb, -pz * wb);
      }
    }
  }
}

/** สัดส่วนการขยับของ a กับ b (รวม = 1 · ทั้งคู่ขยับไม่ได้ = 0, 0) */
function shares(a, b) {
  if (a.fixed && b.fixed) return [0, 0];
  if (a.fixed) return [0, 1];
  if (b.fixed) return [1, 0];
  const pa = a.kind === 'person' ? 0 : a.priority ? 1 : 2;
  const pb = b.kind === 'person' ? 0 : b.priority ? 1 : 2;
  if (pa === pb) return [0.5, 0.5];
  return pa < pb ? [1, 0] : [0, 1]; // ค่าน้อย = หลบให้
}

function move(agent, dx, dz) {
  const p = agent.group.position;
  p.x += dx;
  p.z += dz;
  const b = agent.bounds;
  if (b) {
    p.x = clamp(p.x, b.minX, b.maxX);
    p.z = clamp(p.z, b.minZ, b.maxZ);
  }
}
