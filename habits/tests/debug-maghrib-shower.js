// Debug script: synthesise the Maghrib + Shower dataset inline (what used
// to live in lib/sample_tings-backup-YYYY-MM-DD.json), freeze clock to
// "today 21:13" matching the original user bug-report screenshot, and dump
// everything the agenda pipeline produces for Maghrib + Shower.
//
// Generating data inline keeps the test self-contained — no dated backup
// file to re-create every day, and timestamps are computed from Date.now()
// so they stay valid whenever the test runs.
//
//   HABITS_URL=http://127.0.0.1:4173/ node tests/debug-maghrib-shower.js
//
const { chromium } = require('playwright');

const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

let pass = 0, fail = 0;
function assert(cond,msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      errors.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`));

  // Freeze clock to "today 21:13" — matching the user's screenshot moment.
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
    window.__tingsRealDate = RealDate;
    window.Date = FrozenDate;
  }, frozenClock);

  await page.goto(baseUrl, { waitUntil:'networkidle' });
  await page.evaluate(() => localStorage.clear());

  // Sanity: confirm the app exposed its storage keys.
  const keys = await page.evaluate(() => Object.keys(localStorage));
  console.log('initial localStorage keys:', keys);
  const appKeys = await page.evaluate(() => ({
    dataKey: typeof KEY !== 'undefined' ? KEY : null,
    settingsKey: typeof SORT_SETTINGS_KEY !== 'undefined' ? SORT_SETTINGS_KEY : null,
  }));
  console.log('app keys:', appKeys);
  assert(appKeys.dataKey && appKeys.settingsKey, 'app storage keys discovered (' + JSON.stringify(appKeys) + ')');

  // Synthesise Maghrib + Shower data inline. Times derived from the frozen
  // clock so the test is reproducible any day it runs.
  await page.evaluate(({ dataKey, settingsKey }) => {
    const HOME = 'home-id';
    const now = Date.now();
    const dayBase = new Date(now); dayBase.setHours(0,0,0,0);
    const yesterdayBase = dayBase.getTime() - 86400000;
    const three = new Date(yesterdayBase - 2 * 86400000);

    const habits = [
      {
        hid:'maghrib', name:'Maghrib', type:'keepup', target:1,
        lastLog: yesterdayBase + 12 * 3600000,
        logs:[ yesterdayBase + 12 * 3600000 ],
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
        { label:'sleep', days:[], locationId:HOME,
          startAnchor:'sunrise', startOffsetMin:-480,
          startCombine:'later', startAnchor2:'isha', startOffsetMin2:15, startDayOffset2:0,
          endAnchor:'sunrise', endOffsetMin:-30 },
        { label:'breakfast', days:[], start:530, end:540, locationId:HOME },
        { label:'work morning', days:[1,2,3,4,5], start:540, end:720 },
        { label:'work evening', days:[1,2,3,4,5], start:870, end:1050 },
        { label:'dinner', days:[], start:1305, end:1320, locationId:HOME },   // 21:45–22:00
      ],
      showScheduledTasksInAgenda:true, showDueTasksInAgenda:true,
      showPlannedItemsInAgenda:true, showDueHabitsInAgenda:true,
      locations:[{ id:HOME, name:'Home', lat:40.700, lng:-74.000 }],
      travel:{}, defaultTravelMode:'driving',
      prayerMethod:'NorthAmerica', prayerMadhab:'shafi',
      lastKnownLocationId:HOME,
    };
    localStorage.setItem(dataKey, JSON.stringify(habits));
    localStorage.setItem(settingsKey, JSON.stringify(settings));
  }, appKeys);

  await page.reload({ waitUntil:'networkidle' });

  // Sanity: prayer times for Home today resolve (anchors depend on them).
  const prayerDebug = await page.evaluate(() => {
    const s = (typeof loadSortSettings === 'function') ? loadSortSettings() : sortSettings;
    const home = (s.locations || []).find(l => l && l.name === 'Home');
    const out = { homePresent: !!home };
    if (home && typeof adhan !== 'undefined') {
      try {
        const params = (typeof prayerParams === 'function') ? prayerParams(s) : null;
        const coords = new adhan.Coordinates(home.lat, home.lng);
        const t = new adhan.PrayerTimes(coords, new Date(Date.now()), params);
        out.fajr = new Date(t.fajr).toString();
        out.sunrise = new Date(t.sunrise).toString();
        out.dhuhr = new Date(t.dhuhr).toString();
        out.asr = new Date(t.asr).toString();
        out.maghrib = new Date(t.maghrib).toString();
        out.isha = new Date(t.isha).toString();
      } catch (e) {
        out.prayerError = e.message;
      }
    }
    out.now = new Date().toString();
    return out;
  });
  console.log('\nPRAYER TIMES (Home, today):');
  console.log(prayerDebug);
  assert(!prayerDebug.prayerError, 'prayer times resolved without error');
  assert(prayerDebug.homePresent, 'Home location present');

  // Drill into Maghrib + Shower specifically.
  const debug = await page.evaluate(() => {
    const data = load();
    const settings = loadSortSettings();
    const find = name => data.findIndex(h => h && h.name === name);
    const maghribIdx = find('Maghrib');
    const showerIdx = find('Shower');
    const out = { maghribIdx, showerIdx };

    for (const [label, idx] of [['maghrib', maghribIdx], ['shower', showerIdx]]) {
      if (idx < 0) { out[label] = { notFound: true }; continue; }
      const h = data[idx];
      const dayBase = (typeof dayStart === 'function') ? dayStart(Date.now()) : new Date(Date.now()).setHours(0,0,0,0);
      const v = {
        idx,
        name: h.name,
        type: h.type,
        target: h.target,
        lastLog: h.lastLog,
        lastLogDate: h.lastLog ? new Date(h.lastLog).toString() : null,
        daysSinceLastLog: (typeof daysSince === 'function') ? daysSince(h.lastLog) : null,
        hasTimeWindow: (typeof hasTimeWindow === 'function') ? hasTimeWindow(h) : null,
        includeInTodayAgenda: (typeof includeInTodayAgenda === 'function') ? includeInTodayAgenda(h, settings) : null,
        windowStillDoableToday: (typeof windowStillDoableToday === 'function') ? windowStillDoableToday(h) : null,
        effectivePriority: (typeof effectivePriority === 'function') ? effectivePriority(h) : null,
        locationIds: h.locationIds,
      };
      if (typeof fillTimeWindow === 'function') {
        const win = fillTimeWindow(h, dayBase, settings.lastKnownLocationId);
        v.fillTimeWindow = win && {
          start: new Date(win.start).toString(),
          end: new Date(win.end).toString(),
        };
      }
      out[label] = v;
    }

    const todayKey = (typeof todayIso === 'function') ? todayIso() : null;
    out.todayKey = todayKey;
    out.availabilityMinutesToday = (typeof effectiveAvailabilityMinutes === 'function')
      ? effectiveAvailabilityMinutes(todayKey, settings) : null;

    try {
      const agenda = (typeof buildTodayAgenda === 'function') ? buildTodayAgenda(data, settings) : null;
      out.todayAgenda = agenda && {
        totalMinutes: agenda.totalMinutes,
        slots: (agenda.slots || []).map(s => ({ start: new Date(s.start).toString(), end: new Date(s.end).toString() })),
        scheduled: (agenda.scheduled || []).map(s => ({ i: s.i, name: s.h.name })),
        agendaItems: (agenda.agendaItems || []).map(it => ({ i: it.i, name: it.h.name, priority: it.priority, scarcity: it.scarcity })),
      };
    } catch (e) { out.todayAgendaError = e.message; }

    try {
      const agenda = (typeof buildTodayAgenda === 'function') ? buildTodayAgenda(data, settings) : null;
      if (agenda) {
        const rows = (typeof buildTodayTimeline === 'function') ? buildTodayTimeline(agenda) : null;
        out.todayTimeline = rows && rows.map(r => ({
          kind: r.kind,
          i: r.i,
          name: r.h && r.h.name,
          start: new Date(r.start).toString(),
          end: new Date(r.end).toString(),
          locationId: r.locationId,
          chunkMinutes: r.chunkMinutes,
        }));
      }
    } catch (e) { out.todayTimelineError = e.message; }

    try {
      if (typeof buildWeekAgenda === 'function') {
        const wk = buildWeekAgenda(data, settings, 7);
        out.weekAgenda = wk && wk.days && wk.days.map(d => ({
          dayKey: d.dayKey,
          isToday: d.isToday,
          agendaItems: (d.agendaItems || []).map(it => ({ i: it.i, name: it.h && it.h.name })),
          timelineCount: (d.timeline || []).length,
          timelineRows: (d.timeline || []).map(r => ({
            kind: r.kind,
            i: r.i,
            name: r.h && r.h.name,
            start: new Date(r.start).toString(),
            end: new Date(r.end).toString(),
          })),
        }));
      }
    } catch (e) { out.weekAgendaError = e.message; }

    return out;
  });

  console.log('\nDEBUG DUMP:');
  console.log(JSON.stringify(debug, null, 2));

  // Assertions: the dataset and pipeline must hold together without throwing.
  assert(debug.maghribIdx >= 0, 'Maghrib habit found in loaded data');
  assert(debug.showerIdx >= 0, 'Shower habit found in loaded data');
  assert(!debug.todayAgendaError, 'buildTodayAgenda did not throw (' + (debug.todayAgendaError || '') + ')');
  assert(!debug.todayTimelineError, 'buildTodayTimeline did not throw (' + (debug.todayTimelineError || '') + ')');
  assert(!debug.weekAgendaError, 'buildWeekAgenda did not throw (' + (debug.weekAgendaError || '') + ')');
  if(debug.todayAgenda){
    assert(Array.isArray(debug.todayAgenda.slots), 'today agenda has slots array');
    assert(debug.todayAgenda.slots.length > 0, 'today agenda has at least one open slot (' + debug.todayAgenda.slots.length + ')');
  }

  console.log('\nConsole errors/warnings:');
  if(errors.length === 0)console.log('  (none)');
  errors.forEach(e => console.log(' ', e));
  assert(errors.length === 0, 'no console errors/warnings (' + errors.length + ')');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
