# Fast planner implementation and measured limits

October 3, 2026, local working tree based on `45509d6`. GLPK remains the
production default. This is the first implemented specialization pass, not a
claim that the replacement target has been met on the frame.

## Implemented

- Fixed split-task overfill: `target:null` no longer turns a one-shot task into a
  daily breakable reservation. Day replay caps tasks at their allocated minutes;
  fragment transfers retain their size and hypothetical rebuilds have their own
  agenda-item arrays. Multi-victim contiguity repair excludes split pools that
  require a dedicated fragment-transfer operation.
- Added bounded selection repair for independent daily occurrences. It can choose
  different subsets, resolving all six recorded legal selection gaps. It preserves
  critical, planned, active, fixed, linked and split work and only adopts strictly
  more work without losing any cumulative priority tier or worsening route/weather.
  It uses at most eight incumbent candidates plus four missing candidates, an
  eight-state beam and 384 probes per day. Insertion and selection share the
  existing 768-probe build budget; crowded optional-daily cases reserve room for
  selection instead of spending everything on impossible keep-all permutations.
- Memoized snapshot facts across both engines: resolved day windows, blocked
  intervals, venue hours, registry IDs, normalized schedule options, weather
  guidance and interval assessments. Returned records are independent; every
  solve starts fresh. Weather assessment storage is capped at 1,024 entries and
  distinguishes commitment overrides. Fast now disposes its caches in `finally`.
- Reused route transitions and tie-break keys. The first desktop profile found
  about 670 ms of exclusive route-order work and 155,000 travel calls in the
  35-item case. Transition/key reuse reduced that route work to about 28 ms and
  travel calls to about 39,000 before the later improvements. Instrumentation
  itself adds overhead; these are hotspot evidence, not final rebuild timings.
- Added a mandatory-venue spanning-tree route-cost lower bound. Route replay is
  skipped when no cheaper route is possible. Optional venues are excluded from
  the bound. Co-location replay is skipped when hints cannot attract a candidate
  to another day.
- Reused explicit-timezone weather formatters with a 16-zone cap, sorted weather
  percentile data once per forecast context and used binary percentile lookup.
  Unspecified timezone formatting remains fresh to follow system timezone changes.
- Kept exact clocks, dynamic anchors, weather and travel validation, the full week,
  existing clock replay and notification/alarm behavior. No new recurring timer,
  background wakeup or larger GLPK time budget was added. Cache version is v503.

Blanket 15/30-minute rounding, a new rolling two-day orchestrator, and cross-edit
memo reuse for arbitrary revisions are not implemented. The current profile
justified removing repeated work first. Any later horizon restriction must retain
week-wide task pools, rhythm obligations and last-eligible-day feasibility.

## Desktop target gate

```sh
node tests/planner-quality-gap-test.js --require-target
```

Final run: all 16 cases legal; every GLPK reference was genuinely optimized
(`optimal` or a valid `feasible` incumbent). Fast was deterministic on repeat.

| Measurement | Result |
| --- | ---: |
| Aggregate first-rebuild speedup | 8.88× |
| Aggregate repeat-rebuild speedup | 13.07× |
| Worst case cumulative-priority placement ratio | 99.19% |
| Aggregate placed work ratio | 100% |
| Complex 35-item Fast / GLPK first rebuild | 0.211 / 2.023 s |
| Complex 50-item Fast / GLPK first rebuild | 0.357 / 5.475 s |

The ratio measures minutes at every cumulative P0–P5 tier in each scenario,
with hard legality and fixture-specific obligations checked separately. It is
not an all-purpose usefulness score: travel, weather and link gaps are also
recorded, and `--require-parity` demands their strict equality-or-improvement.
For example, mixed-20 uses 45 versus GLPK's 40 travel minutes, while retaining
all work and tighter direct-link gaps. That tradeoff is visible rather than
hidden behind the placement percentage.

These are aggregate corpus targets, not a claim of 5× speed on every small case
or of matching 95% of a proven global optimum. The first GLPK request includes
lazy solver loading after Fast has warmed the worker; worker boot is separate.
GLPK's status proves its fixed pack, not the complete final week. Its 50-item
incumbent varies with the bounded solve, so 100% of that reference is not proof
that every possible useful minute was placed.

The original six gaps now produce Fast/GLPK minutes of 165/165, 270/270,
270/255, 165/165, 270/270 and 575/575. See
[FAST_PLANNER_READINESS.md](FAST_PLANNER_READINESS.md) for the baseline and full
feature coverage.

## Physical frame

B-077K, Android 11, WebView 83, roughly 961 MiB RAM. Final debug APK installed
without clearing user data. Ten packaged planner files matched canonical source.
All 16 Fast cases passed independent legality/oracles and identical-repeat checks
using isolated workers against the installed assets. Personal agenda storage and
the system clock were not seeded or changed by the audit.

