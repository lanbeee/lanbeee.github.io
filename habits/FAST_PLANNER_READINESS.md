# Fast planner replacement: quality corpus and frame baseline

The baseline below was measured October 3, 2026 against source commit `45509d6`,
before implementation. For current changes, target gates and final measurements,
see [FAST_PLANNER_PROGRESS.md](FAST_PLANNER_PROGRESS.md). GLPK remains the default;
notification/alarm behavior and the frame's UI compatibility are unchanged.

## Run it

Serve this canonical PWA at port 4181, then:

```sh
node tests/planner-quality-gap-test.js
node tests/planner-quality-gap-test.js --require-parity
node tests/planner-quality-gap-test.js --require-target
QUALITY_CASE=long-block,off-grid node tests/planner-quality-gap-test.js
QUALITY_CASE=mixed-50 node tests/planner-quality-gap-test.js --fast-only
QUALITY_CASE=off-grid,cadence node tests/planner-quality-gap-test.js --device --no-repeat
```

The audit is registered in the opt-in `diagnostics` suite. At baseline it failed
on split-task overfill and six GLPK placement advantages. Those defects are now
fixed in this corpus; see the progress report. Improved results are allowed:
no assertion requires historical omissions or old clocks. Strict parity also
compares travel, weather and links; the separate target gate measures aggregate
5× speed and at least 95% of each cumulative priority tier's placement.

Optional controls:

- `QUALITY_CASE`: comma-separated substrings; no match is an error.
- `--fast-only`: run Fast without GLPK; cannot be combined with `--require-parity`.
- `--no-repeat`: one rebuild per engine; otherwise first/warm rebuilding is measured.
- `QUALITY_TIMEOUT_MS`: test-only deadline per request (75,000 ms default).
  Timeout terminates the isolated worker and is recorded as failure, not an empty plan.
- `QUALITY_FAST_MAX_MS`: optional first-rebuild latency gate; there is no assumed
  device-independent millisecond assertion.
- `--device`: existing debug Tings WebView, one attached adb device (or
  `ANDROID_SERIAL`), Node 22+ and America/New_York device timezone. It checks ten
  packaged planner files against local source and records mismatches; review them
  before attributing device results to local code. It creates/removes its own adb
  forwarding. It does not install, navigate, change the clock, or write app storage.

Reports are written incrementally to ignored
`test-results/planner-quality-desktop.json` / `planner-quality-device.json`.
A narrowed run replaces that report, so copy it before another run if needed.

## Method and guarantees

`tests/helpers/planner-quality-fixtures.js` supplies 16 fixed synthetic scenarios.
The first traps came from a seeded exploratory search; the checked-in audit never
searches randomly or reads a personal backup. All IDs, logs, weather samples,
places and travel edges are artificial.

Each scenario has a fresh dedicated worker. A test adapter imports the **existing
canonical planner worker**, retaining its production import order and both engines.
Its Date is frozen to Monday September 14 at 09:00 Eastern; the system/page clock
is untouched. Synthetic doing-now/reorder state lives only in that worker's
in-memory storage. GLPK retains ordinary four-second per-solve limits, normal week
budget, and no refinement. Identical warm requests do not use day-zero memo replay.
First GLPK timing includes its lazy solver load, after Fast has warmed the planner
worker; this is not a full cold-app startup measurement. Worker boot is reported
separately. Reported elapsed time includes result inspection/message overhead.

Every result is checked for finite positive durations, overlap across work/fixed
rows/travel, travel duration and aggregate capacity. The worker also checks
resolved dynamic windows and venue hours through shared helpers. Independent
Node checks read the raw fixtures for static windows, blocked hours, weekday/month
day eligibility, task date bounds, fixed clocks, task uniqueness/total split
minutes, snooze/completion exclusions, venue choice, known hard weather, links,
and scenario-specific required work/days/clocks. Manual feasible witnesses for
the small traps are validated independently. Checker mutation tests deliberately
corrupt duration, windows, fixed clocks, task duplication and blocked hours.

Hard order/same-day/interloper checks are separate from direct-link gap quality:
the current engine allows an empty gap and penalizes its length. Zero gap is not
mistakenly enforced as a hard rule. Weather scores, direct gaps, travel, per-priority
work, solve provenance and graph counters are recorded. Fast must be deterministic
on an identical warm rebuild. GLPK must actually return optimized `optimal` or
`feasible`, not a fallback merely because its setting was enabled. `optimal` means
the fixed-pack solver status, not a proof of a globally optimal complete week.

