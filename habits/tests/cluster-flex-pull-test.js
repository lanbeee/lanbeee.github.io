// Flexibility pull-earlier for location clustering.
// A keepup habit inside its flex window may join a day where a NATIVE-due
// partner shares a nearby (here: same) location — saving a separate trip.
// Flex never pulls earlier standalone; reduce never pulls earlier; and pull
// never cascades from another pulled habit.
// HABITS_URL=http://127.0.0.1:4181/ node tests/cluster-flex-pull-test.js

const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4182/';
let pass = 0;
let fail = 0;
function assert(value,message){
  if(value){ pass += 1; console.log('  ok: ' + message); }
  else { fail += 1; console.error('  not ok: ' + message); }
}

// Shared scenario runner. `withPartner:false` removes the partner task.
async function runScenario(page,{
  flex, type = 'keepup', withPartner = true, atCluster = false,
  partnerDueOffset = 2, optionalOrder = false, withDuePeer = false,
  originFromFirstBlock = false
}){
  return await page.evaluate(async (cfg)=>{
    localStorage.removeItem('tings_v2');
    const today = dayStart(Date.now());
    const now = today + 10 * 3600000;
    const RealDate = Date;
    function FrozenDate(...args){ return args.length ? new RealDate(...args) : new RealDate(now); }
    FrozenDate.now = ()=>now; globalThis.Date = FrozenDate;
    try{
      const clusterId = cfg.originFromFirstBlock ? 'home' : 'gym';
      const settings = {
        preset:'todayFirst',
        showDueHabitsInAgenda:true, showDueTasksInAgenda:true, showPlannedItemsInAgenda:true,
        availabilityMinutes:Array(7).fill(360),
        availabilityOverrides:cfg.withDuePeer ? {[dateKey(today)]:60} : {},
        blockedTimes:cfg.originFromFirstBlock
          ? [{label:'sleep',days:[],start:0,end:420,locationId:'home'}] : [],
        locations:[{id:clusterId,name:cfg.originFromFirstBlock ? 'Home' : 'Gym',lat:1,lng:1}],
        travel:{}, pinnedLocationId:null,
        lastKnownLocationId:cfg.atCluster ? clusterId : null
      };
      saveSortSettings(settings);
      if(typeof sortSettings !== 'undefined')Object.assign(sortSettings,settings);
      const dayMs = 86400000;
      const data = [];
      if(cfg.withPartner){
        data.push({ hid:'partner',name:'Gym errand',type:'task',target:null,
          dueDate:today + cfg.partnerDueOffset*dayMs, eventTime:null, durationMinutes:30, priority:2,
          locationIds:[clusterId], flexibilityDays:0, logs:[], emoji:'🏋️', pinned:false,
          sample:false, snoozedUntil:null, topics:[], createdAt:now,
          scheduleLinks:cfg.optionalOrder ? [{
            anchorHid:'subject',direction:'after',adjacency:'direct',requireSameDay:false
          }] : [] });
      }
      if(cfg.withDuePeer){
        data.push({ hid:'due-peer',name:'Due peer',type:'task',target:null,
          dueDate:today, eventTime:null, durationMinutes:30, priority:2,
          locationIds:[clusterId], flexibilityDays:0, logs:[], emoji:'✅', pinned:false,
          sample:false, snoozedUntil:null, topics:[], createdAt:now, scheduleLinks:[] });
      }
      data.push({ hid:'subject',name: cfg.type === 'reduce' ? 'Skip snack' : 'Lift',
        type:cfg.type, target:5,
        logs:[today - 1*dayMs], lastLog:today - 1*dayMs, durationMinutes: cfg.type === 'reduce' ? 5 : 30,
        priority:2, locationIds:[clusterId], flexibilityDays:cfg.flex, emoji: cfg.type === 'reduce' ? '🍩' : '💪',
        pinned:false, sample:false, snoozedUntil:null, topics:[], createdAt:now - 30*dayMs });
      Storage.write(KEY,data);
      const summarize = week=>{
        const fills = day=>(week.days[day] && Array.isArray(week.days[day].agendaItems))
          ? week.days[day].agendaItems.map(it=>it.h && it.h.hid).filter(Boolean) : [];
        return { d0:fills(0), d2:fills(2), d4:fills(4) };
      };
      const fast = summarize(buildWeekAgenda(load(),loadSortSettings(),7));
      const exact = summarize(await buildWeekAgendaAsync(load(),loadSortSettings(),7,{}));
      return {exact,fast};
    }finally{ globalThis.Date = RealDate; }
  }, {
    flex,type,withPartner,atCluster,partnerDueOffset,optionalOrder,withDuePeer,
    originFromFirstBlock
  });
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors = [];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(baseUrl,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#open-add');

  console.log('\n[A] keepup clusters onto a native-due same-location partner');
  const a = await runScenario(page,{flex:2});
  for(const [engine,result] of Object.entries(a)){
    assert(result.d2.includes('subject'),`${engine}: subject clusters onto partner day 2 (same gym) ` + JSON.stringify(result.d2));
    assert(result.d2.includes('partner'),`${engine}: partner task placed on its due day 2 ` + JSON.stringify(result.d2));
    assert(!result.d4.includes('subject'),`${engine}: subject not also placed on native due day 4 (placed once, early) ` + JSON.stringify(result.d4));
  }

  console.log('\n[B] flex=0 → no pull-earlier; subject waits for native due day');
  const b = await runScenario(page,{flex:0});
  for(const [engine,result] of Object.entries(b)){
    assert(!result.d2.includes('subject'),`${engine}: flex=0 subject NOT pulled to day 2 ` + JSON.stringify(result.d2));
    assert(result.d4.includes('subject'),`${engine}: flex=0 subject waits for native due day 4 ` + JSON.stringify(result.d4));
  }

  console.log('\n[C] reduce never pulls earlier onto a cluster day');
  const c = await runScenario(page,{flex:3, type:'reduce'});
  for(const [engine,result] of Object.entries(c)){
    assert(!result.d2.includes('subject'),`${engine}: reduce NOT flex-pulled onto cluster day 2 ` + JSON.stringify(result.d2));
  }

  console.log('\n[D] no partner → no pull-earlier (flex is not standalone-greedy)');
  const d = await runScenario(page,{flex:2, withPartner:false});
  for(const [engine,result] of Object.entries(d)){
    assert(!result.d2.includes('subject'),`${engine}: no partner → subject not pulled to day 2 ` + JSON.stringify(result.d2));
    assert(result.d4.includes('subject'),`${engine}: subject still placed on native due day 4 ` + JSON.stringify(result.d4));
  }

  console.log('\n[E] a same-origin pair creates no travel-saving early occurrence');
  const e = await runScenario(page,{
    flex:4,atCluster:true,partnerDueOffset:0,optionalOrder:true,withDuePeer:true
  });
  for(const [engine,result] of Object.entries(e)){
    assert(!result.d0.includes('subject'),
      `${engine}: being at the shared location does not pull the flexible habit early ` + JSON.stringify(result.d0));
    assert(result.d0.includes('partner') && result.d0.includes('due-peer'),
      `${engine}: optional ordering leaves today's capacity to independently due work ` + JSON.stringify(result.d0));
  }

  console.log('\n[F] first location-bearing block is an origin fallback');
  const f = await runScenario(page,{
    flex:4,originFromFirstBlock:true,partnerDueOffset:0,optionalOrder:true,withDuePeer:true
  });
  for(const [engine,result] of Object.entries(f)){
    assert(!result.d0.includes('subject'),
      `${engine}: ended Sleep at the shared place supplies an otherwise unknown origin ` + JSON.stringify(result.d0));
    assert(result.d0.includes('partner') && result.d0.includes('due-peer'),
      `${engine}: block-derived origin leaves today's capacity to independently due work ` + JSON.stringify(result.d0));
  }

  console.log('\n[G] current location outranks the first block location');
  const g = await page.evaluate(() => {
    const today = dayStart(Date.now());
    const settings = {
      ...loadSortSettings(),
      locations:[
        {id:'home',name:'Home',lat:1,lng:1},
        {id:'away',name:'Away',lat:2,lng:2}
      ],
      blockedTimes:[{label:'sleep',days:[],start:0,end:420,locationId:'home'}],
      pinnedLocationId:'away',
      lastKnownLocationId:null
    };
    saveSortSettings(settings);
    if(typeof sortSettings !== 'undefined')Object.assign(sortSettings,settings);
    if(typeof setPlannerCurrentCoord === 'function')setPlannerCurrentCoord({lat:40.7128,lng:-74.0060});
    const day = {
      dayBase:today,weekday:new Date(today).getDay(),isToday:true,
      dayKey:dateKey(today),totalMinutes:60,slots:[],scheduled:[]
    };
    const pinnedState = createDayPlacementState(day,settings,{dayBase:today,weekMode:true});
    const pinnedTimelineSeed = dayTimelineSeedLocation(day,settings);
    const unpinnedSettings = {...settings,pinnedLocationId:null};
    saveSortSettings(unpinnedSettings);
    if(typeof sortSettings !== 'undefined')Object.assign(sortSettings,unpinnedSettings);
    const gpsState = createDayPlacementState(day,unpinnedSettings,{dayBase:today,weekMode:true});
    const tomorrow = today + 86400000;
    const futureDay = {
      dayBase:tomorrow,weekday:new Date(tomorrow).getDay(),isToday:false,
      dayKey:dateKey(tomorrow),totalMinutes:60,slots:[],scheduled:[]
    };
    const futureState = createDayPlacementState(futureDay,unpinnedSettings,{dayBase:tomorrow,weekMode:true});
    const result = {
      pinnedPlannerSeed:pinnedState.seedLocId,
      pinnedLive:pinnedState.liveLocId,
      timelineSeed:pinnedTimelineSeed,
      gpsPlannerSeed:gpsState.seedLocId,
      futurePlannerSeed:futureState.seedLocId,
      currentCoordId:typeof CURRENT_COORD_ID !== 'undefined' ? CURRENT_COORD_ID : '__current__'
    };
    if(typeof setPlannerCurrentCoord === 'function')setPlannerCurrentCoord(null);
    return result;
  });
  assert(g.pinnedPlannerSeed === 'away' && g.timelineSeed === 'away' && g.pinnedLive === 'away',
    'manual Away overrides both conflicting GPS and the earlier Sleep at Home ' + JSON.stringify(g));
  assert(g.gpsPlannerSeed === g.currentCoordId,
    'without a pin, far live GPS overrides the earlier Sleep at Home ' + JSON.stringify(g));
  assert(g.futurePlannerSeed === 'home',
    'future planning ignores today GPS and uses the first block location ' + JSON.stringify(g));

  assert(!errors.length,'no page errors');

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(err=>{ console.error('CRASH',err); process.exit(1); });
