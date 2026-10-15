import { CONFIG } from '../config.js';
import { EV } from '../core/EventBus.js';
import { getSpecies } from '../data/fish.js';
import { getDecorItem } from '../data/decor.js';
import { CARE_ITEMS, getFood } from '../data/food.js';
import { MISSIONS } from '../data/missions.js';
import { TANK_TYPES, getTankType, tankTier } from '../data/tanks.js';
import { clamp } from '../utils/math.js';
import { FEED_WINDOW_MS, LIMITS } from './constants.js';
import { breedGroupOf, dueAt, isPregnant, planOffspring, restEndsAt, sanitizeFetus } from './breeding.js';
import { sanitizeGenes } from '../models/molly/genetics.js';
import {
  addItem,
  atDecorLimit,
  bumpMissions,
  cleanName,
  coinBankCap,
  decorSellValue,
  earn,
  ensureMissionDay,
  fail,
  findDecorAnywhere,
  findFishAnywhere,
  fishSellValue,
  isInsideTank,
  isNum,
  maxCoinRate,
  maxGrowthIn,
  missionProgress,
  needId,
  needInt,
  needItemSpace,
  needNum,
  needTank,
  offlineCoins,
  offlineSeconds,
  pearlReadyAt,
  spend,
  tankMeta,
  useItem,
} from './economy.js';

/**
 * คำสั่ง (command) = การกระทำของผู้เล่นที่มีผลกับเซฟกลาง เช่น ซื้อปลา ขายของ เก็บเหรียญ รับรางวัล
 *
 * applyCommand(game, meta, cmd, ctx) ตรวจความถูกต้องก่อนแล้วจึงแก้ข้อมูล — ถ้าไม่ผ่านจะ throw CommandError
 * โดยไม่แก้อะไรเลย ฟังก์ชันชุดนี้รัน 2 ที่:
 *   - เซิร์ฟเวอร์ (Cloud Functions): ctx.predict = false → ตรวจเต็มรูปแบบด้วยเวลาของเซิร์ฟเวอร์
 *   - หน้าเว็บ: ctx.predict = true → ใช้ "เล่นซ้ำ" คำสั่งที่ยังไม่ถูกบันทึกบนข้อมูลล่าสุดจากคลาวด์
 *     (ไม่ใช้เพดานที่ต้องอาศัยเวลาเซิร์ฟเวอร์ เพื่อให้ผลตรงกับที่เกมคำนวณไปแล้วในเครื่อง)
 *
 * ctx = { now, day, writer, predict, simTouched:Set<tankId> }
 */

/** ข้อมูลปลาตัวใหม่: ค่าที่สุ่มในเครื่อง (id ชื่อ เพศ) รับจากคำสั่ง ส่วนค่าสถานะเริ่มต้นกำหนดฝั่งนี้ */
function newFishRecord(game, species, input, { growth, satiety, genes = null }) {
  const id = needId(input?.id, 'fish.id');
  if (findFishAnywhere(game, id)) fail('invalid', 'duplicate-id');
  if (input.gender !== 'm' && input.gender !== 'f') fail('invalid', 'gender');
  const eco = species.economy;
  return {
    id,
    speciesId: species.id,
    name: cleanName(input.name, species.name),
    gender: input.gender,
    satiety,
    health: 100,
    growth,
    age: 0,
    breedCooldown: isNum(input.breedCooldown) ? clamp(input.breedCooldown, 30, 90) : 60,
    coinTimer: isNum(input.coinTimer) ? clamp(input.coinTimer, 0, eco.coinInterval) : eco.coinInterval / 2,
    ...(genes ? { genes } : {}),
  };
}

function needFish(tank, fishId) {
  return tank.fish.find((f) => f.id === fishId) ?? fail('not-found', 'fish');
}

