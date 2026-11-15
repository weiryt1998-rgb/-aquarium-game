import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SOCIALS, getSocial } from '../../src/data/socials.js';
import { BASE, applySocial, defaultRel, pairKey, relAt, sanitizeSocial, socialBlock, successChance, withRel } from '../../src/shared/social.js';
import { applyCommand } from '../../src/shared/commands.js';
import { CommandError } from '../../src/shared/economy.js';
import { createInitialGame, sanitizeGame } from '../../src/shared/sanitize.js';

const T0 = Date.UTC(2026, 10, 15, 8);
const ctx = (now = T0) => ({ now, day: '2026-11-15', writer: 'w', predict: false, simTouched: new Set() });
const run = (game, cmd, now = T0) => applyCommand(game, { writers: {}, tanks: {} }, cmd, ctx(now));
const rejects = (fn, code) => assert.throws(fn, (err) => err instanceof CommandError && err.code === code);

test('ค่าเริ่มต้น: ผู้ชายกับผู้หญิงเป็นแฟนกันอยู่แล้ว · กับตาเหมเป็นคนรู้จัก', () => {
  const couple = relAt(null, 'woman', 'man', T0);
  assert.equal(couple.f, BASE['man|woman'].f);
  assert.ok(couple.r >= 50);
  assert.equal(relAt(null, 'man', 'tahem', T0).r, 0);
  assert.equal(pairKey('woman', 'man'), 'man|woman');
});

test('ทุกการกระทำมีประโยคสำหรับทุกคู่ที่ใช้ได้ และท่าทางครบ', () => {
  // ลำดับเลือกประโยคเหมือนในเกม (SocialSystem.#line): 'to:<คน>' → คู่ → couple → ใดก็ได้
  const pickList = (lines, w) => lines && (lines[w] ?? (w === 'couple' ? lines.toWoman : null) ?? Object.entries(lines).find(([k]) => k.startsWith('to:'))?.[1] ?? lines.couple);
  for (const s of SOCIALS) {
    assert.ok(s.anim?.say && s.anim.yes, s.id);
    for (const w of s.with) {
      assert.ok(pickList(s.say, w)?.length, `${s.id} say ${w}`);
      if (!s.reply) assert.ok(pickList(s.yes, w)?.length, `${s.id} yes ${w}`);
    }
  }
});

test('ความสัมพันธ์ต้องถึงก่อน (กอด/บอกรัก/ไฮไฟว์) · การกระทำของแฟนใช้กับตาเหมไม่ได้', () => {
  const low = { ...defaultRel('man|woman'), r: 10, f: 10 };
  assert.equal(socialBlock(getSocial('hug'), 'man', 'woman', low), 'need-r');
  assert.equal(socialBlock(getSocial('highFive'), 'man', 'woman', low), 'need-f');
  assert.equal(socialBlock(getSocial('hug'), 'man', 'tahem', defaultRel('man|tahem')), 'pair');
  assert.equal(socialBlock(getSocial('askTip'), 'man', 'woman', low), 'pair');
  assert.equal(socialBlock(getSocial('chat'), 'woman', 'tahem', defaultRel('tahem|woman')), null);
});

test('ทำซ้ำอย่างเดิมติดกันได้ผลน้อยลง · ขอโทษได้ความสนิทคืนแค่ถึงระดับปกติ', () => {
  const pair = 'man|tahem';
  let rel = defaultRel(pair);
  const chat = getSocial('chat');
  const first = applySocial(rel, chat, true, T0, pair);
  const second = applySocial(first.rel, chat, true, T0 + 1000, pair);
  assert.equal(first.df, 4);
  assert.ok(second.df < first.df && second.df > 0);
  // ห่างกันเกิน 10 นาที = นับใหม่
  assert.equal(applySocial(second.rel, chat, true, T0 + 11 * 60_000, pair).df, 4);
  rel = { ...defaultRel(pair), f: BASE[pair].f + 3 };
  assert.ok(applySocial(rel, getSocial('apologize'), true, T0, pair).df <= 2);
  // ความรักไม่เปลี่ยนในคู่ที่ไม่ใช่แฟน
  assert.equal(applySocial(defaultRel(pair), getSocial('compliment'), true, T0, pair).dr, 0);
});

test('ไม่ได้คุยกันหลายวัน ความสนิทกลับหาระดับปกติ ความรักค่อย ๆ ลด', () => {
  const social = withRel(null, 'man', 'woman', { f: 90, r: 95, at: T0, last: 'hug', rep: 0 });
  const later = relAt(social, 'man', 'woman', T0 + 6 * 86_400_000);
  assert.ok(later.f < 90 && later.f >= BASE['man|woman'].f);
  assert.ok(later.r < 95 && later.r >= 20);
  assert.equal(relAt(social, 'man', 'woman', T0 + 3600_000).f, 90);
});

