# AGENTS.md — engineer onboarding for "Tings" (habits planner)

Static habit/day planner. Vanilla JS (no framework, no build step), served as-is.
Open `index.html` via any static server. All state lives in `localStorage`.

> **Read this first**, then `DOCUMENTATION.md` for the product/field reference
> (habit types, every habit/settings field, UI symbols). This file is the
> *engineering* map: how the code is laid out, how the planner works, how to run
> and extend it, and the gotchas that will cost you hours if you don't know them.

---

## 1. Quick start

```bash
npx serve -l 4181 -s .          # serve locally (tests expect port 4181)
# then open http://127.0.0.1:4181/

./run-tests.sh                  # smart full matrix; both planners where relevant
./run-tests.sh planner          # planner/optimizer suite only
./run-tests.sh ui               # general rendering and interaction suite
./run-tests.sh --changed        # infer suites from current git changes
```

Tests are **Playwright** (`{ chromium }`) driving the live page via
`page.evaluate(...)`. Each `tests/*.js` is standalone — run one with:

```bash
HABITS_URL=http://127.0.0.1:4181/ node tests/<name>.js
```

Results land in `test-results/` (`last-run.log`, `.last-run.json`, per-failure
dumps in `failed/`). Normal runner output is intentionally compact; pass
`--verbose` to stream every assertion. Tests are classified in
`tests/test-suites.tsv`; exploratory `zz-*` scripts belong to the opt-in
`diagnostics` suite. See `TESTING.md` for the complete runner reference.

---

## 2. ⚠️ Gotchas (read before changing anything)

1. **There are TWO planner engines that must stay in sync.** Any scheduling-logic
   change usually needs to land in *both* `js/today-view-*.js` (fast) **and**
   `js/agenda-optimizer*.js` (GLPK) — then pass the suite in both `PLANNER_MODE`s.
   This is the #1 source of "works for me, broken for the user" bugs. See §5.

2. **Bump `sw.js` → `const CACHE = 'tings-vNN'` on EVERY JS change.** The
   service worker caches app JS **stale-while-revalidate** and only re-fetches
   when the cache key changes. If you edit JS without bumping it, deployed users
   keep running the *old* JS forever (the cache never invalidates). The repo
   convention is one bump per JS change (v64→v65→…). **Forgetting this makes a
   correct fix look like it did nothing.**

3. **Personal data is gitignored, never commit it.** `lib/*tings-backup*`,
   `lib/*.backup.json`, `lib/*.pdf` are ignored (backups contain addresses,
   logs). `test-results/` and `_scratch_*.js` are ignored too. Keep scratch repro
   scripts in `test-results/` or `/tmp` — never in `tests/` (the runner would
   pick them up and they may reference real data).

4. **Order/schedule-link items must not be relocated by placement steering.**
   When touching `tryPlaceOnDay` or GLPK fit injection, guard with
   `plannerOrderConstraintsForDay(dayBase)` — items in a `direct`/`adjacency`
   link must stay next to their partner. Skipping this regresses
   `schedule-links-test.js`.

5. **The planner is deterministic given identical input.** If you see the *same*
   day plan flip between renders, suspect (a) logs/state changed, (b) the GLPK
   solve produced **no usable incumbent** and fell back to the fast heuristic
   (`packDayWithHeuristic`, gated by `daySolveTimeoutMs` / `budgetLeft`), or
   (c) the home view showed a **fast preview** that GLPK hadn't replaced yet.
   A time-limited GLPK `GLP_FEAS` result is a valid incumbent, not a failed
   solve; keep it when all non-negotiable policy is represented by hard rows.

---

## 3. Codebase map

Scripts load in this order (no modules — everything is global). The big files
own a clear area; jump to these first.