/** พ่อแม่ที่ผสมพันธุ์ได้: ตัวผู้ + ตัวเมีย กลุ่มพันธุ์เดียวกัน (ปลาสอดต่างสีได้) ในตู้เดียวกัน โตเต็มวัย และเว้นระยะตามเวลาจริง */
function needParents(tank, meta, c, ctx) {
  const [dadId, momId] = Array.isArray(c.parents) ? c.parents : [];
  const dad = needFish(tank, dadId);
  const mom = needFish(tank, momId);
  const species = getSpecies(dad.speciesId) ?? fail('invalid', 'species');
  const momSpecies = getSpecies(mom.speciesId) ?? fail('invalid', 'species');
  if (dad === mom || breedGroupOf(species) !== breedGroupOf(momSpecies) || dad.gender !== 'm' || mom.gender !== 'f') fail('invalid', 'parents');
  const tm = tankMeta(meta, tank.id);
  tm.bredAt ??= {};
  if (!ctx.predict) {
    const slack = maxGrowthIn(species, simSecondsSince(tank, meta, ctx.now)) + 0.01;
    if (dad.growth + slack < 1 || mom.growth + slack < 1) fail('invalid', 'not-adult');
    const minGap = ((CONFIG.breeding.cooldown / CONFIG.timeScale) * 1000) / 2;
    if (ctx.now - (tm.bredAt[dad.id] ?? 0) < minGap || ctx.now - (tm.bredAt[mom.id] ?? 0) < minGap) fail('cooldown', 'breeding');
  }
  return { dad, mom, species, tm };
}

/**
 * คำสั่งออกลูกแบบเก่า (ก่อนมีการตั้งท้อง: ส่ง parents มาแล้วเกิดทันที)
 * เก็บไว้ให้คำสั่งที่ค้างอยู่ในเครื่องจากเวอร์ชันก่อนยังบันทึกได้
 */
function legacyBirth(game, meta, tank, c, ctx) {
  const { dad, mom, species, tm } = needParents(tank, meta, c, ctx);
  if (tank.fish.length >= getTankType(tank.typeId).capacity) fail('tank-full');
  const record = newFishRecord(game, species, c.fish, { growth: 0, satiety: 60 });
  tank.fish.push(record);
  dad.breedCooldown = mom.breedCooldown = CONFIG.breeding.cooldown;
  tm.bredAt[dad.id] = tm.bredAt[mom.id] = ctx.now;
  game.stats.fishBorn += 1;
  bumpMissions(game, EV.FISH_BORN, 1, ctx.day);
  ctx.simTouched?.add(tank.id);
  return null;
}

function needDecor(tank, decorId) {
  return tank.decor.find((d) => d.id === decorId) ?? fail('not-found', 'decor');
}

/** วินาทีจำลองตั้งแต่ตู้ถูกบันทึกค่าสถานะครั้งล่าสุด */
function simSecondsSince(tank, meta, now) {
  const since = meta.tanks?.[tank.id]?.simAt ?? tank.lastUpdate ?? now;
  return (Math.max(0, now - since) / 1000) * CONFIG.timeScale;
}

/** ค่าการเติบโตที่เชื่อได้: ค่าจากเครื่องต้องไม่น้อยกว่าบนเซิร์ฟเวอร์ และไม่มากกว่าที่โตได้จริงในเวลาที่ผ่านไป */
function trustedGrowth(fish, species, claimed, tank, meta, ctx) {
  if (!isNum(claimed)) return fish.growth;
  if (ctx.predict) return clamp(claimed, 0, 1);
  const max = Math.min(1, fish.growth + maxGrowthIn(species, simSecondsSince(tank, meta, ctx.now)) + 0.01);
  return clamp(claimed, fish.growth, max);
}

function needPosition(tank, item, c) {
  const x = needNum(c.x, 'x');
  const z = needNum(c.z, 'z');
  const rotY = needNum(c.rotY ?? 0, 'rotY');
  if (Math.abs(rotY) > 1e6) fail('invalid', 'rotY');
  if (!isInsideTank(tank, item, x, z)) fail('invalid', 'outside-tank');
  return { x, z, rotY };
}

