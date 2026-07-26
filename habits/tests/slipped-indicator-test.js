// slipped-indicator — tests for the "slipped" day-ahead projection feature:
//
//   1. Snapshot seeding: first render records today's suggested hids.
//   2. Within-day drop: item leaves today section → pill appears.
//   3. Day rollover: yesterday's projection becomes baseline → slipped shows.
//   4. Completion excludes: logging an item removes it from slipped.
//   5. Projection refresh: data change (fingerprint) recomputes projection.
//   6. Snoozed items: shown with muted tag in dropped panel.
//   7. Empty today: pill still renders when all today items drop out.
//
//   HABITS_URL=http://127.0.0.1:4181/ node tests/slipped-indicator-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4181/';

let pass = 0, fail = 0;
function assert(cond,msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

(async () => {
  const browser = await chromium.launch({ headless:true });
  const page = await browser.newPage({ viewport:{ width:390, height:844 }, isMobile:true, hasTouch:true });
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e)));

  await page.addInitScript(() => {
    try{
      if(navigator.serviceWorker){
        navigator.serviceWorker.register = () => Promise.resolve({
          unregister:() => Promise.resolve(true),
          update:() => Promise.resolve()
        });
        navigator.serviceWorker.getRegistrations?.().then(rs => rs.forEach(r => r.unregister()));
      }
    }catch{ /* ignore */ }
    localStorage.setItem('tings_v2', JSON.stringify([]));
    localStorage.setItem('tings_app_settings_v2', JSON.stringify({
      preset:'todayFirst', showWeekOnHome:false, agendaOptimizer:false,
      topics:[], locations:[], travel:{}, defaultTravelMode:'driving', blockedTimes:[]
    }));
  });
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);
  assert(pageErrors.length === 0, 'no page errors on boot');

  // ══════════════════════════════════════════════════════════════════════
  // A. Snapshot seeding
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[A] Snapshot seeding');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'seed-1', name:'Run', emoji:'🏃', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, pinned:false },
      { hid:'seed-2', name:'Read', emoji:'📚', type:'keepup', target:2, logs:[now-3*dayMs], lastLog:now-3*dayMs, createdAt:now-30*dayMs, pinned:false },
    ]));
    localStorage.removeItem('tings_today_suggested_v1');
    render();
  });
  await page.waitForTimeout(800);
  let snap = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_today_suggested_v1') || 'null'));
  assert(snap && snap.day, 'snapshot created with day field');
  assert(snap && snap.hids && Object.keys(snap.hids).length >= 1, 'snapshot records today hids');
  assert(snap && snap.projection && snap.projection.day, 'projection stored for tomorrow');
  assert(snap && snap.projection && snap.projection.fingerprint, 'projection has fingerprint');

  // ══════════════════════════════════════════════════════════════════════
  // B. Within-day drop
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[B] Within-day drop');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'drop-1', name:'Swim', emoji:'🏊', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, pinned:false, allowedTimeStart:0, allowedTimeEnd:1439 },
    ]));
    localStorage.removeItem('tings_today_suggested_v1');
    render();
  });
  await page.waitForTimeout(800);
  let pill = await page.$('.dropped-pill');
  assert(!pill, 'no pill when item is still in today');

  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    data[0].allowedTimeEnd = 1;
    localStorage.setItem('tings_v2', JSON.stringify(data));
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill), 'pill appears after window closes');
  if(pill){
    const text = await pill.textContent();
    assert(text.includes('1'), 'pill shows count of 1');
    assert(/missed/i.test(text), `pill uses missed wording: "${text}"`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // C. Day rollover with projection baseline
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[C] Day rollover with projection baseline');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'roll-x', name:'Walk', emoji:'🚶', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, pinned:false },
      { hid:'roll-y', name:'Deep Work', emoji:'🎯', type:'keepup', target:5, logs:[now-1*dayMs], lastLog:now-1*dayMs, createdAt:now-30*dayMs, pinned:false },
    ]));
    const d = new Date(now - dayMs);
    const yesterday = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    localStorage.setItem('tings_today_suggested_v1', JSON.stringify({
      day: yesterday,
      hids: { 'roll-x':{first:now-dayMs,name:'Walk'}, 'roll-y':{first:now-dayMs,name:'Deep Work'} },
      projection: { day:'stale', hids:['roll-x','roll-y'], fingerprint:'old' }
    }));
    _droppedDayBaselineDay = null;
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill), 'pill shows on day rollover');
  if(pill){
    await pill.click();
    await page.waitForTimeout(300);
    const items = await page.$$eval('#slipped-sheet .dropped-item', els => els.map(el => el.textContent.trim()));
    assert(items.some(i => i.includes('Deep Work')), 'Deep Work shown as slipped (not due today)');
    assert(!items.some(i => i.includes('Walk')), 'Walk NOT slipped (still in today section)');
    await page.click('#slipped-close');
    await page.waitForTimeout(300);
  }

  // ══════════════════════════════════════════════════════════════════════
  // D. Completion excludes from slipped
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[D] Completion excludes from slipped');
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    data[1].logs.push(Date.now());
    data[1].lastLog = Date.now();
    localStorage.setItem('tings_v2', JSON.stringify(data));
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  assert(!pill, 'pill gone after completing the slipped item');

  // ══════════════════════════════════════════════════════════════════════
  // E. Projection refresh on data change
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[E] Projection refresh on data change');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'proj-a', name:'Stretch', emoji:'🤸', type:'keepup', target:1, logs:[now-1*dayMs], lastLog:now-1*dayMs, createdAt:now-30*dayMs, pinned:false },
      { hid:'proj-b', name:'Exercise', emoji:'💪', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, pinned:false },
    ]));
    localStorage.removeItem('tings_today_suggested_v1');
    _droppedDayBaselineDay = null;
    render();
  });
  await page.waitForTimeout(800);
  snap = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_today_suggested_v1') || 'null'));
  const projBefore = snap?.projection?.hids || [];
  assert(projBefore.includes('proj-a'), 'proj-a (daily, logged today) in tomorrow projection');

  // Log proj-a again (simulating doing it twice) — daysSince=0, tomorrow daysSince=1>=1 still due
  // Instead: change target to 7 → tomorrow daysSince=1 < 7, not due → leaves projection
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    data[0].target = 7;
    localStorage.setItem('tings_v2', JSON.stringify(data));
    render();
  });
  await page.waitForTimeout(800);
  snap = await page.evaluate(() => JSON.parse(localStorage.getItem('tings_today_suggested_v1') || 'null'));
  const projAfter = snap?.projection?.hids || [];
  assert(!projAfter.includes('proj-a'), 'proj-a removed from projection after target changed to 7d');

  // ══════════════════════════════════════════════════════════════════════
  // F. Snoozed items shown with tag
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[F] Snoozed items in dropped panel');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'snz-1', name:'Meditate', emoji:'🧘', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, pinned:false, allowedTimeStart:0, allowedTimeEnd:1439 },
      { hid:'snz-2', name:'Walk', emoji:'🚶', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, pinned:false },
    ]));
    localStorage.removeItem('tings_today_suggested_v1');
    _droppedDayBaselineDay = null;
    render();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    data[0].snoozedUntil = Date.now() + 86400000;
    data[0].allowedTimeEnd = 1;
    localStorage.setItem('tings_v2', JSON.stringify(data));
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill), 'pill shows for snoozed+dropped item');
  if(pill){
    await pill.click();
    await page.waitForTimeout(300);
    const snoozedItem = await page.$('#slipped-sheet .dropped-item.snoozed');
    assert(Boolean(snoozedItem), 'snoozed item has .snoozed class');
    const tag = await page.$('#slipped-sheet .dropped-tag');
    assert(Boolean(tag), 'snoozed tag rendered');
    await page.click('#slipped-close');
    await page.waitForTimeout(300);
  }

  // ══════════════════════════════════════════════════════════════════════
  // G. Empty today section still shows pill
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[G] Empty today section fallback');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'empty-1', name:'Yoga', emoji:'🧘', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, pinned:false, allowedTimeStart:0, allowedTimeEnd:1439 },
      { hid:'empty-2', name:'Journal', emoji:'📝', type:'keepup', target:7, logs:[now-1*dayMs], lastLog:now-1*dayMs, createdAt:now-30*dayMs, pinned:false },
    ]));
    localStorage.removeItem('tings_today_suggested_v1');
    render();
  });
  await page.waitForTimeout(800);
  // Close the only today item's window — today section becomes empty
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    data[0].allowedTimeEnd = 1;
    localStorage.setItem('tings_v2', JSON.stringify(data));
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  assert(Boolean(pill), 'pill renders even with empty today section');
  const todayHeader = await page.$('.section-header.has-dropped');
  assert(Boolean(todayHeader), 'today header inserted as fallback');

  // ══════════════════════════════════════════════════════════════════════
  // H. Tap item opens detail
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[H] Tap dropped item opens detail');
  if(pill){
    await pill.click();
    await page.waitForTimeout(300);
    const item = await page.$('#slipped-sheet .dropped-item');
    if(item){
      await item.click();
      await page.waitForTimeout(500);
      const detailOpen = await page.evaluate(() => {
        const sheet = document.getElementById('detail-sheet');
        return sheet && sheet.classList.contains('open');
      });
      assert(detailOpen, 'detail sheet opens on item tap');
    }
  }
  // Close detail sheet so it doesn't block subsequent interactions
  await page.evaluate(() => { closeSheet('detail-sheet'); });
  await page.waitForTimeout(300);

  // ══════════════════════════════════════════════════════════════════════
  // I. Missed from yesterday section renders
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[I] Missed from yesterday section');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'miss-a', name:'Yoga', emoji:'🧘', type:'keepup', target:1, flexibilityDays:0, logs:[now-3*dayMs], lastLog:now-3*dayMs, createdAt:now-30*dayMs, pinned:false, allowedTimeStart:0, allowedTimeEnd:1 },
      { hid:'miss-b', name:'Run', emoji:'🏃', type:'keepup', target:1, flexibilityDays:0, logs:[now-1*dayMs], lastLog:now-1*dayMs, createdAt:now-30*dayMs, pinned:false, allowedTimeStart:0, allowedTimeEnd:1439 },
    ]));
    const d = new Date(now - dayMs);
    const yesterday = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    localStorage.setItem('tings_today_suggested_v1', JSON.stringify({
      day: yesterday,
      hids: {},
      projection: { day:'stale', hids:['miss-a','miss-b'], fingerprint:'old' }
    }));
    _droppedDayBaselineDay = null;
    render();
  });
  await page.waitForTimeout(800);
  // miss-a has closed window (allowedTimeEnd:1) so it's overdue, not in today
  // miss-b is daily logged yesterday → daysSince=1 >= target=1 → due today → in today section
  // So only miss-a should appear as missed (miss-b is in today, excluded)
  pill = await page.$('.dropped-pill');
  if(pill){
    await pill.click();
    await page.waitForTimeout(300);
    const missedHead = await page.$('#slipped-sheet .slipped-section-head');
    assert(Boolean(missedHead), 'section header rendered in slipped sheet');
    const allItems = await page.$$eval('#slipped-sheet .dropped-item', els => els.map(el => el.textContent.trim()));
    assert(allItems.some(i => i.includes('Yoga')), 'Yoga (overdue, window closed) shown');
    assert(!allItems.some(i => i.includes('Run')), 'Run (in today section) NOT shown as missed');
    const tags = await page.$$eval('#slipped-sheet .dropped-tag', els => els.map(el => el.textContent.trim()));
    assert(tags.some(t => t.includes('behind') || t.includes('overdue')), 'behind day-tag rendered');
    await page.click('#slipped-close');
    await page.waitForTimeout(300);
  } else {
    // No pill means no slipped items, but missed section should still be accessible
    // via the sheet if we force-open it. For this test, pill absence means no baseline slipped.
    assert(false, 'expected pill for missed-from-yesterday scenario');
  }

  // ══════════════════════════════════════════════════════════════════════
  // J. Completion removes from missed section
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[J] Completion removes from missed');
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    data[0].logs.push(Date.now());
    data[0].lastLog = Date.now();
    localStorage.setItem('tings_v2', JSON.stringify(data));
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  if(pill){
    await pill.click();
    await page.waitForTimeout(300);
    const allItems = await page.$$eval('#slipped-sheet .dropped-item', els => els.map(el => el.textContent.trim()));
    assert(!allItems.some(i => i.includes('Yoga')), 'Yoga gone after completion');
    await page.click('#slipped-close');
    await page.waitForTimeout(300);
  } else {
    assert(true, 'no pill after all items completed (missed section empty)');
  }

  // ══════════════════════════════════════════════════════════════════════
  // K. No baseline → no missed section
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[K] No baseline hides missed section');
  await page.evaluate(() => {
    const now = Date.now();
    const dayMs = 86400000;
    localStorage.setItem('tings_v2', JSON.stringify([
      { hid:'nobase-1', name:'Swim', emoji:'🏊', type:'keepup', target:1, logs:[now-2*dayMs], lastLog:now-2*dayMs, createdAt:now-30*dayMs, pinned:false, allowedTimeStart:0, allowedTimeEnd:1439 },
    ]));
    localStorage.removeItem('tings_today_suggested_v1');
    _droppedDayBaselineDay = null;
    _droppedDayBaseline = null;
    render();
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('tings_v2'));
    data[0].allowedTimeEnd = 1;
    localStorage.setItem('tings_v2', JSON.stringify(data));
    render();
  });
  await page.waitForTimeout(800);
  pill = await page.$('.dropped-pill');
  if(pill){
    await pill.click();
    await page.waitForTimeout(300);
    const missedHeads = await page.$$eval('#slipped-sheet .slipped-section-head', els => els.map(el => el.textContent));
    assert(!missedHeads.some(t => /yesterday|still open/i.test(t)), 'no missed-from-yesterday section when baseline is null');
    await page.click('#slipped-close');
    await page.waitForTimeout(300);
  } else {
    assert(true, 'no pill when no baseline (expected)');
  }

  // ══════════════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n────────────────────────────────────────');
  console.log(`  ${pass} passed, ${fail} failed`);
  if(pageErrors.length){
    console.log('  pageerrors:');
    pageErrors.forEach(e => console.log('    ' + e));
  }
  await browser.close();
  process.exit(fail > 0 || pageErrors.length > 0 ? 1 : 0);
})();
