/** ระบบส่งเหตุการณ์แบบ pub/sub ให้แต่ละระบบคุยกันโดยไม่ต้องรู้จักกันโดยตรง */
export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  on(event, fn) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.listeners.get(event)?.delete(fn);
  }

  emit(event, payload) {
    this.listeners.get(event)?.forEach((fn) => fn(payload));
    this.listeners.get('*')?.forEach((fn) => fn(event, payload));
  }
}

/** ชื่อเหตุการณ์ทั้งหมดในเกม */
export const EV = {
  CURRENCY: 'currency:changed',
  INVENTORY: 'inventory:changed',
  FEED: 'feed',
  FISH_ATE: 'fish:ate',
  FISH_BOUGHT: 'fish:bought',
  FISH_BORN: 'fish:born',
  FISH_PREGNANT: 'fish:pregnant',
  FISH_DIED: 'fish:died',
  FISH_SOLD: 'fish:sold',
  FISH_GREW: 'fish:grew',
  FISH_COUNT: 'fish:count',
  COIN_COLLECTED: 'coin:collected',
  TANK_CLEANED: 'tank:cleaned',
  TANK_UNLOCKED: 'tank:unlocked',
  TANK_SWITCHED: 'tank:switched',
  DECOR_PLACED: 'decor:placed',
  DECOR_SOLD: 'decor:sold',
  MEDICINE_USED: 'medicine:used',
  COLLECTION: 'collection:changed',
  MISSION_DONE: 'mission:completed',
  MISSION_CLAIMED: 'mission:claimed',
  MODE: 'mode:changed',
  SCREENSHOT: 'screenshot',
};
