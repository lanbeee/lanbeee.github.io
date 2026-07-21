/**
 * Breakable tasks — continuous-first + true min-chunk floor + progress slider UX.
 *
 * Guards:
 *   A. Continuous wins when a gap fits full remaining
 *   B. Adaptive split into largest valid pieces (not equal min slices)
 *   C. Min floor: never schedule a piece < min while remaining >= min
 *   D. Finish-up: remaining < min after partial logs may place exactly remaining
 *   E. Progress logging updates remaining; next plan is continuous leftover
 *   F. Pure helpers: planChunks / validity / progress / suggestion / rewrite
 *   G. Doability uses min-viable session, not full duration
 *   H. Detail toggle persists breakable + minChunk; detail-mark uses suggestion
 *   I. Progress slider UX:
 *      - slider only on first today instance; later chunks keep trail dots
 *      - pulse/double-tap stay instant; no-drag tap logs suggested chunk (never full day)
 *      - drag ahead then pulse logs delta; drag below committed is ignored (no reverse)
 *      - secondary chunk cards still pulse suggested chunk; primary slider refreshes
 *      - after commit, remaining agenda budget shrinks
 *      - non-breakable cards unchanged (trail, instant full log)
 *
 * Run:
 *   python3 -m http.server 4173   (from habits/)
 *   HABITS_URL=http://127.0.0.1:4173/ node tests/breakable-continuous-e2e.js
 */

const { chromium } = require('playwright');

const BASE = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

function assert(cond, msg){
  if(!cond)throw new Error(msg);
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
    createdAt:Date.now(),
    locationIds:[],
    priority:1
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
  // Re-assert freeze survived reload via init script.
  if(clockTs != null){
    const now = await page.evaluate(() => Date.now());
    assert(Math.abs(now - clockTs) < 2000, `clock freeze lost: ${now} vs ${clockTs}`);
  }
}