| File | LOC | Owns |
|---|---|--:|---|
| `js/data-*.js` | 50–939 each | Persistence (`tings_v2` key), normalization, eligibility, schedules, logs, backups, and planner state |
| `js/today-view-{fits,reservations,week,today}.js` | 118–2329 each | **FAST planner engine**: fitting, reservations, week packing, and today rendering |
| `js/agenda-optimizer.js` + `agenda-optimizer-ilp.js` | 313 + 1624 | **GLPK ILP planner engine**: loader/worker entry, fits, constraints, and optimized week orchestration |
| `js/list-view-{home,sections,planner,actions}.js` | 908–2513 each | Home/dashboard, day sections, background planning/cache, and card actions |
| `js/main-{boot,input,runtime}.js` | 909–1364 each | Initialization/bindings, input sheets, timers/visibility/refresh loop |
| `js/settings-*.js` | 122–746 each | Settings UI, backup import/export, blocked times, locations, samples, and appearance |
| `js/detail-view-*.js` | 236–554 each | Detail sheet, links, tuning, stats, and pages |
| `js/overview-view.js` | 1213 | Overview screen |
| `js/locations.js` | 1059 | Locations, travel edges, routing |
| `js/scoring.js` | 908 | **Scarcity scoring** (`scarcity` numbers encode feasible-slots × slack) |
| `js/agenda-order.js` | 774 | Schedule links / order constraints (`plannerOrderConstraintsForDay`) |
| `js/agenda-planner-worker.js` | 209 | Web Worker wrapping GLPK so solves don't block the UI |
| `js/prayer-times.js` | 549 | Adhan-based prayer windows |
| `sw.js` | — | Service worker (precache + stale-while-revalidate) — bump `CACHE` on JS edits |

Large modules are sequential, byte-exact source slices. Their `<script>` and
`importScripts` lists are load-bearing, as are the CSS fragment links; preserve
their order and update the service-worker precache list whenever a slice moves.

---

## 4. Key entry points (what tests call)

```
load() / save(data)                    data.js      — localStorage I/O (key 'tings_v2')
loadSortSettings()                     data.js      — settings object
buildTodayAgenda(data, settings)       today-view-* — today's plan (fast)
buildTodayTimeline(agenda, now)        today-view-* — render rows
buildWeekAgenda(data, settings, 7)     today-view-* — FAST week plan
buildWeekAgendaAsync(data, settings, 7) agenda-opt* — GLPK week plan (await-able)
ensureGlpk()                           agenda-opt*  — loads glpk.mjs WASM
windowStillDoableToday(habit, now)     today-view-* — can it still fit today?
```

---

## 5. Planner architecture (the part you'll modify most)

### 5.1 Two engines, shared helpers

| Engine | File | Entry | When used | Placement order |
|---|---|---|---|---|
| **GLPK ILP optimizer** (default) | `agenda-optimizer*.js` | `buildWeekAgendaAsync` | `?planner=` not `fast`; tests `PLANNER_MODE=default` | fixed items first (ILP), daily breakables after, rescue pass, breakable gap-fill |
| **Fast scarcity heuristic** | `today-view-*.js` | `buildWeekAgenda` | `?planner=fast`; initial home "preview" | **movables first**, daily breakables last |

Both call the same primitives: `tryPlaceOnDay`, `auditFillFitInGap`,
`freeSegmentsInWindow`, `commitPlacement`, `dailyBreakableReservations`,
`movableCapacityForDay`, `breakableReservationWindows`,
`plannerOrderConstraintsForDay`. **A behaviour change usually means editing the
shared primitive OR landing it in both engines.**

### 5.2 Vocabulary (precise — misuse here causes bugs)

- **Movable** (`isMovableWeekCandidate`, `today-view-reservations.js`): a one-shot `task`
  **or** a sparse rhythm (`target > 1`). NOT a daily rhythm (`target ≤ 1`), not
  breakable, not pinned. Movables *choose a day* and can defer.
- **Daily breakable** (`dailyBreakableReservations`): a daily recurring
  breakable (e.g. "Work 6h") with a per-day **deficit** to protect inside its
  allowed window. Its "reservation" is the window minutes it still needs.
- **Reservation windows** (`breakableReservationWindows`): the clock windows a
  breakable may occupy; movables are capped in these via
  `movable_breakable_reserve` (aggregate spare, ILP) and `fastPathDefersMovable`.
- **Fit**: a feasible `{placeStart, placeEnd, locId, score}` for one item on one
  day. `tryPlaceOnDay` returns the single best (ASAP) fit; `listPlaceFitsOnDay`
  enumerates many for GLPK.
- **Scarcity** (`scoring.js`): a packed integer encoding how tight an item's
  windows are (feasible slots × slack). Drives priority/urgency.
