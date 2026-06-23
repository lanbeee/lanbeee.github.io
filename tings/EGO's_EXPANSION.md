# Planner Expansion Plan

## Purpose

Tings (the "Habits" app) already solves the core problem with calendars and
to-do lists: rigid due dates create anxiety, and dateless to-dos float
untethered. The `keepup`/`reduce`/`zero` model sidesteps both by scoring
*rhythm* (`target` + `flexibilityDays`) against *capacity*
(`availabilityMinutes`/`durationMinutes`) instead of a fixed date.

What's missing is two item shapes the current model can't express:

- **A one-off task** — happens once, no rhythm, but may have a soft or hard
  due date. ("Call the dentist back.")
- **A fixed-time event** — a literal point in time that should never be
  rescored or reshuffled. ("Dentist appt, Tue 3:00pm.")

This plan adds both as new values of the existing `type` field rather than a
parallel data structure, then builds the "Today" agenda view that turns the
combination of events + tasks + habits into something that can actually
replace a calendar and a to-do list.

---

## Design principles

1. **One pipeline, not three.** Tasks and events are new `type` values on the
   existing `Habit` record, stored in the same array, passing through the
   same `normalize()`, `save()`, `attentionScore()`, search, and topic
   filtering. No new storage key, no new array, no new sync surface.
2. **Reuse fields whose semantics already fit.** `durationMinutes`, `topics`,
   `emoji`, `pinned`, `snoozedUntil`, `allowedWeekdays/MonthDays`,
   `allowedTimeStart/End`, and even `flexibilityDays` carry over with no
   schema change. Only add a field when nothing existing covers it.
3. **Stay anti-rigid.** The temptation with "calendar replacement" is to
   reintroduce hard time slots everywhere. Resist it — only `event` gets a
   literal timestamp. `task` keeps the soft-window philosophy that already
   makes habits feel humane.
4. **Web first, native later.** This plan only touches the web codebase.
   `IOS_PORT_PLAN.md` already has a refactor checklist (R1–R7) written
   against today's schema — see [Interplay with the iOS port plan](#interplay-with-the-ios-port-plan)
   for how this plan amends it rather than competing with it.

---

## New data shapes

### Task — one-off, soft or hard due date

```js
/**
 * @typedef {Object} TaskFields  — additional semantics when type === 'task'
 * @property {number|null} dueDate      — ms timestamp (day-level), or null for a "someday" task
 * @property {boolean} hardDue          — if true, dueDate is a real deadline (no slack after it)
 * @property {number|null} createdAt    — ms timestamp set at creation; used to order someday tasks
 */
```

- `target` is always `null` for tasks — there is no rhythm.
- `flexibilityDays` is **reused**, but its meaning flips direction: instead
  of stretching a recurring rhythm, it defines how many days *before*
  `dueDate` the task starts surfacing as relevant —
  `readyDate = dueDate - flexibilityDays`. Same field, same slider in the
  UI, just relabeled when `type === 'task'`.
- Completion reuses the existing log mechanism: a task is "done" the moment
  it gets its first actual log, via the same `logTing()`/`logTingAt()`
  functions habits already use. No new "completed" boolean — `lastLog !==
  null` *is* completion for a task. This means undo, the activity sheet, and
  the calendar overview all work on tasks with zero changes.
- `createdAt` is a new field, added for *all* types (not just tasks) so
  someday-tasks with no `dueDate` have a stable secondary sort key and so
  "added 3d ago" copy is possible anywhere in the app. Existing records
  migrate with `createdAt: null` and sort last among same-priority items —
  fully backward compatible.
- `hardDue` exists for the rare genuinely-fixed deadline (a permit
  application, a tax form). When true, the urgency curve escalates harder
  past `dueDate` instead of just "overdue." Defaults to `false`.

### Event — fixed point in time

```js
/**
 * @typedef {Object} EventFields — additional semantics when type === 'event'
 * @property {number} eventTime  — ms timestamp, exact minute. Required.
 */
```

- `target` is `null`. `durationMinutes` is reused as the block length.
- Events are **excluded from `attentionScore()` entirely** — they are never
  reordered, never scored, never subject to urgency curves. They are placed
  by time, full stop. This is the one place in the whole model where rigidity
  is correct, because the thing being modeled (an appointment with another
  person, a flight) really is rigid.