`--require-parity` is deliberately a conservative replacement gate: legality plus
no loss of work/cumulative priority minutes and no increase in travel, weather
penalty or direct gaps against the measured GLPK result. It is not a universal
loss function; a desirable tradeoff needs an explicit product decision and an
independent witness. Invalid/partial/fallback results cannot establish parity.
A small UI heartbeat measures worker offload responsiveness; it is not an INP,
scrolling, energy, or all-day battery test.

## Reproduced quality gaps

All rows below are legal; GLPK reported `optimal`. These are selection failures,
not infeasible wishes or exact-clock golden assertions.

| Scenario | Items / days | Fast work | GLPK work | Lost by Fast |
| --- | ---: | ---: | ---: | ---: |
| selection-trap | 9 / 1 | 150 min | 165 min | 15 min |
| long-block-trap | 8 / 1 | 210 min | 270 min | 60 min |
| short-hole-trap | 12 / 1 | 240 min | 255 min | 15 min |
| weather-selection-trap | 9 / 1 | 150 min | 165 min | 15 min |
| location-hours-selection-trap | 8 / 1 | 210 min | 270 min | 60 min |
| selection-trap-50-week | 50 / 7 | 560 min | 575 min | 15 min |

The first three use equal-priority daily occurrences with overlapping flexible
windows. The weather variant attaches a known compatible hard profile; the venue
variant imposes saved-place hours. The 50-item week adds 41 one-shot tasks with
weekday/time windows, priorities, places and weather. Those tasks cannot repair
the original Monday bottleneck. Hard-weather competition and venue alternatives
also have separate controls, so merely attaching an inactive feature is not
mistaken for testing its effect.

The bounded day graph preserves existing work and largely branches on insertion
order. Recovering these traps requires changing **which items** are selected.
The week graph only repairs leftover day-choosing/planned items; larger weeks skip
its whole-week rebuild branch above 16 candidates. Increasing that cap or brute
force probe budgets is not a suitable frame fix.

## Physical frame results

Attached B_077K, Android 11, WebView 83.0.4103.120, roughly 961 MiB physical RAM.
The four compared installed planner source files matched local source. These
measurements ran the real packaged planner in isolated workers, without UI work
or edits to saved items. Asset/process caches may be warm between scenarios.

| Scenario | Fast first / repeat | GLPK first / repeat | Finding |
| --- | ---: | ---: | --- |
| selection-trap | 1.35 / 1.03 s | 3.74 / 2.24 s | same 15 min deficit |
| long-block-trap | 0.76 / 0.49 s | 3.84 / 2.87 s | same 60 min deficit |
| selection-trap-50-week | 4.68 / 3.83 s | 7.55 / 5.09 s | same 15 min deficit |
| mixed-20 | 33.07 / 31.88 s | 38.71 / 41.01 s | GLPK reported fallback; not a quality oracle |
| mixed-35 | 69.94 / 67.22 s | not run | Fast repeated split tasks |
| mixed-50 | exceeded 75 s | not run | worker stopped at test deadline |

The mixed corpus combines daily/sparse/fractional/reduce/zero habits, split work,
completion logs, snooze, timed and untimed plans, fixed appointments, direct links,
active sessions, priorities, due/early/delay days, date restrictions, preferences,
prayer anchors, extra windows, weather, place hours, travel and daily capacity.
Desktop mixed-35/50 also detected split-task overfill; that extra work is **not**
counted as a Fast quality improvement. Desktop mixed-50 placed 2,273 versus 2,400
minutes, but Fast's result was illegal. GLPK was feasible, not a full-week proof.

On the frame, separate off-grid, place-weather inheritance/opt-out, cadence/partial
log, deadlines/plans/links, and prayer/combined/overnight controls passed both
engines. Most timer delays were small, but isolated delays reached about 135 ms
in the larger probes. Running off-main prevents a long synchronous solve on the
UI thread; it does not make a 70-second rebuild usable or energy-efficient.
Feature interactions, not item count alone, dominate this baseline. The exact
hotspots still need profiling; these timings do not isolate one helper as the cause.

## Coverage beyond the new corpus

A replacement must retain the existing suites too. These cover variants that a
single stress week cannot enumerate; their presence here is a coverage map, not
a claim that this audit ran every existing test.

