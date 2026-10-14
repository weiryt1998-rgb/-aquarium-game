/**
 * คำนวณ "ความพลิ้ว" ของแต่ละจุดบนโมเดลสัตว์น้ำ (ใช้กับ shader ใน src/render/fishMotion.js)
 *
 * มองโมเดลจากด้านข้าง (ระนาบ y-z) แล้วแบ่งเป็นตาราง:
 *  1. ช่องที่มีความกว้าง (|x| ของจุดในช่องมากพอ) = เนื้อลำตัว — ครีบหลัง ครีบก้น หาง และชายผ้าเป็นแผ่นแบน กว้างน้อย
 *     (ครีบของโมเดล Meshy มีริ้วหนา จึงแยกด้วยความหนาไม่ได้ แต่ยังแบนเมื่อเทียบกับลำตัว)
 *  2. ความพลิ้ว = ระยะ (ในภาพด้านข้าง) จากจุดถึงช่องลำตัวที่ใกล้ที่สุด หารด้วยระยะไกลสุดโดยประมาณ
 *     → ลำตัว/หัว/ผ้าที่พันแนบตัว 0, ปลายครีบยาว ๆ และของที่ห้อยลงมา → 1
 *
 * @param {{ pos: Float32Array, idx: ArrayLike<number> }[]} parts mesh ทุกชิ้น (ตำแหน่งจุด + index สามเหลี่ยม)
 * @param {{ cells?: number, width?: number, open?: number }} options cells = จำนวนช่องตามด้านที่ยาวที่สุด,
 *   width = สัดส่วนความกว้างที่นับเป็นลำตัว, open = ตัดส่วนยื่นที่แคบกว่า 2×open ช่องออกจากลำตัว (0 = ไม่ตัด)
 * @returns {Float32Array[]} ค่าความพลิ้ว 0..1 ของแต่ละชิ้น
 */