| Scenario | Baseline Fast first / repeat | Final Fast first / repeat |
| --- | ---: | ---: |
| 50-item selection week | 4.68 / 3.83 s | 2.80 / 2.05 s |
| Complex 20 items | 33.07 / 31.88 s | 6.26 / 5.53 s |
| Complex 35 items | 69.94 / 67.22 s, illegal | 14.57 / 11.68 s, legal |
| Complex 50 items | exceeded 75 s | 25.27 / 19.35 s, legal |

**The frame replacement target remains unmet.** Complex 50-item rebuilding is
still too slow. A paired intermediate frame run reported GLPK `fallback` on all
three complex weeks, so it cannot establish the optimized quality/speed target.
The final Fast-only run establishes legality, deterministic behavior and device
runtime, not a 5× GLPK ratio. No energy or all-day battery claim is made.

A bounded profile on the frame's 20-item fixture attributes most remaining time
to shared placement and committed-route evaluation (1,667 fit calls and 561
route reconciliations), rather than the new selection search. The next major
step is compiling reusable fitting facts and repairing a focused portion of the
week without replaying every assignment, with exact final validation. Merely
raising beam sizes, solving longer or rounding away narrow windows is not the
next step.

Shareable APK: `Tings-test-2026-10-03-fast-planner.apk` in the existing
`Downloads/Tings-test` output directory. GLPK remains selected by default; this
build improves the shared fitter and Fast preview/fallback/optimizer-off path.

## Verification and remaining baseline failures

- `--require-target`: passed, all 16 cases and valid GLPK references.
- `fast-planner-specialization-test.js`: passed; task allocation, transactional
  replay, cache isolation/edits, route lookup bound, selection recovery, bounded
  work and deterministic legal 35/50-item weeks.
- Default planner matrix: 47/49 tests passed, zero page errors.
- Fast planner matrix: 41/44 tests passed, zero page errors.
- Both matrices fail the pre-existing detail-tab label and hidden option-button
  UI assertions. Fast additionally fails five pre-existing linked-chain
  assertions in `schedule-links-test.js`. Each failure reproduced against HEAD
  runtime assets, served from memory without editing either checkout.
- Shared native reminder tests and packaged background runner passed, including
  travel departure cancellation, clock reuse, stale-location rejection and
  native-only controls.
- Android packaging checks, 49 native unit tests, lint and debug APK build passed.
- Syntax checks and `git diff --check` passed.

The baseline Fast linked-chain failures remain a replacement blocker. The
notification delivery policy, per-item choices, continuous alarms and planner
production limits were not changed. Everything remains local and uncommitted.

## Final Pixel sanity check and trial installation

The same APK was rebuilt and installed on the Pixel 7 Pro with a data-preserving
update on October 3. Its SHA-256 matches the shareable APK listed above. All ten
packaged planner source files match the canonical working tree.

- Fresh desktop target gate: 16/16 legal optimized comparisons, 8.76× aggregate
  first-rebuild speedup, 12.55× repeat, 99.19% worst priority-prefix placement.
- Specialization, native reminder and real forecast-worker checks passed again.
- Packaging, Android lint/build and all 49 native unit tests passed again.
- All 16 isolated Fast scenarios passed legality and determinism on the Pixel.
- Five Pixel instrumentation tests passed: foreground/closed forecast safety,
  headless planner/travel projection, actual agenda-channel delivery and looping
  warning-alarm playback. Synthetic delivery events are cleaned up.
- A private isolated audit of the saved 47-item week found no shared-fitter
  violations and identical repeat rows. Full-week rebuilds took 20.46 and
  16.53 seconds; this is a significant remaining real-device latency limit.
  It does not establish a Pixel GLPK speedup or battery consumption.
- Item storage and per-item reminder preferences matched their pre-update
  snapshot. Fast was explicitly selected only on this Pixel (`agendaOptimizer`
  false), then checked after restarting: seven mounted days, bounded-state-graph
  provenance, no pending foreground planner request, notification and exact-alarm
  permissions granted. Production defaults remain unchanged.
- The linked-chain test still has the same five known Fast assertion failures
  (90 passing assertions). These remain unresolved trial limitations.

Private snapshots and aggregate device reports remain in ignored `test-results/`;
no personal rows are included in this document.

## Coupled linked recovery — October 3

The 4:28 PM audit exposed an overdue sparse occurrence left tomorrow despite
usable gaps today. The old strict-due recovery skipped required linked pairs;
a subsequent link cleanup could then omit the partner. Fast now tries the
small coupled group atomically, including one ordinary occurrence per item.
It also repairs the earlier travel-boundary and optional-successor failures.

