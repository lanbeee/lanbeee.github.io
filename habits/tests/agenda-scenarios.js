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
  async function timelineFor(nowTs) {
    return page.evaluate(now => {
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
      } finally {
        globalThis.Date = orig;
      }
      return out;
    }, nowTs);
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
    const rows = await timelineFor(atTime(9, 0));
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
