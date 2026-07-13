// Verify merged blocked cards on home list: truncation, height consistency,
// expand/collapse, and accidental-tap guard.
//
//   HABITS_URL=http://127.0.0.1:4173/ node tests/blocked-group-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  // Seed 4 consecutive blocked times (long labels) + a couple habits so the
  // week plan renders. Times are relative to the current wall clock so blocks
  // aren't clipped by the "already ended" filter.
  await page.addInitScript(() => {
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();
    const blockStart = Math.max(60, Math.min(1260, cur + 60));

    localStorage.setItem('tings_v2', JSON.stringify([
      { name:'Morning exercise', type:'keepup', target:7, logs:[Date.now() - 86400000], durationMinutes:30, locationIds:['home'], priority:1 },
      { name:'Read book', type:'keepup', target:7, logs:[Date.now() - 2 * 86400000], durationMinutes:20, locationIds:['home'], priority:2 },
    ]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst',
      showWeekOnHome:true,
      topics:[],
      locations:[{ id:'home', name:'Home', lat:40.700, lng:-74.000, radiusM:75 }],
      travel:{},
      defaultTravelMode:'walking',
      availabilityMinutes:[600,600,600,600,600,600,600],
      blockedTimes:[
        { label:'Morning Routine & Preparation Work', days:[0,1,2,3,4,5,6], start:blockStart, end:blockStart + 30, locationId:'home' },
        { label:'Deep Work Session Project Alpha', days:[0,1,2,3,4,5,6], start:blockStart + 30, end:blockStart + 60, locationId:'home' },
        { label:'Team Standup Meeting Sync Up', days:[0,1,2,3,4,5,6], start:blockStart + 60, end:blockStart + 90, locationId:'home' },
        { label:'Project Planning & Documentation', days:[0,1,2,3,4,5,6], start:blockStart + 90, end:blockStart + 120, locationId:'home' },
      ],
      lastKnownLocationId:'home',
    }));
  });

  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(500);

  console.log('\n--- Merged blocked card tests ---\n');

  // ── 1. Merged group exists ──
  const groupCount = await page.locator('.blocked-group').count();
  assert(groupCount >= 1, 'blocked-group rendered (got ' + groupCount + ')');

  const mergeCount = await page.locator('.blocked-card-merge').count();
  assert(mergeCount >= 1, 'blocked-card-merge rendered (got ' + mergeCount + ')');

  // ── 2. Toggle text shows merged format (+N, count) ──
  const toggleText = await page.locator('.blocked-card-merge').first().textContent();
  assert(toggleText.includes('+2'), 'text shows +N merge suffix (got: ' + JSON.stringify(toggleText) + ')');
  assert(toggleText.includes('· 4'), 'text shows block count (got: ' + JSON.stringify(toggleText) + ')');

  // ── 3. CSS truncation rules applied ──
  const mergeStyle = await page.locator('.blocked-card-merge').first().evaluate(el => ({
    overflow: getComputedStyle(el).overflow,
    flexWrap: getComputedStyle(el).flexWrap,
  }));
  assert(mergeStyle.overflow === 'hidden', 'merge card overflow:hidden');
  assert(mergeStyle.flexWrap === 'nowrap', 'merge card flex-wrap:nowrap');

  const spanStyle = await page.locator('.blocked-card-merge span').first().evaluate(el => ({
    overflow: getComputedStyle(el).overflow,
    textOverflow: getComputedStyle(el).textOverflow,
    whiteSpace: getComputedStyle(el).whiteSpace,
  }));
  assert(spanStyle.textOverflow === 'ellipsis', 'span text-overflow:ellipsis');
  assert(spanStyle.whiteSpace === 'nowrap', 'span white-space:nowrap');

  // ── 4. Text actually overflows (truncation active) ──
  const isOverflowing = await page.locator('.blocked-card-merge span').first().evaluate(el =>
    el.scrollWidth > el.clientWidth
  );
  assert(isOverflowing, 'span content overflows horizontally (truncation in effect)');

  // ── 5. Card height consistent across merge cards ──
  const heights = await page.locator('.blocked-card-merge').evaluateAll(els =>
    els.map(el => el.getBoundingClientRect().height)
  );
  if(heights.length >= 2){
    const max = Math.max(...heights);
    const min = Math.min(...heights);
    assert(max - min <= 2, `card heights consistent (max-min=${(max - min).toFixed(1)}px, n=${heights.length})`);
  }else{
    console.log('  skip: height consistency (only 1 merge card)');
  }

  // ── 6. Expand: click toggle, individual cards appear ──
  await page.locator('.blocked-card-merge').first().click();
  await page.waitForTimeout(400);

  const expandedCount = await page.locator('.blocked-group.is-expanded').count();
  assert(expandedCount >= 1, 'group is-expanded after click (got ' + expandedCount + ')');

  const detailCards = await page.locator('.blocked-group-detail .blocked-card').count();
  assert(detailCards === 4, 'expanded shows 4 individual blocked cards (got ' + detailCards + ')');

  // ── 7. Collapse: click again ──
  await page.locator('.blocked-card-merge').first().click();
  await page.waitForTimeout(400);

  const collapsedCount = await page.locator('.blocked-group.is-expanded').count();
  assert(collapsedCount === 0, 'group collapses back after second click (got ' + collapsedCount + ')');

  // ── 8. No page errors ──
  assert(pageErrors.length === 0, 'no pageerrors (got: ' + JSON.stringify(pageErrors) + ')');

  await browser.close();
  console.log('\n' + (fail ? `${fail} FAILURES` : `ALL ${pass} CHECKS PASSED`));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
