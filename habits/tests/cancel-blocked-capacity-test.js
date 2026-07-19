// Verify that cancelling a blocked card on the home list frees the SAME number
// of minutes from the day's overall capacity — and that undo restores it.
//
// Covers the four shapes that matter:
//   • plain same-day block        (e.g. 08:00–09:00 → +60 min)
//   • multiple cancellations      (each block adds its own minutes)
//   • overnight wraparound block  (22:00–02:00 → +240 min, the bug that
//     prompted this test — plain `end - start` would compute −1200)
//   • undo                        (restores the day's capacity exactly)
//
// We freeze the page clock at 02:00 LOCAL on the day under test so none of the
// blocks are clipped as "in the past" — that lets us render the real DOM and
// drive the real cancel/undo buttons.
//
//   HABITS_URL=http://127.0.0.1:4173/ node tests/cancel-blocked-capacity-test.js
//
const { chromium } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

// LOCAL-day today key — matches the page's todayIso() / dateKey semantics.
function localTodayKey(){
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2,'0');
  const day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const context = await browser.newContext({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  // Freeze the page clock at 02:00 LOCAL today so morning/evening blocks are
  // all ahead of "now" and survive the past-clip in blockedTimelineRows.
  const freezeMs = (() => {
    const d = new Date();
    return new Date(d.getFullYear(),d.getMonth(),d.getDate(),2,0,0,0).getTime();
  })();
  await context.clock.setFixedTime(freezeMs);
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror',e=>pageErrors.push(String(e)));

  const failures = [];
  function check(name,cond,detail){
    if(cond){ console.log(`  ok  - ${name}`); }
    else { failures.push(`${name}${detail ? ' :: ' + detail : ''}`); console.log(`  FAIL- ${name}${detail ? ' :: ' + detail : ''}`); }
  }

  async function seed(blocks, weekly = [600,600,600,600,600,600,600]){
    // First-time load: navigate to BASE so we have a page to talk to. Later
    // seeds just write storage and reload — no accumulating init scripts.
    if(!page.url() || page.url() === 'about:blank'){
      await page.goto(BASE,{ waitUntil:'load' });
    }
    await page.evaluate(({blocks,weekly})=>{
      localStorage.clear();
      localStorage.setItem('tings_v2', JSON.stringify([
        { name:'Read', type:'keepup', target:7, logs:[Date.now() - 2*86400000], durationMinutes:20 }
      ]));
      localStorage.setItem('tings_app_settings_v2', JSON.stringify({
        preset:'todayFirst',
        showWeekOnHome:true,
        topics:[],
        locations:[{ id:'home', name:'Home', lat:40.700, lng:-74.000, radiusM:75 }],
        availabilityMinutes:weekly,
        availabilityOverrides:{},
        cancelledBlocks:{},
        blockedTimes:blocks,
        homeExtraMode:'cards',
        defaultTravelMode:'walking',
        lastKnownLocationId:'home'
      }));
    },{blocks,weekly});
    await page.reload({ waitUntil:'load' });
    await page.waitForTimeout(400);
  }

  async function readSettings(){
    return page.evaluate(()=>JSON.parse(localStorage.getItem('tings_app_settings_v2') || '{}'));
  }

  async function capacityFor(dayKey){
    const s = await readSettings();
    return page.evaluate(({key,s})=>effectiveAvailabilityMinutes(key,s),{key:dayKey,s});
  }

  async function expandBlockedGroups(){
    // 2+ blocks on a day collapse into a `.blocked-card-merge` toggle whose
    // individual cancel-marks only appear after expanding. `seed()` reloads
    // the page so every group starts collapsed — click each merge once.
    const merges = await page.locator('.blocked-card-merge').all();
    for(const m of merges){
      await m.click();
      await page.waitForTimeout(120);
    }
  }

  async function cancelFirstBlockedCard(){
    await expandBlockedGroups();
    const x = page.locator('.blocked-card .blocked-cancel-mark').first();
    if(!await x.count())throw new Error('no blocked-cancel-mark visible');
    await x.click();
    await page.waitForTimeout(250);
  }

  async function clickUndo(){
    const undo = page.locator('#action-undo');
    if(!await undo.count())throw new Error('no undo button after cancel');
    await undo.click();
    await page.waitForTimeout(250);
  }

  const todayK = localTodayKey();

  // ───────────────────────────────────────────────────────────────────────
  console.log('\n[cancel-blocked] same-day block frees its exact minutes');

  await seed([{ label:'Morning', days:[0,1,2,3,4,5,6], start:480, end:540, locationId:'home' }]);
  const base1 = await capacityFor(todayK);
  await cancelFirstBlockedCard();
  const after1 = await capacityFor(todayK);
  check('1a same-day cancel adds 60 min to capacity',
    after1 - base1 === 60, `base=${base1} after=${after1} Δ=${after1-base1}`);
  const sAfter1 = await readSettings();
  check('1b override written for today === base+60',
    sAfter1.availabilityOverrides[todayK] === base1 + 60,
    JSON.stringify(sAfter1.availabilityOverrides));
  check('1c cancelledBlocks records the signature',
    Array.isArray(sAfter1.cancelledBlocks[todayK]) && sAfter1.cancelledBlocks[todayK].includes('Morning|480|540'),
    JSON.stringify(sAfter1.cancelledBlocks));

  await clickUndo();
  const restored1 = await capacityFor(todayK);
  check('1d undo restores baseline capacity',
    restored1 === base1, `restored=${restored1} base=${base1}`);

  // ───────────────────────────────────────────────────────────────────────
  console.log('\n[cancel-blocked] multiple cancellations each add their minutes');

  // Two blocks on TODAY at distinct morning times. After cancelling the first,
  // the next visible blocked-cancel-mark still belongs to today (so we read the
  // same dayKey both times and the deltas stack).
  await seed([
    { label:'A', days:[0,1,2,3,4,5,6], start:480, end:540, locationId:'home' },   // 8:00–9:00 → 60
    { label:'B', days:[0,1,2,3,4,5,6], start:600, end:690, locationId:'home' }    // 10:00–11:30 → 90
  ]);
  const base2 = await capacityFor(todayK);
  await cancelFirstBlockedCard();
  const after2a = await capacityFor(todayK);
  await cancelFirstBlockedCard();
  const after2b = await capacityFor(todayK);
  check('2a first cancel adds 60',
    after2a - base2 === 60, `Δ=${after2a-base2}`);
  check('2b second cancel adds another 90 (total 150)',
    after2b - base2 === 150, `Δ=${after2b-base2}`);

  // ───────────────────────────────────────────────────────────────────────
  // THIS is the regression that motivated the test.
  console.log('\n[cancel-blocked] overnight block frees the FULL wraparound span');

  // Overnight 22:00–02:00. Plain `end - start` = 120-1320 = -1200, which would
  // SUBTRACT capacity. Correct = 240 (the full block freed for the day).
  await seed([{ label:'sleep', days:[0,1,2,3,4,5,6], start:1320, end:120, locationId:'home' }]);
  const base3 = await capacityFor(todayK);
  await cancelFirstBlockedCard();
  const after3 = await capacityFor(todayK);
  check('3a overnight cancel adds 240 min (wraparound), not -1200',
    after3 - base3 === 240, `base=${base3} after=${after3} Δ=${after3-base3}`);
  check('3b override stays positive after overnight cancel',
    after3 > 0 && after3 >= base3, `after=${after3}`);

  await clickUndo();
  const restored3 = await capacityFor(todayK);
  check('3c undo restores overnight baseline',
    restored3 === base3, `restored=${restored3} base=${base3}`);

  // ───────────────────────────────────────────────────────────────────────
  console.log('\n[cancel-blocked] blockDurationMinutes PURE helper');

  const unit = await page.evaluate(()=>({
    plain: typeof blockDurationMinutes === 'function' ? blockDurationMinutes(480,540) : null,
    zero:  typeof blockDurationMinutes === 'function' ? blockDurationMinutes(500,500) : null,
    over:  typeof blockDurationMinutes === 'function' ? blockDurationMinutes(1320,120) : null,
    back:  typeof blockDurationMinutes === 'function' ? blockDurationMinutes(0,1440) : null,
    clamp1:typeof blockDurationMinutes === 'function' ? blockDurationMinutes(-50,2000) : null
  }));
  check('4a blockDurationMinutes(480,540) === 60', unit.plain === 60, JSON.stringify(unit));
  check('4b blockDurationMinutes(500,500) === 0', unit.zero === 0, JSON.stringify(unit));
  check('4c blockDurationMinutes(1320,120) === 240 (overnight wrap)', unit.over === 240, JSON.stringify(unit));
  check('4d blockDurationMinutes(0,1440) === 1440 (full day)', unit.back === 1440, JSON.stringify(unit));
  check('4e blockDurationMinutes clamps OOB to [0,1440]', unit.clamp1 === 1440, JSON.stringify(unit));

  // ───────────────────────────────────────────────────────────────────────
  check('no pageerrors', pageErrors.length === 0, JSON.stringify(pageErrors));

  await browser.close();
  if(failures.length){
    console.log(`\n${failures.length} FAILURES:`);
    failures.forEach(f=>console.log(' • ' + f));
    process.exit(1);
  }
  console.log('\nPASS — cancel-blocked capacity behaviour verified');
  process.exit(0);
})().catch(e=>{ console.error(e); process.exit(1); });
