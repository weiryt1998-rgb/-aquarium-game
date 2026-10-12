import { createInitialGame } from '../../src/shared/sanitize.js';
import { createSaveDoc } from '../../src/shared/saveDoc.js';
import { todayKey } from '../../src/utils/math.js';

/** เวลาอ้างอิงคงที่: 12 ต.ค. 2026 12:00 เวลาไทย */
export const T0 = Date.parse('2026-10-12T05:00:00Z');

let counter = 0;
export const nextId = (prefix) => `${prefix}_t${(++counter).toString(36)}`;

export function fishRecord(speciesId, overrides = {}) {
  return {
    id: nextId('fish'),
    speciesId,
    name: 'ทดสอบ',
    gender: 'm',
    satiety: 80,
    health: 100,
    growth: 1,
    age: 1000,
    breedCooldown: 0,
    coinTimer: 10,
    ...overrides,
  };
}

/** เกมที่รู้ค่าแน่นอน: ตู้เริ่มต้น 1 ตู้ มีปลาตามที่ระบุ ไม่มีของตกแต่ง */
export function makeGame({ coins = 1000, gems = 50, fish = [], now = T0 } = {}) {
  const game = createInitialGame({ now });
  game.coins = coins;
  game.gems = gems;
  game.inventory = { flakes: 5, pellets: 0, bloodworm: 0, medicine: 1 };
  game.tanks[0].fish = fish;
  game.tanks[0].decor = [];
  game.tanks[0].lastUpdate = now;
  game.missions = { day: todayKey(new Date(now)), progress: {}, claimed: {} };
  game.stats = { feeds: 0, coinsCollected: 0, fishBorn: 0, fishBought: 0 };
  game.lastCleanAt = 0;
  game.dailyRewardDay = null;
  return game;
}

export function makeDoc(options = {}) {
  const game = makeGame(options);
  return createSaveDoc(game, { now: options.now ?? T0, writer: 'setup' });
}

export const tankId = (doc) => doc.game.tanks[0].id;
export const ctxAt = (now, extra = {}) => ({ now, day: todayKey(new Date(now)), writer: 'w_test', predict: false, simTouched: new Set(), ...extra });
