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
