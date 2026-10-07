const assert = require('node:assert/strict');
const {chromium,BASE,FAST_ONLY,baseHabit,openEveningSettings,glpkAvailable} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors = [];
  page.on('pageerror',error=>errors.push(error.message));
  const now = new Date(2026,9,7,8).getTime();
  await page.addInitScript(clock=>{
    const RealDate = Date;
    window.testClock = clock;
    window.Date = class extends RealDate {
      constructor(...args){super(...(args.length ? args : [window.testClock]));}
      static now(){return window.testClock;}
    };
    localStorage.setItem('tings_v2','[]');
    localStorage.setItem('tings_coach_essentials_v2','done');
    localStorage.setItem('tings_coach_install_v2','done');
    localStorage.setItem('tings_app_settings_v2',JSON.stringify({showWeekOnHome:false,agendaOptimizer:false}));
  },now);
  await page.goto(BASE,{waitUntil:'load'});
  const glpkOk = await glpkAvailable(page);
  if(!FAST_ONLY)assert(glpkOk,'GLPK is available for parity checks');
  const settings = openEveningSettings({blockedTimes:[
    {label:'night',days:[],start:0,end:420},{label:'sleep',days:[],start:1320,end:1440}
  ],showWeekOnHome:true,agendaOptimizer:false,minimalMode:false});
  const habit = baseHabit({hid:'repeat',name:'Practice',target:1/3,priority:1,
    durationMinutes:15,createdAt:now-30*86400000,scheduleOptions:[
      {id:'morning',weekdays:[],start:540,end:600,locationId:null,sameDayMode:'alternative'},
      {id:'afternoon',weekdays:[],start:840,end:900,locationId:null,sameDayMode:'separate'},
      {id:'evening',weekdays:[],start:1080,end:1140,locationId:null,sameDayMode:'separate'}
    ]});

  for(const engine of glpkOk ? ['fast','glpk'] : ['fast']){
    const result = await page.evaluate(async({habit,settings,now,engine})=>{
      window.testClock = now;
      localStorage.removeItem(TODAY_SUGGESTED_KEY);
      sortSettings = settings;
      const build = (data,count = 1)=>engine === 'glpk'
        ? buildWeekAgendaAsync(data,{...settings,agendaOptimizer:true},count)
        : buildWeekAgenda(data,settings,count);
      const rows = week=>week.days[0].timeline.filter(row=>row.kind === 'fill');
      const data = normalize([habit]);
      const initial = await build(data);
      const initialRows = rows(initial);
      const after = async(optionId)=>{
        const row = initialRows.find(row=>row.scheduleOptionId === optionId);
        const h = {...data[0],logs:[makeActualLog(now,{occurrenceKey:row.occurrenceKey,
          scheduleOptionId:optionId,scheduledDay:dateKey(now)})],lastLog:now};
        const fresh = rows(await build([h]));
        return {fresh:fresh.map(row=>row.scheduleOptionId),
          cached:agendaRowsAfterCompletions(h,initialRows,now).map(row=>row.scheduleOptionId),
          single:agendaRowsAfterCompletions(h,[initialRows.find(r=>r.scheduleOptionId === 'evening')],now).length};
      };
      const flexible = normalize([{...habit,scheduleOptions:[],allowedTimeStart:540,allowedTimeEnd:1140}]);
      const flexInitial = rows(await build(flexible));
      const first = flexInitial[0];
      const h = {...flexible[0],logs:[makeActualLog(now,{occurrenceKey:first.occurrenceKey,scheduledDay:dateKey(now)})],lastLog:now};
      const flexFresh = rows(await build([h]));
      const last = flexInitial[flexInitial.length - 1];
      const late = {...flexible[0],logs:[makeActualLog(now,{occurrenceKey:last.occurrenceKey,scheduledDay:dateKey(now)})],lastLog:now};
      const outOfOrder = rows(await build([late]));
      const ordinaryHabit = {...flexible[0],logs:[now],lastLog:now};
      const ordinaryFresh = rows(await build([ordinaryHabit]));
      const ordinaryOptions = {...data[0],logs:[now],lastLog:now};
      const coldOptions = rows(await build([ordinaryOptions]));
      const priorDay = dayStart(now)-86400000;
      const catchup = {...flexible[0],logs:[makeActualLog(now,{occurrenceKey:`repeat:${dateKey(priorDay)}:general`,scheduledDay:dateKey(priorDay)})],lastLog:now};
      const weekday = new Date(now).getDay();
      const sparse = normalize([{...habit,target:7/4,scheduleOptions:[
        {...habit.scheduleOptions[0],weekdays:[weekday]},
        {...habit.scheduleOptions[1],weekdays:[weekday]},
        {...habit.scheduleOptions[0],id:'tomorrow',weekdays:[(weekday + 1)%7]},
        {...habit.scheduleOptions[0],id:'next',weekdays:[(weekday + 2)%7]}
      ]}]);
      const sparseWeek = await build(sparse,7);
      const sparseMorning = rows(sparseWeek).find(row=>row.scheduleOptionId === 'morning');
      const sparseLogged = {...sparse[0],logs:[makeActualLog(now,{occurrenceKey:sparseMorning.occurrenceKey,
        scheduleOptionId:'morning',scheduledDay:dateKey(now)})],lastLog:now};
      const sparseFresh = await build([sparseLogged],7);
      const quotaDone = {...data[0],target:0.5,logs:initialRows.slice(0,2).map(row=>makeActualLog(now,{
        occurrenceKey:row.occurrenceKey,scheduleOptionId:row.scheduleOptionId,scheduledDay:dateKey(now)
      })),lastLog:now};
      return {optimized:initial.optimized,initial:initialRows.map(row=>row.scheduleOptionId),
        morning:await after('morning'),afternoon:await after('afternoon'),
        flexible:{initial:flexInitial.length,fresh:flexFresh.length,
          visible:agendaRowsAfterCompletions(h,flexFresh,now).length,
          keys:flexFresh.map(row=>row.occurrenceKey),done:completedToday(h),
          outOfOrder:outOfOrder.map(row=>row.occurrenceKey),
          expectedOrder:flexInitial.slice(0,-1).map(row=>row.occurrenceKey),
          ordinary:agendaRowsAfterCompletions(ordinaryHabit,ordinaryFresh,now).length,
          coldOptions:agendaRowsAfterCompletions(ordinaryOptions,coldOptions,now).map(row=>row.scheduleOptionId),
          catchup:rows(await build([catchup])).length},
        quotaDone:completedToday(quotaDone),
        sparse:{today:rows(sparseFresh).map(row=>row.scheduleOptionId),
          total:sparseFresh.days.reduce((n,day)=>n+day.timeline.filter(row=>row.kind==='fill').length,0)}};
    },{habit,settings,now,engine});
    if(engine === 'glpk')assert(result.optimized,'exact planner produced a usable result');
    assert.deepEqual(result.initial,['morning','afternoon','evening']);
    for(const [done,remaining] of [['morning',['afternoon','evening']],['afternoon',['morning','evening']]]){
      assert.deepEqual(result[done].cached,remaining,`${engine}: cached siblings survive ${done} completion`);
      assert.deepEqual(result[done].fresh,remaining,`${engine}: fresh siblings survive ${done} completion`);
      assert.equal(result[done].single,1,`${engine}: a single remaining keyed sibling survives`);
    }
    assert.equal(result.flexible.initial,3,`${engine}: flexible 3×/day schedules three sessions`);
    assert.equal(result.flexible.fresh,2,`${engine}: two flexible sessions remain after one log`);
    assert.equal(result.flexible.visible,2,`${engine}: fresh flexible rows stay visible`);
    assert.equal(new Set(result.flexible.keys).size,2);
    assert.equal(result.flexible.done,false);
    assert.deepEqual(result.flexible.outOfOrder,result.flexible.expectedOrder,`${engine}: completing the last flexible session leaves the earlier identities`);
    assert.equal(result.flexible.ordinary,2,`${engine}: ordinary logging on a cold open keeps two flexible sessions`);
    assert.deepEqual(result.flexible.coldOptions,['afternoon','evening'],`${engine}: ordinary logging on a cold open keeps named session siblings`);
    assert.equal(result.flexible.catchup,3,`${engine}: a prior-day catch-up does not consume today's three sessions`);
    assert.deepEqual(result.sparse.today,['afternoon'],`${engine}: sparse quota keeps the same-day sibling`);
    assert.equal(result.sparse.total,3,`${engine}: logging one of four weekly sessions leaves three opportunities`);
    assert.equal(result.quotaDone,true,`${engine}: two requested sessions complete the day even with a third optional window`);
    console.log(`  ok: ${engine} repeated-session planning and completion`);
  }

  const missed = await page.evaluate(({habit,settings,now})=>{
    localStorage.removeItem(TODAY_SUGGESTED_KEY);
    window.testClock = now;
    sortSettings = settings;
    const data = normalize([habit]);
    localStorage.setItem('tings_v2',JSON.stringify(data));
    const initial = buildWeekAgenda(data,settings,1);
    _homeRenderedWeek = initial;
    collectDroppedItems(data,settings,['repeat']);
    const at = hour=>{window.testClock = dayStart(now)+hour*3600000;};
    const collect = ()=>{
      const current = load();
      _homeRenderedWeek = buildWeekAgenda(current,settings,1);
      const ids = _homeRenderedWeek.days[0].timeline.some(row=>row.kind === 'fill') ? ['repeat'] : [];
      return collectDroppedItems(current,settings,ids).map(row=>row.scheduleOptionId);
    };
    at(11);const one = collect();
    at(16);const two = collect();
    const evening = initial.days[0].timeline.find(row=>row.scheduleOptionId === 'evening');
    logTing(0,{occurrenceKey:evening.occurrenceKey,scheduleOptionId:'evening',scheduledDay:dateKey(now)});
    const afterEvening = collect();
    const cold = ()=>{_homeRenderedWeek = null;return collectDroppedItems(load(),settings,[]).map(row=>row.scheduleOptionId);};
    const reopened = cold();
    const morning = initial.days[0].timeline.find(row=>row.scheduleOptionId === 'morning');
    logTing(0,{occurrenceKey:morning.occurrenceKey,scheduleOptionId:'morning',scheduledDay:dateKey(now)});
    const afterMorning = collect();
    const duplicate = logTing(0,{occurrenceKey:morning.occurrenceKey});
    executeUndo();
    const undone = collect();
    // Ordinary logging consumes one session, even over a freshly rebuilt plan.
    localStorage.setItem('tings_v2',JSON.stringify([{...data[0],logs:[now],lastLog:now}]));
    const ordinary = collect();
    return {one,two,afterEvening,reopened,afterMorning,duplicate,undone,ordinary};
  },{habit,settings,now});
  assert.deepEqual(missed.one,['morning'],'morning missed while later sessions remain on the agenda');
  assert.deepEqual(missed.two,['morning','afternoon'],'two closed windows count as two misses');
  assert.deepEqual(missed.afterEvening,['morning','afternoon'],'logging evening does not resolve earlier misses');
  assert.deepEqual(missed.reopened,['morning','afternoon'],'miss identities survive reopening');
  assert.deepEqual(missed.afterMorning,['afternoon'],'logging one miss removes only that instance');
  assert.equal(missed.duplicate,false,'the same card cannot complete twice');
  assert.deepEqual(missed.undone,['morning','afternoon'],'undo restores the right session despite identical snapped timestamps');
  assert.deepEqual(missed.ordinary,['afternoon'],'one ordinary log consumes only one occurrence');
  console.log('  ok: one/multiple misses, cold open, ordinary log, duplicate and undo');

  await page.evaluate(({habit,settings,now})=>{
    window.testClock = dayStart(now)+16*3600000;
    // Only the UI adapter is replaced: both real engines were tested above.
    // Browser workers cannot inherit addInitScript's frozen Date.
    buildWeekAgendaOffMain = async(data,settings,numDays,opts)=>buildWeekAgenda(data,settings,numDays,opts);
    sortSettings = settings;
    localStorage.setItem('tings_v2',JSON.stringify(normalize([habit])));
    localStorage.removeItem(TODAY_SUGGESTED_KEY);
    render({__optimizedWeek:buildWeekAgenda(load(),settings,1)});
  },{habit,settings,now});
  assert.equal(await page.locator('.dropped-pill').textContent(),'2 missed');
  await page.locator('.dropped-pill').click();
  await page.locator('#slipped-sheet.open .dropped-item').first().waitFor();
  assert.equal(await page.locator('#slipped-sheet .dropped-item').count(),2);
  await page.locator('#slipped-sheet .dropped-log').first().click();
  assert.equal(await page.locator('#slipped-sheet .dropped-item').count(),1,'one missed sibling remains in the open sheet');
  const ui = await page.evaluate(()=>({
    missed:collectDroppedItems(load(),sortSettings,['repeat']).map(row=>row.scheduleOptionId),
    log:normalizeLogs(load()[0].logs).find(log=>!isPlanLog(log)),
    active:agendaRowsAfterCompletions(load()[0],_homeRenderedWeek.days[0].timeline.filter(row=>row.kind==='fill'),Date.now()).map(row=>row.scheduleOptionId)
  }));
  assert.deepEqual(ui.missed,['afternoon']);
  assert.equal(ui.log.scheduleOptionId,'morning','missed button carries session metadata');
  assert.deepEqual(ui.active,['evening'],'evening remains after logging a missed morning');
  await page.evaluate(()=>closeSheet('slipped-sheet'));
  await page.locator('.swipe-row[data-schedule-option-id="evening"] .pulse-btn').first().click();
  await page.waitForFunction(()=>normalizeLogs(load()[0].logs).filter(log=>!isPlanLog(log)).length === 2);
  const afterCard = await page.evaluate(()=>({
    missed:collectDroppedItems(load(),sortSettings,[]).map(row=>row.scheduleOptionId),
    logged:normalizeLogs(load()[0].logs).map(log=>log.scheduleOptionId)
  }));
  assert.deepEqual(afterCard.logged,['morning','evening'],'agenda pulse logs only the selected session');
  assert.deepEqual(afterCard.missed,['afternoon'],'agenda pulse leaves the missed sibling actionable');
  await page.evaluate(({habit,settings,now})=>{
    window.testClock = now;
    sortSettings = {...settings,showWeekOnHome:false};
    localStorage.setItem('tings_v2',JSON.stringify(normalize([habit])));
    localStorage.removeItem(TODAY_SUGGESTED_KEY);
    render({__optimizerFallback:true});
  },{habit,settings,now});
  assert.equal(await page.locator('.swipe-row[data-occurrence-key]').count(),3,'classic Home renders each daily session');
  assert.deepEqual(errors,[]);
  console.log('  ok: missed-sheet UI retains siblings and the future agenda');
  await browser.close();
})().catch(error=>{console.error(error);process.exit(1);});
