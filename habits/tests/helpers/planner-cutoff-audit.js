// Synthetic audit shared by desktop Playwright and isolated Android WebView.
// It deliberately records prediction mismatches rather than assuming that a
// fit against committed clocks proves a future full rebuild will agree.
async function runPlannerCutoffAudit(){
  const RealDate=Date,base=dayStart(Date.now()),initial=base+9*3600000;
  let clock=initial;
  function FrozenDate(...args){return args.length ? new RealDate(...args) : new RealDate(clock);}
  FrozenDate.now=()=>clock;FrozenDate.parse=RealDate.parse;FrozenDate.UTC=RealDate.UTC;
  FrozenDate.prototype=RealDate.prototype;Object.setPrototypeOf(FrozenDate,RealDate);
  globalThis.Date=FrozenDate;
  const scenarios=plannerCutoffAuditScenarios(base,initial);
  const report={scenarios:scenarios.length,checks:[],missingCutoffs:[],projectionErrors:[],deliverySamples:[],suddenDropChecks:[],slippedSamples:[],elapsedMs:0};
  const started=performance.now();
  try{
    if(!await ensureGlpk())throw new Error('GLPK unavailable');
    for(const scenario of scenarios)for(const exact of [false,true]){
      clock=initial;localStorage.clear();sortSettings=scenario.settings;
      const data=normalize(scenario.data);localStorage.setItem(KEY,JSON.stringify(data));
      localStorage.setItem(SORT_SETTINGS_KEY,JSON.stringify(scenario.settings));
      const build=()=>exact?buildWeekAgendaAsync(data,scenario.settings,1):buildWeekAgenda(data,scenario.settings,1);
      const week=await build(),rows=week.days[0].timeline.filter(row=>['fill','scheduled'].includes(row.kind));
      // A new all-day commitment is an explicit edit: the previous visible
      // flexible rows drop while their general windows are still open.
      clock=initial+3*60000;
      const blocked=normalize([...scenario.data,habit('sudden-block',{type:'task',priority:0,
        eventTime:clock,durationMinutes:537})]);
      const afterEdit=exact?await buildWeekAgendaAsync(blocked,scenario.settings,1):buildWeekAgenda(blocked,scenario.settings,1);
      const droppedHids=[...new Set(rows.map(r=>r.h.hid))].filter(hid=>
        !afterEdit.days[0].timeline.some(r=>r.h?.hid===hid) && windowStillDoableToday(data.find(h=>h.hid===hid),clock,scenario.settings));
      const dropPrefs={enabled:true,items:Object.fromEntries(data.map(h=>[`item:${h.hid}`,{missed:exact?'alarm':'notification',missedLeadMinutes:5}]))};
      const dropEvents=nativeReminderEvents(afterEdit,blocked,scenario.settings,dropPrefs,clock,week).filter(e=>e.slipped);
      report.suddenDropChecks.push({scenario:scenario.name,engine:exact?'GLPK':'Fast',expected:droppedHids.length,
        alerts:dropEvents.length,correctAt:dropEvents.every(e=>e.at===clock+2000)});
      if(dropEvents.length && report.slippedSamples.length<2)report.slippedSamples.push(dropEvents[0]);
      const seen=new Set();
      for(const row of rows){
        const identity=`${row.h.hid}:${row.scheduleOptionId || 'main'}`;if(seen.has(identity))continue;seen.add(identity);
        if(!Number.isFinite(row.dropAt)){report.missingCutoffs.push({scenario:scenario.name,exact,identity});continue;}
        const lead=[5,10,15,30,60][report.checks.length%5];
        const prefs={enabled:true,items:{[`item:${row.h.hid}`]:{missed:exact?'alarm':'notification',missedLeadMinutes:lead}}};
        const warning=nativeReminderEvents(week,data,scenario.settings,prefs,initial).find(e=>e.reminderEdge==='missed' && !e.slipped && e.expiresAt===row.dropAt);
        if(!warning || warning.at!==Math.max(row.dropAt-lead*60000,initial+2000))report.projectionErrors.push({scenario:scenario.name,exact,identity,lead});
        if(warning && report.deliverySamples.length<8)report.deliverySamples.push(warning);
        const present=after=>after.days[0].timeline.some(r=>['fill','scheduled'].includes(r.kind)
          && r.h?.hid===row.h.hid && (!row.scheduleOptionId || r.scheduleOptionId===row.scheduleOptionId));
        clock=row.dropAt-60000;const before=await build();
        clock=row.dropAt+60000;const after=await build();
        const afterPresent=present(after);
        const missed=typeof isMissedOccurrence==='function' && !afterPresent
          && isMissedOccurrence(row.h,new Set(),clock,base,{renderedToday:true});
        const slipped=nativeReminderEvents(after,data,scenario.settings,prefs,clock,week).filter(e=>e.slipped && e.owner===`item:${row.h.hid}`);
        report.checks.push({scenario:scenario.name,engine:exact?'GLPK':'Fast',identity,priority:row.h.priority,
          breakable:Boolean(row.h.breakable),cutoffMinute:Math.round((row.dropAt-base)/60000),lead,
          warningMinute:warning?Math.round((warning.at-base)/60000):null,
          beforePresent:present(before),afterPresent,missed:Boolean(missed),slipped:slipped.length});
      }
    }
  }finally{globalThis.Date=RealDate;report.elapsedMs=Math.round(performance.now()-started);}
  report.summary={checks:report.checks.length,mismatches:report.checks.filter(c=>!c.beforePresent || c.afterPresent).length,earlyDrops:report.checks.filter(c=>!c.beforePresent).length,
    lateDrops:report.checks.filter(c=>c.afterPresent).length,matching:report.checks.filter(c=>c.beforePresent&&!c.afterPresent).length,
    missingCutoffs:report.missingCutoffs.length,projectionErrors:report.projectionErrors.length,
    suddenDropAlerts:report.suddenDropChecks.reduce((n,c)=>n+c.alerts,0),
    suddenDropErrors:report.suddenDropChecks.filter(c=>c.expected!==c.alerts || !c.correctAt).length};
  return report;
}

