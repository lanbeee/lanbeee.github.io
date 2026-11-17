# GLM 5.3 Flash handoff — one habit with alternate times and places

## Assignment

Add automated tests to Tings that prove a user can configure **one recurring activity** with multiple ways to complete it. The main examples are Dhuhr at home during a flexible window or in congregation at the masjid at an exact time, and self-study at home during a flexible window or an in-person tutoring session at an exact time. Use synthetic prayer clocks and places. The same scheduling rules apply to any habit with this shape.

The product expectation is that **an explicitly strongly preferred, nearby in-person option wins on a light day when the full trip fits**. A conflict, venue hours, travel overhead, or competing work can make home the better choice. Keep a full-duration occurrence in the valid home window in those cases. Preserve existing appointments and compatible due work. A day can still favor the in-person option when the user is already there.

This is a test-writing task. Preserve the expected behavior in the assertions when the baseline disagrees. Report the observed discrepancy with a minimal reproduction. Keep planner changes for a separate pass so the tests establish the original behavior first.

## Existing implementation and tests

Work from the `habits/` directory. Read `AGENTS.md`, `docs/planner.md`, and the runner sections of `TESTING.md`.

- `tests/habit-schedule-options-test.js` has the closest fixture, dual-engine, and detail-editor patterns. It already covers same-venue time alternatives, closed venue, weekday eligibility, dynamic anchors, normalization, overlapping rows, and the base general-window-plus-specific-option behavior.
- `tests/meeting-travel-conflict-test.js` has the manual travel cache, fixed meeting fixture, optimizer provenance, and timeline and Home travel assertions.
- `tests/helpers/planner-test-helpers.js` provides `baseHabit`, `plannerSettings`, `chromium`, `BASE`, `FAST_ONLY`, and `glpkAvailable`. `runPlannerPair` is useful for minutes, but its optional timeline summary omits option identity and solve provenance. Use a local row-aware wrapper modeled on the two tests above.
- `js/data-locations.js` defines `normalizeHabitScheduleOptions`, `hasGeneralAllowedSchedule`, `habitSchedulePlacementVariants`, and `habitBoundToScheduleOption`. Check `js/detail-view-links.js` for the editor controls. For planner diagnosis, start with `tryPlaceOnDay` in `js/today-view-reservations.js`, `pickBestScoredFit` in `js/today-view-fits.js`, and `listPlaceFitsOnDay` and `solveDayPackingIlp` in `js/agenda-optimizer-ilp.js`. Read only the relevant ranges.

One habit with a general home schedule and an explicit away row is the primary fixture. The main item's `locationIds: ['home']` and `anywhereAllowed: false` keep the general allowed window at Home. An explicit row binds its own place to its own time constraints. The published identifier for the general variant is `general`. A row with `fixedStart: true` begins at its exact start minute and runs for the habit's duration. A row with `start` and `end` and no fixed-start flag may slide until its latest legal finish. Use `sameDayMode: 'alternative'` for multiple ways of doing the same session. A `separate` row represents an extra session and belongs to the existing separate-session coverage.

Row preferences are `high` (strong), `little` (soft), `avoid`, and an omitted preference (inherit the place ranking). The UI's neutral label means inherit. Preference ranks feasible alternatives and can lose to travel and the rest of the agenda. Hard gates include time, place, opening hours, busy intervals, and enough time for travel. Use valid, distinct option IDs of 6–64 characters, composed of letters, digits, underscores, or hyphens. Set a one-per-day, non-breakable cadence. Use fixed **task** rows only for independent competing commitments.

## Deterministic fixture

Run Playwright in `America/New_York`. Use local Tuesday, November 17, 2026, at 08:00. Compute the epoch in the browser with `new Date(2026, 10, 17, 8).getTime()`. Clock values below are synthetic. Define `at(minute)` as local midnight plus minutes. Use local calendar math when stepping to Wednesday. For the editor round trip use `page.clock.setFixedTime(now)` before navigation. For planner calls also follow the existing frozen-`Date` pattern inside `page.evaluate`.

Use `baseHabit`, overriding at least `target: 1`, `priority: 0`, `createdAt: at(0) - 86400000`, `breakable: false`, `logs: []`, `lastLog: null`, `anywhereAllowed: false`, and `locationIds: ['home']`. Leave the general weekdays unrestricted, and leave preferred times unset. Build fresh settings and input per case.

