# Planner engines

Read this when changing scheduling, placement, reservations, time budgets, or planner tests. Then open the one function you are changing. Leave `js/assistant-*.js` closed; the assistant is a separate side feature.

## Where to edit

| Change | Fast | GLPK |
|---|---|---|
| Best fit for one item | `tryPlaceOnDay` in `js/today-view-reservations.js` | `listPlaceFitsOnDay` and `solveDayPackingIlp` in `js/agenda-optimizer-ilp.js` |
| Defer a movable | `fastPathDefersMovable` in `js/today-view-reservations.js` | deferrable set and option weights in `js/agenda-optimizer-ilp.js` |
| Week packing | `buildWeekAgenda` in `js/today-view-today.js`; day packing in `js/today-view-week.js` | `buildWeekAgendaAsync` in `js/agenda-optimizer-ilp.js` |
| Order links | `plannerOrderConstraintsForDay` in `js/today-view-fits.js` | same helper, plus ILP order rows in `solveDayPackingIlp` |
| Day / week repair search | `fastGraphPlacement`, `improveFastGraphWeek` in `js/agenda-fast-graph.js` | the ILP itself |
| Weather deferral | `weatherShouldDeferCandidate` in `js/weather.js` | today's option weight in the ILP |
| Daily breakable reserve | `dailyBreakableReservations` in `js/today-view-reservations.js` | `movable_breakable_reserve` row in `solveDayPackingIlp` |

Both engines call `tryPlaceOnDay`, `auditFillFitInGap`, `freeSegmentsInWindow`, `commitPlacement`, `dailyBreakableReservations`, `movableCapacityForDay`, `breakableReservationWindows`, and `plannerOrderConstraintsForDay`. A behaviour change usually means editing the shared primitive or landing it in both engines.

## Fixed appointments

Local meetings/classes store an `appointment` rule (once or weekly, local start date/time, optional end date, and per-date exceptions). `appointmentOccurrence` expands that rule; `collectScheduledAgendaEvents` reserves the literal interval in both engines, including an overnight carry from the previous date. These items bypass flexible candidates and habit cadence. Completion logs do not release their reservation, and elapsed appointments leave today's agenda without recording attendance or becoming missed work.

Keep `scheduledDay` and reminder identity on the occurrence's original date, including after midnight. Appearance, cancellation, time and duration exceptions use that date; native reminder date overrides are stored separately. Calendar-imported meetings remain provider-owned timed tasks with calendar series preferences. Both appear as “Fixed time”; edit provider-owned schedule/title/link fields in the source calendar.

## Two engines

| Engine | File | Entry | When used | Placement order |
|---|---|---|---|---|
| **GLPK ILP optimizer** (default) | `agenda-optimizer*.js` | `buildWeekAgendaAsync` | `?planner=` not `fast`; tests `PLANNER_MODE=default` | fixed items first (ILP), daily breakables after, rescue pass, breakable gap-fill |
| **Fast bounded graph planner** | `today-view-*.js` | `buildWeekAgenda` | `?planner=fast`, optimizer off, GLPK fallback/preview | **movables first**, daily breakables last |

GLPK is the production planner: slower than Fast, and better at respecting constraints and preferences. Fast is the quality-parity track (preview, optimizer-off, fallback). It becomes the main engine only when it can replicate those results. Do not switch the app default before then.

## Vocabulary

