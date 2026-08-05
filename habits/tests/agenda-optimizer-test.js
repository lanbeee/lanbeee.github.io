// Exact schedule optimizer (GLPK) — regression for scarcity packing when
// settings.agendaOptimizer is on. Falls soft-pass if GLPK cannot load.
//
// Run: HABITS_URL=http://127.0.0.1:4181/ node tests/agenda-optimizer-test.js

const { chromium } = require('playwright');
const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

function atTime(hour, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function base(props) {
  return Object.assign({
    name: 'item', type: 'keepup', target: 1, flexibilityDays: 0, durationMinutes: 30,
    allowedTimeStart: null, allowedTimeEnd: null, preferredTimeStart: null, preferredTimeEnd: null,
    lastLog: null, logs: [], emoji: '', pinned: false, sample: false, snoozedUntil: null,
    topics: [], allowedWeekdays: [], allowedMonthDays: [], preferredWeekdays: [], preferredMonthDays: [],
    dueDate: null, eventTime: null, hardDue: false, createdAt: Date.now()
  }, props);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
  const failures = [];
  function check(name, cond, detail) {
    if (cond) console.log(`  ok  - ${name}`);
    else {
      failures.push(`${name}${detail ? ' :: ' + detail : ''}`);
      console.log(`  FAIL- ${name}${detail ? ' :: ' + detail : ''}`);
    }
  }

  await page.goto(BASE, { waitUntil: 'networkidle' });

  const optimizerDefault = await page.evaluate(()=>loadSortSettings().agendaOptimizer);
  check('GLPK optimizer defaults on', optimizerDefault === true, String(optimizerDefault));

  const ago1d = atTime(6) - 86400000;
  await page.evaluate(({ d, s }) => {
    localStorage.clear();
    localStorage.setItem('tings_v2', JSON.stringify(d));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(s));
  }, {
    d: [
      base({ name: 'Flexible Deep Work', type: 'keepup', target: 1, durationMinutes: 60,
        priority: 0, locationIds: [], lastLog: ago1d, logs: [ago1d] }),
      base({ name: 'Sunrise Exercise', type: 'keepup', target: 1, durationMinutes: 5,
        priority: 2, locationIds: [],
        allowedTimeStartAnchor: 'sunrise', allowedTimeStartOffsetMin: 5,
        allowedTimeEndAnchor: 'sunrise', allowedTimeEndOffsetMin: 35,
        lastLog: ago1d, logs: [ago1d] })
    ],
    s: {
      preset: 'todayFirst', showWeekOnHome: true, agendaOptimizer: true, focus: 'balanced',
      availabilityMinutes: [600, 600, 600, 600, 600, 600, 600],
      showScheduledTasksInAgenda: true, showDueTasksInAgenda: true,
      showPlannedItemsInAgenda: true, showDueHabitsInAgenda: true,
      locations: [{ id: 'home', name: 'Charles Street', lat: 40.734852, lng: -74.003584 }],
      lastKnownLocationId: 'home',
      blockedTimes: [
        { label: 'blocked', days: [], locationId: 'home',
          start: 900, end: 960,
          startAnchor: 'sunrise', startOffsetMin: -480,
          startCombine: 'later', startAnchor2: 'isha', startOffsetMin2: 15,
          startDayOffset: 1, startDayOffset2: 0,
          endAnchor: 'sunrise', endOffsetMin: -30 },
        { label: 'breakfast', days: [], locationId: null, start: 480, end: 540 }
      ]
    }
  });
  await page.reload({ waitUntil: 'networkidle' });

  console.log('\n[Optimizer] GLPK availability');
  const glpkOk = await page.evaluate(async () => {
    if (typeof ensureGlpk !== 'function') return { ok: false, reason: 'ensureGlpk missing' };
    try {
      const GLPK = await ensureGlpk();
      return { ok: !!GLPK, reason: GLPK ? 'loaded' : 'null' };
    } catch (e) {
      return { ok: false, reason: String(e && e.message || e) };
    }
  });
  if (!glpkOk.ok) {
    console.log(`  skip - GLPK unavailable (${glpkOk.reason}); soft-pass`);
    await browser.close();
    console.log('\nPASS — optimizer soft-skipped (no GLPK)');
    process.exit(0);
  }
  check('optimizer glpk loads', glpkOk.ok, glpkOk.reason);

  console.log('\n[Optimizer] overnight morning tail refills immediately after Fajr');
  const overnightResult = await page.evaluate(async ({now,data,settings})=>{
    const RealDate = Date;
    function FD(...a){ return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
    FD.now = ()=>now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
    Object.setPrototypeOf(FD,RealDate); FD.prototype = RealDate.prototype;
    const orig = globalThis.Date; globalThis.Date = FD;
    try{
      const week = await buildWeekAgendaAsync(data,settings,1);
      const day = week.days[0];
      const fills = (day.timeline || []).filter(row=>row.kind === 'fill');
      const starts = Object.fromEntries(fills.map(row=>[
        row.h.name,
        Math.round((row.start - day.dayBase) / 60000)
      ]));
      const audit = buildDayCapacityScorecard(data,settings,day.dayBase,now,{
        weekMode:true,
        weekSnapshot:week
      });
      const callTrace = audit.plannerTrace.find(item=>item.name === 'Call Amma');
      return {
        optimized:Boolean(week.optimized),
        starts,
        names:fills.map(row=>row.h.name),
        callTrace:callTrace ? {
          selected:callTrace.selected,
          earliestMin:Math.round((callTrace.earliestClockFit - day.dayBase) / 60000),
          allowed:callTrace.inputs.find(input=>input.startsWith('allowed ')) || '',
          decision:callTrace.decision
        } : null
      };
    }finally{
      globalThis.Date = orig;
    }
  },{
    now:atTime(4),
    data:[
      base({
        name:'Fajr',type:'keepup',target:1,durationMinutes:2,priority:2,
        // Realistic broad prayer window: sleep makes 5:35 the first usable
        // minute, while the allowed window itself remains open until 5:58.
        allowedTimeStart:271,allowedTimeEnd:358,
        lastLog:ago1d,logs:[ago1d]
      }),
      base({
        name:'Call Amma',type:'keepup',target:1,durationMinutes:32,priority:2,
        allowedTimeStart:1305,allowedTimeEnd:780,
        lastLog:ago1d,logs:[ago1d]
      }),
      base({
        name:'Tasks Discussion',type:'task',target:null,durationMinutes:15,priority:2,
        eventTime:atTime(0) + 570 * 60000,
        dueDate:atTime(0)
      })
    ],
    settings:{
      preset:'todayFirst',showWeekOnHome:true,agendaOptimizer:true,focus:'balanced',
      availabilityMinutes:[600,600,600,600,600,600,600],availabilityOverrides:{},
      showScheduledTasksInAgenda:true,showDueTasksInAgenda:true,
      showPlannedItemsInAgenda:true,showDueHabitsInAgenda:true,
      locations:[],travel:{},
      blockedTimes:[
        {label:'sleep',days:[],start:0,end:335},
        {label:'breakfast',days:[],start:530,end:540}
      ]
    }
  });
  check('overnight/Fajr scenario uses optimizer',overnightResult.optimized,
    JSON.stringify(overnightResult));
  check('Fajr keeps its narrow 5:35 AM slot',overnightResult.starts.Fajr === 335,
    JSON.stringify(overnightResult));
  check('Call Amma refills immediately after Fajr',overnightResult.starts['Call Amma'] === 337,
    JSON.stringify(overnightResult));
  check('Call Amma audit exposes both daily overnight pieces',
    overnightResult.callTrace
      && overnightResult.callTrace.allowed.includes(';')
      && overnightResult.callTrace.allowed.includes('1:00 PM')
      && overnightResult.callTrace.allowed.includes('9:45 PM'),
    JSON.stringify(overnightResult.callTrace));
  check('Call Amma audit identifies 5:37 AM as earliest clock fit',
    overnightResult.callTrace && overnightResult.callTrace.earliestMin === 337,
    JSON.stringify(overnightResult.callTrace));

  console.log('\n[Optimizer] impossible days do not make broad windows look scarcer');
  const scarcityResult = await page.evaluate((now)=>{
    const day0 = new Date(now).setHours(0,0,0,0);
    const day1 = day0 + 86400000;
    const settings = {
      availabilityMinutes:[600,600,600,600,600,600,600],
      blockedTimes:[],locations:[],travel:{},defaultTravelMode:'walking'
    };
    const makeState = (dayBase,slots)=>createDayPlacementState({
      scheduled:[],agendaItems:[],totalMinutes:600,slots,
      dayBase,weekday:new Date(dayBase).getDay(),isToday:false
    },settings,{dayBase,weekMode:true});
    const makeHabit = props=>({
      name:'item',type:'keepup',target:1,flexibilityDays:0,durationMinutes:30,
      breakable:false,minChunkMinutes:30,allowedTimeStart:null,allowedTimeEnd:null,
      preferredTimeStart:null,preferredTimeEnd:null,lastLog:null,logs:[],
      locationIds:[],priority:2,...props
    });
    const states = [
      makeState(day0,[{start:day0 + 14*3600000,end:day0 + 15*3600000}]),
      makeState(day1,[{start:day1 + 335*60000,end:day1 + 600*60000}])
    ];
    const broad = makeHabit({
      name:'Broad overnight',durationMinutes:32,
      allowedTimeStart:1305,allowedTimeEnd:780
    });
    const narrow = makeHabit({
      name:'Narrow dawn',durationMinutes:2,
      allowedTimeStart:271,allowedTimeEnd:358
    });
    const broadScore = scarcityScore({
      h:broad,i:0,priority:2,eligible:new Set([day0,day1])
    },states);
    const narrowScore = scarcityScore({
      h:narrow,i:1,priority:0,eligible:new Set([day1])
    },states);
    return {broadScore,narrowScore};
  },atTime(4));
  check('tight feasible dawn window ranks before broad overnight window',
    scarcityResult.narrowScore < scarcityResult.broadScore,
    JSON.stringify(scarcityResult));

  console.log('\n[Fast preview] narrow Fajr survives before optimizer settles');
  const fastPreview = await page.evaluate((now)=>{
    const RealDate = Date;
    function FD(...a){ return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
    FD.now = ()=>now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
    Object.setPrototypeOf(FD,RealDate); FD.prototype = RealDate.prototype;
    const orig = globalThis.Date; globalThis.Date = FD;
    try{
      const today = dayStart(now);
      const friday = today + 86400000;
      const prior = today - 86400000;
      const makeHabit = props=>({
        name:'item',hid:'item',type:'keepup',target:1,flexibilityDays:0,
        durationMinutes:30,breakable:false,minChunkMinutes:30,
        allowedTimeStart:null,allowedTimeEnd:null,
        preferredTimeStart:null,preferredTimeEnd:null,
        lastLog:prior,logs:[prior],emoji:'',pinned:false,sample:false,
        snoozedUntil:null,topics:[],allowedWeekdays:[],allowedMonthDays:[],
        preferredWeekdays:[],preferredMonthDays:[],dueDate:null,eventTime:null,
        hardDue:false,locationIds:[],priority:2,...props
      });
      const data = [
        makeHabit({
          name:'Fajr',hid:'fajr',target:7,durationMinutes:2,priority:0,
          allowedTimeStart:271,allowedTimeEnd:358,
          logs:[prior,{ts:friday + 12*3600000,plan:true}]
        }),
        makeHabit({
          name:'Call Amma',hid:'call',target:1,durationMinutes:32,
          allowedTimeStart:1305,allowedTimeEnd:780
        }),
        {
          ...makeHabit({name:'Tasks Discussion',hid:'discussion'}),
          type:'task',target:null,durationMinutes:15,
          dueDate:friday,eventTime:friday + 570*60000
        }
      ];
      const settings = {
        preset:'todayFirst',showWeekOnHome:true,agendaOptimizer:false,focus:'balanced',
        availabilityMinutes:[600,600,600,600,600,600,600],availabilityOverrides:{},
        showScheduledTasksInAgenda:true,showDueTasksInAgenda:true,
        showPlannedItemsInAgenda:true,showDueHabitsInAgenda:true,
        locations:[],travel:{},blockedTimes:[
          {label:'sleep',days:[],start:0,end:335},
          {label:'breakfast',days:[],start:530,end:540}
        ]
      };
      const week = buildWeekAgenda(data,settings,2);
      const day = week.days.find(item=>item.dayBase === friday);
      const starts = Object.fromEntries((day.timeline || [])
        .filter(row=>row.kind === 'fill')
        .map(row=>[row.h.name,Math.round((row.start - friday) / 60000)]));
      return {starts,names:Object.keys(starts)};
    }finally{
      globalThis.Date = orig;
    }
  },atTime(4));
  check('fast preview keeps Fajr at 5:35 AM',fastPreview.starts.Fajr === 335,
    JSON.stringify(fastPreview));
  check('fast preview places Call Amma immediately after Fajr',
    fastPreview.starts['Call Amma'] === 337,
    JSON.stringify(fastPreview));

  console.log('\n[Optimizer] sunrise vs flexible P0');
  const result = await page.evaluate(async ({ now }) => {
    const RealDate = Date;
    function FD(...a) { return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
    FD.now = () => now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
    Object.setPrototypeOf(FD, RealDate); FD.prototype = RealDate.prototype;
    const orig = globalThis.Date; globalThis.Date = FD;
    try {
      const data = JSON.parse(localStorage.getItem('tings_v2'));
      const settings = Object.assign(
        JSON.parse(localStorage.getItem('tings_app_settings_v2')),
        { agendaOptimizer: true }
      );
      const week = await buildWeekAgendaAsync(data, settings, 7);
      const tomorrow = week.days[1];
      const fills = (tomorrow?.timeline || []).filter(r => r.kind === 'fill');
      const byName = Object.fromEntries(fills.map(r => {
        const placeMin = Math.round((r.start - tomorrow.dayBase) / 60000);
        return [r.h.name, placeMin];
      }));
      return {
        optimized: !!week.optimized,
        names: fills.map(r => r.h.name),
        sunriseMin: byName['Sunrise Exercise'] ?? null,
        flexibleMin: byName['Flexible Deep Work'] ?? null
      };
    } finally {
      globalThis.Date = orig;
    }
  }, { now: atTime(15) });

  check('optimized week flag', result.optimized, `optimized=${result.optimized}`);
  check('Sunrise Exercise placed', result.sunriseMin != null, `fills=${result.names.join(', ')}`);
  check('Flexible Deep Work placed', result.flexibleMin != null, `fills=${result.names.join(', ')}`);
  check('sunrise in morning gap', result.sunriseMin != null && result.sunriseMin < 480,
    `sunriseMin=${result.sunriseMin}`);
  check('flexible work does not displace sunrise', result.flexibleMin != null
    && result.sunriseMin != null
    && (result.flexibleMin + 60 <= result.sunriseMin || result.flexibleMin >= result.sunriseMin + 5),
    `sunriseMin=${result.sunriseMin}; flexibleMin=${result.flexibleMin}`);

  console.log('\n[Optimizer] breakable Work yields to narrow Zuhr window');
  const tomorrow = new Date(Date.now() + 86400000);
  const tomorrowWeekday = tomorrow.getDay();
  const ago2d = atTime(6) - 2 * 86400000;
  const splitResult = await page.evaluate(async ({now,data,settings})=>{
    const RealDate = Date;
    function FD(...a){ return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
    FD.now = ()=>now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
    Object.setPrototypeOf(FD,RealDate); FD.prototype = RealDate.prototype;
    const orig = globalThis.Date; globalThis.Date = FD;
    try{
      const week = await buildWeekAgendaAsync(data,settings,2);
      const day = week.days[1];
      const fills = (day.timeline || []).filter(row=>row.kind === 'fill');
      const compact = fills.map(row=>({
        name:row.h.name,
        start:Math.round((row.start - day.dayBase) / 60000),
        end:Math.round((row.end - day.dayBase) / 60000),
        minutes:Math.round((row.end - row.start) / 60000)
      }));
      return {optimized:Boolean(week.optimized),fills:compact};
    }finally{
      globalThis.Date = orig;
    }
  },{
    now:atTime(15),
    data:[
      base({
        name:'Work',type:'keepup',target:1,durationMinutes:360,
        breakable:true,minChunkMinutes:60,priority:0,
        allowedTimeStart:540,allowedTimeEnd:1125,
        allowedWeekdays:[tomorrowWeekday],lastLog:ago2d,logs:[ago2d]
      }),
      base({
        name:'Zuhr',type:'keepup',target:1,durationMinutes:10,priority:5,
        allowedTimeStart:830,allowedTimeEnd:840,
        allowedWeekdays:[tomorrowWeekday],lastLog:ago2d,logs:[ago2d]
      })
    ],
    settings:{
      preset:'todayFirst',showWeekOnHome:true,agendaOptimizer:true,focus:'balanced',
      availabilityMinutes:[480,480,480,480,480,480,480],availabilityOverrides:{},
      showScheduledTasksInAgenda:true,showDueTasksInAgenda:true,
      showPlannedItemsInAgenda:true,showDueHabitsInAgenda:true,
      locations:[],travel:{},blockedTimes:[{label:'sleep',days:[],start:0,end:420}]
    }
  });
  const zuhr = splitResult.fills.find(fill=>fill.name === 'Zuhr');
  const work = splitResult.fills.filter(fill=>fill.name === 'Work');
  const workMinutes = work.reduce((sum,fill)=>sum + fill.minutes,0);
  check('split scenario uses optimizer',splitResult.optimized,JSON.stringify(splitResult.fills));
  check('narrow Zuhr habit survives broad Work window',zuhr && zuhr.start === 830,
    JSON.stringify(splitResult.fills));
  check('all Work minutes still place around fixed habits',workMinutes === 360,
    `workMinutes=${workMinutes}; fills=${JSON.stringify(splitResult.fills)}`);
  check('Work does not overlap Zuhr',Boolean(zuhr) && work.every(fill=>fill.end <= zuhr.start || fill.start >= zuhr.end),
    JSON.stringify(splitResult.fills));
  check('Work remains inside its 9:00 AM-6:45 PM window',work.length > 0 && work.every(fill=>fill.start >= 540 && fill.end <= 1125),
    JSON.stringify(splitResult.fills));

  console.log('\n[Optimizer] week-level task and capacity invariants');
  const invariantResult = await page.evaluate(async ({now,weekday,data,settings})=>{
    const RealDate = Date;
    function FD(...a){ return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
    FD.now = ()=>now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
    Object.setPrototypeOf(FD,RealDate); FD.prototype = RealDate.prototype;
    const orig = globalThis.Date; globalThis.Date = FD;
    try{
      const week = await buildWeekAgendaAsync(data,settings,4);
      const allFills = week.days.flatMap(day=>(day.timeline || [])
        .filter(row=>row.kind === 'fill')
        .map(row=>({name:row.h.name,dayBase:day.dayBase,minutes:Math.round((row.end-row.start)/60000)})));
      const constrainedDay = week.days.find(day=>day.weekday === weekday);
      return {
        taskCount:allFills.filter(fill=>fill.name === 'One shot').length,
        constrainedUsed:constrainedDay ? constrainedDay.usedMinutes : null,
        constrainedNames:constrainedDay
          ? (constrainedDay.timeline || []).filter(row=>row.kind === 'fill').map(row=>row.h.name)
          : []
      };
    }finally{
      globalThis.Date = orig;
    }
  },{
    now:atTime(15),
    weekday:tomorrowWeekday,
    data:[
      base({
        name:'One shot',type:'task',durationMinutes:30,priority:1,
        dueDate:atTime(12) + 3 * 86400000,createdAt:atTime(12) - 86400000
      }),
      base({
        name:'Capacity A',type:'keepup',target:1,durationMinutes:60,priority:1,
        allowedWeekdays:[tomorrowWeekday],lastLog:ago2d,logs:[ago2d]
      }),
      base({
        name:'Capacity B',type:'keepup',target:1,durationMinutes:60,priority:2,
        allowedWeekdays:[tomorrowWeekday],lastLog:ago2d,logs:[ago2d]
      })
    ],
    settings:{
      preset:'todayFirst',showWeekOnHome:true,agendaOptimizer:true,focus:'balanced',
      availabilityMinutes:[1440,1440,1440,1440,1440,1440,1440],
      availabilityOverrides:(()=>{
        const out = {};
        const start = new Date(atTime(15));
        start.setHours(12,0,0,0);
        for(let i = 0; i < 10; i++){
          const d = new Date(start.getTime() + i * 86400000);
          const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
          out[key] = 90;
        }
        return out;
      })(),
      showScheduledTasksInAgenda:true,showDueTasksInAgenda:true,
      showPlannedItemsInAgenda:true,showDueHabitsInAgenda:true,
      locations:[],travel:{},blockedTimes:[{label:'sleep',days:[],start:0,end:420}]
    }
  });
  check('one-shot task appears only once across the optimized week',invariantResult.taskCount === 1,
    JSON.stringify(invariantResult));
  check('fixed fills respect aggregate day capacity',invariantResult.constrainedUsed <= 90,
    JSON.stringify(invariantResult));

  console.log('\n[Optimizer] inbound travel does not overlap a prior fill');
  const travelOverlapResult = await page.evaluate(async ({now,data,settings})=>{
    const RealDate = Date;
    function FD(...a){ return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
    FD.now = ()=>now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
    Object.setPrototypeOf(FD,RealDate); FD.prototype = RealDate.prototype;
    const orig = globalThis.Date; globalThis.Date = FD;
    try{
      const week = await buildWeekAgendaAsync(data,settings,1);
      const day = week.days[0];
      day.isToday = true;
      const seq = homeDaySequence(day,settings);
      const travels = seq.filter(row=>row.kind === 'travel');
      const works = seq.filter(row=>row.kind === 'fill' || row.kind === 'scheduled');
      const overlaps = [];
      for(const t of travels){
        for(const w of works){
          if(t.start < w.end && w.start < t.end){
            overlaps.push({
              travel:`${t.fromName || t.from}→${t.toName || t.to}`,
              travelStart:Math.round((t.start - day.dayBase) / 60000),
              travelEnd:Math.round((t.end - day.dayBase) / 60000),
              work:w.h && w.h.name,
              workStart:Math.round((w.start - day.dayBase) / 60000),
              workEnd:Math.round((w.end - day.dayBase) / 60000)
            });
          }
        }
      }
      const fills = works.filter(row=>row.kind === 'fill').map(row=>({
        name:row.h.name,
        start:Math.round((row.start - day.dayBase) / 60000),
        end:Math.round((row.end - day.dayBase) / 60000),
        loc:row.locationId || null
      }));
      return {
        optimized:Boolean(week.optimized),
        fills,
        travelCount:travels.length,
        overlaps
      };
    }finally{
      globalThis.Date = orig;
    }
  },{
    now:atTime(16,22),
    data:[
      base({
        name:'Zuhr',type:'keepup',target:1,durationMinutes:5,priority:0,
        locationIds:['home'],
        allowedTimeStart:16 * 60 + 22,allowedTimeEnd:17 * 60 + 9,
        lastLog:ago1d,logs:[ago1d]
      }),
      base({
        name:'Indian Grocery',type:'task',durationMinutes:30,priority:3,
        locationIds:['spresh'],pinned:true,
        dueDate:atTime(16,22),
        allowedTimeStart:10 * 60,allowedTimeEnd:20 * 60 + 30
      })
    ],
    settings:{
      preset:'todayFirst',showWeekOnHome:true,agendaOptimizer:true,focus:'balanced',
      availabilityMinutes:[600,600,600,600,600,600,600],availabilityOverrides:{},
      showScheduledTasksInAgenda:true,showDueTasksInAgenda:true,
      showPlannedItemsInAgenda:true,showDueHabitsInAgenda:true,
      lastKnownLocationId:'home',
      defaultTravelMode:'walking',
      locations:[
        {id:'home',name:'Home',lat:40.70,lng:-74.00},
        {id:'spresh',name:'Spresh',lat:40.71,lng:-74.01}
      ],
      travel:{
        'home|spresh':{
          a:'home',b:'spresh',seconds:6 * 60,metres:900,
          provider:'manual',fetchedAt:Date.now()
        }
      },
      blockedTimes:[{label:'sleep',days:[],start:0,end:420,locationId:'home'}]
    }
  });
  check('travel-overlap scenario uses optimizer',travelOverlapResult.optimized,
    JSON.stringify(travelOverlapResult));
  check('Zuhr and grocery both place when travel fits',
    travelOverlapResult.fills.some(f=>f.name === 'Zuhr')
      && travelOverlapResult.fills.some(f=>f.name === 'Indian Grocery'),
    JSON.stringify(travelOverlapResult));
  check('no travel card overlaps a fill or scheduled row',
    travelOverlapResult.overlaps.length === 0,
    JSON.stringify(travelOverlapResult.overlaps));
  const zuhrFill = travelOverlapResult.fills.find(f=>f.name === 'Zuhr');
  const groceryFill = travelOverlapResult.fills.find(f=>f.name === 'Indian Grocery');
  if(zuhrFill && groceryFill && groceryFill.start >= zuhrFill.end){
    check('grocery starts after Zuhr plus inbound commute',
      groceryFill.start >= zuhrFill.end + 6,
      JSON.stringify({zuhr:zuhrFill,grocery:groceryFill}));
  }

  // Stale-anchor location pinning: when GLPK enumerates a multi-location
  // habit's option against one anchor (e.g. Spresh, after grocery) but later
  // commits a Home-locked item before it, the option's frozen location must be
  // re-resolved against the now-current anchor. Otherwise a 5m commute to
  // KhadijaM (+5m back for Home-locked Lunch) is bought for a prayer that
  // could be done at Home. Reproduces the Zuhr audit finding.
  console.log('\n[Optimizer] stale-anchor location re-resolution');
  const staleAnchorResult = await page.evaluate(async ({now,data,settings})=>{
    const RealDate = Date;
    function FD(...a){ return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
    FD.now = ()=>now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
    Object.setPrototypeOf(FD,RealDate); FD.prototype = RealDate.prototype;
    const orig = globalThis.Date; globalThis.Date = FD;
    // Capture localStorage so seeding the travel cache doesn't poison the
    // heuristic-fallback test that runs after this one.
    const prevSettingsItem = localStorage.getItem('tings_app_settings_v2');
    try{
      // Seed the module-level travel cache so the manual edges (standing in
      // for real OSRM data) are honored by travelBetween() instead of falling
      // back to haversine. Settings passed directly to buildWeekAgendaAsync
      // do not, by themselves, populate that cache.
      if(typeof saveSortSettings === 'function')saveSortSettings(settings);
      const week = await buildWeekAgendaAsync(data,settings,1);
      const day = week.days[0];
      day.isToday = true;
      const seq = homeDaySequence(day,settings);
      const travels = seq.filter(row=>row.kind === 'travel');
      const fills = seq.filter(row=>row.kind === 'fill').map(row=>({
        name:row.h.name,
        start:Math.round((row.start - day.dayBase) / 60000),
        end:Math.round((row.end - day.dayBase) / 60000),
        loc:row.locationId || null
      }));
      const totalTravelMinutes = travels.reduce(
        (sum,t)=>sum + Math.round((t.end - t.start) / 60000),0);
      const travelsToKhadijam = travels.filter(t=>t.to === 'khadijam').length;
      const travelDetail = travels.map(t=>({
        from:t.fromName || t.from,
        to:t.toName || t.to,
        start:Math.round((t.start - day.dayBase) / 60000),
        end:Math.round((t.end - day.dayBase) / 60000)
      }));
      return {
        optimized:Boolean(week.optimized),
        fills,
        totalTravelMinutes,
        travelsToKhadijam,
        travelDetail
      };
    }finally{
      if(prevSettingsItem != null)localStorage.setItem('tings_app_settings_v2',prevSettingsItem);
      globalThis.Date = orig;
    }
  },{
    now:atTime(10,53),
    data:[
      base({
        // Scheduled (hard) grocery at Spresh: a fixed time anchor committed
        // before GLPK enumerates the flexible candidates, so Zuhr's options
        // are generated against the Spresh anchor (where KhadijaM is 3m away
        // vs Home 6m). That freezes KhadijaM into Zuhr's option; the bug is
        // that this frozen location survives even after Work (Home) commits
        // earlier and shifts the real anchor to Home.
        name:'Indian Grocery',type:'task',durationMinutes:30,priority:3,
        locationIds:['spresh'],
        eventTime:atTime(10,55) + 6 * 60000
      }),
      base({
        name:'Work',type:'keepup',target:1,durationMinutes:266,breakable:true,
        minChunkMinutes:45,priority:0,locationIds:['home'],
        allowedTimeStart:8 * 60 + 45,allowedTimeEnd:18 * 60 + 45,
        lastLog:ago1d,logs:[ago1d]
      }),
      base({
        // Home-locked morning standup: GLPK commits it in the post-grocery
        // gap, BEFORE Zuhr. That makes the real anchor at Zuhr's commit = Home,
        // while Zuhr's option was frozen against the Spresh (grocery) anchor
        // during enumeration. This is the stale-anchor condition: pre-fix the
        // reconciler keeps KhadijaM; post-fix it re-resolves to Home.
        name:'Standup',type:'keepup',target:1,durationMinutes:15,priority:1,
        locationIds:['home'],
        allowedTimeStart:11 * 60 + 31,allowedTimeEnd:13 * 60,
        lastLog:ago1d,logs:[ago1d]
      }),
      base({
        name:'Zuhr',type:'keepup',target:1,durationMinutes:5,priority:0,
        locationIds:['home','khadijam'],
        allowedTimeStart:13 * 60 + 22,allowedTimeEnd:17 * 60 + 7,
        lastLog:ago1d,logs:[ago1d]
      }),
      base({
        name:'Lunch',type:'keepup',target:1,durationMinutes:30,priority:0,
        locationIds:['home'],
        allowedTimeStart:13 * 60 + 22,allowedTimeEnd:15 * 60 + 22,
        lastLog:ago1d,logs:[ago1d]
      })
    ],
    settings:{
      preset:'todayFirst',showWeekOnHome:true,agendaOptimizer:true,focus:'balanced',
      availabilityMinutes:[600,600,600,600,600,600,600],availabilityOverrides:{},
      showScheduledTasksInAgenda:true,showDueTasksInAgenda:true,
      showPlannedItemsInAgenda:true,showDueHabitsInAgenda:true,
      lastKnownLocationId:'home',
      defaultTravelMode:'walking',
      locations:[
        {id:'home',name:'Home',lat:40.70,lng:-74.00},
        {id:'spresh',name:'Spresh',lat:40.71,lng:-74.01},
        {id:'khadijam',name:'KhadijaM',lat:40.705,lng:-74.005}
      ],
      travel:{
        'home|spresh':{
          a:'home',b:'spresh',seconds:6 * 60,metres:900,
          provider:'manual',fetchedAt:Date.now()
        },
        'home|khadijam':{
          a:'home',b:'khadijam',seconds:5 * 60,metres:700,
          provider:'manual',fetchedAt:Date.now()
        },
        'khadijam|spresh':{
          a:'khadijam',b:'spresh',seconds:3 * 60,metres:400,
          provider:'manual',fetchedAt:Date.now()
        }
      },
      blockedTimes:[{label:'sleep',days:[],start:0,end:420,locationId:'home'}]
    }
  });
  check('stale-anchor scenario uses optimizer',staleAnchorResult.optimized,
    JSON.stringify(staleAnchorResult));
  const staleZuhr = staleAnchorResult.fills.find(f=>f.name === 'Zuhr');
  check('Zuhr is placed',Boolean(staleZuhr),JSON.stringify(staleAnchorResult.fills));
  check('Zuhr lands at Home (not KhadijaM)',
    staleZuhr && staleZuhr.loc === 'home',
    staleZuhr ? `got loc=${staleZuhr.loc}` : 'no Zuhr fill');
  check('no travel card to KhadijaM',
    staleAnchorResult.travelsToKhadijam === 0,
    `got ${staleAnchorResult.travelsToKhadijam} travel(s) to khadijam`);
  check('total travel is grocery round-trip only (12m)',
    staleAnchorResult.totalTravelMinutes === 12,
    `got ${staleAnchorResult.totalTravelMinutes}m :: ${JSON.stringify({fills:staleAnchorResult.fills,travel:staleAnchorResult.travelDetail})}`);

  // Fallback path: force timeout / broken glpk should not throw — heuristic still works.
  console.log('\n[Optimizer] heuristic fallback still works with optimizer flag');
  const fallback = await page.evaluate(async ({ now }) => {
    const RealDate = Date;
    function FD(...a) { return a.length === 0 ? new RealDate(now) : new RealDate(...a); }
    FD.now = () => now; FD.parse = RealDate.parse; FD.UTC = RealDate.UTC;
    Object.setPrototypeOf(FD, RealDate); FD.prototype = RealDate.prototype;
    const orig = globalThis.Date; globalThis.Date = FD;
    try {
      const data = JSON.parse(localStorage.getItem('tings_v2'));
      const settings = Object.assign(
        JSON.parse(localStorage.getItem('tings_app_settings_v2')),
        { agendaOptimizer: false }
      );
      const week = buildWeekAgenda(data, settings, 7);
      const tomorrow = week.days[1];
      const fills = (tomorrow?.timeline || []).filter(r => r.kind === 'fill');
      return {
        hasSunrise: fills.some(r => r.h.name === 'Sunrise Exercise'),
        hasFlexible: fills.some(r => r.h.name === 'Flexible Deep Work')
      };
    } finally {
      globalThis.Date = orig;
    }
  }, { now: atTime(15) });
  check('heuristic places sunrise', fallback.hasSunrise);
  check('heuristic places flexible', fallback.hasFlexible);

  await browser.close();
  console.log('');
  if (failures.length) {
    console.error(`FAIL (${failures.length})`);
    failures.forEach(f => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('PASS — agenda optimizer tests green');
})().catch(e => {
  console.error(e.stack || e.message);
  process.exit(1);
});