export function computeFlex(parts, { cells = 72, width = 0.3, open = 0 } = {}) {
  const all = parts.flatMap((p) => Array.from({ length: p.pos.length / 3 }, (_, i) => [p.pos[3 * i], p.pos[3 * i + 1], p.pos[3 * i + 2]]));
  const lo = [0, 1, 2].map((a) => Math.min(...all.map((p) => p[a])));
  const hi = [0, 1, 2].map((a) => Math.max(...all.map((p) => p[a])));
  const cx = (lo[0] + hi[0]) / 2;
  const size = Math.max(hi[1] - lo[1], hi[2] - lo[2]);
  const cell = size / cells;
  const NY = Math.ceil((hi[1] - lo[1]) / cell) + 1;
  const NZ = Math.ceil((hi[2] - lo[2]) / cell) + 1;
  const cy = (y) => Math.min(NY - 1, Math.floor((y - lo[1]) / cell));
  const cz = (z) => Math.min(NZ - 1, Math.floor((z - lo[2]) / cell));

  // ความกว้างสูงสุดของแต่ละช่อง: วาดสามเหลี่ยมทุกรูปลงตารางด้านข้าง (ไม่มีช่องโหว่ระหว่างจุดยอด)
  const wide = new Float32Array(NY * NZ);
  let base = 0;
  for (const p of parts) {
    const v = (i) => all[base + i];
    for (let t = 0; t < p.idx.length; t += 3) {
      const [a, b, c] = [v(p.idx[t]), v(p.idx[t + 1]), v(p.idx[t + 2])];
      const w = Math.max(Math.abs(a[0] - cx), Math.abs(b[0] - cx), Math.abs(c[0] - cx));
      const det = (b[2] - a[2]) * (c[1] - a[1]) - (c[2] - a[2]) * (b[1] - a[1]);
      for (let y = cy(Math.min(a[1], b[1], c[1])); y <= cy(Math.max(a[1], b[1], c[1])); y++)
        for (let z = cz(Math.min(a[2], b[2], c[2])); z <= cz(Math.max(a[2], b[2], c[2])); z++) {
          const k = y * NZ + z;
          if (wide[k] >= w) continue;
          // จุดกึ่งกลางช่องอยู่ในสามเหลี่ยม (หรือสามเหลี่ยมเล็กกว่าช่อง)
          const py = lo[1] + (y + 0.5) * cell;
          const pz = lo[2] + (z + 0.5) * cell;
          const u = ((pz - a[2]) * (c[1] - a[1]) - (c[2] - a[2]) * (py - a[1])) / det;
          const s = ((b[2] - a[2]) * (py - a[1]) - (pz - a[2]) * (b[1] - a[1])) / det;
          const inside = Math.abs(det) < 1e-12 || (u >= -0.01 && s >= -0.01 && u + s <= 1.01);
          const tiny = cy(Math.min(a[1], b[1], c[1])) === cy(Math.max(a[1], b[1], c[1])) && cz(Math.min(a[2], b[2], c[2])) === cz(Math.max(a[2], b[2], c[2]));
          if (inside || tiny) wide[k] = w;
        }
    }
    base += p.pos.length / 3;
  }
  const sortedX = all.map((p) => Math.abs(p[0] - cx)).sort((a, b) => a - b);
  const threshold = width * sortedX[Math.floor(sortedX.length * 0.98)];
  let body = Array.from(wide, (w) => w >= threshold);
  // ปิดรู: ช่องที่ล้อมด้วยลำตัวเกือบรอบให้เป็นลำตัว (จุดบนผิวโมเดลกระจายไม่ทั่วทุกช่อง)
  for (let pass = 0; pass < 2; pass++) {
    body = body.map((b, k) => {
      if (b) return true;
      const y = Math.floor(k / NZ);
      const z = k % NZ;
      let n = 0;
      for (const [dy, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (body[(y + dy) * NZ + (z + dz)] && y + dy >= 0 && y + dy < NY && z + dz >= 0 && z + dz < NZ) n++;
      return n >= 3;
    });
  }

  /** ระยะ (หน่วยช่อง) จากทุกช่องถึงช่องที่ mask เป็นจริงที่ใกล้ที่สุด */
  const distanceTo = (mask) => {
    const list = [];
    mask.forEach((b, k) => b && list.push([Math.floor(k / NZ), k % NZ]));
    const out = new Float32Array(NY * NZ);
    for (let y = 0; y < NY; y++)
      for (let z = 0; z < NZ; z++) {
        if (mask[y * NZ + z]) continue;
        let best = Infinity;
        for (const [by, bz] of list) best = Math.min(best, (by - y) ** 2 + (bz - z) ** 2);
        out[y * NZ + z] = Math.sqrt(best);
      }
    return out;
  };

  // ตัดส่วนยื่นที่เป็นแถบแคบ (ครีบ/ชายผ้าที่แผ่ออกด้านข้างจนดูกว้าง) ออกจากลำตัว: กร่อนเข้าไป open ช่องแล้วขยายกลับ
  if (open > 0) {
    const core = Array.from(distanceTo(body.map((b) => !b)), (d) => d > open);
    const back = distanceTo(core);
    body = core.map((c, k) => c || back[k] <= open);
  }

  // ระยะจากทุกช่องถึงช่องลำตัวที่ใกล้ที่สุด
  const distCell = distanceTo(body).map((d) => d * cell);

  // อ่านค่าแบบ bilinear จากกึ่งกลางช่อง → ค่าความพลิ้วต่อเนื่อง ไม่เป็นขั้นบันไดตามช่อง
  const at = (y, z) => distCell[Math.min(NY - 1, Math.max(0, y)) * NZ + Math.min(NZ - 1, Math.max(0, z))];
  const dist = all.map((p) => {
    const fy = (p[1] - lo[1]) / cell - 0.5;
    const fz = (p[2] - lo[2]) / cell - 0.5;
    const y0 = Math.floor(fy);
    const z0 = Math.floor(fz);
    const ty = fy - y0;
    const tz = fz - z0;
    return (at(y0, z0) * (1 - tz) + at(y0, z0 + 1) * tz) * (1 - ty) + (at(y0 + 1, z0) * (1 - tz) + at(y0 + 1, z0 + 1) * tz) * ty;
  });
  const sorted = dist.filter((d) => d > 0).sort((a, b) => a - b);
  const range = sorted[Math.floor(sorted.length * 0.97)] || 1;

  let offset = 0;
  return parts.map((p) => {
    const n = p.pos.length / 3;
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) out[i] = Math.min(1, dist[offset + i] / range);
    offset += n;
    return out;
  });
}
