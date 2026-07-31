// Persistent Schedule habit relationships — model, migration, Fast, and GLPK.
// HABITS_URL=http://127.0.0.1:4182/ node tests/schedule-links-test.js

const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4182/';
const FAST_ONLY = process.env.HABITS_PLANNER_MODE === 'fast';
let pass = 0;
let fail = 0;
function assert(value,message){
  if(value){ pass += 1; console.log('  ok: ' + message); }
  else { fail += 1; console.error('  not ok: ' + message); }
}

(async()=>{
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const errors = [];
  page.on('pageerror',error=>errors.push(String(error)));
  await page.goto(baseUrl,{waitUntil:'domcontentloaded'});
  await page.waitForSelector('#open-add');

  console.log('\n[A] normalization + graph validation');
  const model = await page.evaluate(()=>{
    localStorage.removeItem('tings_v2');
    const anchor = normalize([{hid:'link-anchor',name:'Anchor',type:'keepup',target:7}])[0];
    const legacyRaw = {
      hid:'link-subject',name:'Subject',type:'keepup',target:7,
      allowedTimeStartAnchor:'habit',
      allowedTimeStartAnchorHabitId:anchor.hid,
      allowedTimeStartOffsetMin:0
    };
    const migrated = normalize([anchor,legacyRaw]).find(h=>h.hid === 'link-subject');
    const offsetLegacy = normalize([anchor,{
      ...legacyRaw,hid:'link-offset',name:'Offset',allowedTimeStartOffsetMin:15
    }]).find(h=>h.hid === 'link-offset');
    const cycleA = {...anchor,scheduleLinks:{before:{anchorHid:'link-subject',adjacency:'sometime',requireSameDay:false},after:null}};
    const cycleB = {...migrated,scheduleLinks:{before:{anchorHid:'link-anchor',adjacency:'sometime',requireSameDay:false},after:null}};
    return {
      migratedLink:migrated.scheduleLinks.after,
      migratedAnchor:migrated.allowedTimeStartAnchor,
      legacyAnchor:offsetLegacy.allowedTimeStartAnchor,
      cycle:validateScheduleLinkGraph([cycleA,cycleB])
    };
  });
  assert(model.migratedLink && model.migratedLink.anchorHid === 'link-anchor','zero-offset start migrates to recurring after link');
  assert(model.migratedAnchor === null,'migrated time anchor is cleared');
  assert(model.legacyAnchor === 'habit','offset completion-trigger timing remains legacy');
  assert(model.cycle && model.cycle.ok === false && /cycle/.test(model.cycle.message),'persistent cycles are rejected');

  async function plannerScenario(useGlpk,variant){
    return page.evaluate(async ({useGlpk,variant})=>{
      // Keep the planner scenarios independent of the wall clock. They need
      // up to 120 minutes of today's open timeline and may run near midnight.
      const now = dayStart(Date.now()) + 9 * 3600000;
      const settings = {
        ...loadSortSettings(),
        preset:'todayFirst',
        showWeekOnHome:true,
        agendaOptimizer:useGlpk,
        availabilityMinutes:Array(7).fill(variant === 'breakable' ? 120 : 60),
        blockedTimes:[],
        locations:[],
        travel:{},
        showDueHabitsInAgenda:true,
        showDueTasksInAgenda:true,
        showScheduledTasksInAgenda:true,
        showPlannedItemsInAgenda:true
      };
      const budget = variant === 'breakable' ? 120 : 60;
      settings.availabilityOverrides = {};
      for(let offset = 0;offset < 2;offset += 1){
        settings.availabilityOverrides[dateKey(dayStart(now) + offset * 86400000)] = budget;
      }
      saveSortSettings(settings);
      if(typeof sortSettings !== 'undefined')Object.assign(sortSettings,settings);
      const anchorLogs = variant === 'completed-after' || variant === 'completed-before'
        ? [now - 60 * 60000] : [];
      const anchor = {
        hid:'p-anchor',name:'Anchor',type:'keepup',target:7,logs:anchorLogs,
        durationMinutes:30,priority:1
      };
      const direction = variant === 'before' || variant === 'completed-before' ? 'before' : 'after';
      const requireSameDay = variant !== 'optional-absent';
      const subject = {
        hid:'p-subject',name:'Subject',type:'keepup',target:7,logs:[],
        durationMinutes:30,priority:1,
        scheduleLinks:{
          before:direction === 'before'
            ? {anchorHid:'p-anchor',adjacency:'direct',requireSameDay} : null,
          after:direction === 'after'
            ? {anchorHid:'p-anchor',adjacency:'direct',requireSameDay} : null
        }
      };
      if(variant === 'breakable'){
        anchor.breakable = true;
        anchor.durationMinutes = 60;
        anchor.minChunkMinutes = 30;
        subject.breakable = true;
        subject.durationMinutes = 60;
        subject.minChunkMinutes = 30;
      }
      if(variant === 'required-absent' || variant === 'optional-absent'){
        anchor.logs = [now - 86400000];
        anchor.target = 30;
      }
      const noise = {
        hid:'p-noise',name:'Noise',type:'keepup',target:7,logs:[],
        durationMinutes:60,priority:5
      };
      // Freeze the planner at 9am so late-night suite runs do not clip today's
      // slots or make completion logs appear in the frozen clock's future.
      const RealDate = Date;
      const planNow = now;
      function FrozenDate(...args){
        return args.length ? new RealDate(...args) : new RealDate(planNow);
      }
      FrozenDate.now = ()=>planNow;
      FrozenDate.parse = RealDate.parse;
      FrozenDate.UTC = RealDate.UTC;
      Object.setPrototypeOf(FrozenDate,RealDate);
      FrozenDate.prototype = RealDate.prototype;
      const originalDate = globalThis.Date;
      globalThis.Date = FrozenDate;
      let week;
      try{
        // Persist and load after freezing: this makes synthetic 8am logs
        // actual completions even when the real clock is earlier than 8am.
        save([anchor,subject,noise]);
        const data = load();
        week = useGlpk
          ? await buildWeekAgendaAsync(data,loadSortSettings(),2)
          : buildWeekAgenda(data,loadSortSettings(),2);
      }finally{
        globalThis.Date = originalDate;
      }
      const targetDay = week.days[0];
      const fills = (targetDay.timeline || []).filter(row=>row.kind === 'fill');
      return {
        optimized:Boolean(week.optimized),
        order:fills.map(row=>row.h && row.h.hid),
        starts:Object.fromEntries(fills.map(row=>[row.h && row.h.hid,row.start])),
        omissions:targetDay.linkOmissions || []
      };
    },{useGlpk,variant});
  }

  for(const useGlpk of FAST_ONLY ? [false] : [false,true]){
    const label = useGlpk ? 'GLPK' : 'Fast';
    console.log(`\n[${label}] recurring placement`);
    const after = await plannerScenario(useGlpk,'after');
    assert(after.order.indexOf('p-anchor') >= 0 && after.order.indexOf('p-subject') >= 0,`${label}: required pair is placed`);
    assert(after.order.indexOf('p-anchor') < after.order.indexOf('p-subject'),`${label}: right-after order is honored`);
    assert(!after.order.includes('p-noise'),`${label}: lower-priority unrelated work yields to the linked pair`);
    const before = await plannerScenario(useGlpk,'before');
    assert(before.order.indexOf('p-subject') >= 0 && before.order.indexOf('p-anchor') >= 0,`${label}: before pair is placed`);
    assert(before.order.indexOf('p-subject') < before.order.indexOf('p-anchor'),`${label}: right-before order is honored`);
    const requiredAbsent = await plannerScenario(useGlpk,'required-absent');
    assert(!requiredAbsent.order.includes('p-subject'),`${label}: same-day requirement removes dependent when anchor is not eligible`);
    assert(requiredAbsent.omissions.some(item=>item.subjectHid === 'p-subject'),`${label}: absent anchor produces an explanation`);
    const optionalAbsent = await plannerScenario(useGlpk,'optional-absent');
    assert(optionalAbsent.order.includes('p-subject'),`${label}: optional anchor does not gate dependent eligibility`);
    const completedAfter = await plannerScenario(useGlpk,'completed-after');
    assert(completedAfter.order.includes('p-subject'),`${label}: completed-today anchor satisfies after relationship`);
    const completedBefore = await plannerScenario(useGlpk,'completed-before');
    assert(!completedBefore.order.includes('p-subject'),`${label}: incomplete before-dependent is omitted after anchor completion`);
    const breakable = await plannerScenario(useGlpk,'breakable');
    const lastAnchor = breakable.order.lastIndexOf('p-anchor');
    const firstSubject = breakable.order.indexOf('p-subject');
    assert(lastAnchor >= 0 && firstSubject > lastAnchor,
      `${label}: breakable boundary chunks honor right-after (${breakable.order.join(' → ')})`);
  }

  assert(errors.length === 0,'no page errors');
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if(fail)process.exit(1);
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
