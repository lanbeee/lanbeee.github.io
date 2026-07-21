// Horizontal scroll on tag rows must NOT toggle chips (accidental tap guard).
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/tag-chip-scroll-test.js
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

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const client = await page.context().newCDPSession(page);
  const errors = [];
  page.on('pageerror', err => errors.push(String(err)));

  await page.addInitScript(() => {
    const topics = [
      'work','health','learning','finance','social','home','coding',
      'reading','writing','design','music','fitness','cooking','travel'
    ];
    const locations = [
      { id:'loc-1', name:'Home', lat:40.7359, lng:-74.0036, radiusM:100, allowedTimeStart:0, allowedTimeEnd:1440 },
      { id:'loc-2', name:'Office', lat:40.7549, lng:-73.9840, radiusM:80, allowedTimeStart:360, allowedTimeEnd:720 },
      { id:'loc-3', name:'Gym', lat:40.7465, lng:-73.9972, radiusM:75, allowedTimeStart:360, allowedTimeEnd:1320 },
      { id:'loc-4', name:'Library', lat:40.7532, lng:-73.9822, radiusM:60, allowedTimeStart:480, allowedTimeEnd:1200 },
      { id:'loc-5', name:'Cafe', lat:40.7265, lng:-73.9815, radiusM:60, allowedTimeStart:480, allowedTimeEnd:1020 },
      { id:'loc-6', name:'Park', lat:40.7308, lng:-73.9973, radiusM:120, allowedTimeStart:360, allowedTimeEnd:1080 },
      { id:'loc-7', name:'Supermarket', lat:40.7350, lng:-73.9900, radiusM:80, allowedTimeStart:480, allowedTimeEnd:1260 },
      { id:'loc-8', name:'CoWorking', lat:40.7400, lng:-73.9890, radiusM:70, allowedTimeStart:0, allowedTimeEnd:1440 },
      { id:'loc-9', name:'Clinic', lat:40.7580, lng:-73.9855, radiusM:60, allowedTimeStart:480, allowedTimeEnd:720 },
      { id:'loc-10', name:'Restaurant', lat:40.7280, lng:-73.9940, radiusM:50, allowedTimeStart:480, allowedTimeEnd:1320 },
    ];
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', topics, locations, travel:{}, defaultTravelMode:'walking',
      showLocationOnCards:false, availabilityMinutes:[180,180,180,180,180,120,120]
    }));
    localStorage.setItem('tings_v2', JSON.stringify([{
      name:'Scroll Test Habit', type:'keepup', target:null, dueDate:null, hardDue:false,
      eventTime:null, logs:[], emoji:'🧪', pinned:false, sample:false, snoozedUntil:null,
      topics:['work','health'], durationMinutes:30, flexibilityDays:0, createdAt:Date.now(),
      locationIds:['loc-1','loc-3'], preferredLocationId:'loc-1', locationPrefs:{}
    }]));
  });

  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);

  // ── Open detail sheet and scroll to identity pane (index 4) ──
  const habitCard = page.locator('#list .ting-card', { hasText:'Scroll Test Habit' }).first();
  await habitCard.click();
  await page.waitForSelector('#detail-sheet.open');
  await page.waitForTimeout(200);
  await page.evaluate(() => {
    const pager = document.querySelector('#detail-sheet .detail-pager');
    if(pager) pager.scrollTo({ left:pager.clientWidth * 4, behavior:'instant' });
  });
  await page.waitForTimeout(300);

  const tagChips = page.locator('#detail-tag-chips');
  assert(await tagChips.isVisible(), 'detail tag chips visible');

  const topicChips = page.locator('#detail-tag-chips .topic-chip[data-topic]');
  const topicCount = await topicChips.count();
  console.log(`  topic chips: ${topicCount}`);
  assert(topicCount >= 10, 'enough topic chips to scroll (got ' + topicCount + ')');

  const locCount = await page.locator('#detail-tag-chips .location-chip[data-location-id]').count();
  console.log(`  location chips: ${locCount}`);
  assert(locCount >= 8, 'enough location chips to scroll (got ' + locCount + ')');

  // ── 1. Normal tap toggles a chip (baseline) ──
  console.log('\n--- 1. Normal tap toggles chip ---');
  const firstTopic = topicChips.first();
  const wasOn = await firstTopic.evaluate(el => el.classList.contains('on'));
  await firstTopic.click();
  await page.waitForTimeout(100);
  const nowOn = await firstTopic.evaluate(el => el.classList.contains('on'));
  assert(nowOn !== wasOn, 'tap toggles chip');
  // Restore state
  await firstTopic.click();
  await page.waitForTimeout(100);
  const restored = await firstTopic.evaluate(el => el.classList.contains('on'));
  assert(restored === wasOn, 'chip restored to original state');

  // ── 2. Horizontal scroll on topic row does NOT toggle chips ──
  console.log('\n--- 2. Horizontal scroll on topic row ---');
  const topicRow = page.locator('#detail-tag-chips .tag-row-topics');
  const topicBox = await topicRow.boundingBox();
  assert(topicBox !== null, 'topic row has bounding box');

  const initTopicState = await page.evaluate(() =>
    [...document.querySelectorAll('#detail-tag-chips .topic-chip[data-topic]')]
      .map(el => el.classList.contains('on'))
  );

  const tDims = await topicRow.evaluate(el => ({ sw:el.scrollWidth, cw:el.clientWidth }));
  console.log(`  topic row: scrollWidth=${tDims.sw} clientWidth=${tDims.cw}`);
  assert(tDims.sw > tDims.cw, 'topic row overflows (scrollable)');

  const scrollBefore = await topicRow.evaluate(el => el.scrollLeft);
  await cdpSwipe(client, topicBox.x + topicBox.width - 5, topicBox.y + topicBox.height / 2, topicBox.x + 5, topicBox.y + topicBox.height / 2, 10);
  await page.waitForTimeout(400);
  const scrollAfter = await topicRow.evaluate(el => el.scrollLeft);
  console.log(`  topic row scroll: ${scrollBefore} → ${scrollAfter}`);
  assert(scrollAfter !== scrollBefore, 'topic row actually scrolled');

  const afterTopicState = await page.evaluate(() =>
    [...document.querySelectorAll('#detail-tag-chips .topic-chip[data-topic]')]
      .map(el => el.classList.contains('on'))
  );
  assert(
    JSON.stringify(initTopicState) === JSON.stringify(afterTopicState),
    'topic chips unchanged after horizontal scroll'
  );

  // ── 3. Horizontal scroll on location row does NOT toggle chips ──
  console.log('\n--- 3. Horizontal scroll on location row ---');
  const locRow = page.locator('#detail-tag-chips .tag-row-places');
  const locBox = await locRow.boundingBox();
  assert(locBox !== null, 'location row has bounding box');

  const initLocState = await page.evaluate(() =>
    [...document.querySelectorAll('#detail-tag-chips .location-chip[data-location-id]')]
      .map(el => el.classList.contains('on'))
  );

  const lDims = await locRow.evaluate(el => ({ sw:el.scrollWidth, cw:el.clientWidth }));
  console.log(`  location row: scrollWidth=${lDims.sw} clientWidth=${lDims.cw}`);
  assert(lDims.sw > lDims.cw, 'location row overflows (scrollable)');

  const locScrollBefore = await locRow.evaluate(el => el.scrollLeft);
  await cdpSwipe(client, locBox.x + locBox.width - 5, locBox.y + locBox.height / 2, locBox.x + 5, locBox.y + locBox.height / 2, 10);
  await page.waitForTimeout(400);
  const locScrollAfter = await locRow.evaluate(el => el.scrollLeft);
  console.log(`  location row scroll: ${locScrollBefore} → ${locScrollAfter}`);
  assert(locScrollAfter !== locScrollBefore, 'location row actually scrolled');

  const afterLocState = await page.evaluate(() =>
    [...document.querySelectorAll('#detail-tag-chips .location-chip[data-location-id]')]
      .map(el => el.classList.contains('on'))
  );
  assert(
    JSON.stringify(initLocState) === JSON.stringify(afterLocState),
    'location chips unchanged after horizontal scroll'
  );

  // ── 4. Normal tap still works after scroll (regression) ──
  console.log('\n--- 4. Tap still works after scroll ---');
  const afterScrollWasOn = await firstTopic.evaluate(el => el.classList.contains('on'));
  await firstTopic.click();
  await page.waitForTimeout(100);
  const afterScrollNowOn = await firstTopic.evaluate(el => el.classList.contains('on'));
  assert(afterScrollNowOn !== afterScrollWasOn, 'tap works after scroll');
  if(afterScrollNowOn) await firstTopic.click();
  await page.waitForTimeout(100);

  if(fail > 0 || errors.length > 0){
    throw new Error(`${fail} assertion${fail === 1 ? '' : 's'} failed` +
      (errors.length ? `, ${errors.length} page error${errors.length === 1 ? '' : 's'}` : ''));
  }
  await browser.close();
  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  ALL TAG CHIP SCROLL TESTS PASSED   ║`);
  console.log(`╚══════════════════════════════════════╝`);
})().catch(async err => {
  console.error('TEST FAILED:', err.message);
  process.exit(1);
});
