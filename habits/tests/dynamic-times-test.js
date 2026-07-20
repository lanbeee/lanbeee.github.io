// dynamic-times — tests for habit-relative anchors + blocked-time prayer anchors.
//
// Covers the features added alongside prayer-time windows:
//   • stable habit ids (hid)
//   • 'habit' anchor kind (resolve, consume-on-start, end does not consume)
//   • cycle detection on save
//   • normalize edge cases (strip dangling habit ids, keep prayer alongside)
//   • fillTimeWindow / effectiveLocationWindow / agendaBlockedIntervals
//   • settings UI: blocked-time gear toggle requires location
//   • detail UI: habit picker, save guards (missing habit / cycle / no location for prayer)
//
//   HABITS_URL=http://127.0.0.1:4173/ node tests/dynamic-times-test.js
//
const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

let pass = 0, fail = 0;
function assert(cond, msg){
  if(cond){ pass += 1; console.log('  ok: ' + msg); }
  else { fail += 1; console.error('  FAIL: ' + msg); }
}

async function openSettings(page){
  await page.locator('#open-about').click();
  await page.waitForSelector('#about-sheet.open');
  await page.locator('#open-settings').click();
  await page.waitForSelector('#settings-sheet.open');
}

async function openBlockedSection(page){
  await openSettings(page);
  await page.locator('#settings-blocked-head').click();
  await page.waitForSelector('#settings-blocked-body:not([hidden])');
}

