const assert = require('node:assert/strict');
const {chromium, BASE, baseHabit, plannerSettings} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage();
    await page.goto(BASE,{waitUntil:'networkidle'});
    const settings = plannerSettings([]);
    const habits = [
      baseHabit({hid:'work',name:'Focused hours',target:1,priority:0,breakable:true,
        durationMinutes:80,minChunkMinutes:60,allowedTimeStart:540,allowedTimeEnd:620}),
      baseHabit({hid:'first',name:'Flexible visit',type:'task',target:null,priority:2,
        durationMinutes:15,allowedTimeStart:540,allowedTimeEnd:620}),
      baseHabit({hid:'second',name:'Flexible pickup',type:'task',target:null,priority:3,
        durationMinutes:15,allowedTimeStart:540,allowedTimeEnd:620}),
      baseHabit({hid:'anchor',name:'Narrow daily anchor',target:1,priority:0,
        durationMinutes:15,allowedTimeStart:525,allowedTimeEnd:540}),
      baseHabit({hid:'warmup',name:'Flexible daily anchor',target:1,priority:0,
        durationMinutes:15,allowedTimeStart:510,allowedTimeEnd:540,
        preferredTimeStart:525,preferredTimeEnd:540})
    ];
    const results = await page.evaluate(async ({habits,settings})=>{
      const RealDate = Date;
      let now = new RealDate(2026,10,17,8).getTime();
      const firstDay = dayStart(now);
      const secondDay = offsetCalendarDay(firstDay,1);
      const clock = (day,minute)=>day + minute * 60000;
      globalThis.Date = class extends RealDate{
        constructor(...args){super(...(args.length ? args : [now]));}
        static now(){return now;}
      };
      beginPlannerSolveCaches(habits);
      try{
        const makeState = (dayBase)=>createDayPlacementState({
          dayBase,weekday:new Date(dayBase).getDay(),agendaItems:[],scheduled:[],totalMinutes:250,
          slots:[{start:clock(dayBase,510),end:clock(dayBase,690)}]
        },settings);
        const place = (state,c,start)=>{
          const fill = {h:c.h,i:c.i,priority:c.priority};
          const fit = auditFillFitInGap(state,fill,{
            start:clock(state.dayBase,start),end:clock(state.dayBase,start+c.h.durationMinutes)
          },state.remaining);
          if(!fit)throw new Error(`Invalid test fixture for ${c.h.name}`);
          fit.placeKey = c.i;
          commitPlacement(state,fill,fit);
        };
        const trial = ({strict = false, unavailable = false} = {})=>{
          const source = makeState(firstDay);
          const target = makeState(secondDay);
          const candidates = habits.map((habit,i)=>{
            const h = {...habit};
            if(i === 1 || i === 2)h.dueDate = strict && i === 2 ? firstDay : secondDay;
            const days = i === 0 || i > 2 || (unavailable && i === 2)
              ? [firstDay] : [firstDay,secondDay];
            return {h,i,priority:h.priority,eligible:new Set(days)};
          });
          // The whole-day greedy replay tries the flexible anchor first and
          // can consume the narrow anchor's only valid time.
          place(source,candidates[4],510);
          place(source,candidates[3],525);
          place(source,candidates[1],555);
          place(source,candidates[2],590);
          placeBreakableSessions(source,{h:candidates[0].h,i:0,priority:0},{settings});
          const summarize = state=>state.fills.map(({fill,fit})=>[
            fill.i,Math.round((fit.placeStart-state.dayBase)/60000),fit.durMin
          ]).sort((a,b)=>a[1]-b[1]);
          const before = summarize(source);
          const moves = repairWeekPlacedHours(candidates,[source,target],settings);
          return {before,moves,source:summarize(source),target:summarize(target)};
        };
        const repair = trial();
        const strict = trial({strict:true});
        const unavailable = trial({unavailable:true});
        const dated = habits.map((h,i)=>i === 1 || i === 2 ? {...h,dueDate:secondDay} : h);
        const agenda = (rows,date)=>({dayBase:date,plannedAt:now,timeline:rows.map(([i,start,minutes])=>({
          kind:'fill',i,start:clock(date,start),end:clock(date,start + minutes),locationId:null,
          chunkIndex:i === 0 ? 0 : null,
          occurrenceKey:i === 0 ? null : `${habits[i].hid}:${dateKey(date)}:general`
        }))});
        const incumbent = {days:[agenda(repair.before,firstDay),agenda([],secondDay)]};
        const relocated = {days:[agenda(repair.source,firstDay),agenda(repair.target,secondDay)]};
        const late = {days:[relocated.days[0],agenda([],secondDay),
          agenda(repair.target,offsetCalendarDay(secondDay,1))]};
        const lost = {days:[relocated.days[0],agenda([],secondDay)]};
        const shortened = {days:[relocated.days[0],agenda(repair.target.map(([i,start,minutes])=>
          [i,start,minutes - 1]),secondDay)]};
        const wrongWeekday = dated.map((h,i)=>i === 1 ? {...h,allowedWeekdays:[new Date(firstDay).getDay()]} : h);
        const previousTry = now;
        now = clock(firstDay,512);
        const shiftsActive = {days:[agenda(repair.source.map(([i,start,minutes])=>
          [i,i === 4 ? start + 1 : start,minutes]),firstDay),relocated.days[1]]};
        const publication = {
          accepts:homeAgendaRefinementIsBetter(incumbent,relocated,dated,settings),
          rejectsLate:!homeAgendaRefinementIsBetter(incumbent,late,dated,settings),
          rejectsLost:!homeAgendaRefinementIsBetter(incumbent,lost,dated,settings),
          rejectsShortened:!homeAgendaRefinementIsBetter(incumbent,shortened,dated,settings),
          rejectsWrongWeekday:!homeAgendaRefinementIsBetter(incumbent,relocated,wrongWeekday,settings),
          preservesActive:!homeAgendaRefinementIsBetter(incumbent,shiftsActive,dated,settings)
        };
        const progress = {
          dirty:_optimizerHomeRefinementTrackedDirty,pass:_optimizerHomeRefinementPass,
          done:_optimizerHomeRefinementDoneKey,proven:_optimizerHomeProvenDayKeys
        };
        try{
          resetHomeAgendaRefinementProgress('test');
          _optimizerHomeRefinementPass = 3;
          resetHomeAgendaRefinementProgress('test',{before:relocated,after:relocated,data:dated});
          publication.sameCoverageKeepsProgress = _optimizerHomeRefinementPass === 3;
          resetHomeAgendaRefinementProgress('test',{before:relocated,after:incumbent,data:dated});
          publication.lostHoursRestartRefinement = _optimizerHomeRefinementPass === 0;
          _optimizerHomeRefinementPass = 3;
          const transfersHours = {days:[{
            ...relocated.days[0],timeline:relocated.days[0].timeline.map(row=>
              row.i === 0 ? {...row,i:dated.length} : row)
          },relocated.days[1]]};
          resetHomeAgendaRefinementProgress('test',{
            before:relocated,after:transfersHours,data:[...dated,{...dated[0],hid:'other-work'}]
          });
          publication.lostHoursPerHabitRestartRefinement = _optimizerHomeRefinementPass === 0;
        }finally{
          _optimizerHomeRefinementTrackedDirty = progress.dirty;
          _optimizerHomeRefinementPass = progress.pass;
          _optimizerHomeRefinementDoneKey = progress.done;
          _optimizerHomeProvenDayKeys = progress.proven;
        }
        let publishedRepair = null;
        if(!agendaPlannerForcedFast()){
          const refined = await buildWeekAgendaAsync(dated,settings,2,{
            refine:true,memoDays:memoDaysFromWeek(incumbent)
          });
          publishedRepair = {
            anchored:refined.plannerDiagnostics?.incumbentHoursRepair === true,
            accepted:homeAgendaRefinementIsBetter(incumbent,refined,dated,settings),
            source:refined.days[0].timeline.filter(row=>row.kind === 'fill').map(row=>[
              row.i,(row.start-firstDay)/60000,(row.end-row.start)/60000
            ]),
            rehomed:refined.days[1].timeline.filter(row=>row.kind === 'fill' && [1,2].includes(row.i))
              .map(row=>row.i).sort()
          };
        }
        now = previousTry;
        saveOrderConstraintsForDrop(firstDay,[{
          beforeHid:'anchor',afterHid:'first',adjacency:'sometime'
        }]);
        beginPlannerSolveCaches(habits);
        const linked = trial();
        const week = rows=>({days:[
          {timeline:[]},{timeline:rows},{timeline:[]}
        ]});
        const futureFill = (i,start,minutes)=>({
          kind:'fill',i,start:clock(secondDay,start),end:clock(secondDay,start + minutes)
        });
        const before = week([futureFill(1,540,15)]);
        const after = week([futureFill(0,540,80),futureFill(1,620,15)]);
        return {repair,strict,unavailable,linked,publication,publishedRepair,
          futureRefinement:homeAgendaRefinementIsBetter(before,after,habits,settings)};
      }finally{
        endPlannerSolveCaches();
        globalThis.Date = RealDate;
      }
    },{habits,settings});
    assert.deepEqual(results.repair.before,[[4,510,15],[3,525,15],[1,555,15],[2,590,15]]);
    assert.equal(results.repair.moves,2);
    assert.deepEqual(results.repair.source,[[4,510,15],[3,525,15],[0,540,80]]);
    assert.deepEqual(results.repair.target.map(row=>row[0]).sort(),[1,2]);
    for(const control of [results.strict,results.unavailable,results.linked]){
      assert.equal(control.moves,0);
      assert.deepEqual(control.source,control.before);
      assert.deepEqual(control.target,[]);
    }
    assert.equal(results.futureRefinement,true);
    assert.ok(Object.values(results.publication).every(Boolean),JSON.stringify(results.publication));
    if(results.publishedRepair){
      assert.equal(results.publishedRepair.anchored,true);
      assert.equal(results.publishedRepair.accepted,true);
      assert.deepEqual(results.publishedRepair.source,results.repair.source);
      assert.deepEqual(results.publishedRepair.rehomed,[1,2]);
    }
    console.log('Hours repair retains imminent and active anchors and publishes legal deferrals. Deadlines, links and missing destinations prevent a move.');
  }finally{
    await browser.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
