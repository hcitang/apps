/* Shared core for the coverage tool variations.
   Ports of src/coverage/parse_expertise.py + coverage.py, plus CSV loading.
   Pure client-side: nothing leaves the page. */
(function (G) {
  "use strict";

  // ---- faces sprite (work/coverage/assets/faces.png : 16x8 grid, 88x96 cells) ----
  const HEADS = {
    src: "assets/faces.png", cellW: 82, cellH: 90, cols: 16, rows: 8,
    count: 128,
    NORMAL: 125,             // tiles 0..124 are SC faces (random pick)
    EMPTY: 125,              // blank head   -> unfilled (filled-unknown)
    NEEDED: 126,             // "?" head     -> recruit here
    SPARKLE: 127,            // sparkle      -> what-if / newly added
  };
  // background style for a tile index, rendered at height `h` px (width keeps aspect)
  function headStyle(idx, h) {
    const w = Math.round(h * HEADS.cellW / HEADS.cellH);
    const col = idx % HEADS.cols, row = (idx / HEADS.cols) | 0;
    return `background-image:url(${HEADS.src});` +
      `background-size:${HEADS.cols * w}px ${HEADS.rows * h}px;` +
      `background-position:-${col * w}px -${row * h}px;` +
      `width:${w}px;height:${h}px;`;
  }
  function headFor() { return (Math.random() * HEADS.NORMAL) | 0; }  // random face

  // ---- expertise block parser (newline-independent) ----
  const LEVEL = { "Recently published": "R", "Knowledgeable": "K" };
  const FACET = { "Domain": "Domain", "Method / Approach": "Method",
                  "Users": "Users", "Primary Contribution": "Contribution" };
  const HEAD_RE = /(Domain|Method \/ Approach|Users|Primary Contribution)\s*\[(Recently published|Knowledgeable)\]\s*:/g;

  function parseBlock(text) {
    text = text || ""; const cells = []; const heads = [];
    let m; HEAD_RE.lastIndex = 0;
    while ((m = HEAD_RE.exec(text))) heads.push({ i: m.index, end: HEAD_RE.lastIndex, f: m[1], l: m[2] });
    for (let i = 0; i < heads.length; i++) {
      const facet = FACET[heads[i].f] || heads[i].f, level = LEVEL[heads[i].l] || heads[i].l;
      const body = text.slice(heads[i].end, i + 1 < heads.length ? heads[i + 1].i : text.length);
      for (let seg of body.split(";")) {
        seg = seg.trim(); if (!seg || seg.indexOf(">") < 0) continue;
        const k = seg.indexOf(">");
        cells.push({ facet, category: seg.slice(0, k).trim(), subpile: seg.slice(k + 1).trim(), level });
      }
    }
    return cells;
  }

  // ---- tree index + validation ----
  const DATA = G.COVERAGE_DATA;
  const VALID = new Set();
  const SUBPILES = {};   // facet -> [{category, subpile, demand, tier, need, key}]
  const KEY = (c, s) => c + " › " + s;
  for (const c of DATA.categories) {
    for (const sp of c.subpiles) {
      VALID.add(KEY(c.label, sp.name));
      (SUBPILES[c.facet] = SUBPILES[c.facet] || []).push({
        category: c.label, subpile: sp.name, demand: sp.demand,
        tier: sp.tier.label, need: sp.tier.need, key: KEY(c.label, sp.name),
      });
    }
  }
  const FACETS = ["Domain", "Method", "Users"];

  function validate(cells) {
    const matched = [], unmatched = [];
    for (const c of cells) (VALID.has(KEY(c.category, c.subpile)) ? matched : unmatched).push(c);
    return { matched, unmatched };
  }

  // ---- CSV (volunteer pool) -> SC objects ----
  function parseCSV(text) {
    const rows = []; let i = 0, field = "", row = [], q = false;
    const pushF = () => { row.push(field); field = ""; };
    const pushR = () => { pushF(); rows.push(row); row = []; };
    while (i < text.length) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
        else field += ch;
      } else if (ch === '"') q = true;
      else if (ch === ",") pushF();
      else if (ch === "\r") {}
      else if (ch === "\n") pushR();
      else field += ch;
      i++;
    }
    if (field.length || row.length) pushR();
    const hdr = rows.shift();
    return rows.filter(r => r.length > 1).map(r => Object.fromEntries(hdr.map((h, j) => [h, r[j]])));
  }

  function volunteersFromCSV(text) {
    const recs = parseCSV(text);
    const hasConfirmedCol = recs.length > 0 && ("confirmed" in recs[0]);
    const pool = recs.map((r, idx) => {
      const block = (r["expertise_domain_methods"] || "").trim();
      if (!block) return null;
      const { matched, unmatched } = validate(parseBlock(block));
      const role = (r["role"] || "").trim();
      return {
        id: r["Paper ID"] || ("row" + idx),
        name: (r["Contact Name"] || "").trim(),
        role, roles: role ? role.split("; ") : [],
        status: r["Status"], cells: matched, unmatched, head: headFor(r["Paper ID"] || idx),
        confirmed: hasConfirmedCol ? /^(t|y|1)/i.test((r["confirmed"] || "").trim()) : undefined,
      };
    }).filter(Boolean);
    pool.hasConfirmedCol = hasConfirmedCol;   // tells the loader to seed the confirmed set from the column
    return pool;
  }

  // people pasted as: "Name <tab/newline> <expertise block>" or just a block per person
  function volunteersFromPaste(text) {
    // split on blank lines between people; first non-block line = name
    const chunks = text.split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    return chunks.map((ch, idx) => {
      const lines = ch.split("\n");
      let name = "SC " + (idx + 1);
      if (!/\[(Recently published|Knowledgeable)\]/.test(lines[0])) name = lines.shift().trim();
      const { matched, unmatched } = validate(parseBlock(lines.join("\n")));
      return { id: "paste" + idx, name, role: "SC", roles: ["SC"],
               cells: matched, unmatched, head: headFor("paste" + idx) };
    }).filter(v => v.cells.length || v.unmatched.length);
  }

  // ---- coverage math ----
  const W = { R: 1, K: 1 };
  function supplyMap(scs, w) {
    w = w || W; const agg = {};
    for (const sc of scs) {
      const best = {};
      for (const c of sc.cells) { if (best[c.key = KEY(c.category, c.subpile)] !== "R") best[c.key] = c.level; }
      for (const k in best) {
        const a = agg[k] || (agg[k] = { supply: 0, coverers: [], nR: 0, nK: 0 });
        a.supply += w[best[k]] || 1; a.coverers.push(sc.id);
        if (best[k] === "R") a.nR++; else a.nK++;
      }
    }
    return agg;
  }

  function compute(scs, opts) {
    opts = opts || {}; const w = opts.w || W; const facets = opts.facets || FACETS;
    const sup = supplyMap(scs, w);
    const fDemand = {}, fSupply = {};
    for (const f of facets) {
      fDemand[f] = 0; fSupply[f] = 0;
      for (const sp of SUBPILES[f]) { fDemand[f] += sp.demand; fSupply[f] += (sup[sp.key] || 0).supply || 0; }
    }
    const out = {};
    for (const f of facets) {
      out[f] = SUBPILES[f].map(sp => {
        const s = sup[sp.key] || { supply: 0, coverers: [], nR: 0, nK: 0 };
        const share = fDemand[f] ? sp.demand / fDemand[f] : 0;
        const target = share * fSupply[f];
        const ratio = target > 0 ? s.supply / target : (s.supply > 0 ? Infinity : 0);
        return Object.assign({}, sp, {
          supply: s.supply, coverers: s.coverers, nR: s.nR, nK: s.nK,
          hasR: s.nR > 0, hasK: s.nK > 0,
          target: target, ratio: ratio,
          status: statusOf(s.supply, sp.need, s.nR > 0),
          balance: balanceOf(ratio, s.supply),
          deficit: Math.max(0, sp.need - s.supply),
        });
      });
    }
    return out;
  }
  function statusOf(supply, need, hasR) {
    if (supply <= 0) return "missing";
    if (supply < need) return "under";
    if (!hasR) return "Konly";
    return supply > need ? "over" : "ok";
  }
  // proportional balance band (headline for SC view)
  function balanceOf(ratio, supply) {
    if (supply <= 0) return "none";
    if (ratio < 0.5) return "thin";
    if (ratio < 0.8) return "low";
    if (ratio <= 1.25) return "ok";
    if (ratio <= 2) return "high";
    return "piled";
  }

  function marginalGain(scs, cand, opts) {
    opts = opts || {}; const sup = supplyMap(scs, opts.w || W);
    let gain = 0; const filled = [], helped = []; const seen = {};
    const need = {}; const dem = {};
    for (const f of (opts.facets || FACETS)) for (const sp of SUBPILES[f]) { need[sp.key] = sp.need; dem[sp.key] = sp.demand; }
    for (const c of cand.cells) {
      const k = KEY(c.category, c.subpile);
      if (seen[k] || !(k in need)) continue; seen[k] = 1;
      const cur = (sup[k] || 0).supply || 0;
      if (cur < need[k]) { gain += dem[k]; (cur <= 0 ? filled : helped).push(k); }
    }
    return { gain, filled, helped };
  }

  G.CoverageCore = {
    DATA, SUBPILES, FACETS, KEY, HEADS, headStyle, headFor,
    parseBlock, validate, parseCSV, volunteersFromCSV, volunteersFromPaste,
    compute, marginalGain, statusOf, balanceOf,
  };
})(window);
