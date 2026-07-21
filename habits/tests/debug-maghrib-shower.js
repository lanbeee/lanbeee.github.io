// Debug script: load sample backup into the live app, freeze clock to
// "today 8:36 PM" (matching the user's bug report), and dump everything
// the agenda pipeline produces for Maghrib + Shower.
//
// Usage: node tests/debug-maghrib-shower.js

const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const repoRoot = path.resolve(__dirname, '..');
const backupPath = path.join(repoRoot, 'lib', 'sample_tings-backup-2026-07-20.json');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

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

  // Freeze clock to "today 20:36" — matching the user's report.
  // Use the real today (whenever the script runs) so prayer anchors resolve.
  const frozenClock = (() => {
    const d = new Date();
    d.setHours(20, 36, 0, 0);
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

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());

  // Load the sample backup into localStorage using whatever KEY/SORT_SETTINGS_KEY
  // the app expects. We don't know them ahead of time, so inspect the app.
  const keys = await page.evaluate(() => Object.keys(localStorage));
  console.log('initial localStorage keys:', keys);

  // Find the keys by poking at the app's exposed globals.
  const appKeys = await page.evaluate(() => ({
    dataKey: typeof KEY !== 'undefined' ? KEY : null,
    settingsKey: typeof SORT_SETTINGS_KEY !== 'undefined' ? SORT_SETTINGS_KEY : null,
  }));
  console.log('app keys:', appKeys);

  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
  await page.evaluate(({ dataKey, settingsKey, backup }) => {
    localStorage.setItem(dataKey, JSON.stringify(backup.habits));
    localStorage.setItem(settingsKey, JSON.stringify(backup.settings));
  }, { ...appKeys, backup });

  await page.reload({ waitUntil: 'networkidle' });

  // Sanity: prayer times for Home today.
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

  // Drill into Maghrib + Shower specifically.
  const debug = await page.evaluate(() => {
    const data = load();
    const settings = loadSortSettings();
    const find = name => data.findIndex(h => h && h.name === name);
    const maghribIdx = find('Maghrib');
    const showerIdx = find('Shower');
    const out = {};

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
        lastLogDate: new Date(h.lastLog).toString(),
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

    // Effective availability for today.
    const todayKey = (typeof todayIso === 'function') ? todayIso() : null;
    out.todayKey = todayKey;
    out.availabilityMinutesToday = (typeof effectiveAvailabilityMinutes === 'function')
      ? effectiveAvailabilityMinutes(todayKey, settings) : null;

    // Run the actual agenda.
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

    // Try week agenda too in case the user is viewing the week mode.
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

  console.log('\nConsole errors/warnings:');
  errors.forEach(e => console.log(' ', e));

  await browser.close();
})();
