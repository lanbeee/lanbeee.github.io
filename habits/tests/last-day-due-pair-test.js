// Two last-day 4h visits that share a due date. Fast used to pack the early
// beach, then drop the planned Zoo from Saturday *and* Sunday. GLPK keeps the
// Saturday plan and leaves Sunday open; Fast should place Zoo on Saturday and
// the other due visit on Sunday. A blocked Saturday plan still lands on the
// Sunday due date.
const assert = require('assert');
const {chromium, BASE, baseHabit} = require('./helpers/planner-test-helpers');

(async () => {
  const browser = await chromium.launch({headless: true});
  try {
    const page = await browser.newPage();
    await page.goto(BASE);
    await page.waitForFunction(() => typeof buildWeekAgenda === 'function'
      && typeof compareWeekClaimPriority === 'function');

    const result = await page.evaluate(({base}) => {
      const RealDate = Date;
      const now = new RealDate(2026, 8, 12, 11, 30, 0).getTime();
      class FrozenDate extends RealDate {
        constructor(...args){ super(...(args.length ? args : [now])); }
        static now(){ return now; }
      }
      FrozenDate.parse = RealDate.parse;
      FrozenDate.UTC = RealDate.UTC;
      Object.setPrototypeOf(FrozenDate, RealDate);
      FrozenDate.prototype = RealDate.prototype;
      globalThis.Date = FrozenDate;

      const today = dayStart(now);
      const sunday = today + 86400000;
      const settings = {
        preset: 'todayFirst', showWeekOnHome: true, agendaOptimizer: false, focus: 'balanced',
        availabilityMinutes: [1440, 1440, 1440, 1440, 1440, 1440, 1440],
        availabilityOverrides: {},
        showScheduledTasksInAgenda: true, showDueTasksInAgenda: true,
        showPlannedItemsInAgenda: true, showDueHabitsInAgenda: true,
        defaultTravelMode: 'driving',
        blockedTimes: [
          {label: 'sleep', days: [], start: 0, end: 540},
          {label: 'night', days: [], start: 1320, end: 1440}
        ],
        locations: [
          {id: 'home', name: 'Home', lat: 42.331, lng: -83.046, isHome: true},
          {id: 'zoo', name: 'Zoo', lat: 42.328, lng: -83.096},
          {id: 'beach', name: 'BeaverIsland', lat: 42.59, lng: -82.66},
          {id: 'walmart', name: 'Walmart', lat: 42.33, lng: -83.05},
          {id: 'wholefoods', name: 'WholeFoods', lat: 42.332, lng: -83.048}
        ]
      };
      const mkTask = (hid, name, loc, dur, extra = {}) => Object.assign({}, base, {
        hid, name, type: 'task', target: null, durationMinutes: dur, priority: 2,
        dueDate: sunday, earlyWindowDays: 1, delayAllowanceDays: 0,
        locationIds: [loc], anywhereAllowed: false, createdAt: now - 10 * 86400000
      }, extra);
      const mkDaily = (hid, name, start, end, dur, priority = 0) => Object.assign({}, base, {
        hid, name, type: 'keepup', target: 1, durationMinutes: dur, priority,
        allowedTimeStart: start, allowedTimeEnd: end, lastLog: today - 86400000,
        createdAt: now - 10 * 86400000
      });
      const dailies = [
        mkDaily('zuhr', 'Zuhr', 792, 1053, 5, 0),
        mkDaily('asr', 'Asr', 1063, 1275, 5, 0),
        mkDaily('maghrib', 'Maghrib', 1271, 1310, 5, 0),
        mkDaily('isha', 'Isha', 1250, 1370, 10, 0),
        mkDaily('lunch', 'Lunch', 792, 912, 15, 1),
        mkDaily('dinner', 'Dinner', 1260, 1410, 15, 1)
      ];
      const errands = [
        mkTask('walmart', 'Namra jeans Walmart return', 'walmart', 15, {
          dueDate: today, earlyWindowDays: 0
        }),
        mkTask('stool', 'Return Zahra stool', 'wholefoods', 10, {
          dueDate: today, earlyWindowDays: 0
        })
      ];
      const zoo = mkTask('zoo', 'Visit Zoo', 'zoo', 240, {
        logs: [{ts: today + 12 * 3600000, plan: true}]
      });
      const beach = mkTask('beach', 'Beaver island beach', 'beach', 240);
      const placedDays = (week, name) => (week.days || []).map((day, i) => {
        const hit = (day.timeline || []).some(row => row.kind === 'fill' && row.h.name === name);
        return hit ? i : null;
      }).filter(x => x != null);

      const week = buildWeekAgenda([zoo, beach, ...errands, ...dailies], settings, 7);
      const pin = plannerPinnedDayBase(zoo, settings, today);
      const monday = sunday + 86400000;
      const zooCand = {h: zoo, pinned: true, pinnedDay: pin, eligible: new Set([today, sunday])};
      const beachCand = {h: beach, pinned: false, eligible: new Set([today, sunday])};
      const zuhrCand = {h: dailies[0], pinned: false, priority: 0, eligible: new Set(
        [0, 1, 2, 3, 4, 5, 6].map(offset => today + offset * 86400000)
      )};
      const jumaCand = {h: Object.assign({}, dailies[0], {hid: 'juma', name: 'Juma', durationMinutes: 20}),
        pinned: false, priority: 0, eligible: new Set([today + 6 * 86400000])};

      const blockedSettings = Object.assign({}, settings, {
        availabilityOverrides: {[dateKey(today)]: 45}
      });
      const blockedWeek = buildWeekAgenda([zoo, beach, ...dailies], blockedSettings, 7);

      try {
        return {
          pinIso: pin && dateKey(pin),
          eligibleSat: weekFillEligibleOnDay(zoo, settings, today, 6, pin),
          eligibleSun: weekFillEligibleOnDay(zoo, settings, sunday, 0, pin),
          eligibleMon: weekFillEligibleOnDay(zoo, settings, monday, 1, pin),
          zooDays: placedDays(week, 'Visit Zoo'),
          beachDays: placedDays(week, 'Beaver island beach'),
          claimZooZuhr: compareWeekClaimPriority(zooCand, zuhrCand, [{dayBase: today}, {dayBase: sunday}]),
          claimJumaZoo: compareWeekClaimPriority(jumaCand, zooCand, [{dayBase: today + 6 * 86400000}]),
          claimZooBeach: compareWeekClaimPriority(zooCand, beachCand, [{dayBase: today}, {dayBase: sunday}]),
          blockedZooDays: placedDays(blockedWeek, 'Visit Zoo'),
          blockedBeachDays: placedDays(blockedWeek, 'Beaver island beach')
        };
      } finally {
        globalThis.Date = RealDate;
      }
    }, {base: baseHabit({})});

    assert.strictEqual(result.pinIso, '2026-09-12', 'Zoo plan log locks Saturday');
    assert.strictEqual(result.eligibleSat, true, 'planned Saturday remains eligible');
    assert.strictEqual(result.eligibleSun, true, 'Sunday due date stays eligible after a Saturday plan');
    assert.strictEqual(result.eligibleMon, false, 'a Saturday plan does not reopen Monday after the Sunday due date');
    assert.deepStrictEqual(result.zooDays, [0], 'Fast places the planned Zoo on Saturday');
    assert.deepStrictEqual(result.beachDays, [1], 'Fast places the other last-day 4h visit on Sunday');
    assert.ok(result.claimZooZuhr < 0, 'planned/last-day Zoo packs before slack daily Zuhr');
    assert.ok(result.claimJumaZoo < 0, 'scarce Friday-only P0 still outranks the 4h visit');
    assert.ok(result.claimZooBeach < 0, 'planned Zoo outranks the unpinned last-day beach');
    assert.deepStrictEqual(result.blockedZooDays, [1],
      'a Saturday plan that cannot fit still lands on the Sunday due date');
    assert.deepStrictEqual(result.blockedBeachDays, [],
      'Sunday keeps the planned Zoo when Saturday has no 4h budget');
    console.log('PASS last-day due pair: Zoo Saturday, beach Sunday, due-date fallback');
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
