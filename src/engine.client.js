// Shared cost engine. Pure functions, no DOM. Runs in the browser (served by
// the Worker at /engine.js) and in Node (tests). Commercial and federal modes
// use this same engine; federal only switches on extra structure/factors.

export const LINE_TYPES = ["labor", "material", "odc", "sub"];
export const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(+v) ? +v : 0);

export function newProposal(mode = "commercial") {
  return {
    mode, // "commercial" (default) | "federal"
    name: "Untitled proposal",
    customer: "",
    periods: [{ name: "Year 1" }],
    rates: { fringe: 0, oh: 0, matHandling: 0, ga: 0, fccom: 0, fee: 10, gaOnSub: true },
    escalation: { labor: 3, material: 2, odc: 2, sub: 3 }, // % per year after the first period
    adjust: { direct: 0 }, // what-you-can-tune: % change to all direct costs
    whatIf: { variance: 0, laborElasticity: 1, otherElasticity: 0.3 },
    groups: [{ id: "1", title: "Quote item 1", parent: "", fee: null }], // commercial items == federal CLINs
    wbs: [],
    lines: [],
    pws: "",
  };
}

export function newLine(p, over = {}) {
  return {
    id: "L" + Math.random().toString(36).slice(2, 8),
    type: "labor", desc: "", category: "", rate: 0,
    qty: p.periods.map(() => 0), // hours / units per period
    group: p.groups[0]?.id || "", wbs: "", boe: "", unallowable: false,
    ...over,
  };
}

export const escFactor = (p, type, idx) => Math.pow(1 + num(p.escalation[type]) / 100, idx);

// scale: optional {labor, other} multipliers on quantity (what-if)
function priceLine(p, line, idx, rates, scale) {
  const fed = p.mode === "federal";
  const out = { direct: 0, fringe: 0, oh: 0, mh: 0, ga: 0, fccom: 0, cost: 0, fee: 0, price: 0, labor: 0, excluded: false };
  if (fed && line.unallowable) { out.excluded = true; return out; }
  const s = scale ? (line.type === "labor" ? scale.labor : scale.other) : 1;
  const base = num(line.qty[idx]) * num(line.rate) * escFactor(p, line.type, idx) * s * (1 + num(p.adjust.direct) / 100);
  out.direct = base;
  let gaBase = 0;
  if (line.type === "labor") {
    out.labor = base;
    out.fringe = base * num(rates.fringe) / 100;
    out.oh = (base + out.fringe) * num(rates.oh) / 100;
    gaBase = base + out.fringe + out.oh;
    if (fed) out.fccom = base * num(rates.fccom) / 100;
  } else if (line.type === "material") {
    out.mh = base * num(rates.matHandling) / 100;
    gaBase = base + out.mh;
  } else if (line.type === "odc") gaBase = base;
  else gaBase = rates.gaOnSub ? base : 0;
  out.ga = gaBase * num(rates.ga) / 100;
  // total cost input; FCCOM is an imputed cost: kept out of the G&A and fee bases
  const costNoFccom = base + out.fringe + out.oh + out.mh + out.ga;
  out.cost = costNoFccom + out.fccom;
  out.feeBase = costNoFccom;
  return out;
}

const ZERO = () => ({ direct: 0, fringe: 0, oh: 0, mh: 0, ga: 0, fccom: 0, cost: 0, fee: 0, price: 0, labor: 0 });
const add = (a, b) => { for (const k in a) a[k] += b[k] || 0; return a; };

export function groupFeePct(p, gid) {
  const g = p.groups.find((x) => x.id === gid);
  return g && g.fee !== null && g.fee !== "" && g.fee !== undefined && p.mode === "federal" ? num(g.fee) : num(p.rates.fee);
}

// Full compute. Returns per-period and total roll-ups by line, group, type, WBS.
export function compute(p, opts = {}) {
  const n = p.periods.length;
  const rates = { ...p.rates, ...(opts.rates || {}) };
  const scale = opts.scale || null;
  const res = { lines: {}, groups: {}, periods: [], total: ZERO(), byType: {}, byWbs: {} };
  for (let i = 0; i < n; i++) res.periods.push(ZERO());
  for (const g of p.groups) res.groups[g.id] = { own: Array.from({ length: n }, ZERO), total: ZERO() };
  for (const t of LINE_TYPES) res.byType[t] = ZERO();
  for (const line of p.lines) {
    const gid = res.groups[line.group] ? line.group : p.groups[0]?.id;
    const per = [];
    for (let i = 0; i < n; i++) {
      const o = priceLine(p, line, i, rates, scale);
      const feePct = groupFeePct(p, gid) + (opts.feeDelta || 0);
      o.fee = o.excluded ? 0 : (o.feeBase) * feePct / 100;
      o.price = o.cost + o.fee;
      per.push(o);
      add(res.groups[gid].own[i], o);
      add(res.groups[gid].total, o);
      add(res.periods[i], o);
      add(res.total, o);
      add(res.byType[line.type], o);
      const w = line.wbs || "(unmapped)";
      res.byWbs[w] = res.byWbs[w] || ZERO();
      add(res.byWbs[w], o);
    }
    res.lines[line.id] = per;
  }
  // roll sub-groups into parents (federal only)
  res.rolled = {};
  for (const g of p.groups) {
    const total = ZERO(); const pp = Array.from({ length: n }, ZERO);
    const kids = p.mode === "federal" ? p.groups.filter((k) => k.parent === g.id) : [];
    for (const m of [g, ...kids]) {
      add(total, res.groups[m.id].total);
      res.groups[m.id].own.forEach((o, i) => add(pp[i], o));
    }
    res.rolled[g.id] = { total, periods: pp };
  }
  finish(res.total);
  res.periods.forEach(finish);
  Object.values(res.byType).forEach(finish);
  Object.values(res.byWbs).forEach(finish);
  Object.values(res.rolled).forEach((r) => { finish(r.total); r.periods.forEach(finish); });
  return res;
}