At most 96 probes are reserved from the existing 768-probe build budget, not
added to it. The repair reopens at most four connected linked occurrences and,
only when necessary, two flexible unlinked neighbors. A two-state beam uses
normal scored fits and exact gap boundaries with hard weather checks. Fixed,
planned, active, weather-locked, split and separate-option occurrences remain
protected. Unrelated clocks stay fixed unless a selected neighbor is explicitly
reopened, and all selected work in that neighborhood is retained. Failed trials
leave both dates intact. Sparse movement preserves subsequent cadence rows and
rejects theft of a subject required by another later partner. Production GLPK
limits, notification delivery and recurring timers are unchanged.

Verification:
- `schedule-links-test.js`: Fast 95/95 and GLPK page 111/111; all five previously
  reported Fast linked-chain assertion failures are resolved.
- New atomic-recovery tests pass: due pair, later cadence, frozen neighbor,
  no-space/closed-window rollback and explicit future plans.
- Full planner matrices: regular 48/50 and Fast 43/45, with 1,786 and 1,399
  passing assertions, zero failing planner assertions and zero page errors.
  Both retain only the pre-existing detail-tab label and hidden schedule-option
  button UI test failures.
- Fresh 16-case target gate: 8.53× aggregate cold/rebuild and 12.26× repeat
  speedup, 99.19% worst cumulative priority-tier placement, same total work.
- Same private saved-data snapshot at the audit clock, isolated desktop worker:
  before 677/698 ms, after 613/520 ms; 391 → 340 total probes; work 3,051 →
  3,056 minutes, travel unchanged, deterministic repeats, no shared-fitter
  violations. Exercise and its direct partner now appear together today.
  These paired desktop measurements are not phone or battery measurements.
- Specialization, native reminder and forecast-worker tests pass. Packaging,
  Android lint/debug build and 49 native unit tests pass. Shared cache is v504.

Updated APK: `/Users/nabeelkhan/Downloads/Tings-test/Tings-test-2026-10-03-linked-recovery.apk`.

The Pixel reconnected and the rebuilt APK was installed with `adb install -r`.
Both isolated linked-chain regressions pass on the installed canonical worker:
travel-adjusted chain 94/27 ms, due optional successor 104/29 ms; deterministic
repeats, no shared-fitter violations, 41 and 17 probes. All ten packaged source
hashes match. The mounted app reports Fast provenance, 47 saved items and existing
reminder preferences. Installation interrupted the attempted pre-update private
snapshot, so this update has no byte-for-byte before/after storage comparison.
No app storage was cleared or synthetic fixtures written into personal storage.
APK SHA-256: `731716a44ae2be6bc061599373dbf5ad5135235ca02c2f53387e95eb42d707ff`.

## Evening packing and replay retention — October 3

The 18:28 audit exposed a gap that weekly placement percentages did not capture.
The previous Fast plan selected seven current-day items; the valid GLPK
incumbent selected nine. Reproduced with a fresh private 47-item Pixel snapshot,
with later logs excluded and an isolated worker frozen at the audit clock.

The bounded day beam now retains both paths that contain the incoming item and
paths still making room for it. Unplanned neighborhoods first try three
chronological insertion positions, counted within the existing 192 probes.
Planned neighborhoods keep the full scored search; an initial broader shortcut
regressed the planned long-visit test and was restricted before shipping.
Clustering replays preserve every selected occurrence/minute, daily and pinned
dates, and the first claimed date of a strict due occurrence. A replay that
postpones today's due work is rejected even when its weekly count is identical.
The shared 768-probe seed budget, linked recovery and GLPK limits are unchanged.

The private reproduction now selects nine current-day items and 255 minutes
versus seven and 165 before. Its selection differs from GLPK: a higher-priority
60-minute task occupies space GLPK used for a 30-minute errand with travel.
The errand remains assigned later. This does not establish identical missed
lists or universal GLPK parity. Weekly work, every priority total and travel
remain unchanged; both repeats are deterministic and have no shared-fitter
violations. Paired desktop first/repeat times were 487/474 ms before and
526/434 ms after, with 387 probes in both. These measurements ran alongside
the test matrices and are not battery or phone measurements.

Verification:
- New anonymous evening regression: both engines fit all nine items, including
  sparse outdoor work before hard weather closes its window and a closing venue
  with outbound/return travel. Before code fits eight; after uses 19 instead of
  233 probes. Replay checks reject postponed due work and dropped selections.
- Expanded 17-case target gate passes: 7.48× aggregate first rebuild, 10.67×
  repeat, 99.19% worst priority-prefix placement and unchanged total work.