- **Movable** (`isMovableWeekCandidate`, `today-view-reservations.js`): a one-shot `task` or a sparse rhythm (`target > 1`) that has not reached its last permitted day. A daily rhythm (`target ≤ 1`), a breakable, a pinned item, and an occurrence whose `delayAllowanceDays` has expired are not movables. Movables choose a day. `earlyWindowDays` never grants permission to defer.
- **Daily breakable** (`dailyBreakableReservations`): a daily recurring breakable (for example "Work 6h") with a per-day deficit to protect inside its allowed window. Its reservation is the window minutes it still needs.
- **Reservation windows** (`breakableReservationWindows`): the clock windows a breakable may occupy. Movables are capped in these via `movable_breakable_reserve` (aggregate spare, ILP) and `fastPathDefersMovable`.
- **Fit**: a feasible `{placeStart, placeEnd, locId, score}` for one item on one day. `tryPlaceOnDay` returns the single best scored fit (weather guidance outranks ASAP/preference/scarce overlap; travel/day/order stay in the core rank). `listPlaceFitsOnDay` enumerates many for GLPK.
- **Scarcity** (`scoring.js`): a packed integer encoding how tight an item's windows are (feasible slots × slack). Drives priority and urgency.
- **Order constraints** (`agenda-order.js`, `plannerOrderConstraintsForDay` in `today-view-fits.js`): schedule links / drag reorder become `beforeHid` / `afterHid` / `adjacency:'direct'` edges for a given `dayBase`.

## Decision flow (GLPK, per day, today-first)

1. Build `fixedCands` (non-breakable candidates eligible that day).
2. Compute the `deferrable` set: movables still inside their explicit delay window with another eligible day that has capacity. Last-day occurrences become hard selection rows when a fit can coexist with daily-breakable protection. Only strictly higher priority may displace the protected deficit.
3. Enumerate fits per candidate (`optimizerFitsForFill` → `listPlaceFitsOnDay`). Anchors are candidate window edges plus boundary probes. A stepped grid is used only when order links or doing-now exist.
4. Solve the ILP (`solveDayPackingIlp`): maximise the sum of option weights with one option per candidate, no time clash, order rows, and `movable_breakable_reserve` (movables' in-window overlap ≤ spare, unless packed and higher-priority).
5. Commit, then place daily breakables (`placeBreakableSessions`), then `rescueLeftoverWeekFits`, then breakable gap-fill.
6. Publish either `GLP_OPT` or a time-limited `GLP_FEAS` incumbent. Fall back to `packDayWithHeuristic` only when there is no usable incumbent (load, error, infeasible, or timeout before any feasible solution). Missing an optimality proof before the time limit is not itself a failed solve.

GLPK work conflicts use maximal interval cliques from an endpoint sweep (ends before starts at equal clocks). Each clique allows at most one option; candidate rows cover alternative fits for the same item. This preserves integer feasibility while tightening the fractional relaxation and replacing dense pair rows. Travel-only conflicts and order/reservation rows remain separate. Route provenance is optimal only when both selection and frozen-selection polish prove their optima. After route/link/hour repairs, unfinished split-task pools get one additional allocation pass to reclaim newly exposed gaps; existing chunks and future memo minutes remain deducted.

The fast engine places movables first (ASAP plus reservation steering) and breakables last, with `fastPathDefersMovable` as the gate. Weather-guided movables also use `weatherShouldDeferCandidate`, so a much drier later day wins the same way GLPK drops today's option weight. Untimed plan logs strongly prefer that calendar day. The visual pin does not. The last on-time day stays eligible, so a failed Saturday plan cannot drop a Sunday due date. Skip completed days when reading leftover plans, and do not let a future catch-up plan erase a due or overdue today miss during `fullToday` reconstruction.

Blocked fixed insertions use `fastGraphPlacement`: bounded beam search over partial day schedules, reopening up to seven existing non-linked, non-breakable placements. Keep-all search is transactional. Fast packs scarce one-day P0 first, then planned and last-day tasks, then seed-neighborhood errands that still fit before a later far location pin, then work at the place you are already standing, then slack daily P0. That order keeps an earliest-clock prayer from fragmenting the only long slot a due visit needs, and keeps a short at-seed window from consuming the only pre-pin gap those nearby errands needed. An at-home prayer or lunch must not jump ahead of that neighborhood batch, because that sends you out to the far pin, back for the errand, and out again. Away items yield to the current place only when the whole at-location block still leaves them a slot, so standing at a store does the errand there before a home lunch. A last-day task that would miss stays ahead of that block. The yield flag is on the away item, so two errands at the current place cannot disagree about whether the task can wait.

That claim order is only the packing seed. After the day is filled, Fast replays alternate orders ranked by full route cost (every order when the day has at most seven fills; a beam with one-step lookahead otherwise) and keeps a chain only when the same work is strictly cheaper. GLPK's return term is the extra round trip in those same units, with no constant floor, so a short loop can still lose to a large clock or weather cost. `tryPlaceOnDay` enumerates unforced venues so Fast sees the same location set as GLPK. Planned items outrank at-location sequencing. `improveFastGraphWeek` searches when a planned or pinned item, or a day-choosing leftover, is still unplaced: cheap insert/eject first, then at most eight whole-week rebuilds. Packed weeks skip that search. The cheap repair includes single-eligible-day leftovers and ranks up to four movable blockers by window overlap. It tries single blockers and pairs, then parks them on eligible days with depth-two backtracking. Direct insertion, graph edges and ejection probes share a 192-probe cap. Transfers preserve neighboring clocks, chunks and venues, recheck reservations/weather/cadence, and commit only when all displaced work survives. Whole-week replay also preserves already-claimed deadline days. A failed plan day still leaves the last on-time day eligible in both engines. GLPK's ILP rows and weights are otherwise unchanged.

Encode guarantees by scheduling semantics, never by habit name, prayer type, or weekday. A weekly prayer exposed bugs in this packing order; the rule has to work unchanged for any equivalent occurrence.

## Reserve model

Movables may use a breakable's window only up to the aggregate spare (window time minus the breakable's deficit). If a movable fits in a clock gap that touches no reservation window, it places there today instead of deferring. See `placementFitsOutsideReservations`, `placementFitOutsideReservations`, and `movableFitsOutsideReservations` in `today-view-reservations.js`, and the matching `movable_breakable_reserve` row in `solveDayPackingIlp`. Multiple movables chain at duration-spaced starts. Overflow defers (verified for up to 8).

