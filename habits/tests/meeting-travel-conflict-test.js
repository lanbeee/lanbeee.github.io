// A selected earlier errand changes the commute after a locationless meeting.
// Keep the full reservation and the full travel leg in both timeline and home.
const assert = require('node:assert/strict');
const {chromium, BASE, baseHabit, plannerSettings, glpkAvailable, FAST_ONLY} =
  require('./helpers/planner-test-helpers');

(async()=>{
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage();
    await page.goto(BASE);
    await page.waitForFunction(()=>typeof buildWeekAgendaAsync === 'function');
    const glpkOk = await glpkAvailable(page);
    const today = new Date(2026,10,13).getTime();
    const now = today + (9*60+14)*60000;
    const settings = plannerSettings([
      {label:'night',days:[],start:780,end:1440}
    ],{
      lastKnownLocationId:'home',defaultTravelMode:'driving',
      locations:[
        {id:'home',name:'Home',lat:40,lng:-74},
        {id:'a',name:'Store A',lat:40.1,lng:-74},
        {id:'b',name:'Store B',lat:40.01,lng:-74}
      ],
      travel:Object.fromEntries([
        ['a','home',14],['b','home',3],['a','b',14]
      ].map(([a,b,minutes])=>[[a,b].sort().join('|'),{
        a,b,seconds:minutes*60,metres:1000,provider:'manual',fetchedAt:now
      }]))
    });
    const data = [
      baseHabit({hid:'a',name:'Store A task',type:'task',target:null,dueDate:today,
        durationMinutes:30,priority:0,allowedTimeStart:628,allowedTimeEnd:658,
        locationIds:['a'],anywhereAllowed:false}),
      baseHabit({hid:'b',name:'Store B task',type:'task',target:null,dueDate:today,
        durationMinutes:15,priority:0,allowedTimeStart:690,allowedTimeEnd:730,
        locationIds:['b'],anywhereAllowed:false}),
      baseHabit({hid:'meeting',name:'Meeting',type:'task',target:null,
        eventTime:today+660*60000,durationMinutes:30})
    ];
    const cases = [
      {label:'locationless meeting',data,settings,secondStart:704,both:true},
      {label:'locationless busy time',data:data.slice(0,2),settings:{...settings,
        blockedTimes:[...settings.blockedTimes,{label:'Busy',days:[],start:660,end:690}]},
        secondStart:704,both:true},
      {label:'no valid post-meeting arrival',data:[data[0],{...data[1],allowedTimeEnd:712},data[2]],
        settings,both:false},
      {label:'meeting resets the place',data:[{...data[0],allowedTimeStart:610,allowedTimeEnd:640},
        data[1],{...data[2],locationIds:['home'],anywhereAllowed:false}],
        settings,secondStart:693,both:true},
      {label:'morning location survives a long gap',data:[
        {...data[0],allowedTimeStart:328,allowedTimeEnd:358},data[1],data[2]],
        settings,now:today+(4*60+14)*60000,secondStart:704,both:true},
      {label:'intervening stop establishes the meeting place',data:[
        {...data[0],allowedTimeStart:600,allowedTimeEnd:630},
        {...data[1],allowedTimeEnd:705},data[2],
        {...data[1],hid:'bridge',name:'Earlier Store B stop',allowedTimeStart:644,allowedTimeEnd:659}],
        settings,secondStart:690,both:true,fillCount:3}
    ];
    for(const scenario of cases){
      const plans = await page.evaluate(async ({data,settings,now,glpkOk})=>{
        const RealDate = Date;
        globalThis.Date = class extends RealDate{
          constructor(...args){super(...(args.length ? args : [now]));}
          static now(){return now;}
        };
        const previousSettings = sortSettings;
        sortSettings = settings;
        try{
          const out = {};
          for(const engine of glpkOk ? ['fast','glpk'] : ['fast']){
            const week = engine === 'glpk'
              ? await buildWeekAgendaAsync(data,{...settings,agendaOptimizer:true},1)
              : buildWeekAgenda(data,{...settings,agendaOptimizer:false},1);
            const day = week.days[0];
            const rows = items=>items.map(row=>({kind:row.kind,i:row.i,start:row.start,
              end:row.end,seconds:row.seconds,from:row.from,to:row.to}));
            out[engine] = {optimized:week.optimized,solve:week.plannerSolveStatus,
              timeline:rows(day.timeline),home:rows(homeDaySequence(day,settings))};
          }
          return out;
        }finally{globalThis.Date = RealDate;sortSettings = previousSettings;}
      },{data:scenario.data,settings:scenario.settings,now:scenario.now || now,glpkOk});
      for(const [engine,plan] of Object.entries(plans)){
        const label = `${scenario.label}: ${engine}`;
        if(engine === 'glpk'){
          assert.ok(plan.optimized,`${label} uses GLPK`);
          assert.ok(['optimal','feasible'].includes(plan.solve),`${label} retains a GLPK incumbent`);
        }
        for(const surface of ['timeline','home']){
          const rows = plan[surface];
          const fills = rows.filter(row=>row.kind === 'fill');
          if(scenario.both){
            assert.equal(fills.length,scenario.fillCount || 2,`${label} keeps every errand on ${surface}`);
            const second = fills.find(row=>row.i === 1);
            assert.equal(second.start,today+scenario.secondStart*60000,
              `${label} uses the real post-reservation arrival on ${surface}`);
          }else{
            assert.equal(fills.length,1,`${label} rejects incompatible co-selection on ${surface}`);
          }
          const reservations = rows.filter(row=>row.kind !== 'travel');
          for(const leg of rows.filter(row=>row.kind === 'travel')){
            assert.equal(leg.end-leg.start,leg.seconds*1000,
              `${label} keeps the full commute on ${surface}`);
            assert.ok(leg.end<=today+660*60000 || leg.start>=today+690*60000,
              `${label} never travels during the meeting on ${surface}`);
            assert.ok(reservations.every(row=>leg.end<=row.start || leg.start>=row.end),
              `${label} travel overlaps no work or busy time on ${surface}`);
          }
          for(const meeting of rows.filter(row=>row.kind === 'scheduled')){
            assert.equal(meeting.start,today+660*60000,`${label} preserves meeting start`);
            assert.equal(meeting.end,today+690*60000,`${label} preserves meeting end`);
          }
        }
      }
    }
    if(!glpkOk && !FAST_ONLY)console.log('SKIP: GLPK WASM unavailable');
    console.log('PASS: meetings and busy time retain their full reservation across route changes');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
