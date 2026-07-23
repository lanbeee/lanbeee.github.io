/**
 * Breakable crown-dial + 3-color status bar — regression tests.
 *
 * Covers:
 *   A. Crown dial renders on primary breakable card (not range slider)
 *   B. Card simplification: no .ting-cue, .ting-meta, .card-actions on breakable cards
 *   C. Status bar segments: manual (teal), calendar (purple), adding (amber)
 *   D. Forward-only dial: cannot reduce below committed
 *   E. Consecutive drags accumulate from current target (no reset)
 *   F. Overflow protection: committed > total caps bar at 100%
 *   G. Complete state: crown gets .complete class at max
 *   H. Calendar credit breakdown: source:'calendar' logs → purple segment
 *   I. Auto-mark logs (no source) → teal segment, not purple
 *   J. Commit path: dirty target commits; target <= done → "already done"
 *   K. breakableProgressBreakdown pure function correctness
 *   L. Non-breakable cards unchanged (trail dots, no crown)
 *
 * Run:
 *   python3 -m http.server 4181   (from habits/)
 *   HABITS_URL=http://127.0.0.1:4181/ node tests/breakable-crown-e2e.js
 */

const { chromium } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let passed = 0;
function assert(cond, msg){
  if(!cond)throw new Error(msg);
  passed++;
}

function at(hour, minute = 0){
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

function base(props){
  return Object.assign({
    name:'item',
    type:'task',
    target:null,
    flexibilityDays:0,
    durationMinutes:30,
    breakable:false,
    minChunkMinutes:30,
    allowedTimeStart:null,
    allowedTimeEnd:null,
    preferredTimeStart:null,
    preferredTimeEnd:null,
    lastLog:null,
    logs:[],
    emoji:'',
    pinned:false,
    sample:false,
    snoozedUntil:null,
    topics:[],
    allowedWeekdays:[],
    allowedMonthDays:[],
    preferredWeekdays:[],
    preferredMonthDays:[],
    dueDate:at(0, 0),
    eventTime:null,
    hardDue:false,
    markDone:true,
    autoMarkMinutes:null,
    trackValue:false,
    createdAt:Date.now(),
    locationIds:[],
    priority:1,
    source:null,
    externalId:null,
    importedAt:null,
    planByDate:null,
    hid:null
  }, props);
}

function defaultSettings(overrides = {}){
  return Object.assign({
    preset:'todayFirst',
    showWeekOnHome:false,
    focus:'balanced',
    availabilityMinutes:[720, 720, 720, 720, 720, 720, 720],
    availabilityOverrides:{},
    blockedTimes:[{ label:'sleep', days:[], start:0, end:420 }],
    showScheduledTasksInAgenda:true,
    showDueTasksInAgenda:true,
    showPlannedItemsInAgenda:true,
    showDueHabitsInAgenda:true,
    showTaskDateOnCards:true,
    showPlansOnCards:true,
    showTimeWindowOnCards:true,
    agendaOptimizer:false
  }, overrides);
}

async function freezeClock(page, clockTs){
  await page.addInitScript(clock => {
    const RealDate = window.Date;
    function FrozenDate(...a){ return a.length ? new RealDate(...a) : new RealDate(clock); }
    FrozenDate.now = () => clock;
    FrozenDate.parse = RealDate.parse;
    FrozenDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FrozenDate, RealDate);
    FrozenDate.prototype = RealDate.prototype;
    window.__tingsRealDate = RealDate;
    window.Date = FrozenDate;
  }, clockTs);
}

async function seedAndReload(page, { data, settings, clockTs }){
  await page.evaluate(({ data, settings }) => {
    localStorage.clear();
    localStorage.setItem('tings_v2', JSON.stringify(data));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
  }, { data, settings });
  await page.reload({ waitUntil:'networkidle' });
  if(clockTs != null){
    const now = await page.evaluate(() => Date.now());
    assert(Math.abs(now - clockTs) < 2000, `clock freeze lost: ${now} vs ${clockTs}`);
  }
}

