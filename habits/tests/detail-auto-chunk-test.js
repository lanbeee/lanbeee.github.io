/**
 * Detail refinement + breakable agenda auto-log regression.
 * Run: HABITS_URL=http://127.0.0.1:4182/ node tests/detail-auto-chunk-test.js
 */
const { chromium } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4182/';
let passed = 0;
function ok(value,message){
  if(!value)throw new Error(message);
  passed += 1;
  console.log(`  ok ${message}`);
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:667},isMobile:true,hasTouch:true});
  const pageErrors = [];
  page.on('pageerror',error=>pageErrors.push(error.message));
  await page.goto(BASE,{waitUntil:'domcontentloaded'});
  await page.evaluate(()=>{
    const now = Date.now();
    localStorage.clear();
    localStorage.setItem('tings_v2',JSON.stringify([{
      hid:'auto-breakable-test',name:'Research report',type:'task',target:null,
      durationMinutes:120,breakable:true,minChunkMinutes:30,autoMarkMinutes:10,
      timerAutoStopMinutes:null,trackValue:false,flexibilityDays:0,priority:1,
      dueDate:null,eventTime:null,hardDue:false,logs:[],lastLog:null,createdAt:now,
      emoji:'',pinned:false,sample:false,snoozedUntil:null,topics:[],
      locationIds:['home'],locationPrefs:{},preferredLocationId:null,
      allowedWeekdays:[],allowedMonthDays:[],preferredWeekdays:[],preferredMonthDays:[],
      allowedTimeStartAnchor:'fajr',allowedTimeStartOffsetMin:0,
      allowedTimeStartCombine:'later',allowedTimeStartAnchor2:'sunrise',allowedTimeStartOffsetMin2:-30,
      allowedTimeEndAnchor:'asr',allowedTimeEndOffsetMin:0,
      allowedTimeEndCombine:'earlier',allowedTimeEndAnchor2:'maghrib',allowedTimeEndOffsetMin2:-20
    }]));
    localStorage.setItem('tings_app_settings_v2',JSON.stringify({
      preset:'alpha',showWeekOnHome:false,showScheduledTasksInAgenda:true,
      showDueTasksInAgenda:true,showPlannedItemsInAgenda:true,showDueHabitsInAgenda:true,
      availabilityMinutes:[720,720,720,720,720,720,720],blockedTimes:[],
      locations:[{id:'home',name:'Home',lat:40.7128,lng:-74.006,radiusM:75}],
      lastKnownLocationId:'home',agendaOptimizer:false
    }));
  });
  await page.reload({waitUntil:'networkidle'});

  await page.evaluate(()=>openDetail(0));
  await page.waitForSelector('#detail-sheet.open');
  ok(await page.locator('.detail-page-tab').count() === 6,'detail exposes six labeled page tabs');
  ok(await page.locator('.detail-page-tab').allTextContents().then(items=>items.join('|')) === 'calendar|insight|schedule|effort|identity|actions','page tabs name every pane');
  const compactShell = await page.evaluate(()=>{
    const head = document.querySelector('.detail-head').getBoundingClientRect();
    const pager = document.querySelector('.detail-pager').getBoundingClientRect();
    const bar = document.querySelector('.detail-bottom-bar').getBoundingClientRect();
    const done = document.querySelector('#detail-cool').getBoundingClientRect();
    const tab = document.querySelector('.detail-page-tab').getBoundingClientRect();
    return {
      head:head.height,pager:pager.height,bar:bar.height,done:done.width,tab:tab.width,
      viewport:innerHeight,overlap:Math.max(0,pager.bottom - bar.top),overflow:document.body.scrollWidth - innerWidth
    };
  });
  ok(compactShell.head <= 64 && compactShell.pager >= compactShell.viewport * 0.68,'compact header leaves most of the short viewport to pane content');
  ok(compactShell.bar <= 50 && compactShell.overlap <= 0 && compactShell.overflow <= 0,'integrated bottom dock does not overlap content or overflow');
  ok(compactShell.done >= compactShell.tab * 1.8,'done remains substantially larger than a pane shortcut');
  const dirtyDock = await page.evaluate(()=>{
    setDetailDirty(true);
    const save = document.querySelector('#detail-save').getBoundingClientRect();
    const cancel = document.querySelector('#detail-close').getBoundingClientRect();
    const visible = save.width > 0 && save.height > 0 && cancel.width > 0 && cancel.height > 0;
    setDetailDirty(false);
    return {visible,width:save.width + cancel.width};
  });
  ok(dirtyDock.visible && dirtyDock.width <= 148,'save and cancel fit the same compact dock when editing');
  ok((await page.locator('#detail-auto-mark-label').textContent()) === 'auto-log agenda chunks','breakable auto-mark is named as chunk logging');
  ok((await page.locator('#detail-auto-mark-summary').textContent()).includes('Manual taps count first'),'auto-log summary explains manual reconciliation');

  await page.locator('.detail-page-tab[data-detail-page="2"]').click();
  await page.waitForTimeout(300);
  const scheduleLayout = await page.evaluate(()=>{
    const row = document.querySelector('#detail-allowed-time-row');
    const endpoints = [...row.querySelectorAll(':scope > .time-endpoint')];
    const first = endpoints[0].getBoundingClientRect();
    const second = endpoints[1].getBoundingClientRect();
    const active = document.querySelector('.detail-page-tab.on');
    return {
      display:getComputedStyle(row).display,
      stacked:second.top > first.bottom - 2,
      active:active && active.textContent.trim()
    };
  });
  ok(scheduleLayout.display === 'grid' && scheduleLayout.stacked,'start and end editors are clearly stacked');
  ok(scheduleLayout.active === 'schedule','schedule tab follows pager position');
  ok(await page.locator('#detail-allowed-time-row .time-expr2').count() === 2,'both comparisons retain their second expressions');
  ok(await page.locator('#detail-allowed-time-row .time-resolved').evaluateAll(nodes=>nodes.every(node=>node.textContent.trim().length > 0)),'dynamic endpoints show resolved results');

  // Create a snapshot in the past, reload as if the app had been closed, then
  // sweep at each deadline. The live agenda is empty because this is a someday
  // task, so only the explicitly captured rows can produce progress.
  const captured = await page.evaluate(()=>{
    localStorage.removeItem(AUTO_CHUNK_PLAN_KEY);
    const data = load();
    const now = Date.now();
    const captureAt = now - 3 * 60 * 60000;
    const firstStart = captureAt + 5 * 60000;
    const firstEnd = firstStart + 60 * 60000;
    const secondStart = firstEnd + 15 * 60000;
    const secondEnd = secondStart + 60 * 60000;
    const week = {days:[{dayBase:dayStart(captureAt),timeline:[
      {kind:'fill',i:0,h:data[0],start:firstStart,end:firstEnd,chunkMinutes:60,chunkIndex:0},
      {kind:'fill',i:0,h:data[0],start:secondStart,end:secondEnd,chunkMinutes:60,chunkIndex:1}
    ]}]};
    syncAutoMarkChunkPlans(data,week,captureAt);
    // Keep the real cold-open sweep from consuming the staged rows. Restore
    // the intended 10-minute delay immediately after reload, then step the
    // synthetic deadlines explicitly below.
    data[0].autoMarkMinutes = 10000;
    save(data);
    return {firstDue:firstEnd + 10 * 60000,secondDue:secondEnd + 10 * 60000};
  });
  await page.reload({waitUntil:'networkidle'});

  const firstSweep = await page.evaluate(times=>{
    const data = load();
    data[0].autoMarkMinutes = 10;
    save(data);
    const before = sweepAutoMarkedBreakableChunks(times.firstDue - 1,{refresh:false,toast:false});
    const at = sweepAutoMarkedBreakableChunks(times.firstDue,{refresh:false,toast:false});
    return {before,at,progress:breakableProgressMinutes(load()[0])};
  },captured);
  ok(firstSweep.before === 0,'chunk is not credited before its end plus delay');
  ok(firstSweep.at === 1 && firstSweep.progress === 60,'first due chunk advances progress by its planned minutes');

  const finalSweep = await page.evaluate(times=>{
    const data = load();
    data[0].logs = normalizeLogs([...data[0].logs,makeActualLog(Date.now(),{minutes:20,note:'manual tap'})]);
    data[0].lastLog = latestActualLog(data[0].logs);
    save(data);
    const credited = sweepAutoMarkedBreakableChunks(times.secondDue,{refresh:false,toast:false});
    const h = load()[0];
    const minuteLogs = normalizeLogs(h.logs).filter(log=>logMinutes(log) !== null).map(log=>({minutes:logMinutes(log),note:logNote(log)}));
    const repeat = sweepAutoMarkedBreakableChunks(times.secondDue + 60000,{refresh:false,toast:false});
    return {credited,repeat,progress:breakableProgressMinutes(h),minuteLogs};
  },captured);
  ok(finalSweep.credited === 1 && finalSweep.progress === 120,'second chunk adds only progress not already logged manually');
  ok(finalSweep.minuteLogs.map(log=>log.minutes).sort((a,b)=>a-b).join(',') === '20,40,60'
    && finalSweep.minuteLogs.some(log=>log.minutes === 40 && log.note === 'agenda auto-log'),
  'automatic reconciliation records 40m after the manual 20m');
  ok(finalSweep.repeat === 0,'reopening or sweeping again cannot double-log a chunk');

  const scheduledPolicy = await page.evaluate(()=>{
    localStorage.removeItem(AUTO_CHUNK_PLAN_KEY);
    const data = load();
    const h = data[0];
    h.logs = [];
    h.lastLog = null;
    h.autoMarkMinutes = 0;
    h.dueDate = dayStart(Date.now()) - 86400000;
    save(data);
    const withoutShownPlan = sweepAutoDoneTasks();
    const stillManual = breakableProgressMinutes(load()[0]);

    const fresh = load();
    const now = Date.now();
    const start = now - 90 * 60000;
    const end = start + 120 * 60000;
    syncAutoMarkChunkPlans(fresh,{days:[{dayBase:dayStart(now),timeline:[{
      kind:'scheduled',i:0,h:fresh[0],start,end
    }]}]},start - 60000);
    const credited = sweepAutoMarkedBreakableChunks(end,{refresh:false,toast:false});
    return {withoutShownPlan,stillManual,credited,progress:breakableProgressMinutes(load()[0])};
  });
  ok(scheduledPolicy.withoutShownPlan === 0 && scheduledPolicy.stillManual === 0,'cold open never invents breakable work that was not shown');
  ok(scheduledPolicy.credited === 1 && scheduledPolicy.progress === 120,'fixed scheduled breakable session auto-logs at its end');
  ok(pageErrors.length === 0,`no page errors (${pageErrors.join('; ')})`);

  console.log(`\n${passed} passed, 0 failed`);
  await browser.close();
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