The reserve protects aggregate minutes, not contiguity. Many movables can splinter a breakable's window into pieces shorter than `minChunkMinutes`, so the breakable cannot place even though aggregate spare exists. This is the "Work deferred" edge. Protect contiguity if you touch this.

## Production policy

- **Encode guarantees by scheduling semantics, never by habit name or id.** `mustPlaceCriticalOccurrence` is the policy for a feasible non-breakable, non-task recurring P0 occurrence that is daily or has no alternate eligible day. The rule must work unchanged for medication, care, or any other equivalent occurrence.
- **"P0" is not one universal hard constraint.** Recurring occurrences, tasks, and breakables have different semantics. Breakables are protected by deficit reservations and placed or split after fixed candidates. Tasks use pinning, deadlines, priority, and movable-day capacity. Putting either class into the recurring-occurrence hard tier can make the model infeasible, or let broad work and flexible tasks displace narrow windows and explicit linked pairs.
- **Hard rows make time-limited incumbents safe.** Objective bonuses alone do not guarantee that a feasible-but-not-optimal solve contains a critical occurrence. If the UI may publish `GLP_FEAS`, non-negotiable policy must be an ILP constraint (`sum(candidate options) = 1` when at least one fit exists), with matching Fast-path ordering for fallback and preview.
- **`GLP_OPT` covers the fixed-item ILP, not the entire final agenda.** Daily breakables are inserted afterward, so an optimal fixed pack can still leave a breakable short when aggregate reserved minutes are split below `minChunkMinutes`. Treat complete-agenda quality (P0 breakable minutes, total week minutes, overdue work, travel) separately from the solver's fixed-pack status.
- **Contiguity repair sometimes needs a neutral intermediate move.** Moving one 30-minute blocker may not create a valid 45-minute chunk, while moving two adjacent blockers together creates 60 minutes. The deep background pass uses a bounded 2/3-item neighborhood. Do not regress it to one-victim greedy repair or an unbounded power-set search.
- **Background refinement is revision-guarded and improvement-only.** Publish the quick incumbent first, then keep searching off-main while the app stays visible if the fixed-item ILP is not yet a GLPK proof. Replay days already proved `optimal` so extra time lands on remaining feasible days. Cancel on a data or location revision, a hidden page, or a foreground or imminent re-solve. A replacement must preserve active rows and every placed critical or pinned occurrence, must not reduce total week work, and must strictly improve the lexicographic agenda-quality tuple. Stop after a proof, after the deeper neighborhood pass when only breakable fill remains, or after a bounded number of while-open passes.
- **Order links are coupled placement policy.** A critical successor must claim its narrow window before a flexible predecessor is backfilled under the order ceiling. Otherwise placing the predecessor independently can invalidate the successor. Preserve `direct` adjacency. Missing or undoable partners obey the existing link eligibility rules. Do not make every linked item globally mandatory.
- **A large open gap is evidence, not a complete feasibility proof.** The remaining-gap audit examines the already-built agenda. `MISSED GAPS 0` can still hide a make-space failure where movable rows could shift to create one contiguous slot for a long item. Reproduce both the static gap and the rearranged alternative before changing deferral or reservation policy.
- **Audit planner provenance separately from the settings toggle.** "GLPK on" means the exact path was requested. It does not prove the displayed rows came from an optimal solve. When debugging, record whether the result was a fast preview, `GLP_OPT`, a time-limited `GLP_FEAS`, or a true heuristic fallback.
- **Performance tests need cold and warm cases.** Cached home output can hide worker and solve latency. Measure a cold exact rebuild with the heavy backup, a subsequent cached render, and Fast separately. Preserve a valid incumbent at the time budget.

