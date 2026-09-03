// Habit-level time/place alternatives. A single occurrence may expose several
// rows, including repeated locations at different times; both planner engines
// must choose one feasible row rather than creating several completions.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/habit-schedule-options-test.js
const {
  chromium, BASE, atTime, baseHabit:base, glpkAvailable
} = require('./helpers/planner-test-helpers');

let pass = 0, fail = 0;
function assert(cond,msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

function location(id,name,hoursByDay = {}){
  return {id,name,address:'',lat:40,lng:-74,radiusM:75,emoji:'',
    allowedTimeStart:null,allowedTimeEnd:null,preferredTimeStart:null,preferredTimeEnd:null,
    closedDays:[],hoursByDay};
}

function settings(locations,blockedTimes = []){
  return {
    preset:'todayFirst',agendaOptimizer:true,focus:'balanced',showWeekOnHome:true,
    availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440],availabilityOverrides:{},
    showScheduledTasksInAgenda:true,showDueTasksInAgenda:true,
    showPlannedItemsInAgenda:true,showDueHabitsInAgenda:true,
    locations,travel:{},defaultTravelMode:'walking',blockedTimes
  };
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors = [];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(BASE,{waitUntil:'networkidle'});
  const glpkOk = await glpkAvailable(page);

  async function runPair(data,plannerSettings,now,numDays = 2){
    return page.evaluate(async ({data,plannerSettings,now,numDays})=>{
      const RealDate = Date;
      function FrozenDate(...args){ return args.length ? new RealDate(...args) : new RealDate(now); }
      FrozenDate.now = ()=>now;
      FrozenDate.parse = RealDate.parse;
      FrozenDate.UTC = RealDate.UTC;
      Object.setPrototypeOf(FrozenDate,RealDate);
      FrozenDate.prototype = RealDate.prototype;
      globalThis.Date = FrozenDate;
      const previousSettings = sortSettings;
      sortSettings = plannerSettings;
      const summarize = week=>(week.days || []).map(day=>(day.timeline || [])
        .filter(row=>row.kind === 'fill')
        .map(row=>({name:row.h.name,start:new RealDate(row.start).getHours() * 60 + new RealDate(row.start).getMinutes(),locationId:row.locationId || null})));
      try{
        let glpk;
        try{ glpk = summarize(await buildWeekAgendaAsync(data,{...plannerSettings,agendaOptimizer:true},numDays)); }
        catch(error){ glpk = {error:String(error && error.message || error)}; }
        let fast;
        try{ fast = summarize(buildWeekAgenda(data,{...plannerSettings,agendaOptimizer:false},numDays)); }
        catch(error){ fast = {error:String(error && error.message || error)}; }
        return {glpk,fast};
      }finally{
        globalThis.Date = RealDate;
        sortSettings = previousSettings;
      }
    },{data,plannerSettings,now,numDays});
  }

  const now = atTime(8);
  const campus = location('campus','Campus');
  const downtown = location('downtown','Downtown');

  console.log('\n[1] same location, different times');
  {
    const habit = base({
      hid:'same-place',name:'Class',target:1,priority:0,durationMinutes:45,
      anywhereAllowed:false,locationIds:['campus'],
      scheduleOptions:[
        {weekdays:[],start:540,end:600,locationId:'campus'},
        {weekdays:[],start:900,end:960,locationId:'campus'}
      ]
    });
    const result = await runPair([habit],settings([campus],[{label:'morning',days:[],start:0,end:840}]),now,1);
    for(const [engine,days] of [['glpk',result.glpk],['fast',result.fast]]){
      if(engine === 'glpk' && !glpkOk){ console.log('  skip glpk (unavailable)'); continue; }
      assert(!days.error,`${engine}: planner builds`);
      assert(days[0]?.length === 1,`${engine}: alternatives create one occurrence`);
      assert(days[0]?.[0]?.start === 900,`${engine}: later option at same place is selected`);
      assert(days[0]?.[0]?.locationId === 'campus',`${engine}: repeated place is retained`);
    }
  }

  console.log('\n[2] same time, different locations');
  {
    const weekday = new Date(now).getDay();
    const closedCampus = location('campus','Campus',{[weekday]:null});
    const habit = base({
      hid:'two-places',name:'Prayer',target:1,priority:0,durationMinutes:30,
      anywhereAllowed:false,locationIds:['campus','downtown'],
      scheduleOptions:[
        {weekdays:[],start:660,end:720,locationId:'campus'},
        {weekdays:[],start:660,end:720,locationId:'downtown'}
      ]
    });
    const result = await runPair([habit],settings([closedCampus,downtown]),now,1);
    for(const [engine,days] of [['glpk',result.glpk],['fast',result.fast]]){
      if(engine === 'glpk' && !glpkOk)continue;
      assert(days[0]?.length === 1,`${engine}: one of two places is chosen`);
      assert(days[0]?.[0]?.locationId === 'downtown',`${engine}: closed-place option is rejected`);
    }
  }

  console.log('\n[3] option weekdays gate eligibility when there is no general window');
  {
    const today = new Date(now).getDay();
    const tomorrow = (today + 1) % 7;
    const habit = base({
      hid:'weekday-option',name:'Seminar',target:1,priority:0,durationMinutes:30,
      allowedWeekdays:[],allowedTimeStart:null,allowedTimeEnd:null,
      anywhereAllowed:false,locationIds:[],
      scheduleOptions:[{weekdays:[tomorrow],start:600,end:660,locationId:'campus'}]
    });
    const result = await runPair([habit],settings([campus]),now,2);
    for(const [engine,days] of [['glpk',result.glpk],['fast',result.fast]]){
      if(engine === 'glpk' && !glpkOk)continue;
      assert(days[0]?.length === 0,`${engine}: no option means not eligible today`);
      assert(days[1]?.length === 1 && days[1][0].start === 600,`${engine}: option is eligible tomorrow`);
    }
  }

  console.log('\n[4] preferred settings rank valid alternatives');
  {
    const preferredPlace = base({
      hid:'preferred-place',name:'Preferred mosque',target:1,priority:0,durationMinutes:30,
      anywhereAllowed:false,locationIds:['campus','downtown'],
      locationPrefs:{campus:'avoid',downtown:'high'},preferredLocationId:'downtown',
      scheduleOptions:[
        {weekdays:[],start:660,end:720,locationId:'campus'},
        {weekdays:[],start:660,end:720,locationId:'downtown'}
      ]
    });
    const preferredTime = base({
      hid:'preferred-time',name:'Preferred class',target:1,priority:0,durationMinutes:30,
      anywhereAllowed:false,locationIds:['campus'],
      preferredTimeStart:900,preferredTimeEnd:960,
      scheduleOptions:[
        {weekdays:[],start:540,end:600,locationId:'campus'},
        {weekdays:[],start:900,end:960,locationId:'campus'}
      ]
    });
    for(const [habit,expectedStart,expectedLocation,label] of [
      [preferredPlace,660,'downtown','place preference'],
      [preferredTime,900,'campus','time preference']
    ]){
      const result = await runPair([habit],settings([campus,downtown]),now,1);
      for(const [engine,days] of [['glpk',result.glpk],['fast',result.fast]]){
        if(engine === 'glpk' && !glpkOk)continue;
        assert(days[0]?.[0]?.start === expectedStart && days[0]?.[0]?.locationId === expectedLocation,`${engine}: ${label} ranks the valid options`);
      }
    }
  }

  console.log('\n[5] normalization keeps repeated locations');
  const normalized = await page.evaluate(()=>normalizeHabitScheduleOptions([
    {weekdays:[1],start:540,end:600,locationId:'same'},
    {weekdays:[1],start:780,end:840,locationId:'same'},
    {weekdays:[1],start:780,end:840,locationId:'same'}
  ]));
  assert(normalized.length === 2,'same location is allowed in distinct time rows');
  assert(normalized[0].locationId === 'same' && normalized[1].locationId === 'same','both repeated-location rows survive');

  console.log('\n[5b] normalization preserves dynamic option expressions');
  const dynamicNormalized = await page.evaluate(()=>normalizeHabitScheduleOptions([{
    weekdays:[2],start:null,startAnchor:'dhuhr',startOffsetMin:15,
    startCombine:'later',startAnchor2:'fixed',startFixedMin2:780,
    end:null,endAnchor:'asr',endOffsetMin:-10,endDayOffset:1,
    locationId:'same',pref:'little'
  }])[0]);
  assert(dynamicNormalized.start === null && dynamicNormalized.startAnchor === 'dhuhr','dynamic start anchor is canonical');
  assert(dynamicNormalized.startCombine === 'later' && dynamicNormalized.startAnchor2 === 'fixed' && dynamicNormalized.startFixedMin2 === 780,'combined dynamic start is preserved');
  assert(dynamicNormalized.endAnchor === 'asr' && dynamicNormalized.endOffsetMin === -10 && dynamicNormalized.endDayOffset === 1,'dynamic end offset and next-day flag are preserved');

  console.log('\n[5c] both planners resolve a dynamic specific row');
  {
    const habit = base({
      hid:'dynamic-option',name:'Dhuhr visit',target:1,priority:0,durationMinutes:30,
      anywhereAllowed:false,locationIds:['campus'],
      allowedWeekdays:[],allowedTimeStart:null,allowedTimeEnd:null,
      scheduleOptions:[{
        weekdays:[],start:null,startAnchor:'dhuhr',startOffsetMin:15,
        end:null,endAnchor:'dhuhr',endOffsetMin:75,locationId:'campus'
      }]
    });
    const plannerSettings = settings([campus]);
    const expected = await page.evaluate(({habit,plannerSettings,now})=>{
      const previous = sortSettings;
      sortSettings = plannerSettings;
      try{
        const bound = habitBoundToScheduleOption(habit,habit.scheduleOptions[0]);
        return Math.round(resolveHabitTimeField(bound,'allowedTimeStart',dayStart(now),'campus'));
      }finally{ sortSettings = previous; }
    },{habit,plannerSettings,now});
    const result = await runPair([habit],plannerSettings,now,1);
    for(const [engine,days] of [['glpk',result.glpk],['fast',result.fast]]){
      if(engine === 'glpk' && !glpkOk)continue;
      assert(days[0]?.length === 1,`${engine}: dynamic specific row places one occurrence`);
      assert(Math.abs(days[0]?.[0]?.start - expected) <= 1,`${engine}: dynamic row resolves at Dhuhr +15`);
      assert(days[0]?.[0]?.locationId === 'campus',`${engine}: dynamic row stays at its specific place`);
    }
  }

  console.log('\n[6] general schedule is kept beside specific options');
  const {canonical,canonicalDays,optionsOnly} = await page.evaluate(()=>{
    const item = normalize([{
      hid:'canonical-options',name:'Canonical',type:'keepup',target:1,logs:[],
      locationIds:['home'],anywhereAllowed:false,
      allowedWeekdays:[1],allowedMonthDays:[],allowedTimeStart:540,allowedTimeEnd:1020,
      locationPrefs:{campus:'high',home:'little'},preferredLocationId:'campus',
      scheduleOptions:[
        {weekdays:[2],start:540,end:600,locationId:'campus'},
        {weekdays:[4],start:780,end:840,locationId:'campus',pref:'high'}
      ]
    }])[0];
    const only = normalize([{
      hid:'options-only',name:'Options only',type:'keepup',target:1,logs:[],
      locationIds:['campus'],anywhereAllowed:false,
      allowedWeekdays:[],allowedTimeStart:null,allowedTimeEnd:null,
      scheduleOptions:[
        {weekdays:[2],start:540,end:600,locationId:'campus'},
        {weekdays:[4],start:780,end:840,locationId:'campus'}
      ]
    }])[0];
    return {
      canonical:item,
      canonicalDays:scheduledDays(item),
      optionsOnly:{
        hasGeneral:hasGeneralAllowedSchedule(only),
        days:scheduledDays(only)
      }
    };
  });
  assert(canonical.allowedWeekdays.length === 1 && canonical.allowedTimeStart === 540,'combined mode keeps the general allowed time');
  assert(JSON.stringify(canonical.locationIds) === JSON.stringify(['home']),'general allowed places stay independent of option places');
  assert(canonical.locationPrefs.campus === 'high' && canonical.locationPrefs.home === 'little','preferences are kept for general and option places');
  assert(canonical.scheduleOptions[1].pref === 'high','option preference is preserved');
  assert(JSON.stringify(canonicalDays.weekdays) === JSON.stringify([1,2,4]),'scheduled days are the union of general and option days');
  assert(optionsOnly.hasGeneral === false,'matching derived places do not invent a general window');
  assert(JSON.stringify(optionsOnly.days.weekdays) === JSON.stringify([2,4]),'options-only days come from the rows');

  console.log('\n[7] general window and specific option are both valid');
  {
    const habit = base({
      hid:'combined',name:'Study',target:1,priority:0,durationMinutes:30,
      anywhereAllowed:false,locationIds:['campus'],
      allowedTimeStart:540,allowedTimeEnd:600,
      locationPrefs:{campus:'little'},
      scheduleOptions:[{weekdays:[],start:780,end:840,locationId:'downtown',pref:'high'}]
    });
    const afternoonClosed = await runPair([habit],settings([campus,downtown],[{label:'afternoon',days:[],start:720,end:1440}]),now,1);
    const morningClosed = await runPair([habit],settings([campus,downtown],[{label:'morning',days:[],start:0,end:720}]),now,1);
    for(const [engine,days] of [['glpk',afternoonClosed.glpk],['fast',afternoonClosed.fast]]){
      if(engine === 'glpk' && !glpkOk)continue;
      assert(days[0]?.[0]?.start === 540 && days[0]?.[0]?.locationId === 'campus',`${engine}: general morning window still places`);
    }
    for(const [engine,days] of [['glpk',morningClosed.glpk],['fast',morningClosed.fast]]){
      if(engine === 'glpk' && !glpkOk)continue;
      assert(days[0]?.[0]?.start === 780 && days[0]?.[0]?.locationId === 'downtown',`${engine}: specific afternoon option is extra allowed time`);
    }
  }

  console.log('\n[8] option preference overrides the place ranking');
  {
    const habit = base({
      hid:'pref-override',name:'Prayer',target:1,priority:0,durationMinutes:30,
      anywhereAllowed:false,locationIds:['campus'],
      allowedTimeStart:660,allowedTimeEnd:720,
      locationPrefs:{campus:'avoid',downtown:'avoid'},
      scheduleOptions:[{weekdays:[],start:660,end:720,locationId:'downtown',pref:'high'}]
    });
    const result = await runPair([habit],settings([campus,downtown]),now,1);
    for(const [engine,days] of [['glpk',result.glpk],['fast',result.fast]]){
      if(engine === 'glpk' && !glpkOk)continue;
      assert(days[0]?.[0]?.locationId === 'downtown',`${engine}: instance preference beats the avoided place ranking`);
      assert(days[0]?.[0]?.start === 660,`${engine}: overlapping general and specific windows stay one occurrence`);
    }
  }

  console.log('\n[9] detail editor keeps general time and adds specific rows');
  await page.evaluate(({habit,plannerSettings})=>{
    localStorage.setItem('tings_v2',JSON.stringify([habit]));
    localStorage.setItem('tings_app_settings_v2',JSON.stringify({...plannerSettings,minimalMode:false}));
  },{
    habit:base({hid:'ui-options',name:'UI options',locationIds:['campus'],anywhereAllowed:false}),
    plannerSettings:{...settings([campus]),topics:['study']}
  });
  await page.reload({waitUntil:'networkidle'});
  await page.evaluate(()=>openDetail(0));
  assert(await page.locator('[data-detail-nav="schedule"] #detail-place-chips').count() === 1,'place choices live in the schedule pane');
  assert(await page.locator('[data-detail-nav="identity"] #detail-topic-chips').count() === 1,'topic choices live in the identity pane');
  await page.evaluate(()=>scrollDetailToNav('identity'));
  await page.waitForTimeout(250);
  await page.locator('#detail-topic-chips [data-topic="study"]').click();
  assert(await page.locator('#detail-topic-chips [data-topic="study"]').getAttribute('class').then(value=>value.includes('on')),'topic can be selected in Identity');
  await page.evaluate(()=>scrollDetailToNav('schedule'));
  await page.waitForTimeout(250);
  await page.locator('[data-schedule-view="preferred"]').click();
  assert(await page.locator('#detail-places-label').textContent() === 'place preferences','preferred schedule view labels place rankings');
  assert(!(await page.locator('#detail-place-chips [data-location-add]').isVisible()),'preferred schedule view cannot add a second allowed-place control');
  await page.locator('[data-schedule-view="allowed"]').click();
  assert(await page.locator('#detail-places-label').textContent() === 'places','allowed schedule view owns valid places');
  assert(await page.locator('#detail-place-chips [data-location-add]').isVisible(),'allowed schedule view exposes the place picker');
  await page.locator('#detail-time-start').fill('08:00');
  await page.locator('#detail-time-end').fill('18:00');
  await page.locator('#detail-habit-option-add').click();
  await page.locator('#detail-habit-option-add').click();
  await page.locator('.habit-option-location').nth(0).selectOption('campus');
  await page.locator('.habit-option-location').nth(1).selectOption('campus');
  await page.locator('.habit-option-start').nth(0).fill('09:00');
  await page.locator('.habit-option-end').nth(0).fill('10:00');
  await page.locator('.habit-option-start').nth(1).fill('13:00');
  await page.locator('.habit-option-end').nth(1).fill('14:00');
  const dynamicRow = page.locator('.habit-option-row').nth(1);
  await dynamicRow.locator('.time-endpoint[data-field="start"] [data-time-mode="relative"]').click();
  await dynamicRow.locator('.time-endpoint[data-field="start"] .time-anchor').selectOption('dhuhr');
  await dynamicRow.locator('.time-endpoint[data-field="start"] .time-offset').fill('15');
  await dynamicRow.locator('.time-endpoint[data-field="end"] [data-time-mode="relative"]').click();
  await dynamicRow.locator('.time-endpoint[data-field="end"] .time-anchor').selectOption('dhuhr');
  await dynamicRow.locator('.time-endpoint[data-field="end"] .time-offset').fill('75');
  await page.locator('.habit-option-pref').nth(1).click();
  await page.locator('.habit-option-pref').nth(1).click();
  assert(await page.locator('#detail-simple-allowed-fields').isVisible(),'general allowed time stays visible with specific rows');
  assert(await page.locator('#detail-habit-option-add').textContent() === 'add option','option action adds another specific row');
  assert(await page.locator('#detail-place-chips .tag-row-topics').isHidden(),'schedule does not duplicate topic choices');
  assert(await page.locator('#detail-topic-chips .tag-row-places').isHidden(),'identity does not duplicate place choices');
  assert(await page.locator('#detail-place-chips [data-location-add]').isVisible(),'allowed-place picker stays available with specific rows');
  assert(await page.locator('#detail-place-chips [data-anywhere]').isVisible(),'anywhere control stays available with specific rows');
  assert(await page.locator('.habit-option-pref').nth(1).getAttribute('data-pref') === 'high','option preference can be set on the row');
  assert(await dynamicRow.locator('.time-endpoint.is-dynamic').count() === 2,'specific row supports dynamic start and end editors');
  assert((await dynamicRow.locator('.time-resolved').first().textContent()).trim().length > 0,'dynamic specific row shows a resolved-time preview');
  const dynamicLayout = await dynamicRow.evaluate(row=>({
    clientWidth:row.clientWidth,
    scrollWidth:row.scrollWidth,
    controls:[...row.querySelectorAll('input,select,button')].map(control=>{
      const box = control.getBoundingClientRect();
      if(box.width === 0 || box.height === 0)return null;
      const rowBox = row.getBoundingClientRect();
      return {
        label:control.getAttribute('aria-label') || control.className,
        left:Math.round(box.left - rowBox.left),
        right:Math.round(box.right - rowBox.right)
      };
    }).filter(Boolean)
  }));
  const controlsInside = dynamicLayout.controls.every(box=>box.left >= -1 && box.right <= 1);
  const dynamicLayoutOk = dynamicLayout.scrollWidth <= dynamicLayout.clientWidth + 1 && controlsInside;
  assert(dynamicLayoutOk,dynamicLayoutOk
    ? 'dynamic row stays within the compact-phone card'
    : `dynamic row stays within the compact-phone card (${JSON.stringify(dynamicLayout)})`);
  await page.locator('#detail-save').click();
  const saved = await page.evaluate(()=>load()[0]);
  assert(saved.scheduleOptions.length === 2,'editor saves two alternatives');
  assert(saved.scheduleOptions.every(option=>option.locationId === 'campus'),'editor permits the same saved place twice');
  assert(saved.scheduleOptions[0].start === 540 && saved.scheduleOptions[1].start === null,'editor preserves fixed and dynamic option times');
  assert(saved.scheduleOptions[1].startAnchor === 'dhuhr' && saved.scheduleOptions[1].startOffsetMin === 15,'editor saves the dynamic option start');
  assert(saved.scheduleOptions[1].endAnchor === 'dhuhr' && saved.scheduleOptions[1].endOffsetMin === 75,'editor saves the dynamic option end');
  assert(saved.scheduleOptions[1].pref === 'high','editor saves the instance preference');
  assert(saved.allowedTimeStart === 480 && saved.allowedTimeEnd === 1080,'save keeps the general allowed time');
  assert(JSON.stringify(saved.locationIds) === JSON.stringify(['campus']) && saved.anywhereAllowed === false,'save keeps the general allowed place');
  assert(JSON.stringify(saved.topics) === JSON.stringify(['study']),'save keeps the topic selected in Identity');

  assert(errors.length === 0,`no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if(fail)process.exit(1);
})().catch(error=>{ console.error(error); process.exit(1); });