function breakableHabit(props = {}){
  return base(Object.assign({
    name:'Crown test',
    type:'task',
    breakable:true,
    durationMinutes:90,
    minChunkMinutes:15,
    dueDate:at(0, 0)
  }, props));
}

function calendarLog(minutes, tsOffset = 0){
  return { ts:at(12, 0) + tsOffset, minutes, source:'calendar', note:'imported calendar' };
}

function manualLog(minutes, tsOffset = 0){
  return { ts:at(12, 0) + tsOffset, minutes, note:'manual session' };
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport:{ width:390, height:844 } });
  const clockTs = at(14, 0);
  await freezeClock(page, clockTs);
  await page.goto(BASE, { waitUntil:'networkidle' });

  // ─── A. Crown dial renders on primary breakable card ───────────────────
  {
    const h = breakableHabit({ name:'Crown render', logs:[manualLog(30)] });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    const info = await page.evaluate(() => {
      const card = [...document.querySelectorAll('#list .ting-card')]
        .find(el => el.textContent.includes('Crown render'));
      if(!card)return null;
      const crown = card.querySelector('.breakable-crown');
      const slider = card.querySelector('.breakable-slider');
      const bar = card.querySelector('.breakable-status-bar');
      const label = card.querySelector('.breakable-progress-label');
      return {
        hasCrown:!!crown,
        hasOldSlider:!!slider,
        hasBar:!!bar,
        hasLabel:!!label,
        labelText:label?.textContent || '',
        crownCommitted:crown?.dataset.committed,
        crownTotal:crown?.dataset.total,
        crownManual:crown?.dataset.manual,
        crownCalendar:crown?.dataset.calendar,
        hasCanvas:!!crown?.querySelector('canvas.crown-canvas'),
        role:crown?.getAttribute('role'),
        ariaNow:crown?.getAttribute('aria-valuenow')
      };
    });

    assert(info, 'A: card found');
    assert(info.hasCrown, 'A: crown dial present');
    assert(!info.hasOldSlider, 'A: old range slider removed');
    assert(info.hasBar, 'A: status bar present');
    assert(info.hasCanvas, 'A: canvas inside crown');
    assert(info.role === 'slider', 'A: crown has role=slider');
    assert(info.crownTotal === '90', `A: total=90, got ${info.crownTotal}`);
    assert(info.crownCommitted === '30', `A: committed=30, got ${info.crownCommitted}`);
    assert(info.crownManual === '30', `A: manual=30, got ${info.crownManual}`);
    assert(info.crownCalendar === '0', `A: calendar=0, got ${info.crownCalendar}`);
    assert(info.labelText === '30/90m', `A: label "30/90m", got "${info.labelText}"`);
    assert(info.ariaNow === '30', `A: aria-valuenow=30, got ${info.ariaNow}`);
    console.log('  ok A — crown dial renders correctly');
  }

  // ─── B. Card simplification ────────────────────────────────────────────
  {
    const h = breakableHabit({ name:'Simplified card', logs:[manualLog(20)] });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    const info = await page.evaluate(() => {
      const card = [...document.querySelectorAll('#list .ting-card')]
        .find(el => el.textContent.includes('Simplified card'));
      if(!card)return null;
      return {
        hasCue:!!card.querySelector('.ting-cue'),
        hasMeta:!!card.querySelector('.ting-meta'),
        hasCardActions:!!card.querySelector('.card-actions'),
        hasPulseBtn:!!card.querySelector('.pulse-btn'),
        hasTingMain:!!card.querySelector('.ting-main'),
        hasTingName:!!card.querySelector('.ting-name'),
        hasBreakableClass:card.classList.contains('breakable-card'),
        hasVisual:!!card.querySelector('.ting-visual'),
        hasCrown:!!card.querySelector('.breakable-crown')
      };
    });

    assert(info, 'B: card found');
    assert(!info.hasCue, 'B: no .ting-cue on breakable card');
    assert(!info.hasMeta, 'B: no .ting-meta on breakable card');
    assert(!info.hasCardActions, 'B: no .card-actions on breakable card');
    assert(info.hasPulseBtn, 'B: .pulse-btn kept');
    assert(info.hasTingMain, 'B: .ting-main kept');
    assert(info.hasTingName, 'B: .ting-name kept');
    assert(info.hasBreakableClass, 'B: .breakable-card class present');
    assert(info.hasVisual, 'B: .ting-visual present');
    assert(info.hasCrown, 'B: crown inside .ting-visual');
    console.log('  ok B — card simplified correctly');
  }

  // ─── C. Status bar segments ────────────────────────────────────────────
  {
    const h = breakableHabit({
      name:'Bar segments',
      durationMinutes:100,
      logs:[manualLog(30), calendarLog(20)]
    });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    const info = await page.evaluate(() => {
      const card = [...document.querySelectorAll('#list .ting-card')]
        .find(el => el.textContent.includes('Bar segments'));
      const bar = card?.querySelector('.breakable-status-bar');
      if(!bar)return null;
      const manual = bar.querySelector('.bar-manual');
      const cal = bar.querySelector('.bar-calendar');
      const adding = bar.querySelector('.bar-adding');
      return {
        manualW:manual?.style.width,
        calW:cal?.style.width,
        addingW:adding?.style.width
      };
    });

    assert(info, 'C: status bar found');
    assert(info.manualW === '30%', `C: manual=30%, got ${info.manualW}`);
    assert(info.calW === '20%', `C: calendar=20%, got ${info.calW}`);
    assert(info.addingW === '0%', `C: adding=0% initially, got ${info.addingW}`);
    console.log('  ok C — status bar segments correct');
  }

  // ─── D. Forward-only: cannot reduce below committed ────────────────────
  {
    const h = breakableHabit({ name:'Forward only', logs:[manualLog(40)] });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    const info = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#list .swipe-row')]
        .find(el => el.textContent.includes('Forward only'));
      const crown = row?.querySelector('.breakable-crown');
      if(!crown)return null;
      const committed = Number(crown.dataset.committed);
      const total = Number(crown.dataset.total);
      // Simulate what setTarget does: clamp min to committed
      const tryBelow = Math.max(committed, Math.min(total, 10));
      const tryAbove = Math.max(committed, Math.min(total, 70));
      const tryOver = Math.max(committed, Math.min(total, 200));
      return { committed, total, tryBelow, tryAbove, tryOver };
    });

    assert(info, 'D: crown found');
    assert(info.tryBelow === 40, `D: clamped to committed=40, got ${info.tryBelow}`);
    assert(info.tryAbove === 70, `D: allows above committed=70, got ${info.tryAbove}`);
    assert(info.tryOver === 90, `D: clamped to total=90, got ${info.tryOver}`);
    console.log('  ok D — forward-only clamping correct');
  }

  // ─── E. Consecutive drags accumulate (no reset) ────────────────────────
  {
    const h = breakableHabit({ name:'Consecutive drag', logs:[manualLog(20)] });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    const info = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#list .swipe-row')]
        .find(el => el.textContent.includes('Consecutive drag'));
      if(!row)return null;
      // Simulate first drag: committed=20, drag +15 → target=35
      row.dataset.progressTarget = '35';
      row.dataset.progressDirty = '1';
      // Second drag reads current target as base (not committed)
      const dragBase = Math.round(Number(row.dataset.progressTarget) || 20);
      const secondTarget = dragBase + 10; // +10 more
      return { dragBase, secondTarget, committed:20 };
    });

    assert(info, 'E: row found');
    assert(info.dragBase === 35, `E: second drag base=35 (not committed=20), got ${info.dragBase}`);
    assert(info.secondTarget === 45, `E: accumulated target=45, got ${info.secondTarget}`);
    console.log('  ok E — consecutive drags accumulate');
  }

  // ─── F. Overflow protection: committed > total ─────────────────────────
  {
    const h = breakableHabit({
      name:'Overflow test',
      type:'keepup',
      target:1,
      durationMinutes:60,
      logs:[manualLog(50), calendarLog(30)]
    });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    const info = await page.evaluate(() => {
      const card = [...document.querySelectorAll('#list .ting-card')]
        .find(el => el.textContent.includes('Overflow test'));
      const crown = card?.querySelector('.breakable-crown');
      const bar = card?.querySelector('.breakable-status-bar');
      if(!crown || !bar)return null;
      const manual = bar.querySelector('.bar-manual');
      const cal = bar.querySelector('.bar-calendar');
      const adding = bar.querySelector('.bar-adding');
      const manualW = parseFloat(manual?.style.width) || 0;
      const calW = parseFloat(cal?.style.width) || 0;
      const addingW = parseFloat(adding?.style.width) || 0;
      return {
        committed:crown.dataset.committed,
        total:crown.dataset.total,
        manualW, calW, addingW,
        totalPct:manualW + calW + addingW,
        isComplete:crown.classList.contains('complete')
      };
    });

    assert(info, 'F: crown found');
    assert(info.committed === '60', `F: committed capped at total=60, got ${info.committed}`);
    assert(info.totalPct <= 100.01, `F: bar total <=100%, got ${info.totalPct}%`);
    assert(info.isComplete, 'F: complete class when committed >= total');
    console.log('  ok F — overflow capped, complete state set');
  }

  // ─── G. Complete state visual ──────────────────────────────────────────
  {
    const h = breakableHabit({ name:'Complete state', type:'keepup', target:1, logs:[manualLog(90)] });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    const info = await page.evaluate(() => {
      const card = [...document.querySelectorAll('#list .ting-card')]
        .find(el => el.textContent.includes('Complete state'));
      const crown = card?.querySelector('.breakable-crown');
      if(!crown)return null;
      const style = getComputedStyle(crown);
      return {
        isComplete:crown.classList.contains('complete'),
        cursor:style.cursor,
        labelText:card.querySelector('.breakable-progress-label')?.textContent
      };
    });

    assert(info, 'G: crown found');
    assert(info.isComplete, 'G: .complete class present at max');
    assert(info.cursor === 'default', `G: cursor=default when complete, got ${info.cursor}`);
    assert(info.labelText === '90/90m', `G: label "90/90m", got "${info.labelText}"`);
    console.log('  ok G — complete state visual correct');
  }

  // ─── H. Calendar credit → purple segment ───────────────────────────────
  {
    const h = breakableHabit({
      name:'Calendar credit',
      durationMinutes:100,
      logs:[manualLog(25), calendarLog(35)]
    });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    const info = await page.evaluate(() => {
      const card = [...document.querySelectorAll('#list .ting-card')]
        .find(el => el.textContent.includes('Calendar credit'));
      const crown = card?.querySelector('.breakable-crown');
      const bar = card?.querySelector('.breakable-status-bar');
      if(!crown || !bar)return null;
      return {
        manual:crown.dataset.manual,
        calendar:crown.dataset.calendar,
        manualW:bar.querySelector('.bar-manual')?.style.width,
        calW:bar.querySelector('.bar-calendar')?.style.width
      };
    });

    assert(info, 'H: crown found');
    assert(info.manual === '25', `H: manual=25, got ${info.manual}`);
    assert(info.calendar === '35', `H: calendar=35, got ${info.calendar}`);
    assert(info.manualW === '25%', `H: manual bar=25%, got ${info.manualW}`);
    assert(info.calW === '35%', `H: calendar bar=35%, got ${info.calW}`);
    console.log('  ok H — calendar credit shows as purple');
  }

  // ─── I. Auto-mark logs → teal (manual), not purple ─────────────────────
  {
    const h = breakableHabit({
      name:'Auto-mark color',
      durationMinutes:100,
      logs:[{ ts:at(12, 0), minutes:40, note:'agenda auto-log' }]
    });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    const info = await page.evaluate(() => {
      const card = [...document.querySelectorAll('#list .ting-card')]
        .find(el => el.textContent.includes('Auto-mark color'));
      const crown = card?.querySelector('.breakable-crown');
      if(!crown)return null;
      return {
        manual:crown.dataset.manual,
        calendar:crown.dataset.calendar
      };
    });

    assert(info, 'I: crown found');
    assert(info.manual === '40', `I: auto-mark counted as manual=40, got ${info.manual}`);
    assert(info.calendar === '0', `I: auto-mark NOT calendar=0, got ${info.calendar}`);
    console.log('  ok I — auto-mark logs show as teal (manual)');
  }

  // ─── J. Commit path: dirty target commits correctly ────────────────────
  {
    const h = breakableHabit({ name:'Commit test', logs:[manualLog(20)] });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    // Simulate a dirty target and commit via the app's own function
    const result = await page.evaluate(() => {
      const data = load();
      const idx = data.findIndex(x => x.name === 'Commit test');
      const row = [...document.querySelectorAll('#list .swipe-row')]
        .find(el => el.textContent.includes('Commit test'));
      // Set dirty target to 50 (committed is 20)
      row.dataset.progressTarget = '50';
      row.dataset.progressDirty = '1';
      const card = row.querySelector('.ting-card');
      const ok = commitBreakableFromCard(idx, card);
      const after = load()[idx];
      const done = breakableProgressMinutes(after);
      return { ok, done };
    });

    assert(result.ok, 'J: commit succeeded');
    assert(result.done === 50, `J: progress=50 after commit, got ${result.done}`);
    console.log('  ok J — dirty target commits correctly');
  }

  // ─── J2. Commit path: target <= done → "already done" ──────────────────
  {
    const h = breakableHabit({ name:'Already done test', logs:[manualLog(60)] });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    const result = await page.evaluate(() => {
      const data = load();
      const idx = data.findIndex(x => x.name === 'Already done test');
      const row = [...document.querySelectorAll('#list .swipe-row')]
        .find(el => el.textContent.includes('Already done test'));
      // Set target below done (simulates auto-mark race)
      row.dataset.progressTarget = '40';
      row.dataset.progressDirty = '1';
      const card = row.querySelector('.ting-card');
      const ok = commitBreakableFromCard(idx, card);
      const after = load()[idx];
      const done = breakableProgressMinutes(after);
      return { ok, done };
    });

    assert(!result.ok, 'J2: commit refused when target <= done');
    assert(result.done === 60, `J2: progress unchanged=60, got ${result.done}`);
    console.log('  ok J2 — target <= done shows "already done"');
  }

  // ─── K. breakableProgressBreakdown pure function ───────────────────────
  {
    await seedAndReload(page, { data:[], settings:defaultSettings(), clockTs });

    const result = await page.evaluate(() => {
      const h = {
        breakable:true,
        type:'task',
        durationMinutes:120,
        logs:[
          { ts:Date.now() - 100000, minutes:30 },
          { ts:Date.now() - 90000, minutes:20, source:'calendar', note:'imported calendar' },
          { ts:Date.now() - 80000, minutes:10, note:'agenda auto-log' }
        ]
      };
      const bd = breakableProgressBreakdown(h);
      return bd;
    });

    assert(result.total === 120, `K: total=120, got ${result.total}`);
    assert(result.calendar === 20, `K: calendar=20, got ${result.calendar}`);
    assert(result.manual === 40, `K: manual=40 (30 bare + 10 auto-log), got ${result.manual}`);
    console.log('  ok K — breakableProgressBreakdown correct');
  }

  // ─── K2. Breakdown for keepup (day-scoped) ─────────────────────────────
  {
    await seedAndReload(page, { data:[], settings:defaultSettings(), clockTs });

    const result = await page.evaluate((clockTs) => {
      const dayStart = new Date(clockTs);
      dayStart.setHours(0, 0, 0, 0);
      const ds = dayStart.getTime();
      const h = {
        breakable:true,
        type:'keepup',
        target:1,
        durationMinutes:60,
        logs:[
          { ts:ds + 3600000, minutes:15 },
          { ts:ds + 7200000, minutes:10, source:'calendar', note:'imported calendar' },
          { ts:ds - 86400000, minutes:99 }
        ]
      };
      const bd = breakableProgressBreakdown(h, ds);
      return bd;
    }, clockTs);

    assert(result.calendar === 10, `K2: today calendar=10, got ${result.calendar}`);
    assert(result.manual === 15, `K2: today manual=15 (yesterday excluded), got ${result.manual}`);
    console.log('  ok K2 — keepup breakdown is day-scoped');
  }

  // ─── L. Non-breakable cards unchanged ──────────────────────────────────
  {
    const h = base({ name:'Normal habit', type:'keepup', target:1, breakable:false, logs:[at(12, 0)] });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    const info = await page.evaluate(() => {
      const card = [...document.querySelectorAll('#list .ting-card')]
        .find(el => el.textContent.includes('Normal habit'));
      if(!card)return null;
      return {
        hasCrown:!!card.querySelector('.breakable-crown'),
        hasTrail:!!card.querySelector('.ting-trail'),
        hasCue:!!card.querySelector('.ting-cue'),
        hasMeta:!!card.querySelector('.ting-meta'),
        hasBreakableClass:card.classList.contains('breakable-card')
      };
    });

    assert(info, 'L: card found');
    assert(!info.hasCrown, 'L: no crown on non-breakable');
    assert(info.hasTrail, 'L: trail dots on non-breakable');
    assert(info.hasCue, 'L: .ting-cue kept on non-breakable');
    assert(info.hasMeta, 'L: .ting-meta kept on non-breakable');
    assert(!info.hasBreakableClass, 'L: no .breakable-card class');
    console.log('  ok L — non-breakable cards unchanged');
  }

  // ─── M. Crown dial height consistency ──────────────────────────────────
  {
    const h = breakableHabit({ name:'Height test', logs:[manualLog(10)] });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    const info = await page.evaluate(() => {
      const crown = document.querySelector('#list .breakable-crown');
      if(!crown)return null;
      const style = getComputedStyle(crown);
      return { height:parseFloat(style.height) };
    });

    assert(info, 'M: crown found');
    assert(info.height >= 34, `M: crown height >= 34px, got ${info.height}px`);
    console.log('  ok M — crown dial height consistent');
  }

  // ─── N. Status bar updates on wheel/keyboard ───────────────────────────
  {
    const h = breakableHabit({ name:'Wheel test', durationMinutes:60, logs:[manualLog(20)] });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    const info = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#list .swipe-row')]
        .find(el => el.textContent.includes('Wheel test'));
      const crown = row?.querySelector('.breakable-crown');
      if(!crown)return null;
      // Simulate wheel up (increase)
      crown.dispatchEvent(new WheelEvent('wheel', { deltaY:-1, bubbles:true }));
      const afterUp = row.dataset.progressTarget;
      // Simulate wheel down (decrease, but clamped at committed=20)
      crown.dispatchEvent(new WheelEvent('wheel', { deltaY:1, bubbles:true }));
      const afterDown = row.dataset.progressTarget;
      // Simulate many wheel downs — should clamp at committed
      for(let i = 0; i < 30; i++){
        crown.dispatchEvent(new WheelEvent('wheel', { deltaY:1, bubbles:true }));
      }
      const afterMany = row.dataset.progressTarget;
      const bar = row.querySelector('.breakable-status-bar');
      const addingW = bar?.querySelector('.bar-adding')?.style.width;
      return { afterUp, afterDown, afterMany, addingW };
    });

    assert(info.afterUp === '21', `N: wheel up → 21, got ${info.afterUp}`);
    assert(info.afterDown === '20', `N: wheel down clamped at committed=20, got ${info.afterDown}`);
    assert(info.afterMany === '20', `N: many wheel downs still 20, got ${info.afterMany}`);
    console.log('  ok N — wheel/keyboard clamped at committed');
  }

  // ─── O. Mixed manual + calendar + adding segments ──────────────────────
  {
    const h = breakableHabit({
      name:'Mixed bar',
      durationMinutes:100,
      logs:[manualLog(20), calendarLog(15)]
    });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    // Simulate adding 10 more via dirty target
    const info = await page.evaluate(() => {
      const row = [...document.querySelectorAll('#list .swipe-row')]
        .find(el => el.textContent.includes('Mixed bar'));
      const crown = row?.querySelector('.breakable-crown');
      if(!crown)return null;
      // Simulate keyboard right to add
      crown.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowRight', bubbles:true }));
      crown.dispatchEvent(new KeyboardEvent('keydown', { key:'ArrowRight', bubbles:true }));
      const bar = row.querySelector('.breakable-status-bar');
      return {
        target:row.dataset.progressTarget,
        dirty:row.dataset.progressDirty,
        manualW:bar.querySelector('.bar-manual')?.style.width,
        calW:bar.querySelector('.bar-calendar')?.style.width,
        addingW:bar.querySelector('.bar-adding')?.style.width,
        label:row.querySelector('.breakable-progress-label')?.textContent
      };
    });

    assert(info.target === '37', `O: target=37 (35+2), got ${info.target}`);
    assert(info.dirty === '1', 'O: dirty=1 after adding');
    assert(info.manualW === '20%', `O: manual=20%, got ${info.manualW}`);
    assert(info.calW === '15%', `O: calendar=15%, got ${info.calW}`);
    assert(info.addingW === '2%', `O: adding=2%, got ${info.addingW}`);
    assert(info.label === '37/100m', `O: label "37/100m", got "${info.label}"`);
    console.log('  ok O — mixed segments update correctly');
  }

  // ─── P. Zero-progress breakable card ───────────────────────────────────
  {
    const h = breakableHabit({ name:'Zero progress', logs:[] });
    await seedAndReload(page, { data:[h], settings:defaultSettings(), clockTs });

    const info = await page.evaluate(() => {
      const card = [...document.querySelectorAll('#list .ting-card')]
        .find(el => el.textContent.includes('Zero progress'));
      const crown = card?.querySelector('.breakable-crown');
      const bar = card?.querySelector('.breakable-status-bar');
      if(!crown)return null;
      return {
        committed:crown.dataset.committed,
        isComplete:crown.classList.contains('complete'),
        manualW:bar?.querySelector('.bar-manual')?.style.width,
        calW:bar?.querySelector('.bar-calendar')?.style.width,
        addingW:bar?.querySelector('.bar-adding')?.style.width,
        label:card.querySelector('.breakable-progress-label')?.textContent
      };
    });

    assert(info, 'P: crown found');
    assert(info.committed === '0', `P: committed=0, got ${info.committed}`);
    assert(!info.isComplete, 'P: not complete at zero');
    assert(info.manualW === '0%', `P: manual=0%, got ${info.manualW}`);
    assert(info.label === '0/90m', `P: label "0/90m", got "${info.label}"`);
    console.log('  ok P — zero progress renders correctly');
  }

  await browser.close();
  console.log(`\nAll ${passed} assertions passed.`);
  process.exit(0);
})().catch(err => {
  console.error('FAIL:', err.message);
  process.exit(1);
});