| Fixture | General window | Duration | Explicit row |
| --- | --- | --- | --- |
| `prayer-case` | Home 11:00–14:00 (660–840) | 15 minutes | `jamaat`, Masjid, Tuesdays `[2]`, fixed 12:17 (737), `pref: 'high'`, alternative |
| `study-case` | Home 13:00–17:30 (780–1050) | 45 minutes | `in-person`, Tutor, Tuesdays `[2]`, fixed 15:07 (907), `pref: 'high'`, alternative |

For example, the prayer fixture is:

```js
const prayer = baseHabit({
  hid: 'prayer-case',
  name: 'Dhuhr',
  target: 1,
  priority: 0,
  createdAt: at(0) - 86400000,
  durationMinutes: 15,
  anywhereAllowed: false,
  locationIds: ['home'],
  allowedTimeStart: 660,
  allowedTimeEnd: 840,
  scheduleOptions: [{
    id: 'jamaat',
    locationId: 'masjid',
    weekdays: [2],
    start: 737,
    fixedStart: true,
    sameDayMode: 'alternative',
    pref: 'high'
  }]
});
```

Use `plannerSettings([], overrides)` to start with a blank agenda and the standard availability. Register `home` (40, -74), `masjid` (40.01, -74), and `tutor` (40.02, -74) with distinct names. Set `lastKnownLocationId: 'home'`, `defaultTravelMode: 'driving'`, and manual cache entries for Home ↔ Masjid 10 minutes, Home ↔ Tutor 12 minutes, Masjid ↔ Tutor 12 minutes. For each pair, use the sorted pair key `[a, b].sort().join('|')` and value `{a, b, seconds: minutes * 60, metres: 1000, provider: 'manual', fetchedAt: now}`. This keeps route times independent of API requests and coordinates. Use Playwright's default geolocation permissions and isolated storage. Use fresh browser state or explicit clock/settings restoration between scenarios. Keep the default score weights.

Build a fixed Home commitment with `baseHabit({hid, name, type: 'task', target: null, eventTime: at(start), durationMinutes, createdAt, anywhereAllowed: false, locationIds: ['home']})`. Published rows for these commitments have `kind: 'scheduled'`. For an options-only control, set `allowedTimeStart` and `allowedTimeEnd` to `null` and set `locationIds` to just the explicit option venue. Keep `anywhereAllowed: false`. Assert `hasGeneralAllowedSchedule` is false in this control so the solver cannot find an unrestricted general fallback.

## Required planner cases

### A. One occurrence with home and exact away alternatives

Each row uses the prayer fixture unless otherwise indicated. Every Home outcome must have exactly one `fill` for the habit with ID `general`, place `home`, duration 15, and start and finish inside the Home window. Every Jamaat outcome must have exactly one fill with ID `jamaat`, place `masjid`, and the exact interval 12:17–12:32.

| Case | Change from the light day | Expected result for both engines |
| --- | --- | --- |
| A1 Light day | Habit alone, starting at Home | Jamaat. A full Home → Masjid travel row from 12:07 to 12:17. |
| A2 Clock conflict | Fixed at Home 12:14–12:31 | Home. The fixed row keeps its place, start, and end. |
| A3 Inbound travel conflict | Fixed at Home 11:52–12:12 | Home. Five minutes to reach a venue ten minutes away. The appointment and Jamaat activity intervals alone would fit. |
| A4 Outbound travel conflict | Fixed at Home 12:37–13:07 | Home. The five minutes after Jamaat are too short for the ten-minute return. The fixed row stays intact. |
| A5 Venue closes early | Masjid `hoursByDay: {2: {start: 660, end: 745}}` | Home. The 12:17 start is inside venue hours and the 12:32 finish exceeds the 12:25 close. |
| A6 Exact start has passed | Freeze at 12:18 on Tuesday | Home with start at or after 12:18. There is no late-start Jamaat. |
| A7 Option closed on this weekday | Freeze at 08:00 on Wednesday | Home. The Tuesday restriction applies to Jamaat only. |
| A8 All alternatives blocked | Add a busy interval 11:00–14:00 on Tuesday | Zero placed fills for the habit. If the agenda supplies an unplaced item, count it separately from timed fills. |

