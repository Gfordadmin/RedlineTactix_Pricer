/*
 * Redline Tactix Pricer - shared cost engine.
 *
 * Pure functions, no DOM. Loaded in the browser as a classic script (global `Engine`)
 * and in Node via require() for tests. One engine serves BOTH modes:
 *   - commercial: federal-only layers (CLIN, WBS, BOE, FCCOM, unallowable) are ignored
 *   - federal:    those layers are switched on
 * Switching modes never changes stored data, so a proposal can start commercial and
 * move to federal later without re-entering anything.
 *
 * All money is rounded to cents at the line/period/element level so every rollup foots.
 */
const Engine = (function () {
  const F = ['direct', 'fringe', 'oh', 'mh', 'ga', 'fccom', 'profit', 'cost', 'price'];
  const r2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  const num = (v) => (isFinite(parseFloat(v)) ? parseFloat(v) : 0);
  const uid = () => Math.random().toString(36).slice(2, 9);
  const zero = () => Object.fromEntries(F.map((k) => [k, 0]));
  const add = (a, b) => { F.forEach((k) => (a[k] = r2(a[k] + b[k]))); return a; };

  function blank(name) {
    return {
      id: uid(),
      name: name || 'New proposal',
      customer: '',
      mode: 'commercial',
      periods: [{ name: 'Base Year' }],
      rates: {
        fringe: 0, oh: 0, mh: 0, ga: 0, profit: 10, profitMethod: 'markup',
        laborEsc: 3, otherEsc: 2, ohOnSub: false, gaOnSub: true, fccom: 0,
      },
      whatif: { slip: 0, laborSens: 100, otherSens: 50, accelPremium: 15, penaltyPct: 0 },
      clins: {}, // { "0001": "Title" } (federal)
      lines: [],
      pws: '',
      baseline: null,
    };
  }

  function newLine(type) {
    return {
      id: uid(), type: type || 'labor', desc: '', group: '', qty: 0, unitCost: 0, years: '',
      clin: '', subclin: '', wbs: '', boe: '', unallowable: false,
    };
  }

  // Fill in any missing fields (older saved data / imported JSON).
  function normalize(p) {
    const b = blank();
    const out = Object.assign({}, b, p);
    out.rates = Object.assign({}, b.rates, p.rates || {});
    out.whatif = Object.assign({}, b.whatif, p.whatif || {});
    out.periods = Array.isArray(p.periods) && p.periods.length ? p.periods : b.periods;
    out.lines = (p.lines || []).map((l) => Object.assign(newLine(l.type), l));
    out.clins = p.clins || {};
    if (!out.id) out.id = uid();
    return out;
  }

  function sample() {
    const p = blank('Sample: Website & Support Package');
    p.customer = 'Example Customer, Inc.';
    p.periods = [{ name: 'Year 1' }, { name: 'Year 2' }, { name: 'Year 3' }];
    p.rates.oh = 25; p.rates.ga = 8; p.rates.profit = 12;
    const L = (type, desc, group, qty, unitCost, extra) =>
      Object.assign(newLine(type), { desc, group, qty, unitCost }, extra || {});
    p.lines = [
      L('labor', 'Project manager', 'Management', 400, 62),
      L('labor', 'Senior engineer', 'Build', 1200, 70),
      L('labor', 'Support technician', 'Support', 900, 38),
      L('material', 'Hardware & licenses', 'Build', 10, 1800, { years: '1' }),
      L('odc', 'Travel', 'Management', 6, 950),
      L('sub', 'Specialty integration subcontractor', 'Build', 1, 18000, { years: '1-2' }),
    ];
    return p;
  }

  // "1,3" / "2-4" / "" (blank = all periods) -> sorted 0-based period indexes
  function periodsIncluded(str, n) {
    const s = String(str || '').trim();
    const all = Array.from({ length: n }, (_, i) => i);
    if (!s) return all;
    const set = new Set();
    s.split(',').forEach((tok) => {
      const m = tok.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
      if (!m) return;
      const a = +m[1], b = m[2] ? +m[2] : a;
      for (let k = Math.min(a, b); k <= Math.max(a, b); k++) if (k >= 1 && k <= n) set.add(k - 1);
    });
    return [...set].sort((x, y) => x - y);
  }

  // Convert the profit input to a markup-on-cost factor (shared by both methods).
  function markup(rates) {
    const v = num(rates.profit) / 100;
    if (rates.profitMethod === 'margin') return v >= 0.99 ? 99 : v / (1 - v);
    return v;
  }

  /*
   * compute(proposal, scen?) -> { records, totals, byPeriod, unallowable, n }
   * Cost build-up per line per period (all rounded to cents):
   *   direct   = qty x unit cost x escalation
   *   fringe   = labor only (optional; leave 0 if rates are already fully fringed)
   *   oh       = (labor + fringe) x OH%   [+ subs if ohOnSub]
   *   mh       = (material + ODC) x material-handling%
   *   ga       = (direct + fringe + oh + mh) x G&A%   [subs excluded if !gaOnSub]
   *   fccom    = federal only: (labor + fringe + oh) x FCCOM factor. An imputed cost
   *              (CAS 414): outside the G&A base and outside the profit base.
   *   cost     = direct + fringe + oh + mh + ga + fccom
   *   profit   = (cost - fccom) x markup
   *   price    = cost + profit
   * scen (what-if): { slip, laborSens, otherSens, accelPremium }
   */
  function compute(p, scen) {
    const fed = p.mode === 'federal';
    const R = p.rates;
    const n = p.periods.length;
    const mk = markup(R);
    const records = [];
    const unallowable = zero();
    let lm = 1, om = 1;
    if (scen && num(scen.slip) !== 0) {
      const s = num(scen.slip) / 100;
      lm = Math.max(0, 1 + (s * num(scen.laborSens)) / 100);
      om = Math.max(0, 1 + (s * num(scen.otherSens)) / 100);
      if (s < 0) lm *= 1 + num(scen.accelPremium) / 100; // overtime / surge premium
    }
    p.lines.forEach((l) => {
      periodsIncluded(l.years, n).forEach((i) => {
        const isLabor = l.type === 'labor';
        const esc = Math.pow(1 + num(isLabor ? R.laborEsc : R.otherEsc) / 100, i);
        const mult = isLabor ? lm : l.type === 'material' ? 1 : om;
        const direct = r2(num(l.qty) * mult * num(l.unitCost) * esc);
        const rec = zero();
        rec.direct = direct;
        const un = fed && l.unallowable;
        if (un) { add(unallowable, Object.assign(zero(), { direct, cost: direct, price: 0 })); return; }
        if (isLabor) rec.fringe = r2(direct * num(R.fringe) / 100);
        const ohBase = isLabor ? direct + rec.fringe : l.type === 'sub' && R.ohOnSub ? direct : 0;
        rec.oh = r2(ohBase * num(R.oh) / 100);
        if (l.type === 'material' || l.type === 'odc') rec.mh = r2(direct * num(R.mh) / 100);
        let gaBase = direct + rec.fringe + rec.oh + rec.mh;
        if (l.type === 'sub' && !R.gaOnSub) gaBase -= direct;
        rec.ga = r2(gaBase * num(R.ga) / 100);
        if (fed && isLabor) rec.fccom = r2((direct + rec.fringe + rec.oh) * num(R.fccom) / 100);
        const preProfit = direct + rec.fringe + rec.oh + rec.mh + rec.ga;
        rec.cost = r2(preProfit + rec.fccom);
        rec.profit = r2(preProfit * mk);
        rec.price = r2(rec.cost + rec.profit);
        records.push(Object.assign(rec, {
          lineId: l.id, period: i, type: l.type, desc: l.desc,
          group: l.group || '', clin: l.clin || '', subclin: l.subclin || '', wbs: l.wbs || '',
        }));
      });
    });
    const totals = zero();
    const byPeriod = Array.from({ length: n }, zero);
    records.forEach((r) => { add(totals, r); add(byPeriod[r.period], r); });
    return { records, totals, byPeriod, unallowable, n };
  }

  // Group records by key -> [{key, label, byPeriod[], total}] preserving first-seen order.
  function rollup(res, keyFn, labelFn) {
    const m = new Map();
    res.records.forEach((r) => {
      const k = keyFn(r);
      if (!m.has(k)) m.set(k, { key: k, label: labelFn ? labelFn(r, k) : k, byPeriod: Array.from({ length: res.n }, zero), total: zero() });
      const g = m.get(k);
      add(g.byPeriod[r.period], r); add(g.total, r);
    });
    return [...m.values()];
  }

  const margin = (t) => (t.price ? t.profit / t.price : 0);
  const roi = (t) => (t.cost ? t.profit / t.cost : 0);

  // Profit input needed to hit a target total price. Price is linear in markup.
  function solveProfit(p, targetPrice) {
    const q = JSON.parse(JSON.stringify(p));
    q.rates.profit = 0; q.rates.profitMethod = 'markup';
    const a = compute(q).totals.price;
    const base = compute(q).records.reduce((s, r) => s + (r.cost - r.fccom), 0);
    if (!base) return null;
    const mkp = (targetPrice - a) / base;
    return { markupPct: mkp * 100, marginPct: (mkp / (1 + mkp)) * 100, belowCost: mkp < 0 };
  }

  /*
   * What-if on delivery performance. slip > 0 = delivery runs long (labor / subs / ODC scale
   * up); slip < 0 = accelerated (fewer hours but a surge premium). Compares:
   *  - fixed price: price held at baseline, so the cost change lands on profit
   *  - cost-based: price re-computed from the new cost
   */
  function whatIf(p) {
    const w = p.whatif;
    const base = compute(p);
    const sc = compute(p, w);
    const slip = num(w.slip);
    const penalty = slip > 0 ? r2(base.totals.price * slip * num(w.penaltyPct) / 100) : 0;
    const fixedProfit = r2(base.totals.price - sc.totals.cost - penalty);
    return {
      base: base.totals, scen: sc.totals, penalty,
      costDelta: r2(sc.totals.cost - base.totals.cost),
      fixed: { price: base.totals.price, profit: fixedProfit, margin: base.totals.price ? fixedProfit / base.totals.price : 0, roi: sc.totals.cost ? fixedProfit / sc.totals.cost : 0 },
      costBased: { price: sc.totals.price, profit: sc.totals.profit, margin: margin(sc.totals), roi: roi(sc.totals) },
    };
  }

  /*
   * Submission (sanitized) view: prices only. Never emits rates, hours, unit costs, indirect
   * rates, profit, margin, WBS or BOE. Federal: CLIN / sub-CLIN pricing. Commercial: by line
   * item or by section.
   */
  function sanitize(p, res, detail) {
    const fed = p.mode === 'federal';
    const names = p.periods.map((x) => x.name);
    let rows;
    if (fed) {
      const subs = rollup(res, (r) => (r.clin || 'UNASSIGNED') + '|' + (r.subclin || ''));
      const clinKeys = [...new Set(subs.map((s) => s.key.split('|')[0]))].sort();
      rows = [];
      clinKeys.forEach((c) => {
        const mine = subs.filter((s) => s.key.split('|')[0] === c);
        const tot = zero(); const bp = Array.from({ length: res.n }, zero);
        mine.forEach((s) => { add(tot, s.total); s.byPeriod.forEach((x, i) => add(bp[i], x)); });
        rows.push({ ref: c, label: p.clins[c] || '', level: 0, prices: bp.map((x) => x.price), total: tot.price });
        if (detail === 'subclin') mine.forEach((s) => {
          const sc = s.key.split('|')[1];
          if (sc) rows.push({ ref: sc, label: lineLabel(p, res, s.key), level: 1, prices: s.byPeriod.map((x) => x.price), total: s.total.price });
        });
      });
    } else if (detail === 'group') {
      rows = rollup(res, (r) => r.group || 'General').map((g) => ({ ref: '', label: g.label, level: 0, prices: g.byPeriod.map((x) => x.price), total: g.total.price }));
    } else {
      rows = rollup(res, (r) => r.lineId).map((g) => {
        const l = p.lines.find((x) => x.id === g.key);
        return { ref: '', label: l ? l.desc || '(unnamed item)' : '', level: 0, prices: g.byPeriod.map((x) => x.price), total: g.total.price };
      });
    }
    return { title: p.name, customer: p.customer, periods: names, rows, periodTotals: res.byPeriod.map((x) => x.price), total: res.totals.price, federal: fed };
  }
  function lineLabel(p, res, key) {
    const [clin, sub] = key.split('|');
    const l = p.lines.find((x) => (x.clin || 'UNASSIGNED') === clin && (x.subclin || '') === sub);
    return l ? l.desc : '';
  }

  // Compliance / completeness checks. Informational - not an audit or certification.
  function validate(p) {
    const w = []; const fed = p.mode === 'federal'; const R = p.rates;
    if (!p.lines.length) w.push('No line items yet.');
    p.lines.forEach((l, i) => {
      const nm = l.desc || 'line ' + (i + 1);
      if (!l.desc) w.push(`Line ${i + 1}: missing description.`);
      if (num(l.qty) < 0 || num(l.unitCost) < 0) w.push(`${nm}: negative quantity or cost (credits should be explicit).`);
      if (!periodsIncluded(l.years, p.periods.length).length) w.push(`${nm}: "Periods" selects no valid period.`);
      if (fed) {
        if (!l.clin) w.push(`${nm}: no CLIN assigned.`);
        if (!l.wbs) w.push(`${nm}: no WBS element.`);
        if (!String(l.boe || '').trim()) w.push(`${nm}: no Basis of Estimate.`);
        if (l.unallowable) w.push(`${nm}: flagged unallowable - excluded from price (FAR 31.201-6), tracked separately.`);
      }
    });
    if (fed && !num(R.fccom)) w.push('FCCOM factor is 0 - enter your CASB-CMF/CAS 414 factor, or confirm you are not claiming FCCOM.');
    if (num(R.oh) === 0 && num(R.ga) === 0) w.push('No indirect rates set (OH and G&A are 0). Confirm this is intentional.');
    if (num(R.profit) < 0) w.push('Profit is negative - proposal is priced below cost.');
    if (R.profitMethod === 'margin' && num(R.profit) >= 99) w.push('Target margin is capped at 99%.');
    if (num(R.laborEsc) > 10 || num(R.otherEsc) > 10) w.push('Escalation above 10%/yr - document the basis.');
    return w;
  }

  // Assign missing CLINs by section (federal): CLIN 0001.. per section, sub-CLIN 0001AA.. per line.
  function autoAssignClins(p) {
    const groups = [];
    const ofLine = (l) => l.group || ({ labor: 'Labor', material: 'Material', odc: 'Other Direct Costs', sub: 'Subcontracts' })[l.type];
    p.lines.forEach((l) => { if (l.clin) return; const g = ofLine(l); if (!groups.includes(g)) groups.push(g); });
    const used = Object.keys(p.clins);
    const idOf = {};
    groups.forEach((g) => {
      let k = 1, id; do { id = String(k++).padStart(4, '0'); } while (used.includes(id));
      used.push(id); idOf[g] = id; p.clins[id] = g;
    });
    const count = {};
    p.lines.forEach((l) => {
      if (l.clin) return;
      const id = idOf[ofLine(l)];
      const c = (count[id] = (count[id] || 0) + 1) - 1;
      l.clin = id;
      if (!l.subclin) l.subclin = id + String.fromCharCode(65 + Math.floor(c / 26) % 26) + String.fromCharCode(65 + (c % 26));
    });
  }

  /*
   * Heuristic PWS/SOW/SOO structure extraction (no AI): finds numbered headings
   * ("3.1 Program Management", "Task 2: ...") and the period of performance.
   */
  function parsePWS(text) {
    const lines = String(text || '').split(/\r?\n/);
    const head = /^\s*(?:(?:Task|Section|Paragraph)\s+)?((?:[A-Z]\.)?\d+(?:\.\d+)*)\.?[\s:.\-–]+(\S.{2,100})$/i;
    const skip = /^(background|scope|introduction|purpose|definitions?|acronyms?|applicable documents|references|general|deliverables? schedule|period of performance|place of performance)\b/i;
    const hs = [];
    lines.forEach((ln, idx) => {
      const m = ln.match(head);
      if (m && !/[.;,]$/.test(m[2].trim()) && m[2].trim().split(/\s+/).length <= 14) {
        hs.push({ idx, num: m[1], title: m[2].trim(), depth: m[1].replace(/^[A-Z]\./i, '').replace(/(\.0)+$/, '').split('.').length });
      }
    });
    const d2 = hs.filter((h) => h.depth === 2).length;
    const want = d2 >= 2 ? 2 : 1;
    const tasks = [];
    hs.forEach((h, i) => {
      if (h.depth !== want || skip.test(h.title)) return;
      const end = hs.slice(i + 1).find((x) => x.depth <= want);
      const body = lines.slice(h.idx + 1, end ? end.idx : lines.length).join(' ').replace(/\s+/g, ' ').trim();
      tasks.push({ num: h.num, title: h.title, body });
    });
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
    const om = String(text).match(/\b(\d+|one|two|three|four|five|six|seven|eight|nine)\s*\(?\d*\)?\s*(?:\d+-?month\s+)?option\s+(?:year|period)s?/i);
    const options = om ? (words[om[1].toLowerCase()] || parseInt(om[1], 10) || 0) : 0;
    return { tasks, options };
  }

  // Create draft lines (labor, 0 hours) from parsed PWS tasks; optionally resize periods.
  function applyPWS(p, parsed, setPeriods) {
    if (setPeriods && parsed.options > 0) {
      p.periods = [{ name: 'Base Year' }].concat(Array.from({ length: parsed.options }, (_, i) => ({ name: 'Option Year ' + (i + 1) })));
    }
    parsed.tasks.forEach((t) => {
      p.lines.push(Object.assign(newLine('labor'), {
        desc: t.title, group: t.num + ' ' + t.title, wbs: t.num,
        boe: 'PWS ' + t.num + '. Requirement: ' + t.body.slice(0, 300) + (t.body.length > 300 ? '...' : '') + '\nBasis of estimate: (enter hours rationale - historical actuals, analogous effort, or parametric).',
      }));
    });
    return p;
  }

  const api = { F, r2, blank, newLine, normalize, sample, periodsIncluded, markup, compute, rollup, margin, roi, solveProfit, whatIf, sanitize, validate, autoAssignClins, parsePWS, applyPWS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  return api;
})();
