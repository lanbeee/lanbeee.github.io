// zz-verify-scroll-guard.js — real scrolls/swipes starting on buttons must NOT activate them
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass++; console.log('  ok: ' + msg); }
  else { fail++; console.error('  not ok: ' + msg); }
}

async function drag(client, x, y, dx, dy, steps = 12, stepMs = 16){
  await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x, y, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
  for(let i = 1; i <= steps; i++){
    await client.send('Input.dispatchTouchEvent', { type:'touchMove', touchPoints:[{ x:x + (dx*i)/steps, y:y + (dy*i)/steps, radiusX:10, radiusY:10, force:1, id:0 }], modifiers:0 });
    await sleep(stepMs);
  }
  await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{x:x + dx, y:y + dy, id:0}], modifiers:0 });
  await sleep(250);
}
async function sheetCount(page, id){ return page.locator(`${id}.open`).count(); }

// Today often has no free-pill (full/blocked). Bring a has-pill header into
// view so CDP taps land inside the viewport — off-screen coords make
// "sheet did not open" vacuously pass and "exact tap opens" always fail.
// preferLower: use a later day header and keep scrollY headroom so a
// finger-down drag can still move the page (scrollY cannot go below 0).
async function visibleFreePill(page, preferLower = false){
  return page.evaluate((preferLower)=>{
    const headers = [...document.querySelectorAll('#list .section-header.has-pill')];
    if(!headers.length)return null;
    const anchor = preferLower
      ? (headers[Math.min(2, headers.length - 1)] || headers[0])
      : headers[0];
    anchor.scrollIntoView({ block:'center', behavior:'instant' });
    if(preferLower && window.scrollY < 160){
      window.scrollBy({ top:160 - window.scrollY, left:0, behavior:'instant' });
    }else if(!preferLower){
      window.scrollBy({ top:-40, left:0, behavior:'instant' });
    }
    const vh = window.innerHeight;
    const order = preferLower ? headers.slice().reverse() : headers;
    for(const header of order){
      const pill = header.querySelector('.free-pill');
      if(!pill)continue;
      const r = pill.getBoundingClientRect();
      if(!(r.bottom > 8 && r.top < vh - 8 && r.height > 0))continue;
      const hr = header.getBoundingClientRect();
      return {
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
        headerX: Math.max(12, r.left - 30),
        headerY: Math.min(vh - 12, Math.max(12, hr.top + hr.height / 2)),
        scrollY: window.scrollY
      };
    }
    return null;
  }, preferLower);
}

