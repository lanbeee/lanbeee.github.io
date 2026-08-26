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
      }finally{ globalThis.Date = RealDate; }
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

  console.log('\n[3] option weekdays gate eligibility');
  {
    const today = new Date(now).getDay();
    const tomorrow = (today + 1) % 7;
    const habit = base({
      hid:'weekday-option',name:'Seminar',target:1,priority:0,durationMinutes:30,
      anywhereAllowed:false,locationIds:['campus'],
      scheduleOptions:[{weekdays:[tomorrow],start:600,end:660,locationId:'campus'}]
    });
    const result = await runPair([habit],settings([campus]),now,2);
    for(const [engine,days] of [['glpk',result.glpk],['fast',result.fast]]){
      if(engine === 'glpk' && !glpkOk)continue;
      assert(days[0]?.length === 0,`${engine}: no option means not eligible today`);
      assert(days[1]?.length === 1 && days[1][0].start === 600,`${engine}: option is eligible tomorrow`);
    }
  }

  console.log('\n[4] normalization keeps repeated locations');
  const normalized = await page.evaluate(()=>normalizeHabitScheduleOptions([
    {weekdays:[1],start:540,end:600,locationId:'same'},
    {weekdays:[1],start:780,end:840,locationId:'same'},
    {weekdays:[1],start:780,end:840,locationId:'same'}
  ]));
  assert(normalized.length === 2,'same location is allowed in distinct time rows');
  assert(normalized[0].locationId === 'same' && normalized[1].locationId === 'same','both repeated-location rows survive');

  console.log('\n[5] detail editor persists repeated-place rows');
  await page.evaluate(({habit,plannerSettings})=>{
    localStorage.setItem('tings_v2',JSON.stringify([habit]));
    localStorage.setItem('tings_app_settings_v2',JSON.stringify({...plannerSettings,minimalMode:false}));
  },{
    habit:base({hid:'ui-options',name:'UI options',locationIds:['campus'],anywhereAllowed:false}),
    plannerSettings:settings([campus])
  });
  await page.reload({waitUntil:'networkidle'});
  await page.evaluate(()=>openDetail(0));
  await page.locator('#detail-habit-option-add').click();
  await page.locator('#detail-habit-option-add').click();
  await page.locator('.habit-option-location').nth(0).selectOption('campus');
  await page.locator('.habit-option-location').nth(1).selectOption('campus');
  await page.locator('.habit-option-start').nth(0).fill('09:00');
  await page.locator('.habit-option-end').nth(0).fill('10:00');
  await page.locator('.habit-option-start').nth(1).fill('13:00');
  await page.locator('.habit-option-end').nth(1).fill('14:00');
  assert(!(await page.locator('#detail-allowed-time-row').isVisible()),'single window hides while option rows are active');
  await page.locator('#detail-save').click();
  const savedOptions = await page.evaluate(()=>load()[0].scheduleOptions);
  assert(savedOptions.length === 2,'editor saves two alternatives');
  assert(savedOptions.every(option=>option.locationId === 'campus'),'editor permits the same saved place twice');
  assert(savedOptions[0].start === 540 && savedOptions[1].start === 780,'editor preserves distinct option times');

  assert(errors.length === 0,`no page errors${errors.length ? ': ' + errors.join(' | ') : ''}`);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if(fail)process.exit(1);
})().catch(error=>{ console.error(error); process.exit(1); });
