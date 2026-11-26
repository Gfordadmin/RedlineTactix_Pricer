/* Redline Tactix Pricer - UI. Depends on global `Engine` (engine.client.js). */
(function () {
  const E = Engine;
  const KEY = 'rtp.v1';
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => (n < 0 ? '-' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pct = (x) => (isFinite(x) ? (x * 100).toFixed(1) + '%' : '-');
  const cls = (n) => (n > 0 ? 'neg' : n < 0 ? 'pos' : '');

  // ---------- storage ----------
  let store = (function () {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.proposals && s.proposals.length) { s.proposals = s.proposals.map(E.normalize); return s; }
    } catch (e) { /* fall through */ }
    const p = E.sample();
    return { proposals: [p], current: p.id };
  })();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* quota/private mode */ } };
  const cur = () => store.proposals.find((p) => p.id === store.current) || store.proposals[0];
  let tab = 'setup';
  let detail = { commercial: 'line', federal: 'subclin' };
  let res;

  const TABS = [['setup', 'Setup & rates'], ['lines', 'Line items'], ['pws', 'PWS / SOW / SOO'], ['analysis', 'Competitive & what-if'], ['internal', 'Internal view'], ['submission', 'Submission view']];
  const TYPES = { labor: 'Labor', material: 'Material', odc: 'ODC', sub: 'Subcontract' };

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: type || 'text/plain' }));
    a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const csvCell = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  const toCsv = (rows) => rows.map((r) => r.map(csvCell).join(',')).join('\n');
  const slug = (s) => String(s || 'proposal').replace(/[^a-z0-9]+/gi, '-').toLowerCase();

  // ---------- header ----------
  function renderHeader() {
    const p = cur();
    $('#psel').innerHTML = store.proposals.map((x) => `<option value="${esc(x.id)}"${x.id === p.id ? ' selected' : ''}>${esc(x.name)}</option>`).join('');
    $('#m-commercial').className = p.mode === 'commercial' ? 'on' : '';
    $('#m-federal').className = p.mode === 'federal' ? 'on' : '';
    $('#tabs').innerHTML = TABS.map(([k, l]) => `<button data-tab="${k}" class="${k === tab ? 'on' : ''}">${l}</button>`).join('');
  }
  function renderKpis() {
    const t = res.totals;
    const k = (l, v, c) => `<div class="kpi"><small>${l}</small><b class="${c || ''}">${v}</b></div>`;
    $('#kpis').innerHTML = k('Total price', money(t.price)) + k('Total cost', money(t.cost)) + k('Profit / fee', money(t.profit)) + k('Margin (profit ÷ price)', pct(E.margin(t))) + k('ROI (profit ÷ cost)', pct(E.roi(t)));
  }

  // ---------- setup ----------
  const inp = (path, label, type, extra) => {
    const v = path.split('.').reduce((o, k) => o[k], cur());
    return `<label class="f">${label}<input data-path="${path}" ${type === 'number' ? 'data-num type="number" step="any"' : 'type="text"'} value="${esc(v)}" ${extra || ''}></label>`;
  };
  function tabSetup() {
    const p = cur(), R = p.rates, fed = p.mode === 'federal';
    return `
<div class="card"><h3>Proposal</h3><div class="grid">${inp('name', 'Proposal name')}${inp('customer', 'Customer / solicitation')}</div></div>
<div class="card"><h3>Pricing periods (base + options)</h3>
<div class="row" id="periods">${p.periods.map((x, i) => `<label class="f">Period ${i + 1}<input type="text" data-period="${i}" value="${esc(x.name)}"></label>`).join('')}
<button data-act="addPeriod">+ Add period</button><button data-act="delPeriod" ${p.periods.length < 2 ? 'disabled' : ''}>− Remove last</button></div>
<p class="mut">Line items choose which periods they apply to (blank = all). Unit costs are entered in base-year dollars and escalated by the rates below, compounding each period.</p>
<div class="grid">${inp('rates.laborEsc', 'Labor escalation % / yr', 'number')}${inp('rates.otherEsc', 'Material / ODC / sub escalation % / yr', 'number')}</div></div>
<div class="card"><h3>Indirect rates &amp; profit</h3><div class="grid">
${inp('rates.fringe', 'Fringe % of labor (0 if rates are already fully fringed)', 'number')}
${inp('rates.oh', 'Overhead % (on labor + fringe)', 'number')}
${inp('rates.mh', 'Material handling % (material + ODC)', 'number')}
${inp('rates.ga', 'G&A % (on total direct + OH)', 'number')}
${inp('rates.profit', 'Profit / fee %', 'number')}
<label class="f">Profit % means<select data-path="rates.profitMethod"><option value="markup"${R.profitMethod === 'markup' ? ' selected' : ''}>Markup on cost</option><option value="margin"${R.profitMethod === 'margin' ? ' selected' : ''}>Margin on price</option></select></label>
<label class="f">Apply OH to subcontracts<select data-path="rates.ohOnSub" data-bool><option value="false"${!R.ohOnSub ? ' selected' : ''}>No</option><option value="true"${R.ohOnSub ? ' selected' : ''}>Yes</option></select></label>
<label class="f">Apply G&A to subcontracts<select data-path="rates.gaOnSub" data-bool><option value="true"${R.gaOnSub ? ' selected' : ''}>Yes</option><option value="false"${!R.gaOnSub ? ' selected' : ''}>No</option></select></label>
</div>
<p class="mut">Use the same rates and allocation bases you use in your books, applied consistently across proposals (GAAP consistency). Order: direct → OH → material handling → G&amp;A → profit.</p></div>
${fed ? `<div class="card fed"><h3>Federal layer</h3><div class="grid">${inp('rates.fccom', 'FCCOM factor % (of labor + fringe + OH)', 'number')}</div>
<p class="mut">FCCOM is an imputed cost (CAS 414 / FAR 31.205-10): it is excluded from the G&amp;A base and from the profit base. Enter the factor from your CASB-CMF.</p>
<h3>CLIN titles</h3><div class="grid">${clinList().map((c) => `<label class="f">CLIN ${esc(c)}<input type="text" data-clin="${esc(c)}" value="${esc(p.clins[c] || '')}"></label>`).join('') || '<span class="mut">No CLINs yet - use "Auto-assign CLINs" on the Line items tab.</span>'}</div></div>`
  : `<div class="card"><h3>Need federal (CLINs, WBS, BOE, FCCOM)?</h3><p class="mut">Switch to <b>Federal</b> in the header at any time. Everything you entered stays; federal fields are added on top.</p></div>`}`;
  }
  const clinList = () => [...new Set(cur().lines.map((l) => l.clin).filter(Boolean).concat(Object.keys(cur().clins)))].sort();

  // ---------- lines ----------
  function tabLines() {
    const p = cur(), fed = p.mode === 'federal';
    const missing = fed && p.lines.some((l) => !l.clin);
    const head = `<tr><th>Type</th><th>Description</th><th>Section</th><th class="n">Qty (hrs/units)</th><th class="n">Unit cost / rate</th><th>Periods</th>${fed ? '<th>CLIN</th><th>Sub-CLIN</th><th>WBS</th><th title="Unallowable per FAR 31.201-6: excluded from price">Unalw.</th>' : ''}<th class="n">Price</th><th></th></tr>`;
    const rows = p.lines.map((l) => {
      const o = (k) => `data-line="${l.id}" data-f="${k}"`;
      return `<tr class="line"><td><select ${o('type')}>${Object.entries(TYPES).map(([k, v]) => `<option value="${k}"${l.type === k ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
<td><input type="text" ${o('desc')} value="${esc(l.desc)}" placeholder="${l.type === 'labor' ? 'Labor category / task' : 'Item'}"></td>
<td><input type="text" ${o('group')} value="${esc(l.group)}" placeholder="optional"></td>
<td class="n"><input type="number" step="any" data-num ${o('qty')} value="${esc(l.qty)}"></td>
<td class="n"><input type="number" step="any" data-num ${o('unitCost')} value="${esc(l.unitCost)}"></td>
<td><input type="text" ${o('years')} value="${esc(l.years)}" placeholder="all" style="width:70px" title="e.g. 1,3 or 2-4"></td>
${fed ? `<td class="fed"><input type="text" ${o('clin')} value="${esc(l.clin)}" style="width:62px"></td><td class="fed"><input type="text" ${o('subclin')} value="${esc(l.subclin)}" style="width:72px"></td><td class="fed"><input type="text" ${o('wbs')} value="${esc(l.wbs)}" style="width:62px"></td><td class="fed"><input type="checkbox" ${o('unallowable')} ${l.unallowable ? 'checked' : ''}></td>` : ''}
<td class="n" id="lp-${l.id}"></td>
<td class="n"><button data-act="dupLine" data-id="${l.id}" title="Duplicate">⧉</button><button data-act="delLine" data-id="${l.id}" title="Delete">✕</button></td></tr>
${fed ? `<tr class="fed"><td></td><td colspan="${6 + 4}"><textarea rows="2" ${o('boe')} placeholder="Basis of Estimate - rationale for these hours/quantities and rates (historical actuals, analogous, parametric, vendor quote...)">${esc(l.boe)}</textarea></td><td></td><td></td></tr>` : ''}`;
    }).join('');
    return `<div class="card"><div class="row noprint" style="margin-bottom:8px">
${Object.entries(TYPES).map(([k, v]) => `<button class="pri" data-act="addLine" data-type="${k}">+ ${v}</button>`).join('')}
${fed ? '<button data-act="autoClin">Auto-assign CLINs</button>' : ''}</div>
${missing ? '<div class="warn">Some lines have no CLIN yet. They roll up under "UNASSIGNED" until assigned (try Auto-assign CLINs).</div>' : ''}
<div class="scroll"><table><thead>${head}</thead><tbody>${rows || '<tr><td colspan="12" class="mut">No lines yet. Add one above, or build from a PWS.</td></tr>'}</tbody></table></div>
<p class="mut">Price is fully loaded (indirects and profit included) across all selected periods. ${fed ? 'Federal columns shaded.' : ''}</p></div>`;
  }
  function updateLinePrices() {
    const by = {};
    res.records.forEach((r) => { by[r.lineId] = (by[r.lineId] || 0) + r.price; });
    cur().lines.forEach((l) => { const e = $('#lp-' + l.id); if (e) e.textContent = money(by[l.id] || 0); });
  }

  // ---------- PWS ----------
  function tabPws() {
    const p = cur();
    return `<div class="card"><h3>Paste or upload a PWS / SOW / SOO</h3>
<textarea id="pwsText" rows="14" placeholder="Paste text here, or upload a .txt/.md file. Numbered headings such as &quot;3.1 Program Management&quot; become draft work elements.">${esc(p.pws)}</textarea>
<div class="row noprint" style="margin-top:8px"><input type="file" id="pwsFile" accept=".txt,.md,.text"><button class="pri" data-act="pwsParse">Preview structure</button></div>
<div id="pwsOut"></div>
<p class="mut">Parsing is rule-based (no AI): it looks for numbered/“Task n” headings and a base + N option years statement. Word/PDF files: copy the text and paste it here. Review everything it proposes.</p></div>`;
  }
  function pwsPreview() {
    const p = cur();
    p.pws = $('#pwsText').value; save();
    const r = E.parsePWS(p.pws);
    $('#pwsOut').innerHTML = r.tasks.length ? `<h3>Found ${r.tasks.length} work elements${r.options ? ` and ${r.options} option year(s)` : ''}</h3>
<table><tr><th>#</th><th>Title</th><th>Excerpt</th></tr>${r.tasks.map((t) => `<tr><td>${esc(t.num)}</td><td>${esc(t.title)}</td><td class="mut">${esc(t.body.slice(0, 140))}</td></tr>`).join('')}</table>
<div class="row noprint" style="margin-top:8px"><button class="pri" data-act="pwsApply">Add as draft line items${p.mode === 'federal' ? ' (with WBS + BOE stubs)' : ''}</button>${r.options ? `<label><input type="checkbox" id="pwsPer" checked> also set periods to base + ${r.options} option years</label>` : ''}</div>`
      : '<div class="warn">No numbered headings found. Add lines manually, or add numbering such as "1.1 Task name".</div>';
  }

  // ---------- analysis ----------
  function slider(path, label, min, max, step) {
    const v = path.split('.').reduce((o, k) => o[k], cur());
    return `<label class="f">${label}<span class="row"><input type="range" data-path="${path}" data-num min="${min}" max="${max}" step="${step}" value="${v}" style="flex:1"><input type="number" data-path="${path}" data-num step="any" value="${v}"></span></label>`;
  }
  function tabAnalysis() {
    const p = cur(), w = p.whatif;
    return `<div class="card"><h3>Adjust to be competitive</h3><div class="grid">${slider('rates.profit', 'Profit / fee %', 0, 40, 0.1)}${slider('rates.oh', 'Overhead %', 0, 150, 0.5)}${slider('rates.ga', 'G&A %', 0, 40, 0.1)}${slider('rates.fringe', 'Fringe %', 0, 60, 0.5)}</div>
<div class="row" style="margin-top:8px"><button data-act="lockBase">Lock current as baseline</button><button data-act="clearBase">Clear baseline</button>
<label>Target total price <input type="number" step="any" id="target" value="${esc(p.target || '')}" data-path="target" data-num style="width:130px"></label></div>
<div id="an-solve"></div></div>
<div id="an-out"></div>
<div class="card"><h3>What-if: delivery performance</h3>
<div class="grid">${slider('whatif.slip', 'Delivery slip % (+ late / − early)', -50, 100, 1)}${inp('whatif.laborSens', 'Labor sensitivity % (100 = proportional)', 'number')}${inp('whatif.otherSens', 'Sub/ODC sensitivity %', 'number')}${inp('whatif.accelPremium', 'Acceleration premium % on labor (if early)', 'number')}${inp('whatif.penaltyPct', 'Late penalty % of price per 1% slip', 'number')}</div>
<div id="wi-out"></div>
<p class="mut">Slip stretches labor, subcontract and ODC effort (material unchanged); negative values compress effort but add the premium. Assumptions are yours to set - defaults are placeholders.</p></div>`;
  }
  const delta = (a, b, f) => { const d = a - b; return `<span class="${cls(f ? -d : d)}">${d === 0 ? '-' : (d > 0 ? '+' : '') + money(d)}</span>`; };
  function updateAnalysis() {
    const p = cur(), t = res.totals, b = p.baseline;
    if (!$('#an-out')) return;
    $('#an-out').innerHTML = `<div class="card"><h3>Result${b ? ' vs. locked baseline' : ''}</h3><table><tr><th></th><th class="n">Current</th>${b ? '<th class="n">Baseline</th><th class="n">Change</th>' : ''}</tr>
${[['Total cost', 'cost'], ['Profit', 'profit'], ['Total price', 'price']].map(([l, k]) => `<tr><td>${l}</td><td class="n">${money(t[k])}</td>${b ? `<td class="n">${money(b[k])}</td><td class="n">${delta(t[k], b[k], k !== 'price' && false)}</td>` : ''}</tr>`).join('')}
<tr><td>Margin</td><td class="n">${pct(E.margin(t))}</td>${b ? `<td class="n">${pct(E.margin(b))}</td><td class="n">${((E.margin(t) - E.margin(b)) * 100).toFixed(1)} pts</td>` : ''}</tr>
<tr><td>ROI</td><td class="n">${pct(E.roi(t))}</td>${b ? `<td class="n">${pct(E.roi(b))}</td><td class="n">${((E.roi(t) - E.roi(b)) * 100).toFixed(1)} pts</td>` : ''}</tr></table></div>`;
    const tp = parseFloat(p.target);
    const s = tp > 0 ? E.solveProfit(p, tp) : null;
    $('#an-solve').innerHTML = s ? `<p>To reach <b>${money(tp)}</b> you need profit of <b>${s.markupPct.toFixed(2)}%</b> markup on cost (= <b>${s.marginPct.toFixed(2)}%</b> margin on price)${s.belowCost ? ' - <span class="neg">below cost: this target loses money at current costs</span>' : ''}. <button data-act="applyTarget">Apply</button></p>` : '';
    const w = E.whatIf(p);
    $('#wi-out').innerHTML = `<table style="margin-top:8px"><tr><th></th><th class="n">Baseline</th><th class="n">Scenario cost</th><th class="n">Change</th></tr>
<tr><td>Total cost</td><td class="n">${money(w.base.cost)}</td><td class="n">${money(w.scen.cost)}</td><td class="n">${delta(w.scen.cost, w.base.cost)}</td></tr>
${w.penalty ? `<tr><td>Late penalty</td><td class="n">-</td><td class="n">${money(w.penalty)}</td><td class="n"><span class="neg">+${money(w.penalty)}</span></td></tr>` : ''}</table>
<table style="margin-top:8px"><tr><th>If the contract is…</th><th class="n">Price</th><th class="n">Profit</th><th class="n">Margin</th><th class="n">ROI</th></tr>
<tr><td>Fixed price (price held, cost absorbs the change)</td><td class="n">${money(w.fixed.price)}</td><td class="n">${money(w.fixed.profit)}</td><td class="n">${pct(w.fixed.margin)}</td><td class="n">${pct(w.fixed.roi)}</td></tr>
<tr><td>Cost-based (price follows cost)</td><td class="n">${money(w.costBased.price)}</td><td class="n">${money(w.costBased.profit)}</td><td class="n">${pct(w.costBased.margin)}</td><td class="n">${pct(w.costBased.roi)}</td></tr></table>`;
  }

  // ---------- internal ----------
  const colHead = (p) => p.periods.map((x) => `<th class="n">${esc(x.name)}</th>`).join('') + '<th class="n">Total</th>';
  const cells = (arr, tot, k) => arr.map((x) => `<td class="n">${money(x[k])}</td>`).join('') + `<td class="n">${money(tot[k])}</td>`;
  function tabInternal() {
    const p = cur(), fed = p.mode === 'federal', T = res.totals;
    const byType = E.rollup(res, (r) => r.type);
    const typ = (t) => byType.find((g) => g.key === t);
    const empty = { byPeriod: res.byPeriod.map(() => Object.fromEntries(E.F.map((k) => [k, 0]))), total: Object.fromEntries(E.F.map((k) => [k, 0])) };
    const row = (label, g, k, c) => `<tr class="${c || ''}"><td>${label}</td>${cells(g.byPeriod, g.total, k)}</tr>`;
    const tot = { byPeriod: res.byPeriod, total: T };
    const ind = (label, k) => row(label, tot, k, 'sub');
    const build = `<table><thead><tr><th>Cost element</th>${colHead(p)}</tr></thead><tbody>
${Object.keys(TYPES).map((t) => row('Direct ' + TYPES[t].toLowerCase(), typ(t) || empty, 'direct')).join('')}
${row('Total direct', tot, 'direct', 'tot')}
${ind('Fringe', 'fringe')}${ind('Overhead', 'oh')}${ind('Material handling', 'mh')}${ind('G&A', 'ga')}${fed ? ind('FCCOM (imputed, outside G&A and profit bases)', 'fccom') : ''}
${row('Total cost', tot, 'cost', 'tot')}${row('Profit / fee', tot, 'profit')}${row('TOTAL PRICE', tot, 'price', 'hi')}</tbody></table>`;
    const keyFn = fed ? (r) => (r.clin || 'UNASSIGNED') + '|' + (r.subclin || '') : (r) => r.group || 'General';
    const groups = E.rollup(res, keyFn, (r) => (fed ? (r.clin || 'UNASSIGNED') + (r.subclin ? ' / ' + r.subclin : '') : r.group || 'General')).sort((a, b) => (a.key < b.key ? -1 : 1));
    const rollTbl = `<table><thead><tr><th>${fed ? 'CLIN / sub-CLIN' : 'Section'}</th>${fed ? '<th>Title</th>' : ''}<th class="n">Direct</th><th class="n">Indirect</th><th class="n">FCCOM</th><th class="n">Cost</th><th class="n">Profit</th><th class="n">Price</th><th class="n">Margin</th></tr></thead><tbody>
${groups.map((g) => { const t = g.total; return `<tr><td>${esc(g.label)}</td>${fed ? `<td class="mut">${esc(p.clins[g.key.split('|')[0]] || '')}</td>` : ''}<td class="n">${money(t.direct)}</td><td class="n">${money(t.fringe + t.oh + t.mh + t.ga)}</td><td class="n">${money(t.fccom)}</td><td class="n">${money(t.cost)}</td><td class="n">${money(t.profit)}</td><td class="n">${money(t.price)}</td><td class="n">${pct(E.margin(t))}</td></tr>`; }).join('')}</tbody></table>`;
    const wbs = fed ? E.rollup(res, (r) => r.wbs || '(none)') : [];
    const wbsTbl = fed ? `<div class="card"><h3>WBS rollup</h3><table><tr><th>WBS</th><th class="n">Direct</th><th class="n">Indirect + FCCOM</th><th class="n">Price</th></tr>${wbs.map((g) => `<tr><td>${esc(g.label)}</td><td class="n">${money(g.total.direct)}</td><td class="n">${money(g.total.cost - g.total.direct)}</td><td class="n">${money(g.total.price)}</td></tr>`).join('')}</table></div>` : '';
    const lines = p.lines.map((l) => {
      const rs = res.records.filter((r) => r.lineId === l.id);
      const s = (k) => rs.reduce((a, r) => a + r[k], 0);
      return `<tr><td>${TYPES[l.type]}</td><td>${esc(l.desc)}${fed && l.boe ? `<div class="mut">BOE: ${esc(l.boe)}</div>` : ''}</td>${fed ? `<td>${esc(l.clin)} ${esc(l.subclin)}</td><td>${esc(l.wbs)}</td>` : ''}<td class="n">${esc(l.qty)}</td><td class="n">${esc(l.unitCost)}</td><td>${esc(l.years || 'all')}</td><td class="n">${money(s('direct'))}</td><td class="n">${money(s('cost') - s('direct'))}</td><td class="n">${money(s('profit'))}</td><td class="n">${money(s('price'))}</td></tr>`;
    }).join('');
    const warns = E.validate(p);
    const un = res.unallowable.direct;
    return `<div class="banner">INTERNAL - COMPANY CONFIDENTIAL - NOT FOR SUBMISSION</div>
<div class="row noprint" style="margin-bottom:8px"><button class="pri" onclick="window.print()">Print / PDF</button><button data-act="csvInternal">Export CSV</button></div>
<div class="card"><h3>${esc(p.name)} - cost build-up by period (${fed ? 'Federal' : 'Commercial'})</h3><div class="scroll">${build}</div></div>
<div class="card"><h3>Rollup by ${fed ? 'CLIN / sub-CLIN' : 'section'}</h3><div class="scroll">${rollTbl}</div></div>${wbsTbl}
<div class="card"><h3>Line detail (all periods)</h3><div class="scroll"><table><thead><tr><th>Type</th><th>Description</th>${fed ? '<th>CLIN</th><th>WBS</th>' : ''}<th class="n">Qty</th><th class="n">Rate</th><th>Periods</th><th class="n">Direct</th><th class="n">Burden</th><th class="n">Profit</th><th class="n">Price</th></tr></thead><tbody>${lines}</tbody></table></div></div>
${un ? `<div class="warn">Unallowable costs excluded from price: ${money(un)} (tracked, not billed).</div>` : ''}
<div class="card"><h3>Checks</h3>${warns.length ? warns.map((x) => `<div class="warn">${esc(x)}</div>`).join('') : '<span class="pos">No issues found.</span>'}</div>`;
  }

  // ---------- submission ----------
  function sanitized() { const p = cur(); return E.sanitize(p, res, detail[p.mode]); }
  function tabSubmission() {
    const p = cur(), s = sanitized(), fed = p.mode === 'federal';
    const opts = fed ? [['clin', 'CLIN level'], ['subclin', 'CLIN + sub-CLIN']] : [['line', 'Line item'], ['group', 'Section']];
    return `<div class="row noprint" style="margin-bottom:8px"><button class="pri" onclick="window.print()">Print / PDF</button><button data-act="csvSubmit">Export CSV</button>
<label>Detail <select id="detail">${opts.map(([k, l]) => `<option value="${k}"${detail[p.mode] === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
<span class="mut">Shows prices only - no rates, hours, indirects, profit, margin, WBS or BOE.</span></div>
<div class="card"><h2 style="margin:0">${esc(s.title)}</h2>${s.customer ? `<div class="mut">Prepared for: ${esc(s.customer)}</div>` : ''}<h3 style="margin-top:14px">Price proposal</h3>
<div class="scroll"><table><thead><tr>${fed ? '<th>CLIN</th>' : ''}<th>${fed ? 'Description' : 'Item'}</th>${s.periods.map((x) => `<th class="n">${esc(x)}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>
${s.rows.map((r) => `<tr class="${r.level ? 'sub' : ''}">${fed ? `<td>${r.level ? '&nbsp;&nbsp;' : ''}${esc(r.ref)}</td><td>${esc(r.label)}</td>` : `<td>${esc(r.label)}</td>`}${r.prices.map((v) => `<td class="n">${money(v)}</td>`).join('')}<td class="n">${money(r.total)}</td></tr>`).join('')}
<tr class="tot">${fed ? '<td></td>' : ''}<td>Total price</td>${s.periodTotals.map((v) => `<td class="n">${money(v)}</td>`).join('')}<td class="n">${money(s.total)}</td></tr></tbody></table></div></div>`;
  }

  // ---------- render ----------
  const VIEWS = { setup: tabSetup, lines: tabLines, pws: tabPws, analysis: tabAnalysis, internal: tabInternal, submission: tabSubmission };
  function renderTab() { $('#view').innerHTML = VIEWS[tab](); updateDynamic(); }
  function updateDynamic() {
    if (tab === 'lines') updateLinePrices();
    else if (tab === 'analysis') updateAnalysis();
  }
  function recompute() { res = E.compute(cur()); renderKpis(); }
  function refresh(full) { recompute(); renderHeader(); if (full || tab === 'internal' || tab === 'submission') renderTab(); else updateDynamic(); save(); }

  // ---------- events ----------
  function setPath(p, path, v) { const ks = path.split('.'); const last = ks.pop(); ks.reduce((o, k) => o[k], p)[last] = v; }
  document.addEventListener('input', (e) => {
    const t = e.target, p = cur();
    if (t.dataset.path) {
      let v = t.dataset.num !== undefined ? (parseFloat(t.value) || 0) : t.value;
      if (t.hasAttribute('data-bool')) v = t.value === 'true';
      if (t.dataset.path === 'target') v = t.value;
      setPath(p, t.dataset.path, v);
      document.querySelectorAll(`[data-path="${t.dataset.path}"]`).forEach((o) => { if (o !== t) o.value = t.value; });
      if (t.dataset.path === 'name') { renderHeader(); save(); return; }
      refresh();
    } else if (t.dataset.line) {
      const l = p.lines.find((x) => x.id === t.dataset.line); if (!l) return;
      const f = t.dataset.f;
      l[f] = t.type === 'checkbox' ? t.checked : t.dataset.num !== undefined ? (parseFloat(t.value) || 0) : t.value;
      refresh();
    } else if (t.dataset.period !== undefined) { p.periods[+t.dataset.period].name = t.value; refresh(); }
    else if (t.dataset.clin) { p.clins[t.dataset.clin] = t.value; refresh(); }
    else if (t.id === 'detail') { detail[p.mode] = t.value; renderTab(); }
  });
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (t.id === 'pwsFile' && t.files[0]) { const r = new FileReader(); r.onload = () => { $('#pwsText').value = String(r.result); pwsPreview(); }; r.readAsText(t.files[0]); }
    if (t.id === 'pfile' && t.files[0]) {
      const r = new FileReader();
      r.onload = () => { try { const j = JSON.parse(r.result); const list = (j.proposals || [j]).map((x) => { const n = E.normalize(x); n.id = Math.random().toString(36).slice(2, 9); return n; }); store.proposals.push(...list); store.current = list[0].id; refresh(true); } catch (err) { alert('Could not read that file: ' + err.message); } };
      r.readAsText(t.files[0]); t.value = '';
    }
  });
  const ACTS = {
    addPeriod(p) { p.periods.push({ name: p.periods.length === 1 ? 'Option Year 1' : 'Option Year ' + p.periods.length }); },
    delPeriod(p) { if (p.periods.length > 1) p.periods.pop(); },
    addLine(p, d) { p.lines.push(E.newLine(d.type)); },
    dupLine(p, d) { const i = p.lines.findIndex((l) => l.id === d.id); const c = Object.assign({}, p.lines[i], { id: Math.random().toString(36).slice(2, 9) }); p.lines.splice(i + 1, 0, c); },
    delLine(p, d) { p.lines = p.lines.filter((l) => l.id !== d.id); },
    autoClin(p) { E.autoAssignClins(p); },
    lockBase(p) { p.baseline = Object.assign({}, res.totals); },
    clearBase(p) { p.baseline = null; },
    applyTarget(p) { const s = E.solveProfit(p, parseFloat(p.target)); if (s) { p.rates.profitMethod = 'markup'; p.rates.profit = Math.round(s.markupPct * 100) / 100; } },
    pwsApply(p) { p.pws = $('#pwsText').value; const per = $('#pwsPer'); E.applyPWS(p, E.parsePWS(p.pws), per && per.checked); tab = 'lines'; },
  };
  document.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const p = cur();
    if (b.dataset.tab) { tab = b.dataset.tab; renderHeader(); renderTab(); return; }
    const a = b.dataset.act;
    if (a === 'pwsParse') return pwsPreview();
    if (a === 'csvInternal') return csvInternal();
    if (a === 'csvSubmit') return csvSubmit();
    if (ACTS[a]) { ACTS[a](p, b.dataset); refresh(true); }
  });
  $('#psel').addEventListener('change', (e) => { store.current = e.target.value; refresh(true); });
  $('#m-commercial').onclick = () => { cur().mode = 'commercial'; refresh(true); };
  $('#m-federal').onclick = () => { cur().mode = 'federal'; refresh(true); };
  $('#pnew').onclick = () => { const p = E.blank('New proposal'); p.lines = [E.newLine('labor')]; store.proposals.push(p); store.current = p.id; tab = 'setup'; refresh(true); };
  $('#psample').onclick = () => { const p = E.sample(); store.proposals.push(p); store.current = p.id; refresh(true); };
  $('#pdup').onclick = () => { const c = E.normalize(JSON.parse(JSON.stringify(cur()))); c.id = Math.random().toString(36).slice(2, 9); c.name += ' (copy)'; store.proposals.push(c); store.current = c.id; refresh(true); };
  $('#pdel').onclick = () => {
    if (!confirm('Delete "' + cur().name + '"? This cannot be undone (export JSON first to keep a copy).')) return;
    store.proposals = store.proposals.filter((x) => x.id !== store.current);
    if (!store.proposals.length) store.proposals.push(E.blank('New proposal'));
    store.current = store.proposals[0].id; refresh(true);
  };
  $('#pexp').onclick = () => download(slug(cur().name) + '.json', JSON.stringify({ proposals: [cur()] }, null, 2), 'application/json');
  $('#pimp').onclick = () => $('#pfile').click();
  $('#pfile').addEventListener('change', () => {});

  function csvInternal() {
    const p = cur(); const fed = p.mode === 'federal';
    const head = ['Type', 'Description', 'Section'].concat(fed ? ['CLIN', 'Sub-CLIN', 'WBS', 'BOE'] : [], ['Period', 'Direct', 'Fringe', 'OH', 'Material handling', 'G&A', 'FCCOM', 'Cost', 'Profit', 'Price']);
    const rows = res.records.map((r) => { const l = p.lines.find((x) => x.id === r.lineId); return [TYPES[r.type], r.desc, r.group].concat(fed ? [r.clin, r.subclin, r.wbs, l ? l.boe : ''] : [], [p.periods[r.period].name, r.direct, r.fringe, r.oh, r.mh, r.ga, r.fccom, r.cost, r.profit, r.price]); });
    download(slug(p.name) + '-internal.csv', toCsv([head].concat(rows)), 'text/csv');
  }
  function csvSubmit() {
    const s = sanitized();
    const rows = [[s.federal ? 'CLIN' : '', 'Item'].concat(s.periods, ['Total'])].concat(s.rows.map((r) => [r.ref, r.label].concat(r.prices, [r.total])), [['', 'Total price'].concat(s.periodTotals, [s.total])]);
    download(slug(s.title) + '-submission.csv', toCsv(rows), 'text/csv');
  }

  refresh(true);
})();
