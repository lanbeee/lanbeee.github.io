// Calendar overview + detail-day scope regressions.
//
// Locks in the modernized calendar invariants that are easy to lose:
//   - around-today strip geometry (past 7 · today · next 6)
//   - slim chrome (no copy/stats; one filter row)
//   - shared markers (actual / plan / due / plan-by kinds)
//   - detail calendar day sheet scoped to that habit only
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/calendar-overview-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

function seedScript(){
  return `(function(){
    const now = Date.now();
    const day = (n) => {
      const d = new Date();
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
    };
    const settings = {
      preset:'todayFirst', topics:['qa'], locations:[
        { id:'home', name:'Home', lat:40.7, lng:-74.0 }
      ], travel:{}, defaultTravelMode:'walking',
      availabilityMinutes:[600,600,600,600,600,600,600], blockedTimes:[],
      showWeekOnHome:true,
      showDueHabitsInAgenda:true, showPlannedItemsInAgenda:true,
      showDueTasksInAgenda:true, showScheduledTasksInAgenda:true,
      agendaOptimizer:false,
    };
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    localStorage.setItem('tings_v2', JSON.stringify([
      {
        name:'Scope Alpha', type:'keepup', target:3,
        logs:[day(-2), {ts:day(2) + 10*3600000, plan:true}],
        emoji:'🅰️', pinned:false, sample:false, snoozedUntil:null,
        topics:['qa'], locationIds:['home'], durationMinutes:20, priority:2,
        planByDate: day(3), createdAt:now - 10*86400000, lastLog:day(-2)
      },
      {
        name:'Scope Beta', type:'task', target:null,
        logs:[], emoji:'🅱️', pinned:false, sample:false, snoozedUntil:null,
        topics:['qa'], locationIds:['home'], durationMinutes:15, priority:2,
        dueDate: day(2), hardDue:false, eventTime:null,
        createdAt:now - 5*86400000, lastLog:null
      },
      {
        name:'Other Place', type:'keepup', target:7,
        logs:[{ts:day(1) + 12*3600000, plan:true}],
        emoji:'🅿️', pinned:false, sample:false, snoozedUntil:null,
        topics:['qa'], locationIds:[], durationMinutes:10, priority:3,
        createdAt:now - 3*86400000, lastLog:null
      }
    ]));
  })();`;
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.addInitScript(seedScript());
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(400);

  // ── A. Shared markers / tally kinds ─────────────────────────────────────
  console.log('\n[A] habitPlanMarkers + buildDayTally kinds');
  const markers = await page.evaluate(() => {
    const data = load();
    const alpha = data.find(h => h.name === 'Scope Alpha');
    const beta = data.find(h => h.name === 'Scope Beta');
    const alphaMarks = habitPlanMarkers(alpha).map(m => m.kind);
    const betaMarks = habitPlanMarkers(beta).map(m => m.kind);
    const tally = buildDayTally(data, () => true);
    const kinds = [];
    tally.map.forEach(entries => entries.forEach(e => kinds.push(e.kind)));
    return {
      alphaMarks,
      betaMarks,
      hasPlan: kinds.includes('plan'),
      hasPlanBy: kinds.includes('planBy'),
      hasDue: kinds.includes('due'),
      hasActual: kinds.includes('actual'),
      planned: tally.planned,
      actual: tally.actual,
    };
  });
  console.log(markers);
  assert(markers.alphaMarks.includes('planBy'), 'keepup exposes planBy marker');
  assert(markers.betaMarks.includes('due'), 'untimed task exposes due marker');
  assert(markers.hasPlan, 'tally includes plan logs');
  assert(markers.hasPlanBy, 'tally includes planBy kind');
  assert(markers.hasDue, 'tally includes due kind');
  assert(markers.hasActual, 'tally includes actual logs');
  assert(markers.planned >= 2, 'planned count covers plan + markers');
  assert(markers.actual >= 1, 'actual count covers done logs');

  // ── B. Around-today strip geometry + slim chrome ────────────────────────
  console.log('\n[B] around-today strip + slim chrome');
  await page.locator('#open-overview').click();
  await page.waitForSelector('#overview-sheet.open, #pane-overview .overview-sheet');
  await page.waitForTimeout(200);
  const strip = await page.evaluate(() => {
    overviewListPane = 'plan';
    renderOverview();
    const cells = [...document.querySelectorAll('#overview-calendar .cal-day.pickable')];
    const todayIdx = cells.findIndex(c => c.classList.contains('today'));
    const sheet = document.querySelector('#overview-sheet .overview-sheet, #pane-overview .overview-sheet');
    const insightEl = document.getElementById('overview-insight');
    const cardEl = document.querySelector('.overview-card');
    const insightBeforeCard = !!(sheet && insightEl && cardEl
      && insightEl.compareDocumentPosition(cardEl) & Node.DOCUMENT_POSITION_FOLLOWING);
    const legendText = document.getElementById('overview-legend')?.innerText || '';
    const paneLabels = [...document.querySelectorAll('#overview-pane-filter [data-overview-pane]')].map(b => b.textContent.trim());
    return {
      label: document.getElementById('overview-calendar-label')?.textContent || '',
      filter: document.querySelector('#overview-filter [data-overview-range="recent"]')?.textContent || '',
      rangeButtons: document.querySelectorAll('#overview-filter [data-overview-range]').length,
      hasFilterTrigger: !!document.querySelector('#overview-filter [data-open-overview-filters]'),
      count: cells.length,
      todayIdx,
      future: cells.filter(c => c.classList.contains('future')).length,
      first: cells[0]?.dataset.logDay,
      last: cells[cells.length - 1]?.dataset.logDay,
      noCopy: !document.getElementById('overview-copy'),
      noStats: !document.querySelector('#overview-sheet #overview-stats'),
      legendAgenda: !!document.querySelector('#overview-legend b.agenda'),
      legendCompact: /done/i.test(legendText) && /on agenda/i.test(legendText) && !/behind|almost/i.test(legendText),
      insightBeforeCard,
      paneLabels,
      listText: document.getElementById('overview-list')?.innerText || '',
      defaultPane: overviewListPane,
    };
  });
  console.log(strip);
  assert(strip.label === 'around today', 'nav label is around today');
  assert(strip.filter === '2 weeks', 'compact period switcher labels the two-week view');
  assert(strip.rangeButtons === 3, 'period switcher offers 2 weeks, month, and all time');
  assert(strip.hasFilterTrigger, 'place/topic choices live behind one filter trigger');
  assert(strip.count === 14, 'strip has 14 days');
  assert(strip.todayIdx === 7, 'today sits after 7 past days');
  assert(strip.future === 6, 'six future days ahead');
  assert(strip.noCopy && strip.noStats, 'copy/stats chrome removed');
  assert(strip.legendAgenda && strip.legendCompact, 'compact around-today legend: done · planned · on agenda');
  assert(strip.insightBeforeCard, 'insight sits above the days card');
  assert(strip.paneLabels.some(t => /coming up/i.test(t)), 'coming up pane label');
  assert(strip.paneLabels.some(t => /attention/i.test(t)), 'attention pane label');
  assert(strip.paneLabels.some(t => /recent/i.test(t)), 'recent pane label');
  assert(/coming up|nothing coming|best day to plan/i.test(strip.listText), 'coming-up pane list renders');
  assert(strip.defaultPane === 'plan', 'defaults to coming-up pane when ahead has items');

  // Place/topic libraries are grouped in an on-demand sheet, not the header.
  await page.locator('#overview-filter [data-open-overview-filters]').click();
  await page.waitForSelector('#calendar-filter-sheet.open');
  const filterSheet = await page.evaluate(() => ({
    places: document.getElementById('calendar-filter-places-label')?.textContent || '',
    topics: document.getElementById('calendar-filter-topics-label')?.textContent || '',
    options: document.querySelectorAll('#calendar-filter-groups .home-filter-option').length,
  }));
  assert(filterSheet.places === 'Place' && filterSheet.topics === 'Topic', 'filter sheet groups Place before Topic');
  assert(filterSheet.options >= 4, 'filter sheet exposes grouped choices with counts');
  await page.locator('#calendar-filter-groups [data-overview-location="__none__"]').click();
  assert(await page.locator('#overview-filter [data-clear-overview-location]').count() === 1, 'selected place is summarized above the calendar');
  await page.locator('#calendar-filter-reset').click();
  assert(await page.locator('#overview-filter [data-clear-overview-location]').count() === 0, 'reset clears active calendar filters');
  await page.locator('#calendar-filter-done').click();
  assert(await page.locator('#calendar-filter-sheet.open').count() === 0, 'show results closes the filter sheet');
  await page.locator('#overview-filter [data-open-overview-filters]').click();
  await page.keyboard.press('Escape');
  assert(await page.locator('#calendar-filter-sheet.open').count() === 0, 'Escape closes only the filter sheet');
  assert(await page.locator('#overview-sheet.open').count() === 1, 'calendar remains open after dismissing a nested filter sheet');

  // Progressive panes + week insight
  const insight = await page.evaluate(() => {
    const el = document.getElementById('overview-insight');
    const panes = [...document.querySelectorAll('#overview-pane-filter [data-overview-pane]')].map(b => b.dataset.overviewPane);
    const openText = el?.innerText || '';
    setOverviewListPane('care');
    const careTitle = document.querySelector('#overview-list .overview-section-title')?.textContent || '';
    setOverviewListPane('past');
    const pastTitle = document.querySelector('#overview-list .overview-section-title')?.textContent || '';
    setOverviewListPane('plan');
    const planTitle = document.querySelector('#overview-list .overview-section-title')?.textContent || '';
    const tip = document.querySelector('.overview-plan-tip')?.innerText || '';
    const chips = [...document.querySelectorAll('#overview-insight .overview-open-chip')];
    const chipTones = chips.map(c => ['open','mid','tight'].find(t => c.classList.contains(t)) || '');
    const planItems = document.querySelectorAll('#overview-list .overview-item').length;
    return {
      insightVisible: el && !el.hidden,
      openText,
      panes,
      careTitle,
      pastTitle,
      planTitle,
      tip,
      chips: chips.length,
      chipTones,
      planItems,
      hasOpenHours: /open this week/i.test(openText),
    };
  });
  console.log(insight);
  assert(insight.insightVisible, 'week insight is visible on around-today');
  assert(insight.hasOpenHours, 'insight reports open hours this week');
  assert(insight.chips === 7, 'seven open-day chips for the week');
  assert(insight.chipTones.every(t => t === 'open' || t === 'mid' || t === 'tight'), 'day chips use open/mid/tight tones');
  assert(insight.panes.join(',') === 'plan,care,past', 'plan/care/past pane keys present');
  assert(/needs attention/i.test(insight.careTitle), 'attention pane shows needs attention');
  assert(/^recent$/i.test(insight.pastTitle.trim()), 'recent pane title');
  assert(/coming up/i.test(insight.planTitle), 'coming-up pane title');
  assert(/best day to plan/i.test(insight.tip) || insight.tip === '', 'best-day tip when capacity exists');
  assert(insight.planItems <= 4, 'coming-up pane caps at 4 items');

  // Auto-open attention when coming-up is empty
  const autoCare = await page.evaluate(() => {
    const lists = {ahead:[], care:[{key:'x',entry:{name:'Behind'},label:'behind'}], past:[]};
    overviewListPane = 'plan';
    const pickedEmptyAhead = pickOverviewListPane(lists);
    overviewListPane = 'plan';
    const pickedWithAhead = pickOverviewListPane({
      ahead:[{key:'y',entry:{name:'Soon'},label:'planned'}],
      care:lists.care,
      past:[]
    });
    return {pickedEmptyAhead, pickedWithAhead};
  });
  assert(autoCare.pickedEmptyAhead === 'care', 'auto-opens attention when coming-up empty');
  assert(autoCare.pickedWithAhead === 'plan', 'stays on coming-up when ahead has items');

  // Future plan day should light up in the default window
  const futurePlanLit = await page.evaluate(() => {
    const key = dateKey(dayStart(Date.now()) + 2 * 86400000);
    const cell = document.querySelector(`#overview-calendar [data-log-day="${key}"]`);
    return {
      key,
      hasEntry: cell?.classList.contains('has-entry') || false,
      hasPlanDot: !!cell?.querySelector('.cal-dot.plan, .cal-dot.agenda'),
    };
  });
  console.log(futurePlanLit);
  assert(futurePlanLit.hasEntry, 'day+2 with plans/dues is marked in the strip');
  assert(futurePlanLit.hasPlanDot, 'day+2 shows plan or agenda dot');

  const dayMenu = await page.evaluate(() => {
    const key = todayIso();
    resetDayLogsStep();
    renderDayLogs(key);
    const quickActions = [...document.querySelectorAll('#day-logs-body .day-quick-action')].map(btn => btn.textContent.replace(/\s+/g,' ').trim());
    const listFooter = document.getElementById('day-logs-footer')?.innerText || '';
    setDayLogsStep('avail');
    const presets = [...document.querySelectorAll('[data-day-availability-preset]')].map(btn => btn.textContent.trim());
    const saveCopy = document.getElementById('day-availability-save')?.textContent.trim() || '';
    resetDayLogsStep();
    return {quickActions,listFooter,presets,saveCopy};
  });
  assert(dayMenu.quickActions.some(text => /plan something/i.test(text)), 'day menu leads with Plan something');
  assert(dayMenu.quickActions.some(text => /adjust open time/i.test(text)), 'day menu exposes open-time adjustment as a clear action');
  assert(/back to calendar/i.test(dayMenu.listFooter) && /home/i.test(dayMenu.listFooter), 'day menu has clear calendar and home exits');
  assert(dayMenu.presets.join(',') === 'No time,2h,4h,8h', 'open-time editor offers understandable presets');
  assert(/save open time/i.test(dayMenu.saveCopy), 'open-time editor has an explicit save action');

  // ── C. Detail calendar scopes the day sheet to that habit ───────────────
  console.log('\n[C] detail calendar day sheet is habit-scoped');
  await page.locator('#overview-close').click().catch(()=>{});
  await page.evaluate(() => {
    const idx = load().findIndex(h => h.name === 'Scope Alpha');
    openDetail(idx);
  });
  await page.waitForSelector('#detail-sheet.open, #pane-detail .detail-sheet');
  await page.waitForTimeout(150);

  const scoped = await page.evaluate(() => {
    const idx = load().findIndex(h => h.name === 'Scope Alpha');
    const h = load()[idx];
    const key = dateKey(dayStart(Date.now()) + 2 * 86400000);
    dayLogsKey = key;
    dayLogsScopeIndex = idx;
    dayLogsStep = 'item';
    dayLogsItemIndex = idx;
    dayLogsMoving = false;
    renderDayLogs(key);
    const body = document.getElementById('day-logs-body')?.innerText || '';
    const footer = document.getElementById('day-logs-footer')?.innerText || '';
    const rows = collectDayLogRows(key);
    return {
      scoped: typeof dayLogsScoped === 'function' && dayLogsScoped(),
      rowNames: rows.map(r => r.h.name),
      bodyHasAlpha: body.includes('Scope Alpha'),
      bodyHasBeta: body.includes('Scope Beta'),
      bodyHasOther: body.includes('Other Place'),
      footerHasDone: /done/i.test(footer),
      footerHasHome: /home/i.test(footer),
      footerHasCalendar: /calendar/i.test(footer),
      openBtn: !!document.querySelector('#day-logs-body [data-open-day-item]'),
      planBtn: !!document.querySelector('#day-logs-plan'),
    };
  });
  console.log(scoped);
  assert(scoped.scoped, 'dayLogsScoped is active from detail');
  assert(scoped.rowNames.length === 1 && scoped.rowNames[0] === 'Scope Alpha', 'scoped rows are only the detail habit');
  assert(scoped.bodyHasAlpha, 'scoped sheet names the habit');
  assert(!scoped.bodyHasBeta && !scoped.bodyHasOther, 'scoped sheet does not list other habits');
  assert(scoped.footerHasDone, 'scoped footer uses done');
  assert(!scoped.footerHasHome && !scoped.footerHasCalendar, 'scoped footer omits overview home/calendar');
  assert(!scoped.openBtn, 'scoped sheet hides open (already on detail)');
  assert(scoped.planBtn, 'scoped sheet offers Plan this item');

  const logAction = await page.evaluate(() => {
    // Future scoped day: plan yes, log no
    return !!document.querySelector('#day-logs-body [data-log-day-item]');
  });
  assert(!logAction, 'scoped future day does not offer Log for this day');

  const todayScoped = await page.evaluate(() => {
    const idx = load().findIndex(h => h.name === 'Scope Alpha');
    const key = todayIso();
    dayLogsKey = key;
    dayLogsScopeIndex = idx;
    dayLogsStep = 'item';
    dayLogsItemIndex = idx;
    dayLogsMoving = false;
    renderDayLogs(key);
    return {
      hasLog: !!document.querySelector('[data-log-day-item]'),
      hasPlan: !!document.querySelector('#day-logs-plan')
    };
  });
  assert(todayScoped.hasLog, 'scoped today offers Log for this day');
  assert(todayScoped.hasPlan, 'scoped today offers Plan this item');

  const pastScoped = await page.evaluate(() => {
    const idx = load().findIndex(h => h.name === 'Scope Alpha');
    const key = dateKey(dayStart(Date.now()) - 2 * 86400000);
    dayLogsKey = key;
    dayLogsScopeIndex = idx;
    dayLogsStep = 'item';
    dayLogsItemIndex = idx;
    dayLogsMoving = false;
    renderDayLogs(key);
    const item = {
      hasLog: !!document.querySelector('[data-log-day-item]'),
      hasPlan: !!document.querySelector('#day-logs-plan')
    };
    dayLogsScopeIndex = null;
    dayLogsStep = 'list';
    dayLogsItemIndex = null;
    dayLogsMoving = false;
    renderDayLogs(key);
    return {
      ...item,
      overviewPlan: !!document.querySelector('#day-logs-plan')
    };
  });
  assert(pastScoped.hasLog, 'scoped past day offers Log for this day');
  assert(!pastScoped.hasPlan, 'scoped past day does not offer Plan this item');
  assert(!pastScoped.overviewPlan, 'overview past day does not offer Plan something');

  // Unmarked future day from detail opens sheet without auto-logging
  const unmarked = await page.evaluate(() => {
    const idx = load().findIndex(h => h.name === 'Scope Alpha');
    const before = normalizeLogs(load()[idx].logs).filter(log => !isPlanLog(log)).length;
    const key = dateKey(dayStart(Date.now()) + 9 * 86400000);
    dayLogsKey = key;
    dayLogsScopeIndex = idx;
    dayLogsStep = 'item';
    dayLogsItemIndex = idx;
    dayLogsMoving = false;
    renderDayLogs(key);
    const after = normalizeLogs(load()[idx].logs).filter(log => !isPlanLog(log)).length;
    return {
      before,
      after,
      hasLog: !!document.querySelector('[data-log-day-item]'),
      hasPlan: !!document.querySelector('#day-logs-plan'),
      emptyNote: (document.getElementById('day-logs-body')?.innerText || '').includes('Nothing on this day')
    };
  });
  assert(unmarked.after === unmarked.before, 'unmarked detail day does not auto-log');
  assert(!unmarked.hasLog && unmarked.hasPlan, 'unmarked future scoped day offers Plan only');

  // Add-plan step stays locked to the same habit
  const addStep = await page.evaluate(() => {
    setDayLogsStep('add');
    const ting = document.getElementById('day-log-ting');
    const scopedLabel = document.querySelector('.day-scoped-habit')?.textContent || '';
    return {
      value: ting ? ting.value : null,
      isHidden: ting ? ting.type === 'hidden' || ting.tagName === 'INPUT' : false,
      scopedLabel,
      selectCount: document.querySelectorAll('#day-log-ting option').length,
      hasTime: !!document.getElementById('day-log-time'),
      hasLocation: !!document.getElementById('day-log-location'),
    };
  });
  console.log(addStep);
  assert(String(addStep.value) !== '', 'scoped add step targets an index');
  assert(/Scope Alpha/i.test(addStep.scopedLabel) || addStep.selectCount <= 1, 'add step does not offer a full habit picker');
  assert(addStep.hasTime, 'add step includes optional time');
  assert(addStep.hasLocation, 'add step includes optional location for habits with places');

  // Overview path clears scope
  const cleared = await page.evaluate(() => {
    resetDayLogsStep();
    return dayLogsScopeIndex === null && !dayLogsScoped();
  });
  assert(cleared, 'resetDayLogsStep clears habit scope');

  if(pageErrors.length){
    console.error('page errors:', pageErrors.join('\n'));
    assert(false, 'no page errors');
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  if(fail) process.exit(1);
  console.log('CALENDAR OVERVIEW TEST PASSED');
})().catch(err => {
  console.error(err);
  process.exit(1);
});
