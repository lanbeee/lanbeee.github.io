// Regression coverage for fractional rhythms and rhythms whose allowed
// calendar dates constrain the available completion opportunities. If the user
// asks for 3x/7d and allows only Tue/Fri/Sat, completing Tuesday and Friday
// must not make Saturday disappear. Month days and non-week ratios (5x/8d)
// follow the same effective-frequency model.
//
// Run after starting the app, for example:
//   HABITS_URL=http://127.0.0.1:4181/ node tests/constrained-weekly-agenda-test.js

const { chromium } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let passed = 0;
let failed = 0;

function check(condition, message, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ok: ${message}`);
    return;
  }
  failed += 1;
  console.error(`  not ok: ${message}${detail ? ` :: ${detail}` : ''}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error)));

  try {
    await page.goto(BASE, { waitUntil: 'load' });

    const results = await page.evaluate(() => {
      const RealDate = Date;

      function localTs(year, monthIndex, day, hour = 8) {
        return new RealDate(year, monthIndex, day, hour, 0, 0, 0).getTime();
      }

      function habit(name, target, allowedWeekdays, lastLog, allowedMonthDays = [], logs = null) {
        return {
          hid: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
          name,
          type: 'keepup',
          target,
          flexibilityDays: 0,
          durationMinutes: 30,
          breakable: false,
          minChunkMinutes: 30,
          allowedTimeStart: null,
          allowedTimeEnd: null,
          preferredTimeStart: null,
          preferredTimeEnd: null,
          lastLog,
          logs: logs || (lastLog == null ? [] : [lastLog]),
          emoji: '',
          pinned: false,
          sample: false,
          snoozedUntil: null,
          topics: [],
          allowedWeekdays,
          allowedMonthDays,
          preferredWeekdays: [],
          preferredMonthDays: [],
          dueDate: null,
          eventTime: null,
          planByDate: null,
          hardDue: false,
          markDone: true,
          createdAt: localTs(2026, 0, 1),
          locationIds: [],
          anywhereAllowed: true,
          priority: 2,
          scheduleLinks: []
        };
      }

      const settings = {
        ...DEFAULT_SORT_SETTINGS,
        preset: 'todayFirst',
        agendaOptimizer: false,
        showWeekOnHome: false,
        showDueHabitsInAgenda: true,
        showPlannedItemsInAgenda: true,
        availabilityMinutes: [1440, 1440, 1440, 1440, 1440, 1440, 1440],
        availabilityOverrides: {},
        blockedTimes: [],
        locations: [],
        travel: {}
      };

      function agendaResult({ now, name, target, weekdays = [], monthDays = [], lastLog, logs = null }) {
        function FrozenDate(...args) {
          return args.length ? new RealDate(...args) : new RealDate(now);
        }
        FrozenDate.now = () => now;
        FrozenDate.parse = RealDate.parse;
        FrozenDate.UTC = RealDate.UTC;
        Object.setPrototypeOf(FrozenDate, RealDate);
        FrozenDate.prototype = RealDate.prototype;

        const originalDate = globalThis.Date;
        globalThis.Date = FrozenDate;
        try {
          const h = habit(name, target, weekdays, lastLog, monthDays, logs);
          const agenda = buildTodayAgenda([h], settings);
          const timeline = buildTodayTimeline(agenda, now);
          return {
            weekday: new RealDate(now).getDay(),
            included: agenda.agendaItems.some(item => item.h.name === name),
            placed: timeline.some(row => row.h && row.h.name === name)
          };
        } finally {
          globalThis.Date = originalDate;
        }
      }

      function weekPlacements({
        now, name, target, weekdays = [], monthDays = [], lastLog, logs = null,
        numDays = 7
      }) {
        function FrozenDate(...args) {
          return args.length ? new RealDate(...args) : new RealDate(now);
        }
        FrozenDate.now = () => now;
        FrozenDate.parse = RealDate.parse;
        FrozenDate.UTC = RealDate.UTC;
        Object.setPrototypeOf(FrozenDate, RealDate);
        FrozenDate.prototype = RealDate.prototype;

        const originalDate = globalThis.Date;
        globalThis.Date = FrozenDate;
        try {
          const h = habit(name, target, weekdays, lastLog, monthDays, logs);
          const week = buildWeekAgenda([h], settings, numDays);
          return week.days
            .filter(day => (day.agendaItems || []).some(item => item.h && item.h.name === name))
            .map(day => {
              const date = new RealDate(day.dayBase);
              return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            });
        } finally {
          globalThis.Date = originalDate;
        }
      }

      // August 4, 2026 is Tuesday; August 7 is Friday; August 8 is Saturday.
      // Each allowed-day check carries the user's most recent completion.
      const threeTimes = [
        agendaResult({
          now: localTs(2026, 7, 4),
          name: 'Tue Fri Sat habit',
          target: 7 / 3,
          weekdays: [2, 5, 6],
          lastLog: localTs(2026, 7, 1, 12)
        }),
        agendaResult({
          now: localTs(2026, 7, 7),
          name: 'Tue Fri Sat habit',
          target: 7 / 3,
          weekdays: [2, 5, 6],
          lastLog: localTs(2026, 7, 4, 12)
        }),
        agendaResult({
          now: localTs(2026, 7, 8),
          name: 'Tue Fri Sat habit',
          target: 7 / 3,
          weekdays: [2, 5, 6],
          lastLog: localTs(2026, 7, 7, 12)
        })
      ];

      const twoTimes = [
        agendaResult({
          now: localTs(2026, 7, 7),
          name: 'Fri Sat habit',
          target: 7 / 2,
          weekdays: [5, 6],
          lastLog: localTs(2026, 7, 1, 12)
        }),
        agendaResult({
          now: localTs(2026, 7, 8),
          name: 'Fri Sat habit',
          target: 7 / 2,
          weekdays: [5, 6],
          lastLog: localTs(2026, 7, 7, 12)
        })
      ];

      const disallowed = agendaResult({
        now: localTs(2026, 7, 5),
        name: 'Tue Fri Sat habit',
        target: 7 / 3,
        weekdays: [2, 5, 6],
        lastLog: localTs(2026, 7, 4, 12)
      });

      // Month-day equivalent: two requested completions and only two monthly
      // opportunities. Completing the 1st must not suppress the adjacent 2nd.
      const monthTimes = [
        agendaResult({
          now: localTs(2026, 7, 1),
          name: 'First second habit',
          target: 30 / 2,
          monthDays: [1, 2],
          lastLog: localTs(2026, 6, 2, 12)
        }),
        agendaResult({
          now: localTs(2026, 7, 2),
          name: 'First second habit',
          target: 30 / 2,
          monthDays: [1, 2],
          lastLog: localTs(2026, 7, 1, 12)
        })
      ];
      const disallowedMonthDay = agendaResult({
        now: localTs(2026, 7, 3),
        name: 'First second habit',
        target: 30 / 2,
        monthDays: [1, 2],
        lastLog: localTs(2026, 7, 2, 12)
      });

      // An unrestricted 5x/8d rhythm must alternate integer gaps instead of
      // rounding 1.6 days up to two every time. Starting with a completion on
      // Aug 1, the next due gaps are 2,1,2,1 days, yielding five completions
      // inside Aug 1-8 when the user follows every suggestion.
      const fiveInEightLogs = [localTs(2026, 7, 1, 12)];
      const fiveInEight = [];
      fiveInEight.push(agendaResult({
        now: localTs(2026, 7, 2), name: 'Five in eight', target: 8 / 5,
        lastLog: fiveInEightLogs[0], logs: [...fiveInEightLogs]
      }));
      fiveInEight.push(agendaResult({
        now: localTs(2026, 7, 3), name: 'Five in eight', target: 8 / 5,
        lastLog: fiveInEightLogs[0], logs: [...fiveInEightLogs]
      }));
      fiveInEightLogs.push(localTs(2026, 7, 3, 12));
      fiveInEight.push(agendaResult({
        now: localTs(2026, 7, 4), name: 'Five in eight', target: 8 / 5,
        lastLog: fiveInEightLogs[1], logs: [...fiveInEightLogs]
      }));
      fiveInEightLogs.push(localTs(2026, 7, 4, 12));
      fiveInEight.push(agendaResult({
        now: localTs(2026, 7, 5), name: 'Five in eight', target: 8 / 5,
        lastLog: fiveInEightLogs[2], logs: [...fiveInEightLogs]
      }));
      fiveInEight.push(agendaResult({
        now: localTs(2026, 7, 6), name: 'Five in eight', target: 8 / 5,
        lastLog: fiveInEightLogs[2], logs: [...fiveInEightLogs]
      }));
      fiveInEightLogs.push(localTs(2026, 7, 6, 12));
      fiveInEight.push(agendaResult({
        now: localTs(2026, 7, 7), name: 'Five in eight', target: 8 / 5,
        lastLog: fiveInEightLogs[3], logs: [...fiveInEightLogs]
      }));

      const weekPlans = {
        threeTimes: weekPlacements({
          now: localTs(2026, 7, 4), name: 'Tue Fri Sat week', target: 7 / 3,
          weekdays: [2, 5, 6], lastLog: localTs(2026, 7, 1, 12)
        }),
        twoTimes: weekPlacements({
          now: localTs(2026, 7, 7), name: 'Fri Sat week', target: 7 / 2,
          weekdays: [5, 6], lastLog: localTs(2026, 7, 1, 12)
        }),
        monthTimes: weekPlacements({
          now: localTs(2026, 7, 1), name: 'First second week', target: 30 / 2,
          monthDays: [1, 2], lastLog: localTs(2026, 6, 2, 12)
        }),
        fiveInEight: weekPlacements({
          now: localTs(2026, 7, 2), name: 'Five in eight week', target: 8 / 5,
          lastLog: localTs(2026, 7, 1, 12), logs: [localTs(2026, 7, 1, 12)]
        })
      };

      return {
        threeTimes, twoTimes, disallowed, monthTimes, disallowedMonthDay,
        fiveInEight, weekPlans
      };
    });

    const threeLabels = ['Tuesday', 'Friday', 'Saturday'];
    results.threeTimes.forEach((result, index) => {
      check(result.included && result.placed,
        `3x/7d Tue/Fri/Sat habit is on the ${threeLabels[index]} agenda`,
        JSON.stringify(result));
    });

    const twoLabels = ['Friday', 'Saturday'];
    results.twoTimes.forEach((result, index) => {
      check(result.included && result.placed,
        `2x/7d Fri/Sat habit is on the ${twoLabels[index]} agenda`,
        JSON.stringify(result));
    });

    check(!results.disallowed.included && !results.disallowed.placed,
      'constrained habit stays off the agenda on a disallowed weekday',
      JSON.stringify(results.disallowed));

    const monthLabels = ['1st', '2nd'];
    results.monthTimes.forEach((result, index) => {
      check(result.included && result.placed,
        `2x/30d month-day habit is on the ${monthLabels[index]} agenda`,
        JSON.stringify(result));
    });
    check(!results.disallowedMonthDay.included && !results.disallowedMonthDay.placed,
      'month-day habit stays off the agenda on a disallowed date',
      JSON.stringify(results.disallowedMonthDay));

    const fiveInEightExpected = [false, true, true, false, true, true];
    const fiveInEightLabels = ['Aug 2', 'Aug 3', 'Aug 4', 'Aug 5', 'Aug 6', 'Aug 7'];
    results.fiveInEight.forEach((result, index) => {
      const appears = result.included && result.placed;
      check(appears === fiveInEightExpected[index],
        `5x/8d cadence ${fiveInEightExpected[index] ? 'appears' : 'waits'} on ${fiveInEightLabels[index]}`,
        JSON.stringify(result));
    });

    const weekExpectations = {
      threeTimes: ['2026-08-04', '2026-08-07', '2026-08-08'],
      twoTimes: ['2026-08-07', '2026-08-08'],
      monthTimes: ['2026-08-01', '2026-08-02'],
      fiveInEight: ['2026-08-03', '2026-08-04', '2026-08-06', '2026-08-07']
    };
    Object.entries(weekExpectations).forEach(([key, expected]) => {
      check(JSON.stringify(results.weekPlans[key]) === JSON.stringify(expected),
        `week planner places ${key} on the effective-frequency dates`,
        `expected=${JSON.stringify(expected)} actual=${JSON.stringify(results.weekPlans[key])}`);
    });
    check(pageErrors.length === 0, 'no page errors', pageErrors.join(' | '));

    console.log(`\n# ${passed} passed, ${failed} failed`);
    if (failed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});