Add two paired boundary controls using the **options-only** prayer variant. These isolate feasibility from preference.

1. With a Home appointment 11:47–12:07, permit Jamaat, with outbound departure from Home exactly when the appointment ends. Extend the appointment by one minute and require zero fills.
2. With a Home appointment 12:42–13:12, permit Jamaat plus the full ten-minute Masjid → Home trip ending at 12:42. Shift the appointment one minute earlier and require zero fills. Keep its duration and location intact.

### B. Agenda and travel context change the tutor choice

Every Home outcome uses `general` at `home` and fits 45 minutes within 13:00–17:30. Every fixed Tutor outcome uses `in-person` at `tutor` from 15:07 to 15:52. Use fresh copies of the same study fixture per case.

| Case | Change | Expected result for both engines |
| --- | --- | --- |
| B1 Light day | Habit alone, starting at Home, 12-minute commute | Tutor and the full 14:55–15:07 commute. |
| B2 Competing due work | Add an 85-minute non-breakable P0 task due today, `hardDue: true`, place Home, window 14:25–16:25 (865–985) | Home study and the full 85-minute due task. A Tutor trip blocks the only continuous slot for that due task. |
| B3 Long trip with a valid fallback | Habit alone, starting at Home, replace only the cached Home ↔ Tutor edge with 150 minutes | Home. The trip fits by the clock, and the available Home option avoids the expensive trip. |
| B4 Already at the preferred venue | Same long-route settings as B3, `lastKnownLocationId: 'tutor'` | Tutor at 15:07, with no inbound trip. |
| B5 Change preference | Same as B1, change only Tutor row to `pref: 'avoid'` | Home. |
| B6 Avoided option still works | Same as B5, narrow the Home general window to 13:00–13:45 and add a fixed Home commitment covering the whole window | Tutor, with full commute. `avoid` is a soft rank. |

B2 needs two independent controls. The due task alone must place its 85 minutes within its window. An options-only Tutor variant alone must place the appointment-length fill at 15:07 with the full trip. The latest possible departure for Tutor is 14:55 and the earliest possible return is 16:04. Within the due task's window that leaves only 30 minutes before departure and 21 minutes after return. This is a comparison of complete schedules, so assert same-day preservation of both fills in the combined case. A differing count of published rows in the rest of the week cannot satisfy it.

For B3, also solve the options-only Tutor variant with the long edge, the Home seed, and the 08:00 clock. It must place Tutor at 15:07 with 150 minutes of travel, demonstrating that the main case tests a travel trade-off.

### C. A second flexible window and preference levels

1. Change study's Home window to 13:00–13:45 and its specific Tutor row to a window 15:00–16:15 (900–975), with ID `flex-tutor`. Add fixed Home commitments at 13:00–13:45 and 15:00–15:10. Tutor must fit after the 12-minute commute, so the supported start interval is 15:22 through 15:30 and the full 45 minutes must end by 16:15. The baseline starts at 15:22. Assert the legal range and travel, unless the case is purposefully testing earliest start. Shrink the Tutor window's end to 16:06 as a negative control. Require zero fills because the earliest arrival, 15:22, needs until 16:07. This pair checks that the Tutor window may slide and stays tied to Tutor. Home remains blocked through its own window.
2. For a controlled rank comparison, use an options-only Study habit, a Tutor seed, and `locationPrefs: {tutor: 'avoid'}`. Give it two Tuesday alternatives at the same Tutor venue, a 15:07 row with ID `earlier` and `pref: 'little'`, and a 16:10 row with ID `later-tutor` and `pref: 'high'`. Both have a fixed start, equal duration, and zero approach travel. Expect 16:10. Clear the late row's preference while preserving the place-level `avoid`. Expect 15:07. Verify the row IDs as well as the exact clocks. Reverse the order of the two rows in one repeat to catch choosing by array position.

### D. Completion belongs to the habit occurrence