const HANDLERS = {
  // ── ปลา ────────────────────────────────────────────────────
  buyFish(game, meta, c, ctx) {
    const tank = needTank(game, c.tankId);
    const species = getSpecies(c.speciesId) ?? fail('invalid', 'species');
    if (species.retired || species.notForSale) fail('invalid', 'not-for-sale'); // เลิกขายแล้ว / ได้จากการผสมพันธุ์เท่านั้น
    const type = getTankType(tank.typeId);
    if (tank.fish.length >= type.capacity) fail('tank-full');
    if (tankTier(type.id) < species.minTank) fail('tank-too-small');
    const record = newFishRecord(game, species, c.fish, { growth: 0.6, satiety: 70 });
    spend(game, species.price);
    tank.fish.push(record);
    game.collection[species.id] = true;
    game.stats.fishBought += 1;
    bumpMissions(game, EV.FISH_BOUGHT, 1, ctx.day);
  },

  sellFish(game, meta, c, ctx) {
    const tank = needTank(game, c.tankId);
    const fish = needFish(tank, c.fishId);
    const species = getSpecies(fish.speciesId);
    const refund = species ? fishSellValue(species, trustedGrowth(fish, species, c.growth, tank, meta, ctx)) : { coins: 0, gems: 0 };
    tank.fish = tank.fish.filter((f) => f !== fish);
    earn(game, refund);
    return { refund };
  },

  /**
   * ผสมพันธุ์: ต้องเป็นตัวผู้กับตัวเมียชนิดเดียวกันในตู้เดียวกัน โตเต็มวัยทั้งคู่ และพ้นระยะพักการผสมพันธุ์
   * ผล: ตัวเมียตั้งท้อง (pregnantAt) ครบ CONFIG.breeding.gestation แล้วจึงคลอดได้ (คำสั่ง fishBorn)
   */
  fishMated(game, meta, c, ctx) {
    const tank = needTank(game, c.tankId);
    const { dad, mom, tm } = needParents(tank, meta, c, ctx);
    if (isPregnant(mom)) fail('invalid', 'already-pregnant');
    // ตัวเมียพักฟื้นหลังคลอด (เผื่อนาฬิกาต่างกัน 3 วินาที)
    if (!ctx.predict && ctx.now < restEndsAt(mom) - 3000) fail('cooldown', 'resting');
    // นับการตั้งท้องจากเวลาที่เกิดในเครื่อง (คำสั่งอาจถูกส่งช้าตอนออฟไลน์) แต่ไม่ล้ำอนาคตและไม่เก่ากว่าหนึ่งสัปดาห์
    mom.pregnantAt = Math.round(clamp(isNum(c.at) ? c.at : ctx.now, ctx.now - 7 * 86_400_000, ctx.now));
    // ลูกในท้อง (สายพันธุ์ + ยีนสี) สุ่มในเครื่องที่ผสมพันธุ์ ตรวจรูปแบบที่นี่ (คำสั่งจากเวอร์ชันเก่าที่ไม่มี fetus → สุ่มให้)
    mom.fetus = sanitizeFetus(c.fetus, mom, dad) ?? planOffspring(mom, dad);
    dad.breedCooldown = CONFIG.breeding.cooldown;
    tm.bredAt[dad.id] = tm.bredAt[mom.id] = ctx.now;
    ctx.simTouched?.add(tank.id);
  },

  /** ตัวเมียที่ตั้งท้องครบกำหนดคลอดลูก 1 ตัว แล้วพักฟื้น (ตัวพ่อไม่ต้องอยู่ในตู้แล้วก็ได้) */
  fishBorn(game, meta, c, ctx) {
    const tank = needTank(game, c.tankId);
    if (!c.motherId) return legacyBirth(game, meta, tank, c, ctx);
    const mom = needFish(tank, c.motherId);
    if (!isPregnant(mom)) fail('invalid', 'not-pregnant');
    // ลูกเป็นไปตามที่กำหนดไว้ตอนตั้งท้อง (ตั้งท้องก่อนมีระบบผสมสี = สายพันธุ์เดียวกับแม่)
    const species = getSpecies(mom.fetus?.speciesId) ?? getSpecies(mom.speciesId) ?? fail('invalid', 'species');
    if (tank.fish.length >= getTankType(tank.typeId).capacity) fail('tank-full');
    if (!ctx.predict && ctx.now < dueAt(mom) - 3000) fail('cooldown', 'pregnancy');
    const record = newFishRecord(game, species, c.fish, { growth: 0, satiety: 60, genes: sanitizeGenes(mom.fetus?.genes) });
    tank.fish.push(record);
    game.collection[species.id] = true;
    delete mom.pregnantAt;
    delete mom.fetus;
    mom.breedCooldown = CONFIG.breeding.cooldown;
    // นับพักฟื้นจากเวลาที่คลอดในเครื่อง (คำสั่งอาจถูกส่งช้า) แต่ไม่ล้ำอนาคตและไม่เก่ากว่าหนึ่งสัปดาห์
    mom.lastBirthAt = Math.round(clamp(isNum(c.at) ? c.at : ctx.now, ctx.now - 7 * 86_400_000, ctx.now));
    game.stats.fishBorn += 1;
    bumpMissions(game, EV.FISH_BORN, 1, ctx.day);
    ctx.simTouched?.add(tank.id);
  },

  /** ปลาตาย (ไม่มีผลได้ทางเศรษฐกิจ จึงเชื่อได้) */
  fishDied(game, meta, c) {
    const tank = needTank(game, c.tankId);
    const fish = needFish(tank, c.fishId);
    tank.fish = tank.fish.filter((f) => f !== fish);
    if (meta.tanks?.[tank.id]?.bredAt) delete meta.tanks[tank.id].bredAt[fish.id];
  },

  renameFish(game, meta, c) {
    const fish = needFish(needTank(game, c.tankId), c.fishId);
    fish.name = cleanName(c.name, getSpecies(fish.speciesId)?.name ?? fish.name);
  },

  // ── อาหาร / ดูแล ───────────────────────────────────────────
  buyFood(game, meta, c) {
    const food = getFood(c.foodId) ?? fail('invalid', 'food');
    needItemSpace(game, food.id, food.pack);
    spend(game, food.price);
    addItem(game, food.id, food.pack);
  },

  feed(game, meta, c, ctx) {
    const tank = needTank(game, c.tankId);
    const food = getFood(c.foodId) ?? fail('invalid', 'food');
    useItem(game, food.id, 1);
    game.stats.feeds += 1;
    bumpMissions(game, EV.FEED, 1, ctx.day);
    const tm = tankMeta(meta, tank.id);
    const previousBudget = ctx.now - (tm.lastFedAt ?? -Infinity) <= FEED_WINDOW_MS ? (tm.foodHealthBudget ?? 0) : 0;
    tm.foodHealthBudget = previousBudget + food.health * CONFIG.feed.pelletsPerSprinkle;
    tm.lastFedAt = ctx.now;
  },

  selectFood(game, meta, c) {
    game.selectedFood = (getFood(c.foodId) ?? fail('invalid', 'food')).id;
  },

  buyMedicine(game) {
    const item = CARE_ITEMS.find((x) => x.id === 'medicine');
    needItemSpace(game, 'medicine', 1);
    spend(game, item.price);
    addItem(game, 'medicine', 1);
  },

  useMedicine(game, meta, c, ctx) {
    const tank = needTank(game, c.tankId);
    useItem(game, 'medicine', 1);
    for (const f of tank.fish) f.health = Math.min(100, f.health + CONFIG.care.medicineHeal);
    tankMeta(meta, tank.id).lastMedAt = ctx.now;
    ctx.simTouched?.add(tank.id);
  },

  cleanTank(game, meta, c, ctx) {
    const tank = needTank(game, c.tankId);
    // เผื่อนาฬิกาเครื่องกับเซิร์ฟเวอร์ต่างกันเล็กน้อย 3 วินาที
    if (!ctx.predict && ctx.now - (game.lastCleanAt ?? 0) < CONFIG.care.cleanCooldown * 1000 - 3000) fail('cooldown', 'clean');
    tank.cleanliness = 100;
    game.lastCleanAt = ctx.now;
    bumpMissions(game, EV.TANK_CLEANED, 1, ctx.day);
    ctx.simTouched?.add(tank.id);
  },

  // ── ตู้ ────────────────────────────────────────────────────
  buyTank(game, meta, c, ctx) {
    const type = getTankType(c.typeId) ?? fail('invalid', 'tank-type');
    if (game.tanks.some((t) => t.typeId === type.id)) fail('already-owned');
    if (game.tanks.length >= TANK_TYPES.length) fail('limit');
    const id = needId(c.tankId, 'tankId');
    if (game.tanks.some((t) => t.id === id)) fail('invalid', 'duplicate-id');
    spend(game, type.price);
    game.tanks.push({ id, typeId: type.id, name: type.name, cleanliness: 100, fish: [], decor: [], lastUpdate: ctx.now });
    bumpMissions(game, EV.TANK_UNLOCKED, 1, ctx.day);
  },

  /** ตู้ที่เปิดล่าสุด (อุปกรณ์อื่นใช้เป็นค่าเริ่มต้นตอนเข้าเกม ไม่บังคับย้ายตู้ของเครื่องที่เล่นอยู่) */
  switchTank(game, meta, c) {
    game.activeTankId = needTank(game, c.tankId).id;
  },

  // ── ของตกแต่ง ──────────────────────────────────────────────
  placeDecor(game, meta, c, ctx) {
    const tank = needTank(game, c.tankId);
    const input = c.decor ?? fail('invalid', 'decor');
    const item = getDecorItem(input.itemId) ?? fail('invalid', 'item');
    const id = needId(input.id, 'decor.id');
    if (findDecorAnywhere(game, id)) fail('invalid', 'duplicate-id');
    if (tank.decor.length >= LIMITS.decorPerTank || atDecorLimit(tank, item)) fail('limit');
    const pos = needPosition(tank, item, input);
    spend(game, item.price);
    // หอยเริ่มแบบปิดฝา: นับเวลาไข่มุกจากตอนวาง (เวลาฝั่งที่ตรวจ ไม่ใช้ค่าที่เครื่องส่งมา)
    tank.decor.push(item.pearl ? { id, itemId: item.id, ...pos, pearlAt: ctx.now } : { id, itemId: item.id, ...pos });
    bumpMissions(game, EV.DECOR_PLACED, 1, ctx.day);
  },

  moveDecor(game, meta, c) {
    const tank = needTank(game, c.tankId);
    const decor = needDecor(tank, c.decorId);
    const item = getDecorItem(decor.itemId) ?? fail('invalid', 'item');
    Object.assign(decor, needPosition(tank, item, c));
  },

  sellDecor(game, meta, c) {
    const tank = needTank(game, c.tankId);
    const decor = needDecor(tank, c.decorId);
    const item = getDecorItem(decor.itemId);
    tank.decor = tank.decor.filter((d) => d !== decor);
    const refund = item ? decorSellValue(item) : { coins: 0, gems: 0 };
    earn(game, refund);
    return { refund };
  },

  // ── รายได้ ────────────────────────────────────────────────
  /**
   * เหรียญที่เก็บจากปลา (รวมหลายเหรียญเป็นคำสั่งเดียว)
   * เซิร์ฟเวอร์จำกัดด้วย "ธนาคารเหรียญ" ต่อตู้ ที่เติมตามอัตราผลิตสูงสุดของปลาในตู้ตามเวลาจริง
   * → แก้ตัวเลขในเครื่องหรือเปิดหลายเครื่องพร้อมกันก็ได้เหรียญไม่เกินที่ปลาผลิตได้จริง
   */
  collectCoins(game, meta, c, ctx) {
    const tank = needTank(game, c.tankId);
    const value = needInt(c.value, 1, LIMITS.maxCoins, 'value');
    const count = needInt(c.count, 1, value, 'count'); // เหรียญละอย่างน้อย 1
    let accepted = value;
    if (!ctx.predict) {
      const tm = tankMeta(meta, tank.id);
      const cap = coinBankCap(tank);
      const bank = tm.incomeAt == null ? cap : Math.min(cap, (tm.incomeBank ?? 0) + (maxCoinRate(tank) * Math.max(0, ctx.now - tm.incomeAt)) / 1000);
      accepted = Math.min(value, Math.floor(bank));
      tm.incomeBank = bank - accepted;
      tm.incomeAt = ctx.now;
    }
    const acceptedCount = accepted === value ? count : Math.min(count, Math.floor((count * accepted) / value));
    earn(game, { coins: accepted });
    game.stats.coinsCollected += acceptedCount;
    if (acceptedCount > 0) bumpMissions(game, EV.COIN_COLLECTED, acceptedCount, ctx.day);
    return accepted < value ? { accepted, requested: value } : null;
  },

  /** เก็บไข่มุกจากหอย: ได้เมื่อครบเวลาตั้งแต่วาง/เก็บครั้งก่อน (เผื่อนาฬิกาต่างกัน 3 วินาทีเหมือนทำความสะอาดตู้) */
  collectPearl(game, meta, c, ctx) {
    const tank = needTank(game, c.tankId);
    const decor = needDecor(tank, c.decorId);
    const item = getDecorItem(decor.itemId);
    if (!item?.pearl) fail('invalid', 'not-pearl');
    if (!ctx.predict && ctx.now < pearlReadyAt(decor, item) - 3000) fail('cooldown', 'pearl');
    decor.pearlAt = ctx.now;
    earn(game, item.pearl.reward);
    return { reward: item.pearl.reward };
  },

  /** แลกเหรียญเป็นเพชร ตามอัตรา CONFIG.exchange.coinsPerGem (หักเหรียญตามจำนวนจริงบนเซฟ ไม่เชื่อตัวเลขจากเครื่อง) */
  exchangeGems(game, meta, c) {
    const gems = needInt(c.gems, 1, LIMITS.maxExchangeGems, 'gems');
    if (game.gems + gems > LIMITS.maxGems) fail('limit', 'gems');
    spend(game, { coins: gems * CONFIG.exchange.coinsPerGem });
    earn(game, { gems });
    return { gems };
  },

  /** เหรียญช่วงออฟไลน์: เซิร์ฟเวอร์คำนวณเองจากเวลาที่ตู้ถูกจำลองครั้งล่าสุด ไม่รับตัวเลขจากเครื่อง */
  offlineIncome(game, meta, c, ctx) {
    const tank = needTank(game, c.tankId);
    const tm = tankMeta(meta, tank.id);
    const since = Math.max(tank.lastUpdate ?? ctx.now, tm.offlineAt ?? 0);
    tm.offlineAt = ctx.now;
    const seconds = offlineSeconds(since, ctx.now);
    const coins = seconds < 5 ? 0 : offlineCoins(tank, seconds);
    if (coins > 0) earn(game, { coins });
    return { coins };
  },

  // ── ภารกิจ / รางวัล ────────────────────────────────────────
  claimMission(game, meta, c, ctx) {
    const mission = MISSIONS.find((m) => m.id === c.missionId) ?? fail('invalid', 'mission');
    ensureMissionDay(game, ctx.day);
    if (game.missions.claimed[mission.id]) fail('already-claimed');
    if (missionProgress(game, mission) < mission.target) fail('not-complete');
    game.missions.claimed[mission.id] = true;
    earn(game, mission.reward);
    return { reward: mission.reward };
  },

  claimDaily(game, meta, c, ctx) {
    if (game.dailyRewardDay === ctx.day) fail('already-claimed');
    game.dailyRewardDay = ctx.day;
    earn(game, CONFIG.dailyReward);
    return { reward: CONFIG.dailyReward };
  },
};