function plannerCutoffAuditScenarios(base,initial){
  const cleanSettings=()=>({...loadSortSettings(),blockedTimes:[
    {label:'Night',days:[],start:0,end:540},{label:'Evening',days:[],start:1080,end:1440}],
    blockedTimeOverrides:{},blockedTimeExceptions:{},locations:[],travel:{},
    availabilityMinutes:Array(7).fill(1440),availabilityOverrides:{},agendaOptimizer:true});
  const habit=(hid,extra={})=>({hid,name:`Synthetic ${hid}`,type:'keepup',target:1,priority:2,
    durationMinutes:20,allowedTimeStart:540,allowedTimeEnd:1020,createdAt:base-86400000,logs:[],...extra});
  const scenarios=[];
  for(let seed=1;seed<=8;seed++)scenarios.push({name:`mixed-priorities-${seed}`,settings:cleanSettings(),
    data:Array.from({length:12},(_,i)=>habit(`s${seed}h${i}`,{
      type:i%5===4?'task':'keepup',priority:(i+seed)%6,
      durationMinutes:[10,20,30,45,60][(i*3+seed)%5],
      allowedTimeStart:540+(i*35+seed*10)%180,allowedTimeEnd:780+(i*25+seed*15)%240,
      dueDate:i%5===4?base:null,breakable:i===10,minChunkMinutes:15}))});
  scenarios.push({name:'equal-priority-flexible',settings:cleanSettings(),data:Array.from({length:8},(_,i)=>
    habit(`equal${i}`,{priority:2,durationMinutes:30,allowedTimeEnd:810+(i%3)*30}))});
  scenarios.push({name:'fragmented-split-work',settings:{...cleanSettings(),blockedTimes:[
    {label:'Early',days:[],start:0,end:540},{label:'Block A',days:[],start:660,end:690},
    {label:'Block B',days:[],start:780,end:810},{label:'Late',days:[],start:960,end:1440}]},
    data:[habit('split',{breakable:true,durationMinutes:180,minChunkMinutes:30,priority:0}),
      ...Array.from({length:5},(_,i)=>habit(`gap${i}`,{durationMinutes:20+i*5,priority:i,allowedTimeEnd:960}))]});
  const places=[{id:'home',name:'Home',lat:40,lng:-74},{id:'shop',name:'Shop',lat:40.02,lng:-74.01},
    {id:'office',name:'Office',lat:40.03,lng:-74.02,allowedTimeStart:600,allowedTimeEnd:900}];
  const travel={};for(const a of places)for(const b of places)if(a.id!==b.id)travel[`${a.id}|${b.id}`]={
    a:a.id,b:b.id,seconds:a.id==='office'||b.id==='office'?900:600,metres:1000,provider:'manual',fetchedAt:initial};
  scenarios.push({name:'venues-travel-and-hours',settings:{...cleanSettings(),locations:places,travel,lastKnownLocationId:'home'},
    data:[habit('home',{locationIds:['home'],anywhereAllowed:false,allowedTimeEnd:810,durationMinutes:30}),
      habit('shop',{locationIds:['shop'],anywhereAllowed:false,allowedTimeStart:630,allowedTimeEnd:960,durationMinutes:45,priority:1}),
      habit('office',{locationIds:['office'],anywhereAllowed:false,durationMinutes:60,priority:0}),
      habit('flex-place',{locationIds:['home','shop'],anywhereAllowed:false,durationMinutes:25,priority:4}),
      habit('appointment',{type:'task',eventTime:base+15*3600000,durationMinutes:45,locationIds:['shop'],anywhereAllowed:false})]});
  scenarios.push({name:'alternative-and-separate-windows',settings:cleanSettings(),data:[
    habit('options',{durationMinutes:20,scheduleOptions:[
      {id:'morning',weekdays:[],start:570,end:660,sameDayMode:'alternative'},
      {id:'later',weekdays:[],start:780,end:870,sameDayMode:'alternative'},
      {id:'separate',weekdays:[],start:900,end:960,sameDayMode:'separate'}]}),
    habit('priority-block',{priority:0,durationMinutes:60,allowedTimeStart:780,allowedTimeEnd:900}),
    habit('long-flex',{priority:3,durationMinutes:90,allowedTimeEnd:960})]});
  return scenarios;
}
