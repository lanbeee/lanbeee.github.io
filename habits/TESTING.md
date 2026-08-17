# Tings test workflow

The test runner uses a small, explicit matrix instead of running every browser
test twice. A normal full run is now:

```bash
./run-tests.sh
```

Most tests run once. Planner parity/regression tests call both
`buildWeekAgenda` and `buildWeekAgendaAsync` in the same browser session. Only
tests tagged `page-both` in `tests/test-suites.tsv` are repeated with
`?planner=fast`, because those tests verify behavior selected by the page URL.

## Focused suites

```bash
./run-tests.sh planner
./run-tests.sh ui
./run-tests.sh data
./run-tests.sh integrations
./run-tests.sh ui data
```

- `planner`: agenda packing, Fast/GLPK parity, breakables, links, capacity,
  deferral, and worker/refinement behavior.
- `ui`: general rendering, sheets, navigation, gestures, and card behavior.
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

`smart` is the default mode. A forced mode is useful for isolating a failure,
but the planner suite in smart mode is the normal parity check. The legacy
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

## Adding planner tests without copying the harness

Reuse `tests/helpers/planner-test-helpers.js` for the common habit fixture,
blocked-time settings, frozen-clock pair runner, GLPK availability check, and
placement summaries. Every new `tests/*.js` file must also be entered in
`tests/test-suites.tsv`; an unclassified top-level test makes the runner fail
fast instead of silently joining every suite.
