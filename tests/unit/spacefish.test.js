import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FISH_SPECIES, SHOP_SPECIES, getSpecies } from '../../src/data/fish.js';
import { SPACEFISH_VARIANT_IDS, SPACEFISH_VARIANTS } from '../../src/models/spacefish/variants.js';
import { applyCommand } from '../../src/shared/commands.js';
import { sanitizeGame } from '../../src/shared/sanitize.js';
import { planOffspring } from '../../src/shared/breeding.js';
import { T0, ctxAt, fishRecord, makeGame } from '../helpers/fixtures.js';

const SPACE = FISH_SPECIES.filter((s) => s.procedural?.type === 'spacefish');
const HEX = /^#[0-9a-f]{6}$/i;

test('ปลาอวกาศ: มีครบ 6 สี ทุกสีเป็นระดับตำนาน ขายในร้านด้วยเพชร และมีชุดสีของโมเดลตรงกัน', () => {
  assert.equal(SPACE.length, 6);
  assert.deepEqual(SPACE.map((s) => s.procedural.variant).sort(), [...SPACEFISH_VARIANT_IDS].sort());
  for (const s of SPACE) {
    assert.equal(s.id, `spacefish_${s.procedural.variant}`);
    assert.equal(s.legendary, true);
    assert.equal(s.rarity, 5);
    assert.ok(s.price.gems > 0 && !s.price.coins);
    assert.ok(SHOP_SPECIES.includes(s), `${s.id} ต้องซื้อได้ในร้าน`);
  }
});

test('ปลาอวกาศ: ชุดสีทุกชุดมีค่าสีครบและถูกรูปแบบ', () => {
  for (const [id, v] of Object.entries(SPACEFISH_VARIANTS)) {
    const colors = [v.deep, ...v.nebula, v.energy, v.star, v.fins.base, v.fins.tip, v.iris, v.glow, ...v.trail];
    assert.equal(v.nebula.length, 3, id);
    assert.ok(v.trail.length > 0, id);
    for (const c of colors) assert.match(c, HEX, `${id}: ${c}`);
  }
});

test('ปลาอวกาศ: ซื้อด้วยเพชรผ่านคำสั่งได้ เซฟผ่านการตรวจโดยไม่มี genes และผสมพันธุ์ได้ลูกสีเดียวกัน', () => {
  const species = getSpecies('spacefish_cosmic_gold');
  const game = makeGame({ coins: 0, gems: species.price.gems });
  const tank = game.tanks[0];
  applyCommand(game, { tanks: {}, writers: {} }, { type: 'buyFish', tankId: tank.id, speciesId: species.id, fish: { id: 'fish_sf1', name: 'ดาว', gender: 'f', breedCooldown: 50, coinTimer: 20 } }, ctxAt(T0));
  assert.equal(game.gems, 0);
  assert.equal(game.collection[species.id], true);

  const saved = sanitizeGame(game, { now: T0 }).tanks[0].fish.find((f) => f.id === 'fish_sf1');
  assert.equal(saved.speciesId, species.id);
  assert.equal('genes' in saved, false);

  const mom = fishRecord(species.id, { gender: 'f' });
  const dad = fishRecord(species.id, { gender: 'm' });
  assert.deepEqual(planOffspring(mom, dad), { speciesId: species.id });
});
