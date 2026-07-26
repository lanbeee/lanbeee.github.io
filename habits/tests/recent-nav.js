const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if(msg.type()==='error') errors.push('console: '+msg.text()); });

  // Seed a habit with a log 20 days ago (should appear in the PREVIOUS 14-day block, not the default one)
  const now = new Date();
  const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const twentyDaysAgo = dayStart(now) - 20 * 86400000;
  const yesterday = dayStart(now) - 86400000;
  await page.addInitScript(({ twentyDaysAgo, yesterday }) => {
    const existing = JSON.parse(localStorage.getItem('tings_v2') || '[]');
    existing.push({
      name:'NavTest', type:'keepup', target:7,
      logs:[twentyDaysAgo, yesterday], emoji:'', pinned:false, sample:false,
      snoozedUntil:null, topics:[], allowedWeekdays:[], allowedMonthDays:[],
      flexibilityDays:0, durationMinutes:30, createdAt:Date.now()-30*86400000,
      lastLog:yesterday
    });
    localStorage.setItem('tings_v2', JSON.stringify(existing));
  }, { twentyDaysAgo, yesterday });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.locator('#open-overview').click();
  await page.waitForTimeout(300);

  // Default: recent mode, label "around today", nav visible
  const label0 = await page.locator('#overview-calendar-label').textContent();
  const navVisible = await page.locator('#overview-prev-month').isVisible();
  console.log('initial label:', JSON.stringify(label0), '| nav visible:', navVisible);
  if(label0 !== 'around today') throw new Error('default recent label wrong');
  if(!navVisible) throw new Error('nav buttons should be visible in recent mode');

  // Window geometry: past 7 + today + next 6
  const geom = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('#overview-calendar .cal-day.pickable')];
    const todayIdx = cells.findIndex(c => c.classList.contains('today'));
    const future = cells.filter(c => c.classList.contains('future')).length;
    return {
      count: cells.length,
      todayIdx,
      future,
      first: cells[0]?.dataset.logDay || null,
      last: cells[cells.length - 1]?.dataset.logDay || null,
      past: typeof OVERVIEW_RECENT_PAST === 'number' ? OVERVIEW_RECENT_PAST : null,
      ahead: typeof OVERVIEW_RECENT_AHEAD === 'number' ? OVERVIEW_RECENT_AHEAD : null,
      noCopy: !document.getElementById('overview-copy'),
      noStats: !document.querySelector('#overview-sheet #overview-stats'),
      hasFilter: !!document.querySelector('#overview-filter [data-overview-range="recent"]'),
    };
  });
  console.log('geometry:', geom);
  if(geom.count !== 14) throw new Error(`expected 14 strip cells, got ${geom.count}`);
  if(geom.todayIdx !== 7) throw new Error(`today should be at index 7, got ${geom.todayIdx}`);
  if(geom.future !== 6) throw new Error(`expected 6 future cells, got ${geom.future}`);
  if(geom.past !== 7 || geom.ahead !== 6) throw new Error('OVERVIEW_RECENT_PAST/AHEAD constants wrong');
  if(!geom.noCopy || !geom.noStats) throw new Error('overview copy/stats chrome should be gone');
  if(!geom.hasFilter) throw new Error('unified overview filter missing');

  // yesterday should have an entry in the default window
  const dotsDefault = await page.locator('#overview-calendar .cal-day.has-entry').count();
  console.log('default window has-entry cells:', dotsDefault);
  if(dotsDefault < 1) throw new Error('default window should contain yesterday log');

  // Go to PREVIOUS 14-day block
  await page.locator('#overview-prev-month').click();
  await page.waitForTimeout(200);
  const label1 = await page.locator('#overview-calendar-label').textContent();
  console.log('prev label:', JSON.stringify(label1));
  if(label1 === 'around today' || !label1.includes('–')) throw new Error('prev should show date range');

  // 20-days-ago log should now be visible (it's in the previous block: T-27..T-14)
  const dotsPrev = await page.locator('#overview-calendar .cal-day.has-entry').count();
  console.log('prev window has-entry cells:', dotsPrev);
  if(dotsPrev < 1) throw new Error('prev window should contain the 20-days-ago log');

  // Go NEXT twice -> future block (T+1..T+14), then back to default
  await page.locator('#overview-next-month').click();
  await page.waitForTimeout(150);
  await page.locator('#overview-next-month').click();
  await page.waitForTimeout(150);
  const labelFuture = await page.locator('#overview-calendar-label').textContent();
  console.log('future label:', JSON.stringify(labelFuture));
  const dotsFuture = await page.locator('#overview-calendar .cal-day.has-entry').count();
  console.log('future window has-entry cells:', dotsFuture);
  if(dotsFuture !== 0) throw new Error('future block should have no entries');

  // From the future block (offset +14), a single prev returns to default
  await page.locator('#overview-prev-month').click();
  await page.waitForTimeout(150);
  const labelBack = await page.locator('#overview-calendar-label').textContent();
  console.log('back label:', JSON.stringify(labelBack));
  if(labelBack !== 'around today') throw new Error('should be back to default');

  // Switching range resets offset
  await page.locator('#overview-prev-month').click();
  await page.waitForTimeout(100);
  await page.locator('[data-overview-range="month"]').click();
  await page.waitForTimeout(150);
  await page.locator('[data-overview-range="recent"]').click();
  await page.waitForTimeout(150);
  const labelReset = await page.locator('#overview-calendar-label').textContent();
  console.log('after range toggle label:', JSON.stringify(labelReset));
  if(labelReset !== 'around today') throw new Error('switching range should reset recent offset');

  if(errors.length){ console.log('JS ERRORS:', errors.join('\n')); throw new Error('js errors during run'); }
  console.log('RECENT NAV TEST PASSED');
  await browser.close();
})().catch(e=>{console.error(e);process.exit(1);});
