// Scenario tests for the Today agenda pipeline (buildTodayAgenda/buildTodayTimeline)
// and the home-card agenda pill rendering. These are the regression guards for:
//
//   Issue 1 — fill items must honour their per-item allowedTimeStart/End window.
//             A habit allowed 10am-8pm with 12am-7am blocked must NEVER be
//             suggested at 7am/9am; it lands at 10am (its window start).
//
//   Issue 2 — a timed task planned today must show exactly ONE "scheduled" pill
//             on its home card, not two identical purple calendar-time pills.
//
//   Issue 8 — a late/overnight allowed-time window (e.g. 10pm-11am) still
//             surfaces a suggested time at its window start even when today's
//             availability budget is spent before the window opens. Overnight
//             windows extend into tomorrow as one span.
//
// Each scenario seeds localStorage, reloads, and asserts against the live
// in-page pure functions (via page.evaluate) plus the rendered DOM for pills.
// Run with:  node habits/tests/agenda-scenarios.js   (after starting the server)
//            python3 -m http.server 4176  (from the habits/ directory)

const { chromium } = require('playwright');

const BASE = process.env.AGENDA_URL || 'http://127.0.0.1:4176/';

// ---- time helpers (all anchored to "today, local") ----
function atTime(hour, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}
function todayKey() {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d.toISOString().slice(0, 10);
}

// A minimal but valid habit/task record. Defaults mirror normalize().
function base(props) {
  return Object.assign({
    name: 'item',
    type: 'keepup',
    target: 1,
    flexibilityDays: 0,
    durationMinutes: 30,
    allowedTimeStart: null,
    allowedTimeEnd: null,
    preferredTimeStart: null,
    preferredTimeEnd: null,
    lastLog: null,
    logs: [],
    emoji: '',
    pinned: false,
    sample: false,
    snoozedUntil: null,
    topics: [],
    allowedWeekdays: [],
    allowedMonthDays: [],
    preferredWeekdays: [],
    preferredMonthDays: [],
    dueDate: null,
    eventTime: null,
    hardDue: false,
    markDone: true,
    createdAt: Date.now()
  }, props);
}

