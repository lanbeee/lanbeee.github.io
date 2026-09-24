// Already standing at a store: do that store's errand before a home lunch
// or prayer that can still fit afterward. A later far appointment must still
// keep neighborhood errands on one side of the trip — an at-home window must
// not jump ahead of them (go far, come back, go far again).
//
// HABITS_URL=http://127.0.0.1:4181/ node tests/at-location-before-home-bounce-test.js
const {chromium, BASE, baseHabit, glpkAvailable} = require('./helpers/planner-test-helpers');

function assert(cond, msg){
  if(!cond)throw new Error(msg);
}

(async () => {
  const browser = await chromium.launch({headless:true});
  try{
    const page = await browser.newPage();
    await page.goto(BASE);
    await page.waitForFunction(() => typeof buildWeekAgenda === 'function'
      && typeof buildWeekAgendaAsync === 'function'
      && typeof compareWeekClaimPriority === 'function');
    const glpkOk = await glpkAvailable(page);

    const result = await page.evaluate(async ({base, glpkOk}) => {
      const RealDate = Date;
      const now = new RealDate(2026, 8, 23, 13, 6, 0).getTime();
      class FrozenDate extends RealDate {
        constructor(...args){ super(...(args.length ? args : [now])); }
        static now(){ return now; }
      }
      FrozenDate.parse = RealDate.parse;
      FrozenDate.UTC = RealDate.UTC;
      Object.setPrototypeOf(FrozenDate, RealDate);
      FrozenDate.prototype = RealDate.prototype;
      globalThis.Date = FrozenDate;

      const today = dayStart(now);
      const edge = (a, b, seconds) => ({
        a, b, seconds, metres:Math.round(seconds * 8), provider:'manual', fetchedAt:now
      });
      const settings = {
        preset:'todayFirst', showWeekOnHome:true, agendaOptimizer:true, focus:'balanced',
        availabilityMinutes:[1440, 1440, 1440, 1440, 1440, 1440, 1440],
        availabilityOverrides:{},
        showScheduledTasksInAgenda:true, showDueTasksInAgenda:true,
        showPlannedItemsInAgenda:true, showDueHabitsInAgenda:true,
        lastKnownLocationId:'walmart', pinnedLocationId:null, defaultTravelMode:'driving',
        agendaScoreWeights:{travel:1, cluster:1, day:1, asap:0.12, scarce:0.05, preference:1.5},
        locations:[
          {id:'home', name:'Home', lat:42.980, lng:-78.800},
          {id:'walmart', name:'Walmart', lat:42.981, lng:-78.801},
          {id:'wholefoods', name:'WholeFoods', lat:42.982, lng:-78.802}
        ],
        travel:{
          'home|walmart':edge('home', 'walmart', 120),
          'home|wholefoods':edge('home', 'wholefoods', 120),
          'walmart|wholefoods':edge('walmart', 'wholefoods', 120)
        },
        blockedTimes:[{label:'sleep', days:[], start:0, end:420, locationId:'home'}]
      };
      const ago = days => today - days * 86400000;
      const data = [
        {...base, hid:'grocery', name:'Weekly grocery', type:'keepup', target:7,
          durationMinutes:45, priority:2, locationIds:['walmart'], anywhereAllowed:false,
          lastLog:ago(8), logs:[ago(8)], createdAt:ago(30)},
        {...base, hid:'zuhr', name:'Zuhr', type:'keepup', target:1, durationMinutes:5,
          priority:0, locationIds:['home'], anywhereAllowed:false,
          allowedTimeStart:13 * 60 + 8, allowedTimeEnd:16 * 60 + 20,
          lastLog:ago(1), logs:[ago(1)], createdAt:ago(30)},
        {...base, hid:'lunch', name:'Lunch', type:'keepup', target:1, durationMinutes:15,
          priority:1, locationIds:['home'], anywhereAllowed:false,
          allowedTimeStart:13 * 60, allowedTimeEnd:15 * 60 + 8,
          lastLog:ago(1), logs:[ago(1)], createdAt:ago(30)},
        {...base, hid:'stool', name:'Return stool', type:'task', target:null,
          durationMinutes:10, priority:2, dueDate:today, flexibilityDays:0,
          locationIds:['wholefoods'], anywhereAllowed:false, createdAt:ago(3)}
      ];
      const summarize = week => {
        const day = (week.days || [])[0] || {};
        const fills = (day.timeline || []).filter(row => row.kind === 'fill').map(row => ({
          name:row.h && row.h.name,
          loc:row.locationId || null,
          start:row.start
        }));
        const byName = name => fills.find(row => row.name === name);
        const grocery = byName('Weekly grocery');
        const travelsToWalmart = (day.timeline || []).filter(row =>
          row.kind === 'travel' && row.to === 'walmart');
        const homeBeforeGrocery = fills.some(row =>
          grocery && (row.loc === 'home') && row.start < grocery.start);
        return {
          optimized:Boolean(week.optimized),
          solve:week.plannerSolveStatus || null,
          fills:fills.map(row => row.name),
          groceryFirst:Boolean(grocery)
            && fills.filter(row => row.name !== 'Weekly grocery')
              .every(row => row.start >= grocery.start),
          homeBeforeGrocery,
          travelsToWalmart:travelsToWalmart.length,
          placed:{
            grocery:Boolean(grocery),
            zuhr:Boolean(byName('Zuhr')),
            lunch:Boolean(byName('Lunch')),
            stool:Boolean(byName('Return stool'))
          }
        };
      };
      const fastWeek = buildWeekAgenda(data, Object.assign({}, settings, {agendaOptimizer:false}), 1);
      let glpk = null;
      if(glpkOk){
        const week = await buildWeekAgendaAsync(data, settings, 1);
        glpk = summarize(week);
      }
      try{
        return {fast:summarize(fastWeek), glpk};
      }finally{
        globalThis.Date = RealDate;
      }
    }, {base:baseHabit({}), glpkOk});

    const expectNoBounce = (label, summary) => {
      assert(summary.placed.grocery && summary.placed.zuhr
        && summary.placed.lunch && summary.placed.stool,
        `${label} still places grocery, Zuhr, lunch, and the stool return ${JSON.stringify(summary)}`);
      assert(summary.groceryFirst && !summary.homeBeforeGrocery,
        `${label} does the Walmart errand before going home ${JSON.stringify(summary)}`);
      assert(summary.travelsToWalmart === 0,
        `${label} does not travel back to Walmart ${JSON.stringify(summary)}`);
    };
    expectNoBounce('Fast', result.fast);
    if(glpkOk){
      assert(result.glpk.optimized, `GLPK used the optimizer ${JSON.stringify(result.glpk)}`);
      expectNoBounce('GLPK', result.glpk);
    }else{
      console.log('skip GLPK (wasm unavailable)');
    }

    const tight = await page.evaluate(async ({base, glpkOk}) => {
      const RealDate = Date;
      const now = new RealDate(2026, 8, 23, 13, 6, 0).getTime();
      class FrozenDate extends RealDate {
        constructor(...args){ super(...(args.length ? args : [now])); }
        static now(){ return now; }
      }
      FrozenDate.parse = RealDate.parse;
      FrozenDate.UTC = RealDate.UTC;
      Object.setPrototypeOf(FrozenDate, RealDate);
      FrozenDate.prototype = RealDate.prototype;
      globalThis.Date = FrozenDate;
      const today = dayStart(now);
      const edge = (a, b, seconds) => ({
        a, b, seconds, metres:Math.round(seconds * 8), provider:'manual', fetchedAt:now
      });
      const settings = {
        preset:'todayFirst', showWeekOnHome:true, agendaOptimizer:true, focus:'balanced',
        availabilityMinutes:[1440, 1440, 1440, 1440, 1440, 1440, 1440],
        availabilityOverrides:{},
        showScheduledTasksInAgenda:true, showDueTasksInAgenda:true,
        showPlannedItemsInAgenda:true, showDueHabitsInAgenda:true,
        lastKnownLocationId:'walmart', pinnedLocationId:null, defaultTravelMode:'driving',
        locations:[
          {id:'home', name:'Home', lat:42.980, lng:-78.800},
          {id:'walmart', name:'Walmart', lat:42.981, lng:-78.801},
          {id:'clinic', name:'Clinic', lat:43.200, lng:-78.900}
        ],
        travel:{
          'home|walmart':edge('home', 'walmart', 120),
          'home|clinic':edge('home', 'clinic', 20 * 60),
          'walmart|clinic':edge('walmart', 'clinic', 15 * 60)
        },
        blockedTimes:[
          {label:'sleep', days:[], start:0, end:13 * 60},
          {label:'evening', days:[], start:17 * 60 + 30, end:1440}
        ]
      };
      const ago = days => today - days * 86400000;
      const data = [
        {...base, hid:'short', name:'Short errand', type:'keepup', target:7,
          durationMinutes:20, priority:2, locationIds:['walmart'], anywhereAllowed:false,
          lastLog:ago(8), logs:[ago(8)], createdAt:ago(30)},
        {...base, hid:'long', name:'Long errand', type:'keepup', target:7,
          durationMinutes:150, priority:2, locationIds:['walmart'], anywhereAllowed:false,
          lastLog:ago(8), logs:[ago(8)], createdAt:ago(30)},
        {...base, hid:'visit', name:'Clinic visit', type:'task', target:null,
          durationMinutes:210, priority:0, dueDate:today, flexibilityDays:0,
          locationIds:['clinic'], anywhereAllowed:false, createdAt:ago(3)}
      ];
      const summarize = week => {
        const day = (week.days || [])[0] || {};
        const fills = (day.timeline || []).filter(row => row.kind === 'fill').map(row => ({
          name:row.h && row.h.name,
          start:row.start
        }));
        const visit = fills.find(row => row.name === 'Clinic visit');
        const beforeVisit = fills.filter(row => visit && row.start < visit.start).map(row => row.name);
        return {
          fills:fills.map(row => row.name),
          visit:Boolean(visit),
          beforeVisit
        };
      };
      const registry = normalizeLocationRegistry(settings.locations);
      const state = {
        dayBase:today, isTodayDay:true, startClock:now, seedLocId:'walmart',
        liveLocId:'walmart', settings, registry, mode:'driving',
        slots:[{start:now, end:today + (17 * 60 + 30) * 60000}]
      };
      const dayStates = [state, {dayBase:today + 86400000, isTodayDay:false}];
      const cand = (h, extra) => ({h, priority:h.priority, eligible:new Set([today]), ...extra});
      const short = cand(data[0], {});
      const long = cand(data[1], {});
      const visit = cand(data[2], {});
      prepareAtLocationYield([long, visit, short], dayStates);
      const cmp = (a, b) => compareWeekClaimPriority(a, b, dayStates);
      const ordered = [long, visit, short].slice().sort((a, b) => cmp(a, b) || a.h.name.localeCompare(b.h.name));
      const fast = summarize(buildWeekAgenda(data, Object.assign({}, settings, {agendaOptimizer:false}), 1));
      let glpk = null;
      if(glpkOk) glpk = summarize(await buildWeekAgendaAsync(data, settings, 1));
      try{
        return {
          yields:{short:short.yieldsToAtLocation, long:long.yieldsToAtLocation, visit:visit.yieldsToAtLocation},
          cmp:{
            shortVisit:cmp(short, visit),
            longVisit:cmp(long, visit),
            shortLong:cmp(short, long)
          },
          order:ordered.map(item => item.h.name),
          fast,
          glpk
        };
      }finally{
        globalThis.Date = RealDate;
      }
    }, {base:baseHabit({}), glpkOk});

    assert(tight.cmp.shortVisit > 0 && tight.cmp.longVisit > 0,
      `both Walmart errands sort after the visit that cannot follow the block ${JSON.stringify(tight.cmp)}`);
    assert(tight.cmp.shortLong === 0,
      `the two at-location errands are one tier ${JSON.stringify(tight.cmp)}`);
    assert(tight.order[0] === 'Clinic visit',
      `sort puts the visit first ${JSON.stringify(tight.order)}`);
    assert(tight.fast.visit && tight.fast.beforeVisit.length === 0,
      `Fast keeps the clinic visit ahead of Walmart errands ${JSON.stringify(tight.fast)}`);
    if(glpkOk){
      assert(tight.glpk.visit && tight.glpk.beforeVisit.length === 0,
        `GLPK keeps the clinic visit ahead of Walmart errands ${JSON.stringify(tight.glpk)}`);
    }
    console.log('PASS at Walmart: grocery before home, no return trip');
  }finally{
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
