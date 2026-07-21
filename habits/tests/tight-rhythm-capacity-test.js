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
//   - logged late last night RAW (no snap) — documents the daysSince=0 pitfall
//   - already logged today (must skip today, resume tomorrow)
//   - morning-window daily logged after the window closed (snapped to window start)
//   - flexibility pull-forward (not yet due on raw target, eligible via flex)
//   - multi-times that are new, mid-cycle, or overdue
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
        // Same late stamp WITHOUT snap — daysSince at 6am is 0, so today is missed.
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
        yestLateRawDaysSince: Math.floor((frozen - yestLate) / 86400000),
        yestLateSnappedNoneDaysSince: Math.floor((frozen - dayStart(yestLate)) / 86400000)
      };
    } finally {
      globalThis.Date = orig;
    }
  }, { frozen: FROZEN });

  console.log('  diagnostics:', JSON.stringify(variations.diagnostics, null, 2));
  console.log('  counts:', JSON.stringify(variations.counts));
  console.log('  placedDays:', JSON.stringify(variations.placedDays));

  // ── Eligibility / snap diagnostics ──
  check('raw late log (11pm→6am) has daysSince 0 (the pitfall snap fixes)',
    variations.yestLateRawDaysSince === 0,
    `got ${variations.yestLateRawDaysSince}`);
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
  check('V late-raw is NOT today-eligible (unsapped 11pm)',
    diag('V late-raw').todayEligible === false,
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

  check('V late-raw skips today but places the other 6 days',
    variations.counts['V late-raw'] === 6
      && !variations.placedDays['V late-raw'].includes(0)
      && variations.placedDays['V late-raw'].join(',') === '1,2,3,4,5,6',
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
