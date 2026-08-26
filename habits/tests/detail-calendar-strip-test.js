// Merged detail calendar pane — the old calendar + insight pages are one page:
// a 14-day strip (past 7 · next 6, dots for activity/plans/agenda) above the
// toned-down stats. Day taps must keep the scoped log/plan day-sheet flow.
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', err => errors.push(err.message));
  page.on('console', msg => { if(msg.type()==='error') errors.push('console: '+msg.text()); });

  const now = new Date();
  const dayStartOf = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const today = dayStartOf(now);
  const tenDaysAgo = today - 10 * 86400000;   // outside the default 14-day window
  const threeDaysAgo = today - 3 * 86400000;  // actual log inside the window
  const inTwoDays = today + 2 * 86400000;     // plan log + agenda placement

  await page.addInitScript(({ tenDaysAgo, threeDaysAgo, inTwoDays }) => {
    localStorage.setItem('tings_v2', JSON.stringify([{
      name:'StripTest', type:'keepup', target:7,
      logs:[tenDaysAgo, threeDaysAgo, {ts:inTwoDays, plan:true}],
      emoji:'', pinned:false, sample:false, snoozedUntil:null, topics:[],
      allowedWeekdays:[], allowedMonthDays:[], flexibilityDays:0,
      durationMinutes:30, createdAt:Date.now() - 30 * 86400000, lastLog:threeDaysAgo
    }]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'alpha', showWeekOnHome:false, minimalMode:false,
      availabilityMinutes:[720,720,720,720,720,720,720], blockedTimes:[], locations:[]
    }));
  }, { tenDaysAgo, threeDaysAgo, inTwoDays });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });

  // Store a synthetic week snapshot so the agenda dot is deterministic (the
  // home week path is off — showWeekOnHome:false — so the snapshot is used).
  await page.evaluate((inTwoDays) => {
    storeOverviewWeekSnapshot({ days:[{ dayBase:inTwoDays, timeline:[{ kind:'fill', i:0 }] }] }, load());
    openDetail(0);
  }, inTwoDays);
  await page.waitForSelector('#detail-sheet.open', { timeout:3000 });
  await page.waitForTimeout(150);

  // ── Merged pane structure ────────────────────────────────────────────────
  const structure = await page.evaluate(() => {
    const pages = [...document.querySelectorAll('#detail-sheet .detail-page')].filter(p => !p.hidden);
    const calendarPage = document.querySelector('.detail-page[data-detail-nav="calendar"]');
    const tabs = [...document.querySelectorAll('.detail-page-tab')].map(t => t.textContent.trim());
    return {
      pageCount: pages.length,
      insightGone: !document.querySelector('.detail-page[data-detail-nav="insight"]'),
      statsInside: !!(calendarPage && calendarPage.contains(document.getElementById('detail-stats'))),
      graphInside: !!(calendarPage && calendarPage.contains(document.getElementById('detail-graph'))),
      aboutInside: !!(calendarPage && calendarPage.contains(document.getElementById('detail-about'))),
      pickerGone: !document.getElementById('detail-plan-by-row') && !document.getElementById('detail-plan-by-date'),
      tabs: tabs.join('|')
    };
  });
  console.log('structure:', structure);
  if(structure.pageCount !== 5) throw new Error(`expected 5 visible detail pages, got ${structure.pageCount}`);
  if(!structure.insightGone) throw new Error('insight page should be merged away');
  if(!structure.statsInside || !structure.graphInside || !structure.aboutInside) throw new Error('stats/graph/about must live in the merged calendar page');
  if(!structure.pickerGone) throw new Error('plan-by date picker should be gone from the calendar pane');
  if(structure.tabs !== 'history|schedule|effort|identity|actions') throw new Error(`unexpected tab strip: ${structure.tabs}`);

  // ── Strip geometry + dots ────────────────────────────────────────────────
  const strip = await page.evaluate(({ threeDaysAgo, inTwoDays, tenDaysAgo }) => {
    const cells = [...document.querySelectorAll('#detail-calendar .cal-day.pickable')];
    const byKey = key => cells.find(c => c.dataset.entryDay === key);
    const past = byKey(dateKey(threeDaysAgo));
    const plan = byKey(dateKey(inTwoDays));
    return {
      count: cells.length,
      todayIdx: cells.findIndex(c => c.classList.contains('today')),
      future: cells.filter(c => c.classList.contains('future')).length,
      first: cells[0]?.dataset.entryDay || null,
      last: cells[cells.length - 1]?.dataset.entryDay || null,
      label: document.getElementById('detail-calendar-label').textContent,
      summary: document.getElementById('detail-calendar-summary').textContent.replace(/\s+/g, ' ').trim(),
      legendHasAgenda: !!document.querySelector('#detail-sheet .calendar-legend b.agenda'),
      pastCell: past ? {
        hasEntry: past.classList.contains('has-entry'),
        hitDot: !!past.querySelector('.cal-dot.hit')
      } : null,
      planCell: plan ? {
        planDot: !!plan.querySelector('.cal-dot.plan'),
        agendaDot: !!plan.querySelector('.cal-dot.agenda')
      } : null,
      outsideWindowAbsent: !byKey(dateKey(tenDaysAgo))
    };
  }, { threeDaysAgo, inTwoDays, tenDaysAgo });
  console.log('strip:', strip);
  if(strip.count !== 14) throw new Error(`expected 14 strip cells, got ${strip.count}`);
  if(strip.todayIdx !== 7) throw new Error(`today should sit at index 7, got ${strip.todayIdx}`);
  if(strip.future !== 6) throw new Error(`expected 6 future cells, got ${strip.future}`);
  if(strip.label !== 'around today') throw new Error(`default label should be 'around today', got '${strip.label}'`);
  if(!strip.outsideWindowAbsent) throw new Error('10-days-ago log must fall outside the default window');
  if(!strip.pastCell || !strip.pastCell.hasEntry || !strip.pastCell.hitDot) throw new Error('3-days-ago log should render a hit dot');
  if(!strip.planCell || !strip.planCell.planDot || !strip.planCell.agendaDot) throw new Error('planned day should show both plan and agenda dots');
  if(!strip.summary.includes('2 days') || !strip.summary.includes('1 entries') || !strip.summary.includes('1 planned')) throw new Error(`window chips wrong: '${strip.summary}'`);
  if(!strip.legendHasAgenda) throw new Error('detail legend should key the agenda dot');

  // ── Compact stats block (all old insight numbers, denser layout) ─────────
  const stats = await page.evaluate(() => ({
    scoreCard: !!document.querySelector('#detail-stats .score-card'),
    chips: document.querySelectorAll('#detail-stats .detail-stat-chip').length,
    chipText: [...document.querySelectorAll('#detail-stats .detail-stat-chip')].map(c => c.textContent.replace(/\s+/g, ' ').trim()).join(' | '),
    pace: !!document.querySelector('#detail-stats .pace-card .pace-strip'),
    graph: !!document.querySelector('#detail-graph .graph-bars, #detail-graph .graph-empty'),
    calendarHidden: !!document.getElementById('detail-viz-calendar')?.hidden,
    gapsHidden: !!document.getElementById('detail-viz-gaps')?.hidden,
    calOn: !!document.querySelector('[data-detail-viz="calendar"]')?.classList.contains('on')
  }));
  console.log('stats:', stats);
  if(!stats.scoreCard) throw new Error('score card missing from merged stats');
  if(stats.chips !== 5) throw new Error(`expected 5 stat chips (since-last, gap, 30d, streak, total), got ${stats.chips}`);
  if(!stats.chipText.includes('since last')) throw new Error(`chips should include since-last: '${stats.chipText}'`);
  if(!stats.chipText.includes('total entries')) throw new Error(`chips should include total entries: '${stats.chipText}'`);
  if(!/\b2\b.*total entries/.test(stats.chipText) && !stats.chipText.includes('2total entries')) throw new Error(`total entries must count the 10-day-ago log outside the strip: '${stats.chipText}'`);
  if(!stats.pace) throw new Error('pace strip missing');
  if(!stats.graph) throw new Error('gap history graph missing');
  if(stats.calendarHidden || !stats.gapsHidden || !stats.calOn) throw new Error('calendar should be the default viz slot');

  // ── Window navigation ────────────────────────────────────────────────────
  await page.locator('#detail-next-month').click();
  await page.waitForTimeout(150);
  const shifted = await page.evaluate(() => ({
    label: document.getElementById('detail-calendar-label').textContent
  }));
  console.log('after next:', shifted);
  if(!shifted.label.includes('–')) throw new Error(`shifted window should show a date range, got '${shifted.label}'`);
  await page.locator('#detail-today').click();
  await page.waitForTimeout(150);
  const backLabel = await page.locator('#detail-calendar-label').textContent();
  if(backLabel !== 'around today') throw new Error(`today button should restore the default window, got '${backLabel}'`);

  // ── Calendar | gaps slot toggle ──────────────────────────────────────────
  await page.locator('[data-detail-viz="gaps"]').click();
  await page.waitForTimeout(80);
  const gapsOn = await page.evaluate(() => ({
    calendarHidden: !!document.getElementById('detail-viz-calendar')?.hidden,
    gapsHidden: !!document.getElementById('detail-viz-gaps')?.hidden,
    gapsOn: !!document.querySelector('[data-detail-viz="gaps"]')?.classList.contains('on'),
    navHidden: !!document.getElementById('detail-calendar-nav')?.hidden
  }));
  console.log('gaps slot:', gapsOn);
  if(!gapsOn.calendarHidden || gapsOn.gapsHidden || !gapsOn.gapsOn) throw new Error('gaps toggle should hide the strip and show the graph');
  if(!gapsOn.navHidden) throw new Error('strip nav should hide while gap history is showing');
  await page.locator('[data-detail-viz="calendar"]').click();
  await page.waitForTimeout(80);
  const calBack = await page.evaluate(() => ({
    calendarHidden: !!document.getElementById('detail-viz-calendar')?.hidden,
    gapsHidden: !!document.getElementById('detail-viz-gaps')?.hidden
  }));
  if(calBack.calendarHidden || !calBack.gapsHidden) throw new Error('calendar toggle should restore the strip');

  // ── Day taps keep the scoped log/plan flow ───────────────────────────────
  const pastKey = await page.evaluate(d => dateKey(d), threeDaysAgo);
  await page.locator(`#detail-calendar [data-entry-day="${pastKey}"]`).click();
  await page.waitForSelector('#day-logs-sheet.open', { timeout:3000 });
  await page.waitForTimeout(200);
  const pastSheet = await page.evaluate(() => ({
    step: dayLogsStep,
    scoped: dayLogsScopeIndex,
    canLog: document.querySelector('#day-logs-body')?.textContent.includes('Log for this day'),
    planBy: document.querySelector('#day-logs-body')?.textContent.includes('Plan by this day')
  }));
  console.log('past-day sheet:', pastSheet);
  if(pastSheet.step !== 'item' || pastSheet.scoped !== 0) throw new Error(`past-day tap should open the scoped item step, got ${JSON.stringify(pastSheet)}`);
  if(!pastSheet.canLog) throw new Error('past day should offer Log for this day');
  if(pastSheet.planBy) throw new Error('past day must not offer Plan by this day');
  await page.locator('#day-logs-done').click();
  await page.waitForTimeout(200);

  const planKey = await page.evaluate(d => dateKey(d), inTwoDays);
  await page.locator(`#detail-calendar [data-entry-day="${planKey}"]`).click();
  await page.waitForSelector('#day-logs-sheet.open', { timeout:3000 });
  await page.waitForTimeout(200);
  const planSheet = await page.evaluate(() => ({
    step: dayLogsStep,
    body: document.querySelector('#day-logs-body')?.textContent || ''
  }));
  console.log('plan-day sheet:', { step: planSheet.step, plan: planSheet.body.includes('Plan this item'), move: planSheet.body.includes('Move plan'), planBy: planSheet.body.includes('Plan by this day') });
  if(planSheet.step !== 'item') throw new Error('plan-day tap should open the item step');
  if(!planSheet.body.includes('Plan this item')) throw new Error('future day should offer planning');
  if(!planSheet.body.includes('Move plan')) throw new Error('existing plan should offer Move plan');
  if(!planSheet.body.includes('Plan by this day')) throw new Error('future day should offer Plan by this day');

  await page.locator('[data-plan-by-day]').click();
  await page.waitForTimeout(200);
  const afterPlanBy = await page.evaluate((key) => {
    const h = load()[0];
    return {
      stored: h && dateKey(h.planByDate) === key,
      clear: (document.querySelector('#day-logs-body')?.textContent || '').includes('Clear plan-by')
    };
  }, planKey);
  console.log('after plan-by:', afterPlanBy);
  if(!afterPlanBy.stored) throw new Error('Plan by this day should persist planByDate to the tapped day');
  if(!afterPlanBy.clear) throw new Error('the plan-by day should then offer Clear plan-by');

  if(errors.length){ console.log('JS ERRORS:', errors.join('\n')); throw new Error('js errors during run'); }
  console.log('DETAIL CALENDAR STRIP TEST PASSED');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
