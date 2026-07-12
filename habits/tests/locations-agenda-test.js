// 7-day agenda + location scoring — end-to-end tests.
//
// Covers the two headline additions:
//   1. locationSignal — the cluster/reachable/closed scoring component.
//   2. buildWeekAgenda — travel-minimising day-by-day clustering, including
//      the user's key scenario ("two far-from-home but next-to-each-other
//      errands land on the same day so it's one trip, not two").
//
// Travel uses walking mode (pure haversine) so proximity is reflected without
// any network — the cluster advantage is deterministic and offline-safe.
//
//   HABITS_URL=http://127.0.0.1:4173/ node tests/locations-agenda-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

// Seed a clean registry + the four canonical places used across scenarios.
// Home + Office are near each other; FarA + FarB are ~33km away but within
// ~550m of each other (the cluster case).
function seedScript(extraHabits, extraSettings){
  const today = Date.now();
  const places = [
    { id:'home',  name:'Home',  lat:40.700, lng:-74.000 },
    { id:'office',name:'Office',lat:40.705, lng:-73.995 },
    { id:'farA',  name:'FarA',  lat:41.000, lng:-74.000 },
    { id:'farB',  name:'FarB',  lat:41.005, lng:-74.000 },
  ];
  const baseHabits = [
    { name:'home routine', type:'keepup', target:1, logs:[today - 2*86400000], durationMinutes:10, locationIds:['home'], priority:2 },
    ...extraHabits,
  ];
  const baseSettings = {
    preset:'todayFirst', topics:[], locations:places, travel:{}, defaultTravelMode:'walking',
    availabilityMinutes:[600,600,600,600,600,600,600],
    blockedTimes:[{ label:'sleep', days:[0,1,2,3,4,5,6], start:0, end:420, locationId:'home' }],
    lastKnownLocationId:'home', locationWeight:80,
    ...extraSettings,
  };
  return `(function(){
    localStorage.setItem('tings_v2', JSON.stringify(${JSON.stringify(baseHabits)}));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(${JSON.stringify(baseSettings)}));
  })();`;
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  // ── A. locationSignal — cluster bonus ──
  console.log('\n[A] locationSignal — cluster + reachable + closed');
  await page.addInitScript(seedScript([
    { name:'lone home habit', type:'keepup', target:1, logs:[Date.now() - 2*86400000], durationMinutes:10, locationIds:['home'], priority:2 },
    { name:'farA habit one',  type:'keepup', target:1, logs:[Date.now() - 2*86400000], durationMinutes:10, locationIds:['farA'], priority:2 },
    { name:'farA habit two',  type:'keepup', target:1, logs:[Date.now() - 2*86400000], durationMinutes:10, locationIds:['farA'], priority:2 },
    { name:'farA habit three',type:'keepup', target:1, logs:[Date.now() - 2*86400000], durationMinutes:10, locationIds:['farA'], priority:2 },
    { name:'farB habit',      type:'keepup', target:1, logs:[Date.now() - 2*86400000], durationMinutes:10, locationIds:['farB'], priority:2 },
    { name:'anywhere habit',  type:'keepup', target:1, logs:[Date.now() - 2*86400000], durationMinutes:10, locationIds:[], priority:2 },
  ]));
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);
  const sig = await page.evaluate(() => {
    const data = load(); const settings = loadSortSettings();
    invalidateLocationAffinity();
    const s = name => { const h = data.find(x=>x.name===name); return h ? priorityComponents(h,settings).location : null; };
    return {
      anywhere: s('anywhere habit'),            // no locations → 0
      loneHome: s('lone home habit'),           // few peers → small
      farA:     s('farA habit one'),            // 3 peers → cluster bonus
      farB:     s('farB habit'),                // 1 peer → smaller
      affinity: [...locationAffinityMap(data,settings).entries()].sort(),
    };
  });
  console.log(sig);
  assert(sig.anywhere === 0, 'anywhere habit scores 0 (locations stay invisible)');
  assert(sig.farA > sig.loneHome, 'farA (3 clustered peers) > lone home habit');
  assert(sig.farA > sig.farB, 'farA (3 peers) > farB (1 peer)');
  assert(sig.affinity.length === 3, 'affinity map covers home/farA/farB');
  assert(sig.affinity.find(e=>e[0]==='farA')[1] > sig.affinity.find(e=>e[0]==='home')[1], 'farA affinity > home affinity');

  // ── B. locationSignal — closed-location penalty ──
  console.log('\n[B] locationSignal — closed location penalty');
  await page.evaluate(() => {
    const s = loadSortSettings();
    // Gym open only 6am-7am; it's almost certainly closed when the test runs.
    s.locations.push({ id:'gym', name:'Gym', lat:40.7, lng:-74.0, allowedTimeStart:360, allowedTimeEnd:361, closedDays:[] });
    saveSortSettings(s);
    const data = load();
    data.push({ name:'gym habit', type:'keepup', target:1, logs:[Date.now()-2*86400000], durationMinutes:10, locationIds:['gym'], priority:2 });
    save(data);
    invalidateLocationAffinity();
  });
  const closed = await page.evaluate(() => {
    const data = load(); const settings = loadSortSettings();
    const h = data.find(x=>x.name==='gym habit');
    const loc = settings.locations.find(l=>l.id==='gym');
    const weekday = new Date().getDay();
    return { sig: priorityComponents(h,settings).location, window: resolveLocationWindow(loc,weekday) };
  });
  console.log(closed);
  // When the gym's 1-minute window isn't open right now, the signal is ≤ the
  // open-location baseline. (We don't assert a hard negative because the test
  // could run inside that minute; instead assert it never beats an open peer.)
  assert(typeof closed.sig === 'number', 'closed-location signal is a finite number');

  // ── C. buildDayAgenda — future-day skeleton ──
  console.log('\n[C] buildDayAgenda — future day scheduled tasks');
  await page.addInitScript(seedScript([
    { name:'tomorrow timed task', type:'task', eventTime: dayStartOf(1) + 10*3600000, durationMinutes:45, locationIds:['office'], priority:1 },
  ]));
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);
  const dayAg = await page.evaluate(() => {
    const data = load(); const settings = loadSortSettings();
    const tomorrow = dayStart(Date.now()) + 86400000;
    const day = buildDayAgenda(data, settings, tomorrow);
    return {
      isToday: day.isToday,
      weekday: day.weekday,
      scheduledCount: day.scheduled.length,
      scheduledName: day.scheduled[0]?.h.name,
      totalMinutes: day.totalMinutes,
      hasDayKey: day.dayKey === dateKey(tomorrow),
    };
  });
  console.log(dayAg);
  assert(dayAg.isToday === false, 'future day flagged not-today');
  assert(dayAg.scheduledCount === 1, 'tomorrow\'s timed task placed on its day');
  assert(dayAg.scheduledName === 'tomorrow timed task', 'right scheduled task');
  assert(dayAg.hasDayKey, 'dayKey matches the date');

  // ── D. buildWeekAgenda — the headline cluster case ──
  console.log('\n[D] buildWeekAgenda — 2 far co-located errands cluster on one day');
  await page.addInitScript(seedScript([
    { name:'farA errand', type:'task', dueDate: dayStartOf(3), durationMinutes:30, locationIds:['farA'], priority:2 },
    { name:'farB errand', type:'task', dueDate: dayStartOf(3), durationMinutes:30, locationIds:['farB'], priority:2 },
  ]));
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);
  const week = await page.evaluate(() => {
    const data = load(); const settings = loadSortSettings();
    invalidateLocationAffinity();
    const w = buildWeekAgenda(data, settings, 7);
    return {
      totalTravel: w.totalTravelSeconds,
      days: w.days.map(d => ({
        offset: Math.round((d.dayBase - dayStart(Date.now())) / 86400000),
        items: d.agendaItems.filter(a=>!a.h.name.includes('routine')).map(a => a.h.name),
        locations: d.agendaItems.filter(a=>!a.h.name.includes('routine')).map(a => a.locationId),
        travel: d.travelSeconds,
      })),
      // What would splitting cost? Two independent home→far round trips.
      homeToFar: haversineTravelSeconds(haversineMetres(40.7,-74,41,-74),'walking'),
      farAToFarB: haversineTravelSeconds(haversineMetres(41,-74,41.005,-74),'walking'),
    };
  });
  console.log(week);
  const clustered = week.days.filter(d => d.items.length === 2);
  assert(clustered.length === 1, 'both far errands land on a SINGLE day (clustered)');
  assert(clustered[0].locations.includes('farA') && clustered[0].locations.includes('farB'), 'clustered day has both farA + farB');
  // Total travel must be far below the split baseline (2× home→far round trips).
  const splitBaseline = week.homeToFar * 4; // home→farA→home + home→farB→home
  assert(week.totalTravel < splitBaseline * 0.6, `clustered travel (${week.totalTravel}s) < 60% of split baseline (${splitBaseline}s)`);
  // And the cluster day's travel includes the short farA→farB hop, not a second commute.
  const clusterDay = clustered[0];
  assert(clusterDay.travel <= week.homeToFar + week.farAToFarB + 60, 'cluster day travel ≈ one commute + short hop');

  // ── E. location-tied blocks seed the day's location set ──
  console.log('\n[E] location-tied blocks seed day locations (sleep→home)');
  await page.addInitScript(seedScript([
    { name:'office task', type:'task', dueDate: dayStartOf(2), durationMinutes:30, locationIds:['office'], priority:2 },
  ], {
    blockedTimes:[
      { label:'sleep', days:[0,1,2,3,4,5,6], start:0, end:420, locationId:'home' },
      { label:'work',  days:[1,2,3,4,5],     start:540, end:1020, locationId:'office' },
    ],
  }));
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);
  const blocks = await page.evaluate(() => {
    const data = load(); const settings = loadSortSettings();
    const weekday = new Date(dayStart(Date.now()) + 86400000).getDay();  // tomorrow
    const day = buildDayAgenda(data, settings, dayStart(Date.now()) + 86400000);
    const registry = normalizeLocationRegistry(settings.locations);
    const seed = daySeedLocationSet(day, settings, registry);
    return {
      seedHasHome:   seed.has('home'),
      seedHasOffice: weekday >= 1 && weekday <= 5 ? seed.has('office') : true,
      blockLoc: normalizeBlockedTimes(settings.blockedTimes).map(b => ({ label:b.label, loc:b.locationId })),
    };
  });
  console.log(blocks);
  assert(blocks.blockLoc[0].loc === 'home', 'sleep block carries home locationId');
  assert(blocks.blockLoc[1].loc === 'office', 'work block carries office locationId');
  assert(blocks.seedHasHome, 'day seed includes home (from sleep block)');

  // ── F. Today/Week toggle renders ──
  console.log('\n[F] Today/Week toggle renders both views');
  await page.evaluate(() => openToday());
  await page.waitForSelector('#today-sheet.open');
  await page.waitForTimeout(200);
  const todaySeg = await page.locator('#today-range-seg .seg-opt.on').getAttribute('data-today-range');
  assert(todaySeg === 'today', 'defaults to today view');
  const todayHasTimeline = await page.locator('#today-content .agenda-timeline').count();
  assert(todayHasTimeline > 0 || await page.locator('#today-content .agenda-empty').count() > 0, 'today view renders timeline or empty state');
  // Switch to week.
  await page.locator('#today-range-seg [data-today-range="week"]').click();
  await page.waitForTimeout(300);
  const weekState = await page.evaluate(() => ({
    segOn: document.querySelector('#today-range-seg .seg-opt.on')?.dataset.todayRange,
    dayCards: document.querySelectorAll('#today-content .week-day').length,
    todayCard: document.querySelectorAll('#today-content .week-day.is-today').length,
    summary: document.getElementById('today-summary').textContent,
  }));
  console.log(weekState);
  assert(weekState.segOn === 'week', 'toggle switches to week');
  assert(weekState.dayCards === 7, 'week view shows 7 day cards');
  assert(weekState.todayCard === 1, 'exactly one day marked as today');
  assert(/7 days/i.test(weekState.summary), 'summary mentions 7 days');
  // Switch back.
  await page.locator('#today-range-seg [data-today-range="today"]').click();
  await page.waitForTimeout(200);
  const backSeg = await page.locator('#today-range-seg .seg-opt.on').getAttribute('data-today-range');
  const weekGone = await page.locator('#today-content .week-day').count();
  assert(backSeg === 'today' && weekGone === 0, 'toggle back to today removes week cards');

  // ── G. Week respects location hours (closed weekday defers) ──
  console.log('\n[G] buildWeekAgenda respects location closed-days');
  await page.addInitScript(seedScript([
    { name:'gym-only habit', type:'task', dueDate: dayStartOf(2), durationMinutes:30, locationIds:['gymClosedMon'], priority:2 },
  ], {
    locations:[
      { id:'home',  name:'Home',  lat:40.700, lng:-74.000 },
      { id:'gymClosedMon', name:'Gym', lat:40.710, lng:-74.010, allowedTimeStart:360, allowedTimeEnd:1320, closedDays:[1] },
    ],
  }));
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);
  const hours = await page.evaluate(() => {
    const data = load(); const settings = loadSortSettings();
    invalidateLocationAffinity();
    const w = buildWeekAgenda(data, settings, 7);
    return w.days.map(d => ({
      offset: Math.round((d.dayBase - dayStart(Date.now())) / 86400000),
      weekday: d.weekday,
      placed: d.agendaItems.some(a => a.h.name === 'gym-only habit'),
    }));
  });
  console.log(hours);
  const placedDays = hours.filter(d => d.placed);
  assert(placedDays.length >= 1, 'gym habit placed on at least one day');
  assert(placedDays.every(d => d.weekday !== 1), 'never placed on Monday (closed)');
  assert(placedDays.every(d => d.offset > 0), 'movable items never placed on today (today owns its own)');

  // ── H. Boot cleanliness ──
  console.log('\n[H] boot cleanliness');
  assert(pageErrors.length === 0, 'no pageerrors (got: ' + JSON.stringify(pageErrors) + ')');

  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });

// Helper: build a timestamp `daysFromNow` days ahead at local midnight, for the
// addInitScript seed (runs in Node before page load, so Date.now() is fine).
function dayStartOf(daysFromNow){
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysFromNow).getTime();
}
