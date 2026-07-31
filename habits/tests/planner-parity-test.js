// Fast scarcity vs GLPK — same inputs, same behavioral standards.
//
// This is intentionally not an exact-timestamp golden test. Two valid plans
// may choose different soft slots. Both planners must satisfy every hard
// constraint; Fast must match GLPK's placed minutes on this representative
// corpus, and may not add travel where the exact plan found a cheaper route.
//
// Default comparison:
//   HABITS_URL=http://127.0.0.1:4181/ node tests/planner-parity-test.js
// Forced-fast standards only:
//   HABITS_PLANNER_MODE=fast HABITS_URL='http://127.0.0.1:4181/?planner=fast' node tests/planner-parity-test.js

const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
const FAST_ONLY = process.env.HABITS_PLANNER_MODE === 'fast';

let pass = 0;
let fail = 0;
function assert(value,message){
  if(value){ pass += 1; console.log('  ok: ' + message); }
  else { fail += 1; console.error('  not ok: ' + message); }
}

const nowAt = (hour,minute = 0)=>{
  const d = new Date();
  d.setHours(hour,minute,0,0);
  return d.getTime();
};
const dayBase = new Date().setHours(0,0,0,0);
const yesterday = dayBase - 86400000;
const tomorrowWeekday = new Date(dayBase + 86400000).getDay();

function habit(name,extra = {}){
  return {
    name,type:'keepup',target:1,flexibilityDays:0,durationMinutes:30,
    breakable:false,minChunkMinutes:30,allowedTimeStart:null,allowedTimeEnd:null,
    preferredTimeStart:null,preferredTimeEnd:null,lastLog:yesterday,logs:[yesterday],
    emoji:'',pinned:false,sample:false,snoozedUntil:null,topics:[],
    allowedWeekdays:[],allowedMonthDays:[],preferredWeekdays:[],preferredMonthDays:[],
    dueDate:null,eventTime:null,hardDue:false,createdAt:yesterday,
    locationIds:[],anywhereAllowed:true,priority:2,
    ...extra
  };
}

function settings(extra = {}){
  return {
    preset:'todayFirst',showWeekOnHome:true,agendaOptimizer:true,focus:'balanced',
    availabilityMinutes:[600,600,600,600,600,600,600],availabilityOverrides:{},
    showScheduledTasksInAgenda:true,showDueTasksInAgenda:true,
    showPlannedItemsInAgenda:true,showDueHabitsInAgenda:true,
    locations:[],travel:{},defaultTravelMode:'walking',blockedTimes:[],
    ...extra
  };
}

