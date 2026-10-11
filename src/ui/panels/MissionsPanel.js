import { Panel } from '../Panel.js';
import { MISSIONS } from '../../data/missions.js';
import { CONFIG } from '../../config.js';
import { priceHtml } from '../helpers.js';

/** รางวัลประจำวัน + ภารกิจรายวัน + ความสำเร็จ */
export class MissionsPanel extends Panel {
  constructor(ui) {
    super(ui, { title: '🎯 ภารกิจและรางวัล', className: 'panel-missions' });
    this.tickTimer = 0;
  }

  #row(m) {
    const ms = this.game.missions;
    const p = ms.progress(m);
    const claimed = ms.isClaimed(m);
    const can = ms.canClaim(m);
    return `
      <div class="mission ${p >= m.target ? 'done' : ''} ${claimed ? 'claimed' : ''}">
        <span class="row-icon">${m.icon}</span>
        <div class="info">
          <b>${m.title}</b>
          <div class="progress"><i style="width:${(p / m.target) * 100}%"></i><span>${p}/${m.target}</span></div>
        </div>
        <div class="reward">${priceHtml(m.reward)}</div>
        <button class="${can ? 'btn-buy' : 'btn'}" data-action="claim" data-id="${m.id}" ${can ? '' : 'disabled'}>${claimed ? 'รับแล้ว ✓' : 'รับรางวัล'}</button>
      </div>`;
  }

  render() {
    const ms = this.game.missions;
    ms.ensureDay();
    const canDaily = ms.canClaimDaily();
    this.body.innerHTML = `
      <div class="daily-reward ${canDaily ? 'ready' : ''}">
        <span class="row-icon">🎁</span>
        <div class="info"><b>รางวัลประจำวัน</b><small>เข้าเกมทุกวันรับ ${priceHtml(CONFIG.dailyReward)}</small></div>
        <button class="${canDaily ? 'btn-buy' : 'btn'}" data-action="claim-daily" ${canDaily ? '' : 'disabled'}>${canDaily ? 'รับเลย!' : 'รับแล้ววันนี้'}</button>
      </div>
      <h3 class="section-title">ภารกิจประจำวัน <small>รีเซ็ตทุกเที่ยงคืน</small></h3>
      <div class="list">${MISSIONS.filter((m) => m.daily).map((m) => this.#row(m)).join('')}</div>
      <h3 class="section-title">ความสำเร็จ</h3>
      <div class="list">${MISSIONS.filter((m) => !m.daily).map((m) => this.#row(m)).join('')}</div>`;
  }

  onAction(action, el) {
    const ms = this.game.missions;
    if (action === 'claim' && ms.claim(el.dataset.id)) {
      const m = MISSIONS.find((x) => x.id === el.dataset.id);
      this.ui.toast(`🎉 ได้รับรางวัล: ${m.title}`, 'success');
    } else if (action === 'claim-daily' && ms.claimDaily()) {
      this.ui.toast('🎁 รับรางวัลประจำวันแล้ว เจอกันพรุ่งนี้!', 'success');
    }
    this.render();
  }

  tick(dt) {
    this.tickTimer -= dt;
    if (this.tickTimer > 0) return;
    this.tickTimer = 1.5;
    this.render();
  }
}
