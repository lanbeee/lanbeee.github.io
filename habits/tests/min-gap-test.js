// Min gap between same-habit sessions and between linked habits.
// HABITS_URL=http://127.0.0.1:4181/ node tests/min-gap-test.js
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

  async function runPair(data,plannerSettings,now,numDays = 1){
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
      const normalized = normalize(data);
      const summarize = week=>(week.days || []).map(day=>(day.timeline || [])
        .filter(row=>row.kind === 'fill')
        .map(row=>({
          hid:row.h.hid,
          name:row.h.name,
          start:row.start,
          end:row.end
        })));
      try{
        let glpk;
        try{ glpk = summarize(await buildWeekAgendaAsync(normalized,{...plannerSettings,agendaOptimizer:true},numDays)); }
        catch(error){ glpk = {error:String(error && error.message || error)}; }
        let fast;
        try{ fast = summarize(buildWeekAgenda(normalized,{...plannerSettings,agendaOptimizer:false},numDays)); }
        catch(error){ fast = {error:String(error && error.message || error)}; }
        return {glpk,fast};
      }finally{
        globalThis.Date = RealDate;
        sortSettings = previousSettings;
      }
    },{data,plannerSettings,now,numDays});
  }

  const now = atTime(8);
  const openDay = {
    preset:'todayFirst',agendaOptimizer:true,focus:'balanced',showWeekOnHome:true,
    availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440],availabilityOverrides:{},
    showScheduledTasksInAgenda:true,showDueTasksInAgenda:true,
    showPlannedItemsInAgenda:true,showDueHabitsInAgenda:true,
    locations:[],travel:{},defaultTravelMode:'walking',blockedTimes:[]
  };

  const model = await page.evaluate(()=>{
    const target = targetFromRhythmParts(15,7);
    const parts = rhythmParts(target);
    return {
      target,
      parts,
      gap:clampMinGapMinutes(90),
      empty:clampMinGapMinutes(''),
      link:normalizeScheduleLink({
        anchorHid:'a',direction:'after',adjacency:'sometime',minGapMinutes:45
      },'b')
    };
  });
  assert(model.parts.times === 15 && model.parts.days === 7, '15×/7d round-trips through rhythmParts');
  assert(model.gap === 90 && model.empty === 0, 'min gap clamps empty to 0 and keeps 90');
  assert(model.link && model.link.minGapMinutes === 45, 'schedule links keep minGapMinutes');

  const nap = [base({
    hid:'nap',name:'Nap',type:'keepup',target:1/3,
    durationMinutes:30,minGapMinutes:90,priority:0,
    allowedTimeStart:8*60,allowedTimeEnd:20*60,
    scheduleOptions:[
      {id:'one',start:8*60,end:20*60,sameDayMode:'separate'},
      {id:'two',start:8*60,end:20*60,sameDayMode:'separate'},
      {id:'three',start:8*60,end:20*60,sameDayMode:'separate'}
    ]
  })];
  const napResult = await runPair(nap,openDay,now,1);
  function gapsOk(days,hid,minMs,label){
    if(days.error){
      assert(false, `${label} ${days.error}`);
      return;
    }
    const rows = (days[0] || []).filter(row=>row.hid === hid).sort((a,b)=>a.start - b.start);
    assert(rows.length >= 2, `${label} placed at least two sessions`);
    let ok = true;
    for(let i = 1;i < rows.length;i += 1){
      if(rows[i].start + 1000 < rows[i-1].end + minMs)ok = false;
    }
    assert(ok, `${label} sessions are at least ${minMs/60000} min apart`);
  }
  gapsOk(napResult.fast,'nap',90*60000,'fast nap');
  if(glpkOk)gapsOk(napResult.glpk,'nap',90*60000,'glpk nap');

  const splitDay = {
    ...openDay,
    blockedTimes:[{label:'pause',days:[],start:8*60+30,end:9*60}]
  };
  const splitResult = await runPair(nap,splitDay,now,1);
  function busySplitOk(days,label){
    if(days.error){
      assert(false, `${label} ${days.error}`);
      return;
    }
    const rows = (days[0] || []).filter(row=>row.hid === 'nap').sort((a,b)=>a.start - b.start);
    assert(rows.length >= 2, `${label} still places two sessions around busy time`);
    let ok = true;
    for(let i = 1;i < rows.length;i += 1){
      if(rows[i].start + 1000 < rows[i-1].end + 90*60000)ok = false;
    }
    assert(ok, `${label} min gap holds across the 8:30–9:00 busy split`);
  }
  busySplitOk(splitResult.fast,'fast busy-split');
  if(glpkOk)busySplitOk(splitResult.glpk,'glpk busy-split');

  const overlappingBuffers = [
    base({hid:'other',name:'Other',priority:0,target:1,durationMinutes:30,
      allowedTimeStart:510,allowedTimeEnd:540}),
    base({hid:'nap',name:'Nap',priority:1,target:0.5,durationMinutes:30,
      minGapMinutes:90,preferredTimeStart:555,allowedTimeStart:480,allowedTimeEnd:1200,
      scheduleOptions:[
        {id:'later',start:555,end:585,sameDayMode:'separate'},
        {id:'earlier',start:480,end:510,sameDayMode:'separate'}
      ]})
  ];
  const bufferResult = await runPair(overlappingBuffers,openDay,now,1);
  for(const mode of glpkOk ? ['fast','glpk'] : ['fast']){
    const days = bufferResult[mode];
    assert(!days.error, `${mode} overlapping buffers builds successfully`);
    if(days.error)continue;
    const rows = days[0] || [];
    assert(rows.some(row=>row.hid === 'other'), `${mode} preserves the intervening item`);
    assert(rows.filter(row=>row.hid === 'nap').length === 1,
      `${mode} rejects two narrow sessions separated by only 45 minutes`);
  }

  const linked = [
    base({hid:'med-a',name:'Dose A',type:'keepup',target:1,durationMinutes:15,priority:0,
      allowedTimeStart:8*60,allowedTimeEnd:20*60}),
    base({hid:'med-b',name:'Dose B',type:'keepup',target:1,durationMinutes:15,priority:0,
      allowedTimeStart:8*60,allowedTimeEnd:20*60,
      scheduleLinks:[{anchorHid:'med-a',direction:'after',adjacency:'sometime',minGapMinutes:60}]})
  ];
  const linkResult = await runPair(linked,openDay,now,1);
  function linkOk(days,label){
    if(days.error){
      assert(false, `${label} ${days.error}`);
      return;
    }
    const a = (days[0] || []).find(row=>row.hid === 'med-a');
    const b = (days[0] || []).find(row=>row.hid === 'med-b');
    assert(Boolean(a && b), `${label} placed both linked items`);
    if(a && b)assert(b.start + 1000 >= a.end + 60*60000, `${label} successor waits 60 min`);
  }
  linkOk(linkResult.fast,'fast link');
  if(glpkOk)linkOk(linkResult.glpk,'glpk link');

  assert(!errors.length, 'no page errors: ' + errors.join('; '));
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  if(fail)process.exit(1);
})().catch(error=>{console.error(error);process.exit(1);});