function availabilityOverrides(minutes,days = 10){
  const out = {};
  for(let i = 0;i < days;i += 1){
    const d = new Date(dayBase + i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    out[key] = minutes;
  }
  return out;
}

const scenarios = [
  {
    name:'dawn refill',
    now:nowAt(4),
    days:1,
    data:[
      habit('Fajr',{
        durationMinutes:2,priority:0,allowedTimeStart:271,allowedTimeEnd:358
      }),
      habit('Call Amma',{
        durationMinutes:32,priority:2,allowedTimeStart:1305,allowedTimeEnd:780
      }),
      habit('Tasks Discussion',{
        type:'task',target:null,durationMinutes:15,eventTime:dayBase + 570 * 60000,
        dueDate:dayBase,lastLog:null,logs:[]
      })
    ],
    settings:settings({
      blockedTimes:[
        {label:'sleep',days:[],start:0,end:335},
        {label:'breakfast',days:[],start:530,end:540}
      ]
    }),
    standards:{required:{Fajr:2,'Call Amma':32},starts:{Fajr:335,'Call Amma':337}}
  },
  {
    name:'scarce window beats flexible P0',
    now:nowAt(6),
    days:1,
    data:[
      habit('Sunrise Exercise',{
        durationMinutes:5,priority:3,allowedTimeStart:420,allowedTimeEnd:480
      }),
      habit('Flexible Deep Work',{
        durationMinutes:60,priority:0
      })
    ],
    settings:settings({
      availabilityMinutes:[120,120,120,120,120,120,120],
      blockedTimes:[{label:'sleep',days:[],start:0,end:420}]
    }),
    standards:{required:{'Sunrise Exercise':5,'Flexible Deep Work':60}}
  },
  {
    name:'breakable Work around Zuhr',
    now:nowAt(15),
    days:2,
    data:[
      habit('Work',{
        durationMinutes:360,breakable:true,minChunkMinutes:60,priority:0,
        allowedTimeStart:540,allowedTimeEnd:1125,
        allowedWeekdays:[tomorrowWeekday]
      }),
      habit('Zuhr',{
        durationMinutes:10,priority:5,allowedTimeStart:830,allowedTimeEnd:840,
        allowedWeekdays:[tomorrowWeekday]
      })
    ],
    settings:settings({
      availabilityMinutes:[480,480,480,480,480,480,480],
      blockedTimes:[{label:'sleep',days:[],start:0,end:420}]
    }),
    standards:{required:{Work:360,Zuhr:10},starts:{Zuhr:830}}
  },
  {
    name:'one-shot and aggregate capacity',
    now:nowAt(15),
    days:4,
    data:[
      habit('One shot',{
        type:'task',target:null,durationMinutes:30,priority:1,
        dueDate:dayBase + 3 * 86400000,lastLog:null,logs:[]
      }),
      habit('Capacity A',{
        durationMinutes:60,priority:1,allowedWeekdays:[tomorrowWeekday]
      }),
      habit('Capacity B',{
        durationMinutes:60,priority:2,allowedWeekdays:[tomorrowWeekday]
      })
    ],
    settings:settings({
      availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440],
      availabilityOverrides:availabilityOverrides(90),
      blockedTimes:[{label:'sleep',days:[],start:0,end:420}]
    }),
    standards:{required:{'One shot':30},oneShot:'One shot'}
  },
  {
    name:'co-located errands',
    now:nowAt(6),
    days:5,
    data:[
      habit('Home routine',{durationMinutes:10,locationIds:['home'],anywhereAllowed:false}),
      habit('Far A',{
        type:'task',target:null,durationMinutes:30,priority:1,
        dueDate:dayBase + 3 * 86400000,lastLog:null,logs:[],
        locationIds:['far-a'],anywhereAllowed:false
      }),
      habit('Far B',{
        durationMinutes:30,priority:2,locationIds:['far-b'],anywhereAllowed:false,
        allowedWeekdays:[new Date(dayBase + 3 * 86400000).getDay()]
      })
    ],
    settings:settings({
      locations:[
        {id:'home',name:'Home',lat:40.700,lng:-74.000},
        {id:'far-a',name:'Far A',lat:40.950,lng:-74.000},
        {id:'far-b',name:'Far B',lat:40.954,lng:-74.004}
      ],
      lastKnownLocationId:'home',
      blockedTimes:[{label:'sleep',days:[],start:0,end:360,locationId:'home'}]
    }),
    standards:{required:{'Far A':30,'Far B':30},sameDay:['Far A','Far B']}
  }
];

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const pageErrors = [];
  page.on('pageerror',error=>pageErrors.push(String(error)));
  await page.goto(BASE,{waitUntil:'load'});

  const hasGlpk = !FAST_ONLY && await page.evaluate(async()=>{
    try{
      const glpk = await ensureGlpk();
      return Boolean(glpk && typeof glpk.solve === 'function');
    }catch{
      return false;
    }
  });

  const rows = [];
  for(const scenario of scenarios){
    const result = await page.evaluate(async ({scenario,runGlpk})=>{
      const RealDate = Date;
      function FrozenDate(...args){
        return args.length ? new RealDate(...args) : new RealDate(scenario.now);
      }
      FrozenDate.now = ()=>scenario.now;
      FrozenDate.parse = RealDate.parse;
      FrozenDate.UTC = RealDate.UTC;
      Object.setPrototypeOf(FrozenDate,RealDate);
      FrozenDate.prototype = RealDate.prototype;
      const originalDate = globalThis.Date;
      globalThis.Date = FrozenDate;

      function summarize(week,elapsedMs){
        const totals = {};
        const daysByName = {};
        const starts = {};
        const violations = [];
        const dayDetails = [];
        let placedMinutes = 0;
        let travelMinutes = 0;
        for(const day of week.days || []){
          const fills = (day.timeline || []).filter(row=>row.kind === 'fill');
          const fixed = (day.timeline || []).filter(row=>
            row.kind === 'fill' || row.kind === 'scheduled');
          const sorted = fixed.slice().sort((a,b)=>a.start-b.start || a.end-b.end);
          for(let i = 1;i < sorted.length;i += 1){
            if(sorted[i].start < sorted[i - 1].end){
              violations.push(`overlap:${sorted[i - 1].h?.name || '?'}:${sorted[i].h?.name || '?'}`);
            }
          }
          for(const row of fills){
            const minutes = Math.round((row.end - row.start) / 60000);
            placedMinutes += minutes;
            totals[row.h.name] = (totals[row.h.name] || 0) + minutes;
            if(!daysByName[row.h.name])daysByName[row.h.name] = [];
            daysByName[row.h.name].push(day.dayKey);
            if(starts[row.h.name] == null){
              starts[row.h.name] = Math.round((row.start - day.dayBase) / 60000);
            }
            const inSlot = (day.slots || []).some(slot=>
              row.start >= slot.start && row.end <= slot.end);
            if(!inSlot)violations.push(`slot:${row.h.name}`);
            if(typeof hasTimeWindow === 'function' && hasTimeWindow(row.h)){
              const windows = fillDayWindows(row.h,day.dayBase,row.locationId);
              if(!windows || !windows.some(win=>row.start >= win.start && row.end <= win.end)){
                violations.push(`window:${row.h.name}`);
              }
            }
          }
          const fillMinutes = fills.reduce(
            (sum,row)=>sum + Math.round((row.end-row.start)/60000),0);
          const dayTravelMinutes = Math.max(
            0,Math.round((Number(day.usedMinutes) || 0) - fillMinutes));
          travelMinutes += dayTravelMinutes;
          dayDetails.push({
            dayKey:day.dayKey,
            usedMinutes:Number(day.usedMinutes) || 0,
            fillMinutes,
            travelMinutes:dayTravelMinutes,
            fills:fills.map(row=>({
              name:row.h.name,
              start:Math.round((row.start-day.dayBase)/60000),
              locationId:row.locationId || null
            })),
            travelRows:(day.timeline || []).filter(row=>row.kind === 'travel').map(row=>({
              from:row.from,to:row.to,minutes:Math.ceil((Number(row.seconds) || 0)/60)
            }))
          });
          if(Number(day.usedMinutes) > Number(day.totalMinutes) + 0.001){
            violations.push(`capacity:${day.dayKey}`);
          }
        }
        for(const h of scenario.data){
          if(h.type !== 'task' || h.eventTime != null)continue;
          const count = (daysByName[h.name] || []).length;
          if(count > 1)violations.push(`duplicate-task:${h.name}`);
        }
        const signature = (week.days || []).flatMap(day=>
          (day.timeline || []).filter(row=>row.kind === 'fill').map(row=>
            `${day.dayKey}:${row.h.name}:${Math.round((row.start-day.dayBase)/60000)}:${Math.round((row.end-day.dayBase)/60000)}`
          )).join('|');
        return {
          optimized:Boolean(week.optimized),
          elapsedMs:Math.round(elapsedMs * 10) / 10,
          placedMinutes,travelMinutes,totals,daysByName,starts,violations,signature,dayDetails
        };
      }

      async function run(mode){
        const begin = performance.now();
        const week = mode === 'glpk'
          ? await buildWeekAgendaAsync(
            scenario.data,{...scenario.settings,agendaOptimizer:true},scenario.days)
          : buildWeekAgenda(
            scenario.data,{...scenario.settings,agendaOptimizer:false},scenario.days);
        return summarize(week,performance.now() - begin);
      }

      try{
        const fast = await run('fast');
        const glpk = runGlpk ? await run('glpk') : null;
        return {fast,glpk};
      }finally{
        globalThis.Date = originalDate;
      }
    },{scenario,runGlpk:hasGlpk});

    console.log(`\n[${scenario.name}]`);
    for(const [planner,summary] of [['Fast',result.fast],['GLPK',result.glpk]]){
      if(!summary)continue;
      assert(summary.violations.length === 0,
        `${planner}: no hard violations (${summary.violations.join(', ') || 'none'})`);
      for(const [name,minutes] of Object.entries(scenario.standards.required || {})){
        assert((summary.totals[name] || 0) >= minutes,
          `${planner}: ${name} places ${minutes}m (got ${summary.totals[name] || 0})`);
      }
      for(const [name,start] of Object.entries(scenario.standards.starts || {})){
        assert(summary.starts[name] === start,
          `${planner}: ${name} starts at minute ${start} (got ${summary.starts[name]})`);
      }
      if(scenario.standards.oneShot){
        assert((summary.daysByName[scenario.standards.oneShot] || []).length === 1,
          `${planner}: one-shot task appears exactly once`);
      }
      if(scenario.standards.sameDay){
        const [a,b] = scenario.standards.sameDay;
        const aDays = summary.daysByName[a] || [];
        const bDays = new Set(summary.daysByName[b] || []);
        assert(aDays.some(day=>bDays.has(day)),`${planner}: ${a} and ${b} share a day`);
      }
    }
    if(result.glpk){
      assert(result.glpk.optimized,`${scenario.name}: GLPK result is optimized`);
      assert(result.fast.placedMinutes >= result.glpk.placedMinutes,
        `${scenario.name}: Fast placed minutes ${result.fast.placedMinutes} >= GLPK ${result.glpk.placedMinutes}`);
      assert(result.fast.travelMinutes <= result.glpk.travelMinutes,
        `${scenario.name}: Fast travel ${result.fast.travelMinutes}m <= GLPK ${result.glpk.travelMinutes}m`);
      if(result.fast.travelMinutes > result.glpk.travelMinutes){
        console.log('  travel detail:',JSON.stringify({
          fast:result.fast.dayDetails,
          glpk:result.glpk.dayDetails
        },null,2));
      }
    }
    rows.push({
      scenario:scenario.name,
      fastWork:result.fast.placedMinutes,
      glpkWork:result.glpk ? result.glpk.placedMinutes : null,
      fastTravel:result.fast.travelMinutes,
      glpkTravel:result.glpk ? result.glpk.travelMinutes : null,
      fastMs:result.fast.elapsedMs,
      glpkMs:result.glpk ? result.glpk.elapsedMs : null,
      sameTimeline:result.glpk ? result.fast.signature === result.glpk.signature : null
    });
  }

  console.log('\nPLANNER PARITY REPORT');
  console.table(rows);
  assert(pageErrors.length === 0,`no page errors (${pageErrors.join('; ')})`);
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed${hasGlpk ? '' : ' (fast standards only)'}`);
  if(fail)process.exit(1);
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
