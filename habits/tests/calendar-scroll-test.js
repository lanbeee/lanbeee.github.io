// Scroll on calendar overview must NOT trigger accidental taps.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/calendar-scroll-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

async function cdpSwipe(c, x1, y1, x2, y2, steps = 10){
  await c.send('Input.dispatchTouchEvent', {
    type:'touchStart',
    touchPoints:[{ x:x1, y:y1, radiusX:10, radiusY:10, force:0.5, id:0 }],
    modifiers:0, timestamp:Date.now()
  });
  await new Promise(r => setTimeout(r, 20));
  for(let i = 1; i <= steps; i++){
    const t = i / steps;
    await c.send('Input.dispatchTouchEvent', {
      type:'touchMove',
      touchPoints:[{ x:x1 + (x2 - x1) * t, y:y1 + (y2 - y1) * t, radiusX:10, radiusY:10, force:0.5, id:0 }],
      modifiers:0, timestamp:Date.now()
    });
    await new Promise(r => setTimeout(r, 20));
  }
  await c.send('Input.dispatchTouchEvent', {
    type:'touchEnd',
    touchPoints:[{ x:x2, y:y2, id:0 }],
    modifiers:0, timestamp:Date.now()
  });
}

function seedScript(){
  return `(function(){
    const now = Date.now();
    const day = (n) => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
    };
    const topics = ['work','health','learning','finance','social','home','coding','reading'];
    const locations = [
      { id:'loc-1', name:'Home', lat:40.7, lng:-74.0, radiusM:100 },
      { id:'loc-2', name:'Office', lat:40.75, lng:-73.98, radiusM:80 },
      { id:'loc-3', name:'Gym', lat:40.74, lng:-73.99, radiusM:75 },
      { id:'loc-4', name:'Library', lat:40.75, lng:-73.98, radiusM:60 },
    ];
    const settings = {
      preset:'todayFirst', topics, locations, travel:{}, defaultTravelMode:'walking',
      availabilityMinutes:[600,600,600,600,600,600,600], blockedTimes:[],
      showLocationOnCards:false
    };
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    const habits = [];
    for(let i = 0; i < 8; i++){
      habits.push({
        name:'Habit ' + i, type:'keepup', target:7,
        logs:[day(-i), day(1)],
        emoji:'🧪', pinned:false, sample:false, snoozedUntil:null,
        topics:[topics[i % topics.length]], locationIds:['loc-' + ((i % 4) + 1)],
        durationMinutes:30, priority:2,
        createdAt:now - 10*86400000, lastLog:day(-i)
      });
    }
    localStorage.setItem('tings_v2', JSON.stringify(habits));
  })();`;
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const client = await page.context().newCDPSession(page);
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));

  await page.addInitScript(seedScript());
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(400);

  // ── Open the calendar overview ──
  await page.click('#open-overview');
  await page.waitForSelector('#overview-sheet.open');
  await page.waitForTimeout(300);

  // ── 1. Horizontal scroll on filter row does NOT change filter ──
  console.log('\n--- 1. Horizontal scroll on filter row ---');
  const filterRow = page.locator('#overview-filter');
  assert(await filterRow.isVisible(), 'filter row visible');

  const activeFilterBefore = await page.evaluate(() =>
    document.querySelector('#overview-filter .topic-filter.on')?.textContent.trim()
  );
  console.log('  active filter before: ' + activeFilterBefore);

  const filterBox = await filterRow.boundingBox();
  assert(filterBox !== null, 'filter row has bounding box');

  const filterDims = await filterRow.evaluate(el => ({ sw:el.scrollWidth, cw:el.clientWidth }));
  console.log(`  filter row: scrollWidth=${filterDims.sw} clientWidth=${filterDims.cw}`);

  if(filterDims.sw > filterDims.cw){
    const scrollBefore = await filterRow.evaluate(el => el.scrollLeft);
    await cdpSwipe(client, filterBox.x + filterBox.width - 10, filterBox.y + filterBox.height / 2, filterBox.x + 10, filterBox.y + filterBox.height / 2, 10);
    await page.waitForTimeout(400);
    const scrollAfter = await filterRow.evaluate(el => el.scrollLeft);
    console.log(`  filter row scroll: ${scrollBefore} → ${scrollAfter}`);
    assert(scrollAfter !== scrollBefore, 'filter row actually scrolled');

    const activeFilterAfter = await page.evaluate(() =>
      document.querySelector('#overview-filter .topic-filter.on')?.textContent.trim()
    );
    assert(activeFilterAfter === activeFilterBefore, 'active filter unchanged after horizontal scroll');
  } else {
    console.log('  (filter row not scrollable — skipping scroll assertion)');
    assert(true, 'filter row not scrollable — skip');
  }

  // ── 2. Vertical scroll on overview sheet does NOT open day sheet ──
  console.log('\n--- 2. Vertical scroll on overview sheet ---');
  const dayLogsBefore = await page.evaluate(() =>
    document.querySelector('#day-logs-sheet')?.classList.contains('open') || false
  );
  assert(!dayLogsBefore, 'day-logs sheet not open before scroll');

  const sheetBox = await page.locator('.overview-sheet').boundingBox();
  assert(sheetBox !== null, 'overview sheet has bounding box');

  // Swipe up (scroll down) starting from the middle of the sheet
  const startX = sheetBox.x + sheetBox.width / 2;
  const startY = sheetBox.y + sheetBox.height * 0.6;
  const endY = sheetBox.y + sheetBox.height * 0.2;
  await cdpSwipe(client, startX, startY, startX, endY, 10);
  await page.waitForTimeout(400);

  const dayLogsAfter = await page.evaluate(() =>
    document.querySelector('#day-logs-sheet')?.classList.contains('open') || false
  );
  assert(!dayLogsAfter, 'day-logs sheet NOT opened by vertical scroll');

  // ── 3. Vertical scroll does NOT change pane filter ──
  console.log('\n--- 3. Vertical scroll does not change pane ---');
  const paneBefore = await page.evaluate(() =>
    document.querySelector('#overview-pane-filter .topic-filter.on')?.dataset.overviewPane
  );
  // Scroll back up
  await cdpSwipe(client, startX, endY, startX, startY, 10);
  await page.waitForTimeout(400);
  const paneAfter = await page.evaluate(() =>
    document.querySelector('#overview-pane-filter .topic-filter.on')?.dataset.overviewPane
  );
  assert(paneAfter === paneBefore, 'pane filter unchanged after vertical scroll');

  // ── 4. Normal tap on filter pill still works ──
  console.log('\n--- 4. Normal tap on filter pill ---');
  await page.waitForTimeout(600); // let scroll guard expire
  const monthPill = page.locator('#overview-filter [data-overview-range="month"]');
  if(await monthPill.isVisible()){
    await monthPill.click();
    await page.waitForTimeout(200);
    const activeAfterTap = await page.evaluate(() =>
      document.querySelector('#overview-filter .topic-filter.on')?.dataset.overviewRange
    );
    assert(activeAfterTap === 'month', 'tap on month pill activates it');
    // Restore
    const recentPill = page.locator('#overview-filter [data-overview-range="recent"]');
    await recentPill.click();
    await page.waitForTimeout(200);
  } else {
    assert(true, 'month pill not visible — skip');
  }

  // ── 5. Normal tap on calendar day still opens day sheet ──
  console.log('\n--- 5. Normal tap on calendar day ---');
  await page.waitForTimeout(600);
  const todayCell = page.locator('#overview-calendar .cal-day.pickable.today');
  if(await todayCell.isVisible()){
    await todayCell.click();
    await page.waitForTimeout(400);
    const dayLogsOpened = await page.evaluate(() =>
      document.querySelector('#day-logs-sheet')?.classList.contains('open') || false
    );
    assert(dayLogsOpened, 'tap on today cell opens day-logs sheet');
    if(dayLogsOpened){
      await page.click('#day-logs-overview');
      await page.waitForTimeout(200);
    }
  } else {
    const anyCell = page.locator('#overview-calendar .cal-day.pickable').first();
    if(await anyCell.isVisible()){
      await anyCell.click();
      await page.waitForTimeout(400);
      const dayLogsOpened = await page.evaluate(() =>
        document.querySelector('#day-logs-sheet')?.classList.contains('open') || false
      );
      assert(dayLogsOpened, 'tap on calendar cell opens day-logs sheet');
      if(dayLogsOpened){
        await page.click('#day-logs-overview');
        await page.waitForTimeout(200);
      }
    } else {
      assert(true, 'no pickable calendar cell — skip');
    }
  }

  // ── 6. Scroll on day-logs sheet does NOT trigger item navigation ──
  console.log('\n--- 6. Scroll on day-logs sheet ---');
  await page.waitForTimeout(600);
  const cell2 = page.locator('#overview-calendar .cal-day.pickable').first();
  if(await cell2.isVisible()){
    await cell2.click();
    await page.waitForTimeout(400);
    const dlOpen = await page.evaluate(() =>
      document.querySelector('#day-logs-sheet')?.classList.contains('open') || false
    );
    if(dlOpen){
      const stepBefore = await page.evaluate(() => window.dayLogsStep);
      const dlSheetBox = await page.locator('.day-logs-sheet').boundingBox();
      if(dlSheetBox){
        const dlX = dlSheetBox.x + dlSheetBox.width / 2;
        const dlStartY = dlSheetBox.y + dlSheetBox.height * 0.6;
        const dlEndY = dlSheetBox.y + dlSheetBox.height * 0.2;
        await cdpSwipe(client, dlX, dlStartY, dlX, dlEndY, 10);
        await page.waitForTimeout(400);
        const stepAfter = await page.evaluate(() => window.dayLogsStep);
        assert(stepAfter === stepBefore, 'day-logs step unchanged after scroll');
      } else {
        assert(true, 'day-logs sheet no bounding box — skip');
      }
      await page.click('#day-logs-overview');
      await page.waitForTimeout(200);
    } else {
      assert(true, 'day-logs did not open — skip');
    }
  } else {
    assert(true, 'no calendar cell — skip');
  }

  if(fail > 0 || errors.length > 0){
    throw new Error(`${fail} assertion${fail === 1 ? '' : 's'} failed` +
      (errors.length ? `, ${errors.length} page error${errors.length === 1 ? '' : 's'}: ${errors[0]}` : ''));
  }
  await browser.close();
  console.log(`\n╔══════════════════════════════════════════╗`);
  console.log(`║  ALL CALENDAR SCROLL TESTS PASSED       ║`);
  console.log(`╚══════════════════════════════════════════╝`);
})().catch(async err => {
  console.error('TEST FAILED:', err.message);
  process.exit(1);
});
