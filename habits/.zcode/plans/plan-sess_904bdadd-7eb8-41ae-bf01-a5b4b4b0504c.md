Merge the detail sheet's **calendar** and **insight (stats)** pages into a single pane (non-minimal mode) with a 14-day dot calendar, toned-down stats, and retained log/plan abilities.

## Current state
- Detail sheet pager has 6 pages (`index.html:206-428`): `calendar` (month grid, `#detail-calendar-summary` chips, plan-by row), `insight` (`#detail-about`, `#detail-stats` score ring + 4 stat tiles + pace strip, `#detail-graph` gap history), schedule, effort, identity, actions.
- Tab strip built from `DETAIL_PAGE_NAV` (`js/detail-view-pages.js:1-8`); minimal mode hides `['calendar','insight','effort']` (line 14).
- `renderCalendar(h)` (`js/detail-view-stats.js:289`) renders a **month** grid via `monthFrame(detailMonthOffset)`; nav buttons `#detail-prev/next-month` (`js/main-input.js:19-28`).
- Day taps: `bindCalendarTap($('detail-calendar'),'[data-entry-day]',…)` opens the day-logs sheet scoped to this habit (log/move/remove/plan) — this is the log-previous-days / plan flow we keep.
- Overview already has the exact 14-day strip machinery to reuse: `OVERVIEW_RECENT_*` constants, `dayStripMarkup`/`cellMarkup` (tones `hit/warn/miss/plan/agenda`, `strip-wd`/`strip-num` spans), `recentRangeLabel`, `cachedOverviewWeek`, `overviewAgendaByDay` (`js/overview-view.js:53-357`).

## Changes

**1. `index.html` — merge the two sections into one** (keeps `data-detail-nav="calendar"`, stays first page)
- Structure: `#detail-about` blurb → section-top (kicker `#detail-calendar-kicker` + hint, nav: `#detail-prev-month` / `#detail-calendar-label` / new `#detail-today` / `#detail-next-month`) → `#detail-calendar-summary` chips → `#detail-calendar` (class becomes `month-grid rich-month-grid strip-grid`) → legend (`data-ui-legend="detail"`) → stats block ("stats" section-top label + `#detail-trend`) → `#detail-stats` → `#detail-graph` → existing plan-by row/hint (unchanged).
- Delete the old `insight` section entirely.

**2. `js/overview-view.js` — make strip helpers reusable**
- `cellMarkup(key,date,entries,extraSpans,opts)` + `dayStripMarkup(data,startTs,days,{agendaByDay,entryDay})`: add an `entryDay` option that switches the cell attr from `data-log-day` to `data-entry-day` (default unchanged; overview callers untouched, detail tap binding keeps working, test selectors `dataset.entryDay` keep working).
- Extract the week-reading core of `overviewAgendaByDay` into PURE `weekAgendaByDay(week,data)`; `overviewAgendaByDay(data)` = offset gate + that core (behavior identical).

**3. `js/detail-view-stats.js` — rewrite `renderCalendar(h)` as a 14-day strip**
- New helper `detailStripWindow()`: start = today − 7d + `detailStripOffset`·14d, 14 days (reuses `OVERVIEW_RECENT_*`).
- `dayStripMarkup([h], start, 14, {agendaByDay, entryDay:true})` where `agendaByDay` = `weekAgendaByDay(cachedOverviewWeek(load()), load())` filtered to `h.name` → blue **agenda** dots appear for this habit's placements whenever a cached week exists (same source/rule as the overview; shifted windows naturally get no agenda dots).
- Label via `recentRangeLabel`; kicker "past 7 · next 6" at offset 0; summary chips recomputed for the 14-day window (days / entries / planned, agenda excluded from the "planned" count).

**4. `js/config.js` / `js/detail-view-sheet.js` / `js/main-input.js` — state + nav**
- Replace `detailMonthOffset` with `detailStripOffset` (reset to 0 on habit change in `openDetail`).
- Prev/next handlers shift ±14 days and re-render; new `#detail-today` resets to 0. Button aria-labels → "previous/next 2 weeks".

**5. `js/detail-view-pages.js` — tabs**
- Remove `insight` from `DETAIL_PAGE_NAV` (tabs become calendar/schedule/effort/identity/actions; calendar icon → `ti-calendar-week`). `MINIMAL_HIDDEN_DETAIL_PAGES` → `['calendar','effort']` (merged pane still hidden in minimal mode, as today).

**6. Tone down the stats — CSS only** (`css/stats-calendar.css`, scoped under the merged page)
- `renderStats`/`renderGraph` markup unchanged; add compact overrides: smaller score ring (~44px), tighter `.stat` padding/fonts, reduced `.stats-row` gap/margin. Score card, stat tiles, pace strip, gap-history graph, and about blurb are all retained.

**7. `js/ui-kit.js` — detail legend** gains `['agenda','on agenda']`.

**8. `sw.js`** — bump `CACHE` `tings-v180` → `tings-v181` (gotcha #2).

## Tests
- Update `tests/detail-auto-chunk-test.js:50` expected tab list (drop `insight`).
- Update `tests/plan-by-date-test.js:542-553` month-walk → walk 14-day strip windows (click `#detail-next-month` until the window covers the plan-by date).
- New `tests/detail-calendar-strip-test.js` (mirror existing patterns; disable minimal via `saveSortSettings({...loadSortSettings(), minimalMode:false})`): merged pane exists with stats+graph inside, 14 strip cells, dot tones (log → hit, plan log/marker → plan; agenda dot verified deterministically via `storeOverviewWeekSnapshot(buildWeekAgenda(...))`), prev/next/today window shifts, day tap opens the scoped day-logs sheet at the item step. Classify as `ui	once` in `tests/test-suites.tsv`.

## Docs
- `DOCUMENTATION.md`: detail sheet "6 tabs" → 5 tabs; update detail calendar/insight page descriptions (14-day strip, agenda dots, merged stats).

## Verification
- `npx serve -l 4181 -s .` then `./run-tests.sh ui`, plus the touched suites (`planner`, `integrations` for calendar tests) — detail-auto-chunk (planner), plan-by-date, calendar-overview, timed-day-plan must pass.

## Notes / decisions
- Month and all-time browsing is dropped from the detail pane (per your answer); the overview calendar keeps its full range options.
- Agenda dots depend on a cached week (home week or snapshot) — identical to the overview's behavior today.
- The insight page's about blurb, trend chip, stats and gap-history graph are all kept, just compacted; nothing informational is removed.