# Tings test workflow

The test runner uses a small, explicit matrix instead of running every browser
test twice. A normal full run is now:

```bash
./run-tests.sh
```

Most tests run once on the production default page (GLPK on). Fast graph is
fallback, preview, and a quality-parity target — not the user-facing default
until it can match GLPK on constraints and preferences. Tag a test `page-both`
when the live page mode itself matters, or `default-only` when Fast must not
run it. Use `--mode fast` to isolate Fast. Dual-engine helpers (`runPlannerPair`,
`useGlpk` loops) still call `buildWeekAgenda` and `buildWeekAgendaAsync` in one
session when the page is not Fast-only.

## Focused suites

```bash
./run-tests.sh planner
./run-tests.sh ui
./run-tests.sh assistant
./run-tests.sh data
./run-tests.sh integrations
./run-tests.sh ui data
```

- `planner`: production GLPK packing, plus Fast via `page-both` and `--mode fast`.
  Breakables, links, capacity, deferral, worker/refinement.
- `ui`: general rendering, sheets, navigation, gestures, and card behavior.
  Does not include the assistant.
- `assistant`: the assistant panel only — entry points, harness/tool turns,
  batch/apply flows, item settings, LLM settings, the prompt corpus, queries,
  and compound questions. Part of the default full run, but kept out of `ui`
  because its live-Qwen checks are slower and environment-dependent (below).
- `data`: persistence, backups, normalization, retention, and blocked-time data.
- `integrations`: calendars, locations/maps, prayer times, and offline behavior.
- `diagnostics`: exploratory `zz-*` probes. This suite is deliberately excluded
  from the default regression run because most probes print observations rather
  than assert product behavior.

Use `./run-tests.sh everything` only when you explicitly want regression tests
and diagnostics together.

## Changed-file selection

```bash
./run-tests.sh --changed
TEST_BASE=origin/main ./run-tests.sh --changed
```

The default compares tracked and untracked working-tree changes with `HEAD`.
`TEST_BASE` can point at another comparison base. This is a convenience for
local iteration, not a substitute for the full matrix before a risky release.

## Modes and individual tests

```bash
./run-tests.sh planner --mode fast
./run-tests.sh planner --mode default
./run-tests.sh planner --test '*deferral*'
./run-tests.sh --list
```

`smart` is the default mode and opens the production GLPK page. Use
`--mode fast` for a Fast-only run that skips `default-only` files, or
`--mode default` to force GLPK even for `page-both` files. The legacy
`PLANNER_MODE=fast ./run-tests.sh` form still works as a forced-fast run.

## Output

Normal output is one progress line per test execution plus a short summary.
Complete assertion output is written to:

- `test-results/last-run.log`
- `test-results/run-<timestamp>-<pid>.log`
- `test-results/failed/<test>.<mode>.log` for each failure
- `test-results/.last-run.json` for tooling

Use `--verbose` to stream full output. Failure output is limited to the last 20
lines by default; set `FAIL_TAIL_LINES=0` to print no excerpt or another value to
change the bound.

Live Qwen checks (Ollama / LM Studio on this machine) are optional inside the
assistant suites: they skip when no `qwen3.8` tag is reachable. Set
`ASSISTANT_LIVE=1` to fail instead of skip, or `ASSISTANT_LIVE=full` for the
longer draft_item settings battery. Compound / follow-up / multi-part questions
are `tests/assistant-compound-test.js` against the real model — not a scripted
`complete()` mock. `tests/assistant-queries-test.js` also injects deliberately
false model prose after correct tool calls and verifies that single and compound
answers retain only authoritative tool output.
`tests/assistant-harness-test.js` also covers dependent research-then-create
turns: creation tools remain callable after schedule reads, `prepare_action`
research cannot be closed by prose, one transient continuation failure retries,
and an exhausted continuation is reported as partial instead of successful.

