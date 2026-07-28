// Temporary per-day agenda order constraints + doing-now.
// Covers data/UI paths and placement for BOTH planners:
//   - fast: sync buildWeekAgenda (agendaOptimizer:false)
//   - GLPK: async buildWeekAgendaAsync (agendaOptimizer:true), soft-skip if GLPK missing
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/agenda-order-constraints-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

function seedScript(){
  return `(function(){
    if(sessionStorage.getItem('tings_order_test_seeded') === '1')return;
    sessionStorage.setItem('tings_order_test_seeded','1');
    localStorage.removeItem('tings_v2');
    localStorage.removeItem('tings_app_settings_v2');
    localStorage.removeItem('tings_order_constraints_v1');
    localStorage.removeItem('tings_auto_chunk_plans_v1');
    const settings = {
      preset:'todayFirst', topics:[], locations:[], travel:{}, defaultTravelMode:'walking',
      availabilityMinutes:[600,600,600,600,600,600,600], blockedTimes:[],
      showWeekOnHome:true, agendaOptimizer:false,
      showDueHabitsInAgenda:true, showPlannedItemsInAgenda:true,
      showDueTasksInAgenda:true, showScheduledTasksInAgenda:true,
    };
    localStorage.setItem('tings_v2', JSON.stringify([
      { name:'baseline', type:'keepup', target:7, logs:[Date.now()-2*86400000], durationMinutes:10, priority:2, hid:'baseline' }
    ]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
  })();`;
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  // ════════════════════════════════════════════════════════════════════════
  // A. Data layer
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[A] data layer — day scope, upsert, prune, clear, drop helpers');
  await page.addInitScript(seedScript());
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(250);

  const dataLayer = await page.evaluate(() => {
    const today = dayStart(Date.now());
    const tomorrow = today + 86400000;
    const yesterday = today - 86400000;
    localStorage.removeItem('tings_order_constraints_v1');

    const e1 = upsertOrderConstraint({dayBase:today, beforeHid:'a', afterHid:'b', adjacency:'sometime'});
    const e2 = upsertOrderConstraint({dayBase:tomorrow, beforeHid:'a', afterHid:'b', adjacency:'direct'});
    const e3 = normalizeOrderConstraint({dayBase:yesterday, beforeHid:'x', afterHid:'y', adjacency:'sometime'});
    const store = loadOrderConstraintStore();
    Storage.write('tings_order_constraints_v1',{
      edges:[...store.edges, {...e3, dayBase:yesterday}],
      doingNow:null
    });
    const pruned = loadOrderConstraintStore();
    const todayEdges = orderConstraintsForDay(today);
    const tomorrowEdges = orderConstraintsForDay(tomorrow);

    upsertOrderConstraint({dayBase:today, beforeHid:'a', afterHid:'b', adjacency:'direct'});
    const afterReplace = orderConstraintsForDay(today);

    // Drop helper replaces touched pairs
    saveOrderConstraintsForDrop(today,[
      {beforeHid:'a', afterHid:'c', adjacency:'sometime'},
      {beforeHid:'c', afterHid:'b', adjacency:'direct'}
    ]);
    const afterDrop = orderConstraintsForDay(today);

    // Clear for one hid
    clearOrderConstraintsForDay(today,'c');
    const afterClearHid = orderConstraintsForDay(today);

    // Doing now only valid for today
    const dn = setDoingNow('task1', Date.now(), today);
    const dnBad = setDoingNow('task2', Date.now(), tomorrow);
    const dnGot = getDoingNow();
    clearDoingNow('task1');
    const dnCleared = getDoingNow();

    // Re-set and prune on complete
    setDoingNow('a', Date.now(), today);
    upsertOrderConstraint({dayBase:today, beforeHid:'a', afterHid:'b', adjacency:'sometime'});
    upsertOrderConstraint({dayBase:tomorrow, beforeHid:'a', afterHid:'z', adjacency:'sometime'});
    const task = {
      hid:'a', name:'A', type:'task', logs:[Date.now()], lastLog:Date.now(),
      durationMinutes:30, breakable:false, autoMarkMinutes:null, priority:2
    };
    pruneOrderConstraintsOnLog(task);

    // Delete habit prunes all edges
    upsertOrderConstraint({dayBase:today, beforeHid:'gone', afterHid:'b', adjacency:'sometime'});
    pruneOrderConstraintsForHabit({hid:'gone', type:'task', logs:[], lastLog:null}, [], Date.now());

    return {
      e1ok:Boolean(e1 && e1.dayBase === today),
      todayCount:todayEdges.length,
      tomorrowCount:tomorrowEdges.length,
      tomorrowDirect:tomorrowEdges[0] && tomorrowEdges[0].adjacency === 'direct',
      pastPruned:pruned.edges.every(e=>e.dayBase >= today),
      replacedDirect:afterReplace.length === 1 && afterReplace[0].adjacency === 'direct',
      dropCount:afterDrop.length,
      dropHasAC:afterDrop.some(e=>e.beforeHid==='a' && e.afterHid==='c'),
      dropHasCB:afterDrop.some(e=>e.beforeHid==='c' && e.afterHid==='b' && e.adjacency==='direct'),
      dropClearedAB:!afterDrop.some(e=>e.beforeHid==='a' && e.afterHid==='b'),
      afterClearHid:afterClearHid.length,
      dnOk:Boolean(dn && dn.hid === 'task1'),
      dnBadIgnored:dnBad == null && dnGot && dnGot.hid === 'task1',
      dnCleared:dnCleared == null,
      todayAfterPrune:orderConstraintsForDay(today).length,
      tomorrowAfterPrune:orderConstraintsForDay(tomorrow).length,
      doingAfterPrune:getDoingNow(),
      gonePruned:!orderConstraintsForDay(today).some(e=>e.beforeHid==='gone' || e.afterHid==='gone'),
      pills:orderConstraintPillsForHid('b', tomorrow, [{hid:'a',name:'Alpha'},{hid:'b',name:'Beta'},{hid:'z',name:'Zed'}]),
      badSelf:normalizeOrderConstraint({dayBase:today, beforeHid:'x', afterHid:'x', adjacency:'sometime'}),
      badMissing:normalizeOrderConstraint({dayBase:null, beforeHid:'a', afterHid:'b'})
    };
  });

  assert(dataLayer.e1ok, 'upsert returns today-scoped edge');
  assert(dataLayer.todayCount === 1, 'today has one edge');
  assert(dataLayer.tomorrowCount === 1 && dataLayer.tomorrowDirect, 'tomorrow has direct edge');
  assert(dataLayer.pastPruned, 'past-day edges pruned on load');
  assert(dataLayer.replacedDirect, 'upsert replaces adjacency for same pair');
  assert(dataLayer.dropCount === 2 && dataLayer.dropHasAC && dataLayer.dropHasCB, 'drop helper writes both neighbor edges');
  assert(dataLayer.dropClearedAB, 'drop helper replaces prior pair among touched hids');
  assert(dataLayer.afterClearHid === 0, 'clearOrderConstraintsForDay(hid) removes that hid’s edges');
  assert(dataLayer.dnOk, 'doing now set for today');
  assert(dataLayer.dnBadIgnored, 'doing now rejected for non-today without clearing existing');
  assert(dataLayer.dnCleared, 'clearDoingNow removes active doing-now');
  assert(dataLayer.todayAfterPrune === 0, 'completing habit clears today edges involving it');
  assert(dataLayer.tomorrowAfterPrune === 0, 'completed task clears future-day edges too (one-shot)');
  assert(dataLayer.doingAfterPrune == null, 'completing doing-now habit clears doing-now');
  assert(dataLayer.gonePruned, 'deleted habit prunes its edges');
  // pills for 'b' on tomorrow — tomorrow a→z was cleared with task completion; re-seed for label check
  const pillCheck = await page.evaluate(() => {
    localStorage.removeItem('tings_order_constraints_v1');
    const tomorrow = dayStart(Date.now()) + 86400000;
    upsertOrderConstraint({dayBase:tomorrow, beforeHid:'a', afterHid:'b', adjacency:'sometime'});
    return orderConstraintPillsForHid('b', tomorrow, [{hid:'a',name:'Alpha'},{hid:'b',name:'Beta'}]);
  });
  assert(Array.isArray(pillCheck) && pillCheck.some(p=>/after Alpha/.test(p.label)), 'pill labels use neighbor names');
  assert(dataLayer.badSelf == null && dataLayer.badMissing == null, 'invalid constraints normalize to null');

  const rhythmPrune = await page.evaluate(() => {
    localStorage.removeItem('tings_order_constraints_v1');
    const today = dayStart(Date.now());
    const tomorrow = today + 86400000;
    upsertOrderConstraint({dayBase:today, beforeHid:'rk', afterHid:'other', adjacency:'sometime'});
    upsertOrderConstraint({dayBase:tomorrow, beforeHid:'rk', afterHid:'other', adjacency:'sometime'});
    const h = {
      hid:'rk', name:'Rhythm', type:'keepup', target:1, logs:[Date.now()], lastLog:Date.now(),
      durationMinutes:20, breakable:false, autoMarkMinutes:null, priority:2
    };
    pruneOrderConstraintsOnLog(h);
    return {
      today:orderConstraintsForDay(today).length,
      tomorrow:orderConstraintsForDay(tomorrow).length
    };
  });
  assert(rhythmPrune.today === 0, 'rhythm log clears today order links');
  assert(rhythmPrune.tomorrow === 1, 'rhythm log keeps tomorrow order links');

  // ════════════════════════════════════════════════════════════════════════
  // B. Doing-now + auto-mark
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[B] doing-now retargets auto-mark / pending bar / clear');
  const autoMark = await page.evaluate(() => {
    localStorage.removeItem('tings_order_constraints_v1');
    const now = Date.now();
    const today = dayStart(now);
    const h = {
      name:'Auto task', type:'task', hid:'auto1', logs:[], lastLog:null,
      dueDate:today + 2*86400000, eventTime:null, flexibilityDays:0,
      durationMinutes:30, breakable:false, autoMarkMinutes:20, priority:1
    };
    const before = effectiveAutoMarkTrigger(h, now);
    setDoingNow('auto1', now - 5*60000, today);
    const after = effectiveAutoMarkTrigger(h, now);
    const win = pendingAutoMarkWindow(h, now);
    // Wrong hid clear is a no-op
    clearDoingNow('other');
    const still = getDoingNow();
    clearDoingNow('auto1');
    const cleared = effectiveAutoMarkTrigger(h, now);
    // Breakable tasks still use chunk path; doing-now should not invent trigger for keepup
    const keepup = {name:'k', type:'keepup', hid:'k1', autoMarkMinutes:10, breakable:false, logs:[], lastLog:null};
    setDoingNow('k1', now, today);
    const keepupTrig = effectiveAutoMarkTrigger(keepup, now);
    clearDoingNow();
    return {before, after, winStart:win && win.start, stillHid:still && still.hid, cleared, now:now - 5*60000, keepupTrig};
  });
  assert(autoMark.before == null || autoMark.before > autoMark.after, 'doing-now trigger earlier than due-window trigger (or due was later)');
  assert(autoMark.after === autoMark.now, 'effective trigger equals doing-now startedAt');
  assert(autoMark.winStart === autoMark.now, 'pending auto bar uses doing-now start');
  assert(autoMark.stillHid === 'auto1', 'clearDoingNow ignores other hids');
  assert(autoMark.cleared !== autoMark.now, 'clearing doing-now restores normal trigger');
  assert(autoMark.keepupTrig == null, 'doing-now does not invent non-task auto-mark triggers');

  // ════════════════════════════════════════════════════════════════════════
  // C–E. Placement for FAST and GLPK
  // ════════════════════════════════════════════════════════════════════════
  async function runPlacementSuite(label, useGlpk){
    console.log(`\n[${label}] placement — order + doing-now (${useGlpk ? 'GLPK' : 'fast'})`);

    if(useGlpk){
      const glpkOk = await page.evaluate(async () => {
        if(typeof ensureGlpk !== 'function')return {ok:false, reason:'ensureGlpk missing'};
        try{
          const GLPK = await ensureGlpk();
          return {ok:!!GLPK, reason:GLPK ? 'loaded' : 'null'};
        }catch(e){
          return {ok:false, reason:String(e && e.message || e)};
        }
      });
      if(!glpkOk.ok){
        console.log(`  skip: GLPK unavailable (${glpkOk.reason})`);
        return {skipped:true};
      }
      assert(true, 'GLPK loads');
    }

    const result = await page.evaluate(async ({useGlpk}) => {
      localStorage.removeItem('tings_order_constraints_v1');
      const today = dayStart(Date.now());
      const tomorrow = today + 86400000;
      const now = Date.now();

      const mk = (name,hid,priority,extra)=>({
        name, hid, type:'task', logs:[], lastLog:null, dueDate:today,
        eventTime:null, flexibilityDays:0, durationMinutes:30, breakable:false,
        autoMarkMinutes:null, priority, pinned:false, emoji:'', locationIds:[],
        anywhereAllowed:true, ...(extra || {})
      });

      const settingsBase = {
        ...loadSortSettings(),
        preset:'todayFirst',
        showWeekOnHome:true,
        agendaOptimizer:!!useGlpk,
        showDueTasksInAgenda:true,
        showDueHabitsInAgenda:true,
        showPlannedItemsInAgenda:true,
        showScheduledTasksInAgenda:true,
        availabilityMinutes:[600,600,600,600,600,600,600],
        blockedTimes:[],
        locations:[],
        travel:{},
        defaultTravelMode:'walking'
      };

      async function plan(data,settings,constraints,doing){
        localStorage.removeItem('tings_order_constraints_v1');
        if(constraints && constraints.length){
          for(const c of constraints)upsertOrderConstraint(c);
        }
        if(doing)setDoingNow(doing.hid, doing.startedAt, doing.dayBase);
        else clearDoingNow();
        save(data);
        saveSortSettings(settings);
        if(useGlpk && typeof buildWeekAgendaAsync === 'function'){
          const week = await buildWeekAgendaAsync(data, settings, 2);
          return week;
        }
        return buildWeekAgenda(data, settings, 2);
      }

      function todayFills(week){
        const day = (week.days || []).find(d=>d.dayBase === today) || week.days[0];
        const rows = (day && day.timeline || []).filter(r=>r.kind === 'fill' || r.kind === 'scheduled');
        return {
          day,
          rows,
          order: rows.map(r=>{
            const h = dataRef[r.i];
            return h && h.hid;
          }).filter(Boolean),
          starts: Object.fromEntries(rows.map(r=>{
            const h = dataRef[r.i];
            return h ? [h.hid, r.start] : null;
          }).filter(Boolean))
        };
      }

      let dataRef = [];

      // 1) sometime: C before A
      dataRef = [
        mk('A','ord-a',1),
        mk('B','ord-b',1),
        mk('C','ord-c',1)
      ];
      const weekSometime = await plan(dataRef, settingsBase, [
        {dayBase:today, beforeHid:'ord-c', afterHid:'ord-a', adjacency:'sometime'}
      ], null);
      const sometime = todayFills(weekSometime);

      // 2) direct: A then B should be adjacent-ish (B after A)
      dataRef = [
        mk('Alpha','dir-a',1),
        mk('Beta','dir-b',1)
      ];
      const weekDirect = await plan(dataRef, settingsBase, [
        {dayBase:today, beforeHid:'dir-a', afterHid:'dir-b', adjacency:'direct'}
      ], null);
      const direct = todayFills(weekDirect);

      // 3) between: A → X → B
      dataRef = [
        mk('Email','btw-a',1,{emoji:'✉️'}),
        mk('Deep','btw-x',1,{emoji:'🧠'}),
        mk('Walk','btw-b',1,{emoji:'🚶'})
      ];
      const weekBetween = await plan(dataRef, settingsBase, [
        {dayBase:today, beforeHid:'btw-a', afterHid:'btw-x', adjacency:'sometime'},
        {dayBase:today, beforeHid:'btw-x', afterHid:'btw-b', adjacency:'sometime'}
      ], null);
      const between = todayFills(weekBetween);

      // 4) day isolation: tomorrow constraint must not reorder today
      dataRef = [
        mk('TodayFirst','iso-a',1),
        mk('TodaySecond','iso-b',1,{dueDate:today}),
        mk('TomFirst','iso-t1',1,{dueDate:tomorrow}),
        mk('TomSecond','iso-t2',1,{dueDate:tomorrow})
      ];
      // Prefer iso-b before iso-a TODAY would reorder; instead only constrain tomorrow.
      const weekIso = await plan(dataRef, settingsBase, [
        {dayBase:tomorrow, beforeHid:'iso-t2', afterHid:'iso-t1', adjacency:'sometime'}
      ], null);
      const isoToday = todayFills(weekIso);
      const tomDay = (weekIso.days || []).find(d=>d.dayBase === tomorrow);
      const tomRows = (tomDay && tomDay.timeline || []).filter(r=>r.kind === 'fill' || r.kind === 'scheduled');
      const tomOrder = tomRows.map(r=>dataRef[r.i] && dataRef[r.i].hid).filter(Boolean);

      // 5) doing now: force hid to front / early start (equal priority peers)
      dataRef = [
        mk('Early','dn-a',2),
        mk('Later','dn-b',2),
        mk('NowMe','dn-now',2)
      ];
      const weekDoing = await plan(dataRef, settingsBase, null, {
        hid:'dn-now', startedAt:now, dayBase:today
      });
      const doing = todayFills(weekDoing);

      // 6) only-after / only-before (single edge)
      dataRef = [
        mk('Left','one-a',1),
        mk('Mid','one-x',1),
        mk('Right','one-b',1)
      ];
      const weekOnlyAfter = await plan(dataRef, settingsBase, [
        {dayBase:today, beforeHid:'one-a', afterHid:'one-x', adjacency:'sometime'}
      ], null);
      const onlyAfter = todayFills(weekOnlyAfter);

      return {
        optimized:Boolean(weekSometime && weekSometime.optimized),
        sometimeOrder:sometime.order,
        sometimeStarts:sometime.starts,
        directOrder:direct.order,
        directStarts:direct.starts,
        betweenOrder:between.order,
        betweenStarts:between.starts,
        isoTodayOrder:isoToday.order,
        tomOrder,
        doingOrder:doing.order,
        doingStarts:doing.starts,
        onlyAfterOrder:onlyAfter.order,
        onlyAfterStarts:onlyAfter.starts,
        now
      };
    }, {useGlpk});

    if(!result)return {skipped:true};

    if(useGlpk){
      assert(result.optimized === true, 'GLPK week marked optimized');
    }else{
      assert(result.optimized !== true, 'fast week is not marked optimized');
    }

    const sIdx = (arr,hid)=>arr.indexOf(hid);
    assert(
      sIdx(result.sometimeOrder,'ord-c') >= 0 && sIdx(result.sometimeOrder,'ord-a') >= 0
        && sIdx(result.sometimeOrder,'ord-c') < sIdx(result.sometimeOrder,'ord-a'),
      `${label}: sometime places C before A`
    );
    if(result.sometimeStarts['ord-c'] != null && result.sometimeStarts['ord-a'] != null){
      assert(result.sometimeStarts['ord-c'] <= result.sometimeStarts['ord-a'], `${label}: sometime C starts at/before A`);
    }

    assert(
      sIdx(result.directOrder,'dir-a') >= 0 && sIdx(result.directOrder,'dir-b') >= 0
        && sIdx(result.directOrder,'dir-a') < sIdx(result.directOrder,'dir-b'),
      `${label}: direct places A before B`
    );
    if(result.directStarts['dir-a'] != null && result.directStarts['dir-b'] != null){
      assert(result.directStarts['dir-b'] >= result.directStarts['dir-a'], `${label}: direct B starts after A starts`);
    }

    assert(
      sIdx(result.betweenOrder,'btw-a') >= 0
        && sIdx(result.betweenOrder,'btw-x') >= 0
        && sIdx(result.betweenOrder,'btw-b') >= 0
        && sIdx(result.betweenOrder,'btw-a') < sIdx(result.betweenOrder,'btw-x')
        && sIdx(result.betweenOrder,'btw-x') < sIdx(result.betweenOrder,'btw-b'),
      `${label}: between chain A → X → B`
    );
    if(result.betweenStarts['btw-a'] != null && result.betweenStarts['btw-x'] != null && result.betweenStarts['btw-b'] != null){
      assert(
        result.betweenStarts['btw-a'] <= result.betweenStarts['btw-x']
          && result.betweenStarts['btw-x'] <= result.betweenStarts['btw-b'],
        `${label}: between chain start times A ≤ X ≤ B`
      );
    }

    assert(
      sIdx(result.tomOrder,'iso-t2') >= 0 && sIdx(result.tomOrder,'iso-t1') >= 0
        ? sIdx(result.tomOrder,'iso-t2') < sIdx(result.tomOrder,'iso-t1')
        : true,
      `${label}: tomorrow-only constraint orders tomorrow fills`
    );

    assert(sIdx(result.doingOrder,'dn-now') === 0, `${label}: doing-now item is first`);
    if(result.doingStarts['dn-now'] != null){
      const peerStarts = Object.entries(result.doingStarts)
        .filter(([hid])=>hid !== 'dn-now')
        .map(([,ts])=>ts);
      if(peerStarts.length){
        assert(result.doingStarts['dn-now'] <= Math.min(...peerStarts), `${label}: doing-now starts at/before peers`);
      }
    }

    assert(
      sIdx(result.onlyAfterOrder,'one-a') < sIdx(result.onlyAfterOrder,'one-x'),
      `${label}: only-after edge places Left before Mid`
    );

    return {skipped:false};
  }

  await runPlacementSuite('C', false);
  await runPlacementSuite('D', true);

  // ════════════════════════════════════════════════════════════════════════
  // E. Heuristic packer mirrors order (timeout fallback path unit)
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[E] packDayWithHeuristic honors order + doing-now');
  const heur = await page.evaluate(() => {
    localStorage.removeItem('tings_order_constraints_v1');
    const today = dayStart(Date.now());
    const now = Date.now();
    const data = [
      {name:'H1', hid:'h1', type:'task', logs:[], lastLog:null, dueDate:today, eventTime:null,
        flexibilityDays:0, durationMinutes:20, breakable:false, autoMarkMinutes:null, priority:2, pinned:false},
      {name:'H2', hid:'h2', type:'task', logs:[], lastLog:null, dueDate:today, eventTime:null,
        flexibilityDays:0, durationMinutes:20, breakable:false, autoMarkMinutes:null, priority:0, pinned:false},
      {name:'H3', hid:'h3', type:'task', logs:[], lastLog:null, dueDate:today, eventTime:null,
        flexibilityDays:0, durationMinutes:20, breakable:false, autoMarkMinutes:null, priority:5, pinned:false}
    ];
    upsertOrderConstraint({dayBase:today, beforeHid:'h3', afterHid:'h2', adjacency:'sometime'});
    setDoingNow('h3', now, today);
    const settings = {
      ...loadSortSettings(),
      agendaOptimizer:false,
      availabilityMinutes:[600,600,600,600,600,600,600],
      blockedTimes:[],
      showDueTasksInAgenda:true
    };
    const day = buildDayAgenda(data, settings, today, {weekMode:true});
    // Manually seed candidates like week mode would
    day.agendaItems = data.map((h,i)=>({h,i,priority:h.priority,scarcity:999999}));
    const state = createDayPlacementState(day, settings, {dayBase:today, now, weekMode:true});
    const chosen = packDayWithHeuristic(state, day.agendaItems.map((item,i)=>({
      h:item.h, i:item.i, priority:item.priority, scarcity:item.scarcity
    })));
    const order = chosen.map(c=>c.fill.h.hid);
    return {order, starts:Object.fromEntries(chosen.map(c=>[c.fill.h.hid, c.fit.placeStart]))};
  });
  assert(heur.order.indexOf('h3') < heur.order.indexOf('h2'), 'heuristic places order-before ahead of successor');
  assert(heur.order[0] === 'h3', 'heuristic places doing-now item first');

  // ════════════════════════════════════════════════════════════════════════
  // F. UI sheet / long-press / emoji / clear / off choices
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[F] UI — long-press grip, sheet choices, clear, emoji');
  await page.evaluate(() => {
    localStorage.removeItem('tings_order_constraints_v1');
    const today = dayStart(Date.now());
    const tasks = [
      { name:'Email', hid:'t-email', type:'task', logs:[], lastLog:null, dueDate:today,
        eventTime:null, flexibilityDays:0, durationMinutes:20, breakable:false,
        autoMarkMinutes:null, priority:1, pinned:false, emoji:'✉️' },
      { name:'Deep work', hid:'t-deep', type:'task', logs:[], lastLog:null, dueDate:today,
        eventTime:null, flexibilityDays:0, durationMinutes:45, breakable:true,
        minChunkMinutes:20, autoMarkMinutes:5, priority:1, pinned:false, emoji:'🧠' },
      { name:'Walk', hid:'t-walk', type:'task', logs:[], lastLog:null, dueDate:today,
        eventTime:null, flexibilityDays:0, durationMinutes:20, breakable:false,
        autoMarkMinutes:null, priority:1, pinned:false, emoji:'🚶' }
    ];
    save(tasks);
    saveSortSettings({
      ...loadSortSettings(),
      showWeekOnHome:true,
      agendaOptimizer:false,
      showDueTasksInAgenda:true,
      availabilityMinutes:[600,600,600,600,600,600,600],
      blockedTimes:[]
    });
  });
  await page.reload({ waitUntil:'load' });
  await page.waitForTimeout(600);

  const ui = await page.evaluate(() => {
    const handles = document.querySelectorAll('.agenda-drag-handle');
    const dayRows = document.querySelectorAll('.swipe-row[data-agenda-draggable="1"]');
    const data = load();
    const deep = data.find(h=>h.hid === 't-deep');
    const email = data.find(h=>h.hid === 't-email');
    const walk = data.find(h=>h.hid === 't-walk');
    openOrderLinkSheet({
      h:deep, dayBase:dayStart(Date.now()),
      before:{h:email}, after:{h:walk},
      defaults:{after:'sometime', before:'sometime'},
      editMode:false
    });
    const sheetOpen = document.getElementById('order-link-sheet')?.classList.contains('open');
    const rows = document.querySelectorAll('#order-link-rows .order-link-row').length;
    const summaryHtml = document.getElementById('order-link-summary')?.innerHTML || '';
    const rowHtml = document.getElementById('order-link-rows')?.innerHTML || '';
    const title = document.getElementById('order-link-title')?.textContent || '';
    const sub = document.getElementById('order-link-sub')?.textContent || '';
    saveOrderLinkSheet();
    const edges = orderConstraintsForDay(dayStart(Date.now()));

    // Edit: turn before-link off, keep after as next (direct)
    openOrderLinksForHabit('t-deep', dayStart(Date.now()));
    const beforeSeg = document.querySelector('.order-link-row[data-link-kind="before"]');
    const afterSeg = document.querySelector('.order-link-row[data-link-kind="after"]');
    beforeSeg?.querySelector('[data-adj="off"]')?.click();
    afterSeg?.querySelector('[data-adj="direct"]')?.click();
    saveOrderLinkSheet();
    const edited = orderConstraintsForDay(dayStart(Date.now()));

    // Clear
    openOrderLinksForHabit('t-deep', dayStart(Date.now()));
    clearOrderLinkSheet();
    const cleared = orderConstraintsForDay(dayStart(Date.now()));

    // Doing now
    openDoingNowSheet({h:deep, afterHid:'t-walk'});
    const doingOpen = document.getElementById('doing-now-sheet')?.classList.contains('open');
    const doingSummary = document.getElementById('doing-now-name')?.innerHTML || '';
    confirmDoingNow();
    const dn = getDoingNow();

    // Long-press arm
    const row = document.querySelector('.swipe-row[data-agenda-draggable="1"]');
    const beforeReady = row?.classList.contains('agenda-drag-ready');
    armAgendaReorder(row, Number(row.dataset.realIdx), Number(row.dataset.dayBase));
    const afterReady = row?.classList.contains('agenda-drag-ready');
    void row?.offsetWidth;
    const pe = row ? getComputedStyle(row.querySelector('.agenda-drag-handle')).pointerEvents : 'none';

    return {
      handleCount:handles.length,
      dayRowCount:dayRows.length,
      sheetOpen, rows, summaryHtml, rowHtml, title, sub,
      edgeCount:edges.length,
      editedCount:edited.length,
      editedDirect:edited.some(e=>e.beforeHid==='t-email' && e.afterHid==='t-deep' && e.adjacency==='direct'),
      editedNoBefore:!edited.some(e=>e.beforeHid==='t-deep' && e.afterHid==='t-walk'),
      clearedCount:cleared.length,
      doingOpen, doingSummary, dnHid:dn && dn.hid,
      beforeReady, afterReady, pe
    };
  });

  assert(ui.handleCount >= 1 && ui.dayRowCount >= 1, 'draggable fill rows include hidden grip handles');
  assert(ui.sheetOpen && ui.rows === 2, 'order sheet opens with after + before rows');
  assert(ui.title === 'Reorder?', 'sheet title uses simple language');
  assert(/Just for/.test(ui.sub) && /Clears when done/.test(ui.sub), 'sheet sub is short');
  assert(/🧠/.test(ui.summaryHtml) && /✉️/.test(ui.rowHtml) && /🚶/.test(ui.rowHtml), 'sheet shows emojis');
  assert(/>later</.test(ui.rowHtml) && />next</.test(ui.rowHtml), 'adjacency uses later/next labels');
  assert(ui.edgeCount === 2, 'saving sheet writes two edges');
  assert(ui.editedCount === 1 && ui.editedDirect && ui.editedNoBefore, 'editing can set next + turn off one side');
  assert(ui.clearedCount === 0, 'clear removes that day’s links for the habit');
  assert(ui.doingOpen && ui.dnHid === 't-deep', 'doing-now confirm stores hid');
  assert(/🧠/.test(ui.doingSummary), 'doing-now summary shows emoji');
  assert(ui.beforeReady === false && ui.afterReady === true && ui.pe === 'auto', 'long-press arm reveals interactive grip');

  // Future-day drag-to-top is NOT doing-now
  const futureTop = await page.evaluate(() => {
    localStorage.removeItem('tings_order_constraints_v1');
    clearDoingNow();
    const tomorrow = dayStart(Date.now()) + 86400000;
    const data = load();
    const deep = data.find(h=>h.hid === 't-deep');
    const walk = data.find(h=>h.hid === 't-walk');
    // Simulate finishAgendaDrag path for future day top: opens order sheet, not doing now
    openOrderLinkSheet({
      h:deep, dayBase:tomorrow,
      before:null, after:{h:walk},
      defaults:{after:'off', before:'sometime'},
      editMode:false
    });
    const title = document.getElementById('order-link-title')?.textContent;
    const sub = document.getElementById('order-link-sub')?.textContent;
    saveOrderLinkSheet();
    return {
      title, sub,
      edges:orderConstraintsForDay(tomorrow),
      doing:getDoingNow()
    };
  });
  assert(futureTop.title === 'Reorder?', 'future-day top drop opens reorder sheet');
  assert(/tomorrow/.test(futureTop.sub || ''), 'future-day sheet scoped to tomorrow');
  assert(futureTop.edges.length === 1 && futureTop.edges[0].beforeHid === 't-deep', 'future top saves before-neighbor edge');
  assert(futureTop.doing == null, 'future-day top does not set doing-now');

  assert(pageErrors.length === 0, 'no page errors (' + pageErrors.slice(0,2).join(' | ') + ')');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(err=>{
  console.error(err);
  process.exit(1);
});
