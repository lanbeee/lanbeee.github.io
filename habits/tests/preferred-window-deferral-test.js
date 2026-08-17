// GUARD (not a repro) for preferred-window movables. A user report ("Quran shows
// MISSED · TODAY / assigned tomorrow while 3.5h of evening is open") could not be
// reproduced with synthetic data: in every scenario below — isolated, breakable-
// deficit-met, and a packed day with fixed-window prayers — the preferred-morning
// (4:00–9:00 AM) P0 movable that fits a free evening gap places TODAY, in BOTH
// engines. These cases are kept as a regression guard for that correct behaviour.
//
// The user's actual situation-3 deferral depends on their exact habit data
// (locations, travel, order links, the precise ~10-item mix) and could not be
// reconstructed from the audit alone. To fix it precisely we need a data export.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/preferred-window-deferral-test.js
//
const {
  chromium, BASE, atTime, baseHabit:base,
  openEveningSettings, windowedSettings,
  glpkAvailable, runPlannerPair, minutesOnDay
} = require('./helpers/planner-test-helpers');

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}
// Open 9:00–22:00 with sleep/night/lunch blocks → a real evening gap exists.
// No evening — the only valid gaps are inside the day. Used as a control: with no
// evening, deferring a preferred-window item that can't fit the daytime gaps is OK.
(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  await page.goto(BASE, { waitUntil:'networkidle' });

  const glpkOk = await glpkAvailable(page);

  async function runBoth(data, settings, now){
    return runPlannerPair(page, data, settings, now);
  }

  // ════════════════════════════════════════════════════════════════════════
  // [1] CORE REPRO — preferred-morning (4:00–9:00 AM) P0 movable, clock frozen
  // at 3:48 PM (preferred window gone), open evening 19:30–22:00. It fits the
  // evening, is allowed anytime, and is P0 → MUST place today, not tomorrow.
  // (No breakable here, to isolate the preferred-window logic from Bug A.)
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[1] preferred-window movable (morning gone) places today in evening');
  {
    const now = atTime(15,48);
    const data = [
      base({ name:'Quran', type:'keepup', target:7, durationMinutes:30, priority:0,
        preferredTimeStart:240, preferredTimeEnd:540, flexibilityDays:3, anywhereAllowed:true })
    ];
    const res = await runBoth(data, openEveningSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,0,'Quran') >= 30,
        `${label}: Quran placed TODAY (got ${minutesOnDay(r,0,'Quran')}) — preferred window is gone but the evening gap fits a P0 item`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // [2] Same item, but with a daily breakable whose deficit is already MET (so
  // there is no reservation at all — mirrors situation 3 where Work was 100%
  // placed). Evening still open → Quran must still place today.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[2] preferred-window movable places today even with breakable deficit met');
  {
    const now = atTime(15,48);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    // Tiny breakable budget (30m) already fully logged today → no deficit, no
    // reservation windows, but the item still exists in the candidate pool.
    const data = [
      base({ name:'Work', type:'keepup', target:1, durationMinutes:30, breakable:true,
        minChunkMinutes:30, priority:0,
        allowedTimeStart:540, allowedTimeEnd:1170, logs:[todayBase] }),
      base({ name:'Quran', type:'keepup', target:7, durationMinutes:30, priority:0,
        preferredTimeStart:240, preferredTimeEnd:540, flexibilityDays:3, anywhereAllowed:true })
    ];
    const res = await runBoth(data, openEveningSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,0,'Quran') >= 30,
        `${label}: Quran placed TODAY (got ${minutesOnDay(r,0,'Quran')}) — fits the evening even with no active reservation`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // [3] PACKED DAY — mirrors situation 3: a full daytime (windowed prayers +
  // a travel grocery) consuming the afternoon, with a preferred-morning P0
  // movable (Quran) that only fits the EVENING gaps between fixed items. The
  // optimizer must still place it TODAY rather than deferring to tomorrow's
  // premium morning slot, because it fits today and is P0.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[3] packed day — preferred-window movable still places in evening gap');
  {
    const now = atTime(15,48);
    const todayBase = (() => { const d = new Date(now); d.setHours(0,0,0,0); return d.getTime(); })();
    const data = [
      // afternoon/evening fixed-window prayers (hard windows) that bookend the
      // evening gaps, exactly like Asr / Maghrib / Isha.
      base({ name:'Asr', type:'keepup', target:1, durationMinutes:5, priority:0,
        allowedTimeStart:972, allowedTimeEnd:1085 }),          // 16:12–18:05
      base({ name:'Maghrib', type:'keepup', target:1, durationMinutes:5, priority:0,
        allowedTimeStart:1201, allowedTimeEnd:1260 }),         // 20:01–21:00
      base({ name:'Isha', type:'keepup', target:1, durationMinutes:10, priority:0,
        allowedTimeStart:1289, allowedTimeEnd:1409 }),         // 21:29–23:29
      // a daytime movable that consumes afternoon capacity
      base({ name:'Camera', type:'keepup', target:30, durationMinutes:30, priority:2,
        planByDate:todayBase + 5*86400000 }),
      // the preferred-morning P0 movable that should still place in the evening
      base({ name:'Quran', type:'keepup', target:7, durationMinutes:30, priority:0,
        preferredTimeStart:240, preferredTimeEnd:540, flexibilityDays:3, anywhereAllowed:true })
    ];
    const res = await runBoth(data, openEveningSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      assert(minutesOnDay(r,0,'Quran') >= 30,
        `${label}: Quran placed TODAY (got ${minutesOnDay(r,0,'Quran')}) — fits evening gap between fixed items; P0 must not defer for tomorrow's preferred slot`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // [4] CONTROL — no evening (windowedSettings). Daytime gaps are too small for
  // 30m after the morning is gone, so deferring IS correct here. Proves the fix
  // only frees genuinely placeable same-day gaps.
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[4] CONTROL — no evening: preferred-window movable may still defer (legit)');
  {
    const now = atTime(15,48);
    const data = [
      base({ name:'Quran', type:'keepup', target:7, durationMinutes:30, priority:0,
        preferredTimeStart:240, preferredTimeEnd:540, flexibilityDays:3, anywhereAllowed:true })
    ];
    const res = await runBoth(data, windowedSettings(), now);
    for(const [label, r] of [['glpk', res.glpk], ['fast', res.fast]]){
      if(label === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!r.error, `${label}: week builds without error ${r.error || ''}`);
      // No assertion on placement — just confirm it builds. This scenario only
      // documents that without an evening gap the item can legitimately wait.
      console.log(`  info: ${label}: Quran today=${minutesOnDay(r,0,'Quran')}m (control; deferral acceptable with no evening)`);
    }
  }

  await browser.close();
  console.log(pageErrors.length ? `\nPAGE ERRORS: ${pageErrors.length}` : '\n[clean] page errors');
  console.log(pageErrors.length ? pageErrors.join('\n') : '  ok: no pageerrors (got: ' + JSON.stringify(pageErrors) + ')');
  console.log(`\n${pass} passed, ${fail} failed`);
  if(fail > 0 || pageErrors.length)process.exit(1);
})();
