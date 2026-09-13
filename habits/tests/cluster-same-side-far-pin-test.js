// Nearby seed-cluster errands must stay on the same side of a later far pin.
// A short Home window (Asr-shaped) used to take the earliest clock, then one
// store "on the way" to the pin, then the second store punched a hole in the
// far visit (two extra long legs). Both engines should finish both stores
// before the far event starts.
//
// HABITS_URL=http://127.0.0.1:4181/ node tests/cluster-same-side-far-pin-test.js
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
      const now = new RealDate(2026, 8, 13, 16, 9, 0).getTime();
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
      const edge = (a,b,seconds)=>({
        a,b,seconds,metres:Math.round(seconds * 8),provider:'manual',fetchedAt:now
      });
      const settings = {
        preset:'todayFirst', showWeekOnHome:true, agendaOptimizer:true, focus:'balanced',
        availabilityMinutes:[1440, 1440, 1440, 1440, 1440, 1440, 1440],
        availabilityOverrides:{},
        showScheduledTasksInAgenda:true, showDueTasksInAgenda:true,
        showPlannedItemsInAgenda:true, showDueHabitsInAgenda:true,
        lastKnownLocationId:'home', defaultTravelMode:'driving',
        agendaScoreWeights:{travel:1, cluster:1, day:1, asap:0.12, scarce:0.05, preference:1.5},
        locations:[
          {id:'home', name:'Home', lat:42.985, lng:-78.816},
          {id:'storeA', name:'StoreA', lat:42.979, lng:-78.817},
          {id:'storeB', name:'StoreB', lat:42.982, lng:-78.812},
          {id:'farEvent', name:'FarEvent', lat:43.024, lng:-78.739}
        ],
        travel:{
          'home|storeA':edge('home','storeA', 120),
          'home|storeB':edge('home','storeB', 120),
          'storeA|storeB':edge('storeA','storeB', 127),
          'home|farEvent':edge('home','farEvent', 960),
          'storeA|farEvent':edge('storeA','farEvent', 750),
          'storeB|farEvent':edge('storeB','farEvent', 754)
        },
        blockedTimes:[
          {label:'sleep', days:[], start:0, end:540, locationId:'home'}
        ]
      };
      const mkKeepup = (hid, name, start, end, dur, locIds)=>({
        ...base, hid, name, type:'keepup', target:1, durationMinutes:dur, priority:0,
        allowedTimeStart:start, allowedTimeEnd:end, lastLog:today - 86400000,
        logs:[today - 86400000], locationIds:locIds, anywhereAllowed:false,
        createdAt:now - 10 * 86400000
      });
      const mkStore = (hid, name, loc, dur)=>({
        ...base, hid, name, type:'task', target:null, durationMinutes:dur, priority:2,
        dueDate:today + 2 * 86400000, earlyWindowDays:60, delayAllowanceDays:0,
        locationIds:[loc], anywhereAllowed:false, createdAt:now - 10 * 86400000
      });
      const farVisit = {
        ...base, hid:'far-visit', name:'Far visit', type:'task', target:null,
        durationMinutes:180, breakable:true, minChunkMinutes:15, priority:0,
        dueDate:today, eventTime:today + 17.5 * 3600000,
        earlyWindowDays:0, delayAllowanceDays:0, flexibilityDays:0,
        locationIds:['farEvent'], anywhereAllowed:false, createdAt:now - 86400000
      };
      const data = [
        mkKeepup('home-window', 'Home window', 16 * 60 + 42, 19 * 60 + 12, 5, ['home']),
        mkStore('store-a', 'Store A return', 'storeA', 10),
        mkStore('store-b', 'Store B return', 'storeB', 15),
        farVisit
      ];
      const summarize = week => {
        const day = (week.days || [])[0] || {};
        const fills = (day.timeline || []).filter(row=>row.kind === 'fill').map(row=>({
          name:row.h && row.h.name,
          loc:row.locationId || null,
          start:Math.round((row.start - today) / 60000),
          end:Math.round((row.end - today) / 60000)
        }));
        const travels = (day.timeline || []).filter(row=>row.kind === 'travel').map(row=>({
          from:row.from, to:row.to,
          start:Math.round((row.start - today) / 60000),
          end:Math.round((row.end - today) / 60000)
        }));
        const storeNames = ['Store A return', 'Store B return'];
        const storeFills = fills.filter(row=>storeNames.includes(row.name));
        const farFills = fills.filter(row=>row.name === 'Far visit');
        const firstFar = farFills.reduce((min,row)=>Math.min(min,row.start), Infinity);
        const lastFar = farFills.reduce((max,row)=>Math.max(max,row.end), -Infinity);
        const split = storeFills.some(row=>Number.isFinite(firstFar) && Number.isFinite(lastFar)
          && row.start >= firstFar && row.end <= lastFar);
        return {
          fills, travels, split,
          storesBeforePin:storeFills.length === 2
            && storeFills.every(row=>row.end <= firstFar + 1),
          homeWindow:fills.some(row=>row.name === 'Home window'),
          farStart:Number.isFinite(firstFar) ? firstFar : null,
          storeEnds:storeFills.map(row=>row.end).sort((a,b)=>a-b)
        };
      };

      const fastWeek = buildWeekAgenda(data, Object.assign({}, settings, {agendaOptimizer:false}), 1);
      let glpk = null;
      if(glpkOk){
        const week = await buildWeekAgendaAsync(data, settings, 1);
        glpk = Object.assign({optimized:Boolean(week.optimized)}, summarize(week));
      }
      try{
        return {fast:summarize(fastWeek), glpk};
      }finally{
        globalThis.Date = RealDate;
      }
    }, {base:baseHabit({}), glpkOk});

    assert(result.fast.homeWindow, `Fast still places the Home window ${JSON.stringify(result.fast)}`);
    assert(result.fast.storesBeforePin,
      `Fast finishes both neighborhood returns before the far pin ${JSON.stringify(result.fast)}`);
    assert(!result.fast.split,
      `Fast does not punch a neighborhood return through the far visit ${JSON.stringify(result.fast)}`);

    if(glpkOk){
      assert(result.glpk.optimized, `GLPK used the optimizer ${JSON.stringify(result.glpk)}`);
      assert(result.glpk.homeWindow, `GLPK still places the Home window ${JSON.stringify(result.glpk)}`);
      assert(result.glpk.storesBeforePin,
        `GLPK finishes both neighborhood returns before the far pin ${JSON.stringify(result.glpk)}`);
      assert(!result.glpk.split,
        `GLPK does not punch a neighborhood return through the far visit ${JSON.stringify(result.glpk)}`);
    }else{
      console.log('skip GLPK (wasm unavailable)');
    }
    console.log('PASS cluster same-side far pin: neighborhood returns finish before the far visit');
  }finally{
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
