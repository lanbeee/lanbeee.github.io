// Massive tight-capacity week packing for daily + multi-times-per-week habits.
//
// Reproduces the reported failure mode:
//   - Capacity is set via availabilityMinutes only (no blocked-time carve-outs).
//   - Space exists, but only narrowly — the planner must pack diligently.
//   - Daily habits (target:1) must appear on EVERY day of the week.
//   - Multi-times habits (2×/7d, 3×/7d, every-3-days) must land the expected
//     number of times without starving the dailies.
//   - A day with leftover minutes must not leave a due daily unplaced
//     (the "I can plan it by hand and it fits without sacrificing anything"
//     symptom).
//
// Also covers habit-state variations under the same tight budget:
//   - brand-new (never logged)
//   - overdue / logged on time yesterday morning
//   - logged late last night, with snapLogTimestamp (as logTing does)
//   - logged late last night RAW (no snap) — still due next calendar morning
//   - already logged today (must skip today, resume tomorrow)
//   - morning-window daily logged after the window closed (snapped to window start)
//   - flexibility pull-forward (not yet due on raw target, eligible via flex)
//   - multi-times that are new, mid-cycle, or overdue
//
// And a blocked-hours stress case (the reported "blocks mess up placement"):
//   - sleep / breakfast / work / lunch / work-pm / sunset / dinner blocks
//   - most blocks + nearly all habits use dynamic prayer anchors
//     (fajr→isha clusters: stretch, review, dhuhr, lunch walk, asr, maghrib,
//     dishes, shower, journal, late-log floss, multi-times, …)
//   - asserts fills stay outside blocks, habits land in resolved windows,
//     and a manual plan still fits when the planner left a due habit unplaced
//
// Freeze the clock to Monday 06:00 so today is clipped mid-morning while
// future days open at midnight — this is exactly when a bogus midnight
// "preferred time" used to make tomorrow score better than today, so the
// greedy first-placement skipped today and never backfilled.
//
//   HABITS_URL=http://127.0.0.1:4173/ node tests/tight-rhythm-capacity-test.js

const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

