// sign-toggle — tests for the +/- offset sign toggle button
//
// HABITS_URL=http://127.0.0.1:4173/ node tests/sign-toggle-test.js

const { chromium } = require('playwright');
const baseUrl = process.env.HABITS_URL || 'http://127.0.0.1:4173/';

let pass = 0, fail = 0;
function assert(cond, msg){
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
      preset:'todayFirst', topics:[], locations:[], travel:{},
      defaultTravelMode:'driving', blockedTimes:[]
    }));
  });
  await page.goto(baseUrl, { waitUntil:'load' });
  await page.waitForTimeout(300);
  assert(pageErrors.length === 0, 'no page errors on boot (' + pageErrors.length + ')');

  // ══════════════════════════════════════════════════════════════════════
  // [A] Sign toggle in habit detail view
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[A] sign toggle in habit detail view');

  // Seed a habit with a location for prayer-time resolution.
  await page.evaluate(() => {
    const s = loadSortSettings();
    s.locations = [{ id:'home', name:'Home', lat:40.7, lng:-74.0 }];
    saveSortSettings(s);
    save([{ name:'test', hid:'test-hid', type:'keepup', target:7, locationIds:['home'] }]);
    if(typeof sortSettings !== 'undefined')Object.assign(sortSettings, loadSortSettings());
    render();
  });
  await page.waitForTimeout(200);

  // Open detail programmatically.
  await page.evaluate(() => {
    const idx = load().findIndex(h => h.hid === 'test-hid');
    if(idx >= 0)openDetail(idx);
  });
  await page.waitForSelector('#detail-sheet.open', { timeout:3000 });
  await page.waitForTimeout(200);

  // Scroll schedule pane into view
  await page.evaluate(() => {
    const pager = document.querySelector('#detail-sheet .detail-pager');
    if(pager) pager.scrollTo({ left: pager.clientWidth * 2, behavior:'instant' });
  });
  await page.waitForTimeout(200);

  // Switch to dynamic mode for allowed start
  const startEndpoint = page.locator('.time-endpoint[data-field="allowedTimeStart"]');
  await startEndpoint.locator('.time-mode-toggle').click();
  await page.waitForTimeout(300);

  // Select fajr anchor
  await startEndpoint.locator('.time-anchor').selectOption('fajr');
  await page.waitForTimeout(200);

  // Type an offset value
  const offsetInput = startEndpoint.locator('.time-offset');
  await offsetInput.fill('30');
  await offsetInput.dispatchEvent('input');
  await page.waitForTimeout(200);

  // Read initial state
  let state1 = await page.evaluate(() => {
    const ep = document.querySelector('.time-endpoint[data-field="allowedTimeStart"]');
    if(!ep)return null;
    const input = ep.querySelector('.time-offset');
    const btn = input && input.nextElementSibling;
    return {
      value: input ? input.value : null,
      sign: btn ? btn.dataset.sign : null,
      btnText: btn ? btn.textContent : null
    };
  });
  assert(state1 && state1.value === '30', 'offset input shows 30 (' + state1.value + ')');
  assert(state1 && state1.sign === '+', 'sign button starts as + (' + state1.sign + ')');

  // Click the sign toggle button to make it negative (first one = primary expr)
  await startEndpoint.locator('.time-offset-sign-btn').first().click();
  await page.waitForTimeout(300);

  // Read state after toggle
  let state2 = await page.evaluate(() => {
    const ep = document.querySelector('.time-endpoint[data-field="allowedTimeStart"]');
    if(!ep)return null;
    const input = ep.querySelector('.time-offset');
    const btn = input && input.nextElementSibling;
    const resolved = ep.querySelector('.time-resolved');
    return {
      value: input ? input.value : null,
      sign: btn ? btn.dataset.sign : null,
      btnText: btn ? btn.textContent : null,
      resolved: resolved ? resolved.textContent : null
    };
  });
  assert(state2 && state2.sign === '-', 'sign button toggled to - (' + state2.sign + ')');
  assert(state2 && state2.btnText === '−', 'button text shows − (' + state2.btnText + ')');

  // Verify readSignedOffset returns the negative value
  let offsetRead = await page.evaluate(() => {
    const ep = document.querySelector('.time-endpoint[data-field="allowedTimeStart"]');
    if(!ep)return null;
    const input = ep.querySelector('.time-offset');
    return typeof readSignedOffset === 'function' ? readSignedOffset(input) : null;
  });
  assert(offsetRead === -30, 'readSignedOffset returns -30 (' + offsetRead + ')');

  // Verify currentDetailTune reads the negative offset
  let tune = await page.evaluate(() => {
    const t = typeof currentDetailTune === 'function' ? currentDetailTune() : null;
    return t ? t.allowedTimeStartOffsetMin : null;
  });
  assert(tune === -30, 'currentDetailTune reads -30 (' + tune + ')');

  // Save and verify persistence
  await page.locator('#detail-save').click();
  await page.waitForTimeout(300);

  let saved = await page.evaluate(() => {
    const all = load();
    const h = all.find(x => x.hid === 'test-hid');
    if(!h)return null;
    return { offsetMin: h.allowedTimeStartOffsetMin, anchor: h.allowedTimeStartAnchor };
  });
  assert(saved && saved.anchor === 'fajr', 'anchor saved as fajr (' + saved.anchor + ')');
  assert(saved && saved.offsetMin === -30, 'offset saved as -30 (' + saved.offsetMin + ')');

  // ══════════════════════════════════════════════════════════════════════
  // [B] Re-open and verify sign is restored
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[B] re-open — sign button restored');

  await page.evaluate(() => {
    const idx = load().findIndex(h => h.hid === 'test-hid');
    if(idx >= 0)openDetail(idx);
  });
  await page.waitForSelector('#detail-sheet.open', { timeout:3000 });
  await page.waitForTimeout(300);

  await page.evaluate(() => {
    const pager = document.querySelector('#detail-sheet .detail-pager');
    if(pager) pager.scrollTo({ left: pager.clientWidth * 2, behavior:'instant' });
  });
  await page.waitForTimeout(200);

  let state3 = await page.evaluate(() => {
    const ep = document.querySelector('.time-endpoint[data-field="allowedTimeStart"]');
    if(!ep)return null;
    const input = ep.querySelector('.time-offset');
    const btn = input && input.nextElementSibling;
    return {
      value: input ? input.value : null,
      sign: btn ? btn.dataset.sign : null,
      btnText: btn ? btn.textContent : null
    };
  });
  assert(state3 && state3.value === '30', 'offset restored as 30 (' + state3.value + ')');
  assert(state3 && state3.sign === '-', 'sign restored as - (' + state3.sign + ')');
  assert(state3 && state3.btnText === '−', 'text restored as − (' + state3.btnText + ')');

  // Close detail
  await page.evaluate(() => {
    const sheet = document.getElementById('detail-sheet');
    if(sheet) sheet.classList.remove('open');
    if(typeof closeSheet === 'function') closeSheet('detail-sheet');
  });
  await page.waitForTimeout(200);

  // ══════════════════════════════════════════════════════════════════════
  // [C] Sign toggle in blocked-time settings
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n[C] sign toggle in blocked-time settings');

  // Open settings
  await page.locator('#open-about').click();
  await page.waitForSelector('#about-sheet.open');
  await page.locator('#open-settings').click();
  await page.waitForSelector('#settings-sheet.open');

  // Open blocked section
  await page.locator('#settings-blocked-head').click();
  await page.waitForSelector('#settings-blocked-body:not([hidden])');

  // Add a blocked time
  await page.locator('#blocked-time-add').click();
  await page.waitForTimeout(300);
  const rows = page.locator('.blocked-time-row');
  assert(await rows.count() >= 1, 'add blocked time creates a row');

  // Assign a location first (gear without location → toast, so assign first)
  await rows.first().locator('[data-blocked-location]').selectOption('home');
  await page.waitForTimeout(200);

  // Toggle to dynamic mode
  await rows.first().locator('[data-blocked-start-mode]').click();
  await page.waitForTimeout(300);
  const startDyn = await rows.first().locator('.blocked-endpoint[data-blocked-field="start"]').evaluate(
    el => el.classList.contains('is-dynamic')
  );
  assert(startDyn === true, 'blocked start becomes dynamic after gear+location');

  // Select an anchor
  await rows.first().locator('[data-blocked-start-anchor]').selectOption('sunrise');
  await page.waitForTimeout(200);

  // Set offset
  const blockedOffset = rows.first().locator('[data-blocked-start-offset]');
  await blockedOffset.fill('60');
  await blockedOffset.dispatchEvent('change');
  await page.waitForTimeout(300);

  // Verify initial save
  let blockedSaved = await page.evaluate(() => {
    const b = normalizeBlockedTimes(loadSortSettings().blockedTimes)[0];
    return b ? { startOff: b.startOffsetMin, startAnchor: b.startAnchor } : null;
  });
  assert(blockedSaved && blockedSaved.startOff === 60, 'blocked offset saved as 60 (' + (blockedSaved && blockedSaved.startOff) + ')');

  // Click sign toggle button (primary expr of start endpoint)
  const blockedSignBtn = rows.first().locator('.blocked-endpoint[data-blocked-field="start"] .time-expr:not(.time-expr2) > .time-offset-sign-btn');
  await blockedSignBtn.click();
  await page.waitForTimeout(300);

  // Verify the sign toggled in the DOM
  let blockedDom = await page.evaluate(() => {
    const row = document.querySelector('.blocked-time-row');
    if(!row)return null;
    const input = row.querySelector('.time-expr > .time-offset');
    const btn = input && input.nextElementSibling;
    return {
      value: input ? input.value : null,
      sign: btn ? btn.dataset.sign : null,
      btnText: btn ? btn.textContent : null
    };
  });
  assert(blockedDom && blockedDom.sign === '-', 'blocked sign toggled to - (' + (blockedDom && blockedDom.sign) + ')');
  assert(blockedDom && blockedDom.btnText === '−', 'blocked button text shows − (' + (blockedDom && blockedDom.btnText) + ')');

  // Check that the blocked offset was saved with negative value
  let blockedSaved2 = await page.evaluate(() => {
    const b = normalizeBlockedTimes(loadSortSettings().blockedTimes)[0];
    return b ? { startOff: b.startOffsetMin, startAnchor: b.startAnchor } : null;
  });
  assert(blockedSaved2 && blockedSaved2.startOff === -60, 'blocked offset saved as -60 (' + (blockedSaved2 && blockedSaved2.startOff) + ')');

  // Click sign toggle again to go back to positive
  await blockedSignBtn.click();
  await page.waitForTimeout(300);

  let blockedSaved3 = await page.evaluate(() => {
    const b = normalizeBlockedTimes(loadSortSettings().blockedTimes)[0];
    return b ? { startOff: b.startOffsetMin } : null;
  });
  assert(blockedSaved3 && blockedSaved3.startOff === 60, 'blocked offset back to 60 (' + (blockedSaved3 && blockedSaved3.startOff) + ')');

  // ══════════════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n── page errors:', pageErrors.length);
  pageErrors.forEach(e => console.error('  ', e));
  assert(pageErrors.length === 0, 'no page errors during run');

  await browser.close();
  console.log(`\n${pass} ok, ${fail} fail`);
  if(fail > 0)process.exit(1);
})();