`tests/assistant-needle-test.js` covers first-use download consent, progress,
failure/retry, verified caching, cancellation/removal, provider compatibility,
and model-cache survival across service-worker updates without large CI downloads.
To also test the real pinned Needle runtime, task/habit creation, edits and an
offline reload, set `NEEDLE_MODEL_PATH` to `needle3.cact` and `NEEDLE_WASM_PATH`
to `needle.wasm` from the revision in `lib/needle/README.md`. The test serves
these local files through the normal download flow and verifies their hashes.
`tests/assistant-focus-test.js` uses the same two variables for live focused edits
and two complete add-screen runs of “Walk every other day before sunset”. It
checks all three worker lanes, overlapping native inference, interpretation
approval, confirmed saves, and recovery after terminating a real in-flight
worker. Scripted cases cover schema subdivision, retained partial results,
continuation, independent create jobs, stale replies, and follow-up grounding.
The transport tests also cover the three-worker bound, isolated crashes,
cancellation of active/queued jobs, and allocation fallback. Neither file is a
held-out accuracy score. Live traces are written to
`test-results/needle-focus-sunset-add-live.json` and
`test-results/needle-focus-worker-recovery-live.json`.

## Adding planner tests without copying the harness

Reuse `tests/helpers/planner-test-helpers.js` for the common habit fixture,
blocked-time settings, frozen-clock pair runner, GLPK availability check, and
placement summaries. Every new `tests/*.js` file must also be entered in
`tests/test-suites.tsv`; an unclassified top-level test makes the runner fail
fast instead of silently joining every suite.

## Fast replacement quality and device audit

`node tests/planner-quality-gap-test.js` compares both canonical engines on 18
synthetic scenarios, including 20/35/50-item mixed weeks, weather, travel, dynamic
windows, cadence, plans and active work. It is opt-in (`diagnostics`).
`--require-parity` additionally exposes valid
GLPK quality advantages; improved Fast schedules are allowed. Reports include
legality, work by priority, travel/weather, solve provenance and first/warm timing.

Use `QUALITY_CASE=off-grid,cadence node tests/planner-quality-gap-test.js --device
--no-repeat` with the existing debug Android app for isolated physical-device
checks. The adapter does not alter personal storage or the system clock. See
[FAST_PLANNER_READINESS.md](FAST_PLANNER_READINESS.md) for commands, source checks,
feature coverage and the photo-frame performance baseline. Current implementation
results are in [FAST_PLANNER_PROGRESS.md](FAST_PLANNER_PROGRESS.md).

`--require-target` adds a gate for **aggregate** first/repeat rebuild speed of
at least 5× GLPK, and at least 95% of GLPK's placed minutes at every cumulative
priority tier in each case. All selected results must be independently legal,
and every GLPK reference must actually be optimized (`optimal` or `feasible`).
Fallbacks cannot establish the target. Worker boot is separate; the first GLPK
request includes lazy WASM loading after Fast has warmed the worker. These are
corpus-specific placement metrics, not a proof of optimality or a battery test.
The regular `fast-planner-specialization-test.js` covers task allocation,
transactional replay, cache isolation/revisions, route lookup counts, bounded
selection recovery and deterministic legal 35/50-item weeks.

`fast-linked-recovery-test.js` covers atomic due-day pair movement, subsequent
cadence preservation, frozen neighbors, closed-window/no-space rollback and
explicit future plans. Run `schedule-links-test.js` on both the regular page
and `?planner=fast`: its travel-adjusted required chain and due optional
successor cases must pass in Fast as well as GLPK.

`fast-evening-packing-test.js` checks nine current-day items across sparse
cadence, hard weather, closing venue hours, flexible critical rows and return
travel against a real GLPK incumbent. It also rejects a clustering replay that
keeps the week count by postponing today's due occurrence. Week totals alone
cannot establish useful placement on a particular day.

`tests/assistant-needle-workflow-test.js` verifies lossless model-proposed boundaries,
eight-part draft accumulation, pause/resume around clarification, mixed draft and
action confirmations, schema validity, and calendar/pairing/native capability
navigation. These orchestration checks use scripted model output; they do not
measure the base model's accuracy. The optional real-runtime checks in
`assistant-needle-test.js` must stay separate from that claim.

The versioned single-action model corpus is
`tests/fixtures/assistant-needle-basics-corpus.json`. Its real-model results and
remaining browser failures are recorded in `docs/assistant-needle-basics.md`.
The Needle suite also checks field-repair grounding and explicit action-retry
scope with scripted responses; those passes do not measure free-form accuracy.

`assistant-focus-regressions-test.js` covers focused concurrent saves, field-level
undo, event occurrences and creation, topic/profile dependencies, same-family
omissions, follow-ups, clarification choices, review approval, reminders, and
normalization for every registered field. To run its inference scenarios against
real pinned Needle 3 assets (native permission responses alone are stubbed):

