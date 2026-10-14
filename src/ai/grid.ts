/**
 * Spatial hash แบบตาราง 3 มิติ — หาเพื่อนบ้านใกล้ ๆ โดยไม่ต้องวนเทียบปลาทุกคู่ (O(n²) → เกือบ O(n))
 * สร้างใหม่ทุกจังหวะ: เก็บแค่ index ใน array ที่ใช้ซ้ำ ไม่สร้าง object ใหม่
 */
export interface GridItem {
  x: number;
  y: number;
  z: number;
}

export class SpatialGrid<T extends { pos: GridItem }> {
  private readonly size: number;
  private readonly cells = new Map<number, T[]>();
  private readonly pool: T[][] = [];

  constructor(cellSize: number) {
    this.size = cellSize;
  }

  private key(ix: number, iy: number, iz: number): number {
    // ตู้ไม่ใหญ่: ช่องละ 10 บิตพอ (±512 ช่อง)
    return ((ix + 512) << 20) | ((iy + 512) << 10) | (iz + 512);
  }

  clear(): void {
    for (const list of this.cells.values()) {
      list.length = 0;
      this.pool.push(list);
    }
    this.cells.clear();
  }

  insert(item: T): void {
    const s = this.size;
    const k = this.key(Math.floor(item.pos.x / s), Math.floor(item.pos.y / s), Math.floor(item.pos.z / s));
    let list = this.cells.get(k);
    if (!list) {
      list = this.pool.pop() ?? [];
      this.cells.set(k, list);
    }
    list.push(item);
  }

  /**
   * ใส่ทุกตัวในช่องรอบจุด (x,y,z) ที่ครอบคลุมรัศมี radius ลงใน out (ล้างก่อน) — ผู้เรียกกรองระยะจริงเอง
   * ใช้ array out ซ้ำได้ทุกครั้ง ไม่สร้าง object/closure ใหม่
   */
  query(x: number, y: number, z: number, radius: number, out: T[]): T[] {
    out.length = 0;
    const s = this.size;
    const x0 = Math.floor((x - radius) / s);
    const x1 = Math.floor((x + radius) / s);
    const y0 = Math.floor((y - radius) / s);
    const y1 = Math.floor((y + radius) / s);
    const z0 = Math.floor((z - radius) / s);
    const z1 = Math.floor((z + radius) / s);
    for (let ix = x0; ix <= x1; ix++)
      for (let iy = y0; iy <= y1; iy++)
        for (let iz = z0; iz <= z1; iz++) {
          const list = this.cells.get(this.key(ix, iy, iz));
          if (list) for (let i = 0; i < list.length; i++) out.push(list[i]);
        }
    return out;
  }
}