(async () => {
  let browser;
  const launchAttempts = [
    { headless:true, channel:'chrome' },
    { headless:true },
    { headless:true, args:['--disable-gpu'] }
  ];
  let lastErr = null;
  for(const opts of launchAttempts){
    try{
      browser = await chromium.launch(opts);
      lastErr = null;
      break;
    }catch(err){
      lastErr = err;
      await sleep(300);
    }
  }
  if(!browser)throw lastErr || new Error('chromium.launch failed');
  const page = await browser.newPage({ viewport:{ width:390, height:600 }, isMobile:true, hasTouch:true });
  page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0,200)));
  const client = await page.context().newCDPSession(page);
  const now = Date.now();
  const dayMs = 86400000;
  const seedData = [];
  for(let i = 0; i < 14; i++){
    seedData.push({
      hid:`tap-${i}`,name:`Tap Habit ${i}`,emoji:'🧪',type:'keepup',target:1,
      logs:[],durationMinutes:25,createdAt:now - dayMs * (i + 2)
    });
  }
  const seedSettings = { preset:'todayFirst', showWeekOnHome:true, agendaOptimizer:false, topics:[], locations:[], travel:{}, defaultTravelMode:'driving', blockedTimes:[{label:'sleep', start:0, end:420},{label:'work', start:540, end:1020},{label:'sleep', start:1320, end:1440}] };
  await page.addInitScript(({ data, settings }) => {
    try{
      if(navigator.serviceWorker){ navigator.serviceWorker.register = () => Promise.resolve({ unregister:() => Promise.resolve(true), update:() => Promise.resolve() }); navigator.serviceWorker.getRegistrations?.().then(rs => rs.forEach(r => r.unregister())); }
    }catch{ }
    localStorage.setItem('tings_v2', JSON.stringify(data));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify(settings));
  }, { data:seedData, settings:seedSettings });
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForSelector('.free-pill', { timeout:10000 });
  await sleep(800);

  // ── 1. Home: vertical scroll attempts on/around the open pill ──
  console.log('\n[1] Home scroll attempt starting on the open pill (touch-action:none)');
  const pillPt = await visibleFreePill(page);
  await sleep(200);
  assert(Boolean(pillPt), 'found day header pill');
  // 60px drag starting ON the pill — a scroll attempt the pill swallows
  await drag(client, pillPt.x, pillPt.y, 0, 60);
  assert(await sheetCount(page, '#free-time-sheet') === 0, 'free-time sheet NOT opened after scroll attempt on pill');
  assert(await sheetCount(page, '#slipped-sheet') === 0, 'slipped sheet NOT opened after scroll attempt on pill');

  // Header text near the pill (scrollable). Prefer a lower day so scrollY has
  // headroom — finger-down drag cannot move the page when already at top.
  const hdr = await visibleFreePill(page, true);
  await sleep(150);
  assert(Boolean(hdr), 'header pill still visible for scroll drag');
  assert(hdr.scrollY >= 80, 'header drag starts with scroll headroom (' + hdr.scrollY + ')');
  await drag(client, hdr.headerX, hdr.headerY, 0, 150);
  const scrollY = await page.evaluate(() => window.scrollY);
  assert(scrollY !== hdr.scrollY, `page scrolled during header drag (${hdr.scrollY} -> ${scrollY})`);
  assert(await sheetCount(page, '#free-time-sheet') === 0, 'free-time sheet NOT opened after header scroll');

  // sanity: exact tap on a visible pill still opens the sheet
  const tapPt = await visibleFreePill(page);
  await sleep(300);
  assert(Boolean(tapPt), 'pill visible for exact tap');
  await client.send('Input.dispatchTouchEvent', { type:'touchStart', touchPoints:[{x:tapPt.x, y:tapPt.y, radiusX:10, radiusY:10, force:1, id:0}], modifiers:0 });
  await sleep(40);
  await client.send('Input.dispatchTouchEvent', { type:'touchEnd', touchPoints:[{x:tapPt.x, y:tapPt.y, id:0}], modifiers:0 });
  await sleep(120);
  assert(await sheetCount(page, '#free-time-sheet') === 1, 'exact tap on pill still opens the sheet');
  await page.locator('#free-time-close').click({ force:true });
  await sleep(150);

  // ── 2. Detail: vertical scroll starting ON a chip button ──
  console.log('\n[2] Detail vertical scroll starting on a chip button');
  await page.evaluate(() => {
    const card = document.querySelector('.ting-card[data-real]');
    if(card)card.click();
    else document.querySelector('.ting-card')?.click();
  });
  await page.waitForSelector('#detail-sheet.open', { timeout:5000 });
  await sleep(300);
  // Land on the schedule pager page before probing weekday chips.
  await page.evaluate(() => {
    if(typeof openDetailSchedule === 'function'){
      const idx = Number(document.querySelector('.ting-card[data-real]')?.dataset.real);
      if(Number.isFinite(idx))openDetailSchedule(idx);
      return;
    }
    const pager = document.querySelector('#detail-sheet .detail-pager');
    const schedule = pager && pager.querySelector('.detail-page[data-detail-nav="schedule"]');
    if(pager && schedule)pager.scrollLeft = schedule.offsetLeft;
  });
  await sleep(400);
  const chipInfo = await page.evaluate(() => {
    const pageEl = document.querySelector('#detail-sheet .detail-page[data-detail-nav="schedule"]');
    if(!pageEl)return null;
    const chip = pageEl.querySelector('#detail-weekday-chips button');
    if(!chip)return null;
    chip.scrollIntoView({ block:'center', inline:'center', behavior:'instant' });
    const r = chip.getBoundingClientRect();
    return {
      x: r.left + r.width/2, y: r.top + r.height/2,
      scrollTop: pageEl.scrollTop, scrollHeight: pageEl.scrollHeight, clientHeight: pageEl.clientHeight,
      wasOn: chip.classList.contains('on')
    };
  });
  assert(Boolean(chipInfo), 'found weekday chip button in detail schedule page');
  if(chipInfo){
    // Guarantee overflow so the scroll-guard assertion is meaningful.
    if(!(chipInfo.scrollHeight > chipInfo.clientHeight)){
      await page.evaluate(() => {
        const pageEl = document.querySelector('#detail-sheet .detail-page[data-detail-nav="schedule"]');
        if(!pageEl)return;
        const pad = document.createElement('div');
        pad.dataset.scrollGuardPad = '1';
        pad.style.height = '240px';
        pageEl.appendChild(pad);
      });
    }
    const scrollable = await page.evaluate(() => {
      const pageEl = document.querySelector('#detail-sheet .detail-page[data-detail-nav="schedule"]');
      return pageEl ? { scrollHeight:pageEl.scrollHeight, clientHeight:pageEl.clientHeight, scrollTop:pageEl.scrollTop } : null;
    });
    assert(scrollable && scrollable.scrollHeight > scrollable.clientHeight,
      `schedule page is scrollable (${scrollable && scrollable.scrollHeight} > ${scrollable && scrollable.clientHeight})`);
    await sleep(250);
    await drag(client, chipInfo.x, chipInfo.y, 0, -160); // drag up → page scrolls down
    const afterScroll = await page.evaluate(() => document.querySelector('#detail-sheet .detail-page[data-detail-nav="schedule"]').scrollTop);
    assert(afterScroll !== (scrollable.scrollTop || 0), `schedule page scrolled (${scrollable.scrollTop || 0} -> ${afterScroll})`);
    const chipNow = await page.evaluate(() => {
      const c = document.querySelector('#detail-weekday-chips button');
      return c ? c.classList.contains('on') : null;
    });
    assert(chipNow === chipInfo.wasOn, 'weekday chip NOT toggled after page scroll gesture');
    assert(await sheetCount(page, '#detail-sheet') === 1, 'detail sheet still open');
  }

  // ── 3. Detail: pager swipe starting ON a chip button ──
  console.log('\n[3] Detail pager swipe starting on a chip button');
  const swipeInfo = await page.evaluate(() => {
    const pager = document.querySelector('#detail-sheet .detail-pager');
    const schedule = pager && pager.querySelector('.detail-page[data-detail-nav="schedule"]');
    if(pager && schedule)pager.scrollLeft = schedule.offsetLeft;
    const chip = document.querySelector('#detail-weekday-chips button');
    if(!chip || !pager)return null;
    chip.scrollIntoView({ block:'center', inline:'center', behavior:'instant' });
    const r = chip.getBoundingClientRect();
    const pr = pager.getBoundingClientRect();
    return {
      x: r.left + r.width/2, y: r.top + r.height/2,
      inView: r.left >= pr.left - 5 && r.right <= pr.right + 5,
      before: pager.scrollLeft, wasOn: chip.classList.contains('on')
    };
  });
  assert(Boolean(swipeInfo), 'chip ready for swipe');
  assert(swipeInfo.inView, `chip is inside the pager viewport (left=${Math.round(swipeInfo.x)}, pager visible)`);
  await drag(client, swipeInfo.x, swipeInfo.y, -280, 0, 12, 12); // swipe left → next pager page
  const afterInfo = await page.evaluate(() => {
    const pager = document.querySelector('#detail-sheet .detail-pager');
    const c = document.querySelector('#detail-weekday-chips button');
    return { scrollLeft: pager.scrollLeft, on: c.classList.contains('on') };
  });
  assert(afterInfo.scrollLeft !== swipeInfo.before, `pager actually swiped (${swipeInfo.before} -> ${afterInfo.scrollLeft})`);
  assert(afterInfo.on === swipeInfo.wasOn, 'weekday chip NOT toggled after pager swipe');
  assert(await sheetCount(page, '#detail-sheet') === 1, 'detail sheet still open after pager swipe');

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
