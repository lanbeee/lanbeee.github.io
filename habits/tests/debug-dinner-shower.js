// Reproduce the Shower-after-dinner-block issue.
// Synthetic data: Maghrib, Isha, Shower(d=5min) at Home; dinner 21:45-22:00.
// Freeze clock at 21:13 today.

const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage();

  const frozenClock = (() => {
    const d = new Date();
    d.setHours(21, 13, 0, 0);
    return d.getTime();
  })();
  await page.addInitScript(clock => {
    const RealDate = window.Date;
    function FrozenDate(...a){ return a.length ? new RealDate(...a) : new RealDate(clock); }
    FrozenDate.now = () => clock;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate);
    FrozenDate.prototype = RealDate.prototype;
    window.Date = FrozenDate;
  }, frozenClock);

  await page.goto(baseUrl, { waitUntil:'networkidle' });
  await page.evaluate(() => localStorage.clear());

  // Build a synthetic dataset that matches the user's setup.
  await page.evaluate(() => {
    const HOME = 'home-id';
    const today = new Date(Date.now());
    const todayIso = today.toISOString().slice(0,10);
    const yesterday = new Date(Date.now() - 86400000);
    const yIso = yesterday.toISOString().slice(0,10);
    // Force lastLog to be exactly 3 local-day-starts ago so daysSince===3.
    const dayBaseNow = new Date(); dayBaseNow.setHours(0,0,0,0);
    const three = new Date(dayBaseNow.getTime() - 3 * 86400000);

    const habits = [
      {
        hid:'maghrib', name:'Maghrib', type:'keepup', target:1,
        lastLog: new Date(yIso + 'T12:00:00').getTime(),
        logs:[ new Date(yIso + 'T12:00:00').getTime() ],
        allowedTimeStartAnchor:'maghrib', allowedTimeStartOffsetMin:2,
        allowedTimeEndAnchor:'maghrib', allowedTimeEndOffsetMin:-40,
        durationMinutes:10, priority:0, breakable:false, locationIds:[],
        allowedWeekdays:[], flexibilityDays:0, emoji:'🌄', topics:[],
      },
      {
        hid:'isha', name:'Isha', type:'keepup', target:1,
        lastLog:null, logs:[],
        allowedTimeStartAnchor:'isha', allowedTimeStartOffsetMin:0,
        allowedTimeEndAnchor:'isha', allowedTimeEndOffsetMin:120,
        durationMinutes:10, priority:0, breakable:false, locationIds:[],
        allowedWeekdays:[], flexibilityDays:0, emoji:'🌃', topics:[],
      },
      {
        hid:'shower', name:'Shower', type:'keepup', target:3,
        lastLog: three.getTime() + 13 * 3600000,
        logs:[ three.getTime() + 13 * 3600000 ],
        durationMinutes:5, priority:1, breakable:false,
        locationIds:[HOME],
        allowedWeekdays:[], flexibilityDays:0, emoji:'🚿', topics:[],
      },
    ];
    const settings = {
      preset:'todayFirst', showWeekOnHome:true, focus:'balanced',
      availabilityMinutes:[600,360,360,360,360,360,600],
      availabilityOverrides:{},
      blockedTimes:[
        // sleep: later-of [sunrise-8h today, isha+15min today] → sunrise-30 today
        { label:'sleep', days:[], locationId:HOME,
          startAnchor:'sunrise', startOffsetMin:-480,
          startCombine:'later', startAnchor2:'isha', startOffsetMin2:15, startDayOffset2:0,
          endAnchor:'sunrise', endOffsetMin:-30 },
        { label:'breakfast', days:[], start:530, end:540, locationId:HOME },
        { label:'work morning', days:[1,2,3,4,5], start:540, end:720 },
        { label:'work evening', days:[1,2,3,4,5], start:870, end:1050 },
        { label:'dinner', days:[], start:1305, end:1320, locationId:HOME }, // 21:45-22:00
      ],
      showScheduledTasksInAgenda:true, showDueTasksInAgenda:true,
      showPlannedItemsInAgenda:true, showDueHabitsInAgenda:true,
      locations:[{ id:HOME, name:'Home', lat:40.700, lng:-74.000 }],
      travel:{}, defaultTravelMode:'driving',
      prayerMethod:'NorthAmerica', prayerMadhab:'shafi',
      lastKnownLocationId:HOME,
    };
    localStorage.setItem('tings_v2', JSON.stringify(habits));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
  });

  await page.reload({ waitUntil:'networkidle' });

  const result = await page.evaluate(() => {
    const data = load();
    const settings = loadSortSettings();
    const out = { now:new Date().toString() };

    // Resolve prayer times for context.
    const home = settings.locations.find(l => l.name === 'Home');
    if (typeof adhan !== 'undefined' && home) {
      const params = prayerParams(settings);
      const c = new adhan.Coordinates(home.lat, home.lng);
      const t = new adhan.PrayerTimes(c, new Date(Date.now()), params);
      out.prayer = {
        maghrib:new Date(t.maghrib).toString(),
        isha:new Date(t.isha).toString(),
        sunrise:new Date(t.sunrise).toString(),
      };
    }

    // Today's slots.
    const todayKey = todayIso();
    out.todayKey = todayKey;
    out.todayAvailability = effectiveAvailabilityMinutes(todayKey, settings);

    // Build today's agenda.
    const agenda = buildTodayAgenda(data, settings);
    out.todayAgenda = {
      totalMinutes: agenda.totalMinutes,
      slots: agenda.slots.map(s => ({ start:new Date(s.start).toString(), end:new Date(s.end).toString() })),
      agendaItems: agenda.agendaItems.map(it => ({ i:it.i, name:it.h.name, priority:it.priority, scarcity:it.scarcity })),
    };

    // Today's timeline.
    const rows = buildTodayTimeline(agenda);
    out.todayTimeline = rows.map(r => ({
      kind:r.kind, i:r.i, name:r.h && r.h.name,
      start:new Date(r.start).toString(), end:new Date(r.end).toString(),
      locationId:r.locationId, label:r.label,
    }));

    // Today's slots for dinner
    out.dinnerBlock = (settings.blockedTimes || []).find(b => b.label === 'dinner');

    // Why is Shower not placed? Probe tryPlaceOnDay.
    const showerIdx = data.findIndex(h => h.name === 'Shower');
    if (showerIdx >= 0) {
      const shower = data[showerIdx];
      out.shower = {
        idx:showerIdx,
        lastLog:shower.lastLog,
        lastLogDate:new Date(shower.lastLog).toString(),
        daysSince:daysSince(shower.lastLog),
        target:shower.target,
        effectiveTarget:effectiveTarget(shower),
        includeInTodayAgenda: includeInTodayAgenda(shower, settings),
        windowStillDoableToday: windowStillDoableToday(shower),
        todayCategory: todayCategory(shower, settings),
        clampDuration: clampDuration(shower.durationMinutes),
        effectiveLocationWindowHome: effectiveLocationWindow(shower, settings.locations[0], new Date().getDay()),
      };
    }

    // Week view too.
    try {
      const wk = buildWeekAgenda(data, settings, 3);
      out.weekDays = wk.days.map(d => ({
        dayKey:d.dayKey, isToday:d.isToday,
        items:(d.agendaItems || []).map(it => ({ i:it.i, name:it.h && it.h.name })),
        timeline:(d.timeline || []).map(r => ({
          kind:r.kind, name:r.h && r.h.name, label:r.label,
          start:new Date(r.start).toString(), end:new Date(r.end).toString(),
        })),
      }));
    } catch (e) { out.weekError = e.message; }

    return out;
  });

  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
