# AGENTS.md — engineer onboarding for "Tings" (habits planner)

Static habit/day planner. Vanilla JS (no framework, no build step), served as-is.
Open `index.html` via any static server. All state lives in `localStorage`.

This file is the always-on map. It stays short so a normal edit does not load the planner essay or the assistant.

## What to open

- **Scheduling / planner behavior:** `docs/planner.md`, then the one function you are changing. A behavior change usually means the shared primitive, or the same change in both engines.
- **Product manual:** leave `DOCUMENTATION.md` closed. It is about 3,600 lines and excluded from search. Behavior is in the code. Open it only when the user asks to change the manual, then edit that one heading.
- **Tests:** `TESTING.md` for the runner. Search `js/` first. `tests/` is excluded from the code index; open a test by path when you are writing or fixing one.
- **Local assistant (side feature):** leave it closed. Open `docs/assistant.md` and `js/assistant-*.js` only when the task is the Tings assistant. `js/assistant-tools.js` is about 5,300 lines. Planner, home, settings, and habit edits do not need it, and greps should skip `js/assistant-*.js` unless the task is the assistant.

Grep a function name and read that range. The largest files besides the assistant are `js/today-view-week.js`, `js/weather.js`, `js/agenda-optimizer-ilp.js`, `js/today-view-fits.js`, `js/list-view-home.js`, `js/list-view-sections.js`, and `index.html`.

## Mobile wrapper

`../../Tings` owns the Capacitor Android shell. Its build reads this PWA directory as canonical shared source. Root runtime paths in the wrapper are symlinks, not independent copies. `js/native-reminders.js` compiles mounted agenda rows only when `window.TingsNative.isNative`; native-only controls must stay absent in the PWA. OS delivery is implemented in the wrapper's `native/platform.js`. Do not duplicate planner engines for mobile.

## Quick start

```bash
npx serve -l 4181 -s .          # serve locally (tests expect port 4181)
# then open http://127.0.0.1:4181/

./run-tests.sh                  # smart full matrix (GLPK is the production page)
./run-tests.sh planner          # planner suite; Fast via page-both / --mode fast
./run-tests.sh ui               # general rendering and interaction suite
./run-tests.sh --changed        # infer suites from current git changes
```

One test: `HABITS_URL=http://127.0.0.1:4181/ node tests/<name>.js`

Results land in `test-results/`. Pass `--verbose` to stream every assertion. Suites are listed in `tests/test-suites.tsv`. Exploratory `zz-*` scripts belong to the opt-in `diagnostics` suite.

## Gotchas

1. **Two planner engines stay in sync.** A scheduling change usually lands in both `js/today-view-*.js` (fast) and `js/agenda-optimizer*.js` (GLPK), then passes the suite in both `PLANNER_MODE`s. Details: `docs/planner.md`.
2. **Bump `sw.js` → `const CACHE = 'tings-vNN'` on every JS change.** The service worker caches app JS stale-while-revalidate and only re-fetches when the cache key changes. One bump per JS change. A missed bump makes a correct fix look like it did nothing.
3. **Personal data stays uncommitted.** `lib/*tings-backup*`, `lib/*.backup.json`, and `lib/*.pdf` hold addresses and logs. `test-results/` and `_scratch_*.js` are scratch. Keep repro scripts in `test-results/` or `/tmp`, never in `tests/`.
4. **Order-linked items stay next to their partner.** When touching `tryPlaceOnDay` or GLPK fit injection, guard with `plannerOrderConstraintsForDay(dayBase)`. A `direct` / `adjacency` link must not be relocated by placement steering. Skipping this regresses `schedule-links-test.js`.
5. **Identical input produces the same plan.** A flip means logs or state changed, GLPK had no usable incumbent and fell back to `packDayWithHeuristic`, or home is still showing the fast preview. A time-limited `GLP_FEAS` incumbent is valid when hard rows cover non-negotiable policy.
6. **Cold-open GLPK stays at 4 seconds.** Do not raise `nativeLimitSeconds` on first paint, idle cache refresh, or user edits. Extra budget is only the while-open imminent tick (`tickReplan` when the next row is inside `HOME_AGENDA_IMMINENT_MS`) or background refinement after a usable agenda is on screen. Full rules: `docs/planner.md`.
7. **Home-list card taps go through `js/tap.js` `bindTap`.** Do not add another pointerdown/up/cancel binder on habit, busy-time, or travel cards. `openSheet` arms a backdrop guard so a recovered tap cannot dismiss the sheet it just opened.
8. **Phone text entry must clear the keyboard.** Keep the focused field and its next action visible in the remaining viewport, including Quick Start and nested place/weather editors. Account for visual-viewport shrink/offset and Android WebView resize once each. Recalculate when the keyboard closes, and drop reserved coach space when the tour ends.

## Where code lives

Scripts are globals, loaded in `index.html` order. That order, the worker `importScripts` list, and the CSS fragment order are load-bearing. Update the service-worker precache when a slice moves.

| Area | Files |
|---|---|
| Persistence, normalization, schedules, logs | `js/data-*.js` (`load` in `data-storage.js`, `save` in `data-normalize.js`, key `tings_v2`) |
| Fast planner | `js/today-view-fits.js`, `today-view-reservations.js`, `today-view-week.js`, `today-view-today.js` |
| GLPK planner | `js/agenda-optimizer.js`, `agenda-optimizer-ilp.js`, `agenda-planner-worker.js` |
| Shared planner helpers | `js/agenda-fast-graph.js`, `agenda-order.js`, `scoring.js` |
| Home UI | `js/list-view-home.js`, `list-view-sections.js`, `list-view-planner.js`, `list-view-actions.js` |
| Boot, sheets, timers | `js/main-boot.js`, `main-input.js`, `main-runtime.js` |
| Settings, detail, places | `js/settings-*.js`, `js/detail-view-*.js`, `js/locations.js` |
| Card taps | `js/tap.js` |
| Service worker | `sw.js` — bump `CACHE` on JS edits |
| Local assistant | side feature; see "What to open" |

## Entry points

```
load() / save(data)                 data-storage.js / data-normalize.js
loadSortSettings()                  data-storage.js
buildTodayAgenda / buildTodayTimeline / windowStillDoableToday
                                    today-view-fits.js
buildWeekAgenda                     today-view-today.js
tryPlaceOnDay / fastPathDefersMovable
                                    today-view-reservations.js
buildWeekAgendaAsync / solveDayPackingIlp
                                    agenda-optimizer-ilp.js
ensureGlpk()                        agenda-optimizer.js
```

## Tests

Mirror an existing file. Planner changes: freeze `Date` inside `page.evaluate`, call `buildWeekAgendaAsync` and `buildWeekAgenda` on the same data, and classify the new file in `tests/test-suites.tsv`. Shared fixtures live in `tests/helpers/planner-test-helpers.js`. The pattern and the debug audit are in `docs/planner.md`. Run `./run-tests.sh planner` after planner changes.