export const COMMAND_TYPES = Object.keys(HANDLERS);

/** คำสั่งที่ควรบันทึกทันที (ใช้เงิน/ได้ของ) ส่วนที่เหลือรวมส่งเป็นชุดเพื่อประหยัดการเขียน Firestore */
export const URGENT_COMMANDS = new Set([
  'buyFish',
  'sellFish',
  'buyFood',
  'buyMedicine',
  'useMedicine',
  'cleanTank',
  'buyTank',
  'placeDecor',
  'sellDecor',
  'claimMission',
  'claimDaily',
  'offlineIncome',
  'fishMated',
  'fishBorn',
  'collectPearl',
  'exchangeGems',
]);

/** คำสั่งที่ถ้าถูกปฏิเสธไม่ต้องแจ้งผู้เล่น (เกิดจากการจำลองซ้อนกันหลายเครื่อง เช่น ปลาตายไปแล้วจากอีกเครื่อง) */
export const SILENT_REJECTIONS = new Set(['fishDied', 'fishMated', 'fishBorn', 'collectCoins', 'moveDecor', 'switchTank', 'renameFish', 'selectFood', 'offlineIncome']);

export function applyCommand(game, meta, cmd, ctx) {
  const handler = Object.prototype.hasOwnProperty.call(HANDLERS, cmd?.type) ? HANDLERS[cmd.type] : null;
  if (!handler) fail('invalid', 'unknown-command');
  return handler(game, meta, cmd, ctx) ?? null;
}
