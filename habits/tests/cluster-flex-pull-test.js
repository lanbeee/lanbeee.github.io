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

// Shared scenario runner. `partnerDueOffset` = null means no partner task.
async function runScenario(page,{flex, type = 'keepup', withPartner = true}){
  return await page.evaluate(async (cfg)=>{
    localStorage.removeItem('tings_v2');
    const today = dayStart(Date.now());
    const now = today + 10 * 3600000;
    const RealDate = Date;
    function FrozenDate(...args){ return args.length ? new RealDate(...args) : new RealDate(now); }
    FrozenDate.now = ()=>now; globalThis.Date = FrozenDate;
    try{
      const settings = {
        preset:'todayFirst',
        showDueHabitsInAgenda:true, showDueTasksInAgenda:true, showPlannedItemsInAgenda:true,
        availabilityMinutes:Array(7).fill(360), availabilityOverrides:{},
        blockedTimes:[], locations:[{id:'gym',name:'Gym',lat:1,lng:1}], travel:{}
      };
      saveSortSettings(settings);
      if(typeof sortSettings !== 'undefined')Object.assign(sortSettings,settings);
      const dayMs = 86400000;
      const data = [];
      if(cfg.withPartner){
        data.push({ hid:'partner',name:'Gym errand',type:'task',target:null,
          dueDate:today + 2*dayMs, eventTime:null, durationMinutes:30, priority:2,
          locationIds:['gym'], flexibilityDays:0, logs:[], emoji:'🏋️', pinned:false,
          sample:false, snoozedUntil:null, topics:[], createdAt:now });
      }
      data.push({ hid:'subject',name: cfg.type === 'reduce' ? 'Skip snack' : 'Lift',
        type:cfg.type, target:5,
        logs:[today - 1*dayMs], lastLog:today - 1*dayMs, durationMinutes: cfg.type === 'reduce' ? 5 : 30,
        priority:2, locationIds:['gym'], flexibilityDays:cfg.flex, emoji: cfg.type === 'reduce' ? '🍩' : '💪',
        pinned:false, sample:false, snoozedUntil:null, topics:[], createdAt:now - 30*dayMs });
      Storage.write(KEY,data);
      const week = await buildWeekAgendaAsync(load(),loadSortSettings(),7,{});
      const fills = day=>(week.days[day] && Array.isArray(week.days[day].agendaItems))
        ? week.days[day].agendaItems.map(it=>it.h && it.h.hid).filter(Boolean) : [];
      return { d2:fills(2), d4:fills(4) };
    }finally{ globalThis.Date = RealDate; }
  }, {flex, type, withPartner});
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
  assert(a.d2.includes('subject'),'subject clusters onto partner day 2 (same gym) ' + JSON.stringify(a.d2));
  assert(a.d2.includes('partner'),'partner task placed on its due day 2 ' + JSON.stringify(a.d2));
  assert(!a.d4.includes('subject'),'subject not also placed on native due day 4 (placed once, early) ' + JSON.stringify(a.d4));

  console.log('\n[B] flex=0 → no pull-earlier; subject waits for native due day');
  const b = await runScenario(page,{flex:0});
  assert(!b.d2.includes('subject'),'flex=0 subject NOT pulled to day 2 ' + JSON.stringify(b.d2));
  assert(b.d4.includes('subject'),'flex=0 subject waits for native due day 4 ' + JSON.stringify(b.d4));

  console.log('\n[C] reduce never pulls earlier onto a cluster day');
  const c = await runScenario(page,{flex:3, type:'reduce'});
  assert(!c.d2.includes('subject'),'reduce NOT flex-pulled onto cluster day 2 ' + JSON.stringify(c.d2));

  console.log('\n[D] no partner → no pull-earlier (flex is not standalone-greedy)');
  const d = await runScenario(page,{flex:2, withPartner:false});
  assert(!d.d2.includes('subject'),'no partner → subject not pulled to day 2 ' + JSON.stringify(d.d2));
  assert(d.d4.includes('subject'),'subject still placed on native due day 4 ' + JSON.stringify(d.d4));

  assert(!errors.length,'no page errors');

  await browser.close();
  console.log('\n' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(err=>{ console.error('CRASH',err); process.exit(1); });