| Feature family | New corpus | Existing detailed regressions |
| --- | --- | --- |
| Daily/sparse/fractional, reduce/zero, logs | cadence, mixed | tight-rhythm-capacity, retention-cleanup, breakable-partial-log-e2e |
| Critical priority, reservations, split chunks | traps, mixed, partial | agenda-optimizer, movable-non-overlap-deferral, breakable-continuous-e2e |
| Due/early/delay/plan-by, timed/untimed plans, pins | plans, mixed | last-day-due-pair, plan-by-date, plan-by-deferral, timed-day-plan |
| Schedule/order links, completed partners, active work | plans, mixed | schedule-links, completed-link-agenda, agenda-order-constraints |
| Alternative/separate windows, prayer/habit anchors, overnight blocks | options, anchored | habit-schedule-options, dynamic-times, sleep-block-dynamic, prayer-times |
| Places, opening/closed days, live origin, routes/returns | venues, mixed | locations-agenda, at-location-first, cluster-same-side-far-pin, cluster-objective |
| Hard/soft/relative/percentile weather, inheritance/opt-out, locks | weather controls, mixed | weather-planner, timed-breakable-weather-slack, day-header-weather-fit |
| Capacity, exclusions, snooze, cancellations | cadence, mixed | cancel-blocked-capacity, snoozed-cluster-eligibility, day-capacity-scorecard-e2e |
| Worker/cache/replay/refinement, forecast/drop boundaries | isolated worker/provenance | planner-performance-regression, home-agenda-tick, planner-forecast, planner-closed-forecast |
| Native reminder choices/travel/continuous alarms | unchanged; outside planner quality score | native-reminders + wrapper native/background/device tests |

Use the normal full planner matrix in both modes before changing production
packing, and integration tests for locations/prayer/storage semantics. Presentation,
sharing, links/shortcuts, notification choice and value tracking remain untouched;
a scheduling benchmark cannot replace their UI/data/native regression suites.

## Recommended next implementation, in order

1. **Correctness first:** make split task minutes a single week-wide remaining
   pool through every repair/rebuild; retained work must use occurrence identity
   and date, not raw rows. Keep the new overfill assertions failing until fixed.
2. **Profile and memoize expensive fit context per revision/build:** resolve
   prayer/combined windows, day/venue availability, merged weather and profile
   assessments once, reuse travel costs, and avoid repeated route replay when
   nothing changed. Measure both cold/warm on this frame; don't increase GLPK or
   graph budgets to disguise an expensive fitter.
3. **Selection-aware bounded day graph:** allow dropping/reinserting a small
   conflicting neighborhood and keep several alternative selections. Rank complete
   states by protected/critical obligations, then useful work, then route/weather/
   delay/preferences. Freeze active sessions, fixed commitments and coupled linked
   groups; speculative states must be transactional. The small traps are the gate.
4. **Rolling two-day repair with week obligations retained:** cheaply seed all
   seven days, then search today/tomorrow plus the bottleneck's next eligible day.
   Keep explicit week-wide task remaining minutes, rhythm virtual logs/quota,
   last-allowed-day capacity and far-day reservations. Don't omit far days or let
   a two-day search silently promise infeasible deferred work. Reuse untouched
   days; widen the horizon only when a known dependency crosses it.
5. **Adaptive candidate resolution, not blanket clock rounding:** try 15-minute
   candidates in wide slack windows; 30 minutes may be useful for distant, broad
   options. Always retain exact fixed clocks, window/block boundaries, boundary
   minus duration, dynamic prayer/habit anchors, travel arrival/departure and
   weather transitions. Every published edge still passes exact minute-level
   duration/windows/travel validation. `off-grid-windows` requires 09:07–09:14,
   09:14–09:25 and a fixed 09:25 appointment: both planners fit all 31 minutes
   today, while a start-only 15/30-minute grid cannot fit the first two items.
6. **Evaluate usefulness and energy together:** choose an explicit frame rebuild
   latency/work budget, measure fit/route probes and CPU time alongside valid
   completed work and priority/cadence deficits. Keep clock-only replay/cache
   reuse and revision guards. Add bounded interruption/reuse tests before
   extending optional search; there should be no new recurring forecast wakeups.

The near-term target is a valid, promptly reusable 50-item week on this device,
not exhaustive optimality. GLPK stays the production/reference engine until the
quality, legality and frame-runtime gates justify replacement.