test('โอกาสสำเร็จขึ้นกับอารมณ์และความสนิท · คำสั่งที่ base = 1 สำเร็จเสมอ', () => {
  const rel = defaultRel('man|woman');
  const joke = getSocial('joke');
  assert.ok(successChance(joke, rel, 'playful', T0) > successChance(joke, rel, null, T0));
  assert.ok(successChance(joke, rel, 'angry', T0) < successChance(joke, rel, null, T0));
  assert.equal(successChance(getSocial('argue'), rel, 'happy', T0), 1);
});

test('คำสั่ง social: คิดผลจากตารางฝั่งเซิร์ฟเวอร์ · ปฏิเสธคู่/ข้อมูลผิด · เซฟผ่าน sanitize', () => {
  const game = createInitialGame({ now: T0 });
  run(game, { type: 'social', a: 'man', b: 'woman', socialId: 'sayLove', ok: true, at: T0 });
  assert.equal(game.social.rel['man|woman'].r, BASE['man|woman'].r + 8);
  run(game, { type: 'social', a: 'woman', b: 'tahem', socialId: 'argue', ok: false, at: T0 });
  assert.equal(game.social.rel['tahem|woman'].f, BASE['tahem|woman'].f - 10);
  rejects(() => run(game, { type: 'social', a: 'tahem', b: 'man', socialId: 'chat', ok: true }), 'invalid');
  rejects(() => run(game, { type: 'social', a: 'man', b: 'man', socialId: 'chat', ok: true }), 'invalid');
  rejects(() => run(game, { type: 'social', a: 'man', b: 'tahem', socialId: 'hug', ok: true }), 'invalid');
  rejects(() => run(game, { type: 'social', a: 'man', b: 'woman', socialId: 'nope', ok: true }), 'invalid');
  rejects(() => run(game, { type: 'social', a: 'man', b: 'woman', socialId: 'chat', ok: 'yes' }), 'invalid');
  const back = sanitizeGame(JSON.parse(JSON.stringify(game)), { now: T0 });
  assert.deepEqual(back.social, game.social);
  // ข้อมูลผิดรูปแบบถูกตัด/บีบให้อยู่ในช่วง
  const dirty = sanitizeSocial({ rel: { 'man|woman': { f: 999, r: -5, at: T0 * 2, last: 'hack', rep: 99 }, 'x|y': { f: 1 } } }, T0);
  assert.deepEqual(dirty, { rel: { 'man|woman': { f: 100, r: 0, at: T0, last: '', rep: 20 } } });
  assert.equal(sanitizeSocial({}, T0), null);
});

test('ยายเพ็ญ: คุยได้ทั้งผู้ชายและผู้หญิง (บันทึก) · คู่ตาเหม↔ยายเพ็ญคุยกันเองไม่บันทึก · หมวดเรื่องบ้านเฉพาะยาย', () => {
  const game = createInitialGame({ now: T0 });
  run(game, { type: 'social', a: 'woman', b: 'pen', socialId: 'askStory', ok: true, at: T0 });
  assert.equal(game.social.rel['pen|woman'].f, BASE['pen|woman'].f + 5);
  // ยายเดินมาทักผู้ชายเอง (a = pen) ก็บันทึกได้
  run(game, { type: 'social', a: 'pen', b: 'man', socialId: 'greet', ok: true, at: T0 });
  assert.equal(game.social.rel['man|pen'].f, BASE['man|pen'].f + 2);
  rejects(() => run(game, { type: 'social', a: 'pen', b: 'tahem', socialId: 'eldersChat', ok: true }), 'invalid');
  rejects(() => run(game, { type: 'social', a: 'man', b: 'pen', socialId: 'askTip', ok: true }), 'invalid');
  rejects(() => run(game, { type: 'social', a: 'man', b: 'tahem', socialId: 'askCook', ok: true }), 'invalid');
  // ข้อมูลคู่ตาเหม↔ยายเพ็ญในเซฟถูกตัดทิ้ง
  assert.equal(sanitizeSocial({ rel: { 'pen|tahem': { f: 1 } } }, T0), null);
  for (const s of SOCIALS.filter((x) => x.with.includes('pen'))) {
    assert.ok((s.say.pen ?? s.say.couple)?.length, `${s.id} say pen`);
    if (!s.reply) assert.ok((s.yes.pen ?? []).length, `${s.id} yes pen`);
  }
});
