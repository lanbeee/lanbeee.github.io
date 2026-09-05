// Snooze is a hard planner gate. Location clustering and same-day link
// discovery may broaden calendar eligibility, but neither may resurrect a
// currently snoozed item or use one as a native-due cluster anchor.
//
// Runs the end-to-end scenario through both planner engines and probes the
// shared cluster helper directly for the anchor-side invariant.

const {
  chromium, BASE, atTime, baseHabit:base,
  openEveningSettings, glpkAvailable, runPlannerPair, placedAnywhere
} = require('./helpers/planner-test-helpers');

let pass = 0, fail = 0;
function assert(cond,msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors = [];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(BASE,{waitUntil:'networkidle'});

  const now = atTime(10);
  const day = 86400000;
  const settings = openEveningSettings({
    availabilityMinutes:Array(7).fill(360),
    locations:[{id:'shared',name:'Shared place',lat:40,lng:-75}],
    travel:{}
  });
  const partner = base({
    hid:'partner',name:'Due partner',type:'task',target:null,
    dueDate:now,eventTime:null,durationMinutes:30,priority:2,
    locationIds:['shared'],anywhereAllowed:false
  });
  const snoozed = base({
    hid:'snoozed',name:'Snoozed flexible item',type:'keepup',target:5,
    lastLog:now-day,logs:[now-day],flexibilityDays:4,durationMinutes:45,
    locationIds:['shared'],anywhereAllowed:false,snoozedUntil:now+day,
    // Retain the empty candidate for link discovery, matching the production
    // path that exposed the bug. Snooze must still win over every expansion.
    scheduleLinks:[{
      anchorHid:'partner',direction:'after',adjacency:'sometime',requireSameDay:true
    }]
  });

  const glpkOk = await glpkAvailable(page);
  const result = await runPlannerPair(page,[snoozed,partner],settings,now);
  for(const [label,week] of [['GLPK',result.glpk],['Fast',result.fast]]){
    if(label === 'GLPK' && !glpkOk){ console.log('  skip: GLPK unavailable'); continue; }
    assert(!week.error,`${label}: week builds without error ${week.error || ''}`);
    assert(placedAnywhere(week,'Due partner') >= 30,`${label}: active due partner remains scheduled`);
    assert(placedAnywhere(week,'Snoozed flexible item') === 0,
      `${label}: cluster/link expansion does not schedule the snoozed item`);
  }

  const helper = await page.evaluate(({now,day})=>{
    const RealDate = Date;
    function FrozenDate(...args){return args.length ? new RealDate(...args) : new RealDate(now);}
    FrozenDate.now=()=>now; FrozenDate.parse=RealDate.parse; FrozenDate.UTC=RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate); FrozenDate.prototype=RealDate.prototype;
    globalThis.Date=FrozenDate;
    try{
      const today=dayStart(now);
      const snoozedPartner=normalize([{
        hid:'sleeping-anchor',name:'Sleeping anchor',type:'keepup',target:1,
        lastLog:today-2*day,logs:[today-2*day],durationMinutes:15,
        flexibilityDays:0,locationIds:['shared'],anywhereAllowed:false,
        snoozedUntil:now+day
      }])[0];
      return clusterNativeDueOnDay(
        {h:snoozedPartner,i:0,eligible:new Set([today])},today,new Date(today).getDay(),{}
      );
    }finally{globalThis.Date=RealDate;}
  },{now,day});
  assert(helper === false,'snoozed work cannot act as a native-due cluster anchor');
  assert(!errors.length,`no page errors ${errors.join(' | ')}`);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(error=>{console.error('CRASH',error);process.exit(1);});
