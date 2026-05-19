// CHI 2026 keyword explorer — vanilla JS, no build step.

const state = {
  clusters: [],
  clustersById: new Map(),
  papers: [],
  papersById: new Map(),
  taxonomy: [],
  ccs: [],
  hierarchy: [],
  taxonomyTerms: [],
  taxhier: [],
  expandedFacet: new Set(),
  expandedTerm: new Set(),
  meta: null,
  selectedClusterId: null,
  expandedL1: new Set(),
  expandedL2: new Set(),
  board: null,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------- Loading overlay ----------

function ensureLoader() {
  let el = document.getElementById("app-loader");
  if (el) return el;
  el = document.createElement("div");
  el.id = "app-loader";
  el.innerHTML = `
    <div class="loader-box">
      <div class="loader-title">Loading CHI 2026 keyword explorer…</div>
      <ul class="loader-steps"></ul>
      <div class="loader-foot muted"></div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function loaderAddStep(label) {
  const ul = ensureLoader().querySelector(".loader-steps");
  const li = document.createElement("li");
  li.dataset.label = label;
  li.innerHTML = `<span class="loader-icon">⋯</span> <span class="loader-label">${label}</span> <span class="loader-detail muted"></span>`;
  ul.appendChild(li);
  return li;
}

function loaderUpdateStep(li, { state, detail } = {}) {
  if (state === "active")  li.querySelector(".loader-icon").textContent = "⏳";
  if (state === "done")    { li.querySelector(".loader-icon").textContent = "✓"; li.classList.add("done"); }
  if (state === "fail")    { li.querySelector(".loader-icon").textContent = "✗"; li.classList.add("fail"); }
  if (detail !== undefined) li.querySelector(".loader-detail").textContent = detail;
}

function loaderFoot(msg) { ensureLoader().querySelector(".loader-foot").textContent = msg; }

function loaderHide() {
  const el = document.getElementById("app-loader");
  if (el) el.remove();
}

function fmtBytes(n) {
  if (n == null || isNaN(n)) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  return (n / (1024 * 1024)).toFixed(2) + " MB";
}

async function fetchJsonRetry(path, attempts = 3, onProgress) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(path, { cache: "default" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const total = Number(r.headers.get("content-length")) || 0;
      if (r.body && r.body.getReader && onProgress) {
        const reader = r.body.getReader();
        const chunks = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          onProgress({ received, total });
        }
        const blob = new Blob(chunks);
        const text = await blob.text();
        return JSON.parse(text);
      }
      return await r.json();
    } catch (e) {
      lastErr = e;
      console.warn(`fetch ${path} attempt ${i+1} failed: ${e.message}`);
      await new Promise(res => setTimeout(res, 250 * (i + 1)));
    }
  }
  throw new Error(`fetch ${path} failed after ${attempts} attempts: ${lastErr.message}`);
}

async function fetchStep(label, path) {
  const li = loaderAddStep(`${label} — ${path}`);
  loaderUpdateStep(li, { state: "active" });
  const t0 = performance.now();
  try {
    const data = await fetchJsonRetry(path, 3, ({ received, total }) => {
      const pct = total ? ` (${Math.round(received / total * 100)}%)` : "";
      loaderUpdateStep(li, { detail: `${fmtBytes(received)}${total ? " / " + fmtBytes(total) : ""}${pct}` });
    });
    const ms = Math.round(performance.now() - t0);
    let cacheNote = "";
    try {
      const entries = performance.getEntriesByName(new URL(path, location.href).href, "resource");
      const last = entries[entries.length - 1];
      if (last && last.transferSize === 0 && last.decodedBodySize > 0) cacheNote = " · cache";
      else if (last && last.transferSize > 0 && last.transferSize < 500) cacheNote = " · 304";
    } catch (_) {}
    loaderUpdateStep(li, { state: "done", detail: `${ms} ms${cacheNote}` });
    return data;
  } catch (e) {
    loaderUpdateStep(li, { state: "fail", detail: e.message });
    throw e;
  }
}

async function renderStep(label, fn) {
  const li = loaderAddStep(label);
  loaderUpdateStep(li, { state: "active" });
  const t0 = performance.now();
  await Promise.resolve().then(() => fn());
  // yield so the browser can paint the active state
  await new Promise(r => requestAnimationFrame(() => r()));
  loaderUpdateStep(li, { state: "done", detail: `${Math.round(performance.now() - t0)} ms` });
}

async function load() {
  ensureLoader();
  loaderFoot("Fetching data files in parallel…");
  const [meta, clusters, papers, taxonomy, board, hierarchy, taxonomyTerms, taxhier] = await Promise.all([
    fetchStep("meta",            "data/meta.json"),
    fetchStep("clusters",        "data/clusters.json"),
    fetchStep("papers",          "data/papers.json"),
    fetchStep("taxonomy",        "data/taxonomy.json"),
    fetchStep("board",           "data/board_state.json"),
    fetchStep("hierarchy",       "data/hierarchy.json"),
    fetchStep("taxonomy terms",  "data/taxonomy_terms.json"),
    fetchStep("taxonomy hier",   "data/hierarchy_taxonomy.json"),
  ]);
  state.meta = meta;
  state.clusters = clusters;
  state.clustersById = new Map(clusters.map(c => [c.id, c]));
  state.papers = papers;
  state.papersById = new Map(papers.map(p => [p.id, p]));
  state.taxonomy = taxonomy;
  state.board = board;
  state.hierarchy = hierarchy;
  state.taxonomyTerms = taxonomyTerms;
  state.taxhier = taxhier;
  // Set of normalized controlled-vocabulary labels for quick lookup. Used to
  // tag sub-pile names and card canonicals that match an existing CHI taxonomy
  // term — signal of overlap between author keywords and the official vocab.
  state.controlledVocabLower = new Set(taxonomyTerms.map(t => t.label.toLowerCase()));
  state.controlledVocabByLower = new Map(taxonomyTerms.map(t => [t.label.toLowerCase(), t]));
  // CV check counts: how many submissions checked each taxonomy term in PCS.
  // Only meaningful for keys that ARE CV terms; everything else is undefined.
  state.cvChecksByLower = new Map(taxonomy.map(t => [t.keyword.toLowerCase(), t.paper_count]));

  $("#meta-summary").textContent =
    `${meta.total_papers.toLocaleString()} submissions · ` +
    `${meta.total_clusters.toLocaleString()} author-keyword clusters · ` +
    `${meta.total_taxonomy_keywords} taxonomy keywords · built ${meta.built_at}`;

  loaderFoot("Initializing UI…");
  initTabs();

  loaderFoot("Rendering tabs…");
  await renderStep("render board",        renderBoard);
  await renderStep("render taxonomy view", renderTaxHier);
  await renderStep("render hierarchy",     renderHierarchy);
  await renderStep("render gaps",          renderGaps);
  await renderStep("render clusters",      renderClusters);
  await renderStep("render taxonomy list", renderTaxonomy);

  loaderHide();
}

function initTabs() {
  $$("nav#tabs button").forEach(b => {
    b.addEventListener("click", () => {
      $$("nav#tabs button").forEach(x => x.classList.toggle("active", x === b));
      const id = b.dataset.tab;
      $$(".tab").forEach(t => t.classList.toggle("active", t.id === `tab-${id}`));
    });
  });
}

// ---------- Board (read-only) ----------

function renderBoard() {
  $("#board-search").addEventListener("input", () => filterBoard());
  $("#board-min").addEventListener("input", () => filterBoard());
  $("#board-sort").addEventListener("change", () => filterBoard());
  filterBoard();
}

function leafMatchesSearch(leaf, q) {
  if (!q) return true;
  if (leaf.canonical.toLowerCase().includes(q)) return true;
  // Check member keywords too (need clusters lookup)
  const c = state.clustersById.get(leaf.cluster_id);
  if (c) {
    return c.members.some(m => m.kw.toLowerCase().includes(q));
  }
  return false;
}

function filterBoard() {
  const q = $("#board-search").value.trim().toLowerCase();
  const min = parseInt($("#board-min").value) || 1;
  const sortMode = $("#board-sort").value;

  const canvas = $("#board-canvas");
  // Preserve scroll positions so a re-render doesn't snap to top
  const savedScrollLeft = canvas.scrollLeft;
  const savedColScroll = new Map();
  canvas.querySelectorAll(".board-column").forEach(col => {
    const name = col.dataset.catName;
    if (name) savedColScroll.set(name, col.scrollTop);
  });

  canvas.innerHTML = "";

  for (let ci = 0; ci < state.board.categories.length; ci++) {
    const cat = state.board.categories[ci];
    const col = document.createElement("div");
    col.className = "board-column";
    col.dataset.ci = ci;
    col.dataset.catName = cat.name;

    // Category header
    const colHeader = document.createElement("div");
    colHeader.className = "board-col-header";
    let totalLeaves = 0, totalMentions = 0;
    for (const sp of cat.subpiles) {
      totalLeaves += sp.leaves.length;
      totalMentions += sp.leaves.reduce((s, l) => s + l.total_count, 0);
    }
    const colCV = state.controlledVocabByLower?.get(cat.name.toLowerCase());
    const colCVChecks = state.cvChecksByLower?.get(cat.name.toLowerCase());
    const colCVBadge = colCV
      ? `<span class="cv-badge" title="Matches CHI taxonomy term — facet: ${escapeHtml(colCV.facet)}">CV</span>` +
        (colCVChecks !== undefined ? `<span class="cv-checks" title="Submissions that checked this term in PCS">CV ${colCVChecks.toLocaleString()}</span>` : "")
      : "";
    colHeader.innerHTML = `
      <div class="board-col-title">${escapeHtml(cat.name)}${colCVBadge}</div>
      <div class="board-col-stats">${cat.subpiles.length} piles · ${totalLeaves} cards · ${totalMentions} mentions</div>
    `;
    col.appendChild(colHeader);

    // Sub-piles
    for (let si = 0; si < cat.subpiles.length; si++) {
      const sp = cat.subpiles[si];
      const filtered = sp.leaves.filter(l => l.total_count >= min && leafMatchesSearch(l, q));
      const cmp = (a, b) => {
        if (sortMode === "count") return b.total_count - a.total_count;
        if (sortMode === "confidence") return (a.confidence ?? 1) - (b.confidence ?? 1);
        if (sortMode === "alpha") return a.canonical.localeCompare(b.canonical);
        return 0;
      };
      filtered.sort(cmp);

      const collapsed = sp._collapsed === true;
      const pile = document.createElement("div");
      pile.className = "board-pile" + (collapsed ? " collapsed" : "");
      pile.dataset.ci = ci;
      pile.dataset.si = si;

      const pileHeader = document.createElement("div");
      pileHeader.className = "board-pile-header";
      const totalSp = sp.leaves.reduce((s, l) => s + l.total_count, 0);
      const cvMatch = state.controlledVocabByLower?.get(sp.name.toLowerCase());
      const cvChecksN = state.cvChecksByLower?.get(sp.name.toLowerCase());
      const cvBadge = cvMatch
        ? `<span class="cv-badge" title="Matches official CHI taxonomy term — facet: ${escapeHtml(cvMatch.facet)}">CV</span>` +
          (cvChecksN !== undefined ? `<span class="cv-checks" title="Submissions that checked this term in PCS">CV ${cvChecksN.toLocaleString()}</span>` : "")
        : "";
      const caret = `<span class="pile-caret">${collapsed ? "▶" : "▼"}</span>`;
      pileHeader.innerHTML = `
        ${caret}
        <div class="board-pile-title">${escapeHtml(sp.name)}${cvBadge}</div>
        <div class="board-pile-stats">${filtered.length}/${sp.leaves.length} · ${totalSp}</div>
      `;
      pileHeader.addEventListener("click", () => {
        sp._collapsed = !collapsed;
        filterBoard();
      });
      pile.appendChild(pileHeader);

      const cardWrap = document.createElement("div");
      cardWrap.className = "board-cards";
      cardWrap.dataset.ci = ci;
      cardWrap.dataset.si = si;

      for (const leaf of filtered) {
        const card = document.createElement("div");
        card.className = "board-card";
        card.dataset.cid = leaf.cluster_id;
        const cardCV = state.controlledVocabByLower?.get(leaf.canonical.toLowerCase());
        const cardCVChecks = state.cvChecksByLower?.get(leaf.canonical.toLowerCase());
        const cardCVBadge = cardCV
          ? `<span class="cv-badge" title="Cluster canonical matches official CHI taxonomy term — facet: ${escapeHtml(cardCV.facet)}">CV</span>` +
            (cardCVChecks !== undefined ? `<span class="cv-checks" title="Submissions that checked this term in PCS">CV ${cardCVChecks.toLocaleString()}</span>` : "")
          : "";
        card.innerHTML = `
          <div class="card-body">
            <div class="card-canon">${escapeHtml(leaf.canonical)}${cardCVBadge}</div>
            <div class="card-meta">${leaf.total_count} mentions</div>
          </div>
        `;
        card.addEventListener("click", () => {
          $$("nav#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === "clusters"));
          $$(".tab").forEach(t => t.classList.toggle("active", t.id === "tab-clusters"));
          $("#cluster-search").value = state.clustersById.get(leaf.cluster_id)?.canonical || "";
          filterClusters();
          selectCluster(leaf.cluster_id);
        });
        cardWrap.appendChild(card);
      }
      // If filtered is empty and we have a query, hide the pile
      if (q && filtered.length === 0) {
        pile.style.display = "none";
      }
      pile.appendChild(cardWrap);
      col.appendChild(pile);
    }
    canvas.appendChild(col);
  }

  // Restore scroll positions
  canvas.scrollLeft = savedScrollLeft;
  canvas.querySelectorAll(".board-column").forEach(col => {
    const name = col.dataset.catName;
    if (savedColScroll.has(name)) col.scrollTop = savedColScroll.get(name);
  });
}

// ---------- Taxonomy-anchored hierarchy (View A) ----------

const FACET_ORDER = ["Domain", "Users", "Environments", "Devices",
                     "Primary Contribution", "Methods", "Unanchored"];

function renderTaxHier() {
  $("#taxhier-search").addEventListener("input", filterTaxHier);
  $("#taxhier-mode").addEventListener("change", filterTaxHier);
  filterTaxHier();
}

function filterTaxHier() {
  const q = $("#taxhier-search").value.trim().toLowerCase();
  const mode = $("#taxhier-mode").value;
  let leaves = state.taxhier.slice();
  if (mode === "anchored") leaves = leaves.filter(r => !r.unanchored);
  else if (mode === "unanchored") leaves = leaves.filter(r => r.unanchored);

  // Group: facet -> term -> leaves
  const facets = new Map();
  for (const r of leaves) {
    if (!facets.has(r.facet)) facets.set(r.facet, new Map());
    const terms = facets.get(r.facet);
    if (!terms.has(r.taxonomy_term)) terms.set(r.taxonomy_term, []);
    terms.get(r.taxonomy_term).push(r);
  }

  const out = $("#taxhier-tree");
  out.innerHTML = "";
  let totalShown = 0, leafShown = 0;

  // Order facets per FACET_ORDER, then by total count desc
  const facetEntries = [...facets.entries()].sort((a, b) => {
    const ai = FACET_ORDER.indexOf(a[0]);
    const bi = FACET_ORDER.indexOf(b[0]);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  for (const [facet, terms] of facetEntries) {
    // Aggregate counts
    let facetTotal = 0, facetLeaves = 0;
    for (const ls of terms.values()) {
      facetTotal += ls.reduce((s, r) => s + r.total_count, 0);
      facetLeaves += ls.length;
    }
    // Search filter — show facet if any descendant matches
    if (q) {
      const facetMatch = facet.toLowerCase().includes(q);
      let anyMatch = facetMatch;
      if (!anyMatch) {
        for (const [term, ls] of terms.entries()) {
          if (term.toLowerCase().includes(q) || ls.some(r => r.canonical.toLowerCase().includes(q))) {
            anyMatch = true; break;
          }
        }
      }
      if (!anyMatch) continue;
    }

    const facetExpanded = state.expandedFacet.has(facet) || (q !== "" && !facet.toLowerCase().includes(q));
    const fdiv = document.createElement("div");
    fdiv.className = "tree-l1";
    const facetClass = facet === "Unanchored" ? "tree-row-l1 tree-row-unanchored" : "tree-row-l1";
    fdiv.innerHTML = `
      <div class="tree-row ${facetClass}" data-facet="${escapeHtml(facet)}">
        <span class="caret">${facetExpanded ? "▼" : "▶"}</span>
        <span class="tree-label">${escapeHtml(facet)}</span>
        <span class="tree-stats">${terms.size} terms · ${facetLeaves} clusters · ${facetTotal} mentions</span>
      </div>`;
    totalShown++;

    if (facetExpanded) {
      const termEntries = [...terms.entries()].sort((a, b) => {
        const at = a[1].reduce((s, r) => s + r.total_count, 0);
        const bt = b[1].reduce((s, r) => s + r.total_count, 0);
        return bt - at;
      });
      const termWrap = document.createElement("div");
      for (const [term, ls] of termEntries) {
        if (q && !term.toLowerCase().includes(q) && !facet.toLowerCase().includes(q)) {
          const anyLeaf = ls.some(r => r.canonical.toLowerCase().includes(q));
          if (!anyLeaf) continue;
        }
        const termTotal = ls.reduce((s, r) => s + r.total_count, 0);
        const termId = `${facet}::${term}`;
        const termExpanded = state.expandedTerm.has(termId) || (q !== "" && !term.toLowerCase().includes(q) && !facet.toLowerCase().includes(q));
        const tdiv = document.createElement("div");
        tdiv.innerHTML = `
          <div class="tree-row tree-row-l2" data-term="${escapeHtml(termId)}">
            <span class="caret">${termExpanded ? "▼" : "▶"}</span>
            <span class="tree-label">${escapeHtml(term)}</span>
            <span class="tree-stats">${ls.length} clusters · ${termTotal} mentions</span>
          </div>`;
        if (termExpanded) {
          const lsorted = ls.slice().sort((a, b) => b.total_count - a.total_count);
          const leafWrap = document.createElement("div");
          for (const r of lsorted) {
            const ld = document.createElement("div");
            ld.className = "tree-row tree-row-leaf";
            ld.dataset.cid = r.cluster_id;
            const distTag = r.unanchored
              ? `<span class="tag tag-warn" title="No good taxonomy match (d=${r.taxonomy_distance.toFixed(2)})">gap</span>`
              : `<span class="tag tag-tax" title="cosine distance to nearest term">d=${r.taxonomy_distance.toFixed(2)}</span>`;
            ld.innerHTML = `
              <span class="caret"></span>
              <span class="tree-label">${escapeHtml(r.canonical)}</span>
              <span class="tree-stats">${r.total_count} mentions ${distTag}</span>`;
            leafWrap.appendChild(ld);
            leafShown++;
          }
          tdiv.appendChild(leafWrap);
        }
        termWrap.appendChild(tdiv);
      }
      fdiv.appendChild(termWrap);
    }
    out.appendChild(fdiv);
  }

  out.querySelectorAll("[data-facet]").forEach(el => {
    el.addEventListener("click", () => {
      const f = el.dataset.facet;
      if (state.expandedFacet.has(f)) state.expandedFacet.delete(f);
      else state.expandedFacet.add(f);
      filterTaxHier();
    });
  });
  out.querySelectorAll("[data-term]").forEach(el => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const t = el.dataset.term;
      if (state.expandedTerm.has(t)) state.expandedTerm.delete(t);
      else state.expandedTerm.add(t);
      filterTaxHier();
    });
  });
  out.querySelectorAll(".tree-row-leaf").forEach(el => {
    el.addEventListener("click", () => {
      const cid = el.dataset.cid;
      $$("nav#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === "clusters"));
      $$(".tab").forEach(t => t.classList.toggle("active", t.id === "tab-clusters"));
      $("#cluster-search").value = state.clustersById.get(cid)?.canonical || "";
      filterClusters();
      selectCluster(cid);
    });
  });

  $("#taxhier-count").textContent =
    `${facets.size} facets · ${leaves.length} leaf clusters` +
    (q ? ` · search: ${q}` : "");
}

// ---------- Hierarchy (auto Ward) ----------

function renderHierarchy() {
  $("#hier-search").addEventListener("input", filterHierarchy);
  filterHierarchy();
}

function buildHierarchyTree() {
  // Group hierarchy: l1 -> l2 -> leaves
  const l1 = new Map();  // l1_id -> {label, papers, l2map}
  for (const r of state.hierarchy) {
    if (!l1.has(r.level1_id)) l1.set(r.level1_id, {
      id: r.level1_id, label: r.level1_label, total: 0, count: 0,
      l2map: new Map(),
    });
    const lv1 = l1.get(r.level1_id);
    lv1.total += r.total_count; lv1.count++;
    if (!lv1.l2map.has(r.level2_id)) lv1.l2map.set(r.level2_id, {
      id: r.level2_id, label: r.level2_label, total: 0, count: 0, leaves: [],
    });
    const lv2 = lv1.l2map.get(r.level2_id);
    lv2.total += r.total_count; lv2.count++;
    lv2.leaves.push(r);
  }
  return l1;
}

function filterHierarchy() {
  const q = $("#hier-search").value.trim().toLowerCase();
  const tree = buildHierarchyTree();
  const out = $("#hierarchy-tree");
  out.innerHTML = "";

  const l1Sorted = [...tree.values()].sort((a, b) => b.total - a.total);
  let visibleCount = 0;

  for (const lv1 of l1Sorted) {
    // Determine if this lv1 matches the query (or any descendant does)
    const matchSelf = !q || lv1.label.toLowerCase().includes(q);
    let matchedDescendants = matchSelf;
    if (q && !matchSelf) {
      for (const lv2 of lv1.l2map.values()) {
        if (lv2.label.toLowerCase().includes(q)) { matchedDescendants = true; break; }
        if (lv2.leaves.some(r => r.canonical.toLowerCase().includes(q))) { matchedDescendants = true; break; }
      }
    }
    if (!matchedDescendants) continue;
    visibleCount++;

    const expanded = state.expandedL1.has(lv1.id) || (q !== "" && !matchSelf);
    const l1div = document.createElement("div");
    l1div.className = "tree-l1";
    l1div.innerHTML = `
      <div class="tree-row tree-row-l1" data-l1="${lv1.id}">
        <span class="caret">${expanded ? "▼" : "▶"}</span>
        <span class="tree-label">${escapeHtml(lv1.label)}</span>
        <span class="tree-stats">${lv1.count} clusters · ${lv1.total} mentions</span>
      </div>
    `;
    if (expanded) {
      const l2Sorted = [...lv1.l2map.values()].sort((a, b) => b.total - a.total);
      const l2container = document.createElement("div");
      l2container.className = "tree-l2-container";
      for (const lv2 of l2Sorted) {
        const l2matchSelf = !q || lv2.label.toLowerCase().includes(q);
        const l2hasMatchingLeaf = q && lv2.leaves.some(r => r.canonical.toLowerCase().includes(q));
        if (q && !lv2.label.toLowerCase().includes(q) && !lv1.label.toLowerCase().includes(q) && !l2hasMatchingLeaf) continue;
        const l2expanded = state.expandedL2.has(lv2.id) || (q !== "" && l2hasMatchingLeaf && !l2matchSelf);
        const l2div = document.createElement("div");
        l2div.className = "tree-l2";
        l2div.innerHTML = `
          <div class="tree-row tree-row-l2" data-l2="${lv2.id}">
            <span class="caret">${l2expanded ? "▼" : "▶"}</span>
            <span class="tree-label">${escapeHtml(lv2.label)}</span>
            <span class="tree-stats">${lv2.count} clusters · ${lv2.total} mentions</span>
          </div>
        `;
        if (l2expanded) {
          const leavesSorted = lv2.leaves.slice().sort((a, b) => b.total_count - a.total_count);
          const leafContainer = document.createElement("div");
          leafContainer.className = "tree-leaves";
          for (const r of leavesSorted) {
            const leaf = document.createElement("div");
            leaf.className = "tree-row tree-row-leaf";
            leaf.dataset.cid = r.cluster_id;
            const tax = r.taxonomy_distance > 0.5
              ? `<span class="tag tag-warn" title="No good taxonomy match">gap</span>`
              : `<span class="tag tag-tax" title="Nearest CHI taxonomy">${escapeHtml(r.nearest_taxonomy_abbr || r.nearest_taxonomy)}</span>`;
            leaf.innerHTML = `
              <span class="caret"></span>
              <span class="tree-label">${escapeHtml(r.canonical)}</span>
              <span class="tree-stats">${r.total_count} mentions ${tax}</span>
            `;
            leafContainer.appendChild(leaf);
          }
          l2div.appendChild(leafContainer);
        }
        l2container.appendChild(l2div);
      }
      l1div.appendChild(l2container);
    }
    out.appendChild(l1div);
  }

  // Wire row clicks
  out.querySelectorAll(".tree-row-l1").forEach(el => {
    el.addEventListener("click", () => {
      const id = el.dataset.l1;
      if (state.expandedL1.has(id)) state.expandedL1.delete(id);
      else state.expandedL1.add(id);
      filterHierarchy();
    });
  });
  out.querySelectorAll(".tree-row-l2").forEach(el => {
    el.addEventListener("click", () => {
      const id = el.dataset.l2;
      if (state.expandedL2.has(id)) state.expandedL2.delete(id);
      else state.expandedL2.add(id);
      filterHierarchy();
    });
  });
  out.querySelectorAll(".tree-row-leaf").forEach(el => {
    el.addEventListener("click", () => {
      const cid = el.dataset.cid;
      // Switch to clusters tab and select
      $$("nav#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === "clusters"));
      $$(".tab").forEach(t => t.classList.toggle("active", t.id === "tab-clusters"));
      selectCluster(cid);
      // Make sure the row is in the rendered list
      $("#cluster-search").value = state.clustersById.get(cid)?.canonical || "";
      filterClusters();
      selectCluster(cid);
    });
  });

  $("#hier-count").textContent = q
    ? `${visibleCount} top-level matches`
    : `${l1Sorted.length} super-categories · ${state.hierarchy.length} leaf clusters`;
}

// ---------- Taxonomy gaps ----------

function renderGaps() {
  $("#gap-min").addEventListener("input", filterGaps);
  $("#gap-dist").addEventListener("input", filterGaps);
  filterGaps();
}

function filterGaps() {
  const minPapers = parseInt($("#gap-min").value) || 1;
  const minDist = parseFloat($("#gap-dist").value) || 0;
  const rows = state.hierarchy
    .filter(r => r.total_count >= minPapers && r.taxonomy_distance >= minDist)
    .sort((a, b) => b.total_count - a.total_count);

  $("#gap-count").textContent = `${rows.length} candidate gaps`;
  const html = `
    <table class="gaps-table">
      <thead>
        <tr>
          <th>Cluster (canonical)</th>
          <th class="num">Mentions</th>
          <th>Nearest taxonomy</th>
          <th>Facet</th>
          <th class="num">Distance</th>
        </tr>
      </thead>
      <tbody>
        ${rows.slice(0, 500).map(r => `
          <tr data-cid="${r.cluster_id}">
            <td><a class="link" href="#" data-cid="${r.cluster_id}">${escapeHtml(r.canonical)}</a></td>
            <td class="num">${r.total_count}</td>
            <td>${escapeHtml(r.nearest_taxonomy)}</td>
            <td>${escapeHtml(r.nearest_taxonomy_facet || "")}</td>
            <td class="num">${r.taxonomy_distance.toFixed(2)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    ${rows.length > 500 ? `<p class="muted">… ${rows.length - 500} more</p>` : ""}
  `;
  $("#gaps-table").innerHTML = html;
  $("#gaps-table").querySelectorAll("a.link").forEach(a => {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const cid = a.dataset.cid;
      $$("nav#tabs button").forEach(b => b.classList.toggle("active", b.dataset.tab === "clusters"));
      $$(".tab").forEach(t => t.classList.toggle("active", t.id === "tab-clusters"));
      $("#cluster-search").value = state.clustersById.get(cid)?.canonical || "";
      filterClusters();
      selectCluster(cid);
    });
  });
}

// ---------- Clusters ----------

function renderClusters() {
  const search = $("#cluster-search");
  const sortSel = $("#cluster-sort");
  const minInput = $("#cluster-min");
  search.addEventListener("input", () => filterClusters());
  sortSel.addEventListener("change", () => filterClusters());
  minInput.addEventListener("input", () => filterClusters());
  filterClusters();
}

function filterClusters() {
  const q = $("#cluster-search").value.trim().toLowerCase();
  const sort = $("#cluster-sort").value;
  const min = parseInt($("#cluster-min").value) || 1;

  let rows = state.clusters.filter(c => c.paper_count >= min);
  if (q) {
    rows = rows.filter(c => {
      if (c.canonical.toLowerCase().includes(q)) return true;
      return c.members.some(m => m.kw.toLowerCase().includes(q));
    });
  }
  if (sort === "paper_count") rows.sort((a, b) => b.paper_count - a.paper_count);
  else if (sort === "member_count") rows.sort((a, b) =>
    b.member_count - a.member_count || b.paper_count - a.paper_count);
  else if (sort === "canonical") rows.sort((a, b) =>
    a.canonical.localeCompare(b.canonical));

  $("#cluster-count").textContent = `${rows.length.toLocaleString()} clusters`;

  const list = $("#cluster-list");
  list.innerHTML = "";
  // Render up to first 1000 for perf; a virtual list would be nicer but this is fine
  const slice = rows.slice(0, 1000);
  for (const c of slice) {
    const div = document.createElement("div");
    div.className = "list-row";
    if (c.id === state.selectedClusterId) div.classList.add("selected");
    div.dataset.cid = c.id;
    const preview = c.members.slice(0, 5).map(m => m.kw).join(" · ");
    div.innerHTML = `
      <div class="canon">${escapeHtml(c.canonical)}</div>
      <div class="stats">${c.paper_count} papers · ${c.member_count} member${c.member_count === 1 ? "" : "s"} · ${c.id}</div>
      ${c.member_count > 1 ? `<div class="preview">${escapeHtml(preview)}</div>` : ""}
    `;
    div.addEventListener("click", () => selectCluster(c.id));
    list.appendChild(div);
  }
  if (rows.length > 1000) {
    const note = document.createElement("div");
    note.className = "list-row muted";
    note.textContent = `… ${rows.length - 1000} more (refine search to see)`;
    list.appendChild(note);
  }
}

function selectCluster(cid) {
  state.selectedClusterId = cid;
  $$(".list-row").forEach(r => r.classList.toggle("selected", r.dataset.cid === cid));
  const c = state.clusters.find(x => x.id === cid);
  if (!c) return;

  const detail = $("#cluster-detail");
  // Build members table
  const memberRows = c.members.map(m => `
    <tr>
      <td>${escapeHtml(m.kw)}${m.kw === c.canonical ? " <span class='muted'>(canonical)</span>" : ""}</td>
      <td class="num">${m.count}</td>
      <td class="num">${m.distance.toFixed(3)}</td>
    </tr>
  `).join("");

  // Subcommittee histogram (primary committee assignment)
  const subcCounts = {};
  for (const pid of c.papers) {
    const p = state.papersById.get(pid);
    if (p && p.primary) subcCounts[p.primary] = (subcCounts[p.primary] || 0) + 1;
  }
  const subcRows = Object.entries(subcCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([s, n]) => `<tr><td>${escapeHtml(s)}</td><td class="num">${n}</td></tr>`)
    .join("");

  // Sample papers — id + (title if available), no links
  const sampleN = Math.min(20, c.papers.length);
  const sampleHtml = c.papers.slice(0, sampleN).map(pid => {
    const p = state.papersById.get(pid);
    if (!p) return "";
    const title = p.title
      ? `<span class="title">${escapeHtml(p.title)}</span>`
      : "";
    return `<div class="paper-line"><span class="pid">${escapeHtml(pid)}</span>${title}</div>`;
  }).join("");

  detail.innerHTML = `
    <h2>${escapeHtml(c.canonical)} <span class="cid">${c.id}</span></h2>
    <div class="summary">
      ${c.paper_count} papers · ${c.member_count} member keyword${c.member_count === 1 ? "" : "s"} · ${c.total_mentions} total mentions
    </div>

    <h3>Members</h3>
    <table>
      <thead><tr><th>Keyword</th><th class="num">Count</th><th class="num">Cos dist</th></tr></thead>
      <tbody>${memberRows}</tbody>
    </table>

    <h3>Top subcommittees (primary)</h3>
    ${subcRows ? `<table><tbody>${subcRows}</tbody></table>` : "<p class='muted'>No subcommittee data.</p>"}

    <h3>Papers (${sampleN} of ${c.paper_count})</h3>
    <div class="papers-list">${sampleHtml}</div>
  `;
}

// ---------- Taxonomy ----------

function renderTaxonomy() {
  $("#tax-search").addEventListener("input", filterTaxonomy);
  filterTaxonomy();
}

function filterTaxonomy() {
  const q = $("#tax-search").value.trim().toLowerCase();
  let rows = state.taxonomy.map(t => ({ keyword: t.keyword, paper_count: t.papers.length }));
  if (q) rows = rows.filter(r => r.keyword.toLowerCase().includes(q));
  rows.sort((a, b) => b.paper_count - a.paper_count);
  const max = rows[0]?.paper_count || 1;

  $("#tax-count").textContent = `${rows.length} keywords`;
  const out = $("#taxonomy-list");
  out.innerHTML = rows.map(r => `
    <div class="bar-row">
      <div class="label">${escapeHtml(r.keyword)}</div>
      <div class="count">${r.paper_count}</div>
      <div><div class="bar" style="width:${(r.paper_count/max*100).toFixed(1)}%"></div></div>
    </div>`).join("");
}

// ---------- helpers ----------

function escapeHtml(s) {
  return (s || "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[ch]));
}

let toastTimer = null;
function toast(msg) {
  let t = $(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1400);
}

load().catch(err => {
  document.body.innerHTML = `<pre style="padding:20px;color:#a00">${err.stack || err}</pre>`;
});
