// Weekly rhythm like 15×/7d must not clamp to 2×/1d, and extra same-day
// slots can fill leftover week capacity on less busy days.
const {
  chromium, BASE, atTime, baseHabit:base, glpkAvailable
} = require('./helpers/planner-test-helpers');

let pass = 0, fail = 0;
function assert(cond,msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844}});
  const errors = [];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(BASE,{waitUntil:'networkidle'});
  const glpkOk = await glpkAvailable(page);

  const roundTrip = await page.evaluate(()=>{
    const target = targetFromRhythmParts(15,7);
    const parts = rhythmParts(target);
    const twoADay = targetFromRhythmParts(2,1);
    return {target,parts,twoADay,label:formatRhythmLabel(target)};
  });
  assert(roundTrip.parts.times === 15 && roundTrip.parts.days === 7, '15 times in 7 days stays 15×/7d');
  assert(roundTrip.target < 0.5, 'stored target is below the old 0.5 floor');
  assert(roundTrip.twoADay !== roundTrip.target, '15×/7d is not stored as 2×/1d');
  assert(roundTrip.label === '15×/7d', 'rhythm label shows 15×/7d');

  const now = atTime(8);
  const data = [base({
    hid:'nap',name:'Nap',type:'keepup',target:7/15,
    durationMinutes:30,priority:0,minGapMinutes:60,
    allowedTimeStart:8*60,allowedTimeEnd:20*60,
    scheduleOptions:[
      {id:'one',start:8*60,end:20*60,sameDayMode:'separate'},
      {id:'two',start:8*60,end:20*60,sameDayMode:'separate'},
      {id:'three',start:8*60,end:20*60,sameDayMode:'separate'}
    ]
  })];
  const settings = {
    preset:'todayFirst',agendaOptimizer:true,focus:'balanced',showWeekOnHome:true,
    availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440],availabilityOverrides:{},
    showScheduledTasksInAgenda:true,showDueTasksInAgenda:true,
    showPlannedItemsInAgenda:true,showDueHabitsInAgenda:true,
    locations:[],travel:{},defaultTravelMode:'walking',
    blockedTimes:[{label:'busy-midweek',days:[2,3],start:8*60,end:18*60}]
  };

  const result = await page.evaluate(async ({data,settings,now,glpkOk})=>{
    const RealDate = Date;
    function FrozenDate(...args){ return args.length ? new RealDate(...args) : new RealDate(now); }
    FrozenDate.now = ()=>now;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate);
    FrozenDate.prototype = RealDate.prototype;
    globalThis.Date = FrozenDate;
    const previous = sortSettings;
    sortSettings = settings;
    const count = week=>(week.days || []).map(day=>(day.timeline || [])
      .filter(row=>row.kind === 'fill' && row.h && row.h.hid === 'nap').length);
    try{
      const normalized = normalize(data);
      const fastWeek = buildWeekAgenda(normalized,{...settings,agendaOptimizer:false},7);
      const fast = count(fastWeek);
      let glpk = null;
      if(glpkOk){
        try{ glpk = count(await buildWeekAgendaAsync(normalized,{...settings,agendaOptimizer:true},7)); }
        catch(error){ glpk = {error:String(error && error.message || error)}; }
      }
      return {fast,glpk,wanted:Math.ceil(15 * 7 / 7)};
    }finally{
      globalThis.Date = RealDate;
      sortSettings = previous;
    }
  },{data,settings,now,glpkOk});

  const fastTotal = result.fast.reduce((sum,n)=>sum + n,0);
  assert(fastTotal > 7, 'fast places more than one nap per week-day average');
  assert(fastTotal <= 15, 'fast respects the 15/week cap');
  const quiet = result.fast[0] + result.fast[1] + result.fast[4] + result.fast[5] + result.fast[6];
  const busy = result.fast[2] + result.fast[3];
  assert(quiet >= busy, 'fast puts more extra naps on less busy days');
  if(glpkOk && !result.glpk.error){
    const glpkTotal = result.glpk.reduce((sum,n)=>sum + n,0);
    assert(glpkTotal > 7 && glpkTotal <= 15, 'glpk also uses the weekly 15 cap');
  }else if(result.glpk && result.glpk.error){
    assert(false, 'glpk ' + result.glpk.error);
  }

  assert(!errors.length, 'no page errors: ' + errors.join('; '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  if(fail)process.exit(1);
})().catch(error=>{console.error(error);process.exit(1);});
