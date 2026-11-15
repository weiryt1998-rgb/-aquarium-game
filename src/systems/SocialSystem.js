import * as THREE from 'three';
import { MOODS, SOCIALS, SOCIAL_CATEGORIES, VOICES, getSocial } from '../data/socials.js';
import { BASE, PLAYABLE, applySocial, friendLabel, isCouplePair, loveLabel, pairKey, pairType, relAt, socialBlock, successChance, withRel } from '../shared/social.js';
import { SpeechBubbles } from '../ui/SpeechBubbles.js';
import { SocialMenu } from '../ui/SocialMenu.js';
import { FARMER_HEAD, FARMER_NAME } from '../entities/Farmer.js';
import { PEOPLE } from '../entities/Person.js';
import { pick } from '../utils/math.js';

/**
 * ระบบคุยกันแบบเกมจำลองชีวิต: แตะตัวละครอีกคน/ตาเหม → เมนูวงกลม → เลือกบทสนทนา
 *   ตัวที่ผู้เล่นบังคับเดินไปหา → หันหน้าเข้าหากัน → พูด (ฟองคำพูด + ท่าทาง) → อีกฝ่ายตอบ (สำเร็จ/ไม่สำเร็จตามโอกาส)
 *   → ความสนิท/ความรักเปลี่ยน (เซฟกลาง: คำสั่ง 'social' · src/shared/social.js) + อารมณ์ชั่วคราว (ไม่บันทึก)
 * ตัวละครอีกคนบางครั้งเดินมาคุยกับผู้เล่นหรือตาเหมเอง (autonomy) ใช้ขั้นตอนเดียวกัน
 * ข้อมูลบทสนทนา: src/data/socials.js
 */
const MOOD_SECONDS = 150;
/** ท่าที่สองคนทำพร้อมกัน (ไฮไฟว์ จับมือ กอด) — คนฟังตอบรับพร้อมคนพูด */
const PAIRED = new Set(['highfive', 'shake', 'hug', 'kiss']);
/** ตาเหมไม่มีท่าเหล่านี้ → ใช้ท่าใกล้เคียง */
const FARMER_ANIM = { highfive: 'laugh', shake: 'wave', hug: 'talk', kiss: 'talk', angry: 'shrug', dance: 'laugh' };
/** ผู้เล่นอยู่นิ่ง ๆ นานเท่านี้ (วินาที) ตัวละครอีกคนถึงจะเดินมาชวนคุยเอง */
const AUTO_EVERY = [40, 90];

export class SocialSystem {
  /** @param {import('./FarmSystem.js').FarmSystem} farm */
  constructor(farm) {
    this.farm = farm;
    this.game = farm.game;
    this.bubbles = null;
    this.menu = null;
    /** @type {Map<string, { id: string, until: number }>} อารมณ์ชั่วคราวของแต่ละคน */
    this.moods = new Map();
    /** การสนทนาที่กำลังเกิดขึ้น (ทีละครั้ง) */
    this.job = null;
    this.time = 0;
    this.autoIn = 30;
    /** ยายเพ็ญเดินไปคุยกับตาเหม/ทักผู้เล่นเอง */
    this.penIn = 45;
  }