- **Order constraints** (`agenda-order.js`): schedule links / drag reorder →
  `beforeHid`/`afterHid`/`adjacency:'direct'` edges for a given `dayBase`.

### 5.3 Decision flow (GLPK, per day, today-first)

1. Build `fixedCands` (non-breakable candidates eligible that day).
2. Compute `deferrable` set: movables with another eligible day that has capacity.
3. Enumerate fits per candidate (`optimizerFitsForFill` → `listPlaceFitsOnDay`,
   anchors = candidate window edges + boundary probes; stepped grid only when
   order links / doing-now exist).
4. Solve ILP (`solveDayPackingIlp`): maximise Σ option weights s.t. one option
   per candidate, no time clash, order rows, and the `movable_breakable_reserve`
   (movables' in-window overlap ≤ spare, unless packed + higher-priority).
5. Commit; then place daily breakables (`placeBreakableSessions`), then
   `rescueLeftoverWeekFits`, then breakable gap-fill.
6. Publishes either `GLP_OPT` or a time-limited `GLP_FEAS` incumbent. Falls back
   to `packDayWithHeuristic` only when there is no usable incumbent (load/error/
   infeasible/timeout-before-feasible), not merely because optimality was not
   proved before the time limit.

The fast engine does the same intent but greedily: movables first (ASAP +
reservation steering), breakables last, with `fastPathDefersMovable` as the gate.

### 5.4 The reserve model (why movables don't starve breakables)

Movables may use a breakable's window only up to the **aggregate spare** (window
time minus the breakable's deficit). If a movable fits in a clock gap **touching
no reservation window**, it places there today instead of deferring — see
`placementFitsOutsideReservations` / `placementFitOutsideReservations` /
`movableFitsOutsideReservations` (`today-view-reservations.js`) and the matching ILP
injection in `solveDayPackingIlp` (~845). Multiple movables **chain** at
duration-spaced starts; overflow defers gracefully (verified for up to 8).

> Caveat: the reserve protects *aggregate* minutes, **not contiguity**. Many
> movables can splinter a breakable's window into sub-min-chunk slivers so the
> breakable can't place even though aggregate spare exists. This is a known sharp
> edge (the "Work deferred" symptom) — protect contiguity if you touch this.

### 5.5 Production policy lessons (do not replace these with item-name fixes)

- **Encode guarantees by scheduling semantics, never by habit name/id.**
  `mustPlaceCriticalOccurrence` is the policy for a feasible non-breakable,
  non-task recurring P0 occurrence that is daily or has no alternate eligible
  day. A weekly prayer exposed the bug, but the rule must also work unchanged
  for medication, care, or any other equivalent occurrence. Never check for
  `Juma`, a prayer type, or Friday in the packing engines.
- **"P0" is not one universal hard constraint.** Recurring occurrences, tasks,
  and breakables have different semantics. Breakables are protected by deficit
  reservations and placed/split after fixed candidates. Tasks use pinning,
  deadlines, priority, and movable-day capacity. Putting either class into the
  recurring-occurrence hard tier can make the model infeasible or let broad Work
  and flexible tasks displace narrow windows and explicit linked pairs.
- **Hard rows make time-limited incumbents safe.** Objective bonuses alone do
  not guarantee that a feasible-but-not-optimal solve contains a critical
  occurrence. If the UI is allowed to publish `GLP_FEAS`, non-negotiable policy
  must be an ILP constraint (`sum(candidate options) = 1` when at least one fit
  exists), with matching Fast-path ordering for real fallback/preview behavior.
- **`GLP_OPT` covers the fixed-item ILP, not the entire final agenda.** Daily
  breakables are inserted afterward, so an optimal fixed pack can still leave
  Work short when aggregate reserved minutes are split below `minChunkMinutes`.
  Treat complete-agenda quality (P0 breakable minutes, total week minutes,
  overdue work, travel) separately from the solver's fixed-pack status.
- **Contiguity repair sometimes requires a neutral intermediate move.** Moving
  one 30-minute blocker may not create a valid 45-minute chunk, while moving two
  adjacent blockers together creates 60 minutes. The deep background pass uses
  a bounded 2/3-item neighborhood; do not regress it to one-victim greedy repair
  or an unbounded power-set search.
- **Background refinement is revision-guarded and improvement-only.** Publish
  the quick incumbent first, then refine off-main within the bounded budget.
  Cancel on a data/location revision or hidden page. A replacement must preserve
  active rows and every placed critical/pinned occurrence, must not reduce total
  week work, and must strictly improve the lexicographic agenda-quality tuple.
- **Order links are coupled placement policy.** A critical successor must claim
  its narrow window before a flexible predecessor is backfilled under the order
  ceiling; otherwise placing the predecessor independently can invalidate the
  successor. Preserve `direct` adjacency and let missing/undoable partners obey
  the existing link eligibility rules—do not make every linked item globally
  mandatory.
- **A large open gap is evidence, not a complete feasibility proof.** The
  remaining-gap audit examines the already-built agenda. `MISSED GAPS 0` can
  still hide a make-space failure where movable rows could shift to create one
  contiguous slot for a long item. Reproduce both the static gap and the
  rearranged alternative before changing deferral/reservation policy.
- **Audit planner provenance separately from the settings toggle.** "GLPK on"
  means the exact path was requested; it does not prove that the displayed rows
  came from an optimal solve. When debugging, record whether the result was
  fast preview, `GLP_OPT`, time-limited `GLP_FEAS`, or true heuristic fallback.
- **Performance tests need cold and warm cases.** Cached home output can hide
  worker/solve latency. Measure a cold exact rebuild with the heavy backup, a
  subsequent cached render, and Fast separately. Preserve a valid incumbent at
  the time budget rather than throwing away several seconds of GLPK work.

---

## 6. Writing/running tests

- Mirror an existing file, e.g. `tests/movable-non-overlap-deferral-test.js`.
- Pattern: freeze the clock inside `page.evaluate` (replace `globalThis.Date`),
  call `buildWeekAgendaAsync` (GLPK) **and** `buildWeekAgenda` (fast) on the same
  data, assert on the resulting day summaries. Use a `glpkOk` guard to soft-skip
  GLPK when WASM can't load.
- Fixture helpers worth copying: `base(props)` (full habit object with sane
  defaults), `openEveningSettings()` / `windowedSettings()` (blocked-time sets).
- Run `./run-tests.sh planner` after planner changes. The smart matrix runs
  Fast/GLPK parity tests once (they call both engines internally) and repeats
  only page-mode-sensitive tests. Use `--mode fast` only to isolate Fast.
- Put shared fixtures and pair-running helpers in
  `tests/helpers/planner-test-helpers.js` rather than copying them into a new
  file. Classify each new top-level test in `tests/test-suites.tsv`; the runner
  rejects unclassified tests.

---

## 7. Debugging a real-world planner bug

The in-app **Day Agenda Audit** (triple-tap a day header, see DOCUMENTATION.md
§6.4) prints the full decision trace (engine, per-item `selected`/`UNPLACED`,
scarcity, remaining-gap audit). It's the primary diagnostic.

To reproduce a user's exact day from an exported backup (sensitive — keep in
`lib/`, which is gitignored):

