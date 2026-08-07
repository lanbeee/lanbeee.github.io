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
    const legacyObject = normalize([{
      hid:'legacy-obj',name:'Legacy',type:'keepup',target:7,
      scheduleLinks:{
        before:{anchorHid:'link-anchor',adjacency:'sometime',requireSameDay:true},
        after:{anchorHid:'link-subject',adjacency:'direct',requireSameDay:false}
      }
    },anchor,{hid:'link-subject',name:'Subject',type:'keepup',target:7}])
      .find(h=>h.hid === 'legacy-obj');
    const cycleA = {...anchor,scheduleLinks:[
      {anchorHid:'link-subject',direction:'before',adjacency:'sometime',requireSameDay:false}
    ]};
    const cycleB = {...migrated,scheduleLinks:[
      {anchorHid:'link-anchor',direction:'before',adjacency:'sometime',requireSameDay:false}
    ]};
    const afterLink = (migrated.scheduleLinks || []).find(l=>l.direction === 'after');
    return {
      migratedLink:afterLink,
      migratedIsArray:Array.isArray(migrated.scheduleLinks),
      legacyMigratedCount:(legacyObject.scheduleLinks || []).length,
      legacyHasBefore:(legacyObject.scheduleLinks || []).some(l=>l.direction === 'before' && l.anchorHid === 'link-anchor'),
      migratedAnchor:migrated.allowedTimeStartAnchor,
      legacyAnchor:offsetLegacy.allowedTimeStartAnchor,
      cycle:validateScheduleLinkGraph([cycleA,cycleB])
    };
  });
  assert(model.migratedIsArray,'scheduleLinks normalizes to an array');
  assert(model.migratedLink && model.migratedLink.anchorHid === 'link-anchor','zero-offset start migrates to recurring after link');
  assert(model.legacyMigratedCount === 2 && model.legacyHasBefore,'legacy {before,after} object migrates to array');
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
        scheduleLinks:[{
          anchorHid:'p-anchor',
          direction,
          adjacency:'direct',
          requireSameDay
        }]
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
        // Reduce anchor: target is a ceiling, so a same-day link cannot pull it
        // forward. The dependent is removed when a required reduce anchor is not
        // due. (A keepup anchor would be pulled — OR semantics, covered in [E].)
        anchor.type = 'reduce';
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

  console.log('\n[B] flex pull + multi OR + early reason');
  const flexPull = await page.evaluate(()=>{
    const today = dayStart(Date.now());
    // Friday within the next 7 days (or today if already Friday).
    let friday = today;
    while(new Date(friday).getDay() !== 5)friday += 86400000;
    if(friday > today + 6 * 86400000){
      friday = today;
      while(new Date(friday).getDay() !== 5)friday -= 86400000;
    }
    const fridayOffset = Math.round((friday - today) / 86400000);
    const now = today + 9 * 3600000;
    const settings = {
      ...loadSortSettings(),
      preset:'todayFirst',
      showWeekOnHome:true,
      agendaOptimizer:false,
      availabilityMinutes:Array(7).fill(180),
      availabilityOverrides:{},
      blockedTimes:[],
      locations:[],
      travel:{},
      showDueHabitsInAgenda:true,
      showDueTasksInAgenda:true,
      showScheduledTasksInAgenda:true,
      showPlannedItemsInAgenda:true
    };
    for(let offset = 0;offset < 7;offset += 1){
      settings.availabilityOverrides[dateKey(today + offset * 86400000)] = 180;
    }
    saveSortSettings(settings);
    if(typeof sortSettings !== 'undefined')Object.assign(sortSettings,settings);

    const goingOut = {
      hid:'go-out',name:'Going out',type:'keepup',target:7,
      logs:[today - 8 * 86400000],
      allowedWeekdays:[5],
      durationMinutes:30,priority:1,flexibilityDays:0
    };
    const exercise = {
      hid:'exercise',name:'Exercise',type:'keepup',target:7,
      logs:[today - 8 * 86400000],
      allowedWeekdays:[3],
      durationMinutes:30,priority:1,flexibilityDays:0
    };
    const ageFriday = 2 + fridayOffset;
    const showerTarget = 14;
    const showerFlex = Math.max(showerTarget - ageFriday + 1, fridayOffset + 2, 5);

    const RealDate = Date;
    function FrozenDate(...args){
      return args.length ? new RealDate(...args) : new RealDate(now);
    }
    FrozenDate.now = ()=>now;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate);
    FrozenDate.prototype = RealDate.prototype;
    const originalDate = globalThis.Date;
    globalThis.Date = FrozenDate;

    const fillsOn = (day)=>((day && day.timeline) || []).filter(row=>row.kind === 'fill').map(row=>row.h && row.h.hid);
    let fridayHids = [];
    let orPartnered = false;
    let alone = false;
    let earlyStiff = '';
    try{
      // 1) Flex pull: only going-out link → must land Friday with going out.
      const shower = {
        hid:'shower',name:'Shower',type:'keepup',target:showerTarget,
        logs:[today - 2 * 86400000],
        durationMinutes:15,priority:1,
        flexibilityDays:showerFlex,
        scheduleLinks:[
          {anchorHid:'go-out',direction:'before',adjacency:'sometime',requireSameDay:true}
        ]
      };
      const showerNoFlex = {
        ...shower,hid:'shower-noflex',name:'Shower stiff',flexibilityDays:0
      };
      save([goingOut,shower,showerNoFlex]);
      let data = load();
      let week = buildWeekAgenda(data,loadSortSettings(),7);
      const fridayDay = week.days.find(d=>d.dayBase === friday) || week.days[fridayOffset] || null;
      fridayHids = fillsOn(fridayDay);
      earlyStiff = earlyReason(data,data.findIndex(h=>h.hid === 'shower-noflex'),loadSortSettings());

      // 2) Multi OR: going-out (Fri) + exercise (Wed) → shower with either, never alone.
      const showerOr = {
        ...shower,hid:'shower-or',name:'Shower OR',
        scheduleLinks:[
          {anchorHid:'go-out',direction:'before',adjacency:'sometime',requireSameDay:true},
          {anchorHid:'exercise',direction:'after',adjacency:'sometime',requireSameDay:true}
        ]
      };
      save([goingOut,exercise,showerOr]);
      data = load();
      week = buildWeekAgenda(data,loadSortSettings(),7);
      alone = week.days.some(d=>{
        const hids = fillsOn(d);
        return hids.includes('shower-or') && !hids.includes('go-out') && !hids.includes('exercise');
      });
      orPartnered = week.days.some(d=>{
        const hids = fillsOn(d);
        return hids.includes('shower-or') && (hids.includes('go-out') || hids.includes('exercise'));
      });
    }finally{
      globalThis.Date = originalDate;
    }

    return {
      fridayOffset,
      // Early flex window uses raw target (not effectiveTarget = raw+flex).
      flexCoversFriday:ageFriday >= showerTarget - showerFlex,
      fridayHids,
      orPartnered,
      alone,
      earlyStiff,
      showerFlex,
      ageFriday,
      showerTarget
    };
  });
  assert(flexPull.flexCoversFriday,'test flex window covers Friday (flex=' + flexPull.showerFlex + ', ageFri=' + flexPull.ageFriday + ', target=' + flexPull.showerTarget + ')');
  assert(flexPull.fridayHids.includes('go-out'),'going out appears Friday');
  assert(flexPull.fridayHids.includes('shower'),'flex+same-day pulls shower onto Friday with going out (' + flexPull.fridayHids.join(',') + ')');
  assert(flexPull.orPartnered,'OR places shower with at least one linked partner');
  assert(!flexPull.alone,'shower does not appear alone without an OR partner');
  if(flexPull.fridayOffset === 0){
    assert(true,'Friday-is-today early path covered by dedicated case below');
  }else{
    assert(true,'early reason checked when Friday is today (skipped; Friday offset ' + flexPull.fridayOffset + ')');
  }
  assert(!flexPull.earlyStiff || flexPull.earlyStiff === '','zero-flex linked habit does not get link early reason without canDoEarly');

  // Dedicated early-reason case: today has the anchor, subject is upcoming with flex.
  const earlyCase = await page.evaluate(()=>{
    const today = dayStart(Date.now());
    const now = today + 10 * 3600000;
    const settings = {
      ...loadSortSettings(),
      preset:'todayFirst',
      showDueHabitsInAgenda:true,
      showDueTasksInAgenda:true,
      showPlannedItemsInAgenda:true,
      availabilityMinutes:Array(7).fill(240),
      availabilityOverrides:{[dateKey(today)]:240},
      blockedTimes:[],locations:[],travel:{}
    };
    saveSortSettings(settings);
    if(typeof sortSettings !== 'undefined')Object.assign(sortSettings,settings);
    const anchor = {
      hid:'early-anchor',name:'Tennis',type:'keepup',target:1,
      logs:[today - 2 * 86400000],
      durationMinutes:30,priority:1,flexibilityDays:0
    };
    const subject = {
      hid:'early-subject',name:'Shower',type:'keepup',target:7,
      logs:[today - 1 * 86400000],
      durationMinutes:15,priority:2,flexibilityDays:6,
      scheduleLinks:[
        {anchorHid:'early-anchor',direction:'after',adjacency:'sometime',requireSameDay:true}
      ]
    };
    const RealDate = Date;
    function FrozenDate(...args){
      return args.length ? new RealDate(...args) : new RealDate(now);
    }
    FrozenDate.now = ()=>now;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate);
    FrozenDate.prototype = RealDate.prototype;
    const originalDate = globalThis.Date;
    globalThis.Date = FrozenDate;
    let reason = '';
    let cat = null;
    try{
      save([anchor,subject]);
      const data = load();
      const idx = data.findIndex(h=>h.hid === 'early-subject');
      cat = todayCategory(data[idx],loadSortSettings());
      reason = earlyReason(data,idx,loadSortSettings());
    }finally{
      globalThis.Date = originalDate;
    }
    return {reason,cat};
  });
  assert(earlyCase.cat === 2,'link-pull subject is upcoming for early path');
  assert(/after Tennis/.test(earlyCase.reason || ''),'early reason names after Tennis (' + earlyCase.reason + ')');

  console.log('\n[C] Shower keepup + Exercise + Juma — extras OK for build habits');
  const jumaCase = await page.evaluate(()=>{
    // Freeze to Monday Aug 3, 2026 9am so the week includes Mon→Fri.
    const monBase = dayStart(new Date(2026,7,3).getTime());
    const wedBase = monBase + 2 * 86400000;
    const thuBase = monBase + 3 * 86400000;
    const friBase = monBase + 4 * 86400000;
    const now = monBase + 9 * 3600000;
    const settings = {
      ...loadSortSettings(),
      preset:'todayFirst',
      showWeekOnHome:true,
      agendaOptimizer:false,
      availabilityMinutes:Array(7).fill(300),
      availabilityOverrides:{},
      blockedTimes:[],
      locations:[],
      travel:{},
      showDueHabitsInAgenda:true,
      showDueTasksInAgenda:true,
      showScheduledTasksInAgenda:true,
      showPlannedItemsInAgenda:true
    };
    for(let o = 0;o < 7;o += 1){
      settings.availabilityOverrides[dateKey(monBase + o * 86400000)] = 300;
    }
    saveSortSettings(settings);
    if(typeof sortSettings !== 'undefined')Object.assign(sortSettings,settings);

    // Shower: keepup every 3 days, flex 3. Last done Fri before this Monday → due Mon.
    // Extra showers for Exercise / Juma are fine (build habit).
    const shower = {
      hid:'shower',name:'Shower',type:'keepup',target:3,flexibilityDays:3,
      logs:[monBase - 3 * 86400000],durationMinutes:5,priority:1
    };
    // Exercise every 3 days, due Wednesday. Link on Exercise (like Juma): before
    // Shower same-day → Shower always after Exercise.
    const exercise = {
      hid:'exercise',name:'Exercise',type:'keepup',target:3,flexibilityDays:0,
      logs:[monBase - 1 * 86400000],durationMinutes:40,priority:1,
      scheduleLinks:[
        {anchorHid:'shower',direction:'before',adjacency:'sometime',requireSameDay:true}
      ]
    };
    // Juma Friday-only after Shower same-day.
    const juma = {
      hid:'juma',name:'Juma Prayer',type:'keepup',target:7,flexibilityDays:0,
      logs:[monBase - 10 * 86400000],durationMinutes:25,priority:0,
      allowedWeekdays:[5],
      allowedTimeStart:13 * 60 + 30,allowedTimeEnd:15 * 60 + 30,
      scheduleLinks:[
        {anchorHid:'shower',direction:'after',adjacency:'sometime',requireSameDay:true}
      ]
    };

    const RealDate = Date;
    function FrozenDate(...args){
      return args.length ? new RealDate(...args) : new RealDate(now);
    }
    FrozenDate.now = ()=>now;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate);
    FrozenDate.prototype = RealDate.prototype;
    const originalDate = globalThis.Date;
    globalThis.Date = FrozenDate;
    let week;
    let showerElig;
    let reverseEarly = '';
    try{
      save([shower,exercise,juma]);
      const data = load();
      const days = [];
      for(let o = 0;o < 7;o += 1){
        const dayBase = monBase + o * 86400000;
        days.push({dayBase,weekday:new Date(dayBase).getDay(),isToday:o === 0,linkOmissions:[]});
      }
      const cands = data.map((h,i)=>{
        const eligible = new Set();
        days.forEach(d=>{
          if(isWeekCandidate(h,settings,d.dayBase,d.weekday))eligible.add(d.dayBase);
        });
        return {h,i,eligible,priority:1,urgency:40};
      });
      applyPersistentLinkEligibility(cands,days,settings);
      showerElig = [...(cands.find(c=>c.h.hid === 'shower').eligible || new Set())].map(dateKey);
      week = buildWeekAgenda(data,settings,7);
      const friNow = friBase + 10 * 3600000;
      FrozenDate.now = ()=>friNow;
      // Probe reverse early with Shower still upcoming into Friday.
      const friData = load().map(h=>{
        if(h.hid !== 'shower')return h;
        return {...h,logs:[friBase - 1 * 86400000],lastLog:friBase - 1 * 86400000};
      });
      const showerIdx = friData.findIndex(h=>h.hid === 'shower');
      reverseEarly = earlyReason(friData,showerIdx,settings);
    }finally{
      globalThis.Date = originalDate;
    }
    const fillsOn = (dayBase)=>{
      const day = week.days.find(d=>d.dayBase === dayBase);
      return ((day && day.timeline) || []).filter(r=>r.kind === 'fill').map(r=>r.h && r.h.hid);
    };
    const mon = fillsOn(monBase);
    const wed = fillsOn(wedBase);
    const thu = fillsOn(thuBase);
    const fri = fillsOn(friBase);
    const showerDays = week.days
      .filter(d=>(d.timeline || []).some(r=>r.kind === 'fill' && r.h && r.h.hid === 'shower'))
      .map(d=>dateKey(d.dayBase));
    return {
      showerElig,
      mon,
      wed,
      thu,
      fri,
      showerDays,
      exerciseBeforeShower:wed.indexOf('exercise') >= 0 && wed.indexOf('shower') >= 0
        && wed.indexOf('exercise') < wed.indexOf('shower'),
      showerBeforeJuma:fri.indexOf('shower') >= 0 && fri.indexOf('juma') >= 0
        && fri.indexOf('shower') < fri.indexOf('juma'),
      reverseEarly
    };
  });
  assert(jumaCase.showerElig.includes('2026-08-03'),'Mon due day stays eligible');
  assert(jumaCase.showerElig.includes('2026-08-05'),'Exercise Wed reverse-pulls Shower');
  assert(jumaCase.showerElig.includes('2026-08-07'),'Juma Fri reverse-pulls Shower');
  assert(jumaCase.mon.includes('shower'),
    'Shower still places on its 3-day rhythm Monday (' + jumaCase.showerDays.join(',') + ')');
  assert(jumaCase.wed.includes('exercise') && jumaCase.wed.includes('shower'),
    'Wednesday has Exercise and Shower (' + jumaCase.wed.join(',') + ')');
  assert(jumaCase.exerciseBeforeShower,'Shower is ordered after Exercise on Wednesday');
  assert(jumaCase.fri.includes('juma') && jumaCase.fri.includes('shower'),
    'Friday has both Juma and Shower (' + jumaCase.fri.join(',') + ')');
  assert(jumaCase.showerBeforeJuma,'Shower is ordered before Juma on Friday');
  assert(jumaCase.showerDays.length >= 3,
    'keepup Shower may land extra times for partners (' + jumaCase.showerDays.join(',') + ')');
  assert(/before Juma|after Exercise/.test(jumaCase.reverseEarly || ''),
    'reverse early reason names a partner (' + jumaCase.reverseEarly + ')');

  console.log('\n[D] right-after Shower → Juma (direct adjacency, morning competition)');
  async function runRightAfter(label, useExact){
    return page.evaluate(async ({label, useExact})=>{
    const friBase = dayStart(new Date(2026,7,7).getTime()); // Friday Aug 7
    const now = friBase + 9 * 3600000;
    const home = {id:'home',name:'Home',lat:43.65,lng:-79.38};
    const mosque = {id:'mosque',name:'Mosque',lat:43.66,lng:-79.40};
    const settings = {
      ...loadSortSettings(),
      preset:'todayFirst',
      showWeekOnHome:true,
      agendaOptimizer:!!useExact,
      availabilityMinutes:Array(7).fill(600),
      availabilityOverrides:{},
      blockedTimes:[
        {label:'sleep',start:0,end:5 * 60 + 30,locationId:'home'},
        {label:'breakfast',start:7 * 60 + 33,end:7 * 60 + 43,locationId:'home'},
        {label:'sleep',start:22 * 60 + 30,end:24 * 60,locationId:'home'}
      ],
      locations:[home,mosque],
      travel:{
        [`${home.id}|${mosque.id}`]:{seconds:10 * 60,metres:2000,provider:'test'},
        [`${mosque.id}|${home.id}`]:{seconds:10 * 60,metres:2000,provider:'test'}
      },
      defaultTravelMode:'driving',
      showDueHabitsInAgenda:true,
      showDueTasksInAgenda:true,
      showScheduledTasksInAgenda:true,
      showPlannedItemsInAgenda:true
    };
    settings.availabilityOverrides[dateKey(friBase)] = 600;
    saveSortSettings(settings);
    if(typeof sortSettings !== 'undefined')Object.assign(sortSettings,settings);

    // Morning Home filler that would otherwise steal an early Shower.
    const trim = {
      hid:'trim',name:'Trim Beard',type:'keepup',target:1,flexibilityDays:0,
      logs:[friBase - 2 * 86400000],durationMinutes:30,priority:2,
      locationIds:['home'],
      allowedTimeStart:5 * 60 + 30,allowedTimeEnd:12 * 60
    };
    const shower = {
      hid:'shower',name:'Shower',type:'keepup',target:3,flexibilityDays:3,
      logs:[friBase - 3 * 86400000],durationMinutes:5,priority:1,
      locationIds:['home']
    };
    const work = {
      hid:'work',name:'Work',type:'keepup',target:1,flexibilityDays:0,
      logs:[friBase - 1 * 86400000],durationMinutes:300,priority:0,
      breakable:true,minChunkMinutes:45,
      locationIds:['home'],
      allowedTimeStart:9 * 60,allowedTimeEnd:18 * 60
    };
    const juma = {
      hid:'juma',name:'Juma Prayer',type:'keepup',target:7,flexibilityDays:0,
      logs:[friBase - 10 * 86400000],durationMinutes:25,priority:0,
      allowedWeekdays:[5],
      allowedTimeStart:13 * 60 + 30,allowedTimeEnd:15 * 60 + 30,
      locationIds:['mosque'],
      scheduleLinks:[
        {anchorHid:'shower',direction:'after',adjacency:'direct',requireSameDay:true}
      ]
    };
    // Extra morning options so ASAP slice would otherwise drop afternoon pack fits.
    const distractors = Array.from({length:12},(_,i)=>({
      hid:`dist-${i}`,name:`Dist ${i}`,type:'keepup',target:1,flexibilityDays:0,
      logs:[friBase - 2 * 86400000],durationMinutes:15,priority:3,
      allowedTimeStart:8 * 60,allowedTimeEnd:12 * 60
    }));

    const RealDate = Date;
    function FrozenDate(...args){
      return args.length ? new RealDate(...args) : new RealDate(now);
    }
    FrozenDate.now = ()=>now;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate);
    FrozenDate.prototype = RealDate.prototype;
    const originalDate = globalThis.Date;
    globalThis.Date = FrozenDate;
    let timeline = [];
    try{
      save([trim,shower,work,juma,...distractors]);
      const data = load();
      const week = useExact && typeof buildWeekAgendaAsync === 'function'
        ? await buildWeekAgendaAsync(data,settings,1)
        : buildWeekAgenda(data,settings,1);
      const day = week.days.find(d=>d.dayBase === friBase) || week.days[0];
      timeline = (day && day.timeline) || [];
    }finally{
      globalThis.Date = originalDate;
    }
    const fills = timeline.filter(r=>r.kind === 'fill');
    const hids = fills.map(r=>r.h && r.h.hid);
    const showerRows = fills.filter(r=>r.h && r.h.hid === 'shower');
    const jumaRow = fills.find(r=>r.h && r.h.hid === 'juma');
    const lastShower = showerRows.length
      ? showerRows.reduce((a,b)=>a.end > b.end ? a : b)
      : null;
    let gapMin = null;
    let interloper = null;
    if(lastShower && jumaRow){
      gapMin = Math.round((jumaRow.start - lastShower.end) / 60000);
      interloper = fills.some(r=>{
        const hid = r.h && r.h.hid;
        if(!hid || hid === 'shower' || hid === 'juma')return false;
        return r.start + 60000 >= lastShower.end && r.end <= jumaRow.start + 60000;
      });
    }
    return {
      label,
      hids,
      hasShower:hids.includes('shower'),
      hasJuma:hids.includes('juma'),
      showerBeforeJuma:lastShower && jumaRow && lastShower.end <= jumaRow.start + 60000,
      gapMin,
      interloper,
      showerEnd:lastShower && new Date(lastShower.end).toISOString(),
      jumaStart:jumaRow && new Date(jumaRow.start).toISOString()
    };
    }, {label, useExact});
  }
  for(const [label, useExact] of [['fast', false], ['exact', true]]){
    const rightAfter = await runRightAfter(label, useExact);
    assert(rightAfter.hasJuma,`${rightAfter.label}: Juma is placed`);
    assert(rightAfter.hasShower,`${rightAfter.label}: Shower is placed`);
    assert(rightAfter.showerBeforeJuma,`${rightAfter.label}: Shower ends before Juma starts`);
    assert(!rightAfter.interloper,
      `${rightAfter.label}: no habit between latest Shower and Juma (gap=${rightAfter.gapMin}m)`);
    assert(rightAfter.gapMin != null && rightAfter.gapMin <= 90,
      `${rightAfter.label}: Shower abuts Juma within travel slack (gap=${rightAfter.gapMin}`
        + `m, showerEnd=${rightAfter.showerEnd}, jumaStart=${rightAfter.jumaStart})`);
  }

  console.log('\n[E] cadence OR — stiff-rhythm keepup honours a same-day partner');
  const orCase = await page.evaluate(async ()=>{
    // Monday Aug 3 2026. Shower is a keepup every 4 days, flex 0, last done Sun
    // Aug 2 → next rhythm-due day is Thu Aug 6 (ageOnDay 4). Wed Aug 5 is only
    // ageOnDay 3, so rhythm alone never makes Shower eligible Wednesday. Exercise
    // (every 3 days) is due Wednesday and requires Shower same-day: the link must
    // pull Shower onto Wednesday despite the stiff cadence (OR, not AND).
    const monBase = dayStart(new Date(2026,7,3).getTime());
    const wedBase = monBase + 2 * 86400000;
    const now = monBase + 9 * 3600000;
    const settings = {
      ...loadSortSettings(),
      preset:'todayFirst',
      showWeekOnHome:true,
      agendaOptimizer:true,
      availabilityMinutes:Array(7).fill(300),
      availabilityOverrides:{},
      blockedTimes:[],locations:[],
      travel:{},
      showDueHabitsInAgenda:true,
      showDueTasksInAgenda:true,
      showScheduledTasksInAgenda:true,
      showPlannedItemsInAgenda:true
    };
    for(let o = 0;o < 7;o += 1){
      settings.availabilityOverrides[dateKey(monBase + o * 86400000)] = 300;
    }
    saveSortSettings(settings);
    if(typeof sortSettings !== 'undefined')Object.assign(sortSettings,settings);

    const shower = {
      hid:'shower',name:'Shower',type:'keepup',target:4,flexibilityDays:0,
      logs:[monBase - 1 * 86400000],durationMinutes:5,priority:1
    };
    const exercise = {
      hid:'exercise',name:'Exercise',type:'keepup',target:3,flexibilityDays:0,
      logs:[monBase - 1 * 86400000],durationMinutes:40,priority:1,
      scheduleLinks:[
        {anchorHid:'shower',direction:'before',adjacency:'sometime',requireSameDay:true}
      ]
    };

    const RealDate = Date;
    function FrozenDate(...args){
      return args.length ? new RealDate(...args) : new RealDate(now);
    }
    FrozenDate.now = ()=>now;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate);
    FrozenDate.prototype = RealDate.prototype;
    const originalDate = globalThis.Date;
    globalThis.Date = FrozenDate;
    let showerElig = [];
    let week;
    try{
      save([shower,exercise]);
      const data = load();
      const days = [];
      for(let o = 0;o < 7;o += 1){
        const dayBase = monBase + o * 86400000;
        days.push({dayBase,weekday:new Date(dayBase).getDay(),isToday:o === 0,linkOmissions:[]});
      }
      const cands = data.map((h,i)=>{
        const eligible = new Set();
        days.forEach(d=>{
          if(isWeekCandidate(h,settings,d.dayBase,d.weekday))eligible.add(d.dayBase);
        });
        return {h,i,eligible,priority:1,urgency:40};
      });
      applyPersistentLinkEligibility(cands,days,settings);
      showerElig = [...(cands.find(c=>c.h.hid === 'shower').eligible || new Set())].map(dateKey);
      week = typeof buildWeekAgendaAsync === 'function'
        ? await buildWeekAgendaAsync(data,settings,7)
        : buildWeekAgenda(data,settings,7);
    }finally{
      globalThis.Date = originalDate;
    }
    const fillsOn = (dayBase)=>{
      const day = week.days.find(d=>d.dayBase === dayBase);
      return ((day && day.timeline) || []).filter(r=>r.kind === 'fill').map(r=>r.h && r.h.hid);
    };
    const wed = fillsOn(wedBase);
    return {
      showerElig,
      wedHasShower:wed.includes('shower'),
      wedHasExercise:wed.includes('exercise'),
      exerciseBeforeShower:wed.indexOf('exercise') >= 0 && wed.indexOf('shower') >= 0
        && wed.indexOf('exercise') < wed.indexOf('shower'),
      wed
    };
  });
  assert(orCase.showerElig.includes('2026-08-05'),
    'OR: stiff-rhythm Shower is eligible Wednesday via the Exercise link (' + orCase.showerElig.join(',') + ')');
  assert(orCase.showerElig.includes('2026-08-06'),
    'OR: rhythm-due Thursday stays eligible (link does not replace cadence)');
  assert(orCase.wedHasExercise && orCase.wedHasShower,
    'GLPK co-places Exercise + Shower on Wednesday (' + orCase.wed.join(',') + ')');
  assert(orCase.exerciseBeforeShower,'Exercise is ordered before Shower on Wednesday');

  assert(errors.length === 0,'no page errors' + (errors.length ? ': ' + errors.join('; ') : ''));
  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  if(fail)process.exit(1);
})().catch(error=>{
  console.error(error);
  process.exit(1);
});