function defaultSettings(overrides = {}) {
  return Object.assign({
    preset: 'todayFirst',
    showWeekOnHome: false,
    focus: 'balanced',
    availabilityMinutes: [600, 600, 600, 600, 600, 600, 600],
    availabilityOverrides: {},
    blockedTimes: [],
    showScheduledTasksInAgenda: true,
    showDueTasksInAgenda: true,
    showPlannedItemsInAgenda: true,
    showDueHabitsInAgenda: true,
    showTaskDateOnCards: true,
    showPlansOnCards: true,
    showTimeWindowOnCards: true
  }, overrides);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const errors = [];
  page.on('pageerror', err => errors.push('pageerror: ' + err.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  const failures = [];
  function check(name, cond, detail) {
    if (cond) {
      console.log(`  ok  - ${name}`);
    } else {
      failures.push(`${name}${detail ? ' :: ' + detail : ''}`);
      console.log(`  FAIL- ${name}${detail ? ' :: ' + detail : ''}`);
    }
  }

  // Helper: seed storage, reload, return nothing.
  async function seed(data, settings) {
    await page.evaluate(({ d, s }) => {
      localStorage.clear();
      localStorage.setItem('tings_v2', JSON.stringify(d));
      localStorage.setItem('tings_app_settings_v2', JSON.stringify(s));
    }, { d: data, s: settings });
    await page.reload({ waitUntil: 'networkidle' });
  }

  // Helper: run buildTodayAgenda+buildTodayTimeline in-page with a fixed "now".
  // We freeze the global Date constructor for the call so EVERY internal
  // Date.now()/new Date() (slot clipping, todayIso, daysSince, ...) agrees on
  // the same instant — otherwise buildOpenAgendaSlots secretly uses real
  // wall-clock time and tests become time-of-day flaky.
  async function timelineFor(nowTs, reRenderDom = false) {
    return page.evaluate(({ now, reRenderDom }) => {
      const RealDate = Date;
      function FrozenDate(...args) {
        if (args.length === 0) return new RealDate(now);
        return new RealDate(...args);
      }
      FrozenDate.now = () => now;
      FrozenDate.parse = RealDate.parse;
      FrozenDate.UTC = RealDate.UTC;
      Object.setPrototypeOf(FrozenDate, RealDate);
      FrozenDate.prototype = RealDate.prototype;
      const orig = globalThis.Date;
      globalThis.Date = FrozenDate;
      let out;
      try {
        const data = JSON.parse(localStorage.getItem('tings_v2'));
        const settings = JSON.parse(localStorage.getItem('tings_app_settings_v2'));
        const agenda = buildTodayAgenda(data, settings);
        const rows = buildTodayTimeline(agenda, now);
        out = rows.map(r => ({
          kind: r.kind,
          name: r.h.name,
          i: r.i,
          startMs: r.start,
          endMs: r.end,
          startLabel: new RealDate(r.start).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
          endLabel: new RealDate(r.end).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
        }));
        if (reRenderDom && typeof render === 'function') render();
      } finally {
        globalThis.Date = orig;
      }
      return out;
    }, { now: nowTs, reRenderDom });
  }

  function toMs(date) { return date.getTime(); }

  await page.goto(BASE, { waitUntil: 'networkidle' });

  // ==========================================================================
  // ISSUE 1 — per-item time window must govern fill placement
  // ==========================================================================
  console.log('\n[Issue 1] per-item allowed time window');

  // (a) THE REPORTED BUG: blocked 12am-7am, habit allowed 10am-8pm, "now"=9am.
  //     Must land at 10am, never 7am or 9am.
  {
    await seed(
      [base({
        name: 'Workout windowed',
        type: 'keepup', target: 1,
        durationMinutes: 45,
        allowedTimeStart: 600, allowedTimeEnd: 1200, // 10:00 - 20:00
        lastLog: atTime(9) - 2 * 86400000,
        logs: [atTime(9) - 2 * 86400000]
      })],
      defaultSettings({ blockedTimes: [{ label: 'sleep', days: [], start: 0, end: 420 }] })
    );
    const rows = await timelineFor(atTime(9, 0), true);
    const fill = rows.find(r => r.name === 'Workout windowed');
    check('1a window pushes fill to 10am (not 7am/9am)',
      Boolean(fill) && fill.startLabel === '10:00 AM',
      fill ? `got start=${fill.startLabel}` : 'fill missing');
    check('1a fill still ends inside window (<=8pm)',
      fill && fill.endMs <= atTime(20, 0) + 60000, fill ? `end=${fill.endLabel}` : 'fill missing');
    // DOM: the card must surface the suggested time and it must be >= 10am.
    const pillText = await page.locator('.ting-card:has-text("Workout windowed") .context-pill.agenda-suggested').first().textContent().catch(() => null);
    check('1a card agenda-suggested pill renders',
      Boolean(pillText), `pill=${JSON.stringify(pillText)}`);
  }

  // (b) "now" is BEFORE the block ends (e.g. 5:30am). Still must not place before 10am.
  {
    const rows = await timelineFor(atTime(5, 30));
    const fill = rows.find(r => r.name === 'Workout windowed');
    check('1b early morning now still defers to 10am window',
      fill && fill.startMs >= atTime(10, 0),
      fill ? `got start=${fill.startLabel}` : 'fill missing');
  }

  // (c) Item too big for its own window is dropped entirely (no placement).
  {
    await seed(
      [base({
        name: 'Big windowed',
        type: 'keepup', target: 1,
        durationMinutes: 45,
        allowedTimeStart: 600, allowedTimeEnd: 620, // 10:00-10:20 = 20min, < 45min
        lastLog: atTime(9) - 2 * 86400000,
        logs: [atTime(9) - 2 * 86400000]
      })],
      defaultSettings({ blockedTimes: [{ label: 'sleep', days: [], start: 0, end: 420 }] })
    );
    const rows = await timelineFor(atTime(9, 0));
    const fill = rows.find(r => r.name === 'Big windowed');
    check('1c item too large for window is dropped', !fill, fill ? `unexpected start=${fill.startLabel}` : '');
  }

  // (d) Item too big for its window is SKIPPED but a following windowless item
  //     still gets placed in the same slot (no starvation / no clock leak).
  {
    await seed(
      [
        base({
          name: 'Big windowed', type: 'keepup', target: 1, durationMinutes: 45,
          allowedTimeStart: 600, allowedTimeEnd: 620,
          lastLog: atTime(9) - 2 * 86400000, logs: [atTime(9) - 2 * 86400000]
        }),
        base({
          name: 'Plain fill', type: 'keepup', target: 1, durationMinutes: 20,
          lastLog: atTime(9) - 2 * 86400000, logs: [atTime(9) - 2 * 86400000]
        })
      ],
      defaultSettings({ blockedTimes: [{ label: 'sleep', days: [], start: 0, end: 420 }] })
    );
    const rows = await timelineFor(atTime(9, 0));
    const plain = rows.find(r => r.name === 'Plain fill');
    check('1d following windowless item still placed after a skipped windowed item',
      Boolean(plain), plain ? `start=${plain.startLabel}` : 'plain missing');
  }

  // (e) Window exactly fits the duration -> placed at window start.
  {
    await seed(
      [base({
        name: 'Exact fit', type: 'keepup', target: 1, durationMinutes: 30,
        allowedTimeStart: 600, allowedTimeEnd: 630, // 10:00-10:30 = 30min
        lastLog: atTime(9) - 2 * 86400000, logs: [atTime(9) - 2 * 86400000]
      })],
      defaultSettings()
    );
    const rows = await timelineFor(atTime(9, 0));
    const fill = rows.find(r => r.name === 'Exact fit');
    check('1e exact-fit window places at window start',
      fill && fill.startLabel === '10:00 AM' && fill.endLabel === '10:30 AM',
      fill ? `${fill.startLabel}-${fill.endLabel}` : 'fill missing');
  }

  // (f) Overnight window (23:00-02:00) is treated as one span into tomorrow.
  {
    await seed(
      [base({
        name: 'Late overnight', type: 'keepup', target: 1, durationMinutes: 30,
        allowedTimeStart: 1380, allowedTimeEnd: 120, // 23:00 - 02:00
        lastLog: atTime(9) - 2 * 86400000, logs: [atTime(9) - 2 * 86400000]
      })],
      defaultSettings()
    );
    const rows = await timelineFor(atTime(22, 0)); // now=10pm, before window start
    const fill = rows.find(r => r.name === 'Late overnight');
    check('1f overnight window defers to 11pm start',
      fill && fill.startLabel === '11:00 PM',
      fill ? `start=${fill.startLabel}` : 'fill missing');
  }

  // (g) No-window item still uses slot start (regression guard).
  {
    await seed(
      [base({
        name: 'Plain', type: 'keepup', target: 1, durationMinutes: 15,
        lastLog: atTime(9) - 2 * 86400000, logs: [atTime(9) - 2 * 86400000]
      })],
      defaultSettings()
    );
    const rows = await timelineFor(atTime(9, 0));
    const fill = rows.find(r => r.name === 'Plain');
    check('1g windowless item placed at slot start (now ceil)',
      fill && Math.abs(fill.startMs - atTime(9, 0)) < 5 * 60000,
      fill ? `start=${fill.startLabel}` : 'fill missing');
  }

  // ==========================================================================
  // ISSUE 2 — duplicate scheduled pill on home cards
  // ==========================================================================
  console.log('\n[Issue 2] duplicate scheduled pill');

  // (a) THE REPORTED BUG: timed task today shows exactly ONE scheduled pill.
  {
    const scheduled = atTime(10, 45);
    await seed(
      [base({
        name: 'Timed task 1045', type: 'task', target: null,
        durationMinutes: 30, eventTime: scheduled, dueDate: atTime(0)
      })],
      defaultSettings()
    );
    const count = await page.locator('.ting-card:has-text("Timed task 1045") .context-pill.scheduled').count();
    check('2a timed task card has exactly one scheduled pill', count === 1, `count=${count}`);

    // The remaining pill must still show the right time (not be over-suppressed).
    const text = await page.locator('.ting-card:has-text("Timed task 1045") .context-pill.scheduled').first().textContent();
    check('2a scheduled pill shows the 10:45 AM time', /10:45\s?AM/i.test(text || ''), `text=${JSON.stringify(text)}`);
  }

  // (b) Non-today timed task is NOT in today's agenda -> cardMeta pill is the
  //     only one and must still render (suppress must not fire for non-agenda).
  {
    const tomorrow = atTime(10, 45) + 86400000;
    await seed(
      [base({
        name: 'Tomorrows task', type: 'task', target: null,
        durationMinutes: 30, eventTime: tomorrow, dueDate: tomorrow
      })],
      defaultSettings()
    );
    const count = await page.locator('.ting-card:has-text("Tomorrows task") .context-pill.scheduled').count();
    check('2b non-today timed task keeps its single scheduled pill', count === 1, `count=${count}`);
  }

  // (c) A fill item shows the agenda-suggested pill (not a scheduled pill).
  {
    await seed(
      [base({
        name: 'Due habit fill', type: 'keepup', target: 1, durationMinutes: 20,
        lastLog: atTime(9) - 2 * 86400000, logs: [atTime(9) - 2 * 86400000]
      })],
      defaultSettings()
    );
    const suggested = await page.locator('.ting-card:has-text("Due habit fill") .context-pill.agenda-suggested').count();
    const scheduled = await page.locator('.ting-card:has-text("Due habit fill") .context-pill.scheduled').count();
    check('2c fill item renders agenda-suggested pill', suggested === 1, `suggested=${suggested}`);
    check('2c fill item does not render a scheduled pill', scheduled === 0, `scheduled=${scheduled}`);
  }

  // ==========================================================================
  // BONUS — scheduled task ordering + non-overlap + summary
  // ==========================================================================
  console.log('\n[bonus] ordering / non-overlap / summary');

  // (a) Two timed tasks order earliest-first; a fill does not overlap them.
  {
    await seed(
      [
        base({ name: 'Late task', type: 'task', target: null, durationMinutes: 30, eventTime: atTime(14, 0), dueDate: atTime(0) }),
        base({ name: 'Early task', type: 'task', target: null, durationMinutes: 30, eventTime: atTime(11, 0), dueDate: atTime(0) }),
        base({ name: 'Filler', type: 'keepup', target: 1, durationMinutes: 30, lastLog: atTime(9) - 2 * 86400000, logs: [atTime(9) - 2 * 86400000] })
      ],
      defaultSettings()
    );
    const rows = await timelineFor(atTime(9, 0));
    const names = rows.map(r => r.name);
    const earlyIdx = names.indexOf('Early task');
    const lateIdx = names.indexOf('Late task');
    check('bonus a scheduled tasks ordered earliest-first', earlyIdx !== -1 && lateIdx !== -1 && earlyIdx < lateIdx, JSON.stringify(names));

    // Filler must end before Early task starts (no overlap).
    const filler = rows.find(r => r.name === 'Filler');
    const early = rows.find(r => r.name === 'Early task');
    check('bonus a fill does not overlap the next scheduled task',
      filler && early && filler.endMs <= early.startMs,
      filler && early ? `filler.end=${filler.endLabel} early.start=${early.startLabel}` : 'missing');
  }

  // (b) Blocked time carves the slot: no row may start inside the block.
  {
    await seed(
      [
        base({ name: 'Plain', type: 'keepup', target: 1, durationMinutes: 30, lastLog: atTime(9) - 2 * 86400000, logs: [atTime(9) - 2 * 86400000] })
      ],
      defaultSettings({ blockedTimes: [{ label: 'lunch', days: [], start: 720, end: 780 }] }) // 12:00-13:00
    );
    const rows = await timelineFor(atTime(9, 0));
    const lunchStart = atTime(12, 0), lunchEnd = atTime(13, 0);
    const violating = rows.filter(r => r.startMs >= lunchStart && r.startMs < lunchEnd);
    check('bonus b no row starts inside the blocked lunch window',
      violating.length === 0, JSON.stringify(violating.map(r => r.startLabel)));
  }

  // ==========================================================================
  // ISSUE 3 — priority (P0–P5) arbitrates who claims today's limited time
  // ==========================================================================
  console.log('\n[Issue 3] priority drives agenda capacity allocation');

  // (a) THE KEY BEHAVIOUR: capacity fits only one item; P0 claims it, P5 drops.
  {
    const ago = atTime(9) - 2 * 86400000;
    await seed(
      [
        base({ name: 'P5 reading', type: 'keepup', target: 1, durationMinutes: 50, priority: 5, lastLog: ago, logs: [ago] }),
        base({ name: 'P0 cardio', type: 'keepup', target: 1, durationMinutes: 50, priority: 0, lastLog: ago, logs: [ago] })
      ],
      // 60 min of capacity -> only one 50-min item fits.
      defaultSettings({ availabilityMinutes: [60, 60, 60, 60, 60, 60, 60] })
    );
    const rows = await timelineFor(atTime(9, 0));
    const names = rows.filter(r => r.kind === 'fill').map(r => r.name);
    check('3a P0 keeps the slot under tight capacity',
      names.includes('P0 cardio'), JSON.stringify(names));
    check('3a P5 is the one dropped when capacity overflows',
      !names.includes('P5 reading'), JSON.stringify(names));
  }

  // (b) Within the same priority band, home rank order is preserved.
  {
    const ago = atTime(9) - 2 * 86400000;
    await seed(
      [
        // Both P2 (default). "First" is created earlier so it ranks first on home.
        base({ name: 'First', type: 'keepup', target: 1, durationMinutes: 20, priority: 2, lastLog: ago, logs: [ago], createdAt: 1000 }),
        base({ name: 'Second', type: 'keepup', target: 1, durationMinutes: 20, priority: 2, lastLog: ago, logs: [ago], createdAt: 2000 })
      ],
      defaultSettings()
    );
    const rows = await timelineFor(atTime(9, 0));
    const fills = rows.filter(r => r.kind === 'fill').map(r => r.name);
    check('3b same priority preserves home order in agenda fill',
      fills.indexOf('First') !== -1 && fills.indexOf('Second') !== -1 && fills.indexOf('First') < fills.indexOf('Second'),
      JSON.stringify(fills));
  }

  // (c) Legacy records (no priority field) migrate to P2 and compete fairly.
  {
    const ago = atTime(9) - 2 * 86400000;
    await page.evaluate(({ ago }) => {
      localStorage.clear();
      localStorage.setItem('tings_app_settings_v2', JSON.stringify({
        preset: 'todayFirst', focus: 'balanced',
        availabilityMinutes: [600, 600, 600, 600, 600, 600, 600], availabilityOverrides: {},
        blockedTimes: [], showScheduledTasksInAgenda: true, showDueTasksInAgenda: true,
        showPlannedItemsInAgenda: true, showDueHabitsInAgenda: true, showTaskDateOnCards: true
      }));
      // Deliberately OMIT the priority field to exercise migration.
      localStorage.setItem('tings_v2', JSON.stringify([
        { name: 'Legacy no priority', type: 'keepup', target: 1, durationMinutes: 20, lastLog: ago, logs: [ago], emoji: '', pinned: false, sample: false, snoozedUntil: null, topics: [], createdAt: 1000 }
      ]));
    }, { ago });
    await page.reload({ waitUntil: 'networkidle' });
    const normalized = await page.evaluate(() => {
      const rows = buildTodayTimeline(buildTodayAgenda(JSON.parse(localStorage.getItem('tings_v2')), JSON.parse(localStorage.getItem('tings_app_settings_v2'))), new Date().setHours(9,0,0,0));
      // The app never reads .priority directly; it goes through effectivePriority,
      // which is what makes legacy (field-less) records migrate to the default.
      const item = JSON.parse(localStorage.getItem('tings_v2'))[0];
      return { effective: effectivePriority(item), rawHasField: Object.prototype.hasOwnProperty.call(item, 'priority'), placed: rows.some(r => r.h.name === 'Legacy no priority') };
    });
    check('3c legacy item migrates to default P2', normalized.effective === 2, `effective=${normalized.effective}`);
    check('3c raw legacy record had no priority field', normalized.rawHasField === false, `rawHasField=${normalized.rawHasField}`);
    check('3c legacy item still placed in agenda', normalized.placed, '');
  }

  // (d) Card priority pill renders with the right tone class per level.
  {
    const ago = atTime(9) - 2 * 86400000;
    await seed(
      [
        base({ name: 'Crit', type: 'keepup', target: 1, durationMinutes: 20, priority: 0, lastLog: ago, logs: [ago] }),
        base({ name: 'Low', type: 'keepup', target: 1, durationMinutes: 20, priority: 5, lastLog: ago, logs: [ago] })
      ],
      defaultSettings()
    );
    const critStyle = await page.locator('.ting-card:has-text("Crit")').first().getAttribute('style');
    const lowStyle = await page.locator('.ting-card:has-text("Low")').first().getAttribute('style');
    check('3d P0 card left bar shows --card-priority:var(--red-icon)', Boolean(critStyle && critStyle.includes('--card-priority:var(--red-icon)')), 'style=' + critStyle);
    check('3d P5 card left bar shows --card-priority:color-mix(...,35%...)', Boolean(lowStyle && lowStyle.includes('--card-priority:color-mix(in srgb, var(--text3) 35%, transparent)')), 'style=' + lowStyle);
  }

  // ==========================================================================
  // ISSUE 4 — planned items must always get a suggested time, even when the
  //          day is fragmented by scheduled tasks or blocked time so no single
  //          open slot is large enough. Total availability covers them, so the
  //          home card should still surface an agenda-suggested pill.
  // ==========================================================================
  console.log('\n[Issue 4] fragmented day still suggests a time');

  // (a) THE REPORTED BUG: two 60-min planned items, 120 min of availability,
  //     but a mid-morning block splits the day into a 30-min slot and a 90-min
  //     slot. The second item cannot fit in any single open slot after the
  //     first claims the big one — it must still get a soft suggested time.
  {
    const planTs = atTime(9);
    await seed(
      [
        base({ name: 'Plan A 60m', type: 'keepup', target: 7, durationMinutes: 60, logs: [{ ts: planTs, plan: true }] }),
        base({ name: 'Plan B 60m', type: 'keepup', target: 7, durationMinutes: 60, logs: [{ ts: planTs, plan: true }] })
      ],
      // 120 min of availability, but blocked 9:30-10:30 fragments the morning.
      defaultSettings({
        availabilityMinutes: [120, 120, 120, 120, 120, 120, 120],
        blockedTimes: [{ label: 'meeting', days: [], start: 570, end: 630 }] // 9:30-10:30
      })
    );
    const rows = await timelineFor(atTime(9, 0), true);
    const a = rows.find(r => r.name === 'Plan A 60m');
    const b = rows.find(r => r.name === 'Plan B 60m');
    check('4a Plan A gets a suggested time', Boolean(a), a ? `start=${a.startLabel}` : 'missing');
    check('4a Plan B gets a suggested time even though no single slot fits it',
      Boolean(b), b ? `start=${b.startLabel}` : 'missing');
    check('4a Plan B does not overlap Plan A',
      Boolean(a && b && (b.startMs >= a.endMs || a.startMs >= b.endMs)),
      a && b ? `A=${a.startLabel}-${a.endLabel} B=${b.startLabel}-${b.endLabel}` : 'missing');

    // DOM: both home cards must surface the agenda-suggested pill.
    const aPill = await page.locator('.ting-card:has-text("Plan A 60m") .context-pill.agenda-suggested').count();
    const bPill = await page.locator('.ting-card:has-text("Plan B 60m") .context-pill.agenda-suggested').count();
    check('4a Plan A card renders agenda-suggested pill', aPill === 1, `count=${aPill}`);
    check('4a Plan B card renders agenda-suggested pill', bPill === 1, `count=${bPill}`);
  }

  // (b) Windowed item that cannot fit its own window is STILL dropped (the
  //     fallback only rescues windowless items, never at the cost of breaking
  //     a user-set allowedTimeStart/End).
  {
    const ago = atTime(9) - 2 * 86400000;
    await seed(
      [base({ name: 'Big windowed', type: 'keepup', target: 1, durationMinutes: 45,
        allowedTimeStart: 600, allowedTimeEnd: 620, // 10:00-10:20 = 20min, < 45min
        lastLog: ago, logs: [ago] })],
      defaultSettings()
    );
    const rows = await timelineFor(atTime(9, 0));
    const fill = rows.find(r => r.name === 'Big windowed');
    check('4b windowed item too large for its window stays dropped (no fallback)',
      !fill, fill ? `unexpected start=${fill.startLabel}` : '');
  }

  // ==========================================================================
  // ISSUE 5 — home list and Today agenda must agree on "today". A habit whose
  //          strict allowedTimeStart/End window has closed for today cannot be
  //          scheduled, so it must NOT be categorized as "today" nor included
  //          in the agenda's capacity math. A preferredTimeStart/End window is
  //          soft and must NOT close the day.
  // ==========================================================================
  console.log('\n[Issue 5] closed allowed-time window drops habit from today');

  // (a) Walk allowed 6-9am, overdue, "now"=3pm. Must be overdue (cat 1), not
  //     today, and excluded from the agenda entirely.
  {
    const ago = atTime(9) - 3 * 86400000;
    await seed(
      [base({ name: 'Walk strict 6-9', type: 'keepup', target: 1, durationMinutes: 30,
        allowedTimeStart: 360, allowedTimeEnd: 540, // 6:00-9:00
        lastLog: ago, logs: [ago] })],
      defaultSettings()
    );
    const cat = await page.evaluate(now => {
      const RealDate = Date;
      function FrozenDate(...args) { return args.length === 0 ? new RealDate(now) : new RealDate(...args); }
      FrozenDate.now = () => now; FrozenDate.parse = RealDate.parse; FrozenDate.UTC = RealDate.UTC;
      Object.setPrototypeOf(FrozenDate, RealDate); FrozenDate.prototype = RealDate.prototype;
      const orig = globalThis.Date; globalThis.Date = FrozenDate;
      try {
        const data = JSON.parse(localStorage.getItem('tings_v2'));
        const s = JSON.parse(localStorage.getItem('tings_app_settings_v2'));
        return todayCategory(data[0], s);
      } finally { globalThis.Date = orig; }
    }, atTime(15, 0));
    check('5a strict-window habit categorized as overdue (1) once window closes',
      cat === 1, `cat=${cat}`);

    const rows = await timelineFor(atTime(15, 0));
    const fill = rows.find(r => r.name === 'Walk strict 6-9');
    check('5a strict-window habit excluded from Today agenda once window closes',
      !fill, fill ? `unexpected start=${fill.startLabel}` : '');
  }

  // (b) Same scenario but with preferredTimeStart/End instead of allowed — the
  //     day stays open. The habit remains "today" and gets an agenda row even
  //     at 3pm (just not at the preferred time).
  {
    const ago = atTime(9) - 3 * 86400000;
    await seed(
      [base({ name: 'Walk preferred 6-9', type: 'keepup', target: 1, durationMinutes: 30,
        preferredTimeStart: 360, preferredTimeEnd: 540,
        lastLog: ago, logs: [ago] })],
      defaultSettings()
    );
    const cat = await page.evaluate(now => {
      const RealDate = Date;
      function FrozenDate(...args) { return args.length === 0 ? new RealDate(now) : new RealDate(...args); }
      FrozenDate.now = () => now; FrozenDate.parse = RealDate.parse; FrozenDate.UTC = RealDate.UTC;
      Object.setPrototypeOf(FrozenDate, RealDate); FrozenDate.prototype = RealDate.prototype;
      const orig = globalThis.Date; globalThis.Date = FrozenDate;
      try {
        const data = JSON.parse(localStorage.getItem('tings_v2'));
        const s = JSON.parse(localStorage.getItem('tings_app_settings_v2'));
        return todayCategory(data[0], s);
      } finally { globalThis.Date = orig; }
    }, atTime(15, 0));
    check('5b preferred-window habit stays today (0) past the preferred time',
      cat === 0, `cat=${cat}`);

    const rows = await timelineFor(atTime(15, 0));
    const fill = rows.find(r => r.name === 'Walk preferred 6-9');
    check('5b preferred-window habit still gets an agenda row late in the day',
      Boolean(fill), fill ? `start=${fill.startLabel}` : 'missing');
  }

  // (c) Inside the allowed window the habit is still today and gets placed.
  {
    const ago = atTime(9) - 3 * 86400000;
    await seed(
      [base({ name: 'Walk strict 6-9', type: 'keepup', target: 1, durationMinutes: 30,
        allowedTimeStart: 360, allowedTimeEnd: 540,
        lastLog: ago, logs: [ago] })],
      defaultSettings()
    );
    const cat = await page.evaluate(now => {
      const RealDate = Date;
      function FrozenDate(...args) { return args.length === 0 ? new RealDate(now) : new RealDate(...args); }
      FrozenDate.now = () => now; FrozenDate.parse = RealDate.parse; FrozenDate.UTC = RealDate.UTC;
      Object.setPrototypeOf(FrozenDate, RealDate); FrozenDate.prototype = RealDate.prototype;
      const orig = globalThis.Date; globalThis.Date = FrozenDate;
      try {
        const data = JSON.parse(localStorage.getItem('tings_v2'));
        const s = JSON.parse(localStorage.getItem('tings_app_settings_v2'));
        return todayCategory(data[0], s);
      } finally { globalThis.Date = orig; }
    }, atTime(7, 0));
    check('5c strict-window habit is today (0) while inside its window',
      cat === 0, `cat=${cat}`);
  }

  // ==========================================================================
  // ISSUE 6 — "do it early" is no longer its own section. An upcoming item
  //          whose target day is overloaded (and that is allowed today + has
  //          flexibility) is pulled into the agenda AND shown under "today"
  //          with its "early" pill — but ONLY when it actually earns an agenda
  //          row today. If today's capacity is already spoken for, the item is
  //          dropped from the agenda and falls back to its native "upcoming"
  //          section with no early pill.
  // ==========================================================================
  console.log('\n[Issue 6] do-early merges into today (capacity-gated)');

  // Helper: walk back from a card to its nearest section-header label. The
  // card lives inside a .swipe-row, so climb to that row first.
  async function sectionOf(cardText){
    return page.locator(`.ting-card:has-text("${cardText}")`).first().evaluate(card => {
      const row = card.closest('.swipe-row') || card.parentElement;
      let node = row ? row.previousElementSibling : null;
      while(node){
        if(node.classList && node.classList.contains('section-header'))return node.textContent.trim();
        node = node.previousElementSibling;
      }
      return null;
    });
  }

  // (a) Pulled forward: target day overloaded, today has room -> the item
  //     earns an agenda row, lives under "today", and shows BOTH the early
  //     pill and an agenda-suggested time pill.
  {
    const targetTs = atTime(9) + 2 * 86400000;
    const targetKey = new Date(targetTs); targetKey.setHours(12,0,0,0);
    const targetKeyStr = targetKey.toISOString().slice(0,10);
    const todayStr = todayKey();
    await seed(
      [
        base({ name: 'Laundry upcoming', type: 'keepup', target: 2, flexibilityDays: 2, durationMinutes: 30,
          lastLog: atTime(9), logs: [atTime(9)] }),
        base({ name: 'Packed day meeting', type: 'task', target: null, durationMinutes: 50,
          dueDate: targetTs, eventTime: null })
      ],
      defaultSettings({ availabilityOverrides: { [todayStr]: 120, [targetKeyStr]: 30 } })
    );
    const rows = await timelineFor(atTime(9, 0), true);
    const fill = rows.find(r => r.name === 'Laundry upcoming');
    check('6a do-early item pulled into today agenda', Boolean(fill), fill ? `start=${fill.startLabel}` : 'missing');

    const sec = await sectionOf('Laundry upcoming');
    check('6a do-early card sits under the today section', sec === 'today', `section=${sec}`);

    const earlyPill = await page.locator('.ting-card:has-text("Laundry upcoming") .context-pill:has-text("early")').count();
    const suggestedPill = await page.locator('.ting-card:has-text("Laundry upcoming") .context-pill.agenda-suggested').count();
    check('6a do-early card shows the early pill', earlyPill === 1, `early=${earlyPill}`);
    check('6a do-early card shows an agenda-suggested time pill', suggestedPill >= 1, `suggested=${suggestedPill}`);

    // The standalone "do it early" header must be gone.
    const staleHeader = await page.locator('.section-header:text("do it early")').count();
    check('6a no standalone "do it early" section header remains', staleHeader === 0, `count=${staleHeader}`);
  }

  // (b) Dropped: today is full, so the early item never gets a row. It must
  //     fall back to "upcoming" and carry NO early pill (we never promise time
  //     the day cannot give).
  {
    const targetTs = atTime(9) + 2 * 86400000;
    const targetKey = new Date(targetTs); targetKey.setHours(12,0,0,0);
    const targetKeyStr = targetKey.toISOString().slice(0,10);
    const todayStr = todayKey();
    await seed(
      [
        // P0 due-today item that eats all of today's 100 minutes first.
        base({ name: 'Due today filler', type: 'keepup', target: 1, durationMinutes: 100, priority: 0,
          lastLog: atTime(9) - 2 * 86400000, logs: [atTime(9) - 2 * 86400000] }),
        // Low-priority upcoming item that WOULD be do-early but cannot fit.
        base({ name: 'Laundry upcoming', type: 'keepup', target: 2, flexibilityDays: 2, durationMinutes: 30, priority: 5,
          lastLog: atTime(9), logs: [atTime(9)] }),
        base({ name: 'Packed day meeting', type: 'task', target: null, durationMinutes: 50,
          dueDate: targetTs, eventTime: null })
      ],
      defaultSettings({ availabilityOverrides: { [todayStr]: 100, [targetKeyStr]: 30 } })
    );
    const rows = await timelineFor(atTime(9, 0));
    const fill = rows.find(r => r.name === 'Laundry upcoming');
    check('6b do-early item dropped from agenda when today is full', !fill, fill ? `unexpected start=${fill.startLabel}` : '');

    const sec = await sectionOf('Laundry upcoming');
    check('6b dropped do-early card falls back to upcoming section', sec === 'upcoming', `section=${sec}`);

    const earlyPill = await page.locator('.ting-card:has-text("Laundry upcoming") .context-pill:has-text("early")').count();
    check('6b dropped do-early card has no early pill', earlyPill === 0, `early=${earlyPill}`);
  }

  // ==========================================================================
  // ISSUE 7 — the agenda SOFTLY honours preferredTimeStart. A fill whose
  //          preferred time is later than the clock is nudged to that time when
  //          the whole session still fits; otherwise it falls back to the
  //          clock placement. The hard allowedTimeStart/End still wins.
  // ==========================================================================
  console.log('\n[Issue 7] preferred-time soft nudge in agenda placement');

  // (a) preferredTimeStart at 2pm, now 9am -> placed at 2pm (not 9am).
  {
    await seed(
      [base({ name: 'Prefer afternoon', type: 'keepup', target: 1, durationMinutes: 30,
        preferredTimeStart: 840, preferredTimeEnd: 1020, // 14:00 - 17:00
        lastLog: atTime(9) - 2 * 86400000, logs: [atTime(9) - 2 * 86400000] })],
      defaultSettings()
    );
    const rows = await timelineFor(atTime(9, 0));
    const fill = rows.find(r => r.name === 'Prefer afternoon');
    check('7a fill nudged to preferred 2:00 PM start',
      fill && fill.startLabel === '2:00 PM',
      fill ? `start=${fill.startLabel}` : 'missing');
  }

  // (b) A late preferred time that DOES fit inside today's open time is honored
  //     (it is no longer falsely rejected just because it sits past the point
  //     where a tight availability budget used to clip the slots). The day is
  //     open to midnight, so an 11pm preference lands at 11pm.
  {
    await seed(
      [base({ name: 'Prefer late', type: 'keepup', target: 1, durationMinutes: 30,
        preferredTimeStart: 1380, preferredTimeEnd: 1440, // 23:00
        lastLog: atTime(9) - 2 * 86400000, logs: [atTime(9) - 2 * 86400000] })],
      defaultSettings()
    );
    const rows = await timelineFor(atTime(9, 0));
    const fill = rows.find(r => r.name === 'Prefer late');
    check('7b late preferred time is honored when the open day reaches it',
      fill && fill.startLabel === '11:00 PM',
      fill ? `start=${fill.startLabel}` : 'missing');
  }

  // (b2) Guard: the nudge still respects a HARD limit. When a blocked interval
  //      covers the preferred time, the preferred time cannot fit and the fill
  //      falls back to the clock (now ceil) — the nudge never overrides blocks.
  {
    await seed(
      [base({ name: 'Prefer blocked hour', type: 'keepup', target: 1, durationMinutes: 30,
        preferredTimeStart: 1380, preferredTimeEnd: 1440, // 23:00
        lastLog: atTime(9) - 2 * 86400000, logs: [atTime(9) - 2 * 86400000] })],
      defaultSettings({ blockedTimes: [{ label: 'wind-down', days: [], start: 1380, end: 1440 }] }) // 23:00-24:00
    );
    const rows = await timelineFor(atTime(9, 0));
    const fill = rows.find(r => r.name === 'Prefer blocked hour');
    check('7b2 preferred time inside a blocked interval falls back to clock (9:00 AM)',
      fill && fill.startLabel === '9:00 AM',
      fill ? `start=${fill.startLabel}` : 'missing');
  }

  // (c) preferred time never overrides a hard allowed window: an item allowed
  //     only 10am-11am with a 2pm preferred hint still lands at 10am.
  {
    await seed(
      [base({ name: 'Windowed with pref', type: 'keepup', target: 1, durationMinutes: 30,
        allowedTimeStart: 600, allowedTimeEnd: 660, // 10:00 - 11:00
        preferredTimeStart: 840, preferredTimeEnd: 1020, // 14:00 hint (ignored past hard window)
        lastLog: atTime(9) - 2 * 86400000, logs: [atTime(9) - 2 * 86400000] })],
      defaultSettings()
    );
    const rows = await timelineFor(atTime(9, 0));
    const fill = rows.find(r => r.name === 'Windowed with pref');
    check('7c hard allowed window beats the preferred-time nudge',
      fill && fill.startLabel === '10:00 AM',
      fill ? `start=${fill.startLabel}` : 'missing');
  }

  // ==========================================================================
  // ISSUE 8 — a late/overnight allowed-time window lands at its window start.
  //          The availability budget caps TASK minutes, not open time, so a
  //          habit allowed 10pm-11am still gets placed at 10pm even when the
  //          budget is tiny and "now" is early — idle open time earlier in the
  //          day no longer eats the slot a late window needs. Conversely, when
  //          a block (sleep/other) actually covers the window start, the item
  //          gets NO suggestion (it is genuinely unavailable today).
  //          Overnight windows (end <= start) extend into tomorrow as one span.
  // ==========================================================================
  console.log('\n[Issue 8] late/overnight window lands at its window start');

  // (a) THE REPORTED BUG: 10pm-11am overnight window, now=9am, tiny 90min
  //     availability. Idle morning time must NOT eat the budget and starve the
  //     10pm window — the habit lands at its 10pm window start.
  {
    const ago = atTime(9) - 2 * 86400000;
    await seed(
      [base({ name: 'Overnight 10pm-11am', type: 'keepup', target: 1, durationMinutes: 30,
        allowedTimeStart: 1320, allowedTimeEnd: 660, // 22:00 - 11:00 (overnight)
        lastLog: ago, logs: [ago] })],
      defaultSettings({ availabilityMinutes: [90, 90, 90, 90, 90, 90, 90] })
    );
    const rows = await timelineFor(atTime(9, 0), true);
    const fill = rows.find(r => r.name === 'Overnight 10pm-11am');
    check('8a overnight window lands at its 10pm window start (budget does not starve it)',
      fill && fill.startLabel === '10:00 PM',
      fill ? `start=${fill.startLabel}` : 'missing');
    // The suggestion must stay inside the allowed window (end <= 11am tomorrow).
    check('8a overnight suggested end stays inside the window',
      fill && fill.endMs <= atTime(11, 0) + 24 * 3600000,
      fill ? `end=${fill.endLabel}` : 'missing');

    // DOM: the home card must surface the agenda-suggested pill.
    const pill = await page.locator('.ting-card:has-text("Overnight 10pm-11am") .context-pill.agenda-suggested').count();
    check('8a card renders agenda-suggested pill', pill === 1, `count=${pill}`);
  }

  // (b) Same overnight window, now=3pm (afternoon, inside the daytime gap).
  //     Must still defer the suggestion to tonight's 10pm window start.
  {
    const ago = atTime(9) - 2 * 86400000;
    await seed(
      [base({ name: 'Overnight 10pm-11am', type: 'keepup', target: 1, durationMinutes: 30,
        allowedTimeStart: 1320, allowedTimeEnd: 660,
        lastLog: ago, logs: [ago] })],
      defaultSettings()
    );
    const rows = await timelineFor(atTime(15, 0));
    const fill = rows.find(r => r.name === 'Overnight 10pm-11am');
    check('8b overnight window in afternoon still suggests 10pm',
      fill && fill.startLabel === '10:00 PM',
      fill ? `start=${fill.startLabel}` : 'missing');
  }

  // (b2) A block covering the window start => the item is genuinely unavailable
  //      today and gets NO suggested time. (Sleep from 10pm blocks the 10pm start.)
  {
    const ago = atTime(9) - 2 * 86400000;
    await seed(
      [base({ name: 'Overnight 10pm-11am', type: 'keepup', target: 1, durationMinutes: 30,
        allowedTimeStart: 1320, allowedTimeEnd: 660,
        lastLog: ago, logs: [ago] })],
      defaultSettings({ blockedTimes: [{ label: 'sleep', days: [], start: 1320, end: 420 }] }) // 22:00-07:00 overnight
    );
    const rows = await timelineFor(atTime(15, 0));
    const fill = rows.find(r => r.name === 'Overnight 10pm-11am');
    check('8b2 no suggestion when a block covers the window start',
      !fill, fill ? `unexpected start=${fill.startLabel}` : '');
  }

  // (c) Tight capacity that still covers a pre-10pm slot must NOT double-place:
  //     the windowed item lands at its window start, a windowless filler stacks
  //     after the last slot, and the two never overlap.
  {
    const ago = atTime(9) - 2 * 86400000;
    await seed(
      [
        base({ name: 'Late window 30m', type: 'keepup', target: 1, durationMinutes: 30,
          allowedTimeStart: 1320, allowedTimeEnd: 660, lastLog: ago, logs: [ago] }),
        base({ name: 'Plain fill 20m', type: 'keepup', target: 1, durationMinutes: 20,
          lastLog: ago, logs: [ago] })
      ],
      defaultSettings()
    );
    const rows = await timelineFor(atTime(9, 0));
    const win = rows.find(r => r.name === 'Late window 30m');
    const plain = rows.find(r => r.name === 'Plain fill 20m');
    check('8c windowed + windowless overflow both get suggested times',
      Boolean(win) && Boolean(plain),
      `win=${win ? win.startLabel : 'missing'} plain=${plain ? plain.startLabel : 'missing'}`);
  }

  // (d) Guard: an item whose allowed window is genuinely too small for its
  //     duration stays DROPPED — the overflow rescue never breaks a hard window.
  {
    const ago = atTime(9) - 2 * 86400000;
    await seed(
      [base({ name: 'Big overnight', type: 'keepup', target: 1, durationMinutes: 45,
        allowedTimeStart: 1320, allowedTimeEnd: 1330, // 22:00-22:10 = 10min, < 45min
        lastLog: ago, logs: [ago] })],
      defaultSettings()
    );
    const rows = await timelineFor(atTime(9, 0));
    const fill = rows.find(r => r.name === 'Big overnight');
    check('8d item too large for its window stays dropped (no false rescue)',
      !fill, fill ? `unexpected start=${fill.startLabel}` : '');
  }

  if (errors.length) failures.push('page/console errors:\n' + errors.join('\n'));
  await browser.close();

  console.log('');
  if (failures.length) {
    console.error(`FAIL (${failures.length} scenario(s))`);
    failures.forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('PASS — all agenda scenarios green');
})().catch(e => {
  console.error(e.stack || e.message);
  process.exit(1);
});