1. Export via **Settings → Export backup** → `lib/tings-backup-YYYY-MM-DD.json`.
2. In a scratch script under `test-results/` (gitignored), `fs.readFileSync` it,
   **strip logs ≥ your frozen `now`** (exports capture the whole day, so without
   stripping the reconstructed state won't match an earlier audit time), freeze
   `Date`, and run both `buildWeekAgendaAsync` / `buildWeekAgenda`.
3. Print only placement minutes + counts — never dump raw habit data.

Remember gotcha #2: if the live app shows a bug your local fixed code can't
reproduce, the user is almost certainly running **stale service-worker-cached
JS** — bump `sw.js` `CACHE` and have them reload.

---

## 8. Pointers for deep dives

- Habit/settings **field reference**: `DOCUMENTATION.md` §IV.
- Scarcity score format & symbols: `DOCUMENTATION.md` §V, `js/scoring.js`.
- GLPK constraint shapes (clash, order, reserve, travel pairs):
  `js/agenda-optimizer-ilp.js` `solveDayPackingIlp`.
- Fast-path deferral rules: `js/today-view-reservations.js` `fastPathDefersMovable`,
  `js/today-view-fits.js` `tryPlaceOnDay`.
- Recent worked example (movable non-overlap deferral fix, incl. regressions
  hit): `HANDOFF-movable-deferral-fix.md` (gitignored; ask if absent).
