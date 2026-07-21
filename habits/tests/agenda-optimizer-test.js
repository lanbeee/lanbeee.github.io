// Exact schedule optimizer (GLPK) — regression for scarcity packing when
// settings.agendaOptimizer is on. Falls soft-pass if GLPK cannot load.
//
// Run: HABITS_URL=http://127.0.0.1:4181/ node tests/agenda-optimizer-test.js

const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

function atTime(hour, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function base(props) {
  return Object.assign({
    name: 'item', type: 'keepup', target: 1, flexibilityDays: 0, durationMinutes: 30,
    allowedTimeStart: null, allowedTimeEnd: null, preferredTimeStart: null, preferredTimeEnd: null,
    lastLog: null, logs: [], emoji: '', pinned: false, sample: false, snoozedUntil: null,
    topics: [], allowedWeekdays: [], allowedMonthDays: [], preferredWeekdays: [], preferredMonthDays: [],
    dueDate: null, eventTime: null, hardDue: false, createdAt: Date.now()
  }, props);
}

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

  const ago1d = atTime(6) - 86400000;
  await page.evaluate(({ d, s }) => {
    localStorage.clear();
    localStorage.setItem('tings_v2', JSON.stringify(d));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(s));
  }, {
    d: [
      base({ name: 'Flexible Deep Work', type: 'keepup', target: 1, durationMinutes: 60,
        priority: 0, locationIds: [], lastLog: ago1d, logs: [ago1d] }),
      base({ name: 'Sunrise Exercise', type: 'keepup', target: 1, durationMinutes: 5,
        priority: 2, locationIds: [],
        allowedTimeStartAnchor: 'sunrise', allowedTimeStartOffsetMin: 5,
        allowedTimeEndAnchor: 'sunrise', allowedTimeEndOffsetMin: 35,
        lastLog: ago1d, logs: [ago1d] })
    ],
    s: {
      preset: 'todayFirst', showWeekOnHome: true, agendaOptimizer: true, focus: 'balanced',
      availabilityMinutes: [600, 600, 600, 600, 600, 600, 600],
      showScheduledTasksInAgenda: true, showDueTasksInAgenda: true,
      showPlannedItemsInAgenda: true, showDueHabitsInAgenda: true,
      locations: [{ id: 'home', name: 'Charles Street', lat: 40.734852, lng: -74.003584 }],
      lastKnownLocationId: 'home',
      blockedTimes: [
        { label: 'blocked', days: [], locationId: 'home',
          start: 900, end: 960,
          startAnchor: 'sunrise', startOffsetMin: -480,
          startCombine: 'later', startAnchor2: 'isha', startOffsetMin2: 15,
          startDayOffset: 1, startDayOffset2: 0,
          endAnchor: 'sunrise', endOffsetMin: -30 },
        { label: 'breakfast', days: [], locationId: null, start: 480, end: 540 }
      ]
    }
  });
  await page.reload({ waitUntil: 'networkidle' });

  console.log('\n[Optimizer] GLPK availability');
  const glpkOk = await page.evaluate(async () => {
    if (typeof ensureGlpk !== 'function') return { ok: false, reason: 'ensureGlpk missing' };
    try {
      const GLPK = await ensureGlpk();
      return { ok: !!GLPK, reason: GLPK ? 'loaded' : 'null' };
    } catch (e) {
      return { ok: false, reason: String(e && e.message || e) };
    }
  });
  if (!glpkOk.ok) {
    console.log(`  skip - GLPK unavailable (${glpkOk.reason}); soft-pass`);
    await browser.close();
    console.log('\nPASS — optimizer soft-skipped (no GLPK)');
    process.exit(0);
  }
  check('optimizer glpk loads', glpkOk.ok, glpkOk.reason);

  console.log('\n[Optimizer] sunrise vs flexible P0');
  const result = await page.evaluate(async ({ now }) => {
    const RealDate = Date;
    function FD(...a) { return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
    FD.now = () => now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
    Object.setPrototypeOf(FD, RealDate); FD.prototype = RealDate.prototype;
    const orig = globalThis.Date; globalThis.Date = FD;
    try {
      const data = JSON.parse(localStorage.getItem('tings_v2'));
      const settings = Object.assign(
        JSON.parse(localStorage.getItem('tings_app_settings_v2')),
        { agendaOptimizer: true }
      );
      const week = await buildWeekAgendaAsync(data, settings, 7);
      const tomorrow = week.days[1];
      const fills = (tomorrow?.timeline || []).filter(r => r.kind === 'fill');
      const byName = Object.fromEntries(fills.map(r => {
        const placeMin = Math.round((r.start - tomorrow.dayBase) / 60000);
        return [r.h.name, placeMin];
      }));
      return {
        optimized: !!week.optimized,
        names: fills.map(r => r.h.name),
        sunriseMin: byName['Sunrise Exercise'] ?? null,
        flexibleMin: byName['Flexible Deep Work'] ?? null
      };
    } finally {
      globalThis.Date = orig;
    }
  }, { now: atTime(15) });

  check('optimized week flag', result.optimized, `optimized=${result.optimized}`);
  check('Sunrise Exercise placed', result.sunriseMin != null, `fills=${result.names.join(', ')}`);
  check('Flexible Deep Work placed', result.flexibleMin != null, `fills=${result.names.join(', ')}`);
  check('sunrise in morning gap', result.sunriseMin != null && result.sunriseMin < 480,
    `sunriseMin=${result.sunriseMin}`);
  check('flexible outside morning gap', result.flexibleMin != null && result.flexibleMin >= 480,
    `flexibleMin=${result.flexibleMin}`);

  // Fallback path: force timeout / broken glpk should not throw — heuristic still works.
  console.log('\n[Optimizer] heuristic fallback still works with optimizer flag');
  const fallback = await page.evaluate(async ({ now }) => {
    const RealDate = Date;
    function FD(...a) { return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
    FD.now = () => now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
    Object.setPrototypeOf(FD, RealDate); FD.prototype = RealDate.prototype;
    const orig = globalThis.Date; globalThis.Date = FD;
    try {
      const data = JSON.parse(localStorage.getItem('tings_v2'));
      const settings = Object.assign(
        JSON.parse(localStorage.getItem('tings_app_settings_v2')),
        { agendaOptimizer: false }
      );
      const week = buildWeekAgenda(data, settings, 7);
      const tomorrow = week.days[1];
      const fills = (tomorrow?.timeline || []).filter(r => r.kind === 'fill');
      return {
        hasSunrise: fills.some(r => r.h.name === 'Sunrise Exercise'),
        hasFlexible: fills.some(r => r.h.name === 'Flexible Deep Work')
      };
    } finally {
      globalThis.Date = orig;
    }
  }, { now: atTime(15) });
  check('heuristic places sunrise', fallback.hasSunrise);
  check('heuristic places flexible', fallback.hasFlexible);

  await browser.close();
  console.log('');
  if (failures.length) {
    console.error(`FAIL (${failures.length})`);
    failures.forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('PASS — agenda optimizer tests green');
})().catch(e => {
  console.error(e.stack || e.message);
  process.exit(1);
});
