// Recurring order links saved from the home order sheet + detail order block
// inline unlink + compact time-endpoint rule preview.
// Covers data/UI paths and placement for BOTH planners:
//   - fast: sync buildWeekAgenda (agendaOptimizer:false)
//   - GLPK: async buildWeekAgendaAsync (agendaOptimizer:true), soft-skip if GLPK missing
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/order-recurring-home-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
const FAST_ONLY = process.env.HABITS_PLANNER_MODE === 'fast';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

function seedScript(){
  return `(function(){
    if(sessionStorage.getItem('tings_order_recurring_test_seeded') === '1')return;
    sessionStorage.setItem('tings_order_recurring_test_seeded','1');
    localStorage.removeItem('tings_v2');
    localStorage.removeItem('tings_app_settings_v2');
    localStorage.removeItem('tings_order_constraints_v1');
    const settings = {
      preset:'todayFirst', topics:[], locations:[], travel:{}, defaultTravelMode:'walking',
      availabilityMinutes:[600,600,600,600,600,600,600], blockedTimes:[],
      showWeekOnHome:true, agendaOptimizer:false,
      showDueHabitsInAgenda:true, showPlannedItemsInAgenda:true,
      showDueTasksInAgenda:true, showScheduledTasksInAgenda:true,
    };
    localStorage.setItem('tings_v2', JSON.stringify([
      { name:'Alpha', type:'keepup', target:7, logs:[], durationMinutes:30, priority:1, hid:'ord-alpha' },
      { name:'Beta', type:'keepup', target:7, logs:[], durationMinutes:30, priority:3, hid:'ord-beta' },
      { name:'Gamma', type:'keepup', target:7, logs:[], durationMinutes:30, priority:2, hid:'ord-gamma' }
    ]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
  })();`;
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  // Freeze the clock in a roomy part of the day; the worker is stubbed onto
  // the main thread so the GLPK parity section runs under the same clock.
  const testClock = new Date();
  testClock.setHours(9,0,0,0);
  await page.addInitScript(({clock, fastOnly})=>{
    const RealDate = window.Date;
    function FrozenDate(...args){ return args.length ? new RealDate(...args) : new RealDate(clock); }
    FrozenDate.now = ()=>clock;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate,RealDate);
    FrozenDate.prototype = RealDate.prototype;
    window.Date = FrozenDate;
    try{
      if(typeof window.Worker !== 'function' || window.__tingsPlannerStubInstalled)return;
      window.__tingsPlannerStubInstalled = true;
      const RealWorker = window.Worker;
      window.Worker = class extends RealWorker {
        constructor(url, options){
          if(String(url).includes('agenda-planner-worker')){
            const listeners = { message:[], error:[] };
            const fake = {
              addEventListener(type, cb){ if(listeners[type])listeners[type].push(cb); },
              removeEventListener(type, cb){
                if(listeners[type])listeners[type] = listeners[type].filter(f => f !== cb);
              },
              terminate(){},
              postMessage(message){
                if(!message || typeof message !== 'object')return;
                const id = message.id;
                const fire = (type, data)=>{
                  for(const cb of [...(listeners[type] || [])]){
                    try{ cb({ data, type }); }catch(_){}
                  }
                };
                if(message.warm){
                  setTimeout(()=>fire('message',{ id, ready:true }),0);
                  return;
                }
                setTimeout(()=>{
                  let week = null;
                  let error = null;
                  try{
                    if(typeof buildWeekAgenda !== 'function'){
                      throw new Error('buildWeekAgenda unavailable on main thread');
                    }
                    const settings = { ...(message.settings || {}), agendaOptimizer:false };
                    week = buildWeekAgenda(message.data, settings, message.numDays || 7, {});
                    if(fastOnly)week.optimized = false;
                    else if(message.mode === 'exact')week.optimized = true;
                  }catch(err){
                    error = String(err && err.message ? err.message : err);
                  }
                  fire('message', error ? { id, error } : { id, week });
                },0);
              }
            };
            return fake;
          }
          return new RealWorker(url, options);
        }
      };
    }catch(_){}
  },{clock:testClock.getTime(), fastOnly:FAST_ONLY});

  const today = (()=>{ const d = new Date(testClock); d.setHours(0,0,0,0); return d.getTime(); })();
  const tomorrow = today + 86400000;

  // Sheet driver: open the order sheet for `hid` with `beforeHid` above it and
  // optionally `afterHid` below it, pick the repeat mode + adjacency, save.
  async function driveSheet(hid,beforeHid,adj,mode){
    return page.evaluate(({hid,beforeHid,adj,mode})=>{
      const data = load();
      const pick = id=>({ h:data.find(item=>item && item.hid === id) });
      openOrderLinkSheet({
        h:pick(hid).h,
        dayBase:dayStart(Date.now()),
        before:beforeHid ? pick(beforeHid) : null,
        after:null,
        defaults:{ after:beforeHid ? (adj || 'sometime') : 'off', before:'off' },
        editMode:false
      });
      if(mode === 'daily'){
        const daily = document.querySelector('#order-link-repeat [data-repeat="daily"]');
        daily.click();
      }
      if(beforeHid && adj && adj !== 'off'){
        const opt = document.querySelector('.order-link-row[data-link-kind="after"] [data-adj="' + adj + '"]');
        if(opt)opt.click();
      }
      saveOrderLinkSheet();
      const h = load().find(item=>item && item.hid === hid);
      return {
        links:h && h.scheduleLinks || [],
        dayEdges:orderConstraintsForDay(dayStart(Date.now())).length,
        persistent:plannerOrderConstraintsForDay(dayStart(Date.now()))
          .filter(e=>e.beforeHid === (beforeHid || '') && e.afterHid === hid)
      };
    },{hid,beforeHid,adj,mode});
  }

  // ════════════════════════════════════════════════════════════════════════
  // A. Daily save writes a Schedule link, not a day edge
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[A] sheet "every day" → recurring Schedule link');
  await page.addInitScript(seedScript());
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(250);

  const segReset = await page.evaluate(()=>{
    openOrderLinkSheet({
      h:load().find(item=>item.hid === 'ord-alpha'),
      dayBase:dayStart(Date.now()),
      before:{ h:load().find(item=>item.hid === 'ord-beta') },
      after:null,
      defaults:{ after:'sometime', before:'off' },
      editMode:false
    });
    const on = document.querySelector('#order-link-repeat .seg-opt.on');
    cancelOrderLinkSheet();
    return on && on.dataset.repeat;
  });
  assert(segReset === 'today','sheet reopens with "just today" selected');

  const daily = await driveSheet('ord-alpha','ord-beta','sometime','daily');
  assert(daily.links.length === 1
    && daily.links[0].anchorHid === 'ord-beta'
    && daily.links[0].direction === 'after'
    && daily.links[0].adjacency === 'sometime'
    && daily.links[0].requireSameDay === false,
    'daily save writes {anchor: beta, direction: after, sometime} on the dragged habit');
  assert(daily.dayEdges === 0,'daily save clears the one-day store');
  assert(daily.persistent.length === 1 && daily.persistent[0].persistent === true,
    'plannerOrderConstraintsForDay returns the persistent edge');
  const gammaUntouched = await page.evaluate(()=>{
    const g = load().find(item=>item.hid === 'ord-gamma');
    return !g.scheduleLinks || g.scheduleLinks.length === 0;
  });
  assert(gammaUntouched,'other habits untouched');

  // ════════════════════════════════════════════════════════════════════════
  // B. "Just today" still writes a one-day edge (regression guard)
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[B] sheet "just today" → one-day edge (unchanged path)');
  const oneday = await driveSheet('ord-alpha','ord-beta','sometime','today');
  assert(oneday.dayEdges === 1,'today save writes one one-day edge');
  assert(oneday.links.length === 1,'today save leaves the recurring link alone');
  assert(oneday.persistent.length === 1 && oneday.persistent[0].temporaryUpgrade === true,
    'one-day drag merges as a temporary upgrade of the recurring link');
  await page.evaluate(()=>localStorage.removeItem('tings_order_constraints_v1'));

  // ════════════════════════════════════════════════════════════════════════
  // C. Daily save with the row off removes the link; cycles are rejected
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[C] daily row-off removal + cycle rejection');
  const removed = await driveSheet('ord-alpha','ord-beta','off','daily');
  assert(removed.links.length === 0,'daily save with the row off removes the link');
  assert(removed.dayEdges === 0,'day store stays clean');

  const reAdd = await driveSheet('ord-alpha','ord-beta','sometime','daily');
  assert(reAdd.links.length === 1,'recurring link re-added');
  const cycle = await page.evaluate(()=>{
    const data = load();
    const beta = data.find(item=>item.hid === 'ord-beta');
    openOrderLinkSheet({
      h:beta,
      dayBase:dayStart(Date.now()),
      before:{ h:data.find(item=>item.hid === 'ord-alpha') },
      after:null,
      defaults:{ after:'sometime', before:'off' },
      editMode:false
    });
    document.querySelector('#order-link-repeat [data-repeat="daily"]').click();
    document.querySelector('.order-link-row[data-link-kind="after"] [data-adj="sometime"]').click();
    saveOrderLinkSheet();
    const after = load();
    cancelOrderLinkSheet();
    return {
      betaLinks:(after.find(item=>item.hid === 'ord-beta').scheduleLinks || []).length,
      alphaLinks:(after.find(item=>item.hid === 'ord-alpha').scheduleLinks || []).length,
      sheetOpen:!document.querySelector('#order-link-sheet').hidden
    };
  });
  assert(cycle.betaLinks === 0,'cycle is rejected: beta gains no link');
  assert(cycle.alphaLinks === 1,'cycle is rejected: alpha keeps its link');
  assert(cycle.sheetOpen === true,'sheet stays open on validation failure');

  // ════════════════════════════════════════════════════════════════════════
  // D. Detail order block: recurring row shows an inline unlink
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[D] detail order block inline unlink');
  const unlink = await page.evaluate(()=>{
    const alpha = load().find(item=>item.hid === 'ord-alpha');
    renderDetailOrderPage(alpha);
    const btn = document.querySelector('#detail-order-list [data-order-unlink-recurring="ord-beta"][data-order-unlink-recurring-hid="ord-alpha"]');
    if(!btn)return { found:false };
    btn.click();
    const after = load().find(item=>item.hid === 'ord-alpha');
    return { found:true, links:after.scheduleLinks || [], dayEdges:orderConstraintsForDay(dayStart(Date.now())).length };
  });
  assert(unlink.found,'recurring row renders an inline unlink button');
  assert(unlink.links.length === 0,'inline unlink removes the recurring link');
  assert(unlink.dayEdges === 0,'inline unlink leaves the day store alone');

  // ════════════════════════════════════════════════════════════════════════
  // E. Planner parity: recurring link orders the pair on BOTH engines
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[E] placement parity — recurring link (fast + GLPK)');
  const glpkOk = await page.evaluate(async()=>{
    try{
      if(typeof ensureGlpk !== 'function')return { ok:false, reason:'ensureGlpk missing' };
      const GLPK = await ensureGlpk();
      return { ok:!!GLPK, reason:GLPK ? 'loaded' : 'null' };
    }catch(err){ return { ok:false, reason:String(err) }; }
  });
  const parityRuns = [['fast',false]];
  if(glpkOk.ok)parityRuns.push(['GLPK',true]);
  else console.log('  skip: GLPK unavailable (' + glpkOk.reason + ')');

  for(const [label,useGlpk] of parityRuns){
    const result = await page.evaluate(async({useGlpk,tomorrow})=>{
      const mk = (name,hid,priority,extra)=>({
        name, hid, type:'task', logs:[], lastLog:null, dueDate:tomorrow,
        eventTime:null, flexibilityDays:0, durationMinutes:30, breakable:false,
        autoMarkMinutes:null, priority, pinned:false, emoji:'', locationIds:[],
        anywhereAllowed:true, ...(extra || {})
      });
      const alpha = mk('Alpha','ord-alpha',1,{scheduleLinks:[
        { anchorHid:'ord-beta', direction:'after', adjacency:'sometime', requireSameDay:false, minGapMinutes:0 }
      ]});
      const data = [alpha,mk('Beta','ord-beta',3)];
      const settings = {
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
      localStorage.removeItem('tings_order_constraints_v1');
      save(data);
      saveSortSettings(settings);
      const week = (useGlpk && typeof buildWeekAgendaAsync === 'function')
        ? await buildWeekAgendaAsync(data, settings, 2)
        : buildWeekAgenda(data, settings, 2);
      const day = (week.days || []).find(d=>d.dayBase === tomorrow) || week.days[0];
      const rows = (day && day.timeline || []).filter(r=>r.kind === 'fill' || r.kind === 'scheduled');
      const starts = {};
      for(const r of rows){
        const h = data[r.i];
        if(h)starts[h.hid] = r.start;
      }
      return { starts, optimized:week.optimized === true };
    },{useGlpk,tomorrow});
    assert(result.starts['ord-beta'] != null && result.starts['ord-alpha'] != null,
      label + ': both linked tasks placed');
    assert(result.starts['ord-beta'] <= result.starts['ord-alpha'],
      label + ': recurring "alpha after beta" honored (' + result.starts['ord-beta'] + ' ≤ ' + result.starts['ord-alpha'] + ')');
  }

  // ════════════════════════════════════════════════════════════════════════
  // F. Compact time preview: no dropdown echo, resolved clock leads
  // ════════════════════════════════════════════════════════════════════════
  console.log('\n[F] time rule preview compaction');
  const preview = await page.evaluate(()=>{
    const wrap = document.createElement('div');
    wrap.className = 'time-endpoint';
    wrap.innerHTML = '<div class="time-dynamic">' + uiTimeDynamicHtml('test') + '</div>';
    document.body.appendChild(wrap);
    const q = sel=>wrap.querySelector(sel);
    const previewEl = q('.time-rule-preview');
    const out = {};
    out.initialHidden = previewEl.hidden === true;
    q('.time-anchor').innerHTML = '<option value="dhuhr">Solar noon</option>';
    q('.time-anchor').value = 'dhuhr';
    syncTimeRuleSummary(wrap);
    out.plainAnchorHidden = previewEl.hidden === true && q('.time-rule-summary').textContent === '';
    q('.time-offset').value = '30';
    syncTimeRuleSummary(wrap);
    out.offsetText = q('.time-rule-summary').textContent;
    out.offsetVisible = previewEl.hidden === false;
    q('.time-resolved').textContent = '12:01 pm';
    syncTimeRulePreviewVisibility(wrap);
    out.resolvedFirst = previewEl.firstElementChild.classList.contains('time-resolved')
      && q('.time-rule-summary').previousElementSibling === q('.time-resolved');
    q('.time-combine').value = 'later';
    syncTimeRuleSummary(wrap);
    out.combineText = q('.time-rule-summary').textContent.slice(0,8);
    q('.time-combine').value = '';
    q('.time-anchor').value = 'habit';
    syncTimeRuleSummary(wrap);
    out.habitText = q('.time-rule-summary').textContent;
    wrap.remove();
    return out;
  });
  assert(preview.initialHidden,'preview pill starts collapsed');
  assert(preview.plainAnchorHidden,'plain anchor with no offset shows no dropdown echo');
  assert(preview.offsetText === '30 min after Solar noon','offset composes the rule text');
  assert(preview.offsetVisible,'offset makes the preview visible');
  assert(preview.resolvedFirst,'resolved clock leads the preview line');
  assert(preview.combineText === 'Later of','compare-two-times keeps the composed rule');
  assert(preview.habitText.length > 0,'habit anchor keeps its completion rule');

  assert(pageErrors.length === 0,'no page errors (' + pageErrors.slice(0,3).join(' | ') + ')');

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  if(fail)process.exit(1);
})().catch(error=>{ console.error(error); process.exit(1); });