```bash
NEEDLE_MODEL_PATH=/absolute/path/needle3.cact NEEDLE_WASM_PATH=/absolute/path/needle.wasm node tests/assistant-focus-regressions-test.js
```

Full extracted arguments and model traces are saved to
`test-results/needle-focus-regressions-live.json`. These use synthetic items.

## Semantic field extraction

`tests/assistant-field-jobs-test.js` tests the production create/edit scheduler
with deterministic model/rank adapters for failures and trust boundaries. It
checks the three-job cap, one-tool schemas, separate duration/chunk/gap values,
preferences, negation, omitted/shortened evidence, corrections, continuation,
control dependencies, and bounded contexts with trailing instructions retained.
The older focused tests explicitly select the family adapter for their existing
scripted fixtures; their optional live sections use the production field path.

Run the new complex request battery against actual pinned Needle WASM:

```bash
NEEDLE_MODEL_PATH=test-results/needle-live/needle3.cact \
NEEDLE_WASM_PATH=test-results/needle-live/needle.wasm \
node tests/assistant-field-jobs-test.js
```

Expected results are defined before inference. Successful cases must match every
expected value, retain unrelated state, and pass confirmed persistence. Asset
interception uses unmodified pinned files; inference is never replaced in live
mode. Evidence is written to `test-results/needle-field-jobs-live.json`, including
prompts, previews, source spans, job attempts, native traces and timing. Details
and remaining evaluation gaps are in `docs/assistant-field-extraction.md`.

`assistant-field-coverage-test.js` declares a representative language case for
every registered editable field (including occurrence fields through their
scoped aliases). It checks the intended proposals, absence of sibling edits,
preserved history, no writes before confirmation, and normalized persistence.
It also covers incomplete/invalid dates, conflicting quantities and references
to earlier messages. Run it with the same pinned asset variables to use actual
Needle inference; without them, its adapters test host behavior only. Results
are `test-results/needle-field-coverage-live.json` and
`test-results/needle-field-coverage-scripted.json`. `FIELD_CASE` selects case ids
for diagnosis; omit it for the complete catalog run. Native reminder tests stub
OS permissions and reconciliation only, never model responses or extraction.

The field audit also includes numeric-language variants (`FIELD_CASE=language`):
ordinal/count recurrence, week periods, spoken month dates, fractional lengths,
unit conversion, correction and historical references. Its guards reject
unsupported recurrence, conflicting quantities, negative lengths, invalid
month days, unsupported units and lengths outside app limits. Use `FIELD_REPORT`
to keep a separate JSON report for a selected live run. The complex field-job
battery includes creation with ordinal and counted-week recurrence.
Mixed-fraction cases cover session lengths, task edits, event occurrences,
chunks, gaps, timer targets and automatic completion. They verify both “one and
a half hour” and “an hour and a quarter,” numeric fractions, mixed units and
fraction symbols. Conflicting, negative and out-of-range lengths must ask
without changing the staged value. `FIELD_CASE='language-.*(fraction|quarter)|guard-durationMinutes'`
selects these cases; omit the filter for all 160 positive cases and 33 guards.
`FIELD_CASE=basics` selects everyday phrasing, correction, literal-name and clear
operations. These check complete patches and confirmed persistence, including
absence of sibling edits. Ambiguous references use Needle's bounded field menu;
a declined model decision must not be replaced by parser inference.

`tests/assistant-monthly-create-test.js` covers the reported Family night
dictation and variants with monthly weekday rules, solar/prayer offsets and
independent session lengths. The ambiguous dictation must retain its known
fields, ask only about the conflicting window, and save correctly after a
window correction. Every case checks the complete change allowlist, storage
before confirmation and confirmed persistence. The same pinned asset variables
switch this test from a deterministic host adapter to real Needle inference;
evidence is `test-results/needle-monthly-create-{live,scripted}.json`.

Run every optional Needle section with the actual pinned assets:

```bash
ASSISTANT_LIVE=0 \
NEEDLE_MODEL_PATH=test-results/needle-live/needle3.cact \
NEEDLE_WASM_PATH=test-results/needle-live/needle.wasm \
./run-tests.sh assistant
```

`ASSISTANT_LIVE=0` skips the separate optional Qwen checks, not Needle. The live
recovery test terminates whichever worker lane receives the target extraction,
including worker zero; it never substitutes an inference result.
