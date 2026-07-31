// free-time-indicator — tests for the "open time" pill on day headers:
//
//   A. Pills render on week day headers with correct format.
//   B. Tap pill opens panel with free/busy strip + gap details.
//   C. Tap again dismisses panel.
//   D. Only one panel open at a time.
//   E. No pill when day has < 10m free.
//   F. Non-week mode today header also gets pill.
//   G. No page errors throughout.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/free-time-indicator-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond,msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  const now = Date.now();
  const seedData = [
    {hid:'h1',name:'Run',emoji:'🏃',type:'habit',target:2,logs:[],createdAt:now-86400000*5},
    {hid:'h2',name:'Read',emoji:'📖',type:'habit',target:3,logs:[],createdAt:now-86400000*5}
  ];
  const seedSettings = {
    preset:'todayFirst', showWeekOnHome:true, agendaOptimizer:false,
    topics:[], locations:[], travel:{}, defaultTravelMode:'driving',
    blockedTimes:[
      {label:'sleep', start:0, end:420},
      {label:'work', start:540, end:1020},
      {label:'sleep', start:1320, end:1440}
    ]
  };

  await page.addInitScript(({data, settings}) => {
    try{
      if(navigator.serviceWorker){
        navigator.serviceWorker.register = () => Promise.resolve({
          unregister:() => Promise.resolve(true),
          update:() => Promise.resolve()
        });
        navigator.serviceWorker.getRegistrations?.().then(rs => rs.forEach(r => r.unregister()));
      }
    }catch{ /* ignore */ }
    localStorage.setItem('tings_v2', JSON.stringify(data));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
  }, {data: seedData, settings: seedSettings});

  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(1500);

  // ══════════════════════════════════════════════════════════════════════
  // A. Pills render on week day headers
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[A] Pills render on week day headers');
  const pillCount = await page.locator('.free-pill').count();
  assert(pillCount >= 2, `free pills render on day headers (found ${pillCount})`);

  const firstPillText = await page.locator('.free-pill').first().textContent();
  assert(/\d+[hm]/.test(firstPillText), `pill text has duration format: "${firstPillText}"`);
  assert(firstPillText.includes('open'), `pill text includes "open": "${firstPillText}"`);

  // ══════════════════════════════════════════════════════════════════════
  // B. Tap pill opens sheet with gap details
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[B] Tap pill opens sheet');
  const tomorrowPill = page.locator('.free-pill').nth(1);
  await tomorrowPill.click();
  await page.waitForTimeout(300);

  const sheetOpen = await page.locator('#free-time-sheet.open').count();
  assert(sheetOpen === 1, 'free-time sheet opens after tap');

  const strip = await page.locator('#free-time-sheet .free-day-strip').count();
  assert(strip === 1, 'day free/busy strip renders');
  const busySegs = await page.locator('#free-time-sheet .free-day-seg.busy').count();
  const freeSegs = await page.locator('#free-time-sheet .free-day-seg.free').count();
  assert(busySegs + freeSegs >= 1, `strip has segments (busy=${busySegs}, free=${freeSegs})`);
  const legendText = await page.locator('#free-time-sheet .free-day-legend').textContent();
  assert(/busy/i.test(legendText) && /open/i.test(legendText), `legend labels busy/open: "${legendText}"`);

  const panelRows = await page.locator('#free-time-sheet .free-panel-row').count();
  assert(panelRows >= 2, `panel has summary + gap rows (found ${panelRows})`);

  const summaryText = await page.locator('#free-time-sheet .free-panel-row').first().textContent();
  assert(summaryText.includes('open'), `summary row shows total open: "${summaryText}"`);
  assert(summaryText.includes('biggest stretch') || summaryText.includes('largest'), `summary row shows biggest stretch: "${summaryText}"`);

  if(panelRows > 1){
    const gapText = await page.locator('#free-time-sheet .free-panel-row').nth(1).textContent();
    assert(/[ap]m/.test(gapText), `gap row shows time range: "${gapText}"`);
    assert(gapText.includes('–'), `gap row has dash separator: "${gapText}"`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // C. Close button dismisses sheet
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[C] Close dismisses sheet');
  await page.locator('#free-time-close').click();
  await page.waitForTimeout(300);
  const sheetAfterDismiss = await page.locator('#free-time-sheet.open').count();
  assert(sheetAfterDismiss === 0, 'sheet dismissed on close');

  // ══════════════════════════════════════════════════════════════════════
  // D. Tapping another pill opens sheet with that day's data
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[D] Another pill opens sheet');
  await page.locator('.free-pill').nth(1).click();
  await page.waitForTimeout(200);
  await page.locator('#free-time-close').click();
  await page.waitForTimeout(200);
  await page.locator('.free-pill').nth(2).click();
  await page.waitForTimeout(200);
  const openSheets = await page.locator('#free-time-sheet.open').count();
  assert(openSheets === 1, `sheet open for second pill (found ${openSheets})`);
  await page.locator('#free-time-close').click();
  await page.waitForTimeout(200);

  // ══════════════════════════════════════════════════════════════════════
  // E. No pill when day is essentially full
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[E] No pill when < 10m free');
  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem('tings_app_settings_v2'));
    settings.blockedTimes = [{label:'full', start:0, end:1435}];
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    sortSettings = loadSortSettings();
    if(typeof render === 'function') render();
  });
  await page.waitForTimeout(1000);
  const pillCountFull = await page.locator('.free-pill').count();
  assert(pillCountFull === 0, `no pills when days have < 10m free (found ${pillCountFull})`);

  // ══════════════════════════════════════════════════════════════════════
  // F. Non-week mode today header gets pill
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[F] Non-week mode today pill');
  await page.evaluate(() => {
    // Freeze this isolated render at 9am. Near midnight the real calendar day
    // has less than the pill's 10-minute threshold left, regardless of blocks.
    const RealDate = Date;
    const fixedNow = dayStart(RealDate.now()) + 9 * 3600000;
    function FrozenDate(...args){
      return args.length ? new RealDate(...args) : new RealDate(fixedNow);
    }
    FrozenDate.now = ()=>fixedNow;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate);
    FrozenDate.prototype = RealDate.prototype;
    globalThis.__freeTimeIndicatorRealDate = RealDate;
    globalThis.Date = FrozenDate;

    // Ensure a "today" section exists so the free pill has a header to attach
    // to instead of rendering only a "coming up" section.
    const data = load();
    // Plan-for-today forces the today section.
    data.push({
      hid:'ft-today-keepup',
      name:'Evening stretch',
      emoji:'🧘',
      type:'keepup',
      target:1,
      durationMinutes:5,
      logs:[{ts:Date.now() + 5 * 60000, plan:true}],
      createdAt:Date.now() - 5 * 86400000
    });
    save(data);
    const settings = JSON.parse(localStorage.getItem('tings_app_settings_v2'));
    settings.showWeekOnHome = false;
    // Leave evening open so remaining-from-now free time stays ≥ 10m.
    settings.blockedTimes = [
      {label:'sleep', start:0, end:420},
      {label:'work', start:540, end:720},
      {label:'work', start:780, end:1020}
    ];
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    sortSettings = loadSortSettings();
    if(typeof render === 'function') render();
  });
  await page.waitForTimeout(1000);
  const todayPill = await page.locator('.section-header:has-text("today") .free-pill').count();
  assert(todayPill >= 1, `today header in non-week mode has free pill (found ${todayPill})`);
  await page.evaluate(() => {
    if(globalThis.__freeTimeIndicatorRealDate){
      globalThis.Date = globalThis.__freeTimeIndicatorRealDate;
      delete globalThis.__freeTimeIndicatorRealDate;
    }
  });

  // ══════════════════════════════════════════════════════════════════════
  // G. No page errors
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[G] No page errors');
  assert(pageErrors.length === 0, `no page errors (found: ${pageErrors.join(', ') || 'none'})`);

  await browser.close();
  console.log(`\n${pass + fail} assertions: ${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error(e.stack || e.message);
  process.exit(1);
});
