// day-header-pill-tap — open/missed pill activation across real touch paths:
//
//   A. Exact CDP tap on a mid-list (non-sticky) open pill.
//   B. Exact CDP tap while the day header is stuck sticky at the top.
//   C. Imperfect tap with ~20px drift (forgiving-button → synthesized click).
//   D. Near-miss: start just outside the pill, drift onto it.
//   E. Sheet stays open (no flash-close from trailing click).
//   F. Missed pill opens via the same drift path.
//   G. Playwright click still works as a baseline.
//   H. No page errors.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/day-header-pill-tap-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function cdpTap(client, x, y){
  await client.send('Input.dispatchTouchEvent', {
    type:'touchStart',
    touchPoints:[{x, y, radiusX:10, radiusY:10, force:1, id:0}],
    modifiers:0
  });
  await sleep(40);
  await client.send('Input.dispatchTouchEvent', {
    type:'touchEnd',
    touchPoints:[{x, y, id:0}],
    modifiers:0
  });
  await sleep(50);
}

async function cdpTapWithDrift(client, x, y, driftX, driftY = 0){
  await client.send('Input.dispatchTouchEvent', {
    type:'touchStart',
    touchPoints:[{x, y, radiusX:10, radiusY:10, force:1, id:0}],
    modifiers:0
  });
  const steps = 6;
  for(let i = 1; i <= steps; i++){
    await client.send('Input.dispatchTouchEvent', {
      type:'touchMove',
      touchPoints:[{
        x:x + (driftX * i) / steps,
        y:y + (driftY * i) / steps,
        radiusX:10, radiusY:10, force:1, id:0
      }],
      modifiers:0
    });
    await sleep(12);
  }
  await client.send('Input.dispatchTouchEvent', {
    type:'touchEnd',
    touchPoints:[{x:x + driftX, y:y + driftY, id:0}],
    modifiers:0
  });
  await sleep(50);
}

async function closeFreeSheet(page){
  if(await page.locator('#free-time-sheet.open').count()){
    await page.locator('#free-time-close').click({ force:true });
    await page.waitForSelector('#free-time-sheet:not(.open)', { timeout:3000 }).catch(()=>{});
    await sleep(150);
  }
}

async function closeSlippedSheet(page){
  if(await page.locator('#slipped-sheet.open').count()){
    await page.locator('#slipped-close').click({ force:true });
    await page.waitForSelector('#slipped-sheet:not(.open)', { timeout:3000 }).catch(()=>{});
    await sleep(150);
  }
}

async function sheetIsOpen(page, id){
  try{
    await page.waitForSelector(`${id}.open`, { timeout:1200 });
    return true;
  }catch{
    return false;
  }
}

async function waitSheetOpen(page, id, label){
  const ok = await sheetIsOpen(page, id);
  assert(ok, label);
  return ok;
}

