// A today-only refresh must repair a missing same-day partner, even when the
// sparse subject already has later occurrences in the memoized week.
const {chromium,BASE,glpkAvailable}=require('./helpers/planner-test-helpers');
const assert=require('node:assert/strict');

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({timezoneId:'America/New_York'});
    await page.goto(BASE,{waitUntil:'load'});
    const glpkOk=await glpkAvailable(page);
    const result=await page.evaluate(async glpkOk=>{
      const RealDate=Date;
      const now=new RealDate(2026,10,22,7,40).getTime();
      globalThis.Date=class extends RealDate{
        constructor(...args){super(...(args.length ? args : [now]));}
        static now(){return now;}
      };
      try{
        localStorage.removeItem('tings_v2');
        const today=dayStart(now),day=offset=>today+offset*86400000;
        const settings={...loadSortSettings(),agendaOptimizer:true,
          availabilityMinutes:Array(7).fill(1000),availabilityOverrides:{},
          locations:[],travel:{},blockedTimes:[
            {label:'Sleep',days:[],start:0,end:420},
            {label:'Night',days:[],start:1380,end:1440}
          ]};
        const data=normalize([
          {hid:'anchor',name:'Anchor',type:'keepup',target:3,
            logs:[day(-4)],durationMinutes:45,priority:1},
          {hid:'subject',name:'Subject',type:'keepup',target:3,
            earlyWindowDays:3,delayAllowanceDays:0,
            logs:[day(-4)],durationMinutes:5,priority:2,
            scheduleLinks:[{anchorHid:'anchor',direction:'after',adjacency:'direct',requireSameDay:true}]},
          {hid:'task',name:'Later task',type:'task',dueDate:day(2),
            durationMinutes:15,priority:2}
        ]);
        save(data);
        const row=(i,offset,hour,minute=0)=>({kind:'fill',i,h:data[i],
          start:day(offset)+(hour*60+minute)*60000,
          end:day(offset)+(hour*60+minute+data[i].durationMinutes)*60000});
        const memoDays=Array.from({length:7},(_,offset)=>({
          dayBase:day(offset),plannedAt:now,timeline:offset===0 ? [row(0,0,8)]
            : offset===2 ? [row(2,2,10)] : offset===3 ? [row(0,3,8),row(1,3,8,45)] : [],
          agendaItems:[],usedMinutes:0,remainingMinutes:1000
        }));
        const summarize=week=>({status:week.plannerSolveStatus,solves:week.plannerDiagnostics?.daySolves,
          days:week.days.map(d=>(d.timeline || []).filter(r=>r.kind==='fill')
            .map(r=>({hid:data[r.i].hid,start:r.start,end:r.end})))});
        const fast=summarize(buildWeekAgenda(data,settings,7,{skipDropAnnotation:true}));
        let exact=null,refresh=null,again=null,optional=null,conflict=null;
        if(glpkOk){
          exact=summarize(await buildWeekAgendaAsync(data,settings,7,{skipDropAnnotation:true}));
          const opts={dirtyKey:'linked-today-refresh',day0Only:true,reuseIncumbent:true,
            incumbentSolveStatus:'optimal',memoDays,skipDropAnnotation:true};
          const repaired=await buildWeekAgendaAsync(data,settings,7,opts);
          refresh=summarize(repaired);
          refresh.retainedFuture=memoDays.slice(1).every((day,index)=>
            JSON.stringify(refresh.days[index+1]) === JSON.stringify(day.timeline
              .map(r=>({hid:data[r.i].hid,start:r.start,end:r.end}))));
          again=summarize(await buildWeekAgendaAsync(data,settings,7,{
            ...opts,memoDays:memoDaysFromWeek(repaired),
            priorPlacements:agendaPriorPlacementsFromWeek(repaired)
          }));
          // Optional ordering must not pull a deliberately later occurrence
          // into today or invalidate the normal cached-week optimization.
          const optionalData=normalize(data.map(h=>({...h,scheduleLinks:(h.scheduleLinks || [])
            .map(link=>({...link,requireSameDay:false}))})));
          save(optionalData);
          optional=summarize(await buildWeekAgendaAsync(optionalData,settings,7,{
            ...opts,dirtyKey:'optional-today-refresh'
          }));
          const conflictData=normalize(data.map(h=>h.hid==='subject'
            ? {...h,target:3,earlyWindowDays:0,logs:[day(-4)],lastLog:day(-4)} : h));
          save(conflictData);
          const conflictMemo=memoDays.map((d,index)=>({...d,timeline:index===1 ? [row(1,1,9)] : d.timeline}));
          conflict=summarize(await buildWeekAgendaAsync(conflictData,settings,7,{
            ...opts,dirtyKey:'cadence-conflict-refresh',memoDays:conflictMemo
          }));
        }
        return {fast,exact,refresh,again,optional,conflict};
      }finally{globalThis.Date=RealDate;}
    },glpkOk);
    for(const [mode,week] of Object.entries(result)){
      if(!week){console.log(`skip: ${mode} (GLPK unavailable)`);continue;}
      if(mode==='optional'){
        assert(!week.days[0].some(r=>r.hid==='subject'),'optional ordering keeps the subject assigned later');
        assert(week.days[3].some(r=>r.hid==='subject'),'optional ordering retains its later occurrence');
        assert.equal(week.solves.length,1,'optional ordering keeps the today-only refresh');
        console.log('ok: optional ordering preserves the normal cached-week refresh');
        continue;
      }
      const rows=week.days[0],anchor=rows.find(r=>r.hid==='anchor'),subject=rows.find(r=>r.hid==='subject');
      assert(anchor,`${mode}: anchor stays on today`);
      assert(subject,`${mode}: required subject is placed today despite a later memo occurrence`);
      assert.equal(subject.start,anchor.end,`${mode}: subject follows its anchor directly`);
      assert.equal(rows.filter(r=>r.hid==='subject').length,1,`${mode}: no duplicate subject today`);
      assert.equal(week.days.flat().filter(r=>r.hid==='task').length,1,`${mode}: future one-shot task is not duplicated`);
      if(mode==='refresh')assert(week.retainedFuture,'repair preserves all future rows and clocks when cadence allows');
      if(mode==='conflict'){
        const occurrences=week.days.flat().filter(r=>r.hid==='subject');
        for(let index=1;index<occurrences.length;index++){
          assert(Math.round((occurrences[index].start-occurrences[index-1].start)/86400000)>=3,
            'conflicting memo occurrence is replanned to preserve cadence');
        }
        assert(week.solves.length>1,'cadence conflict reopens the week');
      }
      for(const dayRows of week.days){
        if(dayRows.some(r=>r.hid==='anchor'))assert(dayRows.some(r=>r.hid==='subject'),
          `${mode}: later anchors keep their required subject`);
      }
      console.log(`ok: ${mode} places the linked pair and preserves one-shot work`);
    }
    if(result.again){
      assert.deepEqual(result.again.days.slice(1),result.refresh.days.slice(1),
        'a healthy subsequent refresh keeps future clocks unchanged');
      assert.equal(result.again.solves.length,1,'a healthy subsequent refresh solves only today');
      assert.equal(result.again.solves[0].status,'reused','a healthy subsequent refresh replays its incumbent');
      console.log('ok: healthy refreshes still reuse the incumbent and future days');
    }
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
