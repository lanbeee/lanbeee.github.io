// Removed agenda switches cannot disable planning; card presets never replan.
const {chromium} = require('playwright');
const {baseHabit,openEveningSettings,runPlannerPair,minutesOnDay} = require('./helpers/planner-test-helpers');
const assert = require('node:assert/strict');
(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  try{
    await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/',{waitUntil:'networkidle'});
    const now = new Date(); now.setHours(9,0,0,0);
    const day = new Date(now); day.setHours(0,0,0,0);
    const retired = {plansFirst:false,showScheduledTasksInAgenda:false,showDueTasksInAgenda:false,
      showPlannedItemsInAgenda:false,showDueHabitsInAgenda:false};
    const data = [
      baseHabit({hid:'fixed',name:'Fixed appointment',type:'task',dueDate:+day,eventTime:+day+10*3600000}),
      baseHabit({hid:'due',name:'Due task',type:'task',dueDate:+day}),
      baseHabit({hid:'plan',name:'Planned habit',lastLog:+day-86400000,
        logs:[{ts:+day-86400000},{ts:+day+12*3600000,plan:true}]}),
      baseHabit({hid:'ready',name:'Ready habit',target:1}),
      baseHabit({hid:'timed',name:'Timed plan',lastLog:+day-86400000,
        logs:[{ts:+day-86400000},{ts:+day+11*3600000,plan:true,timed:true}]})
    ];
    const settings = openEveningSettings({...retired,blockedTimes:[]});
    const result = await runPlannerPair(page,data,settings,+now,7);
    for(const engine of ['fast','glpk']){
      if(!result[engine])continue;
      assert(!result[engine].error,`${engine}: ${result[engine].error}`);
      for(const name of ['Due task','Planned habit','Ready habit'])
        assert.equal(minutesOnDay(result[engine],0,name),30,`${engine} includes ${name} despite retired false flags`);
      assert.equal(result[engine].days.length,7);
    }
    assert(result.fast);
    if(process.env.HABITS_PLANNER_MODE !== 'fast')assert(result.glpk.optimized,'GLPK executed');
    const checks = await page.evaluate(({retired,data,day})=>{
      localStorage.setItem(SORT_SETTINGS_KEY,JSON.stringify({...sortSettings,...retired}));
      sortSettings = loadSortSettings();
      const loaded = Object.keys(retired).every(key=>!(key in sortSettings));
      saveSortSettings({...sortSettings,...retired});
      const saved = Object.keys(retired).every(key=>!(key in Storage.read(SORT_SETTINGS_KEY)));
      const events = collectScheduledAgendaEvents(data,dateKey(day),retired).map(row=>row.h.name);
      const plannedSignal = planSignal(data[2],{...sortSettings,...retired});
      save(data);
      render({__optimizedWeek:buildWeekAgenda(load(),sortSettings,7)});
      syncSettingsControls();
      const beforeKey = homePlannerDirtyKey(load());
      const beforeWeek = _homeRenderedWeek;
      const original = buildWeekAgendaOffMain;
      let calls = 0;
      buildWeekAgendaOffMain = (...args)=>{ calls++;return original(...args); };
      document.querySelector('[data-card-detail="detailed"]').click();
      const detailed = sortSettings.cardDetailLevel === 'detailed'
        && sortSettings.showDurationOnCards && sortSettings.showLocationOnCards
        && document.querySelector('[data-card-detail="detailed"]').getAttribute('aria-pressed') === 'true';
      const persisted = loadSortSettings().cardDetailLevel === 'detailed';
      document.querySelector('[data-card-detail="simple"]').click();
      const simple = sortSettings.cardDetailLevel === 'simple'
        && !sortSettings.showDurationOnCards && !sortSettings.showLocationOnCards
        && !sortSettings.showDayScheduleOnCards && !sortSettings.showTimeWindowOnCards
        && sortSettings.showEarlyOnCards && $('card-detail-custom').hidden;
      const restrained = !sortSettings.showStatusOnCards && !sortSettings.showFlexibilityOnCards
        && !sortSettings.showOrderPillsOnCards;
      document.querySelector('[data-card-detail="custom"]').click();
      const customShown = !$('card-detail-custom').hidden;
      document.querySelector('[data-setting-toggle="showDayScheduleOnCards"]').click();
      document.querySelector('[data-setting-toggle="showEarlyOnCards"]').click();
      document.querySelector('[data-setting-toggle="showOrderPillsOnCards"]').click();
      const customEdited = sortSettings.cardDetailLevel === 'custom'
        && sortSettings.showDayScheduleOnCards && !sortSettings.showEarlyOnCards
        && sortSettings.showOrderPillsOnCards
        && document.querySelector('[data-setting-toggle="showOrderPillsOnCards"]').getAttribute('aria-pressed') === 'true';
      document.querySelector('[data-card-detail="detailed"]').click();
      const detailedExtras = sortSettings.showDayScheduleOnCards && sortSettings.showTimeWindowOnCards
        && sortSettings.showDurationOnCards && sortSettings.showTopicsOnCards && sortSettings.showLocationOnCards
        && sortSettings.showEarlyOnCards && !sortSettings.showStatusOnCards
        && !sortSettings.showFlexibilityOnCards && !sortSettings.showOrderPillsOnCards
        && $('card-detail-custom').hidden;
      document.querySelector('[data-card-detail="simple"]').click();
      document.querySelector('[data-card-detail="custom"]').click();
      const customRestored = sortSettings.showDayScheduleOnCards && !sortSettings.showEarlyOnCards
        && sortSettings.showOrderPillsOnCards;
      saveSortSettings({...sortSettings,showSampleOnCards:false});
      const sampleAlwaysShown = sortSettings.showSampleOnCards
        && !document.querySelector('[data-setting-toggle="showSampleOnCards"]');
      buildWeekAgendaOffMain = original;
      return {loaded,saved,events,plannedSignal,detailed,persisted,simple,calls,
        restrained,customShown,customEdited,detailedExtras,customRestored,sampleAlwaysShown,
        stable:beforeKey === homePlannerDirtyKey(load()) && beforeWeek === _homeRenderedWeek,
        removed:!document.querySelector('#settings-home-head')
          && Object.keys(retired).every(key=>!document.querySelector(`[data-setting-toggle="${key}"]`)),
        cardToggles:document.querySelectorAll('#settings-cards-body [data-setting-toggle]').length};
    },{retired,data,day:+day});
    assert(checks.loaded && checks.saved && checks.removed,JSON.stringify(checks));
    assert.deepEqual(checks.events,['Fixed appointment','Timed plan']);
    assert(checks.plannedSignal > 0);
    assert(checks.detailed && checks.persisted && checks.simple,JSON.stringify(checks));
    assert(checks.calls === 0 && checks.stable,JSON.stringify(checks));
    assert(checks.restrained && checks.customShown && checks.customEdited && checks.detailedExtras
      && checks.customRestored && checks.sampleAlwaysShown,JSON.stringify(checks));
    assert.equal(checks.cardToggles,20); // activity dots have separate full/minimal controls
    await page.reload({waitUntil:'networkidle'});
    assert(await page.evaluate(()=>sortSettings.cardDetailLevel === 'custom'
      && sortSettings.showDayScheduleOnCards && !sortSettings.showEarlyOnCards
      && sortSettings.showOrderPillsOnCards && sortSettings.showSampleOnCards));
    console.log('PASS: always-on agenda inclusion in both engines, removed settings, and simple display presets');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
