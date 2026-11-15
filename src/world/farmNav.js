import * as THREE from 'three';
import { blockedAt, lineClear } from './farmColliders.js';

/**
 * เส้นทางเดินของคนที่เดินเอง (AI) ในฟาร์ม: จุดผ่าน (waypoint) รอบคอก/ในคอก/โรงนา/บ้าน
 * เชื่อมจุดที่มองเห็นกันเป็นเส้นตรง (ไม่ชนสิ่งกีดขวางใน farmColliders) อัตโนมัติ แล้วหาทางสั้นสุด (Dijkstra)
 * ย้ายของในฉากแล้ว: ถ้าจุดไหนชนของ → จุดนั้นถูกตัดออกเอง (เส้นทางยังหาได้ถ้ามีทางอื่น)
 */
const NODES = [
  // นอกคอก: ทางเดินดินหน้าคอก · ประตูสวนหน้าบ้าน · มุมคอก 4 มุม · ข้างคอกฝั่งบ่อ
  [0, 9.6], [-6, 9.8], [-11.8, 10.4], [-14.3, 10.5], [-11.8, 4], [-13.3, 0], [-13.3, -6],
  [-12.6, -9.6], [12.6, -9.6], [12.6, 9.6], [6, 9.7], [12.8, 0],
  // หลังคอก หน้าโรงนา + ในโรงนา (ทางเดินกลาง)
  [0, -9.2], [-6, -9.3], [6, -9.3], [0, -12.5], [0, -16], [0, -19.5],
  // ในคอก (ประตูหน้า/หลัง + กลางคอก)
  [0, 6.5], [0, -6.5], [-6, 4], [6, 4], [-6, -3], [4.5, -3.2], [0, 0], [-8.5, 0], [8.5, 0],
  // จุดทำกิจกรรม
  [-17.0, 2.7], [7.9, -10.3],
  // แปลงผักข้างบ้าน (ยายเพ็ญ) — อ้อมม้านั่งริมบ่อทางเหนือ
  [-18.6, 2.95], [-19.9, 2.4], [-20.2, 1.5], [-23, 1.4], [-14.6, 7.3],
];

export class FarmNav {
  /** @param {ReturnType<import('./farmColliders.js').buildFarmColliders>} colliders @param {number} r รัศมีตัว */
  constructor(colliders, r, extra = []) {
    this.c = colliders;
    this.r = r;
    this.nodes = [...NODES, ...extra].filter(([x, z]) => lineClear(colliders, x, z, x, z, r)).map(([x, z]) => new THREE.Vector3(x, 0, z));
    const n = this.nodes.length;
    this.adj = Array.from({ length: n }, () => []);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = this.nodes[i];
        const b = this.nodes[j];
        const d = a.distanceTo(b);
        if (d < 16 && lineClear(colliders, a.x, a.z, b.x, b.z, r)) {
          this.adj[i].push([j, d]);
          this.adj[j].push([i, d]);
        }
      }
    }
  }

  /**
   * เส้นทางจาก from ไป to (ไม่รวมจุดเริ่ม · จุดสุดท้าย = to) — ไปไม่ได้ = null
   * จุดเริ่ม/ปลายที่ชิดของจนชน (เช่นหน้าเก้าอี้ในบ้าน) ยอมให้ 0.5 ม. สุดท้ายชนได้
   */
  path(from, to) {
    const { c, r, nodes, adj } = this;
    const SLACK = 0.5;
    const fromIn = blockedAt(c, from.x, from.z, r);
    const toIn = blockedAt(c, to.x, to.z, r);
    // ปลายเส้นที่ชนของ → ตัดช่วงสุดท้ายออกก่อนตรวจ
    const clear = (a, b, aIn, bIn) => {
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d < 1e-4) return !aIn && !bIn;
      const ta = aIn ? Math.min(0.5, SLACK / d) : 0;
      const tb = bIn ? Math.max(0.5, 1 - SLACK / d) : 1;
      return lineClear(c, a.x + (b.x - a.x) * ta, a.z + (b.z - a.z) * ta, a.x + (b.x - a.x) * tb, a.z + (b.z - a.z) * tb, r);
    };
    if (clear(from, to, fromIn, toIn)) return [to.clone()];
    const n = nodes.length;
    const startEdges = [];
    const goalEdge = new Map();
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      if (clear(from, p, fromIn, false)) startEdges.push([i, from.distanceTo(p)]);
      if (clear(p, to, false, toIn)) goalEdge.set(i, p.distanceTo(to));
    }
    // จุดเริ่มติดของ (เช่นถูกวัวดันชิดรั้ว) → เริ่มจากจุดผ่านที่ใกล้สุด
    if (!startEdges.length) {
      let best = 0;
      for (let i = 1; i < n; i++) if (nodes[i].distanceTo(from) < nodes[best].distanceTo(from)) best = i;
      startEdges.push([best, nodes[best].distanceTo(from)]);
    }
    const dist = new Array(n).fill(Infinity);
    const prev = new Array(n).fill(-1);
    const done = new Array(n).fill(false);
    for (const [i, d] of startEdges) dist[i] = d;
    let bestEnd = -1;
    let bestTotal = Infinity;
    for (;;) {
      let u = -1;
      for (let i = 0; i < n; i++) if (!done[i] && dist[i] < Infinity && (u < 0 || dist[i] < dist[u])) u = i;
      if (u < 0 || dist[u] >= bestTotal) break;
      done[u] = true;
      if (goalEdge.has(u) && dist[u] + goalEdge.get(u) < bestTotal) {
        bestTotal = dist[u] + goalEdge.get(u);
        bestEnd = u;
      }
      for (const [v, w] of adj[u]) {
        if (dist[u] + w < dist[v]) {
          dist[v] = dist[u] + w;
          prev[v] = u;
        }
      }
    }
    if (bestEnd < 0) return null;
    const out = [to.clone()];
    for (let u = bestEnd; u >= 0; u = prev[u]) out.unshift(nodes[u].clone());
    return out;
  }
}
