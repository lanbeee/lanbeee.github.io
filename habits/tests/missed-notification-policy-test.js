const assert = require('node:assert/strict');
const {chromium,BASE,baseHabit,plannerSettings,glpkAvailable} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('tings_v2','[]');
      localStorage.setItem('tings_coach_essentials_v2','done');
      localStorage.setItem('tings_coach_install_v2','done');
    });
    await page.goto(BASE,{waitUntil:'load'});
    const exact = await glpkAvailable(page);
    const now = new Date(2026,9,7,8).getTime();
    const settings = plannerSettings([],{agendaOptimizer:false});
    const habit = baseHabit({hid:'repeat',name:'Practice',target:0.5,createdAt:now-30*86400000,
      scheduleOptions:[
        {id:'morning',weekdays:[],start:540,end:600,sameDayMode:'alternative'},
        {id:'afternoon',weekdays:[],start:840,end:900,sameDayMode:'separate'},
        {id:'evening',weekdays:[],start:1080,end:1140,sameDayMode:'separate'}
      ]});
    for(const engine of exact ? ['fast','glpk'] : ['fast']){
      const result = await page.evaluate(async({now,habit,settings,engine})=>{
        const RealDate = Date;
        let clock = now;
        window.Date = class extends RealDate {
          constructor(...args){super(...(args.length ? args : [clock]));}
          static now(){return clock;}
        };
        try{
          sortSettings = settings;
          localStorage.removeItem(TODAY_SUGGESTED_KEY);
          const data = normalize([habit]);
          const week = engine === 'glpk'
            ? await buildWeekAgendaAsync(data,{...settings,agendaOptimizer:true},1)
            : buildWeekAgenda(data,settings,1);
          const rows = week.days[0].timeline.filter(row=>row.kind === 'fill');
          const day = dateKey(now), base = dayStart(now);
          const entry = plannerDayExpectation(data,week.days[0],true);
          const snap = {hids:{repeat:{first:now}},expectations:{[day]:entry}};
          clock = base+20*3600000;
          const logged = {...data[0],logs:rows.map(row=>makeActualLog(now,{
            occurrenceKey:row.occurrenceKey,scheduleOptionId:row.scheduleOptionId,scheduledDay:day
          })),lastLog:now};
          const quota = {...data[0],logs:[
            makeActualLog(now,{occurrenceKey:`repeat:${day}:ordinary`,scheduleOptionId:'morning',scheduledDay:day}),
            makeActualLog(now,{occurrenceKey:`repeat:${day}:afternoon`,scheduleOptionId:'afternoon',scheduledDay:day})
          ],lastLog:now};
          const one = {...data[0],logs:[makeActualLog(now,{
            occurrenceKey:rows[0].occurrenceKey,scheduleOptionId:rows[0].scheduleOptionId,scheduledDay:day
          })],lastLog:now};
          return {count:rows.length,
            one:collectMissedFromSnapshot([one],[],snap,{},clock).map(row=>row.occurrenceKey),
            firstKey:rows[0].occurrenceKey,
            logged:collectMissedFromSnapshot([logged],[],snap,{},clock).length,
            quota:collectMissedFromSnapshot([quota],[],snap,{},clock).length,
            visible:agendaRowsAfterCompletions(quota,rows,base).length};
        }finally{window.Date=RealDate;}
      },{now,habit,settings,engine});
      assert(result.count >= 2,`${engine}: actual planner publishes repeated sessions`);
      assert(!result.one.includes(result.firstKey),`${engine}: logging one instance removes that exact missed instance`);
      assert.equal(result.logged,0,`${engine}: completed identities never become missed`);
      assert.equal(result.quota,0,`${engine}: a met quota leaves no missed optional window`);
      assert.equal(result.visible,0,`${engine}: a met quota leaves no actionable agenda row`);
      console.log(`ok: ${engine} repeated completions and optional quota windows`);
    }
    const policy = await page.evaluate(({now,settings,habit})=>{
      const RealDate = Date;
      window.Date = class extends RealDate {
        constructor(...args){super(...(args.length ? args : [now]));}
        static now(){return now;}
      };
      try{
        sortSettings = settings;
        const day = dateKey(now), base = dayStart(now), D = 86400000;
        const yesterday = dateKey(base-D);
        const conditional = normalize([{...habit,hid:'condition',repeatMode:'opportunity',target:7,
          scheduleOptions:[],allowedTimeStart:540,allowedTimeEnd:600}])[0];
        const unseen = {hids:{},expectations:{[day]:{hids:['condition']}}};
        const seen = {hids:{condition:{first:now}},expectations:{[day]:{hids:['condition'],renderedHids:['condition']}}};
        const end = base+16*3600000;
        const collect = (h,snap,at=end)=>collectMissedFromSnapshot([h],[],snap,{},at).length;
        const unseenCount = collect(conditional,unseen);
        const seenCount = collect(conditional,seen);
        const completed = collect({...conditional,logs:[now],lastLog:now},seen);
        // Save and reload to exercise the dated evidence, including rollover.
        saveTodaySuggested({day:yesterday,hids:{condition:{first:base-D}},expectations:{
          [yesterday]:{hids:['condition'],renderedHids:['condition'],recordedAt:base-D}
        }});
        const reopened = collect(conditional,loadTodaySuggested(),now);
        const sparse = normalize([{...habit,hid:'sparse',target:7,scheduleOptions:[],
          allowedTimeStart:540,allowedTimeEnd:600,lastLog:base-10*D,logs:[base-10*D]}])[0];
        const snap = {hids:{sparse:{first:now,lastLogAtFirst:sparse.lastLog}},expectations:{[day]:{hids:['sparse']}}};
        const before = collect(sparse,snap);
        const early = collect({...sparse,logs:[base-3*D],lastLog:base-3*D},{
          hids:{sparse:{first:now,lastLogAtFirst:base-3*D}},expectations:snap.expectations
        });
        localStorage.setItem('tings_v2',JSON.stringify([sparse]));
        logTingAt(0,base-D+12*3600000);
        const afterYesterday = collect(load()[0],snap);
        localStorage.setItem('tings_v2',JSON.stringify([sparse]));
        logTingAt(0,base-2*D+12*3600000);
        const afterTwoDays = collect(load()[0],snap);
        const backdatedBreakable = collect({...load()[0],breakable:true},snap);
        executeUndo();
        const undone = collect(load()[0],snap);
        const daily = collect({...sparse,target:1,logs:[base-D],lastLog:base-D},snap);
        const correctedEarlier = collect({...sparse,logs:[base-D],lastLog:base-D},{
          hids:{sparse:{first:now,lastLogAtFirst:base-D/2}},expectations:snap.expectations
        });
        const task = normalize([{...habit,hid:'task',type:'task',scheduleOptions:[],
          dueDate:base,eventTime:null,logs:[],lastLog:null,allowedTimeStart:540,allowedTimeEnd:600}])[0];
        const taskSnap = {hids:{task:{first:now}},expectations:{[day]:{hids:['task'],renderedHids:['task']}}};
        const taskBefore = collect(task,taskSnap);
        localStorage.setItem('tings_v2',JSON.stringify([task]));
        const edited = load();
        edited[0].dueDate=base+D;
        save(edited);
        const taskMoved = collect(load()[0],taskSnap);
        const taskSomeday = collect({...task,dueDate:null},taskSnap);
        const explicitlyPlanned = collect({...task,dueDate:base+D,logs:[makePlanLog(base+12*3600000)]},taskSnap);
        localStorage.setItem('tings_v2',JSON.stringify([task]));
        logTingAt(0,base-D+12*3600000);
        const taskBackdated = collect(load()[0],taskSnap);
        return {unseenCount,seenCount,completed,reopened,before,early,afterYesterday,afterTwoDays,undone,daily,
          backdatedBreakable,correctedEarlier,taskBefore,taskMoved,taskSomeday,explicitlyPlanned,taskBackdated};
      }finally{window.Date=RealDate;}
    },{now,settings,habit});
    assert.equal(policy.unseenCount,0,'conditional projection alone is not a missed notification');
    assert.equal(policy.seenCount,1,'conditional habit shown on agenda can become missed');
    assert.equal(policy.completed,0,'logging clears the conditional notification');
    assert.equal(policy.reopened,0,'yesterday’s conditional notification expires on day rollover');
    assert.equal(policy.before,1,'a genuinely unresolved catch-up is missed');
    assert.equal(policy.early,1,'an early agenda commitment is still missed when its history did not change');
    assert.equal(policy.afterYesterday,0,'calendar completion yesterday clears the stale catch-up');
    assert.equal(policy.afterTwoDays,0,'calendar completion two days ago clears the stale catch-up');
    assert.equal(policy.undone,1,'undoing that completion restores the unresolved notification');
    assert.equal(policy.daily,1,'yesterday completion does not resolve today’s independent daily');
    assert.equal(policy.backdatedBreakable,0,'calendar completion clears a sparse breakable no longer due today');
    assert.equal(policy.correctedEarlier,0,'moving a completion backward also clears a rhythm no longer due today');
    assert.equal(policy.taskBefore,1,'a dropped due-today task creates a notification');
    assert.equal(policy.taskMoved,0,'saving a later due date clears the old rendered task notification');
    assert.equal(policy.taskSomeday,0,'removing a task due date clears its automatic notification');
    assert.equal(policy.explicitlyPlanned,1,'an explicit today plan remains actionable even before its due date');
    assert.equal(policy.taskBackdated,0,'a task completed yesterday through the calendar clears its notification');
    const dates = await page.evaluate(({settings,habit})=>{
      const RealDate = Date;
      let clock = new RealDate(2026,10,12,20).getTime();
      window.Date = class extends RealDate {
        constructor(...args){super(...(args.length ? args : [clock]));}
        static now(){return clock;}
      };
      try{
        sortSettings = settings;
        const day = dateKey(clock), base = dayStart(clock);
        const data = normalize([
          {...habit,hid:'today',scheduleOptions:[],allowedTimeStart:540,allowedTimeEnd:600},
          {...habit,hid:'yesterday',scheduleOptions:[],allowedTimeStart:540,allowedTimeEnd:600},
          {...habit,hid:'sunday',repeatMode:'opportunity',scheduleOptions:[]},
          {...habit,hid:'tomorrow',scheduleOptions:[]},
          {...habit,hid:'sessions'}
        ]);
        const entry = hids=>({hids,renderedHids:hids,occurrences:[]});
        const snap = {day,hids:{today:{first:clock}},expectations:{
          '2026-11-08':entry(['sunday']),
          '2026-11-11':{...entry(['yesterday','sessions']),occurrences:[{
            hid:'sessions',occurrenceKey:'sessions:yesterday:morning',scheduleOptionId:'morning',
            start:base-86400000+9*3600000,end:base-86400000+10*3600000,rendered:true
          }]},
          [day]:entry(['today']),
          '2026-11-13':entry(['tomorrow'])
        }};
        saveTodaySuggested(snap);
        const loaded = loadTodaySuggested();
        const before = JSON.stringify(loaded);
        const rows = collectMissedFromSnapshot(data,[],loaded,{},clock);
        const pastDirect = isMissedOccurrence(data[1],null,clock,'2026-11-11',{rendered:true});
        const unchanged = before === JSON.stringify(loadTodaySuggested());
        clock = new RealDate(2026,10,13,0,1).getTime();
        const afterMidnight = collectMissedFromSnapshot(data,[],loadTodaySuggested(),{},clock);
        return {hids:rows.map(row=>row.hid),days:rows.map(row=>row.expectedDay),pastDirect,
          unchanged,historyKept:Boolean(loaded.expectations['2026-11-08']),
          expired:!afterMidnight.some(row=>row.hid==='today')};
      }finally{window.Date=RealDate;}
    },{settings,habit});
    assert.deepEqual(dates.hids,['today'],'only today’s notification is collected from mixed dated history');
    assert.deepEqual(dates.days,['2026-11-12'],'every missed row belongs to today');
    assert.equal(dates.pastDirect,false,'the shared occurrence policy rejects past dates');
    assert(dates.expired,'today’s notification expires after local midnight');
    assert(dates.unchanged && dates.historyKept,'filtering notifications preserves saved planner history');
    assert.deepEqual(errors,[]);
    console.log('ok: conditional agenda evidence, calendar corrections and undo');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
