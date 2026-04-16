# How this schedule was built

This document explains the process behind the DIS 2026 working schedule —
written for TPC members and the broader community. Feedback welcome.

## The problem

DIS 2026 accepted **292 items** (249 papers, 39 pictorials, 4 TOCHI notes)
that must be grouped into **48 paper sessions** and assigned to **10 parallel
time slots** across three days (Mon 15 Jun, Tue 16 Jun, Wed 17 Jun). The
conference schedule has:

| Day     | Slots   | Tracks per slot    | Paper sessions |
|---------|---------|--------------------|----------------|
| Mon     | 3       | 5, 5, 4 (+1 industry) | 14          |
| Tue     | 4       | 5, 5, 5, 4 (+1 industry) | 19       |
| Wed     | 3       | 5, 5, 5            | 15             |
| **Total** |       |                    | **48**         |

We had two questions to answer:

1. **Which items go together in a session?**
2. **When does each session run, and in which room?**

## Grouping items into sessions (Step 1)

Titles and abstracts of all 292 items were embedded with a sentence-transformer
model (`all-mpnet-base-v2`, 768-dim), then reduced to 2D and 3D via UMAP for
visualization. Four clustering approaches were tried:

| Method                         | Mean cohesion | Notes |
|--------------------------------|---------------|-------|
| Balanced K-means               | 0.466         | |
| Gale-Shapley stable matching   | 0.470         | |
| Hierarchical split             | 0.465         | |
| Keywords-based (kw + title)    | 0.553         | worse — sparser text |

We chose a variant of Gale-Shapley with a minimum of 6 items per session — all
sessions then have 6 or 7 items, so every session runs the same presentation
length. Internal cohesion stays tight (mean pairwise cosine distance 0.48).

Each of the 48 sessions was given a short descriptive name and (where the
topic wasn't sensitive) a playful alias. Sessions dealing with grief,
violence, chronic illness, healthcare, or trauma keep only the descriptive
name — they carry a small red dot in the viewer.

## Scheduling sessions into slots (Step 2)

### Hard constraints

- **48 sessions into 48 cells** (exact fit to the grid above)
- **Paper8544** (authors wanted a Wed slot) → the session containing it must
  land on Wed
- **First-author conflicts**: Anqi Wang appears as first author in both
  sessions 21 and 28; they must run in different slots. Likewise Alejandra
  Gómez Ortega in sessions 30 and 31.

### Objective: "room-camp satisfaction"

We want an attendee with a coherent set of interests to be able to **sit in
one room all day**, because the sessions in that room across the day's slots
are all ones they care about. Formally:

> For each (attendee, day) pair, the attendee picks the room with the highest
> total interest for that day (sum of their ratings for the sessions in that
> room across the day's slots). Maximize this, summed across attendees and
> days.

To define "attendee interest" we built **15 personas** — coherent archetypes
of people who come to DIS, covering methods (systems research, soma,
pictorial, speculative), topics (GenAI, XR, HRI, materials, accessibility,
aging, etc.), and stances (justice, civic). Each persona gives every session
a rating of **1–5**. The full persona list is at
[personas.html](personas.html); the 48×15 rating matrix is derived from
careful reading of each session's titles and abstracts.

The 15 personas are named after members of Tony Tang's research lab
(RICELab) past and present, as a small in-joke.

### Algorithm

Simulated annealing with 2-opt swap moves and multi-restart. Each run:

- ~200 K iterations of primary cooling (T: 5.0 → 0.005)
- 3 restart perturbations + re-cooling
- Incremental objective updates (caches column sums per persona×day×room)
- 5 random seeds; keep best

**Result:** total satisfaction **594 / 636** (theoretical upper bound from
per-persona top-10 ratings). Gap of 42 is largely unavoidable because
different personas compete for overlapping top-rated sessions, and Jun (GenAI)
alone has 12 "must-attend" sessions in only 10 slots.

## Ordering items within each session (Step 3)

Once items are grouped and sessions are slotted, we order items within each
session by brute-forcing all permutations (6! or 7! per session — tiny) and
scoring each against four rules:

1. **Hard:** same first-author items must be ≥2 positions apart — no-one
   presents two talks back-to-back.
2. **Flow:** minimize sum of consecutive 3D-embedding distances so topics
   segue naturally.
3. **Pictorial clustering:** group pictorials consecutively (shared AV setup).
4. **TOCHI anchor:** TOCHI notes are journal-length work; prefer the last
   position so they anchor the session.
5. **Accessible opener:** bias the first slot toward the session's "most
   central" paper (smallest mean distance to the others).

## Validation

Two test scripts enforce correctness:

- **`test_matrix.py`** — 48 × 15 cells, all ratings in [1,5], JSON ↔ CSV
  consistency, session IDs aligned.
- **`test_schedule.py`** — every session assigned exactly once; slot
  capacities exact; session 3 on Wed; session pairs 21⇄28 and 30⇄31 in
  different slots.

Both pass after every rebuild.

## What's open

- **First-author constraints beyond Anqi Wang and Alejandra** have not been
  enforced as hard rules — only those two pairs. Other same-author pairs that
  share a session are allowed to present back-to-back within their session.
- **Session 3 assigned to Wed** based on one author's request; other author
  day preferences have not been collected.
- **Day-of-week preferences** for other items are not encoded.
- **Keynote and industry slots** (Mon 0900–1030, Mon/Tue 1600–1730 industry
  slot, Wed 1600–1730 closing keynote) are reserved; the 48 paper sessions
  fit exactly around them.

## The viewers

- **[schedule.html](schedule.html)** — plain schedule view. Grid of all 48
  sessions. Click any cell to see the papers inside. Search bar matches on
  paper title, author name, or item ID (e.g. `8544`, `Pictorial2215`,
  `tochi`).
- **[schedule-personas.html](schedule-personas.html)** — the same grid, with
  15 animal-persona chips across the top. Hover a persona to preview its
  description; click to pin. Ctrl/Cmd-click to select multiple. The page
  highlights each persona's "route" through the schedule (the session they
  would attend in each slot) and shades cells by their interest level.
- **[personas.html](personas.html)** — static roster of the 15 personas with
  topic and description.

## Reproducing

The scheduling toolchain is open source at
<https://github.com/hcitang/dis2026-schedule>. To rebuild from scratch:

```bash
python3 embed.py                       # title+abstract → embeddings + UMAP
python3 gale_shapley_min6.py           # cluster 292 items into 48 sessions
python3 order_sessions.py              # order items within each session
python3 schedule_optimizer.py          # assign sessions to day/slot/room
python3 generate_report.py             # per-persona camp report
python3 test_matrix.py && python3 test_schedule.py   # verify constraints
```

## Feedback

This is a *working* schedule — it will change in response to authors' day
preferences, programming notes, and committee review. Please send feedback
on sessions, orderings, or the personas: all of it helps tune the next
iteration.
