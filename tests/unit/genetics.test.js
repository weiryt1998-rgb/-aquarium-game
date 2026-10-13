import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SPOT_REFS, crossGenes, describeGenes, genesKey, genesToVariant, mixHex, sanitizeGenes, variantGenes } from '../../src/models/molly/genetics.js';
import { planOffspring, sanitizeFetus } from '../../src/shared/breeding.js';
import { MOLLY_VARIANT_IDS } from '../../src/models/molly/variants.js';
import { seededRandom } from '../../src/utils/math.js';

const COLORS = ['dalmatian', 'redhead', 'golden', 'calico', 'golddust'];

test('ยีนลูกผสม: สุ่มซ้ำด้วย seed เดิมได้ผลเดิม และยีนที่ได้อยู่ในรูปที่ถูกต้องเสมอ', () => {
  const a = crossGenes(variantGenes('golden'), variantGenes('calico'), seededRandom(0.42));
  const b = crossGenes(variantGenes('golden'), variantGenes('calico'), seededRandom(0.42));
  assert.deepEqual(a, b);
  const rnd = seededRandom(0.9);
  for (let i = 0; i < 500; i++) {
    const mom = rnd() < 0.5 ? variantGenes(COLORS[i % 5]) : crossGenes(variantGenes(COLORS[i % 5]), variantGenes(COLORS[(i + 2) % 5]), rnd);
    const g = crossGenes(mom, variantGenes(COLORS[(i * 3) % 5]), rnd);
    assert.deepEqual(sanitizeGenes(g), g, 'ยีนที่สุ่มได้ผ่านการตรวจโดยไม่ถูกแก้');
    assert.ok(g.spots.length <= 3);
    assert.ok(MOLLY_VARIANT_IDS.includes(g.body.from));
  }
});

test('ยีนลูกผสม: ได้ลักษณะใหม่ที่ไม่เหมือนพ่อแม่ (เช่น ตัวทองมีจุดดัลเมเชียน) และมีการกลายพันธุ์', () => {
  const rnd = seededRandom(0.3);
  const looks = new Set();
  let mutated = 0;
  for (let i = 0; i < 400; i++) {
    const g = crossGenes(variantGenes('golden'), variantGenes('dalmatian'), rnd);
    looks.add(describeGenes(g));
    if (g.head || g.spots.some((s) => !s.ref.startsWith('dalmatian'))) mutated++;
  }
  assert.ok(looks.has('ตัวสีทอง · จุดดัลเมเชียน'), [...looks].join(' | '));
  assert.ok(looks.size >= 5, 'มีหลายแบบ');
  assert.ok(mutated > 0, 'มีลักษณะที่ไม่มีในพ่อแม่จากการกลายพันธุ์');
});

test('ยีน → ชุดสีสำหรับวาด: id คงที่ตามยีน และจำนวนจุดตามความหนาแน่น', () => {
  const g = sanitizeGenes({ ...variantGenes('calico'), spots: [{ ref: 'calico:1', color: '#0b0c10', k: 2 }], seed: 1234 });
  const v = genesToVariant(g);
  assert.equal(v.id, genesKey(g));
  assert.equal(v.hybrid, true);
  assert.equal(v.spots[0].count, SPOT_REFS['calico:1'].count * 2);
  assert.notEqual(genesKey(g), genesKey({ ...g, seed: 1235 }), 'ลายต่างตัวกันได้ texture คนละชุด');
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
});

test('ตรวจยีนจากภายนอก: ค่าผิดรูปแบบถูกแก้ ค่าที่ใช้ไม่ได้คืน null', () => {
  assert.equal(sanitizeGenes(null), null);
  assert.equal(sanitizeGenes({ body: 1 }), null);
  const g = sanitizeGenes({
    body: { base: 'red', back: '#123456', belly: '#ABCDEF', from: 'hybrid' },
    fins: { opacity: 9 },
    head: { color: 'x', end: 99 },
    spots: [{ ref: 'nope:0' }, { ref: 'calico:0', k: 50 }, 1, 2, 3],
    seed: -4,
  });
  assert.equal(g.body.back, '#123456');
  assert.equal(g.body.belly, '#abcdef');
  assert.notEqual(g.body.from, 'hybrid', 'ชุดโชว์ใช้เป็นแหล่งยีนไม่ได้');
  assert.equal(g.fins.opacity, 0.95);
  assert.equal(g.head.end, 0.45);
  assert.deepEqual(
    g.spots.map((s) => [s.ref, s.k]),
    [['calico:0', 2]],
  );
  assert.equal(g.seed, 1);
});

test('ลูกในท้อง: สีเดียวกันได้พันธุ์แท้ ต่างสี/มีลูกผสมได้ลูกผสม ชนิดอื่นไม่มียีน', () => {
  const f = (speciesId, extra = {}) => ({ speciesId, gender: 'f', ...extra });
  const m = (speciesId, extra = {}) => ({ speciesId, gender: 'm', ...extra });
  assert.deepEqual(planOffspring(f('molly_golden'), m('molly_golden')), { speciesId: 'molly_golden' });
  assert.deepEqual(planOffspring(f('guppy'), m('guppy')), { speciesId: 'guppy' });
  const cross = planOffspring(f('molly_golden'), m('molly_redhead'), seededRandom(0.5));
  assert.equal(cross.speciesId, 'molly_hybrid');
  assert.ok(cross.genes);
  assert.equal(planOffspring(f('molly_hybrid', { genes: cross.genes }), m('molly_hybrid', { genes: cross.genes })).speciesId, 'molly_hybrid');
  // ตรวจ fetus ที่รับมา
  assert.equal(sanitizeFetus({ speciesId: 'guppy' }, f('molly_golden'), m('molly_redhead')), null, 'ต่างกลุ่มพันธุ์');
  assert.equal(sanitizeFetus({ speciesId: 'molly_calico' }, f('molly_golden'), m('molly_redhead')), null, 'ไม่ใช่สีของพ่อ/แม่');
  assert.ok(sanitizeFetus({ speciesId: 'molly_hybrid' }, f('molly_golden'), m('molly_redhead')).genes, 'ลูกผสมต้องมียีนเสมอ');
});