- Planner matrices: regular 49/51 and Fast 44/46; all scheduling tests pass.
  Only the two known detail-tab/hidden-option UI tests fail. Linked tests retain
  95 Fast and 111 default passing assertions. Native reminder tests pass.
- Packaging, private-file exclusions, syntax, diff checks and Android debug
  build pass. Cache version is v505; no Java notification code changed.
- Installed Pixel regression: nine current-day items in both engines, hard
  weather/venue cutoffs retained, deterministic Fast, 19 probes. Fast 929/626 ms;
  GLPK valid feasible incumbents 4201/2302 ms. This is one device scenario, not
  a 5× device-wide performance claim. All ten runtime source hashes match.
- Data-preserving Pixel installation verified byte-identical saved-item and
  reminder-preference storage. All 47 items remain, and the user's current GLPK
  selection remains selected. No synthetic fixtures entered personal storage.

APK: `/Users/nabeelkhan/Downloads/Tings-test/Tings-test-2026-10-03-evening-packing.apk`.
SHA-256: `a8786dff39e9f52dffdab29ffd6a95cd2d70a096b352b3c31d5c091fa0ceca56`.
Changes remain local and uncommitted; no new timers or background wakeups.

## Packed current day recovery — October 3, 7:07 PM audit

The new audit reproduced exactly from a fresh read-only Pixel snapshot: Fast
placed eight current-day fills (195 minutes), while a genuine GLPK feasible
incumbent placed nine (225 minutes), including the optional errand and both
six-minute travel legs. A static-gap audit did not expose this rearrangement.

The seven-row keep-all neighborhood now freezes narrow critical anchors before
flexible late rows, and tries short higher-priority anchor variants of the
chronological orders. All edges remain inside the existing 192-probe insertion
limit. After daily selection repair, at most 96 unused probes from the existing
768-probe budget can move an ordinary first occurrence from a later date to
today. No complete week rebuild is added. The move preserves week work, later
cadence, source clocks, protected plans/links/active/weather locks, and cannot
increase total route cost or weather penalty. Existing absent linked subjects
are compared against the incumbent; they cannot be used to introduce a new
violation, but do not prevent an unrelated legal improvement.

The paired private reproduction changes eight fills to nine, retaining the
same 3,021 weekly minutes, priority totals and 22.9 travel minutes. Probes change
387 → 415. Under concurrent test load, desktop cold builds were 500 → 508 ms
and warm builds 422 → 453 ms; this is a modest extra cost rather than a claim
of a faster personal-data rebuild. Both results are deterministic and pass the
shared legality audit. The earlier 6:28 case and planned last-day pair remain
covered by regression tests.

The expanded 18-case benchmark passes `--require-target`: aggregate desktop
cold speedup 8.16×, warm 12.26×; weakest cumulative-priority placement ratio
99.19%, total work ratio 100%. These figures do not promise individual-case
5× speed or universal day-selection parity. A negative control rejects moving
a cheaper one-way future errand into a current-day round trip. Cache is v506;
GLPK selection/objective and its four-second cold-open budget are unchanged.

Final matrices: Fast 44/46, regular 49/51, with 1,399/1,786 passing counted
assertions and no page errors. Both failures are the existing detail-editor UI
tests (`detail-auto-chunk-test.js`, `habit-schedule-options-test.js`). Shared
native reminder checks, packaging checks, Android debug assembly and diff/syntax
checks pass. No native Java changes were made; native unit/lint/instrumentation
were not rerun for this JS-only change.

Installed with `adb install -r` on the Pixel, preserving 47 items, reminder
choices and the user's current optimizer-off selection. APK:
`/Users/nabeelkhan/Downloads/Tings-test/Tings-test-2026-10-03-current-day-recovery.apk`.
SHA-256: `c65b609ad72b85e7d1c9597f79d3e441170123b499ddd0c30045d67fb6791e25`.

Installed Fast verification completed on the Pixel for both the anonymous
optional-errand fixture and the frozen 7:07 PM personal snapshot: nine fills in
both repeats, deterministic rows, no shared legality violations, return travel
present, and 21/415 probes respectively. All ten checked runtime hashes match
canonical source. Saved item and reminder keys were byte-identical and Fast
remained selected. An initial paired phone run hit Doze/keyguard interruption;
its GLPK synthetic incumbent placed seven, so it is not counted as a passing
phone parity or speed comparison. The completed Fast-only saved-data elapsed
measurements were 15.5/14.2 seconds (synthetic 1.4/0.8 seconds); lock-screen
interruptions prevent treating these as clean compute timings. The 8.16× claim
is explicitly the desktop corpus, not this personal-data phone rebuild. No
system clock or persistent app data was changed. Temporary stay-awake testing
was restored to the original setting (0); temporary ADB forwards were removed.
