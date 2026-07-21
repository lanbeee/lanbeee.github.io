/**
 * Breakable tasks — continuous-first + true min-chunk floor.
 *
 * Guards:
 *   A. Continuous wins when a gap fits full remaining
 *   B. Adaptive split into largest valid pieces (not equal min slices)
 *   C. Min floor: never schedule a piece < min while remaining >= min
 *   D. Finish-up: remaining < min after partial logs may place exactly remaining
 *   E. Progress logging updates remaining; next plan is continuous leftover
 *   F. Pure helpers: planChunks / isValidChunkMinutes / minViableSessionMinutes
 *   G. Doability uses min-viable session, not full duration
 *   H. Detail toggle persists breakable + minChunk
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
      valid15finishBad:isValidChunkMinutes(15, 20, 30)
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
