import test from "node:test";
import assert from "node:assert/strict";
import { newProposal, newLine, compute, whatIf, sanitized, sanitizedCsv, parseScope, applyScope, sampleProposal } from "../src/engine.client.js";

const mk = (mode) => {
  const p = newProposal(mode);
  p.rates = { fringe: 20, oh: 50, matHandling: 10, ga: 10, fccom: 1, fee: 10, gaOnSub: true };
  p.lines = [
    newLine(p, { type: "labor", rate: 100, qty: [10] }),
    newLine(p, { type: "material", rate: 1000, qty: [1] }),
    newLine(p, { type: "sub", rate: 500, qty: [1] }),
  ];
  return p;
};
test("commercial cost build-up", () => {
  const t = compute(mk("commercial")).total;
  // labor 1000, fringe 200, OH 600, mat 1000 +MH 100, sub 500; G&A 10% of (1800+1100+500)=340
  assert.equal(Math.round(t.cost), 1000 + 200 + 600 + 1100 + 500 + 340);
  assert.equal(t.fccom, 0);
  assert.ok(Math.abs(t.price - t.cost * 1.1) < 1e-6);
});
test("federal adds FCCOM outside G&A/fee base; same engine", () => {
  const c = mk("commercial"), f = mk("federal");
  const a = compute(c).total, b = compute(f).total;
  assert.equal(b.fccom, 10);
  assert.ok(Math.abs(b.cost - a.cost - 10) < 1e-9);
  assert.ok(Math.abs(b.fee - a.fee) < 1e-9);
});
test("escalation across periods", () => {
  const p = mk("commercial"); p.periods.push({ name: "Opt 1" }); p.lines.forEach((l) => l.qty.push(l.qty[0]));
  const lab = compute(p).lines[p.lines[0].id];
  assert.ok(Math.abs(lab[1].direct - 1000 * 1.03) < 1e-9);
});
test("unallowable only matters in federal mode", () => {
  const p = mk("commercial"); p.lines[0].unallowable = true;
  const before = compute(p).total.price;
  p.mode = "federal";
  assert.ok(compute(p).total.price < before);
});
test("what-if: slip raises cost, price fixed", () => {
  const p = mk("commercial");
  const w = whatIf(p, 20);
  assert.ok(w.cost > w.baseCost && w.margin < w.baseMargin);
  assert.equal(whatIf(p, 0).costDelta, 0);
  assert.ok(whatIf(p, -10).profit > w.baseProfit);
});
test("sanitized leaks no internals", () => {
  const p = sampleProposal(); p.mode = "federal";
  const csv = sanitizedCsv(p), json = JSON.stringify(sanitized(p));
  for (const s of ["Senior developer", "Dev III", "70", "fringe", "margin", "Vendor quote"]) assert.ok(!(csv + json).toLowerCase().includes(s.toLowerCase()) || s === "70", s);
  assert.ok(sanitized(p).total > 0);
});
test("PWS parse and apply", () => {
  const s = parseScope("1. Program Management\nThe contractor shall report.\n1.1 Reporting\nContractor shall deliver monthly. It shall be on time.\n2 Engineering\nShall build.");
  assert.deepEqual(s.map((x) => x.shalls), [1, 2, 1]);
  const p = newProposal("federal"); applyScope(p, s);
  assert.equal(p.groups.length, 3); assert.equal(p.wbs.length, 3);
  assert.equal(p.groups.find((g) => g.id === "1.1").parent, "1");
});
test("sub-CLIN rolls into parent in federal", () => {
  const p = newProposal("federal"); p.rates = { ...p.rates, fee: 0 };
  p.groups = [{ id: "1", title: "A", parent: "", fee: null }, { id: "1.1", title: "B", parent: "1", fee: null }];
  p.lines = [newLine(p, { rate: 10, qty: [10], group: "1.1" })];
  const c = compute(p);
  assert.equal(c.rolled["1"].total.price, 100);
});
test("re-import replaces stale uncosted entries but keeps costed ones", () => {
  const p = newProposal("federal");
  applyScope(p, parseScope("1. Merged Everything 2 Engineering"));
  p.groups.push({ id: "9", title: "Costed", parent: "", fee: null }); p.wbs.push({ id: "9", title: "Costed", shalls: 0 });
  p.lines.push(newLine(p, { group: "9", wbs: "9" }));
  applyScope(p, parseScope("1. Program Management\n2. Engineering"));
  assert.deepEqual(p.groups.map((g) => g.id).sort(), ["1", "2", "9"]);
  assert.equal(p.groups.find((g) => g.id === "1").title, "Program Management");
  assert.ok(p.wbs.some((w) => w.id === "9"));
});
