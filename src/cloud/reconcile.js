import { EV } from '../core/EventBus.js';
import { SIM_FIELDS } from '../shared/commit.js';
import { cloneData } from '../shared/saveDoc.js';

const EPS = 1e-3;

/** รวม list ของ record ตาม id: ใช้ object เดิมต่อ (entity ในฉากอ้างอิงอยู่) เพิ่มของใหม่ ตัดของที่หายไป */
function mergeRecords(liveList, nextList, update) {
  const byId = new Map(liveList.map((r) => [r.id, r]));
  return nextList.map((src) => {
    const rec = byId.get(src.id);
    if (!rec) return cloneData(src);
    update(rec, src);
    return rec;
  });
}

/**
 * ใส่ข้อมูลล่าสุดจากคลาวด์ (next = ข้อมูลบนคลาวด์ + คำสั่งที่เครื่องนี้ยังไม่ได้บันทึก) ลงเกมที่กำลังเล่น
 *
 * ค่าจำลองต่อเนื่อง (ความหิว สุขภาพ การโต ความสะอาด) ของแต่ละตู้ใช้ตาม adopt[tankId]:
 *   'none'        = คลาวด์ยังไม่มีค่าใหม่กว่าที่เครื่องนี้มี → ใช้ค่าในเครื่องต่อ (ไม่ย้อนเวลา)
 *   'corrections' = ค่าล่าสุดบนคลาวด์มาจากเครื่องนี้เอง → รับเฉพาะค่าที่เซิร์ฟเวอร์ปรับแก้
 *   'all'         = อุปกรณ์อื่นบันทึกค่าที่ใหม่กว่า → รับค่าจากคลาวด์ทั้งหมด
 * ส่วนเงิน ของในคลัง ภารกิจ รายการปลา/ของตกแต่ง ใช้ตาม next เสมอ
 */
export function reconcileGame(game, next, { adopt = {}, server = next, sent = null } = {}) {
  const state = game.state;
  const live = state.data;
  const before = { coins: live.coins, gems: live.gems, inventory: JSON.stringify(live.inventory), collection: JSON.stringify(live.collection) };

  for (const key of ['version', 'coins', 'gems', 'selectedFood', 'dailyRewardDay', 'lastCleanAt', 'lastSaved']) live[key] = next[key];
  live.inventory = { ...next.inventory };
  live.collection = { ...next.collection };
  live.missions = cloneData(next.missions);
  live.stats = { ...next.stats };

  const movingDecorId = game.placement?.state === 'moving' ? game.placement.selected?.id : null;
  const liveTanks = new Map(live.tanks.map((t) => [t.id, t]));
  const serverTanks = new Map(server.tanks.map((t) => [t.id, t]));

  live.tanks = next.tanks.map((nt) => {
    const lt = liveTanks.get(nt.id);
    if (!lt) return cloneData(nt);
    const mode = adopt[nt.id] ?? 'all';
    const st = serverTanks.get(nt.id);
    const sentTank = sent?.tanks?.[nt.id];
    lt.typeId = nt.typeId;
    lt.name = nt.name;
    if (mode === 'all') {
      lt.cleanliness = nt.cleanliness;
      lt.lastUpdate = nt.lastUpdate;
    } else if (mode === 'corrections' && st && sentTank && Math.abs(st.cleanliness - sentTank.cleanliness) > EPS) {
      lt.cleanliness = st.cleanliness;
    }

    const serverFish = new Map((st?.fish ?? []).map((f) => [f.id, f]));
    lt.fish = mergeRecords(lt.fish, nt.fish, (rec, src) => {
      rec.speciesId = src.speciesId;
      rec.name = src.name;
      rec.gender = src.gender;
      const sf = serverFish.get(src.id);
      if (!sf) return; // ปลาที่เพิ่งซื้อ/เกิดในเครื่องนี้และยังไม่ถึงคลาวด์ → ใช้ค่าในเครื่อง
      if (mode === 'all') {
        for (const k of SIM_FIELDS) rec[k] = src[k];
      } else if (mode === 'corrections') {
        const sentFish = sentTank?.fish?.[src.id];
        if (sentFish) for (const k of SIM_FIELDS) if (Math.abs((sf[k] ?? 0) - (sentFish[k] ?? 0)) > EPS) rec[k] = sf[k];
      }
    });

    lt.decor = mergeRecords(lt.decor, nt.decor, (rec, src) => {
      rec.itemId = src.itemId;
      if (rec.id === movingDecorId) return; // กำลังลากอยู่ในเครื่องนี้ — ให้ผลการลากชนะ
      rec.x = src.x;
      rec.z = src.z;
      rec.rotY = src.rotY;
    });
    return lt;
  });

  // ตู้ที่เครื่องนี้ดูอยู่เป็นของเครื่องนี้เอง (อุปกรณ์อื่นสลับตู้ไม่ทำให้เครื่องนี้ย้ายตาม)
  if (!live.tanks.some((t) => t.id === live.activeTankId)) {
    live.activeTankId = live.tanks[0].id;
    game.loadTank(state.activeTank);
  } else if (game.fish && game.decor) {
    const tank = state.activeTank;
    if (game.fish.syncRecords(tank)) game.events.emit(EV.FISH_COUNT, { count: game.fish.count });
    game.decor.syncRecords(tank, { skipId: movingDecorId });
  }

  if (live.coins !== before.coins || live.gems !== before.gems) game.events.emit(EV.CURRENCY, { coins: live.coins, gems: live.gems });
  if (JSON.stringify(live.inventory) !== before.inventory) game.events.emit(EV.INVENTORY, { key: null, count: null });
  if (JSON.stringify(live.collection) !== before.collection) game.events.emit(EV.COLLECTION, { speciesId: null, count: state.collectionCount });
}
