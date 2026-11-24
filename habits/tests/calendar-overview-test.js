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
        dueDate: day(2), hardDue:false, delayAllowanceDays:1, eventTime:null,
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
  assert(dayMenu.quickActions.some(text => /see open hours/i.test(text)), 'day menu offers the open-hours checker');
  assert(dayMenu.quickActions.some(text => /adjust open time/i.test(text)), 'day menu exposes open-time adjustment as a clear action');
  assert(/back to calendar/i.test(dayMenu.listFooter) && /home/i.test(dayMenu.listFooter), 'day menu has clear calendar and home exits');
  assert(dayMenu.presets.join(',') === 'No time,2h,4h,8h', 'open-time editor offers understandable presets');
  assert(/save open time/i.test(dayMenu.saveCopy), 'open-time editor has an explicit save action');

  const openHoursShortcut = await page.evaluate(() => {
    const key = todayIso();
    resetDayLogsStep();
    renderDayLogs(key);
    document.getElementById('day-logs-open-hours')?.click();
    return {
      sheetOpen: document.getElementById('free-time-sheet')?.classList.contains('open') || false,
      title: document.getElementById('free-time-title')?.textContent || '',
      expanded: document.querySelector('#free-time-sheet .free-fit-checker')?.classList.contains('is-expanded') || false,
      hasSwitch: !!document.querySelector('#free-time-sheet .free-day-switch'),
      selectedDay: document.querySelector('#free-time-sheet .free-day-chip.on')?.dataset.freeDay || '',
      today: todayIso()
    };
  });
  assert(openHoursShortcut.sheetOpen, 'See open hours opens the free-time sheet over the day');
  assert(/open time/i.test(openHoursShortcut.title), `open-hours title names the sheet: "${openHoursShortcut.title}"`);
  assert(openHoursShortcut.expanded, 'calendar shortcut expands the time checker immediately');
  assert(openHoursShortcut.hasSwitch, 'open-hours sheet includes a day switcher');
  assert(openHoursShortcut.selectedDay === openHoursShortcut.today, 'open-hours switcher lands on the tapped day');
  await page.evaluate(() => {
    if(typeof closeSheet === 'function')closeSheet('free-time-sheet');
  });

  // ── C. Detail calendar scopes the day sheet to that habit ───────────────
  console.log('\n[C] detail calendar day sheet is habit-scoped');
  await page.locator('#overview-head-close').click().catch(()=>{});
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
      singleClose: document.getElementById('day-logs-close')?.getClientRects().length > 0 && document.getElementById('day-logs-done')?.getClientRects().length === 0,
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
  assert(scoped.singleClose, 'scoped day uses the single header close control');
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
    const pastQuick = [...document.querySelectorAll('#day-logs-body .day-quick-action')].map(btn => btn.textContent.replace(/\s+/g,' ').trim());
    return {
      ...item,
      overviewPlan: !!document.querySelector('#day-logs-plan'),
      pastLog: pastQuick.some(text => /log a missed day/i.test(text)),
      pastPlan: pastQuick.some(text => /plan something/i.test(text)),
      pastHours: pastQuick.some(text => /see open hours/i.test(text))
    };
  });
  assert(pastScoped.hasLog, 'scoped past day offers Log for this day');
  assert(!pastScoped.hasPlan, 'scoped past day does not offer Plan this item');
  assert(!pastScoped.overviewPlan, 'overview past day does not offer Plan something');
  assert(pastScoped.pastLog && !pastScoped.pastPlan, 'overview past day offers Log a missed day, not Plan something');
  assert(pastScoped.pastHours, 'overview past day still offers See open hours');

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

  // ── D. Calendar open stays off the UI thread; day sheet splits agenda ──
  console.log('\n[D] off-main calendar + day agenda sections');
  const dayAgenda = await page.evaluate(() => {
    const orig = buildWeekAgenda;
    let syncCalls = 0;
    buildWeekAgenda = function(){
      syncCalls += 1;
      return orig.apply(this, arguments);
    };
    try{
      const settings = loadSortSettings();
      saveSortSettings({...settings, minimalMode:true});
      sortSettings = loadSortSettings();
      if(typeof applyAppearanceSettings === 'function')applyAppearanceSettings();
      _homeRenderedWeek = null;
      _overviewWeekSnapshot = null;
      _overviewWeekSnapshotKey = '';
      overviewMonthOffset = 0;
      overviewRecentOffset = 0;
      overviewRangeFilter = 'recent';
      renderOverview();
      const cellCount = document.querySelectorAll('#overview-calendar .cal-day.pickable').length;
      const afterOpenCalls = syncCalls;

      resetDayLogsStep();
      const today = todayIso();
      renderDayLogs(today);
      const todayAgenda = !!document.querySelector('#day-logs-body [data-day-section="agenda"]');
      const todayPlanned = !!document.querySelector('#day-logs-body [data-day-section="planned"]');
      const todayActivity = !!document.querySelector('#day-logs-body [data-day-section="activity"]');
      const afterTodayCalls = syncCalls;

      const past = dateKey(dayStart(Date.now()) - 2 * 86400000);
      resetDayLogsStep();
      renderDayLogs(past);
      const pastAgenda = !!document.querySelector('#day-logs-body [data-day-section="agenda"]');
      const pastActivity = (document.querySelector('#day-logs-body [data-day-section="activity"]')?.innerText || '');
      const afterPastCalls = syncCalls;

      const future = dateKey(dayStart(Date.now()) + 2 * 86400000);
      resetDayLogsStep();
      renderDayLogs(future);
      const futureAgenda = !!document.querySelector('#day-logs-body [data-day-section="agenda"]');
      const futurePlanned = (document.querySelector('#day-logs-body [data-day-section="planned"]')?.innerText || '');
      const afterFutureCalls = syncCalls;

      const data = load();
      const base = dayStart(Date.now());
      const timedDay = {
        dayBase:base,
        dayKey:today,
        isToday:true,
        timeline:[{
          kind:'fill',
          i:0,
          start:base + 10 * 3600000,
          end:base + 10.5 * 3600000,
          h:data[0]
        }]
      };
      _homeRenderedWeek = {days:[timedDay]};
      resetDayLogsStep();
      renderDayLogs(today);
      const minimalAgendaText = document.querySelector('#day-logs-body [data-day-section="agenda"]')?.innerText || '';

      saveSortSettings({...loadSortSettings(), minimalMode:false});
      sortSettings = loadSortSettings();
      if(typeof applyAppearanceSettings === 'function')applyAppearanceSettings();
      _homeRenderedWeek = {days:[timedDay]};
      resetDayLogsStep();
      renderDayLogs(today);
      const fullAgendaText = document.querySelector('#day-logs-body [data-day-section="agenda"]')?.innerText || '';
      const afterFullCalls = syncCalls;

      const betaIdx = data.findIndex(h=>h.name === 'Scope Beta');
      _homeRenderedWeek = {
        days:[{
          dayBase:base,
          dayKey:today,
          isToday:true,
          timeline:[{
            kind:'fill',
            i:betaIdx,
            start:base + 11 * 3600000,
            end:base + 11.4 * 3600000,
            h:data[betaIdx]
          }]
        }]
      };
      resetDayLogsStep();
      renderDayLogs(today);
      setDayLogsStep('item',betaIdx);
      const itemOpen = !!document.querySelector('#day-logs-body [data-open-day-item]');
      const itemTitle = document.getElementById('day-logs-title')?.textContent || '';
      const itemStep = dayLogsStep;
      const afterTapCalls = syncCalls;

      return {
        cellCount,
        afterOpenCalls,
        todayAgenda,
        todayPlanned,
        todayActivity,
        afterTodayCalls,
        pastAgenda,
        pastActivity,
        afterPastCalls,
        futureAgenda,
        futurePlanned,
        afterFutureCalls,
        minimalAgendaText,
        fullAgendaText,
        afterFullCalls,
        itemOpen,
        itemTitle,
        itemStep,
        afterTapCalls,
        firstName:data[0] && data[0].name
      };
    }finally{
      buildWeekAgenda = orig;
    }
  });
  console.log(dayAgenda);
  assert(dayAgenda.cellCount === 14, 'minimal calendar still paints the 14-day strip');
  assert(dayAgenda.afterOpenCalls === 0, 'opening calendar does not call buildWeekAgenda on the UI thread');
  assert(dayAgenda.todayAgenda, 'today unscoped day sheet shows Agenda');
  assert(dayAgenda.afterTodayCalls === 0, 'opening today does not sync-plan a week');
  assert(!dayAgenda.pastAgenda, 'past day sheet hides Agenda');
  assert(/Scope Alpha/i.test(dayAgenda.pastActivity), 'past day Activity lists the logged habit');
  assert(dayAgenda.futureAgenda, 'future day sheet shows Agenda');
  assert(/Scope Beta|Scope Alpha/i.test(dayAgenda.futurePlanned), 'future Planned lists due / plan-by items');
  assert(dayAgenda.afterFutureCalls === 0, 'future day does not sync-plan a week');
  assert(dayAgenda.fullAgendaText.includes(dayAgenda.firstName), 'full mode Agenda reuses the home week timeline');
  assert(/10AM|10:00/i.test(dayAgenda.fullAgendaText) && /30m/.test(dayAgenda.fullAgendaText), 'full mode Agenda shows time and duration');
  assert(dayAgenda.afterFullCalls === 0, 'full mode Agenda does not sync-plan a week');
  assert(dayAgenda.minimalAgendaText.includes(dayAgenda.firstName), 'minimal Agenda still names the placed habit');
  assert(!/10AM|10:00/i.test(dayAgenda.minimalAgendaText) && !/\b30m\b/.test(dayAgenda.minimalAgendaText), 'minimal Agenda hides time and duration');
  assert(dayAgenda.itemStep === 'item' && dayAgenda.itemOpen, 'tapping an agenda habit opens item options including Open item');
  assert(/Scope Beta/i.test(dayAgenda.itemTitle), 'item options are for the tapped habit');
  assert(dayAgenda.afterTapCalls === 0, 'opening item options does not sync-plan a week');

  // ── E. Calendar overview refinements: events, month upcoming, expand, day nav, create ──
  console.log('\n[E] calendar overview refinements');
  const refined = await page.evaluate(() => {
    const now = Date.now();
    const base = dayStart(now);
    const keyAt = (n) => dateKey(base + n * 86400000);
    const data = load();
    // Add a one-off local appointment, a weekly local appointment, a habit already done today
    // (with an older wide gap that must NOT trigger a false attention alarm), an overdue habit,
    // and extra upcoming tasks to exercise the Show all toggle.
    const nextWd = new Date(base + 3 * 86400000).getDay();
    data.push(
      {
        name:'Dentist Event', type:'task', target:null, logs:[], emoji:'🦷',
        topics:['qa'], locationIds:[], durationMinutes:60, priority:1,
        appointment:{ repeat:'once', startDate:keyAt(3), startMinute:14*60, weekdays:[], ordinalWeekdays:[], until:'', exceptions:{} },
        eventTime:null, dueDate:null, hardDue:false, createdAt:now - 5*86400000, lastLog:null
      },
      {
        name:'Weekly Sync', type:'task', target:null, logs:[], emoji:'🗓️',
        topics:['qa'], locationIds:[], durationMinutes:30, priority:2,
        appointment:{ repeat:'weekly', startDate:keyAt(-7), startMinute:11*60, weekdays:[nextWd], ordinalWeekdays:[], until:'', exceptions:{} },
        eventTime:null, dueDate:null, hardDue:false, createdAt:now - 10*86400000, lastLog:null
      },
      {
        name:'Already Caught Up', type:'keepup', target:1,
        logs:[base - 5*86400000, base + 9*3600000], emoji:'✅',
        topics:['qa'], locationIds:[], durationMinutes:15, priority:2,
        createdAt:now - 10*86400000, lastLog:base + 9*3600000
      },
      {
        name:'Really Overdue', type:'keepup', target:2,
        logs:[base - 6*86400000], emoji:'🪴',
        topics:['qa'], locationIds:[], durationMinutes:15, priority:2,
        createdAt:now - 10*86400000, lastLog:base - 6*86400000
      },
      {
        name:'Extra Task A', type:'task', target:null, logs:[], emoji:'📝',
        topics:['qa'], locationIds:[], durationMinutes:15, priority:2,
        dueDate:base + 4*86400000, hardDue:false, eventTime:null, createdAt:now - 2*86400000, lastLog:null
      },
      {
        name:'Extra Task B', type:'task', target:null, logs:[], emoji:'📌',
        topics:['qa'], locationIds:[], durationMinutes:15, priority:2,
        dueDate:base + 5*86400000, hardDue:false, eventTime:null, createdAt:now - 2*86400000, lastLog:null
      }
    );
    save(data);

    // Non-contradictory week capacity: tomorrow has 23h open AND 4 items -> must NOT say "tomorrow packed"
    _homeRenderedWeek = {
      days: Array.from({length:7}, (_, i) => ({
        dayBase: base + i * 86400000,
        isToday: i === 0,
        totalMinutes: 1440,
        usedMinutes: i === 1 ? 60 : 300,
        remainingMinutes: i === 1 ? 1380 : 1140,
        timeline: i === 1 ? [0,1,2,3].map(idx => ({ kind:'fill', i:idx, h:data[idx], start:base + 86400000 + (9+idx)*3600000, end:base + 86400000 + (9.5+idx)*3600000 })) : [],
        agendaItems: i === 1 ? [0,1,2,3].map(idx => ({ h:data[idx] })) : []
      }))
    };

    overviewRangeFilter = 'recent';
    overviewRecentOffset = 0;
    overviewMonthOffset = 0;
    overviewListPane = 'plan';
    renderOverview();

    const insightText = document.getElementById('overview-insight')?.textContent || '';
    const cap = overviewWeekCapacity(load());
    const tomorrowLoad = cap.tomorrow ? cap.tomorrow.load : -1;

    // Expand coming up list
    const initialCount = document.querySelectorAll('#overview-list .overview-item').length;
    const expandBtn = document.querySelector('#overview-list [data-overview-expand]');
    const hasExpand = !!expandBtn;
    if(expandBtn)expandBtn.click();
    const expandedCount = document.querySelectorAll('#overview-list .overview-item').length;
    const expandedText = document.getElementById('overview-list')?.textContent || '';

    // Check attention pane: Really Overdue present, Already Caught Up absent
    setOverviewListPane('care');
    const careText = document.getElementById('overview-list')?.textContent || '';

    // Check Month view shows local appointments and coming up section
    overviewRangeFilter = 'month';
    overviewMonthOffset = 0;
    renderOverview();
    const monthEventCell = document.querySelector(`#overview-calendar [data-log-day="${keyAt(3)}"]`);
    const monthListText = document.getElementById('overview-list')?.textContent || '';

    // Check day sheet for day+3 lists Dentist Event + Weekly Sync with event meta
    resetDayLogsStep();
    renderDayLogs(keyAt(3));
    const day3Text = document.getElementById('day-logs-body')?.innerText || '';
    const dayNavVisible = !document.getElementById('day-logs-day-nav')?.hidden;
    const daySubText = document.getElementById('day-logs-sub')?.textContent || '';
    const hasNewItemBtn = !!document.getElementById('day-logs-new-item');

    // Step next day via day stepper
    stepDayLogsKey(1);
    const steppedKey = dayLogsKey;

    // Open Add sheet pre-filled for day+4 via Create new item
    document.getElementById('day-logs-new-item')?.click();
    const addOpen = document.getElementById('add-sheet')?.classList.contains('open') || false;
    const prefilledDue = document.getElementById('ting-due-date')?.value || '';
    if(addOpen && typeof closeSheet === 'function')closeSheet('add-sheet');

    return {
      insightText,
      tomorrowLoad,
      initialCount,
      hasExpand,
      expandedCount,
      hasDentistInComingUp: expandedText.includes('Dentist Event'),
      hasWeeklyInComingUp: expandedText.includes('Weekly Sync'),
      careHasOverdue: careText.includes('Really Overdue'),
      careHasCaughtUp: careText.includes('Already Caught Up'),
      monthEventLit: monthEventCell?.classList.contains('has-entry') || false,
      monthHasComingUp: /coming up/i.test(monthListText),
      day3HasDentist: day3Text.includes('Dentist Event'),
      day3HasEventTime: /2PM|2:00/i.test(day3Text),
      dayNavVisible,
      daySubHasOpen: /open/i.test(daySubText),
      hasNewItemBtn,
      steppedCorrectly: steppedKey === keyAt(4),
      addOpen,
      prefilledDue,
      expectedDue: keyAt(4),
    };
  });
  console.log(refined);
  assert(refined.tomorrowLoad === 4, 'week capacity deduplicates timeline + agendaItems load');
  assert(!/packed/i.test(refined.insightText), 'week insight does not call a 23h-open day packed');
  assert(refined.initialCount === 4 && refined.hasExpand && refined.expandedCount > 4, 'coming-up list caps at 4 and expands on demand');
  assert(refined.hasDentistInComingUp && refined.hasWeeklyInComingUp, 'one-off and weekly local appointments appear in coming up');
  assert(refined.careHasOverdue && !refined.careHasCaughtUp, 'attention surfaces overdue items without false alarms for habits done today');
  assert(refined.monthEventLit && refined.monthHasComingUp, 'month view highlights local appointments and shows coming up');
  assert(refined.day3HasDentist && refined.day3HasEventTime, 'day sheet shows local appointments with clock time');
  assert(refined.dayNavVisible && refined.daySubHasOpen && refined.hasNewItemBtn, 'day sheet shows day stepper, open time, and Create new item');
  assert(refined.steppedCorrectly, 'day stepper advances to the next day');
  assert(refined.addOpen && refined.prefilledDue === refined.expectedDue, 'Create new item opens Add sheet pre-filled with the tapped date');

  // Switching back to 2 weeks from month updates remembered calendar view
  const rememberCheck = await page.evaluate(() => {
    openCalendarOverview({range:'month'});
    const afterMonth = localStorage.getItem(CALENDAR_VIEW_KEY);
    document.querySelector('#overview-filter [data-overview-range="recent"]')?.click();
    const afterRecent = localStorage.getItem(CALENDAR_VIEW_KEY);
    closeSheet('overview-sheet');
    openRememberedCalendar();
    const reopenedRange = overviewRangeFilter;
    if(typeof openWeekView === 'function'){
      openWeekView();
      document.getElementById('week-view-overview')?.click();
    }
    const fromWeekRange = overviewRangeFilter;
    return { afterMonth, afterRecent, reopenedRange, fromWeekRange };
  });
  assert(rememberCheck.afterMonth === 'month', 'month view remembers month');
  assert(rememberCheck.afterRecent === 'overview' && rememberCheck.reopenedRange === 'recent', 'switching back to 2 weeks updates remembered calendar view');
  assert(rememberCheck.fromWeekRange === 'recent', 'week header calendar switch returns to 2-week overview');

  // Tapping an item in Coming up opens that item's detail sheet, not the day menu
  const comingUpTap = await page.evaluate(() => {
    overviewRangeFilter = 'recent';
    overviewRecentOffset = 0;
    overviewListPane = 'plan';
    renderOverview();
    openSheet('overview-sheet');
    if(typeof closeSheet === 'function'){
      closeSheet('detail-sheet');
      closeSheet('day-logs-sheet');
    }
    const row = document.querySelector('#overview-list .overview-link-row');
    const rowName = row?.querySelector('.overview-name')?.textContent.trim() || '';
    const hasOpenAttr = row?.hasAttribute('data-open-overview-item') || false;
    if(row)row.click();
    return {
      hasOpenAttr,
      detailOpen: document.getElementById('detail-sheet')?.classList.contains('open') || false,
      dayLogsOpen: document.getElementById('day-logs-sheet')?.classList.contains('open') || false,
      rowName,
      detailName: document.getElementById('detail-name')?.textContent.trim() || ''
    };
  });
  assert(comingUpTap.hasOpenAttr && comingUpTap.detailOpen && !comingUpTap.dayLogsOpen, 'tapping a coming-up row opens the item detail sheet instead of the day menu');
  assert(comingUpTap.detailName && comingUpTap.rowName.includes(comingUpTap.detailName), 'coming-up row opens the matching item');

  // Layering & end-to-end Add flow from Calendar Overview (phone stacking)
  const addStacking = await page.evaluate(() => {
    const zOf = id => parseInt(getComputedStyle(document.getElementById(id)).zIndex, 10) || 0;
    const hitIn = id => {
      const el = document.getElementById(id);
      if(!el)return false;
      const hit = document.elementFromPoint(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2));
      return Boolean(hit && el.contains(hit));
    };
    if(typeof closeSheet === 'function'){
      closeSheet('detail-sheet');
      closeSheet('day-logs-sheet');
      closeSheet('add-sheet');
      closeSheet('bulk-batch-sheet');
    }
    openCalendarOverview({range:'recent'});
    document.getElementById('overview-create')?.click();
    const addOpenFromHead = document.getElementById('add-sheet')?.classList.contains('open') || false;
    const addHitTop = hitIn('add-sheet');
    const zOrder = {
      overview: zOf('overview-sheet'),
      week: zOf('week-sheet'),
      add: zOf('add-sheet'),
      bulk: zOf('bulk-batch-sheet'),
      detail: zOf('detail-sheet'),
      settings: zOf('settings-sheet'),
      dayLogs: zOf('day-logs-sheet')
    };
    // Back should close Add sheet first, leaving Overview open
    if(typeof handleAppBack === 'function')handleAppBack();
    const afterBackAddClosed = !document.getElementById('add-sheet')?.classList.contains('open');
    const afterBackOverviewOpen = document.getElementById('overview-sheet')?.classList.contains('open') || false;

    // Open Add from day sheet (Create new item), verify visual topmost layer, save item, verify immediate overview update + detail on top
    const d3 = dateKey(dayStart(Date.now()) + 3 * 86400000);
    resetDayLogsStep();
    renderDayLogs(d3);
    openSheet('day-logs-sheet');
    document.getElementById('day-logs-new-item')?.click();
    const dayAddHitTop = hitIn('add-sheet');
    document.getElementById('ting-message').value = 'Fresh Calendar Task';
    document.getElementById('do-save')?.click();
    const afterSaveAddClosed = !document.getElementById('add-sheet')?.classList.contains('open');
    const afterSaveDetailTop = document.getElementById('detail-sheet')?.classList.contains('open') && hitIn('detail-sheet');
    if(typeof closeSheet === 'function')closeSheet('detail-sheet');
    // Expand coming up if needed and check the new item appears immediately in overview
    const expandBtn = document.querySelector('#overview-list [data-overview-expand]');
    if(expandBtn)expandBtn.click();
    const overviewHasNew = (document.getElementById('overview-list')?.innerText || '').includes('Fresh Calendar Task');
    return {
      addOpenFromHead,
      addHitTop,
      zOrder,
      afterBackAddClosed,
      afterBackOverviewOpen,
      dayAddHitTop,
      afterSaveAddClosed,
      afterSaveDetailTop,
      overviewHasNew
    };
  });
  console.log('addStacking:', addStacking);
  assert(addStacking.addOpenFromHead && addStacking.addHitTop, '+ Add in Calendar Overview paints Add sheet above Overview sheet');
  assert(
    addStacking.zOrder.overview < addStacking.zOrder.week
    && addStacking.zOrder.week < addStacking.zOrder.add
    && addStacking.zOrder.add < addStacking.zOrder.bulk
    && addStacking.zOrder.bulk < addStacking.zOrder.detail
    && addStacking.zOrder.detail < addStacking.zOrder.settings
    && addStacking.zOrder.settings < addStacking.zOrder.dayLogs,
    'sheet z-index tiers stay strictly ordered (overview < week < add < bulk < detail < settings < day-logs)'
  );
  assert(addStacking.afterBackAddClosed && addStacking.afterBackOverviewOpen, 'Back closes Add sheet without dismissing Calendar Overview underneath');
  assert(addStacking.dayAddHitTop && addStacking.afterSaveAddClosed && addStacking.afterSaveDetailTop, 'Create new item paints Add on top, saves cleanly, and opens Detail on top');
  assert(addStacking.overviewHasNew, 'newly added item appears immediately in Calendar Overview');

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