async function toastText(page){
  return page.evaluate(() => {
    const t = document.getElementById('toast');
    return t ? (t.textContent || '').trim() : '';
  });
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
      preset:'todayFirst', topics:[], locations:[], travel:{},
      defaultTravelMode:'driving', blockedTimes:[]
    }));
  });
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);
  assert(pageErrors.length === 0, 'no page errors on boot (' + pageErrors.length + ')');

  // ══════════════════════════════════════════════════════════════════════
  // UNIT — habit-relative anchors
  // ══════════════════════════════════════════════════════════════════════

  // ── A. end anchors do NOT consume ──
  console.log('\n[A] end habit-anchor does not consume');
  const endConsume = await page.evaluate(() => {
    const today = dayStart(Date.now());
    // Must be in the past — future timestamps become plan logs (no lastLog).
    const t = Date.now() - 2 * 3600000;
    const gym = normalize([{name:'gym', type:'keepup', target:7, logs:[t]}])[0];
    const cool = normalize([{
      name:'cooldown', type:'keepup', target:7,
      allowedTimeStart:480, // 8am fixed
      allowedTimeEndAnchor:'habit',
      allowedTimeEndAnchorHabitId:gym.hid,
      allowedTimeEndOffsetMin:0,
      // Already logged AFTER gym — would collapse a START anchor.
      logs:[t + 60000]
    }])[0];
    save([gym, cool]);
    const expectedMin = dayStart(t) === today
      ? Math.round((t - today) / 60000)
      : 0; // prior-day log maps to midnight today
    return {
      endMin: resolveHabitTimeField(cool, 'allowedTimeEnd', today),
      startMin: resolveHabitTimeField({
        ...cool,
        allowedTimeStartAnchor:'habit',
        allowedTimeStartAnchorHabitId:gym.hid,
        allowedTimeStart:null
      }, 'allowedTimeStart', today),
      expectedMin
    };
  });
  assert(endConsume.endMin === endConsume.expectedMin, 'end still resolves after own log (' + endConsume.endMin + ' vs ' + endConsume.expectedMin + ')');
  assert(endConsume.startMin === null, 'start of same habit WOULD consume');

  // ── B. deleted / missing anchor habit → null ──
  console.log('\n[B] missing anchor habit');
  const missing = await page.evaluate(() => {
    const today = dayStart(Date.now());
    const orphan = normalize([{
      name:'orphan', type:'keepup', target:7,
      allowedTimeStartAnchor:'habit',
      allowedTimeStartAnchorHabitId:'does-not-exist',
      allowedTimeEnd:720
    }])[0];
    save([orphan]);
    return resolveHabitTimeField(orphan, 'allowedTimeStart', today);
  });
  assert(missing === null, 'deleted anchor habit → null');

  // ── C. negative offset + preferred habit anchor ──
  console.log('\n[C] negative offset + preferred habit anchor');
  const negOff = await page.evaluate(() => {
    const today = dayStart(Date.now());
    const t = Date.now() - 2 * 3600000; // past actual log
    const a = normalize([{name:'A', type:'keepup', target:7, logs:[t]}])[0];
    const b = normalize([{
      name:'B', type:'keepup', target:7,
      preferredTimeStartAnchor:'habit',
      preferredTimeStartAnchorHabitId:a.hid,
      preferredTimeStartOffsetMin:-15,
      preferredTimeEnd:720
    }])[0];
    save([a, b]);
    const baseMin = dayStart(t) === today ? Math.round((t - today) / 60000) : 0;
    return {
      pref: resolveHabitTimeField(b, 'preferredTimeStart', today),
      expected: baseMin - 15,
      uses: habitUsesHabitAnchors(b),
      label: prayerAnchorLabel('habit', -15, 'A')
    };
  });
  assert(negOff.pref === negOff.expected, 'negative offset applied (' + negOff.pref + ' vs ' + negOff.expected + ')');
  assert(negOff.uses === true, 'preferred habit anchor counts as usesHabit');
  assert(negOff.label === 'after A −15m', 'label shows after-name + negative offset (' + negOff.label + ')');

  // ── D. normalize strips habitId when anchor is not 'habit' ──
  console.log('\n[D] normalize strips dangling habitId');
  const stripped = await page.evaluate(() => {
    const out = normalize([{
      name:'x', type:'keepup', target:7,
      allowedTimeStartAnchor:'sunrise',
      allowedTimeStartAnchorHabitId:'should-be-dropped',
      allowedTimeEndAnchor:'habit',
      allowedTimeEndAnchorHabitId:'keep-me',
      preferredTimeStartAnchor:null,
      preferredTimeStartAnchorHabitId:'also-drop'
    }])[0];
    return {
      startId: out.allowedTimeStartAnchorHabitId,
      endId: out.allowedTimeEndAnchorHabitId,
      prefId: out.preferredTimeStartAnchorHabitId,
      startA: out.allowedTimeStartAnchor,
      endA: out.allowedTimeEndAnchor
    };
  });
  assert(stripped.startId === null, 'prayer anchor drops habitId');
  assert(stripped.endId === 'keep-me', 'habit anchor keeps habitId');
  assert(stripped.prefId === null, 'null anchor drops habitId');
  assert(stripped.startA === 'sunrise', 'prayer anchor kept');
  assert(stripped.endA === 'habit', 'habit anchor kept');

  // ── E. fillTimeWindow + effectiveLocationWindow with habit anchors ──
  console.log('\n[E] fillTimeWindow / effectiveLocationWindow');
  const windows = await page.evaluate(() => {
    const today = dayStart(Date.now());
    // Prefer 7am today if already past; otherwise 7am yesterday (maps to 0 today).
    let t = today + 7 * 3600000;
    if(t >= Date.now()) t = today - 17 * 3600000; // 7am yesterday
    const gym = normalize([{name:'gym', type:'keepup', target:7, logs:[t]}])[0];
    const stretch = normalize([{
      name:'stretch', type:'keepup', target:7,
      allowedTimeStartAnchor:'habit',
      allowedTimeStartAnchorHabitId:gym.hid,
      allowedTimeStartOffsetMin:0,
      allowedTimeEnd:12 * 60,
      durationMinutes:30,
      logs:[]
    }])[0];
    save([gym, stretch]);
    const win = fillTimeWindow(stretch, today);
    const consumed = {...stretch, lastLog:t + 1000, logs:[t + 1000]};
    const winConsumed = fillTimeWindow(consumed, today);
    const eff = effectiveLocationWindow(stretch, null, new Date().getDay());
    const effConsumed = effectiveLocationWindow(consumed, null, new Date().getDay());
    const expectedStart = dayStart(t) === today ? 7 * 60 : 0;
    return {
      winStart: win && Math.round((win.start - today) / 60000),
      winEnd: win && Math.round((win.end - today) / 60000),
      expectedStart,
      winConsumed,
      effLen: eff.length,
      effConsumedLen: effConsumed.length,
      hasWin: hasTimeWindow(stretch),
      endpointDyn: endpointIsDynamic(stretch, 'allowedTimeStart')
    };
  });
  assert(windows.winStart === windows.expectedStart, 'fillTimeWindow start (' + windows.winStart + ' vs ' + windows.expectedStart + ')');
  assert(windows.winEnd === 12 * 60, 'fillTimeWindow end = noon');
  assert(windows.winConsumed === null, 'consumed → fillTimeWindow null');
  assert(windows.effLen >= 1, 'effectiveLocationWindow open');
  assert(windows.effConsumedLen === 0, 'consumed → effectiveLocationWindow empty');
  assert(windows.hasWin === true, 'hasTimeWindow true with habit+fixed');
  assert(windows.endpointDyn === true, 'endpointIsDynamic for habit start');

  // ── F. longer cycle A→B→C→A; end-only edges ignored ──
  console.log('\n[F] longer cycles + end-only edges');
  const longCycle = await page.evaluate(() => {
    const a = normalize([{name:'A', type:'keepup', target:7}])[0];
    const b = normalize([{name:'B', type:'keepup', target:7}])[0];
    const c = normalize([{name:'C', type:'keepup', target:7}])[0];
    a.allowedTimeStartAnchor = 'habit'; a.allowedTimeStartAnchorHabitId = b.hid;
    b.allowedTimeStartAnchor = 'habit'; b.allowedTimeStartAnchorHabitId = c.hid;
    c.allowedTimeStartAnchor = 'habit'; c.allowedTimeStartAnchorHabitId = a.hid;
    save([a, b, c]);
    const abc = detectHabitAnchorCycle(a.hid, {[a.hid]:a,[b.hid]:b,[c.hid]:c});
    // End-only: A.end→B, B.end→A — should NOT be a start-chain cycle.
    const e1 = normalize([{name:'E1', type:'keepup', target:7}])[0];
    const e2 = normalize([{name:'E2', type:'keepup', target:7}])[0];
    e1.allowedTimeEndAnchor = 'habit'; e1.allowedTimeEndAnchorHabitId = e2.hid;
    e2.allowedTimeEndAnchor = 'habit'; e2.allowedTimeEndAnchorHabitId = e1.hid;
    save([e1, e2]);
    const endOnly = detectHabitAnchorCycle(e1.hid, {[e1.hid]:e1,[e2.hid]:e2});
    return { abc: abc && abc.length > 0, abcNames: abc, endOnly };
  });
  assert(longCycle.abc === true, 'A→B→C→A cycle detected');
  assert(longCycle.endOnly === null, 'end-only mutual refs are not a start cycle');

  // ══════════════════════════════════════════════════════════════════════
  // UNIT — blocked-time prayer anchors in the agenda
  // ══════════════════════════════════════════════════════════════════════

  // ── G. agendaBlockedIntervals resolves prayer anchors ──
  console.log('\n[G] agendaBlockedIntervals with prayer anchors');
  const agenda = await page.evaluate(() => {
    const s = loadSortSettings();
    s.locations = [{id:'home', name:'Home', lat:40.7, lng:-74.0}];
    s.blockedTimes = [
      {label:'sleep', days:[], start:1320, end:420, locationId:'home',
        startAnchor:'isha', startOffsetMin:0, endAnchor:'sunrise', endOffsetMin:30},
      {label:'lunch', days:[], start:720, end:780} // fixed noon–1pm
    ];
    saveSortSettings(s);
    // Keep the global in sync (agenda helpers read sortSettings).
    if(typeof sortSettings !== 'undefined'){
      Object.assign(sortSettings, loadSortSettings());
    }
    const today = dayStart(Date.now());
    const key = new Date(today).toISOString().slice(0,10);
    // Build day key in local time (toISOString is UTC — use local formatter).
    const d = new Date(today);
    const dayKey = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const blocks = agendaBlockedIntervals(dayKey, loadSortSettings(), today, today + 86400000);
    const sleep = blocks.filter(b => b.label === 'sleep');
    const lunch = blocks.filter(b => b.label === 'lunch');
    const sunrisePlus = resolveBlockedTimeMinutes(
      normalizeBlockedTimes(loadSortSettings().blockedTimes).find(b => b.label === 'sleep'),
      'end', today
    );
    // blockLocationAtMinute: during the morning sleep tail, should be at home.
    const locAt = blockLocationAtMinute(
      normalizeBlockedTimes(loadSortSettings().blockedTimes),
      Math.max(0, (sunrisePlus || 400) - 10),
      d.getDay()
    );
    const firstOpen = dayFirstOpenMinute(
      normalizeBlockedTimes(loadSortSettings().blockedTimes),
      d.getDay()
    );
    return {
      sleepParts: sleep.length,
      sleepLoc: sleep[0] && sleep[0].locationId,
      sleepEndMin: sleep.find(b => b.endMin != null && b.endMin < 720)?.endMin
        ?? sleep[0]?.endMin,
      lunchStart: lunch[0] && Math.round((lunch[0].start - today) / 60000),
      sunrisePlus,
      locAt,
      firstOpen,
      dayKey
    };
  });
  assert(agenda.sleepParts >= 1, 'sleep block emits ≥1 interval (overnight may split)');
  assert(agenda.sleepLoc === 'home', 'sleep interval carries locationId');
  assert(agenda.lunchStart === 720, 'fixed lunch still at noon');
  assert(Number.isFinite(agenda.sunrisePlus), 'sunrise+30 resolved (' + agenda.sunrisePlus + ')');
  assert(agenda.sunrisePlus > 240 && agenda.sunrisePlus < 600, 'sunrise+30 in morning window');
  assert(agenda.locAt === 'home', 'blockLocationAtMinute during sleep tail → home');
  assert(agenda.firstOpen > 0, 'dayFirstOpenMinute after morning sleep tail (' + agenda.firstOpen + ')');

  // ── H. blocked-time offset + sunset alias ──
  console.log('\n[H] blocked-time offset + sunset alias');
  const blockOff = await page.evaluate(() => {
    const today = dayStart(Date.now());
    const s = loadSortSettings();
    s.locations = [{id:'home', name:'Home', lat:40.7, lng:-74.0}];
    s.blockedTimes = [
      {label:'maghrib-block', days:[], start:1080, end:1140, locationId:'home',
        startAnchor:'sunset', startOffsetMin:15, endAnchor:'isha', endOffsetMin:-10}
    ];
    saveSortSettings(s);
    const block = normalizeBlockedTimes(loadSortSettings().blockedTimes)[0];
    const start = resolveBlockedTimeMinutes(block, 'start', today);
    const end = resolveBlockedTimeMinutes(block, 'end', today);
    const plain = resolveBlockedTimeMinutes(
      {start:1080, end:1140, startAnchor:null, endAnchor:null}, 'start', today
    );
    return {
      startAnchor: block.startAnchor,
      startOff: block.startOffsetMin,
      endOff: block.endOffsetMin,
      start, end, plain
    };
  });
  assert(blockOff.startAnchor === 'maghrib', "'sunset' aliased to maghrib on blocked time");
  assert(blockOff.startOff === 15, 'startOffsetMin kept');
  assert(blockOff.endOff === -10, 'endOffsetMin kept');
  assert(Number.isFinite(blockOff.start), 'maghrib+15 resolved');
  assert(Number.isFinite(blockOff.end), 'isha−10 resolved');
  assert(blockOff.plain === 1080, 'no-anchor blocked time returns fixed start');
  assert(blockOff.start !== 1080, 'resolved start differs from fixed fallback');

  // ══════════════════════════════════════════════════════════════════════
  // UI — detail sheet habit-relative anchors
  // ══════════════════════════════════════════════════════════════════════

  // Seed habits for UI tests. (No reload — addInitScript would wipe storage.)
  console.log('\n[I] detail UI — habit picker + save guards');
  const stretchIdx = await page.evaluate(() => {
    const today = dayStart(Date.now());
    const gymLog = Date.now() - 2 * 3600000; // past actual log
    const gym = normalize([{
      name:'Gym', type:'keepup', target:7,
      logs:[gymLog]
    }])[0];
    const stretch = normalize([{
      name:'Stretch', type:'keepup', target:7, logs:[]
    }])[0];
    // Other → Stretch so picking Other as Stretch's start anchor creates a cycle.
    const other = normalize([{
      name:'Other', type:'keepup', target:7,
      allowedTimeStartAnchor:'habit',
      allowedTimeStartAnchorHabitId:stretch.hid,
      allowedTimeEnd:720,
      logs:[]
    }])[0];
    save([gym, stretch, other]);
    if(typeof render === 'function')render();
    return load().findIndex(h => h.name === 'Stretch');
  });
  assert(stretchIdx >= 0, 'Stretch habit seeded (idx ' + stretchIdx + ')');

  // Open Stretch detail → schedule pane.
  await page.evaluate((i) => { openDetail(i); }, stretchIdx);
  await page.waitForSelector('#detail-sheet.open', { timeout:5000 });
  await page.evaluate(() => {
    const pager = document.querySelector('#detail-sheet .detail-pager');
    if(pager)pager.scrollTo({left:pager.clientWidth * 2, behavior:'auto'});
  });
  await page.waitForTimeout(200);

  // Toggle start endpoint to dynamic; pick "after another habit…".
  const startEndpoint = page.locator('.time-endpoint[data-field="allowedTimeStart"]');
  await startEndpoint.locator('.time-mode-toggle').click();
  await page.waitForTimeout(100);
  const isDyn = await startEndpoint.evaluate(el => el.classList.contains('is-dynamic'));
  assert(isDyn === true, 'gear toggles start endpoint to dynamic');

  const habitOpt = await startEndpoint.locator('.time-anchor option[value="habit"]').count();
  assert(habitOpt === 1, 'anchor dropdown includes habit option');

  await startEndpoint.locator('.time-anchor').selectOption('habit');
  await page.waitForTimeout(100);
  const pickerVisible = await startEndpoint.locator('.time-habit-wrap').evaluate(el => !el.hidden);
  assert(pickerVisible === true, 'habit picker revealed when habit selected');

  // Save without picking a habit → toast.
  // Also need an end so the window is complete — set end to fixed noon via the other endpoint.
  const endEndpoint = page.locator('.time-endpoint[data-field="allowedTimeEnd"]');
  // Ensure end is fixed with a value.
  const endIsDyn = await endEndpoint.evaluate(el => el.classList.contains('is-dynamic'));
  if(endIsDyn)await endEndpoint.locator('.time-mode-toggle').click();
  await endEndpoint.locator('.time-fixed').fill('12:00');
  await page.locator('#detail-save').click();
  await page.waitForTimeout(400);
  let toast = await toastText(page);
  assert(toast.indexOf('pick a habit') >= 0, 'save without habit → toast (' + toast + ')');
  // Sheet should still be open (save aborted).
  const stillOpen = await page.locator('#detail-sheet.open').count();
  assert(stillOpen === 1, 'detail sheet stays open after rejected save');

  // Pick Other as the anchor → creates Stretch→Other and Other→Stretch cycle.
  await startEndpoint.locator('.time-habit').selectOption({ label:'Other' });
  await page.waitForTimeout(100);
  // Self should not appear in the picker.
  const selfInPicker = await startEndpoint.locator('.time-habit option').evaluateAll(opts =>
    opts.some(o => (o.textContent || '').trim() === 'Stretch')
  );
  assert(selfInPicker === false, 'current habit excluded from picker');

  await page.locator('#detail-save').click();
  await page.waitForTimeout(400);
  toast = await toastText(page);
  assert(toast.indexOf('cycle') >= 0, 'cycle save → toast (' + toast + ')');
  assert(toast.indexOf('[object Object]') < 0, 'cycle toast uses habit names not objects (' + toast + ')');
  assert(toast.indexOf('Other') >= 0 && toast.indexOf('Stretch') >= 0, 'cycle toast names both habits');

  // Pick Gym instead → should save (no cycle; habit anchors don't need location).
  await startEndpoint.locator('.time-habit').selectOption({ label:'Gym' });
  await page.waitForTimeout(100);
  await page.locator('#detail-save').click();
  await page.waitForTimeout(500);
  toast = await toastText(page);
  assert(toast === 'saved' || toast.indexOf('saved') >= 0, 'habit-anchor save without location ok (' + toast + ')');

  const persisted = await page.evaluate(() => {
    const h = load().find(x => x.name === 'Stretch');
    return h && {
      anchor: h.allowedTimeStartAnchor,
      hid: h.allowedTimeStartAnchorHabitId,
      end: h.allowedTimeEnd,
      locs: h.locationIds
    };
  });
  assert(persisted && persisted.anchor === 'habit', 'persisted startAnchor=habit');
  assert(persisted && typeof persisted.hid === 'string' && persisted.hid.length > 0, 'persisted AnchorHabitId');
  assert(persisted && persisted.end === 720, 'mixed habit+fixed end kept (720)');
  assert(persisted && (!persisted.locs || !persisted.locs.length), 'no location required for habit anchor');

  // Prayer anchor without location still blocked.
  const stretchIdx2 = await page.evaluate(() => load().findIndex(h => h.name === 'Stretch'));
  await page.evaluate((i) => { openDetail(i); }, stretchIdx2);
  await page.waitForSelector('#detail-sheet.open', { timeout:5000 });
  await page.evaluate(() => {
    const pager = document.querySelector('#detail-sheet .detail-pager');
    if(pager)pager.scrollTo({left:pager.clientWidth * 2, behavior:'auto'});
  });
  await page.waitForTimeout(200);
  // Switch start to a prayer anchor (gear already on from saved habit state).
  const startEp2 = page.locator('.time-endpoint[data-field="allowedTimeStart"]');
  // Ensure dynamic mode is on (saved habit has habit anchor → should already be).
  const alreadyDyn = await startEp2.evaluate(el => el.classList.contains('is-dynamic'));
  if(!alreadyDyn)await startEp2.locator('.time-mode-toggle').click();
  await startEp2.locator('.time-anchor').selectOption('fajr');
  await page.waitForTimeout(100);
  const habitWrapHidden = await startEp2.locator('.time-habit-wrap').evaluate(el => el.hidden);
  assert(habitWrapHidden === true, 'habit picker hides when switching to prayer');
  // Clear the registry so the prayer-without-location guard fires. With a
  // saved location present, anywhere+prayer is now allowed (it resolves via
  // the lastKnown/registry fallback); the guard only blocks when the user
  // has no location at all.
  await page.evaluate(() => {
    const s = loadSortSettings(); s.locations = []; saveSortSettings(s);
    if(typeof sortSettings !== 'undefined')Object.assign(sortSettings, loadSortSettings());
  });
  await page.locator('#detail-save').click();
  await page.waitForTimeout(400);
  toast = await toastText(page);
  assert(toast.indexOf('location') >= 0, 'prayer without location + empty registry → toast (' + toast + ')');
  // Force-close so settings tests aren't blocked by an open sheet.
  await page.evaluate(() => {
    if(typeof closeDetail === 'function')closeDetail();
    else if(typeof closeSheet === 'function')closeSheet('detail-sheet');
  });
  await page.waitForTimeout(200);

  // ══════════════════════════════════════════════════════════════════════
  // UI — settings blocked-time dynamic controls
  // ══════════════════════════════════════════════════════════════════════

  console.log('\n[J] settings UI — blocked-time prayer anchors');
  // Seed a location + empty blocked list, then exercise the gear.
  await page.evaluate(() => {
    const s = loadSortSettings();
    s.locations = [{id:'home', name:'Home', lat:40.7, lng:-74.0}];
    s.blockedTimes = [];
    saveSortSettings(s);
    if(typeof sortSettings !== 'undefined')Object.assign(sortSettings, loadSortSettings());
    if(typeof renderBlockedTimeControls === 'function')renderBlockedTimeControls();
  });

  await openBlockedSection(page);
  await page.locator('#blocked-time-add').click();
  await page.waitForTimeout(200);
  const rows = page.locator('.blocked-time-row');
  assert(await rows.count() >= 1, 'add blocked time creates a row');

  // Gear without location → toast.
  await rows.first().locator('[data-blocked-start-mode]').click();
  await page.waitForTimeout(300);
  toast = await toastText(page);
  assert(toast.indexOf('location') >= 0, 'blocked gear without location → toast (' + toast + ')');

  // Assign location, then gear → dynamic.
  await rows.first().locator('[data-blocked-location]').selectOption('home');
  await page.waitForTimeout(200);
  await rows.first().locator('[data-blocked-start-mode]').click();
  await page.waitForTimeout(300);
  const startDyn = await rows.first().locator('.blocked-endpoint[data-blocked-field="start"]').evaluate(
    el => el.classList.contains('is-dynamic')
  );
  assert(startDyn === true, 'blocked start becomes dynamic after gear+location');

  // Change anchor to sunrise and set offset (dispatch change — fill alone
  // doesn't fire it on number inputs until blur, and blur-on-gear-click
  // races with the re-render from saveBlockedTimePatch).
  await rows.first().locator('[data-blocked-start-anchor]').selectOption('sunrise');
  await page.waitForTimeout(200);
  await rows.first().locator('[data-blocked-start-offset]').fill('30');
  await rows.first().locator('[data-blocked-start-offset]').dispatchEvent('change');
  await page.waitForTimeout(300);

  const savedBlock = await page.evaluate(() => {
    const blocks = normalizeBlockedTimes(loadSortSettings().blockedTimes);
    const b = blocks[0];
    const today = dayStart(Date.now());
    return b && {
      startAnchor: b.startAnchor,
      startOff: b.startOffsetMin,
      locationId: b.locationId,
      resolved: resolveBlockedTimeMinutes(b, 'start', today)
    };
  });
  assert(savedBlock && savedBlock.startAnchor === 'sunrise', 'blocked startAnchor persisted');
  assert(savedBlock && savedBlock.startOff === 30, 'blocked startOffsetMin persisted');
  assert(savedBlock && savedBlock.locationId === 'home', 'blocked locationId persisted');
  assert(savedBlock && Number.isFinite(savedBlock.resolved), 'blocked start resolves (' + (savedBlock && savedBlock.resolved) + ')');
  // sunrise+30 should land ~30 min after plain sunrise (~341 in NYC summer).
  assert(savedBlock && savedBlock.resolved >= 360, 'offset shifts resolved start (' + (savedBlock && savedBlock.resolved) + ')');

  // Toggle gear off → clears anchor.
  await rows.first().locator('[data-blocked-start-mode]').click();
  await page.waitForTimeout(300);
  const cleared = await page.evaluate(() => {
    const b = normalizeBlockedTimes(loadSortSettings().blockedTimes)[0];
    return b && { startAnchor:b.startAnchor, start:b.start };
  });
  assert(cleared && cleared.startAnchor == null, 'gear off clears startAnchor');
  assert(cleared && Number.isFinite(cleared.start), 'fixed start minutes kept as fallback');

  // Clearing location while dynamic strips the anchor on normalize.
  await rows.first().locator('[data-blocked-start-mode]').click();
  await page.waitForTimeout(200);
  await rows.first().locator('[data-blocked-location]').selectOption('');
  await page.waitForTimeout(300);
  const strippedLoc = await page.evaluate(() => {
    const b = normalizeBlockedTimes(loadSortSettings().blockedTimes)[0];
    return b && { startAnchor:b.startAnchor, locationId:b.locationId };
  });
  assert(strippedLoc && strippedLoc.locationId == null, 'location cleared');
  assert(strippedLoc && strippedLoc.startAnchor == null, 'anchor stripped when location cleared');

  assert(pageErrors.length === 0, 'no page errors during run (' + pageErrors.length + ')');

  // ══════════════════════════════════════════════════════════════════════
  // UNIT — later/earlier-of + +1d (sleep bedtime pattern)
  // ══════════════════════════════════════════════════════════════════════

  console.log('\n[K] later/earlier-of combine + +1d day offset');
  const combine = await page.evaluate(() => {
    const s = loadSortSettings();
    s.locations = [{id:'home', name:'Home', lat:40.7, lng:-74.0}];
    saveSortSettings(s);
    if(typeof sortSettings !== 'undefined')Object.assign(sortSettings, loadSortSettings());
    const today = dayStart(Date.now());
    // Sleep start = later of (isha +15) and (sunrise −8h on next day).
    const sleep = {
      locationIds:['home'],
      allowedTimeStartAnchor:'isha',
      allowedTimeStartOffsetMin:15,
      allowedTimeStartCombine:'later',
      allowedTimeStartAnchor2:'sunrise',
      allowedTimeStartOffsetMin2:-480,
      allowedTimeStartDayOffset2:1,
      allowedTimeEndAnchor:'sunrise',
      allowedTimeEndDayOffset:1
    };
    const start = resolveHabitTimeField(sleep, 'allowedTimeStart', today);
    const end = resolveHabitTimeField(sleep, 'allowedTimeEnd', today);
    const ishaAlone = resolveHabitTimeField({
      locationIds:['home'], allowedTimeStartAnchor:'isha', allowedTimeStartOffsetMin:15
    }, 'allowedTimeStart', today);
    const sunriseMinus8Next = resolveHabitTimeField({
      locationIds:['home'],
      allowedTimeStartAnchor:'sunrise',
      allowedTimeStartOffsetMin:-480,
      allowedTimeStartDayOffset:1
    }, 'allowedTimeStart', today);
    const earlier = resolveHabitTimeField({
      ...sleep, allowedTimeStartCombine:'earlier'
    }, 'allowedTimeStart', today);
    // Normalize round-trip.
    const round = normalize([{
      name:'sleep', type:'keepup', target:7, ...sleep
    }])[0];
    const label = habitEndpointLabel(round, 'allowedTimeStart');
    // Blocked-time mirror.
    s.blockedTimes = [{
      label:'sleep', days:[], start:1320, end:420, locationId:'home',
      startAnchor:'isha', startOffsetMin:15,
      startCombine:'later', startAnchor2:'sunrise', startOffsetMin2:-480, startDayOffset2:1,
      endAnchor:'sunrise', endDayOffset:1
    }];
    saveSortSettings(s);
    if(typeof sortSettings !== 'undefined')Object.assign(sortSettings, loadSortSettings());
    const block = normalizeBlockedTimes(loadSortSettings().blockedTimes)[0];
    const blockStart = resolveBlockedTimeMinutes(block, 'start', today);
    return {
      start, end, ishaAlone, sunriseMinus8Next, earlier,
      startIsMax: start === Math.max(ishaAlone, sunriseMinus8Next),
      earlierIsMin: earlier === Math.min(ishaAlone, sunriseMinus8Next),
      roundCombine: round.allowedTimeStartCombine,
      roundOff2: round.allowedTimeStartOffsetMin2,
      roundDay2: round.allowedTimeStartDayOffset2,
      label,
      blockCombine: block.startCombine,
      blockDay2: block.startDayOffset2,
      blockStart,
      blockMatches: blockStart === start
    };
  });
  assert(Number.isFinite(combine.start), 'combined sleep start resolves (' + combine.start + ')');
  assert(Number.isFinite(combine.end), 'sunrise +1d end resolves (' + combine.end + ')');
  assert(combine.startIsMax === true, 'later-of = max(isha+15, sunrise−8h +1d)');
  assert(combine.earlierIsMin === true, 'earlier-of = min(…)');
  assert(combine.end > 1440, 'next-day sunrise is >1440 min from dayBase (' + combine.end + ')');
  assert(combine.roundCombine === 'later', 'normalize keeps combine');
  assert(combine.roundOff2 === -480, 'normalize keeps −480 offset');
  assert(combine.roundDay2 === 1, 'normalize keeps +1d');
  assert(combine.label.indexOf('later of') === 0, 'label starts with later of (' + combine.label + ')');
  assert(combine.label.indexOf('+1d') >= 0, 'label mentions +1d');
  assert(combine.blockCombine === 'later', 'blocked-time combine kept');
  assert(combine.blockDay2 === 1, 'blocked-time +1d kept');
  assert(combine.blockMatches === true, 'blocked start matches habit start for same expr');

  // cleanTimeCombine / dayOffset helpers
  const helpers = await page.evaluate(() => ({
    later: cleanTimeCombine('later'),
    earlier: cleanTimeCombine('EARLIER'),
    junk: cleanTimeCombine('max'),
    d0: normalizeAnchorDayOffset(0),
    d1: normalizeAnchorDayOffset(1),
    d2: normalizeAnchorDayOffset(2)
  }));
  assert(helpers.later === 'later', 'cleanTimeCombine later');
  assert(helpers.earlier === 'earlier', 'cleanTimeCombine earlier');
  assert(helpers.junk === null, 'cleanTimeCombine junk→null');
  assert(helpers.d0 === 0 && helpers.d1 === 1 && helpers.d2 === 0, 'dayOffset only 0|1');

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
