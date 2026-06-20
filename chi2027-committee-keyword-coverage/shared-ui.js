/* Shared UI: pool loading (file/paste/demo), confirmed-set state, balance colors, toolbar.
   Pool + confirmed set kept in sessionStorage (client-side, cleared on tab close) so the
   four view files share one loaded committee. Nothing is ever sent anywhere. */
(function (G) {
  "use strict";
  const C = G.CoverageCore;
  const BAL = { none: "var(--none)", thin: "var(--thin)", low: "var(--low)",
                ok: "var(--ok)", high: "var(--high)", piled: "var(--piled)" };
  const BAL_LABEL = { none: "missing", thin: "way under", low: "thin",
                      ok: "balanced", high: "over", piled: "piled up" };

  // ---- state ----
  function getPool() { try { return JSON.parse(sessionStorage.getItem("cov.pool")) || []; } catch { return []; } }
  function setPool(p) { sessionStorage.setItem("cov.pool", JSON.stringify(p)); }
  function getConfirmed() { try { return new Set(JSON.parse(sessionStorage.getItem("cov.confirmed")) || []); } catch { return new Set(); } }
  function setConfirmed(s) { sessionStorage.setItem("cov.confirmed", JSON.stringify([...s])); }
  function confirmedSCs() { const c = getConfirmed(); return getPool().filter(v => c.has(v.id)); }

  // default confirmed = everyone who volunteered for SC
  function ensureConfirmedDefault() {
    if (sessionStorage.getItem("cov.confirmed")) return;
    setConfirmed(new Set(getPool().filter(v => v.roles.indexOf("SC") >= 0).map(v => v.id)));
  }

  // ---- loaders (return count; throw surfaced by caller) ----
  function loadCSVText(text) {
    const pool = C.volunteersFromCSV(text);
    setPool(pool); sessionStorage.removeItem("cov.confirmed");
    // a `confirmed` column (the bundled committees ship one) drives the confirmed
    // set explicitly; otherwise fall back to "everyone with an SC role".
    if (pool.hasConfirmedCol) setConfirmed(new Set(pool.filter(v => v.confirmed).map(v => v.id)));
    else ensureConfirmedDefault();
    return pool.length;
  }

  // load one of the bundled sample committees (window.COMMITTEES, from committees.js)
  function loadCommittee(key) {
    const C2 = G.COMMITTEES || {};
    const c = C2[key]; if (!c) throw new Error("Unknown committee: " + key);
    return loadCSVText(c.csv);
  }
  function committeeKeys() { return Object.keys(G.COMMITTEES || {}); }
  function loadPasteText(text) {
    const pool = C.volunteersFromPaste(text);
    setPool(pool); sessionStorage.removeItem("cov.confirmed"); ensureConfirmedDefault();
    return pool.length;
  }

  // safe synthetic demo committee (no real data) so views open live
  function loadDemo(n) {
    n = n || 28;
    const all = []; for (const f of C.FACETS) for (const sp of C.SUBPILES[f]) all.push({ f, sp });
    // weight pick toward higher demand, but leave some areas thin on purpose
    const pool = [];
    const rng = mulberry32(42);
    const homeCats = [...new Set(C.SUBPILES.Domain.map(s => s.category))];
    for (let i = 0; i < n; i++) {
      const cells = []; const home = homeCats[(rng() * homeCats.length) | 0];
      for (const f of C.FACETS) {
        const list = C.SUBPILES[f];
        const k = f === "Domain" ? 5 + ((rng() * 6) | 0) : 1 + ((rng() * 3) | 0);
        for (let j = 0; j < k; j++) {
          let cand = list[(rng() * list.length) | 0];
          if (f === "Domain" && rng() < 0.5) {  // cluster around a home category
            const hs = list.filter(s => s.category === home); if (hs.length) cand = hs[(rng() * hs.length) | 0];
          }
          if (cand.demand > 2000 && rng() < 0.85) j--;  // skip nothing special; keep simple
          cells.push({ facet: f, category: cand.category, subpile: cand.subpile,
                       level: rng() < 0.55 ? "R" : "K", key: C.KEY(cand.category, cand.subpile) });
        }
      }
      pool.push({ id: "demo" + i, name: "Demo SC " + (i + 1), role: "SC", roles: ["SC"],
                  cells, unmatched: [], head: C.headFor("demo" + i) });
    }
    setPool(pool); sessionStorage.removeItem("cov.confirmed"); ensureConfirmedDefault();
  }
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

  // ---- view options (facet, level weight, capacity rule) persisted ----
  function opts() {
    return {
      facet: sessionStorage.getItem("cov.facet") || "Domain",
      kEqR: sessionStorage.getItem("cov.kEqR") !== "0",   // default K==R
      rule: sessionStorage.getItem("cov.rule") || "tiered", // tiered(slots)|proportional(balance) — default slots
    };
  }
  function setOpt(k, v) { sessionStorage.setItem("cov." + k, v); }
  function computeOpts() { const o = opts(); return { w: o.kEqR ? { R: 1, K: 1 } : { R: 1, K: 0.5 }, facets: C.FACETS }; }

  // ---- toolbar (loader + view links + facet/rule controls) ----
  // order: Report, Treemap, Heads map, Roster + what-if.
  const VIEWS = [["v3-report.html", "Report"], ["v2-treemap.html", "Treemap"],
                 ["v1-heads-map.html", "Heads map"], ["v4-roster.html", "Roster + what-if"]];
  function renderHeader(active, onChange) {
    const o = opts();
    const cur = location.pathname.split("/").pop();
    const h = document.createElement("header");
    h.innerHTML =
      `<h1>CHI 2027 · Coverage</h1>` +
      `<div class="views">` + VIEWS.map(v => `<a href="${v[0]}" class="${v[0] === cur ? "active" : ""}">${v[1]}</a>`).join("") + `</div>` +
      `<div class="toolbar">` +
        `<span class="pill" id="poolPill"></span>` +
        `<select id="facetSel">` + C.FACETS.map(f => `<option ${f === o.facet ? "selected" : ""}>${f}</option>`).join("") + `</select>` +
        `<div class="seg" id="ruleSeg"><button data-r="proportional" class="${o.rule === "proportional" ? "on" : ""}" title="proportional: target = your headcount spread by demand">balance</button><button data-r="tiered" class="${o.rule === "tiered" ? "on" : ""}" title="slots: fixed 1/2/3 by demand tier">slots</button></div>` +
        `<div class="seg" id="rkSeg" title="how K (Knowledgeable) counts vs R (Recently published)"><button data-k="1" class="${o.kEqR ? "on" : ""}">K=R</button><button data-k="0" class="${o.kEqR ? "" : "on"}">R&gt;K</button></div>` +
        `<div class="loader"><button id="csvBtn">load CSV</button><input id="csvFile" type="file" accept=".csv" hidden>` +
        `<button id="pasteBtn" title="paste confirmed-SC expertise blocks">paste</button>` +
        `<select id="commSel" title="load a bundled sample committee"><option value="">load committee…</option>` +
          committeeKeys().map(k => `<option value="${k}">${(G.COMMITTEES[k].label) || k}</option>`).join("") + `</select>` +
        `<button id="clearBtn" title="clear loaded data">clear</button></div>` +
      `</div>`;
    document.body.prepend(h);
    const pill = h.querySelector("#poolPill");
    const refreshPill = () => { const p = getPool(); pill.textContent = p.length ? `${confirmedSCs().length} SC-volunteers / ${p.length} loaded` : "no data";
      pill.title = "SC-volunteers = loaded people whose role includes SC (shown on the map). loaded = volunteers with an expertise block."; };
    refreshPill();
    h.querySelector("#facetSel").onchange = e => { setOpt("facet", e.target.value); onChange && onChange(); };
    h.querySelectorAll("#ruleSeg button").forEach(b => b.onclick = () => { setOpt("rule", b.dataset.r); h.querySelectorAll("#ruleSeg button").forEach(x => x.classList.toggle("on", x === b)); onChange && onChange(); });
    h.querySelectorAll("#rkSeg button").forEach(b => b.onclick = () => { setOpt("kEqR", b.dataset.k); h.querySelectorAll("#rkSeg button").forEach(x => x.classList.toggle("on", x === b)); onChange && onChange(); });
    const csvIn = h.querySelector("#csvFile");
    h.querySelector("#csvBtn").onclick = () => csvIn.click();
    csvIn.onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => { try { const n = loadCSVText(r.result); refreshPill(); if (!n) alert("No volunteers with an expertise block were found in that CSV."); onChange && onChange(); } catch (err) { console.error(err); alert("Could not parse that CSV: " + err.message); } };
      r.onerror = () => alert("Could not read the file.");
      r.readAsText(f);
      e.target.value = "";  // allow re-selecting the same file
    };
    h.querySelector("#pasteBtn").onclick = () => {
      const t = prompt("Paste expertise blocks. Separate people with a blank line; optional name on the first line of each.");
      if (t == null) return;
      try { const n = loadPasteText(t); refreshPill(); if (!n) alert("No expertise cells parsed from that text."); onChange && onChange(); }
      catch (err) { console.error(err); alert("Could not parse: " + err.message); }
    };
    h.querySelector("#commSel").onchange = e => {
      const k = e.target.value; if (!k) return;
      try { loadCommittee(k); refreshPill(); onChange && onChange(); }
      catch (err) { console.error(err); alert("Could not load committee: " + err.message); }
      e.target.value = "";  // back to placeholder so re-selecting reloads
    };
    h.querySelector("#clearBtn").onclick = () => { sessionStorage.clear(); refreshPill(); onChange && onChange(); };
    // ?committee=<key> (or legacy ?demo) auto-loads for headless smoke tests
    const auto = (location.search.match(/[?&]committee=([^&]+)/) || [])[1];
    if (!getPool().length && auto) { try { loadCommittee(decodeURIComponent(auto)); refreshPill(); } catch (e) {} }
    else if (!getPool().length && /[?&]demo/.test(location.search)) { loadDemo(); refreshPill(); }
    return h;
  }

  function tip() {
    let t = document.querySelector(".tip");
    if (!t) { t = document.createElement("div"); t.className = "tip"; document.body.appendChild(t); }
    return {
      show(html, x, y) { t.innerHTML = html; t.style.opacity = 1; t.style.left = Math.min(x + 12, innerWidth - 290) + "px"; t.style.top = (y + 14) + "px"; },
      hide() { t.style.opacity = 0; },
    };
  }

  G.CoverageUI = { getPool, confirmedSCs, getConfirmed, setConfirmed, ensureConfirmedDefault,
    loadCSVText, loadPasteText, loadDemo, loadCommittee, committeeKeys, opts, setOpt, computeOpts,
    renderHeader, tip, BAL, BAL_LABEL };
})(window);
