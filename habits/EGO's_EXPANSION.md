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

## Web Push notifications (complete)

Built and deployed. Architecture: one Cloudflare Worker (shared by all PWA
users) + D1 database + 5-minute scheduled cron. The in-app banner remains the
primary channel; push is additive and fires at the exact time (+/- 5 min) even
when the PWA is closed and the phone is locked.

### Why this architecture

The app is on-device only by design — no backend stores user habits. Web Push
requires a server to authenticate (VAPID) and encrypt the notification payload
before forwarding it to Apple's/Google's push service. The Worker is a **pure
relay**: it receives a scheduled push request, stores it until the fire time,
then forwards it to the push service. It never stores habit lists, logs, or any
user data beyond what's needed to deliver the one notification.

All users of the PWA share the same Worker endpoint (deployed by the app
owner). Each device subscribes independently with its own VAPID-signed
subscription. The Worker never sees habit names unless the user explicitly opts
into rich notifications (see below).

### Privacy: per-user payload setting

Users choose how much context appears in the notification:

| Setting | Push says | Worker sees | Use case |
|---------|-----------|-------------|----------|
| `pushDetailed: false` (default) | `"Task due today"` or `"Event starting soon"` | Only the generic title + opaque tag | Privacy-first, matches app ethos |
| `pushDetailed: true` | `"Call mom · relationships"` (full body from `gatherReminders`) | The task/event name + topics | Useful, at the cost of sharing content with the relay |

The setting is a toggle in the reminders section of the settings sheet, shown
only when reminders are on. Toggling it affects only future scheduled pushes
(existing ones are already enqueued with the payload they were scheduled with).

### Storage: D1 schema

D1 (SQLite via CF) was chosen over KV because:

- Strong consistency — no lost writes when multiple users schedule for the same
  minute bucket.
- No free-tier list-operation quota (KV has 1000/day — too tight for a
  per-minute cron).
- Naturally handles dedupe via `INSERT OR REPLACE` with a composite PK.

```sql
CREATE TABLE IF NOT EXISTS scheduled_pushes (
  device_id   TEXT NOT NULL,
  sig         TEXT NOT NULL,     -- same sig used for client-side dedupe
  fire_at     INTEGER NOT NULL,  -- epoch ms, minute-granularity
  subscription TEXT NOT NULL,    -- JSON: {endpoint, keys: {p256dh, auth}}
  title       TEXT NOT NULL,
  body        TEXT,              -- null when pushDetailed === false
  tag         TEXT NOT NULL,
  PRIMARY KEY (device_id, sig)
);
CREATE INDEX IF NOT EXISTS idx_fire_at ON scheduled_pushes(fire_at);
```

The Worker runs a cron every 5 minutes:

```sql
SELECT rowid, * FROM scheduled_pushes WHERE fire_at <= ?;
```

For each row it calls `webpush.sendNotification(subscription, {title, body, tag})`.
On success it deletes the row; on invalid-subscription error it also deletes
(graceful — the device will re-subscribe if it comes back).

### CF Worker endpoints

| Endpoint | Trigger | Body | Action |
|----------|---------|------|--------|
| `POST /schedule` | Client (`checkReminders`) | `{deviceId, subscription, title, body, tag, sig, fireAt}` | `INSERT OR REPLACE` into D1 |
| `POST /cancel` | Client (log, delete, edit) | `{deviceId, sig}` | `DELETE WHERE device_id=? AND sig=?` |
| `POST /unsubscribe` | Client (reminders off) | `{deviceId}` | `DELETE WHERE device_id=?` |
| Cron `*/5 * * * *` | CF scheduled | — | Query due rows, fire via web-push, delete fired rows |