// Fixed Monday 6am local — weekday 1, mid-morning clip on today.
const FROZEN = new Date(2026, 6, 20, 6, 0, 0, 0).getTime();

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const failures = [];
  function check(name, cond, detail) {
    if (cond) console.log(`  ok  - ${name}`);
    else {
      failures.push(`${name}${detail ? ' :: ' + detail : ''}`);
      console.log(`  FAIL- ${name}${detail ? ' :: ' + detail : ''}`);
    }
  }

  await page.goto(BASE, { waitUntil: 'networkidle' });

  // ── Fixture ────────────────────────────────────────────────────────────
  // Dailies sum to 75m. Availability is 110m/day → 35m of slack.
  // Multi-times must share that narrow slack across the week without
  // bumping any daily off a day.
  //
  //   D1–D3  15m × 3 = 45m   (P1 — higher priority)
  //   D4     10m
  //   D5      5m
  //   D6     15m
  //   ─────────────────
  //   daily load         75m
  //   availability      110m
  //   slack              35m  ← fits one 30m OR 20m+15m, not everything
  //
  // Longer multi-times (25m / 30m) compete with shorter ones for the same
  // slack — packing order and rhythm spacing both matter.
  const DAILIES = [
    'D1 stretch', 'D2 meditate', 'D3 journal',
    'D4 floss', 'D5 vitamins', 'D6 review'
  ];
  const MULTI = [
    'W3 laundry',      // 3×/7d ≈ every 2.33d, 20m (exact slack)
    'W2 deep clean',   // 2×/7d = every 3.5d, 25m
    'E3 groceries',    // every 3 days, 30m
    'W3 walk',         // 3×/7d, 15m
    'W2 call mom'      // 2×/7d, 20m
  ];

  const result = await page.evaluate(({ frozen, dailies, multi }) => {
    const RealDate = Date;
    function FrozenDate(...args) {
      if (args.length === 0) return new RealDate(frozen);
      return new RealDate(...args);
    }
    FrozenDate.now = () => frozen;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate);
    FrozenDate.prototype = RealDate.prototype;
    const orig = globalThis.Date;
    globalThis.Date = FrozenDate;

    try {
      const ago = frozen - 2 * 86400000;
      function mk(props) {
        return Object.assign({
          type: 'keepup', flexibilityDays: 0, durationMinutes: 15,
          allowedTimeStart: null, allowedTimeEnd: null,
          preferredTimeStart: null, preferredTimeEnd: null,
          lastLog: ago, logs: [ago], emoji: '', pinned: false, sample: false,
          snoozedUntil: null, topics: [], allowedWeekdays: [], allowedMonthDays: [],
          preferredWeekdays: [], preferredMonthDays: [], dueDate: null, eventTime: null,
          hardDue: false, markDone: true, createdAt: frozen, priority: 2, locationIds: []
        }, props);
      }

      const raw = [
        // ── dailies (target:1) ──
        mk({ name: 'D1 stretch', target: 1, durationMinutes: 15, priority: 1 }),
        mk({ name: 'D2 meditate', target: 1, durationMinutes: 15, priority: 1 }),
        mk({ name: 'D3 journal', target: 1, durationMinutes: 15, priority: 2 }),
        mk({ name: 'D4 floss', target: 1, durationMinutes: 10, priority: 2 }),
        mk({ name: 'D5 vitamins', target: 1, durationMinutes: 5, priority: 2 }),
        mk({ name: 'D6 review', target: 1, durationMinutes: 15, priority: 2 }),
        // ── multi-times / sparse rhythms ──
        mk({ name: 'W3 laundry', target: targetFromRhythmParts(3, 7), durationMinutes: 20, priority: 2 }),
        mk({ name: 'W2 deep clean', target: targetFromRhythmParts(2, 7), durationMinutes: 25, priority: 1 }),
        mk({ name: 'E3 groceries', target: 3, durationMinutes: 30, priority: 1 }),
        mk({ name: 'W3 walk', target: targetFromRhythmParts(3, 7), durationMinutes: 15, priority: 2 }),
        mk({ name: 'W2 call mom', target: targetFromRhythmParts(2, 7), durationMinutes: 20, priority: 3 }),
        // Extra pressure: another daily-sized keepup on a longer rhythm so
        // the week has more candidates than any single day can hold.
        mk({ name: 'E2 inbox zero', target: 2, durationMinutes: 20, priority: 4 }),
        mk({ name: 'E4 meal prep', target: 4, durationMinutes: 35, priority: 3 }),
        mk({ name: 'W4 laundry fold', target: targetFromRhythmParts(4, 7), durationMinutes: 15, priority: 4 })
      ];

      const data = normalize(raw);
      // Capacity via availability only — no blocked times (the "block hours
      // feel too rigid" setup the user wants to rely on).
      const settings = Object.assign({}, loadSortSettings(), {
        availabilityMinutes: [110, 110, 110, 110, 110, 110, 110],
        availabilityOverrides: {},
        blockedTimes: [],
        showWeekOnHome: true,
        showDueHabitsInAgenda: true,
        showPlannedItemsInAgenda: true,
        showScheduledTasksInAgenda: true,
        showDueTasksInAgenda: true,
        locations: [],
        lastKnownLocationId: null,
        agendaOptimizer: false
      });

      // Sanity: null preferred must NOT resolve as midnight (0).
      const prefProbe = data.find(h => h.name === 'D1 stretch');
      const prefResolved = resolveHabitTimeField(prefProbe, 'preferredTimeStart', dayStart(frozen));
      const prefStartMs = fillPreferredStart(prefProbe, dayStart(frozen));

      const week = buildWeekAgenda(data, settings, 7);
      const byDay = week.days.map((d, i) => {
        const fills = (d.timeline || []).filter(r => r.kind === 'fill').map(r => r.h.name);
        const dailyLoad = dailies.reduce((sum, name) => {
          const h = data.find(x => x.name === name);
          return fills.includes(name) ? sum + clampDuration(h.durationMinutes) : sum;
        }, 0);
        return {
          day: i,
          weekday: d.weekday,
          used: d.usedMinutes,
          rem: d.remainingMinutes,
          total: d.totalMinutes,
          fills,
          dailiesPresent: dailies.filter(n => fills.includes(n)),
          dailiesMissing: dailies.filter(n => !fills.includes(n)),
          dailyLoad
        };
      });

      const counts = {};
      for (const n of [...dailies, ...multi, 'E2 inbox zero', 'E4 meal prep', 'W4 laundry fold']) {
        counts[n] = byDay.filter(d => d.fills.includes(n)).length;
      }

      // Spare-capacity check: any missing daily on a day must be unable to
      // fit in the leftover budget (otherwise the planner left free space
      // that could have held it — the reported bug).
      const spareBugs = [];
      for (const day of byDay) {
        for (const name of day.dailiesMissing) {
          const h = data.find(x => x.name === name);
          const need = clampDuration(h.durationMinutes);
          if (day.rem >= need) {
            spareBugs.push({
              day: day.day,
              name,
              rem: day.rem,
              need,
              fills: day.fills
            });
          }
        }
      }

      // Manual-plan rescue: plan the first missing-today daily for today and
      // confirm it places on today without requiring other dailies to drop
      // below their previous count on that day.
      let manualPlan = null;
      const todayMissing = byDay[0].dailiesMissing;
      if (todayMissing.length) {
        const rescueName = todayMissing[0];
        const todayBase = dayStart(frozen);
        const data2 = normalize(data.map(h => {
          if (h.name !== rescueName) return Object.assign({}, h);
          return Object.assign({}, h, {
            logs: [...(h.logs || []), { ts: todayBase + 10 * 3600000, plan: true }]
          });
        }));
        const week2 = buildWeekAgenda(data2, settings, 7);
        const today2 = week2.days[0];
        const fills2 = (today2.timeline || []).filter(r => r.kind === 'fill').map(r => r.h.name);
        const otherDailiesBefore = byDay[0].dailiesPresent.filter(n => n !== rescueName);
        const otherDailiesAfter = otherDailiesBefore.filter(n => fills2.includes(n));
        manualPlan = {
          rescueName,
          placedToday: fills2.includes(rescueName),
          remAfter: today2.remainingMinutes,
          otherDailiesKept: otherDailiesAfter.length === otherDailiesBefore.length,
          fillsBefore: byDay[0].fills,
          fillsAfter: fills2
        };
      }

      // Expected multi-times counts over 7 days with chronological spacing:
      //   target 1     → 7
      //   3×/7d (~2.33) → up to 3
      //   2×/7d (3.5)   → up to 2
      //   every 3d      → up to 3 (days 0,3,6)
      // Capacity may force fewer — assert floors that still prove progress.
      return {
        prefResolved,
        prefStartMs,
        byDay,
        counts,
        spareBugs,
        manualPlan,
        candidateCount: week.candidateCount,
        targets: Object.fromEntries(data.map(h => [h.name, h.target]))
      };
    } finally {
      globalThis.Date = orig;
    }
  }, { frozen: FROZEN, dailies: DAILIES, multi: MULTI });

  console.log('\n[tight-rhythm] null preferred must not resolve as midnight');
  check('preferredTimeStart null stays unresolved (not 0)',
    result.prefResolved === null,
    `resolved=${JSON.stringify(result.prefResolved)}`);
  check('fillPreferredStart returns null when unset',
    result.prefStartMs === null,
    `prefStartMs=${result.prefStartMs}`);

  console.log('\n[tight-rhythm] daily habits place every day under narrow capacity');
  console.log('  counts:', JSON.stringify(result.counts));
  for (const name of DAILIES) {
    check(`${name} places on all 7 days`,
      result.counts[name] === 7,
      `got ${result.counts[name]}/7`);
  }

  console.log('\n[tight-rhythm] no leftover capacity while a daily is missing');
  check('no day leaves spare minutes that could fit a missing daily',
    result.spareBugs.length === 0,
    JSON.stringify(result.spareBugs));

  // Today specifically — the reported symptom.
  check('today has every daily (not skipped for a later "better" day)',
    result.byDay[0].dailiesMissing.length === 0,
    `missing=${JSON.stringify(result.byDay[0].dailiesMissing)} fills=${JSON.stringify(result.byDay[0].fills)} rem=${result.byDay[0].rem}`);

  console.log('\n[tight-rhythm] multi-times-per-week get real placements');
  // Under 35m slack, not every multi can hit its ideal cadence — assert that
  // each rhythm class still earns at least one timed slot, and that 3×/7d
  // habits respect non-consecutive spacing when they place more than once.
  check('W3 laundry (3×/7d, 20m) places at least once',
    result.counts['W3 laundry'] >= 1,
    `got ${result.counts['W3 laundry']}`);
  check('W3 walk (3×/7d, 15m) places at least once',
    result.counts['W3 walk'] >= 1,
    `got ${result.counts['W3 walk']}`);
  check('W2 deep clean (2×/7d, 25m) places at least once',
    result.counts['W2 deep clean'] >= 1,
    `got ${result.counts['W2 deep clean']}`);
  check('E3 groceries (every 3d, 30m) places at least once',
    result.counts['E3 groceries'] >= 1,
    `got ${result.counts['E3 groceries']}`);
  check('W2 call mom (2×/7d, 20m) places at least once',
    result.counts['W2 call mom'] >= 1,
    `got ${result.counts['W2 call mom']}`);
  {
    const multiPlacements = MULTI.reduce((n, name) => n + result.counts[name], 0);
    check('multi-times collectively place at least 7 sessions across the week',
      multiPlacements >= 7,
      `got ${multiPlacements} from ${JSON.stringify(Object.fromEntries(MULTI.map(n => [n, result.counts[n]])))}`);
  }

  // Rhythm spacing: a 3×/7d habit should not appear on consecutive days.
  {
    const laundryDays = result.byDay
      .filter(d => d.fills.includes('W3 laundry'))
      .map(d => d.day);
    let consecutive = false;
    for (let i = 1; i < laundryDays.length; i += 1) {
      if (laundryDays[i] === laundryDays[i - 1] + 1) consecutive = true;
    }
    check('W3 laundry does not land on consecutive days (rhythm spacing)',
      !consecutive,
      `days=${JSON.stringify(laundryDays)}`);
  }

  console.log('\n[tight-rhythm] each day stays within availability budget');
  for (const day of result.byDay) {
    check(`day ${day.day} used ≤ total (${day.used} ≤ ${day.total})`,
      day.used <= day.total + 0.01,
      `used=${day.used} total=${day.total}`);
    check(`day ${day.day} daily load ≤ 75 when all dailies present`,
      day.dailiesMissing.length > 0 || day.dailyLoad === 75,
      `dailyLoad=${day.dailyLoad} missing=${JSON.stringify(day.dailiesMissing)}`);
  }

  // Non-overlap: fills on each day must not share the same start (basic sanity).
  console.log('\n[tight-rhythm] fills do not exceed capacity when dailies are complete');
  for (const day of result.byDay) {
    if (day.dailiesMissing.length) continue;
    // 75 daily + any multi must be ≤ 110
    check(`day ${day.day} packed load fits 110m budget`,
      day.used <= 110,
      `used=${day.used} fills=${JSON.stringify(day.fills)}`);
  }

  if (result.manualPlan) {
    console.log('\n[tight-rhythm] manual plan rescue (documents prior symptom)');
    // After the fix, today should already be complete so manualPlan stays null.
    // If we ever regress into spareBugs, this block still asserts the rescue
    // property the user observed.
    check('manual plan places the rescued daily on today',
      result.manualPlan.placedToday,
      JSON.stringify(result.manualPlan));
    check('manual plan does not drop other already-placed dailies today',
      result.manualPlan.otherDailiesKept,
      JSON.stringify(result.manualPlan));
  } else {
    console.log('\n[tight-rhythm] manual plan rescue not needed (today already complete)');
    check('no manual-plan rescue required', true);
  }

  // ── Second scenario: even tighter — exact fit, no multi slack ─────────
  console.log('\n[tight-rhythm-exact] dailies alone exactly fill each day');
  const exact = await page.evaluate(({ frozen }) => {
    const RealDate = Date;
    function FrozenDate(...args) {
      if (args.length === 0) return new RealDate(frozen);
      return new RealDate(...args);
    }
    FrozenDate.now = () => frozen;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate);
    FrozenDate.prototype = RealDate.prototype;
    const orig = globalThis.Date;
    globalThis.Date = FrozenDate;
    try {
      const ago = frozen - 2 * 86400000;
      function mk(props) {
        return Object.assign({
          type: 'keepup', flexibilityDays: 0,
          allowedTimeStart: null, allowedTimeEnd: null,
          preferredTimeStart: null, preferredTimeEnd: null,
          lastLog: ago, logs: [ago], emoji: '', pinned: false, sample: false,
          snoozedUntil: null, topics: [], allowedWeekdays: [], allowedMonthDays: [],
          preferredWeekdays: [], preferredMonthDays: [], dueDate: null, eventTime: null,
          hardDue: false, markDone: true, createdAt: frozen, priority: 2, locationIds: []
        }, props);
      }
      // 6×15m = 90m exact on 90m availability.
      const names = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6'];
      const data = normalize(names.map((name, i) =>
        mk({ name, target: 1, durationMinutes: 15, priority: i < 2 ? 1 : 2 })));
      const settings = Object.assign({}, loadSortSettings(), {
        availabilityMinutes: [90, 90, 90, 90, 90, 90, 90],
        availabilityOverrides: {},
        blockedTimes: [],
        locations: [],
        lastKnownLocationId: null,
        agendaOptimizer: false,
        showDueHabitsInAgenda: true
      });
      const week = buildWeekAgenda(data, settings, 7);
      return week.days.map((d, i) => {
        const fills = (d.timeline || []).filter(r => r.kind === 'fill').map(r => r.h.name);
        return {
          day: i,
          used: d.usedMinutes,
          rem: d.remainingMinutes,
          fills,
          missing: names.filter(n => !fills.includes(n))
        };
      });
    } finally {
      globalThis.Date = orig;
    }
  }, { frozen: FROZEN });

  for (const day of exact) {
    check(`exact day ${day.day} places all 6 dailies`,
      day.missing.length === 0,
      `missing=${JSON.stringify(day.missing)} fills=${JSON.stringify(day.fills)} rem=${day.rem}`);
    check(`exact day ${day.day} uses full 90m`,
      day.used === 90,
      `used=${day.used}`);
  }

  // ── Third scenario: every habit-state variation under tight capacity ──
  console.log('\n[tight-rhythm-variations] new / late-log / mid-cycle / flex / done-today');
  const variations = await page.evaluate(({ frozen }) => {
    const RealDate = Date;
    function FrozenDate(...args) {
      if (args.length === 0) return new RealDate(frozen);
      return new RealDate(...args);
    }
    FrozenDate.now = () => frozen;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate);
    FrozenDate.prototype = RealDate.prototype;
    const orig = globalThis.Date;
    globalThis.Date = FrozenDate;
    try {
      const todayBase = dayStart(frozen);
      const yestBase = todayBase - 86400000;
      const yestMorning = yestBase + 9 * 3600000;       // yesterday 9:00
      const yestLate = yestBase + 23 * 3600000;         // yesterday 23:00
      const todayEarly = todayBase + 5 * 3600000;       // today 5:00 (before frozen 6:00)
      const ago5d = todayBase - 5 * 86400000 + 9 * 3600000;
      const ago10d = todayBase - 10 * 86400000 + 9 * 3600000;

      function mk(props) {
        return Object.assign({
          type: 'keepup', flexibilityDays: 0, durationMinutes: 10,
          allowedTimeStart: null, allowedTimeEnd: null,
          preferredTimeStart: null, preferredTimeEnd: null,
          lastLog: null, logs: [], emoji: '', pinned: false, sample: false,
          snoozedUntil: null, topics: [], allowedWeekdays: [], allowedMonthDays: [],
          preferredWeekdays: [], preferredMonthDays: [], dueDate: null, eventTime: null,
          hardDue: false, markDone: true, createdAt: frozen - 30 * 86400000,
          priority: 2, locationIds: []
        }, props);
      }

      // Seed helpers: mimic logTing (snapped) vs a raw late timestamp.
      function withLog(h, ts, { snap = true } = {}) {
        const entry = snap ? snapLogTimestamp(h, ts) : ts;
        return Object.assign({}, h, { logs: [entry], lastLog: entry });
      }

      const windowedShell = mk({
        name: 'V late-snapped-window',
        target: 1,
        durationMinutes: 10,
        allowedTimeStart: 360, allowedTimeEnd: 600 // 6am–10am
      });

      const raw = [
        // ── daily state matrix ──
        mk({ name: 'V new', target: 1, durationMinutes: 10, priority: 1,
          createdAt: frozen, logs: [], lastLog: null }),
        withLog(mk({ name: 'V overdue', target: 1, durationMinutes: 10, priority: 1 }), ago5d),
        withLog(mk({ name: 'V yest-morning', target: 1, durationMinutes: 10, priority: 2 }), yestMorning),
        // Late last night, snapped to midnight (no window) — due this morning.
        withLog(mk({ name: 'V late-snapped-none', target: 1, durationMinutes: 10, priority: 2 }), yestLate, { snap: true }),
        // Late last night inside a morning window → snap to yesterday 6am.
        withLog(windowedShell, yestLate, { snap: true }),
        // Same late stamp WITHOUT snap — calendar daysSince is still 1 at 6am,
        // so the daily is due today (rolling-24h used to miss it until 11pm).
        withLog(mk({ name: 'V late-raw', target: 1, durationMinutes: 10, priority: 2 }), yestLate, { snap: false }),
        // Already completed today before "now" — skip today, resume tomorrow.
        withLog(mk({ name: 'V done-today', target: 1, durationMinutes: 10, priority: 2 }), todayEarly),
        // Raw target every 3d, logged 3d ago, ±2d flex → effectiveTarget 5,
        // pull-forward at age >= 3 so today is eligible only because of flex.
        withLog(mk({
          name: 'V flex-pull', target: 3, durationMinutes: 10, priority: 2,
          flexibilityDays: 2
        }), todayBase - 3 * 86400000 + 9 * 3600000),

        // ── multi-times state matrix ──
        mk({ name: 'V multi-new', target: targetFromRhythmParts(3, 7), durationMinutes: 15, priority: 1,
          createdAt: frozen, logs: [], lastLog: null }),
        withLog(mk({
          name: 'V multi-mid', target: targetFromRhythmParts(2, 7), durationMinutes: 15, priority: 3
        }), yestMorning),
        withLog(mk({
          name: 'V multi-overdue', target: targetFromRhythmParts(3, 7), durationMinutes: 15, priority: 1
        }), ago10d),
        withLog(mk({
          name: 'V every-3-mid', target: 3, durationMinutes: 15, priority: 3
        }), yestMorning)
      ];

      const data = normalize(raw);
      const settings = Object.assign({}, loadSortSettings(), {
        // Narrow but enough for the due dailies (~50–60m) + a few multis.
        availabilityMinutes: [120, 120, 120, 120, 120, 120, 120],
        availabilityOverrides: {},
        blockedTimes: [],
        locations: [],
        lastKnownLocationId: null,
        agendaOptimizer: false,
        showDueHabitsInAgenda: true,
        showPlannedItemsInAgenda: true
      });

      // Diagnostic: daysSince / eligibility for each variant at "now".
      const diagnostics = data.map(h => {
        const days = daysSince(h.lastLog);
        const target = effectiveTarget(h);
        const todayEligible = isWeekCandidate(h, settings, todayBase, new RealDate(todayBase).getDay());
        const snapOfLate = snapLogTimestamp(h, yestLate);
        return {
          name: h.name,
          target: h.target,
          flex: h.flexibilityDays,
          daysSince: days,
          effectiveTarget: target,
          lastLogMin: h.lastLog == null ? null : Math.round((h.lastLog - dayStart(h.lastLog)) / 60000),
          lastLogDayOffset: h.lastLog == null ? null : Math.round((dayStart(h.lastLog) - todayBase) / 86400000),
          todayEligible,
          lateSnapMin: Math.round((snapOfLate - dayStart(snapOfLate)) / 60000),
          lateSnapDayOffset: Math.round((dayStart(snapOfLate) - todayBase) / 86400000)
        };
      });

      const week = buildWeekAgenda(data, settings, 7);
      const byDay = week.days.map((d, i) => ({
        day: i,
        used: d.usedMinutes,
        rem: d.remainingMinutes,
        total: d.totalMinutes,
        fills: (d.timeline || []).filter(r => r.kind === 'fill').map(r => r.h.name)
      }));
      const placedDays = (name) => byDay.filter(d => d.fills.includes(name)).map(d => d.day);
      const counts = Object.fromEntries(data.map(h => [h.name, placedDays(h.name).length]));

      // Spare-capacity: every TODAY-eligible daily that is missing today must
      // be unable to fit in remaining minutes.
      const todayDueDailies = diagnostics
        .filter(d => d.todayEligible && Number(data.find(h => h.name === d.name).target) <= 1)
        .map(d => d.name);
      const spareBugs = [];
      for (const name of todayDueDailies) {
        if (byDay[0].fills.includes(name)) continue;
        const h = data.find(x => x.name === name);
        const need = clampDuration(h.durationMinutes);
        if (byDay[0].rem >= need) {
          spareBugs.push({ name, rem: byDay[0].rem, need, fills: byDay[0].fills });
        }
      }

      return {
        diagnostics,
        byDay,
        counts,
        placedDays: Object.fromEntries(data.map(h => [h.name, placedDays(h.name)])),
        spareBugs,
        todayDueDailies,
        yestLateRawDaysSince: daysSince(yestLate),
        yestLateSnappedNoneDaysSince: daysSince(dayStart(yestLate)),
        yestLateRawRolling24h: Math.floor((frozen - yestLate) / 86400000)
      };
    } finally {
      globalThis.Date = orig;
    }
  }, { frozen: FROZEN });

  console.log('  diagnostics:', JSON.stringify(variations.diagnostics, null, 2));
  console.log('  counts:', JSON.stringify(variations.counts));
  console.log('  placedDays:', JSON.stringify(variations.placedDays));

  // ── Eligibility / snap diagnostics ──
  check('raw late log (11pm→6am) has calendar daysSince 1 (due next morning)',
    variations.yestLateRawDaysSince === 1,
    `got ${variations.yestLateRawDaysSince}`);
  check('rolling-24h age of raw late log is still 0 (why the old check failed)',
    variations.yestLateRawRolling24h === 0,
    `got ${variations.yestLateRawRolling24h}`);
  check('snapped-to-midnight late log has daysSince 1 by 6am next morning',
    variations.yestLateSnappedNoneDaysSince === 1,
    `got ${variations.yestLateSnappedNoneDaysSince}`);

  const diag = (name) => variations.diagnostics.find(d => d.name === name);

  check('V new is today-eligible (never logged)',
    diag('V new').todayEligible === true);
  check('V overdue is today-eligible',
    diag('V overdue').todayEligible === true);
  check('V yest-morning is today-eligible',
    diag('V yest-morning').todayEligible === true);
  check('V late-snapped-none is today-eligible',
    diag('V late-snapped-none').todayEligible === true);
  check('V late-snapped-window snapped to 6am (360) yesterday',
    diag('V late-snapped-window').lastLogMin === 360
      && diag('V late-snapped-window').lastLogDayOffset === -1,
    JSON.stringify(diag('V late-snapped-window')));
  check('V late-snapped-window is today-eligible',
    diag('V late-snapped-window').todayEligible === true);
  check('V late-raw is today-eligible (calendar day, even without snap)',
    diag('V late-raw').todayEligible === true,
    JSON.stringify(diag('V late-raw')));
  check('V done-today is NOT today-eligible',
    diag('V done-today').todayEligible === false,
    JSON.stringify(diag('V done-today')));
  check('V flex-pull is today-eligible via flexibility',
    diag('V flex-pull').todayEligible === true,
    JSON.stringify(diag('V flex-pull')));
  check('V multi-new is today-eligible',
    diag('V multi-new').todayEligible === true);
  check('V multi-overdue is today-eligible',
    diag('V multi-overdue').todayEligible === true);
  check('V multi-mid is NOT today-eligible (age 1 < 3.5)',
    diag('V multi-mid').todayEligible === false,
    JSON.stringify(diag('V multi-mid')));
  check('V every-3-mid is NOT today-eligible (age 1 < 3)',
    diag('V every-3-mid').todayEligible === false,
    JSON.stringify(diag('V every-3-mid')));

  // ── Placement expectations ──
  const mustEveryDay = ['V new', 'V overdue', 'V yest-morning', 'V late-snapped-none', 'V late-snapped-window'];
  for (const name of mustEveryDay) {
    check(`${name} places on all 7 days`,
      variations.counts[name] === 7,
      `got ${variations.counts[name]}/7 days=${JSON.stringify(variations.placedDays[name])}`);
  }

  check('V late-raw places every day including today (calendar due)',
    variations.counts['V late-raw'] === 7
      && variations.placedDays['V late-raw'].join(',') === '0,1,2,3,4,5,6',
    `days=${JSON.stringify(variations.placedDays['V late-raw'])}`);

  check('V done-today skips today but places the other 6 days',
    variations.counts['V done-today'] === 6
      && !variations.placedDays['V done-today'].includes(0)
      && variations.placedDays['V done-today'].join(',') === '1,2,3,4,5,6',
    `days=${JSON.stringify(variations.placedDays['V done-today'])}`);

  check('V flex-pull places at least once before raw effectiveTarget (flex pull-forward)',
    variations.counts['V flex-pull'] >= 1
      && variations.placedDays['V flex-pull'].some(d => d <= 1),
    `days=${JSON.stringify(variations.placedDays['V flex-pull'])} (age on d0=3, raw due at age 5=d2)`);

  check('V multi-new places at least once',
    variations.counts['V multi-new'] >= 1,
    `got ${variations.counts['V multi-new']}`);
  check('V multi-overdue places at least once',
    variations.counts['V multi-overdue'] >= 1,
    `got ${variations.counts['V multi-overdue']}`);

  // Mid-cycle multis become eligible later in the week.
  {
    const mid = variations.placedDays['V multi-mid'];
    const every3 = variations.placedDays['V every-3-mid'];
    check('V multi-mid first lands on/after day 3 (spacing from yesterday)',
      mid.length === 0 || mid[0] >= 3,
      `days=${JSON.stringify(mid)}`);
    check('V every-3-mid first lands on/after day 2 (target 3, age was 1)',
      every3.length === 0 || every3[0] >= 2,
      `days=${JSON.stringify(every3)}`);
  }

  check('no spare capacity on today while a due daily is missing',
    variations.spareBugs.length === 0,
    JSON.stringify(variations.spareBugs));

  for (const day of variations.byDay) {
    check(`variations day ${day.day} used ≤ total`,
      day.used <= day.total + 0.01,
      `used=${day.used} total=${day.total}`);
  }

  // ── Fourth scenario: late-log snap through logTing under week packing ──
  console.log('\n[tight-rhythm-late-log] logTing snap then rebuild week');
  const lateLogLive = await page.evaluate(({ frozen }) => {
    const RealDate = Date;
    function FrozenDate(...args) {
      if (args.length === 0) return new RealDate(frozen);
      return new RealDate(...args);
    }
    FrozenDate.now = () => frozen;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate);
    FrozenDate.prototype = RealDate.prototype;
    const orig = globalThis.Date;
    globalThis.Date = FrozenDate;
    try {
      const todayBase = dayStart(frozen);
      const sunday11pm = todayBase - 86400000 + 23 * 3600000;

      const settings = Object.assign({}, loadSortSettings(), {
        availabilityMinutes: [90, 90, 90, 90, 90, 90, 90],
        availabilityOverrides: {},
        blockedTimes: [],
        locations: [],
        lastKnownLocationId: null,
        agendaOptimizer: false,
        showDueHabitsInAgenda: true
      });

      const shells = [
        {
          name: 'LL none', type: 'keepup', target: 1, durationMinutes: 20, priority: 1,
          flexibilityDays: 0, allowedTimeStart: null, allowedTimeEnd: null,
          preferredTimeStart: null, preferredTimeEnd: null,
          logs: [], lastLog: null, emoji: '', pinned: false, sample: false,
          snoozedUntil: null, topics: [], createdAt: frozen - 14 * 86400000
        },
        {
          name: 'LL window', type: 'keepup', target: 1, durationMinutes: 20, priority: 1,
          flexibilityDays: 0, allowedTimeStart: 360, allowedTimeEnd: 600,
          preferredTimeStart: null, preferredTimeEnd: null,
          logs: [], lastLog: null, emoji: '', pinned: false, sample: false,
          snoozedUntil: null, topics: [], createdAt: frozen - 14 * 86400000
        },
        {
          name: 'LL multi', type: 'keepup', target: targetFromRhythmParts(3, 7),
          durationMinutes: 10, priority: 2, flexibilityDays: 0,
          allowedTimeStart: null, allowedTimeEnd: null,
          preferredTimeStart: null, preferredTimeEnd: null,
          logs: [], lastLog: null, emoji: '', pinned: false, sample: false,
          snoozedUntil: null, topics: [], createdAt: frozen - 14 * 86400000
        }
      ];

      // Apply snap as logTing would at Sunday 11pm, then plan from Monday 6am.
      const logged = shells.map(h => {
        const ts = snapLogTimestamp(h, sunday11pm);
        return Object.assign({}, h, { logs: [ts], lastLog: ts });
      });
      logged.push({
        name: 'LL filler A', type: 'keepup', target: 1, durationMinutes: 20, priority: 2,
        flexibilityDays: 0, logs: [todayBase - 3 * 86400000], lastLog: todayBase - 3 * 86400000,
        allowedTimeStart: null, allowedTimeEnd: null, preferredTimeStart: null, preferredTimeEnd: null,
        emoji: '', pinned: false, sample: false, snoozedUntil: null, topics: [],
        createdAt: frozen - 20 * 86400000
      });
      logged.push({
        name: 'LL filler B', type: 'keepup', target: 1, durationMinutes: 20, priority: 2,
        flexibilityDays: 0, logs: [todayBase - 3 * 86400000], lastLog: todayBase - 3 * 86400000,
        allowedTimeStart: null, allowedTimeEnd: null, preferredTimeStart: null, preferredTimeEnd: null,
        emoji: '', pinned: false, sample: false, snoozedUntil: null, topics: [],
        createdAt: frozen - 20 * 86400000
      });

      const data = normalize(logged);
      const week = buildWeekAgenda(data, settings, 7);
      const byDay = week.days.map((d, i) => ({
        day: i,
        fills: (d.timeline || []).filter(r => r.kind === 'fill').map(r => r.h.name),
        used: d.usedMinutes,
        rem: d.remainingMinutes
      }));
      const info = (name) => {
        const h = data.find(x => x.name === name);
        return {
          lastLogMin: Math.round((h.lastLog - dayStart(h.lastLog)) / 60000),
          lastLogDayOffset: Math.round((dayStart(h.lastLog) - todayBase) / 86400000),
          daysSince: daysSince(h.lastLog),
          days: byDay.filter(d => d.fills.includes(name)).map(d => d.day)
        };
      };
      return {
        none: info('LL none'),
        window: info('LL window'),
        multi: info('LL multi'),
        fillerA: info('LL filler A'),
        todayFills: byDay[0].fills,
        todayRem: byDay[0].rem,
        byDay
      };
    } finally {
      globalThis.Date = orig;
    }
  }, { frozen: FROZEN });

  console.log('  lateLogLive:', JSON.stringify(lateLogLive, null, 2));

  check('LL none snapped to yesterday midnight (min 0)',
    lateLogLive.none.lastLogMin === 0 && lateLogLive.none.lastLogDayOffset === -1,
    JSON.stringify(lateLogLive.none));
  check('LL window snapped to yesterday 6am (min 360)',
    lateLogLive.window.lastLogMin === 360 && lateLogLive.window.lastLogDayOffset === -1,
    JSON.stringify(lateLogLive.window));
  check('LL none is due again Monday (daysSince ≥ 1)',
    lateLogLive.none.daysSince >= 1,
    `daysSince=${lateLogLive.none.daysSince}`);
  check('LL window is due again Monday (daysSince ≥ 1)',
    lateLogLive.window.daysSince >= 1,
    `daysSince=${lateLogLive.window.daysSince}`);
  check('LL none places every day including today after late-night snap',
    lateLogLive.none.days.length === 7 && lateLogLive.none.days[0] === 0,
    `days=${JSON.stringify(lateLogLive.none.days)}`);
  check('LL window places every day including today after late-night snap',
    lateLogLive.window.days.length === 7 && lateLogLive.window.days[0] === 0,
    `days=${JSON.stringify(lateLogLive.window.days)}`);
  check('LL multi places at least once this week after late-night snap',
    lateLogLive.multi.days.length >= 1,
    `days=${JSON.stringify(lateLogLive.multi.days)} daysSince=${lateLogLive.multi.daysSince}`);
  check('LL multi first lands on/after day 2 (target ~2.5, age was 1 after snap)',
    lateLogLive.multi.days.length === 0 || lateLogLive.multi.days[0] >= 2,
    `days=${JSON.stringify(lateLogLive.multi.days)}`);
  check('late-log Monday still packs competing dailies (fillers present today)',
    lateLogLive.todayFills.includes('LL filler A') && lateLogLive.todayFills.includes('LL filler B'),
    `today=${JSON.stringify(lateLogLive.todayFills)}`);

  // ── Fifth scenario: blocked hours + dynamic anchors + mixed windows ──
  console.log('\n[tight-rhythm-blocked] sleep/meals/work/sunset carve gaps; habits must pack into them');
  const blocked = await page.evaluate(({ frozen }) => {
    const RealDate = Date;
    function FrozenDate(...args) {
      if (args.length === 0) return new RealDate(frozen);
      return new RealDate(...args);
    }
    FrozenDate.now = () => frozen;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate);
    FrozenDate.prototype = RealDate.prototype;
    const orig = globalThis.Date;
    globalThis.Date = FrozenDate;
    try {
      const HOME = 'home';
      const todayBase = dayStart(frozen);
      const ago = (d, h = 9) => todayBase - d * 86400000 + h * 3600000;

      function mk(props) {
        return Object.assign({
          type: 'keepup', flexibilityDays: 0, durationMinutes: 10, priority: 2,
          allowedTimeStart: null, allowedTimeEnd: null,
          preferredTimeStart: null, preferredTimeEnd: null,
          locationIds: [], logs: [ago(1)], lastLog: ago(1),
          emoji: '', pinned: false, sample: false, snoozedUntil: null, topics: [],
          allowedWeekdays: [], allowedMonthDays: [], preferredWeekdays: [], preferredMonthDays: [],
          dueDate: null, eventTime: null, hardDue: false, markDone: true,
          createdAt: frozen - 30 * 86400000, target: 1
        }, props);
      }

      const lateShell = mk({
        name: 'BH late-log floss', durationMinutes: 5, priority: 1,
        // Nightly floss after isha — late log snaps to isha+30.
        allowedTimeStartAnchor: 'isha', allowedTimeStartOffsetMin: 30,
        allowedTimeEndAnchor: 'isha', allowedTimeEndOffsetMin: 85
      });
      const lateTs = snapLogTimestamp(lateShell, ago(1, 23));

      const raw = [
        // ── dawn / sunrise cluster (all dynamic) ──
        mk({
          name: 'BH Fajr', durationMinutes: 5, priority: 0,
          allowedTimeStartAnchor: 'fajr', allowedTimeStartOffsetMin: 0,
          allowedTimeEndAnchor: 'sunrise', allowedTimeEndOffsetMin: -5
        }),
        mk({
          name: 'BH Quran', durationMinutes: 10, priority: 0,
          allowedTimeStartAnchor: 'fajr', allowedTimeStartOffsetMin: 10,
          allowedTimeEndAnchor: 'sunrise', allowedTimeEndOffsetMin: -10
        }),
        mk({
          name: 'BH Sunrise stretch', durationMinutes: 5, priority: 1,
          allowedTimeStartAnchor: 'sunrise', allowedTimeStartOffsetMin: 5,
          allowedTimeEndAnchor: 'sunrise', allowedTimeEndOffsetMin: 35
        }),
        mk({
          name: 'BH Morning review', durationMinutes: 15, priority: 1,
          // After stretch window, before a sunrise-anchored breakfast block.
          allowedTimeStartAnchor: 'sunrise', allowedTimeStartOffsetMin: 40,
          allowedTimeEndAnchor: 'sunrise', allowedTimeEndOffsetMin: 95
        }),
        mk({
          name: 'BH Hydrate', durationMinutes: 5, priority: 2,
          allowedTimeStartAnchor: 'sunrise', allowedTimeStartOffsetMin: 40,
          allowedTimeEndAnchor: 'sunrise', allowedTimeEndOffsetMin: 100,
          preferredTimeStartAnchor: 'sunrise', preferredTimeStartOffsetMin: 50
        }),

        // ── midday (dhuhr-anchored) ──
        mk({
          name: 'BH Dhuhr', durationMinutes: 5, priority: 0,
          allowedTimeStartAnchor: 'dhuhr', allowedTimeStartOffsetMin: 0,
          allowedTimeEndAnchor: 'dhuhr', allowedTimeEndOffsetMin: 40
        }),
        mk({
          name: 'BH Lunch walk', durationMinutes: 15, priority: 2,
          // After dynamic lunch block (dhuhr−10…dhuhr+25).
          allowedTimeStartAnchor: 'dhuhr', allowedTimeStartOffsetMin: 30,
          allowedTimeEndAnchor: 'asr', allowedTimeEndOffsetMin: -60
        }),
        mk({
          name: 'BH Midday vitamins', durationMinutes: 5, priority: 2,
          allowedTimeStartAnchor: 'dhuhr', allowedTimeStartOffsetMin: 30,
          allowedTimeEndAnchor: 'dhuhr', allowedTimeEndOffsetMin: 70
        }),

        // ── afternoon / sunset (asr → maghrib) ──
        mk({
          name: 'BH Asr', durationMinutes: 5, priority: 0,
          allowedTimeStartAnchor: 'asr', allowedTimeStartOffsetMin: 0,
          allowedTimeEndAnchor: 'asr', allowedTimeEndOffsetMin: 45
        }),
        mk({
          name: 'BH Sunset walk', durationMinutes: 15, priority: 2,
          allowedTimeStartAnchor: 'asr', allowedTimeStartOffsetMin: 60,
          allowedTimeEndAnchor: 'maghrib', allowedTimeEndOffsetMin: -25
        }),
        mk({
          name: 'BH Maghrib', durationMinutes: 10, priority: 0,
          allowedTimeStartAnchor: 'maghrib', allowedTimeStartOffsetMin: 5,
          allowedTimeEndAnchor: 'maghrib', allowedTimeEndOffsetMin: 45
        }),
        mk({
          name: 'BH Gratitude', durationMinutes: 5, priority: 2,
          allowedTimeStartAnchor: 'maghrib', allowedTimeStartOffsetMin: 50,
          allowedTimeEndAnchor: 'isha', allowedTimeEndOffsetMin: -15
        }),

        // ── evening / night (before sleep @ isha+90) ──
        mk({
          name: 'BH Dinner dishes', durationMinutes: 15, priority: 2,
          allowedTimeStartAnchor: 'maghrib', allowedTimeStartOffsetMin: 105,
          allowedTimeEndAnchor: 'isha', allowedTimeEndOffsetMin: 80
        }),
        mk({
          name: 'BH Isha', durationMinutes: 10, priority: 0,
          allowedTimeStartAnchor: 'isha', allowedTimeStartOffsetMin: 0,
          allowedTimeEndAnchor: 'isha', allowedTimeEndOffsetMin: 40
        }),
        mk({
          name: 'BH Shower', durationMinutes: 10, priority: 1, locationIds: [HOME],
          allowedTimeStartAnchor: 'isha', allowedTimeStartOffsetMin: 15,
          allowedTimeEndAnchor: 'isha', allowedTimeEndOffsetMin: 70
        }),
        mk({
          name: 'BH Journal', durationMinutes: 15, priority: 2,
          allowedTimeStartAnchor: 'isha', allowedTimeStartOffsetMin: 20,
          allowedTimeEndAnchor: 'isha', allowedTimeEndOffsetMin: 85,
          preferredTimeStartAnchor: 'isha', preferredTimeStartOffsetMin: 45
        }),
        // Soft preferred only (still flexible placement).
        mk({
          name: 'BH Inbox', durationMinutes: 20, priority: 3,
          preferredTimeStartAnchor: 'asr', preferredTimeStartOffsetMin: 30,
          preferredTimeEndAnchor: 'maghrib', preferredTimeEndOffsetMin: -60
        }),
        Object.assign(lateShell, { logs: [lateTs], lastLog: lateTs }),
        mk({
          name: 'BH New habit', durationMinutes: 10, priority: 1,
          logs: [], lastLog: null, createdAt: frozen,
          allowedTimeStartAnchor: 'sunrise', allowedTimeStartOffsetMin: 100,
          allowedTimeEndAnchor: 'dhuhr', allowedTimeEndOffsetMin: -30
        }),

        // Multi-times with dynamic windows
        mk({
          name: 'BH Laundry', target: targetFromRhythmParts(3, 7),
          durationMinutes: 20, priority: 2,
          allowedTimeStartAnchor: 'asr', allowedTimeStartOffsetMin: 0,
          allowedTimeEndAnchor: 'maghrib', allowedTimeEndOffsetMin: -30
        }),
        mk({
          name: 'BH Groceries', target: 3, durationMinutes: 25, priority: 2,
          locationIds: [HOME],
          allowedTimeStartAnchor: 'dhuhr', allowedTimeStartOffsetMin: 40,
          allowedTimeEndAnchor: 'asr', allowedTimeEndOffsetMin: 30
        }),
        mk({
          name: 'BH Deep clean', target: targetFromRhythmParts(2, 7),
          durationMinutes: 30, priority: 3,
          allowedTimeStartAnchor: 'sunrise', allowedTimeStartOffsetMin: 120,
          allowedTimeEndAnchor: 'dhuhr', allowedTimeEndOffsetMin: -60
        })
      ];

      const settings = Object.assign({}, loadSortSettings(), {
        // Tight vs fragmented open time — availability is the soft budget;
        // blocks carve the hard gaps.
        availabilityMinutes: [180, 180, 180, 180, 180, 240, 240],
        availabilityOverrides: {},
        locations: [{ id: HOME, name: 'Home', lat: 40.734852, lng: -74.003584 }],
        lastKnownLocationId: HOME,
        prayerMethod: 'NorthAmerica',
        prayerMadhab: 'shafi',
        blockedTimes: [
          // Sleep @ isha+90 so isha-window habits have a real evening gap.
          {
            label: 'sleep', days: [], locationId: HOME, start: 1320, end: 420,
            startAnchor: 'sunrise', startOffsetMin: -480,
            startCombine: 'later', startAnchor2: 'isha', startOffsetMin2: 90,
            startDayOffset: 1, startDayOffset2: 0,
            endAnchor: 'sunrise', endOffsetMin: -30
          },
          {
            label: 'breakfast', days: [], locationId: HOME, start: 480, end: 510,
            startAnchor: 'sunrise', startOffsetMin: 100,
            endAnchor: 'sunrise', endOffsetMin: 130
          },
          { label: 'work am', days: [1, 2, 3, 4, 5], start: 540, end: 720 },
          {
            label: 'lunch', days: [], locationId: HOME, start: 720, end: 750,
            startAnchor: 'dhuhr', startOffsetMin: -10,
            endAnchor: 'dhuhr', endOffsetMin: 25
          },
          // After summer dhuhr so dhuhr-anchored habits can place on weekdays.
          { label: 'work pm', days: [1, 2, 3, 4, 5], start: 840, end: 1020 }, // 2–5
          {
            label: 'sunset', days: [], locationId: HOME, start: 1080, end: 1140,
            startAnchor: 'maghrib', startOffsetMin: -20,
            endAnchor: 'maghrib', endOffsetMin: 5
          },
          {
            label: 'dinner', days: [], locationId: HOME, start: 1140, end: 1200,
            startAnchor: 'maghrib', startOffsetMin: 55,
            endAnchor: 'maghrib', endOffsetMin: 100
          }
        ],
        showWeekOnHome: true,
        showDueHabitsInAgenda: true,
        showPlannedItemsInAgenda: true,
        agendaOptimizer: false
      });

      // Persist so prayer/block resolvers that read loadSortSettings() agree.
      saveSortSettings(settings);
      if (typeof sortSettings !== 'undefined' && sortSettings) Object.assign(sortSettings, settings);

      const data = normalize(raw);
      const week = buildWeekAgenda(data, settings, 7);

      function overlapsBlock(placeMin, endMin, blockIntervals) {
        return blockIntervals.some(b => placeMin < b.end && endMin > b.start);
      }

      const byDay = week.days.map((d, i) => {
        const fills = (d.timeline || []).filter(r => r.kind === 'fill').map(r => ({
          name: r.h.name,
          min: Math.round((r.start - d.dayBase) / 60000),
          end: Math.round((r.end - d.dayBase) / 60000)
        }));
        const slots = (d.slots || []).map(s => ({
          a: Math.round((s.start - d.dayBase) / 60000),
          b: Math.round((s.end - d.dayBase) / 60000)
        }));
        // Resolved blocked intervals for this weekday (fixed + dynamic).
        const blockIntervals = [];
        for (const b of normalizeBlockedTimes(settings.blockedTimes)) {
          if (b.days.length && !b.days.includes(d.weekday)) continue;
          let start = b.start;
          let end = b.end;
          if (b.startAnchor || b.endAnchor) {
            const loc = settings.locations.find(l => l.id === b.locationId);
            if (loc) {
              if (b.startAnchor) {
                const sm = resolvePrayerExprMinutes(
                  { latitude: loc.lat, longitude: loc.lng },
                  b.startAnchor, b.startOffsetMin, d.dayBase, b.startDayOffset
                );
                let s2 = null;
                if (b.startCombine && b.startAnchor2) {
                  s2 = resolvePrayerExprMinutes(
                    { latitude: loc.lat, longitude: loc.lng },
                    b.startAnchor2, b.startOffsetMin2, d.dayBase, b.startDayOffset2
                  );
                }
                const combined = combineResolvedMinutes(sm, s2, b.startCombine);
                if (combined != null) start = ((combined % 1440) + 1440) % 1440;
              }
              if (b.endAnchor) {
                const em = resolvePrayerExprMinutes(
                  { latitude: loc.lat, longitude: loc.lng },
                  b.endAnchor, b.endOffsetMin, d.dayBase, b.endDayOffset
                );
                if (em != null) end = ((em % 1440) + 1440) % 1440;
              }
            }
          }
          if (start !== end) blockIntervals.push({ label: b.label, start, end });
        }

        const inBlock = fills.filter(f => overlapsBlock(f.min, f.end, blockIntervals));

        // Window checks for prayer / fixed-window habits that placed.
        const windowMiss = [];
        for (const f of fills) {
          const h = data.find(x => x.name === f.name);
          if (!h || !hasTimeWindow(h)) continue;
          const win = fillTimeWindow(h, d.dayBase, HOME);
          if (!win) continue; // unresolved → skip (separate assertion covers resolve)
          const wStart = Math.round((win.start - d.dayBase) / 60000);
          const wEnd = Math.round((win.end - d.dayBase) / 60000);
          if (f.min < wStart || f.end > wEnd + 1) {
            windowMiss.push({ name: f.name, place: [f.min, f.end], win: [wStart, wEnd] });
          }
        }

        // Due dailies missing despite leftover availability + a gap that fits.
        const dailies = data.filter(h => Number(h.target) <= 1);
        const missingDue = [];
        const spareFit = [];
        for (const h of dailies) {
          if (fills.some(f => f.name === h.name)) continue;
          if (!isWeekCandidate(h, settings, d.dayBase, d.weekday)) continue;
          missingDue.push(h.name);
          const need = clampDuration(h.durationMinutes);
          if (d.remainingMinutes < need) continue;
          // Rebuild state with committed fills, then try the missing habit.
          const state = createDayPlacementState(
            Object.assign({}, d, { agendaItems: [], timeline: (d.timeline || []).filter(r => r.kind === 'scheduled') }),
            settings,
            { dayBase: d.dayBase, weekday: d.weekday, weekMode: true }
          );
          for (const row of (d.timeline || []).filter(r => r.kind === 'fill')) {
            const fill = {
              h: row.h, i: data.findIndex(x => x.name === row.h.name),
              priority: effectivePriority(row.h), scarcity: 0
            };
            const fit = tryPlaceOnDay(state, fill, { settings, allowNetwork: true });
            if (fit) commitPlacement(state, fill, fit);
          }
          const probe = tryPlaceOnDay(
            state,
            { h, i: data.findIndex(x => x.name === h.name), priority: effectivePriority(h), scarcity: 0 },
            { settings, allowNetwork: true }
          );
          if (probe) {
            spareFit.push({
              name: h.name,
              rem: d.remainingMinutes,
              need,
              wouldPlaceMin: Math.round((probe.placeStart - d.dayBase) / 60000)
            });
          }
        }

        return {
          day: i,
          weekday: d.weekday,
          used: d.usedMinutes,
          rem: d.remainingMinutes,
          total: d.totalMinutes,
          slots,
          fills,
          blockIntervals,
          inBlock,
          windowMiss,
          missingDue,
          spareFit
        };
      });

      const counts = Object.fromEntries(
        data.map(h => [h.name, byDay.filter(d => d.fills.some(f => f.name === h.name)).length])
      );

      // Prayer windows must resolve (settings seeded).
      const maghrib = data.find(h => h.name === 'BH Maghrib');
      const maghribWin = fillTimeWindow(maghrib, todayBase + 86400000, HOME);

      // Manual plan rescue for first spareFit on a weekday (days 1–4).
      let rescue = null;
      const rescueDay = byDay.find(d => d.day >= 1 && d.day <= 4 && d.spareFit.length);
      if (rescueDay) {
        const name = rescueDay.spareFit[0].name;
        const dayBase = week.days[rescueDay.day].dayBase;
        const data2 = normalize(data.map(h => {
          if (h.name !== name) return h;
          return Object.assign({}, h, {
            logs: [...(h.logs || []), { ts: dayBase + 10 * 3600000, plan: true }]
          });
        }));
        const week2 = buildWeekAgenda(data2, settings, 7);
        const fills2 = (week2.days[rescueDay.day].timeline || [])
          .filter(r => r.kind === 'fill').map(r => r.h.name);
        const beforeNames = rescueDay.fills.map(f => f.name);
        rescue = {
          day: rescueDay.day,
          name,
          placed: fills2.includes(name),
          othersKept: beforeNames.every(n => n === name || fills2.includes(n)),
          fillsBefore: beforeNames,
          fillsAfter: fills2,
          remAfter: week2.days[rescueDay.day].remainingMinutes
        };
      }

      // Sunrise stretch vs flexible Inbox on tomorrow morning gap.
      const tom = byDay[1];
      const sunrise = tom.fills.find(f => f.name === 'BH Sunrise stretch');
      const inbox = tom.fills.find(f => f.name === 'BH Inbox');
      const breakfast = tom.blockIntervals.find(b => b.label === 'breakfast');
      const dynamicHabitNames = data
        .filter(h => hasTimeWindow(h) && (
          h.allowedTimeStartAnchor || h.allowedTimeEndAnchor
        ))
        .map(h => h.name);

      return {
        counts,
        byDay,
        rescue,
        maghribWinMin: maghribWin
          ? {
              s: Math.round((maghribWin.start - (todayBase + 86400000)) / 60000),
              e: Math.round((maghribWin.end - (todayBase + 86400000)) / 60000)
            }
          : null,
        sunriseTom: sunrise || null,
        inboxTom: inbox || null,
        breakfastTom: breakfast || null,
        tomSlots: tom.slots,
        dynamicHabitNames,
        dynamicHabitCount: dynamicHabitNames.length,
        spareFitTotal: byDay.reduce((n, d) => n + d.spareFit.length, 0),
        inBlockTotal: byDay.reduce((n, d) => n + d.inBlock.length, 0),
        windowMissTotal: byDay.reduce((n, d) => n + d.windowMiss.length, 0)
      };
    } finally {
      globalThis.Date = orig;
    }
  }, { frozen: FROZEN });

  console.log('  counts:', JSON.stringify(blocked.counts));
  console.log('  maghribWin:', JSON.stringify(blocked.maghribWinMin));
  console.log('  tomSlots:', JSON.stringify(blocked.tomSlots));
  console.log('  spareFitTotal:', blocked.spareFitTotal, 'rescue:', JSON.stringify(blocked.rescue));
  if (blocked.spareFitTotal) {
    console.log('  spareFit detail:', JSON.stringify(blocked.byDay.map(d => ({
      day: d.day, spareFit: d.spareFit, missingDue: d.missingDue, rem: d.rem, fills: d.fills.map(f => f.name)
    })), null, 2));
  }

  check('prayer windows resolve with seeded home location (maghrib tomorrow)',
    blocked.maghribWinMin != null && blocked.maghribWinMin.s > 1000 && blocked.maghribWinMin.e > blocked.maghribWinMin.s,
    JSON.stringify(blocked.maghribWinMin));

  check('most habits use dynamic prayer-anchored windows',
    blocked.dynamicHabitCount >= 16,
    `got ${blocked.dynamicHabitCount}: ${JSON.stringify(blocked.dynamicHabitNames)}`);

  check('no fill overlaps a blocked interval across the week',
    blocked.inBlockTotal === 0,
    JSON.stringify(blocked.byDay.flatMap(d => d.inBlock.map(x => ({ day: d.day, ...x })))));

  check('no fill lands outside its allowed/prayer window',
    blocked.windowMissTotal === 0,
    JSON.stringify(blocked.byDay.flatMap(d => d.windowMiss.map(x => ({ day: d.day, ...x })))));

  // Core dynamic dailies should appear most days when their gaps exist.
  // These windows were chosen to sit in open gaps (not inside dinner/sleep);
  // skips here are planner bugs, not "the block covers the allowed time".
  for (const name of [
    'BH Shower', 'BH Journal', 'BH late-log floss', 'BH Dinner dishes',
    'BH Maghrib', 'BH Isha', 'BH Sunrise stretch'
  ]) {
    check(`${name} places on at least 6 of 7 days (window clears blocks)`,
      blocked.counts[name] >= 6,
      `got ${blocked.counts[name]}/7`);
  }

  check('BH Fajr / Quran place on future dawn gaps',
    blocked.counts['BH Fajr'] + blocked.counts['BH Quran'] >= 6,
    JSON.stringify({ fajr: blocked.counts['BH Fajr'], quran: blocked.counts['BH Quran'] }));
  check('BH Dhuhr places on future days',
    blocked.counts['BH Dhuhr'] >= 4,
    `got ${blocked.counts['BH Dhuhr']}`);
  check('BH Lunch walk (dhuhr→asr) places most days',
    blocked.counts['BH Lunch walk'] >= 3,
    `got ${blocked.counts['BH Lunch walk']}`);
  check('BH Morning review (sunrise-anchored) places most days',
    blocked.counts['BH Morning review'] >= 3,
    `got ${blocked.counts['BH Morning review']}`);
  check('BH Sunset walk (asr→maghrib) places most days',
    blocked.counts['BH Sunset walk'] >= 3,
    `got ${blocked.counts['BH Sunset walk']}`);
  check('BH New habit (sunrise→dhuhr) places most days',
    blocked.counts['BH New habit'] >= 3,
    `got ${blocked.counts['BH New habit']}`);

  // Scarcity: sunrise stays before the dynamic breakfast block when it places.
  if (blocked.sunriseTom && blocked.breakfastTom) {
    check('BH Sunrise stretch on tomorrow stays before dynamic breakfast',
      blocked.sunriseTom.end <= blocked.breakfastTom.start,
      `sunrise=${JSON.stringify(blocked.sunriseTom)} breakfast=${JSON.stringify(blocked.breakfastTom)}`);
  } else {
    check('BH Sunrise stretch on tomorrow stays before dynamic breakfast',
      Boolean(blocked.sunriseTom),
      `sunrise=${JSON.stringify(blocked.sunriseTom)} breakfast=${JSON.stringify(blocked.breakfastTom)}`);
  }

  // Flexible inbox may share a gap but must not displace the sunrise fill.
  if (blocked.sunriseTom && blocked.inboxTom) {
    check('BH Inbox does not overlap the seated Sunrise stretch fill',
      blocked.inboxTom.min >= blocked.sunriseTom.end || blocked.inboxTom.end <= blocked.sunriseTom.min,
      `sunrise=${JSON.stringify(blocked.sunriseTom)} inbox=${JSON.stringify(blocked.inboxTom)}`);
  } else {
    check('BH Inbox does not overlap the seated Sunrise stretch fill', true, 'inbox not on tomorrow');
  }

  check('multi-times still place somewhere in the blocked week',
    blocked.counts['BH Laundry'] + blocked.counts['BH Groceries'] + blocked.counts['BH Deep clean'] >= 2,
    JSON.stringify({
      laundry: blocked.counts['BH Laundry'],
      groceries: blocked.counts['BH Groceries'],
      deep: blocked.counts['BH Deep clean']
    }));

  // The reported symptom: leftover gap that fits a due habit the planner skipped.
  check('no due habit left unplaced while a real open gap still fits it',
    blocked.spareFitTotal === 0,
    JSON.stringify(blocked.byDay.filter(d => d.spareFit.length).map(d => ({
      day: d.day, rem: d.rem, spareFit: d.spareFit, fills: d.fills.map(f => f.name)
    }))));

  if (blocked.rescue) {
    check('manual plan places the skipped habit on that day',
      blocked.rescue.placed,
      JSON.stringify(blocked.rescue));
    check('manual plan keeps the other fills already on that day',
      blocked.rescue.othersKept,
      JSON.stringify(blocked.rescue));
  } else {
    check('manual plan rescue not needed (no spare-fit skips)', true);
  }

  for (const day of blocked.byDay) {
    check(`blocked day ${day.day} used ≤ availability total`,
      day.used <= day.total + 0.01,
      `used=${day.used} total=${day.total}`);
  }

  // ── Sixth scenario: preferred evening blanked all week by morning flex ──
  // Blocks carve a real evening gap; availability is spent ASAP in the morning
  // by higher-priority flex. Preferred-only habits used to stay off the agenda
  // every day (rem=0, evening open) until a manual plan forced them on.
  console.log('\n[tight-rhythm-pref-evening] preferred evening must not blank the whole week');
  const prefEve = await page.evaluate(({ frozen }) => {
    const RealDate = Date;
    function FrozenDate(...args) {
      if (args.length === 0) return new RealDate(frozen);
      return new RealDate(...args);
    }
    FrozenDate.now = () => frozen;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate);
    FrozenDate.prototype = RealDate.prototype;
    const orig = globalThis.Date;
    globalThis.Date = FrozenDate;
    try {
      const HOME = 'home';
      const todayBase = dayStart(frozen);
      const ago = todayBase - 86400000 + 9 * 3600000;
      const inbox = {
        name: 'PE Inbox', type: 'keepup', target: 1, durationMinutes: 20, priority: 3,
        preferredTimeStartAnchor: 'isha', preferredTimeStartOffsetMin: 30,
        preferredTimeEndAnchor: 'isha', preferredTimeEndOffsetMin: 80,
        allowedTimeStart: null, allowedTimeEnd: null,
        logs: [ago], lastLog: ago, flexibilityDays: 0, locationIds: [],
        emoji: '', pinned: false, topics: [], createdAt: frozen
      };
      const flex = Array.from({ length: 5 }, (_, i) => ({
        name: 'PE Flex ' + i, type: 'keepup', target: 1, durationMinutes: 20, priority: 1,
        logs: [ago], lastLog: ago, flexibilityDays: 0, locationIds: [],
        emoji: '', pinned: false, topics: [], createdAt: frozen
      }));
      const settings = Object.assign({}, loadSortSettings(), {
        availabilityMinutes: [80, 80, 80, 80, 80, 80, 80],
        locations: [{ id: HOME, name: 'Home', lat: 40.734852, lng: -74.003584 }],
        lastKnownLocationId: HOME,
        prayerMethod: 'NorthAmerica',
        prayerMadhab: 'shafi',
        blockedTimes: [
          {
            label: 'sleep', days: [], locationId: HOME, start: 1320, end: 420,
            startAnchor: 'sunrise', startOffsetMin: -480,
            startCombine: 'later', startAnchor2: 'isha', startOffsetMin2: 90,
            startDayOffset: 1, startDayOffset2: 0,
            endAnchor: 'sunrise', endOffsetMin: -30
          },
          { label: 'work am', days: [1, 2, 3, 4, 5], start: 540, end: 720 },
          { label: 'work pm', days: [1, 2, 3, 4, 5], start: 780, end: 1020 },
          {
            label: 'dinner', days: [], locationId: HOME, start: 1140, end: 1200,
            startAnchor: 'maghrib', startOffsetMin: 55,
            endAnchor: 'maghrib', endOffsetMin: 100
          }
        ],
        showDueHabitsInAgenda: true,
        showWeekOnHome: true,
        showPlannedItemsInAgenda: true,
        agendaOptimizer: false
      });
      saveSortSettings(settings);
      if (typeof sortSettings !== 'undefined' && sortSettings) Object.assign(sortSettings, settings);
      const data = normalize([inbox, ...flex]);
      const week = buildWeekAgenda(data, settings, 7);
      const byDay = week.days.map((d, i) => {
        const fills = (d.timeline || []).filter(r => r.kind === 'fill').map(r => ({
          name: r.h.name,
          min: Math.round((r.start - d.dayBase) / 60000)
        }));
        const slots = (d.slots || []).map(s => ({
          a: Math.round((s.start - d.dayBase) / 60000),
          b: Math.round((s.end - d.dayBase) / 60000)
        }));
        return {
          day: i,
          rem: d.remainingMinutes,
          fills,
          hasInbox: fills.some(f => f.name === 'PE Inbox'),
          inboxMin: (fills.find(f => f.name === 'PE Inbox') || {}).min,
          eveningOpen: slots.some(s => s.b > 1320 && s.a < 1400)
        };
      });
      return {
        count: byDay.filter(d => d.hasInbox).length,
        byDay,
        eveningOpenDays: byDay.filter(d => d.eveningOpen).length
      };
    } finally {
      globalThis.Date = orig;
    }
  }, { frozen: FROZEN });

  console.log('  pref-evening:', JSON.stringify({
    count: prefEve.count,
    days: prefEve.byDay.map(d => ({ day: d.day, has: d.hasInbox, at: d.inboxMin, rem: d.rem }))
  }));
  check('preferred evening inbox places all 7 days (not blanked by morning flex)',
    prefEve.count === 7,
    `got ${prefEve.count}/7`);
  check('preferred evening landings stay in the evening gap',
    prefEve.byDay.every(d => d.inboxMin == null || d.inboxMin >= 1200),
    JSON.stringify(prefEve.byDay.map(d => d.inboxMin)));
  check('evening open slots exist across the week (blocks are not covering the preference)',
    prefEve.eveningOpenDays >= 5,
    `eveningOpenDays=${prefEve.eveningOpenDays}`);

  await browser.close();
  if (failures.length) {
    console.error(`\n${failures.length} failure(s):\n` + failures.map(f => '  - ' + f).join('\n'));
    process.exit(1);
  }
  console.log('\nAll tight-rhythm capacity checks passed.');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