async function breakableFillRows(page, name){
  return page.evaluate((habitName) => {
    const data = load();
    const settings = sortSettings || loadSortSettings();
    const ag = buildTodayAgenda(data, settings);
    const rows = buildTodayTimeline(ag);
    return rows
      .filter(r => r.kind === 'fill' && r.h && r.h.name === habitName)
      .map(r => ({
        start:r.start,
        end:r.end,
        durMin:Math.round((r.end - r.start) / 60000),
        chunkMinutes:r.chunkMinutes != null ? r.chunkMinutes : null,
        chunkIndex:r.chunkIndex != null ? r.chunkIndex : null
      }));
  }, name);
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true });
  const errors = [];
  page.on('pageerror', err => errors.push(`pageerror: ${err.message}`));
  page.on('console', msg => {
    if(msg.type() === 'error')errors.push(`console: ${msg.text()}`);
  });

  const clockTs = at(8, 0);
  await page.goto(BASE, { waitUntil:'domcontentloaded' });
  await freezeClock(page, clockTs);
  await page.reload({ waitUntil:'networkidle' });
  await page.waitForSelector('#open-add');

  // ═══════════════════════════════════════════════════════════
  // F. Pure helpers (no calendar)
  // ═══════════════════════════════════════════════════════════
  console.log('\n--- F: pure helpers ---');
  const helpers = await page.evaluate(() => {
    const day = dayStart(Date.now());
    const h90 = {
      breakable:true,
      durationMinutes:90,
      minChunkMinutes:30,
      logs:[],
      lastLog:null,
      type:'task'
    };
    const hPartial = {
      breakable:true,
      durationMinutes:90,
      minChunkMinutes:30,
      logs:[{ ts:Date.now(), minutes:70 }],
      lastLog:Date.now(),
      type:'task'
    };
    const hKeepup = {
      breakable:true,
      durationMinutes:420,
      minChunkMinutes:60,
      logs:[{ ts:day + 60 * 60000, minutes:60 }],
      lastLog:day + 60 * 60000,
      type:'keepup',
      target:1
    };
    const hRewrite = {
      breakable:true,
      durationMinutes:100,
      minChunkMinutes:30,
      type:'task',
      logs:[
        { ts:day + 10 * 60000, minutes:40 },
        { ts:day + 20 * 60000, minutes:20 },
        { ts:day + 30 * 60000, plan:true }
      ],
      lastLog:day + 20 * 60000
    };
    const rewriteAdd = rewriteBreakableProgress({
      ...h90,
      logs:[{ ts:Date.now(), minutes:10 }],
      lastLog:Date.now()
    }, 40);
    const rewriteSet = rewriteBreakableProgress(hRewrite, 25);
    const rewriteNoop = rewriteBreakableProgress({
      ...h90,
      logs:[{ ts:Date.now(), minutes:40 }],
      lastLog:Date.now()
    }, 40);
    return {
      plan100:planChunks(100, 30),
      plan0:planChunks(0, 30),
      rem90:remainingChunks(h90),
      remPartial:remainingChunks(hPartial),
      remDurPartial:remainingDurationMinutes(hPartial),
      minViable90:minViableSessionMinutes(h90),
      minViablePartial:minViableSessionMinutes(hPartial),
      valid40:isValidChunkMinutes(40, 90, 30),
      valid10of90:isValidChunkMinutes(10, 90, 30),
      valid20finish:isValidChunkMinutes(20, 20, 30),
      valid15finishBad:isValidChunkMinutes(15, 20, 30),
      progress0:breakableProgressMinutes(h90),
      progressPartial:breakableProgressMinutes(hPartial),
      progressKeepup:breakableProgressMinutes(hKeepup, day),
      totalKeepup:breakableTotalMinutes(hKeepup),
      budgetKeepup:breakableBudgetMinutes(hKeepup, day),
      pctKeepup:breakableProgressPercent(hKeepup, day),
      minsFrom11:breakableMinutesFromPercent(hKeepup, 11),
      minsFrom50:breakableMinutesFromPercent(hKeepup, 50),
      sugNull:suggestedBreakableLogMinutes(hKeepup, null, day),
      sugFullRem:suggestedBreakableLogMinutes(hKeepup, 360, day),
      sugPartialChunk:suggestedBreakableLogMinutes(hKeepup, 90, day),
      sugFinish:suggestedBreakableLogMinutes({
        ...hPartial, type:'task'
      }, null),
      rewriteAddMode:rewriteAdd.mode,
      rewriteAddDelta:rewriteAdd.delta,
      rewriteSetMode:rewriteSet.mode,
      rewriteSetMinutes:rewriteSet.minutes,
      rewriteSetProgress:breakableProgressMinutes(hRewrite),
      rewriteKeptPlan:normalizeLogs(hRewrite.logs).some(l => isPlanLog(l)),
      rewriteNoopMode:rewriteNoop.mode
    };
  });
  assert(JSON.stringify(helpers.plan100) === JSON.stringify([100]),
    `planChunks continuous ideal: got ${JSON.stringify(helpers.plan100)}`);
  assert(JSON.stringify(helpers.plan0) === JSON.stringify([]),
    `planChunks empty: got ${JSON.stringify(helpers.plan0)}`);
  assert(JSON.stringify(helpers.rem90) === JSON.stringify([90]),
    `remainingChunks continuous: got ${JSON.stringify(helpers.rem90)}`);
  assert(helpers.remDurPartial === 20, `remaining after 70 of 90: ${helpers.remDurPartial}`);
  assert(JSON.stringify(helpers.remPartial) === JSON.stringify([20]),
    `remainingChunks finish-up: got ${JSON.stringify(helpers.remPartial)}`);
  assert(helpers.minViable90 === 30, `minViable full: ${helpers.minViable90}`);
  assert(helpers.minViablePartial === 20, `minViable finish-up: ${helpers.minViablePartial}`);
  assert(helpers.valid40 === true, '40 of 90 with min 30 should be valid');
  assert(helpers.valid10of90 === false, '10 of 90 with min 30 must be invalid');
  assert(helpers.valid20finish === true, 'finish-up 20 of 20 should be valid');
  assert(helpers.valid15finishBad === false, 'partial finish-up must equal remaining');
  assert(helpers.progress0 === 0, `fresh progress 0, got ${helpers.progress0}`);
  assert(helpers.progressPartial === 70, `partial progress 70, got ${helpers.progressPartial}`);
  assert(helpers.progressKeepup === 60, `keepup today progress 60, got ${helpers.progressKeepup}`);
  assert(helpers.totalKeepup === 420, `total budget 420, got ${helpers.totalKeepup}`);
  assert(helpers.budgetKeepup === 360, `remaining budget 360, got ${helpers.budgetKeepup}`);
  assert(helpers.pctKeepup === 14, `60/420 → 14%, got ${helpers.pctKeepup}`);
  assert(helpers.minsFrom11 === Math.round(420 * 11 / 100),
    `11% minutes, got ${helpers.minsFrom11}`);
  assert(helpers.minsFrom50 === 210, `50% → 210, got ${helpers.minsFrom50}`);
  assert(helpers.sugNull === 60, `null chunk → min 60, got ${helpers.sugNull}`);
  assert(helpers.sugFullRem === 60,
    `full-remaining card chunk must fall back to min, got ${helpers.sugFullRem}`);
  assert(helpers.sugPartialChunk === 90, `true partial chunk 90, got ${helpers.sugPartialChunk}`);
  assert(helpers.sugFinish === 20, `finish-up suggestion 20, got ${helpers.sugFinish}`);
  assert(helpers.rewriteAddMode === 'add', `rewrite ahead → add, got ${helpers.rewriteAddMode}`);
  assert(helpers.rewriteAddDelta === 30, `rewrite add delta 30, got ${helpers.rewriteAddDelta}`);
  assert(helpers.rewriteSetMode === 'set', `rewrite below → set, got ${helpers.rewriteSetMode}`);
  assert(helpers.rewriteSetMinutes === 25, `rewrite set minutes 25, got ${helpers.rewriteSetMinutes}`);
  assert(helpers.rewriteSetProgress === 25, `after rewrite progress 25, got ${helpers.rewriteSetProgress}`);
  assert(helpers.rewriteKeptPlan === true, 'rewrite must keep plan logs');
  assert(helpers.rewriteNoopMode === 'noop', `equal target → noop, got ${helpers.rewriteNoopMode}`);
  console.log('  pure helpers: OK');

  // ═══════════════════════════════════════════════════════════
  // A. Continuous wins
  // ═══════════════════════════════════════════════════════════
  console.log('\n--- A: continuous wins ---');
  await seedAndReload(page, {
    clockTs,
    settings:defaultSettings({
      blockedTimes:[{ label:'sleep', days:[], start:0, end:420 }]
    }),
    data:[
      base({
        name:'Breakable continuous',
        durationMinutes:90,
        breakable:true,
        minChunkMinutes:30,
        dueDate:at(0, 0),
        priority:0
      })
    ]
  });
  const continuousRows = await breakableFillRows(page, 'Breakable continuous');
  assert(continuousRows.length === 1,
    `continuous should be 1 row, got ${continuousRows.length}: ${JSON.stringify(continuousRows)}`);
  assert(continuousRows[0].durMin === 90,
    `continuous duration should be 90, got ${continuousRows[0].durMin}`);
  const continuousUi = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#list .ting-card')]
      .filter(el => (el.textContent || '').includes('Breakable continuous'));
    return {
      count:cards.length,
      hasSlider:!!cards[0]?.querySelector('.breakable-slider'),
      hasTrail:!!cards[0]?.querySelector('.ting-trail'),
      label:cards[0]?.querySelector('.breakable-progress-label')?.textContent || null
    };
  });
  assert(continuousUi.count === 1, `single continuous card, got ${continuousUi.count}`);
  assert(continuousUi.hasSlider === true, 'single breakable card must show slider');
  assert(continuousUi.hasTrail === false, 'slider card must not also show trail');
  assert(continuousUi.label === '0/90m', `fresh label 0/90m, got ${continuousUi.label}`);
  console.log('  continuous 90m: OK');

  // ═══════════════════════════════════════════════════════════
  // B. Adaptive split (40 + 50 gaps → not 30+30+30)
  // Sleep until 8:00. Block 8:40–10:00 → gap 8:00–8:40 = 40m.
  // Block after 10:50 → gap 10:00–10:50 = 50m. No single gap fits 90.
  // ═══════════════════════════════════════════════════════════
  console.log('\n--- B: adaptive split ---');
  await seedAndReload(page, {
    clockTs,
    settings:defaultSettings({
      blockedTimes:[
        { label:'sleep', days:[], start:0, end:420 },
        { label:'mid', days:[], start:520, end:600 },
        { label:'late', days:[], start:650, end:1440 }
      ]
    }),
    data:[
      base({
        name:'Breakable split',
        durationMinutes:90,
        breakable:true,
        minChunkMinutes:30,
        dueDate:at(0, 0),
        priority:0
      })
    ]
  });
  const splitRows = await breakableFillRows(page, 'Breakable split');
  assert(splitRows.length >= 2,
    `adaptive split should produce >=2 rows, got ${JSON.stringify(splitRows)}`);
  const splitDurs = splitRows.map(r => r.durMin);
  assert(splitDurs.every(d => d >= 30),
    `all split pieces must be >= 30 while remaining large: ${JSON.stringify(splitDurs)}`);
  assert(!splitDurs.every(d => d === 30) || splitDurs.length !== 3,
    `must not pre-slice into equal min chunks [30,30,30]: ${JSON.stringify(splitDurs)}`);
  const splitSum = splitDurs.reduce((a, b) => a + b, 0);
  assert(splitSum === 90, `split pieces must sum to 90, got ${splitSum}: ${JSON.stringify(splitDurs)}`);
  assert(splitDurs.includes(40) || splitDurs[0] === 40,
    `expected a 40m piece from the first gap, got ${JSON.stringify(splitDurs)}`);
  console.log('  adaptive split:', splitDurs.join('+'), 'OK');

  // ═══════════════════════════════════════════════════════════
  // C. Min floor — three 30m gaps + one 10m gap, duration 100
  // Gaps after 8:00: 8:00–8:30, 8:40–9:10, 9:20–9:50, 10:00–10:10
  // ═══════════════════════════════════════════════════════════
  console.log('\n--- C: min floor ---');
  await seedAndReload(page, {
    clockTs,
    settings:defaultSettings({
      blockedTimes:[
        { label:'sleep', days:[], start:0, end:420 },
        { label:'b1', days:[], start:510, end:520 },
        { label:'b2', days:[], start:550, end:560 },
        { label:'b3', days:[], start:590, end:600 },
        { label:'b4', days:[], start:610, end:1440 }
      ]
    }),
    data:[
      base({
        name:'Breakable floor',
        durationMinutes:100,
        breakable:true,
        minChunkMinutes:30,
        dueDate:at(0, 0),
        priority:0
      })
    ]
  });
  const floorRows = await breakableFillRows(page, 'Breakable floor');
  const floorDurs = floorRows.map(r => r.durMin);
  // Pieces scheduled while remaining >= 30 must be >= 30. The final finish-up
  // of 10 (after 90 placed) is allowed only when remaining drops below min.
  let simulatedLeft = 100;
  for(const d of floorDurs){
    if(simulatedLeft >= 30){
      assert(d >= 30,
        `piece ${d} invalid while remaining ${simulatedLeft}: ${JSON.stringify(floorDurs)}`);
    }else{
      assert(d === simulatedLeft,
        `finish-up must equal remaining ${simulatedLeft}, got ${d}`);
    }
    simulatedLeft -= d;
  }
  assert(floorDurs.every(d => d !== 10) || floorDurs[floorDurs.length - 1] === 10,
    `under-min 10 only allowed as final finish-up: ${JSON.stringify(floorDurs)}`);
  // Old equal-slice plan would eagerly emit a 10 mid-stream; ensure we never
  // placed a lone under-min piece as the *only* progress when 100 remained.
  assert(floorDurs[0] >= 30, `first piece must respect floor: ${floorDurs[0]}`);
  console.log('  min floor pieces:', floorDurs.join('+'), 'OK');

  // ═══════════════════════════════════════════════════════════
  // D. Finish-up after partial logs
  // ═══════════════════════════════════════════════════════════
  console.log('\n--- D: finish-up ---');
  const logTs = at(7, 0);
  await seedAndReload(page, {
    clockTs,
    settings:defaultSettings({
      blockedTimes:[{ label:'sleep', days:[], start:0, end:420 }]
    }),
    data:[
      base({
        name:'Breakable finish',
        durationMinutes:90,
        breakable:true,
        minChunkMinutes:30,
        dueDate:at(0, 0),
        priority:0,
        lastLog:logTs,
        logs:[{ ts:logTs, minutes:70 }]
      })
    ]
  });
  const finishRows = await breakableFillRows(page, 'Breakable finish');
  assert(finishRows.length === 1,
    `finish-up should be one row, got ${JSON.stringify(finishRows)}`);
  assert(finishRows[0].durMin === 20,
    `finish-up duration should be 20, got ${finishRows[0].durMin}`);
  console.log('  finish-up 20m: OK');

  // ═══════════════════════════════════════════════════════════
  // E. Progress logging → continuous leftover
  // ═══════════════════════════════════════════════════════════
  console.log('\n--- E: progress logging ---');
  await seedAndReload(page, {
    clockTs,
    settings:defaultSettings({
      blockedTimes:[{ label:'sleep', days:[], start:0, end:420 }]
    }),
    data:[
      base({
        name:'Breakable progress',
        durationMinutes:90,
        breakable:true,
        minChunkMinutes:30,
        dueDate:at(0, 0),
        priority:0
      })
    ]
  });
  const beforeLog = await breakableFillRows(page, 'Breakable progress');
  assert(beforeLog.length === 1 && beforeLog[0].durMin === 90, 'pre-log continuous 90');

  await page.evaluate(() => {
    const data = load();
    const idx = data.findIndex(h => h.name === 'Breakable progress');
    if(idx < 0)throw new Error('habit missing');
    logTing(idx, { minutes:40 });
  });

  const afterState = await page.evaluate(() => {
    const data = load();
    const h = data.find(x => x.name === 'Breakable progress');
    const settings = sortSettings || loadSortSettings();
    const ag = buildTodayAgenda(data, settings);
    const rows = buildTodayTimeline(ag)
      .filter(r => r.kind === 'fill' && r.h && r.h.name === 'Breakable progress')
      .map(r => Math.round((r.end - r.start) / 60000));
    return {
      remaining:remainingDurationMinutes(h),
      chunks:remainingChunks(h),
      rows
    };
  });
  assert(afterState.remaining === 50, `remaining after 40 log: ${afterState.remaining}`);
  assert(JSON.stringify(afterState.chunks) === JSON.stringify([50]),
    `next ideal chunk should be [50], got ${JSON.stringify(afterState.chunks)}`);
  assert(afterState.rows.length === 1 && afterState.rows[0] === 50,
    `next placement should be one 50m block, got ${JSON.stringify(afterState.rows)}`);
  console.log('  progress → continuous 50m: OK');

  // ═══════════════════════════════════════════════════════════
  // G. Doability uses min-viable (45m window left, 90m breakable / min 30)
  // Freeze at 19:15 with allowed window 10:00–20:00 → 45m left.
  // ═══════════════════════════════════════════════════════════
  console.log('\n--- G: doability ---');
  const lateClock = at(19, 15);
  await freezeClock(page, lateClock);
  await seedAndReload(page, {
    clockTs:lateClock,
    settings:defaultSettings({
      blockedTimes:[{ label:'sleep', days:[], start:0, end:420 }]
    }),
    data:[
      base({
        name:'Breakable doable',
        durationMinutes:90,
        breakable:true,
        minChunkMinutes:30,
        dueDate:at(0, 0),
        allowedTimeStart:600,
        allowedTimeEnd:1200,
        priority:0
      })
    ]
  });
  const doable = await page.evaluate(() => {
    const data = load();
    const h = data.find(x => x.name === 'Breakable doable');
    return {
      still:windowStillDoableToday(h),
      minViable:minViableSessionMinutes(h),
      inAgenda:buildTodayAgenda(data, sortSettings || loadSortSettings())
        .agendaItems.some(it => it.h && it.h.name === 'Breakable doable')
    };
  });
  assert(doable.minViable === 30, `minViable should be 30, got ${doable.minViable}`);
  assert(doable.still === true,
    `windowStillDoableToday should be true with 45m left and min 30`);
  assert(doable.inAgenda === true, 'breakable should still appear in today agenda candidates');
  console.log('  doability min-viable: OK');

  // ═══════════════════════════════════════════════════════════
  // I. Progress slider + instant tap (suggested chunk, not full day)
  // ═══════════════════════════════════════════════════════════
  console.log('\n--- I: progress slider UX ---');
  await freezeClock(page, clockTs);
  await seedAndReload(page, {
    clockTs,
    settings:defaultSettings({
      blockedTimes:[{ label:'sleep', days:[], start:0, end:420 }]
    }),
    data:[
      base({
        name:'Slider work',
        type:'keepup',
        target:1,
        durationMinutes:420,
        breakable:true,
        minChunkMinutes:60,
        dueDate:null,
        lastLog:at(0, 0) - 2 * 86400000,
        logs:[at(0, 0) - 2 * 86400000],
        priority:0
      }),
      base({
        name:'Normal stretch',
        type:'keepup',
        target:1,
        durationMinutes:15,
        breakable:false,
        lastLog:at(0, 0) - 2 * 86400000,
        logs:[at(0, 0) - 2 * 86400000],
        priority:1
      })
    ]
  });

  const sliderCard = page.locator('.ting-card:has-text("Slider work")');
  await sliderCard.waitFor({ state:'visible' });
  const slider = sliderCard.locator('.breakable-slider');
  assert(await slider.count() === 1, 'breakable card should show progress slider');
  assert(await slider.inputValue() === '0', `slider starts at 0, got ${await slider.inputValue()}`);
  assert(await page.locator('.ting-card:has-text("Normal stretch") .breakable-slider').count() === 0,
    'non-breakable must not show slider');
  assert(await page.locator('.ting-card:has-text("Normal stretch") .ting-trail').count() === 1,
    'non-breakable keeps trail dots');

  // Pulse without drag → suggested min chunk (60), not full 420.
  await sliderCard.locator('.pulse-btn').click();
  await page.waitForFunction(() => {
    const card = [...document.querySelectorAll('#list .ting-card')].find(el =>
      (el.textContent || '').includes('Slider work'));
    const label = card?.querySelector('.breakable-progress-label')?.textContent || '';
    return label === '60/420m';
  }, null, { timeout:5000 });
  const afterPulse2 = await page.evaluate(() => {
    const data = load();
    const h = data.find(x => x.name === 'Slider work');
    const card = [...document.querySelectorAll('#list .ting-card')].find(el => el.textContent.includes('Slider work'));
    const sliderEl = card?.querySelector('.breakable-slider');
    return {
      progress:breakableProgressMinutes(h),
      budget:breakableBudgetMinutes(h),
      sliderVal:sliderEl ? Number(sliderEl.value) : null,
      label:card?.querySelector('.breakable-progress-label')?.textContent,
      min:sliderEl ? Number(sliderEl.min) : null
    };
  });
  assert(afterPulse2.progress === 60, `pulse should log 60m suggestion, got ${afterPulse2.progress}`);
  assert(afterPulse2.budget === 360, `remaining budget 360, got ${afterPulse2.budget}`);
  assert(afterPulse2.label === '60/420m', `label should be 60/420m, got ${afterPulse2.label}`);
  assert(afterPulse2.sliderVal === 14, `slider ~14% for 60/420, got ${afterPulse2.sliderVal}`);
  assert(afterPulse2.min === 14, `slider min should clamp at committed 14%, got ${afterPulse2.min}`);
  console.log('  pulse logs suggestion 60m: OK');

  // Drag below committed must not reverse — snaps to floor, not dirty.
  const workCard = page.locator('.ting-card').filter({ hasText:'Slider work' });
  const slider2 = workCard.locator('.breakable-slider');
  await slider2.evaluate(el => {
    el.value = '5';
    el.dispatchEvent(new Event('input', { bubbles:true }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
  });
  const reverseAttempt = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.swipe-row')].find(r =>
      r.querySelector('.ting-card')?.textContent.includes('Slider work')
      && r.querySelector('.breakable-slider'));
    const el = row?.querySelector('.breakable-slider');
    return {
      dirty:row?.dataset.progressDirty,
      target:row?.dataset.progressTarget,
      value:el ? Number(el.value) : null,
      min:el ? Number(el.min) : null
    };
  });
  assert(reverseAttempt.min === 14, `min stays 14 after reverse attempt, got ${reverseAttempt.min}`);
  assert(reverseAttempt.value === 14, `value snaps to min 14, got ${reverseAttempt.value}`);
  assert(reverseAttempt.dirty === '0', `reverse drag must not dirty, got ${reverseAttempt.dirty}`);
  assert(Number(reverseAttempt.target) === 60, `target stays 60, got ${reverseAttempt.target}`);
  console.log('  no reverse via slider: OK');

  // Drag ahead to ~50% then pulse → log delta to ~210.
  await slider2.evaluate(el => {
    el.value = '50';
    el.dispatchEvent(new Event('input', { bubbles:true }));
    el.dispatchEvent(new Event('change', { bubbles:true }));
  });
  const pending = await page.evaluate(() => {
    const row = [...document.querySelectorAll('.swipe-row')].find(r =>
      r.querySelector('.ting-card')?.textContent.includes('Slider work')
      && r.querySelector('.breakable-slider'));
    return {
      dirty:row?.dataset.progressDirty,
      target:row?.dataset.progressTarget
    };
  });
  assert(pending.dirty === '1', 'slider drag ahead should mark dirty');
  const targetMin = Math.round(420 * 50 / 100);
  assert(Number(pending.target) === targetMin,
    `target minutes ~${targetMin}, got ${pending.target}`);

  await workCard.locator('.pulse-btn').click();
  await page.waitForFunction(() => {
    const data = typeof load === 'function' ? load() : [];
    const h = data.find(x => x.name === 'Slider work');
    return h && breakableProgressMinutes(h) === 210;
  }, null, { timeout:5000 });
  const afterDrag = await page.evaluate(() => {
    const data = load();
    const h = data.find(x => x.name === 'Slider work');
    return {
      progress:breakableProgressMinutes(h),
      budget:breakableBudgetMinutes(h)
    };
  });
  assert(afterDrag.progress === targetMin,
    `drag+pulse should set progress to ${targetMin}, got ${afterDrag.progress}`);
  assert(afterDrag.budget === 420 - targetMin,
    `budget should be ${420 - targetMin}, got ${afterDrag.budget}`);
  // Agenda leftover for this habit must not exceed remaining budget.
  const agendaAfterDrag = await breakableFillRows(page, 'Slider work');
  const agendaSum = agendaAfterDrag.reduce((a, r) => a + r.durMin, 0);
  assert(agendaSum <= afterDrag.budget,
    `agenda placed ${agendaSum}m but budget is ${afterDrag.budget}: ${JSON.stringify(agendaAfterDrag)}`);
  console.log('  drag then pulse commits target: OK');

  // Undragged second pulse on primary → another suggested chunk (60 → 270).
  await workCard.locator('.pulse-btn').click();
  await page.waitForFunction(() => {
    const data = typeof load === 'function' ? load() : [];
    const h = data.find(x => x.name === 'Slider work');
    if(!h || breakableProgressMinutes(h) !== 270)return false;
    const card = [...document.querySelectorAll('#list .ting-card')].find(el =>
      (el.textContent || '').includes('Slider work') && el.querySelector('.breakable-slider'));
    return card?.querySelector('.breakable-progress-label')?.textContent === '270/420m';
  }, null, { timeout:5000 });
  const afterSecondPulse = await page.evaluate(() => {
    const data = load();
    const h = data.find(x => x.name === 'Slider work');
    const card = [...document.querySelectorAll('#list .ting-card')].find(el =>
      el.textContent.includes('Slider work') && el.querySelector('.breakable-slider'));
    return {
      progress:breakableProgressMinutes(h),
      label:card?.querySelector('.breakable-progress-label')?.textContent,
      min:Number(card?.querySelector('.breakable-slider')?.min)
    };
  });
  assert(afterSecondPulse.progress === 270, `second pulse → 270, got ${afterSecondPulse.progress}`);
  assert(afterSecondPulse.label === '270/420m', `label 270/420m, got ${afterSecondPulse.label}`);
  assert(afterSecondPulse.min === Math.round(270 / 420 * 100),
    `min clamps to new committed %, got ${afterSecondPulse.min}`);
  console.log('  undragged second pulse advances suggestion: OK');

  // Helpers unit checks
  const helperCheck = await page.evaluate(() => {
    const h = {
      breakable:true, type:'keepup', target:1,
      durationMinutes:420, minChunkMinutes:60, logs:[], lastLog:null
    };
    return {
      sug:suggestedBreakableLogMinutes(h, null),
      sugChunk:suggestedBreakableLogMinutes(h, 90),
      notFull:suggestedBreakableLogMinutes(h, null) < 420
    };
  });
  assert(helperCheck.sug === 60, `default suggestion 60, got ${helperCheck.sug}`);
  assert(helperCheck.sugChunk === 90, `card chunk suggestion 90, got ${helperCheck.sugChunk}`);
  assert(helperCheck.notFull, 'suggestion must not be full remaining day');
  console.log('  suggestedBreakableLogMinutes: OK');

  // Multi-instance: only first today card has slider; later cards keep trail
  // and still log via suggested chunk on pulse.
  console.log('  multi-instance primary slider...');
  await freezeClock(page, clockTs);
  await seedAndReload(page, {
    clockTs,
    settings:defaultSettings({
      blockedTimes:[
        { label:'sleep', days:[], start:0, end:420 },
        { label:'mid', days:[], start:520, end:600 },
        { label:'late', days:[], start:650, end:1440 }
      ]
    }),
    data:[
      base({
        name:'Split slider',
        type:'task',
        durationMinutes:90,
        breakable:true,
        minChunkMinutes:30,
        dueDate:at(0, 0),
        lastLog:null,
        logs:[],
        priority:0
      })
    ]
  });
  const multiUi = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#list .ting-card')]
      .filter(el => (el.textContent || '').includes('Split slider'));
    return {
      count:cards.length,
      sliders:cards.map(c => !!c.querySelector('.breakable-slider')),
      trails:cards.map(c => !!c.querySelector('.ting-trail'))
    };
  });
  assert(multiUi.count >= 2, `expected >=2 Split slider cards, got ${multiUi.count}`);
  assert(multiUi.sliders[0] === true, 'first instance should show slider');
  assert(multiUi.sliders.slice(1).every(v => v === false),
    `later instances must not show slider: ${JSON.stringify(multiUi.sliders)}`);
  assert(multiUi.trails.slice(1).every(v => v === true),
    `later instances keep trail dots: ${JSON.stringify(multiUi.trails)}`);
  console.log('  first-only slider + secondary trails: OK');

  // Pulse on secondary card → suggested chunk advance (no slider needed).
  const secondaryPulse = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#list .ting-card')]
      .filter(el => (el.textContent || '').includes('Split slider'));
    const secondary = cards[1];
    const btn = secondary?.querySelector('.pulse-btn');
    if(btn)btn.click();
    return { clicked:!!btn };
  });
  assert(secondaryPulse.clicked, 'secondary pulse button should exist');
  await page.waitForFunction(() => {
    const data = typeof load === 'function' ? load() : [];
    const h = data.find(x => x.name === 'Split slider');
    if(!h)return false;
    const prog = breakableProgressMinutes(h);
    if(!(prog > 0))return false;
    const cards = [...document.querySelectorAll('#list .ting-card')]
      .filter(el => (el.textContent || '').includes('Split slider'));
    const label = cards[0]?.querySelector('.breakable-progress-label')?.textContent || '';
    return label === `${prog}/90m`;
  }, null, { timeout:5000 });
  const afterSecondary = await page.evaluate(() => {
    const data = load();
    const h = data.find(x => x.name === 'Split slider');
    const cards = [...document.querySelectorAll('#list .ting-card')]
      .filter(el => (el.textContent || '').includes('Split slider'));
    return {
      progress:breakableProgressMinutes(h),
      firstHasSlider:!!cards[0]?.querySelector('.breakable-slider'),
      firstLabel:cards[0]?.querySelector('.breakable-progress-label')?.textContent || null,
      sliders:cards.map(c => !!c.querySelector('.breakable-slider')),
      trails:cards.map(c => !!c.querySelector('.ting-trail')),
      cardCount:cards.length
    };
  });
  assert(afterSecondary.progress >= 30,
    `secondary pulse should log >= min chunk, got ${afterSecondary.progress}`);
  assert(afterSecondary.firstHasSlider, 'primary card still has slider after secondary log');
  assert(afterSecondary.firstLabel === `${afterSecondary.progress}/90m`,
    `primary slider label should refresh to ${afterSecondary.progress}/90m, got ${afterSecondary.firstLabel}`);
  assert(afterSecondary.sliders.filter(Boolean).length === 1,
    `exactly one slider after re-render, got ${JSON.stringify(afterSecondary.sliders)}`);
  if(afterSecondary.cardCount > 1){
    assert(afterSecondary.trails.slice(1).every(Boolean),
      `secondary trails remain: ${JSON.stringify(afterSecondary.trails)}`);
  }
  console.log('  secondary pulse suggested-chunk: OK');

  // Fingerprint includes logged progress so home re-renders when minutes change.
  const fingerprint = await page.evaluate(() => {
    const data = load();
    const h = data.find(x => x.name === 'Split slider');
    const before = typeof homeListFingerprint === 'function' ? homeListFingerprint() : null;
    // Simulate another minute log without going through UI, then compare fp.
    const clone = JSON.parse(JSON.stringify(data));
    const hi = clone.findIndex(x => x.name === 'Split slider');
    clone[hi].logs = normalizeLogs([
      ...normalizeLogs(clone[hi].logs),
      makeActualLog(Date.now(), { minutes:1 })
    ]);
    save(clone);
    const after = typeof homeListFingerprint === 'function' ? homeListFingerprint() : null;
    // Restore prior data for later tests.
    save(data);
    return { before, after, changed:before !== after, hasFp:before != null };
  });
  assert(fingerprint.hasFp, 'homeListFingerprint should be available');
  assert(fingerprint.changed, 'fingerprint must change when breakable progress minutes change');
  console.log('  fingerprint includes progress minutes: OK');

  // Week-on-home timeline: blocked lunch before Work — Work is still the first
  // breakable instance today and must get the slider (lunch must not steal it).
  console.log('  week timeline lunch-then-work...');
  const weekClock = at(8, 0);
  await freezeClock(page, weekClock);
  await seedAndReload(page, {
    clockTs:weekClock,
    settings:defaultSettings({
      showWeekOnHome:true,
      blockedTimes:[
        { label:'sleep', days:[], start:0, end:420 },
        { label:'lunch', days:[], start:720, end:780 }
      ]
    }),
    data:[
      base({
        name:'Week work',
        type:'keepup',
        target:1,
        durationMinutes:420,
        breakable:true,
        minChunkMinutes:60,
        dueDate:null,
        lastLog:at(0, 0) - 2 * 86400000,
        logs:[at(0, 0) - 2 * 86400000],
        priority:0
      })
    ]
  });
  // Wait for full (non-progressive) week paint.
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll('#list .ting-card')]
      .filter(el => (el.textContent || '').includes('Week work'));
    return cards.length >= 1 && !document.getElementById('list')?.classList.contains('is-progressive');
  }, null, { timeout:8000 });
  const weekUi = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#list .ting-card')]
      .filter(el => (el.textContent || '').includes('Week work'));
    const listText = document.getElementById('list')?.innerText || '';
    const lunchAt = listText.toLowerCase().indexOf('lunch');
    const workAt = listText.indexOf('Week work');
    return {
      cardCount:cards.length,
      sliders:cards.map(c => !!c.querySelector('.breakable-slider')),
      trails:cards.map(c => !!c.querySelector('.ting-trail')),
      lunchBeforeWork:lunchAt >= 0 && workAt >= 0 ? lunchAt < workAt : null,
      hasLunch:lunchAt >= 0
    };
  });
  assert(weekUi.cardCount >= 1, `Week work should appear, got ${weekUi.cardCount}`);
  assert(weekUi.sliders.filter(Boolean).length === 1,
    `exactly one Week work slider (first today timeline instance), got ${JSON.stringify(weekUi.sliders)}`);
  assert(weekUi.sliders[0] === true,
    `first Week work card on the timeline must have the slider, got ${JSON.stringify(weekUi)}`);
  if(weekUi.cardCount > 1){
    assert(weekUi.sliders.slice(1).every(v => v === false),
      `later Week work chunks must keep trail, got ${JSON.stringify(weekUi.sliders)}`);
  }
  console.log('  week lunch-then-work first breakable has slider: OK');

  // ═══════════════════════════════════════════════════════════
  // H. Detail toggle persistence
  // ═══════════════════════════════════════════════════════════
  console.log('\n--- H: detail persistence ---');
  // Restore morning clock for UI interactions.
  await page.evaluate(() => { if(window.__tingsRealDate) window.Date = window.__tingsRealDate; });
  await page.goto(BASE, { waitUntil:'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil:'networkidle' });
  await page.waitForSelector('#open-add');

  await page.locator('#open-add').click();
  await page.waitForSelector('#add-sheet.open');
  await page.locator('#ting-message').fill(`BreakableDetail ${Date.now()}`);
  await page.locator('#type-seg [data-v="task"]').click();
  const due = new Date();
  const dueStr = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
  await page.locator('#ting-due-date').fill(dueStr);
  await page.locator('#do-save').click();
  await page.waitForSelector('#detail-sheet.open, body.pane-active');

  // Effort pane (duration / breakable) — pager index 3 in detail-schedule-test.
  await page.evaluate(() => {
    const pager = document.querySelector('#detail-sheet .detail-pager');
    if(pager)pager.scrollTo({ left:pager.clientWidth * 3, behavior:'instant' });
  });
  await page.waitForTimeout(200);

  const breakableBtn = page.locator('#detail-breakable');
  await breakableBtn.waitFor({ state:'visible' });
  if((await breakableBtn.getAttribute('aria-pressed')) !== 'true'){
    await breakableBtn.click();
  }
  await page.waitForSelector('#detail-min-chunk-row:not([hidden])');
  await page.locator('#detail-duration').fill('120');
  await page.locator('#detail-min-chunk').fill('45');
  await page.locator('#detail-save').click();
  await page.waitForTimeout(400);

  // Re-open and confirm persistence.
  await page.locator('.ting-card').first().click();
  await page.waitForSelector('#detail-sheet.open, body.pane-active');
  await page.evaluate(() => {
    const pager = document.querySelector('#detail-sheet .detail-pager');
    if(pager)pager.scrollTo({ left:pager.clientWidth * 3, behavior:'instant' });
  });
  await page.waitForTimeout(200);
  const pressed = await page.locator('#detail-breakable').getAttribute('aria-pressed');
  const minChunk = await page.locator('#detail-min-chunk').inputValue();
  assert(pressed === 'true', `breakable should persist on, got ${pressed}`);
  assert(minChunk === '45', `min chunk should persist as 45, got ${minChunk}`);
  const stored = await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2') || '[]');
    const h = data.find(x => String(x.name || '').startsWith('BreakableDetail'));
    return h ? { breakable:!!h.breakable, minChunkMinutes:h.minChunkMinutes } : null;
  });
  assert(stored && stored.breakable === true, 'stored breakable true');
  assert(stored && Number(stored.minChunkMinutes) === 45, `stored minChunk 45, got ${JSON.stringify(stored)}`);
  console.log('  detail persistence: OK');

  // After enabling breakable, card should show slider on home.
  await page.locator('#detail-cool').click().catch(() => {});
  await page.waitForTimeout(200);
  // Close detail if still open
  await page.evaluate(() => {
    const cool = document.getElementById('detail-cool');
    if(cool)cool.click();
  });
  await page.waitForTimeout(300);
  const detailCardSlider = await page.evaluate(() => {
    const card = [...document.querySelectorAll('#list .ting-card')].find(el =>
      (el.textContent || '').includes('BreakableDetail'));
    return !!card?.querySelector('.breakable-slider');
  });
  assert(detailCardSlider, 'persisted breakable task card should show slider');
  console.log('  breakable task card slider: OK');

  // Detail mark uses suggested chunk (not full duration) — same instant path.
  const openedDetail = await page.evaluate(() => {
    const data = load();
    const i = data.findIndex(x => String(x.name || '').startsWith('BreakableDetail'));
    if(i < 0 || typeof openDetail !== 'function')return { ok:false, i };
    openDetail(i);
    return {
      ok:true,
      i,
      progress:breakableProgressMinutes(data[i]),
      duration:clampDuration(data[i].durationMinutes),
      suggested:suggestedBreakableLogMinutes(data[i], null)
    };
  });
  assert(openedDetail.ok, 'openDetail for BreakableDetail');
  assert(openedDetail.duration === 120,
    `detail duration should be 120, got ${openedDetail.duration}`);
  assert(openedDetail.suggested === 45,
    `suggested detail mark 45, got ${openedDetail.suggested}`);
  await page.waitForSelector('#detail-sheet.open, body.pane-active', { timeout:5000 });
  await page.locator('#detail-mark').click();
  await page.waitForFunction((prev) => {
    const h = load().find(x => String(x.name || '').startsWith('BreakableDetail'));
    return h && breakableProgressMinutes(h) === prev + 45;
  }, openedDetail.progress, { timeout:5000 });
  const afterDetailMark = await page.evaluate(() => {
    const h = load().find(x => String(x.name || '').startsWith('BreakableDetail'));
    return breakableProgressMinutes(h);
  });
  assert(afterDetailMark === openedDetail.progress + 45,
    `detail-mark should log 45m, got ${afterDetailMark}`);
  console.log('  detail-mark suggested chunk: OK');

  if(errors.length){
    console.error('page errors:', errors);
    throw new Error(`page errors during breakable e2e: ${errors[0]}`);
  }

  console.log('\nAll breakable continuous-first e2e cases passed.');
  await browser.close();
  process.exit(0);
})().catch(err => {
  console.error('\nFAIL:', err && err.message ? err.message : err);
  process.exit(1);
});
