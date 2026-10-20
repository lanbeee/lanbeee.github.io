const assert=require('assert');
const {chromium,BASE,baseHabit,plannerSettings}=require('./helpers/planner-test-helpers');

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({timezoneId:'America/New_York',serviceWorkers:'block'});
    await page.goto(BASE);
    await page.waitForFunction(()=>typeof buildWeekAgenda==='function' && typeof reclaimDueWindowFromShortFragment==='function');
    const now=Date.parse('2026-10-20T07:50:00-04:00');
    const day=now-470*60000,ms=86400000;
    const habits=start=>[
      baseHabit({hid:'dose',name:'Morning dose',target:1,logs:[day-ms],
        durationMinutes:10,priority:2}),
      baseHabit({hid:'stretch',name:'Short stretch',target:3,logs:[day-4*ms],
        durationMinutes:5,priority:2}),
      baseHabit({hid:'meal',name:'Breakfast',target:1,logs:[day-ms],priority:2,
        durationMinutes:10,allowedTimeStart:start,allowedTimeEnd:630}),
      baseHabit({hid:'work',name:'Daily work',target:1,logs:[day-ms],priority:0,
        durationMinutes:360,breakable:true,minChunkMinutes:45,
        allowedTimeStart:510,allowedTimeEnd:1200}),
      baseHabit({hid:'call',name:'Weekly call',target:7,logs:[day-8*ms],
        durationMinutes:30,allowedTimeStart:1305,allowedTimeEnd:780,priority:2})
    ];
    const openHabits=habits(510),tightHabits=habits(509);
    const row=(props)=>baseHabit(Object.assign({priority:2,logs:[day-86400000]},props));
    const sameWindowHabits=[
      row({hid:'stretch',name:'Short stretch',target:3,logs:[day-4*86400000],durationMinutes:5}),
      row({hid:'call',name:'Weekly call',target:7,logs:[day-8*86400000],durationMinutes:30,
        allowedTimeStart:480,allowedTimeEnd:720})
    ];
    const pairHabits=[
      row({hid:'dose',name:'Morning dose',target:1,durationMinutes:10}),
      row({hid:'stretch-a',name:'First stretch',target:7,durationMinutes:5}),
      row({hid:'stretch-b',name:'Second stretch',target:7,durationMinutes:5}),
      row({hid:'meal',name:'Breakfast',target:1,durationMinutes:10,allowedTimeStart:510,allowedTimeEnd:630}),
      row({hid:'work',name:'Daily work',target:1,durationMinutes:360,breakable:true,minChunkMinutes:45,
        priority:0,allowedTimeStart:510,allowedTimeEnd:1200}),
      row({hid:'call',name:'Weekly call',target:7,logs:[day-8*86400000],durationMinutes:30,
        allowedTimeStart:1305,allowedTimeEnd:780})
    ];
    const unrelatedHabits=[
      row({hid:'dose',name:'Morning dose',target:1,durationMinutes:10}),
      row({hid:'stretch',name:'Noon stretch',target:7,durationMinutes:5}),
      row({hid:'call',name:'Weekly call',target:7,logs:[day-8*86400000],durationMinutes:30,
        allowedTimeStart:1305,allowedTimeEnd:780})
    ];
    const preferredHabits=[
      row({hid:'stretch',name:'Preferred stretch',target:3,durationMinutes:20,
        preferredTimeStart:480,preferredTimeEnd:500}),
      row({hid:'call',name:'Weekly call',target:7,logs:[day-8*86400000],durationMinutes:30,
        allowedTimeStart:1305,allowedTimeEnd:780})
    ];
    const settledHabits=[
      row({hid:'trash',name:'Throw trash',target:7,durationMinutes:10}),
      row({hid:'stretch',name:'Shower',target:7,durationMinutes:5}),
      row({hid:'meal',name:'Breakfast',target:1,durationMinutes:10,allowedTimeStart:510,allowedTimeEnd:630}),
      row({hid:'call',name:'Weekly call',target:7,logs:[day-8*86400000],durationMinutes:30,
        allowedTimeStart:1305,allowedTimeEnd:780})
    ];
    const scoreTrapHabits=[
      row({hid:'stretch-a',name:'First overdue item',target:3,logs:[day-4*86400000],durationMinutes:5}),
      row({hid:'stretch-b',name:'Second overdue item',target:3,logs:[day-4*86400000],durationMinutes:5}),
      row({hid:'call',name:'Due item',target:7,logs:[day-8*86400000],durationMinutes:30,
        allowedTimeStart:1305,allowedTimeEnd:510})
    ];
    const localBlockerHabits=[
      row({hid:'blocker',name:'Movable blocker',target:7,durationMinutes:10}),
      ...[540,600,660].map((start,i)=>row({hid:`pocket-${i}`,name:`Fixed pocket ${i}`,
        target:7,durationMinutes:5,allowedTimeStart:start,allowedTimeEnd:start+5})),
      row({hid:'call',name:'Due item',target:7,logs:[day-8*86400000],durationMinutes:30,
        allowedTimeStart:1305,allowedTimeEnd:780})
    ];
    const scoreTrapSettings=plannerSettings([
      {label:'sleep',days:[],start:0,end:480},
      {label:'day',days:[],start:510,end:1200},
      {label:'night',days:[],start:1380,end:1440}
    ]);
    const localBlockerSettings=plannerSettings([
      {start:0,end:480},{start:510,end:540},{start:545,end:600},
      {start:605,end:660},{start:665,end:1305},{start:1380,end:1440}
    ].map((window,i)=>({...window,label:`busy-${i}`,days:[]})));
    const preferredSettings=plannerSettings([
      {label:'sleep',days:[],start:0,end:480},
      {label:'midday',days:[],start:510,end:1200},
      {label:'night',days:[],start:1320,end:1440}
    ]);
    const settings=plannerSettings([
      {label:'sleep',days:[],start:0,end:470},
      {label:'night',days:[],start:1380,end:1440}
    ]);
    const result=await page.evaluate(({openHabits,tightHabits,sameWindowHabits,pairHabits,unrelatedHabits,preferredHabits,preferredSettings,settledHabits,scoreTrapHabits,scoreTrapSettings,localBlockerHabits,localBlockerSettings,settings,now})=>{
      const RealDate=Date;
      globalThis.Date=class extends RealDate{
        constructor(...args){super(...(args.length?args:[now]));}
        static now(){return now;}
      };
      const clock=(state,idx)=>state.fills.filter(entry=>entry.fill.i===idx).map(entry=>[
        Math.round((entry.fit.placeStart-state.dayBase)/60000),
        Math.round((entry.fit.placeEnd-state.dayBase)/60000)
      ]);
      const build=(rows,opts={})=>{
        const data=normalize(rows);
        save(data);saveSortSettings(settings);sortSettings=settings;
        beginPlannerSolveCaches(data);
        const dayBase=dayStart(now);
        const state=createDayPlacementState(
          buildDayAgenda(data,settings,dayBase,{weekMode:true,now}),
          settings,{dayBase,now,weekMode:true});
        const eligibleDays=opts.eligibleDays || [dayBase];
        const candidates=data.map((h,i)=>({h,i,priority:h.priority,urgency:weekUrgency(h),
          eligible:new Set(eligibleDays)}));
        const place=(idx)=>{
          const fill={h:data[idx],i:idx,priority:data[idx].priority};
          if(data[idx].breakable){
            placeBreakableSessions(state,fill,{settings,allowNetwork:false});
            return true;
          }
          const fit=tryPlaceOnDay(state,fill,{settings,allowNetwork:false});
          if(!fit)return false;
          commitPlacement(state,fill,fit);
          return true;
        };
        // Dose, then the short row, then breakfast and work, then the call.
        // That is the fragmented incumbent the final check has to repair.
        for(const idx of [0,1,2,3,4]){
          if(!place(idx))return {error:'could not seed '+data[idx].name};
        }
        syncDayAgendaItemsFromFills(state);
        const before={
          call:clock(state,4),
          stretch:clock(state,1),
          dose:clock(state,0),
          work:placedBreakableMinutes(state,3)
        };
        const snapshot=JSON.stringify(state);
        const moved=reclaimDueWindowFromShortFragment(candidates,[state],settings);
        const again=reclaimDueWindowFromShortFragment(candidates,[state],settings);
        return {before,moved,again,
          call:clock(state,4),stretch:clock(state,1),dose:clock(state,0),
          work:placedBreakableMinutes(state,3),
          unchanged:moved===0 ? JSON.stringify(state)===snapshot : true};
      };
      const commitAt=(state,data,idx,startMin,dur)=>{
        const start=state.dayBase+startMin*60000;
        commitPlacement(state,{h:data[idx],i:idx,priority:data[idx].priority},{
          placeStart:start,placeEnd:start+dur*60000,durMin:dur,travelMin:0,
          locId:null,placeKey:idx,edge:null
        });
      };
      const scripted=(rows,clocks,useSettings=settings)=>{
        const data=normalize(rows);
        save(data);saveSortSettings(useSettings);sortSettings=useSettings;
        beginPlannerSolveCaches(data);
        const dayBase=dayStart(now);
        const state=createDayPlacementState(
          buildDayAgenda(data,useSettings,dayBase,{weekMode:true,now}),
          useSettings,{dayBase,now,weekMode:true});
        const candidates=data.map((h,i)=>({h,i,priority:h.priority,urgency:weekUrgency(h),
          eligible:new Set([dayBase])}));
        for(const [idx,startMin,dur] of clocks)commitAt(state,data,idx,startMin,dur);
        for(let i=0;i<data.length;i+=1){
          if(!data[i].breakable)continue;
          placeBreakableSessions(state,{h:data[i],i,priority:data[i].priority},{
            settings:useSettings,allowNetwork:false
          });
        }
        syncDayAgendaItemsFromFills(state);
        const beforeCall=clock(state,rows.findIndex(h=>h.hid==='call'));
        const beforeStretch=clock(state,rows.findIndex(h=>h.hid==='stretch' || h.hid==='stretch-a'));
        const snapshot=JSON.stringify(state);
        const beforeRows=state.fills.map(entry=>[entry.fill.i,...clock(state,entry.fill.i)[0]]);
        const moved=reclaimDueWindowFromShortFragment(candidates,[state],useSettings);
        const callIdx=data.findIndex(h=>h.hid==='call');
        const stretchIdx=data.findIndex(h=>h.hid==='stretch' || h.hid==='stretch-a');
        const secondIdx=data.findIndex(h=>h.hid==='stretch-b');
        return {moved,beforeCall,beforeStretch,beforeRows,
          call:clock(state,callIdx),stretch:clock(state,stretchIdx),
          second:secondIdx<0?[]:clock(state,secondIdx),
          rows:state.fills.map(entry=>[entry.fill.i,...clock(state,entry.fill.i)[0]]),
          dose:clock(state,data.findIndex(h=>h.hid==='dose')),
          work:placedBreakableMinutes(state,data.findIndex(h=>h.hid==='work')),
          unchanged:moved===0 ? JSON.stringify(state)===snapshot : true};
      };
      try{
        const open=build(openHabits);
        const tight=build(tightHabits);
        const weekEligible=[0,1,2,3,4,5,6].map(offset=>dayStart(now)+offset*86400000);
        const protectedPriority=build(openHabits.map(h=>h.hid==='stretch'?{...h,priority:0}:h),{eligibleDays:weekEligible});
        const protectedDaily=build(openHabits.map(h=>h.hid==='stretch'?{...h,target:1,logs:[dayStart(now)-86400000]}:h));
        const linked=build(openHabits.map(h=>h.hid==='stretch'?{...h,scheduleLinks:[{
          anchorHid:'dose',direction:'after',adjacency:'direct',requireSameDay:true
        }]}:h));
        const sameWindow=scripted(sameWindowHabits,[[0,480,5],[1,660,30]]);
        const pair=scripted(pairHabits,[[0,470,10],[1,480,5],[2,485,5],[3,510,10],[5,1305,30]]);
        const unrelated=scripted(unrelatedHabits,[[0,470,10],[1,720,5],[2,1305,30]]);
        const preferred=scripted(preferredHabits,[[0,480,20],[1,1305,30]],preferredSettings);
        const settled=scripted(settledHabits,[[0,465,10],[1,475,5],[2,510,10],[3,480,30]]);
        const scoreTrap=scripted(scoreTrapHabits,[[0,480,5],[1,485,5],[2,1305,30]],scoreTrapSettings);
        const localBlocker=scripted(localBlockerHabits,
          [[0,480,10],[1,540,5],[2,600,5],[3,660,5],[4,1305,30]],localBlockerSettings);
        setDoingNow('stretch',now,dayStart(now));
        const doing=build(openHabits);
        clearDoingNow();
        const data=normalize(openHabits);
        save(data);saveSortSettings(settings);sortSettings=settings;
        const week=buildWeekAgenda(data,{...settings,agendaOptimizer:false},7,{skipDropAnnotation:true});
        const call=data.findIndex(h=>h.name==='Weekly call');
        const stretch=data.findIndex(h=>h.name==='Short stretch');
        const work=data.findIndex(h=>h.name==='Daily work');
        const day0=week.days[0];
        const at=(idx)=>day0.timeline.filter(row=>row.kind==='fill'&&row.i===idx).map(row=>[
          Math.round((row.start-day0.dayBase)/60000),
          Math.round((row.end-day0.dayBase)/60000)
        ]);
        const workMinutes=day0.timeline.filter(row=>row.kind==='fill'&&row.i===work)
          .reduce((sum,row)=>sum+Math.round((row.end-row.start)/60000),0);
        return {open,tight,sameWindow,pair,unrelated,protectedPriority,protectedDaily,linked,preferred,settled,scoreTrap,localBlocker,doing,
          week:{call:at(call),stretch:at(stretch),workMinutes}};
      }finally{globalThis.Date=RealDate;endPlannerSolveCaches();}
    },{openHabits,tightHabits,sameWindowHabits,pairHabits,unrelatedHabits,preferredHabits,preferredSettings,settledHabits,scoreTrapHabits,scoreTrapSettings,localBlockerHabits,localBlockerSettings,settings,now});
    assert(!result.open.error,result.open.error || 'open fixture seeded');
    assert.deepStrictEqual(result.open.before.call,[[1305,1335]],'the due call starts in the later segment');
    assert.deepStrictEqual(result.open.before.stretch,[[480,485]],'a five-minute row fragments 8:00');
    assert.strictEqual(result.open.moved,1,'move the due call into the earlier segment');
    assert.deepStrictEqual(result.open.call,[[480,510]],'the call takes 8:00–8:30');
    assert.strictEqual(result.open.stretch.length,1,'the short row stays on the same day');
    assert.notDeepStrictEqual(result.open.stretch,[[480,485]],'the short row leaves the fragmented slot');
    assert.deepStrictEqual(result.open.dose,[[470,480]],'the daily row keeps its clock');
    assert.strictEqual(result.open.work,360,'daily work minutes stay whole');
    assert.strictEqual(result.open.again,0,'the repair does not repeat');

    assert(!result.tight.error,result.tight.error || 'tight fixture seeded');
    assert.strictEqual(result.tight.moved,0,'a 29-minute opening cannot hold 30 minutes');
    assert(result.tight.unchanged,'a rejected repair leaves the day untouched');
    assert.deepStrictEqual(result.tight.call,result.tight.before.call,'the later segment stays when the earlier one is short');

    assert.deepStrictEqual(result.week.call,[[480,510]],'a full fast week uses the earlier segment');
    assert.strictEqual(result.week.stretch.length,1,'the short row is still planned today');
    assert.strictEqual(result.week.workMinutes,360,'the full week keeps daily work');

    assert.strictEqual(result.sameWindow.moved,0,'a later minute inside one segment is left alone');
    assert.deepStrictEqual(result.sameWindow.call,[[660,690]],'the due item keeps its place in that segment');
    assert.deepStrictEqual(result.sameWindow.stretch,[[480,485]],'the short row at the open stays put');
    assert(result.sameWindow.unchanged,'an in-segment incumbent is not rewritten');

    assert.strictEqual(result.settled.moved,0,'a due item already in its early segment stays there');
    assert.deepStrictEqual(result.settled.call,[[480,510]],'8:00–8:30 is not pulled over the rows in front of it');
    assert.deepStrictEqual(result.settled.stretch,[[475,480]],'the short row in front keeps its clock');
    assert(result.settled.unchanged,'a settled early segment is not rewritten');

    assert(result.pair.moved>=1,'two short rows can open one due slot');
    assert.deepStrictEqual(result.pair.call,[[480,510]],'the pair frees 8:00–8:30');
    assert.strictEqual(result.pair.stretch.length,1,'the first short row stays today');
    assert.strictEqual(result.pair.second.length,1,'the second short row stays today');
    assert.deepStrictEqual(result.pair.dose,[[470,480]],'the daily row keeps its clock');
    assert.strictEqual(result.pair.work,360,'paired repair keeps daily work');

    assert(result.unrelated.moved>=1,'a free earlier start does not need a victim');
    assert.deepStrictEqual(result.unrelated.call,[[480,510]],'the due item takes the open start');
    assert.deepStrictEqual(result.unrelated.stretch,[[720,725]],'a noon row outside that start stays put');

    assert.strictEqual(result.protectedPriority.moved,0,'a higher-priority short row is not a fragment');
    assert.deepStrictEqual(result.protectedPriority.call,result.protectedPriority.before.call,'the due item stays when the blocker outranks it');
    assert.deepStrictEqual(result.protectedPriority.stretch,[[480,485]],'the higher-priority row keeps its clock');

    assert.strictEqual(result.protectedDaily.moved,0,'a daily row is not a fragment');
    assert.deepStrictEqual(result.protectedDaily.call,result.protectedDaily.before.call,'the due item stays behind a daily row');
    assert.deepStrictEqual(result.protectedDaily.stretch,[[480,485]],'the daily row keeps its clock');

    assert.strictEqual(result.linked.moved,0,'a present direct neighbor freezes the short row');
    assert.deepStrictEqual(result.linked.call,result.linked.before.call,'the due item stays when the fragment is linked');
    assert.deepStrictEqual(result.linked.stretch,[[480,485]],'the linked row stays attached');

    assert.strictEqual(result.preferred.moved,0,'preference loss can outweigh an earlier due start');
    assert.deepStrictEqual(result.preferred.stretch,result.preferred.beforeStretch,'the preferred short row keeps its clock');
    assert.deepStrictEqual(result.preferred.call,result.preferred.beforeCall,'the due item stays when the swap is a worse score');
    assert(result.preferred.unchanged,'a rejected preference swap leaves the day untouched');

    assert.strictEqual(result.scoreTrap.moved,0,'two equally urgent delayed rows cost more than the due row gains');
    assert(result.scoreTrap.unchanged,'a score-worsening pair leaves every clock untouched');
    assert.deepStrictEqual(result.scoreTrap.rows,result.scoreTrap.beforeRows,'no accepted swap worsens the shared clock score');

    assert.strictEqual(result.localBlocker.moved,1,'unrelated narrow pockets do not hide the useful blocker');
    assert.deepStrictEqual(result.localBlocker.call,[[480,510]],'the due row takes the local 8:00 slot');
    assert.deepStrictEqual(result.localBlocker.rows.filter(row=>row[0]>=1 && row[0]<=3),
      result.localBlocker.beforeRows.filter(row=>row[0]>=1 && row[0]<=3),
      'unrelated narrow pockets retain their clocks');

    assert.strictEqual(result.doing.moved,0,'an active row is not moved');
    assert.deepStrictEqual(result.doing.stretch,[[480,485]],'the active short row keeps its clock');
    assert.deepStrictEqual(result.doing.call,result.doing.before.call,'the due item stays behind an active row');

    console.log('PASS short-fragment repair: local blockers, shared clock score, protections and pair');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