Cold-open budget stays at 4 seconds (`nativeLimitSeconds`). Do not raise it on first paint, idle cache refresh, or user edits. Extra budget is only the while-open 60s tick when the next pending row is within `HOME_AGENDA_IMMINENT_MS`, via `tickReplan`, or background refinement after a usable agenda is already on screen. Most ticks must clock-shift or keep the last week instead of resolving. When a re-solve does run, replay the last fills and skip GLPK if they still fit; otherwise inject those clocks as ILP options. `day0Only` must seed the worker with `memoDays` from the mounted week so far days are not re-solved just because the worker was cold. If the mounted week is not a GLPK proof (`plannerSolveStatus !== 'optimal'`), keep searching off-main while the page is visible: replay days already proved optimal, spend remaining budget on the rest, and publish only if the lexicographic quality tuple strictly improves. Cancel on hide, edit, or an imminent tick replan.

## Tests

- Mirror `tests/movable-non-overlap-deferral-test.js`.
- Freeze the clock inside `page.evaluate` (replace `globalThis.Date`). Call `buildWeekAgendaAsync` (GLPK) and `buildWeekAgenda` (fast) on the same data. Assert on the day summaries. Use a `glpkOk` guard to soft-skip GLPK when WASM cannot load.
- Fixture helpers: `base(props)`, `openEveningSettings()`, `windowedSettings()` in `tests/helpers/planner-test-helpers.js`.
- Run `./run-tests.sh planner` after planner changes. The smart matrix opens the production GLPK page. `page-both` files add a Fast pass. Use `--mode fast` when iterating on Fast quality. Dual-engine helpers may still call both entries in one session.
- Classify each new top-level test in `tests/test-suites.tsv`. The runner rejects unclassified tests.

## Debugging a real day

The in-app Day Agenda Audit (triple-tap a day header) prints the decision trace: engine, per-item `selected` / `UNPLACED`, scarcity, and the remaining-gap audit.

To reproduce a day from an exported backup (sensitive — keep it in `lib/`):

1. Export via Settings → Export backup → `lib/tings-backup-YYYY-MM-DD.json`.
2. In a scratch script under `test-results/`, read the file, strip logs at or after the frozen `now`, freeze `Date`, and run both `buildWeekAgendaAsync` and `buildWeekAgenda`.
3. Print only placement minutes and counts. Never dump raw habit data.

If the live app shows a bug the local fix cannot reproduce, the installed copy is almost certainly running service-worker-cached JS. Bump `sw.js` `CACHE` and reload.

A worked example of the movable non-overlap deferral fix, including regressions, is in `HANDOFF-movable-deferral-fix.md` when that file is present. It is gitignored and ignored by the agent.