async function pillCenter(page, selector){
  const box = await page.locator(selector).first().boundingBox();
  if(!box)throw new Error('no bounding box for ' + selector);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

async function stickyState(page, headerSel){
  return page.evaluate(sel => {
    const header = document.querySelector(sel);
    if(!header)return { found:false };
    const r = header.getBoundingClientRect();
    const sticky = getComputedStyle(header).position === 'sticky';
    return {
      found:true,
      sticky,
      top: Math.round(r.top),
      stuck: sticky && Math.abs(r.top) <= 1
    };
  }, headerSel);
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({
    viewport:{ width:390, height:844 },
    isMobile:true,
    hasTouch:true
  });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));
  const client = await page.context().newCDPSession(page);

  const now = Date.now();
  const dayMs = 86400000;
  // Enough habits + week mode so day headers stack and sticky stickiness is reachable.
  const seedData = [];
  for(let i = 0; i < 14; i++){
    seedData.push({
      hid:`tap-${i}`,
      name:`Tap Habit ${i}`,
      emoji:'🧪',
      type:'habit',
      target:1,
      logs:[],
      durationMinutes:25,
      createdAt:now - dayMs * (i + 2)
    });
  }
  // Seed a dropped item so a missed pill can appear on today.
  seedData.push({
    hid:'miss-seed',
    name:'Missed Seed',
    emoji:'📉',
    type:'habit',
    target:1,
    logs:[now - dayMs * 3],
    lastLog:now - dayMs * 3,
    durationMinutes:20,
    createdAt:now - dayMs * 10
  });

  const seedSettings = {
    preset:'todayFirst',
    showWeekOnHome:true,
    agendaOptimizer:false,
    topics:[],
    locations:[],
    travel:{},
    defaultTravelMode:'driving',
    blockedTimes:[
      {label:'sleep', start:0, end:420},
      {label:'work', start:540, end:1020},
      {label:'sleep', start:1320, end:1440}
    ]
  };

  await page.addInitScript(({ data, settings, now, dayMs }) => {
    try{
      if(navigator.serviceWorker){
        navigator.serviceWorker.register = () => Promise.resolve({
          unregister:() => Promise.resolve(true),
          update:() => Promise.resolve()
        });
        navigator.serviceWorker.getRegistrations?.().then(rs => rs.forEach(r => r.unregister()));
      }
    }catch{ /* ignore */ }
    localStorage.setItem('tings_v2', JSON.stringify(data));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
    // Force a missed pill: yesterday projection included miss-seed, today does not.
    const yesterday = new Date(now - dayMs).toISOString().slice(0, 10);
    localStorage.setItem('tings_today_suggested_v1', JSON.stringify({
      day: yesterday,
      hids:{ 'miss-seed':{ first:now - dayMs, name:'Missed Seed' } },
      projection:{ day:yesterday, hids:['miss-seed'], fingerprint:'tap-test' }
    }));
  }, { data:seedData, settings:seedSettings, now, dayMs });

  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForSelector('.free-pill', { timeout:10000 });
  await sleep(800);

  const freeCount = await page.locator('.free-pill').count();
  assert(freeCount >= 2, `enough open pills for scenarios (found ${freeCount})`);

  // ── A. Exact tap, non-sticky mid-list pill (prefer 2nd+ day header) ──
  console.log('\n[A] Exact CDP tap on non-sticky open pill');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(200);
  // Use the last free-pill that is still below the fold / not stuck.
  const midIdx = Math.min(freeCount - 1, 2);
  const midPill = page.locator('.free-pill').nth(midIdx);
  await midPill.scrollIntoViewIfNeeded();
  await sleep(200);
  // Nudge so sticky ancestor (if any) is not flush-stuck when possible.
  await page.evaluate(() => window.scrollBy(0, -40));
  await sleep(150);
  let pt = await pillCenter(page, `.free-pill >> nth=${midIdx}`);
  await cdpTap(client, pt.x, pt.y);
  const openedA = await waitSheetOpen(page, '#free-time-sheet', 'exact tap opens open-time sheet');
  if(openedA){
    await sleep(250);
    assert(
      (await page.locator('#free-time-sheet.open').count()) === 1,
      'sheet still open after 250ms (no flash-close)'
    );
  }
  await closeFreeSheet(page);

  // ── B. Sticky stuck header tap ──
  console.log('\n[B] Exact CDP tap while header is sticky-stuck');
  // Scroll until a day section header is stuck at top, then tap its free-pill.
  const stickyResult = await page.evaluate(async () => {
    const headers = [...document.querySelectorAll('#list .section-header.has-pill')];
    for(const header of headers){
      header.scrollIntoView({ block:'start' });
      await new Promise(r => setTimeout(r, 30));
      window.scrollBy(0, 48);
      await new Promise(r => setTimeout(r, 60));
      const r = header.getBoundingClientRect();
      const pill = header.querySelector('.free-pill');
      if(!pill)continue;
      if(Math.abs(r.top) <= 2 || r.top < 8){
        const pr = pill.getBoundingClientRect();
        return {
          ok:true,
          label: header.dataset.label || header.textContent.trim(),
          top: Math.round(r.top),
          x: pr.left + pr.width / 2,
          y: pr.top + pr.height / 2
        };
      }
    }
    // Fallback: force first has-pill header to the top.
    const first = headers[0];
    if(!first)return { ok:false };
    first.scrollIntoView({ block:'start' });
    window.scrollBy(0, 80);
    await new Promise(r => setTimeout(r, 80));
    const pill = first.querySelector('.free-pill');
    const pr = pill.getBoundingClientRect();
    const r = first.getBoundingClientRect();
    return {
      ok:true,
      label: first.dataset.label || first.textContent.trim(),
      top: Math.round(r.top),
      x: pr.left + pr.width / 2,
      y: pr.top + pr.height / 2,
      forced:true
    };
  });
  assert(stickyResult.ok, `found sticky candidate header (${stickyResult.label || 'n/a'}, top=${stickyResult.top})`);
  if(stickyResult.ok){
    const state = await stickyState(page, '#list .section-header.has-pill');
    assert(state.sticky, 'section headers use position:sticky');
    await cdpTap(client, stickyResult.x, stickyResult.y);
    await waitSheetOpen(page, '#free-time-sheet', 'sticky header open pill opens sheet');
    await sleep(250);
    assert(
      (await page.locator('#free-time-sheet.open').count()) === 1,
      'sticky tap sheet stays open'
    );
    await closeFreeSheet(page);
  }

  // ── C. Drift tap (forgiving path) ──
  console.log('\n[C] Drift tap (~20px) on open pill');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(150);
  const driftPill = page.locator('.free-pill').nth(Math.min(1, freeCount - 1));
  await driftPill.scrollIntoViewIfNeeded();
  await sleep(150);
  pt = await pillCenter(page, `.free-pill >> nth=${Math.min(1, freeCount - 1)}`);
  await cdpTapWithDrift(client, pt.x, pt.y, 20, 4);
  await waitSheetOpen(page, '#free-time-sheet', '20px drift tap opens open-time sheet');
  await sleep(250);
  assert(
    (await page.locator('#free-time-sheet.open').count()) === 1,
    'drift tap sheet stays open (no flash-close)'
  );
  await closeFreeSheet(page);

  // ── D. Near-miss start outside pill ──
  console.log('\n[D] Near-miss start outside pill');
  await page.evaluate(() => window.scrollTo(0, 0));
  await sleep(150);
  const nearPill = page.locator('.free-pill').nth(Math.min(1, freeCount - 1));
  await nearPill.scrollIntoViewIfNeeded();
  await sleep(150);
  const nearBox = await nearPill.boundingBox();
  // Start ~10px left of the pill edge, drift into the center.
  const startX = nearBox.x - 10;
  const startY = nearBox.y + nearBox.height / 2;
  const endX = nearBox.x + nearBox.width / 2;
  await cdpTapWithDrift(client, startX, startY, endX - startX, 0);
  await waitSheetOpen(page, '#free-time-sheet', 'near-miss drift onto pill opens sheet');
  await closeFreeSheet(page);

  // Clean near-miss: press and release just outside the visible pill edge
  // (still inside the CSS ::before hit pad). Confirm hit-testing first.
  const freshNear = await nearPill.boundingBox();
  const slopX = freshNear.x - 8;
  const slopY = freshNear.y + freshNear.height / 2;
  const hitTag = await page.evaluate(({x,y}) => {
    const el = document.elementFromPoint(x, y);
    if(!el)return 'none';
    if(el.closest('.free-pill'))return 'free-pill';
    if(el.closest('.dropped-pill'))return 'dropped-pill';
    if(el.closest('.section-header'))return 'header';
    return el.className || el.tagName;
  }, {x:slopX, y:slopY});
  assert(
    hitTag === 'free-pill' || hitTag === 'header',
    `clean near-miss point hits pill/header (got ${hitTag})`
  );
  await cdpTap(client, slopX, slopY);
  await waitSheetOpen(page, '#free-time-sheet', 'clean near-miss in hit-slop opens sheet');
  await closeFreeSheet(page);

  // Sticky + drift together.
  console.log('\n[D2] Sticky header + drift tap');
  const stickyDrift = await page.evaluate(async () => {
    const headers = [...document.querySelectorAll('#list .section-header.has-pill')];
    const first = headers[0];
    if(!first)return null;
    first.scrollIntoView({ block:'start' });
    window.scrollBy(0, 80);
    await new Promise(r => setTimeout(r, 120));
    const pill = first.querySelector('.free-pill');
    if(!pill)return null;
    const pr = pill.getBoundingClientRect();
    return { x: pr.left + pr.width / 2, y: pr.top + pr.height / 2 };
  });
  if(stickyDrift){
    await sleep(100);
    await cdpTapWithDrift(client, stickyDrift.x, stickyDrift.y, 16, 4);
    await waitSheetOpen(page, '#free-time-sheet', 'sticky + drift opens open-time sheet');
    await closeFreeSheet(page);
  }else{
    assert(false, 'sticky + drift candidate available');
  }

  // ── E. Already covered stay-open above; also verify dismiss still works ──
  console.log('\n[E] Dismiss still works after reliable open');
  await page.locator('.free-pill').first().click();
  await waitSheetOpen(page, '#free-time-sheet', 're-open for dismiss check');
  await page.locator('#free-time-close').click({ force:true });
  await sleep(200);
  assert(
    (await page.locator('#free-time-sheet.open').count()) === 0,
    'close button dismisses open-time sheet'
  );

  // ── F. Missed pill via drift ──
  console.log('\n[F] Missed pill drift tap');
  // Force a missed pill the same way slipped-indicator-test does (day rollover).
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    const existing = JSON.parse(localStorage.getItem('tings_v2') || '[]');
    if(!existing.some(h => h && h.hid === 'roll-y')){
      existing.push({
        hid:'roll-y',
        name:'Deep Work',
        emoji:'🎯',
        type:'keepup',
        target:5,
        logs:[now - dayMs],
        lastLog:now - dayMs,
        createdAt:now - 30 * dayMs,
        pinned:false
      });
      localStorage.setItem('tings_v2', JSON.stringify(existing));
    }
    const d = new Date(now - dayMs);
    const yesterday = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    localStorage.setItem('tings_today_suggested_v1', JSON.stringify({
      day: yesterday,
      hids:{ 'roll-y':{ first:now - dayMs, name:'Deep Work' } },
      projection:{ day:'stale', hids:['roll-y'], fingerprint:'old' }
    }));
    if(typeof _droppedDayBaselineDay !== 'undefined')_droppedDayBaselineDay = null;
    if(typeof _droppedDayBaseline !== 'undefined')_droppedDayBaseline = null;
    render();
  });
  await page.waitForSelector('.dropped-pill', { timeout:5000 });
  await page.evaluate(() => {
    const header = document.querySelector('.section-header.has-dropped');
    if(header)header.scrollIntoView({ block:'center' });
  });
  await sleep(300);

  // Sanity: binder must open via programmatic click first.
  const binderOk = await page.evaluate(() => {
    const pill = document.querySelector('.dropped-pill');
    if(!pill)return false;
    pill.click();
    return document.querySelector('#slipped-sheet.open') != null;
  });
  assert(binderOk, 'missed pill click binder opens slipped sheet');
  await closeSlippedSheet(page);

  await page.evaluate(() => {
    const header = document.querySelector('.section-header.has-dropped');
    if(header)header.scrollIntoView({ block:'center' });
  });
  await sleep(400);
  // Prefer a today header missed pill that is not paired with a free-pill overlap.
  await page.evaluate(() => {
    const pair = document.querySelector('.section-header.has-dropped.has-pill .dropped-pill');
    const solo = [...document.querySelectorAll('.dropped-pill')].find(p => !p.closest('.has-pill'));
    const target = solo || pair;
    if(target)target.scrollIntoView({ block:'center' });
  });
  await sleep(200);

  const missBox = await page.locator('.dropped-pill').first().boundingBox();
  assert(Boolean(missBox), 'missed pill is measurable');
  let missedOpened = false;
  let openedHow = '';
  for(const drift of [0, 12, 18]){
    await closeFreeSheet(page);
    await closeSlippedSheet(page);
    const box = await page.locator('.dropped-pill').first().boundingBox();
    if(!box)break;
    if(drift)await cdpTapWithDrift(client, box.x + box.width / 2, box.y + box.height / 2, drift, 3);
    else await cdpTap(client, box.x + box.width / 2, box.y + box.height / 2);
    missedOpened = await sheetIsOpen(page, '#slipped-sheet');
    if(!missedOpened && await sheetIsOpen(page, '#free-time-sheet')){
      // Wrong pill hit — close and retry with less drift.
      await closeFreeSheet(page);
      continue;
    }
    if(missedOpened){
      openedHow = drift ? `${drift}px drift` : 'exact';
      break;
    }
  }
  assert(missedOpened, `missed pill opens via touch (${openedHow || 'all attempts failed'})`);
  if(missedOpened){
    await sleep(200);
    assert(
      (await page.locator('#slipped-sheet.open').count()) === 1,
      'missed sheet stays open'
    );
    await closeSlippedSheet(page);
  }

  // ── G. Playwright click baseline ──
  console.log('\n[G] Playwright click baseline');
  await page.locator('.free-pill').nth(Math.min(1, freeCount - 1)).click();
  await waitSheetOpen(page, '#free-time-sheet', 'playwright click opens open-time sheet');
  await closeFreeSheet(page);

  // ── H. Errors ──
  console.log('\n[H] Page errors');
  assert(pageErrors.length === 0, `no page errors (${pageErrors.length}: ${pageErrors.slice(0,2).join(' | ')})`);

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(async err => {
  console.error(err);
  process.exit(1);
});
