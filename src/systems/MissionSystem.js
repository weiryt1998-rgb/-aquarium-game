import { CONFIG } from '../config.js';
import { EV } from '../core/EventBus.js';
import { MISSIONS } from '../data/missions.js';
import { todayKey } from '../utils/math.js';

/** นับความคืบหน้าภารกิจจากเหตุการณ์ในเกม และจ่ายรางวัล */
export class MissionSystem {
  constructor(game) {
    this.game = game;
    this.byEvent = new Map();
    for (const m of MISSIONS) {
      if (!m.event) continue;
      if (!this.byEvent.has(m.event)) this.byEvent.set(m.event, []);
      this.byEvent.get(m.event).push(m);
    }
    this.gaugeTimer = 2;
    game.events.on('*', (event, payload) => this.#onEvent(event, payload));
    this.ensureDay();
  }

  get data() {
    return this.game.state.data.missions;
  }

  /** ขึ้นวันใหม่ → รีเซ็ตภารกิจรายวัน */
  ensureDay() {
    const today = todayKey();
    if (this.data.day === today) return;
    for (const m of MISSIONS) {
      if (!m.daily) continue;
      delete this.data.progress[m.id];
      delete this.data.claimed[m.id];
    }
    this.data.day = today;
  }

  progress(m) {
    const stored = this.data.progress[m.id] ?? 0;
    const live = m.gauge ? m.gauge(this.game) : 0;
    return Math.min(m.target, Math.max(stored, live));
  }

  isComplete(m) {
    return this.progress(m) >= m.target;
  }

  isClaimed(m) {
    return !!this.data.claimed[m.id];
  }

  canClaim(m) {
    return this.isComplete(m) && !this.isClaimed(m);
  }

  #onEvent(event, payload) {
    const list = this.byEvent.get(event);
    if (!list) return;
    this.ensureDay();
    for (const m of list) {
      const before = this.data.progress[m.id] ?? 0;
      if (this.isClaimed(m) || before >= m.target) continue;
      const after = Math.min(m.target, before + (payload?.amount ?? 1));
      this.data.progress[m.id] = after;
      if (after >= m.target) this.#completed(m);
    }
  }

  #completed(m) {
    this.game.sound.play('mission');
    this.game.ui.toast(`🎯 ภารกิจสำเร็จ: ${m.title} — กดรับรางวัลที่ปุ่ม +`, 'success');
    this.game.events.emit(EV.MISSION_DONE, { mission: m });
  }

  update(dt) {
    this.gaugeTimer -= dt;
    if (this.gaugeTimer > 0) return;
    this.gaugeTimer = 2;
    this.ensureDay();
    for (const m of MISSIONS) {
      if (!m.gauge || this.isClaimed(m) || (this.data.progress[m.id] ?? 0) >= m.target) continue;
      if (m.gauge(this.game) >= m.target) {
        this.data.progress[m.id] = m.target;
        this.#completed(m);
      }
    }
  }

  claim(id) {
    const m = MISSIONS.find((x) => x.id === id);
    if (!m || !this.canClaim(m)) return false;
    this.data.claimed[m.id] = true;
    this.game.state.earn(m.reward);
    this.game.sound.play('buy');
    this.game.events.emit(EV.MISSION_CLAIMED, { mission: m });
    return true;
  }

  canClaimDaily() {
    return this.game.state.data.dailyRewardDay !== todayKey();
  }

  claimDaily() {
    if (!this.canClaimDaily()) return false;
    this.game.state.data.dailyRewardDay = todayKey();
    this.game.state.earn(CONFIG.dailyReward);
    this.game.sound.play('buy');
    return true;
  }

  get claimableCount() {
    return MISSIONS.filter((m) => this.canClaim(m)).length + (this.canClaimDaily() ? 1 : 0);
  }
}
