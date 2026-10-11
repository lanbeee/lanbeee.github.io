// Fixed clocks survive breakability, capacity pressure, conflicts and cold replans.
const assert = require('node:assert/strict');
const {chromium,BASE,baseHabit,openEveningSettings,glpkAvailable} = require('./helpers/planner-test-helpers');
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  try{
    await page.goto(BASE,{waitUntil:'load'});
    const exact=await glpkAvailable(page);
    const result=await page.evaluate(async ({fixture,settings,exact})=>{
      const RealDate=Date;
      const day=new RealDate(2026,9,11).getTime(),at=(h,m=0)=>day+(h*60+m)*60000;
      let now=at(12);
      class FrozenDate extends RealDate{constructor(...args){super(...(args.length ? args : [now]));}static now(){return now;}}
      globalThis.Date=FrozenDate;
      settings={...DEFAULT_SORT_SETTINGS,...settings,blockedTimes:[],showWeekOnHome:true};
      const event=normalize([{...fixture,hid:'event',name:'Celebration',type:'task',target:null,
        dueDate:day,eventTime:at(17),durationMinutes:240,breakable:true,minChunkMinutes:15,
        earlyWindowDays:0,delayAllowanceDays:0,autoMarkMinutes:null}])[0];
      const interruption=normalize([{...fixture,hid:'pause',name:'Short obligation',type:'keepup',target:1,
        priority:0,durationMinutes:30,allowedTimeStart:19*60,allowedTimeEnd:19*60+30}])[0];
      const runs={};
      async function run(name,data,extra={}){
        runs[name]={};
        for(const engine of exact ? ['fast','glpk'] : ['fast']){
          const current={...settings,...extra,agendaOptimizer:engine==='glpk'};
          const week=engine==='glpk' ? await buildWeekAgendaAsync(data,current,2,{nativeLimitSeconds:4})
            : buildWeekAgenda(data,current,2);
          const rows=week.days[0].timeline.filter(r=>r.i===0 && ['fill','scheduled'].includes(r.kind));
          runs[name][engine]={optimized:Boolean(week.optimized),
            rows:rows.map(r=>({kind:r.kind,start:r.start,end:r.end,minutes:r.chunkMinutes,hard:r.hard,
              first:r.breakableStart,conflict:r.appointmentConflict,unplaced:r.appointmentUnplacedMinutes})),
            total:rows.reduce((n,r)=>n+(r.end-r.start)/60000,0),
            tomorrow:week.days[1].timeline.some(r=>r.i===0),
            warning:appointmentStatusPill(rows.find(r=>r.breakableStart)),
            shifted:shiftAgendaFillToNow(rows,0,at(17,5)),
            busy:week.days[0].timeline.filter(r=>r.i===1).map(r=>({start:r.start,end:r.end})),
            agenda:week.days[0]};
          // Keep returned fixture data compact; only the real rendering smoke below needs the week.
          delete runs[name][engine].agenda;
        }
      }
      try{
        await run('interrupt',[event,interruption]);
        const prep=normalize([{...fixture,hid:'prep',name:'Preparation',type:'keepup',target:1,
          durationMinutes:30,allowedTimeStart:16*60,allowedTimeEnd:17*60,
          scheduleLinks:[{anchorHid:'event',direction:'before',adjacency:'direct',requireSameDay:true}]}])[0];
        await run('linked',[event,prep]);
        await run('zeroCapacity',[event],{availabilityOverrides:{[dateKey(day)]:0}});
        await run('busyStart',[event],{blockedTimes:[{label:'Meeting',days:[],start:17*60,end:18*60}]});
        const other={...event,hid:'other',name:'Other appointment',breakable:false,durationMinutes:60};
        await run('collision',[event,other]);
        await run('allBusy',[event],{blockedTimes:[{label:'Busy day',days:[],start:0,end:1440}]});
        await run('end',[{...event,allowedTimeStart:17*60,allowedTimeEnd:21*60},interruption]);
        await run('endOnly',[{...event,allowedTimeEnd:21*60},interruption]);
        await run('flexibleDate',[{...event,earlyWindowDays:7,delayAllowanceDays:7},interruption]);
        await run('whole',[{...event,breakable:false},interruption]);
        await run('timedPlan',[{...event,eventTime:null,logs:[makePlanLog(at(17),{timed:true})]},interruption]);
        await run('planOverride',[{...event,logs:[makePlanLog(at(16),{timed:true})]},interruption]);
        const locationSettings={...settings,lastKnownLocationId:'home',defaultTravelMode:'walking',locations:[
          {id:'home',name:'Home',lat:40,lng:-74},
          {id:'hall',name:'Hall',lat:40.01,lng:-74}
        ]};
        const locatedEvent={...event,locationIds:['hall'],anywhereAllowed:false};
        const locatedWeek=buildWeekAgenda([locatedEvent],locationSettings,2);
        const reminders=nativeReminderEvents(locatedWeek,[locatedEvent],locationSettings,
          {enabled:true,items:{'item:event':{start:'notification',travelStart:'notification'}}},now);
        const firstReminder=reminders.find(r=>r.reminderEdge==='start' && r.agendaAt===at(17));
        const departure=reminders.find(r=>r.reminderEdge==='travelStart');
        const fixedReminders=Boolean(firstReminder && !firstReminder.upNext && departure && !departure.upNext);
        const workerChecks={};
        for(const mode of exact ? ['fast','glpk'] : ['fast']){
          const week=await buildWeekAgendaOffMain([event],settings,2,mode,{nativeLimitSeconds:4});
          const row=week.days[0].timeline.find(row=>row.breakableStart);
          workerChecks[mode]=Boolean(row && row.start===at(17) && row.hard);
        }
        now=at(18);
        await run('afterStart',[event,interruption]);
        await run('partial',[{...event,logs:[{ts:at(17,30),minutes:60}],lastLog:at(17,30)},interruption]);
        await run('finishUp',[{...event,logs:[{ts:at(17,30),minutes:235}],lastLog:at(17,30)}]);
        const done={...event,logs:[{ts:at(17,30),minutes:240}],lastLog:at(17,30)};
        await run('done',[done]);
        // Classic Today must obey the same fixed-start semantics.
        const priorSettings=sortSettings;sortSettings=settings;
        const classic=buildTodayTimeline(buildTodayAgenda([event,interruption],settings));
        sortSettings=priorSettings;
        const classicStart=classic.find(row=>row.i===0 && row.breakableStart)?.start;
        const firm=normalize([{...event,eventTime:null,delayAllowanceDays:0,earlyWindowDays:0}])[0];
        const earlyFirm=normalize([{...firm,earlyWindowDays:7}])[0];
        const partialDescription=aboutText({...event,logs:[{ts:at(17,30),minutes:60}],lastLog:at(17,30)});
        const dated={firm:firm.hardDue,earlyFirm:earlyFirm.hardDue,
          fixed:isFixedTimedTask(firm),events:collectScheduledAgendaEvents([firm],dateKey(day),settings).length};
        // Render the actual card to verify warnings survive ordinary presentation.
        sortSettings={...settings,showWeekOnHome:true,preset:'todayFirst',minimalMode:false};
        const uiSettings={...sortSettings,blockedTimes:[{label:'Meeting',days:[],start:17*60,end:18*60}]};
        sortSettings=uiSettings;save([event]);
        render({__fromOptimizer:true,__optimizedWeek:buildWeekAgenda([event],uiSettings,2)});
        const uiText=document.querySelector('#list')?.textContent;
        const uiConflict=uiText?.includes('Overlaps Meeting');
        const fixedRow=_homeRenderedWeek.days[0].timeline.find(row=>row.breakableStart);
        const draggable=isAgendaFillDraggable(event,fixedRow);
        $('ting-due-date').value=dateKey(day);$('ting-due-time').value='17:00';syncTaskDueUi();
        const addHint=$('task-due-hint').textContent;
        sortSettings=priorSettings;
        return {runs,fixedReminders,workerChecks,draggable,uiConflict,addHint,partialDescription,at17:at(17),at16:at(16),at21:at(21),classicStart,dated};
      }finally{globalThis.Date=RealDate;}
    },{fixture:baseHabit({}),settings:openEveningSettings(),exact});
    let passed=0;
    const check=(value,message)=>{assert.ok(value,message);passed++;console.log(`  ok: ${message}`);};
    for(const engine of exact ? ['fast','glpk'] : ['fast']){
      const r=name=>result.runs[name][engine];
      for(const name of ['interrupt','zeroCapacity','busyStart','collision','allBusy','end','endOnly','flexibleDate','whole','timedPlan','afterStart','partial','finishUp']){
        check(r(name).rows[0]?.start===result.at17,`${engine}: ${name} keeps the entered start`);
        check(!r(name).tomorrow,`${engine}: ${name} does not move the event to tomorrow`);
      }
      check(r('interrupt').total===240 && r('interrupt').rows.at(-1).end>result.at21,`${engine}: four hours total finishes later after an interruption`);
      check(r('interrupt').rows.every(row=>r('interrupt').busy.every(b=>row.start>=b.end || row.end<=b.start)),`${engine}: interruptions do not overlap event sessions`);
      check(r('zeroCapacity').rows[0].hard && r('zeroCapacity').warning.includes('still not scheduled'),`${engine}: no capacity retains the appointment and explains the shortfall`);
      for(const name of ['busyStart','collision','allBusy'])check(r(name).warning.includes('Overlaps'),`${engine}: ${name} is visible as a conflict`);
      for(const name of ['end','endOnly'])check(r(name).rows.every(row=>row.end<=result.at21) && r(name).total<240 && r(name).warning.includes('still not scheduled'),`${engine}: ${name} is a hard finish, with an explicit remainder`);
      check(r('afterStart').total===240 && r('afterStart').rows.some(row=>row.start>result.at17),`${engine}: cold open after the start retains resumable sessions`);
      check(r('partial').total===180 && r('finishUp').total===5,`${engine}: partial logs and sub-minimum finish-up keep the remaining budget`);
      check(r('done').rows.length===0,`${engine}: completed event leaves the agenda`);
      check(r('whole').rows.length===1 && r('whole').total===240,`${engine}: unbreakable appointment reserves its full duration`);
      check(r('timedPlan').total===240 && r('planOverride').rows[0].start===result.at16,`${engine}: explicit timed plans use the same breakable semantics and override the saved clock`);
      check(r('linked').busy.length>0 && r('linked').busy.every(row=>row.end<=result.at17),`${engine}: a linked predecessor stays before the fixed start`);
      check(r('interrupt').shifted===null,`${engine}: clock ticks cannot slide the first appointment session`);
      if(engine==='glpk')check(r('interrupt').optimized, 'GLPK exercised the exact optimizer');
    }
    check(result.classicStart===result.at17,'classic Today preserves the fixed first start after it has passed');
    check(result.dated.firm && result.dated.earlyFirm && !result.dated.fixed && result.dated.events===0,'zero delay makes a date firm without inventing an appointment clock');
    check(result.fixedReminders,'appointment start and departure reminders retain fixed timing');
    check(Object.values(result.workerChecks).every(Boolean),'off-main workers preserve the fixed start in both planner modes');
    check(!result.draggable,'fixed first sessions cannot be dragged to another clock');
    check(result.uiConflict,'event card visibly explains a fixed-start conflict');
    check(result.addHint.includes('including when breakable') && result.addHint.includes('Allowed times'),'add sheet distinguishes fixed start, total duration and hard end');
    check(!result.partialDescription.startsWith('Done.'),'partial participation is not described as completed');
    check(errors.length===0,'no page errors');
    console.log(`\n${passed} passed, 0 failed`);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