- No recurrence in v1 — single occurrence only. A repeating event is just
  several events. (A "repeats weekly" convenience that auto-creates the next
  occurrence on completion is a reasonable v2 add — flagged in
  [Open design decisions](#open-design-decisions), not built now.)
- Past events fall out of the active list automatically (same pattern as
  `daysSince`/`dayDistance` already use for past timestamps) unless pinned.

---

## Data layer changes — `data.js`

Extend the JSDoc typedef block (already present per R1 of the iOS plan) with
`TaskFields` and `EventFields` above, merged into the `Habit` typedef as
optional properties.

`normalize()` needs:

```js
target: (h.type === 'zero' || h.type === 'task' || h.type === 'event')
  ? null
  : clampRhythmValue(h.target || 7),
dueDate: h.type === 'task' ? clampDayTimestamp(h.dueDate) : null,
hardDue: h.type === 'task' ? Boolean(h.hardDue) : false,
eventTime: h.type === 'event' ? clampTimestamp(h.eventTime) : null,
createdAt: h.createdAt || null,
```

New pure helpers (same "PURE — no browser deps" section as `scheduledDays`,
`nextEligibleDate`, etc.):

- `clampDayTimestamp(ts)` — validates a ms timestamp or returns `null`;
  normalizes to day-start the way `dayStart()` already does.
- `clampTimestamp(ts)` — validates a ms timestamp, no day-rounding (events
  need the exact minute).
- `daysUntil(ts)` — the mirror image of `daysSince()`, for due dates and
  event times that sit in the future. (`daysSince` already returns negative
  for future timestamps in some call sites — worth checking whether to reuse
  `daysSince` directly or keep a clearer name. Either way, no new concept,
  just a sign-flipped helper.)
- `taskReadyDate(h)` — `dueDate === null ? null : dueDate - flexibilityDays * 86400000`.
- `isTaskReady(h, ts = Date.now())` — `!hasDaySchedule(h) || isDateEligibleForHabit(h, ts)`
  combined with `taskReadyDate(h)`, mirroring how `nextEligibleDate` already
  composes with schedule checks.

**Done when:** every new field above has a JSDoc entry, a normalize() clamp,
and a default that makes an old (pre-task/event) JSON blob load without
throwing.

---

## Scoring engine changes — `scoring.js`

This is the part that needs the most care, because `attentionScore()` is
546 lines of tuned arithmetic and the goal is to extend it, not destabilize
the existing habit scoring.

**Events bypass scoring completely.** In `visibleIndices()`, filter
`type === 'event'` out of the ranked list before sorting — events are
rendered by the new Today/agenda view (next section) and in the calendar
overview, never in the priority-ordered home list. This is the simplest and
safest change: zero risk of an event polluting habit ranking math.

**Tasks get a new urgency function**, parallel to `buildUrgency()`:

```js
// ─── Task urgency (one-off countdown, not a recurring ratio) ───
function taskUrgency(h, settings) {
  if (h.dueDate === null) return null; // someday task — handled separately
  const daysLeft = daysUntil(h.dueDate);
  const window = Math.max(1, h.flexibilityDays || 3);
  if (daysLeft <= 0) {
    const overdueBoost = h.hardDue ? 1.4 : 1;
    return (1 + Math.min(0.75, Math.abs(daysLeft) / window)) * overdueBoost;
  }
  return Math.max(0, 1 - daysLeft / window);
}
```

This deliberately mirrors `buildDueScore()`'s shape (0→1 ramp, escalating
past the threshold) so it can reuse `buildDueScore(urgency, riseAt)`
directly instead of inventing a second curve — same visual/behavioral
language as build-habit urgency, which keeps the whole list feeling
consistent.

**`priorityComponents()`** needs a branch: for `type === 'task'`, skip the
`progress`/`trend`/`rhythm` components entirely (there's no history to
compute them from) and feed `taskUrgency` into the `due` slot only. This
follows the existing precedent in `attentionScore()` where `type === 'zero'`
already short-circuits into `stopPolicy.mix` instead of the full
`BASE_SORT_MIX` — same pattern, new branch.

**Someday tasks** (`dueDate === null`) get a small constant baseline score
instead of a curve — same idea as the existing `newBuildMode` handling for
never-logged build habits (`quiet`/`gentle`/`rise` in `DEFAULT_SORT_SETTINGS`).
A `newTaskMode` setting could reuse that exact concept: someday tasks stay
quiet until pinned or manually surfaced, rather than competing for attention
against things with real due dates.

**`todayCategory()`** needs a task branch alongside the existing `keepup`/
`reduce` checks:

```js
if (h.type === 'task' && h.dueDate !== null) {
  const daysLeft = daysUntil(h.dueDate);
  if (daysLeft <= 0) return isAvailableToday ? 0 : 1;
}
```

**`FOCUS_TYPE_SCALE`** and `typeSettingScale()` need a `task: 1` default
entry in each focus map (`balanced`/`build`/`space`) so tasks aren't silently
zeroed out by a scale map that doesn't know about them. `event` doesn't need
an entry — it never reaches this code path.

**Testing this without breaking the live app:** the settings sheet already
has a sample-habit builder (`addSortSamples`/`removeSortSamples` in
`main.js`, feeding the "Sort Lab" UI). Extend it to also generate a handful
of sample tasks (overdue, due today, due next week, someday) and one sample
event, so the new scoring branches can be tuned visually in the same Sort
Lab workflow already used for habits — no separate test harness needed.

**Done when:** a sample due-today task and a sample due-next-week task sort
correctly relative to a sample overdue build-habit, without changing the
relative order of any existing habit-only test case.

---

## UI changes — add & detail sheets

### Add sheet (`#add-sheet`, wired in `main.js`)

The type segmented control (`#type-seg`) gains two more options: `task` and
`event`. The `do-save` handler's field set per type:

| Field shown | keepup/reduce | zero | task | event |
|---|---|---|---|---|
| Rhythm slider (`#ting-days`) | yes | no | no | no |
| Due date picker (new) | no | no | yes | no |
| Date + time picker (new) | no | no | no | yes |
| Emoji, topics | yes | yes | yes | yes |

This keeps the add flow exactly as fast as it is today — name + type +
one extra field, same as the current name + type + rhythm pattern. No new
friction for the common case.

### Detail sheet (`detail-view.js`)

`setDetailTypeUi(type)` gains branches for `task`/`event` that toggle the
rhythm slider row off and a new due-date / event-time row on, the same way
it already toggles `#detail-slider-row` off for `zero`.

`currentDetailTune()` and `setDetailDirty()` both need `dueDate`/`hardDue`/
`eventTime` added to the read/compare set — straightforward additions
following the exact pattern already used for every other field there.

`detailHeaderLine()` and `aboutText()`/`trendText()` (the human-readable
summary strings) need a task/event branch — e.g. "due in 3d" instead of
"every 7d", "today at 3:00pm" instead of a rhythm description. These are
pure string-formatting functions, lowest-risk part of the whole plan.

**Done when:** creating a task or event from the add sheet, then editing its
due date / time from the detail sheet, round-trips correctly through
`save()`/`load()` with no console errors and no regression in the existing
habit detail flow.

---

## New view: Today agenda

This is the feature that actually delivers "replaces my calendar." Today the
app has a ranked list (home) and a heatmap (`overview-view.js`'s calendar).
The missing third surface is a literal "what does today look like"
timeline.

### Data flow

```js
function buildTodayAgenda(data, settings) {
  const todayKey = todayIso();

  // 1. Fixed blocks — events happening today, by literal time.
  const events = data
    .filter(h => h.type === 'event' && dateKey(h.eventTime) === todayKey)
    .sort((a, b) => a.eventTime - b.eventTime);

  // 2. Remaining capacity after fixed blocks are subtracted.
  const usedMinutes = events.reduce((sum, h) => sum + clampDuration(h.durationMinutes), 0);
  const totalMinutes = effectiveAvailabilityMinutes(todayKey, settings);
  let remaining = Math.max(0, totalMinutes - usedMinutes);

  // 3. Soft-ordered fill — top of the existing ranked list, greedily
  //    allocated into whatever capacity is left. No new scoring logic:
  //    this reuses visibleIndices() exactly as the home screen does.
  const ranked = visibleIndices(data, settings).map(i => data[i]);
  const agendaItems = [];
  for (const h of ranked) {
    if (h.type === 'event') continue; // already placed above
    const cost = clampDuration(h.durationMinutes);
    if (cost > remaining && agendaItems.length) continue; // skip, keep scanning for a smaller fit
    agendaItems.push(h);
    remaining -= cost;
    if (remaining <= 0) break;
  }

  return { events, agendaItems, totalMinutes, usedMinutes };
}
```

### Rendering — deliberately *not* a rigid mini-calendar

The agenda renders as a vertical timeline where:
- Events sit at their literal time, with a real time label.
- Tasks/habits fill the gaps **in rank order**, each shown with an
  estimated time-of-day range computed by walking forward from the previous
  block's end — but visually distinct (lighter, no hard grid line) from
  events, so it reads as "do these roughly in this order" rather than "be
  here at this exact minute." This is the single most important UX decision
  in this plan — see [Open design decisions](#open-design-decisions).

### Wiring

A new `today-view.js` module, following the existing file-per-concern
pattern (`list-view.js`, `overview-view.js`, etc.), plus:
- A new sheet markup block in `index.html` (`today-sheet`), following the
  exact wrap/`.sheet` structure every other sheet already uses, so it
  inherits `mountInPane()`/`unmountPane()`/`ensureOverviewPlacement()`
  pane-vs-modal behavior on wide tiers for free.
- A nav entry next to the existing `bar-open-overview` button in `main.js`.
- `renderTodayAgenda()` called from the same places `renderOverview()`
  already is (tier change, app open, after any log/save).

**Done when:** opening the agenda on a day with two sample events and four
ranked habits/tasks shows the events at their real times, fills the gaps in
rank order, and reduces `remaining` to zero or runs out of items — with no
overlap between the event blocks and the filled items.

---

## Week view

A secondary, smaller addition: a 7-day strip, structurally identical to the
existing 14-day strip in `renderOverviewRecent()` — same `buildDayTally()`,
same `cellMarkup()`, just `length: 7` instead of `length: 14` and anchored
to the start of the current week instead of "today minus 13." This is the
forward-looking complement to the agenda's "just today" focus, reusing
overview-view.js's existing tally/grid code almost line for line.

**Done when:** the week strip and the existing 14-day strip render
side-by-side correctly without duplicating `buildDayTally()` logic — extract
a shared `renderDayStrip(data, startTs, days)` helper if the two diverge by
more than the day count.

---

## Drag-to-reschedule

`renderDayLogs()` already has a "remove plan" button
(`data-remove-plan`/`data-plan-day`) for planned log entries. Add a sibling
"move to…" button that opens a tiny date picker and, on confirm, does
exactly what undo already does internally — `removeEntryAt(idx, ts, true)`
followed by `logTingAt(idx, newTs)` — so the existing toast/undo
infrastructure covers the new action with no new state machine.

**Done when:** moving a planned entry from one day to another updates both
days' calendar cells immediately and is undoable via the existing undo
toast.

---

## Stretch: Web Push reminders

Flagged as **optional and the riskiest item in this plan** — be honest with
yourself about scope before starting it.

The philosophy of this app is deliberately anti-nag for rhythm-based habits
— there is no reminder system today, by design. Reminders only make sense
for the two new rigid shapes: a hard-due task, or an event. Even there:

- True background push (notification fires while the tab/PWA isn't open)
  needs either a push backend (VAPID keys + a server to hold subscriptions)
  or the browser's Notification Triggers API, which has poor cross-browser
  support as of this writing and shouldn't be relied on.
- A scoped-down v1 that fires reminders only while the app is open or on
  next launch (checking `eventTime`/`dueDate` against `Date.now()` at
  startup, the same moment `sortSettings = loadSortSettings()` runs today)
  delivers real value with zero new infrastructure — it just won't notify
  you if the PWA is fully closed.
- True any-time background push is realistically a native-app feature
  (APNs makes this close to free) — `IOS_PORT_PLAN.md` already lists push
  notifications as out-of-scope for the RN MVP and a fast-follow after. If
  reminders matter enough to justify a backend, it may be more efficient to
  wait for the native port than to stand up push infrastructure for the PWA
  twice.

**Recommendation:** build the foreground/launch-time check first (cheap,
real value), defer true background push to the native app phase.

---

## Stretch: one-way `.ics` export

A personal planner can absorb your own calendar, but it can't replace a
*shared* one — other people still need to see your event on their calendar.
A pure function:

```js
function icsForEvent(h) {
  // RFC 5545 VEVENT block: DTSTART/DTEND from eventTime + durationMinutes,
  // SUMMARY from h.name. No external dependency needed — it's a string template.
}
```

surfaced as an "export" action in the event detail sheet, producing a
`data:` URI download. No server, no sync, no calendar-API integration — just
an escape hatch so a fixed event can still land on someone else's calendar.

---

## Phased rollout

| Phase | Deliverable | Files touched | Depends on |
|---|---|---|---|
| 0 | `task`/`event` typedefs, `normalize()` clamps, `createdAt` field | `data.js`, `config.js` | none |
| 1 | Scoring: task urgency, event exclusion, `todayCategory` branch, sample builder extension | `scoring.js`, `main.js` (sample builder) | 0 |
| 2 | Add/detail UI for the two new types | `list-view.js`, `detail-view.js`, `main.js` | 0, 1 |
| 3 | Today agenda view | new `today-view.js`, `index.html`, `main.js`, `shell-ui.js` (pane wiring) | 0, 1, 2 |
| 4 | Week strip | `overview-view.js` | 0 |
| 5 | Drag-to-reschedule | `overview-view.js`, `main.js` | none (works today, just additive) |
| 6 (stretch) | Foreground reminders | `main.js` (startup check) | 0 |
| 7 (stretch) | `.ics` export | new pure helper, `detail-view.js` | 0 |
| 8 (stretch) | True background push | `sw.js` + backend | 6, native app likely better venue |

Phases 0–2 are the load-bearing ones — nothing else in this plan works
without the schema and scoring foundation. Phase 3 (the agenda view) is the
feature that actually delivers on "replaces my calendar and to-do list";
everything after it is refinement.

---

## Interplay with the iOS port plan

`IOS_PORT_PLAN.md` Purpose 2 (R1–R7) was written against today's schema and
R1–R6 are already checked off. Two things to do because of that:

1. **Do Phase 0–1 of this plan before touching R1's typedefs further** — the
   `Habit`/`Settings` JSDoc blocks R1 produced are the ones this plan
   extends. Widening them now, while everything is still plain JS, costs an
   editing pass. Widening them after the RN port has turned them into
   TypeScript interfaces costs a migration.
2. **R6 ("mark every function RENDER or EVENT HANDLER") should be reapplied
   to the new `today-view.js` as it's written**, not retrofitted later —
   write the new file with those annotations from the start, matching the
   convention already established in `overview-view.js` and `list-view.js`.

No changes needed to the RN stack choices, phases, or MVP scope table in
Purpose 1 — this plan is entirely a "Purpose 0," upstream of where that
document picks up.

---

## Open design decisions

These need a decision before — or while — building, flagged rather than
silently assumed:

1. **Agenda time labels: soft estimate vs. hard slot?** This plan recommends
   soft, rank-ordered estimates (see [Today agenda](#new-view-today-agenda))
   to stay consistent with the app's anti-rigidity philosophy. The
   alternative — letting the user drag tasks into literal time slots,
   turning the agenda into a real mini-calendar — is more calendar-like but
   reintroduces exactly the rigidity this whole plan exists to avoid. Worth
   deciding explicitly rather than drifting into it feature-by-feature.
2. **Completed-task lifecycle.** Stay visible (crossed out) for a day then
   drop from the default list, full history still in the calendar/activity
   sheet? Or archive immediately? Affects `visibleIndices()`'s filter logic.
3. **Event recurrence in v1?** This plan defers it (single-occurrence only).
   If weekly-recurring events come up often in practice (standing meetings),
   it may be worth pulling forward as a thin convenience: on completing a
   recurring event, auto-create the next occurrence — no real recurrence
   engine needed, just a copy-forward.
4. **`hardDue` escalation curve.** The `1.4×` overdue multiplier above is a
   placeholder — needs tuning against real due-soon tasks the way the
   existing `LIMIT_MODE_POLICY`/`STOP_MODE_POLICY` constants clearly were
   (via the Sort Lab, per the testing note in the scoring section).