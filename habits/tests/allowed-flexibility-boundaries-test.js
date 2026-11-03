const assert = require('assert');
const {chromium,BASE,baseHabit,plannerSettings,glpkAvailable,runPlannerPair} = require('./helpers/planner-test-helpers');

(async()=>{
  const browser=await chromium.launch({headless:true});
  try{
    const page=await browser.newPage({timezoneId:'America/New_York',serviceWorkers:'block'});
    await page.goto(BASE);
    await page.waitForFunction(()=>typeof buildWeekAgendaAsync==='function');
    const glpkOk=await glpkAvailable(page);
    const day=86400000,today=Date.parse('2026-11-03T00:00:00-05:00');
    const now=today+10*3600000; // Tuesday, no DST transition in the horizon
    const settings=plannerSettings([
      {label:'morning',days:[],start:0,end:540,locationId:'home'},
      {label:'night',days:[],start:1200,end:1440,locationId:'home'}
    ],{locations:[{id:'home',name:'Home',lat:40,lng:-74},
      {id:'trip',name:'Trip',lat:40.1,lng:-74}],defaultTravelMode:'driving'});
    const habit=props=>baseHabit({hid:'subject',name:'Subject',priority:2,
      target:5,lastLog:today-day,logs:[today-day],earlyWindowDays:1,delayAllowanceDays:0,...props});
    const task=(offset,props={})=>baseHabit({hid:'partner',name:'Partner',type:'task',target:null,
      priority:1,dueDate:today+offset*day,...props});
    const runs=[];
    const check=async(label,data,cfg,verify)=>{
      const result=await runPlannerPair(page,data,cfg,now,7,true);
      for(const [engine,week] of Object.entries(result)){
        if(engine==='glpk' && !glpkOk)continue;
        assert(week && !week.error,`${label} ${engine}: ${week?.error || 'build'}`);
        if(engine==='glpk')assert(week.optimized,`${label}: real GLPK solve`);
        const subject=week.rows.flatMap((rows,d)=>rows.filter(r=>r.i===0 && ['fill','scheduled'].includes(r.kind)).map(r=>({...r,d})));
        try{verify(subject,engine);}catch(error){console.error(label,engine,subject);throw error;}
      }
      runs.push(label);
    };
    const link=[{anchorHid:'partner',direction:'after',adjacency:'sometime',requireSameDay:true}];
    await check('links cannot pull beyond early allowance',[habit({scheduleLinks:link}),task(0)],settings,rows=>{
      assert(rows.length);assert(rows.every(r=>r.d>=3),'earliest day is due day 4 minus early 1');
    });
    await check('each linked occurrence uses its new rhythm reference',[
      habit({target:3,lastLog:today-3*day,logs:[today-3*day],scheduleLinks:link}),
      baseHabit({hid:'partner',name:'Partner',target:1,priority:1,lastLog:today-day,logs:[today-day]})
    ],settings,rows=>{
      assert(rows.length>=2);for(let i=1;i<rows.length;i++)assert(rows[i].d-rows[i-1].d>=2,'no extras inside minimum gap');
    });
    for(const restriction of [{allowedWeekdays:[6]},{allowedMonthDays:[7]}]){
      await check('cluster obeys '+Object.keys(restriction)[0],[
        habit({...restriction,earlyWindowDays:3,locationIds:['trip'],anywhereAllowed:false}),
        task(2,{locationIds:['trip'],anywhereAllowed:false})
      ],settings,rows=>{assert(rows.length);assert(rows.every(r=>r.d===4),'only allowed Saturday November 7');});
    }
    for(const breakable of [false,true]){
      await check('closed due window cannot extend delay '+breakable,[habit({target:3,
        lastLog:today-day,logs:[today-day],breakable,minChunkMinutes:30,
        allowedTimeStart:600,allowedTimeEnd:660,delayAllowanceDays:1})],{
        ...settings,blockedTimes:[...settings.blockedTimes,
          {label:'closed',days:[4,5,6],start:540,end:1200}]
      },rows=>assert.strictEqual(rows.length,0,'no placement beyond Friday last on-time day'));
    }
    await check('later virtual occurrences keep the delay bound',[habit({target:3,
      lastLog:today-3*day,logs:[today-3*day],delayAllowanceDays:1,
      allowedTimeStart:660,allowedTimeEnd:720})],{
      ...settings,blockedTimes:[...settings.blockedTimes,{label:'next cycle closed',days:[5,6],start:540,end:1200}]
    },rows=>{assert.strictEqual(rows.length,1);assert.strictEqual(rows[0].d,0);});
    await check('last allowed delay day stays usable',[habit({target:3,
      lastLog:today-day,logs:[today-day],delayAllowanceDays:1,
      allowedTimeStart:660,allowedTimeEnd:720})],{
      ...settings,blockedTimes:[...settings.blockedTimes,{label:'due closed',days:[4],start:540,end:1200}]
    },rows=>{assert(rows.length);assert.strictEqual(rows[0].d,3);});
    const beforeDst=Date.parse('2026-10-27T00:00:00-04:00');
    await check('DST cannot turn a due-today rhythm into overdue catch-up',[habit({target:7,
      lastLog:beforeDst,logs:[beforeDst],allowedTimeStart:660,allowedTimeEnd:720})],{
      ...settings,blockedTimes:[...settings.blockedTimes,{label:'due closed',days:[2],start:540,end:1200}]
    },rows=>assert.strictEqual(rows.length,0));
    await check('early allowance does not grant delay',[habit({target:3,
      lastLog:today-day,logs:[today-day],earlyWindowDays:5,
      allowedTimeStart:600,allowedTimeEnd:660})],{
      ...settings,blockedTimes:[...settings.blockedTimes,{label:'due closed',days:[4],start:540,end:1200}]
    },rows=>assert.strictEqual(rows.length,0));
    await check('overdue catch-up obeys days and time',[habit({target:3,lastLog:today-10*day,
      logs:[today-10*day],allowedWeekdays:[4],allowedMonthDays:[5],
      allowedTimeStart:780,allowedTimeEnd:840,preferredTimeStart:540,preferredTimeEnd:600})],settings,rows=>{
        assert(rows.length);assert(rows.every(r=>r.d===2 && r.start>=today+2*day+780*60000 && r.end<=today+2*day+840*60000));
    });
    await check('unresolved allowed anchor is closed',[habit({target:1,
      allowedTimeStartAnchor:'habit',allowedTimeStartAnchorHabitId:'missing',
      allowedTimeEnd:840})],settings,rows=>assert.strictEqual(rows.length,0));
    for(const props of [
      {allowedWeekdays:[4]},
      {allowedMonthDays:[5]},
      {allowedTimeStart:780,allowedTimeEnd:840},
      {allowedTimeStart:570,allowedTimeEnd:615}
    ]){
      await check('timed plans obey '+JSON.stringify(props),[habit({...props,
        logs:[today-day,{ts:today+600*60000,plan:true,timed:true}]
      })],settings,rows=>assert(!rows.some(row=>row.kind==='scheduled'),'invalid timed plan cannot reserve a row'));
    }
    await check('valid timed plan remains scheduled',[habit({allowedTimeStart:600,allowedTimeEnd:660,
      logs:[today-day,{ts:today+600*60000,plan:true,timed:true}]
    })],settings,rows=>{assert(rows.some(row=>row.kind==='scheduled' && row.d===0));});
    await check('timed plans advance subsequent rhythm without borrowing early days',[habit({
      target:3,earlyWindowDays:0,allowedTimeStart:600,allowedTimeEnd:660,
      logs:[today-day,{ts:today+600*60000,plan:true,timed:true}]
    })],settings,rows=>assert.deepStrictEqual(rows.map(row=>row.d),[0,3,6]));
    for(const anywhereAllowed of [false,true]){
      await check('explicit timed place obeys anywhere='+anywhereAllowed,[habit({type:'task',target:null,
        lastLog:null,dueDate:today-day,locationIds:['trip'],anywhereAllowed,
        logs:[{ts:today+600*60000,plan:true,timed:true,locationId:'home'}]
      })],settings,rows=>{
        if(anywhereAllowed)assert(rows.some(row=>row.kind==='scheduled' && row.locationId==='home'));
        else{assert(rows.length);assert(rows.every(row=>row.kind!=='scheduled' && row.locationId==='trip'));}
      });
    }
    console.log(`${runs.length} scenarios passed in both available planners`);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