function finish(t) {
  t.profit = t.price - t.cost;
  t.margin = t.price ? (t.profit / t.price) * 100 : 0; // profit / price
  t.roi = t.cost ? (t.profit / t.cost) * 100 : 0;       // profit / total cost
  return t;
}

// Delivery what-if: positive variance = delivery slips (more effort), negative = early/efficient.
// Price is held at the baseline (fixed-price exposure).
export function whatIf(p, variancePct) {
  const base = compute(p);
  const v = variancePct / 100;
  const w = p.whatIf;
  const scaled = compute(p, { scale: { labor: Math.max(0, 1 + v * num(w.laborElasticity)), other: Math.max(0, 1 + v * num(w.otherElasticity)) } });
  const cost = scaled.total.cost;
  const price = base.total.price;
  const profit = price - cost;
  return {
    baseCost: base.total.cost, cost, costDelta: cost - base.total.cost, price, profit,
    margin: price ? (profit / price) * 100 : 0, roi: cost ? (profit / cost) * 100 : 0,
    baseMargin: base.total.margin, baseProfit: base.total.profit,
  };
}

// ---- Outputs -------------------------------------------------------------
// Sanitized: grouped price per period only. No rates, cost elements, fee, margin, BOE, WBS.
export function sanitized(p) {
  const c = compute(p);
  const fed = p.mode === "federal";
  const rows = [];
  const top = p.groups.filter((g) => !fed || !g.parent || !p.groups.some((x) => x.id === g.parent));
  for (const g of top) {
    rows.push({ id: g.id, title: g.title, level: 0, periods: c.rolled[g.id].periods.map((x) => r2(x.price)), total: r2(c.rolled[g.id].total.price) });
    if (fed) for (const k of p.groups.filter((x) => x.parent === g.id)) {
      rows.push({ id: k.id, title: k.title, level: 1, periods: c.groups[k.id].own.map((x) => r2(x.price)), total: r2(c.groups[k.id].total.price) });
    }
  }
  return { name: p.name, customer: p.customer, periods: p.periods.map((x) => x.name), rows, periodTotals: c.periods.map((x) => r2(x.price)), total: r2(c.total.price) };
}

export function csvEscape(v) { const s = String(v ?? ""); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }
export const toCsv = (rows) => rows.map((r) => r.map(csvEscape).join(",")).join("\n");

export function sanitizedCsv(p) {
  const s = sanitized(p);
  return toCsv([["Item", "Description", ...s.periods, "Total"], ...s.rows.map((r) => [r.id, r.title, ...r.periods, r.total]), ["", "Total", ...s.periodTotals, s.total]]);
}

export function internalCsv(p) {
  const c = compute(p);
  const rows = [["Group", "Type", "Description", "Category", "WBS", "Period", "Qty", "Rate", "Direct", "Fringe", "OH", "MatHandling", "G&A", "FCCOM", "Total cost", "Fee", "Price", "BOE"]];
  for (const l of p.lines) l.qty.forEach((q, i) => { const o = c.lines[l.id][i]; rows.push([l.group, l.type, l.desc, l.category, l.wbs, p.periods[i].name, q, l.rate, ...["direct", "fringe", "oh", "mh", "ga", "fccom", "cost", "fee", "price"].map((k) => r2(o[k])), l.boe]); });
  return toCsv(rows);
}

// ---- PWS / SOW / SOO structuring ------------------------------------------
export function parseScope(text) {
  const lines = String(text || "").split(/\r?\n/);
  const secs = [];
  let cur = null;
  const head = /^\s*((?:\d+\.)*\d+)[.)]?\s+(\S.{0,120})$/;
  for (const raw of lines) {
    const m = head.exec(raw);
    if (m && !/[.;:]$/.test(m[2].trim()) && m[2].trim().split(/\s+/).length <= 14) {
      cur = { num: m[1], title: m[2].trim(), shalls: 0, level: m[1].split(".").length };
      secs.push(cur);
    } else if (cur) cur.shalls += (raw.match(/\bshall\b/gi) || []).length;
  }
  return secs;
}