  /** สร้าง UI ครั้งแรก (UI สร้างหลัง FarmSystem) */
  #ui() {
    if (this.bubbles) return;
    this.bubbles = new SpeechBubbles(this.game.ui.root);
    this.menu = new SocialMenu(this.game.ui.root);
  }

  get busy() {
    return !!this.job;
  }

  /** ข้อความ/อีโมจิเหนือหัว (ใช้จากระบบอื่น เช่นกิจกรรมในบ้าน) */
  say(key, text, duration = 3) {
    this.#ui();
    this.bubbles.say(key, this.#head(key), text, { duration });
  }

  /**
   * เมนูวงกลมทั่วไป (เช่นเฟอร์นิเจอร์ในบ้าน): actions = [{ id, icon, label }] · anchor = จุดในโลกที่วงเมนูล้อม
   * @param {{ icon: string, title: string, level?: string, anchor: THREE.Vector3, actions: { id: string, icon: string, label: string }[], onPick: (id: string) => void }} m
   */
  menuOpen(m) {
    this.#ui();
    const cam = this.game.sceneMgr.camera;
    cam.updateMatrixWorld();
    const v = m.anchor.clone().project(cam);
    this.menu.open({
      x: (v.x * 0.5 + 0.5) * window.innerWidth,
      y: (-v.y * 0.5 + 0.5) * window.innerHeight,
      icon: m.icon,
      title: m.title,
      level: m.level ?? '',
      mood: null,
      bars: [],
      categories: [],
      extras: m.actions.map((a) => ({ id: a.id, icon: a.icon, label: a.label })),
      onPick: m.onPick,
    });
  }

  /** ตัวละครตาม key: 'man' | 'woman' (Person) · 'tahem' (Farmer) */
  #who(key) {
    return key === 'tahem' ? this.farm.farmer : this.farm.people[key] ?? null;
  }

  #head(key) {
    const w = this.#who(key);
    const y = key === 'tahem' ? FARMER_HEAD + 0.35 : PEOPLE[key].head + 0.16;
    return () => (w ? w.position.clone().setY(y) : new THREE.Vector3());
  }

  #name(key) {
    return key === 'tahem' ? FARMER_NAME : PEOPLE[key].label;
  }

  #icon(key) {
    return key === 'tahem' ? '👴' : PEOPLE[key].icon;
  }

  moodOf(key) {
    const m = this.moods.get(key);
    return m && m.until > this.time ? m.id : null;
  }

  #setMood(key, id) {
    if (!id) return;
    this.moods.set(key, { id, until: this.time + MOOD_SECONDS });
    const h = this.#head(key);
    this.bubbles?.mood(key, () => h().setY(h().y - 0.3), MOODS[id]?.icon ?? null, MOOD_SECONDS);
  }

  #rel(a, b) {
    return relAt(this.game.state.data.social, a, b, Date.now());
  }

  // ── เมนู ──────────────────────────────────────────────────

  /** แตะตัวละคร key → เปิดเมนูวงกลมรอบตัวละครนั้นบนจอ */
  open(key) {
    this.#ui();
    const actor = this.farm.controlled;
    if (key === actor || !this.#who(key)) return;
    const cam = this.game.sceneMgr.camera;
    cam.updateMatrixWorld();
    const head = this.#head(key)().setY(1.1).project(cam);
    const screen = { x: (head.x * 0.5 + 0.5) * window.innerWidth, y: (-head.y * 0.5 + 0.5) * window.innerHeight };
    const rel = this.#rel(actor, key);
    const type = pairType(actor, key);
    const mood = this.moodOf(key);
    const upset = mood === 'angry' || mood === 'sad' || mood === 'annoyed' || rel.f < BASE[pairKey(actor, key)].f - 10;
    const hasCows = this.farm.cows.size > 0;
    const categories = SOCIAL_CATEGORIES.filter((c) => !c.with || c.with === type)
      .map((c) => ({
        ...c,
        items: SOCIALS.filter((s) => s.cat === c.id && s.with.includes(type))
          .filter((s) => (s.when === 'upset' ? upset : s.when === 'cows' ? hasCows : true))
          .map((s) => {
            const block = socialBlock(s, actor, key, rel);
            return {
              id: s.id,
              icon: s.icon,
              label: this.#label(s, key),
              locked: !!block,
              reason: block === 'need-r' ? 'ต้องรักกันมากกว่านี้อีกหน่อย' : block === 'need-f' ? 'ต้องสนิทกันมากกว่านี้อีกหน่อย' : '',
            };
          }),
      }))
      .filter((c) => c.items.length);
    const couple = isCouplePair(actor, key);
    const bars = [{ kind: 'friend', label: friendLabel(rel.f), value: (rel.f + 100) / 200 }];
    if (couple) bars.unshift({ kind: 'love', label: loveLabel(rel.r), value: rel.r / 100 });
    this.game.sound.play('click');
    this.menu.open({
      x: screen.x,
      y: screen.y,
      icon: this.#icon(key),
      title: this.#name(key),
      // ระดับความสัมพันธ์อยู่ในป้ายของแถบแล้ว — บรรทัดรองบอกแค่ว่าเป็นใคร
      level: key === this.farm.remoteKey ? 'เพื่อนที่เล่นด้วยกัน' + (couple ? ' · แฟนของคุณ' : '') : couple ? 'แฟนของคุณ' : key === 'tahem' ? 'คนเลี้ยงวัวประจำฟาร์ม' : key === 'pen' ? 'ภรรยาตาเหม' : '',
      mood: mood ? MOODS[mood] : null,
      bars,
      categories,
      extras: PLAYABLE.includes(key) && key !== this.farm.remoteKey ? [{ id: '__swap', icon: '🔄', label: 'สลับไปเล่นตัวนี้' }] : [],
      onPick: (id) => (id === '__swap' ? this.farm.swapCharacter() : this.start(actor, key, getSocial(id))),
      onLocked: (reason) => this.game.ui.toast(`🔒 ${reason}`),
    });
  }

  #label(def, target) {
    return typeof def.label === 'string' ? def.label : def.label[target] ?? Object.values(def.label)[0];
  }

  // ── การสนทนา ───────────────────────────────────────────────

  /**
   * เริ่มคุย: a (คนพูด — คนที่ผู้เล่นบังคับ หรือตัวละครอีกคนที่เดินมาคุยเอง) → b · auto = ตัวละครเริ่มเอง
   * เล่นด้วยกันสองคน: คุยกับตัวที่เพื่อนบังคับ → ส่งให้เครื่องเพื่อนเล่นฉากเดียวกัน (ผลสำเร็จ ok เดียวกัน)
   * remote = ฉากที่เพื่อนเริ่ม (เครื่องเพื่อนบันทึกผลลงเซฟ เครื่องนี้แค่แสดง)
   */
  start(a, b, def, { auto = false, ok: forced = null, remote = false } = {}) {
    if (!def) return;
    this.#ui();
    this.cancel({ fromPeer: remote });
    const actor = this.#who(a);
    const target = this.#who(b);
    if (!actor || !target) return;
    const rel = this.#rel(a, b);
    if (socialBlock(def, a, b, rel)) return;
    const ok = forced ?? Math.random() < successChance(def, rel, this.moodOf(b), Date.now());
    this.job = { a, b, def, ok, auto, remote, phase: 'approach', t: 0, route: null };
    const rk = this.farm.remoteKey;
    if (!remote && rk && (a === rk || b === rk)) this.farm.coop?.sendEvent({ k: 'social', a, b, id: def.id, ok });
    this.#engage(b, a);
    if (a !== this.farm.controlled) this.#engage(a, b);
    // ท่าชิดตัว (กอด จูบ): เดินไปหยุดห่างกว่านิดหน่อย (ระบบชนตัวยังทำงาน) แล้วค่อยขยับเข้าชิดตอนหันหน้า
    this.job.close = def.dist < 0.55 ? def.dist : 0;
    const stand = this.#standPoint(actor, target, def.dist + (this.job.close ? 0.3 : 0));
    const points = this.farm.nav?.path(actor.position, stand) ?? [stand];
    this.job.route = { points, i: 0 };
    // เวลาเดินไปถึงตามระยะทางจริง/ความเร็วเดินของคนนั้น (ยายเพ็ญเดินช้า) + เผื่อหลบวัว
    const len = points.reduce((sum, q, i) => sum + q.distanceTo(i ? points[i - 1] : actor.position), 0);
    const speed = a === 'tahem' ? 0.9 : PEOPLE[a]?.clip.walk ?? 1;
    this.job.timeout = 6 + (len / speed) * 1.6;
  }

  /** ยกเลิก (ผู้เล่นเดิน/สลับตัว/ออกจากฟาร์ม) · fromPeer = เพื่อนยกเลิกมา (ไม่ต้องส่งกลับ) */
  cancel({ fromPeer = false } = {}) {
    const j = this.job;
    if (!j) return;
    this.job = null;
    const rk = this.farm.remoteKey;
    if (!fromPeer && rk && (j.a === rk || j.b === rk)) this.farm.coop?.sendEvent({ k: 'cancel' });
    for (const k of [j.a, j.b]) this.#release(k);
    this.bubbles?.clear(j.a);
    this.bubbles?.clear(j.b);
  }

  /** ตัวละครนี้กำลังถูกระบบคุยควบคุมอยู่ไหม (FarmSystem ไม่ต้องอัปเดตเอง) */
  drives(key) {
    return !!this.job && (this.job.a === key || this.job.b === key);
  }

  /** ยืนคุย/ทำท่าอยู่กับที่ (หลังเดินถึงแล้ว) — ระบบดันตัวไม่ต้องแยกสองคนนี้ออกจากกัน (กอด/จูบตัวชิดกัน) */
  holds(key) {
    return this.drives(key) && this.job.phase !== 'approach';
  }

  #engage(key, other) {
    const w = this.#who(key);
    // กำลังนั่ง/นอน/ทำงานในบ้าน → เลิกก่อน (ยืนข้างเฟอร์นิเจอร์)
    if (this.farm.life?.drives(key)) this.farm.life.cancel(key, true);
    if (key === 'tahem') w.talkTo(() => this.#who(other)?.position ?? w.position);
    else {
      w.engaged = true;
      w.cancelAct();
    }
  }

  #release(key) {
    const w = this.#who(key);
    if (!w) return;
    if (key === 'tahem') w.release();
    else {
      w.engaged = false;
      if (key !== this.farm.controlled) this.farm.brains[key]?.reset(1.5 + Math.random() * 2);
    }
  }

  /** จุดยืนของคนพูด: ห่างคนฟัง dist ม. บนแนวที่อยู่ตอนนี้ (ไม่ทะลุรั้ว — ถ้าชนใช้ด้านอื่น) */
  #standPoint(actor, target, dist) {
    const tp = target.position;
    const dir = actor.position.clone().sub(tp).setY(0);
    if (dir.lengthSq() < 1e-4) dir.set(0, 0, 1);
    dir.normalize();
    const c = this.farm.colliders;
    for (const turn of [0, 0.6, -0.6, 1.3, -1.3, Math.PI]) {
      const d = dir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
      const p = tp.clone().addScaledVector(d, dist);
      if (!c || !this.farm.blocked(p)) return p;
    }
    return tp.clone().addScaledVector(dir, dist);
  }

  update(dt) {
    this.time += dt;
    const visible = this.farm.active && !this.farm.inBarnView;
    if (this.bubbles) this.bubbles.update(dt, this.game.sceneMgr.camera, visible);
    if (!this.farm.active) return;
    if (this.job) this.#step(dt);
    else this.#autonomy(dt);
  }

  #step(dt) {
    const j = this.job;
    const actor = this.#who(j.a);
    const target = this.#who(j.b);
    if (!actor || !target) return this.cancel();
    const collide = this.farm.collide;
    j.t += dt;
    const tp = target.position;
    // คนฟัง (Person) หันหน้ามาหาคนพูดตลอด ยกเว้นตอนทำท่า · ตาเหมหันเองใน Farmer.update (convo)
    if (j.b !== 'tahem') {
      if (target.busy) target.stand(dt, collide);
      else target.face(dt, actor.position, collide);
    }
    if (j.phase === 'approach') {
      const r = j.route;
      const last = r.i >= r.points.length - 1;
      if (actor.walkToward(dt, r.points[r.i], collide, { reach: last ? 0.12 : 0.5 })) {
        if (last) this.#next('face');
        else r.i++;
      }
      if (j.t > j.timeout) this.cancel(); // เดินไปไม่ถึง (ถูกขวาง)
      return;
    }
    if (actor.busy) actor.stand(dt, collide);
    else actor.face(dt, tp, collide);
    let closeOk = true;
    if (j.phase === 'face' && j.close) {
      // ขยับเข้าชิดตามระยะของท่า (ตามแนวหน้าเข้าหากัน)
      const ap = actor.group.position;
      const dx = ap.x - tp.x;
      const dz = ap.z - tp.z;
      const d = Math.hypot(dx, dz) || 1;
      const nd = d + (j.close - d) * (1 - Math.exp(-6 * dt));
      ap.x = tp.x + (dx / d) * nd;
      ap.z = tp.z + (dz / d) * nd;
      closeOk = Math.abs(d - j.close) < 0.03;
    }
    // จังหวะนับด้วยเวลาเกม (ไม่ใช้ setTimeout — แท็บพัก/เฟรมตกแล้วยังตรงกัน)
    if (j.phase === 'face' && (j.t > 1.6 || (this.#facing(actor, tp) && this.#facing(target, actor.position) && closeOk))) this.#say();
    else if (j.phase === 'say' && j.t >= j.wait) this.#reply();
    else if (j.phase === 'reply' && j.t >= j.wait) this.#finish();
  }

  #facing(w, p) {
    const want = Math.atan2(p.x - w.position.x, p.z - w.position.z);
    const d = Math.atan2(Math.sin(want - w.group.rotation.y), Math.cos(want - w.group.rotation.y));
    return Math.abs(d) < 0.15;
  }

  #next(phase) {
    this.job.phase = phase;
    this.job.t = 0;
  }

  /** ช่วงพูด: ฟองคำพูด + ท่าของคนพูด (ท่าคู่ เช่นไฮไฟว์ คนฟังทำพร้อมกันถ้าสำเร็จ) */
  #say() {
    const j = this.job;
    const { def, a, b } = j;
    this.#next('say');
    const actor = this.#who(a);
    if (j.close) {
      // ท่าชิดตัว: วางระยะ + หันหน้าเข้าหากันพอดีก่อนเริ่มท่าคู่
      const target = this.#who(b);
      const ap = actor.group.position;
      const tp = target.position;
      const d = Math.hypot(ap.x - tp.x, ap.z - tp.z) || 1;
      ap.x = tp.x + ((ap.x - tp.x) / d) * j.close;
      ap.z = tp.z + ((ap.z - tp.z) / d) * j.close;
      actor.group.rotation.y = Math.atan2(tp.x - ap.x, tp.z - ap.z);
      if (b !== 'tahem') target.group.rotation.y = actor.group.rotation.y + Math.PI;
    }
    const line = this.#line(def.say, a, b);
    const anim = def.anim.say;
    const dur = Math.max(2.2, Math.min(4.5, 1.2 + line.length * 0.06));
    this.bubbles.say(a, this.#head(a), line, { duration: dur + 0.4 });
    const paired = j.ok && PAIRED.has(anim) && def.anim.yes === anim;
    if (paired) this.#anim(b, anim, null, dur);
    j.paired = paired;
    const sayLen = anim === 'talk' ? dur : Math.max(actor.clipDuration?.(anim, dur) ?? dur, 1.4);
    this.#anim(a, anim, null, dur);
    j.wait = sayLen;
  }

  #anim(key, name, done, duration) {
    const w = this.#who(key);
    if (!w) return;
    let n = name;
    if (key === 'tahem') n = w.hasClip(name) ? name : FARMER_ANIM[name] ?? 'talk';
    else if (!w.hasClip(n)) n = 'talk';
    w.act(n, done, { duration });
  }

  /** คนฟังตอบ + ผลต่อความสัมพันธ์ */
  #reply() {
    const j = this.job;
    const { def, a, b, ok } = j;
    this.#next('reply');
    let line;
    if (def.reply === 'farm') line = this.farm.farmStatusLine();
    else if (def.reply === 'tip') line = pick(def.tips);
    else if (def.reply === 'tahem') line = this.farm.tahemWhereLine();
    else line = this.#line(ok ? def.yes : def.no ?? def.yes, b, a);
    const dur = Math.max(2.4, Math.min(5, 1.2 + line.length * 0.06));
    this.bubbles.end(a);
    this.bubbles.say(b, this.#head(b), line, { duration: dur + 0.3, tone: ok ? 'yes' : 'no' });
    if (!j.paired) this.#anim(b, ok ? def.anim.yes : def.anim.no ?? def.anim.yes, null, dur);
    this.#apply();
    j.wait = dur;
  }

  #finish() {
    const j = this.job;
    this.job = null;
    this.#release(j.a);
    this.#release(j.b);
    if (j.ok && j.def.help) this.farm.sendFarmerToNeediest();
    if (j.auto) this.autoIn = AUTO_EVERY[0] + Math.random() * (AUTO_EVERY[1] - AUTO_EVERY[0]);
  }

  /** ใช้ผลในเครื่องทันที + บันทึกคำสั่ง (เซิร์ฟเวอร์คิดผลเองจากตารางเดียวกัน) */
  #apply() {
    const { def, a, b, ok } = this.job;
    // ตาเหม↔ยายเพ็ญคุยกันเอง: แค่อารมณ์ ไม่บันทึก
    if (BASE[pairKey(a, b)]?.npc) {
      this.#setMood(b, def.mood?.yes);
      this.#setMood(a, def.mood?.yes);
      return;
    }
    const now = Date.now();
    const state = this.game.state;
    const rel = relAt(state.data.social, a, b, now);
    const pair = pairKey(a, b);
    const { rel: next, df, dr } = applySocial(rel, def, ok, now, pair);
    // ฉากที่เพื่อนเริ่ม: เครื่องเพื่อนบันทึก (ผลมาถึงทางเซฟกลาง) — ไม่บันทึกซ้ำ
    if (!this.job.remote) {
      state.data.social = withRel(state.data.social, a, b, next);
      state.record({ type: 'social', a, b, socialId: def.id, ok, at: now });
      state.save();
    }
    const hb = this.#head(b);
    const head = () => hb().addScaledVector(new THREE.Vector3(0, 1, 0), -0.3);
    const both = Math.abs(dr) >= 0.5 && Math.abs(df) >= 0.5;
    if (Math.abs(dr) >= 0.5) this.bubbles.pop(b, head, `${dr > 0 ? '+' : ''}${Math.round(dr)} ❤️`, dr > 0, both ? -34 : 0);
    if (Math.abs(df) >= 0.5) this.bubbles.pop(`${b}f`, head, `${df > 0 ? '+' : ''}${Math.round(df)} 💛`, df > 0, both ? 34 : 0);
    this.#setMood(b, def.mood?.[ok ? 'yes' : 'no']);
    if (ok && def.mood?.yes && def.cat !== 'mean') this.#setMood(a, 'happy');
    if (def.cat === 'mean') this.#setMood(a, 'annoyed');
    this.game.sound.play(ok && def.cat !== 'mean' ? 'coin' : 'click');
  }

  /** เลือกประโยค + แทนสรรพนามตามคู่ (VOICES) · lines แยก couple / tahem / toWoman / toMan */
  #line(lines, speaker, listener) {
    if (!lines) return '…';
    const type = pairType(speaker, listener);
    const list =
      lines[`to:${listener}`] || (listener === 'woman' && lines.toWoman) || (listener === 'man' && lines.toMan) || lines[type] || lines.couple || lines.tahem || ['…'];
    const v = VOICES[`${speaker}>${listener}`] ?? { I: 'ฉัน', you: 'เธอ', end: '' };
    return pick(list).replace(/\{I\}/g, v.I).replace(/\{you\}/g, v.you).replace(/\{end\}/g, v.end);
  }

  // ── ตัวละครเริ่มคุยเอง ─────────────────────────────────────

  /** ตัวละครอีกคน (AI) บางครั้งเดินมาชวนผู้เล่นคุย หรือแวะคุยกับตาเหม */
  #autonomy(dt) {
    this.#penAutonomy(dt);
    if (this.job) return;
    const c = this.farm.companion;
    const p = this.farm.player;
    // ตัวละครอีกตัวเป็นของเพื่อน (เล่นด้วยกัน) → ไม่เดินมาคุยเอง
    if (!c || !p || c.remote || this.farm.inBarnView || this.menu?.isOpen) return;
    this.autoIn -= dt;
    if (this.autoIn > 0) return;
    this.autoIn = 8; // ยังไม่พร้อม — ลองใหม่อีกครู่
    const brain = this.farm.brains[c.key];
    // ยืนว่าง/เดินอยู่เฉย ๆ ก็แวะมาคุยได้ (ไม่ขัดตอนกำลังทำงาน/ทักทาย)
    if (!brain || !(brain.state === 'idle' || brain.state === 'walk') || c.busy || this.farm.input?.active) return;
    const f = this.farm.farmer;
    const toPlayer = c.position.distanceTo(p.position) < 14;
    const toFarmer = f && !f.traveling && f.state !== 'tend' && c.position.distanceTo(f.position) < 14;
    const pen = this.farm.people.pen;
    const toPen = pen && !pen.busy && this.farm.brains.pen?.state !== 'act' && c.position.distanceTo(pen.position) < 14;
    const r = Math.random();
    const target = toPlayer && (r < 0.6 || (!toFarmer && !toPen)) ? p.key : toFarmer && (r < 0.8 || !toPen) ? 'tahem' : toPen ? 'pen' : null;
    if (!target) return;
    const type = pairType(c.key, target);
    const rel = this.#rel(c.key, target);
    const pool = SOCIALS.filter((s) => s.with.includes(type) && !s.when && s.cat !== 'mean' && !s.reply && !s.help && !socialBlock(s, c.key, target, rel));
    this.start(c.key, target, pick(pool), { auto: true });
  }

  /** ยายเพ็ญ: แวะไปคุยกับตาเหมเป็นระยะ (ถ้าอยู่ไม่ไกล) · ผู้เล่นอยู่ใกล้ ๆ = เดินมาทัก/ชวนคุย */
  #penAutonomy(dt) {
    const pen = this.farm.people.pen;
    const brain = this.farm.brains.pen;
    if (!pen || !brain || this.job || this.farm.inBarnView || this.menu?.isOpen) return;
    this.penIn -= dt;
    if (this.penIn > 0) return;
    this.penIn = 10;
    if (!(brain.state === 'idle' || brain.state === 'walk') || pen.busy) return;
    const f = this.farm.farmer;
    const p = this.farm.player;
    const nearPlayer = p && pen.position.distanceTo(p.position) < 7 && !this.farm.input?.active;
    const farmerFree = f && !f.traveling && f.state !== 'tend' && f.state !== 'convo' && !this.farm.insideBarnAt(f.position) && pen.position.distanceTo(f.position) < 26;
    let target = null;
    if (nearPlayer && (Math.random() < 0.5 || !farmerFree)) target = p.key;
    else if (farmerFree) target = 'tahem';
    if (!target) return;
    const type = pairType('pen', target);
    const rel = this.#rel('pen', target);
    const pool = SOCIALS.filter((s) => s.with.includes(type) && !s.when && s.cat !== 'mean' && !s.reply && !s.help && s.cat !== 'home' && !socialBlock(s, 'pen', target, rel));
    if (!pool.length) return;
    this.start('pen', target, pick(pool), { auto: true });
    this.penIn = 70 + Math.random() * 70;
  }
}