The Worker uses the `web-push` npm package. VAPID private key stored as a
Worker secret (`VAPID_PRIVATE_KEY`). Public key is baked into the client code
(it's a public identifier by design — no security risk).

### Fire-time logic

| Item type | Fire at | Rationale |
|-----------|---------|-----------|
| Hard-due task | `dayStart(h.dueDate)` | Fires at the start of the due day, matching the `daysUntil <= 0` check in `gatherReminders` |
| Event | `h.eventTime - 3,600,000` | One hour before, matching `REMINDER_EVENT_WINDOW_MS` |

Dedupe piggybacks on the existing `state.notified` set: a push is only
scheduled when `state.notified.add(sig)` is new for the day. The `sig`
(`"${type}|${name}|${ts|eventTime}"`) already filters identical reminders
across checkReminders runs.

### Client module: `push-client.js`

Created as a new file, loaded before `reminders.js` in `index.html`.

| Function | Purpose |
|----------|---------|
| `getDeviceId()` | Returns a UUID from `localStorage` (`tings_device_id`), generated once via `crypto.randomUUID()` |
| `getPushSubscription()` | Cached subscription from `localStorage` or `null` |
| `subscribeToPush()` | Calls `reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey})` on the SW registration, stores subscription in `localStorage` |
| `unsubscribeFromPush()` | Calls `subscription.unsubscribe()` + `POST /unsubscribe` to the Worker, clears local sub |
| `schedulePush(sig, title, body, tag, fireAt)` | `POST /schedule` to the Worker with deviceId + subscription + payload |
| `cancelPush(sig)` | `POST /cancel` to the Worker with deviceId + sig |
| `initPush()` | If reminders enabled & `Notification.permission === 'granted'` & not yet subscribed → calls `subscribeToPush()`. On failure (unsupported browser, PWA not installed, permission denied) → silently no-ops. |

All network calls use `fetch` with `keepalive: true` (survives page unload) and
silently swallow errors (push is best-effort — the in-app banner is the
reliable channel).

### Integration points

| File | Change | Why |
|------|--------|-----|
| `js/push-client.js` | NEW | All push subscription/scheduling/cancellation logic |
| `js/config.js` | Add `PUSH_WORKER_URL`, `VAPID_PUBLIC_KEY`, `pushDetailed: false` to defaults | Configuration point |
| `js/reminders.js` | `checkReminders()`: after `state.notified.add(sig)` (line 118), also call `schedulePush()` for each new item. `initReminders()`: call `initPush()` | Wire push into the existing detection loop |
| `js/settings.js` | `toggleReminders(true)`: call `initPush()`. `toggleReminders(false)`: call `unsubscribeFromPush()`. Sync `pushDetailed` toggle in `syncSettingsControls()` | Ride the existing toggle lifecycle |
| `js/list-view.js` | `logTing()` (line 1022): call `cancelPush(sig)` after the task is logged | A done task should not push |
| `js/shell-ui.js` | `doNuke()` (line 275): cancel pushes for the deleted habit's sigs before the splice | A deleted habit should not push |
| `js/main.js` | Habit save path (~line 649): after saving edited data, cancel all scheduled pushes for that habit index (iterate its sigs) | Edited due/event time should reschedule on next `checkReminders()` |
| `sw.js` | Add `pushsubscriptionchange` handler: re-subscribe, store new subscription, POST unsubscibe-old + schedule-new to Worker | Apple rotates subscription keys periodically; this keeps push alive |
| `index.html` | Add `<script src="./js/push-client.js" defer>` before reminders.js (line 697). Add `pushDetailed` toggle UI at line ~504 | Script order + settings UI |
| `manifest.json` | Add `"serviceworker": {"scope": "./"}` | Safari push permission hint |

### Cancel hooks (prevent stale notifications)

| Trigger | Location | Action |
|---------|----------|--------|
| Task completed | `logTing()` at `list-view.js:1022` | `cancelPush(sig)` — computed from the habit's current state before log |
| Habit deleted | `doNuke()` at `shell-ui.js:275` | For each habit scheduled for removal, compute its reminder sigs and `cancelPush(sig)` for each |
| Reminders toggled off | `toggleReminders()` at `settings.js:155` | `unsubscribeFromPush()` — deletes ALL scheduled pushes for this device |
| Habit edited | Save path at `main.js:649` | Cancel-all-for-index, let next `checkReminders()` reschedule |

### Deployment (done once by the app owner)

```bash
# 1. Generate VAPID keys
npx web-push generate-vapid-keys

# 2. Set up D1
wrangler d1 create habits-push
wrangler d1 execute habits-push --file=worker/schema.sql

# 3. Deploy Worker
cd worker && npm install web-push
wrangler secret put VAPID_PRIVATE_KEY
wrangler deploy

# 4. Update client config
#    - Put the public key + Worker URL in js/config.js
#    - Ship the updated PWA
```

### `worker/wrangler.toml`

```toml
name = "habits-push"
main = "push-relay.js"
compatibility_date = "2025-06-23"

[[d1_databases]]
binding = "DB"
database_name = "habits-push"
database_id = "<from-wrangler-d1-create>"

[triggers]
crons = ["*/5 * * * *"]
```

### iOS Safari specifics

- iOS 17.4+ supports Web Push **only** when the PWA is installed to the Home
  Screen. If opened in Safari (not installed), `PushManager.subscribe()` will
  throw or resolve to a non-persistent subscription. `subscribeToPush()`
  catches this and no-ops silently — the in-app banner still works.
- On first enable, Safari shows a system permission prompt (same as a native
  app). This fires from the user gesture in `toggleReminders()`.
- Apple periodically rotates push subscription keys (`pushsubscriptionchange`
  event). The SW handler re-subscribes and re-posts scheduled pushes seamlessly.

### Free-tier capacity

- D1 free: 5M rows read/day, 100k rows written/day, 5GB storage.
- Per user: ~2-5 scheduled pushes at a time. Each schedule = 1 write. Each cron
  run = ~N reads + N deletes (N = number of pushes due in that 5-min window).
- For a personal PWA with hundreds of users: comfortable.
- For thousands of users: D1 is pay-per-use and still very cheap
  ($0.001/million read rows).

### Key design decisions

1. **No cron on the Worker (Option A — rejected).** The simple relay approach
   (push only fires when the app is open) was considered but rejected because
   it cannot fire at the exact time. The current architecture uses Option B:
   cron + server-side state.
2. **D1 over KV.** KV's 1000-list-ops/day free limit is too tight for a
   per-minute cron. D1 has no such limit and provides strong consistency,
   eliminating write conflicts when multiple users schedule for the same
   moment.
3. **Generic payloads by default.** Most users get `"Task due today"` without
   any habit-specific text. This preserves the app's on-device-only promise.
   Users who want richer notifications opt in explicitly.
4. **5-minute cron granularity.** Notifications fire within 5 minutes of the
   exact due time. This is close enough for tasks and event reminders;
   sub-minute precision isn't needed for a habits app.

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
| 8 | Web Push (exact-time, all users) | `worker/push-relay.js`, `js/push-client.js`, D1 schema, cron | 6 |

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