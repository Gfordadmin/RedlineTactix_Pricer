const test = require('node:test');
const assert = require('node:assert');
const E = require('../src/engine.client.js');

const base = () => {
  const p = E.blank('t');
  p.rates.oh = 20; p.rates.ga = 10; p.rates.profit = 10; p.rates.laborEsc = 0; p.rates.otherEsc = 0;
  p.lines = [
    Object.assign(E.newLine('labor'), { desc: 'Eng', qty: 100, unitCost: 50 }),
    Object.assign(E.newLine('material'), { desc: 'Parts', qty: 10, unitCost: 100 }),
  ];
  return p;
};

test('cost build-up: OH on labor, G&A on total, profit on cost', () => {
  const t = E.compute(base()).totals;
  // labor 5000 + OH 1000 + material 1000 = 7000; G&A 700 -> 7700; profit 770 -> 8470
  assert.equal(t.direct, 6000); assert.equal(t.oh, 1000); assert.equal(t.ga, 700);
  assert.equal(t.cost, 7700); assert.equal(t.profit, 770); assert.equal(t.price, 8470);
});

test('commercial mode ignores FCCOM and unallowable; federal applies them', () => {
  const p = base(); p.rates.fccom = 1; p.lines[1].unallowable = true;
  assert.equal(E.compute(p).totals.price, 8470);
  p.mode = 'federal';
  const t = E.compute(p).totals;
  assert.equal(t.fccom, 60); // (5000+1000)*1%
  assert.equal(t.direct, 5000); // material excluded as unallowable
  // profit excludes FCCOM: preProfit=5000+1000+600=6600 -> 660
  assert.equal(t.profit, 660); assert.equal(t.cost, 6660 + 0); 
});

test('mode switch does not change stored lines', () => {
  const p = base(); const snap = JSON.stringify(p.lines);
  p.mode = 'federal'; E.autoAssignClins(p); p.mode = 'commercial';
  assert.equal(E.compute(p).totals.price, 8470);
  assert.ok(p.lines.every((l) => l.clin));
  assert.notEqual(JSON.stringify(p.lines), snap); // CLINs added, costs untouched
});

test('multiyear escalation compounds', () => {
  const p = base(); p.periods = [{ name: 'B' }, { name: 'O1' }, { name: 'O2' }]; p.rates.laborEsc = 3;
  p.lines = [p.lines[0]];
  const r = E.compute(p);
  assert.equal(r.byPeriod[0].direct, 5000);
  assert.equal(r.byPeriod[1].direct, 5150);
  assert.equal(r.byPeriod[2].direct, 5304.5);
  assert.equal(E.periodsIncluded('2-3', 3).join(), '1,2');
});

test('rollups foot to totals', () => {
  const p = base(); p.periods = [{ name: 'a' }, { name: 'b' }]; p.rates.laborEsc = 3.3; p.rates.fringe = 7.7;
  p.mode = 'federal'; p.rates.fccom = 0.37; E.autoAssignClins(p);
  const r = E.compute(p);
  const s = E.rollup(r, (x) => x.clin).reduce((a, g) => a + g.total.price, 0);
  assert.ok(Math.abs(s - r.totals.price) < 0.005);
  const san = E.sanitize(p, r, 'subclin');
  const clinSum = san.rows.filter((x) => x.level === 0).reduce((a, x) => a + x.total, 0);
  assert.ok(Math.abs(clinSum - san.total) < 0.005);
});

test('margin method', () => {
  const p = base(); p.rates.profitMethod = 'margin'; p.rates.profit = 20;
  const t = E.compute(p).totals;
  assert.ok(Math.abs(E.margin(t) - 0.2) < 0.001);
});

test('solveProfit hits target', () => {
  const p = base();
  const s = E.solveProfit(p, 9000);
  p.rates.profit = s.markupPct;
  assert.ok(Math.abs(E.compute(p).totals.price - 9000) < 1);
});

test('what-if: slip raises cost and erodes fixed-price margin', () => {
  const p = base(); p.whatif.slip = 20;
  const w = E.whatIf(p);
  assert.ok(w.costDelta > 0); assert.ok(w.fixed.margin < E.margin(w.base));
  p.whatif.slip = -20; const a = E.whatIf(p);
  assert.ok(a.scen.direct < w.base.direct * 1.0001);
});

test('sanitized view leaks no internal cost detail', () => {
  const p = base(); p.lines[0].boe = 'SECRET-BOE'; p.lines[0].wbs = 'WBS-SECRET'; p.lines[0].desc = 'Engineering';
  [['commercial', 'line'], ['commercial', 'group'], ['federal', 'clin'], ['federal', 'subclin']].forEach(([m, d]) => {
    p.mode = m; if (m === 'federal') E.autoAssignClins(p);
    const s = JSON.stringify(E.sanitize(p, E.compute(p), d));
    ['SECRET', 'profit', 'fringe', 'unitCost', 'qty', 'margin', 'fccom'].forEach((k) => assert.ok(!s.includes(k), k + ' leaked in ' + m + '/' + d));
  });
});

test('PWS parsing finds tasks and option years', () => {
  const txt = `1.0 Background\nStuff.\n3.0 Tasks\n3.1 Program Management\nThe contractor shall manage.\n3.2 Software Development\nBuild things.\nThe period of performance is a base year and four option years.`;
  const r = E.parsePWS(txt);
  assert.deepEqual(r.tasks.map((t) => t.num), ['3.1', '3.2']);
  assert.equal(r.options, 4);
  const p = E.applyPWS(E.blank(), r, true);
  assert.equal(p.periods.length, 5); assert.equal(p.lines.length, 2);
});
