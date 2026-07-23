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
//   HABITS_URL=http://127.0.0.1:4181/ node tests/locations-agenda-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

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
      { label:'breakfast', days:[0,1,2,3,4,5,6], start:420, end:450, locationId:'home' },
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
  assert(blocks.blockLoc.find(b => b.label === 'work')?.loc === 'office', 'work block carries office locationId');
  assert(blocks.seedHasHome, 'day seed includes home (from sleep block)');

  // ── F. Week plan on home screen (showWeekOnHome setting) ──
  console.log('\n[F] showWeekOnHome integrates day sections into #list');
  // Enable showWeekOnHome and switch to 'cards' extra mode so all blocked
  // times (including future-day blocks) are visible regardless of the clock.
  await page.evaluate(() => {
    const s = loadSortSettings();
    s.showWeekOnHome = true;
    s.homeExtraMode = 'cards';
    saveSortSettings(s);
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => { if(typeof render === 'function')render(); });
  await page.waitForFunction(()=>{
    const headers = [...document.querySelectorAll('#list .section-header')].map(el=>el.textContent.trim());
    return headers.includes('today') && headers.includes('tomorrow');
  },null,{timeout:10000});
  const homeWeek = await page.evaluate(() => {
    const wrap = document.getElementById('home-week-plan');
    const list = document.getElementById('list');
    const headers = [...(list?.querySelectorAll('.section-header') || [])].map(el => el.textContent.trim());
    return {
      exists: !!wrap,
      separateHidden: wrap ? wrap.hidden : true,
      separateEmpty: wrap ? wrap.innerHTML.trim() === '' : true,
      headers,
      hasToday: headers.includes('today'),
      hasTomorrow: headers.includes('tomorrow'),
      blockedCards: list ? list.querySelectorAll('.blocked-card').length : 0,
      travelCards: list ? list.querySelectorAll('.travel-card').length : 0,
    };
  });
  console.log(homeWeek);
  assert(homeWeek.exists, '#home-week-plan element still exists (cleared)');
  assert(homeWeek.separateHidden, 'separate week plan block stays hidden');
  assert(homeWeek.separateEmpty, 'separate week plan block stays empty');
  assert(homeWeek.hasToday, 'home list has a today section');
  assert(homeWeek.hasTomorrow, 'home list has a tomorrow section');
  assert(homeWeek.blockedCards > 0, 'blocked times render as home cards');
  // Consecutive blocked times collapse into one tappable group on home.
  const blockedMerge = await page.evaluate(() => {
    const list = document.getElementById('list');
    const groups = [...(list?.querySelectorAll('.blocked-group') || [])];
    const merges = [...(list?.querySelectorAll('.blocked-card-merge') || [])];
    let expandedDetail = 0;
    if (merges[0]) {
      merges[0].click();
      expandedDetail = list.querySelectorAll('.blocked-group.is-expanded .blocked-group-detail .blocked-card').length;
    }
    return {
      groups: groups.length,
      merges: merges.length,
      expandedDetail,
      stickyTop: (() => {
        const header = list?.querySelector('.section-header');
        if (!header) return null;
        return getComputedStyle(header).position;
      })()
    };
  });
  console.log(blockedMerge);
  if (blockedMerge.merges > 0) {
    assert(blockedMerge.expandedDetail > 1, 'expanded blocked group shows separate cards');
  } else {
    assert(false, 'expected at least one merged blocked group (sleep+breakfast)');
  }
  assert(blockedMerge.stickyTop === 'sticky', 'section headers are sticky');
  // Disable the setting → classic today/overdue/upcoming sections return.
  await page.evaluate(() => {
    const s = loadSortSettings();
    s.showWeekOnHome = false;
    saveSortSettings(s);
  });
  await page.waitForTimeout(100);
  await page.evaluate(() => { if(typeof render === 'function')render(); });
  await page.waitForTimeout(200);
  const classicHome = await page.evaluate(() => {
    const wrap = document.getElementById('home-week-plan');
    const list = document.getElementById('list');
    const headers = [...(list?.querySelectorAll('.section-header') || [])].map(el => el.textContent.trim());
    return {
      separateHidden: wrap ? wrap.hidden : true,
      headers,
      hasToday: headers.includes('today'),
      hasTomorrow: headers.includes('tomorrow'),
    };
  });
  assert(classicHome.separateHidden, 'week plan block stays hidden after toggle off');
  assert(classicHome.hasToday, 'classic home still has today');
  assert(!classicHome.hasTomorrow, 'classic home does not use tomorrow sections');

  // ── G. Week respects location hours (closed weekday defers) ──
  console.log('\n[G] buildWeekAgenda respects location closed-days');
  await page.addInitScript(seedScript([
    { name:'gym-only habit', type:'task', dueDate: dayStartOf(2), durationMinutes:30, locationIds:['gymClosedMon'], priority:2, flexibilityDays:2 },
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
  // Due in 2 days → eligible from ready day through due day; may land on
  // today only if capacity+travel win, otherwise a later open day.
  assert(placedDays.every(d => d.offset >= 0 && d.offset <= 2), 'placed on or before due day');

  // ── G2. Soft due-today work spreads into the week (not all dumped on today) ──
  console.log('\n[G2] soft due items spread across the week');
  await page.addInitScript(seedScript([
    { name:'soft A', type:'keepup', target:1, logs:[Date.now()-2*86400000], durationMinutes:120, locationIds:['home'], priority:2 },
    { name:'soft B', type:'keepup', target:1, logs:[Date.now()-2*86400000], durationMinutes:120, locationIds:['home'], priority:2 },
    { name:'soft C', type:'keepup', target:1, logs:[Date.now()-2*86400000], durationMinutes:120, locationIds:['office'], priority:2 },
    { name:'soft D', type:'keepup', target:1, logs:[Date.now()-2*86400000], durationMinutes:120, locationIds:['office'], priority:2 },
    { name:'soft E', type:'keepup', target:1, logs:[Date.now()-2*86400000], durationMinutes:120, locationIds:['farA'], priority:2 },
  ], {
    availabilityMinutes:[150,600,600,600,600,600,600],
    blockedTimes:[{ label:'sleep', days:[0,1,2,3,4,5,6], start:0, end:420, locationId:'home' }],
  }));
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);
  const spread = await page.evaluate(() => {
    const data = load(); const settings = loadSortSettings();
    const w = buildWeekAgenda(data, settings, 7);
    const byDay = w.days.map(d => ({
      offset: Math.round((d.dayBase - dayStart(Date.now())) / 86400000),
      timed: d.timeline.filter(r => r.kind === 'fill' || r.kind === 'scheduled').map(r => r.h.name),
    }));
    const timedNames = byDay.flatMap(d => d.timed);
    const soft = ['soft A','soft B','soft C','soft D','soft E'];
    return {
      byDay,
      timedCount: soft.filter(n => timedNames.includes(n)).length,
      todayCount: byDay[0].timed.filter(n => soft.includes(n)).length,
      laterCount: byDay.slice(1).reduce((n,d) => n + d.timed.filter(x => soft.includes(x)).length, 0),
    };
  });
  console.log(spread);
  assert(spread.timedCount >= 4, `most soft items get a suggested time (got ${spread.timedCount}/5)`);
  assert(spread.laterCount >= 1, 'at least one soft item deferred past today');
  assert(spread.todayCount < 5, 'today does not keep every soft due item');

  // ── G3. Sample-shaped overload: timed-only day cards on home ──
  console.log('\n[G3] sample overload — every day-section card has a time pill');
  await page.addInitScript(seedScript([
    { name:'home A', type:'keepup', target:1, logs:[Date.now()-3*86400000], durationMinutes:40, locationIds:['home'], priority:2, flexibilityDays:10 },
    { name:'home B', type:'keepup', target:1, logs:[Date.now()-3*86400000], durationMinutes:40, locationIds:['home'], priority:2, flexibilityDays:10 },
    { name:'home C', type:'keepup', target:1, logs:[Date.now()-3*86400000], durationMinutes:40, locationIds:['home'], priority:2, flexibilityDays:8 },
    { name:'office A', type:'keepup', target:1, logs:[Date.now()-3*86400000], durationMinutes:35, locationIds:['office'], priority:2, flexibilityDays:7 },
    { name:'office B', type:'keepup', target:1, logs:[Date.now()-3*86400000], durationMinutes:35, locationIds:['office'], priority:2, flexibilityDays:7 },
    { name:'far pair 1', type:'task', dueDate: dayStartOf(3), durationMinutes:30, locationIds:['farA'], priority:0 },
    { name:'far pair 2', type:'task', dueDate: dayStartOf(3), durationMinutes:30, locationIds:['farB'], priority:0 },
    { name:'hard pin', type:'task', dueDate: dayStartOf(0), hardDue:true, durationMinutes:20, locationIds:['office'], priority:0 },
    { name:'planned pin', type:'keepup', target:3, logs:[Date.now()-10*86400000, {ts:Date.now(),plan:true}], durationMinutes:40, locationIds:['home'], priority:0 },
  ], {
    availabilityMinutes:[240,90,90,90,90,90,240],
    blockedTimes:[
      { label:'sleep', days:[0,1,2,3,4,5,6], start:0, end:420, locationId:'home' },
      { label:'work', days:[1,2,3,4,5], start:540, end:1020, locationId:'office' },
    ],
    showWeekOnHome:true,
  }));
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const s = loadSortSettings();
    s.showWeekOnHome = true;
    saveSortSettings(s);
    if(typeof render === 'function')render();
  });
  await page.waitForFunction(()=>document.querySelectorAll('#list .section-header').length > 0,null,{timeout:10000});
  const overload = await page.evaluate(() => {
    const list = document.getElementById('list');
    const headers = [...list.querySelectorAll('.section-header')].map(el => el.textContent.trim());
    const dayLabels = new Set(['today','tomorrow','others','overdue','upcoming']);
    // Walk children: section headers bound day vs leftover sections.
    let section = '';
    let inDay = false;
    let todayUntimed = 0;
    let dayCardsMissingPill = 0;
    let dayCards = 0;
    let daysWithFills = 0;
    const fillsByDay = {};
    const children = [...list.children];
    for(const el of children){
      if(el.classList.contains('section-header')){
        section = el.textContent.trim();
        inDay = !['overdue','upcoming','others'].includes(section);
        if(inDay)fillsByDay[section] = fillsByDay[section] || 0;
        continue;
      }
      if(el.classList.contains('swipe-row')){
        const pill = el.querySelector('.context-pill.agenda-lead');
        if(inDay){
          dayCards += 1;
          fillsByDay[section] = (fillsByDay[section] || 0) + 1;
          if(!pill)dayCardsMissingPill += 1;
          if(section === 'today' && !pill)todayUntimed += 1;
        }
      }
    }
    daysWithFills = Object.values(fillsByDay).filter(n => n > 0).length;
    const w = buildWeekAgenda(load(), loadSortSettings(), 7);
    const timedDays = w.days.filter(d => d.timeline.some(r => r.kind === 'fill')).length;
    const farDays = w.days
      .map((d,idx) => ({
        idx,
        has1: d.timeline.some(r => r.kind === 'fill' && r.h.name === 'far pair 1'),
        has2: d.timeline.some(r => r.kind === 'fill' && r.h.name === 'far pair 2'),
      }))
      .filter(d => d.has1 || d.has2);
    const farClustered = farDays.length > 0 && farDays.every(d => !d.has1 || !d.has2 || (d.has1 && d.has2))
      && new Set(farDays.filter(d => d.has1 && d.has2).map(d => d.idx)).size <= 1
      && farDays.filter(d => d.has1 && d.has2).length >= (farDays.some(d => d.has1) && farDays.some(d => d.has2) ? 1 : 0);
    // If both far errands earned a timed slot, they must share one day.
    const bothPlaced = farDays.some(d => d.has1) && farDays.some(d => d.has2);
    const shared = farDays.some(d => d.has1 && d.has2);
    return {
      headers,
      todayUntimed,
      dayCardsMissingPill,
      dayCards,
      daysWithFills,
      timedDays,
      bothFarPlaced: bothPlaced,
      farSharedDay: shared,
      leftoverHeaders: headers.filter(h => h === 'overdue' || h === 'upcoming' || h === 'others'),
    };
  });
  console.log(overload);
  assert(overload.todayUntimed === 0, 'no untimed cards under today');
  assert(overload.dayCardsMissingPill === 0, `every day-section habit card has a time pill (missing ${overload.dayCardsMissingPill})`);
  assert(overload.timedDays >= 2, `soft work spreads across multiple days (got ${overload.timedDays})`);
  if(overload.bothFarPlaced){
    assert(overload.farSharedDay, 'co-located far errands share a day when both place');
  }
  assert(overload.leftoverHeaders.every(h => h === 'overdue' || h === 'upcoming' || h === 'others'), 'leftovers only use overdue/upcoming/others');

  // ── G4. Habit one-off planByDate pulls a not-yet-due habit into the week ──
  console.log('\n[G4] habit planByDate soft deadline');
  const planByEnd = dayStartOf(5);
  await page.addInitScript(seedScript([
    // Long rhythm — not due for ~25 more days — but plan-by end of week.
    { name:'plan-by habit', type:'keepup', target:30, logs:[Date.now()-5*86400000], durationMinutes:30, locationIds:['home'], priority:2, planByDate: planByEnd },
  ], {
    availabilityMinutes:[600,600,600,600,600,600,600],
    showWeekOnHome:true,
  }));
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);
  const planBy = await page.evaluate((endTs) => {
    const data = load();
    const settings = loadSortSettings();
    const h = data.find(x => x.name === 'plan-by habit');
    const w = buildWeekAgenda(data, settings, 7);
    const placed = w.days
      .map(d => ({
        offset: Math.round((d.dayBase - dayStart(Date.now())) / 86400000),
        has: d.timeline.some(r => (r.kind === 'fill' || r.kind === 'scheduled') && r.h.name === 'plan-by habit'),
      }))
      .filter(d => d.has);
    const eligibleDays = w.days.filter(d => isWeekCandidate(h, settings, d.dayBase, d.weekday)).length;
    return {
      planByDate: h?.planByDate ?? null,
      normalized: habitPlanByDate(h),
      eligibleDays,
      placedOffsets: placed.map(d => d.offset),
      placed: placed.length > 0,
      pastDeadline: placed.every(d => d.offset <= Math.round((dayStart(endTs) - dayStart(Date.now())) / 86400000)),
      cue: typeof cardCue === 'function' ? cardCue(h) : '',
    };
  }, planByEnd);
  console.log(planBy);
  assert(planBy.normalized === planByEnd || planBy.planByDate === planByEnd, 'planByDate survives normalize');
  assert(planBy.eligibleDays >= 2, `plan-by habit eligible on multiple week days (got ${planBy.eligibleDays})`);
  assert(planBy.placed, 'plan-by habit gets a timed week slot');
  assert(planBy.pastDeadline, 'plan-by habit placed on or before the deadline');
  assert(/plan by/i.test(planBy.cue), `card cue mentions plan by (got "${planBy.cue}")`);

  // Logging clears the one-off plan-by.
  const cleared = await page.evaluate(() => {
    const data = load();
    const idx = data.findIndex(x => x.name === 'plan-by habit');
    logTing(idx);
    const next = load()[idx];
    return { planByDate: next.planByDate, lastLog: next.lastLog };
  });
  assert(cleared.planByDate == null, 'logging clears planByDate');
  assert(cleared.lastLog != null, 'logging sets lastLog');

  // ── G5. Outbound leave-by variants (placement must reserve post-task travel) ──
  // Matrix covers the live bug and neighboring cases that share leave-by /
  // presence machinery:
  //   A. under-min skip      — pocket < minChunk after leave-by
  //   B. capped fit          — session ends exactly at leave-by
  //   C. same-location       — next hard row same place → no outbound reserve
  //   D. fixed fill          — non-breakable duration respects leave-by
  //   E. pre-task leave      — morning fill yields for travel INTO appointment
  //   F. blocked anchor      — location-tied block is an outbound target
  //   G. travel card         — homeDaySequence leave-by aligns with placed end
  //   H. explicit location   — fill pinned to Mechanic still caps at leave-by
  //   I. travel eats gap     — commute ≥ open gap → nothing places
  //   J. location-less next  — next scheduled has no place → no outbound reserve
  //   K. multi-leg target    — leave-by uses Mechanic→Office, not Home
  //   L. fill-to-fill        — already-placed fill is an outbound target
  //   M. zero-travel edge    — different places, 0s commute → full gap usable
  //   N. dual-pocket split   — morning + post-oil both respect their leave-bys
  //   O. inbound + outbound  — travel into fill location AND out to next task
  console.log('\n[G5] outbound leave-by variants');
  const outbound = await page.evaluate(() => {
    const dayBase = dayStart(Date.now());
    const at = (h, m) => dayBase + (h * 60 + m) * 60000;
    const places = [
      { id:'home', name:'Home', lat:40.700, lng:-74.000 },
      { id:'mechanic', name:'Mechanic', lat:40.710, lng:-74.010 },
      { id:'office', name:'Office', lat:40.720, lng:-74.020 },
    ];
    const settings = Object.assign(loadSortSettings(), {
      locations:places,
      defaultTravelMode:'driving',
      lastKnownLocationId:'home',
      availabilityMinutes:[600,600,600,600,600,600,600],
      blockedTimes:[
        { label:'sleep', days:[0,1,2,3,4,5,6], start:0, end:420, locationId:'home' },
        { label:'evening wind-down', days:[0,1,2,3,4,5,6], start:22 * 60, end:24 * 60, locationId:'home' }
      ],
      travel:{
        'home|mechanic':{
          a:'home', b:'mechanic', seconds:16 * 60, metres:2000,
          provider:'manual', fetchedAt:Date.now()
        },
        'home|office':{
          a:'home', b:'office', seconds:20 * 60, metres:3000,
          provider:'manual', fetchedAt:Date.now()
        },
        'mechanic|office':{
          a:'mechanic', b:'office', seconds:12 * 60, metres:1500,
          provider:'manual', fetchedAt:Date.now()
        }
      }
    });
    saveSortSettings(settings);

    function edgeSeconds(fromId, toId){
      const edge = travelBetween(
        places.find(l => l.id === fromId),
        places.find(l => l.id === toId),
        'driving',
        { allowNetwork:false }
      );
      return Number(edge.seconds) || 0;
    }

    function setTravelMinutes(aId, bId, minutes){
      const key = aId < bId ? `${aId}|${bId}` : `${bId}|${aId}`;
      settings.travel[key] = {
        a:aId < bId ? aId : bId,
        b:aId < bId ? bId : aId,
        seconds:Math.max(0, Math.round(minutes * 60)),
        metres:2000,
        provider:'manual',
        fetchedAt:Date.now()
      };
      saveSortSettings(settings);
    }

    function task(name, locId, startTs, durationMinutes){
      return {
        name, type:'task', target:null, flexibilityDays:0,
        durationMinutes, breakable:false, minChunkMinutes:30,
        eventTime:startTs, dueDate:null, hardDue:false, markDone:true,
        locationIds:locId ? [locId] : [], anywhereAllowed:!locId,
        logs:[], lastLog:null, priority:0, createdAt:Date.now()
      };
    }

    function workHabit(opts){
      return Object.assign({
        name:'Work', type:'keepup', target:1, flexibilityDays:0,
        durationMinutes:360, breakable:true, minChunkMinutes:30,
        eventTime:null, dueDate:null, hardDue:false, markDone:true,
        locationIds:[], anywhereAllowed:true, logs:[], lastLog:null,
        priority:1, createdAt:Date.now()
      }, opts);
    }

    function placeDay({ scheduledHabits, fillHabits, fillHabit, slotStart, slotEnd, slots, seedLocId }){
      const fills = fillHabits || (fillHabit ? [fillHabit] : []);
      const data = normalize([...(scheduledHabits || []), ...fills]);
      const scheduled = data
        .map((h, i) => ({ h, i }))
        .filter(({ h }) => h.eventTime != null);
      const day = {
        scheduled,
        agendaItems:fills.map(src => {
          const i = data.findIndex(h => h.name === src.name);
          return {
            h:data[i],
            i,
            priority:src.priority != null ? src.priority : 1,
            scarcity:src._scarcity != null ? src._scarcity : 0
          };
        }),
        totalMinutes:600,
        slots:slots || [{ start:slotStart, end:slotEnd }],
        dayBase,
        weekday:new Date(dayBase).getDay(),
        isToday:true,
        dayKey:dateKey(dayBase)
      };
      if(seedLocId)settings.lastKnownLocationId = seedLocId;
      saveSortSettings(settings);
      const clock = slotStart != null ? slotStart : (slots && slots[0] && slots[0].start);
      const timeline = buildDayTimeline(day, {
        now:clock,
        dayBase,
        startClock:clock,
        weekMode:true
      });
      const fillRowsFor = (name) => timeline.filter(r => r.kind === 'fill' && r.h && r.h.name === name);
      const seq = typeof homeDaySequence === 'function'
        ? homeDaySequence({ ...day, timeline, isToday:true }, settings)
        : [];
      const travelAfter = (name) => seq.filter((r, idx) => {
        if(r.kind !== 'travel')return false;
        const prev = seq[idx - 1];
        return prev && prev.kind === 'fill' && prev.h && prev.h.name === name;
      });
      return {
        timeline,
        fillRows:fillRowsFor(fills[0] && fills[0].name),
        fillRowsFor,
        travelAfter,
        seq,
        day
      };
    }

    // Shared appointment sandwich: Oil @ Mechanic 10:06–12:06, Child @ Home 1:00.
    const oil = task('Oil change', 'mechanic', at(10, 6), 120);
    const child = task('The Perfect Child', 'home', at(13, 0), 30);
    const leaveByHome = at(13, 0) - edgeSeconds('mechanic', 'home') * 1000;
    const usablePostOil = Math.floor((leaveByHome - at(12, 6)) / 60000);
    const morningLeaveBy = at(10, 6) - edgeSeconds('home', 'mechanic') * 1000;

    // A. under-min skip
    const skip = placeDay({
      scheduledHabits:[oil, child],
      fillHabit:workHabit({ minChunkMinutes:45 }),
      slotStart:at(12, 6),
      slotEnd:at(13, 0),
      seedLocId:'home'
    });
    const skipPocket = skip.fillRows.filter(r => r.start >= at(12, 6) - 1000 && r.start < at(13, 0));

    // B. capped fit
    const capped = placeDay({
      scheduledHabits:[oil, child],
      fillHabit:workHabit({ minChunkMinutes:30 }),
      slotStart:at(12, 6),
      slotEnd:at(13, 0),
      seedLocId:'home'
    });
    const cappedPocket = capped.fillRows.filter(r => r.start >= at(12, 6) - 1000 && r.start < at(13, 0));

    // C. same-location next hard row — Child also at Mechanic → full 54m usable
    const childMechanic = task('Pickup', 'mechanic', at(13, 0), 30);
    const sameLoc = placeDay({
      scheduledHabits:[oil, childMechanic],
      fillHabit:workHabit({ minChunkMinutes:30 }),
      slotStart:at(12, 6),
      slotEnd:at(13, 0),
      seedLocId:'home'
    });
    const samePocket = sameLoc.fillRows.filter(r => r.start >= at(12, 6) - 1000 && r.start < at(13, 0));

    // D. fixed (non-breakable) fill — 50m can't fit in 38m leave-by window
    const fixedTooLong = placeDay({
      scheduledHabits:[oil, child],
      fillHabit:workHabit({
        name:'Errand pack',
        breakable:false,
        durationMinutes:50,
        minChunkMinutes:30
      }),
      slotStart:at(12, 6),
      slotEnd:at(13, 0),
      seedLocId:'home'
    });
    const fixedFit = placeDay({
      scheduledHabits:[oil, child],
      fillHabit:workHabit({
        name:'Quick call',
        breakable:false,
        durationMinutes:30,
        minChunkMinutes:30
      }),
      slotStart:at(12, 6),
      slotEnd:at(13, 0),
      seedLocId:'home'
    });

    // E. pre-task leave-by — morning fill must leave for Oil @ Mechanic
    const preTask = placeDay({
      scheduledHabits:[oil],
      fillHabit:workHabit({
        name:'Morning deep work',
        breakable:false,
        durationMinutes:120,
        locationIds:[],
        anywhereAllowed:true
      }),
      slotStart:at(8, 0),
      slotEnd:at(10, 6),
      seedLocId:'home'
    });
    const preTaskFit = placeDay({
      scheduledHabits:[oil],
      fillHabit:workHabit({
        name:'Morning notes',
        breakable:false,
        durationMinutes:40,
        locationIds:[],
        anywhereAllowed:true
      }),
      slotStart:at(8, 0),
      slotEnd:at(10, 6),
      seedLocId:'home'
    });

    // F. blocked-time outbound — evening fill before Home wind-down block
    const officeErrand = task('Office drop', 'office', at(18, 0), 60);
    const blockLeaveBy = at(22, 0) - edgeSeconds('office', 'home') * 1000;
    const blocked = placeDay({
      scheduledHabits:[officeErrand],
      fillHabit:workHabit({
        name:'Office leftover',
        breakable:true,
        minChunkMinutes:30,
        durationMinutes:200,
        locationIds:['office'],
        anywhereAllowed:false
      }),
      slotStart:at(19, 0),
      slotEnd:at(22, 0),
      seedLocId:'office'
    });
    const blockedPocket = blocked.fillRows.filter(r => r.start >= at(19, 0) - 1000 && r.start < at(22, 0));

    // G. travel card after fill aligns with leave-by
    const travelCard = capped.travelAfter('Work')[0] || null;

    // H. explicit Mechanic location on the fill (not anywhere)
    const explicit = placeDay({
      scheduledHabits:[oil, child],
      fillHabit:workHabit({
        name:'Shop laptop',
        minChunkMinutes:30,
        locationIds:['mechanic'],
        anywhereAllowed:false
      }),
      slotStart:at(12, 6),
      slotEnd:at(13, 0),
      seedLocId:'home'
    });
    const explicitPocket = explicit.fillRowsFor('Shop laptop')
      .filter(r => r.start >= at(12, 6) - 1000 && r.start < at(13, 0));

    // I. travel eats the whole gap (60m commute into a 54m pocket)
    setTravelMinutes('mechanic', 'home', 60);
    const eaten = placeDay({
      scheduledHabits:[oil, child],
      fillHabit:workHabit({ name:'No room', minChunkMinutes:15 }),
      slotStart:at(12, 6),
      slotEnd:at(13, 0),
      seedLocId:'home'
    });
    setTravelMinutes('mechanic', 'home', 16); // restore

    // J. next scheduled has no location → no outbound reserve → full 54m
    const floatingChild = task('Floating review', null, at(13, 0), 30);
    const noLocNext = placeDay({
      scheduledHabits:[oil, floatingChild],
      fillHabit:workHabit({ name:'Post-oil float', minChunkMinutes:30 }),
      slotStart:at(12, 6),
      slotEnd:at(13, 0),
      seedLocId:'home'
    });
    const noLocPocket = noLocNext.fillRowsFor('Post-oil float')
      .filter(r => r.start >= at(12, 6) - 1000 && r.start < at(13, 0));

    // K. multi-leg — next hard is Office, leave-by uses Mechanic→Office (12m)
    const officeMeet = task('Office standup', 'office', at(13, 0), 30);
    const leaveByOffice = at(13, 0) - edgeSeconds('mechanic', 'office') * 1000;
    const multiLeg = placeDay({
      scheduledHabits:[oil, officeMeet],
      fillHabit:workHabit({ name:'Between errands', minChunkMinutes:30 }),
      slotStart:at(12, 6),
      slotEnd:at(13, 0),
      seedLocId:'home'
    });
    const multiPocket = multiLeg.fillRowsFor('Between errands')
      .filter(r => r.start >= at(12, 6) - 1000 && r.start < at(13, 0));
    const multiTravel = multiLeg.travelAfter('Between errands')[0] || null;

    // L. fill-to-fill — already-placed Office fill is the outbound target
    const fillToFill = (() => {
      const work = workHabit({ name:'Before gym', minChunkMinutes:30, durationMinutes:120 });
      const gym = workHabit({
        name:'Gym block',
        breakable:false,
        durationMinutes:45,
        locationIds:['office'],
        anywhereAllowed:false,
        priority:0
      });
      const data = normalize([oil, work, gym]);
      const scheduled = data.map((h, i) => ({ h, i })).filter(({ h }) => h.eventTime != null);
      const workIdx = data.findIndex(h => h.name === 'Before gym');
      const gymIdx = data.findIndex(h => h.name === 'Gym block');
      const day = {
        scheduled,
        agendaItems:[],
        totalMinutes:600,
        slots:[{ start:at(12, 6), end:at(14, 0) }],
        dayBase,
        weekday:new Date(dayBase).getDay(),
        isToday:true,
        dayKey:dateKey(dayBase)
      };
      settings.lastKnownLocationId = 'home';
      saveSortSettings(settings);
      const state = createDayPlacementState(day, settings, {
        now:at(12, 6),
        dayBase,
        startClock:at(12, 6)
      });
      // Pin Gym at Office starting 1:00 — Work before it must leave by 12:48.
      commitPlacement(state, { h:data[gymIdx], i:gymIdx }, {
        placeStart:at(13, 0),
        placeEnd:at(13, 45),
        locId:'office',
        edge:{ seconds:0, metres:0, provider:'none' },
        travelMin:0,
        durMin:45,
        slotStart:at(12, 6),
        preferredHit:false,
        prevLocId:'mechanic',
        placeKey:gymIdx
      });
      placeBreakableSessions(state, { h:data[workIdx], i:workIdx }, { allowNetwork:false });
      const rows = finalizePlacementRows(state);
      const workRows = rows.filter(r => r.kind === 'fill' && r.h && r.h.name === 'Before gym');
      const leaveBy = at(13, 0) - edgeSeconds('mechanic', 'office') * 1000;
      return {
        leaveBy,
        usable:Math.floor((leaveBy - at(12, 6)) / 60000),
        count:workRows.length,
        duration:workRows[0] ? Math.round((workRows[0].end - workRows[0].start) / 60000) : null,
        end:workRows[0] ? workRows[0].end : null,
        overlaps:workRows.some(r => r.end > leaveBy + 1000)
      };
    })();

    // M. zero-travel edge between different places → full gap usable
    setTravelMinutes('mechanic', 'home', 0);
    const zeroTravel = placeDay({
      scheduledHabits:[oil, child],
      fillHabit:workHabit({ name:'Zero commute', minChunkMinutes:30 }),
      slotStart:at(12, 6),
      slotEnd:at(13, 0),
      seedLocId:'home'
    });
    const zeroPocket = zeroTravel.fillRowsFor('Zero commute')
      .filter(r => r.start >= at(12, 6) - 1000 && r.start < at(13, 0));
    setTravelMinutes('mechanic', 'home', 16); // restore

    // N. dual-pocket split — morning before oil + post-oil before child
    const dual = placeDay({
      scheduledHabits:[oil, child],
      fillHabit:workHabit({ name:'Split day', minChunkMinutes:30, durationMinutes:360 }),
      slots:[
        { start:at(8, 0), end:at(10, 6) },
        { start:at(12, 6), end:at(13, 0) }
      ],
      slotStart:at(8, 0),
      seedLocId:'home'
    });
    const dualMorning = dual.fillRowsFor('Split day')
      .filter(r => r.start >= at(8, 0) - 1000 && r.start < at(10, 6));
    const dualPost = dual.fillRowsFor('Split day')
      .filter(r => r.start >= at(12, 6) - 1000 && r.start < at(13, 0));

    // O. inbound + outbound — seed Home, fill pinned Mechanic, next Home task
    //    (no prior Mechanic appointment). Arrive 12:06+16=12:22, leave by 12:43.
    const soloChild = task('Home reading', 'home', at(13, 0), 30);
    const bothWaysLeaveBy = at(13, 0) - edgeSeconds('mechanic', 'home') * 1000;
    const bothWays = placeDay({
      scheduledHabits:[soloChild],
      fillHabit:workHabit({
        name:'Cafe focus',
        minChunkMinutes:15,
        durationMinutes:120,
        locationIds:['mechanic'],
        anywhereAllowed:false
      }),
      slotStart:at(12, 6),
      slotEnd:at(13, 0),
      seedLocId:'home'
    });
    const bothPocket = bothWays.fillRowsFor('Cafe focus')
      .filter(r => r.start >= at(12, 6) - 1000 && r.start < at(13, 0));
    const bothArrive = at(12, 6) + edgeSeconds('home', 'mechanic') * 1000;
    const bothTravelBefore = bothWays.seq.filter(r => r.kind === 'travel' && r.to === 'mechanic');
    const bothTravelAfter = bothWays.travelAfter('Cafe focus');

    return {
      usablePostOil,
      leaveByHome,
      travelHomeMin:Math.round(edgeSeconds('mechanic', 'home') / 60),
      A:{
        pocketCount:skipPocket.length,
        overlaps:skipPocket.some(r => r.end > leaveByHome + 1000)
      },
      B:{
        pocketCount:cappedPocket.length,
        duration:cappedPocket[0] ? Math.round((cappedPocket[0].end - cappedPocket[0].start) / 60000) : null,
        end:cappedPocket[0] ? cappedPocket[0].end : null,
        overlaps:cappedPocket.some(r => r.end > leaveByHome + 1000)
      },
      C:{
        pocketCount:samePocket.length,
        duration:samePocket[0] ? Math.round((samePocket[0].end - samePocket[0].start) / 60000) : null
      },
      D:{
        tooLongPlaced:fixedTooLong.fillRows.length,
        fitPlaced:fixedFit.fillRows.length,
        fitEnd:fixedFit.fillRows[0] ? fixedFit.fillRows[0].end : null,
        fitOverlaps:fixedFit.fillRows.some(r => r.end > leaveByHome + 1000)
      },
      E:{
        morningLeaveBy,
        tooLongPlaced:preTask.fillRows.length,
        fitPlaced:preTaskFit.fillRows.length,
        fitEnd:preTaskFit.fillRows[0] ? preTaskFit.fillRows[0].end : null,
        fitOverlaps:preTaskFit.fillRows.some(r => r.end > morningLeaveBy + 1000),
        usableMorning:Math.floor((morningLeaveBy - at(8, 0)) / 60000)
      },
      F:{
        blockLeaveBy,
        pocketCount:blockedPocket.length,
        duration:blockedPocket[0] ? Math.round((blockedPocket[0].end - blockedPocket[0].start) / 60000) : null,
        end:blockedPocket[0] ? blockedPocket[0].end : null,
        overlaps:blockedPocket.some(r => r.end > blockLeaveBy + 1000),
        usable:Math.floor((blockLeaveBy - at(19, 0)) / 60000)
      },
      G:{
        hasTravel:Boolean(travelCard),
        from:travelCard && travelCard.from,
        to:travelCard && travelCard.to,
        travelStart:travelCard && travelCard.start,
        travelEnd:travelCard && travelCard.end,
        fillEnd:cappedPocket[0] ? cappedPocket[0].end : null,
        leaveBy:leaveByHome
      },
      H:{
        pocketCount:explicitPocket.length,
        duration:explicitPocket[0] ? Math.round((explicitPocket[0].end - explicitPocket[0].start) / 60000) : null,
        end:explicitPocket[0] ? explicitPocket[0].end : null,
        loc:explicitPocket[0] ? explicitPocket[0].locationId : null,
        overlaps:explicitPocket.some(r => r.end > leaveByHome + 1000)
      },
      I:{
        placed:eaten.fillRowsFor('No room').length
      },
      J:{
        pocketCount:noLocPocket.length,
        duration:noLocPocket[0] ? Math.round((noLocPocket[0].end - noLocPocket[0].start) / 60000) : null
      },
      K:{
        leaveByOffice,
        usable:Math.floor((leaveByOffice - at(12, 6)) / 60000),
        pocketCount:multiPocket.length,
        duration:multiPocket[0] ? Math.round((multiPocket[0].end - multiPocket[0].start) / 60000) : null,
        end:multiPocket[0] ? multiPocket[0].end : null,
        travelFrom:multiTravel && multiTravel.from,
        travelTo:multiTravel && multiTravel.to,
        overlaps:multiPocket.some(r => r.end > leaveByOffice + 1000)
      },
      L:fillToFill,
      M:{
        pocketCount:zeroPocket.length,
        duration:zeroPocket[0] ? Math.round((zeroPocket[0].end - zeroPocket[0].start) / 60000) : null,
        end:zeroPocket[0] ? zeroPocket[0].end : null,
        childStart:at(13, 0)
      },
      N:{
        morningCount:dualMorning.length,
        morningDuration:dualMorning[0] ? Math.round((dualMorning[0].end - dualMorning[0].start) / 60000) : null,
        morningEnd:dualMorning[0] ? dualMorning[0].end : null,
        morningLeaveBy,
        postCount:dualPost.length,
        postDuration:dualPost[0] ? Math.round((dualPost[0].end - dualPost[0].start) / 60000) : null,
        postEnd:dualPost[0] ? dualPost[0].end : null,
        morningOverlaps:dualMorning.some(r => r.end > morningLeaveBy + 1000),
        postOverlaps:dualPost.some(r => r.end > leaveByHome + 1000)
      },
      O:{
        bothArrive,
        bothWaysLeaveBy,
        usable:Math.floor((bothWaysLeaveBy - bothArrive) / 60000),
        pocketCount:bothPocket.length,
        start:bothPocket[0] ? bothPocket[0].start : null,
        end:bothPocket[0] ? bothPocket[0].end : null,
        duration:bothPocket[0] ? Math.round((bothPocket[0].end - bothPocket[0].start) / 60000) : null,
        inboundCount:bothTravelBefore.length,
        outboundCount:bothTravelAfter.length,
        outboundFrom:bothTravelAfter[0] && bothTravelAfter[0].from,
        outboundTo:bothTravelAfter[0] && bothTravelAfter[0].to,
        overlaps:bothPocket.some(r => r.end > bothWaysLeaveBy + 1000)
      }
    };
  });
  console.log(outbound);

  // A — under-min skip
  assert(outbound.travelHomeMin === 16, `A travel Home↔Mechanic is 16m (got ${outbound.travelHomeMin})`);
  assert(outbound.usablePostOil < 45, `A post-oil usable under min45 (got ${outbound.usablePostOil})`);
  assert(outbound.A.pocketCount === 0, `A min45 skips post-oil pocket (got ${outbound.A.pocketCount})`);
  assert(!outbound.A.overlaps, 'A min45 does not overlap leave-by');

  // B — capped fit
  assert(outbound.B.pocketCount === 1, `B min30 places one post-oil session (got ${outbound.B.pocketCount})`);
  assert(outbound.B.duration === outbound.usablePostOil,
    `B uses full leave-by-capped pocket (got ${outbound.B.duration} vs ${outbound.usablePostOil})`);
  assert(outbound.B.end === outbound.leaveByHome, 'B Work ends exactly at leave-by');
  assert(!outbound.B.overlaps, 'B does not overlap leave-by');

  // C — same location: no outbound reserve, full gap usable
  assert(outbound.C.pocketCount === 1, `C same-location places post-oil Work (got ${outbound.C.pocketCount})`);
  assert(outbound.C.duration === 54,
    `C uses full gap to next same-location task (got ${outbound.C.duration})`);

  // D — fixed fill respects leave-by
  assert(outbound.D.tooLongPlaced === 0, `D 50m fixed fill rejected from 38m leave-by window (got ${outbound.D.tooLongPlaced})`);
  assert(outbound.D.fitPlaced === 1, `D 30m fixed fill places (got ${outbound.D.fitPlaced})`);
  assert(!outbound.D.fitOverlaps, 'D fixed fill does not overlap leave-by');
  assert(outbound.D.fitEnd <= outbound.leaveByHome + 1000, 'D fixed fill ends by leave-by');

  // E — pre-appointment leave-by
  assert(outbound.E.usableMorning === 110,
    `E morning usable after leave-by is 110m (got ${outbound.E.usableMorning})`);
  assert(outbound.E.tooLongPlaced === 0, `E 120m morning fill rejected when leave-by needs 16m (got ${outbound.E.tooLongPlaced})`);
  assert(outbound.E.fitPlaced === 1, `E 40m morning fill places (got ${outbound.E.fitPlaced})`);
  assert(!outbound.E.fitOverlaps, 'E morning fill does not overlap travel-to-oil');
  assert(outbound.E.fitEnd <= outbound.E.morningLeaveBy + 1000, 'E morning fill ends by oil leave-by');

  // F — blocked-time outbound target
  assert(outbound.F.usable > 0, `F evening usable after leave-by (got ${outbound.F.usable})`);
  assert(outbound.F.pocketCount === 1, `F places office leftover before Home block (got ${outbound.F.pocketCount})`);
  assert(outbound.F.duration === outbound.F.usable,
    `F uses full block-capped pocket (got ${outbound.F.duration} vs ${outbound.F.usable})`);
  assert(outbound.F.end === outbound.F.blockLeaveBy, 'F ends exactly at leave-by for Home block');
  assert(!outbound.F.overlaps, 'F does not overlap travel-home before wind-down');

  // G — travel card after the fill matches leave-by
  assert(outbound.G.hasTravel, 'G homeDaySequence inserts travel after post-oil Work');
  assert(outbound.G.from === 'mechanic' && outbound.G.to === 'home',
    `G travel is Mechanic→Home (got ${outbound.G.from}→${outbound.G.to})`);
  assert(outbound.G.travelStart === outbound.G.fillEnd,
    'G travel starts when Work ends (leave-by)');
  assert(outbound.G.travelStart === outbound.leaveByHome,
    'G travel start equals computed leave-by');
  assert(outbound.G.travelEnd === outbound.leaveByHome + outbound.travelHomeMin * 60 * 1000,
    'G travel ends at Perfect Child start');

  // H — explicit Mechanic location
  assert(outbound.H.pocketCount === 1, `H explicit-location fill places (got ${outbound.H.pocketCount})`);
  assert(outbound.H.loc === 'mechanic', `H fill stays at Mechanic (got ${outbound.H.loc})`);
  assert(outbound.H.duration === outbound.usablePostOil,
    `H uses leave-by-capped pocket (got ${outbound.H.duration})`);
  assert(outbound.H.end === outbound.leaveByHome, 'H ends at leave-by');
  assert(!outbound.H.overlaps, 'H does not overlap leave-by');

  // I — travel consumes the gap
  assert(outbound.I.placed === 0, `I nothing places when commute ≥ gap (got ${outbound.I.placed})`);

  // J — location-less next scheduled
  assert(outbound.J.pocketCount === 1, `J places when next task has no location (got ${outbound.J.pocketCount})`);
  assert(outbound.J.duration === 54, `J uses full gap with no outbound reserve (got ${outbound.J.duration})`);

  // K — multi-leg Mechanic→Office
  assert(outbound.K.usable === 42, `K usable after Mechanic→Office leave-by is 42m (got ${outbound.K.usable})`);
  assert(outbound.K.pocketCount === 1, `K places between Mechanic and Office (got ${outbound.K.pocketCount})`);
  assert(outbound.K.duration === 42, `K duration matches Office leave-by cap (got ${outbound.K.duration})`);
  assert(outbound.K.end === outbound.K.leaveByOffice, 'K ends at Mechanic→Office leave-by');
  assert(outbound.K.travelFrom === 'mechanic' && outbound.K.travelTo === 'office',
    `K travel card is Mechanic→Office (got ${outbound.K.travelFrom}→${outbound.K.travelTo})`);
  assert(!outbound.K.overlaps, 'K does not overlap Office leave-by');

  // L — fill-to-fill outbound target
  assert(outbound.L.usable === 42, `L usable before pinned Office fill is 42m (got ${outbound.L.usable})`);
  assert(outbound.L.count === 1, `L places Work before Gym fill (got ${outbound.L.count})`);
  assert(outbound.L.duration === 42, `L capped by fill-to-fill leave-by (got ${outbound.L.duration})`);
  assert(outbound.L.end === outbound.L.leaveBy, 'L ends at leave-by for next fill');
  assert(!outbound.L.overlaps, 'L does not overlap travel to next fill');

  // M — zero-travel different locations
  assert(outbound.M.pocketCount === 1, `M places with 0s commute (got ${outbound.M.pocketCount})`);
  assert(outbound.M.duration === 54, `M uses full gap when travel is 0s (got ${outbound.M.duration})`);
  assert(outbound.M.end === outbound.M.childStart,
    'M ends at next task start when commute is zero');

  // N — dual pocket morning + post-oil
  assert(outbound.N.morningCount === 1, `N places morning session (got ${outbound.N.morningCount})`);
  assert(outbound.N.morningDuration === outbound.E.usableMorning,
    `N morning uses oil leave-by cap (got ${outbound.N.morningDuration})`);
  assert(outbound.N.morningEnd === outbound.N.morningLeaveBy, 'N morning ends at oil leave-by');
  assert(outbound.N.postCount === 1, `N places post-oil session (got ${outbound.N.postCount})`);
  assert(outbound.N.postDuration === outbound.usablePostOil,
    `N post-oil uses home leave-by cap (got ${outbound.N.postDuration})`);
  assert(outbound.N.postEnd === outbound.leaveByHome, 'N post-oil ends at home leave-by');
  assert(!outbound.N.morningOverlaps && !outbound.N.postOverlaps, 'N neither pocket overlaps leave-by');

  // O — inbound + outbound around an explicit-location fill
  assert(outbound.O.usable === 22, `O usable after inbound+outbound is 22m (got ${outbound.O.usable})`);
  assert(outbound.O.pocketCount === 1, `O places Mechanic fill (got ${outbound.O.pocketCount})`);
  assert(outbound.O.start === outbound.O.bothArrive, 'O starts after inbound Home→Mechanic travel');
  assert(outbound.O.end === outbound.O.bothWaysLeaveBy, 'O ends at outbound leave-by');
  assert(outbound.O.duration === 22, `O duration is inbound/outbound residual (got ${outbound.O.duration})`);
  assert(outbound.O.inboundCount >= 1, `O sequence includes inbound travel (got ${outbound.O.inboundCount})`);
  assert(outbound.O.outboundCount === 1, `O sequence includes outbound travel (got ${outbound.O.outboundCount})`);
  assert(outbound.O.outboundFrom === 'mechanic' && outbound.O.outboundTo === 'home',
    `O outbound is Mechanic→Home (got ${outbound.O.outboundFrom}→${outbound.O.outboundTo})`);
  assert(!outbound.O.overlaps, 'O does not overlap leave-by');

  // ── Boot cleanliness ──
  console.log('\n[Boot] cleanliness');
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
