// Debug: habits-layout-smoke against a realistic sample dataset (with
// prayer-anchor habits, locations, blocked times, etc.) — what used to load
// lib/sample_tings-backup-YYYY-MM-DD.json is now generated inline via the
// app's own buildSortSamples() + buildSampleLocations(), so the test does
// not depend on a checked-in backup that goes stale every day.
//
// Captures every console message during a layout-smoke pass.
//
//   HABITS_URL=http://127.0.0.1:4173/ node tests/debug-smoke-with-data.js
//
const { chromium } = require('playwright');

const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

let pass = 0, fail = 0;
function assert(cond,msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{width:390,height:844}, isMobile:true });
  const msgs = [];
  const errors = [];
  page.on('console', m => {
    msgs.push(`[${m.type()}] ${m.text()}`);
    if(m.type() === 'error')errors.push(m.text());
  });
  page.on('pageerror', e => {
    msgs.push(`[pageerror] ${e.message}`);
    errors.push(e.message);
  });
  page.on('requestfailed', r => msgs.push(`[reqfail] ${r.url()} ${r.failure() && r.failure().errorText}`));

  await page.goto(baseUrl, { waitUntil:'networkidle' });

  // Seed a realistic dataset using the app's own sample builders. Mirrors
  // what the "add sample habits" settings button does, so the smoke test
  // exercises the same shape real users get when they tap that button.
  const seeded = await page.evaluate(() => {
    if(typeof buildSortSamples !== 'function' || typeof buildSampleLocations !== 'function'){
      return { ok:false, reason:'sample builders not exposed' };
    }
    const samples = buildSortSamples().map(h => ({...h, sample:false}));
    const sampleLocs = buildSampleLocations();
    const settings = {
      preset:'todayFirst',
      topics:[],
      locations:sampleLocs,
      travel:{},
      defaultTravelMode:'driving',
      blockedTimes:[
        { label:'sleep', days:[], start:0, end:420, locationId:'sample-home' },          // midnight–7am
        { label:'breakfast', days:[], start:480, end:540, locationId:'sample-home' },    // 8am–9am
        { label:'work morning', days:[1,2,3,4,5], start:540, end:720 },                  // 9am–12pm
        { label:'lunch', days:[], start:720, end:780, locationId:'sample-office' },      // 12pm–1pm
        { label:'work evening', days:[1,2,3,4,5], start:840, end:1020 },                 // 2pm–5pm
        { label:'dinner', days:[], start:1140, end:1200, locationId:'sample-home' }      // 7pm–8pm
      ],
      showScheduledTasksInAgenda:true,
      showDueTasksInAgenda:true,
      showPlannedItemsInAgenda:true,
      showDueHabitsInAgenda:true,
      lastKnownLocationId:'sample-home'
    };
    localStorage.setItem('tings_v2', JSON.stringify(samples));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    return { ok:true, habits:samples.length, locations:sampleLocs.length };
  });
  console.log('seeded:', seeded);
  assert(seeded.ok, 'sample dataset seeded via buildSortSamples() (' + (seeded.habits || 0) + ' habits, ' + (seeded.locations || 0) + ' locations)');

  await page.reload({ waitUntil:'networkidle' });

  // Mirror the layout-smoke steps.
  await page.locator('#open-add').waitFor({ state:'visible' });
  await page.locator('#open-add').click();
  await page.waitForSelector('#add-sheet.open');
  await page.locator('#type-seg [data-v="task"]').click();
  await page.locator('#task-due-row').waitFor({ state:'visible' });
  await page.locator('#ting-due-time').waitFor({ state:'visible' });
  await page.waitForTimeout(450);

  // While we're here: exercise the agenda pipeline against the sample data.
  // If anything throws on real-shaped data (locations, prayer anchors, etc.)
  // we surface it as an assertion failure rather than silent console noise.
  const agendaOk = await page.evaluate(() => {
    try{
      const data = load();
      const settings = loadSortSettings();
      const agenda = buildTodayAgenda(data, settings);
      const rows = buildTodayTimeline(agenda);
      const wk = buildWeekAgenda(data, settings, 7);
      return {
        ok:true,
        habits:data.length,
        agendaItems:agenda.agendaItems.length,
        timelineRows:rows.length,
        weekDays:(wk.days || []).length
      };
    }catch(e){
      return { ok:false, error:e.message };
    }
  });
  console.log('agenda pipeline:', agendaOk);
  assert(agendaOk.ok, 'agenda pipeline runs against sample dataset without throwing');
  if(agendaOk.ok){
    assert(agendaOk.habits > 0, 'sample dataset has habits loaded (' + agendaOk.habits + ')');
    assert(agendaOk.weekDays === 7, 'week agenda produced 7 days (' + agendaOk.weekDays + ')');
  }

  console.log('\nCONSOLE MESSAGES (' + msgs.length + '):');
  for (const m of msgs.slice(-25)) console.log(' ', m);

  assert(errors.length === 0, 'no console errors / pageerrors (' + errors.length + ')');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