1. On Tuesday, get a real selected Home row in a forced-Home case and a real selected Jamaat row in the exact-boundary control. Return `occurrenceKey`, `scheduleOptionId`, and `scheduledDay` along with the row placement. Use the selected row metadata to build one actual completion with `makeActualLog(ts, metadata)`; preserve the exact fields that the planner supplies. Place the log at or before the replan clock. Read it back through normal log normalization. Assert one actual completion for the habit and no second pending session on that day.
2. Use a combined fixture with the general Home window blocked early and a viable fixed Jamaat row to obtain an actual **away** placement in the original two-path model. For example, narrow the Home window to 11:00–11:15 and reserve a Home appointment for those 15 minutes. Record the away completion, advance the frozen clock past completion but within an otherwise available Home window, and remove the blocking commitment. Give the general Home window its original 14:00 end for this replan. It must stay completed on Tuesday and may schedule one Home occurrence on Wednesday. Also test the opposite direction by completing the original Home row before 12:17 and, after removing the busy constraint, showing no pending Jamaat row even though it is still in the future. This catches alternatives accidentally getting independent completion credit. Set `lastLog` consistently with the single actual log when seeding planner input. Follow the existing identity assertions in `habit-schedule-options-test.js`. A displayed completed row can remain visible.

## Editor and storage round trip

Add one narrow browser test using the real detail editor, ideally alongside the agenda cases in `tests/alternative-time-place-context-test.js`. Use a fresh page, a synthetic existing daily habit, the saved location registry, and `minimalMode: false`. Seed the habit and registry in the test context using the existing test's `tings_v2` and `tings_app_settings_v2` pattern. Make the actual changes through the editor.

1. Open the item using the existing `openDetail` test pattern. Enter Availability using `scrollDetailToNav('availability')`. On the Allowed view enter the Home window with `#detail-time-start` and `#detail-time-end`. Select Home as the only general place in `#detail-place-chips` and turn Anywhere off. Seeding the initial Home place is fine if this keeps the test focused on schedule options.
2. Open `#detail-options-disclosure` (specific times & places) and click `#detail-habit-option-add`. Set `.habit-option-location` to Masjid, `.habit-option-time-kind` to `fixed`, and `.habit-option-start` to `12:17`. Set Tuesday via `[data-habit-option-day]` buttons and check `aria-pressed` before toggling. Set the preference to strong using `.habit-option-pref` and check `data-pref="high"`. From neutral it takes two clicks. With one explicit row the same-day choice may be hidden because overlap detection compares explicit rows. The saved row should use alternative behavior.
3. Save via `#detail-save`. Reload. Check the data returned by `load()` for exactly one item with the same habit ID, the original duration, the general allowed times and Home place, and the explicit row's stable ID, Tuesday, Masjid place, start 737, `fixedStart: true`, `sameDayMode: 'alternative'`, and `pref: 'high'`. Reopen and check the controls reflect those values. A null end for the fixed row is valid because duration sets the finish.
4. Feed the reloaded item into the same planner wrapper for the light and inbound-conflict cases. The light agenda should select the saved away row by its real saved ID. The busy agenda should select `general` at Home. Use independent solve inputs so the second result demonstrates replanning from the same saved configuration.
5. Check that the opening and saving flow generates no page errors. Use Playwright locator readiness checks for the pane and buttons. The existing test already covers the overlapping-explicit-row prompt and separate-session mode.

## Runner and assertions

- Add the focused top-level test file and classify it in `tests/test-suites.tsv` with a tab-separated row `alternative-time-place-context-test.js\tplanner\tonce` if the default page calls both engines and the editor test only exercises the saved configuration. Use `page-both` if you test mode-specific mounted Home behavior. Automatic checks and the per-engine result should use the same expected policy.
- Default mode calls `buildWeekAgendaAsync(data, {...settings, agendaOptimizer: true}, numDays)` and `buildWeekAgenda(data, {...settings, agendaOptimizer: false}, numDays)` on equivalent fresh inputs. In a Fast-only run use `FAST_ONLY` and call only Fast. Use `numDays = 1` except when specifically checking the Wednesday occurrence, where a two-day horizon also works.
- In `page.evaluate`, bind `sortSettings` to the case's settings and freeze `Date` as in the existing tests. Restore both in `finally`. Use fresh clones per engine. Keep all fixture timestamps derived from the frozen local clock and use a proper `finally` to close the browser.
- Check GLPK availability once. If WASM is unavailable, report a GLPK skip explicitly and still run Fast. If WASM is available, assert that `week.optimized` is true and `plannerSolveStatus` is `optimal` or `feasible`. When a soft-preference expectation fails on a feasible incumbent, report that provenance. A Fast fallback cannot pass as GLPK. Record `daySolves` status when diagnosing a mismatch and leave production time limits intact.
- Serialize the day key and rows from `week.days[n].timeline`, including `kind`, `row.h?.hid ?? data[row.i]?.hid`, `start`, `end`, `locationId`, `scheduleOptionId`, `occurrenceKey`, `scheduledDay`, `from`, `to`, and `seconds`. Check the focal habit by ID, even when the test has multiple named items. Compare timestamps exactly for fixed starts and durations. For flexible windows check bounds, and require full duration. Where travel is required, test that the leg has the correct endpoints, seconds, positioning, and no overlap with work or commitments. Treat endpoint equality as legal. Use `homeDaySequence(day, settings)` to spot-check the visible sequence in an inbound and outbound boundary case. Require a return leg when the next scheduled activity is at Home. On a light day there may be no later Home commitment requiring a return.
- Assert total placed occurrence count separately from option identity to catch duplicates. Include per-case and per-engine labels. Continue the matrix after an assertion failure and exit nonzero if any required expectation fails. Print the actual rows and solver status on failure so a wrong option, illegal commute, missed due work, and wrong planner mode are distinguishable.