// Turns parsed sections into groups (top-level) and WBS elements (all). Does not touch existing cost lines.
export function applyScope(p, secs) {
  if (!secs.length) return 0;
  const fed = p.mode === "federal";
  // Re-import replaces its own output: drop groups/WBS with no cost lines, never costed ones.
  p.groups = p.groups.filter((g) => p.lines.some((l) => l.group === g.id));
  p.wbs = p.wbs.filter((w) => p.lines.some((l) => l.wbs === w.id));
  p.groups.forEach((g) => { if (g.parent && !p.groups.some((x) => x.id === g.parent)) g.parent = ""; });
  for (const s of secs) {
    const id = s.num;
    if (!p.groups.some((g) => g.id === id) && (s.level === 1 || (fed && s.level === 2))) {
      const parent = s.level === 2 ? s.num.split(".")[0] : "";
      p.groups.push({ id, title: s.title, parent: p.groups.some((g) => g.id === parent) ? parent : "", fee: null });
    }
    if (!p.wbs.some((w) => w.id === s.num)) p.wbs.push({ id: s.num, title: s.title, shalls: s.shalls });
  }
  if (!p.groups.length) p.groups.push({ id: "1", title: "Quote item 1", parent: "", fee: null });
  return secs.length;
}

// ---- Compliance -----------------------------------------------------------
export function compliance(p) {
  const out = [];
  const c = compute(p);
  const add = (level, text) => out.push({ level, text });
  const r = p.rates;
  add("info", "Costs are built on an accrual basis, direct costs are separated from indirect, and indirect rates are applied consistently to the same bases on every line (GAAP / consistent cost accounting practice).");
  if (!p.lines.length) add("warn", "No cost lines yet.");
  if (p.lines.some((l) => !l.desc.trim())) add("warn", "Some cost lines have no description.");
  if (p.lines.some((l) => num(l.rate) <= 0)) add("warn", "Some lines have a zero rate.");
  if (num(r.oh) + num(r.ga) + num(r.fringe) === 0 && p.lines.some((l) => l.type === "labor")) add("warn", "No fringe, overhead or G&A set. Real labor carries indirect cost; confirm this is intentional.");
  if (num(p.adjust.direct) !== 0) add("warn", `Direct cost adjustment of ${p.adjust.direct}% is applied across all lines. Document it as a price-to-win decision, not as a cost estimate.`);
  if (num(r.fee) < 0) add("warn", "Negative profit: the proposal is priced below cost.");
  if (p.mode === "federal") {
    if (p.lines.some((l) => !l.boe.trim())) add("warn", "Federal mode: every cost element needs a Basis of Estimate. Some are blank.");
    if (p.lines.some((l) => !l.wbs)) add("warn", "Federal mode: some lines are not mapped to a WBS element.");
    if (num(r.fccom) > 0) add("info", "FCCOM is an imputed cost: it is kept out of the G&A and profit bases and should be tied to your CAS 414 / Form CASB-CMF computation.");
    if (p.lines.some((l) => l.unallowable)) add("info", "Lines marked unallowable are excluded from price (FAR 31.2 / 31.205).");
    add("info", "Profit is stated separately from cost and is not included in any indirect base (FAR 15.404-4).");
    add("info", "Rates must match your disclosed practices / provisional billing rates. This check is automated hygiene, not an accounting or legal opinion.");
  } else add("info", "Commercial mode: no federal structure required. Switch to Federal in the header to add CLINs, WBS, BOE and FCCOM; your lines carry over.");
  if (c.total.price && c.total.margin < 0) add("warn", "Overall margin is negative.");
  return out;
}

export function sampleProposal() {
  const p = newProposal("commercial");
  p.name = "Website & hosting build"; p.customer = "Example Customer, Inc.";
  p.periods = [{ name: "Year 1" }, { name: "Year 2" }];
  p.rates = { fringe: 25, oh: 40, matHandling: 3, ga: 8, fccom: 0.4, fee: 12, gaOnSub: true };
  p.groups = [{ id: "1", title: "Design & build", parent: "", fee: null }, { id: "2", title: "Hosting & support", parent: "", fee: null }];
  const L = (o) => newLine(p, o);
  p.lines = [
    L({ type: "labor", desc: "Senior developer", category: "Dev III", rate: 70, qty: [800, 0], group: "1", boe: "Comparable build, 5 sprints x 160 h" }),
    L({ type: "labor", desc: "Designer", category: "Design II", rate: 55, qty: [300, 0], group: "1", boe: "Per wireframe count" }),
    L({ type: "material", desc: "Licensed UI kit", rate: 1200, qty: [1, 0], group: "1", boe: "Vendor quote" }),
    L({ type: "labor", desc: "Support engineer", category: "Eng I", rate: 48, qty: [200, 520], group: "2", boe: "0.25 FTE yr1, 0.25 FTE yr2" }),
    L({ type: "odc", desc: "Travel", rate: 900, qty: [4, 2], group: "2" }),
    L({ type: "sub", desc: "Penetration test", rate: 6500, qty: [1, 1], group: "2", boe: "Subcontractor quote" }),
  ];
  return p;
}
