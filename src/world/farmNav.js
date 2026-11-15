import * as THREE from 'three';
import { lineClear } from './farmColliders.js';

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
];

export class FarmNav {
  /** @param {ReturnType<import('./farmColliders.js').buildFarmColliders>} colliders @param {number} r รัศมีตัว */
  constructor(colliders, r) {
    this.c = colliders;
    this.r = r;
    this.nodes = NODES.filter(([x, z]) => lineClear(colliders, x, z, x, z, r)).map(([x, z]) => new THREE.Vector3(x, 0, z));
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

  /** เส้นทางจาก from ไป to (ไม่รวมจุดเริ่ม · จุดสุดท้าย = to) — ไปไม่ได้ = null */
  path(from, to) {
    const { c, r, nodes, adj } = this;
    if (lineClear(c, from.x, from.z, to.x, to.z, r)) return [to.clone()];
    const n = nodes.length;
    const startEdges = [];
    const goalEdge = new Map();
    for (let i = 0; i < n; i++) {
      const p = nodes[i];
      if (lineClear(c, from.x, from.z, p.x, p.z, r)) startEdges.push([i, from.distanceTo(p)]);
      if (lineClear(c, p.x, p.z, to.x, to.z, r)) goalEdge.set(i, p.distanceTo(to));
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
