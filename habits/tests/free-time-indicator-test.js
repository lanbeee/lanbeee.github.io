// free-time-indicator — tests for the "open time" pill on day headers:
//
//   A. Pills render on week day headers with correct format.
//   B. Tap pill opens panel with gap details (time ranges + durations).
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
  // B. Tap pill opens panel with gap details
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[B] Tap pill opens panel');
  const tomorrowPill = page.locator('.free-pill').nth(1);
  await tomorrowPill.click();
  await page.waitForTimeout(300);

  const panelCount = await page.locator('.free-panel').count();
  assert(panelCount === 1, 'panel appears after tap');

  const panelRows = await page.locator('.free-panel-row').count();
  assert(panelRows >= 2, `panel has summary + gap rows (found ${panelRows})`);

  const summaryText = await page.locator('.free-panel-row').first().textContent();
  assert(summaryText.includes('open'), `summary row shows total open: "${summaryText}"`);
  assert(summaryText.includes('largest'), `summary row shows largest: "${summaryText}"`);

  if(panelRows > 1){
    const gapText = await page.locator('.free-panel-row').nth(1).textContent();
    assert(/[ap]m/.test(gapText), `gap row shows time range: "${gapText}"`);
    assert(gapText.includes('–'), `gap row has dash separator: "${gapText}"`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // C. Tap again dismisses panel
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[C] Tap again dismisses');
  await tomorrowPill.click();
  await page.waitForTimeout(300);
  const panelAfterDismiss = await page.locator('.free-panel').count();
  assert(panelAfterDismiss === 0, 'panel dismissed on second tap');

  // ══════════════════════════════════════════════════════════════════════
  // D. Only one panel open at a time
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[D] Only one panel at a time');
  await page.locator('.free-pill').nth(1).click();
  await page.waitForTimeout(200);
  await page.locator('.free-pill').nth(2).click();
  await page.waitForTimeout(200);
  const openPanels = await page.locator('.free-panel').count();
  assert(openPanels === 1, `only one panel open (found ${openPanels})`);
  await page.locator('.free-pill').nth(2).click();
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
    const settings = JSON.parse(localStorage.getItem('tings_app_settings_v2'));
    settings.showWeekOnHome = false;
    settings.blockedTimes = [
      {label:'sleep', start:0, end:420},
      {label:'work', start:540, end:1020},
      {label:'sleep', start:1320, end:1440}
    ];
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    sortSettings = loadSortSettings();
    if(typeof render === 'function') render();
  });
  await page.waitForTimeout(1000);
  const todayPill = await page.locator('.section-header:has-text("today") .free-pill').count();
  assert(todayPill >= 1, `today header in non-week mode has free pill (found ${todayPill})`);

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
