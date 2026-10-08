const assert=require('node:assert/strict');
const {chromium,glpkAvailable}=require('./helpers/planner-test-helpers');
(async()=>{const browser=await chromium.launch({headless:true});try{
  const page=await browser.newPage();await page.goto(process.env.HABITS_URL || 'http://127.0.0.1:4181/');
  const glpkOk=await glpkAvailable(page);
  const report=await page.evaluate(async glpkOk=>{
    const RealDate=Date,base=dayStart(Date.now()),now=base+8*3600000;
    let clock=now;
    class FrozenDate extends RealDate{constructor(...args){super(...(args.length?args:[clock]));}static now(){return clock;}}
    globalThis.Date=FrozenDate;
    try{
      const settings={...loadSortSettings(),blockedTimes:[],blockedTimeOverrides:{},blockedTimeExceptions:{},
        locations:[],travel:{},availabilityMinutes:Array(7).fill(1440)};sortSettings=settings;
      const original=normalize([{hid:'sunset',name:'Sunset',type:'keepup',target:1,priority:2,durationMinutes:10,
        allowedTimeStart:1080,allowedTimeEnd:1200,createdAt:base-86400000,logs:[]}]);
      const prefs={enabled:true,items:{'item:sunset':{missed:'alarm',start:'notification'}}},results=[];
      for(const exact of glpkOk?[false,true]:[false]){
        const build=data=>exact?buildWeekAgendaAsync(data,settings,7):buildWeekAgenda(data,settings,7);
        const data=structuredClone(original),week=await build(data);
        const first=nativeReminderEvents(week,data,settings,prefs,now).find(e=>e.reminderEdge==='missed');
        data.push(...normalize([{hid:'new-event',name:'Added blocker',type:'task',priority:0,eventTime:base+19*3600000,durationMinutes:90,logs:[]}]));
        const changed=await build(data),next=nativeReminderEvents(changed,data,settings,prefs,now).find(e=>e.reminderEdge==='missed');
        plannerPerfResetTryPlace();const repeated=nativeReminderEvents(changed,data,settings,prefs,now);
        const calls=_plannerPerfTryPlace;
        const forecast=await forecastAgendaRisks(changed,data,settings,exact?'exact':'fast',{owners:['sunset']});
        forecast.revision='cycle';forecast.warningAt=now+2000;applyAgendaRiskForecast(changed,forecast,data);changed.forecastRevision='cycle';
        const adopted=consumeAgendaDropForecast(changed,data,'cycle',forecast.targetAt);
        const done=structuredClone(data);done[0].logs=[{ts:now}];done[0].lastLog=now;
        const completed=nativeReminderEvents(changed,done,settings,prefs,now).filter(e=>e.reminderEdge==='missed');
        results.push({exact,first,next,calls,count:repeated.filter(e=>e.reminderEdge==='missed').length,
          forecastCount:forecast.probes,adopted:agendaForecastPlanKey(adopted,data)===agendaForecastPlanKey(forecast.futureWeek,data),completed:completed.length,
          stale:consumeAgendaDropForecast(changed,data,'edited',forecast.targetAt)===null,
          newOff:!repeated.some(e=>e.owner==='item:new-event')});
      }
      // A future evening row has no worker cutoff annotation. Its suggested
      // start must not pre-arm an immediate drop when an unrelated completion
      // causes today's normal pack to replace that saved week.
      const transitions=[];
      for(const exact of glpkOk?[false,true]:[false]){
        clock=base+16*3600000;
        const data=normalize([
          {hid:'evening',name:'Evening occurrence',type:'keepup',target:1,priority:0,durationMinutes:10,
            allowedTimeStart:1203,allowedTimeEnd:1323,createdAt:base-86400000,logs:[]},
          {hid:'other',name:'Other occurrence',type:'keepup',target:1,priority:2,durationMinutes:5,
            createdAt:base-86400000,logs:[]}
        ]);
        const prefs={enabled:true,items:{'item:evening':{missed:'alarm'}}};
        const build=()=>exact?buildWeekAgendaAsync(data,settings,7):buildWeekAgenda(data,settings,7);
        const saved=await build(),tomorrow=base+86400000;
        const savedRow=saved.days[1].timeline.find(r=>r.h?.hid==='evening');
        const armed=nativeReminderEvents(saved,data,settings,prefs,clock).find(e=>e.dayKey===dateKey(tomorrow));
        clock=tomorrow+(19*60+53)*60000;
        data[1].logs=[{ts:clock}];data[1].lastLog=clock;
        const updated=await build(),row=updated.days[0].timeline.find(r=>r.h?.hid==='evening');
        const alarm=nativeReminderEvents(updated,data,settings,prefs,clock,saved).find(e=>e.dayKey===dateKey(tomorrow));
        clock=tomorrow+(21*60+40)*60000;
        const imminent=await build();
        const due=nativeReminderEvents(imminent,data,settings,prefs,clock).find(e=>e.dayKey===dateKey(tomorrow));
        data[0].logs=[{ts:clock}];data[0].lastLog=clock;
        const completed=nativeReminderEvents(imminent,data,settings,prefs,clock);
        transitions.push({exact,unannotated:savedRow.dropAt==null,start:savedRow.start,
          armed,alarm,rowCutoff:row.dropAt,red:agendaLeadStatus(row,data[0],tomorrow+(19*60+53)*60000).cls==='agenda-dropping',
          due,dueNow:clock,done:!completed.some(e=>e.dayKey===dateKey(tomorrow)),
          future:completed.some(e=>e.dayKey===dateKey(tomorrow+86400000))});
      }
      // Last opening is in the afternoon, then no job runs until after the
      // morning opportunity. Alarms must already be armed by that opening.
      const cushion=[];clock=base+16*3600000;
      for(const exact of glpkOk?[false,true]:[false]){
        const data=normalize([
          {hid:'morning',name:'Morning',type:'keepup',target:1,priority:2,durationMinutes:10,
            allowedTimeStart:360,allowedTimeEnd:465,createdAt:base-86400000,logs:[]},
          {hid:'morning-block',name:'Morning commitment',type:'keepup',target:1,priority:0,durationMinutes:60,
            allowedTimeStart:420,allowedTimeEnd:480,createdAt:base-86400000,logs:[]},
          {hid:'afternoon',name:'Afternoon',type:'keepup',target:1,durationMinutes:10,
            allowedTimeStart:900,allowedTimeEnd:960,createdAt:base-86400000,logs:[]},
          {hid:'broad',name:'Broad window',type:'keepup',target:1,priority:5,durationMinutes:10,createdAt:base-86400000,logs:[]}
        ]);
        const prefs={enabled:true,items:Object.fromEntries(data.map(h=>['item:'+h.hid,{missed:'alarm'}]))};
        const build=data=>exact?buildWeekAgendaAsync(data,settings,7):buildWeekAgenda(data,settings,7);
        const week=await build(data),tomorrow=base+86400000;
        plannerPerfResetTryPlace();const events=nativeReminderEvents(week,data,settings,prefs,clock);
        const calls=_plannerPerfTryPlace,early=events.find(e=>e.owner==='item:morning' && e.dayKey===dateKey(tomorrow));
        const completedToday=structuredClone(data);completedToday[0].logs=[{ts:clock}];completedToday[0].lastLog=clock;
        const doneToday=nativeReminderEvents(week,completedToday,settings,prefs,clock).find(e=>e.key===early?.key);
        const disabled=nativeReminderEvents(week,data,settings,{...prefs,items:{...prefs.items,'item:morning':{missed:'off'}}},clock);
        clock=tomorrow+5*3600000;
        const fresh=await build(data),updated=nativeReminderEvents(fresh,data,settings,prefs,clock).find(e=>e.owner==='item:morning' && e.dayKey===dateKey(tomorrow));
        const completedTomorrow=structuredClone(data);completedTomorrow[0].logs=[{ts:clock}];completedTomorrow[0].lastLog=clock;
        const doneTomorrow=nativeReminderEvents(fresh,completedTomorrow,settings,prefs,clock).some(e=>e.key===early?.key);
        cushion.push({exact,early,updated,calls,expectedCutoff:tomorrow+410*60000+1,doneToday:Boolean(doneToday),doneTomorrow,
          disabled:disabled.some(e=>e.key===early?.key),otherFuture:events.filter(e=>e.reminderEdge==='missed' && e.dayKey!==dateKey(base)).map(e=>e.owner)});
        clock=base+16*3600000;
      }
      clock=now;
      const midnightItem=normalize([{hid:'midnight',name:'Midnight opportunity',type:'keepup',target:1,durationMinutes:5,
        allowedTimeStart:0,allowedTimeEnd:10,logs:[]}]);
      const nextDay=base+86400000,midnightWeek={days:[{dayBase:nextDay,dayKey:dateKey(nextDay),timeline:[
        {kind:'fill',h:midnightItem[0],i:0,start:nextDay,end:nextDay+5*60000,dropAt:nextDay+5*60000+1}]}]};
      const midnight=nativeReminderEvents(midnightWeek,midnightItem,settings,{enabled:true,items:{'item:midnight':{missed:'alarm'}}},now)[0];
      const stress=normalize(Array.from({length:50},(_,i)=>({hid:'stress-'+i,name:'Synthetic '+i,type:'keepup',target:1,
        priority:i%6,durationMinutes:10,createdAt:base-86400000,logs:[]})));
      const started=performance.now(),week=buildWeekAgenda(stress,settings,7),buildMs=performance.now()-started;
      const stressPrefs={enabled:true,items:Object.fromEntries(stress.map(h=>['item:'+h.hid,{missed:'alarm'}]))};
      const projected=performance.now();plannerPerfResetTryPlace();let alarms;
      for(let i=0;i<20;i++)alarms=nativeReminderEvents(week,stress,settings,stressPrefs,now);
      return {results,transitions,cushion,midnight,nextDay,stress:{buildMs,projectionMs:performance.now()-projected,calls:_plannerPerfTryPlace,
        alarms:alarms.filter(e=>e.reminderEdge==='missed').length}};
    }finally{globalThis.Date=RealDate;}
  },glpkOk);
  for(const r of report.results){
    assert(r.first.estimated && r.first.at>r.first.agendaAt-16*60000,'evening alarm exists in morning');
    assert(r.next.at<r.first.at,'new blocker brings cutoff and alarm forward');
    assert.equal(r.next.key,r.first.key,'movement keeps stable occurrence key');
    assert.equal(r.count,7,'saved week is pre-armed');assert.equal(r.calls,0);assert.equal(r.forecastCount,1);
    assert(r.adopted && r.stale && r.newOff);assert.equal(r.completed,6,'completion cancels today while preserving future occurrences');
  }
  for(const r of report.transitions){
    assert(r.unannotated,'fixture exercises the saved future-evening fallback');
    assert(r.armed.at>r.start,'open time after the suggestion must remain usable');
    assert.equal(r.armed.agendaAt,r.rowCutoff,'saved estimate matches the normal current-day cutoff');
    assert.equal(r.alarm.key,r.armed.key,'completion preserves the unfinished occurrence identity');
    assert.equal(r.alarm.at,r.armed.at,'an unrelated completion does not create an early trigger');
    assert(!r.red,'upcoming occurrence with ample remaining room does not show red');
    assert.equal(r.due.at,r.dueNow+2000,'real imminent loss still warns promptly');
    assert(r.done && r.future,'completion cancels only the completed occurrence');
  }
  for(const r of report.cushion){
    assert(r.early?.estimated && r.early.delivery==='alarm','tomorrow morning is armed during an afternoon opening');
    assert.equal(r.early.agendaAt,r.expectedCutoff,'higher-priority morning block advances cutoff before allowed end');
    assert.equal(r.early.agendaAt-r.early.at,15*60000,'overnight estimate keeps fifteen-minute lead');
    assert.equal(r.early.key,r.updated?.key,'midnight refresh replaces the same occurrence');
    assert.equal(r.early.at,r.updated.at,'unchanged overnight opportunity does not slide at midnight');
    assert(r.doneToday && !r.doneTomorrow && !r.disabled,'completion and Off stay occurrence-aware');
    assert.equal(r.calls,0,'overnight projection does no UI placement');
    assert(r.otherFuture.includes('item:afternoon') && r.otherFuture.includes('item:broad'),'future afternoons and broad windows are pre-armed too');
    assert(r.otherFuture.length>=6,'future saved days have provisional estimates');
  }
  assert.equal(report.midnight.at,report.nextDay-10*60000+1,'a next-day warning can be armed to ring before midnight');
  assert(report.midnight.at>=report.nextDay-60*60000,'overnight warning keeps the allowed-start guard');
  assert.equal(report.stress.calls,0);assert.equal(report.stress.alarms,350,'all fifty items across the saved week are armed');
  console.log('PASS: morning arming, added blocker, completion, reuse, stable identity, new-item Off; '+JSON.stringify(report.stress));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