Run these from `habits/` after adding the file:

```bash
./run-tests.sh planner --test '*alternative-time-place-context*'
./run-tests.sh planner --mode fast --test '*alternative-time-place-context*'
./run-tests.sh planner --test '*habit-schedule-options*'
./run-tests.sh planner --test '*meeting-travel-conflict*'
./run-tests.sh planner
```

The runner starts its own static server. If port 4181 is occupied, use `PORT=4182 ./run-tests.sh ...` or use the existing server with `HABITS_URL=http://127.0.0.1:4181/ node tests/alternative-time-place-context-test.js`. For a direct Fast-only run set both `HABITS_PLANNER_MODE=fast` and `HABITS_URL='http://127.0.0.1:4181/?planner=fast'`.

## Baseline observations and how to report the gap

The existing habit schedule-options suite passed 85 assertions. The meeting travel-conflict suite also passed. A synthetic Playwright probe using actual GLPK and Fast returned the following on the current checkout:

| Probe | GLPK | Fast |
| --- | --- | --- |
| A1, optional Jamaat on an empty agenda | Masjid at 12:17 with 10 minutes of travel | Home at 11:00 |
| B1, optional tutor on an empty agenda | Tutor at 15:07 with 12 minutes of travel | Home at 13:00 |
| B1 repeated with a six-minute trip | Tutor at 15:07 | Home at 13:00 |
| A2–A8, hard conflicts, hours, elapsed start, weekday, or both blocked | Expected fallback or no fill | Expected fallback or no fill |
| Options-only one-minute boundary controls | Accept exact edge, reject short gap | Accept exact edge, reject short gap |
| B2, competing 85-minute due task | Home with both fills | Home with both fills |
| B3–B6, long trip, already on site, and preference changes | Expected venue | Expected venue |
| C1 flexible window and shortened-window control | Tutor at 15:22, then zero fills with the shorter window | Same |
| C2 preference override | Strong 16:10 row, then soft 15:07 row with late override cleared | Same |
| D completion smoke probe | No second Tuesday fill after a synthetic Home or Jamaat completion | Same |

The completion smoke probe used synthetic logs. The editor round trip and end-to-end completion replan using metadata from the actually selected rows are additional verification work.

One code path to inspect if A1 and B1 reproduce is the two-stage rank in `pickBestScoredFit`. It compares `coreScore` first. That score keeps travel and removes preference, ASAP, and scarce-overlap terms. Full preference scoring breaks core ties. This could explain why Home wins whenever it saves a commute in these fixtures, even if the away row has a better full score. Trace the bound variants, legal fits, and final selection before attributing the result. Keep this inference distinct from the directly observed results. Any later fix should retain hard feasibility, one completion per occurrence, due-work preservation, and the existing route and order-link regressions.

Hand back the test file, the suite registration, exact commands and results, and a concise per-engine table of any remaining failures. For the light-day failures give the expected and actual option ID, location, clock, travel seconds, and solve provenance. The desired result is two engines that can select the strongly preferred nearby option on a genuinely light day and fall back to the flexible home option when the schedule or route warrants it.
