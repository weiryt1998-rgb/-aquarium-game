import { ICONS } from './icons.js';
import { collectRefs, genderIcon } from './helpers.js';
import { escapeHtml, formatDuration } from '../utils/math.js';
import { breedGroupOf, dueAt, isPregnant, isResting, restEndsAt } from '../shared/breeding.js';
import { describeGenes } from '../models/molly/genetics.js';
import { hasFryLook, isRevealing } from '../models/molly/fry.js';
import { getSpecies } from '../data/fish.js';
import { CONFIG } from '../config.js';
import { TRAIT_LABEL } from '../ai/personality.ts';
import { STATE_LABEL } from '../ai/types.ts';

const TRAIT_ICON = { curious: '🔍', shy: '🙈', social: '🤝', calm: '🍃', active: '💨' };

/** การ์ดข้อมูลปลาที่ถูกแตะ: ตั้งชื่อ ดูค่าสถานะ ติดตามด้วยกล้อง */
export class FishCard {
  constructor(ui, root) {
    this.ui = ui;
    this.game = ui.game;
    this.root = root;
    this.fish = null;
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-action]');
      if (!el || !this.fish) return;
      const action = el.dataset.action;
      if (action === 'close') this.game.selectFish(null);
      else if (action === 'follow') this.#toggleFollow();
      else if (action === 'feed') this.game.feed(this.fish.position.x, this.fish.position.z);
    });
    root.addEventListener('change', (e) => {
      if (!e.target.matches('.fc-name') || !this.fish) return;
      this.fish.data.name = e.target.value.trim().slice(0, 16) || this.fish.species.name;
      e.target.value = this.fish.data.name;
      this.game.state.record({ type: 'renameFish', tankId: this.game.state.activeTank.id, fishId: this.fish.id, name: this.fish.data.name });
      this.game.state.save();
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') e.target.blur?.();
    });
  }

  show(fish) {
    this.fish = fish;
    if (!fish) {
      this.root.classList.add('hidden');
      return;
    }
    const s = fish.species;
    // ลูกปลาสอดที่ยังไม่เผยสี: ไม่บอกสายพันธุ์/ยีน ให้ผู้เล่นลุ้น (models/molly/fry.js)
    const hidden = fish.colorHidden;
    this.root.innerHTML = `
      <button class="btn-close" data-action="close" title="ปิด">${ICONS.close}</button>
      <div class="fc-head">
        <img src="${this.game.thumbs.fish(s, fish.data.genes, fish.data.growth)}" alt="" draggable="false">
        <div>
          <input class="fc-name" value="${escapeHtml(fish.data.name)}" maxlength="16" title="แตะเพื่อเปลี่ยนชื่อ">
          <small>${hidden ? 'ลูกปลาสอด' : s.name} ${genderIcon(fish.data.gender)} · <span data-ref="stage"></span></small>
          ${hidden ? '<small class="fc-genes">🎨 ยังไม่เผยสี — โตแล้วจะรู้ว่าได้สีอะไร</small>' : fish.data.genes ? `<small class="fc-genes">🧬 ${describeGenes(fish.data.genes)}</small>` : ''}
        </div>
      </div>
      <div class="fc-stats">
        <div><span>🍽️ ความอิ่ม</span><div class="bar satiety"><i data-ref="satiety"></i></div></div>
        <div><span>❤️ สุขภาพ</span><div class="bar health"><i data-ref="health"></i></div></div>
        <div><span>😊 ความสุข</span><div class="bar happy"><i data-ref="happy"></i></div></div>
        <div><span>🌱 การเติบโต</span><div class="bar growth"><i data-ref="growth"></i></div></div>
        <div><span>⚡ พลังงาน</span><div class="bar energy"><i data-ref="energy"></i></div></div>
        <div><span>😰 ความเครียด</span><div class="bar stress"><i data-ref="stress"></i></div></div>
      </div>
      <div class="fc-meta" data-ref="mind"></div>
      <div class="fc-meta" data-ref="meta"></div>
      <div class="fc-actions">
        <button class="btn" data-action="follow" data-ref="followBtn">${ICONS.eye}<span>ติดตาม</span></button>
        <button class="btn" data-action="feed">🥣<span>โรยอาหารตรงนี้</span></button>
      </div>`;
    this.refs = collectRefs(this.root);
    this.root.classList.remove('hidden');
    this.update();
  }

  #toggleFollow() {
    const sm = this.game.sceneMgr;
    if (sm.followTarget === this.fish.group) sm.stopFollow();
    else this.game.followFish(this.fish);
    this.update();
  }

  /** อาการจาก Simulation Engine + สิ่งที่ต้องแก้ + เวลาที่เหลือ (ตอนป่วย/อาการหนัก) */
  #conditionNote(f) {
    const sim = this.game.sim;
    const condition = f.condition;
    if (condition === 'healthy') return '';
    if (condition === 'hungry') return '🍽️ หิวแล้ว';
    if (condition === 'starving') return '⚠️ อดอาหาร สุขภาพเริ่มลด — ให้อาหาร';
    const causes = sim.causes(f.id);
    const fixes = [causes.hungry && 'ให้อาหาร', causes.dirtyWater && 'ทำความสะอาดตู้', 'ใช้ยา'].filter(Boolean).join(' / ');
    const left = sim.secondsLeft(f.id);
    const time = left != null ? ` (เหลือเวลาราว ${formatDuration(left / CONFIG.timeScale)})` : '';
    return condition === 'critical' ? `🚨 อาการหนัก${time} — ${fixes}` : `🤒 ป่วย${time} — ${fixes}`;
  }

  /** สถานะการขยายพันธุ์: ตั้งท้อง / พักฟื้นหลังคลอด / กำลังเกี้ยว / ขาดคู่ / พร้อมผสมพันธุ์ (เวลาเป็นเวลาจริง) */
  #breedingNotes(f) {
    const d = f.data;
    if (isPregnant(d)) {
      const left = (dueAt(d) - Date.now()) / 1000;
      // ลูกปลาสอดเกิดมาสีเข้มทุกตัว → ไม่บอกล่วงหน้าว่าเป็นลูกผสม (ชนิดอื่นบอกได้ตามเดิม)
      const baby = d.fetus?.genes && !hasFryLook(getSpecies(d.fetus.speciesId)) ? ` (${getSpecies(d.fetus.speciesId)?.name ?? 'ลูกผสม'})` : '';
      return [left > 0 ? `🤰 ตั้งท้อง${baby} คลอดในอีก ${formatDuration(left)}` : `🤰 ครบกำหนดคลอดแล้ว${baby}`];
    }
    if (isResting(d)) return [`🛌 พักฟื้นหลังคลอด อีก ${formatDuration((restEndsAt(d) - Date.now()) / 1000)}`];
    const partner = this.game.sim?.courtingPartner(f.id);
    if (partner) {
      const other = this.game.fish.getById(partner);
      return [`💞 ${d.gender === 'm' ? 'กำลังเกี้ยว' : 'มีตัวผู้มาเกี้ยว'}${other ? ` "${other.data.name}"` : ''}`];
    }
    if (!f.isAdult) return [];
    const group = breedGroupOf(f.species);
    const hasMate = this.game.fish.list.some((o) => o !== f && !o.dying && breedGroupOf(o.species) === group && o.data.gender !== d.gender);
    const kind = f.species.breedGroup ? 'ปลาสอด (สีไหนก็ได้)' : 'ชนิดเดียวกัน';
    if (!hasMate) return [d.gender === 'f' ? `ต้องมีตัวผู้${kind}ในตู้ถึงจะตั้งท้องได้` : `ต้องมีตัวเมีย${kind}ในตู้ถึงจะมีลูกได้`];
    const B = CONFIG.breeding;
    if (d.breedCooldown <= 0 && f.happiness >= B.minHappiness && d.health >= B.minHealth && f.condition === 'healthy') return ['พร้อมผสมพันธุ์'];
    return [];
  }

  update() {
    const f = this.fish;
    if (!f || !this.refs) return;
    const d = f.data;
    const set = (key, v) => {
      const el = this.refs[key];
      el.style.width = `${Math.max(0, Math.min(100, v))}%`;
      el.parentElement.classList.toggle('low', v < 25);
    };
    set('satiety', d.satiety);
    set('health', d.health);
    set('happy', f.happiness);
    set('growth', d.growth * 100);
    // ค่าจาก Fish AI (ไม่บันทึกลงเซฟ): พลังงาน ความเครียด บุคลิก และสิ่งที่กำลังทำ
    const a = f.agent;
    this.refs.energy.parentElement.parentElement.hidden = !a;
    this.refs.stress.parentElement.parentElement.hidden = !a;
    if (a) {
      set('energy', a.energy);
      this.refs.stress.style.width = `${Math.max(0, Math.min(100, a.stress))}%`;
      this.refs.mind.textContent = `${TRAIT_ICON[a.personality.primary]} ${TRAIT_LABEL[a.personality.primary]} · ${STATE_LABEL[a.state]}`;
    } else this.refs.mind.textContent = '';
    this.refs.stage.textContent = f.isAdult ? 'โตเต็มวัย' : isRevealing(f.species, d.growth) ? 'ลูกปลา · เริ่มเห็นสีแล้ว' : 'ลูกปลา';
    const notes = [`อายุ ${formatDuration(d.age)}`];
    const condition = this.#conditionNote(f);
    if (condition) notes.push(condition);
    notes.push(...this.#breedingNotes(f));
    this.refs.meta.textContent = notes.join(' · ');
    const following = this.game.sceneMgr.followTarget === f.group;
    this.refs.followBtn.classList.toggle('btn-active', following);
    this.refs.followBtn.querySelector('span').textContent = following ? 'เลิกติดตาม' : 'ติดตาม';
  }
}
