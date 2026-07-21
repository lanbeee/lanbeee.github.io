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
//   Issue 9 — an "anywhere" habit (no locationIds) with a dynamic prayer
//             anchor resolves its window against the running agenda anchor /
//             lastKnown fallback and places in the agenda. Pre-fix this habit
//             was blocked at save time and couldn't resolve a prayer time.
//
// Each scenario seeds localStorage, reloads, and asserts against the live
// in-page pure functions (via page.evaluate) plus the rendered DOM for pills.
// Run with:  node habits/tests/agenda-scenarios.js   (after starting the server)
//            python3 -m http.server 4176  (from the habits/ directory)

const { chromium } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

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
    const rows = await timelineFor(atTime(9, 0), true);
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

  // ==========================================================================
  // ISSUE 9 — "anywhere" habit with a dynamic prayer anchor resolves + places
  // An anywhere habit (empty locationIds) with a sunrise-anchored window must
  // still place in the agenda: the running anchor / lastKnown fallback gives
  // the resolver a location. Pre-fix this habit couldn't even be saved.
  // ==========================================================================
  console.log('\n[Issue 9] anywhere + dynamic prayer anchor places');
  {
    const ago = atTime(9) - 2 * 86400000;
    await seed(
      [base({
        name: 'Sunrise anywhere', type: 'keepup', target: 1, durationMinutes: 30,
        locationIds: [],
        allowedTimeStartAnchor: 'sunrise',
        allowedTimeEnd: 1200, // 8pm fixed end so hasTimeWindow is true
        lastLog: ago, logs: [ago]
      })],
      defaultSettings({
        locations: [{ id: 'home', name: 'Home', lat: 40.7, lng: -74.0 }],
        lastKnownLocationId: 'home'
      })
    );
    // Freeze "now" to 3am so the sunrise window is ahead of us and places.
    const rows = await timelineFor(atTime(3, 0));
    const fill = rows.find(r => r.name === 'Sunrise anywhere');
    check('9a anywhere+prayer habit gets placed',
      Boolean(fill), fill ? `start=${fill.startLabel}` : 'fill missing');
    // The placed start must equal the context-resolved window (lastKnown=home
    // seeds the day's anchor). If the threading breaks the start drifts.
    if (fill) {
      const match = await page.evaluate(({ startMs }) => {
        const today = dayStart(Date.now());
        const h = load().find(x => x.name === 'Sunrise anywhere');
        if (!h) return false;
        const win = fillTimeWindow(h, today, 'home');
        return Boolean(win) && win.start === startMs;
      }, { startMs: fill.startMs });
      check('9b placed start matches the context-resolved sunrise window', match);
    }
  }

  // ==========================================================================
  // ISSUE 10 — prayer-anchored habits roll to future days in the week plan
  // When a prayer-anchored habit's morning window has already passed today,
  // it should still appear on tomorrow's (and future) agenda at the next
  // prayer window. Two regressions guarded here:
  //   (a) never-logged habits were excluded from the week planner by a
  //       daysSince(null) guard in isWeekCandidate — newly created habits
  //       vanished from all 7 days;
  //   (b) habits with logs whose today-window closed should place on future
  //       days, not disappear entirely.
  // ==========================================================================
  console.log('\n[Issue 10] prayer-anchored habits roll to future days');
  {
    const ago3d = atTime(9) - 3 * 86400000;
    await seed(
      [
        base({ name:'Fajr overdue', type:'keepup', target:1, durationMinutes:5,
          locationIds:[], allowedTimeStartAnchor:'fajr',
          allowedTimeEndAnchor:'sunrise', allowedTimeEndOffsetMin:-5,
          lastLog:ago3d, logs:[ago3d] }),
        base({ name:'Fajr new', type:'keepup', target:1, durationMinutes:5,
          locationIds:[], allowedTimeStartAnchor:'fajr',
          allowedTimeEndAnchor:'sunrise', allowedTimeEndOffsetMin:-5,
          lastLog:null, logs:[] })
      ],
      defaultSettings({
        locations:[{id:'home', name:'Home', lat:40.7, lng:-74.0}],
        lastKnownLocationId:'home',
        blockedTimes:[{label:'sleep', days:[], locationId:'home',
          start:1320, end:420,
          startAnchor:'isha', startOffsetMin:15,
          startCombine:'later', startAnchor2:'sunrise', startOffsetMin2:-480, startDayOffset2:1,
          endAnchor:'sunrise', endOffsetMin:-30}]
      })
    );

    // Check at noon — today's Fajr window has long passed.
    const weekResult = await page.evaluate(({ now }) => {
      const RealDate = Date;
      function FD(...a){ return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
      FD.now = () => now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
      Object.setPrototypeOf(FD, RealDate); FD.prototype = RealDate.prototype;
      const orig = globalThis.Date; globalThis.Date = FD;
      let out;
      try {
        const data = JSON.parse(localStorage.getItem('tings_v2'));
        const settings = JSON.parse(localStorage.getItem('tings_app_settings_v2'));
        const week = buildWeekAgenda(data, settings, 7);
        const days = week.days.map(d => ({
          label: new RealDate(d.dayBase).toLocaleDateString(),
          fills: (d.timeline || []).filter(r => r.kind === 'fill').map(r => r.h.name)
        }));
        // Also verify isWeekCandidate no longer blocks never-logged habits.
        const todayBase = dayStart(now);
        const fajrNew = data.find(h => h.name === 'Fajr new');
        const newCandidateTomorrow = isWeekCandidate(fajrNew, settings, todayBase + 86400000, new RealDate(todayBase + 86400000).getDay());
        return { days, newCandidateTomorrow };
      } finally { globalThis.Date = orig; }
    }, { now: atTime(12) });

    // Never-logged habit is now a week candidate (was false pre-fix).
    check('10a never-logged prayer habit is a week candidate',
      weekResult.newCandidateTomorrow === true,
      `got ${weekResult.newCandidateTomorrow}`);

    // Both habits should place on future days (not today — window passed).
    const tomorrow = weekResult.days[1];
    check('10b overdue prayer habit places on tomorrow',
      tomorrow && tomorrow.fills.includes('Fajr overdue'),
      tomorrow ? `tomorrow fills: ${tomorrow.fills.join(', ')}` : 'no tomorrow');
    check('10c never-logged prayer habit places on tomorrow',
      tomorrow && tomorrow.fills.includes('Fajr new'),
      tomorrow ? `tomorrow fills: ${tomorrow.fills.join(', ')}` : 'no tomorrow');

    // Today (window passed) should NOT place — today is genuinely missed.
    const today = weekResult.days[0];
    check('10d today (window passed) does not place the prayer habit',
      today && !today.fills.includes('Fajr overdue'),
      today ? `today fills: ${today.fills.join(', ')}` : 'no today');
  }

  // ==========================================================================
  // ISSUE 11 — sunrise-window habit between overnight sleep and breakfast
  // A habit allowed sunrise+5…sunrise+35 must place in the morning gap between
  // an overnight sleep block (ends sunrise−30) and a fixed breakfast block
  // (8:00–9:00). Pre-fix, dayFirstOpenMinute treated breakfast as the day's
  // "wake" boundary, clipping future-day open slots to 9:00 AM and wiping the
  // gap — so after today's sunrise window closed the habit fell to overdue
  // and never appeared on tomorrow's agenda.
  // ==========================================================================
  console.log('\n[Issue 11] sunrise habit between sleep and breakfast');
  {
    const ago1d = atTime(6) - 1 * 86400000;
    await seed(
      [
        base({ name:'Sunrise Exercise', type:'keepup', target:1, durationMinutes:5,
          locationIds:[],
          allowedTimeStartAnchor:'sunrise', allowedTimeStartOffsetMin:5,
          allowedTimeEndAnchor:'sunrise', allowedTimeEndOffsetMin:35,
          lastLog:ago1d, logs:[ago1d] })
      ],
      defaultSettings({
        showWeekOnHome:true,
        locations:[{id:'home', name:'Charles Street', lat:40.734852, lng:-74.003584}],
        lastKnownLocationId:'home',
        blockedTimes:[
          {label:'blocked', days:[], locationId:'home',
            start:900, end:960,
            startAnchor:'sunrise', startOffsetMin:-480,
            startCombine:'later', startAnchor2:'isha', startOffsetMin2:15,
            startDayOffset:1, startDayOffset2:0,
            endAnchor:'sunrise', endOffsetMin:-30},
          {label:'breakfast', days:[], locationId:null,
            start:480, end:540}
        ]
      })
    );

    // Afternoon — today's sunrise+5…+35 window has closed.
    const issue11 = await page.evaluate(({ now }) => {
      const RealDate = Date;
      function FD(...a){ return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
      FD.now = () => now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
      Object.setPrototypeOf(FD, RealDate); FD.prototype = RealDate.prototype;
      const orig = globalThis.Date; globalThis.Date = FD;
      try {
        const data = JSON.parse(localStorage.getItem('tings_v2'));
        const settings = JSON.parse(localStorage.getItem('tings_app_settings_v2'));
        const blocks = normalizeBlockedTimes(settings.blockedTimes);
        const tomorrowBase = dayStart(now) + 86400000;
        const tomorrowWeekday = new RealDate(tomorrowBase).getDay();
        const firstOpen = dayFirstOpenMinute(blocks, tomorrowWeekday);
        const week = buildWeekAgenda(data, settings, 7);
        const tomorrow = week.days[1];
        const fills = (tomorrow?.timeline || []).filter(r => r.kind === 'fill');
        const exercise = fills.find(r => r.h && r.h.name === 'Sunrise Exercise');
        const placeMin = exercise
          ? Math.round((exercise.start - tomorrow.dayBase) / 60000)
          : null;
        const tomorrowSlots = (tomorrow?.slots || []).map(s => ({
          startMin: Math.round((s.start - tomorrow.dayBase) / 60000),
          endMin: Math.round((s.end - tomorrow.dayBase) / 60000)
        }));
        return {
          firstOpen,
          fillNames: fills.map(r => r.h.name),
          placeMin,
          tomorrowSlots,
          hasExercise: !!exercise
        };
      } finally { globalThis.Date = orig; }
    }, { now: atTime(15) });

    // dayFirstOpenMinute must end at the overnight sleep tail, NOT breakfast (540).
    check('11a dayFirstOpenMinute is before breakfast (not clipped to 9am)',
      issue11.firstOpen > 0 && issue11.firstOpen < 480,
      `firstOpen=${issue11.firstOpen}`);

    check('11b Sunrise Exercise places on tomorrow',
      issue11.hasExercise,
      `tomorrow fills: ${issue11.fillNames.join(', ') || '(none)'}; slots=${JSON.stringify(issue11.tomorrowSlots)}`);

    // Placed inside the sunrise window, before breakfast starts at 8:00.
    check('11c placed before breakfast in the morning gap',
      issue11.placeMin != null && issue11.placeMin < 480,
      `placeMin=${issue11.placeMin}`);
  }

  // ==========================================================================
  // ISSUE 12 — scarcity overrides priority
  // A flexible P0 (all-day, 60m) must not steal the only sunrise morning gap
  // from a narrow P2 sunrise habit. Scarcity-first placement puts the tight
  // window first; the P0 still places in a wide afternoon/evening slot.
  // ==========================================================================
  console.log('\n[Issue 12] scarcity overrides priority (sunrise vs flexible P0)');
  {
    const ago1d = atTime(6) - 1 * 86400000;
    await seed(
      [
        base({ name:'Flexible Deep Work', type:'keepup', target:1, durationMinutes:60,
          priority:0, locationIds:[],
          lastLog:ago1d, logs:[ago1d] }),
        base({ name:'Sunrise Exercise', type:'keepup', target:1, durationMinutes:5,
          priority:2, locationIds:[],
          allowedTimeStartAnchor:'sunrise', allowedTimeStartOffsetMin:5,
          allowedTimeEndAnchor:'sunrise', allowedTimeEndOffsetMin:35,
          lastLog:ago1d, logs:[ago1d] })
      ],
      defaultSettings({
        showWeekOnHome:true,
        locations:[{id:'home', name:'Charles Street', lat:40.734852, lng:-74.003584}],
        lastKnownLocationId:'home',
        blockedTimes:[
          {label:'blocked', days:[], locationId:'home',
            start:900, end:960,
            startAnchor:'sunrise', startOffsetMin:-480,
            startCombine:'later', startAnchor2:'isha', startOffsetMin2:15,
            startDayOffset:1, startDayOffset2:0,
            endAnchor:'sunrise', endOffsetMin:-30},
          {label:'breakfast', days:[], locationId:null, start:480, end:540}
        ]
      })
    );

    const issue12 = await page.evaluate(({ now }) => {
      const RealDate = Date;
      function FD(...a){ return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
      FD.now = () => now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
      Object.setPrototypeOf(FD, RealDate); FD.prototype = RealDate.prototype;
      const orig = globalThis.Date; globalThis.Date = FD;
      try {
        const data = JSON.parse(localStorage.getItem('tings_v2'));
        const settings = JSON.parse(localStorage.getItem('tings_app_settings_v2'));
        const week = buildWeekAgenda(data, settings, 7);
        const tomorrow = week.days[1];
        const fills = (tomorrow?.timeline || []).filter(r => r.kind === 'fill');
        const byName = Object.fromEntries(fills.map(r => {
          const placeMin = Math.round((r.start - tomorrow.dayBase) / 60000);
          return [r.h.name, placeMin];
        }));
        return {
          names: fills.map(r => r.h.name),
          byName,
          hasSunrise: !!byName['Sunrise Exercise'],
          hasFlexible: !!byName['Flexible Deep Work'],
          sunriseMin: byName['Sunrise Exercise'] ?? null,
          flexibleMin: byName['Flexible Deep Work'] ?? null
        };
      } finally { globalThis.Date = orig; }
    }, { now: atTime(15) });

    check('12a Sunrise Exercise places on tomorrow despite lower priority',
      issue12.hasSunrise,
      `fills: ${issue12.names.join(', ') || '(none)'}`);
    check('12b Flexible Deep Work still places on tomorrow',
      issue12.hasFlexible,
      `fills: ${issue12.names.join(', ') || '(none)'}`);
    check('12c sunrise stays in morning gap (before breakfast)',
      issue12.sunriseMin != null && issue12.sunriseMin < 480,
      `sunriseMin=${issue12.sunriseMin}`);
    check('12d flexible P0 places outside the scarce morning gap',
      issue12.flexibleMin != null && issue12.flexibleMin >= 480,
      `flexibleMin=${issue12.flexibleMin}, sunriseMin=${issue12.sunriseMin}`);
  }

  // ==========================================================================
  // ISSUE 13 — due-today work at the user's current place uses tonight's gap
  // At 7:30pm, with a short-window item becoming eligible ~10:30pm, a flexible
  // due-today item already at the current location must use the open gap now —
  // not defer to tomorrow morning because scarce sunrise habits exist later.
  // ==========================================================================
  console.log('\n[Issue 13] due-today uses tonight gap before a late timed task');
  {
    const ago1d = atTime(9) - 1 * 86400000;
    const todayDue = atTime(12);
    await seed(
      [
        base({ name:'Sunrise scarce', type:'keepup', target:1, durationMinutes:5,
          priority:2, locationIds:[],
          allowedTimeStartAnchor:'sunrise', allowedTimeStartOffsetMin:5,
          allowedTimeEndAnchor:'sunrise', allowedTimeEndOffsetMin:35,
          lastLog:ago1d, logs:[ago1d] }),
        base({ name:'Late timed', type:'task', target:null, durationMinutes:30,
          priority:1, locationIds:['home'],
          eventTime:atTime(22, 30), dueDate:todayDue, hardDue:false }),
        base({ name:'Flexible due now', type:'task', target:null, durationMinutes:30,
          priority:0, locationIds:['home'],
          dueDate:todayDue, hardDue:false }),
        base({ name:'Flexible due habit', type:'keepup', target:1, durationMinutes:30,
          priority:0, locationIds:['home'],
          lastLog:ago1d, logs:[ago1d] })
      ],
      defaultSettings({
        showWeekOnHome:true,
        availabilityMinutes:[600,600,600,600,600,600,600],
        locations:[{id:'home', name:'Home', lat:40.73, lng:-74.0}],
        lastKnownLocationId:'home',
        blockedTimes:[
          {label:'sleep', days:[], locationId:'home',
            start:1320, end:420,
            startAnchor:'sunrise', startOffsetMin:-480,
            startCombine:'later', startAnchor2:'isha', startOffsetMin2:15, startDayOffset:1,
            endAnchor:'sunrise', endOffsetMin:-30}
        ]
      })
    );

    const issue13 = await page.evaluate(({ now }) => {
      const RealDate = Date;
      function FD(...a){ return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
      FD.now = () => now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
      Object.setPrototypeOf(FD, RealDate); FD.prototype = RealDate.prototype;
      const orig = globalThis.Date; globalThis.Date = FD;
      try {
        const data = normalize(JSON.parse(localStorage.getItem('tings_v2')));
        const settings = loadSortSettings();
        const week = buildWeekAgenda(data, settings, 7);
        function info(name){
          for(let i = 0;i < week.days.length;i += 1){
            const hits = (week.days[i].timeline || []).filter(r =>
              (r.kind === 'fill' || r.kind === 'scheduled') && r.h && r.h.name === name);
            if(hits.length){
              return {
                day:i,
                min:Math.round((hits[0].start - week.days[i].dayBase) / 60000)
              };
            }
          }
          return {day:-1, min:null};
        }
        return {
          task: info('Flexible due now'),
          habit: info('Flexible due habit'),
          late: info('Late timed'),
          sunrise: info('Sunrise scarce')
        };
      } finally { globalThis.Date = orig; }
    }, { now: atTime(19, 30) }); // 7:30pm

    check('13a flexible due task places TODAY in the evening gap',
      issue13.task.day === 0 && issue13.task.min != null && issue13.task.min < 22 * 60,
      `task=${JSON.stringify(issue13.task)}`);
    check('13b flexible due habit first lands TODAY (not tomorrow morning)',
      issue13.habit.day === 0 && issue13.habit.min != null && issue13.habit.min >= 19 * 60,
      `habit=${JSON.stringify(issue13.habit)}; sunrise=${JSON.stringify(issue13.sunrise)}`);
    check('13c late timed task stays at 10:30pm',
      issue13.late.day === 0 && issue13.late.min === 22 * 60 + 30,
      `late=${JSON.stringify(issue13.late)}`);
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
